"""星願之泉 P3-1A 尺寸對照圖：正交正面圖＋正交俯視圖，疊上 V1.3 Grey-box 輪廓、碰撞圈、步道圈、高度刻度。
python3 fountain_compare.py <out 資料夾>   → fountain_compare.png
（英文標註，避免 CI 缺中文字型）
"""

import sys

from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else "out"

# 與 build_fountain.py 的 shoot() 參數一致
EW, EH, ESCALE, ECZ = 1400, 700, 16.5, 3.4  # 正面：寬 1400 px ＝ 16.5 m，畫面中心 Z＝3.4
PW, PSCALE = 1000, 23.5  # 俯視：1000 px ＝ 23.5 m

try:
    F = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 20)
    FS = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 16)
except OSError:
    F = FS = ImageFont.load_default()

el = Image.open(f"{OUT}/fountain_elev.png").convert("RGB")
pl = Image.open(f"{OUT}/fountain_plan.png").convert("RGB")
ppm = EW / ESCALE


def ex(x):
    return EW / 2 + x * ppm


def ez(z):
    return EH / 2 - (z - ECZ) * ppm


d = ImageDraw.Draw(el)
# V1.3 Grey-box 輪廓（虛線框）：外池 r7.2/高0.62、上盤 r3.08/1.6–2.23、底座 r1.1/0–1.6、柱 r0.7/2.2–5.7、水晶頂 6.5
GB = [(7.2, 0.0, 0.62), (3.08, 1.6, 2.23), (1.1, 0.0, 1.6), (0.7, 2.2, 5.7)]


def dashed_rect(x0, y0, x1, y1, col, w=2, dash=10):
    for a, b, c, e in ((x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)):
        L = max(abs(c - a), abs(e - b))
        n = int(L // dash)
        for i in range(0, n, 2):
            t0, t1 = i / max(n, 1), min((i + 1) / max(n, 1), 1)
            d.line((a + (c - a) * t0, b + (e - b) * t0, a + (c - a) * t1, b + (e - b) * t1), fill=col, width=w)


for r, z0, z1 in GB:
    dashed_rect(ex(-r), ez(z1), ex(r), ez(z0), (110, 110, 120))
d.line((ex(-0.3), ez(6.5), ex(0.3), ez(6.5)), fill=(110, 110, 120), width=3)
# 高度刻度
for z in range(0, 8):
    d.line((ex(-8.0), ez(z), ex(-7.7), ez(z)), fill=(40, 40, 40), width=2)
    d.text((ex(-8.2) - 30, ez(z) - 10), f"{z} m", fill=(40, 40, 40), font=FS)
d.line((ex(-7.85), ez(0), ex(-7.85), ez(7)), fill=(40, 40, 40), width=1)
for z, label in ((6.5, "top Y=6.5 (crystal)"), (2.34, "bowl rim 2.34"), (0.86, "basin rim 0.86")):
    d.line((ex(0.7), ez(z), ex(7.6), ez(z)), fill=(200, 120, 40), width=1)
    d.text((ex(5.2), ez(z) - 22), label, fill=(160, 80, 20), font=FS)
# 寬度
d.line((ex(-7), ez(-0.35), ex(7), ez(-0.35)), fill=(200, 40, 40), width=2)
d.text((ex(-1.6), ez(-0.35) + 4), "14.0 m  (collision r = 7 m)", fill=(200, 40, 40), font=FS)
d.text((12, 10), "FRONT ELEVATION (ortho)  —  dashed grey = V1.3 grey-box, pink = 1.25 m player", fill=(20, 20, 20), font=F)

pp = PW / PSCALE
dp = ImageDraw.Draw(pl)
dp.text((12, 10), "PLAN (ortho)", fill=(20, 20, 20), font=F)
dp.text((12, 40), "red = collision r 7 m   blue = interact r 10.5 m", fill=(20, 20, 20), font=FS)
dp.text((12, 62), "ground disc = walkway r 11 m", fill=(20, 20, 20), font=FS)
# grey-box 外池圈（虛線）
import math

for i in range(0, 96, 2):
    a0, a1 = i * math.tau / 96, (i + 1) * math.tau / 96
    dp.line((PW / 2 + math.cos(a0) * 7.2 * pp, PW / 2 + math.sin(a0) * 7.2 * pp, PW / 2 + math.cos(a1) * 7.2 * pp, PW / 2 + math.sin(a1) * 7.2 * pp), fill=(110, 110, 120), width=2)

H = max(el.height, pl.height)
sheet = Image.new("RGB", (el.width + pl.width, H), (245, 245, 248))
sheet.paste(el, (0, (H - el.height) // 2))
sheet.paste(pl, (el.width, 0))
sheet.save(f"{OUT}/fountain_compare.png")
print("compare ok")
