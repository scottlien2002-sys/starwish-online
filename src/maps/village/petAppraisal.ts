/**
 * 寵物商人 V2：星靈鑑定（純邏輯，可單元測試）。
 *
 * 流程：開啟鑑定視窗 → 從背包選擇種子／孵化蛋／鳥蛋 → 放入鑑定框 → 按「開始鑑定」→ 特效約 1 秒 → 逐條顯示結果。
 * 規則：
 * - 只接受種子、孵化蛋、鳥蛋（seed／egg／birdEgg，與 Claude A 寵物核心 PetSourceId 相同）
 * - 鑑定框沒有物品、物品已鑑定、正在鑑定時，按鈕停用
 * - 已鑑定物品不能再鑑定
 * - 鑑定期間鎖住：重複點擊不會再送出；每次鑑定帶唯一 requestId，服務端同一個 requestId 只扣一次費用
 * - 鑑定完成後物品留在背包、狀態改為已鑑定（不會消失、不會複製）
 * - 鑑定結果、費用由寵物核心系統（服務）產生；這裡不抽取任何詞條、不定任何價格
 *
 * 與 Claude A 寵物核心的對應（src/pets/petSystem.ts，唯讀核對）：
 * - AppraisableItem ↔ A 的 Pet（stage 0、source ∈ seed/egg/birdEgg）；appraised ↔ `affixes !== null`
 * - 結果每一條 ↔ A 的 PetAffix（stat、value）；正負號決定顏色；0 條 → 一行「無附加屬性」（灰色）
 * - 核心回傳的詞條先經 validateAffixes() 檢查正式規格；不符合就顯示錯誤（介面不自行修正、不重抽）
 * - 費用：A 的設定檔目前沒有鑑定費用欄位 → 服務回傳 fee: null（畫面顯示「未定案」）
 */
import { PET_ITEM_KINDS, PET_ITEM_LABEL, type PetItemKind } from "./petMerchant.ts";

export type Polarity = "positive" | "negative" | "none";
export interface AppraisalLine {
  label: string;
  text: string;
  polarity: Polarity;
}
/** 寵物核心的詞條（與 Claude A 的 PetAffix 相同：stat＋原始數值；百分比屬性的 value 以「百分點」表示，例：+15 ＝ +15%） */
export type PetStat = "attack" | "attackSpeed" | "defense" | "maxHp";
export interface CoreAffix {
  stat: PetStat;
  value: number;
}

/**
 * 已確認的正式鑑定規格（企劃 2026-11-24 確認；B 只用來「檢查與顯示」，不抽取）：
 * - 每個寵物 0～4 種屬性、同種類最多 1 條；可全無、全正、全負、正負混合
 * - 方案 A：第一次鑑定後永久固定詞條與原始數值（孵化、培育、進化、存讀檔都不改變）
 */
export const OFFICIAL_AFFIX_VALUES: Readonly<Record<PetStat, readonly number[]>> = Object.freeze({
  attack: [-10, -5, 10, 15, 20, 25],
  attackSpeed: [-4, -2, 2, 4, 6, 8, 10],
  defense: [-10, -5, 10, 15, 20, 25],
  maxHp: [-10, -5, 10, 15, 20],
});
export const AFFIX_META: Readonly<Record<PetStat, { label: string; unit: "percent" | "flat" }>> = Object.freeze({
  attack: { label: "攻擊力", unit: "percent" },
  attackSpeed: { label: "攻擊速度", unit: "flat" },
  defense: { label: "防禦力", unit: "percent" },
  maxHp: { label: "生命值", unit: "percent" },
});
const STAT_ORDER: readonly PetStat[] = ["attack", "attackSpeed", "defense", "maxHp"];

/** 檢查核心回傳的詞條是否符合正式規格（數量 0～4、不重複、數值在允許清單內）；不符合 → 畫面顯示錯誤、不顯示結果 */
export function validateAffixes(a: unknown): { ok: true; affixes: CoreAffix[] } | { ok: false; why: string } {
  if (!Array.isArray(a)) return { ok: false, why: "詞條不是陣列" };
  if (a.length > 4) return { ok: false, why: `詞條數 ${a.length} > 4` };
  const seen = new Set<string>();
  for (const x of a as { stat?: unknown; value?: unknown }[]) {
    if (!x || typeof x.stat !== "string" || !(x.stat in OFFICIAL_AFFIX_VALUES)) return { ok: false, why: `未知屬性 ${String(x?.stat)}` };
    if (seen.has(x.stat)) return { ok: false, why: `屬性重複 ${x.stat}` };
    seen.add(x.stat);
    if (typeof x.value !== "number" || !OFFICIAL_AFFIX_VALUES[x.stat as PetStat].includes(x.value)) return { ok: false, why: `${x.stat} 數值 ${String(x.value)} 不在正式清單內` };
  }
  return { ok: true, affixes: (a as CoreAffix[]).slice().sort((p, q) => STAT_ORDER.indexOf(p.stat) - STAT_ORDER.indexOf(q.stat)) };
}

