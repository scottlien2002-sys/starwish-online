import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRng } from "../../src/core/rng.ts";
import {
  appraise,
  applyPetBonus,
  bonusScale,
  canEvolve,
  CONFIRMED_PET_VALUES,
  equip,
  equippedPet,
  evolve,
  feedPet,
  newSave,
  parseSave,
  PetConfigPendingError,
  resolveTuning,
  rollDrops,
  startHatch,
  tickPet,
  validatePetConfig,
  type PetConfig,
} from "../../src/pets/petSystem.ts";

const cfg = JSON.parse(readFileSync(new URL("../../src/config/pets.json", import.meta.url), "utf8")) as PetConfig;
const T = resolveTuning(cfg, "preview");

test("pets.json 通過驗證；鑑定數值與企劃確認值完全相同（含負值）", () => {
  assert.deepEqual(validatePetConfig(cfg), []);
  for (const s of cfg.appraisal.stats) assert.deepEqual(s.values, [...CONFIRMED_PET_VALUES[s.stat]]);
  assert.deepEqual(CONFIRMED_PET_VALUES.attack, [-10, -5, 10, 15, 20, 25]);
  assert.deepEqual(CONFIRMED_PET_VALUES.attackSpeed, [-4, -2, 2, 4, 6, 8, 10]);
  assert.deepEqual(CONFIRMED_PET_VALUES.defense, [-10, -5, 10, 15, 20, 25]);
  assert.deepEqual(CONFIRMED_PET_VALUES.maxHp, [-10, -5, 10, 15, 20]);
});

test("驗證會擋下：改掉確認數值、排除負屬性、同種多條", () => {
  const bad = structuredClone(cfg);
  bad.appraisal.stats[0]!.values = [10, 15, 20, 25];
  bad.appraisal.allowNegative = false;
  bad.appraisal.oneAffixPerStat = false;
  const e = validatePetConfig(bad);
  assert.ok(e.some((x) => x.includes("企劃確認值")));
  assert.ok(e.some((x) => x.includes("負屬性")));
  assert.ok(e.some((x) => x.includes("最多一條")));
});

test("正式模式：尚未定案的機率與數值一律拋錯，不自行假設", () => {
  const O = resolveTuning(cfg, "official");
  const rng = createRng(1);
  assert.throws(() => appraise(cfg, O, rng), PetConfigPendingError);
  assert.throws(() => rollDrops(rng, O), PetConfigPendingError);
  const s = newSave();
  s.items.egg = 1;
  const p = startHatch(s, cfg, "egg", 0)!;
  assert.throws(() => tickPet(p, O, 1000), PetConfigPendingError);
});

test("鑑定：0～4 條、同一種最多一條、數值都在確認清單內、正負都會出現", () => {
  const rng = createRng(12345);
  const counts = [0, 0, 0, 0, 0];
  let neg = 0;
  let pos = 0;
  let allNeg = 0;
  let mixed = 0;
  for (let i = 0; i < 4000; i++) {
    const a = appraise(cfg, T, rng, "preview");
    counts[a.length]! += 1;
    assert.ok(a.length <= 4);
    assert.equal(new Set(a.map((x) => x.stat)).size, a.length);
    for (const x of a) {
      assert.ok(CONFIRMED_PET_VALUES[x.stat].includes(x.value), `${x.stat} ${x.value}`);
      if (x.value < 0) neg++;
      else pos++;
    }
    if (a.length >= 2 && a.every((x) => x.value < 0)) allNeg++;
    if (a.some((x) => x.value < 0) && a.some((x) => x.value > 0)) mixed++;
  }
  assert.ok(counts.every((c) => c > 0), JSON.stringify(counts)); // 0～4 條都會出現
  assert.ok(neg > 0 && pos > 0 && allNeg > 0 && mixed > 0);
});

test("同一個種子 → 同樣的鑑定結果（可重現）", () => {
  assert.deepEqual(appraise(cfg, T, createRng(7), "preview"), appraise(cfg, T, createRng(7), "preview"));
});

