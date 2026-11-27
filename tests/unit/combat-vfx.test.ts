import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SKILLS, skillById } from "../../src/combat-vfx/core/skills.ts";
import { SkillTimeline, resolveAt, sampleRoot, type ClipTiming } from "../../src/combat-vfx/core/timeline.ts";
import { VFX_QUALITY, particleCount, parseTier } from "../../src/combat-vfx/core/quality.ts";
import { VfxBudget } from "../../src/combat-vfx/core/budget.ts";
import { DemoResolver, skillRate } from "../../src/combat-vfx/core/damage.ts";

const root = new URL("../../public/combat-vfx/", import.meta.url).pathname;
const anim = (g: string) => JSON.parse(readFileSync(root + `novice_combat_${g}.json`, "utf8")) as {
  joints: string[]; weaponAttach: { bone: string; bladeDir: number[]; edgeUp: number[] };
  clips: Record<string, ClipTiming & { fps: number; times: number[]; rotations: Record<string, number[]>; hipsTranslation: number[]; rootMotion: number[] }>;
};

test("動作檔：男女都有 6 個技能片段、17 關節、每格四元數長度 1", () => {
  for (const g of ["male", "female"]) {
    const a = anim(g);
    assert.equal(a.joints.length, 17);
    assert.equal(a.weaponAttach.bone, "hand.R");
    for (const s of SKILLS) {
      const c = a.clips[s.clip];
      assert.ok(c, `${g} 缺少 ${s.clip}`);
      const n = c.times.length;
      assert.equal(c.times[n - 1], c.duration);
      assert.equal(c.hipsTranslation.length, n * 3);
      assert.equal(c.rootMotion.length, n * 2);
      for (const j of a.joints) {
        const r = c.rotations[j];
        assert.equal(r.length, n * 4, `${s.clip} ${j}`);
        for (let i = 0; i < n; i++) {
          const L = Math.hypot(r[4 * i], r[4 * i + 1], r[4 * i + 2], r[4 * i + 3]);
          assert.ok(Math.abs(L - 1) < 2e-3, `${s.clip} ${j} 第 ${i} 格 |q|=${L}`);
        }
      }
    }
  }
});

test("每個技能的時間標記都能在動作檔找到，事件都在片段長度內", () => {
  const a = anim("male");
  for (const s of SKILLS) {
    const c = a.clips[s.clip];
    for (const e of s.events) {
      const ts = e.kind === "trail" ? [resolveAt(e.from, c.marks), resolveAt(e.to, c.marks)] : [resolveAt(e.at, c.marks)];
      for (const t of ts) assert.ok(t >= 0 && t <= c.duration, `${s.id} ${e.kind} ${t}`);
    }
  }
});

test("時間軸：命中事件只觸發一次、依序觸發，攻速 160 時命中提早為 1/1.6", () => {
  const a = anim("male");
  const s = skillById("triple_slash")!;
  for (const aspd of [100, 160, 250]) {
    const rate = skillRate(s.aspdScaled, aspd);
    assert.equal(rate, aspd >= 160 ? 1.6 : aspd / 100);
    const tl = new SkillTimeline(s, a.clips[s.clip], rate);
    const fired: { id: string; real: number }[] = [];
    let real = 0;
    for (let i = 0; i < 600 && !tl.done; i++) {
      real += 1 / 60;
      for (const f of tl.advance(1 / 60)) if (f.event.kind === "hit") fired.push({ id: f.event.hit.id, real });
    }
    assert.deepEqual(fired.map((f) => f.id), ["s1", "s2", "s3"]);
    const want = tl.hitTimesReal();
    // 命中格對齊：每次命中最多讓後面的事件晚 1 格（像極短的頓幀）
    for (let i = 0; i < 3; i++) assert.ok(fired[i].real - want[i].t >= -1e-9 && fired[i].real - want[i].t <= (i + 1) / 60 + 1e-9, `${aspd}: ${fired[i].real} vs ${want[i].t}`);
    assert.ok(Math.abs(tl.realDuration - 1.45 / rate) < 1e-9);
  }
});

