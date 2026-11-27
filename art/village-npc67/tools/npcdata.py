import numpy as np, io, os
from PIL import Image
import prep
from chars import CHARS
DEC = '/tmp/npc67dec'
def by_key(key):
    for fn, c in CHARS.items():
        if c['key'] == key: return fn, c
def hq(key):
    fn, c = by_key(key)
    d = prep.load_oriented(fn)
    raw = d['pos'].copy()
    p = d['pos']
    if key == 'board':
        s = c['width'] / (p[:, 0].max() - p[:, 0].min())
    else:
        s = c['target'] / c['head_top']
        m = (np.abs(p[:, 0]) < 0.16) & (np.abs(p[:, 2]) < 0.2)
        p[:, 1] -= p[m, 1].min(); raw[:, 1] -= raw[m, 1].min()
    imgs = [Image.open(io.BytesIO(b)) for b in d['images']]
    return dict(pos=p * s, raw=raw, uv=d['uv'].astype(np.float64), idx=d['idx'], nrm=d['nrm'], scale=s, images=imgs)
