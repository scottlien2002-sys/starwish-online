"""
初心者 V2 — C0.4：女生後方頭髮厚度再減半（以 C0.3 為基礎；其他全部與 C0.3 相同）。
- 後方與側後方髮束（az ≥ 140）離頭的外凸量 ×0.5（hug 係數減半）；內層再貼頭一半。
- 正面、瀏海、兩側（az ≤ 127）、馬尾、蝴蝶結、男生全部不變。不縮放頭或整個髮型。

以下為 C0.3 說明：
初心者 V2 — C0.3 局部修正（造型）。B.2／C0／C0.1／C0.2 檔案不改：匯入 c02_shapes，只替換三個頭髮函式。
- 男：後腦勺髮殼與髮束改用「貼頭殼」定位（只影響後半部），髮根沿頭骨、髮中保留層次、髮尾微翹，外凸約 −25%，後頸逐漸收細。
       瀏海、頭頂翹髮、兩側造型與 C0.2 相同。
- 女：後腦勺主髮體改用貼頭殼，髮根貼頭（前段外凸 ×0.4～0.6）、髮尾才展開，外凸約 −28%；內層更貼頭；
       馬尾根部：往後梳的髮流在馬尾那側變薄、馬尾髮根收窄、根部結變小，減少堆疊。
       正面瀏海、兩側髮束（az ≤ 146 的部分）、馬尾位置與 S 形、髮尾外捲、蝴蝶結與金星都不變。
不縮放整顆頭或整個髮型；頭骨、臉、眼睛、身體、服裝與裙裝都不動。
"""
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "novice-c02"))
sys.path.insert(0, str(HERE.parent / "novice-c01"))
sys.path.insert(0, str(HERE.parent / "novice-v2"))
import c01_shapes as C1  # noqa: E402
import c02_shapes as C2  # noqa: E402
import novice_shapes as NS  # noqa: E402
from sdf import Part, bezier3, ellipsoid, flat_tube, unit  # noqa: E402

SHELL_M = ((0.0, 0.048, 0.9), (0.214, 0.208, 0.226))   # C0.2 男生髮殼（前半部、頭頂沿用）
BACK_M = ((0.0, 0.034, 0.9), (0.214, 0.206, 0.226))    # 男生後腦貼頭殼：前緣不變（-0.172 < -0.16），後緣 0.256 → 0.240
BACK_F = ((0.0, 0.022, 0.89), (0.216, 0.22, 0.215))    # 女生後腦貼頭殼：後緣 0.260 → 0.242（頭骨後緣 0.235）
BACK_THIN = 0.5   # C0.4：女生後方髮束外凸量再減半


