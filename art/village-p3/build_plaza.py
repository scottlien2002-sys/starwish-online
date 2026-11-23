"""P3-2A 星芽村中央廣場：石板廣場、環形拼花、四向道路銜接、長椅、水晶燈座、路燈、旗幟、花圃與少量裝飾。

blender -b --factory-startup -P build_plaza.py -- --tex <貼圖資料夾> --out <輸出資料夾>

- 所有位置取自 V1.3（src/maps/village/layout.ts）；不新增碰撞：長椅、水晶燈座、路燈與既有碰撞圓同位置，
  旗幟與吊籃掛在路燈上，花圃是低矮（≤ 0.2 m）的地面裝飾，避開道路、石階、NPC、出生點（shoot.mjs 會自動比對）
- 座標：先用「村莊平面座標」(X 東, Z 北, H 高) 建模，輸出時轉成 Blender (−X, −Z, H)，
  匯入 Babylon 後正好回到村莊座標（glTF 轉換＝繞 Y 轉 180°）
- 網格依材質合併：paving（石板，石紋貼圖 × 頂點色）、gold（HQ）、props（頂點色：石、木、鐵、花草）、
  glass（不受光的燈罩與水晶）、banner（HQ 旗幟貼圖）、contact（Lite 接地陰影）
"""

import json
import math
import os
import random
import sys
import time

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
args = dict(zip(argv[::2], argv[1::2]))
OUT = os.path.abspath(args.get("--out", "out"))
TEX = os.path.abspath(args.get("--tex", os.path.join(OUT, "textures")))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vp3_kit  # noqa: E402

# ---------------- V1.3 數值（與 layout.ts 一致） ----------------
FOUNTAIN_R = 7.0
BENCH_R, BENCH_B = 8.4, [22.5 + 45 * i for i in range(8)]
CLAMP_R, CLAMP_B = 9.5, [45, 135, 225, 315]
LAMP_R, LAMP_B = 18.6, [45, 75, 112, 140, 205, 225, 255, 285, 315]
ROADS, ROAD_HALF, ROAD_END = [0, 90, 180, 270], 3.0, 40.0
STAIRS, STAIR_HALF, STAIR_FROM = [297, 332, 0, 26], 3.0, 18.0
PLAT_R0, PLAT_H, PLAT_FROM, PLAT_TO = 23.0, 2.0, 281, 44
SPAWN = (0.0, -12.5)
COMPASS = (0.0, -14.55, 2.2)  # 中心 X, Z, 半徑；創角出生點站在羅盤北尖
PAVE_TOP, BASE_Z = 0.03, 0.006
BUDGET = {"hq": {"paving": 11000, "props": 14000, "total": 27000}, "lite": {"paving": 5000, "props": 6000, "total": 13000}}

LOD = {
    "hq": dict(ring=128, slabL=1.45, bevel=True, lathe=16, lathe_s=8, tube=6, flower=1.0, basket=True, doves=True, banner_tex=True),
    "lite": dict(ring=64, slabL=1.45, bevel=False, lathe=8, lathe_s=6, tube=4, flower=0.4, basket=False, doves=False, banner_tex=False),
}


