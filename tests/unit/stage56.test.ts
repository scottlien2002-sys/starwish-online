import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRng } from "../../src/core/rng.ts";
import { combatTuningFromStats, FIELD_TEST, zoneSpawnPoints } from "../../src/game/fieldRules.ts";
import { FieldLoot } from "../../src/game/fieldLoot.ts";
import { PreviewCombat, PREVIEW_COMBAT } from "../../src/game/previewCombat.ts";
import { PetManager } from "../../src/pets/PetManager.ts";
import { createPetMerchantService } from "../../src/pets/petMerchantAdapter.ts";
import { missingTuning, resolveTuning, type PetConfig } from "../../src/pets/petSystem.ts";

const cfg = JSON.parse(readFileSync(new URL("../../src/config/pets.json", import.meta.url), "utf8")) as PetConfig;

test("戰鬥測試設定：基礎 0.5 秒一下、傷害 20、生命 100；攻速 160 → 0.3125 秒；寵物加成反映到傷害、生命、受傷", () => {
  const b = combatTuningFromStats(FIELD_TEST.baseStats);
  assert.deepEqual(b, { maxHp: 100, attackDamage: 20, attackInterval: 0.5, damageTakenMul: 1 });
  const fast = combatTuningFromStats({ ...FIELD_TEST.baseStats, attackSpeed: 200 });
  assert.equal(fast.attackInterval, 0.3125);
  const pet = combatTuningFromStats({ attack: 125, attackSpeed: 110, defense: 60, maxHp: 120 });
  assert.equal(pet.attackDamage, 25);
  assert.equal(pet.maxHp, 120);
  assert.ok(pet.damageTakenMul < 1);
  assert.ok(pet.attackInterval < 0.5);
});

test("PreviewCombat：預設值不變（新手草原）；覆寫後依攻擊間隔與傷害結算", () => {
  const c = new PreviewCombat();
  assert.equal(c.tuning.attackInterval, PREVIEW_COMBAT.playerAttackInterval);
  assert.equal(c.tuning.attackDamage, PREVIEW_COMBAT.playerAttackDamage);
  Object.assign(c.tuning, combatTuningFromStats({ ...FIELD_TEST.baseStats, attack: 150 }));
  let hp = 100;
  const m = { instanceId: "m", isAlive: true, currentPosition: { x: 1, z: 0 }, definition: { attack: 8, attackRange: 1.1, name: "啵" }, receiveDamage: (a: number) => ((hp -= a), { applied: true, killed: hp <= 0 }) };
  const r1 = c.playerAttack(0, 0, 0, [m]);
  assert.ok(r1.ok && r1.damage === 30);
  assert.equal(c.playerAttack(0.49, 0, 0, [m]).ok, false); // 冷卻中
  assert.ok(c.playerAttack(0.5, 0, 0, [m]).ok);
  // 防禦加倍 → 受到傷害減半（最少 1）
  c.tuning.damageTakenMul = 0.5;
  assert.equal(c.monsterImpact(1, m, 0, 0), 4);
});

test("星露草坪生成點：6 個、都在區域內、彼此至少 3 m", () => {
  const pts = zoneSpawnPoints(-24, -52, 12, FIELD_TEST.boboCount);
  assert.equal(pts.length, 6);
  for (const p of pts) assert.ok(Math.hypot(p.x + 24, p.z + 52) <= 12 * 0.7);
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) assert.ok(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z) >= 3);
});

test("掉落物：散開放置、走近撿起、太久消失", () => {
  const l = new FieldLoot(1.5, 90);
  const d = l.spawn(["seed", "egg", "monsterMaterial"], 10, 10, 0);
  assert.equal(d.length, 3);
  assert.ok(d.every((x) => Math.hypot(x.x - 10, x.z - 10) < 0.6));
  assert.deepEqual(l.update(1, 0, 0), { picked: [], expired: [] });
  assert.equal(l.update(2, 10, 10).picked.length, 3);
  l.spawn(["birdEgg"], 0, 0, 0);
  assert.equal(l.update(91, 50, 50).expired.length, 1);
  assert.equal(l.drops.length, 0);
});

test("正式設定缺值：寵物功能停用、說明列出缺的項目、不拋錯；測試設定可啟用", () => {
  const off = new PetManager(cfg, createRng(1), "official");
  assert.equal(off.enabled, false);
  assert.ok(off.disabledReason.includes("掉落率") && off.disabledReason.includes("孵化時間") && off.disabledReason.includes("鑑定費用"));
  assert.deepEqual(off.onMonsterKilled(), []);
  off.save.items.seed = 1;
  assert.equal(off.hatch("seed", 0), null);
  assert.doesNotThrow(() => off.tick(1e9));
  assert.deepEqual(off.characterStats(FIELD_TEST.baseStats), FIELD_TEST.baseStats);
  const on = new PetManager(cfg, createRng(1), "preview");
  assert.equal(on.enabled, true);
  assert.deepEqual(missingTuning(resolveTuning(cfg, "preview"), "preview"), []);
});

