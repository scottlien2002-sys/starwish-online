// Stage 6.3 部署驗證：直接打公開 GitHub Pages 網址（不是本機 dist）
import { chromium, webkit } from "playwright";
const BASE = process.argv[2];
const out = { base: BASE, http: {}, pages: [] };
const files = ["", "index.html", "preview.json", "models/village-p3/npc_mage_hq.glb", "models/village-p3/npc_mage_lite.glb", "models/village-p3/npc_mage_far.glb",
  "models/village-p3/pet_merchant_v2_hq.glb", "models/village-p3/pet_merchant_v2_far.glb", "models/village-p3/npc_mage_hq_s62.glb", "models/village-p3/guild_hq.glb", "models/village-p3/fountain_hq.glb"];
let bad = 0;
for (const f of files) {
  const r = await fetch(BASE + f);
  const buf = await r.arrayBuffer();
  out.http[f || "/"] = { status: r.status, bytes: buf.byteLength, type: r.headers.get("content-type") };
  if (r.status !== 200) bad++;
}
const html = await (await fetch(BASE)).text();
out.assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
for (const a of out.assets.filter((x) => x.includes("assets/"))) {
  const r = await fetch(new URL(a, BASE));
  out.http[a] = { status: r.status };
  if (r.status !== 200) bad++;
}
for (const [bname, bt] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await bt.launch();
  for (const [mode, q] of [["HQ", "quality=high&lod=hq"], ["Lite", "quality=low&lod=lite"]]) {
    const url = `${BASE}?map=village&art=full&${q}`;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    const errs = [];
    const failed = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
    const res = { browser: bname, mode, url };
    try {
      const resp = await page.goto(url, { waitUntil: "load", timeout: 120000 });
      res.status = resp?.status();
      await page.waitForFunction(() => window.__starwishVillage?.ready === true, null, { timeout: 120000 });
      await page.waitForFunction(() => { const a = window.__starwishVillage.artFull(); return a.status === "loaded" || a.status.startsWith("部分") || a.status.startsWith("error"); }, null, { timeout: 480000 });
      const art = await page.evaluate(() => window.__starwishVillage.artFull());
      const ps = await page.evaluate(() => window.__starwishVillage.perfState());
      res.art = { status: art.status, loadMs: art.loadMs, groups: Object.keys(art.parts).length, errors: art.errors, npcs: art.npcs };
      res.perf = { shadow: ps.shadow, maxRes: ps.cfg.maxRes, merchant: ps.merchant && [ps.merchant.triangles, ps.merchant.farTriangles], npc: Object.values(ps.npcStats).map((n) => [n.triangles, n.farTriangles]) };
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `out/${bname}_${mode}.png` });
      res.ok = res.status === 200 && art.status === "loaded" && res.art.groups === 16 && art.npcs.length === 8 && !!ps.merchant && failed.length === 0 && errs.length === 0;
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
