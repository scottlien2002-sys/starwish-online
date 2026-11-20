"""
把 CI 的黏土渲染（clay_<g>_<view>.png）與設定圖並排（設定圖只在本機，不進儲存庫）。
  python3 art/novice-v2/compose_compare.py <clay 資料夾> <男設定圖> <女設定圖> <iou.json> <輸出資料夾>
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import preview as PV

PX, W, H = 0.00105, 1040, 1280
Z0 = -0.02 - 8 * PX  # sheet_crop 的「倒數第 8 列」換成 Blender 渲染的對應高度
NAMES = {"front": "正面", "side": "側面", "back": "背面", "left45": "45 度"}


def main(clay, msheet, fsheet, iou_path, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    iou = json.loads(Path(iou_path).read_text())
    font = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 30)
    for g, sheet in (("male", msheet), ("female", fsheet)):
        cols = []
        for v in ("front", "side", "back", "left45"):
            clay_im = Image.open(Path(clay) / f"clay_{g}_{v}.png").convert("RGB")
            if v == "left45":
                cols.append((None, clay_im, v))
                continue
            sh = iou[g][v]["shift_px"] / 2.0 if v == "side" else 0
            ref = PV.sheet_crop(sheet, g, v, PX, (W, H), Z0, sh)
            cols.append((ref, clay_im, v))
        # 上排設定圖、下排灰模
        canvas = Image.new("RGB", (W * 4, H * 2 + 60), (255, 255, 255))
        d = ImageDraw.Draw(canvas)
        title = "男" if g == "male" else "女"
        d.text((12, 10), f"初心者 V2 步驟 B 灰模（{title}）— 上：設定圖　下：Blender 灰模（同比例、腳底對齊）", fill=(30, 30, 60), font=font)
        for i, (ref, cl, v) in enumerate(cols):
            if ref is not None:
                canvas.paste(ref, (i * W, 60))
                lab = f"{NAMES[v]}　輪廓重疊 IoU {iou[g][v]['iou'] * 100:.1f}%"
            else:
                lab = f"{NAMES[v]}（設定圖沒有此角度）"
            canvas.paste(cl, (i * W, 60 + H))
            d.text((i * W + 14, 66), lab, fill=(30, 30, 60), font=font)
        canvas.save(out / f"stepB_{g}_compare.png")
        small = canvas.resize((canvas.width // 2, canvas.height // 2), Image.LANCZOS)
        small.save(out / f"stepB_{g}_compare_small.png")


if __name__ == "__main__":
    main(*sys.argv[1:6])
