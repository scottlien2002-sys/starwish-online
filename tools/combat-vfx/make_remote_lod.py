"""Remote-player LOD for the accepted C1.0-B5b novice (Combat VFX Stage 2, multiplayer performance).

The Lite novice is 26 skinned primitives / 26 materials (only the face has a texture; every other part is vertex
coloured), i.e. 26 draw calls per player. For OTHER players we merge the 25 vertex-coloured parts into ONE primitive
with one material (the face stays separate because of its texture) -> 2 draw calls per remote player.
Nothing else changes: same nodes, same 17-joint skin, same inverse bind matrices, same Idle/Run/... animations, same
vertex positions/colours (the look is identical except that metal trims lose their metallic sheen at distance).
Stage 3: the same file also carries a FAR LOD (face_far + body_far, same skin) made with decimate.py
(hair -> 25 %, face -> 40 %, other parts over 400 triangles -> 50 %; seams and borders locked). The near meshes are
byte-for-byte the Stage 2 merged meshes, so close-up appearance does not change; the engine shows *_far beyond ~12 m.
usage: python3 make_remote_lod.py <in_lite.glb> <out_remote.glb>"""
import os
sys_path_here = os.path.dirname(os.path.abspath(__file__))
import json, struct, sys
import numpy as np
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import decimate as DEC
FAR_RATIO = {'hair': 0.25, 'head': 0.40}
FAR_DEFAULT = 0.5
FAR_MIN_TRIS = 400

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def read_glb(p):
    b = open(p, 'rb').read(); jl = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + jl])
    o = 20 + jl; bl = struct.unpack('<I', b[o:o + 4])[0]; return j, b[o + 8:o + 8 + bl]

def acc(j, b, i):
    a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]; dt = np.dtype(CT[a['componentType']]); nc = NC[a['type']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0); st = v.get('byteStride', dt.itemsize * nc)
    raw = np.frombuffer(b, np.uint8, st * (a['count'] - 1) + dt.itemsize * nc, off)
    return np.lib.stride_tricks.as_strided(raw, (a['count'], dt.itemsize * nc), (st, 1)).copy().view(dt).reshape(a['count'], nc), a

