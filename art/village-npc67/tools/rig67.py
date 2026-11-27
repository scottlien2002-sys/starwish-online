"""Stage 6.7 Tripo NPC 骨架、權重、動作、GLB 輸出（Claude B）。

座標：glTF 右手系、Y 上、角色面向 +Z；角色左手＝+X。單位公尺（已縮放）。
骨架：所有骨頭靜止姿勢旋轉＝單位旋轉（只有位移），動作以「模型座標軸」描述：
  繞 X 正轉＝向前彎（低頭、彎腰）；繞 Y 正轉＝轉向角色左邊；繞 Z 正轉＝上方往角色右邊倒。
"""
import io, json, math, struct
import numpy as np
from PIL import Image

FPS = 30
BONES = [  # name, parent
    ("root", None), ("hips", "root"), ("spine", "hips"), ("chest", "spine"), ("neck", "chest"), ("head", "neck"),
    ("upperarm.R", "chest"), ("forearm.R", "upperarm.R"), ("hand.R", "forearm.R"),
    ("upperarm.L", "chest"), ("forearm.L", "upperarm.L"), ("hand.L", "forearm.L"),
    ("thigh.R", "hips"), ("shin.R", "thigh.R"), ("foot.R", "shin.R"),
    ("thigh.L", "hips"), ("shin.L", "thigh.L"), ("foot.L", "shin.L"),
]
BI = {n: i for i, (n, _) in enumerate(BONES)}
PARENT = [BI[p] if p else -1 for _, p in BONES]


# ---------------------------------------------------------------- math
def qaxis(axis, deg):
    a = math.radians(deg) / 2
    ax = np.array(axis, float); ax /= np.linalg.norm(ax)
    return np.array([*(ax * math.sin(a)), math.cos(a)])


def qmul(a, b):
    x1, y1, z1, w1 = a; x2, y2, z2, w2 = b
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
                     w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])


def qeuler(pitch=0.0, yaw=0.0, roll=0.0):
    """yaw(Y) * pitch(X) * roll(Z)，角度（度）"""
    return qmul(qmul(qaxis((0, 1, 0), yaw), qaxis((1, 0, 0), pitch)), qaxis((0, 0, 1), roll))


def qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- mesh io
def load_obj(path):
    """減面結果（焊接頂點＋vt）→ 依 (v, vt) 拆頂點；回傳 pos, uv, idx（glTF V 朝下）"""
    V, T, F = [], [], []
    for ln in open(path):
        if ln.startswith('v '): V.append([float(x) for x in ln.split()[1:4]])
        elif ln.startswith('vt '): T.append([float(x) for x in ln.split()[1:3]])
        elif ln.startswith('f '):
            F.append([tuple(int(k) - 1 for k in c.split('/')[:2]) for c in ln.split()[1:]])
    V = np.array(V); T = np.array(T)
    keys = {}; pos = []; uv = []; idx = []
    for f in F:
        tri = []
        for (vi, ti) in f:
            k = (vi, ti)
            if k not in keys:
                keys[k] = len(pos); pos.append(V[vi]); uv.append([T[ti][0], 1 - T[ti][1]])
            tri.append(keys[k])
        idx.append(tri)
    return np.array(pos), np.array(uv), np.array(idx, np.int64)


def smooth_normals(pos, idx):
    key = np.round(pos / 1e-6).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.reshape(-1)
    fn = np.cross(pos[idx[:, 1]] - pos[idx[:, 0]], pos[idx[:, 2]] - pos[idx[:, 0]])
    acc = np.zeros((inv.max() + 1, 3))
    for k in range(3): np.add.at(acc, inv[idx[:, k]], fn)
    n = acc[inv]
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)


def weld_adjacency(pos, idx):
    key = np.round(pos / 1e-5).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.reshape(-1)
    nw = inv.max() + 1
    e = np.concatenate([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]])
    e = inv[e]; e = np.concatenate([e, e[:, ::-1]])
    e = np.unique(e[e[:, 0] != e[:, 1]], axis=0)
    return inv, nw, e


