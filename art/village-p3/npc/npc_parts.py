"""星芽村正式 NPC（八位）造型：有號距離場零件庫＋八位角色定義。

- 頭、臉（臉部貼圖）、身體、手、靴子：唯讀沿用 Claude A 正式初心者（C1.0-B4）男／女基礎網格（與洛恩相同做法），不修改 A 的檔案
- 本檔只定義各 NPC 自己的髮型、臉部配件（鬍子、眼鏡、單片眼鏡、紅鼻子）、服裝、職業道具
- 每個零件附「綁定骨頭」設定（bind），給 blender_npc.py 蒙皮用
座標：Z 向上、角色面向 -Y、角色左側 +X；單位公尺；腳底 z = 0（與 A 相同）
"""
import math
import os
import sys
from pathlib import Path

import numpy as np

A_ART = Path(os.environ.get("A_ART", "/tmp/a_art/art"))
for d in ("novice-v2", "bobo-v38r", "novice-c0"):
    sys.path.insert(0, str(A_ART / d))
import novice_shapes as NS  # noqa: E402
from sdf import Part, Prim, bezier3, capsule, ellipsoid, flat_tube, lathe_shell, rbox, rot, torus, unit  # noqa: E402

SHELL = {"male": ((0.0, 0.06, 0.9), (0.216, 0.236, 0.226)), "female": ((0.0, 0.035, 0.89), (0.216, 0.225, 0.215))}
# 綁定骨頭（blender_npc.py 依此蒙皮）
HEAD = {"head": 1.0}
TORSO = {"chest": 1.0, "spine": 1.0, "hips": 1.0, "thigh.L": 0.35, "thigh.R": 0.35}
CHEST = {"chest": 1.0}
HIPS = {"hips": 1.0, "spine": 0.4}
LEGS = {"hips": 1.0, "thigh.L": 1.0, "thigh.R": 1.0, "shin.L": 1.0, "shin.R": 1.0}
NECK = {"neck": 1.0, "chest": 1.0}


def P(name, group, step=0.003, bind=None):
    p = Part(name, group, step=step)
    p.bind = bind
    return p


def moved(prim, off):
    off = np.asarray(off, float)
    return Prim(lambda Q, f=prim.fn: f(Q - off), prim.lo + off, prim.hi + off)


# ------------------------------------------------------------------ 共用服裝
def shell(name, group, z0, z1, rx, ry, thick=0.012, open_deg=0.0, hem=None, cy=0.006, step=0.0035, bind=TORSO, grow=0.0):
    """長袍／外套／上衣筒：rx、ry＝[(z, 半徑)...]（高度遞增）；上端收到肩頸，不會是平口筒"""
    zs = [z for z, _ in rx]
    fx = lambda z: np.interp(z, zs, [r for _, r in rx]) + grow  # noqa: E731
    fy = lambda z: np.interp(z, [z for z, _ in ry], [r for _, r in ry]) + grow  # noqa: E731
    p = P(name, group, step, bind)
    p.add(lathe_shell(z0, z1, fx, fy, thick, cy_fn=lambda z: cy + 0 * z, open_front_deg=open_deg, hem_fn=hem))
    return p


def coat_profile(g, hem_r=0.21, waist=0.43, top=0.688):
    """上身收肩的外套輪廓（男女共用，女生肩略窄）"""
    k = 1.0 if g == "male" else 0.95
    rx = [(0.1, hem_r), (0.2, hem_r * 0.97), (0.33, 0.15 * k + (hem_r - 0.21) * 0.4), (waist, 0.142 * k), (0.5, 0.138 * k), (0.58, 0.132 * k), (0.62, 0.126 * k), (0.65, 0.112 * k), (0.672, 0.088), (top, 0.062)]
    ry = [(0.1, hem_r * 0.78), (0.2, hem_r * 0.75), (0.33, 0.118 + (hem_r - 0.21) * 0.3), (waist, 0.103), (0.5, 0.1), (0.58, 0.095), (0.62, 0.091), (0.65, 0.083), (0.672, 0.07), (top, 0.056)]
    return rx, ry


def trousers(g, col_group="cloth", name="trousers", rr=1.0):
    hp, kn, an = NS.leg_joints(g)
    p = P(name, col_group, 0.003, LEGS)
    for sx in (1, -1):
        h = np.array([hp[0] * sx, hp[1], hp[2] + 0.03])
        k = np.array([kn[0] * sx, kn[1], kn[2]])
        a = np.array([an[0] * sx, an[1], 0.14])
        p.add(capsule(h, k, 0.064 * rr, 0.058 * rr), 0.02)
        p.add(capsule(k, a, 0.058 * rr, 0.056 * rr), 0.01)
    p.add(ellipsoid((0, 0.0, 0.37), (0.15 if g == "male" else 0.13, 0.094, 0.075)), 0.03)
    p.add(ellipsoid((0, 0.0, 0.315), (0.085, 0.07, 0.06)), 0.03)
    return p


def belt(name, z, rx, ry, w=0.022, group="leather"):
    p = P(name, group, 0.0022, HIPS)
    p.add(lathe_shell(z - w / 2, z + w / 2, lambda q: rx + 0 * q, lambda q: ry + 0 * q, 0.012, cy_fn=lambda q: 0.006 + 0 * q))
    return p


def arm_pts(g, sx):
    sh, el, wr = NS.arm_joints(g)
    f = lambda v: np.array([v[0] * sx, v[1], v[2]])  # noqa: E731
    return f(sh), f(el), f(wr)


def sleeves(g, name, group, r0=0.05, r1=0.044, to=0.85):
    """長袖（肩→手腕前）：SIDE_ARM 綁定（左右分開）"""
    p = P(name, group, 0.003, "SIDE_ARM_FULL")
    for sx in (1, -1):
        s, e, w = arm_pts(g, sx)
        p.add(capsule(s + np.array([0, 0, -0.01]), e, r0, r1 * 1.05), 0.012)
        p.add(capsule(e, e + (w - e) * to, r1 * 1.05, r1), 0.01)
    return p


def cuffs(g, name, group, r=0.036, at=0.72, thick=0.012):
    p = P(name, group, 0.0018, "SIDE_ARM")
    for sx in (1, -1):
        s, e, w = arm_pts(g, sx)
        ax = unit(w - e)
        p.add(torus(e + (w - e) * at, r, thick, axis=ax, flat=1.4))
    return p


