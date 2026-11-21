"""
初心者 V2 灰模：男女造型定義（SDF＋獨立零件）。數字來自步驟 A 量測（measurements.json）。
座標：Z 向上、角色面向 -Y、角色左側 +X；單位公尺；腳底 z = 0。

零件分組（之後換裝與材質）：
  身體：head（含臉、耳、脖子）、body（軀幹、手臂、腿）、hand_l/hand_r（五指）
  頭髮：hair（頭皮殼＋髮塊）；女：＋ponytail、bow
  服裝：每件獨立（上衣、背心、圍巾、腰帶、腰包、短褲、下擺、手套、靴子…）
"""
import math

import numpy as np

from sdf import cyl, catmull, pillow, Part, Prim, bezier3, capsule, ellipsoid, flat_tube, lathe_shell, rbox, rot, smin, sphere, torus, unit

# 設定圖對齊用（設定圖像素座標；預覽比對用）
SIDE_CENTER = {"male": 535.5, "female": 552.5}
BACK_CENTER = {"male": 885.0, "female": 969.4}


# ================================================================== 2D 星形（徽章）


def star_prim(c, facing, up, R, r, points, depth, rounding=0.002):
    """平面星形徽章（四芒或五角），沿 facing 方向有厚度"""
    c = np.asarray(c, float)
    f = unit(facing)
    u = unit(np.asarray(up, float) - f * (np.asarray(up, float) @ f))
    s = np.cross(u, f)
    n = points
    an = math.pi / n

    def star2d(px, py):
        # 極座標：每個尖角之間在外半徑與內半徑間直線連接
        ang = np.arctan2(px, py)  # 0 = 朝上
        rad = np.sqrt(px * px + py * py)
        a = np.mod(ang + an, 2 * an) - an  # -an..an，0 = 尖角（第一個尖角朝上）
        t = np.abs(a) / an
        edge = R * (1 - t) + r * t  # 近似：尖角到凹角線性
        return (rad - edge) * 0.8

    def fn(P):
        q = P - c
        x, y, z = q @ s, q @ u, q @ f
        d2 = star2d(x, y)
        dz = np.abs(z - depth / 2) - depth / 2
        return np.sqrt(np.maximum(d2, 0) ** 2 + np.maximum(dz, 0) ** 2) + np.minimum(np.maximum(d2, dz), 0) - rounding

    m = R + depth
    return Prim(fn, c - m, c + m)


# ================================================================== 頭


def head_part(g):
    """Q 版頭：大頭骨＋圓臉頰＋小下巴，耳朵、脖子平滑融合（沒有接縫）"""
    p = Part("head", "skin", step=0.0025)
    if g == "male":
        cran = ellipsoid((0, 0.03, 0.885), (0.178, 0.195, 0.185))
        face = ellipsoid((0, -0.03, 0.79), (0.166, 0.135, 0.097))
        chin = ellipsoid((0, -0.095, 0.716), (0.05, 0.05, 0.026))
        ear = (0.152, 0.075, 0.776)
    else:
        cran = ellipsoid((0, 0.04, 0.875), (0.18, 0.195, 0.18))
        face = ellipsoid((0, -0.02, 0.792), (0.17, 0.135, 0.094))
        chin = ellipsoid((0, -0.088, 0.72), (0.05, 0.048, 0.025))
        ear = (0.155, 0.1, 0.79)
    p.add(cran)
    p.add(face, 0.07)
    p.add(chin, 0.035)
    for sx in (1, -1):
        R = rot((0, 0, 1), -18 * sx)
        p.add(ellipsoid((ear[0] * sx, ear[1], ear[2]), (0.022, 0.04, 0.05), R), 0.015)
    # 小鼻子（只是一點點）
    nose_y = -0.166 if g == "male" else -0.156
    nose_z = 0.763 if g == "male" else 0.774
    p.add(ellipsoid((0, nose_y + 0.004, nose_z), (0.007, 0.006, 0.006)), 0.006)
    # 脖子
    p.add(capsule((0, 0.02, 0.6), (0, 0.035, 0.74), 0.042, 0.04), 0.02)
    return p


def cranium(g):
    return ((0, 0.03, 0.885), (0.178, 0.195, 0.185)) if g == "male" else ((0, 0.04, 0.875), (0.18, 0.195, 0.18))


# ================================================================== 頭髮


