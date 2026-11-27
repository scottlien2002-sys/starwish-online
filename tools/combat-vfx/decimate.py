"""Quadric-error half-edge-collapse decimation (pure numpy + heapq; the workspace has no mesh libraries).

Half-edge collapse u -> v keeps v exactly as it is (position, normal, colour, UV, joints, weights), so a skinned,
vertex-coloured mesh stays valid without re-interpolating attributes. Guards:
- vertices that share a position with another vertex (normal / colour / UV seams) and open-boundary vertices are
  LOCKED: they never move, so no cracks open along seams or silhouette edges;
- a collapse is rejected if any surviving triangle would flip (normal turns > ~80 deg) or become degenerate;
- optional `protect` mask (vertices that must not move).
simplify(pos, idx, target_tris) -> new index array (vertex arrays are untouched; unused vertices can be compacted)."""
import heapq
import numpy as np

def _plane_quadrics(P, T):
    a, b, c = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    n = np.cross(b - a, c - a); area = np.linalg.norm(n, axis=1); nn = n / np.maximum(area, 1e-12)[:, None]
    d = -np.einsum('ij,ij->i', nn, a)
    p = np.c_[nn, d]                                  # plane (a,b,c,d)
    K = np.einsum('ij,ik->ijk', p, p) * area[:, None, None]
    Q = np.zeros((len(P), 4, 4))
    for k in range(3): np.add.at(Q, T[:, k], K)
    return Q

def simplify(pos, idx, target_tris, protect=None, weld_tol=1e-6, max_flip_cos=0.2):
    P = np.asarray(pos, np.float64); T = np.asarray(idx, np.int64).reshape(-1, 3).copy()
    n = len(P)
    # seams: different vertices at the same position
    key = np.round(P / weld_tol).astype(np.int64)
    _, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    locked = cnt[inv.ravel()] > 1
    # open boundary edges
    e = np.sort(np.r_[T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]], axis=1)
    ue, ec = np.unique(e, axis=0, return_counts=True)
    for a, b in ue[ec == 1]: locked[a] = locked[b] = True
    if protect is not None: locked |= np.asarray(protect, bool)
    Q = _plane_quadrics(P, T)
    alive = np.ones(len(T), bool)
    vfaces = [set() for _ in range(n)]
    for f, (a, b, c) in enumerate(T):
        vfaces[a].add(f); vfaces[b].add(f); vfaces[c].add(f)
    rep = np.arange(n)
    def cost(u, v):
        x = np.r_[P[v], 1.0]; return float(x @ (Q[u] + Q[v]) @ x)
    def neighbours(u):
        s = set()
        for f in vfaces[u]: s.update(T[f].tolist())
        s.discard(u); return s
    heap = []; ver = np.zeros(n, np.int64)
    def push(u):
        if locked[u] or rep[u] != u: return
        best = None
        for v in neighbours(u):
            c = cost(u, v)
            if best is None or c < best[0]: best = (c, v)
        if best: heapq.heappush(heap, (best[0], int(ver[u]), u, best[1]))
    for u in range(n): push(u)
    tris = int(alive.sum())
    while tris > target_tris and heap:
        c, vv, u, v = heapq.heappop(heap)
        if rep[u] != u or vv != ver[u] or rep[v] != v: continue
        if v not in neighbours(u): ver[u] += 1; push(u); continue
        # validity: faces of u that survive must not flip / degenerate
        ok = True; dying = []
        for f in vfaces[u]:
            t = T[f]
            if v in t: dying.append(f); continue
            a, b, cc = P[t[0]], P[t[1]], P[t[2]]
            n0 = np.cross(b - a, cc - a)
            t2 = np.where(t == u, v, t); a2, b2, c2 = P[t2[0]], P[t2[1]], P[t2[2]]
            n1 = np.cross(b2 - a2, c2 - a2)
            l0, l1 = np.linalg.norm(n0), np.linalg.norm(n1)
            if l1 < 1e-14 or l0 < 1e-14 or np.dot(n0, n1) / (l0 * l1) < max_flip_cos: ok = False; break
        if not ok:
            ver[u] += 1      # rejected: u is retried when one of its neighbours changes
            continue
        for f in dying:
            alive[f] = False; tris -= 1
            for w in T[f]: vfaces[w].discard(f)
        for f in list(vfaces[u]):
            T[f] = np.where(T[f] == u, v, T[f]); vfaces[v].add(f)
        vfaces[u].clear(); rep[u] = v; Q[v] += Q[u]
        ver[v] += 1; push(v)
        for w in neighbours(v): ver[w] += 1; push(w)
    return T[alive].ravel()