/** 核心詞條 → 畫面行（依固定順序；正綠、負紅；0 條 →「無附加屬性」灰色） */
export function linesFromCore(affixes: readonly CoreAffix[]): AppraisalLine[] {
  return linesFromAffixes(affixes.map((a) => ({ label: AFFIX_META[a.stat].label, value: a.value, unit: AFFIX_META[a.stat].unit })));
}

export interface AppraisableItem {
  /** 物品個體唯一識別碼（每顆種子／蛋各自一個；背包堆疊不可共用鑑定結果） */
  id: string;
  kind: PetItemKind;
  name: string;
  appraised: boolean;
  /** 已鑑定時，寵物核心回傳的原始詞條（永久固定）；畫面由這裡產生結果行 */
  affixes?: readonly CoreAffix[] | null;
  /** 已鑑定時的結果行（由 affixes 產生；舊介面相容） */
  lines?: readonly AppraisalLine[];
}
export interface AppraisalQuote {
  /** null＝費用尚未定案 */
  fee: number | null;
  /** true＝測試資料（畫面標示「測試」） */
  test: boolean;
}
export type Result<T> = { ok: true; data: T } | { ok: false; reason: "unavailable" | "notAppraisable" | "alreadyAppraised" | "notEnoughGold" | "busy" | "error"; message: string };

/** 寵物核心需要提供的鑑定功能（Claude A 實作；畫面只透過這個介面呼叫） */
export interface PetAppraisalService {
  readonly available: boolean;
  /** true＝目前是測試資料（畫面明確標示） */
  readonly testData: boolean;
  /** 背包中的種子／孵化蛋／鳥蛋（含已鑑定） */
  inventory(): Promise<Result<readonly AppraisableItem[]>>;
  quote(itemId: string): Promise<Result<AppraisalQuote>>;
  /** 鑑定：同一個 requestId 只處理、只扣款一次（重送回傳同一結果） */
  appraise(itemId: string, requestId: string): Promise<Result<{ item: AppraisableItem; charged: number | null }>>;
}

export const isPetSource = (k: string): k is PetItemKind => (PET_ITEM_KINDS as readonly string[]).includes(k);

/** 由寵物核心的詞條轉成畫面行（label＋數值文字、正負決定顏色）；沒有詞條 → 「無屬性」 */
export function linesFromAffixes(affixes: readonly { label: string; value: number; unit: "flat" | "percent" }[]): AppraisalLine[] {
  if (!affixes.length) return [{ label: "無附加屬性", text: "—", polarity: "none" }];
  return affixes.map((a) => ({
    label: a.label,
    text: `${a.value > 0 ? "+" : ""}${a.value}${a.unit === "percent" ? "%" : ""}`,
    polarity: a.value > 0 ? "positive" : a.value < 0 ? "negative" : "none",
  }));
}

// ---------------------------------------------------------------- 視窗狀態

export type AppraisalPhase = "loading" | "empty" | "ready" | "appraised" | "appraising" | "result" | "error";
export interface AppraisalState {
  phase: AppraisalPhase;
  items: readonly AppraisableItem[];
  selectedId: string | null;
  quote: AppraisalQuote | null;
  /** 顯示中的結果（逐條動畫由畫面處理） */
  lines: readonly AppraisalLine[];
  message: string;
  /** 進行中的 requestId（防重複送出） */
  pending: string | null;
  testData: boolean;
  /** 最近一次鑑定實際扣款（服務回傳；null＝未扣款或費用未定案） */
  charged: number | null;
}

export const MERCHANT_LINES = {
  empty: "把背包裡的種子、孵化蛋或鳥蛋放進鑑定框吧。",
  ready: "很好，放好了。準備好就按下「開始鑑定」。",
  appraised: "這個已經鑑定過了，結果在下面。",
  appraising: "星靈之光，請告訴我它的力量……",
  result: "鑑定完成！牠會成為很棒的夥伴。",
  error: "唔……出了點狀況，請稍後再試。",
} as const;

export function initialAppraisal(): AppraisalState {
  return { phase: "loading", items: [], selectedId: null, quote: null, lines: [], message: MERCHANT_LINES.empty, pending: null, testData: false, charged: null };
}

