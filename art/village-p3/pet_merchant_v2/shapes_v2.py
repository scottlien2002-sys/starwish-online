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
    up = np.interp(z, [0.43, 0.5, 0.6, 0.65], [0.142, 0.138, 0.13, 0.12])
    lo = np.interp(z, [0.1, 0.17, 0.33, 0.43], [0.215, 0.208, 0.152, 0.142])
    return np.where(z >= WAIST, up, lo)


def coat_ry(z):
    z = np.asarray(z, float)
    up = np.interp(z, [0.43, 0.5, 0.6, 0.65], [0.103, 0.1, 0.094, 0.086])
    lo = np.interp(z, [0.1, 0.17, 0.33, 0.43], [0.165, 0.158, 0.118, 0.103])
    return np.where(z >= WAIST, up, lo)


def open_deg(z):
    z = np.asarray(z, float)
    return np.where(z < WAIST - 0.01, np.interp(z, [0.1, 0.2, 0.42], [30.0, 26.0, 10.0]), 0.0)


def coat_shell(thick, grow=0.0):
    return lathe_shell(0.1, 0.645, lambda z: coat_rx(z) + grow, lambda z: coat_ry(z) + grow, thick, cy_fn=lambda z: 0.006 + 0 * z,
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
    """栗棕色蓬鬆短髮：髮尾圓潤（不尖）、瀏海往角色右側（-X）斜撥、頭頂沒有翹髮；露出完整髮型"""
    H = NS.Hair("male", cap_extra=0.0, shell=((0.0, 0.046, 0.9), (0.218, 0.214, 0.228)))
    H.drop = False
    H.ex_scale = 0.85
    NS.shell_cap(H, curved=True)
    W = (178, 62)
    F = H.flow
    # 瀏海：一層長、一層短，全部往角色右側斜撥（bend 同號）；髮尾停在眉毛上方，露出眼睛
    for az, el, w, ex, st in ((-52, 2, 0.12, 0.026, 0.42), (-34, -4, 0.135, 0.028, 0.42), (-16, -8, 0.135, 0.03, 0.4), (2, -10, 0.13, 0.03, 0.4),
                              (20, -6, 0.125, 0.028, 0.42), (38, -2, 0.115, 0.026, 0.44), (54, -8, 0.1, 0.026, 0.46)):
        F(W, az, el, w, 0.038, ex, ex_root=0.008, belly=0.012, bend=-22, start=st, plateau=0.42, tip=0.38, k=0.006)
    for az, el in ((-24, 4), (10, 2), (30, 8)):
        F(W, az, el, 0.1, 0.032, 0.032, ex_root=0.01, belly=0.01, bend=-16, start=0.52, plateau=0.4, tip=0.42, k=0.005)
    # 兩側：蓬鬆、髮尾微微外翹，蓋到耳朵上緣
    for sx in (1, -1):
        for az, el, ex, w in ((68, -24, 0.04, 0.15), (86, -28, 0.046, 0.16), (104, -22, 0.05, 0.16), (122, -26, 0.046, 0.15), (140, -32, 0.04, 0.15)):
            F(W, az * sx, el, w, 0.048, ex, ex_root=0.01, belly=0.015, curl=0.028, bend=6 * sx, start=0.3, plateau=0.4, tip=0.4)
    # 後腦：層次、往頸部收
    for az, el, ex in ((150, -42, 0.024), (165, -56, 0.02), (180, -62, 0.022), (195, -56, 0.02), (210, -42, 0.024)):
        F(W, az, el, 0.16, 0.048, ex, ex_root=0.006, belly=0.013, curl=0.018, start=0.2, plateau=0.36, tip=0.42)
    # 外層與頭頂：圓潤蓬鬆的輪廓（貼著頭型、不形成帽沿）
    for az, el, ex, st, bd in ((-40, 34, 0.034, 0.25, -10), (0, 40, 0.038, 0.25, -12), (40, 34, 0.034, 0.25, -8), (-92, 14, 0.04, 0.32, -6),
                               (92, 14, 0.04, 0.32, 6), (130, 18, 0.034, 0.36, 6), (-130, 18, 0.034, 0.36, -6), (0, 66, 0.02, 0.32, -6),
                               (60, 58, 0.022, 0.32, 4), (-60, 58, 0.022, 0.32, -4), (160, 40, 0.024, 0.3, 4), (-160, 40, 0.024, 0.3, -4)):
        F(W, az, el, 0.15, 0.046, ex, ex_root=0.008, belly=0.014, start=st, curl=0.012, bend=bd, plateau=0.36, tip=0.44)
    pw, nw = H.pt(W[0], W[1], 0.0)
    t1 = unit(np.cross(nw, [0, 0, 1.0]))
    H.part.add(ellipsoid(pw + nw * 0.004, (0.05, 0.05, 0.016), np.column_stack([t1, np.cross(nw, t1), nw])), 0.02)
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
        p.add(capsule((0.064 * sx, 0.0, 0.36), (0.095 * sx, -0.004, 0.215), 0.054, 0.049), 0.02)
        p.add(capsule((0.095 * sx, -0.004, 0.215), (0.108 * sx, 0.0, 0.17), 0.049, 0.05), 0.01)
    p.add(ellipsoid((0, 0.0, 0.37), (0.15, 0.094, 0.075)), 0.03)
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