# ---------------------------------------------------------------- skeleton
def build_skeleton(cfg, pos_raw_hq):
    """cfg['joints']：原始單位 (x, y[, z])；z 省略時取附近頂點中位數（身體中心）。回傳公尺座標。"""
    s = cfg['scale']
    J = {}
    P = pos_raw_hq
    for name, v in cfg['joints'].items():
        x, y = v[0], v[1]
        if len(v) > 2 and v[2] is not None:
            z = v[2]
        else:
            m = (np.abs(P[:, 0] - x) < 0.03) & (np.abs(P[:, 1] - y) < 0.03)
            z = float(np.median(P[m, 2])) if m.sum() > 5 else 0.0
        J[name] = np.array([x, y, z]) * s
    return J


def seg_param(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    d = np.linalg.norm(p - (a + t[:, None] * ab), axis=1)
    return t, d


def chain_dist(p, pts):
    """多段折線：回傳 (最近段 index, 段內參數 t, 距離)"""
    best = np.full(len(p), 1e9); seg = np.zeros(len(p), int); tt = np.zeros(len(p))
    for i in range(len(pts) - 1):
        t, d = seg_param(p, pts[i], pts[i + 1])
        m = d < best
        best[m] = d[m]; seg[m] = i; tt[m] = t[m]
    return seg, tt, best


def in_box(p, box):
    lo = np.array(box[0]); hi = np.array(box[1])
    return np.all((p >= lo) & (p <= hi), axis=1)


def compute_weights(pos, idx, J, cfg):
    """回傳 (N, nbones) 權重。pos：公尺。cfg 的長度參數為公尺。"""
    s = cfg['scale']
    N = len(pos); W = np.zeros((N, len(BONES)))
    y = pos[:, 1]
    hipY = J['hips'][1]
    # ---- 軀幹：依高度分段（帶平滑過渡）
    ys = [J['hips'][1], J['spine'][1], J['chest'][1], J['neck'][1], J['head'][1]]
    names = ['hips', 'spine', 'chest', 'neck', 'head']
    blend = [0.05 * s, 0.05 * s, 0.03 * s, 0.025 * s]
    torso = np.zeros((N, 5))
    torso[:, 0] = 1
    for i in range(1, 5):
        mid = (ys[i - 1] + ys[i]) / 2 if i < 3 else ys[i] - (0.01 * s if i == 3 else 0.0)
        f = smoothstep(mid - blend[i - 1], mid + blend[i - 1], y)
        torso[:, :i] *= (1 - f)[:, None]
        torso[:, i] = f
    for i, n in enumerate(names): W[:, BI[n]] = torso[:, i]
    assigned = np.zeros(N, bool)
    # ---- 腿
    for side in ('R', 'L'):
        pts = [J[f'thigh.{side}'], J[f'shin.{side}'], J[f'foot.{side}'], J[f'toe.{side}']]
        seg, t, d = chain_dist(pos, pts)
        other = 'L' if side == 'R' else 'R'
        opts = [J[f'thigh.{other}'], J[f'shin.{other}'], J[f'foot.{other}'], J[f'toe.{other}']]
        _, _, d2 = chain_dist(pos, opts)
        m = (d < cfg['leg_r'] * s) & (d <= d2) & (y < hipY - 0.01 * s) & ~assigned
        for box in cfg.get('leg_exclude', []): m &= ~in_box(pos, [np.array(box[0]) * s, np.array(box[1]) * s])
        wl = np.zeros((N, 3))
        # 大腿→小腿（膝蓋前後 2.5 cm）→腳（腳踝 1.5 cm）
        kneeY = J[f'shin.{side}'][1]; ankY = J[f'foot.{side}'][1]
        fk = smoothstep(kneeY + 0.025 * s, kneeY - 0.025 * s, y)
        fa = smoothstep(ankY + 0.012 * s, ankY - 0.012 * s, y)
        wl[:, 0] = 1 - fk; wl[:, 1] = fk * (1 - fa); wl[:, 2] = fa
        # 胯部：大腿與骨盆混合
        fh = smoothstep(hipY - 0.08 * s, hipY - 0.01 * s, y)
        wl *= (1 - fh)[:, None]
        W[m] = 0
        W[m, BI[f'thigh.{side}']] = wl[m, 0]
        W[m, BI[f'shin.{side}']] = wl[m, 1]
        W[m, BI[f'foot.{side}']] = wl[m, 2]
        W[m, BI['hips']] += fh[m]
        assigned |= m
    # 腳底：腳踝以下、靠近該側腳的頂點全部綁腳（避免鞋跟被骨盆拉住）
    if cfg.get('leg_r', 0) > 0:
        fr = J['foot.R']; fl = J['foot.L']
        low_f = (y < max(fr[1], fl[1]) + 0.02 * s)
        dr = np.hypot(pos[:, 0] - fr[0], pos[:, 2] - (fr[2] + J['toe.R'][2]) / 2)
        dl = np.hypot(pos[:, 0] - fl[0], pos[:, 2] - (fl[2] + J['toe.L'][2]) / 2)
        for side, dd, do in (('R', dr, dl), ('L', dl, dr)):
            m = low_f & (dd < 0.12 * s) & (dd <= do)
            W[m] = 0; W[m, BI[f'foot.{side}']] = 1; assigned |= m
    # 腿以外的下半身（披風、裙擺）：骨盆
    low = (~assigned) & (y < hipY)
    W[low] = 0; W[low, BI['hips']] = 1
    # ---- 手臂
    for side in ('R', 'L'):
        pts = [J[f'upperarm.{side}'], J[f'forearm.{side}'], J[f'hand.{side}'], J[f'handend.{side}']]
        seg, t, d = chain_dist(pos, pts)
        r = np.array(cfg['arm_r'] if isinstance(cfg['arm_r'], (list, tuple)) else [cfg['arm_r']] * 3)[np.minimum(seg, 2)] * s
        m = (d < r) & ~assigned
        for box in cfg.get('arm_exclude', []): m &= ~in_box(pos, [np.array(box[0]) * s, np.array(box[1]) * s])
        # 肩膀：靠近肩關節時與胸混合（距肩 0～arm_blend）
        ds = np.linalg.norm(pos - J[f'upperarm.{side}'], axis=1)
        fs = smoothstep(0.0, cfg.get('arm_blend', 0.05) * s, ds)
        el = J[f'forearm.{side}']; wr = J[f'hand.{side}']
        ua = np.where(seg == 0, 1.0, 0.0); fa_ = np.where(seg == 1, 1.0, 0.0); ha = np.where(seg >= 2, 1.0, 0.0)
        # 手肘、手腕附近平滑
        de = np.linalg.norm(pos - el, axis=1); dw = np.linalg.norm(pos - wr, axis=1)
        be = smoothstep(0.03 * s, 0.0, de) * 0.5; bw = smoothstep(0.02 * s, 0.0, dw) * 0.5
        ua2 = ua * (1 - be) + fa_ * be; fa2 = fa_ * (1 - be) * (1 - bw) + ua * be + ha * bw; ha2 = ha * (1 - bw) + fa_ * bw
        tot = ua2 + fa2 + ha2 + 1e-9
        ua2, fa2, ha2 = ua2 / tot, fa2 / tot, ha2 / tot
        keep = W[m].copy()
        W[m] = keep * (1 - fs[m])[:, None]
        W[m, BI[f'upperarm.{side}']] += ua2[m] * fs[m]
        W[m, BI[f'forearm.{side}']] += fa2[m] * fs[m]
        W[m, BI[f'hand.{side}']] += ha2[m] * fs[m]
        assigned |= m
    # ---- 道具（武器、盾、法杖）：100% 綁在指定骨頭（剛體）
    rigid = np.zeros(N, bool)
    for bone, kind, geo in cfg.get('props', []):
        if kind == 'box':
            m = in_box(pos, [np.array(geo[0]) * s, np.array(geo[1]) * s])
        else:  # capsule: (a, b, r)
            _, d = seg_param(pos, np.array(geo[0]) * s, np.array(geo[1]) * s)
            m = d < geo[2] * s
        W[m] = 0; W[m, BI[bone]] = 1; rigid |= m
    # ---- 指定區域覆寫（長髮等）：[(box, {bone: w})]
    for box, wd in cfg.get('overrides', []):
        m = in_box(pos, [np.array(box[0]) * s, np.array(box[1]) * s]) & ~rigid
        W[m] = 0
        for b, w in wd.items(): W[m, BI[b]] = w
    # ---- 平滑（焊接後的鄰接；道具不動）
    inv, nw, e = weld_adjacency(pos, idx)
    Wv = np.zeros((nw, len(BONES))); cnt = np.zeros(nw)
    np.add.at(Wv, inv, W); np.add.at(cnt, inv, 1); Wv /= cnt[:, None]
    rig_w = np.zeros(nw, bool); np.logical_or.at(rig_w, inv, rigid)
    deg = np.bincount(e[:, 0], minlength=nw).astype(float)
    for _ in range(cfg.get('smooth', 3)):
        acc = np.zeros_like(Wv); np.add.at(acc, e[:, 0], Wv[e[:, 1]])
        nb = acc / np.maximum(deg, 1)[:, None]
        Wv = np.where(rig_w[:, None], Wv, 0.5 * Wv + 0.5 * nb)
    W = Wv[inv]
    # ---- 最多 4 骨、正規化
    order = np.argsort(-W, axis=1)[:, :4]
    wv = np.take_along_axis(W, order, 1)
    wv[wv < 0.01] = 0
    wv /= wv.sum(1, keepdims=True)
    return order.astype(np.uint16), wv.astype(np.float32)


# ---------------------------------------------------------------- pose / skin
def global_mats(J, local_q, local_t_extra=None):
    """J：骨頭靜止位置（公尺）。local_q：{bone: quat}。回傳每骨 4x4 global 與 skin 矩陣。"""
    G = [None] * len(BONES); S = [None] * len(BONES)
    for i, (n, p) in enumerate(BONES):
        off = J[n] - (J[p] if p else np.zeros(3))
        if local_t_extra and n in local_t_extra: off = off + local_t_extra[n]
        L = np.eye(4); L[:3, :3] = qmat(local_q.get(n, np.array([0, 0, 0, 1.0]))); L[:3, 3] = off
        G[i] = L if PARENT[i] < 0 else G[PARENT[i]] @ L
        IB = np.eye(4); IB[:3, 3] = -J[n]
        S[i] = G[i] @ IB
    return G, S


def skin(pos, joints, weights, S):
    S = np.stack(S)
    out = np.zeros_like(pos)
    ph = np.c_[pos, np.ones(len(pos))]
    for k in range(4):
        M = S[joints[:, k]]
        out += weights[:, k:k + 1] * np.einsum('nij,nj->ni', M, ph)[:, :3]
    return out


# ---------------------------------------------------------------- glb writer
def _pad(b, ch=b'\x00'):
    return b + ch * ((4 - len(b) % 4) % 4)


def jpeg(img, size, q=88):
    im = img.resize((size, size), Image.LANCZOS) if img.size[0] != size else img
    bio = io.BytesIO(); im.convert('RGB').save(bio, 'JPEG', quality=q, optimize=True, progressive=False)
    return bio.getvalue()


def write_glb(path, name, pos, nrm, uv, idx, J, joints=None, weights=None, anims=None, images=None, static=False):
    """images: {'base': jpeg bytes, 'normal': jpeg bytes or None}；anims: {name: {'times', 'rot': {bone: (n,4)}, 'trans': {bone: (n,3)}}}"""
    bin_ = bytearray(); views = []; accs = []

    def add(data, target=None, **acc):
        nonlocal bin_
        off = len(bin_); b = data.tobytes(); bin_ += _pad(b)
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(b)}
        if target: v["target"] = target
        views.append(v)
        a = {"bufferView": len(views) - 1, **acc}
        accs.append(a)
        return len(accs) - 1

    pos = pos.astype(np.float32); nrm = nrm.astype(np.float32); uv = uv.astype(np.float32)
    attrs = {
        "POSITION": add(pos, 34962, componentType=5126, count=len(pos), type="VEC3", min=pos.min(0).tolist(), max=pos.max(0).tolist()),
        "NORMAL": add(nrm, 34962, componentType=5126, count=len(nrm), type="VEC3"),
        "TEXCOORD_0": add(uv, 34962, componentType=5126, count=len(uv), type="VEC2"),
    }
    if not static:
        attrs["JOINTS_0"] = add(joints.astype(np.uint8), 34962, componentType=5121, count=len(pos), type="VEC4")
        attrs["WEIGHTS_0"] = add(weights.astype(np.float32), 34962, componentType=5126, count=len(pos), type="VEC4")
    it = idx.astype(np.uint16 if len(pos) < 65536 else np.uint32).reshape(-1)
    ind = add(it, 34963, componentType=5123 if it.dtype == np.uint16 else 5125, count=len(it), type="SCALAR")
    gl = {"asset": {"version": "2.0", "generator": "starwish npc67 (Claude B)"}, "scene": 0, "scenes": [{"nodes": []}],
          "nodes": [], "meshes": [{"name": name, "primitives": [{"attributes": attrs, "indices": ind, "material": 0}]}],
          "materials": [], "textures": [], "images": [], "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
          "accessors": accs, "bufferViews": views, "buffers": []}
    mat = {"name": f"{name}_mat", "pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 0.85}}
    for kind, data in (images or {}).items():
        if data is None: continue
        off = len(bin_); bin_ += _pad(data)
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(data)})
        gl["images"].append({"bufferView": len(views) - 1, "mimeType": "image/jpeg", "name": f"{name}_{kind}"})
        gl["textures"].append({"source": len(gl["images"]) - 1, "sampler": 0})
        ti = len(gl["textures"]) - 1
        if kind == 'base': mat["pbrMetallicRoughness"]["baseColorTexture"] = {"index": ti}
        elif kind == 'normal': mat["normalTexture"] = {"index": ti}
    gl["materials"].append(mat)
    if static:
        gl["nodes"].append({"name": name, "mesh": 0})
        gl["scenes"][0]["nodes"] = [0]
    else:
        # 骨頭節點
        for i, (n, p) in enumerate(BONES):
            off = J[n] - (J[p] if p else np.zeros(3))
            nd = {"name": n, "translation": [float(v) for v in off]}
            ch = [k for k in range(len(BONES)) if PARENT[k] == i]
            if ch: nd["children"] = ch
            gl["nodes"].append(nd)
        ib = np.stack([np.eye(4) for _ in BONES])
        for i, (n, _) in enumerate(BONES): ib[i, :3, 3] = -J[n]
        ibm = add(ib.transpose(0, 2, 1).astype(np.float32).reshape(-1, 16), componentType=5126, count=len(BONES), type="MAT4")
        gl["skins"] = [{"joints": list(range(len(BONES))), "inverseBindMatrices": ibm, "skeleton": 0}]
        mi = len(gl["nodes"]); gl["nodes"].append({"name": name, "mesh": 0, "skin": 0})
        gl["scenes"][0]["nodes"] = [0, mi]
        gl["animations"] = []
        for an, A in (anims or {}).items():
            times = np.asarray(A['times'], np.float32)
            ti_ = add(times, componentType=5126, count=len(times), type="SCALAR", min=[float(times.min())], max=[float(times.max())])
            ch, sm = [], []
            for b, qs in A['rot'].items():
                o = add(np.asarray(qs, np.float32), componentType=5126, count=len(qs), type="VEC4")
                sm.append({"input": ti_, "output": o, "interpolation": "LINEAR"})
                ch.append({"sampler": len(sm) - 1, "target": {"node": BI[b], "path": "rotation"}})
            for b, ts in A.get('trans', {}).items():
                o = add(np.asarray(ts, np.float32), componentType=5126, count=len(ts), type="VEC3")
                sm.append({"input": ti_, "output": o, "interpolation": "LINEAR"})
                ch.append({"sampler": len(sm) - 1, "target": {"node": BI[b], "path": "translation"}})
            gl["animations"].append({"name": an, "channels": ch, "samplers": sm})
    if not gl["images"]:
        for k in ("images", "textures", "samplers"): gl.pop(k)
    gl["buffers"] = [{"byteLength": len(bin_)}]
    js = _pad(json.dumps(gl, separators=(',', ':')).encode(), b' ')
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_), 0x004E4942) + bytes(bin_)
    open(path, 'wb').write(out)
    return len(out)
