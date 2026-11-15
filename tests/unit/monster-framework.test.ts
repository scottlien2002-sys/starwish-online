import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ClipMonsterVisual,
  MonsterFactory,
  ProceduralVisual,
  createMonsterRegistry,
  validateDefinition,
  validateProfile,
  withPlaybackSpeed,
  type IMonsterVisual,
  type MonsterDefinition,
} from "../../src/monsters/framework/index.ts";
import type { MonsterController } from "../../src/monsters/framework/MonsterController.ts";
import type { MonsterEffect, MonsterFace, MonsterPose, MonsterState, MonsterView } from "../../src/monsters/anim/types.ts";
import { STAR_DEW_BOBO_PROFILE } from "../../src/monsters/star-dew-bobo/profile.ts";
import { TEST_DUMMY_CLIPS, TEST_DUMMY_PROFILE } from "../../src/monsters/test-dummy/profile.ts";
import { MONSTER_DEFINITIONS } from "../../src/config/monsters.ts";
import { MONSTER_CANON } from "../../src/core/canon.ts";

// ---------------- 假視覺（記錄所有呼叫，不需要 Babylon） ----------------

class FakeProceduralModel implements MonsterView {
  poses: MonsterPose[] = [];
  effects: MonsterEffect[] = [];
  faces: MonsterFace[] = [];
  disposed = false;
  applyPose(p: MonsterPose): void {
    this.poses.push(p);
  }
  playEffect(e: MonsterEffect): void {
    this.effects.push(e);
  }
  setFace(f: MonsterFace): void {
    this.faces.push(f);
  }
  update(): void {}
  dispose(): void {
    this.disposed = true;
  }
}

class FakeClipPlayer {
  played: { name: string; loop: boolean; speed: number }[] = [];
  stops = 0;
  readonly names: Set<string>;
  constructor(names: string[]) {
    this.names = new Set(names);
  }
  play(name: string, loop: boolean, speed: number): void {
    this.played.push({ name, loop, speed });
  }
  stopAll(): void {
    this.stops++;
  }
  has(name: string): boolean {
    return this.names.has(name);
  }
}

interface Spy {
  transforms: number[][];
  materials: number[][];
}

function setup() {
  const procedural: FakeProceduralModel[] = [];
  const clipPlayers: FakeClipPlayer[] = [];
  const spies = new Map<IMonsterVisual, Spy>();
  const registry = createMonsterRegistry()
    .addVisual("star_dew_bobo_procedural", () => {
      const model = new FakeProceduralModel();
      procedural.push(model);
      const spy: Spy = { transforms: [], materials: [] };
      const v = new ProceduralVisual(model, (x, y, z, yaw) => spy.transforms.push([x, y, z, yaw]));
      spies.set(v, spy);
      return v;
    })
    .addVisual("test_dummy_glb", (_def, profile) => {
      const player = new FakeClipPlayer(Object.values(profile.clips!).map((c) => c.name));
      clipPlayers.push(player);
      const spy: Spy = { transforms: [], materials: [] };
      const v = new ClipMonsterVisual(player, profile.clips!, {
        load: () => Promise.resolve(),
        setTransform: (x, y, z, yaw) => spy.transforms.push([x, y, z, yaw]),
        setMaterialState: (f, o, vis) => spy.materials.push([f, o, vis ? 1 : 0]),
        dispose: () => {},
      });
      spies.set(v, spy);
      return v;
    });
  return { registry, factory: new MonsterFactory(registry), procedural, clipPlayers, spies };
}

const step = (c: MonsterController, seconds: number, now0: number, dt = 1 / 60): number => {
  let now = now0;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    now += dt;
    c.update(dt, now);
  }
  return now;
};

// ---------------- 1. 怪物資料正確載入 ----------------

