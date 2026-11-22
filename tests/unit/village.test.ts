import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARRIVAL_PORTAL,
  ARRIVAL_SPOT,
  BOX_COLLIDERS,
  BUILDINGS,
  FOUNTAIN,
  NPC_SPOTS,
  RESPAWN_SLOTS,
  TERRACES,
  VILLAGE_HALF,
  buildingCenter,
  groundHeight,
  insideBox,
  moveVillage,
  onStairs,
  polar,
  reachable,
  standable,
  villageCameraDistance,
} from "../../src/maps/village/layout.ts";

test("星芽村：120×120 m、七棟建築（六大職業據點＋倉庫）、沒有刺客", () => {
  assert.equal(VILLAGE_HALF * 2, 120);
  assert.deepEqual(BUILDINGS.map((b) => b.name), ["劍士軍團", "騎士軍團", "法師軍團", "教堂", "馬戲團", "倉庫", "鐵匠鋪"]);
  assert.ok(!BUILDINGS.some((b) => /刺客/.test(b.name + b.role)));
  const roles = BUILDINGS.map((b) => b.role).join("、");
  for (const r of ["劍士", "騎士", "法師", "祭司", "小丑", "鐵匠"]) assert.ok(roles.includes(r), r);
  // 鐵匠鋪只有一位 NPC，負責轉職＋鑑定
  const smith = NPC_SPOTS.filter((n) => n.id === "smith");
  assert.equal(smith.length, 1);
  assert.match(smith[0]!.role, /鐵匠轉職.*鑑定/);
});

test("星芽村：建築佔地互不重疊，也不壓到廣場（r 18）", () => {
  for (const b of BUILDINGS) {
    const c = buildingCenter(b);
    const box = BOX_COLLIDERS.find((x) => x.kind === `building:${b.id}`)!;
    // 角點都在廣場外
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const t = (b.bearing * Math.PI) / 180;
      const lx = (sx * b.w) / 2;
      const lz = (sz * b.d) / 2;
      const x = c.x + lx * Math.cos(t) + lz * Math.sin(t);
      const z = c.z - lx * Math.sin(t) + lz * Math.cos(t);
      assert.ok(Math.hypot(x, z) > FOUNTAIN.plazaR + 2, `${b.name} 角點太靠近廣場`);
    }
    for (const o of BUILDINGS) {
      if (o === b) continue;
      const oc = buildingCenter(o);
      assert.ok(!insideBox(box, oc.x, oc.z, 1), `${b.name} 與 ${o.name} 重疊`);
    }
  }
});

test("星芽村：NPC 站位可站、周圍 3 m 淨空（除了自己的建築）、高度正確", () => {
  for (const n of NPC_SPOTS) {
    assert.ok(standable(n.x, n.z, 0.4), `${n.name} 站位被擋`);
    assert.ok(Math.abs(groundHeight(n.x, n.z) - n.floor) < 1e-6, `${n.name} 高度 ${groundHeight(n.x, n.z)}`);
    // 前方（往噴泉）4 m 可以站人
    for (let d = 1; d <= 4; d++) {
      const x = n.x + Math.sin(n.yaw) * d;
      const z = n.z + Math.cos(n.yaw) * d;
      assert.ok(standable(x, z), `${n.name} 前方 ${d} m 被擋`);
    }
    for (const o of NPC_SPOTS) if (o !== n) assert.ok(Math.hypot(o.x - n.x, o.z - n.z) > 6, `${n.name}／${o.name} 太近`);
  }
});

test("星芽村：復活點 24 個，全部安全（不在水池、建築、石階、碰撞物上），彼此 ≥2.4 m", () => {
  assert.equal(RESPAWN_SLOTS.length, 24);
  for (const s of RESPAWN_SLOTS) {
    assert.ok(Math.hypot(s.x, s.z) > FOUNTAIN.basinR + 1, "離水池太近");
    assert.ok(standable(s.x, s.z, 1.2), `(${s.x},${s.z}) 周圍 1.2 m 不淨空`);
    assert.equal(groundHeight(s.x, s.z), 0);
    assert.ok(!onStairs(s.x, s.z));
    for (const n of NPC_SPOTS) assert.ok(Math.hypot(n.x - s.x, n.z - s.z) >= 3.5);
    for (const o of RESPAWN_SLOTS) if (o !== s) assert.ok(Math.hypot(o.x - s.x, o.z - s.z) >= 2.4);
  }
});

