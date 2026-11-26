/**
 * 星願商會（道具店＋玩家交易所）：介面用的型別、可配置欄位、串接介面與「測試資料」示範服務（純邏輯，可單元測試）。
 *
 * 分工：
 * - Claude B：建築、NPC、介面、這個串接介面
 * - 核心系統（後續）：交易核心、金幣、物品唯一 ID、所有權轉移、持久化資料、**共用伺服器**上的多人交易
 *
 * 原則：
 * - 介面只透過 GuildMarketService 呼叫；不自己決定價格、手續費、期限、上限，也不自己轉移物品
 * - 正式玩家交易必須由共用伺服器處理（serverBacked＝true）。本機示範服務一律 serverBacked＝false、testData＝true，
 *   畫面明確標示「測試資料・本機示範，不是真正的多人交易」
 * - 掛賣期間物品由交易系統鎖定（不能再掛賣、出售、使用、複製）；掛賣中的寵物暫停飽食度消耗與成長
 * - 手續費、掛賣期限、掛賣上限、NPC 收購價格尚未定案：GuildConfig 每個欄位都可配置，null＝未定案（畫面顯示「未定案」）
 * - 每個會改資料的呼叫都帶 requestId：同一個 requestId 只處理一次（重送回傳第一次的結果），避免重複扣款或重複轉移
 */
import type { PetStageName } from "./petMerchant.ts";

export type MarketCategory = "item" | "equipment" | "pet";
export const MARKET_CATEGORIES: readonly MarketCategory[] = ["item", "equipment", "pet"];
export const CATEGORY_LABEL: Readonly<Record<MarketCategory, string>> = { item: "道具", equipment: "裝備", pet: "寵物" };

export interface AffixLine {
  label: string;
  /** 顯示文字（例：+15%、-2） */
  text: string;
  polarity: "positive" | "negative" | "none";
}

/** 交易物品（每一個都是核心系統的唯一個體 uid；可堆疊道具以「一疊」為單位，qty＝數量） */
export interface MarketItem {
  uid: string;
  category: MarketCategory;
  name: string;
  /** 圖示種類（介面畫圖示用） */
  icon: string;
  qty: number;
  /** 交易系統鎖定（掛賣中）：不能出售、再掛賣、使用 */
  locked: boolean;
  equipment?: { level: number; enhance: number; appraised: boolean; affixes: readonly AffixLine[] };
  pet?: { /** 成長階段：初始／幼年期／成長期／完成體（PET_STAGES） */ stage: PetStageName; breedLevel: number; appraised: boolean; affixes: readonly AffixLine[]; /** 掛賣中：暫停飽食度與成長 */ frozen: boolean };
  description?: string;
}

export interface ShopOffer {
  offerId: string;
  name: string;
  icon: string;
  /** null＝價格未定案（不能購買） */
  price: number | null;
  description?: string;
}

export interface Listing {
  listingId: string;
  seller: string;
  mine: boolean;
  item: MarketItem;
  /** 總價（金幣） */
  price: number;
  listedAt: number;
  /** null＝期限未定案或不限 */
  expiresAt: number | null;
  status: "active" | "sold" | "cancelled" | "expired";
}

/** 可配置欄位（null＝未定案；正式值由企劃確認後由核心系統提供） */
export interface GuildConfig {
  /** 成交手續費比例（0～1） */
  feeRate: number | null;
  /** 掛賣期限（小時） */
  listingHours: number | null;
  /** 每位玩家同時掛賣上限 */
  maxListings: number | null;
  /** NPC 收購價比例（相對物品基準價） */
  npcBuyRate: number | null;
  /** 最低／最高掛賣價（防呆） */
  minPrice: number | null;
  maxPrice: number | null;
  currency: string;
}

export const UNSET_CONFIG: GuildConfig = Object.freeze({ feeRate: null, listingHours: null, maxListings: null, npcBuyRate: null, minPrice: null, maxPrice: null, currency: "金幣" });

export type SortKey = "priceAsc" | "priceDesc" | "newest";
export interface MarketQuery {
  category: MarketCategory;
  text?: string;
  sort?: SortKey;
  page?: number;
  pageSize?: number;
}

export type MarketFail = "unavailable" | "notServerBacked" | "notFound" | "locked" | "notOwner" | "ownListing" | "limitReached" | "invalidPrice" | "notEnoughGold" | "soldOut" | "priceUnset" | "busy" | "error";
export type MarketResult<T> = { ok: true; data: T } | { ok: false; reason: MarketFail; message: string };