def c03_male_hair():
    # 後腦殼收窄（y 半徑 0.226 → 0.208）、中心略往前，後腦不再圓鼓
    H = NS.Hair("male", cap_extra=0.0, shell=SHELL_M)
    H.drop = False
    H.ex_scale = 0.66
    NS.shell_cap(H)
    # C0.3：髮殼後方貼頭——與「後腦貼頭殼」取交集（正面、頭頂不變；後腦外緣 0.256 → 0.240，距頭骨約 1.5 公分）
    H.part.inter(ellipsoid(BACK_M[0], BACK_M[1]), 0.02)
    W = (180, 62)

    def F(*a, **k):
        # 全部髮束：厚度 ×0.72、尖端收細（tip ≤ 0.1）
        a = list(a)
        a[4] = a[4] * 0.72
        k["tip"] = min(k.get("tip", 0.12), 0.1)
        H.flow(*a, **k)

    # ---- 瀏海：交錯排列（前後兩層、長短與彎曲方向不一），不再整齊一排
    for az, el, w, bd, st, ex in ((-48, -10, 0.12, 16, 0.46, 0.034), (-30, -20, 0.13, 24, 0.42, 0.03), (-12, -8, 0.1, -10, 0.48, 0.04),
                                  (2, -26, 0.12, 22, 0.4, 0.03), (16, -12, 0.11, -14, 0.46, 0.038), (32, -2, 0.12, 14, 0.44, 0.032),
                                  (46, -16, 0.11, 10, 0.46, 0.034), (-62, -22, 0.09, 8, 0.5, 0.03), (58, -22, 0.09, 6, 0.5, 0.03)):
        F(W, az, el, w, 0.032, ex, ex_root=0.008, belly=0.008, bend=bd, start=st, plateau=0.26, k=0.004)
    for az, el, bd in ((-20, -28, 30), (8, -18, -26), (24, -24, 20)):   # 細髮絲
        F(W, az, el, 0.045, 0.02, 0.03, ex_root=0.008, belly=0.006, bend=bd, start=0.52, plateau=0.2, k=0.003)
    # ---- 臉頰旁
    for sx in (1, -1):
        F(W, 60 * sx, -30, 0.14, 0.04, 0.042, ex_root=0.01, belly=0.01, bend=-6, start=0.4, plateau=0.32)
    # ---- 兩側：主髮束＋穿插的細髮束（打散整齊的一圈）
    for sx in (1, -1):
        for az, el, ex, cu, w in ((82, 2, 0.1, 0.045, 0.16), (96, -14, 0.08, 0.02, 0.13), (110, -4, 0.105, 0.05, 0.16),
                                  (124, -20, 0.06, 0.02, 0.13), (138, -8, 0.062, 0.025, 0.14)):   # C0.3：側後方兩束外凸 −20～27%
            F(W, az * sx, el, w, 0.048, ex, ex_root=0.012, belly=0.014, curl=cu * 0.7, bend=8, start=0.3, plateau=0.32)
        for az, el, ex in ((89, -22, 0.07), (103, 6, 0.11), (117, -24, 0.06), (131, 2, 0.068)):
            F(W, az * sx, el, 0.07, 0.03, ex, ex_root=0.018, belly=0.01, curl=0.03, bend=-10, start=0.48, plateau=0.22, k=0.003)
    # ---- 後腦（C0.3）：改用貼頭殼定位——髮根沿頭骨、髮中保留層次（belly）、髮尾微翹；外凸約 −25%；後頸逐漸收細
    H.c, H.r = np.asarray(BACK_M[0], float), np.asarray(BACK_M[1], float)
    for i, (az, el, ex) in enumerate(((146, -36, 0.026), (158, -54, 0.015), (170, -66, 0.022), (184, -62, 0.015), (198, -50, 0.022), (212, -34, 0.022))):
        F(W, az, el, 0.15, 0.044, ex, ex_root=0.002 + 0.005 * (i % 2 == 0), belly=0.009, curl=0.008, bend=6, start=0.22, plateau=0.3)
    for i, (az, el) in enumerate(((152, -62), (166, -76), (180, -84), (194, -74), (208, -60))):
        F(W, az, el, (0.1, 0.085)[i % 2], 0.034, (0.008, 0.016)[i % 2], ex_root=0.006, belly=0.006, start=0.5, curl=0.0, plateau=0.2)
    for az, el in ((160, -30), (184, -40), (204, -26)):   # 中層短髮：輕微錯落，髮尾微翹
        F(W, az, el, 0.11, 0.036, 0.026, ex_root=0.01, belly=0.008, start=0.45, curl=0.01, bend=10, plateau=0.24)
    H.c, H.r = np.asarray(SHELL_M[0], float), np.asarray(SHELL_M[1], float)
    # ---- 外層
    for az, el, ex, st, bd in ((-34, 40, 0.05, 0.2, 14), (14, 46, 0.055, 0.2, -10), (58, 22, 0.065, 0.28, 8), (-72, 30, 0.065, 0.28, -8),
                               (96, 8, 0.07, 0.32, 12), (-104, 14, 0.07, 0.32, -12), (128, 18, 0.04, 0.38, 6), (-132, 2, 0.044, 0.38, -6)):
        F(W, az, el, 0.14, 0.046, ex, ex_root=0.016, belly=0.01, start=st, curl=0.015, bend=bd, plateau=0.3)
    # ---- 頭頂：高低起伏（短的貼、長的翹），總高度不超過 C0.1
    for az, el, ex, st, bd, w in ((-28, 64, 0.035, 0.25, 18, 0.11), (24, 66, 0.04, 0.25, -20, 0.12), (70, 58, 0.03, 0.35, 14, 0.09),
                                  (-74, 56, 0.03, 0.35, -16, 0.09), (0, 52, 0.022, 0.42, 6, 0.09), (45, 74, 0.02, 0.2, -8, 0.08), (-50, 72, 0.025, 0.2, 10, 0.08)):
        F(W, az, el, w, 0.044, ex, ex_root=0.012, belly=0.008, start=st, curl=0.022, bend=bd, plateau=0.28)
    H.c, H.r = np.asarray(BACK_M[0], float), np.asarray(BACK_M[1], float)   # C0.3：髮旋周圍也貼頭
    for az, el in ((120, 52), (230, 50), (180, 40)):
        F(W, az, el, 0.1, 0.034, 0.014, ex_root=0.004, belly=0.005, bend=28, plateau=0.3)
    # 髮旋中心：補一個平順的小圓頂，避免髮束根部交會處出現凹洞（C0.3 後腦殼收窄後出現）
    pw, nw = H.pt(W[0], W[1], 0.0)
    t1 = unit(np.cross(nw, [0, 0, 1.0])) if abs(nw[2]) < 0.99 else np.array([1.0, 0, 0])
    H.part.add(ellipsoid(pw + nw * 0.004, (0.05, 0.05, 0.016), np.column_stack([t1, np.cross(nw, t1), nw])), 0.02)
    H.c, H.r = np.asarray(SHELL_M[0], float), np.asarray(SHELL_M[1], float)
    for sx, (a1, a2) in ((1, (0.07, 0.12)), (-1, (0.05, 0.09))):
        p0, n = H.pt(8 * sx, 80, 0.01)
        pts = bezier3(p0 - n * 0.02, p0 + np.array([0.0, -0.005, a1]), p0 + np.array([0.03 * sx, -0.03, a2]), p0 + np.array([0.07 * sx, -0.045, a2 * 0.8]), 10)
        ts = np.linspace(0, 1, 10)
        hw = 0.022 * np.cos(ts * math.pi / 2) ** 0.9 + 0.003
        H.part.add(flat_tube(pts, hw, np.minimum(0.01 * (1 - 0.5 * ts) + 0.002, hw * 0.55 + 0.001), [np.array([0, 1.0, 0])] * 10), 0.01)
    return H.part


