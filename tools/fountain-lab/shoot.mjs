// P3-1B 星願之泉預覽頁截圖與量測（只在 Blender 美術工作流程執行；不部署）
// 用法：node tools/fountain-lab/shoot.mjs <建置資料夾> <輸出資料夾>
// 注意：CI 是無頭瀏覽器＋軟體繪圖，畫面時間不代表 iPhone，只看相對成本與畫面。
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "../../tests/e2e/static-server.mjs";

const dist = process.argv[2] ?? "out-lab";
const out = process.argv[3] ?? "out/lab";
mkdirSync(out, { recursive: true });
const pw = await loadPlaywright();
const server = await serve(dist);
const report = { startedAt: new Date().toISOString(), runs: [] };
let fail = 0;

const plan = [
  ["chromium", "hq", "high", "hq", ["front", "q45", "top", "close", "falls", "game"]],
  ["chromium", "lite-low", "low", "lite", ["front", "q45", "close", "falls", "game"]],
  ["webkit", "hq", "high", "hq", ["game", "falls"]],
  ["webkit", "lite-low", "low", "lite", ["game"]],
];

for (const [bname, mode, quality, lod, views] of plan) {
  const run = { browser: bname, mode, errors: [], shots: [] };
  report.runs.push(run);
  let browser;
  try {
    browser = await pw[bname].launch();
  } catch (e) {
    run.errors.push(`launch: ${e.message}`);
    fail++;
    continue;
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
  try {
    await page.goto(`${server.url}/?lod=${lod}&quality=${quality}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__lab?.state.ready || window.__lab?.state.error, null, { timeout: 120000 });
    const st = await page.evaluate(() => window.__lab.state);
    if (!st.ready) throw new Error(`load: ${st.error}`);
    run.loadMs = st.loadMs;
    await page.evaluate(() => window.__lab.frames(10));
    run.stats = await page.evaluate(() => window.__lab.stats());
    run.size = await page.evaluate(() => window.__lab.size());
    run.withFountain = await page.evaluate(() => window.__lab.drawCalls(true));
    run.withoutFountain = await page.evaluate(() => window.__lab.drawCalls(false));
    run.fountainDrawCalls = run.withFountain.drawCalls - run.withoutFountain.drawCalls;
    await page.evaluate(() => window.__lab.setTime(3.2));
    for (const v of views) {
      await page.evaluate((name) => window.__lab.setView(name), v);
      await page.evaluate(() => window.__lab.frames(6));
      const f = `${out}/${bname}_${mode}_${v}.png`;
      await page.screenshot({ path: f, timeout: 120000 });
      run.shots.push(f.split("/").pop());
    }
    if (bname === "chromium") {
      run.flicker = {
        game_camera: await page.evaluate(() => window.__lab.flickerTest("game", "camera")),
        q45_camera: await page.evaluate(() => window.__lab.flickerTest("q45", "camera")),
        game_time: await page.evaluate(() => window.__lab.flickerTest("game", "time")),
      };
      await page.evaluate(() => window.__lab.setTime(null));
      await page.evaluate(() => window.__lab.setView("game"));
      await page.evaluate(() => window.__lab.frames(90));
      run.frameMsSoftware = await page.evaluate(() => window.__lab.frameMs());
    }
  } catch (e) {
    run.errors.push(String(e.message ?? e));
    fail++;
  }
  await browser.close();
}
await server.close();
report.finishedAt = new Date().toISOString();
writeFileSync(`${out}/lab_report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
if (fail) process.exit(1);
