"""星芽村批次二起共用的建築小工具（框架參數化，不依賴各建築的全域變數）。

既有建築（噴泉、廣場、騎士、法師、劍士、高台）的腳本不改；批次二（佈告欄、鐵匠鋪、倉庫、傳送門與道路）使用這裡的函式。
座標：G.frame(cx, cz, bearing, h0) 的區域座標 (x 右、y 往內、h 上)；面向廣場＝−y。
"""
import math

import vp3_geo as G

WALL = (0.97, 0.94, 0.88)
WALL2 = (0.94, 0.90, 0.83)
TRIM = (0.99, 0.97, 0.93)
PLINTH = (0.86, 0.80, 0.71)
GOLD_VC = (0.92, 0.73, 0.33)
WOOD = (0.55, 0.37, 0.22)
WOOD_D = (0.38, 0.25, 0.15)
IRON = (0.28, 0.29, 0.33)


def vpoly(mb, Fr, outline, y, col, facing=-1):
    ids = [mb.vert(Fr(x, y, h), col) for x, h in outline]
    cx = sum(x for x, _ in outline) / len(outline)
    ch = sum(h for _, h in outline) / len(outline)
    c = mb.vert(Fr(cx, y, ch), col)
    want = G.sub(Fr(0, facing, 0), Fr(0, 0, 0))
    for i in range(len(ids)):
        mb.face([c, ids[i], ids[(i + 1) % len(ids)]], want)


def vextrude(mb, Fr, outline, y_front, depth, col, facing=-1):
    vpoly(mb, Fr, outline, y_front, col, facing)
    cx = sum(x for x, _ in outline) / len(outline)
    ch = sum(h for _, h in outline) / len(outline)
    y_back = y_front - facing * depth
    n = len(outline)
    for i in range(n):
        (x1, h1), (x2, h2) = outline[i], outline[(i + 1) % n]
        idx = [mb.vert(Fr(x1, y_front, h1), col), mb.vert(Fr(x2, y_front, h2), col), mb.vert(Fr(x2, y_back, h2), col), mb.vert(Fr(x1, y_back, h1), col)]
        mb.face(idx, G.sub(Fr((x1 + x2) / 2 - cx, 0, (h1 + h2) / 2 - ch), Fr(0, 0, 0)))


def circle(cx, ch, r, n):
    return [(cx + math.sin(k * math.tau / n) * r, ch + math.cos(k * math.tau / n) * r) for k in range(n)]


def star_outline(cx, ch, n, r_out, r_in, rot=0.0):
    return [(cx + math.sin(rot + i * math.pi / n) * (r_out if i % 2 == 0 else r_in), ch + math.cos(rot + i * math.pi / n) * (r_out if i % 2 == 0 else r_in)) for i in range(n * 2)]


def arch_outline(w, h0, hs, seg, cx=0.0):
    pts = [(cx - w / 2, h0), (cx + w / 2, h0)]
    for k in range(seg + 1):
        a = math.pi * k / seg
        pts.append((cx + math.cos(a) * w / 2, hs + math.sin(a) * w / 2))
    return pts


def plank(mb, Fr, p0, p1, width, y0, y1, col):
    """(x,h) 平面上的斜木條（有厚度）"""
    dx, dh = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dx, dh) or 1.0
    px, ph = -dh / L * width / 2, dx / L * width / 2
    quad = [(p0[0] + px, p0[1] + ph), (p1[0] + px, p1[1] + ph), (p1[0] - px, p1[1] - ph), (p0[0] - px, p0[1] - ph)]
    ids = [mb.vert(Fr(x, y, h), col) for y in (y0, y1) for x, h in quad]
    c = Fr((p0[0] + p1[0]) / 2, (y0 + y1) / 2, (p0[1] + p1[1]) / 2)
    for q in ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        idx = [ids[i] for i in q]
        mb.face(idx, G.sub(G.centroid([mb.v[i] for i in idx]), c))


