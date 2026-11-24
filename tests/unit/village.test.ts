import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARRIVAL_SPOT,
  BOX_COLLIDERS,
  BUILDINGS,
  CIRCLE_COLLIDERS,
  FOUNTAIN,
  NPC_SPOTS,
  PLATFORM,
  PORTALS,
  RESPAWN_SLOTS,
  ROADS,
  ROAD_HALF,
  SPAWN_SLOTS,
  STAIRS,
  STAIR_FROM,
  VILLAGE_HALF,
  WALK_RADIUS,
  bearingOf,
  buildingCenter,
  groundHeight,
  insideBox,
  moveVillage,
  onPlatform,
  onStairs,
  polar,
  reachable,
  standable,
  villageCameraDistance,
} from "../../src/maps/village/layout.ts";
import { FIELD_RETURN_STONE, MAP_LINKS } from "../../src/maps/village/mapLinks.ts";

/** 建築佔地（旋轉矩形）上的取樣點 */
function footprint(b: (typeof BUILDINGS)[number], n = 12): { x: number; z: number }[] {
  const c = buildingCenter(b);
  const t = (b.bearing * Math.PI) / 180;
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const lx = (i / n - 0.5) * b.w;
      const lz = (j / n - 0.5) * b.d;
      pts.push({ x: c.x + lx * Math.cos(t) + lz * Math.sin(t), z: c.z - lx * Math.sin(t) + lz * Math.cos(t) });
    }
  }
  return pts;
}
function roadDist(p: { x: number; z: number }, bearing: number): number {
  const t = (bearing * Math.PI) / 180;
  const dx = Math.sin(t);
  const dz = Math.cos(t);
  const s = Math.max(0, Math.min(50, p.x * dx + p.z * dz));
  return Math.hypot(p.x - s * dx, p.z - s * dz);
}

test("星芽村 V1.3：120×120 m、六大職業據點＋倉庫＋星願商會、沒有刺客、鐵匠鋪只有 1 位 NPC", () => {
  assert.equal(VILLAGE_HALF * 2, 120);
  assert.deepEqual(BUILDINGS.map((b) => b.name), ["劍士軍團", "騎士軍團", "法師軍團", "教堂", "馬戲團", "倉庫", "鐵匠鋪", "星願商會"]);
  assert.equal(NPC_SPOTS.filter((n) => n.id === "guild").length, 1);
  assert.ok(!BUILDINGS.some((b) => /刺客/.test(b.name + b.role)));
  const roles = BUILDINGS.map((b) => b.role).join("、");
  for (const r of ["劍士", "騎士", "鐵匠", "法師", "祭司", "小丑"]) assert.ok(roles.includes(r), r);
  const smith = NPC_SPOTS.filter((n) => n.id === "smith");
  assert.equal(smith.length, 1);
  assert.match(smith[0]!.role, /鐵匠轉職.*鑑定/);
  assert.ok(NPC_SPOTS.some((n) => n.id === "board") && BUILDINGS.some((b) => b.id === "warehouse"));
});

test("星芽村 V1.3：四座傳送門——只有南方開放（往星芽原野營地），北東西未開放、沒有目的地", () => {
  assert.deepEqual(PORTALS.map((p) => p.id), ["south", "north", "east", "west"]);
  for (const p of PORTALS) {
    assert.ok(Math.abs(bearingOf(p.x, p.z) - p.bearing) < 1e-6 || p.bearing === 0);
    assert.ok(Math.hypot(p.x, p.z) + p.r <= WALK_RADIUS, `${p.name} 超出範圍`);
    assert.ok(Math.abs(groundHeight(p.x, p.z) - p.floor) < 1e-6, `${p.name} 高度`);
    assert.ok(standable(p.x, p.z), `${p.name} 中心不可站`);
    if (p.id === "south") {
      assert.ok(p.open);
      assert.deepEqual([p.destination?.map, p.destination?.x, p.destination?.z], ["starsprout", -56, -64]);
    } else {
      assert.equal(p.open, false);
      assert.equal(p.destination, null);
    }
  }
  // 地圖連接：南門 ↔ 原野營地；原野遺跡後方傳送門維持未開放（Lv11–20 預留），不連到村莊
  const ruins = MAP_LINKS.find((l) => l.id === "field-ruins-portal")!;
  assert.equal(ruins.open, false);
  assert.equal(ruins.to, null);
  assert.ok(!MAP_LINKS.some((l) => l.from.map === "starsprout" && l.from.x === 0 && l.from.z === 82 && l.to?.map === "village"));
});

