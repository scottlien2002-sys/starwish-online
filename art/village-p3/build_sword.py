"""P3-5 星芽村「劍士軍團」建築（HQ / Lite）——劍誓之殿。

blender -b --factory-startup -P build_sword.py -- --out <輸出資料夾>

- 位置、尺寸完全沿用 V1.3（layout.ts）：方位 297°、正面在 r 27（面向噴泉）、寬 12 × 深 12、最高 13 m、地面在北側高台 +2 m。
  所有網格都在原碰撞箱（±6 × 0～12 × 0～13）內，不改碰撞；NPC 站位 r 25 在正門石階前 2 m；正門中心正對 297° 高台石階
- 造型：寬廣的「劍誓之殿」——日系奇幻的反曲線緋紅大屋頂（山牆朝廣場）、正面四柱門廊（小山牆屋頂）、
  主山牆上金邊緋紅盾＋交叉雙劍團徽、屋脊中央望樓（頂端金色劍形尖飾）、兩側扶壁與圓拱窗、
  石階兩側巨劍紀念碑（劍尖插入石座）、門廊內緋紅垂旗
- 識別色：騎士＝深藍、法師＝紫藍、劍士＝緋紅；石材、金色與騎士軍團同一套
- 網格依材質合併：stone（暖白砌石）、roof（緋紅屋瓦：共用魚鱗瓦貼圖 × 頂點色）、gold（HQ；Lite 畫在頂點色）、props（門、窗、旗、劍）
"""

import json
import math
import os
import sys
import time

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
args = dict(zip(argv[::2], argv[1::2]))
OUT = os.path.abspath(args.get("--out", "out"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vp3_geo as G  # noqa: E402
import vp3_detail66 as D66  # noqa: E402  （Stage 6.6 壁燈、花盆）
from build_mage import annulus, circle, star_outline, vextrude, vpoly  # noqa: E402

BEARING, FRONT, W, D, TOP, FLOOR = 297.0, 27.0, 12.0, 12.0, 13.0, 2.0
OX, OZ = G.pol(BEARING, FRONT)
F = G.frame(OX, OZ, BEARING, FLOOR)
FACE = BEARING + 180
BUDGET = {"hq": 22700, "lite": 9350}  # Stage 6.6：＋壁燈與花盆
LOD = {
    "hq": dict(arch=12, col=16, small=12, studs=True, hq=True, roof_sub=3),
    "lite": dict(arch=6, col=6, small=6, studs=False, hq=False, roof_sub=1),
}
C = {
    "wall": (0.97, 0.94, 0.88),
    "wall2": (0.94, 0.90, 0.83),
    "trim": (0.99, 0.97, 0.93),
    "plinth": (0.86, 0.80, 0.71),
    "step": (0.93, 0.89, 0.81),
    "roof": (0.88, 0.37, 0.33),
    "roof_d": (0.72, 0.29, 0.27),
    "door": (0.50, 0.22, 0.17),
    "door_d": (0.36, 0.15, 0.12),
    "glass": (0.16, 0.25, 0.46),
    "banner": (0.74, 0.18, 0.21),
    "steel": (0.84, 0.86, 0.90),
    "steel_d": (0.64, 0.67, 0.74),
    "leather": (0.45, 0.28, 0.17),
    "gold_vc": (0.92, 0.73, 0.33),
}
EX = G.sub(F(1, 0, 0), F(0, 0, 0))
EY = G.sub(F(0, 1, 0), F(0, 0, 0))
WALL_Y0, WALL_Y1, WALL_X = 3.4, 11.6, 4.6
# 主屋頂反曲線（半邊）：屋簷平緩、越近屋脊越陡（日系）
ROOF = [(5.65, 6.55), (4.65, 7.0), (3.45, 7.8), (2.25, 8.9), (1.12, 10.1), (0.0, 11.25)]
PORCH = [(3.95, 5.15), (3.2, 5.45), (2.3, 5.95), (1.2, 6.65), (0.0, 7.3)]


def local(p):
    d = (p[0] - OX, p[1] - OZ)
    return (d[0] * EX[0] + d[1] * EX[1], d[0] * EY[0] + d[1] * EY[1], p[2] - FLOOR)


def arch_outline(w, h0, hs, seg, cx=0.0):
    pts = [(cx - w / 2, h0), (cx + w / 2, h0)]
    for k in range(seg + 1):
        a = math.pi * k / seg
        pts.append((cx + math.cos(a) * w / 2, hs + math.sin(a) * w / 2))
    return pts


def arch_ring(mb, Fr, hs, r_in, r_out, y_front, y_back, seg, col, cx=0.0):
    want_f = G.sub(Fr(0, -1, 0), Fr(0, 0, 0))
    fr, bk = [], []
    for k in range(seg + 1):
        a = math.pi * k / seg
        c, s = math.cos(a), math.sin(a)
        fr.append((mb.vert(Fr(cx + c * r_in, y_front, hs + s * r_in), col), mb.vert(Fr(cx + c * r_out, y_front, hs + s * r_out), col)))
        bk.append((mb.vert(Fr(cx + c * r_in, y_back, hs + s * r_in), col), mb.vert(Fr(cx + c * r_out, y_back, hs + s * r_out), col)))
    for k in range(seg):
        a = math.pi * (k + 0.5) / seg
        mb.face([fr[k][0], fr[k + 1][0], fr[k + 1][1], fr[k][1]], want_f)
        mb.face([fr[k][0], fr[k + 1][0], bk[k + 1][0], bk[k][0]], G.sub(Fr(-math.cos(a), 0, -math.sin(a)), Fr(0, 0, 0)))
        mb.face([fr[k][1], fr[k + 1][1], bk[k + 1][1], bk[k][1]], G.sub(Fr(math.cos(a), 0, math.sin(a)), Fr(0, 0, 0)))


def plank(mb, Fr, p0, p1, width, y0, y1, col):
    dx, dh = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dx, dh) or 1.0
    px, ph = -dh / L * width / 2, dx / L * width / 2
    quad = [(p0[0] + px, p0[1] + ph), (p1[0] + px, p1[1] + ph), (p1[0] - px, p1[1] - ph), (p0[0] - px, p0[1] - ph)]
    ids = [mb.vert(Fr(x, y, h), col) for y in (y0, y1) for x, h in quad]
    c = Fr((p0[0] + p1[0]) / 2, (y0 + y1) / 2, (p0[1] + p1[1]) / 2)
    for q in ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        idx = [ids[i] for i in q]
        mb.face(idx, G.sub(G.centroid([mb.v[i] for i in idx]), c))


def shield_outline(w, top, height, seg=6, cx=0.0):
    pts = [(cx - w / 2, top)]
    for k in range(1, seg + 1):
        t = k / seg
        pts.append((cx - w / 2 * (1 - t ** 2.2), top - height * (0.35 + 0.65 * t) if k < seg else top - height))
    for k in range(seg - 1, 0, -1):
        t = k / seg
        pts.append((cx + w / 2 * (1 - t ** 2.2), top - height * (0.35 + 0.65 * t)))
    pts.append((cx + w / 2, top))
    pts.append((cx, top + height * 0.05))
    return pts


def smooth(prof, sub):
    """Catmull-Rom 細分屋頂曲線"""
    if sub <= 1:
        return prof
    out = []
    n = len(prof)
    for i in range(n - 1):
        p0, p1, p2, p3 = prof[max(i - 1, 0)], prof[i], prof[i + 1], prof[min(i + 2, n - 1)]
        for k in range(sub):
            t = k / sub
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in range(2)))
    out.append(prof[-1])
    return out


