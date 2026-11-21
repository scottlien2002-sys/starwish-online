"""
初心者 V2 — C0.2 最終造型精修（造型）。B.2／C0／C0.1 檔案不改：匯入 c01_shapes／novice_shapes，在建模時替換。

男生頭髮：整體髮束變薄（約 -25%）、尖端收細；瀏海交錯、長短不一；側面加細髮束打散整齊的一圈；
          後腦往內收（髮殼後方收窄、後腦髮束貼近並往脖子方向收），頭頂高低起伏但總高度不增加。
女生頭髮：兩側外層髮束減薄並往前旋轉（正面看到髮束表面）；加長短交錯的細髮束、保留間隙；
          後方改成交錯多層；馬尾 S 形、髮尾柔和外捲。蝴蝶結與金星不動。
女生裙裝（A 方案 可愛冒險短裙）：前裙延長約 18%；奶油白內裙（雙層裙襬）；同色系安全短褲；外裙往下收、不再水平外翹。
"""
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "novice-c01"))
sys.path.insert(0, str(HERE.parent / "novice-v2"))
import c01_shapes as C1  # noqa: E402
import novice_shapes as NS  # noqa: E402
from sdf import Part, Prim, bezier3, capsule, ellipsoid, flat_tube, lathe_shell, unit  # noqa: E402

lerp_fn = NS.lerp_fn


# ================================================================== 男生頭髮
def c02_male_hair():
    # 後腦殼收窄（y 半徑 0.226 → 0.208）、中心略往前，後腦不再圓鼓
    H = NS.Hair("male", cap_extra=0.0, shell=((0.0, 0.048, 0.9), (0.214, 0.208, 0.226)))
    H.drop = False
    H.ex_scale = 0.66
    NS.shell_cap(H)
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
                                  (124, -20, 0.075, 0.025, 0.13), (138, -8, 0.085, 0.035, 0.14)):
            F(W, az * sx, el, w, 0.048, ex, ex_root=0.012, belly=0.014, curl=cu * 0.7, bend=8, start=0.3, plateau=0.32)
        for az, el, ex in ((89, -22, 0.07), (103, 6, 0.11), (117, -24, 0.06), (131, 2, 0.09)):
            F(W, az * sx, el, 0.07, 0.03, ex, ex_root=0.018, belly=0.01, curl=0.03, bend=-10, start=0.48, plateau=0.22, k=0.003)
    # ---- 後腦：往內收——髮束離髮殼小、髮尾往脖子方向收（curl=0），長短交錯
    for i, (az, el, ex) in enumerate(((146, -36, 0.035), (158, -54, 0.02), (170, -66, 0.03), (184, -62, 0.02), (198, -50, 0.03), (212, -34, 0.03))):
        F(W, az, el, 0.15, 0.048, ex, ex_root=0.004 + 0.008 * (i % 2 == 0), belly=0.012, bend=6, start=0.22, plateau=0.3)
    for i, (az, el) in enumerate(((152, -62), (166, -76), (180, -84), (194, -74), (208, -60))):
        F(W, az, el, 0.11, 0.04, (0.012, 0.025)[i % 2], ex_root=0.012, belly=0.01, start=0.5, curl=0.0, plateau=0.24)
    for az, el in ((160, -30), (184, -40), (204, -26)):   # 中層短髮：輕微錯落（不往外翹）
        F(W, az, el, 0.11, 0.04, 0.035, ex_root=0.016, belly=0.01, start=0.45, curl=0.008, bend=10, plateau=0.24)
    # ---- 外層
    for az, el, ex, st, bd in ((-34, 40, 0.05, 0.2, 14), (14, 46, 0.055, 0.2, -10), (58, 22, 0.065, 0.28, 8), (-72, 30, 0.065, 0.28, -8),
                               (96, 8, 0.07, 0.32, 12), (-104, 14, 0.07, 0.32, -12), (128, 18, 0.05, 0.38, 6), (-132, 2, 0.055, 0.38, -6)):
        F(W, az, el, 0.14, 0.046, ex, ex_root=0.016, belly=0.01, start=st, curl=0.015, bend=bd, plateau=0.3)
    # ---- 頭頂：高低起伏（短的貼、長的翹），總高度不超過 C0.1
    for az, el, ex, st, bd, w in ((-28, 64, 0.035, 0.25, 18, 0.11), (24, 66, 0.04, 0.25, -20, 0.12), (70, 58, 0.03, 0.35, 14, 0.09),
                                  (-74, 56, 0.03, 0.35, -16, 0.09), (0, 52, 0.022, 0.42, 6, 0.09), (45, 74, 0.02, 0.2, -8, 0.08), (-50, 72, 0.025, 0.2, 10, 0.08)):
        F(W, az, el, w, 0.044, ex, ex_root=0.012, belly=0.008, start=st, curl=0.022, bend=bd, plateau=0.28)
    for az, el in ((120, 52), (230, 50), (180, 40)):
        F(W, az, el, 0.1, 0.036, 0.02, ex_root=0.008, belly=0.006, bend=28, plateau=0.3)
    for sx, (a1, a2) in ((1, (0.07, 0.12)), (-1, (0.05, 0.09))):
        p0, n = H.pt(8 * sx, 80, 0.01)
        pts = bezier3(p0 - n * 0.02, p0 + np.array([0.0, -0.005, a1]), p0 + np.array([0.03 * sx, -0.03, a2]), p0 + np.array([0.07 * sx, -0.045, a2 * 0.8]), 10)
        ts = np.linspace(0, 1, 10)
        hw = 0.022 * np.cos(ts * math.pi / 2) ** 0.9 + 0.003
        H.part.add(flat_tube(pts, hw, np.minimum(0.01 * (1 - 0.5 * ts) + 0.002, hw * 0.55 + 0.001), [np.array([0, 1.0, 0])] * 10), 0.01)
    return H.part


