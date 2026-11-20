"""
Stage 5.4：男／女初心者（Novice）3D 模型（Blender 程式化建模，無介面執行）。

  blender -b --factory-startup -noaudio -P art/novice-v1/build_novice.py -- --out <資料夾> --textures <資料夾> [--no-render]

產出（每個角色）：
  novice_<male|female>_v1_high.glb / _low.glb
    - 共用骨架（名稱、階層、位置兩個角色完全相同）＋蒙皮（每頂點最多 4 個權重）
    - 動畫：Idle、Walk、Run、Attack（0.50 秒，0.20 秒揮中）、Hurt、Death
    - 三個網格（= 3 次繪製）：Body（布料、皮膚，霧面）、Gloss（頭髮、皮革、金屬飾邊）、Face（表情貼圖集）
  render_<male|female>_<front|side|back>.png、pose_<male|female>_<run|attack|hurt|death>.png
  novice_info.json（三角形數、骨架、動畫、尺寸）

座標：Blender Z 向上、角色面向 -Y（匯出 glTF 後為 Y 向上、面向 +Z）。單位公尺，身高 1.25（與遊戲暫代角色相同）。
造型依使用者提供的男女初心者三視圖（設定圖不放進儲存庫）。
注意：這是程式化建模的第一版，不是人工雕刻的最終美術。
"""
import json
import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
TEX = argv[argv.index("--textures") + 1] if "--textures" in argv else OUT
RENDER = "--no-render" not in argv
os.makedirs(OUT, exist_ok=True)

FPS = 30
VERSION = "v1"

# ============================================================== 小工具


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def smooth(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0)) if e1 != e0 else (1.0 if x >= e1 else 0.0)
    return t * t * (3 - 2 * t)


def V(*a):
    return Vector(a)


def norm(v):
    v = Vector(v)
    return v.normalized() if v.length > 1e-9 else Vector((0, 0, 1))


# ============================================================== 幾何產生器（純 Python：頂點、面）


def uv_sphere(seg, rings, fn):
    """fn(單位球上的點 Vector) → 世界座標"""
    verts = [fn(V(0, 0, 1))]
    for i in range(1, rings):
        phi = math.pi * i / rings
        for j in range(seg):
            th = 2 * math.pi * j / seg
            verts.append(fn(V(math.sin(phi) * math.cos(th), math.sin(phi) * math.sin(th), math.cos(phi))))
    verts.append(fn(V(0, 0, -1)))
    faces = []
    for j in range(seg):
        faces.append((0, 1 + (j + 1) % seg, 1 + j))
    for i in range(rings - 2):
        a = 1 + i * seg
        b = a + seg
        for j in range(seg):
            j1 = (j + 1) % seg
            faces.append((a + j, a + j1, b + j1, b + j))
    last = len(verts) - 1
    base = 1 + (rings - 2) * seg
    for j in range(seg):
        faces.append((base + j, base + (j + 1) % seg, last))
    # 上面的順序是朝內：反轉成朝外
    return verts, [tuple(reversed(f)) for f in faces]


def ellipsoid(c, r, seg=16, rings=10, p=2.0):
    """p > 2：較方的圓角盒（superellipsoid）"""
    e = 2.0 / p

    def f(u):
        return V(*(c[i] + r[i] * math.copysign(abs(u[i]) ** e, u[i]) for i in range(3)))

    return uv_sphere(seg, rings, f)


def loft(sections, seg, a0=None, a1=None, cap_bottom=False, cap_top=False, radial=None):
    """
    橢圓截面沿高度疊起。sections：[(z, rx, ry, cx, cy), ...]（由下到上）
    角度 θ：0 = 正前方（-Y），往角色左邊（+X）增加。a0/a1（度）給定時為開放的片（例：前開的背心、裙子）。
    radial(θ, k) → 半徑倍率與 z 位移 (scale, dz)，用來做裙擺波浪、尖角。
    """
    closed = a0 is None
    cols = seg if closed else seg + 1
    verts = []
    for k, (z, rx, ry, cx, cy) in enumerate(sections):
        for j in range(cols):
            th = (2 * math.pi * j / seg) if closed else math.radians(a0 + (a1 - a0) * j / seg)
            sc, dz = radial(th, k) if radial else (1.0, 0.0)
            verts.append(V(cx + rx * sc * math.sin(th), cy - ry * sc * math.cos(th), z + dz))
    faces = []
    for k in range(len(sections) - 1):
        for j in range(seg if closed else seg):
            j1 = (j + 1) % cols if closed else j + 1
            a, b = k * cols + j, k * cols + j1
            faces.append((a, b, b + cols, a + cols))
    if len(sections) > 1 and sections[-1][0] < sections[0][0]:
        faces = [tuple(reversed(f)) for f in faces]  # 由上往下列出的截面（裙子）：反轉成朝外
    if cap_bottom and closed:
        z, rx, ry, cx, cy = sections[0]
        verts.append(V(cx, cy, z))
        ci = len(verts) - 1
        for j in range(cols):
            faces.append((ci, (j + 1) % cols, j))
    if cap_top and closed:
        z, rx, ry, cx, cy = sections[-1]
        verts.append(V(cx, cy, z))
        ci = len(verts) - 1
        base = (len(sections) - 1) * cols
        for j in range(cols):
            faces.append((ci, base + j, base + (j + 1) % cols))
    return verts, faces


def tube(path, radii, sides=8, flat=1.0, normal_hint=None, cap_start=True, point_end=False, cap_end=True):
    """沿路徑的管子；flat < 1 時截面壓扁（扁的方向 = normal_hint）。point_end：尾端收成尖點（髮束）"""
    path = [Vector(p) for p in path]
    n = len(path)
    verts, faces = [], []
    hint = norm(normal_hint) if normal_hint is not None else None
    ring_count = n - 1 if point_end else n
    for k in range(ring_count):
        t = norm((path[min(k + 1, n - 1)] - path[max(k - 1, 0)]))
        ref = hint if hint is not None else (V(0, 0, 1) if abs(t.z) < 0.9 else V(1, 0, 0))
        side = norm(t.cross(ref))
        if side.length < 1e-6:
            side = norm(t.cross(V(1, 0, 0)))
        up = norm(side.cross(t))
        r = radii[k]
        for j in range(sides):
            a = 2 * math.pi * j / sides
            verts.append(path[k] + side * (math.cos(a) * r) + up * (math.sin(a) * r * flat))
    for k in range(ring_count - 1):
        for j in range(sides):
            j1 = (j + 1) % sides
            a, b = k * sides + j, k * sides + j1
            faces.append((a, b, b + sides, a + sides))
    if cap_start:
        verts.append(path[0])
        ci = len(verts) - 1
        for j in range(sides):
            faces.append((ci, (j + 1) % sides, j))
    last = (ring_count - 1) * sides
    if point_end:
        verts.append(path[-1])
        ti = len(verts) - 1
        for j in range(sides):
            faces.append((last + j, last + (j + 1) % sides, ti))
    elif cap_end:
        verts.append(path[-1])
        ci = len(verts) - 1
        for j in range(sides):
            faces.append((ci, last + j, last + (j + 1) % sides))
    # 上面的順序是朝內：反轉成朝外
    return verts, [tuple(reversed(f)) for f in faces]


def torus(c, R, r, segR=20, segr=8, flatz=1.0):
    verts, faces = [], []
    for i in range(segR):
        a = 2 * math.pi * i / segR
        for j in range(segr):
            b = 2 * math.pi * j / segr
            rr = R + r * math.cos(b)
            verts.append(V(c[0] + rr * math.cos(a), c[1] + rr * math.sin(a), c[2] + r * math.sin(b) * flatz))
    for i in range(segR):
        for j in range(segr):
            i1, j1 = (i + 1) % segR, (j + 1) % segr
            faces.append((i * segr + j, i1 * segr + j, i1 * segr + j1, i * segr + j1))
    return verts, faces


