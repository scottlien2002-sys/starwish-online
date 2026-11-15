// W1 端對端測試：開啟建置後的遊戲（dist），在 iPhone 尺寸下實際操作。
// 用法：node tests/e2e/run-e2e.mjs dist [chromium,webkit]
// 注意：這是 Linux 無頭瀏覽器 + 軟體繪圖，FPS 只供參考，不代表 iPhone 實機效能。
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, safeAreaCss, serve } from "./static-server.mjs";

const distDir = process.argv[2] ?? "dist";
const browsers = (process.argv[3] ?? "chromium,webkit").split(",");
const outDir = new URL("../../test-results/e2e/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

const VIEWPORTS = [
  { name: "iPhone 15 橫向", width: 852, height: 393, safe: { top: 0, right: 59, bottom: 21, left: 59 } },
  { name: "iPhone SE 直向", width: 375, height: 667, safe: { top: 20, right: 0, bottom: 0, left: 0 } },
];

const pw = await loadPlaywright();
const server = await serve(distDir);
const report = { startedAt: new Date().toISOString(), runs: [] };
let failures = 0;

for (const name of browsers) {
  let browser;
  try {
    browser = await pw[name].launch();
  } catch (e) {
    report.runs.push({ browser: name, ok: false, error: `無法啟動瀏覽器：${e.message}` });
    failures++;
    continue;
  }
  for (const vp of VIEWPORTS) {
    const run = { browser: name, viewport: vp.name, checks: {}, errors: [] };
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
    const check = (key, ok, detail) => {
      run.checks[key] = { ok, detail };
    };

    try {
      await page.goto(server.url + "/", { waitUntil: "load" });
      await page.addStyleTag({ content: safeAreaCss(vp.safe) });
      const ready = await page
        .waitForFunction(() => window.__starwish?.ready === true || document.querySelector(".boot-status.error"), null, { timeout: 45000 })
        .then(() => page.evaluate(() => window.__starwish?.ready === true))
        .catch(() => false);
      const bootError = await page.evaluate(() => document.querySelector(".boot-status.error")?.textContent ?? null);
      check("啟動", ready, bootError ?? "ok");
      if (!ready) throw new Error("遊戲未啟動");

      await page.waitForTimeout(1500);
      const renderer = await page.evaluate(() => window.__starwish.renderer());
      const pixels = await page.evaluate(() => window.__starwish.pixelStats());
      check("3D 畫面有繪製", pixels.distinctColors >= 20 && pixels.opaqueRatio > 0.3, { renderer, pixels });

      const issues = await page.evaluate((s) => window.__starwish.hudIssues(s), vp.safe);
      check("HUD 不重疊/不超出安全區", issues.length === 0, issues);

      // 搖桿往上推 1.2 秒，角色應前進
      const p0 = await page.evaluate(() => window.__starwish.getPlayer());
      const zone = await page.locator(".hud-joystick-zone").boundingBox();
      const sx = zone.x + zone.width * 0.4;
      const sy = zone.y + zone.height * 0.6;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(sx, sy - 70, { steps: 5 });
      await page.waitForTimeout(1200);
      await page.mouse.up();
      const p1 = await page.evaluate(() => window.__starwish.getPlayer());
      const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      check("搖桿移動角色", moved > 2, { from: p0, to: p1, moved });

      // 在畫面空白處拖曳，攝影機應旋轉
      const c0 = await page.evaluate(() => window.__starwish.getCamera());
      const cx = vp.width * 0.6;
      const cy = vp.height * 0.32;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 120, cy, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const c1 = await page.evaluate(() => window.__starwish.getCamera());
      check("拖曳旋轉攝影機", Math.abs(c1.alpha - c0.alpha) > 0.3, { before: c0.alpha, after: c1.alpha });

      // 技能按鈕可按且有回饋
      await page.locator('[data-slot="attack"]').click();
      const toastShown = await page.locator(".hud-toast.show").count();
      check("攻擊按鈕可按", toastShown > 0, null);

      // 持續移動 3 秒取樣 FPS（僅供參考）
      await page.evaluate(() => window.__starwish.setMove({ x: 0.3, y: 1 }));
      const fpsSamples = [];
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(500);
        fpsSamples.push(await page.evaluate(() => window.__starwish.fps()));
      }
      await page.evaluate(() => window.__starwish.setMove(null));
      run.fpsReference = fpsSamples;

      const shot = `${outDir}${name}_${vp.name.replace(/\s+/g, "_")}.png`;
      await page.screenshot({ path: shot });
      run.screenshot = shot.split("/test-results/")[1];
    } catch (e) {
      run.errors.push(`exception: ${e.message}`);
    }

    run.ok = run.errors.length === 0 && Object.values(run.checks).every((c) => c.ok) && Object.keys(run.checks).length >= 6;
    if (!run.ok) failures++;
    report.runs.push(run);
    console.log(`${run.ok ? "PASS" : "FAIL"}  ${name} / ${vp.name}`);
    for (const [k, v] of Object.entries(run.checks)) console.log(`   ${v.ok ? "✓" : "✗"} ${k}`);
    for (const e of run.errors) console.log(`   ! ${e}`);
    if (run.fpsReference) console.log(`   FPS(參考): ${run.fpsReference.map((f) => f.toFixed(0)).join(", ")}`);
    await ctx.close();
  }
  await browser.close();
}

await server.close();
report.finishedAt = new Date().toISOString();
report.failures = failures;
writeFileSync(`${outDir}report.json`, JSON.stringify(report, null, 2));
console.log(failures ? `\n${failures} 項失敗` : "\n全部通過");
process.exit(failures ? 1 : 0);
