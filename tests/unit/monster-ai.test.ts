import { test } from "node:test";
import assert from "node:assert/strict";
import { MonsterFactory, createMonsterRegistry, type MonsterTarget } from "../../src/monsters/framework/index.ts";
import type { MonsterController } from "../../src/monsters/framework/MonsterController.ts";
import type { BrainMode } from "../../src/monsters/framework/types.ts";

const factory = () => new MonsterFactory(createMonsterRegistry());
const spawnBobo = (seed = 1) =>
  factory().create("star_dew_bobo", { x: 0, y: 0, z: 0 }, { visual: false, brain: { seed, idleMin: 0.5, idleMax: 1 } });

function run(c: MonsterController, seconds: number, target: MonsterTarget | null, now0 = 0, dt = 1 / 30): { now: number; modes: Set<BrainMode> } {
  const modes = new Set<BrainMode>();
  let now = now0;
  for (let t = 0; t < seconds; t += dt) {
    now += dt;
    c.update(dt, now, target);
    modes.add(c.brain!.mode);
  }
  return { now, modes };
}

test("AI：沒有目標時在出生區域巡邏，不會離開巡邏半徑", () => {
  const c = spawnBobo(3);
  const { modes } = run(c, 30, null);
  assert.ok(modes.has("idle") && modes.has("patrol"));
  const p = c.instance.currentPosition;
  assert.ok(Math.hypot(p.x, p.z) <= (c.instance.definition.patrolRadius ?? 3) + 0.01);
});

test("AI：目標進入警戒範圍 → 追擊 → 進入攻擊範圍後攻擊", () => {
  const c = spawnBobo();
  const def = c.instance.definition;
  const target: MonsterTarget = { id: "player", x: def.aggroRange - 1, z: 0, alive: true };
  const { modes } = run(c, 6, target);
  assert.ok(modes.has("chase"), "應追擊");
  assert.ok(modes.has("attack"), "應攻擊");
  const d = Math.hypot(target.x - c.instance.currentPosition.x, target.z - c.instance.currentPosition.z);
  assert.ok(d <= def.attackRange + 0.05, `距離 ${d}`);
  assert.ok(c.instance.lastAttackTime > 0, "已發動攻擊");
  assert.equal(c.instance.currentTarget, "player");
});

test("AI：目標在警戒範圍外不追擊", () => {
  const c = spawnBobo();
  const target: MonsterTarget = { id: "player", x: c.instance.definition.aggroRange + 5, z: 0, alive: true };
  const { modes } = run(c, 5, target);
  assert.ok(!modes.has("chase") && !modes.has("attack"));
});

test("AI：攻擊依冷卻時間進行，不會連續攻擊", () => {
  const c = spawnBobo();
  const def = c.instance.definition;
  const target: MonsterTarget = { id: "player", x: 0.5, z: 0, alive: true };
  let attacks = 0;
  let last = c.instance.lastAttackTime;
  let now = 0;
  for (let i = 0; i < 300; i++) {
    now += 1 / 30;
    c.update(1 / 30, now, target);
    if (c.instance.lastAttackTime !== last) {
      attacks++;
      last = c.instance.lastAttackTime;
    }
  }
  // 10 秒內，冷卻 2 秒 → 最多 5~6 次
  assert.ok(attacks >= 3 && attacks <= Math.ceil(10 / def.attackCooldown) + 1, `攻擊 ${attacks} 次`);
});

test("AI：目標離開 → 返回出生點；被拉太遠也會返回", () => {
  const c = spawnBobo();
  const target: MonsterTarget = { id: "player", x: 4, z: 0, alive: true };
  let r = run(c, 3, target);
  assert.ok(r.modes.has("chase") || r.modes.has("attack"));
  target.x = 40; // 跑遠
  let minDist = Infinity;
  const modesAfter = new Set<BrainMode>();
  let now = r.now;
  for (let i = 0; i < 360; i++) {
    now += 1 / 30;
    c.update(1 / 30, now, target);
    modesAfter.add(c.brain!.mode);
    const p = c.instance.currentPosition;
    minDist = Math.min(minDist, Math.hypot(p.x, p.z));
  }
  assert.ok(modesAfter.has("return"));
  assert.ok(minDist < 0.5, `回到出生點附近（最近 ${minDist.toFixed(2)}m）；之後恢復巡邏`);
  assert.ok(modesAfter.has("idle") || modesAfter.has("patrol"), "返回後恢復待機/巡邏");

  // 拉怪：目標一直在旁邊但越拉越遠
  const c2 = spawnBobo(2);
  const t2: MonsterTarget = { id: "player", x: 3, z: 0, alive: true };
  now = 0;
  const seen = new Set<BrainMode>();
  for (let i = 0; i < 900; i++) {
    now += 1 / 30;
    t2.x += 1.2 / 30;
    c2.update(1 / 30, now, t2);
    seen.add(c2.brain!.mode);
  }
  assert.ok(seen.has("return"), "超過 leashRange 應返回");
});

test("AI：目標死亡後不再追擊", () => {
  const c = spawnBobo();
  const target: MonsterTarget = { id: "player", x: 3, z: 0, alive: true };
  const r = run(c, 2, target);
  target.alive = false;
  const r2 = run(c, 2, target, r.now);
  assert.ok(!r2.modes.has("attack"));
  assert.equal(c.instance.currentTarget, null);
});

test("AI：攻擊/受傷動作中不移動", () => {
  const c = spawnBobo();
  const target: MonsterTarget = { id: "player", x: 5, z: 0, alive: true };
  run(c, 0.5, target);
  c.instance.receiveDamage(1);
  assert.equal(c.instance.currentState, "hit");
  const before = { ...c.instance.currentPosition };
  c.update(1 / 30, 1, target);
  assert.deepEqual({ ...c.instance.currentPosition }, before);
});

test("AI：死亡後停止行動，respawnTime 後重生", () => {
  const c = spawnBobo();
  const target: MonsterTarget = { id: "player", x: 2, z: 0, alive: true };
  let r = run(c, 1, target);
  c.instance.receiveDamage(9999);
  const pos = { ...c.instance.currentPosition };
  r = run(c, 3, target, r.now);
  assert.ok(r.modes.has("dead"));
  assert.deepEqual({ ...c.instance.currentPosition }, pos, "死亡後不移動");
  r = run(c, c.instance.definition.respawnTime, target, r.now);
  assert.ok(r.modes.has("respawn"));
  assert.equal(c.instance.currentHp, c.instance.definition.maxHp);
});

test("AI：不同怪物使用自己的數值（速度、範圍）", () => {
  const f = factory();
  const bobo = f.create("star_dew_bobo", { x: 0, y: 0, z: 0 }, { visual: false });
  const dummy = f.create("test_dummy", { x: 0, y: 0, z: 0 }, { visual: false });
  const target: MonsterTarget = { id: "player", x: 5.5, z: 0, alive: true };
  for (let i = 0; i < 20; i++) {
    bobo.update(1 / 30, i / 30, target);
    dummy.update(1 / 30, i / 30, target);
  }
  assert.ok(dummy.instance.currentPosition.x > bobo.instance.currentPosition.x, "測試方塊移速較快");
});