/** 物品的結果行：優先用核心詞條（並檢查正式規格），沒有時用舊的 lines */
export function itemLines(it: AppraisableItem): { ok: true; lines: AppraisalLine[] } | { ok: false; why: string } {
  if (it.affixes !== undefined && it.affixes !== null) {
    const v = validateAffixes(it.affixes);
    return v.ok ? { ok: true, lines: linesFromCore(v.affixes) } : v;
  }
  return { ok: true, lines: [...(it.lines ?? [])] };
}

export function selected(s: AppraisalState): AppraisableItem | null {
  return s.items.find((i) => i.id === s.selectedId) ?? null;
}

/** 開始鑑定按鈕是否可按 */
export function canAppraise(s: AppraisalState): boolean {
  const it = selected(s);
  return !!it && !it.appraised && isPetSource(it.kind) && s.pending === null && s.phase === "ready";
}

export function withItems(s: AppraisalState, items: readonly AppraisableItem[], testData: boolean): AppraisalState {
  const list = items.filter((i) => isPetSource(i.kind));
  const keep = list.some((i) => i.id === s.selectedId) ? s.selectedId : null;
  return { ...s, items: list, selectedId: keep, testData, phase: keep ? s.phase : "empty", message: keep ? s.message : MERCHANT_LINES.empty };
}

/** 把物品放進鑑定框（點擊或拖曳）；不是寵物來源的物品不接受 */
export function place(s: AppraisalState, itemId: string): AppraisalState {
  if (s.pending) return s;
  const it = s.items.find((i) => i.id === itemId);
  if (!it || !isPetSource(it.kind)) return s;
  if (it.appraised) {
    const l = itemLines(it);
    return l.ok ? { ...s, selectedId: it.id, phase: "appraised", lines: l.lines, message: MERCHANT_LINES.appraised, quote: null, charged: null } : { ...s, selectedId: it.id, phase: "error", lines: [], message: `鑑定資料異常（${l.why}）`, quote: null, charged: null };
  }
  return { ...s, selectedId: it.id, phase: "ready", lines: [], message: MERCHANT_LINES.ready, quote: null, charged: null };
}

export function clearSlot(s: AppraisalState): AppraisalState {
  if (s.pending) return s;
  return { ...s, selectedId: null, phase: "empty", lines: [], message: MERCHANT_LINES.empty, quote: null, charged: null };
}

let seq = 0;
export function newRequestId(): string {
  seq += 1;
  return `appr-${Date.now().toString(36)}-${seq}`;
}

/** 送出前：鎖定（回傳 null＝不能送出） */
export function begin(s: AppraisalState, requestId: string): AppraisalState | null {
  if (!canAppraise(s)) return null;
  return { ...s, phase: "appraising", pending: requestId, message: MERCHANT_LINES.appraising, lines: [] };
}

/** 收到結果：更新背包中的同一個物品（不新增、不刪除），解除鎖定 */
export function finish(s: AppraisalState, requestId: string, r: Result<{ item: AppraisableItem; charged: number | null }>): AppraisalState {
  if (s.pending !== requestId) return s;
  if (!r.ok) {
    return { ...s, pending: null, phase: r.reason === "alreadyAppraised" ? "appraised" : "error", message: r.message };
  }
  // 同一個物品（同 id）原地更新；不新增、不刪除
  const items = s.items.map((i) => (i.id === r.data.item.id ? { ...r.data.item, appraised: true } : i));
  const l = itemLines(r.data.item);
  if (!l.ok) return { ...s, items, pending: null, phase: "error", lines: [], message: `鑑定結果不符合正式規格（${l.why}），請回報。`, charged: r.data.charged };
  return { ...s, items, pending: null, phase: "result", lines: l.lines, message: MERCHANT_LINES.result, charged: r.data.charged };
}

/** 整個鑑定流程（畫面與測試共用）：鎖定 → 呼叫服務 → 更新 */
export async function runAppraisal(s: AppraisalState, svc: PetAppraisalService, set: (s: AppraisalState) => void, requestId = newRequestId()): Promise<AppraisalState> {
  const locked = begin(s, requestId);
  if (!locked) return s;
  set(locked);
  let r: Result<{ item: AppraisableItem; charged: number | null }>;
  try {
    r = await svc.appraise(locked.selectedId!, requestId);
  } catch (e) {
    r = { ok: false, reason: "error", message: e instanceof Error ? e.message : String(e) };
  }
  const done = finish(locked, requestId, r);
  set(done);
  return done;
}

export function feeText(q: AppraisalQuote | null): string {
  if (!q) return "—";
  if (q.fee === null) return "未定案";
  return `${q.fee} 金幣${q.test ? "（測試）" : ""}`;
}

export function chargedText(charged: number | null, test: boolean): string {
  return charged === null ? "未扣款" : `已支付 ${charged} 金幣${test ? "（測試）" : ""}`;
}

export function itemLabel(it: AppraisableItem): string {
  return `${it.name}${it.appraised ? "（已鑑定）" : ""}`;
}

