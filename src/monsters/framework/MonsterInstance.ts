import { MonsterStateMachine, type RequestResult } from "../anim/MonsterStateMachine.ts";
import type { MonsterAnimTimings, MonsterState } from "../anim/types.ts";
import type { MonsterDefinition, Vec3 } from "./types.ts";

export interface DamageResult {
  applied: boolean;
  killed: boolean;
  /** 攻擊中受擊：只疊加閃白，不中斷攻擊 */
  overlay?: boolean;
  /** 受擊中再受擊（hitRehitLock 內）：已扣血，但不重播受擊動畫 */
  rehitLocked?: boolean;
  /** 這次受擊打斷了尚未命中的攻擊 → 該次攻擊取消、不結算 */
  cancelledAttackId?: number;
  reason?: string;
}

/** 攻擊紀錄（測試與預覽頁顯示用） */
export interface AttackLog {
  /** 已發動的攻擊數（最後一個 attackId） */
  started: number;
  /** 已結算命中的攻擊數 */
  resolved: number;
  /** 命中前被打斷而取消的攻擊數 */
  cancelled: number;
  /** 同一個 attackId 重複要求結算而被擋下的次數 */
  duplicatesBlocked: number;
  lastResolvedId: number | null;
  lastCancelledId: number | null;
}

export interface AttackResult {
  accepted: boolean;
  reason?: string;
}

/**
 * 地圖上實際存在的一隻怪物（MonsterInstance）。
 * 擁有：血量、位置、出生點、目標、攻擊冷卻，以及這隻怪物自己的狀態機。
 * 不依賴 Babylon；AI 與戰鬥系統只透過這個類別改變怪物狀態。
 */
export class MonsterInstance {
  readonly instanceId: string;
  readonly definition: MonsterDefinition;
  readonly sm: MonsterStateMachine;
  currentHp: number;
  readonly currentPosition: Vec3;
  readonly spawnPosition: Readonly<Vec3>;
  /** 朝向（弧度，Babylon 慣例：0 = 面向 +z） */
  yaw = 0;
  currentTarget: string | null = null;
  /** 最後一次成功發動攻擊的時間（秒），尚未攻擊為 -Infinity。冷卻從「攻擊開始」起算（既有語意） */
  lastAttackTime = Number.NEGATIVE_INFINITY;
  /** 目前（或最後一次）攻擊的 attackId；每次成功發動攻擊遞增，從 1 開始；0 = 尚未攻擊 */
  attackId = 0;
  /** 目前這次攻擊是否已結算（命中判定只做一次） */
  private attackSettled = true;
  readonly attackLog: AttackLog = { started: 0, resolved: 0, cancelled: 0, duplicatesBlocked: 0, lastResolvedId: null, lastCancelledId: null };

  constructor(instanceId: string, definition: MonsterDefinition, timings: MonsterAnimTimings, spawn: Vec3) {
    this.instanceId = instanceId;
    this.definition = definition;
    this.sm = new MonsterStateMachine(timings);
    this.currentHp = definition.maxHp;
    this.spawnPosition = Object.freeze({ ...spawn });
    this.currentPosition = { ...spawn };
  }

  get definitionId(): string {
    return this.definition.monsterId;
  }

  get currentState(): MonsterState {
    return this.sm.state;
  }

  /** 存活且可行動（不在死亡、已死亡、重生中） */
  get isAlive(): boolean {
    const s = this.sm.state;
    return s !== "death" && s !== "dead" && s !== "respawn";
  }

  /** 攻擊冷卻剩餘秒數 */
  cooldownRemaining(now: number): number {
    return Math.max(0, this.definition.attackCooldown - (now - this.lastAttackTime));
  }

  canAttack(now: number): AttackResult {
    if (!this.isAlive) return { accepted: false, reason: "死亡或重生中" };
    if (this.cooldownRemaining(now) > 0) return { accepted: false, reason: "攻擊冷卻中" };
    const r = this.sm.check("attack");
    return r.accepted ? { accepted: true } : { accepted: false, reason: r.reason };
  }

  tryAttack(now: number): AttackResult {
    const c = this.canAttack(now);
    if (!c.accepted) return c;
    const r = this.sm.request("attack");
    if (!r.accepted) return { accepted: false, reason: r.reason };
    this.lastAttackTime = now;
    this.attackId++;
    this.attackSettled = false;
    this.attackLog.started = this.attackId;
    return { accepted: true };
  }

