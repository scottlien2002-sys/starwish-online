"""星芽村 P3 共用材質貼圖產生器（numpy＋Pillow，免費、可重現）。

每種材質一張「可無縫重複」的細節貼圖（中性偏亮，色相由頂點色決定），HQ 1024²、Lite 512²。
石材、廣場石板、屋瓦另外輸出法線貼圖（只有 HQ 使用）。

用法：python3 gen_textures.py <輸出資料夾>
"""

import json
import os
import sys

import numpy as np
from PIL import Image

RNG = np.random.default_rng(20261123)


def tile_noise(n, scale, octaves=4):
    """可無縫重複的值雜訊（在週期格點上內插）"""
    out = np.zeros((n, n))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        g = max(2, int(scale * (2 ** o)))
        grid = RNG.random((g, g))
        xs = np.linspace(0, g, n, endpoint=False)
        i0 = np.floor(xs).astype(int)
        f = xs - i0
        f = f * f * (3 - 2 * f)
        i1 = (i0 + 1) % g
        a = grid[np.ix_(i0, i0)]
        b = grid[np.ix_(i0, i1)]
        c = grid[np.ix_(i1, i0)]
        d = grid[np.ix_(i1, i1)]
        fx = f[None, :]
        fy = f[:, None]
        out += amp * ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy)
        total += amp
        amp *= 0.5
    return out / total


def blocks(n, rows, cols_per_row, mortar=0.035, stagger=True):
    """磚塊／石板：回傳 (高度, 每塊亂數亮度)"""
    y = (np.arange(n) + 0.5) / n
    x = (np.arange(n) + 0.5) / n
    Y, X = np.meshgrid(y, x, indexing="ij")
    r = np.floor(Y * rows).astype(int)
    off = np.where((r % 2 == 1) & stagger, 0.5 / cols_per_row, 0.0)
    xx = (X + off) % 1.0
    c = np.floor(xx * cols_per_row).astype(int)
    fy = Y * rows - r
    fx = xx * cols_per_row - c
    edge = np.minimum.reduce([fy, 1 - fy, fx * rows / cols_per_row * 1.0, (1 - fx) * rows / cols_per_row * 1.0])
    h = np.clip(edge / mortar, 0, 1)
    h = h * h * (3 - 2 * h)
    ids = (r * 131 + c * 17) % 997
    tone = (np.sin(ids * 12.9898) * 43758.5453) % 1.0
    return h, tone


def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    nz = np.ones_like(h)
    l = np.sqrt(dx * dx + dy * dy + nz * nz)
    nrm = np.stack([-dx / l, dy / l, nz / l], -1)
    return ((nrm * 0.5 + 0.5) * 255).astype(np.uint8)


def to_img(rgb):
    return Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), "RGB")