class Hair:
    """頭髮：頭皮殼＋一束束髮塊。髮塊 = 壓扁、漸細、彎曲的曲管，貼著頭型往外流，尾端圓潤上翹"""

    def __init__(self, g, name="hair", step=0.003, cap_extra=0.024, shell=None):
        self.g = g
        self.c, self.r = cranium(g) if shell is None else shell
        self.c = np.asarray(self.c, float)
        self.r = np.asarray(self.r, float)
        self.cap_extra = cap_extra
        self.drop = True  # 往下垂的髮型（女生）；男生的短髮改成沿頭型（False）
        self.ex_scale = 1.0  # 髮束離髮殼高度的整體倍率（調整整體髮量輪廓用）
        self.part = Part(name, "hair", step=step)

    def surf(self, az, el, extra=None):
        """頭皮（頭骨＋extra）上方位角 az、仰角 el 的點與法線；az 0 = 正前方、往角色左側為正"""
        a, e = math.radians(az), math.radians(el)
        u = np.array([math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e)])
        ex = self.cap_extra if extra is None else extra
        p = self.c + u * (self.r + ex)
        n = unit(u / (self.r + ex))
        return p, n

    def frame(self, n):
        g = np.array([0, 0, -1.0]) - n * (-n[2])  # 沿頭皮往下
        g = unit(g) if np.linalg.norm(g) > 1e-6 else np.array([0, 1.0, 0])
        h = np.cross(n, g)
        return g, h

    def cap(self, keep_face=True):
        c, r = self.c, self.r + self.cap_extra
        self.part.add(ellipsoid(c, r))
        if keep_face:
            # 挖掉臉部（髮際線以下的前方）
            fz = 0.86 if self.g == "male" else 0.86
            self.part.sub(rbox((0, c[1] - 0.25, fz - 0.16), (0.2, 0.14, 0.16), 0.03), 0.02)
            # 兩側耳朵後方往下（頭皮殼不要蓋到下巴）
            self.part.sub(rbox((0, c[1] - 0.05, 0.62), (0.3, 0.3, 0.1), 0.02), 0.02)

    def clump(self, az, el, L, w, t, start, end, tip=0.18, mid=1.0, n_pts=9, k=0.006, inset=0.012, world=False, twist=0.0):
        """
        start、end：方向（world=False 時為頭皮局部座標 (n 往外, g 沿頭皮往下, h 側向)；world=True 為世界向量）
        tip：髮尾寬度比例（> 0：圓潤的髮尾，不是尖刺）；mid：中段鼓起
        """
        p0, n = self.surf(az, el)
        p0 = p0 - n * inset
        g, h = self.frame(n)

        def D(v):
            v = np.asarray(v, float)
            return unit(v) if world else unit(n * v[0] + g * v[1] + h * v[2])

        ds, de = D(start), D(end)
        p1 = p0 + ds * L / 3
        p2 = p1 + unit(ds + de) * L / 3
        p3 = p2 + de * L / 3
        pts = bezier3(p0, p1, p2, p3, n_pts)
        ts = np.linspace(0, 1, n_pts)
        hw = w / 2 * ((1 - ts) ** 0.75 * (1 - tip) + tip) * (1 + 0.18 * mid * np.sin(np.pi * ts))
        ht = t / 2 * (1 - 0.55 * ts) + 0.002
        nr = [unit(q - self.c) for q in pts]
        if twist:
            nr = [unit(nv + np.cross(nv, unit(pts[min(i + 1, n_pts - 1)] - pts[max(i - 1, 0)])) * twist * ts[i]) for i, nv in enumerate(nr)]
        self.part.add(flat_tube(pts, hw, ht, nr), k)
        return pts


    def pt(self, az, el, ex, drop=True):
        """
        髮殼外 ex 公尺的點與「厚度方向」：el ≥ 0 在髮殼上；el < 0 往下垂
        （水平位置停在赤道附近並稍微內收，高度隨 sin(el) 下降；el < -90 繼續往下）
        """
        c, r = self.c, self.r
        az_r, el_r = math.radians(az), math.radians(el)
        hor = np.array([math.sin(az_r), -math.cos(az_r), 0.0])
        if el >= 0 or not drop:
            u = np.array([math.cos(el_r) * math.sin(az_r), -math.cos(el_r) * math.cos(az_r), math.sin(el_r)])
            return c + u * (r + ex), unit(u / (r + ex))
        shrink = 0.8 + 0.2 * math.cos(max(el_r, -math.pi / 2))
        p = c + hor * (r + ex) * np.array([shrink, shrink, 1.0])
        # 往下垂：ex 只往外推（水平），不影響高度
        if el >= -90:
            p[2] = c[2] + r[2] * math.sin(el_r)
        else:
            p[2] = c[2] - r[2] + (el_r + math.pi / 2) * r[2]
        return p, hor

    def strand(self, knots, w, t, tip=0.14, n=18, k=0.012, root_w=0.75, belly=0.0, side_tilt=0.0, drop=None):
        """
        柔和曲面的髮束：knots = [(方位角, 仰角, 離髮殼高度), ...]（3～6 個），用 Catmull-Rom 曲線串起來。
        - 截面是扁橢圓；寬度：髮根略窄 → 前 1/3 最寬 → 往髮尾平順收成柔和的尖（tip = 髮尾寬度比例）
        - 厚度隨寬度收薄，髮尾維持扁葉片（不是圓錐、不是圓管）
        - belly：中段額外鼓起（髮量），side_tilt：厚度方向沿路徑側傾（髮束翻轉、互相重疊）
        """
        P, N = [], []
        dr = self.drop if drop is None else drop
        for az, el, ex in knots:
            p, nv = self.pt(az, el, ex, dr)
            P.append(p)
            N.append(nv)
        P = np.array(P)
        N = np.array(N)
        # Catmull-Rom（端點複製）
        Q = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
        M = np.vstack([N[0], N, N[-1]])
        seg = len(P) - 1
        ts = np.linspace(0, 1, n)
        pts, nrs = [], []
        for s_ in ts:
            x = min(s_ * seg, seg - 1e-9)
            i = int(x)
            u = x - i
            p0, p1, p2, p3 = Q[i], Q[i + 1], Q[i + 2], Q[i + 3]
            pp = 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)
            nn = unit(M[i + 1] * (1 - u) + M[i + 2] * u)
            pts.append(pp)
            nrs.append(nn)
        pts = np.array(pts)
        if belly:
            for j, s_ in enumerate(ts):
                pts[j] = pts[j] + nrs[j] * belly * math.sin(math.pi * s_) ** 1.5
        if side_tilt:
            for j, s_ in enumerate(ts):
                tg = unit(pts[min(j + 1, n - 1)] - pts[max(j - 1, 0)])
                sd = np.cross(tg, nrs[j])
                nrs[j] = unit(nrs[j] + sd * side_tilt * s_)
        prof = np.where(ts < 0.3, root_w + (1 - root_w) * np.sin(ts / 0.3 * math.pi / 2),
                        tip + (1 - tip) * np.cos((ts - 0.3) / 0.7 * math.pi / 2) ** 1.15)
        hw = w / 2 * prof
        ht = t / 2 * (1 - 0.45 * ts) + 0.0015
        ht = np.minimum(ht, hw * 0.5 + 0.0012)
        self.part.add(flat_tube(pts, hw, ht, nrs), k)
        return pts

    def flow(self, whorl, az_t, el_t, w, t, ex_t, ex_root=0.0, belly=0.012, tip=0.12, start=0.0, curl=0.0, bend=0.0, n=20, k=0.007, plateau=0.3):
        """
        從髮旋（whorl = (方位角, 仰角)）沿頭型（大圓弧）流到目標 (az_t, el_t) 的柔和髮束。
        start：從弧上第幾成開始（0 = 髮旋；0.4 = 外層較短的髮束）
        ex_t：髮尾離髮殼的高度（越大越蓬、越往外翹）；curl：髮尾往外的額外上勾
        bend：沿路徑往側邊彎（度，正負決定方向），讓髮束有弧度、不是直線
        """
        def d(az, el):
            a, e = math.radians(az), math.radians(el)
            return np.array([math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e)])

        d0, d1 = d(*whorl), d(az_t, el_t)
        om = math.acos(float(np.clip(d0 @ d1, -1, 1)))
        side = unit(np.cross(d0, d1)) if om > 1e-4 else np.array([1.0, 0, 0])
        ts = np.linspace(0, 1, n)
        pts, nrs = [], []
        for s_ in ts:
            g = start + (1 - start) * s_
            dv = (math.sin((1 - g) * om) * d0 + math.sin(g * om) * d1) / max(math.sin(om), 1e-6)
            if bend:
                dv = unit(dv + side * math.radians(bend) * math.sin(math.pi * g) * 0.5)
            ex = (ex_root + ex_t * s_ ** 1.5) * self.ex_scale + belly * math.sin(math.pi * s_)
            p = self.c + dv * (self.r + ex)
            nv = unit(dv / (self.r + ex))
            if curl:
                f = max(0.0, (s_ - 0.7) / 0.3)
                p = p + nv * curl * f * f
            pts.append(p)
            nrs.append(nv)
        # 寬度：髮根略窄 → 大半段維持寬（看得到的部分是寬的髮束）→ 最後一段柔和收尖
        rise = np.clip(ts / 0.15, 0, 1)
        fall = np.clip((ts - plateau) / (1 - plateau), 0, 1)
        prof = (0.75 + 0.25 * np.sin(rise * math.pi / 2)) * (tip + (1 - tip) * (1 - fall ** 1.35))
        hw = w / 2 * prof
        ht = np.minimum(t / 2 * (1 - 0.35 * ts) + 0.0015, hw * 0.4 + 0.0012)
        self.part.add(flat_tube(np.array(pts), hw, ht, nrs), k)

    def lock(self, az0, el0, az1, el1, w, t, lift=0.0, flare=0.0, curl=0.0, tip=0.14, n=12, k=0.01,
             base=None, wide_mid=0.15, twist_az=0.0):
        """
        貼著頭型走的髮束：路徑在頭皮上的 (方位角, 仰角) 之間內插；el < 0 時改成「往下垂」
        （水平位置停在赤道，高度隨 sin(el) 下降），所以兩側、後腦的頭髮會垂直落下而不是貼回下巴。
        lift：整束離開頭皮的高度（隨 t² 增加）；flare：髮尾往外翹；curl：髮尾往上勾
        """
        c, r = self.c, self.r
        b = (self.cap_extra - 0.012) if base is None else base
        ts = np.linspace(0, 1, n)
        pts, nrs = [], []
        for s in ts:
            az = math.radians(az0 + (az1 - az0) * s + twist_az * math.sin(math.pi * s))
            el = math.radians(el0 + (el1 - el0) * s)
            ex = b + lift * s * s
            hor = np.array([math.sin(az), -math.cos(az), 0.0])
            if el >= 0:
                u = np.array([math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el)])
                p = c + u * (r + ex)
                nv = unit(u / (r + ex))
            else:
                shrink = 0.8 + 0.2 * math.cos(el)  # 往下垂時稍微往內收（貼近臉頰，不是帽沿）
                p = c + hor * (r + ex) * np.array([shrink, shrink, 1.0])
                if el >= -math.pi / 2:
                    p[2] = c[2] + (r[2] + ex) * math.sin(el)
                else:
                    p[2] = c[2] - (r[2] + ex) + (el + math.pi / 2) * (r[2] + ex)
                nv = hor
            f = max(0.0, (s - 0.55) / 0.45)
            f = f * f * (3 - 2 * f)
            p = p + hor * flare * f + np.array([0, 0, 1.0]) * curl * f * f
            pts.append(p)
            nrs.append(nv)
        hw = w / 2 * ((1 - ts) ** 0.8 * (1 - tip) + tip) * (1 + wide_mid * np.sin(np.pi * ts))
        ht = t / 2 * (1 - 0.5 * ts) + 0.002
        ht = np.minimum(ht, hw * 0.42 + 0.0015)  # 髮尾保持「扁的葉片」而不是圓管（避免像滴下來的麵條）
        self.part.add(flat_tube(np.array(pts), hw, ht, nrs), k)
        return pts


