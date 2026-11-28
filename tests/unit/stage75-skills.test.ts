import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FieldSkills, type SkillHost, type SkillTarget, type SkillFxHooks } from "../../src/game/fieldSkills.ts";
import { SkillTimeline } from "../../src/combat-vfx/core/timeline.ts";
import { SKILLS } from "../../src/combat-vfx/core/skills.ts";
import type { ClipTiming } from "../../src/combat-vfx/core/timeline.ts";

const CLIPS = (JSON.parse(readFileSync(new URL("../../public/combat-vfx/novice_combat_male.json", import.meta.url), "utf8")) as { clips: Record<string, ClipTiming> }).clips;

function makeHost(targets: SkillTarget[], aspd = 100, useDriver = false) {
  const log: { kind: string; t: number; data?: unknown }[] = [];
  const st = { now: 0, x: 0, z: 0, yaw: 0, down: false, clipT: 0, clip: "", dmg: [] as { id: string; mult: number; crit: boolean; t: number; ground: boolean; sfx?: string }[], drivers: [] as { tl: SkillTimeline; hooks: SkillFxHooks; cancelled: boolean }[] };
  const host: SkillHost = {
    now: () => st.now,
    player: () => ({ x: st.x, y: 0, z: st.z, yaw: st.yaw, down: st.down }),
    setYaw: (y) => (st.yaw = y),
    move: (dx, dz) => {
      // 測試地形：z > 3 是牆
      const nz = Math.min(3, st.z + dz);
      const d = Math.hypot(dx, nz - st.z);
      st.x += dx;
      st.z = nz;
      return d;
    },
    targets: () => targets,
    damage: (id, mult, crit, hit) => {
      const t = targets.find((x) => x.id === id);
      if (!t?.alive) return false;
      st.dmg.push({ id, mult, crit, t: st.now, ground: !!hit.ground, sfx: hit.sfx });
      return true;
    },
    attackSpeed: () => aspd,
    playClip: (n) => {
      st.clip = n;
      log.push({ kind: "clip", t: st.now, data: n });
      return true;
    },
    clipTime: (t) => (st.clipT = t),
    endClip: () => log.push({ kind: "endClip", t: st.now }),
    equipWeapon: (k) => log.push({ kind: "weapon", t: st.now, data: k }),
    // useDriver：模擬 C 的 CombatFx.playSkill（CombatFx 推進時間軸並呼叫 hooks）
    startFx: (def, clip, rate, hooks) => {
      if (!useDriver) return null;
      const d = { tl: new SkillTimeline(def, clip, rate), hooks, cancelled: false };
      st.drivers.push(d);
      log.push({ kind: "fx", t: st.now, data: def.id });
      return { timeline: d.tl, hitstop: (ms: number) => d.tl.hitstop(ms), cancel: () => (d.cancelled = true), get done() { return d.tl.done || d.cancelled; } };
    },
  };
  const step = (fs: FieldSkills, dt: number): void => {
    st.now += dt;
    // CombatFx.update（先）：推進時間軸、送出命中／投射物事件
    for (const d of st.drivers) {
      if (d.cancelled || d.tl.done) continue;
      for (const e of d.tl.advance(dt)) {
        if (e.event.kind === "hit") d.hooks.onHit(e.event.hit, e.t);
        else if (e.event.kind === "projectile") d.hooks.onProjectile(e.event, null, e.t);
      }
      if (d.tl.done) d.hooks.onEnd();
    }
    fs.update(dt);
  };
  return { host, st, log, step };
}

const mon = (id: string, x: number, z: number): SkillTarget => ({ id, x, z, r: 0.4, h: 0.8, alive: true });

test("技能：六段技能都有對應的動作片段與時間標記", () => {
  assert.equal(SKILLS.length, 6);
  for (const d of SKILLS) {
    assert.ok(CLIPS[d.clip], d.clip);
    assert.ok(CLIPS[d.clip]!.duration > 0.5);
  }
});