def gable_roof(roof, Fr, x0, x1, y0, y1, h_eave, h_ridge, col, col_under, ridge_along="y", thick=0.16):
    """雙坡屋頂（上下兩面＋屋簷厚度）。ridge_along="y"：屋脊沿 y（山牆朝 −y）；"x"：屋脊沿 x（屋簷朝 −y）"""
    if ridge_along == "y":
        xm = (x0 + x1) / 2
        for xa, sgn in ((x0, -1), (x1, 1)):
            q = [Fr(xa, y0, h_eave), Fr(xm, y0, h_ridge), Fr(xm, y1, h_ridge), Fr(xa, y1, h_eave)]
            up = G.sub(Fr(sgn * (h_ridge - h_eave), 0, abs(xm - xa)), Fr(0, 0, 0))
            roof.face([roof.vert(p, col) for p in q], up)
            roof.face([roof.vert(p, col_under) for p in q], tuple(-v for v in up))
            e = [Fr(xa, y0, h_eave), Fr(xa, y1, h_eave), Fr(xa, y1, h_eave - thick), Fr(xa, y0, h_eave - thick)]
            roof.face([roof.vert(p, col_under) for p in e], G.sub(Fr(sgn, 0, 0), Fr(0, 0, 0)))
            f = [Fr(xa, y0, h_eave), Fr(xm, y0, h_ridge), Fr(xm, y0, h_ridge - thick), Fr(xa, y0, h_eave - thick)]
            roof.face([roof.vert(p, col_under) for p in f], G.sub(Fr(0, -1, 0), Fr(0, 0, 0)))
            b = [Fr(xa, y1, h_eave), Fr(xm, y1, h_ridge), Fr(xm, y1, h_ridge - thick), Fr(xa, y1, h_eave - thick)]
            roof.face([roof.vert(p, col_under) for p in b], G.sub(Fr(0, 1, 0), Fr(0, 0, 0)))
    else:
        ym = (y0 + y1) / 2
        for ya, sgn in ((y0, -1), (y1, 1)):
            q = [Fr(x0, ya, h_eave), Fr(x0, ym, h_ridge), Fr(x1, ym, h_ridge), Fr(x1, ya, h_eave)]
            up = G.sub(Fr(0, sgn * (h_ridge - h_eave), abs(ym - ya)), Fr(0, 0, 0))
            roof.face([roof.vert(p, col) for p in q], up)
            roof.face([roof.vert(p, col_under) for p in q], tuple(-v for v in up))
            e = [Fr(x0, ya, h_eave), Fr(x1, ya, h_eave), Fr(x1, ya, h_eave - thick), Fr(x0, ya, h_eave - thick)]
            roof.face([roof.vert(p, col_under) for p in e], G.sub(Fr(0, sgn, 0), Fr(0, 0, 0)))
            for xa, sx in ((x0, -1), (x1, 1)):
                f = [Fr(xa, ya, h_eave), Fr(xa, ym, h_ridge), Fr(xa, ym, h_ridge - thick), Fr(xa, ya, h_eave - thick)]
                roof.face([roof.vert(p, col_under) for p in f], G.sub(Fr(sx, 0, 0), Fr(0, 0, 0)))


def gable_wall(mb, Fr, x0, x1, y, h_base, h_ridge, col, facing=-1):
    vpoly(mb, Fr, [(x0, h_base), (x1, h_base), ((x0 + x1) / 2, h_ridge)], y, col, facing)


def window_box(stone, glass_mb, gold_mb, gcol, Fr, w, h0, hgt, trim=TRIM, glass=(0.16, 0.25, 0.46), arch=True, shutters=None, hq=True):
    """窗：石框＋玻璃（＋金色窗櫺）＋可選木窗板，朝 −y（Fr 原點在牆面）"""
    seg = 6 if hq else 3
    hs = h0 + hgt - (w / 2 if arch else 0)
    out = arch_outline(w + 0.3, h0 - 0.12, hs, seg) if arch else [(-w / 2 - 0.15, h0 - 0.12), (w / 2 + 0.15, h0 - 0.12), (w / 2 + 0.15, h0 + hgt + 0.12), (-w / 2 - 0.15, h0 + hgt + 0.12)]
    vextrude(stone, Fr, out, -0.03, 0.12, trim)
    inner = arch_outline(w, h0, hs, seg) if arch else [(-w / 2, h0), (w / 2, h0), (w / 2, h0 + hgt), (-w / 2, h0 + hgt)]
    vpoly(glass_mb, Fr, inner, -0.05, glass, -1)
    G.box(stone, Fr, -w / 2 - 0.2, w / 2 + 0.2, -0.18, 0.0, h0 - 0.24, h0 - 0.1, trim)
    if hq and gold_mb is not None:
        G.box(gold_mb, Fr, -0.02, 0.02, -0.07, -0.055, h0, h0 + hgt - 0.05, gcol)
        G.box(gold_mb, Fr, -w / 2, w / 2, -0.07, -0.055, h0 + hgt * 0.55, h0 + hgt * 0.55 + 0.04, gcol)
    if shutters:
        for sx in (-1, 1):
            xa, xb = sorted((sx * (w / 2 + 0.17), sx * (w / 2 + 0.17 + w * 0.55)))
            G.box(shutters[0], Fr, xa, xb, -0.08, -0.02, h0, h0 + hgt, shutters[1])


def bipyramid(mb, c, r, up, dn, seg, cols):
    top, mid, bot = cols
    G.lathe(mb, c[0], c[1], c[2], [(0.0, -dn), (r * 0.62, -dn * 0.45), (r, 0.0), (r * 0.7, up * 0.42), (0.0, up)], seg, lambda h: top if h > c[2] + 0.01 else (mid if h > c[2] - dn * 0.5 else bot), smooth=False)


def flat_ring(mb, cx, cz, h, r0, r1, col, n, up=True):
    A = [mb.vert((cx + math.sin(k * math.tau / n) * r0, cz + math.cos(k * math.tau / n) * r0, h), col) for k in range(n)]
    B = [mb.vert((cx + math.sin(k * math.tau / n) * r1, cz + math.cos(k * math.tau / n) * r1, h), col) for k in range(n)]
    for k in range(n):
        mb.face([A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]], G.UP if up else (0, 0, -1))


