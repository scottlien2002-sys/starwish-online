"""
星露啵啵 V3.8R：造型定義（有號距離場 SDF，純 numpy）。
本檔同時給 Blender 腳本（雲端建模）與本機預覽、量測使用，確保三邊造型一致。

座標（Blender 慣例）：Z 向上；角色面向 -Y（正面）；角色左側為 +X。
單位：正面身體最寬處 W = 1.25（與 V3.6 起相同），圓頂高 H = 0.99。

V3.8R 第二階段（灰模）：身體不再用橢球拼湊，而是依第一階段在原始設定圖三視圖上
量到的兩條曲線「逐層建立截面」：
- 正面寬度曲線 FRONT_WIDTH（各高度寬度 ÷ W）
- 側面深度曲線 SIDE_DEPTH（各高度深度 ÷ 最大深度；最大深度 ≈ 0.99 W）
每一層截面是橢圓（從上方看接近圓形，不會變方），層與層之間用單調、平滑的插值連接，
所以從任何角度轉都不會出現平頂、方角或鐘罩。
詳見 docs/monsters/star-dew-bobo-versions.md 與專案文件 Starwish_Bobo_V38R_Stage1_Measurements。
"""
import numpy as np

# ----------------------------------------------------------------- 參數（第一階段量測）

W = 1.25  # 正面最寬處（不含翅膀）
H = 0.99  # 接地 → 圓頂最高點（不含頂部小圓凸與觸角）
DEPTH = 0.99 * W  # 側面最大深度 ≈ 0.99 W
BODY_HEIGHT = H

# (高度比例, 寬度 ÷ W)；0 = 接地、1 = 圓頂
# 0%～20%（接地曲線）依第二階段在原圖逐列擷取的輪廓修正：第一階段目測 5% 處 0.88、13% 處 0.95 偏寬
# （把接地陰影算進去了）；原圖正面、背面、側面三格一致顯示底部是更圓的大圓角。20% 以上維持第一階段數值。
FRONT_WIDTH = [(0.02, 0.62), (0.05, 0.72), (0.08, 0.80), (0.13, 0.895), (0.20, 0.97), (0.30, 1.00), (0.45, 0.99), (0.58, 0.95), (0.75, 0.85), (0.87, 0.70), (0.95, 0.52), (0.99, 0.26)]
SIDE_DEPTH = [(0.02, 0.575), (0.05, 0.69), (0.08, 0.765), (0.13, 0.855), (0.20, 0.945), (0.25, 0.97), (0.40, 1.00), (0.58, 0.92), (0.75, 0.76), (0.87, 0.59), (0.95, 0.43), (0.99, 0.22)]
FRONT_CONTACT = 0.50  # 接地處寬度（大圓角往內收、貼地）
SIDE_CONTACT = 0.45

# 頂部小圓凸（觸角根部的小瓶口）：寬約 0.17～0.2 W、高約 0.085
# V3.8R 修正（使用者驗收第二階段）：根部加寬到約 0.35 W，像瓶頸一樣往下張開、與圓頂自然銜接；
# 往上快速收細到觸角，不是粗柱。旋轉體：半徑 R(z) 從底部 r_base 以內凹曲線收到頂端 r_top
KNOB = dict(z_base=0.968, z_top=1.075, r_base=0.232, r_top=0.058, power=2.3, side=0.62)

# 底部柔軟小鼓包（決定 3：2～4 個非常淺、與身體融合，不像腳）
# 不是另外黏上的球，而是接地圓角的截面半徑在幾個方位「微微鼓出」：(方位角°, 角寬°, 鼓出比例)
# 方位角 0° = 正面（-Y），往角色左側為正；只作用在 0%～15% 高度，最鼓處約 4% 高
BUMPS = [(-40.0, 24.0, 0.035), (40.0, 24.0, 0.035), (-145.0, 26.0, 0.04), (145.0, 26.0, 0.04)]