def hand_pt(g, sx, along=0.06):
    s, e, w = arm_pts(g, sx)
    return w + unit(w - e) * along


# ------------------------------------------------------------------ 髮型
def hair_base(g, bangs, sweep=-18, ex=0.62, side_ex=1.0, back_len=1.0, spiky=False, cap=True, crown=True):
    H = NS.Hair(g, cap_extra=0.0, shell=SHELL[g])
    H.drop = False
    H.ex_scale = ex
    if cap:
        NS.shell_cap(H, curved=True)
    W = (176, 62)
    F = H.flow
    tip = 0.1 if spiky else 0.2
    for az, el, w, st in bangs:
        F(W, az, el, w * 0.85, 0.04, 0.036 + (0.02 if spiky else 0), ex_root=0.008, belly=0.012, bend=sweep, tip=tip, start=st, plateau=0.3)
    for sx in (1, -1):
        for az, el, e0 in ((84, -4, 0.085), (102, -10, 0.09), (120, -12, 0.078), (138, -22, 0.06)):
            F(W, az * sx, el, 0.19, 0.054, e0 * side_ex + (0.03 if spiky else 0), ex_root=0.012, belly=0.017, curl=0.02, bend=8, tip=0.26 if not spiky else 0.12, start=0.3, plateau=0.38)
    for i, (az, el, e0) in enumerate(((146, -38, 0.045), (160, -54, 0.032), (172, -66, 0.05), (186, -62, 0.032), (200, -52, 0.05), (214, -38, 0.036))):
        F(W, az, el * back_len, 0.16, 0.052, e0 + (0.03 if spiky else 0), ex_root=0.004 + 0.01 * (i % 2 == 0), belly=0.015, bend=6, tip=0.22 if not spiky else 0.1, start=0.22, plateau=0.36)
    if not crown:  # 光頭：只留兩側與後腦貼頭皮的短髮帶（依 A 頭部網格實測：中心 y0.027 z0.86、半徑約 0.19／0.2／0.21）
        hc, hr = np.array([0.0, 0.027, 0.86]), np.array([0.19, 0.2, 0.21])
        q = P("hair", "hair", 0.0025, HEAD)
        q.add(ellipsoid(hc, hr + 0.02))
        q.sub(ellipsoid(hc, hr - 0.006))
        q.inter(ellipsoid((0, 0.09, 0.79), (0.3, 0.26, 0.085)), 0.015)
        q.sub(ellipsoid((0, -0.2, 0.8), (0.16, 0.16, 0.2)), 0.02)  # 臉與耳前挖開
        H.part = q
        return H
    for az, el, e0, st in ((-34, 40, 0.048, 0.2), (14, 46, 0.052, 0.2), (58, 22, 0.06, 0.28), (-72, 30, 0.06, 0.28), (96, 8, 0.065, 0.32), (-104, 14, 0.065, 0.32), (128, 18, 0.052, 0.38), (-132, 2, 0.056, 0.38)):
        F(W, az, el, 0.17, 0.05, e0 + (0.04 if spiky else 0), ex_root=0.016, belly=0.013, start=st, curl=0.012 if not spiky else 0.03, bend=-8, tip=0.22 if not spiky else 0.08, plateau=0.36)
    for az, el in ((120, 52), (230, 50), (180, 40)):
        F(W, az, el, 0.12, 0.038, 0.018, ex_root=0.006, belly=0.009, bend=28, tip=0.25, plateau=0.35)
    pw, nw = H.pt(W[0], W[1], 0.004)
    t1 = unit(np.cross(nw, [0, 0, 1.0]))
    H.part.add(ellipsoid(pw, (0.034, 0.034, 0.008), np.column_stack([t1, np.cross(nw, t1), nw])), 0.012)
    H.part.bind = HEAD
    return H


BANGS_SWEEP = ((-50, -12, 0.15, 0.45), (-28, -16, 0.17, 0.42), (-6, -14, 0.17, 0.4), (16, -8, 0.17, 0.42), (38, -14, 0.16, 0.44), (58, -20, 0.13, 0.5))
BANGS_SHORT = ((-44, 4, 0.16, 0.45), (-20, 6, 0.17, 0.42), (4, 4, 0.17, 0.4), (26, 6, 0.17, 0.42), (48, 2, 0.15, 0.45))
BANGS_SPIKE = ((-46, 10, 0.14, 0.45), (-22, 16, 0.15, 0.42), (2, 18, 0.15, 0.4), (24, 14, 0.15, 0.42), (46, 8, 0.14, 0.45))


def long_back(H, g, length=0.42, n=7, width=0.15):
    """長髮：後腦垂到肩背（往下垂的髮束）"""
    for i in range(n):
        az = 140 + 80 * i / (n - 1)
        H.strand([(az, -20, 0.02), (az, -70, 0.04), (az, -95, 0.05), (az, -100 - length * 120, 0.05)], width, 0.05, tip=0.3, belly=0.012, drop=True)


def bun(H, g, at=(0.0, 0.2, 0.93), r=0.07):
    p = H.part
    p.add(ellipsoid(at, (r, r * 0.85, r * 0.9)), 0.02)
    p.add(torus(np.array(at) + np.array([0, -0.01, 0]), r * 0.75, r * 0.18, axis=(0, 1, 0.2)), 0.01)


# ------------------------------------------------------------------ 臉部配件
FACE_Y = -0.172


def glasses(g, name="glasses", r=0.046, round_=True):
    p = P(name, "metal", 0.0012, HEAD)
    z = 0.785 if g == "male" else 0.78
    y = (FACE_Y if g == "male" else -0.163) - 0.012
    for sx in (1, -1):
        c = np.array([0.072 * sx, y + 0.008 * 1.0, z])
        p.add(torus(c, r, 0.0045, axis=(0, 1, 0)))
        # 鏡腳
        p.add(capsule(c + np.array([r * sx, 0.0, 0.005]), np.array([0.17 * sx, 0.02, z + 0.02]), 0.004))
    p.add(capsule(np.array([0.028, y + 0.004, z + 0.012]), np.array([-0.028, y + 0.004, z + 0.012]), 0.0035))
    return p