/** 核心系統需要提供的商會服務（介面只呼叫這些） */
export interface GuildMarketService {
  readonly available: boolean;
  /** true＝測試資料（畫面標示） */
  readonly testData: boolean;
  /** true＝玩家交易由共用伺服器處理；false 時畫面標示「本機示範，不是真正的多人交易」 */
  readonly serverBacked: boolean;
  config(): Promise<MarketResult<GuildConfig>>;
  gold(): Promise<MarketResult<number>>;
  // ---- NPC 道具店 ----
  shopCatalog(): Promise<MarketResult<readonly ShopOffer[]>>;
  buyFromShop(offerId: string, qty: number, requestId: string): Promise<MarketResult<{ gold: number; received: MarketItem }>>;
  /** 可以賣給 NPC／掛賣的背包內容（含鎖定中的，畫面顯示「掛賣中」） */
  inventory(category: MarketCategory): Promise<MarketResult<readonly MarketItem[]>>;
  /** NPC 收購價（null＝未定案，不能出售） */
  npcBuyPrice(uid: string): Promise<MarketResult<number | null>>;
  sellToShop(uid: string, requestId: string): Promise<MarketResult<{ gold: number; paid: number }>>;
  // ---- 玩家交易所 ----
  search(q: MarketQuery): Promise<MarketResult<{ total: number; listings: readonly Listing[] }>>;
  createListing(uid: string, price: number, requestId: string): Promise<MarketResult<Listing>>;
  buyListing(listingId: string, requestId: string): Promise<MarketResult<{ gold: number; received: MarketItem }>>;
  cancelListing(listingId: string, requestId: string): Promise<MarketResult<MarketItem>>;
  myListings(): Promise<MarketResult<readonly Listing[]>>;
  earnings(): Promise<MarketResult<{ pending: number; sales: number }>>;
  claimEarnings(requestId: string): Promise<MarketResult<{ claimed: number; gold: number }>>;
}

// ---------------------------------------------------------------- 顯示工具（純函式）

export function cfgText(v: number | null, fmt: (n: number) => string): string {
  return v === null ? "未定案" : fmt(v);
}

export function feeOf(price: number, cfg: GuildConfig): number | null {
  return cfg.feeRate === null ? null : Math.floor(price * cfg.feeRate);
}

export function validatePrice(price: number, cfg: GuildConfig): string | null {
  if (!Number.isFinite(price) || !Number.isInteger(price) || price <= 0) return "請輸入正整數價格";
  if (cfg.minPrice !== null && price < cfg.minPrice) return `價格不能低於 ${cfg.minPrice}`;
  if (cfg.maxPrice !== null && price > cfg.maxPrice) return `價格不能高於 ${cfg.maxPrice}`;
  return null;
}

export function sortListings(list: readonly Listing[], sort: SortKey): Listing[] {
  const out = list.slice();
  if (sort === "priceAsc") out.sort((a, b) => a.price - b.price || a.listedAt - b.listedAt);
  else if (sort === "priceDesc") out.sort((a, b) => b.price - a.price || a.listedAt - b.listedAt);
  else out.sort((a, b) => b.listedAt - a.listedAt);
  return out;
}

export function matchText(it: MarketItem, text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  const hay = [it.name, it.description ?? "", ...(it.equipment?.affixes ?? []).map((a) => a.label), ...(it.pet?.affixes ?? []).map((a) => a.label), it.pet?.stage ?? ""].join(" ").toLowerCase();
  return t.split(/\s+/).every((w) => hay.includes(w));
}

let reqSeq = 0;
export function newMarketRequestId(): string {
  reqSeq += 1;
  return `mkt-${Date.now().toString(36)}-${reqSeq}`;
}

// ---------------------------------------------------------------- 占位服務（正式版未接入時）

const NOT_READY = "星願商會的交易系統尚未開放，敬請期待。";
const off = async (): Promise<{ ok: false; reason: "unavailable"; message: string }> => ({ ok: false, reason: "unavailable", message: NOT_READY });
export const PLACEHOLDER_GUILD_SERVICE: GuildMarketService = Object.freeze({
  available: false,
  testData: false,
  serverBacked: false,
  config: off,
  gold: off,
  shopCatalog: off,
  buyFromShop: off,
  inventory: off,
  npcBuyPrice: off,
  sellToShop: off,
  search: off,
  createListing: off,
  buyListing: off,
  cancelListing: off,
  myListings: off,
  earnings: off,
  claimEarnings: off,
});

