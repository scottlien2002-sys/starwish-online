"""
Stage 5.5 第二批 C1.0-B5（候選）：女生耳朵＋耳旁髮束往後撥；動作品質（自然呼吸、減少滑步、跳躍連續、攻擊 0.5 秒＋0.2 秒揮中、受擊回彈）；
P2 模組合併（每名約 12 個蒙皮網格）；glTF 警告代碼記錄；穿模檢查；跑步著地速度（測試頁防滑步用）。
用法：blender -b --factory-startup -noaudio -P art/novice-c10b5/blender_c10b5.py -- --parts <export_c10b5 輸出> --parts-a <export_c10b4 輸出> --out <資料夾>
"""
"""
Stage 5.5 C1.0-B4（候選）：男女耳朵＋骨架、蒙皮、五個動作（Idle、Run、Jump、Attack、Hurt）。
- 造型：art/novice-c10b4/c10b4_shapes.py（只改耳朵）
- 骨架：髖、脊椎、胸、頸、頭、左右上臂／前臂／手、左右大腿／小腿／腳（共 17 根）；關節點與建模用的手臂、腿相同
- 蒙皮：依零件指定可影響的骨頭（頭髮、蝴蝶結跟頭；裙子、披風以骨盆為主、大腿帶一點），再依距離混合（最多 3 根）
- 動作：程式產生的關鍵影格（30 fps），每個動作一個 glTF animation
- 輸出 novice_c10b4_<g>_{hq,lite}.glb；正式 C1.0-B2 GLB 不改
用法：blender -b --factory-startup -noaudio -P art/novice-c10b4/blender_c10b4.py -- --parts <export_c10b4 輸出> --parts-a <export_c10b2 男女輸出> --out <資料夾>
"""
"""
初心者 C1.0-B1 最終精修預覽（Blender，雲端無介面；鏡頭、光照、曝光、背景與 C1.0-A 完全相同）
  blender -b --factory-startup -noaudio -P art/novice-c10b3/blender_c10b3.py -- --parts <export_c10b3 輸出> --parts-a <export_c10b2 男生輸出> --out <資料夾>

產出（g = male / female）：
  c10b3_<g>_<front|side|back|left45|right|back45>.png  全身（與 C1.0-A 同鏡頭）
  c10b3_<g>_head_<...>.png、c10b3_<g>_detail_<torso|legs>_<front|left45>.png
  女生裙裝檢查（C1.0-A 與 C1.0-B1 用同一個場景各拍一次，方便前後比較）：
    <c10a|c10b>_female_skirt_<front|side|right|back|left45>.png   裙裝特寫（z 0.3、範圍 0.46 公尺）
    <c10a|c10b>_female_low_<front|front30|side|back>.png           低角度（由下往上 30～55 度；拍低角度時暫時隱藏地面陰影板）
  novice_c10b3_<g>_<hq|lite>.glb、c10b3_report.json
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
PARTS_A = argv[argv.index("--parts-a") + 1] if "--parts-a" in argv else None   # 修正前：C1.0-B4（export_c10b4 輸出，男女）
OUT = argv[argv.index("--out") + 1]
os.makedirs(OUT, exist_ok=True)

W, H = 1040, 1280
PX = 0.00105
Z_BOTTOM = -0.02 - 16 * PX
HQ_TRIS = 200000
LITE_TRIS = 40000
VIEWS = {"front": 0, "side": 90, "back": 180, "left45": 45, "right": -90, "back45": 135, "right45": -45}  # 90 = 從角色左側看（設定圖側面）


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


def load(g, pre="c10b5", src=None):
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


def export_rigged_glb(objs, rig, path):
    """骨架＋蒙皮＋五個動作（Idle、Run、Jump、Attack、Hurt，各一個 glTF animation）"""
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs + [rig]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
              export_skins=True, export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True)
    try:
        bpy.ops.export_scene.gltf(**kw, export_optimize_animation_size=True, export_reset_pose_bones=True)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)


SKIRT_VIEWS = ("front", "side", "right", "back", "left45")
LOW_VIEWS = {"front": (0, -30), "front30": (30, -55), "side": (90, -30), "back": (180, -30)}


def skirt_shots(cam, pre):
    for v in SKIRT_VIEWS:
        shoot(cam, VIEWS[v], 0.3, 0.46, (1100, 1100), os.path.join(OUT, f"{pre}_female_skirt_{v}.png"))
    for v, (yaw, el) in LOW_VIEWS.items():
        shoot(cam, yaw, 0.3, 0.5, (1100, 1100), os.path.join(OUT, f"{pre}_female_low_{v}.png"), elev=el)




# ================================================================== C1.0-B4：骨架、蒙皮、五個動作
# 關節位置與 novice_shapes.arm_joints / leg_joints 相同（建模用的手臂、腿就是沿這些點做的）
from mathutils import Matrix, Quaternion  # noqa: E402

JOINTS = {
    "male": {"arm": ((0.095, 0.0, 0.582), (0.172, 0.0, 0.5), (0.212, -0.008, 0.438)),
             "leg": ((0.065, 0.0, 0.33), (0.097, -0.005, 0.205), (0.112, 0.0, 0.07))},
    "female": {"arm": ((0.09, 0.0, 0.598), (0.158, 0.0, 0.528), (0.212, -0.01, 0.47)),
               "leg": ((0.055, 0.0, 0.34), (0.065, -0.005, 0.235), (0.067, 0.0, 0.07))},
}
FPS = 30


def build_rig(g):
    """建立骨架（Blender 座標：z 朝上、臉朝 −y、角色左手在 +x）"""
    J = JOINTS[g]
    sh, el, wr = [Vector(v) for v in J["arm"]]
    hp, kn, an = [Vector(v) for v in J["leg"]]
    hip_z = hp.z
    chest_top = sh.z + 0.01
    arm = bpy.data.armatures.new(f"rig_{g}")
    rig = bpy.data.objects.new(f"rig_{g}", arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones

    def bone(name, h, t, parent=None, connect=False):
        b = eb.new(name)
        b.head, b.tail = Vector(h), Vector(t)
        b.roll = 0.0
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect
        return b

    bone("hips", (0, 0, hip_z), (0, 0, hip_z + 0.09))
    bone("spine", (0, 0, hip_z + 0.09), (0, 0, hip_z + 0.19), "hips", True)
    bone("chest", (0, 0, hip_z + 0.19), (0, 0, chest_top), "spine", True)
    bone("neck", (0, 0, chest_top), (0, 0, chest_top + 0.08), "chest", True)
    bone("head", (0, 0, chest_top + 0.08), (0, 0, chest_top + 0.42), "neck", True)
    for sx, s in ((1, "L"), (-1, "R")):
        m = Vector((sx, 1, 1))
        S, E, Wr = sh * 1, el * 1, wr * 1
        S.x *= sx
        E.x *= sx
        Wr.x *= sx
        H_, K, A = hp * 1, kn * 1, an * 1
        H_.x *= sx
        K.x *= sx
        A.x *= sx
        bone(f"upper_arm.{s}", S, E, "chest")
        bone(f"forearm.{s}", E, Wr, f"upper_arm.{s}", True)
        bone(f"hand.{s}", Wr, Wr + (Wr - E).normalized() * 0.07, f"forearm.{s}", True)
        bone(f"thigh.{s}", H_, K, "hips")
        bone(f"shin.{s}", K, A, f"thigh.{s}", True)
        bone(f"foot.{s}", A, A + Vector((0, -0.09, -0.045)), f"shin.{s}", True)
        del m
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


ALL = None
TORSO = ["hips", "spine", "chest", "neck", "head", "upper_arm.L", "upper_arm.R", "forearm.L", "forearm.R", "thigh.L", "thigh.R"]


def bone_policy(name):
    """每個零件可以受哪些骨頭影響（權重係數）。頭髮、蝴蝶結等跟頭一起動；裙子、披風以骨盆為主、大腿帶一點"""
    n = name
    if n in ("head", "hair", "ponytail", "bow", "bow_star"):
        return {"head": 1.0} if n != "head" else {"head": 1.0, "neck": 1.0}
    for s, sx in (("_l", "L"), ("_r", "R")):
        if n in (f"hand{s}", f"rivet{s}"):
            return {f"hand.{sx}": 1.0}
        if n == f"glove{s}":
            return {f"hand.{sx}": 1.0, f"forearm.{sx}": 1.0}
        if n in (f"boot{s}", f"boot_gem{s}", f"boot_strap{s}"):
            return {f"foot.{sx}": 1.0, f"shin.{sx}": 1.0}
    if n in ("boot_sole", "boot_strap", "boot_buckle"):
        return "SIDE_LEG"
    if n == "glove_band":
        return "SIDE_ARM"
    if n in ("tabard", "tabard_trim", "tabard_star", "underskirt", "petticoat", "skirt_pink", "skirt_trim", "overskirt", "overskirt_trim", "overskirt_emblem"):
        return {"hips": 1.0, "thigh.L": 0.35, "thigh.R": 0.35}
    if n in ("belt", "buckle", "belt_edge", "belt_loop", "pouch", "shorts", "safety_shorts"):
        return {"hips": 1.0, "spine": 0.6, "thigh.L": 1.0, "thigh.R": 1.0}
    if n in ("lace", "gems", "chest_trim", "front_panel"):
        return {"chest": 1.0, "spine": 1.0}
    if n in ("choker",):
        return {"neck": 1.0, "chest": 0.5}
    if n == "scarf":
        return {"neck": 1.0, "chest": 1.0, "spine": 0.8, "hips": 0.6}
    return ALL  # 身體、上衣、背心、袖口、馬甲…：所有骨頭依距離混合


def seg_dist(P, a, b):
    ab = b - a
    t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)


def skin(objs, rig):
    """距離加權蒙皮：每個頂點取最近的 3 根候選骨頭，權重 ∝ 係數 / (距離 + 1 cm)^4，再正規化（只建頂點群組；骨架修改器由 attach_rig 加）"""
    bones = {b.name: (np.array(b.head_local), np.array(b.tail_local)) for b in rig.data.bones}
    for o in objs:
        me = o.data
        P = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get("co", P)
        P = P.reshape(-1, 3)
        pol = bone_policy(o.name)
        if pol is ALL:
            pol = {b: 1.0 for b in bones}
        elif pol == "SIDE_LEG" or pol == "SIDE_ARM":
            names = ("foot", "shin") if pol == "SIDE_LEG" else ("forearm", "hand")
            pol = None
        groups = {}
        if pol is None:
            W = {}
            for s, sel in (("L", P[:, 0] >= 0), ("R", P[:, 0] < 0)):
                for nm in names:
                    W[f"{nm}.{s}"] = np.where(sel, 1.0, 0.0)
            cand = list(W.keys())
            raw = np.stack([W[c] / (seg_dist(P, *bones[c]) + 0.01) ** 4 for c in cand], 1)
        else:
            cand = list(pol.keys())
            raw = np.stack([pol[c] / (seg_dist(P, *bones[c]) + 0.01) ** 4 for c in cand], 1)
        if raw.shape[1] > 3:
            keep = np.argsort(-raw, axis=1)[:, :3]
            mask = np.zeros_like(raw, bool)
            np.put_along_axis(mask, keep, True, axis=1)
            raw = np.where(mask, raw, 0.0)
        w = raw / np.maximum(raw.sum(1, keepdims=True), 1e-12)
        for j, c in enumerate(cand):
            idx = np.nonzero(w[:, j] > 0.004)[0]
            if not len(idx):
                continue
            vg = o.vertex_groups.get(c) or o.vertex_groups.new(name=c)
            # 依權重分批（四捨五入到 1/256）加快寫入
            q = np.round(w[idx, j] * 256).astype(int)
            for val in np.unique(q):
                sel = idx[q == val]
                vg.add(sel.tolist(), float(val) / 256.0, "REPLACE")
            groups[c] = len(idx)


# ---------------- 動作（在「父骨的座標方向」指定旋轉：軸用世界軸，Blender 座標 x＝角色左、y＝背後、z＝上）
# 正負號：繞 x 軸正轉時，往下的骨頭（腿、手臂）往後擺、往上的骨頭（脊椎、頭）往前傾
def axis_q(ax, deg):
    return Quaternion(Vector(ax), math.radians(deg))


def set_pose(rig, rots, locs=None):
    """rots: {bone: Quaternion（以骨架座標的軸表示，相對於休息姿勢、在父骨座標系中）}"""
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
        q = rots.get(pb.name, Quaternion())
        B = pb.bone.matrix_local.to_3x3()
        local = (B.inverted() @ q.to_matrix() @ B).to_quaternion()
        pb.rotation_quaternion = local
        pb.location = (0, 0, 0)
    for name, d in (locs or {}).items():
        pb = rig.pose.bones[name]
        B = pb.bone.matrix_local.to_3x3()
        pb.location = B.inverted() @ Vector(d)


def key_all(rig, frame):
    for pb in rig.pose.bones:
        pb.keyframe_insert("rotation_quaternion", frame=frame)
        pb.keyframe_insert("location", frame=frame)


X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
# 手臂外張（往下的手臂）：左手（+x）繞 Y 軸「負」轉才是往外、右手繞 Y 軸「正」轉才是往外
# （B5 第一版正負號相反 → 手往內收，跑步、待機、受傷時手穿進裙子／腰包；穿插報告量到後修正）
ABD = 4.0   # 所有動作共同的基本外張角度（度），讓手離開裙擺、腰包


def pose_idle(t):
    """Idle（2.4 秒循環）：自然呼吸 — 吸氣時胸口微抬、肩膀上提、上臂微張，吐氣時放鬆；頭部反向微調保持視線，重心微微左右移"""
    b = math.sin(2 * math.pi * t)            # 呼吸
    b2 = math.sin(2 * math.pi * t - 0.6)     # 肩膀稍慢於胸口
    sway = math.sin(math.pi * t)             # 重心（一個循環來回一次）
    return ({
        "spine": axis_q(X, -1.2 * b), "chest": axis_q(X, -1.6 * b),
        "neck": axis_q(X, 1.0 * b), "head": axis_q(X, 1.4 * b) @ axis_q(Z, 1.5 * sway),
        "upper_arm.L": axis_q(Y, -ABD - 2.0 * b2) @ axis_q(X, 1.5 * b), "upper_arm.R": axis_q(Y, ABD + 2.0 * b2) @ axis_q(X, 1.5 * b),
        "forearm.L": axis_q(X, -4 - 1.5 * b2), "forearm.R": axis_q(X, -4 - 1.5 * b2),
        "hips": axis_q(Y, 1.0 * sway),
        "thigh.L": axis_q(Y, -1.0 * sway), "thigh.R": axis_q(Y, -1.0 * sway),
    }, {"hips": (0.004 * sway, 0, 0.0025 * b)})


RUN_THIGH = 52   # C1.0-B5a：大腿擺幅 ±40° → ±52°（跨步加大，減少 5 m/s 時的滑步；髖部下沉 0.8 cm 讓著地腳伸直時仍踩到地）


def pose_run(t):
    """Run（0.6 秒循環）：大腿 ±40°、擺動腳膝蓋高抬、著地腳伸直往後推；手臂反向擺、前傾、一步一次上下起伏"""
    ph = 2 * math.pi * t
    s = math.sin(ph)
    c = math.cos(ph)

    def knee(p):  # 擺動期（腳往前帶）膝蓋大彎；著地期接近伸直
        return 8 + 78 * max(0.0, math.sin(ph + p)) ** 1.5

    return ({
        "hips": axis_q(Z, 7 * s), "spine": axis_q(X, 12) @ axis_q(Z, -6 * s), "chest": axis_q(Z, -5 * s), "neck": axis_q(X, -4), "head": axis_q(X, -2),
        "thigh.L": axis_q(X, -RUN_THIGH * s), "thigh.R": axis_q(X, RUN_THIGH * s),
        "shin.L": axis_q(X, knee(math.pi / 2)), "shin.R": axis_q(X, knee(-math.pi / 2)),
        "foot.L": axis_q(X, -12 * c), "foot.R": axis_q(X, 12 * c),
        "upper_arm.L": axis_q(X, 45 * s) @ axis_q(Y, -ABD - 8), "upper_arm.R": axis_q(X, -45 * s) @ axis_q(Y, ABD + 8),
        "forearm.L": axis_q(X, -55 - 15 * s), "forearm.R": axis_q(X, -55 + 15 * s),
    }, {"hips": (0, 0, 0.030 * abs(c) - 0.020)})


def _jump_curve(t):
    """回傳（蹲, 手上舉, 縮腿）；時間點與測試頁的離地區間 0.25～0.75 對齊"""
    keys = [(0.0, 0.0, 0.0, 0.0), (0.2, 1.0, -0.2, 0.0), (0.25, -0.25, 0.9, 0.0), (0.42, -0.1, 1.0, 0.7), (0.62, 0.0, 0.5, 0.4),
            (0.75, 0.15, 0.1, 0.0), (0.84, 0.85, -0.1, 0.0), (1.0, 0.0, 0.0, 0.0)]
    for (t0, *a), (t1, *b) in zip(keys, keys[1:]):
        if t <= t1:
            u = (t - t0) / (t1 - t0)
            u = u * u * (3 - 2 * u)
            return tuple(x + (y - x) * u for x, y in zip(a, b))
    return (0.0, 0.0, 0.0)


def pose_jump(t):
    """Jump（1 秒）：下蹲蓄力 → 起跳伸展手上舉 → 空中縮腿 → 伸腿準備落地 → 落地緩衝 → 站直（連續、不跳格）"""
    cr, up, tuck = _jump_curve(t)
    crp = max(cr, 0.0)
    ext = max(-cr, 0.0)
    return ({
        "spine": axis_q(X, 16 * crp - 4 * ext), "chest": axis_q(X, 6 * crp), "head": axis_q(X, -8 * crp - 5 * up),
        "thigh.L": axis_q(X, -55 * crp - 45 * tuck + 8 * ext), "thigh.R": axis_q(X, -55 * crp - 30 * tuck + 8 * ext),
        "shin.L": axis_q(X, 95 * crp + 80 * tuck), "shin.R": axis_q(X, 95 * crp + 60 * tuck),
        "foot.L": axis_q(X, -40 * crp + 25 * ext + 10 * tuck), "foot.R": axis_q(X, -40 * crp + 25 * ext + 10 * tuck),
        # C1.0-B5a：上舉 120° → 95°、往外張 28°、前臂少彎 → 手在頭的兩側斜上方，不靠近臉
        "upper_arm.L": axis_q(X, 35 * crp - 95 * max(up, 0) + 25 * max(-up, 0)) @ axis_q(Y, -ABD - 28 * max(up, 0)),
        "upper_arm.R": axis_q(X, 35 * crp - 95 * max(up, 0) + 25 * max(-up, 0)) @ axis_q(Y, ABD + 28 * max(up, 0)),
        "forearm.L": axis_q(X, -10 * max(up, 0) - 20 * crp), "forearm.R": axis_q(X, -10 * max(up, 0) - 20 * crp),
    }, {"hips": (0, 0, -0.09 * crp)})


ATTACK_SEC = 0.5        # 與遊戲基礎攻擊週期相同
ATTACK_HIT = 0.2        # 揮中時間（秒）＝遊戲 ATTACK_TIMING


def pose_attack(t):
    """Attack（0.5 秒，與遊戲 ATTACK_TIMING 相同）：0～0.14 蓄力（右手往後上舉）→ 0.14～0.26 揮擊（0.20 秒揮中＝揮擊中段）→ 0.26～0.50 收招"""
    s = t * ATTACK_SEC

    def ss(a, b):
        u = max(0.0, min(1.0, (s - a) / (b - a)))
        return u * u * (3 - 2 * u)

    wind = ss(0.0, 0.14) * (1 - ss(0.14, 0.26))
    swing = ss(0.14, 0.26) * (1 - ss(0.26, 0.5))
    tw = 22 * wind - 26 * swing
    return ({
        "hips": axis_q(Z, -0.35 * tw), "spine": axis_q(Z, -0.6 * tw) @ axis_q(X, 10 * swing - 4 * wind), "chest": axis_q(Z, -0.45 * tw),
        "head": axis_q(Z, 0.5 * tw),
        "upper_arm.R": axis_q(X, -155 * wind - 55 * swing) @ axis_q(Y, -25 * wind - 5 * swing),
        "forearm.R": axis_q(X, -75 * wind - 15 * swing), "hand.R": axis_q(X, 20 * wind - 25 * swing),
        "upper_arm.L": axis_q(X, 30 * wind - 25 * swing) @ axis_q(Y, -ABD - 14 * (wind + swing)), "forearm.L": axis_q(X, -30 * (wind + swing)),
        "thigh.L": axis_q(X, -28 * swing), "shin.L": axis_q(X, 25 * swing), "foot.L": axis_q(X, -8 * swing),
        "thigh.R": axis_q(X, 18 * swing), "shin.R": axis_q(X, 12 * swing),
    }, {"hips": (0, -0.035 * swing, -0.018 * swing)})


def pose_hurt(t):
    """Hurt（0.5 秒）：0.08 秒內被打得上身後仰、頭後甩、手往外張、膝蓋微彎 → 0.25 秒回穩（小幅回彈）→ 0.5 秒回站姿"""
    s = t * 0.5
    k = (s / 0.08) if s < 0.08 else math.exp(-((s - 0.08) / 0.13) ** 2)
    k = k * k * (3 - 2 * k) if s < 0.08 else k
    rb = 0.25 * math.sin(math.pi * max(0.0, min(1.0, (s - 0.2) / 0.2)))   # 回彈：往前一點點
    return ({
        # C1.0-B5a：後仰幅度縮小約 40%（脊椎 15→9°、胸 9→5°、頸 6→4°、頭 14→8°）
        "spine": axis_q(X, -9 * k + 3 * rb), "chest": axis_q(X, -5 * k + 2 * rb), "neck": axis_q(X, -4 * k), "head": axis_q(X, -8 * k) @ axis_q(Z, 5 * k),
        "upper_arm.L": axis_q(Y, -ABD - 28 * k) @ axis_q(X, -12 * k), "upper_arm.R": axis_q(Y, ABD + 28 * k) @ axis_q(X, -12 * k),
        "forearm.L": axis_q(X, -30 * k), "forearm.R": axis_q(X, -30 * k),
        "thigh.L": axis_q(X, -10 * k), "thigh.R": axis_q(X, -6 * k), "shin.L": axis_q(X, 18 * k), "shin.R": axis_q(X, 12 * k),
    }, {"hips": (0, 0.03 * k, -0.015 * k)})


ACTIONS = [("Idle", 2.4, pose_idle, True), ("Run", 0.6, pose_run, True), ("Jump", 1.0, pose_jump, False),
           ("Attack", ATTACK_SEC, pose_attack, False), ("Hurt", 0.5, pose_hurt, False)]


def make_actions(rig):
    rig.animation_data_create()
    out = []
    for name, dur, fn, loop in ACTIONS:
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        n = max(2, round(dur * FPS))
        for f in range(n + 1):
            t = f / n
            rots, locs = fn(t if not loop else (t % 1.0))
            set_pose(rig, rots, locs)
            key_all(rig, f)
        out.append((name, n))
    rig.animation_data.action = None
    set_pose(rig, {})
    return out


def pose_at(rig, name, t):
    fn = {a[0]: a[2] for a in ACTIONS}[name]
    rots, locs = fn(t)
    set_pose(rig, rots, locs)
    bpy.context.view_layer.update()


def run_ground_speed(rig):
    """著地腳往後推的速度（公尺／秒）→ 測試頁依移動速度調整跑步動作的播放速度，減少滑步"""
    dur = dict((a[0], a[1]) for a in ACTIONS)["Run"]
    pts = []
    n = 36
    for i in range(n + 1):
        pose_at(rig, "Run", i / n)
        pb = rig.pose.bones["foot.L"]
        pts.append((rig.matrix_world @ pb.head).copy())
    zs = [p.z for p in pts]
    zmin = min(zs)
    v = []
    for i in range(n):
        if pts[i].z < zmin + 0.012 and pts[i + 1].z < zmin + 0.012:   # 著地期（腳最低的那段）
            v.append(abs(pts[i + 1].y - pts[i].y) / (dur / n))
    set_pose(rig, {})
    return float(sum(v) / len(v)) if v else 0.0


# ---------------- 穿模檢查：各動作的幾個時間點，手／手套 vs 身體與衣服、左右靴子、腿 vs 裙子；跟休息姿勢比較多出來的交疊
CLIP_PAIRS = [
    (("hand_l", "glove_l"), ("body", "shirt", "vest", "tabard", "blouse", "corset", "overskirt", "skirt_pink", "petticoat", "underskirt", "pouch")),
    (("hand_r", "glove_r"), ("body", "shirt", "vest", "tabard", "blouse", "corset", "overskirt", "skirt_pink", "petticoat", "underskirt", "pouch")),
    (("boot_l",), ("boot_r",)),
]
CLIP_TIMES = {"Idle": (0.0, 0.5), "Run": (0.0, 0.25, 0.5, 0.75), "Jump": (0.2, 0.42, 0.84), "Attack": (0.3, 0.4, 0.6), "Hurt": (0.16, 0.5)}


def clip_report(objs, rig):
    from mathutils.bvhtree import BVHTree
    by = {o.name: o for o in objs}

    def overlaps():
        dg = bpy.context.evaluated_depsgraph_get()
        trees = {}
        res = {}
        for a_names, b_names in CLIP_PAIRS:
            for a in a_names:
                for b in b_names:
                    if a not in by or b not in by:
                        continue
                    for n in (a, b):
                        if n not in trees:
                            trees[n] = BVHTree.FromObject(by[n], dg)
                    res[f"{a}|{b}"] = len(trees[a].overlap(trees[b]))
        return res

    set_pose(rig, {})
    bpy.context.view_layer.update()
    base = overlaps()
    out = {"rest": base, "poses": {}}
    for name, ts in CLIP_TIMES.items():
        for t in ts:
            pose_at(rig, name, t)
            cur = overlaps()
            extra = {k: cur[k] - base.get(k, 0) for k in cur if cur[k] - base.get(k, 0) > 0}
            out["poses"][f"{name}@{t:.2f}"] = extra
    set_pose(rig, {})
    return out


def attach_rig(objs, rig):
    """只加骨架修改器（蒙皮網格放在根層級）"""
    for o in objs:
        if not any(m.type == "ARMATURE" for m in o.modifiers):
            mod = o.modifiers.new("rig", "ARMATURE")
            mod.object = rig
        # 不再以骨架為父物件：glTF 驗證器的 26 個警告全是 NODE_SKINNED_MESH_NON_ROOT（蒙皮網格節點掛在骨架節點底下）。
        # 蒙皮網格只靠骨架修改器變形即可，放在根層級符合 glTF 規範建議。


def slot_of(name):
    """與測試頁 P2（c10pSlot）相同的模組分類：臉、身體、頭髮、手、腳、服裝 — 之後換髮型、服裝、裝備時各自獨立"""
    if name == "head":
        return "face"
    if name == "body" or name in ("hand_l", "hand_r"):
        return "body"
    if name in ("hair", "ponytail", "bow", "bow_star"):
        return "hair"
    if name.startswith(("glove", "rivet", "glove_band")):
        return "hands"
    if name.startswith("boot"):
        return "feet"
    return "outfit"


def merge_by_slot(objs):
    """P2：同模組、同材質的零件合併成一個網格（蒙皮權重跟著合併）→ 每名角色約 12 個網格"""
    groups = {}
    for o in objs:
        key = (slot_of(o.name), o.data.materials[0].name if o.data.materials else "")
        groups.setdefault(key, []).append(o)
    out = []
    for (slot, mat), os_ in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in os_:
            o.select_set(True)
        bpy.context.view_layer.objects.active = os_[0]
        names = [o.name for o in os_]
        if len(os_) > 1:
            bpy.ops.object.join()
        m = bpy.context.view_layer.objects.active
        m.name = f"{slot}__{mat}"
        m["parts"] = ",".join(names)
        out.append(m)
    return out


def ear_shots(cam, pre, g):
    for v in ("front", "side", "right", "left45", "right45"):
        shoot(cam, VIEWS[v], 0.85, 0.5, (1100, 1100), os.path.join(OUT, f"{pre}_{g}_ear_{v}.png"))


POSE_SHOTS = {"Idle": (0.0, 0.5), "Run": (0.0, 0.25, 0.5, 0.75), "Jump": (0.2, 0.3, 0.45, 0.8, 0.88), "Attack": (0.2, 0.32, 0.4, 0.6), "Hurt": (0.16, 0.3, 0.6)}


def main():
    report = {}
    for g in ("male", "female"):
        if PARTS_A:   # 修正前：C1.0-B4（男 = B4 耳朵；女 = C1.0-B）
            bpy.ops.wm.read_factory_settings(use_empty=True)
            objs, mats = load(g, "c10b4", PARTS_A)
            cam = setup_scene()
            decimate_to(objs, HQ_TRIS)
            ear_shots(cam, "c10b4", g)
        rep = {}
        for lod, target, weighted in (("lite", LITE_TRIS, True), ("hq", HQ_TRIS, False)):
            bpy.ops.wm.read_factory_settings(use_empty=True)
            objs, mats = load(g)
            cam = setup_scene()
            decimate_to(objs, target, weighted=weighted)
            if lod == "hq":
                ear_shots(cam, "c10b5", g)
                zc = Z_BOTTOM + H * PX / 2
                for v in ("front", "left45", "side", "back"):
                    shoot(cam, VIEWS[v], zc, H * PX, (W, H), os.path.join(OUT, f"c10b5_{g}_{v}.png"))
            tris = tri_count(objs)
            parts_before = len(objs)
            rig = build_rig(g)
            skin(objs, rig)
            attach_rig(objs, rig)
            acts = make_actions(rig)
            extra = {}
            if lod == "lite":
                extra["clip"] = clip_report(objs, rig)
                extra["run_ground_speed"] = run_ground_speed(rig)
            objs = merge_by_slot(objs)
            if lod == "hq":
                bpy.context.scene.cycles.samples = 24
                zc = Z_BOTTOM + H * PX / 2
                for name, ts in POSE_SHOTS.items():
                    for t in ts:
                        pose_at(rig, name, t)
                        for vn in ("left45", "side"):
                            shoot(cam, VIEWS[vn], zc, H * PX, (416, 512), os.path.join(OUT, f"anim_{g}_{name}_{int(round(t * 100)):03d}_{vn}.png"))
                set_pose(rig, {})
                bpy.context.scene.cycles.samples = 96
            path = os.path.join(OUT, f"novice_c10b5_{g}_{lod}.glb")
            export_rigged_glb(objs, rig, path)
            rep[lod] = {"triangles": tris, "parts": parts_before, "meshes_after_merge": len(objs), "mesh_names": [o.name for o in objs],
                        "materials": sorted(mats.keys()), "bones": [b.name for b in rig.data.bones],
                        "actions": [{"name": n, "frames": f, "fps": FPS} for n, f in acts], "attack": {"seconds": ATTACK_SEC, "hit": ATTACK_HIT}, **extra}
            print(g, lod, tris, parts_before, "->", len(objs), acts, json.dumps(extra)[:1500], flush=True)
        report[g] = rep
    json.dump(report, open(os.path.join(OUT, "c10b5_report.json"), "w"), indent=1, ensure_ascii=False)


main()
