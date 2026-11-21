"""C0.4 配色與材質：與 C0.3 完全相同（含臉部貼圖 UV 修正）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "novice-c03"))
from c03_look import *  # noqa: E402,F401,F403
from c03_look import L2, uv_of, face_texture, albedo, part_key, strand_shading, SURFACE, PALETTE  # noqa: E402,F401
