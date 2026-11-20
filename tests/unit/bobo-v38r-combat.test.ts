import { test } from "node:test";
import assert from "node:assert/strict";
import { createMonsterRegistry, MonsterFactory, ProceduralVisual, type IMonsterVisual } from "../../src/monsters/framework/index.ts";
import type { MonsterController } from "../../src/monsters/framework/MonsterController.ts";
import type { MonsterEffect, MonsterFace, MonsterPose, MonsterState, MonsterView } from "../../src/monsters/anim/types.ts";
import { BoboV38RAnimDriver, type BoboDriverFrame } from "../../src/monsters/star-dew-bobo-v38r/driver.ts";
import { BOBO_V38R_TIMINGS, RESPAWN_FADE } from "../../src/monsters/star-dew-bobo-v38r/profile.ts";
import { ATTACK_DURATION, ATTACK_HIT_TIME, DEATH_DURATION, HOP_PERIOD, hopAir, HURT_DURATION } from "../../src/monsters/star-dew-bobo-v38r/animation.ts";
import { PreviewCombat, PREVIEW_COMBAT } from "../../src/game/previewCombat.ts";

/**
 * Stage 5.2：星露啵啵 V3.8R 動畫與戰鬥事件整合。
 * 使用真的 MonsterInstance／狀態機／動畫器／MonsterController／V3.8R 動畫設定，
 * 視覺用和 BoboV38RVisual 相同的 BoboV38RAnimDriver（不需要 Babylon）。
 * 每個情境在正常（60 FPS）與低 FPS（20、10 FPS；遊戲 dt 上限 0.1 秒）各跑一次。
 */

class DriverVisual implements IMonsterVisual {
  readonly kind = "gltf" as const;
  readonly driver = new BoboV38RAnimDriver(0, 17, false);
  frame: BoboDriverFrame | null = null;
  entered: MonsterState[] = [];
  load(): Promise<void> {
    return Promise.resolve();
  }
  setTransform(x: number, _y: number, z: number, yaw: number): void {
    this.driver.setTransform(x, z, yaw);
  }
  onStateEnter(s: MonsterState): void {
    this.entered.push(s);
    this.driver.onStateEnter(s);
  }
  applyPose(_p: MonsterPose): void {}
  setFace(_f: MonsterFace): void {}
  playEffect(_e: MonsterEffect): void {}
  update(dt: number): void {
    this.frame = this.driver.update(dt);
  }
  dispose(): void {}
}

const nullView = (): MonsterView => ({ applyPose() {}, playEffect() {}, update() {}, dispose() {} });

function setup(ai = false) {
  const registry = createMonsterRegistry()
    .addVisual("star_dew_bobo_procedural", () => new ProceduralVisual(nullView(), () => {}))
    .addVisual("star_dew_bobo_v38r", () => new DriverVisual())
    .addVisual("test_dummy_glb", () => new ProceduralVisual(nullView(), () => {}));
  const factory = new MonsterFactory(registry);
  const v38r = (x = 0): MonsterController =>
    factory.create("star_dew_bobo", { x, y: 0, z: 0 }, { ai, modelId: "star_dew_bobo_v38r", animationProfileId: "star_dew_bobo_v38r" });
  return { factory, v38r };
}

/** 模擬 Game.updateMonsters 的一幀：先處理本幀之前到達的傷害，再更新怪物，命中時以 attackId 結算一次 */
class Sim {
  now = 0;
  playerHp = 100;
  impacts: number[] = [];
  readonly c: MonsterController;
  readonly dt: number;
  constructor(c: MonsterController, dt: number) {
    this.c = c;
    this.dt = dt;
  }
  get v(): DriverVisual {
    return this.c.visual as DriverVisual;
  }
  tick(): void {
    this.now += this.dt;
    const frame = this.c.update(this.dt, this.now, null);
    if (frame.effects.includes("attackImpact")) {
      const id = this.c.instance.claimAttackImpact();
      if (id !== null) {
        this.playerHp -= this.c.instance.definition.attack;
        this.impacts.push(id);
      }
    }
  }
  run(seconds: number): void {
    const n = Math.round(seconds / this.dt);
    for (let i = 0; i < n; i++) this.tick();
  }
  /** 執行到攻擊（或受傷）狀態時間 >= t 的那一幀為止 */
  until(pred: () => boolean, max = 10): void {
    for (let i = 0; i < max / this.dt && !pred(); i++) this.tick();
  }
}

