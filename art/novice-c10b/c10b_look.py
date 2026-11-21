"""
C1.0-B 最終精修：材質（以 C1.0-A 為唯一基準；臉部貼圖、眼睛、UV 投影沿用 C1.0-A 不變）。
實際修改：
  頭髮：髮束交界陰影 0.72→0.68、範圍 11→13 mm（分界更清楚但仍柔和）
  白色布料（上衣、前裙、內裙）：亮度 >0.82 的部分壓暗最多 8% 並略帶暖色（修正過曝）
  皮革：皮紋深淺 ±4.5% → ±2.2%、頻率降低（修正男生靴子翻邊的直條紋）；縫線保留
  金屬：粗糙度 0.30→0.36、鏡面 0.45→0.40（裙邊金飾的火焰狀高光變柔和）
  安全短褲：#f6d2da → #efc3cf（同色系略深，和膚色分得開，褲管下緣清楚）
"""
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "novice-c10a"))
import c10a_look as A  # noqa: E402
from c10a_look import (CRANIUM, METAL_BASE, PALETTE, STITCH_ROWS, C0, face_texture, hx, noise3,  # noqa: F401,E402
                       part_key, skin_vertex, smooth, uv_of)

PALETTE["female"]["safety_shorts"] = "#efc3cf"
SURFACE = dict(A.SURFACE)
SURFACE["metal"] = (0.72, 0.36, 0.40, 0.0)


def albedo(g, name, P, N):
    pal = PALETTE[g]
    key = part_key(g, name)
    col = C0.albedo(g, name, P, N)
    grp = None
    if key in ("hair", "ponytail"):
        dark, light = hx(pal["hair_dark"]), hx(pal["hair_light"])
        c, r = CRANIUM[g]
        q = (P - np.array(c)) / np.array(r)
        e = (np.linalg.norm(q, axis=1) - 1) * min(r)          # 離頭皮的距離（近似）
        t = smooth(0.01, 0.12, e)
        if g == "female":
            t = np.maximum(t, smooth(0.86, 0.68, P[:, 2]))       # 長髮：越往下越接近髮梢
        if key == "ponytail":
            t = np.maximum(smooth(0.98, 0.72, P[:, 2]), 0.25)
        root = 1 - 0.14 * (1 - t)                                 # 髮根略深
        col = col * root[:, None]
        col = col * (1 - 0.22 * t[:, None] ** 2) + light[None] * 0.22 * t[:, None] ** 2   # 髮梢略亮
        return np.clip(col, 0, 1)
    grp_cloth = key in ("shirt", "vest", "scarf", "shorts", "tabard", "blouse", "petticoat", "skirt_pink", "underskirt",
                        "overskirt", "safety_shorts", "front_panel", "lace", "sleeve_trim" if False else "")
    grp_leather = key in ("glove", "boot", "belt", "belt_edge", "belt_loop", "pouch", "corset", "armband", "choker", "boot_strap")
    grp_metal = key in ("buckle", "rivet", "boot_gem", "sleeve_trim", "vest_trim", "tabard_trim", "tabard_star", "bow_star",
                        "overskirt_trim", "overskirt_emblem", "skirt_trim", "chest_trim", "glove_band", "boot_buckle", "boot_strap" if g == "female" else "")
    if grp_cloth:
        n = noise3(P, 45, 11)
        col = col * (1 + 0.025 * n)[:, None]
        col = col * (1 - 0.05 * smooth(0.45, 0.15, P[:, 2]) * (key not in ("overskirt", "skirt_pink")))[:, None]
        lum = col @ np.array([0.3, 0.59, 0.11])
        hot = smooth(0.82, 0.97, lum)[:, None]                   # C1.0-B：白色布料過曝 → 壓到約 0.9，略帶暖色
        col = col * (1 - 0.08 * hot) + np.array([0.0, -0.006, -0.02])[None] * hot
    elif grp_leather:
        n = noise3(P, 55, 23) * 0.5 + noise3(P, 25, 5) * 0.5
        col = col * (1 + 0.022 * n)[:, None] * (0.96 + 0.06 * smooth(-0.3, 0.8, N[:, 2]))[:, None]   # C1.0-B：皮紋減半（男靴翻邊直條紋過明顯）
        for z0 in STITCH_ROWS[g].get(name, ()):
            cx = 0 if name == "belt" else np.sign(P[:, 0]) * (0.112 if g == "male" else 0.067)
            th = np.arctan2(P[:, 0] - cx, P[:, 1] - (0 if name == "belt" else 0.02))
            rad = np.hypot(P[:, 0] - cx, P[:, 1] - (0 if name == "belt" else 0.02))
            dash = (np.mod(th * np.maximum(rad, 0.05) / 0.007, 1.0) < 0.55)
            line = np.abs(P[:, 2] - z0) < 0.0016
            m = (dash & line).astype(float)
            col = col * (1 - 0.6 * m[:, None]) + hx("#e2c49a")[None] * 0.6 * m[:, None]
    elif grp_metal:
        base = METAL_BASE if key not in ("rivet", "boot_gem") else hx(pal.get(key, "#e8b84a"))
        up = smooth(-0.6, 0.9, N[:, 2])
        col = base[None] * (0.78 + 0.3 * up)[:, None]
    return np.clip(col, 0, 1)


def strand_shading(prims, V, seed=3):
    """髮束陰影（C1.0-A）：每束深淺差異 ±7%；兩束交界處陰影加深一點、範圍略寬（更柔和的髮束分界）"""
    n = len(V)
    best = np.full(n, np.inf)
    second = np.full(n, np.inf)
    idx = np.zeros(n, int)
    for i, p in enumerate(prims):
        lo, hi = np.asarray(p.lo) - 0.02, np.asarray(p.hi) + 0.02
        m = np.all((V >= lo) & (V <= hi), axis=1)
        if not m.any():
            continue
        d = np.full(n, np.inf)
        d[m] = p.fn(V[m])
        closer = d < best
        second = np.where(closer, best, np.minimum(second, d))
        idx = np.where(closer, i, idx)
        best = np.where(closer, d, best)
    rng = np.random.default_rng(seed)
    tint = 1 + rng.uniform(-0.07, 0.07, max(len(prims), 1))
    gap = np.clip((second - best) / 0.013, 0, 1)   # C1.0-B：交界陰影略深、略寬（仍柔和）
    edge = 0.68 + 0.32 * gap ** 0.7
    return tint[idx] * edge


