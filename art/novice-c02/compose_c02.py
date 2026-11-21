"""
C0.2 驗收圖（所有圖使用同一鏡頭、光照、曝光與角色比例）
  python3 art/novice-c02/compose_c02.py <art-novice-c01> <art-novice-c02> <輸出>
  c02_<g>_views.png        正面、左側面、背面、45 度
  c02_<g>_heads.png        頭部正面、左側面、45 度
  c01_vs_c02_<g>.png       C0.1（上）vs C0.2（下）同角度
  c02_female_skirt.png     裙裝正面、側面、背面特寫
  c02_female_skirt_length.png  C0.1 vs C0.2 裙長對照（同鏡頭裁切；標出前裙、荷葉、內裙下緣高度）
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "novice-c01"))
from compose_c01 import FONT, NAMES, grid  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import c02_shapes as CS  # noqa: E402

PX, W, H = 0.00105, 1040, 1280
ZB = -0.02 - 16 * PX  # 畫面最下列對應的高度


def zrow(z):
    return int(round(H - 1 - (z - ZB) / PX))


def main(c01, c02, out):
    c01, c02, out = Path(c01), Path(c02), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    f = ImageFont.truetype(FONT, 34)
    O = lambda p: Image.open(p).convert("RGB")
    V = ("front", "side", "back", "left45")
    for g in ("male", "female"):
        lab = "男初心者" if g == "male" else "女初心者"
        grid([(NAMES[v], O(c02 / f"c02_{g}_{v}.png")) for v in V], 4, W, H, f"Stage 5.4 V2 C0.2（{lab}）四視圖（同鏡頭、同光照、同比例）", f, out / f"c02_{g}_views.png")
        grid([(f"頭部 {NAMES[v]}", O(c02 / f"c02_{g}_head_{v}.png")) for v in ("front", "side", "left45")], 3, 1100, 1100, f"Stage 5.4 V2 C0.2（{lab}）頭部特寫", f, out / f"c02_{g}_heads.png")
        grid([(f"C0.1 {NAMES[v]}", O(c01 / f"c01_{g}_{v}.png")) for v in V] + [(f"C0.2 {NAMES[v]}", O(c02 / f"c02_{g}_{v}.png")) for v in V], 4, W, H,
             f"Stage 5.4 V2（{lab}）C0.1（上）vs C0.2（下）同角度對照", f, out / f"c01_vs_c02_{g}.png")
        grid([(f"C0.1 頭部 {NAMES[v]}", O(c01 / f"c01_{g}_head_{v}.png")) for v in ("front", "side", "left45")] +
             [(f"C0.2 頭部 {NAMES[v]}", O(c02 / f"c02_{g}_head_{v}.png")) for v in ("front", "side", "left45")], 3, 1100, 1100,
             f"Stage 5.4 V2（{lab}）頭部 C0.1（上）vs C0.2（下）", f, out / f"c01_vs_c02_{g}_heads.png")
    grid([(f"裙裝 {NAMES[v]}", O(c02 / f"c02_female_skirt_{v}.png")) for v in ("front", "side", "back")], 3, 1100, 1100,
         "Stage 5.4 V2 C0.2（女初心者）裙裝特寫：前裙延長、奶油白內裙、安全短褲、外裙往下收", f, out / "c02_female_skirt.png")
    # 裙長對照：同鏡頭的全身圖裁切腰到膝（正面、側面），C0.1 vs C0.2，標高度線
    y0, y1 = zrow(0.56), zrow(0.12)
    tiles = []
    for tag, src, pre, (zp, zpet), extra in (("C0.1", c01, "c01", CS.FRONT_SKIRT_C01, None), ("C0.2", c02, "c02", CS.FRONT_SKIRT_C02, CS.UNDERSKIRT_HEM)):
        for v in ("front", "side"):
            im = O(src / f"{pre}_female_{v}.png").crop((170, y0, 870, y1))
            d = ImageDraw.Draw(im)
            lines = [(zp, (200, 140, 40), "前裙"), (zpet, (230, 90, 140), "荷葉")] + ([(extra, (120, 120, 120), "內裙")] if extra else [])
            fs = ImageFont.truetype(FONT, 22)
            for j, (z, col, t) in enumerate(lines):
                yy = zrow(z) - y0
                d.line((0, yy, im.width, yy), fill=col, width=3)
                d.text((8 + j * 170, yy + 4), f"{t} {z * 100:.1f}cm", fill=col, font=fs)
            tiles.append((f"{tag} {NAMES[v]}", im))
    grid(tiles, 2, 700, y1 - y0, "裙長 上C0.1／下C0.2：前裙 13.0→15.6cm(+20%)、荷葉 16.2→19.0cm(+17%)", ImageFont.truetype(FONT, 26), out / "c02_female_skirt_length.png", half=False)


if __name__ == "__main__":
    main(*sys.argv[1:4])
