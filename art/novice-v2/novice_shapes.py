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

from sdf import cyl, Part, Prim, bezier3, capsule, ellipsoid, flat_tube, lathe_shell, rbox, rot, smin, sphere, torus, unit

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
        self.part.add(flat_tube(np.array(pts), hw, ht, nrs), k)
        return pts


MALE_SHELL = ((0.0, 0.08, 0.945), (0.25, 0.29, 0.245))
FEMALE_SHELL = ((0.0, 0.035, 0.89), (0.212, 0.225, 0.215))


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
    男生：蓬鬆、有層次的短髮。所有髮束都貼著髮殼由頭頂往下流，只在髮尾往外翹（不是往上豎的尖刺）。
    設定圖量測：頭頂約 1.15（呆毛與小翹髮到 1.22）、兩側最寬 ±0.30～0.33（耳朵高度的外翹髮尾）、
    側面前緣（瀏海）約 −0.25、後腦到 +0.36。
    """
    H = Hair("male", cap_extra=0.0, shell=MALE_SHELL)
    shell_cap(H)
    # 第 1 層：頭頂的髮旋往四周放射（寬、厚、互相重疊）
    for i, az in enumerate(range(0, 360, 26)):
        H.lock(az, 88, az + 10 * (-1) ** i, 22, 0.17, 0.06, lift=0.018, flare=0.012, curl=0.0, tip=0.1, k=0.016)
    # 第 2 層：臉側較短（露出臉頰），耳後與後腦往下垂，髮尾往外翹
    for i, az in enumerate((62, 76)):
        for sx in (1, -1):
            H.lock(az * sx, 50, (az + 5) * sx, -6, 0.13, 0.055, lift=0.02, flare=0.03, curl=0.02, tip=0.08, k=0.012)
    for i, az in enumerate(range(96, 266, 17)):
        L = -36 if abs(az - 180) > 55 else -50
        fl = (0.025, 0.065)[i % 2]
        H.lock(az, 50, az + 7 * (-1) ** i, L + 8 * (i % 2), 0.14, 0.06, lift=0.018, flare=fl, curl=0.02 + fl * 0.4, tip=0.05, k=0.01)
    # 後頸：短、內收
    for az in (160, 180, 200):
        H.lock(az, 10, az, -66, 0.11, 0.05, lift=0.0, flare=0.015, curl=0.0, tip=0.12, k=0.012)
    # 耳朵上方的外翹髮尾（正面輪廓最寬處）
    for sx in (1, -1):
        for az, el1, fl in ((86, -20, 0.065), (104, -26, 0.075), (124, -30, 0.06)):
            H.lock(az * sx, 35, (az + 6) * sx, el1, 0.13, 0.05, lift=0.02, flare=fl, curl=0.035, tip=0.07, k=0.01)
    # 鬢角：耳朵前方往下、貼臉
    for sx in (1, -1):
        H.lock(64 * sx, 30, 66 * sx, -36, 0.06, 0.03, lift=-0.02, flare=0.0, curl=0.0, tip=0.14, k=0.01)
    # 瀏海：由頭頂往前、往下蓋住額頭到眉毛，前緣凸出臉，中間一束垂到兩眼之間
    for az, el1, w in ((-54, -24, 0.1), (-38, -18, 0.1), (-21, -14, 0.1), (-5, -24, 0.09), (11, -14, 0.1), (27, -17, 0.1), (43, -19, 0.1), (57, -25, 0.09)):
        H.lock(az * 0.5, 75, az, el1, w, 0.05, lift=0.04, flare=0.0, curl=0.008, tip=0.05, k=0.008)
    # 頭頂的翹髮：短、往外上方翹出（打破圓頂輪廓，像設定圖頭頂的亂翹）
    for az, el, up, out in ((35, 62, 0.035, 0.07), (-40, 60, 0.03, 0.07), (150, 64, 0.035, 0.075), (210, 62, 0.035, 0.075), (100, 46, 0.015, 0.075), (-100, 46, 0.015, 0.075), (-15, 76, 0.04, 0.05)):
        p0, n = H.surf(az, el, 0.0)
        hor = unit(np.array([n[0], n[1], 0.0]))
        tipp = p0 + hor * out + np.array([0, 0, up])
        pts = bezier3(p0 - n * 0.02 - hor * 0.06, p0 + n * 0.015, tipp - hor * 0.025 - np.array([0, 0, 0.01]), tipp, 9)
        ts = np.linspace(0, 1, 9)
        H.part.add(flat_tube(pts, 0.055 * (1 - ts) ** 0.9 + 0.004, 0.02 * (1 - 0.5 * ts) + 0.002, [n] * 9), 0.016)
    # 呆毛：一撮往前彎
    p0, n = H.surf(5, 86, 0.0)
    pts = bezier3(p0 - n * 0.02, p0 + np.array([0, 0.0, 0.05]), p0 + np.array([0.0, -0.05, 0.085]), p0 + np.array([0.01, -0.09, 0.065]), 9)
    ts = np.linspace(0, 1, 9)
    H.part.add(flat_tube(pts, 0.03 * (1 - ts) + 0.005, 0.016 * (1 - 0.5 * ts) + 0.002, [np.array([1.0, 0, 0])] * 9), 0.012)
    return H.part


def female_hair():
    """
    女生：圓潤的鮑伯，頭頂平順、下緣往外蓬（耳下最寬 ±0.375），臉頰兩側長鬢髮垂到 0.63，瀏海輕薄到眉下。
    """
    H = Hair("female", cap_extra=0.0, shell=FEMALE_SHELL)
    shell_cap(H)
    # 頭頂：平順、貼頭（往側馬尾方向梳）
    for i, az in enumerate(range(0, 360, 30)):
        H.lock(az + 6, 88, az + 14, 22, 0.15, 0.04, lift=0.006, flare=0.0, curl=0.0, tip=0.3, k=0.016, wide_mid=0.1)
    # 下半部：直直垂到肩上，髮尾往外翹
    for i, az in enumerate(range(62, 299, 15)):
        L = -62 if abs(az - 180) > 40 else -56
        H.lock(az, 34, az + 3 * (-1) ** i, L + 6 * (i % 2), 0.13, 0.045, lift=0.085,
               flare=(0.075, 0.05)[i % 2], curl=0.015, tip=0.2, k=0.014)
    # 臉頰兩側的長鬢髮（到 0.63，髮尾外翹）
    for sx in (1, -1):
        H.lock(46 * sx, 45, 54 * sx, -96, 0.085, 0.035, lift=0.03, flare=0.045, curl=0.0, tip=0.18, k=0.008)
    # 瀏海：輕薄、到眉毛
    for az, el1 in ((-46, -24), (-31, -18), (-16, -14), (-2, -19), (13, -14), (28, -17), (43, -22)):
        H.lock(az * 0.5, 74, az, el1, 0.09, 0.032, lift=0.022, flare=0.0, curl=0.008, tip=0.08, k=0.007)
    # 呆毛
    for sx, (az, a_, b_) in ((1, (-6, 0.075, 0.06)), (-1, (8, 0.06, 0.045))):
        p0, n = H.surf(az, 86, 0.0)
        pts = bezier3(p0 - n * 0.02, p0 + np.array([0, 0, a_ * 0.6]), p0 + np.array([-0.04 * sx, -0.03, a_]), p0 + np.array([-0.065 * sx, -0.05, b_]), 8)
        ts = np.linspace(0, 1, 8)
        H.part.add(flat_tube(pts, 0.02 * (1 - ts) + 0.004, 0.011 * (1 - 0.5 * ts) + 0.002, [np.array([0, 1.0, 0])] * 8), 0.008)
    return H


BOW_C = np.array([0.205, 0.215, 1.085])


def female_ponytail_and_bow(H):
    """側馬尾（角色左後上方，從蝴蝶結下方往後下垂到 0.66）＋大蝴蝶結（獨立零件，之後可換）"""
    tail = Part("ponytail", "hair", step=0.003)
    root = BOW_C + np.array([-0.03, 0.03, -0.02])
    for dx, dy, dz, w, fl in ((0.0, 0.0, 0.0, 0.14, 0.0), (0.03, 0.03, 0.03, 0.12, 0.05), (-0.025, 0.05, -0.02, 0.12, -0.03), (0.015, 0.07, 0.05, 0.11, 0.07), (0.04, -0.02, -0.04, 0.11, 0.02)):
        p0 = root + np.array([dx, dy, dz]) * 0.4
        p1 = p0 + np.array([0.03, 0.09, 0.03])
        p1 = p0 + np.array([0.02, 0.13, 0.02])
        p2 = np.array([0.21 + dx, 0.48 + dy, 0.92 + dz])
        p3 = np.array([0.19 + dx * 1.5, 0.47 + dy + fl, 0.68 + dz * 0.8])
        pts = bezier3(p0, p1, p2, p3, 12)
        ts = np.linspace(0, 1, 12)
        hw = w / 2 * ((1 - ts) ** 0.8 * 0.88 + 0.12) * (1 + 0.45 * np.sin(np.pi * ts))
        ht = w / 2 * 0.55 * (1 - 0.45 * ts) + 0.002
        nr = [unit(np.array([1.0, 0.15, 0.0]))] * 12
        tail.add(flat_tube(pts, hw, ht, nr), 0.03)
    tail.add(ellipsoid(root, (0.05, 0.05, 0.045)), 0.02)
    bow = Part("bow", "cloth", step=0.002)
    bc = BOW_C
    # 兩個大圈（側面看：前上方一個、後方一個），面向 +X
    Rz = rot((0, 0, 1), -35)  # 蝴蝶結面向角色左前方（正面、側面都看得到）
    for off, rad, ang in (((0.0, -0.075, 0.06), (0.032, 0.085, 0.06), 38), ((0.0, 0.085, 0.035), (0.032, 0.09, 0.062), -28)):
        R = Rz @ rot((1, 0, 0), ang)
        bow.add(ellipsoid(bc + Rz @ np.array(off), rad, R), 0.014)
    bow.add(ellipsoid(bc + [0.008, 0, 0], (0.035, 0.036, 0.034)), 0.01)
    # 兩條緞帶尾巴（往後下方）
    for dy, L in ((0.02, 0.15), (0.07, 0.12)):
        pts = bezier3(bc, bc + [0.005, dy * 0.6, -0.04], bc + [0.01, dy + 0.02, -0.09], bc + [0.012, dy + 0.04, -L], 7)
        bow.add(flat_tube(pts, np.linspace(0.024, 0.034, 7), np.full(7, 0.007), [np.array([1.0, 0, 0])] * 7), 0.006)
    deco = Part("bow_star", "metal", step=0.0015)
    deco.add(star_prim(bc + [0.04, -0.01, 0.0], (1, -0.2, 0.1), (0, 0, 1), 0.03, 0.013, 5, 0.012))
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
        return (0.095, 0.0, 0.582), (0.18, 0.0, 0.5), (0.226, -0.008, 0.438)
    return (0.09, 0.0, 0.598), (0.152, 0.0, 0.53), (0.195, -0.01, 0.472)


def leg_joints(g):
    """髖、膝、踝（角色左側）；男生腳開、女生併腿（依設定圖站姿）"""
    if g == "male":
        return (0.065, 0.0, 0.33), (0.1, -0.005, 0.205), (0.118, 0.0, 0.07)
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
        shaft_r, top, cuff, toe, heel, width, h = 0.066, 0.19, (0.126, 0.19), -0.151, 0.098, 0.172, 0.082
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
    pts = bezier3(np.array([0.03, 0.07, 0.665]), np.array([0.06, 0.13, 0.64]), np.array([0.08, 0.17, 0.6]), np.array([0.085, 0.2, 0.55]), 8)
    scarf.add(flat_tube(pts, np.linspace(0.045, 0.012, 8), np.full(8, 0.009), [unit(np.array([0.9, -0.3, 0.0]))] * 8), 0.02)
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
        tips = -0.075 * np.exp(-(((a - 36) / 8) ** 2)) - 0.04 * np.exp(-(((a - 122) / 9) ** 2)) - 0.05 * np.exp(-(((a - 180) / 10) ** 2))
        return base + tips

    OPEN_M = lerp_fn([(0.15, 30), (0.45, 32)])
    # 下擺：掛在腰帶上，正面大開口（短褲完全露出），兩側與背後往外、往後擺
    rxf = lerp_fn([(0.15, 0.25), (0.3, 0.19), (0.45, 0.137)])
    ryf = lerp_fn([(0.15, 0.2), (0.3, 0.145), (0.45, 0.096)])
    cyf = lerp_fn([(0.15, 0.06), (0.45, 0.0)])
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
    blouse.add(lathe_shell(0.47, 0.67, lerp_fn([(0.47, 0.083), (0.53, 0.079), (0.58, 0.085), (0.62, 0.087), (0.65, 0.065), (0.67, 0.033)]), lerp_fn([(0.47, 0.065), (0.53, 0.063), (0.58, 0.07), (0.62, 0.065), (0.67, 0.03)]), 0.03))
    for sx in (1, -1):
        sh, el, _ = [np.array([v[0] * sx, v[1], v[2]]) for v in A]
        blouse.add(ellipsoid(sh + (el - sh) * 0.22 + [0.01 * sx, 0, 0.0], (0.05, 0.05, 0.043)), 0.02)  # 泡泡袖
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
        return base - 0.08 * np.exp(-(((a - 44) / 9) ** 2)) - 0.03 * np.exp(-(((a - 120) / 12) ** 2)) + 0.015 * np.cos(np.radians(a) * 9) * (a > 60)

    osk = Part("overskirt", "cloth2", step=0.003)
    osk.add(lathe_shell(0.17, 0.5, lerp_fn([(0.17, 0.3), (0.33, 0.21), (0.5, 0.115)]), lerp_fn([(0.17, 0.25), (0.33, 0.17), (0.5, 0.097)]), 0.012, cy_fn=lerp_fn([(0.17, 0.05), (0.5, 0.0)]), open_front_deg=40, hem_fn=ohem))
    out.append(osk)
    otrim = Part("overskirt_trim", "metal", step=0.0025)
    otrim.add(lathe_shell(0.17, 0.5, lerp_fn([(0.17, 0.304), (0.33, 0.214), (0.5, 0.119)]), lerp_fn([(0.17, 0.254), (0.33, 0.174), (0.5, 0.101)]), 0.01, cy_fn=lerp_fn([(0.17, 0.05), (0.5, 0.0)]), open_front_deg=40, hem_fn=ohem))
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
