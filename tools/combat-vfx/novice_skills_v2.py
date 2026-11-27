"""Combat VFX Lab Stage 2 — V2 skill animations for the accepted C1.0-B5b novice (17 joints).

What changed from V1 (novice_skills.py), per the Stage 2 brief:
- KEY POSES instead of a few sine curves: every skill is authored as anticipation -> action -> contact ->
  follow-through -> recovery keys, interpolated with a monotone cubic (PCHIP: no overshoot, natural ease at extremes).
- OVERLAP: hips lead, chest follows ~2 frames later, head / off-hand ~3-4 frames later (waist and shoulder twist,
  follow-through). The weapon arm is evaluated without lag so the contact frame stays on the timing mark.
- WEIGHT SHIFT: hips translate over the supporting foot and roll with it; knees load before every big action.
- FOOTWORK: feet are PLANTS in world-forward coordinates. A step lifts the foot along an arc; a planted foot is
  compensated against the root motion, so it never slides while the body lunges forward.
- The leap uses the same plants (take-off plant -> landing plant), the body arc is in the hips translation.
Output format is unchanged (starwish.combat-anim/1), so the lab and Claude A's integration read it the same way.
usage: python3 novice_skills_v2.py <out_dir>"""
import json, sys, os
import numpy as np
from scipy.interpolate import PchipInterpolator
import novice_skills as V1
from novice_skills import Rig, MODELS, X, Y, Z, FPS, ss
from glbio import Skel, qrot, qinv, qaxis

ZERO = dict(hips=(0.0, 0.0, 0.0), yaw=0.0, pitch=0.0, roll=0.0, spine=(0.0, 0.0, 0.0), chest=(0.0, 0.0, 0.0),
            neck=(0.0, 0.0, 0.0), head=(0.0, 0.0, 0.0), armR=(0.0, 0.0, 0.0), elbowR=0.0, wristR=(0.0, 0.0, 0.0),
            armL=(0.0, 0.0, 0.0), elbowL=0.0, wristL=(0.0, 0.0, 0.0), footYaw=(0.0, 0.0), toe=(0.0, 0.0))
# overlap (seconds of lag) per parameter group; weapon arm = 0 so contact frames stay on the marks
LAG = dict(hips=0.0, yaw=0.0, pitch=0.0, roll=0.0, spine=0.012, chest=0.035, neck=0.06, head=0.075,
           armR=0.0, elbowR=0.0, wristR=-0.01, armL=0.055, elbowL=0.07, wristL=0.08, footYaw=0.0, toe=0.0)

def _vec(v): return np.atleast_1d(np.asarray(v, float))

class Keys:
    """key poses -> smooth parameter curves (PCHIP per component), with per-group overlap lag"""
    def __init__(s, keys, base=None):
        base = dict(ZERO, **(base or {}))
        s.t = np.array([k[0] for k in keys], float)
        s.f = {}
        for name, z in base.items():
            vals = np.array([_vec(dict(base, **k[1]).get(name, z)) for k in keys])
            s.f[name] = PchipInterpolator(s.t, vals, axis=0, extrapolate=False)
        s.t0, s.t1 = s.t[0], s.t[-1]
    def __call__(s, t, lag=True):
        out = {}
        for name, f in s.f.items():
            tt = float(np.clip(t - (LAG.get(name, 0.0) if lag else 0.0), s.t0, s.t1))
            v = f(tt)
            out[name] = tuple(float(x) for x in v) if len(v) > 1 else float(v[0])
        return out

class Feet:
    """plants per foot in WORLD-forward coordinates (x left, y up, z forward from the clip start).
    steps: [(t0, t1, (x, y, z), lift)] ; between steps the foot stays planted (compensated against root motion)."""
    def __init__(s, start, steps, arc=1.0):
        s.start = {k: np.asarray(v, float) for k, v in start.items()}; s.steps = steps; s.arc = arc
    def at(s, side, t):
        p = s.start[side].copy()
        for (t0, t1, q, lift) in s.steps[side]:
            q = np.asarray(q, float)
            if t >= t1: p = q.copy(); continue
            if t <= t0: break
            u = ss((t - t0) / (t1 - t0)); a = (t - t0) / (t1 - t0)
            out = p + (q - p) * u
            out[1] += lift * np.sin(np.pi * a) ** s.arc
            return out
        return p

def RootCurve(keys):
    t = np.array([k[0] for k in keys], float); v = np.array([[k[1], k[2] if len(k) > 2 else 0.0] for k in keys], float)
    f = PchipInterpolator(t, v, axis=0, extrapolate=False)
    def root(tt):
        r = f(float(np.clip(tt, t[0], t[-1]))); return float(r[0]), float(r[1])
    return root

