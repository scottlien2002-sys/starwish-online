"""Stage 6.6 星芽村材質升級貼圖（numpy＋Pillow，可重現；在本機或 CI 產生後放進 public/models/village-p3/tex/）。

- detail66_{hq,lite}.png：RGBA 四通道細節（R 木紋、G 金屬錘紋／刷紋、B 布紋、A 灰泥）。中性灰（平均約 0.5），
  遊戲端依頂點色自動判斷材質種類後乘上去，並由明暗變化算出細微凹凸。全部可無縫重複（每 1 m 一次）。
- grass66_{hq,lite}.png：草地（每 3 m 重複）：多層綠色雜訊＋短草葉筆觸＋少量三葉草與小白花。
用法：python3 gen_textures66.py <輸出資料夾>
"""
import os
import sys

import numpy as np
from PIL import Image

RNG = np.random.default_rng(20261126)


def tile_noise(n, scale, octaves=4, rng=RNG):
    out = np.zeros((n, n))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        g = max(2, int(scale * (2 ** o)))
        grid = rng.random((g, g))
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


def norm01(a):
    a = a - a.min()
    return a / (a.max() or 1.0)


def blur_wrap(a, r):
    """週期邊界的盒狀模糊（可無縫）"""
    if r <= 0:
        return a
    k = 2 * r + 1
    s = np.zeros_like(a)
    for d in range(-r, r + 1):
        s += np.roll(a, d, axis=0)
    a = s / k
    s = np.zeros_like(a)
    for d in range(-r, r + 1):
        s += np.roll(a, d, axis=1)
    return s / k


def wood(n):
    y, x = np.meshgrid(np.arange(n) / n, np.arange(n) / n, indexing="ij")
    warp = tile_noise(n, 3, 3) * 0.9 + tile_noise(n, 8, 2) * 0.25
    rings = np.sin((x * 9 + warp * 2.2) * np.pi * 2)  # 沿 v（y）方向的長紋
    fine = tile_noise(n, 2, 1)
    streak = np.sin((x * 64 + tile_noise(n, 6, 2) * 6) * np.pi * 2) * 0.5 + 0.5
    grain = tile_noise(n, 48, 2)
    v = 0.5 + rings * 0.08 + (streak - 0.5) * 0.12 + (grain - 0.5) * 0.18 + (fine - 0.5) * 0.12
    # 木節（少量，週期距離）
    for _ in range(3):
        cx, cy = RNG.random(2)
        dx = np.minimum(np.abs(x - cx), 1 - np.abs(x - cx))
        dy = np.minimum(np.abs(y - cy), 1 - np.abs(y - cy))
        d = np.sqrt((dx * 2.4) ** 2 + (dy * 0.9) ** 2)
        v -= np.exp(-(d / 0.035) ** 2) * 0.22
        v += np.sin(d * 140) * np.exp(-(d / 0.09) ** 2) * 0.05
    return np.clip(v, 0, 1)