MALE_SHELL = ((0.0, 0.08, 0.945), (0.25, 0.29, 0.245))
FEMALE_SHELL = ((0.0, 0.035, 0.89), (0.216, 0.225, 0.215))


def shell_cap(H, ear_cut=True):
    """頭髮的基本量體：髮殼橢球，挖掉臉（髮際線以下）與耳朵前方"""
    c, r = H.c, H.r
    H.part.add(ellipsoid(c, r))
    # 臉：額頭以下、前方
    H.part.sub(rbox((0, -0.3, 0.78), (0.17, 0.16, 0.13), 0.04), 0.03)
    if ear_cut:
        # 耳朵與臉頰兩側：髮殼下緣不要包住
        H.part.sub(rbox((0, -0.12, 0.69), (0.4, 0.24, 0.13), 0.03), 0.03)


def male_hair():
    """
    男生（B.1 精修）：蓬鬆有層次的短髮。每一束都是柔和曲面的扁髮束（Catmull-Rom 曲線，中段鼓、髮尾收成柔和的尖），
    由頭頂後方的髮旋往前、往兩側、往後流，互相重疊。
    - 頭頂：幾束從髮旋往前上方拱起，髮尾離開頭皮（設定圖頭頂的蓬鬆與高低層次）
    - 瀏海：5 束不規則、有弧度的分束；中間一束垂到兩眼之間，眼睛上方的髮尾停在眼睛上緣以上
    - 兩側：耳朵高度往外、往上翹的大髮束（正面最寬處）；臉頰旁一束往內收
    - 後腦：兩層往下垂，髮尾微微外翹；後頸收短
    """
    H = Hair("male", cap_extra=0.0, shell=((0.0, 0.06, 0.9), (0.216, 0.236, 0.226)))
    H.drop = False  # 短髮：髮束沿頭型往內收，不是垂直落下（避免像頭套）
    H.ex_scale = 0.68  # 依設定圖輪廓比對，整體髮量外緣收（B.2：頭頂再收一點）
    shell_cap(H)
    W = (180, 62)  # 髮旋：頭頂偏後
    F = H.flow
    # ---- 底層：從髮旋往四周流，蓋滿髮殼（start：髮束從弧線中途開始，看得到的部分保持寬）
    # 瀏海：4 大束＋2 小束，有弧度、往同一側斜掃，長短不一；眼睛上方停在眼睛上緣以上，中間一束到兩眼之間
    for az, el, w, bd, st in ((-44, -12, 0.15, 14, 0.45), (-22, -16, 0.17, 16, 0.42), (2, -24, 0.16, 16, 0.4),
                              (24, -8, 0.17, 12, 0.42), (46, -14, 0.15, 8, 0.45), (-60, -20, 0.12, 6, 0.5)):
        F(W, az, el, w * 0.85, 0.042, 0.04, ex_root=0.008, belly=0.012, bend=bd, tip=0.2, start=st, plateau=0.3)
    # 臉頰旁（往下、往內收）
    for sx in (1, -1):
        F(W, 68 * sx, -36, 0.2, 0.05, 0.05, ex_root=0.01, belly=0.014, bend=-6, tip=0.26, start=0.4, plateau=0.36)
    # 兩側：耳朵上方往外、往上翹（正面最寬 ±0.30～0.33）
    for sx in (1, -1):
        for az, el, ex, cu in ((84, -2, 0.1, 0.04), (102, -8, 0.105, 0.045), (120, -10, 0.09, 0.035), (138, -20, 0.07, 0.02)):
            F(W, az * sx, el, 0.19, 0.055, ex, ex_root=0.012, belly=0.018, curl=cu * 0.7, bend=8, tip=0.26, start=0.3, plateau=0.38)
    # 後腦（往下到後頸，髮尾微翹）
    for i, (az, el, ex) in enumerate(((146, -38, 0.05), (160, -54, 0.035), (172, -66, 0.06), (186, -62, 0.035), (200, -52, 0.06), (214, -38, 0.04))):
        F(W, az, el, 0.16, 0.052, ex, ex_root=0.004 + 0.012 * (i % 2 == 0), belly=0.016, bend=6, tip=0.22, start=0.22, plateau=0.36)
    # ---- 外層：較短、較蓬，疊在底層上（高低層次、頭頂蓬鬆）
    for az, el, ex, st in ((-34, 40, 0.055, 0.2), (14, 46, 0.06, 0.2), (58, 22, 0.07, 0.28), (-72, 30, 0.07, 0.28),
                           (96, 8, 0.075, 0.32), (-104, 14, 0.075, 0.32), (128, 18, 0.06, 0.38), (-132, 2, 0.065, 0.38)):
        F(W, az, el, 0.17, 0.052, ex, ex_root=0.018, belly=0.014, start=st, curl=0.015, bend=8, tip=0.22, plateau=0.36)
    # 後腦第二排（蓋住髮殼下緣，髮尾錯落）
    for i, (az, el) in enumerate(((146, -56), (162, -70), (178, -76), (194, -70), (212, -56), (170, -62), (188, -60))):
        F(W, az, el, 0.13, 0.048, (0.03, 0.05)[i % 2], ex_root=0.015 + 0.01 * (i % 2), belly=0.014, start=0.45 + 0.08 * (i % 2), curl=0.012, tip=0.22, plateau=0.32)
    # 頭頂幾束往上拱（設定圖頭頂的翹髮）：寬、短、髮尾柔和
    for az, el, ex in ((-26, 66, 0.035), (24, 68, 0.04)):
        F(W, az, el, 0.14, 0.05, ex, ex_root=0.015, belly=0.012, start=0.25, curl=0.025, tip=0.22, plateau=0.32)
    # 髮旋：三束短而彎的髮束繞著髮旋轉（看得出旋渦方向，不是一點擠滿）
    for az, el in ((120, 52), (230, 50), (180, 40)):
        F(W, az, el, 0.12, 0.04, 0.02, ex_root=0.008, belly=0.01, bend=28, tip=0.25, plateau=0.35)
    # 呆毛：兩撮往上再往側彎
    for sx, (a1, a2) in ((1, (0.07, 0.12)), (-1, (0.05, 0.09))):
        p0, n = H.pt(8 * sx, 80, 0.01)
        pts = bezier3(p0 - n * 0.02, p0 + np.array([0.0, -0.005, a1]), p0 + np.array([0.03 * sx, -0.03, a2]), p0 + np.array([0.07 * sx, -0.045, a2 * 0.8]), 10)
        ts = np.linspace(0, 1, 10)
        hw = 0.024 * np.cos(ts * math.pi / 2) ** 0.8 + 0.004
        H.part.add(flat_tube(pts, hw, np.minimum(0.012 * (1 - 0.5 * ts) + 0.002, hw * 0.55 + 0.001), [np.array([0, 1.0, 0])] * 10), 0.012)
    return H.part


