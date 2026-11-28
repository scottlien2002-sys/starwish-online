// GitHub Pages 全預覽唯讀驗證（容量整理後）：不建置、不部署、不改 gh-pages。
// 1. HTTP：每個保留預覽的首頁、程式；每個 asset-remap.json 指向的檔案（跨資料夾依賴、/shared-assets/）都要 200。
// 2. /shared-assets/index.json：每個共用檔案存在；抽查內容雜湊與檔名一致。
// 3. 瀏覽器（Chromium）：依各部門報告的入口網址開啟，記錄 4xx／5xx 與 JS 錯誤、場景是否開始繪製。
// 用法：node tests/e2e/verify-pages-all.mjs <site base url>
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright } from "./static-server.mjs";

const base = (process.argv[2] ?? "https://scottlien2002-sys.github.io/starwish-online/").replace(/\/?$/, "/");
const shots = process.env.SHOTS_DIR ?? "/tmp/shots";
mkdirSync(shots, { recursive: true });
const PREVIEWS = [
  { dir: "preview-stage74-perf", owner: "A", entry: "?play=world&newgame=1", wait: "world" },
  { dir: "preview-stage73-world", owner: "A", entry: "?play=world&newgame=1", wait: "world" },
  { dir: "preview-village-npc67", owner: "B", entry: "?map=village&art=full&quality=high" },
  { dir: "preview-village-art66", owner: "B", entry: "?map=village&art=full&quality=high" },
  { dir: "preview-map-junkyard", owner: "B", entry: "?map=junkyard&quality=high" },
  { dir: "preview-combat-vfx-s3", owner: "C", entry: "?lab=combat" },
  { dir: "preview-combat-vfx-s2", owner: "C", entry: "?lab=combat" },
  { dir: "preview-combat-vfx", owner: "C", entry: "?lab=combat" },
  { dir: "preview-mp82", owner: "D", entry: null },
  { dir: "preview-mp81", owner: "D", entry: null },
  { dir: "preview-stage72-world", owner: "A", entry: null, remnant: true },
  { dir: "preview-stage71-world", owner: "A", entry: null, remnant: true },
];
const report = { base, at: new Date().toISOString(), http: [], shared: null, browser: [] };
let fails = 0;
const get = async (u, head = true) => {
  const r = await fetch(u, { method: head ? "HEAD" : "GET", cache: "no-store" }).catch((e) => ({ ok: false, status: String(e) }));
  return r.ok || !head ? r : fetch(u, { cache: "no-store" }).catch((e) => ({ ok: false, status: String(e) }));
};

for (const p of PREVIEWS) {
  const row = { dir: p.dir, owner: p.owner, checked: 0, bad: [] };
  const root = `${base}${p.dir}/`;
  const urls = [];
  if (!p.remnant) {
    const html = await (await fetch(`${root}?t=${Date.now()}`, { cache: "no-store" })).text();
    for (const m of html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)) urls.push(new URL(m[1], root).href);
    if (!urls.length) row.bad.push("首頁沒有找到程式檔");
  }
  const rm = await fetch(`${root}asset-remap.json?t=${Date.now()}`, { cache: "no-store" });
  row.remap = 0;
  if (rm.ok) {
    const files = (await rm.json()).files ?? {};
    row.remap = Object.keys(files).length;
    for (const v of Object.values(files)) urls.push(new URL(v, root).href);
  }
  for (const u of [...new Set(urls)]) {
    const r = await get(u);
    row.checked++;
    if (!r.ok) row.bad.push(`${r.status} ${u.slice(base.length)}`);
  }
  if (row.bad.length) fails++;
  report.http.push(row);
  console.log(`${row.bad.length ? "✗" : "✓"} [${p.owner}] ${p.dir}：${row.checked} 個檔案 HTTP 200${row.remap ? `（共用／跨資料夾 ${row.remap}）` : ""}${row.bad.length ? `｜失敗 ${row.bad.length}：${row.bad.slice(0, 3).join("；")}` : ""}`);
}

// /shared-assets/
{
  const r = await fetch(`${base}shared-assets/index.json?t=${Date.now()}`, { cache: "no-store" });
  const s = { ok: r.ok, files: 0, missing: [], hashChecked: 0, hashBad: [] };
  if (r.ok) {
    const idx = await r.json();
    const names = Object.keys(idx.files);
    s.files = names.length;
    s.totalMB = Math.round((idx.totalBytes / 1048576) * 10) / 10;
    s.previews = idx.previews;
    s.orphans = Object.keys(idx.orphans ?? {}).length;
    for (const [i, n] of names.entries()) {
      const u = `${base}${idx.files[n].path}`;
      if (i % 10 === 0) {
        const b = Buffer.from(await (await fetch(u, { cache: "no-store" })).arrayBuffer());
        s.hashChecked++;
        if (createHash("sha1").update(b).digest("hex") !== n.slice(0, 40)) s.hashBad.push(n);
      } else if (!(await get(u)).ok) s.missing.push(n);
    }
  }
  if (!s.ok || s.missing.length || s.hashBad.length) fails++;
  report.shared = s;
  console.log(`${!s.ok || s.missing.length || s.hashBad.length ? "✗" : "✓"} /shared-assets/：${s.files} 個檔案、${s.totalMB} MB；缺少 ${s.missing.length}；抽查雜湊 ${s.hashChecked} 個、不符 ${s.hashBad.length}；未被引用 ${s.orphans}；使用中 ${JSON.stringify(s.previews)}`);
}

// 瀏覽器
const pw = await loadPlaywright();
const browser = await pw.chromium.launch();
for (const p of PREVIEWS.filter((x) => x.entry)) {
  const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  const bad = [];
  const errs = [];
  page.on("response", (r) => r.status() >= 400 && bad.push(`${r.status()} ${r.url().slice(base.length)}`));
  page.on("pageerror", (e) => errs.push(e.message));
  const row = { dir: p.dir, owner: p.owner, url: `${p.dir}/${p.entry}` };
  try {
    await page.goto(`${base}${p.dir}/${p.entry}`, { waitUntil: "load", timeout: 120000 });
    if (p.wait === "world") await page.waitForFunction(() => window.__starwishWorld?.ready === true, null, { timeout: 240000 });
    else await page.waitForTimeout(45000);
    row.frames = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => (++n, performance.now() - t0 < 3000 ? requestAnimationFrame(f) : res(n)); requestAnimationFrame(f); }));
    row.remapInstalled = await page.evaluate(() => window.__starwishAssetRemap ?? null);
    await page.screenshot({ path: `${shots}/${p.dir}.png` });
  } catch (e) {
    row.error = e.message.split("\n")[0];
  }
  row.failedRequests = bad;
  row.errors = errs;
  row.ok = !row.error && !bad.length && !errs.length;
  if (!row.ok) fails++;
  report.browser.push(row);
  console.log(`${row.ok ? "✓" : "✗"} [${p.owner}] ${row.url}：失敗請求 ${bad.length}、JS 錯誤 ${errs.length}${row.remapInstalled ? `、共用資產 ${row.remapInstalled}` : ""}${row.error ? `｜${row.error}` : ""}${bad.length ? `｜${bad.slice(0, 3).join("；")}` : ""}${errs.length ? `｜${errs[0]}` : ""}`);
  await ctx.close();
}
await browser.close();
writeFileSync(`${shots}/report.json`, JSON.stringify(report, null, 1));
console.log(fails ? `✗ 全預覽驗證：${fails} 項失敗` : "✓ 全預覽驗證通過");
process.exit(fails ? 1 : 0);
