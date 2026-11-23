"""星芽村 P3 共用 Blender 工具（Blender 4.2，免費；只在 GitHub Actions 執行）。

- 材質：每種材質一張可重複細節貼圖 × 頂點色（色相＋烘焙環境光遮蔽）；HQ 另加法線貼圖
- UV：世界座標方塊投影（貼圖每 tile 公尺重複一次）
- 環境光遮蔽：Cycles 烘焙到頂點色（失敗時記錄並略過，不中斷）
- 匯出：HQ / Lite 兩個 GLB；Lite 先減面、改用 512² 貼圖、不帶法線貼圖
- 預覽：Cycles 透視鏡頭，正面、45°、俯視、近景
"""

import json
import math
import os

import bmesh
import bpy
from mathutils import Vector

# 材質規格：金屬度、粗糙度、每幾公尺重複一次、是否有 HQ 法線貼圖、貼圖名
MATS = {
    "stone": dict(metal=0.0, rough=0.78, tile=2.0, normal=True, tex="stone"),
    "paving": dict(metal=0.0, rough=0.82, tile=3.0, normal=True, tex="paving"),
    "roof": dict(metal=0.0, rough=0.6, tile=1.6, normal=True, tex="roof"),
    "wood": dict(metal=0.0, rough=0.7, tile=1.2, normal=False, tex="wood"),
    "metal": dict(metal=0.85, rough=0.32, tile=1.0, normal=False, tex="metal"),
    "cloth": dict(metal=0.0, rough=0.9, tile=1.0, normal=False, tex="cloth"),
    "water": dict(metal=0.0, rough=0.08, tile=2.5, normal=False, tex="water"),
    "crystal": dict(metal=0.0, rough=0.15, tile=1.0, normal=False, tex=None, emissive=(0.35, 0.65, 1.0), emit_strength=0.9),
}


