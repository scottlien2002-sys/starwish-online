// 星廢垃圾場 V3：大型地標（CI 軟體繪圖，不是 iPhone 實機）
// 1. 參考截圖：目前程序化地標在場景中的位置與比例（給 ChatGPT 設定圖、Tripo 製作參考）＋俯視位置圖
// 2. GLB 載入流程測試：用「測試替身」GLB（任意大小、原點偏移）驗證自動縮放、落地、朝向、吊臂旋轉、HQ／Lite 切換、程序化地標隱藏
// 3. 沒有 GLB 時（正式狀態）：不發出任何地標 GLB 請求、維持程序化地標
// 用法：node tests/e2e/run-junkyard-landmarks-e2e.mjs dist [chromium] [輸出資料夾]
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadPlaywright, serve } from "./static-server.mjs";

const distDir = process.argv[2] ?? "dist";
const browserName = process.argv[3] ?? "chromium";
const outDir = process.argv[4] ?? new URL("../../test-results/junkyard-landmarks/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const pw = await loadPlaywright();

// 測試替身版的網站（複製 dist，加上替身 GLB 與清單）
const testDist = "/tmp/jy-lm-dist";
rmSync(testDist, { recursive: true, force: true });
cpSync(distDir, testDist, { recursive: true });
execFileSync("node", [new URL("../../tools/make-landmark-test-glbs.mjs", import.meta.url).pathname, `${testDist}/models/junkyard`], { stdio: "inherit" });

const real = await serve(distDir);
const test = await serve(testDist);
const browser = await pw[browserName].launch();
const report = { startedAt: new Date().toISOString(), note: "CI 軟體繪圖；GLB 為測試替身（不是正式美術）", runs: [], checks: [] };
let failures = 0;
const check = (name, ok, detail) => {
  report.checks.push({ name, ok: !!ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "✔" : "✘"} ${name}`, JSON.stringify(detail)?.slice(0, 300));
};
const settle = (page, n = 4) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

// 參考視角：鏡頭位置與注視點（相對地面高度），整個地標入鏡
const VIEWS = [
  { id: "colossus", label: "廢棄機械巨像", from: [72, 12, -16], to: [108, 4, -46] },
  { id: "furnace1", label: "廢鐵熔爐（工廠高台）", from: [-38, 30, 70], to: [-60, 21, 90], abs: true },
  { id: "furnace2", label: "廢鐵熔爐（工廠地面）", from: [-50, 21, 42], to: [-70, 17, 58], abs: true },
  { id: "crane1", label: "廢料回收吊車（回收區）", from: [-38, 22, -14], to: [-72, 20, -47], abs: true },
  { id: "crane3", label: "廢料回收吊車（中央窪地）", from: [34, 9, -30], to: [6, 9, -60] },
  { id: "reactor", label: "魔導核心反應爐", from: [22, 33, 78], to: [22, 33, 128], abs: true },
];

async function open(base, q, extra = "") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { window.__swNoNav = true; });
  const page = await ctx.newPage();
  const errors = [];
  const glbReq = [];
  const bad = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  page.on("request", (r) => /jy_lm_.*\.glb/.test(r.url()) && glbReq.push(r.url().split("/").pop()));
  page.on("response", (r) => r.status() >= 400 && bad.push(`${r.status()} ${r.url()}`));
  await page.goto(`${base}/?map=junkyard&quality=${q}&char=simple${extra}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__starwishJunkyard?.ready?.() === true, null, { timeout: 180000 });
  await page.waitForFunction(() => window.__starwishJunkyard.landmarks().report !== null, null, { timeout: 120000 });
  await page.waitForTimeout(1200);
  return { ctx, page, errors, glbReq, bad };
}

async function shots(page, prefix) {
  for (const v of VIEWS) {
    const o = await page.evaluate((v) => {
      const api = window.__starwishJunkyard;
      const g = (x, z) => (v.abs ? 0 : api.ground(x, z));
      return { from: [v.from[0], v.from[1] + g(v.from[0], v.from[2]), v.from[2]], to: [v.to[0], v.to[1] + g(v.to[0], v.to[2]), v.to[2]] };
    }, v);
    // 角色移到鏡頭附近（分區載入、距離漸變以鏡頭為準）
    await page.evaluate((o) => window.__starwishJunkyard.teleport(o.from[0], o.from[2], 0), o);
    await page.evaluate((o) => window.__starwishJunkyard.shotLook(o), o);
    await page.waitForTimeout(1200);
    await settle(page, 6);
    await page.screenshot({ path: `${outDir}${prefix}_${v.id}.png` });
  }
  await page.evaluate(() => window.__starwishJunkyard.shotRelease());
}

// ---------- 1＋3：正式狀態（沒有 GLB）：參考截圖、俯視位置圖 ----------
{
  const { ctx, page, errors, glbReq, bad } = await open(real.url, "high");
  const lm = await page.evaluate(() => window.__starwishJunkyard.landmarks());
  check("沒有 GLB 時：不發出地標 GLB 請求、維持程序化地標", glbReq.length === 0 && lm.report.loaded.length === 0 && lm.procHidden.every(([, on, all]) => on === all), { glbReq, loaded: lm.report.loaded.length });
  await shots(page, "ref");
  await page.setViewportSize({ width: 1100, height: 1100 });
  await page.evaluate(() => window.__starwishJunkyard.setTopView(true));
  await page.waitForTimeout(1500);
  await settle(page, 6);
  await page.screenshot({ path: `${outDir}ref_topdown.png` });
  await page.evaluate(() => window.__starwishJunkyard.setTopView(false));
  report.layout = await page.evaluate(() => window.__starwishJunkyard.layout());
  check("正式狀態：沒有錯誤、沒有 4xx", errors.length === 0 && bad.length === 0, { errors: errors.slice(0, 3), bad });
  await ctx.close();
}

// ---------- 光影對照：V2 光影（&jylight=v2&jyao=0&jyhalo=0） vs V3（新光影＋地面接觸陰影＋光暈） ----------
{
  const STOPS = ["entry", "central", "recycle", "factory", "platform", "core"];
  const res = {};
  for (const [tag, extra] of [["v2look", "&jylight=v2&jyao=0&jyhalo=0"], ["v3look", ""]]) {
    const { ctx, page, errors } = await open(real.url, "high", extra);
    const L = await page.evaluate(() => window.__starwishJunkyard.layout());
    res[tag] = [];
    for (const id of STOPS) {
      const st = L.tourStops.find((t) => t.id === id);
      await page.evaluate((p) => window.__starwishJunkyard.teleport(p.x, p.z, p.yaw), st);
      await page.waitForTimeout(1200);
      await settle(page, 6);
      const pf = await page.evaluate(() => window.__starwishJunkyard.perf());
      res[tag].push({ id, draws: pf.draws, tris: pf.tris });
      await page.screenshot({ path: `${outDir}${tag}_${id}.png` });
    }
    res[tag + "_halos"] = (await page.evaluate(() => window.__starwishJunkyard.stats())).halos;
    check(`光影 ${tag}：沒有錯誤`, errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }
  report.lookCompare = res;
  const dd = res.v3look.map((x, i) => x.draws - res.v2look[i].draws);
  check("V3 光暈只多 1 次繪製（每個停靠點 Draw Calls 增加 ≤ 1）", dd.every((d) => d <= 1) && res.v3look_halos > 40, { dd, halos: res.v3look_halos });
}

// ---------- 2：測試替身 GLB ----------
const EXPECT = {
  colossus: { h: 13.5, sink: 1.5 },
  furnace1: { h: 10, sink: 0.2, y: 17.5 },
  furnace2: { h: 7.5, sink: 0.15, y: 14 },
  reactor: { h: 26, sink: 0.2, y: 20 },
  "crane1:tower": { h: 23, sink: 0 },
  "crane2:tower": { h: 23 * (18 / 22), sink: 0 },
  "crane3:tower": { h: 23 * (16 / 22), sink: 0 },
};
for (const q of ["high", "medium"]) {
  const run = { quality: q };
  const { ctx, page, errors, glbReq, bad } = await open(test.url, q);
  const lm = await page.evaluate(() => window.__starwishJunkyard.landmarks());
  run.report = lm.report;
  const loaded = Object.fromEntries(lm.report.loaded.map((l) => [`${l.slot}:${l.part}`, l]));
  const want = { "colossus:main": 1, "furnace:main": 2, "crane:tower": 3, "crane:jib": 3, "crane:claw": 3, "reactor:shell": 1 };
  check(`${q}：6 種零件全部載入、擺放數正確`, Object.entries(want).every(([k, n]) => loaded[k]?.placements === n) && lm.report.failed.length === 0, Object.fromEntries(Object.entries(loaded).map(([k, v]) => [k, v.placements])));
  check(`${q}：載入對應畫質的檔案${q === "high" ? "（高畫質另載 Lite 做遠距離切換）" : ""}`, lm.report.loaded.every((l) => l.file.endsWith(q === "high" ? "_hq.glb" : "_lite.glb") && l.lod === (q === "high")), lm.report.loaded.map((l) => [l.file, l.lod]));
  check(`${q}：被取代的程序化地標已隱藏`, lm.procHidden.every(([, on]) => on === 0) && lm.report.hidden > 0, lm.procHidden);
  // 尺寸、落地
  const sizeOk = [];
  for (const [k, e] of Object.entries(EXPECT)) {
    const b = lm.boxes[k];
    if (!b) {
      sizeOk.push([k, "missing"]);
      continue;
    }
    const h = b.max[1] - b.min[1];
    const cx = (b.min[0] + b.max[0]) / 2;
    const cz = (b.min[2] + b.max[2]) / 2;
    const g = e.y ?? (await page.evaluate(([x, z]) => window.__starwishJunkyard.ground(x, z), [cx, cz]));
    const bottomErr = Math.abs(b.min[1] - (g - e.sink));
    sizeOk.push([k, +h.toFixed(2), +bottomErr.toFixed(2), Math.abs(h - e.h) / e.h < 0.03 && bottomErr < (k === "colossus" ? 1.6 : 0.35)]);
  }
  run.sizes = sizeOk;
  check(`${q}：地標縮放到規格高度、底部落地（含埋入深度）`, sizeOk.every((s) => s[3] === true), sizeOk);
  // 吊臂會轉、抓斗跟著吊臂
  const j0 = (await page.evaluate(() => window.__starwishJunkyard.landmarks().boxes["crane1:jib"]));
  await page.waitForTimeout(2500);
  const j1 = (await page.evaluate(() => window.__starwishJunkyard.landmarks().boxes["crane1:jib"]));
  const moved = Math.hypot((j1.min[0] + j1.max[0]) / 2 - (j0.min[0] + j0.max[0]) / 2, (j1.min[2] + j1.max[2]) / 2 - (j0.min[2] + j0.max[2]) / 2);
  check(`${q}：吊臂 GLB 掛在旋轉節點上（2.5 秒內移動）`, moved > 0.05, { moved });
  const jibTop = j1.min[1];
  const towerTop = lm.boxes["crane1:tower"].max[1];
  check(`${q}：吊臂旋轉軸在塔頂（高度誤差 < 0.6 m）`, Math.abs(jibTop - towerTop) < 0.6, { jibBottom: jibTop, towerTop });
  if (q === "high") await shots(page, "standin");
  const pf = await page.evaluate(() => window.__starwishJunkyard.perf());
  run.perf = pf;
  check(`${q}：替身版沒有錯誤、沒有 4xx、沒有 Context Lost`, errors.length === 0 && bad.length === 0 && pf.contextLost === 0, { errors: errors.slice(0, 3), bad, glbReq: glbReq.length });
  report.runs.push(run);
  await ctx.close();
}

report.finishedAt = new Date().toISOString();
writeFileSync(`${outDir}report.json`, JSON.stringify(report, null, 2));
await browser.close();
real.close();
test.close();
process.exit(failures ? 1 : 0);
