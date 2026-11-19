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
