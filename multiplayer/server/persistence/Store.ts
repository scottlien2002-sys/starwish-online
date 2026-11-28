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
  /** Stage 8.5：所屬帳號（訪客角色為 null） */
  accountId: string | null;
  /** 資料區：test（測試伺服器）／prod（未來正式）。不同資料區的資料互相看不到 */
  realm: string;
  name: string;
  gender: Gender;
  appearance: AppearanceWire;
  level: number;
  exp: number;
  /** 金幣（伺服器權威；只能透過 changeGold 冪等異動） */
  gold: number;
  /** 裝備欄：slot → 道具 uid */
  equipment: Record<string, string>;
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
  /** bag＝背包、storage＝倉庫 */
  location: "bag" | "storage";
  version: number;
}

export type GoldResult = { ok: true; balance: number; dup?: boolean } | { ok: false; err: string; dup?: boolean };

export type ItemResult = { ok: true; item?: InventoryItem; dup?: boolean } | { ok: false; err: string; dup?: boolean };

/** Stage 8.5：帳號（與角色資料分開；一個帳號可以有多個角色） */
export interface AccountRecord {
  id: string;
  realm: string;
  username: string;
  passHash: string;
  failedCount: number;
  lockedUntil: number | null;
  createdAt: number;
}

export interface SessionRecord {
  accountId: string;
  expiresAt: number;
}

/** 交易的一方：交出的道具（uid＋目前版本）與金幣 */
export interface TradeSide {
  characterId: string;
  items: { uid: string; version: number }[];
  gold: number;
}

export type TradeResult = { ok: true; dup?: boolean; moved: number } | { ok: false; err: string; dup?: boolean };

/** 一個帳號最多幾個角色（測試設定；正式數量待企劃） */
export const MAX_CHARACTERS_PER_ACCOUNT_TEST = 4;

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
  /** 存入／取出倉庫（版本檢查＋冪等） */
  moveItem(characterId: string, requestId: string, uid: string, to: "bag" | "storage", expectedVersion: number): Promise<ItemResult>;
  /** 金幣異動（冪等；餘額不能為負） */
  changeGold(characterId: string, requestId: string, delta: number, reason: string): Promise<GoldResult>;
  /** 等級與經驗（工作階段鎖檢查） */
  saveProgress(characterId: string, lockEpoch: number, level: number, exp: number): Promise<boolean>;
  /** 裝備（只能裝自己背包裡的道具） */
  equip(characterId: string, lockEpoch: number, slot: string, uid: string | null): Promise<boolean>;
  close(): Promise<void>;
  /** 用憑證找角色（只存憑證雜湊） */
  findByToken(token: string): Promise<CharacterRecord | null>;
  /** 取得工作階段鎖：回傳新的 lockEpoch，舊的連線之後的寫入都會被拒絕 */
  acquireLock(characterId: string): Promise<number>;
  savePosition(characterId: string, expectedVersion: number, lockEpoch: number, patch: { map: MapId; x: number; z: number; yaw: number }, now: number): Promise<SaveResult>;
  get(characterId: string): Promise<CharacterRecord | null>;

  // ---------------- Stage 8.5：帳號 ----------------
  createAccount(username: string, passHash: string, now: number): Promise<{ ok: true; account: AccountRecord } | { ok: false; err: "taken" }>;
  findAccount(username: string): Promise<AccountRecord | null>;
  /** 登入失敗：累計次數，達到上限就鎖定一段時間 */
  loginFailed(accountId: string, now: number, maxFails: number, lockMs: number): Promise<void>;
  loginOk(accountId: string, now: number): Promise<void>;
  /** 登入憑證：只存 SHA-256 雜湊 */
  createSession(accountId: string, tokenHash: string, expiresAt: number, now: number): Promise<void>;
  findSession(tokenHash: string, now: number): Promise<SessionRecord | null>;
  revokeSession(tokenHash: string, now: number): Promise<void>;
  listCharacters(accountId: string): Promise<CharacterRecord[]>;
  /** 帳號下建立角色（同時發角色重連憑證）；超過上限回傳 null */
  createCharacter(accountId: string, name: string, gender: Gender, appearance: AppearanceWire, now: number): Promise<{ character: CharacterRecord; token: string } | null>;
  /**
   * 兩位玩家交易（原子）：雙方道具（版本須相符、在背包、未裝備、未掛賣）與金幣一次交換；
   * 任何一項不符全部不生效。requestId 在雙方的請求紀錄各記一筆，同一筆交易只會成交一次。
   */
  trade(requestId: string, a: TradeSide, b: TradeSide): Promise<TradeResult>;
}

