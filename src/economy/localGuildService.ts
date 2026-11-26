/**
 * 星願商會：本機服務（Stage 7，接在真正的角色存檔上）。
 * - NPC 道具店：用角色金幣購買（扣款）、把背包物品賣給 NPC（入帳）；全部帶 requestId，不會重複扣款或重複入帳
 * - 交易所：可以掛賣、取消（物品鎖定、寵物暫停飽食度與成長）。**沒有共用伺服器 → 沒有其他玩家**：
 *   serverBacked = false，畫面標示「本機示範：不是真正的多人交易」；不產生假玩家或假成交
 * - 價格、手續費、收購價：economy.json 的測試設定（正式值未定案 → 對應功能停用）
 * 型別使用 Claude B 的 guildMarket.ts（GuildMarketService）。
 */
import type { GuildConfig, GuildMarketService, Listing, MarketItem, MarketResult, MarketFail, AffixLine, ShopOffer } from "../maps/village/guildMarket.ts";
import { sortListings, matchText, validatePrice } from "../maps/village/guildMarket.ts";
import { addItems, affixText, bonusScale, isSoul, type FeedId, type ItemId, type PetSourceId } from "../pets/petSystem.ts";
import type { PetManager } from "../pets/PetManager.ts";
import type { GameSave, LocalListing } from "../core/gameSave.ts";
import { credit, transact } from "./wallet.ts";
import { npcBuyPrice, type Economy } from "./economyConfig.ts";

const STACKS: readonly FeedId[] = ["monsterMaterial", "shopFeed"];
const NAME: Record<ItemId, string> = { seed: "星芽種子", egg: "孵化蛋", birdEgg: "鳥蛋", monsterMaterial: "怪物材料", shopFeed: "寵物飼料" };
const ICON: Record<ItemId, string> = { seed: "herb", egg: "egg", birdEgg: "egg", monsterMaterial: "herb", shopFeed: "feed" };

export interface LocalGuildDeps {
  save: GameSave;
  pets: PetManager;
  economy: Economy;
  /** 存檔（每次異動後呼叫） */
  persist: () => void;
  now?: () => number;
}