def curved_roof(roof, gm, gcol, prof, y0, y1, h_off, P, ridge_r):
    """反曲線雙坡屋頂：山牆朝 −y；上下兩面；金色屋脊與兩端博風線"""
    prof = smooth(prof, P["roof_sub"])
    for sx in (-1, 1):
        for a, b in zip(prof, prof[1:]):
            q = [F(sx * a[0], y0, a[1] + h_off), F(sx * b[0], y0, b[1] + h_off), F(sx * b[0], y1, b[1] + h_off), F(sx * a[0], y1, a[1] + h_off)]
            dx, dh = b[0] - a[0], b[1] - a[1]
            nrm = (sx * -dh, 0.0, -dx) if dx < 0 else (sx * dh, 0.0, dx)
            up = G.sub(F(sx * abs(dh), 0, abs(dx)), F(0, 0, 0))
            roof.face([roof.vert(p, C["roof"]) for p in q], up)
            roof.face([roof.vert(p, C["roof_d"]) for p in q], tuple(-x for x in up))
        # 屋簷厚度
        e0, e1 = prof[0], prof[1]
        q = [F(sx * e0[0], y0, e0[1] + h_off), F(sx * e0[0], y1, e0[1] + h_off), F(sx * e0[0], y1, e0[1] + h_off - 0.18), F(sx * e0[0], y0, e0[1] + h_off - 0.18)]
        roof.face([roof.vert(p, C["roof_d"]) for p in q], G.sub(F(sx, 0, 0), F(0, 0, 0)))
        for yy in (y0, y1):
            G.tube(gm, [F(sx * x, yy - (0.02 if yy == y0 else -0.02), h + h_off + 0.03) for x, h in prof], ridge_r * 0.8, 4 if P["hq"] else 3, gcol)
    G.tube(gm, [F(0, y0, prof[-1][1] + h_off + 0.03), F(0, y1, prof[-1][1] + h_off + 0.03)], ridge_r, 5 if P["hq"] else 3, gcol)


