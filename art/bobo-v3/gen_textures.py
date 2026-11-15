"""
星露啵啵 V3：表情貼圖集（眼睛、嘴巴、腮紅），依《怪物設定圖 01》表情參考繪製。
用法：python3 gen_textures.py <輸出資料夾>（需要 Pillow）
輸出：
  bobo_v3_eyes.png  1024×512：4×2 格（每格 256×256），透明背景
  bobo_v3_face.png  1024×512：上半 4×2 格嘴型（每格 256×128）；下半左邊為腮紅
表情順序（兩張相同）：0 一般 1 開心 2 好奇 3 生氣 4 害怕 5 暈眩 6 昏睡 7 受傷
貼圖以「畫面右邊那隻眼（角色左眼）」繪製；另一眼 UV 鏡像，所以「受傷」畫成「<」，合起來是「> <」。
"""
import math, sys
from PIL import Image, ImageDraw, ImageFilter

SS = 4  # 超取樣倍數（抗鋸齒）
EXPRESSIONS = ["normal", "happy", "curious", "angry", "scared", "dizzy", "sleepy", "hurt"]
NAVY = (14, 22, 70, 255)
INK = (16, 20, 58, 255)


def cell_canvas(w, h):
    return Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))


def down(img, w, h):
    return img.resize((w, h), Image.LANCZOS)


def eye_cell(kind):
    W = H = 256
    im = cell_canvas(W, H)
    d = ImageDraw.Draw(im)
    S = SS
    cx, cy = 128 * S, 128 * S
    rx, ry = 92 * S, 112 * S  # 眼睛幾乎填滿格子（眼睛網格本身就是眼睛的大小）

    def ellipse(c, r, fill):
        d.ellipse([c[0] - r[0], c[1] - r[1], c[0] + r[0], c[1] + r[1]], fill=fill)

    def open_eye(pupil_scale=1.0, iris_scale=1.0, cut=None, extra_shine=True):
        # 外圈深藍 → 虹膜漸層 → 瞳孔 → 高光
        ellipse((cx, cy), (rx, ry), NAVY)
        # 虹膜：上深下亮的藍（以多層橢圓近似漸層）
        for i in range(24):
            t = i / 23
            col = (int(30 + 40 * t), int(70 + 120 * t), int(200 + 55 * t), 255)
            r = (rx * 0.82 * iris_scale * (1 - 0.35 * t), ry * 0.8 * iris_scale * (1 - 0.35 * t))
            ellipse((cx, cy + ry * 0.12 + ry * 0.22 * t), r, col)
        ellipse((cx, cy + ry * 0.04), (rx * 0.42 * pupil_scale, ry * 0.42 * pupil_scale), (8, 12, 44, 255))
        # 高光：右上大、左下小、加一顆小點
        ellipse((cx + rx * 0.3, cy - ry * 0.38), (rx * 0.36, ry * 0.3), (255, 255, 255, 255))
        ellipse((cx - rx * 0.36, cy + ry * 0.42), (rx * 0.17, ry * 0.14), (255, 255, 255, 235))
        if extra_shine:
            ellipse((cx - rx * 0.05, cy + ry * 0.08), (rx * 0.07, ry * 0.06), (210, 240, 255, 220))
        if cut is not None:
            # 生氣：眼睛上緣往內側斜切（以透明多邊形挖掉）
            d.polygon(cut, fill=(0, 0, 0, 0))

    def line(points, width):
        d.line(points, fill=INK, width=int(width * S), joint="curve")
        for p in (points[0], points[-1]):
            r = width * S / 2
            d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=INK)

    if kind == "normal":
        open_eye()
    elif kind == "curious":
        open_eye(pupil_scale=0.85, iris_scale=1.05)
    elif kind == "scared":
        ellipse((cx, cy), (rx, ry), NAVY)
        ellipse((cx, cy), (rx * 0.7, ry * 0.72), (235, 245, 255, 255))
        ellipse((cx, cy + ry * 0.05), (rx * 0.3, ry * 0.32), (30, 80, 200, 255))
        ellipse((cx, cy + ry * 0.05), (rx * 0.14, ry * 0.15), (8, 12, 44, 255))
        ellipse((cx + rx * 0.12, cy - ry * 0.08), (rx * 0.08, ry * 0.07), (255, 255, 255, 255))
    elif kind == "angry":
        # 外側眼角高、內側低（左眼：內側在畫面右邊）
        # 此貼圖是「畫面右邊那隻眼（角色左眼）」：內側在畫面左邊 → 左邊切得較深、眉毛內低外高
        cut = [(cx - rx * 1.2, cy - ry * 1.3), (cx + rx * 1.2, cy - ry * 1.3), (cx + rx * 1.2, cy - ry * 0.62), (cx - rx * 1.2, cy - ry * 0.05)]
        open_eye(pupil_scale=0.9, cut=cut, extra_shine=False)
        line([(cx - rx * 0.95, cy - ry * 0.38), (cx + rx * 1.0, cy - ry * 0.98)], 20)
    elif kind == "happy":
        pts = [(cx - rx * 0.85 + rx * 1.7 * t, cy + ry * 0.15 - math.sin(math.pi * t) * ry * 0.55) for t in [i / 20 for i in range(21)]]
        line(pts, 26)
    elif kind == "sleepy":
        pts = [(cx - rx * 0.8 + rx * 1.6 * t, cy + ry * 0.05 + math.sin(math.pi * t) * ry * 0.28) for t in [i / 20 for i in range(21)]]
        line(pts, 20)
    elif kind == "hurt":
        # 畫成「<」：畫面右邊的眼睛是「<」，左邊的眼睛 UV 鏡像後變成「>」→ 合起來是「> <」
        line([(cx + rx * 0.7, cy - ry * 0.55), (cx - rx * 0.65, cy), (cx + rx * 0.7, cy + ry * 0.55)], 26)
    elif kind == "dizzy":
        pts = []
        for i in range(160):
            a = i / 160 * math.pi * 6
            r = (i / 160) * rx * 0.85
            pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r * (ry / rx)))
        line(pts, 15)
    return down(im, W, H)


