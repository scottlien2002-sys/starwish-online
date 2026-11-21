"""C0.4 驗收圖：C0.3（上）vs C0.4（下）女生頭髮同角度對照＋四視圖（同鏡頭、光照、比例）
  python3 art/novice-c04/compose_c04.py <art-novice-c03> <art-novice-c04> <輸出>"""
import sys
from pathlib import Path

from PIL import Image, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "novice-c01"))
from compose_c01 import FONT, grid  # noqa: E402

W, H = 1040, 1280
N = {"front": "正面", "side": "左側面", "right": "右側面", "back": "背面", "left45": "45 度", "back45": "左後方"}


def main(c03, c04, out):
    c03, c04, out = Path(c03), Path(c04), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    f = ImageFont.truetype(FONT, 34)
    O = lambda p: Image.open(p).convert("RGB")
    V = ("side", "right", "back45", "back", "front")
    grid([(f"C0.3 頭部 {N[v]}", O(c03 / f"c03_female_head_{v}.png")) for v in V] + [(f"C0.4 頭部 {N[v]}", O(c04 / f"c04_female_head_{v}.png")) for v in V], 5, 1100, 1100,
         "女初心者 後方頭髮厚度減半：C0.3（上）vs C0.4（下）", f, out / "c03_vs_c04_female_hair.png")
    grid([(f"C0.3 {N[v]}", O(c03 / f"c03_female_{v}.png")) for v in ("side", "back", "left45")] + [(f"C0.4 {N[v]}", O(c04 / f"c04_female_{v}.png")) for v in ("side", "back", "left45")], 3, W, H,
         "女初心者 C0.3（上）vs C0.4（下）全身", f, out / "c03_vs_c04_female_body.png")
    grid([(N[v], O(c04 / f"c04_female_{v}.png")) for v in ("front", "side", "right", "back", "left45")], 5, W, H,
         "女初心者 C0.4 正面、左右側面、背面、45 度", f, out / "c04_female_views.png")


if __name__ == "__main__":
    main(*sys.argv[1:4])
