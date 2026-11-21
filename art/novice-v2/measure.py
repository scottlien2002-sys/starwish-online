"""
Stage 5.4 V2 步驟 A：男女初心者設定圖量測（只用 numpy、Pillow）。
設定圖不放進儲存庫：執行時以參數傳入路徑。

  python3 art/novice-v2/measure.py <男性設定圖.png> <女性設定圖.png> <輸出資料夾>

做法：
  1. 各視角（正面、側面、背面）在設定圖上的範圍（PANELS，像素座標）
  2. 從範圍邊緣往內「淹水」找背景（白底、淡紫地面陰影）→ 剩下的就是角色輪廓（白色上衣被描線包住，不會被當成背景）
  3. 依顏色分類各部位（皮膚、頭髮、藍、金、紫、皮革、白、深色褲子）
  4. 每一列的寬度（正面、背面）、深度（側面）→ 輪廓曲線
  5. 人工標註點（LANDMARKS：眼睛、下巴、肩膀等，依放大格線圖讀取）
輸出：measure_<male|female>.json、標註圖 annot_*.png
"""
import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

# 各視角範圍 (x0, y0, x1, y1)；y1 = 標題文字上方
PANELS = {
    "male": {"front": (20, 100, 400, 705), "side": (402, 100, 726, 705), "back": (728, 100, 1068, 705)},
    "female": {"front": (22, 86, 436, 705), "side": (440, 86, 786, 705), "back": (788, 86, 1139, 705)},
}


def rgb2hsv(a):
    a = a.astype(float) / 255
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    d = mx - mn
    h = np.zeros_like(mx)
    m = d > 1e-6
    rr = m & (mx == r)
    gg = m & (mx == g) & ~rr
    bb = m & ~rr & ~gg
    h[rr] = ((g - b)[rr] / d[rr]) % 6
    h[gg] = (b - r)[gg] / d[gg] + 2
    h[bb] = (r - g)[bb] / d[bb] + 4
    h = h * 60
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    return h, s, mx


def silhouette(img):
    """背景：從邊緣連通、亮且低飽和（白底、淡紫陰影、淡色地面）的像素"""
    h, s, v = rgb2hsv(img)
    # 白底＋淡紫地面陰影（亮、低飽和；陰影偏藍紫）
    bgish = ((v > 0.86) & (s < 0.16)) | ((v > 0.8) & (s < 0.3) & (h > 200) & (h < 300))
    H, W = bgish.shape
    seen = np.zeros_like(bgish)
    q = deque()
    for x in range(W):
        for y in (0, H - 1):
            if bgish[y, x]:
                q.append((y, x))
    for y in range(H):
        for x in (0, W - 1):
            if bgish[y, x]:
                q.append((y, x))
    while q:
        y, x = q.popleft()
        if seen[y, x]:
            continue
        seen[y, x] = True
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < H and 0 <= nx < W and bgish[ny, nx] and not seen[ny, nx]:
                q.append((ny, nx))
    fg = ~seen
    # 去掉地面陰影殘留的細碎像素：只保留最大連通區
    lab = np.zeros(fg.shape, int)
    best, best_n, cur = 0, 0, 0
    for y0, x0 in zip(*np.nonzero(fg)):
        if lab[y0, x0]:
            continue
        cur += 1
        n = 0
        q.append((y0, x0))
        while q:
            y, x = q.popleft()
            if lab[y, x] or not fg[y, x]:
                continue
            lab[y, x] = cur
            n += 1
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < H and 0 <= nx < W and fg[ny, nx] and not lab[ny, nx]:
                    q.append((ny, nx))
        if n > best_n:
            best, best_n = cur, n
    fg = lab == best
    # 兩腿／兩靴之間被圍起來的白底（不與邊緣連通）也是背景：只處理畫面最下方 140 列（腿與靴子，沒有白色衣物）
    try:
        from scipy import ndimage

        enc, n_enc = ndimage.label(bgish & fg)
        for i in range(1, n_enc + 1):
            m = enc == i
            rows = np.nonzero(m)[0]
            if m.sum() >= 60 and rows.min() > H - 140:
                fg[m] = False
    except ImportError:
        pass
    return fg


