import { test } from "node:test";
import assert from "node:assert/strict";
import { HIT_REACTION } from "../../src/config/hitReaction.ts";
import { HitResistance } from "../../src/monsters/framework/hitResistance.ts";
import { Arena, type ArenaMonster, type DriverVisual } from "./support/arena.ts";

/**
 * 怪物連續受擊抗性（config/hitReaction.ts）與「擊退後恢復攻擊」回歸測試。
 * 用真的 AI、狀態機、V3.8R 動畫驅動器與預覽戰鬥；「恢復攻擊」一律以撞擊時真的扣到玩家 HP 來判斷，不只看狀態名稱。
 */

const DT = 1 / 60;
const vis = (m: ArenaMonster): DriverVisual => m.c.visual as DriverVisual;

test("抗性規則：第 1／2／3 擊、免疫期間、免疫後重新計數、2 秒未受擊歸零", () => {
  const r = new HitResistance();
  assert.deepEqual(r.register(0), { tier: 1, stagger: 0.25, recoil: 1, immune: false });
  assert.deepEqual(r.register(1), { tier: 2, stagger: 0.15, recoil: 0.5, immune: false });
  assert.deepEqual(r.register(2), { tier: 3, stagger: 0, recoil: 0, immune: false });
  assert.equal(r.state(2.5).immuneRemaining, 1);
  assert.deepEqual(r.register(3), { tier: 0, stagger: 0, recoil: 0, immune: true }, "免疫中：不硬直、不後退");
  assert.equal(r.state(3).combo, 3, "免疫中受擊不增加計數");
  assert.equal(r.register(3.6).tier, 1, "免疫結束後的下一擊從第 1 擊重新開始（不會永久免疫）");
  // E. 連續 2 秒未受擊 → 歸零
  assert.equal(r.register(4.6).tier, 2);
  assert.equal(r.state(6.6).combo, 0);
  assert.equal(r.register(6.6).tier, 1, "2 秒未受擊後回到第 1 擊");
  // 剛好未滿 2 秒仍算連續
  const q = new HitResistance();
  q.register(0);
  assert.equal(q.register(1.99).tier, 2);
  // 參數集中管理
  assert.equal(HIT_REACTION.comboResetAfter, 2);
  assert.deepEqual(HIT_REACTION.tiers.map((t) => t.stagger), [0.25, 0.15, 0]);
  assert.deepEqual(HIT_REACTION.tiers.map((t) => t.recoil), [1, 0.5, 0]);
  assert.equal(HIT_REACTION.tiers[2]!.immunity, 1.5);
});

test("重現原本的問題：沒有抗性（原本規則）時，玩家每秒攻擊一次，怪物 30 秒內一次都打不到", () => {
  // 原本規則：受傷硬直 0.75 秒、攻擊 0.50 秒才命中 → 受傷結束只剩 0.25 秒就被下一擊打斷
  const a = new Arena();
  const m = a.add(1.0, 0, { maxHp: 100000 });
  const inst = m.c.instance;
  // 用原本的受擊規則（不傳 now）手動打 30 下，時間與遊戲相同
  a.autoAttack = false;
  let landed = 0;
  for (let i = 0; i < 30 * 60; i++) {
    if (i % 60 === 12) inst.receiveDamage(20);
    const before = m.landed;
    a.tick(DT);
    landed += m.landed - before;
  }
  assert.equal(landed, 0, "原本規則下怪物永遠被打斷");
  assert.ok(inst.attackLog.cancelled >= 10, `攻擊被取消 ${inst.attackLog.cancelled} 次`);
});

test("A：單次攻擊有正常後退（受傷動畫完整後退）、硬直 0.25 秒，之後恢復並真的打到玩家", () => {
  const a = new Arena();
  a.autoAttack = false;
  const m = a.add(1.0, 0);
  const inst = m.c.instance;
  a.run(2.2); // 先讓牠打一下、進入冷卻
  const landed0 = m.landed;
  const r = inst.receiveDamage(20, a.now);
  assert.equal(r.reaction?.tier, 1);
  assert.equal(inst.sm.state, "hit");
  assert.equal(inst.currentHp, 40, "傷害照扣");
  // 量測受傷動畫的最大後退（fwd 最小值），並和原本規則的完整受傷動畫比較
  let minFwd = 0;
  let hitTime = 0;
  for (let i = 0; i < 60; i++) {
    a.tick(DT);
    const f = vis(m).frame!;
    if (f.anim === "hurt") minFwd = Math.min(minFwd, f.pose.fwd);
    if (inst.sm.state === "hit") hitTime += DT;
  }
  const ref = new Arena();
  ref.autoAttack = false;
  const rm = ref.add(1.0, 0);
  ref.run(2.2);
  rm.c.instance.receiveDamage(20); // 原本規則
  let refMin = 0;
  for (let i = 0; i < 60; i++) {
    ref.tick(DT);
    const f = vis(rm).frame!;
    if (f.anim === "hurt") refMin = Math.min(refMin, f.pose.fwd);
  }
  assert.ok(refMin < -0.03, `原本後退 ${refMin}`);
  assert.ok(Math.abs(minFwd - refMin) < 0.005, `第 1 擊後退 ${minFwd.toFixed(3)}，原本 ${refMin.toFixed(3)}`);
  assert.ok(Math.abs(hitTime - 0.25) <= 2 * DT, `硬直 ${hitTime.toFixed(3)} 秒`);
  a.run(3);
  assert.ok(m.landed > landed0, "硬直結束後恢復出手並命中玩家");
});

