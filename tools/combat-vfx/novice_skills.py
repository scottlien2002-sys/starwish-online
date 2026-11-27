"""Combat VFX Lab — six demo skill animations for the accepted C1.0-B5b novice skeleton (17 joints).
Authored as full-body poses (hips/spine/chest twist, arms, two-bone leg IK with planted feet) in the character
frame (glTF: +Y up, +Z forward, +X = character's left); lunges, the leap and the whirlwind spin go to a separate
root-motion curve applied to the player node, so the clip itself never drifts.
Baked per gender at 30 fps to local joint quaternions + hips translation, with named timing marks.
usage: python3 novice_skills.py <out_dir>"""
import json, sys, os
MODELS = os.environ.get('NOVICE_MODELS', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'models'))
import numpy as np
from glbio import Skel, qmul, qinv, qrot, qaxis, norm

X, Y, Z = np.eye(3)
FPS = 30

def ss(x):
    x = np.clip(x, 0.0, 1.0); return x * x * (3 - 2 * x)
def seg(t, a, b): return float(np.clip((t - a) / (b - a), 0.0, 1.0))
def ease(t, a, b): return float(ss((t - a) / (b - a)))
def bump(t, a, b):                     # 0 -> 1 -> 0 over [a, b]
    return float(np.sin(np.pi * seg(t, a, b)))
def damp(t, t0, f=9.0, k=8.0):
    if t < t0: return 0.0
    u = t - t0; return float(np.exp(-k * u) * np.cos(2 * np.pi * f * u))

def from_to(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b); c = np.cross(a, b); d = float(np.dot(a, b))
    if d < -0.99999:
        ax = np.cross(a, X) if abs(a[0]) < 0.9 else np.cross(a, Y)
        return qaxis(ax, np.pi)
    q = np.array([c[0], c[1], c[2], 1 + d]); return q / np.linalg.norm(q)

class Pose:
    """World-space pose builder. rot(bone, axis, ang) turns the bone (and its children) about a world axis through
    its head; call parents before children. Hips offset is in the character frame."""
    def __init__(s, sk):
        s.sk = sk; s.R = [r.copy() for r in sk.R]; s.T = [t.copy() for t in sk.T]
        s.WR, s.WT = sk.fk(s.R, s.T)
    def _refresh(s): s.WR, s.WT = s.sk.fk(s.R, s.T)
    def rot(s, name, axis, ang):
        if abs(ang) < 1e-9: return
        k = s.sk.id[name]; p = s.sk.parent[k]
        new_w = norm(qmul(qaxis(axis, ang), s.WR[k]))
        s.R[k] = new_w if p < 0 else norm(qmul(qinv(s.WR[p]), new_w))
        s._refresh()
    def set_world(s, name, wq):
        k = s.sk.id[name]; p = s.sk.parent[k]
        s.R[k] = wq if p < 0 else norm(qmul(qinv(s.WR[p]), wq)); s._refresh()
    def move_hips(s, d):
        k = s.sk.id['hips']; s.T[k] = s.sk.T[k] + np.asarray(d, float); s._refresh()
    def pos(s, name): return s.WT[s.sk.id[name]]
    def leg(s, side, ankle_target, foot_yaw=0.0, foot_pitch=0.0):
        """two-bone IK: thigh/shin aim at the target ankle, knee bends forward (+Z, turned with the foot yaw)."""
        sk = s.sk; th, sh, ft = sk.id['thigh.' + side], sk.id['shin.' + side], sk.id['foot.' + side]
        L1 = np.linalg.norm(sk.T[sh]); L2 = np.linalg.norm(sk.T[ft])
        H = s.WT[th]; A = np.asarray(ankle_target, float); d = A - H; D = np.linalg.norm(d)
        D = min(D, (L1 + L2) * 0.9995); dn = d / np.linalg.norm(d)
        pole = qrot(qaxis(Y, foot_yaw), Z); pole = pole - dn * np.dot(pole, dn); pole /= np.linalg.norm(pole)
        a = (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D); a = np.clip(a, -1, 1)
        K = H + dn * (L1 * a) + pole * (L1 * np.sqrt(1 - a * a))
        # thigh: rotate its current world frame so that +Y points to the knee
        for bone, tgt in ((th, K), (sh, H + dn * D)):
            cur = qrot(s.WR[bone], Y); want = (tgt - s.WT[bone]); want /= np.linalg.norm(want)
            s.set_world(sk.names[bone], norm(qmul(from_to(cur, want), s.WR[bone])))
        # foot: rest world orientation turned by yaw (and toe pitch), independent of the leg
        rest_wr, _ = sk.fk()
        wq = norm(qmul(qaxis(Y, foot_yaw), rest_wr[ft]))
        if abs(foot_pitch) > 1e-9:
            lat = qrot(qaxis(Y, foot_yaw), X); wq = norm(qmul(qaxis(lat, foot_pitch), wq))
        s.set_world(sk.names[ft], wq)

