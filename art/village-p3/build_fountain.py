"""P3-1A／P3-1B 星願之泉：造型（1A 已驗收）＋水面、落水、泡沫網格與材質（1B）。

blender -b --factory-startup -P build_fountain.py -- --tex <貼圖資料夾> --out <輸出資料夾> [--previews 0]
P3-1B：石材＝可重複石紋 × 烘焙環境光遮蔽頂點色（HQ 另有法線貼圖）；金、晶、水、落水、泡沫在遊戲端換成輕量材質
（見 src/maps/village/FountainP3.ts）。網格依材質分開：stone / gold / crystal / water / falls / foam。

座標：Blender Z 向上（匯出 GLB 時轉成 Y 向上）。單位公尺。中心 (0,0)。
- 外池：外徑 14 m（含最外圈低矮台階，正好落在遊戲碰撞半徑 7 m 上）、真正中空
- 第二層水盤：直徑約 6 m，8 個出水口
- 中央雕刻石柱＋托爪，頂端八角星晶（Y 4.3～6.5）
- 金色雙環：直徑 3.5 m、4.2 m，細環＋小星裝飾
- 預留（只在預覽中以淡藍色標示，不匯出到 GLB）：外池水面、上層水面、8 道落水
HQ 與 Lite 由同一份參數化造型產生（Lite 降低旋轉分段，不是直接減面）。
"""

import json
import math
import os
import sys
import time

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
args = dict(zip(argv[::2], argv[1::2]))
OUT = os.path.abspath(args.get("--out", "out"))
TEX = os.path.abspath(args.get("--tex", os.path.join(OUT, "textures")))
PREVIEWS = args.get("--previews", "1") != "0"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vp3_kit  # noqa: E402
os.makedirs(OUT, exist_ok=True)

# ---------------- 尺寸（公尺） ----------------
R_OUT = 7.0  # 外徑 14 m（＝碰撞半徑）
STEP_H = 0.18
WALL_R = 6.62
INNER_R = 6.0
FLOOR_Z = 0.22
RIM_TOP = 0.86
WATER1_Z = 0.62  # 外池水面（預留）
BOWL_R = 3.0  # 第二層水盤直徑 6 m
BOWL_TOP = 2.34
WATER2_Z = 2.24  # 上層水面（預留）
COL_TOP = 4.32
CRYSTAL_BOTTOM = 4.3
CRYSTAL_TOP = 6.5
CRYSTAL_C = 5.35
RING_C = 5.2  # 雙環中心（傾角壓低，環頂不超過 Y≈6.5）
RING_A_R = 1.75  # 直徑 3.5 m
RING_B_R = 2.1  # 直徑 4.2 m
RING_T = 0.032