const FPS = [
  { name: "60 FPS", dt: 1 / 60 },
  { name: "20 FPS", dt: 1 / 20 },
  { name: "10 FPS（遊戲 dt 上限）", dt: 0.1 },
];

test("V3.8R 動畫設定：時長與規則取自已驗收動畫；其他怪物沒有這些規則", () => {
  assert.equal(BOBO_V38R_TIMINGS.attack, 0.95);
  assert.equal(BOBO_V38R_TIMINGS.hit, 0.75);
  assert.equal(BOBO_V38R_TIMINGS.death, 1.8);
  assert.equal(BOBO_V38R_TIMINGS.hopPeriod, 0.62);
  assert.equal(BOBO_V38R_TIMINGS.idlePeriod, 2.6);
  assert.equal(BOBO_V38R_TIMINGS.hitInterruptsAttack, true);
  assert.equal(BOBO_V38R_TIMINGS.hitRehitLock, 0.15);
  assert.ok(RESPAWN_FADE >= 0.3 && RESPAWN_FADE <= 0.5);
  const { factory } = setup();
  const v2 = factory.create("star_dew_bobo", { x: 0, y: 0, z: 0 }, { ai: false });
  assert.equal(v2.profile.anim.timings.hitInterruptsAttack, undefined);
  assert.equal(v2.profile.anim.timings.hitRehitLock, undefined);
  const r = createMonsterRegistry();
  assert.equal(r.profile("star_dew_bobo_v38r").anim.cues.find((c) => c.effect === "attackImpact")?.at, ATTACK_HIT_TIME);
  assert.equal(r.definition("star_dew_bobo").attackCooldown, 2, "怪物攻擊冷卻維持 2 秒");
  assert.equal(r.definition("star_dew_bobo").attack, 8);
  assert.equal(PREVIEW_COMBAT.playerAttackDamage, 20);
  assert.equal(PREVIEW_COMBAT.playerAttackInterval, 1);
});

