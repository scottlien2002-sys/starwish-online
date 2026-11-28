/**
 * 金幣與商店設定：official（正式，未定案 = null）／test（整合測試設定，明確標示）。
 * 缺少的正式值會列在 missing，遊戲據此停用對應功能並顯示提示，不自行假設數值。
 */
import type { ItemId } from "../pets/petSystem.ts";

export type EconomyMode = "official" | "test";
export interface ShopEntry {
  offerId: string;
  item: ItemId;
  name: string;
  price: number | null;
}
export interface MarketCfg {
  feeRate: number | null;
  listingHours: number | null;
  maxListings: number | null;
  npcBuyRate: number | null;
  minPrice: number | null;
  maxPrice: number | null;
}
export interface Economy {
  mode: EconomyMode;
  startingGold: number | null;
  goldDrops: Record<string, [number, number] | null>;
  itemBasePrice: Record<ItemId, number | null>;
  shop: ShopEntry[];
  market: MarketCfg;
  missing: string[];
}

export interface RawEconomy {
  startingGold: number | null;
  goldDrops: Record<string, [number, number] | null>;
  itemBasePrice: Record<ItemId, number | null>;
  shop: ShopEntry[];
  market: MarketCfg;
  test: { startingGold: number; goldDrops: Record<string, [number, number]>; itemBasePrice: Record<ItemId, number>; shop: ShopEntry[]; market: MarketCfg };
}

export function resolveEconomy(mode: EconomyMode, src: RawEconomy): Economy {
  const base = mode === "test" ? src.test : src;
  const e: Economy = {
    mode,
    startingGold: base.startingGold,
    goldDrops: { ...base.goldDrops },
    itemBasePrice: { ...base.itemBasePrice },
    shop: base.shop.map((s) => ({ ...s })),
    market: { ...base.market },
    missing: [],
  };
  if (e.startingGold === null) e.missing.push("初始金幣");
  if (Object.values(e.goldDrops).some((v) => v === null)) e.missing.push("怪物金幣掉落量");
  if (e.shop.some((s) => s.price === null)) e.missing.push("商品價格");
  if (Object.values(e.itemBasePrice).some((v) => v === null) || e.market.npcBuyRate === null) e.missing.push("NPC 收購價");
  if (e.market.feeRate === null || e.market.listingHours === null || e.market.maxListings === null) e.missing.push("交易所手續費／期限／上限");
  return e;
}

/** 怪物金幣掉落（範圍內整數；未定案 → 0，不掉金幣） */
export function rollGold(e: Economy, monsterId: string, r: number): number {
  const range = e.goldDrops[monsterId];
  if (!range) return 0;
  const [a, b] = range;
  return a + Math.floor(r * (b - a + 1));
}

/** NPC 收購價（基準價 × 收購比例；未定案 → null，不收購） */
export function npcBuyPrice(e: Economy, item: ItemId, qty: number): number | null {
  const base = e.itemBasePrice[item];
  if (base === null || base === undefined || e.market.npcBuyRate === null) return null;
  return Math.max(1, Math.floor(base * e.market.npcBuyRate)) * qty;
}
