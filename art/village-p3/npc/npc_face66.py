"""Stage 6.6 星芽村 NPC 臉部貼圖（每位 NPC 自己的五官，不再共用同一張臉只換虹膜顏色）。

座標與 A 的初心者頭部 UV 相同（平面投影 u=(x+0.25)/0.5、v=(z-0.6)/0.5）→ 可直接貼在 A 的頭部網格上（唯讀使用，不改 A 的檔案）。
每位 NPC 的設定：膚色、眼睛（位置、大小、眼角上揚／下垂、眼皮厚重度、睫毛）、虹膜三色、眉毛（粗細、角度、弧度、顏色）、
嘴型（微笑、咧嘴、單邊笑、小嘴、張口笑）、腮紅、雀斑、魚尾紋、法令紋、小傷疤、淚痣、鼻樑陰影、小丑彩繪。
也輸出「閉眼」用的眼皮資訊（eyes：每隻眼睛的位置與大小），給眨眼網格使用。
"""
import math

import numpy as np
from PIL import Image, ImageFilter

FACE_X0, FACE_Z0, FACE_SIZE = -0.25, 0.6, 0.5


def hx(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], float)


BASE = {
    "male": dict(eye_z=0.814, eye_dx=0.101, eye_w=0.092, eye_h=0.098, mouth_z=0.729, lash_extra=False),
    "female": dict(eye_z=0.826, eye_dx=0.1045, eye_w=0.104, eye_h=0.104, mouth_z=0.740, lash_extra=True),
}

# 每位 NPC：相對於基本值的變化（tilt＋＝外眼角上揚；lid＝上眼皮下垂比例；brow_ang＋＝眉頭壓低（嚴肅））
FACES = {
    "swordmaster": dict(skin="#f4d2b6", eye_w=0.92, eye_h=0.82, tilt=0.16, lid=0.12, lash="#2a1412", brow="#5a1610", brow_w=0.0098, brow_ang=9, brow_arch=0.4, brow_len=1.0,
                        mouth="smirk", mouth_w=0.03, blush=0.1, scar=True, nose=0.5),
    "knight": dict(skin="#f6dcc6", eye_w=0.95, eye_h=0.9, tilt=0.06, lid=0.06, lash="#3a2410", brow="#8a6424", brow_w=0.0088, brow_ang=4, brow_arch=0.6, brow_len=1.05,
                   mouth="smile", mouth_w=0.034, blush=0.12, nose=0.45),
    "smith": dict(skin="#e8bc98", eye_w=0.86, eye_h=0.74, tilt=-0.06, lid=0.2, lash="#2a160c", brow="#5a3018", brow_w=0.0125, brow_ang=-2, brow_arch=0.9, brow_len=1.15,
                  mouth="grin", mouth_w=0.04, blush=0.22, crow=True, nose=0.7, z_eye=-0.004),
    "mage": dict(skin="#fbe6da", eye_w=1.0, eye_h=0.95, tilt=0.2, lid=0.1, lash="#2a1630", brow="#8a7aa8", brow_w=0.0055, brow_ang=1, brow_arch=0.8, brow_len=0.95,
                 mouth="small", mouth_w=0.022, blush=0.28, mole=True, nose=0.25, lash_extra=True),
    "priest": dict(skin="#fde9de", eye_w=1.02, eye_h=1.04, tilt=-0.14, lid=0.04, lash="#4a3020", brow="#c4a070", brow_w=0.0052, brow_ang=-5, brow_arch=0.7, brow_len=0.9,
                   mouth="smile", mouth_w=0.026, blush=0.42, nose=0.2, lash_extra=True),
    "clown": dict(skin="#fde2cc", eye_w=1.06, eye_h=1.06, tilt=0.0, lid=0.0, lash="#2a1a12", brow="#c05818", brow_w=0.0085, brow_ang=-8, brow_arch=1.4, brow_len=1.0,
                  mouth="open", mouth_w=0.04, blush=0.5, clown=True, nose=0.0, z_brow=0.008),
    "warehouse": dict(skin="#f9dcc4", eye_w=0.98, eye_h=1.0, tilt=-0.04, lid=0.02, lash="#3a2412", brow="#6a4224", brow_w=0.0065, brow_ang=-3, brow_arch=0.6, brow_len=0.95,
                      mouth="smile", mouth_w=0.03, blush=0.38, freckles=True, nose=0.3, lash_extra=True),
    "guild": dict(skin="#f2d6c2", eye_w=0.9, eye_h=0.7, tilt=0.02, lid=0.26, lash="#18141a", brow="#1e1a20", brow_w=0.0085, brow_ang=2, brow_arch=1.2, brow_len=1.05,
                  mouth="smirk", mouth_w=0.03, blush=0.08, crow=True, laugh=True, nose=0.55),
    # 寵物商人洛恩（年輕、帥氣、親切）：琥珀眼、溫和下垂眼角、柔和眉、親切微笑
    "merchant": dict(skin="#fbe2cf", eye_w=0.98, eye_h=0.94, tilt=-0.05, lid=0.05, lash="#2a1810", brow="#5e3a22", brow_w=0.0075, brow_ang=-3, brow_arch=0.7, brow_len=1.0,
                     mouth="smile", mouth_w=0.032, blush=0.2, nose=0.35),
}