def strand_pts(part, pts, w, t, nrm, tip=0.16, plateau=0.35, n=18, k=0.008, root_w=0.8, curl_up=None):
    """一般 3D 控制點的柔和扁髮束（馬尾、垂髮用）；nrm：厚度方向（向量或函式 p → 向量）"""
    P = catmull(pts, n)
    ts = np.linspace(0, 1, n)
    rise = np.clip(ts / 0.15, 0, 1)
    fall = np.clip((ts - plateau) / (1 - plateau), 0, 1)
    prof = (root_w + (1 - root_w) * np.sin(rise * math.pi / 2)) * (tip + (1 - tip) * (1 - fall ** 1.35))
    hw = w / 2 * prof
    ht = np.minimum(t / 2 * (1 - 0.35 * ts) + 0.0015, hw * 0.42 + 0.0012)
    N = [unit(nrm(p) if callable(nrm) else np.asarray(nrm, float)) for p in P]
    part.add(flat_tube(P, hw, ht, N), k)


def female_hair():
    """
    女生（B.1 精修）：
    - 頭頂平順、由中分線往後梳向側馬尾
    - 瀏海：中分、細束、有弧度（往兩側彎），束與束之間露出額頭，不是整片下垂
    - 兩側：臉頰外側垂到肩上（約 0.66），髮尾柔和地往外捲，不是尖刺
    """
    H = Hair("female", cap_extra=0.0, shell=FEMALE_SHELL)
    shell_cap(H)
    F = H.flow
    # ---- 頭頂：由中分線往後、往兩側梳（平順、薄、寬）
    PART = (0, 80)
    # 頭頂兩側：從額頭髮際往後梳（側面看是平順、往後拉向馬尾的髮流，耳朵露出來）
    for sx in (1, -1):
        for (a0, e0), (a1, e1) in (((28, 52), (150, 58)), ((46, 34), (140, 38)), ((60, 20), (128, 20)), ((14, 66), (165, 70))):
            F((a0 * sx, e0), a1 * sx, e1, 0.15, 0.026, 0.006, belly=0.006, tip=0.45, plateau=0.6, k=0.01)
    # ---- 瀏海：中分，細束，往兩側彎；中間兩束到兩眼之間，眼睛上方的停在眼睛上緣附近
    # 中分：中間留一條縫露出額頭，兩側的瀏海往外彎成括號形
    # B.2：更輕——每束更窄、更薄，長短不一，束與束之間有空隙（看得到額頭）
    for az, el, w, bd, pa in ((-12, -14, 0.06, 22, -3), (11, -6, 0.065, -22, 3), (-27, -2, 0.07, 18, -6), (25, -10, 0.065, -18, 6),
                              (-42, -14, 0.07, 14, -8), (41, -6, 0.07, -14, 8), (-3, -22, 0.035, 8, -2), (5, -2, 0.04, -10, 1)):
        F((pa, 80), az, el, w, 0.024, 0.01, ex_root=0.003, belly=0.006, bend=bd, tip=0.2, start=0.28, plateau=0.35, k=0.003)
    # ---- 兩側＋後面（B.2）：依設定圖正面輪廓——太陽穴到眼睛高度往外蓬（±0.32），臉頰高度略收，
    # 髮尾在 0.72 附近往外、往上捲（±0.37）。拆成「外層大髮束＋內層短髮束」，每束 S 形、長短不一、之間留間隙
    H.drop = True
    S = H.strand

    def clump(az, prof, w, t=0.034, k=0.003, tip=0.16, dr=0.0):
        """prof：[(仰角, 離髮殼), ...] 由上往下；dr：S 形左右擺動（度）"""
        prof = [(76, -0.006), (44, prof[0][1] + 0.012)] + list(prof[1:])  # 從頭頂分線一路流下來（不在頭頂留一圈稜線）
        n = len(prof)
        kn = []
        for i, (el, ex) in enumerate(prof):
            wig = dr * math.sin(i / max(n - 1, 1) * math.pi * 1.5)
            kn.append((az + wig, el, ex))
        S(kn, w, t, tip=tip, k=k)

    OUT = [(46, 0.0), (8, 0.1), (-24, 0.13), (-56, 0.17), (-84, 0.18), (-81, 0.21)]
    for sx in (1, -1):
        # 臉旁一束（耳朵前面）：細、貼著臉頰往下到 0.70，髮尾往外捲
        clump(54 * sx, [(46, 0.0), (10, 0.02), (-30, 0.025), (-60, 0.04), (-74, 0.065), (-71, 0.09)], 0.075, t=0.024, dr=3 * sx)
        # 外層：耳後的三大束（正面看得到的蓬鬆兩側；側面看在耳朵後方）
        clump(108 * sx, [(e, x * 0.95) for e, x in OUT[:-1]] + [(-82, 0.2)], 0.17, dr=-4 * sx)
        clump(130 * sx, [(e if e > -80 else e - 6, x) for e, x in OUT], 0.18, dr=5 * sx)
        clump(152 * sx, [(e, x * 0.85) for e, x in OUT[:-2]] + [(-80, 0.15), (-77, 0.18)], 0.17, dr=-3 * sx)
        # 內層：較短、較貼，在外層後面
        for az in (118, 141):
            clump(az * sx, [(42, -0.004), (6, 0.06), (-26, 0.085), (-56, 0.11), (-78, 0.12)], 0.15, t=0.032, tip=0.2)
    # 後面：兩大束＋中間一束（略短），內層補底
    clump(166, [(e, x * 0.7) for e, x in OUT], 0.17, dr=-4)
    clump(194, [(e, x * 0.7) for e, x in OUT], 0.17, dr=4)
    clump(180, [(44, 0.0), (6, 0.06), (-30, 0.075), (-60, 0.09), (-80, 0.1), (-77, 0.12)], 0.15, dr=2)
    for az in (168, 192):
        clump(az, [(40, -0.004), (4, 0.045), (-30, 0.06), (-60, 0.07), (-76, 0.08)], 0.16, t=0.032, tip=0.2)
    # 呆毛：兩撮細細的弧（設定圖頭頂的兩根）
    for sx, (az, a_, b_) in ((1, (-4, 0.07, 0.055)), (-1, (8, 0.055, 0.04))):
        p0, n = H.pt(az, 84, 0.0, True)
        pts = bezier3(p0 - n * 0.02, p0 + np.array([0, 0, a_ * 0.7]), p0 + np.array([-0.035 * sx, -0.03, a_]), p0 + np.array([-0.06 * sx, -0.06, b_ * 0.7]), 10)
        ts = np.linspace(0, 1, 10)
        hw = 0.016 * np.cos(ts * math.pi / 2) ** 0.7 + 0.003
        H.part.add(flat_tube(pts, hw, np.minimum(0.009 * (1 - 0.4 * ts) + 0.002, hw * 0.6 + 0.001), [np.array([0, 1.0, 0])] * 10), 0.008)
    return H