def bezier(p0, p1, p2, n):
    return [p0 * (1 - s) ** 2 + p1 * 2 * (1 - s) * s + p2 * s * s for s in (k / (n - 1) for k in range(n))]


def star_prism(c, facing, R, r, depth, up=V(0, 0, 1)):
    """五角星片（金色徽章）；facing = 朝外的方向"""
    f = norm(facing)
    side = norm(up.cross(f))
    upv = norm(f.cross(side))
    pts = []
    for i in range(10):
        a = math.pi / 2 + i * math.pi / 5
        rad = R if i % 2 == 0 else r
        pts.append(side * (math.cos(a) * rad) + upv * (math.sin(a) * rad))
    verts = [Vector(c) + p + f * depth for p in pts] + [Vector(c) + p for p in pts] + [Vector(c) + f * depth * 1.6, Vector(c)]
    faces = []
    fc, bc = 20, 21
    for i in range(10):
        i1 = (i + 1) % 10
        faces.append((fc, i, i1))
        faces.append((bc, 10 + i1, 10 + i))
        faces.append((i, 10 + i, 10 + i1, i1))
    return verts, faces


def diamond(c, facing, s, depth):
    f = norm(facing)
    side = norm(V(0, 0, 1).cross(f))
    up = norm(f.cross(side))
    c = Vector(c)
    ring = [c + up * s, c + side * s, c - up * s, c - side * s]
    verts = ring + [c + f * depth]
    faces = [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (0, 3, 2, 1)]
    return verts, [tuple(reversed(f)) for f in faces]


# ============================================================== 骨架（男女共用）

BONES = [
    ("root", None, (0, 0, 0), (0, 0, 0.12)),
    ("hips", "root", (0, 0, 0.40), (0, 0, 0.47)),
    ("spine", "hips", (0, 0, 0.47), (0, 0, 0.55)),
    ("chest", "spine", (0, 0, 0.55), (0, 0, 0.65)),
    ("neck", "chest", (0, 0, 0.65), (0, 0, 0.715)),
    ("head", "neck", (0, 0, 0.715), (0, 0, 1.06)),
]
for s, x in (("l", 1), ("r", -1)):
    BONES += [
        (f"upperarm_{s}", "chest", (0.112 * x, 0, 0.625), (0.18 * x, 0.0, 0.53)),
        (f"lowerarm_{s}", f"upperarm_{s}", (0.18 * x, 0, 0.53), (0.225 * x, -0.01, 0.44)),
        (f"hand_{s}", f"lowerarm_{s}", (0.225 * x, -0.01, 0.44), (0.242 * x, -0.015, 0.385)),
        (f"thigh_{s}", "hips", (0.058 * x, 0, 0.40), (0.08 * x, 0, 0.245)),
        (f"shin_{s}", f"thigh_{s}", (0.08 * x, 0, 0.245), (0.095 * x, 0, 0.075)),
        (f"foot_{s}", f"shin_{s}", (0.095 * x, 0, 0.075), (0.095 * x, -0.10, 0.025)),
    ]
BONE = {b[0]: (Vector(b[2]), Vector(b[3])) for b in BONES}


def chain_w(p, names, blend=0.03):
    """頂點投影到骨頭鏈上，依最近的骨頭分配權重，關節附近平滑混合"""
    p = Vector(p)
    best = None
    for i, nm in enumerate(names):
        a, b = BONE[nm]
        ab = b - a
        t = clamp((p - a).dot(ab) / ab.length_squared)
        d = (a + ab * t - p).length
        if best is None or d < best[0]:
            best = (d, i, t, ab.length)
    _, i, t, L = best
    w = {names[i]: 1.0}
    ds, de = t * L, (1 - t) * L
    if i > 0 and ds < blend:
        k = 0.5 * (1 - ds / blend)
        w = {names[i - 1]: k, names[i]: 1 - k}
    elif i < len(names) - 1 and de < blend:
        k = 0.5 * (1 - de / blend)
        w = {names[i + 1]: k, names[i]: 1 - k}
    return w


TORSO = ["hips", "spine", "chest", "neck", "head"]


def torso_w(p):
    return chain_w(V(0, 0, p[2]), TORSO, 0.035)


def arm_w(side):
    names = [f"upperarm_{side}", f"lowerarm_{side}", f"hand_{side}"]
    return lambda p: chain_w(p, names, 0.03)


def leg_w(side):
    names = [f"thigh_{side}", f"shin_{side}", f"foot_{side}"]

    def f(p):
        w = chain_w(p, names, 0.035)
        if p[2] > 0.37:  # 大腿根部與骨盆混合
            k = smooth(0.37, 0.44, p[2])
            w = {kk: vv * (1 - k) for kk, vv in w.items()}
            w["hips"] = w.get("hips", 0) + k
        return w

    return f


def rigid(b):
    return lambda p: {b: 1.0}


def skirt_w(p):
    """裙擺／下擺：主要跟骨盆，下緣部分跟同側大腿（跑步時不會被腿穿過太多）"""
    x, y, z = p
    k = 0.55 * smooth(0.43, 0.27, z)
    if y > 0.04:
        k *= 0.45  # 背面較少
    side = "l" if x >= 0 else "r"
    lat = clamp(abs(x) / 0.12)
    k *= 0.35 + 0.65 * lat
    return {"hips": 1 - k, f"thigh_{side}": k}


# ============================================================== 零件收集


class Model:
    def __init__(self, name):
        self.name = name
        self.parts = []  # (name, verts, faces, color_fn, weight_fn, group, solid, uvs)

    def add(self, name, vf, color, weight, group="matte", solid=0.0, uvs=None):
        verts, faces = vf
        cf = color if callable(color) else (lambda p, _c=color: _c)
        self.parts.append((name, verts, faces, cf, weight, group, solid, uvs))


# ---------------------------------------------------------- 頭


def make_head_fn(c, rx, ry, rzt, rzb, taper):
    c = Vector(c)

    def f(u):
        x, y, z = u.x, u.y, u.z
        rz = rzt if z > 0 else rzb
        if z < 0:
            k = (-z) ** 1.6
            x *= 1 - taper * k
            y *= 1 - 0.12 * k
        if y < 0:
            y *= 1 - 0.07 * smooth(0.7, 0.2, z)  # 臉部稍平
        return V(c.x + x * rx, c.y + y * ry, c.z + z * rz)

    return f


def head_dir(az, el):
    a, e = math.radians(az), math.radians(el)
    return V(math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e))


# ---------------------------------------------------------- 髮束


def strand(hf, center, az, el, L, w, d0, d1, inset=0.012, flat=0.5, segs=6, sides=5):
    u = head_dir(az, el)
    surf = hf(u)
    n = norm(surf - center)
    p0 = surf - n * inset
    p1 = p0 + norm(d0(n)) * L * 0.55
    p2 = p1 + norm(d1(n)) * L * 0.6
    path = bezier(p0, p1, p2, segs)
    radii = [w / 2 * (1 - k / (segs - 1)) ** 0.85 + 0.002 for k in range(segs)]
    return tube(path, radii, sides=sides, flat=flat, normal_hint=n, cap_start=True, point_end=True)


def add_strand(m, name, vf, dark, light):
    verts, faces = vf
    root = verts[-2] if len(verts) > 1 else verts[0]  # 起點中心（cap_start 的中心點）
    tip = verts[-1]
    span = (tip - root).length + 1e-6

    def col(p, _r=root, _s=span):
        s = clamp((Vector(p) - _r).length / _s)
        band = math.exp(-((s - 0.45) / 0.22) ** 2)  # 中段亮帶（動漫頭髮高光）
        return mix(mix(dark, light, 0.3 + 0.3 * s), light, 0.35 * band)

    m.add(name, vf, col, rigid("head"), group="gloss")


