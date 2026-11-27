import sys, numpy as np, prep, raster as r
from PIL import Image, ImageDraw
fn, view = sys.argv[1], sys.argv[2]
x0, x1, y0, y1 = map(float, sys.argv[3:7])
d = prep.load_oriented(fn)
m = (np.abs(d['pos'][:, 1]) >= 0)
tex = r.tex_array(d['images'][0], 1024)
H = 900
# render full then crop by computing scale
img, s = r.render(d['pos'], d['idx'], d['uv'], tex, view, W=900, H=H, nrm=d['nrm'], pad=0.0)
p = d['pos']; cy = (p[:, 1].max() + p[:, 1].min()) / 2
ax = 0 if view == 'front' else 2
cx = (p[:, ax].max() + p[:, ax].min()) / 2
sign = 1 if view == 'front' else -1
X = lambda v: 450 + (sign * v - (cx if view == 'front' else -cx * 0)) * s
Y = lambda v: H / 2 - (v - cy) * s
im = Image.fromarray(img); dr = ImageDraw.Draw(im)
for k in np.arange(-0.4, 0.41, 0.02):
    dr.line([(X(k), 0), (X(k), H)], fill=(0, 0, 255) if abs(k) < 1e-6 else (190, 190, 255))
    dr.text((X(k) + 1, Y(y0) - 12), f'{k:+.2f}', fill=(0, 0, 160))
for k in np.arange(0, 1.0, 0.02):
    dr.line([(0, Y(k)), (900, Y(k))], fill=(255, 190, 190))
    dr.text((X(x0) + 1, Y(k) - 10), f'{k:.2f}', fill=(160, 0, 0))
box = (int(min(X(x0), X(x1))), int(Y(y1)), int(max(X(x0), X(x1))), int(Y(y0)))
im.crop(box).save('/tmp/zoom.png'); print(box)
