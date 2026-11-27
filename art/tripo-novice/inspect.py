"""
Tripo 新版初心者零件檢查：每個零件 6 個方向（正交、貼圖顏色），量測包圍盒，輸出 JSON。
blender -b --factory-startup -P art/tripo-novice/inspect.py -- <decoded dir> <out dir>
"""
import bpy, sys, os, json, math
from mathutils import Vector
args = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = args[0], args[1]
os.makedirs(OUT, exist_ok=True)

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "TEXTURE"
    sc.display.shading.show_cavity = False
    sc.render.resolution_x = sc.render.resolution_y = 512
    sc.render.film_transparent = False
    sc.world = bpy.data.worlds.new("w") if not sc.world else sc.world
    return sc

info = {}
VIEWS = {"px": (1, 0, 0), "nx": (-1, 0, 0), "py": (0, 1, 0), "ny": (0, -1, 0), "pz": (0, 0, 1), "nz": (0, 0, -1)}
for f in sorted(os.listdir(SRC)):
    if not f.endswith(".glb"):
        continue
    sc = reset()
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, f))
    objs = [o for o in sc.objects if o.type == "MESH"]
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (mn + mx) / 2
    size = max(mx - mn)
    name = f[:-4]
    info[name] = {"min": list(mn), "max": list(mx), "verts": sum(len(o.data.vertices) for o in objs), "tris": sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons), "objects": [o.name for o in objs]}
    cam = bpy.data.cameras.new("cam"); cam.type = "ORTHO"; cam.ortho_scale = size * 1.15
    co = bpy.data.objects.new("cam", cam); sc.collection.objects.link(co); sc.camera = co
    for v, d in VIEWS.items():
        dv = Vector(d)
        co.location = c + dv * (size * 3)
        co.rotation_euler = (c - co.location).to_track_quat("-Z", "Z" if abs(dv.z) < 0.9 else "Y").to_euler()
        sc.render.filepath = os.path.join(OUT, f"{name}_{v}.png")
        bpy.ops.render.render(write_still=True)
    print("inspected", name, info[name]["min"], info[name]["max"])
json.dump(info, open(os.path.join(OUT, "inspect.json"), "w"), indent=1)
