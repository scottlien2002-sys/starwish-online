/**
 * Stage 6 星芽原野：地形高度、溪流、橋、可行走判定（純函式＋資料，不依賴 Babylon；可單元測試、伺服器可共用）。
 *
 * 高度製作順序（每一步都可重現，沒有隨機數）：
 *   1. 高度控制點的高斯加權平均（自然起伏的底形）＋外圍山丘
 *   2. 練功區壓平（保留可戰鬥的平地）
 *   3. Boss 戰鬥場、傳送門平台完全平坦
 *   4. 支線、主路依路線點高度壓平（主路最後，優先）
 *   5. 溪流下挖河道、兩岸抬高到水面以上（最後執行，所以河道一定是水）
 * 橋面不是地形：另外以橋面高度覆蓋（玩家走在橋上，橋下仍是水）。
 */
import {
  ARENA,
  BACKGROUND_HEIGHT,
  BRIDGES,
  HEIGHT_ANCHORS,
  MAIN_ROAD_HALF,
  MAIN_ROUTE,
  MAP_HALF,
  PORTAL,
  RIVER,
  RIVER_HALF,
  SIDE_PATHS,
  SIDE_ROAD_HALF,
  WALK_HALF,
  ZONES,
  type BridgeDef,
  type Vec2,
} from "./layout.ts";

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 可行走的最大坡度（度）；更陡的是懸崖或河岸 */
export const MAX_WALK_SLOPE = 35;

export interface PolylineHit {
  /** 到折線的水平距離 */
  d: number;
  /** 最近點所在線段 */
  seg: number;
  /** 線段內位置 0..1 */
  u: number;
  /** 從起點算起的弧長 */
  s: number;
  x: number;
  z: number;
}

export interface Polyline {
  pts: readonly Vec2[];
  /** 每個點的累計弧長 */
  cum: number[];
  length: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function makePolyline(pts: readonly Vec2[]): Polyline {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
  return {
    pts,
    cum,
    length: cum[cum.length - 1]!,
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minZ: Math.min(...pts.map((p) => p.z)),
    maxZ: Math.max(...pts.map((p) => p.z)),
  };
}

export function nearestOnPolyline(pl: Polyline, x: number, z: number): PolylineHit {
  let best: PolylineHit = { d: Infinity, seg: 0, u: 0, s: 0, x: 0, z: 0 };
  const p = pl.pts;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i]!;
    const b = p[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    const u = l2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
    const qx = a.x + dx * u;
    const qz = a.z + dz * u;
    const d = Math.hypot(x - qx, z - qz);
    if (d < best.d) best = { d, seg: i, u, s: pl.cum[i]! + Math.sqrt(l2) * u, x: qx, z: qz };
  }
  return best;
}

/** 折線上弧長 s 的位置 */
export function pointAt(pl: Polyline, s: number): Vec2 {
  const t = Math.min(pl.length, Math.max(0, s));
  let i = 0;
  while (i < pl.cum.length - 2 && pl.cum[i + 1]! < t) i++;
  const a = pl.pts[i]!;
  const b = pl.pts[i + 1]!;
  const segLen = pl.cum[i + 1]! - pl.cum[i]!;
  const u = segLen > 0 ? (t - pl.cum[i]!) / segLen : 0;
  return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u };
}

const inBoxRange = (pl: Polyline, x: number, z: number, pad: number): boolean =>
  x >= pl.minX - pad && x <= pl.maxX + pad && z >= pl.minZ - pad && z <= pl.maxZ + pad;

interface ProfiledPath {
  pl: Polyline;
  ys: number[];
  half: number;
  blend: number;
}

const profileY = (path: ProfiledPath, hit: PolylineHit): number => lerp(path.ys[hit.seg]!, path.ys[hit.seg + 1]!, hit.u);

export const MAIN_PATH = makePolyline(MAIN_ROUTE);
const MAIN_PROFILE: ProfiledPath = { pl: MAIN_PATH, ys: MAIN_ROUTE.map((p) => p.y), half: MAIN_ROAD_HALF, blend: 3.5 };
const SIDE_PROFILES: ProfiledPath[] = SIDE_PATHS.map((sp) => ({ pl: makePolyline(sp.points), ys: sp.points.map((p) => p.y), half: SIDE_ROAD_HALF, blend: 3 }));
export const RIVER_PATH = makePolyline(RIVER);
const PORTAL_PATH = makePolyline([
  { x: ARENA.x, z: ARENA.z },
  { x: PORTAL.x, z: PORTAL.z },
]);

/** 溪流在最近點的水面高度 */
function waterAt(hit: PolylineHit): number {
  return lerp(RIVER[hit.seg]!.water, RIVER[hit.seg + 1]!.water, hit.u);
}

