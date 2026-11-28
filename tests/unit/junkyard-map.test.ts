import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARENA,
  DECKS,
  FIELD_NORTH_ARRIVAL,
  FIELD_NORTH_PORTAL_PROPOSAL,
  JUNKYARD_ARRIVAL,
  JUNKYARD_ENTRY_PORTAL,
  MAIN_ROUTE,
  MAX_WALK_SLOPE,
  REACTOR,
  SPAWNS,
  ZONES,
} from "../../src/maps/junkyard/layout.ts";
import { COLLIDERS, groundHeight, insideColliders, pushOut, simulateRoute, STATIC_COLLIDERS, WalkGrid } from "../../src/maps/junkyard/terrain.ts";
import { excluded, SCATTER_TIERS, scatterAll } from "../../src/maps/junkyard/scatter.ts";
import { polyDist } from "../../src/maps/junkyard/geom.ts";
import { FIELD_NORTH_PORTAL, JUNKYARD_ENTRY, JUNKYARD_LINKS } from "../../src/game/junkyardPortals.ts";
import { PortalTrigger } from "../../src/game/portalTrigger.ts";

const grid = new WalkGrid();

test("星廢垃圾場：主路線（入口 → 四大區域 → Boss）全部能以一般移動走到，不需要跳躍、不卡住", () => {
  const r = simulateRoute(grid, MAIN_ROUTE);
  assert.equal(r.stuckAt, null, `卡在 ${JSON.stringify(r.stuckAt)}`);
  assert.equal(r.reached.length, MAIN_ROUTE.length);
  // 每一步的坡度都不超過可走坡度（沒有需要跳上去的落差）
  assert.ok(r.maxSlopeDeg <= MAX_WALK_SLOPE + 0.5, `最大坡度 ${r.maxSlopeDeg.toFixed(1)}°`);
  assert.ok(r.maxStep < 0.35, `單步高度變化 ${r.maxStep.toFixed(2)} m`);
  // 高度分層：低地 → 處理區平台 → 工廠高台 → Boss 中樞
  assert.ok(r.maxY >= 19.9 && r.minY < 1, `高度範圍 ${r.minY.toFixed(1)}～${r.maxY.toFixed(1)}`);
  // 路線長度合理（5 m/s 約 2～3 分鐘走完）
  assert.ok(r.time > 100 && r.time < 200, `步行 ${r.time.toFixed(0)} 秒`);
});

test("四大區域都在主路線上，區域等級符合規格", () => {
  const lv = Object.fromEntries(ZONES.map((z) => [z.id, z.level]));
  assert.equal(lv.hills, "Lv11～14");
  assert.equal(lv.recycle, "Lv14～17");
  assert.equal(lv.factory, "Lv17～19");
  assert.equal(lv.core, "Lv20");
  for (const id of ["hills", "recycle", "factory", "core"] as const) {
    const z = ZONES.find((q) => q.id === id)!;
    const near = MAIN_ROUTE.some((p) => Math.hypot(p.x - z.x, p.z - z.z) < z.r);
    assert.ok(near, `${z.name} 沒有路線點`);
  }
});

test("怪物出生區：M008～M014 全部預留；出生區 ≥ 95% 可走；Lv11 以上全部主動攻擊；Boss 只有 1 隻", () => {
  const ids = new Set(SPAWNS.map((s) => s.monster));
  for (const m of ["M008", "M009", "M010", "M011", "M012", "M013", "M014"]) assert.ok(ids.has(m), `缺少 ${m}`);
  for (const s of SPAWNS) {
    assert.equal(s.ai, "aggressive");
    assert.ok(s.level[0] >= 11 && s.level[1] <= 20);
    assert.ok(s.leash > s.r);
    let ok = 0;
    let all = 0;
    for (let dx = -s.r; dx <= s.r; dx++) {
      for (let dz = -s.r; dz <= s.r; dz++) {
        if (dx * dx + dz * dz > s.r * s.r) continue;
        all++;
        const x = s.x + dx;
        const z = s.z + dz;
        if (grid.walkable(x, z) && !insideColliders(COLLIDERS, x, z, 0.3)) ok++;
      }
    }
    assert.ok(ok / all >= 0.95, `${s.id} ${s.name} 可走比例 ${(ok / all).toFixed(2)}`);
  }
  assert.equal(SPAWNS.filter((s) => s.boss).length, 1);
  assert.equal(SPAWNS.find((s) => s.boss)!.monster, "M014");
});

