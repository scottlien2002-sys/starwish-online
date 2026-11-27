import sys, json, numpy as np, glbread as G
D = '/home/claude/starwish-online/public/models/village-npc67/'
names = ['npc_swordmaster67', 'npc_knight67', 'npc_smith67', 'npc_mage67', 'npc_priest67', 'npc_clown67', 'npc_warehouse67', 'pet_merchant67']
res = {}
for nm in names:
    for lv in ('hq', 'lite'):
        g = G.load(D + f'{nm}_{lv}.glb')
        idx = g['idx']; e = np.unique(np.sort(np.concatenate([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]]), 1), axis=0)
        P0 = g['pos']; L0 = np.linalg.norm(P0[e[:, 0]] - P0[e[:, 1]], axis=1); ok = L0 > 1e-5
        # 臉部：頭骨權重 ≥0.99 且在頭部高度以上
        _, Gm = G.pose(g)
        headY = Gm['head'][1, 3]
        headw = np.zeros(len(P0)); hb = g['joints'].index([i for i, n in enumerate(g['j']['nodes']) if n.get('name') == 'head'][0])
        for k in range(4): headw += np.where(g['jn'][:, k] == hb, g['wv'][:, k], 0)
        face = (headw > 0.99)
        fe = face[e[:, 0]] & face[e[:, 1]]
        out = {}
        for an, ch in g['anims'].items():
            ts = list(ch.values())[0][0]
            mx = 0; p99 = 0; fmax = 0; minY = 9
            for t in np.linspace(0, ts.max(), max(2, int(ts.max() * 10) + 1)):
                P, _ = G.pose(g, an, t)
                L = np.linalg.norm(P[e[:, 0]] - P[e[:, 1]], axis=1)
                r = np.abs(L[ok] / L0[ok] - 1)
                mx = max(mx, r.max()); p99 = max(p99, np.percentile(r, 99.9))
                fmax = max(fmax, np.abs(L[ok & fe] / L0[ok & fe] - 1).max() if (ok & fe).any() else 0)
                minY = min(minY, P[:, 1].min())
            out[an] = dict(maxStretchPct=round(mx * 100, 2), p999Pct=round(p99 * 100, 2), facePct=round(fmax * 100, 3), minY=round(float(minY), 4))
        res[f'{nm}_{lv}'] = out
        print(nm, lv, {a: (v['maxStretchPct'], v['p999Pct'], v['facePct'], v['minY']) for a, v in out.items()})
json.dump(res, open('/tmp/qa_strain.json', 'w'), indent=1)
