"""寵物商人 V2「星靈培育師・洛恩」造型（有號距離場）。

- 頭、臉（臉部貼圖）、身體、手、靴子、襯衫：沿用 Claude A 正式男初心者（C1.0-B4）的基礎網格，由 export_v2.py 唯讀讀取 A 的輸出
- 本檔只定義洛恩自己的零件：栗棕色蓬鬆短髮、暖白長外套（深藍滾邊、金色刺繡線）、深藍立領、長褲、袖口、
  皮革腰包、飼料袋、寵物蛋（腰側皮托）、魔法鑑定石（胸前金色吊墜）、漂浮小寵物
- 使用 A 的 SDF 工具（novice-v2/sdf.py、novice_shapes.Hair）做為唯讀函式庫：路徑由環境變數 A_ART 指定（CI 從固定 commit 取出），
  不複製、不修改 A 的檔案
座標：Z 向上、角色面向 -Y、角色左側 +X；單位公尺；腳底 z = 0（與 A 相同）
"""
import math
import os
import sys
from pathlib import Path

import numpy as np

A_ART = Path(os.environ.get("A_ART", "/tmp/a_art/art"))
for d in ("novice-v2", "bobo-v38r", "novice-c0"):
    sys.path.insert(0, str(A_ART / d))
import novice_shapes as NS  # noqa: E402
from sdf import Part, Prim, capsule, ellipsoid, flat_tube, lathe_shell, rbox, rot, torus, unit, bezier3  # noqa: E402

# ------------------------------------------------------------------ 外套輪廓
HEM_FRONT, HEM_BACK = 0.185, 0.145
WAIST = 0.43


def hem(th):
    return HEM_BACK + (HEM_FRONT - HEM_BACK) * (0.5 + 0.5 * np.cos(th))


def coat_rx(z):
    z = np.asarray(z, float)
    up = np.interp(z, [0.43, 0.5, 0.58, 0.62, 0.65, 0.672, 0.69], [0.142, 0.138, 0.132, 0.126, 0.112, 0.088, 0.062])
    lo = np.interp(z, [0.1, 0.17, 0.33, 0.43], [0.215, 0.208, 0.152, 0.142])
    return np.where(z >= WAIST, up, lo)


def coat_ry(z):
    z = np.asarray(z, float)
    up = np.interp(z, [0.43, 0.5, 0.58, 0.62, 0.65, 0.672, 0.69], [0.103, 0.1, 0.095, 0.091, 0.083, 0.07, 0.056])
    lo = np.interp(z, [0.1, 0.17, 0.33, 0.43], [0.165, 0.158, 0.118, 0.103])
    return np.where(z >= WAIST, up, lo)


def open_deg(z):
    z = np.asarray(z, float)
    return np.where(z < WAIST - 0.01, np.interp(z, [0.1, 0.2, 0.42], [30.0, 26.0, 10.0]), 0.0)


def coat_shell(thick, grow=0.0):
    return lathe_shell(0.1, 0.688, lambda z: coat_rx(z) + grow, lambda z: coat_ry(z) + grow, thick, cy_fn=lambda z: 0.006 + 0 * z,
                       open_front_deg=open_deg, hem_fn=hem)


def _theta(P):
    return np.arctan2(P[..., 0], -(P[..., 1] - 0.006))


def masked(prim, region):
    """prim ∩ region（region(P) ≤ 0 的範圍）"""
    return Prim(lambda P: np.maximum(prim.fn(P), region(P)), prim.lo, prim.hi)


def trim_region(P):
    """深藍滾邊：下襬 3 公分＋前開襟兩側 9° ＋上半身中央門襟 6°"""
    th = _theta(P)
    z = P[..., 2]
    r = np.hypot(P[..., 0], P[..., 1])
    band = z - (hem(th) + 0.03)
    od = open_deg(z)
    edge_lo = (np.abs(th) - np.radians(od + 9.0)) * r
    edge_up = (np.abs(th) - np.radians(6.0)) * r
    edge = np.where(z < WAIST - 0.01, edge_lo, edge_up)
    return np.minimum(band, edge)


