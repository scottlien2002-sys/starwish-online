"""P3-13 星願商會（道具店＋玩家交易所）（HQ / Lite）。

blender -b --factory-startup -P build_guild.py -- --out <輸出資料夾>

- 第三批追加：方位 160°、正面 r 27、寬 10 × 深 8、最高 10 m（地面）；全部網格在新碰撞箱內
- 商會掌櫃 NPC：正門前 2 m、往南路側偏 3.5 m（layout.ts），正門就開在掌櫃旁邊
- 造型：暖白石材兩層樓＋深藍魚鱗瓦雙坡屋頂（金屋脊、星形尖飾）、正面山牆（金色星徽＋圓窗）、
  左前圓角塔樓（深藍圓錐頂＋金星）、拱形木門、大型展示櫥窗（架上藥水瓶自發光）、藍白條紋遮陽篷、
  金色天秤吊牌、商會旗、門前木箱／藥水箱／麻袋（都在碰撞箱內）
- 識別：深藍屋頂＋金色天秤＋發光藥水
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

BEARING, FRONT, W, D, EAVE, TOP, FLOOR = 160.0, 27.0, 10.0, 8.0, 5.5, 10.0, 0.0
OX, OZ = G.pol(BEARING, FRONT)
F, local, EX, EY = A.local_fn(OX, OZ, BEARING, FLOOR)
BUDGET = {"hq": 15000, "lite": 6500}
C = {
    "roof": (0.3, 0.4, 0.68), "roof_d": (0.22, 0.29, 0.5), "door": (0.48, 0.3, 0.18), "frame": (0.38, 0.25, 0.15),
    "glass": (0.22, 0.32, 0.52), "shelf": (0.5, 0.34, 0.2), "awn_a": (0.26, 0.38, 0.72), "awn_b": (0.97, 0.94, 0.86),
    "banner": (0.24, 0.34, 0.68), "sack": (0.86, 0.78, 0.6), "crate": (0.68, 0.5, 0.3),
    "pot": [(0.95, 0.35, 0.4), (0.35, 0.7, 1.0), (0.45, 0.9, 0.55), (0.85, 0.55, 1.0), (1.0, 0.82, 0.35)],
}
X0, X1, Y0, Y1 = -2.95, 4.6, 0.9, 7.55  # 主體牆（前方 0.9 m 是門廊與貨物）；左側讓出給圓塔（L 形，避免塔與主屋頂穿模）
DOOR_X = 2.55
TOWER = (-3.88, 4.2, 0.9)  # 左側獨立圓塔（x, y, 半徑）：整座在主屋頂外側，只貼著左山牆
ROOF_L = 0.05  # 左山牆屋簷外伸（右側仍 0.3）；塔外緣 x = -3.0，不會碰到屋頂


def build(lod):
    hq = lod == "hq"
    stone, roof, gold, props, glow = (G.MB(f"Guild_{k}", lin) for k, lin in (("stone", True), ("roof", True), ("gold", False), ("props", False), ("glow", False)))
    gm, gcol = (gold, (1, 1, 1)) if hq else (props, A.GOLD_VC)
    seg = 12 if hq else 6
    # ---- 基座、門廊石板、主體牆（兩層，中間腰線）----
    G.box(stone, F, -4.95, 4.95, 0.05, Y0, 0.0, 0.25, A.PLINTH)  # 門廊石板（含塔前貨物區）
    G.box(stone, F, X0 - 0.35, 4.95, Y0, 7.95, 0.0, 0.25, A.PLINTH)
    G.box(stone, F, X0, X1, Y0, Y1, 0.25, EAVE, A.WALL)
    G.box(stone, F, X0 - 0.08, X1 + 0.08, Y0 - 0.08, Y1 + 0.08, 0.25, 0.7, A.PLINTH)
    G.box(stone, F, X0 - 0.12, X1 + 0.12, Y0 - 0.12, Y1 + 0.12, 2.95, 3.12, A.TRIM)
    G.box(gm, F, X0 - 0.13, X1 + 0.13, Y0 - 0.13, Y0 - 0.12, 3.0, 3.06, gcol)
    G.box(stone, F, X0 - 0.15, X1 + 0.15, Y0 - 0.15, Y1 + 0.15, EAVE - 0.22, EAVE, A.TRIM)
    for sx in (-1, 1):  # 轉角隅石
        h = 0.7
        k = 0
        while h < EAVE - 0.3:
            lx = 0.5 if k % 2 == 0 else 0.3
            xe = X1 if sx > 0 else -X0
            xa, xb = sorted((sx * xe, sx * (xe - lx)))
            G.box(stone, F, xa - (0.04 if sx < 0 else 0), xb + (0.04 if sx > 0 else 0), Y0 - 0.05, Y0 + 0.28, h, h + 0.4, A.TRIM)
            h += 0.46 if hq else 0.92
            k += 1
    # ---- 屋頂（屋脊沿 x）＋正面山牆 ----
    A.gable_roof(roof, F, X0 - ROOF_L, X1 + 0.3, Y0 - 0.3, Y1 + 0.25, EAVE - 0.15, 8.6, C["roof"], C["roof_d"], ridge_along="x", thick=0.16)
    for sx in (-1, 1):
        x = X1 if sx > 0 else X0
        tri = [stone.vert(F(x, Y0, EAVE), A.WALL), stone.vert(F(x, Y1, EAVE), A.WALL), stone.vert(F(x, (Y0 + Y1) / 2, 8.45), A.WALL)]
        stone.face(tri, G.sub(F(sx, 0, 0), F(0, 0, 0)))
    G.tube(gm, [F(X0 - ROOF_L, (Y0 + Y1) / 2, 8.63), F(X1 + 0.3, (Y0 + Y1) / 2, 8.63)], 0.05, 5 if hq else 3, gcol)
    for sx in (-1, 1):
        fr = G.frame(*F((X1 + 0.05) if sx > 0 else (X0 - ROOF_L - 0.02), (Y0 + Y1) / 2, 0)[:2], BEARING, FLOOR)
        for fy in (-1, 1):
            A.vpoly(gm, fr, A.star_outline(0, 8.95, 4, 0.26, 0.08), 0.01 * fy, gcol, fy)
    # 正面交叉山牆（中央偏左，屋脊沿 y）＋金色星徽圓窗
    gx0, gx1 = -2.4, 0.9
    gxm = (gx0 + gx1) / 2
    G.box(stone, F, gx0, gx1, Y0 - 0.25, Y0 + 2.2, EAVE - 0.2, EAVE + 0.4, A.WALL)
    A.gable_wall(stone, F, gx0, gx1, Y0 - 0.26, EAVE + 0.4, 8.1, A.WALL)
    A.gable_roof(roof, F, gx0 - 0.3, gx1 + 0.3, Y0 - 0.55, Y0 + 2.6, EAVE + 0.25, 8.35, C["roof"], C["roof_d"], ridge_along="y", thick=0.12)
    A.vextrude(stone, F, A.circle(gxm, 6.75, 0.62, 16 if hq else 8), Y0 - 0.38, 0.1, A.TRIM)
    A.vpoly(glow, F, A.circle(gxm, 6.75, 0.5, 16 if hq else 8), Y0 - 0.39, (0.55, 0.7, 1.0), -1)
    A.vpoly(gm, F, A.star_outline(gxm, 6.75, 8, 0.44, 0.17), Y0 - 0.4, gcol, -1)
    # ---- 左後圓塔（圓角塔樓＋圓錐頂＋金星）----
    tx, ty, tr = TOWER
    tc = F(tx, ty, 0)
    G.lathe(stone, tc[0], tc[1], 0.0, [(tr + 0.1, 0.0), (tr + 0.1, 0.5), (tr, 0.6), (tr, 7.0), (tr + 0.18, 7.15), (tr + 0.18, 7.35), (0.0, 7.35)], seg + 4, A.WALL, smooth=False)
    G.lathe(roof, tc[0], tc[1], 7.35, [(tr + 0.2, 0.0), (tr * 0.55, 1.1), (0.0, 2.25)], seg + 4, C["roof"], smooth=False)
    G.lathe(gm, tc[0], tc[1], 7.3, [(tr + 0.19, 0.0), (tr + 0.21, 0.05), (tr + 0.19, 0.1)], seg + 4, gcol)
    fs = G.frame(tc[0], tc[1], BEARING, 0.0)
    G.tube(gm, [(tc[0], tc[1], 9.55), (tc[0], tc[1], 9.68)], 0.025, 4, gcol)
    for fy in (-1, 1):
        A.vpoly(gm, fs, A.star_outline(0, 9.82, 4, 0.18, 0.06), 0.01 * fy, gcol, fy)
    for a in ((-150, 6.0), (-210, 6.0), (-90, 6.0)) if hq else ((-180, 6.0),):
        ang = math.radians(a[0])
        wx, wy = tx + math.sin(ang) * tr, ty + math.cos(ang) * tr
        p = F(wx, wy, 0)
        fr = G.frame(p[0], p[1], BEARING + a[0] + 180, FLOOR)
        A.window_box(stone, glow, gm, gcol, fr, 0.45, 5.0, 0.8, glass=(0.95, 0.85, 0.55), arch=True, hq=hq)
    # ---- 一樓：大型展示櫥窗（藥水架）＋拱形門 ----
    yf = Y0 - 0.02
    wx0, wx1 = -2.65, -0.35
    A.vextrude(stone, F, [(wx0 - 0.18, 0.62), (wx1 + 0.18, 0.62), (wx1 + 0.18, 2.75), (wx0 - 0.18, 2.75)], yf - 0.04, 0.12, A.TRIM)
    A.vpoly(props, F, [(wx0, 0.75), (wx1, 0.75), (wx1, 2.6), (wx0, 2.6)], yf - 0.07, C["glass"], -1)
    for h in (1.05, 1.65, 2.2):  # 三層木架＋藥水瓶（自發光）
        G.box(props, F, wx0 + 0.05, wx1 - 0.05, yf - 0.1, yf - 0.08, h - 0.04, h, C["shelf"])
        n = 9 if hq else 5
        for i in range(n):
            x = wx0 + 0.2 + (wx1 - wx0 - 0.4) * i / (n - 1)
            c = C["pot"][(i + int(h * 10)) % len(C["pot"])]
            p = F(x, yf - 0.12, 0)
            G.lathe(glow, p[0], p[1], h, [(0.0, 0.0), (0.07, 0.01), (0.08, 0.1), (0.035, 0.18), (0.035, 0.24), (0.0, 0.25)], 6 if hq else 4, c)
    if hq:
        for x in (-1.88, -1.12):
            G.box(gm, F, x - 0.02, x + 0.02, yf - 0.13, yf - 0.11, 0.75, 2.6, gcol)
    A.vextrude(stone, F, A.arch_outline(2.1, 0.25, 2.25, 8 if hq else 4, cx=DOOR_X), yf - 0.1, 0.12, A.TRIM)
    A.vpoly(props, F, A.arch_outline(1.6, 0.25, 2.2, 8 if hq else 4, cx=DOOR_X), yf - 0.12, C["door"], -1)
    G.box(props, F, DOOR_X - 0.03, DOOR_X + 0.03, yf - 0.15, yf - 0.12, 0.25, 2.95, C["frame"])
    for h in (0.8, 1.9):
        for xa, xb in ((DOOR_X - 0.75, DOOR_X - 0.15), (DOOR_X + 0.15, DOOR_X + 0.75)):
            G.box(gm, F, xa, xb, yf - 0.16, yf - 0.14, h, h + 0.06, gcol)
    A.vpoly(glow, F, [(DOOR_X + math.cos(math.pi * k / 8) * 0.7, 2.25 + math.sin(math.pi * k / 8) * 0.7) for k in range(9)], yf - 0.13, (1.0, 0.86, 0.5), -1)
    # ---- 藍白條紋遮陽篷（櫥窗上方）----
    nst = 8 if hq else 4
    for i in range(nst):
        xa = wx0 - 0.2 + (wx1 - wx0 + 0.4) * i / nst
        xb = wx0 - 0.2 + (wx1 - wx0 + 0.4) * (i + 1) / nst
        col = C["awn_a"] if i % 2 == 0 else C["awn_b"]
        q = [props.vert(F(xa, yf, 2.95), col), props.vert(F(xb, yf, 2.95), col), props.vert(F(xb, yf - 0.85, 2.55), col), props.vert(F(xa, yf - 0.85, 2.55), col)]
        props.face(q, G.sub(F(0, -0.4, 1), F(0, 0, 0)))
        q2 = [props.vert(F(xa, yf - 0.85, 2.55), col), props.vert(F(xb, yf - 0.85, 2.55), col), props.vert(F(xb, yf - 0.85, 2.35), col), props.vert(F(xa, yf - 0.85, 2.35), col)]
        props.face(q2, G.sub(F(0, -1, 0), F(0, 0, 0)))
    # ---- 二樓窗（三扇，木窗板）＋商會旗 ----
    for x in (1.8, 3.6) if hq else (2.7,):
        fr = G.frame(*F(x, Y0 - 0.01, 0)[:2], BEARING, FLOOR)
        A.window_box(stone, props, gm, gcol, fr, 0.75, 3.6, 1.15, glass=C["glass"], arch=True, shutters=(props, C["frame"]) if hq else None, hq=hq)
    for x in (-0.15,):
        fb = G.frame(*F(x, Y0 - 0.02, 0)[:2], BEARING, FLOOR)
        G.box(gm, fb, -0.5, 0.5, -0.08, -0.03, 5.1, 5.15, gcol)
        A.vpoly(props, fb, [(-0.42, 5.1), (0.42, 5.1), (0.42, 3.4), (0.0, 3.1), (-0.42, 3.4)], -0.09, C["banner"], -1)
        A.vpoly(gm, fb, [(-0.22, 4.1), (0.22, 4.1), (0.0, 4.55)], -0.095, gcol, -1)
        A.vpoly(gm, fb, A.circle(0, 3.9, 0.12, 8), -0.095, gcol, -1)
    # ---- 金色天秤吊牌（門右上方，鐵臂伸出）----
    G.box(props, F, DOOR_X + 1.0, DOOR_X + 1.08, Y0 - 0.55, Y0, 3.4, 3.46, A.IRON)
    sp = F(DOOR_X + 1.04, Y0 - 0.45, 0)
    Fs = G.frame(sp[0], sp[1], BEARING + 90, 0.0)
    A.vextrude(props, Fs, [(-0.36, 2.65), (0.36, 2.65), (0.36, 3.3), (-0.36, 3.3)], -0.03, 0.06, C["banner"])
    for fy in (-1, 1):
        y = 0.035 * fy
        A.vpoly(gm, Fs, [(-0.02, 2.78), (0.02, 2.78), (0.02, 3.18), (-0.02, 3.18)], y, gcol, fy)
        A.vpoly(gm, Fs, [(-0.26, 3.12), (0.26, 3.12), (0.26, 3.15), (-0.26, 3.15)], y, gcol, fy)
        for sx in (-1, 1):
            A.vpoly(gm, Fs, [(sx * 0.26 - 0.12, 2.86), (sx * 0.26 + 0.12, 2.86), (sx * 0.26, 2.95)], y, gcol, fy)
            A.vpoly(gm, Fs, [(sx * 0.26 - 0.005, 2.92), (sx * 0.26 + 0.005, 2.92), (sx * 0.26 + 0.005, 3.13), (sx * 0.26 - 0.005, 3.13)], y, gcol, fy)
        A.vpoly(gm, Fs, [(-0.1, 2.78), (0.1, 2.78), (0.0, 2.72)], y, gcol, fy)
    G.tube(props, [F(DOOR_X + 1.04, Y0 - 0.45, 3.4), F(DOOR_X + 1.04, Y0 - 0.45, 3.3)], 0.01, 3, A.IRON)
    # ---- 門前貨物：木箱、藥水箱、麻袋、木桶（y 0.1～0.85）----
    for x, y, h, s in ((-4.3, 0.55, 0.0, 0.62), (-3.62, 0.5, 0.0, 0.5), (-4.25, 0.55, 0.62, 0.45), (-4.35, 1.3, 0.0, 0.5)):
        G.box(props, F, x - s / 2, x + s / 2, y - s / 2 + 0.05, y + s / 2 - 0.05, h, h + s, C["crate"])
        if hq:
            G.box(props, F, x - s / 2 - 0.01, x + s / 2 + 0.01, y - s / 2 + 0.04, y + s / 2 - 0.04, h + s * 0.45, h + s * 0.55, C["frame"])
    # 藥水箱（開口木箱＋三瓶藥水）
    bx, by = -3.6, 1.4
    G.box(props, F, bx - 0.4, bx + 0.4, by - 0.3, by + 0.3, 0.0, 0.35, C["crate"])
    for i, dx in enumerate((-0.22, 0.0, 0.22)):
        p = F(bx + dx, by, 0)
        G.lathe(glow, p[0], p[1], 0.3, [(0.0, 0.0), (0.08, 0.01), (0.09, 0.12), (0.04, 0.2), (0.04, 0.27), (0.0, 0.28)], 6 if hq else 4, C["pot"][i + 1])
    for x, y, r in ((-1.6, 0.5, 0.28), (4.3, 0.5, 0.25)):
        p = F(x, y, 0)
        G.blob(props, (p[0], p[1], r * 0.8), r, r * 0.9, r * 0.8, C["sack"])
    # 側面與背面窗
    for y in (2.0, 3.0, 5.6, 6.6) if hq else (3.0, 6.6):
        for sx in (-1, 1):
            if sx < 0 and abs(y - TOWER[1]) < TOWER[2] + 0.5:
                continue  # 左側中段被圓塔佔用
            fr = G.frame(*F((X1 + 0.01) if sx > 0 else (X0 - 0.01), y, 0)[:2], BEARING + 90 * sx + 180, FLOOR)
            A.window_box(stone, props, gm, gcol, fr, 0.7, 1.2, 1.2, glass=C["glass"], arch=True, hq=hq)
    for x in (-1.0, 1.8):
        fr = G.frame(*F(x, Y1 + 0.01, 0)[:2], BEARING + 180, FLOOR)
        A.window_box(stone, props, gm, gcol, fr, 0.7, 3.6, 1.1, glass=C["glass"], arch=True, hq=hq)
    return {k: v for k, v in (("stone", stone), ("roof", roof), ("gold", gold), ("props", props), ("glow", glow)) if v.f}


def extra(mbs):
    out_pts = sum(1 for mb in mbs.values() for v in mb.v if not (lambda q: -W / 2 - 0.01 <= q[0] <= W / 2 + 0.01 and -0.01 <= q[1] <= D + 0.01 and -0.01 <= q[2] <= TOP + 0.01)(local(v)))
    return {"outside_colliders": out_pts, "bounds_local": A.bounds(mbs, local)}


def main():
    door = F(DOOR_X, Y0 - 0.2, 0.25)
    A.export_lods("guild", build, BUDGET, OUT, {"stone": A.box_uv(local, EX, EY), "roof": A.slope_uv()},
                  {"bearing": BEARING, "front": FRONT, "w": W, "d": D, "eave": EAVE, "top": TOP, "floor": FLOOR, "door": [round(door[0], 3), round(door[1], 3)]}, extra=extra)


if __name__ == "__main__":
    main()
