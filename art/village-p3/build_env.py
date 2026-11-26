"""P3-12 星芽村環境美術：外圍樹林、樹籬邊界、遠景山丘、草地點綴（HQ / Lite）。

blender -b --factory-startup -P build_env.py -- --out <輸出資料夾>

- 全部在可走範圍（r 50）之外，或貼地 ≤ 0.12 m 的草花點綴：不新增碰撞、不擋路、不改配置
- 樹籬：r 50.6～51.8（既有樹籬邊界位置），高 1.2 m，頂部點綴小花
- 外圍樹林：r 53～63，種在既有外圍緩坡上（高度＝min(6, (r−51)×0.35)）；圓潤日系樹冠、少量尖塔形針葉樹
- 遠景：r 75～130 一圈低多邊形山丘（顏色偏藍綠，霧化後成為柔和背景）
- 地形環（Env_terrain）：只給預覽頁用（遊戲本體已有外圍緩坡地面，整合時不載入）
網格：Env_props（樹、樹籬、花）、Env_far（遠景山丘）、Env_terrain（預覽用外圍緩坡）
"""
import math
import os
import random
import sys

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
args = dict(zip(argv[::2], argv[1::2]))
OUT = os.path.abspath(args.get("--out", "out"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vp3_arch as A  # noqa: E402
import vp3_geo as G  # noqa: E402

WALK_R = 50.0
BUDGET = {"hq": 40000, "lite": 14000}  # Stage 6.6：樹冠改成圓潤多層葉團
C = {
    "trunk": (0.46, 0.32, 0.22), "leaf": [(0.42, 0.66, 0.36), (0.5, 0.72, 0.38), (0.36, 0.6, 0.36), (0.56, 0.74, 0.42)],
    "leaf_hi": (0.66, 0.82, 0.48), "pine": (0.27, 0.5, 0.38), "pine_hi": (0.38, 0.6, 0.44),
    "hedge": (0.36, 0.56, 0.33), "hedge_hi": (0.46, 0.66, 0.38), "flower": [(1.0, 0.85, 0.9), (1.0, 0.95, 0.7), (0.85, 0.85, 1.0), (1.0, 1.0, 1.0)],
    "grass": (0.56, 0.72, 0.42), "far": [(0.55, 0.7, 0.62), (0.5, 0.66, 0.62), (0.6, 0.74, 0.64)],
}


def ground_h(r):
    return min(6.0, (r - WALK_R - 1.0) * 0.35) - 0.02 if r > WALK_R + 1.0 else -0.02


def shade(col, k):
    return tuple(min(1.0, c * k) for c in col)


def clump(mb, c, r, col, hq, rng):
    """Stage 6.6 葉團：多環圓球（環半徑隨機起伏）＋底部較暗、頂部受光（取代六面體）"""
    seg = 6  # Stage 6.6：HQ 由 7 段降為 6 段（守住高畫質每幀三角面）
    prof = [(0.0, -0.78 * r)]
    rings = (-0.45, 0.05, 0.55) if hq else (-0.35, 0.3)
    for t in rings:
        rr = r * (1 - t * t) ** 0.5 * rng.uniform(0.88, 1.08)
        prof.append((rr, t * r))
    prof.append((0.0, 0.92 * r))
    dark, light = shade(col, 0.72), shade(col, 1.18)
    G.lathe(mb, c[0], c[1], c[2], prof, seg, lambda h: dark if h < c[2] - 0.2 * r else (col if h < c[2] + 0.35 * r else light), phase=rng.uniform(0, 1), smooth=True)


def round_tree(mb, x, z, h0, s, rng, hq):
    seg = 7 if hq else 5
    G.lathe(mb, x, z, h0, [(0.24 * s, -0.1), (0.17 * s, 1.2 * s), (0.12 * s, 2.2 * s), (0.0, 2.25 * s)], seg, C["trunk"])
    if hq:  # 分枝
        for a in (0.4, 2.5, 4.4):
            G.tube(mb, [(x, z, h0 + 1.6 * s), (x + math.sin(a) * 0.55 * s, z + math.cos(a) * 0.55 * s, h0 + 2.35 * s)], 0.06 * s, 4, C["trunk"])
    leaf = rng.choice(C["leaf"])
    blobs = [(0, 0, 2.95, 1.35), (0.75, 0.35, 2.55, 0.95), (-0.65, -0.5, 2.6, 1.0), (0.05, 0.1, 3.8, 0.95)] if hq else [(0, 0, 2.95, 1.45), (0.15, 0.0, 3.8, 0.9)]
    for bx, bz, bh, br in blobs:
        c = (x + bx * s, z + bz * s, h0 + bh * s)
        clump(mb, c, br * s, leaf if bh < 3.5 else C["leaf_hi"], hq, rng)


def pine_tree(mb, x, z, h0, s, hq):
    seg = 7 if hq else 5
    G.lathe(mb, x, z, h0, [(0.18 * s, -0.1), (0.14 * s, 1.0 * s), (0.0, 1.05 * s)], seg, C["trunk"])
    tiers = ((1.0, 1.2, 2.4), (2.0, 0.95, 3.4), (2.9, 0.68, 4.3)) if hq else ((1.0, 1.15, 2.9), (2.4, 0.75, 4.3))
    for hb, r, ht in tiers:
        G.lathe(mb, x, z, h0, [(0.0, hb * s), (r * s, hb * s), (r * 0.82 * s, (hb + 0.2) * s), (0.0, ht * s)], seg + 1, C["pine"] if hb < 2.5 else C["pine_hi"], smooth=False)


def build(lod):
    hq = lod == "hq"
    rng = random.Random(20261124)
    props, far, terrain = G.MB("Env_props", False), G.MB("Env_far", False), G.MB("Env_terrain", False)
    # ---- 樹籬邊界（r 50.6～51.8；分段圓弧，頂部微圓）----
    n = 96 if hq else 56
    for k in range(n):
        a0, a1 = 360 * k / n, 360 * (k + 1) / n
        for r0, r1, h1, col in ((50.6, 51.8, 1.0, C["hedge"]), (50.75, 51.65, 1.2, C["hedge_hi"])):
            p = [G.pol(a0, r0), G.pol(a1, r0), G.pol(a1, r1), G.pol(a0, r1)]
            top = [props.vert((x, z, h1), col) for x, z in p]
            props.face(top, G.UP)
            for i in range(4):
                if not hq and i % 2 == 1:
                    continue
                j = (i + 1) % 4
                q = [props.vert((p[i][0], p[i][1], -0.02), col), props.vert((p[j][0], p[j][1], -0.02), col), props.vert((p[j][0], p[j][1], h1), col), props.vert((p[i][0], p[i][1], h1), col)]
                mx, mz = (p[i][0] + p[j][0]) / 2, (p[i][1] + p[j][1]) / 2
                cx, cz = sum(q_[0] for q_ in p) / 4, sum(q_[1] for q_ in p) / 4
                props.face(q, (mx - cx, mz - cz, 0.0))
        if hq and k % 3 == 0:
            for j in range(2):
                x, z = G.pol(a0 + (a1 - a0) * (0.3 + 0.4 * j), 51.2 + rng.uniform(-0.3, 0.3))
                G.blob(props, (x, z, 1.24), 0.09, 0.09, 0.05, rng.choice(C["flower"]))
    # ---- 外圍樹林 ----
    count = 100 if hq else 64  # Stage 6.6：HQ 120→100（橫向鏡頭看得到整圈樹林）
    placed = []
    tries = 0
    while len(placed) < count and tries < 5000:
        tries += 1
        a = rng.uniform(0, 360)
        r = rng.uniform(53.0, 64.0)
        x, z = G.pol(a, r)
        if abs(x) > 64.5 or abs(z) > 64.5:
            continue
        if any(math.hypot(x - px, z - pz) < 3.2 for px, pz in placed):
            continue
        placed.append((x, z))
        s = rng.uniform(0.85, 1.35) * (1.0 + (r - 53) * 0.02)
        if rng.random() < 0.28:
            pine_tree(props, x, z, ground_h(r), s * 1.1, hq)
        else:
            round_tree(props, x, z, ground_h(r), s, rng, hq)
    # ---- 遠景山丘（r 75～130）----
    m = 22 if hq else 14
    for k in range(m):
        a = 360 * k / m + rng.uniform(-6, 6)
        r = rng.uniform(85, 125)
        x, z = G.pol(a, r)
        rad = rng.uniform(22, 36)
        hgt = rng.uniform(10, 24)
        col = rng.choice(C["far"])
        # Stage 6.6：山腳偏綠偏暗、山頂偏藍偏亮（空氣遠近感），山脊多一圈起伏
        lo, hi = shade(col, 0.86), (min(1, col[0] * 1.08 + 0.04), min(1, col[1] * 1.06 + 0.03), min(1, col[2] * 1.1 + 0.06))
        prof = [(rad, 0.0), (rad * 0.82, hgt * 0.3), (rad * 0.6, hgt * 0.58), (rad * 0.3, hgt * 0.88), (0.0, hgt)] if hq else [(rad, 0.0), (rad * 0.75, hgt * 0.45), (rad * 0.35, hgt * 0.88), (0.0, hgt)]
        G.lathe(far, x, z, -1.0, prof, 12 if hq else 7, lambda h, lo=lo, hi=hi, hgt=hgt, col=col: lo if h < hgt * 0.35 - 1 else (col if h < hgt * 0.7 - 1 else hi), phase=rng.uniform(0, 1), smooth=True)
    # ---- 預覽用外圍緩坡（r 50～72）----
    rings = [50.0, 51.0, 53.0, 56.0, 60.0, 64.0, 68.0, 72.0] if hq else [50.0, 51.0, 55.0, 62.0, 72.0]
    segs = 72 if hq else 40
    for i in range(len(rings) - 1):
        for k in range(segs):
            a0, a1 = 360 * k / segs, 360 * (k + 1) / segs
            r0, r1 = rings[i], rings[i + 1]
            q = [(G.pol(a0, r0), ground_h(r0)), (G.pol(a1, r0), ground_h(r0)), (G.pol(a1, r1), ground_h(r1)), (G.pol(a0, r1), ground_h(r1))]
            terrain.face([terrain.vert((p[0], p[1], h), C["grass"]) for p, h in q], G.UP)
    return {k: v for k, v in (("props", props), ("far", far), ("terrain", terrain)) if v.f}


def extra(mbs):
    inside = 0
    for k in ("props",):
        for v in mbs[k].v:
            if math.hypot(v[0], v[1]) < 50.55 and v[2] > 0.12:
                inside += 1
    return {"verts_inside_walk_above_0_12": inside, "trees_r_min": 53.0, "hedge": [50.6, 51.8]}


def main():
    A.export_lods("env", build, BUDGET, OUT, {}, {"walk_r": WALK_R}, extra=extra, ao_keys=())


if __name__ == "__main__":
    main()
