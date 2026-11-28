"""本機快速預覽（不需要 Blender）：線性蒙皮＋PIL 填三角形（頂點貼圖顏色＋簡單打光）。只給開發時比對用。"""
import io
import numpy as np
from PIL import Image, ImageDraw
from gl import acc, q2m


def mesh_data(j, binb):
    p = j["meshes"][0]["primitives"][0]
    A = p["attributes"]
    P = acc(j, binb, A["POSITION"])
    N = acc(j, binb, A["NORMAL"])
    UV = acc(j, binb, A["TEXCOORD_0"])
    J = acc(j, binb, A["JOINTS_0"]).astype(int)
    Wt = acc(j, binb, A["WEIGHTS_0"]).astype(np.float64)
    I = acc(j, binb, p["indices"]).astype(int).reshape(-1, 3)
    # 頂點顏色：base color 貼圖
    mat = j["materials"][p["material"]]
    ti = mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    img = j["images"][j["textures"][ti]["source"]]
    bv = j["bufferViews"][img["bufferView"]]
    im = Image.open(io.BytesIO(binb[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]])).convert("RGB")
    a = np.asarray(im).astype(np.float64) / 255
    h, w = a.shape[:2]
    col = a[np.clip((UV[:, 1] % 1) * (h - 1), 0, h - 1).astype(int), np.clip((UV[:, 0] % 1) * (w - 1), 0, w - 1).astype(int)]
    return P, N, UV, J, Wt, I, col


def skin(P, N, J, Wt, joint_mats):
    """joint_mats: (nj,4,4) = world(joint) @ IBM"""
    Ph = np.c_[P, np.ones(len(P))]
    out = np.zeros_like(P)
    nout = np.zeros_like(N)
    for k in range(4):
        M = joint_mats[J[:, k]]
        out += Wt[:, k:k + 1] * np.einsum("nij,nj->ni", M, Ph)[:, :3]
        nout += Wt[:, k:k + 1] * np.einsum("nij,nj->ni", M[:, :3, :3], N)
    nout /= np.linalg.norm(nout, axis=1, keepdims=True) + 1e-9
    return out, nout


def render(V, Nv, I, col, view="front", size=360, center=None, scale=None, highlight=None):
    """glTF 座標（+Y 上、角色面向 +Z）。view: front / back / side(從角色左側) / q34"""
    dirs = {"front": np.array([0, 0, 1.0]), "back": np.array([0, 0, -1.0]), "side": np.array([1.0, 0, 0]), "rside": np.array([-1.0, 0, 0]), "q34": np.array([0.7, 0.15, 0.7])}
    d = dirs[view] / np.linalg.norm(dirs[view])
    up = np.array([0, 1.0, 0])
    right = np.cross(up, d)
    right /= np.linalg.norm(right)
    up2 = np.cross(d, right)
    if center is None:
        center = (V.min(0) + V.max(0)) / 2
    if scale is None:
        scale = (V.max(0) - V.min(0)).max() * 1.15
    X = (V - center) @ right
    Y = (V - center) @ up2
    Z = (V - center) @ d
    px = (X / scale + 0.5) * size
    py = (0.5 - Y / scale) * size
    light = np.clip(0.35 + 0.65 * np.clip(Nv @ (d * 0.7 + up2 * 0.5) / 1.0, 0, 1), 0, 1)
    c = col * light[:, None]
    if highlight is not None:
        c = c * (1 - highlight[:, None]) + np.array([1, 0.1, 0.1]) * highlight[:, None]
    img = Image.new("RGB", (size, size), (58, 58, 64))
    dr = ImageDraw.Draw(img)
    zt = Z[I].mean(1)
    fn = np.cross(V[I[:, 1]] - V[I[:, 0]], V[I[:, 2]] - V[I[:, 0]]) @ d
    for t in np.argsort(zt):
        if fn[t] <= 0:
            continue
        a, b, e = I[t]
        cc = (c[a] + c[b] + c[e]) / 3
        dr.polygon([(px[a], py[a]), (px[b], py[b]), (px[e], py[e])], fill=tuple(int(x * 255) for x in np.clip(cc, 0, 1)))
    return img


def sheet(imgs, cols=4, label=None):
    w, h = imgs[0].size
    rows = (len(imgs) + cols - 1) // cols
    S = Image.new("RGB", (w * cols, h * rows), (40, 40, 44))
    for k, im in enumerate(imgs):
        S.paste(im, ((k % cols) * w, (k // cols) * h))
    return S
