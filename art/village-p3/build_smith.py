"""P3-7 鐵匠鋪＋戶外鍛造台＋詞條鑑定櫃台（HQ / Lite）。

blender -b --factory-startup -P build_smith.py -- --out <輸出資料夾>

- V1.3：方位 240°、正面 r 24、寬 12 × 深 10、最高 11 m（地面）；鍛造台碰撞箱 2.4 × 2 × 高 2.2（鐵匠鋪前庭）。
  所有網格都在這兩個原碰撞箱內，不新增碰撞。只有一位鐵匠 NPC（站在鍛造台旁，位置不變），同時負責鐵匠轉職與裝備詞條鑑定
- 造型：石砌一樓＋半木構二樓（往外挑出、遮住店面）＋赤陶瓦大屋頂與前方老虎窗、粗石大煙囪（頂端發光餘燼）、
  店面「鑑定櫃台」（放大鏡、天秤、詞條卷軸、寶石墊）、掛牌（金色鐵砧＋錘）、武器陳列架、木桶與工具箱；
  鍛造台：石砌爐床（發光炭火）、爐罩、鐵砧樹墩、淬火水桶、風箱
- 識別色：赤陶紅屋頂＋鐵灰＋爐火橘
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
import vp3_detail66 as D66  # noqa: E402  （Stage 6.6 壁燈、花盆）

BEARING, FRONT, W, D, TOP, FLOOR = 240.0, 24.0, 12.0, 10.0, 11.0, 0.0
OX, OZ = G.pol(BEARING, FRONT)
F, local, EX, EY = A.local_fn(OX, OZ, BEARING, FLOOR)
_t = math.radians(BEARING)
FORGE = {"x": 22.5 * math.sin(_t) + 3.5 * math.cos(_t), "z": 22.5 * math.cos(_t) - 3.5 * math.sin(_t), "w": 2.4, "d": 2.0, "h": 2.2}
FF, flocal, _, _ = A.local_fn(FORGE["x"], FORGE["z"], BEARING, 0.0)  # 原點＝鍛造台中心
BUDGET = {"hq": 18700, "lite": 8350}  # Stage 6.6：＋壁燈與花盆
C = {
    "roof": (0.80, 0.44, 0.32), "roof_d": (0.64, 0.34, 0.25),
    "plaster": (0.98, 0.95, 0.88), "timber": (0.42, 0.27, 0.16),
    "door": (0.45, 0.28, 0.17), "iron": (0.27, 0.28, 0.32), "iron_l": (0.5, 0.52, 0.57),
    "ember": (1.0, 0.55, 0.18), "ember_hi": (1.0, 0.82, 0.4), "coal": (0.16, 0.13, 0.12),
    "water": (0.32, 0.55, 0.72), "lens": (0.62, 0.86, 1.0), "gem": (0.55, 0.7, 1.0), "gem2": (0.85, 0.5, 1.0),
    "scroll": (0.97, 0.92, 0.8), "cloth": (0.25, 0.3, 0.55), "glass": (0.2, 0.3, 0.5),
}
FRONT_Y = 1.7   # 一樓店面牆（二樓挑出到 y 0.3）
WX = 5.6


def build(lod):
    hq = lod == "hq"
    stone, roof, gold, props, glow = (G.MB(f"Smith_{k}", lin) for k, lin in (("stone", True), ("roof", True), ("gold", False), ("props", False), ("glow", False)))
    gm, gcol = (gold, (1, 1, 1)) if hq else (props, A.GOLD_VC)
    # ---- 基座與一樓石牆 ----
    G.box(stone, F, -5.95, 5.95, 0.05, 9.95, 0.0, 0.32, A.PLINTH)
    G.box(stone, F, -WX, WX, FRONT_Y, 9.7, 0.32, 3.6, A.WALL)
    G.box(stone, F, -WX - 0.08, WX + 0.08, FRONT_Y - 0.08, 9.78, 0.32, 0.72, A.PLINTH)
    for sx in (-1, 1):  # 一樓轉角隅石
        h = 0.72
        k = 0
        while h < 3.5:
            lx = 0.55 if k % 2 == 0 else 0.32
            xa, xb = sorted((sx * WX, sx * (WX - lx)))
            G.box(stone, F, xa - (0.04 if sx < 0 else 0), xb + (0.04 if sx > 0 else 0), FRONT_Y - 0.05, FRONT_Y + 0.28, h, h + 0.44, A.TRIM)
            h += 0.5
            k += 1
    # ---- 二樓：半木構（暖白灰泥＋深色木架），往前挑出遮住店面 ----
    G.box(props, F, -5.85, 5.85, 0.3, 9.85, 3.6, 3.78, C["timber"])  # 樓板梁
    G.box(stone, F, -5.75, 5.75, 0.42, 9.75, 3.78, 6.2, C["plaster"])
    y_f = 0.4
    beams = [(-5.75, 3.78, -5.75, 6.2), (5.75, 3.78, 5.75, 6.2), (-5.75, 6.12, 5.75, 6.12), (-5.75, 3.86, 5.75, 3.86)]
    for x in (-3.6, -1.4, 1.4, 3.6):
        beams.append((x, 3.78, x, 6.2))
    if hq:
        for x0, x1 in ((-5.75, -3.6), (3.6, 5.75), (-1.4, 1.4)):
            beams.append((x0, 3.86, x1, 6.12))
            beams.append((x1, 3.86, x0, 6.12))
    for x0, h0, x1, h1 in beams:
        A.plank(props, F, (x0, h0), (x1, h1), 0.14, y_f - 0.06, y_f + 0.02, C["timber"])
    # 二樓窗（三扇，木窗板）
    for x in (-2.5, 2.5) if not hq else (-4.7, -2.5, 2.5, 4.7):
        Fw = G.frame(*F(x, y_f - 0.02, 0)[:2], BEARING, FLOOR)
        A.window_box(stone, props, gm, gcol, Fw, 0.75, 4.35, 1.1, trim=A.TRIM, glass=C["glass"], arch=False, shutters=(props, C["timber"]) if hq else None, hq=hq)
    # 店面柱（支撐挑出的二樓）
    for x in (-5.45, -0.15, 5.45):
        G.box(props, F, x - 0.13, x + 0.13, 0.32, 0.58, 0.32, 3.6, C["timber"])
        G.box(stone, F, x - 0.2, x + 0.2, 0.25, 0.65, 0.0, 0.42, A.TRIM)
        if hq:
            A.plank(props, F, (x - 0.5 if x > -5 else x, 3.0), (x, 3.55), 0.1, 0.4, 0.5, C["timber"])
    # ---- 大屋頂（屋脊沿 x）＋前方老虎窗 ----
    A.gable_roof(roof, F, -6.0, 6.0, 0.05, 9.95, 6.05, 9.3, C["roof"], C["roof_d"], ridge_along="x", thick=0.18)
    for sx in (-1, 1):  # 兩側山牆（屋脊沿 x），朝外
        x = sx * 5.75
        tri = [stone.vert(F(x, 0.42, 6.2), C["plaster"]), stone.vert(F(x, 9.75, 6.2), C["plaster"]), stone.vert(F(x, 5.0, 9.15), C["plaster"])]
        stone.face(tri, G.sub(F(sx, 0, 0), F(0, 0, 0)))
    G.tube(gm, [F(-6.0, 5.0, 9.33), F(6.0, 5.0, 9.33)], 0.05, 5 if hq else 3, gcol)
    # 老虎窗（前坡中間）
    dy = 2.4
    G.box(stone, F, -1.0, 1.0, dy, dy + 1.2, 7.0, 8.2, C["plaster"])
    A.gable_roof(roof, F, -1.2, 1.2, dy - 0.15, dy + 1.6, 8.05, 8.75, C["roof"], C["roof_d"], ridge_along="y", thick=0.08)
    A.gable_wall(stone, F, -1.0, 1.0, dy, 8.2, 8.62, C["plaster"])
    Fw = G.frame(*F(0, dy - 0.01, 0)[:2], BEARING, FLOOR)
    A.window_box(stone, props, gm, gcol, Fw, 0.7, 7.25, 0.8, glass=C["glass"], arch=True, hq=hq)
    # ---- 粗石大煙囪（右後）＋發光餘燼 ----
    cx, cy = 3.9, 6.8
    G.box(stone, F, cx - 0.65, cx + 0.65, cy - 0.65, cy + 0.65, 6.0, 10.4, A.WALL2)
    G.box(stone, F, cx - 0.75, cx + 0.75, cy - 0.75, cy + 0.75, 10.4, 10.65, A.TRIM)
    G.box(stone, F, cx - 0.5, cx + 0.5, cy - 0.5, cy + 0.5, 10.65, 10.9, A.WALL2)
    A.flat_poly(glow, [F(cx - 0.38, cy - 0.38, 0)[:2], F(cx + 0.38, cy - 0.38, 0)[:2], F(cx + 0.38, cy + 0.38, 0)[:2], F(cx - 0.38, cy + 0.38, 0)[:2]], 10.86, C["ember"])
    # ---- 一樓店面：鑑定櫃台窗口＋門 ----
    # 櫃台窗口（x −4.6～−0.6，挖空：用深色內牆表示開口）
    A.vpoly(props, F, [(-4.7, 1.05), (-0.6, 1.05), (-0.6, 2.95), (-4.7, 2.95)], FRONT_Y - 0.01, (0.22, 0.16, 0.12), -1)
    G.box(props, F, -4.85, -0.45, FRONT_Y - 0.12, FRONT_Y + 0.02, 2.95, 3.12, C["timber"])
    for x in (-4.85, -0.6):
        G.box(props, F, x, x + 0.15, FRONT_Y - 0.12, FRONT_Y + 0.02, 1.0, 3.0, C["timber"])
    # 櫃台（石座＋木檯面）
    G.box(stone, F, -4.7, -0.6, FRONT_Y - 0.5, FRONT_Y, 0.32, 1.0, A.TRIM)
    G.box(props, F, -4.8, -0.5, FRONT_Y - 0.6, FRONT_Y + 0.05, 1.0, 1.08, A.WOOD)
    if hq:
        G.box(gm, F, -4.8, -0.5, FRONT_Y - 0.61, FRONT_Y - 0.6, 1.0, 1.08, gcol)
    # 鑑定工具：放大鏡（金框＋發光鏡片）、天秤、卷軸、寶石墊
    m = F(-3.9, FRONT_Y - 0.3, 0)
    G.tube(gm, [(m[0], m[1], 1.08), (m[0], m[1], 1.36)], 0.015, 4, gcol)
    lens = G.frame(m[0], m[1], BEARING, 0)
    A.vpoly(glow, lens, A.circle(0, 1.5, 0.13, 12 if hq else 8), -0.01, C["lens"], -1)
    A.vpoly(glow, lens, A.circle(0, 1.5, 0.13, 12 if hq else 8), 0.01, C["lens"], 1)
    G.tube(gm, [(m[0] + math.sin(k * math.tau / 14) * 0.15 * math.cos(_t), m[1] - math.sin(k * math.tau / 14) * 0.15 * math.sin(_t), 1.5 + math.cos(k * math.tau / 14) * 0.15) for k in range(15)], 0.018, 4, gcol)
    s = F(-2.7, FRONT_Y - 0.3, 0)
    G.tube(gm, [(s[0], s[1], 1.08), (s[0], s[1], 1.5)], 0.015, 4, gcol)
    G.tube(gm, [F(-3.0, FRONT_Y - 0.3, 1.5), F(-2.4, FRONT_Y - 0.3, 1.5)], 0.012, 4, gcol)
    for sx in (-0.3, 0.3):
        p = F(-2.7 + sx, FRONT_Y - 0.3, 0)
        G.lathe(gm, p[0], p[1], 0.0, [(0.0, 1.3), (0.11, 1.31), (0.1, 1.34), (0.0, 1.34)], 8 if hq else 6, gcol)
        G.tube(gm, [(p[0], p[1], 1.34), (p[0], p[1], 1.49)], 0.004, 3, gcol)
    sc = F(-1.6, FRONT_Y - 0.32, 0)
    G.tube(props, [(sc[0] - 0.25 * math.cos(_t), sc[1] + 0.25 * math.sin(_t), 1.13), (sc[0] + 0.25 * math.cos(_t), sc[1] - 0.25 * math.sin(_t), 1.13)], 0.05, 6 if hq else 4, C["scroll"])
    G.box(props, F, -1.25, -0.8, FRONT_Y - 0.45, FRONT_Y - 0.15, 1.08, 1.14, C["cloth"])
    A.bipyramid(glow, F(-1.02, FRONT_Y - 0.3, 1.2), 0.06, 0.08, 0.06, 6, (C["gem"], C["gem"], C["gem2"]))
    # 店門（右側）
    hs = 2.35
    A.vextrude(stone, F, A.arch_outline(1.9, 0.32, hs, 8 if hq else 4, cx=2.6), FRONT_Y - 0.08, 0.1, A.TRIM)
    A.vpoly(props, F, A.arch_outline(1.5, 0.32, hs, 8 if hq else 4, cx=2.6), FRONT_Y - 0.1, C["door"], -1)
    for h in (0.9, 1.8):
        G.box(props, F, 1.9, 3.3, FRONT_Y - 0.13, FRONT_Y - 0.1, h, h + 0.07, C["iron"])
    G.blob(gm, F(3.1, FRONT_Y - 0.14, 1.4), 0.05, 0.05, 0.05, gcol)
    # 掛牌：鐵臂＋木牌＋金色鐵砧與錘
    G.box(props, F, 4.35, 5.3, 0.45, 0.5, 3.25, 3.3, C["iron"])
    Fb = G.frame(*F(4.85, 0.48, 0)[:2], BEARING + 90, FLOOR)
    A.vextrude(props, Fb, [(-0.4, 2.45), (0.4, 2.45), (0.4, 3.15), (-0.4, 3.15)], -0.03, 0.06, A.WOOD)
    A.vpoly(gm, Fb, [(-0.25, 2.75), (0.25, 2.75), (0.18, 2.86), (0.32, 2.94), (-0.32, 2.94), (-0.18, 2.86)], -0.035, gcol, -1)
    A.vpoly(gm, Fb, [(-0.1, 2.55), (0.1, 2.55), (0.06, 2.75), (-0.06, 2.75)], -0.035, gcol, -1)
    A.vpoly(gm, Fb, [(-0.25, 2.75), (0.25, 2.75), (0.18, 2.86), (0.32, 2.94), (-0.32, 2.94), (-0.18, 2.86)], 0.035, gcol, 1)
    G.tube(props, [Fb(0, 0, 3.15), Fb(0, 0, 3.27)], 0.01, 3, C["iron"])
    # 武器陳列架（店面左端）＋木桶與工具箱（門右側）
    G.box(props, F, -5.35, -5.0, FRONT_Y - 0.35, FRONT_Y - 0.1, 0.32, 2.6, A.WOOD)
    if hq:
        for i, x in enumerate((-5.25, -5.1)):
            blade = [(x - 0.04, 1.0 + 0.1 * i), (x + 0.04, 1.0 + 0.1 * i), (x + 0.04, 2.3), (x, 2.42), (x - 0.04, 2.3)]
            Fx = G.frame(*F(0, FRONT_Y - 0.4, 0)[:2], BEARING, FLOOR)
            A.vextrude(props, Fx, blade, 0.0, 0.03, C["iron_l"])
            G.box(gm, F, x - 0.12, x + 0.12, FRONT_Y - 0.43, FRONT_Y - 0.37, 0.95 + 0.1 * i, 1.0 + 0.1 * i, gcol)
    for i, (x, y) in enumerate(((4.3, 0.9), (4.95, 1.2))):
        p = F(x, y, 0)
        G.lathe(props, p[0], p[1], 0.32, [(0.26, 0.0), (0.3, 0.3), (0.26, 0.62), (0.0, 0.62)], 10 if hq else 6, A.WOOD)
        for h in (0.08, 0.54):
            G.lathe(props, p[0], p[1], 0.32, [(0.285, h), (0.3, h + 0.04), (0.285, h + 0.08)], 10 if hq else 6, C["iron"])
    G.box(props, F, 3.4, 4.0, 0.6, 1.05, 0.32, 0.72, A.WOOD_D)
    # ---- 側面與後面窗（一樓） ----
    for y in (4.0, 7.5):
        for sx in (-1, 1):
            Fw = G.frame(*F(sx * WX, y, 0)[:2], BEARING + 90 * sx + 180, FLOOR)
            A.window_box(stone, props, gm, gcol, Fw, 0.8, 1.2, 1.4, glass=C["glass"], arch=True, hq=hq)

    # ---- 背面：一樓窗、二樓半木構斜撐與窗、後門 ----
    for x in (-3.4, 0.0, 3.4) if hq else (-3.4, 3.4):
        Fw = G.frame(*F(x, 9.71, 0)[:2], BEARING + 180, FLOOR)
        A.window_box(stone, props, gm, gcol, Fw, 0.8, 1.2, 1.4, glass=C["glass"], arch=True, hq=hq)
        Fw2 = G.frame(*F(x, 9.76, 0)[:2], BEARING + 180, FLOOR)
        A.window_box(stone, props, gm, gcol, Fw2, 0.7, 4.4, 1.0, trim=A.TRIM, glass=C["glass"], arch=False, hq=hq)
    for x0, h0, x1, h1 in ((-5.75, 3.86, 5.75, 3.86), (-5.75, 6.12, 5.75, 6.12)):
        A.plank(props, F, (x0, h0), (x1, h1), 0.14, 9.74, 9.82, C["timber"])
    for x in (-5.7, -1.7, 1.7, 5.7):
        A.plank(props, F, (x, 3.8), (x, 6.18), 0.14, 9.74, 9.82, C["timber"])
    # ---- 戶外鍛造台（鍛造台碰撞箱內：x ±1.2、y ±1.0、高 ≤ 2.2）----
    G.box(stone, FF, -1.15, 0.1, -0.15, 0.95, 0.0, 0.85, A.WALL2)
    G.box(stone, FF, -1.2, 0.15, -0.2, 1.0, 0.85, 0.95, A.TRIM)
    A.flat_poly(props, [FF(-0.95, -0.02, 0)[:2], FF(-0.1, -0.02, 0)[:2], FF(-0.1, 0.62, 0)[:2], FF(-0.95, 0.62, 0)[:2]], 0.955, C["coal"])
    for i, (x, y, r) in enumerate(((-0.7, 0.2, 0.17), (-0.4, 0.35, 0.15), (-0.6, 0.45, 0.12), (-0.3, 0.12, 0.13), (-0.8, 0.5, 0.1))):
        p = FF(x, y, 0)
        G.blob(glow, (p[0], p[1], 0.97), r, r, 0.06, C["ember_hi"] if i % 2 else C["ember"])
    # 爐罩（金屬）＋短煙道
    G.box(props, FF, -1.15, 0.1, 0.62, 1.0, 0.95, 1.6, C["iron"])
    G.lathe(props, *FF(-0.52, 0.8, 0)[:2], 0.0, [(0.2, 1.6), (0.15, 1.85), (0.13, 2.15), (0.0, 2.15)], 8 if hq else 4, C["iron"])
    # 鐵砧樹墩
    a = FF(0.65, -0.35, 0)
    G.lathe(props, a[0], a[1], 0.0, [(0.32, 0.0), (0.3, 0.55), (0.0, 0.55)], 10 if hq else 6, A.WOOD_D)
    Fa = G.frame(a[0], a[1], BEARING + 90, 0.0)
    A.vextrude(props, Fa, [(-0.32, 0.72), (0.18, 0.72), (0.42, 0.8), (0.18, 0.86), (-0.32, 0.86)], -0.12, 0.24, C["iron"])
    G.box(props, Fa, -0.15, 0.1, -0.08, 0.08, 0.55, 0.72, C["iron"])
    # 淬火水桶＋水面
    q = FF(0.75, 0.55, 0)
    G.lathe(props, q[0], q[1], 0.0, [(0.3, 0.0), (0.33, 0.35), (0.31, 0.72), (0.27, 0.72), (0.27, 0.66), (0.0, 0.66)], 10 if hq else 6, A.WOOD)
    G.lathe(props, q[0], q[1], 0.0, [(0.335, 0.2), (0.345, 0.24), (0.335, 0.28)], 10 if hq else 6, C["iron"])
    A.flat_disc(props, q[0], q[1], 0.665, 0.27, C["water"], 10 if hq else 6)
    # 風箱（爐床左前）
    b = FF(-0.75, -0.62, 0)
    Fbw = G.frame(b[0], b[1], BEARING + 90, 0.0)
    A.vextrude(props, Fbw, [(-0.22, 0.3), (0.22, 0.38), (0.22, 0.52), (-0.22, 0.6)], -0.16, 0.32, (0.5, 0.32, 0.2))
    G.box(props, Fbw, -0.36, -0.22, -0.04, 0.04, 0.42, 0.48, A.WOOD)
    D66.decorate66("smith", locals(), F, lod)
    return {k: v for k, v in (("stone", stone), ("roof", roof), ("gold", gold), ("props", props), ("glow", glow)) if v.f}


def extra(mbs):
    """建築碰撞箱與鍛造台碰撞箱：每個頂點必須在其中之一（含 1 cm 誤差）"""
    out_pts = 0
    for mb in mbs.values():
        for v in mb.v:
            x, y, h = local(v)
            in_b = -W / 2 - 0.01 <= x <= W / 2 + 0.01 and -0.01 <= y <= D + 0.01 and -0.01 <= h <= TOP + 0.01
            fx, fy, fh = flocal(v)
            in_f = abs(fx) <= FORGE["w"] / 2 + 0.01 and abs(fy) <= FORGE["d"] / 2 + 0.01 and -0.01 <= fh <= FORGE["h"] + 0.01
            if not (in_b or in_f):
                out_pts += 1
    return {"outside_colliders": out_pts, "bounds_local": A.bounds(mbs, local)}


def main():
    door = F(2.6, FRONT_Y - 0.1, 0.32)
    counter = F(-2.65, FRONT_Y - 0.3, 1.08)
    A.export_lods("smith", build, BUDGET, OUT, {"stone": A.box_uv(local, EX, EY), "roof": A.slope_uv()},
                  {"bearing": BEARING, "front": FRONT, "w": W, "d": D, "top": TOP, "floor": FLOOR, "door": [round(door[0], 3), round(door[1], 3)],
                   "counter": [round(counter[0], 3), round(counter[1], 3)], "forge": FORGE}, extra=extra)


if __name__ == "__main__":
    main()
