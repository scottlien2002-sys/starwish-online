/**
 * 星芽原野植被距離分級（純邏輯，不依賴 Babylon；單元測試可直接跑）。Claude B，交 Claude A 整合。
 *
 * - 樹：精細（近）／中距離（同輪廓、較少面）／簡化（遠）三級；灌木同樣三級；岩石只有一級
 * - 每棵樹各自依距離選等級（不再整塊 45 m 一起切換），邊界有遲滯，不會在邊界上來回閃
 * - 草、花：每格的顯示數量隨距離平滑遞減（隨機順序，等於隨機抽稀），到格子關閉前已經淡到 0，不會整格跳出
 * - 中遠距離只畫鏡頭前方（含兩側寬裕角度）的樹；超過霧的盡頭不畫
 */

export type VegLevel = 0 | 1 | 2; // 0＝精細、1＝中距離、2＝簡化

export interface VegLodConfig {
  /** 精細 → 中距離的距離（m） */
  hiR: number;
  /** 中距離 → 簡化 */
  midR: number;
  /** 超過就不畫（霧的盡頭） */
  farR: number;
  /** 遲滯（m）：往外切換要多走這麼遠，往內切換提早這麼多 */
  hyst: number;
  /** 灌木：精細／中距離（灌木小，切換距離較近） */
  smallHiR: number;
  smallMidR: number;
  /** 投射陰影的距離（只有精細等級；Lite 不投射） */
  shadowR: number;
  /** 草：完整密度距離、淡到 0 的距離 */
  grassFull: number;
  grassEnd: number;
  /** 花：完整密度距離、淡到 0 的距離 */
  flowerFull: number;
  flowerEnd: number;
  /** 遠處保留的最低密度比例（淡出前段；0～1） */
  tuftFloor: number;
  /** 鏡頭後方剔除：與鏡頭前方夾角的餘弦低於此值且距離 > behindR 就不畫 */
  behindCos: number;
  behindR: number;
}

/** 高畫質（HQ）：霧 55～150 m */
export const VEG_LOD_HQ: VegLodConfig = {
  hiR: 24,
  midR: 58,
  farR: 150,
  hyst: 3,
  smallHiR: 16,
  smallMidR: 40,
  shadowR: 20,
  grassFull: 16,
  grassEnd: 40,
  flowerFull: 18,
  flowerEnd: 46,
  tuftFloor: 0.35,
  behindCos: -0.25,
  behindR: 14,
};

/** 中、低畫質（Lite）：霧 40～110 m */
export const VEG_LOD_LITE: VegLodConfig = {
  hiR: 16,
  midR: 42,
  farR: 110,
  hyst: 3,
  smallHiR: 12,
  smallMidR: 30,
  shadowR: 0,
  grassFull: 12,
  grassEnd: 28,
  flowerFull: 14,
  flowerEnd: 32,
  tuftFloor: 0.35,
  behindCos: -0.25,
  behindR: 12,
};

/** 依距離選等級（含遲滯）。prev＝上一次的等級（第一次給 null） */
export function levelFor(d: number, prev: VegLevel | null, hiR: number, midR: number, hyst: number): VegLevel {
  const raw: VegLevel = d < hiR ? 0 : d < midR ? 1 : 2;
  if (prev === null || raw === prev) return raw;
  // 往外（等級變大）：要超過邊界＋遲滯才切；往內：要進到邊界－遲滯才切
  if (raw > prev) {
    const edge = prev === 0 ? hiR : midR;
    return d >= edge + hyst ? raw : prev;
  }
  const edge = raw === 0 ? hiR : midR;
  return d <= edge - hyst ? raw : prev;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * 草花密度（0～1）：full 以內 1；之後平滑降到 floor（距離到 end 的一半），再平滑降到 0（end）。
 * d＝玩家到格子最近點的距離。
 */
export function tuftDensity(d: number, full: number, end: number, floor: number): number {
  if (d <= full) return 1;
  if (d >= end) return 0;
  const mid = (full + end) / 2;
  if (d <= mid) return 1 - (1 - floor) * smooth(full, mid, d);
  return floor * (1 - smooth(mid, end, d));
}

/** 點是否在鏡頭後方（要剔除）：fx, fz＝鏡頭前方（水平、單位向量） */
export function behindCamera(dx: number, dz: number, d: number, fx: number, fz: number, cosLimit: number, minR: number): boolean {
  if (d <= minR || d < 1e-6) return false;
  return (dx * fx + dz * fz) / d < cosLimit;
}

/** 每格顯示數量往目標靠近（每次最多變動 maxStep 個；避免一格突然多出／少掉很多） */
export function approachCount(cur: number, target: number, maxStep: number): number {
  if (cur < target) return Math.min(target, cur + maxStep);
  if (cur > target) return Math.max(target, cur - maxStep);
  return cur;
}

/** 可重現的洗牌（同一個種子得到同一個順序；抽稀時顯示的是隨機子集，不會集中在某一邊） */
export function shuffledOrder(n: number, seed: number): Uint32Array {
  const a = new Uint32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  let s = seed >>> 0 || 1;
  for (let i = n - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}
