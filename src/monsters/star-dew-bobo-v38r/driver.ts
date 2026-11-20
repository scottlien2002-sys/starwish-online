import type { MonsterState } from "../anim/types.ts";
import {
  BlinkTimer,
  BoboAnimPlayer,
  type BoboAnimName,
  type BoboPose,
  DEATH_EYES_CLOSE_AT,
  deathFx,
  HOP_PERIOD,
  hopAir,
  HURT_FACE_UNTIL,
  REST_POSE,
} from "./animation.ts";
import { RESPAWN_FADE } from "./profile.ts";

/**
 * 星露啵啵 V3.8R：遊戲狀態 → 已驗收動畫的驅動器（純邏輯，不依賴 Babylon，可單元測試）。
 * BoboV38RVisual 每幀只把這裡算出的結果套到模型上。
 *
 * 遊戲狀態機是唯一的狀態來源：
 *   idle → 待機　move → 彈跳（停下時先跳完這一跳，已驗收的銜接）
 *   attack → 攻擊，立刻開始（命中判定在狀態開始後 0.50 秒，動畫同一刻開始才會對齊）
 *   hit → 受傷（是否重播已由狀態機的 0.15 秒規則決定）
 *   death → 死亡 1.8 秒（淡出、星星熄滅、星塵）　dead → 隱藏（移除）
 *   respawn → 待機姿勢＋0.40 秒淡入
 * 動畫曲線、時長、淡入時間、表情規則全部沿用已驗收內容（animation.ts），這裡只決定「何時播哪一段」。
 */

export type BoboExpr = "normal" | "angry" | "sleepy" | "hurt";

export interface BoboDriverFrame {
  /** true = 已移除（不顯示、沒有圓影與光暈） */
  hidden: boolean;
  pose: BoboPose;
  anim: BoboAnimName;
  animTime: number;
  face: BoboExpr;
  /** 待機眨眼中（只換眼睛貼圖） */
  blinkClosed: boolean;
  /** 整體透明度 0～1（死亡淡出 × 重生淡入） */
  visibility: number;
  /** 頭頂星星亮度 0～1 */
  starBright: number;
  /** 星塵時間（死亡動畫時間；null = 不顯示星塵） */
  dustTime: number | null;
  /** 畫面朝向（弧度；平滑轉向邏輯朝向） */
  yaw: number;
  /** 畫面位置相對邏輯位置的位移（hopSync 才會非 0） */
  offsetX: number;
  offsetZ: number;
}

const smooth01 = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

export class BoboV38RAnimDriver {
  readonly phase: number;
  private readonly blinkSeed: number;
  private readonly hopSync: boolean;
  player: BoboAnimPlayer;
  private blink: BlinkTimer;
  logic: MonsterState = "idle";
  private yaw = 0;
  private targetYaw = 0;
  private hasXf = false;
  private prevX = 0;
  private prevZ = 0;
  private owedX = 0;
  private owedZ = 0;
  private respawnT: number | null = null;
  private blinkClosed = false;
  readonly starts = { attack: 0, hurt: 0, death: 0, respawn: 0 };

  constructor(phase = 0, blinkSeed = 17, hopSync = false) {
    this.phase = phase;
    this.blinkSeed = blinkSeed;
    this.hopSync = hopSync;
    this.player = new BoboAnimPlayer("idle", phase);
    this.blink = new BlinkTimer(blinkSeed);
  }

  /** 邏輯位置與朝向（每幀 MonsterController.setTransform） */
  setTransform(x: number, z: number, yaw: number): void {
    if (this.hasXf && this.hopSync) {
      // 邏輯位移先記為「尚未顯示」，由 update 依彈跳階段在畫面上走完
      this.owedX += x - this.prevX;
      this.owedZ += z - this.prevZ;
    }
    this.prevX = x;
    this.prevZ = z;
    this.targetYaw = yaw;
    if (!this.hasXf) this.yaw = yaw;
    this.hasXf = true;
  }

