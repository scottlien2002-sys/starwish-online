import sys, numpy as np, importlib
from PIL import Image, ImageDraw
import npcdata, rig67 as R, raster as rs
key = sys.argv[1]
cfg = importlib.import_module(f'cfg_{key}').CFG
d = npcdata.hq(key); cfg['scale'] = d['scale']
J = R.build_skeleton(cfg, d['raw'])
jn, wv = R.compute_weights(d['pos'], d['idx'], J, cfg)
pal = np.array([[.5,.5,.5],[.55,.35,.15],[.95,.6,.1],[.95,.25,.2],[.75,.2,.55],[.25,.3,.95],[.1,.85,.85],[.1,.55,.45],[.3,1,.3],[.95,.5,.95],[.6,.3,.95],[.6,.85,1],[.85,.1,.1],[.85,.85,.1],[1,1,.6],[.1,.2,.6],[.1,.6,.1],[.6,1,.6]])
col = np.zeros((len(jn), 3))
for k in range(4): col += wv[:, k:k+1] * pal[jn[:, k]]
T = d['idx']; fc = col[T].mean(1); nT = len(T); side = int(np.ceil(np.sqrt(nT)))
tex = np.zeros((side, side, 3), np.float32); ii = np.arange(nT); tex[ii // side, ii % side] = fc
uvf = np.c_[(ii % side + 0.5) / side, (ii // side + 0.5) / side]
P3 = d['pos'][T].reshape(-1, 3); N3 = d['nrm'][T].reshape(-1, 3); UV3 = np.repeat(uvf, 3, 0); I3 = np.arange(3 * nT).reshape(-1, 3)
ims = []
for v in ('front', 'right', 'back'):
    img, _ = rs.render(P3, I3, UV3, tex, v, W=360, H=600, nrm=N3)
    ims.append(Image.fromarray(img))
out = Image.new('RGB', (1080, 600), 'white')
for i, im in enumerate(ims): out.paste(im, (360 * i, 0))
dr = ImageDraw.Draw(out)
for i, (n, _) in enumerate(R.BONES): dr.text((4, 4 + 12 * i), n, fill=tuple(int(c * 255) for c in pal[i]))
out.save(f'/tmp/w_{key}.png')
np.savez(f'/tmp/rig_{key}.npz', jn=jn, wv=wv)
print('max bones/vertex used', (wv > 0).sum(1).max(), 'bones hit', sorted({R.BONES[b][0] for b in np.unique(jn[wv > 0.05])}))