def make(keys, feet, root, base=None, comp=True, extra=None):
    K = Keys(keys, base)
    def fn(t):
        p = K(t)
        fwd, yaw = root(t)
        for side, name in (('L', 'footL'), ('R', 'footR')):
            w = feet.at(side, t)
            p[name] = (w[0], w[1], w[2] - (fwd if comp else 0.0))
        if extra: p = extra(t, p)
        return p
    return fn

# ---------------------------------------------------------------- shared stances (offsets from the bind ankles)
SW_FEET = {'L': (0.012, 0.0, 0.075), 'R': (-0.012, 0.0, -0.075)}          # sword guard: left foot forward
GUARD = dict(hips=(0.0, -0.035, 0.0), yaw=-0.15, spine=(0.06, -0.03, 0.0), chest=(0.05, -0.05, 0.0), head=(-0.05, 0.16, 0.0),
             armR=(-0.62, 0.18, 0.0), elbowR=0.6, wristR=(-0.1, 0.0, 0.0), armL=(-0.2, 0.28, 0.0), elbowL=0.5, footYaw=(0.15, -0.4))
def G(**kw):
    d = dict(GUARD); d.update(kw); return d
ST_FEET = {'L': (0.02, 0.0, 0.04), 'R': (-0.02, 0.0, -0.05)}              # caster stance
CAST0 = dict(hips=(0.0, -0.02, 0.0), yaw=-0.08, spine=(0.02, 0, 0), chest=(0.0, -0.04, 0), head=(-0.03, 0.08, 0),
             armR=(-0.35, 0.2, 0.0), elbowR=0.7, wristR=(0.15, 0, 0), armL=(-0.1, 0.25, 0), elbowL=0.35, footYaw=(0.1, -0.25))
def C(**kw):
    d = dict(CAST0); d.update(kw); return d