class Rig:
    """character helpers shared by all skills"""
    def __init__(s, sk):
        s.sk = sk; w, t = sk.fk(); s.rest_w = w; s.rest_t = t
        s.ank = {k: t[sk.id['foot.' + k]].copy() for k in 'LR'}
    def pose(s, *, hips=(0, 0, 0), yaw=0.0, pitch=0.0, roll=0.0, spine=(0, 0, 0), chest=(0, 0, 0), neck=(0, 0, 0), head=(0, 0, 0),
             armR=(0, 0, 0), elbowR=0.0, wristR=(0, 0, 0), armL=(0, 0, 0), elbowL=0.0, wristL=(0, 0, 0),
             footL=(0, 0, 0), footR=(0, 0, 0), footYaw=(0.0, 0.0), toe=(0.0, 0.0)):
        """yaw/pitch/roll: hips (whole upper body); spine/chest/neck/head: (pitch fwd+, yaw left+, roll); arms: (swing about X
        [-: forward/up], raise sideways about Z [+: away from body], twist about Y); elbow: bend (+ = forearm up);
        feet: ankle offsets in the character frame; legs solved by IK."""
        p = Pose(s.sk)
        p.move_hips(hips)
        p.rot('hips', Y, yaw); p.rot('hips', X, pitch); p.rot('hips', Z, roll)
        for b, (pt, yw, rl) in (('spine', spine), ('chest', chest), ('neck', neck), ('head', head)):
            p.rot(b, Y, yw); p.rot(b, X, pt); p.rot(b, Z, rl)
        for side, arm, elb, wr, sg in (('R', armR, elbowR, wristR, -1), ('L', armL, elbowL, wristL, +1)):
            ua, fa, hd = 'upper_arm.' + side, 'forearm.' + side, 'hand.' + side
            sw, rs, tw = arm
            p.rot(ua, Z, sg * rs); p.rot(ua, X, sw); p.rot(ua, Y, tw)
            ax = qrot(p.WR[p.sk.id[ua]], X)                       # elbow hinge = upper-arm lateral axis
            p.rot(fa, ax, -sg * elb if side == 'L' else elb)
            p.rot(hd, X, wr[0]); p.rot(hd, Y, wr[1]); p.rot(hd, Z, wr[2])
        for side, off, fy, tp in (('L', footL, footYaw[0], toe[0]), ('R', footR, footYaw[1], toe[1])):
            p.leg(side, s.ank[side] + np.asarray(off, float), fy, tp)
        return p

def mix(*parts):
    """sum dicts of pose params (tuples added element-wise)"""
    out = {}
    for d in parts:
        for k, v in d.items():
            if k not in out: out[k] = v; continue
            a = out[k]
            if isinstance(a, tuple): out[k] = tuple(x + y for x, y in zip(a, v))
            else: out[k] = a + v
    return out
def scale(d, k): return {kk: (tuple(x * k for x in v) if isinstance(v, tuple) else v * k) for kk, v in d.items()}

# guard stance shared by the sword skills (blade forward, weight low)
GUARD = dict(hips=(0, -0.025, 0), yaw=-0.12, spine=(0.06, 0, 0), chest=(0.04, 0.05, 0), head=(-0.04, 0.06, 0),
             armR=(-0.55, 0.15, 0.0), elbowR=0.55, armL=(-0.15, 0.25, 0), elbowL=0.45,
             footL=(0.015, 0, 0.045), footR=(-0.015, 0, -0.045), footYaw=(0.15, -0.35))

