/**
 * 地上的掉落物（純邏輯）：怪物死亡時在原地散開，玩家走近自動撿起，放太久會消失。
 */
import type { ItemId } from "../pets/petSystem.ts";

export interface LootDrop {
  id: number;
  item: ItemId;
  x: number;
  z: number;
  born: number;
}

export class FieldLoot {
  readonly drops: LootDrop[] = [];
  private seq = 0;
  private readonly radius: number;
  private readonly lifetime: number;

  constructor(pickupRadius: number, lifetime: number) {
    this.radius = pickupRadius;
    this.lifetime = lifetime;
  }

  /** 在 (x, z) 附近散開放置（每個物品在半徑 0.55 m 的圓上平均分布） */
  spawn(items: readonly ItemId[], x: number, z: number, now: number): LootDrop[] {
    const out = items.map((item, i) => {
      const a = (i / Math.max(1, items.length)) * Math.PI * 2 + 0.7;
      const r = items.length > 1 ? 0.55 : 0;
      return { id: ++this.seq, item, x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, born: now };
    });
    this.drops.push(...out);
    return out;
  }

  /** 每幀：回傳本幀撿到的與消失的掉落物 */
  update(now: number, px: number, pz: number): { picked: LootDrop[]; expired: LootDrop[] } {
    const picked: LootDrop[] = [];
    const expired: LootDrop[] = [];
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      if (Math.hypot(d.x - px, d.z - pz) <= this.radius) picked.push(d);
      else if (now - d.born >= this.lifetime) expired.push(d);
      else continue;
      this.drops.splice(i, 1);
    }
    return { picked, expired };
  }
}
