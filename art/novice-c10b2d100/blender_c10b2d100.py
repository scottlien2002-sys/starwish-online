"""
Stage 5.4 C1.0-B2 效能診斷 F3b：只為診斷產生的「幾何減半」模型（不是正式版本）。
- 造型、配色、臉部貼圖、零件、材質與正式 C1.0-B2 完全相同（男 = C1.0-B2、女 = C1.0-B），
  用同一份 SDF 輸出、同一個減面方式（不加權的 Decimate），只把每名角色的目標從 200,000 改成 100,000。
- 輸出新檔名 novice_c10b2d100_<g>_hq.glb；正式 novice_c10b2_*／novice_c10b_* 不動。
- 另外以同鏡頭、同燈光渲染正式 HQ（200k）與 d100 的正面、左前 45、側面、背面、頭部，供美術差異對照。
用法：blender -b --factory-startup -noaudio -P art/novice-c10b2d100/blender_c10b2d100.py -- --parts <export_c10b2 男女輸出> --out <資料夾>
"""
"""
初心者 C1.0-B1 最終精修預覽（Blender，雲端無介面；鏡頭、光照、曝光、背景與 C1.0-A 完全相同）
  blender -b --factory-startup -noaudio -P art/novice-c10b2/blender_c10b2.py -- --parts <export_c10b2 輸出> --parts-a <export_c10b1 男生輸出> --parts-f <export_c10b 女生輸出> --out <資料夾>

產出（g = male / female）：
  c10b2_<g>_<front|side|back|left45|right|back45>.png  全身（與 C1.0-A 同鏡頭）
  c10b2_<g>_head_<...>.png、c10b2_<g>_detail_<torso|legs>_<front|left45>.png
  女生裙裝檢查（C1.0-A 與 C1.0-B1 用同一個場景各拍一次，方便前後比較）：
    <c10a|c10b>_female_skirt_<front|side|right|back|left45>.png   裙裝特寫（z 0.3、範圍 0.46 公尺）
    <c10a|c10b>_female_low_<front|front30|side|back>.png           低角度（由下往上 30～55 度；拍低角度時暫時隱藏地面陰影板）
  novice_c10b2_<g>_<hq|lite>.glb、c10b2_report.json
不綁骨架、不做動畫。
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PARTS = argv[argv.index("--parts") + 1]
OUT = argv[argv.index("--out") + 1]
os.makedirs(OUT, exist_ok=True)

W, H = 1040, 1280
PX = 0.00105
Z_BOTTOM = -0.02 - 16 * PX
VIEWS = {"front": 0, "side": 90, "back": 180, "left45": 45, "right": -90, "back45": 135}  # 90 = 從角色左側看（設定圖側面）


def srgb_to_linear(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def make_material(name, surface, tex_path=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    metal, rough, spec, sheen = (list(surface) + [0.35, 0.0])[:4]
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    b.inputs["Specular IOR Level"].default_value = spec
    if sheen > 0:
        b.inputs["Sheen Weight"].default_value = sheen
        b.inputs["Sheen Roughness"].default_value = 0.6
    if tex_path:
        tx = nt.nodes.new("ShaderNodeTexImage")
        tx.image = bpy.data.images.load(tex_path)
        tx.image.colorspace_settings.name = "sRGB"
        tx.interpolation = "Cubic"
        # C1.0-A：臉部貼圖 × 頂點色（暖色環境光遮蔽）。glTF：baseColorTexture 與 COLOR_0 相乘（規格本來就這樣定義）
        ca = nt.nodes.new("ShaderNodeVertexColor")
        ca.layer_name = "Col"
        mx = nt.nodes.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        mx.blend_type = "MULTIPLY"
        mx.inputs["Factor"].default_value = 1.0
        nt.links.new(tx.outputs["Color"], mx.inputs[6])
        nt.links.new(ca.outputs["Color"], mx.inputs[7])
        nt.links.new(mx.outputs[2], b.inputs["Base Color"])
    else:
        ca = nt.nodes.new("ShaderNodeVertexColor")
        ca.layer_name = "Col"
        nt.links.new(ca.outputs["Color"], b.inputs["Base Color"])
    return m


def load(g, pre="c10b2", src=None):
    src = src or PARTS
    d = np.load(os.path.join(src, f"{pre}_{g}_parts.npz"))
    meta = json.load(open(os.path.join(src, f"{pre}_{g}_parts.json")))
    tex = os.path.join(src, f"{pre}_face_{g}.png")
    objs, mats = [], {}
    for it in meta["parts"]:
        k = it["key"]
        v = d[k + "__v"].astype(np.float64)
        q = d[k + "__q"]
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
        col = srgb_to_linear(d[k + "__c"])
        ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        ca.data.foreach_set("color", np.c_[col, np.ones(len(col))].ravel().astype(np.float32))
        if k + "__uv" in d:
            uv = d[k + "__uv"]
            ul = me.uv_layers.new(name="UVMap")
            ul.data.foreach_set("uv", uv[q.ravel()].ravel().astype(np.float32))
        mkey = ("face_" + g) if it["textured"] else (g + "_" + it["palette"])
        if mkey not in mats:
            mats[mkey] = make_material(mkey, meta["surface"].get(it["group"], (0.0, 0.6)), tex if it["textured"] else None)
        me.materials.append(mats[mkey])
        ob = bpy.data.objects.new(it["name"], me)
        bpy.context.scene.collection.objects.link(ob)
        me.shade_smooth()
        objs.append(ob)
    return objs, mats


def tri_count(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


KEEP_MORE = {"hair": 2.2, "ponytail": 2.2, "head": 1.6, "underskirt": 1.6, "petticoat": 1.6, "skirt_pink": 1.6, "overskirt": 1.5, "bow": 1.5}


def decimate_to(objs, target, weighted=False):
    tris = {o.name: max(sum(len(p.vertices) - 2 for p in o.data.polygons), 1) for o in objs}
    wts = {o.name: (KEEP_MORE.get(o.name, 1.0) if weighted else 1.0) for o in objs}
    lo, hi = 0.0, 1.0
    for _ in range(40):  # 找 k，讓 Σ tris × min(1, k × w) = target
        k = (lo + hi) / 2
        tot = sum(tris[n] * min(1.0, k * wts[n]) for n in tris)
        lo, hi = (k, hi) if tot < target else (lo, k)
    k = (lo + hi) / 2
    for o in objs:
        ratio = min(1.0, k * wts[o.name])
        bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new("dec", "DECIMATE")
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
        o.data.shade_smooth()


def setup_scene():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 96
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.93, 0.93, 0.96, 1)
    bg.inputs["Strength"].default_value = 0.75
    sc.world = world
    # 動畫風柔和光：左前上主光（柔軟陰影）＋右側補光＋背後輪廓光；所有視角共用同一組光（只轉鏡頭）
    for name, rot, energy, ang in (("key", (48, 0, -32), 2.2, 18), ("fill", (65, 0, 120), 0.6, 30), ("rim", (30, 0, 185), 1.0, 10)):
        L = bpy.data.lights.new(name, "SUN")
        L.energy = energy
        L.angle = math.radians(ang)
        o = bpy.data.objects.new(name, L)
        o.rotation_euler = [math.radians(a) for a in rot]
        sc.collection.objects.link(o)
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
    bpy.context.active_object.is_shadow_catcher = True
    cam = bpy.data.cameras.new("cam")
    cam.type = "ORTHO"
    co = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    return co


def shoot(cam, yaw, zc, scale, res, path, elev=0.0, at=(0.0, 0.0)):
    sc = bpy.context.scene
    a = math.radians(yaw)
    e = math.radians(elev)
    sc.render.resolution_x, sc.render.resolution_y = res
    cam.data.ortho_scale = scale
    cam.location = Vector((at[0] + math.sin(a) * 6 * math.cos(e), at[1] - math.cos(a) * 6 * math.cos(e), zc + 6 * math.sin(e)))
    cam.rotation_euler = (math.radians(90 - elev), 0, a)   # elev < 0：鏡頭在下方往上看
    plane = bpy.data.objects.get("Plane")
    if plane is not None:
        plane.hide_render = elev < 0      # 低角度：鏡頭在地面以下，暫時隱藏陰影板
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def export_glb(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True)


SKIRT_VIEWS = ("front", "side", "right", "back", "left45")
LOW_VIEWS = {"front": (0, -30), "front30": (30, -55), "side": (90, -30), "back": (180, -30)}


def skirt_shots(cam, pre):
    for v in SKIRT_VIEWS:
        shoot(cam, VIEWS[v], 0.3, 0.46, (1100, 1100), os.path.join(OUT, f"{pre}_female_skirt_{v}.png"))
    for v, (yaw, el) in LOW_VIEWS.items():
        shoot(cam, yaw, 0.3, 0.5, (1100, 1100), os.path.join(OUT, f"{pre}_female_low_{v}.png"), elev=el)


HQ_TRIS = 200000
D100_TRIS = 100000


def main():
    report = {}
    for g in ("male", "female"):
        res = {}
        for tag, target in (("hq", HQ_TRIS), ("d100", D100_TRIS)):
            bpy.ops.wm.read_factory_settings(use_empty=True)
            objs, mats = load(g)
            raw = tri_count(objs)
            cam = setup_scene()
            decimate_to(objs, target)   # 與正式 HQ 相同的減面方式（不加權），只有目標不同
            zc = Z_BOTTOM + H * PX / 2
            for v in ("front", "left45", "side", "back"):
                shoot(cam, VIEWS[v], zc, H * PX, (W, H), os.path.join(OUT, f"d100cmp_{tag}_{g}_{v}.png"))
            for v in ("front", "left45", "side"):
                shoot(cam, VIEWS[v], 0.9, 0.6, (1100, 1100), os.path.join(OUT, f"d100cmp_{tag}_{g}_head_{v}.png"))
            res[tag] = {
                "triangles_raw_surface_nets": raw,
                "triangles": tri_count(objs),
                "by_part": {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs},
                "parts": len(objs),
                "materials": sorted(mats.keys()),
            }
            if tag == "d100":
                export_glb(objs, os.path.join(OUT, f"novice_c10b2d100_{g}_hq.glb"))
        report[g] = res
        print(g, {t: (r["triangles"], r["parts"], len(r["materials"])) for t, r in res.items()}, flush=True)
    json.dump(report, open(os.path.join(OUT, "c10b2d100_report.json"), "w"), indent=1, ensure_ascii=False)


main()
