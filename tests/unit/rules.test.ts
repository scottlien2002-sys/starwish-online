import { test } from "node:test";
import assert from "node:assert/strict";
import { CORE_RULES, clampAttackSpeed, clampLevel } from "../../src/core/rules.ts";
import { CLASS_CANON, MONSTER_CANON, PHASE1_CLASSES } from "../../src/core/canon.ts";

test("核心規則：數值鎖定", () => {
  assert.equal(CORE_RULES.maxAttackSpeed, 160);
  assert.equal(CORE_RULES.maxLevel, 20);
  assert.equal(CORE_RULES.equipmentTierLevelStep, 5);
  assert.deepEqual([...CORE_RULES.equipmentTierLevels], [5, 10, 15, 20]);
  assert.equal(CORE_RULES.equipmentHasRarity, false);
  assert.equal(CORE_RULES.maxAffixesPerEquipment, 1);
  assert.equal(CORE_RULES.minEnhanceLevel, 0);
  assert.equal(CORE_RULES.maxEnhanceLevel, 10);
  assert.equal(CORE_RULES.manualCombatOnly, true);
  assert.equal(CORE_RULES.separateEquipmentRecords, true);
});

test("核心規則：執行期不可被修改", () => {
  assert.ok(Object.isFrozen(CORE_RULES));
  assert.ok(Object.isFrozen(CORE_RULES.equipmentTierLevels));
  assert.throws(() => {
    (CORE_RULES as { maxAttackSpeed: number }).maxAttackSpeed = 999;
  }, TypeError);
});

test("裝備階級符合每 5 等一階", () => {
  for (const lv of CORE_RULES.equipmentTierLevels) {
    assert.equal(lv % CORE_RULES.equipmentTierLevelStep, 0);
    assert.ok(lv <= CORE_RULES.maxLevel);
  }
});

test("攻速上限 160", () => {
  assert.equal(clampAttackSpeed(200), 160);
  assert.equal(clampAttackSpeed(160), 160);
  assert.equal(clampAttackSpeed(159.5), 159.5);
  assert.equal(clampAttackSpeed(-5), 0);
  assert.equal(clampAttackSpeed(Number.NaN), 0);
});

test("等級範圍 1~20", () => {
  assert.equal(clampLevel(0), 1);
  assert.equal(clampLevel(25), 20);
  assert.equal(clampLevel(7.9), 7);
});

test("正式名稱：職業與怪物", () => {
  assert.deepEqual(Object.values(CLASS_CANON), ["初心者", "劍士", "法師", "祭司", "小丑", "弓箭手", "騎士"]);
  assert.deepEqual([...PHASE1_CLASSES], ["novice", "swordsman"]);
  assert.deepEqual(Object.values(MONSTER_CANON), ["星露啵啵", "苔角獸", "焰尾狐"]);
  assert.ok(Object.isFrozen(MONSTER_CANON));
});