test("打擊頓幀：時鐘停住，之後的命中時間順延", () => {
  const a = anim("male");
  const s = skillById("triple_slash")!;
  const tl = new SkillTimeline(s, a.clips[s.clip], 1);
  let real = 0;
  const hits: number[] = [];
  for (let i = 0; i < 400 && !tl.done; i++) {
    real += 1 / 120;
    for (const f of tl.advance(1 / 120))
      if (f.event.kind === "hit") {
        hits.push(real);
        tl.hitstop(f.event.hit.hitstopMs);
      }
  }
  assert.equal(hits.length, 3);
  assert.ok(hits[1] - hits[0] >= 0.5 - 0.17 + 0.045 - 0.01);
});

test("根運動：跳斬往前 1.2 m、旋風斬轉兩圈", () => {
  const a = anim("male");
  const leap = a.clips["Skill_LeapSlam"];
  assert.ok(Math.abs(sampleRoot(leap, leap.duration).forward - 1.2) < 1e-3);
  const w = a.clips["Skill_Whirlwind"];
  assert.ok(Math.abs(sampleRoot(w, w.duration).yaw - 4 * Math.PI) < 1e-3);
});

test("三段品質：粒子與預算依序遞減，低畫質關閉 GlowLayer 與第二層細節", () => {
  const h = VFX_QUALITY.high, m = VFX_QUALITY.medium, l = VFX_QUALITY.low;
  assert.ok(h.maxParticlesTotal > m.maxParticlesTotal && m.maxParticlesTotal > l.maxParticlesTotal);
  assert.ok(h.trailSegments > m.trailSegments && m.trailSegments > l.trailSegments);
  assert.equal(l.glow, false);
  assert.equal(l.secondary, false);
  assert.equal(particleCount(100, l), 25);
  assert.equal(particleCount(10000, h), h.maxParticlesPerEmitter);
  assert.equal(parseTier("x"), "medium");
});

test("多人特效預算：自己的永遠允許；其他玩家受比例上限與距離限制；次要層在壓力下先被拒絕", () => {
  const b = new VfxBudget(VFX_QUALITY.low);
  const cap = VFX_QUALITY.low.maxActiveEffects;
  const remoteMax = Math.floor(cap * b.policy.remoteShare);
  let granted = 0;
  for (let i = 0; i < 50; i++) if (b.request({ owner: "other", priority: "primary", particles: 10 }).allowed) granted++;
  assert.equal(granted, remoteMax);
  assert.equal(b.request({ owner: "self", priority: "primary", particles: 10 }).allowed, true);
  assert.equal(b.request({ owner: "other", priority: "primary", particles: 10 }).reason, "remote-share");
  const b2 = new VfxBudget(VFX_QUALITY.high);
  assert.equal(b2.request({ owner: "other", priority: "primary", particles: 10, distance: 99 }).reason, "distance");
  assert.equal(b2.request({ owner: "self", priority: "secondary", particles: 10 }).allowed, true);
  const l = new VfxBudget(VFX_QUALITY.low);
  assert.equal(l.request({ owner: "self", priority: "secondary", particles: 10 }).allowed, false);
  assert.equal(l.request({ owner: "other", priority: "critical", particles: 4 }).allowed, true);
  const g = b2.request({ owner: "self", priority: "primary", particles: 100 });
  b2.release(g.handle);
  assert.equal(b2.stats.active, 1);
});

test("傷害結算：同一次施放、同一段、同一目標只結算一次；強制暴擊", () => {
  const r = new DemoResolver(1);
  const s = skillById("charge_burst")!;
  const hit = (s.events.find((e) => e.kind === "hit") as { hit: import("../../src/combat-vfx/core/skills.ts").HitSpec }).hit;
  const a = r.resolve({ skillId: s.id, hit, attackerId: "p", targetId: "m1", castId: 7 }, 1000);
  assert.ok(a.damage > 0 && a.crit);
  const b = r.resolve({ skillId: s.id, hit, attackerId: "p", targetId: "m1", castId: 7 }, 1000);
  assert.equal(b.damage, 0);
});