def monocle(g, sx=-1):
    p = P("monocle", "metal", 0.0012, HEAD)
    z = 0.785
    c = np.array([0.072 * sx, FACE_Y - 0.004, z])
    p.add(torus(c, 0.05, 0.005, axis=(0, 1, 0)))
    pts = bezier3(c + np.array([0, 0, -0.05]), c + np.array([0.02 * sx, -0.02, -0.12]), np.array([0.06 * sx, -0.14, 0.62]), np.array([0.09 * sx, -0.1, 0.56]), 12)
    p.add(flat_tube(pts, np.full(12, 0.0018), np.full(12, 0.0015), [np.array([0, -1.0, 0])] * 12), 0.002)
    return p


def mustache(g, name="mustache", curl=True, w=0.07):
    p = P(name, "hair", 0.0015, HEAD)
    z = 0.712
    for sx in (1, -1):
        pts = bezier3(np.array([0.004 * sx, -0.168, z]), np.array([0.03 * sx, -0.172, z - 0.006]), np.array([0.06 * sx, -0.16, z - 0.004]), np.array([w * sx, -0.145, z + (0.03 if curl else 0.0)]), 12)
        ts = np.linspace(0, 1, 12)
        p.add(flat_tube(pts, 0.012 * (1 - 0.7 * ts) + 0.002, 0.009 * (1 - 0.6 * ts) + 0.002, [np.array([0, -1.0, 0.0])] * 12), 0.004)
    return p


def beard(g, big=True):
    """下巴鬍：沿下顎包住（臉頰下方到下巴），大鬍子再往下垂"""
    p = P("beard", "hair", 0.0025, HEAD)
    if big:
        p.add(ellipsoid((0, -0.11, 0.64), (0.15, 0.1, 0.09)))
        p.add(ellipsoid((0, -0.15, 0.58), (0.1, 0.07, 0.08)), 0.03)
        p.sub(ellipsoid((0, -0.02, 0.76), (0.2, 0.21, 0.16)), 0.02)  # 挖出臉
        p.sub(ellipsoid((0, -0.2, 0.71), (0.04, 0.03, 0.016)), 0.006)  # 嘴巴露出
    else:
        p.add(ellipsoid((0, -0.13, 0.665), (0.1, 0.06, 0.05)))
        p.sub(ellipsoid((0, -0.03, 0.75), (0.19, 0.19, 0.12)), 0.015)
        p.sub(ellipsoid((0, -0.19, 0.71), (0.035, 0.03, 0.014)), 0.005)
    return p


def clown_nose():
    return P("nose", "nose", 0.001, HEAD).add(ellipsoid((0, -0.185, 0.738), (0.024, 0.02, 0.022)))


# ------------------------------------------------------------------ 帽子
def hat_wizard(g, col="cloth"):
    p = P("hat", col, 0.0035, HEAD)
    c = np.array([0.0, 0.05, 0.98])
    p.add(ellipsoid(c + np.array([0, 0, 0.0]), (0.3, 0.29, 0.014)))  # 平的寬帽簷
    p.add(ellipsoid(c + np.array([0, 0, 0.01]), (0.2, 0.2, 0.03)), 0.03)
    cone = lambda z: np.interp(z, [0.0, 0.12, 0.3, 0.42], [0.19, 0.15, 0.07, 0.015])  # noqa: E731
    sh = lathe_shell(0.0, 0.42, cone, cone, 0.016)
    p.add(moved(sh, c))
    # 尖端往後彎
    pts = bezier3(c + np.array([0, 0, 0.4]), c + np.array([0, 0.03, 0.47]), c + np.array([0, 0.09, 0.5]), c + np.array([0, 0.15, 0.47]), 10)
    p.add(flat_tube(pts, np.linspace(0.02, 0.008, 10), np.linspace(0.02, 0.008, 10), [np.array([1.0, 0, 0])] * 10), 0.015)
    band = P("hat_band", "metal", 0.0018, HEAD).add(moved(lathe_shell(0.0, 0.032, lambda z: 0.192 + 0 * z, lambda z: 0.192 + 0 * z, 0.01), c + np.array([0, 0, 0.012])))
    return p, band


def top_hat(col="cloth"):
    p = P("hat", col, 0.003, HEAD)
    c = np.array([0.0, 0.04, 1.02])
    p.add(ellipsoid(c + np.array([0, 0, 0.006]), (0.25, 0.23, 0.013)))  # 平帽簷
    prof = lambda z: np.interp(z, [0.0, 0.2, 0.26], [0.15, 0.16, 0.165])  # noqa: E731
    p.add(moved(lathe_shell(0.0, 0.26, prof, prof, 0.014), c))
    p.add(moved(ellipsoid((0, 0, 0.255), (0.16, 0.16, 0.012)), c), 0.004)
    band = P("hat_band", "metal", 0.0018, HEAD).add(moved(lathe_shell(0.0, 0.04, lambda z: 0.158 + 0 * z, lambda z: 0.158 + 0 * z, 0.01), c + np.array([0, 0, 0.02])))
    return p, band


def veil(g):
    """祭司頭紗：包住頭頂與後腦、垂到肩後；額前露出瀏海"""
    c, r = SHELL[g]
    p = P("veil", "cloth", 0.003, {"head": 1.0, "neck": 1.0, "chest": 1.0})
    p.add(ellipsoid(np.array(c) + np.array([0, 0.012, 0.012]), np.array(r) + 0.022))
    p.sub(ellipsoid(np.array(c) + np.array([0, 0.012, 0.012]), np.array(r) + 0.006))
    p.sub(ellipsoid((0, -0.22, 0.79), (0.2, 0.17, 0.19)), 0.02)  # 臉與瀏海開口
    back = lambda z: np.interp(z, [0.6, 0.8, 0.95], [0.23, 0.24, 0.22])  # noqa: E731
    p.add(lathe_shell(0.56, 0.95, back, lambda z: 0.24 + 0 * z, 0.014, cy_fn=lambda z: 0.05 + 0 * z, open_front_deg=95.0), 0.02)
    return p


