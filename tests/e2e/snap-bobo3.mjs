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
  // V3.8R：另外截 45 度角與俯視；灰模（不顯示臉部）不截表情
  const grey = await page.evaluate(() => !!window.__monsterLab.perf().grey);
  const views5 = await page.evaluate(() => !!window.__monsterLab.perf().views5);
  const VIEWS = views5 ? ["front", "side", "back", "q45", "top"] : ["front", "side", "back"];
  // V3.8R 第四階段：靜態截圖一律用靜止姿勢（和前幾版可直接比較）；動畫另外截連續畫格
  const hasAnim = await page.evaluate(() => typeof window.__monsterLab.setAnim === "function");
  if (hasAnim) await page.evaluate(() => window.__monsterLab.setAnim("none"));
  for (const v of VIEWS) {
    await page.evaluate((x) => window.__monsterLab.setView(x), v);
    await shot(`v_${v}`, v);
  }
  // 設定圖對照模式（有提供 setRefMode 的測試頁）：同樣三個視角，平視＋設定圖背景色
  if (await page.evaluate(() => typeof window.__monsterLab.setRefMode === "function")) {
    await page.evaluate(() => window.__monsterLab.setRefMode(true));
    for (const v of views5 ? ["front", "side", "back", "q45"] : ["front", "side", "back"]) {
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
  // 動畫畫格（Chromium）：對照模式正面與 45 度，各 12 格涵蓋一個待機週期（2.6 秒）
  if (hasAnim && browserName === "chromium") {
    await page.evaluate(() => {
      window.__monsterLab.setExpression("normal");
      window.__monsterLab.setRefMode(true);
      window.__monsterLab.setAnim("idle");
    });
    for (const v of ["front", "q45"]) {
      await page.evaluate((x) => window.__monsterLab.setView(x), v);
      for (let k = 0; k < 12; k++) {
        await page.evaluate((t) => window.__monsterLab.holdAnimAt(t), (k * 2.6) / 12);
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${outDir}/a_idle_${v}_${String(k).padStart(2, "0")}.png` });
        shots.push({ name: `a_idle_${v}_${k}`, label: `待機 ${v} ${k}` });
      }
    }
    // 移動（果凍彈跳）：原地停格一次彈跳 12 格（0.62 秒），側面與 45 度
    const hasMove = await page.evaluate(() => {
      window.__monsterLab.setAnim("move");
      return window.__monsterLab.perf().anim === "move";
    });
    if (hasMove) {
      for (const v of ["side", "q45"]) {
        await page.evaluate((x) => window.__monsterLab.setView(x), v);
        for (let k = 0; k < 12; k++) {
          await page.evaluate((t) => window.__monsterLab.holdAnimAt(t), (k * 0.62) / 12);
          await page.waitForTimeout(250);
          await page.screenshot({ path: `${outDir}/a_move_${v}_${String(k).padStart(2, "0")}.png` });
          shots.push({ name: `a_move_${v}_${k}`, label: `移動 ${v} ${k}` });
        }
      }
    }
    // 攻擊：停格 12 格涵蓋 0.95 秒（蓄力／出招／收招），側面與 45 度
    const hasAttack = await page.evaluate(() => {
      window.__monsterLab.setAnim("none"); // 停格模式下移動還沒跳完，先重設再切攻擊
      window.__monsterLab.setAnim("attack");
      return window.__monsterLab.perf().anim === "attack";
    });
    if (hasAttack) {
      for (const v of ["side", "q45"]) {
        await page.evaluate((x) => window.__monsterLab.setView(x), v);
        for (let k = 0; k < 12; k++) {
          await page.evaluate((t) => window.__monsterLab.holdAnimAt(t), (k * 0.95) / 11);
          await page.waitForTimeout(250);
          await page.screenshot({ path: `${outDir}/a_attack_${v}_${String(k).padStart(2, "0")}.png` });
          shots.push({ name: `a_attack_${v}_${k}`, label: `攻擊 ${v} ${k}` });
        }
      }
    }
    await page.evaluate(() => {
      window.__monsterLab.setRefMode(false);
      window.__monsterLab.setView("front");
      window.__monsterLab.setAnim("idle");
    });
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
