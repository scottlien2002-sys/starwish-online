import { clamp } from "../core/math.ts";
import { TUNING } from "../config/tuning.ts";

/** 新手草原地形（純函式，不依賴 Babylon，可單元測試、未來伺服器可共用） */

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** 世界座標 (x, z) 的地面高度（公尺） */
export function heightAt(x: number, z: number): number {
  const { halfSize, spawnFlatRadius } = TUNING.world;

  // 柔和起伏的小丘
  const hills =
    0.9 * Math.sin(x * 0.045 + 0.6) * Math.cos(z * 0.05 - 0.4) +
    0.45 * Math.sin(x * 0.11 + z * 0.07) +
    0.25 * Math.cos(x * 0.19 - z * 0.15 + 1.3);

  // 出生點附近壓平
  const r = Math.hypot(x, z);
  const spawnMask = smoothstep(spawnFlatRadius, spawnFlatRadius + 10, r);

  // 地圖外圍隆起成小山丘，形成自然邊界
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const rim = smoothstep(halfSize - 12, halfSize + 4, edge) * 5;

  return (hills + 0.9) * 0.9 * spawnMask + rim;
}

/** 可行走範圍（含邊界內縮） */
export function walkableHalfSize(): number {
  return TUNING.world.halfSize - TUNING.world.edgePadding;
}

export function clampToWalkable(x: number, z: number): { x: number; z: number } {
  const h = walkableHalfSize();
  return { x: clamp(x, -h, h), z: clamp(z, -h, h) };
}

export function isWalkable(x: number, z: number): boolean {
  const h = walkableHalfSize();
  return Math.abs(x) <= h && Math.abs(z) <= h;
}
