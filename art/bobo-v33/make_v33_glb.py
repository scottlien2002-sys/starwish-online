"""
星露啵啵 V3.3：只修改腹部星星。

幾何（身體、眼睛、嘴、腮紅、翅膀、觸角、頭頂星星）與 V3.1／V3.2 完全相同；
腹部星星由果凍著色器在身體內部繪製，所以 V3.3 的星星定義寫進模型檔的 extras，
遊戲頁面載入 bobo_v33_*.glb 後從模型讀取星星參數（不是只換版本標籤）。

V3.2 星星：外徑 0.084、內徑 0.042、中心 (0, 0.248, 0.545)、法線 (0, -0.22, 0.975)
V3.3 星星：在 V3.2 尺寸上再縮小 15%（外徑 0.0714、內徑 0.0357），
          中心下移 0.008（0.24），與嘴巴下緣留出間距；水平置中不變。

用法：python3 art/bobo-v33/make_v33_glb.py public/models
"""
import json
import struct
import sys
from pathlib import Path

V32 = dict(outer=0.084, inner=0.042, center=[0.0, 0.248, 0.545], normal=[0.0, -0.22, 0.975])
SCALE = 0.85
BELLY_STAR_V33 = dict(
    version="3.3",
    outer=round(V32["outer"] * SCALE, 4),
    inner=round(V32["inner"] * SCALE, 4),
    center=[0.0, 0.24, 0.545],
    normal=V32["normal"],
    coords="babylon-object-space",
    note="V3.2 尺寸 ×0.85；由果凍著色器繪製於身體內部",
)


def convert(src: Path, dst: Path, lod: str) -> None:
    b = src.read_bytes()
    magic, ver, _total = struct.unpack("<III", b[:12])
    assert magic == 0x46546C67 and ver == 2
    jlen, jtype = struct.unpack("<II", b[12:20])
    assert jtype == 0x4E4F534A
    j = json.loads(b[20 : 20 + jlen])
    rest = b[20 + jlen :]
    root_idx = j["scenes"][j.get("scene", 0)]["nodes"][0]
    root = j["nodes"][root_idx]
    assert root["name"] == f"StarDewBoboV31_{lod}", root["name"]
    root["name"] = f"StarDewBoboV33_{lod}"
    root["extras"] = {"bellyStar": BELLY_STAR_V33}
    j["asset"]["extras"] = {"model": "StarDewBobo", "version": "3.3", "base": f"bobo_v31_{lod}.glb"}
    js = json.dumps(j, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    out = struct.pack("<III", magic, ver, 12 + 8 + len(js) + len(rest)) + struct.pack("<II", len(js), jtype) + js + rest
    dst.write_bytes(out)
    print(dst.name, len(out), "bytes")


if __name__ == "__main__":
    d = Path(sys.argv[1] if len(sys.argv) > 1 else "public/models")
    for lod in ("high", "medium", "low"):
        convert(d / f"bobo_v31_{lod}.glb", d / f"bobo_v33_{lod}.glb", lod)
