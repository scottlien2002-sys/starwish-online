"""
初心者 V2 — C1.0-B 最終精修（造型）。C0.3／C0.4／C1.0-A 檔案不改。
男生：造型與 C0.3 完全相同。
女生：以 C0.4 為基準，只改裙裝安全：
  1. 安全短褲改成「身體表面外推 7 mm」的貼身短褲：褲襠完整蓋住胯下（胯下在 z≈0.272），
     左右褲管延伸到大腿上段（褲管下緣 z≈0.262，外側略高），加一圈 3 mm 的褲管收邊。
     因為是由身體 SDF 外推而來，不會穿進腿或身體；上緣停在腰線下（被內裙、外裙蓋住）。
  2. 裙襬整體下降約 5%（腰線 0.5 起算）：內裙 0.296→0.286、荷葉 0.31→0.300、前裙 0.344→0.336、
     紫色外裙下緣 base 0.245→0.232；下緣半徑沿原本 A 字斜率外延，A 字傘裙輪廓、配色、金邊、徽章不變。
腿長、腰線、骨盆、頭身比例不變（身體零件沒有動）。
"""
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
for d in ("novice-c04", "novice-c03", "novice-c02", "novice-c01", "novice-v2"):
    sys.path.insert(0, str(HERE.parent / d))
import c02_shapes as C2  # noqa: E402
import c04_shapes as C4  # noqa: E402
import novice_shapes as NS  # noqa: E402
from sdf import Part, Prim, lathe_shell, smax, smin  # noqa: E402

lerp_fn = NS.lerp_fn
ruffle = C2.ruffle

UNDERSKIRT_HEM = 0.286
PETTI_HEM = 0.300
FRONT_HEM = 0.336
OVERSKIRT_BASE = 0.232
SHORTS_HEM = 0.262       # 褲管下緣（內側）；胯下 z≈0.272 → 褲襠多蓋 1 公分
SHORTS_TOP = 0.455
SHORTS_OFF = 0.007       # 貼身但不緊繃
CUFF_OFF = 0.010         # 褲管收邊


def _eval(part, P):
    d = np.full(P.shape[:-1], 1.0)
    for op, p, k in part.ops:
        v = p.fn(P)
        d = smin(d, v, k) if op == "u" else (smax(d, -v, k) if op == "s" else smax(d, v, k))
    return d


def _hem_z(P):
    ax = np.abs(P[..., 0])
    return SHORTS_HEM + 0.010 * np.clip((ax - 0.05) / 0.06, 0, 1)   # 外側略高：自然的褲管斜度


def safety_shorts():
    body = NS.body_part("female")
    lo, hi = (-0.15, -0.12, SHORTS_HEM - 0.01), (0.15, 0.12, SHORTS_TOP + 0.01)
    sh = Part("safety_shorts", "cloth", step=0.0025)
    sh.add(Prim(lambda P: _eval(body, P) - SHORTS_OFF, lo, hi))
    sh.add(Prim(lambda P: np.maximum(_eval(body, P) - CUFF_OFF,
                                     np.maximum(_hem_z(P) - P[..., 2], P[..., 2] - (_hem_z(P) + 0.011))), lo, hi), 0.003)
    sh.inter(Prim(lambda P: np.maximum(_hem_z(P) - P[..., 2], P[..., 2] - SHORTS_TOP), lo, hi))
    return sh


