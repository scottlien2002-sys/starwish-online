// Combat VFX Lab E2E（Claude C）：?lab=combat 在 Chromium／WebKit 實際載入與操作。
// 檢查：載入（男女 C1.0-B5b、M004～M007 骨骼動畫怪物）、6 個技能逐一施放（動作／特效／傷害同一格同步）、
// 三段特效品質、攻速 160 上限、多人模擬預算、沒有頁面錯誤。FPS 是 CI 軟體繪圖的數字，不代表 iPhone。
// 用法：node tests/e2e/run-combat-vfx-e2e.mjs dist [chromium,webkit]
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";

const distDir = process.argv[2] ?? "dist";
const browsers = (process.argv[3] ?? "chromium,webkit").split(",");
// 第 2 個參數是 http(s) 網址時：直接測公開網址（GitHub Pages），只跑指定的案例
const remote = /^https?:\/\//.test(distDir);
const onlyCases = (process.env.CVFX_CASES ?? "").split(",").filter(Boolean);
const outDir = new URL(`../../test-results/${remote ? "combat-vfx-public" : "combat-vfx"}/`, import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const pw = await loadPlaywright();
const server = remote ? { url: distDir.replace(/\/$/, ""), close: async () => {} } : await serve(distDir);
const report = { startedAt: new Date().toISOString(), note: "FPS 為 CI 軟體繪圖（無 GPU）數字，不代表 iPhone 效能", runs: [] };
let failures = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SKILLS = ["triple_slash", "staff_cast", "leap_slam", "whirlwind", "star_meteor", "charge_burst"];
const HIT_SHOT_DELAY = { triple_slash: 0, staff_cast: 0, leap_slam: 0, whirlwind: 0, star_meteor: 0, charge_burst: 0 };

for (const name of browsers) {
  const browser = await pw[name].launch({ args: name === "chromium" ? ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] : [] });
  for (const tcase of [
    { id: "male-medium", url: "?lab=combat&q=medium&g=male&mute=1" },
    { id: "female-high", url: "?lab=combat&q=high&g=female&mute=1" },
    { id: "low-multi8", url: "?lab=combat&q=low&g=male&mute=1&multi=8" },
    // 固定步長：每 1/30 秒截一張，得到真正 30 fps 的展示畫面序列（CI 沒 GPU，即時播放只有 3～5 FPS 看不出特效）
    { id: "showcase", url: "?lab=combat&q=high&g=male&mute=1&manual=1" },
    { id: "showcase-f", url: "?lab=combat&q=high&g=female&mute=1&manual=1" },
  ]) {
    if (tcase.id.startsWith("showcase") && (remote || name !== "chromium")) continue;
    if (onlyCases.length && !onlyCases.includes(tcase.id)) continue;
    if (!onlyCases.length && name === "webkit" && tcase.id === "female-high") continue; // WebKit 跑兩組即可（時間）
    const run = { browser: name, case: tcase.id, checks: {}, errors: [], results: {} };
    const check = (k, ok, detail) => {
      run.checks[k] = { ok: !!ok, detail };
      if (!ok) failures++;
    };
    const ctx = await browser.newContext({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && run.errors.push(`console: ${m.text()}`));
    const shot = (l) => page.screenshot({ path: `${outDir}${name}_${tcase.id}_${l}.png` }).catch(() => {});
    try {
      const t0 = Date.now();
      await page.goto(`${server.url}/${tcase.url}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__cvfx?.ready === true, null, { timeout: 300000 });
      run.results.loadMs = Date.now() - t0;
      await sleep(1500);
      let st = await page.evaluate(() => window.__cvfx.stats());
      run.results.loaded = st;
      check("載入：4 隻骨骼動畫怪物（M004～M007）且檔案檢查通過", st.monsters.length === 4 && st.monsters.every((m) => m.check?.ok), st.monsters.map((m) => ({ l: m.label, ok: m.check?.ok, e: m.check?.errors })));
      check("載入：初心者 C1.0-B5b（非 Tripo 組裝）", st.triangles > 5000, { triangles: st.triangles, gender: st.gender });
      await shot("00_loaded");

      if (tcase.id.startsWith("showcase")) {
        const dir = `${outDir}${tcase.id}/`;
        mkdirSync(dir, { recursive: true });
        const list = tcase.id === "showcase" ? SKILLS : ["triple_slash", "whirlwind", "charge_burst"];
        let fi = 0;
        const frameShot = () => page.screenshot({ path: `${dir}f${String(fi++).padStart(4, "0")}.jpg`, type: "jpeg", quality: 82 });
        const seq = [];
        for (const sk of list) {
          await page.evaluate(() => {
            const s = window.__cvfx.stats();
            const m = s.monsters.find((x) => x.state === "idle") ?? s.monsters[0];
            const dx = -m.pos[0], dz = -m.pos[1];
            const L = Math.hypot(dx, dz) || 1;
            window.__cvfx.moveTo(m.pos[0] + (dx / L) * 1.6, m.pos[1] + (dz / L) * 1.6);
          });
          await page.evaluate(() => window.__cvfx.view(1.15, 5.2));
          await page.evaluate(() => window.__cvfx.advance(0.5));
          const n0 = await page.evaluate(() => window.__cvfx.sync.length);
          const ok = await page.evaluate((id) => window.__cvfx.cast(id), sk);
          const start = fi;
          for (let k = 0; k < 150; k++) {
            await page.evaluate(() => window.__cvfx.advance(1 / 30));
            await frameShot();
            const busy = await page.evaluate(() => window.__cvfx.busy());
            if (!busy && k > 20) break;
          }
          for (let k = 0; k < 18; k++) {
            await page.evaluate(() => window.__cvfx.advance(1 / 30));
            await frameShot();
          }
          const recs = await page.evaluate((n) => window.__cvfx.sync.slice(n), n0);
          seq.push({ skill: sk, cast: ok, frames: [start, fi - 1], hits: recs.length });
          check(`展示 ${sk}：固定步長下命中結算`, ok && recs.length > 0, recs.length);
          check(`展示 ${sk}：固定步長下命中格動作時間＝時間軸`, recs.every((r) => r.kind === "projectile" || Math.abs(r.animT - r.clipT) <= 1 / 60 + 0.002), recs.map((r) => [r.hit, r.clipT, r.animT]));
        }
        run.results.showcase = seq;
      } else if (tcase.id !== "low-multi8") {
        // 逐一施放 6 個技能
        for (const [i, sk] of SKILLS.entries()) {
          const n0 = await page.evaluate(() => window.__cvfx.sync.length);
          // 站到最近怪物前方
          await page.evaluate(() => {
            const s = window.__cvfx.stats();
            const alive = s.monsters.filter((m) => m.state === "idle");
            const m = alive[0] ?? s.monsters[0];
            const dx = -m.pos[0], dz = -m.pos[1];
            const L = Math.hypot(dx, dz) || 1;
            window.__cvfx.moveTo(m.pos[0] + (dx / L) * 1.6, m.pos[1] + (dz / L) * 1.6);
          });
          await sleep(200);
          const ok = await page.evaluate((id) => window.__cvfx.cast(id), sk);
          check(`施放 ${i + 1}. ${sk}`, ok, null);
          // 第一次命中時截圖
          await page.waitForFunction((n) => window.__cvfx.sync.length > n, n0, { timeout: 15000 }).catch(() => {});
          await sleep(HIT_SHOT_DELAY[sk] ?? 0);
          await shot(`${String(i + 1).padStart(2, "0")}_${sk}_hit`);
          await page.waitForFunction(() => !window.__cvfx.busy(), null, { timeout: 20000 }).catch(() => {});
          await sleep(1200);
          const recs = await page.evaluate((n) => window.__cvfx.sync.slice(n), n0);
          run.results[sk] = recs;
          check(`${sk}：至少一次命中結算`, recs.length > 0 && recs.some((r) => r.targets > 0), recs.map((r) => ({ hit: r.hit, targets: r.targets, dmg: r.damage })));
          check(
            `${sk}：命中當格動作時間＝時間軸時間（誤差 ≤ 1 格 1/30 s），傷害數字同一格顯示`,
            recs.every((r) => (r.kind === "projectile" || Math.abs(r.animT - r.clipT) <= 1 / 30 + 0.002) && r.shownSameFrame),
            recs.map((r) => ({ hit: r.hit, kind: r.kind, clipT: r.clipT, animT: r.animT, same: r.shownSameFrame })),
          );
        }
        // 攻速上限
        await page.evaluate(() => window.__cvfx.setAspd(250));
        const n1 = await page.evaluate(() => window.__cvfx.sync.length);
        await page.evaluate(() => {
          const s = window.__cvfx.stats();
          const m = s.monsters.find((x) => x.state === "idle") ?? s.monsters[0];
          window.__cvfx.moveTo(m.pos[0] * 0.75, m.pos[1] * 0.75);
        });
        await sleep(2600);
        await page.evaluate(() => window.__cvfx.cast("triple_slash"));
        await page.waitForFunction(() => !window.__cvfx.busy(), null, { timeout: 20000 }).catch(() => {});
        const r250 = await page.evaluate((n) => window.__cvfx.sync.slice(n), n1);
        run.results.aspd250 = r250;
        if (r250.length >= 2) {
          const gap = r250[1].realT - r250[0].realT;
          // 攻速 160 上限：s1→s2 片段間隔 0.33 s / 1.6 ≈ 0.206 s（加上頓幀 45 ms）；若攻速未被限制（2.5 倍）會只有 0.132 s
          check("攻速 250 → 依上限 160 播放（命中間隔 ≥ 0.33/1.6）", gap >= 0.33 / 1.6 - 0.02, { gap });
        } else check("攻速 250 → 依上限 160 播放", false, r250);
        await page.evaluate(() => window.__cvfx.setAspd(100));
        // 三段品質：各跑 10 秒自動示範
        const tiers = {};
        for (const t of ["high", "medium", "low"]) {
          await page.evaluate((x) => window.__cvfx.setTier(x), t);
          await page.evaluate(() => window.__cvfx.setAuto(true));
          await sleep(10000);
          const p = await page.evaluate(() => window.__cvfx.perf());
          const s2 = await page.evaluate(() => window.__cvfx.stats());
          tiers[t] = { perf: p, vfx: s2.vfx, budget: s2.budget };
          await shot(`tier_${t}`);
        }
        await page.evaluate(() => window.__cvfx.setAuto(false));
        run.results.tiers = tiers;
        check("三段品質都能運作（每段都有生成特效）", ["high", "medium", "low"].every((t) => tiers[t].budget.granted > 0), Object.fromEntries(Object.entries(tiers).map(([k, v]) => [k, { fps: v.perf.avg10s, draws: v.perf.draws, particles: v.vfx.particles }])));
      } else {
        // 多人模擬 8 位＋自己自動示範 20 秒
        await page.evaluate(() => window.__cvfx.setAuto(true));
        await sleep(20000);
        const p = await page.evaluate(() => window.__cvfx.perf());
        st = await page.evaluate(() => window.__cvfx.stats());
        run.results.multi = { perf: p, stats: st };
        await shot("multi8");
        check("多人模擬：8 位其他玩家同時施放", st.ghosts === 8, st.ghosts);
        check("多人預算：同時特效不超過上限、其他玩家的特效被限制", st.budget.active <= 18 + 2 && st.budget.denied > 0, st.budget);
        // CI 軟體繪圖下 FPS 很低，改成：關掉自動示範後自己站到怪物前施放一次，等它命中
        await page.evaluate(() => window.__cvfx.setAuto(false));
        await page.waitForFunction(() => !window.__cvfx.busy(), null, { timeout: 60000 }).catch(() => {});
        const nm = await page.evaluate(() => window.__cvfx.sync.length);
        await page.evaluate(() => {
          const s = window.__cvfx.stats();
          const m = s.monsters.find((x) => x.state === "idle") ?? s.monsters[0];
          const dx = -m.pos[0], dz = -m.pos[1];
          const L = Math.hypot(dx, dz) || 1;
          window.__cvfx.moveTo(m.pos[0] + (dx / L) * 1.6, m.pos[1] + (dz / L) * 1.6);
        });
        await sleep(500);
        await page.evaluate(() => window.__cvfx.cast("triple_slash"));
        await page.waitForFunction((n) => window.__cvfx.sync.length > n, nm, { timeout: 90000 }).catch(() => {});
        const recsM = await page.evaluate((n) => window.__cvfx.sync.slice(n), nm);
        check("多人：自己的技能仍然有命中結算與傷害數字", recsM.length > 0 && recsM.every((r) => r.shownSameFrame), recsM.map((r) => ({ hit: r.hit, targets: r.targets, same: r.shownSameFrame })));
      }
      st = await page.evaluate(() => window.__cvfx.stats());
      const errs = await page.evaluate(() => window.__cvfx.errors);
      run.results.final = st;
      check("沒有頁面錯誤", run.errors.length === 0 && errs.length === 0, [...run.errors, ...errs].slice(0, 10));
    } catch (e) {
      check("執行完成", false, String(e));
      await shot("error");
    }
    report.runs.push(run);
    await ctx.close();
  }
  await browser.close();
}
await server.close();
report.failures = failures;
report.finishedAt = new Date().toISOString();
writeFileSync(`${outDir}report.json`, JSON.stringify(report, null, 2));
const lines = [];
for (const r of report.runs) {
  lines.push(`## ${r.browser} / ${r.case}`);
  for (const [k, v] of Object.entries(r.checks)) lines.push(`- ${v.ok ? "✅" : "❌"} ${k}`);
  if (r.errors.length) lines.push(`- errors: ${r.errors.slice(0, 5).join(" | ")}`);
}
writeFileSync(`${outDir}summary.md`, lines.join("\n") + "\n");
console.log(lines.join("\n"));
console.log(`failures: ${failures}`);
process.exit(failures ? 1 : 0);