def gold_region(P):
    """金色刺繡線：滾邊內緣一圈（下襬＋前襟）"""
    th = _theta(P)
    z = P[..., 2]
    r = np.hypot(P[..., 0], P[..., 1])
    band = np.abs(z - (hem(th) + 0.034)) - 0.0035
    od = open_deg(z)
    edge = np.where(z < WAIST - 0.01, np.abs(np.abs(th) - np.radians(od + 9.6)) * r - 0.0035, 1.0)
    edge = np.maximum(edge, z - WAIST + 0.01)
    edge = np.maximum(edge, hem(th) + 0.03 - z)
    return np.minimum(band, edge)


# ------------------------------------------------------------------ 零件


def hair():
    """V2.1 栗棕色蓬鬆短髮：以 A 官方男生髮型的髮束結構為基礎（寬髮束互相重疊、髮尾柔和收尖、髮旋旋渦），
    改成洛恩的造型：瀏海整體往角色右側斜掃、中間露出一點額頭（較成熟）、沒有呆毛、側面與後腦層次較收斂。
    （只參考 A 的髮型做法；A 的檔案不修改。）"""
    H = NS.Hair("male", cap_extra=0.0, shell=((0.0, 0.06, 0.9), (0.216, 0.236, 0.226)))
    H.drop = False
    H.ex_scale = 0.62
    NS.shell_cap(H)
    W = (176, 62)  # 髮旋：頭頂偏後
    F = H.flow
    # 瀏海：寬髮束互相重疊（不會出現一顆顆的髮尾），全部往同側斜掃；中間兩束較短，露出眉毛上方
    for az, el, w, bd, st, tp in ((-50, -12, 0.15, -16, 0.45, 0.2), (-28, -16, 0.17, -18, 0.42, 0.2), (-6, -14, 0.17, -20, 0.4, 0.18),
                                  (16, -8, 0.17, -18, 0.42, 0.2), (38, -14, 0.16, -14, 0.44, 0.2), (58, -20, 0.13, -8, 0.5, 0.22)):
        F(W, az, el, w * 0.85, 0.04, 0.036, ex_root=0.008, belly=0.012, bend=bd, tip=tp, start=st, plateau=0.3)
    # 瀏海上層兩束（長短錯落，增加層次）
    for az, el, bd in ((-38, -2, -14), (6, 0, -18)):
        F(W, az, el, 0.13, 0.036, 0.03, ex_root=0.012, belly=0.01, bend=bd, tip=0.2, start=0.5, plateau=0.32)
    # 臉頰旁（往下、往內收）
    for sx in (1, -1):
        F(W, 62 * sx, -30, 0.17, 0.046, 0.04, ex_root=0.01, belly=0.013, bend=-6, tip=0.24, start=0.4, plateau=0.36)
    # 兩側：耳朵上方微微外翹（比 A 的新手髮型收斂）
    for sx in (1, -1):
        for az, el, ex, cu in ((84, -4, 0.085, 0.03), (102, -10, 0.09, 0.035), (120, -12, 0.078, 0.028), (138, -22, 0.06, 0.018)):
            F(W, az * sx, el, 0.19, 0.054, ex, ex_root=0.012, belly=0.017, curl=cu * 0.6, bend=8, tip=0.26, start=0.3, plateau=0.38)
    # 後腦（往下到後頸，髮尾微翹）
    for i, (az, el, ex) in enumerate(((146, -38, 0.045), (160, -54, 0.032), (172, -66, 0.05), (186, -62, 0.032), (200, -52, 0.05), (214, -38, 0.036))):
        F(W, az, el, 0.16, 0.052, ex, ex_root=0.004 + 0.01 * (i % 2 == 0), belly=0.015, bend=6, tip=0.22, start=0.22, plateau=0.36)
    # 外層：較短、較蓬，疊在底層上（頭頂高低層次）
    for az, el, ex, st in ((-34, 40, 0.048, 0.2), (14, 46, 0.052, 0.2), (58, 22, 0.06, 0.28), (-72, 30, 0.06, 0.28),
                           (96, 8, 0.065, 0.32), (-104, 14, 0.065, 0.32), (128, 18, 0.052, 0.38), (-132, 2, 0.056, 0.38)):
        F(W, az, el, 0.17, 0.05, ex, ex_root=0.016, belly=0.013, start=st, curl=0.012, bend=-8, tip=0.22, plateau=0.36)
    # 後腦第二排（蓋住髮殼下緣，髮尾錯落）
    for i, (az, el) in enumerate(((146, -56), (162, -70), (178, -76), (194, -70), (212, -56), (170, -62), (188, -60))):
        F(W, az, el, 0.13, 0.048, (0.028, 0.045)[i % 2], ex_root=0.014 + 0.01 * (i % 2), belly=0.013, start=0.45 + 0.08 * (i % 2), curl=0.01, tip=0.22, plateau=0.32)
    # 髮旋：三束短而彎的髮束繞著髮旋轉（不是一點擠滿；沒有呆毛）
    for az, el in ((120, 52), (230, 50), (180, 40)):
        F(W, az, el, 0.12, 0.038, 0.018, ex_root=0.006, belly=0.009, bend=28, tip=0.25, plateau=0.35)
    return H.part


