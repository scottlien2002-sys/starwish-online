// 星廢垃圾場 V3：大型地標（CI 軟體繪圖，不是 iPhone 實機）
// 1. 碰撞範圍顯示（&jycol=1）截圖＋俯視圖
// 2. 正式地標 GLB（Tripo → gltf-transform 最佳化）：三段畫質載入、尺寸與落地、吊車動畫、特效、無錯誤
// 3. &jylm=0：不載入 GLB 時維持程序化地標（對照用）
// 用法：node tests/e2e/run-junkyard-landmarks-e2e.mjs dist [chromium] [輸出資料夾]
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";

const distDir = process.argv[2] ?? "dist";
const browserName = process.argv[3] ?? "chromium";
const outDir = process.argv[4] ?? new URL("../../test-results/junkyard-landmarks/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const pw = await loadPlaywright();

const real = await serve(distDir);
const browser = await pw[browserName].launch();
const report = { startedAt: new Date().toISOString(), note: "CI 軟體繪圖，不是 iPhone 實機 FPS；地標為正式 Tripo GLB 最佳化版", runs: [], checks: [] };
let failures = 0;
const check = (name, ok, detail) => {
  report.checks.push({ name, ok: !!ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "✔" : "✘"} ${name}`, JSON.stringify(detail)?.slice(0, 300));
};
const settle = (page, n = 4) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

// 參考視角：鏡頭位置與注視點（相對地面高度），整個地標入鏡
const VIEWS = [
  { id: "colossus", label: "廢棄機械巨像", from: [74, 7, -36], to: [104, 8, -50] },
  { id: "furnace1", label: "廢鐵熔爐（工廠高台）", from: [-62.5, 6, 72.4], to: [-62.5, 4, 92.4] },
  { id: "furnace2", label: "廢鐵熔爐（工廠地面）", from: [-50, 21, 42], to: [-70, 17, 58], abs: true },
  { id: "crane1", label: "廢料回收吊車（回收區）", from: [-42, 8, -47], to: [-72, 9, -47] },
  { id: "crane3", label: "廢料回收吊車（中央窪地）", from: [34, 9, -30], to: [6, 9, -60] },
  { id: "reactor", label: "魔導核心反應爐", from: [22, 8, 103.5], to: [22, 6, 133.5] },
]

async function open(base, q, extra = "") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { window.__swNoNav = true; });
  const page = await ctx.newPage();
  const errors = [];
  const glbReq = [];
  const bad = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !(m.text().includes("404") && m.location()?.url?.endsWith("favicon.ico")) && errors.push(`console: ${m.text()}`));
  page.on("request", (r) => /jy_lm_.*\.glb/.test(r.url()) && glbReq.push(r.url().split("/").pop()));
  page.on("response", (r) => r.status() >= 400 && !r.url().endsWith("favicon.ico") && bad.push(`${r.status()} ${r.url()}`));
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

// ---------- 1：碰撞範圍（&jycol=1）截圖、俯視位置圖 ----------
{
  const { ctx, page, errors, bad } = await open(real.url, "high", "&jycol=1");
  await shots(page, "col");
  await page.setViewportSize({ width: 1100, height: 1100 });
  await page.evaluate(() => window.__starwishJunkyard.setTopView(true));
  await page.waitForTimeout(1500);
  await settle(page, 6);
  await page.screenshot({ path: `${outDir}col_topdown.png` });
  await page.evaluate(() => window.__starwishJunkyard.setTopView(false));
  report.layout = await page.evaluate(() => window.__starwishJunkyard.layout());
  check("碰撞顯示：沒有錯誤、沒有 4xx", errors.length === 0 && bad.length === 0, { errors: errors.slice(0, 3), bad });
  await ctx.close();
}

// ---------- 光影對照：V2 光影（&jylight=v2&jyao=0&jyhalo=0） vs V3（新光影＋地面接觸陰影＋光暈） ----------
{
  const STOPS = ["entry", "central", "recycle", "factory", "platform", "core"];
  const res = {};
  // 光暈繪製次數比較只看光影設定：兩邊都關閉地標 GLB（地標粒子依時間啟停，例如熔爐間歇蒸氣，會讓 Draw Calls 隨機差 1）
  for (const [tag, extra] of [["v2look", "&jylight=v2&jyao=0&jyhalo=0&jylm=0"], ["v3look", "&jylm=0"]]) {
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

// ---------- 2：正式地標 GLB（四大地標、六件模型） ----------
// 底部高度：以擺放高度（y：平台面／巨像坐落的土堆腳）為準
const BASE = { colossus: { y: 2.9, tol: 0.6 }, furnace1: { y: 17.5, tol: 0.4 }, furnace2: { y: 14, tol: 0.4 }, reactor: { y: 20, tol: 0.5 } };
for (const q of ["high", "medium", "low"]) {
  const run = { quality: q };
  const { ctx, page, errors, glbReq, bad } = await open(real.url, q);
  const lm = await page.evaluate(() => window.__starwishJunkyard.landmarks());
  run.report = lm.report;
  const models = new Set(lm.report.loaded.map((l) => l.model));
  check(`${q}：六件模型全部載入、沒有失敗`, ["colossus", "furnace", "tower", "boom", "grab", "reactor"].every((m) => models.has(m)) && lm.report.failed.length === 0, lm.report.loaded.map((l) => [l.model, l.file, l.tris, l.lod]));
  const wantSuffix = q === "high" ? "_hq.glb" : "_lite.glb";
  check(`${q}：載入對應畫質的檔案（高畫質＝HQ，巨像與反應爐另帶 Lite 遠距離 LOD）`, lm.report.loaded.every((l) => (l.file.endsWith(wantSuffix) && l.lod === (q === "high" && (l.model === "colossus" || l.model === "reactor"))) || (q === "high" && l.file.endsWith("_lite.glb") && (l.model === "colossus" || l.model === "reactor"))), lm.report.loaded.map((l) => [l.file, l.lod]));
  check(`${q}：七個擺放（巨像 1、熔爐 2、吊車 3、反應爐 1）`, lm.report.placed.length === 7, lm.report.placed.map((p) => p.id));
  check(`${q}：被取代的程序化地標已隱藏`, lm.procHidden.every(([, on]) => on === 0) && lm.report.hidden > 0, lm.procHidden);
  const sizes = [];
  for (const [id, e] of Object.entries(BASE)) {
    const b = lm.boxes[id];
    if (!b) {
      sizes.push([id, "missing", false]);
      continue;
    }
    const cx = (b.min[0] + b.max[0]) / 2;
    const cz = (b.min[2] + b.max[2]) / 2;
    const g = e.y ?? (await page.evaluate(([x, z]) => window.__starwishJunkyard.ground(x, z), [cx, cz]));
    const pl = lm.report.placed.find((p) => p.id === id);
    const h = b.max[1] - b.min[1];
    sizes.push([id, +h.toFixed(2), +(b.min[1] - g).toFixed(2), Math.abs(b.min[1] - g) < e.tol && pl && Math.abs(h - pl.size[1]) / pl.size[1] < 0.05]);
  }
  run.sizes = sizes;
  check(`${q}：地標尺寸符合規格、底部自然落地`, sizes.every((s) => s[3] === true), sizes);
  // 吊車：吊臂繞塔頂旋轉、抓斗升降、鋼索隨長度伸縮、抓斗不穿地
  const c0 = (await page.evaluate(() => window.__starwishJunkyard.landmarks())).cranes;
  await page.waitForTimeout(3500);
  const c1 = (await page.evaluate(() => window.__starwishJunkyard.landmarks())).cranes;
  const cr = Object.keys(c1).map((id) => {
    const a = c0[id];
    const b = c1[id];
    return { id, dYaw: +Math.abs(b.swingYaw - a.swingYaw).toFixed(3), dDrop: +Math.abs(b.drop - a.drop).toFixed(2), drop: +b.drop.toFixed(2), range: [b.dropMin, +b.dropMax.toFixed(1)], clawY: +b.claw[1].toFixed(2), sway: +Math.hypot(b.claw[0] - b.hang[0], b.claw[2] - b.hang[2]).toFixed(2) };
  });
  run.cranes = cr;
  check(`${q}：三座吊車都在動（吊臂旋轉、抓斗升降），週期不同`, cr.length === 3 && cr.every((c) => c.dYaw > 0.002 && c.dDrop > 0.05) && new Set(cr.map((c) => c.drop.toFixed(1))).size === 3, cr);
  check(`${q}：抓斗在升降範圍內、跟著吊臂（擺動 < 1.5 m）`, cr.every((c) => c.drop >= c.range[0] - 0.01 && c.drop <= c.range[1] + 0.01 && c.sway < 1.5), cr);
  // 特效：熔爐附近應有粒子在跑；遠離時停止
  await page.evaluate(() => window.__starwishJunkyard.teleport(-62.5, 81.4, 0));
  // CI 軟體繪圖幀率很低，鏡頭跟隨與 0.25 秒一次的距離／畫面判定需要多幾幀；最多等 20 秒
  await page.waitForFunction(() => (window.__starwishJunkyard.landmarks().fx?.running ?? 0) > 0, null, { timeout: 20000 }).catch(() => {});
  const fxNear = (await page.evaluate(() => window.__starwishJunkyard.landmarks())).fx;
  run.fx = fxNear;
  check(`${q}：地標特效 4 組、熔爐附近粒子運作中`, fxNear && fxNear.groups === 4 && fxNear.running > 0 && fxNear.particles > 0, fxNear);
  if (q === "high") {
    await shots(page, "v3");
    await page.setViewportSize({ width: 1100, height: 1100 });
    await page.evaluate(() => window.__starwishJunkyard.setTopView(true));
    await page.waitForTimeout(1500);
    await settle(page, 6);
    await page.screenshot({ path: `${outDir}v3_topdown.png` });
    await page.evaluate(() => window.__starwishJunkyard.setTopView(false));
  }
  const pf = await page.evaluate(() => window.__starwishJunkyard.perf());
  run.perf = pf;
  check(`${q}：沒有錯誤、沒有 4xx、沒有 Context Lost`, errors.length === 0 && bad.length === 0 && pf.contextLost === 0, { errors: errors.slice(0, 3), bad, glbReq: glbReq.length });
  report.runs.push(run);
  await ctx.close();
}

// ---------- 2b：資源釋放（離開地圖、不重新載入頁面時） ----------
{
  const { ctx, page, errors } = await open(real.url, "high");
  await page.evaluate(() => window.__starwishJunkyard.teleport(-62.5, 81.4, 0));
  await page.waitForFunction(() => (window.__starwishJunkyard.landmarks().fx?.running ?? 0) > 0, null, { timeout: 20000 }).catch(() => {});
  const d = await page.evaluate(() => window.__starwishJunkyard.disposeLandmarks());
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({ fx: window.__starwishJunkyard.landmarks().fx, perf: window.__starwishJunkyard.perf() }));
  report.dispose = { ...d, fxAfter: after.fx };
  check(
    "資源釋放：地標網格、材質、貼圖、粒子全部釋放，之後繼續正常繪製",
    d.released && d.released.containers >= 6 && d.after.engineTextures <= d.before.engineTextures - 12 && d.after.particles <= d.before.particles - 8 && d.after.meshes < d.before.meshes && after.fx === null && errors.length === 0 && after.perf.contextLost === 0,
    { ...d, errors: errors.slice(0, 3) },
  );
  await ctx.close();
}

// ---------- 3：&jylm=0（不載入 GLB，對照用） ----------
{
  const { ctx, page, errors, glbReq } = await open(real.url, "high", "&jylm=0");
  const lm = await page.evaluate(() => window.__starwishJunkyard.landmarks());
  check("&jylm=0：不發出地標 GLB 請求、維持程序化地標", glbReq.length === 0 && lm.report.loaded.length === 0 && lm.procHidden.every(([, on, all]) => on === all), { glbReq, loaded: lm.report.loaded.length });
  check("&jylm=0：沒有錯誤", errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}

report.finishedAt = new Date().toISOString();
writeFileSync(`${outDir}report.json`, JSON.stringify(report, null, 2));
await browser.close();
real.close();
process.exit(failures ? 1 : 0);
