/**
 * 已確定的正式名稱 — 不可擅自更改。
 * ID 用於程式與存檔；displayName 是遊戲內顯示名稱。
 */
export const CLASS_CANON = Object.freeze({
  novice: "初心者",
  swordsman: "劍士",
  mage: "法師",
  priest: "祭司",
  clown: "小丑",
  archer: "弓箭手",
  knight: "騎士",
} as const);

export type ClassId = keyof typeof CLASS_CANON;

/** 第一階段製作的職業 */
export const PHASE1_CLASSES: readonly ClassId[] = Object.freeze(["novice", "swordsman"]);

export const MONSTER_CANON = Object.freeze({
  star_dew_bobo: "星露啵啵",
  moss_horn_beast: "苔角獸",
  flame_tail_fox: "焰尾狐",
} as const);

export type MonsterId = keyof typeof MONSTER_CANON;
