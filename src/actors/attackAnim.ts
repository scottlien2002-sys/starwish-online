/**
 * 玩家普通攻擊的程式化動畫（純邏輯，不依賴 Babylon，可單元測試）。
 *
 * 三個階段：蓄力（右手往後上方拉、身體往右後扭）→ 揮擊（右手往前揮、身體前傾並向前踏）→ 收招（回到待機）。
 * 傷害判定時間 HIT_TIME 落在揮擊中段，由遊戲端在這個時間點結算傷害，讓「打到」與「看到揮中」同步。
 *
 * 只控制動作快慢，不影響攻擊間隔（間隔由戰鬥系統決定，這段動畫總長必須短於攻擊間隔）。
 */

export type AttackPhase = "idle" | "windup" | "strike" | "recover";

export const ATTACK_TIMING = Object.freeze({
  windup: 0.14,
  strike: 0.12,
  recover: 0.24,
  /** 傷害判定：蓄力結束後 0.06 秒（揮擊中段） */
  hit: 0.2,
});

export const ATTACK_DURATION = ATTACK_TIMING.windup + ATTACK_TIMING.strike + ATTACK_TIMING.recover;

/** 動畫輸出（角色本地座標：+z 前方、+y 上方；弧度／公尺） */
export interface AttackPose {
  phase: AttackPhase;
  /** 0..1：攻擊動作對全身的影響程度（收招尾段漸弱，讓走路與待機自然接回） */
  weight: number;
  /** 右手肩關節 x 軸：正值 = 手往後，負值 = 手往前 */
  armRX: number;
  /** 右手肩關節 z 軸：手臂往外張開 */
  armRZ: number;
  /** 左手：反向小擺，保持平衡 */
  armLX: number;
  /** 身體前傾（正值 = 往前） */
  lean: number;
  /** 身體扭轉（正值 = 右肩往後） */
  twist: number;
  /** 身體往前踏出的距離（公尺） */
  lunge: number;
}

const IDLE: AttackPose = { phase: "idle", weight: 0, armRX: 0, armRZ: 0, armLX: 0, lean: 0, twist: 0, lunge: 0 };

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);
const easeIn = (t: number): number => t * t;
const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 關鍵姿勢 */
const WINDUP_KEY = { armRX: 1.25, armRZ: 0.55, armLX: -0.35, lean: -0.06, twist: 0.42, lunge: -0.02 };
const STRIKE_KEY = { armRX: -1.75, armRZ: 0.2, armLX: 0.45, lean: 0.24, twist: -0.38, lunge: 0.14 };

type KeyPose = typeof WINDUP_KEY;
const setPose = (out: AttackPose, phase: AttackPhase, weight: number, a: KeyPose, b: KeyPose, k: number): AttackPose => {
  out.phase = phase;
  out.weight = weight;
  out.armRX = lerp(a.armRX, b.armRX, k);
  out.armRZ = lerp(a.armRZ, b.armRZ, k);
  out.armLX = lerp(a.armLX, b.armLX, k);
  out.lean = lerp(a.lean, b.lean, k);
  out.twist = lerp(a.twist, b.twist, k);
  out.lunge = lerp(a.lunge, b.lunge, k);
  return out;
};
const ZERO_KEY: KeyPose = { armRX: 0, armRZ: 0, armLX: 0, lean: 0, twist: 0, lunge: 0 };

/**
 * 依攻擊開始後經過的秒數，把姿勢寫入 out（不建立新物件；每幀使用）。
 * 不在攻擊中時回傳共用的待機姿勢（不寫入 out）。
 */
export function attackPoseInto(t: number, out: AttackPose): AttackPose {
  const { windup, strike, recover } = ATTACK_TIMING;
  if (t < 0 || t >= windup + strike + recover) return IDLE;
  // 曲線與移植前完全相同：蓄力 = 0 → 蓄力姿勢（easeOut）；揮擊 = 蓄力 → 揮擊姿勢（easeIn）；收招 = 揮擊姿勢 → 0（easeInOut）
  if (t < windup) return setPose(out, "windup", 1, ZERO_KEY, WINDUP_KEY, easeOut(t / windup));
  if (t < windup + strike) return setPose(out, "strike", 1, WINDUP_KEY, STRIKE_KEY, easeIn((t - windup) / strike));
  const k = easeInOut((t - windup - strike) / recover);
  return setPose(out, "recover", 1 - k, STRIKE_KEY, ZERO_KEY, k);
}

/** 依攻擊開始後經過的秒數取得姿勢（純函式，回傳新物件；測試用） */
export function attackPoseAt(t: number): AttackPose {
  return attackPoseInto(t, { ...IDLE });
}

/**
 * 攻擊動畫播放器。start() 每次都從蓄力重新開始（不疊加），update() 推進時間並回傳姿勢。
 */
export class AttackAnimator {
  private t = -1;
  /** 已開始的攻擊次數（測試用） */
  started = 0;

  get active(): boolean {
    return this.t >= 0 && this.t < ATTACK_DURATION;
  }

  get elapsed(): number {
    return this.t;
  }

  start(): void {
    this.t = 0;
    this.started++;
  }

  /** 重複使用的姿勢物件（每幀不建立新物件） */
  private readonly scratch: AttackPose = { ...IDLE };

  update(dt: number): AttackPose {
    if (this.t < 0) return IDLE;
    this.t += dt;
    if (this.t >= ATTACK_DURATION) {
      this.t = -1;
      return IDLE;
    }
    return attackPoseInto(this.t, this.scratch);
  }

  /** 目前姿勢（不推進時間） */
  pose(): AttackPose {
    return this.t < 0 ? IDLE : attackPoseInto(this.t, this.scratch);
  }
}