test("星芽村 V1.3：建築不壓到主路、廣場、傳送門；彼此間距 ≥2.5 m；高台建築都在高台上", () => {
  for (const b of BUILDINGS) {
    const pts = footprint(b);
    for (const a of ROADS) {
      const m = Math.min(...pts.map((p) => roadDist(p, a)));
      assert.ok(m >= ROAD_HALF + 0.5, `${b.name} 壓到 ${a}° 主路（${m.toFixed(2)}）`);
    }
    for (const p of PORTALS) assert.ok(Math.min(...pts.map((q) => Math.hypot(q.x - p.x, q.z - p.z))) >= p.r + 3, `${b.name} 太靠近 ${p.name}`);
    assert.ok(Math.min(...pts.map((p) => Math.hypot(p.x, p.z))) > FOUNTAIN.plazaR + 2, `${b.name} 壓到廣場`);
    assert.ok(Math.max(...pts.map((p) => Math.hypot(p.x, p.z))) < WALK_RADIUS, `${b.name} 超出範圍`);
    for (const p of pts) assert.equal(onPlatform(p.x, p.z), b.floor > 0, `${b.name} 與高台範圍不一致 (${p.x.toFixed(1)},${p.z.toFixed(1)})`);
    for (const o of BUILDINGS) {
      if (o === b) continue;
      const q = footprint(o, 8);
      const m = Math.min(...pts.filter((_, i) => i % 3 === 0).flatMap((p) => q.map((r) => Math.hypot(p.x - r.x, p.z - r.z))));
      assert.ok(m >= 2.5, `${b.name}／${o.name} 間距 ${m.toFixed(2)}`);
    }
  }
  // 主路本身（除了北路走上高台、經過石階）都是平地、沒有碰撞物
  for (const a of ROADS) {
    for (let r = 19; r <= 39; r += 0.5) {
      const p = polar(a, r);
      assert.ok(standable(p.x, p.z), `${a}° 主路 r${r} 被擋`);
    }
  }
});

test("星芽村 V1.3：NPC 站位可站、前方 4 m 可站、周圍 2.5 m 沒有碰撞物、高度正確", () => {
  for (const n of NPC_SPOTS) {
    assert.ok(standable(n.x, n.z, 0.4), `${n.name} 站位被擋`);
    assert.ok(Math.abs(groundHeight(n.x, n.z) - n.floor) < 1e-6, `${n.name} 高度 ${groundHeight(n.x, n.z)}`);
    for (let d = 1; d <= 4; d++) {
      const x = n.x + Math.sin(n.yaw) * d;
      const z = n.z + Math.cos(n.yaw) * d;
      assert.ok(standable(x, z), `${n.name} 前方 ${d} m 被擋`);
    }
    for (const c of CIRCLE_COLLIDERS) assert.ok(Math.hypot(c.x - n.x, c.z - n.z) - c.r >= 2.5, `${n.name} 旁邊有 ${c.kind}`);
    for (const o of NPC_SPOTS) if (o !== n) assert.ok(Math.hypot(o.x - n.x, o.z - n.z) > 6, `${n.name}／${o.name} 太近`);
  }
});

test("星芽村 V1.3：出生／復活點 24 個（共用），全部安全、彼此 ≥4 m", () => {
  assert.equal(RESPAWN_SLOTS.length, 24);
  assert.equal(SPAWN_SLOTS, RESPAWN_SLOTS);
  const stairFoots = STAIRS.map((s) => polar(s, STAIR_FROM));
  for (const s of RESPAWN_SLOTS) {
    assert.ok(Math.hypot(s.x, s.z) > FOUNTAIN.basinR + 1, "離水池太近");
    assert.ok(standable(s.x, s.z, 1.2), `(${s.x},${s.z}) 周圍 1.2 m 不淨空`);
    assert.equal(groundHeight(s.x, s.z), 0);
    assert.ok(!onStairs(s.x, s.z));
    for (const n of NPC_SPOTS) assert.ok(Math.hypot(n.x - s.x, n.z - s.z) >= 3.5);
    for (const f of stairFoots) assert.ok(Math.hypot(f.x - s.x, f.z - s.z) >= 2.5);
    for (const o of RESPAWN_SLOTS) if (o !== s) assert.ok(Math.hypot(o.x - s.x, o.z - s.z) >= 4);
  }
});

test("星芽村 V1.3：從抵達點、出生點都走得到每位 NPC 與每座傳送門", () => {
  assert.ok(standable(ARRIVAL_SPOT.x, ARRIVAL_SPOT.z));
  const south = PORTALS[0]!;
  const d = Math.hypot(ARRIVAL_SPOT.x - south.x, ARRIVAL_SPOT.z - south.z);
  assert.ok(d > south.r && d < south.r + 2, "抵達點要在南方傳送門內側、圓台外");
  const goals = [...NPC_SPOTS.map((n) => ({ name: n.name, x: n.x, z: n.z })), ...PORTALS.map((p) => ({ name: p.name, x: p.x, z: p.z }))];
  for (const g of goals) assert.ok(reachable(ARRIVAL_SPOT.x, ARRIVAL_SPOT.z, g.x, g.z), `抵達點到不了 ${g.name}`);
  for (const s of RESPAWN_SLOTS.filter((_, i) => i % 4 === 0)) {
    for (const g of goals) assert.ok(reachable(s.x, s.z, g.x, g.z), `出生點 (${s.x},${s.z}) 到不了 ${g.name}`);
  }
});

