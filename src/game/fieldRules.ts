/**
 * Stage 5.6 星芽原野整合：戰鬥、掉落的「測試設定」（純邏輯，可單元測試）。
 * ⚠ 正式傷害公式、防禦公式、經驗值、等級都還沒定案；這裡的值只用來讓整合版可以實玩，畫面上會標示「測試設定」。
 * - 攻擊：基礎週期 0.5 秒、0.2 秒命中（與動畫相同），攻速越高越快（攻速上限 160）
 * - 傷害：基礎 20 × 攻擊力／100（寵物攻擊力加成會反映）
 * - 受到傷害：怪物攻擊 × 50／防禦力（基礎防禦 50 → ×1；寵物防禦加成會減少受到的傷害，最少 1）
 * - 生命：基礎 100，寵物生命加成依百分比
 */
import { ANIM_TIMING, attackPlaybackRate } from "../actors/animTiming.ts";
import { clampAttackSpeed } from "../core/rules.ts";
import type { CombatTuning } from "./previewCombat.ts";
import type { CharacterStats } from "../pets/petSystem.ts";

export const FIELD_TEST = Object.freeze({
  baseStats: Object.freeze({ attack: 100, attackSpeed: 100, defense: 50, maxHp: 100 }) as Readonly<CharacterStats>,
  baseDamage: 20,
  /** 掉落物：撿取半徑、存在時間 */
  pickupRadius: 1.5,
  lootLifetime: 90,
  /** 星露草坪（ZONES 01，上限 6 隻） */
  boboCount: 6,
});

export function combatTuningFromStats(s: CharacterStats): CombatTuning {
  const rate = attackPlaybackRate(clampAttackSpeed(s.attackSpeed));
  return {
    maxHp: Math.max(1, Math.round(s.maxHp)),
    attackDamage: Math.max(1, Math.round((FIELD_TEST.baseDamage * s.attack) / 100)),
    attackInterval: ANIM_TIMING.attack.seconds / rate,
    damageTakenMul: FIELD_TEST.baseStats.defense / Math.max(1, s.defense),
  };
}

/** 星露草坪內的生成點（中心附近一圈，避開邊緣斜坡） */
export function zoneSpawnPoints(cx: number, cz: number, r: number, n: number): { x: number; z: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + 0.4;
    const rr = r * (i % 2 === 0 ? 0.45 : 0.68);
    return { x: Math.round((cx + Math.cos(a) * rr) * 100) / 100, z: Math.round((cz + Math.sin(a) * rr) * 100) / 100 };
  });
}