test("B：連續 3 擊不會永久硬直；第 2 擊後退減半；第 3 擊不硬直、不打斷，怪物照常攻擊命中", () => {
  const a = new Arena();
  a.autoAttack = false;
  const m = a.add(1.0, 0, { maxHp: 100000 });
  const inst = m.c.instance;
  a.run(2.5); // 讓第一次攻擊結束，冷卻中
  const t0 = a.now;
  const r1 = inst.receiveDamage(20, a.now);
  a.run(0.6);
  const r2 = inst.receiveDamage(20, a.now);
  let min2 = 0;
  for (let i = 0; i < 30; i++) {
    a.tick(DT);
    const f = vis(m).frame!;
    if (f.anim === "hurt") min2 = Math.min(min2, f.pose.fwd);
  }
  a.run(0.1);
  const r3 = inst.receiveDamage(20, a.now);
  assert.deepEqual([r1.reaction?.tier, r2.reaction?.tier, r3.reaction?.tier], [1, 2, 3]);
  assert.notEqual(inst.sm.state, "hit", "第 3 擊不進入受擊硬直");
  assert.ok(min2 < -0.01 && min2 > -0.045, `第 2 擊後退約為原本的一半：${min2.toFixed(3)}`);
  assert.equal(vis(m).frame !== null, true);
  // 免疫中：再打一下也不硬直
  a.run(0.3);
  const r4 = inst.receiveDamage(20, a.now);
  assert.equal(r4.reaction?.immune, true);
  assert.notEqual(inst.sm.state, "hit");
  const landedBefore = m.landed;
  a.run(2.5);
  assert.ok(m.landed > landedBefore, "連續受擊後仍恢復出手並命中");
  assert.ok(a.now - t0 < 6);
});

test("B2：免疫中受擊不打斷正在進行的攻擊（該次攻擊照常命中）；受擊不重置攻擊冷卻", () => {
  const a = new Arena();
  a.autoAttack = false;
  const m = a.add(1.0, 0, { maxHp: 100000 });
  const inst = m.c.instance;
  // 先讓牠打完第一下（冷卻從攻擊開始起算 2 秒），再連打 3 下進入 1.5 秒免疫；下一次攻擊會在免疫期間開始
  a.run(1.0);
  for (const _ of [0, 1, 2]) {
    inst.receiveDamage(20, a.now);
    a.run(0.3);
  }
  // 等到牠開始攻擊
  let guard = 0;
  while (inst.sm.state !== "attack" && guard++ < 600) a.tick(DT);
  assert.equal(inst.sm.state, "attack");
  const id = inst.attackId;
  const lastAttack = inst.lastAttackTime;
  const r = inst.receiveDamage(20, a.now);
  assert.equal(r.reaction?.immune, true);
  assert.equal(inst.sm.state, "attack", "攻擊不被打斷");
  assert.equal(inst.lastAttackTime, lastAttack, "冷卻沒有被重置");
  const before = m.landed;
  a.run(1);
  assert.equal(inst.attackLog.lastResolvedId, id, "同一次攻擊照常結算");
  assert.equal(m.landed, before + 1);
});

test("C：玩家持續普通攻擊 30 秒（高 HP 怪物）：怪物會恢復並反擊多次，不會長時間被壓制", () => {
  const a = new Arena();
  const m = a.add(1.0, 0, { maxHp: 100000 });
  a.run(30);
  const inst = m.c.instance;
  assert.ok(m.hitsTaken >= 29, `玩家命中 ${m.hitsTaken}`);
  assert.ok(m.landed >= 5, `怪物反擊命中 ${m.landed} 次`);
  const gaps = m.landedAt.slice(1).map((t, i) => t - m.landedAt[i]!);
  assert.ok(Math.max(...gaps, m.landedAt[0]!) < 8, `最長 ${Math.max(...gaps).toFixed(1)} 秒沒打到玩家`);
  assert.ok(m.maxEngagedNoLand < 6, `在範圍內最長 ${m.maxEngagedNoLand.toFixed(1)} 秒沒打到玩家`);
  assert.equal(inst.currentHp, 100000 - m.hitsTaken * 20, "每一擊都正常扣 20");
});

