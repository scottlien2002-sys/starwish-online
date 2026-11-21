def face_texture_v2(g, size=2048, ss=2):
    """
    C1.0-A 臉部貼圖：五官位置、大小、形狀與 C0 完全相同（同一組量測與繪製流程），只提升細節：
    - 臉頰極淡暖色漸層、臉部邊緣柔和的暖色明暗過渡、瀏海下方極淡陰影
    - 虹膜：上深下淺之外再加徑向漸層（外圈深、內圈亮）、細緻放射紋、內環亮帶、下方通透的反光弧
    - 高光：大高光邊緣柔化並帶一點漸層、小高光保持銳利、加一個淡色反射點（通透感）
    """
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

    # 臉部明暗過渡（極淡）：以臉中心為準，往外緣與下巴微暖、微暗；額頭靠瀏海處極淡陰影
    base = np.asarray(img).astype(float) / 255.0
    yy0, xx0 = np.mgrid[0:S, 0:S].astype(float)
    fx = (xx0 / px + FACE_X0) / 0.17
    fz = ((FACE_Z0 + FACE_SIZE) - yy0 / px - 0.79) / 0.13
    rr = np.sqrt(fx * fx + fz * fz)
    edge = np.clip((rr - 0.95) / 0.5, 0, 1) ** 1.5
    warm_dark = np.array([0.93, 0.80, 0.76])
    base = base * (1 - 0.3 * edge[..., None]) + base * warm_dark[None, None] * 0.3 * edge[..., None]
    fore = np.exp(-(((FACE_Z0 + FACE_SIZE) - yy0 / px - (sp["eye_z"] + 0.075)) / 0.018) ** 2) * np.clip(1 - np.abs(fx) / 1.1, 0, 1)
    base = base * (1 - 0.025 * fore[..., None])
    # 臉頰極淡暖色漸層（比腮紅大、淡）
    for sx in (1, -1):
        cfx = ((xx0 / px + FACE_X0) - sx * (sp["eye_dx"] + 0.012)) / 0.07
        cfz = (((FACE_Z0 + FACE_SIZE) - yy0 / px) - (sp["eye_z"] - 0.075)) / 0.05
        wm = np.exp(-(cfx * cfx + cfz * cfz)) * 0.16
        base = base * (1 - wm[..., None]) + np.array([1.0, 0.72, 0.68])[None, None] * wm[..., None]
    img = Image.fromarray((np.clip(base, 0, 1) * 255).astype(np.uint8))
    del base, yy0, xx0, fx, fz, rr, edge, fore
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
        # 徑向漸層：外圈深、內圈亮（虹膜內部的細緻層次）
        rr_ = np.sqrt(((xx - icx) / irx) ** 2 + ((yy - icz) / irz) ** 2)
        put(sl, iris * np.clip((rr_ - 0.55) / 0.45, 0, 1), hx(sp["ring"]), 0.35)
        put(sl, iris * np.clip(1 - np.abs(rr_ - 0.5) / 0.12, 0, 1) * np.clip((yy - icz) / (0.6 * irz) + 0.3, 0, 1), hx(sp["iris_bot"]), 0.35)
        # 細緻放射紋
        ang = np.arctan2(yy - icz, xx - icx)
        streak = (0.5 + 0.5 * np.sin(ang * 26 + 1.3 * np.sin(ang * 7))) * np.clip((rr_ - 0.3) / 0.25, 0, 1) * np.clip((0.95 - rr_) / 0.15, 0, 1)
        put(sl, iris * streak, hx(sp["iris_top"]), 0.18)
        ringm = np.clip(iris - ell(xx, yy, icx, icz, irx * 0.9, irz * 0.92, 1.0) * below, 0, 1)
        put(sl, ringm, hx(sp["ring"]), 0.85)
        put(sl, ell(xx, yy, icx, icz - 0.04 * h, 0.18 * w, 0.25 * h) * below, hx(sp["pupil"]), 0.95)
        shade = np.clip((lid_y(xx) + 0.28 * h - yy) / (0.22 * h), 0, 1) * iris
        put(sl, shade, hx(sp["pupil"]), 0.5)
        put(sl, ell(xx, yy, icx, icz + 0.3 * h, 0.27 * w, 0.12 * h, 3.0) * iris, hx("#ffffff"), 0.3)   # 下方通透反光弧（邊緣更柔）
        # 高光（光從左上；兩眼方向一致）
        # 大高光：柔邊＋一點漸層（上緣最亮）
        hlm = ell(xx, yy, icx - 0.15 * w, ez - 0.12 * h, 0.13 * w, 0.15 * h, 2.2) * below
        put(sl, hlm, hx("#ffffff"), 0.97)
        put(sl, ell(xx, yy, icx - 0.17 * w, ez - 0.17 * h, 0.06 * w, 0.06 * h, 1.5) * below, hx("#ffffff"))
        # 淡色反射點（通透感）
        put(sl, ell(xx, yy, icx + 0.2 * w, ez + 0.08 * h, 0.05 * w, 0.07 * h, 2.0) * iris, hx(sp["iris_bot"]) * 0.4 + 0.6, 0.55)
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