for (const { name, dt } of FPS) {
  test(`1. Idle ↔ Move：動畫跟著狀態切換；停下時先跳完這一跳再回待機（${name}）`, () => {
    const s = new Sim(setup().v38r(), dt);
    s.run(0.5);
    assert.equal(s.v.frame!.anim, "idle");
    s.c.instance.setLocomotion(true);
    s.tick();
    assert.equal(s.c.instance.sm.state, "move");
    assert.equal(s.v.frame!.anim, "move");
    s.run(1.0);
    assert.equal(s.v.frame!.anim, "move");
    s.c.instance.setLocomotion(false);
    s.tick();
    assert.equal(s.c.instance.sm.state, "idle");
    // 已驗收的銜接：最多再跳完一跳（0.62 秒）
    s.run(HOP_PERIOD + 0.05);
    assert.equal(s.v.frame!.anim, "idle");
  });

  test(`2. Move → Attack → Idle：攻擊動畫立刻開始，0.50 秒命中一次扣 8，播完回待機（${name}）`, () => {
    const s = new Sim(setup().v38r(), dt);
    s.c.instance.setLocomotion(true);
    s.run(0.3);
    assert.equal(s.v.frame!.anim, "move");
    // AI 進入攻擊：先停下再攻擊（MonsterBrain 的順序）
    s.c.instance.setLocomotion(false);
    assert.equal(s.c.instance.tryAttack(s.now).accepted, true);
    const id = s.c.instance.attackId;
    s.tick();
    assert.equal(s.c.instance.sm.state, "attack");
    assert.equal(s.v.frame!.anim, "attack", "攻擊動畫與狀態同一幀開始（不等這一跳落地）");
    assert.equal(s.v.frame!.face, "angry");
    assert.ok(Math.abs(s.v.driver.player.time - s.c.instance.sm.stateTime) < 1e-9, "動畫時間與狀態時間一致");
    s.until(() => s.impacts.length > 0, 2);
    assert.deepEqual(s.impacts, [id]);
    assert.equal(s.playerHp, 92);
    // 命中發生在狀態時間跨過 0.50 秒的那一幀
    assert.ok(s.c.instance.sm.stateTime >= ATTACK_HIT_TIME - 1e-9 && s.c.instance.sm.stateTime < ATTACK_HIT_TIME + dt + 1e-9);
    s.run(ATTACK_DURATION);
    assert.equal(s.c.instance.sm.state, "idle");
    s.run(0.35);
    assert.equal(s.v.frame!.anim, "idle");
    assert.equal(s.v.frame!.face, "normal");
    assert.deepEqual(s.impacts, [id], "一次攻擊只扣一次");
    assert.equal(s.c.instance.attackLog.duplicatesBlocked, 0);
  });

  test(`3. Attack → Hurt → Idle：命中前受傷 → 攻擊取消、不扣血、播受傷（${name}）`, () => {
    const s = new Sim(setup().v38r(), dt);
    s.c.instance.tryAttack(s.now);
    s.until(() => s.c.instance.sm.stateTime >= 0.3);
    const r = s.c.instance.receiveDamage(20);
    assert.equal(r.cancelledAttackId, s.c.instance.attackId);
    s.tick();
    assert.equal(s.c.instance.sm.state, "hit");
    assert.equal(s.v.frame!.anim, "hurt");
    assert.equal(s.v.frame!.face, "hurt");
    s.run(1.0);
    assert.equal(s.impacts.length, 0, "被打斷的攻擊不結算");
    assert.equal(s.playerHp, 100);
    assert.equal(s.c.instance.sm.state, "idle");
    assert.equal(s.v.frame!.anim, "idle");
    assert.equal(s.c.instance.attackLog.cancelled, 1);
  });

  test(`4. Attack → Death：致命傷直接死亡、取消命中、播完整 1.8 秒（${name}）`, () => {
    const s = new Sim(setup().v38r(), dt);
    s.c.instance.receiveDamage(40); // 60 → 20
    s.run(1.0);
    s.c.instance.tryAttack(s.now);
    s.until(() => s.c.instance.sm.stateTime >= 0.2);
    const r = s.c.instance.receiveDamage(20);
    assert.equal(r.killed, true);
    assert.equal(r.cancelledAttackId, s.c.instance.attackId);
    s.tick();
    assert.equal(s.c.instance.sm.state, "death");
    assert.equal(s.v.frame!.anim, "death");
    // 死亡中：攻擊、移動、傷害都被拒絕
    assert.equal(s.c.instance.tryAttack(s.now + 5).accepted, false);
    assert.equal(s.c.instance.setLocomotion(true).accepted, false);
    assert.equal(s.c.instance.receiveDamage(20).applied, false);
    let deathTime = dt;
    while (s.c.instance.sm.state === "death") {
      s.tick();
      if (s.c.instance.sm.state === "death") deathTime += dt;
      assert.ok(s.v.frame!.anim === "death" || s.v.frame!.anim === "dead", "死亡不被其他動畫覆蓋");
    }
    assert.ok(Math.abs(deathTime - DEATH_DURATION) <= dt + 1e-9, `死亡長度 ${deathTime}`);
    assert.equal(s.c.instance.sm.state, "dead");
    assert.equal(s.v.frame!.hidden, true, "死亡完成後移除（隱藏）");
    assert.equal(s.impacts.length, 0);
    assert.equal(s.v.driver.starts.death, 1, "只死亡一次");
  });

  test(`5. Hurt → Death：受傷中被致命一擊 → 立刻死亡（${name}）`, () => {
    const s = new Sim(setup().v38r(), dt);
    s.c.instance.receiveDamage(40);
    s.tick();
    assert.equal(s.v.frame!.anim, "hurt");
    s.run(0.05);
    // 鎖定時間內的致命傷也立即死亡（死亡優先）
    const r = s.c.instance.receiveDamage(20);
    assert.equal(r.killed, true);
    s.tick();
    assert.equal(s.c.instance.sm.state, "death");
    assert.equal(s.v.frame!.anim, "death");
  });

  test(`6. 命中前打斷：同一幀內「受傷先到」→ 不結算；之後也不會補扣（${name}）`, () => {
    const s = new Sim(setup().v38r(), dt);
    s.c.instance.tryAttack(s.now);
    // 推進到「下一幀就會跨過 0.50 秒」
    s.until(() => s.c.instance.sm.stateTime + dt >= ATTACK_HIT_TIME);
    assert.equal(s.impacts.length, 0);
    // 同一更新週期：傷害（玩家輸入事件）先於怪物更新處理 → 攻擊已取消
    s.c.instance.receiveDamage(20);
    s.tick();
    s.run(2);
    assert.equal(s.impacts.length, 0);
    assert.equal(s.playerHp, 100);
    assert.equal(s.c.instance.attackLog.cancelled, 1);
    assert.equal(s.c.instance.attackLog.resolved, 0);
  });

  test(`7. 命中後打斷：傷害保留、不重複扣、冷卻照原規則（${name}）`, () => {
    const s = new Sim(setup().v38r(), dt);
    const start = s.now;
    s.c.instance.tryAttack(start);
    s.until(() => s.impacts.length > 0, 2);
    assert.equal(s.playerHp, 92);
    // 同一幀內「命中先發生、受傷後到」
    const r = s.c.instance.receiveDamage(20);
    assert.equal(r.cancelledAttackId, undefined, "已結算的攻擊不算取消");
    s.tick();
    assert.equal(s.c.instance.sm.state, "hit");
    s.run(1);
    assert.equal(s.playerHp, 92, "已成立的傷害保留、不重複扣");
    // 冷卻 2 秒從攻擊開始算
    assert.equal(s.c.instance.tryAttack(start + 1.99).accepted, false);
    assert.equal(s.c.instance.tryAttack(start + 2.0).accepted, true);
  });

  test(`8. 同一次攻擊不重複扣血：重複的命中事件被 attackId 擋下（${name}）`, () => {
    const s = new Sim(setup().v38r(), dt);
    s.c.instance.tryAttack(s.now);
    s.until(() => s.impacts.length > 0, 2);
    // 模擬同一事件被送兩次
    assert.equal(s.c.instance.claimAttackImpact(), null);
    assert.equal(s.c.instance.claimAttackImpact(), null);
    s.run(ATTACK_DURATION);
    assert.equal(s.impacts.length, 1);
    assert.equal(s.playerHp, 92);
    assert.equal(s.c.instance.attackLog.duplicatesBlocked, 2);
    // 多次攻擊：每個 attackId 剛好一次
    for (let k = 0; k < 4; k++) {
      s.run(2.1);
      s.c.instance.tryAttack(s.now);
      s.run(ATTACK_DURATION + 0.1);
    }
    assert.deepEqual(s.impacts, [1, 2, 3, 4, 5]);
    assert.equal(s.playerHp, 100 - 8 * 5);
  });

  test(`9. 受傷 0.15 秒規則：鎖定內不重播但扣血；鎖定後重播（${name}）`, () => {
    const s = new Sim(setup().v38r(), dt);
    s.c.instance.receiveDamage(10); // 60 → 50
    s.tick();
    assert.equal(s.v.driver.starts.hurt, 1);
    const tLock = s.c.instance.sm.stateTime;
    if (tLock < 0.15) {
      const r = s.c.instance.receiveDamage(10);
      assert.equal(r.rehitLocked, true);
      assert.equal(s.c.instance.currentHp, 40, "鎖定內仍扣血");
      s.tick();
      assert.equal(s.v.driver.starts.hurt, 1, "鎖定內不重播");
      assert.ok(s.c.instance.sm.stateTime > tLock, "受傷沒有重新計時");
    }
    s.until(() => s.c.instance.sm.stateTime >= 0.15);
    const hp = s.c.instance.currentHp;
    const r2 = s.c.instance.receiveDamage(10);
    assert.equal(r2.rehitLocked, undefined);
    assert.equal(s.c.instance.currentHp, hp - 10);
    s.tick();
    assert.equal(s.v.driver.starts.hurt, 2, "0.15 秒後從頭重播");
    assert.ok(s.c.instance.sm.stateTime <= dt + 1e-9);
    assert.ok(s.v.driver.player.time <= dt + 1e-9);
  });
}