# ================================================================ 1. 短劍三連斬 Triple Slash (1.50 s)
# slash 1: horizontal R->L with a lead step (hit 0.17) | slash 2: rising backhand L-low -> R-high with a cross step
# (hit 0.50) | slash 3: deep coil, hop-in spinning finisher + sword wave (hit 0.92), wide landing, hold, recover.
TRIPLE_KEYS = [
    (0.00, G()),
    (0.07, G(hips=(-0.025, -0.06, -0.02), yaw=-0.55, roll=-0.04, spine=(0.04, -0.15, 0), chest=(0.02, -0.38, 0.04), head=(-0.04, 0.42, 0),
             armR=(-1.05, 1.05, 0.15), elbowR=0.95, wristR=(-0.55, 0.55, 0.0), armL=(-0.55, 0.15, 0), elbowL=0.6)),          # wind-up 1
    (0.13, G(hips=(0.0, -0.065, 0.02), yaw=-0.25, spine=(0.08, -0.05, 0), chest=(0.06, -0.1, 0),
             armR=(-0.95, 0.75, 0.05), elbowR=0.55, wristR=(-0.35, 0.35, 0.0), armL=(-0.35, 0.35, 0))),                     # drive
    (0.17, G(hips=(0.03, -0.07, 0.05), yaw=0.32, roll=0.05, spine=(0.1, 0.12, 0), chest=(0.1, 0.3, -0.04), head=(-0.02, -0.12, 0),
             armR=(-0.72, -0.05, 0.0), elbowR=0.12, wristR=(0.05, -0.35, 0.0), armL=(-0.1, 0.75, 0), elbowL=0.35)),         # HIT 1
    (0.27, G(hips=(0.035, -0.06, 0.05), yaw=0.52, roll=0.06, spine=(0.1, 0.2, 0), chest=(0.12, 0.5, -0.06), head=(-0.02, -0.25, 0),
             armR=(-0.35, -0.35, -0.2), elbowR=0.3, wristR=(0.25, -0.5, 0.0), armL=(0.1, 0.85, 0), elbowL=0.4)),            # follow-through
    (0.38, G(hips=(0.02, -0.085, 0.03), yaw=0.42, roll=0.03, spine=(0.12, 0.15, 0), chest=(0.12, 0.35, 0.05), head=(0.0, -0.15, 0),
             armR=(0.2, -0.15, -0.45), elbowR=0.35, wristR=(0.55, -0.2, 0.3), armL=(-0.25, 0.6, 0), elbowL=0.5)),          # low-left load (wind-up 2)
    (0.50, G(hips=(-0.02, -0.045, 0.06), yaw=-0.3, roll=-0.04, spine=(0.0, -0.15, 0), chest=(-0.06, -0.42, -0.06), head=(-0.06, 0.25, 0),
             armR=(-1.45, 0.7, 0.2), elbowR=0.25, wristR=(-0.35, 0.15, -0.25), armL=(-0.1, 0.55, 0), elbowL=0.4)),          # HIT 2 (rising)
    (0.60, G(hips=(-0.025, -0.02, 0.05), yaw=-0.45, roll=-0.05, spine=(-0.04, -0.2, 0), chest=(-0.1, -0.55, -0.08), head=(-0.1, 0.3, 0),
             armR=(-1.85, 0.85, 0.25), elbowR=0.35, wristR=(-0.5, 0.15, -0.3), armL=(0.15, 0.6, 0), elbowL=0.45)),          # follow-through high
    (0.74, G(hips=(-0.03, -0.12, -0.03), yaw=-0.85, pitch=0.12, roll=-0.06, spine=(0.12, -0.25, 0), chest=(0.08, -0.5, 0.06), head=(-0.08, 0.55, 0),
             armR=(0.35, 0.75, 0.1), elbowR=0.6, wristR=(0.35, 0.4, 0.0), armL=(-0.9, 0.25, 0), elbowL=0.3)),               # deep coil (wind-up 3)
    (0.84, G(hips=(0.0, 0.02, 0.04), yaw=-0.35, pitch=0.05, spine=(0.06, -0.1, 0), chest=(0.04, -0.2, 0.0), head=(-0.05, 0.3, 0),
             armR=(-0.4, 1.25, 0.0), elbowR=0.25, wristR=(-0.1, 0.45, 0.0), armL=(-0.6, 0.6, 0), elbowL=0.25)),              # launch (hop)
    (0.92, G(hips=(0.02, -0.02, 0.06), yaw=0.45, roll=0.06, spine=(0.08, 0.2, 0), chest=(0.06, 0.45, -0.05), head=(-0.04, -0.2, 0),
             armR=(-0.85, 0.35, 0.0), elbowR=0.05, wristR=(0.1, -0.3, 0.0), armL=(0.2, 1.0, 0), elbowL=0.2)),               # HIT 3 (spin cut)
    (1.02, G(hips=(0.03, -0.13, 0.05), yaw=0.85, pitch=0.1, roll=0.08, spine=(0.12, 0.3, 0), chest=(0.12, 0.65, -0.08), head=(0.0, -0.45, 0),
             armR=(-0.55, -0.45, -0.25), elbowR=0.1, wristR=(0.35, -0.6, 0.0), armL=(0.35, 1.15, 0), elbowL=0.25)),         # land, heavy follow-through
    (1.18, G(hips=(0.025, -0.12, 0.04), yaw=0.8, pitch=0.08, roll=0.06, spine=(0.1, 0.28, 0), chest=(0.1, 0.6, -0.06), head=(0.0, -0.4, 0),
             armR=(-0.5, -0.4, -0.25), elbowR=0.12, wristR=(0.3, -0.55, 0.0), armL=(0.3, 1.1, 0), elbowL=0.3)),             # zanshin hold
    (1.50, G()),
]
TRIPLE_FEET = Feet(SW_FEET, {
    'L': [(0.09, 0.15, (0.02, 0.0, 0.25), 0.05), (0.80, 0.97, (0.11, 0.0, 0.62), 0.10), (1.25, 1.45, (0.012, 0.0, 0.555 + 0.075), 0.03)],
    'R': [(0.40, 0.52, (-0.03, 0.0, 0.33), 0.06), (0.82, 0.99, (-0.12, 0.0, 0.44), 0.09), (1.28, 1.48, (-0.012, 0.0, 0.555 - 0.075), 0.03)],
})
TRIPLE_ROOT = RootCurve([(0.0, 0.0), (0.09, 0.0), (0.18, 0.16), (0.40, 0.16), (0.52, 0.27), (0.80, 0.27), (0.98, 0.555), (1.5, 0.555)])
def triple_extra(t, p):                     # the hop of the finisher: body rises with the feet off the ground
    hop = np.sin(np.pi * np.clip((t - 0.82) / 0.16, 0, 1)) ** 1.2 if 0.82 < t < 0.98 else 0.0
    h = p['hips']; p['hips'] = (h[0], h[1] + 0.07 * hop, h[2]); return p
TRIPLE = dict(name='Skill_TripleSlash', dur=1.50, fn=make(TRIPLE_KEYS, TRIPLE_FEET, TRIPLE_ROOT, extra=triple_extra), root=TRIPLE_ROOT,
              marks=dict(hit1=0.17, hit2=0.50, hit3=0.92, trail1=(0.10, 0.27), trail2=(0.40, 0.60), trail3=(0.82, 1.04), wave=0.90))