def flat_disc(mb, cx, cz, h, r, col, n, col_c=None):
    c = mb.vert((cx, cz, h), col_c or col)
    ids = [mb.vert((cx + math.sin(k * math.tau / n) * r, cz + math.cos(k * math.tau / n) * r, h), col) for k in range(n)]
    for k in range(n):
        mb.face([c, ids[k], ids[(k + 1) % n]], G.UP)


def flat_poly(mb, pts, h, col):
    cx = sum(p[0] for p in pts) / len(pts)
    cz = sum(p[1] for p in pts) / len(pts)
    c = mb.vert((cx, cz, h), col)
    ids = [mb.vert((x, z, h), col) for x, z in pts]
    for k in range(len(ids)):
        mb.face([c, ids[k], ids[(k + 1) % len(ids)]], G.UP)


def norm(pts):
    n = G.newell(pts)
    L = math.sqrt(sum(x * x for x in n)) or 1.0
    return tuple(x / L for x in n)


def box_uv(local, ex, ey, tile=2.4):
    """方塊投影 UV（local(p)→(x,y,h)、ex/ey＝區域 x/y 軸在世界平面的方向）"""

    def f(pts):
        n = norm(pts)
        if abs(n[2]) > 0.7:
            return [(local(p)[0] / tile, local(p)[1] / tile) for p in pts]
        nl = (n[0] * ex[0] + n[1] * ex[1], n[0] * ey[0] + n[1] * ey[1])
        if abs(nl[0]) > abs(nl[1]):
            return [(local(p)[1] / tile, local(p)[2] / tile) for p in pts]
        return [(local(p)[0] / tile, local(p)[2] / tile) for p in pts]

    return f


def slope_uv(tile=1.6):
    def f(pts):
        n = norm(pts)
        t = (-n[1], n[0], 0.0)
        L = math.hypot(t[0], t[1])
        if L < 1e-6:
            return [(p[0] / tile, p[1] / tile) for p in pts]
        t = (t[0] / L, t[1] / L, 0.0)
        s = (n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0])
        return [((p[0] * t[0] + p[1] * t[1]) / tile, (p[0] * s[0] + p[1] * s[1] + p[2] * s[2]) / tile) for p in pts]

    return f


def local_fn(ox, oz, bearing, floor):
    F = G.frame(ox, oz, bearing, floor)
    ex = G.sub(F(1, 0, 0), F(0, 0, 0))
    ey = G.sub(F(0, 1, 0), F(0, 0, 0))

    def local(p):
        d = (p[0] - ox, p[1] - oz)
        return (d[0] * ex[0] + d[1] * ex[1], d[0] * ey[0] + d[1] * ey[1], p[2] - floor)

    return F, local, ex, ey


def bounds(mbs, local, skip=()):
    L = [local(v) for k, mb in mbs.items() if k not in skip for v in mb.v]
    return {"x": [round(min(p[0] for p in L), 3), round(max(p[0] for p in L), 3)], "y": [round(min(p[1] for p in L), 3), round(max(p[1] for p in L), 3)], "h": [round(min(p[2] for p in L), 3), round(max(p[2] for p in L), 3)]}


def export_lods(name, build, budget, out, uvs, layout, extra=None, ao_keys=("stone", "roof", "props")):
    """共用輸出：每個 LOD 建模 → UV → AO → GLB；報告含三角面、包圍盒（extra(mbs) 回傳額外欄位）"""
    import json
    import os
    import time

    import vp3_kit

    t0 = time.time()
    report = {"lods": {}, "budget": budget, "layout": layout}
    log = []
    for lod in ("lite", "hq"):
        vp3_kit.reset()
        mbs = build(lod)
        mats = {k: G.simple_mat(f"VP3_{name}_{k}", (1, 1, 1)) for k in mbs}
        objs = {k: (G.to_object_uv(mb, mats[k], uvs[k]) if k in uvs else G.to_object(mb, mats[k])) for k, mb in mbs.items()}
        ok = vp3_kit.bake_ao([objs[k] for k in ao_keys if k in objs], samples=20, strength=0.55, log=log)
        path = os.path.join(out, f"{name}_{lod}.glb")
        vp3_kit.export_glb(list(objs.values()), path)
        per = {k: mb.tris() for k, mb in mbs.items()}
        tris = sum(per.values())
        report["lods"][lod] = {"triangles": tris, "by_mesh": per, "meshes": len(objs), "ao_baked": ok, "bytes": os.path.getsize(path), "within_budget": tris <= budget[lod], **(extra(mbs) if extra else {})}
    report["log"] = log
    report["seconds"] = round(time.time() - t0, 1)
    with open(os.path.join(out, f"{name}_report.json"), "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in report.items() if k != "log"}, ensure_ascii=False)[:2000])
    if not all(v["within_budget"] for v in report["lods"].values()):
        raise SystemExit("三角面超出預算")