# ------------------------------------------------------------------ 1. 短劍三段連擊 Triple Slash (1.45 s)
def triple(t):
    g = ease(t, 0, 0.08) * (1 - ease(t, 1.25, 1.45))
    # slash 1: right -> left horizontal (wind 0.04-0.12, cut 0.12-0.22, hit 0.17)
    w1 = bump(t, 0.02, 0.16) ** 0.7 * (t < 0.12) + (t >= 0.12) * 0
    c1 = ease(t, 0.12, 0.22) * (1 - ease(t, 0.30, 0.40))
    # slash 2: low-left -> high-right rising backhand (hit 0.50)
    w2 = ease(t, 0.32, 0.42) * (1 - ease(t, 0.44, 0.52))
    c2 = ease(t, 0.44, 0.54) * (1 - ease(t, 0.66, 0.78))
    # slash 3: crouch + leaping spin-cut finisher, wave released at 0.92 (hit)
    w3 = ease(t, 0.68, 0.84) * (1 - ease(t, 0.86, 0.94))
    c3 = ease(t, 0.86, 0.98) * (1 - ease(t, 1.12, 1.40))
    hop = bump(t, 0.80, 1.02)
    base = scale(GUARD, g)
    a = dict(yaw=-0.45 * w1 + 0.55 * c1 * (1 - w2 - c2) + 0.35 * w2 - 0.55 * c2 - 0.7 * w3 + 0.65 * c3,
             chest=(0.08 * c1 + 0.05 * c3, -0.35 * w1 + 0.45 * c1 + 0.3 * w2 - 0.45 * c2 - 0.5 * w3 + 0.5 * c3, -0.08 * c2),
             spine=(0.05 * c1 + 0.1 * c3, -0.15 * w1 + 0.2 * c1 - 0.2 * c2 - 0.2 * w3 + 0.2 * c3, 0),
             head=(0.0, 0.25 * w1 - 0.25 * c1 - 0.2 * w2 + 0.2 * c2 + 0.3 * w3 - 0.3 * c3, 0),
             hips=(0, -0.03 * w1 - 0.04 * c1 - 0.02 * w2 - 0.05 * w3 + 0.04 * hop - 0.05 * c3 * (1 - hop), 0.02 * c1 + 0.03 * c3),
             armR=(-0.6 * w1 - 0.35 * c1 + 0.6 * w2 - 1.35 * c2 - 1.25 * w3 - 0.15 * c3,
                   0.95 * w1 - 0.25 * c1 + 0.20 * w2 + 0.65 * c2 + 0.55 * w3 + 0.75 * c3,
                   0.0),
             elbowR=0.35 * w1 - 0.35 * c1 + 0.2 * w2 - 0.4 * c2 + 0.3 * w3 - 0.4 * c3,
             wristR=(-0.3 * w1 + 0.2 * c1 + 0.4 * w2 - 0.3 * c2 - 0.4 * w3 + 0.5 * c3, 0.5 * w1 - 0.6 * c1, 0.0),
             armL=(-0.3 * c1 - 0.25 * c2 - 0.5 * c3, 0.55 * c1 + 0.45 * c2 + 0.75 * c3, 0), elbowL=0.3 * c1 + 0.2 * c3,
             footL=(0, 0.06 * hop, 0.07 * c1 + 0.06 * c3), footR=(0, 0.05 * hop, -0.02 * c2), toe=(0.0, -0.25 * c1 - 0.2 * c3))
    return mix(base, a)
def triple_root(t):
    fwd = 0.18 * ease(t, 0.10, 0.22) + 0.12 * ease(t, 0.42, 0.54) + 0.32 * ease(t, 0.82, 1.00)
    return fwd, 0.0
TRIPLE = dict(name='Skill_TripleSlash', dur=1.45, fn=triple, root=triple_root,
              marks=dict(hit1=0.17, hit2=0.50, hit3=0.92, trail1=(0.10, 0.26), trail2=(0.42, 0.58), trail3=(0.84, 1.04), wave=0.90))