test("框架 1：怪物資料正確載入與驗證", () => {
  const { registry } = setup();
  const bobo = registry.definition("star_dew_bobo");
  assert.equal(bobo.name, MONSTER_CANON.star_dew_bobo, "名稱須與正式名稱一致");
  for (const k of ["monsterId", "name", "level", "maxHp", "attack", "defense", "moveSpeed", "attackRange", "aggroRange", "attackCooldown", "respawnTime", "experience", "dropTableId", "modelId", "animationProfileId"] as const) {
    assert.ok(bobo[k] !== undefined, `缺少欄位 ${k}`);
  }
  assert.equal(registry.profile(bobo.animationProfileId).kind, "procedural");
  const dummy = registry.definition("test_dummy");
  assert.equal(dummy.testOnly, true, "測試怪物必須標記 testOnly");
  assert.ok(!Object.values(MONSTER_CANON).includes(dummy.name as never), "測試怪物不得使用正式怪物名稱");
  for (const d of MONSTER_DEFINITIONS) assert.deepEqual(validateDefinition(d), [], d.monsterId);
  assert.throws(() => registry.definition("moss_horn_beast"), /找不到怪物資料/);
});

test("框架 1b：錯誤資料會被擋下", () => {
  const bad: MonsterDefinition = { ...MONSTER_DEFINITIONS[0]!, maxHp: 0, attackRange: 99 };
  const errors = validateDefinition(bad);
  assert.ok(errors.some((e) => e.includes("maxHp")));
  assert.ok(errors.some((e) => e.includes("attackRange")));
  assert.deepEqual(validateProfile(TEST_DUMMY_PROFILE), []);
  const badClips = { ...TEST_DUMMY_PROFILE, clips: { ...TEST_DUMMY_CLIPS, attack: { ...TEST_DUMMY_CLIPS.attack, loop: true } } };
  assert.ok(validateProfile(badClips).some((e) => e.includes("attack")));
});

// ---------------- 2. 同時生成多隻怪物 ----------------

test("框架 2：同時生成多隻怪物，各自獨立", () => {
  const { factory, procedural, clipPlayers } = setup();
  const list = [
    factory.create("star_dew_bobo", { x: 0, y: 0, z: 0 }, { ai: false }),
    factory.create("star_dew_bobo", { x: 5, y: 0, z: 0 }, { ai: false }),
    factory.create("star_dew_bobo", { x: 10, y: 0, z: 0 }, { ai: false }),
    factory.create("test_dummy", { x: 0, y: 0, z: 5 }, { ai: false }),
    factory.create("test_dummy", { x: 5, y: 0, z: 5 }, { ai: false }),
  ];
  assert.equal(new Set(list.map((c) => c.instance.instanceId)).size, 5, "instanceId 不重複");
  assert.equal(procedural.length, 3);
  assert.equal(clipPlayers.length, 2);
  for (const c of list) {
    assert.equal(c.instance.currentHp, c.instance.definition.maxHp);
    assert.equal(c.instance.currentState, "idle");
  }
  assert.notEqual(list[0]!.instance.sm, list[1]!.instance.sm, "每隻怪物有自己的狀態機");
});

// ---------------- 3. 各怪物動畫互不干擾 ----------------

test("框架 3：各怪物動畫互不干擾", () => {
  const { factory } = setup();
  const a = factory.create("star_dew_bobo", { x: 0, y: 0, z: 0 }, { ai: false });
  const b = factory.create("star_dew_bobo", { x: 3, y: 0, z: 0 }, { ai: false });
  a.request("attack");
  b.request("move");
  let now = 0;
  for (let i = 0; i < 20; i++) {
    now += 1 / 60;
    a.update(1 / 60, now);
    b.update(1 / 60, now);
  }
  assert.equal(a.instance.currentState, "attack");
  assert.equal(b.instance.currentState, "move");
  assert.ok(a.lastFrame!.pose.face === "angry" && b.lastFrame!.pose.face === "normal");
  b.instance.receiveDamage(999);
  assert.equal(b.instance.currentState, "death");
  assert.equal(a.instance.currentState, "attack", "b 死亡不影響 a");
});

// ---------------- 4. 攻擊冷卻 ----------------

test("框架 4：攻擊冷卻正常", () => {
  const { factory } = setup();
  const c = factory.create("star_dew_bobo", { x: 0, y: 0, z: 0 }, { ai: false });
  const m = c.instance;
  const cd = m.definition.attackCooldown;
  assert.ok(m.tryAttack(0).accepted);
  let now = step(c, m.sm.duration("attack") + 0.05, 0);
  assert.equal(m.currentState, "idle", "攻擊動畫已結束");
  const early = m.tryAttack(now);
  assert.equal(early.accepted, false);
  assert.equal(early.reason, "攻擊冷卻中");
  assert.ok(m.cooldownRemaining(now) > 0);
  now = step(c, cd, now);
  assert.ok(m.tryAttack(now).accepted, "冷卻結束後可再次攻擊");
});