def classify(img, gender):
    h, s, v = rgb2hsv(img)
    cls = {}
    cls["skin"] = (h >= 8) & (h <= 38) & (s >= 0.06) & (s <= 0.34) & (v >= 0.84)
    cls["white"] = (s < 0.09) & (v > 0.86)
    cls["blue"] = (h >= 205) & (h <= 245) & (s > 0.35) & (v > 0.3)
    cls["gold"] = (h >= 36) & (h <= 58) & (s > 0.4) & (v > 0.62)
    cls["purple"] = (h >= 255) & (h <= 300) & (s > 0.2) & (v > 0.3)
    cls["pink"] = ((h >= 315) | (h <= 6)) & (s > 0.1) & (s < 0.45) & (v > 0.8)
    if gender == "male":
        cls["hair"] = (h >= 12) & (h <= 32) & (s > 0.42) & (v > 0.38) & (v < 0.97)
        cls["leather"] = cls["hair"].copy()  # 皮革與頭髮同色系 → 依位置區分（頭部以下 = 皮革）
        cls["dark"] = (s < 0.25) & (v > 0.2) & (v < 0.5)  # 深灰短褲
    else:
        cls["hair"] = ((h >= 352) | (h <= 16)) & (s > 0.3) & (s < 0.72) & (v > 0.5) & (v < 0.92)
        cls["leather"] = (h >= 12) & (h <= 34) & (s > 0.45) & (v > 0.25) & (v < 0.75)
    return cls


def rows_profile(mask):
    ys = np.nonzero(mask.any(1))[0]
    prof = []
    for y in range(ys.min(), ys.max() + 1):
        xs = np.nonzero(mask[y])[0]
        prof.append((int(y), int(xs.min()) if len(xs) else -1, int(xs.max()) if len(xs) else -1, int(len(xs))))
    return prof


