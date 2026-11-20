import numpy as np, sys
import preview as PV, headlab as HL
from PIL import Image
g, sheet, out = sys.argv[1:4]
z0 = float(sys.argv[4]) if len(sys.argv) > 4 else 0.2
views = sys.argv[5].split(",") if len(sys.argv) > 5 else ["front", "left45"]
meshes = PV.build(HL.body_parts(g))
px, size = 0.0008, (700, 560)
row = []
for v in views:
    if v in ("front", "side", "back"):
        row.append(PV.sheet_crop(sheet, g, v, px, size, z0, 7 if (g == "male" and v == "side") else 0))
    sh, _ = PV.render(meshes, v, px, size, z0)
    row.append(Image.fromarray((sh * 255).astype(np.uint8)).convert("RGB"))
c = Image.new("RGB", (700 * len(row), 560))
for i, im in enumerate(row):
    c.paste(im, (i * 700, 0))
c.save(out)