def hair_cap(m, hf, center, scale, keep, dark, light):
    c = Vector(center)

    def f(u):
        return c + (hf(u) - c) * scale

    verts, faces = uv_sphere(26, 16, f)
    # 依單位方向決定保留哪些面（臉部不蓋）
    units = []
    for v in verts:
        d = norm(v - c)
        units.append(d)
    kept_faces = [fc for fc in faces if all(keep(units[i]) for i in fc)]
    used = sorted({i for fc in kept_faces for i in fc})
    remap = {o: n for n, o in enumerate(used)}
    nv = [verts[i] for i in used]
    nf = [tuple(remap[i] for i in fc) for fc in kept_faces]
    m.add("hair_cap", (nv, nf), lambda p: mix(dark, light, 0.25 + 0.3 * clamp((p[2] - 0.9) / 0.25)), rigid("head"), group="gloss")


# ---------------------------------------------------------- 臉部貼片（表情圖集第 0 格）


def face_patch(m, head_verts, head_faces, x0, x1, z0, z1, res=22):
    bvh = BVHTree.FromPolygons([tuple(v) for v in head_verts], head_faces)
    grid = {}
    verts, uvs = [], []
    for i in range(res + 1):
        for j in range(res + 1):
            x = x0 + (x1 - x0) * j / res
            z = z0 + (z1 - z0) * i / res
            hit = bvh.ray_cast(V(x, -1.0, z), V(0, 1, 0))
            if hit[0] is None:
                continue
            loc, nrm = hit[0], hit[1]
            grid[(i, j)] = len(verts)
            verts.append(loc + nrm * 0.0022)
            u = (x - x0) / (x1 - x0)
            v = (z - z0) / (z1 - z0)
            # 圖集 4 欄 × 2 列；第 0 格在左上（Blender UV：v 向上 → 上排 v ∈ [0.5, 1]）
            uvs.append((u * 0.25, 0.5 + v * 0.5))
    faces = []
    for i in range(res):
        for j in range(res):
            q = [(i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j)]
            if all(k in grid for k in q):
                # 從前方（-Y）看為逆時針
                faces.append(tuple(grid[k] for k in q))
    m.add("face", (verts, faces), (1, 1, 1), rigid("head"), group="face", uvs=uvs)


# ============================================================== 男性初心者


C = {
    "skin": srgb("#FBE0CF"),
    "white": srgb("#F5F2EC"),
    "blue": srgb("#2F58CC"),
    "blue_dark": srgb("#22409A"),
    "gold": srgb("#E9B53C"),
    "gold_dark": srgb("#B9852A"),
    "leather": srgb("#7A4A2A"),
    "leather_light": srgb("#94603A"),
    "leather_dark": srgb("#4E2F1D"),
    "shorts": srgb("#4A4552"),
    "hair_m_dark": srgb("#5A2914"),
    "hair_m_light": srgb("#A65E32"),
    "hair_f_dark": srgb("#7E3C3C"),
    "hair_f_light": srgb("#C27E76"),
    "purple": srgb("#6E3FA6"),
    "purple_light": srgb("#B48AE0"),
    "pink": srgb("#F2A9C4"),
    "pink_white": srgb("#FBEFF3"),
    "choker": srgb("#4A2724"),
    "gem": srgb("#7B2FC9"),
}


def add_body_common(m, female):
    """頭、耳、脖子、手臂、手套、腿、靴子（男女共用造型，顏色與細節略不同）"""
    hc = V(0, 0.0, 0.885)
    hf = make_head_fn(hc, 0.168 if not female else 0.164, 0.152, 0.19, 0.168, 0.30 if not female else 0.33)
    hv, hfc = uv_sphere(26, 16, hf)
    m.add("head", (hv, hfc), C["skin"], rigid("head"))
    for x in (1, -1):
        m.add(f"ear_{x}", ellipsoid((0.158 * x, 0.012, 0.865), (0.022, 0.032, 0.045), 10, 6), C["skin"], rigid("head"))
    m.add("neck", tube([(0, 0, 0.61), (0, 0, 0.75)], [0.041, 0.04], sides=10), C["skin"], torso_w)
    face_patch(m, hv, hfc, -0.13, 0.13, 0.72, 0.98)

    for s, x in (("l", 1), ("r", -1)):
        ua, ub = BONE[f"upperarm_{s}"]
        la, lb = BONE[f"lowerarm_{s}"]
        ha, hb = BONE[f"hand_{s}"]
        # 手臂（皮膚）：上臂中段到手腕
        arm_path = [ua.lerp(ub, 0.35), ub, la.lerp(lb, 0.5), lb]
        m.add(f"arm_{s}", tube(arm_path, [0.034, 0.031, 0.029, 0.027], sides=9), C["skin"], arm_w(s))
        # 手套：拳頭＋袖口
        fist_c = ha.lerp(hb, 0.55)
        m.add(f"fist_{s}", ellipsoid(fist_c, (0.043, 0.046, 0.048), 12, 8, p=2.5), C["leather"], rigid(f"hand_{s}"), group="gloss")
        cuff_path = [la.lerp(lb, 0.62), lb.lerp(la, -0.05)]
        m.add(f"cuff_{s}", tube(cuff_path, [0.036, 0.047], sides=10), C["leather_light"], arm_w(s), group="gloss")
        if not female:
            m.add(f"rivet_{s}", ellipsoid(lb + V(0, -0.045, 0.008) + V(0.01 * x, 0, 0), (0.008, 0.006, 0.008), 6, 4), C["gold"], arm_w(s), group="gloss")
        # 腿（皮膚，短褲／裙子到靴子之間）
        ta, tb = BONE[f"thigh_{s}"]
        sa, sb = BONE[f"shin_{s}"]
        m.add(f"leg_{s}", tube([ta.lerp(tb, 0.3), tb, sa.lerp(sb, 0.6)], [0.036, 0.033, 0.031], sides=9), C["skin"], leg_w(s))
        # 靴子：筒＋翻邊＋鞋頭＋鞋底
        bx = sb.x
        m.add(f"boot_shaft_{s}", tube([(bx, 0.005, 0.05), (bx, 0.002, 0.19)], [0.052, 0.056], sides=12, flat=1.08), C["leather"], rigid(f"shin_{s}"), group="gloss")
        m.add(f"boot_cuff_{s}", loft([(0.175, 0.062, 0.066, bx, 0.002), (0.2, 0.066, 0.07, bx, 0.002), (0.218, 0.06, 0.064, bx, 0.002)], 14), C["leather_light"], rigid(f"shin_{s}"), group="gloss", solid=0.006)
        m.add(f"boot_foot_{s}", ellipsoid((bx, -0.035, 0.045), (0.058, 0.098, 0.045), 14, 8, p=2.3), C["leather"], rigid(f"foot_{s}"), group="gloss")
        m.add(f"boot_sole_{s}", ellipsoid((bx, -0.035, 0.011), (0.061, 0.101, 0.012), 14, 6, p=3), C["leather_dark"], rigid(f"foot_{s}"), group="gloss")
        if not female:
            m.add(f"boot_gem_{s}", diamond((bx, -0.07, 0.196), V(0, -1, 0), 0.02, 0.008), C["gold"], rigid(f"shin_{s}"), group="gloss")
        else:
            for z in (0.11, 0.16):
                m.add(f"boot_strap_{s}_{z}", loft([(z - 0.008, 0.057, 0.061, bx, 0.003), (z + 0.008, 0.057, 0.061, bx, 0.003)], 14), C["leather_dark"], rigid(f"shin_{s}"), group="gloss", solid=0.004)
                m.add(f"boot_buckle_{s}_{z}", ellipsoid((bx, -0.064, z), (0.012, 0.006, 0.01), 8, 4, p=3), C["gold"], rigid(f"shin_{s}"), group="gloss")
    return hc, hf