LODS = {
    "hq": dict(basin=128, bowl=96, column=64, flutes=16, ring=(120, 10), tube=10, band=6, star_relief=16, finial=16,
               water=(128, 96), fall=(6, 14), foam=24),
    "lite": dict(basin=48, bowl=40, column=32, flutes=8, ring=(56, 5), tube=4, band=4, star_relief=8, finial=6,
                 water=(40, 32), fall=(4, 8), foam=12),
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def clay(name, rgb, rough=0.55, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit[0], 1)
        b.inputs["Emission Strength"].default_value = emit[1]
    return m


def new_obj(name, bm, mat, smooth_angle=38):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
    except Exception:  # noqa: BLE001
        me.shade_smooth()
    return ob


def lathe(name, profile, seg, mat, smooth_angle=38, flute=None):
    """profile：[(r, z), ...] 由外到內／由下到上；繞 Z 軸旋轉一圈
    flute＝(z0, z1, n, depth)：在 z0～z1 之間刻 n 道直向凹槽（柱身雕刻）"""
    bm = bmesh.new()
    vs = [bm.verts.new((r, 0.0, z)) for r, z in profile]
    edges = [bm.edges.new((vs[i], vs[i + 1])) for i in range(len(vs) - 1)]
    bmesh.ops.spin(bm, geom=vs + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=math.tau, steps=seg, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    if flute:
        z0, z1, n, depth = flute
        for v in bm.verts:
            if z0 <= v.co.z <= z1:
                a = math.atan2(v.co.y, v.co.x)
                k = 1 - depth * max(0.0, math.cos(n * a)) ** 2
                v.co.x *= k
                v.co.y *= k
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_obj(name, bm, mat, smooth_angle)
    ob["lathe"] = True
    return ob


def star_prism(name, points, r_out, r_in, depth, mat, m=Matrix()):
    """星形浮雕（擠出的星形多邊形），m 為放置矩陣（本地 +Z＝浮雕朝外方向）"""
    bm = bmesh.new()
    ring_f, ring_b = [], []
    for i in range(points * 2):
        a = math.pi / 2 + i * math.pi / points
        r = r_out if i % 2 == 0 else r_in
        ring_b.append(bm.verts.new((r * math.cos(a), r * math.sin(a), 0)))
        ring_f.append(bm.verts.new((r * 0.82 * math.cos(a), r * 0.82 * math.sin(a), depth)))
    c = bm.verts.new((0, 0, depth * 1.25))
    n = len(ring_f)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((ring_b[i], ring_b[j], ring_f[j], ring_f[i]))
        bm.faces.new((ring_f[i], ring_f[j], c))
    bm.faces.new(list(reversed(ring_b)))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj(name, bm, mat, smooth_angle=20)


def tube(name, pts, radius, sides, mat, taper=1.0):
    """沿路徑的圓管（托爪、出水口）；taper＝末端半徑比例"""
    bm = bmesh.new()
    rings = []
    for k, p in enumerate(pts):
        p = Vector(p)
        t = (Vector(pts[min(k + 1, len(pts) - 1)]) - Vector(pts[max(k - 1, 0)])).normalized()
        up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        u = t.cross(up).normalized()
        v = t.cross(u).normalized()
        rr = radius * (1 + (taper - 1) * k / (len(pts) - 1))
        rings.append([bm.verts.new(p + (u * math.cos(a) + v * math.sin(a)) * rr) for a in (i * math.tau / sides for i in range(sides))])
    for a, b in zip(rings, rings[1:]):
        for i in range(sides):
            j = (i + 1) % sides
            bm.faces.new((a[i], a[j], b[j], b[i]))
    for ring, end in ((rings[0], True), (rings[-1], False)):
        c = bm.verts.new(sum((v.co for v in ring), Vector()) / sides)
        for i in range(sides):
            j = (i + 1) % sides
            bm.faces.new((ring[j], ring[i], c) if end else (ring[i], ring[j], c))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj(name, bm, mat, smooth_angle=50)


def torus(name, R, r, seg, mat, rot=(0, 0, 0), loc=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=seg[0], minor_segments=seg[1], location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(mat)
    o.data.shade_smooth()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o


def crystal(name, mat):
    """八角星晶：八角雙錐＋中段切面腰帶＋8 道短星芒"""
    bm = bmesh.new()
    top = bm.verts.new((0, 0, CRYSTAL_TOP))
    bot = bm.verts.new((0, 0, CRYSTAL_BOTTOM))
    rings = []
    for z, r, off in ((5.95, 0.42, 0.0), (5.45, 0.6, math.pi / 8), (5.1, 0.55, 0.0), (4.75, 0.34, math.pi / 8)):
        rings.append([bm.verts.new((r * math.cos(off + i * math.tau / 8), r * math.sin(off + i * math.tau / 8), z)) for i in range(8)])
    for i in range(8):
        j = (i + 1) % 8
        bm.faces.new((rings[0][i], rings[0][j], top))
    for a, b in zip(rings, rings[1:]):
        for i in range(8):
            j = (i + 1) % 8
            bm.faces.new((a[i], b[i], b[j], a[j]))
    for i in range(8):
        j = (i + 1) % 8
        bm.faces.new((rings[-1][j], rings[-1][i], bot))
    # 8 道星芒：腰帶上的細長四角錐
    for i in range(8):
        a = math.pi / 8 + i * math.tau / 8
        d = Vector((math.cos(a), math.sin(a), 0))
        s = Vector((-d.y, d.x, 0))
        base = d * 0.56 + Vector((0, 0, 5.45))
        tip = bm.verts.new(base + d * (0.42 if i % 2 == 0 else 0.26))
        q = [bm.verts.new(base + s * 0.07 + Vector((0, 0, 0.07))), bm.verts.new(base - s * 0.07 + Vector((0, 0, 0.07))), bm.verts.new(base - s * 0.07 - Vector((0, 0, 0.07))), bm.verts.new(base + s * 0.07 - Vector((0, 0, 0.07)))]
        for k in range(4):
            bm.faces.new((q[k], q[(k + 1) % 4], tip))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = False
    return ob


def ensure_up(ob):
    """開口環形：確認頂面法線朝上（否則整個翻面）"""
    me = ob.data
    ups = [p.normal.z for p in me.polygons if abs(p.normal.z) > 0.9]
    if ups and sum(ups) < 0:
        for p in me.polygons:
            p.flip()
        me.update()


def vc_mat(name, rough=0.8):
    """頂點色材質（石材：貼圖改由遊戲端共用載入，GLB 不內嵌）"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], b.inputs["Base Color"])
    return m


def build(lod, M):
    P = LODS[lod]
    parts = []
    # 外池：台階＋池壁（浮雕帶）＋圓潤池緣＋內壁＋池底（真正中空）
    basin = [
        (R_OUT, 0.0), (R_OUT, STEP_H - 0.03), (R_OUT - 0.03, STEP_H),
        (WALL_R + 0.06, STEP_H), (WALL_R + 0.02, STEP_H + 0.04),  # 牆腳線腳
        (WALL_R, STEP_H + 0.1), (WALL_R, 0.36), (WALL_R - 0.04, 0.38), (WALL_R - 0.04, 0.52), (WALL_R, 0.54),  # 浮雕凹帶
        (WALL_R, 0.66), (WALL_R + 0.08, 0.7), (WALL_R + 0.1, 0.76), (WALL_R + 0.06, 0.83),  # 池緣外側圓弧
        (WALL_R - 0.05, RIM_TOP), (INNER_R + 0.1, RIM_TOP), (INNER_R - 0.02, 0.82), (INNER_R - 0.04, 0.74),  # 池緣頂面與內側
        (INNER_R, 0.66), (INNER_R, FLOOR_Z + 0.06), (INNER_R - 0.08, FLOOR_Z),  # 內壁
        (3.6, FLOOR_Z), (1.6, FLOOR_Z + 0.02), (1.3, FLOOR_Z + 0.02),
    ]
    parts.append(lathe("basin", basin, P["basin"], M["stone"], smooth_angle=35))
    # 外池壁上的星形浮雕（面朝外）
    for i in range(P["star_relief"]):
        a = i * math.tau / P["star_relief"]
        n = Vector((math.cos(a), math.sin(a), 0))
        mat = Matrix.Translation(n * (WALL_R - 0.045) + Vector((0, 0, 0.45))) @ Vector((0, 0, 1)).rotation_difference(n).to_matrix().to_4x4()
        # P3-2D：八芒星浮雕改成金色（少量金飾），五芒星維持石雕
        parts.append(star_prism(f"relief{i}", 5 if i % 2 else 8, 0.2, 0.08, 0.06, M["stone"] if i % 2 else M["gold"], mat))
    # P3-2D：池緣頂面金色細環（HQ；Lite 面數已用滿）
    if lod == "hq":
        ring = lathe("rimGold", [(6.28, RIM_TOP - 0.004), (6.28, RIM_TOP + 0.007), (6.38, RIM_TOP + 0.007), (6.38, RIM_TOP - 0.004)], 96, M["gold"], smooth_angle=20)
        ensure_up(ring)
        parts.append(ring)
    # 8 根矮扶壁（池壁外側，每 45°）
    for i in range(8):
        a = math.pi / 8 + i * math.tau / 8
        bpy.ops.mesh.primitive_cube_add(size=1, location=(math.cos(a) * (WALL_R + 0.1), math.sin(a) * (WALL_R + 0.1), (STEP_H + 0.7) / 2 + 0.04), rotation=(0, 0, a))
        o = bpy.context.active_object
        o.scale = (0.22, 0.34, 0.7 - STEP_H + 0.12)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        mod = o.modifiers.new("b", "BEVEL")
        mod.width = 0.03
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier=mod.name)
        o.name = f"buttress{i}"
        o.data.materials.append(M["stone"])
        parts.append(o)
        # 扶壁柱頭：小方帽＋寶珠，高出池緣
        cx, cy = math.cos(a) * (WALL_R + 0.12), math.sin(a) * (WALL_R + 0.12)
        # P3-1B 微調：寶珠降低（頂 1.33 → 1.10），柱帽直接坐在扶壁頂（0.80）
        cap = [(0.0, 0.8), (0.19, 0.8), (0.2, 0.84), (0.15, 0.88), (0.1, 0.9), (0.12, 0.95), (0.125, 1.0), (0.1, 1.05), (0.05, 1.085), (0.0, 1.1)]
        c = lathe(f"finial{i}", cap, P["finial"], M["stone"], smooth_angle=50)
        c.location = (cx, cy, 0)
        parts.append(c)
    # 第二層水盤：腰身台座（多道線腳）＋外翻盤身＋盤緣＋盤內
    bowl = [
        (1.3, FLOOR_Z + 0.02), (1.3, 0.4), (1.1, 0.48), (0.95, 0.62), (0.88, 0.95), (0.95, 1.05), (0.82, 1.15),
        (0.7, 1.45), (0.74, 1.6), (0.66, 1.7), (1.2, 1.86), (2.0, 1.98), (2.7, 2.08), (BOWL_R, 2.16),
        (BOWL_R + 0.08, 2.24), (BOWL_R + 0.04, 2.32), (BOWL_R - 0.08, BOWL_TOP), (BOWL_R - 0.2, 2.3), (BOWL_R - 0.24, 2.22),
        (2.4, 2.14), (1.2, 2.1), (0.6, 2.1),
    ]
    parts.append(lathe("bowl", bowl, P["bowl"], M["stone"], smooth_angle=35))
    # 8 個出水口：盤緣外側的小型花瓣嘴（朝外略下）
    for i in range(8):
        a = i * math.tau / 8
        d = Vector((math.cos(a), math.sin(a), 0))
        p0 = d * (BOWL_R - 0.02) + Vector((0, 0, 2.2))
        pts = [p0, p0 + d * 0.16 + Vector((0, 0, 0.02)), p0 + d * 0.3 - Vector((0, 0, 0.01)), p0 + d * 0.4 - Vector((0, 0, 0.06))]
        parts.append(tube(f"spout{i}", pts, 0.12, P["tube"], M["gold"], taper=0.5))  # P3-2D：金色出水口
    # 盤底 8 支渦捲托架（在出水口之間），讓水盤不像單薄的碟子
    for i in range(8):
        a = math.pi / 8 + i * math.tau / 8
        d = Vector((math.cos(a), math.sin(a), 0))
        pts = [d * 0.8 + Vector((0, 0, 1.2)), d * 1.15 + Vector((0, 0, 1.55)), d * 1.7 + Vector((0, 0, 1.85)), d * 2.3 + Vector((0, 0, 2.0)), d * 2.55 + Vector((0, 0, 1.94)), d * 2.5 + Vector((0, 0, 1.86))]
        parts.append(tube(f"bracket{i}", pts, 0.09, P["tube"], M["stone"], taper=0.6))
    # 中央石柱：基座、帶收分的柱身、兩道金色環帶、柱頭
    col = [
        (0.6, 2.1), (0.62, 2.22), (0.5, 2.3), (0.52, 2.42), (0.4, 2.52),
        (0.36, 2.7), (0.34, 3.2), (0.33, 3.7), (0.34, 4.0), (0.42, 4.08), (0.5, 4.18), (0.56, 4.26), (0.5, COL_TOP), (0.0, COL_TOP),
    ]
    parts.append(lathe("column", col, P["column"], M["stone"], smooth_angle=40, flute=(2.85, 3.75, P["flutes"], 0.07)))
    for z in (2.75, 3.85):
        parts.append(torus(f"colBand{z}", 0.355, 0.035, (P["column"], P["band"]), M["gold"], loc=(0, 0, z)))
    # 柱身 4 個星形浮雕
    for i in range(4):
        a = math.pi / 4 + i * math.tau / 4
        n = Vector((math.cos(a), math.sin(a), 0))
        mat = Matrix.Translation(n * 0.335 + Vector((0, 0, 3.3))) @ Vector((0, 0, 1)).rotation_difference(n).to_matrix().to_4x4()
        parts.append(star_prism(f"colStar{i}", 8, 0.12, 0.05, 0.03, M["gold"], mat))
    # 托爪：4 支彎曲托臂，從柱頭往上托住星晶
    for i in range(4):
        a = i * math.tau / 4
        d = Vector((math.cos(a), math.sin(a), 0))
        pts = [d * 0.42 + Vector((0, 0, 4.2)), d * 0.62 + Vector((0, 0, 4.45)), d * 0.66 + Vector((0, 0, 4.75)), d * 0.52 + Vector((0, 0, 5.05)), d * 0.4 + Vector((0, 0, 5.2))]
        parts.append(tube(f"claw{i}", pts, 0.05, P["tube"], M["gold"], taper=0.45))
    # 八角星晶
    parts.append(crystal("crystal", M["crystal"]))
    # 金色雙環（細、傾斜）＋環上小星
    RA, RB = (38, 0, 20), (-28, 12, -35)
    ringA = torus("ringA", RING_A_R, RING_T, P["ring"], M["gold"], rot=tuple(math.radians(v) for v in RA), loc=(0, 0, RING_C))
    ringB = torus("ringB", RING_B_R, RING_T, P["ring"], M["gold"], rot=tuple(math.radians(v) for v in RB), loc=(0, 0, RING_C))
    parts += [ringA, ringB]
    for ring, R, rot in ((ringA, RING_A_R, RA), (ringB, RING_B_R, RB)):
        rm = Matrix.Rotation(math.radians(rot[2]), 4, "Z") @ Matrix.Rotation(math.radians(rot[1]), 4, "Y") @ Matrix.Rotation(math.radians(rot[0]), 4, "X")
        for k in range(4):
            a = math.pi / 4 + k * math.tau / 4
            p = rm @ Vector((R * math.cos(a), R * math.sin(a), 0)) + Vector((0, 0, RING_C))
            m = Matrix.Translation(p) @ Vector((0, 0, 1)).rotation_difference((p - Vector((0, 0, RING_C))).normalized()).to_matrix().to_4x4()
            parts.append(star_prism(f"ringStar{k}", 5, 0.11, 0.045, 0.03, M["gold"], m))
    # 星晶腰帶的金色小星座（取代原本浮在頂端的小星，避免超出 Y 6.5）
    for i in range(4):
        a = i * math.tau / 4
        n = Vector((math.cos(a), math.sin(a), 0))
        m = Matrix.Translation(n * 0.36 + Vector((0, 0, 4.62))) @ Vector((0, 0, 1)).rotation_difference(n).to_matrix().to_4x4()
        parts.append(star_prism(f"crownStar{i}", 5, 0.09, 0.037, 0.025, M["gold"], m))
    return parts


# ---------------- P3-1B 水體網格 ----------------
FALL_L = 0.7  # 落水水平前進距離（m）
WATER1_IN, WATER1_OUT = 0.9, INNER_R + 0.03  # 外池水面：內緣藏進水盤底座，外緣插進池壁 3 cm（不留縫、不共面）
WATER2_IN, WATER2_OUT = 0.55, 2.79  # 上層水面：內緣藏進柱座，外緣插進盤內壁


def spout_tip(i):
    a = i * math.tau / 8
    d = Vector((math.cos(a), math.sin(a), 0))
    p0 = d * (BOWL_R - 0.02) + Vector((0, 0, 2.2))
    return d, p0 + d * 0.4 - Vector((0, 0, 0.06))


def set_rgba(ob, fn):
    """逐頂點 RGBA（線性），fn(co) -> (r,g,b,a)"""
    me = ob.data
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for v, d in zip(me.vertices, ca.data):
        d.color = fn(v.co)
    me.color_attributes.active_color = ca


def annulus(bm, uv, r_list, seg, z, uv_fn, cx=0.0, cy=0.0):
    rings = [[bm.verts.new((cx + r * math.cos(i * math.tau / seg), cy + r * math.sin(i * math.tau / seg), z)) for i in range(seg)] for r in r_list]
    for a, b in zip(rings, rings[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            for lp in f.loops:
                lp[uv].uv = uv_fn(lp.vert.co, lp.vert, f)
    return rings


def foam_u(co, f, cx, cy):
    """泡沫環的 u（角度，展開時以面中心為基準，避免接縫面整片拉伸）"""
    c = f.calc_center_median()
    a0 = math.atan2(c.y - cy, c.x - cx)
    a = math.atan2(co.y - cy, co.x - cx)
    while a - a0 > math.pi:
        a -= math.tau
    while a - a0 < -math.pi:
        a += math.tau
    return a / math.tau * 3


def build_water(lod, mats):
    P = LODS[lod]
    out = {}
    # 1) 水面：外池＋上層水盤合成一個網格（同材質＝1 次繪製）；平面 UV 每 2.2 m 重複；頂點色＝邊緣略暗（池壁陰影感）
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    pl = lambda co, v, f: (co.x / 2.2, co.y / 2.2)  # noqa: E731
    annulus(bm, uv, (WATER1_IN, 3.2, WATER1_OUT) if lod == "hq" else (WATER1_IN, WATER1_OUT), P["water"][0], WATER1_Z, pl)
    annulus(bm, uv, (WATER2_IN, WATER2_OUT), P["water"][1], WATER2_Z, pl)
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    me = bpy.data.meshes.new("WishFountain_water")
    bm.to_mesh(me)
    bm.free()
    w = bpy.data.objects.new("WishFountain_water", me)
    bpy.context.scene.collection.objects.link(w)
    me.materials.append(mats["water"])

    def wcol(co):
        # P3-2D：深淺層次（遊戲端 StandardMaterial，頂點色為 sRGB）：中央較深的藍、池緣淺的青綠
        r = math.hypot(co.x, co.y)
        upper = co.z > 1.5
        r0, r1 = (WATER2_IN, WATER2_OUT) if upper else (WATER1_IN, WATER1_OUT)
        t = min(1.0, max(0.0, (r - r0) / (r1 - r0))) ** 1.4
        deep = (0.56, 0.84, 0.92) if upper else (0.44, 0.75, 0.88)
        shallow = (0.82, 0.98, 0.95) if upper else (0.76, 0.96, 0.92)
        return tuple(deep[i] + (shallow[i] - deep[i]) * t for i in range(3)) + (1.0,)

    set_rgba(w, wcol)
    out["water"] = w
    # 2) 落水：8 道拋物線水柱（開口管，無端蓋）。從出水口內 5 cm 開始，末端插到水面下 4 cm，不碰池壁
    sides, segs = P["fall"]
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    fall_meta = []
    for i in range(8):
        d, tip = spout_tip(i)
        z0 = tip.z
        drop = z0 - (WATER1_Z - 0.04)
        a_lin = 0.5 * FALL_L
        b_sq = drop - a_lin
        start = tip - d * 0.05
        pts = []
        for k in range(segs + 1):
            t = k / segs
            pts.append(Vector((0, 0, 0)) + start + d * (FALL_L * t) - Vector((0, 0, a_lin * t + b_sq * t * t)) * (1 if k else 0) + (Vector((0, 0, 0))))
        pts[0] = start
        rings, vlen, acc = [], [], 0.0
        for k, p in enumerate(pts):
            if k:
                acc += (p - pts[k - 1]).length
            vlen.append(acc)
            t = (pts[min(k + 1, segs)] - pts[max(k - 1, 0)]).normalized()
            side = t.cross(Vector((0, 0, 1))).normalized() if abs(t.z) < 0.999 else Vector((-d.y, d.x, 0))
            nrm = side.cross(t).normalized()
            rr = 0.055 + 0.045 * (k / segs)
            # 稍微扁平（寬：厚＝1.35：1），像一道水簾
            rings.append([bm.verts.new(p + side * math.cos(q * math.tau / sides) * rr * 1.35 + nrm * math.sin(q * math.tau / sides) * rr) for q in range(sides)])
        for k in range(segs):
            for q in range(sides):
                q2 = q + 1
                f = bm.faces.new((rings[k][q], rings[k][q2 % sides], rings[k + 1][q2 % sides], rings[k + 1][q]))
                for lp, (uu, vv) in zip(f.loops, ((q / sides, vlen[k]), (q2 / sides, vlen[k]), (q2 / sides, vlen[k + 1]), (q / sides, vlen[k + 1]))):
                    lp[uv].uv = (uu, vv / 0.9)
        fall_meta.append({"tip": [round(tip.x, 3), round(tip.y, 3), round(tip.z, 3)], "land": [round(pts[-1].x, 3), round(pts[-1].y, 3), round(pts[-1].z, 3)]})
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("WishFountain_falls")
    bm.to_mesh(me)
    bm.free()
    fo = bpy.data.objects.new("WishFountain_falls", me)
    bpy.context.scene.collection.objects.link(fo)
    me.materials.append(mats["falls"])
    me.shade_smooth()

    def fcol(co):
        # 透明度：出水口 0.9 → 中段 0.8 → 入水 0.45（與水面柔和銜接）
        t = min(1.0, max(0.0, (2.14 - co.z) / (2.14 - WATER1_Z)))
        a = 0.9 - 0.1 * t - 0.35 * max(0.0, (t - 0.7) / 0.3)
        return (1.0, 1.0, 1.0, a)

    set_rgba(fo, fcol)
    out["falls"] = fo
    # 3) 泡沫環：每道落水的入水點一圈（高於水面 1.5 cm；遊戲端再加 zOffset），V＝徑向，外緣透明
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    r_in, r_out = 0.07, 0.6
    for m in fall_meta:
        cx, cy = m["land"][0], m["land"][1]
        annulus(
            bm, uv, (r_in, r_out), P["foam"], WATER1_Z + 0.015,
            lambda co, v, f, cx=cx, cy=cy: (foam_u(co, f, cx, cy), (math.hypot(co.x - cx, co.y - cy) - r_in) / (r_out - r_in)),
            cx, cy,
        )
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    me = bpy.data.meshes.new("WishFountain_foam")
    bm.to_mesh(me)
    bm.free()
    fm = bpy.data.objects.new("WishFountain_foam", me)
    bpy.context.scene.collection.objects.link(fm)
    me.materials.append(mats["foam"])
    landings = [(m["land"][0], m["land"][1]) for m in fall_meta]

    def mcol(co):
        r = min(math.hypot(co.x - x, co.y - y) for x, y in landings)
        return (1.0, 1.0, 1.0, 0.7 if r < 0.3 else 0.0)

    set_rgba(fm, mcol)
    out["foam"] = fm
    return out, fall_meta


def lathe_uv(ob, tile):
    """旋轉體 UV：側面用圓柱展開（u＝角度×該點半徑，v＝高度），朝上／下的面用平面投影；每 tile 公尺重複"""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        if abs(f.normal.z) > 0.7:
            for lp in f.loops:
                lp[uv].uv = (lp.vert.co.x / tile, lp.vert.co.y / tile)
            continue
        fc = f.calc_center_median()
        a0 = math.atan2(fc.y, fc.x)
        for lp in f.loops:
            co = lp.vert.co
            a = math.atan2(co.y, co.x)
            while a - a0 > math.pi:
                a -= math.tau
            while a - a0 < -math.pi:
                a += math.tau
            r = max(math.hypot(co.x, co.y), 0.3)
            lp[uv].uv = (a * r / tile, co.z / tile)
    bm.to_mesh(me)
    bm.free()


def simple_mat(name, rgb, rough=0.5, metal=0.0, emit=None):
    """頂點色 × 顏色的簡單材質（遊戲端會換成 StandardMaterial，這裡只是預設值與 Blender 預覽用）"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit[0], 1)
        b.inputs["Emission Strength"].default_value = emit[1]
    return m


def white(ob):
    me = ob.data
    if "Col" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["Col"])
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for d in ca.data:
        d.color = (1, 1, 1, 1)
    me.color_attributes.active_color = ca


def tri_count(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    j = bpy.context.view_layer.objects.active
    j.name = name
    return j


def export_glb(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_vertex_color="ACTIVE")


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    sc.view_settings.exposure = -0.3
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.86, 0.9, 0.97, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.45
    sc.world = w
    for name, rot, e, ang in (("key", (50, 0, -35), 2.4, 4), ("fill", (70, 0, 145), 0.5, 25)):
        L = bpy.data.lights.new(name, "SUN")
        L.energy = e
        L.angle = math.radians(ang)
        o = bpy.data.objects.new(name, L)
        o.rotation_euler = [math.radians(a) for a in rot]
        sc.collection.objects.link(o)
    cam = bpy.data.cameras.new("cam")
    co = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    return co


def shoot(cam, target, yaw, elev, dist, path, res=(1200, 800), lens=40, ortho=None):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    if ortho:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = ortho
    else:
        cam.data.type = "PERSP"
        cam.data.lens = lens
    a, e = math.radians(yaw), math.radians(elev)
    t = Vector(target)
    cam.location = t + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
    cam.rotation_euler = (t - cam.location).normalized().to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    t0 = time.time()
    report = {"lods": {}, "budget": {"hq": 28000, "lite": 11000}}
    log = []
    for lod in ("lite", "hq"):
        reset()
        M = {
            "stone": vc_mat("VP3_stone"),
            "gold": simple_mat("VP3_gold", (0.86, 0.68, 0.36), rough=0.35, metal=0.6),
            "crystal": simple_mat("VP3_crystal", (0.62, 0.84, 0.98), rough=0.15, emit=((0.35, 0.65, 1.0), 0.8)),
            "water": simple_mat("VP3_water", (0.6, 0.84, 0.96), rough=0.1),
            "falls": simple_mat("VP3_falls", (0.85, 0.94, 1.0), rough=0.1),
            "foam": simple_mat("VP3_foam", (1, 1, 1), rough=0.6),
        }
        key_of = {M[k].name: k for k in ("stone", "gold", "crystal")}
        parts = build(lod, M)
        groups = {"stone": [], "gold": [], "crystal": []}
        for p in parts:
            groups[key_of[p.data.materials[0].name]].append(p)
        # 石材 UV（旋轉體圓柱展開，其他方塊投影）＋白色頂點色（之後乘環境光遮蔽）
        for p in groups["stone"]:
            bpy.context.view_layer.objects.active = p
            bpy.ops.object.select_all(action="DESELECT")
            p.select_set(True)
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            if p.get("lathe") and abs(p.location.x) < 1e-6 and p.name in ("basin", "bowl", "column"):
                lathe_uv(p, 2.0)
            else:
                vp3_kit.box_uv(p, 2.0)
            white(p)
        for p in groups["gold"] + groups["crystal"]:
            white(p)
        merged = {k: vp3_kit_join(v, f"WishFountain_{k}") for k, v in groups.items() if v}
        # 環境光遮蔽烘焙到石材頂點色（金環、星晶一起當遮擋物；水體在烘焙之後才建立）
        ok = vp3_kit.bake_ao([merged["stone"]], samples=32, strength=0.7, log=log)
        water, fall_meta = build_water(lod, M)
        allm = {**merged, **water}
        per = {k: tri_count([o]) for k, o in allm.items()}
        tris = sum(per.values())
        objs = list(allm.values())
        export_glb(objs, os.path.join(OUT, f"fountain_{lod}.glb"))
        verts = [o.matrix_world @ v.co for o in merged.values() for v in o.data.vertices]
        report["lods"][lod] = {
            "triangles": tris,
            "within_budget": tris <= report["budget"][lod],
            "by_mesh": per,
            "meshes": len(objs),
            "ao_baked": ok,
            "bounds": {"radius": round(max(math.hypot(v.x, v.y) for v in verts), 3), "top": round(max(v.z for v in verts), 3)},
            "bytes": os.path.getsize(os.path.join(OUT, f"fountain_{lod}.glb")),
        }
        report["falls"] = fall_meta
        if lod == "hq" and PREVIEWS:
            bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=11.0, depth=0.02, location=(0, 0, -0.01))
            g = bpy.context.active_object
            g.data.materials.append(simple_mat("ground", (0.5, 0.52, 0.5), rough=0.95))
            cam = setup_render()
            shoot(cam, (0, 0, 2.4), 45, 24, 24, os.path.join(OUT, "fountain_blender_q45.png"))
    report["log"] = log
    report["seconds"] = round(time.time() - t0, 1)
    report["dims"] = {
        "outer_diameter": R_OUT * 2,
        "basin_inner_diameter": INNER_R * 2,
        "rim_top": RIM_TOP,
        "finial_top": 1.1,
        "bowl_diameter": BOWL_R * 2,
        "bowl_top": BOWL_TOP,
        "crystal": [CRYSTAL_BOTTOM, CRYSTAL_TOP],
        "rings_diameter": [RING_A_R * 2, RING_B_R * 2],
        "water1": {"z": WATER1_Z, "r": [WATER1_IN, round(WATER1_OUT, 3)]},
        "water2": {"z": WATER2_Z, "r": [WATER2_IN, WATER2_OUT]},
        "spouts": 8,
    }
    with open(os.path.join(OUT, "fountain_report.json"), "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1))
    if not all(v["within_budget"] for v in report["lods"].values()):
        raise SystemExit("三角面超出預算")


def vp3_kit_join(objs, name):
    j = join(objs, name)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return j


main()
