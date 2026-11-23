// P3 星芽村預覽頁截圖與量測（只在 Blender 美術工作流程執行；不部署）
// 用法：node tools/fountain-lab/shoot.mjs <建置資料夾> <輸出資料夾> <plaza_report.json>
// 注意：CI 是無頭瀏覽器＋軟體繪圖，畫面時間不代表 iPhone，只看相對成本與畫面。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "../../tests/e2e/static-server.mjs";
import * as L from "../../src/maps/village/layout.ts";

const dist = process.argv[2] ?? "out-lab";
const out = process.argv[3] ?? "out/lab";
const plazaReport = process.argv[4] ?? "out/plaza_report.json";
const knightReport = process.argv[5] ?? "out/knight_report.json";
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
  ["chromium", "hq", "high", "hq", ["player_spawn", "player_spawn_cam", "fountain_front", "fountain_close", "fountain_q45", "fountain_top", "top", "fountain_anim"], { anim: [["crystal", "fountain_anim", 8, 15]] }],
  ["chromium", "lite-low", "low", "lite", ["player_spawn", "player_spawn_cam", "fountain_close", "fountain_q45", "fountain_anim"], { anim: [["crystal", "fountain_anim", 4, 15]] }],
  // iPhone 直向（390×844，DPR 2）：出生點構圖檢查＋動畫
  ["chromium", "hq-portrait", "high", "hq", ["player_spawn", "player_spawn_cam"], { viewport: { width: 390, height: 844, deviceScaleFactor: 2 }, anim: [["spawn", "player_spawn_cam", 5, 15]] }],
  ["chromium", "lite-portrait", "low", "lite", ["player_spawn", "player_spawn_cam"], { viewport: { width: 390, height: 844, deviceScaleFactor: 2 } }],
  ["webkit", "hq", "high", "hq", ["player_spawn_cam", "fountain_close"]],
  ["webkit", "lite-low", "low", "lite", ["player_spawn_cam", "fountain_close"]],
  ["webkit", "hq-portrait", "high", "hq", ["player_spawn_cam"], { viewport: { width: 390, height: 844, deviceScaleFactor: 2 } }],
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
    const dc = {};
    for (const [k, parts] of [
      ["none", { fountain: false, plaza: false, knight: false }],
      ["fountain", { fountain: true, plaza: false, knight: false }],
      ["both", { fountain: true, plaza: true, knight: false }],
      ["all", { fountain: true, plaza: true, knight: true }],
    ]) dc[k] = await page.evaluate((p) => window.__lab.drawCalls(p), parts);
    run.drawCalls = dc;
    run.plazaDrawCalls = dc.both.drawCalls - dc.fountain.drawCalls;
    run.fountainDrawCalls = dc.fountain.drawCalls - dc.none.drawCalls;
    run.knightDrawCalls = dc.all.drawCalls - dc.both.drawCalls;
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
    for (const [name, view, secs, fps] of opts.anim ?? []) {
      const dir = `${out}/anim_${mode}_${name}`;
      mkdirSync(dir, { recursive: true });
      const urls = await page.evaluate(([v, sc, f]) => window.__lab.captureFrames(v, sc, f), [view, secs, fps]);
      urls.forEach((u, k) => writeFileSync(`${dir}/f${String(k).padStart(3, "0")}.jpg`, Buffer.from(u.split(",")[1], "base64")));
      const n = urls.length;
      (run.anims ??= []).push({ name, view, secs, fps, frames: n, dir: dir.split("/").pop() });
      await page.evaluate(() => window.__lab.setTime(3.2));
    }
    if (bname === "chromium" && !mode.includes("portrait")) {
      run.flickerAnim = {
        fountain_anim: await page.evaluate(() => window.__lab.flickerTime("fountain_anim")),
        player_spawn_cam: await page.evaluate(() => window.__lab.flickerTime("player_spawn_cam")),
      };
      run.flicker = {
        player_spawn_cam: await page.evaluate(() => window.__lab.flickerTest("player_spawn_cam")),
        fountain_q45: await page.evaluate(() => window.__lab.flickerTest("fountain_q45")),
        fountain_close: await page.evaluate(() => window.__lab.flickerTest("fountain_close")),
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
report.finishedAt = new Date().toISOString();
writeFileSync(`${out}/lab_report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
if (fail) process.exit(1);
