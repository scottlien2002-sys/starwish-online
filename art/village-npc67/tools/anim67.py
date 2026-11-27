"""Stage 6.7 NPC 動作（30 fps 取樣，線性內插）。"""
import math
import numpy as np
from rig67 import qeuler, qaxis, qmul, BONES, FPS

I = np.array([0, 0, 0, 1.0])
S = lambda t, period, ph=0.0: math.sin(2 * math.pi * (t / period + ph))


def sample(fn, dur, J):
    n = int(round(dur * FPS)) + 1
    times = np.arange(n) / FPS
    rot = {b: [] for b, _ in BONES}; trans = {}
    for t in times:
        r, tr = fn(float(t))
        for b, _ in BONES: rot[b].append(r.get(b, I))
        for b, v in tr.items():
            trans.setdefault(b, []).append(v)
    # 每個動作都輸出全部骨頭（切換動作時不殘留上一個動作的姿勢）；骨盆位移也一律輸出
    rot = {b: np.array(q) for b, q in rot.items()}
    trans = {b: np.array(v) for b, v in trans.items()}
    if 'hips' not in trans:
        trans['hips'] = np.repeat(hips_offset(J)[None], n, 0)
    return {'times': times, 'rot': rot, 'trans': trans}


def hips_offset(J, dy=0.0, dz=0.0, dx=0.0):
    return (J['hips'] - J['root']) + np.array([dx, dy, dz])


# ------------------------------------------------------------------ 共用：呼吸待機
def idle_pose(t, P, J, period=4.0, ph=0.0):
    """P：個性參數 {'breath':度, 'sway':度, 'look':度, 'armL':(pitch,roll), ...}"""
    b = S(t, period, ph)
    b2 = S(t, period * 2, ph + 0.13)
    r = {
        'spine': qeuler(pitch=0.4 * P.get('breath', 1.2) * b, roll=0.5 * P.get('sway', 0.8) * b2),
        'chest': qeuler(pitch=-P.get('breath', 1.2) * b),
        'neck': qeuler(pitch=0.4 * P.get('breath', 1.2) * b),
        'head': qeuler(yaw=P.get('look', 3.0) * S(t, period * 2, ph + 0.31), pitch=0.6 * P.get('breath', 1.2) * b + P.get('headPitch', 0.0),
                       roll=P.get('headRoll', 0.0) + 0.8 * S(t, period * 2, ph + 0.57)),
        'upperarm.R': qeuler(roll=-P.get('armBreath', 1.2) * b),
        'upperarm.L': qeuler(roll=P.get('armBreath', 1.2) * b),
    }
    return r


def mix(a, b):
    """兩組旋轉相乘（b 疊在 a 上）"""
    out = dict(a)
    for k, q in b.items():
        out[k] = qmul(out[k], q) if k in out else q
    return out


def env(t, t0, t1, ease=0.35):
    """0→1→0 的包絡（t0～t1 之間，前後各 ease 秒漸入漸出）"""
    if t < t0 or t > t1: return 0.0
    a = min(1.0, (t - t0) / ease, (t1 - t) / ease)
    return 0.5 - 0.5 * math.cos(math.pi * max(0.0, a))


# ------------------------------------------------------------------ 固定 NPC 動作組
def npc_clips(J, P):
    """回傳 {Idle, Talk, Turn, Act} 取樣結果。P['act'](t, w) → 額外旋轉"""
    clips = {}
    clips['Idle'] = sample(lambda t: (idle_pose(t, P, J), {}), 4.0, J)

    def talk(t):
        base = idle_pose(t, P, J, period=2.0)
        nod = P.get('nod', 3.5) * max(0.0, S(t, 1.0, 0.1)) + P.get('nod', 3.5) / 3.5
        r = mix(base, {'head': qeuler(pitch=nod, yaw=2.0 * S(t, 2.0)), 'chest': qeuler(pitch=0.8 * S(t, 1.0))})
        g = P.get('talk')
        if g: r = mix(r, g(t))
        return r, {}
    clips['Talk'] = sample(talk, 2.0, J)

    def turn(t):
        base = idle_pose(t, P, J, period=0.8)
        return mix(base, {'spine': qeuler(yaw=2.0 * S(t, 0.8)), 'head': qeuler(yaw=-2.0 * S(t, 0.8))}), {}
    clips['Turn'] = sample(turn, 0.8, J)

    act = P.get('act')
    if act:
        dur = P.get('actDur', 2.6)
        def actf(t):
            w = env(t, 0.0, dur, 0.5)
            return mix(idle_pose(t, P, J), act(t, w)), {}
        clips['Act'] = sample(actf, dur, J)
    return clips


# ------------------------------------------------------------------ 洛恩：腿部 IK 步行
WALK_T = 0.8      # 一個循環（兩步）秒數
WALK_V = 0.6      # 設計速度 m/s（與 petMerchant 巡走速度相同）
STANCE = 0.6      # 支撐期比例


