import { test } from "node:test";
import assert from "node:assert/strict";
import { NORMAL_HIT_FLASH } from "../../src/config/hitReaction.ts";
import { PreviewCombat, PREVIEW_COMBAT } from "../../src/game/previewCombat.ts";
import { Arena, type ArenaMonster, type DriverVisual } from "./support/arena.ts";

/**
 * 普通攻擊正式規則（2026-11-20）回歸測試：
 *   普通攻擊只扣血與受擊回饋，不擊退、不硬直、不打斷追擊或攻擊、不重置攻擊冷卻；怪物打玩家也一樣。
 * 判斷方式：同一個場景跑兩次（一次玩家持續攻擊、一次不攻擊），怪物的位置、朝向、攻擊時間要完全相同；
 * 「恢復出手」以撞擊時真的扣到玩家 HP 判斷。
 */

const DT = 1 / 60;
const vis = (m: ArenaMonster): DriverVisual => m.c.visual as DriverVisual;

interface Trace {
  pos: { x: number; z: number; yaw: number; state: string }[];
  starts: number[];
  landedAt: number[];
  hitStates: number;
  hpEnd: number;
}

function trace(setup: (a: Arena) => ArenaMonster, attack: boolean, seconds: number): Trace {
  const a = new Arena();
  a.autoAttack = attack;
  const m = setup(a);
  const t: Trace = { pos: [], starts: [], landedAt: [], hitStates: 0, hpEnd: 0 };
  let prevId = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    a.tick(DT);
    const inst = m.c.instance;
    t.pos.push({ x: inst.currentPosition.x, z: inst.currentPosition.z, yaw: inst.yaw, state: inst.sm.state });
    if (inst.sm.state === "hit") t.hitStates++;
    if (inst.attackId !== prevId) {
      prevId = inst.attackId;
      t.starts.push(a.now);
    }
  }
  t.landedAt = m.landedAt;
  t.hpEnd = m.c.instance.currentHp;
  return t;
}

function assertSameBehaviour(hit: Trace, base: Trace, label: string): void {
  assert.equal(hit.pos.length, base.pos.length);
  let maxD = 0;
  let stateDiff = 0;
  for (let i = 0; i < hit.pos.length; i++) {
    const p = hit.pos[i]!, q = base.pos[i]!;
    maxD = Math.max(maxD, Math.hypot(p.x - q.x, p.z - q.z), Math.abs(p.yaw - q.yaw));
    if (p.state !== q.state) stateDiff++;
  }
  assert.ok(maxD < 1e-9, `${label}：受擊造成位置／朝向差異 ${maxD}`);
  assert.equal(stateDiff, 0, `${label}：受擊造成狀態差異 ${stateDiff} 幀`);
  assert.deepEqual(hit.starts.map((x) => x.toFixed(4)), base.starts.map((x) => x.toFixed(4)), `${label}：攻擊開始時間（冷卻）不變`);
  assert.deepEqual(hit.landedAt.map((x) => x.toFixed(4)), base.landedAt.map((x) => x.toFixed(4)), `${label}：命中玩家的時間不變`);
  assert.equal(hit.hitStates, 0, `${label}：從未進入受擊硬直`);
}

test("普通攻擊：怪物原地攻擊時被持續攻擊 30 秒，位置、朝向、狀態、攻擊與命中時間和沒被打時完全相同（不擊退、不硬直、不重置冷卻）", () => {
  const setup = (a: Arena) => a.add(1.0, 0, { maxHp: 100000 });
  const hit = trace(setup, true, 30);
  const base = trace(setup, false, 30);
  assertSameBehaviour(hit, base, "原地攻擊");
  assert.equal(hit.hpEnd, 100000 - 30 * PREVIEW_COMBAT.playerAttackDamage, "30 下、每下扣 20");
  assert.ok(hit.landedAt.length >= 12, `怪物命中玩家 ${hit.landedAt.length} 次（冷卻 2 秒）`);
  for (let i = 1; i < hit.starts.length; i++) assert.ok(hit.starts[i]! - hit.starts[i - 1]! >= 2 - 1e-6, "冷卻 2 秒");
});

test("普通攻擊：怪物追擊中被打不中斷追擊（移動路線與沒被打時完全相同），追上後照常攻擊命中", () => {
  // 玩家在 2.4 公尺（玩家攻擊範圍 2.5 內、怪物攻擊範圍 1.1 外）→ 怪物要先追擊
  const setup = (a: Arena) => {
    a.px = 2.4;
    return a.add(0, 0, { maxHp: 100000 });
  };
  const hit = trace(setup, true, 12);
  const base = trace(setup, false, 12);
  assert.ok(hit.pos.some((p) => p.state === "move"), "有追擊");
  assertSameBehaviour(hit, base, "追擊");
  assert.ok(hit.landedAt.length >= 3);
});