# ================================================================ 2. 法杖魔法彈 Staff Cast (1.30 s) — release 0.58
CAST_KEYS = [
    (0.00, C()),
    (0.08, C(hips=(-0.02, -0.04, -0.03), yaw=0.15, pitch=-0.04, spine=(-0.04, 0.1, 0), chest=(-0.06, 0.15, 0), head=(-0.05, -0.05, 0),
             armR=(-0.85, 0.45, 0.2), elbowR=1.05, wristR=(0.3, 0, 0.1), armL=(-0.75, 0.55, 0), elbowL=0.9)),                # draw staff up, weight back
    (0.30, C(hips=(-0.01, -0.025, -0.02), yaw=0.22, pitch=-0.07, roll=0.02, spine=(-0.08, 0.14, 0.03), chest=(-0.1, 0.2, 0.05), head=(-0.1, -0.1, 0),
             armR=(-1.35, 0.5, 0.35), elbowR=1.05, wristR=(0.4, 0, 0.2), armL=(-1.05, 0.75, 0), elbowL=0.75, wristL=(0, 0, 0.3))),  # gather (high)
    (0.46, C(hips=(-0.035, -0.06, -0.05), yaw=0.35, pitch=-0.1, roll=-0.03, spine=(-0.1, 0.2, -0.03), chest=(-0.14, 0.28, -0.04), head=(-0.08, -0.18, 0),
             armR=(-1.75, 0.7, 0.4), elbowR=1.2, wristR=(0.55, 0, 0.25), armL=(-0.5, 0.95, 0), elbowL=0.55)),               # anticipation: pull back
    (0.58, C(hips=(0.025, -0.055, 0.06), yaw=-0.22, pitch=0.1, roll=0.04, spine=(0.1, -0.12, 0), chest=(0.12, -0.22, 0.03), head=(0.06, 0.12, 0),
             armR=(-1.55, 0.05, 0.0), elbowR=0.05, wristR=(0.4, 0, 0.0), armL=(0.25, 0.65, 0), elbowL=0.35, toe=(0.0, -0.2))),  # RELEASE (thrust)
    (0.68, C(hips=(0.02, -0.06, 0.05), yaw=-0.18, pitch=0.06, spine=(0.06, -0.1, 0), chest=(0.04, -0.18, 0.0), head=(0.04, 0.1, 0),
             armR=(-1.4, 0.08, 0.0), elbowR=0.18, wristR=(0.25, 0, 0.0), armL=(0.3, 0.6, 0), elbowL=0.4)),                  # recoil
    (0.95, C(hips=(0.015, -0.04, 0.04), yaw=-0.12, spine=(0.04, -0.06, 0), chest=(0.02, -0.12, 0), head=(0.0, 0.08, 0),
             armR=(-1.2, 0.12, 0.0), elbowR=0.3, wristR=(0.2, 0, 0.0), armL=(0.1, 0.4, 0), elbowL=0.4)),                    # follow-through hold
    (1.30, C()),
]
CAST_FEET = Feet(ST_FEET, {
    'R': [(0.02, 0.10, (-0.03, 0.0, -0.10), 0.03)],
    'L': [(0.50, 0.58, (0.03, 0.0, 0.14), 0.045), (1.05, 1.28, (0.02, 0.0, 0.04), 0.02)],
})
CAST_ROOT = RootCurve([(0.0, 0.0), (1.3, 0.0)])
CAST = dict(name='Skill_StaffCast', dur=1.30, fn=make(CAST_KEYS, CAST_FEET, CAST_ROOT, base=CAST0), root=CAST_ROOT,
            marks=dict(circle=0.05, gather=(0.12, 0.55), release=0.58))

