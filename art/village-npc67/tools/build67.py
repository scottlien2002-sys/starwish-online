"""Stage 6.7：產生 public/models/village-npc67/npc_<key>_{hq,lite,far}.glb、board67_{hq,lite}.glb 與統計。"""
import sys, os, json, io, hashlib
import numpy as np
from PIL import Image
import npcdata, rig67 as R, anim67 as A
from cfgs import CFGS

OUT = '/home/claude/starwish-online/public/models/village-npc67'
DEC = '/tmp/npc67dec'
os.makedirs(OUT, exist_ok=True)
TEX = {'hq': (1024, 512), 'lite': (512, None), 'far': (256, None)}  # (底色, 法線)


def level_mesh(key, lv, hqd):
    if lv == 'hq':
        return hqd['pos'], hqd['uv'], hqd['idx'], hqd['nrm']
    pos, uv, idx = R.load_obj(f'{DEC}/{key}_{lv}.obj')
    return pos, uv, idx, R.smooth_normals(pos, idx)


def textures(hqd, lv):
    b, n = TEX[lv]
    imgs = {'base': R.jpeg(hqd['images'][0], b, 88 if lv == 'hq' else 85)}
    if n: imgs['normal'] = R.jpeg(hqd['images'][2], n, 90)
    return imgs


def build(key, stats):
    hqd = npcdata.hq(key)
    if key == 'board':
        # 佈告欄：高畫質用 5,000 面（減面 lite 檔）、中低畫質用 2,500 面（減面 far 檔）；原始 9,044 面不直接使用（村莊每幀三角面標準）
        for lv, src in (('hq', 'lite'), ('lite', 'far')):
            pos, uv, idx, nrm = level_mesh(key, src, hqd)
            pos = pos.copy(); pos[:, 1] -= pos[:, 1].min()
            # 佈告欄字樣「委託公告」要清楚：中低畫質也用 1024 底色貼圖（沒有法線貼圖）
            imgs = textures(hqd, 'hq') if lv == 'hq' else {'base': R.jpeg(hqd['images'][0], 1024, 86)}
            n = R.write_glb(f'{OUT}/board67_{lv}.glb', 'QuestBoard67', pos, nrm, uv, idx, None, images=imgs, static=True)
            stats[f'board67_{lv}'] = dict(bytes=n, triangles=len(idx), size=[round(float(v), 3) for v in pos.max(0) - pos.min(0)], minY=round(float(pos[:, 1].min()), 3))
        return
    cfg = dict(CFGS[key]); cfg['scale'] = hqd['scale']
    J = R.build_skeleton(cfg, hqd['raw'])
    P = cfg.get('anim', {})
    clips = A.merchant_clips(J, P) if key == 'merchant' else A.npc_clips(J, P)
    clamped = clips.pop('_walk_clamped', 0)
    name = 'pet_merchant67' if key == 'merchant' else f'npc_{key}67'
    for lv in ('hq', 'lite', 'far'):
        pos, uv, idx, nrm = level_mesh(key, lv, hqd)
        jn, wv = R.compute_weights(pos, idx, J, cfg)
        fn = f'{OUT}/{name}_{lv}.glb'
        n = R.write_glb(fn, name, pos, nrm, uv, idx, J, jn, wv, clips, textures(hqd, lv))
        stats[f'{name}_{lv}'] = dict(bytes=n, triangles=len(idx), vertices=len(pos), animations=sorted(clips), height=round(float(pos[:, 1].max()), 3),
                                     minY=round(float(pos[:, 1].min()), 4), bones=len(R.BONES), maxInfluences=int((wv > 0).sum(1).max()), ikClamped=int(clamped))
        if lv == 'hq': np.savez(f'/tmp/rig_{key}.npz', jn=jn, wv=wv)
    np.save(f'/tmp/J_{key}.npy', np.array([J[b] for b, _ in R.BONES]))


if __name__ == '__main__':
    keys = sys.argv[1:] or list(CFGS) + ['board']
    stats = {}
    p = f'{OUT}/stats67.json'
    if os.path.exists(p): stats = json.load(open(p))
    for k in keys:
        build(k, stats); print(k, {kk: (v['triangles'], v['bytes']) for kk, v in stats.items() if k in kk or (k == 'merchant' and 'merchant' in kk)})
    json.dump(stats, open(p, 'w'), indent=1, ensure_ascii=False)
