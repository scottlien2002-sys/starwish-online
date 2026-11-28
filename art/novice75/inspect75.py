"""
Stage 7.5 新版男性初心者（Tripo 自動綁骨 GLB）檢查：
- 骨架（名稱、階層、靜止姿勢關節位置）、蒙皮（每頂點影響數、未綁定頂點、各骨骼影響範圍）
- 預覽：靜止姿勢四方向、測試姿勢（手臂上舉、前刺、高舉下劈、跨步、扭腰）、手臂／腿權重熱度圖
- 與 C1.0-B5b 男 HQ 的身高、關節比較
blender -b --factory-startup -P art/novice75/inspect75.py -- <decoded.glb> <c10b5b_male_hq.glb> <out dir>
"""
import bpy, sys, os, json, math
import numpy as np
from mathutils import Vector, Matrix, Euler, Quaternion

args = sys.argv[sys.argv.index("--") + 1:]
SRC, REF, OUT = args[0], args[1], args[2]
os.makedirs(OUT, exist_ok=True)
R = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "TEXTURE"
    sc.render.resolution_x = sc.render.resolution_y = 512
    if not sc.world:
        sc.world = bpy.data.worlds.new("w")
    return sc


def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in objs if o.type == "ARMATURE")
    meshes = [o for o in objs if o.type == "MESH"]
    return arm, meshes, objs


def bbox(meshes):
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


def cam_setup(sc, center, scale):
    cam = bpy.data.objects.get("cam") or bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    if cam.name not in sc.collection.objects:
        sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = scale
    sc.camera = cam
    return cam


def render(sc, center, scale, prefix, views=("front", "side", "back", "q34")):
    cam = cam_setup(sc, center, scale)
    dirs = {"front": (0, -1, 0), "back": (0, 1, 0), "side": (1, 0, 0), "q34": (0.7, -0.7, 0.25), "top": (0, -0.05, 1), "left": (-1, 0, 0)}
    files = []
    for v in views:
        d = Vector(dirs[v]).normalized()
        cam.location = center + d * 6
        cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        fp = os.path.join(OUT, f"{prefix}_{v}.png")
        sc.render.filepath = fp
        bpy.ops.render.render(write_still=True)
        files.append(os.path.basename(fp))
    return files


def world_head(arm, name):
    b = arm.data.bones[name]
    return arm.matrix_world @ b.head_local


def world_tail(arm, name):
    b = arm.data.bones[name]
    return arm.matrix_world @ b.tail_local


sc = reset()
arm, meshes, objs = load(SRC)
mesh = meshes[0]
R["objects"] = [(o.name, o.type, [round(x, 4) for x in o.matrix_world.to_scale()]) for o in objs]
mn, mx = bbox(meshes)
H = mx.z - mn.z
R["bbox"] = {"min": [round(v, 4) for v in mn], "max": [round(v, 4) for v in mx], "height": round(H, 4)}
center = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2))
R["counts"] = {"verts": len(mesh.data.vertices), "tris": sum(len(p.vertices) - 2 for p in mesh.data.polygons), "materials": len(mesh.data.materials), "uv": len(mesh.data.uv_layers)}

# 骨架
bones = []
for b in arm.data.bones:
    h, t = world_head(arm, b.name), world_tail(arm, b.name)
    bones.append({"name": b.name, "parent": b.parent.name if b.parent else None, "head": [round(v, 4) for v in h], "tail": [round(v, 4) for v in t], "len": round((t - h).length, 4)})
R["bones"] = bones


def ang_from_horizontal(a, b):
    d = (world_head(arm, b) - world_head(arm, a)).normalized()
    return round(math.degrees(math.asin(max(-1, min(1, d.z)))), 1)


R["restPose"] = {
    "L_upperarm_elev_deg": ang_from_horizontal("L_Upperarm", "L_Forearm"),
    "R_upperarm_elev_deg": ang_from_horizontal("R_Upperarm", "R_Forearm"),
    "L_forearm_elev_deg": ang_from_horizontal("L_Forearm", "L_Hand"),
    "L_thigh_dir": [round(v, 3) for v in (world_head(arm, "L_Calf") - world_head(arm, "L_Thigh")).normalized()],
    "L_side_x_sign": round(world_head(arm, "L_Hand").x, 3),
    "facing_hint_eye_y": round(world_head(arm, "L_Eye").y - world_head(arm, "Head").y, 4),
}

