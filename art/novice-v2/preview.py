"""
初心者 V2：本機預覽與設定圖比對（不需要 Blender）。
  - 每個零件取樣 → Surface Nets 網格（沿用星露啵啵 V3.8R）
  - 正面、側面、背面、45 度的灰模著色預覽（頂點點繪＋深度緩衝）
  - 與設定圖輪廓的重疊率（IoU）：模型輪廓直接由體素投影，換到設定圖的像素比例

  python3 art/novice-v2/preview.py <男設定圖> <女設定圖> <輸出資料夾> [male|female|both]
"""
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "bobo-v38r"))
import bobo_shape  # noqa: E402  （只用 surface_nets）
import novice_shapes as NS  # noqa: E402
import measure as M  # noqa: E402

PX = None  # 設定圖 1 像素 = 幾公尺（由量測決定）

GREY = {"skin": 0.92, "hair": 0.66, "cloth": 0.9, "cloth2": 0.6, "leather": 0.48, "metal": 0.98, "dark": 0.4, "face": 0.92}


def build(parts):
    out = []
    for p in parts:
        t = time.time()
        vol, origin, st = p.sample()
        if not (vol < 0).any():
            print("  (empty)", p.name)
            continue
        verts, quads = bobo_shape.surface_nets(vol, origin, st)
        g = np.stack(np.gradient(vol, st), -1)
        idx = np.clip(np.round((verts - np.asarray(origin)) / st).astype(int), 0, np.array(vol.shape) - 1)
        nrm = g[idx[:, 0], idx[:, 1], idx[:, 2]]
        nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
        out.append({"part": p, "vol": vol, "origin": np.asarray(origin), "step": st, "verts": verts, "quads": quads, "normals": nrm})
        print(f"  {p.name:22s} grid {vol.shape} verts {len(verts):7d} {time.time() - t:5.1f}s")
    return out


def yaw(deg):
    a = math.radians(deg)
    return np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])


VIEW_YAW = {"front": 0, "left45": -45, "side": -90, "back": 180}


CAM = {
    "front": ((1, 0, 0), (0, 1, 0)),
    "side": ((0, 1, 0), (-1, 0, 0)),
    "back": ((-1, 0, 0), (0, -1, 0)),
    "left45": ((0.70710678, 0.70710678, 0), (-0.70710678, 0.70710678, 0)),
}


def render(meshes, view, px=0.0021, size=(420, 640), z0=-0.02):
    """
    正交投影的光線求交（直接在每個零件的體素上找第一個「內部」點），法線取距離場梯度 → 平滑的灰模著色。
    鏡頭：right、forward（見 CAM）；畫面上方 = +Z
    """
    W, H = size
    r = np.asarray(CAM[view][0], float)
    f = np.asarray(CAM[view][1], float)
    u = np.array([0, 0, 1.0])
    depth = np.full((H, W), np.inf)
    shade = np.ones((H, W)) * 0.97
    Ld = -f * 0.55 + r * (-0.45) + u * 0.7
    Ld /= np.linalg.norm(Ld)
    for m in meshes:
        vol, o, st = m["vol"], m["origin"], m["step"]
        lo = o
        hi = o + (np.array(vol.shape) - 1) * st
        corners = np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])])
        cx, cz, ct = corners @ r, corners[:, 2], corners @ f
        j0 = max(0, int(np.floor(cx.min() / px + W / 2)))
        j1 = min(W, int(np.ceil(cx.max() / px + W / 2)) + 1)
        i0 = max(0, int(np.floor(H - 8 - (cz.max() - z0) / px)))
        i1 = min(H, int(np.ceil(H - 8 - (cz.min() - z0) / px)) + 1)
        if j1 <= j0 or i1 <= i0:
            continue
        ts = np.arange(ct.min(), ct.max() + st, st * 0.7)
        js = np.arange(j0, j1)
        xs = (js - W / 2) * px
        tone = GREY.get(m["part"].group, 0.8)
        for ia in range(i0, i1, 16):
            ib = min(i1, ia + 16)
            iis = np.arange(ia, ib)
            zs = z0 + (H - 8 - iis) * px
            # (rows, cols, samples, 3)
            P = r * xs[None, :, None, None] + u * zs[:, None, None, None] + f * ts[None, None, :, None]
            idx = np.round((P - o) / st).astype(np.int32)
            ok = np.all((idx >= 0) & (idx < np.array(vol.shape)), axis=-1)
            idc = np.where(ok[..., None], idx, 0)
            ins = ok & (vol[idc[..., 0], idc[..., 1], idc[..., 2]] < 0)
            hit = ins.any(-1)
            if not hit.any():
                continue
            first = np.argmax(ins, -1)
            rr, cc = np.nonzero(hit)
            k = first[rr, cc]
            t = ts[k]
            ii, jj = iis[rr], js[cc]
            closer = t < depth[ii, jj]
            if not closer.any():
                continue
            rr, cc, k, t, ii, jj = rr[closer], cc[closer], k[closer], t[closer], ii[closer], jj[closer]
            vi = idc[rr, cc, k]
            sh = np.array(vol.shape) - 1
            g = np.zeros((len(vi), 3))
            for a in range(3):
                e = np.zeros(3, int)
                e[a] = 1
                pa = np.clip(vi + e, 0, sh)
                pb = np.clip(vi - e, 0, sh)
                g[:, a] = vol[pa[:, 0], pa[:, 1], pa[:, 2]] - vol[pb[:, 0], pb[:, 1], pb[:, 2]]
            n = g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)
            lam = np.clip(n @ Ld, 0, 1)
            fill = np.clip(n @ (-f), 0, 1)
            rim = np.clip(1 - np.abs(n @ f), 0, 1) ** 4
            c = tone * (0.3 + 0.55 * lam + 0.2 * fill) + 0.06 * rim
            depth[ii, jj] = t
            shade[ii, jj] = c
    # 輪廓線（深度跳動處）讓零件分界清楚
    dz = np.zeros_like(depth)
    fin = np.isfinite(depth)
    dpad = np.where(fin, depth, 9.0)
    for ax in (0, 1):
        dz = np.maximum(dz, np.abs(np.diff(dpad, axis=ax, prepend=dpad[:1] if ax == 0 else dpad[:, :1])))
    shade = np.where((dz > 0.02) & fin, shade * 0.55, shade)
    return np.clip(shade, 0, 1), depth