export function createLocalGuildService(d: LocalGuildDeps): GuildMarketService {
  const now = d.now ?? (() => Date.now());
  const e = d.economy;
  const s = d.save;
  const m = d.pets;
  const cfg: GuildConfig = { ...e.market, currency: "金幣" };
  const ok = <T>(data: T): Promise<MarketResult<T>> => Promise.resolve({ ok: true, data });
  const fail = <T>(reason: MarketFail, message: string): Promise<MarketResult<T>> => Promise.resolve({ ok: false, reason, message });
  const done = s.market.done as Record<string, MarketResult<unknown>>;
  /** requestId 冪等：同一個請求只處理一次，重送回傳第一次的結果 */
  const once = <T>(rid: string, fn: () => MarketResult<T>): Promise<MarketResult<T>> => {
    const prev = done[rid];
    if (prev) return Promise.resolve(prev as MarketResult<T>);
    const r = fn();
    if (r.ok) {
      done[rid] = r;
      const keys = Object.keys(done);
      if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete done[k];
    }
    d.persist();
    return Promise.resolve(r);
  };
  const active = (): LocalListing[] => s.market.listings.filter((l) => l.status === "active");
  const escrow = (k: FeedId): number => active().filter((l) => l.uid === `stack:${k}`).reduce((a, l) => a + (l.escrowQty ?? 0), 0);

  const petLines = (affixes: { stat: string; value: number }[] | null): AffixLine[] =>
    (affixes ?? []).map((a) => {
      const st = m.cfg.appraisal.stats.find((x) => x.stat === a.stat);
      return { label: st?.label ?? a.stat, text: affixText(m.cfg, a as never).replace(`${st?.label ?? a.stat} `, ""), polarity: a.value > 0 ? "positive" : a.value < 0 ? "negative" : "none" };
    });

  /** 背包內容 → 交易物品（每一個都有唯一 uid） */
  const listItems = (): MarketItem[] => {
    const out: MarketItem[] = [];
    for (const b of m.bag())
      out.push({ uid: b.id, category: "item", name: NAME[b.kind], icon: ICON[b.kind], qty: 1, locked: !!b.locked, description: b.affixes ? `已鑑定：${b.affixes.length ? b.affixes.map((a) => affixText(m.cfg, a)).join("、") : "無附加屬性"}` : "未鑑定" });
    for (const k of STACKS) {
      const free = s.pets.items[k];
      const held = escrow(k);
      if (free > 0) out.push({ uid: `stack:${k}`, category: "item", name: NAME[k], icon: ICON[k], qty: free, locked: false });
      if (held > 0) out.push({ uid: `stack:${k}`, category: "item", name: NAME[k], icon: ICON[k], qty: held, locked: true, description: "掛賣中" });
    }
    return out;
  };
  const listPets = (): MarketItem[] =>
    s.pets.pets
      .filter((p) => p.stage > 0 && !isSoul(p))
      .map((p) => {
        const sp = m.cfg.species.find((x) => x.id === p.species);
        return {
          uid: `pet:${p.id}`,
          category: "pet" as const,
          name: sp?.label ?? p.species,
          icon: p.species === "bird" ? "pet_bird" : "pet_rabbit",
          qty: 1,
          locked: !!p.frozen,
          pet: { stage: sp?.stages[p.stage]?.label ?? String(p.stage), breedLevel: Math.round(bonusScale(m.cfg, p, m.tuning) * 100), appraised: p.affixes !== null, affixes: petLines(p.affixes), frozen: !!p.frozen },
        };
      });
  const findItem = (uid: string): MarketItem | undefined => [...listItems(), ...listPets()].find((x) => x.uid === uid && !x.locked);
  const toListing = (l: LocalListing): Listing => {
    const it = [...listItems(), ...listPets()].find((x) => x.uid === l.uid && (x.locked || l.status !== "active"));
    const item: MarketItem = it ? { ...it, ...(l.escrowQty ? { qty: l.escrowQty } : {}) } : { uid: l.uid, category: l.category, name: l.uid, icon: "herb", qty: l.escrowQty ?? 1, locked: l.status === "active" };
    return { listingId: l.listingId, seller: "我", mine: true, item, price: l.price, listedAt: l.listedAt, expiresAt: l.expiresAt, status: l.status };
  };
  /** 把物品從背包移除（賣給 NPC） */
  const removeItem = (uid: string): boolean => {
    if (uid.startsWith("stack:")) {
      const k = uid.slice(6) as FeedId;
      if (s.pets.items[k] <= 0) return false;
      s.pets.items[k] = 0;
      return true;
    }
    if (uid.startsWith("item:")) {
      const bag = m.bag();
      const i = bag.findIndex((b) => b.id === uid && !b.locked);
      if (i < 0) return false;
      const [it] = bag.splice(i, 1);
      s.pets.items[it!.kind] -= 1;
      return true;
    }
    if (uid.startsWith("pet:")) {
      const id = Number(uid.slice(4));
      const i = s.pets.pets.findIndex((p) => p.id === id && !p.frozen);
      if (i < 0) return false;
      if (s.pets.equippedId === id) s.pets.equippedId = null;
      s.pets.pets.splice(i, 1);
      return true;
    }
    return false;
  };
  const priceOf = (uid: string): number | null => {
    if (uid.startsWith("stack:")) {
      const k = uid.slice(6) as FeedId;
      return npcBuyPrice(e, k, s.pets.items[k]);
    }
    if (uid.startsWith("item:")) {
      const b = m.bag().find((x) => x.id === uid);
      return b ? npcBuyPrice(e, b.kind as PetSourceId, 1) : null;
    }
    if (uid.startsWith("pet:")) {
      const p = s.pets.pets.find((x) => x.id === Number(uid.slice(4)));
      // 寵物收購價：未定案（不自行定價）
      return p ? null : null;
    }
    return null;
  };

  return {
    available: true,
    testData: e.mode === "test",
    serverBacked: false,
    config: () => ok({ ...cfg }),
    gold: () => ok(s.wallet.balance),
    shopCatalog: () => ok(e.shop.map((o): ShopOffer => ({ offerId: o.offerId, name: o.name, icon: ICON[o.item], price: o.price, description: o.price === null ? "價格未定案（不能購買）" : e.mode === "test" ? "測試價格" : undefined }))),
    buyFromShop(offerId, qty, rid) {
      return once(rid, () => {
        const o = e.shop.find((x) => x.offerId === offerId);
        if (!o) return { ok: false, reason: "notFound", message: "沒有這項商品。" };
        if (o.price === null) return { ok: false, reason: "priceUnset", message: "這項商品的價格尚未定案。" };
        const n = Math.max(1, Math.min(99, Math.floor(qty)));
        const r = transact(s.wallet, rid, "shopBuy", o.price * n, `${o.offerId}×${n}`, () => {
          addItems(s.pets, Array.from({ length: n }, () => o.item), now());
          return { ok: true, value: true };
        }, now());
        if (!r.ok) return { ok: false, reason: r.reason === "notEnoughGold" ? "notEnoughGold" : "error", message: r.message };
        const received = listItems().find((x) => (o.item === "shopFeed" || o.item === "monsterMaterial" ? x.uid === `stack:${o.item}` && !x.locked : x.name === NAME[o.item])) ?? { uid: "", category: "item" as const, name: o.name, icon: ICON[o.item], qty: n, locked: false };
        return { ok: true, data: { gold: s.wallet.balance, received: { ...received, qty: n } } };
      });
    },
    inventory: (category) => ok(category === "item" ? listItems() : category === "pet" ? listPets() : []),
    npcBuyPrice(uid) {
      if (![...listItems(), ...listPets()].some((x) => x.uid === uid)) return fail("notFound", "找不到這個物品。");
      return ok(priceOf(uid));
    },
    sellToShop(uid, rid) {
      return once(rid, () => {
        const it = [...listItems(), ...listPets()].find((x) => x.uid === uid);
        if (!it) return { ok: false, reason: "notFound", message: "找不到這個物品。" };
        if (!findItem(uid)) return { ok: false, reason: "locked", message: "這個物品正在掛賣中，不能出售。" };
        const paid = priceOf(uid);
        if (paid === null) return { ok: false, reason: "priceUnset", message: "收購價格尚未定案。" };
        if (!removeItem(uid)) return { ok: false, reason: "error", message: "出售失敗。" };
        const c = credit(s.wallet, rid, "shopSell", paid, uid, now());
        if (!c.ok) return { ok: false, reason: "error", message: c.message };
        return { ok: true, data: { gold: s.wallet.balance, paid } };
      });
    },
    search(q) {
      // 本機沒有其他玩家：只列出自己的掛賣（不能購買自己的商品）；不產生假玩家資料
      const all = sortListings(active().map(toListing).filter((l) => l.item.category === q.category && matchText(l.item, q.text ?? "")), q.sort ?? "priceAsc");
      const size = q.pageSize ?? 20;
      const page = q.page ?? 0;
      return ok({ total: all.length, listings: all.slice(page * size, page * size + size) });
    },
    createListing(uid, price, rid) {
      return once(rid, () => {
        if (cfg.feeRate === null || cfg.listingHours === null || cfg.maxListings === null) return { ok: false, reason: "unavailable", message: "交易所的手續費、期限或上限尚未定案。" };
        const it = findItem(uid);
        if (!it) return { ok: false, reason: [...listItems(), ...listPets()].some((x) => x.uid === uid) ? "locked" : "notFound", message: "找不到可以掛賣的物品（可能已經在掛賣中）。" };
        const bad = validatePrice(price, cfg);
        if (bad) return { ok: false, reason: "invalidPrice", message: bad };
        if (active().length >= cfg.maxListings) return { ok: false, reason: "limitReached", message: `同時最多掛賣 ${cfg.maxListings} 件。` };
        // 交易系統鎖定：可堆疊道具整疊交給交易系統保管；個體物品、寵物標記鎖定（寵物暫停飽食度與成長）
        let escrowQty: number | undefined;
        if (uid.startsWith("stack:")) {
          const k = uid.slice(6) as FeedId;
          escrowQty = s.pets.items[k];
          s.pets.items[k] = 0;
        } else if (uid.startsWith("item:")) {
          const b = m.bag().find((x) => x.id === uid)!;
          b.locked = true;
        } else {
          const p = s.pets.pets.find((x) => x.id === Number(uid.slice(4)))!;
          if (s.pets.equippedId === p.id) s.pets.equippedId = null;
          p.frozen = true;
        }
        const t = now();
        s.market.seq += 1;
        const l: LocalListing = { listingId: `local:${s.market.seq}`, uid, category: it.category, price, listedAt: t, expiresAt: t + cfg.listingHours * 3600_000, status: "active", ...(escrowQty ? { escrowQty } : {}) };
        s.market.listings.push(l);
        return { ok: true, data: toListing(l) };
      });
    },
    buyListing(listingId) {
      const l = s.market.listings.find((x) => x.listingId === listingId);
      if (!l || l.status !== "active") return fail("soldOut", "這件商品已經售出或下架。");
      return fail("ownListing", "不能購買自己的掛賣。（本機版沒有其他玩家；真正的玩家交易需要共用伺服器）");
    },
    cancelListing(listingId, rid) {
      return once(rid, () => {
        const l = s.market.listings.find((x) => x.listingId === listingId);
        if (!l || l.status !== "active") return { ok: false, reason: "notFound", message: "找不到這筆掛賣。" };
        l.status = "cancelled";
        if (l.uid.startsWith("stack:")) s.pets.items[l.uid.slice(6) as FeedId] += l.escrowQty ?? 0;
        else if (l.uid.startsWith("item:")) {
          const b = m.bag().find((x) => x.id === l.uid);
          if (b) b.locked = false;
        } else {
          const p = s.pets.pets.find((x) => x.id === Number(l.uid.slice(4)));
          if (p) {
            p.frozen = false;
            p.lastTickAt = now(); // 掛賣期間不算時間（不消耗飽食度、不成長）
          }
        }
        const back = [...listItems(), ...listPets()].find((x) => x.uid === l.uid && !x.locked);
        return { ok: true, data: back ?? toListing(l).item };
      });
    },
    myListings: () => ok(s.market.listings.map(toListing)),
    earnings: () => ok({ pending: 0, sales: 0 }),
    claimEarnings(rid) {
      // 本機沒有成交（沒有其他玩家），可領收益永遠是 0；仍保持冪等
      return once(rid, () => ({ ok: true, data: { claimed: 0, gold: s.wallet.balance } }));
    },
  };
}
