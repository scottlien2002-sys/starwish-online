"""
初心者 V2 — C0.1 局部精修（造型）。B.2／C0 的檔案不改：這裡匯入 novice_shapes，只替換頭髮與幾個服裝零件、加上細節零件。

男生頭髮：瀏海變薄、弧度更大、長短不一；頭頂髮束長短與方向變化；側面髮束交錯；後腦分層、髮尾錯開，後腦不再是一顆圓球。
          （不增加髮束離頭皮的高度，頭部整體不會變大）
女生頭髮：兩側髮束變薄、變窄、分成更多束並留間隙；後面髮束長短交錯；單側馬尾改成 8 束扇形展開、S 形彎曲、髮尾往外捲。
          蝴蝶結（位置、造型）完全不變。
服裝細節：男——腰帶上下緣、皮帶環、垂下的皮帶尾、護腕金屬環、靴底與靴筒扣帶、下擺布料摺痕；
          女——荷葉邊加大、前裙金色飾邊、胸前金色 V 形飾線。
"""
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "novice-v2"))
import novice_shapes as NS  # noqa: E402
from sdf import Part, Prim, bezier3, capsule, catmull, cyl, ellipsoid, flat_tube, lathe_shell, rbox, rot, torus, unit  # noqa: E402

lerp_fn = NS.lerp_fn