def model_silhouette(meshes, view, px, size, z0):
    """由體素投影的輪廓（精確）：front／back 沿 Y、side 沿 X"""
    W, H = size
    sil = np.zeros((H, W), bool)
    for m in meshes:
        inside = m["vol"] < 0
        o, st = m["origin"], m["step"]
        if view in ("front", "back"):
            proj = inside.any(axis=1)  # (x, z)
            ax0 = o[0] + np.arange(proj.shape[0]) * st
        else:
            proj = inside.any(axis=0)  # (y, z)
            ax0 = o[1] + np.arange(proj.shape[0]) * st
        az = o[2] + np.arange(proj.shape[1]) * st
        # 每個影像像素中心 → 體素索引
        X = (np.arange(W) - W / 2) * px
        if view == "back":
            X = -X
        Z = z0 + (H - 8 - np.arange(H)) * px
        ii = np.round((X - ax0[0]) / st).astype(int)
        kk = np.round((Z - az[0]) / st).astype(int)
        okx = (ii >= 0) & (ii < proj.shape[0])
        okz = (kk >= 0) & (kk < proj.shape[1])
        sub = np.zeros((H, W), bool)
        sub[np.ix_(okz, okx)] = proj[np.ix_(ii[okx], kk[okz])].T
        sil |= sub
    return sil


def sheet_silhouette(gender, view, px, size, z0, shift_px=0):
    """設定圖輪廓換到同一張影像座標（腳底對齊 z = 0；正面以中心線、側面以給定參考對齊）"""
    W, H = size
    sil = np.load(Path(SIL_DIR) / f"sil_{gender}_{view}.npy")
    x0, y0, _, _ = M.PANELS[gender][view]
    F = M.LANDMARKS[gender]["front"]
    Sd = M.LANDMARKS[gender]["side"]
    sole = F["sole"] if view != "side" else Sd["sole"]
    cx = F["center_x"] if view == "front" else (NS.BACK_CENTER[gender] if view == "back" else NS.SIDE_CENTER[gender])
    out = np.zeros((H, W), bool)
    scale = M.proportions()["px_to_m"] / px
    ys, xs = np.nonzero(sil)
    X = np.floor((xs + x0 - cx + shift_px) * scale + W / 2).astype(int)
    Y = np.round(H - 8 - ((sole - (ys + y0)) * M.proportions()["px_to_m"] - z0) / px).astype(int)
    ok = (X >= 0) & (X < W) & (Y >= 0) & (Y < H)
    out[Y[ok], X[ok]] = True
    return out


def iou(a, b):
    return float((a & b).sum()) / max(1, float((a | b).sum()))


