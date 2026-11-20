import { HIT_REACTION, type HitTier } from "../../config/hitReaction.ts";

export interface HitReaction {
  /** 1、2、3 = 連續第幾擊；0 = 免疫期間的受擊 */
  tier: number;
  stagger: number;
  recoil: number;
  immune: boolean;
  /** 受擊種類：normal = 普通攻擊（不硬直、不後退）；control = 技能（連續受擊抗性） */
  kind?: "normal" | "control";
}

export interface HitResistanceConfig {
  comboResetAfter: number;
  tiers: readonly HitTier[];
}

/** 連續受擊抗性（純邏輯）。每隻怪物一份；數值見 config/hitReaction.ts */
export class HitResistance {
  private count = 0;
  private lastHit = Number.NEGATIVE_INFINITY;
  private immuneUntil = Number.NEGATIVE_INFINITY;
  private readonly cfg: HitResistanceConfig;

  constructor(cfg: HitResistanceConfig = HIT_REACTION) {
    this.cfg = cfg;
  }

  /** 登記一次受擊，回傳這一擊的反應 */
  register(now: number): HitReaction {
    if (now - this.lastHit >= this.cfg.comboResetAfter) {
      this.count = 0;
      this.immuneUntil = Number.NEGATIVE_INFINITY;
    }
    this.lastHit = now;
    if (now < this.immuneUntil) return { tier: 0, stagger: 0, recoil: 0, immune: true };
    const n = this.cfg.tiers.length;
    this.count = this.count >= n ? 1 : this.count + 1;
    const t = this.cfg.tiers[this.count - 1]!;
    if (t.immunity && t.immunity > 0) this.immuneUntil = now + t.immunity;
    return { tier: this.count, stagger: t.stagger, recoil: t.recoil, immune: false };
  }

  /** 目前狀態（測試、除錯面板用；不改變任何東西） */
  state(now: number): { combo: number; immuneRemaining: number } {
    const expired = now - this.lastHit >= this.cfg.comboResetAfter;
    return { combo: expired ? 0 : this.count, immuneRemaining: expired ? 0 : Math.max(0, this.immuneUntil - now) };
  }

  reset(): void {
    this.count = 0;
    this.lastHit = Number.NEGATIVE_INFINITY;
    this.immuneUntil = Number.NEGATIVE_INFINITY;
  }
}
