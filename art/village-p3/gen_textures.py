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
    json.dump(info, open(os.path.join(out, "textures.json"), "w"), indent=1)
    print(json.dumps(info, indent=1))


if __name__ == "__main__":
    main()
