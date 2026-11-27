/**
 * 角色等級與經驗（Stage 7.2）。
 * ⚠ 升級所需經驗是「測試設定」（企劃尚未提供正式表）；升級目前只提升等級數字，
 *   不改變生命、攻擊等能力值（平衡數值不由程式端決定）。
 */
export const PROGRESSION_PROVISIONAL = true;

/** 測試設定：Lv.1→2 需要 100，之後每級遞增；Lv.10 以後沿用最後一級 ×1.2 */
export const EXP_TABLE_TEST: readonly number[] = [100, 150, 220, 300, 400, 520, 660, 820, 1000];

export function expToNext(level: number): number {
  const i = Math.max(1, Math.floor(level)) - 1;
  if (i < EXP_TABLE_TEST.length) return EXP_TABLE_TEST[i]!;
  return Math.round(EXP_TABLE_TEST[EXP_TABLE_TEST.length - 1]! * Math.pow(1.2, i - EXP_TABLE_TEST.length + 1));
}

export interface Progress {
  level: number;
  exp: number;
}

/** 加經驗（可連升多級）。回傳升了幾級 */
export function gainExp(p: Progress, amount: number): number {
  const add = Math.max(0, Math.floor(amount));
  if (!add) return 0;
  p.exp += add;
  let ups = 0;
  while (p.exp >= expToNext(p.level) && ups < 100) {
    p.exp -= expToNext(p.level);
    p.level++;
    ups++;
  }
  return ups;
}

export function sanitizeProgress(level: unknown, exp: unknown): Progress {
  const lv = Math.max(1, Math.min(999, Math.floor(Number(level)) || 1));
  const ex = Math.max(0, Math.floor(Number(exp)) || 0);
  return { level: lv, exp: Math.min(ex, expToNext(lv) - 1) };
}
