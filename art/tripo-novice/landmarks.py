"""
Tripo 初心者身體的骨架關節位置：從網格自動量測（不依賴 Blender，可離線檢查）。
座標：零件原始空間（Blender 匯入後；Z 上、角色面向 +X、角色右側 = −Y）。單位 = 原始單位（身高約 0.98）。
"""
import numpy as np


def _pca(P):
    c = P.mean(0)
    _, _, vt = np.linalg.svd(P - c)
    return c, vt[0]


def landmarks(V):
    V = np.asarray(V, dtype=np.float64)
    zmin, zmax = V[:, 2].min(), V[:, 2].max()
    H = zmax - zmin
    z = lambda f: zmin + f * H  # 身高比例 → z
    J = {}
    # 軀幹中心線（x）：腰部切片中心
    def slab(zc, ymax=0.12, tol=0.008):
        S = V[(np.abs(V[:, 2] - zc) < tol) & (np.abs(V[:, 1]) < ymax)]
        return S
    # 胯下：兩腿分開的最高點
    crotch = zmin
    for zc in np.linspace(z(0.15), z(0.55), 120):
        S = slab(zc, 0.2)
        if len(S) < 4:
            continue
        ys = np.sort(np.abs(S[:, 1]))
        if ys.min() > 0.008 * H / 0.98:  # 中線沒有頂點 → 兩腿分開
            crotch = zc
    # 頸部：頭與軀幹之間最窄的切片（身高 0.6～0.8）
    best = (9, z(0.72))
    for zc in np.linspace(z(0.62), z(0.78), 60):
        S = slab(zc, 0.2)
        if len(S) < 4:
            continue
        w = S[:, 1].max() - S[:, 1].min()
        if w < best[0]:
            best = (w, zc)
    neck = best[1]
    xc = lambda zc: (lambda S: (S[:, 0].min() + S[:, 0].max()) / 2 if len(S) else 0.0)(slab(zc, 0.06))
    J["root"] = np.array([xc(crotch + 0.02), 0, zmin])
    J["hips"] = np.array([xc(crotch + 0.03), 0, crotch + 0.025 * H])
    J["spine"] = np.array([xc(crotch + 0.12 * H), 0, crotch + 0.10 * H])
    J["chest"] = np.array([xc(crotch + 0.2 * H), 0, crotch + 0.20 * H])
    J["neck"] = np.array([xc(neck), 0, neck - 0.02 * H])
    J["head"] = np.array([xc(neck + 0.02), 0, neck + 0.01 * H])
    J["head_end"] = np.array([J["head"][0], 0, zmax])
    # 手臂：軀幹以外、胯下以上的頂點
    for side, s in (("L", 1), ("R", -1)):
        A = V[(V[:, 1] * s > 0.11 * H / 0.98) & (V[:, 2] > crotch - 0.02 * H) & (V[:, 2] < neck)]
        c, ax = _pca(A)
        if ax[1] * s < 0:
            ax = -ax
        pr = (A - c) @ ax
        root = c + ax * pr.min()
        tip = c + ax * pr.max()
        L = pr.max() - pr.min()
        J[f"shoulder.{side}"] = np.array([J["chest"][0], s * 0.035 * H, J["chest"][2] + 0.06 * H])
        J[f"upperarm.{side}"] = root - ax * 0.01 * H
        J[f"forearm.{side}"] = root + ax * L * 0.45
        J[f"hand.{side}"] = root + ax * L * 0.76
        J[f"hand_end.{side}"] = tip
        # 腿：胯下以下
        Lg = V[(V[:, 1] * s > 0.0) & (V[:, 2] < crotch) & (np.abs(V[:, 1]) < 0.2 * H / 0.98)]
        foot = Lg[Lg[:, 2] < zmin + 0.05 * H]
        ank_z = zmin + 0.065 * H
        A2 = Lg[np.abs(Lg[:, 2] - ank_z) < 0.01 * H]
        ank = np.array([(A2[:, 0].min() + A2[:, 0].max()) / 2, (A2[:, 1].min() + A2[:, 1].max()) / 2, ank_z])
        T = Lg[np.abs(Lg[:, 2] - (crotch - 0.03 * H)) < 0.01 * H]
        thigh = np.array([(T[:, 0].min() + T[:, 0].max()) / 2, (T[:, 1].min() + T[:, 1].max()) / 2, crotch - 0.01 * H])
        knee_z = (thigh[2] + ank_z) / 2
        K = Lg[np.abs(Lg[:, 2] - knee_z) < 0.01 * H]
        knee = np.array([(K[:, 0].min() + K[:, 0].max()) / 2 + 0.01 * H, (K[:, 1].min() + K[:, 1].max()) / 2, knee_z])
        J[f"thigh.{side}"] = thigh
        J[f"shin.{side}"] = knee
        J[f"foot.{side}"] = ank
        toe_x = foot[:, 0].max()
        J[f"toe.{side}"] = np.array([ank[0] + (toe_x - ank[0]) * 0.62, ank[1], zmin + 0.02 * H])
        J[f"toe_end.{side}"] = np.array([toe_x, ank[1], zmin + 0.02 * H])
    return {k: v.tolist() for k, v in J.items()}, dict(crotch=float(crotch), neck=float(neck), H=float(H), zmin=float(zmin))
