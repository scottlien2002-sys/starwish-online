/**
 * Stage 7.4：怪物距離分級效能管理（純邏輯，不依賴 Babylon；可單元測試）。
 *
 * | 等級 | 條件（與玩家距離） | 動畫 | 視覺更新 | 陰影 | 繪製 |
 * |---|---|---|---|---|---|
 * | near | 畫面內、< 16 m | Babylon 每幀（完整品質） | 每幀 | 投射 | 畫 |
 * | mid  | 畫面內、16～34 m | 手動跳格 | 每 2 幀 | < 24 m 才投射 | 畫 |
 * | far  | 畫面內、34～60 m | 手動跳格 | 每 4 幀 | 不投射 | 畫 |
 * | hidden | 畫面內、≥ 60 m | 手動跳格 | 每 8 幀 | 不投射 | 不畫 |
 * | offscreen | 畫面外 | 暫停（< 10 m 例外：每 2 幀，陰影可能落在畫面內） | 0 | 不投射（< 10 m 例外） | 引擎本來就不畫 |
 *
 * AI、追擊、攻擊命中、死亡、重生全部照常每幀計算（MonsterController 只降低「視覺」更新頻率）。
 * 邊界有 2 m 遲滯，站在邊界上不會來回切換。
 */
export type DetailTier = "near" | "mid" | "far" | "hidden" | "offscreen";

export interface DetailSettings {
  tier: DetailTier;
  /** MonsterController.visualStride */
  stride: number;
  anim: "auto" | "manual";
  shadow: boolean;
  render: boolean;
}

export const DETAIL_DIST = Object.freeze({ near: 16, mid: 34, far: 60, offscreenNear: 10, shadowMid: 24, hysteresis: 2 });

const ORDER: Record<DetailTier, number> = { near: 0, mid: 1, far: 2, hidden: 3, offscreen: 4 };

export function pickTier(dist: number, inView: boolean, prev: DetailTier | null): DetailTier {
  if (!inView) return "offscreen";
  const cur = prev && prev !== "offscreen" ? ORDER[prev] : 99;
  // 目前在比邊界近的等級時，要再多走 hysteresis 公尺才切到較遠的等級（避免站在邊界上來回切換）
  const th = (i: number, d: number): number => d + (cur <= i ? DETAIL_DIST.hysteresis : 0);
  if (dist < th(0, DETAIL_DIST.near)) return "near";
  if (dist < th(1, DETAIL_DIST.mid)) return "mid";
  if (dist < th(2, DETAIL_DIST.far)) return "far";
  return "hidden";
}

export function detailFor(tier: DetailTier, dist: number): DetailSettings {
  switch (tier) {
    case "near":
      return { tier, stride: 1, anim: "auto", shadow: true, render: true };
    case "mid":
      return { tier, stride: 2, anim: "manual", shadow: dist < DETAIL_DIST.shadowMid, render: true };
    case "far":
      return { tier, stride: 4, anim: "manual", shadow: false, render: true };
    case "hidden":
      return { tier, stride: 8, anim: "manual", shadow: false, render: false };
    case "offscreen":
      return dist < DETAIL_DIST.offscreenNear
        ? { tier, stride: 2, anim: "manual", shadow: true, render: true }
        : { tier, stride: 0, anim: "manual", shadow: false, render: true };
  }
}

/** 球與視錐的測試：planes 是 4 個數（a,b,c,d），點在平面內側時 a·x+b·y+c·z+d ≥ 0 */
export function sphereInFrustum(planes: readonly { normal: { x: number; y: number; z: number }; d: number }[], x: number, y: number, z: number, r: number): boolean {
  for (const p of planes) if (p.normal.x * x + p.normal.y * y + p.normal.z * z + p.d < -r) return false;
  return true;
}
