import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTACK_DURATION, ATTACK_TIMING, AttackAnimator } from "../../src/actors/attackAnim.ts";
import { PREVIEW_COMBAT, PreviewCombat } from "../../src/game/previewCombat.ts";
import { createMonsterRegistry, MonsterFactory, ProceduralVisual } from "../../src/monsters/framework/index.ts";
import type { MonsterController } from "../../src/monsters/framework/MonsterController.ts";
import type { MonsterView } from "../../src/monsters/anim/types.ts";

/**
 * Stage 5.2P：玩家攻擊動畫與命中同步（60、30、15 FPS）。
 * 依 Game.ts 每幀的順序模擬：時間前進 → 玩家動作更新 → 揮中結算（resolvePending）→ 怪物更新。
 * 按下攻擊發生在兩幀之間（觸控事件），使用上一幀的遊戲時間。
 * 目標是真正的星露啵啵 V3.8R 實例（V3.8R 動畫設定）。
 */

const nullView = (): MonsterView => ({ applyPose() {}, playEffect() {}, update() {}, dispose() {} });

function world(dt: number) {
  const registry = createMonsterRegistry().addVisual("star_dew_bobo_v38r", () => new ProceduralVisual(nullView(), () => {}));
  const factory = new MonsterFactory(registry);
  const bobo = (x: number, z: number): MonsterController =>
    factory.create("star_dew_bobo", { x, y: 0, z }, { ai: false, modelId: "star_dew_bobo_v38r", animationProfileId: "star_dew_bobo_v38r" });
  const monsters = [bobo(0, 1.5), bobo(3, 0)];
  const combat = new PreviewCombat();
  const anim = new AttackAnimator();
  const player = { x: 0, z: 0 };
  const hits: { now: number; elapsed: number; phase: string; ok: boolean; reason?: string }[] = [];
  let now = 0;
  const frame = (): void => {
    now += dt;
    const pose = anim.update(dt); // PlayerAvatar.update
    const h = combat.resolvePending(now, player.x, player.z, monsters.map((m) => m.instance)); // updateMonsters 開頭
    if (h) hits.push({ now, elapsed: anim.elapsed, phase: pose.phase, ok: h.ok, ...(h.ok ? {} : { reason: h.reason }) });
    for (const m of monsters) m.update(dt, now);
  };
  /** 與 Game.playerAttack 相同：通過檢查才播放動作；命中時間 ATTACK_TIMING.hit（浮點安全） */
  const press = () => {
    const r = combat.startAttack(now, player.x, player.z, monsters.map((m) => m.instance), ATTACK_TIMING.hit - 1e-6);
    if (r.ok) anim.start();
    return r;
  };
  const run = (seconds: number): void => {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) frame();
  };
  return { monsters, combat, anim, player, hits, frame, press, run, get now() { return now; } };
}

const FPS = [
  { name: "60 FPS", dt: 1 / 60 },
  { name: "30 FPS", dt: 1 / 30 },
  { name: "15 FPS", dt: 1 / 15 },
];

test("數值不變：傷害 20、間隔 1 秒、範圍 2.5、命中 0.20 秒、動畫 0.50 秒（蓄力 0.14／揮擊 0.12／收招 0.24）", () => {
  assert.equal(PREVIEW_COMBAT.playerAttackDamage, 20);
  assert.equal(PREVIEW_COMBAT.playerAttackInterval, 1);
  assert.equal(PREVIEW_COMBAT.playerAttackRange, 2.5);
  assert.deepEqual({ ...ATTACK_TIMING }, { windup: 0.14, strike: 0.12, recover: 0.24, hit: 0.2 });
  assert.ok(Math.abs(ATTACK_DURATION - 0.5) < 1e-12);
});

