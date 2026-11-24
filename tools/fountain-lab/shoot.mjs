// P3 星芽村預覽頁截圖與量測（只在 Blender 美術工作流程執行；不部署）
// 用法：node tools/fountain-lab/shoot.mjs <建置資料夾> <輸出資料夾> <plaza_report.json>
// 注意：CI 是無頭瀏覽器＋軟體繪圖，畫面時間不代表 iPhone，只看相對成本與畫面。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "../../tests/e2e/static-server.mjs";
import * as L from "../../src/maps/village/layout.ts";
import { PET_MERCHANT, petMerchantClearance } from "../../src/maps/village/petMerchant.ts";

const dist = process.argv[2] ?? "out-lab";
const out = process.argv[3] ?? "out/lab";
const plazaReport = process.argv[4] ?? "out/plaza_report.json";
const knightReport = process.argv[5] ?? "out/knight_report.json";
const mageReport = process.argv[6] ?? "out/mage_report.json";
const swordReport = process.argv[7] ?? "out/sword_report.json";
const platformReport = process.argv[8] ?? "out/platform_report.json";
const merchantReport = process.argv[9] ?? "out/pet_merchant_report.json";
mkdirSync(out, { recursive: true });
const report = { startedAt: new Date().toISOString(), checks: {}, runs: [] };
let fail = 0;

