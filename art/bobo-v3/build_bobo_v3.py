"""
星露啵啵 V3：Blender 雲端建模腳本（第一版，程式化建模）。
在 GitHub Actions 以 Blender（官方免費版）無介面執行：
  blender -b --factory-startup -P art/bobo-v3/build_bobo_v3.py -- --out <資料夾> --textures <資料夾>

產出：
  bobo_v3_high.glb / bobo_v3_medium.glb / bobo_v3_low.glb（三種畫質，各含身體、眼睛、嘴、腮紅、星星）
  render_front.png / render_side.png / render_back.png（Cycles 渲染三視圖）
  bobo_v3_info.json（三角形數、檔案大小、尺寸）

造型定義在 bobo_shape.py（有號距離場）：身體、觸角、翅膀以「平滑聯集」合成單一網格，
接縫是連續曲面（不是把零件插在一起），這是 V3 要解決的主要問題之一。

注意：這是程式化建模的第一版，不是人工雕刻／手繪的最終正式美術。
"""
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bobo_shape as S  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(HERE, "out")
TEX = argv[argv.index("--textures") + 1] if "--textures" in argv else OUT
RENDER = "--no-render" not in argv
os.makedirs(OUT, exist_ok=True)

GAME_HEIGHT = 0.8  # 遊戲中身體高度（公尺）
LODS = {"high": 7000, "medium": 3600, "low": 1700}  # 身體（含觸角、翅膀）三角形目標


# ----------------------------------------------------------------- 工具


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def activate(obj):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)


def apply_modifier(obj, mod):
    activate(obj)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def set_point_colors(obj, fn, name="Col"):
    me = obj.data
    attr = me.color_attributes.get(name) or me.color_attributes.new(name=name, type="FLOAT_COLOR", domain="POINT")
    for i, v in enumerate(me.vertices):
        n = v.normal
        r, g, b = fn(v.co.x, v.co.y, v.co.z, n.x, n.y, n.z)
        attr.data[i].color = (r, g, b, 1.0)
    me.color_attributes.active_color = attr


# ----------------------------------------------------------------- 身體（SDF → 網格）


def build_body_mesh(step=0.0105):
    vol, origin, st = S.sample_grid(step)
    verts, quads = S.surface_nets(vol, origin, st)
    me = bpy.data.meshes.new("BoboBody")
    me.from_pydata(verts.tolist(), [], quads.tolist())
    me.update()
    obj = link(bpy.data.objects.new("BoboBody", me))
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=step * 0.05)
    # 移除可能的孤立小碎片
    bm.to_mesh(me)
    bm.free()
    # 柔化 surface nets 的階梯感
    m = obj.modifiers.new("smooth", "LAPLACIANSMOOTH")
    m.lambda_factor = 0.6
    m.iterations = 4
    m.use_volume_preserve = True
    apply_modifier(obj, m)
    return obj


