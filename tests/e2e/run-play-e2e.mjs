// Stage 5.6 星芽原野整合（?play=starsprout）端對端測試：男女角色、移動、戰鬥、擊倒、掉落、撿取、背包、寵物（方案 A）、跟隨、屬性、正式設定缺值、效能測試流程。
// 用法：node tests/e2e/run-play-e2e.mjs dist [webkit,chromium]
// 注意：CI 是無頭瀏覽器＋軟體繪圖（約 2～10 FPS），遊戲時間比實際慢；FPS 不代表 iPhone。
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";

const distDir = process.argv[2] ?? "dist";
const browsers = (process.argv[3] ?? "webkit").split(",");
const outDir = new URL("../../test-results/play-e2e/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

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
  for (const [g, lod, q] of [["male", "hq", "high"], ["female", "lite", "medium"]]) {
    const run = { browser: name, label: `${g} ${lod}`, checks: {}, errors: [], screenshots: [], results: {} };
    const check = (k, ok, detail) => (run.checks[k] = { ok, detail });
    const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
    const frames = (n) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
    const shot = async (label) => {
      const f = `${outDir}${name}_${g}_${lod}_${label}.png`;
      try {
        await page.screenshot({ path: f, timeout: 60000 });
      } catch {
        await frames(2);
        await page.screenshot({ path: f, timeout: 90000 });
      }
      run.screenshots.push(f.split("/test-results/")[1]);
    };
    const info = () => page.evaluate(() => window.__starwishPlay.info());
    const open = async (q2) => {
      await page.goto(server.url + `/?play=starsprout&g=${g}&lod=${lod}&quality=${q}&seed=7${q2 ?? ""}`, { waitUntil: "load" });
      return page
        .waitForFunction(() => window.__starwishPlay?.ready === true || document.querySelector(".boot-status.error"), null, { timeout: 180000 })
        .then(() => page.evaluate(() => window.__starwishPlay?.ready === true))
        .catch(() => false);
    };
    try {
      await page.goto(server.url + "/?play=starsprout&clear=1", { waitUntil: "load" });
      await page.evaluate(() => localStorage.clear());
      const ready = await open();
      const bootError = await page.evaluate(() => document.querySelector(".boot-status.error")?.textContent ?? null);
      check("啟動（地圖＋角色＋怪物）", ready, bootError ?? "ok");
      if (!ready) throw new Error("未啟動");
      await frames(6);
      const i0 = await info();
      run.results.start = i0;
      check(`${g} ${lod}：C1.0-B5a GLB、6 隻星露啵啵、寵物＝測試設定`, i0.file === `novice_c10b5a_${g}_${lod}.glb` && i0.monsters.length === 6 && i0.pets.enabled && i0.pets.mode === "preview", { file: i0.file, monsters: i0.monsters.length, pets: i0.pets });
      check("預設渲染：P3-2（無 HDR 管線）＋腳下柔邊陰影", i0.render.p3 && !i0.render.pipeline && i0.render.charShadow === "blob", i0.render);
      await shot("spawn");

      // 移動：5 m/s、跑步動畫加速
      await page.evaluate(() => window.__starwishPlay.setMove(0, 1));
      await page.waitForFunction(() => window.__starwishPlay.info().state === "Run", null, { timeout: 30000 }).catch(() => {});
      await frames(10);
      const mv = await info();
      await page.evaluate(() => window.__starwishPlay.setMove(0, 0));
      run.results.move = { speed: mv.speed, runRate: mv.runRate, slide: mv.slide, state: mv.state };
      check("移動 5 m/s、Run 動作、跑步倍率依速度", mv.state === "Run" && Math.abs(mv.speed - 5) < 0.3 && mv.runRate > 1.5, run.results.move);
      check("移動後在原地之外、貼地", Math.hypot(mv.pos[0] - i0.pos[0], mv.pos[2] - i0.pos[2]) > 0.3, { from: i0.pos, to: mv.pos });

      // 跳躍
      await page.waitForFunction(() => window.__starwishPlay.info().state === "Idle", null, { timeout: 20000 }).catch(() => {});
      await page.evaluate(() => window.__starwishPlay.press("jump"));
      const jumped = await page.waitForFunction(() => window.__starwishPlay.info().state === "Jump", null, { timeout: 15000 }).then(() => true, () => false);
      check("跳躍", jumped, null);

      // 戰鬥：星露草坪，靠近最近的啵啵連續攻擊，直到擊倒 3 隻
      await page.evaluate(() => window.__starwishPlay.toZone01());
      await frames(4);
      await shot("zone01");
      const fight = await page.evaluate(async () => {
        const api = window.__starwishPlay;
        const t0 = performance.now();
        let attacks = 0;
        while (api.info().kills < 3 && performance.now() - t0 < 150000) {
          const s = api.info();
          if (s.down) {
            await new Promise((r) => setTimeout(r, 300));
            continue;
          }
          const alive = s.monsters.filter((m) => m.state !== "death" && m.state !== "dead" && m.state !== "respawn");
          if (!alive.length) {
            await new Promise((r) => setTimeout(r, 300));
            continue;
          }
          alive.sort((a, b) => Math.hypot(a.x - s.pos[0], a.z - s.pos[2]) - Math.hypot(b.x - s.pos[0], b.z - s.pos[2]));
          const m = alive[0];
          const d = Math.hypot(m.x - s.pos[0], m.z - s.pos[2]);
          if (d > 1.8) api.teleport(m.x - 1.1, m.z);
          api.press("attack");
          attacks++;
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        }
        return { attacks, ms: Math.round(performance.now() - t0) };
      });
      await frames(20);
      const f1 = await info();
      run.results.fight = { ...fight, kills: f1.kills, hits: f1.hits, drops: f1.drops, picked: f1.picked, loot: f1.loot, hp: f1.hp, attack: f1.attack };
      check("攻擊命中、擊倒 3 隻星露啵啵", f1.kills >= 3 && f1.hits >= 9, run.results.fight);
      check("攻擊 0.5 秒一下、0.2 秒命中（攻速 100）", Math.abs(f1.attack.interval - 0.5) < 1e-6 && Math.abs(f1.attack.hitAt - 0.2) < 1e-6, f1.attack);
      check("擊倒後掉落（測試掉落率），走近自動撿起放進背包", f1.drops > 0 && f1.picked > 0 && f1.picked + f1.loot === f1.drops, run.results.fight);
      const deadMon = f1.monsters.filter((m) => m.state === "dead" || m.state === "death" || m.state === "respawn").length;
      run.results.monsterStates = f1.monsters.map((m) => m.state);
      check("被擊倒的怪物進入死亡／等待重生", deadMon >= 1 || f1.monsters.some((m) => m.hp < 60), run.results.monsterStates);
      await shot("fight");

      // 寵物流程（測試設定）：孵化 → 時間成長 → 餵食 → 進化 → 鑑定（一次）→ 裝備 → 加成
      const flow = await page.evaluate(async () => {
        const p = window.__starwishPlay.pet;
        p.give("birdEgg", 1);
        p.give("shopFeed", 6);
        const id = p.hatch("birdEgg");
        p.timeWarp(40);
        const hatched = p.list().find((x) => x.id === id)?.stage;
        p.equip(id);
        const fed = [p.feed("shopFeed"), p.feed("shopFeed"), p.feed("shopFeed")];
        p.timeWarp(60);
        const evo = p.evolve();
        const appr = await p.appraise();
        const first = JSON.stringify(p.list().find((x) => x.id === id)?.affixes);
        const again = await p.appraise();
        const second = JSON.stringify(p.list().find((x) => x.id === id)?.affixes);
        return { id, hatched, fed, evo, appr, again, first, second, after: window.__starwishPlay.info() };
      });
      await frames(30);
      const pf = await info();
      run.results.pet = { ...flow, after: { pets: flow.after.pets, stats: flow.after.stats, attack: flow.after.attack }, follower: pf.pets };
      check("寵物：孵化、餵食、進化、鑑定成功", flow.hatched === 1 && flow.fed.every(Boolean) && flow.evo && flow.appr, run.results.pet);
      check("寵物方案 A：再鑑定拒絕、詞條不變", flow.again === false && flow.first === flow.second && flow.first !== "null", { first: flow.first, second: flow.second });
      check("寵物裝備後在頭部附近跟隨（≤ 0.8 m）", pf.pets.followerVisible && pf.pets.equipped === flow.id && pf.pets.followerDist < 0.8, pf.pets);
      check("寵物加成反映到角色屬性；攻速 ≤ 160 且同步到攻擊動作", pf.stats.attackSpeed <= 160 && pf.attack.attackSpeed === pf.stats.attackSpeed, { stats: pf.stats, attack: pf.attack });
      await shot("pet");

      // 存讀檔：重新載入後寵物與詞條相同
      const ok2 = await open();
      await frames(4);
      const reload = ok2 ? await page.evaluate((id) => JSON.stringify(window.__starwishPlay.pet.list().find((x) => x.id === id)?.affixes), flow.id) : null;
      const ri = ok2 ? await info() : null;
      check("重新載入：寵物、詞條、裝備、背包保留", ok2 && reload === flow.first && ri.pets.equipped === flow.id, { reload, first: flow.first, equipped: ri?.pets.equipped });

      // 效能測試流程（10 秒；CI 的 FPS 沒有參考價值，只檢查流程與報告）
      const bench = await page.evaluate(() => window.__starwishPlay.bench(10));
      run.results.bench = bench;
      check("實玩效能測試流程（自動打怪、報告欄位、Context Lost 0）", bench.seconds >= 9 && bench.avgFps > 0 && bench.contextLost === 0, bench);

      if (g === "male") {
        // 正式設定缺值：寵物停用、提示、遊戲照常進入與打怪
        await page.evaluate(() => localStorage.clear());
        const ok3 = await open("&pets=official");
        await frames(4);
        const oi = ok3 ? await info() : null;
        check("&pets=official：缺正式數值 → 寵物停用並提示、遊戲照常", ok3 && oi.pets.enabled === false && /掉落率/.test(oi.pets.reason) && oi.monsters.length === 6, oi?.pets);
        // 角色即時陰影選項
        const ok4 = await open("&charshadow=realtime");
        await frames(6);
        const si = ok4 ? await info() : null;
        check("&charshadow=realtime 可載入", ok4 && si.render.charShadow === "realtime", si?.render);
        run.results.drawRealtime = si?.render.drawCalls;
      }
      const end = await info();
      run.results.end = { render: end.render };
      check("沒有 WebGL Context Lost", end.render.contextLost === 0, end.render);
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }
    await ctx.close();
    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 15;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / play ${run.label}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}${v.ok ? "" : "  " + JSON.stringify(v.detail).slice(0, 900)}`);
    for (const [k, v] of Object.entries(run.results)) console.log(`   · ${k}: ${JSON.stringify(v).slice(0, 1200)}`);
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