/** 低頻起伏（沒有亂數，可重現） */
function ripple(x: number, z: number): number {
  return 0.38 * Math.sin(x * 0.13 + z * 0.07) + 0.26 * Math.sin(x * 0.05 - z * 0.11 + 1.7) + 0.14 * Math.sin(x * 0.31 + z * 0.23 + 0.4);
}

/** 地形高度（不含橋面）— 解析式，建置高度網格與單元測試用 */
export function analyticHeight(x: number, z: number): number {
  // 1. 高度控制點
  let ws = 0.015;
  let hs = BACKGROUND_HEIGHT * ws;
  for (const a of HEIGHT_ANCHORS) {
    const dx = x - a.x;
    const dz = z - a.z;
    const q = (dx * dx + dz * dz) / (a.s * a.s);
    if (q > 16) continue;
    const w = Math.exp(-q);
    ws += w;
    hs += w * a.y;
  }
  let h = hs / ws;
  // 外圍山丘（可行走範圍外抬高，形成自然邊界）
  const edge = Math.max(Math.abs(x), Math.abs(z));
  h += smoothstep(80, 96, edge) * 12;

  // 起伏：平地、道路、戰鬥場附近會被下面的壓平蓋掉
  let freedom = 1;

  // 2. 練功區壓平
  for (const zn of ZONES) {
    const d = Math.hypot(x - zn.x, z - zn.z);
    if (d > zn.r + 5) continue;
    const k = zn.flatten * (1 - smoothstep(zn.r * 0.7, zn.r + 4, d));
    h = lerp(h, zn.y, k);
    freedom = Math.min(freedom, 1 - k * 0.8);
  }

  // 3. Boss 戰鬥場、傳送門平台與連接通道（完全平坦）
  {
    const d = Math.hypot(x - ARENA.x, z - ARENA.z);
    const ka = 1 - smoothstep(ARENA.r, ARENA.r + 3, d);
    const pp = nearestOnPolyline(PORTAL_PATH, x, z);
    const kp = 1 - smoothstep(4, 7, pp.d);
    const dp = Math.hypot(x - PORTAL.x, z - PORTAL.z);
    const kq = 1 - smoothstep(PORTAL.r, PORTAL.r + 3, dp);
    const k = Math.max(ka, kp, kq);
    if (k > 0) {
      h = lerp(h, ARENA.y, k);
      freedom = Math.min(freedom, 1 - k);
    }
  }

  // 4. 道路（支線先、主路後）
  for (const path of [...SIDE_PROFILES, MAIN_PROFILE]) {
    const reach = path.half + path.blend;
    if (!inBoxRange(path.pl, x, z, reach)) continue;
    const hit = nearestOnPolyline(path.pl, x, z);
    if (hit.d > reach) continue;
    const k = 1 - smoothstep(path.half, reach, hit.d);
    h = lerp(h, profileY(path, hit), k);
    freedom = Math.min(freedom, 1 - k);
  }

  h += ripple(x, z) * freedom;

  // 5. 溪流
  const rh = nearestOnPolyline(RIVER_PATH, x, z);
  if (rh.d < RIVER_HALF + 10) {
    const water = waterAt(rh);
    // 兩岸抬高到水面以上（河岸頂 = 水面 + 1.1）
    const bank = water + 1.1;
    const lift = 1 - smoothstep(RIVER_HALF + 2, RIVER_HALF + 10, rh.d);
    if (h < bank) h = lerp(h, bank, lift);
    if (rh.d < RIVER_HALF) {
      const t = rh.d / RIVER_HALF;
      h = water - 1.1 + 0.7 * t * t;
    } else {
      const k = 1 - smoothstep(RIVER_HALF, RIVER_HALF + 2.5, rh.d);
      h = lerp(h, water - 0.4, k);
    }
  }
  return h;
}

export interface BridgeHit {
  bridge: BridgeDef;
  /** 沿橋軸（-L/2 .. L/2） */
  along: number;
  /** 橫向（-W/2 .. W/2） */
  across: number;
  deckY: number;
}

export interface Collider {
  x: number;
  z: number;
  r: number;
  kind: string;
}

/**
 * 地形查詢：高度網格（0.5 公尺）＋橋面覆蓋＋溪流判定＋可行走判定。
 * 網格只建一次（約 13 萬點）；執行時只做雙線性內插，每幀成本極低。
 */
export class StarsproutTerrain {
  readonly step: number;
  readonly n: number;
  readonly heights: Float32Array;
  private readonly bridgeEnds: { b: BridgeDef; yS: number; yN: number }[];