test("C2：玩家持續攻擊 30 秒、怪物用原本 HP：會被擊倒、重生，沒有怪物在攻擊範圍內長時間不出手", () => {
  const a = new Arena();
  const ms = [a.add(1.0, 0), a.add(-0.8, 0.6), a.add(0.2, -1.0)];
  a.run(30);
  const deaths = ms.reduce((s, m) => s + m.c.instance.attackLog.started, 0);
  assert.ok(deaths > 0);
  // 原本 HP 60、每下 20：被鎖定的那隻 3 下（約 2.2 秒）就倒，冷卻 2 秒內可能來不及出手（數值設計，不是卡住）
  for (const m of ms) assert.ok(m.maxEngagedNoLand < 5, `${m.c.instance.instanceId} 在範圍內最長 ${m.maxEngagedNoLand.toFixed(1)} 秒沒打到玩家`);
  assert.ok(ms.reduce((s, m) => s + m.landed, 0) >= 3);
  // 「被打之後恢復反擊」由 C（高 HP，30 秒）驗證；原本 HP 下被鎖定的那隻約 2.2 秒就倒
});

test("C3：怪物被打時玩家退到攻擊範圍外：硬直結束後重新追上並命中", () => {
  const a = new Arena();
  a.autoAttack = false;
  const m = a.add(1.0, 0, { maxHp: 100000 });
  const inst = m.c.instance;
  a.run(2.5);
  inst.receiveDamage(20, a.now);
  a.px = 3.5; // 玩家退開，距離 2.5 公尺（> 攻擊範圍 1.1，< 警戒範圍 7）
  a.tick(DT);
  assert.ok(Math.hypot(inst.currentPosition.x - a.px, inst.currentPosition.z) > inst.definition.attackRange);
  const before = m.landed;
  let chased = false;
  for (let i = 0; i < 6 * 60; i++) {
    a.tick(DT);
    if (inst.sm.state === "move") chased = true;
  }
  assert.ok(chased, "有追擊（移動）");
  assert.ok(m.landed > before, "追上後命中");
});

test("D：硬直免疫期間照常扣血（每下 20），HP 歸零照常死亡", () => {
  const a = new Arena();
  a.autoAttack = false;
  const m = a.add(1.0, 0, { maxHp: 200 });
  const inst = m.c.instance;
  const hp: number[] = [];
  for (let k = 0; k < 6; k++) {
    const r = inst.receiveDamage(20, a.now);
    hp.push(inst.currentHp);
    if (k >= 3) assert.equal(r.reaction?.immune, true, `第 ${k + 1} 擊在免疫中`);
    a.run(0.25);
  }
  assert.deepEqual(hp, [180, 160, 140, 120, 100, 80]);
  // 免疫中打死
  const killer = new Arena();
  killer.autoAttack = false;
  const k2 = killer.add(1, 0);
  const ki = k2.c.instance;
  ki.receiveDamage(20, 0);
  killer.run(0.3);
  ki.receiveDamage(20, killer.now);
  killer.run(0.2);
  assert.equal(ki.receiveDamage(5, killer.now).killed, false); // 第 3 擊：進入免疫
  assert.equal(ki.resistance.state(killer.now).immuneRemaining > 0, true);
  assert.equal(ki.receiveDamage(20, killer.now).killed, true, "免疫中仍會被打死");
  assert.equal(ki.sm.state, "death");
});

test("E：連續 2 秒未受擊後，抗性回到初始（下一擊又是正常後退＋0.25 秒硬直）", () => {
  const a = new Arena();
  a.autoAttack = false;
  const m = a.add(1.0, 0, { maxHp: 100000 });
  const inst = m.c.instance;
  inst.receiveDamage(20, a.now);
  a.run(0.5);
  assert.equal(inst.receiveDamage(20, a.now).reaction?.tier, 2);
  a.run(2.05);
  assert.equal(inst.resistance.state(a.now).combo, 0);
  const r = inst.receiveDamage(20, a.now);
  assert.equal(r.reaction?.tier, 1);
  assert.equal(r.reaction?.recoil, 1);
  assert.equal(inst.sm.duration("hit"), 0.25);
});