for (const useDriver of [false, true]) {
  const via = useDriver ? "（C 的 CombatFx 推進時間軸）" : "（沒有特效系統，自己推進）";

  test(`三連斬${via}：三段命中依 C 的命中標記觸發、頓幀、動作時間跟著時間軸`, () => {
    const { host, st, log, step } = makeHost([mon("a", 0, 1.2)], 100, useDriver);
    const fs = new FieldSkills(host, CLIPS);
    const r = fs.cast("triple_slash");
    assert.ok(r.ok && r.rate === 1);
    assert.equal(st.clip, "Skill_TripleSlash");
    for (let i = 0; i < 200 && fs.busy; i++) step(fs, 1 / 60);
    for (let i = 0; i < 60; i++) step(fs, 1 / 60);
    assert.ok(!fs.busy);
    assert.ok(st.dmg.length >= 3, `命中次數 ${st.dmg.length}`);
    const marks = CLIPS.Skill_TripleSlash!.marks as Record<string, number>;
    assert.ok(Math.abs(st.dmg[0]!.t - marks.hit1!) < 1 / 30 + 1e-6, `hit1 ${st.dmg[0]!.t} vs ${marks.hit1}`);
    assert.ok(fs.stats.hitstopMs >= 45 + 55 + 80, "三段頓幀");
    assert.ok(Math.abs(st.clipT - CLIPS.Skill_TripleSlash!.duration) < 1e-6, "動作時間跟著時間軸走到最後");
    assert.equal(log.filter((e) => e.kind === "endClip").length, 1);
    assert.equal(log.find((e) => e.kind === "weapon")?.data, "sword");
    assert.equal(fs.stats.viaCombatFx, useDriver ? 1 : 0);
    assert.ok(st.dmg.every((d) => d.sfx), "命中音效交給 CombatFx.hit（每次命中一個）");
  });

  test(`同一段命中對同一目標只結算一次；範圍外不會被打到${via}`, () => {
    const { host, st, step } = makeHost([mon("a", 0, 1.2), mon("far", 0, -6)], 100, useDriver);
    const fs = new FieldSkills(host, CLIPS);
    fs.cast("whirlwind");
    for (let i = 0; i < 400; i++) step(fs, 1 / 60);
    assert.ok(!st.dmg.some((d) => d.id === "far"));
    const def = SKILLS.find((d) => d.id === "whirlwind")!;
    assert.equal(st.dmg.filter((d) => d.id === "a").length, def.events.filter((e) => e.kind === "hit").length);
  });

  test(`魔法彈：投射物飛到目標才結算傷害${via}`, () => {
    const { host, st, log, step } = makeHost([mon("a", 0, 6)], 100, useDriver);
    const fs = new FieldSkills(host, CLIPS);
    fs.cast("staff_cast");
    assert.equal(log.find((e) => e.kind === "weapon")?.data, "staff");
    for (let i = 0; i < 300; i++) step(fs, 1 / 60);
    assert.equal(fs.stats.projectiles, 1);
    assert.ok(st.dmg.length >= 1);
    const release = (CLIPS.Skill_StaffCast!.marks as Record<string, number>).release!;
    assert.ok(st.dmg[0]!.t > release + 0.2, `飛行時間 ${st.dmg[0]!.t}`);
  });

  test(`流星：落地時範圍判定，多隻只出現一次地面衝擊與音效${via}`, () => {
    const { host, st, step } = makeHost([mon("a", 0, 5), mon("b", 0.8, 5.3), mon("far", 6, 5)], 100, useDriver);
    const fs = new FieldSkills(host, CLIPS);
    fs.cast("star_meteor");
    for (let i = 0; i < 400; i++) step(fs, 1 / 60);
    const hit = st.dmg.filter((d) => d.id === "a" || d.id === "b");
    assert.equal(hit.length, 2, JSON.stringify(st.dmg));
    assert.ok(!st.dmg.some((d) => d.id === "far"));
    assert.equal(hit.filter((d) => d.ground).length, 1);
    assert.equal(hit.filter((d) => d.sfx).length, 1);
  });
}

test("攻速：受攻速影響的技能播放倍率上限 1.6 倍；冷卻與忙碌中不能重複施放", () => {
  const { host, step } = makeHost([mon("a", 0, 1.2)], 200, true);
  const fs = new FieldSkills(host, CLIPS);
  const r = fs.cast("triple_slash");
  assert.ok(r.ok && Math.abs(r.rate - 1.6) < 1e-9, `rate ${r.ok ? r.rate : "-"}`);
  assert.deepEqual(fs.cast("staff_cast"), { ok: false, reason: "busy" });
  for (let i = 0; i < 300 && fs.busy; i++) step(fs, 1 / 60);
  const cd = fs.cast("triple_slash");
  assert.ok(!cd.ok && cd.reason === "cooldown");
});

test("技能位移：跳斬、蓄力衝刺依 rootMotion 前進，撞牆就停（經地形碰撞）", () => {
  for (const id of ["leap_slam", "charge_burst"]) {
    const { host, st, step } = makeHost([], 100, true);
    const fs = new FieldSkills(host, CLIPS);
    fs.cast(id);
    for (let i = 0; i < 400; i++) step(fs, 1 / 60);
    assert.ok(st.z > 0.3, `${id} 前進 ${st.z}`);
    assert.ok(st.z <= 3 + 1e-9, `${id} 撞牆停住`);
  }
});

test("倒地中不能施放；cancel 會中斷 CombatFx 畫面並開始冷卻", () => {
  const { host, st, log, step } = makeHost([mon("a", 0, 1.2)], 100, true);
  const fs = new FieldSkills(host, CLIPS);
  st.down = true;
  assert.deepEqual(fs.cast("triple_slash"), { ok: false, reason: "down" });
  st.down = false;
  fs.cast("triple_slash");
  for (let i = 0; i < 8; i++) step(fs, 1 / 60);
  fs.cancel();
  assert.ok(!fs.busy);
  assert.ok(fs.cooldownLeft("triple_slash") > 0);
  assert.ok(st.drivers[0]!.cancelled);
  assert.equal(log.filter((e) => e.kind === "endClip").length, 1);
});
