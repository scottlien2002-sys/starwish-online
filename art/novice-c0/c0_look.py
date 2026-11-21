"""
初心者 V2 — C0 臉部與材質預覽：配色、頂點色（髮束深淺、天使光環、裙襬漸層）、臉部貼圖（眼睛、眉毛、嘴巴、腮紅）。
B.2 灰模造型完全沿用（art/novice-v2/novice_shapes.py），這裡只決定「顏色」。
顏色取自原始設定圖取樣，再依觀感微調（設定圖本身有手繪陰影，取樣值偏暗或偏亮處用中間調）。
"""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def hx(s):
    s = s.lstrip("#")
    return np.array([int(s[i:i + 2], 16) for i in (0, 2, 4)], float) / 255.0


# ---------------------------------------------------------------- 配色（sRGB）
PALETTE = {
    "male": {
        "skin": "#fde4d2", "hair": "#b0603c", "hair_dark": "#7a3a22", "hair_light": "#e09060",
        "glove": "#8e4c2c", "rivet": "#e8b84a", "boot": "#8a4a26", "boot_gem": "#e8b84a",
        "shirt": "#f6f3ee", "sleeve_trim": "#e3b048", "vest": "#2e4aa6", "vest_trim": "#e3b048",
        "lace": "#7a4122", "scarf": "#3a62d8", "belt": "#8b4a28", "buckle": "#e8bc4c",
        "pouch": "#8d4a24", "shorts": "#6a5560", "tabard": "#2a4aaa", "tabard_trim": "#e3b048",
        "tabard_star": "#f2c850",
    },
    "female": {
        "skin": "#fde3d4", "hair": "#e08478", "hair_dark": "#b65a58", "hair_light": "#f8b4a4",
        "glove": "#8a4a3a", "boot": "#8a4a2a", "boot_strap": "#e3b048", "ponytail": "#e08478",
        "bow": "#7c40c0", "bow_star": "#f2c850", "blouse": "#fbf6f4", "armband": "#8a4a2a",
        "choker": "#7a3a22", "gems": "#6a50e0", "corset": "#8a4a2e", "belt": "#7a3e24",
        "buckle": "#e8bc4c", "front_panel": "#c79ad8", "petticoat": "#f6b6c4", "skirt_pink": "#fdf2ea",
        "bloomers": "#fff4ee", "overskirt": "#8a52b4", "overskirt_trim": "#e3b048",
        "overskirt_emblem": "#f2c850",
    },
}
# 材質（Principled／glTF PBR）：避免塑膠感與過度金屬反光——金屬件只給一點金屬度、較粗糙
SURFACE = {
    "skin": (0.0, 0.6), "hair": (0.0, 0.45), "cloth": (0.0, 0.75), "cloth2": (0.0, 0.7),
    "leather": (0.0, 0.55), "metal": (0.35, 0.38), "dark": (0.0, 0.75), "face": (0.0, 0.6),
}


