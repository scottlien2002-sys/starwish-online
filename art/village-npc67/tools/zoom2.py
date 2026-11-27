import sys, numpy as np, prep, raster as r
from PIL import Image, ImageDraw
fn = sys.argv[1]; y0, y1 = float(sys.argv[2]), float(sys.argv[3])
d = prep.load_oriented(fn)
tex = r.tex_array(d['images'][0], 1024)
p = d['pos']; H = 1300
outs = []
for view in ('front', 'right', 'left'):
    img, s = r.render(p, d['idx'], d['uv'], tex, view, W=1300, H=H, nrm=d['nrm'], pad=0.0)
    cy = (p[:, 1].max() + p[:, 1].min()) / 2
    if view == 'front':
        cx = (p[:, 0].max() + p[:, 0].min()) / 2; X = lambda v: 650 + (v - cx) * s
    elif view == 'right':
        cz = (p[:, 2].max() + p[:, 2].min()) / 2; X = lambda v: 650 - (v - cz) * s
    else:
        cz = (p[:, 2].max() + p[:, 2].min()) / 2; X = lambda v: 650 + (v - cz) * s
    Y = lambda v: H / 2 - (v - cy) * s
    im = Image.fromarray(img); dr = ImageDraw.Draw(im)
    for k in np.arange(-0.4, 0.401, 0.02):
        c = (0, 0, 255) if abs(k) < 1e-6 else ((120, 120, 255) if abs(round(k * 50)) % 5 == 0 else (205, 205, 255))
        dr.line([(X(k), 0), (X(k), H)], fill=c)
        if abs(round(k * 50)) % 5 == 0: dr.text((X(k) + 2, Y(y1) + 2), f'{k:+.1f}', fill=(0, 0, 160))
    for k in np.arange(0, 1.0, 0.02):
        c = (255, 120, 120) if abs(round(k * 50)) % 5 == 0 else (255, 205, 205)
        dr.line([(0, Y(k)), (1300, Y(k))], fill=c)
        if abs(round(k * 50)) % 5 == 0: dr.text((4, Y(k) - 11), f'{k:.1f}', fill=(160, 0, 0))
    xs = [X(-0.36), X(0.36)]
    crop = im.crop((int(min(xs)), int(Y(y1)), int(max(xs)), int(Y(y0))))
    crop = crop.resize((int(crop.width * 0.48), int(crop.height * 0.48)))
    outs.append(crop)
W = sum(o.width for o in outs) + 10
out = Image.new('RGB', (W, outs[0].height + 18), 'white')
x = 0
for o in outs: out.paste(o, (x, 18)); x += o.width + 10
ImageDraw.Draw(out).text((4, 2), fn + '  front (x, char right = -x) | side from +X (left=+z) | side from -X (right=+z)   grid 0.02', fill='black')
out.save('/tmp/z2_' + fn.split('_')[0] + '.png'); print(out.size)