def build_male():
    m = Model("NoviceMale")
    hc, hf = add_body_common(m, female=False)
    # ---- 頭髮：蓬鬆的大髮束（整體圓、髮尾往外翹），頭頂少量尖刺、瀏海垂到眉眼 ----
    dark, light = C["hair_m_dark"], C["hair_m_light"]
    hair_cap(m, hf, hc, 1.1, lambda u: u.z > 0.3 or (u.y > 0.0 and u.z > -0.62) or (u.y > -0.5 and u.z > 0.02), dark, light)
    up, back = V(0, 0, 1), V(0, 1, 0)
    i = 0

    def S(az, el, L, w, d0, d1, flat=0.5):
        nonlocal i
        add_strand(m, f"hair_{i}", strand(hf, hc, az, el, L, w, d0, d1, flat=flat, inset=0.02), dark, light)
        i += 1

    # 頭頂：往上、往後的尖刺（短而粗）
    for az in (-20, 40, 100, 160, 220, 280):
        S(az, 62, 0.12, 0.105, lambda n: n + up * 0.55 + back * 0.3, lambda n: n * 0.8 + up * 0.2 + back * 0.45)
    S(8, 82, 0.11, 0.045, lambda n: up + back * 0.2, lambda n: V(0, -0.9, 0.2), flat=0.6)  # 呆毛
    # 上圈：大髮束往外、髮尾下垂外翹
    for az in range(48, 320, 30):
        S(az, 34, 0.16, 0.12, lambda n: n * 0.65 - up * 0.15 + back * 0.1, lambda n: n * 0.45 - up * 0.9)
    # 下圈：兩側、後腦往下往外
    for az in range(76, 290, 22):
        S(az, 2, 0.15, 0.11, lambda n: n * 0.55 - up * 0.7, lambda n: n * 0.6 - up)
    # 後頸
    for az in (158, 180, 202):
        S(az, -26, 0.09, 0.075, lambda n: n * 0.5 - up, lambda n: back * 0.3 - up)
    # 鬢角（耳朵前方往下）
    for az in (66, -66):
        S(az, 22, 0.13, 0.06, lambda n: n * 0.4 - up, lambda n: n * 0.35 + V(0, -0.2, -1))
    # 瀏海：額頭上方往前往下，垂到眉毛與眼睛之間；兩側較長的瀏海框住臉
    for az, L in ((-40, 0.115), (-24, 0.13), (-8, 0.14), (8, 0.15), (24, 0.13), (40, 0.115)):
        S(az, 52, L, 0.085, lambda n: n * 0.6 + V(0, -0.5, -0.4), lambda n: V(0, -0.25, -1))
    for az in (-54, 54):
        S(az, 40, 0.15, 0.08, lambda n: n * 0.5 + V(0, -0.3, -0.6), lambda n: n * 0.3 - up)

    # ---- 上衣、背心、圍巾 ----
    shirt = [(0.40, 0.098, 0.08, 0, 0), (0.46, 0.093, 0.076, 0, 0), (0.52, 0.098, 0.08, 0, 0), (0.58, 0.108, 0.082, 0, 0), (0.625, 0.112, 0.075, 0, 0), (0.66, 0.075, 0.058, 0, 0), (0.69, 0.046, 0.043, 0, 0)]
    m.add("shirt", loft(shirt, 28, cap_bottom=True), C["white"], torso_w)
    vest = [(z, rx + 0.011, ry + 0.011, 0, 0) for (z, rx, ry, _, _) in shirt[1:5]]
    m.add("vest", loft(vest, 26, a0=30, a1=330), lambda p: C["blue"], torso_w, solid=0.007)
    # 背心金邊：前襟兩側與下緣
    for a in (30, 330):
        pts = []
        for (z, rx, ry, _, _) in vest:
            th = math.radians(a)
            pts.append(V((rx + 0.004) * math.sin(th), -(ry + 0.004) * math.cos(th), z))
        m.add(f"vest_trim_{a}", tube(pts, [0.0055] * len(pts), sides=6), C["gold"], torso_w, group="gloss")
    z0, rx0, ry0 = vest[0][0], vest[0][1], vest[0][2]
    m.add("vest_hem", tube([V((rx0 + 0.004) * math.sin(math.radians(a)), -(ry0 + 0.004) * math.cos(math.radians(a)), z0) for a in range(30, 331, 15)], [0.005] * 21, sides=6), C["gold"], torso_w, group="gloss")
    # 胸前綁帶（交叉）
    for (a, b) in (((-0.024, 0.605), (0.022, 0.535)), ((0.024, 0.605), (-0.022, 0.535)), ((-0.024, 0.57), (0.024, 0.57))):
        m.add(f"lace_{a[0]}_{a[1]}", tube([V(a[0], -0.087, a[1]), V(b[0], -0.087, b[1])], [0.0045, 0.0045], sides=5), C["leather"], torso_w, group="gloss")
    # 短袖（白）＋袖口金邊
    for s, x in (("l", 1), ("r", -1)):
        ua, ub = BONE[f"upperarm_{s}"]
        m.add(f"sleeve_{s}", tube([ua.lerp(ub, -0.15), ua.lerp(ub, 0.25), ua.lerp(ub, 0.62)], [0.052, 0.054, 0.048], sides=10), C["white"], arm_w(s))
        tc = ua.lerp(ub, 0.62)
        d = norm(ub - ua)
        ring = [tc + (V(1, 0, 0) * math.cos(t) + V(0, 1, 0) * math.sin(t)) * 0.049 for t in [2 * math.pi * k / 12 for k in range(13)]]
        # 讓金邊垂直於上臂
        rot = V(0, 0, -1).rotation_difference(d)
        ring = [tc + rot @ (p - tc) for p in ring]
        m.add(f"sleeve_trim_{s}", tube(ring, [0.0065] * 13, sides=6, cap_start=False, cap_end=False), C["gold"], arm_w(s), group="gloss")
        # 背心肩片
        m.add(f"pauldron_{s}", ellipsoid(ua.lerp(ub, 0.08) + V(0.008 * x, 0, 0.012), (0.05, 0.058, 0.03), 12, 6), C["blue"], torso_w)
    # 圍巾：頸圈＋前方垂片＋後方飄帶
    m.add("scarf_ring", torus((0, 0.0, 0.665), 0.06, 0.03, 20, 8, flatz=0.75), C["blue"], torso_w)
    m.add("scarf_front", tube([V(0.0, -0.075, 0.665), V(0.005, -0.098, 0.62), V(0.0, -0.1, 0.575)], [0.055, 0.04, 0.012], sides=8, flat=0.28, normal_hint=V(0, -1, 0)), C["blue"], torso_w)
    m.add("scarf_tail", tube([V(0.035, 0.065, 0.66), V(0.075, 0.11, 0.61), V(0.1, 0.135, 0.54), V(0.11, 0.15, 0.49)], [0.032, 0.029, 0.024, 0.008], sides=8, flat=0.3, normal_hint=V(-0.5, 1, 0)), C["blue_dark"], rigid("chest"))

    # ---- 腰帶、腰包、短褲、披風下擺 ----
    m.add("belt", loft([(0.425, 0.106, 0.088, 0, 0), (0.462, 0.103, 0.085, 0, 0)], 28), C["leather"], torso_w, group="gloss", solid=0.008)
    m.add("buckle", ellipsoid((0, -0.096, 0.443), (0.026, 0.008, 0.021), 10, 6, p=3.2), C["gold"], torso_w, group="gloss")
    m.add("buckle_in", ellipsoid((0, -0.102, 0.443), (0.014, 0.004, 0.01), 8, 4, p=3.2), C["leather_dark"], torso_w, group="gloss")
    m.add("pouch", ellipsoid((-0.095, -0.055, 0.405), (0.034, 0.03, 0.038), 10, 8, p=3), C["leather"], rigid("hips"), group="gloss")
    m.add("pouch_flap", ellipsoid((-0.097, -0.083, 0.418), (0.03, 0.006, 0.022), 8, 4, p=3), C["leather_light"], rigid("hips"), group="gloss")
    m.add("pouch_clasp", ellipsoid((-0.097, -0.09, 0.405), (0.008, 0.004, 0.007), 6, 4, p=3), C["gold"], rigid("hips"), group="gloss")
    m.add("shorts_hip", loft([(0.32, 0.104, 0.086, 0, 0), (0.37, 0.108, 0.088, 0, 0), (0.43, 0.104, 0.086, 0, 0)], 24, cap_bottom=True), C["shorts"], torso_w)
    for s, x in (("l", 1), ("r", -1)):
        ta, tb = BONE[f"thigh_{s}"]
        m.add(f"shorts_leg_{s}", tube([ta + V(0.005 * x, 0, -0.02), ta.lerp(tb, 0.82)], [0.056, 0.052], sides=12), C["shorts"], leg_w(s))
        m.add(f"shorts_cuff_{s}", torus(ta.lerp(tb, 0.82), 0.05, 0.007, 14, 5), C["shorts"], leg_w(s))

    def hem(th, k):
        if k < 3:
            return (1.0, 0.0)
        deg = math.degrees(th) % 360
        pts = min(abs(deg - 40), abs(deg - 320), abs(deg - 180), abs(deg - 110), abs(deg - 250))
        return (1.0, -0.035 * math.exp(-((pts / 9) ** 2)))

    skirt = [(0.455, 0.112, 0.093, 0, 0.0), (0.4, 0.125, 0.105, 0, 0.004), (0.33, 0.145, 0.125, 0, 0.01), (0.26, 0.162, 0.142, 0, 0.016)]
    m.add("tabard", loft(skirt, 30, a0=36, a1=324, radial=hem), lambda p: mix(C["blue"], C["blue_dark"], 0.35 * smooth(0.45, 0.26, p[2])), skirt_w, solid=0.007)
    trim = [(0.272, 0.166, 0.146, 0, 0.016), (0.252, 0.168, 0.148, 0, 0.017)]
    m.add("tabard_trim", loft(trim, 30, a0=36, a1=324, radial=lambda th, k: hem(th, 3)), C["gold"], skirt_w, group="gloss", solid=0.004)
    for a in (36, 324):
        th = math.radians(a)
        pts = [V((rx + 0.005) * math.sin(th), cy - (ry + 0.005) * math.cos(th), z) for (z, rx, ry, _, cy) in skirt]
        m.add(f"tabard_edge_{a}", tube(pts, [0.0055] * 4, sides=6), C["gold"], skirt_w, group="gloss")
    m.add("tabard_star", star_prism((0, 0.158, 0.33), V(0, 1, 0.18), 0.05, 0.02, 0.006), C["gold"], rigid("hips"), group="gloss")
    m.add("tabard_star_f1", star_prism((0.11, -0.105, 0.31), V(0.7, -1, 0.1), 0.016, 0.007, 0.004), C["gold"], skirt_w, group="gloss")
    m.add("tabard_star_f2", star_prism((-0.11, -0.105, 0.31), V(-0.7, -1, 0.1), 0.016, 0.007, 0.004), C["gold"], skirt_w, group="gloss")
    return m