// ---------------- 5. 受傷不破壞攻擊 ----------------

test("框架 5：攻擊中受傷只疊加閃白，不中斷攻擊", () => {
  const { factory } = setup();
  const c = factory.create("star_dew_bobo", { x: 0, y: 0, z: 0 }, { ai: false });
  const m = c.instance;
  m.tryAttack(0);
  step(c, 0.2, 0);
  const r = m.receiveDamage(10);
  assert.ok(r.applied && r.overlay && !r.killed);
  assert.equal(m.currentState, "attack");
  assert.equal(m.currentHp, m.definition.maxHp - 10);
  step(c, 0.05, 0.2);
  assert.ok(c.lastFrame!.pose.hitFlash > 0, "有閃白");
  assert.ok(c.lastFrame!.pose.offsetZ !== 0, "攻擊位移持續進行");
});

// ---------------- 6 & 7. 死亡中斷、死亡後不可行動 ----------------

test("框架 6/7：死亡可中斷攻擊；死亡後無法攻擊、移動、受傷", () => {
  const { factory } = setup();
  const c = factory.create("test_dummy", { x: 2, y: 0, z: 3 }, { ai: false });
  const m = c.instance;
  m.tryAttack(0);
  step(c, 0.1, 0);
  const r = m.receiveDamage(m.currentHp);
  assert.ok(r.killed);
  assert.equal(m.currentState, "death", "死亡中斷攻擊");
  assert.equal(m.tryAttack(100).accepted, false);
  assert.equal(m.setLocomotion(true).accepted, false);
  assert.equal(m.receiveDamage(5).applied, false);
  step(c, m.sm.duration("death") + 0.1, 0.1);
  assert.equal(m.currentState, "dead");
  assert.equal(m.tryAttack(200).accepted, false);
  assert.equal(m.setLocomotion(true).accepted, false);
});

// ---------------- 8. 重生恢復血量 ----------------

test("框架 8：重生恢復完整血量並回到出生點（由 AI 依 respawnTime 觸發）", () => {
  const { factory } = setup();
  const c = factory.create("star_dew_bobo", { x: 4, y: 0, z: -2 }, { ai: true });
  const m = c.instance;
  m.currentPosition.x = 9;
  m.receiveDamage(m.definition.maxHp);
  let now = step(c, m.sm.duration("death") + 0.1, 0);
  assert.equal(m.currentState, "dead");
  now = step(c, m.definition.respawnTime - 0.5, now);
  assert.equal(m.currentState, "dead", "未到重生時間");
  now = step(c, 0.7, now);
  assert.equal(m.currentState, "respawn");
  assert.equal(m.currentHp, m.definition.maxHp);
  assert.deepEqual({ ...m.currentPosition }, { x: 4, y: 0, z: -2 });
  step(c, m.sm.duration("respawn") + 0.1, now);
  assert.equal(m.currentState, "idle");
});

// ---------------- 9. 不同怪物不同動畫設定 ----------------

test("框架 9：不同怪物使用不同動畫設定", () => {
  const { factory } = setup();
  const bobo = factory.create("star_dew_bobo", { x: 0, y: 0, z: 0 }, { ai: false });
  const dummy = factory.create("test_dummy", { x: 0, y: 0, z: 0 }, { ai: false });
  assert.equal(bobo.profile.kind, "procedural");
  assert.equal(dummy.profile.kind, "clips");
  assert.notEqual(bobo.instance.sm.duration("attack"), dummy.instance.sm.duration("attack"));
  assert.ok(Math.abs(dummy.instance.sm.duration("hit") - 0.3 / 1.5) < 1e-9, "受傷 1.5 倍速");

  const impactTime = (c: MonsterController): number => {
    c.request("attack");
    let t = 0;
    for (let i = 0; i < 120; i++) {
      t += 1 / 120;
      if (c.update(1 / 120, t).effects.includes("attackImpact")) return t;
    }
    return -1;
  };
  const tb = impactTime(bobo);
  const td = impactTime(dummy);
  assert.ok(Math.abs(tb - 0.42) < 0.02, `bobo 撞擊 ${tb}`);
  assert.ok(Math.abs(td - 0.35) < 0.02, `dummy 撞擊 ${td}`);
});

