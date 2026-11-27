"""
Stage 7.2 新版初心者（Tripo 零件）→ 綁骨、動畫、模組化輸出。
blender -b --factory-startup -P art/tripo-novice/build.py -- <decoded dir> <out dir>

流程（每個性別）
  1. 匯入身體與零件，依 FIT 對位（零件各自正規化成約 1 單位，需要縮放、位移；靴子左右分開對腳）
  2. 從身體網格量測關節（landmarks.py），建立統一骨架（同名同序；男女骨架比例各自量測）
  3. 上衣：袖子角度和身體不同 → 用「擺好手臂的骨架」算權重，再反向蒙皮回到身體的綁定姿勢
  4. 權重：沿網格表面的測地距離（不會從袖子跳到裙子、從左腳跳到右腳）；頭髮 100% 頭、武器 100% 武器骨
  5. 程式化動畫：Idle、Run、Jump（技能用）、Attack_Sword、Attack_Staff、Hurt、Death
  6. 輸出：身體（骨架＋動畫）一個 GLB、每個零件一個 GLB（同一套骨架、同名同序，遊戲端換裝時重新綁到身體骨架）
     HQ／Lite 兩種（Lite 減面、貼圖縮小）。另外輸出預覽圖與檢查報告 JSON。
"""
import bpy, bmesh, sys, os, json, math, heapq, time
import numpy as np
from mathutils import Vector, Matrix, Quaternion, Euler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from landmarks import landmarks  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = args[0], args[1]
os.makedirs(OUT, exist_ok=True)
T0 = time.time()
REPORT = {"tool": "art/tripo-novice/build.py", "blender": bpy.app.version_string, "genders": {}}

HEIGHT_M = 1.25
RUN_T = 0.5  # 跑步循環秒數（兩步）
RUN_SWING = 42  # 大腿前後擺幅（度）  # 角色身高規範（公尺；與既有初心者、寵物錨點一致）
FPS = 30

# ---------------- 對位設定（零件原始空間：Z 上、面向 +X、角色左 = +Y；單位 = 身體原始單位） ----------------
# s：等比縮放；sv：三軸縮放；t：位移。boots：左右靴分開，各自依腳長縮放並對到腳的中心
FIT = {
    "male": {
        "body": "Male_Base_V1",
        "sleeve_zmin": -0.12,  # 袖子量測範圍（避開衣襬）
        "hair": {"src": "Male_Hair_01_V1", "s": 0.47, "t": [-0.012, 0.0, 0.352]},
        "top": {"src": "Male_Novice_Top_V1", "s": 0.423, "t": [0.007, 0.0, 0.060]},
        "bottom": {"src": "Male_Novice_Pants_V1", "s": 0.384, "t": [-0.006, 0.0, -0.246]},
        "boots": {"src": "Male_Novice_Boots_V1", "foot_scale": 1.12},
    },
    "female": {
        "body": "CHR_Female_Base",
        "sleeve_zmin": -0.10,  # 袖子量測範圍（避開裙襬）
        # 女生髮型原檔面向 −X（與身體相反）→ 先轉 180°
        "hair": {"src": "Novice_Female_Hair_01", "s": 0.50, "t": [-0.02, 0.0, 0.33], "flip": True},
        "top": {"src": "Novice_Female_Top", "s": 0.421, "t": [0.02, 0.0, 0.014]},
        "bottom": {"src": "Novice_Female_Leggings", "box": {"z": [-0.458, -0.06], "yhalf": 0.106, "xc": 0.028}},
        "boots": {"src": "Novice_Female_Boots", "foot_scale": 1.12},
    },
}
WEAPONS = {
    # grip：沿主軸的握把位置（量測：短劍 +0.285 在握把中段、刀刃在負方向；法杖 −0.35 在杖身、杖頭在正方向）
    "sword": {"src": "Novice_ShortSword_V1", "grip": 0.285, "tip_sign": -1, "length_m": 0.56},
    "staff": {"src": "Novice_Weapon_Staff", "grip": -0.35, "tip_sign": 1, "length_m": 1.02},
}
LOD = {"hq": {"ratio": 0.72, "tex": {"base": 1024, "other": 512}, "jpeg": 90}, "lite": {"ratio": 0.5, "tex": {"base": 512, "other": 256}, "jpeg": 85}}
# Lite 的 ratio 是對 HQ 再減一次（約原始的 36%）

BONES = [  # (名稱, 父骨, 關節, 尾端)
    ("root", None, "root", "hips"),
    ("hips", "root", "hips", "spine"),
    ("spine", "hips", "spine", "chest"),
    ("chest", "spine", "chest", "neck"),
    ("neck", "chest", "neck", "head"),
    ("head", "neck", "head", "head_end"),
]
for S in ("L", "R"):
    BONES += [
        (f"shoulder.{S}", "chest", "neck", f"upperarm.{S}"),
        (f"upperarm.{S}", f"shoulder.{S}", f"upperarm.{S}", f"forearm.{S}"),
        (f"forearm.{S}", f"upperarm.{S}", f"forearm.{S}", f"hand.{S}"),
        (f"hand.{S}", f"forearm.{S}", f"hand.{S}", f"hand_end.{S}"),
        (f"thigh.{S}", "hips", f"thigh.{S}", f"shin.{S}"),
        (f"shin.{S}", f"thigh.{S}", f"shin.{S}", f"foot.{S}"),
        (f"foot.{S}", f"shin.{S}", f"foot.{S}", f"toe.{S}"),
        (f"toe.{S}", f"foot.{S}", f"toe.{S}", f"toe_end.{S}"),
    ]
