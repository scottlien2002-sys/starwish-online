"""NPC 美術設計總覽：八位正面＋名字＋職務＋設計重點；每位一張四視角／臉部／動作圖。

  python3 npc_sheet.py <blender_npc 輸出資料夾>
輸出：npc_overview.png、npc_turn_<id>.png
"""
import json
import sys
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

D = Path(sys.argv[1])
rep = json.load(open(D / "npc_report.json"))
ROLE = {"swordmaster": "劍士軍團・轉職與劍術指導", "knight": "騎士軍團・轉職與守護技能", "smith": "鐵匠鋪・裝備強化與修理", "mage": "法師軍團・轉職與魔法指導",
        "priest": "祭司教堂・轉職與治癒祝福", "clown": "小丑馬戲團・轉職與表演技能", "warehouse": "倉庫・物品存取", "guild": "星願商會・道具店與玩家交易所"}


def font(sz):
    for p in ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
              "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf"):
        if Path(p).exists():
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


F1, F2, F3 = font(30), font(20), font(17)
ids = list(rep["npcs"])
cw, ch = 400, 500 + 170
sheet = Image.new("RGB", (cw * 4 + 40, ch * 2 + 110), (246, 244, 238))
dr = ImageDraw.Draw(sheet)
dr.text((24, 22), "星芽村 正式NPC 美術設計總覽（Stage 6.6）— 每位獨立五官＋眨眼＋職業小動作", fill=(40, 44, 70), font=font(38))
for i, nid in enumerate(ids):
    r = rep["npcs"][nid]
    x, y = 20 + (i % 4) * cw, 90 + (i // 4) * ch
    im = Image.open(D / f"npc_{nid}_front.png").convert("RGB")
    im = im.resize((cw - 20, int(im.height * (cw - 20) / im.width)))
    im = im.crop((0, max(0, im.height - 500), cw - 20, im.height)) if im.height >= 500 else im
    bg = Image.new("RGB", (cw - 20, 500), im.getpixel((4, 4)))
    bg.paste(im, (0, 500 - im.height))
    sheet.paste(bg, (x, y))
    dr.text((x + 6, y + 504), r["name"], fill=(30, 34, 60), font=F1)
    dr.text((x + 6, y + 544), ROLE.get(nid, ""), fill=(90, 70, 40), font=F2)
    for k, line in enumerate(textwrap.wrap(r["design"], 22)[:4]):
        dr.text((x + 6, y + 574 + k * 22), line, fill=(70, 70, 80), font=F3)
sheet.save(D / "npc_overview.png")

for nid in ids:
    r = rep["npcs"][nid]
    views = [Image.open(D / f"npc_{nid}_{v}.png").convert("RGB") for v in ("front", "left45", "side", "back")]
    head = Image.open(D / f"npc_{nid}_head.png").convert("RGB").resize((400, 400))
    poses = [Image.open(D / f"npc_{nid}_{v}.png").convert("RGB") for v in ("talk", "turn")]
    w = sum(v.width for v in views) + 420
    out = Image.new("RGB", (w, 880), (246, 244, 238))
    d2 = ImageDraw.Draw(out)
    d2.text((20, 16), f"{r['name']}　{ROLE.get(nid, '')}", fill=(30, 34, 60), font=F1)
    x = 0
    for v, lab in zip(views, ("正面", "45°", "側面", "背面")):
        out.paste(v, (x, 64))
        d2.text((x + 12, 70), lab, fill=(90, 90, 100), font=F2)
        x += v.width
    out.paste(head, (x + 10, 64))
    d2.text((x + 22, 70), "臉部", fill=(90, 90, 100), font=F2)
    for k, (p, lab) in enumerate(zip(poses, ("對話 Talk", "轉身 Turn"))):
        p = p.resize((200, 250))
        out.paste(p, (x + 10 + k * 205, 480))
        d2.text((x + 16 + k * 205, 484), lab, fill=(90, 90, 100), font=F3)
    hq, li = r["lods"]["hq"], r["lods"]["lite"]
    fa = r["lods"].get("far")
    d2.text((x + 10, 740), f"HQ {hq['triangles']} 面／{hq['meshes']} 網格", fill=(60, 60, 70), font=F3)
    d2.text((x + 10, 764), f"Lite {li['triangles']} 面／{li['meshes']} 網格", fill=(60, 60, 70), font=F3)
    if fa:
        d2.text((x + 10, 812), f"遠距 {fa['triangles']} 面", fill=(60, 60, 70), font=F3)
    d2.text((x + 10, 788), "動作：" + "、".join(a["name"] for a in hq["actions"]), fill=(60, 60, 70), font=F3)
    out.save(D / f"npc_turn_{nid}.png")
print("sheet ok", len(ids))
