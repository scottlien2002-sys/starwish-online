"""
原始設定圖與灰模「同尺寸」並排（人工驗收用）：每個視角一組 [設定圖 | 灰模]，同比例、腳底對齊、同畫面大小。
  python3 art/novice-v2/compose_pairs.py <clay 資料夾> <男設定圖> <女設定圖> <iou.json> <輸出資料夾> <標題前綴>
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import preview as PV

PX, W, H = 0.00105, 1040, 1280
Z0 = -0.02 - 8 * PX
NAMES = {"front": "正面", "side": "側面", "back": "背面"}
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"


def main(clay, msheet, fsheet, iou_path, out, prefix):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    iou = json.loads(Path(iou_path).read_text())
    f = ImageFont.truetype(FONT, 34)
    for g, sheet in (("male", msheet), ("female", fsheet)):
        lab = "男" if g == "male" else "女"
        canvas = Image.new("RGB", (W * 6, H + 80), (255, 255, 255))
        d = ImageDraw.Draw(canvas)
        d.text((14, 14), f"{prefix}（{lab}）原始設定圖 vs 灰模　同尺寸並排（同比例、腳底對齊）", fill=(30, 30, 60), font=f)
        for i, v in enumerate(("front", "side", "back")):
            sh = iou[g][v]["shift_px"] / 2.0
            canvas.paste(PV.sheet_crop(sheet, g, v, PX, (W, H), Z0, sh), (i * 2 * W, 80))
            canvas.paste(Image.open(Path(clay) / f"clay_{g}_{v}.png").convert("RGB"), ((i * 2 + 1) * W, 80))
            d.text((i * 2 * W + 14, 86), f"設定圖 {NAMES[v]}", fill=(30, 30, 60), font=f)
            d.text(((i * 2 + 1) * W + 14, 86), f"灰模 {NAMES[v]}　輪廓重疊 {iou[g][v]['iou'] * 100:.1f}%", fill=(20, 20, 40), font=f)
        canvas.resize((canvas.width // 2, canvas.height // 2), Image.LANCZOS).save(out / f"{g}_sheet_vs_grey.png")


if __name__ == "__main__":
    main(*sys.argv[1:7])
