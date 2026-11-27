"""Stage 6.7 各 NPC 骨架位置（原始 Tripo 單位、轉正後；z 省略＝自動取附近頂點中位數）、權重參數、個性動作。"""
import math
from rig67 import qeuler

S = lambda t, p, ph=0.0: math.sin(2 * math.pi * (t / p + ph))

# 固定 NPC 的腿不動：腿部骨頭只放在大略位置（leg_r=0 → 下半身全部綁骨盆）
def legs(hx, hy, ky, ay, z=0.0):
    return {
        'thigh.R': (-hx, hy, z), 'shin.R': (-hx, ky, z), 'foot.R': (-hx, ay, z), 'toe.R': (-hx, 0.02, z + 0.06),
        'thigh.L': (hx, hy, z), 'shin.L': (hx, ky, z), 'foot.L': (hx, ay, z), 'toe.L': (hx, 0.02, z + 0.06),
    }


def torso(h, sp, ch, nk, hd, z=None):
    return {'root': (0, 0, 0), 'hips': (0, h, z), 'spine': (0, sp, z), 'chest': (0, ch, z), 'neck': (0, nk, z), 'head': (0, hd, z)}


CFGS = {}

# ------------------------------------------------------------- N001 劍士教官 雷恩
CFGS['swordmaster'] = dict(
    joints={**torso(0.38, 0.46, 0.56, 0.70, 0.735, 0.0), **legs(0.07, 0.36, 0.24, 0.08),
            'upperarm.R': (-0.115, 0.665, 0.02), 'forearm.R': (-0.165, 0.60, 0.09), 'hand.R': (-0.20, 0.565, 0.15), 'handend.R': (-0.22, 0.52, 0.16),
            'upperarm.L': (0.115, 0.665, 0.0), 'forearm.L': (0.16, 0.575, 0.04), 'hand.L': (0.155, 0.49, 0.045), 'handend.L': (0.155, 0.43, 0.04)},
    leg_r=0.0, arm_r=[0.055, 0.05, 0.05], arm_blend=0.05, smooth=3,
    props=[('hand.R', 'cap', [(-0.22, 0.53, 0.16), (-0.235, 0.0, 0.165), 0.05]),
           ('hand.R', 'box', [(-0.31, 0.42, 0.08), (-0.14, 0.53, 0.22)])],
    anim=dict(breath=1.2, look=3.0, armBreath=0.8,
              act=lambda t, w: {'chest': qeuler(pitch=-1.2 * w), 'head': qeuler(pitch=-4.0 * w, yaw=5.0 * w * S(t, 2.6)), 'neck': qeuler(pitch=-1.5 * w)},
              actDur=2.6),
)

# ------------------------------------------------------------- N002 騎士團長 艾德溫
CFGS['knight'] = dict(
    joints={**torso(0.38, 0.46, 0.56, 0.70, 0.735, 0.0), **legs(0.075, 0.36, 0.24, 0.08),
            'upperarm.R': (-0.125, 0.665, 0.0), 'forearm.R': (-0.19, 0.625, 0.06), 'hand.R': (-0.235, 0.595, 0.12), 'handend.R': (-0.255, 0.565, 0.14),
            'upperarm.L': (0.13, 0.665, 0.0), 'forearm.L': (0.17, 0.58, 0.03), 'hand.L': (0.18, 0.50, 0.05), 'handend.L': (0.18, 0.44, 0.05)},
    leg_r=0.0, arm_r=[0.055, 0.05, 0.05], arm_blend=0.05, smooth=3,
    props=[('hand.R', 'cap', [(-0.24, 0.56, 0.13), (-0.22, 0.0, 0.12), 0.035]),
           ('hand.R', 'box', [(-0.31, 0.41, 0.06), (-0.15, 0.50, 0.20)]),
           ('hand.L', 'box', [(0.125, 0.10, -0.03), (0.34, 0.70, 0.23)])],
    anim=dict(breath=1.1, look=2.5, armBreath=0.5,
              act=lambda t, w: {'chest': qeuler(pitch=-1.2 * w), 'neck': qeuler(pitch=-1.5 * w), 'head': qeuler(pitch=-3.5 * w, yaw=-4.0 * w * S(t, 2.6))},
              actDur=2.6),
)

