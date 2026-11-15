/**
 * 《星願物語》核心設定 — 不可擅自更改。
 * 任何修改都必須先經企劃（使用者）確認，並同步更新 docs/CORE_RULES.md 與測試。
 */
export const CORE_RULES = Object.freeze({
  /** 經典 3D Q版 MMORPG，手動打怪與升級（不做自動戰鬥） */
  manualCombatOnly: true,
  /** 第一版等級上限 */
  maxLevel: 20,
  /** 角色攻擊速度上限 */
  maxAttackSpeed: 160,
  /** 裝備每 5 等一階 */
  equipmentTierLevelStep: 5,
  /** 第一版裝備階級的需求等級 */
  equipmentTierLevels: Object.freeze([5, 10, 15, 20] as const),
  /** 裝備不設稀有度 */
  equipmentHasRarity: false,
  /** 每件裝備只能鑑定出一條附加屬性 */
  maxAffixesPerEquipment: 1,
  /** 強化範圍 +1 ~ +10（0 代表未強化） */
  minEnhanceLevel: 0,
  maxEnhanceLevel: 10,
  /** 鑑定、強化、掉落資料必須獨立儲存 */
  separateEquipmentRecords: true,
});

export type CoreRules = typeof CORE_RULES;

export function clampAttackSpeed(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(CORE_RULES.maxAttackSpeed, value));
}

export function clampLevel(level: number): number {
  return Math.max(1, Math.min(CORE_RULES.maxLevel, Math.floor(level)));
}
