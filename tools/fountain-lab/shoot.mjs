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
const mageReport = process.argv[6] ?? "out/mage_report.json";
const swordReport = process.argv[7] ?? "out/sword_report.json";
const platformReport = process.argv[8] ?? "out/platform_report.json";
const boardReport = process.argv[9] ?? "out/board_report.json";
const smithReport = process.argv[10] ?? "out/smith_report.json";
const warehouseReport = process.argv[11] ?? "out/warehouse_report.json";
const portalsReport = process.argv[12] ?? "out/portals_report.json";
const churchReport = process.argv[13] ?? "out/church_report.json";
const circusReport = process.argv[14] ?? "out/circus_report.json";
const envReport = process.argv[15] ?? "out/env_report.json";
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
  // ---------- 批次二：佈告欄、鐵匠鋪、倉庫、四座傳送門＋南門＋道路嵌飾 ----------
  {
    const inBox = (bb, w, d, top) => bb.x[0] >= -w / 2 - 0.01 && bb.x[1] <= w / 2 + 0.01 && bb.y[0] >= -0.01 && bb.y[1] <= d + 0.01 && bb.h[0] >= -0.01 && bb.h[1] <= top + 0.01;
    // 佈告欄：碰撞箱以佈告欄中心為原點（±w/2 × ±d/2 × 0～3.5）
    const br = JSON.parse(readFileSync(boardReport, "utf8"));
    const bx = L.BOX_COLLIDERS.find((c) => c.kind === "board");
    ck("佈告欄位置、尺寸＝V1.3（方位 158°、r 19.5、4 × 0.8 m）", br.layout.bearing === 158 && br.layout.r === 19.5 && br.layout.w === L.BOARD.w && br.layout.d === L.BOARD.d, br.layout);
    for (const [lod, v] of Object.entries(br.lods)) {
      const bb = v.bounds_local;
      const ok = bb.x[0] >= -bx.hw - 0.01 && bb.x[1] <= bx.hw + 0.01 && bb.y[0] >= -bx.hd - 0.01 && bb.y[1] <= bx.hd + 0.01 && bb.h[1] <= bx.y1 + 0.01 && v.within_budget;
      ck(`佈告欄 ${lod} 完全在原碰撞箱內、面數在額度內`, ok, { bounds: bb, collider: bx, triangles: v.triangles, budget: br.budget[lod] });
    }
    const bn = L.NPC_SPOTS.find((n) => n.id === "board");
    const fn = br.layout.front_normal;
    ck("佈告欄告示面朝廣場（正面法線指向噴泉）、委託 NPC 站在正面側", fn[0] * -L.BOARD.x + fn[1] * -L.BOARD.z > 0 && (bn.x - L.BOARD.x) * fn[0] + (bn.z - L.BOARD.z) * fn[1] > 0, { front_normal: fn, npc: bn });
    // 鐵匠鋪與倉庫
    for (const [id, name, file] of [["smith", "鐵匠鋪", smithReport], ["warehouse", "倉庫", warehouseReport], ["church", "祭司教堂", churchReport], ["circus", "小丑馬戲團", circusReport]]) {
      const r = JSON.parse(readFileSync(file, "utf8"));
      const b = L.BUILDINGS.find((x) => x.id === id);
      const box = L.BOX_COLLIDERS.find((c) => c.kind === `building:${id}`);
      const lay = r.layout;
      ck(`${name}尺寸、方位與 V1.3 相同`, b.bearing === lay.bearing && b.front === lay.front && b.w === lay.w && b.d === lay.d && b.top === lay.top && b.floor === lay.floor, { v13: b, model: lay });
      for (const [lod, v] of Object.entries(r.lods)) {
        const ok = (id === "smith" ? v.outside_colliders === 0 : inBox(v.bounds_local, b.w, b.d, b.top)) && v.outside_colliders === 0 && v.within_budget;
        ck(`${name} ${lod} 全部頂點在原碰撞箱內${id === "smith" ? "（建築箱或鍛造台箱）" : ""}、面數在額度內`, ok, { bounds: v.bounds_local, outside: v.outside_colliders, triangles: v.triangles, budget: r.budget[lod] });
      }
      const dDoor = Math.hypot(lay.door[0], lay.door[1]);
      const dCenter = Math.hypot(box.x, box.z);
      ck(`${name}正門面向噴泉（門比建築中心更靠近噴泉）`, dDoor < dCenter, { door: lay.door, doorR: dDoor.toFixed(2), centerR: dCenter.toFixed(2) });
    }
    {
      const r = JSON.parse(readFileSync(smithReport, "utf8"));
      const f = r.layout.forge;
      ck("戶外鍛造台位置＝V1.3（FORGE）", Math.hypot(f.x - L.FORGE.x, f.z - L.FORGE.z) < 0.01 && f.w === L.FORGE.w && f.d === L.FORGE.d, { model: f, v13: L.FORGE });
      const smiths = L.NPC_SPOTS.filter((n) => n.id === "smith");
      const npc = smiths[0];
      const fb = L.BOX_COLLIDERS.find((c) => c.kind === "forge");
      const sb = L.BOX_COLLIDERS.find((c) => c.kind === "building:smith");
      ck("只有一位鐵匠 NPC（鐵匠轉職＋裝備詞條鑑定），站位不變、不在建築或鍛造台碰撞箱內", smiths.length === 1 && Math.abs(npc.x - (21 * Math.sin((240 * Math.PI) / 180) + 1.8 * Math.cos((240 * Math.PI) / 180))) < 0.01 && !L.insideBox(sb, npc.x, npc.z) && !L.insideBox(fb, npc.x, npc.z), { npc, role: npc?.role });
    }
    // 第三批：祭司、小丑 NPC 站位不變（正門前 2.5 m、碰撞箱外）
    for (const [id, name] of [["church", "祭司"], ["circus", "小丑"]]) {
      const b = L.BUILDINGS.find((x) => x.id === id);
      const npc = L.NPC_SPOTS.find((n) => n.id === id);
      const box = L.BOX_COLLIDERS.find((c) => c.kind === `building:${id}`);
      ck(`${name}轉職 NPC 站位不變（正門前 2.5 m、在碰撞箱外）`, Math.abs(Math.hypot(npc.x, npc.z) - (b.front - 2.5)) < 0.01 && !L.insideBox(box, npc.x, npc.z), { npc });
    }
    // 環境美術：可走範圍內沒有高於 0.12 m 的頂點、面數在額度內
    {
      const er = JSON.parse(readFileSync(envReport, "utf8"));
      for (const [lod, v] of Object.entries(er.lods)) ck(`環境美術 ${lod}：可走範圍（r ≤ 50.55）內沒有高於 0.12 m 的物件（不擋路、不需碰撞）、面數在額度內`, v.verts_inside_walk_above_0_12 === 0 && v.within_budget, { inside: v.verts_inside_walk_above_0_12, triangles: v.triangles, budget: er.budget[lod] });
    }
    // 移動規則：只走路／跑步、沒有跳躍。出生點到所有 NPC、傳送門、復活點都能用一般移動抵達（高度差 ≤ MAX_STEP），
    // 可走範圍內的美術台階（傳送門圓台）高度 ≤ MAX_STEP
    {
      const sp = L.VILLAGE_SPOTS.find((x) => x.id === "spawn");
      const targets = [...L.NPC_SPOTS.map((n) => ({ id: `npc:${n.id}`, x: n.x, z: n.z })), ...L.PORTALS.map((p) => ({ id: `portal:${p.id}`, x: p.x, z: p.z })), ...L.SPAWN_SLOTS.map((p, i) => ({ id: `slot${i}`, x: p.x, z: p.z })), { id: "arrival", x: L.ARRIVAL_SPOT.x, z: L.ARRIVAL_SPOT.z }];
      const bad = targets.filter((t) => !L.reachable(sp.x, sp.z, t.x, t.z)).map((t) => t.id);
      ck(`移動規則：出生點不跳躍即可走到 ${targets.length} 個目標（全部 NPC、4 座傳送門、24 復活點、抵達點）`, bad.length === 0, { targets: targets.length, unreachable: bad });
      const pr2 = JSON.parse(readFileSync(portalsReport, "utf8"));
      const steps = Object.values(pr2.lods).flatMap((v) => Object.values(v.dais_top));
      ck(`移動規則：傳送門圓台台階 ≤ MAX_STEP（${L.MAX_STEP} m），不需要跳躍`, steps.every((h) => h <= L.MAX_STEP), { dais: steps, maxStep: L.MAX_STEP });
    }
    // 傳送門
    const pr = JSON.parse(readFileSync(portalsReport, "utf8"));
    for (const [lod, v] of Object.entries(pr.lods)) {
      const ps = v.portals;
      const same = ps.length === L.PORTALS.length && L.PORTALS.every((p) => {
        const m = ps.find((q) => q.id === p.id);
        const pil = L.portalPillars(p);
        return !!m && m.bearing === p.bearing && Math.hypot(m.x - p.x, m.z - p.z) < 0.01 && m.floor === p.floor && m.open === p.open && (m.destination ?? null) === (p.destination?.map ?? null) && pil.every((s) => m.pillars.some((q) => Math.hypot(q[0] - s.x, q[1] - s.z) < 0.01));
      });
      ck(`傳送門 ${lod}：數量 4、位置、樓層、開放狀態、目的地與石柱位置＝V1.3（只有南門開放、不新增出口）`, same && L.PORTALS.filter((p) => p.open).length === 1, { model: ps.map((p) => [p.id, p.open, p.destination]) });
      ck(`傳送門 ${lod}：石柱 2.2 m 以下半徑 ≤ 0.45（碰撞圓）、南門柱 ≤ 0.6、圓台頂面 ≤ 0.12 m 且台面上無擋路物、面數在額度內`, v.pillar_max_r_below_2_2 <= 0.45 && v.gate_post_max_r_below_2_2 <= 0.6 && Object.values(v.dais_top).every((h) => h <= 0.12) && v.dais_blockers === 0 && v.within_budget, { pillar: v.pillar_max_r_below_2_2, post: v.gate_post_max_r_below_2_2, dais: v.dais_top, blockers: v.dais_blockers, triangles: v.triangles, budget: pr.budget[lod] });
      ck(`道路嵌飾 ${lod} 貼平（金色嵌飾最低 ≥ 0.026 m 路面）`, v.gold_min_h === null || v.gold_min_h >= 0.025, { gold_min_h: v.gold_min_h });
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
  ["chromium", "hq", "high", "hq", ["village_top_full", "village_full", "village_full_ne", "church_front", "church_q45", "church_q45r", "church_back", "church_top", "church_npc", "church_eye", "circus_front", "circus_q45", "circus_q45r", "circus_back", "circus_top", "circus_npc", "env_edge", "env_east", "player_spawn_cam", "village_top", "south_plan", "south_wide", "board_front", "board_q45", "smith_front", "smith_q45", "smith_q45r", "smith_back", "smith_top", "smith_forge", "smith_counter", "smith_npc", "warehouse_front", "warehouse_q45", "warehouse_q45r", "warehouse_back", "warehouse_top", "portal_south", "portal_south_out", "portal_north", "portal_east", "portal_west", "portal_top", "gate_south", "player_arrival", "road_east", "north_plan", "north_wide", "north_trio", "mage_front", "mage_side", "mage_q45", "mage_q45r", "mage_top", "mage_npc", "mage_stairs", "mage_eye", "sword_front", "sword_side", "sword_q45", "sword_q45r", "sword_top", "sword_player_up", "sword_stairs", "sword_npc", "sword_eye", "platform_front", "platform_stair", "platform_wall"], { anim: [["portal_south", "portal_south", 3, 10]] }],
  ["chromium", "lite-low", "low", "lite", ["village_top_full", "village_full", "church_front", "church_q45", "circus_front", "circus_q45", "env_edge", "player_spawn_cam", "village_top", "south_wide", "board_front", "smith_front", "smith_q45", "smith_forge", "warehouse_front", "warehouse_q45", "portal_south", "portal_east", "gate_south", "player_arrival", "north_wide", "mage_front", "mage_q45", "mage_top", "sword_front", "sword_q45", "sword_top", "platform_front", "platform_stair", "platform_wall"]],
  // iPhone 直向（390×844，DPR 2）
  ["chromium", "hq-portrait", "high", "hq", ["church_npc", "circus_npc", "player_arrival", "smith_npc", "board_front", "player_spawn_cam", "mage_npc", "sword_npc", "platform_stair"], { viewport: { width: 390, height: 844, deviceScaleFactor: 2 } }],
  ["chromium", "lite-portrait", "low", "lite", ["player_arrival", "smith_npc", "player_spawn_cam", "sword_npc"], { viewport: { width: 390, height: 844, deviceScaleFactor: 2 } }],
  ["webkit", "hq", "high", "hq", ["village_full", "church_q45", "circus_q45", "south_wide", "portal_south", "north_wide", "sword_q45", "mage_q45"]],
  ["webkit", "lite-low", "low", "lite", ["north_wide"]],
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
    const PARTS = ["fountain", "plaza", "knight", "mage", "sword", "platform", "board", "smith", "warehouse", "portals", "church", "circus", "env"];
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
      run.flicker = {
        player_spawn_cam: await page.evaluate(() => window.__lab.flickerTest("player_spawn_cam")),
        north_wide: await page.evaluate(() => window.__lab.flickerTest("north_wide")),
        platform_front: await page.evaluate(() => window.__lab.flickerTest("platform_front")),
        sword_q45: await page.evaluate(() => window.__lab.flickerTest("sword_q45")),
        south_wide: await page.evaluate(() => window.__lab.flickerTest("south_wide")),
        portal_south: await page.evaluate(() => window.__lab.flickerTest("portal_south")),
        village_full: await page.evaluate(() => window.__lab.flickerTest("village_full")),
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