test("星芽村 V1.3：北側高台只能從 4 座石階上下；高台邊緣與建築牆擋得住", () => {
  for (const s of STAIRS) {
    const foot = polar(s, 17.5);
    const top = polar(s, 24.5);
    const up = moveVillage(foot.x, foot.z, top.x, top.z);
    assert.ok(Math.hypot(up.x - top.x, up.z - top.z) < 0.05, `${s}° 石階上不去`);
    assert.equal(groundHeight(up.x, up.z), PLATFORM.height);
    const down = moveVillage(top.x, top.z, foot.x, foot.z);
    assert.ok(Math.hypot(down.x - foot.x, down.z - foot.z) < 0.05, `${s}° 石階下不來`);
  }
  // 石階之間的高台內緣（方位 345°）：往廣場走會被擋住，不會掉下去
  const a = polar(345, 24.5);
  const b = polar(345, 20);
  const r = moveVillage(a.x, a.z, b.x, b.z);
  assert.equal(groundHeight(r.x, r.z), PLATFORM.height);
  // 高台東、西兩端
  for (const [inB, outB] of [
    [PLATFORM.to - 2, PLATFORM.to + 6],
    [PLATFORM.from + 2, PLATFORM.from - 6],
  ] as const) {
    const p = polar(inB, 35);
    const q = polar(outB, 35);
    const m = moveVillage(p.x, p.z, q.x, q.z);
    assert.equal(groundHeight(m.x, m.z), PLATFORM.height, `高台 ${inB}° 端沒擋住`);
  }
  // 直直往每棟建築走：停在牆外
  for (const bd of BUILDINGS) {
    const from = polar(bd.bearing, bd.front - 3);
    const to = polar(bd.bearing, bd.front + bd.d / 2);
    const m = moveVillage(from.x, from.z, to.x, to.z);
    const box = BOX_COLLIDERS.find((x) => x.kind === `building:${bd.id}`)!;
    assert.ok(!insideBox(box, m.x, m.z), `${bd.name} 穿牆`);
    const t = (bd.bearing * Math.PI) / 180;
    const along = m.x * Math.sin(t) + m.z * Math.cos(t);
    assert.ok(along <= bd.front - 0.29 && along > bd.front - 0.4, `${bd.name} 停在 ${along}`);
  }
  // 可走範圍外緣：走不出去
  const out = moveVillage(0, -10, -60, -10);
  assert.ok(Math.hypot(out.x, out.z) <= WALK_RADIUS + 1e-6);
});

test("星芽村 V1.3：鏡頭避障——鏡頭在建築後方時拉近，在廣場方向不擋", () => {
  const k = BUILDINGS.find((b) => b.id === "knight")!;
  const t = (k.bearing * Math.PI) / 180;
  const p = polar(k.bearing, 25);
  const beta = 1.3;
  const out = villageCameraDistance(p.x, k.floor + 0.85, p.z, Math.sin(t) * Math.sin(beta), Math.cos(beta), Math.cos(t) * Math.sin(beta), 9);
  assert.ok(out < 2.5, `d=${out}`);
  assert.equal(villageCameraDistance(p.x, k.floor + 0.85, p.z, -Math.sin(t) * Math.sin(beta), Math.cos(beta), -Math.cos(t) * Math.sin(beta), 9), 9);
});

test("回村方案 A：原野營地星願石（獨立附加層資料）位置安全、不在原野核心資料裡", async () => {
  const { propColliders } = await import("../../src/maps/starsprout/props.ts");
  const { MAP_COLLIDERS } = await import("../../src/maps/starsprout/route.ts");
  const { StarsproutTerrain } = await import("../../src/maps/starsprout/terrain.ts");
  const terrain = new StarsproutTerrain();
  const s = FIELD_RETURN_STONE;
  assert.deepEqual([s.x, s.z], [-56, -68]);
  assert.ok(terrain.walkable(s.x, s.z));
  const gap = Math.min(...[...propColliders(), ...MAP_COLLIDERS].map((c) => Math.hypot(c.x - s.x, c.z - s.z) - c.r));
  assert.ok(gap >= 3, `離營地物件 ${gap.toFixed(2)} m`);
  // 回村抵達：村莊南側抵達點、面向北（中央廣場）
  const link = MAP_LINKS.find((l) => l.id === "field-return-stone")!;
  assert.deepEqual([link.to?.map, link.to?.x, link.to?.z, link.to?.yaw], ["village", ARRIVAL_SPOT.x, ARRIVAL_SPOT.z, 0]);
  assert.equal(link.requiresConfirm, true);
  // 原野核心碰撞資料沒有被加入星願石
  assert.ok(![...propColliders(), ...MAP_COLLIDERS].some((c) => Math.hypot(c.x - s.x, c.z - s.z) < 0.01));
});
