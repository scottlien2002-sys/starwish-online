// Stage 7 完整遊戲循環（?play=world）端對端測試：
// 新存檔在星芽村出生 → 洛恩鑑定（收費、不重複扣款）→ 星願商會（買、掛賣、取消、賣給 NPC）→ 南門 → 星芽原野
// → 打怪、金幣與物品掉落、撿取（唯一編號）→ 星願石返回星芽村 → 存檔保留 → 再到原野戰死 → 星芽村復活。
// 一般移動沒有跳躍按鈕。商會是本機服務（serverBacked=false），不是真正的多人交易。
// 用法：node tests/e2e/run-world-e2e.mjs dist [webkit,chromium]
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";

const distDir = process.argv[2] ?? "dist";
const browsers = (process.argv[3] ?? "webkit").split(",");
const outDir = new URL("../../test-results/world-e2e/", import.meta.url).pathname;
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
  for (const g of ["male", "female"]) {
    const run = { browser: name, label: g, checks: {}, errors: [], screenshots: [], results: {} };
    const check = (k, ok, detail) => (run.checks[k] = { ok: !!ok, detail });
    const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
    const shot = async (label) => {
      const f = `${name}_${g}_${label}.png`;
      await page.screenshot({ path: outDir + f }).catch(() => {});
      run.screenshots.push(f);
    };
    const wait = (ms) => page.waitForTimeout(ms);
    // 美術載入完成後才建立互動（洛恩、商會、傳送門）→ 等到互動物件出現
    const waitVillage = () => page.waitForFunction(() => window.__starwishWorld?.ready === true && !!window.__starwishWorld.info().interact, null, { timeout: 180000 });
    const waitField = () => page.waitForFunction(() => window.__starwishPlay?.ready === true && !!window.__starwishPlay.world, null, { timeout: 120000 });
    const V = (fn, arg) => page.evaluate(fn, arg);
    try {
      // ---------- 1. 新存檔：在星芽村出生 ----------
      await page.goto(`${server.url}/?play=world&newgame=1&g=${g}&seed=11`, { waitUntil: "load" });
      await waitVillage();
      // 重新整理一次（去掉 newgame）：確認存檔已寫入、不會每次都重來
      await page.goto(`${server.url}/?play=world&seed=11`, { waitUntil: "load" });
      await waitVillage();
      let vi = await V(() => window.__starwishWorld.info());
      run.results.start = vi;
      check("新存檔在星芽村出生（性別、測試設定、起始金幣 100）", vi.map === "village" && vi.gender === g && vi.mode === "test" && vi.gold === 100, { map: vi.map, gender: vi.gender, gold: vi.gold, mode: vi.mode });
      check("星芽村：一般移動沒有跳躍按鈕", vi.jumpButtonVisible === false, vi.jumpButtonVisible);
      await shot("village_start");

      // ---------- 2. 洛恩鑑定：收鑑定費、同一請求只扣一次、金幣不足不鑑定 ----------
      const ap = await V(async () => {
        const w = window.__starwishWorld;
        w.give("seed", 2);
        const bag = w.info().bag.filter((b) => b.kind === "seed");
        const svc = w.appraisal();
        const q = await svc.quote(bag[0].id);
        const r1 = await svc.appraise(bag[0].id, "e2e-ap-1");
        const r2 = await svc.appraise(bag[0].id, "e2e-ap-1");
        const after = w.info();
        return { quote: q.ok ? q.data : q, r1: r1.ok, r2: r2.ok, gold: after.gold, ledger: after.ledger.filter((l) => l.kind === "appraisal").length, appraised: after.bag.find((b) => b.id === bag[0].id)?.affixes != null };
      });
      run.results.appraisal = ap;
      check("洛恩鑑定：收 20 金幣（測試設定），重送同一請求不重複扣款", ap.r1 && ap.r2 && ap.gold === 80 && ap.ledger === 1 && ap.appraised, ap);

      // ---------- 3. 星願商會：買、掛賣鎖定、取消、賣 NPC；本機服務標示不是多人交易 ----------
      const gm = await V(async () => {
        const w = window.__starwishWorld;
        const s = w.guildService();
        const b1 = await s.buyFromShop("shop:feed", 1, "e2e-buy-1");
        const b2 = await s.buyFromShop("shop:feed", 1, "e2e-buy-1");
        const seed = w.info().bag.find((x) => x.kind === "seed" && x.affixes == null);
        const l = await s.createListing(seed.id, 500, "e2e-list-1");
        const lockedAfterList = w.info().bag.find((x) => x.id === seed.id)?.locked;
        const dup = await s.createListing(seed.id, 500, "e2e-list-2");
        const ownBuy = l.ok ? await s.buyListing(l.data.listingId, "e2e-own") : null;
        const c = l.ok ? await s.cancelListing(l.data.listingId, "e2e-cancel-1") : null;
        const lockedAfterCancel = w.info().bag.find((x) => x.id === seed.id)?.locked;
        const goldBeforeSell = w.info().gold;
        const sell = await s.sellToShop(seed.id, "e2e-sell-1");
        const sell2 = await s.sellToShop(seed.id, "e2e-sell-1");
        const i = w.info();
        return { serverBacked: s.serverBacked, b1: b1.ok, b2: b2.ok, feed: i.items.shopFeed, listed: l.ok, lockedAfterList, dup: dup.ok, ownBuy: ownBuy?.ok ?? null, cancelled: c?.ok ?? null, lockedAfterCancel, sold: sell.ok && sell2.ok, goldBeforeSell, gold: i.gold, stillInBag: i.bag.some((x) => x.id === seed.id) };
      });
      run.results.guild = gm;
      check("商會：本機服務（serverBacked=false，不是真正的多人交易）", gm.serverBacked === false, gm.serverBacked);
      check("商會：買飼料扣 10 金幣，重送不重複扣款", gm.b1 && gm.b2 && gm.feed === 1, gm);
      check("商會：掛賣鎖定物品、不能重複掛賣、不能買自己的、取消後解鎖", gm.listed && gm.lockedAfterList === true && gm.dup === false && gm.ownBuy === false && gm.cancelled && !gm.lockedAfterCancel, gm);
      check("商會：賣給 NPC 入帳 12（40×0.3），重送不重複入帳、物品移出背包", gm.sold && gm.gold === gm.goldBeforeSell + 12 && !gm.stillInBag, gm);
      const goldBeforeField = gm.gold;
      const bagBeforeField = (await V(() => window.__starwishWorld.info())).bag.length;

      // ---------- 4. 南門 → 星芽原野 ----------
      await V(() => window.__starwishWorld.teleport(0, -41.5, Math.PI));
      // 互動目標在下一次畫面更新時才判定（CI 軟體繪圖很慢）
      await page.waitForFunction(() => window.__starwishWorld.info().interact?.target === "portal:south", null, { timeout: 30000 }).catch(() => {});
      const tgt = await V(() => window.__starwishWorld.info().interact?.target);
      const act = await V(() => window.__starwishWorld.activate());
      await page.waitForFunction(() => !!document.querySelector('.vi-dlg button[data-a="go"]'), null, { timeout: 15000 }).catch(() => {});
      const dlg = await V(() => window.__starwishWorld.info().interact?.dialog ?? "");
      console.log(`  · [${name} ${g}] 傳送門：target=${tgt} activate=${act} dialog=${dlg.slice(0, 60)}`);
      const nav = page.waitForNavigation({ timeout: 60000 }).catch(() => null);
      await V(() => window.__starwishWorld.confirmDialog());
      await nav;
      await waitField();
      await page.waitForFunction(() => window.__starwishPlay.info().monsters.length > 0, null, { timeout: 60000 }).catch(() => {});
      let fi = await V(() => window.__starwishPlay.world.info());
      const fp = await V(() => window.__starwishPlay.info());
      run.results.fieldArrive = { fi, pos: fp.pos };
      check("南方傳送門 → 星芽原野新手營地", tgt === "portal:south" && fi.map === "starsprout" && Math.hypot(fp.pos[0] + 56, fp.pos[2] + 64) < 1.5, { tgt, pos: fp.pos });
      check("切換地圖：金幣、背包、模型性別保留", fi.gold === goldBeforeField && fi.bag === bagBeforeField - 0 && fp.gender === g, { gold: fi.gold, goldBeforeField, bag: fi.bag, bagBeforeField });
      check("星芽原野：一般移動沒有跳躍按鈕", fi.jumpButton === false, fi.jumpButton);
      await shot("field_arrive");

      // ---------- 5. 打怪、金幣掉落、撿取 ----------
      const fight = await V(
        () =>
          new Promise((res) => {
            const api = window.__starwishPlay;
            const t0 = performance.now();
            const step = () => {
              const i = api.info();
              const w = api.world.info();
              if (i.hp < i.maxHp * 0.5) api.world.setHp(i.maxHp); // 這段只測掉落
              const loot = w.loot;
              if (loot.length && i.kills >= 2) {
                const l = loot[0];
                api.teleport(l.x, l.z);
              } else {
                const alive = i.monsters.filter((m) => m.state !== "death" && m.hp > 0);
                if (alive.length) {
                  const m = alive[0];
                  if (Math.hypot(m.x - i.pos[0], m.z - i.pos[2]) > 1.6) api.teleport(m.x + 1.0, m.z);
                  api.press("attack");
                } else if (loot.length) api.teleport(loot[0].x, loot[0].z);
              }
              if ((i.kills >= 2 && w.loot.length === 0 && w.goldPicked > 0) || performance.now() - t0 > 150000) res({ kills: i.kills, picked: i.picked, w });
              else setTimeout(step, 120);
            };
            step();
          }),
      );
      run.results.fight = { kills: fight.kills, picked: fight.picked, goldDropped: fight.w.goldDropped, goldPicked: fight.w.goldPicked, gold: fight.w.gold, claimed: fight.w.claimed };
      const drops = fight.w.ledger.filter((l) => l.kind === "monsterDrop");
      check("原野：擊倒怪物、掉落金幣（測試設定 3–8）並撿起入帳", fight.kills >= 2 && fight.w.goldPicked > 0 && fight.w.gold === goldBeforeField + fight.w.goldPicked && drops.every((d) => d.amount >= 3 && d.amount <= 8), run.results.fight);
      check("掉落物唯一編號：每個撿起的掉落只入帳一次", new Set(drops.map((d) => d.requestId)).size === drops.length && fight.w.claimed >= drops.length, { drops: drops.length, claimed: fight.w.claimed });
      await shot("field_fight");

      // ---------- 6. 星願石返回星芽村，存檔保留 ----------
      const beforeBack = await V(() => window.__starwishPlay.world.info());
      await V(() => window.__starwishPlay.teleport(-56, -66.3));
      await page.waitForFunction(() => window.__starwishPlay.world.info().stoneButton === true, null, { timeout: 20000 }).catch(() => {});
      const stoneBtn = await V(() => window.__starwishPlay.world.info().stoneButton);
      await V(() => window.__starwishPlay.world.stone());
      await shot("field_stone");
      const nav2 = page.waitForNavigation({ timeout: 60000 }).catch(() => null);
      await page.click('.world-stone-dlg button[data-a="go"]');
      await nav2;
      await waitVillage();
      vi = await V(() => window.__starwishWorld.info());
      run.results.backVillage = { gold: vi.gold, pos: vi.pos, bag: vi.bag.length };
      check("星願石：在石頭旁出現按鈕，確認後返回星芽村南門內側", stoneBtn && vi.map === "village" && Math.hypot(vi.pos[0] - 0, vi.pos[2] + 39) < 1.5, { stoneBtn, pos: vi.pos });
      check("返回村莊：金幣、背包、物品數量保留", vi.gold === beforeBack.gold && vi.bag.length === beforeBack.bag && vi.items.monsterMaterial === beforeBack.items.monsterMaterial, { vi: vi.gold, field: beforeBack.gold });
      await shot("village_back");

      // ---------- 7. 再到原野，戰死 → 星芽村復活 ----------
      await V(() => window.__starwishWorld.toField());
      await waitField();
      await page.waitForFunction(() => window.__starwishPlay.info().monsters.length > 0, null, { timeout: 60000 }).catch(() => {});
      const goldBeforeDeath = await V(() => window.__starwishPlay.world.info().gold);
      const nav3 = page.waitForNavigation({ timeout: 180000 }).catch(() => null);
      const death = await V(
        () =>
          new Promise((res) => {
            const api = window.__starwishPlay;
            const t0 = performance.now();
            let seen = null;
            const step = () => {
              const i = api.info();
              const w = api.world.info();
              // 倒地在怪物更新時發生，角色動作在下一格才切換 → 看到倒地後再取幾格
              if (w.down && !seen) seen = { state: w.state, deathClip: w.deathClip, states: [] };
              if (seen && w.down) seen.states.push(w.state);
              if (!w.down && !seen) {
                if (i.hp > 1) api.world.setHp(1);
                const m = i.monsters.find((x) => x.state !== "death" && x.hp > 0);
                if (m && Math.hypot(m.x - i.pos[0], m.z - i.pos[2]) > 1.2) api.teleport(m.x + 0.9, m.z);
              }
              if ((seen && (seen.states.length >= 6 || !w.down)) || performance.now() - t0 > 120000) {
                if (seen) seen.state = seen.states.includes("Death") ? "Death" : seen.states[seen.states.length - 1];
                res(seen);
              }
              else setTimeout(step, 150);
            };
            step();
          }),
      ).catch(() => null);
      run.results.death = death;
      await shot("field_down");
      await nav3;
      await waitVillage();
      vi = await V(() => window.__starwishWorld.info());
      run.results.respawn = { pos: vi.pos, deaths: vi.deaths, hp: vi.hp, gold: vi.gold };
      check("戰死：生命歸零後倒地並播 C1.0-B5b 死亡動作（不是整個角色僵硬往後倒）", !!death && death.deathClip === true && death.state === "Death", death);
      check("戰死 → 在星芽村復活（死亡次數 +1、滿血、金幣不變）", vi.map === "village" && vi.deaths === 1 && (vi.hp === null || vi.hp >= 100) && vi.gold === goldBeforeDeath, run.results.respawn);
      await shot("village_respawn");
    } catch (e) {
      run.errors.push(`例外：${e.message}`);
      run.results.exceptionState = await page
        .evaluate(() => ({
          url: location.href,
          boot: document.getElementById("boot")?.textContent?.slice(0, 300) ?? null,
          world: window.__starwishWorld ? { ready: window.__starwishWorld.ready, info: (() => { try { const i = window.__starwishWorld.info(); return { map: i.map, art: i.art, interact: i.interact, pos: i.pos }; } catch (x) { return String(x); } })() } : null,
          play: window.__starwishPlay ? { ready: window.__starwishPlay.ready, world: !!window.__starwishPlay.world } : null,
          save: (() => { try { const s = JSON.parse(localStorage.getItem("starwish.stage7.save.v1") ?? "null"); return s && s.character; } catch { return "bad"; } })(),
        }))
        .catch((x) => String(x));
      console.log(`  ! [${name} ${g}] 狀態：${JSON.stringify(run.results.exceptionState).slice(0, 900)}`);
      await shot("exception");
    }
    run.ok = Object.values(run.checks).every((c) => c.ok) && run.errors.length === 0 && Object.keys(run.checks).length >= 14;
    if (!run.ok) failures++;
    for (const [k, c] of Object.entries(run.checks)) console.log(`${c.ok ? "✓" : "✗"} [${name} ${g}] ${k}${c.ok ? "" : "  " + JSON.stringify(c.detail).slice(0, 400)}`);
    for (const e of run.errors) console.log(`  ! [${name} ${g}] ${e}`);
    report.runs.push(run);
    await ctx.close();
  }
  await browser.close();
}
await server.close();
report.finishedAt = new Date().toISOString();
report.ok = failures === 0;
writeFileSync(outDir + "report.json", JSON.stringify(report, null, 2));
console.log(failures ? `世界循環 E2E 失敗：${failures}` : "世界循環 E2E 全部通過");
process.exit(failures ? 1 : 0);
