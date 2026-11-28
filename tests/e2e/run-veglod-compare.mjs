// 星芽原野植被距離分級（Claude B）優化前後對照 — CI 軟體繪製，不是 iPhone 實機。
// 同一份建置、同一台 CI 機器，依序比較：
//   before = &veglod=0（Stage 7.4 原本的植被：區塊整塊切換＋草花格子硬切）
//   after  = 預設（新的逐棵三級 LOD＋鏡頭後方剔除＋草花密度漸變）
// 1. 獨立地圖頁 ?map=starsprout：高（HQ）／中（Lite）／低（Lite）× 固定站位，讀 Draw Calls、場景三角面、植被三角面、截圖
// 2. 連續走動 30 公尺（每 0.25 公尺取樣）：植被三角面平均與每步最大變化（跳變檢查）
// 3. 正式遊戲 ?play=world 高畫質：自動打怪 bench（含怪物、角色、特效的實際場景）
// 用法：node tests/e2e/run-veglod-compare.mjs <dist> [chromium] [benchSeconds]
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";

const dist = process.argv[2] ?? "dist";
const browserName = process.argv[3] ?? "chromium";
const benchS = Number(process.argv[4] ?? 40);
const outDir = new URL("../../test-results/veglod-compare/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const pw = await loadPlaywright();
const server = await serve(dist);
const browser = await pw[browserName].launch({ args: browserName === "chromium" ? ["--ignore-gpu-blocklist"] : [] });
const report = { startedAt: new Date().toISOString(), browser: browserName, note: "CI 軟體繪製（無實體 GPU），不是 iPhone 實機；三角面／Draw Calls 是確定值，FPS 只看相對變化", map: [], routes: [], world: [], pop: [], checks: [] };
let failures = 0;
const check = (name, ok, detail) => {
  report.checks.push({ name, ok: !!ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "✔" : "✘"} ${name}`, typeof detail === "string" ? detail : JSON.stringify(detail));
};

// 固定站位：角色位置、面向（0=北）、鏡頭方位、俯角、距離
const POSES = [
  { id: "camp", x: -56, z: -60, yaw: 40, cam: 220, beta: 1.18, radius: 7 },
  { id: "meadow01", x: -24, z: -46, yaw: 0, cam: 180, beta: 1.2, radius: 7 },
  { id: "forest02", x: -54, z: -26, yaw: 290, cam: 110, beta: 1.22, radius: 7 },
  { id: "hill03", x: 10, z: -18, yaw: 20, cam: 200, beta: 1.15, radius: 8 },
  { id: "field05", x: -38, z: 40, yaw: 300, cam: 120, beta: 1.2, radius: 7 },
  { id: "arena", x: 0, z: 52, yaw: 0, cam: 180, beta: 1.12, radius: 9 },
  { id: "overlook", x: 40, z: 16, yaw: 230, cam: 50, beta: 1.05, radius: 11 },
];
const TIERS = [
  { id: "high", q: "high", lod: "hq" },
  { id: "medium", q: "medium", lod: "lite" },
  { id: "low", q: "low", lod: "lite" },
];
const VARIANTS = [
  { id: "before", extra: "&veglod=0" },
  { id: "after", extra: "" },
];

async function openMap(t, v) {
  const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  await page.goto(`${server.url}/?map=starsprout&quality=${t.q}&lod=${t.lod}${v.extra}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__starwishMap?.ready === true, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  return { ctx, page, errors };
}

async function settlePose(page, p) {
  const o = { x: p.x, z: p.z, playerYawDeg: p.yaw, camBearingDeg: p.cam, beta: p.beta, radius: p.radius };
  // 先不凍結讓植被依新鏡頭方向與距離更新（草花密度漸變需要約 1 秒），再凍結量測
  await page.evaluate((o) => window.__starwishMap.pose({ ...o, freeze: false }), o);
  await page.waitForTimeout(1600);
  await page.evaluate((o) => window.__starwishMap.pose({ ...o, freeze: true }), o);
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const i = window.__starwishMap.info();
    return { drawCalls: i.drawCalls, activeMeshes: i.activeMeshes, trianglesActive: Math.round(i.trianglesActive), veg: i.veg?.lod ?? null, vegLegacy: i.veg ? { hiChunks: i.veg.hiChunks, grassCells: i.veg.grassCells, flowerCells: i.veg.flowerCells, shadowChunks: i.veg.shadowChunks } : null, meshes: i.meshes, materials: i.materials };
  });
}

