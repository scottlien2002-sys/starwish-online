"""P3-7 每日委託佈告欄（HQ / Lite）：V1.3 位置（方位 158°、r 19.5）、碰撞箱 4 × 0.8 × 高 3.5 m 內；正面朝噴泉。

blender -b --factory-startup -P build_board.py -- --out <輸出資料夾>
造型：兩根石座木柱＋金帽、雕花木框告示板（暖白底板＋金色邊框）、委託單（米白紙、紅色蠟封、金色星章）、
藍色魚鱗瓦小雙坡屋頂＋金屋脊與星形尖飾、兩側小提燈（發光）、底部石台階
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

BEARING, R, W, D, TOP = 158.0, 19.5, 4.0, 0.8, 3.5
BX, BZ = G.pol(BEARING, R)
F, local, EX, EY = A.local_fn(BX, BZ, BEARING, 0.0)  # 原點＝佈告欄中心；−y＝朝噴泉
BUDGET = {"hq": 2600, "lite": 1200}
C = {"board": (0.97, 0.93, 0.84), "paper": (0.99, 0.96, 0.88), "paper2": (0.95, 0.9, 0.8), "seal": (0.78, 0.18, 0.2), "roof": (0.22, 0.33, 0.62), "roof_d": (0.17, 0.26, 0.5), "lamp": (1.0, 0.86, 0.55)}


def build(lod):
    hq = lod == "hq"
    stone, roof, gold, props, glow = (G.MB(f"Board_{k}", lin) for k, lin in (("stone", True), ("roof", True), ("gold", False), ("props", False), ("glow", False)))
    gm, gcol = (gold, (1, 1, 1)) if hq else (props, A.GOLD_VC)
    # 石台與柱座
    G.box(stone, F, -1.98, 1.98, -0.38, 0.38, 0.0, 0.12, A.PLINTH)
    for sx in (-1, 1):
        G.box(stone, F, sx * 1.84 - 0.16, sx * 1.84 + 0.16, -0.16, 0.16, 0.12, 0.42, A.TRIM)
        if hq:  # 八角柱＋柱頭環＋斜撐
            G.lathe(props, *F(sx * 1.84, 0, 0)[:2], 0.0, [(0.11, 0.42), (0.095, 0.5), (0.09, 2.7), (0.11, 2.76), (0.11, 2.86)], 8, A.WOOD, smooth=False)
            A.plank(props, F, (sx * 1.75, 2.2), (sx * 1.45, 2.55), 0.07, -0.04, 0.04, A.WOOD_D)
        else:
            G.box(props, F, sx * 1.84 - 0.09, sx * 1.84 + 0.09, -0.09, 0.09, 0.42, 2.86, A.WOOD)
        G.lathe(gm, *F(sx * 1.84, 0, 0)[:2], 0.0, [(0.12, 2.84), (0.13, 2.9), (0.08, 2.98), (0.0, 3.04)], 8 if hq else 6, gcol)
    # 告示板：木框＋暖白底板＋金色內框
    G.box(props, F, -1.75, 1.75, -0.05, 0.05, 0.88, 2.55, A.WOOD_D)
    A.vpoly(props, F, [(-1.6, 1.0), (1.6, 1.0), (1.6, 2.42), (-1.6, 2.42)], -0.055, C["board"], -1)
    A.vpoly(props, F, [(-1.6, 1.0), (1.6, 1.0), (1.6, 2.42), (-1.6, 2.42)], 0.055, C["board"], 1)
    for a, b in (((-1.66, 0.94), (1.66, 0.94)), ((-1.66, 2.48), (1.66, 2.48)), ((-1.66, 0.94), (-1.66, 2.48)), ((1.66, 0.94), (1.66, 2.48))):
        A.plank(gm, F, a, b, 0.05, -0.075, -0.055, gcol)
    # 頂部雕花橫楣＋金色星章
    A.vextrude(props, F, [(-1.8, 2.55), (1.8, 2.55), (1.6, 2.72), (0.0, 2.8), (-1.6, 2.72)], -0.06, 0.12, A.WOOD)
    A.vpoly(gm, F, A.star_outline(0, 2.66, 4, 0.11, 0.035), -0.065, gcol, -1)
    # 委託單（米白紙、輕微歪斜）＋紅色蠟封
    sheets = [(-1.2, 1.95, 0.48, 0.36, 4), (-0.55, 2.05, 0.42, 0.32, -3), (0.1, 1.9, 0.5, 0.4, 2), (0.85, 2.0, 0.46, 0.34, -5), (-0.95, 1.35, 0.5, 0.34, -2), (0.35, 1.32, 0.44, 0.3, 4), (1.15, 1.36, 0.36, 0.3, -4)]
    if not hq:
        sheets = sheets[::2]
    for i, (cx, ch, w, h, deg) in enumerate(sheets):
        a = math.radians(deg)
        pts = [(cx + x * math.cos(a) - y * math.sin(a), ch + x * math.sin(a) + y * math.cos(a)) for x, y in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))]
        A.vpoly(props, F, pts, -0.06 - 0.002 * i, C["paper"] if i % 2 else C["paper2"], -1)
        if hq:
            for k in range(3):
                y = ch + h / 2 - 0.1 - k * 0.07
                A.vpoly(props, F, [(cx - w * 0.35, y - 0.01), (cx + w * 0.3, y - 0.01), (cx + w * 0.3, y + 0.01), (cx - w * 0.35, y + 0.01)], -0.063 - 0.002 * i, (0.55, 0.5, 0.45), -1)
        A.vpoly(props, F, A.circle(cx + w * 0.32, ch + h / 2 - 0.06, 0.04, 8), -0.064 - 0.002 * i, C["seal"], -1)
    # 小雙坡屋頂（屋脊沿 x、屋簷朝前後）＋金屋脊＋星形尖飾
    A.gable_roof(roof, F, -2.0, 2.0, -0.39, 0.39, 2.9, 3.28, C["roof"], C["roof_d"], ridge_along="x", thick=0.07)
    G.tube(gm, [F(-2.0, 0, 3.3), F(2.0, 0, 3.3)], 0.035, 5 if hq else 3, gcol)
    for sx in (-1, 1):
        A.vpoly(gm, F, A.star_outline(sx * 1.86, 3.38, 4, 0.1, 0.03), 0.0, gcol, -1)
        A.vpoly(gm, F, A.star_outline(sx * 1.86, 3.38, 4, 0.1, 0.03), 0.002, gcol, 1)
    # 兩側小提燈（掛在柱子外側，碰撞箱內）
    for sx in (-1, 1):
        lx = sx * 1.84
        G.box(gm, F, lx - 0.02, lx + 0.02, -0.3, -0.08, 2.55, 2.58, gcol)
        c = F(lx, -0.3, 2.3)
        G.lathe(props, c[0], c[1], 2.3, [(0.06, -0.14), (0.09, -0.12), (0.09, 0.08), (0.05, 0.12), (0.0, 0.14)], 8 if hq else 6, A.IRON)
        G.lathe(glow, c[0], c[1], 2.3, [(0.0, -0.11), (0.075, -0.1), (0.075, 0.07), (0.0, 0.08)], 8 if hq else 6, C["lamp"])
        G.tube(gm, [F(lx, -0.3, 2.44), F(lx, -0.3, 2.56)], 0.008, 3, gcol)
    return {k: v for k, v in (("stone", stone), ("roof", roof), ("gold", gold), ("props", props), ("glow", glow)) if v.f}


def main():
    A.export_lods("board", build, BUDGET, OUT, {"stone": A.box_uv(local, EX, EY), "roof": A.slope_uv()},
                  {"bearing": BEARING, "r": R, "w": W, "d": D, "top": TOP, "front_normal": [round(-EY[0], 4), round(-EY[1], 4)]},
                  extra=lambda mbs: {"bounds_local": A.bounds(mbs, local)})


if __name__ == "__main__":
    main()
