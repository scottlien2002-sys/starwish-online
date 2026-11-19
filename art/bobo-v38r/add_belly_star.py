"""
把腹部星星定義寫進 V3.8 模型檔（共用工具 art/common/glb_tools.py）。

鎖定規格：外徑 0.0714、內徑 0.0357、高度 0.24、腹部水平中央（x = 0）、朝向與 V3.3 起相同。
V3.8 身體前後變薄，正面表面在高度 0.24 處從 y = -0.6016 移到 -0.5594，
星星維持「表面往內 0.0566」的同一個嵌入深度 → 中心 z 從 0.545 改為 0.5028（尺寸、高度、水平位置不變）。
計算方式：art/bobo-v38r/bobo_shape.py 的 sd_bobo 沿 x=0、z=0.24 由前往後找第一個表面點。

用法：python3 art/bobo-v38r/add_belly_star.py <放 bobo_v38r_*.glb 的資料夾>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
from glb_tools import write_extras  # noqa: E402

BELLY_STAR = dict(
    version="3.8R",
    outer=0.0714,
    inner=0.0357,
    center=[0.0, 0.24, 0.542],
    normal=[0.0, -0.22, 0.975],
    coords="babylon-object-space",
    note="鎖定尺寸 0.0714；V3.8R 身體重建，嵌入深度維持表面往內 0.0566",
)

if __name__ == "__main__":
    d = Path(sys.argv[1])
    for lod in ("high", "medium", "low"):
        n = write_extras(
            d / f"bobo_v38r_{lod}.glb",
            f"StarDewBoboV38r_{lod}",
            {"bellyStar": BELLY_STAR, "monster": {"monsterId": "star_dew_bobo", "assetId": "bobo", "version": "v38r", "lod": lod}},
            {"model": "StarDewBobo", "version": "3.8R", "stage": "grey"},
        )
        print(f"bobo_v38r_{lod}.glb", n, "bytes")