def decimated_copy(src, name, target_tris):
    obj = src.copy()
    obj.data = src.data.copy()
    obj.name = name
    link(obj)
    cur = tri_count(obj) * 1.0
    if cur > target_tris:
        m = obj.modifiers.new("dec", "DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = target_tris / cur
        m.use_collapse_triangulate = True
        apply_modifier(obj, m)
    obj.data.shade_smooth()
    return obj


def body_color(x, y, z, nx, ny, nz):
    """頂點色：底部深藍紫 → 上方淡藍；翅膀與觸角末端更淡、更透亮"""
    h = max(0.0, min(1.0, z / 1.0))
    # V3.1：更飽和的藍紫（底部紫、上方藍）
    deep = (0.3, 0.24, 0.9)
    top = (0.46, 0.62, 1.0)
    c = [deep[i] + (top[i] - deep[i]) * h for i in range(3)]
    radial = math.hypot(x, y)
    if radial > 0.66 and z < 0.6:  # 翅膀
        k = min(1.0, (radial - 0.66) / 0.16)
        c = [c[i] + ((0.6, 0.82, 1.0)[i] - c[i]) * k for i in range(3)]
    if z > 1.0:  # 觸角
        c = [c[i] + ((0.55, 0.72, 1.0)[i] - c[i]) * 0.6 for i in range(3)]
    return tuple(c)


# ----------------------------------------------------------------- 貼合表面的面片（眼睛、嘴、腮紅）


def surface_patch(name, bvh, center_x, center_z, half_w, half_h, uv_rect, lift, dome=0.0, mirror_u=False, res=14):
    """
    在身體正面投影出一片貼合曲面的網格：每個頂點都由 +Y 方向射線打到身體表面，再沿法線抬高。
    uv_rect = (u0, v0, u1, v1)（Blender UV，v 向上）
    """
    verts, uvs, faces = [], [], []
    for j in range(res + 1):
        for i in range(res + 1):
            u = i / res
            v = j / res
            x = center_x + (u * 2 - 1) * half_w
            z = center_z + (v * 2 - 1) * half_h
            hit = bvh.ray_cast(Vector((x, -3.0, z)), Vector((0, 1, 0)))
            loc, nrm = hit[0], hit[1]
            if loc is None:
                loc, nrm = Vector((x, -0.5, z)), Vector((0, -1, 0))
            r2 = ((u * 2 - 1) ** 2 + (v * 2 - 1) ** 2)
            bump = dome * max(0.0, 1 - r2)
            p = loc + nrm * (lift + bump)
            verts.append(p[:])
            uu = 1 - u if mirror_u else u
            uvs.append((uv_rect[0] + (uv_rect[2] - uv_rect[0]) * uu, uv_rect[1] + (uv_rect[3] - uv_rect[1]) * v))
    for j in range(res):
        for i in range(res):
            a = j * (res + 1) + i
            # 面朝 -Y（朝外）
            faces.append((a, a + res + 1, a + res + 2, a + 1))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    uvl = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            uvl.data[li].uv = uvs[me.loops[li].vertex_index]
    obj = link(bpy.data.objects.new(name, me))
    # 確認法線朝外（朝 -Y）；若相反就翻面
    if sum(p.normal.y for p in me.polygons) > 0:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
    me.shade_smooth()
    return obj


def join(objs, name):
    activate(objs[0])
    for o in objs[1:]:
        o.select_set(True)
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    return obj


# ----------------------------------------------------------------- 星星


def soft_star_mesh(name, outer, inner, depth, segments=40, rings=4):
    """圓角鼓起的五角星（與遊戲 V2 的軟星相同輪廓），面向 -Y"""

    def radius(a):
        t = 0.5 + 0.5 * math.cos(5 * (a - math.pi / 2))
        return inner + (outer - inner) * t ** 0.8

    verts, faces = [], []
    for side in (1, -1):
        base = len(verts)
        verts.append((0, -side * depth, 0))
        for k in range(1, rings + 1):
            s = k / rings
            y = -side * depth * math.sqrt(max(0, 1 - s * s * 0.92))
            for i in range(segments):
                a = i / segments * math.pi * 2
                r = radius(a) * s
                verts.append((math.cos(a) * r, y, math.sin(a) * r))

        def idx(k, i):
            return base + 1 + (k - 1) * segments + (i % segments)

        for i in range(segments):
            f = (base, idx(1, i), idx(1, i + 1))
            faces.append(f if side == 1 else f[::-1])
        for k in range(1, rings):
            for i in range(segments):
                f = (idx(k, i), idx(k + 1, i), idx(k + 1, i + 1), idx(k, i + 1))
                faces.append(f if side == 1 else f[::-1])
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    me.shade_smooth()
    return obj


def star_color(x, y, z, nx, ny, nz):
    r = math.hypot(x, z)
    k = min(1.0, r / 0.12)
    return (1.0, 0.93 - 0.3 * k, 0.55 - 0.5 * k)


# ----------------------------------------------------------------- 材質（Blender 渲染用；遊戲端會換成自己的果凍材質）


def mat_body():
    m = bpy.data.materials.new("Bobo_Jelly")
    m.use_nodes = True
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = nodes.get("Principled BSDF")
    vc = nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.08
    bsdf.inputs["IOR"].default_value = 1.33
    bsdf.inputs["Transmission Weight"].default_value = 0.88
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.3
    # 體內星雲：以物件座標雜訊做體積發光（只影響 Blender 渲染，用來呈現「看得進去」的深度）
    out = nodes.get("Material Output")
    vol = nodes.new("ShaderNodeVolumePrincipled")
    tc = nodes.new("ShaderNodeTexCoord")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 4.5
    noise.inputs["Detail"].default_value = 6
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.52
    ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = (0.25, 0.75, 1.0, 1)
    links.new(tc.outputs["Object"], noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], vol.inputs["Emission Color"])
    vol.inputs["Emission Strength"].default_value = 2.2
    vol.inputs["Density"].default_value = 0.6
    vol.inputs["Color"].default_value = (0.45, 0.55, 1.0, 1)
    links.new(vol.outputs["Volume"], out.inputs["Volume"])
    return m