  constructor(step = 0.5) {
    this.step = step;
    this.n = Math.round((2 * MAP_HALF) / step) + 1;
    const n = this.n;
    this.heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      const z = -MAP_HALF + j * step;
      for (let i = 0; i < n; i++) this.heights[j * n + i] = analyticHeight(-MAP_HALF + i * step, z);
    }
    this.bridgeEnds = BRIDGES.map((b) => ({
      b,
      yS: this.height(b.cx - (b.ux * b.length) / 2, b.cz - (b.uz * b.length) / 2),
      yN: this.height(b.cx + (b.ux * b.length) / 2, b.cz + (b.uz * b.length) / 2),
    }));
  }

  /** 地形高度（雙線性內插，不含橋面） */
  height(x: number, z: number): number {
    const n = this.n;
    const fx = Math.min(n - 1.0001, Math.max(0, (x + MAP_HALF) / this.step));
    const fz = Math.min(n - 1.0001, Math.max(0, (z + MAP_HALF) / this.step));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const h = this.heights;
    const a = h[j * n + i]!;
    const b = h[j * n + i + 1]!;
    const c = h[(j + 1) * n + i]!;
    const d = h[(j + 1) * n + i + 1]!;
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  bridgeAt(x: number, z: number): BridgeHit | null {
    for (const e of this.bridgeEnds) {
      const b = e.b;
      const dx = x - b.cx;
      const dz = z - b.cz;
      const along = dx * b.ux + dz * b.uz;
      const across = -dx * b.uz + dz * b.ux;
      if (Math.abs(along) > b.length / 2 || Math.abs(across) > b.width / 2) continue;
      const t = along / b.length + 0.5;
      return { bridge: b, along, across, deckY: lerp(e.yS, e.yN, t) + 0.35 * Math.sin(Math.PI * t) };
    }
    return null;
  }

  /** 玩家與怪物站立的高度（橋上用橋面） */
  surface(x: number, z: number): number {
    const br = this.bridgeAt(x, z);
    return br ? br.deckY : this.height(x, z);
  }

  /** 溪流資訊：距離、水面高度 */
  river(x: number, z: number): { d: number; water: number } {
    const hit = nearestOnPolyline(RIVER_PATH, x, z);
    return { d: hit.d, water: waterAt(hit) };
  }

  isWater(x: number, z: number): boolean {
    if (this.bridgeAt(x, z)) return false;
    return this.river(x, z).d < RIVER_HALF + 0.3;
  }

  /** 站立面坡度（度） */
  slopeDeg(x: number, z: number): number {
    const e = 0.5;
    const gx = (this.surface(x + e, z) - this.surface(x - e, z)) / (2 * e);
    const gz = (this.surface(x, z + e) - this.surface(x, z - e)) / (2 * e);
    return (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
  }

  /** 地形本身的坡度（不含橋，上色用） */
  terrainSlopeDeg(x: number, z: number): number {
    const e = 0.5;
    const gx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const gz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    return (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
  }

  /** 可行走：在邊界內、不是水面、坡度不超過上限；橋上只要在欄杆內就能走 */
  walkable(x: number, z: number): boolean {
    if (Math.abs(x) > WALK_HALF || Math.abs(z) > WALK_HALF) return false;
    const br = this.bridgeAt(x, z);
    if (br) return Math.abs(br.across) <= br.bridge.width / 2 - 0.35;
    if (this.river(x, z).d < RIVER_HALF + 0.3) return false;
    return this.slopeDeg(x, z) <= MAX_WALK_SLOPE;
  }
}

/** 圓形障礙物推開 */
export function pushOutOfColliders(x: number, z: number, radius: number, colliders: readonly Collider[]): { x: number; z: number } {
  let px = x;
  let pz = z;
  for (const c of colliders) {
    const dx = px - c.x;
    const dz = pz - c.z;
    const min = c.r + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2);
    if (d < 1e-6) {
      px = c.x + min;
      continue;
    }
    const push = (min - d) / d;
    px += dx * push;
    pz += dz * push;
  }
  return { x: px, z: pz };
}

/**
 * 移動解算：先推開障礙物，再檢查可行走；不能走就沿 X 或 Z 單軸滑動；都不行就停在原地。
 * 目前位置本來就不可走（例如測試傳送到懸崖上）時允許離開，避免卡死。
 */
export function resolveMove(
  t: StarsproutTerrain,
  colliders: readonly Collider[],
  radius: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): { x: number; z: number; blocked: boolean } {
  const tryAt = (x: number, z: number): { x: number; z: number } | null => {
    const p = pushOutOfColliders(x, z, radius, colliders);
    return t.walkable(p.x, p.z) ? p : null;
  };
  if (!t.walkable(x0, z0)) {
    const p = pushOutOfColliders(x1, z1, radius, colliders);
    return { x: p.x, z: p.z, blocked: false };
  }
  const full = tryAt(x1, z1);
  if (full) return { ...full, blocked: false };
  const sx = tryAt(x1, z0);
  const sz = tryAt(x0, z1);
  // 兩個方向都可以時，選移動比較多的
  if (sx && sz) return Math.abs(x1 - x0) >= Math.abs(z1 - z0) ? { ...sx, blocked: true } : { ...sz, blocked: true };
  if (sx) return { ...sx, blocked: true };
  if (sz) return { ...sz, blocked: true };
  return { x: x0, z: z0, blocked: true };
}
