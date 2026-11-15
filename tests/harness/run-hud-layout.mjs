// 本機可執行的 HUD 測試（不需要 Babylon.js）：
// 1. 以 TypeScript 編譯 UI / 輸入模組到 .harness/
// 2. 在無頭瀏覽器以 iPhone 尺寸開啟 tests/harness/hud.html
// 3. 檢查按鈕不重疊、不超出安全區、觸控範圍 >= 44px、搖桿與按鈕可操作
//
// 用法：node tests/harness/run-hud-layout.mjs [chromium|webkit]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { IPHONE_VIEWPORTS, loadPlaywright, safeAreaCss, serve } from "../e2e/static-server.mjs";

const browserName = process.argv[2] ?? "chromium";
const root = new URL("../../", import.meta.url).pathname;

function compileHarness() {
  let tsc;
  try {
    tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  } catch {
    tsc = process.env.TSC_PATH;
  }
  if (!tsc) throw new Error("找不到 TypeScript（npm install 或設定 TSC_PATH）");
  execFileSync(process.execPath, [
    tsc,
    "--ignoreConfig",
    "--outDir", `${root}.harness`, "--rootDir", `${root}src`,
    "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler",
    "--lib", "ES2022,DOM,DOM.Iterable", "--strict", "--skipLibCheck",
    "--allowImportingTsExtensions", "--rewriteRelativeImportExtensions", "--erasableSyntaxOnly",
    `${root}src/ui/Hud.ts`, `${root}src/ui/layout-check.ts`, `${root}src/input/VirtualJoystick.ts`, `${root}src/input/InputState.ts`,
  ], { stdio: "inherit" });
}

compileHarness();
const pw = await loadPlaywright();
const server = await serve(root);
const browser = await pw[browserName].launch();
const outDir = `${root}test-results/hud`;
mkdirSync(outDir, { recursive: true });

const results = [];
let failed = 0;
for (const vp of IPHONE_VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${server.url}/tests/harness/hud.html`);
  await page.addStyleTag({ content: safeAreaCss(vp.safe) });
  await page.waitForFunction(() => window.__harness?.ready === true);

  const issues = await page.evaluate((s) => window.__harness.issues(s), vp.safe);

  // 搖桿：在搖桿區按下並往上拖
  const zone = await page.locator(".hud-joystick-zone").boundingBox();
  const sx = zone.x + zone.width * 0.4;
  const sy = zone.y + zone.height * 0.6;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx, sy - 70, { steps: 5 });
  const move = await page.evaluate(() => window.__harness.move());
  await page.mouse.up();
  const after = await page.evaluate(() => window.__harness.move());
  const joystickOk = move.y > 0.9 && Math.abs(move.x) < 0.1 && after.y === 0;

  // 技能按鈕：每顆都能按到（點擊中心點，確認沒有被其他元素蓋住）
  for (const slot of ["attack", "skill1", "skill2", "skill3"]) {
    await page.locator(`[data-slot="${slot}"]`).click();
  }
  const pressed = await page.evaluate(() => [...window.__harness.pressed]);
  const buttonsOk = ["attack", "skill1", "skill2", "skill3"].every((s) => pressed.includes(s));

  const file = `${outDir}/${vp.name.replace(/\s+/g, "_")}.png`;
  await page.screenshot({ path: file });

  const ok = issues.length === 0 && joystickOk && buttonsOk && errors.length === 0;
  if (!ok) failed++;
  results.push({ viewport: vp.name, size: `${vp.width}x${vp.height}`, ok, issues, joystick: { move, after, ok: joystickOk }, pressed, errors, screenshot: file });
  console.log(`${ok ? "PASS" : "FAIL"}  ${vp.name} (${vp.width}x${vp.height})` +
    (issues.length ? `\n      版面問題: ${issues.join("; ")}` : "") +
    (!joystickOk ? `\n      搖桿異常: ${JSON.stringify(move)} → ${JSON.stringify(after)}` : "") +
    (!buttonsOk ? `\n      按鈕未全部觸發: ${pressed.join(",")}` : "") +
    (errors.length ? `\n      錯誤: ${errors.join("; ")}` : ""));
  await ctx.close();
}

await browser.close();
await server.close();
writeFileSync(`${outDir}/report.json`, JSON.stringify({ browser: browserName, results }, null, 2));
console.log(`\n${results.length - failed}/${results.length} 個尺寸通過（${browserName}）`);
process.exit(failed ? 1 : 0);
