/**
 * 地形可通行判定（Stage 2：技能不得穿越不可通行地形）。
 * TerrainQuery 是給 Claude A 對接的介面：遊戲裡換成地圖的可行走判定（navmesh／高度圖／碰撞），
 * 技能根運動、突進、跳躍落點、怪物擊退都只透過這個介面移動角色。
 */
export interface Vec2 {
  x: number;
  z: number;
}

export interface TerrainQuery {
  /** 這個點能不能站（角色半徑已算進去） */
  canStand(x: number, z: number, radius: number): boolean;
  /** 從 from 往 to 移動：回傳沿線最遠、仍然可以站的點（被擋住就停在障礙物前） */
  clampMove(from: Vec2, to: Vec2, radius: number): Vec2;
}

export interface CircleObstacle {
  x: number;
  z: number;
  r: number;
}

/** 實驗頁競技場：圓形邊界＋圓柱障礙物（岩石） */
export class ArenaTerrain implements TerrainQuery {
  readonly radius: number;
  readonly obstacles: readonly CircleObstacle[];
  constructor(radius: number, obstacles: readonly CircleObstacle[]) {
    this.radius = radius;
    this.obstacles = obstacles;
  }

  canStand(x: number, z: number, radius: number): boolean {
    if (Math.hypot(x, z) > this.radius - radius) return false;
    for (const o of this.obstacles) if (Math.hypot(x - o.x, z - o.z) < o.r + radius) return false;
    return true;
  }

  clampMove(from: Vec2, to: Vec2, radius: number): Vec2 {
    if (this.canStand(to.x, to.z, radius)) {
      // 端點可以站，但中間可能穿過障礙物（跳躍也不能穿牆）：逐段檢查
      const d = Math.hypot(to.x - from.x, to.z - from.z);
      const n = Math.max(1, Math.ceil(d / 0.05));
      let ok = true;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        if (!this.canStand(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t, radius)) {
          ok = false;
          break;
        }
      }
      if (ok) return { x: to.x, z: to.z };
    }
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    const n = Math.max(1, Math.ceil(d / 0.02));
    let last = { x: from.x, z: from.z };
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const p = { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
      if (!this.canStand(p.x, p.z, radius)) break;
      last = p;
    }
    return last;
  }
}