test("取得 → 孵化（時間）→ 時間成長 → 餵食 → 進化；條件不足不能進化", () => {
  const s = newSave();
  s.items.seed = 1;
  s.items.shopFeed = 10;
  const p = startHatch(s, cfg, "seed", 0)!;
  assert.equal(s.items.seed, 0);
  assert.equal(p.species, "sprout");
  assert.equal(p.stage, 0);
  assert.equal(feedPet(s, p, "shopFeed", T), false); // 蛋不能餵
  assert.equal(tickPet(p, T, (T.hatchSeconds! - 1) * 1000).hatched, false);
  assert.equal(tickPet(p, T, T.hatchSeconds! * 1000).hatched, true);
  assert.equal(p.stage, 1);
  tickPet(p, T, (T.hatchSeconds! + 10) * 1000); // 10 秒 × 2 exp
  assert.ok(Math.abs(p.exp - 20) < 1e-9);
  // 初始 → 幼年期 需要累計 60 exp、餵食 1 次（preview 暫定值）
  tickPet(p, T, (T.hatchSeconds! + 30) * 1000); // +20 秒 × 2 = 60
  assert.equal(canEvolve(cfg, p, T), false); // 經驗夠、還沒餵食
  assert.ok(feedPet(s, p, "shopFeed", T));
  assert.equal(p.feedCount, 1);
  assert.ok(canEvolve(cfg, p, T));
  assert.ok(evolve(cfg, p, T));
  assert.equal(p.stage, 2);
  assert.equal(evolve(cfg, p, T), false);
});

test("加成隨培育逐步發揮：蛋 0、階段內進度只推進一半、進化才再提升；最後階段 = 最後倍率", () => {
  const s = newSave();
  s.items.egg = 1;
  const p = startHatch(s, cfg, "egg", 0)!;
  assert.equal(bonusScale(cfg, p, T), 0);
  p.stage = 1;
  p.exp = 20;
  const a = bonusScale(cfg, p, T);
  p.exp = 50;
  const b = bonusScale(cfg, p, T);
  assert.ok(a < b && b < T.bonusScaleByStage![2]!);
  p.stage = 4;
  assert.equal(bonusScale(cfg, p, T), T.bonusScaleByStage![4]);
});

test("套用到角色：百分比與點數、負屬性會降低、攻速最終不超過 160", () => {
  const s = newSave();
  s.items.birdEgg = 1;
  const p = startHatch(s, cfg, "birdEgg", 0)!;
  p.stage = 4;
  p.affixes = [
    { stat: "attack", value: 25 },
    { stat: "attackSpeed", value: 10 },
    { stat: "defense", value: -10 },
    { stat: "maxHp", value: 20 },
  ];
  const r = applyPetBonus({ attack: 100, attackSpeed: 155, defense: 50, maxHp: 1000 }, cfg, p, T);
  assert.equal(r.scale, 1);
  assert.equal(r.stats.attack, 125);
  assert.equal(r.stats.attackSpeed, 160); // 155 + 10 → 上限 160
  assert.equal(r.stats.defense, 45);
  assert.equal(r.stats.maxHp, 1200);
  const none = applyPetBonus({ attack: 100, attackSpeed: 200, defense: 50, maxHp: 1000 }, cfg, null, T);
  assert.equal(none.stats.attackSpeed, 160);
  p.affixes = null; // 未鑑定 → 沒有加成
  assert.equal(applyPetBonus({ attack: 100, attackSpeed: 100, defense: 50, maxHp: 1000 }, cfg, p, T).stats.attack, 100);
});

test("掉落：三種來源與材料都會掉；裝備欄只能一隻；存檔可還原", () => {
  const rng = createRng(99);
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) for (const d of rollDrops(rng, T)) seen.add(d);
  for (const k of ["seed", "egg", "birdEgg", "monsterMaterial"]) assert.ok(seen.has(k), k);
  const s = newSave();
  s.items.seed = 2;
  const a = startHatch(s, cfg, "seed", 0)!;
  const b = startHatch(s, cfg, "seed", 0)!;
  assert.ok(equip(s, a.id));
  assert.ok(equip(s, b.id));
  assert.equal(equippedPet(s)?.id, b.id);
  assert.equal(equip(s, 999), false);
  const back = parseSave(JSON.stringify(s));
  assert.deepEqual(back, s);
  assert.deepEqual(parseSave("{broken"), newSave());
});