BOW_C = np.array([0.17, 0.16, 1.075])


def female_ponytail_and_bow(H):
    """
    側馬尾（角色左後上方，從蝴蝶結下方往後拱、再往下垂到約 0.70，髮尾往外捲）＋大蝴蝶結（獨立零件，之後可換）
    馬尾由 7 束不同寬度、彎曲的扁髮束疊成（蓬鬆、有層次），蝴蝶結的圈是有稜角的布塊（中間鼓、邊緣圓角）
    """
    tail = Part("ponytail", "hair", step=0.003)
    root = BOW_C + np.array([-0.02, 0.03, -0.03])
    # B.2：S 形——從蝴蝶結下方先往後上拱、往後鼓，再往下垂，髮尾往前、往外勾回；6 束長短寬窄不同，前後錯開
    for dy, dz, dx, w, L, sw in ((0.0, 0.0, 0.0, 0.13, 0.0, 0.0), (0.03, 0.03, 0.02, 0.11, 0.04, 0.02), (-0.02, -0.02, -0.015, 0.11, -0.03, -0.02),
                                 (0.05, 0.01, 0.03, 0.1, 0.06, 0.03), (0.02, -0.04, 0.025, 0.1, -0.05, -0.01), (0.06, -0.01, -0.02, 0.09, 0.02, 0.035)):
        p0 = root + np.array([dx, dy, dz]) * 0.3
        pts = [p0,
               p0 + np.array([0.015, 0.09 + dy * 0.3, 0.035]),
               np.array([0.19 + dx, 0.36 + dy, 1.0 + dz * 0.6]),
               np.array([0.205 + dx, 0.43 + dy + sw, 0.9 + dz * 0.5]),
               np.array([0.21 + dx * 1.2, 0.39 + dy * 0.8 - sw, 0.8 + dz * 0.3 + L * 0.3]),
               np.array([0.2 + dx * 1.4, 0.41 + dy + sw, 0.72 + L]),
               np.array([0.19 + dx * 1.5, 0.37 + dy * 0.7 + sw, 0.68 + L * 1.1])]
        strand_pts(tail, pts, w, 0.04, lambda p: unit(np.array([1.0, 0.3, 0.0])), tip=0.16, plateau=0.4, n=24, k=0.004)
    tail.add(ellipsoid(root, (0.045, 0.05, 0.04)), 0.02)
    bow = Part("bow", "cloth", step=0.002)
    bc = BOW_C
    Rz = rot((0, 0, 1), -45)
    U = Rz @ np.array([0, 1.0, 0])   # 往後（並往角色左外側）
    V = np.array([0, 0, 1.0])
    Nf = np.cross(U, V)              # 蝴蝶結正面：朝角色左前方
    sc = 1.25
    # 每個圈：靠近結的地方窄（捏起來）、往外變寬，外緣兩個轉角明顯 → 有稜角的蝴蝶結
    loops = ([(0.0, 0.0), (0.025, 0.015), (0.05, 0.125), (-0.005, 0.145), (-0.075, 0.11), (-0.025, 0.012)],  # 上圈（往上、往頭頂中間）
             [(0.0, -0.008), (0.02, 0.012), (0.15, 0.075), (0.175, 0.02), (0.155, -0.055), (0.02, -0.03)],  # 後圈（往後外側）
             [(0.0, -0.012), (-0.02, 0.012), (-0.1, 0.03), (-0.115, -0.025), (-0.08, -0.06), (-0.015, -0.03)])  # 前下小圈
    for poly in loops:
        bow.add(pillow(bc + Nf * 0.004, U, V, [(x * sc, y * sc) for x, y in poly], 0.028, 0.011, 0.75), 0.008)
    # 結
    bow.add(ellipsoid(bc + Nf * 0.012, (0.03, 0.03, 0.034), np.column_stack([U, Nf, V])), 0.008)
    # 兩條緞帶尾巴（往下，末端 V 形剪口）
    for poly in ([(0.0, -0.02), (0.042, -0.03), (0.1, -0.16), (0.08, -0.2), (0.05, -0.17)],
                 [(-0.012, -0.022), (0.014, -0.03), (-0.002, -0.11), (-0.028, -0.13), (-0.04, -0.1)]):
        bow.add(pillow(bc - Nf * 0.006, U, V, [(x * sc, y * sc) for x, y in poly], 0.009, 0.004, 0.3), 0.005)
    deco = Part("bow_star", "metal", step=0.0015)
    deco.add(star_prim(bc + Nf * 0.045 + V * 0.003, Nf, (0, 0, 1), 0.03, 0.013, 5, 0.012))
    return tail, bow, deco


# ================================================================== 身體（皮膚）


def body_part(g):
    """軀幹＋手臂＋腿（之後換裝時的底模；大部分被衣服蓋住）"""
    p = Part("body", "skin", step=0.004)
    if g == "male":
        p.add(ellipsoid((0, 0.0, 0.36), (0.12, 0.08, 0.09)))
        p.add(ellipsoid((0, 0.0, 0.5), (0.092, 0.065, 0.12)), 0.05)
        p.add(ellipsoid((0, 0.0, 0.575), (0.092, 0.06, 0.05)), 0.04)
    else:
        p.add(ellipsoid((0, 0.005, 0.37), (0.11, 0.08, 0.09)))
        p.add(ellipsoid((0, 0.0, 0.5), (0.095, 0.07, 0.12)), 0.05)
        p.add(ellipsoid((0, 0.0, 0.585), (0.095, 0.065, 0.05)), 0.04)
    A = arm_joints(g)
    L = leg_joints(g)
    for sx in (1, -1):
        sh, el, wr = [np.array([v[0] * sx, v[1], v[2]]) for v in A]
        p.add(capsule(sh, el, 0.036, 0.031), 0.02)
        p.add(capsule(el, wr, 0.031, 0.027), 0.01)
        hip, kn, an = [np.array([v[0] * sx, v[1], v[2]]) for v in L]
        p.add(capsule(hip, kn, 0.055, 0.042), 0.03)
        p.add(capsule(kn, an, 0.042, 0.034), 0.01)
    return p


def arm_joints(g):
    """肩、肘、腕（角色左側；右側鏡像）"""
    if g == "male":
        return (0.095, 0.0, 0.582), (0.172, 0.0, 0.5), (0.212, -0.008, 0.438)
    return (0.09, 0.0, 0.598), (0.158, 0.0, 0.528), (0.212, -0.01, 0.47)


def leg_joints(g):
    """髖、膝、踝（角色左側）；男生腳開、女生併腿（依設定圖站姿）"""
    if g == "male":
        return (0.065, 0.0, 0.33), (0.097, -0.005, 0.205), (0.112, 0.0, 0.07)
    return (0.055, 0.0, 0.34), (0.065, -0.005, 0.235), (0.067, 0.0, 0.07)


# ================================================================== 手（完整五指）


