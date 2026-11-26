#!/usr/bin/env python3
"""
骨骼動畫「接口測試替身」GLB（不是怪物美術、不會出現在正式地圖）。

用途：在還沒拿到 Claude C 的正式 GLB 時，用同樣的資料規格驗證 Babylon.js 9 的整合程式：
- 32 個關節，名稱與階層與 M004 風羽狐 Rig V1.1 相同
- 1 組 skin、1 個蒙皮網格（放在場景根層級）
- 7 組動畫：Idle 2.0、Move 0.8、Run 0.38、Attack 1.2、Hurt 0.45、Death 0.7、Respawn 0.5 秒
  每組都有全部 32 關節的旋轉通道；Root、Pelvis、Feather_01～04 另有位移通道
- 根節點 extras.monster：clips 時長／loop、Attack.hitTime 0.5、Move／Run nativeSpeedMps、shoulderHeightM
- 外形是灰色方塊（明確標示 fixture），用來確認骨架與動畫播放，不代表任何怪物外觀

用法：python3 tools/fixtures/make_rig_contract_fixture.py public/models/monsters/_fixture/rig_contract_fixture.glb
"""
import json, math, struct, sys
import numpy as np

OUT = sys.argv[1]
FPS = 30

# 名稱、父關節、全域位置（公尺；面向 +Z、左側 −X、腳底 y=0）
J = [
    ("Root", None, (0, 0, 0)),
    ("Pelvis", "Root", (0, 0.45, -0.28)),
    ("Spine_Mid", "Pelvis", (0, 0.47, -0.02)),
    ("Chest", "Spine_Mid", (0, 0.48, 0.22)),
    ("Neck", "Chest", (0, 0.60, 0.33)),
    ("Head", "Neck", (0, 0.74, 0.40)),
    ("Ear_L", "Head", (-0.08, 0.92, 0.38)),
    ("Ear_R", "Head", (0.08, 0.92, 0.38)),
]
for s, x in (("L", -0.1), ("R", 0.1)):
    J += [
        (f"Shoulder_{s}", "Chest", (x, 0.44, 0.24)),
        (f"UpperArm_{s}", f"Shoulder_{s}", (x, 0.32, 0.25)),
        (f"Forearm_{s}", f"UpperArm_{s}", (x, 0.17, 0.25)),
        (f"Paw_F{s}", f"Forearm_{s}", (x, 0.04, 0.27)),
    ]
J += [("Tail_01", "Pelvis", (0, 0.47, -0.42)), ("Tail_02", "Tail_01", (0, 0.52, -0.55)), ("Tail_03", "Tail_02", (0, 0.58, -0.66)), ("Tail_04", "Tail_03", (0, 0.66, -0.74))]
for s, x in (("L", -0.1), ("R", 0.1)):
    J += [
        (f"Hip_{s}", "Pelvis", (x, 0.42, -0.30)),
        (f"Thigh_{s}", f"Hip_{s}", (x, 0.31, -0.31)),
        (f"Shin_{s}", f"Thigh_{s}", (x, 0.17, -0.34)),
        (f"Paw_B{s}", f"Shin_{s}", (x, 0.04, -0.31)),
    ]
J += [(f"Feather_0{i+1}", "Root", (0.32 * math.cos(i * 1.57), 0.62 + 0.05 * i, 0.32 * math.sin(i * 1.57))) for i in range(4)]
assert len(J) == 32, len(J)
names = [j[0] for j in J]
idx = {n: i for i, n in enumerate(names)}
gpos = {n: np.array(p, dtype=np.float64) for n, _, p in J}
parent = {n: p for n, p, _ in J}
TRANSLATED = {"Root", "Pelvis", "Feather_01", "Feather_02", "Feather_03", "Feather_04"}

def local_t(n):
    p = parent[n]
    return gpos[n] - (gpos[p] if p else 0)

# ---------- 網格：每個關節一個方塊（剛性綁到該關節），頭、身體較大 ----------
pos, nor, jnt, wgt, ind = [], [], [], [], []
def box(center, size, joint):
    cx, cy, cz = center
    sx, sy, sz = size
    faces = [((1,0,0),(0,1,0),(0,0,1)),((-1,0,0),(0,1,0),(0,0,-1)),((0,1,0),(0,0,1),(1,0,0)),((0,-1,0),(0,0,-1),(1,0,0)),((0,0,1),(1,0,0),(0,1,0)),((0,0,-1),(-1,0,0),(0,1,0))]
    for n, u, v in faces:
        base = len(pos)
        for a, b in ((-1,-1),(1,-1),(1,1),(-1,1)):
            p = [center[k] + (n[k] * size[k] / 2) + (u[k] * a * size[k] / 2) + (v[k] * b * size[k] / 2) for k in range(3)]
            pos.append(p); nor.append(n); jnt.append([joint, 0, 0, 0]); wgt.append([1, 0, 0, 0])
        ind.extend([base, base + 1, base + 2, base, base + 2, base + 3])