test("寵物商人服務（B 線介面）：列出可鑑定寵物、鑑定一次後固定、飼料、說明；正式缺值時回覆未開放", async () => {
  const m = new PetManager(cfg, createRng(3), "preview");
  const svc = createPetMerchantService(m);
  assert.equal(svc.available, true);
  m.save.items.birdEgg = 1;
  let list = await svc.appraisableItems("birdEgg");
  assert.ok(list.ok && list.data.length === 1 && list.data[0]!.itemId.startsWith("item:")); // 孵化前的鳥蛋個體
  const p = m.hatch("birdEgg", 0)!;
  m.tick(m.tuning.hatchSeconds! * 1000);
  list = await svc.appraisableItems("birdEgg");
  assert.ok(list.ok && list.data.length === 1 && list.data[0]!.itemId === `pet:${p.id}`);
  const a = await svc.appraise(`pet:${p.id}`);
  assert.ok(a.ok && a.data.lines.length >= 1);
  const again = await svc.appraise(`pet:${p.id}`);
  assert.ok(!again.ok && again.message.includes("永久固定"));
  assert.ok((await svc.appraisableItems("birdEgg")).ok);
  const offers = await svc.feedOffers();
  assert.ok(offers.ok && offers.data[0]!.id === "shopFeed");
  const bought = await svc.buyFeed("shopFeed", 3);
  assert.ok(bought.ok && m.save.items.shopFeed === 3);
  assert.ok((await svc.careGuide()).ok);
  const off = createPetMerchantService(new PetManager(cfg, createRng(1), "official"));
  assert.equal(off.available, false);
  const r = await off.appraisableItems("seed");
  assert.ok(!r.ok && r.reason === "unavailable");
});

test("寵物鑑定服務（B 線規格 V2.1）：個體物品、孵化前鑑定、冪等、不可重鑑、物品不變、孵化後詞條跟著寵物", async () => {
  const { createPetAppraisalService } = await import("../../src/pets/petAppraisalService.ts");
  const { validateAffixes, parseSave } = await import("../../src/pets/petSystem.ts");
  const m = new PetManager(cfg, createRng(11), "preview");
  const svc = createPetAppraisalService(m);
  assert.equal(svc.available, true);
  assert.equal(svc.testData, true);
  m.giveItem("seed", 2);
  m.giveItem("birdEgg", 1);
  const inv = await svc.inventory();
  assert.ok(inv.ok && inv.data.length === 3 && inv.data.every((x) => !x.appraised && x.affixes === null));
  const ids = inv.ok ? inv.data.map((x) => x.id) : [];
  assert.equal(new Set(ids).size, 3); // 同名的兩顆種子是不同個體
  const q = await svc.quote(ids[0]!);
  assert.ok(q.ok && q.data.fee === 20 && q.data.test); // 測試設定鑑定費用
  const a1 = await svc.appraise(ids[0]!, "req-1");
  assert.ok(a1.ok && a1.data.item.appraised && validateAffixes(cfg, a1.data.item.affixes as never).length === 0);
  // 重送同一個 requestId → 同一個結果
  const a1b = await svc.appraise(ids[0]!, "req-1");
  assert.deepEqual(a1b, a1);
  // 新請求但已鑑定 → alreadyAppraised
  const a1c = await svc.appraise(ids[0]!, "req-2");
  assert.ok(!a1c.ok && a1c.reason === "alreadyAppraised");
  // 另一顆種子各自鑑定、數量不變
  assert.equal(m.save.items.seed, 2);
  const inv2 = await svc.inventory();
  assert.ok(inv2.ok && inv2.data.length === 3 && inv2.data.filter((x) => x.appraised).length === 1);
  // 找不到
  const nf = await svc.appraise("item:999", "req-3");
  assert.ok(!nf.ok && nf.reason === "notAppraisable");
  // 存讀檔保留
  const back = parseSave(m.serialize());
  assert.deepEqual(back.bag!.find((b) => b.id === ids[0])!.affixes, a1.ok ? a1.data.item.affixes : null);
  // 孵化指定的那一顆：詞條跟著寵物，之後也不能再鑑定
  const pet = m.hatch("seed", 0, ids[0])!;
  assert.deepEqual(pet.affixes, a1.ok ? a1.data.item.affixes : null);
  assert.equal(m.appraise(pet.id).ok, false);
  assert.equal(m.save.items.seed, 1);
  // 正式設定：費用未定案 → 不開放
  const off = createPetAppraisalService(new PetManager(cfg, createRng(1), "official"));
  assert.equal(off.available, false);
  assert.ok(!(await off.inventory()).ok);
});

test("詞條檢查：超過 4 條、重複、數值不在清單、未知屬性都擋下", async () => {
  const { validateAffixes } = await import("../../src/pets/petSystem.ts");
  assert.deepEqual(validateAffixes(cfg, []), []);
  assert.ok(validateAffixes(cfg, [{ stat: "attack", value: 12 }]).length);
  assert.ok(validateAffixes(cfg, [{ stat: "attack", value: 10 }, { stat: "attack", value: 15 }]).length);
  assert.ok(validateAffixes(cfg, [{ stat: "luck" as never, value: 1 }]).length);
  assert.ok(validateAffixes(cfg, [{ stat: "attack", value: 10 }, { stat: "attackSpeed", value: 2 }, { stat: "defense", value: 10 }, { stat: "maxHp", value: 10 }, { stat: "maxHp", value: 15 }]).length);
});

test("地上掉落物：擊倒時不直接放進背包（collect=false），撿起時才放進去 → 不重複計算", () => {
  const m = new PetManager(cfg, createRng(4), "preview");
  let rolled = 0;
  for (let i = 0; i < 20; i++) {
    const items = m.onMonsterKilled(false);
    rolled += items.length;
  }
  assert.ok(rolled > 0);
  assert.equal(Object.values(m.save.items).reduce((a, b) => a + b, 0), 0);
  m.giveItem("seed", 1);
  assert.equal(m.save.items.seed, 1);
});