def hand_prims(wrist, d, c, b, scale, pose, grow=0.0):
    """
    手：手掌＋五指（拇指 2 節、其他 3 節）。
    wrist：手腕；d：手掌往指尖方向；c：掌心朝向；b：拇指那一側
    pose：'fist'（握拳）或 'relaxed'（自然半握）；grow：外擴（手套用）
    """
    d, c, b = unit(d), unit(c), unit(b)
    W = np.asarray(wrist, float)

    def P(a, bb, cc):
        return W + (d * a + b * bb + c * cc) * scale

    s = scale
    prims = []
    # 手掌（圓角盒，沿 d、b、c）
    R = np.stack([b, c, d], 1)  # 欄 = 盒子的 x、y、z 軸
    prims.append(rbox(P(0.045, 0.0, -0.002), np.array([0.034, 0.012, 0.03]) * s, 0.012 * s + grow, R))
    fingers = [(0.03, 0.95, 0.0128), (0.0105, 1.0, 0.0132), (-0.0105, 0.96, 0.0128), (-0.03, 0.8, 0.0115)]
    for bb, ln, r in fingers:
        k = P(0.078, bb, 0.0)
        if pose == "fist":
            seg = [(0.022, 0.0, 0.016), (-0.004, 0.0, 0.022), (-0.017, 0.0, 0.006)]
        else:
            seg = [(0.027, 0.0, 0.008), (0.021, 0.0, 0.012), (0.015, 0.0, 0.012)]
        pts = [k]
        for da, db, dc in seg:
            pts.append(pts[-1] + (d * da + b * db + c * dc) * s * ln)
        rr = r * s
        for i in range(3):
            prims.append(capsule(pts[i], pts[i + 1], rr * (1 - 0.08 * i) + grow, rr * (1 - 0.08 * (i + 1)) + grow))
    # 拇指
    if pose == "fist":
        tp = [P(0.022, 0.035, 0.008), P(0.045, 0.05, 0.026), P(0.068, 0.03, 0.036)]
    else:
        tp = [P(0.022, 0.035, 0.008), P(0.045, 0.052, 0.02), P(0.066, 0.05, 0.03)]
    prims.append(capsule(tp[0], tp[1], 0.015 * s + grow, 0.014 * s + grow))
    prims.append(capsule(tp[1], tp[2], 0.014 * s + grow, 0.0125 * s + grow))
    return prims


def hand_frames(g, sx):
    """每隻手的方向。男：握拳、掌心朝前、拇指朝內；女：半握、掌心朝內下方"""
    wr = np.array(arm_joints(g)[2]) * [sx, 1, 1]
    if g == "male":
        d = unit([0.12 * sx, -0.02, -1.0])
        c = np.array([0.0, -1.0, 0.0])
        b = unit(np.cross(d, c)) * (-sx)
        b = unit(b - d * (b @ d))
        return wr, d, unit(c - d * (c @ d)), b, 1.2, "fist"
    d = unit([0.35 * sx, -0.08, -1.0])
    c = unit([-0.6 * sx, -0.5, 0.0])
    c = unit(c - d * (c @ d))
    b = unit(np.cross(d, c)) * (-sx)
    return wr, d, c, b, 0.86, "relaxed"


def hand_parts(g):
    out = []
    for sx, nm in ((1, "hand_l"), (-1, "hand_r")):
        wr, d, c, b, s, pose = hand_frames(g, sx)
        p = Part(nm, "skin", step=0.0018)
        for i, pr in enumerate(hand_prims(wr, d, c, b, s, pose)):
            p.add(pr, 0.0 if i == 0 else 0.004)
        out.append(p)
    return out


def glove_parts(g):
    """手套（獨立外觀）：男 = 全指手套＋袖口＋鉚釘；女 = 露指手套（手指前兩節露出）"""
    out = []
    for sx, nm in ((1, "glove_l"), (-1, "glove_r")):
        wr, d, c, b, s, pose = hand_frames(g, sx)
        p = Part(nm, "leather", step=0.0018)
        prims = hand_prims(wr, d, c, b, s, pose, grow=0.0045)
        if g == "male":
            for i, pr in enumerate(prims):
                p.add(pr, 0.0 if i == 0 else 0.005)
        else:
            # 只包手掌、拇指第一節、四指第一節
            p.add(prims[0])
            for i in (1, 4, 7, 10):
                p.add(prims[i], 0.004)
            p.add(prims[13], 0.004)
        # 袖口：往手肘方向張開的短筒
        el = np.array(arm_joints(g)[1]) * [sx, 1, 1]
        cu0 = wr + unit(el - wr) * 0.004
        cu1 = wr + unit(el - wr) * (0.045 if g == "male" else 0.035)
        p.add(capsule(cu0, cu1, 0.036 if g == "male" else 0.032, 0.046 if g == "male" else 0.04), 0.006)
        out.append(p)
        if g == "male":
            rv = Part(nm.replace("glove", "rivet"), "metal", step=0.0015)
            for k, ang in enumerate((-40, 40)):
                ax = unit(el - wr)
                side = unit(np.cross(ax, [0, 0, 1]))
                rv.add(sphere(wr + ax * 0.03 + (rot(ax, ang) @ np.array([0, -1.0, 0])) * 0.045, 0.006))
            out.append(rv)
    return out


# ================================================================== 靴子


def boot_parts(g):
    out = []
    an = leg_joints(g)[2]
    if g == "male":
        shaft_r, top, cuff, toe, heel, width, h = 0.062, 0.19, (0.126, 0.19), -0.151, 0.098, 0.165, 0.082
    else:
        shaft_r, top, cuff, toe, heel, width, h = 0.05, 0.198, (0.145, 0.198), -0.094, 0.109, 0.122, 0.07
    for sx, nm in ((1, "boot_l"), (-1, "boot_r")):
        x = an[0] * sx
        p = Part(nm, "leather", step=0.0025)
        # 靴筒（上方略寬）
        p.add(cyl(x, 0.02, 0.03, top, shaft_r * 0.95, shaft_r * 1.04))
        ln = (heel - toe) / 2
        # 腳背＋圓胖鞋頭（Q 版靴子的鞋頭往前、往上鼓）
        p.add(ellipsoid((x, (heel + toe) / 2 + 0.01, h * 0.48), (width / 2 * 0.92, ln * 0.9, h * 0.5)), 0.03)
        p.add(ellipsoid((x, toe + 0.05, h * 0.5), (width / 2, 0.055, h * 0.58)), 0.025)
        # 鞋跟
        p.add(rbox((x, heel - 0.03, 0.016), (width / 2 * 0.8, 0.028, 0.016), 0.006), 0.008)
        # 鞋底（較平、稍寬）
        p.add(ellipsoid((x, (heel + toe) / 2, 0.011), (width / 2 + 0.004, ln + 0.004, 0.013)), 0.008)
        # 翻邊（往上張開）
        p.add(cyl(x, 0.02, cuff[0], cuff[1] + 0.006, shaft_r + 0.012, shaft_r + 0.024), 0.005)
        out.append(p)
        if g == "male":
            em = Part(nm.replace("boot", "boot_gem"), "metal", step=0.0015)
            em.add(rbox((x, 0.02 - (shaft_r + 0.026), (cuff[0] + cuff[1]) / 2 + 0.002), (0.016, 0.004, 0.016), 0.002, rot((0, 1, 0), 45)))
            out.append(em)
        else:
            st = Part(nm.replace("boot", "boot_strap"), "metal", step=0.0015)
            for zz in (0.085, 0.13):
                st.add(rbox((x, 0.02 - (shaft_r + 0.004), zz), (0.016, 0.004, 0.009), 0.002))
            out.append(st)
    return out


# ================================================================== 男生服裝


def lerp_fn(pairs):
    zs = np.array([p[0] for p in pairs])
    vs = np.array([p[1] for p in pairs])
    return lambda z: np.interp(z, zs, vs)


