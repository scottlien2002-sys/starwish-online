// W1 端對端測試：開啟建置後的遊戲（dist），在 iPhone 尺寸下實際操作。
// 用法：node tests/e2e/run-e2e.mjs dist [chromium,webkit]
// 注意：這是 Linux 無頭瀏覽器 + 軟體繪圖，FPS 只供參考，不代表 iPhone 實機效能。
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, safeAreaCss, serve } from "./static-server.mjs";

const distDir = process.argv[2] ?? "dist";
const browsers = (process.argv[3] ?? "chromium,webkit").split(",");
const outDir = new URL("../../test-results/e2e/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

const VIEWPORTS = [
  { name: "iPhone 15 橫向", width: 852, height: 393, safe: { top: 0, right: 59, bottom: 21, left: 59 } },
  { name: "iPhone SE 直向", width: 375, height: 667, safe: { top: 20, right: 0, bottom: 0, left: 0 } },
];

const pw = await loadPlaywright();
const server = await serve(distDir);
const report = { startedAt: new Date().toISOString(), runs: [] };
let failures = 0;

for (const name of browsers) {
  let browser;
  try {
    browser = await pw[name].launch();
  } catch (e) {
    report.runs.push({ browser: name, ok: false, error: `無法啟動瀏覽器：${e.message}` });
    failures++;
    continue;
  }
  for (const vp of VIEWPORTS) {
    const run = { browser: name, viewport: vp.name, checks: {}, errors: [] };
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };

    try {
      await page.goto(server.url + "/", { waitUntil: "load" });
      await page.addStyleTag({ content: safeAreaCss(vp.safe) });
      const ready = await page
        .waitForFunction(() => window.__starwish?.ready === true || document.querySelector(".boot-status.error"), null, { timeout: 45000 })
        .then(() => page.evaluate(() => window.__starwish?.ready === true))
        .catch(() => false);
      const bootError = await page.evaluate(() => document.querySelector(".boot-status.error")?.textContent ?? null);
      check("啟動", ready, bootError ?? "ok");
      if (!ready) throw new Error("遊戲未啟動");

      await page.waitForTimeout(1500);
      const renderer = await page.evaluate(() => window.__starwish.renderer());
      const pixels = await page.evaluate(() => window.__starwish.pixelStats());
      check("3D 畫面有繪製", pixels.distinctColors >= 20 && pixels.opaqueRatio > 0.3, { renderer, pixels });

      const issues = await page.evaluate((s) => window.__starwish.hudIssues(s), vp.safe);
      check("HUD 不重疊/不超出安全區", issues.length === 0, issues);

      // ---- 預覽測試：星露啵啵 V2 接入新手草原（只在第一個尺寸跑完整戰鬥，節省時間）----
      const mons0 = await page.evaluate(() => window.__starwish.monsters());
      const dists = mons0.map((m) => Math.hypot(m.spawnX, m.spawnZ)); // 生成點距出生點（怪物可能已開始巡邏/追擊）
      check(
        "草原：3 隻星露啵啵生成於出生點前方 6–9 公尺且看得到",
        mons0.length === 3 && mons0.every((m) => m.hp === m.maxHp) && mons0.filter((m) => m.visible).length >= 2 && dists.every((d) => d >= 6 - 1e-6 && d <= 9 + 1e-6),
        { mons0, dists },
      );
      if (vp === VIEWPORTS[0]) {
        const target = mons0[0].id;
        const near = async () => {
          const m = (await page.evaluate(() => window.__starwish.monsters())).find((x) => x.id === target);
          await page.evaluate(([x, z]) => window.__starwish.teleport(x, z), [m.x + 1, m.z]);
          return m;
        };
        await near();
        await page.waitForTimeout(200);
        const a1 = await page.evaluate(() => window.__starwish.attack());
        const a2 = await page.evaluate(() => window.__starwish.attack());
        const afterOne = (await page.evaluate(() => window.__starwish.monsters())).find((x) => x.id === target);
        check("草原：鎖定並攻擊、冷卻內不重複攻擊", a1.ok === true && a1.targetId === target && a2.ok === false && a2.reason === "cooldown" && afterOne.hp === afterOne.maxHp - a1.damage, { a1, a2, afterOne });
        // 持續攻擊直到擊敗（每 1.05 秒一下，最多 8 次）
        let killed = false;
        const log = [];
        // 軟體繪圖下遊戲時間可能比真實時間慢，冷卻中就稍候重試（冷卻回應本身也驗證了不會重複攻擊）
        for (let k = 0; k < 40 && !killed; k++) {
          await page.waitForTimeout(300);
          const st = await page.evaluate(() => window.__starwish.combat());
          if (st.down) await page.waitForFunction(() => !window.__starwish.combat().down, null, { timeout: 8000 });
          await near();
          const r = await page.evaluate(() => window.__starwish.attack());
          if (r.ok || r.reason !== "cooldown") log.push(r);
          if (r.ok && r.targetId !== target) break; // 鎖定應維持在同一隻
          if (r.ok && r.killed) killed = true;
        }
        const dying = (await page.evaluate(() => window.__starwish.monsters())).find((x) => x.id === target);
        check("草原：鎖定同一隻並擊敗（播放死亡）", killed && log.filter((r) => r.ok).every((r) => r.targetId === target) && (dying.state === "death" || dying.state === "dead") && dying.hp === 0, { log, dying });
        // 死亡中不可再被攻擊（會改打其他怪或沒有目標，不會打到死亡的這隻）
        const again = await page.evaluate(() => window.__starwish.attack());
        check("草原：死亡中的怪物不會被重複攻擊", !(again.ok && again.targetId === target), again);
        // 重生：死亡動畫 + respawnTime 10 秒 + 重生動畫
        await page.evaluate(() => window.__starwish.teleport(0, 0));
        const respawned = await page
          .waitForFunction(
            (id) => {
              const m = window.__starwish.monsters().find((x) => x.id === id);
              return m && m.hp === m.maxHp && (m.state === "idle" || m.state === "move");
            },
            target,
            // 遊戲時間約 13 秒（死亡 1.5 + 等待 10 + 重生 1.6）；軟體繪圖下遊戲時間比真實時間慢，留足餘裕
            { timeout: 45000, polling: 250 },
          )
          .then(() => true)
          .catch(() => false);
        const afterRespawn = await page.evaluate(() => window.__starwish.monsters());
        check("草原：死亡後重生並回到待機/移動", respawned, afterRespawn);
        const cs = await page.evaluate(() => window.__starwish.combat());
        check("草原：怪物攻擊會打到玩家（扣暫定攻擊力 8）", cs.hitsTaken > 0, cs);
        const stuck = afterRespawn.filter((m) => !["idle", "move", "attack", "hit", "death", "dead", "respawn"].includes(m.state));
        check("草原：多隻同時存在、無異常狀態", afterRespawn.length === 3 && stuck.length === 0, afterRespawn);
        // 怪物圍住玩家時彼此不重疊、不擠進玩家身體
        await page.waitForFunction(() => !window.__starwish.combat().down, null, { timeout: 8000 }).catch(() => {});
        const mid = afterRespawn[0];
        await page.evaluate(([x, z]) => window.__starwish.teleport(x, z), [mid.spawnX * 0.6, mid.spawnZ * 0.6]);
        await page.waitForTimeout(3500);
        const pl = await page.evaluate(() => window.__starwish.getPlayer());
        const ring = (await page.evaluate(() => window.__starwish.monsters())).filter((m) => m.state !== "death" && m.state !== "dead" && m.state !== "respawn");
        let minPair = Infinity, minToPlayer = Infinity;
        for (let i = 0; i < ring.length; i++) {
          minToPlayer = Math.min(minToPlayer, Math.hypot(ring[i].x - pl.x, ring[i].z - pl.z));
          for (let j = i + 1; j < ring.length; j++) minPair = Math.min(minPair, Math.hypot(ring[i].x - ring[j].x, ring[i].z - ring[j].z));
        }
        check("草原：多隻怪物不疊在一起、不擠進玩家", ring.length < 2 || (minPair >= 0.9 && minToPlayer >= 0.8), { minPair, minToPlayer, ring, pl });
        // 玩家 HP 歸零：真的倒在地上、不能移動；2 秒後在出生點站起、HP 全滿
        await page.evaluate(() => window.__starwish.knockDown());
        await page.waitForTimeout(700);
        const downA = await page.evaluate(() => ({ c: window.__starwish.combat(), p: window.__starwish.getPlayer() }));
        await page.evaluate(() => window.__starwish.setMove({ x: 0, y: 1 }));
        await page.waitForTimeout(400);
        await page.evaluate(() => window.__starwish.setMove(null));
        const downB = await page.evaluate(() => ({ c: window.__starwish.combat(), p: window.__starwish.getPlayer() }));
        const stillDown = downB.c.down;
        check(
          "草原：玩家 HP 歸零時倒地且不能移動",
          downA.c.down && downA.c.hp === 0 && downA.c.tilt > 1.2 && (!stillDown || Math.hypot(downB.p.x - downA.p.x, downB.p.z - downA.p.z) < 0.01),
          { downA, downB },
        );
        const revived = await page
          .waitForFunction(() => !window.__starwish.combat().down, null, { timeout: 10000, polling: 100 })
          .then(() => true)
          .catch(() => false);
        await page.waitForTimeout(200);
        const up = await page.evaluate(() => ({ c: window.__starwish.combat(), p: window.__starwish.getPlayer() }));
        check("草原：倒地後在出生點站起、HP 全滿", revived && up.c.hp === up.c.maxHp && up.c.tilt < 0.01 && Math.hypot(up.p.x, up.p.z) < 1.5, up);
        // 確保後續移動測試時玩家不在倒地狀態
        await page.waitForFunction(() => !window.__starwish.combat().down, null, { timeout: 5000 }).catch(() => {});
        await page.evaluate(() => window.__starwish.teleport(0, 0));
      }

      // 搖桿往上推 1.2 秒，角色應前進
      const p0 = await page.evaluate(() => window.__starwish.getPlayer());
      const zone = await page.locator(".hud-joystick-zone").boundingBox();
      const sx = zone.x + zone.width * 0.4;
      const sy = zone.y + zone.height * 0.6;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(sx, sy - 70, { steps: 5 });
      await page.waitForTimeout(1200);
      await page.mouse.up();
      const p1 = await page.evaluate(() => window.__starwish.getPlayer());
      const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      check("搖桿移動角色", moved > 2, { from: p0, to: p1, moved });

      // 在畫面空白處拖曳，攝影機應旋轉
      const c0 = await page.evaluate(() => window.__starwish.getCamera());
      const cx = vp.width * 0.6;
      const cy = vp.height * 0.32;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 120, cy, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const c1 = await page.evaluate(() => window.__starwish.getCamera());
      check("拖曳旋轉攝影機", Math.abs(c1.alpha - c0.alpha) > 0.3, { before: c0.alpha, after: c1.alpha });

      // 技能按鈕可按且有回饋
      await page.locator('[data-slot="attack"]').click();
      const toastShown = await page.locator(".hud-toast.show").count();
      check("攻擊按鈕可按", toastShown > 0, null);

      // 持續移動 3 秒取樣 FPS（僅供參考）
      await page.evaluate(() => window.__starwish.setMove({ x: 0.3, y: 1 }));
      const fpsSamples = [];
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(500);
        fpsSamples.push(await page.evaluate(() => window.__starwish.fps()));
      }
      await page.evaluate(() => window.__starwish.setMove(null));
      run.fpsReference = fpsSamples;

      const shot = `${outDir}${name}_${vp.name.replace(/\s+/g, "_")}.png`;
      await page.screenshot({ path: shot });
      run.screenshot = shot.split("/test-results/")[1];
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }

    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 6;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${vp.name}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}`);
    for (const e of run.errors) console.log(`   ! ${e}`);
    if (run.fpsReference) console.log(`   FPS(參考): ${run.fpsReference.map((f) => f.toFixed(0)).join(", ")}`);
    await ctx.close();
  }
  // ---------- 單隻怪物測試頁：星露啵啵（程式化）、測試方塊（GLB）----------
  for (const slug of ["bobo", "dummy"]) {
    const vp = VIEWPORTS[0];
    const run = { browser: name, viewport: `${vp.name} / ?lab=${slug}`, checks: {}, errors: [], screenshots: [] };
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };
    const req = (a) => page.evaluate((x) => window.__starwishLab.request(x), a);
    const state = () => page.evaluate(() => window.__starwishLab.state());
    const shot = async (label) => {
      const f = `${outDir}${name}_${slug}_${label}.png`;
      await page.screenshot({ path: f });
      run.screenshots.push(f.split("/test-results/")[1]);
    };
    try {
      await page.goto(server.url + `/?lab=${slug}`, { waitUntil: "load" });
      await page.addStyleTag({ content: safeAreaCss(vp.safe) });
      const ready = await page
        .waitForFunction(() => window.__starwishLab?.ready === true, null, { timeout: 45000 })
        .then(() => true)
        .catch(() => false);
      check("場景啟動", ready, null);
      if (!ready) throw new Error("lab 未啟動");
      await page.waitForTimeout(1200);
      await shot("1_idle");
      check("介面不重疊", (await page.evaluate((s) => window.__starwishLab.hudIssues(s), vp.safe)).length === 0, null);

      await req("move");
      await page.waitForTimeout(450);
      await shot("2_move");
      await page.waitForTimeout(200);
      await shot("2b_move");
      check("移動", (await state()) === "move", await state());

      // 注意：先檢查狀態、再截圖。軟體繪圖下截圖可能花 1~2 秒，期間動畫照常進行。
      // 用同一次 evaluate 連續送出請求，避免頁面往返時間讓 0.8 秒的攻擊提早結束。
      const atk = await page.evaluate(() => {
        const L = window.__starwishLab;
        const a1 = L.request("attack");
        const a2 = L.request("attack");
        const queued = L.request("move");
        const overlay = L.request("hit");
        return { a1, a2, queued, overlay, state: L.state() };
      });
      check("攻擊：可發動、攻擊中不可重複、移動排隊", atk.a1.accepted && !atk.a2.accepted && atk.queued.queued === true, atk);
      check("攻擊中受擊為疊加", atk.overlay.overlay === true && atk.state === "attack", atk.overlay);
      await page.waitForTimeout(330);
      await shot("3_attack");
      await page.waitForFunction(() => window.__starwishLab.state() === "move", null, { timeout: 8000 }).catch(() => {});
      check("攻擊結束回到移動", (await state()) === "move", await state());

      await req("idle");
      await page.waitForTimeout(300);
      const hitState = await page.evaluate(() => {
        window.__starwishLab.request("hit");
        return window.__starwishLab.state();
      });
      check("受傷", hitState === "hit", hitState);
      await page.waitForTimeout(80);
      await shot("4_hit");
      await page.waitForFunction(() => window.__starwishLab.state() === "idle", null, { timeout: 8000 }).catch(() => {});

      await req("death");
      await page.waitForTimeout(700);
      await shot("5_death");
      const blocked = await Promise.all(["attack", "move", "hit"].map(req));
      await page.waitForFunction(() => window.__starwishLab.state() === "dead", null, { timeout: 10000 }).catch(() => {});
      check("死亡：不可攻擊/移動/受擊，播完進入 dead", blocked.every((r) => !r.accepted) && (await state()) === "dead", blocked);

      await req("respawn");
      await page.waitForTimeout(800);
      await shot("6_respawn");
      await page.waitForFunction(() => window.__starwishLab.state() === "idle", null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(300);
      const pose = await page.evaluate(() => window.__starwishLab.pose());
      check("重生後恢復完整", (await state()) === "idle" && Math.abs(pose.opacity - 1) < 1e-6 && Math.abs(pose.scaleY - 1) < 0.06, { state: await state(), pose });
      run.fpsReference = [await page.evaluate(() => window.__starwishLab.fps())];
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 9;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${run.viewport}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}`);
    for (const e of run.errors) console.log(`   ! ${e}`);
    await ctx.close();
  }

  // ---------- 多怪物 AI 測試場（3 隻星露啵啵 + 2 隻 GLB 測試方塊）----------
  {
    const vp = VIEWPORTS[0];
    const run = { browser: name, viewport: `${vp.name} / ?lab=field`, checks: {}, errors: [], screenshots: [] };
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };
    const list = () => page.evaluate(() => window.__starwishField.monsters());
    try {
      await page.goto(server.url + "/?lab=field", { waitUntil: "load" });
      await page.addStyleTag({ content: safeAreaCss(vp.safe) });
      const ready = await page
        .waitForFunction(() => window.__starwishField?.ready === true, null, { timeout: 60000 })
        .then(() => true)
        .catch(() => false);
      check("場景啟動（含 GLB 載入）", ready, null);
      if (!ready) throw new Error("field 未啟動");
      const ms = await list();
      check("同時生成 5 隻怪物（3 程式化 + 2 GLB）", ms.length === 5 && ms.filter((m) => m.monsterId === "test_dummy").length === 2, ms.map((m) => m.id));
      check("介面不重疊", (await page.evaluate((s) => window.__starwishField.hudIssues(s), vp.safe)).length === 0, null);

      // 把目標放到第一隻星露啵啵旁邊 → 應追擊或攻擊
      const bobo = ms.find((m) => m.monsterId === "star_dew_bobo");
      await page.evaluate((p) => window.__starwishField.setTarget(p), { x: bobo.x + 3, z: bobo.z });
      const engaged = await page
        .waitForFunction((id) => ["chase", "attack"].includes(window.__starwishField.monsters().find((m) => m.id === id).mode), bobo.id, { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      check("AI：目標靠近時追擊/攻擊", engaged, (await list()).find((m) => m.id === bobo.id));
      await page.screenshot({ path: `${outDir}${name}_field_1_engage.png` });
      run.screenshots.push(`e2e/${name}_field_1_engage.png`);

      // 連續攻擊最近的怪物直到死亡
      let killedId = null;
      for (let i = 0; i < 10 && !killedId; i++) {
        const id = await page.evaluate(() => window.__starwishField.damageNearest(30));
        const m = (await list()).find((x) => x.id === id);
        if (m && (m.state === "death" || m.state === "dead")) killedId = id;
        await page.waitForTimeout(150);
      }
      check("受傷→死亡", killedId !== null, killedId);
      const deadOk = await page
        .waitForFunction((id) => window.__starwishField.monsters().find((m) => m.id === id).mode === "dead", killedId, { timeout: 10000 })
        .then(() => true)
        .catch(() => false);
      check("AI：死亡後停止行動", deadOk, (await list()).find((m) => m.id === killedId));

      // 目標移到遠處 → 其他怪物應返回或恢復待機/巡邏
      await page.evaluate(() => window.__starwishField.setTarget({ x: 0, z: 40 }));
      const calmed = await page
        .waitForFunction(() => window.__starwishField.monsters().every((m) => !["chase", "attack"].includes(m.mode)), null, { timeout: 30000 })
        .then(() => true)
        .catch(() => false);
      check("AI：目標離開後不再追擊", calmed, (await list()).map((m) => `${m.id}:${m.mode}`));
      await page.screenshot({ path: `${outDir}${name}_field_2_after.png` });
      run.screenshots.push(`e2e/${name}_field_2_after.png`);
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 7;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${run.viewport}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}`);
    for (const e of run.errors) console.log(`   ! ${e}`);
    await ctx.close();
  }

  // ---- 星露啵啵 V3 模型預覽（?lab=bobo3）：只檢查外觀頁可正常運作，不涉及戰鬥 ----
  // V3（對照基準）與 V3.1（美術精修）都檢查
  // 3 隻同場的 Draw Calls（同一瀏覽器、同一畫面大小），用來確認 V3.5 不高於 V3.4
  const drawCalls3 = {};
  for (const labName of ["bobo3", "bobo31", "bobo32", "bobo33", "bobo34", "bobo35", "bobo36", "bobo37", "bobo38", "bobo38r"])
  for (const vp of VIEWPORTS) {
    const run = { browser: name, viewport: `${vp.name} / ?lab=${labName}`, checks: {}, errors: [] };
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => (m.type() === "error" || m.text().includes("[bobo3]")) && run.errors.push(`console: ${m.text()}`));
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };
    try {
      await page.goto(server.url + `/?lab=${labName}`, { waitUntil: "load" });
      await page.addStyleTag({ content: safeAreaCss(vp.safe) });
      const ready = await page.waitForFunction(() => window.__bobo3?.ready === true, null, { timeout: 60000 }).then(() => true).catch(() => false);
      check("V3 模型載入（GLB）", ready, await page.evaluate(() => document.getElementById("boot-status")?.textContent ?? null));
      if (!ready) throw new Error("bobo3 未啟動");
      const info = await page.evaluate(() => window.__bobo3.info());
      check("零件齊全（身體、眼睛、嘴、腮紅、星星）", info.meshes.length === 5 && info.meshes.every((m) => m.triangles > 0), info);
      const uvs = [];
      for (const e of ["normal", "happy", "curious", "angry", "scared", "dizzy", "sleepy", "hurt"]) {
        await page.evaluate((x) => window.__bobo3.setExpression(x), e);
        uvs.push((await page.evaluate(() => window.__bobo3.eyeUV0())).map((v) => Math.round(v * 1000) / 1000).join(","));
      }
      check("表情切換確實改變眼睛貼圖（8 種各不相同）", new Set(uvs).size === 8, uvs);
      for (const v of ["front", "side", "back"]) await page.evaluate((x) => window.__bobo3.setView(x), v);
      await page.evaluate(() => window.__bobo3.setCount(3));
      await page.waitForTimeout(800);
      const perf = await page.evaluate(() => window.__bobo3.perf());
      check("8 種表情、三視圖、3 隻同場可切換且無錯誤", run.errors.length === 0, perf);
      check("果凍材質著色器正常（中／高畫質）", perf.quality === "low" || perf.jelly === true, perf);
      check("載入的是正確版本", perf.variant === { bobo3: "v3", bobo31: "v31", bobo32: "v32", bobo33: "v33", bobo34: "v34", bobo35: "v35", bobo36: "v36", bobo37: "v37", bobo38: "v38", bobo38r: "v38r" }[labName], perf.variant);
      if (labName === "bobo33") {
        // 必須真的載入 V3.3 模型檔，且腹部星星來自模型資料（V3.2 外徑 0.084 × 0.85 = 0.0714）
        check(
          "V3.3：載入 bobo_v33 模型，腹部星星取自模型（0.0714）",
          /^bobo_v33_(high|medium|low)\.glb$/.test(perf.file) && perf.bellyStarVersion === "3.3" && Math.abs(perf.bellyStar?.outer - 0.0714) < 1e-6,
          { file: perf.file, star: perf.bellyStar, v: perf.bellyStarVersion },
        );
      }
      drawCalls3[`${labName}|${vp.name}`] = perf.drawCalls;
      if (labName === "bobo38") {
        check(
          "V3.8：載入 bobo_v38 模型（共用載入器），腹部星星尺寸維持 0.0714、高度 0.24",
          /^bobo_v38_(high|medium|low)\.glb$/.test(perf.file) && Math.abs(perf.bellyStar?.outer - 0.0714) < 1e-6 && Math.abs(perf.bellyStar?.centerY - 0.24) < 1e-6,
          { file: perf.file, star: perf.bellyStar },
        );
        check("V3.8：不使用陰影貼圖與 GlowLayer", perf.shadowMap === false && perf.glowLayer === false, perf);
        const d37 = drawCalls3[`bobo37|${vp.name}`];
        check("V3.8：3 隻同場 Draw Calls 不高於 V3.7（≤25）", typeof d37 === "number" && perf.drawCalls <= d37 && perf.drawCalls <= 25, { v38: perf.drawCalls, v37: d37 });
        const ref = await page.evaluate(async () => {
          const api = window.__monsterLab;
          api.setRefMode(true);
          await new Promise((r) => setTimeout(r, 300));
          const on = api.perf().refMode;
          api.setRefMode(false);
          await new Promise((r) => setTimeout(r, 300));
          return { on, off: api.perf().refMode };
        });
        check("設定圖對照模式可切換並恢復", ref.on === true && ref.off === false && run.errors.length === 0, ref);
        if (vp === VIEWPORTS[0]) {
          const rows = await page.evaluate(() => window.__bobo3.costAnalysis(1));
          await page.evaluate(() => document.querySelector(".v3-bench-result") && (document.querySelector(".v3-bench-result").hidden = true));
          check("成本分析：6 項都有結果", rows.length === 6 && rows.every((r) => r.avg > 0), rows);
        }
      }
      if (labName === "bobo38r") {
        check("V3.8R：載入 bobo_v38r 模型（共用載入器）", /^bobo_v38r_(high|medium|low)\.glb$/.test(perf.file), perf.file);
        check("V3.8R：灰模模式（不顯示臉部、無陰影貼圖與 GlowLayer）", perf.grey === true && perf.faceVisible === false && perf.shadowMap === false && perf.glowLayer === false, perf);
        const d38 = drawCalls3[`bobo38|${vp.name}`];
        check("V3.8R：3 隻同場 Draw Calls 不高於 V3.8（≤25）", typeof d38 === "number" && perf.drawCalls <= d38 && perf.drawCalls <= 25, { v38r: perf.drawCalls, v38: d38 });
        const views = await page.evaluate(async () => {
          const api = window.__monsterLab;
          api.setCount(1);
          const out = [];
          for (const v of ["front", "side", "back", "q45", "top"]) {
            api.setView(v);
            await new Promise((r) => setTimeout(r, 120));
            out.push(v);
          }
          api.setRefMode(true);
          await new Promise((r) => setTimeout(r, 200));
          const on = api.perf().refMode;
          api.setRefMode(false);
          api.setView("front");
          api.setCount(3); // 之後的效能測試要 3 隻同場
          return { out, on, off: api.perf().refMode };
        });
        check("V3.8R：五個視角（正面、側面、背面、45 度、俯視）與對照模式可切換", views.out.length === 5 && views.on === true && views.off === false && run.errors.length === 0, views);
        const btns = await page.evaluate(() => ["front", "side", "back", "q45", "top"].every((v) => !!document.querySelector(`[data-view="${v}"]`)));
        check("V3.8R：頁面有五個視角按鈕", btns, btns);
      }
      if (labName === "bobo37") {
        check(
          "V3.7：載入 bobo_v37 模型（共用載入器），腹部星星維持 0.0714",
          /^bobo_v37_(high|medium|low)\.glb$/.test(perf.file) && Math.abs(perf.bellyStar?.outer - 0.0714) < 1e-6 && Math.abs(perf.bellyStar?.centerY - 0.24) < 1e-6,
          { file: perf.file, star: perf.bellyStar },
        );
        check("V3.7：不使用陰影貼圖與 GlowLayer", perf.shadowMap === false && perf.glowLayer === false, perf);
        const d36 = drawCalls3[`bobo36|${vp.name}`];
        check("V3.7：3 隻同場 Draw Calls 不高於 V3.6（≤25）", typeof d36 === "number" && perf.drawCalls <= d36 && perf.drawCalls <= 25, { v37: perf.drawCalls, v36: d36 });
        // 設定圖對照模式：切換後背景與鏡頭改變，切回後恢復；效能測試會自動切回一般模式
        const ref = await page.evaluate(async () => {
          const api = window.__monsterLab;
          api.setRefMode(true);
          await new Promise((r) => setTimeout(r, 300));
          const on = api.perf().refMode;
          api.setRefMode(false);
          await new Promise((r) => setTimeout(r, 300));
          return { on, off: api.perf().refMode };
        });
        check("設定圖對照模式可切換並恢復", ref.on === true && ref.off === false && run.errors.length === 0, ref);
        if (vp === VIEWPORTS[0]) {
          const rows = await page.evaluate(() => window.__bobo3.costAnalysis(1));
          await page.evaluate(() => document.querySelector(".v3-bench-result") && (document.querySelector(".v3-bench-result").hidden = true));
          check("成本分析：6 項都有結果", rows.length === 6 && rows.every((r) => r.avg > 0), rows);
        }
      }
      if (labName === "bobo36") {
        check(
          "V3.6：載入 bobo_v36 模型（共用載入器），腹部星星維持 0.0714",
          /^bobo_v36_(high|medium|low)\.glb$/.test(perf.file) && Math.abs(perf.bellyStar?.outer - 0.0714) < 1e-6 && Math.abs(perf.bellyStar?.centerY - 0.24) < 1e-6,
          { file: perf.file, star: perf.bellyStar },
        );
        check("V3.6：不使用陰影貼圖與 GlowLayer（沿用 V3.5 繪製方式）", perf.shadowMap === false && perf.glowLayer === false, perf);
        const d35 = drawCalls3[`bobo35|${vp.name}`];
        check("V3.6：3 隻同場 Draw Calls 不高於 V3.5", typeof d35 === "number" && perf.drawCalls <= d35, { v36: perf.drawCalls, v35: d35 });
        const alias = await page.evaluate(() => window.__monsterLab === window.__bobo3);
        check("共用測試介面 __monsterLab 可用", alias, alias);
        if (vp === VIEWPORTS[0]) {
          const rows = await page.evaluate(() => window.__bobo3.costAnalysis(1));
          await page.evaluate(() => document.querySelector(".v3-bench-result") && (document.querySelector(".v3-bench-result").hidden = true));
          check("成本分析（共用流程）：6 項都有結果與差值", rows.length === 6 && rows.every((r) => r.avg > 0 && typeof r.gain === "number"), rows);
        }
      }
      if (labName === "bobo35") {
        check(
          "V3.5：載入 bobo_v35 模型，腹部星星維持 0.0714",
          /^bobo_v35_(high|medium|low)\.glb$/.test(perf.file) && Math.abs(perf.bellyStar?.outer - 0.0714) < 1e-6,
          { file: perf.file, star: perf.bellyStar },
        );
        check("V3.5：不使用陰影貼圖與 GlowLayer（改用接觸陰影與星星光暈）", perf.shadowMap === false && perf.glowLayer === false, perf);
        const d34 = drawCalls3[`bobo34|${vp.name}`];
        check("V3.5：3 隻同場 Draw Calls 不高於 V3.4", typeof d34 === "number" && perf.drawCalls <= d34, { v35: perf.drawCalls, v34: d34 });
        if (vp === VIEWPORTS[0]) {
          const rows = await page.evaluate(() => window.__bobo3.costAnalysis(1));
          await page.evaluate(() => document.querySelector(".v3-bench-result") && (document.querySelector(".v3-bench-result").hidden = true));
          check("成本分析：6 項都有結果", rows.length === 6 && rows.every((r) => r.avg > 0), rows);
        }
      }
      if (labName === "bobo34") {
        // V3.4 必須載入自己的模型檔，腹部星星固定 V3.3 尺寸 0.0714（不得放大）
        check(
          "V3.4：載入 bobo_v34 模型，腹部星星維持 0.0714",
          /^bobo_v34_(high|medium|low)\.glb$/.test(perf.file) && Math.abs(perf.bellyStar?.outer - 0.0714) < 1e-6,
          { file: perf.file, star: perf.bellyStar, v: perf.bellyStarVersion },
        );
      }
      if (labName === "bobo32") {
        check("V3.2 保持不變（腹部星星 0.084）", Math.abs(perf.bellyStar?.outer - 0.084) < 1e-6 && /^bobo_v31_/.test(perf.file), { file: perf.file, star: perf.bellyStar });
      }
      // 按鈕不得互相覆蓋（含右上角畫質按鈕），效能測試按鈕必須點得到
      const overlaps = await page.evaluate(() => {
        const els = [...document.querySelectorAll("#hud-root button, .lab-title, .lab-fps")].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
        });
        const out = [];
        const name = (e) => e.dataset.layout || e.className || e.textContent;
        for (let i = 0; i < els.length; i++)
          for (let j = i + 1; j < els.length; j++) {
            if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
            const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 1 && oy > 1) out.push(`${name(els[i])} × ${name(els[j])}`);
          }
        const btn = document.querySelector(".v3-bench");
        const r = btn.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { overlaps: out, benchOnTop: top === btn || btn.contains(top), inView: r.bottom <= innerHeight && r.right <= innerWidth };
      });
      check("按鈕不重疊、效能測試按鈕可點", overlaps.overlaps.length === 0 && overlaps.benchOnTop && overlaps.inView, overlaps);
      // 實際點擊 10 秒效能測試：只測目前驗收的兩版（舊版已在各自分支完整測過；避免 CI 超時）
      if (vp === VIEWPORTS[0] && (labName === "bobo38" || labName === "bobo38r")) {
        await page.evaluate(() => document.querySelector(".v3-bench").click());
        const r = await page.waitForFunction(() => !document.querySelector(".v3-bench-result").hidden, null, { timeout: 120000 }).then(() => page.evaluate(() => document.querySelector(".v3-bench-result").innerText)).catch(() => null);
        check("點擊效能測試：10 秒後顯示平均／最慢 1%／最低 FPS 與 Draw Calls", !!r && /平均/.test(r) && /最慢 1%/.test(r) && /最低/.test(r) && /Draw Calls/.test(r) && /3 隻/.test(r) && (labName === "bobo3" || (labName === "bobo38r" ? /bobo_v38r_/.test(r) : labName === "bobo38" ? /bobo_v38_/.test(r) : labName === "bobo37" ? /bobo_v37_/.test(r) : labName === "bobo36" ? /bobo_v36_/.test(r) : labName === "bobo35" ? /bobo_v35_/.test(r) : labName === "bobo34" ? /bobo_v34_/.test(r) : labName === "bobo33" ? /bobo_v33_/.test(r) : /bobo_v31_/.test(r))), r);
      }
      if (labName === "bobo36" || labName === "bobo37" || labName === "bobo38" || labName === "bobo38r") {
        // 共用載入器：釋放後場景中不應留下任何怪物零件
        const rel = await page.evaluate(() => window.__bobo3.releaseModels());
        check("共用載入器釋放資源：零件全部移除", !!rel && rel.before >= 5 && rel.after === 0, rel);
      }
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 6;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${run.viewport}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}`);
    for (const e of run.errors) console.log(`   ! ${e}`);
    await ctx.close();
  }

  await browser.close();
}

await server.close();
report.finishedAt = new Date().toISOString();
report.failures = failures;
writeFileSync(`${outDir}report.json`, JSON.stringify(report, null, 2));
console.log(failures ? `\n${failures} 項失敗` : "\n全部通過");
process.exit(failures ? 1 : 0);
