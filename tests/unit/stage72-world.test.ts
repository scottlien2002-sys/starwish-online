import { test } from "node:test";
import assert from "node:assert/strict";
import { expToNext, gainExp, sanitizeProgress, EXP_TABLE_TEST } from "../../src/core/progression.ts";
import { newGameSave, parseGameSave, parseAppearance, HAIR_SLOTS } from "../../src/core/gameSave.ts";
import { FIELD_RIGGED_SPAWNS, RIGGED_MONSTERS, riggedTimings } from "../../src/monsters/rigged/riggedSpec.ts";
import { MONSTER_DEFINITIONS } from "../../src/config/monsters.ts";
import { ZONES } from "../../src/maps/starsprout/layout.ts";
import { createMonsterRegistry } from "../../src/monsters/framework/index.ts";

test("等級經驗（測試設定）：升級、連升、經驗不為負", () => {
  assert.equal(expToNext(1), EXP_TABLE_TEST[0]);
  const p = { level: 1, exp: 0 };
  assert.equal(gainExp(p, 99), 0);
  assert.equal(gainExp(p, 1), 1);
  assert.deepEqual(p, { level: 2, exp: 0 });
  assert.equal(gainExp(p, expToNext(2) + expToNext(3) + 5), 2);
  assert.deepEqual(p, { level: 4, exp: 5 });
  assert.equal(gainExp(p, -50), 0);
  assert.ok(expToNext(20) > expToNext(10));
  assert.deepEqual(sanitizeProgress("x", -3), { level: 1, exp: 0 });
});

test("存檔：等級、經驗、外觀會存回、讀回；舊存檔補預設值", () => {
  const s = newGameSave("female", 0);
  assert.deepEqual(s.character.appearance, { hair: "hair01", hairColor: null, weapon: "sword" });
  s.character.level = 3;
  s.character.exp = 42;
  s.character.appearance = { hair: "hair01", hairColor: "#AA3366", weapon: "staff" };
  const back = parseGameSave(JSON.stringify(s))!;
  assert.equal(back.character.level, 3);
  assert.equal(back.character.exp, 42);
  assert.deepEqual(back.character.appearance, { hair: "hair01", hairColor: "#aa3366", weapon: "staff" });
  // Stage 7.1 的舊存檔（沒有等級與外觀）
  const old = JSON.parse(JSON.stringify(s));
  delete old.character.level;
  delete old.character.exp;
  delete old.character.appearance;
  const o = parseGameSave(JSON.stringify(old))!;
  assert.equal(o.character.level, 1);
  assert.equal(o.character.exp, 0);
  assert.equal(o.character.appearance.hair, "hair01");
  assert.equal(HAIR_SLOTS.length, 6, "每個性別預留 6 種髮型");
  assert.equal(parseAppearance({ hair: "hair99", hairColor: "red", weapon: "axe" }).weapon, "sword");
});

test("Stage 7.2：M004～M007 出生區對應原本的 7 區配置；每種都有怪物資料與動畫設定", () => {
  const reg = createMonsterRegistry();
  const expectLv: Record<string, number> = { "02": 3, "03": 5, "04": 7, "05": 8, "06": 9, "07": 10 };
  for (const { zoneId, spec } of FIELD_RIGGED_SPAWNS) {
    const zone = ZONES.find((z) => z.id === zoneId)!;
    assert.ok(zone, zoneId);
    const def = reg.definition(spec.monsterId);
    assert.equal(def.modelId, spec.modelId);
    assert.equal(def.animationProfileId, spec.modelId);
    assert.equal(def.level, expectLv[zoneId]);
    assert.equal(def.bodyRadius, spec.bodyRadius);
    assert.equal(def.patrolSpeed, spec.locomotion.moveNativeMps, "巡邏 = Move 原生速度");
    assert.equal(def.chaseSpeed, spec.locomotion.runNativeMps, "追擊 = Run 原生速度");
    assert.ok(def.chaseSpeed! >= spec.locomotion.runThresholdMps + spec.locomotion.hysteresisMps, "追擊會播 Run");
    assert.ok(def.patrolSpeed! < spec.locomotion.runThresholdMps - spec.locomotion.hysteresisMps, "巡邏播 Move");
    assert.ok(def.attackCooldown >= spec.expect.durations.attack, "冷卻不短於攻擊動畫");
    assert.ok(spec.attackHitTime < spec.expect.durations.attack);
    assert.ok(def.provisional, "數值標示為測試設定");
    assert.ok(riggedTimings(spec).death > spec.expect.durations.death);
    assert.ok(!spec.fixture);
  }
  assert.equal(reg.definition("carrot_king").rank, "elite");
  assert.equal(reg.definition("crown_hammer_rabbit").rank, "boss");
  assert.ok(RIGGED_MONSTERS.filter((s) => s.fixture).length === 1);
  const names = MONSTER_DEFINITIONS.filter((d) => !d.testOnly).map((d) => d.name);
  assert.ok(!names.includes("焰尾狐"));
});

// 新版 Tripo 初心者：美術驗收不通過（2026-11-27），GLB 封存在 art-tripo-novice／backup/stage72-world-tripo-novice，不部署
import { existsSync } from "node:fs";
test("封存的 Tripo 新版初心者 GLB 不放在 public（預覽只部署已驗收的 C1.0-B5b）", () => {
  assert.equal(existsSync("public/models/novice72"), false);
  for (const g of ["male", "female"]) for (const l of ["hq", "lite"]) assert.ok(existsSync(`public/models/novice_c10b5b_${g}_${l}.glb`), `${g} ${l}`);
});

// ---------------- Stage 7.3：技能不能穿越不可通行地形 ----------------
import { FieldTerrainQuery } from "../../src/game/fieldTerrainQuery.ts";
test("Stage 7.3 FieldTerrainQuery：被岩石、溪流擋住就停在前面；跳躍也不能越過；可走的路照常移動", () => {
  const river = (x: number) => x > 10 && x < 12; // 溪流
  const q = new FieldTerrainQuery({ walkable: (x) => !river(x) }, [{ x: 5, z: 0, r: 1 }]);
  assert.equal(q.canStand(0, 0, 0.4), true);
  assert.equal(q.canStand(5, 0, 0.4), false);
  const a = q.clampMove({ x: 0, z: 0 }, { x: 8, z: 0 }, 0.4); // 直衝岩石
  assert.ok(a.x < 5 - 1.4 + 0.06 && a.x > 3.4, `停在岩石前 ${a.x}`);
  const b = q.clampMove({ x: 7, z: 0 }, { x: 14, z: 0 }, 0.4); // 跳過溪流 → 不行
  assert.ok(b.x <= 10 && b.x > 9.9, `停在溪流前 ${b.x}`);
  const c = q.clampMove({ x: 0, z: 3 }, { x: 8, z: 3 }, 0.4); // 旁邊的路
  assert.deepEqual([Math.round(c.x * 100) / 100, c.z], [8, 3]);
});
