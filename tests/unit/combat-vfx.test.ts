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
    assert.ok(Math.abs(tl.realDuration - a.clips[s.clip].duration / rate) < 1e-9);
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

test("多人特效預算：其他玩家的 critical（命中閃光）也受份額限制，自己的 critical 不受限", () => {
  const b = new VfxBudget(VFX_QUALITY.low);
  const cap = Math.floor(VFX_QUALITY.low.maxActiveEffects * 0.45);
  let ok = 0;
  for (let i = 0; i < 40; i++) if (b.request({ owner: "other", priority: "critical", particles: 10, distance: 3 }).allowed) ok++;
  assert.ok(ok <= cap, `remote critical granted ${ok} > ${cap}`);
  for (let i = 0; i < 40; i++) assert.ok(b.request({ owner: "self", priority: "critical", particles: 10 }).allowed);
});

// ---------------------------------------------------------------- Stage 2
import { ArenaTerrain } from "../../src/combat-vfx/core/terrain.ts";
import { behaviourForLevel, elementForLevel, wantsTarget, onDamaged } from "../../src/combat-vfx/core/monsterRules.ts";
import { CLASS_VFX } from "../../src/combat-vfx/core/classes.ts";

test("動作檔 V2.1（Stage 3 旋風斬腳步修正）：命中標記沒變（動畫、特效、傷害同步的時間來源）", () => {
  for (const g of ["male", "female"]) {
    const a = JSON.parse(readFileSync(root + `novice_combat_${g}.json`, "utf8")) as { version?: string; clips: Record<string, { marks: Record<string, number | number[]> }> };
    assert.equal(a.version, "2.1");
    assert.deepEqual(a.clips["Skill_Whirlwind"]!.marks["hit1"], 0.48);
    assert.deepEqual(a.clips["Skill_Whirlwind"]!.marks["hit3"], 1.04);
    assert.deepEqual(a.clips["Skill_TripleSlash"]!.marks["hit1"], 0.17);
    assert.deepEqual(a.clips["Skill_TripleSlash"]!.marks["hit3"], 0.92);
    assert.deepEqual(a.clips["Skill_LeapSlam"]!.marks["hit"], 0.8);
    assert.deepEqual(a.clips["Skill_ChargeBurst"]!.marks["hit"], 1.22);
  }
});

test("地形：技能根運動不能穿過岩石或場地邊界（跳躍也不行）", () => {
  const t = new ArenaTerrain(10, [{ x: 0, z: 3, r: 1 }]);
  assert.equal(t.canStand(0, 3, 0.3), false);
  assert.equal(t.canStand(0, 0, 0.3), true);
  // 往前 6 m 會穿過 (0,3) 的岩石：停在岩石前
  const p = t.clampMove({ x: 0, z: 0 }, { x: 0, z: 6 }, 0.3);
  assert.ok(p.z < 3 - 1 - 0.3 + 0.03 && p.z > 1.5, `stopped at ${p.z}`);
  // 端點在岩石後面、中間穿過：同樣被擋
  const q = t.clampMove({ x: 0, z: 0 }, { x: 0, z: 5 }, 0.3);
  assert.ok(q.z < 1.72, `jump-through blocked ${q.z}`);
  // 邊界
  const r = t.clampMove({ x: 0, z: 0 }, { x: 20, z: 0 }, 0.3);
  assert.ok(r.x <= 9.7 + 1e-6 && r.x > 9.5);
  // 沒擋到就走到底
  assert.deepEqual(t.clampMove({ x: 0, z: 0 }, { x: 2, z: 0 }, 0.3), { x: 2, z: 0 });
});

test("怪物規則：Lv1～4 被動、Lv5 以上主動；Lv1～10 無屬性；被動怪被打才反擊", () => {
  for (let lv = 1; lv <= 10; lv++) {
    assert.equal(behaviourForLevel(lv), lv <= 4 ? "passive" : "aggressive");
    assert.equal(elementForLevel(lv), "neutral");
  }
  const ag = { angry: 0 };
  assert.equal(wantsTarget(3, 1.0, ag, 4.5), false, "被動怪：靠近不攻擊");
  onDamaged(ag);
  assert.equal(wantsTarget(3, 1.0, ag, 4.5), true, "被打之後反擊");
  assert.equal(wantsTarget(5, 4.0, { angry: 0 }, 4.5), true, "主動怪：進入警戒範圍");
  assert.equal(wantsTarget(5, 6.0, { angry: 0 }, 4.5), false);
});

test("六大職業共用架構：六個職業都有動畫分類、特效家族、展示組合，且只用已存在的特效鍵值", () => {
  const ids = CLASS_VFX.map((c) => c.id).sort();
  assert.deepEqual(ids, ["blacksmith", "clown", "knight", "mage", "priest", "swordsman"]);
  for (const c of CLASS_VFX) {
    assert.ok(c.animCategories.length >= 3, c.id);
    assert.ok(c.fxFamilies.length >= 2, c.id);
    assert.ok(c.demo.length >= 1, c.id);
    for (const s of c.demoSkills) assert.ok(skillById(s), `${c.id} → ${s}`);
  }
});

