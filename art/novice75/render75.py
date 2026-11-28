"""
Stage 7.5：用 Blender 讀「實際輸出的 GLB」再算繪一次（與建置腳本不同的匯入器，獨立驗證檔案正確）。
- 每段動作取 4 格（正面＋側面）
- 武器掛點：在 Weapon_R／Weapon_L 放一把 0.6 m 的替代刀身（+Y 方向），看握持方向
blender -b --factory-startup -P art/novice75/render75.py -- <hq.glb> <out dir>
"""
import bpy, sys, os, json, math
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
GLB, OUT = args[0], args[1]
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.color_type = "TEXTURE"
sc.render.resolution_x = 300
sc.render.resolution_y = 360
sc.world = bpy.data.worlds.new("w")
bpy.ops.import_scene.gltf(filepath=GLB)
for o in list(sc.objects):
    if o.type == "MESH" and not any(m.type == "ARMATURE" for m in o.modifiers):
        bpy.data.objects.remove(o, do_unlink=True)
arm = next(o for o in sc.objects if o.type == "ARMATURE")
info = {"actions": [a.name for a in bpy.data.actions], "objects": [(o.name, o.type) for o in sc.objects]}

# 替代刀身（+Y）
for side in ("Weapon_R", "Weapon_L"):
    emp = sc.objects.get(side)
    if not emp:
        # 匯入器可能把非關節的子節點轉成 empty 或骨骼
        info.setdefault("socket_missing", []).append(side)
        continue
    bpy.ops.mesh.primitive_cube_add(size=1)
    blade = bpy.context.active_object
    blade.scale = (0.012, 0.3, 0.025)
    blade.location = (0, 0.3, 0)
    blade.parent = emp
    m = bpy.data.materials.new("blade")
    m.diffuse_color = (0.95, 0.95, 1, 1) if side == "Weapon_R" else (1, 0.5, 0.2, 1)
    blade.data.materials.append(m)
    info.setdefault("sockets", []).append({"name": side, "parent_type": emp.parent_type, "parent_bone": emp.parent_bone, "world": [round(v, 3) for v in emp.matrix_world.translation]})

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
cam.data.type = "ORTHO"
cam.data.ortho_scale = 1.7
sc.camera = cam
center = Vector((0, 0, 0.66))
dirs = {"front": (0, -1, 0), "side": (1, 0, 0)}

files = []


def shot(name):
    for v, d in dirs.items():
        d = Vector(d)
        cam.location = center + d * 5
        cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        fp = os.path.join(OUT, f"{name}_{v}.png")
        sc.render.filepath = fp
        bpy.ops.render.render(write_still=True)
        files.append(os.path.basename(fp))


arm.animation_data_create()
arm.animation_data.action = None
sc.frame_set(1)
shot("rest")
for an in ("Idle", "Walk", "Run", "Attack", "Attack_1H_Chop", "Attack_1H_Thrust", "Attack_2H_Smash", "Cast_Heal", "Block", "Death", "Skill_TripleSlash", "Jump"):
    act = bpy.data.actions.get(an) or bpy.data.actions.get(f"{an}_{arm.name}")
    if not act:
        info.setdefault("missing_actions", []).append(an)
        continue
    arm.animation_data.action = act
    f0, f1 = act.frame_range
    for k, f in enumerate([f0, f0 + (f1 - f0) * 0.33, f0 + (f1 - f0) * 0.5, f1]):
        sc.frame_set(int(round(f)))
        shot(f"{an}_{k}")
info["files"] = files
json.dump(info, open(os.path.join(OUT, "render.json"), "w"), indent=1)
print("rendered", len(files))