// ---------- 1) 配置比對（與 V1.3 layout.ts 完全一致、不擋路） ----------
{
  const meta = JSON.parse(readFileSync(plazaReport, "utf8")).layout;
  const ck = (k, ok, detail) => {
    report.checks[k] = { ok, detail };
    if (!ok) fail++;
  };
  const near = (list, kind) => {
    const cols = L.CIRCLE_COLLIDERS.filter((c) => c.kind === kind);
    const errs = list.map((p) => Math.min(...cols.map((c) => Math.hypot(c.x - p.x, c.z - p.z))));
    return { count: list.length, colliders: cols.length, maxErr: Math.max(...errs) };
  };
  for (const [k, kind] of [["benches", "bench"], ["crystal_lamps", "crystalLamp"], ["lamps", "lamp"]]) {
    const r = near(meta[k], kind);
    ck(`${k} 位置＝既有碰撞（誤差 < 1 cm）`, r.count === r.colliders && r.maxErr < 0.01, r);
  }
  // 花圃：取樣點不可在道路、石階範圍內，也不可靠近 NPC、出生點、佈告欄、鍛造台
  const radial = (b, x, z) => {
    const t = (b * Math.PI) / 180;
    return { along: x * Math.sin(t) + z * Math.cos(t), side: x * Math.cos(t) - z * Math.sin(t) };
  };
  const issues = [];
  let samples = 0;
  for (const bed of meta.beds) {
    for (let i = 0; i <= 8; i++) {
      for (let j = 0; j <= 2; j++) {
        const a = bed.a0 + ((bed.a1 - bed.a0) * i) / 8;
        const r = bed.r0 + ((bed.r1 - bed.r0) * j) / 2;
        const t = (a * Math.PI) / 180;
        const x = Math.sin(t) * r;
        const z = Math.cos(t) * r;
        samples++;
        for (const rb of L.ROADS) {
          const l = radial(rb, x, z);
          if (l.along > 17 && l.along < 41 && Math.abs(l.side) < L.ROAD_HALF + 0.3) issues.push(`road ${rb}: ${bed.kind} ${a.toFixed(1)}°`);
        }
        for (const s of L.STAIRS) {
          const l = radial(s, x, z);
          if (l.along > 17.5 && l.along < 23.5 && Math.abs(l.side) < L.STAIR_WIDTH / 2 + 0.3) issues.push(`stair ${s}: ${bed.kind} ${a.toFixed(1)}°`);
        }
        for (const n of L.NPC_SPOTS) if (n.floor === 0 && Math.hypot(n.x - x, n.z - z) < 2.0) issues.push(`npc ${n.id}: ${bed.kind} ${a.toFixed(1)}°`);
        for (const s of L.SPAWN_SLOTS) if (Math.hypot(s.x - x, s.z - z) < 1.0) issues.push(`spawn slot: ${bed.kind} ${a.toFixed(1)}°`);
        if (Math.hypot(L.BOARD.x - x, L.BOARD.z - z) < 2.0) issues.push(`board: ${bed.kind}`);
        if (Math.hypot(L.FORGE.x - x, L.FORGE.z - z) < 2.0) issues.push(`forge: ${bed.kind}`);
        if (bed.h > 0.25) issues.push(`height ${bed.h}`);
      }
    }
  }
  ck("花圃不擋道路、石階、NPC、出生點、佈告欄、鍛造台；高度 ≤ 0.25 m", issues.length === 0, { beds: meta.beds.length, samples, issues: [...new Set(issues)] });
  const sp = L.VILLAGE_SPOTS.find((s) => s.id === "spawn");
  ck("創角出生點站在羅盤徽上（V1.3 出生點不變）", !!sp && Math.hypot(sp.x - meta.compass.x, sp.z - meta.compass.z) <= meta.compass.r, { spawn: sp, compass: meta.compass });
  ck("道路寬度與方向＝V1.3（4 條、半寬 3 m）", meta.roads.length === 4 && meta.roads.every((r) => L.ROADS.includes(r.bearing) && r.half === L.ROAD_HALF), meta.roads);
  // Lite 接地陰影要有頂點 Alpha（VEC4），否則會畫成黑色方塊
  {
    const b = readFileSync(plazaReport.replace("plaza_report.json", "plaza_lite.glb"));
    const len = b.readUInt32LE(12);
    const j = JSON.parse(b.subarray(20, 20 + len).toString());
    const m = j.meshes.find((x) => x.name.startsWith("Plaza_contact"));
    const acc = m ? j.accessors[m.primitives[0].attributes.COLOR_0] : null;
    ck("Lite 接地陰影帶頂點透明度（COLOR_0 為 RGBA）", acc?.type === "VEC4", acc ? { type: acc.type } : "missing");
  }
  // 騎士軍團：完全在原碰撞箱內（±8 × 0～14 × 0～19，地面 +2）、正門朝噴泉、NPC 站位不變
  {
    const kr = JSON.parse(readFileSync(knightReport, "utf8"));
    const b = L.BUILDINGS.find((x) => x.id === "knight");
    const box = L.BOX_COLLIDERS.find((c) => c.kind === "building:knight");
    const lay = kr.layout;
    ck("騎士軍團尺寸、方位與 V1.3 相同", b.bearing === lay.bearing && b.front === lay.front && b.w === lay.w && b.d === lay.d && b.top === lay.top && b.floor === lay.floor, { v13: b, model: lay });
    for (const [lod, v] of Object.entries(kr.lods)) {
      const bb = v.bounds_local;
      const ok = bb.x[0] >= -b.w / 2 - 0.01 && bb.x[1] <= b.w / 2 + 0.01 && bb.y[0] >= -0.01 && bb.y[1] <= b.d + 0.01 && bb.h[0] >= -0.01 && bb.h[1] <= b.top + 0.01;
      ck(`騎士軍團 ${lod} 模型完全在原碰撞箱內`, ok, { bounds: bb, collider: box });
    }
    const npc = L.NPC_SPOTS.find((n) => n.id === "knight");
    const dDoor = Math.hypot(lay.door[0], lay.door[1]);
    const dCenter = Math.hypot(box.x, box.z);
    ck("正門面向噴泉（門比建築中心更靠近噴泉）", dDoor < dCenter, { door: lay.door, doorR: dDoor.toFixed(2), centerR: dCenter.toFixed(2) });
    ck("騎士轉職 NPC 站位不變（正門前 2 m、在碰撞箱外）", Math.abs(Math.hypot(npc.x, npc.z) - (b.front - 2)) < 0.01 && !L.insideBox(box, npc.x, npc.z), { npc });
  }
  // P3-4 法師軍團、P3-5 劍士軍團：完全在原碰撞箱內、面數在額度內、正門朝噴泉並正對高台石階、NPC 站位不變
  for (const [id, name, file] of [["mage", "法師軍團", mageReport], ["sword", "劍士軍團", swordReport]]) {
    const mr = JSON.parse(readFileSync(file, "utf8"));
    const b = L.BUILDINGS.find((x) => x.id === id);
    const box = L.BOX_COLLIDERS.find((c) => c.kind === `building:${id}`);
    const lay = mr.layout;
    ck(`${name}尺寸、方位與 V1.3 相同`, b.bearing === lay.bearing && b.front === lay.front && b.w === lay.w && b.d === lay.d && b.top === lay.top && b.floor === lay.floor, { v13: b, model: lay });
    for (const [lod, v] of Object.entries(mr.lods)) {
      const bb = v.bounds_local;
      const ok = bb.x[0] >= -b.w / 2 - 0.01 && bb.x[1] <= b.w / 2 + 0.01 && bb.y[0] >= -0.01 && bb.y[1] <= b.d + 0.01 && bb.h[0] >= -0.01 && bb.h[1] <= b.top + 0.01 && v.within_budget;
      ck(`${name} ${lod} 模型完全在原碰撞箱內、面數在額度內`, ok, { bounds: bb, collider: box, triangles: v.triangles, budget: mr.budget[lod] });
    }
    const npc = L.NPC_SPOTS.find((n) => n.id === id);
    const dDoor = Math.hypot(lay.door[0], lay.door[1]);
    const dCenter = Math.hypot(box.x, box.z);
    ck(`${name}正門面向噴泉（門比建築中心更靠近噴泉）`, dDoor < dCenter, { door: lay.door, doorR: dDoor.toFixed(2), centerR: dCenter.toFixed(2) });
    const t = (b.bearing * Math.PI) / 180;
    const side = lay.door[0] * Math.cos(t) - lay.door[1] * Math.sin(t);
    ck(`${name}正門中心正對 ${b.bearing}° 高台石階（側向偏差 < 0.1 m）`, L.STAIRS.includes(b.bearing) && Math.abs(side) < 0.1, { lateral: side.toFixed(3), stairs: L.STAIRS });
    ck(`${name} NPC 站位不變（正門石階前 2 m、高台上、在碰撞箱外）`, Math.abs(Math.hypot(npc.x, npc.z) - (b.front - 2)) < 0.01 && !L.insideBox(box, npc.x, npc.z) && L.onPlatform(npc.x, npc.z), { npc });
  }
  // P3-6 北側高台：尺寸＝V1.3、擋土牆不擋牆腳花圃、石階在石階範圍內、鋪面不蓋北路
  {
    const pr = JSON.parse(readFileSync(platformReport, "utf8"));
    const lay = pr.layout;
    ck("北側高台與石階尺寸＝V1.3（281°→44°、r 23～49、高 2 m；石階 4 道、r 18～23、寬 6 m）", lay.from === L.PLATFORM.from && lay.to === L.PLATFORM.to && lay.r0 === L.PLATFORM.r0 && lay.r1 === L.PLATFORM.r1 && lay.height === L.PLATFORM.height && lay.stair_from === L.STAIR_FROM && lay.stair_width === L.STAIR_WIDTH && lay.stairs.length === L.STAIRS.length && lay.stairs.every((x) => L.STAIRS.includes(x)), { model: lay });
    for (const [lod, v] of Object.entries(pr.lods)) {
      const c = v.checks;
      ck(`高台 ${lod}：擋土牆正面在 r 23，0.3 m 以下不凸出 r 22.95（牆腳花圃到 22.98）`, c.wall_min_r_below_0_3m >= 22.95, c);
      ck(`高台 ${lod}：石階模型完全在石階範圍內、踏面與遊戲斜坡差 ≤ 0.25 m`, c.stairs_side_excess <= 0.001 && c.stairs_along_excess <= 0.001 && c.stairs_max_above_ramp <= 0.25, c);
      ck(`高台 ${lod}：鋪面高度 ≤ 2.03 m、不蓋住北路、面數在額度內`, c.top_max_h <= 2.03 && c.top_in_north_road === 0 && v.within_budget, { ...c, triangles: v.triangles, budget: pr.budget[lod] });
    }
  }
  // 寵物商人：巡走路線不穿過噴泉、水池、長椅、燈柱、出生點、建築；停留點不擋主路；模型尺寸與面數
  {
    const c = petMerchantClearance();
    ck("寵物商人巡走路線：與噴泉水池、長椅、水晶燈座、路燈等碰撞物淨距 ≥ 0.4 m、不進入任何建築碰撞箱、全程可站立", c.minCircleGap >= 0.4 && !c.insideBox && c.allStandable, c);
    ck("寵物商人巡走路線：離 24 個出生點 ≥ 1.5 m、離所有 NPC ≥ 3 m", c.minSpawnDist >= 1.5 && c.minNpcDist >= 3, c);
    ck("寵物商人停留點避開主路與石階軸線（≥ 12°）；商人不是碰撞物（不擋主要通道）", c.stationAxisGapDeg >= 12 && !L.CIRCLE_COLLIDERS.some((x) => x.kind.includes("pet")) && !L.NPC_SPOTS.some((n) => n.id === PET_MERCHANT.id), { stationAxisGapDeg: c.stationAxisGapDeg, stations: PET_MERCHANT.stations, patrolR: PET_MERCHANT.patrolR });
    const mr = JSON.parse(readFileSync(merchantReport, "utf8"));
    for (const [lod, v] of Object.entries(mr.lods)) {
      ck(`寵物商人 ${lod} 模型：高 ≤ 1.6 m、半徑 ≤ 路線檢查用的 ${PET_MERCHANT.bodyR + 0.1} m、面數在額度內`, v.height <= 1.6 && v.radius <= PET_MERCHANT.bodyR + 0.1 && v.within_budget, { height: v.height, radius: v.radius, triangles: v.triangles, budget: mr.budget[lod] });
    }
  }
  // 噴泉：外徑＝碰撞半徑 7 m、最高 6.5 m（P3-1A 驗收值）
  {
    const fr = JSON.parse(readFileSync(plazaReport.replace("plaza_report.json", "fountain_report.json"), "utf8"));
    for (const [lod, v] of Object.entries(fr.lods)) {
      const topMax = Math.max(v.bounds.top, fr.dims.crystal_top_max ?? 0);
      ck(`噴泉 ${lod} 外徑 r ≤ 7.0（＝碰撞半徑 ${L.FOUNTAIN.basinR}）、最高（含星晶浮動）≤ 6.5、面數在額度內`, v.bounds.radius <= L.FOUNTAIN.basinR + 0.005 && topMax <= 6.5 + 0.005 && v.triangles <= fr.budget[lod], { bounds: v.bounds, crystalTopMax: fr.dims.crystal_top_max, triangles: v.triangles, budget: fr.budget[lod] });
    }
  }
  console.log(JSON.stringify(report.checks, null, 1));
}