def coat():
    return Part("coat", "cloth", step=0.0035).add(coat_shell(0.012))


def coat_trim():
    return Part("coat_trim", "cloth", step=0.0025).add(masked(coat_shell(0.017, 0.0015), trim_region))


def coat_gold():
    p = Part("coat_gold", "metal", step=0.0018).add(masked(coat_shell(0.02, 0.003), gold_region))
    # 門襟金扣（3 顆）＋左胸金色星辰刺繡（小星）
    for z in (0.47, 0.53, 0.59):
        ry = float(coat_ry(z)) + 0.008
        p.add(ellipsoid((0, -ry, z), (0.009, 0.006, 0.009)))
    return p


def collar():
    p = Part("collar", "cloth", step=0.0022)
    p.add(lathe_shell(0.6, 0.675, lambda z: np.interp(z, [0.6, 0.675], [0.088, 0.078]), lambda z: np.interp(z, [0.6, 0.675], [0.08, 0.072]), 0.012,
                      cy_fn=lambda z: 0.012 + 0 * z, open_front_deg=28.0))
    return p


def trousers():
    p = Part("trousers", "cloth", step=0.003)
    for sx in (1, -1):
        p.add(capsule((0.064 * sx, 0.0, 0.36), (0.095 * sx, -0.004, 0.215), 0.064, 0.058), 0.02)
        p.add(capsule((0.095 * sx, -0.004, 0.215), (0.108 * sx, 0.0, 0.14), 0.058, 0.056), 0.01)
    p.add(ellipsoid((0, 0.0, 0.37), (0.15, 0.094, 0.075)), 0.03)
    # 襠部補實：兩腿之間不露出素體
    p.add(ellipsoid((0, 0.0, 0.315), (0.085, 0.07, 0.06)), 0.03)
    for sx in (1, -1):
        p.add(capsule((0.035 * sx, 0.0, 0.33), (0.07 * sx, -0.002, 0.25), 0.05, 0.05), 0.02)
    return p


def cuffs():
    p = Part("cuffs", "cloth", step=0.0018)
    g = Part("cuff_gold", "metal", step=0.0015)
    for sx in (1, -1):
        el = np.array([0.172 * sx, 0.0, 0.5])
        wr = np.array([0.212 * sx, -0.008, 0.438])
        ax = unit(wr - el)
        c = el + (wr - el) * 0.62
        p.add(torus(c, 0.036, 0.013, axis=ax, flat=1.4))
        g.add(torus(c - ax * 0.012, 0.043, 0.0035, axis=ax))
    return p, g


def pouch():
    """皮革腰包（右前腰）：圓角盒＋翻蓋＋金扣"""
    p = Part("pouch", "leather", step=0.0018)
    R = rot((0, 0, 1), -32)
    c = np.array([-0.118, -0.098, 0.372])
    p.add(rbox(c, (0.032, 0.014, 0.034), 0.01, R))
    p.add(rbox(c + np.array([0.0, -0.004, 0.028]), (0.035, 0.016, 0.012), 0.008, R), 0.004)
    g = Part("pouch_gold", "metal", step=0.0012).add(ellipsoid(c + R @ np.array([0, -0.024, 0.02]), (0.007, 0.004, 0.007)))
    return p, g


def feed_bag():
    """飼料袋（左後腰）：麻布袋＋束口＋綁繩"""
    p = Part("feed_bag", "cloth", step=0.0022)
    c = np.array([0.152, 0.07, 0.31])
    p.add(ellipsoid(c, (0.044, 0.038, 0.052)))
    p.add(capsule(c + np.array([0, 0, 0.045]), c + np.array([0.0, 0.0, 0.075]), 0.016, 0.022), 0.012)
    s = Part("feed_tie", "leather", step=0.0015)
    s.add(torus(c + np.array([0, 0, 0.06]), 0.018, 0.0045))
    s.add(capsule(c + np.array([-0.01, 0.0, 0.08]), np.array([0.13, 0.06, 0.43]), 0.004), 0.003)
    return p, s


