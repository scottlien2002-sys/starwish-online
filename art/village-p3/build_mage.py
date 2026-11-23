"""P3-4 星芽村「法師軍團」造型提案模型（HQ / Lite）——星詠之塔。

blender -b --factory-startup -P build_mage.py -- --out <輸出資料夾>

- 這是「造型確認」用的模型：輪廓、比例、配色分區、發光位置；材質細節（雕刻、法線、貼圖細節）在下一階段
- 位置、尺寸完全沿用 V1.3（layout.ts）：方位 26°、正面在 r 27（面向噴泉）、寬 13 × 深 13、最高 20 m、
  地面在北側高台 +2 m。所有網格都在原碰撞箱（±6.5 × 0～13 × 0～20）內，不改碰撞；NPC 站位 r 25 在正門石階前 2 m，
  正門中心正對 26° 高台石階
- 造型：八角石台基座＋寬石階 → 尖拱門廳（深紫藍大門、玫瑰窗）→ 圓形主塔（兩道腰線、尖拱窗）→
  開放式「星詠台」（8 根細柱、漂浮星晶＋金色雙環，與星願之泉呼應）→ 紫藍魔女帽式尖頂（金色新月與星）；
  左前高、右後低兩座小塔（不對稱）；塔身周圍 3 顆漂浮小晶石；石階兩側水晶燈；門廳兩側紫色垂旗
- 網格依材質合併：stone（暖白石牆，全村共用砌石貼圖）、roof（紫藍屋瓦，共用魚鱗瓦貼圖 × 頂點色）、
  gold（HQ；Lite 畫在頂點色裡）、props（門、旗、燈座，頂點色）、glow（星晶、玻璃窗、玫瑰窗：自發光 × 頂點色）
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

# ---------------- V1.3 法師軍團 ----------------
BEARING, FRONT, W, D, TOP, FLOOR = 26.0, 27.0, 13.0, 13.0, 20.0, 2.0
OX, OZ = G.pol(BEARING, FRONT)  # 正面中心（地面）
F = G.frame(OX, OZ, BEARING, FLOOR)  # 區域座標：x 右（從廣場看）、y 往建築內、h 高（離高台面）
FACE = BEARING + 180  # 正面朝向（噴泉）
BUDGET = {"hq": 26000, "lite": 10000}
LOD = {
    "hq": dict(tower=32, roof=32, turret=16, small=10, col=6, ring=40, win=True, mullion=True, ridges=True, back_windows=True),
    "lite": dict(tower=14, roof=14, turret=8, small=6, col=4, ring=20, win=True, mullion=False, ridges=False, back_windows=False),
}

C = {
    "wall": (0.97, 0.94, 0.88),
    "wall2": (0.94, 0.90, 0.83),
    "trim": (0.99, 0.97, 0.93),
    "plinth": (0.86, 0.80, 0.71),
    "step": (0.93, 0.89, 0.81),
    # 屋頂：與騎士軍團同一系列的深藍，再往紫偏一點（魔法）
    "roof": (0.48, 0.42, 0.85),
    "roof_d": (0.39, 0.34, 0.72),
    "door": (0.31, 0.26, 0.58),
    "door_d": (0.22, 0.18, 0.42),
    "banner": (0.47, 0.35, 0.78),
    "iron": (0.22, 0.22, 0.32),
    "gold_vc": (0.92, 0.73, 0.33),
    # 發光（自發光 × 頂點色）：星晶與噴泉星晶同色系；窗戶較暗
    "crystal_top": (0.80, 0.92, 1.0),
    "crystal_mid": (0.52, 0.72, 1.0),
    "crystal_bot": (0.36, 0.46, 0.95),
    "glass": (0.36, 0.50, 0.86),
    "glass_hi": (0.58, 0.70, 1.0),
    "rose": (0.55, 0.62, 1.0),
}
EX = G.sub(F(1, 0, 0), F(0, 0, 0))
EY = G.sub(F(0, 1, 0), F(0, 0, 0))

TOWER = (0.0, 7.4)  # 主塔中心（區域）
T1 = (-4.3, 4.3, 1.25)  # 左前小塔（較高）
T2 = (4.55, 8.9, 1.05)  # 右後小塔（較低）
ROOF_TIP = 19.35
T1_TIP, T2_TIP = 14.1, 11.3


def local(p):
    d = (p[0] - OX, p[1] - OZ)
    return (d[0] * EX[0] + d[1] * EX[1], d[0] * EY[0] + d[1] * EY[1], p[2] - FLOOR)


def wpos(lx, ly):
    return F(lx, ly, 0)[:2]


# ---------------- 形狀工具（區域座標的直立平面） ----------------
def vpoly(mb, Fr, outline, y, col, facing):
    """直立多邊形（凸）：outline＝[(x,h)]，位於 y；facing −1＝朝廣場(−y)、+1＝朝 +y"""
    ids = [mb.vert(Fr(x, y, h), col) for x, h in outline]
    cx = sum(x for x, _ in outline) / len(outline)
    ch = sum(h for _, h in outline) / len(outline)
    c = mb.vert(Fr(cx, y, ch), col)
    want = G.sub(Fr(0, facing, 0), Fr(0, 0, 0))
    for i in range(len(ids)):
        mb.face([c, ids[i], ids[(i + 1) % len(ids)]], want)
    return ids


def vextrude(mb, Fr, outline, y_front, depth, col, facing=-1):
    vpoly(mb, Fr, outline, y_front, col, facing)
    cx = sum(x for x, _ in outline) / len(outline)
    ch = sum(h for _, h in outline) / len(outline)
    y_back = y_front - facing * depth
    n = len(outline)
    for i in range(n):
        (x1, h1), (x2, h2) = outline[i], outline[(i + 1) % n]
        idx = [mb.vert(Fr(x1, y_front, h1), col), mb.vert(Fr(x2, y_front, h2), col), mb.vert(Fr(x2, y_back, h2), col), mb.vert(Fr(x1, y_back, h1), col)]
        mx, mh = (x1 + x2) / 2 - cx, (h1 + h2) / 2 - ch
        mb.face(idx, G.sub(Fr(mx, 0, mh), Fr(0, 0, 0)))


def lancet(w, h0, hs, seg, cx=0.0):
    """尖拱輪廓（等邊尖拱）：寬 w、底 h0、起拱 hs"""
    pts = [(cx + w / 2, h0)]
    for k in range(seg + 1):
        a = math.pi / 3 * k / seg
        pts.append((cx - w / 2 + w * math.cos(a), hs + w * math.sin(a)))
    for k in range(seg - 1, -1, -1):
        a = math.pi / 3 * k / seg
        pts.append((cx + w / 2 - w * math.cos(a), hs + w * math.sin(a)))
    pts.append((cx - w / 2, h0))
    # 去掉重複點（頂點）
    out = []
    for p in pts:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > 1e-6:
            out.append(p)
    return out[:-1] if math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) < 1e-6 else out


def circle(cx, ch, r, n):
    return [(cx + math.sin(k * math.tau / n) * r, ch + math.cos(k * math.tau / n) * r) for k in range(n)]


def star_outline(cx, ch, n, r_out, r_in, rot=0.0):
    return [(cx + math.sin(rot + i * math.pi / n) * (r_out if i % 2 == 0 else r_in), ch + math.cos(rot + i * math.pi / n) * (r_out if i % 2 == 0 else r_in)) for i in range(n * 2)]


def crescent(mb, Fr, cx, ch, R, y, col, seg=8, facing=-1):
    """新月（開口朝右）：外圓左半＋內側橢圓，兩端尖角相接"""
    want = G.sub(Fr(0, facing, 0), Fr(0, 0, 0))
    O, I = [], []
    for k in range(seg + 1):
        a = math.pi / 2 + math.pi * k / seg
        O.append(mb.vert(Fr(cx + R * math.cos(a), y, ch + R * math.sin(a)), col))
        I.append(mb.vert(Fr(cx + R * 0.42 * math.cos(a), y, ch + R * 0.86 * math.sin(a)), col))
    for k in range(seg):
        mb.face([O[k], O[k + 1], I[k + 1], I[k]], want)


def annulus(mb, Fr, cx, ch, r0, r1, y, col, n, facing=-1):
    want = G.sub(Fr(0, facing, 0), Fr(0, 0, 0))
    A = [mb.vert(Fr(cx + math.sin(k * math.tau / n) * r0, y, ch + math.cos(k * math.tau / n) * r0), col) for k in range(n)]
    B = [mb.vert(Fr(cx + math.sin(k * math.tau / n) * r1, y, ch + math.cos(k * math.tau / n) * r1), col) for k in range(n)]
    for k in range(n):
        mb.face([A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]], want)


def bipyramid(mb, c, r, h_up, h_dn, seg, cols, phase=0.0):
    """星晶：上下兩個尖錐（顏色由上到下漸深）"""
    top, mid, bot = cols
    cx, cz, ch = c
    G.lathe(mb, cx, cz, ch, [(0.0, -h_dn), (r * 0.62, -h_dn * 0.45), (r, 0.0), (r * 0.7, h_up * 0.42), (0.0, h_up)], seg, lambda h: top if h > ch + 0.01 else (mid if h > ch - h_dn * 0.5 else bot), phase=phase, smooth=False)


def ring3d(mb, c, R, tilt_axis_b, tilt, seg, radius, sides, col):
    """傾斜金環：中心 c、半徑 R；繞水平方位 tilt_axis_b 的軸傾斜 tilt 度"""
    ax = (math.sin(math.radians(tilt_axis_b)), math.cos(math.radians(tilt_axis_b)), 0.0)
    perp = (-ax[1], ax[0], 0.0)
    t = math.radians(tilt)
    v = (perp[0] * math.cos(t), perp[1] * math.cos(t), math.sin(t))
    pts = [tuple(c[i] + R * (math.cos(a) * ax[i] + math.sin(a) * v[i]) for i in range(3)) for a in [k * math.tau / seg for k in range(seg + 1)]]
    G.tube(mb, pts, radius, sides, col)


def window(stone, glow, gm, gcol, Fr, w, h0, hgt, lite, mullion):
    """尖拱窗（石框＋發光玻璃＋金色窗櫺），朝 −y"""
    seg = 3 if lite else 5
    hs = h0 + hgt - w * 0.866
    vextrude(stone, Fr, lancet(w + 0.24, h0 - 0.12, hs - 0.02, seg), -0.03, 0.12, C["trim"])
    vpoly(glow, Fr, lancet(w, h0, hs, seg), -0.05, C["glass"], -1)
    vpoly(glow, Fr, lancet(w * 0.5, hs + 0.05, hs + 0.05 + (w * 0.866 - w * 0.5 * 0.866) * 0.4, seg), -0.055, C["glass_hi"], -1)
    G.box(stone, Fr, -w / 2 - 0.14, w / 2 + 0.14, -0.16, 0.0, h0 - 0.22, h0 - 0.1, C["trim"])
    if mullion:
        G.box(gm, Fr, -0.025, 0.025, -0.075, -0.055, h0, hs + w * 0.8, gcol)
        G.box(gm, Fr, -w / 2, w / 2, -0.075, -0.055, h0 + (hs - h0) * 0.55, h0 + (hs - h0) * 0.55 + 0.05, gcol)


def banner(props, gm, gcol, Fr, x0, x1, h_top, h_bot, y, lite):
    """法師團垂旗：紫底、金邊、金色新月＋星；燕尾下緣；正反兩面"""
    nc = 3 if lite else 5
    cols = [x0 + (x1 - x0) * i / (nc - 1) for i in range(nc)]
    mid = nc // 2
    rows = 3 if lite else 5
    shade = [1.0, 0.86, 1.06, 0.88, 1.0] if not lite else [1.0, 0.9, 1.0]
    for side in (-1, 1):
        grid = []
        for r in range(rows + 1):
            v = r / rows
            h = h_top - v * (h_top - h_bot)
            row = []
            for ci, x in enumerate(cols):
                hh = h if r < rows else h_bot + (h_top - h_bot) * 0.1 * (abs(ci - mid) / mid)
                fold = 0.02 * (1 if ci % 2 else -1) * (0 if ci in (0, nc - 1) else 1)
                row.append(props.vert(Fr(x, y + fold + side * 0.002, hh), tuple(min(1.0, c * shade[ci]) for c in C["banner"])))
            grid.append(row)
        for r in range(rows):
            for ci in range(nc - 1):
                props.face([grid[r][ci], grid[r][ci + 1], grid[r + 1][ci + 1], grid[r + 1][ci]], G.sub(Fr(0, side, 0), Fr(0, 0, 0)))
    yf = y - 0.012
    bw = 0.07 * (x1 - x0)
    for xa, xb in ((x0, x0 + bw), (x1 - bw, x1)):
        vpoly(gm, Fr, [(xa, h_bot + (h_top - h_bot) * 0.12), (xb, h_bot + (h_top - h_bot) * 0.12), (xb, h_top), (xa, h_top)], yf, gcol, -1)
    cx = (x0 + x1) / 2
    R = (x1 - x0) * 0.26
    hc = h_top - (h_top - h_bot) * 0.3
    crescent(gm, Fr, cx - R * 0.15, hc, R, yf, gcol, seg=6 if lite else 8)
    vpoly(gm, Fr, star_outline(cx + R * 0.45, hc + R * 0.1, 4, R * 0.42, R * 0.13), yf, gcol, -1)


def crystal_lamp(stone, props, gm, gcol, glow, lx, ly, P):
    px, pz, _ = F(lx, ly, 0)
    Fr = G.frame(px, pz, FACE, FLOOR)
    G.box(stone, Fr, -0.32, 0.32, -0.32, 0.32, 0.0, 0.18, C["plinth"])
    G.lathe(stone, px, pz, FLOOR, [(0.24, 0.18), (0.18, 0.3), (0.15, 0.75), (0.22, 0.85), (0.24, 0.92), (0.0, 0.92)], P["small"], C["trim"])
    G.lathe(gm, px, pz, FLOOR, [(0.1, 0.92), (0.2, 1.0), (0.24, 1.12), (0.21, 1.14), (0.0, 1.02)], P["small"], gcol)
    bipyramid(glow, (px, pz, FLOOR + 1.36), 0.16, 0.3, 0.24, 6, (C["crystal_top"], C["crystal_mid"], C["crystal_bot"]))


def build(lod):
    P = LOD[lod]
    lite = lod == "lite"
    stone = G.MB("Mage_stone", True)
    roof = G.MB("Mage_roof", True)
    gold = G.MB("Mage_gold", False)
    props = G.MB("Mage_props", False)
    glow = G.MB("Mage_glow", False)
    gm, gcol = (props, C["gold_vc"]) if lite else (gold, (1, 1, 1))
    tcx, tcz = wpos(*TOWER)

    # ---- 八角石台基座（正面一邊平行廣場）＋寬石階 ----
    oct_r = 5.9  # 頂點半徑；邊心距 5.45 → 正面在 y 1.95
    ph = math.radians(FACE + 22.5)
    G.lathe(stone, tcx, tcz, FLOOR, [(oct_r, 0.0), (oct_r, 0.56), (oct_r + 0.06, 0.56), (oct_r + 0.06, 0.68), (0.0, 0.68)], 8, lambda h: C["plinth"] if h < FLOOR + 0.5 else C["trim"], phase=ph, smooth=False)
    for k in range(4):
        G.box(stone, F, -2.55, 2.55, 0.49 * k, 1.97, 0.0, 0.17 * (k + 1), C["step"])
    # 石階兩側矮欄牆＋水晶燈
    for sx in (-1, 1):
        xa, xb = sorted((sx * 2.55, sx * 3.15))
        G.box(stone, F, xa, xb, 0.1, 2.1, 0.0, 0.8, C["wall2"])
        G.box(stone, F, xa - 0.05, xb + 0.05, 0.05, 2.15, 0.8, 0.9, C["trim"])
        crystal_lamp(stone, props, gm, gcol, glow, sx * 3.75, 0.55, P)

    # ---- 圓形主塔 ----
    trim_h = [(0.6, 1.05), (5.75, 6.15), (10.95, 11.35), (11.95, 12.7)]
    tcol = lambda h: C["trim"] if any(FLOOR + a - 1e-3 <= h <= FLOOR + b + 1e-3 for a, b in trim_h) else C["wall"]  # noqa: E731
    tprof = [(3.55, 0.6), (3.55, 0.95), (3.4, 1.05), (3.3, 1.1), (3.25, 5.75), (3.4, 5.8), (3.4, 6.1), (3.1, 6.15), (2.95, 10.95), (3.1, 11.0), (3.1, 11.3), (3.0, 11.35), (3.2, 11.6), (3.4, 11.95), (3.45, 12.05), (3.45, 12.55), (3.55, 12.57), (3.55, 12.7), (0.0, 12.7)]
    G.lathe(stone, tcx, tcz, FLOOR, tprof, P["tower"], tcol)
    if not lite:
        for h in (6.12, 11.32):
            G.lathe(gm, tcx, tcz, FLOOR, [(3.12 if h < 7 else 3.12, h - 0.04), (3.15 if h < 7 else 3.15, h), (3.12 if h < 7 else 3.12, h + 0.04)], P["tower"], gcol)
        # 塔頂護欄下的托架
        for k in range(24):
            b = k * 15
            px, pz = G.pol(b, 3.0, tcx, tcz)
            G.box(stone, G.frame(px, pz, b, FLOOR), -0.09, 0.09, -0.02, 0.32, 11.4, 11.95, C["trim"])
    # 星詠台：8 根細柱＋柱頭金飾；地面金色八芒星
    for k in range(8):
        b = FACE + 22.5 + 45 * k
        px, pz = G.pol(b, 2.72, tcx, tcz)
        G.lathe(stone, px, pz, FLOOR, [(0.22, 12.7), (0.22, 12.88), (0.14, 12.98), (0.12, 14.05), (0.19, 14.18), (0.24, 14.38), (0.0, 14.38)], P["col"], C["trim"])
        G.lathe(gm, px, pz, FLOOR, [(0.15, 14.0), (0.2, 14.07), (0.15, 14.14)], P["col"], gcol)
    G.flat_star(gm, tcx, tcz, FLOOR + 12.705, 8, [1.55, 1.15], 0.62, gcol if not lite else C["gold_vc"], tuple(c * 0.82 for c in gcol) if not lite else tuple(c * 0.82 for c in C["gold_vc"]), rot=FACE)
    # 漂浮星晶＋金色雙環（呼應星願之泉）
    cc = (tcx, tcz, FLOOR + 13.55)
    bipyramid(glow, cc, 0.48, 0.66, 0.56, 8, (C["crystal_top"], C["crystal_mid"], C["crystal_bot"]), phase=math.radians(FACE))
    ring3d(gm, cc, 1.0, FACE + 30, 24, P["ring"], 0.035 if not lite else 0.045, 6 if not lite else 4, gcol)
    ring3d(gm, cc, 1.15, FACE - 50, -18, P["ring"], 0.03 if not lite else 0.04, 6 if not lite else 4, gcol)
    # 紫藍尖頂（魔女帽式內凹曲線）
    rprof = [(3.85, 14.35), (3.4, 14.8), (2.7, 15.45), (1.98, 16.25), (1.34, 17.1), (0.8, 17.95), (0.38, 18.7), (0.12, 19.15), (0.0, ROOF_TIP)]
    G.lathe(roof, tcx, tcz, FLOOR, rprof, P["roof"], lambda h: C["roof"] if h > FLOOR + 14.8 else C["roof_d"], bottom=True)
    G.lathe(gm, tcx, tcz, FLOOR, [(3.87, 14.3), (3.9, 14.37), (3.85, 14.44)], P["roof"], gcol)
    if P["ridges"]:
        for k in range(8):
            b = FACE + 22.5 + 45 * k
            pts = [(*G.pol(b, r, tcx, tcz), FLOOR + h + 0.03) for r, h in rprof[:-1]]
            G.tube(gm, pts, 0.035, 4, gcol, taper=0.5)
        # 尖頂兩扇小星窗（正面左右）
        for off in (-28, 28):
            b = FACE + off
            px, pz = G.pol(b, 2.2, tcx, tcz)
            Dm = G.frame(px, pz, b + 180, FLOOR)
            G.box(stone, Dm, -0.3, 0.3, -0.2, 0.5, 15.75, 16.45, C["wall"])
            vextrude(roof, Dm, [(-0.42, 16.4), (0.42, 16.4), (0.0, 16.9)], -0.25, 0.75, C["roof"])
            vpoly(glow, Dm, circle(0, 16.1, 0.2, 8), -0.21, C["glass_hi"], -1)
    # 尖頂：金色新月＋星
    G.lathe(gm, tcx, tcz, FLOOR, [(0.13, 19.15), (0.19, 19.3), (0.09, 19.45), (0.05, 19.55), (0.0, 19.6)], P["small"], gcol)
    Fs = G.frame(tcx, tcz, FACE + 180, FLOOR)  # −y＝朝廣場
    crescent(gm, Fs, -0.04, 19.79, 0.19, -0.01, gcol, seg=6 if lite else 8)
    crescent(gm, Fs, -0.04, 19.79, 0.19, 0.01, gcol, seg=6 if lite else 8, facing=1)
    vpoly(gm, Fs, star_outline(0.12, 19.83, 4, 0.08, 0.025), -0.012, gcol, -1)
    vpoly(gm, Fs, star_outline(0.12, 19.83, 4, 0.08, 0.025), 0.012, gcol, 1)

    # ---- 主塔窗戶 ----
    wins = [(55, 2.3, 0.62, 1.6, 3.3), (-55, 2.3, 0.62, 1.6, 3.3), (40, 7.0, 0.7, 1.9, 3.06), (-40, 7.0, 0.7, 1.9, 3.06), (95, 8.2, 0.7, 1.9, 3.03), (-95, 8.2, 0.7, 1.9, 3.03)]
    if P["back_windows"]:
        wins += [(150, 7.4, 0.7, 1.9, 3.05), (-150, 7.4, 0.7, 1.9, 3.05), (180, 3.0, 0.62, 1.6, 3.3), (125, 2.6, 0.62, 1.6, 3.3), (-125, 2.6, 0.62, 1.6, 3.3)]
    for off, h0, w, hg, r in wins:
        b = FACE + off
        px, pz = G.pol(b, r - 0.02, tcx, tcz)
        window(stone, glow, gm, gcol, G.frame(px, pz, b + 180, FLOOR), w, h0, hg, lite, P["mullion"])
    # 主塔正面：法師團徽（石圓盤＋金環＋新月＋星），在門廳屋脊上方
    Ft = G.frame(*wpos(0, 0), BEARING, FLOOR)
    vextrude(stone, Ft, circle(0, 10.15, 1.08, 16 if not lite else 10), 4.12, 0.4, C["trim"])
    vpoly(props, Ft, circle(0, 10.15, 0.9, 16 if not lite else 10), 4.105, C["door"], -1)
    if not lite:
        annulus(gm, Ft, 0, 10.15, 0.9, 0.99, 4.1, gcol, 24)
    crescent(gm, Ft, -0.14, 10.15, 0.58, 4.09, gcol, seg=6 if lite else 10)
    vpoly(gm, Ft, star_outline(0.32, 10.3, 4, 0.3, 0.09), 4.09, gcol, -1)
    if not lite:
        for k in range(3):
            a = math.radians(-60 + 30 * k)
            vpoly(gm, Ft, star_outline(0.62 * math.sin(a) + 0.05, 10.15 + 0.62 * math.cos(a) - 0.25, 4, 0.07, 0.02), 4.09, gcol, -1)

    # ---- 尖拱門廳 ----
    G.box(stone, F, -2.9, 2.9, 1.95, 5.0, 0.6, 6.3, C["wall"])
    G.box(stone, F, -3.02, 3.02, 1.85, 5.0, 6.2, 6.42, C["trim"])
    G.box(stone, F, -3.0, 3.0, 1.85, 5.0, 0.6, 1.0, C["plinth"])
    vextrude(stone, F, [(-2.9, 6.42), (2.9, 6.42), (0.0, 8.7)], 1.95, 3.05, C["wall"])
    # 屋頂兩坡（雙面）
    for sx in (-1, 1):
        q = [F(sx * 3.3, 1.72, 6.12), F(0, 1.72, 8.95), F(0, 5.4, 8.95), F(sx * 3.3, 5.4, 6.12)]
        ids = [roof.vert(p, C["roof"]) for p in q]
        roof.face(ids, G.sub(F(sx * 0.65, 0, 1), F(0, 0, 0)))
        ids2 = [roof.vert(p, C["roof_d"]) for p in q]
        roof.face(ids2, G.sub(F(-sx * 0.65, 0, -1), F(0, 0, 0)))
        # 屋頂厚度（前緣）
        e = [F(sx * 3.3, 1.72, 6.12), F(0, 1.72, 8.95), F(0, 1.72, 8.75), F(sx * 3.3, 1.72, 5.92)]
        roof.face([roof.vert(p, C["roof_d"]) for p in e], G.sub(F(0, -1, 0), F(0, 0, 0)))
        G.tube(gm, [F(sx * 3.32, 1.7, 6.1), F(0, 1.7, 8.97)], 0.05 if not lite else 0.06, 4 if not lite else 3, gcol)
    G.tube(gm, [F(0, 1.7, 8.97), F(0, 4.9, 8.97)], 0.06, 4 if not lite else 3, gcol)
    G.lathe(gm, *F(0, 1.75, 0)[:2], FLOOR, [(0.09, 8.9), (0.14, 9.05), (0.06, 9.2), (0.0, 9.45)], P["small"], gcol)
    # 尖拱大門：兩層石拱框＋深紫藍門板＋金飾
    seg = 6 if not lite else 4
    vextrude(stone, F, lancet(2.95, 0.6, 3.0, seg), 1.86, 0.1, C["trim"])
    vextrude(stone, F, lancet(2.5, 0.6, 3.0, seg), 1.8, 0.07, C["wall2"])
    vpoly(props, F, lancet(2.05, 0.6, 3.0, seg), 1.77, C["door"], -1)
    G.box(props, F, -0.025, 0.025, 1.745, 1.77, 0.6, 3.0 + 2.05 * 0.86, C["door_d"])
    if not lite:
        for sx in (-1, 1):
            for h0, h1 in ((0.95, 1.9), (2.15, 3.2)):
                G.box(props, F, min(sx * 0.15, sx * 0.85), max(sx * 0.15, sx * 0.85), 1.75, 1.765, h0, h1, C["door_d"])
        L = lancet(2.12, 0.6, 3.0, 8)
        G.tube(gm, [F(x, 1.74, h) for x, h in L[1:]], 0.035, 4, gcol)
        for h in (1.5, 2.65):
            G.box(gm, F, -0.98, 0.98, 1.735, 1.75, h, h + 0.06, gcol)
    vpoly(gm, F, star_outline(0, 4.0, 4, 0.34, 0.1), 1.735, gcol, -1)
    G.lathe(gm, *F(-0.22, 1.72, 0)[:2], FLOOR + 2.1, [(0.0, 0.0), (0.08, 0.02), (0.09, 0.1), (0.0, 0.12)], 6, gcol)
    G.lathe(gm, *F(0.22, 1.72, 0)[:2], FLOOR + 2.1, [(0.0, 0.0), (0.08, 0.02), (0.09, 0.1), (0.0, 0.12)], 6, gcol)
    # 玫瑰窗（山牆）
    vextrude(stone, F, circle(0, 7.2, 0.98, 16 if not lite else 10), 1.88, 0.1, C["trim"])
    vpoly(glow, F, circle(0, 7.2, 0.8, 16 if not lite else 10), 1.86, C["rose"], -1)
    if not lite:
        st = star_outline(0, 7.2, 8, 0.78, 0.36, rot=math.pi / 8)
        G.tube(gm, [F(x, 1.845, h) for x, h in st + st[:1]], 0.025, 4, gcol)
        annulus(gm, F, 0, 7.2, 0.8, 0.86, 1.845, gcol, 24)
    else:
        vpoly(props, F, star_outline(0, 7.2, 8, 0.7, 0.3, rot=math.pi / 8), 1.845, C["gold_vc"], -1)
    # 門廳兩側垂旗
    for sx in (-1, 1):
        x0, x1 = (1.72, 2.62) if sx > 0 else (-2.62, -1.72)
        G.box(gm, F, x0 - 0.08, x1 + 0.08, 1.86, 1.92, 5.85, 5.92, gcol)
        banner(props, gm, gcol, F, x0, x1, 5.85, 2.55, 1.9, lite)

    # ---- 兩座小塔（左前高、右後低）----
    for (lx, ly, r), tip, shaft in ((T1, T1_TIP, 9.6), (T2, T2_TIP, 7.6)):
        cx, cz = wpos(lx, ly)
        G.lathe(stone, cx, cz, FLOOR, [(r + 0.1, 0.6), (r + 0.1, 0.95), (r, 1.05), (r, shaft), (r + 0.12, shaft + 0.25), (r + 0.2, shaft + 0.75), (r + 0.25, shaft + 0.85), (0.0, shaft + 0.85)], P["turret"], lambda h, s=shaft: C["trim"] if h > FLOOR + s - 0.01 or h < FLOOR + 1.06 else C["wall"])
        rb = r + 0.45
        base = shaft + 0.8
        prof = [(rb, base), (rb - 0.3, base + 0.4), (rb * 0.62, base + (tip - base) * 0.4), (rb * 0.32, base + (tip - base) * 0.7), (rb * 0.1, base + (tip - base) * 0.9), (0.0, tip)]
        G.lathe(roof, cx, cz, FLOOR, prof, P["turret"], C["roof"], bottom=True)
        G.lathe(gm, cx, cz, FLOOR, [(rb + 0.02, base - 0.05), (rb + 0.05, base + 0.02), (rb, base + 0.09)], P["turret"], gcol)
        G.lathe(gm, cx, cz, FLOOR, [(0.07, tip - 0.1), (0.11, tip + 0.05), (0.04, tip + 0.18), (0.0, tip + 0.22)], P["small"], gcol)
        Fs2 = G.frame(cx, cz, FACE + 180, FLOOR)
        vpoly(gm, Fs2, star_outline(0, tip + 0.36, 4, 0.13, 0.04), -0.01, gcol, -1)
        vpoly(gm, Fs2, star_outline(0, tip + 0.36, 4, 0.13, 0.04), 0.01, gcol, 1)
        # 小塔窗（朝外）
        outs = (FACE - 35, FACE - 100) if lx < 0 else (FACE + 60, FACE + 120)
        for k, b in enumerate(outs):
            px, pz = G.pol(b, r - 0.02, cx, cz)
            window(stone, glow, gm, gcol, G.frame(px, pz, b + 180, FLOOR), 0.48, shaft - 3.2 + k * 0.6, 1.3, lite, P["mullion"])
    # 連接牆（小塔與門廳／主塔）
    G.box(stone, F, -4.4, -2.9, 3.4, 5.4, 0.6, 5.2, C["wall2"])
    G.box(stone, F, -4.45, -2.9, 3.35, 5.45, 5.2, 5.42, C["trim"])
    G.box(stone, F, 2.6, 4.6, 8.1, 9.7, 0.6, 4.8, C["wall2"])
    G.box(stone, F, 2.6, 4.65, 8.05, 9.75, 4.8, 5.02, C["trim"])

    # ---- 漂浮小晶石（塔身周圍 3 顆）----
    for lx, ly, h, rr in ((3.55, 4.5, 10.6, 0.3), (-3.75, 9.7, 11.9, 0.28), (0.3, 11.95, 9.3, 0.27)):
        bipyramid(glow, F(lx, ly, h), rr, rr * 1.7, rr * 1.4, 6, (C["crystal_top"], C["crystal_mid"], C["crystal_bot"]))
    return {k: v for k, v in (("stone", stone), ("roof", roof), ("gold", gold), ("props", props), ("glow", glow)) if v.f}


# ---------------- UV（石牆：圓柱展開／方塊投影；屋頂：圓錐展開／坡面投影） ----------------
def _n(pts):
    n = G.newell(pts)
    L = math.sqrt(sum(x * x for x in n)) or 1.0
    return tuple(x / L for x in n)


CYL = [(*wpos(*TOWER), 2.9, 3.8), (*wpos(T1[0], T1[1]), 0.9, 1.6), (*wpos(T2[0], T2[1]), 0.8, 1.4)]
CONES = [(*wpos(*TOWER), 4.1, FLOOR + ROOF_TIP), (*wpos(T1[0], T1[1]), 1.8, FLOOR + T1_TIP), (*wpos(T2[0], T2[1]), 1.6, FLOOR + T2_TIP)]


def _cyl_uv(pts, tx, tz, a0, tile, h_of):
    out = []
    for p in pts:
        a = math.atan2(p[0] - tx, p[1] - tz)
        while a - a0 > math.pi:
            a -= math.tau
        while a - a0 < -math.pi:
            a += math.tau
        out.append((a * h_of, local(p)[2] / tile))
    return out


def stone_uv(pts, tile=2.4):
    n = _n(pts)
    c = G.centroid(pts)
    if abs(n[2]) > 0.7:
        return [(local(p)[0] / tile, local(p)[1] / tile) for p in pts]
    for tx, tz, r0, r1 in CYL:
        dx, dz = c[0] - tx, c[1] - tz
        dist = math.hypot(dx, dz)
        if r0 < dist < r1 and (n[0] * dx + n[1] * dz) / dist > 0.6:
            return _cyl_uv(pts, tx, tz, math.atan2(dx, dz), tile, dist / tile)
    nl = (n[0] * EX[0] + n[1] * EX[1], n[0] * EY[0] + n[1] * EY[1])
    if abs(nl[0]) > abs(nl[1]):
        return [(local(p)[1] / tile, local(p)[2] / tile) for p in pts]
    return [(local(p)[0] / tile, local(p)[2] / tile) for p in pts]


def roof_uv(pts, tile=1.6):
    c = G.centroid(pts)
    for tx, tz, rmax, apex in CONES:
        if math.hypot(c[0] - tx, c[1] - tz) < rmax and c[2] > apex - 9.5:
            a0 = math.atan2(c[0] - tx, c[1] - tz)
            out = []
            for p in pts:
                a = math.atan2(p[0] - tx, p[1] - tz)
                while a - a0 > math.pi:
                    a -= math.tau
                while a - a0 < -math.pi:
                    a += math.tau
                r = math.hypot(p[0] - tx, p[1] - tz)
                out.append((a / math.tau * (rmax * 2.5), math.hypot(r, apex - p[2]) / tile))
            return out
    n = _n(pts)
    t = (-n[1], n[0], 0.0)
    L = math.hypot(t[0], t[1]) or 1.0
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
    door = F(0, 1.77, 0.6)
    stair = G.pol(BEARING, 23.0)
    report = {
        "lods": {},
        "budget": BUDGET,
        "stage": "P3-4 造型提案",
        "layout": {"bearing": BEARING, "front": FRONT, "w": W, "d": D, "top": TOP, "floor": FLOOR, "door": [round(door[0], 3), round(door[1], 3)], "stair_top": [round(stair[0], 3), round(stair[1], 3)]},
    }
    log = []
    for lod in ("lite", "hq"):
        vp3_kit.reset()
        mats = {k: G.simple_mat(f"VP3_mage_{k}", (1, 1, 1)) for k in ("stone", "roof", "gold", "props", "glow")}
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
        path = os.path.join(OUT, f"mage_{lod}.glb")
        vp3_kit.export_glb(list(objs.values()), path)
        tris = sum(per.values())
        report["lods"][lod] = {"triangles": tris, "by_mesh": per, "meshes": len(objs), "ao_baked": ok, "bytes": os.path.getsize(path), "within_budget": tris <= BUDGET[lod], "bounds_local": bounds}
    report["log"] = log
    report["seconds"] = round(time.time() - t0, 1)
    with open(os.path.join(OUT, "mage_report.json"), "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1))
    if not all(v["within_budget"] for v in report["lods"].values()):
        raise SystemExit("三角面超出預算")


if __name__ == "__main__":
    main()