test("普通攻擊：受擊回饋照常（扣血、受擊表情），但不播受傷動作、不後退", () => {
  const a = new Arena();
  a.autoAttack = false;
  const m = a.add(1.0, 0);
  const inst = m.c.instance;
  a.run(2.5);
  const pos = { ...inst.currentPosition };
  const state = inst.sm.state;
  const r = inst.receiveDamage(20, a.now);
  assert.equal(r.applied, true);
  assert.equal(r.reaction?.kind, "normal");
  assert.equal(r.reaction?.stagger, 0);
  assert.equal(r.reaction?.recoil, 0);
  assert.equal(inst.currentHp, 40);
  assert.equal(inst.sm.state, state, "狀態不變");
  assert.deepEqual(inst.resistance.state(a.now), { combo: 0, immuneRemaining: 0 }, "普通攻擊不累計連續受擊");
  const faces: string[] = [];
  let minFwd = 0;
  for (let i = 0; i < Math.round(0.6 / DT); i++) {
    a.tick(DT);
    const f = vis(m).frame!;
    faces.push(f.face);
    minFwd = Math.min(minFwd, f.anim === "attack" ? 0 : f.pose.fwd);
    assert.notEqual(f.anim, "hurt", "不播受傷動作");
  }
  assert.ok(faces.slice(0, Math.round((NORMAL_HIT_FLASH - 0.05) / DT)).every((f) => f === "hurt"), "受擊表情");
  assert.ok(faces.slice(Math.round((NORMAL_HIT_FLASH + 0.05) / DT)).every((f) => f !== "hurt"), "受擊表情只持續一下");
  assert.equal(vis(m).driver.starts.hurt, 0);
  assert.equal(vis(m).driver.reactions.noStagger, 1);
  assert.ok(Math.hypot(inst.currentPosition.x - pos.x, inst.currentPosition.z - pos.z) < 0.02 || inst.sm.state !== "idle");
});

test("普通攻擊：怪物攻擊進行中被打，攻擊不取消、照常命中玩家", () => {
  const a = new Arena();
  a.autoAttack = false;
  const m = a.add(1.0, 0);
  const inst = m.c.instance;
  let guard = 0;
  while (inst.sm.state !== "attack" && guard++ < 300) a.tick(DT);
  a.run(0.2);
  const id = inst.attackId;
  const last = inst.lastAttackTime;
  inst.receiveDamage(20, a.now);
  assert.equal(inst.sm.state, "attack");
  assert.equal(inst.lastAttackTime, last, "冷卻不重置");
  const before = m.landed;
  a.run(0.5);
  assert.equal(inst.attackLog.cancelled, 0);
  assert.equal(inst.attackLog.lastResolvedId, id);
  assert.equal(m.landed, before + 1);
});

test("怪物普通攻擊玩家：只扣 HP，不擊退、不硬直（玩家位置不變、可以立刻出手、已出手的攻擊照常揮中）", () => {
  const c = new PreviewCombat();
  const mon = { instanceId: "m", isAlive: true, currentPosition: { x: 1, z: 0 }, definition: { attack: 8, attackRange: 1.1, name: "x" }, receiveDamage: () => ({ applied: true, killed: false }) };
  const target = { ...mon, instanceId: "t", currentPosition: { x: 1, z: 0 } };
  const player = { x: 0, z: 0 };
  // 已出手、還沒揮中時被打
  const s = c.startAttack(0, player.x, player.z, [target], 0.2);
  assert.ok(s.ok);
  assert.equal(c.monsterImpact(0.1, mon, player.x, player.z), 8);
  assert.equal(c.hp, 92);
  assert.deepEqual(player, { x: 0, z: 0 }, "玩家位置不變");
  const r = c.resolvePending(0.2, player.x, player.z, [target]);
  assert.equal(r?.ok, true, "被打不取消玩家的攻擊");
  // 冷卻到了可以立刻再出手（被打不延長冷卻）
  c.monsterImpact(0.9, mon, player.x, player.z);
  assert.equal(c.startAttack(1.0, player.x, player.z, [target], 0.2).ok, true);
  assert.equal(c.isDown, false);
  // 遊戲場景：玩家站著被怪物打 20 秒，位置始終不動、攻擊次數照冷卻
  const a = new Arena();
  a.immortal = true;
  a.add(1.0, 0, { maxHp: 100000 });
  const starts: number[] = [];
  for (let i = 0; i < 20 * 60; i++) {
    const before = a.combat.pendingAttack;
    a.tick(DT);
    if (!before && a.combat.pendingAttack) starts.push(a.now);
    assert.equal(a.px, 0);
    assert.equal(a.pz, 0);
  }
  assert.ok(a.playerDamageTaken > 0, "玩家有被打到");
  const gaps = starts.slice(1).map((t, k) => t - starts[k]!);
  assert.ok(gaps.every((g) => Math.abs(g - PREVIEW_COMBAT.playerAttackInterval) < 2 * DT), `玩家攻擊間隔 ${gaps.map((g) => g.toFixed(2))}`);
});