# ============================================================== 女性初心者


def build_female():
    m = Model("NoviceFemale")
    hc, hf = add_body_common(m, female=True)
    dark, light = C["hair_f_dark"], C["hair_f_light"]
    hair_cap(m, hf, hc, 1.08, lambda u: u.z > 0.3 or (u.y > -0.1 and u.z > -0.75) or (u.y > -0.55 and u.z > -0.05), dark, light)
    up, back = V(0, 0, 1), V(0, 1, 0)
    i = 0

    def S(az, el, L, w, d0, d1, flat=0.45, segs=6):
        nonlocal i
        add_strand(m, f"hair_{i}", strand(hf, hc, az, el, L, w, d0, d1, flat=flat, segs=segs, inset=0.02), dark, light)
        i += 1

    # 鮑伯髮外層：往外鼓再往下、髮尾內捲（到下巴下方）
    for az in range(50, 311, 20):
        S(az, 20, 0.26, 0.13, lambda n: n * 0.65 - up * 0.75, lambda n: -n * 0.35 - up * 0.9, segs=7)
    # 內層（後腦較短）
    for az in range(80, 285, 34):
        S(az, -10, 0.17, 0.11, lambda n: n * 0.4 - up, lambda n: -n * 0.3 - up)
    # 頭頂蓬鬆
    for az in range(0, 360, 45):
        S(az + 20, 60, 0.1, 0.11, lambda n: n * 0.5 + back * 0.2 + up * 0.2, lambda n: n - up * 0.5, flat=0.4)
    S(-15, 82, 0.1, 0.04, lambda n: V(0.2, 0.1, 1), lambda n: V(-0.6, -0.5, 0.2), flat=0.6)  # 呆毛
    S(5, 82, 0.08, 0.035, lambda n: V(-0.1, 0.2, 1), lambda n: V(0.5, -0.4, 0.1), flat=0.6)
    # 鬢髮（臉頰兩側較長）
    for az in (58, -58):
        S(az, 28, 0.25, 0.075, lambda n: n * 0.3 + V(0, -0.15, -1), lambda n: V(0, -0.2, -1))
    # 瀏海
    for az, L in ((-48, 0.12), (-32, 0.135), (-16, 0.14), (0, 0.13), (16, 0.14), (32, 0.13), (48, 0.115)):
        S(az, 56, L, 0.08, lambda n: n * 0.55 + V(0, -0.45, -0.45), lambda n: V(0, -0.2, -1))
    # 側馬尾（角色左側上方 = +X）：往外往後，再往下，髮尾外翹
    pc = hf(head_dir(76, 44))
    for k, (dx, dy, L) in enumerate(((0.0, 0.0, 0.24), (0.02, 0.035, 0.22), (-0.01, 0.05, 0.2), (0.03, -0.02, 0.21), (0.01, 0.07, 0.17), (0.04, 0.02, 0.19))):
        p0 = pc + V(-0.015, dy * 0.4, dx * 0.4)
        p1 = p0 + V(0.09, 0.04 + dy, 0.04)
        p2 = p1 + V(0.06 + dx, 0.05 + dy, -L)
        add_strand(m, f"tail_{k}", tube(bezier(p0, p1, p2, 7), [0.06 * (1 - j / 6) ** 0.8 + 0.003 for j in range(7)], sides=6, flat=0.6, normal_hint=V(1, 0, 0), point_end=True), dark, light)
    # 蝴蝶結（紫，大）＋金星
    bc = pc + V(0.035, 0.0, 0.03)
    for sgn in (1, -1):
        m.add(f"bow_loop_{sgn}", ellipsoid(bc + V(0.0, 0.066 * sgn, 0.025), (0.03, 0.07, 0.05), 12, 8), lambda p: mix(C["purple"], C["purple_light"], 0.3), rigid("head"), group="gloss")
        m.add(f"bow_tail_{sgn}", tube([bc, bc + V(0.012, 0.03 * sgn, -0.06), bc + V(0.024, 0.045 * sgn, -0.11)], [0.028, 0.022, 0.008], sides=6, flat=0.3, normal_hint=V(1, 0, 0)), C["purple"], rigid("head"), group="gloss")
    m.add("bow_knot", ellipsoid(bc + V(0.012, 0, 0.02), (0.024, 0.026, 0.026), 10, 6), C["purple"], rigid("head"), group="gloss")
    m.add("bow_star", star_prism(bc + V(0.036, 0, 0.022), V(1, -0.2, 0.2), 0.024, 0.01, 0.006), C["gold"], rigid("head"), group="gloss")

    # ---- 上衣：白色短上衣、泡泡袖、頸圈與寶石、馬甲 ----
    blouse = [(0.40, 0.094, 0.078, 0, 0), (0.46, 0.086, 0.072, 0, 0), (0.52, 0.09, 0.076, 0, 0), (0.58, 0.1, 0.082, 0, 0), (0.62, 0.104, 0.074, 0, 0), (0.655, 0.07, 0.056, 0, 0), (0.685, 0.045, 0.042, 0, 0)]
    m.add("blouse", loft(blouse, 28, cap_bottom=True), C["white"], torso_w)
    m.add("choker", torus((0, 0, 0.672), 0.043, 0.008, 18, 5), C["choker"], torso_w, group="gloss")
    m.add("choker_gem", ellipsoid((0, -0.05, 0.664), (0.01, 0.006, 0.013), 8, 6), C["gem"], torso_w, group="gloss")
    m.add("brooch", ellipsoid((0, -0.088, 0.6), (0.016, 0.008, 0.02), 10, 6), C["gem"], torso_w, group="gloss")
    m.add("brooch_rim", torus((0, -0.084, 0.6), 0.018, 0.004, 12, 4), C["gold"], torso_w, group="gloss")
    for s, x in (("l", 1), ("r", -1)):
        ua, ub = BONE[f"upperarm_{s}"]
        m.add(f"puff_{s}", ellipsoid(ua.lerp(ub, 0.18), (0.058, 0.056, 0.05), 12, 8), C["white"], arm_w(s))
        m.add(f"armlet_{s}", tube([ua.lerp(ub, 0.5), ua.lerp(ub, 0.62)], [0.035, 0.034], sides=10), C["leather"], arm_w(s), group="gloss")
    m.add("corset", loft([(0.425, 0.098, 0.082, 0, 0), (0.47, 0.093, 0.077, 0, 0), (0.53, 0.097, 0.081, 0, 0)], 26), C["leather"], torso_w, group="gloss", solid=0.008)
    m.add("corset_belt", loft([(0.43, 0.104, 0.088, 0, 0), (0.452, 0.104, 0.088, 0, 0)], 26), C["leather_dark"], torso_w, group="gloss", solid=0.005)
    m.add("buckle", ellipsoid((0, -0.096, 0.441), (0.022, 0.007, 0.016), 10, 6, p=3.2), C["gold"], torso_w, group="gloss")
    m.add("corset_lace", tube([V(0, -0.088, 0.44), V(0, -0.084, 0.53)], [0.004, 0.004], sides=5), C["gold"], torso_w, group="gloss")

    # ---- 裙子：白色＋粉色荷葉層、紫色外裙（前開、後長）＋金邊 ----
    def wave(n, amp, ph=0.0):
        return lambda th, k: ((1 + amp * math.sin(n * th + ph)) if k > 0 else 1.0, 0.0)

    m.add("skirt_white", loft([(0.44, 0.1, 0.085, 0, 0), (0.37, 0.15, 0.13, 0, 0.005), (0.285, 0.176, 0.154, 0, 0.008)], 36, radial=wave(14, 0.05)), C["pink_white"], skirt_w, solid=0.006)
    m.add("skirt_pink", loft([(0.445, 0.104, 0.088, 0, 0), (0.38, 0.152, 0.132, 0, 0.004), (0.31, 0.172, 0.15, 0, 0.006)], 36, radial=wave(12, 0.06, 0.4)), C["pink"], skirt_w, solid=0.006)

    def over(th, k):
        deg = math.degrees(th) % 360
        back = math.cos(math.radians(deg - 180))  # 1 背面、-1 正面
        if k == 0:
            return (1.0, 0.0)
        return (1.0, -0.05 * (back + 1) / 2 * (k / 3))

    oskirt = [(0.45, 0.108, 0.092, 0, 0), (0.39, 0.15, 0.13, 0, 0.006), (0.33, 0.175, 0.153, 0, 0.012), (0.285, 0.186, 0.164, 0, 0.016)]
    m.add("overskirt", loft(oskirt, 30, a0=42, a1=318, radial=over), lambda p: mix(C["purple"], C["purple_light"], 0.55 * smooth(0.42, 0.25, p[2])), skirt_w, solid=0.007)
    ot = [(0.285 + 0.018, 0.19, 0.168, 0, 0.016), (0.285 - 0.002, 0.192, 0.17, 0, 0.017)]
    m.add("overskirt_trim", loft(ot, 30, a0=42, a1=318, radial=lambda th, k: over(th, 3)), C["gold"], skirt_w, group="gloss", solid=0.004)
    for a in (42, 318):
        th = math.radians(a)
        pts = [V((rx + 0.005) * math.sin(th), cy - (ry + 0.005) * math.cos(th), z + over(th, k)[1]) for k, (z, rx, ry, _, cy) in enumerate(oskirt)]
        m.add(f"overskirt_edge_{a}", tube(pts, [0.005] * 4, sides=6), C["gold"], skirt_w, group="gloss")
    m.add("overskirt_star", star_prism((0, 0.17, 0.31), V(0, 1, 0.2), 0.04, 0.016, 0.005), C["gold"], rigid("hips"), group="gloss")
    m.add("bloomers", loft([(0.335, 0.098, 0.082, 0, 0), (0.38, 0.1, 0.084, 0, 0)], 20, cap_bottom=True), C["purple_light"], torso_w)
    return m


