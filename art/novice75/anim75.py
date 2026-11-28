"""
Stage 7.5 動畫：
A. 重定向（retarget）已驗收的 C1.0-B5b 動作（Idle、Run、Attack、Hurt、Death、Jump）與 Claude C 戰鬥動作（6 段）到 Tripo 骨架。
   - 軀幹、頭：世界空間旋轉變化量直接套用
   - 四肢：先把 Tripo 的靜止骨骼方向對齊到來源的靜止方向（兩者手臂下垂角度不同），再套用變化量
   - 骨盆位移：依腿長比例放大；循環動作去掉水平漂移（遊戲位移由移動系統控制，不使用 root motion）
B. 衍生：Walk（由 Run 降低幅度、放慢）、Wait（Idle＋左右張望、重心轉移）
C. 程式化關鍵影格（新的武器類型動作）：以 Idle 第一格為基準，在角色空間（前 +Z、左 +X、上 +Y）轉動骨骼
D. 衣襬輔助骨骼（Hem_F／Hem_B）依大腿擺動自動烘焙，避免腿穿過衣襬
全部在「轉正後」的 glTF 世界空間計算（角色面向 +Z）。
"""
import json
import numpy as np
from gl import Skel, acc, qmul, qinv, qnorm, qaxis, qbetween, slerp, qpow, m2q, q2m

FPS = 30
X = np.array([1.0, 0, 0])  # 角色左方
Y = np.array([0, 1.0, 0])  # 上
Z = np.array([0, 0, 1.0])  # 前方

MAP = {
    "hips": "Hip", "spine": ["Waist", "Spine01"], "chest": "Spine02", "neck": "NeckTwist01", "head": "Head",
    "upper_arm.L": "L_Upperarm", "forearm.L": "L_Forearm", "hand.L": "L_Hand",
    "upper_arm.R": "R_Upperarm", "forearm.R": "R_Forearm", "hand.R": "R_Hand",
    "thigh.L": "L_Thigh", "shin.L": "L_Calf", "foot.L": "L_Foot",
    "thigh.R": "R_Thigh", "shin.R": "R_Calf", "foot.R": "R_Foot",
}
# 四肢方向對齊（只用在腿；手臂保留 Tripo 自然下垂角度，只套用動作變化量）：目標骨骼 → (目標子關節, 來源骨骼, 來源子關節)；None = 沿用上一節的對齊
ALIGN = {
    "L_Upperarm": ("L_Forearm", "upper_arm.L", "forearm.L"), "L_Forearm": ("L_Hand", "forearm.L", "hand.L"), "L_Hand": None,
    "R_Upperarm": ("R_Forearm", "upper_arm.R", "forearm.R"), "R_Forearm": ("R_Hand", "forearm.R", "hand.R"), "R_Hand": None,
    "L_Thigh": ("L_Calf", "thigh.L", "shin.L"), "L_Calf": ("L_Foot", "shin.L", "foot.L"), "L_Foot": None,
    "R_Thigh": ("R_Calf", "thigh.R", "shin.R"), "R_Calf": ("R_Foot", "shin.R", "foot.R"), "R_Foot": None,
}
PREV = {"L_Hand": "L_Forearm", "R_Hand": "R_Forearm", "L_Foot": "L_Calf", "R_Foot": "R_Calf"}


def rotq(M):
    m = M[:3, :3]
    sc = np.linalg.norm(m, axis=0)
    return m2q(m / sc)


class Target:
    def __init__(self, skel: Skel):
        self.S = skel
        self.W0 = skel.world()
        self.Wq0 = {i: rotq(self.W0[i]) for i in range(len(skel.nodes))}

    def pos(self, name, W=None):
        W = W or self.W0
        return W[self.S.idx[name]][:3, 3]

    def locals_from_world(self, wq, hip_pos=None):
        """wq：{節點索引: 世界旋轉}（沒有的節點用靜止區域旋轉）→ 每個節點的區域旋轉列表、Hip 區域位移"""
        S = self.S
        R = list(S.R)
        Wrot = {}
        Wm = [None] * len(S.nodes)
        T = list(S.T)
        for i in S.order:
            p = S.parent.get(i)
            pq = Wrot[p] if p is not None else np.array([0, 0, 0, 1.0])
            if i in wq:
                R[i] = qnorm(qmul(qinv(pq), wq[i]))
                Wrot[i] = wq[i]
            else:
                Wrot[i] = qmul(pq, S.R[i])
        if hip_pos is not None:
            hi = S.idx["Hip"]
            Wp = S.world(R=R)
            P = Wp[S.parent[hi]]
            T[hi] = (np.linalg.inv(P) @ np.r_[hip_pos, 1])[:3]
        return R, T


