"""
初心者 V2 — C1.0-B3（候選版）：男初心者左右耳往臉部方向移動。以 C1.0-B2 為基礎，其他零件完全不變。
C1.0-B、C1.0-B1、C1.0-B2 的檔案都不改；女生沿用 C1.0-B2（＝C1.0-B）。

量測（ear_eval，射線與體積抽樣）：
- C1.0-B2 耳朵中心 y = 0.075（背面在 +y，鼻尖約 y = −0.17）：位於頭骨中心（y ≈ 0.03）後方約 4.5 cm。
- C1.0-B3 往前 3.0 cm → y = 0.045；大小（0.022 × 0.040 × 0.050）、角度（繞 z 18°）、高度（z 0.776）、
  與頭部的融合量（smin 0.015）都不變；左右對稱。
- 側面看得到的耳朵面積：91.5% → 90.1%（耳朵前移後，臉旁髮束只多擋住約 1.4%）。
- 耳朵外側沒有任何一點在頭髮裡面（0%）→ 沒有穿模。
- 耳朵最前緣 y ≈ 0.005，仍在臉部貼圖 UV 的「只對到膚色」區（y > −0.01），五官貼圖不會印到耳朵或後方。
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
for d in ("novice-c10b2", "novice-c10b1", "novice-c10b", "novice-c04", "novice-c03", "novice-c02", "novice-c01", "novice-v2"):
    sys.path.insert(0, str(HERE.parent / d))
import c10b2_shapes as B2  # noqa: E402
from sdf import ellipsoid, rot  # noqa: E402

EAR_OLD = (0.152, 0.075, 0.776)     # C1.0-B2（novice_shapes.head_part 男生）
EAR_DY = -0.030                     # 往臉部方向 3.0 cm
EAR_R = (0.022, 0.04, 0.05)
EAR_TILT = 18.0


def move_ears(parts):
    head = next(p for p in parts if p.name == "head")
    found = 0
    for i, (op, pr, k) in enumerate(head.ops):
        c = (pr.lo + pr.hi) / 2
        for sx in (1, -1):
            if op == "u" and abs(c[0] - EAR_OLD[0] * sx) < 1e-6 and abs(c[1] - EAR_OLD[1]) < 1e-6 and abs(c[2] - EAR_OLD[2]) < 1e-6:
                head.ops[i] = (op, ellipsoid((EAR_OLD[0] * sx, EAR_OLD[1] + EAR_DY, EAR_OLD[2]), EAR_R, rot((0, 0, 1), -EAR_TILT * sx)), k)
                found += 1
    assert found == 2, f"男生頭部應有左右兩個耳朵，找到 {found} 個"
    return parts


def build(g):
    parts = B2.build(g)
    return move_ears(parts) if g == "male" else parts
