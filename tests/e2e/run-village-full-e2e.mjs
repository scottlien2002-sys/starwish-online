// Stage 6 P3 星芽村全村整合候選（?map=village&art=full）端對端測試：
// 載入全部正式候選美術、效能數字、移動規則（不跳躍走上高台）、所有 NPC 互動、洛恩停下面向玩家＋寵物鑑定完整流程、
// 傳送門狀態（南門開放、北東西休眠）、iPhone 直向截圖。
// 用法：node tests/e2e/run-village-full-e2e.mjs dist [chromium,webkit] [輸出資料夾]
// 注意：CI 是無頭瀏覽器＋軟體繪圖，FPS 不代表 iPhone 實機。
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";

const distDir = process.argv[2] ?? "dist";
const browsers = (process.argv[3] ?? "chromium,webkit").split(",");
const outDir = process.argv[4] ?? new URL("../../test-results/village-full-e2e/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

const pw = await loadPlaywright();
const server = await serve(distDir);
const report = { startedAt: new Date().toISOString(), note: "CI 軟體繪圖：FPS 不代表 iPhone 實機", runs: [] };
let failures = 0;
const settle = (page, n = 3) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

const MODES = [
  ["hq-portrait", "high", "hq", { width: 390, height: 844 }],
  ["lite-portrait", "low", "lite", { width: 390, height: 844 }],
  ["hq-landscape", "high", "hq", { width: 844, height: 390 }],
];

for (const name of browsers) {
  let browser;
  try {
    browser = await pw[name].launch();
  } catch (e) {
    report.runs.push({ browser: name, ok: false, error: `無法啟動瀏覽器：${e.message}` });
    failures++;
    continue;
  }
  for (const [mode, q, lod, vp] of MODES) {
    if (name === "webkit" && mode === "hq-landscape") continue;
    const run = { browser: name, mode, checks: {}, errors: [], screenshots: [], results: {} };
    report.runs.push(run);
    const check = (k, ok, detail) => {
      run.checks[k] = { ok: !!ok, detail };
      if (!ok) failures++;
    };
    const shot = async (page, label) => {
      const f = `${outDir}/${name}_${mode}_${label}.png`;
      await settle(page, 3);
      await page.screenshot({ path: f, timeout: 120000 }).catch(() => null);
      run.screenshots.push(f.split("/").pop());
    };
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
    const V = (fn, arg) => page.evaluate(fn, arg);
    try {
      await page.goto(server.url + `/?map=village&art=full&quality=${q}&lod=${lod}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__starwishVillage?.ready === true, null, { timeout: 120000 });
      await page.waitForFunction(() => { const a = window.__starwishVillage.artFull(); return a.status === "loaded" || a.status.startsWith("部分") || a.status.startsWith("error"); }, null, { timeout: 240000 });
      const art = await V(() => window.__starwishVillage.artFull());
      run.results.art = art;
      check("全村正式美術載入完成（14 組模型、沒有錯誤）", art.status === "loaded" && Object.keys(art.parts).length === 14 && art.merchant, { status: art.status, parts: Object.keys(art.parts), errors: art.errors });
      await page.waitForTimeout(800);
      // 效能（CI 軟體繪圖，只看相對數字）
      const perf = {};
      for (const [k, x, z, yaw] of [["arrival", 0, -39, 0], ["spawn", null, null, null], ["plaza_north", 0, 15, 180], ["east", 30, 0, 270]]) {
        if (x === null) {
          const sp = await V(() => window.__starwishVillage.layout().respawn[6]);
          await V(([a, b]) => window.__starwishVillage.teleport(a, b, 0), [sp.x, sp.z]);
        } else await V(([a, b, c]) => window.__starwishVillage.teleport(a, b, c), [x, z, yaw]);
        await settle(page, 20);
        perf[k] = await V(() => window.__starwishVillage.info());
        await shot(page, `view_${k}`);
      }
      run.results.perf = Object.fromEntries(Object.entries(perf).map(([k, v]) => [k, { drawCalls: v.drawCalls, triangles: v.triangles }]));
      check("繪製次數 ≤ 140（全村整合，任何位置）", Object.values(perf).every((v) => v.drawCalls <= 140), run.results.perf);
      // 移動規則：從廣場沿北側石階（方位 0°）走上高台，不需要跳躍
      await V(() => window.__starwishVillage.teleport(0, 15, 0));
      await V(() => window.__starwishVillage.setMove({ x: 0, y: 1 }));
      await page.waitForTimeout(2600);
      await V(() => window.__starwishVillage.setMove(null));
      const up = await V(() => window.__starwishVillage.player());
      check("移動規則：一般行走走上石階到高台（不跳躍）", up.y > 1.9 && up.z > 23, up);
      // 所有 NPC：站到 NPC 前方 → 出現互動 → 按下 → 對話框（名稱與職責）
      const npcs = await V(() => window.__starwishVillage.layout().npcs);
      const npcRes = [];
      for (const n of npcs) {
        const px = n.x + Math.sin(n.yaw) * 1.6;
        const pz = n.z + Math.cos(n.yaw) * 1.6;
        await V(([a, b, c]) => window.__starwishVillage.teleport(a, b, c), [px, pz, ((n.yaw + Math.PI) * 180) / Math.PI]);
        await settle(page, 4);
        const st = await V(() => window.__starwishVillage.interact());
        const what = await V(() => window.__starwishVillage.interactNow());
        await settle(page, 2);
        const after = await V(() => window.__starwishVillage.interact());
        npcRes.push({ id: n.id, target: st?.target, what, dialog: after?.dialog?.slice(0, 40) });
        if (["smith", "church", "circus"].includes(n.id) && mode === "hq-portrait") await shot(page, `npc_${n.id}`);
        await V(() => window.__starwishVillage.interactClose());
      }
      run.results.npcs = npcRes;
      check(`NPC 互動：${npcs.length} 位 NPC 都能靠近後點擊對話（名稱、職責）`, npcRes.every((r) => r.target === `npc:${r.id}` && r.what === `npc:${r.id}` && r.dialog.length > 0), npcRes);
      check("鐵匠只有一位（轉職＋裝備鑑定）", npcs.filter((n) => n.id === "smith").length === 1 && /轉職/.test(npcs.find((n) => n.id === "smith").role) && /鑑定/.test(npcs.find((n) => n.id === "smith").role), npcs.find((n) => n.id === "smith"));
      // 傳送門：南門開放（確認視窗）、北東西休眠
      const portals = await V(() => window.__starwishVillage.layout().portals);
      const pRes = [];
      for (const p of portals) {
        await V(([a, b]) => window.__starwishVillage.teleport(a, b, 0), [p.x, p.z]);
        await settle(page, 4);
        const st = await V(() => window.__starwishVillage.interact());
        await V(() => window.__starwishVillage.interactNow());
        await settle(page, 2);
        const d = (await V(() => window.__starwishVillage.interact())).dialog;
        pRes.push({ id: p.id, open: p.open, target: st?.target, dialog: d.slice(0, 60) });
        if (mode === "hq-portrait" && (p.id === "south" || p.id === "east")) await shot(page, `portal_${p.id}`);
        await V(() => window.__starwishVillage.interactClose());
      }
      run.results.portals = pRes;
      check("傳送門狀態：南門開放（可前往星芽原野、需確認）、北東西休眠（未開放）；共 4 座、沒有新增出口", pRes.length === 4 && pRes.every((r) => r.target === `portal:${r.id}` && (r.open ? /星芽原野/.test(r.dialog) && /前往/.test(r.dialog) : /未開放/.test(r.dialog))) && pRes.filter((r) => r.open).length === 1, pRes);
      // 洛恩：靠近 → 停下並面向玩家 → 商人選單 → 寵物鑑定 → 放入 → 鑑定 → 結果
      for (let k = 0; k < 3; k++) {
        await page.evaluate(() => document.querySelectorAll("button").forEach((b) => b.textContent === "洛恩旁（寵物商人）" && b.click()));
        await settle(page, 4);
        const st0 = await V(() => window.__starwishVillage.interact());
        if (st0?.target === "merchant") break;
      }
      const m0 = await V(() => window.__starwishVillage.interact());
      check("洛恩：靠近 2.5 m 內出現互動", m0?.target === "merchant", m0);
      await V(() => window.__starwishVillage.interactNow());
      await page.waitForTimeout(600);
      const m1 = await V(() => window.__starwishVillage.interact());
      check("洛恩：對話時停止巡走（暫停中）並開啟商人選單", m1?.talking && m1.merchantPaused && m1.panelOpen, m1);
      await shot(page, "merchant_talk");
      await page.click('[data-act="choose:appraise"]', { timeout: 10000 }).catch((e) => run.errors.push(`appraise button: ${e.message}`));
      await page.waitForFunction(() => window.__starwishVillage.appraisal()?.phase === "empty", null, { timeout: 15000 }).catch(() => null);
      await shot(page, "appraise_1_open");
      await page.click('.pa-win [data-id="s1"]', { timeout: 10000 }).catch((e) => run.errors.push(`tile: ${e.message}`));
      await page.waitForTimeout(500);
      await shot(page, "appraise_2_placed");
      const a1 = await V(() => window.__starwishVillage.appraisal());
      await page.click('.pa-win [data-act="start"]', { timeout: 10000 }).catch((e) => run.errors.push(`start: ${e.message}`));
      await page.click('.pa-win [data-act="start"]', { timeout: 2000, force: true }).catch(() => null);
      await page.waitForTimeout(3400);
      await shot(page, "appraise_3_result");
      const a2 = await V(() => window.__starwishVillage.appraisal());
      check("寵物鑑定：放入後可鑑定；連點只鑑定一次；結果逐條顯示；物品留在背包並變成已鑑定", a1?.phase === "ready" && a2?.phase === "result" && a2.items.length === a1.items.length && a2.items.find((i) => i.id === "s1")?.appraised === true && a2.lines.length > 0, { before: a1?.phase, after: a2?.phase, lines: a2?.lines });
      const hs = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const sb = await page.evaluate(() => document.querySelector('.pa-win [data-act="start"]')?.getBoundingClientRect().bottom ?? 9999);
      if (mode.includes("portrait")) check("iPhone 直向：鑑定視窗沒有橫向捲動、按鈕在畫面內", hs <= 0 && sb <= vp.height, { hScroll: hs, startBottom: sb });
      await page.click('.pa-win [data-act="close"]', { timeout: 10000 }).catch(() => null);
      await page.waitForTimeout(400);
      const m2 = await V(() => window.__starwishVillage.interact());
      await page.waitForTimeout(1500);
      check("洛恩：關閉後恢復巡走", m2 && !m2.talking, m2);
      run.results.fpsSoftware = (await V(() => window.__starwishVillage.info())).drawCalls;
    } catch (e) {
      run.errors.push(String(e.message ?? e));
      failures++;
    }
    run.ok = Object.values(run.checks).every((c) => c.ok) && run.errors.filter((x) => !x.startsWith("console")).length === 0;
    await ctx.close();
  }
  await browser.close();
}
await server.close();
report.finishedAt = new Date().toISOString();
writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.runs.map((r) => ({ browser: r.browser, mode: r.mode, ok: r.ok, errors: r.errors?.slice(0, 3), checks: Object.fromEntries(Object.entries(r.checks ?? {}).map(([k, v]) => [k, v.ok])) })), null, 1));
if (failures) process.exit(1);
