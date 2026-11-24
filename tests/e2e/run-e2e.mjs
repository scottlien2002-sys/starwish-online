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
        // ---- 玩家攻擊動作：按下 → 蓄力 → 揮擊（此時才扣血）→ 收招 → 回待機 ----
        const idle0 = await page.evaluate(() => window.__starwish.attackState());
        // 按下攻擊的同一個瞬間讀取怪物血量（確認按下時還沒扣血）
        const press = await page.evaluate((id) => {
          const a1 = window.__starwish.attack();
          const a2 = window.__starwish.attack();
          const hp = window.__starwish.monsters().find((x) => x.id === id).hp;
          return { a1, a2, hp };
        }, target);
        const { a1, a2 } = press;
        // 取樣轉向（遊戲時間在軟體繪圖下較慢）
        const samples = [];
        for (let k = 0; k < 80; k++) {
          const st = await page.evaluate(() => window.__starwish.attackState());
          samples.push(st);
          if (!st.attacking && k > 2) break;
          await page.waitForTimeout(40);
        }
        const strikeFacing = samples.filter((x) => x.phase === "strike" && x.facingError !== null).map((x) => x.facingError);
        await page.waitForFunction(() => !window.__starwish.attackState().attacking, null, { timeout: 10000 }).catch(() => {});
        const afterAnim = await page.evaluate(() => window.__starwish.attackState());
        const tr = afterAnim.trace;
        const afterOne = (await page.evaluate(() => window.__starwish.monsters())).find((x) => x.id === target);
        check("草原：待機時呼吸、未攻擊時為待機姿勢", idle0.phase === "idle" && idle0.attacking === false, idle0);
        check(
          "草原：按下攻擊播放蓄力→揮擊→收招，右手明顯揮出、身體前傾",
          a1.ok === true && tr.phases.join(">") === "windup>strike>recover" && tr.maxBack > 0.8 && tr.maxFwd < -1.2 && tr.maxLean > 0.15,
          { a1, tr },
        );
        check(
          "草原：傷害在揮中時結算（按下瞬間不扣血）、冷卻內不重複攻擊",
          a2.ok === false && a2.reason === "cooldown" && press.hp === afterOne.maxHp && (tr.hitPhase === "strike" || tr.hitPhase === "recover") && afterOne.hp === afterOne.maxHp - 20 && afterAnim.lastHit?.ok === true && afterAnim.lastHit.targetId === target && afterAnim.started === idle0.started + 1,
          { a2, atPress: press.hp, afterOne: afterOne.hp, hitPhase: tr.hitPhase, lastHit: afterAnim.lastHit, started: afterAnim.started },
        );
        check("草原：攻擊時轉向目標", strikeFacing.length === 0 || Math.min(...strikeFacing) < 0.35, { strikeFacing });
        check("草原：攻擊結束後回到待機姿勢", afterAnim.attacking === false && afterAnim.phase === "idle" && Math.abs(afterAnim.armRX) < 0.01, afterAnim);

        // 持續攻擊直到擊敗：連續出招不卡住、每次都完整播完、鎖定同一隻
        let killed = false;
        const log = [];
        for (let k = 0; k < 60 && !killed; k++) {
          await page.waitForTimeout(250);
          const st = await page.evaluate(() => window.__starwish.combat());
          if (st.down) await page.waitForFunction(() => !window.__starwish.combat().down, null, { timeout: 8000 });
          await near();
          const r = await page.evaluate(() => window.__starwish.attack());
          if (!r.ok) continue;
          // 等這一招揮中結算
          await page.waitForFunction((n) => window.__starwish.attackState().hits >= n || window.__starwish.attackState().lastHit?.ok === false, log.length + 2, { timeout: 15000 }).catch(() => {});
          const h = (await page.evaluate(() => window.__starwish.attackState())).lastHit;
          log.push({ start: r, hit: h });
          if (r.targetId !== target) break; // 鎖定應維持在同一隻
          if (h?.ok && h.killed) killed = true;
        }
        const endState = await page.waitForFunction(() => !window.__starwish.attackState().attacking, null, { timeout: 10000 }).then(() => page.evaluate(() => window.__starwish.attackState())).catch(() => null);
        check("草原：連續攻擊正常銜接、不卡住", log.length >= 2 && endState !== null && endState.phase === "idle" && endState.started === idle0.started + 1 + log.length, { n: log.length, endState });
        const dying = (await page.evaluate(() => window.__starwish.monsters())).find((x) => x.id === target);
        check("草原：鎖定同一隻並擊敗（播放死亡）", killed && log.every((r) => r.start.targetId === target) && (dying.state === "death" || dying.state === "dead") && dying.hp === 0, { log, dying });
        // 移動中攻擊：邊走邊出招，角色照常移動、動作照常播放
        await page.waitForFunction(() => !window.__starwish.combat().down, null, { timeout: 8000 }).catch(() => {});
        const alive = (await page.evaluate(() => window.__starwish.monsters())).find((x) => x.id !== target && x.state !== "death" && x.state !== "dead");
        let moveAtk = null;
        if (alive) {
          await page.evaluate(([x, z]) => window.__starwish.teleport(x, z), [alive.x + 1.2, alive.z]);
          await page.waitForTimeout(1100);
          const p0 = await page.evaluate(() => window.__starwish.getPlayer());
          await page.evaluate(() => window.__starwish.setMove({ x: 0.3, y: 0.6 }));
          const r = await page.evaluate(() => window.__starwish.attack());
          await page.waitForTimeout(120);
          const mid = await page.evaluate(() => window.__starwish.attackState());
          await page.waitForTimeout(500);
          await page.evaluate(() => window.__starwish.setMove(null));
          const p1 = await page.evaluate(() => window.__starwish.getPlayer());
          await page.waitForFunction(() => !window.__starwish.attackState().attacking, null, { timeout: 10000 }).catch(() => {});
          const end = await page.evaluate(() => window.__starwish.attackState());
          moveAtk = { r, mid, moved: Math.hypot(p1.x - p0.x, p1.z - p0.z), end };
        }
        check(
          "草原：移動中攻擊照常出招、角色照常移動",
          moveAtk !== null && moveAtk.r.ok === true && moveAtk.mid.attacking === true && moveAtk.moved > 0.2 && moveAtk.end.phase === "idle",
          moveAtk,
        );
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
      // 命中提示在揮中時才出現（動作與傷害同步），稍等一下
      const toastShown = await page.waitForSelector(".hud-toast.show", { timeout: 5000 }).then(() => 1).catch(() => 0);
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
        check("V3.8R 第三階段：果凍材質與臉部顯示、腹部星星 0.0714、無陰影貼圖與 GlowLayer", perf.grey === false && perf.faceVisible === true && perf.jelly === (perf.quality !== "low" ? true : perf.jelly) && Math.abs(perf.bellyStar?.outer - 0.0714) < 1e-6 && perf.shadowMap === false && perf.glowLayer === false, perf);
        const greyT = await page.evaluate(async () => {
          const api = window.__monsterLab;
          api.setGrey(true);
          await new Promise((r) => setTimeout(r, 200));
          const on = api.perf();
          api.setGrey(false);
          await new Promise((r) => setTimeout(r, 200));
          const off = api.perf();
          return { onGrey: on.grey, onFace: on.faceVisible, offGrey: off.grey, offFace: off.faceVisible };
        });
        check("V3.8R：第二階段灰模可切換並恢復", greyT.onGrey === true && greyT.onFace === false && greyT.offGrey === false && greyT.offFace === true && run.errors.length === 0, greyT);
        const shape = await page.evaluate(async () => {
          const api = window.__monsterLab;
          api.setAnim("none"); // 動畫會改變外框，比較表情前先靜止
          await new Promise((r) => setTimeout(r, 100));
          const out = [];
          for (const e of ["normal", "happy", "curious", "angry", "scared", "dizzy", "sleepy", "hurt"]) {
            api.setExpression(e);
            await new Promise((r) => setTimeout(r, 60));
            out.push(api.bodyExtent().join(","));
          }
          api.setExpression("normal");
          return out;
        });
        check("V3.8R：8 種表情切換時身體外型不變", new Set(shape).size === 1, shape[0]);
        const an = await page.evaluate(async () => {
          const api = window.__monsterLab;
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          api.setAnim("idle");
          await wait(400);
          const p1 = api.animPose();
          await wait(700);
          const p2 = api.animPose();
          const live = api.perf().anim;
          api.setAnim("none");
          await wait(200);
          const rest = api.animPose();
          api.setAnim("idle");
          return { p1, p2, live, rest };
        });
        check(
          "V3.8R 第四階段：待機動畫播放中（伸縮維持體積、星星跟著觸角、可切回靜止）",
          an.live === "idle" &&
            Math.abs(an.p1.sy - an.p2.sy) > 1e-4 &&
            Math.abs(an.p1.sy * an.p1.sxz * an.p1.sxz - 1) < 1e-6 &&
            Math.abs(an.p2.sy - 1) < 0.05 &&
            Math.abs(an.rest.scaleY - 1) < 1e-9 &&
            an.rest.starX === 0 &&
            run.errors.length === 0,
          an,
        );
        const mv = await page.evaluate(async () => {
          const api = window.__monsterLab;
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          api.setCount(1);
          api.setAnim("move");
          // 軟體繪圖下幀率很低且不穩：取 1.6 秒內的多個樣本，逐段檢查「有前進的那一段」方向與朝向一致
          const samples = [];
          for (let i = 0; i < 32; i++) {
            await wait(50);
            samples.push(api.animState());
          }
          const a = samples[0];
          const maxLift = Math.max(...samples.map((q) => q.lift));
          const minY = Math.min(...samples.map((q) => q.y));
          let path = 0;
          let segs = 0;
          let aligned = 0;
          for (let i = 1; i < samples.length; i++) {
            const p0 = samples[i - 1];
            const p1 = samples[i];
            const dx = p1.x - p0.x;
            const dz = p1.z - p0.z;
            const len = Math.hypot(dx, dz);
            path += len;
            if (len > 0.005) {
              segs++;
              if ((dx * Math.sin(p1.yaw) + dz * Math.cos(p1.yaw)) / len > 0.8) aligned++;
            }
          }
          const b = api.animState();
          api.setAnim("idle");
          await wait(2000); // 先跳完這一跳、落地回彈，再淡入待機（低幀率時動畫時間比實際時間慢）
          const c = api.animState();
          await wait(400);
          const d = api.animState();
          api.setCount(3);
          return { a, b, c, d, maxLift, minY, path, segs, aligned };
        });
        {
          check(
            "V3.8R 第四階段：移動（彈跳離地、前進方向與朝向一致、不穿地）",
            mv.a.anim === "move" && mv.path > 0.05 && mv.segs > 0 && mv.aligned / mv.segs >= 0.8 && mv.maxLift > 0.02 && mv.minY >= 0 && run.errors.length === 0,
            { path: mv.path, segs: mv.segs, aligned: mv.aligned, maxLift: mv.maxLift, minY: mv.minY },
          );
          check(
            "V3.8R 第四階段：停止移動後接回待機（落地、不再前進）",
            mv.c.anim === "idle" && mv.c.lift === 0 && Math.hypot(mv.d.x - mv.c.x, mv.d.z - mv.c.z) < 1e-6,
            { c: mv.c, d: mv.d },
          );
        }
        const at = await page.evaluate(async () => {
          const api = window.__monsterLab;
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          api.setCount(1);
          api.setAnim("idle");
          await wait(500);
          const before = api.animState();
          // 實際播放一次：檢查攻擊中換表情、播完回待機與原位
          api.setAnim("attack");
          const s = [];
          for (let i = 0; i < 30; i++) {
            await wait(40);
            s.push(api.animState());
          }
          await wait(1500);
          const after = api.animState();
          // 三階段姿勢用停格檢查（軟體繪圖下幀率很低，實際播放可能剛好跳過蓄力最深那幾格）
          const hold = async (t) => {
            api.holdAnimAt(t);
            await wait(150);
            return api.animState();
          };
          api.setAnim("attack");
          const windup = await hold(0.34);
          const strike = await hold(0.48);
          const end = await hold(0.95);
          api.setAnim("idle");
          api.setCount(3);
          return { before, s, after, windup, strike, end };
        });
        {
          const atk = at.s.filter((q) => q.anim === "attack");
          const w = at.windup;
          const k = at.strike;
          const dot = k.fwd > 0 ? ((k.x - k.bx) * Math.sin(k.yaw) + (k.z - k.bz) * Math.cos(k.yaw)) / k.fwd : 0;
          check(
            "V3.8R 第四階段：攻擊（蓄力壓扁後縮 → 往前拉長彈擊 → 回彈；攻擊中換生氣表情）",
            atk.length > 0 &&
              atk.some((q) => q.angry) &&
              w.sy < 0.85 && w.fwd < -0.05 &&
              k.fwd > 0.18 && k.sfwd > 1.1 && Math.abs(dot - 1) < 0.01 &&
              Math.abs(at.end.fwd) < 1e-9 && at.end.sy === 1 &&
              run.errors.length === 0,
            { n: atk.length, windup: { sy: w.sy, fwd: w.fwd }, strike: { fwd: k.fwd, sfwd: k.sfwd, dot }, end: { fwd: at.end.fwd, sy: at.end.sy } },
          );
          check(
            "V3.8R 第四階段：攻擊後回到待機、回到原位、換回原本表情",
            at.after.anim === "idle" && !at.after.angry && Math.abs(at.after.fwd) < 1e-6 && Math.hypot(at.after.x - at.before.x, at.after.z - at.before.z) < 1e-3,
            at.after,
          );
        }
        const hu = await page.evaluate(async () => {
          const api = window.__monsterLab;
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          api.setCount(1);
          api.setExpression("curious"); // 受傷後要換回受傷前的表情（不是一般）
          api.setAnim("idle");
          await wait(500);
          const before = api.animState();
          api.hurt();
          const s = [];
          for (let i = 0; i < 24; i++) {
            await wait(40);
            s.push(api.animState());
          }
          await wait(1500);
          const after = api.animState();
          // 移動中受擊 → 受傷 → 回待機
          api.setAnim("move");
          await wait(400);
          api.hurt();
          await wait(80);
          const midMove = api.animState();
          await wait(1800);
          const afterMove = api.animState();
          // 生命值歸零 → 由死亡接管
          api.hurt(true);
          await wait(300);
          const down = api.animState();
          api.setAnim("none");
          api.setExpression("normal");
          api.setAnim("idle");
          api.setCount(3);
          return { before, s, after, midMove, afterMove, down };
        });
        {
          const h = hu.s.filter((q) => q.anim === "hurt");
          const minSy = Math.min(...h.map((q) => q.sy));
          const minFwd = Math.min(...h.map((q) => q.fwd));
          const minY = Math.min(...hu.s.map((q) => q.y));
          check(
            "V3.8R 第四階段：受傷（壓縮 ≤12%、後退、不穿地、受傷表情）",
            h.length > 2 && minSy >= 0.875 && minSy < 0.97 && minFwd < -0.02 && minFwd >= -0.081 && minY >= 0 && h.some((q) => q.face === "hurt") && run.errors.length === 0,
            { n: h.length, minSy, minFwd, minY },
          );
          const a = hu.after;
          check(
            "V3.8R 第四階段：受傷後回待機、回原位、無位移殘留、換回受傷前表情（好奇）",
            a.anim === "idle" && a.face === "curious" && a.fwd === 0 && a.sfwd === 1 && Math.hypot(a.bx - hu.before.bx, a.bz - hu.before.bz) < 1e-9 && Math.hypot(a.x - a.bx, a.z - a.bz) < 1e-9,
            a,
          );
          check(
            "V3.8R 第四階段：移動中受擊會被打斷並回待機；生命值歸零由死亡接管",
            hu.midMove.anim === "hurt" && hu.afterMove.anim === "idle" && hu.afterMove.y === 0 && (hu.down.anim === "death" || hu.down.anim === "dead"),
            { midMove: hu.midMove.anim, afterMove: hu.afterMove.anim, down: hu.down.anim },
          );
        }
        const de = await page.evaluate(async () => {
          const api = window.__monsterLab;
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          api.setAnim("none");
          api.setCount(3);
          api.setAnim("idle");
          await wait(400);
          const res0 = api.resourceCounts();
          // 只讓第 1 隻死亡：其他兩隻不受影響
          api.death(0);
          await wait(200);
          const early = api.animStateOf(0);
          const t0 = api.animState();
          api.hurt(); // 死亡期間再受擊：不重播（只會讓另外兩隻受傷）
          api.death(0);
          api.command("move", 0); // 死亡期間不接受移動、攻擊
          api.command("attack", 0);
          const mid = [];
          for (let i = 0; i < 10; i++) {
            await wait(110);
            mid.push(api.resourceCounts());
          }
          const midState = api.animStateOf(0);
          await wait(2600); // 1.8 秒播完後保持死亡
          const dead = api.animStateOf(0);
          const others = [api.animStateOf(1), api.animStateOf(2)];
          const resDead = api.resourceCounts();
          // 反覆死亡／重生 3 次：資源不累積
          for (let r = 0; r < 3; r++) {
            api.respawn();
            await wait(200);
            api.death();
            await wait(2300);
          }
          api.respawn();
          await wait(400);
          const res1 = api.resourceCounts();
          const back = api.animStateOf(0);
          api.setAnim("idle");
          return { res0, early, t0, mid, midState, dead, others, resDead, res1, back };
        });
        {
          const maxDust = Math.max(...de.mid.map((r) => r.dust));
          check(
            "V3.8R 第四階段：死亡（只有那一隻、打斷待機、再受擊與指令不影響、播完保持死亡且不可見、不回待機）",
            de.early.anim === "death" &&
              (de.midState.anim === "death" || de.midState.anim === "dead") &&
              de.dead.anim === "dead" && de.dead.visibility === 0 &&
              de.others.every((o) => o.anim !== "death" && o.anim !== "dead" && o.visibility === 1) &&
              run.errors.length === 0,
            { early: de.early, mid: de.midState, dead: de.dead, others: de.others },
          );
          check(
            "V3.8R 第四階段：星塵粒子 6～10 顆、死亡結束後全部清除；重生後完整恢復；反覆死亡不累積資源",
            maxDust >= 6 && maxDust <= 10 &&
              de.resDead.dust === 0 && de.resDead.starMatClones === 1 &&
              de.res1.dust === 0 && de.res1.starMatClones === 0 &&
              de.res1.materials === de.res0.materials && de.res1.textures <= de.res0.textures + 1 && de.res1.meshes === de.res0.meshes && de.res1.sprites === de.res0.sprites &&
              de.back.anim !== "dead" && de.back.visibility === 1,
            { maxDust, res0: de.res0, resDead: de.resDead, res1: de.res1, back: de.back },
          );
        }
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

  // ---------- Stage 5.1：正式遊戲場景 + V3.8R 整合適配器（?bobo=v38r；預設仍是 V2）----------
  {
    const vp = VIEWPORTS[0];
    const run = { browser: name, viewport: `${vp.name} / 遊戲 ?bobo=v38r`, checks: {}, errors: [], screenshots: [] };
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };
    try {
      await page.goto(server.url + "/?bobo=v38r", { waitUntil: "load" });
      await page.addStyleTag({ content: safeAreaCss(vp.safe) });
      const ready = await page
        .waitForFunction(() => window.__starwish?.ready === true || document.querySelector(".boot-status.error"), null, { timeout: 45000 })
        .then(() => page.evaluate(() => window.__starwish?.ready === true))
        .catch(() => false);
      check("啟動（?bobo=v38r）", ready, "ok");
      if (!ready) throw new Error("遊戲未啟動");
      const allLoaded = await page
        .waitForFunction(async () => {
          const b = await window.__starwish.bobo();
          return b.visuals.length === 3 && b.visuals.every((v) => v.v38r && v.loaded);
        }, null, { timeout: 45000, polling: 250 })
        .then(() => true)
        .catch(() => false);
      await page.waitForTimeout(1200);
      const b = await page.evaluate(() => window.__starwish.bobo());
      check("三隻都改用 V3.8R 並載入完成", allLoaded && b.variant === "v38r" && b.modelId === "star_dew_bobo_v38r", b.visuals);
      const q = (await page.evaluate(() => window.__starwish.perf())).quality ?? null;
      check(
        "GLB 只載入一次（同一份共用資源、3 隻實例）",
        b.loadedAssets.length === 1 && b.loadedAssets[0].live === 3 && b.loadedAssets[0].refs === 3 && /^bobo_v38r_(high|medium|low)\.glb$/.test(b.loadedAssets[0].file),
        { loadedAssets: b.loadedAssets, quality: q },
      );
      const matIds = new Set(b.visuals.map((v) => v.bodyMaterialId));
      const geoIds = new Set(b.visuals.map((v) => v.geometryId));
      check("每隻身體材質獨立、幾何共用", matIds.size === 3 && !matIds.has(null) && geoIds.size === 1 && !geoIds.has(null), { matIds: [...matIds], geoIds: [...geoIds] });
      // 同一次讀取（同一幀）比對模型與邏輯位置；分兩次讀會因巡邏移動而有落差
      const pair = await page.evaluate(async () => ({ vis: (await window.__starwish.bobo()).visuals, mons: window.__starwish.monsters() }));
      const mons = pair.mons;
      const posOk = pair.vis.every((v, i) => v.position && Math.hypot(v.position[0] - mons[i].x, v.position[2] - mons[i].z) < 0.02 && Math.abs(v.position[1] - mons[i].y) < 0.02);
      check("模型位置跟著遊戲怪物（框架 setTransform）", posOk, { visual: pair.vis.map((v) => v.position), logic: mons.map((m) => [m.x, m.y, m.z]) });
      const pixels = await page.evaluate(() => window.__starwish.pixelStats());
      check("3D 畫面有繪製、至少一隻在畫面內", pixels.distinctColors >= 20 && pixels.opaqueRatio > 0.3 && mons.some((m) => m.visible), { pixels, visible: mons.map((m) => m.visible) });
      const st = await page.evaluate(() => window.__starwish.boboAdapterSelfTest());
      const same = (x, y) => Object.keys(x).every((k) => x[k] === y[k]);
      check(
        "另建一隻再移除：資源數回到原值、共用資源未被釋放",
        st && !st.skipped && same(st.before, st.after) && st.during.materials === st.before.materials + 1 && st.during.meshes > st.before.meshes && st.sharedAlive.length === 1 && st.sharedAlive.every(Boolean),
        st,
      );
      const after = await page.evaluate(() => window.__starwish.bobo());
      check("自我檢查後原本 3 隻不受影響", after.loadedAssets[0]?.live === 3 && after.visuals.every((v) => v.loaded && v.enabled), after.loadedAssets);
      const f = `${outDir}${name}_game_bobo_v38r.png`;
      await page.screenshot({ path: f });
      run.screenshots.push(f.split("/test-results/")[1]);
      // 回退：不加參數 = V2，完全不載入 V3.8R
      await page.goto(server.url + "/", { waitUntil: "load" });
      await page.waitForFunction(() => window.__starwish?.ready === true, null, { timeout: 45000 });
      const v2 = await page.evaluate(() => window.__starwish.bobo());
      check("預設（不加參數）仍是 V2、不載入 V3.8R", v2.variant === "v2" && v2.loadedAssets.length === 0 && v2.visuals.every((v) => !v.v38r), v2);
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 9;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${run.viewport}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 600)}`);
    for (const e of run.errors) console.log(`   ! ${e}`);
    await ctx.close();
  }

  // ---------- V3.8R 畫質比對：同場景、同鏡頭、同位置、同表情；高畫質另拍「修正前」（發光層開啟）----------
  {
    const vp = VIEWPORTS[0];
    const run = { browser: name, viewport: `${vp.name} / 遊戲 V3.8R 畫質比對`, checks: {}, errors: [], screenshots: [], photo: [] };
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };
    const variants = [
      { q: "high", glow: undefined, label: "high" },
      { q: "high", glow: undefined, label: "high_shadowq_original", extra: "&shadowq=original" },
      { q: "medium", glow: undefined, label: "medium" },
      { q: "low", glow: undefined, label: "low" },
    ];
    for (const v of variants) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => run.errors.push(`${v.label} pageerror: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && run.errors.push(`${v.label} console: ${m.text()}`));
      try {
        await page.goto(server.url + `/?bobo=v38r&quality=${v.q}${v.extra ?? ""}`, { waitUntil: "load" });
        await page.addStyleTag({ content: safeAreaCss(vp.safe) + " .toast, .hud-toast { display: none !important; }" });
        await page.waitForFunction(() => window.__starwish?.ready === true, null, { timeout: 45000 });
        await page.waitForFunction(async () => (await window.__starwish.bobo()).visuals.every((x) => x.loaded), null, { timeout: 45000, polling: 250 });
        const staged = await page.evaluate((g) => window.__starwish.stageBoboPhoto(g === undefined ? {} : { glow: g }), v.glow);
        await page.waitForTimeout(2500);
        const perf = await page.evaluate(() => window.__starwish.perf());
        const res = await page.evaluate(async () => (await window.__starwish.bobo()).scene);
        const renderer = await page.evaluate(() => window.__starwish.renderer());
        const exp = await page.evaluate(() => window.__starwish.renderExperiments());
        const f = `${outDir}${name}_photo_${v.label}.png`;
        await page.screenshot({ path: f });
        run.screenshots.push(f.split("/test-results/")[1]);
        run.photo.push({ label: v.label, quality: v.q, staged, perf, resources: res, renderer, exp, file: f.split("/test-results/")[1] });
      } catch (e) {
        run.errors.push(`${v.label} exception: ${e.message}`);
      }
      await ctx.close();
    }
    const by = (l) => run.photo.find((p) => p.label === l);
    {
      const a = by("high"), b = by("high_shadowq_original");
      // Babylon：QUALITY_HIGH = 0、QUALITY_MEDIUM = 1
      check(
        "V3.8R 高畫質預設 PCSS32（柔和陰影中品質，MSAA 4x、HDR 不變）；?shadowq=original 回退為原本高品質；Draw Calls 相同",
        !!a && !!b && a.exp.tag === "" && a.exp.shadowQuality === 1 && a.exp.msaa === 4 && a.exp.hdr === true && a.exp.shadowEnabled === true &&
          b.exp.tag === "shadowq:original" && b.exp.shadowQuality === 0 && b.exp.msaa === 4 && b.exp.hdr === true && b.exp.shadowEnabled === true && Math.abs(b.perf.drawCalls - a.perf.drawCalls) <= 1, // 單一瞬間讀取的 Draw Calls 可能差 1
        { def: a && a.exp, original: b && b.exp, draw: [a && a.perf.drawCalls, b && b.perf.drawCalls] },
      );
    }
    for (const l of ["high", "medium", "low"]) {
      const p = by(l);
      check(`${l}：V3.8R 模式發光層停用、畫質正確`, !!p && p.perf.quality === l && p.perf.bloom === false && p.staged.glow !== true, p && { bloom: p.perf.bloom, glow: p.staged.glow });
    }
    // 回退檢查：V2 模式發光層仍照舊（只影響 V3.8R 模式）
    {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
      const page = await ctx.newPage();
      try {
        await page.goto(server.url + `/?quality=high`, { waitUntil: "load" });
        await page.waitForFunction(() => window.__starwish?.ready === true, null, { timeout: 45000 });
        const perf = await page.evaluate(() => window.__starwish.perf());
        check("V2（預設）高畫質發光層維持開啟、不受影響", perf.bloom === true && perf.quality === "high", perf);
      } catch (e) {
        run.errors.push(`v2 exception: ${e.message}`);
      }
      await ctx.close();
    }
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 4;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${run.viewport}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}  ${JSON.stringify(v.detail).slice(0, 300)}`);
    for (const p of run.photo) console.log(`   · ${p.label}: draw ${p.perf.drawCalls}, activeMeshes ${p.perf.activeMeshes}, fps ${p.perf.fps.toFixed(1)}, res ${JSON.stringify(p.resources)}, px ${p.staged.pixelRatio}`);
    for (const e of run.errors) console.log(`   ! ${e}`);
  }

  // ---------- Stage 5.2：V3.8R 動畫與戰鬥事件（正式遊戲頁；WebKit 三種畫質、Chromium 中畫質）----------
  for (const q of name === "webkit" ? ["high", "medium", "low"] : ["medium"]) {
    const vp = VIEWPORTS[0];
    const run = { browser: name, viewport: `${vp.name} / 遊戲 V3.8R 動畫戰鬥（${q}）`, checks: {}, errors: [], screenshots: [], samples: [] };
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };
    const mons = () => page.evaluate(() => window.__starwish.monsters());
    /** 在頁面內每幀取樣，直到條件成立（避免 CI 低 FPS 時漏掉短暫的狀態） */
    const sampleUntil = (fnSrc, timeoutMs) =>
      page.evaluate(
        ({ fnSrc, timeoutMs }) =>
          new Promise((resolve) => {
            const fn = new Function("ms", "combat", fnSrc);
            const t0 = performance.now();
            const tick = () => {
              const r = fn(window.__starwish.monsters(), window.__starwish.combat());
              if (r) return resolve(r);
              if (performance.now() - t0 > timeoutMs) return resolve(null);
              requestAnimationFrame(tick);
            };
            tick();
          }),
        { fnSrc, timeoutMs },
      );
    try {
      await page.goto(server.url + `/?bobo=v38r&quality=${q}`, { waitUntil: "load" });
      await page.addStyleTag({ content: safeAreaCss(vp.safe) });
      await page.waitForFunction(() => window.__starwish?.ready === true, null, { timeout: 45000 });
      const loaded = await page
        .waitForFunction(async () => (await window.__starwish.bobo()).visuals.every((x) => x.loaded), null, { timeout: 45000, polling: 250 })
        .then(() => true)
        .catch(() => false);
      const perf0 = await page.evaluate(() => window.__starwish.perf());
      check(`畫質 ${q}：V3.8R 載入、畫質正確、發光層停用`, loaded && perf0.quality === q && perf0.bloom === false, perf0);
      const res0 = await page.evaluate(async () => (await window.__starwish.bobo()).scene);
      const m0 = await mons();
      check(
        "三隻都有獨立的 V3.8R 動畫，待機／移動與狀態一致",
        m0.length === 3 && m0.every((m) => m.anim && (m.state === "idle" || m.state === "move") && (m.anim.anim === "idle" || m.anim.anim === "move")),
        m0.map((m) => [m.state, m.anim && m.anim.anim]),
      );

      // ---- 怪物攻擊玩家：攻擊動畫實際播放、0.50 秒命中、每次攻擊只扣一次 ----
      const target = m0[0];
      await page.evaluate(({ x, z }) => window.__starwish.teleport(x, z), { x: target.x, z: target.z - 0.9 });
      const atk = await sampleUntil(
        "const m = ms.find((x) => x.state === 'attack'); return m ? { id: m.id, anim: m.anim.anim, face: m.anim.face, stateTime: m.stateTime, animTime: m.anim.animTime, attackId: m.attackId } : null;",
        20000,
      );
      check("攻擊開始時播放 V3.8R 攻擊動畫（同一幀、時間一致、生氣表情）", !!atk && atk.anim === "attack" && atk.face === "angry" && Math.abs(atk.stateTime - atk.animTime) < 0.02, atk);
      const hit = await sampleUntil(
        `const m = ms.find((x) => x.id === ${JSON.stringify(atk && atk.id)}); return m && m.attackLog.resolved >= 1 ? { log: m.attackLog, state: m.state, anim: m.anim.anim, hp: combat.hp, hitsTaken: combat.hitsTaken } : null;`,
        8000,
      );
      check("命中後玩家扣 8 HP（每次命中剛好 8）", !!hit && hit.hitsTaken >= 1 && 100 - hit.hp === 8 * hit.hitsTaken, hit);
      // 讓 AI 連續攻擊幾次
      await page.waitForTimeout(6000);
      // 怪物紀錄與玩家戰鬥狀態在同一次讀取（分兩次讀會被中間發生的命中錯開）
      const snap = await page.evaluate(() => ({ ms: window.__starwish.monsters(), cb: window.__starwish.combat() }));
      const after = snap.ms;
      const cb = snap.cb;
      const totals = after.reduce((a, m) => ({ started: a.started + m.attackLog.started, resolved: a.resolved + m.attackLog.resolved, dup: a.dup + m.attackLog.duplicatesBlocked, anims: a.anims + m.anim.starts.attack }), { started: 0, resolved: 0, dup: 0, anims: 0 });
      check("每一次邏輯攻擊都播放了攻擊動畫（動畫次數 = attackId 次數）", after.every((m) => m.anim.starts.attack === m.attackLog.started) && totals.started >= 2, { totals, per: after.map((m) => [m.attackLog.started, m.anim.starts.attack]) });
      check(
        "命中去重：結算次數 ≤ 攻擊次數、沒有重複結算、扣血 = 8 × 受擊次數",
        totals.resolved <= totals.started && totals.dup === 0 && (cb.down || 100 - cb.hp === 8 * cb.hitsTaken) && cb.hitsTaken <= totals.resolved,
        { totals, combat: cb },
      );
      const cdOk = after.every((m) => m.attackLog.started === 0 || m.state !== "attack" || m.cooldown > 0);
      check("攻擊冷卻 2 秒（從攻擊開始計算）：攻擊中冷卻尚未結束", cdOk, after.map((m) => [m.state, m.cooldown]));

      // ---- 命中前被受傷打斷：取消、不結算、播受傷 ----
      const intr = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const t0 = performance.now();
            const tick = () => {
              const m = window.__starwish.monsters().find((x) => x.state === "attack" && x.stateTime < 0.35 && x.hp > 20);
              if (m) {
                const before = window.__starwish.combat().hitsTaken;
                const r = window.__starwish.damageMonster(m.id, 20);
                return resolve({ id: m.id, attackId: m.attackId, stateTime: m.stateTime, r, before });
              }
              if (performance.now() - t0 > 20000) return resolve(null);
              requestAnimationFrame(tick);
            };
            tick();
          }),
      );
      // 受傷由下一幀的怪物更新切換（仍在繪製之前）→ 等動畫本身切換
      const hurt = intr && (await sampleUntil(`const m = ms.find((x) => x.id === ${JSON.stringify(intr.id)}); return m && m.anim.anim === 'hurt' ? { anim: m.anim.anim, face: m.anim.face, state: m.state, log: m.attackLog } : null;`, 3000));
      await page.waitForTimeout(1500);
      const intrAfter = intr && (await mons()).find((m) => m.id === intr.id);
      check(
        "命中前受傷：攻擊取消（不結算）、播放受傷動畫",
        !!intr && intr.r.cancelledAttackId === intr.attackId && !!hurt && hurt.anim === "hurt" && hurt.state === "hit" && intrAfter.attackLog.lastCancelledId === intr.attackId && intrAfter.attackLog.lastResolvedId !== intr.attackId,
        { intr, hurt, log: intrAfter && intrAfter.attackLog },
      );

      // ---- 死亡：1.8 秒死亡動畫 → 移除；（中畫質）10 秒後原出生點重生、淡入 ----
      await page.evaluate(() => window.__starwish.teleport(-6, -6));
      const victim = (await mons())[2];
      const kill = await page.evaluate((id) => window.__starwish.damageMonster(id, 999), victim.id);
      const dying = await sampleUntil(`const m = ms.find((x) => x.id === ${JSON.stringify(victim.id)}); return m && m.anim.anim === 'death' ? { anim: m.anim.anim, state: m.state, face: m.anim.face } : null;`, 3000);
      const dead = await sampleUntil(`const m = ms.find((x) => x.id === ${JSON.stringify(victim.id)}); return m && m.state === 'dead' ? { anim: m.anim.anim, visible: m.visible, vis: m.anim.visibility, dust: m.anim.dust } : null;`, 15000);
      const resDead = await page.evaluate(async () => (await window.__starwish.bobo()).scene);
      check("致命傷 → 死亡動畫 → 完成後移除（隱藏、星塵清除、暫時材質釋放）", resDead.materials === res0.materials && kill && kill.killed && !!dying && dying.anim === "death" && dying.state === "death" && !!dead && dead.visible === false && dead.dust === 0, { kill, dying, dead });
      if (q === "medium") {
        const resp = await sampleUntil(`const m = ms.find((x) => x.id === ${JSON.stringify(victim.id)}); return m && m.state === 'respawn' ? { vis: m.anim.visibility, anim: m.anim.anim, x: m.x, z: m.z, sx: m.spawnX, sz: m.spawnZ, hp: m.hp } : null;`, 40000);
        const idle = await sampleUntil(`const m = ms.find((x) => x.id === ${JSON.stringify(victim.id)}); return m && m.state === 'idle' || (m && m.state === 'move') ? { vis: m.anim.visibility, star: m.anim.starBright, temp: m.anim.tempStarMaterial } : null;`, 5000);
        check(
          "10 秒後原出生點重生：待機姿勢淡入，結束後完全不透明、星星恢復",
          !!resp && resp.vis < 1 && resp.anim === "idle" && Math.hypot(resp.x - resp.sx, resp.z - resp.sz) < 0.01 && resp.hp === 60 && !!idle && idle.vis === 1 && idle.star === 1 && idle.temp === false,
          { resp, idle },
        );
        await page.waitForTimeout(500);
        const res1 = await page.evaluate(async () => (await window.__starwish.bobo()).scene);
        check("死亡重生後資源數不增加（暫時材質與星塵已釋放）", res1.materials === res0.materials && res1.textures === res0.textures && res1.meshes === res0.meshes, { before: res0, after: res1 });
      }
      // ---- Stage 5.2P：玩家攻擊動作（V3.8R 模式）：揮擊明顯、揮中才扣 20 一次、面向目標；啵啵照常播受傷 ----
      {
        const mm = await mons();
        const tgt = mm.find((m) => (m.state === "idle" || m.state === "move") && m.hp > 20) ?? mm.find((m) => m.state !== "death" && m.state !== "dead" && m.state !== "respawn");
        if (tgt) {
          await page.evaluate(({ x, z }) => window.__starwish.teleport(x + 1.2, z), { x: tgt.x, z: tgt.z });
          await page.waitForFunction(() => !window.__starwish.combat().down, null, { timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(1200);
          const before = await page.evaluate(() => ({ st: window.__starwish.attackState(), ms: window.__starwish.monsters() }));
          // 按下的同一瞬間讀取被鎖定目標的血量
          const press = await page.evaluate(() => {
            const r = window.__starwish.attack();
            const r2 = window.__starwish.attack();
            const t = r.ok ? window.__starwish.monsters().find((x) => x.id === r.targetId) : null;
            return { r, r2, hp: t ? t.hp : null, hurt: t && t.anim ? t.anim.starts.hurt : null, flash: t && t.anim ? t.anim.reactions.noStagger : null, state: t ? t.state : null };
          });
          const facing = [];
          for (let k = 0; k < 60; k++) {
            const st = await page.evaluate(() => window.__starwish.attackState());
            if (st.phase === "strike" && st.facingError !== null) facing.push(st.facingError);
            if (!st.attacking && k > 2) break;
            await page.waitForTimeout(40);
          }
          await page.waitForFunction(() => !window.__starwish.attackState().attacking, null, { timeout: 10000 }).catch(() => {});
          const after = await page.evaluate(() => ({ st: window.__starwish.attackState(), ms: window.__starwish.monsters() }));
          const tAfter = press.r.ok ? after.ms.find((x) => x.id === press.r.targetId) : null;
          const tr = after.st.trace;
          check(
            "玩家攻擊（V3.8R 模式）：蓄力→揮擊→收招、右手明顯揮出、身體前傾，結束回待機",
            press.r.ok && tr.phases.join(">") === "windup>strike>recover" && tr.maxBack > 0.8 && tr.maxFwd < -1.2 && tr.maxLean > 0.15 && after.st.phase === "idle" && after.st.started === before.st.started + 1,
            { r: press.r, tr, started: [before.st.started, after.st.started] },
          );
          check(
            "玩家攻擊（V3.8R 模式）：按下不扣血、揮中扣 20 一次、冷卻內再按無效",
            press.r2.ok === false && press.r2.reason === "cooldown" && after.st.lastHit?.ok === true && after.st.hits === before.st.hits + 1 && (tr.hitPhase === "strike" || tr.hitPhase === "recover") && tAfter && press.hp - tAfter.hp === 20,
            { atPress: press.hp, after: tAfter && tAfter.hp, hitPhase: tr.hitPhase, hitElapsed: tr.hitElapsed, hits: [before.st.hits, after.st.hits], lastHit: after.st.lastHit },
          );
          check("玩家攻擊（V3.8R 模式）：揮擊時面向目標", facing.length === 0 || Math.min(...facing) < 0.35, { facing });
          check(
            "玩家普通攻擊命中：星露啵啵顯示受擊表情（或死亡），不播受傷硬直動作（2026-11-20 正式規則）",
            !!tAfter && tAfter.anim && ((tAfter.anim.reactions.noStagger === press.flash + 1 && tAfter.anim.starts.hurt === press.hurt) || tAfter.anim.starts.death >= 1),
            { press, anim: tAfter && tAfter.anim, state: tAfter && tAfter.state },
          );
        } else check("玩家攻擊（V3.8R 模式）：找到可攻擊的啵啵", false, mm.map((m) => m.state));
      }
      const perf1 = await page.evaluate(() => window.__starwish.perf());
      run.samples.push({ quality: q, perf: perf1, resources: await page.evaluate(async () => (await window.__starwish.bobo()).scene) });
      const f = `${outDir}${name}_game_v38r_combat_${q}.png`;
      await page.screenshot({ path: f });
      run.screenshots.push(f.split("/test-results/")[1]);
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 13;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${run.viewport}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 700)}`);
    for (const sm of run.samples) console.log(`   · ${sm.quality}: draw ${sm.perf.drawCalls}, activeMeshes ${sm.perf.activeMeshes}, fps ${sm.perf.fps.toFixed(1)}, res ${JSON.stringify(sm.resources)}`);
    for (const e of run.errors) console.log(`   ! ${e}`);
    await ctx.close();
  }

  // ---------- Stage 5.3-1：遊戲內效能測試模式（?bench=1；CI 用短時間：暖機 1 秒＋測量 2 秒）----------
  {
    const vp = VIEWPORTS[0];
    const runs = name === "webkit" ? [["v2", "medium"], ["v38r", "medium"], ["v38r", "high"], ["v38r", "low"]] : [["v2", "medium"], ["v38r", "medium"]];
    const run = { browser: name, viewport: `${vp.name} / 遊戲 效能測試模式 ?bench=1`, checks: {}, errors: [], screenshots: [], results: [] };
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };
    // 同一個瀏覽器環境（localStorage 共用）→ 測完 V2 再測 V3.8R 會出現比較
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
    try {
      for (const [variant, q] of runs) {
        const page = await ctx.newPage();
        page.on("pageerror", (e) => run.errors.push(`${variant}/${q} pageerror: ${e.message}`));
        page.on("console", (m) => m.type() === "error" && run.errors.push(`${variant}/${q} console: ${m.text()}`));
        try {
          const qs = `?bench=1&benchsec=2&warmup=1&quality=${q}${variant === "v38r" ? "&bobo=v38r" : ""}`;
          await page.goto(server.url + "/" + qs, { waitUntil: "load" });
          await page.waitForFunction(() => window.__starwish?.ready === true, null, { timeout: 45000 });
          const banner = await page.waitForSelector(".bench-banner", { timeout: 5000 }).then(() => true).catch(() => false);
          await page.waitForFunction(() => window.__starwish.benchState()?.phase === "measuring" || window.__starwish.benchState()?.phase === "done", null, { timeout: 60000 });
          // 測量中：場景固定（位置不變、待機、不戰鬥），V3.8R 待機動畫照常播放
          const a = await page.evaluate(() => ({ ms: window.__starwish.monsters(), c: window.__starwish.combat(), p: window.__starwish.getPlayer(), cam: window.__starwish.getCamera() }));
          await page.evaluate(() => window.__starwish.attack()); // 測試中按攻擊不應有作用
          await page.evaluate(() => window.__starwish.setMove({ x: 1, y: 0 }));
          await page.waitForTimeout(600);
          const b = await page.evaluate(() => ({ ms: window.__starwish.monsters(), c: window.__starwish.combat(), p: window.__starwish.getPlayer(), cam: window.__starwish.getCamera(), st: window.__starwish.benchState() }));
          await page.evaluate(() => window.__starwish.setMove(null));
          const held =
            b.st.phase !== "measuring" ||
            (a.ms.every((m, i) => Math.hypot(m.x - b.ms[i].x, m.z - b.ms[i].z) < 1e-6 && (b.ms[i].state === "idle")) &&
              Math.hypot(a.p.x - b.p.x, a.p.z - b.p.z) < 1e-6 &&
              Math.abs(a.cam.alpha - b.cam.alpha) < 1e-6 &&
              b.c.hitsTaken === 0 &&
              b.ms.every((m) => m.hp === m.maxHp));
          const animating = variant !== "v38r" || b.st.phase !== "measuring" || b.ms.every((m, i) => m.anim && m.anim.anim === "idle" && m.anim.animTime > a.ms[i].anim.animTime);
          await page.waitForFunction(() => window.__starwish.benchState()?.phase === "done", null, { timeout: 60000 });
          const st = await page.evaluate(() => window.__starwish.benchState());
          const r = st.result;
          const s = r.summary;
          const panel = await page.evaluate(() => {
            const el = document.querySelector(".bench-result");
            return el ? el.textContent : null;
          });
          const bannerGone = await page.evaluate(() => !document.querySelector(".bench-banner"));
          run.results.push({ variant, q, summary: s, avgActiveMeshes: r.avgActiveMeshes, meshes: r.meshes, materials: r.materials, textures: r.textures, pixelRatio: r.pixelRatio });
          check(
            `${variant}／${q}：完成測試、數值合理（1% Low ≤ 平均、最低 ≤ 1% Low、Draw Calls > 0、3 隻）`,
            banner && r.variant === variant && r.quality === q && s.frames > 0 && s.avgFps > 0 && s.low1Fps <= s.avgFps + 1e-6 && s.minFps <= s.low1Fps + 1e-6 && s.low1AvgFps <= s.low1Fps + 1e-6 && s.avgDrawCalls > 0 && r.monsters === 3 && s.seconds >= 2 - 0.05 && s.seconds <= 2 + (2 * s.maxFrameMs) / 1000 + 0.05, // 起點與終點各可能多一幀（實機 60 FPS 時約 0.03 秒）
            { s, r: { pixelRatio: r.pixelRatio, meshes: r.meshes, avgActiveMeshes: r.avgActiveMeshes } },
          );
          check(`${variant}／${q}：測量中場景固定、不戰鬥、操作無效`, held, { a: a.ms.map((m) => [m.x, m.z, m.state]), b: b.ms.map((m) => [m.x, m.z, m.state, m.hp]), hits: b.c.hitsTaken, phase: b.st.phase });
          check(`${variant}／${q}：怪物待機動畫照常播放（V3.8R）`, animating, b.ms.map((m) => m.anim && [m.anim.anim, m.anim.animTime]));
          check(`${variant}／${q}：結果面板顯示、提示文字移除`, !!panel && /1% Low/.test(panel) && /Draw Calls/.test(panel) && bannerGone, panel && panel.slice(0, 200));
          if (variant === "v38r" && q === "medium") check("同畫質測過 V2 與 V3.8R 後顯示比較", !!panel && /比較/.test(panel) && /V2 → V3\.8R/.test(panel), panel && panel.slice(0, 400));
          const f = `${outDir}${name}_bench_${variant}_${q}.png`;
          await page.screenshot({ path: f });
          run.screenshots.push(f.split("/test-results/")[1]);
        } catch (e) {
          run.errors.push(`${variant}/${q} exception: ${e.message}`);
        }
        await page.close();
      }
      // 一般遊戲（沒有 bench 參數）：完全不啟用
      const page = await ctx.newPage();
      await page.goto(server.url + "/?bobo=v38r", { waitUntil: "load" });
      await page.waitForFunction(() => window.__starwish?.ready === true, null, { timeout: 45000 });
      const normal = await page.evaluate(() => ({ st: window.__starwish.benchState(), banner: !!document.querySelector(".bench-banner"), panel: !!document.querySelector(".bench-result") }));
      check("一般遊戲（不加 bench）不啟用測試模式", normal.st === null && !normal.banner && !normal.panel, normal);
      await page.close();
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }
    await ctx.close();
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 6;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${run.viewport}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 700)}`);
    for (const r of run.results) console.log(`   · ${r.variant}/${r.q}: avg ${r.summary.avgFps.toFixed(1)}, 1%low ${r.summary.low1Fps.toFixed(1)}, min ${r.summary.minFps.toFixed(1)}, draw ${r.summary.avgDrawCalls.toFixed(1)}, active ${r.avgActiveMeshes.toFixed(1)}, meshes ${r.meshes}, px ${r.pixelRatio}`);
    for (const e of run.errors) console.log(`   ! ${e}`);
  }

  // ---------- Stage 5.3-2：除錯面板（?debug=1）、重設測試、渲染調查 ----------
  {
    const vp = VIEWPORTS[0];
    const cases = name === "webkit" ? [["v38r", "high"], ["v38r", "medium"], ["v38r", "low"], ["v2", "high"]] : [["v38r", "medium"]];
    const run = { browser: name, viewport: `${vp.name} / 遊戲 除錯面板 ?debug=1`, checks: {}, errors: [], screenshots: [], breakdown: [] };
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };
    for (const [variant, q] of cases) {
      const tag = `${variant}／${q}`;
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => run.errors.push(`${tag} pageerror: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && run.errors.push(`${tag} console: ${m.text()}`));
      try {
        await page.goto(server.url + `/?debug=1&quality=${q}${variant === "v38r" ? "&bobo=v38r" : ""}`, { waitUntil: "load" });
        await page.addStyleTag({ content: safeAreaCss(vp.safe) });
        await page.waitForFunction(() => window.__starwish?.ready === true, null, { timeout: 45000 });
        if (variant === "v38r") await page.waitForFunction(async () => (await window.__starwish.bobo()).visuals.every((x) => x.loaded), null, { timeout: 45000, polling: 250 });
        await page.waitForFunction(() => /Draw Calls/.test(document.querySelector(".debug-text")?.textContent ?? ""), null, { timeout: 20000 });
        await page.waitForTimeout(1500);
        const txt = await page.evaluate(() => document.querySelector(".debug-text").textContent);
        const di = await page.evaluate(() => window.__starwish.debugInfo());
        check(
          `${tag}：面板顯示 FPS、Draw Calls、解析度、CPU／GPU、玩家與 3 隻怪物（HP、狀態、attackId）`,
          /FPS/.test(txt) && /Draw Calls \d+/.test(txt) && /解析度 \d+×\d+/.test(txt) && /CPU/.test(txt) && /GPU/.test(txt) && /玩家 HP/.test(txt) && /#1 HP/.test(txt) && /#3 HP/.test(txt) && /attackId/.test(txt) && (variant !== "v38r" || /動畫 (idle|move|attack|hurt)/.test(txt)) && di.monsters.length === 3 && di.drawCalls > 0 && di.profile && di.profile.frames > 0 && di.sceneTimes !== null,
          txt.slice(0, 600),
        );
        // 面板不擋住搖桿與技能按鈕；HUD 版面檢查照常通過
        const overlap = await page.evaluate(() => {
          const p = document.querySelector(".debug-panel").getBoundingClientRect();
          const hit = (r) => !(r.right <= p.left || r.left >= p.right || r.bottom <= p.top || r.top >= p.bottom);
          const els = [...document.querySelectorAll(".skill-btn, .joystick-base, .hud-status, .hud-system, .perf-panel")];
          return els.filter((e) => hit(e.getBoundingClientRect())).map((e) => e.className || e.getAttribute("data-layout"));
        });
        const hud = await page.evaluate((sa) => window.__starwish.hudIssues(sa), vp.safe);
        check(`${tag}：面板不擋住搖桿、攻擊／技能按鈕、HP 狀態與效能面板，HUD 版面正常`, overlap.length === 0 && hud.length === 0, { overlap, hud });
        if (q === "medium" || name === "chromium") {
          // 重生倒數：擊倒一隻 → 面板出現倒數且遞減
          const victim = (await page.evaluate(() => window.__starwish.monsters()))[1];
          await page.evaluate((id) => window.__starwish.damageMonster(id, 999), victim.id);
          await page.waitForFunction((id) => window.__starwish.monsters().find((m) => m.id === id).state === "dead", victim.id, { timeout: 20000 });
          await page.waitForTimeout(700);
          const r1 = (await page.evaluate(() => window.__starwish.debugInfo())).monsters[1].respawnIn;
          await page.waitForTimeout(1500);
          const d2 = await page.evaluate(() => window.__starwish.debugInfo());
          const r2 = d2.monsters[1].respawnIn;
          const txt2 = await page.evaluate(() => document.querySelector(".debug-text").textContent);
          check(`${tag}：重生倒數顯示並遞減（死亡動畫剩餘＋10 秒）`, r1 !== null && r2 !== null && r2 < r1 && r1 <= 11.8 && r2 <= 10 && /#2 HP 0\/60・已移除・動畫 dead.*重生倒數/.test(txt2), { r1, r2, line: txt2.split("\n").find((l) => l.startsWith("#2")) });
          // 重設測試：玩家倒地、一隻已移除 → 按下按鈕 → 全部回到出生點、HP 全滿、待機
          await page.evaluate(() => window.__starwish.knockDown());
          // 按下按鈕的同一瞬間讀取（之後 AI 會立刻開始追玩家，位置會變）
          const after = await page.evaluate(() => {
            document.querySelector(".debug-reset").click();
            return { ms: window.__starwish.monsters(), c: window.__starwish.combat(), p: window.__starwish.getPlayer() };
          });
          await page.waitForTimeout(1200);
          const later = await page.evaluate(() => window.__starwish.monsters());
          check(
            `${tag}：「重設測試」：怪物回出生點、HP 全滿、待機、attackId 歸零；玩家 HP 全滿、站起、回出生點；之後照常行動`,
            after.ms.every((m) => m.hp === m.maxHp && m.state === "idle" && Math.hypot(m.x - m.spawnX, m.z - m.spawnZ) < 1e-6 && m.attackId === 0 && m.cooldown === 0) &&
              after.c.hp === 100 && after.c.down === false && after.c.hitsTaken === 0 && Math.hypot(after.p.x, after.p.z) < 1e-6 &&
              later.every((m) => m.state !== "dead" && m.state !== "death") &&
              (variant !== "v38r" || later.every((m) => m.anim.visibility === 1 && m.anim.anim !== "dead" && m.anim.anim !== "death")),
            { after, later: later.map((m) => [m.state, m.anim && m.anim.anim, m.anim && m.anim.visibility]) },
          );
          // 收合／展開
          await page.locator(".debug-toggle").click();
          const hidden = await page.evaluate(() => getComputedStyle(document.querySelector(".debug-text")).display === "none");
          await page.locator(".debug-toggle").click();
          const shown = await page.evaluate(() => getComputedStyle(document.querySelector(".debug-text")).display !== "none");
          check(`${tag}：面板可收合與展開`, hidden && shown, { hidden, shown });
        }
        const bd = await page.evaluate(() => window.__starwish.renderBreakdown());
        run.breakdown.push({ tag, bd, profile: di.profile, sceneTimes: di.sceneTimes, gpuSupported: di.gpuSupported, render: di.render });
        check(`${tag}：渲染調查資料（解析度、陰影、後製、各類物件數）`, bd.renderSize[0] > 0 && bd.shadow.casters >= 0 && Object.keys(bd.activeByGroup).length > 0, bd);
        const f = `${outDir}${name}_debug_${variant}_${q}.png`;
        await page.screenshot({ path: f });
        run.screenshots.push(f.split("/test-results/")[1]);
      } catch (e) {
        run.errors.push(`${tag} exception: ${e.message}`);
      }
      await ctx.close();
    }
    // 不加 debug：完全不建立
    {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
      const page = await ctx.newPage();
      try {
        await page.goto(server.url + "/?bobo=v38r", { waitUntil: "load" });
        await page.waitForFunction(() => window.__starwish?.ready === true, null, { timeout: 45000 });
        const n = await page.evaluate(() => ({ panel: !!document.querySelector(".debug-panel"), info: window.__starwish.debugInfo() }));
        check("一般遊戲（不加 debug）不建立除錯面板", n.panel === false && n.info === null, n);
        if (name === "webkit") {
          // 調查用效能測試參數：指定渲染倍率 1x＋CPU 分段；結果另存
          await page.goto(server.url + "/?bobo=v38r&quality=medium&bench=1&benchsec=2&warmup=1&benchres=1&benchprof=1", { waitUntil: "load" });
          await page.waitForFunction(() => window.__starwish?.benchState()?.phase === "done", null, { timeout: 90000 });
          const st = await page.evaluate(() => window.__starwish.benchState());
          const r = st.result;
          check(
            "效能測試調查參數：benchres=1 固定 1x、benchprof=1 記錄 CPU 分段、結果另存（不覆蓋一般測試）",
            r.resOverride === 1 && r.pixelRatio === 1 && r.profile && r.profile.frames > 0 && r.profile.cpuMs > 0 && st.saved.includes("v38r_medium_r1"),
            { pixelRatio: r.pixelRatio, profile: r.profile, saved: st.saved },
          );
          // 渲染實驗：診斷開關確實生效；中畫質（PCF）時 opt=pcss32 不改任何東西
          const diag = {};
          for (const d of ["noshadow", "nomsaa", "nohdr"]) {
            await page.goto(server.url + `/?bobo=v38r&quality=high&diag=${d}`, { waitUntil: "load" });
            await page.waitForFunction(() => window.__starwish?.ready === true, null, { timeout: 45000 });
            diag[d] = await page.evaluate(() => window.__starwish.renderExperiments());
          }
          await page.goto(server.url + `/?bobo=v38r&quality=medium&opt=pcss32`, { waitUntil: "load" });
          await page.waitForFunction(() => window.__starwish?.ready === true, null, { timeout: 45000 });
          const medOpt = await page.evaluate(() => window.__starwish.renderExperiments());
          // 畫質互不影響：V2 高畫質維持原本高品質；V3.8R 中、低畫質維持各自的 PCF 設定
          const others = {};
          for (const qs of ["?quality=high", "?bobo=v38r&quality=medium", "?bobo=v38r&quality=low"]) {
            await page.goto(server.url + "/" + qs, { waitUntil: "load" });
            await page.waitForFunction(() => window.__starwish?.ready === true, null, { timeout: 45000 });
            others[qs] = await page.evaluate(() => window.__starwish.renderExperiments());
          }
          check(
            "畫質互不影響：V2 高畫質仍為原本高品質柔和陰影；V3.8R 中／低畫質維持 PCF 中／低品質",
            others["?quality=high"].shadowQuality === 0 && others["?bobo=v38r&quality=medium"].shadowQuality === 1 && others["?bobo=v38r&quality=medium"].msaa === 1 && others["?bobo=v38r&quality=low"].shadowQuality === 2 && others["?bobo=v38r&quality=low"].msaa === 0,
            others,
          );
          check(
            "診斷開關生效（noshadow 關陰影、nomsaa 關 MSAA、nohdr 改 8 位元）；中畫質 opt=pcss32 不改設定",
            diag.noshadow.shadowEnabled === false && diag.nomsaa.msaa === 1 && diag.nohdr.hdr === false && diag.nohdr.msaa === 4 && medOpt.shadowQuality === 1 && medOpt.msaa === 1,
            { diag, medOpt },
          );
          // 效能測試：目前預設（PCSS32）與回退（原本高品質）各測一次 → 顯示比較
          for (const qs of ["", "&shadowq=original"]) {
            await page.goto(server.url + `/?bobo=v38r&quality=high&bench=1&benchsec=2&warmup=1${qs}`, { waitUntil: "load" });
            await page.waitForFunction(() => window.__starwish?.benchState()?.phase === "done", null, { timeout: 120000 });
          }
          const expPanel = await page.evaluate(() => document.querySelector(".bench-result")?.textContent ?? "");
          const expSt = await page.evaluate(() => window.__starwish.benchState());
          check(
            "效能測試：回退版本另存並顯示「目前預設 → 實驗」比較",
            expSt.result.experiment === "shadowq:original" && expSt.saved.includes("v38r_high") && expSt.saved.includes("v38r_high_shadowq:original") && /目前預設 → 實驗 shadowq:original/.test(expPanel),
            { saved: expSt.saved, panel: expPanel.slice(0, 300) },
          );
        }
      } catch (e) {
        run.errors.push(`normal exception: ${e.message}`);
      }
      await ctx.close();
    }
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 4;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${run.viewport}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 700)}`);
    for (const b of run.breakdown) console.log(`   · ${b.tag}: ${JSON.stringify({ px: b.bd.pixelRatio, size: b.bd.renderSize, post: b.bd.postProcess, glow: b.bd.glow, shadow: b.bd.shadow, rt: b.bd.renderTargets, groups: b.bd.activeByGroup, tris: b.bd.trianglesActive, cpu: b.profile && b.profile.sections, gpu: b.gpuSupported })}`);
    for (const e of run.errors) console.log(`   ! ${e}`);
  }

  // ---------- Stage 5.3：陰影品質與穩定性（高畫質：預設 PCSS32 vs 回退原本高品質）----------
  {
    const vp = VIEWPORTS[0];
    const run = { browser: name, viewport: `${vp.name} / 遊戲 陰影品質與穩定性（高畫質）`, checks: {}, errors: [], screenshots: [], shots: [] };
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };
    for (const [label, extra] of [["pcss32_default", ""], ["original", "&shadowq=original"]]) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => run.errors.push(`${label} pageerror: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && run.errors.push(`${label} console: ${m.text()}`));
      try {
        await page.goto(server.url + `/?bobo=v38r&quality=high${extra}`, { waitUntil: "load" });
        await page.addStyleTag({ content: safeAreaCss(vp.safe) + " .hud-toast { display: none !important; }" });
        await page.waitForFunction(() => window.__starwish?.ready === true, null, { timeout: 45000 });
        await page.waitForFunction(async () => (await window.__starwish.bobo()).visuals.every((x) => x.loaded), null, { timeout: 45000, polling: 250 });
        const staged = await page.evaluate(() => window.__starwish.stageShadowPhoto());
        await page.waitForTimeout(2500);
        const exp = await page.evaluate(() => window.__starwish.renderExperiments());
        const stab = await page.evaluate(() => window.__starwish.stabilityCheck(1000));
        const f = `${outDir}${name}_shadow_${label}.png`;
        await page.screenshot({ path: f });
        run.screenshots.push(f.split("/test-results/")[1]);
        run.shots.push({ label, staged, exp, stab });
        check(
          `${label}：靜止畫面連續兩幀完全相同（陰影沒有閃爍或取樣雜訊）`,
          stab.pixels > 0 && stab.changed === 0,
          stab,
        );
        check(
          `${label}：陰影設定正確（${label === "original" ? "原本高品質" : "PCSS32 中品質"}、陰影開啟、MSAA 4x）`,
          exp.shadowEnabled === true && exp.msaa === 4 && exp.shadowQuality === (label === "original" ? 0 : 1),
          exp,
        );
      } catch (e) {
        run.errors.push(`${label} exception: ${e.message}`);
      }
      await ctx.close();
    }
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 4;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${run.viewport}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 500)}`);
    for (const e of run.errors) console.log(`   ! ${e}`);
  }

  // ---------- Stage 5.3：實際遊玩壓力測試（?autoplay=；CI 用短時間）----------
  {
    const vp = VIEWPORTS[0];
    const cases =
      name === "webkit"
        ? [["move", 3, "high", 6], ["attack", 3, "low", 22], ["attack", 10, "low", 22], ["soak", 5, "low", 30]]
        : [["attack", 5, "low", 22]];
    const run = { browser: name, viewport: `${vp.name} / 遊戲 實際遊玩壓力測試 ?autoplay`, checks: {}, errors: [], screenshots: [], results: [] };
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };
    for (const [mode, count, q, dur] of cases) {
      const tag = `${mode}／${count} 隻／${q}`;
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => run.errors.push(`${tag} pageerror: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && run.errors.push(`${tag} console: ${m.text()}`));
      try {
        await page.goto(server.url + `/?bobo=v38r&quality=${q}&autoplay=${mode}&count=${count}&dur=${dur}&warmup=1`, { waitUntil: "load" });
        await page.waitForFunction(() => window.__starwish?.ready === true, null, { timeout: 45000 });
        const n = await page.evaluate(() => window.__starwish.monsters().length);
        await page.waitForFunction(() => window.__starwish.autoplayState()?.phase === "done", null, { timeout: (dur + 90) * 1000 });
        const st = await page.evaluate(() => window.__starwish.autoplayState());
        const r = st.result;
        const panel = await page.evaluate(() => document.querySelector(".autoplay-result")?.textContent ?? "");
        run.results.push({ tag, summary: r.summary, counters: r.counters, checks: r.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}（${c.detail}）`), timeline: r.timeline });
        const failed = r.checks.filter((c) => !c.ok);
        check(`${tag}：怪物數量正確（${count} 隻）`, n === count && r.count === count, { n, count: r.count });
        check(`${tag}：所有自動判定通過`, failed.length === 0 && r.summary.frames > 0, failed);
        if (mode === "attack") check(`${tag}：有出手、命中、擊倒怪物`, r.counters["出手"] >= 2 && r.counters["命中"] >= 2 && r.counters["怪物死亡"] >= 1, r.counters);
        check(`${tag}：結果面板顯示`, /實際遊玩壓力測試結果/.test(panel) && /平均/.test(panel), panel.slice(0, 200));
        const f = `${outDir}${name}_autoplay_${mode}_${count}_${q}.png`;
        await page.screenshot({ path: f });
        run.screenshots.push(f.split("/test-results/")[1]);
      } catch (e) {
        run.errors.push(`${tag} exception: ${e.message}`);
      }
      await ctx.close();
    }
    // 鏡頭偏離原因重現：自動移動中（繞半徑 7 公尺路線）倒地 → 2 秒後傳送回出生點 → 鏡頭平滑追上
    // 一般跟隨偏離不應包含這段追趕；追趕時間另列為「復活傳送後鏡頭 1 秒內跟上」
    {
      const tag = "move／復活傳送";
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => run.errors.push(`${tag} pageerror: ${e.message}`));
      try {
        await page.goto(server.url + "/?bobo=v38r&quality=low&autoplay=move&count=3&dur=14&warmup=1", { waitUntil: "load" });
        await page.waitForFunction(() => window.__starwish?.ready === true, null, { timeout: 45000 });
        await page.waitForFunction(() => window.__starwish.autoplayState()?.phase === "running" && window.__starwish.autoplayState().elapsed > 3, null, { timeout: 60000 });
        const p0 = await page.evaluate(() => window.__starwish.getPlayer());
        await page.evaluate(() => window.__starwish.knockDown());
        // 直接量測：復活後每幀鏡頭中心與玩家的水平距離
        const trace = await page.evaluate(
          () =>
            new Promise((res) => {
              const out = [];
              let revivedAt = null;
              const t0 = performance.now();
              const step = () => {
                const s = window.__starwish.getPlayer();
                const c = window.__starwish.combat();
                const lag = window.__starwish.cameraLag();
                const t = performance.now();
                if (revivedAt === null && !c.down && t - t0 > 500) revivedAt = t;
                if (revivedAt !== null) out.push({ t: (t - revivedAt) / 1000, lag, x: s.x, z: s.z });
                if (revivedAt !== null && t - revivedAt > 1500) res(out);
                else if (t - t0 > 6000) res(out);
                else requestAnimationFrame(step);
              };
              requestAnimationFrame(step);
            }),
        );
        await page.waitForFunction(() => window.__starwish.autoplayState()?.phase === "done", null, { timeout: 90000 });
        const r = (await page.evaluate(() => window.__starwish.autoplayState())).result;
        const fell = Math.hypot(p0.x, p0.z);
        const peak = Math.max(0, ...trace.map((f) => f.lag));
        const settle = trace.find((f) => f.lag < 0.6)?.t ?? null;
        const follow = r.checks.find((c) => c.name.includes("一般移動時"));
        const rev = r.checks.find((c) => c.name.includes("復活傳送"));
        run.results.push({ tag, fellFromSpawn: +fell.toFixed(2), peakLagAfterRevive: +peak.toFixed(2), settleSec: settle, checks: r.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}（${c.detail}）`) });
        check(`${tag}：倒地時離出生點有一段距離（重現條件）`, fell > 3, { fell });
        check(`${tag}：復活瞬間鏡頭偏離約等於傳送距離（原因：鏡頭平滑追上傳送後的玩家）`, trace.length > 0 && peak > 3, { peak, fell });
        check(`${tag}：鏡頭 1 秒內追上（偏離 < 0.6 公尺）`, settle !== null && settle < 1, { settle });
        check(`${tag}：自動判定「一般移動時鏡頭跟隨」通過（不含復活追趕）`, !!follow?.ok, follow);
        check(`${tag}：自動判定另列復活檢查且通過`, !!rev?.ok && /復活 1 次/.test(rev.detail), rev);
      } catch (e) {
        run.errors.push(`${tag} exception: ${e.message}`);
      }
      await ctx.close();
    }
    // 受擊規則：普通攻擊不擊退、不硬直（正式）；control 受擊的擊退／硬直／連續受擊抗性保留給未來技能
    {
      const tag = "受擊規則";
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => run.errors.push(`${tag} pageerror: ${e.message}`));
      try {
        await page.goto(server.url + "/?bobo=v38r&quality=low", { waitUntil: "load" });
        await page.waitForFunction(() => window.__starwish?.ready === true, null, { timeout: 45000 });
        // 1. 規則：第 1、2、3 擊與免疫（每下只扣 1，避免打死；用遊戲的受擊規則）
        const tiers = await page.evaluate(async () => {
          const api = window.__starwish;
          const id = api.monsters()[0].id;
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const out = [];
          for (let k = 0; k < 4; k++) {
            const r = api.hitMonster(id, 1, "control");
            await new Promise((r2) => requestAnimationFrame(() => requestAnimationFrame(r2)));
            const m = api.monsters().find((x) => x.id === id);
            out.push({ tier: r.reaction?.tier, immune: r.reaction?.immune, state: m.state, hitDuration: m.hitDuration, hp: m.hp, combo: m.hitCombo, immuneLeft: m.hitImmune });
            await wait(300);
          }
          // 等「遊戲時間」過 2 秒未受擊（CI 很慢時遊戲時間會比實際時間慢，每幀上限 0.1 秒）
          const t0 = performance.now();
          const comboWhileWaiting = api.monsters().find((x) => x.id === id).hitCombo;
          while (api.monsters().find((x) => x.id === id).hitCombo !== 0 && performance.now() - t0 < 15000) await wait(100);
          const after = api.monsters().find((x) => x.id === id);
          const r5 = api.hitMonster(id, 1, "control");
          // 受擊反應在下一幀由 MonsterController 通知視覺
          await new Promise((r2) => requestAnimationFrame(() => requestAnimationFrame(r2)));
          const anim = api.monsters().find((x) => x.id === id).anim;
          return { out, comboWhileWaiting, comboAfter: after.hitCombo, tierAfterReset: r5.reaction?.tier, reactions: anim?.reactions ?? null };
        });
        run.results.push({ tag: `${tag}：規則`, tiers });
        const o = tiers.out;
        check(`${tag}：control（未來技能）第 1 擊硬直 0.25 秒、第 2 擊 0.15 秒（進入受擊）`, o[0].tier === 1 && o[0].state === "hit" && Math.abs(o[0].hitDuration - 0.25) < 1e-9 && o[1].tier === 2 && Math.abs(o[1].hitDuration - 0.15) < 1e-9, o);
        check(`${tag}：control 第 3 擊不硬直並開始免疫；免疫中受擊不硬直`, o[2].tier === 3 && o[2].state !== "hit" && o[2].immuneLeft > 1 && o[3].immune === true && o[3].state !== "hit", o);
        check(`${tag}：control 免疫中照常扣血（每下 1）`, o.map((x) => x.hp).join(",") === "59,58,57,56", o.map((x) => x.hp));
        check(`${tag}：control 2 秒未受擊後回到第 1 擊`, tiers.comboWhileWaiting === 3 && tiers.comboAfter === 0 && tiers.tierAfterReset === 1, tiers);
        check(`${tag}：control 畫面反應（完整後退、後退減半、不硬直閃表情）都有出現`, !!tiers.reactions && tiers.reactions.full >= 2 && tiers.reactions.reduced >= 1 && tiers.reactions.noStagger >= 2, tiers.reactions);
        // 2. 普通攻擊（hitMonster 預設 normal）：只扣血與受擊表情，狀態與位置不受影響
        const normal = await page.evaluate(async () => {
          const api = window.__starwish;
          api.resetTest();
          await new Promise((r) => setTimeout(r, 300));
          const id = api.monsters()[1].id;
          const b = api.monsters().find((x) => x.id === id);
          const r = api.hitMonster(id, 20);
          const a = api.monsters().find((x) => x.id === id);
          await new Promise((r2) => requestAnimationFrame(() => requestAnimationFrame(r2)));
          const f = api.monsters().find((x) => x.id === id);
          return { kind: r.reaction?.kind, stagger: r.reaction?.stagger, before: { state: b.state, hp: b.hp, x: b.x, z: b.z, hurt: b.anim.starts.hurt }, after: { state: a.state, hp: a.hp, x: a.x, z: a.z }, face: f.anim.face, hurt: f.anim.starts.hurt, combo: f.hitCombo };
        });
        run.results.push({ tag: `${tag}：普通攻擊`, tiers: normal });
        check(
          `${tag}：普通攻擊只扣血與受擊表情；不進入受擊、不播受傷動作、不推動位置、不累計連續受擊`,
          normal.kind === "normal" && normal.stagger === 0 && normal.after.hp === normal.before.hp - 20 && normal.after.state === normal.before.state && normal.after.x === normal.before.x && normal.after.z === normal.before.z && normal.face === "hurt" && normal.hurt === normal.before.hurt && normal.combo === 0,
          normal,
        );
        // 3. 實際遊玩：玩家站著持續普通攻擊 25 秒，怪物要照常追擊、出手並真的打到玩家
        await page.evaluate(() => {
          const api = window.__starwish;
          api.resetTest();
          const m = api.monsters()[0];
          api.teleport(m.x + 1.0, m.z);
        });
        const fight = await page.evaluate(
          () =>
            new Promise((res) => {
              const api = window.__starwish;
              const t0 = performance.now();
              const log = { samples: 0, cancelledAlive: 0, hurtStarts: 0, maxRecoil: 0, maxHitStreak: 0, hitsTakenStart: api.combat().hitsTaken, playerHitsByMonster: 0, monsterHitByPlayer: 0, landedAfterHit: false, deaths: 0, nan: 0 };
              const hitSince = new Map();
              let firstPlayerHit = null;
              let prevTaken = log.hitsTakenStart;
              let prevPlayerHits = api.attackState().hits;
              const prevState = new Map();
              const prevCancel = new Map();
              const prevHurt = new Map();
              const prevDist = new Map();
              let lastP = api.getPlayer();
              const step = () => {
                const now = performance.now();
                api.attack();
                const pp = api.getPlayer();
                if (Math.hypot(pp.x - lastP.x, pp.z - lastP.z) > 0.5) prevDist.clear(); // 玩家倒地後回出生點
                lastP = pp;
                const ms = api.monsters();
                for (const m of ms) {
                  if (!Number.isFinite(m.x) || !Number.isFinite(m.z) || !Number.isFinite(m.hp)) log.nan++;
                  if (m.state === "hit") {
                    if (!hitSince.has(m.id)) hitSince.set(m.id, now);
                    log.maxHitStreak = Math.max(log.maxHitStreak, (now - hitSince.get(m.id)) / 1000);
                  } else hitSince.delete(m.id);
                  if (m.state === "death" && prevState.get(m.id) !== "death") log.deaths++;
                  prevState.set(m.id, m.state);
                  if (prevCancel.has(m.id) && m.attackLog.cancelled !== prevCancel.get(m.id) && m.state !== "death") log.cancelledAlive++;
                  prevCancel.set(m.id, m.attackLog.cancelled);
                  if (m.anim) {
                    if (prevHurt.has(m.id) && m.anim.starts.hurt > prevHurt.get(m.id)) log.hurtStarts += m.anim.starts.hurt - prevHurt.get(m.id);
                    prevHurt.set(m.id, m.anim.starts.hurt);
                  }
                  // 被打的那一刻有沒有被推離玩家（同一取樣間隔內距離變大的量；怪物只會走向玩家）
                  const p = api.getPlayer();
                  const d = Math.hypot(m.x - p.x, m.z - p.z);
                  if (prevDist.has(m.id) && (m.mode === "chase" || m.mode === "attack") && !api.combat().down) log.maxRecoil = Math.max(log.maxRecoil, d - prevDist.get(m.id));
                  prevDist.set(m.id, d);
                }
                const ph = api.attackState().hits;
                if (ph > prevPlayerHits) {
                  log.monsterHitByPlayer += ph - prevPlayerHits;
                  if (firstPlayerHit === null) firstPlayerHit = now;
                  prevPlayerHits = ph;
                }
                const taken = api.combat().hitsTaken;
                if (taken > prevTaken) {
                  log.playerHitsByMonster += taken - prevTaken;
                  if (firstPlayerHit !== null) log.landedAfterHit = true;
                  prevTaken = taken;
                }
                log.samples++;
                if (now - t0 > 25000) res(log);
                else setTimeout(step, 50);
              };
              step();
            }),
        );
        run.results.push({ tag: `${tag}：持續攻擊 25 秒`, fight });
        check(`${tag}：持續攻擊 25 秒，玩家有打中怪物、怪物有被擊倒`, fight.monsterHitByPlayer >= 10 && fight.deaths >= 1, fight);
        check(`${tag}：玩家開始攻擊後，怪物仍能恢復並真的打到玩家`, fight.landedAfterHit && fight.playerHitsByMonster >= 2, fight);
        check(`${tag}：持續普通攻擊 25 秒，沒有怪物進入受擊硬直、沒有播受傷動作、活著時攻擊沒有被取消`, fight.maxHitStreak === 0 && fight.hurtStarts === 0 && fight.cancelledAlive === 0, fight);
        check(`${tag}：被打時沒有被推離玩家（取樣間距離最多變大 0.3 公尺，含怪物彼此推開）`, fight.maxRecoil < 0.3, fight.maxRecoil);
        check(`${tag}：怪物狀態與位置正常（無 NaN）`, fight.nan === 0, fight.nan);
      } catch (e) {
        run.errors.push(`${tag} exception: ${e.message}`);
      }
      await ctx.close();
    }
    // 一般遊戲不受影響：沒有 autoplay 參數時 count 無效、怪物 3 隻
    {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
      const page = await ctx.newPage();
      try {
        await page.goto(server.url + "/?bobo=v38r&count=10", { waitUntil: "load" });
        await page.waitForFunction(() => window.__starwish?.ready === true, null, { timeout: 45000 });
        const n = await page.evaluate(() => ({ n: window.__starwish.monsters().length, st: window.__starwish.autoplayState(), banner: !!document.querySelector(".autoplay-banner") }));
        check("一般遊戲（不加 autoplay）不啟用測試、怪物維持 3 隻", n.n === 3 && n.st === null && !n.banner, n);
      } catch (e) {
        run.errors.push(`normal exception: ${e.message}`);
      }
      await ctx.close();
    }
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 4;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${run.viewport}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 700)}`);
    for (const r of run.results) if (r.tiers || r.fight) console.log(`   · ${r.tag}: ${JSON.stringify(r.tiers ?? r.fight)}`);
    else if (!r.summary) console.log(`   · ${r.tag}: 倒地處離出生點 ${r.fellFromSpawn} m、復活後鏡頭最大偏離 ${r.peakLagAfterRevive} m、${r.settleSec?.toFixed(2)} 秒追上 | ${r.checks.join(" / ")}`);
    else console.log(`   · ${r.tag}: avg ${r.summary.avgFps.toFixed(1)}, 1%low ${r.summary.low1Fps.toFixed(1)}, min ${r.summary.minFps.toFixed(1)}, draw ${r.summary.avgDrawCalls.toFixed(1)} | ${JSON.stringify(r.counters)}`);
    for (const e of run.errors) console.log(`   ! ${e}`);
  }

  // ---------- Stage 5.4：男女初心者角色預覽（?lab=novice；GLB、共用骨架、6 段動畫、表情、效能測試）----------
  {
    const vp = VIEWPORTS[0];
    const run = { browser: name, viewport: `${vp.name} / Stage 5.4 男女初心者角色預覽 ?lab=novice`, checks: {}, errors: [], screenshots: [], results: [] };
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };
    const shot = async (page, label) => {
      const f = `${outDir}${name}_novice_${label}.png`;
      await page.screenshot({ path: f });
      run.screenshots.push(f.split("/test-results/")[1]);
    };
    const qs = name === "webkit" ? ["high", "low"] : ["high"];
    for (const q of qs) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => run.errors.push(`${q} pageerror: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && run.errors.push(`${q} console: ${m.text()}`));
      try {
        await page.goto(server.url + `/?lab=novice&quality=${q}`, { waitUntil: "load" });
        await page.waitForFunction(() => window.__starwishNovice?.ready === true, null, { timeout: 60000 });
        await page.waitForTimeout(800);
        const info = await page.evaluate(() => window.__starwishNovice.info());
        const chars = await page.evaluate(() => window.__starwishNovice.chars());
        run.results.push({ tag: `novice ${q}`, info, chars });
        check(`${q}：男女兩個角色載入（GLB 蒙皮網格，各 3 個網格、18 根骨頭）`, chars.length === 2 && chars.every((c) => c.meshes === 3 && c.bones === 18) && chars[0].gender === "male" && chars[1].gender === "female", chars);
        check(`${q}：男女骨架相同（名稱與順序）`, info.bones.length === 2 && info.bones[0].length === 18 && info.bones[0].join() === info.bones[1].join(), info.bones);
        check(`${q}：6 段動畫都在（待機、走路、跑步、攻擊、受傷、死亡）`, ["Idle", "Walk", "Run", "Attack", "Hurt", "Death"].every((a) => info.animations.includes(a)), info.animations);
        check(`${q}：角色身高約 1.1～1.25 公尺（與遊戲角色相同比例）`, chars.every((c) => c.height > 1.05 && c.height < 1.3), chars.map((c) => c.height));
        check(`${q}：模型三角形（每個角色 6,000～12,500）`, chars.every((c) => c.triangles >= 6000 && c.triangles <= 12500), chars.map((c) => c.triangles));
        if (q === "high") check(`${q}：畫質設定與遊戲相同（PCSS32 陰影、HDR、MSAA 4x）`, info.shadowQuality === 1 && info.hdr === true && info.msaa === 4, info);
        // 動畫真的在動：同一動畫隔一段時間，影格不同；死亡後躺下（高度明顯變低）
        const anims = {};
        for (const a of ["Idle", "Walk", "Run", "Attack", "Hurt", "Death"]) {
          await page.evaluate((x) => window.__starwishNovice.play(x), a);
          await page.waitForTimeout(120);
          const f0 = await page.evaluate(() => window.__starwishNovice.chars());
          await page.waitForTimeout(250);
          // 單次動畫：等它真的播完（CI 沒有 GPU、每秒只有幾格，不能用固定時間）
          if (a === "Attack" || a === "Hurt") await page.waitForFunction(() => window.__starwishNovice.chars().every((c) => c.anim === "Idle"), null, { timeout: 15000 }).catch(() => {});
          if (a === "Death") await page.waitForFunction(() => window.__starwishNovice.chars().every((c) => c.playing.length === 0), null, { timeout: 15000 }).catch(() => {});
          const f1 = await page.evaluate(() => window.__starwishNovice.chars());
          anims[a] = { playing0: f0.map((c) => c.playing), frame0: f0.map((c) => c.frame), frame1: f1.map((c) => c.frame), height1: f1.map((c) => +c.height.toFixed(3)), anim1: f1.map((c) => c.anim), expr: f1.map((c) => c.expr) };
          if (q === "high" && name === "webkit") await shot(page, `${a.toLowerCase()}`);
        }
        run.results.push({ tag: `novice ${q} anims`, anims });
        check(`${q}：循環動畫（待機、走路、跑步）播放中且影格前進`, ["Idle", "Walk", "Run"].every((a) => anims[a].playing0.every((p) => p.includes(a)) && anims[a].frame1.every((f, i) => f !== anims[a].frame0[i])), anims);
        check(`${q}：攻擊、受傷播完回到待機`, anims.Attack.anim1.every((x) => x === "Idle") && anims.Hurt.anim1.every((x) => x === "Idle"), { a: anims.Attack, h: anims.Hurt });
        check(`${q}：死亡後倒在地上（高度 < 0.7 公尺）、表情倒下`, anims.Death.height1.every((h) => h < 0.7) && anims.Death.expr.every((e) => e === "ko"), anims.Death);
        // 表情切換、三視圖截圖
        await page.evaluate(() => window.__starwishNovice.play("Idle"));
        // 等待機姿勢真的套用（影格前進、站起來）再暫停
        await page.waitForFunction(() => window.__starwishNovice.chars().every((c) => c.frame > 2 && c.height > 1), null, { timeout: 15000 }).catch(() => {});
        await page.evaluate(() => window.__starwishNovice.freeze(true));
        for (const v of ["front", "side", "back"]) {
          await page.evaluate((x) => window.__starwishNovice.view(x), v);
          await page.waitForTimeout(400);
          await shot(page, `${q}_${v}`);
        }
        await page.evaluate(() => window.__starwishNovice.view("front"));
        for (const e of ["serious", "happy", "hurt"]) {
          await page.evaluate((x) => window.__starwishNovice.expression(x), e);
          await page.waitForTimeout(250);
          if (q === "high") await shot(page, `${q}_expr_${e}`);
        }
        const ex = await page.evaluate(() => window.__starwishNovice.chars().map((c) => c.expr));
        check(`${q}：表情切換`, ex.every((e) => e === "hurt"), ex);
      } catch (e) {
        run.errors.push(`${q} exception: ${e.message}`);
      }
      await ctx.close();
    }
    // 效能測試（CI 無 GPU，只檢查流程與數據完整；FPS 不代表 iPhone）
    {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => run.errors.push(`bench pageerror: ${e.message}`));
      try {
        await page.goto(server.url + "/?lab=novice&quality=high&bench=1&count=10&anim=Run&dur=4&warmup=1", { waitUntil: "load" });
        await page.waitForFunction(() => window.__starwishNovice?.ready === true, null, { timeout: 60000 });
        await page.waitForFunction(() => window.__starwishNovice.bench().state === "done", null, { timeout: 120000 });
        const b = await page.evaluate(() => window.__starwishNovice.bench());
        const chars = await page.evaluate(() => window.__starwishNovice.chars());
        const panel = await page.evaluate(() => document.querySelector("[data-novice-bench]")?.textContent ?? "");
        run.results.push({ tag: "novice bench 10 Run", bench: b.result });
        check("效能測試：10 個角色（男女各 5）跑步，產生平均／1% Low／Draw Calls 結果面板", chars.length === 10 && chars.filter((c) => c.gender === "male").length === 5 && b.result && b.result.frames > 0 && b.result.avgDrawCalls > 0 && /角色效能測試結果/.test(panel), { r: b.result, panel });
        await shot(page, "bench10");
      } catch (e) {
        run.errors.push(`bench exception: ${e.message}`);
      }
      await ctx.close();
    }
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 8;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${run.viewport}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 900)}`);
    for (const r of run.results) if (r.bench) console.log(`   · ${r.tag}: ${JSON.stringify(r.bench)}`);
    for (const r of run.results) if (r.breakdown) console.log(`   · ${r.tag}: ${JSON.stringify(r.breakdown)}`);
    for (const e of run.errors) console.log(`   ! ${e}`);
  }

  // ---------- Stage 5.4 C1.0-B：男女初心者實機整合測試（?lab=c10b；靜態 GLB、HQ／Lite、低角度、效能測試流程）----------
  {
    const vp = VIEWPORTS[0];
    const run = { browser: name, viewport: `${vp.name} / Stage 5.4 C1.0-B 實機整合測試 ?lab=c10b`, checks: {}, errors: [], screenshots: [], results: [] };
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };
    const shot = async (page, label) => {
      const f = `${outDir}${name}_c10b_${label}.png`;
      await page.screenshot({ path: f });
      run.screenshots.push(f.split("/test-results/")[1]);
    };
    // 換視角後等 3 個影格真的畫出來再截圖（CI 沒有 GPU、每秒只有一兩格）
    const settle = (page) => page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n >= 3 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
    try {
      await page.goto(server.url + "/?lab=c10b&quality=high", { waitUntil: "load" });
      await page.waitForFunction(() => window.__starwishC10b?.ready === true, null, { timeout: 120000 });
      await page.waitForTimeout(800);
      const hq = await page.evaluate(() => window.__starwishC10b.info());
      run.results.push({ tag: "c10b hq", info: hq });
      check("HQ：男女兩個角色載入（男 32、女 31 個網格）", hq.chars.length === 2 && hq.chars[0].gender === "male" && hq.chars[0].meshes === 32 && hq.chars[1].meshes === 31, hq.chars);
      check("HQ：每個角色約 20 萬三角形（與 GLB 相同）", hq.chars.every((c) => c.triangles > 195000 && c.triangles < 205000), hq.chars.map((c) => c.triangles));
      check("HQ：身高 1.0～1.35 公尺（與靜態展示同比例）", hq.chars.every((c) => c.height > 1.0 && c.height < 1.35), hq.chars.map((c) => c.height));
      check("角色站在廣場地台上（腳底高度 ≈ 地台頂面）", hq.feet.every((y) => Math.abs(y - hq.baseY) < 0.03), { feet: hq.feet, base: hq.baseY });
      check("靜態模型：沒有骨架與動畫（不宣稱動畫完成）", hq.chars.every((c) => !c.skeleton && c.animations === 0), hq.chars);
      check("沒有半透明材質（不會有透明排序錯誤）", hq.transparentMaterials.length === 0, hq.transparentMaterials);
      check("金色金屬掛上環境反射（避免發黑）", hq.metalWithProbe >= 2, hq.metalWithProbe);
      check("畫質設定與遊戲相同（PCSS32 陰影、HDR、MSAA 4x）", hq.shadowQuality === 1 && hq.hdr === true && hq.msaa === 4, hq);
      check("載入時間有記錄", hq.loads.length === 1 && hq.loads[0].ms > 0 && hq.loads[0].files.length === 2, hq.loads);
      for (const v of ["front", "left45", "side", "back", "low", "lowBack", "head", "skirt"]) {
        await page.evaluate((x) => window.__starwishC10b.view(x), v);
        await settle(page);
        await shot(page, `hq_${v}`);
      }
      await page.evaluate(() => window.__starwishC10b.setLod("lite"));
      await page.waitForFunction(() => window.__starwishC10b.lod === "lite" && !window.__starwishC10b.loading, null, { timeout: 120000 });
      await page.waitForTimeout(500);
      const lite = await page.evaluate(() => window.__starwishC10b.info());
      run.results.push({ tag: "c10b lite", info: lite });
      check("HQ → Lite 切換：每個角色約 4 萬三角形、仍是 2 個角色", lite.chars.length === 2 && lite.chars.every((c) => c.triangles > 38000 && c.triangles < 42000), lite.chars.map((c) => c.triangles));
      check("Lite 身高與 HQ 相同（±1 公分）", lite.chars.every((c, i) => Math.abs(c.height - hq.chars[i].height) < 0.01), [hq.chars.map((c) => c.height), lite.chars.map((c) => c.height)]);
      for (const v of ["front", "low", "skirt"]) {
        await page.evaluate((x) => window.__starwishC10b.view(x), v);
        await settle(page);
        await shot(page, `lite_${v}`);
      }
      await page.evaluate(() => window.__starwishC10b.setLod("hq"));
      await page.waitForFunction(() => window.__starwishC10b.lod === "hq" && !window.__starwishC10b.loading, null, { timeout: 120000 });
      // 效能測試流程（CI 沒有 GPU：只檢查流程與數據完整；FPS 不代表 iPhone）
      await page.evaluate(() => window.__starwishC10b.bench(4, "CI 4 秒"));
      await page.waitForFunction(() => window.__starwishC10b.benchState().state === "done", null, { timeout: 180000 });
      const b = await page.evaluate(() => window.__starwishC10b.benchState());
      const rep = await page.evaluate(() => window.__starwishC10b.report());
      const after = await page.evaluate(() => window.__starwishC10b.info());
      run.results.push({ tag: "c10b bench", bench: b.result, report: rep });
      check("效能測試產生平均／1% Low／卡頓結果、報告文字", !!b.result && b.result.frames > 0 && b.result.avgDrawCalls > 0 && /平均/.test(rep) && /載入/.test(rep), { r: b.result });
      check("HQ ↔ Lite 來回切換 3 次載入、沒有 WebGL Context Lost", after.loads.length === 3 && after.contextLost === 0, { loads: after.loads, lost: after.contextLost });
      // C1.0-P 效能分析：Draw Calls 分項（高畫質 HQ／Lite；之後再開中畫質頁量一次）
      for (const l of ["hq", "lite"]) {
        await page.evaluate((x) => window.__starwishC10b.setLod(x), l);
        await page.waitForFunction((x) => window.__starwishC10b.lod === x && !window.__starwishC10b.loading, l, { timeout: 120000 });
        await page.evaluate(() => window.__starwishC10b.view("front"));
        const bd = await page.evaluate(() => window.__starwishC10b.breakdown());
        run.results.push({ tag: `c10p breakdown high ${l}`, breakdown: bd });
      }
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }
    // 中畫質（iPhone 預設）也量一次 Draw Calls 分項
    try {
      const p2 = await ctx.newPage();
      await p2.goto(server.url + "/?lab=c10b&quality=medium", { waitUntil: "load" });
      await p2.waitForFunction(() => window.__starwishC10b?.ready === true, null, { timeout: 120000 });
      for (const l of ["hq", "lite"]) {
        await p2.evaluate((x) => window.__starwishC10b.setLod(x), l);
        await p2.waitForFunction((x) => window.__starwishC10b.lod === x && !window.__starwishC10b.loading, l, { timeout: 120000 });
        const bd = await p2.evaluate(() => window.__starwishC10b.breakdown());
        run.results.push({ tag: `c10p breakdown medium ${l}`, breakdown: bd });
      }
      await p2.close();
    } catch (e) {
      run.errors.push(`medium breakdown: ${e.message}`);
    }
    await ctx.close();
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 12;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${run.viewport}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 900)}`);
    for (const r of run.results) if (r.bench) console.log(`   · ${r.tag}: ${JSON.stringify(r.bench)}`);
    for (const r of run.results) if (r.breakdown) console.log(`   · ${r.tag}: ${JSON.stringify(r.breakdown)}`);
    for (const r of run.results) if (r.info) console.log(`   · ${r.tag}: loads ${JSON.stringify(r.info.loads)} gpu ${r.info.gpuMemMB} MB draw ${r.info.drawCalls} tex ${JSON.stringify(r.info.textures)}`);
    for (const e of run.errors) console.log(`   ! ${e}`);
  }

  // ---------- C1.0-P 第一階段 P1：發光層 A/B（A0 原始 vs A1 只處理發光物件；高畫質、同鏡頭）----------
  {
    const vp = VIEWPORTS[0];
    const run = { browser: name, viewport: `${vp.name} / C1.0-P P1 發光層 A/B ?lab=c10b&p1=1`, checks: {}, errors: [], screenshots: [], results: [] };
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };
    const settle = (page) => page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n >= 3 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
    const VIEWS = ["front", "left45", "back", "low", "head", "skirt"];
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
    const shots = {};
    const bds = {};
    try {
      for (const [ab, q] of [["A0", ""], ["A0b", ""], ["A1", "&p1=1"], ["A2", "&p1=1&p2=1"]]) {
        const page = await ctx.newPage();
        page.on("pageerror", (e) => run.errors.push(`${ab} pageerror: ${e.message}`));
        await page.goto(server.url + `/?lab=c10b&quality=high${q}`, { waitUntil: "load" });
        await page.waitForFunction(() => window.__starwishC10b?.ready === true, null, { timeout: 120000 });
        bds[ab] = { hq: await page.evaluate(() => window.__starwishC10b.breakdown()) };
        shots[ab] = {};
        for (const v of VIEWS) {
          await page.evaluate((x) => window.__starwishC10b.view(x), v);
          await settle(page);
          // 截圖前隱藏介面（A0／A1 標題文字不同，避免算進畫面差異）
          await page.evaluate(() => document.querySelectorAll(".v3-top,.lab-panel,.perf-panel,.lab-bench-result").forEach((e) => (e.style.visibility = "hidden")));
          const f = `${outDir}${name}_c10p_${ab}_hq_${v}.png`;
          shots[ab][v] = await page.screenshot({ path: ab === "A0b" ? undefined : f });
          if (ab !== "A0b") run.screenshots.push(f.split("/test-results/")[1]);
        }
        await page.evaluate(() => window.__starwishC10b.setLod("lite"));
        await page.waitForFunction(() => window.__starwishC10b.lod === "lite" && !window.__starwishC10b.loading, null, { timeout: 120000 });
        bds[ab].lite = await page.evaluate(() => window.__starwishC10b.breakdown());
        await page.close();
      }
      // 逐像素差異（在瀏覽器裡解 PNG）：A0 vs A0b（同設定重拍 = 雜訊底線）、A0 vs A1
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
      for (const v of VIEWS) diffs[v] = { noise: await diff(shots.A0[v], shots.A0b[v]), p1: await diff(shots.A0[v], shots.A1[v]), p2: await diff(shots.A1[v], shots.A2[v]) };
      await dp.close();
      run.results.push({ tag: "c10p P1", breakdown: bds, diffs });
      check("A0 與重拍 A0b 的 Draw Calls 相同（量測可重現）", bds.A0.hq.draws.all === bds.A0b.hq.draws.all, [bds.A0.hq.draws, bds.A0b.hq.draws]);
      check("P1：發光層排除角色（關掉發光層時角色 Draw Calls 不再減少）", bds.A1.hq.share.glowLayer < bds.A0.hq.share.glowLayer && bds.A1.hq.glow.excluded > 0, [bds.A0.hq.share, bds.A1.hq.share]);
      check("P1：HQ 總 Draw Calls 下降", bds.A1.hq.draws.all < bds.A0.hq.draws.all, [bds.A0.hq.draws.all, bds.A1.hq.draws.all]);
      check("P1：Lite 總 Draw Calls 下降", bds.A1.lite.draws.all < bds.A0.lite.draws.all, [bds.A0.lite.draws.all, bds.A1.lite.draws.all]);
      check("P1：每格處理的三角形下降（HQ）", bds.A1.hq.tris.mainPass < bds.A0.hq.tris.mainPass, [bds.A0.hq.tris, bds.A1.hq.tris]);
      check("P2：角色網格數下降（男 32→、女 31→）", bds.A2.hq.meshes.character < bds.A1.hq.meshes.character && !!bds.A2.hq.merge, [bds.A1.hq.meshes, bds.A2.hq.meshes, bds.A2.hq.merge]);
      check("P2：HQ 與 Lite 總 Draw Calls 下降", bds.A2.hq.draws.all < bds.A1.hq.draws.all && bds.A2.lite.draws.all < bds.A1.lite.draws.all, [bds.A1.hq.draws.all, bds.A2.hq.draws.all, bds.A1.lite.draws.all, bds.A2.lite.draws.all]);
      check("P2：三角形數不變（只合併、不減面）", bds.A2.hq.tris.mainPass === bds.A1.hq.tris.mainPass && bds.A2.lite.tris.mainPass === bds.A1.lite.tris.mainPass, [bds.A1.hq.tris, bds.A2.hq.tris]);
      // P3 診斷工具：GPU 探測＋診斷開關＋時間軸（只檢查流程；CI 無 GPU，數字不代表 iPhone）
      {
        const pg = await ctx.newPage();
        pg.on("pageerror", (e) => run.errors.push(`diag pageerror: ${e.message}`));
        await pg.goto(server.url + "/?lab=c10b&quality=high&p1=1&p2=1&gpu=1&diag=noshadow,noglow", { waitUntil: "load" });
        await pg.waitForFunction(() => window.__starwishC10b?.ready === true, null, { timeout: 120000 });
        const bd = await pg.evaluate(() => window.__starwishC10b.breakdown());
        await pg.evaluate(() => window.__starwishC10b.bench(6, "CI 診斷 6 秒"));
        await pg.waitForFunction(() => window.__starwishC10b.benchState().state === "done", null, { timeout: 240000 });
        const br = await pg.evaluate(() => window.__starwishC10b.benchState().result);
        const rep = await pg.evaluate(() => window.__starwishC10b.report());
        run.results.push({ tag: "c10p P3 diag", breakdown: bd, bench: br });
        check("P3 診斷：關陰影＋關發光時陰影與發光層都是 0 個繪製", bd.share.shadowMap === 0 && bd.share.glowLayer === 0 && bd.draws.all < bds.A2.hq.draws.all, [bd.draws, bd.share]);
        check("P3 診斷：時間軸含 CPU 時間、GPU 探測、解析度紀錄", !!br && br.timeline.length >= 1 && br.timeline.some((w) => w.gpuN > 0) && br.sizeChanges === 0 && /時間軸/.test(rep) && /診斷開關/.test(rep), br && { tl: br.timeline, sz: br.renderSize });
        await pg.close();
      }
      check("P2：A1 與 A2 畫面逐像素比較（不同像素 ≤ 0.05%）", VIEWS.every((v) => diffs[v].p2.changedPct <= 0.05), Object.fromEntries(VIEWS.map((v) => [v, diffs[v].p2])));
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }
    await ctx.close();
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 5;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${run.viewport}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 900)}`);
    for (const r of run.results) console.log(`   · ${r.tag}: ${JSON.stringify(r)}`);
    for (const e of run.errors) console.log(`   ! ${e}`);
  }

  // ---------- C1.0-P P3-1：陰影診斷模式（WebKit；只檢查模式與量測正確，CI 沒有 GPU，FPS 不代表 iPhone）----------
  if (name === "webkit") {
    const vp = VIEWPORTS[0];
    const run = { browser: name, viewport: `${vp.name} / C1.0-P P3-1 陰影診斷 S0～S4`, checks: {}, errors: [], screenshots: [], results: [] };
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };
    const frames = (page, n) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
    const BASE = "/?lab=c10b&quality=high&p1=1&p2=1";
    const VIEWS = ["front", "left45", "back", "low"];
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
    const open = async (q) => {
      const page = await ctx.newPage();
      page.on("pageerror", (e) => run.errors.push(`${q} pageerror: ${e.message}`));
      await page.goto(server.url + BASE + q, { waitUntil: "load" });
      await page.waitForFunction(() => window.__starwishC10b?.ready === true, null, { timeout: 120000 });
      return page;
    };
    const shots = {};
    const take = async (page, tag) => {
      shots[tag] = {};
      await page.evaluate(() => document.querySelectorAll(".v3-top,.lab-panel,.perf-panel,.lab-bench-result").forEach((e) => (e.style.visibility = "hidden")));
      for (const v of VIEWS) {
        await page.evaluate((x) => window.__starwishC10b.view(x), v);
        await frames(page, 3);
        const f = `${outDir}${name}_c10p_p31_${tag}_${v}.png`;
        shots[tag][v] = await page.screenshot({ path: f });
        run.screenshots.push(f.split("/test-results/")[1]);
      }
    };
    try {
      // S0：每格重畫陰影貼圖
      const p0 = await open("&gpu=1");
      await frames(p0, 3);
      const s0a = await p0.evaluate(() => window.__starwishC10b.shadowState());
      await frames(p0, 4);
      const s0b = await p0.evaluate(() => window.__starwishC10b.shadowState());
      run.results.push({ tag: "S0", a: s0a, b: s0b });
      check("S0：陰影貼圖每格重畫（4 格內更新 ≥4 次）、PCSS32 中品質、2048", s0b.renders - s0a.renders >= 4 && s0b.contact && s0b.filteringQuality === 1 && s0b.mapSize === 2048, [s0a, s0b]);
      check("S0：陰影貼圖每次約 28 個 Draw（角色 24＋草原 4）", s0b.lastFrameShadowDraws >= 20 && s0b.lastFrameShadowDraws <= 40, s0b);
      await take(p0, "S0");
      await p0.close();

      // S2：陰影貼圖只畫一次
      const p2 = await open("&gpu=1&shadowrefresh=once");
      await p2.waitForFunction(() => window.__starwishC10b.shadowState().frozenAt !== null, null, { timeout: 120000 });
      await frames(p2, 3);
      const s2a = await p2.evaluate(() => window.__starwishC10b.shadowState());
      await frames(p2, 6);
      const s2b = await p2.evaluate(() => window.__starwishC10b.shadowState());
      run.results.push({ tag: "S2", a: s2a, b: s2b });
      check("S2：凍結後 6 格陰影貼圖更新 0 次、陰影 Draw 0", s2b.renders === s2a.renders && s2b.lastFrameShadowDraws === 0 && s2b.refreshRate === 0, [s2a, s2b]);
      await take(p2, "S2");
      // 切換 Lite 後會重新畫、再凍結
      await p2.evaluate(() => window.__starwishC10b.setLod("lite"));
      await p2.waitForFunction(() => window.__starwishC10b.lod === "lite" && !window.__starwishC10b.loading, null, { timeout: 120000 });
      await p2.waitForFunction(() => window.__starwishC10b.shadowState().frozenAt !== null, null, { timeout: 120000 });
      const s2c = await p2.evaluate(() => window.__starwishC10b.shadowState());
      check("S2：切換 Lite 後陰影貼圖重新畫並再次凍結", s2c.renders > s2b.renders && s2c.frozenAt !== null, s2c);
      await p2.close();

      // 逐像素比較 S0 vs S2
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
          let changed = 0, max = 0;
          for (let k = 0; k < da.length; k += 4) {
            const d = Math.max(Math.abs(da[k] - db[k]), Math.abs(da[k + 1] - db[k + 1]), Math.abs(da[k + 2] - db[k + 2]));
            if (d > max) max = d;
            if (d > 8) changed++;
          }
          return { changedPct: +((changed / (da.length / 4)) * 100).toFixed(4), maxDiff: max };
        }, [a.toString("base64"), b.toString("base64")]);
      const diffs = {};
      for (const v of VIEWS) diffs[v] = await diff(shots.S0[v], shots.S2[v]);
      await dp.close();
      run.results.push({ tag: "S0 vs S2 畫面", diffs });
      check("S2 與 S0 截圖相同（每個視角不同像素 ≤ 0.05%）", VIEWS.every((v) => diffs[v].changedPct <= 0.05), diffs);

      // S1、S3、S4 設定生效
      const p1 = await open("&gpu=1&diag=noshadow");
      await frames(p1, 3);
      const s1 = await p1.evaluate(() => window.__starwishC10b.shadowState());
      check("S1：關陰影後陰影貼圖 Draw 0", s1.lastFrameShadowDraws === 0 && s1.casters === 0, s1);
      await p1.close();
      const modes = {};
      for (const [tag, q] of [["S3a", "&shadowfilter=low"], ["S3b", "&shadowfilter=high"], ["S3c", "&shadowfilter=pcf"], ["S4", "&shadowmap=1024"]]) {
        const pg = await open("&gpu=1" + q);
        await frames(pg, 2);
        modes[tag] = await pg.evaluate(() => window.__starwishC10b.shadowState());
        await pg.close();
      }
      run.results.push({ tag: "S3/S4", modes });
      check("S3a：PCSS 低取樣", modes.S3a.contact && modes.S3a.filteringQuality === 2 && /S3a/.test(modes.S3a.mode), modes.S3a);
      check("S3b：PCSS 高取樣", modes.S3b.contact && modes.S3b.filteringQuality === 0 && /S3b/.test(modes.S3b.mode), modes.S3b);
      check("S3c：一般 PCF（非 PCSS）", !modes.S3c.contact && modes.S3c.pcf && /S3c/.test(modes.S3c.mode), modes.S3c);
      check("S4：陰影貼圖 1024、仍是 PCSS32", modes.S4.mapSize === 1024 && modes.S4.contact && modes.S4.filteringQuality === 1, modes.S4);

      // 載入後休息＋自動測試＋畫布鎖定＋報告欄位（S2、不開 GPU 探測）
      const pb = await open("&shadowrefresh=once&rest=3&bench=6&warmup=10&fixsize=1");
      const resting = await pb.evaluate(() => window.__starwishC10b.benchState().state);
      await pb.waitForFunction(() => window.__starwishC10b.benchState().state === "done", null, { timeout: 300000 });
      const br = await pb.evaluate(() => window.__starwishC10b.benchState().result);
      const rep = await pb.evaluate(() => window.__starwishC10b.report());
      run.results.push({ tag: "S2 自動測試", resting, bench: br });
      check("rest=3：載入後先不開始，之後自動測試", resting === "off" && !!br && /載入後先停 3 秒/.test(br.label), { resting, label: br && br.label });
      check("報告：主場景／陰影 Draw、測試期間陰影更新 0 次、GPU 探測關、畫布鎖定、resize 紀錄", !!br && br.shadowRendersInTest === 0 && br.avgShadowDraws === 0 && br.avgMainDraws > 0 && br.gpuProbe === false && br.fixSize === true && Array.isArray(br.resizeEvents) && /陰影模式 S2/.test(rep) && /主場景/.test(rep) && /GPU 探測 關/.test(rep), br);
      await pb.close();
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }
    await ctx.close();
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 11;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${run.viewport}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 900)}`);
    for (const r of run.results) console.log(`   · ${r.tag}: ${JSON.stringify(r)}`.slice(0, 3000));
    for (const e of run.errors) console.log(`   ! ${e}`);
  }

  // ---------- C1.0-P P3-2：優化組合 vs 原始 HQ（含男生披風徽記修正版；WebKit）----------
  if (name === "webkit") {
    const vp = VIEWPORTS[0];
    const run = { browser: name, viewport: `${vp.name} / C1.0-P P3-2 優化組合＋徽記修正`, checks: {}, errors: [], screenshots: [], results: [] };
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };
    const frames = (page, n) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
    const BASE = "/?lab=c10b&quality=high&p1=1&p2=1&star=1";
    const VIEWS = ["front", "left45", "back", "low", "emblem"];
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
    const open = async (q) => {
      const page = await ctx.newPage();
      page.on("pageerror", (e) => run.errors.push(`${q} pageerror: ${e.message}`));
      await page.goto(server.url + BASE + q, { waitUntil: "load" });
      await page.waitForFunction(() => window.__starwishC10b?.ready === true, null, { timeout: 120000 });
      await frames(page, 4);
      return page;
    };
    const shots = {};
    const take = async (page, tag) => {
      shots[tag] = {};
      await page.evaluate(() => document.querySelectorAll(".v3-top,.lab-panel,.perf-panel,.lab-bench-result").forEach((e) => (e.style.visibility = "hidden")));
      for (const v of VIEWS) {
        await page.evaluate((x) => window.__starwishC10b.view(x), v);
        await frames(page, 3);
        const f = `${outDir}${name}_c10p_p32_${tag}_${v}.png`;
        shots[tag][v] = await page.screenshot({ path: f });
        run.screenshots.push(f.split("/test-results/")[1]);
      }
    };
    try {
      const pa = await open("");
      const ra = await pa.evaluate(() => window.__starwishC10b.renderInfo());
      run.results.push({ tag: "原始 HQ", info: ra });
      check("原始 HQ：HDR 後製管線開、男生為徽記修正版 GLB", ra.pipeline === true && ra.files.includes("novice_c10b1_male_hq.glb") && ra.files.includes("novice_c10b_female_hq.glb"), ra);
      await take(pa, "orig");
      await pa.close();

      const pb = await open("&p3=1");
      const rb = await pb.evaluate(() => window.__starwishC10b.renderInfo());
      run.results.push({ tag: "P3-2", info: rb });
      check("P3-2：不建 HDR 管線、色調映射在材質內、發光層暫停", rb.pipeline === false && rb.toneMappingInMaterials === true && rb.glowEnabled === false, rb);
      const s1 = await pb.evaluate(() => window.__starwishC10b.shadowState());
      await frames(pb, 6);
      const s2 = await pb.evaluate(() => window.__starwishC10b.shadowState());
      check("P3-2：角色不動時陰影貼圖不重畫（6 格 0 次）", s2.renders === s1.renders, [s1.renders, s2.renders]);
      await pb.evaluate(() => window.__starwishC10b.moveChar(0, 0.05));
      await frames(pb, 3);
      const s3 = await pb.evaluate(() => window.__starwishC10b.shadowState());
      await frames(pb, 4);
      const s4 = await pb.evaluate(() => window.__starwishC10b.shadowState());
      check("P3-2：角色移動後陰影貼圖立刻重畫 1 次，之後又停止", s3.renders - s2.renders >= 1 && s3.renders - s2.renders <= 2 && s4.renders === s3.renders, [s2.renders, s3.renders, s4.renders]);
      await pb.evaluate(() => window.__starwishC10b.moveChar(0, -0.05));
      await frames(pb, 3);
      await take(pb, "p3");
      await pb.close();

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
          let changed = 0, changed24 = 0, sum = 0, max = 0;
          for (let k = 0; k < da.length; k += 4) {
            const d = Math.max(Math.abs(da[k] - db[k]), Math.abs(da[k + 1] - db[k + 1]), Math.abs(da[k + 2] - db[k + 2]));
            sum += d;
            if (d > max) max = d;
            if (d > 8) changed++;
            if (d > 24) changed24++;
          }
          const n = da.length / 4;
          return { changedPct: +((changed / n) * 100).toFixed(3), changed24Pct: +((changed24 / n) * 100).toFixed(3), meanDiff: +(sum / n).toFixed(3), maxDiff: max };
        }, [a.toString("base64"), b.toString("base64")]);
      const diffs = {};
      for (const v of VIEWS) diffs[v] = await diff(shots.orig[v], shots.p3[v]);
      await dp.close();
      run.results.push({ tag: "原始 vs P3-2 畫面", diffs });
      check("原始 vs P3-2：明顯差異（>24 色階）像素 ≤ 1%", VIEWS.every((v) => diffs[v].changed24Pct <= 1), diffs);
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }
    await ctx.close();
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 5;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${run.viewport}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 900)}`);
    for (const r of run.results) console.log(`   · ${r.tag}: ${JSON.stringify(r)}`.slice(0, 3000));
    for (const e of run.errors) console.log(`   ! ${e}`);
  }

  // ---------- C1.0-B2：男生披風徽記縮小版（正式美術基準）獨立測試頁整合（WebKit）----------
  if (name === "webkit") {
    const vp = VIEWPORTS[0];
    const run = { browser: name, viewport: `${vp.name} / C1.0-B2 徽記縮小版整合 ?lab=c10b&star=2&p3=1`, checks: {}, errors: [], screenshots: [], results: [] };
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };
    const frames = (page, n) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
    const EMB = ["emblem", "emblemL45", "emblemR45", "femEmblem", "femEmblemL45", "femEmblemR45"];
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
    // 畫面中央小框（寬 30%、高 16%）內的金色像素數：鏡頭對準徽記、男女同距離 → 徽記大小的粗略比較（框內不含披風下緣的金色滾邊）
    const goldPx = (buf) =>
      page.evaluate(async (b64) => {
        const i = await new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = "data:image/png;base64," + b64; });
        const c = document.createElement("canvas");
        c.width = i.width;
        c.height = i.height;
        const g = c.getContext("2d");
        g.drawImage(i, 0, 0);
        const x0 = Math.round(i.width * 0.35), y0 = Math.round(i.height * 0.42), w = Math.round(i.width * 0.3), h = Math.round(i.height * 0.16);
        const d = g.getImageData(x0, y0, w, h).data;
        let n = 0;
        for (let k = 0; k < d.length; k += 4) if (d[k] > 150 && d[k + 1] > 100 && d[k + 1] < 195 && d[k + 2] < 92 && d[k] - d[k + 2] > 110) n++; // 金色徽記；排除廣場地台的淡黃色（約 242,206,103）
        return n;
      }, buf.toString("base64"));
    const shoot = async (tag, views) => {
      const out = {};
      await page.evaluate(() => document.querySelectorAll(".v3-top,.lab-panel,.perf-panel,.lab-bench-result").forEach((e) => (e.style.visibility = "hidden")));
      for (const v of views) {
        await page.evaluate((x) => window.__starwishC10b.view(x), v);
        await frames(page, 3);
        const f = `${outDir}${name}_c10b2_${tag}_${v}.png`;
        const buf = await page.screenshot({ path: f });
        run.screenshots.push(f.split("/test-results/")[1]);
        if (EMB.includes(v)) out[v] = await goldPx(buf);
      }
      await page.evaluate(() => document.querySelectorAll(".v3-top,.lab-panel,.perf-panel,.lab-bench-result").forEach((e) => (e.style.visibility = "")));
      return out;
    };
    const ratioOk = (g) => g.emblem > 0 && g.femEmblem > 0 && g.emblem / g.femEmblem > 0.6 && g.emblem / g.femEmblem < 1.6;
    try {
      await page.goto(server.url + "/?lab=c10b&quality=high&p1=1&p2=1&star=2&p3=1", { waitUntil: "load" });
      await page.waitForFunction(() => window.__starwishC10b?.ready === true, null, { timeout: 120000 });
      await frames(page, 4);
      const ri = await page.evaluate(() => window.__starwishC10b.renderInfo());
      check("HQ：男生 C1.0-B2、女生 C1.0-B（未修改）", ri.star === 2 && ri.files.includes("novice_c10b2_male_hq.glb") && ri.files.includes("novice_c10b_female_hq.glb") && ri.files.length === 2, ri);
      const hq = await page.evaluate(() => window.__starwishC10b.info());
      run.results.push({ tag: "C1.0-B2 HQ", triangles: hq.triangles, drawCalls: hq.drawCalls, materials: hq.materials, contextLost: hq.contextLost, chars: hq.chars, loads: hq.loads });
      check("HQ：男女各約 20 萬三角形、身高 1.0～1.35 m、無骨架（P2 合併後各 12 個網格）", hq.chars.length === 2 && hq.chars.every((c) => c.meshes === 12) && hq.chars.every((c) => c.triangles > 195000 && c.triangles < 205000 && c.height > 1 && c.height < 1.35 && !c.skeleton), hq.chars);
      check("HQ：沒有半透明材質、腳底在地台上", hq.transparentMaterials.length === 0 && hq.feet.every((y) => Math.abs(y - hq.baseY) < 0.03), { t: hq.transparentMaterials, feet: hq.feet, base: hq.baseY });
      const gHq = await shoot("hq", ["back", "side", "lowBack", ...EMB]);
      run.results.push({ tag: "HQ 徽記金色像素（畫面中央小框）", gold: gHq });
      check("HQ：男生徽記與女生徽記大小相近（金色像素比 0.6～1.6）", ratioOk(gHq), gHq);
      check("HQ：左右 45° 都看得到男生徽記", gHq.emblemL45 > gHq.emblem * 0.3 && gHq.emblemR45 > gHq.emblem * 0.3, gHq);
      const bdHq = await page.evaluate(() => window.__starwishC10b.breakdown());
      run.results.push({ tag: "C1.0-B2 HQ breakdown", breakdown: bdHq });

      await page.evaluate(() => window.__starwishC10b.setLod("lite"));
      await page.waitForFunction(() => window.__starwishC10b.lod === "lite" && !window.__starwishC10b.loading, null, { timeout: 120000 });
      await frames(page, 4);
      const rl = await page.evaluate(() => window.__starwishC10b.renderInfo());
      check("Lite：男生 C1.0-B2 Lite、女生 C1.0-B Lite", rl.files.includes("novice_c10b2_male_lite.glb") && rl.files.includes("novice_c10b_female_lite.glb") && rl.files.length === 2, rl);
      const lite = await page.evaluate(() => window.__starwishC10b.info());
      run.results.push({ tag: "C1.0-B2 Lite", triangles: lite.triangles, drawCalls: lite.drawCalls, materials: lite.materials, contextLost: lite.contextLost, chars: lite.chars });
      check("Lite：各約 4 萬三角形、身高與 HQ 相同（±1 cm）", lite.chars.length === 2 && lite.chars.every((c, i) => c.triangles > 38000 && c.triangles < 42000 && Math.abs(c.height - hq.chars[i].height) < 0.01), lite.chars);
      const gLite = await shoot("lite", ["back", ...EMB]);
      run.results.push({ tag: "Lite 徽記金色像素（畫面中央小框）", gold: gLite });
      check("Lite：男生徽記與女生徽記大小相近、左右 45° 看得到", ratioOk(gLite) && gLite.emblemL45 > gLite.emblem * 0.3 && gLite.emblemR45 > gLite.emblem * 0.3, gLite);
      const bdLite = await page.evaluate(() => window.__starwishC10b.breakdown());
      run.results.push({ tag: "C1.0-B2 Lite breakdown", breakdown: bdLite });

      await page.evaluate(() => window.__starwishC10b.setLod("hq"));
      await page.waitForFunction(() => window.__starwishC10b.lod === "hq" && !window.__starwishC10b.loading, null, { timeout: 120000 });
      await frames(page, 4);
      const end = await page.evaluate(() => window.__starwishC10b.info());
      check("HQ → Lite → HQ 共 3 次載入、沒有 WebGL Context Lost", end.loads.length === 3 && end.contextLost === 0, { loads: end.loads.length, lost: end.contextLost });
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }
    await ctx.close();
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 9;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${run.viewport}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 900)}`);
    for (const r of run.results) console.log(`   · ${r.tag}: ${JSON.stringify(r)}`.slice(0, 3000));
    for (const e of run.errors) console.log(`   ! ${e}`);
  }

  // ---------- Stage 5.5 角色動畫（C1.0-B5 候選：骨架＋五個動作＋第二批渲染／陰影／攻速）＋星靈寵物系統（?lab=anim；WebKit）----------
  if (name === "webkit") {
    const vp = VIEWPORTS[0];
    const run = { browser: name, viewport: `${vp.name} / Stage 5.5 角色動畫＋星靈寵物 ?lab=anim`, checks: {}, errors: [], screenshots: [], results: [] };
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
    const frames = (n) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
    const shot = async (tag) => {
      const f = `${outDir}${name}_anim_${tag}.png`;
      await page.screenshot({ path: f });
      run.screenshots.push(f.split("/test-results/")[1]);
    };
    const waitState = (s, ms = 8000) => page.waitForFunction((x) => window.__starwishAnim.info().state === x, s, { timeout: ms }).then(() => true, () => false);
    try {
      for (const [g, lod] of [["male", "hq"], ["female", "hq"], ["female", "lite"], ["male", "lite"]]) {
        await page.goto(server.url + `/?lab=anim&g=${g}&lod=${lod}&seed=7`, { waitUntil: "load" });
        await page.waitForFunction(() => window.__starwishAnim?.ready === true, null, { timeout: 120000 });
        await frames(5);
        const info = await page.evaluate(() => window.__starwishAnim.info());
        run.results.push({ tag: `${g}_${lod}`, info });
        check(`${g} ${lod}：載入 C1.0-B5 GLB、17 根骨頭、依材質合併後 ≤ 26 個網格、5 個動作`, info.file === `novice_c10b5_${g}_${lod}.glb` && info.bones === 17 && info.skinnedMeshes > 0 && info.meshes <= 26 && ["Idle", "Run", "Jump", "Attack", "Hurt"].every((a) => info.animations.includes(a)) && info.contextLost === 0, info);
        await frames(30);
        const r2 = await page.evaluate(() => window.__starwishAnim.info());
        check(`${g} ${lod}：P3-2 渲染（無 HDR 管線、畫布 MSAA、無發光物件時發光層暫停）＋腳下陰影（環境陰影只畫一次）`, r2.render.p3 && !r2.render.pipeline && r2.render.canvasAntialias && !r2.render.glowEnabled && r2.render.charShadow === "blob" && r2.render.shadowRenders <= 2, { render: r2.render, drawCalls: r2.drawCalls });
        run.results.push({ tag: `${g}_${lod} draw`, drawCalls: r2.drawCalls, render: r2.render });
        if (lod !== "hq") continue;
        await shot(`${g}_idle`);
        await page.evaluate(() => window.__starwishAnim.setInput(0, 1));
        const runOk = await waitState("Run");
        await frames(20);
        await shot(`${g}_run`);
        const mv = (await page.evaluate(() => window.__starwishAnim.info())).move;
        run.results.push({ tag: `${g} run`, move: mv });
        check(`${g}：跑步速度與正式遊戲相同（5 m/s），跑步動畫依速度加快（減少滑步）`, Math.abs(mv.speed - 5) < 0.01 && mv.runRate > 1.5, mv);
        await page.evaluate(() => window.__starwishAnim.setInput(0, 0));
        const idleOk = await waitState("Idle");
        await page.evaluate(() => window.__starwishAnim.press("jump"));
        const jumpOk = await waitState("Jump");
        const jumpY = await page.waitForFunction(() => window.__starwishAnim.info().jumpY > 0.1, null, { timeout: 8000 }).then(() => true, () => false);
        await shot(`${g}_jump`);
        await waitState("Idle");
        await page.evaluate(() => window.__starwishAnim.press("attack"));
        const atkOk = await waitState("Attack");
        await frames(8);
        await shot(`${g}_attack`);
        await waitState("Idle");
        const atk = (await page.evaluate(() => window.__starwishAnim.info())).attack;
        run.results.push({ tag: `${g} attack`, atk });
        check(`${g}：攻擊 0.5 秒、命中事件 1 次、約在 0.2 秒`, Math.abs(atk.seconds - 0.5) < 1e-6 && atk.hits === 1 && atk.lastHitAt > 0.15 && atk.lastHitAt < 0.3, atk);
        await page.evaluate(() => window.__starwishAnim.press("hurt"));
        const hurtOk = await waitState("Hurt");
        await frames(4);
        await shot(`${g}_hurt`);
        const backIdle = await waitState("Idle");
        check(`${g}：動作切換 Idle → Run → Idle → Jump（離地）→ Attack → Hurt → Idle`, runOk && idleOk && jumpOk && jumpY && atkOk && hurtOk && backIdle, { runOk, idleOk, jumpOk, jumpY, atkOk, hurtOk, backIdle });
      }
      // 寵物流程（男生 HQ）
      await page.goto(server.url + "/?lab=anim&g=male&lod=hq&seed=7", { waitUntil: "load" });
      await page.waitForFunction(() => window.__starwishAnim?.ready === true, null, { timeout: 120000 });
      const flow = await page.evaluate(() => {
        const p = window.__starwishAnim.pet;
        p.reset();
        const drops = p.kill(40);
        p.give("birdEgg", 1);
        const pet = p.hatch("birdEgg");
        const egg = p.state();
        p.timeWarp(40);
        const hatched = p.state();
        p.give("shopFeed", 5);
        const fed = [p.feed("shopFeed"), p.feed("shopFeed"), p.feed("shopFeed")];
        p.timeWarp(30);
        const evo = p.evolve();
        const appr = p.appraise();
        const after = p.state();
        const first = JSON.stringify(after.pets.find((x) => x.id === (pet && pet.id)).affixes);
        const again = [p.appraise(), p.appraise(), p.appraise()];
        const second = JSON.stringify(p.state().pets.find((x) => x.id === (pet && pet.id)).affixes);
        const avatarAs = window.__starwishAnim.info().attack.attackSpeed;
        p.equip(null);
        const unequipped = { stats: p.state().stats.stats, avatarAs: window.__starwishAnim.info().attack.attackSpeed };
        p.equip(pet && pet.id);
        return { drops, petId: pet && pet.id, eggStage: egg.pets[0] && egg.pets[0].stage, hatchedStage: hatched.pets.find((x) => x.id === (pet && pet.id)).stage, fed, evo, appr, after, noReroll: { first, second, again }, avatarAs, unequipped };
      });
      run.results.push({ tag: "pet flow", flow: { ...flow, after: { ...flow.after, pets: flow.after.pets.map((x) => ({ id: x.id, stage: x.stage, exp: Math.round(x.exp), affixes: x.affixes })) } } });
      const kinds = new Set(flow.drops);
      check("寵物：擊倒怪物會掉落種子／孵化蛋／鳥蛋／材料（測試用暫定機率）", ["seed", "egg", "birdEgg", "monsterMaterial"].every((k) => kinds.has(k)), [...kinds]);
      const me = flow.after.pets.find((x) => x.id === flow.petId);
      check("寵物：孵化（時間）→ 餵食 → 進化 → 鑑定（0～4 條、不重複）", flow.eggStage === 0 && flow.hatchedStage === 1 && flow.fed.every(Boolean) && flow.evo && flow.appr && me.stage === 2 && Array.isArray(me.affixes) && me.affixes.length <= 4 && new Set(me.affixes.map((a) => a.stat)).size === me.affixes.length, { me, flow: { eggStage: flow.eggStage, hatchedStage: flow.hatchedStage, fed: flow.fed, evo: flow.evo } });
      check("寵物：裝備後出現並加成角色（攻速不超過 160）", flow.after.equippedId === flow.petId && flow.after.followerVisible && flow.after.stats.stats.attackSpeed <= 160, flow.after.stats);
      check("寵物方案 A：再次鑑定一律拒絕、詞條不變；攻速加成同步到角色攻擊動作；卸下後恢復基礎", flow.noReroll.again.every((x) => x === false) && flow.noReroll.first === flow.noReroll.second && flow.avatarAs === flow.after.stats.stats.attackSpeed && flow.unequipped.avatarAs === 100 && flow.unequipped.stats.attack === 100, { noReroll: flow.noReroll, avatarAs: flow.avatarAs, unequipped: flow.unequipped });
      // 重新載入：詞條從存檔讀回，不改變
      await page.goto(server.url + "/?lab=anim&g=male&lod=hq&seed=99", { waitUntil: "load" });
      await page.waitForFunction(() => window.__starwishAnim?.ready === true, null, { timeout: 120000 });
      const reload = await page.evaluate((id) => JSON.stringify(window.__starwishAnim.pet.state().pets.find((x) => x.id === id).affixes), flow.petId);
      check("寵物方案 A：重新載入（讀檔）後詞條完全相同", reload === flow.noReroll.first, { reload, first: flow.noReroll.first });
      await page.evaluate(() => window.__starwishAnim.setInput(1, 0.4));
      await frames(90);
      await page.evaluate(() => window.__starwishAnim.setInput(0, 0));
      await frames(90);
      const fol = await page.evaluate(() => window.__starwishAnim.pet.state());
      const d = Math.hypot(fol.followerPos[0] - fol.headPos[0], fol.followerPos[1] - fol.headPos[1], fol.followerPos[2] - fol.headPos[2]);
      run.results.push({ tag: "follower", d, head: fol.headPos, pet: fol.followerPos });
      check("寵物：角色移動後跟到頭部附近（0.2～0.8 m）、在頭頂高度附近", d > 0.15 && d < 0.8 && Math.abs(fol.followerPos[1] - fol.headPos[1]) < 0.4, { d, head: fol.headPos, pet: fol.followerPos });
      await shot("pet_follow");
      await page.evaluate(() => {
        document.querySelector("[data-pet=toggle]")?.click();
      });
      await frames(3);
      await shot("pet_panel");
      // 對照：角色即時陰影（?charshadow=realtime）與舊渲染（?p3=0）
      for (const q of ["charshadow=realtime", "p3=0"]) {
        await page.goto(server.url + `/?lab=anim&g=female&lod=hq&seed=7&${q}`, { waitUntil: "load" });
        await page.waitForFunction(() => window.__starwishAnim?.ready === true, null, { timeout: 120000 });
        await frames(40);
        const i = await page.evaluate(() => window.__starwishAnim.info());
        run.results.push({ tag: `compare ${q}`, drawCalls: i.drawCalls, render: i.render });
        if (q === "charshadow=realtime") check("對照：?charshadow=realtime 角色即時陰影（陰影每格重畫）", i.render.charShadow === "realtime" && i.render.shadowRenders > 10, i.render);
        else check("對照：?p3=0 回到舊渲染設定（HDR 後製管線）", !i.render.p3, i.render);
      }
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }
    await ctx.close();
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 20;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${run.viewport}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 900)}`);
    for (const r of run.results) console.log(`   · ${r.tag}: ${JSON.stringify(r)}`.slice(0, 1500));
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
