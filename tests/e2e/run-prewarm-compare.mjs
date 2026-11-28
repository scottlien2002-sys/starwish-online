// CombatFx 預熱開／關對照（CI 軟體繪製，不是 iPhone；只比較相對變化）
// 每組（同一份建置、n75 男性、中畫質 Lite 與高畫質 HQ）：
//   1. 載入時間：開頁 → 原野可以操作（__starwishPlay.ready）
//   2. 預熱時間：CombatFx.prewarm()（關閉時為 0）
//   3. 第一次施放卡頓：載入後第一次施放三連斬、魔法彈、流星，施放後 1.5 秒內最長一格（ms）與 > 50 ms 的格數
//   4. 實玩：自動打怪 N 秒的平均 FPS、1% Low
// 用法：node tests/e2e/run-prewarm-compare.mjs dist [chromium] [benchSeconds] [repeats]
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";

const dist = process.argv[2] ?? "dist";
const browserName = process.argv[3] ?? "chromium";
const benchS = Number(process.argv[4] ?? 30);
const repeats = Number(process.argv[5] ?? 2);
const outDir = new URL("../../test-results/prewarm-compare/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const pw = await loadPlaywright();
const srv = await serve(dist);
const browser = await pw[browserName].launch({ args: browserName === "chromium" ? ["--ignore-gpu-blocklist"] : [] });
const report = { startedAt: new Date().toISOString(), browser: browserName, benchSeconds: benchS, repeats, note: "CI 軟體繪製，不是 iPhone；只比較相對變化", runs: [] };
let failures = 0;

async function openField(extra) {
  const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(`${srv.url}/?play=world&newgame=1&g=male&seed=11&quality=high`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__starwishWorld?.ready === true, null, { timeout: 180000 });
  await page.goto(`${srv.url}/__perf_blank__.json`, { waitUntil: "load" }).catch(() => {});
  await page.evaluate(() => {
    const k = "starwish.stage7.save.v1";
    const s = JSON.parse(localStorage.getItem(k));
    s.character.map = "starsprout";
    s.character.x = null;
    s.character.z = null;
    localStorage.setItem(k, JSON.stringify(s));
  });
  errors.length = 0;
  const t0 = Date.now();
  await page.goto(`${srv.url}/?play=world&seed=11${extra}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__starwishPlay?.ready === true && !!window.__starwishPlay.world, null, { timeout: 180000 });
  const loadMs = Date.now() - t0;
  await page.waitForFunction(() => window.__starwishPlay.info().monsters.length >= 20, null, { timeout: 120000 }).catch(() => {});
  return { ctx, page, errors, loadMs };
}

/** 施放一個技能，量施放後 1.5 秒內的格時間（requestAnimationFrame） */
async function firstCast(page, id) {
  return page.evaluate(async (id) => {
    const api = window.__starwishPlay;
    api.heal();
    const i = api.info();
    const alive = i.monsters.filter((m) => m.state !== "death" && m.hp > 0).sort((a, b) => Math.hypot(a.x - i.pos[0], a.z - i.pos[2]) - Math.hypot(b.x - i.pos[0], b.z - i.pos[2]));
    if (alive[0]) api.teleport(alive[0].x, alive[0].z - 1.6, 0);
    await new Promise((r) => setTimeout(r, 600));
    const frames = [];
    let last = performance.now();
    let on = true;
    const tick = () => {
      const n = performance.now();
      frames.push(n - last);
      last = n;
      if (on) requestAnimationFrame(tick);
    };
    // 施放前 0.5 秒當基準
    requestAnimationFrame(tick);
    await new Promise((r) => setTimeout(r, 500));
    const base = frames.splice(0);
    const res = api.skill(id);
    await new Promise((r) => setTimeout(r, 1500));
    on = false;
    for (let k = 0; k < 120 && api.skillState().busy; k++) await new Promise((r) => setTimeout(r, 200));
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
    return { skill: id, ok: res.ok, frames: frames.length, maxMs: Math.round(Math.max(0, ...frames)), over50: frames.filter((f) => f > 50).length, baseMedianMs: Math.round(med(base)), medianMs: Math.round(med(frames)) };
  }, id);
}

const variants = [];
for (const lod of ["lite", "hq"]) for (const pre of [true, false]) variants.push({ label: `${lod}_prewarm_${pre ? "on" : "off"}`, extra: `&lod=${lod}${lod === "lite" ? "&quality=medium" : "&quality=high"}${pre ? "" : "&prewarm=0"}` });

for (let rep = 0; rep < repeats; rep++)
  for (const v of variants) {
    const run = { label: v.label, rep, url: v.extra, ok: false };
    try {
      const { ctx, page, errors, loadMs } = await openField(v.extra);
      run.loadMs = loadMs;
      const st = await page.evaluate(() => window.__starwishPlay.skillState());
      run.prewarmMs = st.prewarmMs;
      run.prewarm = st.combatFx?.prewarm ?? null;
      await page.mouse.click(426, 70).catch(() => {});
      run.firstCasts = [];
      for (const id of ["triple_slash", "staff_cast", "star_meteor"]) run.firstCasts.push(await firstCast(page, id));
      await page.evaluate(() => setInterval(() => window.__starwishPlay.heal?.(), 1500));
      await page.evaluate(() => window.__starwishPlay.perf?.reset());
      const b = await page.evaluate((s) => window.__starwishPlay.bench(s), benchS);
      run.bench = { avgFps: b.avgFps, low1Fps: b.low1Fps, minFps: b.minFps, avgDraw: b.avgDraw, kills: b.kills };
      run.combatFx = (await page.evaluate(() => window.__starwishPlay.skillState().combatFx)) ?? null;
      run.errors = errors;
      run.ok = errors.length === 0 && run.firstCasts.every((c) => c.ok);
      if (!run.ok) failures++;
      await ctx.close();
    } catch (e) {
      run.error = String(e?.stack ?? e);
      failures++;
    }
    report.runs.push(run);
    console.log(v.label, rep, JSON.stringify({ loadMs: run.loadMs, prewarmMs: run.prewarmMs, firstCasts: run.firstCasts?.map((c) => [c.skill, c.maxMs, c.over50]), bench: run.bench, error: run.error }));
  }

// 摘要：每組平均
const sum = {};
for (const r of report.runs) {
  if (!r.ok) continue;
  const s = (sum[r.label] ??= { n: 0, loadMs: 0, prewarmMs: 0, firstCastMaxMs: 0, firstCastOver50: 0, avgFps: 0, low1Fps: 0 });
  s.n++;
  s.loadMs += r.loadMs;
  s.prewarmMs += r.prewarmMs ?? 0;
  s.firstCastMaxMs += Math.max(...r.firstCasts.map((c) => c.maxMs));
  s.firstCastOver50 += r.firstCasts.reduce((a, c) => a + c.over50, 0);
  s.avgFps += r.bench.avgFps;
  s.low1Fps += r.bench.low1Fps;
}
for (const s of Object.values(sum)) for (const k of Object.keys(s)) if (k !== "n") s[k] = Math.round((s[k] / s.n) * 100) / 100;
report.summary = sum;
writeFileSync(`${outDir}report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(sum, null, 2));
await browser.close();
srv.close?.();
process.exit(failures ? 1 : 0);