DEFORM = [b[0] for b in BONES if b[0] not in ("root",)]


def log(*a):
    print(f"[{time.time() - T0:7.1f}s]", *a, flush=True)


# ---------------- 匯入 ----------------
def import_part(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, name + ".glb"))
    objs = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in objs if o.type == "MESH"]
    for o in meshes:
        o.data.transform(o.matrix_world)
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
    for o in objs:
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    if len(meshes) > 1:
        with bpy.context.temp_override(active_object=meshes[0], selected_editable_objects=meshes, object=meshes[0]):
            bpy.ops.object.join()
    o = meshes[0]
    o.name = name
    return o


def verts_np(o):
    a = np.empty(len(o.data.vertices) * 3)
    o.data.vertices.foreach_get("co", a)
    return a.reshape(-1, 3)


def set_verts(o, V):
    o.data.vertices.foreach_set("co", np.asarray(V, dtype=np.float64).ravel())
    o.data.update()


def split_islands(o):
    """依連通片分開，回傳每片的頂點索引"""
    me = o.data
    n = len(me.vertices)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for e in me.edges:
        a, b = find(e.vertices[0]), find(e.vertices[1])
        if a != b:
            parent[a] = b
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def fit_part(o, cfg, body_V):
    V = verts_np(o)
    if "box" in cfg:
        b = cfg["box"]
        mn, mx = V.min(0), V.max(0)
        sy = b["yhalf"] / max(abs(mn[1]), abs(mx[1]))
        sz = (b["z"][1] - b["z"][0]) / (mx[2] - mn[2])
        s = np.array([sy, sy, sz])
        t = np.array([b["xc"] - (mn[0] + mx[0]) / 2 * sy, -(mn[1] + mx[1]) / 2 * sy, b["z"][0] - mn[2] * sz])
        set_verts(o, V * s + t)
        return {"scale": s.round(4).tolist(), "offset": t.round(4).tolist()}
    if "foot_scale" in cfg:
        out = {}
        isl = split_islands(o)
        for side, sg in (("L", 1), ("R", -1)):
            idx = np.array(sorted(i for g in isl for i in g if V[g, 1].mean() * sg > 0))
            P = V[idx]
            foot = body_V[(body_V[:, 2] < body_V[:, 2].min() + 0.09) & (body_V[:, 1] * sg > 0)]
            L = foot[:, 0].max() - foot[:, 0].min()
            s = L * cfg["foot_scale"] / (P[:, 0].max() - P[:, 0].min())
            t = np.array([
                (foot[:, 0].max() + foot[:, 0].min()) / 2 - (P[:, 0].max() + P[:, 0].min()) / 2 * s,
                (foot[:, 1].max() + foot[:, 1].min()) / 2 - (P[:, 1].max() + P[:, 1].min()) / 2 * s,
                body_V[:, 2].min() - 0.004 - P[:, 2].min() * s,
            ])
            V[idx] = P * s + t
            out[side] = {"scale": round(float(s), 4), "offset": t.round(4).tolist()}
        set_verts(o, V)
        return out
    s = np.array(cfg.get("sv", [cfg["s"]] * 3))
    t = np.array(cfg["t"])
    if cfg.get("flip"):
        V = V * np.array([-1, -1, 1])
    set_verts(o, V * s + t)
    return {"scale": s.round(4).tolist(), "offset": t.round(4).tolist()}


# ---------------- 幾何工具 ----------------
def seg_dist(P, a, b):
    ab = b - a
    t = np.clip(((P - a) @ ab) / max(1e-12, ab @ ab), 0, 1)
    return np.linalg.norm(P - (a + np.outer(t, ab)), axis=1)


def mesh_graph(o):
    me = o.data
    n = len(me.vertices)
    V = verts_np(o)
    adj = [[] for _ in range(n)]
    for e in me.edges:
        a, b = e.vertices
        d = float(np.linalg.norm(V[a] - V[b]))
        adj[a].append((b, d))
        adj[b].append((a, d))
    return adj


