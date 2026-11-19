"""
把腹部星星定義寫進 V3.5 模型檔（根節點 extras.bellyStar）。

V3.5 沿用 V3.4（＝V3.3）的腹部星星：外徑 0.0714（不得放大）、內徑 0.0357、中心 (0, 0.24, 0.545)。
星星本身由果凍著色器在身體內部繪製，頁面從模型檔讀取這些參數。

用法：python3 art/bobo-v35/add_belly_star.py <放 bobo_v35_*.glb 的資料夾>
"""
import json
import struct
import sys
from pathlib import Path

BELLY_STAR = dict(
    version="3.5",
    outer=0.0714,
    inner=0.0357,
    center=[0.0, 0.24, 0.545],
    normal=[0.0, -0.22, 0.975],
    coords="babylon-object-space",
    note="與 V3.3 相同（鎖定）；由果凍著色器繪製於身體內部",
)


def patch(path: Path, lod: str) -> None:
    b = path.read_bytes()
    magic, ver, _ = struct.unpack("<III", b[:12])
    jlen, jtype = struct.unpack("<II", b[12:20])
    assert magic == 0x46546C67 and ver == 2 and jtype == 0x4E4F534A
    j = json.loads(b[20 : 20 + jlen])
    rest = b[20 + jlen :]
    root = j["nodes"][j["scenes"][j.get("scene", 0)]["nodes"][0]]
    assert root["name"] == f"StarDewBoboV35_{lod}", root["name"]
    root["extras"] = {"bellyStar": BELLY_STAR}
    j["asset"]["extras"] = {"model": "StarDewBobo", "version": "3.5"}
    js = json.dumps(j, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    out = struct.pack("<III", magic, ver, 20 + len(js) + len(rest)) + struct.pack("<II", len(js), jtype) + js + rest
    path.write_bytes(out)
    print(path.name, len(out), "bytes")


if __name__ == "__main__":
    d = Path(sys.argv[1])
    for lod in ("high", "medium", "low"):
        patch(d / f"bobo_v35_{lod}.glb", lod)
