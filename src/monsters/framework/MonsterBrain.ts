import { createRng, type Rng } from "../../core/rng.ts";
import type { MonsterInstance } from "./MonsterInstance.ts";
import { isAggressive, type BrainMode, type MonsterTarget } from "./types.ts";

export interface BrainOptions {
  seed?: number;
  /** 待機停留秒數範圍 */
  idleMin?: number;
  idleMax?: number;
  /** 抵達判定距離（公尺） */
  arriveDistance?: number;
}

/**
 * 怪物 AI（MonsterBrain）。只操作 MonsterInstance（位置、朝向、移動/攻擊請求），
 * 不接觸模型、材質、動畫或粒子特效。
 *
 * 行為：
 *   idle ⇄ patrol（出生區域內巡邏）
 *   → chase（目標進入警戒範圍）→ attack（進入攻擊範圍，依冷卻攻擊）
 *   → return（目標離開或被拉出 leashRange，回出生點）
 *   → dead（死亡後停止行動）→ respawn（死亡動畫播完後 respawnTime 秒重生）
 */
export class MonsterBrain {
  readonly instance: MonsterInstance;
  private _mode: BrainMode = "idle";
  private idleTimer: number;
  private patrolPoint: { x: number; z: number } | null = null;
  private deadSince: number | null = null;
  private readonly rng: Rng;
  private readonly idleMin: number;
  private readonly idleMax: number;
  private readonly arrive: number;

  constructor(instance: MonsterInstance, options: BrainOptions = {}) {
    this.instance = instance;
    this.rng = createRng(options.seed ?? 1);
    this.idleMin = options.idleMin ?? 1.5;
    this.idleMax = options.idleMax ?? 3.5;
    this.arrive = options.arriveDistance ?? 0.3;
    this.idleTimer = this.rng.range(this.idleMin, this.idleMax);
  }

  get mode(): BrainMode {
    return this._mode;
  }

  /**
   * 距離重生還有幾秒（只讀，不影響計時）：
   * - 死亡動畫中：剩餘死亡時間＋重生等待
   * - 已死亡（移除）：重生等待剩餘
   * - 其他狀態：null
   */
  respawnRemaining(now: number): number | null {
    const m = this.instance;
    const st = m.sm.state;
    const wait = m.definition.respawnTime;
    if (st === "death") return Math.max(0, m.sm.duration("death") - m.sm.stateTime) + wait;
    if (st === "dead") return this.deadSince === null ? wait : Math.max(0, wait - (now - this.deadSince));
    return null;
  }

  /** 測試用（?debug=1 的「重設測試」）：回到待機、清除死亡計時與巡邏目標 */
  resetForTest(): void {
    this._mode = "idle";
    this.deadSince = null;
    this.patrolPoint = null;
    this.idleTimer = this.rng.range(this.idleMin, this.idleMax);
  }

  get leashRange(): number {
    const d = this.instance.definition;
    return d.leashRange ?? d.aggroRange * 2.5;
  }

