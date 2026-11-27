"""獨立讀回自己輸出的 GLB（不使用建置端資料），做蒙皮與動作抽格。"""
import json, struct, io
import numpy as np
from PIL import Image
CT = {5126: np.float32, 5121: np.uint8, 5123: np.uint16, 5125: np.uint32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def load(path):
    b = open(path, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + jl]); bin_ = b[20 + jl + 8:]
    def acc(i):
        a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]
        arr = np.frombuffer(bin_, CT[a['componentType']], a['count'] * NC[a['type']], v['byteOffset'])
        return arr.reshape(a['count'], NC[a['type']]) if NC[a['type']] > 1 else arr
    pr = j['meshes'][0]['primitives'][0]; at = pr['attributes']
    out = {'j': j, 'pos': acc(at['POSITION']).astype(float), 'nrm': acc(at['NORMAL']).astype(float), 'uv': acc(at['TEXCOORD_0']).astype(float),
           'idx': acc(pr['indices']).reshape(-1, 3).astype(np.int64)}
    if 'JOINTS_0' in at:
        out['jn'] = acc(at['JOINTS_0']).astype(int); out['wv'] = acc(at['WEIGHTS_0']).astype(float)
        sk = j['skins'][0]; out['ibm'] = acc(sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1); out['joints'] = sk['joints']
        out['anims'] = {}
        for an in j['animations']:
            ch = {}
            for c in an['channels']:
                s = an['samplers'][c['sampler']]
                ch[(c['target']['node'], c['target']['path'])] = (acc(s['input']), acc(s['output']))
            out['anims'][an['name']] = ch
    mat = j['materials'][0]; bt = mat['pbrMetallicRoughness']['baseColorTexture']['index']
    im = j['images'][j['textures'][bt]['source']]; v = j['bufferViews'][im['bufferView']]
    out['tex'] = Image.open(io.BytesIO(bin_[v['byteOffset']:v['byteOffset'] + v['byteLength']]))
    out['texinfo'] = [(j['images'][t['source']]['name'], Image.open(io.BytesIO(bin_[j['bufferViews'][j['images'][t['source']]['bufferView']]['byteOffset']:][:j['bufferViews'][j['images'][t['source']]['bufferView']]['byteLength']])).size) for t in j['textures']]
    return out

def qm(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])

def pose(g, anim=None, t=0.0):
    j = g['j']; nodes = j['nodes']
    loc = {}
    for i, n in enumerate(nodes):
        T = np.array(n.get('translation', [0, 0, 0]), float); Q = np.array(n.get('rotation', [0, 0, 0, 1]), float)
        if anim:
            for path in ('translation', 'rotation'):
                k = (i, path)
                if k in g['anims'][anim]:
                    ts, vs = g['anims'][anim][k]
                    f = np.interp(t, ts, np.arange(len(ts))); a = int(np.floor(f)); bb = min(a + 1, len(ts) - 1); u = f - a
                    v = vs[a] * (1 - u) + vs[bb] * u
                    if path == 'rotation': Q = v / np.linalg.norm(v)
                    else: T = v
        M = np.eye(4); M[:3, :3] = qm(Q); M[:3, 3] = T; loc[i] = M
    par = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
    G = {}
    def glob(i):
        if i in G: return G[i]
        G[i] = loc[i] if i not in par else glob(par[i]) @ loc[i]
        return G[i]
    S = [glob(jn) @ g['ibm'][k] for k, jn in enumerate(g['joints'])]
    ph = np.c_[g['pos'], np.ones(len(g['pos']))]
    out = np.zeros_like(g['pos'])
    S = np.stack(S)
    for k in range(4):
        out += g['wv'][:, k:k + 1] * np.einsum('nij,nj->ni', S[g['jn'][:, k]], ph)[:, :3]
    return out, {nodes[i]['name']: glob(i) for i in range(len(nodes)) if 'mesh' not in nodes[i]}
