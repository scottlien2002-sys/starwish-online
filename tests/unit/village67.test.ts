// Stage 6.7（Claude B）：正式 NPC、委託佈告欄、南方傳送陣踩入傳送
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { PortalTrigger } from "../../src/game/portalTrigger.ts";
import { VILLAGE_SOUTH_PORTAL } from "../../src/game/worldPortals.ts";
import { ARRIVAL_SPOT, BOARD, BOX_COLLIDERS, NPC_SPOTS, PORTALS, RESPAWN_SLOTS, standable } from "../../src/maps/village/layout.ts";
import { tourPoints } from "../../src/maps/village/tour.ts";

const DIR = "public/models/village-npc67";
const stats = JSON.parse(readFileSync(`${DIR}/stats67.json`, "utf8")) as Record<string, { triangles: number; bytes: number; animations?: string[]; minY: number; bones?: number; maxInfluences?: number; height?: number; size?: number[] }>;
const qa = JSON.parse(readFileSync(`${DIR}/qa67.json`, "utf8")) as Record<string, Record<string, { maxMM: number; faceMM: number; minY: number }>>;
const NPCS = ["swordmaster", "knight", "smith", "mage", "priest", "clown", "warehouse"];

test("Stage 6.7 南方傳送陣：與 Claude A 相同規格（半徑 2.6 m、開放）、抵達點在觸發範圍外", () => {
  const south = PORTALS.find((p) => p.id === "south")!;
  assert.equal(VILLAGE_SOUTH_PORTAL.triggerR, 2.6);
  assert.ok(VILLAGE_SOUTH_PORTAL.open);
  assert.equal(VILLAGE_SOUTH_PORTAL.x, south.x);
  assert.equal(VILLAGE_SOUTH_PORTAL.z, south.z);
  assert.ok(Math.hypot(ARRIVAL_SPOT.x - south.x, ARRIVAL_SPOT.z - south.z) > VILLAGE_SOUTH_PORTAL.triggerR + 1, "抵達點離傳送陣中心要大於觸發半徑＋1");
  for (const r of RESPAWN_SLOTS) assert.ok(Math.hypot(r.x - south.x, r.z - south.z) > 10);
});

test("Stage 6.7 南方傳送陣：踩入只觸發一次；陣內載入要先走出去；未開放不觸發", () => {
  const t = new PortalTrigger(VILLAGE_SOUTH_PORTAL);
  const { x, z } = VILLAGE_SOUTH_PORTAL;
  assert.equal(t.update(x, z + 5), false);
  assert.ok(t.isArmed);
  assert.equal(t.update(x, z + 2.7), false);
  assert.equal(t.update(x, z + 2.5), true);
  assert.equal(t.update(x, z), false, "只觸發一次");
  const inside = new PortalTrigger(VILLAGE_SOUTH_PORTAL);
  assert.equal(inside.update(x, z + 1), false);
  assert.equal(inside.isArmed, false);
  assert.equal(inside.update(x, z + 3.0), false, "還在解鎖半徑內");
  assert.equal(inside.update(x, z + 3.7), false);
  assert.ok(inside.isArmed);
  assert.equal(inside.update(x, z + 2), true);
  const sealed = new PortalTrigger({ ...VILLAGE_SOUTH_PORTAL, open: false });
  assert.equal(sealed.update(x, z + 5), false);
  assert.equal(sealed.update(x, z), false);
});

test("Stage 6.7 巡迴測試路線不會踩進南方傳送陣", () => {
  const pts = tourPoints(NPC_SPOTS, PORTALS, ARRIVAL_SPOT);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    for (let k = 0; k <= 20; k++) {
      const px = a.x + ((b.x - a.x) * k) / 20;
      const pz = a.z + ((b.z - a.z) * k) / 20;
      assert.ok(Math.hypot(px - VILLAGE_SOUTH_PORTAL.x, pz - VILLAGE_SOUTH_PORTAL.z) > VILLAGE_SOUTH_PORTAL.triggerR + 0.5, `${a.label}→${b.label}`);
    }
  }
});

test("Stage 6.7 委託佈告欄：碰撞箱涵蓋 N008 模型石座（3.2 × 1.25 m）、站位可站立且在碰撞箱外", () => {
  const b = stats.board67_hq!;
  assert.ok(b.size![0]! <= BOARD.w && b.size![2]! <= BOARD.d + 0.08, JSON.stringify(b.size));
  const col = BOX_COLLIDERS.find((c) => c.kind === "board")!;
  assert.equal(col.hw * 2, BOARD.w);
  assert.equal(col.hd * 2, BOARD.d);
  const spot = NPC_SPOTS.find((n) => n.id === "board")!;
  assert.ok(standable(spot.x + Math.sin(spot.yaw) * 1.2, spot.z + Math.cos(spot.yaw) * 1.2));
  assert.ok(Math.hypot(BOARD.x, BOARD.z) - BOARD.d / 2 > 18, "不侵入環形廣場（r 18）");
});

test("Stage 6.7 NPC 資產：七位＋洛恩各有 HQ／Lite／遠距、骨架 18 根、每頂點 ≤ 4 骨、腳底貼地", () => {
  for (const k of [...NPCS.map((n) => `npc_${n}67`), "pet_merchant67"]) {
    for (const lv of ["hq", "lite", "far"]) {
      const s = stats[`${k}_${lv}`];
      assert.ok(s && existsSync(`${DIR}/${k}_${lv}.glb`), `${k}_${lv}`);
      assert.equal(s.bones, 18);
      assert.ok(s.maxInfluences! <= 4);
      assert.ok(Math.abs(s.minY) < 0.005, `${k}_${lv} minY ${s.minY}`);
      assert.ok(s.triangles <= (lv === "hq" ? 10000 : lv === "lite" ? 5100 : 2100), `${k}_${lv} ${s.triangles}`);
      const want = k === "pet_merchant67" ? ["Idle", "Talk", "Turn", "Walk"] : ["Act", "Idle", "Talk", "Turn"];
      assert.deepEqual(s.animations, want);
    }
    assert.ok(stats[`${k}_hq`]!.height! > 1.25 && stats[`${k}_hq`]!.height! < 1.5, `${k} 身高 ${stats[`${k}_hq`]!.height}`);
  }
});

test("Stage 6.7 動作品質（讀回 GLB 蒙皮檢查）：臉部完全不變形、所有動作腳底不穿地", () => {
  for (const [k, clips] of Object.entries(qa)) {
    for (const [a, v] of Object.entries(clips)) {
      assert.ok(v.faceMM < 0.01, `${k} ${a} 臉部變形 ${v.faceMM} mm`);
      assert.ok(v.minY > -0.006, `${k} ${a} 最低點 ${v.minY}`);
      assert.ok(v.maxMM < 40, `${k} ${a} 最大邊長變化 ${v.maxMM} mm`);
    }
  }
});