test("10. 三隻同場：各自獨立播放不同動畫", () => {
  const { v38r } = setup();
  const sims = [new Sim(v38r(0), 1 / 60), new Sim(v38r(2), 1 / 60), new Sim(v38r(4), 1 / 60)];
  sims[0]!.c.instance.setLocomotion(true);
  sims[1]!.c.instance.tryAttack(0);
  sims[2]!.c.instance.receiveDamage(60);
  for (let i = 0; i < 20; i++) for (const s of sims) s.tick();
  assert.deepEqual(
    sims.map((s) => s.v.frame!.anim),
    ["move", "attack", "death"],
  );
  assert.deepEqual(
    sims.map((s) => s.c.instance.sm.state),
    ["move", "attack", "death"],
  );
  assert.equal(new Set(sims.map((s) => s.v.driver)).size, 3, "每隻有自己的動畫控制器");
  assert.equal(sims[0]!.c.instance.currentHp, 60);
  assert.equal(sims[1]!.c.instance.currentHp, 60);
});

test("死亡完成後移除，10 秒後在原出生點重生，0.40 秒淡入（AI 開啟、計時從死亡動畫結束起算）", () => {
  const c = setup(true).v38r(3);
  const s = new Sim(c, 1 / 30);
  c.instance.currentPosition.x = 5; // 被打到別處
  c.instance.receiveDamage(60);
  s.until(() => c.instance.sm.state === "dead", 3);
  const deadAt = s.now;
  assert.equal(s.v.frame!.hidden, true);
  s.until(() => c.instance.sm.state === "respawn", 12);
  assert.ok(Math.abs(s.now - deadAt - 10) <= 2 * s.dt + 1e-9, `重生等待 ${s.now - deadAt}`); // AI 在進入 dead 後的下一幀開始計時（既有語意）
  assert.equal(c.instance.currentPosition.x, 3, "回到原出生點");
  assert.equal(c.instance.currentHp, 60);
  s.tick();
  const v0 = s.v.frame!.visibility;
  assert.equal(s.v.frame!.hidden, false);
  assert.ok(v0 < 0.3, `淡入開始 ${v0}`);
  assert.equal(s.v.frame!.anim, "idle", "重生以待機姿勢出現");
  assert.equal(c.instance.receiveDamage(10).applied, false, "淡入期間不受傷害");
  s.run(RESPAWN_FADE + 0.05);
  assert.equal(s.v.frame!.visibility, 1);
  assert.equal(c.instance.sm.state, "idle");
  assert.equal(s.v.frame!.starBright, 1);
  assert.equal(s.v.driver.starts.respawn, 1);
});