def geodesic_weights(o, joints, bones, H, allow=None, power=4.0, keep=3, extra_seed=0.012, seed_factor=1.35):
    """
    沿網格表面的測地距離權重。joints：關節位置（同一空間）；bones：要參與的骨骼名稱。
    allow(name, V) → 布林陣列：限制某些骨骼只能影響某些頂點（例如左手骨不影響右半身）
    """
    V = verts_np(o)
    n = len(V)
    adj = mesh_graph(o)
    segs = {}
    for b in bones:
        head, tail = BONE_DEF[b][2], BONE_DEF[b][3]
        segs[b] = (np.array(joints[head]), np.array(joints[tail]))
    E = np.stack([seg_dist(V, *segs[b]) for b in bones], 1)  # n × B
    if allow:
        for j, b in enumerate(bones):
            m = allow(b, V)
            if m is not None:
                E[~m, j] = np.inf
    nearest = np.argmin(E, 1)
    G = np.full((n, len(bones)), np.inf)
    for j, b in enumerate(bones):
        own = nearest == j
        if not own.any():
            continue
        dmin = E[own, j].min()
        seeds = np.where(own & (E[:, j] <= dmin * seed_factor + extra_seed * H))[0]
        dist = np.full(n, np.inf)
        pq = []
        for s in seeds:
            dist[s] = E[s, j]
            pq.append((dist[s], int(s)))
        heapq.heapify(pq)
        blocked = ~np.isfinite(E[:, j])
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist[u]:
                continue
            for v, w in adj[u]:
                if blocked[v]:
                    continue
                nd = d + w
                if nd < dist[v]:
                    dist[v] = nd
                    heapq.heappush(pq, (nd, v))
        G[:, j] = dist
    # 沒有連到任何種子的頂點（獨立小零件）：用直線距離
    lost = ~np.isfinite(G).any(1)
    G[lost] = E[lost]
    eps = 0.012 * H
    W = 1.0 / np.power(G + eps, power)
    W[~np.isfinite(W)] = 0
    # 只留最大的幾個
    order = np.argsort(-W, 1)
    mask = np.zeros_like(W, dtype=bool)
    np.put_along_axis(mask, order[:, :keep], True, 1)
    W[~mask] = 0
    W /= np.maximum(W.sum(1, keepdims=True), 1e-12)
    return {b: W[:, j] for j, b in enumerate(bones)}


def apply_weights(o, wmap, min_w=0.01):
    for b, w in wmap.items():
        idx = np.where(w > min_w)[0]
        if not len(idx):
            continue
        vg = o.vertex_groups.get(b) or o.vertex_groups.new(name=b)
        for i in idx:
            vg.add([int(i)], float(w[i]), "REPLACE")


def side_allow(H):
    def f(b, V):
        if b.endswith(".L"):
            return V[:, 1] > -0.01 * H
        if b.endswith(".R"):
            return V[:, 1] < 0.01 * H
        return None
    return f


def lbs_matrices(joints_rest, joints_pose, rots):
    """各骨骼的 4×4 變換（姿勢 × 綁定逆）：rots[bone] = 繞關節的世界旋轉（父骨的旋轉會往下傳）"""
    M = {}
    for name, parent, head, tail in BONES:
        R = rots.get(name, Matrix.Identity(3)).to_4x4()
        p = Vector(joints_rest[head])
        local = Matrix.Translation(p) @ R @ Matrix.Translation(-p)
        M[name] = (M[parent] @ local) if parent else local
    return M


