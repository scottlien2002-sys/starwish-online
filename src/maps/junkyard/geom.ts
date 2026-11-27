/** 星廢垃圾場：共用幾何小工具（純函式） */
import type { Vec2 } from "./layout.ts";

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 點到線段：距離與參數 t（未夾住） */
export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const vx = bx - ax;
  const vz = bz - az;
  const L2 = vx * vx + vz * vz || 1e-9;
  const t = ((px - ax) * vx + (pz - az) * vz) / L2;
  const tc = Math.min(1, Math.max(0, t));
  const dx = px - (ax + vx * tc);
  const dz = pz - (az + vz * tc);
  return { d: Math.hypot(dx, dz), t };
}

export function polyDist(px: number, pz: number, pts: readonly Vec2[]): number {
  if (pts.length === 1) return Math.hypot(px - pts[0]!.x, pz - pts[0]!.z);
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    best = Math.min(best, segDist(px, pz, a.x, a.z, b.x, b.z).d);
  }
  return best;
}

/** 可重現的亂數（mulberry32） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