# ============================================================== Blender 物件


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def activate(obj, others=()):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in others:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def make_materials(tag, face_png):
    def vc_mat(name, rough):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = 0.0
        return mat

    matte = vc_mat(f"{tag}_Matte", 0.78)
    gloss = vc_mat(f"{tag}_Gloss", 0.42)
    face = bpy.data.materials.new(f"{tag}_Face")
    face.use_nodes = True
    nt = face.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(face_png)
    tex.interpolation = "Linear"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.6
    try:
        face.blend_method = "BLEND"
    except Exception:
        pass
    try:
        face.surface_render_method = "BLENDED"
    except Exception:
        pass
    return {"matte": matte, "gloss": gloss, "face": face}


def build_objects(model, mats):
    groups = {"matte": [], "gloss": [], "face": []}
    for (name, verts, faces, cf, wf, group, solid, uvs) in model.parts:
        me = bpy.data.meshes.new(f"{model.name}_{name}")
        me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
        me.validate(clean_customdata=False)
        me.update()
        obj = link(bpy.data.objects.new(f"{model.name}_{name}", me))
        attr = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
        for k, v in enumerate(me.vertices):
            r, g, b = cf(tuple(v.co))
            attr.data[k].color = (r, g, b, 1.0)
        me.color_attributes.active_color = attr
        if uvs is not None:
            uvl = me.uv_layers.new(name="UVMap")
            for poly in me.polygons:
                for li in poly.loop_indices:
                    uvl.data[li].uv = uvs[me.loops[li].vertex_index]
        else:
            me.uv_layers.new(name="UVMap")
        # 權重
        vgs = {}
        for k, v in enumerate(me.vertices):
            w = wf(tuple(v.co))
            tot = sum(w.values())
            for bn, val in w.items():
                if val <= 1e-4:
                    continue
                if bn not in vgs:
                    vgs[bn] = obj.vertex_groups.new(name=bn)
                vgs[bn].add([k], val / tot, "REPLACE")
        for p in me.polygons:
            p.use_smooth = True
        me.materials.append(mats[group])
        if solid > 0:
            mod = obj.modifiers.new("solid", "SOLIDIFY")
            mod.thickness = solid
            mod.offset = 0.0
            mod.use_even_offset = True
            activate(obj)
            bpy.ops.object.modifier_apply(modifier=mod.name)
        groups[group].append(obj)
    out = {}
    for g, objs in groups.items():
        if not objs:
            continue
        activate(objs[0], objs[1:])
        bpy.ops.object.join()
        o = bpy.context.view_layer.objects.active
        o.name = {"matte": "Body", "gloss": "Gloss", "face": "Face"}[g] + ("_M" if model.name.endswith("Male") else "_F")
        o.data.name = o.name
        out[g] = o
    return out


