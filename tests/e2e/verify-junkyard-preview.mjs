// 唯讀驗證：公開 GitHub Pages 的星廢垃圾場預覽（HTTP 200＋三段畫質遊戲載入）。不部署、不修改 gh-pages。
import { loadPlaywright } from "./static-server.mjs";
const BASE = "https://scottlien2002-sys.github.io/starwish-online/preview-map-junkyard/";
const out = { http: [], loads: [] };
let fail = 0;
for (const f of ["", "preview.json", ...["male", "female"].flatMap((g) => ["hq", "lite"].map((q) => `models/novice_c10b5b_${g}_${q}.glb`))]) {
  const r = await fetch(BASE + f, { method: "GET" });
  out.http.push({ f, status: r.status });
  if (r.status !== 200) fail++;
}
const html = await (await fetch(BASE)).text();
for (const m of html.matchAll(/(?:src|href)="(\.?\/?[^"]+\.(?:js|css))"/g)) {
  const u = new URL(m[1], BASE).href;
  const r = await fetch(u);
  out.http.push({ f: u.replace(BASE, ""), status: r.status });
  if (r.status !== 200) fail++;
}
const pw = await loadPlaywright();
for (const bn of ["chromium", "webkit"]) {
  const b = await pw[bn].launch();
  for (const q of ["high", "medium", "low"]) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errs = [];
    const bad = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("response", (r) => r.status() >= 400 && bad.push(`${r.status()} ${r.url()}`));
    const res = { browser: bn, q };
    try {
      await page.goto(`${BASE}?map=junkyard&quality=${q}`, { waitUntil: "load", timeout: 120000 });
      await page.waitForFunction(() => window.__starwishJunkyard?.ready?.() === true, null, { timeout: 180000 });
      await page.waitForFunction(() => { const s = window.__starwishJunkyard.state().char; return s === "loaded" || s.startsWith("error"); }, null, { timeout: 300000 });
      const st = await page.evaluate(() => ({ s: window.__starwishJunkyard.state(), t: window.__starwishJunkyard.tier(), k: window.__starwishJunkyard.stats() }));
      res.char = st.s.char;
      res.model = st.s.model;
      res.tier = st.t.tier;
      res.chunks = st.k.terrainChunks;
      res.cells = st.k.loadedCells;
      res.ok = st.s.char === "loaded" && st.t.tier === q && st.k.terrainChunks === 36 && st.s.walkable && errs.length === 0 && bad.length === 0;
    } catch (e) {
      res.ok = false;
      res.error = e.message.split("\n")[0];
    }
    res.errs = errs.slice(0, 3);
    res.bad = bad.slice(0, 3);
    if (!res.ok) fail++;
    out.loads.push(res);
    await ctx.close();
  }
  await b.close();
}
console.log(JSON.stringify(out, null, 1));
console.log(`verify failures: ${fail}`);
process.exit(fail ? 1 : 0);
