// 星廢垃圾場：小物件距離密度漸變（草叢、小花、地面碎屑）前後對照 — CI 軟體繪圖，不是 iPhone 實機。
// before = &jyfade=0（6.9 原版：分區內全部畫出）；after = 預設。三段畫質 × 各區停靠點：三角面、Draw Calls、分組三角面、截圖。
// 另做跳變檢查：每 0.3 公尺前進一步，記錄「草叢小花＋實例化垃圾」三角面每步變化。
// 用法：node tests/e2e/run-junkyard-fade-compare.mjs dist [chromium] [輸出資料夾]
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";

const distDir = process.argv[2] ?? "dist";
const browserName = process.argv[3] ?? "chromium";
const outDir = process.argv[4] ?? new URL("../../test-results/junkyard-fade/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const pw = await loadPlaywright();
const server = await serve(distDir);
const browser = await pw[browserName].launch();
const report = { startedAt: new Date().toISOString(), note: "CI 軟體繪圖：三角面／Draw Calls 為確定值，FPS 不代表 iPhone 實機", runs: [], checks: [] };
let failures = 0;
const check = (name, ok, detail) => {
  report.checks.push({ name, ok: !!ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "✔" : "✘"} ${name}`, JSON.stringify(detail)?.slice(0, 400));
};
const settle = (page, n = 3) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const SMALL = (bd) => (bd["草叢小花"]?.tris ?? 0) + (bd["實例化垃圾"]?.tris ?? 0);

for (const q of ["high", "medium", "low"]) {
  for (const v of [{ id: "before", extra: "&jyfade=0" }, { id: "after", extra: "" }]) {
    const run = { quality: q, variant: v.id, stops: [], errors: [] };
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true });
    await ctx.addInitScript(() => { window.__swNoNav = true; });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
    const V = (fn, arg) => page.evaluate(fn, arg);
    try {
      await page.goto(server.url + `/?map=junkyard&quality=${q}&char=simple${v.extra}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__starwishJunkyard?.ready?.() === true, null, { timeout: 180000 });
      await page.waitForTimeout(1500);
      const L = await V(() => window.__starwishJunkyard.layout());
      for (const s of L.tourStops) {
        await V((p) => window.__starwishJunkyard.teleport(p.x, p.z, p.yaw), s);
        await page.waitForTimeout(1200);
        await settle(page, 6);
        const pf = await V(() => window.__starwishJunkyard.perf());
        const bd = await V(() => window.__starwishJunkyard.breakdown());
        const st = await V(() => window.__starwishJunkyard.stats());
        run.stops.push({ id: s.id, draws: pf.draws, tris: pf.tris, smallTris: SMALL(bd), groups: bd, fade: st.fade });
        await page.screenshot({ path: `${outDir}${q}_${v.id}_${s.id}.png` }).catch(() => null);
      }
      // 跳變檢查：從第一個停靠點往北走 36 公尺
      const s0 = L.tourStops[0];
      const steps = [];
      for (let k = 0; k <= 120; k++) {
        await V((p) => window.__starwishJunkyard.teleport(p.x, p.z, 0), { x: s0.x, z: s0.z + k * 0.3 });
        await page.waitForTimeout(60);
        const bd = await V(() => window.__starwishJunkyard.breakdown());
        steps.push(SMALL(bd));
      }
      let maxJump = 0;
      for (let k = 1; k < steps.length; k++) maxJump = Math.max(maxJump, Math.abs(steps[k] - steps[k - 1]));
      const avg = steps.reduce((a, b) => a + b, 0) / steps.length;
      run.pop = { maxStepJumpTris: maxJump, avgSmallTris: Math.round(avg), rel: +(maxJump / Math.max(1, avg)).toFixed(3) };
      const pf = await V(() => window.__starwishJunkyard.perf());
      run.contextLost = pf.contextLost;
    } catch (e) {
      run.error = String(e?.stack ?? e);
    }
    check(`${q} ${v.id}：無錯誤`, !run.error && run.errors.length === 0 && run.contextLost === 0, run.error ?? run.errors.slice(0, 3));
    report.runs.push(run);
    await ctx.close();
  }
}

const summary = {};
for (const q of ["high", "medium", "low"]) {
  const b = report.runs.find((r) => r.quality === q && r.variant === "before");
  const a = report.runs.find((r) => r.quality === q && r.variant === "after");
  if (!b?.stops.length || !a?.stops.length) continue;
  const mean = (r, f) => Math.round(r.stops.reduce((s, x) => s + f(x), 0) / r.stops.length);
  const max = (r, f) => Math.max(...r.stops.map(f));
  summary[q] = {
    trisMean: [mean(b, (x) => x.tris), mean(a, (x) => x.tris)],
    trisMax: [max(b, (x) => x.tris), max(a, (x) => x.tris)],
    smallTrisMean: [mean(b, (x) => x.smallTris), mean(a, (x) => x.smallTris)],
    drawsMean: [mean(b, (x) => x.draws), mean(a, (x) => x.draws)],
    drawsMax: [max(b, (x) => x.draws), max(a, (x) => x.draws)],
    pop: [b.pop, a.pop],
    perStop: a.stops.map((x, i) => [x.id, b.stops[i]?.tris, x.tris, b.stops[i]?.draws, x.draws]),
  };
  check(`${q}：小物件三角面平均下降`, summary[q].smallTrisMean[1] < summary[q].smallTrisMean[0], summary[q].smallTrisMean);
  check(`${q}：Draw Calls 不增加`, summary[q].drawsMax[1] <= summary[q].drawsMax[0], summary[q].drawsMax);
}
report.summary = summary;
report.finishedAt = new Date().toISOString();
writeFileSync(`${outDir}report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
server.close();
process.exit(failures ? 1 : 0);
