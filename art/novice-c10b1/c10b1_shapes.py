"""
初心者 V2 — C1.0-B1：男初心者背後披風（tabard）金色四芒星徽記修正。C1.0-B 檔案不改。
原因（量測）：徽記是「平面」星形，中心放在 y=0.17、朝向 (0, 1, 0.25)（略朝上）；
  披風是往下張開的 A 字曲面（越往下越往外），且有縱向皺褶 → 星形下半部埋進披風裡。
  沿徽記方向往內看，星形面積只有 61.7% 露出：下方尖角、左右尖角下緣都被披風蓋住。
修正：徽記改成「貼著披風表面」的金色薄層——
  在披風表面上方 0～6 mm 的殼層內，取同一個四芒星輪廓（中心、外半徑 0.055、內半徑 0.014、4 個尖角、第一個尖角朝上都不變）。
  投影方向改用該處披風的表面法線（往後、往下約 25°），星形在曲面上不變形。
  因此所有尖角都在披風外、跟著皺褶起伏，不會被遮住、也不會浮在空中。
其他零件、女生模型完全不變。
"""
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "novice-c10b"))
for d in ("novice-c04", "novice-c03", "novice-c02", "novice-c01", "novice-v2"):
    sys.path.insert(0, str(HERE.parent / d))
import c10b_shapes as B  # noqa: E402
from sdf import Part, Prim, smax, smin  # noqa: E402

STAR_C = np.array([0.0, 0.17, 0.33])
STAR_R, STAR_r, STAR_N = 0.055, 0.014, 4
LAYER = 0.006      # 徽記厚度（披風表面外）
SINK = 0.0015      # 往披風內多 1.5 mm，避免接縫露縫
NORMAL = np.array([0.0, math.cos(math.radians(25)), -math.sin(math.radians(25))])  # 背面披風表面法線（往後、略往下）


def _eval(part, P):
    d = np.full(P.shape[:-1], 1.0)
    for op, p, k in part.ops:
        v = p.fn(P)
        d = smin(d, v, k) if op == "u" else (smax(d, -v, k) if op == "s" else smax(d, v, k))
    return d


def _frame():
    f = NORMAL / np.linalg.norm(NORMAL)
    up = np.array([0.0, 0.0, 1.0])
    u = up - f * (up @ f)
    u /= np.linalg.norm(u)
    s = np.cross(u, f)
    return f, u, s


def star2d(px, py):
    """與 novice_shapes.star_prim 相同的四芒星輪廓（第一個尖角朝上）"""
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
    f, u, s = _frame()

    def fn(P):
        q = P - STAR_C
        d2 = star2d(q @ s, q @ u)
        dt = _eval(tab, P)
        # 星形輪廓 ∩ 披風表面外 0～6 mm 的殼層（往內 1.5 mm）∩ 只取背面這一片（不會穿到身體另一側）
        shell = np.maximum(dt - LAYER, -dt - SINK)
        side = -(q @ f) - 0.09
        # 只留披風「外側」表面：往外移 4 mm 時離披風更遠的一側（內側表面的那一層會在披風裡面，從下方可能看見，所以去掉）
        outer = (dt - _eval(tab, P + f * 0.004)) * 4.0
        return np.maximum(np.maximum(np.maximum(d2, shell), side), outer) - 0.0008

    m = STAR_R + 0.03
    star = Part("tabard_star", old.group if hasattr(old, "group") else "metal", step=0.0012)
    star.add(Prim(fn, tuple(STAR_C - m), tuple(STAR_C + m)))
    return [star if p is old else p for p in parts]


def build(g):
    parts = B.build(g)
    return conform_star(parts) if g == "male" else parts
