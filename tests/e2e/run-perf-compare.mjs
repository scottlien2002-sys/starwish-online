// Stage 7.4 效能對照（CI，不是 iPhone 實機）：
// 同一台 CI 機器、同一個瀏覽器，依序跑
//   A. Stage 7.3 原版（0366d0fa 建置）
//   B. Stage 7.4、關閉所有 7.4 開關（&mlod=0&shadowq=original）
//   C. Stage 7.4 完整優化
// 每組：高畫質、星芽原野、自動打怪 bench（2 秒暖機＋N 秒計算）。
// CI 沒有實體 GPU（軟體繪製），FPS 的「絕對值」沒有參考價值，只看「相對變化」與 CPU 端時間、Draw Calls、三角面、動畫更新數。
// 另跑一次長時間穩定性（預設 180 秒）：沒有錯誤、資源數（mesh／材質／貼圖）不持續增加。
// 用法：node tests/e2e/run-perf-compare.mjs <dist73> <dist74> [chromium] [benchSeconds] [soakSeconds]
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";

const [dist73, dist74] = [process.argv[2], process.argv[3]];
const browserName = process.argv[4] ?? "chromium";
const benchS = Number(process.argv[5] ?? 60);
const soakS = Number(process.argv[6] ?? 180);
const outDir = new URL("../../test-results/perf-compare/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const pw = await loadPlaywright();
const s73 = await serve(dist73);
const s74 = await serve(dist74);
const browser = await pw[browserName].launch({ args: browserName === "chromium" ? ["--enable-precise-memory-info", "--ignore-gpu-blocklist"] : [] });
const report = { startedAt: new Date().toISOString(), browser: browserName, benchSeconds: benchS, note: "CI 軟體繪製，不是 iPhone；只比較相對變化", runs: [], soak: null };
let failures = 0;

async function openField(base, extra, label) {
  const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  // 新存檔 → 直接把存檔地圖設成星芽原野（與走南門進入相同的存檔狀態）
  await page.goto(`${base}/?play=world&newgame=1&g=male&seed=11&quality=high`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__starwishWorld?.ready === true, null, { timeout: 180000 });
  // 離開村莊（村莊在離開時會寫入存檔）→ 到同網域的非遊戲頁面再改存檔，才不會被覆蓋
  await page.goto(`${base}/__perf_blank__.json`, { waitUntil: "load" }).catch(() => {});
  await page.evaluate(() => {
    const k = "starwish.stage7.save.v1";
    const s = JSON.parse(localStorage.getItem(k));
    s.character.map = "starsprout";
    s.character.x = null;
    s.character.z = null;
    localStorage.setItem(k, JSON.stringify(s));
  });
  // 只計算原野遊戲頁面的錯誤（前面自己開的空白頁 404 不算）
  errors.length = 0;
  await page.goto(`${base}/?play=world&seed=11&quality=high${extra}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__starwishPlay?.ready === true && !!window.__starwishPlay.world, null, { timeout: 180000 });
  await page.waitForFunction(() => window.__starwishPlay.info().monsters.length >= 20, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(4000);
  return { ctx, page, errors, label };
}

const variants = [
  { label: "A_stage73", base: s73.url, extra: "" },
  { label: "B_stage74_off", base: s74.url, extra: "&mlod=0&shadowq=original" },
  { label: "C_stage74", base: s74.url, extra: "" },
];

for (const v of variants) {
  const run = { label: v.label, url: v.extra || "(預設)", ok: false };
  try {
    const { ctx, page, errors } = await openField(v.base, v.extra, v.label);
    await page.evaluate(() => window.__starwishPlay.perf?.reset());
    run.bench = await page.evaluate((s) => window.__starwishPlay.bench(s), benchS);
    run.info = await page.evaluate(() => {
      const i = window.__starwishPlay.info();
      return { monsters: i.monsters.length, tiers: i.monsterDetail ?? null, rig: (i.monsters ?? []).slice(0, 3) };
    });
    run.session = await page.evaluate(() => {
      // 7.4 才有完整 session（Draw Calls、CPU、記憶體）；7.3 只有基本欄位
      const pf = window.__starwishPlay.perf ?? null;
      return pf ? pf.session() : null;
    });
    await page.screenshot({ path: `${outDir}${v.label}.png` }).catch(() => {});
    run.errors = errors;
    run.ok = errors.length === 0;
    if (!run.ok) failures++;
    await ctx.close();
  } catch (e) {
    run.error = String(e?.stack ?? e);
    failures++;
  }
  report.runs.push(run);
  console.log(v.label, JSON.stringify(run.bench ?? run.error));
}

// 長時間穩定性（7.4 完整優化）
if (soakS > 0) {
  const soak = { seconds: soakS, ok: false, samples: [] };
  try {
    const { ctx, page, errors } = await openField(s74.url, "", "soak");
    const sample = () => page.evaluate(() => {
      const r = window.__starwishPlay.perf?.session();
      const i = window.__starwishPlay.info();
      return { t: r?.seconds, mem: r?.memory, kills: i.kills ?? null, monsters: i.monsters.length };
    });
    await page.evaluate(() => window.__starwishPlay.perf?.reset());
    soak.samples.push(await sample());
    const p = page.evaluate((s) => window.__starwishPlay.bench(s), soakS);
    for (let t = 30; t < soakS; t += 30) {
      await page.waitForTimeout(30000);
      soak.samples.push(await sample());
    }
    soak.bench = await p;
    soak.samples.push(await sample());
    const m0 = soak.samples[1]?.mem, m1 = soak.samples.at(-1)?.mem;
    soak.growth = m0 && m1 ? { meshes: m1.meshes - m0.meshes, materials: m1.materials - m0.materials, textures: m1.textures - m0.textures } : null;
    soak.errors = errors;
    soak.ok = errors.length === 0 && soak.bench.contextLost === 0 && (!soak.growth || (soak.growth.materials <= 4 && soak.growth.textures <= 4 && soak.growth.meshes <= 40));
    if (!soak.ok) failures++;
    await page.screenshot({ path: `${outDir}soak_end.png` }).catch(() => {});
    await ctx.close();
  } catch (e) {
    soak.error = String(e?.stack ?? e);
    failures++;
  }
  report.soak = soak;
}

const A = report.runs[0]?.bench, C = report.runs[2]?.bench;
if (A && C) report.delta = { avgFps: +(C.avgFps - A.avgFps).toFixed(1), low1Fps: +(C.low1Fps - A.low1Fps).toFixed(1), avgDraw: +(C.avgDraw - A.avgDraw).toFixed(0), ratio: +(C.avgFps / Math.max(A.avgFps, 0.1)).toFixed(2) };
report.finishedAt = new Date().toISOString();
writeFileSync(outDir + "report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ delta: report.delta, soak: report.soak && { ok: report.soak.ok, growth: report.soak.growth, bench: report.soak.bench } }, null, 2));
await browser.close();
s73.close?.();
s74.close?.();
process.exit(failures ? 1 : 0);