def _ik_leg(J, side, hip_dy, ay, az):
    """矢狀面兩骨 IK。回傳 (thigh, shin, foot) 的局部旋轉與檢查用的實際腳踝位置。"""
    H = J[f'thigh.{side}'].copy(); K = J[f'shin.{side}']; A = J[f'foot.{side}']
    H[1] += hip_dy
    L1 = np.hypot(*(K - J[f'thigh.{side}'])[1:]); L2 = np.hypot(*(A - K)[1:])
    ang = lambda v: math.atan2(v[1], -v[0])  # v=(dy,dz)；0＝正下方，正＝往前
    a1r = ang((K - J[f'thigh.{side}'])[1:]); a2r = ang((A - K)[1:])
    T = np.array([ay, az])
    d_vec = T - H[1:]
    d = min(np.hypot(*d_vec), L1 + L2 - 1e-4)
    alpha = ang(d_vec)
    c1 = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)
    b1 = math.acos(max(-1.0, min(1.0, c1)))
    a1 = alpha + b1
    Kp = H[1:] + L1 * np.array([-math.cos(a1), math.sin(a1)])
    a2 = ang(T - Kp) if np.hypot(*(T - Kp)) > 1e-6 else a1
    th = qaxis((1, 0, 0), -math.degrees(a1 - a1r))
    sh = qaxis((1, 0, 0), -math.degrees((a2 - a2r) - (a1 - a1r)))
    ft = qaxis((1, 0, 0), math.degrees(a2 - a2r))
    clamped = np.hypot(*d_vec) > L1 + L2 - 1e-4
    return th, sh, ft, clamped


def walk_targets(J, side, t):
    stride = WALK_V * WALK_T * STANCE  # 支撐期腳相對身體往後移動的距離
    ph = (t / WALK_T + (0.0 if side == 'R' else 0.5)) % 1.0
    A = J[f'foot.{side}']
    if ph < STANCE:
        u = ph / STANCE
        return A[1], A[2] + stride / 2 - u * stride, True
    u = (ph - STANCE) / (1 - STANCE)
    s = u * u * (3 - 2 * u)
    return A[1] + 0.045 * math.sin(math.pi * u) + 0.012 * math.sin(math.pi * u) ** 4, A[2] - stride / 2 + s * stride, False


def merchant_clips(J, P):
    clips = npc_clips(J, P)
    clamp_count = [0]

    def walk(t):
        w = 2 * math.pi * t / WALK_T
        dy = -0.03 - 0.012 * (1 + math.cos(2 * w)) / 2  # 雙腳著地時最低
        r = {}
        for side in ('R', 'L'):
            ay, az, _ = walk_targets(J, side, t)
            th, sh, ft, cl = _ik_leg(J, side, dy, ay, az)
            clamp_count[0] += cl
            r[f'thigh.{side}'] = th; r[f'shin.{side}'] = sh; r[f'foot.{side}'] = ft
        sw = math.sin(w)  # >0：右腳在前半段往後
        r['spine'] = qeuler(yaw=-3.0 * sw, pitch=2.0)
        r['chest'] = qeuler(yaw=-2.0 * sw, pitch=-0.8 * math.cos(2 * w))
        r['neck'] = qeuler(yaw=2.5 * sw)
        r['head'] = qeuler(yaw=2.0 * sw, pitch=-1.0)
        # 手臂與同側腿相反擺動（右腳在前時右手在後）
        rz = walk_targets(J, 'R', t)[1] - J['foot.R'][2]
        k = 7.0 / (WALK_V * WALK_T * STANCE / 2)
        r['upperarm.R'] = qeuler(pitch=k * rz, roll=-2.0)
        r['upperarm.L'] = qeuler(pitch=-k * rz, roll=2.0)
        r['forearm.R'] = qeuler(pitch=-6.0 + 3.0 * math.sin(w))
        r['forearm.L'] = qeuler(pitch=-6.0 - 3.0 * math.sin(w))
        return r, {'hips': hips_offset(J, dy=dy)}
    clips['Walk'] = sample(walk, WALK_T, J)
    clips['_walk_clamped'] = clamp_count[0]

    # Turn：原地小碎步（兩腳輪流抬起 2.5 cm）
    def turn(t):
        r = idle_pose(t, P, J, period=0.8)
        for side, ph in (('R', 0.0), ('L', 0.5)):
            u = (t / 0.8 + ph) % 1.0
            lift = 0.025 * max(0.0, math.sin(2 * math.pi * u)) if u < 0.5 else 0.0
            A = J[f'foot.{side}']
            th, sh, ft, _ = _ik_leg(J, side, -0.01, A[1] + lift, A[2])
            r[f'thigh.{side}'] = th; r[f'shin.{side}'] = sh; r[f'foot.{side}'] = ft
        return r, {'hips': hips_offset(J, dy=-0.01)}
    clips['Turn'] = sample(turn, 0.8, J)
    return clips