  update(dt: number, now: number, target: MonsterTarget | null): void {
    const m = this.instance;
    const def = m.definition;
    const state = m.sm.state;

    // ---- 死亡 / 重生：停止一切行動 ----
    if (state === "death" || state === "dead") {
      this._mode = "dead";
      this.patrolPoint = null;
      if (state === "dead") {
        if (this.deadSince === null) this.deadSince = now;
        if (now - this.deadSince >= def.respawnTime) {
          m.respawn();
          this.deadSince = null;
          this._mode = "respawn";
        }
      }
      return;
    }
    this.deadSince = null;
    if (state === "respawn") {
      this._mode = "respawn";
      return;
    }
    if (this._mode === "dead" || this._mode === "respawn") {
      this._mode = "idle";
      this.idleTimer = this.rng.range(this.idleMin, this.idleMax);
    }

    // 攻擊、受擊動作播放中不移動
    const busy = state === "attack" || state === "hit";
    const pos = m.currentPosition;
    const fromSpawn = Math.hypot(pos.x - m.spawnPosition.x, pos.z - m.spawnPosition.z);
    // 被動怪物（Lv.1～4）：沒被打過就當作沒看到玩家
    const hasTarget = target !== null && target.alive && (isAggressive(def) || m.provoked);
    const distToTarget = hasTarget ? Math.hypot(target.x - pos.x, target.z - pos.z) : Infinity;

    // ---- 決定模式 ----
    if (this._mode === "return") {
      if (fromSpawn <= this.arrive) {
        // 脫戰回到出生點：被動怪物恢復被動
        m.provoked = false;
        this._mode = "idle";
        this.idleTimer = this.rng.range(this.idleMin, this.idleMax);
      }
    } else if (hasTarget && fromSpawn > this.leashRange) {
      this._mode = "return";
    } else if (hasTarget && (distToTarget <= def.aggroRange || ((this._mode === "chase" || this._mode === "attack") && distToTarget <= def.aggroRange * 1.5))) {
      this._mode = distToTarget <= def.attackRange ? "attack" : "chase";
    } else if (this._mode === "chase" || this._mode === "attack") {
      this._mode = "return";
    }
    m.currentTarget = this._mode === "chase" || this._mode === "attack" ? (target?.id ?? null) : null;

    // ---- 執行 ----
    switch (this._mode) {
      case "attack": {
        if (!busy) m.setLocomotion(false);
        this.face(target!.x - pos.x, target!.z - pos.z);
        m.tryAttack(now);
        break;
      }
      case "chase":
        this.moveToward(target!.x, target!.z, dt, busy, def.attackRange * 0.9, def.chaseSpeed ?? def.moveSpeed);
        break;
      case "return":
        this.moveToward(m.spawnPosition.x, m.spawnPosition.z, dt, busy, 0, def.chaseSpeed ?? def.moveSpeed);
        break;
      case "patrol": {
        const p = this.patrolPoint;
        if (!p || this.moveToward(p.x, p.z, dt, busy, 0, def.patrolSpeed ?? def.moveSpeed)) {
          this._mode = "idle";
          this.patrolPoint = null;
          this.idleTimer = this.rng.range(this.idleMin, this.idleMax);
          if (!busy) m.setLocomotion(false);
        }
        break;
      }
      case "idle": {
        if (!busy) m.setLocomotion(false);
        this.idleTimer -= dt;
        if (this.idleTimer <= 0) {
          const r = (def.patrolRadius ?? 3) * Math.sqrt(this.rng.next());
          const a = this.rng.range(0, Math.PI * 2);
          this.patrolPoint = { x: m.spawnPosition.x + Math.cos(a) * r, z: m.spawnPosition.z + Math.sin(a) * r };
          this._mode = "patrol";
        }
        break;
      }
    }
  }

  /** 朝目標移動；回傳 true 表示已抵達（停在 stopDistance 內） */
  private moveToward(tx: number, tz: number, dt: number, busy: boolean, stopDistance: number, speed: number = this.instance.definition.moveSpeed): boolean {
    const m = this.instance;
    const pos = m.currentPosition;
    const dx = tx - pos.x;
    const dz = tz - pos.z;
    const dist = Math.hypot(dx, dz);
    const reach = Math.max(stopDistance, this.arrive);
    if (dist <= reach) {
      if (!busy) m.setLocomotion(false);
      return true;
    }
    if (busy) return false;
    m.setLocomotion(true);
    if (m.sm.state !== "move") return false;
    const step = Math.min(dist - reach * 0.5, speed * Math.min(dt, 0.1));
    pos.x += (dx / dist) * step;
    pos.z += (dz / dist) * step;
    this.face(dx, dz);
    return false;
  }

  private face(dx: number, dz: number): void {
    if (Math.hypot(dx, dz) > 1e-4) this.instance.yaw = Math.atan2(dx, dz);
  }
}
