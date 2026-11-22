// Stage 6 P2-3 星芽村 Grey-box（?map=village）端對端測試：載入、配置、移動與碰撞、石階、高台邊緣、鏡頭、三種畫質、截圖。
// 用法：node tests/e2e/run-village-e2e.mjs dist [chromium,webkit]
// 注意：CI 是無頭瀏覽器＋軟體繪圖，FPS 不代表 iPhone。
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";

const distDir = process.argv[2] ?? "dist";
const browsers = (process.argv[3] ?? "chromium,webkit").split(",");
const outDir = new URL("../../test-results/village-e2e/", import.meta.url).pathname;
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
      try {
        await page.screenshot({ path: f, timeout: 60000 });
      } catch {
        await settle(page, 2);
        await page.screenshot({ path: f, timeout: 90000 });
      }
      run.screenshots.push(f.split("/test-results/")[1]);
    };
    const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
    try {
      await page.goto(server.url + `/?map=village&quality=${q}&lod=${lod}`, { waitUntil: "load" });
      const ready = await page
        .waitForFunction(() => window.__starwishVillage?.ready === true || document.querySelector(".boot-status.error"), null, { timeout: 90000 })
        .then(() => page.evaluate(() => window.__starwishVillage?.ready === true))
        .catch(() => false);
      const bootError = await page.evaluate(() => document.querySelector(".boot-status.error")?.textContent ?? null);
      check("啟動", ready, bootError ?? "ok");
      if (!ready) throw new Error("村莊未啟動");
      await page.waitForTimeout(1000);
      await settle(page, 4);
      const info = await page.evaluate(() => window.__starwishVillage.info());
      run.results.info = info;
      check("村莊網格建立（靜態 1＋水 1＋標記 1＋金環 2）", info.world.meshes === 5 && info.world.triangles > 5000, info.world);
      check("抵達點在南側傳送陣、面向北", await page.evaluate(() => { const p = window.__starwishVillage.player(); return Math.abs(p.x) < 0.01 && Math.abs(p.z + 42.5) < 0.01; }), await page.evaluate(() => window.__starwishVillage.player()));
      await shot(page, "arrival");

      const lay = await page.evaluate(() => window.__starwishVillage.layout());
      check("NPC 站位 8（6 職業＋倉庫＋佈告欄）、復活點 24", lay.npcs.length === 8 && lay.respawn.length === 24, { npcs: lay.npcs.length, respawn: lay.respawn.length });

      // 走路：從傳送陣往北走 3 秒（5 m/s）
      const walk = await page.evaluate(async () => {
        const api = window.__starwishVillage;
        const frames = (n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
        api.teleport(0, -42.5, 0);
        await frames(3);
        const p0 = api.player();
        api.setMove({ x: 0, y: 1 });
        // CI 軟體繪圖很慢：用幀數等待（每幀最多走 0.5 m）
        await frames(40);
        api.setMove(null);
        const p1 = api.player();
        return { moved: Math.hypot(p1.x - p0.x, p1.z - p0.z), p1 };
      });
      check("搖桿往前可以移動", walk.moved > 1.5, walk);

      // 往騎士軍團石階走：上高台（Y 2.5），再往城堡走：停在牆外
      const climb = await page.evaluate(async () => {
        const api = window.__starwishVillage;
        const frames = (n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
        api.teleport(0, 15, 0);
        await frames(3);
        api.setMove({ x: 0, y: 1 });
        for (let i = 0; i < 600 && api.player().z < 24.2; i++) await frames(1);
        const top = api.player();
        await frames(60);
        const wall = api.player();
        api.setMove(null);
        return { top, wall };
      });
      check("石階可以走上騎士軍團高台（Y 2）", Math.abs(climb.top.y - 2) < 0.01 && Math.abs(climb.wall.y - 2) < 0.01, climb);
      check("騎士軍團牆擋住（不能穿牆進入建築）", climb.wall.z < 26 - 0.25 && climb.wall.z > 24, climb.wall);

      // 高台邊緣：往側面走不會掉下去
      const edge = await page.evaluate(async () => {
        const api = window.__starwishVillage;
        // 教堂高台（獨立）南側邊緣
        api.teleport(30, -8.5, 180);
        const frames = (n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
        await frames(3);
        api.setMove({ x: 0, y: 1 });
        await frames(60);
        api.setMove(null);
        return api.player();
      });
      check("高台邊緣擋住（只能從石階上下）", Math.abs(edge.y - 2) < 0.01 && edge.z > -10.1, edge);

      // 噴泉水池擋住
      const pool = await page.evaluate(async () => {
        const api = window.__starwishVillage;
        const frames = (n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
        api.teleport(0, -12, 0);
        await frames(3);
        api.setMove({ x: 0, y: 1 });
        await frames(80);
        api.setMove(null);
        const p = api.player();
        return { ...p, r: Math.hypot(p.x, p.z) };
      });
      check("星願之泉水池擋住（不會走進水裡）", pool.r >= 7.25, pool);

      // 每個 NPC 前方 2 m 都可以站、鏡頭在建築外
      const npcs = await page.evaluate(() => {
        const api = window.__starwishVillage;
        return api.layout().npcs.map((n) => ({ id: n.id, ok: api.standable(n.x + Math.sin(n.yaw) * 2, n.z + Math.cos(n.yaw) * 2) && api.standable(n.x, n.z) }));
      });
      check("每位 NPC 站位與前方 2 m 都可站", npcs.every((n) => n.ok), npcs);
      const resp = await page.evaluate(() => {
        const api = window.__starwishVillage;
        return api.layout().respawn.filter((s) => !api.standable(s.x, s.z) || api.height(s.x, s.z) !== 0).length;
      });
      check("復活點全部可站、在廣場地面", resp === 0, resp);

      // 截圖視角
      const views = ["gate", "plaza", "west", "east", "north", "smith", "circus", "terrace"];
      const stats = {};
      for (const v of views) {
        await page.evaluate((x) => window.__starwishVillage.view(x), v);
        await settle(page, 5);
        stats[v] = await page.evaluate(() => { const i = window.__starwishVillage.info(); return { draw: i.drawCalls, tris: i.triangles }; });
        await shot(page, v);
      }
      await page.evaluate(() => window.__starwishVillage.view("overview"));
      await settle(page, 5);
      stats.overview = await page.evaluate(() => { const i = window.__starwishVillage.info(); return { draw: i.drawCalls, tris: i.triangles }; });
      await shot(page, "overview");
      await page.evaluate(() => window.__starwishVillage.setLabels(false));
      await page.evaluate(() => window.__starwishVillage.view("plaza"));
      await settle(page, 5);
      await shot(page, "plaza_nolabels");
      run.results.viewStats = stats;
      const maxDraw = Math.max(...Object.values(stats).map((s) => s.draw));
      const maxTris = Math.max(...Object.values(stats).map((s) => s.tris));
      check("Grey-box 繪製次數與三角形在預算內（Draw ≤ 70、三角形 ≤ 30.5 萬）", maxDraw <= 70 && maxTris <= 305000, { maxDraw, maxTris });

      const rep = await page.evaluate(() => window.__starwishVillage.report());
      const modeOk = mode === "hq" ? /模式 HQ/.test(rep) : mode === "lite-mid" ? /模式 Lite 中畫質/.test(rep) : /模式 Lite 低畫質/.test(rep);
      check("報告文字（含模式）", /星芽村 Grey-box/.test(rep) && /復活點 24/.test(rep) && modeOk, rep.slice(0, 400));
      const after = await page.evaluate(() => window.__starwishVillage.info());
      check("沒有 WebGL Context Lost", after.contextLost === 0, after.contextLost);
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }
    await ctx.close();
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 14;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / village ${mode}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 600)}`);
    console.log(`   · info ${JSON.stringify(run.results.info)}`);
    console.log(`   · views ${JSON.stringify(run.results.viewStats)}`);
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
