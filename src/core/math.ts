export interface Vec2 {
  x: number;
  y: number;
}

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 與幀率無關的平滑插值係數 */
export const damp = (sharpness: number, dt: number): number => 1 - Math.exp(-sharpness * dt);

export const length2 = (x: number, y: number): number => Math.hypot(x, y);

/** 角度差，結果在 (-PI, PI] */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}
