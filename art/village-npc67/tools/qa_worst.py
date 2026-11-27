import sys, numpy as np, glbread as G
D = '/home/claude/starwish-online/public/models/village-npc67/'
nm, an = sys.argv[1], sys.argv[2]
g = G.load(D + f'{nm}_hq.glb')
names = {k: g['j']['nodes'][jn]['name'] for k, jn in enumerate(g['joints'])}
idx = g['idx']; e = np.unique(np.sort(np.concatenate([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]]), 1), axis=0)
P0 = g['pos']; L0 = np.linalg.norm(P0[e[:, 0]] - P0[e[:, 1]], axis=1)
ts = list(g['anims'][an].values())[0][0]
worst = np.zeros(len(e)); low = (9, None)
for t in np.linspace(0, ts.max(), int(ts.max() * 15) + 1):
    P, _ = G.pose(g, an, t)
    worst = np.maximum(worst, np.abs(np.linalg.norm(P[e[:, 0]] - P[e[:, 1]], axis=1) - L0))
    i = np.argmin(P[:, 1])
    if P[i, 1] < low[0]: low = (P[i, 1], i, t)
print(f'{nm} {an}: max |dL| {worst.max()*1000:.1f} mm, p99.9 {np.percentile(worst,99.9)*1000:.1f} mm, edges >5mm {int((worst>0.005).sum())}/{len(e)}')
for k in np.argsort(-worst)[:6]:
    a, b = e[k]
    da = {names[g['jn'][a, j]]: round(float(g['wv'][a, j]), 2) for j in range(4) if g['wv'][a, j] > 0}
    db = {names[g['jn'][b, j]]: round(float(g['wv'][b, j]), 2) for j in range(4) if g['wv'][b, j] > 0}
    print(f'  {worst[k]*1000:6.1f}mm rest {L0[k]*1000:5.1f}mm at {P0[a].round(3)}  {da} | {db}')
v = low[1]
print('lowest vertex y', round(float(low[0]), 4), 'at rest', P0[v].round(3), 't', round(low[2], 2), {names[g['jn'][v, j]]: round(float(g['wv'][v, j]), 2) for j in range(4) if g['wv'][v, j] > 0})
