/**
 * 世界場景共用：地面接觸陰影（烘焙到地形頂點色）。
 * 大型物件（垃圾堆、建築、機械、地標、道具）與地面接觸處自然變暗，物件看起來「放在地上」而不是浮著。
 * 不需要即時陰影、不增加任何繪製；中、低畫質（沒有即時陰影）效果最明顯。
 */
import { ColliderGrid } from "./colliderGrid.ts";

export interface AOItem {
  x: number;
  z: number;
  /** 物件半徑（公尺） */
  r: number;
  /** 強度倍率（預設 1） */
  k?: number;
}

export interface AOOptions {
  /** 物件邊緣的最暗程度（0～1，0.35＝暗 35%） */
  strength: number;
  /** 從物件邊緣往外淡出的距離（公尺） */
  width: number;
}

/** 回傳 (x,z) → 亮度倍率（1＝不變暗） */
export function makeContactAO(items: readonly AOItem[], o: AOOptions): (x: number, z: number) => number {
  const reach = o.width * 2.5;
  const grid = new ColliderGrid(items.map((it) => ({ x: it.x, z: it.z, bound: it.r + reach })), 8);
  const near: number[] = [];
  return (x: number, z: number): number => {
    grid.query(x, z, 0, near);
    let f = 1;
    for (const i of near) {
      const it = items[i]!;
      const e = Math.hypot(x - it.x, z - it.z) - it.r;
      if (e > reach) continue;
      const t = e <= 0 ? 1 : Math.exp(-(e * e) / (o.width * o.width));
      f *= 1 - o.strength * (it.k ?? 1) * t;
    }
    return Math.max(0.45, f);
  };
}
