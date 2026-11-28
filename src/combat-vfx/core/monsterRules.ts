/**
 * 正式遊戲規則（Stage 2 指定，展示頁與 Claude A 的整合共用同一份）：
 * - Lv1～4 怪物被動反擊：玩家靠近不會攻擊；被打之後才反擊，脫離戰鬥後回到被動
 * - Lv5 以上怪物主動攻擊：玩家進入警戒範圍就追擊、攻擊
 * - Lv1～10 怪物全部無屬性
 * - 多人模式由伺服器決定正式傷害結果（用戶端只播放動作與特效，見 damage.ts 的 CombatResolver）
 */
export type MonsterBehaviour = "passive" | "aggressive";
export type MonsterElement = "neutral";

export function behaviourForLevel(level: number): MonsterBehaviour {
  return level <= 4 ? "passive" : "aggressive";
}

export function elementForLevel(level: number): MonsterElement | null {
  return level >= 1 && level <= 10 ? "neutral" : null;
}

export interface AggroState {
  /** 被動怪被打之後的仇恨剩餘秒數 */
  angry: number;
}

/** 怪物這一格要不要以玩家為目標 */
export function wantsTarget(level: number, distToPlayer: number, aggro: AggroState, alertRadius: number): boolean {
  if (behaviourForLevel(level) === "aggressive") return distToPlayer <= alertRadius;
  return aggro.angry > 0;
}

/** 被動怪被攻擊：仇恨 8 秒（每次被打重新計時） */
export function onDamaged(aggro: AggroState, seconds = 8): void {
  aggro.angry = seconds;
}
