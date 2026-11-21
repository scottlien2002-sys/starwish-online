"""
C1.0-B 驗收圖（同鏡頭、燈光、曝光、背景）
  python3 art/novice-c10b/compose_c10b.py <art-novice-c10a> <art-novice-c10b> <輸出>
女生裙裝「修改前」用 art-novice-c10b 裡的 c10a_female_skirt_* / c10a_female_low_*（CI 用同一場景重拍的 C1.0-A）。
"""
import sys
from pathlib import Path

from PIL import Image, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "novice-c01"))
from compose_c01 import FONT, grid  # noqa: E402

W, H = 1040, 1280
S = 1100
N = {"front": "正面", "side": "左側面", "right": "右側面", "back": "背面", "left45": "45 度", "back45": "左後方",
     "front30": "前方 30 度"}
LOWN = {"front": "正面仰角 30 度", "front30": "斜前方仰角 55 度", "side": "左側仰角 30 度", "back": "背面仰角 30 度"}


def main(a, b, out):
    a, b, out = Path(a), Path(b), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    f = ImageFont.truetype(FONT, 34)
    O = lambda p: Image.open(p).convert("RGB")
    # 1～3) 女生裙裝前後比較：正面（含 45 度）、側面（左右）、背面
    for name, views, title in (("skirt_front", ("front", "left45"), "正面"), ("skirt_side", ("side", "right"), "側面"),
                               ("skirt_back", ("back",), "背面")):
        tiles = []
        for v in views:
            tiles += [(f"C1.0-A 裙裝 {N[v]}", O(b / f"c10a_female_skirt_{v}.png")), (f"C1.0-B 裙裝 {N[v]}", O(b / f"c10b_female_skirt_{v}.png"))]
        grid(tiles, 2, S, S, f"女初心者 裙裝安全修正 {title}：C1.0-A（左）vs C1.0-B（右）", f, out / f"c10b_female_{name}.png")
    # 4) 低角度遮蔽檢查
    lv = ("front", "front30", "side", "back")
    grid([(f"C1.0-A {LOWN[v]}", O(b / f"c10a_female_low_{v}.png")) for v in lv] + [(f"C1.0-B {LOWN[v]}", O(b / f"c10b_female_low_{v}.png")) for v in lv],
         4, S, S, "女初心者 低角度遮蔽檢查：C1.0-A（上）vs C1.0-B（下）", f, out / "c10b_female_low_angle.png")
    # 5) 男女 C1.0-A vs C1.0-B 最終比較（全身、頭部、服裝材質）
    for g in ("male", "female"):
        lab = "男初心者" if g == "male" else "女初心者"
        grid([("C1.0-A 正面", O(a / f"c10a_{g}_front.png")), ("C1.0-B 正面", O(b / f"c10b_{g}_front.png")),
              ("C1.0-A 45 度", O(a / f"c10a_{g}_left45.png")), ("C1.0-B 45 度", O(b / f"c10b_{g}_left45.png")),
              ("C1.0-A 背面", O(a / f"c10a_{g}_back.png")), ("C1.0-B 背面", O(b / f"c10b_{g}_back.png"))], 6, W, H,
             f"{lab}：C1.0-A vs C1.0-B 最終比較（同鏡頭、燈光、曝光、背景）", f, out / f"c10b_{g}_final_compare.png")
        hv = ("front", "left45")
        dv = ("torso_front", "legs_front")
        tiles = [(f"C1.0-A 頭部 {N[v]}", O(a / f"c10a_{g}_head_{v}.png")) for v in hv] + [(f"C1.0-A {'上身' if 'torso' in v else '下身'}", O(a / f"c10a_{g}_detail_{v}.png")) for v in dv]
        tiles += [(f"C1.0-B 頭部 {N[v]}", O(b / f"c10b_{g}_head_{v}.png")) for v in hv] + [(f"C1.0-B {'上身' if 'torso' in v else '下身'}", O(b / f"c10b_{g}_detail_{v}.png")) for v in dv]
        grid(tiles, 4, S, S, f"{lab} 細節精修：C1.0-A（上）vs C1.0-B（下）", f, out / f"c10b_{g}_detail_compare.png")


if __name__ == "__main__":
    main(*sys.argv[1:4])
