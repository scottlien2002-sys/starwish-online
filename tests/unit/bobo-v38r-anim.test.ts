import assert from "node:assert/strict";
import { test } from "node:test";
import { antennaWeight, BlinkTimer, IDLE_PERIOD, idlePose, poseAt, REST_POSE } from "../../src/monsters/star-dew-bobo-v38r/animation.ts";

test("V3.8R 待機：伸縮維持體積、幅度小、週期循環", () => {
  for (let i = 0; i < 200; i++) {
    const t = (i / 200) * IDLE_PERIOD * 2;
    const p = idlePose(t, 0.3);
    assert.ok(Math.abs(p.sy * p.sxz * p.sxz - 1) < 1e-9, "體積不變");
    assert.ok(Math.abs(p.sy - 1) <= 0.04, "伸縮 ≤ 4%（不會變扁或變形）");
    assert.ok(Math.abs(p.roll) < 0.03 && Math.abs(p.pitch) < 0.02, "晃動很輕");
    assert.ok(Math.hypot(p.swayX, p.swayZ) < 0.08, "觸角擺動很小");
  }
  const a = idlePose(0.4, 0.1);
  const b = idlePose(0.4 + IDLE_PERIOD * 2, 0.1); // 晃動是半頻 → 兩個週期後完全回到同一姿勢
  for (const k of Object.keys(a) as (keyof typeof a)[]) assert.ok(Math.abs(a[k] - b[k]) < 1e-9, k);
});

test("V3.8R 待機：同場多隻不同步；靜止 = 原始姿勢", () => {
  assert.notEqual(idlePose(1, 0).sy, idlePose(1, 0.37).sy);
  assert.deepEqual(poseAt("none", 3), REST_POSE);
});

test("V3.8R 觸角權重：圓頂與臉部不動，觸角末端最大", () => {
  assert.equal(antennaWeight(0.99), 0);
  assert.equal(antennaWeight(0.6), 0);
  assert.ok(antennaWeight(1.19) > 0.2 && antennaWeight(1.19) < antennaWeight(1.35));
  assert.equal(antennaWeight(1.4), 1);
});

test("V3.8R 眨眼：約每 2.6～4.6 秒一次、每次約 0.13 秒", () => {
  const b = new BlinkTimer(7);
  let closedFrames = 0;
  let blinks = 0;
  let prev = false;
  for (let i = 0; i < 60 * 60; i++) {
    const c = b.update(1 / 60);
    if (c) closedFrames++;
    if (c && !prev) blinks++;
    prev = c;
  }
  assert.ok(blinks >= 12 && blinks <= 24, `60 秒眨 ${blinks} 次`);
  assert.ok(closedFrames / blinks >= 6 && closedFrames / blinks <= 9, "每次約 8 格");
});

import { BoboAnimPlayer, HOP_DISTANCE, HOP_PERIOD, hopPose } from "../../src/monsters/star-dew-bobo-v38r/animation.ts";

test("V3.8R 移動：蓄力壓扁 → 起跳拉長 → 落地壓縮 → 回彈，體積不變、不穿地", () => {
  let minSy = 9, maxSy = 0, maxLift = 0;
  for (let i = 0; i <= 400; i++) {
    const p = hopPose(i / 400);
    assert.ok(Math.abs(p.sy * p.sxz * p.sxz - 1) < 1e-9);
    assert.ok(p.lift >= 0);
    minSy = Math.min(minSy, p.sy);
    maxSy = Math.max(maxSy, p.sy);
    maxLift = Math.max(maxLift, p.lift);
  }
  assert.ok(minSy > 0.8 && minSy < 0.9, `最壓扁 ${minSy}`);
  assert.ok(maxSy > 1.1 && maxSy < 1.16, `最拉長 ${maxSy}`);
  assert.ok(maxLift > 0.14 && maxLift < 0.18, `最高 ${maxLift}`);
  assert.ok(hopPose(0.12).sy < 0.9 && hopPose(0.12).lift < 1e-6, "起跳前在地上壓扁蓄力");
  assert.ok(hopPose(0.2).sy > 1.1, "起跳時拉長");
  assert.ok(hopPose(0.7).sy < 0.86 && hopPose(0.7).lift < 1e-6, "落地壓縮");
  // 一跳的頭尾都是站立姿勢 → 連續彈跳與停下時都不會跳格
  for (const u of [0, 0.9999]) {
    const p = hopPose(u);
    assert.ok(Math.abs(p.sy - 1) < 1e-3 && p.lift < 1e-3 && Math.abs(p.pitch) < 1e-3);
  }
});

test("V3.8R 移動：每跳前進固定距離；停止時先把這一跳跳完再自然接待機", () => {
  const pl = new BoboAnimPlayer("idle");
  pl.request("move");
  let dist = 0;
  const dt = 1 / 60;
  for (let i = 0; i < Math.round((HOP_PERIOD * 3) / dt); i++) dist += pl.update(dt).travel;
  assert.ok(Math.abs(dist - HOP_DISTANCE * 3) < 0.02, `3 跳前進 ${dist}`);
  // 在空中要求停止：仍是 move，直到落地回彈
  for (let i = 0; i < 15; i++) pl.update(dt);
  pl.request("idle");
  assert.equal(pl.current, "move");
  let switched = -1;
  for (let i = 0; i < 60; i++) {
    const r = pl.update(dt);
    if (pl.current === "idle" && switched < 0) switched = i;
    if (switched >= 0) assert.equal(r.travel, 0, "停下後不再前進");
    assert.ok(r.pose.lift >= 0);
  }
  assert.ok(switched > 0 && switched * dt < HOP_PERIOD, "這一跳結束時切換");
  // 淡入後就是待機姿勢
  for (let i = 0; i < 30; i++) pl.update(dt);
  const p = pl.update(dt).pose;
  assert.equal(p.lift, 0);
  assert.ok(Math.abs(p.sy - 1) < 0.04);
});
