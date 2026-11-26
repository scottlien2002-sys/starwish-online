"""P3-10 祭司教堂「星願聖堂」（HQ / Lite）。

blender -b --factory-startup -P build_church.py -- --out <輸出資料夾>

- V1.3：方位 66°、正面 r 24、寬 12 × 深 18、簷高 9、最高 18 m（地面）；全部網格在原碰撞箱內，不新增碰撞
- 祭司 NPC 站位不變（正門前 2.5 m、碰撞箱外）
- 造型：暖白石材；正面鐘樓（拱形大門、星形玫瑰窗、鐘室、尖塔＋金色星願十字星）、中殿（高窗＋彩繪玻璃）、
  兩側低矮側廊、扶壁、半圓後殿；天空藍魚鱗瓦＋金屋脊；彩繪玻璃與塔頂星辰為柔和自發光（不用動態光、不用全畫面光暈）
- 識別：祭司＝白、金、天空藍＋星願聖徽
"""
import math
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
args = dict(zip(argv[::2], argv[1::2]))
OUT = os.path.abspath(args.get("--out", "out"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vp3_arch as A  # noqa: E402
import vp3_geo as G  # noqa: E402

BEARING, FRONT, W, D, EAVE, TOP, FLOOR = 66.0, 24.0, 12.0, 18.0, 9.0, 18.0, 0.0
OX, OZ = G.pol(BEARING, FRONT)
F, local, EX, EY = A.local_fn(OX, OZ, BEARING, FLOOR)
BUDGET = {"hq": 26000, "lite": 11000}
C = {
    "roof": (0.56, 0.7, 0.88), "roof_d": (0.42, 0.54, 0.7),
    "door": (0.55, 0.38, 0.24), "glass_b": (0.4, 0.62, 1.0), "glass_v": (0.72, 0.52, 1.0), "glass_g": (1.0, 0.84, 0.45),
    "glass_r": (1.0, 0.58, 0.62), "glass_t": (0.5, 0.92, 0.85), "bell": (0.86, 0.68, 0.32), "halo": (1.0, 0.93, 0.7),
}
GLASS = [C["glass_b"], C["glass_v"], C["glass_g"], C["glass_t"], C["glass_r"]]
# 主要量體（區域座標：x 左右、y 往內、h 高）
TX = 2.7            # 鐘樓半寬
TY0, TY1 = 0.6, 5.6  # 鐘樓前後
NX = 4.2            # 中殿半寬
NY0, NY1 = 4.6, 14.8
AX = 5.68            # 側廊外牆
APSE_R = 3.9        # 後殿半徑（中心 y = NY1）


def stained(glow, Fr, w, h0, hgt, seed, hq, y=-0.06):
    """彩繪玻璃（尖拱窗）：直條色塊＋上方小圓窗；朝 −y"""
    seg = 6 if hq else 3
    hs = h0 + hgt - w / 2
    cols = 3 if hq else 1
    for i in range(cols):
        xa = -w / 2 + w * i / cols
        xb = -w / 2 + w * (i + 1) / cols
        c = GLASS[(seed + i) % len(GLASS)]
        A.vpoly(glow, Fr, [(xa, h0), (xb, h0), (xb, hs), (xa, hs)], y, c, -1)
    top = [(-w / 2, hs)] + [(math.cos(math.pi * (1 - k / seg)) * w / 2, hs + math.sin(math.pi * k / seg) * w * 0.62) for k in range(1, seg)] + [(w / 2, hs)]
    A.vpoly(glow, Fr, top, y, GLASS[(seed + 2) % len(GLASS)], -1)


def lancet(stone, glow, gm, gcol, Fr, w, h0, hgt, seed, hq):
    """石框尖拱窗＋彩繪玻璃＋金色窗櫺"""
    seg = 6 if hq else 3
    hs = h0 + hgt - w / 2
    out = [(-w / 2 - 0.16, h0 - 0.14), (w / 2 + 0.16, h0 - 0.14)] + [(math.cos(math.pi * k / seg) * (w / 2 + 0.16), hs + math.sin(math.pi * k / seg) * (w * 0.62 + 0.2)) for k in range(seg + 1)]
    A.vextrude(stone, Fr, out, -0.03, 0.12, A.TRIM)
    stained(glow, Fr, w, h0, hgt, seed, hq)
    if hq:
        G.box(gm, Fr, -0.02, 0.02, -0.08, -0.065, h0, hs + w * 0.5, gcol)
        G.box(gm, Fr, -w / 2, w / 2, -0.08, -0.065, h0 + hgt * 0.45, h0 + hgt * 0.45 + 0.04, gcol)
    G.box(stone, Fr, -w / 2 - 0.22, w / 2 + 0.22, -0.2, 0.0, h0 - 0.26, h0 - 0.12, A.TRIM)


def side_frame(x, y, sx, h0=FLOOR):
    """側牆上 (x, y) 處、朝外（sx=±1）的框架：局部 −y＝朝外"""
    p = F(x, y, 0)
    return G.frame(p[0], p[1], BEARING + 90 * sx + 180, h0)


def build(lod):
    hq = lod == "hq"
    stone, roof, gold, props, glow = (G.MB(f"Church_{k}", lin) for k, lin in (("stone", True), ("roof", True), ("gold", False), ("props", False), ("glow", False)))
    gm, gcol = (gold, (1, 1, 1)) if hq else (props, A.GOLD_VC)
    seg_r = 16 if hq else 8
    # ---- 基座（整棟）----
    G.box(stone, F, -AX - 0.05, AX + 0.05, 0.05, NY1 + 0.1, 0.0, 0.35, A.PLINTH)
    # 正門前平台（高 0.18，可直接走上；碰撞箱內）
    G.box(stone, F, -TX - 0.4, TX + 0.4, 0.02, TY0 + 0.1, 0.0, 0.18, A.PLINTH)
    # ---- 中殿 ----
    G.box(stone, F, -NX, NX, NY0, NY1, 0.35, EAVE, A.WALL)
    G.box(stone, F, -NX - 0.1, NX + 0.1, NY0, NY1, EAVE - 0.3, EAVE, A.TRIM)
    A.gable_roof(roof, F, -NX - 0.35, NX + 0.35, NY0 - 0.1, NY1 + 0.05, EAVE - 0.15, 14.2, C["roof"], C["roof_d"], ridge_along="y", thick=0.2)
    G.tube(gm, [F(0, NY0, 14.24), F(0, NY1, 14.24)], 0.06, 6 if hq else 3, gcol)
    # 中殿高窗（側廊屋頂上方）
    for sx in (-1, 1):
        for i, y in enumerate((6.3, 8.4, 10.5, 12.6)):
            lancet(stone, glow, gm, gcol, side_frame(sx * NX, y, sx), 0.8, 6.0, 2.2, i + (sx > 0) * 2, hq)
    # ---- 側廊（低矮、單坡屋頂）----
    for sx in (-1, 1):
        xa, xb = sorted((sx * NX, sx * AX))
        G.box(stone, F, xa, xb, NY0 + 0.4, NY1 - 0.4, 0.35, 4.6, A.WALL2)
        # 單坡屋頂：外緣 4.4 → 內緣 5.8
        xo = sx * (AX + 0.08)
        for y0, y1 in ((NY0 + 0.2, NY1 - 0.2),):
            top = [F(xo, y0, 4.4), F(sx * NX, y0, 5.8), F(sx * NX, y1, 5.8), F(xo, y1, 4.4)]
            roof.face([roof.vert(p, C["roof"]) for p in top], G.sub(F(sx * 0.4, 0, 1), F(0, 0, 0)))
            bot = [F(xo, y0, 4.25), F(sx * NX, y0, 5.65), F(sx * NX, y1, 5.65), F(xo, y1, 4.25)]
            roof.face([roof.vert(p, C["roof_d"]) for p in bot], G.sub(F(0, 0, -1), F(0, 0, 0)))
            for yy, fy in ((y0, -1), (y1, 1)):
                cap = [F(xo, yy, 4.25), F(sx * NX, yy, 5.65), F(sx * NX, yy, 5.8), F(xo, yy, 4.4)]
                roof.face([roof.vert(p, C["roof_d"]) for p in cap], G.sub(F(0, fy, 0), F(0, 0, 0)))
        # 側廊窗＋扶壁
        for i, y in enumerate((6.3, 8.4, 10.5, 12.6)):
            lancet(stone, glow, gm, gcol, side_frame(sx * AX, y, sx), 0.9, 1.3, 2.4, i + 1, hq)
        for y in (5.3, 7.35, 9.45, 11.55, 13.7):
            fr = side_frame(sx * AX, y, sx)
            G.box(stone, fr, -0.24, 0.24, -0.05, 0.0, 0.35, 3.3, A.TRIM)
            A.vextrude(stone, fr, [(-0.24, 3.3), (0.24, 3.3), (0.0, 4.1)], -0.05, 0.25, A.TRIM)
    # ---- 後殿（半圓、圓錐屋頂）----
    pc = F(0, NY1, 0)
    pts = []
    for k in range(seg_r + 1):
        a = math.pi * k / seg_r  # 0..π：右→左（往內半圓）
        pts.append((math.cos(a) * APSE_R, NY1 + math.sin(a) * min(APSE_R, D - NY1 - 0.5)))
    for k in range(seg_r):
        (x1, y1), (x2, y2) = pts[k], pts[k + 1]
        q = [F(x1, y1, 0.35), F(x2, y2, 0.35), F(x2, y2, 7.2), F(x1, y1, 7.2)]
        stone.face([stone.vert(p, A.WALL) for p in q], G.sub(F((x1 + x2) / 2, (y1 + y2) / 2 - NY1, 0), F(0, 0, 0)))
        tq = [F(x1 * 1.08, NY1 + (y1 - NY1) * 1.04, 7.1), F(x2 * 1.08, NY1 + (y2 - NY1) * 1.04, 7.1), F(0, NY1, 11.0)]
        roof.face([roof.vert(p, C["roof"]) for p in tq], G.sub(F((x1 + x2) / 2, (y1 + y2) / 2 - NY1, 2.0), F(0, 0, 0)))
    for k in (1, seg_r // 2, seg_r - 1) if hq else (seg_r // 2,):
        a = math.pi * (k + 0.5) / seg_r
        x, y = math.cos(a) * APSE_R * 1.003, NY1 + math.sin(a) * min(APSE_R, D - NY1 - 0.5) * 1.003
        p = F(x, y, 0)
        lancet(stone, glow, gm, gcol, _outward_frame(p, x, y - NY1), 0.7, 2.2, 2.6, k, hq)
    # ---- 鐘樓（正面）----
    G.box(stone, F, -TX, TX, TY0, TY1, 0.18, 13.0, A.WALL)
    for sx in (-1, 1):  # 轉角隅石
        h = 0.4
        k = 0
        while h < 12.6:
            lx = 0.55 if k % 2 == 0 else 0.32
            xa, xb = sorted((sx * TX, sx * (TX - lx)))
            G.box(stone, F, xa - (0.04 if sx < 0 else 0), xb + (0.04 if sx > 0 else 0), TY0 - 0.05, TY0 + 0.3, h, h + 0.44, A.TRIM)
            h += 0.52 if hq else 1.04
            k += 1
    for h in (4.9, 9.6):  # 腰線
        G.box(stone, F, -TX - 0.12, TX + 0.12, TY0 - 0.12, TY1 + 0.02, h, h + 0.22, A.TRIM)
        G.box(gm, F, -TX - 0.13, TX + 0.13, TY0 - 0.13, TY0 - 0.12, h + 0.08, h + 0.12, gcol)
    # 大門：拱形石框（雙層退縮）＋木門＋金色鉸鏈＋門上半圓聖徽
    Ff = F
    A.vextrude(stone, Ff, A.arch_outline(3.1, 0.18, 2.6, 10 if hq else 5), TY0 - 0.14, 0.14, A.TRIM)
    A.vextrude(stone, Ff, A.arch_outline(2.6, 0.18, 2.55, 10 if hq else 5), TY0 - 0.16, 0.02, A.WALL2)
    A.vpoly(props, Ff, A.arch_outline(2.1, 0.18, 2.5, 10 if hq else 5), TY0 - 0.18, C["door"], -1)
    A.vpoly(glow, Ff, [(math.cos(math.pi * k / 8) * 0.95, 2.55 + math.sin(math.pi * k / 8) * 0.95) for k in range(9)], TY0 - 0.19, C["glass_g"], -1)
    G.box(props, F, -0.03, 0.03, TY0 - 0.21, TY0 - 0.18, 0.18, 2.5, (0.35, 0.22, 0.13))
    for h in (0.8, 1.9):
        for xa, xb in ((-0.95, -0.25), (0.25, 0.95)):
            G.box(gm, F, xa, xb, TY0 - 0.22, TY0 - 0.2, h, h + 0.07, gcol)
    # 星形玫瑰窗（鐘樓正面中段）
    rc = 7.3
    A.vextrude(stone, F, A.circle(0, rc, 1.45, 20 if hq else 10), TY0 - 0.12, 0.12, A.TRIM)
    for i in range(8):
        a0 = i * math.tau / 8
        a1 = (i + 1) * math.tau / 8
        A.vpoly(glow, F, [(0, rc), (math.sin(a0) * 1.25, rc + math.cos(a0) * 1.25), (math.sin((a0 + a1) / 2) * 1.3, rc + math.cos((a0 + a1) / 2) * 1.3), (math.sin(a1) * 1.25, rc + math.cos(a1) * 1.25)], TY0 - 0.14, GLASS[i % 4], -1)
    A.vpoly(gm, F, A.star_outline(0, rc, 8, 0.75, 0.3), TY0 - 0.16, gcol, -1)
    A.vpoly(glow, F, A.circle(0, rc, 0.22, 10), TY0 - 0.17, C["halo"], -1)
    # 鐘室（四面拱窗＋金鐘）
    for side in range(4):
        b = BEARING + 90 * side
        if side == 0:
            fr = G.frame(*F(0, TY0 - 0.01, 0)[:2], BEARING, FLOOR)
        elif side == 2:
            fr = G.frame(*F(0, TY1 + 0.01, 0)[:2], BEARING + 180, FLOOR)
        else:
            sx = 1 if side == 1 else -1
            fr = side_frame(sx * TX, (TY0 + TY1) / 2, sx)
        A.vextrude(stone, fr, A.arch_outline(1.6, 10.3, 11.6, 8 if hq else 4), -0.02, 0.1, A.TRIM)
        A.vpoly(props, fr, A.arch_outline(1.3, 10.35, 11.55, 8 if hq else 4), -0.03, (0.2, 0.22, 0.32), -1)
    bc = F(0, (TY0 + TY1) / 2, 0)
    G.lathe(gm, bc[0], bc[1], 0.0, [(0.0, 11.75), (0.24, 11.7), (0.36, 11.2), (0.5, 10.55), (0.55, 10.45), (0.0, 10.45)], 12 if hq else 6, C["bell"] if not hq else gcol)
    # 塔頂：欄杆＋小角塔＋八角尖塔＋金色星願十字星＋光暈
    G.box(stone, F, -TX - 0.18, TX + 0.18, TY0 - 0.18, TY1 + 0.18, 13.0, 13.35, A.TRIM)
    for sx in (-1, 1):
        for y in (TY0 + 0.15, TY1 - 0.15):
            p = F(sx * (TX - 0.15), y, 0)
            G.lathe(stone, p[0], p[1], 13.35, [(0.24, 0.0), (0.24, 0.6), (0.0, 1.5)], 6 if hq else 4, A.TRIM, smooth=False)
            G.blob(gm, (p[0], p[1], 14.9), 0.07, 0.07, 0.07, gcol)
    G.lathe(roof, bc[0], bc[1], 13.35, [(2.0, 0.0), (1.75, 0.35), (0.6, 2.9), (0.1, 3.8), (0.0, 3.85)], 8, C["roof"], smooth=False)
    G.lathe(gm, bc[0], bc[1], 13.3, [(2.4, 0.02), (2.42, 0.08), (2.4, 0.14)], 8, gcol)
    G.tube(gm, [(bc[0], bc[1], 17.2), (bc[0], bc[1], 17.45)], 0.035, 5, gcol)
    star = G.frame(bc[0], bc[1], BEARING, 0.0)
    for fy in (-1, 1):
        A.vpoly(gm, star, A.star_outline(0, 17.62, 4, 0.36, 0.1), 0.02 * fy, gcol, fy)
        A.vpoly(glow, star, A.circle(0, 17.62, 0.08, 8), 0.03 * fy, C["halo"], fy)
    star2 = G.frame(bc[0], bc[1], BEARING + 90, 0.0)
    for fy in (-1, 1):
        A.vpoly(gm, star2, A.star_outline(0, 17.62, 4, 0.36, 0.1), 0.02 * fy, gcol, fy)
    # 正面山牆（中殿前端，鐘樓兩側露出的三角）＋小尖塔
    A.gable_wall(stone, F, -NX, NX, NY0 - 0.01, EAVE, 13.9, A.WALL)
    for sx in (-1, 1):
        p = F(sx * (NX - 0.1), NY0 - 0.15, 0)
        G.lathe(stone, p[0], p[1], 0.35, [(0.32, 0.0), (0.32, 9.0), (0.2, 9.2), (0.2, 10.0), (0.0, 11.2)], 6 if hq else 4, A.TRIM, smooth=False)
        G.blob(gm, (p[0], p[1], 11.3), 0.08, 0.08, 0.08, gcol)
        p2 = F(sx * (AX - 0.15), NY0 + 0.25, 0)
        G.lathe(stone, p2[0], p2[1], 0.35, [(0.26, 0.0), (0.26, 4.8), (0.0, 5.9)], 6 if hq else 4, A.TRIM, smooth=False)
    # 側廊正面牆（鐘樓兩側）＋小窗
    for sx in (-1, 1):
        xa, xb = sorted((sx * TX, sx * AX))
        G.box(stone, F, xa, xb, NY0 - 0.2, NY0 + 0.4, 0.35, 4.6, A.WALL2)
        fr = G.frame(*F(sx * (TX + AX) / 2, NY0 - 0.21, 0)[:2], BEARING, FLOOR)
        lancet(stone, glow, gm, gcol, fr, 0.8, 1.4, 2.0, 3 + sx, hq)
    # 正門兩側燭台燈（glow）＋祭司聖徽旗（藍底金星，掛在鐘樓兩側）
    for sx in (-1, 1):
        p = F(sx * 1.9, TY0 - 0.35, 0)
        G.lathe(stone, p[0], p[1], 0.18, [(0.18, 0.0), (0.12, 0.15), (0.07, 0.3), (0.07, 1.3), (0.16, 1.45), (0.0, 1.5)], 6 if hq else 4, A.TRIM, smooth=False)
        G.blob(glow, (p[0], p[1], 1.78), 0.12, 0.12, 0.2, C["halo"])
        G.lathe(gm, p[0], p[1], 0.18, [(0.17, 1.3), (0.18, 1.38), (0.17, 1.45)], 6, gcol)
        fb = G.frame(*F(sx * (TX + 0.02), TY0 + 1.2, 0)[:2], BEARING + 90 * sx + 180, FLOOR)
        G.box(gm, fb, -0.55, 0.55, -0.12, -0.06, 8.75, 8.8, gcol)
        A.vpoly(props, fb, [(-0.48, 8.75), (0.48, 8.75), (0.48, 6.2), (0.0, 5.75), (-0.48, 6.2)], -0.13, (0.24, 0.36, 0.7), -1)
        A.vpoly(gm, fb, A.star_outline(0, 7.5, 4, 0.32, 0.1), -0.135, gcol, -1)
        A.vpoly(gm, fb, [(-0.48, 6.2), (0.0, 5.75), (0.48, 6.2), (0.48, 6.28), (0.0, 5.84), (-0.48, 6.28)], -0.136, gcol, -1)
    return {k: v for k, v in (("stone", stone), ("roof", roof), ("gold", gold), ("props", props), ("glow", glow)) if v.f}


def _outward_frame(p, lx, ly):
    """後殿弧面：局部 −y 朝外（lx, ly 為相對後殿中心的區域方向）"""
    ang = math.degrees(math.atan2(lx, ly))  # 相對區域 +y 的角度（往 +x 為正）
    return G.frame(p[0], p[1], BEARING + ang + 180, FLOOR)


def extra(mbs):
    out_pts = sum(1 for mb in mbs.values() for v in mb.v if not (lambda q: -W / 2 - 0.01 <= q[0] <= W / 2 + 0.01 and -0.01 <= q[1] <= D + 0.01 and -0.01 <= q[2] <= TOP + 0.01)(local(v)))
    return {"outside_colliders": out_pts, "bounds_local": A.bounds(mbs, local)}


def main():
    door = F(0, TY0 - 0.2, 0.18)
    A.export_lods("church", build, BUDGET, OUT, {"stone": A.box_uv(local, EX, EY), "roof": A.slope_uv()},
                  {"bearing": BEARING, "front": FRONT, "w": W, "d": D, "eave": EAVE, "top": TOP, "floor": FLOOR, "door": [round(door[0], 3), round(door[1], 3)]}, extra=extra)


if __name__ == "__main__":
    main()
