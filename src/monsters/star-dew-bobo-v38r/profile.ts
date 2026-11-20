import { genericClipAnim } from "../framework/profiles.ts";
import type { MonsterAnimationProfile } from "../framework/types.ts";
import type { MonsterAnimTimings } from "../anim/types.ts";
import { ATTACK_DURATION, ATTACK_HIT_TIME, DEATH_DURATION, HOP_PERIOD, HURT_DURATION, HURT_REHIT_LOCK, IDLE_PERIOD } from "./animation.ts";

/** 重生淡入時間（秒）；使用者核可範圍 0.30～0.50 */
export const RESPAWN_FADE = 0.4;

/**
 * 星露啵啵 V3.8R 在正式遊戲狀態機中的時長與規則（全部取自已驗收動畫的常數，不另外定義）。
 * - 攻擊 0.95 秒，命中判定在 0.50 秒（attackImpact）
 * - 受傷 0.75 秒；攻擊中受傷會打斷攻擊；受傷前 0.15 秒內再受擊不重播（傷害照扣）
 * - 死亡 1.8 秒；重生 0.40 秒淡入（重生期間不受傷害）
 * 其他怪物不使用這些規則。
 */
export const BOBO_V38R_TIMINGS: MonsterAnimTimings = {
  attack: ATTACK_DURATION,
  hit: HURT_DURATION,
  death: DEATH_DURATION,
  respawn: RESPAWN_FADE,
  idlePeriod: IDLE_PERIOD,
  hopPeriod: HOP_PERIOD,
  hitInterruptsAttack: true,
  hitRehitLock: HURT_REHIT_LOCK,
};

/**
 * 動畫設定：狀態機時長與命中時間點在這裡；實際姿勢由 BoboV38RVisual 依狀態播放已驗收的 V3.8R 動畫
 * （框架的通用姿勢只作為不讀取的預設值）。
 */
export const STAR_DEW_BOBO_V38R_PROFILE: MonsterAnimationProfile = {
  id: "star_dew_bobo_v38r",
  kind: "procedural",
  anim: genericClipAnim(BOBO_V38R_TIMINGS, [{ state: "attack", at: ATTACK_HIT_TIME, effect: "attackImpact" }]),
};
