"""C0.2 配色與材質：沿用 C0.1（材質參數、髮束陰影、臉部貼圖完全相同），只補上新零件的顏色。"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "novice-c01"))
import c01_look as L1  # noqa: E402

L1.C0.PALETTE["female"].update({"underskirt": "#fdf3e6", "safety_shorts": "#f6d2da"})
PALETTE = L1.C0.PALETTE
SURFACE = L1.SURFACE
albedo = L1.albedo
face_texture = L1.face_texture
uv_of = L1.uv_of
part_key = L1.part_key
strand_shading = L1.strand_shading
