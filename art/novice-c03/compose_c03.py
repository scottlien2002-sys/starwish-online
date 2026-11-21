"""
C0.3 驗收圖（同鏡頭、光照、曝光、角色比例）
  python3 art/novice-c03/compose_c03.py <art-novice-c02> <art-novice-c03> <輸出>
"""
import sys
from pathlib import Path

from PIL import Image, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "novice-c01"))
from compose_c01 import FONT, grid  # noqa: E402

W, H = 1040, 1280
N = {"front": "正面", "side": "左側面", "right": "右側面", "back": "背面", "left45": "45 度", "back45": "左後方"}


def main(c02, c03, out):
    c02, c03, out = Path(c02), Path(c03), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    f = ImageFont.truetype(FONT, 34)
    O = lambda p: Image.open(p).convert("RGB")
    head_box = (170, 0, 870, 700)   # 全身圖裁切頭部（同鏡頭）
    for g in ("male", "female"):
        lab = "男初心者" if g == "male" else "女初心者"
        grid([(N[v], O(c03 / f"c03_{g}_{v}.png")) for v in ("front", "side", "right", "back", "left45")], 5, W, H,
             f"Stage 5.4 V2 C0.3（{lab}）正面、左右側面、背面、45 度（同鏡頭、同光照、同比例）", f, out / f"c03_{g}_views.png")
        grid([(f"頭部 {N[v]}", O(c03 / f"c03_{g}_head_{v}.png")) for v in ("front", "side", "right", "back", "left45", "back45")], 3, 1100, 1100,
             f"Stage 5.4 V2 C0.3（{lab}）頭部特寫", f, out / f"c03_{g}_heads.png")
        # C0.2 vs C0.3 側面／45 度頭部、全身側面與背面（頭部裁切）
        tiles = [(f"C0.2 頭部 {N[v]}", O(c02 / f"c02_{g}_head_{v}.png")) for v in ("side", "left45")]
        tiles += [(f"C0.2 {N[v]}（頭部裁切）", O(c02 / f"c02_{g}_{v}.png").crop(head_box).resize((1100, 1100))) for v in ("side", "back")]
        tiles += [(f"C0.3 頭部 {N[v]}", O(c03 / f"c03_{g}_head_{v}.png")) for v in ("side", "left45")]
        tiles += [(f"C0.3 {N[v]}（頭部裁切）", O(c03 / f"c03_{g}_{v}.png").crop(head_box).resize((1100, 1100))) for v in ("side", "back")]
        grid(tiles, 4, 1100, 1100, f"Stage 5.4 V2（{lab}）C0.2（上）vs C0.3（下）髮型同角度對照", f, out / f"c02_vs_c03_{g}_hair.png")
        grid([(f"C0.2 {N[v]}", O(c02 / f"c02_{g}_{v}.png")) for v in ("side", "back", "left45")] + [(f"C0.3 {N[v]}", O(c03 / f"c03_{g}_{v}.png")) for v in ("side", "back", "left45")], 3, W, H,
             f"Stage 5.4 V2（{lab}）C0.2（上）vs C0.3（下）全身側面、背面、45 度", f, out / f"c02_vs_c03_{g}_body.png")
    # 男生：異常眼睛修正前後（C0.2 側面在後腦髮束縫隙露出藍色眼睛 → C0.3）
    grid([("C0.2 頭部 左側面（修正前）", O(c02 / "c02_male_head_side.png")), ("C0.2 頭部 45 度（修正前）", O(c02 / "c02_male_head_left45.png")),
          ("C0.3 頭部 左側面（修正後）", O(c03 / "c03_male_head_side.png")), ("C0.3 頭部 右側面（修正後）", O(c03 / "c03_male_head_right.png"))], 2, 1100, 1100,
         "男初心者 側面多餘眼睛：修正前（上）vs 修正後（下）", f, out / "c03_male_eye_fix.png")
    # 女生：後腦勺與馬尾特寫
    grid([(f"頭部 {N[v]}", O(c03 / f"c03_female_head_{v}.png")) for v in ("back45", "back", "side")], 3, 1100, 1100,
         "女初心者 C0.3 後腦勺與馬尾特寫", f, out / "c03_female_back_ponytail.png")


if __name__ == "__main__":
    main(*sys.argv[1:4])
