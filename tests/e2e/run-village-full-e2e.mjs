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

// Stage 6.4：三段畫質（高／中／低）× iPhone 直向；高、中再測橫向（WebKit 只測直向）
const MODES = [
  ["high-portrait", "high", { width: 390, height: 844 }],
  ["medium-portrait", "medium", { width: 390, height: 844 }],
  ["low-portrait", "low", { width: 390, height: 844 }],
  ["high-landscape", "high", { width: 844, height: 390 }],
  ["medium-landscape", "medium", { width: 844, height: 390 }],
];
const TIER_EXPECT = {
  high: { models: "hq", shadow: "pcf1024", map: 1024, res: 1.25, msaa: 4, post: true, dcMax: 160, triMax: 250000, npcMax: 12000, pmMax: 15000 },
  medium: { models: "lite", shadow: "pcf1024", map: 1024, res: 1.25, msaa: 2, post: true, dcMax: 120, triMax: 100000, npcMax: 6500, pmMax: 6500 },
  low: { models: "lite", shadow: "blob", map: 0, res: 1, msaa: 1, post: false, dcMax: 100, triMax: 100000, npcMax: 6500, pmMax: 6500 },
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
    const lod = q === "high" ? "hq" : "lite";
    const X = TIER_EXPECT[q];
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
    // 資源請求：同一個模型／貼圖不得重複請求；不得有 4xx／5xx
    const reqCount = new Map();
    const badResp = [];
    page.on("request", (r) => { const u = r.url(); if (/\.(glb|png|jpg|ktx2)(\?|$)/.test(u)) reqCount.set(u, (reqCount.get(u) ?? 0) + 1); });
    page.on("response", (r) => { if (r.status() >= 400) badResp.push(`${r.status()} ${r.url()}`); });
    const V = (fn, arg) => page.evaluate(fn, arg);
    try {
      // Stage 6.5：中畫質用女生角色（男女都驗證）
      const gender = q === "medium" ? "female" : "male";
      await page.goto(server.url + `/?map=village&art=full&quality=${q}&g=${gender}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__starwishVillage?.ready === true, null, { timeout: 120000 });
      await page.waitForFunction(() => { const a = window.__starwishVillage.artFull(); return a.status === "loaded" || a.status.startsWith("部分") || a.status.startsWith("error"); }, null, { timeout: 420000 });
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
        const ps = await V(() => window.__starwishVillage.perfState());
        perf[k].casters = ps.casters;
        perf[k].breakdown = await V(() => window.__starwishVillage.perfBreakdown());
        await shot(page, `view_${k}`);
      }
      run.results.perf = Object.fromEntries(Object.entries(perf).map(([k, v]) => [k, { drawCalls: v.drawCalls, triangles: v.triangles, casters: v.casters }]));
      run.results.breakdown = Object.fromEntries(Object.entries(perf).map(([k, v]) => [k, v.breakdown]));
      const pstate = await V(() => window.__starwishVillage.perfState());
      run.results.perfState = { cfg: pstate.cfg, shadow: pstate.shadow, npcStats: pstate.npcStats, merchant: pstate.merchant, pixelRatio: pstate.pixelRatio, render: pstate.render };
      run.results.dataSource = "CI 軟體繪圖（不是 iPhone 實機）";
      {
        const ti = await V(() => window.__starwishVillage.tier());
        const rs = await V(() => window.__starwishVillage.renderState());
        run.results.tier = ti;
        run.results.renderState = rs;
        check(`Stage 6.4 ${q} 畫質：模型 ${X.models}、陰影 ${X.shadow}（陰影貼圖 ${X.map || "不使用"}）、解析度上限 ${X.res}x、MSAA 要求 ${X.msaa}x、HDR 關、後製 ${X.post ? "開" : "關"}`, ti.tier === q && ti.models === X.models && rs.shadow === X.shadow && rs.shadowMapSize === X.map && rs.res.requestedMax === X.res && rs.msaa.requested === X.msaa && rs.hdr === false && rs.post === X.post && (rs.msaa.pipeline === null) === !X.post, { ti, rs });
        check("MSAA 實際生效值有回報（要求、管線、渲染目標、裝置上限、生效值）", typeof rs.msaa.effective === "number" && rs.msaa.effective >= 1 && rs.msaa.effective <= X.msaa, rs.msaa);
        check(`角色面數：NPC ≤ ${X.npcMax}、洛恩 ≤ ${X.pmMax}，並有遠距模型（≤ 4000）`, pstate.merchant && pstate.merchant.triangles <= X.pmMax && pstate.merchant.farTriangles > 0 && pstate.merchant.farTriangles <= 4000 && Object.values(pstate.npcStats).every((n) => n.triangles <= X.npcMax && n.farTriangles > 0 && n.farTriangles <= 4000), { merchant: pstate.merchant, npc: pstate.npcStats });
        if (X.map) check("陰影投射物依距離剔除（至少一個位置本幀投射物少於全部）", Object.values(perf).some((v) => v.casters.active < v.casters.total), Object.fromEntries(Object.entries(perf).map(([k, v]) => [k, v.casters])));
        const avgTri = Object.values(perf).reduce((a, v) => a + v.triangles, 0) / Object.values(perf).length;
        run.results.avgTriangles = Math.round(avgTri);
        // 驗收標準以 iPhone 直向巡迴為準：直向（與高畫質橫向）列入檢查；中畫質橫向視野較寬，只記錄數字、在報告中如實列出
        if (mode.includes("portrait") || q === "high") check(`平均每幀三角面 ≤ ${X.triMax}（四個位置平均；含陰影貼圖繪製）`, avgTri <= X.triMax, { avg: Math.round(avgTri), perf: Object.fromEntries(Object.entries(perf).map(([k, v]) => [k, v.triangles])) });
        else run.results.landscapeTrianglesInfo = { avg: Math.round(avgTri), budgetPortrait: X.triMax };
        const rep0 = await V(() => window.__starwishVillage.report());
        check("報告讀取實際生效的渲染參數（陰影、解析度、framebuffer、HWS、DPR、MSAA、快取）", /陰影（實際）/.test(rep0) && rep0.includes(X.shadow === "blob" ? "柔和腳底陰影" : "PCF 1024") && !/PCSS 2048/.test(rep0) && /解析度（實際）：要求上限/.test(rep0) && /framebuffer/.test(rep0) && /Hardware Scaling/.test(rep0) && /裝置 DPR/.test(rep0) && /抗鋸齒（實際）/.test(rep0) && /模型與貼圖/.test(rep0), rep0.split("\n").slice(0, 12));
      }
      const dcMax = X.dcMax;
      check(`繪製次數 ≤ ${dcMax}（全村整合、${q} 畫質、任何位置）`, Object.values(perf).every((v) => v.drawCalls <= dcMax), run.results.perf);
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
        if (n.id !== "board" && mode === "high-portrait") await shot(page, `npc_${n.id}`);
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
        if (mode === "high-portrait") await shot(page, "guild_2_market_equipment");
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
        if (mode === "high-portrait") await shot(page, "guild_4_listing_price");
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
        if (mode === "high-portrait" && (p.id === "south" || p.id === "east")) await shot(page, `portal_${p.id}`);
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
      // ---------------- Stage 6.4 功能回歸 ----------------
      // NPC 距離 LOD：站在 NPC 前 2 m → 近距模型；站到村莊另一側 → 遠距模型
      {
        const nb = (await V(() => window.__starwishVillage.layout().npcs)).find((n) => n.id === "mage");
        await V(([a, b, c]) => window.__starwishVillage.teleport(a, b, c), [nb.x + Math.sin(nb.yaw) * 2, nb.z + Math.cos(nb.yaw) * 2, ((nb.yaw + Math.PI) * 180) / Math.PI]);
        await settle(page, 4);
        const near = (await V(() => window.__starwishVillage.perfState())).npcs.mage;
        await V(([a, b]) => window.__starwishVillage.teleport(a, b, 180), [-nb.x * 0.9, -nb.z * 0.9]);
        await settle(page, 4);
        const far = (await V(() => window.__starwishVillage.perfState())).npcs.mage;
        run.results.lod = { near, far };
        check("NPC 距離 LOD：靠近用近距模型、遠離用遠距模型（有遲滯，不會來回閃）", near.lod === 0 && far.lod === 1, { near, far });
      }
      // ---------------- Stage 6.5 正式玩家角色＋寵物跟隨 ----------------
      {
        await page.waitForFunction(() => { const c = window.__starwishVillage.charState(); return c.status === "loaded" || String(c.status).startsWith("error"); }, null, { timeout: 240000, polling: 500 });
        await V(() => window.__starwishVillage.teleport(0, -16, 0));
        await settle(page, 4);
        const c0 = await V(() => window.__starwishVillage.charState());
        const st = c0.stats;
        run.results.character = { status: c0.status, model: st?.model, triangles: st?.triangles, meshes: st?.meshes, drawMeshes: st?.drawMeshes, bones: st?.bones, animations: st?.animations, shadow: st?.shadow, draws: c0.draws, pet: st?.pet, loadMs: st?.loadMs };
        const wantFile = `novice_c10b5b_${gender}_${X.models}.glb`;
        check(`正式玩家角色：Claude A 初心者 C1.0-B5b ${wantFile}（${q} 畫質＝${X.models === "hq" ? "HQ" : "Lite"}），簡易角色已隱藏`, c0.status === "loaded" && st && st.model === wantFile && st.gender === gender && !c0.simpleVisible && st.bones === 17, { status: c0.status, model: st?.model, simpleVisible: c0.simpleVisible, bones: st?.bones });
        check("正式動作齊全：待機、跑步、跳躍（技能用）、攻擊、受傷、死亡", st && ["Idle", "Run", "Jump", "Attack", "Hurt", "Death"].every((a) => st.animations.includes(a)), st?.animations);
        check("角色陰影依畫質：高／中＝即時陰影、低＝柔和腳底陰影", st && st.shadow === (X.map ? "即時陰影（陰影貼圖）" : "柔和腳底陰影") && (X.map ? c0.draws.shadow >= 1 : c0.draws.shadow === 0) && c0.draws.main >= 1, { shadow: st?.shadow, draws: c0.draws });
        // 跑步：往前推搖桿 → Run；放開 → Idle
        await V(() => window.__starwishVillage.setMove({ x: 0, y: 1 }));
        await settle(page, 8);
        const cRun = await V(() => window.__starwishVillage.charState());
        await V(() => window.__starwishVillage.setMove(null));
        await settle(page, 8);
        const cIdle = await V(() => window.__starwishVillage.charState());
        check("移動時播放跑步動作（依實際速度調整步頻），停下回到待機", cRun.anim === "Run" && cRun.speed > 0.5 && cIdle.anim === "Idle", { run: [cRun.anim, cRun.speed, cRun.runRate], idle: cIdle.anim });
        // 攻擊（HUD 攻擊鈕）、受傷、死亡（不能移動）、復活
        const acts = {};
        await page.evaluate(() => document.querySelector('[data-slot="attack"]')?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
        await settle(page, 2);
        acts.attackButton = (await V(() => window.__starwishVillage.charState())).anim;
        await settle(page, 12);
        await V(() => window.__starwishVillage.charAction("hurt"));
        await settle(page, 2);
        acts.hurt = (await V(() => window.__starwishVillage.charState())).anim;
        await settle(page, 12);
        await V(() => window.__starwishVillage.charAction("die"));
        await settle(page, 25);
        const pd0 = (await V(() => window.__starwishVillage.player()));
        await V(() => window.__starwishVillage.setMove({ x: 0, y: 1 }));
        await settle(page, 6);
        const pd1 = (await V(() => window.__starwishVillage.player()));
        await V(() => window.__starwishVillage.setMove(null));
        acts.die = (await V(() => window.__starwishVillage.charState())).anim;
        acts.movedWhileDead = Math.hypot(pd1.x - pd0.x, pd1.z - pd0.z);
        await V(() => window.__starwishVillage.charAction("revive"));
        await settle(page, 4);
        acts.revive = (await V(() => window.__starwishVillage.charState())).anim;
        await V(() => window.__starwishVillage.charAction("jump"));
        await settle(page, 2);
        acts.skillJump = (await V(() => window.__starwishVillage.charState())).anim;
        await settle(page, 15);
        acts.jumpButtons = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => /跳/.test(b.textContent ?? "") || /jump/i.test(b.className + (b.dataset.slot ?? ""))).length);
        run.results.characterActions = acts;
        check("攻擊鈕→攻擊動作；受傷、死亡（死亡時不能移動）、復活動作正常", acts.attackButton === "Attack" && acts.hurt === "Hurt" && acts.die === "Death" && acts.movedWhileDead < 0.01 && acts.revive === "Idle", acts);
        check("一般移動沒有跳躍按鈕；跳躍動作保留給技能（程式觸發可播放）", acts.jumpButtons === 0 && acts.skillJump === "Jump", acts);
        // 寵物跟隨：停著時在耳朵旁；跑步＋快速轉身（前後左右來回）後，寵物沒有貼住或穿進角色
        await V(() => window.__starwishVillage.teleport(0, -16, 0));
        await V(() => window.__starwishVillage.setPet("bird4"));
        await settle(page, 20);
        const still = await V(() => window.__starwishVillage.charState());
        const earDist = still.pet && still.pos ? Math.hypot(still.pet.x - still.pos.x, still.pet.z - still.pos.z) : null;
        const earUp = still.pet && still.pos ? still.pet.y - still.pos.y : null;
        for (const mv of [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }]) {
          await V((m) => window.__starwishVillage.setMove(m), mv);
          await settle(page, 6);
        }
        await V(() => window.__starwishVillage.setMove(null));
        await settle(page, 10);
        const after = await V(() => window.__starwishVillage.charState());
        const pet = after.stats?.pet;
        run.results.pet = { still: { horizontal: earDist, height: earUp }, pet };
        check("寵物在角色耳朵旁（停著時水平距離 0.15～0.6 m、高度在頭部附近 0.6～1.3 m）", still.pet?.visible && earDist !== null && earDist > 0.15 && earDist < 0.6 && earUp > 0.6 && earUp < 1.3, { earDist, earUp });
        check("寵物不貼住、不穿透角色：跑步與快速轉身後，與頭部／身體的最小間距 ≥ 2 cm（含 B 端間距保護）", pet && pet.minGapCm !== null && pet.minGapCm >= 1.9, pet);
        const rep1 = await V(() => window.__starwishVillage.report());
        check("效能報告列出玩家角色與寵物的模型版本、三角面、Draw Calls", /玩家角色：Claude A 正式初心者 C1\.0-B5b/.test(rep1) && /novice_c10b5b_/.test(rep1) && /寵物：/.test(rep1) && /Draw Calls：主畫面/.test(rep1), rep1.split("\n").filter((l) => /玩家角色|寵物/.test(l)));
      }
      // 星願之泉／傳送門動畫：兩次取樣，星晶或光效在動
      {
        await V(() => window.__starwishVillage.teleport(0, -12.5, 0));
        const a1 = await V(() => window.__starwishVillage.animProbe());
        await page.waitForTimeout(1500);
        await settle(page, 3);
        const a2 = await V(() => window.__starwishVillage.animProbe());
        const moved = a1.some((x, k) => a2[k] && (Math.abs(a2[k].ry - x.ry) > 1e-4 || Math.abs(a2[k].y - x.y) > 1e-4));
        run.results.anim = { a1, a2 };
        check("星願之泉星晶動畫（旋轉＋上下浮動）持續播放", a1.some((x) => /crystal/i.test(x.name)) && moved, { a1, a2 });
      }
      // 出生點與復活點：24 個都可站立，傳送後高度貼地
      {
        const lay = await V(() => window.__starwishVillage.layout());
        const okStand = await V((pts) => pts.map((p) => window.__starwishVillage.standable(p.x, p.z)), lay.respawn);
        const sp = lay.respawn[0];
        await V(([a, b]) => window.__starwishVillage.teleport(a, b, 0), [sp.x, sp.z]);
        const pl = await V(() => window.__starwishVillage.player());
        const arr = lay.arrival;
        await V(([a, b]) => window.__starwishVillage.teleport(a, b, 0), [arr.x, arr.z]);
        const pa = await V(() => window.__starwishVillage.player());
        check("出生點／復活點 24 個都可站立；傳送到復活點與南門抵達點正常", lay.respawn.length === 24 && okStand.every(Boolean) && Math.hypot(pl.x - sp.x, pl.z - sp.z) < 0.01 && Math.hypot(pa.x - arr.x, pa.z - arr.z) < 0.01, { n: lay.respawn.length, bad: okStand.filter((x) => !x).length });
      }
      // 鏡頭避障：站在 NPC 站位面向廣場（鏡頭在建築那一側）→ 至少一處鏡頭距離被縮短
      {
        const npcs2 = await V(() => window.__starwishVillage.layout().npcs);
        const cams = [];
        for (const n of npcs2.filter((x) => x.id !== "board")) {
          await V(([a, b, c]) => window.__starwishVillage.teleport(a, b, c), [n.x, n.z, (n.yaw * 180) / Math.PI]);
          await settle(page, 6);
          const c = await V(() => window.__starwishVillage.camera());
          cams.push({ id: n.id, radius: Math.round(c.radius * 100) / 100, desired: Math.round(c.desired * 100) / 100 });
        }
        run.results.cameraObstruct = cams;
        check("鏡頭避障：靠建築時鏡頭距離自動縮短（不穿進建築）", cams.some((c) => c.radius < c.desired - 0.3) && cams.every((c) => c.radius <= c.desired + 0.01), cams);
      }
      // HDR 視覺比較（高、中畫質直向；Chromium）：同一個視角 HDR 關（目前預設）／開 各一張
      if (name === "chromium" && mode.includes("portrait") && q !== "low") {
        await V(() => window.__starwishVillage.view("plaza"));
        await settle(page, 6);
        await shot(page, "hdr_off_plaza");
        await V(() => window.__starwishVillage.setHdr(true));
        await settle(page, 6);
        await shot(page, "hdr_on_plaza");
        await V(() => window.__starwishVillage.setHdr(false));
        await V(() => window.__starwishVillage.view("church"));
        await settle(page, 6);
        await shot(page, "hdr_off_church");
        await V(() => window.__starwishVillage.setHdr(true));
        await settle(page, 6);
        await shot(page, "hdr_on_church");
        await V(() => window.__starwishVillage.setHdr(false));
        await settle(page, 3);
      }
      // 效能診斷：CI 只跑前 2 項（目前基準、解析度 1x），驗證「每項恢復基準」與「報告顯示實際解析度」
      if (name === "chromium" && (mode === "high-portrait" || mode === "medium-portrait")) {
        await V(() => window.__starwishVillage.startDiag(2));
        await page.waitForFunction(() => { const d = window.__starwishVillage.diagState(); return !d.running && d.results && d.results.length === 2; }, null, { timeout: 180000, polling: 500 }).catch(() => null);
        const dg = await V(() => window.__starwishVillage.diagState());
        const rep = await V(() => window.__starwishVillage.report());
        run.results.diag = dg.results;
        const [b0, r1] = dg.results ?? [];
        check("效能診斷：每項開始前恢復基準；報告顯示實際解析度（基準 = 畫質上限、1x 項目 = 1x，framebuffer 不同）", dg.results?.length === 2 && b0.baselineOk && r1.baselineOk && Math.abs(b0.res - X.res) < 0.01 && Math.abs(r1.res - 1) < 0.01 && b0.fb !== r1.fb && b0.locked && r1.locked && /效能診斷/.test(rep) && /這台裝置/.test(rep), dg.results);
        const rs2 = await V(() => window.__starwishVillage.renderState());
        check("診斷結束後恢復基準設定（解析度解除鎖定、陰影與後製回到畫質預設）", !rs2.res.locked && rs2.shadow === X.shadow && rs2.hdr === false && rs2.post === X.post, rs2);
      }
      // 資源：同一個模型／貼圖只請求一次；沒有 4xx／5xx；沒有 WebGL Context Lost
      {
        const dups = [...reqCount].filter(([, n]) => n > 1).map(([u, n]) => `${u.split("/").pop()}×${n}`);
        const info = await V(() => window.__starwishVillage.info());
        run.results.requests = { files: reqCount.size, dups, bad: badResp };
        check("沒有重複的模型／貼圖請求、沒有失敗的資源請求、WebGL Context Lost 0", dups.length === 0 && badResp.length === 0 && info.contextLost === 0, { dups, bad: badResp, contextLost: info.contextLost });
      }
    } catch (e) {
      run.errors.push(String(e.message ?? e));
      failures++;
    }
    run.ok = Object.values(run.checks).every((c) => c.ok) && run.errors.filter((x) => !x.startsWith("console")).length === 0;
    await ctx.close();
  }
  // Stage 6.4 三段畫質切換與偏好保存（用 Grey-box 頁面：畫質邏輯相同、載入快）
  if (name === "chromium") {
    const run = { browser: name, mode: "tier-switch", checks: {}, errors: [], screenshots: [], results: {} };
    report.runs.push(run);
    const check = (k, ok, detail) => {
      run.checks[k] = { ok: !!ok, detail };
      if (!ok) failures++;
    };
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    const V = (fn, arg) => page.evaluate(fn, arg);
    const ready = () => page.waitForFunction(() => window.__starwishVillage?.ready === true, null, { timeout: 120000 });
    try {
      await page.goto(server.url + "/?map=village", { waitUntil: "load" });
      await ready();
      const first = await V(() => window.__starwishVillage.tier());
      check("新玩家（沒有偏好、沒有網址參數）預設中畫質", first.tier === "medium" && first.source === "default" && first.models === "lite", first);
      const seq = [];
      for (const t of ["low", "high", "medium"]) {
        await Promise.all([page.waitForNavigation({ waitUntil: "load" }), V((x) => window.__starwishVillage.switchTier(x), t)]);
        await ready();
        seq.push(await V(() => window.__starwishVillage.tier()));
      }
      check("三段畫質切換：低→高→中，每次模型精細度與設定正確、偏好已保存", seq.map((x) => [x.tier, x.models, x.stored]).join("|") === "low,lite,low|high,hq,high|medium,lite,medium", seq);
      await page.goto(server.url + "/?map=village", { waitUntil: "load" });
      await ready();
      await Promise.all([page.waitForNavigation({ waitUntil: "load" }), V(() => window.__starwishVillage.switchTier("low"))]);
      await ready();
      await page.goto(server.url + "/?map=village", { waitUntil: "load" });
      await ready();
      const kept = await V(() => window.__starwishVillage.tier());
      check("重新整理／重新進入後沿用玩家偏好（網址沒有 quality 參數）", kept.tier === "low" && kept.source === "stored", kept);
      const urlWins = await (async () => {
        await page.goto(server.url + "/?map=village&quality=high", { waitUntil: "load" });
        await ready();
        return V(() => window.__starwishVillage.tier());
      })();
      check("網址 ?quality= 優先於偏好，但不覆寫偏好", urlWins.tier === "high" && urlWins.source === "url" && urlWins.stored === "low", urlWins);
    } catch (e) {
      run.errors.push(String(e.message ?? e));
      failures++;
    }
    run.ok = Object.values(run.checks).every((c) => c.ok) && run.errors.length === 0;
    await ctx.close();
  }
  await browser.close();
}
await server.close();
report.finishedAt = new Date().toISOString();
writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.runs.map((r) => ({ browser: r.browser, mode: r.mode, ok: r.ok, errors: r.errors?.slice(0, 3), checks: Object.fromEntries(Object.entries(r.checks ?? {}).map(([k, v]) => [k, v.ok])) })), null, 1));
if (failures) process.exit(1);
