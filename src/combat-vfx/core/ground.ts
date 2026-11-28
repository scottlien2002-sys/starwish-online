/**
 * 地面高度取樣（純函式，單元測試用）：中心，斜坡時再取半徑 r×0.7 的四個方向，取最高處。
 * 平面特效（衝擊波、塵環、地裂、魔法陣）放在這個高度不會埋進上坡那一側。非數字當作 0。
 */
export type GroundFn = (x: number, z: number) => number;

export function groundHeight(fn: GroundFn, x: number, z: number, r = 0): number {
  const h = (px: number, pz: number) => {
    const v = fn(px, pz);
    return Number.isFinite(v) ? v : 0;
  };
  let y = h(x, z);
  if (r > 0) {
    const k = r * 0.7;
    y = Math.max(y, h(x + k, z), h(x - k, z), h(x, z + k), h(x, z - k));
  }
  return y;
}

/** 地面特效抬高（避免與地面 z-fighting） */
export const GROUND_LIFT = 0.02;