def metal(n):
    dents = tile_noise(n, 10, 2)
    dents = blur_wrap(dents, 2)
    hammer = np.abs(np.sin(dents * 18)) * 0.5
    brush = tile_noise(n, 2, 1) * 0.3 + blur_wrap(RNG.random((n, n)), 0) * 0.0
    lines = np.roll(blur_wrap(RNG.random((n, n)), 1), 0, axis=0)
    lines = lines.mean(axis=0, keepdims=True).repeat(n, axis=0)  # 細刷紋（沿 v）
    lines = norm01(lines)
    scratch = np.zeros((n, n))
    for _ in range(40):
        x0, y0 = RNG.integers(0, n, 2)
        ang = RNG.uniform(0, np.pi)
        L = RNG.integers(n // 20, n // 6)
        t = np.arange(L)
        xs = (x0 + t * np.cos(ang)).astype(int) % n
        ys = (y0 + t * np.sin(ang)).astype(int) % n
        scratch[ys, xs] = 1.0
    scratch = blur_wrap(scratch, 0)
    v = 0.52 + (hammer - 0.25) * 0.14 + (lines - 0.5) * 0.12 + (brush - 0.15) * 0.25 + scratch * 0.14 + (tile_noise(n, 4, 3) - 0.5) * 0.18
    return np.clip(v, 0, 1)


def cloth(n):
    y, x = np.meshgrid(np.arange(n) / n, np.arange(n) / n, indexing="ij")
    f = 96 if n >= 1024 else 48
    wa = np.sin(x * f * np.pi * 2) * 0.5 + 0.5
    wb = np.sin(y * f * np.pi * 2) * 0.5 + 0.5
    check = (np.floor(x * f) + np.floor(y * f)) % 2
    weave = np.where(check > 0, wa, wb)
    fuzz = tile_noise(n, 64, 2)
    blot = tile_noise(n, 3, 3)
    v = 0.5 + (weave - 0.5) * 0.22 + (fuzz - 0.5) * 0.14 + (blot - 0.5) * 0.16
    return np.clip(v, 0, 1)


def plaster(n):
    blot = tile_noise(n, 3, 4)
    grain = tile_noise(n, 96, 2)
    trowel = blur_wrap(tile_noise(n, 12, 2), 1)
    v = 0.62 + (blot - 0.5) * 0.22 + (grain - 0.5) * 0.12 + (np.abs(trowel - 0.5) - 0.2) * 0.2
    return np.clip(v, 0.36, 1)


def grass(n):
    """3 m 一張：顏色（sRGB）"""
    y, x = np.meshgrid(np.arange(n) / n, np.arange(n) / n, indexing="ij")
    base = np.array([0.47, 0.67, 0.31])
    dark = np.array([0.30, 0.50, 0.24])
    warm = np.array([0.62, 0.70, 0.34])
    light = np.array([0.62, 0.80, 0.42])
    m1 = tile_noise(n, 4, 4)
    m2 = tile_noise(n, 12, 3)
    img = base[None, None, :] * np.ones((n, n, 1))
    img = img * (1 - m1[..., None] * 0.0) + (dark - base)[None, None, :] * np.clip((0.45 - m1) * 2.2, 0, 1)[..., None]
    img += (warm - base)[None, None, :] * np.clip((m2 - 0.6) * 2.5, 0, 1)[..., None] * 0.6
    # 草葉筆觸：短線段，亮暗交錯
    strokes = np.zeros((n, n))
    shade = np.zeros((n, n))
    count = int(n * n / 55)
    xs0 = RNG.integers(0, n, count)
    ys0 = RNG.integers(0, n, count)
    angs = RNG.normal(-np.pi / 2, 0.55, count)
    lens = RNG.integers(max(4, n // 160), max(8, n // 60), count)
    tones = RNG.choice([1.0, -1.0], count, p=[0.55, 0.45]) * RNG.uniform(0.4, 1.0, count)
    for k in range(count):
        t = np.arange(lens[k])
        xs = (xs0[k] + t * np.cos(angs[k])).astype(int) % n
        ys = (ys0[k] + t * np.sin(angs[k])).astype(int) % n
        w = 1 - t / lens[k]
        strokes[ys, xs] = 1
        shade[ys, xs] = tones[k] * w
    shade = blur_wrap(shade, 0) * 0.6 + blur_wrap(shade, 1) * 0.4
    img += np.where(shade[..., None] > 0, (light - base)[None, None, :] * shade[..., None] * 0.9, (dark - base)[None, None, :] * (-shade[..., None]) * 0.8)
    # 三葉草小叢
    for _ in range(int(18 * (n / 1024) ** 2) + 6):
        cx, cy = RNG.random(2)
        r = RNG.uniform(0.008, 0.016)
        for a in (0, 2.09, 4.19):
            px = cx + np.cos(a) * r * 0.8
            py = cy + np.sin(a) * r * 0.8
            dx = np.minimum(np.abs(x - px), 1 - np.abs(x - px))
            dy = np.minimum(np.abs(y - py), 1 - np.abs(y - py))
            d = np.sqrt(dx * dx + dy * dy)
            leaf = np.clip(1 - d / r, 0, 1) ** 0.6
            img += leaf[..., None] * (np.array([0.40, 0.66, 0.30]) - img) * 0.75
    # 少量小白花、黃花（3 m 一張，約 20 朵）
    for _ in range(int(22 * (n / 1024) ** 0) ):
        cx, cy = RNG.random(2)
        col = np.array([0.98, 0.97, 0.92]) if RNG.random() < 0.65 else np.array([1.0, 0.86, 0.35])
        r = RNG.uniform(0.0035, 0.0055)
        dx = np.minimum(np.abs(x - cx), 1 - np.abs(x - cx))
        dy = np.minimum(np.abs(y - cy), 1 - np.abs(y - cy))
        d = np.sqrt(dx * dx + dy * dy)
        petal = np.clip(1 - d / r, 0, 1) ** 0.5
        img += petal[..., None] * (col - img)
        core = np.clip(1 - d / (r * 0.35), 0, 1)
        img += core[..., None] * (np.array([0.95, 0.72, 0.2]) - img)
    img *= (0.94 + tile_noise(n, 40, 2) * 0.12)[..., None]
    return np.clip(img, 0, 1)


def save_gray4(path, chans):
    a = np.stack([np.clip(c, 0, 1) for c in chans], axis=-1)
    Image.fromarray((a * 255 + 0.5).astype(np.uint8), "RGBA").save(path, optimize=True)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "out"
    os.makedirs(out, exist_ok=True)
    for tag, n in (("hq", 1024), ("lite", 512)):
        chans = [wood(n), metal(n), cloth(n), plaster(n)]
        save_gray4(os.path.join(out, f"detail66_{tag}.png"), chans)
        g = grass(n)
        Image.fromarray((g * 255 + 0.5).astype(np.uint8), "RGB").save(os.path.join(out, f"grass66_{tag}.png"), optimize=True)
        print(tag, [round(float(c.mean()), 3) for c in chans], round(float(g.mean()), 3))


if __name__ == "__main__":
    main()