test("Boss 戰鬥廣場：完全平坦、直徑 48 m、可多人；反應爐在北緣不擋中央", () => {
  let n = 0;
  let ok = 0;
  for (let dx = -ARENA.r; dx <= ARENA.r; dx += 1) {
    for (let dz = -ARENA.r; dz <= ARENA.r; dz += 1) {
      if (dx * dx + dz * dz > ARENA.r * ARENA.r) continue;
      n++;
      const x = ARENA.x + dx;
      const z = ARENA.z + dz;
      if (!grid.walkable(x, z) || insideColliders(COLLIDERS, x, z, 0.3)) continue;
      ok++;
      assert.ok(Math.abs(grid.height(x, z) - ARENA.y) < 0.01, `(${x},${z}) 高度 ${grid.height(x, z)}`);
    }
  }
  assert.ok(ok * 1 > 1500, `可站面積 ${ok} m²`);
  assert.ok(ok / n > 0.9);
  assert.ok(Math.hypot(REACTOR.x - ARENA.x, REACTOR.z - ARENA.z) > ARENA.r - REACTOR.r);
});

test("地圖連接：入口傳送陣、抵達點都可走；抵達點在觸發半徑外；原野北端傳送門提案資料完整", () => {
  assert.ok(grid.walkable(JUNKYARD_ARRIVAL.x, JUNKYARD_ARRIVAL.z));
  assert.ok(grid.walkable(JUNKYARD_ENTRY_PORTAL.x, JUNKYARD_ENTRY_PORTAL.z));
  assert.ok(Math.hypot(JUNKYARD_ARRIVAL.x - JUNKYARD_ENTRY_PORTAL.x, JUNKYARD_ARRIVAL.z - JUNKYARD_ENTRY_PORTAL.z) > JUNKYARD_ENTRY_PORTAL.triggerR + 3);
  assert.equal(FIELD_NORTH_PORTAL_PROPOSAL.to.map, "junkyard");
  assert.equal(FIELD_NORTH_PORTAL_PROPOSAL.x, 0);
  assert.equal(FIELD_NORTH_PORTAL_PROPOSAL.z, 82);
  assert.equal(FIELD_NORTH_ARRIVAL.map, "starsprout");
  // 抵達點在原野傳送門觸發半徑外
  assert.ok(Math.hypot(FIELD_NORTH_ARRIVAL.x - FIELD_NORTH_PORTAL_PROPOSAL.x, FIELD_NORTH_ARRIVAL.z - FIELD_NORTH_PORTAL_PROPOSAL.z) > FIELD_NORTH_PORTAL_PROPOSAL.triggerR + 3);
});

test("碰撞與擺放：垃圾堆、建築都不擋主路線；高的垃圾都在垃圾堆裡；三段畫質垃圾堆位置相同", () => {
  for (let i = 0; i + 1 < MAIN_ROUTE.length; i++) {
    const a = MAIN_ROUTE[i]!;
    const b = MAIN_ROUTE[i + 1]!;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    for (let s = 0; s <= L; s += 1) {
      const x = a.x + ((b.x - a.x) * s) / L;
      const z = a.z + ((b.z - a.z) * s) / L;
      assert.ok(!insideColliders(COLLIDERS, x, z, 0.3), `路線 ${a.id}→${b.id} 被擋 (${x.toFixed(1)},${z.toFixed(1)})`);
    }
  }
  const blocked = (x: number, z: number, p: number): boolean => insideColliders(STATIC_COLLIDERS, x, z, p);
  const hi = scatterAll(groundHeight, blocked, SCATTER_TIERS.high);
  const lo = scatterAll(groundHeight, blocked, SCATTER_TIERS.low);
  assert.deepEqual(
    hi.piles.map((p) => [p.x, p.z, p.r]),
    lo.piles.map((p) => [p.x, p.z, p.r]),
  );
  for (const p of hi.piles) {
    assert.ok(polyDist(p.x, p.z, MAIN_ROUTE) > 3.4, `垃圾堆 ${p.id} 太靠近路線`);
    assert.ok(!excluded(p.x, p.z, 0, 3.4));
  }
  // 擺放可重現
  const hi2 = scatterAll(groundHeight, blocked, SCATTER_TIERS.high);
  assert.deepEqual(hi2.counts, hi.counts);
  // 畫質越低，擺放越少
  assert.ok(lo.counts.mound < hi.counts.mound && lo.counts.tufts < hi.counts.tufts);
});