for n, p, _ in J:
    if n == "Root":
        continue
    c = (gpos[n] + gpos[p]) / 2 if p and p != "Root" else gpos[n]
    s = 0.07
    size = (s, s, s)
    if n in ("Spine_Mid", "Chest", "Pelvis"): size = (0.26, 0.24, 0.28)
    if n == "Head": size = (0.24, 0.22, 0.22); c = gpos[n] + np.array([0, 0.04, 0.03])
    if n.startswith("Feather"): size = (0.04, 0.12, 0.02)
    box(tuple(c), size, idx[p] if (p and p != "Root" and n not in ("Head", "Pelvis", "Chest", "Spine_Mid") and not n.startswith("Feather")) else idx[n])
pos = np.array(pos, np.float32); nor = np.array(nor, np.float32); jnt = np.array(jnt, np.uint8); wgt = np.array(wgt, np.float32); ind = np.array(ind, np.uint16)

# ---------- 動畫（程式產生的簡單動作：只為了讓各組姿勢互相不同、可量測） ----------
def qx(a): return (math.sin(a / 2), 0, 0, math.cos(a / 2))
def qz(a): return (0, 0, math.sin(a / 2), math.cos(a / 2))
def qy(a): return (0, math.sin(a / 2), 0, math.cos(a / 2))
def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return (aw*bx + ax*bw + ay*bz - az*by, aw*by - ax*bz + ay*bw + az*bx, aw*bz + ax*by - ay*bx + az*bw, aw*bw - ax*bx - ay*by - az*bz)
ID = (0.0, 0.0, 0.0, 1.0)
LEG = {"UpperArm_L": 0, "UpperArm_R": 0.5, "Thigh_L": 0.5, "Thigh_R": 0}

def pose(clip, t, d):
    ph = t / d  # 0..1
    w = 2 * math.pi * ph
    r = {n: ID for n in names}
    tr = {n: tuple(local_t(n)) for n in TRANSLATED}
    if clip == "Idle":
        r["Head"] = qx(0.06 * math.sin(w)); r["Tail_01"] = qy(0.2 * math.sin(w))
    elif clip in ("Move", "Run"):
        amp = 0.35 if clip == "Move" else 0.75
        for n, off in LEG.items():
            r[n] = qx(amp * math.sin(w + off * 2 * math.pi))
        r["Spine_Mid"] = qx((0.05 if clip == "Move" else 0.18) * math.sin(2 * w))
        bob = (0.015 if clip == "Move" else 0.05) * math.sin(2 * w)
        tr["Pelvis"] = tuple(local_t("Pelvis") + np.array([0, bob, 0]))
    elif clip == "Attack":
        k = math.exp(-((t - 0.5) ** 2) / 0.02)  # 0.50 秒最前傾
        r["Chest"] = qx(0.5 * k); r["Head"] = qx(0.6 * k); r["UpperArm_L"] = qx(-0.6 * k); r["UpperArm_R"] = qx(-0.6 * k)
    elif clip == "Hurt":
        k = math.sin(math.pi * min(1, t / d))
        r["Head"] = qx(-0.5 * k); r["Chest"] = qx(-0.2 * k)
    elif clip == "Death":
        k = min(1, t / (d * 0.8))
        r["Pelvis"] = qz(1.45 * k)
        tr["Pelvis"] = tuple(local_t("Pelvis") + np.array([0.0, -0.2 * k, 0]))
    elif clip == "Respawn":
        k = 1 - min(1, t / d)
        r["Pelvis"] = qz(0.6 * k * k)
        tr["Pelvis"] = tuple(local_t("Pelvis") + np.array([0.0, -0.12 * k * k, 0]))
    for i, n in enumerate(names):
        if n.startswith("Feather"):
            tr[n] = tuple(local_t(n) + np.array([0, 0.03 * math.sin(w + i), 0]))
            r[n] = qy(w * 0.5 + i)
    return r, tr

CLIPS = [("Idle", 2.0, True), ("Move", 0.8, True), ("Run", 0.38, True), ("Attack", 1.2, False), ("Hurt", 0.45, False), ("Death", 0.7, False), ("Respawn", 0.5, False)]

