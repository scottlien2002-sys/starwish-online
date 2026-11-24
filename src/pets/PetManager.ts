/**
 * 寵物系統的遊戲端介面（給星芽原野整合用；純邏輯，不含 Babylon）。
 * 遊戲只需要：怪物死亡時呼叫 onMonsterKilled、每秒呼叫 tick、玩家操作時呼叫 hatch／feed／appraise／evolve／equip，
 * 角色屬性用 characterStats(base) 取得（已含寵物加成與攻速上限 160）。外觀跟隨交給 PetFollower。
 * mode："official" = 正式（未定案數值會拋 PetConfigPendingError）；"preview" = 測試頁暫定值。
 */
import type { Rng } from "../core/rng.ts";
import {
  addItems,
  applyPetBonus,
  appraisePet,
  missingTuning,
  equip,
  equippedPet,
  evolve,
  feedPet,
  newSave,
  parseSave,
  resolveTuning,
  rollDrops,
  startHatch,
  tickPet,
  type AppraiseResult,
  type CharacterStats,
  type FeedId,
  type ItemId,
  type Pet,
  type PetConfig,
  type PetSave,
  type PetSourceId,
  type PetTuning,
} from "./petSystem.ts";

export type PetEvent =
  | { type: "drops"; items: ItemId[] }
  | { type: "hatched"; pet: Pet }
  | { type: "appraised"; pet: Pet }
  | { type: "evolved"; pet: Pet }
  | { type: "equipChanged"; pet: Pet | null }
  | { type: "changed" };

export class PetManager {
  readonly cfg: PetConfig;
  readonly tuning: PetTuning;
  readonly mode: "official" | "preview";
  /** 正式設定缺的數值（空 = 可啟用）。缺值時寵物功能停用、遊戲照常進行 */
  readonly missing: readonly string[];
  save: PetSave;
  private readonly rng: Rng;
  private readonly listeners: ((e: PetEvent) => void)[] = [];

  constructor(cfg: PetConfig, rng: Rng, mode: "official" | "preview", saveJson: string | null = null) {
    this.cfg = cfg;
    this.rng = rng;
    this.mode = mode;
    this.tuning = resolveTuning(cfg, mode);
    this.missing = missingTuning(this.tuning, mode);
    this.save = saveJson ? parseSave(saveJson) : newSave();
  }

  /** 寵物功能是否啟用（正式設定齊全，或使用明確標示的測試設定） */
  get enabled(): boolean {
    return this.missing.length === 0;
  }

  /** 停用時給玩家看的說明 */
  get disabledReason(): string {
    return this.enabled ? "" : `寵物系統尚未開放：正式設定還缺 ${this.missing.join("、")}`;
  }

  on(fn: (e: PetEvent) => void): () => void {
    this.listeners.push(fn);
    return () => this.listeners.splice(this.listeners.indexOf(fn) >>> 0, 1);
  }

  /** 戰鬥系統：怪物死亡時呼叫（之後可依怪物種類傳入不同掉落表；目前用 drops.default） */
  onMonsterKilled(): ItemId[] {
    if (!this.enabled) return [];
    const items = rollDrops(this.rng, this.tuning);
    if (items.length) {
      addItems(this.save, items);
      this.emit({ type: "drops", items });
    }
    return items;
  }

  hatch(source: PetSourceId, now: number): Pet | null {
    if (!this.enabled) return null;
    const p = startHatch(this.save, this.cfg, source, now);
    if (p) this.emit({ type: "changed" });
    return p;
  }

  /** 每秒（或回到遊戲時）呼叫一次：孵化與時間成長 */
  tick(now: number): void {
    if (!this.enabled) return;
    for (const p of this.save.pets) if (tickPet(p, this.tuning, now).hatched) this.emit({ type: "hatched", pet: p });
  }

  feed(petId: number, food: FeedId): boolean {
    if (!this.enabled) return false;
    const p = this.pet(petId);
    const ok = !!p && feedPet(this.save, p, food, this.tuning);
    if (ok) this.emit({ type: "changed" });
    return ok;
  }

  /** 方案 A：只能鑑定一次，之後永久保留 */
  appraise(petId: number): AppraiseResult {
    if (!this.enabled) return { ok: false, reason: "not-found" };
    const r = appraisePet(this.save, this.cfg, this.tuning, this.rng, petId, this.mode);
    if (r.ok) this.emit({ type: "appraised", pet: this.pet(petId)! });
    return r;
  }

  evolve(petId: number): boolean {
    if (!this.enabled) return false;
    const p = this.pet(petId);
    const ok = !!p && evolve(this.cfg, p, this.tuning);
    if (ok) this.emit({ type: "evolved", pet: p });
    return ok;
  }

  equip(petId: number | null): boolean {
    const ok = equip(this.save, petId);
    if (ok) this.emit({ type: "equipChanged", pet: equippedPet(this.save) });
    return ok;
  }

  equipped(): Pet | null {
    return equippedPet(this.save);
  }

  /** 角色最終屬性（含寵物加成；攻速最終不超過 160） */
  characterStats(base: CharacterStats): CharacterStats {
    if (!this.enabled) return applyPetBonus(base, this.cfg, null, this.tuning).stats;
    return applyPetBonus(base, this.cfg, this.equipped(), this.tuning).stats;
  }

  serialize(): string {
    return JSON.stringify(this.save);
  }

  /** 測試設定專用：給物品（商店購買、測試按鈕）。正式模式沒有金幣系統，不提供 */
  giveItem(item: ItemId, n = 1): void {
    if (!this.enabled) return;
    this.save.items[item] += n;
    this.emit({ type: "changed" });
  }

  pet(id: number): Pet | null {
    return this.save.pets.find((p) => p.id === id) ?? null;
  }

  private emit(e: PetEvent): void {
    for (const fn of [...this.listeners]) fn(e);
  }
}