def srgb_lin(c):
    return tuple(((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c)


def pol(b, r, cx=0.0, cz=0.0):
    t = math.radians(b)
    return (cx + math.sin(t) * r, cz + math.cos(t) * r)


def frame(cx, cz, b, h0=0.0):
    """區域座標 (lx 右, ly 前, lh 上) → 平面座標；b＝前方的方位角"""
    t = math.radians(b)
    c, s = math.cos(t), math.sin(t)
    return lambda lx, ly, lh: (cx + lx * c + ly * s, cz - lx * s + ly * c, h0 + lh)


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def newell(pts):
    n = [0.0, 0.0, 0.0]
    for i in range(len(pts)):
        x1, z1, h1 = pts[i]
        x2, z2, h2 = pts[(i + 1) % len(pts)]
        # (X, Z, H) 為右手座標
        n[0] += (z1 - z2) * (h1 + h2)
        n[1] += (h1 - h2) * (x1 + x2)
        n[2] += (x1 - x2) * (z1 + z2)
    return n


class MB:
    """依材質累積的網格（平面座標）"""

    def __init__(self, name, linear):
        self.name, self.linear = name, linear
        self.v, self.c, self.uv, self.f, self.sm = [], [], [], [], []

    def vert(self, p, col, uv=None, a=1.0):
        rgb = srgb_lin(col) if self.linear else col
        self.v.append(p)
        self.c.append((*rgb, a))
        self.uv.append(uv if uv is not None else (p[0] / 2.0, p[1] / 2.0))
        return len(self.v) - 1

    def face(self, idx, want, smooth=False):
        pts = [self.v[i] for i in idx]
        n = newell(pts)
        if n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0:
            idx = list(reversed(idx))
        self.f.append(tuple(idx))
        self.sm.append(smooth)

    def tris(self):
        return sum(len(f) - 2 for f in self.f)


UP, DOWN = (0, 0, 1), (0, 0, -1)


def centroid(pts):
    n = len(pts)
    return (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n, sum(p[2] for p in pts) / n)


# ---------------- 基本形狀 ----------------
def box(mb, F, x0, x1, y0, y1, h0, h1, col, bottom=False):
    P = [F(x, y, h) for h in (h0, h1) for y in (y0, y1) for x in (x0, x1)]
    ids = [mb.vert(p, col) for p in P]
    c = F((x0 + x1) / 2, (y0 + y1) / 2, (h0 + h1) / 2)
    faces = [(4, 5, 7, 6), (0, 1, 5, 4), (2, 3, 7, 6), (0, 2, 6, 4), (1, 3, 7, 5)]
    if bottom:
        faces.append((0, 1, 3, 2))
    for q in faces:
        idx = [ids[i] for i in q]
        mb.face(idx, sub(centroid([mb.v[i] for i in idx]), c))


def lathe(mb, cx, cz, h0, prof, seg, col, phase=0.0, smooth=True, bottom=False):
    """prof：[(r, h), ...] 由外側底部往上；col 可為 rgb 或 fn(h)"""
    cf = col if callable(col) else (lambda h, c=col: c)
    rings = []
    for r, h in prof:
        if r <= 1e-6:
            rings.append([mb.vert((cx, cz, h0 + h), cf(h))])
        else:
            rings.append([mb.vert((cx + math.sin(phase + k * math.tau / seg) * r, cz + math.cos(phase + k * math.tau / seg) * r, h0 + h), cf(h)) for k in range(seg)])
    for (ra, ha), (rb, hb), A, B in zip(prof, prof[1:], rings, rings[1:]):
        nr, nh = (hb - ha), -(rb - ra)
        for k in range(seg):
            k2 = (k + 1) % seg
            a = math.tau * (k + 0.5) / seg + phase
            want = (math.sin(a) * nr, math.cos(a) * nr, nh)
            if len(A) == 1 and len(B) == 1:
                continue
            if len(A) == 1:
                mb.face([A[0], B[k], B[k2]], want, smooth)
            elif len(B) == 1:
                mb.face([A[k], A[k2], B[0]], want, smooth)
            else:
                mb.face([A[k], A[k2], B[k2], B[k]], want, smooth)
    if bottom and prof[0][0] > 0:
        c = mb.vert((cx, cz, h0 + prof[0][1]), cf(prof[0][1]))
        A = rings[0]
        for k in range(seg):
            mb.face([A[k], A[(k + 1) % seg], c], DOWN)


def tube(mb, pts, radius, sides, col, taper=1.0):
    rings = []
    n = len(pts)
    for k, p in enumerate(pts):
        a, b = pts[max(k - 1, 0)], pts[min(k + 1, n - 1)]
        t = sub(b, a)
        L = math.sqrt(sum(x * x for x in t)) or 1.0
        t = tuple(x / L for x in t)
        up = (0, 0, 1) if abs(t[2]) < 0.9 else (1, 0, 0)
        u = (t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0])
        lu = math.sqrt(sum(x * x for x in u))
        u = tuple(x / lu for x in u)
        v = (t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0])
        rr = radius * (1 + (taper - 1) * k / max(n - 1, 1))
        rings.append(([mb.vert(tuple(p[i] + (u[i] * math.cos(q * math.tau / sides) + v[i] * math.sin(q * math.tau / sides)) * rr for i in range(3)), col) for q in range(sides)], p))
    for (A, pa), (B, pb) in zip(rings, rings[1:]):
        for q in range(sides):
            q2 = (q + 1) % sides
            idx = [A[q], A[q2], B[q2], B[q]]
            mid = centroid([pa, pb])
            mb.face(idx, sub(centroid([mb.v[i] for i in idx]), mid), True)
    for (R, p), sgn in ((rings[0], -1), (rings[-1], 1)):
        c = mb.vert(p, col)
        d = sub(rings[-1][1], rings[0][1])
        for q in range(sides):
            mb.face([R[q], R[(q + 1) % sides], c], tuple(x * sgn for x in d))


def blob(mb, c, rx, rz, rh, col):
    """壓扁八面體（葉叢、鴿子身體）"""
    P = [(c[0] + rx, c[1], c[2]), (c[0] - rx, c[1], c[2]), (c[0], c[1] + rz, c[2]), (c[0], c[1] - rz, c[2]), (c[0], c[1], c[2] + rh), (c[0], c[1], c[2] - rh * 0.4)]
    ids = [mb.vert(p, col) for p in P]
    for a, b in ((0, 2), (2, 1), (1, 3), (3, 0)):
        for t in (4, 5):
            idx = [ids[a], ids[b], ids[t]]
            mb.face(idx, sub(centroid([mb.v[i] for i in idx]), c), True)


def flower(mb, c, size, col, center_col, rot):
    ids_c = mb.vert((c[0], c[1], c[2] + size * 0.25), center_col)
    ring = []
    for i in range(10):
        a = rot + i * math.pi / 5
        r = size if i % 2 == 0 else size * 0.42
        ring.append(mb.vert((c[0] + math.sin(a) * r, c[1] + math.cos(a) * r, c[2]), col))
    for i in range(10):
        mb.face([ids_c, ring[i], ring[(i + 1) % 10]], UP)