def sample_gltf_anim(j, binb, anim, skel: Skel, fps=FPS):
    """glTF 動畫 → 每格每節點的區域旋轉與位移"""
    chans = {}
    dur = 0
    for c in anim["channels"]:
        smp = anim["samplers"][c["sampler"]]
        t = acc(j, binb, smp["input"])
        v = acc(j, binb, smp["output"])
        if smp.get("interpolation") == "CUBICSPLINE":
            v = v.reshape(len(t), 3, -1)[:, 1]
        chans[(c["target"]["node"], c["target"]["path"])] = (t, v, smp.get("interpolation", "LINEAR"))
        dur = max(dur, float(t[-1]))
    n = int(round(dur * fps)) + 1
    frames = []
    for f in range(n):
        tt = f / fps
        R = list(skel.R)
        T = list(skel.T)
        for (node, path), (t, v, interp) in chans.items():
            k = np.searchsorted(t, tt) - 1
            k = int(np.clip(k, 0, len(t) - 1))
            k2 = min(k + 1, len(t) - 1)
            a = 0 if (k2 == k or interp == "STEP") else np.clip((tt - t[k]) / max(t[k2] - t[k], 1e-9), 0, 1)
            if path == "rotation":
                R[node] = slerp(v[k], v[k2], a)
            elif path == "translation":
                T[node] = v[k] * (1 - a) + v[k2] * a
        frames.append((R, T))
    return dur, frames


def sample_json_clip(clip, skel: Skel, joints, fps=FPS):
    times = np.array(clip["times"], dtype=np.float64)
    rot = {k: np.array(v, dtype=np.float64).reshape(len(times), 4) for k, v in clip["rotations"].items()}
    ht = np.array(clip["hipsTranslation"], dtype=np.float64).reshape(len(times), 3)
    dur = float(clip["duration"])
    n = int(round(dur * fps)) + 1
    frames = []
    hi = skel.idx["hips"]
    for f in range(n):
        tt = f / fps
        k = int(np.clip(np.searchsorted(times, tt) - 1, 0, len(times) - 1))
        k2 = min(k + 1, len(times) - 1)
        a = 0 if k2 == k else np.clip((tt - times[k]) / max(times[k2] - times[k], 1e-9), 0, 1)
        R = list(skel.R)
        T = list(skel.T)
        for name, q in rot.items():
            R[skel.idx[name]] = slerp(q[k], q[k2], a)
        T[hi] = ht[k] * (1 - a) + ht[k2] * a
        frames.append((R, T))
    return dur, frames


ARM_SRC = ("upper_arm.L", "forearm.L", "hand.L", "upper_arm.R", "forearm.R", "hand.R")


class Retargeter:
    def __init__(self, src: Skel, tgt: Target, neutral=None):
        """neutral：來源的「站立」姿勢（Idle 第一格，(R, T)）。手臂的變化量以它為基準，
        對應到 Tripo 的自然下垂（C1.0-B5b 是大頭 Q 版，站立時手臂張開；直接照搬會像殭屍手）"""
        self.src = src
        self.tgt = tgt
        Ws0 = src.world()
        self.Ws0 = Ws0
        self.sq0 = {n: rotq(Ws0[src.idx[n]]) for n in MAP}
        if neutral is not None:
            Wn = src.world(R=neutral[0], T=neutral[1])
            for n in ARM_SRC:
                self.sq0[n] = rotq(Wn[src.idx[n]])
        S = tgt.S
        self.A = {}
        align_rot = {}
        for s_name, t_names in MAP.items():
            for t_name in (t_names if isinstance(t_names, list) else [t_names]):
                ti = S.idx[t_name]
                if t_name in ALIGN and ALIGN[t_name] is not None and not ("arm" in t_name or "Forearm" in t_name):
                    tc, sb, sc = ALIGN[t_name]
                    dt = tgt.pos(tc) - tgt.pos(t_name)
                    ds = Ws0[src.idx[sc]][:3, 3] - Ws0[src.idx[sb]][:3, 3]
                    r = qbetween(dt, ds)
                    align_rot[t_name] = r
                    self.A[t_name] = qmul(r, tgt.Wq0[ti])
                elif t_name in PREV and PREV[t_name] in align_rot:
                    self.A[t_name] = qmul(align_rot[PREV[t_name]], tgt.Wq0[ti])
                else:
                    self.A[t_name] = tgt.Wq0[ti]
        # 腿長比例（骨盆位移放大）
        sh = Ws0[src.idx["hips"]][:3, 3]
        sf = Ws0[src.idx["foot.L"]][:3, 3]
        th = tgt.pos("Hip")
        tf = tgt.pos("L_Foot")
        self.k = (th[1] - tf[1]) / (sh[1] - sf[1])
        self.sh0 = sh

    def frame(self, R, T):
        src = self.src
        Ws = src.world(R=R, T=T)
        wq = {}
        for s_name, t_names in MAP.items():
            d = qmul(rotq(Ws[src.idx[s_name]]), qinv(self.sq0[s_name]))
            for t_name in (t_names if isinstance(t_names, list) else [t_names]):
                wq[self.tgt.S.idx[t_name]] = qnorm(qmul(d, self.A[t_name]))
        hip = self.tgt.pos("Hip") + (Ws[src.idx["hips"]][:3, 3] - self.sh0) * self.k
        return wq, hip


