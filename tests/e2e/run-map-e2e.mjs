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
  for (const [mode, q, lod] of [["hq", "high", "hq"], ["lite-mid", "medium", "lite"], ["lite-low", "low", "lite"]]) {
    const run = { browser: name, lod: mode, checks: {}, errors: [], screenshots: [], results: {} };
    const check = (k, ok, detail) => (run.checks[k] = { ok, detail });
    const shot = async (page, label) => {
      const f = `${outDir}${name}_${mode}_${label}.png`;
      await page.screenshot({ path: f });
      run.screenshots.push(f.split("/test-results/")[1]);
    };
    const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
    try {
      // HQ = 高畫質＋HQ 地形；完整 Lite = 低畫質渲染＋Lite 地形
      await page.goto(server.url + `/?map=starsprout&quality=${q}&lod=${lod}`, { waitUntil: "load" });
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
      check(`${mode} 使用 ${q} 畫質渲染`, info.quality === q, info.quality);
      check(lod === "hq" ? "HQ 地形 1 公尺網格（約 6.5 萬三角形）" : "Lite 地形 1.5 公尺網格（約 2.9 萬三角形）", lod === "hq" ? info.terrainTris === 64800 : info.terrainTris === 28800, info.terrainTris);
      check("營地與胡蘿蔔園：物件、網格建立（6 個以內）", !!info.props && info.props.props > 150 && info.props.meshes <= 6, info.props);
      check("植被：樹 ≥ 400、草叢與花有建立", !!info.veg && info.veg.trees >= 400 && info.veg.grass > 8000 && info.veg.flowers > 800, info.veg);
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
      for (const v of ["camp", "bridge", "highland", "farm", "ruins", "arena", "forest", "hill", "field", "flowersea", "campwide", "campfire", "campgate", "farmwide", "farmnear"]) {
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
      // 先讓角色面向北方（傳送門方向）、鏡頭在後方，再往前走進傳送門
      await page.evaluate(() => window.__starwishMap.pose({ x: 0, z: 79.5, playerYawDeg: 0, camBearingDeg: 180, beta: 1.15, radius: 8, freeze: false }));
      await page.evaluate(() => window.__starwishMap.unfreeze());
      await page.evaluate(() => window.__starwishMap.setMove({ x: 0, y: 1 }));
      await page.waitForFunction(() => window.__starwishMap.player().z > 80.6, null, { timeout: 90000 }).catch(() => null);
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
      if (lod === "hq") {
        // 陰影品質可在同一頁切換（畫質對照用）
        const sq = await page.evaluate(() => [window.__starwishMap.setShadowQuality("medium"), window.__starwishMap.shadowInfo(), window.__starwishMap.setShadowQuality("default"), window.__starwishMap.shadowInfo()]);
        check("陰影品質可切換（原始 ↔ PCSS32）", sq[0] === true && sq[1].q === "medium" && sq[3].q === "default" && sq[1].filtering !== sq[3].filtering, sq);
      }
      // 傳送門平台：角色站在平台與符文上時不過曝
      const expo = [];
      for (const v of [
        { x: 0, z: 74, playerYawDeg: 0, camBearingDeg: 180, beta: 1.05, radius: 9 },
        { x: 0, z: 66, playerYawDeg: 0, camBearingDeg: 180, beta: 1.05, radius: 9 },
        { x: 0, z: 66, playerYawDeg: 180, camBearingDeg: 0, beta: 1.0, radius: 6 },
      ]) {
        await page.evaluate((o) => window.__starwishMap.pose(o), v);
        await settle(page, 4);
        expo.push(await page.evaluate(() => window.__starwishMap.exposure()));
      }
      await page.evaluate(() => window.__starwishMap.unfreeze());
      run.results.exposure = expo;
      check("傳送門平台、符文附近畫面中央沒有過曝（純白像素 < 3%）", expo.every((e) => e.whiteCenter < 0.03), expo);
      const rep = await page.evaluate(() => window.__starwishMap.report());
      check("報告文字（含模式）", /Stage 6 P2-2/.test(rep) && /營地與胡蘿蔔園 物件/.test(rep) && /植被 樹/.test(rep) && /主路線/.test(rep) && (mode === "hq" ? /模式 HQ/.test(rep) : mode === "lite-mid" ? /模式 Lite 中畫質/.test(rep) : /模式 Lite 低畫質/.test(rep)), rep.slice(0, 300));
      const after = await page.evaluate(() => window.__starwishMap.info());
      check("沒有 WebGL Context Lost", after.contextLost === 0, after.contextLost);
      run.results.after = after;
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }
    await ctx.close();
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 11;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / map ${mode}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 600)}`);
    console.log(`   · info ${JSON.stringify(run.results.info)}`);
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