def make(n):
    tex, nrm = {}, {}
    nz = tile_noise(n, 6)
    fine = tile_noise(n, 24, 3)
    # 白色石材：錯縫石塊、淡淡的暖灰、每塊亮度略有不同
    h, tone = blocks(n, 6, 3)
    base = 0.86 + (tone - 0.5) * 0.08 + (nz - 0.5) * 0.08 + (fine - 0.5) * 0.05
    mortar = 1 - (1 - h) * 0.32
    v = base * mortar
    tex["stone"] = to_img(np.stack([v * 1.0, v * 0.985, v * 0.955], -1))
    nrm["stone"] = normal_from_height(h * 0.6 + nz * 0.25 + fine * 0.15, 6.0)
    # 廣場石板：較大的方形石板、米色
    h2, tone2 = blocks(n, 4, 4, mortar=0.025, stagger=False)
    v2 = (0.84 + (tone2 - 0.5) * 0.1 + (nz - 0.5) * 0.06 + (fine - 0.5) * 0.04) * (1 - (1 - h2) * 0.28)
    tex["paving"] = to_img(np.stack([v2 * 1.0, v2 * 0.96, v2 * 0.9], -1))
    nrm["paving"] = normal_from_height(h2 * 0.6 + fine * 0.2, 5.0)
    # 屋瓦：魚鱗瓦（中性亮色，顏色由頂點色決定）
    yy, xx = np.meshgrid((np.arange(n) + 0.5) / n, (np.arange(n) + 0.5) / n, indexing="ij")
    rows = 8
    r = np.floor(yy * rows)
    off = np.where(r % 2 == 1, 0.5, 0.0) / 8
    cx = ((xx + off) * 8) % 1.0 - 0.5
    cy = (yy * rows) % 1.0
    scale = np.clip(1 - np.sqrt(cx * cx * 1.6 + (cy - 0.15) ** 2 * 1.0), 0, 1)
    shade = 0.7 + 0.3 * np.clip(scale * 1.6, 0, 1) - (1 - cy) * 0.12
    vr = shade * (0.92 + (fine - 0.5) * 0.08)
    tex["roof"] = to_img(np.stack([vr, vr, vr], -1))
    nrm["roof"] = normal_from_height(np.clip(scale * 1.6, 0, 1) + cy * 0.4, 5.0)
    # 溫暖木紋：木板＋年輪紋
    plank = np.floor(xx * 5)
    grain = np.sin((yy * 18 + tile_noise(n, 3) * 3 + plank * 1.7) * np.pi * 2) * 0.5 + 0.5
    gap = np.clip(np.abs((xx * 5) % 1.0 - 0.5) * 2 / 0.06 - 15.5, 0, 1)
    vw = (0.72 + grain * 0.12 + (fine - 0.5) * 0.06) * (1 - (1 - np.clip(1 - np.abs((xx * 5) % 1.0 - 0.5) * 2 + 0.03, 0, 1)) * 0)
    seam = np.clip((np.abs((xx * 5) % 1.0 - 0.5) * 2 - 0.94) / 0.06, 0, 1)
    vw = vw * (1 - seam * 0.45) * (1 - gap * 0)
    tex["wood"] = to_img(np.stack([vw * 1.0, vw * 0.82, vw * 0.62], -1))
    # 金屬（拉絲）：中性亮，金色由頂點色＋金屬度決定
    brush = tile_noise(n, 48, 2)
    vm = 0.85 + (brush - 0.5) * 0.12 + (nz - 0.5) * 0.05
    tex["metal"] = to_img(np.stack([vm, vm, vm], -1))
    # 布料：細織紋
    weave = (np.sin(xx * n * np.pi / 2) * np.sin(yy * n * np.pi / 2)) * 0.03
    vc = 0.9 + weave + (fine - 0.5) * 0.05
    tex["cloth"] = to_img(np.stack([vc, vc, vc], -1))
    # 水：淡藍波紋（UV 捲動用）
    rip = tile_noise(n, 5, 4)
    rip2 = tile_noise(n, 11, 3)
    w = 0.5 + (rip - 0.5) * 0.6 + (rip2 - 0.5) * 0.4
    tex["water"] = to_img(np.stack([0.55 + w * 0.15, 0.82 + w * 0.1, 0.95 + w * 0.05], -1))
    # P3-1B：水面法線（HQ；低強度，避免遠處閃爍）
    nrm["water"] = normal_from_height(rip * 0.7 + rip2 * 0.3, 4.0)
    return tex, nrm


def make_slab(n):
    """暖白石板細紋：低頻色斑＋細顆粒＋少量礦物斑點（接近白，由頂點色決定暖白／米色）"""
    lo = tile_noise(n, 3, 3)
    mid = tile_noise(n, 9, 3)
    fine = tile_noise(n, 48, 2)
    spk = (tile_noise(n, 64, 1) > 0.86).astype(float)
    v = 0.9 + (lo - 0.5) * 0.08 + (mid - 0.5) * 0.06 + (fine - 0.5) * 0.06 - spk * 0.025
    rgb = np.stack([v * 1.0, v * 0.985, v * 0.96], -1)
    return np.clip(rgb, 0, 1), mid * 0.6 + fine * 0.4