def male_clothes():
    out = []
    A = arm_joints("male")
    # 白色短袖上衣（軀幹＋短袖）
    shirt = Part("shirt", "cloth", step=0.004)
    shirt.add(lathe_shell(0.43, 0.66, lerp_fn([(0.43, 0.093), (0.5, 0.085), (0.56, 0.087), (0.6, 0.085), (0.635, 0.067), (0.66, 0.035)]), lerp_fn([(0.43, 0.065), (0.5, 0.059), (0.56, 0.061), (0.6, 0.057), (0.66, 0.03)]), 0.03))
    for sx in (1, -1):
        sh, el, _ = [np.array([v[0] * sx, v[1], v[2]]) for v in A]
        ax = unit(el - sh)
        # 短袖：往袖口微微張開
        shirt.add(capsule(sh - (el - sh) * 0.05, sh + (el - sh) * 0.62, 0.047, 0.055), 0.025)
    out.append(shirt)
    sleeve_trim = Part("sleeve_trim", "metal", step=0.0025)
    for sx in (1, -1):
        sh, el, _ = [np.array([v[0] * sx, v[1], v[2]]) for v in A]
        sleeve_trim.add(torus(sh + (el - sh) * 0.64, 0.055, 0.0095, axis=el - sh))
    out.append(sleeve_trim)
    # 藍色背心（前開、金邊）
    vest = Part("vest", "cloth2", step=0.003)
    vest.add(lathe_shell(0.45, 0.635, lerp_fn([(0.45, 0.117), (0.52, 0.109), (0.58, 0.111), (0.62, 0.106), (0.635, 0.095)]), lerp_fn([(0.45, 0.088), (0.52, 0.082), (0.58, 0.084), (0.635, 0.078)]), 0.012, open_front_deg=26))
    for sx in (1, -1):  # 肩片
        vest.add(ellipsoid((0.095 * sx, 0.0, 0.618), (0.045, 0.062, 0.02), rot((0, 1, 0), 22 * sx)), 0.015)
    out.append(vest)
    vtrim = Part("vest_trim", "metal", step=0.0025)
    for sx in (1, -1):
        th = math.radians(26) * sx
        pts = [np.array([math.sin(th) * (rx + 0.004), -math.cos(th) * (ry + 0.004), z]) for z, rx, ry in ((0.45, 0.117, 0.088), (0.52, 0.109, 0.082), (0.58, 0.111, 0.084), (0.625, 0.1, 0.08))]
        for i in range(len(pts) - 1):
            vtrim.add(capsule(pts[i], pts[i + 1], 0.006), 0.004)
    vtrim.add(lathe_shell(0.443, 0.456, lambda z: 0.131 + 0 * z, lambda z: 0.094 + 0 * z, 0.01, open_front_deg=26))
    out.append(vtrim)
    # 胸前交叉綁帶
    lace = Part("lace", "leather", step=0.0015)
    for a, b in (((-0.022, 0.605), (0.022, 0.54)), ((0.022, 0.605), (-0.022, 0.54)), ((-0.024, 0.573), (0.024, 0.573))):
        lace.add(capsule((a[0], -0.082, a[1]), (b[0], -0.082, b[1]), 0.0045))
    out.append(lace)
    # 圍巾：頸圈＋前方垂片＋後方長飄帶
    scarf = Part("scarf", "cloth2", step=0.003)
    scarf.add(torus((0, 0.01, 0.655), 0.07, 0.032, flat=0.7), 0.0)
    pts = bezier3(np.array([0, -0.07, 0.668]), np.array([0, -0.11, 0.645]), np.array([0, -0.115, 0.62]), np.array([0, -0.108, 0.6]), 6)
    scarf.add(flat_tube(pts, np.linspace(0.075, 0.012, 6), np.full(6, 0.008), [np.array([0, -1.0, 0])] * 6), 0.015)
    # 背後一小段飄起的圍巾尾（設定圖側面：肩後短短飄出）
    # 圍巾長尾：從脖子左後方往後、往下飄（設定圖側面：飄到臀部高度，尾端尖）
    pts = catmull([(0.045, 0.07, 0.655), (0.085, 0.13, 0.6), (0.11, 0.18, 0.48), (0.12, 0.23, 0.37), (0.115, 0.27, 0.27)], 14)
    ts = np.linspace(0, 1, 14)
    hw = 0.06 * (0.8 + 0.2 * np.sin(np.clip(ts / 0.2, 0, 1) * math.pi / 2)) * (0.12 + 0.88 * (1 - np.clip((ts - 0.35) / 0.65, 0, 1) ** 1.3))
    scarf.add(flat_tube(pts, hw, np.minimum(0.009, hw * 0.4 + 0.002), [unit(np.array([1.0, -0.15, 0.0]))] * 14), 0.02)
    out.append(scarf)
    # 腰帶、方扣、腰包
    belt = Part("belt", "leather", step=0.0025)
    belt.add(lathe_shell(0.413, 0.457, lambda z: 0.128 + 0 * z, lambda z: 0.092 + 0 * z, 0.014))
    out.append(belt)
    buckle = Part("buckle", "metal", step=0.0015)
    buckle.add(rbox((0, -0.103, 0.435), (0.022, 0.004, 0.017), 0.003)).sub(rbox((0, -0.11, 0.435), (0.011, 0.02, 0.008), 0.002))
    out.append(buckle)
    pouch = Part("pouch", "leather", step=0.002)
    pouch.add(rbox((-0.115, -0.07, 0.36), (0.036, 0.022, 0.042), 0.017, rot((0, 0, 1), 22)))
    pouch.add(rbox((-0.117, -0.092, 0.385), (0.036, 0.006, 0.024), 0.006, rot((0, 0, 1), 22)), 0.004)
    pouch.add(capsule((-0.1, -0.06, 0.44), (-0.11, -0.075, 0.4), 0.007), 0.004)
    out.append(pouch)
    # 深灰短褲
    shorts = Part("shorts", "dark", step=0.004)
    shorts.add(ellipsoid((0, 0.0, 0.37), (0.138, 0.092, 0.09)))
    L = leg_joints("male")
    for sx in (1, -1):
        hip, kn, _ = [np.array([v[0] * sx, v[1], v[2]]) for v in L]
        shorts.add(capsule(hip, hip + (kn - hip) * 0.8, 0.07, 0.068), 0.03)
    shorts.inter(rbox((0, 0, 0.345), (0.3, 0.3, 0.098), 0.0))
    out.append(shorts)
    # 藍色下擺（正面左右兩片＋背面一大片，尖角、金邊）
    def hem(th):
        a = np.degrees(np.abs(th))
        base = 0.245 - 0.01 * np.clip((a - 60) / 120, 0, 1)
        tips = -0.1 * np.exp(-(((a - 36) / 9) ** 2)) - 0.08 * np.exp(-(((a - 82) / 12) ** 2)) - 0.04 * np.exp(-(((a - 122) / 9) ** 2)) - 0.05 * np.exp(-(((a - 180) / 10) ** 2))
        return base + tips

    OPEN_M = lerp_fn([(0.15, 30), (0.45, 32)])
    # 下擺：掛在腰帶上，正面大開口（短褲完全露出），兩側與背後往外、往後擺
    rxf = lerp_fn([(0.15, 0.29), (0.3, 0.2), (0.45, 0.137)])
    ryf = lerp_fn([(0.15, 0.22), (0.3, 0.15), (0.45, 0.096)])
    cyf = lerp_fn([(0.15, 0.085), (0.45, 0.0)])
    tab = Part("tabard", "cloth2", step=0.003)
    tab.add(lathe_shell(0.15, 0.45, rxf, ryf, 0.012, cy_fn=cyf, open_front_deg=OPEN_M, hem_fn=hem))
    out.append(tab)
    ttrim = Part("tabard_trim", "metal", step=0.0025)
    ttrim.add(lathe_shell(0.15, 0.45, lambda z: rxf(z) + 0.004, lambda z: ryf(z) + 0.004, 0.01, cy_fn=cyf, open_front_deg=OPEN_M, hem_fn=hem))
    # 只留下緣 2.4 公分＋正面開口的直邊
    def trim_zone(P):
        th = np.arctan2(P[..., 0], -(P[..., 1] - cyf(np.clip(P[..., 2], 0.15, 0.45))))
        d_hem = P[..., 2] - (hem(th) + 0.024)
        d_edge = (np.abs(th) - np.radians(OPEN_M(np.clip(P[..., 2], 0.15, 0.45)) + 8)) * 0.2
        return np.minimum(d_hem, d_edge)
    ttrim.inter(Prim(trim_zone, (-0.3, -0.3, 0.05), (0.3, 0.4, 0.5)))
    out.append(ttrim)
    star = Part("tabard_star", "metal", step=0.0015)
    star.add(star_prim((0, 0.17, 0.33), (0, 1, 0.25), (0, 0, 1), 0.055, 0.014, 4, 0.006))
    out.append(star)
    return out


