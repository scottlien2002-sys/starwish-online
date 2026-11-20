"""
初心者 V2 步驟 B：把男女灰模的每個零件取樣成網格，存成 npz（給 Blender 腳本建網格、渲染、匯出 GLB）。
只需要 numpy（不需要設定圖）。

  python3 art/novice-v2/export_parts.py <輸出資料夾> [male|female|both]
"""
import json
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "bobo-v38r"))
import bobo_shape  # noqa: E402
import novice_shapes as NS  # noqa: E402


def export(g, out):
    data, info = {}, []
    for i, p in enumerate(NS.build(g)):
        t = time.time()
        vol, origin, st = p.sample()
        if not (vol < 0).any():
            continue
        verts, quads = bobo_shape.surface_nets(vol, origin, st)
        gr = np.stack(np.gradient(vol, st), -1)
        idx = np.clip(np.round((verts - np.asarray(origin)) / st).astype(int), 0, np.array(vol.shape) - 1)
        nrm = gr[idx[:, 0], idx[:, 1], idx[:, 2]]
        nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
        key = f"{i:02d}_{p.name}"
        data[key + "__v"] = verts.astype(np.float32)
        data[key + "__q"] = np.asarray(quads, np.int32)
        data[key + "__n"] = nrm.astype(np.float32)
        info.append({"key": key, "name": p.name, "group": p.group, "step": st, "verts": int(len(verts)), "quads": int(len(quads))})
        print(f"  {g} {p.name:20s} {len(verts):7d} verts {time.time() - t:5.1f}s", flush=True)
    np.savez_compressed(Path(out) / f"novice_v2_{g}_parts.npz", **data)
    (Path(out) / f"novice_v2_{g}_parts.json").write_text(json.dumps(info, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    which = sys.argv[2] if len(sys.argv) > 2 else "both"
    for g in ("male", "female"):
        if which in ("both", g):
            export(g, out)
