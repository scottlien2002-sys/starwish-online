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
import { hashToken, newToken, type CharacterRecord, type CharacterStore, type InventoryItem, type ItemResult, type SaveResult } from "./Store.ts";

type Sql = ReturnType<typeof postgres>;
type Row = Record<string, unknown>;

const SCHEMA = new URL("../../db/schema.sql", import.meta.url);
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toRecord(r: Row): CharacterRecord {
  return {
    id: String(r.id),
    realm: String(r.realm),
    name: String(r.name),
    gender: r.gender === "female" ? "female" : "male",
    appearance: parseAppearance(r.appearance),
    level: num(r.level),
    exp: num(r.exp),
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
    const r = await this.sql`SELECT i.uid, i.def_id, i.qty, i.state, i.version FROM items i JOIN characters c ON c.id = i.owner_id WHERE i.owner_id = ${characterId}::uuid AND c.realm = ${this.realm} AND i.state <> 'consumed' ORDER BY i.created_at`;
    return r.map((x) => ({ uid: String(x.uid), defId: String(x.def_id), qty: num(x.qty), state: x.state as InventoryItem["state"], version: num(x.version) }));
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
        const it = await tx`INSERT INTO items (owner_id, def_id, qty) VALUES (${characterId}::uuid, ${defId}, ${qty}) RETURNING uid, def_id, qty, state, version`;
        const x = it[0]!;
        res = { ok: true, item: { uid: String(x.uid), defId: String(x.def_id), qty: num(x.qty), state: "owned", version: num(x.version) } };
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

  /** 測試用：這個資料區的角色數 */
  async countCharacters(): Promise<number> {
    const r = await this.sql`SELECT count(*)::int AS n FROM characters WHERE realm = ${this.realm}`;
    return num(r[0]!.n);
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