test("20 次死亡重生：狀態與計數正確，不會卡在死亡或重複觸發", () => {
  const c = setup(true).v38r(0);
  const s = new Sim(c, 1 / 20);
  for (let k = 0; k < 20; k++) {
    c.instance.receiveDamage(60);
    s.until(() => c.instance.sm.state === "idle", 15);
    assert.equal(c.instance.sm.state, "idle");
  }
  assert.equal(s.v.driver.starts.death, 20);
  assert.equal(s.v.driver.starts.respawn, 20);
  assert.equal(s.v.frame!.visibility, 1);
});

test("12. 其他怪物規則不變：V2 攻擊中受擊不打斷、受擊中再受擊重新計時；測試方塊相同", () => {
  const { factory } = setup();
  for (const id of ["star_dew_bobo", "test_dummy"]) {
    const c = factory.create(id, { x: 0, y: 0, z: 0 }, { ai: false });
    c.instance.tryAttack(0);
    c.update(0.1, 0.1);
    const r = c.instance.receiveDamage(1);
    assert.equal(r.overlay, true, `${id}：攻擊中受擊只疊加`);
    assert.equal(r.cancelledAttackId, undefined);
    assert.equal(c.instance.sm.state, "attack");
    for (let i = 0; i < 30; i++) c.update(0.1, 0.2 + i * 0.1);
    c.instance.receiveDamage(1);
    c.update(0.05, 3.1);
    const r2 = c.instance.receiveDamage(1);
    assert.equal(r2.rehitLocked, undefined, `${id}：沒有 0.15 秒鎖定`);
    assert.ok(c.instance.sm.stateTime < 1e-9, `${id}：受擊中再受擊重新計時`);
  }
});