def c03_female_hair():
    H = NS.Hair("female", cap_extra=0.0, shell=NS.FEMALE_SHELL)
    NS.shell_cap(H, curved=True)
    # C0.3：髮殼後方貼頭（後腦外緣 0.260 → 0.242，距頭骨約 0.7 公分；正面、頭頂、兩側不變）
    H.part.inter(ellipsoid(BACK_F[0], BACK_F[1]), 0.02)
    F = H.flow
    for sx in (1, -1):
        for (a0, e0), (a1, e1) in (((28, 52), (150, 58)), ((46, 34), (140, 38)), ((60, 20), (128, 20)), ((14, 66), (165, 70))):
            # 往後梳向馬尾的髮流：角色左側（馬尾那側）變薄、貼頭，減少馬尾根部的堆疊
            F((a0 * sx, e0), a1 * sx, e1, 0.15, 0.028 if sx < 0 else 0.022, 0.024 if sx < 0 else 0.012, belly=0.016 if sx < 0 else 0.008, tip=0.45, plateau=0.6, k=0.01)
    for az, el, w, bd, pa in ((-12, -14, 0.06, 22, -3), (11, -6, 0.065, -22, 3), (-27, -2, 0.07, 18, -6), (25, -10, 0.065, -18, 6),
                              (-42, -14, 0.07, 14, -8), (41, -6, 0.07, -14, 8), (-3, -22, 0.035, 8, -2), (5, -2, 0.04, -10, 1)):
        F((pa, 80), az, el, w, 0.022, 0.01, ex_root=0.003, belly=0.006, bend=bd, tip=0.2, start=0.28, plateau=0.35, k=0.003)
    H.drop = True
    S = H.strand

    def clump(az, prof, w, t=0.018, k=0.003, tip=0.22, dr=0.0, tilt=0.0):
        prof = [(76, -0.006), (44, prof[0][1] + 0.01)] + list(prof[1:])
        n = len(prof)
        S([(az + dr * math.sin(i / max(n - 1, 1) * math.pi * 1.5), el, ex) for i, (el, ex) in enumerate(prof)], w, t, tip=tip, k=k, side_tilt=tilt)

    # 兩側：外層 5 束——減薄（0.024 → 0.018）、外翹量略收，往前旋轉（正面看到髮束的面）；
    # 中間穿插 4 束細的短髮束，束與束之間留間隙；內層 2 束
    OUT = [(46, 0.0), (8, 0.08), (-24, 0.1), (-56, 0.13), (-84, 0.14), (-81, 0.17)]

    def hug(prof):
        """髮根→髮中：外凸量依序 ×0.4、0.55、0.7、0.8、0.85（髮尾保留展開）"""
        f_ = tuple(v * BACK_THIN for v in (0.42, 0.5, 0.6, 0.7, 0.8, 0.88))   # C0.4：再 ×0.5
        return [(e, x * f_[min(i, len(f_) - 1)]) for i, (e, x) in enumerate(prof)]

    for sx in (1, -1):
        clump(54 * sx, [(46, 0.0), (10, 0.02), (-30, 0.025), (-60, 0.04), (-74, 0.062), (-71, 0.085)], 0.07, t=0.016, dr=3 * sx, tilt=0.5 * sx)
        for az, sc, L, dr, w, tl in ((114, 0.95, -80, -4, 0.13, 0.9), (122, 0.85, -88, 5, 0.12, 0.75),   # C0.4：往前移 5°、外凸 ×0.85 → 正面寬度不變、側面往後凸的量變少
                                      (140, 0.93, -82, -3, 0.13, 0.6),   # C0.3：最後方的側髮束外凸 −11%（正面寬度由 114／127 決定，不變）
                                     
                                     (152, 0.92 * 0.75, -90, 4, 0.12, 0.45), (163, 0.85 * 0.72, -78, -3, 0.12, 0.3)):
            prof = [(e, x * sc) for e, x in OUT[:-2]] + [(L, 0.14 * sc), (L + 3, 0.17 * sc)]
            if az >= 140:   # C0.4：最後方的側髮束（140）也算後方，一起減半   # C0.3：側後方的髮束也貼頭（正面看得到的 az ≤ 140 不變）
                H.c, H.r = np.asarray(BACK_F[0], float), np.asarray(BACK_F[1], float)
                prof = hug(prof)
            clump(az * sx, prof, w, dr=dr * sx, tilt=tl * sx)
            H.c, H.r = np.asarray(NS.FEMALE_SHELL[0], float), np.asarray(NS.FEMALE_SHELL[1], float)
        for az, sc, L in ((120, 1.05, -70), (133, 0.95, -94), (146, 1.0, -74), (158, 0.9 * 0.75, -86)):
            prof = [(e, x * sc) for e, x in OUT[:-2]] + [(L, 0.15 * sc), (L + 3, 0.18 * sc)]
            if az >= 146:
                H.c, H.r = np.asarray(BACK_F[0], float), np.asarray(BACK_F[1], float)
                prof = hug(prof)
            clump(az * sx, prof, 0.06, t=0.012, dr=-3 * sx, tilt=0.6 * sx, tip=0.2)
            H.c, H.r = np.asarray(NS.FEMALE_SHELL[0], float), np.asarray(NS.FEMALE_SHELL[1], float)
        for az in (122, 146):
            prof = [(42, -0.004), (6, 0.045), (-26, 0.063), (-56, 0.08), (-74, 0.09)]
            if az >= 146:   # C0.3：側後方的內層貼頭（C0.4 hug 減半）
                H.c, H.r = np.asarray(BACK_F[0], float), np.asarray(BACK_F[1], float)
                prof = hug(prof)
            clump(az * sx, prof, 0.13, t=0.018, tip=0.22)
            H.c, H.r = np.asarray(NS.FEMALE_SHELL[0], float), np.asarray(NS.FEMALE_SHELL[1], float)
    # ---- 後方（C0.3）：改用貼頭殼定位；髮根貼頭（前段外凸 ×0.4～0.6）、髮尾才展開；整體外凸約 −28%
    H.c, H.r = np.asarray(BACK_F[0], float), np.asarray(BACK_F[1], float)


    # 後面：交錯多層——外層 4 束長短交錯、角度錯開；中層 3 束細髮束；內層補底
    for az, L, sc, dr in ((170, -88, 0.68, -5), (182, -76, 0.6, 4), (193, -92, 0.66, 6), (176, -70, 0.55, -2)):
        clump(az, hug([(e, x * sc) for e, x in OUT[:-2]] + [(L, 0.14 * sc), (L + 3, 0.165 * sc)]), 0.13, dr=dr)
    for az, L, sc in ((166, -80, 0.72), (187, -84, 0.7), (198, -74, 0.66)):
        clump(az, hug([(e, x * sc) for e, x in OUT[:-2]] + [(L, 0.15 * sc), (L + 3, 0.18 * sc)]), 0.07, t=0.012, dr=-4, tip=0.2)
    for az in (170, 190):   # 內層：更貼頭
        clump(az, [(40, -0.006), (4, 0.006), (-30, 0.011), (-60, 0.015), (-74, 0.018)], 0.14, t=0.016, tip=0.22)   # C0.4 減半
    H.c, H.r = np.asarray(NS.FEMALE_SHELL[0], float), np.asarray(NS.FEMALE_SHELL[1], float)
    for sx, (az, a_, b_) in ((1, (-4, 0.07, 0.055)), (-1, (8, 0.055, 0.04))):
        p0, n = H.pt(az, 84, 0.0, True)
        pts = bezier3(p0 - n * 0.02, p0 + np.array([0, 0, a_ * 0.7]), p0 + np.array([-0.035 * sx, -0.03, a_]), p0 + np.array([-0.06 * sx, -0.06, b_ * 0.7]), 10)
        ts = np.linspace(0, 1, 10)
        hw = 0.016 * np.cos(ts * math.pi / 2) ** 0.7 + 0.003
        H.part.add(flat_tube(pts, hw, np.minimum(0.009 * (1 - 0.4 * ts) + 0.002, hw * 0.6 + 0.001), [np.array([0, 1.0, 0])] * 10), 0.008)
    return H


