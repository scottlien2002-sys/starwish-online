// Stage 6.3 部署驗證：直接打公開 GitHub Pages 網址（不是本機 dist）
import { chromium, webkit } from "playwright";
const BASE = process.argv[2];
const out = { base: BASE, http: {}, pages: [] };
// Stage 6.4：首頁、全部 NPC／洛恩（HQ／Lite／遠距）、建築與環境、共用貼圖
const NPCS = ["swordmaster", "knight", "smith", "mage", "priest", "clown", "warehouse", "guild"];
const BLD = ["env", "plaza", "fountain", "platform", "knight", "mage", "sword", "smith", "warehouse", "board", "church", "circus", "guild", "portals"];
const files = ["", "index.html", "preview.json", "models/village-p3/pm2_avatar.png",
  // Stage 6.5：Claude A 正式初心者 C1.0-B5b
  ...["male", "female"].flatMap((g) => ["hq", "lite"].map((l) => `models/novice_c10b5b_${g}_${l}.glb`)),
  ...NPCS.flatMap((n) => ["hq", "lite", "far"].map((q) => `models/village-p3/npc_${n}_${q}.glb`)),
  ...["hq", "lite", "far"].map((q) => `models/village-p3/pet_merchant_v2_${q}.glb`),
  ...BLD.flatMap((b) => ["hq", "lite"].map((q) => `models/village-p3/${b}_${q}.glb`))];
let bad = 0;
for (const f of files) {
  const r = await fetch(BASE + f);
  const buf = await r.arrayBuffer();
  out.http[f || "/"] = { status: r.status, bytes: buf.byteLength, type: r.headers.get("content-type") };
  if (r.status !== 200) bad++;
}
const html = await (await fetch(BASE)).text();
out.assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
// 共用貼圖：從 HQ 頁面實際請求的清單檢查（下方瀏覽器測試收集）
for (const a of out.assets.filter((x) => x.includes("assets/"))) {
  const r = await fetch(new URL(a, BASE));
  out.http[a] = { status: r.status };
  if (r.status !== 200) bad++;
}
for (const [bname, bt] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await bt.launch();
  for (const [mode, q] of [["高畫質", "quality=high"], ["中畫質", "quality=medium"], ["低畫質", "quality=low"]]) {
    const url = `${BASE}?map=village&art=full&${q}`;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    const errs = [];
    const failed = [];
    page.on("pageerror", (e) => errs.push(e.message));
    const tex = new Set();
    page.on("response", (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
      if (/\/tex\/.+\.(png|jpg)/.test(r.url()) && r.status() === 200) tex.add(r.url().split("/").pop());
    });
    const res = { browser: bname, mode, url };
    try {
      const resp = await page.goto(url, { waitUntil: "load", timeout: 120000 });
      res.status = resp?.status();
      await page.waitForFunction(() => window.__starwishVillage?.ready === true, null, { timeout: 120000 });
      await page.waitForFunction(() => { const a = window.__starwishVillage.artFull(); return a.status === "loaded" || a.status.startsWith("部分") || a.status.startsWith("error"); }, null, { timeout: 480000 });
      const art = await page.evaluate(() => window.__starwishVillage.artFull());
      const ps = await page.evaluate(() => window.__starwishVillage.perfState());
      const ti = await page.evaluate(() => window.__starwishVillage.tier());
      await page.waitForFunction(() => { const c = window.__starwishVillage.charState(); return c.status === "loaded" || String(c.status).startsWith("error"); }, null, { timeout: 240000 });
      const cs = await page.evaluate(() => window.__starwishVillage.charState());
      res.character = { status: cs.status, model: cs.stats?.model, triangles: cs.stats?.triangles, pet: cs.stats?.pet?.label, simpleVisible: cs.simpleVisible };
      const rs = await page.evaluate(() => window.__starwishVillage.renderState());
      res.tier = ti;
      res.render = { shadow: rs.shadow, map: rs.shadowMapSize, resMax: rs.res.requestedMax, msaa: rs.msaa, hdr: rs.hdr, post: rs.post };
      res.textures200 = tex.size;
      res.art = { status: art.status, loadMs: art.loadMs, groups: Object.keys(art.parts).length, errors: art.errors, npcs: art.npcs };
      res.perf = { shadow: ps.shadow, maxRes: ps.cfg.maxRes, merchant: ps.merchant && [ps.merchant.triangles, ps.merchant.farTriangles], npc: Object.values(ps.npcStats).map((n) => [n.triangles, n.farTriangles]) };
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `out/${bname}_${mode}.png` });
      res.ok = res.status === 200 && art.status === "loaded" && res.art.groups === 16 && art.npcs.length === 8 && !!ps.merchant && failed.length === 0 && errs.length === 0 && ti.tier === new URLSearchParams(q).get("quality") && cs.status === "loaded" && cs.stats?.model === `novice_c10b5b_male_${new URLSearchParams(q).get("quality") === "high" ? "hq" : "lite"}.glb` && !cs.simpleVisible;
    } catch (e) {
      res.error = String(e.message ?? e);
      res.ok = false;
    }
    res.pageErrors = errs;
    res.failedRequests = failed;
    if (!res.ok) bad++;
    out.pages.push(res);
    await ctx.close();
  }
  await browser.close();
}
console.log(JSON.stringify(out, null, 1));
if (bad) process.exit(1);