def headband(g, col="band"):
    c, r = SHELL[g]
    p = P("headband", col, 0.0018, HEAD)
    z = c[2] + 0.035
    # 前低後高的斜環（壓在瀏海上方），半徑略大於髮量外緣
    tilt = lambda q: c[1] + 0 * q  # noqa: E731
    ring = lathe_shell(z - 0.02, z + 0.02, lambda q: r[0] + 0.03 + 0 * q, lambda q: r[1] + 0.025 + 0 * q, 0.014, cy_fn=tilt)
    R = rot((1, 0, 0), -12)
    cc = np.array([0, c[1], z])
    p.add(Prim(lambda Q, f=ring.fn: f((Q - cc) @ R + cc), ring.lo - 0.05, ring.hi + 0.05))
    # 後方綁帶
    for sx in (1, -1):
        pts = bezier3(np.array([0.02 * sx, c[1] + r[1] + 0.02, z]), np.array([0.05 * sx, c[1] + r[1] + 0.06, z - 0.04]), np.array([0.07 * sx, c[1] + r[1] + 0.07, z - 0.1]), np.array([0.08 * sx, c[1] + r[1] + 0.06, z - 0.16]), 10)
        p.add(flat_tube(pts, np.full(10, 0.014), np.full(10, 0.004), [np.array([0, 1.0, 0])] * 10), 0.004)
    return p


def goggles(g, snug=0.0):
    """額頭護目鏡：皮帶貼著頭（依 A 頭部網格實測 z0.93：半寬 0.175、前 -0.16、後 0.22）"""
    z = 0.93
    p = P("goggles", "leather", 0.0018, HEAD)
    p.add(lathe_shell(z - 0.014, z + 0.014, lambda q: 0.186 + snug + 0 * q, lambda q: 0.2 + snug + 0 * q, 0.01, cy_fn=lambda q: 0.03 + 0 * q))
    lens = P("goggle_lens", "metal", 0.0015, HEAD)
    for sx in (1, -1):
        cc = np.array([0.058 * sx, -0.172 - snug, z + 0.004])
        lens.add(torus(cc, 0.03, 0.01, axis=(0.2 * sx, 1, -0.3)))
        lens.add(ellipsoid(cc, (0.026, 0.01, 0.024)))
    return p, lens


# ------------------------------------------------------------------ 盔甲、披風、圍裙
def breastplate(g, name="armor"):
    p = P(name, "metal", 0.0028, CHEST)
    p.add(ellipsoid((0, 0.0, 0.54), (0.152, 0.112, 0.125)))
    p.sub(ellipsoid((0, 0.01, 0.54), (0.138, 0.098, 0.115)))
    p.sub(rbox((0, 0.07, 0.53), (0.25, 0.07, 0.2)))  # 只留前片
    p.inter(rbox((0, 0, 0.545), (0.3, 0.3, 0.1)), 0.01)
    # 中線稜線（胸甲不是氣球）
    p.add(capsule((0, -0.108, 0.47), (0, -0.112, 0.62), 0.006), 0.01)
    return p


def pauldrons(g, sides=(1, -1), name="pauldron", r=0.075):
    p = P(name, "metal", 0.0025, "SIDE_SHOULDER")
    for sx in sides:
        s, e, w = arm_pts(g, sx)
        c = s + np.array([0.02 * sx, 0, 0.025])
        p.add(ellipsoid(c, (r, r * 0.95, r * 0.75)))
        p.sub(ellipsoid(c + np.array([0, 0, -0.022]), (r * 0.86, r * 0.82, r * 0.62)))
        p.add(ellipsoid(c + np.array([0.01 * sx, 0, -0.03]), (r * 0.9, r * 0.85, r * 0.3)), 0.01)
    return p


def cape(g, col="cape", length=0.12, open_deg=120.0):
    p = P("cape", col, 0.0035, {"chest": 1.0, "spine": 0.8, "hips": 0.5, "neck": 0.4})
    rx = lambda z: np.interp(z, [length, 0.3, 0.5, 0.62, 0.68], [0.24, 0.21, 0.175, 0.15, 0.08])  # noqa: E731
    ry = lambda z: np.interp(z, [length, 0.3, 0.5, 0.62, 0.68], [0.2, 0.17, 0.13, 0.11, 0.07])  # noqa: E731
    p.add(lathe_shell(length, 0.68, rx, ry, 0.012, cy_fn=lambda z: 0.03 + 0 * z, open_front_deg=open_deg))
    return p


def apron(g, col="apron", z0=0.18, z1=0.58, w=0.13):
    p = P("apron", col, 0.0025, {"chest": 0.6, "spine": 1.0, "hips": 1.0, "thigh.L": 0.3, "thigh.R": 0.3})
    rx = lambda z: np.interp(z, [z0, 0.33, 0.45, z1], [0.17, 0.15, 0.135, 0.15])  # noqa: E731
    ry = lambda z: np.interp(z, [z0, 0.33, 0.45, z1], [0.13, 0.11, 0.1, 0.1])  # noqa: E731
    p.add(lathe_shell(z0, z1, rx, ry, 0.01, cy_fn=lambda z: 0.006 + 0 * z))
    p.inter(rbox((0, -0.2, (z0 + z1) / 2), (w, 0.2, (z1 - z0) / 2 + 0.01)), 0.008)
    return p


# ------------------------------------------------------------------ 道具
def sword_back():
    p = P("sword", "metal", 0.0018, CHEST)
    a = np.array([0.12, 0.13, 0.78])
    b = np.array([-0.12, 0.12, 0.28])
    ax = unit(b - a)
    p.add(rbox((a + b) / 2, (0.02, 0.006, np.linalg.norm(b - a) / 2), 0.003, _frame(ax)))
    gp = a + ax * 0.05
    hilt = P("sword_hilt", "leather", 0.0018, CHEST)
    hilt.add(capsule(a - ax * 0.07, gp, 0.012))
    p.add(rbox(gp, (0.055, 0.012, 0.01), 0.004, _frame(ax)))
    p.add(ellipsoid(a - ax * 0.08, (0.016, 0.016, 0.016)))
    strap = P("strap", "leather", 0.0018, CHEST)
    pts = bezier3(np.array([0.11, -0.08, 0.62]), np.array([0.02, -0.11, 0.5]), np.array([-0.08, -0.1, 0.4]), np.array([-0.13, -0.05, 0.34]), 12)
    strap.add(flat_tube(pts, np.full(12, 0.015), np.full(12, 0.004), [np.array([0, -1.0, 0])] * 12), 0.006)
    return [p, hilt, strap]


def _frame(z_axis):
    z = unit(np.asarray(z_axis, float))
    x = unit(np.cross([0, 1.0, 0], z)) if abs(z[1]) < 0.9 else unit(np.cross([1.0, 0, 0], z))
    y = np.cross(z, x)
    return np.column_stack([x, y, z])