# ================================================================ 3. 跳躍重斬 Leap Slam (1.50 s) — take-off 0.28, land+hit 0.80
LEAP_KEYS = [
    (0.00, G()),
    (0.20, G(hips=(0.0, -0.15, -0.04), yaw=-0.05, pitch=0.38, spine=(0.2, 0, 0), chest=(0.14, 0, 0), head=(-0.3, 0.05, 0),
             armR=(0.75, 0.25, 0.0), elbowR=0.3, wristR=(0.3, 0, 0), armL=(0.8, 0.25, 0), elbowL=0.25, toe=(0.0, 0.0))),     # load: crouch, arms back
    (0.30, G(hips=(0.0, 0.05, 0.03), yaw=0.0, pitch=0.05, spine=(0.0, 0, 0), chest=(-0.08, 0, 0), head=(-0.05, 0, 0),
             armR=(-1.6, 0.25, 0.0), elbowR=0.4, wristR=(-0.2, 0, 0), armL=(-1.5, 0.25, 0), elbowL=0.4, toe=(0.35, 0.35))),   # take-off: arms drive up
    (0.52, G(hips=(0.0, 0.02, 0.0), yaw=0.0, pitch=-0.22, spine=(-0.2, 0, 0), chest=(-0.25, 0, 0), head=(0.1, 0, 0),
             armR=(-2.55, 0.2, 0.0), elbowR=1.25, wristR=(-0.6, 0, 0), armL=(-2.35, 0.25, 0), elbowL=1.1, toe=(0.3, 0.3))),  # apex: overhead, back arched
    (0.68, G(hips=(0.0, 0.0, 0.02), yaw=0.0, pitch=0.15, spine=(0.12, 0, 0), chest=(0.1, 0, 0), head=(-0.1, 0, 0),
             armR=(-1.9, 0.12, 0.0), elbowR=0.55, wristR=(0.1, 0, 0), armL=(-1.6, 0.35, 0), elbowL=0.5, toe=(0.15, 0.15))),  # chop begins
    (0.80, G(hips=(0.0, -0.17, 0.06), yaw=0.0, pitch=0.55, spine=(0.3, 0, 0), chest=(0.22, 0, 0), head=(-0.35, 0, 0),
             armR=(-0.75, 0.05, 0.0), elbowR=0.0, wristR=(0.75, 0, 0), armL=(-0.35, 0.65, 0), elbowL=0.25)),                 # LAND + HIT
    (0.95, G(hips=(0.0, -0.14, 0.05), yaw=0.0, pitch=0.48, spine=(0.26, 0, 0), chest=(0.2, 0, 0), head=(-0.3, 0, 0),
             armR=(-0.7, 0.05, 0.0), elbowR=0.05, wristR=(0.7, 0, 0), armL=(-0.25, 0.75, 0), elbowL=0.3)),                   # settle
    (1.15, G(hips=(0.0, -0.09, 0.03), pitch=0.25, spine=(0.15, 0, 0), chest=(0.1, 0, 0), head=(-0.15, 0.05, 0),
             armR=(-0.65, 0.12, 0.0), elbowR=0.35, wristR=(0.3, 0, 0), armL=(-0.25, 0.4, 0), elbowL=0.4)),
    (1.50, G()),
]
LEAP_FEET = Feet(SW_FEET, {
    'L': [(0.27, 0.79, (0.06, 0.0, 1.2 + 0.13), 0.36)],
    'R': [(0.29, 0.81, (-0.07, 0.0, 1.2 - 0.10), 0.34), (1.15, 1.45, (-0.012, 0.0, 1.2 - 0.075), 0.03)],
}, arc=0.85)
LEAP_ROOT = RootCurve([(0.0, 0.0), (0.27, 0.0), (0.54, 0.62), (0.80, 1.2), (1.5, 1.2)])
def leap_extra(t, p):
    air = np.clip((t - 0.28) / 0.52, 0, 1)
    hgt = np.sin(np.pi * air) ** 0.85 if 0.28 < t < 0.80 else 0.0
    h = p['hips']; p['hips'] = (h[0], h[1] + 0.48 * hgt, h[2]); return p
LEAP = dict(name='Skill_LeapSlam', dur=1.50, fn=make(LEAP_KEYS, LEAP_FEET, LEAP_ROOT, extra=leap_extra), root=LEAP_ROOT,
            marks=dict(takeoff=0.28, apex=0.54, hit=0.80, trail=(0.60, 0.84), land=0.80))