def gable_wall(mb, prof, y, h_base, h_off, col, inset=0.12, sub=1):
    """山牆面（凹多邊形用底部中心扇形）"""
    prof = smooth(prof, sub)
    pts = [(-x + inset * (x / max(prof[0][0], 1e-6)), h + h_off - 0.05) for x, h in prof] + [(x - inset * (x / max(prof[0][0], 1e-6)), h + h_off - 0.05) for x, h in reversed(prof[:-1])]
    pts = [p for p in pts if p[1] >= h_base - 1e-6]
    c = mb.vert(F(0, y, h_base), col)
    ids = [mb.vert(F(x, y, h), col) for x, h in pts]
    for i in range(len(ids) - 1):
        mb.face([c, ids[i], ids[i + 1]], G.sub(F(0, -1, 0), F(0, 0, 0)))


def great_sword(stone, props, gm, gcol, lx, ly, P):
    """巨劍紀念碑：石座＋劍尖朝下插入的巨劍"""
    G.box(stone, F, lx - 0.55, lx + 0.55, ly - 0.55, ly + 0.55, 0.0, 0.2, C["plinth"])
    G.box(stone, F, lx - 0.46, lx + 0.46, ly - 0.46, ly + 0.46, 0.2, 0.85, C["trim"])
    G.box(stone, F, lx - 0.52, lx + 0.52, ly - 0.52, ly + 0.52, 0.85, 0.97, C["plinth"])
    px, pz, _ = F(lx, ly, 0)
    S = G.frame(px, pz, BEARING, FLOOR)  # −y＝劍面朝廣場
    # 劍身（劍尖插入石座）：寬 0.5、雙面、中央血槽較暗；兩面都做
    for fy, fc in ((-0.05, -1), (0.05, 1)):
        vpoly(props, S, [(0.0, 0.8), (0.25, 1.25), (0.25, 4.05), (-0.25, 4.05), (-0.25, 1.25)], fy, C["steel"], fc)
        vpoly(props, S, [(-0.06, 1.3), (0.06, 1.3), (0.06, 3.95), (-0.06, 3.95)], fy + 0.006 * fc, C["steel_d"], fc)
    for (x0, h0), (x1, h1) in (((0.25, 1.25), (0.25, 4.05)), ((-0.25, 1.25), (-0.25, 4.05)), ((0.0, 0.8), (0.25, 1.25)), ((0.0, 0.8), (-0.25, 1.25))):
        q = [props.vert(S(x0, -0.05, h0), C["steel_d"]), props.vert(S(x1, -0.05, h1), C["steel_d"]), props.vert(S(x1, 0.05, h1), C["steel_d"]), props.vert(S(x0, 0.05, h0), C["steel_d"])]
        props.face(q, G.sub(S(x0 + x1, 0, 0), S(0, 0, 0)))
    vextrude(gm, S, [(-0.85, 4.05), (0.85, 4.05), (0.95, 4.18), (0.85, 4.31), (-0.85, 4.31), (-0.95, 4.18)], -0.11, 0.22, gcol)
    vextrude(gm, S, [(-0.85, 4.05), (0.85, 4.05), (0.95, 4.18), (0.85, 4.31), (-0.85, 4.31), (-0.95, 4.18)], 0.11, 0.22, gcol, facing=1)
    vextrude(props, S, [(-0.1, 4.31), (0.1, 4.31), (0.1, 5.0), (-0.1, 5.0)], -0.09, 0.18, C["leather"])
    vextrude(props, S, [(-0.1, 4.31), (0.1, 4.31), (0.1, 5.0), (-0.1, 5.0)], 0.09, 0.18, C["leather"], facing=1)
    G.lathe(gm, px, pz, FLOOR, [(0.0, 4.98), (0.17, 5.05), (0.2, 5.17), (0.13, 5.29), (0.0, 5.34)], P["small"], gcol)
    if P["hq"]:
        vpoly(gm, S, star_outline(0, 4.18, 4, 0.12, 0.04), -0.115, gcol, -1)
        G.box(gm, F, lx - 0.3, lx + 0.3, ly - 0.47, ly - 0.45, 0.45, 0.62, gcol)