def c10b_female_skirt(parts):
    drop = ("petticoat", "skirt_pink", "skirt_trim", "bloomers", "overskirt", "overskirt_trim", "overskirt_emblem")
    keep = [p for p in parts if p.name not in drop]
    out = []
    rx = lerp_fn([(FRONT_HEM, 0.2172), (0.344, 0.212), (0.44, 0.152), (0.5, 0.11)])
    ry = lerp_fn([(FRONT_HEM, 0.1906), (0.344, 0.186), (0.44, 0.137), (0.5, 0.093)])
    # 荷葉襯裙不可穿出奶油色前裙（C1.0-A 已有零星粉紅色斑點；裙襬下降後金色飾邊左側被穿出一個缺口）：
    # 前裙下緣以上，荷葉半徑限制在前裙內側（前裙最小波浪半徑 ×0.94 − 6 mm），荷葉波浪只在前裙下緣以下出現。
    prx0 = lerp_fn([(PETTI_HEM, 0.2389), (0.31, 0.232), (0.36, 0.2), (0.42, 0.155), (0.49, 0.108)])
    pry0 = lerp_fn([(PETTI_HEM, 0.2096), (0.31, 0.204), (0.36, 0.176), (0.42, 0.135), (0.49, 0.09)])

    def capped(f0, fp):
        def f(z):
            w = np.clip((z - (FRONT_HEM - 0.014)) / 0.014, 0, 1)
            return f0(z) * (1 - w) + np.minimum(f0(z), fp(z) * 0.94 - 0.006) * w
        return f

    pwave = lambda th, z: 1 + 0.055 * np.sin(16 * th) * np.clip((FRONT_HEM - 0.004 - z) / 0.02, 0, 1)
    # 奶油白內裙（下緣半徑沿原 A 字斜率外延；前裙下緣以上收在荷葉襯裙內側，避免三層裙互相穿插）
    urx0 = lerp_fn([(UNDERSKIRT_HEM, 0.2103), (0.4, 0.15), (0.47, 0.104)])
    ury0 = lerp_fn([(UNDERSKIRT_HEM, 0.1845), (0.4, 0.132), (0.47, 0.088)])
    prx, pry = capped(prx0, rx), capped(pry0, ry)

    def inside(f0, fo):
        return lambda z: np.minimum(f0(z), (fo(z) - 0.011) / 1.05)

    us = Part("underskirt", "cloth", step=0.0025)
    us.add(lathe_shell(UNDERSKIRT_HEM, 0.47, inside(urx0, prx), inside(ury0, pry), 0.006, wave=ruffle(10, 0.05, 1.2, 0.4)))
    out.append(us)
    pet = Part("petticoat", "cloth", step=0.0025)
    pet.add(lathe_shell(PETTI_HEM, 0.49, prx, pry, 0.008, wave=pwave))
    out.append(pet)
    pink = Part("skirt_pink", "cloth", step=0.0025)
    pink.add(lathe_shell(FRONT_HEM, 0.5, rx, ry, 0.008, wave=ruffle(12, 0.04, 0.5, 0.41)))
    out.append(pink)
    st = Part("skirt_trim", "metal", step=0.0018)
    st.add(lathe_shell(FRONT_HEM, FRONT_HEM + 0.016, lambda z: rx(z) + 0.007, lambda z: ry(z) + 0.007, 0.009, wave=ruffle(12, 0.04, 0.5, 0.41)))
    out.append(st)
    out.append(safety_shorts())

    def ohem(th):
        a = np.degrees(np.abs(th))
        return OVERSKIRT_BASE - 0.09 * np.exp(-(((a - 46) / 10) ** 2)) - 0.045 * np.exp(-(((a - 80) / 14) ** 2)) - 0.035 * np.exp(-(((a - 125) / 12) ** 2)) + 0.012 * np.cos(np.radians(a) * 9) * (a > 60)

    orx = lerp_fn([(0.12, 0.335), (0.14, 0.33), (0.25, 0.305), (0.34, 0.268), (0.42, 0.2), (0.5, 0.118)])
    ory = lerp_fn([(0.12, 0.218), (0.14, 0.215), (0.25, 0.2), (0.34, 0.19), (0.42, 0.15), (0.5, 0.099)])
    ocy = lerp_fn([(0.12, 0.063), (0.14, 0.06), (0.5, 0.0)])
    wave = lambda th, z: 1 + 0.03 * np.sin(8 * th + 0.4) * np.clip((0.36 - z) / 0.2, 0, 1) * np.clip((np.abs(th) - 1.0) / 0.5, 0, 1)
    osk = Part("overskirt", "cloth2", step=0.003)
    osk.add(lathe_shell(0.12, 0.5, orx, ory, 0.012, cy_fn=ocy, open_front_deg=40, hem_fn=ohem, wave=wave))
    out.append(osk)
    otrim = Part("overskirt_trim", "metal", step=0.0025)
    otrim.add(lathe_shell(0.12, 0.5, lambda z: orx(z) + 0.004, lambda z: ory(z) + 0.004, 0.01, cy_fn=ocy, open_front_deg=40, hem_fn=ohem, wave=wave))
    otrim.inter(Prim(lambda P: P[..., 2] - (ohem(np.arctan2(P[..., 0], -P[..., 1])) + 0.02), (-0.4, -0.4, 0.06), (0.4, 0.4, 0.5)))
    out.append(otrim)
    emb = Part("overskirt_emblem", "metal", step=0.0015)
    emb.add(NS.star_prim((0, 0.222, 0.33), (0, 1, 0.3), (0, 0, 1), 0.04, 0.016, 4, 0.005))
    out.append(emb)
    return keep + out


def male_crotch_patch(parts):
    """男生深灰短褲：胯下內側（x ±1 公分、z 0.26～0.31）原本露出一小塊膚色（C1.0-A 正面可見）。
    在胯下內側補一片「身體表面外推 4 mm」的短褲布料；外輪廓不變。"""
    body = next(p for p in parts if p.name == "body")
    sh = next(p for p in parts if p.name == "shorts")
    lo, hi = (-0.035, -0.08, 0.25), (0.035, 0.08, 0.34)
    sh.add(Prim(lambda P: np.maximum(_eval(body, P) - 0.004,
                                     np.maximum(np.abs(P[..., 0]) - 0.03, np.maximum(0.255 - P[..., 2], P[..., 2] - 0.335))), lo, hi), 0.004)
    return parts


def build(g):
    saved = C2.female_skirt
    C2.female_skirt = c10b_female_skirt
    try:
        parts = C4.build(g)
    finally:
        C2.female_skirt = saved
    return male_crotch_patch(parts) if g == "male" else parts