# ------------------------------------------------------------------ 2. 法杖施法 Staff Cast (1.30 s) — magic bolt
def cast(t):
    g = ease(t, 0, 0.1) * (1 - ease(t, 1.1, 1.3))
    up = ease(t, 0.05, 0.35) * (1 - ease(t, 0.48, 0.58))          # raise staff, gather
    sw = bump(t, 0.15, 0.48)                                      # small swirl
    th = ease(t, 0.50, 0.60) * (1 - ease(t, 0.85, 1.15))          # thrust/release 0.58
    kick = damp(t, 0.58, f=6, k=10)
    a = dict(hips=(0, -0.02 * up - 0.03 * th, 0.015 * th), yaw=0.18 * up - 0.25 * th, pitch=-0.05 * up + 0.08 * th,
             spine=(-0.06 * up + 0.08 * th, 0.12 * up - 0.12 * th, 0), chest=(-0.08 * up + 0.10 * th - 0.04 * kick, 0.15 * up - 0.2 * th, 0.04 * sw),
             head=(-0.1 * up + 0.06 * th, -0.1 * up + 0.12 * th, 0),
             armR=(-0.9 * up - 1.25 * th + 0.08 * kick, 0.35 * up + 0.05 * th + 0.12 * sw, 0.2 * sw), elbowR=0.9 * up - 0.3 * th,
             wristR=(0.3 * up + 0.35 * th, 0.0, 0.0),
             armL=(-0.6 * up - 0.75 * th, 0.75 * up + 0.35 * th, 0), elbowL=0.8 * up + 0.2 * th, wristL=(0, 0, 0.2 * th),
             footL=(0.01, 0, 0.05 * th), footR=(-0.01, 0, -0.04 * th), footYaw=(0.1 * th, -0.25 * th), toe=(0.0, -0.18 * th))
    return scale(a, 1.0) if g > 0 else scale(a, 0.0)
CAST = dict(name='Skill_StaffCast', dur=1.30, fn=cast, root=lambda t: (0.0, 0.0),
            marks=dict(circle=0.05, gather=(0.12, 0.55), release=0.58))

# ------------------------------------------------------------------ 3. 跳躍重斬 Leap Slam (1.50 s)
def leap(t):
    cr = ease(t, 0.0, 0.22) * (1 - ease(t, 0.22, 0.32))           # crouch / load
    air = seg(t, 0.28, 0.80)                                      # in the air 0.28 -> 0.80
    hgt = np.sin(np.pi * air) ** 0.85 * (0.28 <= t <= 0.80)
    up = ease(t, 0.28, 0.55) * (1 - ease(t, 0.60, 0.80))          # sword raised overhead
    sl = ease(t, 0.62, 0.80) * (1 - ease(t, 1.05, 1.45))          # slam down; land + hit 0.80
    land = bump(t, 0.80, 1.05)
    a = dict(hips=(0, -0.09 * cr + 0.55 * hgt - 0.10 * land, 0.03 * sl), pitch=0.25 * cr - 0.18 * up + 0.38 * sl,
             spine=(0.15 * cr - 0.2 * up + 0.25 * sl, 0, 0), chest=(0.1 * cr - 0.25 * up + 0.2 * sl, 0, 0),
             head=(-0.2 * cr + 0.2 * up - 0.25 * sl, 0, 0),
             armR=(0.4 * cr - 2.25 * up - 1.15 * sl, 0.3 * cr + 0.25 * up + 0.05 * sl, 0), elbowR=0.3 * cr + 0.9 * up - 0.3 * sl,
             wristR=(0.4 * cr - 0.4 * up + 0.6 * sl, 0, 0),
             armL=(0.5 * cr - 1.9 * up - 0.6 * sl, 0.25 * up + 0.7 * sl, 0), elbowL=0.9 * up + 0.2 * sl,
             footL=(0.0, 0.45 * hgt * (1 - 0.2 * sl) + 0.0, 0.05 * sl), footR=(0.0, 0.42 * hgt, -0.03 * sl),
             toe=(0.3 * hgt, 0.3 * hgt))
    return a
def leap_root(t): return 1.2 * float(ss((t - 0.28) / 0.52)), 0.0
LEAP = dict(name='Skill_LeapSlam', dur=1.50, fn=leap, root=leap_root,
            marks=dict(takeoff=0.28, apex=0.54, hit=0.80, trail=(0.60, 0.84), land=0.80))

