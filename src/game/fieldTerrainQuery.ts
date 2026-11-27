/**
 * Stage 7.3：星芽原野的 TerrainQuery（Claude C Combat VFX core/terrain.ts 的介面）。
 * 技能根運動、突進、跳躍落點、擊退都用同一個可行走判定：地形 walkable（溪流、地圖邊界、陡坡）＋碰撞物（樹、岩石、建築）。
 * 跳躍也不能越過障礙物：沿路徑每 5 cm 檢查，第一個不能站的點之前就停下。
 * 不依賴 Babylon → 伺服器（Claude D）可以用同一份判定。
 */
import type { TerrainQuery, Vec2 } from "../combat-vfx/core/terrain.ts";

export interface FieldWalk {
  walkable(x: number, z: number): boolean;
}
export interface CircleCollider {
  x: number;
  z: number;
  r: number;
}

export class FieldTerrainQuery implements TerrainQuery {
  private readonly terrain: FieldWalk;
  private readonly colliders: readonly CircleCollider[];
  private readonly step: number;

  constructor(terrain: FieldWalk, colliders: readonly CircleCollider[], step = 0.05) {
    this.terrain = terrain;
    this.colliders = colliders;
    this.step = step;
  }

  canStand(x: number, z: number, radius: number): boolean {
    if (!this.terrain.walkable(x, z)) return false;
    for (const c of this.colliders) {
      const min = c.r + radius;
      if ((x - c.x) ** 2 + (z - c.z) ** 2 < min * min) return false;
    }
    return true;
  }

  clampMove(from: Vec2, to: Vec2, radius: number): Vec2 {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) return { x: from.x, z: from.z };
    const n = Math.ceil(len / this.step);
    let last = { x: from.x, z: from.z };
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const p = { x: from.x + dx * t, z: from.z + dz * t };
      if (!this.canStand(p.x, p.z, radius)) return last;
      last = p;
    }
    return last;
  }
}
