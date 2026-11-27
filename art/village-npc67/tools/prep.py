import numpy as np, glob, meshopt_py as m
SRC = '/home/claude/starwish-online/art/village-npc67/source/'
def load_oriented(name):
    d = m.load_glb(SRC + name)
    p = d['pos'].astype(np.float64); n = d['nrm'].astype(np.float64)
    # +X front -> +Z front (rotate -90 about Y): x' = -z, z' = x
    rot = lambda a: np.stack([-a[:, 2], a[:, 1], a[:, 0]], 1)
    p = rot(p); n = rot(n)
    p[:, 1] -= p[:, 1].min()
    p[:, 0] -= (p[:, 0].min() + p[:, 0].max()) / 2
    p[:, 2] -= (p[:, 2].min() + p[:, 2].max()) / 2
    d['pos'] = p; d['nrm'] = n
    return d