# 觸角（決定 7：細、柔軟的玻璃管；高出圓頂約 0.39 H）
# 從小圓凸垂直往上，在最高點柔和彎向角色左前方，末端微微下垂接到星星
ANTENNA_POINTS = np.array(
    [
        [0.00, 0.00, 1.02],
        [0.00, 0.00, 1.13],
        [0.006, -0.014, 1.24],
        [0.036, -0.067, 1.31],
        [0.094, -0.157, 1.353],
        [0.155, -0.242, 1.33],
        [0.194, -0.299, 1.262],
        [0.21, -0.319, 1.215],
    ]
)
ANTENNA_R0 = 0.040  # 根部半徑（設定圖根部寬約 0.065 W）
ANTENNA_R1 = 0.024  # 尖端半徑（約 0.04 W）
# 頭頂星星（決定 4：真正的 3D 立體星，固定在觸角末端、跟著角色旋轉，不面向鏡頭）
# 寬約 0.22 W → 外半徑 0.14；角尖圓潤較胖；厚約寬度 1/4 → 半厚 0.035
# V3.8R 修正：位置取設定圖三個視角的最佳 3D 位置（真正的立體位置，不是看板）。
# 設定圖正面星星在中線右 0.23 W、背面只在中線左 0.10 W（插畫兩格本身不一致），
# 3D 物體從正面與背面看左右距離必定相同 → 取中間 0.165 W（0.21），兩個視角誤差各約 0.07 W；
# 往前 0.257 W（側面）、高度取三格平均
HEAD_STAR = dict(center=(0.215, -0.322, 1.19), outer=0.14, inner=0.088, depth=0.035, yaw_deg=35.0)
BELLY_STAR = dict(height=0.24, outer=0.11, inner=0.062, depth=0.028)
# 臉部位置：第三階段依設定圖重做（第二階段灰模不顯示臉）；先放在設定圖量到的位置
EYE = dict(height=0.564, half_spacing=0.25, rx=0.0875, rz=0.125)
MOUTH = dict(height=0.426)
BLUSH = dict(height=0.426, half_spacing=0.39)
# 翅膀（決定 6：小巧、像小魚鰭，貼著身體側面、往外微微張開）
# 正面伸出身體 0.22、高 0.29、中心約 40% 身高；側面中心在身體中心後方 0.27
WING = dict(height=0.40, back=0.27)


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
    """翅膀根部與方向（side = +1 角色左翼 / -1 右翼）。
    小魚鰭：根部貼在身體側面偏後，翼面幾乎貼著身體、往外張開約 30°，三片羽瓣朝後下方。"""
    y0 = 0.13
    z0 = WING["height"] + 0.025
    a, b = half_axes(z0 / H)
    x0 = a * np.sqrt(max(0.0, 1.0 - (y0 / b) ** 2)) - 0.02  # 身體表面往內一點，根部自然融合
    root = np.array([side * x0, y0, z0])
    d = _normalize([side * 0.76, 0.63, -0.17])  # 往後並往外張開約 50°、微微往下（設定圖正面伸出身體約 0.18 W）
    nrm = _normalize(np.cross(d, [0, 0, 1]))
    up = np.cross(nrm, d)
    if up[2] < 0:
        up = -up
    return root, d, up, nrm


# (往上角度, 長度, 寬度, 根部半厚, 往外錯開, 往外翻轉角度)
# 小巧、薄而柔軟：上緣平滑圓弧，下緣三片小圓弧羽瓣朝後下方
WING_LOBES = [
    (0.14, 0.200, 0.088, 0.033, 0.000, 0.00),
    (-0.30, 0.180, 0.078, 0.030, 0.010, 0.10),
    (-0.74, 0.145, 0.066, 0.027, 0.018, 0.18),
]


