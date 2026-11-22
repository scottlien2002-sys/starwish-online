/**
 * 路線工具：沿主路自動行走（瀏覽器自動測試與單元測試共用同一套跟隨邏輯）。
 */
import { ARENA, MAIN_ROUTE, PORTAL, WALK_SPEED, type RoutePoint, type Vec2 } from "./layout.ts";
import { MAIN_PATH, makePolyline, nearestOnPolyline, pointAt, resolveMove, type Collider, type Polyline, type StarsproutTerrain } from "./terrain.ts";

/** 場景中的固定障礙物（遺跡石柱、拱門柱、傳送門柱）；畫面層依同一份資料擺放模型 */
export interface PillarDef extends Collider {
  height: number;
  broken: boolean;
}

const PILLAR_BEARINGS = [25, 50, 70, 112, 136, 158, 202, 224, 248, 270, 292, 316, 338];
const BROKEN = new Set([70, 158, 248, 316]);

export const RUIN_PILLARS: readonly PillarDef[] = PILLAR_BEARINGS.map((deg, i) => {
  const a = (deg * Math.PI) / 180;
  const R = ARENA.r + 1.4;
  return {
    kind: "pillar",
    x: Math.round((ARENA.x + Math.sin(a) * R) * 100) / 100,
    z: Math.round((ARENA.z + Math.cos(a) * R) * 100) / 100,
    r: 0.75,
    height: BROKEN.has(deg) ? 2.2 + (i % 2) * 0.8 : 6.5 + (i % 3) * 0.7,
    broken: BROKEN.has(deg),
  };
});

/** 遺跡入口拱門（主路 P12b 兩側） */
export const ARCH_POSTS: readonly PillarDef[] = [
  { kind: "arch", x: -2.6, z: 54, r: 0.6, height: 6, broken: false },
  { kind: "arch", x: 2.6, z: 54, r: 0.6, height: 6, broken: false },
];

/** 傳送門左右門柱（中間可走進去） */
export const PORTAL_POSTS: readonly PillarDef[] = [
  { kind: "portal", x: PORTAL.x - 2.7, z: PORTAL.z, r: 0.45, height: 5, broken: false },
  { kind: "portal", x: PORTAL.x + 2.7, z: PORTAL.z, r: 0.45, height: 5, broken: false },
];

export const MAP_COLLIDERS: readonly Collider[] = [...RUIN_PILLARS, ...ARCH_POSTS, ...PORTAL_POSTS];

export const PLAYER_RADIUS = 0.3;

/** 主路線各段長度與累計（直線距離） */
export function routeTable(route: readonly RoutePoint[] = MAIN_ROUTE): { from: string; to: string; len: number; cum: number; dy: number; slopeDeg: number }[] {
  const out: { from: string; to: string; len: number; cum: number; dy: number; slopeDeg: number }[] = [];
  let cum = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    cum += len;
    out.push({ from: a.id, to: b.id, len, cum, dy: b.y - a.y, slopeDeg: (Math.atan2(Math.abs(b.y - a.y), len) * 180) / Math.PI });
  }
  return out;
}

/**
 * 沿折線前進：追蹤前方 lookahead 公尺的點（像搖桿推向路的前方），回傳水平方向（未正規化）。
 * progress 只會往前，不會回頭。
 */
export class RouteFollower {
  readonly path: Polyline;
  readonly lookahead: number;
  progress = 0;
  constructor(points: readonly Vec2[] = MAIN_ROUTE, lookahead = 2.5) {
    this.path = makePolyline(points);
    this.lookahead = lookahead;
  }

  get done(): boolean {
    return this.path.length - this.progress < 0.6;
  }

  reset(): void {
    this.progress = 0;
  }

  /** 依目前位置更新進度並回傳前進方向 */
  update(x: number, z: number): { dx: number; dz: number } {
    const hit = nearestOnPolyline(this.path, x, z);
    // 只在附近 6 公尺內接受進度（避免折返路段被誤判為已走過）
    if (hit.s > this.progress && hit.s < this.progress + 6) this.progress = hit.s;
    const target = pointAt(this.path, this.progress + this.lookahead);
    return { dx: target.x - x, dz: target.z - z };
  }
}

export interface RouteSimResult {
  reached: boolean;
  /** 抵達傳送門的秒數 */
  seconds: number;
  /** 實際走過的水平距離 */
  walked: number;
  /** 各路線點的抵達時間 */
  checkpoints: { id: string; label: string; t: number }[];
  /** 卡住紀錄（3 秒以上沒有前進） */
  stuck: { x: number; z: number; t: number }[];
  /** 被擋住（沿牆滑動）的幀數 */
  blockedFrames: number;
  maxSlopeDeg: number;
  minY: number;
  maxY: number;
}

/** 用與遊戲相同的移動規則（每秒 5 公尺、固定時間步、可行走判定、障礙物）模擬走完主路線 */
export function simulateRoute(
  t: StarsproutTerrain,
  opts: { speed?: number; dt?: number; colliders?: readonly Collider[]; route?: readonly RoutePoint[]; timeout?: number } = {},
): RouteSimResult {
  const route = opts.route ?? MAIN_ROUTE;
  const speed = opts.speed ?? WALK_SPEED;
  const dt = opts.dt ?? 1 / 60;
  const colliders = opts.colliders ?? MAP_COLLIDERS;
  const follower = new RouteFollower(route);
  let x = route[0]!.x;
  let z = route[0]!.z;
  let time = 0;
  let walked = 0;
  let next = 1;
  let lastProgress = 0;
  let lastProgressT = 0;
  let blockedFrames = 0;
  let maxSlope = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  const checkpoints: RouteSimResult["checkpoints"] = [{ id: route[0]!.id, label: route[0]!.label, t: 0 }];
  const stuck: RouteSimResult["stuck"] = [];
  const end = route[route.length - 1]!;
  const timeout = opts.timeout ?? 300;
  while (time < timeout) {
    const dir = follower.update(x, z);
    const len = Math.hypot(dir.dx, dir.dz);
    if (len > 1e-6) {
      const nx = x + (dir.dx / len) * speed * dt;
      const nz = z + (dir.dz / len) * speed * dt;
      const r = resolveMove(t, colliders, PLAYER_RADIUS, x, z, nx, nz);
      if (r.blocked) blockedFrames++;
      walked += Math.hypot(r.x - x, r.z - z);
      x = r.x;
      z = r.z;
    }
    time += dt;
    const y = t.surface(x, z);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    maxSlope = Math.max(maxSlope, t.slopeDeg(x, z));
    while (next < route.length && Math.hypot(route[next]!.x - x, route[next]!.z - z) < 2.5) {
      checkpoints.push({ id: route[next]!.id, label: route[next]!.label, t: time });
      next++;
    }
    if (follower.progress > lastProgress + 0.5) {
      lastProgress = follower.progress;
      lastProgressT = time;
    } else if (time - lastProgressT > 3) {
      stuck.push({ x, z, t: time });
      break;
    }
    if (next >= route.length && Math.hypot(end.x - x, end.z - z) < 1.2) {
      return { reached: true, seconds: time, walked, checkpoints, stuck, blockedFrames, maxSlopeDeg: maxSlope, minY, maxY };
    }
  }
  return { reached: false, seconds: time, walked, checkpoints, stuck, blockedFrames, maxSlopeDeg: maxSlope, minY, maxY };
}

export { MAIN_PATH };
