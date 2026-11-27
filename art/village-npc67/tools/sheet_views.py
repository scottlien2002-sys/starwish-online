import sys, numpy as np, glob
from PIL import Image, ImageDraw
import meshopt_py as m, raster as r
files = sorted(glob.glob('/home/claude/starwish-online/art/village-npc67/source/*.glb'))
views = ['front', 'right', 'back', 'left']
rows = []
for f in files:
    d = m.load_glb(f)
    tex = r.tex_array(d['images'][0], 1024)
    ims = [Image.fromarray(r.render(d['pos'], d['idx'], d['uv'], tex, v, W=300, H=420, nrm=d['nrm'])[0]) for v in views]
    row = Image.new('RGB', (300 * 4, 440), 'white')
    for i, im in enumerate(ims): row.paste(im, (300 * i, 20))
    ImageDraw.Draw(row).text((5, 3), f.split('/')[-1] + '   views: +Z(front) / +X / -Z / -X', fill='black')
    rows.append(row)
out = Image.new('RGB', (1200, 440 * len(rows)), 'white')
for i, rw in enumerate(rows): out.paste(rw, (0, 440 * i))
out.save('/tmp/npc67_views.png')
