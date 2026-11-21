"""本機彩色快速預覽（不是正式渲染；正式彩色圖由 Blender CI 產生）：直接讀 export_c0 的 npz 用點繪＋z-buffer"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

CAM = {"front": ((1, 0, 0), (0, 1, 0)), "side": ((0, 1, 0), (-1, 0, 0)), "back": ((-1, 0, 0), (0, -1, 0)),
       "left45": ((0.7071, 0.7071, 0), (-0.7071, 0.7071, 0))}


def render(d, info, tex, view, px, size, zc):
    W, H = size
    r, f = np.array(CAM[view][0], float), np.array(CAM[view][1], float)
    L = -f * 0.55 - r * 0.45 + np.array([0, 0, 0.7])
    L /= np.linalg.norm(L)
    zb = np.full((H, W), np.inf)
    img = np.ones((H, W, 3)) * 0.93
    for it in info["parts"]:
        k = it["key"]
        V, N, C = d[k + "__v"], d[k + "__n"], d[k + "__c"].astype(float)
        if k + "__uv" in d:
            uv = d[k + "__uv"]
            S = tex.shape[0]
            xi = np.clip((uv[:, 0] * S).astype(int), 0, S - 1)
            yi = np.clip(((1 - uv[:, 1]) * S).astype(int), 0, S - 1)
            C = C * tex[yi, xi, :3] / 255.0
        lam = np.clip(N @ L, 0, 1)
        c = C * (0.55 + 0.5 * lam)[:, None]
        x = V @ r
        y = V[:, 2]
        t = V @ f
        j = np.round(x / px + W / 2).astype(int)
        i = np.round(H / 2 - (y - zc) / px).astype(int)
        ok = (i >= 1) & (i < H - 1) & (j >= 1) & (j < W - 1) & ((N @ f) < 0.2)
        for di, dj in ((0, 0), (1, 0), (0, 1), (1, 1)):
            ii, jj, tt, cc = i[ok] + di, j[ok] + dj, t[ok], c[ok]
            order = np.argsort(-tt)
            ii, jj, tt, cc = ii[order], jj[order], tt[order], cc[order]
            closer = tt < zb[ii, jj]
            zb[ii[closer], jj[closer]] = tt[closer]
            img[ii[closer], jj[closer]] = cc[closer]
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))


if __name__ == "__main__":
    src, g, out = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    mode = sys.argv[4] if len(sys.argv) > 4 else "body"
    d = np.load(src / f"c02_{g}_parts.npz")
    info = json.loads((src / f"c02_{g}_parts.json").read_text())
    tex = np.asarray(Image.open(src / f"c02_face_{g}.png").convert("RGB"))
    if mode == "body":
        px, size, zc = 0.0021, (440, 640), 0.63
    else:
        px, size, zc = 0.0009, (720, 720), 0.9
    ims = [render(d, info, tex, v, px, size, zc) for v in ("front", "side", "back", "left45")]
    c = Image.new("RGB", (size[0] * 4, size[1]))
    for i, im in enumerate(ims):
        c.paste(im, (i * size[0], 0))
    c.save(out)
