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
    /** 各版本、性別的量測值（Blender 量測支撐腳往後的速度）。C1.0-B5a 跨步加大 → 5 m/s 只需約 2.1～2.2 倍，不超過上限、不滑步 */
    groundSpeedBy: Object.freeze({
      c10b5: Object.freeze({ male: 1.66, female: 1.79 }),
      c10b5a: Object.freeze({ male: 2.26, female: 2.41 }),
      c10b5b: Object.freeze({ male: 2.26, female: 2.41 }), // 跑步動作與 B5a 相同
      tripo72: Object.freeze({ male: 2.25, female: 2.25 }), // Stage 7.2 新版（Tripo）：跑步循環 0.5 秒、大腿擺幅 ±42°、腿長約 0.42 m 推算的支撐腳速度
    }) as Readonly<Record<string, Readonly<Record<"male" | "female", number>>>>,
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
export function animClock(state: AnimName, speed: number, attackRate: number, groundSpeed: number = ANIM_TIMING.run.groundSpeed): { rate: number; runRate: number } {
  const r = runRate(speed, groundSpeed).rate;
  if (state === "Run") return { rate: r, runRate: r };
  if (state === "Attack") return { rate: attackRate, runRate: r };
  return { rate: 1, runRate: r };
}
