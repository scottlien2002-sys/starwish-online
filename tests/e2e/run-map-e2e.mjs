// Stage 6 星芽原野（?map=starsprout）端對端測試：載入、地形繪製、移動與碰撞、橋、溪流、傳送門、路線測試流程、HQ／Lite。
// 用法：node tests/e2e/run-map-e2e.mjs dist [chromium,webkit]
// 注意：CI 是無頭瀏覽器＋軟體繪圖，FPS 不代表 iPhone；完整 60 秒路線由單元測試以相同移動規則模擬。
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";

const distDir = process.argv[2] ?? "dist";
const browsers = (process.argv[3] ?? "chromium,webkit").split(",");
const outDir = new URL("../../test-results/map-e2e/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

const pw = await loadPlaywright();
const server = await serve(distDir);
const report = { startedAt: new Date().toISOString(), runs: [] };
let failures = 0;
const settle = (page, n = 3) =>
  page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

for (const name of browsers) {
  let browser;
  try {
    browser = await pw[name].launch();
  } catch (e) {
    report.runs.push({ browser: name, ok: false, error: `無法啟動瀏覽器：${e.message}` });
    failures++;
    continue;
  }
  for (const lod of ["hq", "lite"]) {
    const run = { browser: name, lod, checks: {}, errors: [], screenshots: [], results: {} };
    const check = (k, ok, detail) => (run.checks[k] = { ok, detail });
    const shot = async (page, label) => {
      const f = `${outDir}${name}_${lod}_${label}.png`;
      await page.screenshot({ path: f });
      run.screenshots.push(f.split("/test-results/")[1]);
    };
    const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
    try {
      await page.goto(server.url + `/?map=starsprout&quality=high&lod=${lod}`, { waitUntil: "load" });
      const ready = await page
        .waitForFunction(() => window.__starwishMap?.ready === true || document.querySelector(".boot-status.error"), null, { timeout: 90000 })
        .then(() => page.evaluate(() => window.__starwishMap?.ready === true))
        .catch(() => false);
      const bootError = await page.evaluate(() => document.querySelector(".boot-status.error")?.textContent ?? null);
      check("啟動", ready, bootError ?? "ok");
      if (!ready) throw new Error("地圖未啟動");
      await page.waitForTimeout(1200);
      await settle(page, 4);
      const info = await page.evaluate(() => window.__starwishMap.info());
      run.results.info = info;
      check("地形 16 塊", info.chunks === 16, info.chunks);
      check(lod === "hq" ? "HQ 地形 1 公尺網格（約 6.5 萬三角形）" : "Lite 地形 1.5 公尺網格（約 2.9 萬三角形）", lod === "hq" ? info.terrainTris === 64800 : info.terrainTris === 28800, info.terrainTris);
      const px = await page.evaluate(() => window.__starwishMap.pixelStats());
      check("3D 畫面有繪製", px.distinctColors >= 20 && px.opaqueRatio > 0.3, px);
      await shot(page, "spawn");

      // 搖桿移動：往前走 2 秒，位置改變、角色貼地
      const p0 = await page.evaluate(() => window.__starwishMap.player());
      await page.evaluate(() => window.__starwishMap.setMove({ x: 0, y: 1 }));
      await page.waitForTimeout(2000);
      await page.evaluate(() => window.__starwishMap.setMove(null));
      const p1 = await page.evaluate(() => window.__starwishMap.player());
      const ground = await page.evaluate(([x, z]) => window.__starwishMap.surface(x, z), [p1.x, p1.z]);
      check("搖桿移動、角色貼地", Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.5 && Math.abs(p1.y - ground) < 0.01, { p0, p1, ground });

      // 溪流不可走：從北岸往河裡走，會停在岸邊
      await page.evaluate(() => window.__starwishMap.teleport(-6, -3));
      await page.evaluate(() => window.__starwishMap.setMove({ x: 0, y: 0 }));
      const bank = await page.evaluate(() => {
        const api = window.__starwishMap;
        // 河在南方：直接用世界方向測試（鏡頭面向北）
        return { here: api.walkable(-6, -3), water: api.walkable(-4, -14) };
      });
      check("溪流河道不可走、岸邊可走", bank.here === true && bank.water === false, bank);

      // 橋：B1 中央可走、高於水面
      const bridge = await page.evaluate(() => ({ mid: window.__starwishMap.walkable(-22, -1), y: window.__starwishMap.surface(-22, -1) }));
      check("B1 橋中央可走、橋面高於水面", bridge.mid && bridge.y > 5.7, bridge);

      // 截圖：各視角
      for (const v of ["camp", "bridge", "highland", "farm", "ruins", "arena"]) {
        await page.evaluate((x) => window.__starwishMap.view(x), v);
        await settle(page, 4);
        await shot(page, v);
      }
      await page.evaluate(() => window.__starwishMap.view("overview"));
      await settle(page, 4);
      await shot(page, "overview");
      await page.evaluate(() => window.__starwishMap.setNav(true));
      await settle(page, 4);
      await shot(page, "overview_nav");
      await page.evaluate(() => window.__starwishMap.setNav(false));

      // 傳送門：平時可見、走進去會提示尚未開放
      await page.evaluate(() => window.__starwishMap.teleport(0, 79));
      await page.evaluate(() => window.__starwishMap.setMove({ x: 0, y: 1 }));
      await page.waitForFunction(() => window.__starwishMap.player().z > 81, null, { timeout: 30000 }).catch(() => null);
      await page.evaluate(() => window.__starwishMap.setMove(null));
      await settle(page, 2);
      const toast = await page.evaluate(() => document.querySelector(".hud-toast")?.textContent ?? "");
      check("傳送門平時可見，走進去提示需擊敗 Boss 並達成條件", /擊敗王冠重錘兔/.test(toast), toast);
      await shot(page, "portal");

      // 標示開關
      await page.evaluate(() => window.__starwishMap.setLabels(false));
      const off = await page.evaluate(() => window.__starwishMap.info().labels);
      await page.evaluate(() => window.__starwishMap.setLabels(true));
      check("標示可開關", off === false, off);

      // 路線測試流程（CI 每秒只有幾格：只確認會沿路前進、沒有卡住；完整 60 秒由單元測試模擬）
      if (lod === "hq") {
        await page.evaluate(() => window.__starwishMap.startRoute(1));
        await page.waitForTimeout(25000);
        const st = await page.evaluate(() => window.__starwishMap.routeState());
        const pl = await page.evaluate(() => window.__starwishMap.player());
        run.results.route = { st, pl };
        check("路線測試：自動沿主路前進、沒有卡住", st.phase === "running" && st.t > 0 && Math.hypot(pl.x + 56, pl.z + 64) > 3 && !(st.result && st.result.stuck.length), { st, pl });
        await shot(page, "route");
      }
      const rep = await page.evaluate(() => window.__starwishMap.report());
      check("報告文字", /Stage 6 P1/.test(rep) && /主路線/.test(rep), rep.slice(0, 200));
      const after = await page.evaluate(() => window.__starwishMap.info());
      check("沒有 WebGL Context Lost", after.contextLost === 0, after.contextLost);
      run.results.after = after;
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }
    await ctx.close();
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 10;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / map ${lod}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 600)}`);
    console.log(`   · info ${JSON.stringify(run.results.info)}`);
    for (const e of run.errors) console.log(`   ! ${e}`);
  }

  // ---------- P1 最後驗收準備：畫質組合對照（原始 HQ 陰影 vs HQ 預設候選 PCSS32 vs 真正的 Lite）----------
  {
    const run = { browser: name, lod: "compare", checks: {}, errors: [], screenshots: [], results: {} };
    const check = (k, ok, detail) => (run.checks[k] = { ok, detail });
    const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true });
    const VIEWS = ["charFront", "charSide", "charBack", "arena", "ruins", "camp"];
    const CONFIGS = [
      ["hq_orig", "preset=hq&shadowq=high"],
      ["hq", "preset=hq"],
      ["lite", "preset=lite"],
    ];
    const shots = {};
    try {
      for (const [tag, q] of CONFIGS) {
        const page = await ctx.newPage();
        page.on("pageerror", (e) => run.errors.push(`${tag} pageerror: ${e.message}`));
        await page.goto(server.url + `/?map=starsprout&${q}&labels=0`, { waitUntil: "load" });
        await page.waitForFunction(() => window.__starwishMap?.ready === true, null, { timeout: 90000 });
        await page.waitForTimeout(800);
        run.results[tag] = await page.evaluate(() => window.__starwishMap.info());
        await page.evaluate(() => { const h = document.getElementById("hud-root"); if (h) h.style.visibility = "hidden"; });
        shots[tag] = {};
        for (const v of VIEWS) {
          await page.evaluate((x) => window.__starwishMap.view(x), v);
          await settle(page, 5);
          const f = `${outDir}${name}_cmp_${tag}_${v}.png`;
          shots[tag][v] = await page.screenshot({ path: f });
          run.screenshots.push(f.split("/test-results/")[1]);
        }
        await page.close();
      }
      const dp = await ctx.newPage();
      const diff = (a, b) =>
        dp.evaluate(async ([x, y]) => {
          const load = (b64) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + b64; });
          const [ia, ib] = await Promise.all([load(x), load(y)]);
          const c = document.createElement("canvas");
          c.width = ia.width;
          c.height = ia.height;
          const g = c.getContext("2d");
          g.drawImage(ia, 0, 0);
          const da = g.getImageData(0, 0, c.width, c.height).data;
          g.drawImage(ib, 0, 0);
          const db = g.getImageData(0, 0, c.width, c.height).data;
          let changed = 0, sum = 0, max = 0;
          for (let k = 0; k < da.length; k += 4) {
            const d = Math.max(Math.abs(da[k] - db[k]), Math.abs(da[k + 1] - db[k + 1]), Math.abs(da[k + 2] - db[k + 2]));
            sum += d;
            if (d > max) max = d;
            if (d > 8) changed++;
          }
          const n = da.length / 4;
          return { changedPct: +((changed / n) * 100).toFixed(3), meanDiff: +(sum / n).toFixed(3), maxDiff: max };
        }, [a.toString("base64"), b.toString("base64")]);
      const diffs = {};
      for (const v of VIEWS) diffs[v] = await diff(shots.hq_orig[v], shots.hq[v]);
      await dp.close();
      run.results.diffs = diffs;
      const r = run.results;
      check("HQ 預設：PCSS32 中品質、發光層開、MSAA 4x、高畫質", r.hq.shadow === "medium" && r.hq.glow === true && r.hq.msaa === 4 && r.hq.quality === "high" && r.hq.lod === "hq", r.hq);
      check("原始對照：shadowq=high 為 PCSS 高品質", r.hq_orig.shadow === "high", r.hq_orig.shadow);
      check("Lite：中畫質（FXAA、PCF）＋Lite 地形，不是高畫質", r.lite.quality === "medium" && r.lite.lod === "lite" && r.lite.shadow === "pcf" && r.lite.fxaa === true && r.lite.msaa === 1, r.lite);
      check("Lite 解析度上限 1.5 倍", Number((/@([\d.]+)x/.exec(r.lite.render) ?? [])[1]) <= 1.5 + 1e-6, r.lite.render);
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }
    await ctx.close();
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 4;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / map 畫質組合對照`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 600)}`);
    console.log(`   · diffs hq_orig→hq ${JSON.stringify(run.results.diffs)}`);
    for (const e of run.errors) console.log(`   ! ${e}`);
  }
  await browser.close();
}
await server.close();
report.finishedAt = new Date().toISOString();
report.failures = failures;
writeFileSync(`${outDir}report.json`, JSON.stringify(report, null, 2));
console.log(failures ? `\n${failures} 項失敗` : "\n全部通過");
process.exit(failures ? 1 : 0);
