import { test } from "node:test";
import assert from "node:assert/strict";
import { MonsterStateMachine } from "../../src/monsters/anim/MonsterStateMachine.ts";
import { MonsterAnimator } from "../../src/monsters/anim/MonsterAnimator.ts";
import {
  BOBO_TIMINGS as T,
  attackPose,
  deathPose,
  hitPose,
  idlePose,
  movePose,
  respawnPose,
} from "../../src/monsters/anim/bobo-poses.ts";
import { STAR_DEW_BOBO_PROFILE } from "../../src/monsters/star-dew-bobo/profile.ts";
import type { MonsterEffect, MonsterPose } from "../../src/monsters/anim/types.ts";

const run = (sm: MonsterStateMachine, seconds: number, step = 1 / 60) => {
  for (let t = 0; t < seconds - 1e-9; t += step) sm.update(step);
};

// ---------- 狀態機 ----------

test("狀態機：初始 idle，移動切換", () => {
  const sm = new MonsterStateMachine(T);
  assert.equal(sm.state, "idle");
  assert.ok(sm.request("move").accepted);
  assert.equal(sm.state, "move");
  sm.request("idle");
  assert.equal(sm.state, "idle");
});

test("狀態機：攻擊不被移動打斷，結束後回到最新的移動狀態", () => {
  const sm = new MonsterStateMachine(T);
  sm.request("attack");
  assert.equal(sm.state, "attack");
  const r = sm.request("move");
  assert.ok(r.accepted && r.queued);
  assert.equal(sm.state, "attack", "移動不可打斷攻擊");
  run(sm, T.attack + 0.05);
  assert.equal(sm.state, "move");
});

test("狀態機：攻擊中不能再攻擊", () => {
  const sm = new MonsterStateMachine(T);
  sm.request("attack");
  run(sm, 0.2);
  const r = sm.request("attack");
  assert.equal(r.accepted, false);
  assert.ok(sm.stateTime > 0.15, "攻擊不應被重新開始");
});

test("狀態機：攻擊中受擊只疊加閃白，不中斷攻擊", () => {
  const sm = new MonsterStateMachine(T);
  sm.request("attack");
  run(sm, 0.3);
  const r = sm.request("hit");
  assert.ok(r.accepted && r.overlay);
  assert.equal(sm.state, "attack");
  assert.ok(sm.hitOverlay > 0);
  run(sm, T.attack);
  assert.equal(sm.state, "idle");
});

test("狀態機：受擊後回到基礎狀態，受擊中不能攻擊", () => {
  const sm = new MonsterStateMachine(T);
  sm.request("move");
  sm.request("hit");
  assert.equal(sm.state, "hit");
  assert.equal(sm.request("attack").accepted, false);
  run(sm, T.hit + 0.02);
  assert.equal(sm.state, "move");
});

test("狀態機：死亡打斷攻擊；死亡後只接受重生", () => {
  const sm = new MonsterStateMachine(T);
  sm.request("attack");
  run(sm, 0.2);
  assert.ok(sm.request("death").accepted);
  assert.equal(sm.state, "death");
  for (const a of ["attack", "move", "idle", "hit", "death"] as const) {
    assert.equal(sm.request(a).accepted, false, `死亡中不可 ${a}`);
  }
  assert.equal(sm.request("respawn").accepted, false, "死亡動畫未結束不可重生");
  run(sm, T.death + 0.05);
  assert.equal(sm.state, "dead");
  for (const a of ["attack", "move", "idle", "hit", "death"] as const) {
    assert.equal(sm.request(a).accepted, false, `dead 不可 ${a}`);
  }
  assert.ok(sm.request("respawn").accepted);
  assert.equal(sm.state, "respawn");
});

test("狀態機：重生中不可被打斷，結束回到 idle", () => {
  const sm = new MonsterStateMachine(T);
  sm.request("move");
  sm.request("death");
  run(sm, T.death + 0.1);
  sm.request("respawn");
  for (const a of ["attack", "hit", "death"] as const) assert.equal(sm.request(a).accepted, false);
  run(sm, T.respawn + 0.05);
  assert.equal(sm.state, "idle", "重生後應回到待機（不延續死前的移動）");
});

test("狀態機：存活時不能重生", () => {
  const sm = new MonsterStateMachine(T);
  assert.equal(sm.request("respawn").accepted, false);
});

test("狀態機：極大 dt 也能正確結束動作", () => {
  const sm = new MonsterStateMachine(T);
  sm.request("death");
  sm.update(10);
  assert.equal(sm.state, "dead");
});

// ---------- 特效時間軸 ----------

function collectEffects(anim: MonsterAnimator, seconds: number, step: number): MonsterEffect[] {
  const all: MonsterEffect[] = [];
  for (let t = 0; t < seconds; t += step) all.push(...anim.update(step).effects);
  return all;
}

test("特效：攻擊撞擊事件剛好觸發一次（小步與大步）", () => {
  for (const step of [1 / 120, 1 / 30, 0.25]) {
    const anim = new MonsterAnimator(STAR_DEW_BOBO_PROFILE);
    anim.update(0.016);
    anim.request("attack");
    const effects = collectEffects(anim, 1.2, step);
    assert.deepEqual(effects.filter((e) => e === "attackImpact").length, 1, `step=${step}`);
  }
});