def flat_star(mb, cx, cz, h, n, r_out, r_in, col_a, col_b, rot=0.0, ridge=0.012):
    """地面嵌金星（每個尖角分亮暗兩面，像切割金屬）"""
    c = mb.vert((cx, cz, h + ridge), col_a)
    pts = []
    for i in range(n * 2):
        b = rot + i * 180 / n
        r = r_out[i // 2 % len(r_out)] if i % 2 == 0 else r_in
        x, z = pol(b, r, cx, cz)
        pts.append(mb.vert((x, z, h), col_a))
    for i in range(n * 2):
        mb.face([c, pts[i], pts[(i + 1) % (n * 2)]], UP)
    # 交錯明暗：把一半三角形的頂點色換暗（複製頂點避免影響相鄰面）
    for k in range(len(mb.f) - n * 2, len(mb.f)):
        if (k % 2) == 1:
            f = mb.f[k]
            new = [mb.vert(mb.v[i], col_b) for i in f]
            mb.f[k] = tuple(new)


def arc_box(mb, ra, rb, a0, a1, h0, h1, col, seg_len=0.8, cx=0.0, cz=0.0, ends=True):
    seg = max(1, math.ceil(math.radians(abs(a1 - a0)) * rb / seg_len))
    cols = []
    for k in range(seg + 1):
        b = a0 + (a1 - a0) * k / seg
        cols.append([mb.vert((*pol(b, r, cx, cz), h), col) for r, h in ((ra, h0), (ra, h1), (rb, h1), (rb, h0))])
    for k in range(seg):
        A, B = cols[k], cols[k + 1]
        bm = a0 + (a1 - a0) * (k + 0.5) / seg
        out = (*pol(bm, 1.0), 0.0)
        mb.face([A[1], B[1], B[2], A[2]], UP)
        mb.face([A[0], B[0], B[1], A[1]], tuple(-x for x in out))
        mb.face([A[3], B[3], B[2], A[2]], out)
    if ends:
        for A, b, sgn in ((cols[0], a0, -1), (cols[-1], a1, 1)):
            t = math.radians(b)
            tan = (math.cos(t) * sgn * (1 if a1 > a0 else -1), -math.sin(t) * sgn * (1 if a1 > a0 else -1), 0.0)
            mb.face([A[0], A[1], A[2], A[3]], tan)


def slab_quad(mb, corners, top, foot, inset, col, bevel, uvscale=2.0):
    """石板：corners 為地面四角（平面 X,Z）；上表面內縮，HQ 有斜邊（縫隙露出底層灰縫）"""
    cx = sum(p[0] for p in corners) / 4
    cz = sum(p[1] for p in corners) / 4
    T = []
    for x, z in corners:
        dx, dz = cx - x, cz - z
        L = math.hypot(dx, dz) or 1.0
        T.append((x + dx / L * inset * 1.41, z + dz / L * inset * 1.41, top))
    tids = [mb.vert(p, col, (p[0] / uvscale, p[1] / uvscale)) for p in T]
    mb.face(tids, UP)
    if bevel:
        fids = [mb.vert((x, z, foot), col, (x / uvscale, z / uvscale)) for x, z in corners]
        ctr = (cx, cz, foot - 0.2)
        for i in range(4):
            j = (i + 1) % 4
            idx = [tids[i], tids[j], fids[j], fids[i]]
            mb.face(idx, sub(centroid([mb.v[k] for k in idx]), ctr))


# ---------------- 廣場地面 ----------------
PAL = {
    "warm": (0.96, 0.93, 0.87),
    "cream": (0.98, 0.96, 0.91),
    "beige": (0.94, 0.89, 0.81),
    "band": (0.91, 0.85, 0.75),
    "curb": (0.87, 0.81, 0.71),
    "grout": (0.77, 0.71, 0.62),
    "road": (0.94, 0.90, 0.82),
    "road2": (0.91, 0.86, 0.77),
    "blue": (0.58, 0.71, 0.87),
    "white": (0.98, 0.97, 0.94),
    "gold": (0.93, 0.74, 0.34),
    "gold_d": (0.78, 0.58, 0.22),
}


def jit(col, rng, a=0.018):
    d = (rng.random() - 0.5) * 2 * a
    return tuple(min(1.0, max(0.0, x + d)) for x in col)


def build_paving(P, rng, pave, gold, meta):
    lite = not P["bevel"]
    gm = pave if lite else gold  # Lite：金色嵌條直接畫在石板網格上
    gcol = PAL["gold"] if lite else (1, 1, 1)
    gcol_d = PAL["gold_d"] if lite else (0.82, 0.82, 0.82)
    # 底層灰縫（石板縫隙露出）
    seg = P["ring"]
    for r0, r1 in ((6.9, 18.45),):
        A = [pave.vert((*pol(k * 360 / seg, r0), BASE_Z), PAL["grout"]) for k in range(seg)]
        B = [pave.vert((*pol(k * 360 / seg, r1), BASE_Z), PAL["grout"]) for k in range(seg)]
        for k in range(seg):
            pave.face([A[k], A[(k + 1) % seg], B[(k + 1) % seg], B[k]], UP)
    inset = 0.025

    def ring_rows(edges, tone, bond):
        for ri, (ra, rb) in enumerate(zip(edges, edges[1:])):
            rm = (ra + rb) / 2
            n = max(16, round(math.tau * rm / P["slabL"] / 16) * 16)
            off = (180 / n) if (bond and ri % 2) else 0.0
            for k in range(n):
                a0, a1 = off + k * 360 / n, off + (k + 1) * 360 / n
                col = jit(tone(ri, (a0 + a1) / 2), rng)
                corners = [pol(a0, ra), pol(a1, ra), pol(a1, rb), pol(a0, rb)]
                slab_quad(pave, corners, PAVE_TOP, BASE_Z, inset, col, P["bevel"])

    # 噴泉步道：4 圈錯縫
    ring_rows([7.0, 7.95, 8.9, 9.85, 10.8], lambda ri, a: PAL["cream"] if ri % 2 else PAL["warm"], True)
    # 步道外緣金色細環（r 10.8～11.1）
    A = [gm.vert((*pol(k * 360 / seg, 10.82), PAVE_TOP + 0.003), gcol) for k in range(seg)]
    B = [gm.vert((*pol(k * 360 / seg, 11.08), PAVE_TOP + 0.003), gcol) for k in range(seg)]
    for k in range(seg):
        gm.face([A[k], A[(k + 1) % seg], B[(k + 1) % seg], B[k]], UP)
    # 環形廣場：8 圈，16 個扇區交錯暖白／奶油色，第 1、5、8 圈為米色帶（拼花）
    def plaza_tone(ri, a):
        if ri in (0, 4, 7):
            return PAL["band"]
        return PAL["warm"] if int(((a + 11.25) % 360) // 22.5) % 2 == 0 else PAL["beige"]

    ring_rows([11.1, 11.95, 12.8, 13.65, 14.5, 15.35, 16.2, 17.05, 17.9], plaza_tone, False)
    # 16 道放射金線（沿石板縫，r 11.1～17.9）
    for k in range(16):
        b = k * 22.5
        Fk = frame(0, 0, b)
        if lite:
            q = [gm.vert(Fk(x, y, PAVE_TOP + 0.002), gcol) for x, y in ((-0.035, 11.1), (0.035, 11.1), (0.035, 17.9), (-0.035, 17.9))]
            gm.face(q, UP)
        else:
            box(gm, Fk, -0.04, 0.04, 11.1, 17.9, BASE_Z, PAVE_TOP + 0.002, gcol)
    # 外緣路緣石（r 17.9～18.4）
    n = 96 if P["bevel"] else 64
    for k in range(n):
        a0, a1 = k * 360 / n, (k + 1) * 360 / n
        slab_quad(pave, [pol(a0, 17.92), pol(a1, 17.92), pol(a1, 18.4), pol(a0, 18.4)], PAVE_TOP + 0.005, BASE_Z, 0.02, jit(PAL["curb"], rng, 0.012), P["bevel"])
    # 南側羅盤徽（創角出生點站在北尖）
    cx, cz, R = COMPASS
    sg = 48 if P["bevel"] else 24
    for r0, r1, h, col in ((R, R + 0.25, PAVE_TOP + 0.004, PAL["curb"]), (0.0, R, PAVE_TOP + 0.006, PAL["blue"])):
        Bv = [pave.vert((*pol(k * 360 / sg, r1, cx, cz), h), col) for k in range(sg)]
        if r0 <= 0:
            c = pave.vert((cx, cz, h), col)
            for k in range(sg):
                pave.face([c, Bv[k], Bv[(k + 1) % sg]], UP)
        else:
            Av = [pave.vert((*pol(k * 360 / sg, r0, cx, cz), h), col) for k in range(sg)]
            for k in range(sg):
                pave.face([Av[k], Av[(k + 1) % sg], Bv[(k + 1) % sg], Bv[k]], UP)
            # 外側立面
            Dv = [pave.vert((*pol(k * 360 / sg, r1, cx, cz), BASE_Z), col) for k in range(sg)]
            for k in range(sg):
                bm = (k + 0.5) * 360 / sg
                pave.face([Bv[k], Bv[(k + 1) % sg], Dv[(k + 1) % sg], Dv[k]], (*pol(bm, 1.0), 0.0))
    flat_star(gm, cx, cz, PAVE_TOP + 0.009, 8, [R * 0.93, R * 0.6], 0.34, gcol, gcol_d)
    # 金色內環
    A = [gm.vert((*pol(k * 360 / sg, 1.0, cx, cz), PAVE_TOP + 0.008), gcol) for k in range(sg)]
    B = [gm.vert((*pol(k * 360 / sg, 1.08, cx, cz), PAVE_TOP + 0.008), gcol) for k in range(sg)]
    for k in range(sg):
        gm.face([A[k], A[(k + 1) % sg], B[(k + 1) % sg], B[k]], UP)
    meta["compass"] = {"x": cx, "z": cz, "r": R + 0.25}
    # 四向道路（寬 6 m；E/S/W 在地面，N 在高台上）：路緣石＋錯縫石板；比廣場低 4 mm，入口處由路緣環蓋住
    meta["roads"] = []
    for b in ROADS:
        h0 = PLAT_H if b == 0 else 0.0
        y0 = PLAT_R0 if b == 0 else 17.95
        Fb = frame(0, 0, b, h0)
        top = PAVE_TOP - 0.004
        q = [pave.vert(Fb(x, y, BASE_Z), PAL["grout"]) for x, y in ((-3, y0), (3, y0), (3, ROAD_END), (-3, ROAD_END))]
        pave.face(q, UP)
        L = ROAD_END - y0
        rows = int(round(L / 1.0))
        for i in range(rows):
            ya, yb = y0 + L * i / rows, y0 + L * (i + 1) / rows
            for xa, xb in ((-3.0, -2.6), (2.6, 3.0)):
                slab_quad(pave, [Fb(xa, ya, 0)[:2], Fb(xb, ya, 0)[:2], Fb(xb, yb, 0)[:2], Fb(xa, yb, 0)[:2]], h0 + top + 0.003, h0 + BASE_Z, 0.02, jit(PAL["curb"], rng, 0.012), P["bevel"])
            off = 0.65 if i % 2 else 0.0
            xs = [-2.6] + [x for x in (-2.6 + off + 1.3 * k for k in range(1, 5)) if -2.6 < x < 2.6] + [2.6]
            for xa, xb in zip(xs, xs[1:]):
                col = jit(PAL["road"] if rng.random() < 0.6 else PAL["road2"], rng, 0.02)
                # 路面石板只做上表面（縫隙露出底層），省面數；路緣石保留斜邊
                slab_quad(pave, [Fb(xa, ya, 0)[:2], Fb(xb, ya, 0)[:2], Fb(xb, yb, 0)[:2], Fb(xa, yb, 0)[:2]], h0 + top, h0 + BASE_Z, 0.022, col, False)
        meta["roads"].append({"bearing": b, "from": y0, "to": ROAD_END, "half": ROAD_HALF, "h": h0})


# ---------------- 物件 ----------------
C = {
    "stone": (0.92, 0.88, 0.80),
    "stone_d": (0.84, 0.79, 0.70),
    "wood": (0.66, 0.45, 0.27),
    "wood_d": (0.56, 0.37, 0.22),
    "iron": (0.20, 0.25, 0.34),
    "soil": (0.40, 0.29, 0.19),
    "leaf": [(0.36, 0.60, 0.30), (0.30, 0.53, 0.27), (0.46, 0.68, 0.33)],
    "flowers": [(0.98, 0.62, 0.74), (0.99, 0.97, 0.93), (1.0, 0.85, 0.36), (0.74, 0.63, 0.96), (0.58, 0.76, 1.0), (1.0, 0.70, 0.45)],
    "glass": (1.0, 0.88, 0.60),
    "crystal": (0.62, 0.88, 1.0),
    "banner": (0.18, 0.32, 0.66),
}


def bench(P, props, gold, F, lite):
    gm, gcol = (props, (0.9, 0.72, 0.34)) if lite else (gold, (1, 1, 1))
    for sx in (-0.62, 0.62):
        box(props, F, sx - 0.12, sx + 0.12, -0.27, 0.27, 0.0, 0.07, C["stone_d"])  # 石座
        box(props, F, sx - 0.09, sx + 0.09, -0.22, 0.22, 0.07, 0.40, C["stone"])  # 石腳
        if not lite:
            box(props, F, sx - 0.1, sx + 0.1, -0.24, 0.24, 0.36, 0.41, C["stone_d"])  # 腳帽
            box(props, F, sx - 0.04, sx + 0.04, -0.27, -0.21, 0.40, 0.98, C["iron"])  # 椅背支柱
    slats = ((-0.21, -0.07), (-0.05, 0.07), (0.09, 0.22)) if not lite else ((-0.21, 0.0), (0.02, 0.22))
    for i, (y0, y1) in enumerate(slats):
        box(props, F, -0.8, 0.8, y0, y1, 0.41, 0.46, C["wood"] if i % 2 == 0 else C["wood_d"])
    for i, (h0, h1) in enumerate(((0.58, 0.70), (0.76, 0.88)) if not lite else ((0.6, 0.86),)):
        box(props, F, -0.8, 0.8, -0.27, -0.22, h0, h1, C["wood_d"] if i % 2 == 0 else C["wood"])
    # 椅背中央金色小星（朝前）
    cx, cz, h = F(0, -0.215, 0.95)
    t = math.atan2(F(0, 1, 0)[0] - F(0, 0, 0)[0], F(0, 1, 0)[1] - F(0, 0, 0)[1])
    c = gm.vert((cx, cz, h), gcol)
    pts = []
    for i in range(10):
        a = i * math.pi / 5
        r = 0.085 if i % 2 == 0 else 0.035
        pts.append(gm.vert(F(math.sin(a) * r, -0.21, 0.95 + math.cos(a) * r), gcol))
    fwd = (math.sin(t), math.cos(t), 0)
    for i in range(10):
        gm.face([c, pts[i], pts[(i + 1) % 10]], fwd)


def crystal_lamp(P, props, gold, glass, cx, cz, lite):
    gm, gcol = (props, (0.9, 0.72, 0.34)) if lite else (gold, (1, 1, 1))
    seg = P["lathe"] if not lite else P["lathe_s"]
    prof = [(0.42, 0.0), (0.42, 0.1), (0.36, 0.16), (0.3, 0.2), (0.26, 0.42), (0.27, 0.66), (0.33, 0.76), (0.37, 0.84), (0.34, 0.9), (0.2, 0.93), (0.0, 0.93)]
    lathe(props, cx, cz, 0, prof, seg, lambda h: C["stone_d"] if h < 0.18 else C["stone"], smooth=True)
    lathe(gm, cx, cz, 0, [(0.285, 0.62), (0.3, 0.66), (0.29, 0.70)], seg, gcol)
    # 4 支金爪托起水晶（Lite 只留金環）
    if lite:
        lathe(gm, cx, cz, 0, [(0.2, 0.93), (0.17, 1.02), (0.12, 1.08), (0.0, 1.08)], seg, gcol)
    for i in range(0 if lite else 4):
        b = 45 + i * 90
        pts = []
        for t in range(5):
            u = t / 4
            r = 0.2 + 0.12 * math.sin(u * math.pi) - 0.06 * u
            pts.append((*pol(b, r, cx, cz), 0.9 + 0.5 * u))
        tube(gm, pts, 0.028, P["tube"], gcol, taper=0.5)
    # 水晶（不受光、淡藍）
    sg = 8
    top = glass.vert((cx, cz, 1.66), (0.85, 0.97, 1.0))
    bot = glass.vert((cx, cz, 1.02), (0.45, 0.75, 1.0))
    ring = [glass.vert((*pol(i * 45 + 22.5, 0.16, cx, cz), 1.30), C["crystal"]) for i in range(sg)]
    for i in range(sg):
        j = (i + 1) % sg
        bm = (i + 0.5) * 45 + 22.5
        out = pol(bm, 1.0)
        glass.face([ring[i], ring[j], top], (out[0], out[1], 0.4))
        glass.face([ring[i], ring[j], bot], (out[0], out[1], -0.4))
    if not lite:
        for i in range(4):
            b = i * 90
            x, z = pol(b, 0.268, cx, cz)
            pts = []
            c0 = gm.vert((x, z, 0.5), gcol)
            for k in range(10):
                a = k * math.pi / 5
                r = 0.07 if k % 2 == 0 else 0.03
                ox, oz = pol(b + 90, math.sin(a) * r)
                pts.append(gm.vert((x + ox, z + oz, 0.5 + math.cos(a) * r), gcol))
            for k in range(10):
                gm.face([c0, pts[k], pts[(k + 1) % 10]], (*pol(b, 1.0), 0))


def lamp(P, props, gold, glass, banner, b, lite, rng, meta):
    cx, cz = pol(b, LAMP_R)
    F = frame(cx, cz, b)  # +y 朝外
    gm, gcol = (props, (0.9, 0.72, 0.34)) if lite else (gold, (1, 1, 1))
    s = P["lathe_s"]
    lathe(props, cx, cz, 0, [(0.3, 0.0), (0.3, 0.12), (0.26, 0.17), (0.22, 0.2), (0.22, 0.52), (0.26, 0.57), (0.17, 0.64), (0.0, 0.64)], s, lambda h: C["stone_d"] if h < 0.15 else C["stone"], phase=math.pi / s, smooth=False)
    lathe(props, cx, cz, 0.6, [(0.12, 0.0), (0.13, 0.08), (0.08, 0.2), (0.07, 0.8), (0.06, 2.25), (0.1, 2.32), (0.13, 2.38), (0.0, 2.38)], s, C["iron"])
    lathe(gm, cx, cz, 0.6, [(0.085, 0.82), (0.095, 0.86), (0.085, 0.9)], s, gcol)
    # 燈籠（2.98～3.62）
    box(props, F, -0.16, 0.16, -0.16, 0.16, 2.96, 3.02, C["iron"])
    if not lite:
        for sx, sy in ((-0.13, -0.13), (0.13, -0.13), (0.13, 0.13), (-0.13, 0.13)):
            box(props, F, sx - 0.018, sx + 0.018, sy - 0.018, sy + 0.018, 3.02, 3.46, C["iron"])
    box(glass, F, -0.12, 0.12, -0.12, 0.12, 3.02, 3.46, C["glass"])
    lathe(props, cx, cz, 3.46, [(0.25, 0.0), (0.25, 0.04), (0.19, 0.1), (0.0, 0.24)], 4, C["iron"], phase=math.pi / 4, smooth=False)
    lathe(gm, cx, cz, 3.68, [(0.03, 0.0), (0.05, 0.05), (0.0, 0.13)], s, gcol)
    # 旗臂（朝外）＋旗幟
    box(props, F, -0.022, 0.022, 0.06, 0.4, 2.62, 2.66, C["iron"])
    box(props, F, -0.3, 0.3, 0.36, 0.4, 2.56, 2.6, C["iron"])
    for sx in (-0.3, 0.3):
        if not lite:
            c0 = gm.vert(F(sx, 0.38, 2.58), gcol)
            ring = [gm.vert(F(sx + math.cos(k * math.tau / 6) * 0.03, 0.38 + math.sin(k * math.tau / 6) * 0.03, 2.58), gcol) for k in range(6)]
            for k in range(6):
                gm.face([c0, ring[k], ring[(k + 1) % 6]], (*pol(b + (90 if sx > 0 else -90), 1.0), 0))
    rows = 7 if not lite else 3
    bm = banner if banner is not None else props
    grid = []
    for r in range(rows + 1):
        v = r / rows
        h = 2.54 - v * (2.54 - 1.42)
        row = []
        for ci, x in enumerate((-0.25, 0.0, 0.25)):
            hh = h
            if r == rows:
                hh = 1.62 if ci == 1 else 1.3
            wave = 0.035 * math.sin(v * 3.2 + x * 4 + b)
            col = (1, 1, 1) if banner is not None else (C["banner"] if r not in (0, rows) else (0.9, 0.72, 0.34))
            row.append(bm.vert(F(x, 0.38 + wave, hh), col, ((x + 0.25) / 0.5, (2.54 - hh) / (2.54 - 1.3))))
        grid.append(row)
    for r in range(rows):
        for ci in range(2):
            bm.face([grid[r][ci], grid[r][ci + 1], grid[r + 1][ci + 1], grid[r + 1][ci]], (*pol(b + 180, 1.0), 0))
    if banner is None:
        # Lite：旗幟背面另建頂點（props 材質是單面）
        back = [[bm.vert(bm.v[i], C["banner"]) for i in row] for row in grid]
        for r in range(rows):
            for ci in range(2):
                bm.face([back[r][ci], back[r][ci + 1], back[r + 1][ci + 1], back[r + 1][ci]], (*pol(b, 1.0), 0))
    # 吊籃（朝廣場；HQ）
    if P["basket"]:
        box(props, F, -0.02, 0.02, -0.5, -0.06, 2.42, 2.46, C["iron"])
        tube(props, [F(0, -0.48, 2.44), F(0, -0.48, 2.12)], 0.008, 3, C["iron"])
        bx, bz, _ = F(0, -0.48, 0)
        lathe(props, bx, bz, 1.86, [(0.0, 0.0), (0.12, 0.02), (0.19, 0.1), (0.21, 0.2), (0.0, 0.2)], 8, C["wood_d"])
        blob(props, (bx, bz, 2.08), 0.22, 0.22, 0.1, C["leaf"][0])
        for k in range(6):
            a = k * 60 + rng.random() * 20
            fx, fz = pol(a, 0.14, bx, bz)
            flower(props, (fx, fz, 2.14), 0.05, C["flowers"][k % 2], (1.0, 0.85, 0.36), rng.random() * 6)
        for k in range(4):
            a = k * 90 + 45
            fx, fz = pol(a, 0.2, bx, bz)
            blob(props, (fx, fz, 1.92), 0.05, 0.05, 0.12, C["leaf"][1])
    meta["lamps"].append({"bearing": b, "x": round(cx, 3), "z": round(cz, 3)})


def bed(P, props, rng, a0, a1, r0, r1, curb_h, pal, cx=0.0, cz=0.0, kind="bed"):
    arc_box(props, r0, r0 + 0.12, a0, a1, 0.0, curb_h, C["stone"], cx=cx, cz=cz)
    arc_box(props, r1 - 0.12, r1, a0, a1, 0.0, curb_h, C["stone"], cx=cx, cz=cz)
    da = math.degrees(0.12 / ((r0 + r1) / 2))
    arc_box(props, r0 + 0.12, r1 - 0.12, a0, a0 + da, 0.0, curb_h, C["stone"], cx=cx, cz=cz)
    arc_box(props, r0 + 0.12, r1 - 0.12, a1 - da, a1, 0.0, curb_h, C["stone"], cx=cx, cz=cz)
    seg = max(1, math.ceil(math.radians(a1 - a0) * r1 / 0.8))
    A = [props.vert((*pol(a0 + (a1 - a0) * k / seg, r0 + 0.12, cx, cz), curb_h - 0.04), C["soil"]) for k in range(seg + 1)]
    B = [props.vert((*pol(a0 + (a1 - a0) * k / seg, r1 - 0.12, cx, cz), curb_h - 0.04), C["soil"]) for k in range(seg + 1)]
    for k in range(seg):
        props.face([A[k], A[k + 1], B[k + 1], B[k]], UP)
    area = math.radians(a1 - a0) * (r1 + r0) / 2 * (r1 - r0 - 0.24)
    n = max(2, int(area * 6 * P["flower"]))
    pts = []
    for i in range(n):
        a = a0 + da * 1.5 + (a1 - a0 - da * 3) * (i + rng.random() * 0.6) / n
        r = r0 + 0.2 + (r1 - r0 - 0.4) * rng.random()
        x, z = pol(a, r, cx, cz)
        hh = curb_h - 0.04
        blob(props, (x, z, hh + 0.06), 0.13 + rng.random() * 0.08, 0.13 + rng.random() * 0.08, 0.1 + rng.random() * 0.08, C["leaf"][i % 3])
        for k in range(1 if P["flower"] < 1 else 2):
            fa = rng.random() * 360
            fx, fz = pol(fa, 0.08 + rng.random() * 0.08, x, z)
            flower(props, (fx, fz, hh + 0.14 + rng.random() * 0.06), 0.05 + rng.random() * 0.02, pal[(i + k) % len(pal)], (1.0, 0.86, 0.4), rng.random() * 6)
        pts.append((round(x, 2), round(z, 2)))
    return {"kind": kind, "a0": a0, "a1": a1, "r0": r0, "r1": r1, "h": curb_h, "samples": [[round(v, 2) for v in pol(a, r, cx, cz)] for a in (a0, (a0 + a1) / 2, a1) for r in (r0, r1)]}


def dove(props, x, z, h, yaw):
    F = frame(x, z, yaw, h)
    blob(props, F(0, 0, 0.06), 0.06, 0.07, 0.05, (0.97, 0.97, 0.98))
    blob(props, F(0, 0.07, 0.11), 0.035, 0.035, 0.03, (0.95, 0.95, 0.97))
    blob(props, F(0, 0.105, 0.11), 0.01, 0.02, 0.008, (0.95, 0.6, 0.35))
    t = [props.vert(F(-0.03, -0.06, 0.07), (0.9, 0.9, 0.93)), props.vert(F(0.03, -0.06, 0.07), (0.9, 0.9, 0.93)), props.vert(F(0, -0.14, 0.09), (0.85, 0.85, 0.9))]
    props.face(t, UP)


def contact(mb, F, w, d, a=0.32):
    """Lite 接地陰影（3×3 格，中心不透明、邊緣透明）"""
    ids = {}
    for i, x in enumerate((-w, 0, w)):
        for j, y in enumerate((-d, 0, d)):
            ids[i, j] = mb.vert(F(x, y, PAVE_TOP + 0.004), (0, 0, 0), a=a if (i == 1 and j == 1) else 0.0)
    for i in range(2):
        for j in range(2):
            mb.face([ids[i, j], ids[i + 1, j], ids[i + 1, j + 1], ids[i, j + 1]], UP)


def contact_ring(mb, r0, r1, seg, a):
    A = [mb.vert((*pol(k * 360 / seg, r0), PAVE_TOP + 0.004), (0, 0, 0), a=a) for k in range(seg)]
    B = [mb.vert((*pol(k * 360 / seg, r1), PAVE_TOP + 0.004), (0, 0, 0), a=0.0) for k in range(seg)]
    for k in range(seg):
        mb.face([A[k], A[(k + 1) % seg], B[(k + 1) % seg], B[k]], UP)


def build(lod):
    P = LOD[lod]
    lite = lod == "lite"
    rng = random.Random(20261123)
    meta = {"benches": [], "crystal_lamps": [], "lamps": [], "beds": [], "doves": []}
    pave = MB("Plaza_paving", True)
    gold = MB("Plaza_gold", False)
    props = MB("Plaza_props", False)
    glass = MB("Plaza_glass", False)
    banner = MB("Plaza_banner", False) if P["banner_tex"] else None
    cont = MB("Plaza_contact", False) if lite else None
    build_paving(P, rng, pave, gold, meta)
    for b in BENCH_B:
        x, z = pol(b, BENCH_R)
        F = frame(x, z, b + 180)
        bench(P, props, gold, F, lite)
        meta["benches"].append({"bearing": b, "x": round(x, 3), "z": round(z, 3)})
        if cont:
            contact(cont, F, 1.0, 0.45)
    for b in CLAMP_B:
        x, z = pol(b, CLAMP_R)
        crystal_lamp(P, props, gold, glass, x, z, lite)
        meta["crystal_lamps"].append({"bearing": b, "x": round(x, 3), "z": round(z, 3)})
        if cont:
            contact(cont, frame(x, z, 0), 0.75, 0.75, 0.38)
    for b in LAMP_B:
        lamp(P, props, gold, glass, banner, b, lite, rng, meta)
        if cont:
            x, z = pol(b, LAMP_R)
            contact(cont, frame(x, z, b), 0.55, 0.55, 0.35)
    if cont:
        contact_ring(cont, 7.0, 8.3, 64, 0.3)
    # 花圃：路燈後方（不擋 NPC、道路）＋北側高台牆腳
    pals = [[C["flowers"][0], C["flowers"][1]], [C["flowers"][2], C["flowers"][4]], [C["flowers"][3], C["flowers"][1]], [C["flowers"][5], C["flowers"][2]], [C["flowers"][0], C["flowers"][3]]]
    for i, (a0, a1) in enumerate(((71.5, 78.5), (108.5, 115.5), (136.5, 143.5), (221.5, 228.5), (253.0, 259.0))):
        meta["beds"].append(bed(P, props, rng, a0, a1, 19.0, 20.4, 0.18, pals[i % len(pals)], kind="lampBed"))
    for i, (a0, a1) in enumerate(((281.5, 287.5), (307.0, 322.5), (341.5, 350.5), (9.5, 16.5), (35.5, 43.5))):
        aa0, aa1 = (a0, a1) if a1 > a0 else (a0, a1 + 360)
        meta["beds"].append(bed(P, props, rng, aa0, aa1, 22.4, 22.98, 0.2, pals[(i + 2) % len(pals)], kind="wallBed"))
    if P["doves"]:
        for b, r, h, yaw in ((150, 6.35, 0.86, 60), (158, 6.3, 0.86, 250), (205, 6.35, 0.86, 120), (30, 6.3, 0.86, 300), (172, 10.1, PAVE_TOP, 20), (175, 9.7, PAVE_TOP, 140)):
            x, z = pol(b, r)
            dove(props, x, z, h, yaw)
            meta["doves"].append([round(x, 2), round(z, 2)])
    return {k: v for k, v in (("paving", pave), ("gold", gold), ("props", props), ("glass", glass), ("banner", banner), ("contact", cont)) if v is not None and v.f}, meta


def to_object(mb, mat):
    me = bpy.data.meshes.new(mb.name)
    me.from_pydata([(-x, -z, h) for x, z, h in mb.v], [], mb.f)
    me.update()
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", [x for c in mb.c for x in c])
    me.color_attributes.active_color = ca
    uvl = me.uv_layers.new(name="UVMap")
    lv = [0] * len(me.loops)
    me.loops.foreach_get("vertex_index", lv)
    uvl.data.foreach_set("uv", [x for i in lv for x in mb.uv[i]])
    me.polygons.foreach_set("use_smooth", mb.sm)
    me.materials.append(mat)
    ob = bpy.data.objects.new(mb.name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def simple_mat(name, rgb, tex=None, alpha=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.7
    if tex:
        tx = nt.nodes.new("ShaderNodeTexImage")
        tx.image = bpy.data.images.load(tex)
        nt.links.new(tx.outputs["Color"], b.inputs["Base Color"])
    else:
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        nt.links.new(vc.outputs["Color"], b.inputs["Base Color"])
        if alpha:
            # 匯出器只在材質有用到頂點色 Alpha 時才輸出 RGBA（否則只輸出 RGB，接地陰影會變成全黑方塊）
            nt.links.new(vc.outputs["Alpha"], b.inputs["Alpha"])
            m.blend_method = "BLEND"
    return m


def main():
    t0 = time.time()
    report = {"lods": {}, "budget": BUDGET}
    log = []
    for lod in ("lite", "hq"):
        vp3_kit.reset()
        kit = vp3_kit.make_materials(TEX, lod)
        mats = {
            "paving": kit["slab"],
            "gold": simple_mat("VP3_plaza_gold", (1, 1, 1)),
            "props": simple_mat("VP3_plaza_props", (1, 1, 1)),
            "glass": simple_mat("VP3_plaza_glass", (1, 1, 1)),
            "banner": simple_mat("VP3_plaza_banner", (1, 1, 1), os.path.join(TEX, "banner_hq.png")),
            "contact": simple_mat("VP3_plaza_contact", (0, 0, 0), alpha=True),
        }
        mbs, meta = build(lod)
        objs = {k: to_object(mb, mats[k]) for k, mb in mbs.items()}
        ok = vp3_kit.bake_ao([objs["props"]], samples=24, strength=0.55, log=log)
        per = {k: mb.tris() for k, mb in mbs.items()}
        path = os.path.join(OUT, f"plaza_{lod}.glb")
        vp3_kit.export_glb(list(objs.values()), path)
        tris = sum(per.values())
        report["lods"][lod] = {"triangles": tris, "by_mesh": per, "meshes": len(objs), "ao_baked": ok, "bytes": os.path.getsize(path), "within_budget": tris <= BUDGET[lod]["total"]}
        report["layout"] = meta
    report["log"] = log
    report["seconds"] = round(time.time() - t0, 1)
    with open(os.path.join(OUT, "plaza_report.json"), "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in report.items() if k != "layout"}, ensure_ascii=False, indent=1))
    if not all(v["within_budget"] for v in report["lods"].values()):
        raise SystemExit("三角面超出預算")


main()
