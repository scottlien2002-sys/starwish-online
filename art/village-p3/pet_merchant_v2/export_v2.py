"""寵物商人 V2：取樣洛恩自己的零件＋唯讀合併 A 的男初心者基礎網格 → 頂點色網格（npz／json）＋琥珀色眼睛的臉部貼圖。

  A_ART=<A 的 art 資料夾（唯讀）> python3 export_v2.py <A 的 export_c10b4 輸出資料夾> <輸出資料夾>
輸出：pm2_parts.npz、pm2_parts.json、pm2_face.png
"""
import colorsys
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import shapes_v2 as S  # noqa: E402
import bobo_shape  # noqa: E402  （A 的 Surface Nets，經 shapes_v2 加入路徑）
from export_c0 import sdf_ao  # noqa: E402

# 沿用 A 的零件（頭、臉、身體、手、靴子、襯衫、袖口金環、皮帶、扣環）；不沿用：A 的頭髮、背心、領巾、圍兜、短褲、手套、腰包
KEEP = {"head", "body", "hand_l", "hand_r", "boot_l", "boot_r", "boot_gem_l", "boot_gem_r", "boot_sole", "boot_strap", "boot_buckle", "shirt", "sleeve_trim", "belt", "belt_edge", "buckle"}


def srgb(c):
    return np.asarray(c, float)


PALETTE = {
    "coat": srgb((0.965, 0.935, 0.87)),
    "coat_trim": srgb((0.15, 0.21, 0.47)),
    "collar": srgb((0.15, 0.21, 0.47)),
    "cuffs": srgb((0.15, 0.21, 0.47)),
    "trousers": srgb((0.18, 0.21, 0.36)),
    "pouch": srgb((0.5, 0.31, 0.18)),
    "feed_tie": srgb((0.45, 0.28, 0.16)),
    "egg_cup": srgb((0.47, 0.29, 0.17)),
    "feed_bag": srgb((0.84, 0.74, 0.54)),
    "stone": srgb((0.6, 0.66, 1.0)),
    "pal_eyes": srgb((0.12, 0.1, 0.2)),
}
GOLD = srgb((0.95, 0.76, 0.34))


def albedo(name, V, N):
    if name in PALETTE:
        return np.tile(PALETTE[name], (len(V), 1))
    if name.endswith("gold"):
        return np.tile(GOLD, (len(V), 1))
    if name == "hair":
        base = np.array([0.36, 0.2, 0.12])
        hi = np.array([0.55, 0.33, 0.2])
        t = np.clip(N[:, 2] * 0.6 + 0.3 + (V[:, 2] - 0.9) * 1.2, 0, 1)[:, None]
        return base * (1 - t) + hi * t
    if name == "egg":
        c = np.tile(srgb((0.98, 0.95, 0.88)), (len(V), 1))
        # 淡藍色斑點（固定位置）
        rng = np.random.default_rng(7)
        cen = V.mean(0)
        for _ in range(9):
            d = rng.normal(size=3)
            d /= np.linalg.norm(d)
            m = np.linalg.norm((V - cen) / np.array([0.025, 0.025, 0.033]) - d, axis=1) < 0.32
            c[m] = srgb((0.62, 0.78, 1.0))
        return c
    if name == "pal":
        c = np.tile(srgb((0.985, 0.975, 0.955)), (len(V), 1))
        tip = (V[:, 2] > 0.105)
        c[tip] = srgb((0.56, 0.72, 1.0))
        cheek = (np.abs(np.abs(V[:, 0]) - 0.028) < 0.009) & (V[:, 1] < -0.04) & (np.abs(V[:, 2] - 0.024) < 0.006)
        c[cheek] = srgb((1.0, 0.75, 0.78))
        return c
    return np.tile(srgb((0.8, 0.8, 0.8)), (len(V), 1))


def recolor_kept(name, c):
    """A 零件的顏色調整：皮帶改深棕；其餘保留 A 的頂點色（含 A 的環境光遮蔽）"""
    if name in ("belt", "belt_edge"):
        lum = c.mean(1, keepdims=True)
        return np.clip(np.array([0.46, 0.29, 0.17]) * lum / max(float(lum.mean()), 1e-6), 0, 1)
    return c


def amber_face(src, dst):
    """藍色虹膜 → 琥珀金（亮度保留；白色高光、眼白不變）"""
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32) / 255
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    blue = (b > r + 0.12) & (b > g + 0.02)
    lum = (0.3 * r + 0.55 * g + 0.15 * b)
    t = np.clip((lum - 0.05) / 0.75, 0, 1)
    dark = np.array([0.36, 0.17, 0.04])
    mid = np.array([0.86, 0.55, 0.14])
    light = np.array([1.0, 0.86, 0.45])
    col = np.where((t < 0.5)[..., None], dark + (mid - dark) * (t / 0.5)[..., None], mid + (light - mid) * ((t - 0.5) / 0.5)[..., None])
    out = np.where(blue[..., None], col, im)
    Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).save(dst)
    return int(blue.sum())


# V2.1：頭部（A 的頭＋B 的頭髮）以頸部為支點略縮小，讓頭身比較接近 22～25 歲的青年（避免過度幼兒化）。
# 只改洛恩自己的輸出頂點；A 的原始檔案不動。
HEAD_SCALE = 0.92
HEAD_PIVOT = np.array([0.0, 0.02, 0.6])
HEAD_PARTS = {"head", "hair"}


def head_tf(name, V):
    return (V - HEAD_PIVOT) * HEAD_SCALE + HEAD_PIVOT if name in HEAD_PARTS else V


def main(a_out, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    a = np.load(Path(a_out) / "c10b4_male_parts.npz")
    meta = json.load(open(Path(a_out) / "c10b4_male_parts.json"))
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
        data[key + "__v"] = head_tf(it["name"], a[k + "__v"]).astype(np.float32)
        data[key + "__c"] = recolor_kept(it["name"], a[k + "__c"]).astype(np.float32)
        info.append({**it, "key": key, "source": "A:C1.0-B4 male（唯讀）"})
        i += 1
    for p in S.build():
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
        col = albedo(p.name, V, N)
        if p.group not in ("glow", "eye"):
            ao = sdf_ao(vol, origin, st, V, N)
            col = col * (0.55 + 0.45 * ao)[:, None]
        key = f"{i:02d}_{p.name}"
        data[key + "__v"] = head_tf(p.name, V).astype(np.float32)
        data[key + "__q"] = Q.astype(np.int32)
        data[key + "__n"] = N.astype(np.float32)
        data[key + "__c"] = np.clip(col, 0, 1).astype(np.float32)
        info.append({"key": key, "name": p.name, "group": p.group, "palette": p.name, "step": p.step, "verts": len(V), "quads": len(Q), "textured": False, "source": "B:寵物商人 V2"})
        print(f"  {p.name:12s} {len(V):7d} verts {time.time() - t:5.1f}s", flush=True)
        i += 1
    np.savez_compressed(out / "pm2_parts.npz", **data)
    n_blue = amber_face(Path(a_out) / "c10b4_face_male.png", out / "pm2_face.png")
    json.dump({"parts": info, "surface": meta.get("surface", {}), "face_recolored_px": n_blue}, open(out / "pm2_parts.json", "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
