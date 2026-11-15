import { MonsterStateMachine, type RequestResult } from "../anim/MonsterStateMachine.ts";
import type { MonsterAnimTimings, MonsterState } from "../anim/types.ts";
import type { MonsterDefinition, Vec3 } from "./types.ts";

export interface DamageResult {
  applied: boolean;
  killed: boolean;
  /** 攻擊中受擊：只疊加閃白，不中斷攻擊 */
  overlay?: boolean;
  reason?: string;
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
  /** 最後一次成功發動攻擊的時間（秒），尚未攻擊為 -Infinity */
  lastAttackTime = Number.NEGATIVE_INFINITY;

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
    return { accepted: true };
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
    this.currentHp = Math.max(0, this.currentHp - dmg);
    if (this.currentHp <= 0) {
      this.sm.request("death");
      this.currentTarget = null;
      return { applied: true, killed: true };
    }
    const r = this.sm.request("hit");
    return { applied: true, killed: false, overlay: r.overlay === true };
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
    return r;
  }
}
