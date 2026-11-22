// 只截 P3-2 原始 vs 優化畫面（檢查用，不部署）
import { mkdirSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";
const out = "shots/";
mkdirSync(out, { recursive: true });
const pw = await loadPlaywright();
const server = await serve("dist");
const b = await pw.webkit.launch();
const ctx = await b.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true });
for (const [tag, q] of [["orig", ""], ["p3", "&p3=1"]]) {
  const page = await ctx.newPage();
  await page.goto(server.url + "/?lab=c10b&quality=high&p1=1&p2=1&star=1" + q, { waitUntil: "load" });
  await page.waitForFunction(() => window.__starwishC10b?.ready === true, null, { timeout: 120000 });
  await page.evaluate(() => document.querySelectorAll(".v3-top,.lab-panel,.perf-panel,.lab-bench-result").forEach((e) => (e.style.visibility = "hidden")));
  for (const v of ["front", "left45", "back", "low", "emblem", "head"]) {
    await page.evaluate((x) => window.__starwishC10b.view(x), v);
    await page.evaluate(() => new Promise((r) => { let i = 0; const f = () => (++i >= 3 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
    await page.screenshot({ path: `${out}${tag}_${v}.png` });
  }
  await page.close();
}
await b.close();
await server.close();