# 蒙皮
vg = {g.index: g.name for g in mesh.vertex_groups}
nv = len(mesh.data.vertices)
W = np.zeros((nv, len(vg)))
infl = np.zeros(nv, dtype=int)
for v in mesh.data.vertices:
    for g in v.groups:
        if g.weight > 0:
            W[v.index, g.group] = g.weight
            infl[v.index] += 1
CO = np.array([mesh.matrix_world @ v.co for v in mesh.data.vertices])
R["skin"] = {
    "influences_hist": {int(k): int((infl == k).sum()) for k in range(0, int(infl.max()) + 1)},
    "unweighted": int((W.sum(1) < 1e-6).sum()),
    "sum_min": round(float(W.sum(1).min()), 4),
    "sum_max": round(float(W.sum(1).max()), 4),
}
per = {}
for gi, gname in vg.items():
    sel = W[:, gi] > 0.05
    if sel.sum() == 0:
        continue
    P = CO[sel]
    per[gname] = {"n": int(sel.sum()), "w_sum": round(float(W[:, gi].sum()), 1), "z": [round(float(P[:, 2].min()), 3), round(float(P[:, 2].max()), 3)], "x": [round(float(P[:, 0].min()), 3), round(float(P[:, 0].max()), 3)], "y": [round(float(P[:, 1].min()), 3), round(float(P[:, 1].max()), 3)]}
R["skin"]["perBone"] = per
np.save(os.path.join(OUT, "verts.npy"), CO)
np.save(os.path.join(OUT, "weights.npy"), W)
json.dump(vg, open(os.path.join(OUT, "groups.json"), "w"))
# 貼圖顏色（頂點 UV 取樣，給頭髮／披肩分區用）
try:
    img = None
    for m in mesh.data.materials:
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                for l in n.inputs["Base Color"].links:
                    img = l.from_node.image
    if img:
        w, h = img.size
        px = np.array(img.pixels[:]).reshape(h, w, 4)
        uv = mesh.data.uv_layers.active.data
        col = np.zeros((nv, 3))
        cnt = np.zeros(nv)
        for poly in mesh.data.polygons:
            for li in poly.loop_indices:
                vi = mesh.data.loops[li].vertex_index
                u, vv = uv[li].uv
                col[vi] += px[int((vv % 1) * (h - 1)), int((u % 1) * (w - 1)), :3]
                cnt[vi] += 1
        col /= np.maximum(cnt, 1)[:, None]
        np.save(os.path.join(OUT, "vcolor.npy"), col)
except Exception as e:
    R["vcolor_error"] = str(e)

# 靜止姿勢
scale = H * 1.25
R["renders"] = {"rest": render(sc, center, scale, "rest")}

