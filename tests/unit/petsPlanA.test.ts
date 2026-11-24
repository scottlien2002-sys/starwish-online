// 寵物方案 A（企劃 2026-11-24 確認）：首次鑑定後詞條種類與原始數值永久保留，進化只提升發揮比例；
// 正負詞條同一個比例。這裡的培育數值是 preview 暫定值（未定案，可在 pets.json 調整）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRng } from "../../src/core/rng.ts";
import {
  applyPetBonus,
  appraisePet,
  bonusScale,
  equip,
  equippedPet,
  evolve,
  feedPet,
  newSave,
  parseSave,
  resolveTuning,
  startHatch,
  tickPet,
  type CharacterStats,
  type PetAffix,
  type PetConfig,
  type PetSave,
} from "../../src/pets/petSystem.ts";

const cfg = JSON.parse(readFileSync(new URL("../../src/config/pets.json", import.meta.url), "utf8")) as PetConfig;
const T = resolveTuning(cfg, "preview");
const BASE: CharacterStats = { attack: 100, attackSpeed: 100, defense: 50, maxHp: 1000 };

function hatched(stage = 3): { s: PetSave; id: number } {
  const s = newSave();
  s.items.birdEgg = 1;
  const p = startHatch(s, cfg, "birdEgg", 0)!;
  tickPet(p, T, T.hatchSeconds! * 1000);
  p.stage = stage;
  return { s, id: p.id };
}
const pet = (s: PetSave, id: number) => s.pets.find((p) => p.id === id)!;
const withAffixes = (affixes: PetAffix[], stage = 3) => {
  const h = hatched(stage);
  pet(h.s, h.id).affixes = affixes;
  equip(h.s, h.id);
  return h;
};

test("無詞條寵物：鑑定結果 0 條也算鑑定完成；加成為 0；之後不能再鑑定", () => {
  const { s, id } = withAffixes([]);
  const r = applyPetBonus(BASE, cfg, pet(s, id), T);
  assert.deepEqual(r.stats, BASE);
  assert.deepEqual(r.effective, []);
  assert.deepEqual(appraisePet(s, cfg, T, createRng(1), id, "preview"), { ok: false, reason: "already-appraised" });
  assert.deepEqual(pet(s, id).affixes, []);
});

test("4 條全正：完全成長時全部依原始數值發揮", () => {
  const { s, id } = withAffixes([
    { stat: "attack", value: 25 },
    { stat: "attackSpeed", value: 10 },
    { stat: "defense", value: 25 },
    { stat: "maxHp", value: 20 },
  ]);
  const r = applyPetBonus(BASE, cfg, pet(s, id), T);
  assert.equal(r.scale, 1);
  assert.deepEqual(r.stats, { attack: 125, attackSpeed: 110, defense: 63, maxHp: 1200 });
});

test("4 條全負：完全成長時全部依原始數值降低（與正詞條同比例）", () => {
  const { s, id } = withAffixes([
    { stat: "attack", value: -10 },
    { stat: "attackSpeed", value: -4 },
    { stat: "defense", value: -10 },
    { stat: "maxHp", value: -10 },
  ]);
  const r = applyPetBonus(BASE, cfg, pet(s, id), T);
  assert.deepEqual(r.stats, { attack: 90, attackSpeed: 96, defense: 45, maxHp: 900 });
});

test("正負混合：正負詞條使用同一個發揮比例（各階段皆同）", () => {
  const aff: PetAffix[] = [
    { stat: "attack", value: 20 },
    { stat: "defense", value: -10 },
  ];
  for (const stage of [1, 2, 3]) {
    const { s, id } = withAffixes(aff, stage);
    const p = pet(s, id);
    p.exp = T.stageExp![stage]!;
    const r = applyPetBonus(BASE, cfg, p, T);
    const k = bonusScale(cfg, p, T);
    assert.ok(k > 0 && k <= 1);
    assert.equal(r.effective[0]!.value, Math.round(20 * k * 100) / 100);
    assert.equal(r.effective[1]!.value, Math.round(-10 * k * 100) / 100);
    assert.ok(Math.abs(r.effective[0]!.value / r.effective[1]!.value + 2) < 0.01); // 比例相同
  }
});

