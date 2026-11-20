import type { MonsterAction, MonsterAnimTimings, MonsterState } from "./types.ts";

export interface RequestResult {
  accepted: boolean;
  /** 被接受但以疊加方式播放（例如攻擊中受擊：只閃白不打斷攻擊） */
  overlay?: boolean;
  /** 被接受但排隊，等目前動作結束後才生效 */
  queued?: boolean;
  /** 受擊中再受擊、仍在 hitRehitLock 內：接受（呼叫端照常扣血）但不重播受擊動畫 */
  locked?: boolean;
  reason?: string;
}

/**
 * 怪物動畫狀態機（純邏輯）。
 *
 * 規則：
 * - idle / move 是「基礎移動狀態」，可隨時切換；播放一次性動作時會排隊，動作結束後回到最新的基礎狀態。
 * - attack：只能從 idle / move 發動；攻擊中不能再攻擊、不能被移動打斷。
 * - hit：idle / move 中會進入受擊；攻擊中只做疊加閃白，不打斷攻擊；受擊中再受擊會重新計時。
 * - death：最高優先，可打斷 idle / move / attack / hit；死亡後進入 dead，只接受 respawn。
 * - respawn：只能從 dead 發動，播放中不可被任何動作打斷，結束後回到 idle。
 *
 * 每種怪物可選的規則（timings 選填欄位；省略 = 上述原本行為）：
 * - hitInterruptsAttack：攻擊中受擊改為打斷攻擊、進入受擊
 * - hitRehitLock：受擊開始後 N 秒內再受擊不重播（locked），之後重新計時
 */
export class MonsterStateMachine {
  private _state: MonsterState = "idle";
  private _time = 0;
  private _locomotion: "idle" | "move" = "idle";
  private _hitOverlay = 0;
  private _entered = true;
  /** 這一次受擊狀態的長度（預設 = timings.hit；連續受擊抗性可指定較短的硬直） */
  private _hitDuration: number;
  private readonly timings: MonsterAnimTimings;

  constructor(timings: MonsterAnimTimings) {
    this.timings = timings;
    this._hitDuration = timings.hit;
  }

  get state(): MonsterState {
    return this._state;
  }
  get stateTime(): number {
    return this._time;
  }
  get locomotion(): "idle" | "move" {
    return this._locomotion;
  }
  /** 攻擊中受擊的疊加閃白剩餘時間 */
  get hitOverlay(): number {
    return this._hitOverlay;
  }
  get isDeadOrDying(): boolean {
    return this._state === "death" || this._state === "dead";
  }

  /** 是否剛進入新狀態（供動畫器判斷時間 0 的事件），讀取後清除 */
  consumeEntered(): boolean {
    const e = this._entered;
    this._entered = false;
    return e;
  }

  duration(state: MonsterState): number {
    switch (state) {
      case "attack":
        return this.timings.attack;
      case "hit":
        return this._hitDuration;
      case "death":
        return this.timings.death;
      case "respawn":
        return this.timings.respawn;
      default:
        return Infinity;
    }
  }

  /** 只檢查不執行（給 UI 判斷按鈕是否可用） */
  check(action: MonsterAction): RequestResult {
    const s = this._state;
    switch (action) {
      case "idle":
      case "move":
        if (s === "death" || s === "dead") return { accepted: false, reason: "死亡中無法移動" };
        if (s === "respawn") return { accepted: true, queued: true };
        if (s === "attack" || s === "hit") return { accepted: true, queued: true };
        return { accepted: true };
      case "attack":
        if (s === "idle" || s === "move") return { accepted: true };
        if (s === "attack") return { accepted: false, reason: "攻擊動作進行中" };
        if (s === "hit") return { accepted: false, reason: "受擊硬直中" };
        if (s === "respawn") return { accepted: false, reason: "重生中" };
        return { accepted: false, reason: "死亡中無法攻擊" };
      case "hit": {
        const lock = this.timings.hitRehitLock ?? 0;
        if (s === "hit" && lock > 0 && this._time < lock) return { accepted: true, locked: true };
        if (s === "idle" || s === "move" || s === "hit") return { accepted: true };
        if (s === "attack") return this.timings.hitInterruptsAttack ? { accepted: true } : { accepted: true, overlay: true };
        if (s === "respawn") return { accepted: false, reason: "重生中無敵" };
        return { accepted: false, reason: "已死亡" };
      }
      case "death":
        if (s === "death" || s === "dead") return { accepted: false, reason: "已死亡" };
        if (s === "respawn") return { accepted: false, reason: "重生中無敵" };
        return { accepted: true };
      case "respawn":
        if (s === "dead") return { accepted: true };
        if (s === "death") return { accepted: false, reason: "死亡動畫尚未結束" };
        return { accepted: false, reason: "存活中不需重生" };
    }
  }

  /**
   * @param hit 受擊選項（只對 "hit" 有效；省略 = 原本行為）：
   *   - duration：這次硬直秒數（進入受擊狀態，長度用這個值）
   *   - noStagger：不硬直（不進入受擊狀態、不打斷攻擊），只做疊加閃白 flash 秒
   */
  request(action: MonsterAction, hit?: { duration?: number; noStagger?: boolean; flash?: number }): RequestResult {
    const r = this.check(action);
    if (!r.accepted) return r;

    switch (action) {
      case "idle":
      case "move":
        this._locomotion = action;
        if (this._state === "idle" || this._state === "move") {
          if (this._state !== action) this.enter(action);
        }
        break;
      case "attack":
        this.enter("attack");
        break;
      case "hit":
        if (r.locked) break;
        if (hit?.noStagger) {
          // 不硬直：維持目前狀態（含攻擊中），只做閃白
          this._hitOverlay = Math.max(this._hitOverlay, hit.flash ?? this.timings.hit);
          return { ...r, overlay: true };
        }
        if (r.overlay) this._hitOverlay = this.timings.hit;
        else {
          this._hitDuration = hit?.duration ?? this.timings.hit;
          this.enter("hit");
        }
        break;
      case "death":
        this._hitOverlay = 0;
        this.enter("death");
        break;
      case "respawn":
        this._locomotion = "idle";
        this.enter("respawn");
        break;
    }
    return r;
  }

  /** 測試用（?debug=1 的「重設測試」）：不論目前狀態，直接回到待機。一般遊戲流程不會呼叫 */
  resetToIdle(): void {
    this._locomotion = "idle";
    this._hitDuration = this.timings.hit;
    this._hitOverlay = 0;
    this.enter("idle");
  }

  /** 推進時間；回傳本次發生的狀態轉換 */
  update(dt: number): MonsterState[] {
    const entered: MonsterState[] = [];
    this._time += dt;
    this._hitOverlay = Math.max(0, this._hitOverlay - dt);

    // 一次性動作播完 → 轉換（迴圈處理極大 dt）
    for (let guard = 0; guard < 4; guard++) {
      const d = this.duration(this._state);
      if (this._time < d) break;
      const leftover = this._time - d;
      const next: MonsterState = this._state === "death" ? "dead" : this._locomotion;
      this.enter(next);
      this._time = next === "dead" ? 0 : leftover;
      entered.push(next);
    }
    return entered;
  }

  private enter(state: MonsterState): void {
    this._state = state;
    this._time = 0;
    this._entered = true;
  }
}