def mouth_cell(kind):
    W, H = 256, 128
    im = cell_canvas(W, H)
    d = ImageDraw.Draw(im)
    S = SS
    cx, cy = 128 * S, 60 * S
    red = (178, 40, 74, 255)
    dark = (90, 16, 40, 255)
    tongue = (255, 136, 160, 255)

    def d_mouth(w, h):
        # 張開的 D 形笑口：上緣微彎、下緣圓弧，舌頭在下方
        top = cy - h * 0.35
        pts = [(cx - w + 2 * w * t, top + math.sin(math.pi * t) * h * 0.12) for t in [i / 24 for i in range(25)]]
        pts += [(cx + w * math.cos(a), top + h * 0.08 + math.sin(a) * h * 1.1) for a in [math.pi * i / 30 for i in range(31)]]
        d.polygon(pts, fill=dark)
        inner = [(x * 0.92 + cx * 0.08, y * 0.92 + (top) * 0.08) for x, y in pts]
        d.polygon(inner, fill=red)
        d.ellipse([cx - w * 0.55, top + h * 0.55, cx + w * 0.55, top + h * 1.15], fill=tongue)
        # 重新畫外框（舌頭不超出嘴形）
        mask = Image.new("L", im.size, 0)
        ImageDraw.Draw(mask).polygon(pts, fill=255)
        return mask

    if kind in ("normal", "happy", "hurt"):
        w, h = (44 * S, 36 * S) if kind == "normal" else (56 * S, 46 * S)
        if kind == "hurt":
            w, h = 40 * S, 30 * S
        mask = d_mouth(w, h)
        # 舌頭裁切在嘴形內
        clipped = Image.new("RGBA", im.size, (0, 0, 0, 0))
        clipped.paste(im, (0, 0), mask)
        im = clipped
    elif kind == "curious":
        d.ellipse([cx - 16 * S, cy - 16 * S, cx + 16 * S, cy + 20 * S], fill=dark)
        d.ellipse([cx - 11 * S, cy - 9 * S, cx + 11 * S, cy + 15 * S], fill=red)
    elif kind == "dizzy":
        d.ellipse([cx - 20 * S, cy - 18 * S, cx + 20 * S, cy + 22 * S], fill=dark)
        d.ellipse([cx - 14 * S, cy - 11 * S, cx + 14 * S, cy + 16 * S], fill=red)
    elif kind == "angry":
        pts = [(cx - 40 * S + 80 * S * t, cy + 8 * S - math.sin(math.pi * t) * 18 * S) for t in [i / 20 for i in range(21)]]
        d.line(pts, fill=dark, width=10 * S, joint="curve")
    elif kind == "scared":
        pts = [(cx - 44 * S + 88 * S * i / 8, cy + (8 * S if i % 2 else -6 * S)) for i in range(9)]
        d.line(pts, fill=dark, width=8 * S, joint="curve")
    elif kind == "sleepy":
        pts = [(cx - 22 * S + 44 * S * t, cy + math.sin(math.pi * t) * 10 * S) for t in [i / 16 for i in range(17)]]
        d.line(pts, fill=dark, width=8 * S, joint="curve")
    return down(im, W, H)


def blush_cell():
    W, H = 256, 128
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = im.load()
    for y in range(H):
        for x in range(W):
            dx = (x - W / 2) / (W * 0.42)
            dy = (y - H / 2) / (H * 0.4)
            r = math.sqrt(dx * dx + dy * dy)
            a = max(0.0, 1 - r) ** 1.4 * 0.85
            px[x, y] = (255, 118, 158, int(255 * a))
    d = ImageDraw.Draw(im)
    for i in (-1, 0, 1):
        x0 = W / 2 + i * 34
        d.line([(x0 - 9, H / 2 + 14), (x0 + 9, H / 2 - 14)], fill=(255, 84, 132, 150), width=4)
    return im


def main(out):
    eyes = Image.new("RGBA", (1024, 512), (0, 0, 0, 0))
    face = Image.new("RGBA", (1024, 512), (0, 0, 0, 0))
    for i, k in enumerate(EXPRESSIONS):
        col, row = i % 4, i // 4
        eyes.paste(eye_cell(k), (col * 256, row * 256))
        face.paste(mouth_cell(k), (col * 256, row * 128))
    face.paste(blush_cell(), (0, 256))
    eyes.save(f"{out}/bobo_v3_eyes.png", optimize=True)
    face.save(f"{out}/bobo_v3_face.png", optimize=True)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