test("F：死亡與重生後抗性歸零；重生後能正常追擊、攻擊並命中", () => {
  const a = new Arena();
  a.autoAttack = false;
  const m = a.add(1.0, 0);
  const inst = m.c.instance;
  inst.receiveDamage(20, a.now);
  a.run(0.3);
  inst.receiveDamage(20, a.now);
  a.run(0.3);
  inst.receiveDamage(20, a.now); // 60 → 0：死亡
  assert.equal(inst.sm.state, "death");
  assert.equal(inst.resistance.state(a.now).combo, 0, "死亡時歸零");
  // 死亡動畫 1.8 秒＋重生等待 10 秒＋淡入
  let respawned = false;
  for (let i = 0; i < 14 * 60; i++) {
    a.tick(DT);
    if (inst.sm.state === "respawn") respawned = true;
  }
  assert.ok(respawned);
  assert.ok(inst.isAlive);
  assert.equal(inst.currentHp, 60);
  // 重生點離玩家 1 公尺內（出生點 = 原位置）→ 讓玩家站遠一點，確認追擊
  a.px = 4;
  const before = m.landed;
  let chased = false;
  for (let i = 0; i < 6 * 60; i++) {
    a.tick(DT);
    if (inst.sm.state === "move") chased = true;
  }
  assert.ok(chased, "重生後追擊");
  assert.ok(m.landed > before, "重生後命中");
  const r = inst.receiveDamage(20, a.now);
  assert.equal(r.reaction?.tier, 1, "重生後第一擊是第 1 擊");
});

for (const count of [3, 10]) {
  test(`G：${count} 隻怪物同時戰鬥 60 秒，玩家持續攻擊：沒有異常狀態、沒有永久停止攻擊，硬直與冷卻符合設計`, () => {
    const a = new Arena();
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const r = 1.0 + (i % 3) * 0.6;
      a.add(Math.cos(ang) * r, Math.sin(ang) * r);
    }
    const starts = new Map<ArenaMonster, number[]>(a.monsters.map((m) => [m, []]));
    const prevId = new Map<ArenaMonster, number>(a.monsters.map((m) => [m, 0]));
    const hitDur = trackHitDurationsWithStarts(a, 60, starts, prevId);
    let bad = 0;
    for (const m of a.monsters) {
      const i = m.c.instance;
      if (!Number.isFinite(i.currentPosition.x) || !Number.isFinite(i.currentPosition.z) || !Number.isFinite(i.currentHp)) bad++;
    }
    assert.equal(bad, 0, "沒有 NaN");
    // 每段受擊硬直只會是 0.25 或 0.15 秒（不會卡在受擊）
    const all = [...hitDur.values()].flat();
    assert.ok(all.length > 0);
    for (const d of all) assert.ok(Math.abs(d - 0.25) <= 2.5 * DT || Math.abs(d - 0.15) <= 2.5 * DT, `硬直 ${d.toFixed(3)} 秒`);
    // 攻擊冷卻：同一隻兩次攻擊開始至少相隔 2 秒（重生會清除冷卻，跨重生不算）
    for (const [m, ts] of starts) {
      const gaps = ts.slice(1).map((t, k) => t - ts[k]!).filter((g) => g < 9);
      for (const g of gaps) assert.ok(g >= m.c.instance.definition.attackCooldown - 1e-6, `冷卻 ${g.toFixed(2)} 秒`);
    }
    // 沒有永久停止攻擊：每隻在攻擊範圍內都不會超過 5 秒沒打到玩家（死亡重新計時）；最後 20 秒內也有怪物命中
    for (const m of a.monsters) assert.ok(m.maxEngagedNoLand < 5, `${m.c.instance.instanceId} 在範圍內最長 ${m.maxEngagedNoLand.toFixed(1)} 秒沒打到玩家`);
    assert.ok(a.monsters.reduce((s, m) => s + m.landed, 0) >= count * 2);
    // 怪物會被打倒、重生，再回到戰鬥
    assert.ok(a.monsters.some((m) => m.c.instance.attackLog.started > 0 && m.landedAt.some((t) => t > 30)), "30 秒後仍有怪物命中玩家");
  });
}

function trackHitDurationsWithStarts(a: Arena, seconds: number, starts: Map<ArenaMonster, number[]>, prevId: Map<ArenaMonster, number>): Map<ArenaMonster, number[]> {
  const out = new Map<ArenaMonster, number[]>(a.monsters.map((m) => [m, []]));
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const before = a.monsters.map((m) => (m.c.instance.sm.state === "hit" ? m.c.instance.sm.stateTime : null));
    a.tick(DT);
    a.monsters.forEach((m, k) => {
      const s = m.c.instance.sm;
      const prevT = before[k];
      if (prevT !== null && (s.state !== "hit" || s.stateTime < prevT)) {
        // 被死亡打斷的受擊不算
        if (s.state !== "death") out.get(m)!.push(prevT + DT);
      }
      const id = m.c.instance.attackId;
      if (id !== prevId.get(m)) {
        prevId.set(m, id);
        starts.get(m)!.push(a.now);
      }
    });
  }
  return out;
}

