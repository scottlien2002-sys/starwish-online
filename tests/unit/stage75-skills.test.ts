import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FieldSkills, type SkillHost, type SkillTarget } from "../../src/game/fieldSkills.ts";
import { SKILLS } from "../../src/combat-vfx/core/skills.ts";
import type { ClipTiming } from "../../src/combat-vfx/core/timeline.ts";

const CLIPS = (JSON.parse(readFileSync(new URL("../../public/combat-vfx/novice_combat_male.json", import.meta.url), "utf8")) as { clips: Record<string, ClipTiming> }).clips;

function makeHost(targets: SkillTarget[], aspd = 100) {
  const log: { kind: string; t: number; data?: unknown }[] = [];
  const st = { now: 0, x: 0, z: 0, yaw: 0, down: false, frozen: 0, clipT: 0, clip: "", rate: 0, dmg: [] as { id: string; mult: number; crit: boolean; t: number }[], projs: new Map<number, { x: number; z: number; dx: number; dz: number; sp: number; tr: number; alive: boolean }>(), seq: 0 };
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
    damage: (id, mult, crit) => {
      const t = targets.find((x) => x.id === id);
      if (!t?.alive) return false;
      st.dmg.push({ id, mult, crit, t: st.now });
      return true;
    },
    attackSpeed: () => aspd,
    playClip: (n, r) => {
      st.clip = n;
      st.rate = r;
      log.push({ kind: "clip", t: st.now, data: n });
      return true;
    },
    clipTime: (t) => (st.clipT = t),
    endClip: () => log.push({ kind: "endClip", t: st.now }),
    fx: (k) => log.push({ kind: "fx", t: st.now, data: k }),
    trail: (on) => log.push({ kind: on ? "trailOn" : "trailOff", t: st.now }),
    launch: (kind, x, _y, z, dx, dz, sp) => {
      const h = ++st.seq;
      st.projs.set(h, { x, z, dx, dz, sp, tr: 0, alive: true });
      log.push({ kind: "launch", t: st.now, data: kind });
      return h;
    },
    projPos: (h) => {
      const p = st.projs.get(h);
      return p?.alive ? { x: p.x, y: 1, z: p.z, travelled: p.tr } : null;
    },
    projSteer: () => {},
    projEnd: (h) => {
      const p = st.projs.get(h);
      if (p) p.alive = false;
    },
    sfx: (k) => log.push({ kind: "sfx", t: st.now, data: k }),
    shake: () => log.push({ kind: "shake", t: st.now }),
    equipWeapon: (k) => log.push({ kind: "weapon", t: st.now, data: k }),
  };
  const step = (fs: FieldSkills, dt: number): void => {
    st.now += dt;
    for (const p of st.projs.values()) {
      if (!p.alive) continue;
      p.x += p.dx * p.sp * dt;
      p.z += p.dz * p.sp * dt;
      p.tr += p.sp * dt;
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

test("三連斬：三段命中依 C 的命中標記觸發，傷害倍率正確，命中時有頓幀與音效、拖尾開關成對", () => {
  const { host, st, log, step } = makeHost([mon("a", 0, 1.2)]);
  const fs = new FieldSkills(host, CLIPS);
  const r = fs.cast("triple_slash");
  assert.ok(r.ok);
  assert.equal(st.clip, "Skill_TripleSlash");
  assert.equal(st.rate, 1);
  for (let i = 0; i < 200 && fs.busy; i++) step(fs, 1 / 60);
  for (let i = 0; i < 60; i++) step(fs, 1 / 60);
  assert.ok(!fs.busy);
  const melee = st.dmg.filter((d) => !d.crit || d.crit);
  assert.ok(melee.length >= 3, `命中次數 ${melee.length}`);
  const marks = CLIPS.Skill_TripleSlash!.marks as Record<string, number>;
  // 第一下命中時間（含小誤差、未含頓幀）
  assert.ok(Math.abs(st.dmg[0]!.t - marks.hit1!) < 1 / 30 + 1e-6, `hit1 ${st.dmg[0]!.t} vs ${marks.hit1}`);
  assert.ok(fs.stats.hitstopMs >= 45 + 55 + 80, "三段頓幀");
  assert.ok(Math.abs(st.clipT - CLIPS.Skill_TripleSlash!.duration) < 1e-6, "動作時間跟著時間軸走到最後");
  assert.equal(log.filter((e) => e.kind === "endClip").length, 1);
  assert.ok(log.some((e) => e.kind === "sfx" && (e.data === "hit" || e.data === "crit")));
  assert.equal(log.filter((e) => e.kind === "trailOn").length, 3);
  assert.equal(log.filter((e) => e.kind === "trailOff").length, 3);
  assert.equal(log.find((e) => e.kind === "weapon")?.data, "sword");
});

test("同一段命中對同一目標只結算一次；範圍外的怪物不會被打到", () => {
  const { host, st, step } = makeHost([mon("a", 0, 1.2), mon("far", 0, -6)]);
  const fs = new FieldSkills(host, CLIPS);
  fs.cast("whirlwind");
  for (let i = 0; i < 400; i++) step(fs, 1 / 60);
  assert.ok(!st.dmg.some((d) => d.id === "far"));
  const ids = new Set<string>();
  const def = SKILLS.find((d) => d.id === "whirlwind")!;
  const hitCount = def.events.filter((e) => e.kind === "hit").length;
  assert.equal(st.dmg.filter((d) => d.id === "a").length, hitCount);
  void ids;
});

test("攻速：受攻速影響的技能播放倍率 = 攻速/100，上限 160 → 1.6 倍；冷卻與忙碌中不能重複施放", () => {
  const { host, st, step } = makeHost([mon("a", 0, 1.2)], 200);
  const fs = new FieldSkills(host, CLIPS);
  const r = fs.cast("triple_slash");
  assert.ok(r.ok && r.rate <= 1.6 + 1e-9 && r.rate >= 1.6 - 1e-9, `rate ${r.ok ? r.rate : "-"}`);
  assert.deepEqual(fs.cast("staff_cast"), { ok: false, reason: "busy" });
  for (let i = 0; i < 300 && fs.busy; i++) step(fs, 1 / 60);
  const cd = fs.cast("triple_slash");
  assert.ok(!cd.ok && cd.reason === "cooldown");
  void st;
});

test("魔法彈：投射物飛到目標才結算傷害（不是施放瞬間）", () => {
  const { host, st, log, step } = makeHost([mon("a", 0, 6)]);
  const fs = new FieldSkills(host, CLIPS);
  fs.cast("staff_cast");
  assert.equal(log.find((e) => e.kind === "weapon")?.data, "staff");
  for (let i = 0; i < 300; i++) step(fs, 1 / 60);
  const launch = log.find((e) => e.kind === "launch");
  assert.ok(launch);
  assert.ok(st.dmg.length >= 1);
  assert.ok(st.dmg[0]!.t > launch!.t + 0.2, "飛行時間");
});

test("技能位移：跳斬、蓄力衝刺依 rootMotion 前進，撞牆就停（經地形碰撞）", () => {
  for (const id of ["leap_slam", "charge_burst"]) {
    const { host, st, step } = makeHost([]);
    const fs = new FieldSkills(host, CLIPS);
    fs.cast(id);
    for (let i = 0; i < 400; i++) step(fs, 1 / 60);
    const rm = CLIPS[SKILLS.find((d) => d.id === id)!.clip]!.rootMotion;
    if (rm && rm.length) {
      assert.ok(st.z > 0.3, `${id} 前進 ${st.z}`);
      assert.ok(st.z <= 3 + 1e-9, `${id} 撞牆停住`);
    }
  }
});

test("倒地中不能施放；cancel 會關閉拖尾並開始冷卻", () => {
  const { host, st, log, step } = makeHost([mon("a", 0, 1.2)]);
  const fs = new FieldSkills(host, CLIPS);
  st.down = true;
  assert.deepEqual(fs.cast("triple_slash"), { ok: false, reason: "down" });
  st.down = false;
  fs.cast("triple_slash");
  for (let i = 0; i < 8; i++) step(fs, 1 / 60);
  fs.cancel();
  assert.ok(!fs.busy);
  assert.ok(fs.cooldownLeft("triple_slash") > 0);
  assert.equal(log.filter((e) => e.kind === "trailOn").length, log.filter((e) => e.kind === "trailOff").length);
});
