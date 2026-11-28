"""
Stage 7.5 蒙皮修正（Tripo 自動綁骨）。全部在 glTF 綁定姿勢座標（原始空間，+Y 上、角色面向 +X、左手 −Z）。

問題：上衣側片、兜帽被上臂／鎖骨骨骼帶動（手臂一抬，衣服像翅膀一樣張開）；衣襬吃到大腿權重（跑步時被撕扯）。
做法：
1. 手臂歸屬度：從手臂骨骼附近的頂點出發，沿網格表面算測地距離；袖子、手套離手臂「沿表面」也很近，
   上衣側片、兜帽雖然直線距離近，但沿表面要繞到肩膀 → 歸屬度低。非手臂的部分，手臂權重移給軀幹骨骼。
2. 腿同理：褲管、靴子保留大腿／小腿權重；上衣下襬的腿權重移給骨盆（再由輔助骨骼 Hem_F／Hem_B 帶動）。
3. 輔助骨骼（次級動態用，原本的骨骼一根都不改）：
   Hair_Back（頭）、Hood（上胸）、Hem_F／Hem_B（骨盆）。只把一部分權重從原本骨骼分出去，靜止時外觀完全不變。
4. 每個頂點最多 4 個影響，總和 1。
"""
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

ARM_PARTS = ["Clavicle", "Upperarm", "Forearm", "Elbow", "Hand", "Pinky", "Ring", "Mid", "Index", "Thumb"]
LEG_PARTS = ["Thigh", "Calf", "Knee", "Foot", "Toe"]
TORSO = ["Pelvis", "Waist", "Spine01", "Spine02", "NeckTwist01"]


def weld_graph(P, I, tol=2e-5):
    """位置相同的頂點合併（glTF 在 UV 接縫處拆頂點），回傳合併索引與邊長圖"""
    _, wid = np.unique(np.round(P / tol).astype(np.int64), axis=0, return_inverse=True)
    wid = wid.ravel()
    m = wid.max() + 1
    Q = np.zeros((m, 3))
    Q[wid] = P
    E = np.vstack([I[:, [0, 1]], I[:, [1, 2]], I[:, [2, 0]]])
    E = wid[E]
    E = E[E[:, 0] != E[:, 1]]
    L = np.linalg.norm(Q[E[:, 0]] - Q[E[:, 1]], axis=1)
    G = coo_matrix((np.r_[L, L], (np.r_[E[:, 0], E[:, 1]], np.r_[E[:, 1], E[:, 0]])), shape=(m, m)).tocsr()
    return wid, Q, G


def seg_dist(P, pts):
    d = np.full(len(P), 9.0)
    t_all = np.zeros(len(P))
    seg = np.zeros(len(P), dtype=int)
    for k in range(len(pts) - 1):
        a, b = pts[k], pts[k + 1]
        ab = b - a
        t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
        dk = np.linalg.norm(P - (a + t[:, None] * ab), axis=1)
        m = dk < d
        d[m] = dk[m]
        t_all[m] = t[m]
        seg[m] = k
    return d, seg, t_all


