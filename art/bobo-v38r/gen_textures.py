"""
星露啵啵 V3.8R 第三階段：表情貼圖集（眼睛＋眉毛、嘴巴、腮紅），依《怪物設定圖 01》重畫。
用法：python3 gen_textures.py <輸出資料夾>（需要 Pillow）
輸出：
  bobo_v38r_eyes.png  1024×1024：4×2 格（每格 256×512），透明背景；每格下方是眼睛、上方是眉毛
    （眉毛和眼睛在同一格 → 8 種表情各有自己的眉形，切換表情只改貼圖座標，不改模型外型）
  bobo_v38r_face.png  1024×512：上半 4×2 格嘴型（每格 256×128）；下半左邊為腮紅
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
    # 格子 256×512，對應模型上寬 0.26、高 0.52 的貼片（約每單位 985 像素）
    # 設定圖：眼睛寬 0.14 W、高 0.20 W（模型 0.175 × 0.25）、眉毛在 79% 身高、長約 0.16 W
    W, H = 256, 512
    im = cell_canvas(W, H)
    d = ImageDraw.Draw(im)
    S = SS
    cx, cy = 128 * S, 311 * S
    rx, ry = 86 * S, 122 * S

    def ellipse(c, r, fill):
        d.ellipse([c[0] - r[0], c[1] - r[1], c[0] + r[0], c[1] + r[1]], fill=fill)

    def open_eye(pupil_scale=1.0, iris_scale=1.0, cut=None, extra_shine=True):
        """
        V3.1 眼睛（依設定圖）：細深藍外框 → 虹膜由上方深靛藍漸變到下方明亮青藍（有深度）
        → 虹膜外環與放射紋 → 深色瞳孔 → 上眼瞼投影 → 三層高光（右上大、左下小、閃點）
        """
        ellipse((cx, cy), (rx, ry), NAVY)
        irx, iry = rx * 0.9 * iris_scale, ry * 0.9 * iris_scale
        icy = cy + ry * 0.04
        # 虹膜漸層（上深下亮，越往下越青）
        for i in range(40):
            t = i / 39
            # V3.1：上方更深邃的靛藍 → 中段寶藍 → 下方亮青
            col = (int(12 + 50 * t), int(22 + 190 * t * t + 10 * t), int(105 + 150 * t), 255)
            k = 1 - 0.55 * t
            ellipse((cx, icy + iry * 0.32 * t), (irx * k, iry * k), col)
        # 虹膜外環（深一點，增加立體感）
        ring = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(ring).ellipse([cx - irx, icy - iry, cx + irx, icy + iry], outline=(16, 26, 92, 200), width=int(7 * S))
        im.alpha_composite(ring)
        # 放射細紋
        # 放射紋：長短交錯、亮暗交錯（細緻的虹膜纖維）
        for k in range(36):
            a = k / 36 * math.pi * 2
            r0 = 0.42 + 0.04 * (k % 3)
            r1 = 0.88 if k % 2 == 0 else 0.72
            x0, y0 = cx + math.cos(a) * irx * r0, icy + math.sin(a) * iry * r0
            x1, y1 = cx + math.cos(a) * irx * r1, icy + math.sin(a) * iry * r1
            col = (140, 220, 255, 90) if k % 2 == 0 else (10, 20, 90, 60)
            d.line([(x0, y0), (x1, y1)], fill=col, width=int(2 * S))
        # 瞳孔：外圈深藍光環 → 黑色核心（明確層次）
        ellipse((cx, icy + iry * 0.02), (rx * 0.44 * pupil_scale, ry * 0.44 * pupil_scale), (20, 30, 110, 255))
        ellipse((cx, icy + iry * 0.02), (rx * 0.36 * pupil_scale, ry * 0.36 * pupil_scale), (4, 6, 30, 255))
        # 上眼瞼投影（虹膜上緣一圈半透明深色，讓眼睛有凹凸）
        shade = Image.new("RGBA", im.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(shade)
        sd.ellipse([cx - rx * 1.05, cy - ry * 1.25, cx + rx * 1.05, cy - ry * 0.15], fill=(6, 10, 50, 120))
        shade = shade.filter(ImageFilter.GaussianBlur(10 * S))
        mask = Image.new("L", im.size, 0)
        ImageDraw.Draw(mask).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=255)
        im.paste(Image.alpha_composite(im, shade), (0, 0), mask)
        d2 = ImageDraw.Draw(im)
        # 下緣反光帶（角膜的弧面感）
        glow = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse([cx - irx * 0.7, icy + iry * 0.38, cx + irx * 0.7, icy + iry * 0.92], fill=(150, 235, 255, 150))
        glow = glow.filter(ImageFilter.GaussianBlur(6 * S))
        im.paste(Image.alpha_composite(im, glow), (0, 0), mask)
        d2 = ImageDraw.Draw(im)
        # 高光：右上大、左下小、加閃點
        d2.ellipse([cx + rx * 0.3 - rx * 0.34, cy - ry * 0.4 - ry * 0.28, cx + rx * 0.3 + rx * 0.34, cy - ry * 0.4 + ry * 0.28], fill=(255, 255, 255, 255))
        d2.ellipse([cx - rx * 0.36 - rx * 0.16, cy + ry * 0.38 - ry * 0.13, cx - rx * 0.36 + rx * 0.16, cy + ry * 0.38 + ry * 0.13], fill=(255, 255, 255, 240))
        if extra_shine:
            d2.ellipse([cx - rx * 0.12 - rx * 0.07, cy - ry * 0.12 - ry * 0.06, cx - rx * 0.12 + rx * 0.07, cy - ry * 0.12 + ry * 0.06], fill=(220, 245, 255, 230))
        if cut is not None:
            # 生氣：眼睛上緣往內側斜切（以透明多邊形挖掉）
            d2.polygon(cut, fill=(0, 0, 0, 0))

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
    brow(d, kind)
    return down(im, W, H)


# 眉毛（設定圖：眼睛上方細細的深藍弧線）。此格是「畫面右邊那隻眼（角色左眼）」：內側在畫面左邊
# (內端 y, 外端 y, 弧度（正 = 往上拱）, 粗細, 波浪)；y 以像素計（格子 512 高），眉毛中心約 y 98
BROWS = {
    "normal": (104, 100, 10, 9, 0),
    "happy": (96, 92, 16, 9, 0),
    "curious": (82, 86, 18, 9, 0),
    "angry": (138, 92, -2, 12, 0),
    "scared": (84, 116, 6, 9, 5),
    "dizzy": (100, 108, 4, 8, 7),
    "sleepy": (128, 126, 3, 8, 0),
    "hurt": (88, 122, 2, 10, 0),
}


def brow(d, kind):
    S = SS
    yi, yo, arc, wid, wave = BROWS[kind]
    x0, x1 = 60, 200  # 內端 → 外端（中心稍微偏外，像設定圖）
    pts = []
    for i in range(25):
        t = i / 24
        x = x0 + (x1 - x0) * t
        y = yi + (yo - yi) * t - arc * math.sin(math.pi * t) + wave * math.sin(t * math.pi * 3)
        pts.append((x * S, y * S))
    # 兩端略細：分段畫，越往兩端越細
    for i in range(len(pts) - 1):
        t = i / (len(pts) - 2)
        w = wid * (0.55 + 0.45 * math.sin(math.pi * min(1.0, t * 1.1)))
        d.line([pts[i], pts[i + 1]], fill=INK, width=max(1, int(w * S)))
        r = w * S / 2
        d.ellipse([pts[i][0] - r, pts[i][1] - r, pts[i][0] + r, pts[i][1] + r], fill=INK)


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
        # 設定圖：張開的 D 形笑口，寬約 0.15 W（貼片每單位 640 像素 → 半寬約 60）
        w, h = (58 * S, 54 * S) if kind == "normal" else (66 * S, 62 * S)
        if kind == "hurt":
            w, h = 46 * S, 38 * S
        mask = d_mouth(w, h)
        # 舌頭裁切在嘴形內
        clipped = Image.new("RGBA", im.size, (0, 0, 0, 0))
        clipped.paste(im, (0, 0), mask)
        im = clipped
    elif kind == "curious":
        d.ellipse([cx - 22 * S, cy - 20 * S, cx + 22 * S, cy + 28 * S], fill=dark)
        d.ellipse([cx - 16 * S, cy - 13 * S, cx + 16 * S, cy + 22 * S], fill=red)
        d.ellipse([cx - 10 * S, cy + 6 * S, cx + 10 * S, cy + 20 * S], fill=tongue)
    elif kind == "dizzy":
        d.ellipse([cx - 26 * S, cy - 22 * S, cx + 26 * S, cy + 28 * S], fill=dark)
        d.ellipse([cx - 19 * S, cy - 15 * S, cx + 19 * S, cy + 21 * S], fill=red)
    elif kind == "angry":
        pts = [(cx - 48 * S + 96 * S * t, cy + 12 * S - math.sin(math.pi * t) * 22 * S) for t in [i / 20 for i in range(21)]]
        d.line(pts, fill=dark, width=11 * S, joint="curve")
    elif kind == "scared":
        pts = [(cx - 52 * S + 104 * S * i / 8, cy + (9 * S if i % 2 else -7 * S)) for i in range(9)]
        d.line(pts, fill=dark, width=9 * S, joint="curve")
    elif kind == "sleepy":
        pts = [(cx - 28 * S + 56 * S * t, cy + math.sin(math.pi * t) * 12 * S) for t in [i / 16 for i in range(17)]]
        d.line(pts, fill=dark, width=9 * S, joint="curve")
    return down(im, W, H)


def blush_cell():
    W, H = 256, 128
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = im.load()
    for y in range(H):
        for x in range(W):
            dx = (x - W / 2) / (W * 0.33)
            dy = (y - H / 2) / (H * 0.36)
            r = math.sqrt(dx * dx + dy * dy)
            a = (1.0 - min(1.0, r) ** 2.2) ** 1.6 * 0.9 if r < 1 else 0.0
            px[x, y] = (255, 112, 150, int(255 * a))
    return im


def main(out):
    eyes = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    face = Image.new("RGBA", (1024, 512), (0, 0, 0, 0))
    for i, k in enumerate(EXPRESSIONS):
        col, row = i % 4, i // 4
        eyes.paste(eye_cell(k), (col * 256, row * 512))
        face.paste(mouth_cell(k), (col * 256, row * 128))
    face.paste(blush_cell(), (0, 256))
    eyes.save(f"{out}/bobo_v38r_eyes.png", optimize=True)
    face.save(f"{out}/bobo_v38r_face.png", optimize=True)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