# ================================================================== 女生服裝


def female_clothes():
    out = []
    A = arm_joints("female")
    blouse = Part("blouse", "cloth", step=0.004)
    blouse.add(lathe_shell(0.47, 0.67, lerp_fn([(0.47, 0.083), (0.53, 0.077), (0.58, 0.083), (0.62, 0.08), (0.65, 0.058), (0.67, 0.033)]), lerp_fn([(0.47, 0.065), (0.53, 0.063), (0.58, 0.07), (0.62, 0.065), (0.67, 0.03)]), 0.03))
    for sx in (1, -1):
        sh, el, _ = [np.array([v[0] * sx, v[1], v[2]]) for v in A]
        blouse.add(ellipsoid(sh + (el - sh) * 0.22 + [0.01 * sx, 0, 0.0], (0.044, 0.044, 0.038)), 0.015)  # 泡泡袖
    out.append(blouse)
    arm = Part("armband", "leather", step=0.002)
    for sx in (1, -1):
        sh, el, _ = [np.array([v[0] * sx, v[1], v[2]]) for v in A]
        arm.add(torus(sh + (el - sh) * 0.72, 0.031, 0.006, axis=el - sh, flat=1.3))
    out.append(arm)
    collar = Part("choker", "leather", step=0.002)
    collar.add(torus((0, 0.025, 0.679), 0.046, 0.009, flat=1.3))
    out.append(collar)
    gem = Part("gems", "metal", step=0.0015)
    gem.add(ellipsoid((0, -0.03, 0.672), (0.01, 0.006, 0.013)))
    gem.add(ellipsoid((0, -0.088, 0.615), (0.014, 0.008, 0.018)))
    out.append(gem)
    corset = Part("corset", "leather", step=0.003)
    corset.add(lathe_shell(0.46, 0.56, lerp_fn([(0.46, 0.108), (0.51, 0.104), (0.56, 0.108)]), lerp_fn([(0.46, 0.09), (0.51, 0.086), (0.56, 0.09)]), 0.012))
    out.append(corset)
    belt = Part("belt", "leather", step=0.0025)
    belt.add(lathe_shell(0.489, 0.531, lambda z: 0.113 + 0 * z, lambda z: 0.095 + 0 * z, 0.012))
    out.append(belt)
    buckle = Part("buckle", "metal", step=0.0015)
    buckle.add(rbox((0, -0.104, 0.51), (0.017, 0.004, 0.014), 0.003)).sub(rbox((0, -0.11, 0.51), (0.008, 0.02, 0.006), 0.002))
    out.append(buckle)
    panel = Part("front_panel", "cloth2", step=0.002)
    pts = bezier3(np.array([0, -0.1, 0.49]), np.array([0, -0.11, 0.45]), np.array([0, -0.12, 0.41]), np.array([0, -0.128, 0.37]), 6)
    panel.add(flat_tube(pts, np.linspace(0.03, 0.012, 6), np.full(6, 0.005), [np.array([0, -1.0, 0])] * 6))
    out.append(panel)
    # 白色荷葉襯裙＋粉色層（波浪下緣）
    def ruffle(n, amp, ph=0.0):
        return lambda th, z: 1 + amp * np.sin(n * th + ph) * np.clip((0.43 - z) / 0.08, 0, 1)

    pet = Part("petticoat", "cloth", step=0.003)
    pet.add(lathe_shell(0.341, 0.49, lerp_fn([(0.341, 0.2), (0.42, 0.15), (0.49, 0.108)]), lerp_fn([(0.341, 0.175), (0.42, 0.13), (0.49, 0.09)]), 0.008, wave=ruffle(14, 0.06)))
    out.append(pet)
    pink = Part("skirt_pink", "cloth", step=0.003)
    pink.add(lathe_shell(0.37, 0.5, lerp_fn([(0.37, 0.2), (0.44, 0.15), (0.5, 0.11)]), lerp_fn([(0.37, 0.175), (0.44, 0.135), (0.5, 0.093)]), 0.008, wave=ruffle(12, 0.07, 0.5)))
    out.append(pink)
    bl = Part("bloomers", "cloth", step=0.004)
    bl.add(ellipsoid((0, 0.005, 0.39), (0.11, 0.085, 0.06)))
    out.append(bl)

    # 紫色外裙（前開、兩側長尖尾、背面較長）
    def ohem(th):
        a = np.degrees(np.abs(th))
        base = 0.255 - 0.0 * a
        return base - 0.1 * np.exp(-(((a - 46) / 10) ** 2)) - 0.05 * np.exp(-(((a - 80) / 14) ** 2)) - 0.035 * np.exp(-(((a - 125) / 12) ** 2)) + 0.015 * np.cos(np.radians(a) * 9) * (a > 60)

    osk = Part("overskirt", "cloth2", step=0.003)
    osk.add(lathe_shell(0.15, 0.5, lerp_fn([(0.15, 0.39), (0.33, 0.23), (0.5, 0.115)]), lerp_fn([(0.17, 0.22), (0.33, 0.16), (0.5, 0.097)]), 0.012, cy_fn=lerp_fn([(0.17, 0.085), (0.5, 0.0)]), open_front_deg=40, hem_fn=ohem))
    out.append(osk)
    otrim = Part("overskirt_trim", "metal", step=0.0025)
    otrim.add(lathe_shell(0.15, 0.5, lerp_fn([(0.15, 0.394), (0.33, 0.234), (0.5, 0.119)]), lerp_fn([(0.17, 0.224), (0.33, 0.164), (0.5, 0.101)]), 0.01, cy_fn=lerp_fn([(0.17, 0.085), (0.5, 0.0)]), open_front_deg=40, hem_fn=ohem))
    otrim.inter(Prim(lambda P: P[..., 2] - (ohem(np.arctan2(P[..., 0], -(P[..., 1] - 0.0))) + 0.02), (-0.3, -0.3, 0.1), (0.3, 0.3, 0.5)))
    out.append(otrim)
    emb = Part("overskirt_emblem", "metal", step=0.0015)
    emb.add(star_prim((0, 0.2, 0.33), (0, 1, 0.35), (0, 0, 1), 0.04, 0.016, 4, 0.005))
    out.append(emb)
    return out


# ================================================================== 組合


def build(g):
    parts = [head_part(g), body_part(g)] + hand_parts(g) + glove_parts(g) + boot_parts(g)
    if g == "male":
        parts.append(male_hair())
        parts += male_clothes()
    else:
        H = female_hair()
        parts.append(H.part)
        parts += list(female_ponytail_and_bow(H))
        parts += female_clothes()
    return parts