def part_key(g, name):
    """零件名稱 → 配色表的鍵（左右件共用）"""
    n = name
    for suf in ("_l", "_r"):
        if n.endswith(suf):
            n = n[: -len(suf)]
    if n in ("head", "body", "hand"):
        return "skin"
    if n == "boot_gem":
        return "boot_gem"
    return n


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def albedo(g, name, P, N):
    """
    每個點的底色（sRGB，0～1）。P、N：(n,3) 位置與法線。
    - 頭髮：上亮下暗（髮束底面、內側較深）＋頭頂一圈柔和的「天使光環」＋女生髮尾稍亮
    - 外裙：上紫下淡（設定圖的漸層）；男生下擺：下緣稍深
    """
    pal = PALETTE[g]
    key = part_key(g, name)
    base = hx(pal.get(key, "#cccccc"))
    n = len(P)
    col = np.tile(base, (n, 1))
    if key in ("hair", "ponytail"):
        dark, light = hx(pal["hair_dark"]), hx(pal["hair_light"])
        up = np.clip(N[:, 2], -1, 1)
        t = smooth(-0.6, 0.7, up)  # 朝下 → 深、朝上 → 原色
        col = dark[None] * (1 - t[:, None]) + base[None] * t[:, None]
        # 天使光環：頭頂偏下的一圈，法線往外（水平、略往上）處
        zc = 1.0 if g == "male" else 0.985
        ring = np.exp(-((P[:, 2] - zc) / 0.03) ** 2) * smooth(-0.1, 0.4, up) * smooth(0.2, 0.7, np.hypot(N[:, 0], N[:, 1]))
        col = col * (1 - 0.55 * ring[:, None]) + light[None] * 0.55 * ring[:, None]
        if g == "female":
            tipz = smooth(0.82, 0.68, P[:, 2])  # 髮尾（下方）稍亮、偏粉
            col = col * (1 - 0.35 * tipz[:, None]) + light[None] * 0.35 * tipz[:, None]
    elif key == "overskirt":
        top, bot = hx("#7a44aa"), hx("#c890d0")
        t = smooth(0.48, 0.16, P[:, 2])
        col = top[None] * (1 - t[:, None]) + bot[None] * t[:, None]
    elif key == "skirt_pink":
        # 前裙：奶油白，下緣一段粉紅荷葉
        pinkc = hx("#f8c8d2")
        t = smooth(0.41, 0.375, P[:, 2]) * 0.6
        col = col * (1 - t[:, None]) + pinkc[None] * t[:, None]
    elif key == "tabard":
        t = smooth(0.4, 0.16, P[:, 2])
        col = col * (1 - 0.18 * t[:, None])
    elif key == "bow":
        # 蝴蝶結：圈的邊緣稍亮（布料反光），中間稍深
        col = col * (0.9 + 0.1 * smooth(0.0, 0.8, np.abs(N[:, 2]))[:, None])
    return np.clip(col, 0, 1)


# ---------------------------------------------------------------- 臉部貼圖
# 平面投影：u = (x + 0.25) / 0.5，v = (z - 0.6) / 0.5（v 往上）；整顆頭（含耳朵、脖子）都用這個投影，沒有接縫。
FACE_X0, FACE_Z0, FACE_SIZE = -0.25, 0.6, 0.5

FACE_SPEC = {
    # 依步驟 A 設定圖量測：眼睛中心高度、間距、大小；嘴巴高度
    "male": dict(eye_z=0.814, eye_dx=0.101, eye_w=0.092, eye_h=0.098, mouth_z=0.729,
                 iris_top="#1a4cb8", iris_bot="#62d4fb", pupil="#0d2560", ring="#0b2a70",
                 lash="#3a1f18", brow="#8a4630", brow_w=0.0075, blush=0.28, smile=0.032, lashes_extra=False),
    "female": dict(eye_z=0.826, eye_dx=0.1045, eye_w=0.104, eye_h=0.104, mouth_z=0.740,
                   iris_top="#b62a48", iris_bot="#ff9cac", pupil="#62102a", ring="#7a1430",
                   lash="#3a1a1c", brow="#b45a52", brow_w=0.006, blush=0.42, smile=0.026, lashes_extra=True),
}


def uv_of(P):
    u = (P[:, 0] - FACE_X0) / FACE_SIZE
    v = (P[:, 2] - FACE_Z0) / FACE_SIZE
    return np.stack([u, v], 1)


