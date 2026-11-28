/**
 * 世界場景共用：碰撞物空間格（純邏輯；畫面、怪物 AI、之後的伺服器都可共用）。
 * 碰撞物多（數百個）時，每次推開只檢查附近幾格的碰撞物；回傳的索引維持原本順序，
 * 所以推開結果與逐一檢查全部碰撞物相同（測試驗證）。
 */
export interface GridItem {
  x: number;
  z: number;
  /** 外接圓半徑 */
  bound: number;
}

export class ColliderGrid {
  private readonly cell: number;
  private readonly buckets = new Map<number, number[]>();
  private readonly stamp: Uint32Array;
  private tick = 0;
  readonly size: number;

  constructor(items: readonly GridItem[], cell = 8) {
    this.cell = cell;
    this.size = items.length;
    this.stamp = new Uint32Array(items.length);
    items.forEach((it, i) => {
      const i0 = Math.floor((it.x - it.bound) / cell);
      const i1 = Math.floor((it.x + it.bound) / cell);
      const j0 = Math.floor((it.z - it.bound) / cell);
      const j1 = Math.floor((it.z + it.bound) / cell);
      for (let j = j0; j <= j1; j++) {
        for (let k = i0; k <= i1; k++) {
          const key = ColliderGrid.key(k, j);
          let b = this.buckets.get(key);
          if (!b) {
            b = [];
            this.buckets.set(key, b);
          }
          b.push(i);
        }
      }
    });
  }

  private static key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }

  /** 範圍 (x,z)±r 內可能碰到的碰撞物索引（遞增排序） */
  query(x: number, z: number, r: number, out: number[] = []): number[] {
    out.length = 0;
    this.tick = (this.tick + 1) >>> 0 || 1;
    const c = this.cell;
    const i0 = Math.floor((x - r) / c);
    const i1 = Math.floor((x + r) / c);
    const j0 = Math.floor((z - r) / c);
    const j1 = Math.floor((z + r) / c);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const b = this.buckets.get(ColliderGrid.key(i, j));
        if (!b) continue;
        for (const idx of b) {
          if (this.stamp[idx] === this.tick) continue;
          this.stamp[idx] = this.tick;
          out.push(idx);
        }
      }
    }
    out.sort((a, b) => a - b);
    return out;
  }
}