def c03_ponytail_and_bow(H):
    """單側馬尾：位置不變，8 束 S 形（更明顯的反曲），髮尾柔和外捲（尖端較圓）。蝴蝶結、金星沿用。"""
    tail0, bow, deco = C1._ORIG_PONY(H)
    tail = Part("ponytail", "hair", step=0.003)
    root = NS.BOW_C + np.array([-0.02, 0.03, -0.03])
    for i in range(8):
        a = (i / 7.0 - 0.5)
        dx = 0.035 * math.sin(i * 1.7)
        L = (-0.05, 0.02, -0.07, 0.0, -0.03, 0.03, -0.05, 0.01)[i]
        w = (0.15, 0.13, 0.14, 0.12, 0.15, 0.13, 0.12, 0.13)[i]
        p0 = root + np.array([dx * 0.3, a * 0.03, 0.0])
        pts = [p0,
               p0 + np.array([0.02, 0.08, 0.035]),
               np.array([0.2 + dx, 0.33 + a * 0.08, 1.0]),
               np.array([0.215 + dx * 1.2, 0.44 + a * 0.12, 0.9]),       # S：先往後鼓
               np.array([0.22 + dx * 1.4, 0.38 + a * 0.15, 0.8 + L * 0.3]),  # 再往前收
               np.array([0.215 + dx * 1.6, 0.42 + a * 0.2, 0.73 + L]),
               np.array([0.235 + dx * 1.8, 0.47 + a * 0.22, 0.715 + L + 0.02])]  # 髮尾往外（後方、外側）柔和捲起
        # C0.3：髮根收窄（root_w 0.8 → 0.5）、髮束起點沿根部錯開 → 減少根部堆疊；S 形與髮尾外捲不變
        NS.strand_pts(tail, pts, w, 0.036, lambda p: unit(np.array([1.0, 0.35, 0.0])), tip=0.3, plateau=0.5, n=26, k=0.005, root_w=0.5)
    tail.add(ellipsoid(root, (0.034, 0.038, 0.03)), 0.014)
    return tail, bow, deco




def build(g):
    saved = (C2.c02_male_hair, C2.c02_female_hair, C2.c02_ponytail_and_bow)
    C2.c02_male_hair, C2.c02_female_hair, C2.c02_ponytail_and_bow = c03_male_hair, c03_female_hair, c03_ponytail_and_bow
    try:
        return C2.build(g)
    finally:
        C2.c02_male_hair, C2.c02_female_hair, C2.c02_ponytail_and_bow = saved
