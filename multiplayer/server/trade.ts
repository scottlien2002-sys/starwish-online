/**
 * Stage 8.5 玩家交易（伺服器資料介面，測試用；尚無正式交易畫面）。
 * 流程：A offer（指定對方 pid、自己要給的道具 uid＋version、金幣）→ B accept（B 要給的道具、金幣）→ 伺服器一次原子交換。
 * 防護：
 *  - 一位玩家同時只能有一個進行中的邀請；同一筆交易只會執行一次（tid 決定資料庫 requestId＝trade-<tid>，重送／同時按兩次只成交一次）。
 *  - 道具必須在自己背包、未裝備、version 與現在一致（被換位置、被交易過就 version_conflict），兩邊都檢查完才寫入。
 *  - 金幣不能是負數、不能超過持有。斷線、換地圖、距離太遠 → 交易取消。
 */
import { randomUUID } from "node:crypto";
import type { CharacterStore, TradeResult, TradeSide } from "./persistence/Store.ts";
import { TRADE_TEST } from "./combat/rules.ts";

export interface TradeOffer {
  tid: string;
  fromCid: string;
  fromPid: number;
  toCid: string;
  toPid: number;
  room: string;
  give: TradeSide;
  createdAt: number;
  /** 成交中（同一筆的第二個 accept 等同一個結果） */
  settling: Promise<TradeResult> | null;
}

export type SideInput = { items: { uid: string; version: number }[]; gold: number };

export function parseSide(o: Record<string, unknown>): SideInput | null {
  const items = o.items === undefined ? [] : o.items;
  const gold = o.gold === undefined ? 0 : o.gold;
  if (!Array.isArray(items) || items.length > TRADE_TEST.maxItems) return null;
  if (!Number.isInteger(gold) || (gold as number) < 0 || (gold as number) > TRADE_TEST.maxGold) return null;
  const out: { uid: string; version: number }[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") return null;
    const r = it as Record<string, unknown>;
    if (typeof r.u !== "string" || r.u.length > 40 || !Number.isInteger(r.v) || (r.v as number) < 0) return null;
    out.push({ uid: r.u, version: r.v as number });
  }
  return { items: out, gold: gold as number };
}

export class TradeBook {
  private readonly offers = new Map<string, TradeOffer>();
  private readonly bySender = new Map<string, string>();
  readonly stats = { offers: 0, accepted: 0, rejected: 0, cancelled: 0, expired: 0, duplicateAccepts: 0 };

  private readonly store: CharacterStore;
  constructor(store: CharacterStore) {
    this.store = store;
  }

  /** 最近完成的交易結果（同一筆在完成後才收到的 accept 也回同一個結果，不會再成交一次） */
  private readonly done = new Map<string, TradeResult>();
  finished(tid: string): TradeResult | undefined {
    return this.done.get(tid);
  }

  get(tid: string): TradeOffer | undefined {
    return this.offers.get(tid);
  }

  /** 新邀請（取代同一位玩家之前的邀請） */
  offer(o: Omit<TradeOffer, "tid" | "settling" | "createdAt">, now: number): { offer: TradeOffer; replaced: TradeOffer | null } {
    const prevTid = this.bySender.get(o.fromCid);
    const replaced = prevTid ? (this.offers.get(prevTid) ?? null) : null;
    if (replaced && !replaced.settling) this.remove(replaced);
    const offer: TradeOffer = { ...o, tid: randomUUID(), createdAt: now, settling: null };
    this.offers.set(offer.tid, offer);
    this.bySender.set(o.fromCid, offer.tid);
    this.stats.offers++;
    return { offer, replaced: replaced && !replaced.settling ? replaced : null };
  }

  /** 成交：同一筆交易同時 accept 兩次 → 等同一個結果（第二個 dup） */
  async accept(offer: TradeOffer, take: TradeSide): Promise<TradeResult & { dupAccept?: boolean }> {
    if (offer.settling) {
      this.stats.duplicateAccepts++;
      const r = await offer.settling;
      return { ...r, dup: true, dupAccept: true };
    }
    offer.settling = this.store.trade(`trade-${offer.tid}`, offer.give, take);
    const r = await offer.settling;
    this.done.set(offer.tid, r);
    if (this.done.size > 2000) this.done.delete(this.done.keys().next().value!);
    this.remove(offer);
    if (r.ok) this.stats.accepted++;
    else this.stats.rejected++;
    return r;
  }

  remove(o: TradeOffer): void {
    this.offers.delete(o.tid);
    if (this.bySender.get(o.fromCid) === o.tid) this.bySender.delete(o.fromCid);
  }

  /** 牽涉到某角色的所有邀請（斷線、換地圖時取消） */
  involving(cid: string): TradeOffer[] {
    return [...this.offers.values()].filter((o) => !o.settling && (o.fromCid === cid || o.toCid === cid));
  }

  expire(now: number): TradeOffer[] {
    const out: TradeOffer[] = [];
    for (const o of this.offers.values()) {
      if (!o.settling && now - o.createdAt > TRADE_TEST.offerTtlMs) out.push(o);
    }
    for (const o of out) this.remove(o);
    this.stats.expired += out.length;
    return out;
  }
}
