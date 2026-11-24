"""P3-8 四座傳送門＋南門拱門＋道路嵌飾（HQ / Lite）。

blender -b --factory-startup -P build_portals.py -- --out <輸出資料夾>

依 V1.3 既定地圖設計（layout.ts），不新增任何出口：
- 南方傳送門（180°，r 44，地面）＝開放 → 星芽原野；北方（0°，高台 +2 m）、東方（90°）、西方（270°）＝未開放（休眠、低亮度）
- 圓台半徑 4（頂面 6 cm、邊緣斜面，可直接走上去）；4 根石柱在 portalPillars() 位置（圓台外 0.6 m、相對村莊方向 ±50°／±130°），
  2.2 m 以下全在柱子碰撞圓（r 0.45）內；朝村莊的入口留 7 m 寬；後方兩柱之間架拱
- 南門（z −36、x ±4.6）：門柱在碰撞圓（r 0.6）內，橫樑在 6.2 m 以上（不擋鏡頭、不擋人）
- 道路：廣場模型已鋪好路面與路緣（r 17.95→40）；這裡只加貼平的金色星形嵌飾與路端門檻，不改道路配置
網格：Portal_stone / paving / gold / props / glow（開放門的符文與水晶）＋ Portal_fx（南門光柱）＋ Portal_rune（南門漂浮符文環）
fx 與 rune 的頂點以南方傳送門中心為原點（執行時由程式擺位、旋轉）
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

PORTAL_R, PORTAL_DIST = 4.0, 44.0
PORTALS = [
    {"id": "south", "bearing": 180.0, "floor": 0.0, "open": True, "destination": "starsprout"},
    {"id": "north", "bearing": 0.0, "floor": 2.0, "open": False, "destination": None},
    {"id": "east", "bearing": 90.0, "floor": 0.0, "open": False, "destination": None},
    {"id": "west", "bearing": 270.0, "floor": 0.0, "open": False, "destination": None},
]
for p in PORTALS:
    p["x"], p["z"] = G.pol(p["bearing"], PORTAL_DIST)
SOUTH_GATE = {"z": -36.0, "halfW": 4.6, "postR": 0.6}
ROADS, ROAD_HALF, ROAD_END, PLAT_R0, PLAT_H = [0, 90, 180, 270], 3.0, 40.0, 23.0, 2.0
PAVE_TOP = 0.026
DAIS_TOP = 0.06
PILLAR_LIMIT, POST_LIMIT, LOW = 0.42, 0.58, 2.2
BUDGET = {"hq": 22000, "lite": 9000}
C = {
    "dais": (0.93, 0.9, 0.84), "dais_d": (0.8, 0.76, 0.7), "sealed": (0.74, 0.72, 0.76),
    "rune": (0.55, 0.8, 1.0), "rune2": (0.8, 0.62, 1.0), "crystal": (0.62, 0.78, 1.0), "crystal_tip": (0.9, 0.95, 1.0),
    "dim": (0.6, 0.58, 0.7), "dim_d": (0.46, 0.44, 0.56), "blue": (0.32, 0.46, 0.78),
}


def pillars(p):
    inward = (p["bearing"] + 180) % 360
    return [G.pol(inward + d, PORTAL_R + 0.6, p["x"], p["z"]) for d in (50, -50, 130, -130)]


def dais(stone, paving, gm, gcol, glow, props, p, hq):
    """圓台：外圈斜面石環＋內圈石板＋金環＋八芒星符文（開放＝發光；未開放＝灰紫）"""
    cx, cz, h0 = p["x"], p["z"], p["floor"]
    n = 48 if hq else 28
    G.lathe(stone, cx, cz, h0, [(PORTAL_R, 0.0), (PORTAL_R - 0.12, DAIS_TOP), (3.3, DAIS_TOP), (0.0, DAIS_TOP)], n, C["dais_d"] if p["open"] else C["sealed"], smooth=False)
    A.flat_ring(paving, cx, cz, h0 + DAIS_TOP + 0.002, 0.0 + 0.6, 3.3, C["dais"], n)
    A.flat_disc(paving, cx, cz, h0 + DAIS_TOP + 0.002, 0.6, C["dais"], 16 if hq else 10)
    A.flat_ring(gm, cx, cz, h0 + DAIS_TOP + 0.004, 3.3, 3.42, gcol, n)
    A.flat_ring(gm, cx, cz, h0 + DAIS_TOP + 0.004, 2.55, 2.62, gcol, n)
    lit = glow if p["open"] else props
    c1, c2 = (C["rune"], C["rune2"]) if p["open"] else (C["dim"], C["dim_d"])
    G.flat_star(lit, cx, cz, h0 + DAIS_TOP + 0.005, 8, [2.45, 1.6], 0.75, c1, c2, rot=p["bearing"])
    A.flat_disc(gm, cx, cz, h0 + DAIS_TOP + 0.02, 0.3, gcol, 12 if hq else 8)
    # 外環符文刻點（16 個菱形）
    for k in range(16 if hq else 8):
        b = k * (22.5 if hq else 45) + 11.25
        x, z = G.pol(b, 2.95, cx, cz)
        Fd = G.frame(x, z, b, h0)
        q = [lit.vert(Fd(dx, dy, DAIS_TOP + 0.006), c1 if k % 2 else c2) for dx, dy in ((0, -0.16), (0.08, 0), (0, 0.16), (-0.08, 0))]
        lit.face(q, G.UP)


def pillar(stone, gm, gcol, glow, props, x, z, h0, open_, hq):
    seg = 8 if hq else 6
    # 2.2 m 以下半徑 ≤ 0.4（碰撞圓 0.45）
    G.lathe(stone, x, z, h0, [(0.4, 0.0), (0.4, 0.22), (0.34, 0.3), (0.3, 0.36), (0.27, 2.55), (0.33, 2.7), (0.36, 2.86), (0.0, 2.86)], seg, A.WALL, smooth=False)
    if hq:
        for h in (0.42, 1.5, 2.5):
            G.lathe(gm, x, z, h0, [(0.285, h), (0.3, h + 0.03), (0.285, h + 0.06)], seg, gcol)
    A.bipyramid(glow if open_ else props, (x, z, h0 + 3.18), 0.2, 0.42, 0.3, 6 if hq else 4,
                (C["crystal_tip"], C["crystal"], C["rune2"]) if open_ else (C["dim"], C["dim"], C["dim_d"]))
    G.lathe(gm, x, z, h0, [(0.24, 2.86), (0.26, 2.92), (0.16, 2.98), (0.0, 2.98)], seg, gcol)


def back_arch(stone, gm, gcol, glow, props, p, hq):
    """後方兩柱之間的拱（柱頂 2.86 → 拱頂 4.7），拱心金星（開放＝發光）"""
    inward = (p["bearing"] + 180) % 360
    a, b = G.pol(inward + 130, PORTAL_R + 0.6, p["x"], p["z"]), G.pol(inward - 130, PORTAL_R + 0.6, p["x"], p["z"])
    mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    half = math.hypot(a[0] - b[0], a[1] - b[1]) / 2
    Fa = G.frame(mx, mz, p["bearing"], p["floor"])  # x 沿拱、y 往外（離村）、−y 面向村莊
    seg = 14 if hq else 7
    rise = 1.85
    outer, inner = [], []
    for k in range(seg + 1):
        t = math.pi * k / seg
        outer.append((-math.cos(t) * (half + 0.22), 2.78 + math.sin(t) * (rise + 0.3)))
        inner.append((-math.cos(t) * (half - 0.22), 2.78 + math.sin(t) * (rise - 0.12)))
    for k in range(seg):
        quad = [outer[k], outer[k + 1], inner[k + 1], inner[k]]
        A.vextrude(stone, Fa, quad, -0.22, 0.44, A.WALL)
    mid = [((o[0] + i[0]) / 2, (o[1] + i[1]) / 2) for o, i in zip(outer, inner)]
    G.tube(gm, [Fa(x, -0.25, h) for x, h in mid], 0.04, 5 if hq else 3, gcol)
    G.tube(gm, [Fa(x, 0.25, h) for x, h in mid], 0.04, 5 if hq else 3, gcol)
    top = 2.78 + rise + 0.1
    A.vextrude(stone, Fa, [(-0.32, top - 0.3), (0.32, top - 0.3), (0.38, top + 0.25), (0.0, top + 0.5), (-0.38, top + 0.25)], -0.26, 0.52, A.TRIM)
    star = A.star_outline(0, top + 0.1, 4 if not p["open"] else 8, 0.3, 0.12)
    mb = glow if p["open"] else gm
    A.vpoly(mb, Fa, star, -0.28, C["crystal_tip"] if p["open"] else gcol, -1)
    A.vpoly(mb, Fa, star, 0.28, C["crystal_tip"] if p["open"] else gcol, 1)
    if not p["open"]:  # 未開放：拱下橫掛金色封印環（高 3.4 m 以上，不擋人）
        A.vpoly(props, Fa, A.circle(0, 3.9, 0.5, 16 if hq else 10), -0.02, C["dim_d"], -1)
        A.vpoly(gm, Fa, A.circle(0, 3.9, 0.36, 16 if hq else 10), -0.03, gcol, -1)
        A.vpoly(props, Fa, A.circle(0, 3.9, 0.24, 16 if hq else 10), -0.035, C["dim"], -1)
        for sx in (-1, 1):
            G.tube(gm, [Fa(sx * 0.48, -0.02, 3.95), Fa(sx * (half - 0.25), -0.02, 2.95 + 0.9)], 0.015, 3, gcol)


def south_gate(stone, gm, gcol, glow, hq):
    z, hw = SOUTH_GATE["z"], SOUTH_GATE["halfW"]
    seg = 10 if hq else 6
    for sx in (-1, 1):
        x = sx * hw
        G.lathe(stone, x, z, 0.0, [(0.56, 0.0), (0.56, 0.4), (0.48, 0.5), (0.42, 0.58), (0.38, 5.5), (0.48, 5.65), (0.52, 5.85), (0.0, 5.85)], seg, A.WALL, smooth=False)
        if hq:
            for h in (0.62, 2.0, 5.4):
                G.lathe(gm, x, z, 0.0, [(0.395, h), (0.41, h + 0.04), (0.395, h + 0.08)], seg, gcol)
        G.lathe(glow, x, z, 0.0, [(0.0, 5.85), (0.18, 5.95), (0.16, 6.15), (0.0, 6.3)], 8 if hq else 6, (1.0, 0.86, 0.55))
    F = G.frame(0, z, 180, 0.0)  # x 沿門（往西＝+x? 由 frame 決定）、−y 朝外（南）
    # 橫樑（6.25～7.0 m）＋中央拱形冠＋金星
    G.box(stone, F, -hw - 0.6, hw + 0.6, -0.42, 0.42, 6.25, 6.7, A.WALL)
    G.box(stone, F, -hw - 0.7, hw + 0.7, -0.48, 0.48, 6.7, 6.85, A.TRIM)
    crown = [(-2.2, 6.85)] + [(-math.cos(math.pi * k / 10) * 2.2, 6.85 + math.sin(math.pi * k / 10) * 1.1) for k in range(1, 10)] + [(2.2, 6.85)]
    A.vextrude(stone, F, crown, -0.3, 0.6, A.WALL)
    for fy in (-1, 1):
        A.vpoly(gm, F, A.star_outline(0, 7.35, 8, 0.48, 0.2), 0.31 * fy, gcol, fy)
        A.vpoly(glow, F, A.circle(0, 7.35, 0.16, 10), 0.315 * fy, (0.75, 0.88, 1.0), fy)
        G.box(gm, F, -hw - 0.6, hw + 0.6, 0.43 * fy - 0.01, 0.43 * fy + 0.01, 6.5, 6.56, gcol)
    # 橫樑下的拱形托架（6.25 m 以下只到 5.85＝柱頂，不擋人）
    for sx in (-1, 1):
        A.vextrude(stone, F, [(sx * hw, 5.85), (sx * (hw - 0.9), 6.25), (sx * hw, 6.25)], -0.25, 0.5, A.TRIM)


def road_inlays(gm, gcol, paving, hq):
    """道路中線嵌金星（每 5 m，貼平），r 39.4 門檻金條；北路在高台上"""
    gd = (0.78, 0.6, 0.27)
    for b in ROADS:
        h0 = PLAT_H if b == 0 else 0.0
        y0 = PLAT_R0 + 2.0 if b == 0 else 21.0
        y = y0
        while y <= 37.0:
            x, z = G.pol(b, y)
            G.flat_star(gm, x, z, h0 + PAVE_TOP + 0.004, 4, [0.32, 0.22], 0.1, gcol, gd, rot=b)
            if hq:
                A.flat_ring(paving, x, z, h0 + PAVE_TOP + 0.003, 0.36, 0.42, C["blue"], 12)
            y += 4.0 if hq else 8.0
        Fb = G.frame(0, 0, b, h0)
        q = [gm.vert(Fb(x, yy, PAVE_TOP + 0.004), gcol) for x, yy in ((-2.6, 39.45), (2.6, 39.45), (2.6, 39.6), (-2.6, 39.6))]
        gm.face(q, G.UP)


def fx_meshes(fx, rune, hq):
    """南門光柱（加色混合：頂點色由亮到黑＝淡出）與漂浮符文環；頂點以門中心為原點"""
    n = 14 if hq else 8
    for k in range(n):
        b0 = k * 360 / n + (7 if k % 2 else 0)
        w = 9 if k % 3 else 14
        r = 3.0 if k % 2 else 2.6
        hgt = 4.6 if k % 3 else 6.0
        a, c = G.pol(b0, r), G.pol(b0 + w, r)
        bot, top = (0.55, 0.75, 1.0), (0.0, 0.0, 0.0)
        mid = (0.42, 0.36, 0.75)
        rows = [(0.08, bot), (hgt * 0.45, mid), (hgt, top)]
        for (h1, c1), (h2, c2) in zip(rows, rows[1:]):
            q = [fx.vert((a[0], a[1], h1), c1), fx.vert((c[0], c[1], h1), c1), fx.vert((c[0], c[1], h2), c2), fx.vert((a[0], a[1], h2), c2)]
            fx.face(q, G.sub((a[0] + c[0], a[1] + c[1], 0), (0, 0, 0)))
    m = 48 if hq else 24
    A.flat_ring(rune, 0, 0, 0.3, 3.05, 3.2, (0.6, 0.85, 1.0), m)
    A.flat_ring(rune, 0, 0, 0.3, 2.1, 2.16, (0.8, 0.62, 1.0), m)
    for k in range(12 if hq else 6):
        b = k * (30 if hq else 60)
        x, z = G.pol(b, 2.62)
        Fd = G.frame(x, z, b, 0.3)
        A.flat_poly(rune, [Fd(-0.14, -0.14, 0)[:2], Fd(0.14, -0.14, 0)[:2], Fd(0.0, 0.2, 0)[:2]], 0.3, (0.7, 0.8, 1.0) if k % 2 else (0.85, 0.7, 1.0))


def build(lod):
    hq = lod == "hq"
    keys = ("stone", "paving", "gold", "props", "glow", "fx", "rune")
    mbs = {k: G.MB(f"Portal_{k}", k in ("stone", "paving")) for k in keys}
    stone, paving, gold, props, glow, fx, rune = (mbs[k] for k in keys)
    gm, gcol = (gold, (1, 1, 1)) if hq else (props, A.GOLD_VC)
    for p in PORTALS:
        dais(stone, paving, gm, gcol, glow, props, p, hq)
        for x, z in pillars(p):
            pillar(stone, gm, gcol, glow, props, x, z, p["floor"], p["open"], hq)
        back_arch(stone, gm, gcol, glow, props, p, hq)
    south_gate(stone, gm, gcol, glow, hq)
    road_inlays(gm, gcol, paving, hq)
    fx_meshes(fx, rune, hq)
    return {k: v for k, v in mbs.items() if v.f}


def extra(mbs):
    """驗收：柱子與門柱 2.2 m 以下的頂點都在碰撞圓內；圓台頂面高度；嵌飾貼平"""
    static = [v for k, mb in mbs.items() if k not in ("fx", "rune") for v in mb.v]
    pil = [(x, z, p["floor"]) for p in PORTALS for x, z in pillars(p)]
    worst_pillar = 0.0
    worst_post = 0.0
    dais_max = {}
    for v in static:
        for x, z, h0 in pil:
            d = math.hypot(v[0] - x, v[1] - z)
            if d < 0.6 and h0 - 0.01 <= v[2] <= h0 + LOW:
                worst_pillar = max(worst_pillar, d)
        for sx in (-1, 1):
            d = math.hypot(v[0] - sx * SOUTH_GATE["halfW"], v[1] - SOUTH_GATE["z"])
            if d < 0.9 and v[2] <= LOW:
                worst_post = max(worst_post, d)
    for p in PORTALS:
        hs = [v[2] - p["floor"] for v in static if math.hypot(v[0] - p["x"], v[1] - p["z"]) < PORTAL_R - 0.05]
        dais_max[p["id"]] = round(max(h for h in hs if h < 0.3), 4)
    # 4.0 m 半徑內、2.2 m 以下、不屬於圓台的頂點（不得有擋路物）
    blockers = 0
    for p in PORTALS:
        for v in static:
            if math.hypot(v[0] - p["x"], v[1] - p["z"]) < PORTAL_R - 0.05 and 0.12 + p["floor"] < v[2] < p["floor"] + LOW:
                blockers += 1
    road_h = [v[2] for v in mbs["gold"].v] if "gold" in mbs else []
    return {
        "portals": [{"id": p["id"], "bearing": p["bearing"], "x": round(p["x"], 3), "z": round(p["z"], 3), "floor": p["floor"], "open": p["open"], "destination": p["destination"], "pillars": [[round(x, 3), round(z, 3)] for x, z in pillars(p)]} for p in PORTALS],
        "pillar_max_r_below_2_2": round(worst_pillar, 4), "gate_post_max_r_below_2_2": round(worst_post, 4),
        "dais_top": dais_max, "dais_blockers": blockers,
        "fx_tris": mbs["fx"].tris() if "fx" in mbs else 0, "rune_tris": mbs["rune"].tris() if "rune" in mbs else 0,
        "gold_min_h": round(min(road_h), 4) if road_h else None,
    }


def main():
    A.export_lods("portals", build, BUDGET, OUT, {"stone": lambda pts: [(p[0] / 2.4 + p[2] / 2.4, p[1] / 2.4 + p[2] / 2.4) for p in pts], "paving": lambda pts: [(p[0] / 2.0, p[1] / 2.0) for p in pts]},
                  {"portal_r": PORTAL_R, "dist": PORTAL_DIST, "south_gate": SOUTH_GATE, "fx_origin": [PORTALS[0]["x"], PORTALS[0]["z"]], "roads": ROADS}, extra=extra, ao_keys=("stone",))


if __name__ == "__main__":
    main()
