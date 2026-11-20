"""
Stage 5.4 初心者（男／女）臉部表情貼圖（Q 版動漫風）。只用 Pillow。

輸出 1024×512 圖集，4 欄 × 2 列，每格 256×256 = 臉部貼片（眉、眼、嘴、腮紅），透明背景：
  0 微笑（待機）  1 開心  2 驚訝  3 認真（戰鬥）
  4 受傷          5 倒下  6 閉眼（眨眼） 7 保留（同 0）
貼片在模型上的範圍：寬 0.26 公尺、高 0.26 公尺（臉部中心 x = 0，下緣在下巴上方）。
格子座標：x 0～256 左到右（角色右眼在畫面左邊），y 0～256 上到下。

用法：python3 art/novice-v1/gen_faces.py <輸出資料夾>
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SS = 4  # 超取樣
CELL = 256
COLS, ROWS = 4, 2

# 位置（以 256 格為單位）
EYE_DX = 58  # 兩眼中心距臉中線
EYE_Y = 140
EYE_W = 60
EYE_H = 84
BROW_Y = 70
MOUTH_Y = 222
BLUSH_Y = 188
BLUSH_DX = 82

STYLES = {
    "male": {
        "iris_top": (20, 55, 140),
        "iris_bottom": (70, 160, 240),
        "iris_ring": (18, 40, 100),
        "lash": (52, 30, 24),
        "brow": (110, 62, 36),
        "lashes_extra": False,
        "mouth": (150, 70, 60),
        "mouth_in": (200, 90, 90),
    },
    "female": {
        "iris_top": (120, 20, 30),
        "iris_bottom": (225, 90, 90),
        "iris_ring": (80, 14, 24),
        "lash": (60, 26, 26),
        "brow": (150, 80, 70),
        "lashes_extra": True,
        "mouth": (170, 70, 70),
        "mouth_in": (215, 95, 100),
    },
}


def S(v):
    return int(round(v * SS))


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw_open_eye(img, cx, cy, st, scale=1.0, narrow=0.0, small_pupil=False, mirror=False):
    """動漫大眼：上睫毛線、漸層虹膜、瞳孔、兩個高光、下睫毛。narrow：上眼瞼往下壓（認真）"""
    w, h = EYE_W * scale, EYE_H * scale
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    top = cy - h / 2 + narrow * h * 0.28
    box = [S(cx - w / 2), S(cy - h / 2), S(cx + w / 2), S(cy + h / 2)]
    # 眼白
    d.ellipse([S(cx - w / 2 - 2), S(top - 2), S(cx + w / 2 + 2), S(cy + h / 2 + 2)], fill=(255, 255, 255, 255))
    # 虹膜（直向漸層）
    iris = Image.new("RGBA", img.size, (0, 0, 0, 0))
    idr = ImageDraw.Draw(iris)
    iw, ih = w * 0.86, h * 0.92
    for k in range(S(ih)):
        t = k / S(ih)
        y = S(cy - ih / 2) + k
        col = lerp(st["iris_top"], st["iris_bottom"], min(1, t * 1.25))
        # 橢圓在這一列的半寬
        yy = (k - S(ih) / 2) / (S(ih) / 2)
        if abs(yy) >= 1:
            continue
        half = S(iw / 2) * math.sqrt(1 - yy * yy)
        idr.line([(S(cx) - half, y), (S(cx) + half, y)], fill=col + (255,))
    # 外圈
    idr.ellipse([S(cx - iw / 2), S(cy - ih / 2), S(cx + iw / 2), S(cy + ih / 2)], outline=st["iris_ring"] + (255,), width=S(3))
    # 瞳孔
    pw, ph = (iw * 0.34, ih * 0.40) if not small_pupil else (iw * 0.2, ih * 0.24)
    idr.ellipse([S(cx - pw / 2), S(cy - ph / 2 - 2), S(cx + pw / 2), S(cy + ph / 2 - 2)], fill=st["iris_ring"] + (255,))
    # 只保留眼白範圍內
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).ellipse([S(cx - w / 2), S(top), S(cx + w / 2), S(cy + h / 2)], fill=255)
    layer.paste(iris, (0, 0), Image.composite(iris, Image.new("RGBA", img.size, (0, 0, 0, 0)), mask).split()[3])
    d = ImageDraw.Draw(layer)
    # 高光
    hx = -1 if mirror else 1
    hy = max(top + 14, cy - h * 0.22)
    d.ellipse([S(cx - hx * w * 0.18 - 9), S(hy - 11), S(cx - hx * w * 0.18 + 9), S(hy + 11)], fill=(255, 255, 255, 255))
    d.ellipse([S(cx + hx * w * 0.2 - 4), S(cy + h * 0.2 - 4), S(cx + hx * w * 0.2 + 4), S(cy + h * 0.2 + 4)], fill=(255, 255, 255, 235))
    # 上睫毛（粗弧線）；認真時上眼瞼壓低成較平的粗線
    if narrow > 0:
        d.chord([S(cx - w / 2 - 4), S(top - 30), S(cx + w / 2 + 4), S(top + 6)], 0, 180, fill=(0, 0, 0, 0))
        d.line([(S(cx - w / 2 - 3), S(top + 6)), (S(cx), S(top + 1)), (S(cx + w / 2 + 3), S(top + 4))], fill=st["lash"] + (255,), width=S(8), joint="curve")
    else:
        d.arc([S(cx - w / 2 - 3), S(top - 3), S(cx + w / 2 + 3), S(cy + h / 2 + 30)], 195, 345, fill=st["lash"] + (255,), width=S(7))
    if st["lashes_extra"]:
        # 女生：外側眼尾上翹
        sx = 1 if mirror else -1  # 外側眼尾（畫面左邊的眼睛外側在左）
        ex, ey = cx + sx * w * 0.48, top + h * 0.12
        d.line([(S(ex), S(ey)), (S(ex + sx * 12), S(ey - 10))], fill=st["lash"] + (255,), width=S(5))
        d.line([(S(ex - sx * 4), S(ey + 6)), (S(ex + sx * 10), S(ey + 2))], fill=st["lash"] + (255,), width=S(4))
    # 下睫毛（短）
    d.arc([S(cx - w * 0.3), S(cy + h * 0.2), S(cx + w * 0.3), S(cy + h / 2 + 3)], 60, 120, fill=st["lash"] + (200,), width=S(2.5))
    img.alpha_composite(layer)


def draw_closed_happy(d, cx, cy, st):
    """^ 形笑眼"""
    w = EYE_W * 0.95
    d.arc([S(cx - w / 2), S(cy - 10), S(cx + w / 2), S(cy + 40)], 200, 340, fill=st["lash"] + (255,), width=S(7))


def draw_closed_relax(d, cx, cy, st):
    """閉眼（眨眼）：微彎的下弧線"""
    w = EYE_W * 0.9
    d.arc([S(cx - w / 2), S(cy - 30), S(cx + w / 2), S(cy + 18)], 20, 160, fill=st["lash"] + (255,), width=S(6))


def draw_squeeze(d, cx, cy, st, left):
    """> < 擠眼（受傷）"""
    s = 1 if left else -1
    w = EYE_W * 0.42
    d.line([(S(cx - s * w), S(cy - 16)), (S(cx + s * w), S(cy)), (S(cx - s * w), S(cy + 16))], fill=st["lash"] + (255,), width=S(7), joint="curve")


def draw_x(d, cx, cy, st):
    w = EYE_W * 0.38
    for a, b in (((-w, -w), (w, w)), ((-w, w), (w, -w))):
        d.line([(S(cx + a[0]), S(cy + a[1])), (S(cx + b[0]), S(cy + b[1]))], fill=st["lash"] + (255,), width=S(7))


def draw_brows(d, ox, st, mood):
    for side in (-1, 1):
        cx = ox + side * EYE_DX
        if mood == "serious":
            # 眉頭往內往下
            # 眉頭（靠臉中線）低、眉尾高 → 認真
            d.line([(S(cx - side * 24), S(BROW_Y + 12)), (S(cx + side * 24), S(BROW_Y - 6))], fill=st["brow"] + (255,), width=S(5))
        elif mood == "worried":
            # 眉頭高、眉尾低 → 難過／痛
            d.line([(S(cx - side * 24), S(BROW_Y - 6)), (S(cx + side * 24), S(BROW_Y + 8))], fill=st["brow"] + (255,), width=S(5))
        elif mood == "up":
            d.arc([S(cx - 26), S(BROW_Y - 22), S(cx + 26), S(BROW_Y + 12)], 200, 340, fill=st["brow"] + (255,), width=S(5))
        else:
            d.arc([S(cx - 24), S(BROW_Y - 12), S(cx + 24), S(BROW_Y + 16)], 205, 335, fill=st["brow"] + (255,), width=S(4))


def draw_mouth(d, ox, st, kind):
    cy = MOUTH_Y
    if kind == "smile":
        d.arc([S(ox - 13), S(cy - 12), S(ox + 13), S(cy + 6)], 20, 160, fill=st["mouth"] + (255,), width=S(4))
    elif kind == "open":
        d.chord([S(ox - 17), S(cy - 10), S(ox + 17), S(cy + 16)], 0, 180, fill=st["mouth_in"] + (255,), outline=st["mouth"] + (255,), width=S(3))
        d.chord([S(ox - 9), S(cy + 3), S(ox + 9), S(cy + 15)], 180, 360, fill=(240, 140, 150, 255))
    elif kind == "o":
        d.ellipse([S(ox - 8), S(cy - 9), S(ox + 8), S(cy + 9)], fill=st["mouth_in"] + (255,), outline=st["mouth"] + (255,), width=S(3))
    elif kind == "firm":
        d.line([(S(ox - 11), S(cy)), (S(ox + 11), S(cy - 2))], fill=st["mouth"] + (255,), width=S(4))
    elif kind == "wavy":
        pts = [(S(ox - 16 + i * 4), S(cy + (3 if i % 2 else -3))) for i in range(9)]
        d.line(pts, fill=st["mouth"] + (255,), width=S(4), joint="curve")
    elif kind == "pain":
        d.chord([S(ox - 15), S(cy - 6), S(ox + 15), S(cy + 12)], 180, 360, fill=st["mouth_in"] + (255,), outline=st["mouth"] + (255,), width=S(3))


def draw_blush(img, ox, strength=1.0):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for side in (-1, 1):
        cx = ox + side * BLUSH_DX
        d.ellipse([S(cx - 22), S(BLUSH_Y - 9), S(cx + 22), S(BLUSH_Y + 9)], fill=(255, 140, 150, int(120 * strength)))
    layer = layer.filter(ImageFilter.GaussianBlur(S(5)))
    img.alpha_composite(layer)


def cell(st, expr):
    img = Image.new("RGBA", (S(CELL), S(CELL)), (0, 0, 0, 0))
    ox = CELL / 2
    draw_blush(img, ox, 1.25 if expr in ("happy", "hurt") else 1.0)
    d = ImageDraw.Draw(img)
    mood = {"serious": "serious", "hurt": "worried", "ko": "worried", "surprised": "up"}.get(expr, "normal")
    draw_brows(d, ox, st, mood)
    for side in (-1, 1):
        cx = ox + side * EYE_DX
        if expr in ("smile", "spare"):
            draw_open_eye(img, cx, EYE_Y, st, mirror=side > 0)
        elif expr == "serious":
            draw_open_eye(img, cx, EYE_Y + 4, st, scale=0.95, narrow=0.9, mirror=side > 0)
        elif expr == "surprised":
            draw_open_eye(img, cx, EYE_Y - 4, st, scale=1.06, small_pupil=True, mirror=side > 0)
        elif expr == "happy":
            draw_closed_happy(ImageDraw.Draw(img), cx, EYE_Y, st)
        elif expr == "blink":
            draw_closed_relax(ImageDraw.Draw(img), cx, EYE_Y + 10, st)
        elif expr == "hurt":
            draw_squeeze(ImageDraw.Draw(img), cx, EYE_Y, st, left=side < 0)
        elif expr == "ko":
            draw_x(ImageDraw.Draw(img), cx, EYE_Y, st)
    d = ImageDraw.Draw(img)
    mouth = {"smile": "smile", "spare": "smile", "happy": "open", "surprised": "o", "serious": "firm", "hurt": "pain", "ko": "wavy", "blink": "smile"}[expr]
    draw_mouth(d, ox, st, mouth)
    return img.resize((CELL, CELL), Image.LANCZOS)


EXPRESSIONS = ["smile", "happy", "surprised", "serious", "hurt", "ko", "blink", "spare"]


def build(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    for name, st in STYLES.items():
        atlas = Image.new("RGBA", (CELL * COLS, CELL * ROWS), (0, 0, 0, 0))
        for i, e in enumerate(EXPRESSIONS):
            atlas.paste(cell(st, e), ((i % COLS) * CELL, (i // COLS) * CELL))
        # 透明處填入膚色（避免 mipmap 邊緣出現黑框；alpha 仍為 0）
        bg = Image.new("RGBA", atlas.size, (251, 226, 210, 0))
        bg.alpha_composite(atlas)
        px = bg.load()
        for y in range(bg.size[1]):
            for x in range(bg.size[0]):
                r, g, b, a = px[x, y]
                if a == 0:
                    px[x, y] = (251, 226, 210, 0)
        bg.save(out / f"novice_face_{name}.png")
        print("wrote", out / f"novice_face_{name}.png")


if __name__ == "__main__":
    build(Path(sys.argv[1] if len(sys.argv) > 1 else "out"))
