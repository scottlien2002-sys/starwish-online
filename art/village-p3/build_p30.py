"""P3-0 流程驗證樣品（不是正式美術）：用一個小型「噴泉台座＋小塔＋長椅＋旗」測試整條流程。

blender -b --factory-startup -P build_p30.py -- --tex <貼圖資料夾> --out <輸出資料夾>

測試項目：材質與頂點色、方塊投影 UV、倒角、環境光遮蔽烘焙、同材質合併、HQ／Lite 兩級、GLB 匯出、預覽圖。
"""

import math
import os
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vp3_kit as K  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
args = dict(zip(argv[::2], argv[1::2]))
TEX = os.path.abspath(args.get("--tex", "out/textures"))
OUT = os.path.abspath(args.get("--out", "out"))
os.makedirs(OUT, exist_ok=True)
log = []
t0 = time.time()

K.reset()
mats = K.make_materials(TEX, "hq")
WHITE_STONE = (0.95, 0.94, 0.91)
GOLD = (0.98, 0.78, 0.36)
BLUE_ROOF = (0.36, 0.5, 0.86)
WOOD = (0.92, 0.82, 0.7)
BANNER = (0.25, 0.38, 0.8)
PAVING = (0.97, 0.94, 0.88)
WATER = (0.75, 0.9, 1.0)
CRYSTAL = (0.55, 0.8, 1.0)

parts = []


def add(name, op, mat, rgb, bevel=0.0, smooth=False, **kw):
    op(**kw)
    o = bpy.context.active_object
    parts.append(K.part(name, o, mat, rgb, mats, bevel=bevel, smooth=smooth))
    return o


# 地面石板（直徑 6 m）
add("paving", bpy.ops.mesh.primitive_cylinder_add, "paving", PAVING, vertices=48, radius=3.0, depth=0.12, location=(0, 0, 0.06))
# 小水池：台座、池緣、水面
add("basin", bpy.ops.mesh.primitive_cylinder_add, "stone", WHITE_STONE, bevel=0.04, vertices=40, radius=1.4, depth=0.5, location=(0, 0, 0.37))
add("rim", bpy.ops.mesh.primitive_torus_add, "stone", WHITE_STONE, smooth=True, major_radius=1.4, minor_radius=0.12, major_segments=40, minor_segments=10, location=(0, 0, 0.64))
add("water", bpy.ops.mesh.primitive_cylinder_add, "water", WATER, vertices=40, radius=1.3, depth=0.02, location=(0, 0, 0.6))
add("column", bpy.ops.mesh.primitive_cylinder_add, "stone", WHITE_STONE, bevel=0.03, vertices=16, radius=0.22, depth=1.2, location=(0, 0, 1.2))
add("goldband", bpy.ops.mesh.primitive_torus_add, "metal", GOLD, smooth=True, major_radius=0.24, minor_radius=0.04, major_segments=24, minor_segments=8, location=(0, 0, 1.55))
# 星形水晶（八面體拉長）＋兩道金環
add("crystal", bpy.ops.mesh.primitive_ico_sphere_add, "crystal", CRYSTAL, subdivisions=1, radius=0.35, location=(0, 0, 2.15), scale=(1, 1, 1.5))
add("ringA", bpy.ops.mesh.primitive_torus_add, "metal", GOLD, smooth=True, major_radius=0.6, minor_radius=0.025, major_segments=48, minor_segments=6, location=(0, 0, 2.15), rotation=(math.radians(60), 0, 0))
add("ringB", bpy.ops.mesh.primitive_torus_add, "metal", GOLD, smooth=True, major_radius=0.72, minor_radius=0.025, major_segments=48, minor_segments=6, location=(0, 0, 2.15), rotation=(0, math.radians(70), 0))
# 小塔：白石塔身、藍色圓錐屋頂、金色尖頂
add("tower", bpy.ops.mesh.primitive_cylinder_add, "stone", WHITE_STONE, bevel=0.03, vertices=20, radius=0.7, depth=2.6, location=(2.2, 1.2, 1.3))
add("towerRoof", bpy.ops.mesh.primitive_cone_add, "roof", BLUE_ROOF, vertices=20, radius1=0.9, radius2=0.0, depth=1.5, location=(2.2, 1.2, 3.35))
add("finial", bpy.ops.mesh.primitive_cone_add, "metal", GOLD, vertices=10, radius1=0.08, radius2=0.0, depth=0.45, location=(2.2, 1.2, 4.3))
# 長椅：木座、石腳
add("benchSeat", bpy.ops.mesh.primitive_cube_add, "wood", WOOD, bevel=0.015, size=1, location=(-2.0, -1.2, 0.45), scale=(0.9, 0.25, 0.05))
for sx in (-0.75, 0.75):
    add("benchLeg", bpy.ops.mesh.primitive_cube_add, "stone", WHITE_STONE, bevel=0.01, size=1, location=(-2.0 + sx, -1.2, 0.22), scale=(0.08, 0.2, 0.2))
# 旗桿與藍色旗
add("pole", bpy.ops.mesh.primitive_cylinder_add, "metal", (0.3, 0.3, 0.34), vertices=10, radius=0.04, depth=2.6, location=(-2.2, 1.4, 1.3))
add("banner", bpy.ops.mesh.primitive_cube_add, "cloth", BANNER, size=1, location=(-2.2, 1.42, 1.9), scale=(0.3, 0.01, 0.55))

log.append(f"建立物件 {len(parts)} 個，{time.time() - t0:.1f} 秒")
ao_ok = K.bake_ao([p for p in parts if p["vp3_mat"] not in ("water", "crystal")], log=log)
log.append(f"環境光遮蔽烘焙成功 {ao_ok} 個物件")

merged = K.join_by_material(parts, "P30")
tri_hq = K.tri_count(merged)
K.export_glb(merged, os.path.join(OUT, "p30_sample_hq.glb"))

# 預覽（HQ）
cam = K.setup_preview()
target = (0.3, 0.2, 1.2)
for name, yaw, elev, dist in (("front", 0, 12, 9), ("q45", 45, 22, 9.5), ("top", 0, 80, 10), ("close", 25, 15, 4)):
    tg = (0, 0, 1.8) if name == "close" else target
    K.shoot(cam, tg, yaw, elev, dist, os.path.join(OUT, f"p30_{name}.png"))

# Lite：減面＋512 貼圖＋不帶法線
K.decimate(merged, 0.45)
K.swap_textures(TEX, "lite")
tri_lite = K.tri_count(merged)
K.export_glb(merged, os.path.join(OUT, "p30_sample_lite.glb"))

K.write_json(
    os.path.join(OUT, "p30_report.json"),
    {
        "blender": bpy.app.version_string,
        "objects": len(parts),
        "meshes_after_merge": len(merged),
        "materials": sorted({m["vp3_mat"] for m in merged}),
        "triangles": {"hq": tri_hq, "lite": tri_lite},
        "ao_baked_objects": ao_ok,
        "seconds": round(time.time() - t0, 1),
        "log": log,
    },
)
print("\n".join(log))
print("P30 done", tri_hq, tri_lite)
