"""
C0 驗收圖（設定圖只在本機，不進儲存庫）：
  c0_<g>_sheet_vs_color.png  原始設定圖 vs 彩色模型，同尺寸並排（正面、側面、背面；同比例、腳底對齊）
  c0_<g>_views.png           彩色四視角（正面、左側面、背面、45 度）
  c0_<g>_faces.png           設定圖臉部 vs 彩色臉部特寫（正面、45 度）
  python3 art/novice-c0/compose_c0.py <art-novice-c0 資料夾> <男設定圖> <女設定圖> <iou.json> <輸出資料夾>
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "novice-v2"))
import preview as PV  # noqa: E402

PX, W, H = 0.00105, 1040, 1280
Z0 = -0.02 - 8 * PX
NAMES = {"front": "正面", "side": "左側面", "back": "背面", "left45": "45 度"}
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"


def main(src, msheet, fsheet, iou_path, out):
    src, out = Path(src), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    iou = json.loads(Path(iou_path).read_text())
    f = ImageFont.truetype(FONT, 34)
    for g, sheet in (("male", msheet), ("female", fsheet)):
        lab = "男初心者" if g == "male" else "女初心者"
        # 1) 同尺寸並排
        c = Image.new("RGB", (W * 6, H + 80), "white")
        d = ImageDraw.Draw(c)
        d.text((14, 14), f"Stage 5.4 V2 C0（{lab}）原始設定圖 vs 彩色模型　同尺寸並排（同比例、腳底對齊）", fill=(30, 30, 60), font=f)
        for i, v in enumerate(("front", "side", "back")):
            sh = iou[g][v]["shift_px"] / 2.0
            c.paste(PV.sheet_crop(sheet, g, v, PX, (W, H), Z0, sh), (i * 2 * W, 80))
            c.paste(Image.open(src / f"c0_{g}_{v}.png").convert("RGB"), ((i * 2 + 1) * W, 80))
            d.text((i * 2 * W + 14, 86), f"設定圖 {NAMES[v]}", fill=(30, 30, 60), font=f)
            d.text(((i * 2 + 1) * W + 14, 86), f"彩色模型 {NAMES[v]}", fill=(30, 30, 60), font=f)
        c.resize((c.width // 2, c.height // 2), Image.LANCZOS).save(out / f"c0_{g}_sheet_vs_color.png")
        # 2) 四視角
        c = Image.new("RGB", (W * 4, H + 80), "white")
        d = ImageDraw.Draw(c)
        d.text((14, 14), f"Stage 5.4 V2 C0（{lab}）彩色四視角（同鏡頭、同光照、同比例）", fill=(30, 30, 60), font=f)
        for i, v in enumerate(("front", "side", "back", "left45")):
            c.paste(Image.open(src / f"c0_{g}_{v}.png").convert("RGB"), (i * W, 80))
            d.text((i * W + 14, 86), NAMES[v], fill=(30, 30, 60), font=f)
        c.resize((c.width // 2, c.height // 2), Image.LANCZOS).save(out / f"c0_{g}_views.png")
        # 3) 臉部：設定圖頭部（正面、側面）＋彩色特寫（正面、45 度）
        HS = 1100
        hpx = 0.6 / HS
        z0h = 0.9 - 0.3 + 8 * hpx
        tiles = [("設定圖 正面", PV.sheet_crop(sheet, g, "front", hpx, (HS, HS), z0h, iou[g]["front"]["shift_px"] / 2.0 * PX / hpx)),
                 ("彩色模型 正面特寫", Image.open(src / f"c0_{g}_face_front.png").convert("RGB")),
                 ("彩色模型 45 度特寫", Image.open(src / f"c0_{g}_face_left45.png").convert("RGB"))]
        c = Image.new("RGB", (HS * 3, HS + 80), "white")
        d = ImageDraw.Draw(c)
        d.text((14, 14), f"Stage 5.4 V2 C0（{lab}）臉部特寫", fill=(30, 30, 60), font=f)
        for i, (t, im) in enumerate(tiles):
            c.paste(im, (i * HS, 80))
            d.text((i * HS + 14, 86), t, fill=(30, 30, 60), font=f)
        c.resize((c.width // 2, c.height // 2), Image.LANCZOS).save(out / f"c0_{g}_faces.png")


if __name__ == "__main__":
    main(*sys.argv[1:6])
