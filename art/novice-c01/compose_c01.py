"""
C0.1 驗收圖（設定圖只在本機，不進儲存庫）
  python3 art/novice-c01/compose_c01.py <art-novice-c0> <art-novice-c01> <男設定圖> <女設定圖> <iou.json> <輸出>
  c01_<g>_views.png         C0.1 彩色四視圖
  c01_<g>_heads.png         頭部正面、側面、45 度特寫
  c0_vs_c01_<g>.png         C0（上）vs C0.1（下）同角度四視圖
  c01_<g>_material.png      材質前後比較：頭部正面／45 度、腰帶手套、靴子（C0 vs C0.1）
  c01_<g>_sheet_vs_color.png 原始設定圖 vs C0.1 同尺寸並排
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


def grid(tiles, cols, tw, th, title, f, out, half=True):
    rows = (len(tiles) + cols - 1) // cols
    c = Image.new("RGB", (tw * cols, th * rows + 70), "white")
    d = ImageDraw.Draw(c)
    d.text((14, 12), title, fill=(30, 30, 60), font=f)
    for i, (lab, im) in enumerate(tiles):
        x, y = (i % cols) * tw, 70 + (i // cols) * th
        if im is not None:
            c.paste(im.resize((tw, th)) if im.size != (tw, th) else im, (x, y))
        d.text((x + 12, y + 8), lab, fill=(20, 20, 50), font=f)
    if half:
        c = c.resize((c.width // 2, c.height // 2), Image.LANCZOS)
    c.save(out)


def main(c0, c01, msheet, fsheet, iou_path, out):
    c0, c01, out = Path(c0), Path(c01), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    iou = json.loads(Path(iou_path).read_text())
    f = ImageFont.truetype(FONT, 34)
    O = lambda p: Image.open(p).convert("RGB")
    for g, sheet in (("male", msheet), ("female", fsheet)):
        lab = "男初心者" if g == "male" else "女初心者"
        V = ("front", "side", "back", "left45")
        grid([(NAMES[v], O(c01 / f"c01_{g}_{v}.png")) for v in V], 4, W, H, f"Stage 5.4 V2 C0.1（{lab}）彩色四視圖（同鏡頭、同光照、同比例）", f, out / f"c01_{g}_views.png")
        grid([(f"頭部 {NAMES[v]}", O(c01 / f"c01_{g}_head_{v}.png")) for v in ("front", "side", "left45")], 3, 1100, 1100, f"Stage 5.4 V2 C0.1（{lab}）頭部特寫", f, out / f"c01_{g}_heads.png")
        grid([(f"C0 {NAMES[v]}", O(c0 / f"c0_{g}_{v}.png")) for v in V] + [(f"C0.1 {NAMES[v]}", O(c01 / f"c01_{g}_{v}.png")) for v in V], 4, W, H,
             f"Stage 5.4 V2（{lab}）C0（上）vs C0.1（下）同角度比較", f, out / f"c0_vs_c01_{g}.png")
        # 材質前後：頭部正面、45 度；身體局部（腰帶＋手套、靴子）裁切放大
        def crop(p, box):
            return O(p).crop(box).resize((1100, 1100), Image.LANCZOS)
        belt_box = (220, 520, 820, 1120) if g == "male" else (220, 480, 820, 1080)
        boot_box = (270, 860, 770, 1260)
        tiles = []
        for tag, src, pre in (("C0", c0, "c0"), ("C0.1", c01, "c01")):
            hf = src / (f"{pre}_{g}_face_front.png" if pre == "c0" else f"{pre}_{g}_head_front.png")
            h4 = src / (f"{pre}_{g}_face_left45.png" if pre == "c0" else f"{pre}_{g}_head_left45.png")
            tiles += [(f"{tag} 頭部正面", O(hf)), (f"{tag} 頭部 45 度", O(h4)),
                      (f"{tag} 腰帶／手套（放大）", crop(src / f"{pre}_{g}_front.png", belt_box)),
                      (f"{tag} 靴子（放大）", crop(src / f"{pre}_{g}_left45.png", boot_box))]
        grid(tiles, 4, 1100, 1100, f"Stage 5.4 V2（{lab}）材質改善前後：上 C0、下 C0.1", f, out / f"c01_{g}_material.png")
        tiles = []
        for v in ("front", "side", "back"):
            sh = iou[g][v]["shift_px"] / 2.0
            tiles += [(f"設定圖 {NAMES[v]}", PV.sheet_crop(sheet, g, v, PX, (W, H), Z0, sh)), (f"C0.1 {NAMES[v]}", O(c01 / f"c01_{g}_{v}.png"))]
        grid(tiles, 6, W, H, f"Stage 5.4 V2 C0.1（{lab}）原始設定圖 vs 彩色模型　同尺寸並排", f, out / f"c01_{g}_sheet_vs_color.png")


if __name__ == "__main__":
    main(*sys.argv[1:7])