def main(male_path, female_path, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    result = {}
    for gender, path in (("male", male_path), ("female", female_path)):
        sheet = np.asarray(Image.open(path).convert("RGB"))
        g = {}
        for view, (x0, y0, x1, y1) in PANELS[gender].items():
            img = sheet[y0:y1, x0:x1]
            sil = silhouette(img)
            cls = classify(img, gender)
            ys = np.nonzero(sil.any(1))[0]
            xs = np.nonzero(sil.any(0))[0]
            top, bot = int(ys.min()), int(ys.max())
            g[view] = {
                "panel": [x0, y0, x1, y1],
                "top": top + y0,
                "bottom": bot + y0,
                "left": int(xs.min()) + x0,
                "right": int(xs.max()) + x0,
                "height_px": bot - top + 1,
                "rows": [(y + y0, a + x0, b + x0, n) for (y, a, b, n) in rows_profile(sil)],
                "areas": {k: int((m & sil).sum()) for k, m in cls.items()},
            }
            np.save(out / f"sil_{gender}_{view}.npy", sil)
            for k, m in cls.items():
                np.save(out / f"cls_{gender}_{view}_{k}.npy", m & sil)
        result[gender] = g
        print(gender, {v: (d["top"], d["bottom"], d["height_px"], d["left"], d["right"]) for v, d in g.items()})
    (out / "silhouettes.json").write_text(json.dumps(result))


if __name__ == "__main__" and not (len(sys.argv) > 4 and sys.argv[4] == "--report"):
    main(*sys.argv[1:4])


# ============================================================== 人工標註點（依 3 倍、2 倍、1.4 倍格線放大圖讀取；設定圖像素座標）
# y：由上往下；x：由左往右。正面圖的「角色右邊」在畫面左邊。
LANDMARKS = {
    "male": {
        "front": {
            "hair_top": 105, "sole": 697, "center_x": 229, "hair_bottom": 365,
            "eye_r": (179, 311, 42, 45),  # 畫面左邊的眼睛（角色右眼）：中心 x, y, 寬, 高
            "eye_l": (275, 311, 44, 45),
            "lash_top": 285, "eye_bottom": 333, "brow": 268, "bangs_bottom": 290,
            "nose": (227, 335), "mouth": (226, 351, 28), "blush_y": 342, "blush_dx": 60,
            "face_l": 150, "face_r": 302, "cheek_y": 335, "chin": 368,
            "ear_r": (134, 330), "ear_l": (322, 330),
            "scarf": (375, 410, 162, 290), "shoulder_y": 422, "shoulder_l": 127, "shoulder_r": 325,
            "chest": (167, 285, 450), "belt": (480, 502), "buckle": (210, 250), "waist": (162, 292, 490),
            "glove_r": (118, 505, 67, 80), "glove_l": (333, 505, 67, 80), "cuff_top": 465,
            "pouch": (145, 497, 197, 547),
            "shorts_bottom": 590, "shorts": (160, 300), "hem_tip_y": 622, "hem_l": 117, "hem_r": 350,
            "knee": 600, "boot_top": 607, "boot_cuff": (607, 637), "boot_r": (132, 215), "boot_l": (247, 327),
            "boot_gem_y": 622,
        },
        "side": {
            "nose": (457, 329), "chin": (471, 371), "eye": (491, 304), "ear": (575, 329),
            "hair_front": 418, "hair_back": 714, "torso_front": 500, "torso_back": 571, "torso_y": 450,
            "buckle_front": 468, "scarf_tail": (686, 564), "glove": (514, 471, 571, 521),
            "toe": 464, "heel": 582, "sole": 693,
        },
    },
    "female": {
        "front": {
            "hair_top": 93, "sole": 679, "center_x": 222, "hair_bottom": 380,
            "eye_r": (169, 287, 48, 47),
            "eye_l": (268, 287, 51, 47),
            "lash_top": 262, "eye_bottom": 310, "brow": 252, "bangs_bottom": 278,
            "nose": (218, 312), "mouth": (220, 328, 30), "blush_y": 318, "blush_dx": 62,
            "face_l": 148, "face_r": 303, "cheek_y": 315, "chin": 348,
            "ear_l": (327, 298),
            "choker_y": 357, "shoulder_y": 387, "shoulder_l": 155, "shoulder_r": 287,
            "chest": (175, 270, 400), "belt": (427, 447), "buckle": (200, 232), "waist": (172, 275, 437),
            "armband": (397, 420),
            "glove_r": (113, 470, 73, 73), "glove_l": (326, 470, 73, 73), "fingers_y": (485, 505),
            "skirt_bottom": 517, "petticoat": (157, 277), "overskirt_tip_y": 597, "hem_l": 62, "hem_r": 370,
            "boot_top": 585, "boot_cuff": (585, 610), "boot_r": (162, 220), "boot_l": (225, 285),
            "bow_star": (320, 162),
        },
        "side": {
            "nose": (479, 325), "chin": (504, 350), "eye": (526, 286), "ear": (601, 300),
            "hair_front": 460, "hair_back": 747, "ponytail_back": 776, "torso_front": 511, "torso_back": 594, "torso_y": 430,
            "skirt_front": 469, "overskirt_tip": (697, 550), "bow": (672, 147),
            "toe": 508, "heel": 604, "sole": 675,
        },
    },
}

MODEL_HEIGHT = 1.25  # 男生（含頭髮）總高，公尺；女生用同一比例尺（下巴到腳底與男生相同）


def proportions():
    """把標註換算成公尺（腳底 = 0，正面中心 = 0）與比例；男女用同一比例尺"""
    m = LANDMARKS["male"]["front"]
    px = MODEL_HEIGHT / (m["sole"] - m["hair_top"] + 1)
    out = {"px_to_m": px}
    for g in ("male", "female"):
        F = LANDMARKS[g]["front"]
        Sd = LANDMARKS[g]["side"]
        z = lambda y: round((F["sole"] - y) * px, 3)  # noqa: E731
        wx = lambda a, b: round(abs(b - a) * px, 3)  # noqa: E731
        head = F["chin"] - F["hair_top"]
        r = {
            "total_height": z(F["hair_top"]),
            "chin_to_sole": z(F["chin"]),
            "heads_incl_hair": round((F["sole"] - F["hair_top"]) / head, 2),
            "eye_z": z(F["eye_r"][1]),
            "eye_size": [round(F["eye_r"][2] * px, 3), round(F["eye_r"][3] * px, 3)],
            "eye_spacing": wx(F["eye_r"][0], F["eye_l"][0]),
            "eye_height_in_face": round((F["chin"] - F["eye_r"][1]) / (F["chin"] - F["brow"]), 2),
            "mouth_z": z(F["mouth"][1]),
            "mouth_width": round(F["mouth"][2] * px, 3),
            "nose_z": z(F["nose"][1]),
            "brow_z": z(F["brow"]),
            "bangs_bottom_z": z(F["bangs_bottom"]),
            "face_width": wx(F["face_l"], F["face_r"]),
            "chin_z": z(F["chin"]),
            "shoulder_z": z(F["shoulder_y"]),
            "shoulder_width": wx(F["shoulder_l"], F["shoulder_r"]),
            "chest_width": wx(F["chest"][0], F["chest"][1]),
            "waist_width": wx(F["waist"][0], F["waist"][1]),
            "belt_z": z((F["belt"][0] + F["belt"][1]) / 2),
            "glove_center_z": z(F["glove_r"][1]),
            "glove_size": [round(F["glove_r"][2] * px, 3), round(F["glove_r"][3] * px, 3)],
            "glove_spread": wx(F["glove_r"][0], F["glove_l"][0]),
            "boot_top_z": z(F["boot_top"]),
            "boot_width": wx(F["boot_r"][0], F["boot_r"][1]),
            "feet_spacing": wx((F["boot_r"][0] + F["boot_r"][1]) / 2, (F["boot_l"][0] + F["boot_l"][1]) / 2),
            "foot_length": wx(Sd["toe"], Sd["heel"]),
            "head_depth_with_hair": wx(Sd["hair_front"], Sd["hair_back"]),
            "face_profile_nose_to_ear": wx(Sd["nose"][0], Sd["ear"][0]),
            "torso_depth": wx(Sd["torso_front"], Sd["torso_back"]),
            "ear_z": z(Sd["ear"][1]),
        }
        if g == "male":
            r["shorts_bottom_z"] = z(F["shorts_bottom"])
            r["tabard_tip_z"] = z(F["hem_tip_y"])
            r["tabard_span"] = wx(F["hem_l"], F["hem_r"])
        else:
            r["skirt_bottom_z"] = z(F["skirt_bottom"])
            r["overskirt_tip_z"] = z(F["overskirt_tip_y"])
            r["overskirt_span"] = wx(F["hem_l"], F["hem_r"])
            r["bow_z"] = z(F["bow_star"][1])
        out[g] = r
    return out


def hair_metrics(sil_dir):
    """頭部區（頭頂到下巴）的最大寬度、髮量（正面頭髮像素 ÷ 臉部皮膚像素）"""
    p = proportions()
    px = p["px_to_m"]
    out = {}
    for g in ("male", "female"):
        F = LANDMARKS[g]["front"]
        x0, y0, _, _ = PANELS[g]["front"]
        sil = np.load(Path(sil_dir) / f"sil_{g}_front.npy")
        hair = np.load(Path(sil_dir) / f"cls_{g}_front_hair.npy")
        skin = np.load(Path(sil_dir) / f"cls_{g}_front_skin.npy")
        a, b = F["hair_top"] - y0, F["chin"] - y0
        spans = [(np.nonzero(sil[y])[0].max() - np.nonzero(sil[y])[0].min() + 1) for y in range(a, b) if sil[y].any()]
        hs = hair[a:b].sum()
        sk = skin[a:b].sum()
        sd = LANDMARKS[g]["side"]
        side_sil = np.load(Path(sil_dir) / f"sil_{g}_side.npy")
        sx0, sy0, _, _ = PANELS[g]["side"]
        out[g] = {
            "head_max_width": round(max(spans) * px, 3),
            "head_max_width_over_face": round(max(spans) / (F["face_r"] - F["face_l"]), 2),
            "hair_px_over_face_px_front": round(float(hs) / max(1, float(sk)), 2),
        }
        # 頭髮最低點（正面，排除下巴以下的皮革）：只看頭部附近的行
        # 頭髮最低點：皮革與頭髮同色系，自動判斷不可靠 → 用人工標註
        out[g]["hair_lowest_z_front"] = round((F["sole"] - F["hair_bottom"]) * px, 3)
        del sd, side_sil, sx0, sy0
    return out


def annotate(male_path, female_path, sil_dir, out):
    from PIL import ImageDraw, ImageFont

    font = None
    for f in ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"):
        try:
            font = ImageFont.truetype(f, 15)
            small = ImageFont.truetype(f, 12)
            break
        except OSError:
            continue
    p = proportions()
    for g, path in (("male", male_path), ("female", female_path)):
        im = Image.open(path).convert("RGB")
        S = 2
        im = im.resize((im.width * S, im.height * S), Image.LANCZOS)
        d = ImageDraw.Draw(im, "RGBA")
        # 輪廓（粉紅）
        for view, (x0, y0, x1, y1) in PANELS[g].items():
            sil = np.load(Path(sil_dir) / f"sil_{g}_{view}.npy")
            edge = sil & ~(np.roll(sil, 1, 0) & np.roll(sil, -1, 0) & np.roll(sil, 1, 1) & np.roll(sil, -1, 1))
            ys, xs = np.nonzero(edge)
            for y, x in zip(ys, xs):
                d.rectangle([(x + x0) * S, (y + y0) * S, (x + x0) * S + 1, (y + y0) * S + 1], fill=(255, 0, 160, 255))
        F = LANDMARKS[g]["front"]
        Sd = LANDMARKS[g]["side"]
        r = p[g]
        fx0, _, fx1, _ = PANELS[g]["front"]
        sx0, _, sx1, _ = PANELS[g]["side"]
        bx0, _, bx1, _ = PANELS[g]["back"]

        labels = []

        def hline(y, label, color=(0, 120, 255), x_from=fx0, x_to=bx1):
            d.line([(x_from * S, y * S), (x_to * S, y * S)], fill=color + (170,), width=2)
            labels.append((y, label, color))

        lines = [
            (F["hair_top"], f"頭髮頂 {r['total_height']} m", (120, 60, 20)),
            (F["brow"], f"眉 {r['brow_z']}", (90, 90, 90)),
            (F["eye_r"][1], f"眼睛中心 {r['eye_z']}", (0, 90, 220)),
            (F["mouth"][1], f"嘴 {r['mouth_z']}", (200, 60, 60)),
            (F["chin"], f"下巴 {r['chin_z']}", (220, 0, 120)),
            (F["shoulder_y"], f"肩 {r['shoulder_z']}", (0, 150, 90)),
            ((F["belt"][0] + F["belt"][1]) / 2, f"腰帶 {r['belt_z']}", (150, 90, 20)),
            (F["glove_r"][1], f"手（中心）{r['glove_center_z']}", (150, 90, 20)),
            (F["boot_top"], f"靴口 {r['boot_top_z']}", (120, 70, 30)),
            (F["sole"], "腳底 0", (60, 60, 60)),
        ]
        if g == "male":
            lines.insert(8, (F["shorts_bottom"], f"短褲下緣 {r['shorts_bottom_z']}", (80, 80, 90)))
        else:
            lines.insert(8, (F["skirt_bottom"], f"白裙下緣 {r['skirt_bottom_z']}", (200, 100, 150)))
        for y, label, c in lines:
            hline(y, label, c)
        # 臉部框：眼睛、嘴、臉寬
        for e in ("eye_r", "eye_l"):
            cx, cy, w, h = F[e]
            d.rectangle([(cx - w / 2) * S, (cy - h / 2) * S, (cx + w / 2) * S, (cy + h / 2) * S], outline=(0, 90, 220, 255), width=3)
        mx, my, mw = F["mouth"]
        d.rectangle([(mx - mw / 2) * S, (my - 4) * S, (mx + mw / 2) * S, (my + 4) * S], outline=(200, 60, 60, 255), width=2)
        d.line([(F["face_l"] * S, F["cheek_y"] * S), (F["face_r"] * S, F["cheek_y"] * S)], fill=(220, 0, 120, 220), width=3)
        for e in ("glove_r", "glove_l"):
            cx, cy, w, h = F[e]
            d.rectangle([(cx - w / 2) * S, (cy - h / 2) * S, (cx + w / 2) * S, (cy + h / 2) * S], outline=(150, 90, 20, 255), width=3)
        for e in ("boot_r", "boot_l"):
            a, b = F[e]
            d.rectangle([a * S, F["boot_top"] * S, b * S, F["sole"] * S], outline=(120, 70, 30, 255), width=3)
        # 中心線
        d.line([(F["center_x"] * S, F["hair_top"] * S), (F["center_x"] * S, F["sole"] * S)], fill=(0, 0, 0, 90), width=1)
        # 側面：臉前緣、耳朵、腳長
        d.ellipse([(Sd["ear"][0] - 8) * S, (Sd["ear"][1] - 8) * S, (Sd["ear"][0] + 8) * S, (Sd["ear"][1] + 8) * S], outline=(220, 0, 120, 255), width=3)
        d.line([(Sd["toe"] * S, (Sd["sole"] + 4) * S), (Sd["heel"] * S, (Sd["sole"] + 4) * S)], fill=(120, 70, 30, 255), width=4)
        d.line([(Sd["torso_front"] * S, Sd["torso_y"] * S), (Sd["torso_back"] * S, Sd["torso_y"] * S)], fill=(0, 150, 90, 255), width=3)
        d.line([(Sd["hair_front"] * S, (Sd["ear"][1] - 30) * S), (Sd["hair_back"] * S, (Sd["ear"][1] - 30) * S)], fill=(120, 60, 20, 255), width=3)
        title = "男性初心者" if g == "male" else "女性初心者"
        top, bottom = 60, 715
        crop = im.crop((fx0 * S, top * S, (bx1 + 4) * S, bottom * S))
        col = 330
        canvas = Image.new("RGB", (crop.width + col, crop.height + 60), (255, 255, 255))
        canvas.paste(crop, (0, 60))
        cd = ImageDraw.Draw(canvas)
        big = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 30)
        lab = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 24)
        cd.text((16, 10), f"{title}：設定圖量測　粉紅＝輪廓　橫線＝高度（公尺，男生總高 1.25 m 換算）　框＝眼睛／嘴／手／靴", fill=(40, 40, 60), font=big)
        last = -99
        for y, label, c in sorted(labels):
            yy = (y - top) * S + 60
            ty = max(yy - 14, last + 28)
            cd.line([(crop.width, yy), (crop.width + 14, ty + 14)], fill=c, width=2)
            cd.text((crop.width + 18, ty), label, fill=c, font=lab)
            last = ty
        canvas = canvas.resize((canvas.width // 2, canvas.height // 2), Image.LANCZOS)
        canvas.save(Path(out) / f"annot_{g}.png")


if __name__ == "__main__" and len(sys.argv) > 4 and sys.argv[4] == "--report":
    main(*sys.argv[1:4])
    annotate(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[3])
    rep = {"proportions": proportions(), "hair": hair_metrics(sys.argv[3]), "landmarks": LANDMARKS}
    (Path(sys.argv[3]) / "measurements.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1))
    print(json.dumps(rep["hair"], ensure_ascii=False))
