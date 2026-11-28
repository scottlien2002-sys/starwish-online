"""最小的 glTF（GLB，未壓縮）讀取＋數學工具。glTF 座標：+Y 上。四元數 [x, y, z, w]。"""
import json, struct
import numpy as np


def load(path):
    b = open(path, "rb").read()
    cl = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + cl])
    binb = b[20 + cl + 8:]
    return j, binb


def acc(j, binb, i):
    a = j["accessors"][i]
    bv = j["bufferViews"][a["bufferView"]]
    ct = {5126: np.float32, 5123: np.uint16, 5121: np.uint8, 5125: np.uint32, 5122: np.int16, 5120: np.int8}[a["componentType"]]
    nc = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    item = np.dtype(ct).itemsize * nc
    stride = bv.get("byteStride", 0)
    if stride and stride != item:
        out = np.empty((a["count"], nc), dtype=ct)
        for k in range(a["count"]):
            out[k] = np.frombuffer(binb, dtype=ct, count=nc, offset=off + k * stride)
        arr = out
    else:
        arr = np.frombuffer(binb, dtype=ct, count=a["count"] * nc, offset=off).reshape(a["count"], nc)
    arr = arr.astype(np.float64) if ct == np.float32 else arr
    if a.get("normalized"):
        mx = {np.uint8: 255.0, np.uint16: 65535.0, np.int8: 127.0, np.int16: 32767.0}[ct]
        arr = arr.astype(np.float64) / mx
    return arr if nc > 1 else arr.ravel()


# ---------- 四元數 ----------
def qmul(a, b):
    x1, y1, z1, w1 = a
    x2, y2, z2, w2 = b
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])


def qinv(q):
    return np.array([-q[0], -q[1], -q[2], q[3]]) / np.dot(q, q)


def qnorm(q):
    q = np.asarray(q, dtype=np.float64)
    return q / np.linalg.norm(q)


def qaxis(axis, ang):
    axis = np.asarray(axis, dtype=np.float64)
    axis = axis / np.linalg.norm(axis)
    s = np.sin(ang / 2)
    return np.array([axis[0] * s, axis[1] * s, axis[2] * s, np.cos(ang / 2)])


def qrot(q, v):
    return q2m(q) @ v


def q2m(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def m2q(m):
    t = m[0, 0] + m[1, 1] + m[2, 2]
    if t > 0:
        s = np.sqrt(t + 1.0) * 2
        q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]
    return qnorm(q)


def qbetween(a, b):
    """把方向 a 轉到 b 的最小旋轉"""
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    c = np.cross(a, b)
    d = np.dot(a, b)
    if d < -0.999999:
        axis = np.cross([1, 0, 0], a)
        if np.linalg.norm(axis) < 1e-6:
            axis = np.cross([0, 1, 0], a)
        return qaxis(axis, np.pi)
    return qnorm([c[0], c[1], c[2], 1 + d])


def slerp(a, b, t):
    a = qnorm(a)
    b = qnorm(b)
    d = np.dot(a, b)
    if d < 0:
        b = -b
        d = -d
    if d > 0.9995:
        return qnorm(a + t * (b - a))
    th = np.arccos(d)
    return (np.sin((1 - t) * th) * a + np.sin(t * th) * b) / np.sin(th)


def qpow(q, k):
    """旋轉角度乘以 k（同一軸）"""
    q = qnorm(q)
    if q[3] < 0:
        q = -q
    ang = 2 * np.arccos(np.clip(q[3], -1, 1))
    s = np.sqrt(max(1 - q[3] * q[3], 0))
    if s < 1e-8:
        return np.array([0, 0, 0, 1.0])
    return qaxis(q[:3] / s, ang * k)


def trs(t=(0, 0, 0), r=(0, 0, 0, 1), s=(1, 1, 1)):
    M = np.eye(4)
    M[:3, :3] = q2m(r) * np.asarray(s)
    M[:3, 3] = t
    return M


def node_local(n):
    if "matrix" in n:
        return np.array(n["matrix"]).reshape(4, 4).T
    return trs(n.get("translation", (0, 0, 0)), n.get("rotation", (0, 0, 0, 1)), n.get("scale", (1, 1, 1)))


class Skel:
    """glTF 節點階層（名稱、父節點、靜止 TRS、世界矩陣）"""

    def __init__(self, j, override_root=None):
        self.nodes = j["nodes"]
        self.parent = {}
        for i, n in enumerate(self.nodes):
            for c in n.get("children", []):
                self.parent[c] = i
        self.idx = {n.get("name"): i for i, n in enumerate(self.nodes)}
        self.T = [np.array(n.get("translation", (0, 0, 0)), dtype=np.float64) for n in self.nodes]
        self.R = [qnorm(n.get("rotation", (0, 0, 0, 1))) for n in self.nodes]
        self.S = [np.array(n.get("scale", (1, 1, 1)), dtype=np.float64) for n in self.nodes]
        if override_root:
            for name, (t, r, s) in override_root.items():
                i = self.idx[name]
                if t is not None:
                    self.T[i] = np.array(t, dtype=np.float64)
                if r is not None:
                    self.R[i] = qnorm(r)
                if s is not None:
                    self.S[i] = np.array(s, dtype=np.float64)
        self.order = []
        seen = set()

        def visit(i):
            if i in seen:
                return
            if i in self.parent:
                visit(self.parent[i])
            seen.add(i)
            self.order.append(i)

        for i in range(len(self.nodes)):
            visit(i)

    def world(self, R=None, T=None):
        """回傳每個節點的世界矩陣（可傳入覆寫的區域旋轉／位移）"""
        R = R or self.R
        T = T or self.T
        W = [None] * len(self.nodes)
        for i in self.order:
            L = trs(T[i], R[i], self.S[i])
            W[i] = L if i not in self.parent else W[self.parent[i]] @ L
        return W