# ---------------- 主流程 ----------------
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def build_gender(g):
    cfg = FIT[g]
    reset()
    rep = {"fit": {}}
    body = import_part(cfg["body"])
    BV = verts_np(body)
    J, info = landmarks(BV)
    H = info["H"]
    rep["landmarks_src_units"] = {k: [round(x, 4) for x in v] for k, v in J.items()}
    parts = {"body": body}
    for slot in ("hair", "top", "bottom", "boots"):
        o = import_part(cfg[slot]["src"])
        rep["fit"][slot] = fit_part(o, cfg[slot], BV)
        parts[slot] = o
    for wk, wc in WEAPONS.items():
        parts["weapon_" + wk] = import_part(wc["src"])
    log(g, "imported + fitted")

    # ---- 手臂骨骼沿上衣袖子（穿上衣時看得到的是袖子與手套；身體被蓋住的部分不畫）----
    top = parts["top"]
    TV = verts_np(top)
    for S, sg in (("L", 1), ("R", -1)):
        ua = np.array(J[f"upperarm.{S}"])
        A = TV[(TV[:, 1] * sg > 0.13 * H / 0.98) & (TV[:, 2] > cfg["sleeve_zmin"]) & (TV[:, 2] < ua[2])]
        far = A[np.argmax(np.linalg.norm((A - ua) * np.array([0.3, 1, 1]), axis=1))]
        d = (far - ua) / np.linalg.norm(far - ua)
        pr = (A - ua) @ d
        tip = ua + d * pr.max()
        Lr = np.linalg.norm(tip - ua)
        J[f"forearm.{S}"] = list(ua + d * Lr * 0.47)
        J[f"hand.{S}"] = list(ua + d * Lr * 0.78)
        J[f"hand_end.{S}"] = list(tip)
    rep["arm_from_sleeve"] = {k: [round(x, 4) for x in J[k]] for k in ("hand.L", "hand_end.L", "hand.R", "hand_end.R")}
    Mpose = {name: Matrix.Identity(4) for name, *_ in BONES}
    Jpose = J

    # ---- 統一座標：放大到 1.25 m、腳底 y=0、轉成面向 −Y（glTF +Z 前方）、角色左 = +X ----
    k = HEIGHT_M / H
    zmin = info["zmin"]
    Rz = np.array([[0, 1, 0], [-1, 0, 0], [0, 0, 1]], dtype=np.float64)  # (x,y,z) → (y,−x,z)

    def to_final(P):
        P = (np.asarray(P, dtype=np.float64) - np.array([0, 0, zmin])) * k
        return P @ Rz.T

    # ---- 減面（HQ）----
    for key, o in parts.items():
        if o.data.polygons and LOD["hq"]["ratio"] < 1:
            m = o.modifiers.new("dec", "DECIMATE")
            m.ratio = LOD["hq"]["ratio"]
            m.use_collapse_triangulate = True
            with bpy.context.temp_override(object=o, active_object=o):
                bpy.ops.object.modifier_apply(modifier=m.name)
    log(g, "decimated")

    # ---- 權重（在原始對位空間計算）----
    def_bones = DEFORM
    allow = side_allow(H)
    neck_z = info["neck"]

    def body_allow(b, V):
        a = allow(b, V)
        m = np.ones(len(V), bool) if a is None else a.copy()
        if b in ("head",):
            m &= V[:, 2] > neck_z - 0.03 * H
        elif b in ("neck",):
            m &= V[:, 2] > neck_z - 0.12 * H
        else:
            m &= V[:, 2] < neck_z + 0.02 * H
        return m

    W = geodesic_weights(body, J, def_bones, H, allow=body_allow)
    BVfit = verts_np(body)
    # 頭部剛性：脖子以上 100% 頭（臉不變形）
    hard = BVfit[:, 2] > neck_z + 0.03 * H
    for b in W:
        W[b][hard] = 1.0 if b == "head" else 0.0
    apply_weights(body, W)
    rep["weights_body"] = {b: int((w > 0.01).sum()) for b, w in W.items()}
    log(g, "body weights")

    # 頭髮：100% 頭
    hv = verts_np(parts["hair"])
    apply_weights(parts["hair"], {"head": np.ones(len(hv))})
    # 上衣：測地距離（袖子、衣襬分開）
    Wt = geodesic_weights(top, J, [b for b in def_bones if not b.startswith(("thigh", "shin", "foot", "toe", "head"))], H, allow=allow, seed_factor=1.1, extra_seed=0.004)
    apply_weights(top, Wt)
    rep["weights_top"] = {b: int((w > 0.01).sum()) for b, w in Wt.items()}
    # 下身、靴子
    Wb = geodesic_weights(parts["bottom"], J, ["hips", "spine", "thigh.L", "shin.L", "foot.L", "thigh.R", "shin.R", "foot.R"], H, allow=allow)
    apply_weights(parts["bottom"], Wb)
    Wk = geodesic_weights(parts["boots"], J, ["shin.L", "foot.L", "toe.L", "shin.R", "foot.R", "toe.R"], H, allow=allow)
    apply_weights(parts["boots"], Wk)
    log(g, "clothes weights")

    # ---- 轉到最終座標 ----
    for key, o in parts.items():
        if key.startswith("weapon_"):
            continue
        set_verts(o, to_final(verts_np(o)))
    JF = {kk: to_final([v])[0] for kk, v in J.items()}

    # ---- 武器：握把對到右手拳頭中心 ----
    hand, hend, fore = np.array(JF["hand.R"]), np.array(JF["hand_end.R"]), np.array(JF["forearm.R"])
    grip_pt = hand + (hend - hand) * 0.45
    fdir = (hand - fore) / np.linalg.norm(hand - fore)
    up = np.array([0, 0, 1.0]) - fdir * fdir[2]
    up /= np.linalg.norm(up)
    fwd = np.array([0, -1.0, 0]) - fdir * (-fdir[1])
    fwd -= up * (fwd @ up)
    fwd /= np.linalg.norm(fwd)
    wrep = {}
    weapon_axes = {}
    for wk, wc in WEAPONS.items():
        o = parts["weapon_" + wk]
        P = verts_np(o)
        c = P.mean(0)
        _, _, vt = np.linalg.svd(P - c)
        ax = vt[0] if vt[0][2] > 0 else -vt[0]  # 主軸方向固定（量測時 z 分量為正）
        pr = (P - c) @ ax
        L = pr.max() - pr.min()
        s = wc["length_m"] / L
        grip = c + ax * wc["grip"]
        tip_dir = ax * wc["tip_sign"]
        # 刀刃寬的方向（短劍刃面朝上下，揮砍時刀刃在揮動平面）
        Q = (P - c) - np.outer(pr, ax)
        _, _, v2 = np.linalg.svd(Q - Q.mean(0))
        wdir = v2[0] - ax * (v2[0] @ ax)
        wdir /= np.linalg.norm(wdir)
        if wk == "sword":
            target_tip = fwd * math.cos(math.radians(12)) + up * math.sin(math.radians(12))
        else:
            target_tip = up * math.cos(math.radians(18)) + fwd * math.sin(math.radians(18))
        target_tip /= np.linalg.norm(target_tip)
        target_w = up - target_tip * (up @ target_tip) if wk == "sword" else fwd - target_tip * (fwd @ target_tip)
        target_w /= np.linalg.norm(target_w)
        A = np.stack([tip_dir, wdir, np.cross(tip_dir, wdir)], 1)
        B = np.stack([target_tip, target_w, np.cross(target_tip, target_w)], 1)
        R = B @ A.T
        P2 = ((P - grip) * s) @ R.T + grip_pt
        set_verts(o, P2)
        weapon_axes[wk] = target_tip
        wrep[wk] = {"length_m": wc["length_m"], "scale": round(float(s), 4), "grip": [round(float(x), 4) for x in grip_pt], "tip_dir": [round(float(x), 3) for x in target_tip]}
        apply_weights(o, {"weapon.R": np.ones(len(P2))})
    rep["weapons"] = wrep

    # ---- 骨架 ----
    arm_data = bpy.data.armatures.new(f"Novice_{g}_Rig")
    arm = bpy.data.objects.new(f"Novice_{g}", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = {}
    for name, parent, head, tail in BONES:
        b = arm_data.edit_bones.new(name)
        b.head = Vector(JF[head])
        b.tail = Vector(JF[tail])
        if (b.tail - b.head).length < 1e-3:
            b.tail = b.head + Vector((0, 0, 0.03))
        if parent:
            b.parent = eb[parent]
        b.use_connect = False
        # 骨骼滾轉：手臂、腿讓局部 X 軸接近世界 X，方便寫動畫
        b.align_roll(Vector((0, -1, 0)) if name.startswith(("upperarm", "forearm", "hand", "shoulder")) else Vector((0, -1, 0)))
        eb[name] = b
    wb = arm_data.edit_bones.new("weapon.R")
    wb.head = Vector(grip_pt)
    wb.tail = Vector(grip_pt + weapon_axes["sword"] * 0.12)
    wb.parent = eb["hand.R"]
    for s_, sg in (("L", 1), ("R", -1)):
        pass
    bpy.ops.object.mode_set(mode="OBJECT")
    arm["starwishCharacter"] = json.dumps({"version": "tripo-novice-v1", "gender": g, "heightM": HEIGHT_M})

    for key, o in parts.items():
        o.parent = arm
        m = o.modifiers.new("Armature", "ARMATURE")
        m.object = arm
    # 身體分成「永遠顯示」（頭、脖子）與「被衣服蓋住」（其餘）
    split_body(parts["body"], W)
    log(g, "rig built")

    clips = make_clips(arm, JF, g)
    for p in arm.pose.bones:
        p.rotation_quaternion = Quaternion()
        p.location = Vector()
    rep["clips"] = clips
    rep["joints_final_m"] = {kk: [round(float(x), 4) for x in v] for kk, v in JF.items()}
    rep["parts"] = {}
    for key, o in [(k_, o_) for k_, o_ in parts.items()]:
        if not o.name in bpy.data.objects:
            continue
    REPORT["genders"][g] = rep
    return arm, rep


def split_body(o, W):
    """頭＋脖子 → Body_Core；其餘 → Body_Covered（穿上整套衣服時遊戲端可隱藏）"""
    V = verts_np(o)
    core_w = W["head"] + W["neck"]
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    core_faces = [f for f in bm.faces if np.mean([core_w[v.index] for v in f.verts]) > 0.5]
    for f in bm.faces:
        f.select = False
    for f in core_faces:
        f.select = True
    bm.to_mesh(o.data)
    bm.free()
    bpy.context.view_layer.objects.active = o
    for ob in bpy.context.view_layer.objects:
        ob.select_set(ob == o)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    core = [ob for ob in bpy.context.selected_objects if ob != o]
    if core:
        core[0].name = "Body_Core"
    o.name = "Body_Covered"


# ---------------- 動畫 ----------------
def make_clips(arm, JF, g):
    pb = arm.pose.bones
    for p in pb:
        p.rotation_mode = "QUATERNION"
    rest = {b.name: b.matrix_local.to_3x3() for b in arm.data.bones}

    def q_world(bone, axis, deg):
        """世界座標軸（綁定姿勢）的旋轉 → 骨骼局部四元數"""
        R = Matrix.Rotation(math.radians(deg), 3, axis)
        Rl = rest[bone].inverted() @ R @ rest[bone]
        return Rl.to_quaternion()

    def pose(spec):
        """spec: {bone: [(axis, deg), ...]} 依序相乘；'hips_loc': (x,y,z) 公尺"""
        out = {}
        for b, rs in spec.items():
            if b == "hips_loc":
                continue
            q = Quaternion()
            for axis, deg in rs:
                q = q_world(b, axis, deg) @ q
            out[b] = q
        return out

    actions = {}

    def clip(name, keys, loop):
        """keys: [(時間秒, spec)]；loop：最後一格＝第一格"""
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        arm.animation_data_create()
        arm.animation_data.action = act
        names = set()
        for _, sp in keys:
            names |= set(sp.keys())
        names.discard("hips_loc")
        for p in pb:
            p.rotation_quaternion = Quaternion()
            p.location = Vector()
        for t, sp in keys:
            f = 1 + t * FPS
            qs = pose(sp)
            for p in pb:
                if p.name in ("root",):
                    continue
                p.rotation_quaternion = qs.get(p.name, Quaternion())
                p.keyframe_insert("rotation_quaternion", frame=f)
            hl = sp.get("hips_loc", (0, 0, 0))
            # hips 的局部位移：把世界位移轉成骨骼局部
            v = rest["hips"].inverted() @ Vector(hl)
            pb["hips"].location = v
            pb["hips"].keyframe_insert("location", frame=f)
        for fc in act.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
        tr = arm.animation_data.nla_tracks.new()
        tr.name = name
        st = tr.strips.new(name, 1, act)
        tr.mute = True
        arm.animation_data.action = None
        actions[name] = {"seconds": round(keys[-1][0], 3), "loop": loop}

    X, Y, Z = "X", "Y", "Z"
    # 角色座標：前方 −Y、左 +X、上 +Z。繞 X 正轉 = 往前彎（頭往前）；腿往前擺 = 繞 X 負轉
    # 手臂（A 字站姿）：繞 Y 轉讓手臂往身體收（左臂 −、右臂 +）
    arms_down = {"upperarm.L": [(Y, -22)], "upperarm.R": [(Y, 22)], "forearm.L": [(X, 8)], "forearm.R": [(X, 8)]}

    def merge(*ds):
        out = {}
        for d in ds:
            for kk, v in d.items():
                if kk == "hips_loc":
                    out[kk] = v
                else:
                    out[kk] = out.get(kk, []) + list(v)
        return out

    # Idle 2.0 s：呼吸
    idle = []
    for t in (0.0, 0.5, 1.0, 1.5, 2.0):
        ph = math.sin(t / 2.0 * 2 * math.pi)
        idle.append((t, merge(arms_down, {
            "chest": [(X, 1.5 * ph)], "spine": [(X, 0.8 * ph)], "head": [(X, -1.2 * ph), (Z, 2.0 * math.sin(t / 2.0 * 2 * math.pi + 1))],
            "upperarm.L": [(Y, -1.5 * ph)], "upperarm.R": [(Y, 1.5 * ph)],
            "hips_loc": (0, 0, 0.004 * ph),
        })))
    clip("Idle", idle, True)

    # Run 0.6 s 一個循環（兩步）
    run = []
    T = RUN_T
    for i in range(9):
        t = T * i / 8
        ph = 2 * math.pi * t / T
        sw = math.sin(ph)
        kneeL = max(0, -math.cos(ph)) * 55 + 8
        kneeR = max(0, math.cos(ph)) * 55 + 8
        bob = abs(math.sin(ph)) * 0.025 - 0.012
        run.append((t, merge(arms_down, {
            "spine": [(X, 8)], "chest": [(X, 4), (Z, 6 * sw)], "head": [(X, -8)],
            "thigh.L": [(X, -RUN_SWING * sw)], "thigh.R": [(X, RUN_SWING * sw)],
            "shin.L": [(X, kneeL)], "shin.R": [(X, kneeR)],
            "foot.L": [(X, -12 * max(0, sw))], "foot.R": [(X, -12 * max(0, -sw))],
            "upperarm.L": [(X, 35 * sw)], "upperarm.R": [(X, -35 * sw)],
            "forearm.L": [(X, -35)], "forearm.R": [(X, -35)],
            "hips_loc": (0, 0, bob),
        })))
    clip("Run", run, True)

    # Jump 0.7 s（技能用；一般移動不提供跳躍鍵）
    clip("Jump", [
        (0.0, merge(arms_down, {})),
        (0.12, merge(arms_down, {"thigh.L": [(X, -30)], "thigh.R": [(X, -30)], "shin.L": [(X, 55)], "shin.R": [(X, 55)], "foot.L": [(X, -25)], "foot.R": [(X, -25)], "spine": [(X, 12)], "hips_loc": (0, 0, -0.10)})),
        (0.3, {"thigh.L": [(X, -25)], "thigh.R": [(X, 5)], "shin.L": [(X, 60)], "shin.R": [(X, 20)], "upperarm.L": [(Y, 40)], "upperarm.R": [(Y, -40)], "spine": [(X, -4)], "head": [(X, -6)]}),
        (0.55, merge(arms_down, {"thigh.L": [(X, -25)], "thigh.R": [(X, -25)], "shin.L": [(X, 45)], "shin.R": [(X, 45)], "foot.L": [(X, -20)], "foot.R": [(X, -20)], "spine": [(X, 10)], "hips_loc": (0, 0, -0.08)})),
        (0.7, merge(arms_down, {})),
    ], False)

    # Attack_Sword 0.5 s：0～0.14 舉劍、0.14～0.26 斜劈（0.20 命中）、0.26～0.5 收招
    clip("Attack_Sword", [
        (0.0, merge(arms_down, {})),
        (0.14, merge({"upperarm.L": [(Y, -20)], "forearm.L": [(X, 10)]}, {"upperarm.R": [(X, 70), (Y, -60)], "forearm.R": [(X, 60)], "hand.R": [(Y, -20)], "spine": [(Z, -22), (X, -4)], "chest": [(Z, -10)], "head": [(Z, 12)]})),
        (0.20, merge({"upperarm.L": [(Y, -25)], "forearm.L": [(X, 10)]}, {"upperarm.R": [(X, 75), (Y, 10)], "forearm.R": [(X, 10)], "hand.R": [(Y, 15)], "spine": [(Z, 18), (X, 10)], "chest": [(Z, 8)], "head": [(Z, -6)], "thigh.R": [(X, 12)], "thigh.L": [(X, -15)], "shin.L": [(X, 12)]})),
        (0.26, merge({"upperarm.L": [(Y, -25)], "forearm.L": [(X, 10)]}, {"upperarm.R": [(X, 55), (Y, 30)], "forearm.R": [(X, 5)], "hand.R": [(Y, 20)], "spine": [(Z, 24), (X, 12)], "chest": [(Z, 10)], "thigh.R": [(X, 12)], "thigh.L": [(X, -15)], "shin.L": [(X, 12)]})),
        (0.5, merge(arms_down, {})),
    ], False)

    # Attack_Staff 0.5 s：0～0.14 舉杖蓄力、0.20 前推施法（命中）、收招
    clip("Attack_Staff", [
        (0.0, merge(arms_down, {})),
        (0.14, merge({"upperarm.L": [(X, 30), (Y, -10)], "forearm.L": [(X, 40)]}, {"upperarm.R": [(X, 95), (Y, -25)], "forearm.R": [(X, 30)], "spine": [(X, -8), (Z, -8)], "head": [(X, -6)]})),
        (0.20, merge({"upperarm.L": [(X, 60), (Y, -15)], "forearm.L": [(X, 20)]}, {"upperarm.R": [(X, 70), (Y, 5)], "forearm.R": [(X, 0)], "spine": [(X, 12), (Z, 6)], "head": [(X, 4)], "thigh.L": [(X, -18)], "thigh.R": [(X, 10)], "shin.L": [(X, 14)]})),
        (0.30, merge({"upperarm.L": [(X, 55), (Y, -15)], "forearm.L": [(X, 20)]}, {"upperarm.R": [(X, 65), (Y, 5)], "forearm.R": [(X, 0)], "spine": [(X, 12), (Z, 6)], "thigh.L": [(X, -18)], "thigh.R": [(X, 10)], "shin.L": [(X, 14)]})),
        (0.5, merge(arms_down, {})),
    ], False)

    # Hurt 0.4 s
    clip("Hurt", [
        (0.0, merge(arms_down, {})),
        (0.08, merge(arms_down, {"spine": [(X, -14)], "chest": [(X, -6)], "head": [(X, -14)], "upperarm.L": [(Y, 18)], "upperarm.R": [(Y, -18)], "hips_loc": (0, 0.03, -0.01)})),
        (0.4, merge(arms_down, {})),
    ], False)

    # Death 1.0 s：向後倒地，最後一格停住
    clip("Death", [
        (0.0, merge(arms_down, {})),
        (0.25, merge(arms_down, {"spine": [(X, -12)], "head": [(X, -10)], "thigh.L": [(X, -20)], "shin.L": [(X, 40)], "thigh.R": [(X, -10)], "shin.R": [(X, 25)], "hips_loc": (0, 0.05, -0.12)})),
        (0.6, {"hips": [(X, -70)], "spine": [(X, -8)], "head": [(X, -10)], "thigh.L": [(X, -40)], "shin.L": [(X, 70)], "thigh.R": [(X, -25)], "shin.R": [(X, 40)], "upperarm.L": [(Y, 30)], "upperarm.R": [(Y, -30)], "hips_loc": (0, 0.22, -0.42)}),
        (1.0, {"hips": [(X, -88)], "spine": [(X, -2)], "head": [(X, 6), (Z, 20)], "thigh.L": [(X, -30)], "shin.L": [(X, 30)], "thigh.R": [(X, -12)], "shin.R": [(X, 15)], "upperarm.L": [(Y, 50)], "upperarm.R": [(Y, -50)], "hips_loc": (0, 0.30, -0.47)}),
    ], False)
    return actions


# ---------------- 預覽 ----------------
def render_views(arm, out_prefix, action=None, frame=1, views=("front", "side", "back", "q34"), size=420):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "TEXTURE"
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.film_transparent = False
    if not sc.world:
        sc.world = bpy.data.worlds.new("w")
    arm.animation_data_create()
    arm.animation_data.action = bpy.data.actions.get(action) if action else None
    sc.frame_set(frame)
    cam = bpy.data.objects.get("cam") or bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    if cam.name not in sc.collection.objects:
        sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 1.75
    sc.camera = cam
    files = []
    dirs = {"front": (0, -1, 0), "back": (0, 1, 0), "side": (1, 0, 0), "q34": (0.7, -0.7, 0.25)}
    for v in views:
        d = Vector(dirs[v]).normalized()
        c = Vector((0, 0, 0.66))
        cam.location = c + d * 5
        cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
        fp = f"{out_prefix}_{v}.png"
        sc.render.filepath = fp
        bpy.ops.render.render(write_still=True)
        files.append(os.path.basename(fp))
    return files


# ---------------- 輸出 ----------------
def base_color_images():
    out = set()
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                for l in n.inputs["Base Color"].links:
                    if l.from_node.type == "TEX_IMAGE" and l.from_node.image:
                        out.add(l.from_node.image.name)
    return out


def scale_images(maxbase, maxother):
    base = base_color_images()
    for img in bpy.data.images:
        if img.size[0] == 0:
            continue
        is_base = img.name in base
        m = maxbase if is_base else maxother
        w, h = img.size
        if max(w, h) > m:
            f = m / max(w, h)
            img.scale(max(1, int(w * f)), max(1, int(h * f)))


def export(objs, path, anim, jpeg):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_animations=anim, export_animation_mode="ACTIONS" if anim else "ACTIVE_ACTIONS",
        export_skins=True, export_def_bones=False, export_extras=True, export_image_format="JPEG", export_jpeg_quality=jpeg,
        export_yup=True, export_apply=False, export_morph=False, export_optimize_animation_size=True,
    )


