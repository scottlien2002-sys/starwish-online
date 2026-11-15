import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  affixProbabilitiesReady,
  validateAffixConfig,
  validateEnhanceConfig,
  type AffixConfig,
  type EnhanceConfig,
} from "../../src/config/validate.ts";

const load = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../../src/config/${name}`, import.meta.url), "utf8")) as T;

test("affixes.json 通過驗證", () => {
  const cfg = load<AffixConfig>("affixes.json");
  assert.deepEqual(validateAffixConfig(cfg), []);
});

test("affixes.json 數值與企劃確認值一致", () => {
  const cfg = load<AffixConfig>("affixes.json");
  const pick = (list: AffixConfig["weapon"], stat: string) => list.find((e) => e.stat === stat)?.values;
  assert.deepEqual(pick(cfg.weapon, "attackSpeed"), [4, 6, 8, 10]);
  assert.deepEqual(pick(cfg.weapon, "attack"), [10, 12, 15]);
  assert.deepEqual(pick(cfg.weapon, "hitRate"), [6, 8, 10]);
  assert.deepEqual(pick(cfg.weapon, "critRate"), [10, 20]);
  assert.deepEqual(pick(cfg.armor, "defense"), [5, 10, 15, 20]);
  assert.deepEqual(pick(cfg.armor, "maxHp"), [50, 100, 150, 200]);
  assert.deepEqual(pick(cfg.armor, "blockRate"), [2, 4, 6, 8]);
  assert.deepEqual(pick(cfg.armor, "attackSpeed"), [4, 6, 8, 10]);
});

test("鑑定機率尚未提供時，系統判定為未就緒", () => {
  assert.equal(affixProbabilitiesReady(load<AffixConfig>("affixes.json")), false);
});

test("驗證器會擋下錯誤詞條", () => {
  const cfg = load<AffixConfig>("affixes.json");
  const bad: AffixConfig = structuredClone(cfg);
  bad.weapon[0]!.stat = "defense"; // 武器不可出現防禦
  assert.ok(validateAffixConfig(bad).length > 0);

  const bad2: AffixConfig = structuredClone(cfg);
  bad2.armor.push({ ...bad2.armor[0]!, stat: "critRate" }); // 防具不可出現暴擊
  assert.ok(validateAffixConfig(bad2).length > 0);

  const bad3: AffixConfig = structuredClone(cfg);
  bad3.weapon[0]!.values = [4, 200];
  assert.ok(validateAffixConfig(bad3).some((e) => e.includes("攻速上限")));

  const bad4: AffixConfig = structuredClone(cfg);
  bad4.weapon[1]!.valueWeights = [1, 2];
  assert.ok(validateAffixConfig(bad4).some((e) => e.includes("valueWeights")));
});

test("enhance.json 結構正確且標記待確認", () => {
  const cfg = load<EnhanceConfig>("enhance.json");
  assert.deepEqual(validateEnhanceConfig(cfg), []);
  assert.equal(cfg.levels.length, 10);
  assert.equal(cfg.status, "pending_user_confirmation");
  assert.ok(cfg.levels.every((l) => l.successRate === null), "成功率不可由程式自行假設");
});

test("強化表狀態為 confirmed 時，不允許空欄位", () => {
  const cfg = load<EnhanceConfig>("enhance.json");
  const confirmed: EnhanceConfig = { ...structuredClone(cfg), status: "confirmed" };
  assert.ok(validateEnhanceConfig(confirmed).length > 0);
  const short: EnhanceConfig = { ...structuredClone(cfg), levels: cfg.levels.slice(0, 9) };
  assert.ok(validateEnhanceConfig(short).length > 0);
});