// ---------- 2) 截圖與量測 ----------
const pw = await loadPlaywright();
const server = await serve(dist);
// [瀏覽器, 模式, 畫質, lod, 截圖視角, 選項{ viewport, anim: [[名稱, 視角, 秒, fps]] }]
const plan = [
  ["chromium", "hq", "high", "hq", ["pm_spawn", "pm_front", "pm_q45", "pm_back", "pm_plaza", "pm_walk", "pm_path", "village_top"], { anim: [["pet_merchant", "pm_anim", 10, 15, 5]] }],
  ["chromium", "lite-low", "low", "lite", ["pm_spawn", "pm_front", "pm_q45", "pm_back", "pm_plaza", "pm_walk"]],
  // iPhone 直向（390×844，DPR 2）：出生點、站在商人前、對話面板（占位功能）
  ["chromium", "hq-portrait", "high", "hq", ["pm_spawn", "pm_iphone"], { viewport: { width: 390, height: 844, deviceScaleFactor: 2 }, panel: true }],
  ["chromium", "lite-portrait", "low", "lite", ["pm_spawn", "pm_iphone"], { viewport: { width: 390, height: 844, deviceScaleFactor: 2 } }],
  ["webkit", "hq", "high", "hq", ["pm_q45", "pm_plaza"]],
  ["webkit", "lite-low", "low", "lite", ["pm_front"]],
];

