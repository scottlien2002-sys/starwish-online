/**
 * 角色動畫時間（純邏輯，可單元測試）。
 * - 攻擊：基礎 0.5 秒、命中 0.2 秒，與遊戲 ATTACK_TIMING（蓄力 0.14／揮擊 0.12／收招 0.24）一致
 * - 攻速：攻速越高播放越快、命中越早。攻速 → 播放倍率的公式「尚未定案」，目前暫用 攻速／100（可在這裡調整）
 * - 跑步：依實際移動速度調整播放倍率，減少滑步（runGroundSpeed 來自 Blender 量測：步伐循環中支撐腳往後的速度）
 */
import { ATTACK_TIMING, ATTACK_DURATION } from "./attackAnim.ts";
import { clampAttackSpeed } from "../core/rules.ts";
import type { AnimName } from "./animState.ts";

export const ANIM_TIMING = Object.freeze({
  crossfade: 0.15,
  attack: Object.freeze({ seconds: ATTACK_DURATION, hit: ATTACK_TIMING.hit }),
  jump: Object.freeze({ height: 0.35 }),
  run: Object.freeze({
    /** 跑步動畫在播放倍率 1 時的「步行地面速度」（公尺／秒；C1.0-B5 Blender 量測：男 1.66、女 1.79，取平均） */
    groundSpeed: 1.72,
    /** 播放倍率限制：太慢看起來像慢動作、太快腳會糊在一起；超過上限的部分仍會滑步 */
    minRate: 0.8,
    maxRate: 2.4,
  }),
  /** 攻速公式參數（暫定；正式公式定案後改這裡） */
  attackSpeedBase: 100,
});

/** 攻速 → 攻擊動作播放倍率（暫定：攻速／100；上限 160 → 最快 1.6 倍，0.3125 秒） */
export function attackPlaybackRate(attackSpeed: number): number {
  const v = clampAttackSpeed(attackSpeed);
  return Math.max(0.5, v / ANIM_TIMING.attackSpeedBase);
}

/** 跑步播放倍率與剩下的滑步速度（公尺／秒；正值 = 身體比腳快） */
export function runRate(speed: number, groundSpeed: number = ANIM_TIMING.run.groundSpeed): { rate: number; slide: number } {
  const want = speed / groundSpeed;
  const rate = Math.min(ANIM_TIMING.run.maxRate, Math.max(ANIM_TIMING.run.minRate, want));
  return { rate, slide: speed - rate * groundSpeed };
}

/** 每個狀態的動畫播放倍率 */
export function animClock(state: AnimName, speed: number, attackRate: number): { rate: number; runRate: number } {
  const r = runRate(speed).rate;
  if (state === "Run") return { rate: r, runRate: r };
  if (state === "Attack") return { rate: attackRate, runRate: r };
  return { rate: 1, runRate: r };
}