# 頭部輪廓微調（以 A 的頭部為底；只改比例、不改拓撲與 UV）：jaw＝下顎寬、chin＝下巴長、cheek＝臉頰飽滿、width＝整體寬
SHAPES = {
    "swordmaster": dict(jaw=0.05, chin=0.03, cheek=-0.02, width=0.0),
    "knight": dict(jaw=0.07, chin=0.04, cheek=-0.01, width=0.01),
    "smith": dict(jaw=0.1, chin=-0.01, cheek=0.03, width=0.04),
    "mage": dict(jaw=-0.06, chin=0.03, cheek=-0.03, width=-0.02),
    "priest": dict(jaw=-0.04, chin=0.0, cheek=0.02, width=-0.01),
    "clown": dict(jaw=-0.02, chin=-0.02, cheek=0.06, width=0.03),
    "warehouse": dict(jaw=-0.03, chin=-0.01, cheek=0.04, width=0.0),
    "guild": dict(jaw=0.03, chin=0.05, cheek=-0.03, width=-0.01),
    "merchant": dict(jaw=0.02, chin=0.02, cheek=-0.02, width=0.0),
}


def spec(nid, g, iris):
    s = dict(BASE[g])
    f = FACES[nid]
    s.update({k: v for k, v in f.items() if k not in ("eye_w", "eye_h")})
    s["eye_w"] = BASE[g]["eye_w"] * f.get("eye_w", 1.0)
    s["eye_h"] = BASE[g]["eye_h"] * f.get("eye_h", 1.0)
    s["eye_z"] = BASE[g]["eye_z"] + f.get("z_eye", 0.0)
    s["iris"] = [np.asarray(c, float) for c in iris]
    return s


def eyes_info(nid, g):
    """眨眼網格用：每隻眼睛的中心 (x,z)、寬、高、眼皮線參數（模型座標，A 的頭部比例）"""
    s = spec(nid, g, ((0, 0, 0),) * 3)
    out = []
    for side in (1, -1):
        out.append({"x": side * s["eye_dx"], "z": s["eye_z"], "w": s["eye_w"], "h": s["eye_h"], "tilt": s.get("tilt", 0.0), "lid": s.get("lid", 0.0), "side": side,
                    "lash": list(hx(s["lash"])), "skin": list(hx(s["skin"]))})
    return out


