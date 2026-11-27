"""P3-2B 星芽村「騎士軍團」建築（HQ / Lite）。

blender -b --factory-startup -P build_knight.py -- --out <輸出資料夾>

- 位置、尺寸完全沿用 V1.3（layout.ts）：方位 332°、正面在 r 27（面向噴泉）、寬 16 × 深 14、最高 19 m、
  地面在北側高台 +2 m。所有網格都在原碰撞箱（±8 × 0～14 × 0～19）內，不改碰撞；NPC 站位 r 25 在正門石階前 2 m。
- 造型：中央門樓（三層拱門、深藍大門、金色騎士團徽）、兩側圓塔（深藍圓錐屋頂、金色尖頂）、後方主樓（深藍四坡屋頂）、
  正門寬石階＋兩側騎士雕像、門樓兩側垂旗、石階兩側旗桿大旗
- 網格依材質合併：stone（暖白石牆，貼圖在遊戲端共用載入）、roof（深藍屋瓦，同上）、gold（HQ）、props（門、窗、旗、雕像，頂點色）
  Lite 的金色畫在頂點色裡（3 個網格）
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
import vp3_kit  # noqa: E402

# ---------------- V1.3 騎士軍團 ----------------
BEARING, FRONT, W, D, TOP, FLOOR = 332.0, 27.0, 16.0, 14.0, 19.0, 2.0
OX, OZ = G.pol(BEARING, FRONT)  # 正面中心（地面）
F = G.frame(OX, OZ, BEARING, FLOOR)  # 區域座標：x 右（從廣場看）、y 往建築內、h 高（離高台面）
FACE = BEARING + 180  # 正面朝向（噴泉）
BUDGET = {"hq": 40700, "lite": 16350}  # Stage 6.6：＋壁燈與花盆
LOD = {
    "hq": dict(tower=32, roof=32, small=12, corbels=True, studs=True, win_levels=3, statue_full=True, sword_emblem=True),
    "lite": dict(tower=12, roof=12, small=6, corbels=False, studs=False, win_levels=2, statue_full=False, sword_emblem=False),
}

C = {
    "wall": (0.97, 0.94, 0.88),
    "wall2": (0.94, 0.90, 0.83),
    "trim": (0.99, 0.97, 0.93),
    "plinth": (0.86, 0.80, 0.71),
    "step": (0.93, 0.89, 0.81),
    "roof": (0.22, 0.33, 0.62),
    "roof_d": (0.17, 0.26, 0.52),
    "door": (0.16, 0.24, 0.45),
    "door_d": (0.11, 0.16, 0.31),
    "glass": (0.16, 0.25, 0.46),
    "iron": (0.20, 0.25, 0.34),
    "blue": (0.17, 0.30, 0.62),
    "steel": (0.80, 0.82, 0.88),
    "steel_d": (0.62, 0.65, 0.72),
    "leather": (0.45, 0.30, 0.18),
    "gold_vc": (0.92, 0.73, 0.33),
}
EX = G.sub(F(1, 0, 0), F(0, 0, 0))
EY = G.sub(F(0, 1, 0), F(0, 0, 0))
TOWERS = [(-5.6, 4.2), (5.6, 4.2)]
TOWER_R = 1.9


def dirv(*v):
    """區域方向 → 平面方向"""
    return tuple(EX[i] * v[0] + EY[i] * v[1] + (v[2] if i == 2 else 0.0) for i in range(3))


def local(p):
    d = (p[0] - OX, p[1] - OZ)
    return (d[0] * EX[0] + d[1] * EX[1], d[0] * EY[0] + d[1] * EY[1], p[2] - FLOOR)


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
    """直立凸多邊形擠出：正面在 y_front（朝 facing），往背面延伸 depth；不做背面"""
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


def plank(mb, Fr, p0, p1, width, y0, y1, col):
    """直立平面內沿線段的細長方塊（劍、斜桿）"""
    dx, dh = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dx, dh) or 1.0
    px, ph = -dh / L * width / 2, dx / L * width / 2
    quad = [(p0[0] + px, p0[1] + ph), (p1[0] + px, p1[1] + ph), (p1[0] - px, p1[1] - ph), (p0[0] - px, p0[1] - ph)]
    P = [Fr(x, y, h) for y in (y0, y1) for x, h in quad]
    ids = [mb.vert(p, col) for p in P]
    c = Fr((p0[0] + p1[0]) / 2, (y0 + y1) / 2, (p0[1] + p1[1]) / 2)
    for q in ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        idx = [ids[i] for i in q]
        mb.face(idx, G.sub(G.centroid([mb.v[i] for i in idx]), c))


def arch_outline(w, h0, hs, seg):
    """拱形輪廓：寬 w、底 h0、起拱高度 hs（上方半圓）"""
    pts = [(-w / 2, h0), (w / 2, h0)]
    for k in range(seg + 1):
        a = math.pi * k / seg
        pts.append((math.cos(a) * w / 2, hs + math.sin(a) * w / 2))
    return pts


def shield_outline(w, top, height, seg=6, cx=0.0):
    return [(x + cx, h) for x, h in _shield(w, top, height, seg)]


def _shield(w, top, height, seg):
    pts = [(-w / 2, top)]
    for k in range(1, seg + 1):
        t = k / seg
        pts.append((-w / 2 * (1 - t ** 2.2), top - height * (0.35 + 0.65 * t) if k < seg else top - height))
    for k in range(seg - 1, 0, -1):
        t = k / seg
        pts.append((w / 2 * (1 - t ** 2.2), top - height * (0.35 + 0.65 * t)))
    pts.append((w / 2, top))
    pts.append((0, top + height * 0.04))
    return pts


def star_outline(cx, ch, n, r_out, r_in, rot=0.0):
    return [(cx + math.sin(rot + i * math.pi / n) * (r_out if i % 2 == 0 else r_in), ch + math.cos(rot + i * math.pi / n) * (r_out if i % 2 == 0 else r_in)) for i in range(n * 2)]


def star_fan(mb, Fr, cx, ch, n, r_out, r_in, y, col, facing=-1):
    """凹多邊形星形用中心扇形（不擠出）"""
    vpoly(mb, Fr, star_outline(cx, ch, n, r_out, r_in), y, col, facing)


def arch_ring(mb, Fr, hs, r_in, r_out, y_front, y_back, seg, col):
    """半圓拱圈（正面＋內側拱腹＋外緣）"""
    want_f = G.sub(Fr(0, -1, 0), Fr(0, 0, 0))
    fr, bk = [], []
    for k in range(seg + 1):
        a = math.pi * k / seg
        c, s = math.cos(a), math.sin(a)
        fr.append((mb.vert(Fr(c * r_in, y_front, hs + s * r_in), col), mb.vert(Fr(c * r_out, y_front, hs + s * r_out), col)))
        bk.append((mb.vert(Fr(c * r_in, y_back, hs + s * r_in), col), mb.vert(Fr(c * r_out, y_back, hs + s * r_out), col)))
    for k in range(seg):
        a = math.pi * (k + 0.5) / seg
        mb.face([fr[k][0], fr[k + 1][0], fr[k + 1][1], fr[k][1]], want_f)
        mb.face([fr[k][0], fr[k + 1][0], bk[k + 1][0], bk[k][0]], G.sub(Fr(-math.cos(a), 0, -math.sin(a)), Fr(0, 0, 0)))
        mb.face([fr[k][1], fr[k + 1][1], bk[k + 1][1], bk[k][1]], G.sub(Fr(math.cos(a), 0, math.sin(a)), Fr(0, 0, 0)))


def window(stone, props, gold, Fr, x, h0, w, hgt, lite, gm, gcol):
    """拱窗（窗框石材＋深藍玻璃＋金色窗櫺），朝 −y"""
    seg = 4 if lite else 6
    vextrude(stone, Fr, arch_outline(w + 0.22, h0 - 0.12, h0 + hgt - w / 2, seg), -0.03, 0.06, C["trim"])
    vpoly(props, Fr, arch_outline(w, h0, h0 + hgt - w / 2, seg), -0.045, C["glass"], -1)
    if not lite:
        plank(gm, Fr, (x * 0 + 0, h0), (0, h0 + hgt), 0.04, -0.06, -0.045, gcol)
        plank(gm, Fr, (-w / 2, h0 + hgt * 0.55), (w / 2, h0 + hgt * 0.55), 0.035, -0.06, -0.045, gcol)
    G.box(stone, Fr, -w / 2 - 0.12, w / 2 + 0.12, -0.14, 0.0, h0 - 0.18, h0 - 0.08, C["trim"])
    if not lite:
        # P3-2D：拱頂拱心石＋窗台下兩個小托架
        G.box(stone, Fr, -0.09, 0.09, -0.08, 0.0, h0 + hgt - 0.02, h0 + hgt + 0.2, C["trim"])
        for sx in (-w / 2 + 0.02, w / 2 - 0.1):
            G.box(stone, Fr, sx, sx + 0.08, -0.1, 0.0, h0 - 0.34, h0 - 0.18, C["trim"])


def banner(props, gm, gcol, Fr, x0, x1, h_top, h_bot, y, wave, lite):
    """騎士旗：藍底、金邊、金色盾徽、燕尾下緣；正反兩面（背面只有藍底）"""
    nc = 3 if lite else 5
    cols = [x0 + (x1 - x0) * i / (nc - 1) for i in range(nc)]
    mid = nc // 2
    rows = 3 if lite else 6
    shade = [1.0, 0.86, 1.06, 0.88, 1.0] if not lite else [1.0, 0.9, 1.0]
    for side in (-1, 1):
        grid = []
        for r in range(rows + 1):
            v = r / rows
            h = h_top - v * (h_top - h_bot)
            row = []
            for ci, x in enumerate(cols):
                if r < rows:
                    hh = h
                else:
                    hh = h_bot + (h_top - h_bot) * 0.08 * (1 - abs(ci - mid) / mid)
                fold = 0.025 * (1 if ci % 2 else -1) * (0 if ci in (0, nc - 1) else 1)
                yy = y + wave * math.sin(v * 3.0 + ci) + fold + side * 0.002
                k = shade[ci]
                row.append(props.vert(Fr(x, yy, hh), tuple(min(1.0, c * k) for c in C["blue"])))
            grid.append(row)
        for r in range(rows):
            for ci in range(nc - 1):
                props.face([grid[r][ci], grid[r][ci + 1], grid[r + 1][ci + 1], grid[r + 1][ci]], G.sub(Fr(0, side, 0), Fr(0, 0, 0)))
    # 正面金色飾邊與徽章（朝 −y，略浮在旗面前）
    yf = y - 0.012
    bw = 0.06 * (x1 - x0)
    for xa, xb in ((x0, x0 + bw), (x1 - bw, x1)):
        vpoly(gm, Fr, [(xa, h_bot + (h_top - h_bot) * 0.1), (xb, h_bot + (h_top - h_bot) * 0.1), (xb, h_top), (xa, h_top)], yf, gcol, -1)
    vpoly(gm, Fr, [(x0, h_top - 0.12), (x1, h_top - 0.12), (x1, h_top), (x0, h_top)], yf, gcol, -1)
    cx = (x0 + x1) / 2
    sw = (x1 - x0) * 0.5
    top = h_top - (h_top - h_bot) * 0.18
    vpoly(gm, Fr, shield_outline(sw, top, sw * 1.25, cx=cx), yf, gcol, -1)
    vpoly(props, Fr, shield_outline(sw * 0.72, top - sw * 0.1, sw * 0.95, cx=cx), yf - 0.006, C["blue"], -1)
    star_fan(gm, Fr, cx, top - sw * 0.5, 4, sw * 0.22, sw * 0.08, yf - 0.012, gcol)
    vpoly(gm, Fr, [(x0, h_bot + (h_top - h_bot) * 0.2), (x1, h_bot + (h_top - h_bot) * 0.2), (x1, h_bot + (h_top - h_bot) * 0.24), (x0, h_bot + (h_top - h_bot) * 0.24)], yf, gcol, -1)
    if not lite:
        # P3-2D：燕尾兩端金色流蘇
        for x in (x0, x1):
            G.blob(gm, Fr(x, y, h_bot - 0.06), 0.035, 0.035, 0.06, gcol)


def statue(stone, props, gm, gcol, sx, lite):
    """騎士雕像：石座＋盔甲騎士雙手拄劍（面向廣場）"""
    G.box(stone, F, sx - 0.45, sx + 0.45, 2.0, 2.9, 0.6, 0.72, C["plinth"])
    G.box(stone, F, sx - 0.38, sx + 0.38, 2.07, 2.83, 0.72, 1.35, C["trim"])
    G.box(stone, F, sx - 0.44, sx + 0.44, 2.01, 2.89, 1.35, 1.45, C["plinth"])
    px, pz, _ = F(sx, 2.45, 0)
    S = G.frame(px, pz, FACE, FLOOR + 1.45)  # 雕像自身座標：+y 面向廣場
    seg = 12 if not lite else 6
    for lx in (-0.11, 0.11):
        G.box(props, S, lx - 0.08, lx + 0.08, -0.1, 0.1, 0.0, 0.75, C["steel_d"])
        G.box(props, S, lx - 0.09, lx + 0.09, -0.11, 0.17, 0.0, 0.1, C["steel_d"])
    G.lathe(props, px, pz, FLOOR + 1.45, [(0.3, 0.62), (0.27, 0.98), (0.25, 1.0)], seg, C["blue"])
    G.lathe(props, px, pz, FLOOR + 1.45, [(0.25, 0.98), (0.29, 1.2), (0.28, 1.42), (0.17, 1.52), (0.0, 1.53)], seg, C["steel"])
    G.lathe(props, px, pz, FLOOR + 1.45, [(0.09, 1.52), (0.13, 1.58), (0.14, 1.72), (0.11, 1.81), (0.0, 1.86)], seg, C["steel"])
    G.blob(props, S(0, -0.02, 1.93), 0.04, 0.16, 0.07, C["blue"])
    for lx in (-0.3, 0.3):
        G.blob(props, S(lx, 0, 1.36), 0.13, 0.13, 0.08, C["steel"])
        G.tube(props, [S(lx, 0.0, 1.33), S(lx * 0.85, 0.16, 1.08), S(lx * 0.2, 0.3, 1.1)], 0.06, 5 if not lite else 4, C["steel_d"])
    if not lite:
        # P3-2D：腰帶（金）、護膝、護手、頭盔金飾脊、雙層肩甲
        G.lathe(gm, px, pz, FLOOR + 1.45, [(0.27, 0.95), (0.285, 0.98), (0.27, 1.01)], seg, gcol)
        for lx in (-0.11, 0.11):
            G.blob(props, S(lx, 0.1, 0.42), 0.07, 0.05, 0.06, C["steel"])
        for lx in (-0.07, 0.07):
            G.blob(props, S(lx, 0.3, 1.12), 0.05, 0.05, 0.045, C["steel_d"])
        G.box(gm, S, -0.012, 0.012, -0.12, 0.13, 1.8, 1.9, gcol)
        for lx in (-0.3, 0.3):
            G.blob(props, S(lx * 1.05, 0, 1.3), 0.12, 0.12, 0.06, C["steel_d"])
    # 劍（劍尖朝下拄地）
    G.box(props, S, -0.035, 0.035, 0.3, 0.33, 0.04, 0.98, C["steel"])
    G.box(gm, S, -0.2, 0.2, 0.28, 0.35, 0.98, 1.03, gcol)
    G.box(props, S, -0.03, 0.03, 0.29, 0.34, 1.03, 1.16, C["leather"])
    G.blob(gm, S(0, 0.315, 1.2), 0.045, 0.045, 0.045, gcol)
    if not lite:
        # 披風（正反兩面）、面罩縫、盾（靠在腳邊）、金色名牌
        # 披風：4 欄 × 3 列、交錯前後成布褶，正反兩面
        for side in (1, -1):
            grid = []
            for r in range(4):
                t = r / 3
                row = []
                for ci in range(5):
                    u = ci / 4 - 0.5
                    fold = 0.04 * t * (1 if ci % 2 else -1)
                    k = 0.88 if ci % 2 else 1.0
                    row.append(props.vert(S(u * (0.6 + 0.24 * t), -0.13 - 0.11 * t + fold - 0.003 * side, 1.42 - 1.3 * t), tuple(c * k for c in C["blue"])))
                grid.append(row)
            for r in range(3):
                for ci in range(4):
                    props.face([grid[r][ci], grid[r][ci + 1], grid[r + 1][ci + 1], grid[r + 1][ci]], G.sub(S(0, -side, 0), S(0, 0, 0)))
        G.box(props, S, -0.08, 0.08, 0.12, 0.15, 1.68, 1.71, (0.1, 0.12, 0.16))
        vextrude(gm, S, shield_outline(0.4, 0.74, 0.66, cx=-0.45), 0.19, 0.03, gcol, facing=1)
        vextrude(props, S, shield_outline(0.33, 0.71, 0.56, cx=-0.45), 0.2, 0.02, C["blue"], facing=1)
        vpoly(gm, S, star_outline(-0.45, 0.48, 4, 0.08, 0.03), 0.225, gcol, 1)
        # 底座線腳
        G.box(stone, F, sx - 0.42, sx + 0.42, 2.03, 2.87, 1.2, 1.28, C["trim"])
        G.box(gm, F, sx - 0.2, sx + 0.2, 2.05, 2.07, 0.95, 1.12, gcol)


def build(lod):
    P = LOD[lod]
    lite = lod == "lite"
    stone = G.MB("Knight_stone", True)
    roof = G.MB("Knight_roof", True)
    gold = G.MB("Knight_gold", False)
    props = G.MB("Knight_props", False)
    gm, gcol = (props, C["gold_vc"]) if lite else (gold, (1, 1, 1))

    # 基座＋正門寬石階（4 階，每階 0.15 m）＋兩側欄牆與金頂柱
    G.box(stone, F, -7.6, 7.6, 2.0, 13.8, 0.0, 0.6, C["plinth"])
    for k in range(4):
        G.box(stone, F, -4.6, 4.6, 0.5 * k, 2.0, 0.0, 0.15 * (k + 1), C["step"])
    for sx in (-1, 1):
        G.box(stone, F, sx * 4.6 if sx > 0 else -5.25, sx * 5.25 if sx > 0 else -4.6, 0.05, 2.4, 0.0, 0.9, C["wall2"])
        G.box(stone, F, sx * 4.55 if sx > 0 else -5.3, sx * 5.3 if sx > 0 else -4.55, 0.0, 2.45, 0.9, 1.0, C["trim"])
        px, pz, _ = F(sx * 4.92, 0.35, 0)
        G.box(stone, G.frame(px, pz, FACE, FLOOR), -0.3, 0.3, -0.3, 0.3, 1.0, 1.35, C["trim"])
        G.lathe(gm, px, pz, FLOOR + 1.35, [(0.12, 0.0), (0.2, 0.1), (0.21, 0.22), (0.13, 0.33), (0.06, 0.4), (0.0, 0.48)], P["small"], gcol)
    # P3-2D：基座頂線腳
    G.box(stone, F, -7.7, 7.7, 1.95, 13.9, 0.56, 0.68, C["trim"])
    # 中央門樓
    G.box(stone, F, -4.2, 4.2, 3.0, 8.0, 0.6, 11.0, C["wall"])
    G.box(stone, F, -4.4, 4.4, 2.72, 3.0, 10.3, 11.0, C["trim"])
    for k in range(8):
        x = -3.85 + 1.1 * k
        G.box(stone, F, x - 0.3, x + 0.3, 2.72, 3.3, 11.0, 11.8, C["wall"])
        if not lite:
            G.box(stone, F, x - 0.34, x + 0.34, 2.68, 3.34, 11.8, 11.9, C["trim"])  # P3-2D：城垛壓頂
    if P["corbels"]:
        for k in range(15):
            x = -3.85 + 0.55 * k
            G.box(stone, F, x - 0.1, x + 0.1, 2.8, 3.0, 9.9, 10.3, C["trim"])
    # 三層拱門（外層最突出）＋深藍大門
    hs = 4.3
    for k in range(3):
        r_out = 2.5 - 0.3 * k
        r_in = r_out - 0.3
        yf = 2.3 + 0.25 * k
        col = C["trim"] if k % 2 == 0 else C["wall2"]
        for sx in (-1, 1):
            G.box(stone, F, min(sx * r_in, sx * r_out), max(sx * r_in, sx * r_out), yf, 3.0, 0.6, hs, col)
        arch_ring(stone, F, hs, r_in, r_out, yf, 3.0, 10 if not lite else 6, col)
    G.box(stone, F, -0.28, 0.28, 2.18, 2.4, hs + 2.2, hs + 2.75, C["trim"])  # 拱心石
    vextrude(props, F, arch_outline(3.2, 0.6, hs, 10 if not lite else 6), 2.97, 0.05, C["door"])
    G.box(props, F, -0.03, 0.03, 2.93, 2.97, 0.6, hs + 1.55, C["door_d"])
    for h in (1.3, 2.6, 3.8):
        G.box(gm, F, -1.55, 1.55, 2.91, 2.95, h, h + 0.1, gcol)
        if P["studs"]:
            for k in range(8):
                x = -1.4 + 0.4 * k
                G.box(gm, F, x - 0.035, x + 0.035, 2.89, 2.91, h + 0.015, h + 0.085, gcol)
    for sx in (-0.25, 0.25):
        G.lathe(gm, *F(sx, 2.9, 0)[:2], FLOOR + 2.4, [(0.0, 0.0), (0.09, 0.02), (0.1, 0.1), (0.0, 0.12)], 6, gcol)
    if not lite:
        # P3-2D：門板浮雕框（深藍）、每扇門金色渦捲雕花與小金星、拱門內緣金線
        for sx in (-1, 1):
            for h0, h1 in ((0.85, 1.2), (1.5, 2.45), (2.75, 3.7)):
                G.box(props, F, min(sx * 0.18, sx * 1.42), max(sx * 0.18, sx * 1.42), 2.93, 2.965, h0, h1, C["door_d"])
            for k, (hc, rr) in enumerate(((4.55, 0.55), (2.0, 0.42))):
                pts = [F(sx * (0.8 + math.cos(a) * rr), 2.9, hc + math.sin(a) * rr * 0.8) for a in [math.pi * (0.15 + 0.7 * t / 7) for t in range(8)]]
                G.tube(gm, pts, 0.03, 4, gcol)
            vpoly(gm, F, star_outline(sx * 0.8, 3.22, 4, 0.16, 0.06), 2.89, gcol, -1)
        arch_ring(gm, F, hs, 1.6, 1.68, 2.92, 2.97, 10, gcol)
    # P3-2D：騎士團徽月桂枝（金）＋下方藍色緞帶
    if not lite:
        for sg in (-1, 1):
            for k in range(9):
                t = k / 8
                a = math.radians(-100 + 150 * t)
                lx, lh = sg * (1.45 * math.cos(a) + 0.05), 8.2 + 1.45 * math.sin(a)
                ta = a + math.pi / 2
                L, Wd = 0.26, 0.09
                leaf = [(lx - sg * math.cos(ta) * L / 2, lh - math.sin(ta) * L / 2), (lx + sg * math.sin(ta) * Wd, lh - math.cos(ta) * Wd), (lx + sg * math.cos(ta) * L / 2, lh + math.sin(ta) * L / 2), (lx - sg * math.sin(ta) * Wd, lh + math.cos(ta) * Wd)]
                vpoly(gm, F, leaf, 2.84, gcol, -1)
        rib = [(-1.5, 6.88), (1.5, 6.88), (1.65, 7.12), (1.5, 7.36), (-1.5, 7.36), (-1.65, 7.12)]
        vpoly(props, F, rib, 2.8, C["blue"], -1)
        vpoly(gm, F, [(-1.45, 7.06), (1.45, 7.06), (1.45, 7.18), (-1.45, 7.18)], 2.79, gcol, -1)
    # 騎士團徽：金邊盾＋藍底＋金色八芒星＋交叉雙劍＋王冠（門上）
    # 盾貼在門樓牆面（y 3.0）；交叉雙劍在盾後；王冠在盾上、托架前
    if P["sword_emblem"]:
        for sg in (-1, 1):
            plank(gm, F, (sg * 1.55, 6.95), (-sg * 1.55, 9.6), 0.16, 2.9, 2.98, gcol)
    vextrude(gm, F, shield_outline(2.4, 9.62, 2.8), 2.86, 0.14, gcol)
    vextrude(props, F, shield_outline(2.0, 9.45, 2.38), 2.83, 0.03, C["blue"])
    vextrude(gm, F, star_outline(0, 8.4, 8, 0.66, 0.26), 2.8, 0.03, gcol)
    crown = [(-0.72, 9.66), (0.72, 9.66), (0.82, 10.18), (0.4, 9.94), (0.0, 10.26), (-0.4, 9.94), (-0.82, 10.18)]
    vpoly(gm, F, crown, 2.7, gcol, -1)
    # 門樓兩側垂旗
    for sx in (-1, 1):
        x0, x1 = (2.75, 3.85) if sx > 0 else (-3.85, -2.75)
        G.box(gm, F, x0 - 0.08, x1 + 0.08, 2.82, 2.9, 9.62, 9.7, gcol)
        banner(props, gm, gcol, F, x0, x1, 9.62, 5.3, 2.92, 0.0, lite)
    # 兩側圓塔：塔身、腰線、托架、深藍圓錐屋頂、金尖頂、小三角旗
    seg = P["tower"]
    tprof = [(2.05, 0.0), (2.05, 0.6), (1.95, 0.72), (1.9, 0.8), (1.9, 5.9), (1.98, 5.95), (1.98, 6.15), (1.9, 6.2), (1.9, 9.3), (1.97, 9.35), (1.97, 9.5), (1.9, 9.55), (1.9, 11.6), (2.02, 11.75), (2.16, 12.0), (2.2, 12.1), (2.2, 12.9), (2.0, 12.95), (0.0, 12.95)]
    for tx, ty in TOWERS:
        cx, cz, _ = F(tx, ty, 0)
        G.lathe(stone, cx, cz, FLOOR, tprof, seg, C["wall"])
        G.lathe(roof, cx, cz, FLOOR, [(2.36, 12.75), (2.12, 13.1), (1.76, 13.9), (1.26, 15.2), (0.7, 16.6), (0.0, 18.3)], P["roof"], C["roof"], bottom=True)
        G.lathe(gm, cx, cz, FLOOR, [(2.38, 12.72), (2.4, 12.8), (2.36, 12.86)], P["roof"], gcol)
        G.lathe(gm, cx, cz, FLOOR, [(0.1, 18.15), (0.16, 18.35), (0.07, 18.55), (0.11, 18.75), (0.0, 19.0)], P["small"], gcol)
        if not lite:
            # P3-2D：圓錐屋頂 8 道金色屋脊、正面小老虎窗、尖頂小星
            for k in range(8):
                b = FACE + 22.5 + k * 45
                p0 = (*G.pol(b, 2.3, cx, cz), FLOOR + 12.8)
                p1 = (*G.pol(b, 1.3, cx, cz), FLOOR + 15.25)
                p2 = (*G.pol(b, 0.12, cx, cz), FLOOR + 18.15)
                G.tube(gm, [p0, p1, p2], 0.035, 4, gcol, taper=0.6)
            dx, dz = G.pol(FACE, 1.95, cx, cz)
            Dm = G.frame(dx, dz, FACE + 180, FLOOR)
            G.box(stone, Dm, -0.32, 0.32, -0.25, 0.35, 13.55, 14.35, C["wall"])
            vextrude(roof, Dm, [(-0.42, 14.3), (0.42, 14.3), (0.0, 14.75)], -0.3, 0.7, C["roof"])
            vpoly(props, Dm, arch_outline(0.34, 13.68, 14.05, 4), -0.26, C["glass"], -1)
            vpoly(gm, G.frame(cx, cz, FACE, FLOOR), star_outline(0, 18.82, 4, 0.16, 0.05), -0.12, gcol, -1)
        if P["corbels"]:
            for k in range(20):
                b = k * 18
                px, pz = G.pol(b, 1.9, cx, cz)
                G.box(stone, G.frame(px, pz, b, FLOOR), -0.1, 0.1, -0.05, 0.22, 11.35, 11.75, C["trim"])
        # 三角旗（往建築外側）
        out = 1 if tx > 0 else -1
        q = [props.vert(F(tx, ty, 18.62), C["blue"]), props.vert(F(tx + out * 0.7, ty, 18.5), C["blue"]), props.vert(F(tx, ty, 18.38), C["blue"])]
        props.face(q, dirv(0, -1, 0))
        q2 = [props.vert(props.v[i], C["blue"]) for i in q]
        props.face(q2, dirv(0, 1, 0))
        # 窗：正面、斜前、外側（HQ 三層、Lite 兩層）
        for b_off in ((0, -45 * out, -90 * out) if not lite else (0, -90 * out)):
            b = FACE + b_off
            px, pz = G.pol(b, 1.92, cx, cz)
            Wf = G.frame(px, pz, b + 180, FLOOR)  # −y＝朝外
            for h0 in (2.6, 7.0, 9.9)[: P["win_levels"]]:
                window(stone, props, gold, Wf, 0, h0, 0.6, 1.25, lite, gm, gcol)
    # 塔與主樓之間的城牆（含城垛）
    for sx in (-1, 1):
        xa, xb = (4.2, 7.3) if sx > 0 else (-7.3, -4.2)
        G.box(stone, F, xa, xb, 5.6, 7.6, 0.6, 9.5, C["wall2"])
        for k in range(3):
            x = xa + 0.5 + 1.05 * k
            G.box(stone, F, x - 0.25, x + 0.25, 5.6, 6.0, 9.5, 10.2, C["wall2"])
    # 後方主樓＋深藍四坡屋頂＋金色屋脊
    G.box(stone, F, -6.0, 6.0, 7.5, 13.6, 0.6, 14.0, C["wall2"])
    G.box(stone, F, -6.35, 6.35, 7.15, 13.95, 13.75, 14.0, C["trim"])
    ridge_h = 17.6
    A, B_, Cc, Dd = F(-6.35, 7.15, 14.0), F(6.35, 7.15, 14.0), F(6.35, 13.95, 14.0), F(-6.35, 13.95, 14.0)
    R1, R2 = F(-2.6, 10.55, ridge_h), F(2.6, 10.55, ridge_h)
    rv = lambda p: roof.vert(p, C["roof"])  # noqa: E731
    roof.face([rv(A), rv(B_), rv(R2), rv(R1)], dirv(0, -1, 0.8))
    roof.face([rv(Dd), rv(Cc), rv(R2), rv(R1)], dirv(0, 1, 0.8))
    roof.face([rv(A), rv(Dd), rv(R1)], dirv(-1, 0, 0.8))
    roof.face([rv(B_), rv(Cc), rv(R2)], dirv(1, 0, 0.8))
    G.box(gm, F, -2.6, 2.6, 10.5, 10.6, ridge_h - 0.02, ridge_h + 0.12, gcol)
    # P3-2D：四坡屋頂金色屋簷線與斜脊
    for a, b in ((A, B_), (B_, Cc), (Cc, Dd), (Dd, A), (A, R1), (Dd, R1), (B_, R2), (Cc, R2)):
        G.tube(gm, [a, b], 0.045, 4 if not lite else 3, gcol)
    # P3-2D：主樓四角隅石（長短交錯）
    for qx, qy in ((-6.0, 7.5), (6.0, 7.5), (-6.0, 13.6), (6.0, 13.6)):
        sxn = 1 if qx > 0 else -1
        syn = 1 if qy > 10 else -1
        h = 0.7
        k = 0
        while h < 13.6:
            long_ = k % 2 == 0
            lx = 0.7 if long_ else 0.4
            ly = 0.4 if long_ else 0.7
            xa, xb = sorted((qx - sxn * lx, qx + sxn * 0.04))
            ya, yb = sorted((qy - syn * ly, qy + syn * 0.04))
            G.box(stone, F, xa, xb, ya, yb, h, h + 0.56, C["trim"])
            h += 0.62
            k += 1
            if lite and k > 30:
                break
    for sx in (-2.6, 2.6):
        G.lathe(gm, *F(sx, 10.55, 0)[:2], FLOOR, [(0.08, ridge_h), (0.14, ridge_h + 0.2), (0.06, ridge_h + 0.42), (0.0, ridge_h + 0.7)], P["small"], gcol)
    Kf = G.frame(*F(0, 7.5, 0)[:2], BEARING, FLOOR)  # 主樓正面（y＝0 在 7.5）
    for x in ((-2.2, 0.0, 2.2) if True else ()):
        Wk = G.frame(*Kf(x, 0, 0)[:2], BEARING, FLOOR)
        window(stone, props, gold, Wk, 0, 11.9, 0.7, 1.4, lite, gm, gcol)
    if not lite:
        for sx in (-1, 1):
            for yk in (9.6, 12.0):
                for h0 in (8.0, 11.3):
                    px, pz, _ = F(sx * 6.0, yk, 0)
                    Ws = G.frame(px, pz, BEARING + 90 * sx + 180, FLOOR)
                    window(stone, props, gold, Ws, 0, h0, 0.6, 1.2, lite, gm, gcol)
    # 騎士雕像（石階頂兩側）
    for sx in (-3.45, 3.45):
        statue(stone, props, gm, gcol, sx, lite)
    # 石階兩側旗桿大旗
    for sx in (-6.9, 6.9):
        px, pz, _ = F(sx, 0.75, 0)
        G.box(stone, G.frame(px, pz, FACE, FLOOR), -0.36, 0.36, -0.36, 0.36, 0.0, 0.5, C["plinth"])
        G.lathe(props, px, pz, FLOOR, [(0.08, 0.5), (0.07, 1.0), (0.055, 10.4), (0.0, 10.42)], P["small"], C["iron"])
        G.lathe(gm, px, pz, FLOOR, [(0.0, 10.4), (0.1, 10.48), (0.12, 10.6), (0.07, 10.72), (0.0, 10.82)], P["small"], gcol)
        G.box(gm, F, sx - 0.72, sx + 0.72, 0.66, 0.72, 10.08, 10.16, gcol)
        banner(props, gm, gcol, F, sx - 0.68, sx + 0.68, 10.06, 5.0, 0.62, 0.05, lite)
    D66.decorate66("knight", locals(), F, lod)
    return {k: v for k, v in (("stone", stone), ("roof", roof), ("gold", gold), ("props", props)) if v.f}


# ---------------- UV（石牆：建築座標方塊投影＋圓塔圓柱展開；屋頂：圓錐展開／坡面投影） ----------------
def _n(pts):
    n = G.newell(pts)
    L = math.sqrt(sum(x * x for x in n)) or 1.0
    return tuple(x / L for x in n)


TOWER_PLAN = [F(tx, ty, 0)[:2] for tx, ty in TOWERS]


def stone_uv(pts, tile=2.4):
    n = _n(pts)
    c = G.centroid(pts)
    if abs(n[2]) > 0.7:
        return [(local(p)[0] / tile, local(p)[1] / tile) for p in pts]
    for tx, tz in TOWER_PLAN:
        dx, dz = c[0] - tx, c[1] - tz
        dist = math.hypot(dx, dz)
        if 1.5 < dist < 2.6 and (n[0] * dx + n[1] * dz) / dist > 0.6:
            a0 = math.atan2(dx, dz)
            out = []
            for p in pts:
                a = math.atan2(p[0] - tx, p[1] - tz)
                while a - a0 > math.pi:
                    a -= math.tau
                while a - a0 < -math.pi:
                    a += math.tau
                out.append((a / math.tau * 6, local(p)[2] / tile))
            return out
    nl = (n[0] * EX[0] + n[1] * EX[1], n[0] * EY[0] + n[1] * EY[1])
    if abs(nl[0]) > abs(nl[1]):
        return [(local(p)[1] / tile, local(p)[2] / tile) for p in pts]
    return [(local(p)[0] / tile, local(p)[2] / tile) for p in pts]


def roof_uv(pts, tile=1.6):
    c = G.centroid(pts)
    for tx, tz in TOWER_PLAN:
        if math.hypot(c[0] - tx, c[1] - tz) < 2.5:
            a0 = math.atan2(c[0] - tx, c[1] - tz)
            out = []
            for p in pts:
                a = math.atan2(p[0] - tx, p[1] - tz)
                while a - a0 > math.pi:
                    a -= math.tau
                while a - a0 < -math.pi:
                    a += math.tau
                r = math.hypot(p[0] - tx, p[1] - tz)
                slant = math.hypot(r, FLOOR + 18.3 - p[2])
                out.append((a / math.tau * 10, slant / tile))
            return out
    n = _n(pts)
    t = (-n[1], n[0], 0.0)
    L = math.hypot(t[0], t[1]) or 1.0
    t = (t[0] / L, t[1] / L, 0.0)
    s = (n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0])
    return [((p[0] * t[0] + p[1] * t[1]) / tile, (p[0] * s[0] + p[1] * s[1] + p[2] * s[2]) / tile) for p in pts]


def main():
    t0 = time.time()
    report = {"lods": {}, "budget": BUDGET, "layout": {"bearing": BEARING, "front": FRONT, "w": W, "d": D, "top": TOP, "floor": FLOOR}}
    log = []
    for lod in ("lite", "hq"):
        vp3_kit.reset()
        mats = {k: G.simple_mat(f"VP3_knight_{k}", (1, 1, 1)) for k in ("stone", "roof", "gold", "props")}
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
        per = {k: mb.tris() for k, mb in mbs.items()}
        path = os.path.join(OUT, f"knight_{lod}.glb")
        vp3_kit.export_glb(list(objs.values()), path)
        tris = sum(per.values())
        L = [local(v) for mb in mbs.values() for v in mb.v]
        bounds = {"x": [round(min(p[0] for p in L), 3), round(max(p[0] for p in L), 3)], "y": [round(min(p[1] for p in L), 3), round(max(p[1] for p in L), 3)], "h": [round(min(p[2] for p in L), 3), round(max(p[2] for p in L), 3)]}
        report["lods"][lod] = {"triangles": tris, "by_mesh": per, "meshes": len(objs), "ao_baked": ok, "bytes": os.path.getsize(path), "within_budget": tris <= BUDGET[lod], "bounds_local": bounds}
    door = F(0, 2.97, 2.0)
    report["layout"]["door"] = [round(door[0], 3), round(door[1], 3)]
    report["log"] = log
    report["seconds"] = round(time.time() - t0, 1)
    with open(os.path.join(OUT, "knight_report.json"), "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1))
    if not all(v["within_budget"] for v in report["lods"].values()):
        raise SystemExit("三角面超出預算")


main()
