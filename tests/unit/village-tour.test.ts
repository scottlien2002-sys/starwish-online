import { test } from "node:test";
import assert from "node:assert/strict";
import { ARRIVAL_SPOT, NPC_SPOTS, PORTALS, WALK_SPEED, groundHeight, moveVillage } from "../../src/maps/village/layout.ts";
import { TourRunner, tourPoints } from "../../src/maps/village/tour.ts";

/** 與測試頁相同：steer → 移動（每幀 dt 上限 0.1 秒）→ record */
function simulate(fps: number, jitter: number, loops: number, resetOnReach = true, seed = 7) {
  let rnd = seed;
  const rand = (): number => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  const runner = new TourRunner(tourPoints(NPC_SPOTS, PORTALS, ARRIVAL_SPOT), loops, { resetOnReach });
  let x = ARRIVAL_SPOT.x;
  let z = ARRIVAL_SPOT.z;
  let frames = 0;
  while (runner.phase !== "done" && frames < 200000) {
    frames++;
    const raw = (1 / fps) * (1 + (rand() - 0.5) * 2 * jitter);
    const dt = Math.min(raw, 0.1);
    const dir = runner.steer(x, z);
    let blocked = false;
    if (dir) {
      const r = moveVillage(x, z, x + dir.x * WALK_SPEED * dt, z + dir.z * WALK_SPEED * dt);
      blocked = r.blocked;
      x = r.x;
      z = r.z;
    }
    runner.record(raw, x, groundHeight(x, z), z, blocked);
  }
  return runner;
}

test("巡迴路線：與 V1.3 灰盒相同（37 個點：經過 8 個 NPC 與北東西傳送門，回到南門抵達點）", () => {
  const pts = tourPoints(NPC_SPOTS, PORTALS, ARRIVAL_SPOT);
  assert.equal(pts.length, 2 + (NPC_SPOTS.length + 3) * 3 + 2);
  assert.deepEqual([pts[0]!.x, pts[0]!.z], [ARRIVAL_SPOT.x, ARRIVAL_SPOT.z]);
  assert.deepEqual([pts.at(-1)!.x, pts.at(-1)!.z], [ARRIVAL_SPOT.x, ARRIVAL_SPOT.z]);
  for (const n of NPC_SPOTS) assert.ok(pts.some((p) => p.label.startsWith(n.name.replace("（鍛造台旁）", "")) && Math.hypot(p.x - n.x, p.z - n.z) < 2), n.name);
  for (const p of PORTALS.filter((q) => q.id !== "south")) assert.ok(pts.some((q) => q.label === `${p.name}前`), p.name);
});

for (const [name, fps, jitter] of [
  ["60 FPS", 60, 0],
  ["59.3 FPS（含幀時間抖動）", 59.3, 0.25],
  ["30 FPS", 30, 0.2],
  ["15 FPS", 15, 0.2],
] as const) {
  test(`巡迴 3 圈 ${name}：真正卡住 0、腳本誤報 0、碰撞滑動 0、每圈約 72～82 秒（含星願商會）`, () => {
    const r = simulate(fps, jitter, 3);
    assert.equal(r.phase, "done");
    assert.equal(r.loopTimes.length, 3);
    assert.equal(r.stuckCount, 0, JSON.stringify(r.events));
    assert.equal(r.timeoutCount, 0, JSON.stringify(r.events));
    assert.equal(r.totalBlockedFrames, 0);
    for (const t of r.loopTimes) assert.ok(t > 70 && t < 83, `一圈 ${t} 秒`);
  });
}

test("回歸：舊版判定（抵達路線點沒有重設進度）在同一條路線會產生大量假警報；新版為 0", () => {
  const old = simulate(59.3, 0.25, 1, false);
  assert.ok(old.timeoutCount + old.stuckCount >= 5, `舊版假警報 ${old.timeoutCount + old.stuckCount}`);
  for (const e of old.events) assert.ok(typeof e.x === "number" && typeof e.z === "number" && e.leg.includes("→") && e.duration > 4);
  const now = simulate(59.3, 0.25, 1, true);
  assert.equal(now.timeoutCount + now.stuckCount, 0);
});

test("腳本誤報（仍在移動）只記錄、不跳點", () => {
  // 目標在 20 m 外；角色繞小圈慢走（一直有位移，但沒有更靠近目標）
  const runner = new TourRunner([{ x: 0, z: 0, label: "A" }, { x: 20, z: 0, label: "B" }, { x: 0, z: 0, label: "A" }], 1, { warmup: 0 });
  runner.record(0.016, 0, 0, 0, false);
  let x = 0;
  let z = 0;
  for (let i = 0; i < 600; i++) {
    runner.steer(x, z);
    // 繞圈移動（有位移、但沒有更靠近目標）
    x = Math.cos(i / 200) * 2;
    z = Math.sin(i / 200) * 2;
    runner.record(1 / 60, x, 0, z, false);
  }
  assert.equal(runner.stuckCount, 0);
  assert.equal(runner.timeoutCount, 1);
  assert.equal(runner.idx, 1, "誤報不可跳點");
  assert.equal(runner.events[0]!.kind, "timeout");
});

test("真正卡住會被分類、記錄座標並跳到下一點（巡迴不會停住）", () => {
  const runner = new TourRunner([{ x: 0, z: 0, label: "A" }, { x: 10, z: 0, label: "B" }, { x: 0, z: 0, label: "A" }], 1, { warmup: 0 });
  runner.record(0.016, 0, 0, 0, false);
  // 角色被擋在原地不動 6 秒
  for (let i = 0; i < 400; i++) {
    runner.steer(0, 0);
    runner.record(1 / 60, 0, 0, 0, true);
  }
  assert.equal(runner.stuckCount, 1);
  assert.equal(runner.events[0]!.kind, "stuck");
  assert.deepEqual([runner.events[0]!.x, runner.events[0]!.z, runner.events[0]!.to], [0, 0, "B"]);
  assert.ok(runner.events[0]!.blockedFrames > 200);
});