# ================================================================== 女生頭髮
def c02_female_hair():
    H = NS.Hair("female", cap_extra=0.0, shell=NS.FEMALE_SHELL)
    NS.shell_cap(H, curved=True)
    F = H.flow
    for sx in (1, -1):
        for (a0, e0), (a1, e1) in (((28, 52), (150, 58)), ((46, 34), (140, 38)), ((60, 20), (128, 20)), ((14, 66), (165, 70))):
            F((a0 * sx, e0), a1 * sx, e1, 0.15, 0.028, 0.024, belly=0.016, tip=0.45, plateau=0.6, k=0.01)
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
    for sx in (1, -1):
        clump(54 * sx, [(46, 0.0), (10, 0.02), (-30, 0.025), (-60, 0.04), (-74, 0.062), (-71, 0.085)], 0.07, t=0.016, dr=3 * sx, tilt=0.5 * sx)
        for az, sc, L, dr, w, tl in ((114, 0.95, -80, -4, 0.13, 0.9), (127, 1.0, -88, 5, 0.12, 0.75), (140, 1.05, -82, -3, 0.13, 0.6),
                                     (152, 0.92, -90, 4, 0.12, 0.45), (163, 0.85, -78, -3, 0.12, 0.3)):
            prof = [(e, x * sc) for e, x in OUT[:-2]] + [(L, 0.14 * sc), (L + 3, 0.17 * sc)]
            clump(az * sx, prof, w, dr=dr * sx, tilt=tl * sx)
        for az, sc, L in ((120, 1.05, -70), (133, 0.95, -94), (146, 1.0, -74), (158, 0.9, -86)):
            prof = [(e, x * sc) for e, x in OUT[:-2]] + [(L, 0.15 * sc), (L + 3, 0.18 * sc)]
            clump(az * sx, prof, 0.06, t=0.012, dr=-3 * sx, tilt=0.6 * sx, tip=0.2)
        for az in (122, 146):
            clump(az * sx, [(42, -0.004), (6, 0.045), (-26, 0.063), (-56, 0.08), (-74, 0.09)], 0.13, t=0.018, tip=0.22)
    # 後面：交錯多層——外層 4 束長短交錯、角度錯開；中層 3 束細髮束；內層補底
    for az, L, sc, dr in ((170, -88, 0.68, -5), (182, -76, 0.6, 4), (193, -92, 0.66, 6), (176, -70, 0.55, -2)):
        clump(az, [(e, x * sc) for e, x in OUT[:-2]] + [(L, 0.14 * sc), (L + 3, 0.165 * sc)], 0.13, dr=dr)
    for az, L, sc in ((166, -80, 0.72), (187, -84, 0.7), (198, -74, 0.66)):
        clump(az, [(e, x * sc) for e, x in OUT[:-2]] + [(L, 0.15 * sc), (L + 3, 0.18 * sc)], 0.07, t=0.012, dr=-4, tip=0.2)
    for az in (170, 190):
        clump(az, [(40, -0.004), (4, 0.035), (-30, 0.05), (-60, 0.06), (-74, 0.065)], 0.14, t=0.018, tip=0.22)
    for sx, (az, a_, b_) in ((1, (-4, 0.07, 0.055)), (-1, (8, 0.055, 0.04))):
        p0, n = H.pt(az, 84, 0.0, True)
        pts = bezier3(p0 - n * 0.02, p0 + np.array([0, 0, a_ * 0.7]), p0 + np.array([-0.035 * sx, -0.03, a_]), p0 + np.array([-0.06 * sx, -0.06, b_ * 0.7]), 10)
        ts = np.linspace(0, 1, 10)
        hw = 0.016 * np.cos(ts * math.pi / 2) ** 0.7 + 0.003
        H.part.add(flat_tube(pts, hw, np.minimum(0.009 * (1 - 0.4 * ts) + 0.002, hw * 0.6 + 0.001), [np.array([0, 1.0, 0])] * 10), 0.008)
    return H


