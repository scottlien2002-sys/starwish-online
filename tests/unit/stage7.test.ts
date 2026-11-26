import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRng } from "../../src/core/rng.ts";
import { allUids, claimLoot, newGameSave, nextLootUid, parseGameSave, travel, writeGameSave, loadGameSave, GAME_SAVE_KEY } from "../../src/core/gameSave.ts";
import { credit, debit, ledgerConsistent, newWallet, transact } from "../../src/economy/wallet.ts";
import { npcBuyPrice, resolveEconomy, rollGold, type RawEconomy } from "../../src/economy/economyConfig.ts";
import { createLocalGuildService } from "../../src/economy/localGuildService.ts";
import { PetManager } from "../../src/pets/PetManager.ts";
import { createPetAppraisalService } from "../../src/pets/petAppraisalService.ts";
import { isSoul, tickPet, type PetConfig } from "../../src/pets/petSystem.ts";

const petCfg = JSON.parse(readFileSync(new URL("../../src/config/pets.json", import.meta.url), "utf8")) as PetConfig;
const ecoRaw = JSON.parse(readFileSync(new URL("../../src/config/economy.json", import.meta.url), "utf8")) as RawEconomy;

function world(seed = 7) {
  const economy = resolveEconomy("test", ecoRaw);
  const save = newGameSave("male", economy.startingGold ?? 0, 1000);
  const pets = new PetManager(petCfg, createRng(seed), "preview", JSON.stringify(save.pets));
  save.pets = pets.save;
  let writes = 0;
  const guild = createLocalGuildService({ save, pets, economy, persist: () => writes++, now: () => 5000 });
  const appraisal = createPetAppraisalService(pets, { wallet: save.wallet, persist: () => writes++ });
  return { economy, save, pets, guild, appraisal, writes: () => writes };
}

test("錢包：不會變負數、金額必須是正整數、同一個 requestId 只扣／入一次、帳本一致", () => {
  const w = newWallet(50);
  assert.equal(debit(w, "a", "shopBuy", 80).ok, false);
  assert.equal(w.balance, 50);
  assert.equal(debit(w, "b", "shopBuy", -5).ok, false);
  assert.equal(debit(w, "c", "shopBuy", 1.5).ok, false);
  assert.equal(credit(w, "d", "monsterDrop", Number.NaN).ok, false);
  assert.equal(debit(w, "e", "shopBuy", 30).ok, true);
  assert.equal(debit(w, "e", "shopBuy", 30).ok, true); // 重送
  assert.equal(w.balance, 20);
  assert.equal(credit(w, "f", "monsterDrop", 7).ok, true);
  assert.equal(credit(w, "f", "monsterDrop", 7).ok, true);
  assert.equal(w.balance, 27);
  assert.ok(ledgerConsistent(w, 50));
});

test("錢包 transact：餘額不足不執行、執行失敗不扣款、成功只扣一次", () => {
  const w = newWallet(10);
  let runs = 0;
  const poor = transact(w, "x", "appraisal", 20, "", () => (runs++, { ok: true, value: 1 }));
  assert.equal(poor.ok, false);
  assert.equal(runs, 0);
  const bad = transact(w, "y", "appraisal", 5, "", () => (runs++, { ok: false, message: "失敗" }));
  assert.equal(bad.ok, false);
  assert.equal(w.balance, 10);
  const good = transact(w, "z", "appraisal", 5, "", () => (runs++, { ok: true, value: 2 }));
  const again = transact(w, "z", "appraisal", 5, "", () => (runs++, { ok: true, value: 3 }));
  assert.ok(good.ok && again.ok);
  assert.equal(w.balance, 5);
  assert.equal(runs, 2);
  assert.ok(ledgerConsistent(w, 10));
});

test("經濟設定：正式值未定案 → null 並列出缺少的項目；測試設定有明確標示", () => {
  const off = resolveEconomy("official", ecoRaw);
  assert.ok(off.missing.length > 0);
  assert.equal(rollGold(off, "star_dew_bobo", 0.5), 0);
  assert.equal(npcBuyPrice(off, "monsterMaterial", 1), null);
  const t = resolveEconomy("test", ecoRaw);
  assert.equal(t.mode, "test");
  for (const r of [0, 0.3, 0.999]) {
    const g = rollGold(t, "star_dew_bobo", r);
    assert.ok(g >= 3 && g <= 8);
  }
});

test("存檔：往返不失真；跨地圖保留生命、裝備欄、金幣、背包、寵物；壞存檔回 null", () => {
  const w = world();
  w.pets.giveItem("seed", 2);
  w.pets.giveItem("monsterMaterial", 3);
  credit(w.save.wallet, "t1", "test", 33);
  w.save.character.hp = 61;
  travel(w.save, { map: "starsprout", x: -56, z: -64, yaw: 0.7 });
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  assert.ok(writeGameSave(storage, w.save));
  const back = loadGameSave(storage)!;
  assert.equal(back.character.map, "starsprout");
  assert.equal(back.character.hp, 61);
  assert.equal(back.wallet.balance, w.save.wallet.balance);
  assert.deepEqual(back.equipment, w.save.equipment);
  assert.equal(back.pets.bag.length, w.save.pets.bag.length);
  assert.equal(back.pets.items.monsterMaterial, 3);
  assert.equal(parseGameSave("{bad"), null);
  assert.equal(parseGameSave(JSON.stringify({ v: 99 })), null);
  assert.ok(mem.has(GAME_SAVE_KEY));
});