def face_texture(g, size=2048, ss=2):
    """日系動畫風臉部貼圖（膚色底＋眼睛、眉毛、嘴巴、腮紅）。回傳 PIL RGB。"""
    S = size * ss
    sp = FACE_SPEC[g]
    skin = tuple(int(c * 255) for c in hx(PALETTE[g]["skin"]))
    img = Image.new("RGB", (S, S), skin)
    px = S / FACE_SIZE

    def X(x):
        return (x - FACE_X0) * px

    def Y(z):
        return (FACE_Z0 + FACE_SIZE - z) * px

    def C(h):
        return tuple(int(c * 255) for c in hx(h))

    # 腮紅（模糊的粉紅橢圓）
    bl = Image.new("L", (S, S), 0)
    db = ImageDraw.Draw(bl)
    for sx in (1, -1):
        cx, cz = X(sx * (sp["eye_dx"] + 0.022)), Y(sp["eye_z"] - 0.07)
        rw, rh = 0.034 * px, 0.017 * px
        db.ellipse((cx - rw, cz - rh, cx + rw, cz + rh), fill=int(255 * sp["blush"]))
    bl = bl.filter(ImageFilter.GaussianBlur(0.012 * px))
    pink = Image.new("RGB", (S, S), C("#ff8f9a"))
    img = Image.composite(pink, img, bl)
    d = ImageDraw.Draw(img)
    if g == "female":
        # 設定圖腮紅上的三條小斜線
        for sx in (1, -1):
            cx, cz = X(sx * (sp["eye_dx"] + 0.022)), Y(sp["eye_z"] - 0.07)
            for k in (-1, 0, 1):
                x0 = cx + k * 0.011 * px
                d.line((x0 - 0.004 * px, cz + 0.006 * px, x0 + 0.004 * px, cz - 0.006 * px), fill=C("#f07080"), width=max(2, int(0.0016 * px)))

    a = np.asarray(img).astype(float) / 255.0

    def patch(x0, y0, x1, y1):
        x0, y0 = max(int(x0), 0), max(int(y0), 0)
        x1, y1 = min(int(x1), S), min(int(y1), S)
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(float)
        return (slice(y0, y1), slice(x0, x1)), xx, yy

    def ell(xx, yy, cx, cz, rx, rz, soft=1.5):
        dd = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cz) / rz) ** 2)
        return np.clip((1 - dd) * min(rx, rz) / soft, 0, 1)

    def put(sl, mask, color, alpha=1.0):
        m = np.clip(mask, 0, 1)[..., None] * alpha
        a[sl] = a[sl] * (1 - m) + np.asarray(color, float)[None, None] * m

    for side in (1, -1):  # side = 角色左(+x)、右(-x)
        ex, ez = X(side * sp["eye_dx"]), Y(sp["eye_z"])
        w, h = sp["eye_w"] * px, sp["eye_h"] * px
        outer = side  # 外眼角在螢幕上的方向
        sl, xx, yy = patch(ex - 0.9 * w, ez - 1.1 * h, ex + 0.9 * w, ez + 0.75 * h)
        # 上眼線（睫毛）的曲線：外眼角較低、往外翹；眼睛內容只畫在這條線下面
        def lid_y(x):
            t = (x - ex) / (0.53 * w)
            return ez - 0.43 * h + 0.12 * h * t * t + 0.03 * h * t * outer
        below = np.clip((yy - lid_y(xx)) / 2.0, 0, 1)
        # 眼白
        sclera = ell(xx, yy, ex, ez + 0.02 * h, 0.52 * w, 0.48 * h) * below
        put(sl, sclera, hx("#ffffff"))
        # 虹膜（大、上深下淺）
        icx, icz, irx, irz = ex - 0.03 * w * outer, ez + 0.03 * h, 0.4 * w, 0.48 * h
        iris = ell(xx, yy, icx, icz, irx, irz) * below
        t = np.clip((yy - (icz - irz)) / (2 * irz), 0, 1)[..., None]
        grad = hx(sp["iris_top"])[None, None] * (1 - t) + hx(sp["iris_bot"])[None, None] * t
        m = iris[..., None]
        a[sl] = a[sl] * (1 - m) + grad * m
        ringm = np.clip(iris - ell(xx, yy, icx, icz, irx * 0.9, irz * 0.92, 1.0) * below, 0, 1)
        put(sl, ringm, hx(sp["ring"]), 0.85)
        put(sl, ell(xx, yy, icx, icz - 0.04 * h, 0.18 * w, 0.25 * h) * below, hx(sp["pupil"]), 0.95)
        shade = np.clip((lid_y(xx) + 0.28 * h - yy) / (0.22 * h), 0, 1) * iris
        put(sl, shade, hx(sp["pupil"]), 0.5)
        put(sl, ell(xx, yy, icx, icz + 0.32 * h, 0.25 * w, 0.1 * h) * iris, hx("#ffffff"), 0.35)
        # 高光（光從左上；兩眼方向一致）
        put(sl, ell(xx, yy, icx - 0.15 * w, ez - 0.12 * h, 0.13 * w, 0.15 * h, 0.8) * below, hx("#ffffff"))
        put(sl, ell(xx, yy, icx + 0.16 * w, ez + 0.22 * h, 0.06 * w, 0.06 * h, 0.8), hx("#ffffff"))
        put(sl, ell(xx, yy, icx + 0.04 * w, ez - 0.22 * h, 0.035 * w, 0.035 * h, 0.8) * below, hx("#ffffff"), 0.9)
        # 上睫毛：沿眼線的粗線，中間最粗、外眼角加粗並往外上翹
        ly = lid_y(xx)
        tpos = (xx - ex) / (0.53 * w)
        to = tpos * outer  # -1 = 內眼角、+1 = 外眼角
        thick = h * (0.045 + 0.07 * np.clip((to + 0.3) / 1.3, 0, 1)) * np.clip((to + 1.08) / 0.45, 0, 1)
        lash = np.clip((thick - np.abs(yy - (ly - thick * 0.45))) / 2.0, 0, 1) * (np.abs(tpos) < 1.12)
        for dx, dz in (((0.2, -0.1), (0.12, -0.2)) if sp["lashes_extra"] else ((0.17, -0.1),)):
            ox, oz = ex + outer * 0.5 * w, lid_y(ex + outer * 0.5 * w) - 0.05 * h
            for s_ in np.linspace(0, 1, 14):
                lash = np.maximum(lash, ell(xx, yy, ox + outer * dx * w * s_, oz + dz * h * s_, 0.06 * h * (1 - 0.75 * s_), 0.045 * h * (1 - 0.75 * s_), 1.2))
        put(sl, lash, hx(sp["lash"]))
        # 下睫毛：外側短短一段
        lo = np.zeros_like(xx)
        for s_ in np.linspace(0, 1, 12):
            lo = np.maximum(lo, ell(xx, yy, ex + outer * (0.22 + 0.24 * s_) * w, ez + 0.45 * h - 0.12 * h * s_ * s_, 0.022 * h, 0.011 * h, 1.0))
        put(sl, lo, hx(sp["lash"]), 0.55)
        # 眉毛
        br = np.zeros_like(xx)
        for s_ in np.linspace(0, 1, 26):
            x = ex + (s_ - 0.5) * 0.9 * w
            z = ez - 0.8 * h - 0.07 * h * math.sin(s_ * math.pi) + 0.07 * h * (s_ if outer > 0 else 1 - s_)
            r = sp["brow_w"] * px * (0.6 + 0.6 * math.sin(s_ * math.pi))
            br = np.maximum(br, ell(xx, yy, x, z, r * 1.6, r, 1.2))
        put(sl, br, hx(sp["brow"]), 0.9)
    # 嘴巴：小小的微笑弧
    mw = sp["smile"] * px
    sl, xx, yy = patch(X(0) - mw, Y(sp["mouth_z"]) - 0.02 * px, X(0) + mw, Y(sp["mouth_z"]) + 0.02 * px)
    mo = np.zeros_like(xx)
    for s_ in np.linspace(-1, 1, 40):
        mo = np.maximum(mo, ell(xx, yy, X(0) + s_ * mw / 2, Y(sp["mouth_z"]) + 0.006 * px * (1 - s_ * s_), 0.0024 * px, 0.0017 * px, 1.0))
    put(sl, mo, hx("#9a3a3a"), 0.9)
    out = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    return out.resize((size, size), Image.LANCZOS)


def face_lookup(tex_arr, P):
    """本機預覽用：依平面投影取臉部貼圖顏色"""
    uv = uv_of(P)
    S = tex_arr.shape[0]
    xi = np.clip((uv[:, 0] * S).astype(int), 0, S - 1)
    yi = np.clip(((1 - uv[:, 1]) * S).astype(int), 0, S - 1)
    return tex_arr[yi, xi, :3] / 255.0


if __name__ == "__main__":
    import sys

    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp"
    for g in ("male", "female"):
        face_texture(g).save(f"{out}/c0_face_{g}.png")