# ================================================================ 4. 旋風斬 Whirlwind (1.60 s, two turns, hits 0.48 / 0.76 / 1.04)
WHIRL_KEYS = [
    (0.00, G()),
    (0.16, G(hips=(0.02, -0.1, -0.02), yaw=0.65, roll=0.04, spine=(0.1, 0.25, 0), chest=(0.08, 0.45, 0.05), head=(-0.05, -0.35, 0),
             armR=(-0.35, -0.25, -0.35), elbowR=0.75, wristR=(0.45, -0.4, 0.3), armL=(-0.6, 0.2, 0), elbowL=0.8)),           # coil left (anticipation)
    (0.30, G(hips=(0.0, -0.07, 0.0), yaw=-0.15, roll=-0.1, pitch=0.08, spine=(0.06, -0.15, -0.05), chest=(0.04, -0.25, -0.06), head=(0.05, 0.3, 0.05),
             armR=(-0.6, 1.35, 0.0), elbowR=-0.05, wristR=(0.0, 0.0, -0.55), armL=(-0.25, 1.15, 0), elbowL=0.2)),            # unwind, blade flat out
    (1.20, G(hips=(0.0, -0.07, 0.0), yaw=-0.15, roll=-0.12, pitch=0.08, spine=(0.06, -0.15, -0.06), chest=(0.04, -0.25, -0.07), head=(0.05, 0.32, 0.05),
             armR=(-0.6, 1.35, 0.0), elbowR=-0.05, wristR=(0.0, 0.0, -0.55), armL=(-0.25, 1.15, 0), elbowL=0.2)),
    (1.36, G(hips=(-0.02, -0.11, 0.02), yaw=-0.6, roll=-0.06, pitch=0.12, spine=(0.1, -0.2, 0), chest=(0.08, -0.4, -0.04), head=(-0.02, 0.45, 0),
             armR=(-0.75, 0.6, 0.0), elbowR=0.15, wristR=(0.1, 0.3, -0.2), armL=(0.15, 0.8, 0), elbowL=0.3)),                # brake: overshoot past the target
    (1.60, G()),
]
def whirl_root_f():
    rc = RootCurve([(0.0, 0.0, 0.0), (0.18, 0.0, 0.0), (0.25, 0.01, 0.45), (1.25, 0.24, 2 * 2 * np.pi - 0.4), (1.38, 0.25, 4 * np.pi), (1.6, 0.25, 4 * np.pi)])
    return rc
WHIRL_ROOT = whirl_root_f()
def whirl_extra(t, p):
    # pivot steps: each half turn the feet shuffle (small lifts), body bobs and leans into the spin
    if 0.25 < t < 1.3:
        ph = (t - 0.25) / 1.05 * 4.0
        bob = np.sin(np.pi * 2 * ph)
        for side, s0 in (('footL', 0.0), ('footR', 0.5)):
            f = p[side]; lift = max(0.0, np.sin(np.pi * 2 * (ph + s0))) ** 2 * 0.035
            p[side] = (f[0], f[1] + lift, f[2])
        h = p['hips']; p['hips'] = (h[0], h[1] + 0.012 * bob, h[2])
    return p
WHIRL_FEET = Feet({'L': (0.03, 0.0, 0.025), 'R': (-0.03, 0.0, -0.025)}, {'L': [(1.4, 1.58, (0.012, 0.0, 0.075), 0.02)], 'R': [(1.42, 1.6, (-0.012, 0.0, -0.075), 0.02)]})
WHIRL = dict(name='Skill_Whirlwind', dur=1.60, fn=make(WHIRL_KEYS, WHIRL_FEET, WHIRL_ROOT, comp=False, extra=whirl_extra), root=WHIRL_ROOT,
             marks=dict(hit1=0.48, hit2=0.76, hit3=1.04, trail=(0.22, 1.30)))

# ================================================================ 5. 星隕魔法 Star Meteor (1.70 s) — release 0.72, impact 1.20
METEOR_KEYS = [
    (0.00, C()),
    (0.12, C(hips=(-0.02, -0.06, -0.02), yaw=0.1, pitch=0.06, spine=(0.06, 0.05, 0), chest=(0.06, 0.1, 0), head=(0.05, -0.05, 0),
             armR=(-0.3, 0.45, 0.2), elbowR=1.1, wristR=(0.3, 0, 0.2), armL=(-0.2, 0.55, 0), elbowL=0.9)),                   # gather low (anticipation)
    (0.40, C(hips=(0.0, 0.0, 0.0), yaw=0.05, pitch=-0.14, spine=(-0.12, 0.05, 0), chest=(-0.16, 0.08, 0), head=(-0.3, 0, 0),
             armR=(-2.45, 0.3, 0.0), elbowR=0.35, wristR=(-0.3, 0, 0), armL=(-2.2, 0.55, 0), elbowL=0.4, toe=(0.12, 0.12))),  # staff up to the sky
    (0.58, C(hips=(0.0, 0.005, -0.02), yaw=0.12, pitch=-0.2, roll=0.03, spine=(-0.15, 0.1, 0.02), chest=(-0.2, 0.14, 0.03), head=(-0.32, -0.05, 0),
             armR=(-2.75, 0.25, 0.2), elbowR=0.5, wristR=(-0.5, 0, 0), armL=(-2.4, 0.7, 0), elbowL=0.45, toe=(0.15, 0.15))),  # channel peak / pull back
    (0.72, C(hips=(0.025, -0.07, 0.07), yaw=-0.15, pitch=0.14, spine=(0.12, -0.08, 0), chest=(0.14, -0.14, 0), head=(0.1, 0.08, 0),
             armR=(-1.35, 0.1, 0.0), elbowR=0.05, wristR=(0.45, 0, 0), armL=(0.2, 0.75, 0), elbowL=0.3, toe=(0.0, -0.2))),   # RELEASE: point at target
    (1.05, C(hips=(0.02, -0.06, 0.06), yaw=-0.12, pitch=0.1, spine=(0.1, -0.06, 0), chest=(0.1, -0.12, 0), head=(0.06, 0.08, 0),
             armR=(-1.3, 0.12, 0.0), elbowR=0.1, wristR=(0.4, 0, 0), armL=(0.15, 0.7, 0), elbowL=0.35)),                     # hold while it falls
    (1.22, C(hips=(-0.01, -0.045, 0.02), yaw=-0.05, pitch=-0.06, spine=(-0.06, -0.02, 0), chest=(-0.1, -0.05, 0), head=(-0.12, 0.05, 0),
             armR=(-1.0, 0.2, 0.0), elbowR=0.4, wristR=(0.2, 0, 0), armL=(-0.3, 0.5, 0), elbowL=0.7)),                       # impact shock: lean back
    (1.70, C()),
]
METEOR_FEET = Feet(ST_FEET, {'R': [(0.04, 0.14, (-0.08, 0.0, -0.08), 0.03)], 'L': [(0.62, 0.72, (0.04, 0.0, 0.16), 0.05), (1.35, 1.65, (0.02, 0.0, 0.04), 0.02)]})
METEOR_ROOT = RootCurve([(0.0, 0.0), (1.7, 0.0)])
METEOR = dict(name='Skill_StarMeteor', dur=1.70, fn=make(METEOR_KEYS, METEOR_FEET, METEOR_ROOT, base=CAST0), root=METEOR_ROOT,
              marks=dict(circle=0.08, release=0.72, impact=1.20))