// ---------- 1＋2＋4：獨立地圖頁 ----------
for (const t of TIERS) {
  for (const v of VARIANTS) {
    const label = `${t.id}_${v.id}`;
    const run = { tier: t.id, variant: v.id, poses: [], ok: false };
    try {
      const { ctx, page, errors } = await openMap(t, v);
      run.load = await page.evaluate(() => {
        const i = window.__starwishMap.info();
        return { loadMs: Math.round(i.loadMs), vegBuildMs: i.veg?.buildMs ?? null };
      });
      for (const p of POSES) {
        const s = await settlePose(page, p);
        await page.screenshot({ path: `${outDir}${label}_${p.id}.png` });
        run.poses.push({ id: p.id, ...s });
      }
      // 跳變檢查（只在高、低畫質做）：從 camp 往東北慢慢前進 30 公尺
      {
        await page.evaluate(() => window.__starwishMap.unfreeze());
        await page.evaluate(() => window.__starwishMap.pose({ x: -56, z: -60, playerYawDeg: 45, camBearingDeg: 225, beta: 1.2, radius: 7, freeze: false }));
        await page.waitForTimeout(1500);
        const steps = await page.evaluate(async () => {
          const api = window.__starwishMap;
          const out = [];
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          for (let k = 0; k <= 120; k++) {
            const d = k * 0.25;
            api.pose({ x: -56 + d * 0.7071, z: -60 + d * 0.7071, playerYawDeg: 45, camBearingDeg: 225, beta: 1.2, radius: 7, freeze: false });
            await wait(110);
            const i = api.info();
            out.push({ d, vegTris: i.veg?.lod?.drawnTris ?? 0, tri: Math.round(i.trianglesActive), draw: i.drawCalls });
          }
          return out;
        });
        let maxJump = 0;
        let maxJumpAt = 0;
        for (let k = 1; k < steps.length; k++) {
          const j = Math.abs(steps[k].vegTris - steps[k - 1].vegTris);
          if (j > maxJump) {
            maxJump = j;
            maxJumpAt = steps[k].d;
          }
        }
        const avg = steps.reduce((a, s) => a + s.vegTris, 0) / steps.length;
        report.pop.push({ tier: t.id, variant: v.id, maxStepJumpTris: maxJump, maxJumpAtMeters: maxJumpAt, avgVegTris: Math.round(avg), relMaxJump: +(maxJump / Math.max(1, avg)).toFixed(3), steps });
      }
      run.errors = errors;
      run.ok = errors.length === 0;
      await ctx.close();
    } catch (e) {
      run.error = String(e?.stack ?? e);
    }
    check(`地圖頁 ${label} 無錯誤`, run.ok, run.error ?? run.errors);
    report.map.push(run);
    console.log(label, JSON.stringify(run.poses.map((p) => [p.id, p.drawCalls, p.trianglesActive, p.veg?.drawnTris])));
    writeFileSync(outDir + "report.json", JSON.stringify(report, null, 2));
  }
}

