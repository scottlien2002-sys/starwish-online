"""
Stage 7.5 新版男性初心者建置（純 Python／numpy；GLB 讀寫由 write75.mjs 處理）。
python3 art/novice75/build75.py <decoded.glb> <c10b5b_male_hq.glb> <novice_combat_male.json> <out dir>

輸出：
  n75_data.json      轉正（旋轉、縮放）、輔助骨骼、武器掛點、所有動畫、標記（命中時間）、量測值、修正報告
  n75_skin.bin       新的 JOINTS_0（uint8×4）＋WEIGHTS_0（float32×4）
  preview/*.png      本機軟體算繪預覽（蒙皮修正前後、每段動作的關鍵影格）
原始 GLB 不修改。
"""
import sys, os, json, time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gl import load, acc, Skel, qaxis, qnorm, qmul, qinv, m2q, trs  # noqa: E402
from weights75 import fix_weights  # noqa: E402
from anim75 import (Target, Retargeter, sample_gltf_anim, sample_json_clip, clip_from_world, ground_fix, keyed_clip,  # noqa: E402
                    blend_frames, resample, hem_bake, ground_speed, pose_from_rots, rotq, FPS, X, Y, Z,
                    native_clip, loop_blend, loop_gap, offhand_grip)
import preview as pv  # noqa: E402

SRC, REF, COMBAT, OUT = sys.argv[1:5]
NATIVE = sys.argv[5] if len(sys.argv) > 5 else None  # Stage 7.5 第二階段：Tripo 重新匯出（含 walk／run／wait／idle）
os.makedirs(os.path.join(OUT, "preview"), exist_ok=True)
T0 = time.time()
REPORT = {"tool": "art/novice75/build75.py", "source": os.path.basename(SRC)}


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


HEIGHT_M = 1.25  # 與 C1.0-B5b 相同（鏡頭、寵物錨點、攻擊距離不變）