def staff(g, sx=-1, top_col="glow"):
    hc = hand_pt(g, sx, 0.035)
    p = P("staff", "wood", 0.002, {f"hand.{'L' if sx > 0 else 'R'}": 1.0})
    p.add(capsule((hc[0], hc[1] - 0.01, 0.04), (hc[0], hc[1] - 0.01, 0.98), 0.012, 0.014))
    p.add(torus((hc[0], hc[1] - 0.01, 0.95), 0.045, 0.008, axis=(0, 1, 0)))
    orb = P("staff_orb", top_col, 0.0015, {f"hand.{'L' if sx > 0 else 'R'}": 1.0}).add(ellipsoid((hc[0], hc[1] - 0.01, 0.95), (0.03, 0.03, 0.03)))
    return [p, orb]


def cane(g, sx=-1):
    hc = hand_pt(g, sx, 0.035)
    p = P("cane", "dark", 0.0018, {f"hand.{'L' if sx > 0 else 'R'}": 1.0})
    p.add(capsule((hc[0], hc[1] - 0.03, 0.02), (hc[0], hc[1] - 0.03, hc[2] + 0.02), 0.01))
    top = P("cane_top", "metal", 0.0015, {f"hand.{'L' if sx > 0 else 'R'}": 1.0}).add(ellipsoid((hc[0], hc[1] - 0.03, hc[2] + 0.04), (0.022, 0.022, 0.022)))
    return [p, top]


def book(g, sx=1, col="book", name="book"):
    hc = hand_pt(g, sx, 0.03)
    p = P(name, col, 0.0018, {f"hand.{'L' if sx > 0 else 'R'}": 1.0})
    p.add(rbox(hc + np.array([0.02 * sx, -0.045, 0.0]), (0.012, 0.05, 0.065), 0.004, rot((0, 0, 1), 20 * sx)))
    return p


def hammer_belt(g):
    p = P("hammer", "metal", 0.002, HIPS)
    p.add(rbox((-0.15, -0.06, 0.36), (0.028, 0.02, 0.022), 0.004))
    h = P("hammer_handle", "wood", 0.002, HIPS).add(capsule((-0.15, -0.06, 0.34), (-0.16, -0.05, 0.22), 0.009))
    return [p, h]


def keys(g):
    p = P("keys", "metal", 0.0012, HIPS)
    c = np.array([0.135, -0.07, 0.37])
    p.add(torus(c, 0.02, 0.003, axis=(1, 0, 0)))
    for i, dz in enumerate((-0.03, -0.035, -0.028)):
        q = c + np.array([0.0, -0.006 * (i - 1), dz])
        p.add(capsule(c + np.array([0, -0.006 * (i - 1), -0.018]), q, 0.0035))
        p.add(rbox(q + np.array([0, 0, -0.008]), (0.004, 0.006, 0.008), 0.001))
    return p


def pocket_watch():
    p = P("watch", "metal", 0.0012, CHEST)
    pts = bezier3(np.array([-0.06, -0.105, 0.5]), np.array([-0.02, -0.115, 0.47]), np.array([0.03, -0.115, 0.47]), np.array([0.06, -0.105, 0.49]), 12)
    p.add(flat_tube(pts, np.full(12, 0.0022), np.full(12, 0.0018), [np.array([0, -1.0, 0])] * 12), 0.002)
    p.add(rbox((0.07, -0.103, 0.47), (0.016, 0.006, 0.016), 0.012))
    return p


def star_pendant(z=0.53, glow=True):
    g = P("pendant", "metal", 0.0012, CHEST)
    c = np.array([0.0, -0.11, z])
    for sx in (1, -1):
        pts = bezier3(np.array([0.05 * sx, -0.06, 0.63]), np.array([0.05 * sx, -0.095, 0.6]), np.array([0.02 * sx, -0.11, z + 0.03]), c + np.array([0.006 * sx, 0.0, 0.02]), 10)
        g.add(flat_tube(pts, np.full(10, 0.0022), np.full(10, 0.0018), [np.array([0, -1.0, 0])] * 10), 0.002)
    s = P("pendant_star", "glow" if glow else "metal", 0.001, CHEST)
    for k in range(4):
        a = math.radians(45 * k)
        s.add(rbox(c, (0.006, 0.004, 0.022), 0.002, rot((0, 1, 0), 45 * k)))
    return [g, s]


def bowtie(col="bow"):
    p = P("bowtie", col, 0.0015, NECK)
    for sx in (1, -1):
        p.add(ellipsoid((0.022 * sx, -0.075, 0.645), (0.022, 0.01, 0.016)))
    p.add(ellipsoid((0, -0.08, 0.645), (0.008, 0.008, 0.008)), 0.003)
    return p


def collar(name="collar", col="trim", rx=0.09, ry=0.08, z0=0.6, z1=0.675, open_deg=28.0):
    p = P(name, col, 0.0022, NECK)
    p.add(lathe_shell(z0, z1, lambda z: np.interp(z, [z0, z1], [rx, rx - 0.01]), lambda z: np.interp(z, [z0, z1], [ry, ry - 0.008]), 0.012, cy_fn=lambda z: 0.012 + 0 * z, open_front_deg=open_deg))
    return p


def buttons(zs=(0.47, 0.53, 0.59), y=-0.11, name="buttons"):
    p = P(name, "metal", 0.0012, CHEST)
    for z in zs:
        p.add(ellipsoid((0, y, z), (0.009, 0.006, 0.009)))
    return p


def trim_mask(p, name, col, band=0.03, front_deg=8.0, hem_z=0.1):
    """外套下擺＋前襟滾邊（與洛恩相同做法）"""
    q = P(name, col, 0.0025, p.bind)
    q.ops = [(op, pr, k) for op, pr, k in p.ops]

    def region(Q):
        th = np.arctan2(Q[..., 0], -(Q[..., 1] - 0.006))
        r = np.hypot(Q[..., 0], Q[..., 1])
        b = Q[..., 2] - (hem_z + band)
        e = (np.abs(th) - np.radians(front_deg)) * r
        return np.minimum(b, e)

    q.ops.append(("i", Prim(region, np.array([-1.0, -1.0, -1.0]), np.array([1.0, 1.0, 2.0])), 0.0))
    return q


