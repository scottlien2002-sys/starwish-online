/**
 * PostgreSQL 持久層（Stage 8.1）：角色唯一 ID、角色資料、位置、外觀／裝備造型、登入憑證、背包道具。
 * - 使用 postgres（porsager/postgres，零相依套件）連線；伺服器啟動時自動套用 db/schema.sql（可重複執行）
 * - realm：測試伺服器固定 'test'；所有查詢都加 realm 條件，測試資料不會出現在正式資料區
 * - 寫入一律檢查 version（樂觀鎖）與 lock_epoch（工作階段鎖）；道具異動與 request_ledger 在同一交易內完成
 */
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { parseAppearance } from "../../../src/core/gameSave.ts";
import type { AppearanceWire, Gender, MapId } from "../../shared/protocol.ts";
import { hashToken, MAX_CHARACTERS_PER_ACCOUNT_TEST, newToken, type AccountRecord, type CharacterRecord, type CharacterStore, type GoldResult, type InventoryItem, type ItemResult, type SaveResult, type SessionRecord, type TradeResult, type TradeSide } from "./Store.ts";

type Sql = ReturnType<typeof postgres>;
type Row = Record<string, unknown>;

const SCHEMA = new URL("../../db/schema.sql", import.meta.url);
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toItem(x: Row): InventoryItem {
  return { uid: String(x.uid), defId: String(x.def_id), qty: num(x.qty), state: x.state as InventoryItem["state"], location: x.location === "storage" ? "storage" : "bag", version: num(x.version) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toAccount(r: Row): AccountRecord {
  return { id: String(r.id), realm: String(r.realm), username: String(r.username), passHash: String(r.pass_hash), failedCount: num(r.failed_count), lockedUntil: r.locked_until ? new Date(String(r.locked_until)).getTime() : null, createdAt: new Date(String(r.created_at)).getTime() };
}

function toRecord(r: Row): CharacterRecord {
  return {
    id: String(r.id),
    accountId: r.account_id ? String(r.account_id) : null,
    realm: String(r.realm),
    name: String(r.name),
    gender: r.gender === "female" ? "female" : "male",
    appearance: parseAppearance(r.appearance),
    level: num(r.level),
    exp: num(r.exp),
    gold: num(r.gold),
    equipment: r.equipment && typeof r.equipment === "object" ? { ...(r.equipment as Record<string, string>) } : {},
    map: (r.map_id === "starsprout" ? "starsprout" : "village") as MapId,
    x: numOrNull(r.x),
    z: numOrNull(r.z),
    yaw: num(r.yaw ?? 0),
    version: num(r.version),
    lockEpoch: num(r.lock_epoch),
    updatedAt: new Date(String(r.updated_at)).getTime(),
  };
}

export interface PgOptions {
  url: string;
  realm: "test" | "prod";
  ssl?: "disable" | "prefer" | "require";
  serverId?: string;
}

export class PgStore implements CharacterStore {
  readonly kind = "postgres" as const;
  readonly realm: "test" | "prod";
  private readonly sql: Sql;
  private readonly serverId: string;

  private constructor(sql: Sql, o: PgOptions) {
    this.sql = sql;
    this.realm = o.realm;
    this.serverId = o.serverId ?? `${hostname()}:${process.pid}`;
  }

  static async open(o: PgOptions): Promise<PgStore> {
    if (o.realm !== "test" && o.realm !== "prod") throw new Error("realm must be test or prod");
    const ssl = o.ssl === "disable" ? false : (o.ssl ?? "prefer");
    const sql = postgres(o.url, { ssl: ssl as never, max: 5, idle_timeout: 30, connect_timeout: 20, onnotice: () => {} });
    // 多台伺服器同時啟動時用 advisory lock 避免同時套用結構
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(81810801)`;
      await tx.unsafe(readFileSync(SCHEMA, "utf8"));
    });
    return new PgStore(sql, o);
  }

  async createGuest(name: string, gender: Gender, appearance: AppearanceWire, _now: number): Promise<{ character: CharacterRecord; token: string }> {
    const token = newToken();
    const rows = await this.sql.begin(async (tx) => {
      const r = await tx`INSERT INTO characters (realm, name, gender, appearance) VALUES (${this.realm}, ${name}, ${gender}, ${tx.json(appearance as never)}) RETURNING *`;
      await tx`INSERT INTO session_tokens (token_hash, character_id) VALUES (${hashToken(token)}, ${r[0]!.id as string})`;
      return r;
    });
    return { character: toRecord(rows[0] as Row), token };
  }

  async findByToken(token: string): Promise<CharacterRecord | null> {
    const r = await this.sql`SELECT c.* FROM session_tokens t JOIN characters c ON c.id = t.character_id WHERE t.token_hash = ${hashToken(token)} AND t.revoked_at IS NULL AND c.realm = ${this.realm}`;
    return r[0] ? toRecord(r[0] as Row) : null;
  }

  async acquireLock(characterId: string): Promise<number> {
    const r = await this.sql`SELECT acquire_character_lock(${characterId}::uuid, ${this.serverId}, interval '10 minutes') AS e`;
    if (!r[0] || r[0].e === null) throw new Error("not_found");
    return num(r[0].e);
  }

  async savePosition(characterId: string, expectedVersion: number, lockEpoch: number, patch: { map: MapId; x: number; z: number; yaw: number }): Promise<SaveResult> {
    const r = await this.sql`SELECT save_position(${characterId}::uuid, ${expectedVersion}, ${lockEpoch}, ${patch.map}, ${patch.x}, ${patch.z}, ${patch.yaw}) AS v`;
    const v = r[0]?.v;
    if (v !== null && v !== undefined) return { ok: true, version: num(v) };
    const cur = await this.sql`SELECT version, lock_epoch FROM characters WHERE id = ${characterId}::uuid AND realm = ${this.realm}`;
    if (!cur[0]) return { ok: false, reason: "not_found" };
    if (num(cur[0].lock_epoch) !== lockEpoch) return { ok: false, reason: "stale_lock", current: num(cur[0].lock_epoch) };
    return { ok: false, reason: "conflict", current: num(cur[0].version) };
  }

  async get(characterId: string): Promise<CharacterRecord | null> {
    const r = await this.sql`SELECT * FROM characters WHERE id = ${characterId}::uuid AND realm = ${this.realm}`;
    return r[0] ? toRecord(r[0] as Row) : null;
  }

  async saveAppearance(characterId: string, lockEpoch: number, appearance: AppearanceWire): Promise<boolean> {
    const r = await this.sql`UPDATE characters SET appearance = ${this.sql.json(appearance as never)}, version = version + 1, updated_at = now() WHERE id = ${characterId}::uuid AND lock_epoch = ${lockEpoch} AND realm = ${this.realm} RETURNING id`;
    return r.length === 1;
  }

  async listItems(characterId: string): Promise<InventoryItem[]> {
    const r = await this.sql`SELECT i.uid, i.def_id, i.qty, i.state, i.location, i.version FROM items i JOIN characters c ON c.id = i.owner_id WHERE i.owner_id = ${characterId}::uuid AND c.realm = ${this.realm} AND i.state <> 'consumed' ORDER BY i.created_at`;
    return r.map((x) => toItem(x as Row));
  }

  /** 給道具（冪等）：同一 requestId 只會產生一件 */
  async grantItem(characterId: string, requestId: string, defId: string, qty: number): Promise<ItemResult> {
    return this.sql.begin(async (tx) => {
      const ins = await tx`INSERT INTO request_ledger (character_id, request_id, kind, result) VALUES (${characterId}::uuid, ${requestId}, 'grant_item', '{"pending":true}') ON CONFLICT DO NOTHING RETURNING request_id`;
      if (ins.length === 0) {
        const prev = await tx`SELECT result FROM request_ledger WHERE character_id = ${characterId}::uuid AND request_id = ${requestId}`;
        return { ...(prev[0]!.result as ItemResult), dup: true };
      }
      let res: ItemResult;
      if (!Number.isInteger(qty) || qty <= 0) res = { ok: false, err: "bad_request" };
      else {
        const it = await tx`INSERT INTO items (owner_id, def_id, qty) VALUES (${characterId}::uuid, ${defId}, ${qty}) RETURNING uid, def_id, qty, state, location, version`;
        res = { ok: true, item: toItem(it[0] as Row) };
      }
      await tx`UPDATE request_ledger SET result = ${tx.json(res as never)} WHERE character_id = ${characterId}::uuid AND request_id = ${requestId}`;
      return res;
    }) as Promise<ItemResult>;
  }

  /** 消耗道具（冪等＋版本檢查＋列鎖定） */
  async consumeItem(characterId: string, requestId: string, uid: string, expectedVersion: number): Promise<ItemResult> {
    return this.sql.begin(async (tx) => {
      const ins = await tx`INSERT INTO request_ledger (character_id, request_id, kind, result) VALUES (${characterId}::uuid, ${requestId}, 'consume_item', '{"pending":true}') ON CONFLICT DO NOTHING RETURNING request_id`;
      if (ins.length === 0) {
        const prev = await tx`SELECT result FROM request_ledger WHERE character_id = ${characterId}::uuid AND request_id = ${requestId}`;
        return { ...(prev[0]!.result as ItemResult), dup: true };
      }
      const it = await tx`SELECT owner_id, state, version FROM items WHERE uid = ${uid}::uuid FOR UPDATE`;
      let res: ItemResult;
      if (!it[0] || String(it[0].owner_id) !== characterId || it[0].state !== "owned") res = { ok: false, err: "not_owner" };
      else if (num(it[0].version) !== expectedVersion) res = { ok: false, err: "version_conflict" };
      else {
        await tx`UPDATE items SET state = 'consumed', version = version + 1, updated_at = now() WHERE uid = ${uid}::uuid`;
        res = { ok: true };
      }
      await tx`UPDATE request_ledger SET result = ${tx.json(res as never)} WHERE character_id = ${characterId}::uuid AND request_id = ${requestId}`;
      return res;
    }) as Promise<ItemResult>;
  }

  /** 存入／取出倉庫（冪等＋版本檢查＋列鎖定；裝備中的道具不能存入倉庫） */
  async moveItem(characterId: string, requestId: string, uid: string, to: "bag" | "storage", expectedVersion: number): Promise<ItemResult> {
    return this.sql.begin(async (tx) => {
      const ins = await tx`INSERT INTO request_ledger (character_id, request_id, kind, result) VALUES (${characterId}::uuid, ${requestId}, 'move_item', '{"pending":true}') ON CONFLICT DO NOTHING RETURNING request_id`;
      if (ins.length === 0) {
        const prev = await tx`SELECT result FROM request_ledger WHERE character_id = ${characterId}::uuid AND request_id = ${requestId}`;
        return { ...(prev[0]!.result as ItemResult), dup: true };
      }
      const it = await tx`SELECT owner_id, state, location, version FROM items WHERE uid = ${uid}::uuid FOR UPDATE`;
      const eq = await tx`SELECT equipment FROM characters WHERE id = ${characterId}::uuid FOR UPDATE`;
      const equipped = Object.values((eq[0]?.equipment ?? {}) as Record<string, string>).includes(uid);
      let res: ItemResult;
      if (!it[0] || String(it[0].owner_id) !== characterId || it[0].state !== "owned") res = { ok: false, err: "not_owner" };
      else if (num(it[0].version) !== expectedVersion) res = { ok: false, err: "version_conflict" };
      else if (it[0].location === to) res = { ok: false, err: "already_there" };
      else if (to === "storage" && equipped) res = { ok: false, err: "equipped" };
      else {
        const u = await tx`UPDATE items SET location = ${to}, version = version + 1, updated_at = now() WHERE uid = ${uid}::uuid RETURNING uid, def_id, qty, state, location, version`;
        res = { ok: true, item: toItem(u[0] as Row) };
      }
      await tx`UPDATE request_ledger SET result = ${tx.json(res as never)} WHERE character_id = ${characterId}::uuid AND request_id = ${requestId}`;
      return res;
    }) as Promise<ItemResult>;
  }

  /** 金幣（資料庫函式 change_gold：冪等、餘額不能為負、流水帳） */
  async changeGold(characterId: string, requestId: string, delta: number, reason: string): Promise<GoldResult> {
    const r = await this.sql`SELECT change_gold(${requestId}, ${characterId}::uuid, ${delta}, ${reason}) AS r`;
    const x = r[0]!.r as { ok: boolean; balance?: number; err?: string; dup?: boolean };
    return x.ok ? { ok: true, balance: num(x.balance), ...(x.dup ? { dup: true } : {}) } : { ok: false, err: String(x.err), ...(x.dup ? { dup: true } : {}) };
  }

  async saveProgress(characterId: string, lockEpoch: number, level: number, exp: number): Promise<boolean> {
    const r = await this.sql`UPDATE characters SET level = ${level}, exp = ${exp}, version = version + 1, updated_at = now() WHERE id = ${characterId}::uuid AND lock_epoch = ${lockEpoch} AND realm = ${this.realm} RETURNING id`;
    return r.length === 1;
  }

  async equip(characterId: string, lockEpoch: number, slot: string, uid: string | null): Promise<boolean> {
    return this.sql.begin(async (tx) => {
      if (uid) {
        const it = await tx`SELECT owner_id, state, location FROM items WHERE uid = ${uid}::uuid FOR UPDATE`;
        if (!it[0] || String(it[0].owner_id) !== characterId || it[0].state !== "owned" || it[0].location !== "bag") return false;
        const r = await tx`UPDATE characters SET equipment = equipment || ${tx.json({ [slot]: uid } as never)}, version = version + 1 WHERE id = ${characterId}::uuid AND lock_epoch = ${lockEpoch} AND realm = ${this.realm} RETURNING id`;
        return r.length === 1;
      }
      const r = await tx`UPDATE characters SET equipment = equipment - ${slot}, version = version + 1 WHERE id = ${characterId}::uuid AND lock_epoch = ${lockEpoch} AND realm = ${this.realm} RETURNING id`;
      return r.length === 1;
    }) as Promise<boolean>;
  }

  /** 測試用：這個資料區的角色數 */
  async countCharacters(): Promise<number> {
    const r = await this.sql`SELECT count(*)::int AS n FROM characters WHERE realm = ${this.realm}`;
    return num(r[0]!.n);
  }

  // ---------------- Stage 8.5：帳號 ----------------
  async createAccount(username: string, passHash: string, _now: number): Promise<{ ok: true; account: AccountRecord } | { ok: false; err: "taken" }> {
    const r = await this.sql`INSERT INTO accounts (realm, username, pass_hash) VALUES (${this.realm}, ${username}, ${passHash}) ON CONFLICT DO NOTHING RETURNING *`;
    return r[0] ? { ok: true, account: toAccount(r[0] as Row) } : { ok: false, err: "taken" };
  }

  async findAccount(username: string): Promise<AccountRecord | null> {
    const r = await this.sql`SELECT * FROM accounts WHERE realm = ${this.realm} AND username = ${username}`;
    return r[0] ? toAccount(r[0] as Row) : null;
  }

  async loginFailed(accountId: string, now: number, maxFails: number, lockMs: number): Promise<void> {
    await this.sql`UPDATE accounts SET
        failed_count = CASE WHEN failed_count + 1 >= ${maxFails} THEN 0 ELSE failed_count + 1 END,
        locked_until = CASE WHEN failed_count + 1 >= ${maxFails} THEN ${new Date(now + lockMs)} ELSE locked_until END
      WHERE id = ${accountId}::uuid AND realm = ${this.realm}`;
  }

  async loginOk(accountId: string, now: number): Promise<void> {
    await this.sql`UPDATE accounts SET failed_count = 0, locked_until = NULL, last_login_at = ${new Date(now)} WHERE id = ${accountId}::uuid AND realm = ${this.realm}`;
  }

  async createSession(accountId: string, tokenHash: string, expiresAt: number, _now: number): Promise<void> {
    await this.sql`INSERT INTO account_sessions (token_hash, account_id, realm, expires_at) VALUES (${tokenHash}, ${accountId}::uuid, ${this.realm}, ${new Date(expiresAt)})`;
  }

  async findSession(tokenHash: string, now: number): Promise<SessionRecord | null> {
    const r = await this.sql`SELECT account_id, expires_at FROM account_sessions WHERE token_hash = ${tokenHash} AND realm = ${this.realm} AND revoked_at IS NULL AND expires_at > ${new Date(now)}`;
    return r[0] ? { accountId: String(r[0].account_id), expiresAt: new Date(String(r[0].expires_at)).getTime() } : null;
  }

  async revokeSession(tokenHash: string, now: number): Promise<void> {
    await this.sql`UPDATE account_sessions SET revoked_at = ${new Date(now)} WHERE token_hash = ${tokenHash} AND revoked_at IS NULL`;
  }

  async listCharacters(accountId: string): Promise<CharacterRecord[]> {
    const r = await this.sql`SELECT * FROM characters WHERE account_id = ${accountId}::uuid AND realm = ${this.realm} ORDER BY created_at`;
    return r.map((x) => toRecord(x as Row));
  }

  async createCharacter(accountId: string, name: string, gender: Gender, appearance: AppearanceWire, _now: number): Promise<{ character: CharacterRecord; token: string } | null> {
    const token = newToken();
    return this.sql.begin(async (tx) => {
      // 鎖住帳號列：同一帳號同時建立角色也不會超過上限
      const acc = await tx`SELECT id FROM accounts WHERE id = ${accountId}::uuid AND realm = ${this.realm} FOR UPDATE`;
      if (!acc[0]) return null;
      const n = await tx`SELECT count(*)::int AS n FROM characters WHERE account_id = ${accountId}::uuid AND realm = ${this.realm}`;
      if (num(n[0]!.n) >= MAX_CHARACTERS_PER_ACCOUNT_TEST) return null;
      const r = await tx`INSERT INTO characters (realm, account_id, name, gender, appearance) VALUES (${this.realm}, ${accountId}::uuid, ${name}, ${gender}, ${tx.json(appearance as never)}) RETURNING *`;
      await tx`INSERT INTO session_tokens (token_hash, character_id) VALUES (${hashToken(token)}, ${r[0]!.id as string})`;
      return { character: toRecord(r[0] as Row), token };
    });
  }

  async trade(requestId: string, a: TradeSide, b: TradeSide): Promise<TradeResult> {
    const allUids = [...a.items, ...b.items].map((x) => x.uid);
    if (!UUID_RE.test(a.characterId) || !UUID_RE.test(b.characterId) || allUids.some((u) => !UUID_RE.test(u))) return { ok: false, err: "bad_request" };
    if (a.characterId === b.characterId) return { ok: false, err: "same_character" };
    if (new Set(allUids).size !== allUids.length) return { ok: false, err: "duplicate_item" };
    for (const side of [a, b]) if (!Number.isInteger(side.gold) || side.gold < 0) return { ok: false, err: "bad_request" };
    return this.sql.begin(async (tx) => {
      const prev = await tx`SELECT result FROM request_ledger WHERE request_id = ${requestId} AND character_id IN (${a.characterId}::uuid, ${b.characterId}::uuid) LIMIT 1`;
      if (prev[0]) return { ...(prev[0].result as TradeResult), dup: true };
      // 依 id 排序上鎖：兩筆交易同時進行也不會互相等待（死結）
      const ids = [a.characterId, b.characterId].sort();
      const chars = await tx`SELECT id, gold, equipment FROM characters WHERE id IN (${ids[0]!}::uuid, ${ids[1]!}::uuid) AND realm = ${this.realm} ORDER BY id FOR UPDATE`;
      const items = allUids.length ? await tx`SELECT uid, owner_id, state, location, version FROM items WHERE uid IN ${tx(allUids)} ORDER BY uid FOR UPDATE` : [];
      const byId = new Map(chars.map((c) => [String(c.id), c]));
      const byUid = new Map(items.map((x) => [String(x.uid), x]));
      const check = (side: TradeSide): string | null => {
        const c = byId.get(side.characterId);
        if (!c) return "not_found";
        if (num(c.gold) < side.gold) return "insufficient_gold";
        const eq = Object.values((c.equipment ?? {}) as Record<string, string>);
        for (const x of side.items) {
          const it = byUid.get(x.uid);
          if (!it || String(it.owner_id) !== side.characterId || it.state !== "owned") return "not_owner";
          if (it.location !== "bag") return "not_in_bag";
          if (num(it.version) !== x.version) return "version_conflict";
          if (eq.includes(x.uid)) return "equipped";
        }
        return null;
      };
      const err = check(a) ?? check(b);
      let res: TradeResult;
      if (err) res = { ok: false, err };
      else {
        for (const [side, to] of [[a, b.characterId], [b, a.characterId]] as const) {
          for (const x of side.items) await tx`UPDATE items SET owner_id = ${to}::uuid, version = version + 1, updated_at = now() WHERE uid = ${x.uid}::uuid`;
        }
        for (const [cid, delta] of [[a.characterId, b.gold - a.gold], [b.characterId, a.gold - b.gold]] as const) {
          const u = await tx`UPDATE characters SET gold = gold + ${delta}, version = version + 1, updated_at = now() WHERE id = ${cid}::uuid RETURNING gold`;
          if (delta !== 0) await tx`INSERT INTO gold_ledger (character_id, delta, balance_after, reason, request_id) VALUES (${cid}::uuid, ${delta}, ${u[0]!.gold as number}, 'trade', ${requestId})`;
        }
        await tx`INSERT INTO trade_log (request_id, char_a, char_b, detail) VALUES (${requestId}, ${a.characterId}::uuid, ${b.characterId}::uuid, ${tx.json({ a, b } as never)})`;
        res = { ok: true, moved: a.items.length + b.items.length };
      }
      for (const cid of [a.characterId, b.characterId]) await tx`INSERT INTO request_ledger (character_id, request_id, kind, result) VALUES (${cid}::uuid, ${requestId}, 'trade', ${tx.json(res as never)})`;
      return res;
    });
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