def build(lod):
    P = LOD[lod]
    hq = P["hq"]
    stone = G.MB("Sword_stone", True)
    roof = G.MB("Sword_roof", True)
    gold = G.MB("Sword_gold", False)
    props = G.MB("Sword_props", False)
    gm, gcol = (gold, (1, 1, 1)) if hq else (props, C["gold_vc"])

    # ---- 基座＋寬石階＋欄牆 ----
    G.box(stone, F, -5.9, 5.9, 1.9, 11.9, 0.0, 0.56, C["plinth"])
    G.box(stone, F, -5.95, 5.95, 1.85, 11.95, 0.56, 0.68, C["trim"])
    for k in range(4):
        G.box(stone, F, -2.7, 2.7, 0.475 * k, 1.9, 0.0, 0.17 * (k + 1), C["step"])
    for sx in (-1, 1):
        xa, xb = sorted((sx * 2.7, sx * 3.3))
        G.box(stone, F, xa, xb, 0.05, 1.95, 0.0, 0.85, C["wall2"])
        G.box(stone, F, xa - 0.05, xb + 0.05, 0.0, 2.0, 0.85, 0.95, C["trim"])
        great_sword(stone, props, gm, gcol, sx * 4.55, 0.95, P)

    # ---- 主殿牆身、基腳、簷口 ----
    G.box(stone, F, -WALL_X, WALL_X, WALL_Y0, WALL_Y1, 0.68, 7.0, C["wall"])
    G.box(stone, F, -WALL_X - 0.1, WALL_X + 0.1, WALL_Y0 - 0.1, WALL_Y1 + 0.1, 0.68, 1.15, C["plinth"])
    G.box(stone, F, -WALL_X - 0.15, WALL_X + 0.15, WALL_Y0 - 0.15, WALL_Y1 + 0.15, 6.75, 7.02, C["trim"])
    if hq:
        G.box(gm, F, -WALL_X - 0.16, WALL_X + 0.16, WALL_Y0 - 0.16, WALL_Y0 - 0.15, 6.8, 6.86, gcol)
        # 簷下托架
        for k in range(13):
            y = WALL_Y0 + 0.4 + k * 0.62
            for sx in (-1, 1):
                xa, xb = sorted((sx * WALL_X, sx * (WALL_X + 0.22)))
                G.box(stone, F, xa, xb, y - 0.08, y + 0.08, 6.4, 6.75, C["trim"])
    # 腰線（4.0 m，繞三面）＋高窗圓窗
    for sx in (-1, 1):
        xa, xb = sorted((sx * WALL_X, sx * (WALL_X + 0.1)))
        G.box(stone, F, xa, xb, WALL_Y0, WALL_Y1, 4.0, 4.18, C["trim"])
    G.box(stone, F, -WALL_X, WALL_X, WALL_Y1, WALL_Y1 + 0.1, 4.0, 4.18, C["trim"])
    if hq:
        for y in (6.65, 9.55):
            for sx in (-1, 1):
                Fo = G.frame(*F(sx * WALL_X, y, 0)[:2], BEARING + 90 * sx + 180, FLOOR)
                vextrude(stone, Fo, circle(0, 5.55, 0.42, 12), -0.02, 0.1, C["trim"])
                vpoly(props, Fo, circle(0, 5.55, 0.3, 12), -0.03, C["glass"], -1)
                vpoly(gm, Fo, star_outline(0, 5.55, 4, 0.26, 0.06), -0.035, gcol, -1)
    # 正面兩角隅石
    for sx in (-1, 1):
        h = 1.15
        k = 0
        while h < 6.7:
            lx = 0.6 if k % 2 == 0 else 0.35
            xa, xb = sorted((sx * WALL_X, sx * (WALL_X - lx)))
            G.box(stone, F, xa - (0.04 if sx < 0 else 0), xb + (0.04 if sx > 0 else 0), WALL_Y0 - 0.05, WALL_Y0 + 0.3, h, h + 0.5, C["trim"])
            h += 0.56
            k += 1
            if not hq and k > 8:
                break
    # 扶壁（兩側各 3）
    for y in (5.2, 8.1, 11.0):
        for sx in (-1, 1):
            xa, xb = sorted((sx * WALL_X, sx * (WALL_X + 0.75)))
            G.box(stone, F, xa, xb, y - 0.32, y + 0.32, 0.68, 4.0, C["wall2"])
            xa2, xb2 = sorted((sx * WALL_X, sx * (WALL_X + 0.45)))
            G.box(stone, F, xa2, xb2, y - 0.28, y + 0.28, 4.0, 5.9, C["wall2"])
            G.box(stone, F, min(xa, xb) - 0.03, max(xa, xb) + 0.03, y - 0.35, y + 0.35, 3.9, 4.06, C["trim"])
            G.box(stone, F, min(xa2, xb2) - 0.03, max(xa2, xb2) + 0.03, y - 0.31, y + 0.31, 5.85, 6.0, C["trim"])

    # ---- 圓拱窗（兩側、後牆）----
    def window(Fr, w, h0, hgt):
        seg = P["arch"] // 2 + 1
        hs = h0 + hgt - w / 2
        vextrude(stone, Fr, arch_outline(w + 0.34, h0 - 0.14, hs, seg), -0.03, 0.14, C["trim"])
        vextrude(stone, Fr, arch_outline(w + 0.12, h0 - 0.04, hs, seg), -0.06, 0.04, C["wall2"])
        vpoly(props, Fr, arch_outline(w, h0, hs, seg), -0.065, C["glass"], -1)
        G.box(stone, Fr, -w / 2 - 0.22, w / 2 + 0.22, -0.2, 0.0, h0 - 0.28, h0 - 0.12, C["trim"])
        G.box(stone, Fr, -0.1, 0.1, -0.12, 0.0, hs + w / 2 + 0.06, hs + w / 2 + 0.34, C["trim"])
        if hq:
            G.box(gm, Fr, -0.022, 0.022, -0.085, -0.07, h0, hs + w / 2 - 0.05, gcol)
            G.box(gm, Fr, -w / 2, w / 2, -0.085, -0.07, h0 + (hs - h0) * 0.6, h0 + (hs - h0) * 0.6 + 0.045, gcol)
            annulus(gm, Fr, 0, hs, w * 0.2, w * 0.25, -0.086, gcol, 10)
        else:
            G.box(props, Fr, -0.03, 0.03, -0.08, -0.07, h0, hs + w / 2 - 0.05, C["gold_vc"])

    for y in (6.65, 9.55):
        for sx in (-1, 1):
            Fw = G.frame(*F(sx * WALL_X, y, 0)[:2], BEARING + 90 * sx + 180, FLOOR)
            window(Fw, 0.95, 2.5, 3.1)
    for x in (-2.2, 2.2):
        Fw = G.frame(*F(x, WALL_Y1, 0)[:2], BEARING + 180, FLOOR)
        window(Fw, 0.95, 2.5, 3.1)

    # ---- 主屋頂（反曲線、山牆朝廣場）＋山牆 ----
    curved_roof(roof, gm, gcol, ROOF, WALL_Y0 - 0.45, WALL_Y1 + 0.15, 0.0, P, 0.07)
    gable_wall(stone, ROOF, WALL_Y0, 7.0, 0.0, C["wall"], sub=P["roof_sub"])
    Fg = G.frame(*F(0, WALL_Y1, 0)[:2], BEARING + 180, FLOOR)  # 後山牆（朝外）
    RS = smooth(ROOF, P["roof_sub"])
    pts = [(x * 0.97, h - 0.06) for x, h in RS] + [(-x * 0.97, h - 0.06) for x, h in reversed(RS[:-1])]
    c = stone.vert(Fg(0, 0, 7.0), C["wall"])
    ids = [stone.vert(Fg(x, 0, h), C["wall"]) for x, h in pts if h >= 7.0]
    for i in range(len(ids) - 1):
        stone.face([c, ids[i], ids[i + 1]], G.sub(Fg(0, -1, 0), Fg(0, 0, 0)))
    # 屋脊兩端金色劍尖飾
    for yy in (WALL_Y0 - 0.45, WALL_Y1 + 0.15):
        px, pz, _ = F(0, yy, 0)
        G.lathe(gm, px, pz, FLOOR, [(0.0, 11.2), (0.16, 11.3), (0.12, 11.45), (0.04, 11.75), (0.0, 11.95)], P["small"], gcol)
    # 主山牆團徽：交叉雙劍（劍身鋼、金護手）＋金邊緋紅盾＋金星＋桂枝
    yE = WALL_Y0 - 0.06
    for sg in (-1, 1):
        plank(props, F, (sg * 1.45, 7.45), (-sg * 1.05, 10.2), 0.2, yE - 0.02, yE, C["steel"])
        gx, gh = -sg * 0.83, 9.93
        plank(gm, F, (gx - 0.34, gh - 0.26 * sg * -1), (gx + 0.34, gh + 0.26 * sg * -1), 0.1, yE - 0.06, yE - 0.02, gcol)
        G.blob(gm, F(-sg * 1.18, yE - 0.05, 10.43), 0.08, 0.08, 0.08, gcol)
    vextrude(gm, F, shield_outline(1.6, 9.65, 1.95), yE - 0.08, 0.1, gcol)
    vextrude(props, F, shield_outline(1.3, 9.5, 1.62), yE - 0.11, 0.03, C["banner"])
    vpoly(gm, F, star_outline(0, 8.75, 4, 0.38, 0.12), yE - 0.125, gcol, -1)
    if hq:
        # 團徽後方金色光芒
        for k in range(11):
            a = math.radians(-75 + 15 * k)
            x0, h0 = math.sin(a) * 1.25, 8.75 + math.cos(a) * 1.25
            x1, h1 = math.sin(a) * 1.75, 8.75 + math.cos(a) * 1.75
            plank(gm, F, (x0, h0), (x1, h1), 0.05, yE - 0.03, yE - 0.01, gcol)
        for sg in (-1, 1):
            for k in range(6):
                t = k / 5
                a = math.radians(-95 + 110 * t)
                lx, lh = sg * (1.15 * math.cos(a) + 0.02), 8.65 + 1.2 * math.sin(a)
                vpoly(gm, F, [(lx - 0.1, lh), (lx, lh - 0.05), (lx + 0.1, lh), (lx, lh + 0.05)], yE - 0.06, gcol, -1)
    # 屋脊望樓（四面圓拱小窗、緋紅四角攢尖、金色劍形尖飾 ≤ 13 m）
    yc = 7.5
    G.box(stone, F, -0.95, 0.95, yc - 0.95, yc + 0.95, 9.9, 11.85, C["wall"])
    G.box(stone, F, -1.05, 1.05, yc - 1.05, yc + 1.05, 11.75, 11.92, C["trim"])
    for b_off in (0, 90, 180, 270):
        px, pz = G.pol(BEARING + 180 + b_off, 0.96, *F(0, yc, 0)[:2])
        Fw = G.frame(px, pz, BEARING + b_off, FLOOR)
        vpoly(props, Fw, arch_outline(0.5, 10.75, 11.25, 4), -0.01, C["glass"], -1)
        vextrude(stone, Fw, arch_outline(0.7, 10.65, 11.25, 4), 0.0, 0.05, C["trim"])
    ap = F(0, yc, 12.6)
    corners = [F(sx * 1.25, yc + sy * 1.25, 11.88) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for i in range(4):
        a, b = corners[i], corners[(i + 1) % 4]
        q = [roof.vert(a, C["roof"]), roof.vert(b, C["roof"]), roof.vert(ap, C["roof"])]
        mid = G.centroid([a, b])
        roof.face(q, G.sub(mid, F(0, yc, 11.0)))
        q2 = [roof.vert(a, C["roof_d"]), roof.vert(b, C["roof_d"]), roof.vert(F(0, yc, 11.88), C["roof_d"])]
        roof.face(q2, (0, 0, -1))
        G.tube(gm, [a, ap], 0.035, 4 if hq else 3, gcol)
    px, pz, _ = F(0, yc, 0)
    Sf = G.frame(px, pz, BEARING, FLOOR)
    vextrude(gm, Sf, [(-0.05, 12.55), (0.05, 12.55), (0.05, 12.9), (0.0, 12.99), (-0.05, 12.9)], -0.015, 0.03, gcol)
    vextrude(gm, Sf, [(-0.22, 12.52), (0.22, 12.52), (0.22, 12.58), (-0.22, 12.58)], -0.03, 0.06, gcol)

    # ---- 正面門廊：四根石柱＋楣梁＋小山牆屋頂 ----
    for x in (-3.3, -1.25, 1.25, 3.3):
        px, pz, _ = F(x, 2.35, 0)
        G.lathe(stone, px, pz, FLOOR, [(0.34, 0.68), (0.34, 0.85), (0.28, 0.95), (0.24, 1.05), (0.21, 4.55), (0.27, 4.68), (0.32, 4.82), (0.32, 4.98), (0.0, 4.98)], P["col"], C["trim"])
        G.lathe(gm, px, pz, FLOOR, [(0.215, 4.47), (0.24, 4.52), (0.215, 4.57)], P["col"], gcol)
        if hq:
            G.lathe(gm, px, pz, FLOOR, [(0.285, 0.93), (0.3, 0.97), (0.27, 1.01)], P["col"], gcol)
    G.box(stone, F, -3.7, 3.7, 1.95, 3.4, 4.98, 5.38, C["trim"])
    if hq:
        G.box(gm, F, -3.71, 3.71, 1.94, 1.95, 5.12, 5.18, gcol)
    curved_roof(roof, gm, gcol, PORCH, 1.62, 3.5, 0.0, P, 0.05)
    gable_wall(stone, PORCH, 1.95, 5.38, 0.0, C["wall"], inset=0.15, sub=P["roof_sub"])
    # 門廊山牆：金色八芒星圓章
    vextrude(stone, F, circle(0, 6.15, 0.52, 12 if hq else 8), 1.9, 0.06, C["trim"])
    vpoly(gm, F, star_outline(0, 6.15, 8 if hq else 4, 0.42, 0.17), 1.885, gcol, -1)
    # 門廊天花（從下方看）
    G.box(stone, F, -3.7, 3.7, 1.95, 3.4, 4.95, 4.98, C["wall2"])

    # ---- 圓拱大門 ----
    hs = 3.05
    for k, (r_out, col) in enumerate(((1.62, C["trim"]), (1.4, C["wall2"]))):
        yf = WALL_Y0 - 0.12 + 0.05 * k
        for sx in (-1, 1):
            G.box(stone, F, min(sx * (r_out - 0.22), sx * r_out), max(sx * (r_out - 0.22), sx * r_out), yf, WALL_Y0, 0.68, hs, col)
        arch_ring(stone, F, hs, r_out - 0.22, r_out, yf, WALL_Y0, P["arch"], col)
    G.box(stone, F, -0.2, 0.2, WALL_Y0 - 0.17, WALL_Y0, hs + 1.42, hs + 1.78, C["trim"])
    if hq:
        # 拱石（深淺交錯）
        for k in range(9):
            a = math.pi * (k + 0.5) / 9
            if k == 4:
                continue
            c, s_ = math.cos(a), math.sin(a)
            G.box(stone, F, c * 1.74 - 0.12, c * 1.74 + 0.12, WALL_Y0 - 0.16, WALL_Y0, hs + s_ * 1.74 - 0.1, hs + s_ * 1.74 + 0.1, C["trim"] if k % 2 else C["wall2"])
    vextrude(props, F, arch_outline(2.36, 0.68, hs, P["arch"]), WALL_Y0 - 0.02, 0.04, C["door"])
    G.box(props, F, -0.025, 0.025, WALL_Y0 - 0.05, WALL_Y0 - 0.02, 0.68, hs + 1.15, C["door_d"])
    for h in (1.35, 2.45, 3.5):
        G.box(gm, F, -1.15, 1.15, WALL_Y0 - 0.06, WALL_Y0 - 0.03, h, h + 0.09, gcol)
        if P["studs"]:
            for k in range(7):
                x = -1.0 + k * 0.333
                G.blob(gm, F(x, WALL_Y0 - 0.07, h + 0.045), 0.03, 0.03, 0.03, gcol)
    for sx in (-0.2, 0.2):
        G.lathe(gm, *F(sx, WALL_Y0 - 0.06, 0)[:2], FLOOR + 2.2, [(0.0, 0.0), (0.09, 0.02), (0.1, 0.1), (0.0, 0.12)], 6, gcol)
    if hq:
        # 門板：交叉雙劍浮雕（金）
        for sg in (-1, 1):
            plank(gm, F, (sg * 0.55, 1.6), (-sg * 0.55, 3.0), 0.06, WALL_Y0 - 0.075, WALL_Y0 - 0.06, gcol)
        G.blob(gm, F(0, WALL_Y0 - 0.08, 3.85), 0.12, 0.12, 0.12, gcol)

    # ---- 門廊內垂旗（緋紅底、金邊、金色劍徽、燕尾） ----
    for sx in (-1, 1):
        x0, x1 = (1.72, 2.82) if sx > 0 else (-2.82, -1.72)
        yb = 3.25
        nc = 5 if hq else 3
        cols = [x0 + (x1 - x0) * i / (nc - 1) for i in range(nc)]
        rows = 5 if hq else 3
        h_top, h_bot = 4.92, 2.35
        for side in (-1, 1):
            grid = []
            for r in range(rows + 1):
                v = r / rows
                row = []
                for ci, x in enumerate(cols):
                    hh = h_top - v * (h_top - h_bot) if r < rows else h_bot + 0.28 * abs(ci - nc // 2) / (nc // 2)
                    k = 0.9 if ci % 2 else 1.0
                    row.append(props.vert(F(x, yb + side * 0.002 + (0.015 if ci % 2 else 0), hh), tuple(c * k for c in C["banner"])))
                grid.append(row)
            for r in range(rows):
                for ci in range(nc - 1):
                    props.face([grid[r][ci], grid[r][ci + 1], grid[r + 1][ci + 1], grid[r + 1][ci]], G.sub(F(0, side, 0), F(0, 0, 0)))
        yf = yb - 0.012
        for xa, xb in ((x0, x0 + 0.08), (x1 - 0.08, x1)):
            vpoly(gm, F, [(xa, h_bot + 0.3), (xb, h_bot + 0.3), (xb, h_top), (xa, h_top)], yf, gcol, -1)
        cx = (x0 + x1) / 2
        vpoly(gm, F, [(cx - 0.04, 3.2), (cx + 0.04, 3.2), (cx + 0.04, 4.35), (cx, 4.45), (cx - 0.04, 4.35)], yf, gcol, -1)
        vpoly(gm, F, [(cx - 0.24, 3.55), (cx + 0.24, 3.55), (cx + 0.24, 3.62), (cx - 0.24, 3.62)], yf - 0.003, gcol, -1)
        vpoly(gm, F, star_outline(cx, 4.65, 4, 0.12, 0.04), yf, gcol, -1)
        G.box(gm, F, x0 - 0.06, x1 + 0.06, yb - 0.04, yb + 0.02, 4.92, 4.98, gcol)
    D66.decorate66("sword", locals(), F, lod)
    return {k: v for k, v in (("stone", stone), ("roof", roof), ("gold", gold), ("props", props)) if v.f}


def _n(pts):
    n = G.newell(pts)
    L = math.sqrt(sum(x * x for x in n)) or 1.0
    return tuple(x / L for x in n)


def stone_uv(pts, tile=2.4):
    n = _n(pts)
    if abs(n[2]) > 0.7:
        return [(local(p)[0] / tile, local(p)[1] / tile) for p in pts]
    nl = (n[0] * EX[0] + n[1] * EX[1], n[0] * EY[0] + n[1] * EY[1])
    if abs(nl[0]) > abs(nl[1]):
        return [(local(p)[1] / tile, local(p)[2] / tile) for p in pts]
    return [(local(p)[0] / tile, local(p)[2] / tile) for p in pts]


def roof_uv(pts, tile=1.6):
    n = _n(pts)
    t = (-n[1], n[0], 0.0)
    L = math.hypot(t[0], t[1])
    if L < 1e-6:
        return [(local(p)[0] / tile, local(p)[1] / tile) for p in pts]
    t = (t[0] / L, t[1] / L, 0.0)
    s = (n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0])
    return [((p[0] * t[0] + p[1] * t[1]) / tile, (p[0] * s[0] + p[1] * s[1] + p[2] * s[2]) / tile) for p in pts]


def summarize(mbs):
    per = {k: mb.tris() for k, mb in mbs.items()}
    L = [local(v) for mb in mbs.values() for v in mb.v]
    bounds = {"x": [round(min(p[0] for p in L), 3), round(max(p[0] for p in L), 3)], "y": [round(min(p[1] for p in L), 3), round(max(p[1] for p in L), 3)], "h": [round(min(p[2] for p in L), 3), round(max(p[2] for p in L), 3)]}
    return per, bounds


def main():
    import vp3_kit  # noqa: PLC0415

    t0 = time.time()
    door = F(0, WALL_Y0 - 0.02, 0.68)
    report = {"lods": {}, "budget": BUDGET, "stage": "P3-5", "layout": {"bearing": BEARING, "front": FRONT, "w": W, "d": D, "top": TOP, "floor": FLOOR, "door": [round(door[0], 3), round(door[1], 3)]}}
    log = []
    for lod in ("lite", "hq"):
        vp3_kit.reset()
        mats = {k: G.simple_mat(f"VP3_sword_{k}", (1, 1, 1)) for k in ("stone", "roof", "gold", "props")}
        mbs = build(lod)
        objs = {}
        for k, mb in mbs.items():
            if k == "stone":
                objs[k] = G.to_object_uv(mb, mats[k], stone_uv)
            elif k == "roof":
                objs[k] = G.to_object_uv(mb, mats[k], roof_uv)
            else:
                objs[k] = G.to_object(mb, mats[k])
        ok = vp3_kit.bake_ao([objs[k] for k in ("stone", "roof", "props") if k in objs], samples=24, strength=0.6, log=log)
        per, bounds = summarize(mbs)
        path = os.path.join(OUT, f"sword_{lod}.glb")
        vp3_kit.export_glb(list(objs.values()), path)
        tris = sum(per.values())
        report["lods"][lod] = {"triangles": tris, "by_mesh": per, "meshes": len(objs), "ao_baked": ok, "bytes": os.path.getsize(path), "within_budget": tris <= BUDGET[lod], "bounds_local": bounds}
    report["log"] = log
    report["seconds"] = round(time.time() - t0, 1)
    with open(os.path.join(OUT, "sword_report.json"), "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1))
    if not all(v["within_budget"] for v in report["lods"].values()):
        raise SystemExit("三角面超出預算")


if __name__ == "__main__":
    main()
