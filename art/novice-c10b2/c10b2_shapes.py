"""
初心者 V2 — C1.0-B2：男初心者背後披風（tabard）金色四芒星徽記縮小到與女初心者紫色外裙徽記相同的視覺尺寸。
C1.0-B、C1.0-B1 檔案不改。

C1.0-B1 的問題（量測）：徽記沿「披風表面法線」投影，但 A 字披風往下越來越外張、比 25° 斜，
  從背後看星形被拉長：寬 11.0 cm、高 17.0 cm；女生徽記寬 8.25 cm、高 8.1 cm。
C1.0-B2：
  - 星形輪廓改在「從背後看的平面」（x、z）定義 → 從背後看就是正確比例的四芒星，不再上下拉長。
  - 外半徑 0.0415、內半徑 0.0175（含 0.8 mm 外擴後 = 女生的 0.04＋圓角 2 mm、0.016＋2 mm），
    中心 x=0、z=0.33（與女生徽記同高，位於披風背面中央）。
  - 仍是「貼著披風表面」的 0～6 mm 金色薄層（往內 1.5 mm），跟著皺褶起伏，不會被披風遮住。
其他零件、披風、滾邊、女生模型完全不變。
"""
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "novice-c10b1"))
sys.path.insert(0, str(HERE.parent / "novice-c10b"))
for d in ("novice-c04", "novice-c03", "novice-c02", "novice-c01", "novice-v2"):
    sys.path.insert(0, str(HERE.parent / d))
import c10b_shapes as B  # noqa: E402
import c10b1_shapes as B1  # noqa: E402
from sdf import Part, Prim  # noqa: E402

STAR_X, STAR_Z = 0.0, 0.33
STAR_R, STAR_r, STAR_N = 0.0415, 0.0175, 4
LAYER, SINK = B1.LAYER, B1.SINK
GROW = 0.0008  # 與 C1.0-B1 相同的外擴（星形輪廓 ×0.8 的距離 → 實際外擴 1 mm）


def star2d(px, py):
    """與 novice_shapes.star_prim 相同的四芒星輪廓（第一個尖角朝上），半徑改為 C1.0-B2"""
    an = math.pi / STAR_N
    ang = np.arctan2(px, py)
    rad = np.sqrt(px * px + py * py)
    a = np.mod(ang + an, 2 * an) - an
    t = np.abs(a) / an
    edge = STAR_R * (1 - t) + STAR_r * t
    return (rad - edge) * 0.8


def conform_star(parts):
    tab = next(p for p in parts if p.name == "tabard")
    old = next(p for p in parts if p.name == "tabard_star")
    f, _u, _s = B1._frame()
    c = np.array([STAR_X, B1.STAR_C[1], STAR_Z])

    def fn(P):
        d2 = star2d(P[..., 0] - STAR_X, P[..., 2] - STAR_Z)   # 從背後（+y）看的平面
        dt = B1._eval(tab, P)
        shell = np.maximum(dt - LAYER, -dt - SINK)
        side = -((P - c) @ f) - 0.09                           # 只取背面這一片
        outer = (dt - B1._eval(tab, P + f * 0.004)) * 4.0      # 只留披風外側表面
        return np.maximum(np.maximum(np.maximum(d2, shell), side), outer) - GROW

    m = STAR_R + 0.03
    lo = (STAR_X - m, B1.STAR_C[1] - 0.09, STAR_Z - m)
    hi = (STAR_X + m, B1.STAR_C[1] + 0.09, STAR_Z + m)
    star = Part("tabard_star", old.group if hasattr(old, "group") else "metal", step=0.0012)
    star.add(Prim(fn, lo, hi))
    return [star if p is old else p for p in parts]


def build(g):
    parts = B.build(g)
    return conform_star(parts) if g == "male" else parts