  /**
   * 攻擊命中時間點（動畫器的 attackImpact 事件）呼叫：回傳這次攻擊的 attackId，表示可以結算傷害；
   * 回傳 null 表示不結算（已結算過、已被打斷取消、不在攻擊中、已死亡）。同一個 attackId 只會回傳一次。
   */
  claimAttackImpact(): number | null {
    if (this.sm.state !== "attack" || this.attackId === 0) return null;
    if (this.attackSettled) {
      this.attackLog.duplicatesBlocked++;
      return null;
    }
    this.attackSettled = true;
    this.attackLog.resolved++;
    this.attackLog.lastResolvedId = this.attackId;
    return this.attackId;
  }

  /** 攻擊在命中前離開攻擊狀態（受擊打斷、死亡）→ 取消，之後不會結算 */
  private cancelPendingAttack(wasAttacking: boolean): number | undefined {
    if (!wasAttacking || this.attackSettled || this.sm.state === "attack") return undefined;
    this.attackSettled = true;
    this.attackLog.cancelled++;
    this.attackLog.lastCancelledId = this.attackId;
    return this.attackId;
  }

  /** 移動/停下（死亡中會被狀態機拒絕） */
  setLocomotion(moving: boolean): RequestResult {
    return this.sm.request(moving ? "move" : "idle");
  }

  /**
   * 承受傷害（amount 為已計算好的最終傷害；傷害公式屬於 W2 戰鬥系統）。
   * 死亡、重生中不受傷害；攻擊中受擊不中斷攻擊；血量歸零進入死亡。
   */
  receiveDamage(amount: number): DamageResult {
    if (!this.isAlive) return { applied: false, killed: false, reason: "死亡或重生中不受傷害" };
    const dmg = Math.max(0, Math.floor(amount));
    const wasAttacking = this.sm.state === "attack";
    this.currentHp = Math.max(0, this.currentHp - dmg);
    if (this.currentHp <= 0) {
      // 死亡優先：直接進入死亡（不經過受擊），未命中的攻擊一併取消
      this.sm.request("death");
      this.currentTarget = null;
      const cancelled = this.cancelPendingAttack(wasAttacking);
      return { applied: true, killed: true, ...(cancelled !== undefined ? { cancelledAttackId: cancelled } : {}) };
    }
    const r = this.sm.request("hit");
    const cancelled = this.cancelPendingAttack(wasAttacking);
    return {
      applied: true,
      killed: false,
      overlay: r.overlay === true,
      ...(r.locked ? { rehitLocked: true } : {}),
      ...(cancelled !== undefined ? { cancelledAttackId: cancelled } : {}),
    };
  }

  /**
   * 測試用（?debug=1 的「重設測試」）：不論目前狀態，立即回到出生點、血量全滿、待機、冷卻與攻擊紀錄歸零。
   * 一般遊戲流程不會呼叫；數值不變。
   */
  resetForTest(): void {
    this.sm.resetToIdle();
    this.currentHp = this.definition.maxHp;
    this.currentPosition.x = this.spawnPosition.x;
    this.currentPosition.y = this.spawnPosition.y;
    this.currentPosition.z = this.spawnPosition.z;
    this.currentTarget = null;
    this.lastAttackTime = Number.NEGATIVE_INFINITY;
    this.attackId = 0;
    this.attackSettled = true;
    Object.assign(this.attackLog, { started: 0, resolved: 0, cancelled: 0, duplicatesBlocked: 0, lastResolvedId: null, lastCancelledId: null });
  }

  /** 重生：回到出生點、血量全滿（只能在死亡動畫播完後） */
  respawn(): RequestResult {
    const r = this.sm.request("respawn");
    if (!r.accepted) return r;
    this.currentHp = this.definition.maxHp;
    this.currentPosition.x = this.spawnPosition.x;
    this.currentPosition.y = this.spawnPosition.y;
    this.currentPosition.z = this.spawnPosition.z;
    this.currentTarget = null;
    this.lastAttackTime = Number.NEGATIVE_INFINITY;
    this.attackSettled = true;
    return r;
  }
}