for (const count of [3, 10]) {
  test(`普通攻擊：${count} 隻怪物同時戰鬥 60 秒，沒有怪物進入受擊硬直或被取消攻擊，在範圍內的都會出手命中`, () => {
    const a = new Arena();
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const r = 1.0 + (i % 3) * 0.6;
      a.add(Math.cos(ang) * r, Math.sin(ang) * r);
    }
    let hitFrames = 0;
    let cancelledAlive = 0;
    const prevCancel = new Map(a.monsters.map((m) => [m, 0]));
    for (let i = 0; i < 60 * 60; i++) {
      a.tick(DT);
      for (const m of a.monsters) {
        const inst = m.c.instance;
        if (inst.sm.state === "hit") hitFrames++;
        // 被打死時取消未命中的攻擊是正常的（死亡規則）；活著卻被取消才是問題
        if (inst.attackLog.cancelled !== prevCancel.get(m)) {
          if (inst.sm.state !== "death") cancelledAlive++;
          prevCancel.set(m, inst.attackLog.cancelled);
        }
      }
    }
    assert.equal(cancelledAlive, 0, "活著的怪物攻擊沒有被受擊取消");
    assert.equal(hitFrames, 0, "沒有受擊硬直");
    for (const m of a.monsters) {
      const i = m.c.instance;
      assert.ok(Number.isFinite(i.currentPosition.x) && Number.isFinite(i.currentPosition.z) && Number.isFinite(i.currentHp));
      assert.ok(m.maxEngagedNoLand < 3.5, `${i.instanceId} 在範圍內最長 ${m.maxEngagedNoLand.toFixed(1)} 秒沒打到玩家`);
    }
    const hitMonsters = a.monsters.filter((m) => m.hitsTaken > 0);
    assert.ok(hitMonsters.length >= 2, "玩家有打到怪物");
    assert.ok(hitMonsters.some((m) => m.landedAt.some((t) => t > m.hitAt[0]!)), "被打過的怪物照常打到玩家");
    assert.ok(a.monsters.some((m) => m.c.instance.attackLog.started > 0 && m.landedAt.some((t) => t > 40)), "40 秒後仍有怪物命中");
  });
}

test("普通攻擊：怪物被打倒、重生後照常追擊與攻擊；重生後被打仍不硬直", () => {
  const a = new Arena();
  const m = a.add(1.0, 0);
  const inst = m.c.instance;
  let died = false;
  for (let i = 0; i < 4 * 60 && !died; i++) {
    a.tick(DT);
    if (inst.sm.state === "death") died = true;
  }
  assert.ok(died, "3 下擊倒");
  a.autoAttack = false;
  a.px = 4; // 站遠一點，確認重生後會追擊
  let guard = 0;
  while (inst.sm.state !== "respawn" && guard++ < 16 * 60) a.tick(DT);
  assert.equal(inst.sm.state, "respawn");
  assert.equal(inst.currentHp, 60);
  const before = m.landed;
  let chased = false;
  for (let i = 0; i < 6 * 60; i++) {
    a.tick(DT);
    if (inst.sm.state === "move") chased = true;
  }
  assert.ok(chased && m.landed > before, "重生後追擊並命中");
  const st = inst.sm.state;
  inst.receiveDamage(20, a.now);
  assert.equal(inst.sm.state, st, "重生後被打仍不硬直");
});

test("擊退與硬直系統保留（control 受擊，供未來特殊技能）；普通攻擊不啟用", () => {
  const a = new Arena();
  a.autoAttack = false;
  const m = a.add(1.0, 0, { maxHp: 1000 });
  const inst = m.c.instance;
  const r = inst.receiveDamage(20, a.now, "control");
  assert.equal(r.reaction?.kind, "control");
  assert.equal(r.reaction?.tier, 1);
  assert.equal(inst.sm.state, "hit");
  assert.equal(new PreviewCombat().attackHitKind, "normal", "玩家普通攻擊固定為 normal");
});
