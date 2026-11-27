import numpy as np, io
from PIL import Image

def tex_array(img_bytes, size=1024):
    im = Image.open(io.BytesIO(img_bytes)).convert('RGB')
    if size and im.size[0] != size: im = im.resize((size, size), Image.BILINEAR)
    return np.asarray(im).astype(np.float32) / 255.0

def render(pos, idx, uv, tex, view='front', W=420, H=600, nrm=None, light=(0.4, 0.6, 0.7), bg=(0.93, 0.93, 0.9), pad=0.04, fit=None):
    """Orthographic. Model space: Y up. view: rotation about Y (front = looking from +Z toward -Z)."""
    ang = {'front': 0, 'right': 90, 'back': 180, 'left': 270, 'q45': 45, 'q315': 315}.get(view, view)
    a = np.radians(ang)
    R = np.array([[np.cos(a), 0, -np.sin(a)], [0, 1, 0], [np.sin(a), 0, np.cos(a)]])
    p = pos @ R.T
    if fit is None:
        lo = pos.min(0); hi = pos.max(0); c = (lo + hi) / 2; r = np.linalg.norm(hi - lo) / 2
        fit = (c @ R.T, r)
    c, r = fit
    s = min(W, H) / (2 * r * (1 + pad)) if False else H / ((pos[:, 1].max() - pos[:, 1].min()) * (1 + 2 * pad))
    sx = W / 2 + (p[:, 0] - c[0]) * s
    sy = H / 2 - (p[:, 1] - c[1]) * s
    z = p[:, 2]
    img = np.ones((H, W, 3), np.float32) * np.array(bg, np.float32)
    zb = np.full((H, W), -1e9, np.float32)
    th, tw = tex.shape[:2]
    L = np.array(light); L = L / np.linalg.norm(L)
    if nrm is not None:
        n = nrm @ R.T
    for t in idx:
        x0, x1, x2 = sx[t]; y0, y1, y2 = sy[t]
        xmin = max(int(np.floor(min(x0, x1, x2))), 0); xmax = min(int(np.ceil(max(x0, x1, x2))), W - 1)
        ymin = max(int(np.floor(min(y0, y1, y2))), 0); ymax = min(int(np.ceil(max(y0, y1, y2))), H - 1)
        if xmin > xmax or ymin > ymax: continue
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(den) < 1e-9: continue
        X, Y = np.meshgrid(np.arange(xmin, xmax + 1) + 0.5, np.arange(ymin, ymax + 1) + 0.5)
        w0 = ((y1 - y2) * (X - x2) + (x2 - x1) * (Y - y2)) / den
        w1 = ((y2 - y0) * (X - x2) + (x0 - x2) * (Y - y2)) / den
        w2 = 1 - w0 - w1
        m = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
        if not m.any(): continue
        zz = w0 * z[t[0]] + w1 * z[t[1]] + w2 * z[t[2]]
        sub = zb[ymin:ymax + 1, xmin:xmax + 1]
        m &= zz > sub
        if not m.any(): continue
        u = w0 * uv[t[0], 0] + w1 * uv[t[1], 0] + w2 * uv[t[2], 0]
        v = w0 * uv[t[0], 1] + w1 * uv[t[1], 1] + w2 * uv[t[2], 1]
        col = tex[np.clip((v * th).astype(int), 0, th - 1), np.clip((u * tw).astype(int), 0, tw - 1)]
        if nrm is not None:
            nn = w0[..., None] * n[t[0]] + w1[..., None] * n[t[1]] + w2[..., None] * n[t[2]]
            nn /= np.linalg.norm(nn, axis=-1, keepdims=True) + 1e-9
            sh = 0.55 + 0.45 * np.clip(nn @ L, 0, 1)
            col = col * sh[..., None]
        sub[m] = zz[m]
        img[ymin:ymax + 1, xmin:xmax + 1][m] = col[m]
    return (np.clip(img, 0, 1) * 255).astype(np.uint8), s