# ================================================================== 男生頭髮
def c01_male_hair():
    H = NS.Hair("male", cap_extra=0.0, shell=((0.0, 0.055, 0.9), (0.216, 0.226, 0.226)))  # 後腦殼稍微收（不那麼圓）
    H.drop = False
    H.ex_scale = 0.68
    NS.shell_cap(H)
    W = (180, 62)
    F = H.flow
    # ---- 瀏海：更薄（0.042 → 0.03）、弧度更大，長短不一，兩束細髮絲
    for az, el, w, bd, st in ((-46, -12, 0.13, 18, 0.45), (-25, -18, 0.15, 22, 0.42), (-2, -24, 0.14, 24, 0.4),
                              (20, -6, 0.15, 16, 0.42), (40, -14, 0.13, 12, 0.45), (-60, -20, 0.1, 8, 0.5), (56, -20, 0.1, 6, 0.5)):
        F(W, az, el, w, 0.03, 0.034, ex_root=0.008, belly=0.01, bend=bd, tip=0.18, start=st, plateau=0.3, k=0.006)
    for az, el, bd in ((-14, -26, 30), (10, -20, 26)):
        F(W, az, el, 0.05, 0.018, 0.03, ex_root=0.008, belly=0.008, bend=bd, tip=0.15, start=0.5, plateau=0.25, k=0.004)
    # ---- 臉頰旁
    for sx in (1, -1):
        F(W, 60 * sx, -28, 0.16, 0.04, 0.045, ex_root=0.01, belly=0.012, bend=-6, tip=0.24, start=0.4, plateau=0.36)
    # ---- 兩側：長短交錯、外翹量不同（不再一排平整）
    for sx in (1, -1):
        for az, el, ex, cu, w in ((82, 2, 0.1, 0.045, 0.17), (96, -14, 0.085, 0.02, 0.15), (110, -4, 0.11, 0.05, 0.17),
                                  (124, -18, 0.08, 0.025, 0.15), (138, -10, 0.085, 0.035, 0.15)):
            F(W, az * sx, el, w, 0.048, ex, ex_root=0.012, belly=0.016, curl=cu * 0.7, bend=8, tip=0.24, start=0.3, plateau=0.36)
    # ---- 後腦：三層、髮尾錯開往外微翹
    for i, (az, el, ex) in enumerate(((146, -34, 0.05), (158, -50, 0.03), (170, -62, 0.055), (184, -58, 0.03), (198, -48, 0.055), (212, -32, 0.04))):
        F(W, az, el, 0.15, 0.048, ex, ex_root=0.004 + 0.012 * (i % 2 == 0), belly=0.014, bend=6, tip=0.22, start=0.22, plateau=0.36)
    for i, (az, el) in enumerate(((150, -58), (164, -72), (178, -80), (192, -70), (206, -56))):
        F(W, az, el, 0.12, 0.044, (0.035, 0.06)[i % 2], ex_root=0.016 + 0.012 * (i % 2), belly=0.012, start=0.5, curl=0.02, tip=0.22, plateau=0.3)
    for i, (az, el) in enumerate(((158, -30), (182, -36), (204, -28))):  # 中層：短、往外翹，打破圓弧
        F(W, az, el, 0.12, 0.044, 0.07, ex_root=0.02, belly=0.012, start=0.45, curl=0.03, bend=10, tip=0.22, plateau=0.3)
    # ---- 外層：較短、方向不一
    for az, el, ex, st, bd in ((-34, 40, 0.05, 0.2, 14), (14, 46, 0.055, 0.2, -10), (58, 22, 0.065, 0.28, 8), (-72, 30, 0.065, 0.28, -8),
                               (96, 8, 0.07, 0.32, 12), (-104, 14, 0.07, 0.32, -12), (128, 18, 0.055, 0.38, 6), (-132, 2, 0.06, 0.38, -6)):
        F(W, az, el, 0.15, 0.046, ex, ex_root=0.018, belly=0.012, start=st, curl=0.015, bend=bd, tip=0.22, plateau=0.36)
    # ---- 頭頂：長短、方向不同的翹髮（往前、往左右；不往上加高）
    for az, el, ex, st, bd, w in ((-28, 64, 0.035, 0.25, 18, 0.12), (24, 66, 0.04, 0.25, -20, 0.13), (70, 58, 0.03, 0.35, 14, 0.1),
                                  (-74, 56, 0.03, 0.35, -16, 0.1), (0, 52, 0.03, 0.4, 6, 0.1)):
        F(W, az, el, w, 0.044, ex, ex_root=0.014, belly=0.01, start=st, curl=0.025, bend=bd, tip=0.2, plateau=0.32)
    for az, el in ((120, 52), (230, 50), (180, 40)):
        F(W, az, el, 0.11, 0.036, 0.02, ex_root=0.008, belly=0.008, bend=28, tip=0.25, plateau=0.35)
    for sx, (a1, a2) in ((1, (0.07, 0.12)), (-1, (0.05, 0.09))):
        p0, n = H.pt(8 * sx, 80, 0.01)
        pts = bezier3(p0 - n * 0.02, p0 + np.array([0.0, -0.005, a1]), p0 + np.array([0.03 * sx, -0.03, a2]), p0 + np.array([0.07 * sx, -0.045, a2 * 0.8]), 10)
        ts = np.linspace(0, 1, 10)
        hw = 0.024 * np.cos(ts * math.pi / 2) ** 0.8 + 0.004
        H.part.add(flat_tube(pts, hw, np.minimum(0.012 * (1 - 0.5 * ts) + 0.002, hw * 0.55 + 0.001), [np.array([0, 1.0, 0])] * 10), 0.012)
    return H.part


