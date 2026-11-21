"""
初心者 V2：有號距離場（SDF）建模工具（純 numpy；Blender 與本機預覽共用）。

沿用星露啵啵 V3.8R 的做法（art/bobo-v38r/bobo_shape.py：平滑聯集、Surface Nets），
人物需要的新功能：
  - 每個零件自己的網格範圍與解析度（頭髮、臉 3 毫米；小配件 1.5 毫米），不用整個角色一個大網格
  - 每個基本形狀只在自己的範圍內計算（快很多）
  - 殼（衣服、裙子：有厚度的布）、壓扁的漸細曲管（髮塊、緞帶）、圓角盒、圓錐、環
座標：Z 向上、角色面向 -Y、角色左側 +X；單位公尺；腳底 z = 0。
"""
import math

import numpy as np


# ------------------------------------------------------------------ 基本運算


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def rot(axis, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    x, y, z = np.asarray(axis, float) / np.linalg.norm(axis)
    return np.array(
        [
            [c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
            [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
            [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)],
        ]
    )


def unit(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


# ------------------------------------------------------------------ 基本形狀（每個都有範圍 bbox）


class Prim:
    def __init__(self, fn, lo, hi):
        self.fn = fn
        self.lo = np.asarray(lo, float)
        self.hi = np.asarray(hi, float)


def ellipsoid(c, r, R=None):
    c = np.asarray(c, float)
    r = np.asarray(r, float)
    Rt = None if R is None else np.asarray(R).T

    def f(P):
        q = P - c
        if Rt is not None:
            q = q @ Rt.T  # 轉到形狀自己的座標
        k0 = np.linalg.norm(q / r, axis=-1)
        k1 = np.linalg.norm(q / (r * r), axis=-1)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)

    m = r.max()
    return Prim(f, c - m, c + m)


def sphere(c, r):
    c = np.asarray(c, float)
    return Prim(lambda P: np.linalg.norm(P - c, axis=-1) - r, c - r, c + r)


def capsule(a, b, ra, rb=None):
    """圓錐膠囊（兩端半徑不同）"""
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    rb = ra if rb is None else rb
    ba = b - a
    L2 = ba @ ba

    def f(P):
        pa = P - a
        t = np.clip((pa @ ba) / L2, 0.0, 1.0)
        d = np.linalg.norm(pa - t[..., None] * ba, axis=-1)
        return d - (ra + (rb - ra) * t)

    m = max(ra, rb)
    return Prim(f, np.minimum(a, b) - m, np.maximum(a, b) + m)


def rbox(c, half, r=0.0, R=None):
    """圓角盒；half = 半邊長（不含圓角）"""
    c = np.asarray(c, float)
    half = np.asarray(half, float)
    Rt = None if R is None else np.asarray(R).T

    def f(P):
        q = P - c
        if Rt is not None:
            q = q @ Rt.T
        d = np.abs(q) - half
        out = np.linalg.norm(np.maximum(d, 0.0), axis=-1)
        ins = np.minimum(np.max(d, axis=-1), 0.0)
        return out + ins - r

    m = np.linalg.norm(half) + r
    return Prim(f, c - m, c + m)


def torus(c, R, r, axis=(0, 0, 1), flat=1.0):
    """環；axis = 環的法線；flat < 1 時截面沿法線壓扁"""
    c = np.asarray(c, float)
    n = unit(axis)
    u = unit(np.cross(n, [1, 0, 0] if abs(n[0]) < 0.9 else [0, 1, 0]))
    v = np.cross(n, u)

    def f(P):
        q = P - c
        x, y, z = q @ u, q @ v, q @ n
        rr = np.sqrt(x * x + y * y) - R
        return np.sqrt(rr * rr + (z / flat) ** 2) - r

    m = R + r
    return Prim(f, c - m, c + m)


def bezier3(p0, p1, p2, p3, n):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3


def flat_tube(points, half_w, half_t, normals):
    """
    壓扁、漸細的曲管（髮塊、緞帶、飄帶）。
    points：沿中心線的點 (N,3)；half_w、half_t：每點的半寬（沿側向）與半厚（沿法線）；
    normals：每點的「厚度方向」（例：頭皮的法線）。截面為橢圓，各段之間連續。
    """
    pts = np.asarray(points, float)
    hw = np.asarray(half_w, float)
    ht = np.asarray(half_t, float)
    nr = np.asarray(normals, float)
    segs = []
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        t = unit(b - a)
        n = unit(nr[i] + nr[i + 1])
        n = unit(n - t * (n @ t))
        s = np.cross(t, n)
        segs.append((a, b, t, s, n, np.linalg.norm(b - a), hw[i], hw[i + 1], ht[i], ht[i + 1]))

    def f(P):
        best = np.full(P.shape[:-1], np.inf)
        for a, b, t, s, n, L, w0, w1, h0, h1 in segs:
            q = P - a
            u = np.clip(q @ t, 0.0, L)
            k = u / L
            w = w0 + (w1 - w0) * k
            h = h0 + (h1 - h0) * k
            r = q - u[..., None] * t
            x, y = r @ s, r @ n
            e = np.sqrt((x / w) ** 2 + (y / h) ** 2)
            d = (e - 1.0) * np.minimum(w, h)
            # 段的兩端：超出端點的部分以距離補上（圓頭）
            beyond = (q @ t) - u
            d = np.where(beyond != 0, np.sqrt(np.maximum(d, 0) ** 2 + beyond ** 2) + np.minimum(d, 0), d)
            best = np.minimum(best, d)
        return best

    m = max(hw.max(), ht.max())
    return Prim(f, pts.min(0) - m, pts.max(0) + m)


def lathe_shell(z0, z1, rx_fn, ry_fn, thick, cy_fn=None, open_front_deg=0.0, hem_fn=None, wave=None):
    """
    依高度變化的橢圓截面「布料殼」（裙子、下擺、短褲、上衣筒）。
    rx_fn(z)、ry_fn(z)：截面半徑；cy_fn(z)：截面中心的 y（前後）；thick：布厚
    open_front_deg：正面開口（±角度，0 = 封閉）；hem_fn(θ)：下緣高度隨方位角變化（尖角、前短後長）
    wave(θ, z)：半徑倍率（荷葉邊、皺褶）
    方位角 θ：0 = 正前方（-Y），往角色左側（+X）增加
    """

    def f(P):
        x, y, z = P[..., 0], P[..., 1], P[..., 2]
        zc = np.clip(z, z0, z1)
        cy = cy_fn(zc) if cy_fn else 0.0
        rx, ry = rx_fn(zc), ry_fn(zc)
        th = np.arctan2(x, -(y - cy))
        sc = wave(th, zc) if wave else 1.0
        rx = rx * sc
        ry = ry * sc
        e = np.sqrt((x / rx) ** 2 + ((y - cy) / ry) ** 2)
        d = np.abs((e - 1.0) * np.minimum(rx, ry)) - thick / 2
        top = z - z1
        bot = (hem_fn(th) if hem_fn else z0) - z
        d = np.maximum(d, np.maximum(top, bot))
        if callable(open_front_deg) or open_front_deg > 0:
            ang = np.abs(th)  # 0 = 正前方
            od = open_front_deg(zc) if callable(open_front_deg) else open_front_deg
            gap = (np.radians(od) - ang) * np.sqrt(x * x + (y - cy) ** 2)
            d = np.maximum(d, gap)
        return d

    zs = np.linspace(z0, z1, 12)
    rmax = max(max(float(np.max(rx_fn(z))), float(np.max(ry_fn(z)))) for z in zs) * (1.25 if wave else 1.0) + thick
    cmin = min(float(np.min(cy_fn(z))) for z in zs) if cy_fn else 0.0
    cmax = max(float(np.max(cy_fn(z))) for z in zs) if cy_fn else 0.0
    zlo = z0 - 0.08 if hem_fn else z0
    return Prim(f, (-rmax, cmin - rmax, zlo - thick), (rmax, cmax + rmax, z1 + thick))


# ------------------------------------------------------------------ 零件（一個網格）


class Part:
    """
    一個零件 = 一串運算（聯集、平滑聯集、差集、交集、殼），在自己的網格上取樣。
    group：灰模／之後的材質分類（skin、hair、cloth、leather、metal...）
    """

    def __init__(self, name, group, step=0.003, pad=0.01):
        self.name = name
        self.group = group
        self.step = step
        self.pad = pad
        self.ops = []

    def add(self, prim, k=0.0):
        self.ops.append(("u", prim, k))
        return self

    def sub(self, prim, k=0.0):
        self.ops.append(("s", prim, k))
        return self

    def inter(self, prim, k=0.0):
        self.ops.append(("i", prim, k))
        return self

    def bounds(self):
        lo = np.min([p.lo for op, p, k in self.ops if op == "u"], axis=0) - self.pad
        hi = np.max([p.hi for op, p, k in self.ops if op == "u"], axis=0) + self.pad
        return lo, hi

    def sample(self):
        lo, hi = self.bounds()
        st = self.step
        xs = np.arange(lo[0], hi[0] + st, st)
        ys = np.arange(lo[1], hi[1] + st, st)
        zs = np.arange(lo[2], hi[2] + st, st)
        vol = np.full((len(xs), len(ys), len(zs)), 1.0)
        for op, p, k in self.ops:
            if op == "i":
                # 交集：整個網格都要算
                sl = (slice(None),) * 3
            else:
                m = k + st * 2
                i0 = np.clip(np.searchsorted(xs, p.lo[0] - m) - 1, 0, len(xs))
                i1 = np.clip(np.searchsorted(xs, p.hi[0] + m) + 1, 0, len(xs))
                j0 = np.clip(np.searchsorted(ys, p.lo[1] - m) - 1, 0, len(ys))
                j1 = np.clip(np.searchsorted(ys, p.hi[1] + m) + 1, 0, len(ys))
                k0 = np.clip(np.searchsorted(zs, p.lo[2] - m) - 1, 0, len(zs))
                k1 = np.clip(np.searchsorted(zs, p.hi[2] + m) + 1, 0, len(zs))
                if i1 <= i0 or j1 <= j0 or k1 <= k0:
                    continue
                sl = (slice(i0, i1), slice(j0, j1), slice(k0, k1))
            X, Y, Z = np.meshgrid(xs[sl[0]], ys[sl[1]], zs[sl[2]], indexing="ij")
            P = np.stack([X, Y, Z], -1)
            d = p.fn(P)
            cur = vol[sl]
            if op == "u":
                vol[sl] = smin(cur, d, k)
            elif op == "s":
                vol[sl] = smax(cur, -d, k)
            else:
                vol[sl] = smax(cur, d, k)
        return vol, (xs[0], ys[0], zs[0]), st


def cyl(x, y, z0, z1, r0, r1=None, round_=0.008):
    """直立的圓角圓柱（可上下不同半徑）：靴筒、翻邊用；上下端是平的（不像膠囊會凸出）"""
    r1 = r0 if r1 is None else r1

    def f(P):
        dx, dy, z = P[..., 0] - x, P[..., 1] - y, P[..., 2]
        t = np.clip((z - z0) / max(z1 - z0, 1e-9), 0, 1)
        r = r0 + (r1 - r0) * t - round_
        d_r = np.sqrt(dx * dx + dy * dy) - r
        d_z = np.abs(z - (z0 + z1) / 2) - ((z1 - z0) / 2 - round_)
        return np.sqrt(np.maximum(d_r, 0) ** 2 + np.maximum(d_z, 0) ** 2) + np.minimum(np.maximum(d_r, d_z), 0) - round_

    m = max(r0, r1)
    return Prim(f, (x - m, y - m, z0), (x + m, y + m, z1))


def catmull(points, n):
    """Catmull-Rom 曲線（端點外插），回傳 n 個點"""
    P = np.asarray(points, float)
    Q = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    seg = len(P) - 1
    out = []
    for s in np.linspace(0, 1, n):
        x = min(s * seg, seg - 1e-9)
        i = int(x)
        u = x - i
        p0, p1, p2, p3 = Q[i], Q[i + 1], Q[i + 2], Q[i + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return np.array(out)


def pillow(c, U, V, poly, thick, round_=0.008, puff=0.5):
    """
    蝴蝶結的圈、緞帶：在平面 (U, V) 上的凸多邊形，往法線方向長出厚度；中間較鼓（puff）、邊緣圓角 → 有稜角又柔和的立體布塊
    poly：[(u, v), ...] 逆時針
    """
    c = np.asarray(c, float)
    U = unit(np.asarray(U, float))
    V = unit(np.asarray(V, float) - U * (np.asarray(V, float) @ U))
    Nn = np.cross(U, V)
    poly = np.asarray(poly, float)
    area = 0.5 * np.sum(poly[:, 0] * np.roll(poly[:, 1], -1) - np.roll(poly[:, 0], -1) * poly[:, 1])
    if area < 0:
        poly = poly[::-1]
    edges = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        t = (b - a) / np.linalg.norm(b - a)
        nrm = np.array([t[1], -t[0]])  # 逆時針 → 往外
        edges.append((a, nrm))

    def f(P):
        q = P - c
        x, y, z = q @ U, q @ V, q @ Nn
        # 平滑的最大值（log-sum-exp）：多邊形內部不會出現水晶般的稜線，外緣仍保留轉角
        ds = np.stack([(x - a[0]) * nrm[0] + (y - a[1]) * nrm[1] for a, nrm in edges])
        km = 0.012
        mx = ds.max(0)
        d2 = mx + km * np.log(np.exp((ds - mx) / km).sum(0))
        d2 = d2 + round_
        h = thick * ((1 - puff) + puff * np.sqrt(np.clip(-d2 / 0.06, 0, 1)))
        dz = np.abs(z) - h
        return np.sqrt(np.maximum(d2, 0) ** 2 + np.maximum(dz, 0) ** 2) + np.minimum(np.maximum(d2, dz), 0) - round_

    pts3 = np.array([c + U * p[0] + V * p[1] for p in poly])
    m = thick + round_ + 0.01
    return Prim(f, pts3.min(0) - m, pts3.max(0) + m)
