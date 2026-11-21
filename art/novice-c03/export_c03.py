"""
C0.3：取樣 c03_shapes 的零件 → 網格＋頂點色（C0 配色＋SDF 環境光遮蔽＋頭髮髮束陰影）＋頭部臉貼圖 UV。
  python3 art/novice-c03/export_c03.py <輸出資料夾> [male|female|both]
輸出：c03_<g>_parts.npz / .json、c03_face_<g>.png（臉部貼圖與 C0 相同，只是另存新檔名）
"""
import json
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "novice-c02"))
sys.path.insert(0, str(HERE.parent / "novice-c01"))
sys.path.insert(0, str(HERE.parent / "novice-c0"))
sys.path.insert(0, str(HERE.parent / "bobo-v38r"))
import bobo_shape  # noqa: E402
import c03_look as L  # noqa: E402
import c03_shapes as CS  # noqa: E402
from export_c0 import sdf_ao  # noqa: E402


def export(g, out):
    data, info = {}, []
    for i, p in enumerate(CS.build(g)):
        t = time.time()
        vol, origin, st = p.sample()
        if not (vol < 0).any():
            continue
        origin = np.asarray(origin, float)
        verts, quads = bobo_shape.surface_nets(vol, origin, st)
        gr = np.stack(np.gradient(vol, st), -1)
        idx = np.clip(np.round((verts - origin) / st).astype(int), 0, np.array(vol.shape) - 1)
        nrm = gr[idx[:, 0], idx[:, 1], idx[:, 2]]
        nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
        col = L.albedo(g, p.name, verts, nrm)
        ao = sdf_ao(vol, origin, st, verts, nrm)
        col = col * (0.35 + 0.65 * ao)[:, None]
        if p.group == "hair":
            prims = [pr for op, pr, k in p.ops if op == "u"][1:] or [pr for op, pr, k in p.ops if op == "u"]
            col = col * L.strand_shading(prims, verts)[:, None]
        key = f"{i:02d}_{p.name}"
        data[key + "__v"] = verts.astype(np.float32)
        data[key + "__q"] = np.asarray(quads, np.int32)
        data[key + "__n"] = nrm.astype(np.float32)
        data[key + "__c"] = np.clip(col, 0, 1).astype(np.float32)
        if p.name == "head":
            data[key + "__c"] = (0.75 + 0.25 * ao)[:, None].repeat(3, 1).astype(np.float32)
            data[key + "__uv"] = L.uv_of(verts).astype(np.float32)
        info.append({"key": key, "name": p.name, "group": p.group, "palette": L.part_key(g, p.name),
                     "step": st, "verts": int(len(verts)), "quads": int(len(quads)), "textured": p.name == "head"})
        print(f"  {g} {p.name:20s} {len(verts):7d} verts {time.time() - t:5.1f}s", flush=True)
    np.savez_compressed(Path(out) / f"c03_{g}_parts.npz", **data)
    (Path(out) / f"c03_{g}_parts.json").write_text(json.dumps({"parts": info, "surface": L.SURFACE}, indent=1, ensure_ascii=False))
    L.face_texture(g).save(Path(out) / f"c03_face_{g}.png")


if __name__ == "__main__":
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    which = sys.argv[2] if len(sys.argv) > 2 else "both"
    for g in ("male", "female"):
        if which in ("both", g):
            export(g, out)