# ================================================================== 女生頭髮
def c01_female_hair():
    H = NS.Hair("female", cap_extra=0.0, shell=NS.FEMALE_SHELL)
    NS.shell_cap(H, curved=True)
    F = H.flow
    PART = (0, 80)
    for sx in (1, -1):
        for (a0, e0), (a1, e1) in (((28, 52), (150, 58)), ((46, 34), (140, 38)), ((60, 20), (128, 20)), ((14, 66), (165, 70))):
            F((a0 * sx, e0), a1 * sx, e1, 0.15, 0.03, 0.026, belly=0.018, tip=0.45, plateau=0.6, k=0.01)
    for az, el, w, bd, pa in ((-12, -14, 0.06, 22, -3), (11, -6, 0.065, -22, 3), (-27, -2, 0.07, 18, -6), (25, -10, 0.065, -18, 6),
                              (-42, -14, 0.07, 14, -8), (41, -6, 0.07, -14, 8), (-3, -22, 0.035, 8, -2), (5, -2, 0.04, -10, 1)):
        F((pa, 80), az, el, w, 0.022, 0.01, ex_root=0.003, belly=0.006, bend=bd, tip=0.2, start=0.28, plateau=0.35, k=0.003)
    H.drop = True
    S = H.strand

    def clump(az, prof, w, t=0.024, k=0.003, tip=0.16, dr=0.0):
        prof = [(76, -0.006), (44, prof[0][1] + 0.01)] + list(prof[1:])
        n = len(prof)
        S([(az + dr * math.sin(i / max(n - 1, 1) * math.pi * 1.5), el, ex) for i, (el, ex) in enumerate(prof)], w, t, tip=tip, k=k)

    # 兩側：外層 5 束（較窄、較薄、長短與外翹量交錯），內層 2 束
    OUT = [(46, 0.0), (8, 0.085), (-24, 0.11), (-56, 0.145), (-84, 0.155), (-81, 0.185)]
    for sx in (1, -1):
        clump(54 * sx, [(46, 0.0), (10, 0.02), (-30, 0.025), (-60, 0.04), (-74, 0.065), (-71, 0.09)], 0.07, t=0.02, dr=3 * sx)
        for az, sc, L, dr, w in ((114, 0.95, -80, -4, 0.13), (127, 1.0, -88, 5, 0.12), (140, 1.05, -82, -3, 0.13), (152, 0.92, -90, 4, 0.12), (163, 0.85, -78, -3, 0.12)):
            prof = [(e, x * sc) for e, x in OUT[:-2]] + [(L, 0.155 * sc), (L + 3, 0.19 * sc)]
            clump(az * sx, prof, w, dr=dr * sx)
        for az in (122, 146):
            clump(az * sx, [(42, -0.004), (6, 0.05), (-26, 0.07), (-56, 0.09), (-74, 0.1)], 0.13, t=0.022, tip=0.2)
    # 後面：長短交錯的 5 束＋內層
    for az, L, sc, dr in ((172, -86, 0.68, -4), (180, -78, 0.6, 3), (188, -90, 0.66, 4), (176, -70, 0.55, 2), (184, -82, 0.62, -2)):
        clump(az, [(e, x * sc) for e, x in OUT[:-2]] + [(L, 0.155 * sc), (L + 3, 0.18 * sc)], 0.13, dr=dr)
    for az in (170, 190):
        clump(az, [(40, -0.004), (4, 0.04), (-30, 0.055), (-60, 0.065), (-74, 0.07)], 0.14, t=0.022, tip=0.2)
    for sx, (az, a_, b_) in ((1, (-4, 0.07, 0.055)), (-1, (8, 0.055, 0.04))):
        p0, n = H.pt(az, 84, 0.0, True)
        pts = bezier3(p0 - n * 0.02, p0 + np.array([0, 0, a_ * 0.7]), p0 + np.array([-0.035 * sx, -0.03, a_]), p0 + np.array([-0.06 * sx, -0.06, b_ * 0.7]), 10)
        ts = np.linspace(0, 1, 10)
        hw = 0.016 * np.cos(ts * math.pi / 2) ** 0.7 + 0.003
        H.part.add(flat_tube(pts, hw, np.minimum(0.009 * (1 - 0.4 * ts) + 0.002, hw * 0.6 + 0.001), [np.array([0, 1.0, 0])] * 10), 0.008)
    return H