# ------------------------------------------------------------------ 4. 旋風斬 Whirlwind (1.60 s, two full turns)
def whirl(t):
    g = ease(t, 0.0, 0.18) * (1 - ease(t, 1.30, 1.60))
    ext = ease(t, 0.10, 0.30) * (1 - ease(t, 1.22, 1.45))         # arm extended, blade flat
    bob = np.sin(2 * np.pi * seg(t, 0.25, 1.25) * 2) * (0.25 < t < 1.25)
    a = dict(hips=(0, -0.05 * g + 0.012 * bob, 0), roll=0.06 * ext, pitch=0.06 * ext,
             spine=(0.06 * ext, -0.15 * ext, 0.05 * ext), chest=(0.04 * ext, -0.2 * ext, 0.06 * ext), head=(0.05 * ext, 0.25 * ext, -0.05 * ext),
             armR=(-0.55 * ext, 1.25 * ext, 0.0), elbowR=-0.1 * ext, wristR=(0.0, 0.0, -0.5 * ext),
             armL=(-0.2 * ext, 1.1 * ext, 0), elbowL=0.25 * ext,
             footL=(0.03 * g, 0.012 * max(0, bob), 0.02 * g), footR=(-0.03 * g, 0.012 * max(0, -bob), -0.02 * g),
             footYaw=(0.2 * g, -0.2 * g))
    return a
def whirl_root(t):
    yaw = 2 * 2 * np.pi * float(ss((t - 0.18) / 1.12))                 # two full turns
    return 0.25 * float(ss((t - 0.2) / 1.1)), yaw
WHIRL = dict(name='Skill_Whirlwind', dur=1.60, fn=whirl, root=whirl_root,
             marks=dict(hit1=0.48, hit2=0.76, hit3=1.04, trail=(0.22, 1.30)))

# ------------------------------------------------------------------ 5. 星隕術 Star Meteor — long-range magic (1.70 s)
def meteor(t):
    up = ease(t, 0.0, 0.40) * (1 - ease(t, 1.05, 1.45))           # staff held high, channel
    pt = ease(t, 0.55, 0.72) * (1 - ease(t, 1.20, 1.55))          # point the staff at the target, release 0.72
    ch = np.sin(2 * np.pi * 3 * t) * up * (t < 0.72)
    a = dict(hips=(0, -0.015 * up, 0), pitch=-0.08 * up + 0.06 * pt, yaw=0.1 * up - 0.12 * pt,
             spine=(-0.1 * up + 0.08 * pt, 0.1 * up - 0.12 * pt, 0), chest=(-0.12 * up + 0.08 * pt + 0.01 * ch, 0.08 * up - 0.12 * pt, 0),
             head=(-0.25 * up + 0.18 * pt, 0, 0),
             armR=(-2.2 * up + 0.95 * pt, 0.25 * up - 0.1 * pt, 0), elbowR=0.5 * up - 0.4 * pt, wristR=(-0.3 * up + 0.4 * pt, 0, 0),
             armL=(-0.5 * up - 0.6 * pt, 1.15 * up - 0.4 * pt, 0), elbowL=0.6 * up, wristL=(0, 0, 0.4 * up),
             footL=(0.01, 0, 0.03), footR=(-0.01, 0, -0.03 * pt), footYaw=(0.1, -0.2), toe=(0, -0.1 * pt))
    return a
METEOR = dict(name='Skill_StarMeteor', dur=1.70, fn=meteor, root=lambda t: (0.0, 0.0),
              marks=dict(circle=0.08, release=0.72, impact=1.20))