# ---------------- 讀取 ----------------
j, binb = load(SRC)
skin = j["skins"][0]
joints = list(skin["joints"])
IBM = acc(j, binb, skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
names = [j["nodes"][i]["name"] for i in joints]
P, N, UV, J, Wt, I, VCOL = pv.mesh_data(j, binb)
nv = len(P)
S_bind = Skel(j)
W_bind = S_bind.world()
jw = {j["nodes"][i]["name"]: W_bind[i][:3, 3] for i in joints}
H = P[:, 1].max() - P[:, 1].min()
scale = HEIGHT_M / H
ROOT_Q = qaxis([0, 1, 0], -np.pi / 2)  # Tripo 面向 +X → 遊戲標準 +Z
REPORT["source_check"] = {
    "triangles": int(len(I)), "vertices": int(nv), "joints": len(joints), "animations_in_file": len(j.get("animations", [])),
    "materials": len(j.get("materials", [])), "textures": len(j.get("textures", [])),
    "height_original": round(float(H), 4), "scale_to_1_25m": round(float(scale), 4), "facing_original": "+X（轉 −90° 成 +Z）",
    "influences_max": 4, "unweighted_vertices": int((Wt.sum(1) < 1e-6).sum()),
}
log("source", REPORT["source_check"])

# ---------------- 蒙皮修正＋輔助骨骼 ----------------
Wd = np.zeros((nv, len(joints)))
for k in range(4):
    np.add.at(Wd, (np.arange(nv), J[:, k]), Wt[:, k])
order, top4, hdefs = fix_weights(P, I, Wd, names, jw, REPORT, VCOL)
log("weights", REPORT["weights"])

# 輔助骨骼加進節點階層（在原始空間；骨骼朝向與父骨骼相同）
helpers = []
for h in hdefs:
    pi = S_bind.idx[h["parent"]]
    Wp = W_bind[pi]
    pivot = np.array(h["pivot"])
    # 區域位移：在父骨骼空間；區域旋轉＝單位（朝向跟父骨骼一樣）
    lt = (np.linalg.inv(Wp) @ np.r_[pivot, 1])[:3]
    ni = len(j["nodes"])
    j["nodes"].append({"name": h["name"], "translation": lt.tolist()})
    j["nodes"][pi].setdefault("children", []).append(ni)
    Wh = Wp @ trs(lt)
    helpers.append({"name": h["name"], "parent": h["parent"], "translation": lt.tolist(), "rotation": [0, 0, 0, 1], "ibm": np.linalg.inv(Wh).T.ravel().tolist(), "verts": h["verts"]})
joint_names = names + [h["name"] for h in helpers]
REPORT["helpers"] = [{k: v for k, v in h.items() if k != "ibm"} for h in helpers]

# ---------------- 武器掛點 ----------------
sockets = []
for S_, side in (("R_", "Weapon_R"), ("L_", "Weapon_L")):
    hand = jw[S_ + "Hand"]
    mid = jw[S_ + "Mid1"]
    idx = jw[S_ + "Index1"]
    pin = jw[S_ + "Pinky1"]
    thb = jw[S_ + "Thumb1"]
    fing = mid - hand
    fing /= np.linalg.norm(fing)
    across = idx - pin
    across /= np.linalg.norm(across)
    # 握把軸＝拇指側（食指→小指的反方向），刀身朝拇指那一側伸出；掌心法線
    grip = across - fing * (across @ fing)
    grip /= np.linalg.norm(grip)
    palm = np.cross(fing, grip)
    # 掌心朝身體內側（左手、右手法線方向相反）
    toward_mid = (np.array([0, hand[1], 0]) - hand)
    if palm @ toward_mid < 0:
        palm = -palm
    center = hand + fing * 0.6 * np.linalg.norm(mid - hand) + palm * 0.012
    # 掛點座標系：+Y＝刀身方向（grip）、+Z＝手指方向、+X＝掌心法線（右手系）
    ybx = grip
    zbx = fing
    xbx = np.cross(ybx, zbx)
    Mw = np.eye(4)
    Mw[:3, 0], Mw[:3, 1], Mw[:3, 2], Mw[:3, 3] = xbx, ybx, zbx, center
    hi = S_bind.idx[S_ + "Hand"]
    Ml = np.linalg.inv(W_bind[hi]) @ Mw
    sc_ = np.linalg.norm(Ml[:3, :3], axis=0)
    q = m2q(Ml[:3, :3] / sc_)
    t = Ml[:3, 3]
    ni = len(j["nodes"])
    j["nodes"].append({"name": side, "translation": t.tolist(), "rotation": q.tolist(), "scale": (1 / sc_).tolist()})
    j["nodes"][hi].setdefault("children", []).append(ni)
    sockets.append({"name": side, "parent": S_ + "Hand", "translation": t.tolist(), "rotation": q.tolist(), "scale": (1 / sc_).tolist()})
REPORT["sockets"] = [{"name": s["name"], "parent": s["parent"]} for s in sockets]

# ---------------- 目標骨架（轉正、縮放） ----------------
S = Skel(j, {"Armature": (None, ROOT_Q, [scale] * 3)})
tgt = Target(S)
src_j, src_b = load(REF)
SRC_S = Skel(src_j)
anims = {a["name"]: a for a in src_j["animations"]}
_, _idle_src = sample_gltf_anim(src_j, src_b, anims["Idle"], SRC_S)
rt = Retargeter(SRC_S, tgt, neutral=_idle_src[0])
# Tripo 自然站姿：上臂再往身體靠 4°、手肘微彎 12°（站立時不僵直）
for S_, sgn in (("L_", 1), ("R_", -1)):
    ua = S.idx[S_ + "Upperarm"]
    fa = S.idx[S_ + "Forearm"]
    rt.A[S_ + "Upperarm"] = qmul(qaxis(Z, np.radians(-4 * sgn)), rt.A[S_ + "Upperarm"])
    rt.A[S_ + "Forearm"] = qmul(qaxis(X, np.radians(-12)), qmul(qaxis(Z, np.radians(-4 * sgn)), rt.A[S_ + "Forearm"]))
    rt.A[S_ + "Hand"] = qmul(qaxis(X, np.radians(-12)), qmul(qaxis(Z, np.radians(-4 * sgn)), rt.A[S_ + "Hand"]))
REPORT["retarget"] = {"leg_ratio": round(float(rt.k), 3)}
log("leg ratio", rt.k)

CLIPS = {}
MARKS = {}
LOOP = set()


def add(name, frames, marks=None, loop=False, ground=True, per_frame=False):
    fr = frames
    dy = None
    if ground:
        fr, dy = ground_fix(tgt, fr, per_frame=per_frame)
    fr = hem_bake(tgt, fr)
    CLIPS[name] = fr
    MARKS[name] = marks or {}
    if loop:
        LOOP.add(name)
    log("clip", name, f"{(len(fr) - 1) / FPS:.2f}s", "ground dy", dy)


# A. 重定向
for nm in ("Idle", "Run", "Attack", "Hurt", "Death", "Jump"):
    dur, fr = sample_gltf_anim(src_j, src_b, anims[nm], SRC_S)
    out = clip_from_world(tgt, [rt.frame(R, T) for R, T in fr], loop=nm in ("Idle", "Run"))
    # 動作原本的「接地」設定：Death 倒地、Jump 騰空 → 只用 Idle 的接地量
    add(nm, out, loop=nm in ("Idle", "Run"), ground=nm in ("Idle", "Run", "Attack", "Hurt"))
MARKS["Attack"] = {"hit": 0.2 / 0.5 * (len(CLIPS["Attack"]) - 1) / FPS}

combat = json.load(open(COMBAT))
for nm, clip in combat["clips"].items():
    dur, fr = sample_json_clip(clip, SRC_S, combat["joints"])
    out = clip_from_world(tgt, [rt.frame(R, T) for R, T in fr], loop=False)
    add(nm, out, marks=clip.get("marks"), ground=nm not in ("Skill_LeapSlam",))

# B. 移動與待機
NATIVE_REPORT = None
if NATIVE:
    # Tripo 原生動畫（同一套骨架；幾何、權重與第一版相同，只是轉了 90°）→ 轉到已修正的模型，蒙皮修正與輔助骨骼保留
    j2, b2 = load(NATIVE)
    NATIVE_REPORT = {"file": os.path.basename(NATIVE), "animations": []}
    speeds = {}
    for a in j2.get("animations", []):
        nm = {"walk": "Walk", "run": "Run", "wait": "Wait", "idle": "Idle"}.get(a["name"].lower())
        if not nm:
            continue
        fr, spd, dur = native_clip(tgt, j2, b2, a, scale)
        gap = loop_gap(fr)
        fr = loop_blend(fr) if gap > 1.0 else fr
        speeds[nm] = spd
        NATIVE_REPORT["animations"].append({"name": a["name"], "clip": nm, "seconds": dur, "channels": len(a["channels"]), "rootMotion_mps": spd, "loopGapDeg": gap})
        add(nm, fr, loop=True)
    idle = CLIPS["Idle"]
    base = idle[0]
    REPORT["native"] = NATIVE_REPORT
    REPORT["nativeSpeeds"] = speeds
else:
    idle = CLIPS["Idle"]
    base = idle[0]
    run = CLIPS["Run"]
    run_n = len(run)
    walk_n = int(round((run_n - 1) * 1.6)) + 1
    run_slow = resample(run, walk_n)
    walk = blend_frames(tgt, [base] * walk_n, run_slow, 0.55)
    add("Walk", walk, loop=True)
    idle2 = resample(idle + idle[1:], int(round(4.0 * FPS)) + 1)
    look = []
    nW = len(idle2)
    for f, (R, T) in enumerate(idle2):
        t = f / (nW - 1)
        yaw = 22 * np.sin(2 * np.pi * t) * (0.5 - 0.5 * np.cos(2 * np.pi * t))
        sway = 0.012 * np.sin(2 * np.pi * t)
        look.append(pose_from_rots(tgt, (R, T), [("Head", "up", yaw), ("Spine02", "up", yaw * 0.3), ("Hip", "fwd", -3 * np.sin(2 * np.pi * t))], (sway, 0, 0)))
    add("Wait", look, loop=True)

# C. 程式化關鍵影格（武器類型共用動作；右手主手）。時間單位秒；命中＝最遠／最低點
D = 0.62  # 與既有普通攻擊相同長度（遊戲依攻速調整播放速度，命中時間點比例一致）
HIT = round(D * 0.4, 3)


def keyed(name, keys, dur=D, marks=None, ground=True):
    mk = marks or {"hit": HIT}
    hit_t = mk.get("hit", mk.get("release"))
    fr = keyed_clip(tgt, base, keys, dur, hit=hit_t if isinstance(hit_t, (int, float)) else None)
    add(name, fr, marks=mk, ground=ground, per_frame=True)


R_, L_ = "R_", "L_"


def CROUCH(k):
    """雙膝彎曲 k 度（大腿往前、小腿往後、腳掌保持平）：搭配每格接地修正，身體自然下沉"""
    return [("L_Thigh", "left", -k), ("R_Thigh", "left", -k), ("L_Calf", "left", k * 1.9), ("R_Calf", "left", k * 1.9), ("L_Foot", "left", -k * 0.9), ("R_Foot", "left", -k * 0.9)]
# 徒手：右拳直拳
keyed("Attack_Unarmed", [
    (0, [], (0, 0, 0)),
    (0.16, [("Spine01", "up", 18), ("R_Upperarm", "left", 35), ("R_Forearm", "left", -95), ("L_Upperarm", "left", -40), ("L_Forearm", "left", -70)], (0, -0.01, -0.01)),
    (HIT, [("Spine01", "up", -22), ("R_Upperarm", "left", -82), ("R_Forearm", "left", -8), ("L_Upperarm", "left", 15), ("L_Forearm", "left", -80)], (0, -0.015, 0.03)),
    (0.42, [("Spine01", "up", -12), ("R_Upperarm", "left", -55), ("R_Forearm", "left", -40)], (0, -0.008, 0.015)),
    (D, [], (0, 0, 0)),
])
# 單手下劈：舉到頭上 → 劈到前下方
keyed("Attack_1H_Chop", [
    (0, [], (0, 0, 0)),
    (0.18, [("Spine01", "left", 10), ("R_Upperarm", "left", -150), ("R_Forearm", "left", -60), ("L_Upperarm", "left", -25)], (0, 0.01, -0.015)),
    (HIT, [("Spine01", "left", -22), ("R_Upperarm", "left", -55), ("R_Forearm", "left", -5), ("L_Upperarm", "left", 20)] + CROUCH(12), (0, -0.04, 0.03)),
    (0.42, [("Spine01", "left", -14), ("R_Upperarm", "left", -40), ("R_Forearm", "left", -15)], (0, -0.03, 0.02)),
    (D, [], (0, 0, 0)),
])
# 單手突刺：拉回 → 向前刺直
keyed("Attack_1H_Thrust", [
    (0, [], (0, 0, 0)),
    (0.17, [("Spine01", "up", 22), ("R_Upperarm", "left", 20), ("R_Upperarm", "fwd", -25), ("R_Forearm", "left", -110), ("L_Upperarm", "left", -35)], (0, -0.01, -0.02)),
    (HIT, [("Spine01", "up", -18), ("R_Upperarm", "left", -88), ("R_Forearm", "left", -3), ("L_Upperarm", "left", 25), ("L_Thigh", "left", -20)], (0, -0.03, 0.05)),
    (0.44, [("Spine01", "up", -10), ("R_Upperarm", "left", -70), ("R_Forearm", "left", -20)], (0, -0.02, 0.03)),
    (D, [], (0, 0, 0)),
])
# 雙手橫斬：兩手一起從右後方掃到左前方（扭腰）
keyed("Attack_2H_Slash", [
    (0, [], (0, 0, 0)),
    (0.2, [("Spine01", "up", -45), ("R_Upperarm", "left", -60), ("R_Upperarm", "up", -30), ("R_Forearm", "left", -50), ("L_Upperarm", "left", -70), ("L_Upperarm", "up", -60), ("L_Forearm", "left", -60)], (0, -0.02, 0)),
    (HIT, [("Spine01", "up", 40), ("R_Upperarm", "left", -80), ("R_Upperarm", "up", 45), ("R_Forearm", "left", -15), ("L_Upperarm", "left", -75), ("L_Upperarm", "up", 20), ("L_Forearm", "left", -40)], (0, -0.035, 0.02)),
    (0.45, [("Spine01", "up", 50), ("R_Upperarm", "left", -60), ("R_Upperarm", "up", 55), ("L_Upperarm", "left", -60), ("L_Upperarm", "up", 35)], (0, -0.03, 0.01)),
    (D, [], (0, 0, 0)),
], dur=D)
# 雙手重擊：高舉 → 重砸（下蹲）
D2 = 0.75
keyed("Attack_2H_Smash", [
    (0, [], (0, 0, 0)),
    (0.26, [("Spine01", "left", 15), ("R_Upperarm", "left", -160), ("R_Forearm", "left", -50), ("L_Upperarm", "left", -155), ("L_Forearm", "left", -55)], (0, 0.015, -0.02)),
    (0.34, [("Spine01", "left", -30), ("R_Upperarm", "left", -60), ("R_Forearm", "left", -10), ("L_Upperarm", "left", -55), ("L_Forearm", "left", -15)] + CROUCH(24), (0, -0.08, 0.03)),
    (0.5, [("Spine01", "left", -25), ("R_Upperarm", "left", -45), ("L_Upperarm", "left", -40)] + CROUCH(18), (0, -0.06, 0.02)),
    (D2, [], (0, 0, 0)),
], dur=D2, marks={"hit": 0.34})
# 長柄突刺：雙手握、前後手，往前刺
keyed("Attack_Polearm_Thrust", [
    (0, [], (0, 0, 0)),
    (0.18, [("Spine01", "up", 30), ("R_Upperarm", "left", -20), ("R_Forearm", "left", -100), ("L_Upperarm", "left", -55), ("L_Upperarm", "up", -25), ("L_Forearm", "left", -60)], (0, -0.015, -0.03)),
    (HIT, [("Spine01", "up", -5), ("R_Upperarm", "left", -60), ("R_Forearm", "left", -35), ("L_Upperarm", "left", -85), ("L_Upperarm", "up", -15), ("L_Forearm", "left", -10), ("L_Thigh", "left", -25)], (0, -0.04, 0.06)),
    (0.45, [("Spine01", "up", 5), ("R_Upperarm", "left", -50), ("L_Upperarm", "left", -70)], (0, -0.025, 0.03)),
    (D, [], (0, 0, 0)),
])
# 長柄揮擊：大弧度橫掃
D3 = 0.8
keyed("Attack_Polearm_Swing", [
    (0, [], (0, 0, 0)),
    (0.28, [("Spine01", "up", -60), ("Spine02", "up", -15), ("R_Upperarm", "left", -100), ("R_Upperarm", "up", -40), ("L_Upperarm", "left", -80), ("L_Upperarm", "up", -70)], (0, -0.02, -0.01)),
    (0.38, [("Spine01", "up", 35), ("Spine02", "up", 15), ("R_Upperarm", "left", -85), ("R_Upperarm", "up", 40), ("L_Upperarm", "left", -80), ("L_Upperarm", "up", 25)], (0, -0.04, 0.02)),
    (0.55, [("Spine01", "up", 55), ("Spine02", "up", 15), ("R_Upperarm", "left", -60), ("R_Upperarm", "up", 60), ("L_Upperarm", "left", -50), ("L_Upperarm", "up", 45)], (0, -0.03, 0.01)),
    (D3, [], (0, 0, 0)),
], dur=D3, marks={"hit": 0.38})
# 錘類重擊：單手大幅高舉，延遲出手（重量感）
D4 = 0.8
keyed("Attack_Hammer_Smash", [
    (0, [], (0, 0, 0)),
    (0.32, [("Spine01", "left", 18), ("Spine01", "up", 20), ("R_Upperarm", "left", -165), ("R_Upperarm", "fwd", 15), ("R_Forearm", "left", -70), ("L_Upperarm", "left", -40)], (0, 0.02, -0.03)),
    (0.42, [("Spine01", "left", -32), ("Spine01", "up", -10), ("R_Upperarm", "left", -50), ("R_Forearm", "left", -5), ("L_Upperarm", "left", 15)] + CROUCH(24), (0, -0.09, 0.04)),
    (0.6, [("Spine01", "left", -25), ("R_Upperarm", "left", -40)] + CROUCH(16), (0, -0.07, 0.03)),
    (D4, [], (0, 0, 0)),
], dur=D4, marks={"hit": 0.42})
# 法杖施法（普通攻擊長度）：右手法杖往前上方指、左手掌向前
keyed("Cast_Staff", [
    (0, [], (0, 0, 0)),
    (0.18, [("Spine01", "up", 12), ("R_Upperarm", "left", -40), ("R_Forearm", "left", -90), ("L_Upperarm", "left", -30), ("L_Forearm", "left", -80)], (0, -0.01, -0.01)),
    (HIT, [("Spine01", "up", -8), ("R_Upperarm", "left", -105), ("R_Forearm", "left", -20), ("L_Upperarm", "left", -70), ("L_Upperarm", "up", 15), ("L_Forearm", "left", -15)], (0, 0, 0.02)),
    (0.45, [("R_Upperarm", "left", -90), ("R_Forearm", "left", -30), ("L_Upperarm", "left", -50)], (0, 0, 0.01)),
    (D, [], (0, 0, 0)),
], marks={"release": HIT})
# 治療施法：雙手往前上方展開、身體微後仰
D5 = 0.9
keyed("Cast_Heal", [
    (0, [], (0, 0, 0)),
    (0.3, [("Spine01", "left", 8), ("R_Upperarm", "left", -50), ("R_Forearm", "left", -70), ("L_Upperarm", "left", -50), ("L_Forearm", "left", -70)], (0, -0.01, 0)),
    (0.5, [("Spine01", "left", 14), ("Head", "left", 10), ("R_Upperarm", "left", -110), ("R_Upperarm", "fwd", -25), ("R_Forearm", "left", -15), ("L_Upperarm", "left", -110), ("L_Upperarm", "fwd", 25), ("L_Forearm", "left", -15)], (0, 0.01, -0.01)),
    (0.68, [("Spine01", "left", 10), ("R_Upperarm", "left", -100), ("R_Upperarm", "fwd", -30), ("L_Upperarm", "left", -100), ("L_Upperarm", "fwd", 30)], (0, 0.005, 0)),
    (D5, [], (0, 0, 0)),
], dur=D5, marks={"release": 0.5})
# 投擲：手往後上方拉 → 過肩甩出
keyed("Attack_Throw", [
    (0, [], (0, 0, 0)),
    (0.2, [("Spine01", "up", 35), ("Spine01", "left", 8), ("R_Upperarm", "left", 30), ("R_Upperarm", "fwd", -60), ("R_Forearm", "left", -100), ("L_Upperarm", "left", -60)], (0, -0.01, -0.03)),
    (HIT, [("Spine01", "up", -30), ("Spine01", "left", -15), ("R_Upperarm", "left", -120), ("R_Forearm", "left", -15), ("L_Upperarm", "left", 20), ("L_Thigh", "left", -20)], (0, -0.03, 0.04)),
    (0.45, [("Spine01", "up", -20), ("R_Upperarm", "left", -60), ("R_Forearm", "left", -20)], (0, -0.02, 0.02)),
    (D, [], (0, 0, 0)),
], marks={"release": HIT})
# 格擋：左手（盾）與右手往前抬起護住身體（播完停在最後一格；鬆開由遊戲切回 Idle）
keyed("Block", [
    (0, [], (0, 0, 0)),
    (0.18, [("Spine01", "left", -8), ("L_Upperarm", "left", -75), ("L_Upperarm", "up", -30), ("L_Forearm", "left", -95), ("R_Upperarm", "left", -55), ("R_Forearm", "left", -80)] + CROUCH(12), (0, -0.04, -0.01)),
    (0.4, [("Spine01", "left", -8), ("L_Upperarm", "left", -78), ("L_Upperarm", "up", -30), ("L_Forearm", "left", -95), ("R_Upperarm", "left", -55), ("R_Forearm", "left", -80)] + CROUCH(12), (0, -0.04, -0.01)),
], dur=0.4, marks={"guard": 0.18})
# 技能專用跳躍＋落地（一般移動沒有跳躍按鈕）：重定向的 Jump，另外輸出 Jump_Land（落地緩衝）
jump = CLIPS["Jump"]
land_keys = [
    (0, [], (0, 0, 0)),
    (0.08, [("Spine01", "left", -18), ("R_Upperarm", "left", -30), ("L_Upperarm", "left", -30)] + CROUCH(32), (0, -0.11, 0)),
    (0.4, [], (0, 0, 0)),
]
keyed("Jump_Land", land_keys, dur=0.4, marks={"land": 0.0})

# D. 雙手武器：副手握持（左手 IK 到武器握把上；雙手劍左手在右手下方、長柄武器左手在前方）
GRIPS = {"Attack_2H_Slash": -0.1, "Attack_2H_Smash": -0.1, "Attack_Polearm_Thrust": 0.28, "Attack_Polearm_Swing": 0.28}
REPORT["offhandIK"] = {}
for nm, along in GRIPS.items():
    fr = CLIPS[nm]
    dur = (len(fr) - 1) / FPS
    CLIPS[nm] = offhand_grip(tgt, fr, along, blend_in=[(0, 0.0), (0.1, 1.0), (dur - 0.12, 1.0), (dur, 0.0)])
    # 檢查：左手掛點與握點的距離（每格）
    errs = []
    for R, T in CLIPS[nm]:
        W = S.world(R=R, T=T)
        Mr = W[S.idx["Weapon_R"]]
        blade = Mr[:3, 1] / np.linalg.norm(Mr[:3, 1])
        errs.append(float(np.linalg.norm(W[S.idx["Weapon_L"]][:3, 3] - (Mr[:3, 3] + blade * along))))
    core = errs[int(0.1 * FPS) + 1:len(errs) - int(0.12 * FPS) - 1] or errs
    REPORT["offhandIK"][nm] = {"grip_along_m": along, "max_error_cm": round(max(core) * 100, 2), "mean_error_cm": round(sum(core) / len(core) * 100, 2)}
log("offhand IK", REPORT["offhandIK"])

REPORT["clips"] = {n: {"seconds": round((len(f) - 1) / FPS, 3), "loop": n in LOOP, "marks": MARKS[n]} for n, f in CLIPS.items()}
REPORT["groundSpeed"] = {"Run": ground_speed(tgt, CLIPS["Run"]), "Walk": ground_speed(tgt, CLIPS["Walk"]), "native_rootMotion": REPORT.get("nativeSpeeds")}
log("ground speed", REPORT["groundSpeed"])

# ---------------- 輸出 ----------------
# 只輸出有變化的通道（減少檔案大小）
data = {
    "root": {"node": "Armature", "rotation": ROOT_Q.tolist(), "scale": [scale] * 3},
    "helpers": helpers,
    "sockets": sockets,
    "jointNames": joint_names,
    "fps": FPS,
    "clips": [],
}
for name, frames in CLIPS.items():
    n = len(frames)
    ch = []
    for ni in range(len(S.nodes)):
        nm = S.nodes[ni].get("name")
        if nm in ("Armature",) or nm in [s["name"] for s in sockets]:
            continue
        R = np.array([f[0][ni] for f in frames])
        for k in range(1, n):
            if np.dot(R[k], R[k - 1]) < 0:
                R[k] = -R[k]
        if np.abs(R - S.R[ni]).max() > 1e-4 or np.abs(R - np.where(np.dot(R, S.R[ni])[:, None] < 0, -S.R[ni], S.R[ni])).max() > 1e-4:
            ch.append({"node": nm, "path": "rotation", "values": np.round(R, 6).ravel().tolist()})
        T = np.array([f[1][ni] for f in frames])
        if np.abs(T - S.T[ni]).max() > 1e-5:
            ch.append({"node": nm, "path": "translation", "values": np.round(T, 6).ravel().tolist()})
    data["clips"].append({"name": name, "frames": n, "loop": name in LOOP, "marks": MARKS[name], "channels": ch})
json.dump(data, open(os.path.join(OUT, "n75_data.json"), "w"))
with open(os.path.join(OUT, "n75_skin.bin"), "wb") as f:
    f.write(order.astype(np.uint8).tobytes())
    f.write(top4.astype(np.float32).tobytes())

# ---------------- 預覽 ----------------
Wb = S.world()


def mats(R=None, T=None, new=True):
    W = S.world(R=R, T=T)
    M = [W[i] @ IBM[k] for k, i in enumerate(joints)]
    if new:
        for h in helpers:
            M.append(W[S.idx[h["name"]]] @ np.array(h["ibm"]).reshape(4, 4).T)
    return np.array(M)


def pose_img(R, T, view="front", size=260, new=True, c=None, sc=1.5):
    Vv, Nn = pv.skin(P, N, order if new else J, top4 if new else Wt, mats(R, T, new))
    return pv.render(Vv, Nn, I, VCOL, view, size, np.array([0, 0.62, 0]) if c is None else c, sc)


prev_files = []
for name, frames in CLIPS.items():
    n = len(frames)
    picks = sorted(set([0, n // 4, n // 2, (3 * n) // 4, n - 1] + ([int(MARKS[name]["hit"] * FPS)] if "hit" in MARKS[name] and isinstance(MARKS[name]["hit"], (int, float)) else [])))
    imgs = [pose_img(*frames[k], "front") for k in picks] + [pose_img(*frames[k], "side") for k in picks]
    fp = os.path.join(OUT, "preview", f"clip_{name}.png")
    pv.sheet(imgs, cols=len(picks)).save(fp)
    prev_files.append(os.path.basename(fp))
REPORT["preview"] = prev_files
json.dump(REPORT, open(os.path.join(OUT, "n75_report.json"), "w"), indent=1, ensure_ascii=False)
log("done")
