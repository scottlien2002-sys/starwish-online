// 星露啵啵動作截圖（用於版本前後比較）
// 以「固定 1/60 秒逐幀推進」控制動畫時間（替換 requestAnimationFrame 與 performance.now），
// 前後兩個版本會在完全相同的動畫時間點截圖，不受 CI 軟體繪圖速度影響。
// 用法：node tests/e2e/snap-lab.mjs <distDir> <outDir> [webkit|chromium] [lab|game] [quality]
//   lab  = 星露啵啵測試頁（11 張動作）
//   game = W1 新手草原（同一鏡頭 3 張）
//   quality = high / medium / low（舊版本會忽略此參數）
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";

const [distDir, outDir, browserName = "webkit", mode = "lab", quality = ""] = process.argv.slice(2);
if (!distDir || !outDir) throw new Error("usage: snap-lab.mjs <distDir> <outDir> [browser]");
mkdirSync(outDir, { recursive: true });

const pw = await loadPlaywright();
const server = await serve(distDir);
const browser = await pw[browserName].launch();
const page = await browser.newPage({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.addInitScript(() => {
  let now = 0;
  let queue = [];
  let id = 0;
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => {
    const h = ++id;
    queue.push([h, cb]);
    return h;
  };
  window.cancelAnimationFrame = (h) => {
    queue = queue.filter((q) => q[0] !== h);
  };
  window.__stepFrames = (frames) => {
    for (let i = 0; i < frames; i++) {
      now += 1000 / 60;
      const q = queue;
      queue = [];
      for (const [, cb] of q) cb(now);
    }
  };
});
const q = quality ? `quality=${quality}` : "";
const url = mode === "game" ? `/?${q}` : `/?lab=bobo${q ? "&" + q : ""}`;
await page.goto(server.url + url, { waitUntil: "load" });

const readyExpr = mode === "game" ? "window.__starwish?.ready === true" : "window.__starwishLab?.ready === true";
let ready = false;
for (let i = 0; i < 100 && !ready; i++) {
  await page.waitForTimeout(100);
  ready = await page.evaluate(readyExpr);
}
if (!ready) throw new Error("lab not ready: " + errors.join("; "));

const run = (ms) => page.evaluate((n) => window.__stepFrames(n), Math.round((ms * 60) / 1000));

// 預熱：著色器在 GPU 上是非同步編譯，需要真實時間；先推幾幀並等待，避免第一張截圖空白
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => window.__stepFrames(2));
  await page.waitForTimeout(500);
}
const req = (a) => page.evaluate((x) => window.__starwishLab.request(x), a);
const shots = [];
const shot = async (name, caption) => {
  const state = mode === "game" ? "game" : await page.evaluate(() => window.__starwishLab.state());
  await page.screenshot({ path: `${outDir}/${name}.png` });
  shots.push({ name, caption, state });
};

// 計時檢查：推進 60 幀（1 秒），遊戲內累積時間應為 1 秒（只有新版有此除錯介面）
let timing = null;
if (mode === "game") {
  timing = await page.evaluate(async () => {
    if (!window.__starwish.consumeTime) return null;
    window.__starwish.consumeTime();
    window.__stepFrames(60);
    return window.__starwish.consumeTime();
  });
  console.log("timing(60 frames):", JSON.stringify(timing));
}

if (mode === "game") {
  // W1 新手草原：固定鏡頭（出生點）→ 往前走 → 斜向走，三個相同鏡頭
  await run(1500);
  await shot("g01_spawn", "草原：出生點");
  await page.evaluate(() => window.__starwish.setMove({ x: 0, y: 1 }));
  await run(1500);
  await shot("g02_walk", "草原：前進 1.5 秒");
  await page.evaluate(() => window.__starwish.setMove({ x: 0.8, y: 0.6 }));
  await run(1500);
  await page.evaluate(() => window.__starwish.setMove(null));
  await run(300);
  await shot("g03_turn", "草原：斜向移動後");
  const perf = await page.evaluate(() => (window.__starwish.perf ? window.__starwish.perf() : null));
  writeFileSync(`${outDir}/shots.json`, JSON.stringify({ shots, errors, perf, timing }, null, 2));
  console.log(`${shots.length} shots → ${outDir}` + (errors.length ? `\nerrors: ${errors.join("; ")}` : ""));
  await browser.close();
  await server.close();
  process.exit(0);
}

await run(1500);
await shot("01_idle", "待機");

await req("move");
await run(300);
await shot("02_move_a", "移動（起跳）");
await run(160);
await shot("03_move_b", "移動（落地）");

await req("idle");
await run(900);

await req("attack");
await run(250);
await shot("04_attack_charge", "攻擊 0.25 秒（蓄力）");
await run(140);
await shot("05_attack_dash", "攻擊 0.39 秒（衝撞）");
await run(60);
await shot("06_attack_impact", "攻擊 0.45 秒（撞擊）");
await run(250);
await shot("07_attack_rebound", "攻擊 0.70 秒（回彈）");
await run(700);

await req("hit");
await run(120);
await shot("08_hit", "受傷");
await run(700);

await req("death");
await run(700);
await shot("09_death", "死亡（消散中）");
await run(1300);

await req("respawn");
await run(900);
await shot("10_respawn", "重生（凝聚中）");
await run(1500);
await shot("11_after_respawn", "重生完成");

const perf = await page.evaluate(() => (window.__starwishLab.perf ? window.__starwishLab.perf() : null));
writeFileSync(`${outDir}/shots.json`, JSON.stringify({ shots, errors, perf }, null, 2));
console.log(`${shots.length} shots → ${outDir}` + (errors.length ? `\nerrors: ${errors.join("; ")}` : ""));
await browser.close();
await server.close();
