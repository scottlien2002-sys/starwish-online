"""
步驟 B.1 對照圖：上＝設定圖、中＝修正前灰模、下＝修正後灰模（四視角，同比例、腳底對齊）；另做頭部特寫對照。
  python3 art/novice-v2/compose_b1.py <修正前 clay 資料夾> <修正後 clay 資料夾> <男設定圖> <女設定圖> <iou_before.json> <iou_after.json> <輸出資料夾>
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import preview as PV

PX, W, H = 0.00105, 1040, 1280
Z0 = -0.02 - 8 * PX
NAMES = {"front": "正面", "side": "側面", "back": "背面", "left45": "45 度"}
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"


def main(before, after, msheet, fsheet, ib, ia, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    ib, ia = json.loads(Path(ib).read_text()), json.loads(Path(ia).read_text())
    f = ImageFont.truetype(FONT, 30)
    fb = ImageFont.truetype(FONT, 34)
    for g, sheet in (("male", msheet), ("female", fsheet)):
        lab = "男" if g == "male" else "女"
        canvas = Image.new("RGB", (W * 4 + 150, H * 3 + 70), (255, 255, 255))
        d = ImageDraw.Draw(canvas)
        d.text((14, 12), f"初心者 V2 步驟 B.1（{lab}）四視角對照 — 上：設定圖　中：修正前　下：修正後（同比例、腳底對齊）", fill=(30, 30, 60), font=fb)
        for r, t in enumerate(("設定圖", "修正前", "修正後")):
            d.text((14, 70 + r * H + H // 2), t, fill=(30, 30, 60), font=fb)
        for i, v in enumerate(("front", "side", "back", "left45")):
            x = 150 + i * W
            if v != "left45":
                sh = ia[g][v]["shift_px"] / 2.0
                canvas.paste(PV.sheet_crop(sheet, g, v, PX, (W, H), Z0, sh), (x, 70))
                d.text((x + 12, 76), NAMES[v], fill=(30, 30, 60), font=f)
            else:
                d.text((x + 12, 76), "45 度（設定圖沒有此角度）", fill=(30, 30, 60), font=f)
            for r, (src, iu) in enumerate(((before, ib), (after, ia))):
                im = Image.open(Path(src) / f"clay_{g}_{v}.png").convert("RGB")
                y = 70 + (r + 1) * H
                canvas.paste(im, (x, y))
                if v != "left45":
                    d.text((x + 12, y + 8), f"輪廓重疊 {iu[g][v]['iou'] * 100:.1f}%", fill=(20, 20, 40), font=f)
        canvas.resize((canvas.width // 2, canvas.height // 2), Image.LANCZOS).save(out / f"stepB1_{g}_before_after.png")
        # 頭部特寫：設定圖頭部（正面、側面）＋修正後特寫（正面、側面、45 度）
        HS = 1100
        hpx = 0.8 / HS
        heads = []
        for v in ("front", "side"):
            sh = ia[g][v]["shift_px"] / 2.0 * (PX / hpx)
            z0h = 0.94 - 0.4 + 8 * hpx  # 畫面中心 0.94、高 0.8 公尺；sheet_crop 以「倒數第 8 列」為 z0
            heads.append((f"設定圖 {NAMES[v]}", PV.sheet_crop(sheet, g, v, hpx, (HS, HS), z0h, sh)))
        for v in ("front", "side", "left45"):
            heads.append((f"修正後 {NAMES[v]}", Image.open(Path(after) / f"clay_{g}_head_{v}.png").convert("RGB")))
        hc = Image.new("RGB", (HS * 5, HS + 70), (255, 255, 255))
        dh = ImageDraw.Draw(hc)
        dh.text((14, 12), f"初心者 V2 步驟 B.1（{lab}）頭部特寫", fill=(30, 30, 60), font=fb)
        for i, (t, im) in enumerate(heads):
            hc.paste(im, (i * HS, 70))
            dh.text((i * HS + 14, 78), t, fill=(30, 30, 60), font=f)
        hc.resize((hc.width // 2, hc.height // 2), Image.LANCZOS).save(out / f"stepB1_{g}_head_closeup.png")


if __name__ == "__main__":
    main(*sys.argv[1:8])