def clip_from_world(tgt: Target, frames_wq_hip, loop=False, drift=True):
    """[(wq, hip)] → {'R': [每格區域旋轉列表], 'T': [...]}；循環動作去掉骨盆水平漂移"""
    hips = np.array([h for _, h in frames_wq_hip])
    if drift:
        n = len(hips)
        base = tgt.pos("Hip")
        if loop and n > 1:
            # 去掉線性漂移＋平均水平偏移（保留原地擺動）
            lin = np.linspace(0, 1, n)[:, None] * (hips[-1] - hips[0])[None, :]
            hips[:, [0, 2]] = (hips - lin)[:, [0, 2]]
            hips[:, [0, 2]] -= hips[:, [0, 2]].mean(0) - base[[0, 2]]
        else:
            # 單次動作：水平位移最多保留 ±6 cm（衝刺、後仰的身體重心），不讓角色跑離碰撞位置
            off = hips[:, [0, 2]] - base[[0, 2]]
            hips[:, [0, 2]] = base[[0, 2]] + np.clip(off, -0.06, 0.06)
    out = []
    for (wq, _), hp in zip(frames_wq_hip, hips):
        out.append(tgt.locals_from_world(wq, hp))
    return out


def ground_fix(tgt: Target, frames, foot_names=("L_ToeBase", "R_ToeBase", "L_Foot", "R_Foot"), per_frame=False):
    """讓最低的腳碰到地（靜止姿勢的腳高）。per_frame=False：整段一起平移（保留跑步騰空）；True：每格各自修正（原地動作）"""
    S = tgt.S
    rest_min = min(tgt.pos(n)[1] for n in foot_names)
    mins = []
    for R, T in frames:
        W = S.world(R=R, T=T)
        mins.append(min(W[S.idx[n]][1, 3] for n in foot_names))
    hi = S.idx["Hip"]
    P = tgt.W0[S.parent[hi]]
    Pi = np.linalg.inv(P[:3, :3])
    if per_frame:
        out = [(R, [t + Pi @ np.array([0, rest_min - m, 0]) if i == hi else t for i, t in enumerate(T)]) for (R, T), m in zip(frames, mins)]
        return out, round(float(max(abs(rest_min - m) for m in mins)), 4)
    dy = rest_min - min(mins)
    dl = Pi @ np.array([0, dy, 0])
    return [(R, [t + dl if i == hi else t for i, t in enumerate(T)]) for R, T in frames], round(float(dy), 4)


# ---------- 程式化關鍵影格 ----------
AX = {"fwd": Z, "left": X, "up": Y}


def pose_from_rots(tgt: Target, base, rots, hip_off=(0, 0, 0)):
    """base: (R, T) 區域旋轉；rots: [(骨骼, 軸名或向量, 角度)] 依序在角色空間轉動（子骨骼跟著父骨骼）"""
    S = tgt.S
    R = list(base[0])
    T = list(base[1])
    for name, ax, deg in rots:
        i = S.idx[name]
        W = S.world(R=R, T=T)
        wq = rotq(W[i])
        pq = rotq(W[S.parent[i]])
        a = AX[ax] if isinstance(ax, str) else np.asarray(ax)
        R[i] = qnorm(qmul(qinv(pq), qmul(qaxis(a, np.radians(deg)), wq)))
    if any(hip_off):
        hi = S.idx["Hip"]
        P = tgt.W0[S.parent[hi]]
        T[hi] = T[hi] + np.linalg.inv(P[:3, :3]) @ np.asarray(hip_off, dtype=np.float64)
    return R, T


def ease(t):
    return t * t * (3 - 2 * t)


