"""P3-1A 星願之泉：正式造型（灰色黏土模型，不含正式材質）＋預覽圖＋尺寸對照。

blender -b --factory-startup -P build_fountain.py -- --out <輸出資料夾>

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
RING_A_R = 1.75  # 直徑 3.5 m
RING_B_R = 2.1  # 直徑 4.2 m
RING_T = 0.032

LODS = {
    "hq": dict(basin=128, bowl=96, column=48, ring=(120, 10), tube=10, star_relief=16),
    "lite": dict(basin=64, bowl=48, column=24, ring=(64, 6), tube=6, star_relief=8),
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


def lathe(name, profile, seg, mat, smooth_angle=38):
    """profile：[(r, z), ...] 由外到內／由下到上；繞 Z 軸旋轉一圈"""
    bm = bmesh.new()
    vs = [bm.verts.new((r, 0.0, z)) for r, z in profile]
    edges = [bm.edges.new((vs[i], vs[i + 1])) for i in range(len(vs) - 1)]
    bmesh.ops.spin(bm, geom=vs + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=math.tau, steps=seg, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj(name, bm, mat, smooth_angle)


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
        mat = Matrix.Translation(n * (WALL_R - 0.015) + Vector((0, 0, 0.45))) @ Vector((0, 0, 1)).rotation_difference(n).to_matrix().to_4x4()
        parts.append(star_prism(f"relief{i}", 5 if i % 2 else 8, 0.13, 0.055, 0.035, M["stone"], mat))
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
        parts.append(tube(f"spout{i}", pts, 0.085, P["tube"], M["stone"], taper=0.55))
    # 中央石柱：基座、帶收分的柱身、兩道金色環帶、柱頭
    col = [
        (0.6, 2.1), (0.62, 2.22), (0.5, 2.3), (0.52, 2.42), (0.4, 2.52),
        (0.36, 2.7), (0.34, 3.2), (0.33, 3.7), (0.34, 4.0), (0.42, 4.08), (0.5, 4.18), (0.56, 4.26), (0.5, COL_TOP), (0.0, COL_TOP),
    ]
    parts.append(lathe("column", col, P["column"], M["stone"], smooth_angle=40))
    for z in (2.75, 3.85):
        parts.append(torus(f"colBand{z}", 0.355, 0.035, (P["column"], 6), M["gold"], loc=(0, 0, z)))
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
    ringA = torus("ringA", RING_A_R, RING_T, P["ring"], M["gold"], rot=(math.radians(64), 0, math.radians(20)), loc=(0, 0, CRYSTAL_C))
    ringB = torus("ringB", RING_B_R, RING_T, P["ring"], M["gold"], rot=(math.radians(-58), math.radians(18), math.radians(-35)), loc=(0, 0, CRYSTAL_C))
    parts += [ringA, ringB]
    for ring, R, rot in ((ringA, RING_A_R, (64, 0, 20)), (ringB, RING_B_R, (-58, 18, -35))):
        rm = Matrix.Rotation(math.radians(rot[2]), 4, "Z") @ Matrix.Rotation(math.radians(rot[1]), 4, "Y") @ Matrix.Rotation(math.radians(rot[0]), 4, "X")
        for k in range(4):
            a = math.pi / 4 + k * math.tau / 4
            p = rm @ Vector((R * math.cos(a), R * math.sin(a), 0)) + Vector((0, 0, CRYSTAL_C))
            m = Matrix.Translation(p) @ Vector((0, 0, 1)).rotation_difference((p - Vector((0, 0, CRYSTAL_C))).normalized()).to_matrix().to_4x4()
            parts.append(star_prism(f"ringStar{k}", 5, 0.11, 0.045, 0.03, M["gold"], m))
    # 頂端小金星（星晶上方，與星晶分開、浮在空中）
    top = Matrix.Translation(Vector((0, 0, CRYSTAL_TOP + 0.32))) @ Matrix.Rotation(math.pi / 2, 4, "X")
    parts.append(star_prism("topStar", 5, 0.2, 0.08, 0.05, M["gold"], top))
    return parts


def reserve_markers(M):
    """預留位置（只在預覽顯示、不匯出）：外池水面、上層水面、8 道落水"""
    out = []
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=INNER_R - 0.05, depth=0.01, location=(0, 0, WATER1_Z))
    out.append(bpy.context.active_object)
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=BOWL_R - 0.26, depth=0.01, location=(0, 0, WATER2_Z))
    out.append(bpy.context.active_object)
    for i in range(8):
        a = i * math.tau / 8
        d = Vector((math.cos(a), math.sin(a), 0))
        p0 = d * (BOWL_R + 0.4) + Vector((0, 0, 2.12))
        pts = [p0 + d * (0.25 * math.sin(t * math.pi / 2)) - Vector((0, 0, (2.12 - WATER1_Z) * t * t)) for t in (k / 6 for k in range(7))]
        out.append(tube(f"fall{i}", pts, 0.06, 6, M["water"], taper=1.6))
    for o in out:
        o.data.materials.clear()
        o.data.materials.append(M["water"])
        o["reserve"] = True
    return out


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
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True)


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.86, 0.9, 0.97, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.85
    sc.world = w
    for name, rot, e, ang in (("key", (52, 0, -30), 3.2, 6), ("fill", (66, 0, 140), 0.9, 25)):
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
    report = {"lods": {}}
    for lod in ("lite", "hq"):
        reset()
        M = {
            "stone": clay("clay_stone", (0.82, 0.8, 0.77)),
            "gold": clay("clay_gold", (0.86, 0.72, 0.42), rough=0.4),
            "crystal": clay("clay_crystal", (0.62, 0.82, 0.95), rough=0.25, emit=((0.4, 0.7, 1.0), 0.35)),
            "water": clay("reserve_water", (0.55, 0.78, 0.98), rough=0.2),
        }
        parts = build(lod, M)
        groups = {"stone": [], "gold": [], "crystal": []}
        for p in parts:
            key = "gold" if p.data.materials[0].name.startswith("clay_gold") else "crystal" if p.data.materials[0].name.startswith("clay_crystal") else "stone"
            groups[key].append(p)
        per = {k: tri_count(v) for k, v in groups.items()}
        merged = [join(v, f"WishFountain_{k}") for k, v in groups.items() if v]
        tris = tri_count(merged)
        export_glb(merged, os.path.join(OUT, f"fountain_{lod}.glb"))
        bb = [Vector(c) for o in merged for c in (o.matrix_world @ Vector(cc) for cc in o.bound_box)]
        report["lods"][lod] = {
            "triangles": tris,
            "by_material": per,
            "meshes": len(merged),
            "bounds": {"radius": round(max(math.hypot(v.x, v.y) for v in bb), 3), "top": round(max(v.z for v in bb), 3)},
            "bytes": os.path.getsize(os.path.join(OUT, f"fountain_{lod}.glb")),
        }
        if lod == "hq":
            reserve = reserve_markers(M)
            report["reserve_triangles_preview_only"] = tri_count(reserve)
            # 預覽地面＋參考：可走範圍邊界（碰撞半徑 7 m＋角色半徑）、噴泉步道 r 11、1.25 m 角色
            bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=11.0, depth=0.02, location=(0, 0, -0.01))
            g = bpy.context.active_object
            g.data.materials.append(clay("ground", (0.9, 0.88, 0.84), rough=0.9))
            cam = setup_render()
            shoot(cam, (0, 0, 2.6), 0, 10, 24, os.path.join(OUT, "fountain_front.png"))
            shoot(cam, (0, 0, 2.4), 45, 24, 24, os.path.join(OUT, "fountain_q45.png"))
            shoot(cam, (0, 0, 0), 0, 89.5, 30, os.path.join(OUT, "fountain_top.png"), res=(1000, 1000))
            shoot(cam, (0, 0, 5.25), 28, 10, 7.5, os.path.join(OUT, "fountain_close.png"), lens=45)
            # 尺寸對照：正面正交圖＋俯視正交圖（加上碰撞圈、步道圈、角色）
            ref = []
            for R, col in ((7.0, (0.9, 0.2, 0.2)), (10.5, (0.2, 0.45, 0.95))):
                ref.append(torus(f"ref{R}", R, 0.05, (160, 6), clay(f"ref{R}", col), loc=(0, 0, 0.02)))
            bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.3, depth=1.25, location=(7.6, -0.5, 0.625))
            hm = bpy.context.active_object
            hm.data.materials.append(clay("human", (0.95, 0.55, 0.7)))
            ref.append(hm)
            shoot(cam, (0, 0, 3.4), 0, 0, 40, os.path.join(OUT, "fountain_elev.png"), res=(1400, 700), ortho=16.5)
            shoot(cam, (0, 0, 0), 0, 90, 40, os.path.join(OUT, "fountain_plan.png"), res=(1000, 1000), ortho=23.5)
    report["seconds"] = round(time.time() - t0, 1)
    report["dims"] = {
        "outer_diameter": R_OUT * 2,
        "basin_inner_diameter": INNER_R * 2,
        "rim_top": RIM_TOP,
        "bowl_diameter": BOWL_R * 2,
        "bowl_top": BOWL_TOP,
        "crystal": [CRYSTAL_BOTTOM, CRYSTAL_TOP],
        "rings_diameter": [RING_A_R * 2, RING_B_R * 2],
        "water1_z": WATER1_Z,
        "water2_z": WATER2_Z,
        "spouts": 8,
    }
    with open(os.path.join(OUT, "fountain_report.json"), "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1))


main()