def main(src, dst):
    j, b = read_glb(src)
    out = bytearray(); views = []
    def add_view(data, target=None):
        while len(out) % 4: out.append(0)
        v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
        if target: v['target'] = target
        out.extend(data); views.append(v); return len(views) - 1
    # 1) copy every existing bufferView that is still used (images, skin, animations, face mesh) — remap indices
    face_mesh = 0
    keep_acc = set()
    for s in j.get('skins', []): keep_acc.add(s['inverseBindMatrices'])
    for an in j.get('animations', []):
        for sm in an['samplers']: keep_acc.update([sm['input'], sm['output']])
    pf = j['meshes'][face_mesh]['primitives'][0]
    keep_acc.update(pf['attributes'].values()); keep_acc.add(pf['indices'])
    view_map = {}
    def copy_view(vi):
        if vi not in view_map:
            v = j['bufferViews'][vi]; data = b[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
            nv = add_view(data, v.get('target'))
            if 'byteStride' in v: views[nv]['byteStride'] = v['byteStride']
            view_map[vi] = nv
        return view_map[vi]
    accessors = []; acc_map = {}
    for ai in sorted(keep_acc):
        a = dict(j['accessors'][ai]); a['bufferView'] = copy_view(a['bufferView']); acc_map[ai] = len(accessors); accessors.append(a)
    for im in j.get('images', []): im['bufferView'] = copy_view(im['bufferView'])
    # 2) merge the vertex-coloured body parts (same skin) into one primitive
    names = ['POSITION', 'NORMAL', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0']
    parts = {k: [] for k in names}; idx = []; far_idx = []; base = 0; n_parts = 0
    mesh_nodes = [n for n in j['nodes'] if 'mesh' in n and n['mesh'] != face_mesh]
    for n in mesh_nodes:
        for pr in j['meshes'][n['mesh']]['primitives']:
            at = pr['attributes']; cnt = None
            for k in names:
                d, a = acc(j, b, at[k])
                if k == 'COLOR_0':
                    if a['componentType'] != 5126: d = d.astype(np.float32) / (65535.0 if a['componentType'] == 5123 else 255.0)
                    if d.shape[1] == 3: d = np.c_[d, np.ones(len(d), np.float32)]
                if k == 'JOINTS_0': d = d.astype(np.uint16)
                if k == 'WEIGHTS_0' and a['componentType'] != 5126: d = d.astype(np.float32) / (65535.0 if a['componentType'] == 5123 else 255.0)
                parts[k].append(d.astype(np.float32) if k not in ('JOINTS_0',) else d); cnt = len(d)
            ii, _ = acc(j, b, pr['indices']); ii = ii.ravel().astype(np.uint32)
            idx.append(ii + base)
            mname = j['meshes'][n['mesh']].get('name', '')
            nt = len(ii) // 3
            if nt > FAR_MIN_TRIS:
                pp, _ = acc(j, b, at['POSITION'])
                far_idx.append(DEC.simplify(pp, ii, int(nt * FAR_RATIO.get(mname, FAR_DEFAULT))).astype(np.uint32) + base)
            else:
                far_idx.append(ii + base)
            base += cnt; n_parts += 1
    attrs = {}
    for k in names:
        d = np.concatenate(parts[k])
        if k == 'JOINTS_0':
            d = d.astype(np.uint8) if d.max() < 256 else d.astype(np.uint16); ct = 5121 if d.dtype == np.uint8 else 5123
        else:
            d = d.astype(np.float32); ct = 5126
        a = {'bufferView': add_view(np.ascontiguousarray(d).tobytes(), 34962), 'componentType': ct, 'count': len(d), 'type': {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4'}[d.shape[1]]}
        if k == 'POSITION': a['min'] = d.min(0).tolist(); a['max'] = d.max(0).tolist()
        attrs[k] = len(accessors); accessors.append(a)
    I = np.concatenate(idx); I = I.astype(np.uint16) if I.max() < 65535 else I
    accessors.append({'bufferView': add_view(I.tobytes(), 34963), 'componentType': 5123 if I.dtype == np.uint16 else 5125, 'count': len(I), 'type': 'SCALAR'})
    ind = len(accessors) - 1
    FI = np.concatenate(far_idx); FI = FI.astype(np.uint16) if FI.max() < 65535 else FI
    accessors.append({'bufferView': add_view(FI.tobytes(), 34963), 'componentType': 5123 if FI.dtype == np.uint16 else 5125, 'count': len(FI), 'type': 'SCALAR'})
    ind_far = len(accessors) - 1
    fpos, _ = acc(j, b, pf['attributes']['POSITION']); fidx, _ = acc(j, b, pf['indices'])
    FF = DEC.simplify(fpos, fidx.ravel(), int(len(fidx.ravel()) // 3 * FAR_RATIO['head'])).astype(np.uint32)
    FF = FF.astype(np.uint16) if FF.max() < 65535 else FF
    accessors.append({'bufferView': add_view(FF.tobytes(), 34963), 'componentType': 5123 if FF.dtype == np.uint16 else 5125, 'count': len(FF), 'type': 'SCALAR'})
    ind_face_far = len(accessors) - 1
    # 3) rebuild json: face mesh (remapped) + merged body mesh; materials: face + one cloth material
    face_mat = j['materials'][pf['material']]
    body_mat = {'name': 'remote_body_vertexcolor', 'pbrMetallicRoughness': {'metallicFactor': 0.0, 'roughnessFactor': 0.66}}
    face_prim = {'attributes': {k: acc_map[v] for k, v in pf['attributes'].items()}, 'indices': acc_map[pf['indices']], 'material': 0}
    meshes = [{'name': 'face', 'primitives': [face_prim]}, {'name': 'body_merged', 'primitives': [{'attributes': attrs, 'indices': ind, 'material': 1}]},
              {'name': 'face_far', 'primitives': [dict(face_prim, indices=ind_face_far)]}, {'name': 'body_far', 'primitives': [{'attributes': attrs, 'indices': ind_far, 'material': 1}]}]
    face_node = [n for n in j['nodes'] if n.get('mesh') == face_mesh][0]
    first_body = mesh_nodes[0]; drop = set(id(n) for n in mesh_nodes[1:])
    old_nodes = j['nodes']; keep_idx = [i for i, n in enumerate(old_nodes) if id(n) not in drop]
    remap = {o: k for k, o in enumerate(keep_idx)}
    nodes = []
    for o in keep_idx:
        n = dict(old_nodes[o])
        if 'children' in n: n['children'] = [remap[c] for c in n['children'] if c in remap]
        if n is not None and old_nodes[o] is face_node: n['mesh'] = 0
        elif old_nodes[o] is first_body: n['mesh'] = 1; n['name'] = 'body_merged'
        nodes.append(n)
    for s in j.get('skins', []):
        s['joints'] = [remap[x] for x in s['joints']]; s['inverseBindMatrices'] = acc_map[s['inverseBindMatrices']]
        if 'skeleton' in s: s['skeleton'] = remap[s['skeleton']]
    for an in j.get('animations', []):
        for sm in an['samplers']: sm['input'] = acc_map[sm['input']]; sm['output'] = acc_map[sm['output']]
        for ch in an['channels']: ch['target']['node'] = remap[ch['target']['node']]
    for sc in j.get('scenes', []): sc['nodes'] = [remap[x] for x in sc['nodes'] if x in remap]
    # far LOD nodes: siblings of the near mesh nodes, same skin
    fn = dict(nodes[remap[old_nodes.index(face_node)]]); fn['name'] = 'face_far'; fn['mesh'] = 2; fn.pop('children', None)
    bn = dict(nodes[remap[old_nodes.index(first_body)]]); bn['name'] = 'body_far'; bn['mesh'] = 3; bn.pop('children', None)
    nodes += [fn, bn]
    parent_of = {c: i for i, nd in enumerate(nodes) for c in nd.get('children', [])}
    for k_new, k_src in ((len(nodes) - 2, remap[old_nodes.index(face_node)]), (len(nodes) - 1, remap[old_nodes.index(first_body)])):
        if k_src in parent_of: nodes[parent_of[k_src]].setdefault('children', []).append(k_new)
        else:
            for sc in j.get('scenes', []): sc['nodes'].append(k_new)
    j['nodes'] = nodes; j['meshes'] = meshes; j['materials'] = [face_mat, body_mat]; j['accessors'] = accessors; j['bufferViews'] = views
    j['buffers'] = [{'byteLength': len(out)}]
    j.setdefault('asset', {})['generator'] = 'starwish make_remote_lod.py (Claude C, Combat VFX Stage 2)'
    j['asset'].setdefault('extras', {})['remoteLod'] = {'source': src.split('/')[-1], 'mergedParts': n_parts, 'drawCalls': 2,
        'nearTris': int(len(I) // 3 + len(fidx.ravel()) // 3), 'farTris': int(len(FI) // 3 + len(FF) // 3), 'farMeshes': ['face_far', 'body_far']}
    jb = json.dumps(j, separators=(',', ':')).encode(); jb += b' ' * ((4 - len(jb) % 4) % 4)
    while len(out) % 4: out.append(0)
    total = 12 + 8 + len(jb) + 8 + len(out)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total)); f.write(struct.pack('<II', len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack('<II', len(out), 0x004E4942)); f.write(bytes(out))
    print(dst, total, 'bytes; merged parts', n_parts, 'near tris', len(I) // 3 + len(fidx.ravel()) // 3, 'far tris', len(FI) // 3 + len(FF) // 3)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
