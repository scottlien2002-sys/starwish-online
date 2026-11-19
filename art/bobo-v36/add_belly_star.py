"""
把腹部星星定義寫進 V3.6 模型檔（使用共用工具 art/common/glb_tools.py）。

鎖定規格（與 V3.3～V3.5 相同）：外徑 0.0714（不得放大）、內徑 0.0357、中心 (0, 0.24, 0.545) 腹部水平中央。
星星本身由果凍著色器在身體內部繪製，頁面從模型檔讀取這些參數。

用法：python3 art/bobo-v36/add_belly_star.py <放 bobo_v36_*.glb 的資料夾>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
from glb_tools import write_extras  # noqa: E402

BELLY_STAR = dict(
    version="3.6",
    outer=0.0714,
    inner=0.0357,
    center=[0.0, 0.24, 0.545],
    normal=[0.0, -0.22, 0.975],
    coords="babylon-object-space",
    note="鎖定規格（與 V3.3～V3.5 相同）；由果凍著色器繪製於身體內部",
)

if __name__ == "__main__":
    d = Path(sys.argv[1])
    for lod in ("high", "medium", "low"):
        n = write_extras(
            d / f"bobo_v36_{lod}.glb",
            f"StarDewBoboV36_{lod}",
            {"bellyStar": BELLY_STAR, "monster": {"monsterId": "star_dew_bobo", "assetId": "bobo", "version": "v36", "lod": lod}},
            {"model": "StarDewBobo", "version": "3.6"},
        )
        print(f"bobo_v36_{lod}.glb", n, "bytes")
