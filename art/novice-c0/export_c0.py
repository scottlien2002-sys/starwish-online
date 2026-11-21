"""
C0：把 B.2 灰模（造型不改）取樣成網格，並加上頂點色（配色＋髮束深淺＋SDF 環境光遮蔽）與頭部臉貼圖 UV。
輸出給 blender_c0.py：c0_<g>_parts.npz / .json、c0_face_<g>.png

  python3 art/novice-c0/export_c0.py <輸出資料夾> [male|female|both]
"""
import json
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "novice-v2"))
sys.path.insert(0, str(HERE.parent / "bobo-v38r"))
import bobo_shape  # noqa: E402
import c0_look as L  # noqa: E402
import novice_shapes as NS  # noqa: E402


def sample_vol(vol, origin, st, P):
    idx = np.clip(np.round((P - origin) / st).astype(int), 0, np.array(vol.shape) - 1)
    return vol[idx[:, 0], idx[:, 1], idx[:, 2]]


def sdf_ao(vol, origin, st, V, N):
    """距離場環境光遮蔽：沿法線往外取樣，距離場比預期小 → 附近有東西擋住（髮束之間、衣服皺褶）"""
    occ = np.zeros(len(V))
    wsum = 0.0
    for i, d in enumerate((0.008, 0.016, 0.03, 0.05)):
        w = 0.5 ** i
        sd = sample_vol(vol, origin, st, V + N * d)
        occ += w * np.clip((d - sd) / d, 0, 1)
        wsum += w
    return np.clip(1 - 0.9 * occ / wsum, 0.45, 1)


def export(g, out):
    data, info = {}, []
    for i, p in enumerate(NS.build(g)):
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
        key = f"{i:02d}_{p.name}"
        data[key + "__v"] = verts.astype(np.float32)
        data[key + "__q"] = np.asarray(quads, np.int32)
        data[key + "__n"] = nrm.astype(np.float32)
        data[key + "__c"] = col.astype(np.float32)  # sRGB 0～1
        if p.name == "head":
            col = col * 0 + 1.0  # 頭部顏色全部來自臉部貼圖
            data[key + "__c"] = (0.75 + 0.25 * ao)[:, None].repeat(3, 1).astype(np.float32)
            data[key + "__uv"] = L.uv_of(verts).astype(np.float32)
        info.append({"key": key, "name": p.name, "group": p.group, "palette": L.part_key(g, p.name),
                     "step": st, "verts": int(len(verts)), "quads": int(len(quads)), "textured": p.name == "head"})
        print(f"  {g} {p.name:20s} {len(verts):7d} verts {time.time() - t:5.1f}s", flush=True)
    np.savez_compressed(Path(out) / f"c0_{g}_parts.npz", **data)
    (Path(out) / f"c0_{g}_parts.json").write_text(json.dumps({"parts": info, "surface": L.SURFACE}, indent=1, ensure_ascii=False))
    L.face_texture(g).save(Path(out) / f"c0_face_{g}.png")


if __name__ == "__main__":
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    which = sys.argv[2] if len(sys.argv) > 2 else "both"
    for g in ("male", "female"):
        if which in ("both", g):
            export(g, out)
