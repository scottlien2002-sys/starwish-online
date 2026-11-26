/**
 * 星靈培育師・洛恩（Claude B 的 PetMerchantService）— Stage 7 完整遊戲版：接在角色存檔與金幣上。
 * - 鑑定：走 PetAppraisalService（收鑑定費、requestId 只扣一次）
 * - 購買飼料：用金幣（商會道具店的飼料價格；未定案 → 不販售）
 * - 進化／復活（Stage 6.2 新增入口）：條件與費用由寵物系統決定；復活收費、requestId 防重複
 * - 階段：B 的 0～3（初始／幼年期／成長期／完成體）＝ A 的 stage 1～4（A 的 0 是孵化中，不列出）
 */
import type { PetMerchantService, PetRef, CareGuideEntry } from "../maps/village/petMerchant.ts";
import { createPetMerchantService } from "../pets/petMerchantAdapter.ts";
import { affixText, canEvolve, isSoul } from "../pets/petSystem.ts";
import type { PetManager } from "../pets/PetManager.ts";
import type { PetAppraisalService } from "../pets/petAppraisalService.ts";
import type { GameSave } from "../core/gameSave.ts";
import type { Economy } from "./economyConfig.ts";
import { transact } from "./wallet.ts";

type R<T> = Promise<{ ok: true; data: T } | { ok: false; reason: "unavailable" | "noItem" | "notEnoughGold" | "error"; message: string }>;

export interface WorldPetMerchantDeps {
  pets: PetManager;
  save: GameSave;
  economy: Economy;
  appraisal: PetAppraisalService;
  persist: () => void;
  /** 寵物或金幣改變後（更新畫面、跟隨外觀） */
  changed: () => void;
}

let seq = 0;
const rid = (p: string): string => `${p}:${Date.now().toString(36)}:${(seq++).toString(36)}`;

export function createWorldPetMerchantService(d: WorldPetMerchantDeps): PetMerchantService {
  const m = d.pets;
  const base = createPetMerchantService(m);
  const ok = <T>(data: T): R<T> => Promise.resolve({ ok: true, data });
  const fail = <T>(reason: "unavailable" | "noItem" | "notEnoughGold" | "error", message: string): R<T> => Promise.resolve({ ok: false, reason, message });
  const off = <T>(): R<T> => fail<T>("unavailable", m.disabledReason || "寵物系統尚未開放，敬請期待。");
  const name = (p: { id: number; species: string }): string => `#${p.id} ${m.cfg.species.find((s) => s.id === p.species)?.label ?? p.species}`;
  const feedOffer = () => d.economy.shop.find((o) => o.item === "shopFeed") ?? null;

  return {
    get available() {
      return m.enabled;
    },
    appraisableItems: (kind) => base.appraisableItems(kind),
    async appraise(itemId) {
      if (!m.enabled) return off();
      if (!itemId.startsWith("item:")) return base.appraise(itemId); // 已孵化寵物（舊流程，免費；Plan A 主要是孵化前鑑定）
      const r = await d.appraisal.appraise(itemId, rid("merchant-appraise"));
      d.changed();
      if (!r.ok) return fail(r.reason === "notEnoughGold" ? "notEnoughGold" : "error", r.message);
      const lines = r.data.item.affixes?.length
        ? r.data.item.affixes.map((a) => ({ label: m.cfg.appraisal.stats.find((x) => x.stat === a.stat)?.label ?? a.stat, text: affixText(m.cfg, a), positive: a.value > 0 }))
        : [{ label: "屬性", text: "沒有屬性", positive: true }];
      const kind = r.data.item.kind;
      return { ok: true, data: { itemId, kind, lines } };
    },
    feedOffers() {
      if (!m.enabled) return off();
      const o = feedOffer();
      if (!o || o.price === null) return fail("unavailable", "飼料價格尚未定案，暫不販售。");
      return ok([{ id: "shopFeed", name: o.name, price: o.price, description: d.economy.mode === "test" ? "測試價格（金幣）" : undefined }]);
    },
    buyFeed(offerId, qty) {
      if (!m.enabled) return off();
      const o = feedOffer();
      if (!o || o.price === null) return fail("unavailable", "飼料價格尚未定案，暫不販售。");
      if (offerId !== "shopFeed") return fail("noItem", "沒有這項商品。");
      const n = Math.max(1, Math.min(99, Math.floor(qty)));
      const r = transact(d.save.wallet, rid("merchant-feed"), "shopBuy", o.price * n, `shopFeed×${n}`, () => {
        m.giveItem("shopFeed", n);
        return { ok: true, value: n };
      });
      d.persist();
      d.changed();
      if (!r.ok) return fail(r.reason === "notEnoughGold" ? "notEnoughGold" : "error", r.message);
      return ok({ bought: n });
    },
    careGuide() {
      if (!m.enabled) return off();
      const t = m.tuning;
      const c = t.care;
      const test = m.mode === "preview" ? "（測試設定）" : "";
      const out: CareGuideEntry[] = [
        { title: "取得與孵化", body: `打倒怪物會掉落種子、孵化蛋、鳥蛋。孵化約 ${t.hatchSeconds} 秒${test}。孵化前就可以到我這裡鑑定。` },
        { title: "成長階段", body: "初始 → 幼年期 → 成長期 → 完成體。經驗與餵食次數都達標就能進化；詞條不會改變。" },
        { title: "飽食度", body: c ? `飽食度會隨時間下降；餓肚子時停止成長，太久沒吃會變成靈魂${test}。怪物材料、寵物飼料都能餵。` : "飽食度規則尚未定案。" },
        { title: "復活", body: c ? `變成靈魂的寵物沒有加成，可以在我這裡付 ${c.reviveFee} 金幣復活${test}。` : "復活規則尚未定案。" },
      ];
      return ok(out);
    },
    evolvablePets() {
      if (!m.enabled) return off();
      const list: PetRef[] = m.save.pets
        .filter((p) => p.stage >= 1 && !isSoul(p) && !p.frozen)
        .map((p) => {
          const max = (m.cfg.species.find((s) => s.id === p.species)?.stages.length ?? 5) - 1;
          const top = p.stage >= max;
          return { petId: String(p.id), name: name(p), stage: p.stage - 1, ready: !top && canEvolve(m.cfg, p, m.tuning), note: top ? "已是完成體" : undefined };
        });
      return ok(list);
    },
    evolve(petId) {
      if (!m.enabled) return off();
      const p = m.pet(Number(petId));
      if (!p) return fail("noItem", "找不到這隻寵物。");
      const from = p.stage - 1;
      if (!m.evolve(p.id)) return fail("error", "還沒達到進化條件。");
      d.persist();
      d.changed();
      return ok({ petId, fromStage: from, toStage: p.stage - 1 });
    },
    revivablePets() {
      if (!m.enabled) return off();
      const fee = m.tuning.care?.reviveFee;
      return ok(m.save.pets.filter((p) => isSoul(p)).map((p) => ({ petId: String(p.id), name: name(p), stage: p.stage - 1, ready: true, note: fee === undefined ? "費用未定案" : `${fee} 金幣${m.mode === "preview" ? "（測試）" : ""}` })));
    },
    revive(petId, requestId) {
      if (!m.enabled) return off();
      const r = m.revive(Number(petId), requestId, d.save.wallet);
      d.persist();
      d.changed();
      if (!r.ok) return fail(/金幣不足/.test(r.message) ? "notEnoughGold" : "error", r.message);
      return ok({ petId });
    },
  };
}