def make_banner(w, h):
    """藍底金邊旗：金色八芒星＋小星點＋燕尾下緣金邊（燕尾形狀由模型決定）"""
    yy, xx = np.mgrid[0:h, 0:w] / np.array([h, w])[:, None, None]
    weave = tile_noise(max(w, h), 40, 2)[:h, :w]
    base = np.stack([0.15 + weave * 0.04, 0.27 + weave * 0.05, 0.58 + weave * 0.08], -1)
    gold = np.array([0.93, 0.74, 0.32])
    border = (xx < 0.05) | (xx > 0.95) | (yy < 0.04) | ((yy > 0.83) & (yy < 0.88))
    inner = ((np.abs(xx - 0.085) < 0.01) | (np.abs(xx - 0.915) < 0.01)) & (yy > 0.04) & (yy < 0.83)
    cx, cy = xx - 0.5, (yy - 0.36) * (h / w)
    r = np.sqrt(cx * cx + cy * cy)
    th = np.arctan2(cy, cx)
    star_r = 0.17 + 0.13 * np.abs(np.cos(th * 4)) ** 6
    star = r < star_r * 0.75
    ring = np.abs(r - 0.3) < 0.012
    dots = np.zeros_like(xx, bool)
    for px, py in ((0.25, 0.66), (0.75, 0.66), (0.5, 0.74), (0.3, 0.12), (0.7, 0.12)):
        dots |= np.hypot(xx - px, (yy - py) * h / w) < 0.025
    out = base.copy()
    for m in (border, inner, star, ring, dots):
        out[m] = gold * (0.92 + 0.08 * weave[m][:, None])
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), "RGB")


def make_fx(n):
    """P3-1B 噴泉特效貼圖（RGBA，小尺寸）：落水條紋、漣漪泡沫環、星晶光暈"""
    out = {}
    yy, xx = np.mgrid[0:n, 0:n] / n
    # 落水：沿 V（影像列）不變的直向條紋＋少量 2D 破碎；上下左右可無縫重複
    s1 = tile_noise(n, 10, 3)[n // 3][None, :].repeat(n, 0)
    s2 = tile_noise(n, 4, 3)
    a = np.clip(0.42 + (s1 - 0.5) * 0.9 + (s2 - 0.5) * 0.35, 0.08, 1.0)
    rgb = np.stack([0.8 + a * 0.2, 0.9 + a * 0.1, np.ones_like(a)], -1)
    out["fall"] = np.concatenate([rgb, a[..., None]], -1)
    # 泡沫：沿 V 的同心環（V＝徑向，捲動時往外擴散），整數頻率可重複
    ns = tile_noise(n, 6, 3)
    ring = np.sin((yy * 2 + (ns - 0.5) * 0.5) * np.pi * 2) * 0.5 + 0.5
    froth = tile_noise(n, 14, 3)
    a = np.clip((ring - 0.5) * 1.5, 0, 1) ** 1.3 * np.clip(0.25 + 0.95 * froth, 0, 1) * 0.8
    out["foam"] = np.concatenate([np.ones((n, n, 3)), a[..., None]], -1)
    # 光暈：柔和高斯＋極淡 8 道星芒，邊緣歸零
    cx = xx - 0.5 + 0.5 / n
    cy = yy - 0.5 + 0.5 / n
    r = np.sqrt(cx * cx + cy * cy)
    th = np.arctan2(cy, cx)
    a = 0.75 * np.exp(-(r / 0.16) ** 2) + 0.3 * np.exp(-(r / 0.3) ** 2) * (0.8 + 0.2 * np.cos(4 * th) ** 6)
    a *= np.clip((0.5 - r) / 0.12, 0, 1)
    out["halo"] = np.concatenate([np.ones((n, n, 3)), np.clip(a, 0, 1)[..., None]], -1)
    return {k: Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8), "RGBA") for k, v in out.items()}


# ---------------- P3-2D 精修貼圖（獨立亂數，不影響既有貼圖） ----------------
R2 = np.random.default_rng(20261123 + 24)