let current: GuildMarketService = PLACEHOLDER_GUILD_SERVICE;
export function connectGuildMarketService(s: GuildMarketService | null): void {
  current = s ?? PLACEHOLDER_GUILD_SERVICE;
}
export function guildMarketService(): GuildMarketService {
  return current;
}

// ---------------------------------------------------------------- 測試資料示範服務（本機、非多人）

const pctLine = (label: string, v: number): AffixLine => ({ label, text: `${v > 0 ? "+" : ""}${v}%`, polarity: v > 0 ? "positive" : v < 0 ? "negative" : "none" });
const flatLine = (label: string, v: number): AffixLine => ({ label, text: `${v > 0 ? "+" : ""}${v}`, polarity: v > 0 ? "positive" : v < 0 ? "negative" : "none" });

/** 示範用可配置值（明確標示測試；不是正式數值） */
export const DEMO_CONFIG: GuildConfig = Object.freeze({ feeRate: 0.05, listingHours: 24, maxListings: 5, npcBuyRate: 0.3, minPrice: 1, maxPrice: 999999, currency: "金幣" });

/**
 * 本機示範服務：只用來展示完整操作流程。
 * - serverBacked＝false：畫面必須標示「不是真正的多人交易」；其他玩家的掛賣是固定的示範資料
 * - 掛賣：物品鎖定（locked）、寵物凍結（frozen：暫停飽食度與成長）；取消後解鎖；成交後轉移
 * - 每個 requestId 只處理一次
 */
