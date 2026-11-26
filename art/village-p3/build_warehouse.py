"""P3-9 倉庫（HQ / Lite）。

blender -b --factory-startup -P build_warehouse.py -- --out <輸出資料夾>

- V1.3：方位 208°、正面 r 24、寬 10 × 深 8、簷高 4.5、最高 7 m；全部網格在原碰撞箱內
- 造型：暖白石基座＋木板牆（深色木框）＋墨綠雙坡屋頂（屋脊垂直正面，前方山牆朝廣場）、
  大型雙開穀倉門（鐵條＋金色鑰匙徽章）、山牆吊貨橫樑與滑輪、二樓裝卸小門、側窗、門前木箱／麻袋／木桶
- 識別色：墨綠屋頂＋金鑰匙
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

BEARING, FRONT, W, D, EAVE, TOP, FLOOR = 208.0, 24.0, 10.0, 8.0, 4.5, 7.0, 0.0
OX, OZ = G.pol(BEARING, FRONT)
F, local, EX, EY = A.local_fn(OX, OZ, BEARING, FLOOR)
BUDGET = {"hq": 12000, "lite": 5000}
C = {
    "roof": (0.36, 0.56, 0.42), "roof_d": (0.26, 0.4, 0.31),
    "plank": (0.84, 0.66, 0.45), "plank2": (0.74, 0.56, 0.37), "frame": (0.46, 0.3, 0.18),
    "door": (0.52, 0.33, 0.2), "iron": A.IRON, "glass": (0.2, 0.3, 0.5),
    "sack": (0.86, 0.78, 0.6), "rope": (0.75, 0.62, 0.42), "crate": (0.68, 0.5, 0.3),
}
X0, X1, Y0, Y1 = -4.75, 4.75, 1.3, 7.75  # 主牆（前方留 1.3 m 給門廊貨物）


def build(lod):
    hq = lod == "hq"
    stone, roof, gold, props, glow = (G.MB(f"Ware_{k}", lin) for k, lin in (("stone", True), ("roof", True), ("gold", False), ("props", False), ("glow", False)))
    gm, gcol = (gold, (1, 1, 1)) if hq else (props, A.GOLD_VC)
    # ---- 石基座（高 0.9）＋木板牆 ----
    G.box(stone, F, X0 - 0.1, X1 + 0.1, Y0 - 0.1, Y1 + 0.1, 0.0, 0.3, A.PLINTH)
    G.box(stone, F, X0, X1, Y0, Y1, 0.3, 1.35, A.WALL2)
    G.box(stone, F, X0 - 0.05, X1 + 0.05, Y0 - 0.05, Y1 + 0.05, 1.35, 1.45, A.TRIM)
    G.box(props, F, X0 + 0.04, X1 - 0.04, Y0 + 0.04, Y1 - 0.04, 1.45, EAVE, C["plank"])
    # 木板縫（HQ：前後面每 0.45 m 一條深色細線；側面同）
    if hq:
        x = X0 + 0.45
        while x < X1 - 0.2:
            for y, fy in ((Y0 + 0.035, -1), (Y1 - 0.035, 1)):
                if fy < 0 and abs(x) < 1.75:
                    x += 0.45
                    continue
                A.vpoly(props, F, [(x - 0.015, 1.45), (x + 0.015, 1.45), (x + 0.015, EAVE), (x - 0.015, EAVE)], y, C["plank2"], fy)
            x += 0.45
    # 深色木框：轉角柱、腰梁、簷梁
    for x in (X0, X1):
        for y in (Y0, Y1):
            G.box(props, F, x - 0.14, x + 0.14, y - 0.14, y + 0.14, 1.45, EAVE, C["frame"])
    for y in (Y0 - 0.06, Y1 + 0.06):
        G.box(props, F, X0, X1, min(y, y + 0.08 * (1 if y > Y0 else -1)) - 0.02, max(y, y + 0.08 * (1 if y > Y0 else -1)) + 0.02, EAVE - 0.18, EAVE, C["frame"])
        G.box(props, F, X0, X1, min(y, y + 0.08 * (1 if y > Y0 else -1)) - 0.02, max(y, y + 0.08 * (1 if y > Y0 else -1)) + 0.02, 2.55, 2.7, C["frame"])
    for x in (X0 - 0.06, X1 + 0.06):
        G.box(props, F, min(x, x + 0.08 * (1 if x > 0 else -1)) - 0.02, max(x, x + 0.08 * (1 if x > 0 else -1)) + 0.02, Y0, Y1, EAVE - 0.18, EAVE, C["frame"])
    # ---- 屋頂（屋脊沿 y：前後為山牆）----
    A.gable_roof(roof, F, X0 - 0.24, X1 + 0.24, Y0 - 0.35, Y1 + 0.2, EAVE - 0.2, TOP - 0.15, C["roof"], C["roof_d"], ridge_along="y", thick=0.16)
    for y, fy in ((Y0, -1), (Y1, 1)):
        A.gable_wall(stone, F, X0, X1, y + 0.04 * (-fy), EAVE, TOP - 0.35, A.WALL, fy)
        if hq:  # 山牆斜邊木框
            A.plank(props, F, (X0, EAVE), (0.0, TOP - 0.35), 0.16, y - 0.1 * (fy < 0) , y + 0.1 * (fy > 0), C["frame"])
            A.plank(props, F, (X1, EAVE), (0.0, TOP - 0.35), 0.16, y - 0.1 * (fy < 0), y + 0.1 * (fy > 0), C["frame"])
    G.tube(gm, [F(0, Y0 - 0.35, TOP - 0.12), F(0, Y1 + 0.2, TOP - 0.12)], 0.05, 5 if hq else 3, gcol)
    # 屋脊兩端金色鑰匙形尖飾
    for y in (Y0 - 0.3, Y1 + 0.15):
        A.vpoly(gm, F, A.circle(0, TOP - 0.13, 0.1, 8), y, gcol, -1)
        A.vpoly(gm, F, A.circle(0, TOP - 0.13, 0.1, 8), y + 0.002, gcol, 1)
    # ---- 正面：雙開穀倉門＋鐵條＋金色鑰匙徽章 ----
    dw, dh = 3.2, 2.45
    yf = Y0 - 0.02
    G.box(props, F, -dw / 2 - 0.22, dw / 2 + 0.22, yf - 0.12, yf + 0.02, 0.3, dh + 0.22, C["frame"])
    for sx in (-1, 1):
        xa, xb = sorted((0.0, sx * dw / 2))
        A.vpoly(props, F, [(xa + 0.02, 0.32), (xb - 0.02, 0.32), (xb - 0.02, dh), (xa + 0.02, dh)], yf - 0.13, C["door"], -1)
        # Z 字斜撐
        A.plank(props, F, (xa + 0.12, 0.5), (xb - 0.12, dh - 0.2), 0.14, yf - 0.17, yf - 0.13, C["frame"])
        for h in (0.5, dh - 0.2):
            G.box(props, F, xa + 0.05, xb - 0.05, yf - 0.17, yf - 0.13, h - 0.07, h + 0.07, C["frame"])
        for h in (0.75, dh - 0.45):  # 鐵條鉸鏈
            G.box(props, F, xa + (0.05 if sx > 0 else dw / 2 - 0.65), xa + (0.65 if sx > 0 else dw / 2 - 0.05), yf - 0.19, yf - 0.17, h - 0.04, h + 0.04, C["iron"])
        G.blob(props, F(sx * 0.18, yf - 0.2, 1.25), 0.05, 0.05, 0.05, C["iron"])  # 門環
    # 門楣上的金色鑰匙徽章（盾形底＋鑰匙）
    Fk = G.frame(*F(0, yf - 0.13, 0)[:2], BEARING, FLOOR)
    shield = [(-0.45, 3.0), (0.45, 3.0), (0.45, 3.55), (0.0, 3.8), (-0.45, 3.55)]
    shield = [(x, h) for x, h in shield]
    A.vextrude(props, Fk, [(x, h - 0.2) for x, h in [(-0.42, 2.98), (0.42, 2.98), (0.42, 3.62), (0.0, 3.88), (-0.42, 3.62)]], -0.02, 0.06, C["roof_d"])
    key_ring = A.circle(0, 3.45, 0.13, 12 if hq else 8)
    A.vpoly(gm, Fk, key_ring, -0.03, gcol, -1)
    A.vpoly(props, Fk, A.circle(0, 3.45, 0.06, 8), -0.032, C["roof_d"], -1)
    A.vpoly(gm, Fk, [(-0.035, 3.33), (0.035, 3.33), (0.035, 2.98), (-0.035, 2.98)], -0.03, gcol, -1)
    A.vpoly(gm, Fk, [(0.035, 3.12), (0.13, 3.12), (0.13, 3.06), (0.035, 3.06)], -0.03, gcol, -1)
    A.vpoly(gm, Fk, [(0.035, 3.02), (0.11, 3.02), (0.11, 2.98), (0.035, 2.98)], -0.03, gcol, -1)
    # 二樓裝卸小門（山牆）＋吊貨橫樑＋滑輪＋繩
    A.vpoly(props, F, [(-0.55, EAVE + 0.15), (0.55, EAVE + 0.15), (0.55, EAVE + 1.3), (-0.55, EAVE + 1.3)], Y0 - 0.05, C["door"], -1)
    G.box(props, F, -0.65, 0.65, Y0 - 0.1, Y0 - 0.04, EAVE + 0.08, EAVE + 0.16, C["frame"])
    G.box(props, F, -0.12, 0.12, Y0 - 0.32 - 0.6, Y0, EAVE + 1.5, EAVE + 1.72, C["frame"])
    pul = F(0, Y0 - 0.75, EAVE + 1.4)
    Fp = G.frame(pul[0], pul[1], BEARING + 90, 0)
    A.vpoly(props, Fp, A.circle(0, EAVE + 1.4, 0.12, 10 if hq else 6), -0.03, C["iron"], -1)
    A.vpoly(props, Fp, A.circle(0, EAVE + 1.4, 0.12, 10 if hq else 6), 0.03, C["iron"], 1)
    G.tube(props, [(pul[0], pul[1], EAVE + 1.28), (pul[0], pul[1], 2.3)], 0.018, 4, C["rope"])
    G.tube(props, [(pul[0], pul[1], 2.3), F(0.05, Y0 - 0.75, 2.15)], 0.03, 4, C["iron"])
    # 側窗（每側兩扇，木窗板）
    for y in (3.2, 6.0):
        for sx in (-1, 1):
            Fw = G.frame(*F(sx * (X1 + 0.03), y, 0)[:2], BEARING + 90 * sx + 180, FLOOR)
            A.window_box(stone, props, gm, gcol, Fw, 0.75, 2.85, 0.95, trim=C["frame"], glass=C["glass"], arch=False, shutters=(props, C["door"]) if hq else None, hq=hq)
    # 背面小窗
    for x in (-2.6, 2.6):
        Fw = G.frame(*F(x, Y1 + 0.03, 0)[:2], BEARING + 180, FLOOR)
        A.window_box(stone, props, gm, gcol, Fw, 0.7, 2.9, 0.9, trim=C["frame"], glass=C["glass"], arch=False, hq=hq)
    # ---- 門前貨物：木箱、麻袋、木桶（y 0.1～1.2，碰撞箱內）----
    seg = 10 if hq else 6
    crates = [(-3.9, 0.55, 0.0, 0.7), (-3.15, 0.5, 0.0, 0.55), (-3.75, 0.55, 0.7, 0.5), (3.6, 0.55, 0.0, 0.65)]
    for x, y, h, s in crates:
        G.box(props, F, x - s / 2, x + s / 2, y - s / 2, y + s / 2, h, h + s, C["crate"])
        if hq:
            for k in (-1, 1):
                G.box(props, F, x - s / 2 - 0.01, x + s / 2 + 0.01, y - s / 2 - 0.01, y + s / 2 + 0.01, h + s / 2 + k * s * 0.38 - 0.03, h + s / 2 + k * s * 0.38 + 0.03, C["frame"])
    for x, y in ((2.6, 0.5), (4.2, 0.95)):
        p = F(x, y, 0)
        G.lathe(props, p[0], p[1], 0.0, [(0.3, 0.0), (0.34, 0.4), (0.3, 0.8), (0.0, 0.8)], seg, A.WOOD)
        for h in (0.1, 0.62):
            G.lathe(props, p[0], p[1], 0.0, [(0.32, h), (0.345, h + 0.04), (0.33, h + 0.08)], seg, C["iron"])
    for x, y, r in ((-2.4, 0.55, 0.3), (-2.0, 0.75, 0.26), (3.0, 1.0, 0.24)):
        p = F(x, y, 0)
        G.blob(props, (p[0], p[1], r * 0.8), r, r * 0.9, r * 0.8, C["sack"])
        G.blob(props, (p[0], p[1], r * 1.6), r * 0.28, r * 0.28, r * 0.22, C["rope"])
    # 門兩側小提燈（glow）
    for sx in (-1, 1):
        lx = sx * 2.25
        G.box(props, F, lx - 0.03, lx + 0.03, Y0 - 0.35, Y0, 2.75, 2.8, C["iron"])
        c = F(lx, Y0 - 0.33, 0)
        G.lathe(props, c[0], c[1], 2.45, [(0.06, -0.14), (0.09, -0.12), (0.09, 0.08), (0.05, 0.12), (0.0, 0.16)], 8 if hq else 6, C["iron"])
        G.lathe(glow, c[0], c[1], 2.45, [(0.0, -0.11), (0.075, -0.1), (0.075, 0.07), (0.0, 0.08)], 8 if hq else 6, (1.0, 0.82, 0.5))
    return {k: v for k, v in (("stone", stone), ("roof", roof), ("gold", gold), ("props", props), ("glow", glow)) if v.f}


def extra(mbs):
    out_pts = sum(1 for mb in mbs.values() for v in mb.v if not (lambda p: -W / 2 - 0.01 <= p[0] <= W / 2 + 0.01 and -0.01 <= p[1] <= D + 0.01 and -0.01 <= p[2] <= TOP + 0.01)(local(v)))
    return {"outside_colliders": out_pts, "bounds_local": A.bounds(mbs, local)}


def main():
    door = F(0, Y0 - 0.15, 0.3)
    A.export_lods("warehouse", build, BUDGET, OUT, {"stone": A.box_uv(local, EX, EY), "roof": A.slope_uv()},
                  {"bearing": BEARING, "front": FRONT, "w": W, "d": D, "eave": EAVE, "top": TOP, "floor": FLOOR, "door": [round(door[0], 3), round(door[1], 3)]}, extra=extra)


if __name__ == "__main__":
    main()