def paint(nid, g, iris, size=2048, ss=2):
    s = spec(nid, g, iris)
    S = size * ss
    px = S / FACE_SIZE
    X = lambda x: (x - FACE_X0) * px  # noqa: E731
    Y = lambda z: (FACE_Z0 + FACE_SIZE - z) * px  # noqa: E731
    skin = hx(s["skin"])
    a = np.ones((S, S, 3)) * skin[None, None]
    # 臉部柔和陰影（顴骨下方、下巴、額頭邊緣）→ 立體感
    yy_all, xx_all = np.mgrid[0:S, 0:S].astype(np.float32)

    def put(sl, mask, color, alpha=1.0):
        m = np.clip(mask, 0, 1)[..., None] * alpha
        a[sl] = a[sl] * (1 - m) + np.asarray(color, float)[None, None] * m

    def patch(x0, y0, x1, y1):
        x0, y0 = max(int(x0), 0), max(int(y0), 0)
        x1, y1 = min(int(x1), S), min(int(y1), S)
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(float)
        return (slice(y0, y1), slice(x0, x1)), xx, yy

    def ell(xx, yy, cx, cz, rx, rz, soft=1.5):
        dd = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cz) / rz) ** 2)
        return np.clip((1 - dd) * min(rx, rz) / soft, 0, 1)

    def soft_blob(cx, cz, rx, rz, color, alpha):
        sl, xx, yy = patch(cx - 2 * rx, cz - 2 * rz, cx + 2 * rx, cz + 2 * rz)
        d = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cz) / rz) ** 2)
        put(sl, np.exp(-d * d * 1.6), color, alpha)

    shade = skin * np.array([0.86, 0.76, 0.74])
    for sx in (1, -1):
        soft_blob(X(sx * 0.135), Y(s["mouth_z"] + 0.02), 0.03 * px, 0.045 * px, shade, 0.22)
    # 鼻樑小陰影（日系：只有一點）
    if s.get("nose", 0) > 0:
        nz = (s["eye_z"] + s["mouth_z"]) / 2 - 0.004
        soft_blob(X(0.006), Y(nz), 0.006 * px, 0.009 * px, skin * np.array([0.78, 0.62, 0.58]), 0.55 * s["nose"])
    # 腮紅
    if s.get("blush", 0) > 0:
        bl = np.zeros((S, S), np.float32)
        for sx in (1, -1):
            cx, cz = X(sx * (s["eye_dx"] + 0.022)), Y(s["eye_z"] - 0.07)
            d = np.sqrt(((xx_all - cx) / (0.036 * px)) ** 2 + ((yy_all - cz) / (0.019 * px)) ** 2)
            bl = np.maximum(bl, np.exp(-d * d * 1.4))
        a[:] = a * (1 - bl[..., None] * s["blush"]) + hx("#ff8f9a")[None, None] * bl[..., None] * s["blush"]
    if s.get("freckles"):
        rng = np.random.default_rng(7)
        for sx in (1, -1):
            for _ in range(9):
                cx = X(sx * (s["eye_dx"] + rng.uniform(-0.025, 0.035)))
                cz = Y(s["eye_z"] - 0.06 + rng.uniform(-0.012, 0.014))
                r = rng.uniform(0.0018, 0.0028) * px
                sl, xx, yy = patch(cx - 2 * r, cz - 2 * r, cx + 2 * r, cz + 2 * r)
                put(sl, ell(xx, yy, cx, cz, r, r, 1.2), hx("#b8704a"), 0.55)
    if s.get("clown"):
        # 臉頰星星彩繪＋白色眼周
        for sx in (1, -1):
            cx, cz = X(sx * (s["eye_dx"] + 0.01)), Y(s["eye_z"] - 0.075)
            R = 0.024 * px
            sl, xx, yy = patch(cx - R * 1.2, cz - R * 1.2, cx + R * 1.2, cz + R * 1.2)
            ang = np.arctan2(yy - cz, xx - cx)
            rr = np.hypot(yy - cz, xx - cx)
            star = np.clip((R * (0.42 + 0.58 * ((np.cos(5 * (ang + np.pi / 2)) * 0.5 + 0.5) ** 2.2)) - rr) / 2.0, 0, 1)
            put(sl, star, hx("#4a6ef0"), 0.85)
    for side in (1, -1):
        ex, ez = X(side * s["eye_dx"]), Y(s["eye_z"])
        w, h = s["eye_w"] * px, s["eye_h"] * px
        outer = side
        tilt = s.get("tilt", 0.0)
        lidk = s.get("lid", 0.0)
        sl, xx, yy = patch(ex - 0.95 * w, ez - 1.3 * h, ex + 0.95 * w, ez + 0.8 * h)

        def lid_y(x):
            t = (x - ex) / (0.53 * w)
            return ez - 0.43 * h + lidk * 0.55 * h + 0.12 * h * t * t - tilt * h * t * outer * 0.9 + 0.03 * h * t * outer

        def low_y(x):
            t = np.clip((x - ex) / (0.52 * w), -1, 1)
            return ez + 0.48 * h * np.sqrt(np.clip(1 - t * t, 0, 1)) * 0.98 - tilt * h * t * outer * 0.35

        below = np.clip((yy - lid_y(xx)) / 2.0, 0, 1) * np.clip((low_y(xx) - yy) / 2.0, 0, 1)
        sclera = ell(xx, yy, ex, ez + 0.02 * h, 0.53 * w, 0.52 * h) * below
        put(sl, sclera, hx("#ffffff"))
        # 眼白上緣淡陰影（眼皮投影）
        put(sl, np.clip((lid_y(xx) + 0.16 * h - yy) / (0.16 * h), 0, 1) * sclera, hx("#c9c6d8"), 0.45)
        icx, icz = ex - 0.03 * w * outer, ez + 0.04 * h
        irx, irz = 0.4 * w, 0.47 * h
        iris = ell(xx, yy, icx, icz, irx, irz) * below
        dark, mid, light = s["iris"]
        t = np.clip((yy - (icz - irz)) / (2 * irz), 0, 1)[..., None]
        grad = np.where(t < 0.55, dark[None, None] + (mid - dark)[None, None] * (t / 0.55), mid[None, None] + (light - mid)[None, None] * ((t - 0.55) / 0.45))
        # 虹膜放射紋
        ang = np.arctan2(yy - icz, xx - icx)
        rays = (np.sin(ang * 22) * 0.5 + 0.5) * np.clip(np.hypot((xx - icx) / irx, (yy - icz) / irz) - 0.35, 0, 1)
        grad = grad * (1 - 0.12 * rays[..., None])
        m = iris[..., None]
        a[sl] = a[sl] * (1 - m) + grad * m
        ring = np.clip(iris - ell(xx, yy, icx, icz, irx * 0.88, irz * 0.9, 1.0) * below, 0, 1)
        put(sl, ring, dark * 0.6, 0.9)
        pr = 0.17 if s.get("tilt", 0) > 0.12 else 0.19
        put(sl, ell(xx, yy, icx, icz - 0.02 * h, pr * w, 0.24 * h) * below, dark * 0.35, 0.95)
        put(sl, np.clip((lid_y(xx) + 0.3 * h - yy) / (0.24 * h), 0, 1) * iris, dark * 0.5, 0.45)
        # 高光
        put(sl, ell(xx, yy, icx - 0.14 * w, ez - 0.1 * h + lidk * 0.4 * h, 0.12 * w, 0.14 * h, 0.8) * below, hx("#ffffff"))
        put(sl, ell(xx, yy, icx + 0.16 * w, ez + 0.24 * h, 0.055 * w, 0.055 * h, 0.8) * below, hx("#ffffff"), 0.9)
        # 上睫毛線
        ly = lid_y(xx)
        tpos = (xx - ex) / (0.53 * w)
        to = tpos * outer
        thick = h * (0.05 + 0.07 * np.clip((to + 0.3) / 1.3, 0, 1) + lidk * 0.03) * np.clip((to + 1.08) / 0.45, 0, 1)
        lash = np.clip((thick - np.abs(yy - (ly - thick * 0.45))) / 2.0, 0, 1) * (np.abs(tpos) < 1.12)
        extra = ((0.2, -0.1), (0.12, -0.2)) if s.get("lash_extra") else ((0.15, -0.08),)
        for dx, dz in extra:
            ox = ex + outer * 0.5 * w
            oz = lid_y(ox) - 0.05 * h
            for q in np.linspace(0, 1, 14):
                lash = np.maximum(lash, ell(xx, yy, ox + outer * dx * w * q, oz + dz * h * q, 0.06 * h * (1 - 0.75 * q), 0.045 * h * (1 - 0.75 * q), 1.2))
        put(sl, lash, hx(s["lash"]))
        # 雙眼皮線（細）
        put(sl, np.clip((0.012 * h - np.abs(yy - (ly - 0.17 * h))) / 1.5, 0, 1) * (np.abs(tpos) < 0.8), hx(s["lash"]) * 0.6 + skin * 0.4, 0.5)
        # 下睫毛
        lo = np.zeros_like(xx)
        for q in np.linspace(0, 1, 12):
            lo = np.maximum(lo, ell(xx, yy, ex + outer * (0.22 + 0.24 * q) * w, low_y(ex + outer * (0.22 + 0.24 * q) * w) - 0.02 * h, 0.022 * h, 0.012 * h, 1.0))
        put(sl, lo, hx(s["lash"]), 0.5)
        if s.get("crow"):
            for k in (-1, 0, 1):
                x0 = ex + outer * 0.62 * w
                z0 = ez + k * 0.16 * h
                L = 0.12 * w
                for q in np.linspace(0, 1, 10):
                    put(sl, ell(xx, yy, x0 + outer * L * q, z0 + k * 0.08 * h * q, 0.012 * h, 0.012 * h, 1.0), skin * 0.72, 0.5)
        # 眉毛
        br = np.zeros_like(xx)
        ang = s.get("brow_ang", 0)
        arch = s.get("brow_arch", 1.0)
        L = s.get("brow_len", 1.0)
        for q in np.linspace(0, 1, 30):
            x = ex + (q - 0.5) * 0.95 * w * L
            inner_t = (1 - q) if outer > 0 else q  # 1＝眉頭
            z = ez - 0.82 * h - s.get("z_brow", 0) * px - 0.08 * h * arch * math.sin(q * math.pi) + 0.06 * h * (q if outer > 0 else 1 - q) + ang * 0.012 * h * inner_t
            r = s["brow_w"] * px * (0.55 + 0.55 * math.sin(q * math.pi) * 0.7 + 0.35 * inner_t)
            br = np.maximum(br, ell(xx, yy, x, z, r * 1.6, r, 1.2))
        put(sl, br, hx(s["brow"]), 0.92)
    # 傷疤（劍士：左頰細斜線）
    if s.get("scar"):
        cx, cz = X(-(s["eye_dx"] + 0.03)), Y(s["eye_z"] - 0.058)
        sl, xx, yy = patch(cx - 0.03 * px, cz - 0.03 * px, cx + 0.03 * px, cz + 0.03 * px)
        sc = np.zeros_like(xx)
        for q in np.linspace(-1, 1, 30):
            sc = np.maximum(sc, ell(xx, yy, cx + q * 0.016 * px, cz + q * 0.006 * px, 0.0016 * px, 0.0016 * px, 1.0))
        put(sl, sc, skin * np.array([0.82, 0.62, 0.6]), 0.75)
    if s.get("mole"):
        cx, cz = X(-(s["eye_dx"] + 0.012)), Y(s["eye_z"] - 0.052)
        sl, xx, yy = patch(cx - 0.01 * px, cz - 0.01 * px, cx + 0.01 * px, cz + 0.01 * px)
        put(sl, ell(xx, yy, cx, cz, 0.0026 * px, 0.0026 * px, 1.0), hx("#5a3a3a"), 0.85)
    if s.get("laugh"):
        for sx in (1, -1):
            cx, cz = X(sx * 0.045), Y(s["mouth_z"] + 0.012)
            sl, xx, yy = patch(cx - 0.02 * px, cz - 0.03 * px, cx + 0.02 * px, cz + 0.03 * px)
            ln = np.zeros_like(xx)
            for q in np.linspace(0, 1, 16):
                ln = np.maximum(ln, ell(xx, yy, cx + sx * 0.008 * px * q, cz + (q - 0.5) * 0.026 * px, 0.0014 * px, 0.0014 * px, 1.0))
            put(sl, ln, skin * 0.78, 0.45)
    # 嘴
    mw = s["mouth_w"] * px
    mz = Y(s["mouth_z"])
    sl, xx, yy = patch(X(0) - mw * 1.2, mz - 0.03 * px, X(0) + mw * 1.2, mz + 0.035 * px)
    typ = s["mouth"]
    lip = hx("#9a3a3a")
    stroke = np.zeros_like(xx)

    def arc(curv, tilt_r=0.0, x0=-1.0, x1=1.0, th=0.0024):
        out = np.zeros_like(xx)
        for q in np.linspace(x0, x1, 48):
            out = np.maximum(out, ell(xx, yy, X(0) + q * mw / 2, mz + curv * px * (1 - q * q) - tilt_r * q * px, th * px, th * 0.75 * px, 1.0))
        return out

    if typ == "smile":
        stroke = arc(0.006)
        put(sl, stroke, lip, 0.9)
    elif typ == "small":
        stroke = arc(0.004, x0=-0.7, x1=0.7, th=0.0021)
        put(sl, stroke, hx("#b04a58"), 0.9)
    elif typ == "smirk":
        stroke = arc(0.003, tilt_r=0.005, th=0.0024)
        put(sl, stroke, lip, 0.9)
    elif typ in ("grin", "open"):
        # 張口笑：上緣直線、下緣弧形，口內深紅＋舌頭
        top = mz - 0.002 * px
        depth = (0.016 if typ == "open" else 0.012) * px
        t = (xx - X(0)) / (mw / 2)
        inside = (yy > top) & (yy < top + depth * np.sqrt(np.clip(1 - t * t, 0, 1))) & (np.abs(t) < 1)
        put(sl, inside.astype(float), hx("#7a1e26"))
        tongue = ell(xx, yy, X(0), top + depth * 0.78, mw * 0.28, depth * 0.3, 1.0) * inside
        put(sl, tongue, hx("#e2707a"), 0.9)
        teeth = inside & (yy < top + depth * 0.22)
        put(sl, teeth.astype(float), hx("#fffaf4"), 0.95)
        rim = np.clip(1.0 - np.abs(yy - top) / (0.0016 * px), 0, 1) * (np.abs(t) < 1.05)
        put(sl, rim, lip, 0.9)
    img = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    return img.resize((size, size), Image.LANCZOS)


