#!/usr/bin/env python3
"""Stage 8.4（Claude D）：其他玩家合併模型（Claude C 的 novice_c10b5b_{g}_remote.glb）的「頭髮頂點」清單。

合併模型把頭髮併進 body_merged／body_far（頂點色），沒辦法用材質改髮色。這個工具用 Lite 模型（頭髮是獨立網格：
hair、ponytail）做比對：合併模型的每個頂點找 Lite 最近的頂點，最近點屬於頭髮網格 → 算頭髮頂點。
遠距離版（body_far，頭髮減面）一樣用最近點分類。輸出 public/models/novice_c10b5b_{g}_remote_hair.json：
  { "body_merged": [[起, 迄), ...], "body_far": [...] }（頂點索引區間）
遊戲執行時只把這些頂點的顏色乘上髮色（與 Lite 髮型材質 albedoColor 相乘的效果相同）。不修改任何模型檔。

用法：python3 tools/mp-remote-hairmask.py [public/models]
"""
import json
import struct
import sys

import numpy as np
from scipy.spatial import cKDTree

ROOT = sys.argv[1] if len(sys.argv) > 1 else "public/models"
COMP = {5126: ("f", 4), 5121: ("B", 1), 5123: ("H", 2), 5125: ("I", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def load(path):
    b = open(path, "rb").read()
    n = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20 : 20 + n])
    return j, b[20 + n + 8 :]


def accessor(j, blob, i):
    a = j["accessors"][i]
    bv = j["bufferViews"][a["bufferView"]]
    fmt, size = COMP[a["componentType"]]
    nc = NCOMP[a["type"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride", size * nc)
    dt = np.dtype("<" + fmt)
    out = np.empty((a["count"], nc), dtype=np.float64)
    for c in range(nc):
        out[:, c] = np.ndarray((a["count"],), dtype=dt, buffer=blob, offset=off + c * size, strides=(stride,))
    if a.get("normalized"):
        out /= float(np.iinfo(dt).max)
    return out


def world_positions(j, blob, mesh_name):
    """網格頂點（套用節點的 TRS；骨架綁定姿勢下兩個檔案相同）"""
    for ni, node in enumerate(j["nodes"]):
        if "mesh" not in node or j["meshes"][node["mesh"]]["name"] != mesh_name:
            continue
        pos = np.concatenate([accessor(j, blob, p["attributes"]["POSITION"]) for p in j["meshes"][node["mesh"]]["primitives"]])
        s = np.array(node.get("scale", [1, 1, 1]))
        t = np.array(node.get("translation", [0, 0, 0]))
        return pos * s + t
    raise KeyError(mesh_name)


def ranges(mask):
    out, start = [], None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append([start, i])
            start = None
    if start is not None:
        out.append([start, len(mask)])
    return out


for g in ("male", "female"):
    lj, lb = load(f"{ROOT}/novice_c10b5b_{g}_lite.glb")
    rj, rb = load(f"{ROOT}/novice_c10b5b_{g}_remote.glb")
    pts, lab = [], []
    for m in lj["meshes"]:
        try:
            p = world_positions(lj, lb, m["name"])
        except KeyError:
            continue
        pts.append(p)
        lab.append(np.full(len(p), m["name"] in ("hair", "ponytail")))
    tree = cKDTree(np.concatenate(pts))
    is_hair = np.concatenate(lab)
    res = {"note": "Stage 8.4 其他玩家合併模型的頭髮頂點區間（tools/mp-remote-hairmask.py 產生）"}
    for name in ("body_merged", "body_far"):
        p = world_positions(rj, rb, name)
        d, idx = tree.query(p)
        mask = is_hair[idx] & (d < 0.02)
        res[name] = ranges(mask)
        print(g, name, f"{len(p)} 頂點，頭髮 {int(mask.sum())}，最近距離中位數 {np.median(d) * 1000:.2f} mm，區間 {len(res[name])}")
    json.dump(res, open(f"{ROOT}/novice_c10b5b_{g}_remote_hair.json", "w"), separators=(",", ":"))
