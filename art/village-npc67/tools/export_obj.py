import numpy as np, os, json, prep
from chars import CHARS
OUT = '/home/claude/starwish-online/art/village-npc67/mesh'
os.makedirs(OUT, exist_ok=True)
info = {}
for fn, c in CHARS.items():
    d = prep.load_oriented(fn)
    p = d['pos']
    if c['key'] == 'board':
        s = c['width'] / (p[:, 0].max() - p[:, 0].min())
    else:
        s = c['target'] / c['head_top']
        # 腳底：身體中央區域的最低點（避開武器尖端）
        m = (np.abs(p[:, 0]) < 0.16) & (np.abs(p[:, 2]) < 0.2)
        p[:, 1] -= p[m, 1].min()
    p = p * s
    # 焊接相同位置（UV 接縫保留在 vt）
    key = np.round(p / 1e-6).astype(np.int64)
    _, uniq, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    with open(f"{OUT}/{c['key']}.obj", 'w') as f:
        f.write(f"# Stage 6.7 {fn} oriented +Z front, Y up, meters; scale {s:.5f}\n")
        for q in p[uniq]: f.write(f"v {q[0]:.6f} {q[1]:.6f} {q[2]:.6f}\n")
        for t in d['uv']: f.write(f"vt {t[0]:.6f} {1 - t[1]:.6f}\n")
        for n in d['nrm']: f.write(f"vn {n[0]:.5f} {n[1]:.5f} {n[2]:.5f}\n")
        for tri in d['idx']:
            f.write('f ' + ' '.join(f"{inv[i] + 1}/{i + 1}/{i + 1}" for i in tri) + '\n')
    info[c['key']] = dict(source=fn, scale=round(s, 5), tris=len(d['idx']), verts=len(p), welded=len(uniq),
                          height=round(float(p[:, 1].max()), 3), minY=round(float(p[:, 1].min()), 3),
                          size=[round(float(v), 3) for v in (p.max(0) - p.min(0))])
    print(c['key'], info[c['key']])
json.dump(info, open(f"{OUT}/mesh_info.json", 'w'), indent=1)
