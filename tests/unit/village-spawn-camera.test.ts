// Stage 6 P3-2E：星芽村出生點初始鏡頭構圖（純幾何檢查；鏡頭 fov 0.9、垂直固定，與 ThirdPersonCamera 相同）
import assert from "node:assert/strict";
import { test } from "node:test";
import { TUNING } from "../../src/config/tuning.ts";
import { ARRIVAL_SPOT, SPAWN_SLOTS } from "../../src/maps/village/layout.ts";
import { isVillageSpawnSlot, VILLAGE_SPAWN_CAMERA, villageInitialCamera } from "../../src/maps/village/spawnCamera.ts";

const FOV = 0.9; // ThirdPersonCamera.camera.fov（垂直）
const deg = (r: number): number => (r * 180) / Math.PI;
/** 星晶最高點（含上下浮動 6 cm）與最低點；見 art/village-p3/build_fountain.py FLOAT_TOP/FLOAT_BOTTOM/BOB */
const CRYSTAL_TOP = 6.46;
const CRYSTAL_BOTTOM = 4.6;
/** iPhone 直向（390×844）與橫向 */
const ASPECTS = { portrait: 390 / 844, landscape: 844 / 390 };

/** 在「鏡頭－角色－噴泉中心」的垂直平面內：點 (d 前方距離, h 高) 相對視線中心的仰角（度） */
function angleFromAxis(slotR: number, beta: number, r: number, d: number, h: number): number {
  const th = TUNING.camera.targetHeight;
  const dc = -r * Math.sin(beta);
  const hc = th + r * Math.cos(beta);
  const axis = Math.atan2(th - hc, 0 - dc);
  void slotR;
  return deg(Math.atan2(h - hc, d - dc) - axis);
}

test("出生點初始俯角在玩家可調範圍內、距離不變（角色大小不變）", () => {
  const c = TUNING.camera;
  assert.ok(VILLAGE_SPAWN_CAMERA.beta >= c.minBeta && VILLAGE_SPAWN_CAMERA.beta <= c.maxBeta);
  assert.equal(VILLAGE_SPAWN_CAMERA.distance, c.distance);
  assert.ok(VILLAGE_SPAWN_CAMERA.beta > c.defaultBeta, "只微抬，不往下壓");
});

test("只有 24 個出生／復活點使用新構圖；南門抵達點與其他位置維持預設", () => {
  assert.equal(SPAWN_SLOTS.length, 24);
  for (const s of SPAWN_SLOTS) {
    assert.ok(isVillageSpawnSlot(s.x, s.z));
    assert.equal(villageInitialCamera(s.x, s.z).beta, VILLAGE_SPAWN_CAMERA.beta);
  }
  assert.equal(isVillageSpawnSlot(ARRIVAL_SPOT.x, ARRIVAL_SPOT.z), false);
  assert.deepEqual(villageInitialCamera(ARRIVAL_SPOT.x, ARRIVAL_SPOT.z), { beta: TUNING.camera.defaultBeta, distance: TUNING.camera.distance });
  assert.deepEqual(villageInitialCamera(30, -30), { beta: TUNING.camera.defaultBeta, distance: TUNING.camera.distance });
});

for (const slotR of [12.5, 15]) {
  test(`出生點 r ${slotR}：新構圖完整看見漂浮星晶（直向與橫向都在畫面內，留 1° 邊）`, () => {
    const { beta, distance } = VILLAGE_SPAWN_CAMERA;
    const half = deg(FOV / 2);
    const top = angleFromAxis(slotR, beta, distance, slotR, CRYSTAL_TOP);
    const bottom = angleFromAxis(slotR, beta, distance, slotR, CRYSTAL_BOTTOM);
    assert.ok(top <= half - 1, `星晶頂 ${top.toFixed(1)}° 應 ≤ ${(half - 1).toFixed(1)}°`);
    assert.ok(bottom >= -half + 1);
    // 直向畫面水平視角最窄：星晶（含星芒 ±1 m）仍在水平範圍內
    for (const [name, aspect] of Object.entries(ASPECTS)) {
      const hHalf = deg(Math.atan(Math.tan(FOV / 2) * aspect));
      const dist = slotR + distance * Math.sin(beta);
      assert.ok(deg(Math.atan(1 / dist)) < hHalf - 1, `${name} 水平視角 ±${hHalf.toFixed(1)}°`);
    }
  });

  test(`出生點 r ${slotR}：原本的預設俯角會把星晶切在畫面外（說明為什麼要調）`, () => {
    const top = angleFromAxis(slotR, TUNING.camera.defaultBeta, TUNING.camera.distance, slotR, CRYSTAL_TOP);
    assert.ok(top > deg(FOV / 2), `預設俯角時星晶頂在 ${top.toFixed(1)}°（畫面上緣 ${deg(FOV / 2).toFixed(1)}°）`);
  });

  test(`出生點 r ${slotR}：角色大小與預設相同、腳下與前方 4 m 地面都看得到`, () => {
    const half = deg(FOV / 2);
    const sizeOf = (beta: number): number => {
      const a = angleFromAxis(slotR, beta, TUNING.camera.distance, 0, 1.25);
      const b = angleFromAxis(slotR, beta, TUNING.camera.distance, 0, 0);
      return (a - b) / deg(FOV);
    };
    const now = sizeOf(VILLAGE_SPAWN_CAMERA.beta);
    const before = sizeOf(TUNING.camera.defaultBeta);
    assert.ok(now >= 0.14, `角色高度佔畫面 ${(now * 100).toFixed(1)}%`);
    assert.ok(Math.abs(now - before) / before < 0.15, `與預設相差 ${(((now - before) / before) * 100).toFixed(1)}%`);
    for (const d of [0, 4]) {
      const a = angleFromAxis(slotR, VILLAGE_SPAWN_CAMERA.beta, VILLAGE_SPAWN_CAMERA.distance, d, 0);
      assert.ok(Math.abs(a) <= half - 1, `前方 ${d} m 地面在 ${a.toFixed(1)}°`);
    }
  });
}