# ------------------------------------------------------------- N003 鐵匠 巴爾克（右手扛錘：右手臂不做動作）
CFGS['smith'] = dict(
    joints={**torso(0.36, 0.44, 0.54, 0.665, 0.70, 0.0), **legs(0.09, 0.33, 0.2, 0.08),
            'upperarm.R': (-0.15, 0.65, 0.0), 'forearm.R': (-0.20, 0.56, 0.13), 'hand.R': (-0.205, 0.67, 0.20), 'handend.R': (-0.21, 0.73, 0.22),
            'upperarm.L': (0.16, 0.65, 0.0), 'forearm.L': (0.265, 0.56, 0.02), 'hand.L': (0.21, 0.49, 0.05), 'handend.L': (0.15, 0.45, 0.06)},
    leg_r=0.0, arm_r=[0.07, 0.06, 0.055], arm_blend=0.06, smooth=3,
    props=[('hand.R', 'cap', [(-0.34, 0.655, 0.225), (-0.10, 0.735, 0.08), 0.04]),
           ('hand.R', 'cap', [(0.06, 0.80, -0.10), (0.17, 0.835, -0.17), 0.04]),
           ('hand.R', 'box', [(0.07, 0.70, -0.35), (0.36, 0.99, -0.06)])],
    anim=dict(breath=1.4, look=2.5, armBreath=0.0,
              act=lambda t, w: {'chest': qeuler(pitch=-3.0 * w * (0.6 + 0.4 * abs(S(t, 0.45)))), 'head': qeuler(pitch=-5.0 * w * abs(S(t, 0.45)), roll=1.5 * w),
                                'spine': qeuler(pitch=-1.5 * w)},
              actDur=2.4),
)

# ------------------------------------------------------------- N004 法師導師 瑟琳娜
CFGS['mage'] = dict(
    joints={**torso(0.38, 0.46, 0.55, 0.66, 0.69, 0.0), **legs(0.06, 0.36, 0.22, 0.08),
            'upperarm.R': (-0.115, 0.64, 0.0), 'forearm.R': (-0.15, 0.52, 0.04), 'hand.R': (-0.18, 0.585, 0.13), 'handend.R': (-0.19, 0.60, 0.16),
            'upperarm.L': (0.11, 0.64, 0.0), 'forearm.L': (0.17, 0.58, 0.03), 'hand.L': (0.235, 0.635, 0.06), 'handend.L': (0.30, 0.66, 0.09)},
    leg_r=0.0, arm_r=[0.055, 0.05, 0.045], arm_blend=0.05, smooth=3,
    props=[('hand.R', 'box', [(-0.34, 0.64, 0.05), (-0.19, 0.95, 0.25)]),
           ('hand.R', 'cap', [(-0.19, 0.66, 0.15), (-0.20, 0.08, 0.13), 0.03])],
    anim=dict(breath=1.0, look=1.5, armBreath=0.5, nod=1.5,
              talk=lambda t: {'forearm.L': qeuler(yaw=4.0 * S(t, 1.0), roll=2.0 * S(t, 2.0))},
              act=lambda t, w: {'forearm.L': qeuler(yaw=10.0 * w * S(t, 1.3), roll=-4.0 * w), 'upperarm.L': qeuler(roll=4.0 * w),
                                'head': qeuler(roll=-1.2 * w, yaw=1.5 * w)},
              actDur=2.6),
)

