/**
 * 寵物鑑定服務（Claude B「星靈培育師・洛恩」鑑定視窗的串接規格 V2.1，2026-11-24）。
 * 型別與 B 線 `src/maps/village/petAppraisal.ts` 逐欄相同（結構型別）；村莊整合時：
 *   connectPetAppraisalService(createPetAppraisalService(petManager))
 * 本分支沒有 B 線的村莊檔案，不修改 B 線任何檔案。
 *
 * 行為（規格 3.1）：
 * - 冪等：同一個 requestId 只處理一次、只扣款一次；重送回傳第一次的結果
 * - 原子性：遊戲目前沒有金幣系統 → 費用只記錄、不扣款；詞條寫入失敗時物品不變
 * - 不可重鑑：已鑑定 → alreadyAppraised
 * - 物品不變：只更新同一個 id 的詞條；不新增、不刪除、不改數量
 * - 費用未定案（null）：正式設定回 unavailable；測試設定費用 0、testData = true
 */
import { validateAffixes, type PetAffix, type PetSourceId } from "./petSystem.ts";
import type { PetManager } from "./PetManager.ts";
import { transact, type WalletState } from "../economy/wallet.ts";

export type PetStat = "attack" | "attackSpeed" | "defense" | "maxHp";
export interface CoreAffix {
  stat: PetStat;
  value: number;
}
export interface PetItemInstance {
  id: string;
  kind: PetSourceId;
  name: string;
  appraised: boolean;
  affixes: CoreAffix[] | null;
  appraisedAt?: number;
}
export type AppraisalResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "unavailable" | "notAppraisable" | "alreadyAppraised" | "notEnoughGold" | "busy" | "error"; message: string };
export interface AppraisalQuote {
  fee: number | null;
  test: boolean;
}
export interface PetAppraisalService {
  readonly available: boolean;
  readonly testData: boolean;
  inventory(): Promise<AppraisalResult<PetItemInstance[]>>;
  quote(itemId: string): Promise<AppraisalResult<AppraisalQuote>>;
  appraise(itemId: string, requestId: string): Promise<AppraisalResult<{ item: PetItemInstance; charged: number | null }>>;
}

const ITEM_NAME: Record<PetSourceId, string> = { seed: "星芽種子", egg: "孵化蛋", birdEgg: "鳥蛋" };

/**
 * wallet：有金幣系統時傳入（Stage 7）。鑑定費用用 transact 扣款：餘額足夠 → 鑑定 → 成功才扣款；
 * 同一個 requestId 只鑑定一次、只扣一次；失敗不扣款、物品不變。沒有傳入時只記錄費用、不扣款（Stage 5.6 行為）。
 */
export function createPetAppraisalService(m: PetManager, opts: { wallet?: WalletState; persist?: () => void } = {}): PetAppraisalService {
  const done = <T>(data: T): Promise<AppraisalResult<T>> => Promise.resolve({ ok: true, data });
  const fail = <T>(reason: "unavailable" | "notAppraisable" | "alreadyAppraised" | "notEnoughGold" | "error", message: string): Promise<AppraisalResult<T>> =>
    Promise.resolve({ ok: false, reason, message });
  const toInstance = (b: { id: string; kind: PetSourceId; affixes: PetAffix[] | null; appraisedAt?: number }): PetItemInstance => ({
    id: b.id,
    kind: b.kind,
    name: ITEM_NAME[b.kind],
    appraised: b.affixes !== null,
    affixes: b.affixes ? b.affixes.map((a) => ({ stat: a.stat, value: a.value })) : null,
    ...(b.appraisedAt !== undefined ? { appraisedAt: b.appraisedAt } : {}),
  });
  const offline = <T>(): Promise<AppraisalResult<T>> => fail<T>("unavailable", m.disabledReason || "寵物系統尚未開放，敬請期待。");
  return {
    get available() {
      return m.enabled;
    },
    get testData() {
      return m.mode === "preview";
    },
    inventory() {
      if (!m.enabled) return offline();
      return done(m.bag().map(toInstance));
    },
    quote(itemId) {
      if (!m.enabled) return offline();
      if (!m.bag().some((b) => b.id === itemId)) return fail("notAppraisable", "背包裡找不到這個物品。");
      return done({ fee: m.tuning.appraisalFee, test: m.mode === "preview" });
    },
    appraise(itemId, requestId) {
      if (!m.enabled) return offline();
      const log = (m.save.appraisalLog ??= []);
      const prev = log.find((l) => l.requestId === requestId);
      if (prev) {
        // 冪等：同一個請求回傳第一次的結果（不重抽、不重複扣款）
        const item = m.bag().find((b) => b.id === prev.itemId);
        if (!item || prev.itemId !== itemId) return fail("error", "這個鑑定請求已經處理過了。");
        return done({ item: toInstance(item), charged: prev.charged });
      }
      const fee = m.tuning.appraisalFee;
      if (fee === null) return fail("unavailable", "鑑定費用尚未定案，暫不提供鑑定。");
      const item = m.bag().find((b) => b.id === itemId);
      if (!item || item.locked) return fail("notAppraisable", item?.locked ? "這個物品正在掛賣中，不能鑑定。" : "背包裡找不到這個物品。");
      if (item.affixes !== null) return fail("alreadyAppraised", "這個物品已經鑑定過了，詞條永久固定、不能重新鑑定。");
      const run = (): { ok: true; value: true } | { ok: false; message: string } => {
        const r = m.appraiseItem(itemId);
        if (!r.ok) return { ok: false, message: "鑑定失敗，請再試一次。" };
        const errs = validateAffixes(m.cfg, r.affixes);
        if (errs.length) {
          // 不符合正式規格：還原（物品不變），不扣款、不回傳結果
          item.affixes = null;
          delete item.appraisedAt;
          return { ok: false, message: `鑑定結果不符合正式規格（${errs.join("、")}），請回報。` };
        }
        return { ok: true, value: true };
      };
      let charged: number | null = fee;
      if (opts.wallet) {
        const t = transact(opts.wallet, `appraise:${requestId}`, "appraisal", fee, itemId, run);
        if (!t.ok) return Promise.resolve({ ok: false, reason: t.reason === "notEnoughGold" ? "notEnoughGold" : "error", message: t.message });
        charged = t.charged;
      } else {
        const r = run();
        if (!r.ok) return fail("error", r.message);
      }
      log.push({ requestId, itemId, charged });
      if (log.length > 100) log.splice(0, log.length - 100);
      opts.persist?.();
      return done({ item: toInstance(item), charged });
    },
  };
}
