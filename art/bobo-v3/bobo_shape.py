"""
星露啵啵 V3：造型定義（有號距離場 SDF，純 numpy）。
本檔同時給 Blender 腳本（雲端建模）與本機預覽使用，確保兩邊造型一致。

座標（Blender 慣例）：Z 向上；角色面向 -Y（正面）；角色左側為 +X。
單位：身體高度 H = 1（含頂端小尖），之後於 Blender 縮放為遊戲尺寸。

尺寸依《怪物設定圖 01：星露啵啵》三視圖量測（正面、側面、背面）：
- 身體寬高比約 1.24，側面深度約 1.2
- 觸角從頂端小尖長出，往「角色左前方」彎下：
  星星中心相對身體中心：左 0.28、前 0.35～0.37、頂端上方約 0.14
- 眼睛中心高 0.52、左右 ±0.25；嘴 0.41；腮紅 ±0.38、0.39
- 腹部星形中心高 0.14、外徑約 0.11；頭頂星星外徑約 0.13
- 翅膀附著高約 0.36，往外並往後
"""
import numpy as np

# ----------------------------------------------------------------- 參數

BODY_HEIGHT = 1.0

ANTENNA_POINTS = np.array(
    [
        [0.00, 0.00, 0.955],
        [0.00, -0.015, 1.08],
        [0.035, -0.08, 1.21],
        [0.105, -0.19, 1.30],
        [0.19, -0.29, 1.30],
        [0.25, -0.35, 1.235],
        [0.275, -0.37, 1.17],
    ]
)
ANTENNA_R0 = 0.058  # 根部半徑
ANTENNA_R1 = 0.024  # 尖端半徑
HEAD_STAR = dict(center=(0.282, -0.375, 1.12), outer=0.135, inner=0.075, depth=0.05)
BELLY_STAR = dict(height=0.2, outer=0.11, inner=0.062, depth=0.028)
EYE = dict(height=0.52, half_spacing=0.25, rx=0.092, rz=0.112)
MOUTH = dict(height=0.405)
BLUSH = dict(height=0.39, half_spacing=0.38)
WING = dict(height=0.36)


# ----------------------------------------------------------------- SDF 基本形狀