export const hashToken = (t: string): string => createHash("sha256").update(t).digest("hex");
export const newToken = (): string => randomBytes(24).toString("base64url");

export class MemoryStore implements CharacterStore {
  readonly kind = "memory" as const;
  readonly realm: string;
  private readonly chars = new Map<string, CharacterRecord>();
  private readonly tokens = new Map<string, string>();
  private readonly items = new Map<string, InventoryItem & { owner: string }>();
  private readonly ledger = new Map<string, ItemResult | GoldResult | TradeResult>();
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly sessions = new Map<string, SessionRecord & { revoked: boolean }>();

  constructor(realm = "test") {
    this.realm = realm;
  }

  async createGuest(name: string, gender: Gender, appearance: AppearanceWire, now: number): Promise<{ character: CharacterRecord; token: string }> {
    const c: CharacterRecord = { id: randomUUID(), accountId: null, realm: this.realm, name, gender, appearance: { ...appearance }, level: 1, exp: 0, gold: 0, equipment: {}, map: "village", x: null, z: null, yaw: 0, version: 1, lockEpoch: 0, updatedAt: now };
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
    return c ? { ...c, equipment: { ...c.equipment } } : null;
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
    const prev = this.ledger.get(k) as ItemResult | undefined;
    if (prev) return { ...prev, dup: true };
    let r: ItemResult;
    if (!this.chars.has(characterId) || !Number.isInteger(qty) || qty <= 0) r = { ok: false, err: "bad_request" };
    else {
      const item = { uid: randomUUID(), defId, qty, state: "owned" as const, location: "bag" as const, version: 1, owner: characterId };
      this.items.set(item.uid, item);
      r = { ok: true, item: { uid: item.uid, defId, qty, state: "owned", location: "bag", version: 1 } };
    }
    this.ledger.set(k, r);
    return r;
  }

