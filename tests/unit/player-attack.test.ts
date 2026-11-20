import assert from "node:assert/strict";
import { test } from "node:test";
import { ATTACK_DURATION, ATTACK_TIMING, AttackAnimator, attackPoseAt } from "../../src/actors/attackAnim.ts";
import { PREVIEW_COMBAT, PreviewCombat } from "../../src/game/previewCombat.ts";
import { MONSTER_DEFINITIONS } from "../../src/config/monsters.ts";
import { MonsterInstance } from "../../src/monsters/framework/MonsterInstance.ts";
import { createMonsterRegistry } from "../../src/monsters/framework/index.ts";

const def = MONSTER_DEFINITIONS.find((d) => d.monsterId === "star_dew_bobo")!;
const timings = createMonsterRegistry().profile(def.animationProfileId).anim.timings;
const bobo = (x: number, z: number, id = "b"): MonsterInstance => new MonsterInstance(id, def, timings, { x, y: 0, z });

test("攻擊動作：蓄力→揮擊→收招三階段，傷害判定落在揮擊中，總長短於攻擊間隔", () => {
  assert.equal(attackPoseAt(0.05).phase, "windup");
  assert.equal(attackPoseAt(ATTACK_TIMING.hit).phase, "strike");
  assert.equal(attackPoseAt(ATTACK_TIMING.windup + ATTACK_TIMING.strike + 0.05).phase, "recover");
  assert.equal(attackPoseAt(ATTACK_DURATION).phase, "idle");
  assert.ok(ATTACK_DURATION < PREVIEW_COMBAT.playerAttackInterval, "動作必須在下一次可攻擊前結束");
  // 蓄力：右手往後（正）、身體後仰；揮擊結束：右手往前（負）且幅度明顯、身體前傾、向前踏
  const w = attackPoseAt(ATTACK_TIMING.windup - 0.001);
  assert.ok(w.armRX > 1 && w.twist > 0.3);
  const s = attackPoseAt(ATTACK_TIMING.windup + ATTACK_TIMING.strike - 0.001);
  assert.ok(s.armRX < -1.5 && s.lean > 0.2 && s.lunge > 0.1);
  // 收招尾端回到待機姿勢
  const r = attackPoseAt(ATTACK_DURATION - 0.001);
  assert.ok(Math.abs(r.armRX) < 0.01 && Math.abs(r.lean) < 0.01 && r.weight < 0.01);
});

test("攻擊動作播放器：重新開始不疊加、播完自動回待機", () => {
  const a = new AttackAnimator();
  a.start();
  for (let i = 0; i < 10; i++) a.update(1 / 60);
  a.start(); // 再按一次：從頭開始，不是疊加兩份
  assert.ok(a.elapsed === 0 && a.active);
  let frames = 0;
  while (a.active && frames < 1000) {
    a.update(1 / 60);
    frames++;
  }
  assert.ok(frames <= Math.ceil(ATTACK_DURATION * 60) + 1, "不會卡住");
  assert.equal(a.pose().phase, "idle");
  assert.equal(a.started, 2);
});

test("傷害在揮中時結算：按下時不扣血、到 hitAt 才扣 20；冷卻與間隔不變", () => {
  const c = new PreviewCombat();
  const m = bobo(1, 0);
  const s = c.startAttack(0, 0, 0, [m], ATTACK_TIMING.hit);
  assert.ok(s.ok);
  assert.equal(m.currentHp, def.maxHp, "按下瞬間不扣血");
  assert.equal(c.resolvePending(0.1, 0, 0, [m]), null);
  const r = c.resolvePending(ATTACK_TIMING.hit, 0, 0, [m]);
  assert.ok(r && r.ok && r.damage === PREVIEW_COMBAT.playerAttackDamage);
  assert.equal(m.currentHp, def.maxHp - PREVIEW_COMBAT.playerAttackDamage);
  assert.equal(c.resolvePending(0.5, 0, 0, [m]), null, "只結算一次");
  assert.deepEqual(c.startAttack(0.9, 0, 0, [m], ATTACK_TIMING.hit), { ok: false, reason: "cooldown" });
  assert.ok(c.startAttack(PREVIEW_COMBAT.playerAttackInterval, 0, 0, [m], ATTACK_TIMING.hit).ok);
});

test("揮中前目標跑出範圍或已死亡 → 落空；玩家倒地 → 取消", () => {
  const c = new PreviewCombat();
  const m = bobo(1, 0);
  c.startAttack(0, 0, 0, [m], 0.2);
  m.currentPosition.x = 10;
  const r = c.resolvePending(0.2, 0, 0, [m]);
  assert.deepEqual(r, { ok: false, reason: "miss" });
  assert.equal(m.currentHp, def.maxHp);
  m.currentPosition.x = 1;
  c.startAttack(1, 0, 0, [m], 0.2);
  c.debugKnockDown(1.1);
  assert.equal(c.resolvePending(1.2, 0, 0, [m]), null);
  assert.equal(m.currentHp, def.maxHp);
});
