import assert from "node:assert/strict";
import { test } from "node:test";
import { PREVIEW_COMBAT, PreviewCombat, previewSpawnPoints } from "../../src/game/previewCombat.ts";
import { MONSTER_DEFINITIONS } from "../../src/config/monsters.ts";
import { MonsterInstance } from "../../src/monsters/framework/MonsterInstance.ts";
import { createMonsterRegistry } from "../../src/monsters/framework/index.ts";

const boboDef = MONSTER_DEFINITIONS.find((d) => d.monsterId === "star_dew_bobo")!;
const timings = createMonsterRegistry().profile(boboDef.animationProfileId).anim.timings;
const bobo = (x: number, z: number, id = "b1"): MonsterInstance => new MonsterInstance(id, boboDef, timings, { x, y: 0, z });

test("星露啵啵數值未被修改（暫定值）", () => {
  assert.equal(boboDef.maxHp, 60);
  assert.equal(boboDef.attack, 8);
  assert.equal(boboDef.experience, 12);
  assert.equal(boboDef.respawnTime, 10);
});

test("玩家攻擊：範圍內最近目標、冷卻 1 秒、3 下擊敗、死亡中不再受傷", () => {
  const c = new PreviewCombat();
  const near = bobo(1, 0, "near");
  const far = bobo(2, 0, "far");
  const out = bobo(5, 0, "out");
  const ms = [far, near, out];
  const r1 = c.playerAttack(0, 0, 0, ms);
  assert.ok(r1.ok && r1.targetId === "near" && r1.damage === PREVIEW_COMBAT.playerAttackDamage);
  assert.deepEqual(c.playerAttack(0.5, 0, 0, ms), { ok: false, reason: "cooldown" });
  assert.ok(c.playerAttack(1.0, 0, 0, ms).ok);
  const r3 = c.playerAttack(2.0, 0, 0, ms);
  assert.ok(r3.ok && r3.killed);
  assert.equal(near.currentHp, 0);
  assert.equal(near.isAlive, false);
  // 死亡的不再是目標 → 改打下一隻
  const r4 = c.playerAttack(3.0, 0, 0, ms);
  assert.ok(r4.ok && r4.targetId === "far");
  assert.deepEqual(c.playerAttack(4.0, 10, 10, ms), { ok: false, reason: "no-target" });
});

test("怪物撞擊：範圍內才扣 HP、扣怪物 attack；歸零倒地、2 秒後滿血復活", () => {
  const c = new PreviewCombat();
  const m = bobo(1, 0);
  assert.equal(c.monsterImpact(0, m, 10, 0), 0, "太遠不扣");
  let t = 0;
  while (!c.isDown) {
    assert.equal(c.monsterImpact(t, m, 0, 0), boboDef.attack);
    t += 2;
  }
  assert.equal(c.hp, 0);
  assert.equal(c.hitsTaken, Math.ceil(PREVIEW_COMBAT.playerMaxHp / boboDef.attack));
  assert.equal(c.monsterImpact(t, m, 0, 0), 0, "倒地中不再受傷");
  assert.deepEqual(c.playerAttack(t, 0, 0, [m]), { ok: false, reason: "down" });
  assert.equal(c.update(t - 2 + PREVIEW_COMBAT.downSeconds - 0.01), false);
  assert.equal(c.update(t - 2 + PREVIEW_COMBAT.downSeconds), true);
  assert.equal(c.hp, PREVIEW_COMBAT.playerMaxHp);
  assert.equal(c.isDown, false);
});

test("生成點：出生點前方 6–9 公尺、互相分開", () => {
  for (const yaw of [0, 1, -2.2, Math.PI]) {
    const pts = previewSpawnPoints(0, 0, yaw);
    assert.equal(pts.length, 3);
    for (const p of pts) {
      const d = Math.hypot(p.x, p.z);
      assert.ok(d >= 6 - 1e-9 && d <= 9 + 1e-9, `distance ${d}`);
      // 在前方：與前進方向夾角小於 45°
      const dot = (p.x * Math.sin(yaw) + p.z * Math.cos(yaw)) / d;
      assert.ok(dot > Math.SQRT1_2);
    }
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z) > 2);
  }
});