# ================================================================== 八位 NPC
def npc_swordmaster():
    """劍士軍團教官「雷恩」：紅色頭帶、深紅刺短髮、鋼製胸甲＋單邊肩甲、紅色戰袍、背劍"""
    g = "male"
    H = hair_base(g, BANGS_SPIKE, sweep=10, ex=0.7, spiky=True)
    rx, ry = coat_profile(g, hem_r=0.2)
    tunic = shell("tunic", "cloth", 0.17, 0.688, rx, ry, open_deg=lambda z: np.where(z < 0.42, np.interp(z, [0.17, 0.42], [24.0, 6.0]), 0.0))
    parts = [H.part, headband(g), tunic, trim_mask(tunic, "tunic_trim", "trim", hem_z=0.17), breastplate(g), pauldrons(g, sides=(1,)), trousers(g, "dark"),
             belt("belt", 0.42, 0.148, 0.108), cuffs(g, "bracer", "leather", r=0.04, at=0.62, thick=0.016), collar(col="trim")] + sword_back()
    return {"id": "sword", "name": "劍士軍團教官・雷恩", "gender": g, "parts": parts, "iris": ((0.06, 0.3, 0.12), (0.2, 0.7, 0.35), (0.7, 0.95, 0.65)),
            "colors": {"hair": ((0.42, 0.1, 0.08), (0.7, 0.2, 0.14)), "headband": (0.82, 0.16, 0.18), "tunic": (0.7, 0.16, 0.18), "tunic_trim": (0.95, 0.76, 0.34),
                       "armor": (0.78, 0.8, 0.86), "pauldron": (0.78, 0.8, 0.86), "trousers": (0.2, 0.18, 0.22), "belt": (0.38, 0.24, 0.14), "bracer": (0.42, 0.27, 0.16),
                       "collar": (0.95, 0.76, 0.34), "sword": (0.82, 0.85, 0.9), "sword_hilt": (0.35, 0.2, 0.12), "strap": (0.38, 0.24, 0.14)},
            "keep_extra": set(), "design": "紅色頭帶＋深紅刺短髮、綠眼；鋼製胸甲與左肩甲、深紅戰袍金滾邊；背上長劍與斜背帶"}


def npc_knight():
    """騎士軍團團長「艾德溫」：金髮整齊側分、八字鬍、銀色全胸甲＋雙肩甲、皇家藍披風"""
    g = "male"
    H = hair_base(g, BANGS_SWEEP, sweep=-14, ex=0.6)
    rx, ry = coat_profile(g, hem_r=0.205)
    tabard = shell("tabard", "cloth", 0.15, 0.688, rx, ry, open_deg=lambda z: np.where(z < 0.42, np.interp(z, [0.15, 0.42], [26.0, 8.0]), 0.0))
    emb = P("emblem", "metal", 0.0015, CHEST)
    for k in range(4):
        emb.add(rbox((0, -0.125, 0.53), (0.008, 0.004, 0.032), 0.002, rot((0, 1, 0), 45 * k)))
    parts = [H.part, mustache(g, curl=True, w=0.058), tabard, trim_mask(tabard, "tabard_trim", "trim", hem_z=0.15), breastplate(g), pauldrons(g, r=0.082),
             cape(g, length=0.1), trousers(g, "metal2"), cuffs(g, "gauntlet", "metal", r=0.042, at=0.68, thick=0.02), belt("belt", 0.42, 0.15, 0.11), collar(col="metal"), emb]
    return {"id": "knight", "name": "騎士軍團團長・艾德溫", "gender": g, "parts": parts, "iris": ((0.05, 0.15, 0.4), (0.2, 0.45, 0.9), (0.7, 0.85, 1.0)),
            "colors": {"hair": ((0.78, 0.6, 0.28), (0.98, 0.86, 0.5)), "mustache": (0.72, 0.52, 0.22), "tabard": (0.22, 0.32, 0.66),
                       "tabard_trim": (0.95, 0.76, 0.34), "armor": (0.86, 0.88, 0.92), "pauldron": (0.86, 0.88, 0.92), "cape": (0.18, 0.26, 0.58), "trousers": (0.7, 0.72, 0.78),
                       "gauntlet": (0.8, 0.82, 0.88), "belt": (0.36, 0.24, 0.16), "collar": (0.86, 0.88, 0.92), "emblem": (0.95, 0.76, 0.34)},
            "keep_extra": set(), "design": "金髮側分、翹八字鬍、藍眼；銀色胸甲＋雙肩甲＋護手、皇家藍罩袍與披風、胸前金星徽"}


def npc_smith():
    """鐵匠師傅「巴爾克」：光頭＋濃密大鬍子、護目鏡、皮圍裙、腰間鐵鎚"""
    g = "male"
    H = hair_base(g, (), ex=0.45, cap=False, crown=False)  # 光頭：只用兩側與後腦的短髮
    rx, ry = coat_profile(g, hem_r=0.17)
    shirt = shell("work_shirt", "cloth", 0.33, 0.688, rx, ry)
    parts = [H.part, beard(g, big=True), mustache(g, curl=False, w=0.075), *goggles(g), shirt, apron(g), trousers(g, "dark", rr=1.06),
             belt("belt", 0.4, 0.15, 0.11, w=0.03), cuffs(g, "wristband", "leather", r=0.042, at=0.7, thick=0.018)] + hammer_belt(g)
    return {"id": "smith", "name": "鐵匠師傅・巴爾克", "gender": g, "parts": parts, "iris": ((0.3, 0.14, 0.04), (0.75, 0.42, 0.12), (1.0, 0.8, 0.45)),
            "colors": {"hair": ((0.34, 0.2, 0.12), (0.5, 0.3, 0.18)), "beard": (0.45, 0.25, 0.14), "mustache": (0.45, 0.25, 0.14), "goggles": (0.3, 0.2, 0.13),
                       "goggle_lens": (0.55, 0.75, 0.85), "work_shirt": (0.86, 0.8, 0.66), "apron": (0.46, 0.3, 0.18), "trousers": (0.3, 0.28, 0.3), "belt": (0.3, 0.2, 0.12),
                       "wristband": (0.35, 0.22, 0.13), "hammer": (0.5, 0.52, 0.56), "hammer_handle": (0.48, 0.32, 0.2)},
            "keep_extra": set(), "bald": True, "design": "光頭、濃密棕色大鬍子、橘褐眼；額上護目鏡、米色工作衫＋厚皮圍裙、腰間鐵鎚、皮護腕"}


