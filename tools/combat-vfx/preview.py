"""Render novice skill poses (python LBS + starwish_rig rasteriser) with a placeholder sword/staff line."""
import os, sys, io, json, numpy as np
sys.path.insert(0, os.environ.get('STARWISH_RIG', '/home/claude/m004'))  # starwish_rig（Claude C 的骨架工具；只有預覽圖需要）
from PIL import Image
from starwish_rig.raster import render, grid
from glbio import load, acc, Skel, qrot, qmul
import novice_skills as NS

def mat_from(q, t):
    x, y, z, w = q
    R = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
    M = np.eye(4); M[:3, :3] = R; M[:3, 3] = t; return M

class Model:
    def __init__(s, path):
        j, b = load(path); s.sk = Skel(path); s.j = j
        sk = j['skins'][0]; s.ibm = acc(j, b, sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
        P = []; N = []; JJ = []; WW = []; IDX = []; COL = []; off = 0
        for node in j['nodes']:
            if 'mesh' not in node or 'skin' not in node: continue
            for pr in j['meshes'][node['mesh']]['primitives']:
                a = pr['attributes']; p = acc(j, b, a['POSITION']); n = acc(j, b, a['NORMAL'])
                jj = acc(j, b, a['JOINTS_0']).astype(int); ww = acc(j, b, a['WEIGHTS_0'])
                ix = acc(j, b, pr['indices']).astype(int).ravel() + off
                m = j['materials'][pr['material']]; c = m.get('pbrMetallicRoughness', {}).get('baseColorFactor', [0.8, 0.8, 0.8, 1])[:3]
                P.append(p); N.append(n); JJ.append(jj); WW.append(ww); IDX.append(ix); COL.append(np.tile(np.array(c) ** (1 / 2.2), (len(p), 1))); off += len(p)
        s.P = np.concatenate(P); s.N = np.concatenate(N); s.J = np.concatenate(JJ); s.W = np.concatenate(WW); s.I = np.concatenate(IDX); s.C = np.concatenate(COL)
    def skin(s, pose, root_fwd=0.0, root_yaw=0.0):
        WR, WT = s.sk.fk(pose.R, pose.T)
        Ms = np.array([mat_from(WR[k], WT[k]) @ s.ibm[k] for k in range(len(WR))])
        Rr = mat_from(NS.qaxis(NS.Y, root_yaw), [0, 0, root_fwd])
        Ms = np.einsum('ij,kjl->kil', Rr, Ms)
        M = np.einsum('vk,vkij->vij', s.W, Ms[s.J])
        p = np.einsum('vij,vj->vi', M[:, :3, :3], s.P) + M[:, :3, 3]
        n = np.einsum('vij,vj->vi', M[:, :3, :3], s.N); n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
        hk = s.sk.id['hand.R']; hand = Rr[:3, :3] @ WT[hk] + Rr[:3, 3]; hq = qmul(NS.qaxis(NS.Y, root_yaw), WR[hk])
        return p, n, hand, hq

def weapon_line(hand, hq, local_dir, length):
    d = qrot(hq, local_dir); return hand, hand + d * length

if __name__ == '__main__':
    g, clipname, out = sys.argv[1], sys.argv[2], sys.argv[3]
    ts = [float(x) for x in sys.argv[4].split(',')]
    views = [tuple(map(float, v.split(','))) for v in (sys.argv[5] if len(sys.argv) > 5 else '0.7,0.25,0.7;-1,0.1,0;0,0.2,1').split(';')]
    S = [s for s in NS.SKILLS if s['name'] == clipname][0]
    m = Model(os.path.join(MODELS, f'novice_c10b5b_{g}_lite.glb')); rig = NS.Rig(m.sk)
    wdir = np.array(json.loads(sys.argv[6])) if len(sys.argv) > 6 else None
    ims = []; labs = []
    for t in ts:
        pose = rig.pose(**S['fn'](t)); f, y = S['root'](t)
        p, n, hand, hq = m.skin(pose, f, y)
        P = p; C = m.C; I = m.I
        if wdir is not None:   # draw the blade as a thin quad strip
            a, b2 = weapon_line(hand, hq, wdir, 0.5)
            side = np.cross(b2 - a, [0, 0, 1]); side = side / (np.linalg.norm(side) + 1e-9) * 0.015
            q = np.array([a - side, a + side, b2 + side, b2 - side]); k = len(P)
            P = np.vstack([P, q]); n = np.vstack([n, np.tile([0, 0, 1.0], (4, 1))]); C = np.vstack([C, np.tile([1, 0.9, 0.2], (4, 1))])
            I = np.concatenate([I, np.array([k, k + 1, k + 2, k, k + 2, k + 3, k, k + 2, k + 1, k, k + 3, k + 2])])
        ce = np.array([0, 0.62, 0.25])
        for v in views:
            dv = np.array(v) / np.linalg.norm(v)
            im, _ = render(P, n, np.zeros((len(P), 2)), I, None, ce + dv * 6, ce, size=(260, 260), ortho=0.85, vcolor=C)
            ims.append(im); labs.append(f'{clipname[6:]} {t:.2f}')
    grid(ims, len(views) * (2 if len(views) <= 3 else 1), labs).save(out)