# 權重熱度圖：紅＝左手臂、藍＝右手臂、綠＝腿、黃＝頭
def heat(groups_rgb, prefix):
    col = np.full((nv, 3), 0.85)
    for names, rgb in groups_rgb:
        idx = [gi for gi, gn in vg.items() if any(gn.startswith(n) for n in names)]
        w = W[:, idx].sum(1).clip(0, 1) if idx else np.zeros(nv)
        col = col * (1 - w[:, None]) + np.array(rgb)[None, :] * w[:, None]
    me = mesh.data
    attr = me.color_attributes.get("heat") or me.color_attributes.new("heat", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", np.hstack([col, np.ones((nv, 1))]).ravel())
    me.color_attributes.active_color = attr
    sc.display.shading.color_type = "VERTEX"
    f = render(sc, center, scale, prefix, ("front", "back", "side", "left"))
    sc.display.shading.color_type = "TEXTURE"
    return f


ARM_L = ["L_Clavicle", "L_Upperarm", "L_Forearm", "L_Elbow", "L_Hand", "L_Pinky", "L_Ring", "L_Mid", "L_Index", "L_Thumb"]
ARM_R = [n.replace("L_", "R_") for n in ARM_L]
LEGS = ["L_Thigh", "L_Calf", "L_Knee", "L_Foot", "L_Toe", "R_Thigh", "R_Calf", "R_Knee", "R_Foot", "R_Toe"]
R["renders"]["heat_arms_legs"] = heat([(ARM_L, (0.9, 0.1, 0.1)), (ARM_R, (0.1, 0.2, 0.95)), (LEGS, (0.1, 0.75, 0.2))], "heat")
R["renders"]["heat_upperarm"] = heat([(["L_Upperarm", "L_Clavicle"], (0.9, 0.1, 0.1)), (["R_Upperarm", "R_Clavicle"], (0.1, 0.2, 0.95)), (["Spine02", "Spine01"], (0.9, 0.8, 0.1))], "heatU")
R["renders"]["heat_head"] = heat([(["Head", "FacialBone", "NeckTwist"], (0.95, 0.75, 0.1)), (["Spine02"], (0.2, 0.6, 0.9))], "heatH")

# 測試姿勢（直接轉 Tripo 骨骼；角度為世界座標下的大致方向）
def pose(rots):
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Quaternion()
    bpy.context.view_layer.update()
    for name, axis, deg in rots:
        pb = arm.pose.bones[name]
        # 世界軸 → 骨骼區域軸
        M = (arm.matrix_world @ pb.bone.matrix_local).to_3x3().inverted()
        a = (M @ Vector(axis)).normalized()
        pb.rotation_quaternion = Quaternion(a, math.radians(deg)) @ pb.rotation_quaternion
        bpy.context.view_layer.update()


sideL = 1 if world_head(arm, "L_Hand").x > 0 else -1
fwd = Vector((0, -1, 0)) if R["restPose"]["facing_hint_eye_y"] < 0 else Vector((0, 1, 0))
R["facing"] = list(fwd)
upz = R["restPose"]["L_upperarm_elev_deg"]
TESTS = {
    # 符號未知 → 正反各一張（檢查哪個方向是抬起／放下）
    "armsY_pos": [("L_Upperarm", (0, 1, 0), 60), ("R_Upperarm", (0, 1, 0), 60)],
    "armsY_neg": [("L_Upperarm", (0, 1, 0), -60), ("R_Upperarm", (0, 1, 0), -60)],
    "R_raise_pos": [("R_Upperarm", (0, 1, 0), 110)],
    "R_raise_neg": [("R_Upperarm", (0, 1, 0), -110)],
    "R_forward_pos": [("R_Upperarm", (0, 0, 1), 80)],
    "R_forward_neg": [("R_Upperarm", (0, 0, 1), -80)],
    "R_forearm_bend": [("R_Forearm", (0, 0, 1), 90)],
    "stride": [("L_Thigh", (1, 0, 0), 45), ("R_Thigh", (1, 0, 0), -35), ("L_Calf", (1, 0, 0), -40)],
    "twist": [("Spine01", (0, 0, 1), 30), ("Spine02", (0, 0, 1), 15)],
}
R["renders"]["tests"] = {}
for k, rots in TESTS.items():
    pose(rots)
    R["renders"]["tests"][k] = render(sc, center, scale, f"pose_{k}", ("front", "q34", "back"))
pose([])

# 參考：C1.0-B5b 男 HQ
bpy.ops.object.select_all(action="DESELECT")
for o in objs:
    o.hide_render = True
arm2, meshes2, objs2 = load(REF)
mn2, mx2 = bbox(meshes2)
R["reference"] = {
    "height": round(mx2.z - mn2.z, 4),
    "bones": {b.name: [round(v, 4) for v in (arm2.matrix_world @ b.head_local)] for b in arm2.data.bones},
    "actions": [a.name for a in bpy.data.actions],
    "rest_upperarm_elev_deg": round(math.degrees(math.asin(((arm2.matrix_world @ arm2.data.bones["forearm.L"].head_local) - (arm2.matrix_world @ arm2.data.bones["upper_arm.L"].head_local)).normalized().z)), 1),
}
c2 = (mn2 + mx2) / 2
R["renders"]["reference"] = render(sc, c2, (mx2.z - mn2.z) * 1.25, "ref_c10b5b", ("front", "side"))
json.dump(R, open(os.path.join(OUT, "inspect.json"), "w"), indent=1, ensure_ascii=False)
print("inspected", json.dumps({k: R[k] for k in ("bbox", "counts", "restPose", "facing")}))
