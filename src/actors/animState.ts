/**
 * 角色動畫狀態切換（純邏輯，不含 Babylon）。
 * 狀態：Idle、Run（循環）；Jump、Attack、Hurt（播一次，結束後回到 Run 或 Idle）。
 * 優先順序：Death > Hurt > Attack = Jump > Run／Idle。Hurt 可以打斷任何動作；Attack、Jump 進行中不會被彼此打斷。
 * Death（Stage 7）：播一次、停在最後一格；之後只接受 revive（回到 Idle）。
 */
export type AnimName = "Idle" | "Run" | "Jump" | "Attack" | "Hurt" | "Death";
export const ANIM_NAMES: readonly AnimName[] = Object.freeze(["Idle", "Run", "Jump", "Attack", "Hurt", "Death"]);
export const ONE_SHOT: Readonly<Record<AnimName, boolean>> = Object.freeze({ Idle: false, Run: false, Jump: true, Attack: true, Hurt: true, Death: true });

export interface AnimInput {
  moving: boolean;
  jump?: boolean;
  attack?: boolean;
  hurt?: boolean;
  die?: boolean;
  revive?: boolean;
}

export class AnimStateMachine {
  state: AnimName = "Idle";
  /** 目前動作已播放的秒數 */
  time = 0;
  private readonly durations: Record<AnimName, number>;

  constructor(durations: Partial<Record<AnimName, number>> = {}) {
    this.durations = { Idle: 2.4, Run: 0.6, Jump: 1, Attack: 0.5, Hurt: 0.5, Death: 1.6, ...durations };
  }

  /** 攻速改變時調整攻擊動作長度 */
  setDuration(name: AnimName, seconds: number): void {
    this.durations[name] = seconds;
  }

  duration(name: AnimName): number {
    return this.durations[name];
  }

  /** 每格呼叫；回傳狀態是否改變 */
  update(dt: number, input: AnimInput): boolean {
    const before = this.state;
    this.time += dt;
    if (this.state === "Death") {
      // 死亡：停在最後一格，只有復活能離開
      if (input.revive) this.enter("Idle");
      return this.state !== before;
    }
    if (input.die) {
      this.enter("Death");
      return true;
    }
    const busy = ONE_SHOT[this.state] && this.time < this.durations[this.state];
    if (input.hurt) this.enter("Hurt");
    else if (!busy || this.state === "Run" || this.state === "Idle") {
      if (input.attack) this.enter("Attack");
      else if (input.jump) this.enter("Jump");
      else if (!busy) this.enter(input.moving ? "Run" : "Idle");
    }
    return this.state !== before;
  }

  private enter(next: AnimName): void {
    if (next === this.state && !ONE_SHOT[next]) return; // 循環動作不重新開始
    this.state = next;
    this.time = 0;
  }

  /** 跳躍的高度（公尺）：動作 0.25～0.75 之間離地，拋物線，最高 height */
  jumpHeight(height = 0.35): number {
    if (this.state !== "Jump") return 0;
    const u = (this.time / this.durations.Jump - 0.25) / 0.5;
    if (u <= 0 || u >= 1) return 0;
    return 4 * height * u * (1 - u);
  }
}
