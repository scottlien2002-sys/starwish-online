import { MonsterAnimator, type AnimFrame } from "../anim/MonsterAnimator.ts";
import type { MonsterAction } from "../anim/types.ts";
import type { RequestResult } from "../anim/MonsterStateMachine.ts";
import type { MonsterBrain } from "./MonsterBrain.ts";
import type { MonsterInstance } from "./MonsterInstance.ts";
import type { IMonsterVisual, MonsterAnimationProfile, MonsterTarget } from "./types.ts";

/**
 * 把一隻怪物的四個部分接起來：
 *   AI（MonsterBrain）→ 實例（MonsterInstance，含狀態機）→ 動畫（MonsterAnimator）→ 視覺（IMonsterVisual）
 * 資料只往右流；AI 不碰視覺，視覺不改狀態。
 */
export class MonsterController {
  readonly instance: MonsterInstance;
  readonly profile: MonsterAnimationProfile;
  readonly animator: MonsterAnimator;
  readonly visual: IMonsterVisual | null;
  readonly brain: MonsterBrain | null;
  lastFrame: AnimFrame | null = null;

  constructor(instance: MonsterInstance, profile: MonsterAnimationProfile, visual: IMonsterVisual | null, brain: MonsterBrain | null) {
    this.instance = instance;
    this.profile = profile;
    this.visual = visual;
    this.brain = brain;
    // 動畫器共用實例的狀態機，不另外建立
    this.animator = new MonsterAnimator(profile.anim, null, instance.sm);
  }

  /** 手動控制（測試頁使用）。AI 啟用時請改用 AI。 */
  request(action: MonsterAction): RequestResult {
    return this.instance.sm.request(action);
  }

  /**
   * @param now 遊戲時間（秒），用於攻擊冷卻與重生計時
   * @param target AI 的目標（沒有目標或無 AI 時可省略）
   */
  update(dt: number, now: number, target: MonsterTarget | null = null): AnimFrame {
    this.brain?.update(dt, now, target);
    const frame = this.animator.update(dt);
    this.lastFrame = frame;
    const v = this.visual;
    if (v) {
      // 先更新位置，特效才會出現在本幀正確的位置
      const p = this.instance.currentPosition;
      v.setTransform(p.x, p.y, p.z, this.instance.yaw);
      for (const s of frame.entered) v.onStateEnter(s);
      for (const e of frame.effects) v.playEffect(e);
      v.applyPose(frame.pose);
      v.update(dt);
    }
    return frame;
  }

  dispose(): void {
    this.visual?.dispose();
  }
}