def build_rig(name):
    data = bpy.data.armatures.new(f"{name}_Skeleton")
    rig = link(bpy.data.objects.new(name, data))
    activate(rig)
    bpy.ops.object.mode_set(mode="EDIT")
    ebs = {}
    for bn, parent, h, t in BONES:
        eb = data.edit_bones.new(bn)
        eb.head = h
        eb.tail = t
        eb.roll = 0.0
        if parent:
            eb.parent = ebs[parent]
            eb.use_connect = False
        ebs[bn] = eb
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return rig


def skin(objs, rig):
    for o in objs:
        o.parent = rig
        mod = o.modifiers.new("Armature", "ARMATURE")
        mod.object = rig


# ============================================================== 動畫（骨架空間的旋轉 → 骨頭區域旋轉）


def E(x=0.0, y=0.0, z=0.0):
    return (x, y, z)


def pose_rot(rig, bn, deg):
    """deg：繞骨架空間 X、Y、Z 軸的旋轉（度），以骨頭自己的關節為中心"""
    pb = rig.pose.bones[bn]
    M = pb.bone.matrix_local.to_3x3()
    R = Euler(tuple(math.radians(a) for a in deg), "XYZ").to_matrix()
    q = (M.inverted() @ R @ M).to_quaternion()
    pb.rotation_quaternion = q


def pose_loc(rig, bn, d):
    pb = rig.pose.bones[bn]
    M = pb.bone.matrix_local.to_3x3()
    pb.location = M.inverted() @ Vector(d)


IDLE_BASE = {
    "upperarm_l": E(0, 0, 0),
    "upperarm_r": E(0, 0, 0),
    "lowerarm_l": E(-10, 0, 0),
    "lowerarm_r": E(-10, 0, 0),
}


def anim_idle(t, T=2.4):
    b = math.sin(2 * math.pi * t / T)
    return {
        "chest": E(1.6 * b, 0, 0),
        "neck": E(-0.8 * b, 0, 0),
        "head": E(-0.8 * b, 0, 1.5 * math.sin(2 * math.pi * t / (T * 2))),
        "upperarm_l": E(1.5 * b, -2 * b, 0),
        "upperarm_r": E(1.5 * b, 2 * b, 0),
        "lowerarm_l": E(-10 - 2 * b, 0, 0),
        "lowerarm_r": E(-10 - 2 * b, 0, 0),
        "_root": (0, 0, -0.003 * (1 - b) / 2),
    }


def gait(t, T, A, B, Cs, elbow, lean, bob):
    ph = 2 * math.pi * t / T
    s, c = math.sin(ph), math.cos(ph)
    sr, cr = -s, -c
    return {
        "thigh_l": E(-A * s, 0, 0),
        "thigh_r": E(-A * sr, 0, 0),
        "shin_l": E(B * max(0.0, c) + 6, 0, 0),
        "shin_r": E(B * max(0.0, cr) + 6, 0, 0),
        "foot_l": E(0.45 * A * s - 0.3 * B * max(0.0, c), 0, 0),
        "foot_r": E(0.45 * A * sr - 0.3 * B * max(0.0, cr), 0, 0),
        "upperarm_l": E(Cs * s, 0, 0),
        "upperarm_r": E(Cs * sr, 0, 0),
        "lowerarm_l": E(-elbow, 0, 0),
        "lowerarm_r": E(-elbow, 0, 0),
        "spine": E(lean, 0, 0),
        "chest": E(0, 0, 5 * s),
        "hips": E(0, 0, -4 * s),
        "head": E(-lean * 0.6, 0, -3 * s),
        "_root": (0, 0, bob * (1 + math.cos(2 * ph)) / 2 - bob / 2),
    }


def anim_walk(t):
    return gait(t, 0.9, 24, 38, 20, 16, 3, 0.012)


def anim_run(t):
    return gait(t, 0.56, 40, 80, 45, 70, 11, 0.026)


def keyframes(t, keys):
    """keys：[(時間, 姿勢字典)]，各關鍵格之間 smoothstep 插值"""
    for k in range(len(keys) - 1):
        t0, p0 = keys[k]
        t1, p1 = keys[k + 1]
        if t <= t1 or k == len(keys) - 2:
            u = smooth(0, 1, clamp((t - t0) / (t1 - t0)))
            out = {}
            for bn in set(p0) | set(p1):
                a = p0.get(bn, (0, 0, 0))
                b = p1.get(bn, (0, 0, 0))
                out[bn] = tuple(a[i] + (b[i] - a[i]) * u for i in range(3))
            return out
    return keys[-1][1]


REST = {"lowerarm_l": E(-10, 0, 0), "lowerarm_r": E(-10, 0, 0)}


def anim_attack(t):
    # 0～0.14 蓄力（右手往後拉、身體右轉）、0.14～0.26 揮擊（0.20 揮中）、0.26～0.50 收招
    windup = {
        "upperarm_r": E(55, 25, 0),
        "lowerarm_r": E(-75, 0, 0),
        "chest": E(-4, 0, -22),
        "spine": E(-4, 0, -6),
        "upperarm_l": E(-20, 0, 0),
        "lowerarm_l": E(-30, 0, 0),
        "thigh_r": E(10, 0, 0),
        "thigh_l": E(-6, 0, 0),
        "shin_l": E(8, 0, 0),
        "head": E(0, 0, 10),
    }
    strike = {
        "upperarm_r": E(-95, 0, -8),
        "lowerarm_r": E(-8, 0, 0),
        "chest": E(6, 0, 26),
        "spine": E(10, 0, 8),
        "upperarm_l": E(28, 0, 0),
        "lowerarm_l": E(-20, 0, 0),
        "thigh_l": E(-22, 0, 0),
        "shin_l": E(20, 0, 0),
        "thigh_r": E(14, 0, 0),
        "shin_r": E(10, 0, 0),
        "head": E(-4, 0, -12),
        "_root": (0, -0.04, -0.012),
    }
    follow = dict(strike)
    follow.update({"upperarm_r": E(-80, 0, 12), "chest": E(5, 0, 18)})
    return keyframes(t, [(0.0, REST), (0.14, windup), (0.2, strike), (0.26, follow), (0.5, REST)])


def anim_hurt(t):
    hit = {
        "spine": E(-14, 0, 4),
        "chest": E(-8, 0, 0),
        "head": E(-16, 0, -6),
        "upperarm_l": E(22, -14, 0),
        "upperarm_r": E(22, 14, 0),
        "lowerarm_l": E(-35, 0, 0),
        "lowerarm_r": E(-35, 0, 0),
        "shin_l": E(10, 0, 0),
        "shin_r": E(10, 0, 0),
        "_root": (0, 0.035, -0.01),
    }
    return keyframes(t, [(0.0, REST), (0.08, hit), (0.2, hit), (0.45, REST)])


def anim_death(t):
    hit = anim_hurt(0.1)
    fall = {
        "root": E(-88, 0, 0),
        "spine": E(-6, 0, 0),
        "head": E(-10, 0, 14),
        "upperarm_l": E(-30, -40, 0),
        "upperarm_r": E(-30, 40, 0),
        "lowerarm_l": E(-20, 0, 0),
        "lowerarm_r": E(-20, 0, 0),
        "thigh_l": E(-14, 0, 0),
        "thigh_r": E(-4, 0, 0),
        "shin_l": E(30, 0, 0),
        "shin_r": E(12, 0, 0),
        "_root": (0, 0.0, 0.1),
    }
    settle = dict(fall)
    settle["_root"] = (0, 0.0, 0.095)
    return keyframes(t, [(0.0, REST), (0.12, hit), (0.3, hit), (0.85, fall), (1.0, settle), (1.3, settle)])


ANIMS = [
    ("Idle", 2.4, anim_idle, True),
    ("Walk", 0.9, anim_walk, True),
    ("Run", 0.56, anim_run, True),
    ("Attack", 0.5, anim_attack, False),
    ("Hurt", 0.45, anim_hurt, False),
    ("Death", 1.3, anim_death, False),
]