test("框架 9b：播放速度設定（不影響原設定）", () => {
  const fast = withPlaybackSpeed(STAR_DEW_BOBO_PROFILE, { attack: 2 });
  assert.equal(fast.timings.attack, STAR_DEW_BOBO_PROFILE.timings.attack / 2);
  assert.equal(fast.cues.find((c) => c.effect === "attackImpact")!.at, 0.21);
  assert.deepEqual(fast.attack(0.1), STAR_DEW_BOBO_PROFILE.attack(0.2));
  assert.equal(STAR_DEW_BOBO_PROFILE.timings.attack, 0.9, "星露啵啵原設定不變");
});

test("框架：動畫完成事件", () => {
  const { factory } = setup();
  const c = factory.create("star_dew_bobo", { x: 0, y: 0, z: 0 }, { ai: false });
  c.request("hit");
  const completed: MonsterState[] = [];
  for (let i = 0; i < 60; i++) completed.push(...c.update(1 / 60, i / 60).completed);
  assert.deepEqual(completed, ["hit"]);
});

// ---------------- 10. 程式化模型與 GLB 同一介面 ----------------

test("框架 10：程式化模型與 GLB 模型透過同一介面運作", () => {
  const { factory, procedural, clipPlayers, spies } = setup();
  const p = factory.create("star_dew_bobo", { x: 1, y: 0, z: 2 }, { ai: false });
  const g = factory.create("test_dummy", { x: 3, y: 0, z: 4 }, { ai: false });
  // 同一組呼叫
  for (const c of [p, g]) {
    c.update(1 / 60, 0);
    c.request("attack");
    for (let i = 1; i <= 60; i++) c.update(1 / 60, i / 60);
    c.instance.receiveDamage(c.instance.currentHp);
    for (let i = 0; i < 120; i++) c.update(1 / 60, 1 + i / 60);
  }
  assert.equal(p.visual!.kind, "procedural");
  assert.equal(g.visual!.kind, "gltf");

  // 程式化：每幀收到姿勢（含變形）、特效
  const model = procedural[0]!;
  assert.ok(model.poses.length > 100);
  assert.ok(model.poses.some((x) => x.offsetZ > 0.5), "程式化模型收到攻擊位移");
  assert.ok(model.effects.includes("attackImpact") && model.effects.includes("deathBurst"));

  // GLB：依狀態切換動畫片段，不做程式化變形
  const names = clipPlayers[0]!.played.map((x) => x.name);
  assert.deepEqual(names.slice(0, 3), ["Idle", "Attack", "Idle"]);
  assert.ok(names.includes("Death"));
  assert.equal(clipPlayers[0]!.played.find((x) => x.name === "Idle")!.loop, true);
  assert.equal(clipPlayers[0]!.played.find((x) => x.name === "Attack")!.loop, false);
  const gs = spies.get(g.visual!)!;
  assert.ok(gs.materials.some(([, opacity]) => opacity! < 1), "GLB 死亡時透過材質淡出");
  assert.deepEqual(gs.transforms.at(-1)!.slice(0, 3), [3, 0, 4]);
  assert.deepEqual(spies.get(p.visual!)!.transforms.at(-1)!.slice(0, 3), [1, 0, 2]);
});

test("框架：銷毀時釋放模型", () => {
  const { factory, procedural } = setup();
  const c = factory.create("star_dew_bobo", { x: 0, y: 0, z: 0 });
  c.dispose();
  assert.ok(procedural[0]!.disposed);
});

test("框架：純邏輯模式（不建立模型）", () => {
  const { factory, procedural } = setup();
  const c = factory.create("star_dew_bobo", { x: 0, y: 0, z: 0 }, { visual: false });
  c.update(1 / 60, 0);
  assert.equal(c.visual, null);
  assert.equal(procedural.length, 0);
});