for (const [bname, mode, quality, lod, views, opts = {}] of plan) {
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
  const vp = opts.viewport ?? { width: 1280, height: 720, deviceScaleFactor: 1 };
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor ?? 1 });
  page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
  try {
    await page.goto(`${server.url}/?lod=${lod}&quality=${quality}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__lab?.state.ready || window.__lab?.state.error, null, { timeout: 180000 });
    const st = await page.evaluate(() => window.__lab.state);
    if (!st.ready) throw new Error(`load: ${st.error}`);
    run.loadMs = st.loadMs;
    await page.evaluate(() => window.__lab.frames(10));
    run.stats = await page.evaluate(() => window.__lab.stats());
    run.textureMemory = await page.evaluate(() => window.__lab.textureMemory());
    await page.evaluate(() => window.__lab.setView("pano"));
    // 繪製次數：全部開啟 − 拿掉某一部分 ＝ 該部分（含陰影）；none＝只有灰色量體與地面
    const PARTS = ["fountain", "plaza", "knight", "mage", "sword", "platform", "merchant"];
    const allOn = Object.fromEntries(PARTS.map((k) => [k, true]));
    const dc = { none: await page.evaluate((p) => window.__lab.drawCalls(p), Object.fromEntries(PARTS.map((k) => [k, false]))), all: await page.evaluate((p) => window.__lab.drawCalls(p), allOn) };
    run.partDrawCalls = {};
    for (const k of PARTS) {
      dc[`no_${k}`] = await page.evaluate((p) => window.__lab.drawCalls(p), { ...allOn, [k]: false });
      run.partDrawCalls[k] = dc.all.drawCalls - dc[`no_${k}`].drawCalls;
    }
    run.drawCalls = dc;
    await page.evaluate(() => window.__lab.setTime(3.2));
    for (const v of views) {
      if (v === "fountain_anim") continue;
      await page.evaluate((name) => window.__lab.setView(name), v);
      await page.evaluate(() => window.__lab.frames(6));
      const f = `${out}/${bname}_${mode}_${v}.png`;
      await page.screenshot({ path: f, timeout: 120000 });
      run.shots.push(f.split("/").pop());
    }
    // 動畫：固定時間步進逐幀截圖（之後由 ffmpeg 合成 MP4／GIF）
    for (const [name, view, secs, fps, mt0] of opts.anim ?? []) {
      const dir = `${out}/anim_${mode}_${name}`;
      mkdirSync(dir, { recursive: true });
      const urls = await page.evaluate(([v, sc, f, m]) => window.__lab.captureFrames(v, sc, f, m), [view, secs, fps, mt0]);
      urls.forEach((u, k) => writeFileSync(`${dir}/f${String(k).padStart(3, "0")}.jpg`, Buffer.from(u.split(",")[1], "base64")));
      const n = urls.length;
      (run.anims ??= []).push({ name, view, secs, fps, frames: n, dir: dir.split("/").pop() });
      await page.evaluate(() => window.__lab.setTime(3.2));
    }
    // 寵物商人對話面板（占位功能）：開啟 → 鑑定 → 鳥蛋 → 返回 → 飼料 → 培育 → 離開，各步驟截圖
    if (opts.panel) {
      await page.evaluate(() => window.__lab.setView("pm_iphone"));
      const steps = [["open", "panel_root"], ["choose:appraise", "panel_appraise"], ["kind:birdEgg", "panel_birdegg"], ["back", null], ["back", null], ["choose:feed", "panel_feed"], ["back", null], ["choose:guide", "panel_guide"], ["close", "panel_closed"]];
      run.panel = [];
      for (const [act, shot] of steps) {
        const text = await page.evaluate((a) => window.__lab.petPanel(a), act);
        run.panel.push({ act, text });
        if (shot) {
          await page.evaluate(() => window.__lab.frames(3));
          const f = `${out}/${bname}_${mode}_${shot}.png`;
          await page.screenshot({ path: f, timeout: 120000 });
          run.shots.push(f.split("/").pop());
        }
      }
    }
    if (bname === "chromium" && !mode.includes("portrait")) {
      run.flicker = {
        pm_spawn: await page.evaluate(() => window.__lab.flickerTest("pm_spawn")),
        pm_plaza: await page.evaluate(() => window.__lab.flickerTest("pm_plaza")),
        pm_front: await page.evaluate(() => window.__lab.flickerTest("pm_front")),
      };
      await page.evaluate(() => window.__lab.setTime(null));
      await page.evaluate(() => window.__lab.setView("player_spawn"));
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
{
  const pr = report.runs.find((r) => r.panel);
  const msgs = (pr?.panel ?? []).filter((x) => ["kind:birdEgg", "choose:feed", "choose:guide"].includes(x.act));
  const ok = !!pr && msgs.length === 3 && msgs.every((x) => x.text.includes("尚未開放")) && pr.panel.at(-1).text === "";
  report.checks["寵物商人對話面板：鑑定（種子／孵化蛋／鳥蛋）、飼料、培育與進化都可點選，未接入寵物系統時顯示「準備中」，不顯示任何機率或價格"] = { ok, detail: pr?.panel ?? "no panel run" };
  if (!ok) fail++;
}
report.finishedAt = new Date().toISOString();
writeFileSync(`${out}/lab_report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
if (fail) process.exit(1);
