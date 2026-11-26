import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILDINGS, NPC_SPOTS, BOX_COLLIDERS, insideBox, standable, reachable, VILLAGE_SPOTS } from "../../src/maps/village/layout.ts";
import { createDemoGuildService, DEMO_CONFIG, feeOf, PLACEHOLDER_GUILD_SERVICE, simulateDemoSale, sortListings, UNSET_CONFIG, validatePrice, cfgText } from "../../src/maps/village/guildMarket.ts";

test("星願商會：一棟建築、一位固定位置的商會 NPC（碰撞箱外、可站、出生點可走到）", () => {
  const g = BUILDINGS.filter((b) => b.id === "guild");
  assert.equal(g.length, 1);
  const npc = NPC_SPOTS.filter((n) => n.id === "guild");
  assert.equal(npc.length, 1);
  const box = BOX_COLLIDERS.find((c) => c.kind === "building:guild")!;
  assert.ok(!insideBox(box, npc[0]!.x, npc[0]!.z));
  assert.ok(standable(npc[0]!.x, npc[0]!.z));
  const sp = VILLAGE_SPOTS.find((s) => s.id === "spawn")!;
  assert.ok(reachable(sp.x, sp.z, npc[0]!.x, npc[0]!.z));
});

test("可配置欄位：未定案顯示「未定案」；占位服務不可用；示範服務標示測試且不是伺服器交易", async () => {
  assert.equal(cfgText(UNSET_CONFIG.feeRate, String), "未定案");
  assert.equal(feeOf(1000, UNSET_CONFIG), null);
  assert.equal(PLACEHOLDER_GUILD_SERVICE.available, false);
  const r = await PLACEHOLDER_GUILD_SERVICE.search({ category: "item" });
  assert.equal(r.ok, false);
  const d = createDemoGuildService({ delayMs: 0 });
  assert.ok(d.testData && !d.serverBacked);
  assert.equal(validatePrice(0, DEMO_CONFIG) !== null, true);
  assert.equal(validatePrice(1.5, DEMO_CONFIG) !== null, true);
  assert.equal(validatePrice(100, DEMO_CONFIG), null);
});

test("掛賣：物品由交易系統鎖定（不能出售、不能再掛賣），寵物暫停飽食度與成長；取消後解鎖", async () => {
  const s = createDemoGuildService({ delayMs: 0 });
  const pets = await s.inventory("pet");
  assert.ok(pets.ok);
  const pet = pets.data[0]!;
  const l = await s.createListing(pet.uid, 1000, "r1");
  assert.ok(l.ok);
  const again = await s.createListing(pet.uid, 900, "r2");
  assert.ok(!again.ok && again.reason === "locked");
  const sell = await s.sellToShop(pet.uid, "r3");
  assert.ok(!sell.ok && sell.reason === "locked");
  const inv = await s.inventory("pet");
  assert.ok(inv.ok);
  const locked = inv.data.find((i) => i.uid === pet.uid)!;
  assert.ok(locked.locked && locked.pet!.frozen);
  const c = await s.cancelListing(l.data.listingId, "r4");
  assert.ok(c.ok && !c.data.locked && !c.data.pet!.frozen);
});

test("同一個 requestId 只處理一次（不重複扣款、不重複轉移）；不能買自己的掛賣；售出後收益只能領一次", async () => {
  const s = createDemoGuildService({ delayMs: 0 });
  const g0 = (await s.gold()) as { ok: true; data: number };
  const shop = await s.shopCatalog();
  assert.ok(shop.ok);
  const a = await s.buyFromShop(shop.data[0]!.offerId, 2, "same");
  const b = await s.buyFromShop(shop.data[0]!.offerId, 2, "same");
  assert.deepEqual(a, b);
  const g1 = (await s.gold()) as { ok: true; data: number };
  assert.equal(g0.data - g1.data, shop.data[0]!.price! * 2);
  const unset = shop.data.find((o) => o.price === null)!;
  const u = await s.buyFromShop(unset.offerId, 1, "u1");
  assert.ok(!u.ok && u.reason === "priceUnset");
  // 掛賣 → 不能買自己的 → 模擬他人買走 → 收益扣手續費 → 只能領一次
  const items = await s.inventory("item");
  assert.ok(items.ok);
  const it = items.data.find((i) => !i.locked)!;
  const l = await s.createListing(it.uid, 1000, "L1");
  assert.ok(l.ok);
  const own = await s.buyListing(l.data.listingId, "B1");
  assert.ok(!own.ok && own.reason === "ownListing");
  assert.ok(simulateDemoSale(s, l.data.listingId));
  const e = await s.earnings();
  assert.ok(e.ok && e.data.pending === 1000 - feeOf(1000, DEMO_CONFIG)!);
  const c1 = await s.claimEarnings("C1");
  const c2 = await s.claimEarnings("C2");
  assert.ok(c1.ok && c1.data.claimed === 950 && c2.ok && c2.data.claimed === 0);
});

test("交易所：分類、搜尋、價格排序；購買後物品轉移到背包、該筆下架", async () => {
  const s = createDemoGuildService({ delayMs: 0 });
  for (const cat of ["item", "equipment", "pet"] as const) {
    const r = await s.search({ category: cat, sort: "priceAsc" });
    assert.ok(r.ok && r.data.listings.length > 0 && r.data.listings.every((l) => l.item.category === cat));
    const prices = r.data.listings.map((l) => l.price);
    assert.deepEqual(prices, [...prices].sort((x, y) => x - y));
  }
  const eq = await s.search({ category: "equipment", text: "防禦力" });
  assert.ok(eq.ok && eq.data.listings.length >= 1);
  const pet = await s.search({ category: "pet", sort: "priceDesc" });
  assert.ok(pet.ok);
  const target = pet.data.listings[0]!;
  assert.ok(target.item.pet && typeof target.item.pet.breedLevel === "number" && target.item.pet.stage.length > 0);
  const before = await s.inventory("pet");
  const r = await s.buyListing(target.listingId, "buy1");
  assert.ok(r.ok && !r.data.received.locked && r.data.received.pet!.frozen === false);
  const after = await s.inventory("pet");
  assert.ok(before.ok && after.ok && after.data.length === before.data.length + 1);
  const again = await s.buyListing(target.listingId, "buy2");
  assert.ok(!again.ok && again.reason === "soldOut");
  assert.deepEqual(sortListings([], "newest"), []);
});

test("掛賣上限（可配置）：達到上限後不能再掛賣", async () => {
  const s = createDemoGuildService({ delayMs: 0, config: { ...DEMO_CONFIG, maxListings: 1 } });
  const items = await s.inventory("item");
  assert.ok(items.ok);
  assert.ok((await s.createListing(items.data[0]!.uid, 10, "a")).ok);
  const r = await s.createListing(items.data[1]!.uid, 10, "b");
  assert.ok(!r.ok && r.reason === "limitReached");
});
