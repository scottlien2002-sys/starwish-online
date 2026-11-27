"""Minimal pure-Python/numpy decoder for EXT_meshopt_compression (vertex codec v0, index codec v1, EXPONENTIAL filter)."""
import json, struct
import numpy as np

def _unzig(b): return ((-(b & 1)) ^ (b >> 1)) & 0xFF

def _decode_bytes(data, pos, n):
    hsize = ((n // 16) + 3) // 4
    header = data[pos:pos + hsize]; pos += hsize
    out = bytearray(n)
    for i in range(0, n, 16):
        g = i // 16
        bl = (header[g // 4] >> ((g % 4) * 2)) & 3
        if bl == 0:
            continue
        if bl == 3:
            out[i:i + 16] = data[pos:pos + 16]; pos += 16; continue
        bits = 2 if bl == 1 else 4
        nbytes = 4 if bl == 1 else 8
        packed = data[pos:pos + nbytes]; var = pos + nbytes
        k = i; mx = (1 << bits) - 1
        for byte in packed:
            for s in range(8 // bits):
                enc = (byte >> (8 - bits * (s + 1))) & mx
                if enc == mx:
                    out[k] = data[var]; var += 1
                else:
                    out[k] = enc
                k += 1
        pos = var
    return out, pos

def decode_vertex(data, count, stride):
    assert data[0] == 0xA0, hex(data[0])
    tail = max(stride, 32)
    last = bytearray(data[len(data) - stride:])
    block = min((8192 // stride) & ~15, 256)
    out = bytearray(count * stride)
    pos = 1; off = 0
    while off < count:
        bs = min(block, count - off)
        aligned = (bs + 15) & ~15
        for k in range(stride):
            buf, pos = _decode_bytes(data, pos, aligned)
            p = last[k]
            for i in range(bs):
                v = (_unzig(buf[i]) + p) & 0xFF
                out[(off + i) * stride + k] = v
                p = v
        last = bytearray(out[(off + bs - 1) * stride:(off + bs) * stride])
        off += bs
    return bytes(out)

def _vbyte(data, pos):
    r = 0; sh = 0
    while True:
        b = data[pos]; pos += 1
        r |= (b & 127) << sh; sh += 7
        if b < 128 or sh >= 35: return r, pos

def decode_index(data, count):
    assert (data[0] & 0xF0) == 0xE0, hex(data[0])
    ver = data[0] & 15
    fecmax = 13 if ver >= 1 else 15
    code = 1; dpos = 1 + count // 3
    aux = data[len(data) - 16:]
    ef = [[0xFFFFFFFF, 0xFFFFFFFF] for _ in range(16)]; vf = [0xFFFFFFFF] * 16
    eo = 0; vo = 0; nxt = 0; last = 0
    out = np.zeros(count, np.uint32)
    def pv(v, c=1):
        nonlocal vo
        vf[vo] = v; vo = (vo + c) & 15
    def pe(a, b):
        nonlocal eo
        ef[eo] = [a, b]; eo = (eo + 1) & 15
    def di(pos, last):
        v, pos = _vbyte(data, pos)
        d = (v >> 1) ^ (-(v & 1))
        return (last + d) & 0xFFFFFFFF, pos
    for i in range(0, count, 3):
        ct = data[code]; code += 1
        if ct < 0xF0:
            fe = ct >> 4
            a, b = ef[(eo - 1 - fe) & 15]
            fec = ct & 15
            if fec < fecmax:
                c = nxt if fec == 0 else vf[(vo - 1 - fec) & 15]
                f0 = 1 if fec == 0 else 0
                nxt += f0
                out[i:i + 3] = (a, b, c)
                pv(c, f0); pe(c, b); pe(a, c)
            else:
                if fec != 15:
                    c = (last + (fec - (fec ^ 3))) & 0xFFFFFFFF
                else:
                    c, dpos = di(dpos, last)
                last = c
                out[i:i + 3] = (a, b, c)
                pv(c); pe(c, b); pe(a, c)
        else:
            if ct < 0xFE:
                ca = aux[ct & 15]; feb = ca >> 4; fec = ca & 15
                a = nxt; nxt += 1
                b = nxt if feb == 0 else vf[(vo - feb) & 15]
                fb0 = 1 if feb == 0 else 0; nxt += fb0
                c = nxt if fec == 0 else vf[(vo - fec) & 15]
                fc0 = 1 if fec == 0 else 0; nxt += fc0
                out[i:i + 3] = (a, b, c)
                pv(a); pv(b, fb0); pv(c, fc0); pe(b, a); pe(c, b); pe(a, c)
            else:
                ca = data[dpos]; dpos += 1
                fea = 0 if ct == 0xFE else 15
                feb = ca >> 4; fec = ca & 15
                if ca == 0: nxt = 0
                a = 0
                if fea == 0: a = nxt; nxt += 1
                if feb == 0: b = nxt; nxt += 1
                else: b = vf[(vo - feb) & 15]
                if fec == 0: c = nxt; nxt += 1
                else: c = vf[(vo - fec) & 15]
                if fea == 15: a, dpos = di(dpos, last); last = a
                if feb == 15: b, dpos = di(dpos, last); last = b
                if fec == 15: c, dpos = di(dpos, last); last = c
                out[i:i + 3] = (a, b, c)
                pv(a); pv(b, 1 if feb in (0, 15) else 0); pv(c, 1 if fec in (0, 15) else 0)
                pe(b, a); pe(c, b); pe(a, c)
    return out

def exp_filter(raw, count, stride):
    v = np.frombuffer(raw, np.int32).copy()
    e = v >> 24
    m = (v << 8) >> 8
    return np.ldexp(m.astype(np.float64), e).astype(np.float32).reshape(count, stride // 4)

def load_glb(path):
    b = open(path, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    bin0 = 20 + jl + 8
    binb = b[bin0: bin0 + struct.unpack('<I', b[20 + jl:24 + jl])[0]]
    views = {}
    for i, bv in enumerate(j['bufferViews']):
        ex = bv.get('extensions', {}).get('EXT_meshopt_compression')
        if ex:
            src = binb[ex['byteOffset']: ex['byteOffset'] + ex['byteLength']]
            if ex['mode'] == 'ATTRIBUTES':
                raw = decode_vertex(src, ex['count'], ex['byteStride'])
                views[i] = (ex, raw)
            elif ex['mode'] == 'TRIANGLES':
                views[i] = (ex, decode_index(src, ex['count']))
        else:
            views[i] = (None, binb[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']])
    prim = j['meshes'][0]['primitives'][0]
    def acc(k):
        a = j['accessors'][k]; ex, raw = views[a['bufferView']]
        if ex and ex['mode'] == 'TRIANGLES':
            return raw.astype(np.int64)
        if ex and ex.get('filter') == 'EXPONENTIAL':
            return exp_filter(raw, ex['count'], ex['byteStride'])[:, :{'VEC3': 3, 'VEC2': 2}[a['type']]]
        if a['componentType'] == 5120:
            arr = np.frombuffer(raw, np.int8).reshape(a['count'], -1)[:, :3].astype(np.float32) / 127.0
            return arr
        raise ValueError(a)
    out = {
        'pos': acc(prim['attributes']['POSITION']),
        'nrm': acc(prim['attributes']['NORMAL']),
        'uv': acc(prim['attributes']['TEXCOORD_0']),
        'idx': acc(prim['indices']).reshape(-1, 3),
        'json': j,
    }
    images = []
    for im in j['images']:
        bv = j['bufferViews'][im['bufferView']]
        images.append(binb[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']])
    out['images'] = images
    pa = j['accessors'][prim['attributes']['POSITION']]
    out['acc_min'] = np.array(pa['min']); out['acc_max'] = np.array(pa['max'])
    return out
