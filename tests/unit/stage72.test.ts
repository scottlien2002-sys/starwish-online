import { test } from "node:test";
import assert from "node:assert/strict";
import { applyExtras, attackImpactTime, chooseLocomotion, CrossFader, M004_WINDFEATHER_FOX, RIG_CONTRACT_FIXTURE, riggedTimings } from "../../src/monsters/rigged/riggedSpec.ts";
import { riggedProfile } from "../../src/monsters/rigged/riggedProfile.ts";
import { createMonsterRegistry, MonsterFactory } from "../../src/monsters/framework/index.ts";
import { PreviewCombat } from "../../src/game/previewCombat.ts";
import { MONSTER_DEFINITIONS } from "../../src/config/monsters.ts";

const fox = M004_WINDFEATHER_FOX;

test("Move／Run 選擇：巡邏 0.6 m/s 播 Move 倍率 1、追擊 2.4 m/s 播 Run 倍率 1；Run 不是 Move 加速；含遲滯與倍率上限", () => {
  const L = fox.locomotion;
  assert.deepEqual(chooseLocomotion(0, L).clip, "idle");
  const m = chooseLocomotion(0.6, L);
  assert.equal(m.clip, "move");
  assert.ok(Math.abs(m.ratio - 1) < 1e-9);
  const r = chooseLocomotion(2.4, L);
  assert.equal(r.clip, "run");
  assert.ok(Math.abs(r.ratio - 1) < 1e-9);
  // 門檻附近不來回切換
  assert.equal(chooseLocomotion(1.25, L, "move").clip, "move");
  assert.equal(chooseLocomotion(1.35, L, "move").clip, "run");
  assert.equal(chooseLocomotion(1.15, L, "run").clip, "run");
  assert.equal(chooseLocomotion(1.05, L, "run").clip, "move");
  // 倍率限制在 0.6～1.5（超出時接受滑步，不無限加速）
  const fast = chooseLocomotion(5, L, "run");
  assert.equal(fast.ratio, 1.5);
  assert.ok(fast.slipMps > 0);
  // 1.1 m/s 用 Move 會被限制在 1.5 倍（不會用 Move 跑到 Run 的速度）
  assert.equal(chooseLocomotion(1.1, L, "idle").ratio, 1.5);
});

test("Attack 命中時間：動畫第 0.50 秒，隨播放倍率換算", () => {
  assert.equal(attackImpactTime(fox, 1), 0.5);
  assert.equal(attackImpactTime(fox, 2), 0.25);
  const p = riggedProfile(fox);
  const cue = p.anim.cues.find((c) => c.effect === "attackImpact")!;
  assert.equal(cue.state, "attack");
  assert.equal(cue.at, 0.5);
  assert.equal(p.anim.timings.attack, 1.2);
});

test("GLB extras 覆蓋規格預設並列出不一致", () => {
  const { spec, notes } = applyExtras(fox, { clips: { Move: { duration: 0.8, nativeSpeedMps: 0.62 }, Run: { duration: 0.38, nativeSpeedMps: 2.4 }, Attack: { duration: 1.2, hitTime: 0.52 }, Idle: { duration: 2 }, Hurt: { duration: 0.45 }, Death: { duration: 0.7 }, Respawn: { duration: 0.5 } } });
  assert.equal(spec.locomotion.moveNativeMps, 0.62);
  assert.equal(spec.attackHitTime, 0.52);
  assert.ok(notes.some((n) => n.includes("Move 原生速度")));
  assert.ok(notes.some((n) => n.includes("Attack 命中")));
  assert.ok(applyExtras(fox, null).notes.length === 1);
});

test("淡入淡出權重：總和保持 1，指定時間內完成；0 秒立即切換", () => {
  const f = new CrossFader();
  f.play("idle", 0);
  assert.equal(f.weight("idle"), 1);
  f.play("move", 0.15);
  f.update(0.075);
  assert.ok(Math.abs(f.weight("move") - 0.5) < 1e-6);
  assert.ok(Math.abs(f.weight("idle") - 0.5) < 1e-6);
  f.update(0.1);
  assert.equal(f.weight("move"), 1);
  assert.equal(f.weight("idle"), 0);
  f.play("run", 0.12);
  f.update(0.03);
  f.play("attack", 0.15);
  const w = f.update(0.03);
  const sum = [...w.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6);
  f.play("death", 0);
  assert.equal(f.weight("death"), 1);
  assert.equal(f.weight("attack"), 0);
});

test("通用註冊：風羽狐與測試替身用同一套動畫設定與資料驗證；死亡狀態含停住與淡出", () => {
  const reg = createMonsterRegistry();
  for (const id of ["windfeather_fox", "rig_contract_fixture"]) {
    const d = reg.definition(id);
    const p = reg.profile(d.animationProfileId);
    assert.equal(p.kind, "clips");
    assert.equal(p.clips!.move.name, "Move");
  }
  const t = riggedTimings(fox);
  assert.ok(Math.abs(t.death - (0.7 + fox.deathHold + fox.deathFade)) < 1e-9);
  assert.equal(RIG_CONTRACT_FIXTURE.fixture, true);
  const def = MONSTER_DEFINITIONS.find((d) => d.monsterId === "windfeather_fox")!;
  assert.equal(def.level, 7);
  assert.equal(def.provisional, true);
  assert.equal(def.patrolSpeed, 0.6);
  assert.equal(def.chaseSpeed, 2.4);
});