test("特效：死亡粒子、重生開始與成形各觸發一次", () => {
  const anim = new MonsterAnimator(STAR_DEW_BOBO_PROFILE);
  anim.request("death");
  const d = collectEffects(anim, 2, 1 / 60);
  assert.deepEqual(d, ["deathBurst"]);
  assert.equal(anim.sm.state, "dead");
  anim.request("respawn");
  const r = collectEffects(anim, 2, 1 / 60);
  assert.deepEqual(r, ["respawnStart", "respawnPop"]);
  assert.equal(anim.sm.state, "idle");
});

// ---------- 動作曲線 ----------

const finite = (p: MonsterPose) =>
  Object.entries(p).every(([, v]) => typeof v !== "number" || Number.isFinite(v));
const near = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test("曲線：所有動作在整段時間內數值有效", () => {
  for (let t = 0; t <= 3; t += 0.01) {
    for (const p of [idlePose(t), movePose(t), attackPose(t), hitPose(t), deathPose(t), respawnPose(t)]) {
      assert.ok(finite(p), `t=${t}`);
      assert.ok(p.opacity >= 0 && p.opacity <= 1);
      assert.ok(p.scaleY > 0 && p.scaleXZ > 0);
    }
  }
});

test("曲線：待機呼吸與彈跳移動可無縫循環", () => {
  for (const [fn, P] of [[idlePose, T.idlePeriod], [movePose, T.hopPeriod]] as const) {
    const a = fn(0);
    const b = fn(P);
    near(a.scaleY, b.scaleY, 1e-6, "scaleY");
    near(a.offsetY, b.offsetY, 1e-6, "offsetY");
  }
});

test("曲線：待機為輕微伸縮（<=5%）且體積大致守恆", () => {
  for (let t = 0; t < T.idlePeriod; t += 0.05) {
    const p = idlePose(t);
    assert.ok(Math.abs(p.scaleY - 1) <= 0.05);
    near(p.scaleXZ * p.scaleXZ * p.scaleY, 1, 1e-9, "體積");
  }
});

test("曲線：彈跳有離地、落地有擠壓", () => {
  let maxY = 0;
  let minScale = 1;
  for (let t = 0; t < T.hopPeriod; t += 0.005) {
    const p = movePose(t);
    maxY = Math.max(maxY, p.offsetY);
    if (p.offsetY === 0) minScale = Math.min(minScale, p.scaleY);
  }
  assert.ok(maxY > 0.2, "跳躍高度不足");
  assert.ok(minScale < 0.95, "落地擠壓不明顯");
  assert.ok(minScale >= 0.88, "落地壓得太扁（V1.1：須保留圓潤外型）");
});

test("曲線（V1.1）：移動全程保持圓潤，不過度變形", () => {
  for (let t = 0; t < T.hopPeriod * 2; t += 0.002) {
    const p = movePose(t);
    assert.ok(p.scaleY >= 0.88 && p.scaleY <= 1.07, `scaleY=${p.scaleY}`);
    assert.ok(p.scaleXZ <= 1.07 && p.scaleXZ >= 0.96, `scaleXZ=${p.scaleXZ}`);
    // 寬高比不超過 1.2 倍（原本會到 1.7 倍）
    assert.ok(p.scaleXZ / p.scaleY <= 1.2);
  }
});

test("曲線：攻擊向前衝撞後回到原位", () => {
  let maxZ = 0;
  for (let t = 0; t <= T.attack; t += 0.005) maxZ = Math.max(maxZ, attackPose(t).offsetZ);
  assert.ok(maxZ >= 1, "衝撞距離不足");
  const end = attackPose(T.attack);
  near(end.offsetZ, 0, 1e-9, "結束位置");
  near(end.scaleY, 1, 1e-9, "結束縮放");
  near(end.lean, 0, 1e-9, "結束傾角");
  assert.equal(attackPose(0.3).face, "angry");
});

test("曲線：受傷震動逐漸停止", () => {
  const start = Math.max(...[0.01, 0.02, 0.03].map((t) => Math.abs(hitPose(t).shakeX)));
  const end = Math.abs(hitPose(T.hit).shakeX);
  assert.ok(start > 0.02 && end < 1e-9);
  assert.equal(hitPose(0.05).face, "hurt");
});

test("曲線：死亡逐漸消散至透明", () => {
  const mid = deathPose(T.death * 0.6);
  assert.ok(mid.opacity > 0 && mid.opacity < 1);
  const end = deathPose(T.death);
  near(end.opacity, 0, 1e-9, "結束透明度");
  assert.ok(end.scaleY < 0.2);
  assert.equal(end.bodyVisible, false);
});

test("曲線：重生從無到完整身體", () => {
  const start = respawnPose(0);
  assert.equal(start.bodyVisible, false);
  assert.ok(start.ringOpacity === 0 && start.ringScale > 0);
  const mid = respawnPose(0.9);
  assert.ok(mid.ringOpacity > 0.5);
  const end = respawnPose(T.respawn);
  near(end.opacity, 1, 1e-9, "透明度");
  near(end.scaleY, 1, 1e-6, "高度");
  near(end.scaleXZ, 1, 1e-6, "寬度");
  near(end.ringOpacity, 0, 1e-9, "光環");
  near(end.offsetY, 0, 1e-9, "位置");
});