test("PreviewCombat：命中只在 claimAttackImpact 成功後結算（遊戲迴圈的順序）", () => {
  const c = setup().v38r(0);
  const combat = new PreviewCombat();
  let now = 0;
  c.instance.tryAttack(now);
  let hits = 0;
  for (let i = 0; i < 20; i++) {
    now += 0.1;
    const f = c.update(0.1, now);
    for (const e of f.effects) {
      if (e === "attackImpact" && c.instance.claimAttackImpact() !== null) {
        if (combat.monsterImpact(now, c.instance, 0.5, 0) > 0) hits++;
      }
    }
  }
  assert.equal(hits, 1);
  assert.equal(combat.hp, 92);
});

test("移動同步量測：AI 1.6 m/s × 彈跳 0.62 秒 ≈ 每跳 0.99 公尺；著地滑行量（預設 vs hopSync）", () => {
  const measure = (hopSync: boolean) => {
    const d = new BoboV38RAnimDriver(0, 17, hopSync);
    const dt = 1 / 60;
    let x = 0;
    d.setTransform(0, 0, Math.PI / 2);
    d.onStateEnter("move");
    let ground = 0;
    let air = 0;
    let prevShown = 0;
    let maxLag = 0;
    const hops = 10;
    const n = Math.round((HOP_PERIOD * hops) / dt);
    for (let i = 0; i < n; i++) {
      x += 1.6 * dt;
      d.setTransform(x, 0, Math.PI / 2);
      const f = d.update(dt);
      const shown = x + f.offsetX;
      const step = shown - prevShown;
      prevShown = shown;
      if (i < Math.round(HOP_PERIOD / dt)) continue; // 第一跳不計（起步）
      const u = (d.player.time / HOP_PERIOD) % 1;
      if (hopAir(u) < 0.01 && f.pose.lift < 0.002) ground += step;
      else air += step;
      maxLag = Math.max(maxLag, Math.abs(f.offsetX));
    }
    const counted = hops - 1;
    return { perHop: (ground + air) / counted, groundPerHop: ground / counted, airPerHop: air / counted, maxLag };
  };
  const a = measure(false);
  const b = measure(true);
  console.log("[move-sync] default:", JSON.stringify(a), " hopSync:", JSON.stringify(b));
  assert.ok(Math.abs(a.perHop - 0.992) < 0.02, `每跳 ${a.perHop}`);
  assert.ok(a.groundPerHop > 0.3, "預設：著地期間仍隨 AI 等速前進（滑行）");
  assert.ok(b.groundPerHop < a.groundPerHop * 0.5, "hopSync：著地滑行明顯減少");
  assert.ok(b.maxLag <= 0.6 + 1e-9, "hopSync：畫面最多落後 0.6 公尺");
});

test("動畫完全取自已驗收曲線：受傷 0.75、攻擊 0.95 秒後播放器自然銜接", () => {
  const d = new BoboV38RAnimDriver();
  d.onStateEnter("attack");
  let t = 0;
  while (t < ATTACK_DURATION - 1e-9) {
    d.update(1 / 60);
    t += 1 / 60;
  }
  d.onStateEnter("idle");
  d.update(1 / 60);
  assert.equal(d.player.current, "idle");
  d.onStateEnter("hit");
  for (let i = 0; i < Math.ceil(HURT_DURATION * 60) + 1; i++) d.update(1 / 60);
  d.onStateEnter("move");
  const f = d.update(1 / 60);
  assert.equal(f.anim, "move", "受傷播完後若邏輯在移動，接彈跳");
});
