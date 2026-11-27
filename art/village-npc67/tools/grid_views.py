import sys, numpy as np, glob
from PIL import Image, ImageDraw
import prep, raster as r
names = sys.argv[1:]
for nm in names:
    d = prep.load_oriented(nm)
    tex = r.tex_array(d['images'][0], 1024)
    H = 760; ims = []
    for v in ('front', 'right'):
        img, s = r.render(d['pos'], d['idx'], d['uv'], tex, v, W=560, H=H, nrm=d['nrm'], pad=0.02)
        im = Image.fromarray(img); dr = ImageDraw.Draw(im)
        p = d['pos']; cy = (p[:, 1].max() + p[:, 1].min()) / 2
        for k in range(0, 21):
            y = k * 0.05; py = H / 2 - (y - cy) * s
            dr.line([(0, py), (560, py)], fill=(255, 0, 0) if k % 2 == 0 else (255, 170, 170), width=1)
            dr.text((2, py - 10), f'{y:.2f}', fill=(200, 0, 0))
        # horizontal axis ticks (x for front, z for side)
        ax = 0 if v == 'front' else 2
        c = (p[:, ax].max() + p[:, ax].min()) / 2 if v == 'front' else 0
        for k in range(-8, 9):
            xv = k * 0.05
            px = 280 + (xv * (1 if v == 'front' else -1) - (c if v=='front' else 0)) * s
            dr.line([(px, 0), (px, H)], fill=(0, 0, 255) if k == 0 else (170, 170, 255), width=1)
            dr.text((px + 2, H - 14), f'{xv:+.2f}', fill=(0, 0, 200))
        ims.append(im)
    out = Image.new('RGB', (1120, H + 20), 'white')
    for i, im in enumerate(ims): out.paste(im, (560 * i, 20))
    ImageDraw.Draw(out).text((5, 3), nm + '  left: front (x right=+X? see note) | right: side (looking from +X)', fill='black')
    out.save('/tmp/grid_' + nm.replace('.glb', '.png'))
    print(nm, 'x', p[:, 0].min().round(3), p[:, 0].max().round(3), 'y', p[:, 1].max().round(3), 'z', p[:, 2].min().round(3), p[:, 2].max().round(3))
