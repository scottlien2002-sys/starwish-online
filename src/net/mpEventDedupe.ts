/**
 * Stage 8.5（Claude D）：多人戰鬥事件去重。
 * 伺服器每個事件只送一次；這裡是用戶端的第二道保護，避免同一個施放、同一下命中、同一件掉落
 * 因重送、重連或程式錯誤被畫兩次（重複的傷害數字、特效、音效）。扣血永遠只由伺服器決定，用戶端不扣血。
 *
 * 伺服器每個戰鬥事件都帶房間內遞增序號 q → 用 q 去重（怪物攻擊、死亡等也能去重）。
 * 沒有 q 的舊伺服器：有唯一識別的事件才去重：cast／end（施放編號 c）、hit（c＋命中段 h＋目標 t）。
 * 掉落（loot／lgone）不在這裡去重：伺服器在重新同步（重連）時會刻意重送地上所有掉落物，畫面端以 UUID 判斷是否已存在。
 * 其他事件（怪物攻擊、死亡、經驗、倒地）沒有唯一識別碼，原樣通過。
 */
export interface DedupeEvent {
  k: string;
  /** 伺服器事件序號（Stage 8.5 起每個戰鬥事件都有；有就用它去重） */
  q?: number;
  c?: number;
  h?: string;
  t?: number;
  u?: string;
}

export function eventKey(e: DedupeEvent): string | null {
  if (e.q !== undefined) return `q:${e.q}`;
  switch (e.k) {
    case "cast":
    case "end":
      return `${e.k}:${e.c}`;
    case "hit":
      return `hit:${e.c}|${e.h}|${e.t}`;
    default:
      return null;
  }
}

export class CombatEventDedupe {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];
  duplicates = 0;
  private readonly cap: number;
  constructor(cap = 4096) {
    this.cap = cap;
  }

  /** true＝第一次看到，應該處理；false＝重複，忽略 */
  accept(e: DedupeEvent): boolean {
    const k = eventKey(e);
    if (k === null) return true;
    if (this.seen.has(k)) {
      this.duplicates++;
      return false;
    }
    this.seen.add(k);
    this.order.push(k);
    if (this.order.length > this.cap) this.seen.delete(this.order.shift()!);
    return true;
  }

  /** 換地圖或重新連線時清除（伺服器重啟後序號、施放編號會從頭開始） */
  reset(): void {
    this.seen.clear();
    this.order.length = 0;
  }
}
