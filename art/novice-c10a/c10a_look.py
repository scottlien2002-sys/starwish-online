"""
C1.0-A 高品質日系奇幻美術升級：配色與材質（造型完全不變：男 = C0.3、女 = C0.4）。

實際修改（全部是頂點色、貼圖與材質參數；不改幾何、不改 UV 投影）：
頭髮：髮根略深、髮梢略亮（依離頭皮距離／女生髮尾高度）、髮束交界陰影加深、天使光環更柔和、每束深淺差異
臉部：新臉部貼圖（face_texture_v2：虹膜徑向漸層＋放射紋＋內環亮帶、柔和高光與淡色反射、臉頰暖色漸層、臉部明暗過渡）；
      頭部頂點色改成暖色環境光遮蔽（乘在貼圖上）
布料：極細微的低頻深淺（布料不均勻感）、下緣略深、摺痕環境光遮蔽保留
皮革：皮革紋理感的深淺變化、朝上面略亮；腰帶與靴子翻邊加上縫線（頂點色虛線）
金屬：金色往上的面較亮、朝下的面較暗（假環境反射），底色稍暖、稍深，避免過曝
"""
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter  # noqa: F401  (face_texture_v2 使用)

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "novice-c03"))
sys.path.insert(0, str(HERE.parent / "novice-c0"))
import c03_look as L3  # noqa: E402
import c0_look as C0  # noqa: E402
from c0_look import FACE_SIZE, FACE_SPEC, FACE_X0, FACE_Z0, PALETTE, hx  # noqa: E402,F401

uv_of = L3.uv_of            # C0.3 的臉部 UV（後腦只對到膚色）沿用，不改
part_key = L3.part_key
smooth = C0.smooth

exec(open(HERE / "_face.py").read())  # face_texture_v2（由 C0 臉部繪製流程延伸，五官位置大小相同）
face_texture = face_texture_v2  # noqa: F821

# (金屬度, 粗糙度, 鏡面強度, sheen)
SURFACE = {
    "skin": (0.0, 0.62, 0.28, 0.0), "face": (0.0, 0.62, 0.28, 0.0),
    "hair": (0.0, 0.6, 0.2, 0.0),
    "cloth": (0.0, 0.86, 0.16, 0.3), "cloth2": (0.0, 0.82, 0.18, 0.3), "dark": (0.0, 0.86, 0.16, 0.25),
    "leather": (0.0, 0.58, 0.32, 0.0),
    "metal": (0.72, 0.3, 0.45, 0.0),
}
METAL_BASE = hx("#d8a440")

CRANIUM = {"male": ((0, 0.03, 0.885), (0.178, 0.195, 0.185)), "female": ((0, 0.04, 0.875), (0.18, 0.195, 0.18))}

# 縫線：(零件, 高度 z, 位置說明)；皮革零件在這些高度畫一圈虛線
STITCH_ROWS = {
    "male": {"belt": (0.421, 0.449), "boot_l": (0.183, 0.133), "boot_r": (0.183, 0.133)},
    "female": {"belt": (0.495, 0.525), "boot_l": (0.19,), "boot_r": (0.19,)},
}


def noise3(P, f, seed):
    """便宜的低頻雜訊（幾個不同方向的正弦波疊加），範圍約 -1～1"""
    rng = np.random.default_rng(seed)
    acc = np.zeros(len(P))
    for _ in range(4):
        d = rng.normal(size=3)
        d /= np.linalg.norm(d)
        acc += np.sin(P @ d * f * rng.uniform(0.7, 1.4) + rng.uniform(0, 6.28))
    return acc / 2.0


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
    elif grp_leather:
        n = noise3(P, 90, 23) * 0.6 + noise3(P, 30, 5) * 0.4
        col = col * (1 + 0.045 * n)[:, None] * (0.96 + 0.06 * smooth(-0.3, 0.8, N[:, 2]))[:, None]
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
    gap = np.clip((second - best) / 0.011, 0, 1)
    edge = 0.72 + 0.28 * gap ** 0.6
    return tint[idx] * edge


def skin_vertex(ao):
    """皮膚頂點色：暖色環境光遮蔽（陰影偏暖，不發灰）"""
    warm = np.array([0.88, 0.70, 0.66])
    t = (1 - ao)[:, None] * 0.9
    return np.clip(1 - t + warm[None] * t, 0, 1)