def deform_head(nid, V):
    """頭部比例微調（A 的頭部頂點，模型座標 x 左右、y 前後、z 高；臉朝 −y）"""
    sh = SHAPES.get(nid)
    if not sh:
        return V
    V = V.copy()
    z = V[:, 2]
    # 以耳朵高度附近為界：下臉（z<0.79）
    low = np.clip((0.79 - z) / 0.12, 0, 1)
    mid = np.exp(-((z - 0.75) / 0.04) ** 2)
    sx = 1 + (sh["width"] + sh["jaw"] * 0.9) * low + sh["cheek"] * mid
    V[:, 0] *= sx
    front = np.clip(-V[:, 1] / 0.12, 0, 1)
    V[:, 1] *= 1 + sh["cheek"] * mid * front * 0.5
    V[:, 2] = np.where(z < 0.72, 0.72 - (0.72 - z) * (1 + sh["chin"]), z)
    return V


if __name__ == "__main__":
    import sys

    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp"
    sys.path.insert(0, __file__.rsplit("/", 1)[0])
    import npc_parts as S

    for nid in S.NPC_ORDER:
        n = S.NPCS[nid]()
        paint(nid, n["gender"], n["iris"], size=1024, ss=1).save(f"{out}/face66_{nid}.png")
        print(nid)


