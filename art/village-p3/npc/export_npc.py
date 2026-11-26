"""星芽村正式 NPC：取樣各 NPC 自己的零件＋唯讀合併 A 的男／女初心者基礎網格（頭、臉、身體、手、靴子）
→ 頂點色網格（npz／json）＋換虹膜顏色的臉部貼圖。

  A_ART=<A 的 art 資料夾（唯讀）> python3 export_npc.py <A 的 export_c10b4 輸出資料夾> <輸出資料夾> [npc id ...]
輸出：npc_<id>_parts.npz、npc_<id>_parts.json、npc_<id>_face.png
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import npc_parts as S  # noqa: E402
import bobo_shape  # noqa: E402  （A 的 Surface Nets）
from export_c0 import sdf_ao  # noqa: E402
import novice_shapes as NS  # noqa: E402

# 沿用 A 的零件：頭（含臉部貼圖）、身體、手、靴子；不沿用 A 的頭髮與服裝
KEEP = {"head", "body", "hand_l", "hand_r", "boot_l", "boot_r", "boot_sole", "boot_strap", "boot_buckle", "boot_gem_l", "boot_gem_r", "boot_strap_l", "boot_strap_r"}
BOOTS = {"boot_l", "boot_r"}
HEAD_SCALE = 0.92  # 與洛恩相同：頭部以頸部為支點略縮小（村民是成年人）
HEAD_PIVOT = np.array([0.0, 0.02, 0.6])
HEAD_BONE = "head"
# 單一材質：臉部貼圖縮到 1024 並在底部加 32 px 白色條；身體／服裝的 UV 全部指向白色條 → 整個 NPC 只要 1 個網格、1 次繪製
ATLAS = 1024
STRIP = 32
WHITE_UV = (0.5, STRIP / 2 / ATLAS)


def face_uv(uv):
    out = np.asarray(uv, np.float32).copy()
    out[:, 1] = STRIP / ATLAS + out[:, 1] * (ATLAS - STRIP) / ATLAS
    return out
GOLD = np.array([0.95, 0.76, 0.34])
DEFAULT = {"cloth": (0.8, 0.8, 0.8), "metal": (0.8, 0.82, 0.86), "trim": tuple(GOLD), "leather": (0.42, 0.27, 0.16), "wood": (0.48, 0.32, 0.2), "dark": (0.2, 0.18, 0.22),
           "glow": (0.8, 0.75, 1.0), "band": (0.8, 0.2, 0.2)}


def albedo(npc, p, V, N):
    cols = npc["colors"]
    if p.name in npc.get("stripes", {}):
        a, b = (np.asarray(c, float) for c in npc["stripes"][p.name])
        t = (np.floor(np.arctan2(V[:, 0], -V[:, 1]) / (np.pi / 7)) % 2)[:, None]
        return a * (1 - t) + b * t
    c = cols.get(p.name)
    if c is None:
        c = DEFAULT.get(p.group, (0.8, 0.8, 0.8))
    if isinstance(c[0], (tuple, list)):  # 頭髮：深→亮漸層（頂部受光）
        base, hi = np.asarray(c[0], float), np.asarray(c[1], float)
        t = np.clip(N[:, 2] * 0.6 + 0.3 + (V[:, 2] - 0.9) * 1.2, 0, 1)[:, None]
        return base * (1 - t) + hi * t
    return np.tile(np.asarray(c, float), (len(V), 1))


def tint(c, target):
    lum = c.mean(1, keepdims=True)
    return np.clip(np.asarray(target, float) * lum / max(float(lum.mean()), 1e-6), 0, 1)


def recolor_face(src, dst, iris, makeup=False):
    """藍色虹膜 → NPC 自己的虹膜顏色（亮度保留；高光、眼白不變）；小丑另加臉頰星星彩繪"""
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32) / 255
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    blue = (b > r + 0.12) & (b > g + 0.02)
    lum = 0.3 * r + 0.55 * g + 0.15 * b
    t = np.clip((lum - 0.05) / 0.75, 0, 1)
    dark, mid, light = (np.asarray(x, float) for x in iris)
    col = np.where((t < 0.5)[..., None], dark + (mid - dark) * (t / 0.5)[..., None], mid + (light - mid) * ((t - 0.5) / 0.5)[..., None])
    out = np.where(blue[..., None], col, im)
    if makeup:
        out = clown_paint(out, blue)
    face = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).resize((ATLAS, ATLAS - STRIP), Image.LANCZOS)
    atlas = Image.new("RGB", (ATLAS, ATLAS), (255, 255, 255))
    atlas.paste(face, (0, 0))
    atlas.save(dst)
    atlas.resize((ATLAS // 2, ATLAS // 2), Image.LANCZOS).save(str(dst).replace(".png", "_lite.png"))
    return int(blue.sum())


def clown_paint(im, iris_mask):
    """在虹膜下方兩側畫小星星（用貼圖上虹膜的位置定位，不必知道 UV 配置）"""
    H, W = iris_mask.shape
    ys, xs = np.nonzero(iris_mask)
    if len(xs) < 20:
        return im
    mid = (xs.min() + xs.max()) / 2
    out = im.copy()
    yy, xx = np.mgrid[0:H, 0:W]
    for side in (xs[xs < mid], xs[xs >= mid]):
        if len(side) == 0:
            continue
        cx = side.mean()
        h = ys.max() - ys.min()
        cy = ys.max() + h * 0.55
        R = h * 0.28
        ang = np.arctan2(yy - cy, xx - cx)
        rr = np.hypot(yy - cy, xx - cx)
        star = rr < R * (0.55 + 0.45 * np.cos(5 * (ang + np.pi / 2)) ** 2)
        out[star] = out[star] * 0.2 + np.array([0.3, 0.45, 0.95]) * 0.8
    return out


def head_tf(name, V):
    return (V - HEAD_PIVOT) * HEAD_SCALE + HEAD_PIVOT


def export_one(npc_id, a_out, out):
    npc = S.NPCS[npc_id]()
    g = npc["gender"]
    a = np.load(Path(a_out) / f"c10b4_{g}_parts.npz")
    meta = json.load(open(Path(a_out) / f"c10b4_{g}_parts.json"))
    data, info = {}, []
    i = 0
    for it in meta["parts"]:
        if it["name"] not in KEEP:
            continue
        k = it["key"]
        key = f"{i:02d}_{it['name']}"
        for suf in ("__v", "__q", "__n", "__c", "__uv"):
            if k + suf in a:
                data[key + suf] = a[k + suf]
        V = a[k + "__v"]
        data[key + "__v"] = (head_tf(it["name"], V) if it["name"] == "head" else V).astype(np.float32)
        c = a[k + "__c"]
        if it["name"] in BOOTS and "boot" in npc["colors"]:
            c = tint(c, npc["colors"]["boot"])
        data[key + "__c"] = c.astype(np.float32)
        data[key + "__uv"] = face_uv(a[k + "__uv"]) if k + "__uv" in a else np.tile(np.array(WHITE_UV, np.float32), (len(V), 1))
        info.append({**it, "key": key, "bind": None, "source": f"A:C1.0-B4 {g}（唯讀）"})
        i += 1
    for p in npc["parts"]:
        t = time.time()
        vol, origin, st = p.sample()
        if not (vol < 0).any():
            print("  empty", p.name)
            continue
        origin = np.asarray(origin, float)
        V, Q = bobo_shape.surface_nets(vol, origin, st)
        gr = np.stack(np.gradient(vol, st), -1)
        idx = np.clip(np.round((V - origin) / st).astype(int), 0, np.array(vol.shape) - 1)
        N = gr[idx[:, 0], idx[:, 1], idx[:, 2]]
        N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
        col = albedo(npc, p, V, N)
        if p.group not in ("glow",):
            ao = sdf_ao(vol, origin, st, V, N)
            col = col * (0.55 + 0.45 * ao)[:, None]
        bind = p.bind
        if isinstance(bind, dict) and "head" in bind:  # 頭部零件（頭髮、帽子、眼鏡、鬍子、頭紗）與頭一起縮放
            V = head_tf(p.name, V)
        key = f"{i:02d}_{p.name}"
        data[key + "__v"] = V.astype(np.float32)
        data[key + "__q"] = Q.astype(np.int32)
        data[key + "__n"] = N.astype(np.float32)
        data[key + "__c"] = np.clip(col, 0, 1).astype(np.float32)
        data[key + "__uv"] = np.tile(np.array(WHITE_UV, np.float32), (len(V), 1))
        # 頭部零件、其他零件一律記錄綁定
        info.append({"key": key, "name": p.name, "group": p.group, "palette": p.name, "step": p.step, "verts": len(V), "quads": len(Q), "textured": False,
                     "bind": bind, "source": f"B:NPC {npc_id}"})
        print(f"  {npc_id:11s} {p.name:14s} {len(V):7d} verts {time.time() - t:5.1f}s", flush=True)
        i += 1
    out = Path(out)
    np.savez_compressed(out / f"npc_{npc_id}_parts.npz", **data)
    n = recolor_face(Path(a_out) / f"c10b4_face_{g}.png", out / f"npc_{npc_id}_face.png", npc["iris"], npc.get("makeup", False))
    joints = {"arm": [list(map(float, j)) for j in NS.arm_joints(g)], "leg": [list(map(float, j)) for j in NS.leg_joints(g)]}
    json.dump({"id": npc["id"], "key": npc_id, "name": npc["name"], "gender": g, "design": npc["design"], "parts": info, "joints": joints, "head_scale": HEAD_SCALE,
               "surface": meta.get("surface", {}), "face_recolored_px": n}, open(out / f"npc_{npc_id}_parts.json", "w"), ensure_ascii=False, indent=1)


def main(a_out, out, ids):
    Path(out).mkdir(parents=True, exist_ok=True)
    for nid in ids or S.NPC_ORDER:
        t = time.time()
        export_one(nid, a_out, out)
        print(f"== {nid} {time.time() - t:.0f}s", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
