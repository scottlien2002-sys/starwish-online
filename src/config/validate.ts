import { CORE_RULES } from "../core/rules.ts";

/** 設定檔驗證：確保設定檔沒有違反核心規則。回傳錯誤訊息陣列，空陣列代表通過。 */

export interface AffixEntry {
  stat: string;
  label: string;
  unit: "flat" | "percent";
  values: number[];
  statWeight: number | null;
  valueWeights: number[] | null;
}

export interface AffixConfig {
  schemaVersion: number;
  weapon: AffixEntry[];
  armor: AffixEntry[];
}

export const WEAPON_AFFIX_STATS = Object.freeze(["attackSpeed", "attack", "hitRate", "critRate"]);
export const ARMOR_AFFIX_STATS = Object.freeze(["defense", "maxHp", "blockRate", "attackSpeed"]);

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x)) && new Set(a).size === a.length;
}

function validateEntries(group: string, entries: AffixEntry[], allowed: readonly string[]): string[] {
  const errors: string[] = [];
  const stats = entries.map((e) => e.stat);
  if (!sameSet(stats, allowed)) {
    errors.push(`${group}: 詞條種類必須是 [${allowed.join(", ")}]，目前是 [${stats.join(", ")}]`);
  }
  for (const e of entries) {
    if (!Array.isArray(e.values) || e.values.length === 0) {
      errors.push(`${group}.${e.stat}: values 不可為空`);
      continue;
    }
    for (let i = 0; i < e.values.length; i++) {
      const v = e.values[i]!;
      if (!(v > 0)) errors.push(`${group}.${e.stat}: 數值必須為正數`);
      if (i > 0 && v <= e.values[i - 1]!) errors.push(`${group}.${e.stat}: 數值必須遞增`);
    }
    if (e.stat === "attackSpeed" && Math.max(...e.values) > CORE_RULES.maxAttackSpeed) {
      errors.push(`${group}.attackSpeed: 單條詞條超過攻速上限 ${CORE_RULES.maxAttackSpeed}`);
    }
    if (e.statWeight !== null && !(e.statWeight > 0)) {
      errors.push(`${group}.${e.stat}: statWeight 必須為正數或 null`);
    }
    if (e.valueWeights !== null) {
      if (e.valueWeights.length !== e.values.length) {
        errors.push(`${group}.${e.stat}: valueWeights 長度必須等於 values`);
      } else if (e.valueWeights.some((w) => !(w > 0))) {
        errors.push(`${group}.${e.stat}: valueWeights 必須為正數`);
      }
    }
  }
  return errors;
}

export function validateAffixConfig(config: AffixConfig): string[] {
  return [
    ...validateEntries("weapon", config.weapon, WEAPON_AFFIX_STATS),
    ...validateEntries("armor", config.armor, ARMOR_AFFIX_STATS),
  ];
}

/** 機率是否已全部填寫（W3 鑑定功能啟用前必須為 true） */
export function affixProbabilitiesReady(config: AffixConfig): boolean {
  return [...config.weapon, ...config.armor].every(
    (e) => e.statWeight !== null && e.valueWeights !== null,
  );
}

export interface EnhanceLevel {
  to: number;
  successRate: number | null;
  materials: unknown;
  onFail: string | null;
  bonus: unknown;
}

export interface EnhanceConfig {
  schemaVersion: number;
  system: string;
  status: "pending_user_confirmation" | "confirmed";
  levels: EnhanceLevel[];
}

export function validateEnhanceConfig(config: EnhanceConfig): string[] {
  const errors: string[] = [];
  const expected = CORE_RULES.maxEnhanceLevel - CORE_RULES.minEnhanceLevel;
  if (config.levels.length !== expected) {
    errors.push(`強化表必須剛好 ${expected} 階（+1 ~ +${CORE_RULES.maxEnhanceLevel}），目前 ${config.levels.length}`);
  }
  config.levels.forEach((lv, i) => {
    if (lv.to !== i + 1) errors.push(`強化表第 ${i + 1} 列的 to 應為 ${i + 1}，目前 ${lv.to}`);
    if (lv.successRate !== null && !(lv.successRate >= 0 && lv.successRate <= 100)) {
      errors.push(`+${lv.to}: successRate 必須在 0~100`);
    }
    if (config.status === "confirmed" && (lv.successRate === null || lv.materials === null || lv.onFail === null)) {
      errors.push(`+${lv.to}: 狀態為 confirmed 但仍有未填欄位`);
    }
  });
  return errors;
}
