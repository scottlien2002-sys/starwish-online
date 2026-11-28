// n75 相容性 E2E（Claude C）：A 的新版男性初心者（Stage 7.5，唯讀）× Combat VFX 正式接入模組。
// 檢查：掛點、動作標記一致、拖尾跟刀尖、命中時間＝標記／攻速、投射物從手部發射、雙手武器不穿進軀幹、重要戰鬥特效例外。
// 門檻是 C 暫定（等 A 的正式規格）。FPS 不量測（CI 軟體繪圖）。
// 用法：node tests/e2e/run-n75-compat-e2e.mjs dist [chromium,webkit]
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";

const distDir = process.argv[2] ?? "dist";
const browsers = (process.argv[3] ?? "chromium,webkit").split(",");
const outDir = new URL("../../test-results/combat-vfx/n75/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const pw = await loadPlaywright();
const server = await serve(distDir);
const report = { startedAt: new Date().toISOString(), note: "門檻為 C 暫定，等 A 的正式規格；FPS 未量測", runs: [] };
let failures = 0;
const RATES = [1, 1.3, 1.6];
const FRAME = 1 / 60;
const TWO_HANDED = ["Attack_2H_Slash", "Attack_2H_Smash", "Attack_Polearm_Thrust", "Attack_Polearm_Swing", "Attack_Hammer_Smash"];
const ONE_HANDED = ["Attack", "Attack_1H_Chop", "Attack_1H_Thrust"];

for (const name of browsers) {
  const browser = await pw[name].launch({ args: name === "chromium" ? ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] : [] });
  for (const lod of name === "chromium" ? ["lite", "hq"] : ["lite"]) {
    const run = { browser: name, case: `n75-${lod}`, checks: {}, errors: [], warnings: [], results: {} };
    const check = (k, ok, detail) => {
      run.checks[k] = { ok: !!ok, detail };
      if (!ok) failures++;
    };
    console.log(`[${new Date().toISOString()}] ${name} n75-${lod} …`);
    const ctx = await browser.newContext({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && run.errors.push(`console: ${m.text()}`));
    const shot = (l) => page.screenshot({ path: `${outDir}${name}_${lod}_${l}.png` }).catch(() => {});
    try {
      await page.goto(`${server.url}/?lab=n75compat&lod=${lod}&q=high`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__n75?.ready === true, null, { timeout: 180000 });
      const info = await page.evaluate(() => ({ available: window.__n75.available, version: window.__n75.version, clips: window.__n75.clips, sockets: window.__n75.sockets, marks: window.__n75.marks, cMarks: window.__n75.cMarks }));
      run.results.info = { available: info.available, version: info.version, clips: info.clips?.length, sockets: info.sockets };
      check("A 的 n75 資產已取得（CI 唯讀）", info.available, info.version);
      if (!info.available) throw new Error("n75 資產未取得");
      await shot("00_loaded");
      check("掛點：Weapon_R、Weapon_L、R_Hand、L_Hand 存在", Object.values(info.sockets).every(Boolean), info.sockets);
      const diff = Object.entries(info.marks).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(info.cMarks[k] ?? null)).map(([k]) => k);
      check("技能動作標記：A 的 json 與 C 的 novice_combat_male.json 一致", diff.length === 0, diff);

      // 6 個技能 × 3 種攻速
      const skills = await page.evaluate(() => window.__n75.skills);
      run.results.skills = {};
      for (const id of skills) {
        for (const rate of RATES) {
          const r = await page.evaluate(([id, rate]) => window.__n75.run(id, rate), [id, rate]);
          run.results.skills[`${id}@${rate}`] = r;
          const tag = `${id} 攻速×${rate}`;
          if (r.missing) {
            check(`${tag}：動作存在`, false, r.missing);
            continue;
          }
          if (r.trailFrames > 0) {
            check(`${tag}：拖尾沿著刀尖移動（誤差 ≤ 1 cm）`, r.trailErrMax <= 0.01, +r.trailErrMax.toFixed(4));
            // 刀尖速度依攻速放大；換算回攻速×1 後超過 0.6 m／格（36 m/s）才算瞬移／錯位
            check(`${tag}：拖尾期間刀尖沒有瞬移（換算攻速×1 每格 ≤ 0.6 m）`, r.tipJumpMax / rate <= 0.6, { raw: +r.tipJumpMax.toFixed(3), perRate1: +(r.tipJumpMax / rate).toFixed(3) });
            check(`${tag}：刀光呈弧線（補取樣後每段 ≤ 0.25 m）`, r.chordMax <= 0.25, +r.chordMax.toFixed(3));
            run.results.torso = run.results.torso ?? {};
            if (r.insideFrames) {
              run.results.torso[tag] = r.inside;
              run.warnings.push(`${tag}：刀尖靠近頭肩（軀幹圓柱內）${r.insideFrames} 格：${JSON.stringify(r.inside)}`);
            }
          }
          if (r.hitFxCount) check(`${tag}：命中特效出現在目標命中點（≤ 5 cm）`, r.hitFxErr <= 0.05, { n: r.hitFxCount, err: +r.hitFxErr.toFixed(3) });
          if (r.hits.length) {
            const bad = r.hits.filter((h) => Math.abs(h.wall - h.expect) > FRAME + 1e-6 || Math.abs(h.animT - h.mark) > rate * FRAME + 1e-6);
            check(`${tag}：命中特效時間＝標記／攻速，且與動作同一格`, bad.length === 0, r.hits.map((h) => ({ mark: +h.mark.toFixed(3), wall: +h.wall.toFixed(3), expect: +h.expect.toFixed(3), animT: +h.animT.toFixed(3), tip: +h.tipToTarget.toFixed(2) })));
          }
          // 隕石是從目標上空落下（設計如此），不檢查發射點
          const pj = r.projectiles.filter((p) => p.fx !== "meteor");
          if (pj.length) check(`${tag}：投射物從武器／手部發射（≤ 0.9 m）`, pj.every((p) => p.fromToHand <= 0.9), pj.map((p) => +p.fromToHand.toFixed(2)));
        }
      }
      // 截圖：每個技能命中／釋放那一格
      const HIT_T = { triple_slash: 0.5, staff_cast: 0.58, leap_slam: 0.8, whirlwind: 0.76, star_meteor: 0.72, charge_burst: 1.22 };
      for (const [id, t] of Object.entries(HIT_T)) {
        await page.evaluate(([id, t]) => window.__n75.pose(id, t), [id, t]);
        await shot(`skill_${id}`);
      }
      // A 的普通攻擊／雙手武器動作
      run.results.basic = {};
      for (const clip of [...ONE_HANDED, ...TWO_HANDED, "Cast_Staff", "Cast_Heal"]) {
        if (!info.clips.includes(clip)) continue;
        const r = await page.evaluate(([c, w]) => window.__n75.runBasic(c, w), [clip, clip.startsWith("Cast_") ? "staff" : "sword"]);
        run.results.basic[clip] = r;
        check(`${clip}：拖尾沿著刀尖移動（誤差 ≤ 1 cm）`, r.trailErrMax <= 0.01, +r.trailErrMax.toFixed(4));
        check(`${clip}：武器不穿進軀幹`, r.insideFrames === 0, r.insideFrames);
        if (TWO_HANDED.includes(clip)) run.results.twoHandGrip = { ...(run.results.twoHandGrip ?? {}), [clip]: { lhandToGripAtHit: +r.lhandToGripAtHit.toFixed(3), lhandToGripMin: +r.lhandToGripMin.toFixed(3) } };
      }
      // 重要戰鬥特效例外（施放者 40 m 外、鏡頭背後）
      const ess = await page.evaluate(() => window.__n75.essentialCheck());
      run.results.essential = ess;
      check("重要特效：Boss 範圍預警（遠＋畫面外）照樣顯示", ess.bossWarning, ess);
      check("重要特效：自己在敵方危險範圍內 → 顯示", ess.dangerOnMe);
      check("重要特效：自己在治療範圍內 → 顯示", ess.healOnMe);
      check("重要特效：飛向自己的投射物（遠＋畫面外）→ 顯示", ess.projectileToMe);
      check("重要特效：必要狀態提示 → 顯示", ess.statusCue);
      check("一般規則：不影響自己的遠方危險範圍／投射物 → 省略", ess.dangerFarAway === false && ess.projectileElsewhere === false);
      check("一般規則：遠方其他玩家的裝飾粒子 → 省略", ess.decorCulled);
      await shot("99_end");
    } catch (e) {
      run.errors.push(`exception: ${e instanceof Error ? e.message : String(e)}`);
    }
    check("沒有頁面錯誤", run.errors.length === 0, run.errors.slice(0, 5));
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
  for (const [k, v] of Object.entries(r.checks)) lines.push(`- ${v.ok ? "✅" : "❌"} ${k}${v.ok ? "" : `  ${JSON.stringify(v.detail)?.slice(0, 300)}`}`);
  for (const w of r.warnings ?? []) lines.push(`- ⚠️ ${w}`);
  if (r.errors.length) lines.push(`- errors: ${r.errors.slice(0, 5).join(" | ")}`);
}
writeFileSync(`${outDir}summary.md`, lines.join("\n") + "\n");
console.log(lines.join("\n"));
console.log(`failures: ${failures}`);
process.exit(failures ? 1 : 0);