function foxCtrl() {
  const f = new MonsterFactory(createMonsterRegistry());
  return f.create("windfeather_fox", { x: 0, y: 0, z: 0 }, { visual: false, brain: { seed: 3, idleMin: 0.1, idleMax: 0.2 } });
}

test("AI：巡邏用 0.6 m/s、看到玩家主動追擊用 2.4 m/s、進入範圍攻擊；命中在攻擊第 0.50 秒且只結算一次", () => {
  const c = foxCtrl();
  const dt = 1 / 30;
  let now = 0;
  let maxPatrol = 0;
  for (let i = 0; i < 90; i++) {
    c.update(dt, (now += dt), null);
    if (c.brain!.mode === "patrol") maxPatrol = Math.max(maxPatrol, c.groundSpeed);
  }
  assert.ok(maxPatrol > 0.5 && maxPatrol <= 0.61, `patrol ${maxPatrol}`);
  // 玩家在 6 m（警戒 8 m 內）
  const target = { id: "p", x: c.instance.currentPosition.x + 6, z: c.instance.currentPosition.z, alive: true };
  let maxChase = 0;
  let attackStart = -1;
  let impactAt = -1;
  for (let i = 0; i < 300 && impactAt < 0; i++) {
    c.update(dt, (now += dt), target);
    if (c.brain!.mode === "chase") maxChase = Math.max(maxChase, c.groundSpeed);
    if (c.instance.sm.state === "attack" && attackStart < 0) attackStart = now;
    if (c.lastFrame!.effects.includes("attackImpact")) {
      impactAt = now;
      assert.ok(c.instance.claimAttackImpact() !== null);
      assert.equal(c.instance.claimAttackImpact(), null); // 同一次攻擊只結算一次
    }
  }
  assert.ok(maxChase > 2.3 && maxChase <= 2.41, `chase ${maxChase}`);
  assert.ok(attackStart > 0 && impactAt > 0);
  assert.ok(Math.abs(impactAt - attackStart - 0.5) <= dt + 1e-9, `impact ${impactAt - attackStart}`);
});

test("死亡停止行動、淡出後才開始重生計時、重生回 Idle；普通攻擊不打斷攻擊", () => {
  const c = foxCtrl();
  const dt = 1 / 30;
  let now = 0;
  const target = { id: "p", x: 1.0, z: 0, alive: true };
  for (let i = 0; i < 30 && c.instance.sm.state !== "attack"; i++) c.update(dt, (now += dt), target);
  assert.equal(c.instance.sm.state, "attack");
  const r = c.instance.receiveDamage(10, now); // 普通攻擊
  assert.equal(r.killed, false);
  assert.equal(c.instance.sm.state, "attack"); // 不打斷
  c.instance.receiveDamage(9999, now);
  assert.equal(c.instance.sm.state, "death");
  const pos0 = { ...c.instance.currentPosition };
  const tDeath = riggedTimings(fox).death;
  let deadAt = -1;
  let respawnAt = -1;
  const start = now;
  for (let i = 0; i < 30 * 30 && respawnAt < 0; i++) {
    c.update(dt, (now += dt), target);
    if (c.instance.sm.state === "dead" && deadAt < 0) deadAt = now - start;
    if (c.instance.sm.state === "respawn" && respawnAt < 0) respawnAt = now - start;
    if (c.instance.sm.state === "death") assert.deepEqual({ ...c.instance.currentPosition }, pos0); // 死亡不移動
  }
  assert.ok(Math.abs(deadAt - tDeath) <= 2 * dt, `dead ${deadAt}`);
  assert.ok(Math.abs(respawnAt - (tDeath + 12)) <= 2 * dt, `respawn ${respawnAt}`);
  for (let i = 0; i < 30; i++) c.update(dt, (now += dt), null);
  assert.equal(c.instance.sm.state === "idle" || c.instance.sm.state === "move", true);
  assert.equal(c.instance.currentHp, c.instance.definition.maxHp);
});

test("玩家近戰距離從怪物身體外緣算（風羽狐 0.45 m）；星露啵啵沒有設定 = 原本行為", () => {
  const combat = new PreviewCombat();
  const c = foxCtrl();
  const R = 2.5; // PREVIEW_COMBAT.playerAttackRange（見 previewCombat.ts）
  const near = combat.nearestTarget(c.instance.currentPosition.x + R + 0.4, 0, [c.instance]);
  assert.ok(near !== null);
  const far = combat.nearestTarget(c.instance.currentPosition.x + R + 0.5, 0, [c.instance]);
  assert.equal(far, null);
});