def npc_mage():
    """法師軍團導師「瑟琳娜」：銀紫長髮、紫色大巫師帽（金星帶）、星紋紫長袍、法杖"""
    g = "female"
    H = hair_base(g, BANGS_SWEEP, sweep=-12, ex=0.6)
    long_back(H, g, length=0.5)
    H.part.bind = {"head": 1.0, "neck": 1.0, "chest": 1.0}  # 垂到背後的長髮：下段跟著上身
    rx, ry = coat_profile(g, hem_r=0.23)
    robe = shell("robe", "cloth", 0.06, 0.688, rx, ry, open_deg=lambda z: np.where(z < 0.4, np.interp(z, [0.06, 0.4], [18.0, 4.0]), 0.0))
    hat, band = hat_wizard(g)
    parts = [H.part, hat, band, robe, trim_mask(robe, "robe_trim", "trim", hem_z=0.06), sleeves(g, "sleeves", "cloth", r0=0.052, r1=0.06), cuffs(g, "cuff", "trim", r=0.058, at=0.8, thick=0.012),
             belt("sash", 0.43, 0.143, 0.104, w=0.03, group="cloth"), collar(col="trim")] + staff(g, -1) + star_pendant(0.54)
    return {"id": "mage", "name": "法師軍團導師・瑟琳娜", "gender": g, "parts": parts, "iris": ((0.25, 0.08, 0.4), (0.62, 0.35, 0.92), (0.9, 0.8, 1.0)),
            "colors": {"hair": ((0.68, 0.62, 0.82), (0.92, 0.9, 1.0)), "hat": (0.36, 0.22, 0.62), "hat_band": (0.95, 0.76, 0.34), "robe": (0.4, 0.26, 0.68), "robe_trim": (0.95, 0.76, 0.34),
                       "sleeves": (0.4, 0.26, 0.68), "cuff": (0.95, 0.76, 0.34), "sash": (0.22, 0.2, 0.45), "collar": (0.95, 0.76, 0.34), "staff": (0.42, 0.28, 0.18), "staff_orb": (0.7, 0.6, 1.0),
                       "pendant": (0.95, 0.76, 0.34), "pendant_star": (0.8, 0.75, 1.0)},
            "keep_extra": set(), "design": "銀紫長髮、紫眼；紫色大巫師帽＋金帶、紫色長袍金滾邊與長袖、胸前星形墜飾、右手發光法杖"}


def npc_priest():
    """祭司教堂導師「艾莉亞」：白色頭紗（金邊）、淡金瀏海、白與天空藍長袍、聖典、星願墜飾"""
    g = "female"
    H = hair_base(g, BANGS_SHORT, sweep=-6, ex=0.5)
    rx, ry = coat_profile(g, hem_r=0.225)
    robe = shell("robe", "cloth", 0.05, 0.688, rx, ry)
    over = shell("stole", "cloth2", 0.2, 0.688, [(z, r + 0.004) for z, r in rx], [(z, r + 0.004) for z, r in ry], open_deg=lambda z: 150.0 + 0 * z, thick=0.008)
    parts = [H.part, veil(g), robe, trim_mask(robe, "robe_trim", "trim", hem_z=0.05, front_deg=0.0), over, sleeves(g, "sleeves", "cloth", r0=0.052, r1=0.064),
             cuffs(g, "cuff", "trim", r=0.06, at=0.82, thick=0.012), belt("sash", 0.43, 0.143, 0.104, w=0.026, group="trim"), book(g, 1)] + star_pendant(0.55)
    return {"id": "church", "name": "祭司教堂導師・艾莉亞", "gender": g, "parts": parts, "iris": ((0.08, 0.25, 0.4), (0.35, 0.68, 0.92), (0.82, 0.94, 1.0)),
            "colors": {"hair": ((0.88, 0.76, 0.5), (1.0, 0.94, 0.72)), "veil": (0.97, 0.96, 0.94), "robe": (0.97, 0.96, 0.93), "robe_trim": (0.95, 0.76, 0.34), "stole": (0.48, 0.66, 0.9),
                       "sleeves": (0.97, 0.96, 0.93), "cuff": (0.95, 0.76, 0.34), "sash": (0.95, 0.76, 0.34), "book": (0.3, 0.42, 0.72), "pendant": (0.95, 0.76, 0.34), "pendant_star": (1.0, 0.9, 0.6)},
            "keep_extra": set(), "design": "白色頭紗、淡金瀏海、天藍眼；白長袍＋天空藍披肩、金腰帶、左手聖典、胸前星願墜飾"}


def npc_clown():
    """小丑馬戲團團長「波波洛」：紅色高禮帽、橘色捲髮、紅鼻子、紅色燕尾服、條紋褲、領結、手杖"""
    g = "male"
    H = hair_base(g, BANGS_SHORT, ex=0.55, spiky=False)
    for sx in (1, -1):
        for dz, dy in ((0.0, 0.0), (0.05, 0.03), (-0.05, 0.02)):
            H.part.add(ellipsoid((0.2 * sx, 0.03 + dy, 0.84 + dz), (0.05, 0.05, 0.045)), 0.02)
    hat, band = top_hat("hat")
    rx, ry = coat_profile(g, hem_r=0.2)
    coat = shell("tailcoat", "cloth", 0.12, 0.688, rx, ry, open_deg=lambda z: np.where(z < 0.45, np.interp(z, [0.12, 0.3, 0.45], [70.0, 40.0, 10.0]), 6.0))
    vest = shell("vest", "cloth2", 0.36, 0.64, [(z, r - 0.008) for z, r in rx], [(z, r - 0.006) for z, r in ry], thick=0.01)
    parts = [H.part, clown_nose(), hat, band, coat, trim_mask(coat, "coat_trim", "trim", hem_z=0.12, front_deg=10.0), vest, buttons(y=-0.098), bowtie(), trousers(g, "stripe"),
             cuffs(g, "cuff", "trim", r=0.04, at=0.72), collar(col="cloth2")] + cane(g, -1)
    return {"id": "circus", "name": "小丑馬戲團團長・波波洛", "gender": g, "parts": parts, "iris": ((0.05, 0.3, 0.2), (0.2, 0.75, 0.55), (0.7, 1.0, 0.85)),
            "colors": {"hair": ((0.85, 0.38, 0.12), (1.0, 0.62, 0.25)), "nose": (0.92, 0.14, 0.18), "hat": (0.78, 0.18, 0.22), "hat_band": (0.95, 0.76, 0.34),
                       "tailcoat": (0.78, 0.18, 0.22), "coat_trim": (0.95, 0.76, 0.34), "vest": (0.98, 0.9, 0.72), "buttons": (0.95, 0.76, 0.34), "bowtie": (0.25, 0.36, 0.72),
                       "cuff": (0.95, 0.76, 0.34), "collar": (0.98, 0.94, 0.86), "cane": (0.15, 0.13, 0.18), "cane_top": (0.95, 0.76, 0.34)},
            "stripes": {"trousers": ((0.98, 0.94, 0.86), (0.78, 0.18, 0.22))},
            "keep_extra": set(), "makeup": True, "design": "紅色高禮帽金帶、橘色捲髮、紅鼻子、綠眼、臉頰星星彩繪；紅色燕尾服＋奶油背心、藍領結、紅白條紋褲、手杖"}


