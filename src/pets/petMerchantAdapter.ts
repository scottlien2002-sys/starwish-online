/**
 * 寵物商人（Claude B，星芽村 `src/maps/village/petMerchant.ts`）的寵物系統實作。
 * 這裡的型別與 B 線的 `PetMerchantService` 介面逐欄相同（結構型別），村莊整合時直接：
 *   connectPetMerchantService(createPetMerchantService(petManager))
 * 本分支沒有 B 線的村莊檔案，所以型別在這裡另外宣告；不修改 B 線任何檔案。
 *
 * 規則（方案 A）：
 * - 可鑑定 = 背包裡未鑑定的種子／孵化蛋／鳥蛋個體（itemId = "item:<流水號>"），以及未鑑定的寵物（"pet:<編號>"）
 * - 鑑定一次後永久固定，不能重抽
 * - 鑑定費用、飼料價格：正式值未定案（null）→ 商人回覆「尚未開放」；測試設定為 0（遊戲目前沒有金幣系統）
 */
import { affixText, PET_STATS } from "./petSystem.ts";
import type { PetManager } from "./PetManager.ts";

export type PetItemKind = "seed" | "egg" | "birdEgg";
export type PetServiceResult<T> = { ok: true; data: T } | { ok: false; reason: "unavailable" | "noItem" | "notEnoughGold" | "error"; message: string };
export interface PetItemRef {
  itemId: string;
  name: string;
  kind: PetItemKind;
}
export interface PetAppraisal {
  itemId: string;
  kind: PetItemKind;
  lines: readonly { label: string; text: string; positive: boolean }[];
}
export interface FeedOffer {
  id: string;
  name: string;
  price: number;
  description?: string;
}
export interface CareGuideEntry {
  title: string;
  body: string;
}
export interface PetMerchantService {
  readonly available: boolean;
  appraisableItems(kind: PetItemKind): Promise<PetServiceResult<readonly PetItemRef[]>>;
  appraise(itemId: string): Promise<PetServiceResult<PetAppraisal>>;
  feedOffers(): Promise<PetServiceResult<readonly FeedOffer[]>>;
  buyFeed(offerId: string, qty: number): Promise<PetServiceResult<{ bought: number }>>;
  careGuide(): Promise<PetServiceResult<readonly CareGuideEntry[]>>;
}

const ok = <T>(data: T): Promise<PetServiceResult<T>> => Promise.resolve({ ok: true, data });
const fail = <T>(reason: "unavailable" | "noItem" | "notEnoughGold" | "error", message: string): Promise<PetServiceResult<T>> =>
  Promise.resolve({ ok: false, reason, message });

export function createPetMerchantService(m: PetManager): PetMerchantService {
  const off = <T>(): Promise<PetServiceResult<T>> => fail<T>("unavailable", m.disabledReason || "寵物系統尚未開放，敬請期待。");
  const speciesLabel = (species: string): string => m.cfg.species.find((s) => s.id === species)?.label ?? species;
  return {
    get available() {
      return m.enabled;
    },
    appraisableItems(kind) {
      if (!m.enabled) return off();
      // 背包裡未鑑定的種子／蛋個體（孵化前鑑定），以及孵化中／已孵化、未鑑定的寵物
      const items = m
        .bag()
        .filter((b) => b.kind === kind && b.affixes === null)
        .map((b) => ({ itemId: b.id, name: `${m.cfg.sources.find((x) => x.id === kind)?.label ?? kind}（${b.id.replace("item:", "#")}）`, kind: b.kind }));
      const pets = m.save.pets
        .filter((p) => p.source === kind && p.affixes === null)
        .map((p) => ({ itemId: `pet:${p.id}`, name: `#${p.id} ${speciesLabel(p.species)}`, kind: p.source }));
      return ok([...items, ...pets]);
    },
    appraise(itemId) {
      if (!m.enabled) return off();
      if (m.tuning.appraisalFee === null) return fail("unavailable", "鑑定費用尚未定案，暫不提供鑑定。");
      const bagItem = itemId.startsWith("item:") ? m.bag().find((b) => b.id === itemId) : undefined;
      const id = Number(itemId.replace(/^pet:/, ""));
      const pet = bagItem ? null : m.pet(id);
      if (!bagItem && !pet) return fail("noItem", "找不到這個物品或寵物。");
      const kind = bagItem ? bagItem.kind : pet!.source;
      const r = bagItem ? m.appraiseItem(itemId) : m.appraise(id);
      if (!r.ok) {
        const msg = r.reason === "already-appraised" ? "這隻寵物已經鑑定過了，詞條永久固定、不能重新鑑定。" : r.reason === "egg" ? "還沒孵化，孵化後才能鑑定。" : "找不到這隻寵物。";
        return fail(r.reason === "already-appraised" ? "error" : "noItem", msg);
      }
      const lines = r.affixes.length
        ? r.affixes.map((a) => ({ label: m.cfg.appraisal.stats.find((s) => s.stat === a.stat)?.label ?? a.stat, text: affixText(m.cfg, a), positive: a.value > 0 }))
        : [{ label: "屬性", text: "沒有屬性", positive: true }];
      return ok({ itemId, kind, lines });
    },
    feedOffers() {
      if (!m.enabled) return off();
      const price = m.tuning.feedPrice;
      if (price === null) return fail("unavailable", "飼料價格尚未定案，暫不販售。");
      const feed = m.cfg.feed.find((f) => f.id === "shopFeed");
      return ok([{ id: "shopFeed", name: feed?.label ?? "商店飼料", price: price.shopFeed, description: m.mode === "preview" ? "測試設定價格（遊戲尚無金幣系統）" : undefined }]);
    },
    buyFeed(offerId, qty) {
      if (!m.enabled) return off();
      if (m.tuning.feedPrice === null) return fail("unavailable", "飼料價格尚未定案，暫不販售。");
      if (offerId !== "shopFeed") return fail("noItem", "沒有這項商品。");
      const n = Math.max(0, Math.floor(qty));
      m.giveItem("shopFeed", n);
      return ok({ bought: n });
    },
    careGuide() {
      if (!m.enabled) return off();
      const t = m.tuning;
      const stages = Math.max(...m.cfg.species.map((s) => s.stages.length));
      return ok([
        { title: "取得與孵化", body: `打倒怪物會掉落種子、孵化蛋、鳥蛋。放進孵化後約 ${t.hatchSeconds} 秒孵出。` },
        { title: "成長", body: `孵化後隨時間成長；餵食怪物材料或商店飼料可以加快成長。` },
        { title: "進化", body: `經驗與餵食次數都達標就能進化（共 ${stages} 個階段）。進化只提升屬性發揮比例，詞條不會改變。` },
        { title: "鑑定", body: `孵化後到寵物商人鑑定：0～4 條屬性（${PET_STATS.length} 種，可能是正面或負面），鑑定一次後永久固定。` },
      ]);
    },
  };
}