# ================================================================ 6. 蓄力爆發 Charge Burst (2.10 s) — release 1.10, hit 1.22
CHARGE_KEYS = [
    (0.00, G()),
    (0.32, G(hips=(-0.04, -0.12, -0.04), yaw=-0.75, pitch=0.2, roll=-0.05, spine=(0.14, -0.3, 0), chest=(0.1, -0.45, 0.04), head=(-0.12, 0.65, 0),
             armR=(0.45, 0.6, 0.1), elbowR=0.5, wristR=(0.5, 0.35, 0), armL=(-1.25, 0.35, 0), elbowL=0.15)),                 # coil: blade low behind, left hand aims
    (1.02, G(hips=(-0.045, -0.13, -0.045), yaw=-0.8, pitch=0.22, roll=-0.05, spine=(0.15, -0.32, 0), chest=(0.11, -0.48, 0.04), head=(-0.12, 0.68, 0),
             armR=(0.5, 0.62, 0.1), elbowR=0.52, wristR=(0.55, 0.38, 0), armL=(-1.3, 0.38, 0), elbowL=0.12)),
    (1.08, G(hips=(-0.05, -0.15, -0.05), yaw=-0.85, pitch=0.26, roll=-0.06, spine=(0.16, -0.34, 0), chest=(0.12, -0.5, 0.04), head=(-0.12, 0.7, 0),
             armR=(0.55, 0.65, 0.1), elbowR=0.55, wristR=(0.6, 0.4, 0), armL=(-1.1, 0.3, 0), elbowL=0.2)),                   # last sink
    (1.16, G(hips=(0.02, -0.08, 0.08), yaw=-0.1, pitch=0.15, spine=(0.08, -0.05, 0), chest=(0.04, -0.12, 0.0), head=(-0.06, 0.25, 0),
             armR=(-0.6, 0.9, 0.0), elbowR=0.15, wristR=(0.0, 0.3, 0), armL=(-0.2, 0.8, 0), elbowL=0.3)),                   # explode forward
    (1.22, G(hips=(0.04, -0.05, 0.1), yaw=0.45, pitch=0.05, roll=0.05, spine=(0.0, 0.18, 0), chest=(-0.08, 0.38, -0.06), head=(-0.05, -0.2, 0),
             armR=(-1.85, 0.75, 0.1), elbowR=0.05, wristR=(-0.3, -0.25, -0.2), armL=(0.3, 1.1, 0), elbowL=0.25, toe=(0.0, -0.3))),  # HIT: rising cut
    (1.36, G(hips=(0.04, -0.03, 0.09), yaw=0.65, pitch=-0.02, roll=0.06, spine=(-0.06, 0.22, 0), chest=(-0.14, 0.5, -0.08), head=(-0.1, -0.3, 0),
             armR=(-2.35, 0.65, 0.15), elbowR=0.2, wristR=(-0.45, -0.3, -0.25), armL=(0.45, 1.2, 0), elbowL=0.25)),          # follow-through high
    (1.62, G(hips=(0.03, -0.08, 0.06), yaw=0.4, pitch=0.06, spine=(0.04, 0.12, 0), chest=(0.02, 0.25, -0.04), head=(-0.04, -0.15, 0),
             armR=(-1.2, 0.45, 0.05), elbowR=0.4, wristR=(-0.1, -0.1, 0), armL=(0.1, 0.7, 0), elbowL=0.35)),
    (2.10, G()),
]
CHARGE_FEET = Feet(SW_FEET, {
    'L': [(0.04, 0.24, (0.05, 0.0, 0.16), 0.04), (1.09, 1.21, (0.05, 0.0, 0.78), 0.07), (1.65, 2.0, (0.012, 0.0, 0.6 + 0.075), 0.03)],
    'R': [(0.06, 0.26, (-0.06, 0.0, -0.14), 0.03), (1.13, 1.30, (-0.05, 0.0, 0.42), 0.06), (1.7, 2.05, (-0.012, 0.0, 0.6 - 0.075), 0.03)],
})
CHARGE_ROOT = RootCurve([(0.0, 0.0), (1.08, 0.0), (1.24, 0.5), (1.40, 0.6), (2.1, 0.6)])
def charge_extra(t, p):            # charging tremble (small, high frequency) only while holding
    if 0.4 < t < 1.08:
        tr = np.sin(2 * np.pi * 13 * t) * min(1.0, (t - 0.4) / 0.4)
        h = p['hips']; p['hips'] = (h[0] + 0.0025 * tr, h[1] + 0.002 * np.sin(2 * np.pi * 9 * t), h[2])
        c = p['chest']; p['chest'] = (c[0] + 0.01 * tr, c[1], c[2])
    return p
