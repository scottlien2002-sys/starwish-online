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
      check("全村正式美術載入完成（16 組模型＝15 組＋正式NPC、沒有錯誤）", art.status === "loaded" && Object.keys(art.parts).length === 16 && art.merchant, { status: art.status, parts: Object.keys(art.parts), errors: art.errors });
      const npcInfo = await V(() => window.__starwishVillage.npcs());
      run.results.npcModels = npcInfo.stats;
      const npcIds = ["sword", "knight", "smith", "mage", "church", "circus", "warehouse", "guild"];
      check("Stage 6.2 正式NPC：8 位都已載入（取代佔位人形），各 1 個網格，具備待機／轉身／對話動作", npcIds.every((id) => npcInfo.stats[id] && npcInfo.stats[id].meshes === 1 && ["Idle", "Turn", "Talk"].every((a) => npcInfo.stats[id].animations.includes(a))) && npcIds.every((id) => npcInfo.state[id]?.anim === "Idle"), npcInfo);
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
      const dcMax = lod === "lite" ? 100 : 160;
      check(`繪製次數 ≤ ${dcMax}（全村整合、${lod === "lite" ? "Lite" : "HQ"}、任何位置）`, Object.values(perf).every((v) => v.drawCalls <= dcMax), run.results.perf);
      // 移動規則：從廣場沿北側石階（方位 0°）走上高台，不需要跳躍
      await V(() => window.__starwishVillage.teleport(0, 15, 0));
      await V(() => window.__starwishVillage.setMove({ x: 0, y: 1 }));
      // 軟體繪圖幀率很低：等到走上高台或 40 秒（每幀時間上限 0.1 秒，與幀率無關的是「距離」）
      await page.waitForFunction(() => { const p = window.__starwishVillage.player(); return p.y > 1.9 && p.z > 23.5; }, null, { timeout: 40000, polling: 250 }).catch(() => null);
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
        const g = n.id === "guild" ? await V(() => window.__starwishVillage.guild("noop")) : null;
        const talkAnim = n.id === "board" ? "-" : (await V(() => window.__starwishVillage.npcs())).state[n.id]?.anim;
        npcRes.push({ id: n.id, target: st?.target, what, dialog: g ? (g.open ? "星願商會選單" : "") : after?.dialog?.slice(0, 40), talkAnim });
        if (n.id !== "board" && mode === "hq-portrait") await shot(page, `npc_${n.id}`);
        await V(() => window.__starwishVillage.interactClose());
        await settle(page, 3);
        if (n.id !== "board") npcRes[npcRes.length - 1].afterAnim = (await V(() => window.__starwishVillage.npcs())).state[n.id]?.anim;
      }
      run.results.npcs = npcRes;
      check(`NPC 互動：${npcs.length} 位 NPC 都能靠近後點擊對話（名稱、職責）`, npcRes.every((r) => r.target === `npc:${r.id}` && r.what === `npc:${r.id}` && r.dialog.length > 0), npcRes);
      check("正式NPC：對話時播放對話動作（Talk／面向玩家），結束後回到待機", npcRes.filter((r) => r.id !== "board").every((r) => (r.talkAnim === "Talk" || r.talkAnim === "Turn") && r.afterAnim !== "Talk"), npcRes.map((r) => ({ id: r.id, talk: r.talkAnim, after: r.afterAnim })));
      check("鐵匠只有一位（轉職＋裝備鑑定）", npcs.filter((n) => n.id === "smith").length === 1 && /轉職/.test(npcs.find((n) => n.id === "smith").role) && /鑑定/.test(npcs.find((n) => n.id === "smith").role), npcs.find((n) => n.id === "smith"));
      // 星願商會：選單 → 交易所三分類（裝備／寵物詳細資料）→ 購買 → 掛賣（鎖定）→ 取消（解鎖）→ 再掛賣 → 他人買走（示範）→ 領取收益
      {
        const gnpc = npcs.find((n) => n.id === "guild");
        await V(([a, b, c]) => window.__starwishVillage.teleport(a, b, c), [gnpc.x + Math.sin(gnpc.yaw) * 1.6, gnpc.z + Math.cos(gnpc.yaw) * 1.6, ((gnpc.yaw + Math.PI) * 180) / Math.PI]);
        await settle(page, 3);
        await V(() => window.__starwishVillage.interactNow());
        await page.waitForTimeout(700);
        const G = (c) => V((x) => window.__starwishVillage.guild(x), c);
        const g0 = await G("noop");
        if (mode.includes("portrait")) await shot(page, "guild_1_menu");
        const gm = await G("go:market");
        const ge = await G("cat:equipment");
        await page.waitForTimeout(300);
        const ge2 = await G("noop");
        if (mode === "hq-portrait") await shot(page, "guild_2_market_equipment");
        await G("cat:pet");
        await page.waitForTimeout(300);
        const gp = await G("noop");
        await G("detail");
        if (mode.includes("portrait")) await shot(page, "guild_3_pet_detail");
        const gb = await G("buy");
        await G("go:mine");
        await G("startListing");
        await G("cat:pet");
        await page.waitForTimeout(300);
        await G("choose");
        if (mode === "hq-portrait") await shot(page, "guild_4_listing_price");
        const gl = await G("price:800");
        const locked = await G("startListing");
        await G("cat:pet");
        await page.waitForTimeout(300);
        const lockedInv = await G("noop");
        await G("go:mine");
        const gc = await G("cancel");
        await G("startListing");
        await G("cat:item");
        await page.waitForTimeout(300);
        await G("choose");
        await G("price:300");
        await G("sale");
        await G("go:earnings");
        const ge3 = await G("noop");
        const gcl = await G("claim");
        if (mode.includes("portrait")) await shot(page, "guild_5_earnings");
        await G("close");
        run.results.guild = { menu: g0.screen, market: gm.listings.length, eq: ge2.listings.slice(0, 2), pet: gp.listings.slice(0, 2), buy: gb.last, list: gl.last, lockedInv: lockedInv.inv, cancel: gc.last, earn: ge3.earn, claim: gcl.last, msg: gcl.msg };
        check("星願商會：掌櫃選單、標示測試資料與本機示範（不是多人交易）", g0.open && g0.screen === "menu" && g0.test === true && g0.serverBacked === false, g0);
        check("星願商會：交易所道具／裝備／寵物三分類；裝備顯示等級、強化、詞條；寵物顯示成長階段、培育等級、鑑定狀態、正負詞條", gm.listings.length > 0 && gm.listings.every((l) => l.cat === "item") && ge2.listings.length > 0 && ge2.listings.every((l) => l.cat === "equipment" && l.eq && typeof l.eq.level === "number" && typeof l.eq.enhance === "number") && gp.listings.length > 0 && gp.listings.every((l) => l.cat === "pet" && l.pet && l.pet.stage && typeof l.pet.breed === "number") && gp.listings.some((l) => l.pet.affixes.includes("positive") && l.pet.affixes.includes("negative")), { item: gm.listings.length, eq: ge2.listings, pet: gp.listings });
        check("星願商會：購買成功；掛賣後物品鎖定（寵物暫停成長）、不能再掛賣；取消後解鎖", gb.last?.ok && gl.last?.ok && lockedInv.inv.some((i) => i.locked && i.frozen === true) && gc.last?.ok, { buy: gb.last, list: gl.last, inv: lockedInv.inv, cancel: gc.last });
        check("星願商會：售出後收益扣手續費、領取一次", ge3.earn && ge3.earn.pending === 300 - Math.floor(300 * 0.05) && gcl.last?.ok, { earn: ge3.earn, claim: gcl.last });
        if (mode.includes("portrait")) check("星願商會：iPhone 直向沒有橫向捲動", gcl.hScroll <= 0, { hScroll: gcl.hScroll });
      }
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
      const met = await V(() => window.__starwishVillage.meetMerchant());
      check("洛恩：靠近 2.5 m 內可以對話", met === "merchant", met);
      await page.waitForTimeout(600);
      const m1 = await V(() => window.__starwishVillage.interact());
      check("洛恩：對話時停止巡走（暫停中）並開啟商人選單", m1?.talking && m1.merchantPaused && m1.panelOpen, m1);
      await shot(page, "merchant_talk");
      // 介面按鈕用 DOM 點擊（HQ 軟體繪圖約 1 FPS，Playwright 的「元素穩定」判定會逾時；點擊處理程式相同）
      const tap = (sel) => page.evaluate((q) => { const b = document.querySelector(q); if (!b) return false; b.click(); return true; }, sel);
      const menu = await page.evaluate(() => [...document.querySelectorAll('[data-act^="choose:"]')].map((b) => b.getAttribute("data-act")));
      check("洛恩選單：寵物鑑定、飼料購買、寵物進化、寵物復活、培育指南 五項服務入口", ["appraise", "feed", "evolve", "revive", "guide"].every((k) => menu.includes(`choose:${k}`)), menu);
      if (!(await tap('[data-act="choose:appraise"]'))) run.errors.push("appraise button missing");
      await page.waitForFunction(() => window.__starwishVillage.appraisal()?.phase === "empty", null, { timeout: 15000 }).catch(() => null);
      await shot(page, "appraise_1_open");
      if (!(await tap('.pa-win [data-id="s1"]'))) run.errors.push("tile missing");
      await page.waitForTimeout(500);
      await shot(page, "appraise_2_placed");
      const a1 = await V(() => window.__starwishVillage.appraisal());
      // 連點兩次：第二次在鎖定中必須被忽略
      if (!(await tap('.pa-win [data-act="start"]'))) run.errors.push("start missing");
      await tap('.pa-win [data-act="start"]');
      await page.waitForTimeout(3400);
      await shot(page, "appraise_3_result");
      const a2 = await V(() => window.__starwishVillage.appraisal());
      check("寵物鑑定：放入後可鑑定；連點只鑑定一次；結果逐條顯示；物品留在背包並變成已鑑定", a1?.phase === "ready" && a2?.phase === "result" && a2.items.length === a1.items.length && a2.items.find((i) => i.id === "s1")?.appraised === true && a2.lines.length > 0, { before: a1?.phase, after: a2?.phase, lines: a2?.lines });
      const hs = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const sb = await page.evaluate(() => document.querySelector('.pa-win [data-act="start"]')?.getBoundingClientRect().bottom ?? 9999);
      if (mode.includes("portrait")) check("iPhone 直向：鑑定視窗沒有橫向捲動、按鈕在畫面內", hs <= 0 && sb <= vp.height, { hScroll: hs, startBottom: sb });
      await tap('.pa-win [data-act="close"]');
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