# ------------------------------------------------------------------ 6. 蓄力爆發 Charge Burst (2.10 s)
def charge(t):
    ch = ease(t, 0.0, 0.35) * (1 - ease(t, 1.05, 1.15))          # coil: sword low-back, deep stance
    trem = np.sin(2 * np.pi * 14 * t) * seg(t, 0.4, 1.1) * (t < 1.1)
    rel = ease(t, 1.10, 1.22) * (1 - ease(t, 1.55, 2.0))          # explosive rising slash, hit 1.22
    kick = damp(t, 1.22, f=7, k=7)
    a = dict(hips=(0, -0.085 * ch - 0.05 * rel + 0.004 * trem, -0.02 * ch + 0.05 * rel), yaw=-0.55 * ch + 0.45 * rel, pitch=0.18 * ch + 0.12 * rel,
             spine=(0.12 * ch + 0.06 * rel, -0.25 * ch + 0.3 * rel, 0), chest=(0.1 * ch - 0.12 * rel + 0.02 * kick, -0.35 * ch + 0.35 * rel, 0),
             head=(-0.15 * ch - 0.05 * rel, 0.45 * ch - 0.3 * rel, 0),
             armR=(0.35 * ch - 2.0 * rel, 0.55 * ch + 0.35 * rel, 0), elbowR=0.45 * ch + 0.15 * rel, wristR=(0.5 * ch - 0.4 * rel, 0.3 * ch, 0),
             armL=(-0.6 * ch + 0.2 * rel, 0.35 * ch + 0.9 * rel, 0), elbowL=0.7 * ch,
             footL=(0.03 * ch, 0, 0.09 * ch + 0.06 * rel), footR=(-0.03 * ch, 0, -0.07 * ch), footYaw=(0.25 * ch, -0.45 * ch), toe=(0, -0.3 * rel))
    return a
def charge_root(t): return 0.35 * float(ss((t - 1.08) / 0.16)), 0.0
CHARGE = dict(name='Skill_ChargeBurst', dur=2.10, fn=charge, root=charge_root,
              marks=dict(charge=(0.05, 1.10), release=1.10, hit=1.22, trail=(1.08, 1.32)))

SKILLS = [TRIPLE, CAST, LEAP, WHIRL, METEOR, CHARGE]

def bake(sk, S):
    rig = Rig(sk); n = int(round(S['dur'] * FPS)) + 1
    times = [round(i / FPS, 4) for i in range(n)]; times[-1] = S['dur']
    rq = {b: [] for b in sk.names}; hipT = []; root = []
    for t in times:
        p = rig.pose(**S['fn'](t))
        for k, b in enumerate(sk.names): rq[b].extend(np.round(p.R[k], 5).tolist())
        hipT.extend(np.round(p.T[sk.id['hips']], 5).tolist())
        f, y = S['root'](t); root.extend([round(float(f), 5), round(float(y), 5)])
    marks = {k: (list(v) if isinstance(v, tuple) else v) for k, v in S['marks'].items()}
    return dict(duration=S['dur'], fps=FPS, times=times, rotations=rq, hipsTranslation=hipT, rootMotion=root, marks=marks)

def check(sk, S):
    """report: lowest foot / leg straightness / hand height range, to catch broken poses"""
    rig = Rig(sk); lows = []; reach = []
    for t in np.linspace(0, S['dur'], 46):
        p = rig.pose(**S['fn'](t))
        for side in 'LR':
            H = p.pos('thigh.' + side); A = p.pos('foot.' + side)
            reach.append(np.linalg.norm(A - H) / (np.linalg.norm(sk.T[sk.id['shin.' + side]]) + np.linalg.norm(sk.T[sk.id['foot.' + side]])))
        lows.append(min(p.pos('foot.L')[1], p.pos('foot.R')[1]))
    return dict(minAnkleY=round(float(min(lows)), 3), maxLegReach=round(float(max(reach)), 3))

if __name__ == '__main__':
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    for g in ('male', 'female'):
        sk = Skel(os.path.join(MODELS, f'novice_c10b5b_{g}_lite.glb'))
        WR, WT = sk.fk(); k = sk.id['hand.R']
        D = np.array([-0.1, 0.25, 0.96]); D /= np.linalg.norm(D); E = Y - D * np.dot(Y, D); E /= np.linalg.norm(E)
        attach = dict(bone='hand.R', bladeDir=np.round(qrot(qinv(WR[k]), D), 4).tolist(), edgeUp=np.round(qrot(qinv(WR[k]), E), 4).tolist())
        data = dict(format='starwish.combat-anim/1', skeleton='novice-c10b5b', gender=g, joints=sk.names, frame='glTF (+Y up, +Z forward)', weaponAttach=attach,
                    clips={S['name']: bake(sk, S) for S in SKILLS})
        p = f'{out}/novice_combat_{g}.json'
        open(p, 'w').write(json.dumps(data, separators=(',', ':')))
        print(g, os.path.getsize(p), {S['name']: check(sk, S) for S in SKILLS})
