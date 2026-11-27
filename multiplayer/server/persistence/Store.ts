/**
 * 角色資料持久層介面。
 * - 本機原型：MemoryStore（伺服器重開即清空，只用於開發測試）。
 * - 正式版：PostgreSQL（db/schema.sql，Stage 8.1 接上；需要時才申請資料庫主機）。
 * 版本控制：每次寫入都要帶 expectedVersion，與資料庫目前版本不同就拒絕（樂觀鎖），避免兩台伺服器或舊連線覆蓋新資料。
 * 工作階段鎖：同一角色同時只允許一個連線（lockEpoch 遞增，舊連線的寫入一律無效）。
 * ⚠ 單機版 localStorage 存檔不會被匯入成線上可信資料；線上角色一律由伺服器建立。
 */
import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { AppearanceWire, Gender, MapId } from "../../shared/protocol.ts";

export interface CharacterRecord {
  id: string;
  /** 資料區：test（測試伺服器）／prod（未來正式）。不同資料區的資料互相看不到 */
  realm: string;
  name: string;
  gender: Gender;
  appearance: AppearanceWire;
  level: number;
  exp: number;
  map: MapId;
  x: number | null;
  z: number | null;
  yaw: number;
  version: number;
  lockEpoch: number;
  updatedAt: number;
}

export type SaveResult = { ok: true; version: number } | { ok: false; reason: "conflict" | "not_found" | "stale_lock"; current?: number };

/** 背包道具（每件 UUID；Stage 8.3 起由伺服器產生與異動） */
export interface InventoryItem {
  uid: string;
  defId: string;
  qty: number;
  state: "owned" | "listed" | "consumed";
  version: number;
}

export type ItemResult = { ok: true; item?: InventoryItem; dup?: boolean } | { ok: false; err: string; dup?: boolean };

export interface CharacterStore {
  readonly kind: "memory" | "postgres";
  readonly realm: string;
  /** 建立訪客角色並回傳登入憑證（原型沒有帳號系統；Stage 8.x 接正式登入） */
  createGuest(name: string, gender: Gender, appearance: AppearanceWire, now: number): Promise<{ character: CharacterRecord; token: string }>;
  saveAppearance(characterId: string, lockEpoch: number, appearance: AppearanceWire): Promise<boolean>;
  /** 背包（Stage 8.1 只建立持久化接口與測試；遊戲內背包仍是本機測試資料，8.3 改由伺服器） */
  listItems(characterId: string): Promise<InventoryItem[]>;
  grantItem(characterId: string, requestId: string, defId: string, qty: number): Promise<ItemResult>;
  consumeItem(characterId: string, requestId: string, uid: string, expectedVersion: number): Promise<ItemResult>;
  close(): Promise<void>;
  /** 用憑證找角色（只存憑證雜湊） */
  findByToken(token: string): Promise<CharacterRecord | null>;
  /** 取得工作階段鎖：回傳新的 lockEpoch，舊的連線之後的寫入都會被拒絕 */
  acquireLock(characterId: string): Promise<number>;
  savePosition(characterId: string, expectedVersion: number, lockEpoch: number, patch: { map: MapId; x: number; z: number; yaw: number }, now: number): Promise<SaveResult>;
  get(characterId: string): Promise<CharacterRecord | null>;
}

export const hashToken = (t: string): string => createHash("sha256").update(t).digest("hex");
export const newToken = (): string => randomBytes(24).toString("base64url");

export class MemoryStore implements CharacterStore {
  readonly kind = "memory" as const;
  readonly realm: string;
  private readonly chars = new Map<string, CharacterRecord>();
  private readonly tokens = new Map<string, string>();
  private readonly items = new Map<string, InventoryItem & { owner: string }>();
  private readonly ledger = new Map<string, ItemResult>();

  constructor(realm = "test") {
    this.realm = realm;
  }

  async createGuest(name: string, gender: Gender, appearance: AppearanceWire, now: number): Promise<{ character: CharacterRecord; token: string }> {
    const c: CharacterRecord = { id: randomUUID(), realm: this.realm, name, gender, appearance: { ...appearance }, level: 1, exp: 0, map: "village", x: null, z: null, yaw: 0, version: 1, lockEpoch: 0, updatedAt: now };
    this.chars.set(c.id, c);
    const token = newToken();
    this.tokens.set(hashToken(token), c.id);
    return { character: { ...c }, token };
  }

  async findByToken(token: string): Promise<CharacterRecord | null> {
    const id = this.tokens.get(hashToken(token));
    const c = id ? this.chars.get(id) : undefined;
    return c ? { ...c } : null;
  }

  async acquireLock(characterId: string): Promise<number> {
    const c = this.chars.get(characterId);
    if (!c) throw new Error("not_found");
    c.lockEpoch++;
    return c.lockEpoch;
  }

  async savePosition(characterId: string, expectedVersion: number, lockEpoch: number, patch: { map: MapId; x: number; z: number; yaw: number }, now: number): Promise<SaveResult> {
    const c = this.chars.get(characterId);
    if (!c) return { ok: false, reason: "not_found" };
    if (c.lockEpoch !== lockEpoch) return { ok: false, reason: "stale_lock", current: c.lockEpoch };
    if (c.version !== expectedVersion) return { ok: false, reason: "conflict", current: c.version };
    Object.assign(c, patch);
    c.version++;
    c.updatedAt = now;
    return { ok: true, version: c.version };
  }

  async get(characterId: string): Promise<CharacterRecord | null> {
    const c = this.chars.get(characterId);
    return c ? { ...c } : null;
  }

  async saveAppearance(characterId: string, lockEpoch: number, appearance: AppearanceWire): Promise<boolean> {
    const c = this.chars.get(characterId);
    if (!c || c.lockEpoch !== lockEpoch) return false;
    c.appearance = { ...appearance };
    c.version++;
    return true;
  }

  async listItems(characterId: string): Promise<InventoryItem[]> {
    return [...this.items.values()].filter((i) => i.owner === characterId && i.state !== "consumed").map(({ owner: _o, ...i }) => ({ ...i }));
  }

  async grantItem(characterId: string, requestId: string, defId: string, qty: number): Promise<ItemResult> {
    const k = `${characterId}\u0000${requestId}`;
    const prev = this.ledger.get(k);
    if (prev) return { ...prev, dup: true };
    let r: ItemResult;
    if (!this.chars.has(characterId) || !Number.isInteger(qty) || qty <= 0) r = { ok: false, err: "bad_request" };
    else {
      const item = { uid: randomUUID(), defId, qty, state: "owned" as const, version: 1, owner: characterId };
      this.items.set(item.uid, item);
      r = { ok: true, item: { uid: item.uid, defId, qty, state: "owned", version: 1 } };
    }
    this.ledger.set(k, r);
    return r;
  }

  async consumeItem(characterId: string, requestId: string, uid: string, expectedVersion: number): Promise<ItemResult> {
    const k = `${characterId}\u0000${requestId}`;
    const prev = this.ledger.get(k);
    if (prev) return { ...prev, dup: true };
    const it = this.items.get(uid);
    let r: ItemResult;
    if (!it || it.owner !== characterId || it.state !== "owned") r = { ok: false, err: "not_owner" };
    else if (it.version !== expectedVersion) r = { ok: false, err: "version_conflict" };
    else {
      it.state = "consumed";
      it.version++;
      r = { ok: true };
    }
    this.ledger.set(k, r);
    return r;
  }

  async close(): Promise<void> {}
}
