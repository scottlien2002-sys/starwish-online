/**
 * 重複請求防護（idempotency）：同一個角色、同一個 requestId 只執行一次，重送時回傳第一次的結果。
 * 本機原型用記憶體；正式版對應 PostgreSQL request_ledger 表（PRIMARY KEY (character_id, request_id)），
 * 與道具／金幣異動寫在同一個交易內（見 db/schema.sql）。
 */
export interface LedgerEntry {
  ok: boolean;
  data?: unknown;
  err?: string;
  at: number;
}

export class RequestLedger {
  private readonly map = new Map<string, LedgerEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs = 10 * 60_000, maxEntries = 50_000) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  private key(characterId: string, requestId: string): string {
    return `${characterId}\u0000${requestId}`;
  }

  get(characterId: string, requestId: string, now: number): LedgerEntry | undefined {
    const e = this.map.get(this.key(characterId, requestId));
    if (e && now - e.at > this.ttlMs) {
      this.map.delete(this.key(characterId, requestId));
      return undefined;
    }
    return e;
  }

  /** 執行一次：已經做過就回傳 { dup: true, entry } */
  run(characterId: string, requestId: string, now: number, fn: () => Omit<LedgerEntry, "at">): { dup: boolean; entry: LedgerEntry } {
    const old = this.get(characterId, requestId, now);
    if (old) return { dup: true, entry: old };
    const entry = { ...fn(), at: now };
    this.map.set(this.key(characterId, requestId), entry);
    if (this.map.size > this.maxEntries) {
      // Map 依插入順序：刪最舊的
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
    return { dup: false, entry };
  }

  get size(): number {
    return this.map.size;
  }
}
