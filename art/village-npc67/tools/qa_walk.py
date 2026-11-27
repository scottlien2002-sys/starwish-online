import sys, numpy as np, importlib, math
from PIL import Image, ImageDraw
import npcdata, rig67 as R, anim67 as A, raster as rs
cfg = importlib.import_module('cfg_merchant').CFG
d = npcdata.hq('merchant'); cfg['scale'] = d['scale']
J = R.build_skeleton(cfg, d['raw'])
z = np.load('/tmp/rig_merchant.npz'); jn, wv = z['jn'], z['wv']
clips = A.merchant_clips(J, {'breath': 1.2, 'look': 3.0})
print('IK clamped frames', clips.pop('_walk_clamped'))
W = clips['Walk']
# 腳滑：腳底（腳踝骨）世界座標＋身體前進 v·t；支撐期應固定
for side in ('R', 'L'):
    zs = []; ys = []; st = []
    for i, t in enumerate(W['times']):
        q = {b: W['rot'][b][i] for b in W['rot']}; tr = {b: W['trans'][b][i] - (J[b] - J[R.BONES[R.BI[b]][1]] if R.BONES[R.BI[b]][1] else J[b]) for b in W['trans']}
        G, S = R.global_mats(J, q, tr)
        a = G[R.BI[f'foot.{side}']][:3, 3]
        zs.append(a[2] + A.WALK_V * t); ys.append(a[1])
        st.append(A.walk_targets(J, side, t)[2])
    zs = np.array(zs); ys = np.array(ys); st = np.array(st)
    # 支撐期連續段
    segs = []; cur = []
    for i, s_ in enumerate(st):
        if s_: cur.append(i)
        elif cur: segs.append(cur); cur = []
    if cur: segs.append(cur)
    sl = max((np.ptp(zs[s]) for s in segs if len(s) > 1), default=0)
    yl = max((np.ptp(ys[s]) for s in segs if len(s) > 1), default=0)
    print(side, 'stance frames', int(st.sum()), 'foot slide (mm)', round(sl * 1000, 2), 'foot vertical drift (mm)', round(yl * 1000, 2))
np.save('/tmp/merchant_J.npy', np.array([J[b] for b, _ in R.BONES]))
# 側面逐格圖
tex = rs.tex_array(d['images'][0], 1024)
frames = [0, 3, 6, 9, 12, 15, 18, 21]
ims = []
fit = None
for f in frames:
    q = {b: W['rot'][b][f] for b in W['rot']}
    tr = {b: W['trans'][b][f] - (J[b] - J[R.BONES[R.BI[b]][1]]) for b in W['trans']}
    G, S = R.global_mats(J, q, tr)
    P = R.skin(d['pos'], jn, wv, S)
    img, _ = rs.render(P, d['idx'], d['uv'], tex, 'right', W=260, H=420, nrm=d['nrm'], fit=(np.array([0, 0.68, 0]), 0.7))
    im = Image.fromarray(img); ImageDraw.Draw(im).text((4, 4), f'Walk f{f}', fill='black'); ims.append(im)
out = Image.new('RGB', (260 * 4, 420 * 2), 'white')
for i, im in enumerate(ims): out.paste(im, (260 * (i % 4), 420 * (i // 4)))
out.save('/tmp/walk_merchant.png')
