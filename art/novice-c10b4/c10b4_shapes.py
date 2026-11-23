"""
初心者 V2 — C1.0-B4（候選）：男生耳朵移到頭部正面輪廓的左右兩側（正面看得到、左右對稱）；女生見下方說明。供骨架與動畫使用。
以 C1.0-B2 為基礎（男 = C1.0-B2、女 = C1.0-B）；C1.0-B3 只動男生耳朵前後位置，B4 取代 B3 的耳朵設定。
只改兩個耳朵形狀：中心往外、往前，朝前多轉一點；大小（0.022 × 0.040 × 0.050）、高度、融合量都不變。
臉、五官、髮型、服裝、比例都不變。C1.0-B2／B3 的檔案不改。
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
for d in ("novice-c10b2", "novice-c10b1", "novice-c10b", "novice-c04", "novice-c03", "novice-c02", "novice-c01", "novice-v2"):
    sys.path.insert(0, str(HERE.parent / d))
import c10b2_shapes as B2  # noqa: E402
from sdf import ellipsoid, rot  # noqa: E402

# 原本（novice_shapes.head_part）：(x, y, z)；背面在 +y、臉在 −y
EAR_OLD = {"male": (0.152, 0.075, 0.776), "female": (0.155, 0.1, 0.79)}
# C1.0-B4 男生：x 往外到 0.168（頭部正面輪廓在耳朵高度約 ±0.165 → 正面露出約 2 cm）、往前到臉頰後方、朝前轉 30°（原 18°）
#   量測（從正面打射線）：正面看得到的耳朵 6.5 → 13.3 cm²；耳朵落在頭髮內 0%。
# 女生：兩側頭髮在耳朵高度往外到約 ±0.30 m，從正面看會把耳朵整個蓋住。
#   試過 (x, y, 轉角) = (0.155, 0.10, 18°) 原位、(0.168, 0.07, 30°)、(0.168, 0.03, 30°)、(0.170, 0.00, 35°)：
#   正面看得到的耳朵都只有 0.3～1.1 cm²，而且耳朵有 42～69% 落在頭髮裡面。
#   不改髮型就無法讓女生耳朵在正面露出 → 女生耳朵維持原位，等使用者決定是否調整髮型。
EAR_NEW = {"male": (0.168, 0.020, 0.776)}
EAR_R = (0.022, 0.04, 0.05)
EAR_TILT_OLD = 18.0
EAR_TILT = 30.0


def move_ears(parts, g):
    head = next(p for p in parts if p.name == "head")
    o, n = EAR_OLD[g], EAR_NEW[g]
    found = 0
    for i, (op, pr, k) in enumerate(head.ops):
        c = (pr.lo + pr.hi) / 2
        for sx in (1, -1):
            if op == "u" and abs(c[0] - o[0] * sx) < 1e-6 and abs(c[1] - o[1]) < 1e-6 and abs(c[2] - o[2]) < 1e-6:
                head.ops[i] = (op, ellipsoid((n[0] * sx, n[1], n[2]), EAR_R, rot((0, 0, 1), -EAR_TILT * sx)), k)
                found += 1
    assert found == 2, f"{g} 頭部應有左右兩個耳朵，找到 {found} 個"
    return parts


def build(g):
    parts = B2.build(g)
    return move_ears(parts, g) if g in EAR_NEW else parts