def srgb_to_linear(c):
    return tuple(((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_materials(tex_dir, lod):
    """建立材質（lod = hq / lite）"""
    out = {}
    for name, s in MATS.items():
        m = bpy.data.materials.new(f"VP3_{name}")
        m.use_nodes = True
        nt = m.node_tree
        b = nt.nodes["Principled BSDF"]
        b.inputs["Metallic"].default_value = s["metal"]
        b.inputs["Roughness"].default_value = s["rough"]
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        if s["tex"]:
            tx = nt.nodes.new("ShaderNodeTexImage")
            tx.image = bpy.data.images.load(os.path.join(tex_dir, f"{s['tex']}_{lod}.png"))
            tx.image.colorspace_settings.name = "sRGB"
            mx = nt.nodes.new("ShaderNodeMix")
            mx.data_type = "RGBA"
            mx.blend_type = "MULTIPLY"
            mx.inputs["Factor"].default_value = 1.0
            nt.links.new(tx.outputs["Color"], mx.inputs[6])
            nt.links.new(vc.outputs["Color"], mx.inputs[7])
            nt.links.new(mx.outputs[2], b.inputs["Base Color"])
            if s["normal"] and lod == "hq":
                nx = nt.nodes.new("ShaderNodeTexImage")
                nx.image = bpy.data.images.load(os.path.join(tex_dir, f"{s['tex']}_nrm_hq.png"))
                nx.image.colorspace_settings.name = "Non-Color"
                nm = nt.nodes.new("ShaderNodeNormalMap")
                nm.inputs["Strength"].default_value = 0.8
                nt.links.new(nx.outputs["Color"], nm.inputs["Color"])
                nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
        else:
            nt.links.new(vc.outputs["Color"], b.inputs["Base Color"])
        if s.get("emissive"):
            b.inputs["Emission Color"].default_value = (*s["emissive"], 1.0)
            b.inputs["Emission Strength"].default_value = s["emit_strength"]
        out[name] = m
    return out


def box_uv(obj, tile):
    """世界座標方塊投影：每 tile 公尺貼圖重複一次"""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    mw = obj.matrix_world
    for f in bm.faces:
        n = (mw.to_3x3() @ f.normal).normalized()
        ax = max(range(3), key=lambda i: abs(n[i]))
        for lp in f.loops:
            p = mw @ lp.vert.co
            if ax == 0:
                u, v = p.y, p.z
            elif ax == 1:
                u, v = p.x, p.z
            else:
                u, v = p.x, p.y
            lp[uv].uv = (u / tile, v / tile)
    bm.to_mesh(me)
    bm.free()


def set_color(obj, rgb):
    """頂點色（sRGB 輸入）；之後烘焙的環境光遮蔽會乘上去"""
    me = obj.data
    if "Col" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["Col"])
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    lin = srgb_to_linear(rgb)
    for d in ca.data:
        d.color = (*lin, 1.0)
    me.color_attributes.active_color = ca


def part(name, obj, mat_name, rgb, mats, bevel=0.0, smooth=False):
    """把物件設成某種材質＋顏色，套倒角、UV"""
    obj.name = name
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel > 0:
        mod = obj.modifiers.new("bev", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if smooth:
        obj.data.shade_smooth()
    else:
        obj.data.shade_flat()
    obj.data.materials.clear()
    obj.data.materials.append(mats[mat_name])
    box_uv(obj, MATS[mat_name]["tile"])
    set_color(obj, rgb)
    obj["vp3_mat"] = mat_name
    return obj


def bake_ao(objs, samples=24, strength=0.75, log=None):
    """Cycles 烘焙環境光遮蔽到頂點色，乘進 Col；失敗就略過並記錄"""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    ok = 0
    for o in objs:
        me = o.data
        try:
            col = me.color_attributes["Col"]
            base = [tuple(d.color) for d in col.data]
            ao = me.color_attributes.new("AO", "FLOAT_COLOR", "POINT")
            me.color_attributes.active_color = ao
            bpy.ops.object.select_all(action="DESELECT")
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
            for i, d in enumerate(col.data):
                a = ao.data[i].color[0]
                f = 1.0 - strength * (1.0 - a)
                c = base[i]
                d.color = (c[0] * f, c[1] * f, c[2] * f, 1.0)
            me.color_attributes.remove(ao)
            me.color_attributes.active_color = me.color_attributes["Col"]
            ok += 1
        except Exception as e:  # noqa: BLE001
            if log is not None:
                log.append(f"AO 烘焙失敗 {o.name}: {e}")
    return ok


def tri_count(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


def join_by_material(objs, prefix):
    """同材質合併成一個網格（減少 Draw Calls）"""
    groups = {}
    for o in objs:
        groups.setdefault(o["vp3_mat"], []).append(o)
    out = []
    for mat, os_ in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in os_:
            o.select_set(True)
        bpy.context.view_layer.objects.active = os_[0]
        if len(os_) > 1:
            bpy.ops.object.join()
        j = bpy.context.view_layer.objects.active
        j.name = f"{prefix}_{mat}"
        j["vp3_mat"] = mat
        out.append(j)
    return out


def decimate(objs, ratio):
    for o in objs:
        if o["vp3_mat"] in ("crystal",):
            continue
        bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new("dec", "DECIMATE")
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)


def swap_textures(tex_dir, lod):
    """把材質貼圖換成 lod 版本；Lite 拿掉法線貼圖"""
    for m in bpy.data.materials:
        if not m.name.startswith("VP3_") or not m.use_nodes:
            continue
        nt = m.node_tree
        for n in list(nt.nodes):
            if n.type == "TEX_IMAGE" and n.image:
                nm = os.path.basename(n.image.filepath)
                if "_nrm_" in nm:
                    if lod == "lite":
                        nt.nodes.remove(n)
                    continue
                key = nm.split("_")[0]
                n.image = bpy.data.images.load(os.path.join(tex_dir, f"{key}_{lod}.png"), check_existing=True)
            if n.type == "NORMAL_MAP" and lod == "lite":
                nt.nodes.remove(n)


def export_glb(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_image_format="AUTO",
        export_vertex_color="ACTIVE" if bpy.app.version >= (4, 2, 0) else "MATERIAL",
    )


def setup_preview(sky=(0.85, 0.9, 0.98)):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*sky, 1)
    bg.inputs["Strength"].default_value = 0.9
    sc.world = world
    for name, rot, energy, ang in (("key", (50, 0, -35), 3.0, 8), ("fill", (65, 0, 130), 0.8, 25)):
        L = bpy.data.lights.new(name, "SUN")
        L.energy = energy
        L.angle = math.radians(ang)
        o = bpy.data.objects.new(name, L)
        o.rotation_euler = [math.radians(a) for a in rot]
        sc.collection.objects.link(o)
    cam = bpy.data.cameras.new("cam")
    cam.lens = 40
    co = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    return co


def shoot(cam, target, yaw, elev, dist, path, res=(960, 640)):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    a, e = math.radians(yaw), math.radians(elev)
    t = Vector(target)
    cam.location = t + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
    d = (t - cam.location).normalized()
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def write_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