def noise2(n, scale, octaves=3):
    """與 tile_noise 相同的可重複雜訊，但用獨立亂數"""
    out = np.zeros((n, n))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        g = max(2, int(scale * (2 ** o)))
        grid = R2.random((g, g))
        xs = np.linspace(0, g, n, endpoint=False)
        i0 = np.floor(xs).astype(int)
        f = xs - i0
        f = f * f * (3 - 2 * f)
        i1 = (i0 + 1) % g
        a, b, c, d = grid[np.ix_(i0, i0)], grid[np.ix_(i0, i1)], grid[np.ix_(i1, i0)], grid[np.ix_(i1, i1)]
        fx, fy = f[None, :], f[:, None]
        out += amp * ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy)
        total += amp
        amp *= 0.5
    return out / total


def make_pool(n):
    """池底馬賽克（可重複）：小方磚＋淺灰縫，淡水色、偶有較深的青綠磚；顏色再由頂點色調成淺藍→青綠深淺"""
    tiles = 24
    yy, xx = np.mgrid[0:n, 0:n] / n
    gx, gy = (xx * tiles) % 1.0, (yy * tiles) % 1.0
    ix, iy = np.floor(xx * tiles).astype(int), np.floor(yy * tiles).astype(int)
    rnd = R2.random((tiles, tiles))[iy, ix]
    edge = np.minimum(np.minimum(gx, 1 - gx), np.minimum(gy, 1 - gy))
    grout = np.clip((0.07 - edge) / 0.03, 0, 1)
    fine = noise2(n, 24, 2)
    soft = noise2(n, 3, 2)
    base = 0.92 + (rnd - 0.5) * 0.05 + (fine - 0.5) * 0.04 + (soft - 0.5) * 0.08
    deep = (rnd > 0.9).astype(float)
    r = base * (1 - deep * 0.1)
    g = base * (1 - deep * 0.03)
    b = base
    rgb = np.stack([r, g, b], -1) * (1 - grout[..., None] * 0.07)
    return np.clip(rgb, 0, 1)


def make_caustic(n):
    """水底光紋（可重複）：兩層雜訊差值形成細亮網紋"""
    a = noise2(n, 4, 3)
    b = noise2(n, 4, 3)
    c = np.clip(1 - np.abs(a - b) * 9, 0, 1) ** 3
    a2 = noise2(n, 7, 2)
    b2 = noise2(n, 7, 2)
    c2 = np.clip(1 - np.abs(a2 - b2) * 9, 0, 1) ** 3
    v = np.clip(c * 0.8 + c2 * 0.5, 0, 1)
    return np.stack([v * 0.9, v, v], -1)


