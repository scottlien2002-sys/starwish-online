// Stage 7.2 骨骼動畫怪物 E2E：
// 1. ?lab=rigged：Babylon.js 9 實際載入（HQ、Lite），多隻獨立播放、7 組動畫、Move/Run、命中時間、死亡停住、重生、血條
// 2. 星芽原野羽風高地（Lv.7）：主動攻擊 AI、巡邏 Move、追擊 Run、命中扣血、擊倒、死亡停止、重生；星露啵啵不受影響
// 風羽狐 GLB 還沒交付時，用接口測試替身（&rigfixture=1；灰色方塊）驗證同一套程式，報告會標示。
// 用法：node tests/e2e/run-rigged-e2e.mjs dist [webkit,chromium]
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";

const distDir = process.argv[2] ?? "dist";
const browsers = (process.argv[3] ?? "webkit,chromium").split(",");
const outDir = new URL("../../test-results/rigged-e2e/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const pw = await loadPlaywright();
const server = await serve(distDir);
const report = { startedAt: new Date().toISOString(), runs: [] };
let failures = 0;

for (const name of browsers) {
  const browser = await pw[name].launch();
  for (const tcase of ["lab-lite", "lab-hq", "field"]) {
    const run = { browser: name, case: tcase, checks: {}, errors: [], results: {} };
    const check = (k, ok, detail) => (run.checks[k] = { ok: !!ok, detail });
    const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !/404|Failed to load resource/.test(m.text()) && run.errors.push(`console: ${m.text()}`));
    const shot = (l) => page.screenshot({ path: `${outDir}${name}_${tcase}_${l}.png` }).catch(() => {});
    try {
      if (tcase.startsWith("lab")) {
        const q = tcase === "lab-hq" ? "hq" : "lite";
        await page.goto(`${server.url}/?lab=rigged&q=${q}&count=6`, { waitUntil: "load" });
        await page.waitForFunction(() => window.__starwishRigLab?.done === true, null, { timeout: 240000 });
        const r = await page.evaluate(() => ({ checks: window.__starwishRigLab.checks, spec: window.__starwishRigLab.spec, asset: window.__starwishRigLab.asset }));
        run.results = r;
        for (const c of r.checks) check(`${r.spec.fixture ? "[接口測試替身] " : "[M004] "}${c.name}`, c.ok, c.detail);
        check("自動檢查至少 14 項", r.checks.length >= 14, r.checks.length);
        await shot("lab");
      } else {
        await page.goto(`${server.url}/?play=starsprout&rigfixture=1&lod=lite&quality=low`, { waitUntil: "load" });
        await page.waitForFunction(() => window.__starwishPlay?.ready === true, null, { timeout: 240000 });
        let i = await page.evaluate(() => window.__starwishPlay.info());
        const foxes = i.monsters.filter((m) => m.rig && m.kind === "windfeather_fox");
        const bobos = i.monsters.filter((m) => m.kind === "star_dew_bobo");
        run.results.status = i.foxStatus;
        check("羽風高地：4 隻風羽狐（Lv.7 區域上限 4）；星露啵啵 6 隻不變", foxes.length === 4 && bobos.length === 6, { foxes: foxes.length, bobos: bobos.length, status: i.foxStatus });
        // Stage 7.3：M002～M007 依原本 7 區配置出現（區域上限：苔葉林緣 5、微風花丘 5、羽風高地 4、星雲花田 4、胡蘿蔔園 2、王冠遺跡 1）
        const byKind = {};
        for (const m of i.monsters.filter((x) => x.rig)) byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
        run.results.byKind = byKind;
        check("Stage 7.3：七種怪物都在原本的區域（M002 5、M003 5、M004 4、M005 4、M006 2、M007 1，另有星露啵啵 6）", byKind.moss_horn_beast === 5 && byKind.cloud_fluff_bird === 5 && byKind.windfeather_fox === 4 && byKind.nebula_sheep === 4 && byKind.carrot_king === 2 && byKind.crown_hammer_rabbit === 1, byKind);
        check("Stage 7.3：骨骼動畫怪物都是正式模型（沒有接口測試替身或方塊）", i.monsters.filter((x) => x.rig).every((x) => x.kind !== "rig_contract_fixture"), i.fieldMonsters);
        // 巡邏：等到至少一隻 patrol
        await page.waitForFunction(() => window.__starwishPlay.info().monsters.some((m) => m.rig && m.mode === "patrol" && m.rig.clip === "move"), null, { timeout: 60000 }).catch(() => {});
        i = await page.evaluate(() => window.__starwishPlay.info());
        const pat = i.monsters.filter((m) => m.kind === "windfeather_fox" && m.mode === "patrol");
        check("巡邏：播 Move，速度約 0.6 m/s", pat.some((m) => m.rig.clip === "move" && m.speed > 0.45 && m.speed < 0.75), pat.map((m) => ({ clip: m.rig.clip, speed: m.speed, ratio: m.rig.ratio })));
        // 玩家走進警戒範圍 → 追擊（Run）
        const f0 = foxes[0];
        await page.evaluate(([x, z]) => window.__starwishPlay.teleport(x + 6, z), [f0.x, f0.z]);
        await page.waitForFunction(() => window.__starwishPlay.info().monsters.some((m) => m.rig && m.mode === "chase" && m.rig.clip === "run"), null, { timeout: 30000 }).catch(() => {});
        i = await page.evaluate(() => window.__starwishPlay.info());
        const ch = i.monsters.filter((m) => m.kind === "windfeather_fox" && m.mode === "chase");
        check("主動攻擊：玩家進入警戒範圍後追擊，播 Run（獨立動畫），速度約 2.4 m/s", ch.some((m) => m.rig.clip === "run" && m.speed > 2.0 && m.speed < 2.6), ch.map((m) => ({ clip: m.rig.clip, speed: m.speed, ratio: m.rig.ratio })));
        // 站著讓牠攻擊：命中扣血
        const hp0 = i.hp;
        await page.waitForFunction((h) => window.__starwishPlay.info().hp < h, hp0, { timeout: 60000 }).catch(() => {});
        i = await page.evaluate(() => window.__starwishPlay.info());
        const att = i.monsters.filter((m) => m.kind === "windfeather_fox" && m.attacks.started > 0);
        check("攻擊：Attack 命中時扣玩家血（每次攻擊只結算一次）", i.hp < hp0 && att.every((m) => m.attacks.resolved <= m.attacks.started && m.attacks.duplicatesBlocked === 0), { hp0, hp: i.hp, attacks: att.map((m) => m.attacks) });
        // 擊倒一隻：持續攻擊
        const fight = await page.evaluate(
          () =>
            new Promise((res) => {
              const api = window.__starwishPlay;
              const t0 = performance.now();
              let target = null;
              let barSeen = null;
              const step = () => {
                const info = api.info();
                if (info.hp < info.maxHp * 0.6) api.heal();
                const foxes = info.monsters.filter((m) => m.kind === "windfeather_fox");
                if (!target) target = foxes.find((m) => m.state !== "death" && m.state !== "dead")?.id ?? null;
                const f = foxes.find((m) => m.id === target);
                if (f && f.hp < f.maxHp && f.state !== "death" && barSeen === null) barSeen = { hpBar: f.rig.hpBar, y: f.rig.hpBarY };
                if (f && (f.state === "death" || f.state === "dead")) return res({ id: target, state: f.state, barSeen, clip: f.rig.clip });
                if (f && Math.hypot(f.x - info.pos[0], f.z - info.pos[2]) > 1.6) api.teleport(f.x + 1.2, f.z);
                api.press("attack");
                if (performance.now() - t0 > 120000) return res({ id: target, state: f?.state, timeout: true, barSeen });
                setTimeout(step, 150);
              };
              step();
            }),
        );
        run.results.fight = fight;
        check("受傷後顯示血條（在頭頂上方）", fight.barSeen && fight.barSeen.hpBar && fight.barSeen.y > 1.0, fight.barSeen);
        check("擊倒：進入死亡，播 Death", !fight.timeout && (fight.state === "death" || fight.state === "dead") && fight.clip === "death", fight);
        await shot("death");
        // 死亡停止：位置不變、之後隱藏
        const d1 = await page.evaluate((id) => window.__starwishPlay.info().monsters.find((m) => m.id === id), fight.id);
        await page.waitForFunction((id) => window.__starwishPlay.info().monsters.find((m) => m.id === id).state === "dead", fight.id, { timeout: 30000 }).catch(() => {});
        const d2 = await page.evaluate((id) => window.__starwishPlay.info().monsters.find((m) => m.id === id), fight.id);
        check("死亡停止：不移動、停在倒地姿勢後淡出隱藏", d2.state === "dead" && Math.hypot(d2.x - d1.x, d2.z - d1.z) < 0.01 && d2.rig.visible === false, { d1: { x: d1.x, z: d1.z, state: d1.state }, d2: { x: d2.x, z: d2.z, state: d2.state, visible: d2.rig.visible } });
        // 重生
        await page.evaluate(() => window.__starwishPlay.teleport(-56, -64)); // 回營地，避免一重生就被拉
        await page.waitForFunction((id) => ["idle", "move"].includes(window.__starwishPlay.info().monsters.find((m) => m.id === id).state), fight.id, { timeout: 120000 }).catch(() => {});
        const d3 = await page.evaluate((id) => window.__starwishPlay.info().monsters.find((m) => m.id === id), fight.id);
        check("重生：滿血、回到 Idle／Move、重新顯示", ["idle", "move"].includes(d3.state) && d3.hp === d3.maxHp && d3.rig.visible === true && ["idle", "move"].includes(d3.rig.clip), { state: d3.state, hp: d3.hp, clip: d3.rig.clip, visible: d3.rig.visible });
      }
    } catch (e) {
      run.errors.push(`例外：${e.message}`);
      await shot("exception");
    }
    run.ok = Object.values(run.checks).every((c) => c.ok) && run.errors.length === 0 && Object.keys(run.checks).length > 0;
    if (!run.ok) failures++;
    for (const [k, c] of Object.entries(run.checks)) console.log(`${c.ok ? "✓" : "✗"} [${name} ${tcase}] ${k}${c.ok ? "" : "  " + JSON.stringify(c.detail).slice(0, 500)}`);
    for (const e of run.errors) console.log(`  ! [${name} ${tcase}] ${e}`);
    report.runs.push(run);
    await ctx.close();
  }
  await browser.close();
}
await server.close();
report.ok = failures === 0;
writeFileSync(outDir + "report.json", JSON.stringify(report, null, 2));
console.log(failures ? `骨骼動畫怪物 E2E 失敗：${failures}` : "骨骼動畫怪物 E2E 全部通過");
process.exit(failures ? 1 : 0);
