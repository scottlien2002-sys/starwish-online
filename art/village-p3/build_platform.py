"""P3-6 星芽村北側高台：擋土牆、四道石階、高台石板鋪面（HQ / Lite）。

blender -b --factory-startup -P build_platform.py -- --out <輸出資料夾>

- 完全沿用 V1.3（layout.ts）：高台方位 281° 經北到 44°、r 23～49、高 +2 m；石階方位 297°、332°、0°、26°，
  r 18 → 23、寬 6 m（遊戲內是線性斜坡，模型做成 10 階，每階 0.2 m，與斜坡誤差 ≤ 0.2 m）
- 不新增任何碰撞：擋土牆正面在 r 23（＝高度差邊界），牆面裝飾最多凸出 12 cm 且在 1 m 以上才有壁燈；
  牆腳花圃（P3-2A，r 22.4～22.98、高 0.2）不受影響；石階模型完全在石階範圍內
- 造型：暖白砌石擋土牆（基腳、壁柱、壓頂石）、每兩跨一個石雕圓章（HQ 金色八芒星）、石階兩側水晶壁燈、
  高台石板鋪面（避開北路，與 P3-2A 道路銜接）＋沿邊金色細線＋各石階頂端金色星形嵌飾、外緣與兩端擋土牆
- 網格：stone（砌石）、paving（石板，共用石灰岩貼圖）、gold（HQ；Lite 畫在石材頂點色）、glow（壁燈水晶）
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

A0, A1, R0, R1, PH = 281.0, 404.0, 23.0, 49.0, 2.0
STAIRS = [297.0, 332.0, 0.0, 26.0]
STAIR_FROM, STAIR_W = 18.0, 6.0
ROAD_HALF, ROAD_END = 3.0, 40.0
BUDGET = {"hq": 10000, "lite": 6000}
GAP = math.degrees(math.asin((STAIR_W / 2) / R0))
LOD = {
    "hq": dict(steps=10, arc_seg=1.1, pave_r=[23.5, 25.0, 27.0, 29.5, 32.0, 35.0, 37.5, 40.0, 42.5, 45.5, 49.0], pave_w=1.9, medal=True, hq=True),
    "lite": dict(steps=10, arc_seg=2.0, pave_r=[23.5, 27.0, 32.0, 36.0, 40.0, 44.5, 49.0], pave_w=3.6, medal=True, hq=False),
}
C = {
    "wall": (0.96, 0.93, 0.87),
    "wall2": (0.93, 0.89, 0.82),
    "trim": (0.99, 0.97, 0.93),
    "plinth": (0.86, 0.80, 0.71),
    "step": (0.95, 0.92, 0.86),
    "riser": (0.90, 0.86, 0.79),
    "pave": (0.96, 0.93, 0.87),
    "pave2": (0.93, 0.89, 0.82),
    "pave3": (0.98, 0.95, 0.90),
    "grout": (0.80, 0.76, 0.70),
    "gold_vc": (0.92, 0.73, 0.33),
    "crystal_top": (0.80, 0.92, 1.0),
    "crystal_mid": (0.52, 0.72, 1.0),
    "crystal_bot": (0.36, 0.46, 0.95),
}


def pol(b, r):
    return G.pol(b, r)


def side_of(s, x, z):
    t = math.radians(s)
    return x * math.cos(t) - z * math.sin(t), x * math.sin(t) + z * math.cos(t)  # (side, along)


def wall_spans():
    """擋土牆的方位區段（扣掉石階缺口）"""
    cuts = sorted(((s if s >= A0 else s + 360) - GAP, (s if s >= A0 else s + 360) + GAP) for s in STAIRS)
    spans, a = [], A0
    for c0, c1 in cuts:
        spans.append((a, c0))
        a = c1
    spans.append((a, A1))
    return spans


def arc_pts(a0, a1, r, step):
    n = max(1, math.ceil(math.radians(a1 - a0) * r / step))
    return [a0 + (a1 - a0) * k / n for k in range(n + 1)]


def band(mb, a0, a1, r, h0, h1, col, step, facing_in=True):
    """直立弧面（facing_in＝朝圓心）"""
    bs = arc_pts(a0, a1, r, step)
    for b0, b1 in zip(bs, bs[1:]):
        q = [(*pol(b0, r), h0), (*pol(b1, r), h0), (*pol(b1, r), h1), (*pol(b0, r), h1)]
        bm = (b0 + b1) / 2
        n = (*pol(bm, -1.0 if facing_in else 1.0), 0.0)
        mb.face([mb.vert(p, col) for p in q], n)


def ring_top(mb, a0, a1, ra, rb, h, col, step):
    bs = arc_pts(a0, a1, rb, step)
    for b0, b1 in zip(bs, bs[1:]):
        q = [(*pol(b0, ra), h), (*pol(b1, ra), h), (*pol(b1, rb), h), (*pol(b0, rb), h)]
        mb.face([mb.vert(p, col) for p in q], G.UP)


def box_on_arc(mb, b, r_in, r_out, half_w, h0, h1, col):
    """以方位 b、半徑 r 為中心的小方塊（徑向深度 r_in～r_out、切向半寬 half_w）"""
    Fr = G.frame(0, 0, b, 0)
    G.box(mb, Fr, -half_w, half_w, r_in, r_out, h0, h1, col)


def star_pts(cx, cz, n, ro, ri, rot):
    return [G.pol(rot + i * 180 / n, ro if i % 2 == 0 else ri, cx, cz) for i in range(2 * n)]


def bipyramid(mb, c, r, up, dn, seg, cols):
    top, mid, bot = cols
    G.lathe(mb, c[0], c[1], c[2], [(0.0, -dn), (r * 0.62, -dn * 0.45), (r, 0.0), (r * 0.7, up * 0.42), (0.0, up)], seg, lambda h: top if h > c[2] + 0.01 else (mid if h > c[2] - dn * 0.5 else bot), smooth=False)


def clip(poly, keep):
    """Sutherland–Hodgman：keep(p)→(inside?, 交點函式)。這裡只用 x 半平面"""
    out = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        ia, ib = keep[0](a), keep[0](b)
        if ia:
            out.append(a)
        if ia != ib:
            out.append(keep[1](a, b))
    return out


def half_plane(axis_val, sign):
    """保留 x*sign ≥ axis_val*sign（北路在方位 0，局部 x＝世界 X）"""
    ins = lambda p: p[0] * sign >= axis_val * sign  # noqa: E731

    def cut(a, b):
        t = (axis_val - a[0]) / (b[0] - a[0])
        return (axis_val, a[1] + (b[1] - a[1]) * t)

    return ins, cut


def build(lod):
    P = LOD[lod]
    hq = P["hq"]
    stone = G.MB("Platform_stone", True)
    pave = G.MB("Platform_paving", True)
    gold = G.MB("Platform_gold", False)
    glow = G.MB("Platform_glow", False)
    gm, gcol = (gold, (1, 1, 1)) if hq else (stone, C["gold_vc"])
    groups = {"wall": [], "deco": [], "stairs": [], "top": []}

    def mark(group, mb, start):
        groups[group].extend(mb.v[start:])

    st = P["arc_seg"]
    # ---- 正面擋土牆（r 23）----
    s0, p0, g0, w0 = len(stone.v), len(pave.v), len(gm.v), len(glow.v)
    for a, b in wall_spans():
        band(stone, a, b, R0 - 0.03, 0.0, 0.34, C["plinth"], st)
        ring_top(stone, a, b, R0 - 0.03, R0, 0.34, C["trim"], st)
        band(stone, a, b, R0, 0.34, 1.86, C["wall"], st)
        band(stone, a, b, R0 - 0.1, 1.86, 2.03, C["trim"], st)
        ring_top(stone, a, b, R0 - 0.1, R0 + 0.45, 2.03, C["trim"], st)
        band(stone, a, b, R0 - 0.1, 1.8, 1.86, C["trim"], st)
        # 兩端收口
        for e, sgn in ((a, -1), (b, 1)):
            t = math.radians(e)
            tan = (math.cos(t) * sgn, -math.sin(t) * sgn, 0.0)
            q = [(*pol(e, R0 - 0.03), 0.0), (*pol(e, R0 + 0.45), 0.0), (*pol(e, R0 + 0.45), 2.03), (*pol(e, R0 - 0.03), 2.03)]
            stone.face([stone.vert(p, C["trim"]) for p in q], tan)
        # 壁柱與圓章（每跨約 3.6 m）
        n = max(1, round(math.radians(b - a) * R0 / 3.6))
        mg = math.degrees(0.45 / R0)
        for k in range(n + 1):
            bb = a + mg + (b - a - 2 * mg) * k / n
            box_on_arc(stone, bb, R0 - 0.12, R0 + 0.01, 0.26, 0.34, 1.8, C["trim"])
            box_on_arc(stone, bb, R0 - 0.16, R0 + 0.01, 0.31, 0.34, 0.5, C["plinth"])
        if P["medal"]:
            for k in range(n):
                if k % 2:
                    continue
                bm = a + (b - a) * (k + 0.5) / n
                Fr = G.frame(*pol(bm, R0 - 0.02), bm + 180, 0)  # −y＝朝圓心（朝廣場）
                ring = [(math.sin(i * math.tau / 12) * 0.36, 1.08 + math.cos(i * math.tau / 12) * 0.36) for i in range(12)]
                ids = [stone.vert(Fr(x, -0.04, h), C["trim"]) for x, h in ring]
                c = stone.vert(Fr(0, -0.06, 1.08), C["trim"])
                for i in range(12):
                    stone.face([c, ids[i], ids[(i + 1) % 12]], G.sub(Fr(0, -1, 0), Fr(0, 0, 0)))
                star = [(math.sin(i * math.pi / 8) * (0.27 if i % 2 == 0 else 0.11), 1.08 + math.cos(i * math.pi / 8) * (0.27 if i % 2 == 0 else 0.11)) for i in range(16)]
                ids = [gm.vert(Fr(x, -0.075, h), gcol) for x, h in star]
                c = gm.vert(Fr(0, -0.08, 1.08), gcol)
                for i in range(16):
                    gm.face([c, ids[i], ids[(i + 1) % 16]], G.sub(Fr(0, -1, 0), Fr(0, 0, 0)))
    # 水晶壁燈（每道石階兩側）
    for s in STAIRS:
        for sg in (-1, 1):
            bb = s + sg * (GAP + 2.4)
            Fr = G.frame(*pol(bb, R0), bb + 180, 0)
            G.box(stone, Fr, -0.14, 0.14, -0.1, 0.0, 1.05, 1.5, C["trim"])
            G.lathe(gm, *Fr(0, -0.24, 0)[:2], 0.0, [(0.03, 1.32), (0.13, 1.38), (0.16, 1.47), (0.0, 1.43)], 8 if hq else 6, gcol)
            G.box(gm, Fr, -0.03, 0.03, -0.24, -0.08, 1.3, 1.36, gcol)
            bipyramid(glow, (*Fr(0, -0.24, 0)[:2], 1.65), 0.1, 0.2, 0.15, 6, (C["crystal_top"], C["crystal_mid"], C["crystal_bot"]))
    mark("wall", stone, s0)
    mark("deco", gm, g0)
    mark("deco", glow, w0)

    # ---- 外緣（r 49）與兩端擋土牆 ----
    s1 = len(stone.v)
    band(stone, A0, A1, R1, 0.0, 2.0, C["wall2"], st * 2.5, facing_in=False)
    band(stone, A0, A1, R1 + 0.08, 1.85, 2.03, C["trim"], st * 2.5, facing_in=False)
    ring_top(stone, A0, A1, R1 - 0.3, R1 + 0.08, 2.03, C["trim"], st * 2.5)
    for e, sgn in ((A0, -1), (A1, 1)):
        t = math.radians(e)
        tan = (math.cos(t) * sgn, -math.sin(t) * sgn, 0.0)
        Fe = G.frame(0, 0, e, 0)
        off = sgn * 0.0
        rs = [R0 + 0.45] + [R0 + 3.0 * k for k in range(1, 9)] + [R1]
        for ra, rb in zip(rs, rs[1:]):
            q = [Fe(off, ra, 0.0), Fe(off, rb, 0.0), Fe(off, rb, 1.86), Fe(off, ra, 1.86)]
            stone.face([stone.vert(p, C["wall"]) for p in q], tan)
        G.box(stone, Fe, -0.25 if sgn > 0 else -0.1, 0.1 if sgn > 0 else 0.25, R0, R1, 1.86, 2.03, C["trim"])
        G.box(stone, Fe, -0.02 if sgn > 0 else -0.02, 0.02, R0, R1, 0.0, 0.34, C["plinth"])
    mark("wall", stone, s1)

    # ---- 石階（10 階，每階 0.5 m 深、0.2 m 高）----
    s2, p2 = len(stone.v), len(pave.v)
    n = P["steps"]
    dl = (R0 - STAIR_FROM) / n
    dh = PH / n
    hw = STAIR_W / 2
    for s in STAIRS:
        Fs = G.frame(0, 0, s, 0)  # x＝側向、y＝沿方位
        for k in range(n):
            a, b = STAIR_FROM + dl * k, STAIR_FROM + dl * (k + 1)
            h1 = dh * (k + 1)
            # 踢面（朝廣場）
            stone.face([stone.vert(Fs(x, a, h), C["riser"]) for x, h in ((-hw, dh * k), (hw, dh * k), (hw, h1), (-hw, h1))], G.sub(Fs(0, -1, 0), Fs(0, 0, 0)))
            # 踏面（石板，前緣一條淺色收邊）
            nose = min(0.09, dl * 0.2)
            pave.face([pave.vert(Fs(x, y, h1), C["step"], uv=(Fs(x, y, 0)[0] / 2, Fs(x, y, 0)[1] / 2)) for x, y in ((-hw, a + nose), (hw, a + nose), (hw, b), (-hw, b))], G.UP)
            stone.face([stone.vert(Fs(x, y, h1), C["trim"]) for x, y in ((-hw, a), (hw, a), (hw, a + nose), (-hw, a + nose))], G.UP)
            # 兩側面
            for sx in (-1, 1):
                q = [Fs(sx * hw, a, 0.0), Fs(sx * hw, b, 0.0), Fs(sx * hw, b, h1), Fs(sx * hw, a, h1)]
                stone.face([stone.vert(p, C["wall2"]) for p in q], G.sub(Fs(sx, 0, 0), Fs(0, 0, 0)))
        # 兩側斜向側石（沿斜坡、只在石階範圍內）
        for sx in (-1, 1):
            xa, xb = sorted((sx * (hw - 0.3), sx * hw))
            for k in range(n):
                a, b = STAIR_FROM + dl * k, STAIR_FROM + dl * (k + 1)
                h1 = dh * (k + 1) + 0.04
                G.box(stone, Fs, xa, xb, a, b, dh * (k + 1), h1, C["trim"])
    mark("stairs", stone, s2)
    mark("stairs", pave, p2)

    # ---- 高台石板鋪面（避開北路），沿邊金線、石階頂星形嵌飾 ----
    p3, g3 = len(pave.v), len(gm.v)
    rs = P["pave_r"]
    rng = 12345
    for ri, (ra, rb) in enumerate(zip(rs, rs[1:])):
        rm = (ra + rb) / 2
        bs = arc_pts(A0, A1, rm, P["pave_w"] * (1.0 + 0.12 * (ri % 2)))
        for k in range(len(bs) - 1):
            b0, b1 = bs[k], bs[k + 1]
            poly = [pol(b0, ra), pol(b1, ra), pol(b1, rb), pol(b0, rb)]
            pieces = [poly]
            # 北路：方位 0、|X| < 3、r < 40 的部分挖掉（圈界剛好在 r 40）
            if rb <= ROAD_END + 1e-6 and min(abs(p[0]) for p in poly) < ROAD_HALF + 3.0:
                pieces = [q for q in (clip(poly, half_plane(-ROAD_HALF, -1)), clip(poly, half_plane(ROAD_HALF, 1))) if len(q) >= 3]
            for q in pieces:
                rng = (rng * 1103515245 + 12345) & 0x7FFFFFFF
                col = (C["pave"], C["pave2"], C["pave3"])[rng % 3]
                cx = sum(p[0] for p in q) / len(q)
                cz = sum(p[1] for p in q) / len(q)
                ins = []
                for x, z in q:
                    dx, dz = cx - x, cz - z
                    d = math.hypot(dx, dz) or 1.0
                    ins.append((x + dx / d * 0.035, z + dz / d * 0.035))
                pave.face([pave.vert((x, z, PH + 0.012), col, uv=(x / 2.0, z / 2.0)) for x, z in ins], G.UP)
    # 灰縫底層（整片）
    for ra, rb in zip(rs, rs[1:]):
        bs = arc_pts(A0, A1, rb, 6.0)
        for b0, b1 in zip(bs, bs[1:]):
            poly = [pol(b0, ra), pol(b1, ra), pol(b1, rb), pol(b0, rb)]
            pieces = [poly]
            if rb <= ROAD_END + 1e-6 and min(abs(p[0]) for p in poly) < ROAD_HALF + 8:
                pieces = [q for q in (clip(poly, half_plane(-ROAD_HALF, -1)), clip(poly, half_plane(ROAD_HALF, 1))) if len(q) >= 3]
            for q in pieces:
                pave.face([pave.vert((x, z, PH + 0.001), C["grout"], uv=(x / 2.0, z / 2.0)) for x, z in q], G.UP)
    # 壓頂石後方到第一圈石板之間（r 23.45～23.5）
    gr = math.degrees(math.asin(ROAD_HALF / rs[0]))
    for a, b in ((A0, 360 - gr), (360 + gr, A1)):
        ring_top(pave, a, b, R0 + 0.45, rs[0], PH + 0.012, C["pave3"], st)
    # 石階頂端平台（r 23～23.5，石階寬度內）
    for s in STAIRS:
        if s == 0.0:
            continue  # 北路從 r 23 開始，已有道路石板
        Fs = G.frame(0, 0, s, 0)
        pave.face([pave.vert(Fs(x, y, PH + 0.012), C["pave3"], uv=(Fs(x, y, 0)[0] / 2, Fs(x, y, 0)[1] / 2)) for x, y in ((-3, R0), (3, R0), (3, R0 + 0.5), (-3, R0 + 0.5))], G.UP)
    mark("top", pave, p3)
    # 金色細線（r 23.75）與石階頂星形嵌飾
    if hq:
        ga = math.degrees(math.asin(ROAD_HALF / 23.75))
        for a, b in ((A0, 360 - ga), (360 + ga, A1)):
            ring_top(gm, a, b, 23.72, 23.78, PH + 0.016, gcol, st)
    for s in STAIRS:
        if s == 0.0:
            continue
        cx, cz = pol(s, 24.05)
        pts = star_pts(cx, cz, 8, 0.62, 0.26, s)
        c = gm.vert((cx, cz, PH + 0.02), gcol)
        ids = [gm.vert((x, z, PH + 0.016), gcol) for x, z in pts]
        for i in range(len(ids)):
            gm.face([c, ids[i], ids[(i + 1) % len(ids)]], G.UP)
    mark("top", gm, g3)
    return {k: v for k, v in (("stone", stone), ("paving", pave), ("gold", gold), ("glow", glow)) if v.f}, groups


def _n(pts):
    n = G.newell(pts)
    L = math.sqrt(sum(x * x for x in n)) or 1.0
    return tuple(x / L for x in n)


def stone_uv(pts, tile=2.4):
    n = _n(pts)
    if abs(n[2]) > 0.7:
        return [(p[0] / tile, p[1] / tile) for p in pts]
    t = (-n[1], n[0])
    L = math.hypot(*t) or 1.0
    t = (t[0] / L, t[1] / L)
    return [((p[0] * t[0] + p[1] * t[1]) / tile, p[2] / tile) for p in pts]


def analyze(groups):
    """碰撞與動線檢查用統計"""
    out = {}
    # 1) 牆與裝飾：高度 0.3 m 以下（牆腳花圃高 0.2、到 r 22.98）不得凸出 r 22.95
    low = [p for p in groups["wall"] + groups["deco"] if p[2] < 0.3 and math.hypot(p[0], p[1]) < R0 + 0.6]
    out["wall_min_r_below_0_3m"] = round(min(math.hypot(p[0], p[1]) for p in low), 3) if low else None
    allw = [p for p in groups["wall"] + groups["deco"] if math.hypot(p[0], p[1]) < R0 + 0.6]
    out["wall_min_r_any"] = round(min(math.hypot(p[0], p[1]) for p in allw), 3)
    # 2) 石階：全部在石階範圍內（側向 ≤ 3、沿方位 18～23）；踏面高度與遊戲斜坡誤差
    worst_side, worst_along, worst_dh = 0.0, 0.0, 0.0
    for p in groups["stairs"]:
        best = None
        for s in STAIRS:
            sd, al = side_of(s, p[0], p[1])
            if abs(sd) <= 3.2 and 17.5 <= al <= 23.5:
                best = (sd, al)
        if best is None:
            worst_side = 99
            continue
        sd, al = best
        worst_side = max(worst_side, abs(sd) - 3.0)
        worst_along = max(worst_along, STAIR_FROM - al, al - R0)
        ramp = PH * (min(max(al, STAIR_FROM), R0) - STAIR_FROM) / (R0 - STAIR_FROM)
        if p[2] > 0.001:
            worst_dh = max(worst_dh, p[2] - ramp)
    out["stairs_side_excess"] = round(worst_side, 4)
    out["stairs_along_excess"] = round(worst_along, 4)
    out["stairs_max_above_ramp"] = round(worst_dh, 3)
    # 3) 高台頂面：鋪面與嵌飾高度 ≤ 2.03；不進入北路
    out["top_max_h"] = round(max(p[2] for p in groups["top"]), 3)
    road = [p for p in groups["top"] if abs(p[0]) < ROAD_HALF - 0.02 and R0 + 0.5 < p[1] < ROAD_END - 0.15 and p[2] > PH + 0.005]  # 道路盡頭是直線、鋪面圈界是圓弧，盡頭兩角允許 15 cm
    out["top_in_north_road"] = len(road)
    return out


def main():
    import vp3_kit  # noqa: PLC0415

    t0 = time.time()
    report = {"lods": {}, "budget": BUDGET, "stage": "P3-6", "layout": {"from": A0, "to": A1 - 360, "r0": R0, "r1": R1, "height": PH, "stairs": STAIRS, "stair_from": STAIR_FROM, "stair_width": STAIR_W}}
    log = []
    for lod in ("lite", "hq"):
        vp3_kit.reset()
        mats = {k: G.simple_mat(f"VP3_platform_{k}", (1, 1, 1)) for k in ("stone", "paving", "gold", "glow")}
        mbs, groups = build(lod)
        objs = {}
        for k, mb in mbs.items():
            objs[k] = G.to_object_uv(mb, mats[k], stone_uv) if k == "stone" else G.to_object(mb, mats[k])
        ok = vp3_kit.bake_ao([objs[k] for k in ("stone",) if k in objs], samples=16, strength=0.5, log=log)
        path = os.path.join(OUT, f"platform_{lod}.glb")
        vp3_kit.export_glb(list(objs.values()), path)
        per = {k: mb.tris() for k, mb in mbs.items()}
        tris = sum(per.values())
        report["lods"][lod] = {"triangles": tris, "by_mesh": per, "meshes": len(objs), "ao_baked": ok, "bytes": os.path.getsize(path), "within_budget": tris <= BUDGET[lod], "checks": analyze(groups)}
    report["log"] = log
    report["seconds"] = round(time.time() - t0, 1)
    with open(os.path.join(OUT, "platform_report.json"), "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1))
    if not all(v["within_budget"] for v in report["lods"].values()):
        raise SystemExit("三角面超出預算")


if __name__ == "__main__":
    main()