def npc_warehouse():
    """倉庫管理員「米拉」：棕髮包子頭＋頭巾、圓框眼鏡、綠色工作圍裙、記帳本、鑰匙串"""
    g = "female"
    H = hair_base(g, BANGS_SHORT, sweep=-10, ex=0.55)
    bun(H, g, at=(0.0, 0.2, 0.96), r=0.072)
    rx, ry = coat_profile(g, hem_r=0.19)
    blouse = shell("blouse", "cloth", 0.3, 0.688, rx, ry)
    skirt = shell("skirt", "cloth2", 0.12, 0.44, [(0.12, 0.2), (0.3, 0.17), (0.44, 0.145)], [(0.12, 0.16), (0.3, 0.13), (0.44, 0.105)])
    parts = [H.part, glasses(g), headband(g, col="band"), blouse, skirt, apron(g, z0=0.16, z1=0.6, w=0.12), sleeves(g, "sleeves", "cloth", r0=0.048, r1=0.042, to=0.6),
             belt("belt", 0.44, 0.146, 0.106), keys(g), book(g, 1, col="ledger", name="ledger"), trousers(g, "dark", rr=0.9)]
    return {"id": "warehouse", "name": "倉庫管理員・米拉", "gender": g, "parts": parts, "iris": ((0.22, 0.14, 0.05), (0.55, 0.42, 0.18), (0.88, 0.78, 0.5)),
            "colors": {"hair": ((0.36, 0.22, 0.12), (0.55, 0.36, 0.2)), "glasses": (0.45, 0.3, 0.18), "headband": (0.3, 0.55, 0.4), "blouse": (0.97, 0.94, 0.86), "skirt": (0.42, 0.32, 0.22),
                       "apron": (0.32, 0.56, 0.42), "sleeves": (0.97, 0.94, 0.86), "belt": (0.36, 0.24, 0.14), "keys": (0.9, 0.74, 0.36), "ledger": (0.55, 0.32, 0.2), "trousers": (0.3, 0.26, 0.22)},
            "keep_extra": set(), "design": "棕髮包子頭＋綠頭巾、圓框眼鏡、榛色眼；米白襯衫＋綠色工作圍裙、腰間金鑰匙串、左手記帳本"}


def npc_guild():
    """星願商會掌櫃「葛蘭特」：黑髮油頭、捲翹八字鬍、金色單片眼鏡、深藍背心＋白襯衫、懷錶鍊、天秤胸章"""
    g = "male"
    H = hair_base(g, ((-30, 30, 0.17, 0.35), (0, 34, 0.17, 0.35), (30, 30, 0.17, 0.35)), sweep=0, ex=0.45)
    rx, ry = coat_profile(g, hem_r=0.165)
    shirt = shell("shirt_w", "cloth", 0.32, 0.688, rx, ry)
    vest = shell("vest", "cloth2", 0.33, 0.645, [(z, r + 0.006) for z, r in rx], [(z, r + 0.006) for z, r in ry], open_deg=lambda z: np.interp(z, [0.33, 0.5, 0.645], [8.0, 12.0, 30.0]), thick=0.01)
    pin = P("pin", "metal", 0.0012, CHEST)
    pin.add(rbox((0.07, -0.112, 0.58), (0.016, 0.003, 0.002), 0.001))
    pin.add(capsule((0.07, -0.112, 0.565), (0.07, -0.112, 0.58), 0.002))
    for sx in (1, -1):
        pin.add(ellipsoid((0.07 + 0.014 * sx, -0.112, 0.565), (0.007, 0.003, 0.003)))
    parts = [H.part, mustache(g, curl=True, w=0.075), monocle(g), shirt, vest, buttons(zs=(0.4, 0.45, 0.5, 0.55), y=-0.108), pocket_watch(), pin, bowtie("bow"), trousers(g, "dark"),
             cuffs(g, "cuff", "cloth", r=0.04, at=0.75), collar(col="cloth", rx=0.085, ry=0.075, open_deg=24.0)]
    return {"id": "guild", "name": "星願商會掌櫃・葛蘭特", "gender": g, "parts": parts, "iris": ((0.18, 0.2, 0.24), (0.45, 0.5, 0.58), (0.85, 0.88, 0.95)),
            "colors": {"hair": ((0.12, 0.11, 0.14), (0.3, 0.3, 0.36)), "mustache": (0.14, 0.12, 0.14), "monocle": (0.95, 0.76, 0.34), "shirt_w": (0.97, 0.96, 0.94),
                       "vest": (0.2, 0.26, 0.5), "buttons": (0.95, 0.76, 0.34), "watch": (0.95, 0.76, 0.34), "pin": (0.95, 0.76, 0.34), "bowtie": (0.55, 0.16, 0.2),
                       "trousers": (0.18, 0.18, 0.24), "cuff": (0.97, 0.96, 0.94), "collar": (0.97, 0.96, 0.94)},
            "keep_extra": set(), "design": "黑色油頭、捲翹八字鬍、灰眼＋金色單片眼鏡；白襯衫＋深藍背心金扣、酒紅領結、懷錶金鍊、天秤胸章"}


NPCS = {f.__name__[4:]: f for f in (npc_swordmaster, npc_knight, npc_smith, npc_mage, npc_priest, npc_clown, npc_warehouse, npc_guild)}
NPC_ORDER = ["swordmaster", "knight", "smith", "mage", "priest", "clown", "warehouse", "guild"]
