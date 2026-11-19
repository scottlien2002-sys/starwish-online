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

import { ATTACK_DURATION, ATTACK_HIT_TIME, ATTACK_PHASES, attackPose, poseScale } from "../../src/monsters/star-dew-bobo-v38r/animation.ts";

test("V3.8R 攻擊：蓄力（壓扁後仰後退）→ 出招（往前拉長彈出）→ 收招（回彈回原位），體積不變", () => {
  for (let i = 0; i <= 300; i++) {
    const p = attackPose((i / 300) * ATTACK_DURATION);
    const [sx, sy, sz] = poseScale(p);
    assert.ok(Math.abs(sx * sy * sz - 1) < 1e-9, "體積不變（柔軟變形，不是縮小放大）");
    assert.ok(p.sy > 0.75 && p.sy < 1.12 && p.sfwd > 0.85 && p.sfwd < 1.26, "柔軟但不誇張");
    assert.ok(p.lift >= 0);
  }
  const w = attackPose(ATTACK_PHASES.windup[1]);
  assert.ok(w.sy < 0.82 && w.pitch < -0.1 && w.fwd < -0.05, "蓄力：最扁、後仰、往後縮");
  const h = attackPose(ATTACK_HIT_TIME);
  assert.ok(h.sfwd > 1.05 && h.fwd > 0.2 && h.pitch > 0.1, "出招：往前拉長、彈出 0.2 公尺以上、前傾");
  assert.ok(h.swayZ < 0, "出招時觸角因慣性往後");
  const r = attackPose(0.68);
  assert.ok(r.sy > 1.02 && r.swayZ > 0, "收招：回彈、觸角往前甩");
  const e = attackPose(ATTACK_DURATION);
  assert.deepEqual([e.sy, e.sfwd, e.fwd, e.pitch], [1, 1, 0, 0], "結束時回到站立原位");
});

test("V3.8R 攻擊：只播一次、播完平順接回待機；播放中重按不會重來", () => {
  const pl = new BoboAnimPlayer("idle");
  for (let i = 0; i < 30; i++) pl.update(1 / 60);
  pl.request("attack");
  assert.equal(pl.current, "attack");
  let prev = pl.update(1 / 60).pose;
  let maxJump = 0;
  let back = -1;
  for (let i = 0; i < 120; i++) {
    if (i === 20) pl.request("attack"); // 重按
    const r = pl.update(1 / 60);
    maxJump = Math.max(maxJump, Math.abs(r.pose.sy - prev.sy), Math.abs(r.pose.fwd - prev.fwd));
    prev = r.pose;
    assert.equal(r.travel, 0, "攻擊不會累積位移");
    if (pl.current === "idle" && back < 0) back = i;
  }
  assert.ok(back > 0 && Math.abs((back + 1) / 60 - ATTACK_DURATION) < 0.05, `約 ${ATTACK_DURATION} 秒後回待機（${(back + 1) / 60}）`);
  assert.ok(maxJump < 0.06, `每幀變化平順（最大 ${maxJump}）`);
  assert.ok(Math.abs(prev.fwd) < 1e-9 && Math.abs(prev.sy - 1) < 0.04);
});

import { HURT_DURATION, HURT_PHASES, HURT_REHIT_LOCK, hurtPose } from "../../src/monsters/star-dew-bobo-v38r/animation.ts";

test("V3.8R 受傷：衝擊壓縮 12%、後仰 10°、後退 0.08 公尺、回彈一次，體積不變、不離地不穿地", () => {
  let minSy = 9, minFwd = 9, minPitch = 9, maxRoll = 0;
  for (let i = 0; i <= 300; i++) {
    const p = hurtPose((i / 300) * HURT_DURATION);
    const [sx, sy, sz] = poseScale(p);
    assert.ok(Math.abs(sx * sy * sz - 1) < 1e-9);
    assert.equal(p.lift, 0);
    minSy = Math.min(minSy, p.sy);
    minFwd = Math.min(minFwd, p.fwd);
    minPitch = Math.min(minPitch, p.pitch);
    maxRoll = Math.max(maxRoll, Math.abs(p.roll));
  }
  assert.ok(minSy >= 0.875 && minSy <= 0.885, `最大壓縮 ${(1 - minSy) * 100}%`);
  assert.ok(Math.abs(minPitch + (10 * Math.PI) / 180) < 0.01, `後仰 ${(-minPitch * 180) / Math.PI}°`);
  assert.ok(Math.abs(minFwd + 0.08) < 0.005, `後退 ${-minFwd}`);
  assert.ok(maxRoll < 0.04, "左右晃很小");
  const imp = hurtPose(HURT_PHASES.impact[1]);
  assert.ok(imp.swayZ > 0.05 && imp.flap > 0.3, "衝擊：觸角往前、翅膀張開");
  assert.ok(hurtPose(0.42).sy > 1.02, "果凍回彈一次");
  const end = hurtPose(HURT_DURATION);
  assert.deepEqual([end.sy, end.sfwd, end.fwd, end.pitch, end.roll, end.swayZ, end.flap], [1, 1, 0, 0, 0, 0, 0], "結束時完全恢復");
});

