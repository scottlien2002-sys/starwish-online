"""
C1.0-A 驗收圖（同鏡頭、燈光、曝光、背景）
  python3 art/novice-c10a/compose_c10a.py <art-novice-c03> <art-novice-c04> <art-novice-c10a> <輸出>
"""
import sys
from pathlib import Path

from PIL import Image, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "novice-c01"))
from compose_c01 import FONT, grid  # noqa: E402

W, H = 1040, 1280
N = {"front": "正面", "side": "左側面", "right": "右側面", "back": "背面", "left45": "45 度", "back45": "左後方"}


def main(c03, c04, c10a, out):
    c03, c04, c10a, out = Path(c03), Path(c04), Path(c10a), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    f = ImageFont.truetype(FONT, 34)
    O = lambda p: Image.open(p).convert("RGB")
    for g, src, pre, tag in (("male", c03, "c03", "C0.3"), ("female", c04, "c04", "C0.4")):
        lab = "男初心者" if g == "male" else "女初心者"
        # 1) 正面比較（全身＋頭部）
        grid([(f"{tag} 正面", O(src / f"{pre}_{g}_front.png")), ("C1.0-A 正面", O(c10a / f"c10a_{g}_front.png")),
              (f"{tag} 45 度", O(src / f"{pre}_{g}_left45.png")), ("C1.0-A 45 度", O(c10a / f"c10a_{g}_left45.png"))], 4, W, H,
             f"{lab}：{tag} vs C1.0-A（同鏡頭、燈光、曝光、背景）", f, out / f"c10a_{g}_front_compare.png")
        # 2) 頭部特寫比較
        hv = ("front", "left45", "side")
        grid([(f"{tag} 頭部 {N[v]}", O(src / f"{pre}_{g}_head_{v}.png")) for v in hv] + [(f"C1.0-A 頭部 {N[v]}", O(c10a / f"c10a_{g}_head_{v}.png")) for v in hv], 3, 1100, 1100,
             f"{lab} 頭部特寫：{tag}（上）vs C1.0-A（下）", f, out / f"c10a_{g}_head_compare.png")
        # 3) 服裝材質特寫（C1.0-A）＋同鏡頭全身圖裁切的前後對照
        box = (170, 470, 870, 1170) if g == "male" else (170, 430, 870, 1130)
        tiles = [(f"{tag}（全身圖裁切）", O(src / f"{pre}_{g}_front.png").crop(box).resize((1100, 1100))),
                 ("C1.0-A（全身圖裁切）", O(c10a / f"c10a_{g}_front.png").crop(box).resize((1100, 1100))),
                 ("C1.0-A 上身特寫 正面", O(c10a / f"c10a_{g}_detail_torso_front.png")), ("C1.0-A 上身特寫 45 度", O(c10a / f"c10a_{g}_detail_torso_left45.png")),
                 ("C1.0-A 下身／靴子 正面", O(c10a / f"c10a_{g}_detail_legs_front.png")), ("C1.0-A 下身／靴子 45 度", O(c10a / f"c10a_{g}_detail_legs_left45.png"))]
        grid(tiles, 3, 1100, 1100, f"{lab} 服裝材質特寫（布料、皮革、縫線、金色飾邊）", f, out / f"c10a_{g}_material.png")
        # 4) 側面、背面檢查
        sv = ("side", "right", "back")
        grid([(f"{tag} {N[v]}", O(src / f"{pre}_{g}_{v}.png")) for v in sv] + [(f"C1.0-A {N[v]}", O(c10a / f"c10a_{g}_{v}.png")) for v in sv], 3, W, H,
             f"{lab} 側面與背面：{tag}（上）vs C1.0-A（下）", f, out / f"c10a_{g}_side_back.png")


if __name__ == "__main__":
    main(*sys.argv[1:5])