test("其他玩家用的合併模型（remote LOD）：近距離 2 網格＋遠距離 2 網格、17 關節、動畫與 Lite 相同", () => {
  const glb = (f: string) => {
    const b = readFileSync(new URL(`../../public/models/${f}`, import.meta.url));
    const jl = b.readUInt32LE(12);
    return JSON.parse(b.subarray(20, 20 + jl).toString("utf8")) as { meshes: { name: string }[]; skins: { joints: number[] }[]; animations: { name: string }[]; nodes: { name?: string; mesh?: number; skin?: number }[]; asset: { extras?: { remoteLod?: { nearTris: number; farTris: number } } } };
  };
  for (const g of ["male", "female"]) {
    const lite = glb(`novice_c10b5b_${g}_lite.glb`);
    const rem = glb(`novice_c10b5b_${g}_remote.glb`);
    assert.equal(lite.meshes.length, 26);
    assert.deepEqual(rem.meshes.map((m) => m.name), ["face", "body_merged", "face_far", "body_far"]);
    // 遠近共用同一組骨架；遠距離版三角面不到近距離版的一半
    assert.ok(rem.nodes.filter((n) => n.mesh !== undefined).every((n) => n.skin === 0));
    const lod = rem.asset.extras?.remoteLod;
    assert.ok(lod && lod.farTris < lod.nearTris * 0.5, JSON.stringify(lod));
    assert.equal(rem.skins[0]!.joints.length, 17);
    assert.deepEqual(rem.skins[0]!.joints.map((i) => rem.nodes[i]!.name), lite.skins[0]!.joints.map((i) => lite.nodes[i]!.name));
    assert.deepEqual(rem.animations.map((a) => a.name), lite.animations.map((a) => a.name));
  }
});

// ---------------------------------------------------------------- Stage 3：六職業共用架構（職業套件＋技能樣板＋檢查器）
import { CLASS_KITS, REQUIRED_MARKS, ANIM_CATEGORIES, clipName, comboTemplate, chargeTemplate, projectileTemplate, aoeTemplate, buffTemplate, dashTemplate, validateSkillDef, resolveAt as resolveMark, FX_KEY_LIST, SFX_KEY_LIST, TBD } from "../../src/combat-vfx/core/classKits.ts";

test("Stage 3 職業套件：六職業齊全、片段命名一致、武器外觀一律未定案", () => {
  assert.deepEqual(CLASS_KITS.map((k) => k.id).sort(), ["blacksmith", "clown", "knight", "mage", "priest", "swordsman"]);
  for (const k of CLASS_KITS) {
    assert.ok(k.weapons.length >= 1 && k.weapons.every((w) => w.look === TBD), k.id);
    assert.ok(k.anims.length >= 4, k.id);
    for (const a of k.anims) {
      assert.equal(a.clip, clipName(k.id, a.category), `${k.id} ${a.clip}`);
      assert.match(a.clip, /^[A-Z][a-z]+_[A-Z][A-Za-z]+_\d{2}$/);
      assert.ok(ANIM_CATEGORIES.includes(a.category));
    }
    for (const s of Object.values(k.sfx)) assert.ok(SFX_KEY_LIST.includes(s), `${k.id} sfx ${s}`);
  }
  for (const c of ANIM_CATEGORIES) assert.ok(REQUIRED_MARKS[c].length >= 1, c);
  assert.ok(FX_KEY_LIST.length >= 34);
});

test("Stage 3 現有 6 個展示技能都通過檢查器（標記存在、拖尾先後、鍵值存在、時間在片段內）", () => {
  for (const g of ["male", "female"]) {
    const a = JSON.parse(readFileSync(root + `novice_combat_${g}.json`, "utf8")) as { clips: Record<string, { duration: number; marks: Record<string, number | number[]> }> };
    for (const s of SKILLS) {
      const clip = a.clips[s.clip];
      assert.ok(clip, s.clip);
      const r = validateSkillDef(s, clip);
      assert.deepEqual(r.errors, [], `${g} ${s.id}: ${r.errors.join("; ")}`);
    }
  }
  assert.equal(resolveMark("trail2.1", { trail2: [0.4, 0.55] }), 0.55);
  assert.equal(resolveMark("hit", { hit: 0.8 }), 0.8);
  assert.equal(resolveMark("nope", { hit: 0.8 }), null);
});

