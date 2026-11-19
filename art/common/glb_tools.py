"""
共用 GLB 工具（所有怪物可用；不依賴 Blender，只用 Python 標準函式庫）。

功能：
  1. write_extras：把資料寫進 GLB 根節點的 extras（遊戲端用 node.metadata.gltf.extras 讀取），
     例如星露啵啵的腹部星星定義、怪物版本號。不改動幾何與貼圖（二進位區塊原封不動）。
  2. inspect：讀出 GLB 結構（根節點名稱、網格、三角形數、材質、貼圖、檔案大小）。
  3. check_lods：依《怪物資源規範》檢查命名與三種畫質的三角形預算，有錯誤就回傳非 0。

命令列：
  python3 art/common/glb_tools.py check <資料夾> <assetId> <版本 例 v36> <預算等級 normal|elite|boss>
  python3 art/common/glb_tools.py inspect <檔案.glb>
  python3 art/common/glb_tools.py derive <來源.glb> <新檔.glb> <新根節點名稱> [extras JSON]
    → 只換版本、不改幾何時使用（例：V3.7 只改材質，模型沿用 V3.6）：
      幾何與貼圖二進位完全相同，只改根節點名稱與 extras

規範說明：docs/monsters/ASSET_PIPELINE.md
"""
import json
import struct
import sys
from pathlib import Path

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
LODS = ("high", "medium", "low")

# 每隻怪物（整隻、所有零件合計）的三角形預算：normal 一般怪、elite 菁英、boss 頭目
TRIANGLE_BUDGET = {
    "normal": {"high": 12000, "medium": 7000, "low": 4500},
    "elite": {"high": 20000, "medium": 12000, "low": 7000},
    "boss": {"high": 60000, "medium": 30000, "low": 15000},
}
# 單一檔案大小上限（位元組；含內嵌貼圖）
FILE_BUDGET = {"normal": 1_000_000, "elite": 2_000_000, "boss": 6_000_000}


def _read(path: Path):
    b = path.read_bytes()
    magic, ver, _ = struct.unpack("<III", b[:12])
    if magic != GLB_MAGIC or ver != 2:
        raise ValueError(f"{path.name}: 不是 glTF 2.0 二進位檔（GLB）")
    jlen, jtype = struct.unpack("<II", b[12:20])
    if jtype != CHUNK_JSON:
        raise ValueError(f"{path.name}: 第一個區塊不是 JSON")
    j = json.loads(b[20 : 20 + jlen])
    return b, j, b[20 + jlen :]


def _write(path: Path, b: bytes, j: dict, rest: bytes) -> None:
    js = json.dumps(j, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    magic, ver, _ = struct.unpack("<III", b[:12])
    out = struct.pack("<III", magic, ver, 20 + len(js) + len(rest)) + struct.pack("<II", len(js), CHUNK_JSON) + js + rest
    path.write_bytes(out)


def root_node(j: dict) -> dict:
    return j["nodes"][j["scenes"][j.get("scene", 0)]["nodes"][0]]


def write_extras(path: Path, expected_root: str, root_extras: dict, asset_extras: dict | None = None) -> int:
    """寫入根節點與 asset 的 extras；根節點名稱必須符合規範，避免寫錯檔案。回傳新檔案大小。"""
    b, j, rest = _read(path)
    root = root_node(j)
    if root.get("name") != expected_root:
        raise ValueError(f"{path.name}: 根節點是 {root.get('name')!r}，應為 {expected_root!r}")
    root["extras"] = {**root.get("extras", {}), **root_extras}
    if asset_extras:
        j["asset"]["extras"] = {**j["asset"].get("extras", {}), **asset_extras}
    _write(path, b, j, rest)
    return path.stat().st_size


def derive(src: Path, dst: Path, new_root: str, root_extras: dict | None = None, asset_extras: dict | None = None) -> int:
    """複製 GLB 成新版本：二進位區塊原封不動，只改根節點名稱與 extras。回傳新檔大小。"""
    b, j, rest = _read(src)
    root = root_node(j)
    root["name"] = new_root
    if root_extras:
        ex = dict(root.get("extras", {}))
        for k, v in root_extras.items():
            ex[k] = {**ex[k], **v} if isinstance(v, dict) and isinstance(ex.get(k), dict) else v
        root["extras"] = ex
    if asset_extras:
        j["asset"]["extras"] = {**j["asset"].get("extras", {}), **asset_extras}
    _write(dst, b, j, rest)
    return dst.stat().st_size


def inspect(path: Path) -> dict:
    b, j, _ = _read(path)
    meshes = []
    total = 0
    for m in j.get("meshes", []):
        tris = 0
        for p in m["primitives"]:
            if "indices" in p:
                tris += j["accessors"][p["indices"]]["count"] // 3
            else:
                tris += j["accessors"][p["attributes"]["POSITION"]]["count"] // 3
        meshes.append({"name": m.get("name"), "triangles": tris})
        total += tris
    return {
        "file": path.name,
        "bytes": len(b),
        "root": root_node(j).get("name"),
        "rootExtras": root_node(j).get("extras", {}),
        "meshes": meshes,
        "triangles": total,
        "materials": [m.get("name") for m in j.get("materials", [])],
        "images": len(j.get("images", [])),
    }


def lod_file(asset_id: str, version: str, lod: str) -> str:
    """命名規範：<assetId>_<版本>_<畫質>.glb，例 bobo_v36_high.glb"""
    return f"{asset_id}_{version}_{lod}.glb"


def check_lods(folder: Path, asset_id: str, version: str, tier: str = "normal") -> list[str]:
    errors = []
    budget = TRIANGLE_BUDGET[tier]
    prev = None
    for lod in LODS:
        f = folder / lod_file(asset_id, version, lod)
        if not f.exists():
            errors.append(f"缺少 {f.name}")
            continue
        info = inspect(f)
        print(json.dumps({k: info[k] for k in ("file", "bytes", "root", "triangles")}, ensure_ascii=False))
        if not info["root"] or not info["root"].endswith(f"_{lod}"):
            errors.append(f"{f.name}: 根節點 {info['root']!r} 應以 _{lod} 結尾")
        if info["triangles"] > budget[lod]:
            errors.append(f"{f.name}: 三角形 {info['triangles']} 超過 {tier} 預算 {budget[lod]}")
        if info["bytes"] > FILE_BUDGET[tier]:
            errors.append(f"{f.name}: 檔案 {info['bytes']} 位元組超過 {tier} 上限 {FILE_BUDGET[tier]}")
        if prev is not None and info["triangles"] > prev:
            errors.append(f"{f.name}: 三角形比上一級畫質多（{info['triangles']} > {prev}）")
        prev = info["triangles"]
    return errors


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "inspect":
        print(json.dumps(inspect(Path(sys.argv[2])), ensure_ascii=False, indent=1))
    elif cmd == "derive":
        extra = json.loads(sys.argv[5]) if len(sys.argv) > 5 else {}
        n = derive(Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4], extra.get("root"), extra.get("asset"))
        print(sys.argv[3], n, "bytes")
    elif cmd == "check":
        errs = check_lods(Path(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5] if len(sys.argv) > 5 else "normal")
        for e in errs:
            print("錯誤：", e)
        print("通過" if not errs else f"{len(errs)} 項錯誤")
        sys.exit(1 if errs else 0)
    else:
        print(__doc__)
        sys.exit(2)
