"""
初心者 V2 步驟 B：灰模（黏土材質）渲染＋灰模 GLB。

  blender -b --factory-startup -noaudio -P art/novice-v2/blender_clay.py -- --parts <npz 資料夾> --out <資料夾>

產出（每個角色）：
  clay_<g>_<front|side|back|left45>.png  正交、與本機比對圖同比例（1 像素 = 1.05 毫米，腳底在 z = 0）
  clay_<g>_sheet.png                    四視角並排
  novice_v2_<g>_grey.glb                灰模（每個零件一個網格；無貼圖、無骨架，只供外型檢查）
  clay_info.json                        三角形數、零件數、尺寸
注意：灰模不代表最終配色；零件用不同深淺的灰，只為了看清楚分件。
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
PARTS = argv[argv.index("--parts") + 1]
OUT = argv[argv.index("--out") + 1]
os.makedirs(OUT, exist_ok=True)

# 黏土灰階（零件分組只用深淺區分，不是最終配色）
TONE = {"skin": 0.62, "hair": 0.34, "cloth": 0.66, "cloth2": 0.26, "leather": 0.17, "metal": 0.75, "dark": 0.12, "face": 0.62}
DECIMATE_TARGET = 160000  # 每個角色 GLB 的三角形上限（灰模檢查用）

W, H = 1040, 1280
PX = 0.00105
Z_BOTTOM = -0.02 - 16 * PX  # 與本機預覽一致：腳底在倒數第 16 列


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(group):
    name = "clay_" + group
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    t = TONE.get(group, 0.7)
    b.inputs["Base Color"].default_value = (t, t, t * 0.985, 1)
    b.inputs["Roughness"].default_value = 0.42 if group in ("hair", "leather", "metal") else 0.62
    if group == "metal":
        b.inputs["Metallic"].default_value = 0.0
    return m


def load(g):
    d = np.load(os.path.join(PARTS, f"novice_v2_{g}_parts.npz"))
    info = json.load(open(os.path.join(PARTS, f"novice_v2_{g}_parts.json")))
    objs = []
    for it in info:
        v = d[it["key"] + "__v"].astype(np.float64)
        q = d[it["key"] + "__q"]
        me = bpy.data.meshes.new(it["name"])
        me.vertices.add(len(v))
        me.vertices.foreach_set("co", v.ravel())
        me.loops.add(len(q) * 4)
        me.loops.foreach_set("vertex_index", q.ravel())
        me.polygons.add(len(q))
        me.polygons.foreach_set("loop_start", np.arange(0, len(q) * 4, 4))
        me.polygons.foreach_set("loop_total", np.full(len(q), 4))
        me.update(calc_edges=True)
        me.validate()
        ob = bpy.data.objects.new(it["name"], me)
        bpy.context.scene.collection.objects.link(ob)
        me.materials.append(material(it["group"]))
        me.shade_smooth()
        objs.append(ob)
    return objs


def decimate(objs):
    tris = sum(len(o.data.polygons) * 2 for o in objs)
    ratio = min(1.0, DECIMATE_TARGET / max(tris, 1))
    if ratio < 1.0:
        for o in objs:
            bpy.context.view_layer.objects.active = o
            mod = o.modifiers.new("dec", "DECIMATE")
            mod.ratio = ratio
            mod.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=mod.name)
    for o in objs:
        o.data.shade_smooth()
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True
    sc.render.resolution_x = W
    sc.render.resolution_y = H
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.92, 0.92, 0.93, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.45
    sc.world = world
    # 主光（左上前）、補光、輪廓光
    for name, rot, energy in (("key", (50, 0, -35), 2.4), ("fill", (70, 0, 140), 0.5), ("rim", (35, 0, 180), 1.2)):
        L = bpy.data.lights.new(name, "SUN")
        L.energy = energy
        L.angle = math.radians(12)
        o = bpy.data.objects.new(name, L)
        o.rotation_euler = [math.radians(a) for a in rot]
        sc.collection.objects.link(o)
    # 地面陰影承接面
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
    pl = bpy.context.active_object
    pl.is_shadow_catcher = True
    cam = bpy.data.cameras.new("cam")
    cam.type = "ORTHO"
    cam.ortho_scale = H * PX
    co = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    return co


# 鏡頭轉角：0 = 從正前方（-Y）看；90 = 從角色左側（+X）看（與設定圖側面一致）
VIEWS = {"front": 0, "side": 90, "back": 180, "left45": 45}


def render_views(g, cam):
    zc = Z_BOTTOM + H * PX / 2
    paths = []
    for v, yaw in VIEWS.items():
        a = math.radians(yaw)
        # 視線方向 = (-sin a, cos a, 0)；鏡頭放在視線反方向 5 公尺
        cam.location = Vector((math.sin(a) * 5, -math.cos(a) * 5, zc))
        cam.rotation_euler = (math.radians(90), 0, a)
        p = os.path.join(OUT, f"clay_{g}_{v}.png")
        bpy.context.scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    return paths


def main():
    info = {}
    for g in ("male", "female"):
        clear()
        objs = load(g)
        cam = setup_render()
        render_views(g, cam)
        tris = decimate(objs)
        for o in bpy.context.scene.objects:
            o.select_set(o in objs)
        bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, f"novice_v2_{g}_grey.glb"), export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
        zs = [(o.matrix_world @ Vector(c)).z for o in objs for c in o.bound_box]
        info[g] = {"parts": len(objs), "triangles_glb": tris, "height": round(max(zs) - min(zs), 4)}
        print(g, info[g], flush=True)
    json.dump(info, open(os.path.join(OUT, "clay_info.json"), "w"), indent=1)


main()
