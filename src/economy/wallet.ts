/**
 * 金幣核心（Stage 7，純邏輯、可單元測試）。
 * - 餘額永遠是 ≥ 0 的整數；任何扣款前先檢查，不足就整筆失敗（不會出現負數）
 * - 冪等：每一筆異動都帶 requestId；同一個 requestId 只處理一次，重送時回傳第一次的結果（防重複扣款、重複領取）
 * - 交易紀錄（ledger）：每筆異動的種類、金額、異動後餘額、對應物品或服務
 * - transact()：先確認餘額、再執行服務（例如鑑定），服務成功才扣款；服務失敗 → 不扣款、資料不變（原子性）
 * ⚠ 本機存檔版：正式多人遊戲的金幣必須由伺服器保管（見 Starwish_Stage7 報告）
 */

export type LedgerKind =
  | "monsterDrop" // 怪物掉落（撿取）
  | "shopBuy" // NPC 商店購買
  | "shopSell" // 賣給 NPC
  | "appraisal" // 寵物鑑定
  | "petService" // 寵物服務（靈魂復活等）
  | "marketBuy" // 交易所購買（需要伺服器）
  | "marketClaim" // 領取交易所收益（需要伺服器）
  | "test"; // 測試給予

export interface LedgerEntry {
  seq: number;
  requestId: string;
  kind: LedgerKind;
  /** 正數＝收入、負數＝支出 */
  amount: number;
  balanceAfter: number;
  ref: string;
  at: number;
}

export interface WalletState {
  balance: number;
  seq: number;
  /** 最近的交易紀錄（保留最近 300 筆） */
  ledger: LedgerEntry[];
  /** 已處理的 requestId → 結果（保留最近 1000 筆，用來防重複） */
  done: Record<string, WalletResult>;
  doneOrder: string[];
}

export type WalletFail = "notEnoughGold" | "invalidAmount" | "failed";
export type WalletResult = { ok: true; balance: number; amount: number; seq: number } | { ok: false; reason: WalletFail; message: string; balance: number };

export function newWallet(balance = 0): WalletState {
  return { balance: Math.max(0, Math.floor(balance)), seq: 0, ledger: [], done: {}, doneOrder: [] };
}

export function parseWallet(v: unknown): WalletState {
  const w = v as Partial<WalletState> | null;
  if (!w || typeof w.balance !== "number") return newWallet();
  const out = newWallet(w.balance);
  out.seq = Math.max(0, Math.floor(Number(w.seq) || 0));
  out.ledger = Array.isArray(w.ledger) ? w.ledger.slice(-300) : [];
  out.done = w.done && typeof w.done === "object" ? { ...w.done } : {};
  out.doneOrder = Array.isArray(w.doneOrder) ? w.doneOrder.slice(-1000) : Object.keys(out.done).slice(-1000);
  return out;
}

const validAmount = (n: number): boolean => Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= 1_000_000_000;

function remember(w: WalletState, requestId: string, r: WalletResult): WalletResult {
  w.done[requestId] = r;
  w.doneOrder.push(requestId);
  while (w.doneOrder.length > 1000) delete w.done[w.doneOrder.shift()!];
  return r;
}

function apply(w: WalletState, requestId: string, kind: LedgerKind, amount: number, ref: string, now: number): WalletResult {
  w.balance += amount;
  w.seq += 1;
  w.ledger.push({ seq: w.seq, requestId, kind, amount, balanceAfter: w.balance, ref, at: now });
  if (w.ledger.length > 300) w.ledger.splice(0, w.ledger.length - 300);
  return { ok: true, balance: w.balance, amount, seq: w.seq };
}

/** 收入（掉落、出售、領取）。同一個 requestId 重送 → 回傳第一次的結果，不會重複入帳 */
export function credit(w: WalletState, requestId: string, kind: LedgerKind, amount: number, ref = "", now = Date.now()): WalletResult {
  const prev = w.done[requestId];
  if (prev) return prev;
  if (!validAmount(amount)) return { ok: false, reason: "invalidAmount", message: "金額不正確。", balance: w.balance };
  return remember(w, requestId, apply(w, requestId, kind, amount, ref, now));
}

/** 支出。餘額不足 → 失敗、餘額不變（失敗不記住 requestId，補足金幣後可以用同一個請求再試） */
export function debit(w: WalletState, requestId: string, kind: LedgerKind, amount: number, ref = "", now = Date.now()): WalletResult {
  const prev = w.done[requestId];
  if (prev) return prev;
  if (!validAmount(amount)) return { ok: false, reason: "invalidAmount", message: "金額不正確。", balance: w.balance };
  if (w.balance < amount) return { ok: false, reason: "notEnoughGold", message: `金幣不足（需要 ${amount}，目前 ${w.balance}）。`, balance: w.balance };
  return remember(w, requestId, apply(w, requestId, kind, -amount, ref, now));
}

/**
 * 原子性付費服務：餘額足夠 → 執行 fn → fn 成功才扣款；fn 失敗或丟出錯誤 → 不扣款。
 * fn 必須自己保證失敗時不改動資料（例如鑑定失敗時物品不變）。
 * 同一個 requestId 只會執行一次 fn。
 */
export function transact<T>(
  w: WalletState,
  requestId: string,
  kind: LedgerKind,
  amount: number,
  ref: string,
  fn: () => { ok: true; value: T } | { ok: false; message: string },
  now = Date.now(),
): { ok: true; value: T | null; charged: number; balance: number; repeated: boolean } | { ok: false; reason: WalletFail; message: string; balance: number } {
  const prev = w.done[requestId];
  if (prev) return prev.ok ? { ok: true, value: null, charged: -prev.amount, balance: w.balance, repeated: true } : { ...prev, balance: w.balance };
  if (!validAmount(amount)) return { ok: false, reason: "invalidAmount", message: "金額不正確。", balance: w.balance };
  if (w.balance < amount) return { ok: false, reason: "notEnoughGold", message: `金幣不足（需要 ${amount}，目前 ${w.balance}）。`, balance: w.balance };
  let r: { ok: true; value: T } | { ok: false; message: string };
  try {
    r = fn();
  } catch (e) {
    r = { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  if (!r.ok) return { ok: false, reason: "failed", message: r.message, balance: w.balance };
  const d = remember(w, requestId, apply(w, requestId, kind, -amount, ref, now));
  return { ok: true, value: r.value, charged: amount, balance: d.balance, repeated: false };
}

/** 檢查：交易紀錄加總 = 餘額變化（測試用） */
export function ledgerConsistent(w: WalletState, startBalance: number): boolean {
  if (w.ledger.length === 0) return w.balance === startBalance;
  const first = w.ledger[0]!;
  let b = first.balanceAfter - first.amount;
  for (const e of w.ledger) {
    b += e.amount;
    if (b !== e.balanceAfter || b < 0) return false;
  }
  return b === w.balance;
}