def make_ashlar(n, rows=4):
    """城牆砌石（可重複）：大小不一的錯縫石塊、倒角邊、每塊暖白／奶油色差、淺色灰縫、細微風化"""
    h = np.zeros((n, n))
    tone = np.zeros((n, n))
    rh = n // rows
    mortar = max(2, n // 256)
    bevel = max(3, n // 90)
    yy, xx = np.mgrid[0:n, 0:n]
    for r in range(rows):
        lens, x = [], 0.0
        while x < 1.0 - 1e-6:
            L = min(1.0 - x, R2.uniform(0.24, 0.46))
            if 1.0 - x - L < 0.16:
                L = 1.0 - x
            lens.append(L)
            x += L
        off = R2.random()
        x = 0.0
        for L in lens:
            x0 = int(((x + off) % 1.0) * n)
            w = int(L * n)
            cols = (np.arange(x0, x0 + w) % n)
            t = R2.uniform(-0.5, 0.5)
            for k, c in enumerate(cols):
                dx = min(k, w - 1 - k)
                for yv in range(rh):
                    dy = min(yv, rh - 1 - yv)
                    d = min(dx, dy) - mortar
                    if d < 0:
                        continue
                    hv = min(1.0, (d + 1) / bevel)
                    h[r * rh + yv, c] = hv
                    tone[r * rh + yv, c] = t
            x += L
    fine = noise2(n, 32, 3)
    chips = (noise2(n, 48, 1) > 0.8).astype(float)
    hh = h * (0.92 + (fine - 0.5) * 0.12) - chips * 0.06 * h
    v = np.where(h > 0, 0.9 + tone * 0.08 + (fine - 0.5) * 0.06, 0.8)
    v = v * (0.9 + 0.1 * np.clip(h * 3, 0, 1))
    rgb = np.stack([v * 1.0, v * 0.975, v * 0.935], -1)
    return np.clip(rgb, 0, 1), hh


def make_slate(n, rows=10):
    """魚鱗瓦（可重複）：錯排圓弧瓦片，上方瓦片在下方投下淡影；灰階，由頂點色染深藍"""
    yy, xx = np.mgrid[0:n, 0:n] / n
    r = np.floor(yy * rows)
    cols = 8
    off = np.where(r % 2 == 1, 0.5, 0.0) / cols
    cx = ((xx + off) * cols) % 1.0 - 0.5
    cy = (yy * rows) % 1.0
    d = np.sqrt((cx * 1.25) ** 2 + (cy - 0.05) ** 2)
    scale = np.clip(1 - d / 0.62, 0, 1)
    edge = np.clip((0.62 - d) / 0.06, 0, 1)
    height = scale ** 0.6 * 0.8 + cy * 0.2
    fine = noise2(n, 20, 2)
    v = (0.62 + 0.3 * scale ** 0.5 + (fine - 0.5) * 0.06) * (0.75 + 0.25 * edge)
    v = v * (0.88 + 0.12 * (1 - cy))
    return np.clip(np.stack([v, v, v], -1), 0, 1), height


def make_banner2(w, h):
    """騎士旗／廣場旗精修：粗織紋、直向布褶明暗、刺繡金邊（針腳點）、金色徽章有描邊"""
    yy, xx = np.mgrid[0:h, 0:w] / np.array([h, w])[:, None, None]
    weave = noise2(max(w, h), 64, 1)[:h, :w] * 0.5 + noise2(max(w, h), 16, 2)[:h, :w] * 0.5
    fold = 0.9 + 0.1 * np.sin(xx * np.pi * 6 + 0.6)
    base = np.stack([0.14 + weave * 0.05, 0.25 + weave * 0.06, 0.56 + weave * 0.08], -1) * fold[..., None]
    gold = np.array([0.95, 0.76, 0.34])
    gold_d = np.array([0.72, 0.52, 0.18])
    border = (xx < 0.05) | (xx > 0.95) | (yy < 0.04) | ((yy > 0.83) & (yy < 0.88))
    stitch = (((xx > 0.07) & (xx < 0.095)) | ((xx > 0.905) & (xx < 0.93))) & ((yy * h).astype(int) % 10 < 5) & (yy > 0.05) & (yy < 0.82)
    cx, cy = xx - 0.5, (yy - 0.36) * (h / w)
    r = np.sqrt(cx * cx + cy * cy)
    th = np.arctan2(cy, cx)
    star_r = (0.17 + 0.13 * np.abs(np.cos(th * 4)) ** 6) * 0.75
    star = r < star_r
    star_edge = (r < star_r + 0.02) & ~star
    ring = np.abs(r - 0.3) < 0.013
    ring_edge = (np.abs(r - 0.3) < 0.022) & ~ring
    out = base.copy()
    for m in (border, stitch, star, ring):
        out[m] = gold * (0.9 + 0.1 * weave[m][:, None])
    for m in (star_edge, ring_edge):
        out[m] = gold_d
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), "RGB")


def make_p32d(out, info):
    def save(img, name):
        p = os.path.join(out, f"{name}.png")
        img.save(p, optimize=True)
        info[name] = {"px": list(img.size), "bytes": os.path.getsize(p)}

    for lod, n in (("hq", 512), ("lite", 256)):
        save(to_img(make_pool(n)), f"pool_{lod}")
    for lod, n in (("hq", 256), ("lite", 128)):
        save(to_img(make_caustic(n)), f"caustic_{lod}")
    save(Image.open(os.path.join(out, "water_nrm_hq.png")).resize((512, 512), Image.LANCZOS), "water_nrm_512")
    rgb, hgt = make_ashlar(1024)
    save(to_img(rgb), "ashlar_hq")
    save(Image.fromarray(normal_from_height(hgt, 5.0), "RGB").resize((512, 512), Image.LANCZOS), "ashlar_nrm_512")
    save(to_img(rgb).resize((512, 512), Image.LANCZOS), "ashlar_lite")
    rgb, hgt = make_slate(512)
    save(to_img(rgb), "slate_hq")
    save(Image.fromarray(normal_from_height(hgt, 4.0), "RGB"), "slate_nrm_512")
    save(to_img(rgb).resize((256, 256), Image.LANCZOS), "slate_lite")
    save(make_banner2(256, 512), "banner2_hq")