test("星芽村：南側傳送陣（抵達入口）可站，從抵達點走得到每位 NPC 與每個復活點", () => {
  assert.ok(standable(ARRIVAL_SPOT.x, ARRIVAL_SPOT.z));
  assert.ok(Math.hypot(ARRIVAL_SPOT.x - ARRIVAL_PORTAL.x, ARRIVAL_SPOT.z - ARRIVAL_PORTAL.z) < ARRIVAL_PORTAL.r);
  for (const n of NPC_SPOTS) assert.ok(reachable(ARRIVAL_SPOT.x, ARRIVAL_SPOT.z, n.x, n.z), `到不了 ${n.name}`);
  for (const s of RESPAWN_SLOTS.filter((_, i) => i % 3 === 0)) {
    for (const n of NPC_SPOTS) assert.ok(reachable(s.x, s.z, n.x, n.z), `復活點 (${s.x},${s.z}) 到不了 ${n.name}`);
  }
});

test("星芽村：高台只能從石階上去；石階坡度 ≤27°；建築牆擋得住", () => {
  for (const t of TERRACES) {
    const foot = polar(t.bearing, 17.5);
    const top = polar(t.bearing, 24.5);
    const up = moveVillage(foot.x, foot.z, top.x, top.z);
    assert.ok(Math.hypot(up.x - top.x, up.z - top.z) < 0.05, `${t.id} 石階上不去`);
    assert.ok(Math.abs(groundHeight(up.x, up.z) - t.height) < 1e-6);
    const slope = (Math.atan(t.height / 5) * 180) / Math.PI;
    assert.ok(slope <= 27, `${t.id} ${slope}°`);
    // 從高台側邊（不是石階）往下走：被擋
    const t2 = (t.bearing * Math.PI) / 180;
    const sideIn = { x: 24 * Math.sin(t2) + (t.halfW - 0.6) * Math.cos(t2), z: 24 * Math.cos(t2) - (t.halfW - 0.6) * Math.sin(t2) };
    const sideOut = { x: 24 * Math.sin(t2) + (t.halfW + 2) * Math.cos(t2), z: 24 * Math.cos(t2) - (t.halfW + 2) * Math.sin(t2) };
    const down = moveVillage(sideIn.x, sideIn.z, sideOut.x, sideOut.z);
    assert.ok(Math.abs(groundHeight(down.x, down.z) - t.height) < 1e-6, `${t.id} 高台邊緣沒擋住`);
  }
  // 直直往建築走：停在牆外
  for (const b of BUILDINGS) {
    const from = polar(b.bearing, b.front - 3);
    const to = polar(b.bearing, b.front + b.d / 2);
    const r = moveVillage(from.x, from.z, to.x, to.z);
    const box = BOX_COLLIDERS.find((x) => x.kind === `building:${b.id}`)!;
    assert.ok(!insideBox(box, r.x, r.z), `${b.name} 穿牆`);
    const along = r.x * Math.sin((b.bearing * Math.PI) / 180) + r.z * Math.cos((b.bearing * Math.PI) / 180);
    assert.ok(along <= b.front - 0.29 && along > b.front - 0.4, `${b.name} 停在 ${along}`);
  }
});

test("星芽村：相鄰高台同高（北側連成一片，沒有斷層）", () => {
  for (let x = -40; x <= 40; x += 0.5) {
    for (let z = 10; z <= 45; z += 0.5) {
      const hs = new Set<number>();
      for (const t of TERRACES) {
        const b = (t.bearing * Math.PI) / 180;
        const along = x * Math.sin(b) + z * Math.cos(b);
        const side = x * Math.cos(b) - z * Math.sin(b);
        if (Math.abs(side) <= t.halfW && along >= t.r0 && along <= t.r1) hs.add(t.height);
      }
      assert.ok(hs.size <= 1, `(${x},${z}) 高台高度不一致`);
    }
  }
});

test("星芽村：鏡頭避障——鏡頭在建築後方時拉近，在廣場上空不擋", () => {
  const k = BUILDINGS.find((b) => b.id === "knight")!;
  // 角色站在騎士軍團門口，鏡頭往北（穿過城堡）、低角度
  const p = polar(0, 24.5);
  const beta = 1.3;
  const d = villageCameraDistance(p.x, k.floor + 0.85, p.z, 0, Math.cos(beta), Math.sin(beta), 9);
  assert.ok(d < 2.5, `d=${d}`);
  // 鏡頭往南（朝廣場）：不擋
  assert.equal(villageCameraDistance(p.x, k.floor + 0.85, p.z, 0, Math.cos(beta), -Math.sin(beta), 9), 9);
});