// ---------- 3：正式遊戲高畫質 bench ----------
async function openField(extra) {
  const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  await page.goto(`${server.url}/?play=world&newgame=1&g=male&seed=11&quality=high`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__starwishWorld?.ready === true, null, { timeout: 180000 });
  await page.goto(`${server.url}/__veglod_blank__.json`, { waitUntil: "load" }).catch(() => {});
  await page.evaluate(() => {
    const k = "starwish.stage7.save.v1";
    const s = JSON.parse(localStorage.getItem(k));
    s.character.map = "starsprout";
    s.character.x = null;
    s.character.z = null;
    localStorage.setItem(k, JSON.stringify(s));
  });
  errors.length = 0;
  await page.goto(`${server.url}/?play=world&seed=11&quality=high${extra}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__starwishPlay?.ready === true && !!window.__starwishPlay.world, null, { timeout: 180000 });
  await page.waitForFunction(() => window.__starwishPlay.info().monsters.length >= 20, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(4000);
  return { ctx, page, errors };
}
for (const v of VARIANTS) {
  const run = { variant: v.id, ok: false };
  try {
    const { ctx, page, errors } = await openField(v.extra);
    run.atStart = await page.evaluate(() => {
      const r = window.__starwishPlay.info().render;
      return { drawCalls: r.drawCalls, triangles: r.triangles, veg: r.veg?.lod ?? null };
    });
    await page.evaluate(() => window.__starwishPlay.perf?.reset());
    // bench 中途取樣三角面（bench 本身沒有三角面欄位）
    const samples = [];
    const p = page.evaluate((s) => window.__starwishPlay.bench(s), benchS);
    for (let t = 0; t < benchS - 2; t += 2) {
      await page.waitForTimeout(2000);
      samples.push(await page.evaluate(() => {
        const r = window.__starwishPlay.info().render;
        return { draw: r.drawCalls, tri: r.triangles, vegTris: r.veg?.lod?.drawnTris ?? null };
      }));
    }
    run.bench = await p;
    run.session = await page.evaluate(() => window.__starwishPlay.perf?.session() ?? null);
    const avg = (k) => Math.round(samples.reduce((a, s) => a + (s[k] ?? 0), 0) / Math.max(1, samples.length));
    run.sampled = { n: samples.length, avgTriangles: avg("tri"), maxTriangles: Math.max(...samples.map((s) => s.tri)), avgVegTris: avg("vegTris"), avgDraw: avg("draw") };
    await page.screenshot({ path: `${outDir}world_${v.id}.png` }).catch(() => {});
    run.errors = errors;
    run.ok = errors.length === 0 && run.bench.contextLost === 0;
    await ctx.close();
  } catch (e) {
    run.error = String(e?.stack ?? e);
  }
  check(`正式遊戲 ${v.id} bench 無錯誤`, run.ok, run.error ?? run.errors);
  report.world.push(run);
  console.log("world", v.id, JSON.stringify(run.bench), JSON.stringify(run.sampled));
  writeFileSync(outDir + "report.json", JSON.stringify(report, null, 2));
}

// ---------- 摘要 ----------
const summary = { map: {}, routes: {}, world: null, pop: {} };
for (const t of TIERS) {
  const b = report.map.find((r) => r.tier === t.id && r.variant === "before");
  const a = report.map.find((r) => r.tier === t.id && r.variant === "after");
  if (b?.poses.length && a?.poses.length) {
    const mean = (r, f) => Math.round(r.poses.reduce((s, p) => s + f(p), 0) / r.poses.length);
    const max = (r, f) => Math.max(...r.poses.map(f));
    summary.map[t.id] = {
      vegTrisMean: { before: mean(b, (p) => p.veg?.drawnTris ?? 0), after: mean(a, (p) => p.veg?.drawnTris ?? 0) },
      vegTrisMax: { before: max(b, (p) => p.veg?.drawnTris ?? 0), after: max(a, (p) => p.veg?.drawnTris ?? 0) },
      sceneTrisMean: { before: mean(b, (p) => p.trianglesActive), after: mean(a, (p) => p.trianglesActive) },
      sceneTrisMax: { before: max(b, (p) => p.trianglesActive), after: max(a, (p) => p.trianglesActive) },
      drawMean: { before: mean(b, (p) => p.drawCalls), after: mean(a, (p) => p.drawCalls) },
      drawMax: { before: max(b, (p) => p.drawCalls), after: max(a, (p) => p.drawCalls) },
      vegMeshesMean: { before: mean(b, (p) => p.veg?.drawnMeshes ?? 0), after: mean(a, (p) => p.veg?.drawnMeshes ?? 0) },
      castersMean: { before: mean(b, (p) => p.veg?.casters ?? 0), after: mean(a, (p) => p.veg?.casters ?? 0) },
      vegBuildMs: { before: b.load?.vegBuildMs, after: a.load?.vegBuildMs },
    };
  }
  const rb = report.routes.find((r) => r.tier === t.id && r.variant === "before");
  const ra = report.routes.find((r) => r.tier === t.id && r.variant === "after");
  if (rb?.avgTris && ra?.avgTris) summary.routes[t.id] = { avgTris: [rb.avgTris, ra.avgTris], avgDraw: [rb.avgDraw, ra.avgDraw], maxDraw: [rb.maxDraw, ra.maxDraw], avgFps: [rb.avgFps, ra.avgFps], low1Fps: [rb.low1Fps, ra.low1Fps], stutters: [rb.stutters, ra.stutters] };
  for (const v of VARIANTS) {
    const p = report.pop.find((r) => r.tier === t.id && r.variant === v.id);
    if (p) (summary.pop[t.id] ??= {})[v.id] = { maxStepJumpTris: p.maxStepJumpTris, relMaxJump: p.relMaxJump, at: p.maxJumpAtMeters };
  }
}
const wb = report.world.find((r) => r.variant === "before");
const wa = report.world.find((r) => r.variant === "after");
if (wb?.bench && wa?.bench) summary.world = { avgFps: [wb.bench.avgFps, wa.bench.avgFps], low1Fps: [wb.bench.low1Fps, wa.bench.low1Fps], avgDraw: [wb.bench.avgDraw, wa.bench.avgDraw], avgTriangles: [wb.sampled.avgTriangles, wa.sampled.avgTriangles], maxTriangles: [wb.sampled.maxTriangles, wa.sampled.maxTriangles], avgVegTris: [wb.sampled.avgVegTris, wa.sampled.avgVegTris] };
report.summary = summary;

// 驗收門檻（只檢查確定值；FPS 不設門檻）
for (const [tier, s] of Object.entries(summary.map)) {
  check(`${tier} 植被三角面平均下降`, s.vegTrisMean.after < s.vegTrisMean.before, s.vegTrisMean);
  check(`${tier} Draw Calls 不增加（平均 +2 以內）`, s.drawMean.after <= s.drawMean.before + 2, s.drawMean);
}
if (summary.world) check("正式遊戲平均三角面下降", summary.world.avgTriangles[1] < summary.world.avgTriangles[0], summary.world.avgTriangles);

report.finishedAt = new Date().toISOString();
writeFileSync(outDir + "report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
await server.close();
process.exit(failures ? 1 : 0);