def apply_pose(rig, pose):
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    for bn, d in pose.items():
        if bn == "_root":
            pose_loc(rig, "root", d)
        else:
            pose_rot(rig, bn, d)


def bake_actions(rig):
    rig.animation_data_create()
    acts = {}
    for name, length, fn, loop in ANIMS:
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        frames = int(round(length * FPS))
        for f in range(frames + 1):
            t = f / FPS
            if loop and f == frames:
                t = 0.0  # 迴圈首尾相同
            apply_pose(rig, fn(t))
            for pb in rig.pose.bones:
                pb.keyframe_insert("rotation_quaternion", frame=f + 1)
                if pb.name == "root":
                    pb.keyframe_insert("location", frame=f + 1)
        try:
            act.use_frame_range = True
            act.frame_start = 1
            act.frame_end = frames + 1
            act.use_cyclic = loop
        except Exception:
            pass
        acts[name] = act
        track = rig.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, 1, act)
    rig.animation_data.action = None
    return acts


# ============================================================== 匯出


def export_glb(path, objs):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    kw = dict(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_vertex_color="MATERIAL",
        export_skins=True,
        export_all_influences=False,
        export_def_bones=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_step=1,
        export_optimize_animation_size=True,
        export_anim_single_armature=True,
        export_reset_pose_bones=True,
        export_morph=False,
        export_extras=True,
    )
    for _ in range(12):
        try:
            bpy.ops.export_scene.gltf(**kw)
            return
        except TypeError as e:
            msg = str(e)
            bad = [k for k in kw if f'"{k}"' in msg]
            if not bad:
                raise
            print("export: drop unsupported option", bad)
            for k in bad:
                kw.pop(k)
    raise RuntimeError("export failed")


def build_character(model, tag, face_png, info):
    mats = make_materials(tag, face_png)
    rig = build_rig(model.name)
    parts = build_objects(model, mats)
    meshes = list(parts.values())
    skin(meshes, rig)
    rig["starwish"] = json.dumps({"asset": f"novice_{tag.lower()}", "version": VERSION, "expressions": ["smile", "happy", "surprised", "serious", "hurt", "ko", "blink", "spare"], "atlas": [4, 2]})
    acts = bake_actions(rig)
    zs = [(o.matrix_world @ v.co).z for o in meshes for v in o.data.vertices]
    xs = [(o.matrix_world @ v.co).x for o in meshes for v in o.data.vertices]
    rec = {"height": max(zs) - min(zs), "minZ": min(zs), "width": max(xs) - min(xs), "bones": [b[0] for b in BONES], "animations": {n: round(len_, 3) for n, len_, _, _ in ANIMS}, "lods": {}}
    # high
    path = os.path.join(OUT, f"novice_{tag.lower()}_{VERSION}_high.glb")
    export_glb(path, [rig] + meshes)
    rec["lods"]["high"] = {"bytes": os.path.getsize(path), "triangles": {o.name: tri_count(o) for o in meshes}, "triangles_total": sum(tri_count(o) for o in meshes)}
    # low：身體與光澤網格減面（臉部貼片不變）
    low = []
    for o in meshes:
        c = o.copy()
        c.data = o.data.copy()
        c.name = o.name + "_low"
        link(c)
        c.parent = rig
        if o is not parts.get("face"):
            mod = c.modifiers.new("dec", "DECIMATE")
            mod.ratio = 0.5
            mod.use_collapse_triangulate = True
            # 減面要在骨架之前套用
            activate(c)
            bpy.ops.object.modifier_move_to_index(modifier="dec", index=0)
            bpy.ops.object.modifier_apply(modifier="dec")
        low.append(c)
    for o in meshes:
        o.hide_set(True)
    path = os.path.join(OUT, f"novice_{tag.lower()}_{VERSION}_low.glb")
    export_glb(path, [rig] + low)
    rec["lods"]["low"] = {"bytes": os.path.getsize(path), "triangles": {o.name: tri_count(o) for o in low}, "triangles_total": sum(tri_count(o) for o in low)}
    for o in low:
        bpy.data.objects.remove(o, do_unlink=True)
    for o in meshes:
        o.hide_set(False)
    info[tag] = rec
    return rig, meshes, acts


# ============================================================== 渲染（三視圖、動作）


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 40
    sc.cycles.use_denoising = True
    sc.render.resolution_x = 600
    sc.render.resolution_y = 760
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("World")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.92, 0.93, 0.96, 1)
    bg.inputs["Strength"].default_value = 0.42

    def light(name, loc, energy, size, rot):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.shape = "DISK"
        ld.size = size
        lo = link(bpy.data.objects.new(name, ld))
        lo.location = loc
        lo.rotation_euler = rot
        return lo

    rig = link(bpy.data.objects.new("LightRig", None))
    for lo in (
        light("Key", (-1.6, -2.2, 2.6), 150, 1.4, (math.radians(45), 0, math.radians(-35))),
        light("Rim", (1.8, 1.6, 1.8), 70, 1.0, (math.radians(-55), 0, math.radians(130))),
        light("Fill", (0.6, -2.6, 0.7), 45, 1.6, (math.radians(80), 0, 0)),
    ):
        lo.parent = rig
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
    g = bpy.context.active_object
    gm = bpy.data.materials.new("Ground")
    gm.use_nodes = True
    gm.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.85, 0.86, 0.9, 1)
    g.data.materials.append(gm)
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 1.5
    cam = link(bpy.data.objects.new("Cam", cam_data))
    sc.camera = cam
    return cam, rig


def render_character(tag, rig, meshes, acts, others, cam, lrig):
    sc = bpy.context.scene
    for o in others:
        o.hide_render = True
    for o in meshes:
        o.hide_render = False
    cz = 0.63
    rig.animation_data.action = acts["Idle"]
    sc.frame_set(1)
    views = {"front": ((0, -5, cz), (math.radians(90), 0, 0)), "side": ((5, 0, cz), (math.radians(90), 0, math.radians(90))), "back": ((0, 5, cz), (math.radians(90), 0, math.radians(180)))}
    for name, (loc, rot) in views.items():
        cam.location = loc
        cam.rotation_euler = rot
        lrig.rotation_euler = (0, 0, rot[2])
        sc.render.filepath = os.path.join(OUT, f"render_{tag.lower()}_{name}.png")
        bpy.ops.render.render(write_still=True)
    # 動作：斜前方
    cam.location = (3.2, -3.8, 0.75)
    cam.rotation_euler = (math.radians(88), 0, math.radians(40))
    lrig.rotation_euler = (0, 0, math.radians(40))
    for name, act, frame in (("run", "Run", 5), ("attack", "Attack", 7), ("hurt", "Hurt", 4), ("death", "Death", 39)):
        rig.animation_data.action = acts[act]
        sc.frame_set(frame)
        sc.render.filepath = os.path.join(OUT, f"pose_{tag.lower()}_{name}.png")
        bpy.ops.render.render(write_still=True)
    rig.animation_data.action = None


def main():
    info = {"version": VERSION, "fps": FPS}
    # 每個角色在全新的場景建立、匯出、渲染：GLB 只會帶自己的動畫（不會混入另一個角色的動作）
    for tag, mk, face in (("Male", build_male, "novice_face_male.png"), ("Female", build_female, "novice_face_female.png")):
        reset()
        for a in list(bpy.data.actions):
            bpy.data.actions.remove(a)
        bpy.context.scene.render.fps = FPS
        model = mk()
        rig, meshes, acts = build_character(model, tag, os.path.join(TEX, face), info)
        print(tag, json.dumps(info[tag]["lods"]["high"]["triangles_total"]), "tris")
        if RENDER:
            cam, lrig = setup_render()
            render_character(tag, rig, meshes, acts, [], cam, lrig)
    with open(os.path.join(OUT, "novice_info.json"), "w") as f:
        json.dump(info, f, indent=1, ensure_ascii=False)
    print("done")


main()