def smin(a, b, k):
    """平滑聯集：k 越大接縫越圓滑（身體、觸角、翅膀之間的自然銜接靠這個）"""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def sd_ellipsoid(p, c, r):
    q = (p - np.asarray(c)) / np.asarray(r)
    k0 = np.linalg.norm(q, axis=-1)
    k1 = np.linalg.norm(q / np.asarray(r), axis=-1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def sd_sphere(p, c, r):
    return np.linalg.norm(p - np.asarray(c), axis=-1) - r


def catmull_rom(points, samples_per_seg=10):
    pts = np.vstack([points[0], points, points[-1]])
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for t in np.linspace(0, 1, samples_per_seg, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(points[-1])
    return np.array(out)


def antenna_path():
    return catmull_rom(ANTENNA_POINTS, 12)


def antenna_radius(t):
    """t = 0 根部 → 1 尖端；根部粗、往尖端立方遞減"""
    return ANTENNA_R1 + (ANTENNA_R0 - ANTENNA_R1) * (1 - t) ** 2.2


def sd_tube(p, path, radius_fn):
    """沿折線的變徑管（每段為圓錐狀膠囊的近似）"""
    d = np.full(p.shape[:-1], 1e9)
    n = len(path) - 1
    for i in range(n):
        a, b = path[i], path[i + 1]
        ba = b - a
        pa = p - a
        h = np.clip((pa @ ba) / (ba @ ba), 0, 1)
        r = radius_fn((i + h) / n)
        di = np.linalg.norm(pa - h[..., None] * ba, axis=-1) - r
        d = np.minimum(d, di)
    return d


def _normalize(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def wing_frames(side):
    """翅膀的根部位置與方向（side = +1 角色左翼 / -1 右翼）"""
    root = np.array([side * 0.5, 0.12, WING["height"]])
    # 往外、往後（約 45°）、略往下：正面與側面都看得到翼面（設定圖正面往外、側面往後）
    d = _normalize([side * 0.72, 0.64, 0.04])  # V3.1：設定圖翅膀略往上翹、不下垂
    nrm = _normalize(np.cross(d, [0, 0, 1]))  # 翼面法線（水平）
    up = np.cross(nrm, d)  # 翼面內與 d 垂直的方向
    return root, d, up, nrm


def sd_wing(p, side):
    root, d, up, nrm = wing_frames(side)
    out = None
    # 三片圓瓣（上、中、下扇形展開），尾緣自然形成圓弧切口
    # 三片圓瓣彼此大量重疊：外緣只留下 2～3 個淺圓弧切口（不是張開的手指）
    # V3.1：瓣稍微分開（外緣出現清楚但柔和的圓弧切口），整體更圓潤
    for ang, length, width in [(0.42, 0.245, 0.105), (0.0, 0.31, 0.115), (-0.4, 0.25, 0.1)]:
        dir_ = np.cos(ang) * d + np.sin(ang) * up
        side_dir = np.cross(nrm, dir_)
        c = root + dir_ * (length * 0.62)
        q = p - c
        # 局部座標：沿瓣長、寬、厚
        lx = q @ dir_
        ly = q @ side_dir
        lz = q @ nrm
        # V3.1：加厚並在根部更厚（柔軟、有份量的水晶果凍，而不是薄片）
        th = 0.05 * (1.0 - 0.35 * np.clip(lx / length, 0, 1))
        qq = np.stack([lx / length, ly / width, lz / th], -1)
        k0 = np.linalg.norm(qq, axis=-1)
        k1 = np.linalg.norm(qq / np.stack([np.full_like(th, length), np.full_like(th, width), th], -1), axis=-1)
        di = k0 * (k0 - 1) / np.maximum(k1, 1e-9)
        out = di if out is None else smin(out, di, 0.025)
    return out


def sd_body_only(p):
    z = p[..., 2]
    main = sd_ellipsoid(p, (0, 0.0, 0.47), (0.6, 0.585, 0.475))
    lower = sd_ellipsoid(p, (0, 0.0, 0.27), (0.625, 0.6, 0.285))
    d = smin(main, lower, 0.12)
    # 底部略平（坐在地上），邊緣圓潤
    d = smax(d, 0.015 - z, 0.06)
    # 頂端水滴小尖（觸角根部）
    d = smin(d, sd_sphere(p, (0, 0, 0.925), 0.055), 0.09)
    return d


def sd_bobo(p, include_wings=True, include_antenna=True):
    d = sd_body_only(p)
    if include_antenna:
        d = smin(d, sd_tube(p, antenna_path(), antenna_radius), 0.05)
    if include_wings:
        for s in (1, -1):
            d = smin(d, sd_wing(p, s), 0.045)
    return d


GRID_BOUNDS = ((-0.95, 0.95), (-0.62, 0.78), (-0.03, 1.4))


def sample_grid(step):
    (x0, x1), (y0, y1), (z0, z1) = GRID_BOUNDS
    xs = np.arange(x0, x1 + step, step)
    ys = np.arange(y0, y1 + step, step)
    zs = np.arange(z0, z1 + step, step)
    P = np.stack(np.meshgrid(xs, ys, zs, indexing="ij"), -1)
    vol = np.empty(P.shape[:3])
    # 分批計算，避免記憶體過大
    for i in range(P.shape[0]):
        vol[i] = sd_bobo(P[i])
    return vol, (xs[0], ys[0], zs[0]), step


def surface_nets(vol, origin, step):
    """
    簡易 Surface Nets（不需查表）：每個跨越等值面的體素放一個頂點（邊交點平均），
    每條跨越等值面的格線邊輸出一個四邊形。回傳 (頂點 N×3, 四邊形 M×4)。
    """
    s = vol < 0
    nx, ny, nz = vol.shape
    # 每個體素 8 個角是否在內部
    corners = [s[i : nx - 1 + i, j : ny - 1 + j, k : nz - 1 + k] for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    anyin = np.zeros_like(corners[0])
    allin = np.ones_like(corners[0])
    for c in corners:
        anyin |= c
        allin &= c
    active = anyin & ~allin
    idx = -np.ones(active.shape, dtype=np.int64)
    cells = np.argwhere(active)
    idx[tuple(cells.T)] = np.arange(len(cells))
    # 頂點位置：12 條邊交點的平均
    edges = [
        ((0, 0, 0), (1, 0, 0)), ((0, 1, 0), (1, 1, 0)), ((0, 0, 1), (1, 0, 1)), ((0, 1, 1), (1, 1, 1)),
        ((0, 0, 0), (0, 1, 0)), ((1, 0, 0), (1, 1, 0)), ((0, 0, 1), (0, 1, 1)), ((1, 0, 1), (1, 1, 1)),
        ((0, 0, 0), (0, 0, 1)), ((1, 0, 0), (1, 0, 1)), ((0, 1, 0), (0, 1, 1)), ((1, 1, 0), (1, 1, 1)),
    ]
    acc = np.zeros((len(cells), 3))
    cnt = np.zeros(len(cells))
    ci, cj, ck = cells.T
    for a, b in edges:
        va = vol[ci + a[0], cj + a[1], ck + a[2]]
        vb = vol[ci + b[0], cj + b[1], ck + b[2]]
        cross = (va < 0) != (vb < 0)
        t = np.where(cross, va / np.where(va - vb == 0, 1e-12, va - vb), 0)
        pos = np.stack([ci + a[0] + t * (b[0] - a[0]), cj + a[1] + t * (b[1] - a[1]), ck + a[2] + t * (b[2] - a[2])], -1)
        acc[cross] += pos[cross]
        cnt[cross] += 1
    verts = acc / np.maximum(cnt, 1)[:, None] * step + np.asarray(origin)
    quads = []
    # x 方向的格線邊 (i,j,k)-(i+1,j,k)：四個相鄰體素 (i, j-1..j, k-1..k)
    for axis in range(3):
        sl0 = [slice(None)] * 3
        sl1 = [slice(None)] * 3
        sl0[axis] = slice(0, -1)
        sl1[axis] = slice(1, None)
        e = s[tuple(sl0)] != s[tuple(sl1)]
        inside_first = s[tuple(sl0)]
        pts = np.argwhere(e)
        o1, o2 = [a for a in range(3) if a != axis]
        ok = (pts[:, o1] > 0) & (pts[:, o2] > 0) & (pts[:, o1] < vol.shape[o1] - 1) & (pts[:, o2] < vol.shape[o2] - 1)
        pts = pts[ok]
        if axis < 3:
            pts = pts[pts[:, axis] < vol.shape[axis] - 1]
        flip = inside_first[tuple(pts.T)]
        def cell(dd1, dd2):
            q = pts.copy()
            q[:, o1] -= dd1
            q[:, o2] -= dd2
            return idx[tuple(q.T)]
        c00, c10, c11, c01 = cell(1, 1), cell(0, 1), cell(0, 0), cell(1, 0)
        f = np.stack([c00, c10, c11, c01], -1)
        # 讓法線朝外（依哪一側在內部翻轉）
        f[flip] = f[flip][:, ::-1]
        if axis == 1:
            f = f[:, ::-1]
        quads.append(f[(f >= 0).all(1)])
    # 依實測：上面的繞向一律朝內，統一反轉為朝外
    return verts, np.vstack(quads)[:, ::-1]