# ---------- 寫出 glTF ----------
bin_ = bytearray()
views, accs = [], []
def add(arr, comp, typ, target=None, minmax=False, normalized=False):
    data = arr.tobytes()
    while len(bin_) % 4: bin_.append(0)
    off = len(bin_); bin_.extend(data)
    v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
    if target: v["target"] = target
    views.append(v)
    a = {"bufferView": len(views) - 1, "componentType": comp, "count": int(arr.shape[0]), "type": typ}
    if normalized: a["normalized"] = True
    if minmax:
        a["min"] = [float(x) for x in arr.min(axis=0).reshape(-1)] if arr.ndim > 1 else [float(arr.min())]
        a["max"] = [float(x) for x in arr.max(axis=0).reshape(-1)] if arr.ndim > 1 else [float(arr.max())]
    accs.append(a)
    return len(accs) - 1

F, U8, U16 = 5126, 5121, 5123
aPos = add(pos, F, "VEC3", 34962, True)
aNor = add(nor, F, "VEC3", 34962)
aJ = add(jnt, U8, "VEC4", 34962)
aW = add(wgt, F, "VEC4", 34962)
aI = add(ind, U16, "SCALAR", 34963)
ibm = np.zeros((32, 16), np.float32)
for i, n in enumerate(names):
    m = np.eye(4, dtype=np.float32); m[0:3, 3] = -gpos[n]
    ibm[i] = m.T.reshape(-1)  # 欄優先
aIbm = add(ibm, F, "MAT4")

NODE0 = 2  # 0 = 根節點（extras）、1 = 蒙皮網格、2.. = 關節
nodes = [
    {"name": "RigContractFixture_Root", "children": [NODE0 + idx["Root"]], "extras": {}},
    {"name": "RigContractFixture_Mesh", "mesh": 0, "skin": 0},
]
for i, (n, p, _) in enumerate(J):
    nd = {"name": n, "translation": [float(x) for x in local_t(n)]}
    ch = [NODE0 + k for k, (_, pp, _) in enumerate(J) if pp == n]
    if ch: nd["children"] = ch
    nodes.append(nd)

anims = []
for name, d, loop in CLIPS:
    n_frames = max(2, int(round(d * FPS)) + 1)
    times = np.linspace(0, d, n_frames).astype(np.float32)
    aT = add(times.reshape(-1, 1), F, "SCALAR", None, True)
    samplers, channels = [], []
    for i, j in enumerate(names):
        rots = np.array([pose(name, float(t), d)[0][j] for t in times], np.float32)
        aR = add(rots, F, "VEC4")
        samplers.append({"input": aT, "output": aR, "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": NODE0 + i, "path": "rotation"}})
        if j in TRANSLATED:
            trs = np.array([pose(name, float(t), d)[1][j] for t in times], np.float32)
            aTr = add(trs, F, "VEC3")
            samplers.append({"input": aT, "output": aTr, "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers) - 1, "target": {"node": NODE0 + i, "path": "translation"}})
    anims.append({"name": name, "samplers": samplers, "channels": channels})

nodes[0]["extras"] = {
    "monster": {
        "fixture": True,
        "note": "接口測試替身：灰色方塊，不是怪物美術",
        "id": "rig_contract_fixture",
        "shoulderHeightM": 0.48,
        "clips": {n: {"duration": d, "loop": l, **({"hitTime": 0.5} if n == "Attack" else {}), **({"nativeSpeedMps": 0.6} if n == "Move" else {}), **({"nativeSpeedMps": 2.4} if n == "Run" else {}), **({"holdLastFrame": True} if n == "Death" else {})} for n, d, l in CLIPS},
    }
}
gltf = {
    "asset": {"version": "2.0", "generator": "starwish rig contract fixture"},
    "scene": 0,
    "scenes": [{"nodes": [0, 1]}],
    "nodes": nodes,
    "meshes": [{"name": "RigContractFixture", "primitives": [{"attributes": {"POSITION": aPos, "NORMAL": aNor, "JOINTS_0": aJ, "WEIGHTS_0": aW}, "indices": aI, "material": 0}]}],
    "materials": [{"name": "FixtureGrey", "pbrMetallicRoughness": {"baseColorFactor": [0.62, 0.64, 0.7, 1], "metallicFactor": 0, "roughnessFactor": 0.8}}],
    "skins": [{"name": "RigContractFixtureSkin", "joints": [NODE0 + i for i in range(32)], "inverseBindMatrices": aIbm, "skeleton": NODE0}],
    "animations": anims,
    "accessors": accs,
    "bufferViews": views,
    "buffers": [{"byteLength": len(bin_)}],
}
js = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode("utf8")
while len(js) % 4: js += b" "
while len(bin_) % 4: bin_.append(0)
total = 12 + 8 + len(js) + 8 + len(bin_)
import os
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "wb") as f:
    f.write(struct.pack("<III", 0x46546C67, 2, total))
    f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack("<II", len(bin_), 0x004E4942)); f.write(bin_)
print(f"{OUT}: {total} bytes, {len(pos)} verts, {len(ind)//3} tris, 32 joints, {len(anims)} clips")
