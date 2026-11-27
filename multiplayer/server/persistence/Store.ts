/**
 * 角色資料持久層介面。
 * - 本機原型：MemoryStore（伺服器重開即清空，只用於開發測試）。
 * - 正式版：PostgreSQL（db/schema.sql，Stage 8.1 接上；需要時才申請資料庫主機）。
 * 版本控制：每次寫入都要帶 expectedVersion，與資料庫目前版本不同就拒絕（樂觀鎖），避免兩台伺服器或舊連線覆蓋新資料。
 * 工作階段鎖：同一角色同時只允許一個連線（lockEpoch 遞增，舊連線的寫入一律無效）。
 * ⚠ 單機版 localStorage 存檔不會被匯入成線上可信資料；線上角色一律由伺服器建立。
 */
import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { Gender, MapId } from "../../shared/protocol.ts";

export interface CharacterRecord {
  id: string;
  name: string;
  gender: Gender;
  map: MapId;
  x: number | null;
  z: number | null;
  yaw: number;
  version: number;
  lockEpoch: number;
  updatedAt: number;
}

export type SaveResult = { ok: true; version: number } | { ok: false; reason: "conflict" | "not_found" | "stale_lock"; current?: number };

export interface CharacterStore {
  /** 建立訪客角色並回傳登入憑證（原型沒有帳號系統；Stage 8.x 接正式登入） */
  createGuest(name: string, gender: Gender, now: number): Promise<{ character: CharacterRecord; token: string }>;
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
  private readonly chars = new Map<string, CharacterRecord>();
  private readonly tokens = new Map<string, string>();

  async createGuest(name: string, gender: Gender, now: number): Promise<{ character: CharacterRecord; token: string }> {
    const c: CharacterRecord = { id: randomUUID(), name, gender, map: "village", x: null, z: null, yaw: 0, version: 1, lockEpoch: 0, updatedAt: now };
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
}