CHARGE = dict(name='Skill_ChargeBurst', dur=2.10, fn=make(CHARGE_KEYS, CHARGE_FEET, CHARGE_ROOT, extra=charge_extra), root=CHARGE_ROOT,
              marks=dict(charge=(0.05, 1.10), release=1.10, hit=1.22, trail=(1.08, 1.32)))

SKILLS = [TRIPLE, CAST, LEAP, WHIRL, METEOR, CHARGE]

def foot_slide(sk, S, comp=True):
    """world-space drift of each planted ankle (should be ~0 except during steps)"""
    rig = Rig(sk); out = {}
    ts = np.linspace(0, S['dur'], int(S['dur'] * 120) + 1); prev = None; worst = {'L': 0.0, 'R': 0.0}
    for t in ts:
        p = rig.pose(**S['fn'](t)); f, y = S['root'](t)
        cur = {}
        for side in 'LR':
            a = p.pos('foot.' + side).copy(); c, s_ = np.cos(y), np.sin(y)
            w = np.array([c * a[0] + s_ * a[2], a[1], -s_ * a[0] + c * a[2] + f])
            cur[side] = w
            if prev is not None and a[1] < sk_ankle_y(sk) + 0.004 and prev[side][1] < sk_ankle_y(sk) + 0.004:
                worst[side] = max(worst[side], float(np.linalg.norm((w - prev[side])[[0, 2]])))
        prev = cur
    return {k: round(v * 1000, 2) for k, v in worst.items()}
def sk_ankle_y(sk):
    _, t = sk.fk(); return float(t[sk.id['foot.L']][1])

if __name__ == '__main__':
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    for g in ('male', 'female'):
        sk = Skel(os.path.join(MODELS, f'novice_c10b5b_{g}_lite.glb'))
        WR, WT = sk.fk(); k = sk.id['hand.R']
        D = np.array([-0.1, 0.25, 0.96]); D /= np.linalg.norm(D); E = Y - D * np.dot(Y, D); E /= np.linalg.norm(E)
        attach = dict(bone='hand.R', bladeDir=np.round(qrot(qinv(WR[k]), D), 4).tolist(), edgeUp=np.round(qrot(qinv(WR[k]), E), 4).tolist())
        data = dict(format='starwish.combat-anim/1', version='2.0', skeleton='novice-c10b5b', gender=g, joints=sk.names,
                    frame='glTF (+Y up, +Z forward)', weaponAttach=attach, clips={S['name']: V1.bake(sk, S) for S in SKILLS})
        p = f'{out}/novice_combat_{g}.json'
        open(p, 'w').write(json.dumps(data, separators=(',', ':')))
        print(g, os.path.getsize(p))
        for S in SKILLS:
            print('  ', S['name'], V1.check(sk, S), 'planted-foot drift mm per 1/120 s', foot_slide(sk, S))