for (const { name, dt } of FPS) {
  test(`單次攻擊：按下不扣血，揮擊中（約 0.20 秒）扣 20 一次，動畫完整播完（${name}）`, () => {
    const w = world(dt);
    w.run(0.5);
    const target = w.monsters[0]!.instance;
    const r = w.press();
    assert.equal(r.ok, true);
    assert.equal(target.currentHp, 60, "按下瞬間不扣血");
    const phases: string[] = [];
    for (let i = 0; i < Math.ceil(0.6 / dt); i++) {
      w.frame();
      const p = w.anim.pose().phase;
      if (p !== "idle" && phases[phases.length - 1] !== p) phases.push(p);
    }
    assert.deepEqual(phases, ["windup", "strike", "recover"]);
    assert.equal(w.hits.length, 1, "只結算一次");
    const h = w.hits[0]!;
    assert.equal(h.ok, true);
    assert.equal(h.phase, "strike", "命中發生在揮擊階段");
    assert.ok(h.elapsed >= 0.2 - 1e-6 && h.elapsed < 0.2 + dt, `命中時動畫時間 ${h.elapsed}`);
    assert.equal(target.currentHp, 40);
    assert.equal(w.anim.active, false, "播完回到待機");
  });

  test(`連續攻擊：冷卻 1 秒內再按不重播、不扣血；5 秒遊戲時間剛好 5 次命中（${name}）`, () => {
    const w = world(dt);
    w.monsters[0]!.instance.currentHp = 1000; // 只為了能連續打 5 下（測試用，不是遊戲數值）
    let starts = 0;
    for (let i = 0; i < Math.round(5 / dt); i++) {
      const r = w.press(); // 每一幀都按（連打）
      if (r.ok) starts++;
      w.frame();
    }
    assert.equal(starts, 5, "攻擊速度與 FPS 無關：每 1 秒一次");
    assert.equal(w.anim.started, 5);
    assert.equal(w.hits.length, 5);
    assert.ok(w.hits.every((h) => h.ok && h.phase === "strike"));
    assert.equal(w.monsters[0]!.instance.currentHp, 1000 - 5 * 20, "每次攻擊只扣一次 20");
  });

  test(`目標在命中前死亡 → 取消傷害，動作照常收招（${name}）`, () => {
    const w = world(dt);
    const t = w.monsters[0]!.instance;
    w.press();
    w.frame();
    t.receiveDamage(999); // 被別的來源打倒
    const hpAfterDeath = t.currentHp;
    w.run(0.6);
    assert.equal(w.hits.length, 1);
    assert.equal(w.hits[0]!.ok, false);
    assert.equal(w.hits[0]!.reason, "miss");
    assert.equal(t.currentHp, hpAfterDeath);
    assert.equal(w.anim.started, 1);
    assert.equal(w.anim.active, false, "收招完成");
  });

  test(`目標在命中前離開「範圍＋0.6 公尺」→ 未命中；在範圍內移動仍命中（${name}）`, () => {
    const w = world(dt);
    const t = w.monsters[0]!.instance;
    w.press();
    w.frame();
    t.currentPosition.z = 2.5 + 0.6 + 0.05; // 超過 3.1 公尺
    w.run(0.6);
    assert.equal(w.hits[0]!.ok, false);
    assert.equal(t.currentHp, 60);
    w.run(1.0);
    t.currentPosition.z = 1.5;
    w.press();
    w.frame();
    t.currentPosition.z = 3.0; // 離開 2.5 但在 3.1 內
    w.run(0.6);
    assert.equal(w.hits[1]!.ok, true);
    assert.equal(t.currentHp, 40);
  });

  test(`玩家倒地：取消未揮中的攻擊；倒地中不能攻擊（${name}）`, () => {
    const w = world(dt);
    w.press();
    w.frame();
    w.combat.debugKnockDown(w.now);
    w.run(0.6);
    assert.equal(w.hits.length, 0);
    assert.equal(w.monsters[0]!.instance.currentHp, 60);
    const r = w.press();
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, "down");
  });

  test(`星露啵啵 V3.8R 規則不受影響：玩家命中時才受傷；命中前的攻擊被打斷取消（${name}）`, () => {
    const w = world(dt);
    const m = w.monsters[0]!;
    m.instance.tryAttack(w.now);
    w.frame();
    assert.equal(m.instance.sm.state, "attack");
    w.press();
    // 玩家按下後、揮中前：怪物仍在攻擊
    for (let i = 0; i < Math.floor((0.2 - 1e-6) / dt) - 1; i++) w.frame();
    assert.equal(m.instance.sm.state, "attack");
    // 揮中那一幀：玩家傷害先結算 → 怪物受傷、攻擊取消（攻擊 0.50 秒命中尚未到）
    w.run(dt * 2);
    assert.equal(m.instance.sm.state, "hit");
    assert.equal(m.instance.attackLog.cancelled, 1);
    assert.equal(m.instance.attackLog.resolved, 0);
    assert.equal(m.instance.currentHp, 40);
  });
}
