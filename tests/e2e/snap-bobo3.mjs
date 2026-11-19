// 怪物測試頁截圖工具（共用）：三視圖、表情、三隻同場、正面近距離，供外觀審查與版本對照。
// 任何實作 window.__monsterLab（ready、setView、setExpression、setCount、setClose、info、perf）的測試頁都可用；
// 規格見 docs/monsters/ASSET_PIPELINE.md「三視圖自動截圖」。
// 用法：node tests/e2e/snap-bobo3.mjs <distDir> <outDir> [webkit|chromium] [quality] [lab 名稱，例 bobo36]
//       CLOSE_ONLY=1 只截正面近距離
// 注意：雲端（CI）為軟體繪圖，截圖只看外觀；FPS 不代表手機實測。
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";

const [distDir, outDir, browserName = "webkit", quality = "high", lab = "bobo3"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const pw = await loadPlaywright();
const server = await serve(distDir);
const browser = await pw[browserName].launch();
const page = await browser.newPage({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => (m.type() === "error" || m.text().includes("[bobo3]")) && errors.push(`console.${m.type()}: ${m.text()}`));
await page.goto(`${server.url}/?lab=${lab}&quality=${quality}&mobile=1`, { waitUntil: "load" });
const ok = await page.waitForFunction(() => window.__monsterLab?.ready === true || document.querySelector(".boot-status.error"), null, { timeout: 60000 }).then(() => page.evaluate(() => window.__monsterLab?.ready === true)).catch(() => false);
const shots = [];
const shot = async (name, label) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  shots.push({ name, label });
};
const closeOnly = process.env.CLOSE_ONLY === "1";
if (ok && closeOnly) {
  // 只截正面近距離（高畫質在 CI 的 WebKit 軟體繪圖下近距離會截到空白，改用 Chromium 補一張）
  await page.addStyleTag({ content: "#hud-root{visibility:hidden}" });
  await page.evaluate(() => { window.__monsterLab.setView("front"); window.__monsterLab.setClose(true); });
  await shot("c_front", "front close");
} else if (ok) {
  // 隱藏 UI，只看模型
  await page.addStyleTag({ content: "#hud-root{visibility:hidden}" });
  // V3.8R 灰模：另外截 45 度角與俯視；灰模不顯示臉部，所以不截表情
  const grey = await page.evaluate(() => !!window.__monsterLab.perf().grey);
  const VIEWS = grey ? ["front", "side", "back", "q45", "top"] : ["front", "side", "back"];
  for (const v of VIEWS) {
    await page.evaluate((x) => window.__monsterLab.setView(x), v);
    await shot(`v_${v}`, v);
  }
  // 設定圖對照模式（有提供 setRefMode 的測試頁）：同樣三個視角，平視＋設定圖背景色
  if (await page.evaluate(() => typeof window.__monsterLab.setRefMode === "function")) {
    await page.evaluate(() => window.__monsterLab.setRefMode(true));
    for (const v of grey ? ["front", "side", "back", "q45"] : ["front", "side", "back"]) {
      await page.evaluate((x) => window.__monsterLab.setView(x), v);
      await shot(`r_${v}`, `對照 ${v}`);
    }
    await page.evaluate(() => window.__monsterLab.setRefMode(false));
  }
  await page.evaluate(() => window.__monsterLab.setView("front"));
  // 正面近距離（腹部星星等細節對照）
  if (await page.evaluate(() => typeof window.__monsterLab.setClose === "function")) {
    await page.evaluate(() => window.__monsterLab.setClose(true));
    await shot("c_front", "front close");
    await page.evaluate(() => window.__monsterLab.setClose(false));
  }
  for (const e of grey ? [] : ["normal", "happy", "curious", "angry", "scared", "dizzy", "sleepy", "hurt"]) {
    await page.evaluate((x) => window.__monsterLab.setExpression(x), e);
    await shot(`e_${e}`, e);
  }
  await page.evaluate(() => {
    window.__monsterLab.setExpression("normal");
    window.__monsterLab.setCount(3);
  });
  await shot("count3", "3 隻");
}
const info = ok ? await page.evaluate(() => ({ info: window.__monsterLab.info(), perf: window.__monsterLab.perf() })) : null;
const boot = await page.evaluate(() => document.getElementById("boot-status")?.textContent ?? null);
writeFileSync(`${outDir}/shots.json`, JSON.stringify({ ok, boot, errors, shots, ...info }, null, 2));
console.log(`bobo3 ${quality}: ok=${ok} shots=${shots.length} errors=${errors.length}`, boot ?? "");
await browser.close();
await server.close();
