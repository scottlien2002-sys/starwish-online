"""寵物商人 V2「星靈培育師・洛恩」：組合、減面（HQ／Lite）、骨架＋蒙皮＋四個動作（Idle、Walk、Talk、Turn）、美術圖、GLB。

  blender -b --factory-startup -noaudio -P blender_v2.py -- --parts <export_v2 輸出> --out <資料夾>

- 骨架、蒙皮、動作的做法參考 Claude A C1.0-B4（17 根骨頭、依零件指定骨頭、距離加權最多 3 根）；
  關節位置與 A 的男初心者基礎網格相同（沿用的身體就是沿這些點建的）。程式是 B 線自己的檔案，不修改 A 的任何檔案
- 小寵物（PetPal_*）不綁骨架：執行時漂浮在洛恩頭部附近
- 輸出：pet_merchant_v2_{hq,lite}.glb、pm2_<front|left45|side|back|head_front|head_45|talk|walk>.png、pm2_report.json
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Quaternion, Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
PARTS = argv[argv.index("--parts") + 1]
OUT = argv[argv.index("--out") + 1]
os.makedirs(OUT, exist_ok=True)

W, H = 1040, 1280
PX = 0.00105
Z_BOTTOM = -0.02 - 16 * PX
BUDGET = {"hq": 14000, "lite": 6000, "far": 2500}
FPS = 30
PAL = ("pal", "pal_eyes")
PAL_AT = Vector((0.2, 0.06, 1.13))  # 美術圖用：小寵物在頭部右上方

SURFACE = {"skin": (0.0, 0.55, 0.3), "hair": (0.0, 0.5, 0.3, 0.15), "cloth": (0.0, 0.75, 0.25, 0.25), "leather": (0.0, 0.55, 0.35), "metal": (0.85, 0.32, 0.5),
           "glow": (0.0, 0.15, 0.5), "egg": (0.0, 0.4, 0.4), "pal": (0.0, 0.7, 0.3, 0.3), "eye": (0.0, 0.2, 0.6)}


def srgb_to_linear(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def make_material(name, surface, tex=None, glow=False):
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
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "Col"
    if tex:
        tx = nt.nodes.new("ShaderNodeTexImage")
        tx.image = bpy.data.images.load(tex)
        tx.interpolation = "Cubic"
        mx = nt.nodes.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        mx.blend_type = "MULTIPLY"
        mx.inputs["Factor"].default_value = 1.0
        nt.links.new(tx.outputs["Color"], mx.inputs[6])
        nt.links.new(ca.outputs["Color"], mx.inputs[7])
        nt.links.new(mx.outputs[2], b.inputs["Base Color"])
    else:
        nt.links.new(ca.outputs["Color"], b.inputs["Base Color"])
    if glow:
        nt.links.new(ca.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = 1.6
    return m


def load():
    d = np.load(os.path.join(PARTS, "pm2_parts.npz"))
    meta = json.load(open(os.path.join(PARTS, "pm2_parts.json")))
    tex = os.path.join(PARTS, "pm2_face.png")
    objs, pal, mats = [], [], {}
    for it in meta["parts"]:
        k = it["key"]
        if k + "__blink" in d and LOD_NOW[0] == "far":
            continue
        v = (d[k + "__blink"] if k + "__blink" in d else d[k + "__v"]).astype(np.float64)
        q = d[k + "__q"]
        name = it["name"]
        is_pal = name in PAL
        if is_pal:
            v = v.copy()
        me = bpy.data.meshes.new(name)
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
            ul = me.uv_layers.new(name="UVMap")
            ul.data.foreach_set("uv", d[k + "__uv"][q.ravel()].ravel().astype(np.float32))
        grp = it["group"]
        mkey = "face" if it.get("textured") else grp
        if mkey not in mats:
            mats[mkey] = make_material(f"PM2_{mkey}", SURFACE.get(grp, (0.0, 0.6)), tex if it.get("textured") else None, glow=grp == "glow")
        me.materials.append(mats[mkey])
        ob = bpy.data.objects.new(("PetPal_" + name) if is_pal else name, me)
        bpy.context.scene.collection.objects.link(ob)
        me.shade_smooth()
        if k + "__blink" in d:
            add_blink_keys(ob, d[k + "__v"].astype(np.float64), v)
        (pal if is_pal else objs).append(ob)
    return objs, pal, mats


LOD_NOW = ["hq"]


def add_blink_keys(ob, open_v, closed_v):
    """Stage 6.6 眨眼：網格建在閉眼位置（法線朝前），Basis＝睜眼（收到睫毛線）、Blink＝閉眼"""
    import bmesh
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    if sum(f.normal.y for f in bm.faces) > 0:
        for f in bm.faces:
            f.normal_flip()
    bm.to_mesh(me)
    bm.free()
    me.update()
    opened = open_v + (closed_v - open_v) * 0.02
    ob.shape_key_add(name="Basis", from_mix=False)
    kb = ob.shape_key_add(name="Blink", from_mix=False)
    kb.data.foreach_set("co", closed_v.ravel())
    ob.data.shape_keys.key_blocks["Basis"].data.foreach_set("co", opened.ravel())
    me.vertices.foreach_set("co", opened.ravel())
    me.update()
    ob["blink"] = 1


def tri_count(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


KEEP_MORE = {"hair": 2.0, "head": 1.7, "PetPal_pal": 1.6, "PetPal_pal_eyes": 3.0, "stone": 3.0, "egg": 2.0, "coat_gold": 1.4}


def decimate_to(objs, target):
    fixed = [o for o in objs if o.get("blink")]
    target -= tri_count(fixed)
    objs = [o for o in objs if not o.get("blink")]
    tris = {o.name: max(tri_count([o]), 1) for o in objs}
    lo, hi = 0.0, 1.0
    for _ in range(40):
        k = (lo + hi) / 2
        tot = sum(tris[n] * min(1.0, k * KEEP_MORE.get(n, 1.0)) for n in tris)
        lo, hi = (k, hi) if tot < target else (lo, k)
    k = (lo + hi) / 2
    for o in objs:
        bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new("dec", "DECIMATE")
        mod.ratio = min(1.0, k * KEEP_MORE.get(o.name, 1.0))
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
        o.data.shade_smooth()
    for _ in range(4):
        cur = tri_count(objs)
        if cur <= target:
            break
        r = target / cur * 0.985
        for o in objs:
            if len(o.data.polygons) < 24:
                continue
            bpy.context.view_layer.objects.active = o
            mod = o.modifiers.new("dec2", "DECIMATE")
            mod.ratio = r
            mod.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=mod.name)
            o.data.shade_smooth()


def setup_scene():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 80
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.9, 0.91, 0.96, 1)
    bg.inputs["Strength"].default_value = 0.75
    sc.world = world
    for name, r, energy, ang in (("key", (48, 0, -32), 2.2, 18), ("fill", (65, 0, 120), 0.6, 30), ("rim", (30, 0, 185), 1.0, 10)):
        L = bpy.data.lights.new(name, "SUN")
        L.energy = energy
        L.angle = math.radians(ang)
        o = bpy.data.objects.new(name, L)
        o.rotation_euler = [math.radians(a) for a in r]
        sc.collection.objects.link(o)
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
    bpy.context.active_object.is_shadow_catcher = True
    cam = bpy.data.cameras.new("cam")
    cam.type = "ORTHO"
    co = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    return co


def shoot(cam, yaw, zc, scale, res, path, at=(0.0, 0.0)):
    sc = bpy.context.scene
    a = math.radians(yaw)
    sc.render.resolution_x, sc.render.resolution_y = res
    cam.data.ortho_scale = scale
    cam.location = Vector((at[0] + math.sin(a) * 6, at[1] - math.cos(a) * 6, zc))
    cam.rotation_euler = (math.radians(90), 0, a)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------ 骨架（關節＝A 男初心者基礎網格的建模關節）
ARM = ((0.095, 0.0, 0.582), (0.172, 0.0, 0.5), (0.212, -0.008, 0.438))
LEG = ((0.065, 0.0, 0.33), (0.097, -0.005, 0.205), (0.112, 0.0, 0.07))


def build_rig():
    sh, el, wr = [Vector(v) for v in ARM]
    hp, kn, an = [Vector(v) for v in LEG]
    arm = bpy.data.armatures.new("rig_pm2")
    rig = bpy.data.objects.new("rig_pm2", arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones

    def bone(name, h, t, parent=None, connect=False):
        b = eb.new(name)
        b.head, b.tail = Vector(h), Vector(t)
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect

    hz, top = hp.z, sh.z + 0.01
    bone("hips", (0, 0, hz), (0, 0, hz + 0.09))
    bone("spine", (0, 0, hz + 0.09), (0, 0, hz + 0.19), "hips", True)
    bone("chest", (0, 0, hz + 0.19), (0, 0, top), "spine", True)
    bone("neck", (0, 0, top), (0, 0, top + 0.08), "chest", True)
    bone("head", (0, 0, top + 0.08), (0, 0, top + 0.42), "neck", True)
    for sx, s in ((1, "L"), (-1, "R")):
        m = lambda v: Vector((v.x * sx, v.y, v.z))  # noqa: E731
        S, E, Wr, Hp, K, A = m(sh), m(el), m(wr), m(hp), m(kn), m(an)
        bone(f"upper_arm.{s}", S, E, "chest")
        bone(f"forearm.{s}", E, Wr, f"upper_arm.{s}", True)
        bone(f"hand.{s}", Wr, Wr + (Wr - E).normalized() * 0.07, f"forearm.{s}", True)
        bone(f"thigh.{s}", Hp, K, "hips")
        bone(f"shin.{s}", K, A, f"thigh.{s}", True)
        bone(f"foot.{s}", A, A + Vector((0, -0.09, -0.045)), f"shin.{s}", True)
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


ALL = None


def policy(n):
    if n in ("hair", "lids"):
        return {"head": 1.0}
    if n == "head":
        return {"head": 1.0, "neck": 1.0}
    for s, sx in (("_l", "L"), ("_r", "R")):
        if n == f"hand{s}":
            return {f"hand.{sx}": 1.0}
        if n in (f"boot{s}", f"boot_gem{s}"):
            return {f"foot.{sx}": 1.0, f"shin.{sx}": 1.0}
    if n in ("boot_sole", "boot_strap", "boot_buckle"):
        return "SIDE_LEG"
    if n in ("cuffs", "cuff_gold"):
        return "SIDE_ARM"
    if n in ("coat", "coat_trim", "coat_gold"):
        return {"chest": 1.0, "spine": 1.0, "hips": 1.0, "thigh.L": 0.35, "thigh.R": 0.35}
    if n == "collar":
        return {"neck": 1.0, "chest": 1.0}
    if n in ("stone", "stone_gold"):
        return {"chest": 1.0}
    if n in ("pouch", "pouch_gold", "feed_bag", "feed_tie", "egg_cup", "egg", "belt", "belt_edge", "buckle"):
        return {"hips": 1.0, "spine": 0.4}
    if n == "trousers":
        return {"hips": 1.0, "thigh.L": 1.0, "thigh.R": 1.0, "shin.L": 1.0, "shin.R": 1.0}
    return ALL  # 身體、襯衫、袖口金環


def seg_dist(P, a, b):
    ab = b - a
    t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)


def skin(objs, rig):
    bones = {b.name: (np.array(b.head_local), np.array(b.tail_local)) for b in rig.data.bones}
    for o in objs:
        me = o.data
        P = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get("co", P)
        P = P.reshape(-1, 3)
        pol = policy(o.name)
        if pol in ("SIDE_LEG", "SIDE_ARM"):
            names = ("foot", "shin") if pol == "SIDE_LEG" else ("forearm", "hand")
            W = {f"{nm}.{s}": np.where(sel, 1.0, 0.0) for s, sel in (("L", P[:, 0] >= 0), ("R", P[:, 0] < 0)) for nm in names}
            cand = list(W)
            raw = np.stack([W[c] / (seg_dist(P, *bones[c]) + 0.01) ** 4 for c in cand], 1)
        else:
            pol = {b: 1.0 for b in bones} if pol is ALL else pol
            cand = list(pol)
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
            q = np.round(w[idx, j] * 256).astype(int)
            for val in np.unique(q):
                vg.add(idx[q == val].tolist(), float(val) / 256.0, "REPLACE")
        mod = o.modifiers.new("rig", "ARMATURE")
        mod.object = rig
        o.parent = rig


def aq(ax, deg):
    return Quaternion(Vector(ax), math.radians(deg))


X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)


def set_pose(rig, rots, locs=None):
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
        q = rots.get(pb.name, Quaternion())
        B = pb.bone.matrix_local.to_3x3()
        pb.rotation_quaternion = (B.inverted() @ q.to_matrix() @ B).to_quaternion()
        pb.location = (0, 0, 0)
    for name, dv in (locs or {}).items():
        pb = rig.pose.bones[name]
        pb.location = pb.bone.matrix_local.to_3x3().inverted() @ Vector(dv)


# 手臂自然下垂的基本姿勢（A 的建模姿勢手肘外張；商人放鬆一點）
REST = {"upper_arm.L": aq(Y, -8), "upper_arm.R": aq(Y, 8)}


def with_rest(r):
    out = dict(REST)
    for k, v in r.items():
        out[k] = v @ out.get(k, Quaternion())
    return out


def pose_idle(t):
    """Idle 2.4 秒：呼吸、頭輕微擺動、重心微移"""
    b = math.sin(2 * math.pi * t)
    return with_rest({"spine": aq(X, -1.2 * b), "chest": aq(X, -1.0 * b), "head": aq(X, 1.2 * b) @ aq(Z, 2.5 * math.sin(math.pi * t)),
                      "hips": aq(Y, 1.0 * math.sin(math.pi * t)), "upper_arm.L": aq(Y, 2 * b), "upper_arm.R": aq(Y, -2 * b)}), {"hips": (0, 0, -0.003 * (1 - b) / 2)}


def pose_walk(t):
    """Walk 1.0 秒循環（慢步）：腿 ±22°、膝蓋彎、手臂反向擺、輕微上下起伏"""
    s, c = math.sin(2 * math.pi * t), math.cos(2 * math.pi * t)
    knee = lambda ph: 6 + 34 * max(0.0, math.sin(2 * math.pi * t + ph))  # noqa: E731
    return with_rest({
        "hips": aq(Z, 4 * s), "spine": aq(X, 3) @ aq(Z, -3 * s), "head": aq(X, 2) @ aq(Z, 1.5 * s),
        "thigh.L": aq(X, -22 * s), "thigh.R": aq(X, 22 * s),
        "shin.L": aq(X, knee(math.pi / 2)), "shin.R": aq(X, knee(-math.pi / 2)),
        "foot.L": aq(X, -8 * c), "foot.R": aq(X, 8 * c),
        "upper_arm.L": aq(X, 16 * s), "upper_arm.R": aq(X, -16 * s), "forearm.L": aq(X, -14), "forearm.R": aq(X, -14),
    }), {"hips": (0, 0, 0.01 * abs(c) - 0.006)}


def pose_talk(t):
    """Talk 2.4 秒循環：右手抬起比劃（掌心朝上介紹）、點頭、身體微向前；左手扶著腰側"""
    g = 0.5 - 0.5 * math.cos(2 * math.pi * t)
    w = math.sin(4 * math.pi * t)
    return with_rest({
        "upper_arm.R": aq(X, -38 - 8 * g) @ aq(Y, 18), "forearm.R": aq(X, -55 - 10 * w) @ aq(Z, 10), "hand.R": aq(Y, 25),
        "upper_arm.L": aq(Y, -6) @ aq(X, -6), "forearm.L": aq(X, -28),
        "head": aq(X, 5 * max(0.0, math.sin(4 * math.pi * t))) @ aq(Z, -4 * g), "chest": aq(X, 2 * g), "spine": aq(Z, -3 * g),
    }), {}


def pose_turn(t):
    """Turn 0.8 秒：上身先轉、兩腳交替踏一小步（執行時整個角色同時轉向）"""
    k = math.sin(math.pi * t)
    st = math.sin(2 * math.pi * t)
    return with_rest({"chest": aq(Z, 10 * k), "spine": aq(Z, 6 * k), "head": aq(Z, 12 * k), "thigh.L": aq(X, -12 * max(st, 0)), "shin.L": aq(X, 18 * max(st, 0)),
                      "thigh.R": aq(X, -12 * max(-st, 0)), "shin.R": aq(X, 18 * max(-st, 0)), "upper_arm.L": aq(X, 6 * st), "upper_arm.R": aq(X, -6 * st)}), {"hips": (0, 0, 0.006 * abs(st))}


ACTIONS = [("Idle", 2.4, pose_idle), ("Walk", 1.0, pose_walk), ("Talk", 2.4, pose_talk), ("Turn", 0.8, pose_turn)]


def make_actions(rig):
    rig.animation_data_create()
    out = []
    for name, dur, fn in ACTIONS:
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        n = max(2, round(dur * FPS))
        for f in range(n + 1):
            rots, locs = fn(f / n % 1.0 if f < n else 0.0)
            set_pose(rig, rots, locs)
            for pb in rig.pose.bones:
                pb.keyframe_insert("rotation_quaternion", frame=f)
                pb.keyframe_insert("location", frame=f)
        out.append((name, n))
    rig.animation_data.action = None
    return out


def merge_by_material(objs):
    """V2.1：蒙皮後把同材質的零件合併成一個網格（保留頂點群組與骨架修改器）→ 約 9 個網格＋小寵物 2 個。
    繪製次數從約 34～41 次降到約 11 次；外觀、骨架、動作不變。"""
    groups = {}
    for o in objs:
        groups.setdefault(o.data.materials[0].name, []).append(o)
    out = []
    for mname, lst in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in lst:
            o.select_set(True)
        bpy.context.view_layer.objects.active = next((o for o in lst if o.get("blink")), lst[0])
        if len(lst) > 1:
            bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = "pm_" + mname.replace("PM2_", "")
        ob.data.name = ob.name
        out.append(ob)
    return out


def export_glb(objs, rig, pal, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs + [rig] + pal:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=False, export_yup=True, export_skins=True, export_morph=True, export_morph_normal=False,
              export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True)
    try:
        bpy.ops.export_scene.gltf(**kw, export_optimize_animation_size=True, export_reset_pose_bones=True)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)


def main():
    report = {"budget": BUDGET, "lods": {}}
    for lod in ("hq", "lite", "far"):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        LOD_NOW[0] = lod
        objs, pal, mats = load()
        cam = setup_scene()
        before = tri_count(objs + pal)
        decimate_to(objs + pal, BUDGET[lod] - 400)
        tris = tri_count(objs + pal)
        rig = build_rig()
        skin(objs, rig)
        parts_before = len(objs)
        objs = merge_by_material(objs)
        acts = make_actions(rig)
        if lod == "hq":
            for o in pal:
                o.location = PAL_AT
            set_pose(rig, *pose_idle(0.0))
            zc = Z_BOTTOM + H * PX / 2
            for v, yaw in (("front", 0), ("left45", 45), ("side", 90), ("back", 180), ("right45", -45)):
                shoot(cam, yaw, zc, H * PX, (W, H), os.path.join(OUT, f"pm2_{v}.png"))
            for v, yaw in (("head_front", 0), ("head_45", 35)):
                shoot(cam, yaw, 0.86, 0.5, (900, 900), os.path.join(OUT, f"pm2_{v}.png"))
            for o in objs:
                if o.data.shape_keys and "Blink" in o.data.shape_keys.key_blocks:
                    o.data.shape_keys.key_blocks["Blink"].value = 1.0
            shoot(cam, 0, 0.86, 0.5, (900, 900), os.path.join(OUT, "pm2_head_blink.png"))
            for o in objs:
                if o.data.shape_keys and "Blink" in o.data.shape_keys.key_blocks:
                    o.data.shape_keys.key_blocks["Blink"].value = 0.0
            bpy.context.scene.cycles.samples = 40
            for name, fn, t in (("talk", pose_talk, 0.3), ("walk", pose_walk, 0.25), ("turn", pose_turn, 0.5)):
                set_pose(rig, *fn(t))
                bpy.context.view_layer.update()
                shoot(cam, 30, zc, H * PX, (520, 640), os.path.join(OUT, f"pm2_pose_{name}.png"))
            set_pose(rig, {})
            for o in pal:
                o.location = (0, 0, 0)
        bpy.context.scene.frame_set(0)
        path = os.path.join(OUT, f"pet_merchant_v2_{lod}.glb")
        export_glb(objs, rig, pal, path)
        report["lods"][lod] = {"triangles": tris, "triangles_before_decimate": before, "within_budget": tris <= BUDGET[lod], "parts": parts_before + len(pal), "meshes": len(objs) + len(pal), "mesh_names": sorted(o.name for o in objs + pal),
                               "materials": sorted(mats.keys()), "bones": [b.name for b in rig.data.bones], "actions": [{"name": n, "frames": f, "fps": FPS} for n, f in acts],
                               "bytes": os.path.getsize(path)}
        print(lod, tris, flush=True)
    json.dump(report, open(os.path.join(OUT, "pm2_report.json"), "w"), indent=1, ensure_ascii=False)
    if not all(v["within_budget"] for v in report["lods"].values()):
        raise SystemExit("三角面超出預算")


main()
