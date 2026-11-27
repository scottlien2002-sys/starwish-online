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
  /** 這一幀的地面速度（公尺/秒） */
  groundSpeed = 0;
  /** 測試頁手動移動怪物時指定地面速度（null = 依 AI 實際位移計算） */
  speedOverride: number | null = null;
  private seenHitSeq = 0;
  /**
   * Stage 7.4 距離分級：視覺（姿勢、動畫、血條）每幾幀更新一次。1＝每幀；N＝每 N 幀（期間的時間累計後一次補上）；0＝暫停（視野外）。
   * AI、狀態機、攻擊命中、死亡重生都在上面照常每幀計算；狀態切換、受擊、特效事件也每幀送給視覺 → 遊戲規則不受影響。
   */
  visualStride = 1;
  private strideCount = 0;
  private visAccum = 0;
  /** 測試用：實際呼叫視覺 update 的次數 */
  visualUpdates = 0;

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
    const p0x = this.instance.currentPosition.x;
    const p0z = this.instance.currentPosition.z;
    this.brain?.update(dt, now, target);
    const frame = this.animator.update(dt);
    // 實際地面速度（AI 每幀最多走 min(dt, 0.1) 秒的距離，所以用同樣的時間換算）
    const step = Math.min(dt, 0.1);
    this.groundSpeed = this.speedOverride ?? (step > 0 ? Math.hypot(this.instance.currentPosition.x - p0x, this.instance.currentPosition.z - p0z) / step : 0);
    this.lastFrame = frame;
    const v = this.visual;
    if (v) {
      // 先更新位置，特效才會出現在本幀正確的位置
      const p = this.instance.currentPosition;
      v.setTransform(p.x, p.y, p.z, this.instance.yaw);
      if (this.instance.hitReactionSeq !== this.seenHitSeq) {
        this.seenHitSeq = this.instance.hitReactionSeq;
        const r = this.instance.lastHitReaction;
        if (r) v.onHitReaction?.(r);
      }
      v.setGroundSpeed?.(this.groundSpeed);
      v.setHealth?.(this.instance.currentHp, this.instance.definition.maxHp);
      for (const s of frame.entered) v.onStateEnter(s);
      for (const e of frame.effects) v.playEffect(e);
      this.visAccum += dt;
      const stride = this.visualStride;
      // 狀態剛切換的那一幀一定更新（例如死亡、重生的第一格），之後再依間隔
      if (stride > 0 && (++this.strideCount >= stride || frame.entered.length > 0)) {
        this.strideCount = 0;
        v.applyPose(frame.pose);
        v.update(this.visAccum);
        this.visAccum = 0;
        this.visualUpdates++;
      }
    }
    return frame;
  }

  dispose(): void {
    this.visual?.dispose();
  }
}
