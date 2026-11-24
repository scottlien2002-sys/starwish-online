"""
初心者 V2 — C1.0-B5（候選）：女生耳朵＋耳朵附近兩側髮束往後撥（使用者 2026-11-24 正式允許），男生沿用 C1.0-B4。
- 男女耳朵依同一個頭部結構原則：耳朵中心在臉部橢球後方 5 cm、比臉頰寬 0.2 cm，朝前轉 30°，大小不變（不放大、不外拉）。
  男：臉中心 y −0.03、半寬 0.166 → 耳朵 (0.168, 0.020)；女：臉中心 y −0.02、半寬 0.170 → 耳朵 (0.172, 0.030)。
- 女生頭髮：耳朵前方的側面髮束塞到耳後（耳朵上緣以下、耳朵前方的那一段移除，頂端圓角），耳朵周圍的頭髮再往後推一點避免穿插；
  外側髮簾、耳後頭髮、瀏海、頭頂、馬尾、蝴蝶結、髮色都不變。
其他零件、臉、五官、服裝、比例不變。C1.0-B2／B3／B4 檔案不改。
"""
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
for d in ("novice-c10b4", "novice-c10b2", "novice-c10b1", "novice-c10b", "novice-c04", "novice-c03", "novice-c02", "novice-c01", "novice-v2"):
    sys.path.insert(0, str(HERE.parent / d))
import c10b4_shapes as B4  # noqa: E402
from sdf import Prim, ellipsoid, rbox, rot, smax  # noqa: E402

EAR_F_OLD = (0.155, 0.1, 0.79)
EAR_F_NEW = (0.172, 0.030, 0.79)
EAR_R = (0.022, 0.04, 0.05)

# 髮束往後撥：以耳朵為中心的影響範圍（公尺）
TUCK = dict(push=0.075, x0=0.20, xr=0.11, z0=0.79, zr=0.075, y_front=-0.12, y_back=0.10)
# 耳朵前方的側面髮束「塞到耳後」：從耳朵上緣往下、耳朵前方（y < 0.03，耳朵中心）、臉頰外側到耳朵外側（|x| 0.14～0.26）的髮束移除，
# 頂端圓角（像髮束從耳朵上方繞到後面）；更外側的髮簾、耳朵後方的頭髮、瀏海、頭頂都保留 → 正面看得到耳朵、輪廓不變
CUT = dict(xc=0.20, yc=-0.16, zc=0.6775, half=(0.06, 0.19, 0.1775), round=0.03, k=0.02)


def tuck_weight(P):
    x, y, z = np.abs(P[..., 0]), P[..., 1], P[..., 2]
    t = TUCK
    wx = np.exp(-((x - t["x0"]) / t["xr"]) ** 2)
    wz = np.exp(-((z - t["z0"]) / t["zr"]) ** 2)
    # 只影響耳朵前方到耳朵後方一點（後腦的髮束不動）
    u = np.clip((t["y_back"] - y) / (t["y_back"] - t["y_front"]), 0, 1)
    wy = np.sin(np.pi * np.clip(u, 0, 1)) ** 0.5
    return wx * wz * wy


def tuck_prim(pr):
    fn = pr.fn
    push = TUCK["push"]

    def f(P):
        Q = np.array(P, dtype=float, copy=True)
        Q[..., 1] = Q[..., 1] - push * tuck_weight(P)   # 在 P 看到的是原本在前方 push 處的頭髮 → 頭髮往後移
        return fn(Q)

    lo = np.array(pr.lo, float)
    hi = np.array(pr.hi, float)
    hi[1] += push   # 往後移，邊界框往後擴
    return Prim(f, lo, hi)


def female_fix(parts):
    head = next(p for p in parts if p.name == "head")
    o, n = EAR_F_OLD, EAR_F_NEW
    found = 0
    for i, (op, pr, k) in enumerate(head.ops):
        c = (pr.lo + pr.hi) / 2
        for sx in (1, -1):
            if op == "u" and abs(c[0] - o[0] * sx) < 1e-6 and abs(c[1] - o[1]) < 1e-6 and abs(c[2] - o[2]) < 1e-6:
                head.ops[i] = (op, ellipsoid((n[0] * sx, n[1], n[2]), EAR_R, rot((0, 0, 1), -30.0 * sx)), k)
                found += 1
    assert found == 2, f"女生頭部應有左右兩個耳朵，找到 {found} 個"
    hair = next(p for p in parts if p.name == "hair")
    hair.ops = [(op, tuck_prim(pr), k) for op, pr, k in hair.ops]
    # 耳朵前方的側面髮束「塞到耳後」（見 CUT 說明）
    for sx in (1, -1):
        c = np.array([CUT["xc"] * sx, CUT["yc"], CUT["zc"]])
        hair.sub(rbox(c, np.array(CUT["half"]), CUT["round"]), CUT["k"])
    return parts


def build(g):
    parts = B4.build(g)
    return female_fix(parts) if g == "female" else parts