  async consumeItem(characterId: string, requestId: string, uid: string, expectedVersion: number): Promise<ItemResult> {
    const k = `${characterId}\u0000${requestId}`;
    const prev = this.ledger.get(k) as ItemResult | undefined;
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

  async moveItem(characterId: string, requestId: string, uid: string, to: "bag" | "storage", expectedVersion: number): Promise<ItemResult> {
    const k = `${characterId}\u0000${requestId}`;
    const prev = this.ledger.get(k) as ItemResult | undefined;
    if (prev) return { ...prev, dup: true };
    const it = this.items.get(uid);
    let r: ItemResult;
    if (!it || it.owner !== characterId || it.state !== "owned") r = { ok: false, err: "not_owner" };
    else if (it.version !== expectedVersion) r = { ok: false, err: "version_conflict" };
    else if (it.location === to) r = { ok: false, err: "already_there" };
    else if (to === "storage" && Object.values(this.chars.get(characterId)?.equipment ?? {}).includes(uid)) r = { ok: false, err: "equipped" };
    else {
      it.location = to;
      it.version++;
      const { owner: _o, ...item } = it;
      r = { ok: true, item: { ...item } };
    }
    this.ledger.set(k, r);
    return r;
  }

  async changeGold(characterId: string, requestId: string, delta: number, _reason: string): Promise<GoldResult> {
    const k = `${characterId}\u0000${requestId}`;
    const prev = this.ledger.get(k) as GoldResult | undefined;
    if (prev) return { ...prev, dup: true };
    const c = this.chars.get(characterId);
    let r: GoldResult;
    if (!c || !Number.isInteger(delta)) r = { ok: false, err: "bad_request" };
    else if (c.gold + delta < 0) r = { ok: false, err: "insufficient_gold" };
    else {
      c.gold += delta;
      c.version++;
      r = { ok: true, balance: c.gold };
    }
    this.ledger.set(k, r);
    return r;
  }

  async saveProgress(characterId: string, lockEpoch: number, level: number, exp: number): Promise<boolean> {
    const c = this.chars.get(characterId);
    if (!c || c.lockEpoch !== lockEpoch) return false;
    c.level = level;
    c.exp = exp;
    c.version++;
    return true;
  }

  async equip(characterId: string, lockEpoch: number, slot: string, uid: string | null): Promise<boolean> {
    const c = this.chars.get(characterId);
    if (!c || c.lockEpoch !== lockEpoch) return false;
    if (uid) {
      const it = this.items.get(uid);
      if (!it || it.owner !== characterId || it.state !== "owned" || it.location !== "bag") return false;
      c.equipment[slot] = uid;
    } else delete c.equipment[slot];
    c.version++;
    return true;
  }

  // ---------------- Stage 8.5：帳號 ----------------
  async createAccount(username: string, passHash: string, now: number): Promise<{ ok: true; account: AccountRecord } | { ok: false; err: "taken" }> {
    if ([...this.accounts.values()].some((a) => a.username === username)) return { ok: false, err: "taken" };
    const a: AccountRecord = { id: randomUUID(), realm: this.realm, username, passHash, failedCount: 0, lockedUntil: null, createdAt: now };
    this.accounts.set(a.id, a);
    return { ok: true, account: { ...a } };
  }

  async findAccount(username: string): Promise<AccountRecord | null> {
    const a = [...this.accounts.values()].find((x) => x.username === username);
    return a ? { ...a } : null;
  }

  async loginFailed(accountId: string, now: number, maxFails: number, lockMs: number): Promise<void> {
    const a = this.accounts.get(accountId);
    if (!a) return;
    a.failedCount++;
    if (a.failedCount >= maxFails) {
      a.lockedUntil = now + lockMs;
      a.failedCount = 0;
    }
  }

  async loginOk(accountId: string, _now: number): Promise<void> {
    const a = this.accounts.get(accountId);
    if (a) {
      a.failedCount = 0;
      a.lockedUntil = null;
    }
  }

  async createSession(accountId: string, tokenHash: string, expiresAt: number, _now: number): Promise<void> {
    this.sessions.set(tokenHash, { accountId, expiresAt, revoked: false });
  }

  async findSession(tokenHash: string, now: number): Promise<SessionRecord | null> {
    const s = this.sessions.get(tokenHash);
    return s && !s.revoked && s.expiresAt > now ? { accountId: s.accountId, expiresAt: s.expiresAt } : null;
  }

  async revokeSession(tokenHash: string, _now: number): Promise<void> {
    const s = this.sessions.get(tokenHash);
    if (s) s.revoked = true;
  }

  async listCharacters(accountId: string): Promise<CharacterRecord[]> {
    return [...this.chars.values()].filter((c) => c.accountId === accountId).map((c) => ({ ...c, equipment: { ...c.equipment } }));
  }

  async createCharacter(accountId: string, name: string, gender: Gender, appearance: AppearanceWire, now: number): Promise<{ character: CharacterRecord; token: string } | null> {
    if (!this.accounts.has(accountId)) return null;
    if ((await this.listCharacters(accountId)).length >= MAX_CHARACTERS_PER_ACCOUNT_TEST) return null;
    const r = await this.createGuest(name, gender, appearance, now);
    const c = this.chars.get(r.character.id)!;
    c.accountId = accountId;
    return { character: { ...c }, token: r.token };
  }

  async trade(requestId: string, a: TradeSide, b: TradeSide): Promise<TradeResult> {
    const ka = `${a.characterId}\u0000${requestId}`;
    const kb = `${b.characterId}\u0000${requestId}`;
    const prev = (this.ledger.get(ka) ?? this.ledger.get(kb)) as TradeResult | undefined;
    if (prev) return { ...prev, dup: true };
    const ca = this.chars.get(a.characterId);
    const cb = this.chars.get(b.characterId);
    const check = (side: TradeSide, c: CharacterRecord | undefined): string | null => {
      if (!c) return "not_found";
      if (!Number.isInteger(side.gold) || side.gold < 0) return "bad_request";
      if (c.gold < side.gold) return "insufficient_gold";
      const seen = new Set<string>();
      for (const x of side.items) {
        const it = this.items.get(x.uid);
        if (seen.has(x.uid)) return "duplicate_item";
        seen.add(x.uid);
        if (!it || it.owner !== c.id || it.state !== "owned") return "not_owner";
        if (it.location !== "bag") return "not_in_bag";
        if (it.version !== x.version) return "version_conflict";
        if (Object.values(c.equipment).includes(x.uid)) return "equipped";
      }
      return null;
    };
    let r: TradeResult;
    const err = a.characterId === b.characterId ? "same_character" : (check(a, ca) ?? check(b, cb));
    if (err) r = { ok: false, err };
    else {
      // 檢查全部通過後才一次寫入（單執行緒：中間不會被其他請求插入）
      for (const [side, to] of [[a, b.characterId], [b, a.characterId]] as const) {
        for (const x of side.items) {
          const it = this.items.get(x.uid)!;
          it.owner = to;
          it.version++;
        }
      }
      ca!.gold += b.gold - a.gold;
      cb!.gold += a.gold - b.gold;
      ca!.version++;
      cb!.version++;
      r = { ok: true, moved: a.items.length + b.items.length };
    }
    this.ledger.set(ka, r);
    this.ledger.set(kb, r);
    return r;
  }

  async close(): Promise<void> {}
}