// ---------------------------------------------------------------- 占位服務與測試資料服務

const NOT_READY = "寵物系統尚未開放，敬請期待。";
export const PLACEHOLDER_APPRAISAL_SERVICE: PetAppraisalService = Object.freeze({
  available: false,
  testData: false,
  inventory: async () => ({ ok: false, reason: "unavailable", message: NOT_READY }) as const,
  quote: async () => ({ ok: false, reason: "unavailable", message: NOT_READY }) as const,
  appraise: async () => ({ ok: false, reason: "unavailable", message: NOT_READY }) as const,
});

/**
 * 測試資料服務（明確標示「測試資料，非正式數值」）：只用來展示完整操作流程。
 * - 物品、費用、結果都是固定的示範內容，不是機率抽取，也不是正式價格
 * - 結果行使用企劃已確認的屬性名稱與數值格式（攻擊力、攻速、防禦力、生命值）；每個物品的示範結果固定
 * - 同一個 requestId 只扣一次示範金幣；已鑑定的物品拒絕再次鑑定
 */
export function createDemoAppraisalService(opts: { delayMs?: number } = {}): PetAppraisalService & { gold(): number; charges(): number } {
  const delay = opts.delayMs ?? 300;
  const DEMO_FEE = 100;
  let gold = 1000;
  let charges = 0;
  // 示範結果固定（不是機率抽取）；數值都取自正式允許清單，涵蓋：正負混合、無附加屬性、全正、全負
  const demo: Record<string, CoreAffix[]> = {
    s1: [{ stat: "attack", value: 15 }, { stat: "maxHp", value: -5 }],
    s2: [],
    e1: [{ stat: "attackSpeed", value: 4 }, { stat: "defense", value: 20 }, { stat: "maxHp", value: 10 }],
    b1: [{ stat: "attack", value: -10 }, { stat: "attackSpeed", value: 6 }, { stat: "defense", value: -5 }, { stat: "maxHp", value: 15 }],
    b2: [{ stat: "attack", value: -5 }, { stat: "defense", value: -10 }],
  };
  const items: AppraisableItem[] = [
    { id: "s1", kind: "seed", name: "星芽種子", appraised: false, affixes: null },
    { id: "s2", kind: "seed", name: "星芽種子", appraised: false, affixes: null },
    { id: "e1", kind: "egg", name: "孵化蛋", appraised: false, affixes: null },
    { id: "e0", kind: "egg", name: "孵化蛋", appraised: true, affixes: [{ stat: "defense", value: 10 }] },
    { id: "b1", kind: "birdEgg", name: "鳥蛋", appraised: false, affixes: null },
    { id: "b2", kind: "birdEgg", name: "鳥蛋", appraised: false, affixes: null },
  ];
  const done = new Map<string, { item: AppraisableItem; charged: number }>();
  const wait = () => new Promise((r) => setTimeout(r, delay));
  return {
    available: true,
    testData: true,
    gold: () => gold,
    charges: () => charges,
    async inventory() {
      return { ok: true, data: items.map((i) => ({ ...i })) };
    },
    async quote(itemId) {
      const it = items.find((i) => i.id === itemId);
      if (!it) return { ok: false, reason: "notAppraisable", message: "找不到這個物品。" };
      return { ok: true, data: { fee: DEMO_FEE, test: true } };
    },
    async appraise(itemId, requestId) {
      const prev = done.get(requestId);
      if (prev) return { ok: true, data: { item: { ...prev.item }, charged: prev.charged } };
      await wait();
      const it = items.find((i) => i.id === itemId);
      if (!it || !isPetSource(it.kind)) return { ok: false, reason: "notAppraisable", message: "只能鑑定種子、孵化蛋或鳥蛋。" };
      if (it.appraised) return { ok: false, reason: "alreadyAppraised", message: "這個已經鑑定過了。" };
      if (gold < DEMO_FEE) return { ok: false, reason: "notEnoughGold", message: "金幣不足。" };
      gold -= DEMO_FEE;
      charges += 1;
      it.appraised = true;
      it.affixes = demo[it.id] ?? [];
      const out = { item: { ...it }, charged: DEMO_FEE };
      done.set(requestId, out);
      return { ok: true, data: out };
    },
  };
}

let current: PetAppraisalService = PLACEHOLDER_APPRAISAL_SERVICE;
/** 寵物核心接入點（傳 null 回到占位服務） */
export function connectPetAppraisalService(s: PetAppraisalService | null): void {
  current = s ?? PLACEHOLDER_APPRAISAL_SERVICE;
}
export function petAppraisalService(): PetAppraisalService {
  return current;
}

export const KIND_LABEL = PET_ITEM_LABEL;
