import sys, numpy as np
from PIL import Image, ImageDraw
import glbread as G, raster as rs
name = sys.argv[1]; D = '/home/claude/starwish-online/public/models/village-npc67/'
hq = G.load(D + f'{name}_hq.glb'); li = G.load(D + f'{name}_lite.glb'); fa = G.load(D + f'{name}_far.glb')
fit = (np.array([0, 0.72, 0]), 0.8)
panels = []
def rend(g, P, view, label, W=230, H=330):
    tex = rs.tex_array(g['tex'], g['tex'].size[0])
    img, _ = rs.render(P, g['idx'], g['uv'], tex, view, W=W, H=H, nrm=g['nrm'], fit=fit)
    im = Image.fromarray(img); ImageDraw.Draw(im).text((3, 3), label, fill='black'); return im
P0, _ = G.pose(hq)
panels.append(rend(hq, P0, 'front', 'HQ bind front'))
panels.append(rend(hq, P0, 'right', 'HQ bind side'))
P, _ = G.pose(li); panels.append(rend(li, P, 'front', f'Lite {len(li["idx"])} tris'))
P, _ = G.pose(fa); panels.append(rend(fa, P, 'front', f'Far {len(fa["idx"])} tris'))
for an, t, v in (('Idle', 1.0, 'q45'), ('Talk', 0.3, 'front'), ('Act', None, 'front'), ('Act', None, 'q315'), ('Walk', 0.13, 'right'), ('Walk', 0.53, 'front')):
    if an not in hq['anims']: continue
    ts = list(hq['anims'][an].values())[0][0]
    tt = float(ts.max()) * 0.5 if t is None else t
    P, _ = G.pose(hq, an, tt)
    panels.append(rend(hq, P, v, f'{an} t={tt:.2f} {v}'))
cols = 5; rows = (len(panels) + cols - 1) // cols
out = Image.new('RGB', (230 * cols, 330 * rows + 16), 'white')
for i, p in enumerate(panels): out.paste(p, (230 * (i % cols), 16 + 330 * (i // cols)))
ImageDraw.Draw(out).text((4, 2), f'{name}  tex {hq["texinfo"]}  anims {sorted(hq["anims"])}', fill='black')
out.save(f'/tmp/sheet_{name}.png')
# 綁定姿勢 vs 原始網格
import npcdata
key = name.replace('npc_', '').replace('67', '').replace('pet_merchant', 'merchant')
src = npcdata.hq(key)['pos']
print(name, 'bind pose vs source max err (mm)', round(float(np.abs(P0 - src).max()) * 1000, 4))
