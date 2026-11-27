/**
 * 傷害結算介面（純邏輯）。
 * 展示頁用 DemoResolver（展示用測試值，不是正式數值）；正式遊戲由 Claude A 的戰鬥系統實作 CombatResolver，
 * 多人模式由 Claude D 的伺服器結算後把結果送回來（客戶端只播特效，不自己算傷害）。
 */
import type { HitSpec } from "./skills.ts";
import { clampAttackSpeed } from "../../core/rules.ts";

export interface HitContext {
  skillId: string;
  hit: HitSpec;
  attackerId: string;
  targetId: string;
  /** 同一次施放的序號（同一段命中對同一目標只結算一次） */
  castId: number;
}

export interface HitResult {
  targetId: string;
  damage: number;
  crit: boolean;
  /** 這一下讓目標倒下 */
  kill: boolean;
}

export interface CombatResolver {
  resolve(ctx: HitContext, targetHp: number): HitResult;
}

/** mulberry32：可重現的亂數（測試用固定種子） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_STATS = Object.freeze({ attack: 40, critRate: 0.2, critMult: 1.6, spread: 0.1, note: "展示用測試值（不是正式平衡）" });

export class DemoResolver implements CombatResolver {
  private readonly r: () => number;
  private readonly done = new Set<string>();
  constructor(seed = 20261127) {
    this.r = rng(seed);
  }
  resolve(ctx: HitContext, targetHp: number): HitResult {
    const key = `${ctx.castId}|${ctx.hit.id}|${ctx.targetId}`;
    if (this.done.has(key)) return { targetId: ctx.targetId, damage: 0, crit: false, kill: false };
    this.done.add(key);
    if (this.done.size > 5000) this.done.clear();
    const crit = ctx.hit.forceCrit === true || this.r() < DEMO_STATS.critRate;
    const base = DEMO_STATS.attack * ctx.hit.mult * (1 - DEMO_STATS.spread + 2 * DEMO_STATS.spread * this.r());
    const damage = Math.max(1, Math.round(base * (crit ? DEMO_STATS.critMult : 1)));
    return { targetId: ctx.targetId, damage, crit, kill: damage >= targetHp };
  }
}

/** 技能播放倍率：受攻速影響的技能 = 攻速／100（攻速上限 160 → 1.6 倍）；其他 = 1 */
export function skillRate(aspdScaled: boolean, attackSpeed: number): number {
  if (!aspdScaled) return 1;
  return Math.max(0.5, clampAttackSpeed(attackSpeed) / 100);
}
