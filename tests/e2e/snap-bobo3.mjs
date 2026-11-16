// 星露啵啵 V3 模型預覽截圖（?lab=bobo3）：三視圖、8 種表情、三隻同場，供外觀審查。
// 用法：node tests/e2e/snap-bobo3.mjs <distDir> <outDir> [webkit|chromium] [quality]
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
const ok = await page.waitForFunction(() => window.__bobo3?.ready === true || document.querySelector(".boot-status.error"), null, { timeout: 60000 }).then(() => page.evaluate(() => window.__bobo3?.ready === true)).catch(() => false);
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
  await page.evaluate(() => { window.__bobo3.setView("front"); window.__bobo3.setClose(true); });
  await shot("c_front", "front close");
} else if (ok) {
  // 隱藏 UI，只看模型
  await page.addStyleTag({ content: "#hud-root{visibility:hidden}" });
  for (const v of ["front", "side", "back"]) {
    await page.evaluate((x) => window.__bobo3.setView(x), v);
    await shot(`v_${v}`, v);
  }
  await page.evaluate(() => window.__bobo3.setView("front"));
  // 正面近距離（腹部星星等細節對照）
  if (await page.evaluate(() => typeof window.__bobo3.setClose === "function")) {
    await page.evaluate(() => window.__bobo3.setClose(true));
    await shot("c_front", "front close");
    await page.evaluate(() => window.__bobo3.setClose(false));
  }
  for (const e of ["normal", "happy", "curious", "angry", "scared", "dizzy", "sleepy", "hurt"]) {
    await page.evaluate((x) => window.__bobo3.setExpression(x), e);
    await shot(`e_${e}`, e);
  }
  await page.evaluate(() => {
    window.__bobo3.setExpression("normal");
    window.__bobo3.setCount(3);
  });
  await shot("count3", "3 隻");
}
const info = ok ? await page.evaluate(() => ({ info: window.__bobo3.info(), perf: window.__bobo3.perf() })) : null;
const boot = await page.evaluate(() => document.getElementById("boot-status")?.textContent ?? null);
writeFileSync(`${outDir}/shots.json`, JSON.stringify({ ok, boot, errors, shots, ...info }, null, 2));
console.log(`bobo3 ${quality}: ok=${ok} shots=${shots.length} errors=${errors.length}`, boot ?? "");
await browser.close();
await server.close();
