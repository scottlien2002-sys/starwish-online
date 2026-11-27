import json, numpy as np, glbread as G
D = '/home/claude/starwish-online/public/models/village-npc67/'
names = ['npc_swordmaster67', 'npc_knight67', 'npc_smith67', 'npc_mage67', 'npc_priest67', 'npc_clown67', 'npc_warehouse67', 'pet_merchant67']
res = {}
for nm in names:
    for lv in ('hq', 'lite', 'far'):
        g = G.load(D + f'{nm}_{lv}.glb')
        idx = g['idx']; e = np.unique(np.sort(np.concatenate([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]]), 1), axis=0)
        P0 = g['pos']; L0 = np.linalg.norm(P0[e[:, 0]] - P0[e[:, 1]], axis=1)
        hb = g['joints'].index([i for i, n in enumerate(g['j']['nodes']) if n.get('name') == 'head'][0])
        hw = sum(np.where(g['jn'][:, k] == hb, g['wv'][:, k], 0) for k in range(4)); fe = (hw[e[:, 0]] > 0.99) & (hw[e[:, 1]] > 0.99)
        out = {}
        for an, ch in g['anims'].items():
            ts = list(ch.values())[0][0]; w = np.zeros(len(e)); minY = 9
            for t in np.linspace(0, ts.max(), int(ts.max() * 15) + 1):
                P, _ = G.pose(g, an, t)
                w = np.maximum(w, np.abs(np.linalg.norm(P[e[:, 0]] - P[e[:, 1]], axis=1) - L0)); minY = min(minY, P[:, 1].min())
            out[an] = dict(maxMM=round(float(w.max()) * 1000, 1), p999MM=round(float(np.percentile(w, 99.9)) * 1000, 1), over10mm=int((w > 0.01).sum()), edges=len(e),
                           faceMM=round(float(w[fe].max()) * 1000, 3) if fe.any() else 0.0, minY=round(float(minY), 4))
        res[f'{nm}_{lv}'] = out
        if lv == 'hq': print(nm, {a: (v['maxMM'], v['p999MM'], v['over10mm'], v['faceMM'], v['minY']) for a, v in out.items()})
json.dump(res, open('/home/claude/starwish-online/public/models/village-npc67/qa67.json', 'w'), indent=1)
