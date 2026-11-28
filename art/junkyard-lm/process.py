# 星廢垃圾場 V3：Tripo 地標原檔 → 遊戲用 HQ／Lite GLB（Blender 4.2，無頭執行）
# 用法：blender -b --factory-startup -P art/junkyard-lm/process.py -- <raw 資料夾> <輸出資料夾> <budgets.json> [--selftest]
# - 原始檔不修改；每個 raw/<stem>.glb 產生 <stem>_hq.glb、<stem>_lite.glb
# - 合併網格、三角化、依預算減面（Decimate Collapse）；貼圖縮小；Lite 移除法線貼圖；貼圖以 JPEG 輸出
# - 不改變座標、大小、原點（遊戲端依規格自動縮放與置中，HQ／Lite 座標一致才能做遠距離切換）
import bpy
import json
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1:]
raw_dir, out_dir, budgets_path = argv[0], argv[1], argv[2]
selftest = "--selftest" in argv
os.makedirs(out_dir, exist_ok=True)
budgets = json.load(open(budgets_path, encoding="utf-8"))
report = {"files": [], "errors": []}


def log(*a):
    print("JYLM", *a, flush=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def tri_count(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    n = 0
    for o in objs:
        m = o.evaluated_get(dg).to_mesh()
        n += sum(len(p.vertices) - 2 for p in m.polygons)
        o.evaluated_get(dg).to_mesh_clear()
    return n


def join_all():
    objs = mesh_objects()
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    # 先把父節點（glTF 匯入的空物件）變換套用到網格上，再合併
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(objs) > 1:
        bpy.ops.object.join()
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    return mesh_objects()[0]


def apply_mod(o, mod):
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=mod.name)


def decimate_to(o, budget):
    tri = o.modifiers.new("tri", "TRIANGULATE")
    apply_mod(o, tri)
    n0 = tri_count([o])
    if n0 > budget:
        # Collapse 的結果會略多於目標：留 3% 餘裕，最多修正 3 次
        ratio = budget / n0 * 0.97
        for _ in range(3):
            d = o.modifiers.new("dec", "DECIMATE")
            d.decimate_type = "COLLAPSE"
            d.ratio = max(0.001, min(1.0, ratio))
            d.use_collapse_triangulate = True
            apply_mod(o, d)
            n = tri_count([o])
            if n <= budget:
                break
            ratio = budget / n * 0.97
    return n0, tri_count([o])


def shrink_images(limit):
    sizes = []
    for img in bpy.data.images:
        if img.size[0] == 0:
            continue
        w, h = img.size
        if max(w, h) > limit:
            k = limit / max(w, h)
            img.scale(max(1, int(w * k)), max(1, int(h * k)))
        sizes.append([img.name, img.size[0], img.size[1]])
    return sizes


def strip_normal_maps():
    n = 0
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for node in list(mat.node_tree.nodes):
            if node.type == "NORMAL_MAP":
                for link in list(mat.node_tree.links):
                    if link.from_node == node:
                        mat.node_tree.links.remove(link)
                n += 1
    return n


def export(path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_image_format="JPEG",
        export_image_quality=86,
        export_apply=True,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_yup=True,
    )


def process(stem, path):
    b = budgets.get(stem)
    if not b:
        report["errors"].append(f"{stem}: 沒有預算（檔名不是規格中的零件主幹）")
        return
    for q in ("hq", "lite"):
        reset()
        bpy.ops.import_scene.gltf(filepath=path)
        if not mesh_objects():
            report["errors"].append(f"{stem}: 沒有網格")
            return
        o = join_all()
        n0, n1 = decimate_to(o, b["hqTris"] if q == "hq" else b["liteTris"])
        imgs = shrink_images(b["hqTex"] if q == "hq" else b["liteTex"])
        stripped = strip_normal_maps() if q == "lite" else 0
        dims = list(o.dimensions)
        out = os.path.join(out_dir, f"{stem}_{q}.glb")
        export(out)
        rec = {
            "file": os.path.basename(out),
            "trisIn": n0,
            "tris": n1,
            "budget": b["hqTris"] if q == "hq" else b["liteTris"],
            "images": imgs,
            "normalMapsRemoved": stripped,
            "materials": len([m for m in bpy.data.materials if m.users]),
            "bboxBlender": [round(v, 3) for v in dims],
            "bytes": os.path.getsize(out),
        }
        report["files"].append(rec)
        log(json.dumps(rec, ensure_ascii=False))


def make_selftest(raw):
    # 測試用：高面數球＋大貼圖（驗證流程，不是美術）
    reset()
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=7, radius=3)
    o = bpy.context.active_object
    img = bpy.data.images.new("selftest_tex", 3000, 3000)
    img.generated_type = "COLOR_GRID"
    img.pack()
    mat = bpy.data.materials.new("selftest")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    o.data.materials.append(mat)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.uv.smart_project()
    bpy.ops.object.mode_set(mode="OBJECT")
    p = os.path.join(raw, "jy_lm_colossus.glb")
    export(p)
    return p


raws = sorted(f for f in os.listdir(raw_dir) if f.lower().endswith(".glb")) if os.path.isdir(raw_dir) else []
if selftest:
    tmp = "/tmp/jylm_selftest_raw"
    os.makedirs(tmp, exist_ok=True)
    make_selftest(tmp)
    raw_dir = tmp
    raws = ["jy_lm_colossus.glb"]
    report["selftest"] = True
for f in raws:
    stem = os.path.splitext(f)[0]
    log("process", stem)
    try:
        process(stem, os.path.join(raw_dir, f))
    except Exception as e:  # noqa: BLE001
        report["errors"].append(f"{stem}: {e}")
        log("ERROR", stem, e)
json.dump(report, open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
log("done", len(report["files"]), "files", len(report["errors"]), "errors")