# ---------------- P3-2E 星願之泉魔法化（獨立亂數，放在最後產生） ----------------
R3 = np.random.default_rng(20261123 + 25)


def _sparkle(n):
    """星光（4 長 4 短光芒＋柔和光心），alpha 通道"""
    yy, xx = np.mgrid[0:n, 0:n] / n - 0.5 + 0.5 / n
    r = np.sqrt(xx * xx + yy * yy)
    th = np.arctan2(yy, xx)
    core = np.exp(-(r / 0.07) ** 2)
    glow = 0.35 * np.exp(-(r / 0.2) ** 2)
    long_ = np.abs(np.cos(th * 2)) ** 60 * np.clip(1 - r / 0.48, 0, 1) ** 1.5
    short = 0.5 * np.abs(np.cos(th * 2 + np.pi / 2)) ** 60 * np.clip(1 - r / 0.28, 0, 1) ** 1.5
    return np.clip(core + glow + long_ + short, 0, 1) * np.clip((0.5 - r) / 0.04, 0, 1)


def _sigil(n):
    """魔法陣：三道細環、八芒星連線 {8/3}、外環小圓點、內圈淡光；與出生羅盤同一圖騰"""
    yy, xx = np.mgrid[0:n, 0:n] / n - 0.5 + 0.5 / n
    r = np.sqrt(xx * xx + yy * yy)
    th = np.arctan2(yy, xx)
    a = np.zeros((n, n))
    w = 1.6 / n
    for rr, k in ((0.45, 1.0), (0.41, 0.7), (0.2, 0.8)):
        a = np.maximum(a, k * np.clip(1 - np.abs(r - rr) / w, 0, 1))
    R = 0.41
    pts = [(R * np.cos(i * np.pi / 4), R * np.sin(i * np.pi / 4)) for i in range(8)]
    for i in range(8):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 3) % 8]
        dx, dy = x1 - x0, y1 - y0
        L2 = dx * dx + dy * dy
        t = np.clip(((xx - x0) * dx + (yy - y0) * dy) / L2, 0, 1)
        d = np.sqrt((xx - x0 - t * dx) ** 2 + (yy - y0 - t * dy) ** 2)
        a = np.maximum(a, 0.8 * np.clip(1 - d / w, 0, 1))
    for i in range(16):
        ang = i * np.pi / 8 + np.pi / 16
        d = np.sqrt((xx - 0.43 * np.cos(ang)) ** 2 + (yy - 0.43 * np.sin(ang)) ** 2)
        a = np.maximum(a, np.clip(1 - d / (3.2 / n), 0, 1))
    a = np.maximum(a, 0.18 * np.exp(-(r / 0.18) ** 2))
    return np.clip(a, 0, 1) * (r < 0.47)