# ------------------------------------------------------------- N005 祭司 艾莉亞
CFGS['priest'] = dict(
    joints={**torso(0.37, 0.45, 0.54, 0.645, 0.67, 0.0), **legs(0.06, 0.35, 0.2, 0.08),
            'upperarm.R': (-0.12, 0.62, 0.0), 'forearm.R': (-0.17, 0.54, 0.08), 'hand.R': (-0.18, 0.60, 0.17), 'handend.R': (-0.185, 0.62, 0.20),
            'upperarm.L': (0.12, 0.62, 0.0), 'forearm.L': (0.17, 0.55, 0.05), 'hand.L': (0.24, 0.61, 0.14), 'handend.L': (0.30, 0.63, 0.18)},
    leg_r=0.0, arm_r=[0.055, 0.05, 0.045], arm_blend=0.05, smooth=3,
    props=[('hand.R', 'box', [(-0.33, 0.64, 0.10), (-0.17, 0.99, 0.30)]),
           ('hand.R', 'cap', [(-0.20, 0.64, 0.20), (-0.21, 0.02, 0.20), 0.03])],
    anim=dict(breath=1.0, look=1.5, armBreath=0.5, nod=1.5,
              talk=lambda t: {'forearm.L': qeuler(pitch=-3.0 * S(t, 1.0))},
              act=lambda t, w: {'spine': qeuler(pitch=3.5 * w), 'chest': qeuler(pitch=2.5 * w), 'head': qeuler(pitch=1.5 * w)},
              actDur=3.0),
)

# ------------------------------------------------------------- N006 小丑團長 波波洛
CFGS['clown'] = dict(
    joints={**torso(0.37, 0.45, 0.55, 0.655, 0.69, 0.0), **legs(0.06, 0.35, 0.2, 0.08),
            'upperarm.R': (-0.115, 0.66, 0.0), 'forearm.R': (-0.16, 0.67, 0.09), 'hand.R': (-0.19, 0.69, 0.17), 'handend.R': (-0.25, 0.71, 0.24),
            'upperarm.L': (0.115, 0.66, -0.02), 'forearm.L': (0.195, 0.53, -0.03), 'hand.L': (0.21, 0.63, 0.0), 'handend.L': (0.22, 0.70, 0.0)},
    leg_r=0.0, arm_r=[0.055, 0.05, 0.05], arm_blend=0.05, smooth=3,
    props=[('hand.L', 'box', [(0.15, 0.63, -0.07), (0.29, 0.77, 0.08)])],
    anim=dict(breath=1.3, look=4.0, armBreath=1.0, headRoll=-1.5,
              talk=lambda t: {'forearm.L': qeuler(roll=3.0 * S(t, 1.0)), 'spine': qeuler(roll=1.5 * S(t, 2.0))},
              act=lambda t, w: {'spine': qeuler(roll=4.0 * w * S(t, 1.2)), 'chest': qeuler(roll=2.0 * w * S(t, 1.2)), 'head': qeuler(roll=-4.0 * w * S(t, 1.2), yaw=3.0 * w),
                                'forearm.L': qeuler(yaw=8.0 * w * S(t, 0.6))},
              actDur=2.4),
)

# ------------------------------------------------------------- N007 倉庫管理員 米拉（左手扶帽：頭部動作小，避免手與帽子分開）
CFGS['warehouse'] = dict(
    joints={**torso(0.37, 0.45, 0.55, 0.67, 0.70, 0.0), **legs(0.06, 0.35, 0.2, 0.08),
            'upperarm.R': (-0.11, 0.66, 0.0), 'forearm.R': (-0.185, 0.60, 0.02), 'hand.R': (-0.13, 0.58, 0.06), 'handend.R': (-0.09, 0.57, 0.08),
            'upperarm.L': (0.12, 0.66, 0.0), 'forearm.L': (0.215, 0.75, 0.05), 'hand.L': (0.17, 0.84, 0.04), 'handend.L': (0.13, 0.89, 0.03)},
    leg_r=0.0, arm_r=[0.05, 0.045, 0.045], arm_blend=0.05, smooth=3,
    anim=dict(breath=1.1, look=1.2, armBreath=0.5, nod=1.0,
              act=lambda t, w: {'spine': qeuler(roll=3.0 * w * S(t, 1.2)), 'chest': qeuler(roll=1.5 * w * S(t, 1.2)), 'neck': qeuler(roll=-2.0 * w * S(t, 1.2))},
              actDur=2.4),
)

# ------------------------------------------------------------- N009 寵物商人 洛恩（腿部 IK 步行）
from cfg_merchant import CFG as _M
CFGS['merchant'] = dict(_M, anim=dict(breath=1.2, look=3.0, armBreath=1.0,
                                      talk=lambda t: {'forearm.R': qeuler(pitch=-4.0 * max(0.0, S(t, 1.0)))}))
