/**
 * 怪物動畫的共用型別。
 * 動畫邏輯只輸出「姿勢資料」(MonsterPose) 與「特效事件」(MonsterEffect)，
 * 不依賴 Babylon；任何模型（程式化或 GLB）只要實作 MonsterView 就能套用。
 */

/** 可請求的動作 */
export type MonsterAction = "idle" | "move" | "attack" | "hit" | "death" | "respawn";

/** 狀態機內部狀態（dead = 死亡動畫播完、等待重生） */
export type MonsterState = "idle" | "move" | "attack" | "hit" | "death" | "dead" | "respawn";

export type MonsterFace = "normal" | "angry" | "hurt";

export type MonsterEffect = "attackImpact" | "deathBurst" | "respawnStart" | "respawnPop";

export interface MonsterPose {
  /** 本地座標位移（公尺，以模型 1 單位高為基準）：y 向上、z 向前 */
  offsetY: number;
  offsetZ: number;
  /** 左右震動位移 */
  shakeX: number;
  /** 身體縮放：scaleY 為高度、scaleXZ 為寬度 */
  scaleY: number;
  scaleXZ: number;
  /** 前後方向額外伸縮（1 = 不變；攻擊衝撞時拉長、撞擊時壓扁） */
  stretchZ: number;
  /** 前傾角度（弧度，正值往前） */
  lean: number;
  /** 整體不透明度 0~1 */
  opacity: number;
  /** 星星亮度 0~1 */
  starGlow: number;
  /** 觸角擺動（弧度） */
  antennaSway: number;
  /** 翅膀拍動（弧度） */
  wingFlap: number;
  /** 受擊閃白 0~1 */
  hitFlash: number;
  face: MonsterFace;
  /** 重生光環：0 = 隱藏 */
  ringScale: number;
  ringOpacity: number;
  /** false = 完全不顯示身體（死亡後） */
  bodyVisible: boolean;
}

export const BASE_POSE: Readonly<MonsterPose> = Object.freeze({
  offsetY: 0,
  offsetZ: 0,
  shakeX: 0,
  scaleY: 1,
  scaleXZ: 1,
  stretchZ: 1,
  lean: 0,
  opacity: 1,
  starGlow: 1,
  antennaSway: 0,
  wingFlap: 0,
  hitFlash: 0,
  face: "normal",
  ringScale: 0,
  ringOpacity: 0,
  bodyVisible: true,
});

export interface MonsterAnimTimings {
  attack: number;
  hit: number;
  death: number;
  respawn: number;
  idlePeriod: number;
  hopPeriod: number;
  /**
   * 選填規則（省略 = 原本的行為，V2 與測試方塊不設定）：
   * true = 攻擊中受擊會打斷攻擊、進入受擊（被打斷的攻擊不會觸發命中）；省略／false = 只疊加閃白、不打斷
   */
  hitInterruptsAttack?: boolean;
  /**
   * 受擊中再受擊：受擊開始後這麼多秒內不重播受擊動畫（傷害照常結算，由呼叫端扣血）；之後從頭重播。
   * 省略／0 = 原本的「每次都重新計時」
   */
  hitRehitLock?: number;
}

export interface EffectCue {
  state: MonsterState;
  at: number;
  effect: MonsterEffect;
}

/** 怪物外觀（程式化或 GLB）必須實作的介面 */
export interface MonsterView {
  applyPose(pose: MonsterPose): void;
  playEffect(effect: MonsterEffect): void;
  /** 每幀更新粒子、材質動畫等 */
  update(dt: number): void;
  dispose(): void;
}