def make_p32e(out, info):
    def save(img, name):
        p = os.path.join(out, f"{name}.png")
        img.save(p, optimize=True)
        info[name] = {"px": list(img.size), "bytes": os.path.getsize(p)}

    # 特效圖集（左＝星光、右＝魔法陣）：白色＋alpha（加法混合，顏色由材質決定）
    for lod, n in (("hq", 128), ("lite", 64)):
        atlas = np.zeros((n, n * 2, 4))
        atlas[..., :3] = 1.0
        atlas[:, :n, 3] = _sparkle(n)
        atlas[:, n:, 3] = _sigil(n)
        save(Image.fromarray((np.clip(atlas, 0, 1) * 255).astype(np.uint8), "RGBA"), f"fx_magic_{lod}")
    # 水底光紋＋細緻星光（星點稀疏、只比光紋略亮）
    for lod, n in (("hq", 256), ("lite", 128)):
        base = np.asarray(Image.open(os.path.join(out, f"caustic_{lod}.png")).convert("RGB"), dtype=float) / 255
        star = np.zeros((n, n))
        s = max(5, n // 24)
        spr = _sparkle(s * 2 + 1)
        for _ in range(10 if lod == "hq" else 6):
            cx, cy = R3.integers(0, n, 2)
            for dy in range(-s, s + 1):
                for dx in range(-s, s + 1):
                    star[(cy + dy) % n, (cx + dx) % n] = max(star[(cy + dy) % n, (cx + dx) % n], spr[dy + s, dx + s])
        v = np.clip(base + star[..., None] * np.array([0.85, 0.95, 1.0]), 0, 1)
        save(Image.fromarray((v * 255).astype(np.uint8), "RGB"), f"caustic_star_{lod}")


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "out/textures"
    os.makedirs(out, exist_ok=True)
    info = {}
    for lod, n in (("hq", 1024), ("lite", 512)):
        tex, nrm = make(n)
        for k, im in tex.items():
            p = os.path.join(out, f"{k}_{lod}.png")
            im.save(p, optimize=True)
            info[f"{k}_{lod}"] = {"px": n, "bytes": os.path.getsize(p)}
        if lod == "hq":
            for k, a in nrm.items():
                p = os.path.join(out, f"{k}_nrm_hq.png")
                Image.fromarray(a, "RGB").save(p, optimize=True)
                info[f"{k}_nrm_hq"] = {"px": n, "bytes": os.path.getsize(p)}
    for lod, n in (("hq", 256), ("lite", 128)):
        for k, im in make_fx(n).items():
            p = os.path.join(out, f"fx_{k}_{lod}.png")
            im.save(p, optimize=True)
            info[f"fx_{k}_{lod}"] = {"px": n, "bytes": os.path.getsize(p)}
    # P3-2A 廣場（放在噴泉特效之後產生，確保 P3-1B 貼圖逐位元不變）：石板細紋（無接縫線；石板分割由模型負責）HQ 512＋法線、Lite 256；旗幟 256×512
    for lod, n in (("hq", 512), ("lite", 256)):
        rgb, h = make_slab(n)
        p = os.path.join(out, f"slab_{lod}.png")
        to_img(rgb).save(p, optimize=True)
        info[f"slab_{lod}"] = {"px": n, "bytes": os.path.getsize(p)}
        if lod == "hq":
            p = os.path.join(out, "slab_nrm_hq.png")
            Image.fromarray(normal_from_height(h, 3.0), "RGB").save(p, optimize=True)
            info["slab_nrm_hq"] = {"px": n, "bytes": os.path.getsize(p)}
    p = os.path.join(out, "banner_hq.png")
    make_banner(256, 512).save(p, optimize=True)
    info["banner_hq"] = {"px": "256x512", "bytes": os.path.getsize(p)}
    # P3-2B 建築共用貼圖（遊戲端載入一次、各建築共用）：HQ 石牆法線 512、屋瓦 512＋法線 512；Lite 屋瓦 256
    for src, dst, n in (("stone_nrm_hq", "stone_nrm_512", 512), ("roof_hq", "roof_512", 512), ("roof_nrm_hq", "roof_nrm_512", 512), ("roof_lite", "roof_256", 256)):
        im = Image.open(os.path.join(out, f"{src}.png")).resize((n, n), Image.LANCZOS)
        p = os.path.join(out, f"{dst}.png")
        im.save(p, optimize=True)
        info[dst] = {"px": n, "bytes": os.path.getsize(p)}
    make_p32d(out, info)
    make_p32e(out, info)
    json.dump(info, open(os.path.join(out, "textures.json"), "w"), indent=1)
    print(json.dumps(info, indent=1))


if __name__ == "__main__":
    main()
