"""頭部快速迭代：只建頭＋頭髮（女生含馬尾、蝴蝶結），四視角與設定圖頭部並排"""
import sys
import numpy as np
from PIL import Image, ImageDraw
import preview as PV
import novice_shapes as NS
import measure as M


def head_parts(g):
    ps = [NS.head_part(g)]
    if g == "male":
        ps.append(NS.male_hair())
    else:
        H = NS.female_hair()
        ps.append(H.part)
        ps += list(NS.female_ponytail_and_bow(H))
    return ps


def body_parts(g):
    ps = [NS.body_part(g)] + NS.hand_parts(g) + NS.glove_parts(g) + NS.boot_parts(g)
    ps += NS.male_clothes() if g == "male" else NS.female_clothes()
    return ps


def main(g, sheet, out, mode="head"):
    if mode in ("head", "head_hi"):
        px, size, z0 = (0.00105, (720, 760), 0.6) if mode == "head_hi" else (0.0014, (560, 520), 0.58)
        meshes = PV.build(head_parts(g))
    else:
        px, size, z0 = 0.0014, (560, 520), -0.02
        meshes = PV.build(body_parts(g))
    row = []
    for v in ("front", "side", "back", "left45"):
        sh, _ = PV.render(meshes, v, px, size, z0)
        im = Image.fromarray((sh * 255).astype(np.uint8)).convert("RGB")
        if v != "left45":
            shift = 7 if (v == "side" and g == "male") else 0
            row.append(PV.sheet_crop(sheet, g, v, px, size, z0, shift))
        row.append(im)
    W, H = size
    canvas = Image.new("RGB", (W * len(row), H), (255, 255, 255))
    for i, im in enumerate(row):
        canvas.paste(im, (i * W, 0))
    canvas.save(out)


if __name__ == "__main__":
    main(*sys.argv[1:5])