  /** 遊戲狀態機進入新狀態 */
  onStateEnter(state: MonsterState): void {
    this.logic = state;
    const p = this.player;
    switch (state) {
      case "idle":
      case "move":
        p.request(state);
        break;
      case "attack":
        p.request("attack", { immediate: true });
        this.starts.attack++;
        break;
      case "hit":
        p.hurt(false, { force: true });
        this.starts.hurt++;
        break;
      case "death":
        p.death();
        this.starts.death++;
        break;
      case "dead":
        break;
      case "respawn":
        this.player = new BoboAnimPlayer("idle", this.phase);
        this.blink = new BlinkTimer(this.blinkSeed);
        this.blinkClosed = false;
        this.respawnT = 0;
        this.owedX = this.owedZ = 0;
        this.yaw = this.targetYaw;
        this.starts.respawn++;
        break;
    }
  }

  /** 截圖用：固定為待機第 0 秒、一般表情、對齊邏輯位置與朝向 */
  snap(): void {
    this.yaw = this.targetYaw;
    this.owedX = this.owedZ = 0;
    if (this.logic === "dead") return;
    this.logic = "idle";
    this.player = new BoboAnimPlayer("idle", this.phase);
    this.blink = new BlinkTimer(this.blinkSeed);
    this.blinkClosed = false;
    this.respawnT = null;
  }

  get lag(): number {
    return Math.hypot(this.owedX, this.owedZ);
  }

  update(dt: number): BoboDriverFrame {
    if (this.logic === "dead") {
      return {
        hidden: true,
        pose: REST_POSE,
        anim: this.player.current,
        animTime: this.player.time,
        face: "sleepy",
        blinkClosed: false,
        visibility: 0,
        starBright: 0,
        dustTime: null,
        yaw: this.yaw,
        offsetX: 0,
        offsetZ: 0,
      };
    }
    // 攻擊、受傷播完後：與待機／移動的邏輯狀態保持一致（自然銜接）
    if (this.logic === "idle" || this.logic === "move") {
      const c = this.player.current;
      if ((c === "idle" || c === "move") && this.player.pending !== this.logic) this.player.request(this.logic);
    }
    const pose = this.player.update(dt).pose;
    const cur = this.player.current;
    const t = this.player.time;

    // 朝向：平滑轉向邏輯朝向（受傷、死亡時不轉身；攻擊時仍朝向目標）
    if (cur !== "hurt" && cur !== "death" && cur !== "dead") {
      let d = this.targetYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 7);
    }

    // 彈跳位移同步（實驗）：著地期間不前進、空中補上；不在移動時很快對齊
    if (this.hopSync) {
      const air = cur === "move" ? hopAir((t / HOP_PERIOD) % 1) : 0;
      const rate = cur === "move" ? air * 20 : 12;
      const k = 1 - Math.exp(-rate * dt);
      this.owedX -= this.owedX * k;
      this.owedZ -= this.owedZ * k;
      const lag = Math.hypot(this.owedX, this.owedZ);
      if (lag > 0.6) {
        this.owedX *= 0.6 / lag;
        this.owedZ *= 0.6 / lag;
      }
    }

    // 表情（與已驗收的測試頁相同）
    const dying = cur === "death" || cur === "dead";
    const face: BoboExpr =
      cur === "attack" ? "angry" : cur === "hurt" && t < HURT_FACE_UNTIL ? "hurt" : dying ? (cur === "dead" || t >= DEATH_EYES_CLOSE_AT ? "sleepy" : "hurt") : "normal";
    const canBlink = cur === "idle" && this.respawnT === null;
    this.blinkClosed = canBlink && this.blink.update(dt);

    // 死亡：淡出、星星熄滅、星塵；重生：淡入
    let visibility = 1;
    let starBright = 1;
    let dustTime: number | null = null;
    if (dying) {
      const fx = deathFx(cur === "dead" ? 99 : t);
      visibility = fx.visibility;
      starBright = fx.starBright;
      if (fx.dust) dustTime = t;
    }
    if (this.respawnT !== null) {
      this.respawnT += dt;
      visibility *= smooth01(this.respawnT / RESPAWN_FADE);
      if (this.respawnT >= RESPAWN_FADE) this.respawnT = null;
    }
    return {
      hidden: false,
      pose,
      anim: cur,
      animTime: t,
      face,
      blinkClosed: this.blinkClosed,
      visibility,
      starBright,
      dustTime,
      yaw: this.yaw,
      offsetX: -this.owedX,
      offsetZ: -this.owedZ,
    };
  }
}