def lid_mesh(head_V, eyes, nx=9):
    """眨眼眼皮：每隻眼睛一片貼著臉的曲面（在臉前 2.5 mm）。回傳 (basis, blink, quads, colors)：
    basis＝睜眼（每一欄頂點都收在睫毛線上 → 面積為 0，看不到）；blink＝閉眼（蓋住整個眼睛，下緣是閉眼的睫毛線）。"""
    rows = [0.0, 0.35, 0.68, 0.88, 1.0]
    Vb, Vc, C, Q = [], [], [], []
    front = head_V[head_V[:, 1] < 0]
    for e in eyes:
        base = len(Vb)
        w, h, side = e["w"], e["h"], e["side"]
        skin = np.asarray(e["skin"], float) * 0.97
        lash = np.asarray(e["lash"], float)
        for i in range(nx):
            t = -1.12 + 2.24 * i / (nx - 1)
            x = e["x"] + t * 0.53 * w
            tt = max(-1.0, min(1.0, t))
            z_top = e["z"] + 0.45 * h - e["lid"] * 0.55 * h - 0.12 * h * tt * tt + e["tilt"] * h * tt * side * 0.9 - 0.03 * h * tt * side
            z_bot = e["z"] - 0.5 * h * math.sqrt(max(0.0, 1 - tt * tt)) * 0.96 - 0.03 * h - e["tilt"] * h * tt * side * 0.35
            if abs(t) > 1.0:
                z_bot = z_top - (z_top - z_bot) * max(0.15, 1 - (abs(t) - 1.0) * 6)
            for r in rows:
                z = z_top + (z_bot - z_top) * r
                d = (front[:, 0] - x) ** 2 + (front[:, 2] - z) ** 2
                k = np.argsort(d)[:6]
                y = float(front[k, 1].min()) - 0.0025
                d0 = (front[:, 0] - x) ** 2 + (front[:, 2] - z_top) ** 2
                y0 = float(front[np.argsort(d0)[:6], 1].min()) - 0.0025
                Vc.append((x, y, z))
                Vb.append((x, y0, z_top))
                C.append(lash if r >= 0.99 else (lash * 0.5 + skin * 0.5 if r >= 0.87 else skin))
        n = len(rows)
        for i in range(nx - 1):
            for j in range(n - 1):
                a_ = base + i * n + j
                b_ = base + (i + 1) * n + j
                Q.append((a_, a_ + 1, b_ + 1, b_) if side > 0 else (a_, b_, b_ + 1, a_ + 1))
    return np.asarray(Vb, float), np.asarray(Vc, float), np.asarray(Q, np.int32), np.asarray(C, float)
