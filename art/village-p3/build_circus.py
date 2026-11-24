"""P3-11 小丑馬戲團「星夢馬戲團」（HQ / Lite）。

blender -b --factory-startup -P build_circus.py -- --out <輸出資料夾>

- V1.3：方位 128°、正面 r 24、寬 14 × 深 14、簷高 4、最高 10 m（地面）；全部網格在原碰撞箱內，不新增碰撞
- 小丑 NPC 站位不變（正門前 2.5 m、碰撞箱外）
- 造型：圓形大帳篷（深紅／奶油色直條＋皇家藍）、波浪垂飾＋金流蘇、金色環飾、中央旗杆＋金星與三角旗、
  簷口一圈小旗、正門木框拱門＋星星招牌（燈泡自發光）、拉開的布幕、條紋表演台、星形氣球
- 色彩活潑但壓低飽和度、用金色收邊，避免廉價感
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

BEARING, FRONT, W, D, EAVE, TOP, FLOOR = 128.0, 24.0, 14.0, 14.0, 4.0, 10.0, 0.0
OX, OZ = G.pol(BEARING, FRONT)
F, local, EX, EY = A.local_fn(OX, OZ, BEARING, FLOOR)
BUDGET = {"hq": 16000, "lite": 7000}
C = {
    "red": (0.78, 0.22, 0.28), "red_d": (0.6, 0.16, 0.22), "cream": (0.98, 0.93, 0.82), "blue": (0.24, 0.34, 0.68), "blue_d": (0.18, 0.24, 0.5),
    "wood": (0.5, 0.32, 0.2), "dark": (0.16, 0.12, 0.2), "bulb": (1.0, 0.86, 0.5), "sign": (0.2, 0.26, 0.55),
    "teal": (0.3, 0.7, 0.72), "pink": (0.95, 0.6, 0.7), "yellow": (1.0, 0.82, 0.35),
}
CY = 7.0       # 帳篷中心（區域 y）
R_WALL = 6.3
R_ROOF = 6.75


def ring_pt(r, a, h):
    """帳篷極座標（a＝相對區域 −y 的角度，0＝正面）→ 世界座標"""
    return F(math.sin(a) * r, CY - math.cos(a) * r, h)


def build(lod):
    hq = lod == "hq"
    stone, roof, gold, props, glow = (G.MB(f"Circus_{k}", lin) for k, lin in (("stone", True), ("roof", True), ("gold", False), ("props", False), ("glow", False)))
    gm, gcol = (gold, (1, 1, 1)) if hq else (props, A.GOLD_VC)
    n = 28 if hq else 14
    door_half = 2 if hq else 1  # 正面留給入口的格數（每側）
    # ---- 圓形石基座（低平台，可走上；碰撞箱內）----
    c = F(0, CY, 0)
    G.lathe(stone, c[0], c[1], 0.0, [(R_WALL + 0.45, 0.0), (R_WALL + 0.4, 0.22), (0.0, 0.22)], n, A.PLINTH, smooth=False)
    # ---- 帳篷牆（直條）----
    for k in range(n):
        a0, a1 = math.tau * (k - 0.5) / n, math.tau * (k + 0.5) / n
        col = C["red"] if k % 2 == 0 else C["cream"]
        is_door = k <= door_half - 1 or k >= n - door_half + 1 or k == 0
        if is_door:
            # 入口：深色內部（凹進 0.6 m）
            q = [ring_pt(R_WALL - 0.6, a0, 0.22), ring_pt(R_WALL - 0.6, a1, 0.22), ring_pt(R_WALL - 0.6, a1, 3.2), ring_pt(R_WALL - 0.6, a0, 3.2)]
            props.face([props.vert(p, C["dark"]) for p in q], G.sub(ring_pt(1, (a0 + a1) / 2, 0), ring_pt(0, 0, 0)))
            q = [ring_pt(R_WALL, a0, 3.2), ring_pt(R_WALL, a1, 3.2), ring_pt(R_WALL + 0.12, a1, EAVE), ring_pt(R_WALL + 0.12, a0, EAVE)]
            props.face([props.vert(p, col) for p in q], G.sub(ring_pt(1, (a0 + a1) / 2, 0), ring_pt(0, 0, 0)))
            continue
        rows = [(0.22, R_WALL), (2.2, R_WALL + 0.04), (EAVE, R_WALL + 0.12)] if hq else [(0.22, R_WALL), (EAVE, R_WALL + 0.12)]
        for (h1, r1), (h2, r2) in zip(rows, rows[1:]):
            q = [ring_pt(r1, a0, h1), ring_pt(r1, a1, h1), ring_pt(r2, a1, h2), ring_pt(r2, a0, h2)]
            props.face([props.vert(p, col) for p in q], G.sub(ring_pt(1, (a0 + a1) / 2, 0), ring_pt(0, 0, 0)))
    # 牆腳藍色裙邊
    for k in range(n):
        a0, a1 = math.tau * (k - 0.5) / n, math.tau * (k + 0.5) / n
        if k <= door_half - 1 or k >= n - door_half + 1 or k == 0:
            continue
        q = [ring_pt(R_WALL + 0.02, a0, 0.22), ring_pt(R_WALL + 0.02, a1, 0.22), ring_pt(R_WALL + 0.02, a1, 0.62), ring_pt(R_WALL + 0.02, a0, 0.62)]
        props.face([props.vert(p, C["blue"]) for p in q], G.sub(ring_pt(1, (a0 + a1) / 2, 0), ring_pt(0, 0, 0)))
    # ---- 圓錐屋頂（布面＝props 頂點色，不套瓦片貼圖；直條、微凹）＋金環＋波浪垂飾＋流蘇 ----
    prof = [(R_ROOF, EAVE), (4.6, 5.7), (2.4, 7.4), (0.35, 8.85)] if hq else [(R_ROOF, EAVE), (3.4, 6.6), (0.35, 8.85)]
    for k in range(n):
        a0, a1 = math.tau * (k - 0.5) / n, math.tau * (k + 0.5) / n
        col = C["red"] if k % 2 == 0 else C["cream"]
        for (r1, h1), (r2, h2) in zip(prof, prof[1:]):
            q = [ring_pt(r1, a0, h1), ring_pt(r1, a1, h1), ring_pt(r2, a1, h2), ring_pt(r2, a0, h2)]
            props.face([props.vert(p, col) for p in q], G.sub(ring_pt(1, (a0 + a1) / 2, 2.0), ring_pt(0, 0, 0)))
            qb = [ring_pt(r1, a0, h1 - 0.06), ring_pt(r2, a0, h2 - 0.06), ring_pt(r2, a1, h2 - 0.06), ring_pt(r1, a1, h1 - 0.06)]
            props.face([props.vert(p, C["red_d"]) for p in qb], (0, 0, -1))
        # 垂飾：每格一片半圓（藍／金交替）
        sc = []
        m = 5 if hq else 3
        for j in range(m + 1):
            t = j / m
            a = a0 + (a1 - a0) * t
            sc.append(ring_pt(R_ROOF + 0.02, a, EAVE - 0.05 - 0.5 * math.sin(math.pi * t)))
        top0, top1 = ring_pt(R_ROOF + 0.02, a0, EAVE + 0.02), ring_pt(R_ROOF + 0.02, a1, EAVE + 0.02)
        vcol = C["blue"] if k % 2 == 0 else C["yellow"]
        ids = [props.vert(top1, vcol), props.vert(top0, vcol)] + [props.vert(p, vcol) for p in sc]
        ctr = props.vert(ring_pt(R_ROOF + 0.02, (a0 + a1) / 2, EAVE - 0.2), vcol)
        for j in range(len(sc) - 1):
            props.face([ctr, ids[2 + j], ids[3 + j]], G.sub(ring_pt(1, (a0 + a1) / 2, 0), ring_pt(0, 0, 0)))
        props.face([ctr, ids[1], ids[2]], G.sub(ring_pt(1, (a0 + a1) / 2, 0), ring_pt(0, 0, 0)))
        props.face([ctr, ids[-1], ids[0]], G.sub(ring_pt(1, (a0 + a1) / 2, 0), ring_pt(0, 0, 0)))
        if hq:  # 金流蘇
            G.blob(gm, ring_pt(R_ROOF + 0.05, a0, EAVE - 0.12), 0.05, 0.05, 0.09, gcol)
    G.tube(gm, [ring_pt(R_ROOF + 0.03, math.tau * (k - 0.5) / n, EAVE + 0.02) for k in range(n + 1)], 0.05, 5 if hq else 3, gcol)
    G.tube(gm, [ring_pt(2.45, math.tau * (k - 0.5) / n, 7.38) for k in range(n + 1)], 0.04, 4 if hq else 3, gcol) if hq else None
    # 屋頂上的金星點綴（每 4 格一顆，貼在紅色條上）
    for k in range(0, n, 4 if hq else 7):
        a = math.tau * k / n
        p = ring_pt(5.1, a, 5.35)
        fr = G.frame(p[0], p[1], BEARING + math.degrees(a) + 180, 0.0)
        A.vpoly(gm, fr, A.star_outline(0, 5.38, 5, 0.24, 0.1), -0.1, gcol, -1)
    # ---- 中央旗杆＋金星＋三角旗 ----
    G.tube(props, [(c[0], c[1], 8.7), (c[0], c[1], 9.45)], 0.06, 6 if hq else 4, C["wood"])
    G.lathe(gm, c[0], c[1], 8.7, [(0.22, 0.0), (0.16, 0.12), (0.0, 0.2)], 8, gcol)
    fs = G.frame(c[0], c[1], BEARING, 0.0)
    for fy in (-1, 1):
        A.vpoly(gm, fs, A.star_outline(0, 9.62, 5, 0.34, 0.14), 0.03 * fy, gcol, fy)
    A.vpoly(props, fs, [(0.06, 9.4), (1.0, 9.2), (0.06, 8.95)], 0.0, C["blue"], -1)
    A.vpoly(props, fs, [(0.06, 9.4), (1.0, 9.2), (0.06, 8.95)], 0.005, C["blue"], 1)
    # ---- 簷口小旗（8 根短旗杆，旗子朝外）----
    for k in range(8 if hq else 4):
        a = math.tau * (k + 0.5) / (8 if hq else 4)
        if abs(math.atan2(math.sin(a), math.cos(a))) < 0.5:
            continue
        b = ring_pt(R_ROOF - 0.6, a, 4.6)
        t = ring_pt(R_ROOF - 0.6, a, 5.9)
        G.tube(props, [b, t], 0.03, 4, C["wood"])
        G.blob(gm, t, 0.05, 0.05, 0.05, gcol)
        fr = G.frame(t[0], t[1], BEARING + math.degrees(a) + 90, 0.0)
        flag_col = (C["teal"], C["yellow"], C["blue"], C["pink"])[k % 4]
        for fy in (-1, 1):
            A.vpoly(props, fr, [(0.0, 5.85), (0.55, 5.68), (0.0, 5.45)], 0.003 * fy, flag_col, fy)
    # ---- 正門：木框拱門＋星星招牌（燈泡）＋拉開的布幕 ----
    y_d = CY - R_WALL - 0.05  # 入口前緣（區域 y）
    for sx in (-1, 1):
        G.box(props, F, sx * 1.75 - 0.15, sx * 1.75 + 0.15, y_d - 0.3, y_d, 0.22, 3.4, C["wood"])
        G.box(gm, F, sx * 1.75 - 0.18, sx * 1.75 + 0.18, y_d - 0.33, y_d + 0.03, 3.3, 3.42, gcol)
        G.lathe(gm, *F(sx * 1.75, y_d - 0.15, 0)[:2], 3.42, [(0.12, 0.0), (0.0, 0.24)], 6, gcol)
        # 布幕：三角形布片，從門柱上方垂到側邊
        A.vpoly(props, F, [(sx * 1.6, 3.2), (sx * 0.2, 3.2), (sx * 1.6, 0.7)], y_d - 0.05, C["red"], -1)
        A.vpoly(props, F, [(sx * 1.6, 3.2), (sx * 0.2, 3.2), (sx * 1.6, 0.7)], y_d - 0.04, C["red_d"], 1)
        G.tube(gm, [F(sx * 1.6, y_d - 0.07, 1.4), F(sx * 1.3, y_d - 0.07, 1.6)], 0.025, 4, gcol)
    G.box(props, F, -1.9, 1.9, y_d - 0.32, y_d, 3.3, 3.5, C["wood"])
    # 招牌：拱形藍板＋金框＋三顆金星＋燈泡
    seg = 12 if hq else 6
    arc_o = [(-2.2, 3.5)] + [(-math.cos(math.pi * k / seg) * 2.2, 3.5 + math.sin(math.pi * k / seg) * 1.05) for k in range(1, seg)] + [(2.2, 3.5)]
    A.vextrude(props, F, arc_o, y_d - 0.36, 0.08, C["sign"])
    A.plank(gm, F, (-2.2, 3.5), (2.2, 3.5), 0.06, y_d - 0.4, y_d - 0.36, gcol)
    for k in range(seg):
        A.plank(gm, F, arc_o[k], arc_o[k + 1], 0.06, y_d - 0.4, y_d - 0.36, gcol)
    for x, h, r in ((-1.0, 3.95, 0.22), (0.0, 4.15, 0.32), (1.0, 3.95, 0.22)):
        A.vpoly(gm, F, A.star_outline(x, h, 5, r, r * 0.42), y_d - 0.41, gcol, -1)
    for k in range(1, seg):
        x, h = arc_o[k]
        G.blob(glow, F(x * 0.94, y_d - 0.42, 3.5 + (h - 3.5) * 0.9), 0.055, 0.055, 0.055, C["bulb"])
    # ---- 門前表演台（條紋鼓）× 2、星形氣球 × 2 ----
    for sx in (-1, 1):
        p = F(sx * 3.2, 0.9, 0)
        G.lathe(props, p[0], p[1], 0.0, [(0.5, 0.0), (0.5, 0.55), (0.0, 0.55)], 12 if hq else 8, C["blue"] if sx < 0 else C["red"])
        G.lathe(gm, p[0], p[1], 0.0, [(0.51, 0.04), (0.53, 0.08), (0.51, 0.12)], 12 if hq else 8, gcol)
        G.lathe(gm, p[0], p[1], 0.0, [(0.51, 0.45), (0.53, 0.49), (0.51, 0.53)], 12 if hq else 8, gcol)
        A.flat_poly(props, [_star_pt(p, k) for k in range(10)], 0.555, C["cream"])
        # 氣球（細繩綁在表演台）
        bp = F(sx * 4.4, 0.6, 0)
        G.tube(props, [(bp[0], bp[1], 0.55), (bp[0], bp[1], 2.4)], 0.008, 3, (0.9, 0.9, 0.9))
        fb = G.frame(bp[0], bp[1], BEARING, 0.0)
        bc = C["yellow"] if sx < 0 else C["teal"]
        A.vextrude(props, fb, A.star_outline(0, 2.75, 5, 0.38, 0.2), -0.06, 0.12, bc)
    return {k: v for k, v in (("stone", stone), ("roof", roof), ("gold", gold), ("props", props), ("glow", glow)) if v.f}


def _star_pt(p, k):
    r = 0.32 if k % 2 == 0 else 0.14
    a = math.radians(BEARING + k * 36)
    return (p[0] + math.sin(a) * r, p[1] + math.cos(a) * r)


def extra(mbs):
    out_pts = sum(1 for mb in mbs.values() for v in mb.v if not (lambda q: -W / 2 - 0.01 <= q[0] <= W / 2 + 0.01 and -0.01 <= q[1] <= D + 0.01 and -0.01 <= q[2] <= TOP + 0.01)(local(v)))
    return {"outside_colliders": out_pts, "bounds_local": A.bounds(mbs, local)}


def main():
    door = F(0, CY - R_WALL - 0.3, 0.22)
    A.export_lods("circus", build, BUDGET, OUT, {"stone": A.box_uv(local, EX, EY)},
                  {"bearing": BEARING, "front": FRONT, "w": W, "d": D, "eave": EAVE, "top": TOP, "floor": FLOOR, "door": [round(door[0], 3), round(door[1], 3)]}, extra=extra)


if __name__ == "__main__":
    main()