def c01_ponytail_and_bow(H):
    """單側馬尾 8 束：從蝴蝶結下方往後上拱，扇形展開往下垂，S 形，髮尾往外（往後、往外側）捲；長短不一。蝴蝶結沿用 B.2。"""
    tail0, bow, deco = _ORIG_PONY(H)
    tail = Part("ponytail", "hair", step=0.003)
    root = NS.BOW_C + np.array([-0.02, 0.03, -0.03])
    rng = np.random.default_rng(7)
    for i in range(8):
        a = (i / 7.0 - 0.5)                       # -0.5..0.5：扇形位置（前 → 後）
        dx = 0.035 * math.sin(i * 1.7)           # 左右錯開
        L = (-0.05, 0.02, -0.07, 0.0, -0.03, 0.03, -0.05, 0.01)[i]
        w = (0.15, 0.13, 0.14, 0.12, 0.15, 0.13, 0.12, 0.13)[i]
        flick = (1, -1)[i % 2]
        p0 = root + np.array([dx * 0.3, a * 0.03, 0.0])
        pts = [p0,
               p0 + np.array([0.02, 0.08, 0.035]),
               np.array([0.2 + dx, 0.32 + a * 0.08, 1.0]),
               np.array([0.215 + dx * 1.2, 0.42 + a * 0.12, 0.9]),
               np.array([0.22 + dx * 1.4, 0.40 + a * 0.16 - 0.02 * flick, 0.8 + L * 0.3]),
               np.array([0.215 + dx * 1.6, 0.42 + a * 0.2 + 0.02 * flick, 0.73 + L]),
               np.array([0.225 + dx * 1.7 + 0.01, 0.44 + a * 0.21 + 0.02 * flick, 0.7 + L + 0.015])]
        NS.strand_pts(tail, pts, w, 0.04, lambda p: unit(np.array([1.0, 0.35, 0.0])), tip=0.24, plateau=0.5, n=26, k=0.005)
    tail.add(ellipsoid(root, (0.045, 0.05, 0.04)), 0.02)
    return tail, bow, deco


# ================================================================== 服裝細節
def male_details():
    out = []
    # 腰帶上下緣（壓線的厚邊）＋皮帶環＋從方扣垂下的皮帶尾
    be = Part("belt_edge", "leather", step=0.0018)
    for z in (0.414, 0.456):
        be.add(lathe_shell(z - 0.003, z + 0.003, lambda zz: 0.134 + 0 * zz, lambda zz: 0.098 + 0 * zz, 0.006))
    out.append(be)
    lp = Part("belt_loop", "leather", step=0.0018)
    for ang in (-50, 50, 130, -130):
        a = math.radians(ang)
        c = np.array([math.sin(a) * 0.134, -math.cos(a) * 0.098, 0.435])
        lp.add(rbox(c, (0.008, 0.004, 0.026), 0.003, rot((0, 0, 1), -ang)))
    pts = catmull([(0.026, -0.1, 0.436), (0.04, -0.104, 0.425), (0.046, -0.104, 0.395), (0.044, -0.1, 0.37)], 8)
    lp.add(flat_tube(pts, np.full(8, 0.009), np.full(8, 0.003), [np.array([0, -1.0, 0])] * 8), 0.003)
    out.append(lp)
    # 護腕：手套袖口外側的金屬環＋皮革厚邊
    gb = Part("glove_band", "metal", step=0.0015)
    for sx in (1, -1):
        wr, d, c, b, s, pose = NS.hand_frames("male", sx)
        el = np.array(NS.arm_joints("male")[1]) * [sx, 1, 1]
        ax = unit(el - wr)
        gb.add(torus(wr + ax * 0.043, 0.046, 0.0045, axis=ax))
        gb.add(torus(wr + ax * 0.02, 0.041, 0.0035, axis=ax))
    out.append(gb)
    # 靴子：深色靴底＋靴筒扣帶（小方扣）
    an = NS.leg_joints("male")[2]
    sole = Part("boot_sole", "dark", step=0.002)
    strap = Part("boot_strap", "leather", step=0.0018)
    bk = Part("boot_buckle", "metal", step=0.0015)
    for sx in (1, -1):
        x = an[0] * sx
        toe, heel, width = -0.151, 0.098, 0.165
        sole.add(ellipsoid((x, (heel + toe) / 2, 0.009), (width / 2 + 0.008, (heel - toe) / 2 + 0.008, 0.011)))
        sole.inter(rbox((x, (heel + toe) / 2, 0.006), (0.2, 0.3, 0.012), 0.0))
        strap.add(cyl(x, 0.02, 0.07, 0.086, 0.068, 0.067, 0.003))
        bk.add(rbox((x + 0.045 * sx, 0.02 - 0.05, 0.078), (0.011, 0.004, 0.011), 0.002, rot((0, 0, 1), 40 * sx)))
    out += [sole, strap, bk]
    return out


