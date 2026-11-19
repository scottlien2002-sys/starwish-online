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
    // 受傷：停格 12 格涵蓋 0.75 秒（衝擊／後退／回彈／恢復），正面、側面、45 度
    const hasHurt = await page.evaluate(() => typeof window.__monsterLab.hurt === "function");
    if (hasHurt) {
      await page.evaluate(() => {
        window.__monsterLab.setAnim("none");
        window.__monsterLab.setAnim("hurt");
      });
      for (const v of ["front", "side", "q45"]) {
        await page.evaluate((x) => window.__monsterLab.setView(x), v);
        await page.evaluate(() => window.__monsterLab.holdAnimAt(0.75));
        await page.waitForTimeout(500); // 換視角後先等畫面更新，避免第一格截到舊畫面
        for (let k = 0; k < 12; k++) {
          await page.evaluate((t) => window.__monsterLab.holdAnimAt(t), (k * 0.75) / 11);
          await page.waitForTimeout(250);
          await page.screenshot({ path: `${outDir}/a_hurt_${v}_${String(k).padStart(2, "0")}.png` });
          shots.push({ name: `a_hurt_${v}_${k}`, label: `受傷 ${v} ${k}` });
        }
      }
      // 受傷前後外觀一致性：靜止姿勢 → 實際播放一次受傷 → 播完後切回靜止姿勢，正面各截一張
      await page.evaluate(() => {
        window.__monsterLab.setView("front");
        window.__monsterLab.setAnim("none");
      });
      await shot("h_before", "受傷前（靜止）");
      await page.evaluate(() => window.__monsterLab.setAnim("idle"));
      await page.evaluate(() => window.__monsterLab.hurt());
      await page.waitForTimeout(2500);
      const st = await page.evaluate(() => window.__monsterLab.animState());
      writeFileSync(`${outDir}/h_after_state.json`, JSON.stringify(st, null, 2));
      await page.evaluate(() => window.__monsterLab.freezeRest()); // 換成靜止姿勢、不重設位置（有殘留就會看得出來）
      await shot("h_after", "受傷後（靜止）");
    }
    // 死亡：停格 12 格涵蓋 1.8 秒（衝擊／軟倒／星光漸弱／星塵消散／消失），正面、側面、45 度
    const hasDeath = await page.evaluate(() => typeof window.__monsterLab.death === "function");
    if (hasDeath) {
      await page.evaluate(() => {
        window.__monsterLab.setAnim("none");
        window.__monsterLab.setAnim("death");
      });
      for (const v of ["front", "side", "q45"]) {
        await page.evaluate((x) => window.__monsterLab.setView(x), v);
        await page.evaluate(() => window.__monsterLab.holdAnimAt(0));
        await page.waitForTimeout(500);
        for (let k = 0; k < 12; k++) {
          await page.evaluate((t) => window.__monsterLab.holdAnimAt(t), (k * 1.8) / 11);
          await page.waitForTimeout(250);
          await page.screenshot({ path: `${outDir}/a_death_${v}_${String(k).padStart(2, "0")}.png` });
          shots.push({ name: `a_death_${v}_${k}`, label: `死亡 ${v} ${k}` });
        }
      }
      // 死亡前／重生後外觀一致性：靜止 → 實際播放一次死亡（2.5 秒）→ 重生 → 靜止，正面、45 度各截一張
      for (const v of ["front", "q45"]) {
        await page.evaluate((x) => {
          window.__monsterLab.setView(x);
          window.__monsterLab.setAnim("none");
        }, v);
        await shot(`d_before_${v}`, `死亡前 ${v}`);
        await page.evaluate(() => window.__monsterLab.setAnim("idle"));
        await page.evaluate(() => window.__monsterLab.death());
        await page.waitForTimeout(2600);
        await shot(`d_dead_${v}`, `死亡後（保持死亡）${v}`);
        const st = await page.evaluate(() => ({ s: window.__monsterLab.animState(), r: window.__monsterLab.resourceCounts() }));
        writeFileSync(`${outDir}/d_dead_${v}_state.json`, JSON.stringify(st, null, 2));
        await page.evaluate(() => {
          window.__monsterLab.respawn();
          window.__monsterLab.freezeRest();
        });
        await shot(`d_after_${v}`, `重生後 ${v}`);
        const st2 = await page.evaluate(() => window.__monsterLab.resourceCounts());
        writeFileSync(`${outDir}/d_after_${v}_state.json`, JSON.stringify(st2, null, 2));
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
