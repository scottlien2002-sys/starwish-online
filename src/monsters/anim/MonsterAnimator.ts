import { MonsterStateMachine, type RequestResult } from "./MonsterStateMachine.ts";
import type { EffectCue, MonsterAction, MonsterAnimTimings, MonsterEffect, MonsterPose, MonsterState, MonsterView } from "./types.ts";

export interface AnimProfile {
  timings: MonsterAnimTimings;
  cues: readonly EffectCue[];
  idle(t: number): MonsterPose;
  move(t: number): MonsterPose;
  attack(t: number): MonsterPose;
  hit(t: number): MonsterPose;
  death(t: number): MonsterPose;
  dead(): MonsterPose;
  respawn(t: number): MonsterPose;
  hitOverlay(p: MonsterPose, remaining: number): MonsterPose;
}

export interface AnimFrame {
  pose: MonsterPose;
  effects: MonsterEffect[];
  state: MonsterState;
  /** 本幀進入的狀態（依發生順序；含由 request 立即切換的狀態） */
  entered: MonsterState[];
  /** 本幀「正常播完」的一次性動作（被打斷的不算），即動畫完成事件 */
  completed: MonsterState[];
}

/**
 * 動畫控制器：狀態機 + 動作曲線 + 特效時間軸。
 * 不依賴 Babylon；可接上任何 MonsterView（程式化模型或未來的 GLB 模型）。
 */
export class MonsterAnimator {
  readonly sm: MonsterStateMachine;
  private readonly profile: AnimProfile;
  private readonly view: MonsterView | null;
  /** 基礎動作的連續時間，讓呼吸/彈跳在切換時不跳格 */
  private loopTime = 0;

  /**
   * @param sm 可注入外部狀態機（通用怪物框架中由 MonsterInstance 擁有），省略時自行建立
   */
  constructor(profile: AnimProfile, view: MonsterView | null = null, sm?: MonsterStateMachine) {
    this.profile = profile;
    this.view = view;
    this.sm = sm ?? new MonsterStateMachine(profile.timings);
  }

  request(action: MonsterAction): RequestResult {
    return this.sm.request(action);
  }

  check(action: MonsterAction): RequestResult {
    return this.sm.check(action);
  }

  update(dt: number): AnimFrame {
    const effects: MonsterEffect[] = [];
    const entered: MonsterState[] = [];
    const completed: MonsterState[] = [];
    const s0 = this.sm.state;
    const enteredByRequest = this.sm.consumeEntered();
    if (enteredByRequest) entered.push(s0);
    const t0 = enteredByRequest ? -1 : this.sm.stateTime;

    const transitions = this.sm.update(dt);
    if (transitions.length === 0) {
      this.collect(s0, t0, this.sm.stateTime, effects);
    } else {
      this.collect(s0, t0, Infinity, effects);
      this.collect(this.sm.state, -1, this.sm.stateTime, effects);
      this.sm.consumeEntered();
      completed.push(s0, ...transitions.slice(0, -1));
      entered.push(...transitions);
    }

    this.loopTime += dt;
    const pose = this.sample();
    if (this.view) {
      for (const e of effects) this.view.playEffect(e);
      this.view.applyPose(pose);
      this.view.update(dt);
    }
    return { pose, effects, state: this.sm.state, entered, completed };
  }

  private sample(): MonsterPose {
    const p = this.profile;
    const t = this.sm.stateTime;
    switch (this.sm.state) {
      case "idle":
        return p.idle(this.loopTime);
      case "move":
        return p.move(this.loopTime);
      case "attack":
        return p.hitOverlay(p.attack(t), this.sm.hitOverlay);
      case "hit":
        return p.hit(t);
      case "death":
        return p.death(t);
      case "dead":
        return p.dead();
      case "respawn":
        return p.respawn(t);
    }
  }

  private collect(state: MonsterState, from: number, to: number, out: MonsterEffect[]): void {
    for (const c of this.profile.cues) {
      if (c.state === state && c.at > from && c.at <= to) out.push(c.effect);
    }
  }
}