def male_tabard_folds(parts):
    """下擺加上柔和的直向摺痕（布料波浪），飾邊跟著同一個波浪"""
    tab = next(p for p in parts if p.name == "tabard")
    trim = next(p for p in parts if p.name == "tabard_trim")
    wave = lambda th, z: 1 + 0.035 * np.sin(9 * th + 0.6) * np.clip((0.42 - z) / 0.22, 0, 1)
    for p in (tab, trim):
        op, prim, k = p.ops[0]
        p.ops[0] = (op, _with_wave(prim, wave), k)
    return parts


def _with_wave(prim, wave):
    """把殼的半徑乘上波浪：以 (θ, z) 對 x、y 做縮放後再求原本的距離場（近似，用於小幅摺痕）"""
    def f(P):
        th = np.arctan2(P[..., 0], -P[..., 1])
        s = wave(th, P[..., 2])
        Q = P.copy()
        Q[..., 0] = P[..., 0] / s
        Q[..., 1] = P[..., 1] / s
        return prim.fn(Q) * np.minimum(s, 1.0)
    lo = np.asarray(prim.lo) * 1.05
    hi = np.asarray(prim.hi) * 1.05
    lo[2], hi[2] = prim.lo[2], prim.hi[2]
    return Prim(f, lo, hi)


def female_details(parts):
    out = []
    # 荷葉邊加大：替換襯裙與前裙
    def ruffle(n, amp, ph=0.0):
        return lambda th, z: 1 + amp * np.sin(n * th + ph) * np.clip((0.43 - z) / 0.07, 0, 1)

    keep = [p for p in parts if p.name not in ("petticoat", "skirt_pink")]
    pet = Part("petticoat", "cloth", step=0.0025)
    pet.add(lathe_shell(0.338, 0.49, lerp_fn([(0.338, 0.205), (0.42, 0.15), (0.49, 0.108)]), lerp_fn([(0.338, 0.18), (0.42, 0.13), (0.49, 0.09)]), 0.007, wave=ruffle(18, 0.1)))
    pink = Part("skirt_pink", "cloth", step=0.0025)
    rx = lerp_fn([(0.37, 0.2), (0.44, 0.15), (0.5, 0.11)])
    ry = lerp_fn([(0.37, 0.175), (0.44, 0.135), (0.5, 0.093)])
    pink.add(lathe_shell(0.37, 0.5, rx, ry, 0.007, wave=ruffle(12, 0.09, 0.5)))
    out += [pet, pink]
    # 前裙下緣的金色飾邊（跟著荷葉波浪）
    st = Part("skirt_trim", "metal", step=0.0018)
    st.add(lathe_shell(0.37, 0.385, lambda z: rx(z) + 0.004, lambda z: ry(z) + 0.004, 0.006, wave=ruffle(12, 0.09, 0.5)))
    out.append(st)
    # 胸前金色 V 形飾線
    ct = Part("chest_trim", "metal", step=0.0015)
    for sx in (1, -1):
        pts = catmull([(0.055 * sx, -0.07, 0.66), (0.035 * sx, -0.085, 0.625), (0.012 * sx, -0.092, 0.595), (0.0, -0.094, 0.575)], 10)
        ct.add(flat_tube(pts, np.full(10, 0.0045), np.full(10, 0.0025), [np.array([0, -1.0, 0])] * 10), 0.002)
    out.append(ct)
    return keep + out


# ================================================================== 組合
_ORIG_PONY = NS.female_ponytail_and_bow


def build(g):
    saved = (NS.male_hair, NS.female_hair, NS.female_ponytail_and_bow)
    NS.male_hair, NS.female_hair, NS.female_ponytail_and_bow = c01_male_hair, c01_female_hair, c01_ponytail_and_bow
    try:
        parts = NS.build(g)
    finally:
        NS.male_hair, NS.female_hair, NS.female_ponytail_and_bow = saved
    if g == "male":
        parts = male_tabard_folds(parts) + male_details()
    else:
        parts = female_details(parts)
    return parts
