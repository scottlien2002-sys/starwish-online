"""星芽村 P3 共用幾何工具（P3-2B 起的建築使用；P3-2A 廣場腳本保持原樣不改）。

平面座標 (X 東, Z 北, H 高) 建模，輸出成 Blender (−X, −Z, H)；匯入 Babylon 後回到村莊座標。
"""

import math

import bpy

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




def to_object_uv(mb, mat, face_uv):
    """同 to_object，但 UV 由 face_uv(平面座標點列) 逐面計算（牆面、屋頂的貼圖方向）"""
    ob = to_object(mb, mat)
    me = ob.data
    uvl = me.uv_layers["UVMap"]
    flat = []
    for f in mb.f:
        for uv in face_uv([mb.v[i] for i in f]):
            flat.extend(uv)
    uvl.data.foreach_set("uv", flat)
    return ob