def keyed_clip(tgt: Target, base, keys, dur, fps=FPS):
    """keys: [(時間, rots, hip_off)]；每兩個關鍵影格之間依骨骼區域旋轉做球面插值（平滑緩動）"""
    poses = [(t, pose_from_rots(tgt, base, rots, hip)) for t, rots, hip in keys]
    n = int(round(dur * fps)) + 1
    frames = []
    for f in range(n):
        tt = f / fps
        k = 0
        while k + 1 < len(poses) and poses[k + 1][0] <= tt:
            k += 1
        if k + 1 >= len(poses):
            frames.append(poses[-1][1])
            continue
        t0, p0 = poses[k]
        t1, p1 = poses[k + 1]
        a = ease((tt - t0) / max(t1 - t0, 1e-9))
        R = [slerp(p0[0][i], p1[0][i], a) for i in range(len(p0[0]))]
        T = [p0[1][i] * (1 - a) + p1[1][i] * a for i in range(len(p0[1]))]
        frames.append((R, T))
    return frames


def blend_frames(tgt, A, B, w):
    """逐格區域旋轉混合（B 權重 w，可為每格陣列）"""
    out = []
    for f, (a, b) in enumerate(zip(A, B)):
        ww = w[f] if hasattr(w, "__len__") else w
        R = [slerp(a[0][i], b[0][i], ww) for i in range(len(a[0]))]
        T = [a[1][i] * (1 - ww) + b[1][i] * ww for i in range(len(a[1]))]
        out.append((R, T))
    return out


def resample(frames, n_out):
    n = len(frames)
    out = []
    for f in range(n_out):
        x = f * (n - 1) / max(n_out - 1, 1)
        k = int(np.floor(x))
        k2 = min(k + 1, n - 1)
        a = x - k
        R = [slerp(frames[k][0][i], frames[k2][0][i], a) for i in range(len(frames[k][0]))]
        T = [frames[k][1][i] * (1 - a) + frames[k2][1][i] * a for i in range(len(frames[k][1]))]
        out.append((R, T))
    return out


def hem_bake(tgt: Target, frames, hem_names=("Hem_F", "Hem_B")):
    """衣襬輔助骨骼：前片跟著往前抬的大腿（取兩腿較大者的 55%）、後片跟著往後的大腿（45%）"""
    S = tgt.S
    if not all(h in S.idx for h in hem_names):
        return frames
    out = []
    hf, hb = S.idx[hem_names[0]], S.idx[hem_names[1]]
    thL, thR = S.idx["L_Thigh"], S.idx["R_Thigh"]
    pel = S.idx["Pelvis"]
    W0 = tgt.W0
    rest_dirL = W0[S.idx["L_Calf"]][:3, 3] - W0[thL][:3, 3]
    rest_dirR = W0[S.idx["R_Calf"]][:3, 3] - W0[thR][:3, 3]

    def pitch(W, th, calf, rest_dir):
        d = W[calf][:3, 3] - W[th][:3, 3]
        # 大腿往前（+Z）擺的角度（側面投影）
        a0 = np.arctan2(rest_dir[2], -rest_dir[1])
        a1 = np.arctan2(d[2], -d[1])
        return a1 - a0

    for R, T in frames:
        W = S.world(R=R, T=T)
        pL = pitch(W, thL, S.idx["L_Calf"], rest_dirL)
        pR = pitch(W, thR, S.idx["R_Calf"], rest_dirR)
        fwd = max(pL, pR, 0) * 0.55
        back = min(pL, pR, 0) * 0.45
        R = list(R)
        # 繞角色左右軸轉（在骨盆區域空間）
        pq = rotq(W[pel])
        axis_local = q2m(qinv(pq)) @ X
        R[hf] = qnorm(qmul(qaxis(axis_local, -fwd), S.R[hf]))
        R[hb] = qnorm(qmul(qaxis(axis_local, -back), S.R[hb]))
        out.append((R, T))
    return out


def ground_speed(tgt: Target, frames, fps=FPS):
    """跑步／走路動畫的地面速度：支撐腳（最低時）往後移動的速度（公尺／秒，倍率 1）"""
    S = tgt.S
    sp = []
    for side in ("L_ToeBase", "R_ToeBase"):
        P = np.array([S.world(R=R, T=T)[S.idx[side]][:3, 3] for R, T in frames])
        ymin = P[:, 1].min()
        for k in range(len(P) - 1):
            if P[k, 1] < ymin + 0.02 and P[k + 1, 1] < ymin + 0.02:
                sp.append(-(P[k + 1, 2] - P[k, 2]) * fps)
    sp = sorted(sp)
    return round(float(sp[len(sp) // 2]), 3) if sp else None