def membership(Q, G, seeds_w, slack=1.15, base=0.012, soft=0.045):
    """
    seeds_w：合併頂點中「確定屬於這條肢體」的（原本就幾乎 100% 綁在前臂／手、小腿／腳的頂點）。
    對每個頂點比較：沿網格表面到種子的距離 g，與直線距離 e。
    g ≈ e → 可以沿著同一條肢體直接走到 → 屬於；g 明顯大於 e（要繞路，例如上衣側片要先爬到肩膀再下來）→ 不屬於。
    """
    from scipy.spatial import cKDTree
    seeds = np.where(seeds_w)[0]
    if len(seeds) == 0:
        return np.zeros(len(Q))
    g = dijkstra(G, indices=seeds, min_only=True)
    e, _ = cKDTree(Q[seeds]).query(Q)
    excess = g - (e * slack + base)
    return np.clip(1 - excess / soft, 0, 1)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def fix_weights(P, I, Wd, names, jw, report, vcol=None):
    """
    P: 綁定姿勢頂點（原始 glTF 空間）；Wd: (nv, nj) 權重矩陣；names: 骨骼名稱（依 skin.joints 順序）；
    jw: {名稱: 綁定姿勢世界座標位置}
    回傳新的權重矩陣（含輔助骨骼欄位）、輔助骨骼定義
    """
    nv, nj = Wd.shape
    col = {n: k for k, n in enumerate(names)}
    wid, Q, G = weld_graph(P, I)
    W = Wd.copy()
    up = np.array([0, 1.0, 0])

    def cols(prefix, parts):
        return [col[n] for n in names if n.startswith(prefix) and any(n[len(prefix):].startswith(p) for p in parts)]

    torso_y = np.array([jw[n][1] for n in TORSO])
    torso_c = [col[n] for n in TORSO]

    def torso_target(y):
        """依高度在軀幹骨骼之間線性分配（回傳 (nv, len(TORSO)) 比例）"""
        out = np.zeros((len(y), len(TORSO)))
        for i, yy in enumerate(y):
            k = np.searchsorted(torso_y, yy)
            if k <= 0:
                out[i, 0] = 1
            elif k >= len(TORSO):
                out[i, -1] = 1
            else:
                f = (yy - torso_y[k - 1]) / (torso_y[k] - torso_y[k - 1])
                out[i, k - 1] = 1 - f
                out[i, k] = f
        return out

    stats = {}
    # ---------- 1. 手臂 ----------
    for S in ("L_", "R_"):
        distal = cols(S, ["Forearm", "Elbow", "Hand", "Pinky", "Ring", "Mid", "Index", "Thumb"])
        sw = np.zeros(len(Q))
        np.maximum.at(sw, wid, W[:, distal].sum(1))
        m = membership(Q, G, sw > 0.85)[wid]
        # 袖子（米白色、低飽和）且靠近上臂／前臂骨骼軸 → 一定屬於手臂（腋下的袖子底面不會被留在身體上拉出尖角）
        if vcol is not None:
            mx_ = vcol.max(1)
            sat = (mx_ - vcol.min(1)) / np.maximum(mx_, 1e-6)
            beige = smoothstep(0.32, 0.18, sat) * smoothstep(0.35, 0.5, mx_)
            da, _, _ = seg_dist(P, [jw[S + "Upperarm"], jw[S + "Forearm"], jw[S + "Hand"]])
            m = np.maximum(m, beige * smoothstep(0.075, 0.05, da))
        # 肩關節附近（上臂頭 4 cm 內、高於腋下）保留一部分手臂影響，避免抬手時肩膀穿出衣服
        dj = np.linalg.norm(P - jw[S + "Upperarm"], axis=1)
        keep_sh = 0.45 * smoothstep(0.06, 0.03, dj)
        m = np.maximum(m, keep_sh)
        ac = cols(S, ARM_PARTS)
        wa = W[:, ac].sum(1)
        moved = wa * (1 - m)
        sel = moved > 1e-4
        W[np.ix_(sel, ac)] *= m[sel, None]
        W[np.ix_(sel, torso_c)] += moved[sel, None] * torso_target(P[sel, 1])
        stats[S + "arm"] = {"verts_changed": int((moved > 0.05).sum()), "weight_moved": round(float(moved.sum()), 1)}
    # ---------- 2. 腿 ----------
    leg_moved = np.zeros(nv)
    for S in ("L_", "R_"):
        distal = cols(S, ["Calf", "Knee", "Foot", "Toe"])
        sw = np.zeros(len(Q))
        np.maximum.at(sw, wid, W[:, distal].sum(1))
        m = membership(Q, G, sw > 0.85, slack=1.2, base=0.015, soft=0.05)[wid]
        lc = cols(S, LEG_PARTS)
        wl = W[:, lc].sum(1)
        moved = wl * (1 - m)
        sel = moved > 1e-4
        W[np.ix_(sel, lc)] *= m[sel, None]
        W[sel, col["Pelvis"]] += moved[sel]
        leg_moved += moved
        stats[S + "leg"] = {"verts_changed": int((moved > 0.05).sum()), "weight_moved": round(float(moved.sum()), 1)}

    # ---------- 3. 輔助骨骼 ----------
    helpers = []
    fwd = np.array([1.0, 0, 0])  # 原始空間角色面向 +X
    head = jw["Head"]
    # 3a. 後髮：頭部權重 ≥ 0.9、位於頭部中心後方、且低於頭頂
    hw = W[:, col["Head"]] + W[:, col.get("FacialBone", col["Head"])]
    top = P[hw > 0.9, 1].max() if (hw > 0.9).any() else head[1] + 0.2
    back = (P - head) @ fwd
    hair_w = (hw > 0.9) * smoothstep(-0.02, -0.07, back) * smoothstep(top - 0.06, top - 0.20, P[:, 1]) * 0.75
    pivot_hair = head + np.array([-0.04, (top - head[1]) * 0.75, 0])
    helpers.append(("Hair_Back", "Head", pivot_hair, hair_w, [col["Head"]]))
    # 3b. 兜帽：脖子後方、上胸高度、位於軀幹後側
    neck = jw["NeckTwist01"]
    sp2 = jw["Spine02"]
    backn = (P - neck) @ fwd
    hood_w = smoothstep(-0.03, -0.07, backn) * smoothstep(sp2[1] - 0.02, sp2[1] + 0.03, P[:, 1]) * smoothstep(neck[1] + 0.06, neck[1] + 0.0, P[:, 1]) * 0.55
    hood_w *= (W[:, [col["Spine02"], col["NeckTwist01"], col["NeckTwist02"]]].sum(1) > 0.4)
    helpers.append(("Hood", "Spine02", neck + np.array([-0.05, -0.01, 0]), hood_w, [col["Spine02"], col["NeckTwist01"], col["NeckTwist02"]]))
    # 3c. 衣襬前／後：皮帶以下、已經移到骨盆的上衣下襬
    pel = jw["Pelvis"]
    belt_y = jw["Waist"][1]
    hem_amt = smoothstep(belt_y - 0.02, belt_y - 0.12, P[:, 1]) * np.clip(leg_moved * 3, 0, 1) * 0.85
    side = (P - pel) @ fwd
    hem_f = hem_amt * smoothstep(0.0, 0.04, side)
    hem_b = hem_amt * smoothstep(0.0, -0.04, side)
    helpers.append(("Hem_F", "Pelvis", np.array([pel[0] + 0.03, belt_y - 0.02, pel[2]]), hem_f, [col["Pelvis"]]))
    helpers.append(("Hem_B", "Pelvis", np.array([pel[0] - 0.03, belt_y - 0.02, pel[2]]), hem_b, [col["Pelvis"]]))

    Wx = np.zeros((nv, nj + len(helpers)))
    Wx[:, :nj] = W
    hdefs = []
    for k, (name, parent, pivot, hw_, from_cols) in enumerate(helpers):
        c = nj + k
        avail = Wx[:, from_cols].sum(1)
        take = np.minimum(hw_, 1.0) * avail
        sel = take > 1e-4
        # 從來源骨骼按比例拿走
        frac = np.where(avail > 0, take / np.maximum(avail, 1e-9), 0)
        Wx[np.ix_(sel, from_cols)] *= (1 - frac[sel, None])
        Wx[sel, c] += take[sel]
        hdefs.append({"name": name, "parent": parent, "pivot": pivot.tolist(), "verts": int((take > 0.05).sum())})
        stats["helper_" + name] = int((take > 0.05).sum())

    # ---------- 4. 最多 4 個影響、總和 1 ----------
    order = np.argsort(-Wx, axis=1)[:, :4]
    top4 = np.take_along_axis(Wx, order, axis=1)
    top4[top4 < 0.01] = 0
    top4 /= top4.sum(1, keepdims=True)
    report["weights"] = stats
    return order, top4, hdefs