test("Stage 3 技能樣板：六種樣板產生的草稿可通過檢查，名稱／傷害／冷卻／武器外觀標示未定案", () => {
  const fake = (marks: Record<string, number | number[]>, duration = 2) => ({ duration, marks });
  const cases = [
    { d: comboTemplate({ id: "sw_combo", cls: "swordsman", hits: 4 }), clip: fake({ hit1: 0.2, hit2: 0.45, hit3: 0.7, hit4: 1.0, trail1: [0.1, 0.25], trail2: [0.35, 0.5], trail3: [0.6, 0.75], trail4: [0.88, 1.05] }) },
    { d: chargeTemplate({ id: "bs_charge", cls: "blacksmith" }), clip: fake({ charge: [0.05, 1.0], release: 1.0, hit: 1.15 }) },
    { d: projectileTemplate({ id: "mg_bolt", cls: "mage" }), clip: fake({ cast: 0.1, release: 0.6 }) },
    { d: aoeTemplate({ id: "pr_aoe", cls: "priest", radius: 4 }), clip: fake({ cast: 0.1, impact: 1.1 }) },
    { d: buffTemplate({ id: "kn_guard", cls: "knight", look: "shield" }), clip: fake({ cast: 0.1, apply: 0.5 }) },
    { d: dashTemplate({ id: "cl_dash", cls: "clown", distance: 3 }), clip: fake({ start: 0.1, hit: 0.3, end: 0.6 }) },
  ];
  for (const { d, clip } of cases) {
    const r = validateSkillDef(d, clip);
    assert.deepEqual(r.errors, [], `${d.id}: ${r.errors.join("; ")}`);
    assert.ok(d.draft.tbd.includes("name") && d.draft.tbd.includes("cooldown") && d.draft.tbd.includes("weaponLook"), d.id);
    assert.ok(r.warnings.some((w) => w.includes(TBD)), d.id);
    assert.ok(d.label.includes(TBD), d.label);
    assert.equal(d.classTags[0], d.draft.kit);
  }
  // 定案後覆寫：給了名稱與數值就不再標未定案（武器外觀仍未定案）
  const fixed = comboTemplate({ id: "sw_fixed", cls: "swordsman", hits: 3, label: "測試名", mult: 1.2, cooldown: 0 });
  assert.deepEqual([...fixed.draft.tbd], ["weaponLook"]);
});

test("Stage 3 檢查器：抓得到常見錯誤（缺標記、拖尾倒置、未知特效、重複命中 id、數值超範圍）", () => {
  const d = comboTemplate({ id: "bad_combo", cls: "swordsman", hits: 2 });
  const r1 = validateSkillDef(d, { duration: 1.5, marks: { hit1: 0.2, trail1: [0.3, 0.1] } });
  assert.ok(r1.errors.some((e) => e.includes("hit2")), r1.errors.join("; "));
  assert.ok(r1.errors.some((e) => e.includes("拖尾結束要晚於開始")), r1.errors.join("; "));
  const bad = { ...d, id: "Bad Id", range: -1, events: [...d.events, { kind: "fx" as const, at: 0.1, fx: "nope" as never, anchor: "self" as const }, d.events.find((e) => e.kind === "hit")!] };
  const r2 = validateSkillDef(bad);
  assert.ok(r2.errors.some((e) => e.includes("id 格式")));
  assert.ok(r2.errors.some((e) => e.includes("range")));
  assert.ok(r2.errors.some((e) => e.includes("未知特效")));
  assert.ok(r2.errors.some((e) => e.includes("命中 id 重複")));
  const r3 = validateSkillDef(chargeTemplate({ id: "late", cls: "swordsman" }), { duration: 0.5, marks: { charge: [0.0, 0.4], release: 0.4, hit: 0.9 } });
  assert.ok(r3.errors.some((e) => e.includes("超出片段長度")), r3.errors.join("; "));
});

import { SFX_KEYS, SFX_LENGTH, encodeWav, seeded } from "../../src/combat-vfx/fx/CombatAudio.ts";
test("Stage 3 音效 V2：18 種音效都有合成與長度設定、WAV 輸出格式正確、亂數可重現", () => {
  assert.deepEqual([...SFX_KEYS].sort(), [...SFX_KEY_LIST].sort());
  for (const k of SFX_KEYS) assert.ok(SFX_LENGTH[k] > 0.1 && SFX_LENGTH[k] < 2, k);
  const w = encodeWav(new Float32Array([0, 1, -1, 2]), new Float32Array([0, 0.5, -0.5, -2]), 44100);
  assert.equal(w.length, 44 + 4 * 4);
  assert.equal(String.fromCharCode(...w.subarray(0, 4)), "RIFF");
  const dv = new DataView(w.buffer);
  assert.equal(dv.getInt16(44 + 4 * 3, true), 32767);      // 超過 1 會被夾住（不會溢位成雜音）
  assert.equal(dv.getInt16(46 + 4 * 3, true), -32767);
  const a = seeded(7), b = seeded(7);
  assert.equal(a(), b());
});
