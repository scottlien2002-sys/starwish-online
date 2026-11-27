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
  const expectLv: Record<string, number> = { "04": 7, "05": 8, "06": 9, "07": 10 };
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

// ---------------- 新版初心者 GLB（Tripo 模組化） ----------------
import { readFileSync, existsSync } from "node:fs";
import { modularFile } from "../../src/characters/novice72.ts";

function glbJson(path: string): any {
  const b = readFileSync(path);
  const n = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + n).toString("utf8"));
}

test("新版初心者：manifest 列出的檔案都存在；男女 × HQ/Lite × 7 個模組", () => {
  const dir = "public/models/novice72";
  const m = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
  for (const f of m.files) assert.ok(existsSync(`${dir}/${f}`), f);
  for (const g of ["male", "female"] as const)
    for (const lod of ["hq", "lite"] as const)
      for (const slot of ["body", "hair01", "top", "bottom", "boots", "sword", "staff"]) assert.ok(m.files.includes(modularFile(g, slot, lod)), `${g} ${slot} ${lod}`);
});

test("新版初心者：每個零件的骨架與身體同名同序（換裝重新綁定用）；身體含 7 組動畫；零件沒有動畫", () => {
  const dir = "public/models/novice72";
  for (const g of ["male", "female"] as const)
    for (const lod of ["hq", "lite"] as const) {
      const body = glbJson(`${dir}/${modularFile(g, "body", lod)}`);
      const names = (j: any) => j.skins[0].joints.map((i: number) => j.nodes[i].name);
      const bn = names(body);
      assert.ok(bn.includes("head") && bn.includes("hand.R") && bn.includes("weapon.R"));
      assert.deepEqual(body.animations.map((a: any) => a.name).sort(), ["Attack_Staff", "Attack_Sword", "Death", "Hurt", "Idle", "Jump", "Run"]);
      for (const slot of ["hair01", "top", "bottom", "boots", "sword", "staff"]) {
        const p = glbJson(`${dir}/${modularFile(g, slot, lod)}`);
        assert.deepEqual(names(p), bn, `${g} ${slot} ${lod}`);
        assert.equal((p.animations ?? []).length, 0);
      }
    }
});