test("V3.8R 受傷：打斷移動／攻擊、播完回待機；衝擊中再受擊忽略、之後重播；生命值歸零由死亡接管", () => {
  const dt = 1 / 60;
  const run = (pl: BoboAnimPlayer, sec: number): void => {
    for (let i = 0; i < Math.round(sec / dt); i++) pl.update(dt);
  };
  for (const start of ["move", "attack", "idle"] as const) {
    const pl = new BoboAnimPlayer("idle");
    pl.request(start);
    run(pl, 0.2);
    pl.hurt();
    assert.equal(pl.current, "hurt", `${start} 被打斷`);
    run(pl, HURT_DURATION + 0.4);
    assert.equal(pl.current, "idle", `${start} → 受傷 → 待機`);
    const p = pl.update(dt).pose;
    assert.equal(p.fwd, 0);
    assert.equal(p.sfwd, 1);
  }
  const pl = new BoboAnimPlayer("idle");
  pl.hurt();
  run(pl, HURT_REHIT_LOCK / 2);
  pl.hurt();
  assert.ok(pl.time > 0.05, "衝擊階段內再受擊：忽略（不重來）");
  run(pl, 0.2);
  pl.hurt();
  assert.ok(pl.time < 0.02, "衝擊後再受擊：從頭重播");
  run(pl, HURT_DURATION + 0.4);
  assert.equal(pl.current, "idle");
  const dead = new BoboAnimPlayer("idle");
  dead.hurt(true);
  assert.equal(dead.current, "death", "生命值歸零：由死亡動畫接管");
  run(dead, HURT_DURATION + 0.5);
  assert.notEqual(dead.current, "idle", "不回待機");
});

import { DEATH_DURATION, DEATH_PHASES, deathFx, deathPose, DUST_COLORS, dustCount, dustParticle } from "../../src/monsters/star-dew-bobo-v38r/animation.ts";

test("V3.8R 死亡：最後衝擊（壓縮 15%、後仰 12°）→ 軟倒 → 星光漸弱 → 淡出；體積不變、不穿地不彈起", () => {
  let minSy = 9, minPitch = 9;
  for (let i = 0; i <= 360; i++) {
    const t = (i / 360) * DEATH_DURATION;
    const p = deathPose(t);
    const [sx, sy, sz] = poseScale(p);
    assert.ok(Math.abs(sx * sy * sz - 1) < 1e-9, "體積近似守恆");
    assert.equal(p.lift, 0, "不彈起、不穿地");
    assert.ok(Math.abs(p.fwd) <= 0.05, "不會飛走或瞬移");
    assert.ok(Math.abs(p.roll) < 0.05, "只有輕微晃動");
    minSy = Math.min(minSy, p.sy);
    if (t <= 0.3) minPitch = Math.min(minPitch, p.pitch);
  }
  const imp = deathPose(DEATH_PHASES.impact[1]);
  assert.ok(Math.abs(imp.sy - 0.85) < 0.005, `衝擊壓縮 ${(1 - imp.sy) * 100}%`);
  assert.ok(Math.abs(minPitch + (12 * Math.PI) / 180) < 0.01, `後仰 ${(-minPitch * 180) / Math.PI}°`);
  assert.ok(minSy > 0.75, "不會變成扁平硬球");
  const slump = deathPose(1.05);
  assert.ok(slump.pitch > 0.1 && slump.swayZ > 0.05 && slump.flap < -0.2, "軟倒：前傾、觸角前傾、翅膀下垂");
  // 星光漸弱 → 淡出 → 粒子
  assert.equal(deathFx(0.6).starBright, 1);
  assert.equal(deathFx(1.05).starBright, 0);
  assert.equal(deathFx(1.0).visibility, 1);
  assert.equal(deathFx(1.55).visibility, 0);
  assert.equal(deathFx(0.5).eyesClosed, false);
  assert.equal(deathFx(0.9).eyesClosed, true);
  assert.equal(deathFx(1.0).dust, false);
  assert.equal(deathFx(1.3).dust, true);
  assert.equal(deathFx(DEATH_DURATION).dust, false, "結束時粒子清除");
});

test("V3.8R 星塵：高 10／中 8／低 6 顆，往上飄、淡入淡出，結束時完全透明", () => {
  assert.deepEqual([dustCount("high"), dustCount("medium"), dustCount("low")], [10, 8, 6]);
  assert.equal(DUST_COLORS.length, 3);
  for (let i = 0; i < 10; i++) {
    const a = dustParticle(i, 10, 1.1);
    const b = dustParticle(i, 10, 1.6);
    assert.ok(b.y >= a.y, "往上飄");
    assert.ok(dustParticle(i, 10, 1.05).alpha === 0 && dustParticle(i, 10, DEATH_DURATION).alpha < 1e-6, "淡入淡出");
    assert.ok(b.y < 1.4 && Math.hypot(b.x, b.z) < 0.6, "緩慢飄散、不爆炸");
  }
});

test("V3.8R 死亡狀態：打斷所有動畫、播完保持死亡、不接受指令、再受擊不重播", () => {
  const dt = 1 / 60;
  for (const start of ["idle", "move", "attack", "hurt"] as const) {
    const pl = new BoboAnimPlayer("idle");
    if (start === "hurt") pl.hurt();
    else pl.request(start);
    for (let i = 0; i < 10; i++) pl.update(dt);
    pl.death();
    assert.equal(pl.current, "death", `${start} 被打斷`);
    for (let i = 0; i < 30; i++) pl.update(dt);
    const t0 = pl.time;
    pl.death();
    pl.hurt();
    pl.hurt(true);
    pl.request("move");
    pl.request("attack");
    assert.equal(pl.current, "death");
    assert.ok(Math.abs(pl.time - t0) < 1e-12, "再受擊、指令都不影響");
    for (let i = 0; i < Math.round((DEATH_DURATION + 2) / dt); i++) pl.update(dt);
    assert.equal(pl.current, "dead", "播完保持死亡，不回待機");
    assert.ok(pl.isDead);
  }
});
