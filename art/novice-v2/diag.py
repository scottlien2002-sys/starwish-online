"""輪廓差異圖：綠 = 重疊、紅 = 設定圖有但灰模沒有（缺）、藍 = 灰模多出來；並分頭部／身體統計"""
import sys
import numpy as np
from PIL import Image
import preview as PV
import headlab as HL
import novice_shapes as NS

g, sheet, out = sys.argv[1:4]
PV.SIL_DIR = "/tmp/nv2/sil"
px, size, z0 = 0.0021, (440, 640), -0.02
meshes = PV.build(NS.build(g))
H = size[1]
zrow = lambda z: int(round(H - 8 - (z - z0) / px))
tiles = []
for v in ("front", "side", "back"):
    ms = PV.model_silhouette(meshes, v, px, size, z0)
    rng = range(-12, 13) if v == "side" else range(-8, 9)
    sh = max(rng, key=lambda k: PV.iou(ms, PV.sheet_silhouette(g, v, px, size, z0, k)))
    ss = PV.sheet_silhouette(g, v, px, size, z0, sh)
    print(g, v, "shift", sh)
    img = np.full((H, size[0], 3), 255, np.uint8)
    img[ms & ss] = (150, 210, 150)
    img[ss & ~ms] = (230, 60, 60)
    img[ms & ~ss] = (60, 90, 230)
    r = zrow(0.64)
    for name, sl in (("head", slice(0, r)), ("body", slice(r, H))):
        a, b = ms[sl], ss[sl]
        print(f"{g} {v:5s} {name}: iou {(a & b).sum() / max((a | b).sum(), 1):.3f}  missing {(b & ~a).sum():6d}  excess {(a & ~b).sum():6d}")
    tiles.append(Image.fromarray(img))
c = Image.new("RGB", (size[0] * 3, H), "white")
for i, t in enumerate(tiles):
    c.paste(t, (i * size[0], 0))
c.save(out)