def c02_ponytail_and_bow(H):
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
        NS.strand_pts(tail, pts, w, 0.036, lambda p: unit(np.array([1.0, 0.35, 0.0])), tip=0.3, plateau=0.5, n=26, k=0.005)
    tail.add(ellipsoid(root, (0.045, 0.05, 0.04)), 0.02)
    return tail, bow, deco


# ================================================================== 女生裙裝（A 方案）
FRONT_SKIRT_C01 = (0.37, 0.338)   # C0.1：前裙下緣、荷葉襯裙下緣
FRONT_SKIRT_C02 = (0.344, 0.31)   # C0.2：腰帶下緣 0.5 起算，前裙長 0.13→0.156（+20%）、荷葉 0.162→0.19（+17%）
UNDERSKIRT_HEM = 0.296           # 奶油白內裙下緣（從荷葉下露出約 1.4 公分 → 雙層裙襬）
SHORTS_HEM = 0.318               # 安全短褲下緣（比內裙下緣高 2.2 公分，正常站姿看不到）


def ruffle(n, amp, ph=0.0, z0=0.43):
    return lambda th, z: 1 + amp * np.sin(n * th + ph) * np.clip((z0 - z) / 0.07, 0, 1)


def female_skirt(parts):
    drop = ("petticoat", "skirt_pink", "skirt_trim", "bloomers", "overskirt", "overskirt_trim", "overskirt_emblem")
    keep = [p for p in parts if p.name not in drop]
    out = []
    zp, zpet = FRONT_SKIRT_C02
    # 奶油白內裙（最內層，柔軟、波浪小）
    us = Part("underskirt", "cloth", step=0.0025)
    us.add(lathe_shell(UNDERSKIRT_HEM, 0.47, lerp_fn([(UNDERSKIRT_HEM, 0.205), (0.4, 0.15), (0.47, 0.104)]),
                       lerp_fn([(UNDERSKIRT_HEM, 0.18), (0.4, 0.132), (0.47, 0.088)]), 0.006, wave=ruffle(10, 0.05, 1.2, 0.4)))
    out.append(us)
    # 粉紅荷葉襯裙（加長）
    pet = Part("petticoat", "cloth", step=0.0025)
    pet.add(lathe_shell(zpet, 0.49, lerp_fn([(zpet, 0.215), (0.42, 0.152), (0.49, 0.108)]),
                        lerp_fn([(zpet, 0.19), (0.42, 0.132), (0.49, 0.09)]), 0.007, wave=ruffle(18, 0.1, 0.0, 0.4)))
    out.append(pet)
    # 奶油色前裙（加長）＋金色飾邊
    rx = lerp_fn([(zp, 0.212), (0.44, 0.152), (0.5, 0.11)])
    ry = lerp_fn([(zp, 0.186), (0.44, 0.137), (0.5, 0.093)])
    pink = Part("skirt_pink", "cloth", step=0.0025)
    pink.add(lathe_shell(zp, 0.5, rx, ry, 0.007, wave=ruffle(12, 0.09, 0.5, 0.41)))
    out.append(pink)
    st = Part("skirt_trim", "metal", step=0.0018)
    st.add(lathe_shell(zp, zp + 0.015, lambda z: rx(z) + 0.004, lambda z: ry(z) + 0.004, 0.006, wave=ruffle(12, 0.09, 0.5, 0.41)))
    out.append(st)
    # 同色系安全短褲：腰到大腿上段，貼身、在裙內
    sh = Part("safety_shorts", "cloth", step=0.0025)
    sh.add(ellipsoid((0, 0.005, 0.425), (0.098, 0.08, 0.06)))
    for sx in (1, -1):
        hip, kn, _ = [np.array([v[0] * sx, v[1], v[2]]) for v in NS.leg_joints("female")]
        sh.add(capsule(hip + np.array([0, 0, 0.06]), hip + (kn - hip) * 0.22, 0.065, 0.063), 0.02)
    sh.inter(Prim(lambda P: SHORTS_HEM - P[..., 2], (-0.2, -0.2, SHORTS_HEM - 0.01), (0.2, 0.2, 0.5)))
    out.append(sh)

    # 紫色外裙：往下收（下緣半徑 0.39 → 0.32，不再水平外翹），下緣尖角保留；前後長度自然銜接
    def ohem(th):
        a = np.degrees(np.abs(th))
        base = 0.245
        return base - 0.09 * np.exp(-(((a - 46) / 10) ** 2)) - 0.045 * np.exp(-(((a - 80) / 14) ** 2)) - 0.035 * np.exp(-(((a - 125) / 12) ** 2)) + 0.012 * np.cos(np.radians(a) * 9) * (a > 60)

    orx = lerp_fn([(0.14, 0.33), (0.25, 0.305), (0.34, 0.268), (0.42, 0.2), (0.5, 0.118)])
    ory = lerp_fn([(0.14, 0.215), (0.25, 0.2), (0.34, 0.19), (0.42, 0.15), (0.5, 0.099)])
    ocy = lerp_fn([(0.14, 0.06), (0.5, 0.0)])
    wave = lambda th, z: 1 + 0.03 * np.sin(8 * th + 0.4) * np.clip((0.36 - z) / 0.2, 0, 1)   # 柔和布料摺
    osk = Part("overskirt", "cloth2", step=0.003)
    osk.add(lathe_shell(0.14, 0.5, orx, ory, 0.012, cy_fn=ocy, open_front_deg=40, hem_fn=ohem, wave=wave))
    out.append(osk)
    otrim = Part("overskirt_trim", "metal", step=0.0025)
    otrim.add(lathe_shell(0.14, 0.5, lambda z: orx(z) + 0.004, lambda z: ory(z) + 0.004, 0.01, cy_fn=ocy, open_front_deg=40, hem_fn=ohem, wave=wave))
    otrim.inter(Prim(lambda P: P[..., 2] - (ohem(np.arctan2(P[..., 0], -P[..., 1])) + 0.02), (-0.4, -0.4, 0.08), (0.4, 0.4, 0.5)))
    out.append(otrim)
    # 外裙背後的四芒星徽章：外裙往內收後，徽章跟著移到新的布面上
    emb = Part("overskirt_emblem", "metal", step=0.0015)
    emb.add(NS.star_prim((0, 0.238, 0.33), (0, 1, 0.3), (0, 0, 1), 0.04, 0.016, 4, 0.005))
    out.append(emb)
    return keep + out


# ================================================================== 組合
def build(g):
    saved = (NS.male_hair, NS.female_hair, NS.female_ponytail_and_bow)
    NS.male_hair, NS.female_hair, NS.female_ponytail_and_bow = c02_male_hair, c02_female_hair, c02_ponytail_and_bow
    try:
        parts = NS.build(g)
    finally:
        NS.male_hair, NS.female_hair, NS.female_ponytail_and_bow = saved
    if g == "male":
        parts = C1.male_tabard_folds(parts) + C1.male_details()
    else:
        parts = female_skirt(C1.female_details(parts))
    return parts