test("橋、步道、階梯：兩端與地面高度相接（沒有落差），側面不可走（不會從橋邊掉下去）", () => {
  for (const d of DECKS) {
    const len0 = Math.hypot(d.b.x - d.a.x, d.b.z - d.a.z);
    const ux = (d.b.x - d.a.x) / len0;
    const uz = (d.b.z - d.a.z) / len0;
    // 平台遠端是有欄杆的平台邊緣（不接地）；只檢查接階梯的那一端
    const ends = d.kind === "platform" ? ([[d.a, -1]] as const) : ([[d.a, -1], [d.b, 1]] as const);
    for (const [end, sgn] of ends) {
      // 端點往外 1 m（玩家下橋後踩到的地面）
      const g = groundHeight(end.x + ux * sgn, end.z + uz * sgn);
      // 端點附近是地面或另一段 deck
      const joined = Math.abs(g - end.y) < 0.4 || DECKS.some((o) => o !== d && (Math.hypot(o.a.x - end.x, o.a.z - end.z) < 0.01 || Math.hypot(o.b.x - end.x, o.b.z - end.z) < 0.01));
      assert.ok(joined, `${d.id} 端點 (${end.x},${end.z}) 地面 ${g.toFixed(2)} ≠ ${end.y}`);
    }
    if (d.kind === "bridge" || d.kind === "walkway") {
      // 中段：橋面可走，橋外側 1.5 m 不可走或落差大
      const mx = (d.a.x + d.b.x) / 2;
      const mz = (d.a.z + d.b.z) / 2;
      assert.ok(grid.walkable(mx, mz));
      const len = Math.hypot(d.b.x - d.a.x, d.b.z - d.a.z);
      const nx = -(d.b.z - d.a.z) / len;
      const nz = (d.b.x - d.a.x) / len;
      const sx = mx + nx * (d.w / 2 + 1.5);
      const sz = mz + nz * (d.w / 2 + 1.5);
      assert.ok(!grid.walkable(sx, sz) || Math.abs(grid.height(sx, sz) - grid.height(mx, mz)) > 2);
    }
  }
  // 推出碰撞：站進反應爐（V3 正式模型）佔地內會被推到佔地外
  const p = pushOut(22, 133.5, 0.3);
  assert.ok(!insideColliders(COLLIDERS, p.x, p.z, 0.28), `推出後仍在碰撞內 (${p.x},${p.z})`);
  void REACTOR;
});

test("雙向傳送接口（與 Claude A worldPortals 相同格式）：踩入觸發一次；抵達點都在對方觸發半徑外；原野端預設不開放", () => {
  assert.equal(JUNKYARD_LINKS.length, 2);
  assert.equal(FIELD_NORTH_PORTAL.open, false);
  assert.equal(FIELD_NORTH_PORTAL.to.map, "junkyard");
  assert.equal(JUNKYARD_ENTRY.to.map, "starsprout");
  // 垃圾場抵達點不在垃圾場入口陣內；原野抵達點不在原野北門陣內
  assert.ok(Math.hypot(FIELD_NORTH_PORTAL.to.x - JUNKYARD_ENTRY.x, FIELD_NORTH_PORTAL.to.z - JUNKYARD_ENTRY.z) > JUNKYARD_ENTRY.triggerR + 1);
  assert.ok(Math.hypot(JUNKYARD_ENTRY.to.x - FIELD_NORTH_PORTAL.x, JUNKYARD_ENTRY.to.z - FIELD_NORTH_PORTAL.z) > FIELD_NORTH_PORTAL.triggerR + 1);
  // 從抵達點走進陣 → 觸發一次；再走出走進 → 不再觸發
  const t = new PortalTrigger(JUNKYARD_ENTRY);
  assert.equal(t.update(FIELD_NORTH_PORTAL.to.x, FIELD_NORTH_PORTAL.to.z), false);
  assert.equal(t.update(JUNKYARD_ENTRY.x, JUNKYARD_ENTRY.z + 1), true);
  assert.equal(t.update(0, -120), false);
  assert.equal(t.update(JUNKYARD_ENTRY.x, JUNKYARD_ENTRY.z), false);
});