def mat_image(name, image_path, clip):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(image_path)
    tex.interpolation = "Linear"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    # 透明處用 Transparent BSDF 混合（Cycles 下貼花的透明區不會變亮）
    out = nt.nodes.get("Material Output")
    mix = nt.nodes.new("ShaderNodeMixShader")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    nt.links.new(tex.outputs["Alpha"], mix.inputs["Fac"])
    nt.links.new(tr.outputs["BSDF"], mix.inputs[1])
    nt.links.new(bsdf.outputs["BSDF"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 0.35
    bsdf.inputs["Roughness"].default_value = 0.05 if clip else 0.5
    try:
        m.blend_method = "CLIP" if clip else "BLEND"
    except Exception:
        pass
    try:
        m.surface_render_method = "DITHERED" if clip else "BLENDED"
    except Exception:
        pass
    return m


def mat_star():
    m = bpy.data.materials.new("Bobo_Star")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 0.4
    bsdf.inputs["Roughness"].default_value = 0.35
    return m


# ----------------------------------------------------------------- 組裝


def build():
    reset()
    full = build_body_mesh()
    full.data.shade_smooth()

    mats = {
        "body": mat_body(),
        "eyes": mat_image("Bobo_Eyes", os.path.join(TEX, "bobo_v3_eyes.png"), clip=True),
        "face": mat_image("Bobo_Face", os.path.join(TEX, "bobo_v3_face.png"), clip=False),
        "star": mat_star(),
    }

    bm = bmesh.new()
    bm.from_mesh(full.data)
    bvh = BVHTree.FromBMesh(bm)

    # 眼睛：左右各一片，中央微微鼓起（角膜），右眼 UV 鏡像；表情集第 0 格（一般）
    E = S.EYE
    eye_half = 0.128
    eye_uv = (0.0, 0.5, 0.25, 1.0)
    eyeL = surface_patch("EyeL", bvh, E["half_spacing"], E["height"], eye_half, eye_half, eye_uv, lift=0.006, dome=0.032, res=18)
    eyeR = surface_patch("EyeR", bvh, -E["half_spacing"], E["height"], eye_half, eye_half, eye_uv, lift=0.006, dome=0.032, mirror_u=True, res=18)
    eyes = join([eyeL, eyeR], "Eyes")
    eyes.data.materials.append(mats["eyes"])

    # 嘴：表情集第 0 格（上半部 4×2，每格 256×128 → UV 寬 0.25、高 0.25）
    mouth = surface_patch("Mouth", bvh, 0.0, S.MOUTH["height"] - 0.01, 0.25, 0.125, (0.0, 0.75, 0.25, 1.0), lift=0.005, res=10)
    mouth.data.materials.append(mats["face"])
    # 腮紅：左右兩片，共用貼圖下半部的腮紅格
    B = S.BLUSH
    bl = surface_patch("BlushL", bvh, B["half_spacing"], B["height"], 0.13, 0.065, (0.0, 0.25, 0.25, 0.5), lift=0.004, res=8)
    br = surface_patch("BlushR", bvh, -B["half_spacing"], B["height"], 0.13, 0.065, (0.0, 0.25, 0.25, 0.5), lift=0.004, res=8)
    blush = join([bl, br], "Blush")
    blush.data.materials.append(mats["face"])
    bm.free()

    # 星星：頭頂（觸角末端，朝左前方斜 45° 讓正面與側面都看得到）＋ 腹部（嵌在果凍表面下）
    hs = S.HEAD_STAR
    head = soft_star_mesh("HeadStar", hs["outer"], hs["inner"], hs["depth"])
    head.location = hs["center"]
    head.rotation_euler = (0.0, 0.0, math.radians(35))
    bs = S.BELLY_STAR
    belly = soft_star_mesh("BellyStar", bs["outer"], bs["inner"], bs["depth"])
    hit = BVHTree.FromObject(full, bpy.context.evaluated_depsgraph_get()).ray_cast(Vector((0, -3, bs["height"])), Vector((0, 1, 0)))
    # 嵌在果凍表面下（從側面看不會突出身體）
    # V3.1：靠近表面（只沉入一點），從正面看清楚又像在果凍裡
    by = hit[0].y + 0.04 if hit[0] is not None else -0.52
    belly.location = (0.0, by, bs["height"])
    belly.rotation_euler = (math.radians(-12), 0, 0)
    for st in (head, belly):
        activate(st)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # 星星頂點色依各自中心計算
    for st, c in ((head, hs["center"]), (belly, (0.0, by, bs["height"]))):
        set_point_colors(st, lambda x, y, z, nx, ny, nz, c=c: star_color(x - c[0], y - c[1], z - c[2], nx, ny, nz))
    stars = join([head, belly], "Stars")
    stars.data.materials.append(mats["star"])

    info = {"lods": {}, "game_height_m": GAME_HEIGHT}
    root_objs = {}
    for lod, target in LODS.items():
        body = decimated_copy(full, f"Body_{lod}", target)
        set_point_colors(body, body_color)
        body.data.materials.append(mats["body"])
        root_objs[lod] = body
    bpy.data.objects.remove(full, do_unlink=True)

    # 統一縮放為遊戲尺寸，掛在同一個根節點下
    def export(lod):
        root = link(bpy.data.objects.new(f"StarDewBoboV3_{lod}", None))
        parts = [root_objs[lod], eyes, mouth, blush, stars]
        for p in parts:
            p.parent = root
        root.scale = (GAME_HEIGHT, GAME_HEIGHT, GAME_HEIGHT)
        for o in bpy.context.scene.objects:
            o.hide_set(False)
            o.select_set(False)
        for o in [root] + parts:
            o.select_set(True)
        for other in root_objs.values():
            if other is not root_objs[lod]:
                other.select_set(False)
        path = os.path.join(OUT, f"bobo_v3_{lod}.glb")
        kwargs = dict(
            filepath=path,
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_yup=True,
            export_texcoords=True,
            export_normals=True,
            export_materials="EXPORT",
            export_animations=False,
        )
        for extra in ({"export_vertex_color": "ACTIVE"}, {"export_colors": True}, {}):
            try:
                bpy.ops.export_scene.gltf(**kwargs, **extra)
                break
            except TypeError:
                continue
        info["lods"][lod] = {
            "bytes": os.path.getsize(path),
            "triangles": {p.name: tri_count(p) for p in parts},
            "triangles_total": sum(tri_count(p) for p in parts),
            "objects": len(parts),
            "materials": 4,
        }
        for p in parts:
            p.parent = None
        bpy.data.objects.remove(root, do_unlink=True)
        return parts

    # 輸出 GLB 時不帶折射（KHR_materials_transmission 會讓 Babylon 多一次整個場景的繪製，手機吃不消）；
    # 遊戲端身體材質由程式提供。輸出完再恢復，給 Blender 渲染使用。
    bsdf = mats["body"].node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Transmission Weight"].default_value = 0.0
    out_node = mats["body"].node_tree.nodes.get("Material Output")
    vol_link = [l for l in mats["body"].node_tree.links if l.to_socket == out_node.inputs["Volume"]]
    vol_from = vol_link[0].from_socket if vol_link else None
    for l in vol_link:
        mats["body"].node_tree.links.remove(l)
    for lod in LODS:
        export(lod)
    bsdf.inputs["Transmission Weight"].default_value = 0.88
    if vol_from is not None:
        mats["body"].node_tree.links.new(vol_from, out_node.inputs["Volume"])

    # 尺寸（遊戲單位）
    def bbox(objs):
        pts = np.array([list(o.matrix_world @ v.co) for o in objs for v in o.data.vertices])
        return (pts.min(0) * GAME_HEIGHT).round(3).tolist(), (pts.max(0) * GAME_HEIGHT).round(3).tolist()

    lo, hi = bbox([root_objs["high"], stars])
    info["bbox_min_blender"] = lo
    info["bbox_max_blender"] = hi
    info["textures"] = {n: os.path.getsize(os.path.join(TEX, n)) for n in ("bobo_v3_eyes.png", "bobo_v3_face.png")}
    with open(os.path.join(OUT, "bobo_v3_info.json"), "w") as f:
        json.dump(info, f, ensure_ascii=False, indent=2)
    print(json.dumps(info, ensure_ascii=False))

    if RENDER:
        for lod in ("medium", "low"):
            root_objs[lod].hide_render = True
        render_views(root_objs["high"])


def render_views(body):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 96
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 10
    sc.cycles.transmission_bounces = 10
    sc.cycles.volume_bounces = 2
    sc.cycles.transparent_max_bounces = 32
    sc.render.resolution_x = 720
    sc.render.resolution_y = 600
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("World")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.05, 0.06, 0.14, 1)
    bg.inputs["Strength"].default_value = 1.5

    # 燈光：左上主光、右後輪廓光、正面補光（類似設定圖的柔和打光）
    def light(name, kind, loc, energy, size, rot):
        ld = bpy.data.lights.new(name, kind)
        ld.energy = energy
        if kind == "AREA":
            ld.shape = "DISK"
            ld.size = size
        lo = link(bpy.data.objects.new(name, ld))
        lo.location = loc
        lo.rotation_euler = rot
        return lo

    # 燈光掛在一個隨鏡頭旋轉的支點上：三個視角的打光相同（背面不會被前方的燈從身體後面透出來）
    rig = link(bpy.data.objects.new("LightRig", None))
    for lo in (
        light("Key", "AREA", (-2.0, -2.5, 3.0), 380, 1.2, (math.radians(50), 0, math.radians(-35))),
        light("Rim", "AREA", (2.2, 1.6, 2.0), 140, 1.0, (math.radians(-55), 0, math.radians(125))),
        light("Fill", "AREA", (0.5, -3.0, 0.8), 140, 1.5, (math.radians(80), 0, 0)),
    ):
        lo.parent = rig
        if lo.name.startswith("Fill"):
            lo.visible_glossy = False  # 補光不在果凍表面留下大塊反光

    # 地面（只接收陰影的柔和平面）
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
    ground = bpy.context.active_object
    gm = bpy.data.materials.new("Ground")
    gm.use_nodes = True
    gm.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.05, 0.06, 0.13, 1)
    ground.data.materials.append(gm)

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 1.95
    cam = link(bpy.data.objects.new("Cam", cam_data))
    sc.camera = cam
    cz = 0.62
    views = {
        "front": ((0, -5, cz), (math.radians(90), 0, 0)),
        "side": ((5, 0, cz), (math.radians(90), 0, math.radians(90))),
        "back": ((0, 5, cz), (math.radians(90), 0, math.radians(180))),
    }
    for name, (loc, rot) in views.items():
        cam.location = loc
        cam.rotation_euler = rot
        rig.rotation_euler = (0, 0, rot[2])
        sc.render.filepath = os.path.join(OUT, f"render_{name}.png")
        bpy.ops.render.render(write_still=True)


build()