def measure_run(arm):
    """跑步動畫的地面速度：支撐腳（腳尖最低時）往後移動的速度（公尺／秒，播放倍率 1）"""
    sc = bpy.context.scene
    arm.animation_data.action = bpy.data.actions["Run"]
    n = int(RUN_T * FPS)
    pos = {"L": [], "R": []}
    for f in range(1, n + 2):
        sc.frame_set(f)
        for S in ("L", "R"):
            pb = arm.pose.bones[f"toe.{S}"]
            pos[S].append(arm.matrix_world @ pb.head)
    speeds = []
    for S in ("L", "R"):
        P = pos[S]
        zmin = min(p.z for p in P)
        for i in range(len(P) - 1):
            if P[i].z < zmin + 0.015 and P[i + 1].z < zmin + 0.015:
                speeds.append((P[i + 1].y - P[i].y) * FPS)  # 前方 −Y → 支撐腳往後 = +Y
    arm.animation_data.action = None
    speeds = sorted(speeds)
    return round(float(speeds[len(speeds) // 2]), 3) if speeds else None


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def main():
    for g in ("male", "female"):
        arm, rep = build_gender(g)
        prev = os.path.join(OUT, "preview")
        os.makedirs(prev, exist_ok=True)
        # 預覽：綁定姿勢（含兩把武器）與各動畫關鍵格
        objs = {o.name: o for o in bpy.data.objects if o.parent == arm}
        # 預覽和遊戲一樣：穿整套衣服時被蓋住的身體不畫
        for o in objs.values():
            if o.name == "Body_Covered":
                o.hide_render = True
        for o in objs.values():
            if "Staff" in o.name:
                o.hide_render = True
        rep["preview"] = render_views(arm, os.path.join(prev, f"{g}_rest"))
        rep["preview"] += render_views(arm, os.path.join(prev, f"{g}_idle"), "Idle", 1)
        for o in objs.values():
            if "Staff" in o.name:
                o.hide_render = False
        staff = [o for n, o in objs.items() if "Staff" in n]
        sword = [o for n, o in objs.items() if "Sword" in n]
        for o in staff:
            o.hide_render = True
        for a, frames in (("Idle", [1, 16]), ("Run", [1, 5, 10, 14]), ("Attack_Sword", [5, 7, 9, 13]), ("Hurt", [3]), ("Death", [31]), ("Jump", [10])):
            for f in frames:
                rep.setdefault("anim_preview", []).extend(render_views(arm, os.path.join(prev, f"{g}_{a}_{f:02d}"), a, f, views=("q34",), size=300))
        for o in staff:
            o.hide_render = False
        for o in sword:
            o.hide_render = True
        for f in (5, 7, 9):
            rep["anim_preview"].extend(render_views(arm, os.path.join(prev, f"{g}_Attack_Staff_{f:02d}"), "Attack_Staff", f, views=("q34",), size=300))
        for o in sword:
            o.hide_render = False
        rep["run_ground_speed_mps"] = measure_run(arm)
        arm["starwishCharacter"] = json.dumps({"version": "tripo-novice-v1", "gender": g, "heightM": HEIGHT_M, "runGroundSpeed": rep["run_ground_speed_mps"], "attack": {"seconds": 0.5, "hit": 0.2}, "clips": list(rep["clips"].keys())})
        for p in arm.pose.bones:
            p.rotation_quaternion = Quaternion()
            p.location = Vector()
        arm.animation_data.action = None
        bpy.context.scene.frame_set(1)
        # 輸出 HQ → Lite
        slots = {
            "body": [o for o in objs.values() if o.name.startswith("Body_")],
            "hair01": [o for o in objs.values() if "Hair" in o.name],
            "top": [o for o in objs.values() if "Top" in o.name],
            "bottom": [o for o in objs.values() if ("Pants" in o.name or "Leggings" in o.name)],
            "boots": [o for o in objs.values() if "Boots" in o.name],
            "sword": sword,
            "staff": staff,
        }
        files = {}
        for lod in ("hq", "lite"):
            L = LOD[lod]
            if lod == "lite":
                for o in objs.values():
                    m = o.modifiers.new("dec", "DECIMATE")
                    m.ratio = L["ratio"]
                    m.use_collapse_triangulate = True
                    o.modifiers.move(len(o.modifiers) - 1, 0)
                    with bpy.context.temp_override(object=o, active_object=o):
                        bpy.ops.object.modifier_apply(modifier=m.name)
            scale_images(L["tex"]["base"], L["tex"]["other"])
            d = os.path.join(OUT, "glb")
            os.makedirs(d, exist_ok=True)
            for slot, os_ in slots.items():
                fn = f"novice72_{g}_{slot}_{lod}.glb"
                export([arm] + os_, os.path.join(d, fn), slot == "body", L["jpeg"])
                files[fn] = {"bytes": os.path.getsize(os.path.join(d, fn)), "tris": sum(tri_count(o) for o in os_), "meshes": [o.name for o in os_]}
            log(g, lod, "exported")
        rep["files"] = files
    REPORT["seconds"] = round(time.time() - T0, 1)
    json.dump(REPORT, open(os.path.join(OUT, "build_report.json"), "w"), indent=1, ensure_ascii=False)
    log("done")


BONE_DEF = {b[0]: b for b in BONES}
BONE_DEF["weapon.R"] = ("weapon.R", "hand.R", "hand.R", "hand_end.R")
main()
