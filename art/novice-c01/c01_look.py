"""
C0.1 配色與材質：沿用 C0（眼睛、臉部貼圖、配色完全不變），補上新零件的顏色，並調整材質參數：
- 頭髮：粗糙度 0.45 → 0.58、鏡面 0.35 → 0.22（去掉塑膠感）；每一束頭髮略有深淺差異，髮束交界處加深（髮束陰影）
- 布料：粗糙度 0.8～0.85、鏡面 0.2，加一點 sheen（布料邊緣的柔光）
- 皮革：粗糙度 0.5、鏡面 0.4（柔和反光，不過度光滑）
- 金屬（金邊、徽章）：金屬度 0.6、粗糙度 0.32（有金屬光澤但不爆亮）
"""
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "novice-c0"))
import c0_look as C0  # noqa: E402

PALETTE = {g: dict(v) for g, v in C0.PALETTE.items()}
PALETTE["male"].update({"belt_edge": "#6e3a1e", "belt_loop": "#7a4122", "glove_band": "#e3b048",
                        "boot_sole": "#3c2a22", "boot_strap": "#6e3a1e", "boot_buckle": "#e8bc4c"})
PALETTE["female"].update({"skirt_trim": "#e3b048", "chest_trim": "#e3b048"})
C0.PALETTE.update(PALETTE)

# (金屬度, 粗糙度, 鏡面強度, sheen)
SURFACE = {
    "skin": (0.0, 0.6, 0.3, 0.0), "face": (0.0, 0.6, 0.3, 0.0),
    "hair": (0.0, 0.58, 0.22, 0.0),
    "cloth": (0.0, 0.85, 0.2, 0.25), "cloth2": (0.0, 0.8, 0.2, 0.25), "dark": (0.0, 0.85, 0.2, 0.2),
    "leather": (0.0, 0.5, 0.4, 0.0),
    "metal": (0.6, 0.32, 0.5, 0.0),
}

albedo = C0.albedo
face_texture = C0.face_texture
uv_of = C0.uv_of
part_key = C0.part_key


def strand_shading(prims, V, seed=3):
    """
    頭髮髮束陰影：對每個頂點找最近的髮束（各髮束原本的距離場），
    - 每一束有些微不同的深淺（±6%），看得出一束一束
    - 兩束交界（最近與第二近的距離差很小）處加深 → 髮束之間的柔和陰影
    回傳乘數 (n,)
    """
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
    tint = 1 + rng.uniform(-0.06, 0.06, max(len(prims), 1))
    gap = np.clip((second - best) / 0.008, 0, 1)
    edge = 0.78 + 0.22 * gap ** 0.7
    return tint[idx] * edge
