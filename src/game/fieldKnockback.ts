/**
 * Stage 7.4：野外普通攻擊「輕微擊退」的連擊衰減（純邏輯，可單元測試）。
 *
 * Stage 7.3 每一下都把怪物往後推約 0.22 m；玩家連續普攻時，怪物（攻擊距離 1.1～1.5 m）
 * 可能一直被推出攻擊範圍、長時間無法反擊。規則改為：
 * - 怪物正在攻擊（出手中）：不擊退，這一下照常扣血，不會把怪物推離它的攻擊。
 * - 同一隻怪物連續受擊（距上一擊 < 2 秒）：第 1 下 100%、第 2 下 50%、第 3 下起 0。
 * - 2 秒沒有受擊：重新從第 1 下計算（與 Claude C 受擊反應 V2 的抗性節奏一致）。
 * 只影響畫面上的位移量；傷害、經驗、掉落、AI 判斷全部不變。
 */
export const KNOCKBACK_BASE = 0.12 + 0.14 * 0.75;
export const KNOCKBACK_CHAIN_RESET = 2.0;
const CHAIN_SCALE = [1, 0.5, 0] as const;

export class FieldKnockback {
  private readonly chain = new Map<string, { n: number; last: number }>();

  /** 回傳這一下的擊退距離（公尺） */
  distance(id: string, now: number, opts: { attacking: boolean; boss: boolean }): number {
    let c = this.chain.get(id);
    if (!c || now - c.last >= KNOCKBACK_CHAIN_RESET) {
      c = { n: 0, last: now };
      this.chain.set(id, c);
    }
    c.last = now;
    const idx = Math.min(c.n, CHAIN_SCALE.length - 1);
    c.n++;
    if (opts.attacking) return 0;
    return KNOCKBACK_BASE * CHAIN_SCALE[idx]! * (opts.boss ? 0.25 : 1);
  }

  /** 死亡／重生時清掉 */
  reset(id: string): void {
    this.chain.delete(id);
  }
}