def sheet_crop(path, gender, view, px, size, z0, shift_px=0):
    """設定圖的該視角，縮放到與預覽相同比例（並排比較用）"""
    W, H = size
    img = Image.open(path).convert("RGB")
    x0, y0, x1, y1 = M.PANELS[gender][view]
    F = M.LANDMARKS[gender]["front"]
    Sd = M.LANDMARKS[gender]["side"]
    sole = F["sole"] if view != "side" else Sd["sole"]
    cx = F["center_x"] if view == "front" else (NS.BACK_CENTER[gender] if view == "back" else NS.SIDE_CENTER[gender])
    s = M.proportions()["px_to_m"] / px
    # 影像中心 x = cx - shift；腳底在 H-8
    left = cx - shift_px - (W / 2) / s
    top = sole - (H - 8 + z0 / px) / s
    box = (left, top, left + W / s, top + H / s)
    return img.transform((W, H), Image.EXTENT, box, Image.BICUBIC)


def main(male_sheet, female_sheet, out, which="both"):
    global SIL_DIR
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    SIL_DIR = str(out / "sil")
    M.main(male_sheet, female_sheet, SIL_DIR)
    px = M.proportions()["px_to_m"]
    size = (440, 640)
    z0 = -0.02
    font = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 18)
    report = {}
    for gender, sheet in (("male", male_sheet), ("female", female_sheet)):
        if which not in ("both", gender):
            continue
        print(gender)
        meshes = build(NS.build(gender))
        rep = {}
        tiles = []
        for view in ("front", "side", "back", "left45"):
            shade, _ = render(meshes, view, px, size, z0)
            img = Image.fromarray((shade * 255).astype(np.uint8)).convert("RGB")
            if view == "left45":
                tiles.append((None, img, view))
                continue
            ms = model_silhouette(meshes, view, px, size, z0)
            best = (-1, 0)
            # 側面 ±12 像素、正背面 ±8 像素（設定圖中心線是人工估計，允許小幅水平對齊）
            for sh in range(-12, 13) if view == "side" else range(-8, 9):
                ss = sheet_silhouette(gender, view, px, size, z0, sh)
                v = iou(ms, ss)
                if v > best[0]:
                    best = (v, sh)
            ss = sheet_silhouette(gender, view, px, size, z0, best[1])
            rep[view] = {"iou": round(best[0], 4), "shift_px": best[1]}
            ref = sheet_crop(sheet, gender, view, px, size, z0, best[1])
            # 疊圖：模型輪廓（藍）＋設定圖輪廓（紅）
            ov = np.asarray(ref).copy()
            e1 = ms & ~(np.roll(ms, 1, 0) & np.roll(ms, -1, 0) & np.roll(ms, 1, 1) & np.roll(ms, -1, 1))
            e2 = ss & ~(np.roll(ss, 1, 0) & np.roll(ss, -1, 0) & np.roll(ss, 1, 1) & np.roll(ss, -1, 1))
            ov[e2] = (230, 30, 120)
            ov[e1] = (20, 90, 240)
            tiles.append((ref, img, view, Image.fromarray(ov)))
        report[gender] = rep
        # 合成：每個視角 設定圖｜灰模｜疊圖
        W, H = size
        cols = []
        for t in tiles:
            if t[0] is None:
                cols.append([t[1]])
            else:
                cols.append([t[0], t[1], t[3]])
        sheet_img = Image.new("RGB", (W * 3 * 3 + W, H + 40), (255, 255, 255))
        d = ImageDraw.Draw(sheet_img)
        x = 0
        names = {"front": "正面", "side": "側面", "back": "背面", "left45": "45 度"}
        for t, col in zip(tiles, cols):
            for k, im in enumerate(col):
                sheet_img.paste(im, (x, 40))
                lab = ["設定圖", "灰模", "疊圖 藍=灰模 紅=設定圖"][k] if len(col) == 3 else "灰模"
                d.text((x + 6, 8), f"{names[t[2]]} {lab}" + (f" IoU {rep[t[2]]['iou']*100:.1f}%" if k == 2 else ""), fill=(30, 30, 60), font=font)
                x += W
        sheet_img.save(out / f"compare_{gender}.png")
        grey = Image.new("RGB", (W * 4, H), (247, 247, 247))
        order = ["front", "side", "back", "left45"]
        for i, v in enumerate(order):
            t = [tt for tt in tiles if tt[2] == v][0]
            grey.paste(t[1], (i * W, 0))
        grey.save(out / f"grey_{gender}.png")
        print(gender, json.dumps(rep))
    (out / "iou.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:5])
