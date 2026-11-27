/**
 * Stage 7 統一存檔（本機 localStorage）：角色、生命、地圖位置、裝備欄、金幣、背包、寵物、商會掛賣。
 * 切換地圖（星芽村 ↔ 星芽原野）、重新整理頁面都從這裡讀回，資料不會遺失或重複。
 * ⚠ 正式多人遊戲的金幣、物品所有權、交易必須由伺服器保管；這份本機存檔只用於單機測試版。
 */
import { newSave as newPetSave, parseSave as parsePetSave, type PetSave } from "../pets/petSystem.ts";
import { newWallet, parseWallet, type WalletState } from "../economy/wallet.ts";

import { sanitizeProgress } from "./progression.ts";
export const GAME_SAVE_KEY = "starwish.stage7.save.v1";
export type MapId = "village" | "starsprout";
export type Gender = "male" | "female";
/** 裝備欄（企劃確認的 7 格；裝備系統尚未接入，先保留欄位） */
export const EQUIP_SLOTS = ["weapon", "headwear", "clothes", "pants", "shoes", "earrings", "back"] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

/** 角色外觀（髮型與職業預留 6 種；目前交付的是 hair01、初心者短劍／法杖） */
export interface Appearance {
  /** 髮型編號：hair01～hair06（目前只有 hair01 有模型） */
  hair: string;
  /** 髮色（#rrggbb；null = 模型原色） */
  hairColor: string | null;
  /** 武器類型：短劍（近戰）／法杖 */
  weapon: "sword" | "staff";
}
export const HAIR_SLOTS = ["hair01", "hair02", "hair03", "hair04", "hair05", "hair06"] as const;
export function defaultAppearance(): Appearance {
  return { hair: "hair01", hairColor: null, weapon: "sword" };
}
export function parseAppearance(v: unknown): Appearance {
  const a = (v && typeof v === "object" ? v : {}) as Partial<Appearance>;
  const d = defaultAppearance();
  return {
    hair: typeof a.hair === "string" && (HAIR_SLOTS as readonly string[]).includes(a.hair) ? a.hair : d.hair,
    hairColor: typeof a.hairColor === "string" && /^#[0-9a-f]{6}$/i.test(a.hairColor) ? a.hairColor.toLowerCase() : null,
    weapon: a.weapon === "staff" ? "staff" : "sword",
  };
}

export interface LocalListing {
  listingId: string;
  uid: string;
  category: "item" | "equipment" | "pet";
  price: number;
  listedAt: number;
  expiresAt: number | null;
  status: "active" | "sold" | "cancelled" | "expired";
  /** 可堆疊道具掛賣時，交給交易系統保管的數量 */
  escrowQty?: number;
}

export interface GameSave {
  version: 1;
  createdAt: number;
  updatedAt: number;
  character: {
    gender: Gender;
    /** null = 滿血 */
    hp: number | null;
    map: MapId;
    x: number | null;
    z: number | null;
    yaw: number | null;
    deaths: number;
    /** Stage 7.2：等級與目前經驗（升級表為測試設定，見 core/progression.ts） */
    level: number;
    exp: number;
    /** Stage 7.2：模組化外觀（髮型、髮色、武器類型）；切換地圖保留 */
    appearance: Appearance;
  };
  equipment: Record<EquipSlot, string | null>;
  wallet: WalletState;
  pets: PetSave;
  market: { seq: number; listings: LocalListing[]; done: Record<string, unknown> };
  /** 已撿取的地上掉落物 uid（最近 300 個；防止重複領取） */
  lootClaimed: string[];
  lootSeq: number;
}

export function newGameSave(gender: Gender, startingGold: number, now = Date.now()): GameSave {
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    character: { gender, hp: null, map: "village", x: null, z: null, yaw: null, deaths: 0, level: 1, exp: 0, appearance: defaultAppearance() },
    equipment: Object.fromEntries(EQUIP_SLOTS.map((s) => [s, null])) as Record<EquipSlot, string | null>,
    wallet: newWallet(startingGold),
    pets: newPetSave(),
    market: { seq: 0, listings: [], done: {} },
    lootClaimed: [],
    lootSeq: 0,
  };
}

export function parseGameSave(json: string | null): GameSave | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<GameSave>;
    if (v.version !== 1 || !v.character || !v.wallet || !v.pets) return null;
    const base = newGameSave(v.character.gender === "female" ? "female" : "male", 0, Number(v.createdAt) || Date.now());
    const c = v.character;
    const map: MapId = c.map === "starsprout" ? "starsprout" : "village";
    return {
      ...base,
      updatedAt: Number(v.updatedAt) || base.updatedAt,
      character: {
        gender: base.character.gender,
        hp: typeof c.hp === "number" && c.hp > 0 ? c.hp : null,
        map,
        x: typeof c.x === "number" ? c.x : null,
        z: typeof c.z === "number" ? c.z : null,
        yaw: typeof c.yaw === "number" ? c.yaw : null,
        deaths: Math.max(0, Math.floor(Number(c.deaths) || 0)),
        ...sanitizeProgress(c.level, c.exp),
        appearance: parseAppearance(c.appearance),
      },
      equipment: { ...base.equipment, ...(v.equipment ?? {}) },
      wallet: parseWallet(v.wallet),
      pets: parsePetSave(JSON.stringify(v.pets)),
      market: v.market && Array.isArray(v.market.listings) ? { seq: Number(v.market.seq) || 0, listings: v.market.listings, done: v.market.done ?? {} } : base.market,
      lootClaimed: Array.isArray(v.lootClaimed) ? v.lootClaimed.slice(-300) : [],
      lootSeq: Math.max(0, Math.floor(Number(v.lootSeq) || 0)),
    };
  } catch {
    return null;
  }
}

export interface SaveStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function loadGameSave(storage: SaveStorage): GameSave | null {
  try {
    return parseGameSave(storage.getItem(GAME_SAVE_KEY));
  } catch {
    return null;
  }
}

export function writeGameSave(storage: SaveStorage, save: GameSave, now = Date.now()): boolean {
  save.updatedAt = now;
  try {
    storage.setItem(GAME_SAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

/** 地上掉落物的唯一編號（存檔內遞增，不會重複） */
export function nextLootUid(save: GameSave): string {
  save.lootSeq += 1;
  return `loot:${save.lootSeq}`;
}

/** 記錄已撿取；回傳 false = 這個掉落物已經被撿過（重複領取） */
export function claimLoot(save: GameSave, uid: string): boolean {
  if (save.lootClaimed.includes(uid)) return false;
  save.lootClaimed.push(uid);
  if (save.lootClaimed.length > 300) save.lootClaimed.splice(0, save.lootClaimed.length - 300);
  return true;
}

/** 切換地圖：記錄目的地與位置（之後由該地圖讀取） */
export function travel(save: GameSave, to: { map: MapId; x: number; z: number; yaw: number }): void {
  save.character.map = to.map;
  save.character.x = to.x;
  save.character.z = to.z;
  save.character.yaw = to.yaw;
}

/** 全部物品的唯一編號（檢查重複用）：背包個體、可堆疊道具、寵物 */
export function allUids(save: GameSave): string[] {
  const out: string[] = [];
  for (const b of save.pets.bag ?? []) out.push(b.id);
  for (const p of save.pets.pets) out.push(`pet:${p.id}`);
  return out;
}
