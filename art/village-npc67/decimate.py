"""Stage 6.7：Tripo NPC 靜態網格減面（Lite／遠距）。只做減面＋三角化，骨架、權重、動作由 Python 建置流程在減面結果上重新計算。"""
import bpy, sys, os, json
argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
os.makedirs(out, exist_ok=True)
# 目標面數：Lite 約 5,000、遠距約 2,000（佈告欄沒有遠距）
TARGET = {"lite": 5000, "far": 2000}
# 佈告欄：lite＝5,000（高畫質使用）、far＝2,500（中低畫質使用）；守住村莊每幀三角面標準
report = {}
for fn in sorted(os.listdir(src)):
    if not fn.endswith(".obj"):
        continue
    key = fn[:-4]
    for lv, tgt in TARGET.items():
        if key == "board" and lv == "far":
            tgt = 2500
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.wm.obj_import(filepath=os.path.join(src, fn))
        ob = bpy.context.selected_objects[0]
        bpy.context.view_layer.objects.active = ob
        n0 = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        md = ob.modifiers.new("dec", "DECIMATE")
        md.decimate_type = "COLLAPSE"
        md.ratio = min(1.0, tgt / n0)
        md.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier="dec")
        md2 = ob.modifiers.new("tri", "TRIANGULATE")
        bpy.ops.object.modifier_apply(modifier="tri")
        n1 = len(ob.data.polygons)
        bpy.ops.wm.obj_export(filepath=os.path.join(out, f"{key}_{lv}.obj"), export_selected_objects=True,
                              export_uv=True, export_normals=False, export_materials=False, export_triangulated_mesh=True)
        report[f"{key}_{lv}"] = {"before": n0, "after": n1}
        print("DEC", key, lv, n0, "->", n1, flush=True)
json.dump(report, open(os.path.join(out, "decimate_report.json"), "w"), indent=1)