test("重新鑑定不會重抽：第二次一律拒絕，詞條逐字不變；蛋不能鑑定", () => {
  const { s, id } = hatched(1);
  const first = appraisePet(s, cfg, T, createRng(42), id, "preview");
  assert.ok(first.ok);
  const snap = structuredClone(pet(s, id).affixes);
  for (let seed = 0; seed < 50; seed++) {
    const r = appraisePet(s, cfg, T, createRng(seed), id, "preview");
    assert.deepEqual(r, { ok: false, reason: "already-appraised" });
  }
  assert.deepEqual(pet(s, id).affixes, snap);
  const e = newSave();
  e.items.egg = 1;
  const egg = startHatch(e, cfg, "egg", 0)!;
  assert.deepEqual(appraisePet(e, cfg, T, createRng(1), egg.id, "preview"), { ok: false, reason: "egg" });
  assert.deepEqual(appraisePet(e, cfg, T, createRng(1), 999, "preview"), { ok: false, reason: "not-found" });
});

test("進化、存檔、讀檔都不改變詞條；進化只提升發揮比例", () => {
  const { s, id } = hatched(1);
  s.items.shopFeed = 20;
  appraisePet(s, cfg, T, createRng(2024), id, "preview");
  // 確保至少有一條，方便比對發揮比例
  if (!pet(s, id).affixes!.length) pet(s, id).affixes = [{ stat: "attack", value: 15 }];
  const snap = structuredClone(pet(s, id).affixes);
  let lastScale = bonusScale(cfg, pet(s, id), T);
  let now = T.hatchSeconds! * 1000;
  for (let stage = 1; stage < 3; stage++) {
    const p = pet(s, id);
    while (p.feedCount < T.evolveRequiresFeedCount![stage + 1]!) assert.ok(feedPet(s, p, "shopFeed", T));
    now += 600_000;
    tickPet(p, T, now);
    assert.ok(evolve(cfg, p, T), `stage ${stage}`);
    assert.deepEqual(p.affixes, snap);
    const k = bonusScale(cfg, p, T);
    assert.ok(k > lastScale);
    lastScale = k;
    // 存檔 → 讀檔
    const back = parseSave(JSON.stringify(s));
    assert.deepEqual(back.pets.find((x) => x.id === id)!.affixes, snap);
  }
});

test("裝備／卸下會即時更新角色數值", () => {
  const { s, id } = withAffixes([{ stat: "maxHp", value: 20 }]);
  const stats = () => applyPetBonus(BASE, cfg, equippedPet(s), T).stats;
  assert.equal(stats().maxHp, 1200);
  equip(s, null);
  assert.deepEqual(stats(), BASE);
  equip(s, id);
  assert.equal(stats().maxHp, 1200);
});

test("最終攻速不超過 160（含寵物加成，各種基礎值）", () => {
  const { s, id } = withAffixes([{ stat: "attackSpeed", value: 10 }]);
  for (const as of [100, 150, 151, 155, 159.9, 160, 175, 300]) {
    const r = applyPetBonus({ ...BASE, attackSpeed: as }, cfg, pet(s, id), T);
    assert.ok(r.stats.attackSpeed <= 160, `${as} → ${r.stats.attackSpeed}`);
  }
  assert.equal(applyPetBonus({ ...BASE, attackSpeed: 150 }, cfg, pet(s, id), T).stats.attackSpeed, 160);
});

test("PetManager（遊戲整合介面）：怪物掉落 → 孵化 → 鑑定一次 → 裝備改變屬性 → 存讀檔", async () => {
  const { PetManager } = await import("../../src/pets/PetManager.ts");
  const m = new PetManager(cfg, createRng(5), "preview");
  const ev: string[] = [];
  m.on((e) => ev.push(e.type));
  for (let i = 0; i < 60; i++) m.onMonsterKilled();
  m.save.items.seed += 1;
  const p = m.hatch("seed", 0)!;
  m.tick(T.hatchSeconds! * 1000);
  assert.ok(ev.includes("drops") && ev.includes("hatched"));
  assert.ok(m.appraise(p.id).ok);
  assert.equal(m.appraise(p.id).ok, false);
  pet(m.save, p.id).affixes = [{ stat: "attackSpeed", value: 10 }];
  pet(m.save, p.id).stage = 3;
  m.equip(p.id);
  assert.equal(m.characterStats({ ...BASE, attackSpeed: 155 }).attackSpeed, 160);
  m.equip(null);
  assert.equal(m.characterStats(BASE).attackSpeed, 100);
  const back = new PetManager(cfg, createRng(9), "preview", m.serialize());
  assert.deepEqual(back.save.pets.find((x) => x.id === p.id)!.affixes, [{ stat: "attackSpeed", value: 10 }]);
  // 正式模式：設定未定案 → 寵物功能停用、不掉寵物物品（不自行假設、也不讓遊戲當掉）
  const off = new PetManager(cfg, createRng(1), "official");
  assert.equal(off.enabled, false);
  assert.deepEqual(off.onMonsterKilled(), []);
});