def egg():
    """寵物蛋（左前腰皮托）"""
    cup = Part("egg_cup", "leather", step=0.0015)
    c = np.array([0.128, -0.088, 0.36])
    cup.add(lathe_shell(0.0, 0.03, lambda z: 0.026 + 0.2 * z, lambda z: 0.026 + 0.2 * z, 0.005))
    cup.ops = [(op, Prim(lambda P, f=pr.fn: f(P - c), pr.lo + c, pr.hi + c), k) for op, pr, k in cup.ops]
    cup.add(capsule(c + np.array([0.0, 0.0, 0.02]), np.array([0.13, -0.06, 0.43]), 0.005), 0.004)
    e = Part("egg", "egg", step=0.0012).add(ellipsoid(c + np.array([0, 0, 0.038]), (0.025, 0.025, 0.033)))
    return cup, e


def pendant():
    """魔法鑑定石：胸前金色鍊條＋金色托座＋發光晶石"""
    g = Part("stone_gold", "metal", step=0.0012)
    c = np.array([0.0, -0.112, 0.535])
    for sx in (1, -1):
        pts = bezier3(np.array([0.05 * sx, -0.06, 0.63]), np.array([0.05 * sx, -0.095, 0.6]), np.array([0.02 * sx, -0.11, 0.56]), c + np.array([0.006 * sx, 0.0, 0.016]), 10)
        g.add(flat_tube(pts, np.full(10, 0.0022), np.full(10, 0.0018), [np.array([0, -1.0, 0])] * 10), 0.002)
    g.add(torus(c, 0.017, 0.0035, axis=(0, -1, 0)))
    g.add(ellipsoid(c + np.array([0, 0, 0.022]), (0.006, 0.004, 0.005)))
    s = Part("stone", "glow", step=0.001)
    R = rot((0, 1, 0), 45)
    s.add(rbox(c + np.array([0, -0.004, 0]), (0.008, 0.005, 0.008), 0.002, R))
    s.add(ellipsoid(c + np.array([0, -0.004, 0]), (0.011, 0.007, 0.014)), 0.004)
    return g, s


def pal():
    """漂浮小寵物（白色長耳、藍色耳尖）：原點在身體中心，執行時漂浮在洛恩頭部附近"""
    p = Part("pal", "pal", step=0.0012)
    p.add(ellipsoid((0, 0.004, -0.012), (0.046, 0.042, 0.04)))
    p.add(ellipsoid((0, -0.012, 0.036), (0.043, 0.04, 0.038)), 0.018)
    for sx in (1, -1):
        pts = bezier3(np.array([0.022 * sx, -0.004, 0.064]), np.array([0.036 * sx, 0.0, 0.1]), np.array([0.052 * sx, 0.018, 0.13]), np.array([0.07 * sx, 0.04, 0.142]), 12)
        ts = np.linspace(0, 1, 12)
        hw = 0.016 * (1 - 0.35 * ts) * (0.55 + 0.45 * np.sin(np.minimum(ts * 1.3, 1) * math.pi / 2)) + 0.003
        p.add(flat_tube(pts, hw, np.full(12, 0.007), [np.array([0, -1.0, 0.2])] * 12), 0.008)
        p.add(ellipsoid((0.026 * sx, -0.02, -0.046), (0.013, 0.016, 0.01)), 0.008)  # 小腳
    p.add(capsule((0, 0.04, -0.01), (0, 0.06, 0.02), 0.012, 0.016), 0.01)  # 尾巴
    eyes = Part("pal_eyes", "eye", step=0.0008)
    for sx in (1, -1):
        eyes.add(ellipsoid((0.017 * sx, -0.049, 0.042), (0.007, 0.004, 0.009)))
    return p, eyes


def build():
    parts = [hair(), coat(), coat_trim(), coat_gold(), collar(), trousers()]
    c, cg = cuffs()
    po, pg = pouch()
    fb, ft = feed_bag()
    cup, e = egg()
    sg, st = pendant()
    pa, pe = pal()
    return parts + [c, cg, po, pg, fb, ft, cup, e, sg, st, pa, pe]
