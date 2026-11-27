// Stage 6.8＋6.9 星廢垃圾場（?map=junkyard）端對端測試：三段畫質、正式角色、可達性、傳送陣、分區載入、各區截圖、俯視地圖、效能數字。
// 用法：node tests/e2e/run-junkyard-e2e.mjs dist [chromium,webkit] [輸出資料夾]
// 注意：CI 是無頭瀏覽器＋軟體繪圖，FPS 不代表 iPhone 實機（三角面、Draw Calls 才有參考價值）。
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";

const distDir = process.argv[2] ?? "dist";
const browsers = (process.argv[3] ?? "chromium,webkit").split(",");
const outDir = process.argv[4] ?? new URL("../../test-results/junkyard-e2e/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

const pw = await loadPlaywright();
const server = await serve(distDir);
const report = { startedAt: new Date().toISOString(), note: "CI 軟體繪圖：FPS 不代表 iPhone 實機", runs: [] };
let failures = 0;
const settle = (page, n = 3) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

const MODES = [
  ["high-portrait", "high", { width: 390, height: 844 }],
  ["medium-portrait", "medium", { width: 390, height: 844 }],
  ["low-portrait", "low", { width: 390, height: 844 }],
  ["high-landscape", "high", { width: 844, height: 390 }],
];
// 每區「場景」三角面（不含玩家角色）與 Draw Calls 上限（與星芽村相同的標準）
const BUDGET = {
  high: { scene: 250000, draws: 160, lod: "hq", shadows: true },
  medium: { scene: 100000, draws: 120, lod: "lite", shadows: true },
  low: { scene: 100000, draws: 100, lod: "lite", shadows: false },
};

for (const name of browsers) {
  let browser;
  try {
    browser = await pw[name].launch();
  } catch (e) {
    report.runs.push({ browser: name, ok: false, error: `無法啟動瀏覽器：${e.message}` });
    failures++;
    continue;
  }
  for (const [mode, q, vp] of MODES) {
    if (name === "webkit" && mode.includes("landscape")) continue;
    const B = BUDGET[q];
    const run = { browser: name, mode, checks: {}, errors: [], screenshots: [], results: {} };
    report.runs.push(run);
    const check = (k, ok, detail) => {
      run.checks[k] = { ok: !!ok, detail };
      if (!ok) failures++;
    };
    const shot = async (page, label) => {
      const f = `${outDir}/${name}_${mode}_${label}.png`;
      await settle(page, 4);
      await page.screenshot({ path: f, timeout: 120000 }).catch(() => null);
      run.screenshots.push(f.split("/").pop());
    };
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true });
    await ctx.addInitScript(() => { window.__swNoNav = true; });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
    const reqCount = new Map();
    const badResp = [];
    page.on("request", (r) => { const u = r.url(); if (/\.(glb|png|jpg|ktx2)(\?|$)/.test(u)) reqCount.set(u, (reqCount.get(u) ?? 0) + 1); });
    page.on("response", (r) => { if (r.status() >= 400) badResp.push(`${r.status()} ${r.url()}`); });
    const V = (fn, arg) => page.evaluate(fn, arg);
    try {
      const gender = q === "medium" ? "female" : "male";
      const t0 = Date.now();
      await page.goto(server.url + `/?map=junkyard&quality=${q}&g=${gender}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__starwishJunkyard?.ready?.() === true, null, { timeout: 180000 });
      await page.waitForFunction(() => { const s = window.__starwishJunkyard.state().char; return s === "loaded" || s.startsWith("error"); }, null, { timeout: 300000 });
      run.results.loadSec = (Date.now() - t0) / 1000;
      const tier = await V(() => window.__starwishJunkyard.tier());
      const st0 = await V(() => window.__starwishJunkyard.state());
      run.results.tier = tier;
      check(`畫質 ${q}：模型 ${B.lod.toUpperCase()}、即時陰影 ${B.shadows ? "開" : "關（腳底陰影）"}`, tier.tier === q && tier.lite === (B.lod === "lite") && tier.shadows === B.shadows, tier);
      check(`正式初心者角色載入（${gender === "female" ? "女" : "男"}、${B.lod.toUpperCase()}）`, st0.char === "loaded" && typeof st0.model === "string" && st0.model.includes(`${gender}_${B.lod}`), st0);
      check("抵達點（入口傳送陣北側 10 m）可走", st0.walkable && Math.abs(st0.z - -124) < 0.5, st0);
      check("沒有跳躍按鈕（一般移動不跳躍）", await V(() => window.__starwishJunkyard.noJumpButton()), null);
      const sim = await V(() => window.__starwishJunkyard.simulateRoute());
      run.results.routeSim = sim;
      check("主路線 32 點全部可達（一般移動、不跳躍、不卡住）", sim.stuckAt === null && sim.reached.length === 32 && sim.maxSlopeDeg <= 35.5, { reached: sim.reached.length, stuckAt: sim.stuckAt, maxSlope: sim.maxSlopeDeg, time: sim.time });
      const area = await V(() => window.__starwishJunkyard.walkableArea());
      run.results.walkableArea = area;
      const s0 = await V(() => window.__starwishJunkyard.stats());
      run.results.stats0 = s0;
      check("地形 36 塊、入口分區已載入、有實例化垃圾與植被", s0.terrainChunks === 36 && s0.loadedCells.includes("entry") && s0.instances > 100 && s0.instanceMeshes > 3, { chunks: s0.terrainChunks, cells: s0.loadedCells, inst: s0.instances, im: s0.instanceMeshes });
      await shot(page, "00_arrival");

      // ---- 各區停靠點：截圖＋三角面＋Draw Calls ----
      const L = await V(() => window.__starwishJunkyard.layout());
      run.results.stops = [];
      for (const s of L.tourStops) {
        await V((p) => window.__starwishJunkyard.teleport(p.x, p.z, p.yaw), s);
        await page.waitForTimeout(1200);
        await settle(page, 6);
        const pf = await V(() => window.__starwishJunkyard.perf());
        const bd = await V(() => window.__starwishJunkyard.breakdown());
        const charTris = (bd["玩家角色"]?.tris ?? 0) + (bd["角色與其他"]?.tris ?? 0);
        const scene = pf.tris - charTris;
        run.results.stops.push({ id: s.id, label: s.label, draws: pf.draws, tris: pf.tris, sceneTris: scene, breakdown: bd, cells: (await V(() => window.__starwishJunkyard.stats())).loadedCells });
        await shot(page, `stop_${s.id}`);
      }
      const maxDraw = Math.max(...run.results.stops.map((x) => x.draws));
      const maxScene = Math.max(...run.results.stops.map((x) => x.sceneTris));
      check(`各區 Draw Calls ≤ ${B.draws}（最高 ${maxDraw}）`, maxDraw <= B.draws, run.results.stops.map((x) => [x.id, x.draws]));
      check(`各區場景三角面（不含玩家角色）≤ ${B.scene.toLocaleString()}（最高 ${maxScene.toLocaleString()}）`, maxScene <= B.scene, run.results.stops.map((x) => [x.id, x.sceneTris, x.tris]));

      // ---- 分區載入／釋放 ----
      const log = await V(() => window.__starwishJunkyard.streamLog());
      run.results.streamLog = log.length;
      check("分區載入與釋放：走遠的區域會釋放（有 unload 紀錄），Boss 區時入口區已釋放", log.some((e) => e.op === "unload") && !run.results.stops.at(-1).cells.includes("entry"), { ops: log.length, unloads: log.filter((e) => e.op === "unload").map((e) => e.cell), lastCells: run.results.stops.at(-1).cells });

      // ---- 出生區標示（廢棄山丘）----
      await V(() => window.__starwishJunkyard.setSpawns(true));
      await V(() => window.__starwishJunkyard.teleport(58, -112, 0.3));
      await page.waitForTimeout(800);
      await shot(page, "spawns_hills");
      await V(() => window.__starwishJunkyard.teleport(-40, -48, -0.9));
      await page.waitForTimeout(800);
      await shot(page, "spawns_recycle");
      await V(() => window.__starwishJunkyard.setSpawns(false));

      // ---- 入口傳送陣：走入觸發一次 ----
      await V(() => window.__starwishJunkyard.teleport(0, -124, Math.PI));
      await settle(page, 3);
      await V(() => window.__starwishJunkyard.teleport(0, -133.5, Math.PI));
      await settle(page, 4);
      const p1 = await V(() => window.__starwishJunkyard.portal());
      await V(() => window.__starwishJunkyard.teleport(0, -124, Math.PI));
      await settle(page, 3);
      await V(() => window.__starwishJunkyard.teleport(0, -133.5, Math.PI));
      await settle(page, 4);
      const p2 = await V(() => window.__starwishJunkyard.portal());
      check("入口傳送陣：走入觸發傳送回星芽原野（沒有按鈕），只觸發一次", p1.fired && p1.log.length === 1 && p1.log[0].map === "starsprout" && p2.log.length === 1, { p1, p2: p2.log.length });

      // ---- 實際步行（固定前 25 秒，檢查有前進、不卡住）----
      await V(() => window.__starwishJunkyard.startSampler("walk"));
      await page.waitForTimeout(25000);
      const sm = await V(() => window.__starwishJunkyard.sampling());
      const stw = await V(() => window.__starwishJunkyard.state());
      run.results.walk = { sm, pos: stw };
      check("巡迴（實際步行）會沿路線前進", sm && sm.idx >= 2 && Math.hypot(stw.x, stw.z + 124) > 3, { sm, pos: [stw.x, stw.z] });

      // ---- 俯視地圖（只在 Chromium 高畫質直向拍；大視窗另拍）----
      if (name === "chromium" && mode === "high-portrait") {
        await page.setViewportSize({ width: 1000, height: 1000 });
        await V(() => window.__starwishJunkyard.setTopView(true));
        await page.waitForTimeout(1500);
        await shot(page, "topdown");
        await V(() => window.__starwishJunkyard.setSpawns(true));
        await page.waitForTimeout(500);
        await shot(page, "topdown_spawns");
        await V(() => window.__starwishJunkyard.setSpawns(false));
        await V(() => window.__starwishJunkyard.setTopView(false));
        await page.setViewportSize(vp);
      }

      const pf = await V(() => window.__starwishJunkyard.perf());
      run.results.final = { perf: pf, report: await V(() => window.__starwishJunkyard.report()) };
      check("沒有 WebGL Context Lost", pf.contextLost === 0, pf);
      const dup = [...reqCount.entries()].filter(([, n]) => n > 1);
      check("同一個模型／貼圖沒有重複下載、沒有 4xx/5xx", dup.length === 0 && badResp.length === 0, { dup, badResp });
      check("沒有 JS 錯誤", run.errors.length === 0, run.errors.slice(0, 5));
    } catch (e) {
      check(`測試流程沒有例外（${e.message.split("\n")[0]}）`, false, e.stack?.split("\n").slice(0, 4));
      await shot(page, "error").catch(() => null);
    }
    await ctx.close();
  }
  await browser.close();
}

server.close();
report.finishedAt = new Date().toISOString();
report.failures = failures;
writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
console.log(`junkyard e2e: ${failures} failures`);
for (const r of report.runs) {
  const ch = Object.entries(r.checks ?? {});
  console.log(`${r.browser} ${r.mode}: ${ch.filter(([, v]) => v.ok).length}/${ch.length}`);
  for (const [k, v] of ch) if (!v.ok) console.log(`  ✗ ${k} ${JSON.stringify(v.detail)?.slice(0, 300)}`);
}
process.exit(failures ? 1 : 0);
