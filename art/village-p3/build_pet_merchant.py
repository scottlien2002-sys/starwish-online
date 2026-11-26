"""Stage 6 星芽村「寵物商人」NPC 模型（HQ / Lite）。

blender -b --factory-startup -P build_pet_merchant.py -- --out <輸出資料夾>

- 精緻可愛的日系奇幻 Q 版商人（與玩家同為約 1.25 m 身高，帽子到約 1.55 m），原點在腳底、面向 +Z
- 紫藍斗篷長袍＋暖白圍裙＋金邊（呼應星芽村的暖白石材、金色裝飾、藍紫魔法）
- 道具：寬簷尖帽（金星帽帶、羽毛）、背後大背包＋頂部玻璃寵物艙（發光，裡面有小寵物剪影）、
  腰側飼料袋（葉子記號）、蛋籃（兩顆蛋）、左手鑑定放大鏡（發光鏡片）、右手孵化提燈杖（金籠＋發光蛋）
- 旁邊跟著一隻小寵物（獨立網格，執行時在商人身旁跳動）
- 網格：PetMerchant_props（頂點色）、PetMerchant_gold（HQ；Lite 畫在頂點色）、PetMerchant_glow（自發光 × 頂點色）、PetPal_props（小寵物）
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

BUDGET = {"hq": 8000, "lite": 3000}
LOD = {"hq": dict(sph=16, rings=10, lathe=18, tube=6, hq=True), "lite": dict(sph=8, rings=6, lathe=9, tube=4, hq=False)}
C = {
    "skin": (1.0, 0.86, 0.76),
    "blush": (1.0, 0.66, 0.66),
    "eye": (0.24, 0.17, 0.30),
    "eye_hi": (1.0, 1.0, 1.0),
    "hair": (1.0, 0.85, 0.56),
    "hair_d": (0.95, 0.76, 0.46),
    "robe": (0.42, 0.38, 0.82),
    "robe_d": (0.33, 0.29, 0.68),
    "cape": (0.30, 0.27, 0.62),
    "apron": (0.98, 0.95, 0.89),
    "leather": (0.62, 0.42, 0.27),
    "leather_d": (0.47, 0.31, 0.20),
    "boot": (0.42, 0.28, 0.19),
    "wood": (0.55, 0.38, 0.24),
    "sack": (0.86, 0.76, 0.56),
    "leaf": (0.46, 0.74, 0.44),
    "hat": (0.37, 0.31, 0.74),
    "hat_d": (0.29, 0.24, 0.60),
    "feather": (0.55, 0.86, 0.84),
    "egg1": (0.99, 0.96, 0.90),
    "egg2": (0.80, 0.90, 1.0),
    "gold_vc": (0.93, 0.74, 0.34),
    "lens": (0.62, 0.86, 1.0),
    "dome": (0.50, 0.74, 1.0),
    "egg_glow": (1.0, 0.90, 0.62),
    "pal": (0.99, 0.96, 0.92),
    "pal_ear": (0.62, 0.74, 1.0),
    "pal_cheek": (1.0, 0.72, 0.74),
}
FRONT = G.frame(0, 0, 180, 0)  # −y＝朝 +Z（臉的方向）；注意此框架 x 左右鏡像


def ellipsoid(mb, c, rx, rz, rh, P, col, flat_bottom=False):
    """橢球（c＝中心；rx 東西、rz 南北、rh 上下）；col 可為 rgb 或 fn(local_h(-1..1), dir_z)"""
    cf = col if callable(col) else (lambda u, v, cc=col: cc)
    seg, rings = P["sph"], P["rings"]
    top = mb.vert((c[0], c[1], c[2] + rh), cf(1.0, 0.0))
    bot = mb.vert((c[0], c[1], c[2] - (rh * 0.05 if flat_bottom else rh)), cf(-1.0, 0.0))
    grid = []
    for i in range(1, rings):
        a = math.pi * i / rings
        row = []
        for k in range(seg):
            b = math.tau * k / seg
            x, z, h = math.sin(a) * math.sin(b), math.sin(a) * math.cos(b), math.cos(a)
            if flat_bottom and h < -0.05:
                h = -0.05
            row.append(mb.vert((c[0] + rx * x, c[1] + rz * z, c[2] + rh * h), cf(h, z)))
        grid.append(row)
    for k in range(seg):
        k2 = (k + 1) % seg
        mb.face([top, grid[0][k], grid[0][k2]], (0, 0, 1))
        mb.face([bot, grid[-1][k2], grid[-1][k]], (0, 0, -1))
        for i in range(rings - 2):
            q = [grid[i][k], grid[i + 1][k], grid[i + 1][k2], grid[i][k2]]
            cc = G.centroid([mb.v[j] for j in q])
            mb.face(q, G.sub(cc, c))


def disc(mb, cx, h, y, rx, rh, col, n=10, Fr=FRONT):
    """臉上的平面橢圓（朝 +Z）：cx、h 為世界 X 與高度、y 為世界 Z"""
    ids = [mb.vert(Fr(-(cx + math.sin(k * math.tau / n) * rx), -y, h + math.cos(k * math.tau / n) * rh), col) for k in range(n)]
    c = mb.vert(Fr(-cx, -y - 0.001, h), col)
    for k in range(n):
        mb.face([c, ids[k], ids[(k + 1) % n]], (0, 1, 0))


def build(lod):
    P = LOD[lod]
    hq = P["hq"]
    props = G.MB("PetMerchant_props", False)
    gold = G.MB("PetMerchant_gold", False)
    glow = G.MB("PetMerchant_glow", False)
    pal = G.MB("PetPal_props", False)
    gm, gcol = (gold, (1, 1, 1)) if hq else (props, C["gold_vc"])
    L = P["lathe"]

    # ---- 靴子 ----
    for sx in (-1, 1):
        ellipsoid(props, (sx * 0.085, 0.03, 0.055), 0.075, 0.11, 0.06, P, C["boot"], flat_bottom=True)
    # ---- 長袍（鐘形）＋金色下襬 ----
    rprof = [(0.29, 0.07), (0.28, 0.14), (0.25, 0.26), (0.215, 0.38), (0.185, 0.48), (0.16, 0.56), (0.12, 0.63), (0.0, 0.66)]
    G.lathe(props, 0, 0, 0, rprof, L, lambda h: C["robe_d"] if h < 0.2 else C["robe"])
    G.lathe(gm, 0, 0, 0, [(0.292, 0.075), (0.3, 0.1), (0.288, 0.125)], L, gcol)
    # 暖白圍裙（貼著長袍前面）
    rr = lambda h: next(r0 + (r1 - r0) * (h - h0) / (h1 - h0) for (r0, h0), (r1, h1) in zip(rprof, rprof[1:]) if h0 <= h <= h1)  # noqa: E731
    cols, rows = (5, 5) if hq else (3, 3)
    grid = []
    for i in range(rows + 1):
        h = 0.13 + (0.45 - 0.13) * i / rows
        w = 0.15 - 0.05 * i / rows
        row = []
        for j in range(cols + 1):
            x = -w + 2 * w * j / cols
            r = rr(h) + 0.006
            z = math.sqrt(max(r * r - x * x, 0.0001))
            row.append(props.vert((x, z, h), C["apron"]))
        grid.append(row)
    for i in range(rows):
        for j in range(cols):
            props.face([grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]], (0, 1, 0))
    # 圍裙口袋上的金色小星
    disc(gm, 0.0, 0.25, rr(0.25) + 0.012, 0.03, 0.03, gcol, n=8)
    # ---- 皮帶、金扣、側邊小袋 ----
    G.lathe(props, 0, 0, 0, [(0.205, 0.40), (0.21, 0.42), (0.205, 0.45)], L, C["leather"])
    G.box(gm, G.frame(0, 0.205, 0, 0), -0.03, 0.03, 0.0, 0.015, 0.405, 0.445, gcol)
    # ---- 斗篷短披肩（金邊）＋領口 ----
    G.lathe(props, 0, 0, 0, [(0.23, 0.50), (0.21, 0.55), (0.17, 0.61), (0.11, 0.66), (0.0, 0.67)], L, C["cape"])
    G.lathe(gm, 0, 0, 0, [(0.232, 0.495), (0.238, 0.51), (0.228, 0.525)], L, gcol)
    G.lathe(props, 0, 0, 0, [(0.1, 0.64), (0.105, 0.67), (0.08, 0.69), (0.0, 0.69)], L, C["apron"])
    # ---- 頭（大頭 Q 版）----
    HC = (0.0, 0.0, 0.86)
    ellipsoid(props, HC, 0.205, 0.195, 0.2, P, C["skin"])
    # 頭髮：後腦＋頭頂（較大的橢球往後偏）、瀏海與兩側髮束
    ellipsoid(props, (0.0, -0.035, 0.9), 0.215, 0.2, 0.195, P, lambda u, v: C["hair"] if v < 0.55 or u > 0.35 else C["hair_d"])
    for bx, bh, s in ((-0.11, 0.98, 0.08), (-0.035, 1.0, 0.085), (0.045, 1.0, 0.085), (0.12, 0.98, 0.075)):
        G.blob(props, (bx, 0.15, bh), s, 0.06, s * 0.9, C["hair"])
    for sx in (-1, 1):
        G.tube(props, [(sx * 0.19, 0.04, 0.92), (sx * 0.215, 0.05, 0.8), (sx * 0.2, 0.07, 0.7)], 0.045, P["tube"], C["hair"], taper=0.4)
    # 臉：大眼睛（深紫＋白色高光）、腮紅、小嘴
    for sx in (-1, 1):
        disc(props, sx * 0.075, 0.84, 0.188, 0.034, 0.048, C["eye"], n=12 if hq else 8)
        disc(props, sx * 0.075 - 0.012, 0.858, 0.19, 0.012, 0.014, C["eye_hi"], n=6)
        disc(props, sx * 0.125, 0.79, 0.168, 0.03, 0.017, C["blush"], n=8)
    disc(props, 0.0, 0.775, 0.192, 0.018, 0.008, (0.78, 0.42, 0.45), n=6)

    # ---- 寬簷尖帽（金星帽帶、羽毛、彎曲帽尖）----
    G.lathe(props, 0, -0.02, 0, [(0.33, 1.0), (0.335, 1.015), (0.24, 1.035), (0.0, 1.04)], L, C["hat_d"], bottom=True)
    G.lathe(props, 0, -0.02, 0, [(0.19, 1.03), (0.165, 1.12), (0.13, 1.22), (0.095, 1.3), (0.0, 1.31)], L, C["hat"])
    G.lathe(gm, 0, -0.02, 0, [(0.193, 1.035), (0.186, 1.075), (0.178, 1.09)], L, gcol)
    G.tube(props, [(0.0, -0.02, 1.29), (0.01, -0.03, 1.37), (0.035, -0.06, 1.44), (0.075, -0.1, 1.48)], 0.09, P["tube"], C["hat"], taper=0.12)
    G.blob(gm, (0.08, -0.105, 1.48), 0.025, 0.025, 0.025, gcol)
    # 帽帶正面的金星
    Fh = G.frame(0, 0.17, 180, 0)
    star = [(math.sin(i * math.pi / 5) * (0.05 if i % 2 == 0 else 0.022), 1.06 + math.cos(i * math.pi / 5) * (0.05 if i % 2 == 0 else 0.022)) for i in range(10)]
    ids = [gm.vert(Fh(x, -0.012, h), gcol) for x, h in star]
    c = gm.vert(Fh(0, -0.016, 1.06), gcol)
    for i in range(10):
        gm.face([c, ids[i], ids[(i + 1) % 10]], (0, 1, 0))
    # 羽毛（帽子右側）
    G.tube(props, [(0.17, -0.03, 1.06), (0.21, -0.07, 1.14), (0.22, -0.13, 1.22)], 0.03, P["tube"], C["feather"], taper=0.2)

    # ---- 手臂與手 ----
    for sx, hand in ((-1, (-0.2, 0.15, 0.5)), (1, (0.25, 0.08, 0.42))):
        sh = (sx * 0.15, 0.0, 0.6)
        el = (sx * 0.22, 0.04, 0.5)
        G.tube(props, [sh, el, hand], 0.052, P["tube"], C["robe"], taper=0.8)
        G.lathe(gm, hand[0], hand[1], hand[2] - 0.04, [(0.05, 0.0), (0.054, 0.012), (0.05, 0.024)], 8 if hq else 6, gcol)
        ellipsoid(props, hand, 0.042, 0.042, 0.042, P, C["skin"])
    # 左手：鑑定放大鏡（金框＋發光鏡片）
    lc = (-0.2, 0.2, 0.62)
    G.tube(props, [(-0.2, 0.15, 0.5), (-0.2, 0.18, 0.56)], 0.014, 4, C["wood"])
    n = 16 if hq else 10
    ring = [(lc[0] + math.sin(k * math.tau / n) * 0.07, lc[1] + 0.005, lc[2] + math.cos(k * math.tau / n) * 0.07) for k in range(n + 1)]
    G.tube(gm, ring, 0.012, 4, gcol)
    ids = [glow.vert((lc[0] + math.sin(k * math.tau / n) * 0.062, lc[1], lc[2] + math.cos(k * math.tau / n) * 0.062), C["lens"]) for k in range(n)]
    cc = glow.vert(lc, C["lens"])
    for k in range(n):
        glow.face([cc, ids[k], ids[(k + 1) % n]], (0, 1, 0))
        glow.face([cc, ids[(k + 1) % n], ids[k]], (0, -1, 0))
    # 右手：孵化提燈杖（木杖＋金籠＋發光蛋）
    G.tube(props, [(0.27, 0.08, 0.04), (0.265, 0.08, 0.5), (0.26, 0.08, 0.98)], 0.018, P["tube"], C["wood"])
    lx, lz = 0.26, 0.08
    G.lathe(gm, lx, lz, 0, [(0.055, 0.98), (0.07, 1.0), (0.07, 1.015), (0.0, 1.02)], 8 if hq else 6, gcol)
    G.lathe(gm, lx, lz, 0, [(0.07, 1.2), (0.055, 1.22), (0.02, 1.25), (0.0, 1.27)], 8 if hq else 6, gcol)
    for k in range(6 if hq else 4):
        b = math.tau * k / (6 if hq else 4)
        G.tube(gm, [(lx + math.sin(b) * 0.066, lz + math.cos(b) * 0.066, 1.015), (lx + math.sin(b) * 0.075, lz + math.cos(b) * 0.075, 1.11), (lx + math.sin(b) * 0.066, lz + math.cos(b) * 0.066, 1.2)], 0.006, 3, gcol)
    ellipsoid(glow, (lx, lz, 1.105), 0.042, 0.042, 0.058, P, C["egg_glow"])

    # ---- 背包（背後）＋頂部發光寵物艙 ----
    Bk = G.frame(0, 0, 0, 0)
    G.box(props, Bk, -0.2, 0.2, -0.38, -0.16, 0.3, 0.8, C["leather"], bottom=True)
    G.box(props, Bk, -0.21, 0.21, -0.395, -0.15, 0.68, 0.82, C["leather_d"])  # 上蓋
    G.box(props, Bk, -0.16, 0.16, -0.405, -0.38, 0.38, 0.6, C["leather_d"])  # 外袋
    G.box(gm, Bk, -0.025, 0.025, -0.41, -0.395, 0.52, 0.6, gcol)  # 扣環
    for sx in (-1, 1):
        G.box(props, Bk, sx * 0.205 - 0.015, sx * 0.205 + 0.015, -0.39, -0.15, 0.27, 0.84, C["wood"])  # 木框
        G.tube(props, [(sx * 0.11, -0.17, 0.78), (sx * 0.13, -0.02, 0.66), (sx * 0.15, 0.12, 0.56), (sx * 0.13, 0.16, 0.44)], 0.016, 4, C["leather_d"])  # 背帶
    dome_c = (0.0, -0.27, 0.82)
    G.lathe(gm, dome_c[0], dome_c[1], 0, [(0.15, 0.815), (0.155, 0.83), (0.145, 0.845)], L, gcol)
    G.lathe(glow, dome_c[0], dome_c[1], 0, [(0.14, 0.83), (0.135, 0.89), (0.11, 0.95), (0.065, 0.99), (0.0, 1.0)], L, C["dome"])
    for k in range(4):
        b = math.tau * (k + 0.5) / 4
        G.tube(gm, [(math.sin(b) * 0.142, -0.27 + math.cos(b) * 0.142, 0.84), (math.sin(b) * 0.115, -0.27 + math.cos(b) * 0.115, 0.95), (0.0, -0.27, 1.005)], 0.006, 3, gcol)
    G.blob(gm, (0.0, -0.27, 1.02), 0.02, 0.02, 0.025, gcol)
    # 寵物艙裡的小寵物剪影（深色，透過發光玻璃看得到輪廓）
    ellipsoid(props, (0.0, -0.27, 0.875), 0.06, 0.055, 0.045, P, C["pal_ear"])
    # ---- 飼料袋（右後腰）：麻袋＋綁口＋葉子記號 ----
    sc = (0.24, -0.1, 0.27)
    ellipsoid(props, sc, 0.09, 0.08, 0.11, P, C["sack"])
    G.tube(props, [(sc[0], sc[1], sc[2] + 0.1), (sc[0], sc[1], sc[2] + 0.16)], 0.035, 5, C["sack"], taper=1.3)
    G.lathe(props, sc[0], sc[1], 0, [(0.04, sc[2] + 0.095), (0.045, sc[2] + 0.11), (0.04, sc[2] + 0.125)], 6, C["leather_d"])
    Fs = G.frame(sc[0] + 0.088, sc[1], 90, 0)
    for sgn in (-1, 1):
        q = [Fs(0.0, -0.002, sc[2] - 0.035), Fs(sgn * 0.03, -0.002, sc[2]), Fs(0.0, -0.002, sc[2] + 0.045), Fs(sgn * 0.008, -0.002, sc[2])]
        props.face([props.vert(p, C["leaf"]) for p in q], (1, 0, 0))
    # ---- 蛋籃（左腰）：籃子＋兩顆蛋 ----
    bc = (-0.25, 0.02, 0.27)
    G.lathe(props, bc[0], bc[1], 0, [(0.05, bc[2] - 0.05), (0.075, bc[2] - 0.02), (0.085, bc[2] + 0.03), (0.08, bc[2] + 0.035), (0.0, bc[2] - 0.0)], 10 if hq else 6, C["wood"])
    G.tube(props, [(bc[0], bc[1] - 0.08, bc[2] + 0.03), (bc[0], bc[1], bc[2] + 0.13), (bc[0], bc[1] + 0.08, bc[2] + 0.03)], 0.008, 3, C["wood"])
    ellipsoid(props, (bc[0] - 0.025, bc[1] - 0.015, bc[2] + 0.05), 0.032, 0.032, 0.042, P, C["egg1"])
    ellipsoid(props, (bc[0] + 0.03, bc[1] + 0.02, bc[2] + 0.045), 0.03, 0.03, 0.04, P, C["egg2"])

    # ---- 小寵物（獨立網格，原點在腳底）：圓滾滾、長耳朵（藍色耳尖）、捲尾 ----
    ellipsoid(pal, (0, 0, 0.12), 0.12, 0.11, 0.115, P, C["pal"])
    ellipsoid(pal, (0, 0.03, 0.23), 0.095, 0.09, 0.085, P, C["pal"])
    for sx in (-1, 1):
        G.tube(pal, [(sx * 0.05, 0.02, 0.29), (sx * 0.09, 0.0, 0.36)], 0.028, P["tube"], C["pal"], taper=0.8)
        G.tube(pal, [(sx * 0.09, 0.0, 0.36), (sx * 0.13, -0.03, 0.41)], 0.022, P["tube"], C["pal_ear"], taper=0.3)
        disc(pal, sx * 0.035, 0.245, 0.116, 0.014, 0.019, C["eye"], n=8)
        disc(pal, sx * 0.035 - 0.005, 0.252, 0.117, 0.005, 0.006, C["eye_hi"], n=5)
        disc(pal, sx * 0.06, 0.218, 0.105, 0.014, 0.008, C["pal_cheek"], n=6)
        ellipsoid(pal, (sx * 0.06, 0.05, 0.02), 0.035, 0.045, 0.025, P, C["pal"], flat_bottom=True)
    G.tube(pal, [(0, -0.1, 0.1), (0, -0.17, 0.16), (0, -0.16, 0.24), (0, -0.11, 0.25)], 0.03, P["tube"], C["pal_ear"], taper=0.4)
    return {k: v for k, v in (("props", props), ("gold", gold), ("glow", glow), ("pal", pal)) if v.f}


def summarize(mbs):
    per = {k: mb.tris() for k, mb in mbs.items()}
    pts = [v for k, mb in mbs.items() if k != "pal" for v in mb.v]
    pp = [v for v in mbs["pal"].v]
    return per, {
        "height": round(max(p[2] for p in pts), 3),
        "radius": round(max(math.hypot(p[0], p[1]) for p in pts), 3),
        "pal_height": round(max(p[2] for p in pp), 3),
        "pal_radius": round(max(math.hypot(p[0], p[1]) for p in pp), 3),
    }


def main():
    import vp3_kit  # noqa: PLC0415

    t0 = time.time()
    report = {"lods": {}, "budget": BUDGET, "stage": "PetMerchant"}
    log = []
    for lod in ("lite", "hq"):
        vp3_kit.reset()
        mats = {k: G.simple_mat(f"VP3_petmerchant_{k}", (1, 1, 1)) for k in ("props", "gold", "glow", "pal")}
        mbs = build(lod)
        objs = {k: G.to_object(mb, mats[k]) for k, mb in mbs.items()}
        ok = vp3_kit.bake_ao([objs["props"]], samples=16, strength=0.45, log=log)
        per, dims = summarize(mbs)
        path = os.path.join(OUT, f"pet_merchant_{lod}.glb")
        vp3_kit.export_glb(list(objs.values()), path)
        tris = sum(per.values())
        report["lods"][lod] = {"triangles": tris, "by_mesh": per, "meshes": len(objs), "ao_baked": ok, "bytes": os.path.getsize(path), "within_budget": tris <= BUDGET[lod], **dims}
    report["log"] = log
    report["seconds"] = round(time.time() - t0, 1)
    with open(os.path.join(OUT, "pet_merchant_report.json"), "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1))
    if not all(v["within_budget"] for v in report["lods"].values()):
        raise SystemExit("三角面超出預算")


if __name__ == "__main__":
    main()
