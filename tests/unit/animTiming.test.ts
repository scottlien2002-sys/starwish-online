import { test } from "node:test";
import assert from "node:assert/strict";
import { ANIM_TIMING, animClock, attackPlaybackRate, runRate } from "../../src/actors/animTiming.ts";
import { ATTACK_TIMING } from "../../src/actors/attackAnim.ts";
import { AnimStateMachine } from "../../src/actors/animState.ts";

test("攻擊動作與遊戲攻擊週期一致：0.5 秒、命中 0.2 秒", () => {
  assert.equal(ANIM_TIMING.attack.seconds, 0.5);
  assert.equal(ANIM_TIMING.attack.hit, ATTACK_TIMING.hit);
  assert.equal(attackPlaybackRate(100), 1);
});

test("攻速倍率：越快越短；超過 160 以 160 計（最快 0.3125 秒）", () => {
  assert.ok(attackPlaybackRate(130) > attackPlaybackRate(100));
  assert.equal(attackPlaybackRate(160), 1.6);
  assert.equal(attackPlaybackRate(999), 1.6);
  assert.equal(ANIM_TIMING.attack.seconds / attackPlaybackRate(160), 0.3125);
  const m = new AnimStateMachine({ Attack: 0.5 });
  m.setDuration("Attack", 0.5 / attackPlaybackRate(160));
  m.update(0.016, { moving: false, attack: true });
  m.update(0.31, { moving: false });
  assert.equal(m.state, "Attack");
  m.update(0.01, { moving: false });
  assert.equal(m.state, "Idle");
});

test("跑步播放倍率：跟著速度走、有上下限；上限以內不滑步", () => {
  const g = ANIM_TIMING.run.groundSpeed;
  assert.ok(Math.abs(runRate(g).slide) < 1e-9);
  assert.ok(Math.abs(runRate(g * 1.5).slide) < 1e-9);
  assert.equal(runRate(100).rate, ANIM_TIMING.run.maxRate);
  assert.ok(runRate(100).slide > 0);
  assert.equal(runRate(0.1).rate, ANIM_TIMING.run.minRate);
  assert.equal(animClock("Idle", 5, 1.3).rate, 1);
  assert.equal(animClock("Attack", 5, 1.3).rate, 1.3);
  assert.equal(animClock("Run", g, 1).rate, 1);
});

test("C1.0-B5a 跨步加大：5 m/s 時男女跑步倍率都在 2.4 倍以內、沒有滑步；B5 仍會滑", async () => {
  const { ANIM_TIMING: T, runRate: rr } = await import("../../src/actors/animTiming.ts");
  for (const g of ["male", "female"] as const) {
    const a = rr(5, T.run.groundSpeedBy.c10b5a![g]);
    assert.ok(a.rate <= 2.4 && Math.abs(a.slide) < 1e-9, `${g} ${JSON.stringify(a)}`);
    assert.ok(rr(5, T.run.groundSpeedBy.c10b5![g]).slide > 0.5);
  }
});