export function createDemoGuildService(opts: { delayMs?: number; config?: GuildConfig; now?: () => number } = {}): GuildMarketService & { debug(): { gold: number; pending: number; inv: number; locked: number } } {
  const delay = opts.delayMs ?? 250;
  const cfg = opts.config ?? DEMO_CONFIG;
  const now = opts.now ?? (() => Date.now());
  let gold = 5000;
  let pending = 0;
  let sales = 0;
  let uidSeq = 100;
  let listSeq = 100;
  const done = new Map<string, MarketResult<unknown>>();
  const wait = (): Promise<void> => new Promise((r) => setTimeout(r, delay));
  const once = async <T>(rid: string, fn: () => MarketResult<T>): Promise<MarketResult<T>> => {
    const prev = done.get(rid);
    if (prev) return prev as MarketResult<T>;
    await wait();
    const again = done.get(rid);
    if (again) return again as MarketResult<T>;
    const r = fn();
    done.set(rid, r);
    return r;
  };
  const base: Record<string, number> = {};
  const mk = (category: MarketCategory, name: string, icon: string, qty: number, extra: Partial<MarketItem> = {}, basePrice = 100): MarketItem => {
    const it: MarketItem = { uid: `demo:${uidSeq++}`, category, name, icon, qty, locked: false, ...extra };
    base[it.uid] = basePrice;
    return it;
  };
  const inv: MarketItem[] = [
    mk("item", "紅色治療藥水", "potion_red", 12, { description: "回復少量生命值（示範）" }, 20),
    mk("item", "藍色魔力藥水", "potion_blue", 8, { description: "回復少量魔力（示範）" }, 25),
    mk("item", "星芽草", "herb", 30, { description: "常見的素材（示範）" }, 5),
    mk("equipment", "見習長劍", "sword", 1, { equipment: { level: 5, enhance: 3, appraised: true, affixes: [pctLine("攻擊力", 6), flatLine("攻擊速度", 2)] } }, 300),
    mk("equipment", "星紋皮甲", "armor", 1, { equipment: { level: 8, enhance: 0, appraised: false, affixes: [] } }, 420),
    mk("pet", "星芽兔", "pet_rabbit", 1, { pet: { stage: "幼年期", breedLevel: 3, appraised: true, affixes: [pctLine("攻擊力", 15), pctLine("生命值", -5)], frozen: false } }, 800),
    mk("pet", "小羽雀", "pet_bird", 1, { pet: { stage: "初始", breedLevel: 6, appraised: false, affixes: [], frozen: false } }, 900),
  ];
  const offers: ShopOffer[] = [
    { offerId: "shop:potion_red", name: "紅色治療藥水", icon: "potion_red", price: 40, description: "測試價格" },
    { offerId: "shop:potion_blue", name: "藍色魔力藥水", icon: "potion_blue", price: 50, description: "測試價格" },
    { offerId: "shop:feed", name: "寵物飼料", icon: "feed", price: 30, description: "測試價格" },
    { offerId: "shop:return", name: "回城星石", icon: "stone", price: null, description: "價格未定案（不能購買）" },
  ];
  const t0 = now() - 3600_000;
  const other = (seller: string, it: MarketItem, price: number, ago: number): Listing => ({
    listingId: `L${listSeq++}`,
    seller,
    mine: false,
    item: { ...it, locked: true, pet: it.pet ? { ...it.pet, frozen: true } : undefined },
    price,
    listedAt: t0 + ago,
    expiresAt: cfg.listingHours === null ? null : t0 + ago + cfg.listingHours * 3600_000,
    status: "active",
  });
  const listings: Listing[] = [
    other("示範玩家・小星", { uid: "demo:o1", category: "item", name: "紅色治療藥水", icon: "potion_red", qty: 20, locked: true }, 600, 1000),
    other("示範玩家・阿光", { uid: "demo:o2", category: "item", name: "星芽草", icon: "herb", qty: 50, locked: true }, 180, 5000),
    other("示範玩家・米亞", { uid: "demo:o3", category: "equipment", name: "銀月短杖", icon: "staff", qty: 1, locked: true, equipment: { level: 10, enhance: 5, appraised: true, affixes: [pctLine("攻擊力", 20), pctLine("防禦力", -5), flatLine("攻擊速度", 4)] } }, 2400, 2000),
    other("示範玩家・阿光", { uid: "demo:o4", category: "equipment", name: "鐵壁圓盾", icon: "shield", qty: 1, locked: true, equipment: { level: 7, enhance: 1, appraised: true, affixes: [pctLine("防禦力", 15)] } }, 1500, 3000),
    other("示範玩家・小星", { uid: "demo:o5", category: "pet", name: "雲朵羊", icon: "pet_sheep", qty: 1, locked: true, pet: { stage: "完成體", breedLevel: 9, appraised: true, affixes: [pctLine("生命值", 20), flatLine("攻擊速度", -2)], frozen: true } }, 3200, 4000),
    other("示範玩家・米亞", { uid: "demo:o6", category: "pet", name: "星芽兔", icon: "pet_rabbit", qty: 1, locked: true, pet: { stage: "成長期", breedLevel: 1, appraised: false, affixes: [], frozen: true } }, 700, 6000),
  ];
  const findInv = (uid: string): MarketItem | undefined => inv.find((i) => i.uid === uid);
  const ok = <T>(data: T): MarketResult<T> => ({ ok: true, data });
  const fail = <T>(reason: MarketFail, message: string): MarketResult<T> => ({ ok: false, reason, message });
  const copy = (it: MarketItem): MarketItem => JSON.parse(JSON.stringify(it)) as MarketItem;
  return {
    available: true,
    testData: true,
    serverBacked: false,
    debug: () => ({ gold, pending, inv: inv.length, locked: inv.filter((i) => i.locked).length }),
    async config() {
      return ok({ ...cfg });
    },
    async gold() {
      return ok(gold);
    },
    async shopCatalog() {
      return ok(offers.map((o) => ({ ...o })));
    },
    buyFromShop(offerId, qty, rid) {
      return once(rid, () => {
        const o = offers.find((x) => x.offerId === offerId);
        if (!o) return fail("notFound", "沒有這項商品。");
        if (o.price === null) return fail("priceUnset", "這項商品的價格尚未定案。");
        const n = Math.max(1, Math.floor(qty));
        if (gold < o.price * n) return fail("notEnoughGold", "金幣不足。");
        gold -= o.price * n;
        let it = inv.find((i) => i.category === "item" && i.name === o.name && !i.locked);
        if (it) it.qty += n;
        else {
          it = mk("item", o.name, o.icon, n, { description: o.description }, Math.round(o.price / 2));
          inv.push(it);
        }
        return ok({ gold, received: { ...copy(it), qty: n } });
      });
    },
    async inventory(category) {
      return ok(inv.filter((i) => i.category === category).map(copy));
    },
    async npcBuyPrice(uid) {
      const it = findInv(uid);
      if (!it) return fail("notFound", "找不到這個物品。");
      if (cfg.npcBuyRate === null) return ok(null);
      return ok(Math.max(1, Math.floor((base[uid] ?? 10) * cfg.npcBuyRate)) * (it.category === "item" ? it.qty : 1));
    },
    sellToShop(uid, rid) {
      return once(rid, () => {
        const i = inv.findIndex((x) => x.uid === uid);
        if (i < 0) return fail("notFound", "找不到這個物品。");
        const it = inv[i]!;
        if (it.locked) return fail("locked", "這個物品正在掛賣中，不能出售。");
        if (cfg.npcBuyRate === null) return fail("priceUnset", "收購價格尚未定案。");
        const paid = Math.max(1, Math.floor((base[uid] ?? 10) * cfg.npcBuyRate)) * (it.category === "item" ? it.qty : 1);
        inv.splice(i, 1);
        gold += paid;
        return ok({ gold, paid });
      });
    },
    async search(q) {
      const size = q.pageSize ?? 20;
      const page = q.page ?? 0;
      const all = sortListings(listings.filter((l) => l.status === "active" && l.item.category === q.category && matchText(l.item, q.text ?? "")), q.sort ?? "priceAsc");
      return ok({ total: all.length, listings: all.slice(page * size, page * size + size).map((l) => ({ ...l, item: copy(l.item) })) });
    },
    createListing(uid, price, rid) {
      return once(rid, () => {
        const it = findInv(uid);
        if (!it) return fail("notFound", "找不到這個物品。");
        if (it.locked) return fail("locked", "這個物品已經在掛賣中。");
        const bad = validatePrice(price, cfg);
        if (bad) return fail("invalidPrice", bad);
        const mine = listings.filter((l) => l.mine && l.status === "active").length;
        if (cfg.maxListings !== null && mine >= cfg.maxListings) return fail("limitReached", `同時最多掛賣 ${cfg.maxListings} 件。`);
        // 交易系統鎖定：物品留在原處但不能使用、出售、再掛賣；寵物暫停飽食度與成長
        it.locked = true;
        if (it.pet) it.pet = { ...it.pet, frozen: true };
        const t = now();
        const l: Listing = { listingId: `L${listSeq++}`, seller: "我", mine: true, item: copy(it), price, listedAt: t, expiresAt: cfg.listingHours === null ? null : t + cfg.listingHours * 3600_000, status: "active" };
        listings.push(l);
        return ok({ ...l, item: copy(l.item) });
      });
    },
    buyListing(listingId, rid) {
      return once(rid, () => {
        const l = listings.find((x) => x.listingId === listingId);
        if (!l || l.status !== "active") return fail("soldOut", "這件商品已經售出或下架。");
        if (l.mine) return fail("ownListing", "不能購買自己的掛賣。");
        if (gold < l.price) return fail("notEnoughGold", "金幣不足。");
        gold -= l.price;
        l.status = "sold";
        const received: MarketItem = { ...copy(l.item), uid: `demo:${uidSeq++}`, locked: false, pet: l.item.pet ? { ...l.item.pet, frozen: false } : undefined };
        base[received.uid] = Math.round(l.price / 2);
        inv.push(received);
        return ok({ gold, received: copy(received) });
      });
    },
    cancelListing(listingId, rid) {
      return once(rid, () => {
        const l = listings.find((x) => x.listingId === listingId);
        if (!l || l.status !== "active") return fail("notFound", "找不到這筆掛賣。");
        if (!l.mine) return fail("notOwner", "只能取消自己的掛賣。");
        l.status = "cancelled";
        const it = findInv(l.item.uid);
        if (!it) return fail("error", "找不到掛賣中的物品。");
        it.locked = false;
        if (it.pet) it.pet = { ...it.pet, frozen: false };
        return ok(copy(it));
      });
    },
    async myListings() {
      return ok(listings.filter((l) => l.mine).map((l) => ({ ...l, item: copy(l.item) })));
    },
    async earnings() {
      return ok({ pending, sales });
    },
    claimEarnings(rid) {
      return once(rid, () => {
        const claimed = pending;
        gold += claimed;
        pending = 0;
        return ok({ claimed, gold });
      });
    },
    /** 測試用：模擬其他玩家買走我的掛賣（實際由伺服器處理） */
    ...{
      simulateSale(listingId: string): boolean {
        const l = listings.find((x) => x.listingId === listingId && x.mine && x.status === "active");
        if (!l) return false;
        l.status = "sold";
        const i = inv.findIndex((x) => x.uid === l.item.uid);
        if (i >= 0) inv.splice(i, 1);
        const fee = feeOf(l.price, cfg) ?? 0;
        pending += l.price - fee;
        sales += 1;
        return true;
      },
    },
  };
}

/** 測試用：示範服務的「其他玩家買走」 */
export function simulateDemoSale(svc: GuildMarketService, listingId: string): boolean {
  const f = (svc as unknown as { simulateSale?: (id: string) => boolean }).simulateSale;
  return typeof f === "function" ? f(listingId) : false;
}