def sd_wing(p, side):
    root, d, up, nrm = wing_frames(side)
    out_dir = nrm * (1.0 if (nrm @ np.array([side, 0.0, 0.0])) > 0 else -1.0)
    out = None
    for ang, length, width, th0, lift, cup in WING_LOBES:
        dir_ = np.cos(ang) * d + np.sin(ang) * up
        dir_ = dir_ * np.cos(cup) + out_dir * np.sin(cup)
        dir_ = dir_ / np.linalg.norm(dir_)
        side_dir = np.cross(nrm, dir_)
        side_dir = side_dir / np.linalg.norm(side_dir)
        c = root + dir_ * (length * 0.55) + out_dir * lift
        q = p - c
        lx = q @ dir_
        ly = q @ side_dir
        lz = q @ nrm
        t = np.clip((lx + length * 0.55) / (length * 1.55), 0, 1)
        th = th0 * (1.0 - 0.3 * t)  # 往尖端略變薄（柔軟的鰭），尖端圓鈍
        qq = np.stack([lx / length, ly / width, lz / th], -1)
        k0 = np.linalg.norm(qq, axis=-1)
        k1 = np.linalg.norm(qq / np.stack([np.full_like(th, length), np.full_like(th, width), th], -1), axis=-1)
        di = k0 * (k0 - 1) / np.maximum(k1, 1e-9)
        out = di if out is None else smin(out, di, 0.012)
    return out


# ----------------------------------------------------------------- 身體：依量測曲線逐層截面


def _pchip_coeffs(x, y):
    """單調三次插值（Fritsch–Carlson）：通過每個量測點、不過衝，所以輪廓不會鼓出或凹陷"""
    x = np.asarray(x, float)
    y = np.asarray(y, float)
    h = np.diff(x)
    dl = np.diff(y) / h
    m = np.zeros_like(y)
    for i in range(1, len(y) - 1):
        if dl[i - 1] * dl[i] > 0:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i])
    m[0] = dl[0]
    m[-1] = dl[-1]
    return x, y, m


def _pchip_eval(c, t):
    x, y, m = c
    t = np.clip(t, x[0], x[-1])
    i = np.clip(np.searchsorted(x, t) - 1, 0, len(x) - 2)
    hh = x[i + 1] - x[i]
    s = (t - x[i]) / hh
    h00 = 2 * s**3 - 3 * s**2 + 1
    h10 = s**3 - 2 * s**2 + s
    h01 = -2 * s**3 + 3 * s**2
    h11 = s**3 - s**2
    return h00 * y[i] + h10 * hh * m[i] + h01 * y[i + 1] + h11 * hh * m[i + 1]


def _make_profile(points, contact):
    """
    回傳 f(高度比例) → 寬度比例。
    - 5%～99%：量測點的單調三次插值
    - 圓頂（99%～100%）：對「寬度平方」插值到 0 → 頂端是圓弧，不會平頂也不會尖
    - 接地（0%～5%）：從接地平段以平方根曲線外擴 → 大圓角、貼地，不是鐘罩裙邊
    """
    fs = [p[0] for p in points]
    ws = [p[1] for p in points]
    mid = _pchip_coeffs(fs, ws)
    # 圓頂：w² 在 87%～100% 間單調插值（含頂點 0）
    top_f = [0.87, 0.95, 0.99, 1.0]
    top_w2 = [points[-3][1] ** 2, points[-2][1] ** 2, points[-1][1] ** 2, 0.0]
    top = _pchip_coeffs(top_f, top_w2)
    # 接地：w = c + B√f + C·f，在 f0 與插值曲線的值與斜率相接
    f0 = fs[0]
    w0 = ws[0]
    s0 = float(mid[2][0])
    B = (w0 - contact - s0 * f0) / (np.sqrt(f0) - f0 / (2 * np.sqrt(f0)))
    C = s0 - B / (2 * np.sqrt(f0))

    def prof(f):
        f = np.asarray(f, float)
        fb = np.clip(f, 0.0, f0)
        bottom = contact + B * np.sqrt(fb) + C * fb
        body = _pchip_eval(mid, f)
        dome = np.sqrt(np.clip(_pchip_eval(top, f), 0.0, None))
        out = np.where(f < f0, bottom, np.where(f > 0.95, dome, body))
        # 87%～95%：插值與圓頂兩條曲線平滑交接
        blend = np.clip((f - 0.87) / 0.08, 0, 1)
        blend = blend * blend * (3 - 2 * blend)
        out = np.where((f >= 0.87) & (f <= 0.95), body * (1 - blend) + dome * blend, out)
        return out

    return prof