test("V2 高台地面道具：在高台頂面、避開主路線、怪物出生區與垃圾堆", async () => {
  const { scatterAll, SCATTER_TIERS } = await import("../../src/maps/junkyard/scatter.ts");
  const { groundHeight, insideColliders, STATIC_COLLIDERS } = await import("../../src/maps/junkyard/terrain.ts");
  const { MAIN_ROUTE, SPAWNS } = await import("../../src/maps/junkyard/layout.ts");
  const { polyDist } = await import("../../src/maps/junkyard/geom.ts");
  const r = scatterAll(groundHeight, (x, z, p) => insideColliders(STATIC_COLLIDERS, x, z, p), SCATTER_TIERS.high);
  assert.ok(r.counts.props >= 100, String(r.counts.props));
  let n = 0;
  for (const m of r.junk.values()) {
    for (const t of ["pallet", "cone", "coil"] as const) {
      for (const it of m.get(t) ?? []) {
        n++;
        assert.ok(it.small, "道具要能依距離漸變");
        assert.ok(polyDist(it.x, it.z, MAIN_ROUTE) > 2.9, `${t} 在主路線上 (${it.x},${it.z})`);
        assert.ok(!SPAWNS.some((s) => Math.hypot(it.x - s.x, it.z - s.z) < s.r + 0.9), `${t} 在出生區`);
        assert.ok(!r.piles.some((p) => Math.hypot(it.x - p.x, it.z - p.z) < p.r + 1), `${t} 與垃圾堆重疊`);
      }
    }
  }
  assert.equal(n, r.counts.props);
  // 垃圾堆（碰撞）不受道具影響
  const r2 = scatterAll(groundHeight, (x, z, p) => insideColliders(STATIC_COLLIDERS, x, z, p), { ...SCATTER_TIERS.high, props: 0 });
  assert.deepEqual(r.piles.map((p) => [p.x, p.z, p.r]), r2.piles.map((p) => [p.x, p.z, p.r]));
});

test("V3 四大地標：等比縮放的最終尺寸合理、不擋主路線／出生區／Boss 廣場／傳送陣、碰撞依實際外形", async () => {
  const { PLACEMENTS, CRANE_SPECS, MODELS, landmarkSize, landmarkFile } = await import("../../src/maps/junkyard/landmarkSlots.ts");
  const { LANDMARK_COLLIDERS, insideLandmark } = await import("../../src/maps/junkyard/terrain.ts");
  const { SPAWNS, ARENA, JUNKYARD_ENTRY_PORTAL } = await import("../../src/maps/junkyard/layout.ts");
  for (const m of Object.values(MODELS)) {
    assert.ok(m.liteTris < m.hqTris && m.liteTex <= m.hqTex && m.hqTex <= 2048, m.stem);
    assert.match(landmarkFile(m, false), /^jy_lm_[a-z_]+_hq\.glb$/);
  }
  const size = Object.fromEntries(PLACEMENTS.map((p) => [p.id, landmarkSize(p)]));
  // 尺寸範圍（公尺）：大型地標壯觀但不遮蔽畫面
  assert.ok(size.colossus!.w > 22 && size.colossus!.w < 32 && size.colossus!.h < 17);
  assert.ok(size.furnace1!.h > 7.5 && size.furnace1!.h < 11);
  assert.ok(size.reactor!.h > 16 && size.reactor!.h < 27 && size.reactor!.w < 23);
  for (const c of CRANE_SPECS) assert.ok(c.towerUnit > 12 && c.boomUnit / c.towerUnit > 0.85 && c.boomUnit / c.towerUnit < 1.1);
  // 每座地標都有碰撞
  for (const id of ["colossus", "furnace1", "furnace2", "reactor", "crane1", "crane2", "crane3"]) assert.ok(LANDMARK_COLLIDERS.some((c) => c.id.startsWith(`lm-${id}-`)), id);
  // 不壓到怪物出生區、Boss 廣場中央（半徑 18 m 內）、傳送陣
  for (const s of SPAWNS) {
    if (s.id.startsWith("S14")) continue;
    for (let a = 0; a < 24; a++) {
      const x = s.x + Math.cos((a / 24) * Math.PI * 2) * s.r * 0.9;
      const z = s.z + Math.sin((a / 24) * Math.PI * 2) * s.r * 0.9;
      assert.ok(!insideLandmark(x, z, 0), `出生區 ${s.id} 被地標壓到`);
    }
  }
  for (let r = 0; r <= 18; r += 3) for (let a = 0; a < 16; a++) assert.ok(!insideLandmark(ARENA.x + Math.cos(a) * r, ARENA.z + Math.sin(a) * r, 0), "Boss 廣場被壓到");
  assert.ok(!insideLandmark(JUNKYARD_ENTRY_PORTAL.x, JUNKYARD_ENTRY_PORTAL.z, 6));
});
