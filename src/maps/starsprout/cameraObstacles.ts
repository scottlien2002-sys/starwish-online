// 第三人稱鏡頭避障：只用「大型障礙物」（帳篷、涼亭、樹幹、遺跡石柱、拱門、傳送門柱）。
// 純計算（不依賴 Babylon）：由現有碰撞資料轉成直立圓柱／圓錐，對「角色 → 鏡頭」線段做解析求交，不用射線查詢。
// 樹冠、草叢、小花、灌木、柵欄、木箱等都不算鏡頭障礙物，避免鏡頭頻繁縮放。
import type { Collider } from "./terrain.ts";

export interface CameraObstacle {
  x: number;
  z: number;
  /** 底部半徑、頂部半徑（帳篷是圓錐） */
  rBottom: number;
  rTop: number;
  /** 底部與頂部高度（世界座標） */
  y0: number;
  y1: number;
  kind: string;
}

/** 鏡頭與障礙物表面保持的距離（公尺） */
export const CAMERA_PAD = 0.3;
/** 被擋住時鏡頭最近可以拉到離角色多近 */
export const CAMERA_MIN_OBSTRUCTED = 1.4;

/** 由現有碰撞資料建立鏡頭障礙物；groundY 取物件所在地面高度 */
export function cameraObstaclesFrom(colliders: readonly Collider[], groundY: (x: number, z: number) => number): CameraObstacle[] {
  const out: CameraObstacle[] = [];
  for (const c of colliders) {
    const g = groundY(c.x, c.z);
    const h = (c as { height?: number }).height;
    switch (c.kind) {
      case "pavilion":
        // 主體圓柱＋屋簷（屋頂比主體寬），用頂部較寬的圓柱涵蓋
        out.push({ kind: c.kind, x: c.x, z: c.z, rBottom: 2.6 * (c.r / 2.6), rTop: 3.05 * (c.r / 2.6), y0: g - 0.5, y1: g + 4.4 * (c.r / 2.6) });
        break;
      case "tent":
        // 圓錐帳篷：底半徑約 1.7、高約 2.7
        out.push({ kind: c.kind, x: c.x, z: c.z, rBottom: c.r, rTop: 0.15 * (c.r / 1.75), y0: g - 0.5, y1: g + 2.7 * (c.r / 1.75) });
        break;
      case "tree": {
        // 只算樹幹（不算樹冠）：碰撞半徑 0.42×縮放 → 樹幹可見半徑約 0.28×縮放、高約 2.3×縮放
        const s = c.r / 0.42;
        out.push({ kind: c.kind, x: c.x, z: c.z, rBottom: 0.28 * s, rTop: 0.2 * s, y0: g - 0.5, y1: g + 2.3 * s });
        break;
      }
      case "pillar":
      case "arch":
      case "portal":
        out.push({ kind: c.kind, x: c.x, z: c.z, rBottom: c.r, rTop: c.r, y0: g - 0.5, y1: g + (h ?? 5) });
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * 角色 (tx,ty,tz) 往單位方向 (dx,dy,dz) 看向鏡頭，鏡頭想放在距離 maxR。
 * 回傳鏡頭可放的最遠距離（沒被擋 = maxR）。
 * 角色本身在障礙物（含邊距）內時不算擋住，避免鏡頭貼臉。
 */
export function obstructedDistance(
  obs: readonly CameraObstacle[],
  tx: number,
  ty: number,
  tz: number,
  dx: number,
  dy: number,
  dz: number,
  maxR: number,
): number {
  const a = dx * dx + dz * dz;
  if (a < 1e-8) return maxR;
  let best = maxR + CAMERA_PAD;
  for (const o of obs) {
    const ox = tx - o.x;
    const oz = tz - o.z;
    // 先用最大半徑快速排除
    const rMax = Math.max(o.rBottom, o.rTop) + CAMERA_PAD;
    const b = ox * dx + oz * dz;
    const c0 = ox * ox + oz * oz;
    if (c0 <= rMax * rMax) {
      // 角色站在（加邊距的）障礙物裡：只有在邊距內才可能，略過
      continue;
    }
    if (b >= 0) continue; // 障礙物在鏡頭反方向
    // 錐形：用入射點高度的半徑重算兩次
    let r = o.rBottom + CAMERA_PAD;
    let s = -1;
    for (let k = 0; k < 3; k++) {
      const disc = b * b - a * (c0 - r * r);
      if (disc < 0) {
        s = -1;
        break;
      }
      s = (-b - Math.sqrt(disc)) / a;
      const y = ty + s * dy;
      const f = Math.min(1, Math.max(0, (y - o.y0) / (o.y1 - o.y0)));
      const rNext = o.rBottom + (o.rTop - o.rBottom) * f + CAMERA_PAD;
      if (Math.abs(rNext - r) < 0.01) break;
      r = rNext;
    }
    if (s < 0 || s >= best) continue;
    const y = ty + s * dy;
    if (y < o.y0 || y > o.y1 + CAMERA_PAD) continue;
    best = s;
  }
  if (best >= maxR + CAMERA_PAD) return maxR;
  return Math.max(CAMERA_MIN_OBSTRUCTED, Math.min(maxR, best));
}

/**
 * 只保留角色附近的障礙物（角色移動超過 3 公尺才重建），每幀只檢查幾十個圓柱。
 */
export class CameraObstacleQuery {
  private near: CameraObstacle[] = [];
  private cx = Number.POSITIVE_INFINITY;
  private cz = Number.POSITIVE_INFINITY;
  private readonly all: readonly CameraObstacle[];
  private readonly reach: number;
  constructor(all: readonly CameraObstacle[], reach: number) {
    this.all = all;
    this.reach = reach;
  }

  get total(): number {
    return this.all.length;
  }
  get nearby(): number {
    return this.near.length;
  }
  list(): readonly CameraObstacle[] {
    return this.all;
  }

  distance(tx: number, ty: number, tz: number, dx: number, dy: number, dz: number, maxR: number): number {
    if (Math.hypot(tx - this.cx, tz - this.cz) > 3) {
      this.cx = tx;
      this.cz = tz;
      const R = this.reach + 3 + 3.5;
      this.near = this.all.filter((o) => Math.hypot(o.x - tx, o.z - tz) < R);
    }
    return obstructedDistance(this.near, tx, ty, tz, dx, dy, dz, maxR);
  }
}