test("掉落物唯一編號：每個掉落一個 uid，同一個 uid 只能撿一次；背包物品編號不重複", () => {
  const w = world();
  const a = nextLootUid(w.save);
  const b = nextLootUid(w.save);
  assert.notEqual(a, b);
  assert.equal(claimLoot(w.save, a), true);
  assert.equal(claimLoot(w.save, a), false);
  w.pets.giveItem("seed", 3);
  w.pets.giveItem("egg", 2);
  const ids = allUids(w.save);
  assert.equal(new Set(ids).size, ids.length);
});

test("洛恩鑑定：收鑑定費（測試 20）、金幣不足不鑑定、同一請求只扣一次", async () => {
  const w = world();
  w.pets.giveItem("seed", 2);
  const [s1, s2] = w.pets.bag();
  const start = w.save.wallet.balance;
  const r = await w.appraisal.appraise(s1!.id, "rq1");
  assert.ok(r.ok);
  const r2 = await w.appraisal.appraise(s1!.id, "rq1");
  assert.ok(r2.ok);
  assert.equal(w.save.wallet.balance, start - 20);
  debit(w.save.wallet, "drain", "test", w.save.wallet.balance);
  const poor = await w.appraisal.appraise(s2!.id, "rq2");
  assert.equal(poor.ok, false);
  assert.equal(w.pets.bag().find((b) => b.id === s2!.id)!.affixes ?? null, null);
  assert.ok(ledgerConsistent(w.save.wallet, start));
});

test("商會本機服務：買賣扣入款、掛賣鎖定、取消解鎖、不能重複賣、沒有假玩家成交", async () => {
  const w = world();
  assert.equal(w.guild.serverBacked, false);
  const start = w.save.wallet.balance;
  const buy = await w.guild.buyFromShop("shop:feed", 2, "b1");
  const buyAgain = await w.guild.buyFromShop("shop:feed", 2, "b1");
  assert.ok(buy.ok && buyAgain.ok);
  assert.equal(w.save.wallet.balance, start - 20);
  assert.equal(w.save.pets.items.shopFeed, 2);
  assert.equal((await w.guild.buyFromShop("shop:seed", 9, "b2")).ok, false); // 金幣不足
  w.pets.giveItem("seed", 1);
  const seed = w.pets.bag()[0]!;
  const lst = await w.guild.createListing(seed.id, 300, "l1");
  assert.ok(lst.ok);
  assert.equal(w.pets.bag()[0]!.locked, true);
  assert.equal((await w.guild.sellToShop(seed.id, "s1")).ok, false); // 掛賣中不能賣 NPC
  assert.equal((await w.guild.createListing(seed.id, 300, "l2")).ok, false); // 不能重複掛賣
  if (lst.ok) {
    const own = await w.guild.buyListing(lst.data.listingId, "x1");
    assert.equal(own.ok, false);
    const c = await w.guild.cancelListing(lst.data.listingId, "c1");
    assert.ok(c.ok);
  }
  assert.equal(!!w.pets.bag()[0]!.locked, false);
  const before = w.save.wallet.balance;
  const sold = await w.guild.sellToShop(seed.id, "s2");
  const soldAgain = await w.guild.sellToShop(seed.id, "s2");
  assert.ok(sold.ok && soldAgain.ok);
  assert.equal(w.pets.bag().length, 0);
  assert.equal(w.save.wallet.balance, before + Math.floor(40 * 0.3));
  const e = await w.guild.earnings();
  assert.ok(e.ok && e.data.pending === 0);
  assert.ok(ledgerConsistent(w.save.wallet, start));
});

test("寵物（測試設定）：飽食度下降、餓肚子停止成長、餓太久變靈魂、靈魂復活收費一次", () => {
  const w = world();
  w.pets.giveItem("seed", 1);
  const p = w.pets.hatch("seed", 0, w.pets.bag()[0]!.id)!;
  const t = w.pets.tuning;
  tickPet(p, t, (t.hatchSeconds ?? 0) * 1000 + 1);
  assert.ok(p.stage >= 1);
  assert.ok((p.satiety ?? 0) > 0);
  const care = t.care!;
  const hoursToZero = care.satietyMax / care.satietyLossPerHour;
  let now = (t.hatchSeconds ?? 0) * 1000 + 1;
  now += hoursToZero * 3600_000 + 1000;
  tickPet(p, t, now);
  assert.equal(p.satiety, 0);
  const exp = p.exp;
  now += (care.starveDeathMinutes - 1) * 60_000;
  tickPet(p, t, now);
  assert.equal(p.exp, exp); // 餓肚子不成長
  assert.equal(isSoul(p), false);
  now += 2 * 60_000;
  const r = tickPet(p, t, now);
  assert.equal(r.died, true);
  assert.equal(isSoul(p), true);
  const bal = w.save.wallet.balance;
  const rv = w.pets.revive(p.id, "rv1", w.save.wallet);
  const rv2 = w.pets.revive(p.id, "rv1", w.save.wallet);
  assert.ok(rv.ok);
  assert.equal(rv2.ok, false); // 已經復活
  assert.equal(isSoul(p), false);
  assert.equal(w.save.wallet.balance, bal - care.reviveFee);
  assert.equal(p.satiety, Math.round(care.satietyMax * care.reviveSatietyRatio));
});

test("寵物四個成長階段：大小依序變大、完成體不超過約臉的大小", () => {
  const s = petCfg.visual!.stageSize;
  assert.equal(s.length, 5);
  for (let i = 2; i < s.length; i++) assert.ok(s[i]! > s[i - 1]! * 1.3);
  assert.ok(s[4]! <= 0.24);
});
