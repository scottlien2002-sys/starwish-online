"""Stage 6.6 星芽村建築生活感裝飾（各建築腳本在 build() 最後呼叫 decorate66）。

- 入口兩側壁燈（鐵支架＋吊燈＋暖光燈罩）：提高入口辨識度、夜晚感；燈罩放在 glow（自發光，不受光），沒有 glow 網格的建築改用 props 亮色
- 入口花盆（陶盆＋灌木＋小花）：生活感
- 全部放在原本的建築碰撞箱內（正面牆與碰撞箱前緣之間），不新增碰撞、不擋路；不新增網格（加進既有的 props／gold／glow）
座標：各建築自己的區域座標 F(x 右, y 往內, h 高)；面向廣場＝−y。
"""
import math

import vp3_geo as G

IRON = (0.24, 0.25, 0.29)
IRON_L = (0.36, 0.37, 0.42)
WARM = (1.0, 0.84, 0.5)
POT = (0.74, 0.42, 0.29)
POT_D = (0.55, 0.3, 0.2)
SOIL = (0.3, 0.22, 0.16)
LEAF = [(0.36, 0.6, 0.32), (0.42, 0.66, 0.34), (0.32, 0.54, 0.3)]
FLOWER = [(1.0, 0.72, 0.8), (1.0, 0.92, 0.55), (0.98, 0.97, 0.95), (0.8, 0.78, 1.0), (1.0, 0.55, 0.5)]

# 每棟建築：壁燈 (x, h, 牆面 y)、花盆 (x, y)；h 是離地高度（區域座標）
SPEC = {
    "sword": dict(lamps=[(-2.05, 3.0, 3.28), (2.05, 3.0, 3.28)], pots=[(-2.3, 2.95), (2.3, 2.95)]),
    "knight": dict(lamps=[(-3.05, 3.4, 2.95), (3.05, 3.4, 2.95)], pots=[(-3.15, 2.55), (3.15, 2.55)]),
    "mage": dict(lamps=[(-1.95, 2.7, 1.84), (1.95, 2.7, 1.84)], pots=[]),
    "church": dict(lamps=[(-1.95, 2.5, 0.48)], pots=[(-1.75, 0.3), (1.75, 0.3)], depth=0.3),
    "smith": dict(lamps=[(1.45, 2.55, 1.66)], pots=[]),
    "warehouse": dict(lamps=[(-2.25, 2.4, 1.26), (2.25, 2.4, 1.26)], pots=[]),
    "guild": dict(lamps=[(1.0, 2.4, 0.88), (4.1, 2.4, 0.88)], pots=[], depth=0.3),
}


def lantern(props, gm, gcol, glow, F, x, h, yw, hq, depth=0.36):
    seg = 8 if hq else 5
    yc = yw - depth + 0.08
    # 牆上鐵板＋水平支臂＋斜撐
    G.box(props, F, x - 0.06, x + 0.06, yw - 0.03, yw, h + 0.15, h + 0.62, IRON)
    G.box(props, F, x - 0.022, x + 0.022, yc - 0.02, yw - 0.02, h + 0.52, h + 0.57, IRON)
    if hq:
        G.tube(props, [F(x, yw - 0.03, h + 0.2), F(x, (yw + yc) / 2, h + 0.36), F(x, yc + 0.08, h + 0.53)], 0.012, 3, IRON)
    p = F(x, yc, h)
    cx, cz, h0 = p
    G.tube(props, [(cx, cz, h0 + 0.55), (cx, cz, h0 + 0.44)], 0.008, 3, IRON)
    # 燈帽（金或鐵）、燈罩（發光）、底座
    G.lathe(gm if hq else props, cx, cz, h0, [(0.0, 0.47), (0.04, 0.46), (0.15, 0.37), (0.13, 0.34), (0.0, 0.34)], seg, gcol if hq else IRON_L, smooth=False)
    tgt = glow if glow is not None else props
    G.lathe(tgt, cx, cz, h0, [(0.0, 0.03), (0.09, 0.05), (0.11, 0.18), (0.1, 0.32), (0.0, 0.34)], seg, WARM, smooth=True)
    G.lathe(props, cx, cz, h0, [(0.0, -0.04), (0.06, -0.02), (0.12, 0.03), (0.0, 0.05)], seg, IRON, smooth=False)
    if hq:
        for k in range(4):
            a = math.tau * (k + 0.5) / 4
            ox, oz = math.sin(a) * 0.115, math.cos(a) * 0.115
            G.tube(props, [(cx + ox, cz + oz, h0 + 0.03), (cx + ox, cz + oz, h0 + 0.35)], 0.008, 3, IRON)


def pot(props, F, x, y, hq, seed):
    seg = 9 if hq else 6
    p = F(x, y, 0)
    cx, cz, h0 = p
    G.lathe(props, cx, cz, h0, [(0.15, 0.0), (0.19, 0.05), (0.22, 0.3), (0.25, 0.34), (0.25, 0.38), (0.2, 0.38), (0.2, 0.36), (0.0, 0.36)], seg, POT, smooth=False)
    G.lathe(props, cx, cz, h0, [(0.226, 0.3), (0.252, 0.33), (0.226, 0.36)], seg, POT_D, smooth=False)
    r = 0.2
    blobs = [(0.0, 0.0, 0.55, r * 1.1), (0.1, 0.06, 0.48, r * 0.8), (-0.09, -0.06, 0.5, r * 0.8)] if hq else [(0.0, 0.0, 0.52, r * 1.15)]
    for i, (dx, dz, hh, rr) in enumerate(blobs):
        G.blob(props, (cx + dx, cz + dz, h0 + hh), rr, rr, rr * 0.85, LEAF[(i + seed) % len(LEAF)])
    if hq:
        for k in range(6):
            a = k * 2.1 + seed
            fx, fz = cx + math.sin(a) * 0.16, cz + math.cos(a) * 0.16
            G.blob(props, (fx, fz, h0 + 0.6 + 0.05 * math.sin(a * 3)), 0.045, 0.045, 0.03, FLOWER[(k + seed) % len(FLOWER)])


def decorate66(name, scope, F, lod):
    """scope＝build() 的 locals()（取得 props／gold／glow 與金色設定）"""
    sp = SPEC.get(name)
    if not sp:
        return
    hq = lod == "hq"
    props = scope["props"]
    gold = scope.get("gold")
    glow = scope.get("glow")
    gm = gold if (hq and gold is not None) else props
    gcol = (1, 1, 1) if (hq and gold is not None) else (0.92, 0.73, 0.33)
    for x, h, yw in sp["lamps"]:
        lantern(props, gm, gcol, glow, F, x, h, yw, hq, sp.get("depth", 0.36))
    for i, (x, y) in enumerate(sp["pots"]):
        pot(props, F, x, y, hq, i * 3 + len(name))