FRONT_PROFILE = _make_profile(FRONT_WIDTH, FRONT_CONTACT)
SIDE_PROFILE = _make_profile(SIDE_DEPTH, SIDE_CONTACT)


def half_axes(f):
    """高度比例 f 的截面半軸（a：左右，b：前後）"""
    a = 0.5 * W * FRONT_PROFILE(f)
    b = 0.5 * DEPTH * SIDE_PROFILE(f)
    return a, b


def _body_field(p):
    """隱函數：截面橢圓半徑 − 1（內部為負）；梯度正規化後近似距離"""
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    f = np.clip(z / H, 0.0, 1.0)
    a, b = half_axes(f)
    # 底部小鼓包：依方位角與高度微微放大截面
    th = np.arctan2(x, -y)
    g = np.exp(-(((f - 0.04) / 0.045) ** 2)) * (f < 0.2)
    bump = np.zeros_like(f)
    for az, wd, amp in BUMPS:
        dth = np.angle(np.exp(1j * (th - np.radians(az))))
        bump = bump + amp * np.exp(-((dth / np.radians(wd)) ** 2))
    a = a * (1 + bump * g)
    b = b * (1 + bump * g)
    a = np.maximum(a, 1e-3)
    b = np.maximum(b, 1e-3)
    r = np.sqrt((x / a) ** 2 + (y / b) ** 2)
    lat = (r - 1.0) * np.minimum(a, b)
    above = np.where(z > H, np.sqrt(np.maximum(r * np.minimum(a, b), 0) ** 2 + (z - H) ** 2), -1e9)
    return np.maximum(lat, above)


def sd_body_core(p, eps=0.004):
    """把隱函數除以梯度長度 → 表面附近是真正的距離（平滑融合 smin 才會均勻）"""
    f0 = _body_field(p)
    g = []
    for k in range(3):
        dp = np.zeros(3)
        dp[k] = eps
        g.append((_body_field(p + dp) - _body_field(p - dp)) / (2 * eps))
    gl = np.sqrt(g[0] ** 2 + g[1] ** 2 + g[2] ** 2)
    return f0 / np.maximum(gl, 0.25)


def sd_knob(p):
    """瓶頸狀小瓶口：內凹張開的旋轉體，頂端圓角；以斜率正規化成近似距離"""
    k = KNOB
    z = p[..., 2]
    hgt = k["z_top"] - k["z_base"]
    t = np.clip((z - k["z_base"]) / hgt, 0.0, 1.0)
    span = k["r_base"] - k["r_top"]
    # 設定圖正面、背面的瓶頸根部寬約 0.35 W，側面較窄（約 0.25 W）→ 根部略呈橢圓，往上變回圓形接觸角
    Rx = k["r_top"] + span * (1.0 - t) ** k["power"]
    Ry = k["r_top"] + span * k["side"] * (1.0 - t) ** k["power"]
    slope = span * k["power"] * (1.0 - t) ** (k["power"] - 1) / hgt
    q = np.sqrt((p[..., 0] / Rx) ** 2 + (p[..., 1] / Ry) ** 2)
    lat = (q - 1.0) * Ry / np.sqrt(1.0 + slope**2)
    cap = z - k["z_top"]
    # 頂端圓角
    return smax(lat, cap, 0.03)


def sd_body_only(p):
    z = p[..., 2]
    d = sd_body_core(p)
    # 頂部小瓶口（觸角根部）
    d = smin(d, sd_knob(p), 0.025)
    # 平底接地
    d = smax(d, -z, 0.008)
    return d


def sd_bobo(p, include_wings=True, include_antenna=True):
    d = sd_body_only(p)
    if include_antenna:
        d = smin(d, sd_tube(p, antenna_path(), antenna_radius), 0.035)
    if include_wings:
        for s in (1, -1):
            d = smin(d, sd_wing(p, s), 0.06)  # 根部與身體平滑融合，無接縫
    return d


GRID_BOUNDS = ((-0.9, 0.9), (-0.72, 0.72), (-0.03, 1.45))


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
