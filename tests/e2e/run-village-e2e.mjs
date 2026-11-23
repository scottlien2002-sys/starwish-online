// Stage 6 P2-3 星芽村 V1.3 Grey-box（?map=village）端對端測試：載入、配置、移動與碰撞、石階、高台邊緣、鏡頭、三種畫質、截圖。
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
      check("開場在南方傳送門內側抵達點 (0,−39)、面向北", await page.evaluate(() => { const p = window.__starwishVillage.player(); return Math.abs(p.x) < 0.01 && Math.abs(p.z + 39) < 0.01 && Math.abs(p.yaw) < 1e-6; }), await page.evaluate(() => window.__starwishVillage.player()));
      await shot(page, "arrival");

      const lay = await page.evaluate(() => window.__starwishVillage.layout());
      check("NPC 站位 8（6 職業＋倉庫＋佈告欄）、出生／復活點 24、傳送門 4", lay.npcs.length === 8 && lay.respawn.length === 24 && lay.portals.length === 4, { npcs: lay.npcs.length, respawn: lay.respawn.length, portals: lay.portals.length });

      // 走路：從傳送陣往北走 3 秒（5 m/s）
      const walk = await page.evaluate(async () => {
        const api = window.__starwishVillage;
        const frames = (n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
        api.teleport(0, -39, 0);
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

      // 北路：走上 0° 石階到高台（Y 2），一路走到北方傳送門，停在高台外緣牆內
      const climb = await page.evaluate(async () => {
        const api = window.__starwishVillage;
        const frames = (n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
        api.teleport(0, 15, 0);
        await frames(3);
        api.setMove({ x: 0, y: 1 });
        for (let i = 0; i < 600 && api.player().z < 24.2; i++) await frames(1);
        const top = api.player();
        for (let i = 0; i < 900 && api.player().z < 48.6; i++) { const z0 = api.player().z; await frames(1); if (i > 30 && Math.abs(api.player().z - z0) < 1e-4) break; }
        await frames(20);
        const end = api.player();
        api.setMove(null);
        return { top, end };
      });
      check("北路石階走得上北側高台（Y 2）", Math.abs(climb.top.y - 2) < 0.01, climb.top);
      check("北路直通北方傳送門、停在高台外緣內（不會掉出地圖）", Math.abs(climb.end.y - 2) < 0.01 && climb.end.z > 47 && climb.end.z < 49.8, climb.end);

      // 騎士軍團：從 NPC 前方往大門走，停在牆外
      const wall = await page.evaluate(async () => {
        const api = window.__starwishVillage;
        const frames = (n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
        const n = api.layout().npcs.find((x) => x.id === "knight");
        api.teleport(n.x + Math.sin(n.yaw) * 1.5, n.z + Math.cos(n.yaw) * 1.5, (n.yaw * 180) / Math.PI + 180);
        await frames(3);
        api.setMove({ x: 0, y: 1 });
        await frames(90);
        api.setMove(null);
        const p = api.player();
        const t = (332 * Math.PI) / 180;
        return { ...p, along: p.x * Math.sin(t) + p.z * Math.cos(t) };
      });
      check("騎士軍團牆擋住（不能穿牆進入建築）", wall.along < 27 - 0.25 && wall.along > 25.5 && Math.abs(wall.y - 2) < 0.01, wall);

      // 高台內緣（兩座石階之間）：往廣場走不會掉下去
      const edge = await page.evaluate(async () => {
        const api = window.__starwishVillage;
        const frames = (n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
        const t = (345 * Math.PI) / 180;
        api.teleport(24.5 * Math.sin(t), 24.5 * Math.cos(t), 165);
        await frames(3);
        api.setMove({ x: 0, y: 1 });
        await frames(60);
        api.setMove(null);
        const p = api.player();
        return { ...p, r: Math.hypot(p.x, p.z) };
      });
      check("高台邊緣擋住（只能從石階上下）", Math.abs(edge.y - 2) < 0.01 && edge.r >= 23, edge);

      // 四座傳送門：位置、可站、南方開放、其他未開放
      const portals = await page.evaluate(() => {
        const api = window.__starwishVillage;
        return api.layout().portals.map((p) => ({ id: p.id, x: p.x, z: p.z, open: p.open, dest: p.destination, ok: api.standable(p.x, p.z), h: api.height(p.x, p.z) }));
      });
      check("四座傳送門位置正確、可站；只有南方開放（往星芽原野營地）",
        portals.length === 4 && portals.every((p) => p.ok) &&
        portals.find((p) => p.id === "south").open && portals.find((p) => p.id === "south").dest.x === -56 &&
        portals.filter((p) => p.id !== "south").every((p) => !p.open && p.dest === null) &&
        portals.find((p) => p.id === "north").h === 2, portals);

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
      const views = ["gate", "plaza", "west", "east", "north", "northPortal", "smith", "circus", "church", "terrace"];
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
      check("報告文字（含模式）", /星芽村 V1.3 Grey-box/.test(rep) && /出生／復活點 24/.test(rep) && /傳送門 4（開放 1）/.test(rep) && modeOk, rep.slice(0, 400));
      // 巡迴 1 圈（只在 WebKit Lite 低跑，控制 CI 時間）：真正卡住 0、報告含必要欄位
      if (name === "webkit" && mode === "lite-low") {
        await page.evaluate(() => { window.__starwishVillage.setLabels(true); window.__starwishVillage.startTour(1); });
        const done = await page
          .waitForFunction(() => window.__starwishVillage.tourState().result !== null, null, { timeout: 600000, polling: 1000 })
          .then(() => true)
          .catch(() => false);
        const tr = await page.evaluate(() => ({ state: window.__starwishVillage.tourState(), rep: window.__starwishVillage.report() }));
        run.results.tour = { done, result: tr.state.result };
        const res = tr.state.result;
        check("巡迴 1 圈完成、真正卡住 0、腳本誤報 0", done && res && res.stuck === 0 && res.timeouts === 0 && res.loopTimes.length === 1, res ? { loopTimes: res.loopTimes, stuck: res.stuck, timeouts: res.timeouts, blocked: res.blockedFrames, events: res.events } : "未完成");
        check("巡迴報告含每圈時間、FPS、Draw Calls、Context Lost、卡住與誤報次數、異常事件欄",
          /每圈時間/.test(tr.rep) && /總時間/.test(tr.rep) && /1% Low/.test(tr.rep) && /Draw Calls 平均/.test(tr.rep) && /Context Lost/.test(tr.rep) && /真正卡住 \d+ 次；腳本誤報/.test(tr.rep) && /異常事件：無|異常 /.test(tr.rep),
          tr.rep.split("\n").slice(-8).join(" / "));
      }
      // 環境基準（P3 預算用）：關掉測試標籤與地面標記，量全景與廣場的實際繪製三角形
      {
        const base = {};
        await page.evaluate(() => { window.__starwishVillage.setLabels(false); window.__starwishVillage.setMarkers(false); });
        for (const v of ["overview", "plaza", "gate"]) {
          await page.evaluate((x) => window.__starwishVillage.view(x), v);
          await settle(page, 5);
          base[v] = await page.evaluate(() => { const i = window.__starwishVillage.info(); return { draw: i.drawCalls, tris: i.triangles }; });
        }
        await page.evaluate(() => { window.__starwishVillage.setLabels(true); window.__starwishVillage.setMarkers(true); });
        run.results.envBaseline = base;
      }
      const after = await page.evaluate(() => window.__starwishVillage.info());
      check("沒有 WebGL Context Lost", after.contextLost === 0, after.contextLost);
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }
    await ctx.close();
    // P3-0：art=p3 開關（HQ 與 Lite 低）載入流程樣品 GLB
    if (mode === "hq" || mode === "lite-low") {
      const ctx2 = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true });
      const p2 = await ctx2.newPage();
      const errs = [];
      p2.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
      p2.on("console", (m) => m.type() === "error" && errs.push(`console: ${m.text()}`));
      try {
        await p2.goto(server.url + `/?map=village&quality=${q}&lod=${lod}&art=p3`, { waitUntil: "load" });
        await p2.waitForFunction(() => window.__starwishVillage?.ready === true, null, { timeout: 90000 });
        await p2.waitForFunction(() => { const a = window.__starwishVillage.artState(); return a && a.status !== "loading"; }, null, { timeout: 90000 });
        const art = await p2.evaluate(() => window.__starwishVillage.artState());
        run.results.artP3 = art;
        check("art=p3：流程樣品 GLB 載入成功（HQ／Lite 對應檔案）", art.status === "loaded" && art.file === `p30_sample_${lod === "lite" ? "lite" : "hq"}.glb` && art.meshes > 0 && art.triangles > 0, art);
        await p2.evaluate(() => window.__starwishVillage.view("p3sample"));
        await settle(p2, 6);
        const f = `${outDir}${name}_${mode}_p3sample.png`;
        await p2.screenshot({ path: f, timeout: 90000 });
        run.screenshots.push(f.split("/test-results/")[1]);
        const rep = await p2.evaluate(() => window.__starwishVillage.report());
        check("art=p3：報告列出正式美術載入狀態；不影響 NPC／傳送門／出生點資料", /正式美術 art=p3（P3-0）：已載入/.test(rep) && /出生／復活點 24、傳送門 4（開放 1）/.test(rep), rep.split("\n").filter((l) => /正式美術|出生/.test(l)).join(" / "));
        check("art=p3：沒有錯誤訊息", errs.length === 0, errs.slice(0, 3));
      } catch (e) {
        run.errors.push(`art=p3 exception: ${e.message}`);
      }
      await ctx2.close();
    }
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 16;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / village ${mode}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 600)}`);
    console.log(`   · info ${JSON.stringify(run.results.info)}`);
    console.log(`   · views ${JSON.stringify(run.results.viewStats)}`);
    console.log(`   · envBaseline ${JSON.stringify(run.results.envBaseline)} art ${JSON.stringify(run.results.artP3 ?? null)}`);
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
