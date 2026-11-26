"""星芽村正式 NPC（八位）：組合、減面（HQ／Lite）、骨架＋蒙皮＋三個動作（Idle、Turn、Talk）、美術圖、GLB。

  blender -b --factory-startup -noaudio -P blender_npc.py -- --parts <export_npc 輸出> --out <資料夾> [--ids id,id,...] [--no-render]

- 骨架／蒙皮／動作沿用洛恩 V2.1 的做法（17 根骨頭、依零件綁定骨頭、距離加權最多 3 根）；
  關節位置依性別取 A 的男／女初心者基礎網格的建模關節（json 內的 joints）。不修改 A 的任何檔案
- 材質合併：HQ＝臉（貼圖）／身體（頂點色）／金屬／發光 最多 4 個網格；Lite＝臉／身體（含金屬）／發光
- 輸出：npc_<id>_{hq,lite}.glb、npc_<id>_<front|left45|side|back|head|talk|turn>.png、npc_report.json
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Quaternion, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PARTS = argv[argv.index("--parts") + 1]
OUT = argv[argv.index("--out") + 1]
IDS = argv[argv.index("--ids") + 1].split(",") if "--ids" in argv else ["swordmaster", "knight", "smith", "mage", "priest", "clown", "warehouse", "guild"]
RENDER = "--no-render" not in argv
os.makedirs(OUT, exist_ok=True)

W, H = 640, 800
PX = 0.00105 * 1040 / 640
Z_BOTTOM = -0.02 - 10 * PX
BUDGET = {"hq": 16000, "lite": 5000}
FPS = 30
SURFACE = {"face": (0.0, 0.55, 0.3), "body": (0.0, 0.72, 0.25, 0.15), "metal": (0.8, 0.32, 0.5), "glow": (0.0, 0.2, 0.5)}


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


def mat_class(it, lod):
    if it.get("textured"):
        return "face"
    g = it["group"]
    if g == "glow":
        return "glow"
    if g == "metal" and lod == "hq":
        return "metal"
    return "body"


def load(nid, lod):
    d = np.load(os.path.join(PARTS, f"npc_{nid}_parts.npz"))
    meta = json.load(open(os.path.join(PARTS, f"npc_{nid}_parts.json")))
    tex = os.path.join(PARTS, f"npc_{nid}_face.png")
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
            ul = me.uv_layers.new(name="UVMap")
            ul.data.foreach_set("uv", d[k + "__uv"][q.ravel()].ravel().astype(np.float32))
        mk = mat_class(it, lod)
        if mk not in mats:
            mats[mk] = make_material(f"NPC_{mk}", SURFACE[mk], tex if mk == "face" else None, glow=mk == "glow")
        me.materials.append(mats[mk])
        ob = bpy.data.objects.new(it["name"], me)
        ob["bind"] = json.dumps(it.get("bind"))
        bpy.context.scene.collection.objects.link(ob)
        me.shade_smooth()
        objs.append(ob)
    return objs, mats, meta


def tri_count(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


KEEP_MORE = {"hair": 2.0, "head": 1.8, "beard": 1.3, "mustache": 1.5, "glasses": 2.0, "monocle": 2.0, "nose": 2.0, "hand_l": 1.3, "hand_r": 1.3}


def decimate_to(objs, target):
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
        mod.ratio = max(min(1.0, k * KEEP_MORE.get(o.name, 1.0)), 0.002)
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
        o.data.shade_smooth()


def setup_scene():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 48
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


def shoot(cam, yaw, zc, scale, res, path):
    sc = bpy.context.scene
    a = math.radians(yaw)
    sc.render.resolution_x, sc.render.resolution_y = res
    cam.data.ortho_scale = scale
    cam.location = Vector((math.sin(a) * 6, -math.cos(a) * 6, zc))
    cam.rotation_euler = (math.radians(90), 0, a)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------ 骨架
def build_rig(joints, nid):
    sh, el, wr = [Vector(v) for v in joints["arm"]]
    hp, kn, an = [Vector(v) for v in joints["leg"]]
    arm = bpy.data.armatures.new(f"rig_{nid}")
    rig = bpy.data.objects.new(f"rig_{nid}", arm)
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
SIDES = {"SIDE_LEG": ("foot", "shin"), "SIDE_ARM": ("forearm", "hand"), "SIDE_ARM_FULL": ("upper_arm", "forearm", "hand"), "SIDE_SHOULDER": ("upper_arm", "chest")}


def policy(o):
    bind = json.loads(o.get("bind", "null"))
    if bind is not None:
        return bind
    n = o.name  # A 的零件
    if n == "head":
        return {"head": 1.0, "neck": 1.0}
    for s, sx in (("_l", "L"), ("_r", "R")):
        if n == f"hand{s}":
            return {f"hand.{sx}": 1.0}
        if n in (f"boot{s}", f"boot_gem{s}", f"boot_strap{s}"):
            return {f"foot.{sx}": 1.0, f"shin.{sx}": 1.0}
    if n in ("boot_sole", "boot_strap", "boot_buckle"):
        return "SIDE_LEG"
    return ALL  # 身體


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
        pol = policy(o)
        if isinstance(pol, str):
            names = SIDES[pol]
            Wt = {}
            for s, sel in (("L", P[:, 0] >= 0), ("R", P[:, 0] < 0)):
                for nm in names:
                    if nm == "chest":
                        Wt["chest"] = np.full(len(P), 0.6)
                    else:
                        Wt[f"{nm}.{s}"] = sel.astype(float)
            cand = list(Wt)
            raw = np.stack([Wt[c] / (seg_dist(P, *bones[c]) + 0.01) ** 4 for c in cand], 1)
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


# 各 NPC 的待機姿勢與說話手勢（拿道具的手不比劃）
STYLE = {
    "swordmaster": {"rest": {"upper_arm.L": aq(Y, -10), "upper_arm.R": aq(Y, 10)}, "talk": "L", "fist": True},
    "knight": {"rest": {"upper_arm.L": aq(Y, -7), "upper_arm.R": aq(Y, 7)}, "talk": "R", "proud": True},
    "smith": {"rest": {"upper_arm.L": aq(Y, -12), "upper_arm.R": aq(Y, 12)}, "talk": "R"},
    "mage": {"rest": {"upper_arm.L": aq(Y, -6), "upper_arm.R": aq(Y, 4)}, "talk": "L"},
    "priest": {"rest": {"upper_arm.L": aq(Y, -4) @ aq(X, -10), "forearm.L": aq(X, -30), "upper_arm.R": aq(Y, 6)}, "talk": "R"},
    "clown": {"rest": {"upper_arm.L": aq(Y, -10), "upper_arm.R": aq(Y, 6)}, "talk": "L", "bouncy": True},
    "warehouse": {"rest": {"upper_arm.L": aq(Y, -4) @ aq(X, -10), "forearm.L": aq(X, -30), "upper_arm.R": aq(Y, 6)}, "talk": "R"},
    "guild": {"rest": {"upper_arm.L": aq(Y, -6), "upper_arm.R": aq(Y, 6)}, "talk": "R"},
}


def poses(nid):
    st = STYLE.get(nid, {"rest": {}, "talk": "R"})
    REST = st["rest"]

    def with_rest(r):
        out = dict(REST)
        for k, v in r.items():
            out[k] = v @ out.get(k, Quaternion())
        return out

    def idle(t):
        """Idle 2.4 秒：呼吸、頭輕微擺動、重心微移（小丑多一點彈跳感）"""
        b = math.sin(2 * math.pi * t)
        amp = 1.6 if st.get("bouncy") else 1.0
        return with_rest({"spine": aq(X, -1.2 * b * amp), "chest": aq(X, -1.0 * b), "head": aq(X, 1.2 * b) @ aq(Z, 2.5 * amp * math.sin(math.pi * t)),
                          "hips": aq(Y, 1.0 * math.sin(math.pi * t)), "upper_arm.L": aq(Y, 2 * b), "upper_arm.R": aq(Y, -2 * b)}), {"hips": (0, 0, -0.003 * amp * (1 - b) / 2)}

    def talk(t):
        """Talk 2.4 秒循環：空著的手抬起比劃、點頭、上身微向前"""
        g = 0.5 - 0.5 * math.cos(2 * math.pi * t)
        w = math.sin(4 * math.pi * t)
        s = st["talk"]
        sg = 1 if s == "R" else -1
        r = {f"upper_arm.{s}": aq(X, -38 - 8 * g) @ aq(Y, 18 * sg), f"forearm.{s}": aq(X, -55 - 10 * w) @ aq(Z, 10 * sg), f"hand.{s}": aq(Y, 25 * sg),
             "head": aq(X, 5 * max(0.0, math.sin(4 * math.pi * t))) @ aq(Z, -4 * g * sg), "chest": aq(X, (-2 if st.get("proud") else 2) * g), "spine": aq(Z, -3 * g * sg)}
        return with_rest(r), {}

    def turn(t):
        """Turn 0.8 秒：上身先轉、兩腳交替踏一小步（執行時整個角色同時轉向）"""
        k = math.sin(math.pi * t)
        s2 = math.sin(2 * math.pi * t)
        return with_rest({"chest": aq(Z, 10 * k), "spine": aq(Z, 6 * k), "head": aq(Z, 12 * k), "thigh.L": aq(X, -12 * max(s2, 0)), "shin.L": aq(X, 18 * max(s2, 0)),
                          "thigh.R": aq(X, -12 * max(-s2, 0)), "shin.R": aq(X, 18 * max(-s2, 0)), "upper_arm.L": aq(X, 6 * s2), "upper_arm.R": aq(X, -6 * s2)}), {"hips": (0, 0, 0.006 * abs(s2))}

    return [("Idle", 2.4, idle), ("Talk", 2.4, talk), ("Turn", 0.8, turn)]


def make_actions(rig, acts):
    rig.animation_data_create()
    out = []
    for name, dur, fn in acts:
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


def merge_by_material(objs, nid):
    groups = {}
    for o in objs:
        groups.setdefault(o.data.materials[0].name, []).append(o)
    out = []
    for mname, lst in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in lst:
            o.select_set(True)
        bpy.context.view_layer.objects.active = lst[0]
        if len(lst) > 1:
            bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = f"npc_{nid}_" + mname.replace("NPC_", "")
        ob.data.name = ob.name
        out.append(ob)
    return out


def export_glb(objs, rig, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs + [rig]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_skins=True,
              export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True)
    try:
        bpy.ops.export_scene.gltf(**kw, export_optimize_animation_size=True, export_reset_pose_bones=True)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)


def run(nid, report):
    rep = {"lods": {}}
    for lod in ("hq", "lite"):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        objs, mats, meta = load(nid, lod)
        cam = setup_scene()
        before = tri_count(objs)
        decimate_to(objs, BUDGET[lod] - 300)
        tris = tri_count(objs)
        rig = build_rig(meta["joints"], nid)
        skin(objs, rig)
        parts_before = len(objs)
        objs = merge_by_material(objs, nid)
        acts = poses(nid)
        made = make_actions(rig, acts)
        if lod == "hq" and RENDER:
            idle, talk, turn = (fn for _, _, fn in acts)
            set_pose(rig, *idle(0.0))
            bpy.context.view_layer.update()
            zc = Z_BOTTOM + H * PX / 2
            for v, yaw in (("front", 0), ("left45", 35), ("side", 90), ("back", 180)):
                shoot(cam, yaw, zc, H * PX, (W, H), os.path.join(OUT, f"npc_{nid}_{v}.png"))
            shoot(cam, 15, 0.84, 0.52, (520, 520), os.path.join(OUT, f"npc_{nid}_head.png"))
            bpy.context.scene.cycles.samples = 28
            for name, fn, t in (("talk", talk, 0.3), ("turn", turn, 0.5)):
                set_pose(rig, *fn(t))
                bpy.context.view_layer.update()
                shoot(cam, 30, zc, H * PX, (400, 500), os.path.join(OUT, f"npc_{nid}_{name}.png"))
            set_pose(rig, {})
        bpy.context.scene.frame_set(0)
        path = os.path.join(OUT, f"npc_{nid}_{lod}.glb")
        export_glb(objs, rig, path)
        rep["lods"][lod] = {"triangles": tris, "triangles_before_decimate": before, "within_budget": tris <= BUDGET[lod], "parts": parts_before, "meshes": len(objs),
                            "mesh_names": sorted(o.name for o in objs), "materials": sorted(mats.keys()), "bones": len(rig.data.bones),
                            "actions": [{"name": n, "frames": f, "fps": FPS} for n, f in made], "bytes": os.path.getsize(path)}
        print(nid, lod, tris, len(objs), flush=True)
    rep["name"] = meta["name"]
    rep["design"] = meta["design"]
    rep["gender"] = meta["gender"]
    report["npcs"][nid] = rep


def main():
    report = {"budget": BUDGET, "npcs": {}}
    for nid in IDS:
        run(nid, report)
    json.dump(report, open(os.path.join(OUT, "npc_report.json"), "w"), indent=1, ensure_ascii=False)
    bad = [n for n, r in report["npcs"].items() if not all(v["within_budget"] for v in r["lods"].values())]
    if bad:
        raise SystemExit(f"三角面超出預算：{bad}")


main()
