/**
 * 星廢垃圾場：地形高度、可走判定、碰撞與移動（純邏輯，不依賴 Babylon；伺服器與單元測試可共用）。
 *
 * - groundHeight：地形網格（畫面）的高度＝基底起伏＋山丘／垃圾山＋高台＋運河／水池＋坡道
 * - walkHeight：玩家實際站立的高度＝地形，加上橋、金屬步道、階梯、平台（在範圍內時取較高者）
 * - 可走判定：預先以 0.5 m 格網計算坡度（≤ 35°）；橋與步道的邊緣落差大，自然不可走（另有欄杆外觀）
 * - 碰撞物：圓形與旋轉矩形，移動時推出
 */
import {
  BASINS,
  COLOSSUS,
  CONVEYORS,
  CRANES,
  CRYSTALS,
  DECKS,
  type DeckDef,
  FACTORIES,
  FURNACES,
  MAX_WALK_SLOPE,
  MOUNDS,
  PIPES,
  PLATEAUS,
  type PlateauDef,
  RAMPS,
  REACTOR,
  STEAM_VENTS,
  type Vec2,
  WALK_BOUND,
} from "./layout.ts";

import { lerp, polyDist, segDist, smoothstep } from "./geom.ts";
import { pileColliders } from "./scatter.ts";
export { segDist, smoothstep };

/** 高台內部的「到邊緣距離」（正＝在內部） */
export function plateauInside(p: PlateauDef, x: number, z: number): number {
  if (p.shape === "circle") return p.hx - Math.hypot(x - p.x, z - p.z);
  // 圓角矩形 SDF（取負＝內部距離）
  const qx = Math.abs(x - p.x) - (p.hx - p.round);
  const qz = Math.abs(z - p.z) - (p.hz - p.round);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
  const inside = Math.min(Math.max(qx, qz), 0);
  return -(outside + inside - p.round);
}

/** 基底細微起伏（低地 ±0.35 m；不影響可走） */
function baseNoise(x: number, z: number): number {
  return 0.22 * Math.sin(x * 0.083 + z * 0.031) + 0.16 * Math.sin(z * 0.097 - x * 0.044 + 1.3) + 0.08 * Math.sin((x + z) * 0.21);
}

/** 地形高度（畫面用；不含橋與平台） */
export function groundHeight(x: number, z: number): number {
  let h = baseNoise(x, z);
  for (const m of MOUNDS) {
    const dx = x - m.x;
    const dz = z - m.z;
    const d2 = dx * dx + dz * dz;
    const s2 = m.s * m.s;
    if (d2 > s2 * 16) continue;
    // 垃圾山頂部加一點不規則（堆積感）
    const g = Math.exp(-d2 / (2 * s2));
    h += m.h * g * (m.kind === "junk" ? 1 + 0.08 * Math.sin(dx * 0.9 + dz * 0.7) : 1);
  }
  // 地圖外圍：抬高成垃圾山壁（可走範圍以外）
  const edge = Math.max(Math.abs(x), Math.abs(z));
  if (edge > 128) h += Math.pow((edge - 128) / 22, 2) * 26;
  for (const p of PLATEAUS) {
    const ins = plateauInside(p, x, z);
    if (ins < -p.cliff) continue;
    const w = smoothstep(-p.cliff, 0.5, ins);
    // 高台頂部平整；低於高台的地面被抬高、高於高台的（例如入口周圍的垃圾山腳）被壓平
    h = lerp(h, p.y, w);
  }
  for (const b of BASINS) {
    const d = polyDist(x, z, b.pts);
    if (d > b.r + 3) continue;
    const w = 1 - smoothstep(b.r * 0.55, b.r + 2.5, d);
    h = Math.min(h, lerp(h, b.bottom, w));
  }
  for (const r of RAMPS) {
    const s = segDist(x, z, r.a.x, r.a.z, r.b.x, r.b.z);
    const half = r.w / 2;
    if (s.d > half + 3) continue;
    const tc = Math.min(1, Math.max(0, s.t));
    const hr = lerp(r.a.y, r.b.y, tc);
    // 坡道兩端外 3 m 漸隱（接到平台頂或地面）
    const along = s.t < 0 ? -s.t * Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z) : s.t > 1 ? (s.t - 1) * Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z) : 0;
    const lateral = Math.sqrt(Math.max(0, s.d * s.d - along * along));
    const w = (1 - smoothstep(half, half + 3, lateral)) * (1 - smoothstep(0, 3, along));
    h = lerp(h, hr, w);
  }
  return h;
}

/** 橋／步道／階梯／平台：(x,z) 在範圍內時回傳行走面高度，否則 null */
export function deckHeightAt(d: DeckDef, x: number, z: number): number | null {
  const s = segDist(x, z, d.a.x, d.a.z, d.b.x, d.b.z);
  if (s.t < 0 || s.t > 1) return null;
  if (s.d > d.w / 2) return null;
  return lerp(d.a.y, d.b.y, s.t);
}

/** 玩家站立高度（地形與橋／平台取較高者） */
export function walkHeight(x: number, z: number): number {
  let h = groundHeight(x, z);
  for (const d of DECKS) {
    const dh = deckHeightAt(d, x, z);
    if (dh !== null && dh > h) h = dh;
  }
  return h;
}

// ---------------- 碰撞物 ----------------
export interface CircleCollider {
  kind: "circle";
  id: string;
  x: number;
  z: number;
  r: number;
}
export interface BoxCollider {
  kind: "box";
  id: string;
  x: number;
  z: number;
  hx: number;
  hz: number;
  rot: number;
}
export type Collider = CircleCollider | BoxCollider;

function segBox(id: string, a: Vec2, b: Vec2, halfW: number): BoxCollider {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  // rot：本地 +X 對齊線段方向
  return { kind: "box", id, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, hx: len / 2, hz: halfW, rot: Math.atan2(b.z - a.z, b.x - a.x) };
}

/** 管線支架位置（每段兩端與中點；外觀與碰撞共用） */
export function pipeSupports(): (Vec2 & { id: string })[] {
  const out: (Vec2 & { id: string })[] = [];
  for (const p of PIPES) {
    for (let i = 0; i < p.pts.length; i++) {
      const a = p.pts[i]!;
      out.push({ id: `${p.id}-${i}`, x: a.x, z: a.z });
      const b = p.pts[i + 1];
      if (b) out.push({ id: `${p.id}-${i}m`, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    }
  }
  return out;
}

export function buildColliders(): Collider[] {
  const c: Collider[] = [];
  for (const f of FACTORIES) c.push({ kind: "box", id: f.id, x: f.x, z: f.z, hx: f.hx, hz: f.hz, rot: f.rot });
  for (const k of CRANES) c.push({ kind: "circle", id: k.id, x: k.x, z: k.z, r: 2.4 });
  for (const cv of CONVEYORS) c.push(segBox(cv.id, cv.a, cv.b, 1.1));
  for (const f of FURNACES) c.push({ kind: "circle", id: f.id, x: f.x, z: f.z, r: f.r });
  for (const v of STEAM_VENTS) if (v.y - groundHeight(v.x, v.z) < 1) c.push({ kind: "circle", id: v.id, x: v.x, z: v.z, r: 0.9 });
  c.push({ kind: "circle", id: "reactor", x: REACTOR.x, z: REACTOR.z, r: REACTOR.r });
  // 反應爐兩側的排氣塔
  c.push({ kind: "circle", id: "stack-w", x: 8, z: 128, r: 1.8 });
  c.push({ kind: "circle", id: "stack-e", x: 36, z: 128, r: 1.8 });
  c.push({ kind: "circle", id: "colossus", x: COLOSSUS.x, z: COLOSSUS.z, r: COLOSSUS.r });
  // 巨像伸出的手臂
  c.push({ kind: "circle", id: "colossus-arm", x: COLOSSUS.x - 9 * Math.cos(COLOSSUS.yaw + 0.9), z: COLOSSUS.z - 9 * Math.sin(COLOSSUS.yaw + 0.9), r: 3.2 });
  for (const cr of CRYSTALS) c.push({ kind: "circle", id: `crystal-${cr.x}-${cr.z}`, x: cr.x, z: cr.z, r: 0.55 + cr.s * 0.25 });
  for (const s of pipeSupports()) c.push({ kind: "circle", id: `pipe-${s.id}`, x: s.x, z: s.z, r: 0.35 });
  return c;
}

/** 點是否落在碰撞物（含額外邊距）內 */
export function insideColliders(list: readonly Collider[], x: number, z: number, pad: number): boolean {
  for (const c of list) {
    if (c.kind === "circle") {
      if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true;
    } else {
      const co = Math.cos(c.rot);
      const si = Math.sin(c.rot);
      const dx = x - c.x;
      const dz = z - c.z;
      if (Math.abs(dx * co + dz * si) < c.hx + pad && Math.abs(-dx * si + dz * co) < c.hz + pad) return true;
    }
  }
  return false;
}

/** 固定碰撞物（建築、吊車、反應爐…），不含垃圾堆 */
export const STATIC_COLLIDERS: readonly Collider[] = buildColliders();
/** 全部碰撞物＝固定＋垃圾堆（垃圾堆位置與畫質無關） */
export const COLLIDERS: readonly Collider[] = [
  ...STATIC_COLLIDERS,
  ...pileColliders(groundHeight, (x, z, pad) => insideColliders(STATIC_COLLIDERS, x, z, pad)).map((p): Collider => ({ kind: "circle", ...p })),
];

/** 把點推出碰撞物（含玩家半徑） */
export function pushOut(x: number, z: number, radius: number, colliders: readonly Collider[] = COLLIDERS): { x: number; z: number; hit: boolean } {
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    for (const c of colliders) {
      if (c.kind === "circle") {
        const dx = x - c.x;
        const dz = z - c.z;
        const R = c.r + radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < R * R) {
          const d = Math.sqrt(d2) || 1e-6;
          x = c.x + (dx / d) * R;
          z = c.z + (dz / d) * R;
          hit = true;
        }
      } else {
        const co = Math.cos(c.rot);
        const si = Math.sin(c.rot);
        const dx = x - c.x;
        const dz = z - c.z;
        const lx = dx * co + dz * si;
        const lz = -dx * si + dz * co;
        const ex = c.hx + radius;
        const ez = c.hz + radius;
        if (Math.abs(lx) < ex && Math.abs(lz) < ez) {
          hit = true;
          // 從最近的邊推出
          const px = ex - Math.abs(lx);
          const pz = ez - Math.abs(lz);
          let nx = lx;
          let nz = lz;
          if (px < pz) nx = Math.sign(lx || 1) * ex;
          else nz = Math.sign(lz || 1) * ez;
          x = c.x + nx * co - nz * si;
          z = c.z + nx * si + nz * co;
        }
      }
    }
  }
  return { x, z, hit };
}

// ---------------- 可走格網 ----------------
export const GRID_STEP = 0.5;
const GRID_HALF = WALK_BOUND + 2;
const GRID_N = Math.round((GRID_HALF * 2) / GRID_STEP) + 1;
const MAX_TAN = Math.tan((MAX_WALK_SLOPE * Math.PI) / 180);

export class WalkGrid {
  readonly n = GRID_N;
  readonly heights: Float32Array;
  /** 1＝可走 */
  readonly walk: Uint8Array;
  readonly buildMs: number;

  constructor() {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const n = GRID_N;
    this.heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      const z = -GRID_HALF + j * GRID_STEP;
      for (let i = 0; i < n; i++) this.heights[j * n + i] = walkHeight(-GRID_HALF + i * GRID_STEP, z);
    }
    this.walk = new Uint8Array(n * n);
    const lim = MAX_TAN * GRID_STEP;
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const x = -GRID_HALF + i * GRID_STEP;
        const z = -GRID_HALF + j * GRID_STEP;
        if (Math.abs(x) > WALK_BOUND || Math.abs(z) > WALK_BOUND) continue;
        const k = j * n + i;
        const h = this.heights[k]!;
        // 低於水面（運河、水池）不可走
        if (h < -0.6) continue;
        const dmax = Math.max(
          Math.abs(this.heights[k - 1]! - h),
          Math.abs(this.heights[k + 1]! - h),
          Math.abs(this.heights[k - n]! - h),
          Math.abs(this.heights[k + n]! - h),
        );
        if (dmax <= lim) this.walk[k] = 1;
      }
    }
    this.buildMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
  }

  private idx(x: number, z: number): number {
    const i = Math.round((x + GRID_HALF) / GRID_STEP);
    const j = Math.round((z + GRID_HALF) / GRID_STEP);
    if (i < 0 || j < 0 || i >= GRID_N || j >= GRID_N) return -1;
    return j * GRID_N + i;
  }

  walkable(x: number, z: number): boolean {
    const k = this.idx(x, z);
    return k >= 0 && this.walk[k] === 1;
  }

  /** 雙線性內插的站立高度（比直接呼叫 walkHeight 快） */
  height(x: number, z: number): number {
    const fx = (x + GRID_HALF) / GRID_STEP;
    const fz = (z + GRID_HALF) / GRID_STEP;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= GRID_N - 1 || j >= GRID_N - 1) return walkHeight(x, z);
    const tx = fx - i;
    const tz = fz - j;
    const n = GRID_N;
    const h00 = this.heights[j * n + i]!;
    const h10 = this.heights[j * n + i + 1]!;
    const h01 = this.heights[(j + 1) * n + i]!;
    const h11 = this.heights[(j + 1) * n + i + 1]!;
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  /** 可走格子數（報告用：可走面積 m²＝數量 × 0.25） */
  walkableCells(): number {
    let c = 0;
    for (let k = 0; k < this.walk.length; k++) c += this.walk[k]!;
    return c;
  }
}

/** 單步移動：先試完整位移，不行再沿 X／Z 滑動；回傳實際位置 */
export function resolveMove(
  grid: WalkGrid,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  radius = 0.3,
  colliders: readonly Collider[] = COLLIDERS,
): { x: number; z: number; blocked: boolean } {
  const ok = (x: number, z: number): { x: number; z: number } | null => {
    const p = pushOut(x, z, radius, colliders);
    if (!grid.walkable(p.x, p.z)) return null;
    // 一步的高度變化不得超過坡度限制（防止從橋邊直接走下去）
    const dh = Math.abs(grid.height(p.x, p.z) - grid.height(x0, z0));
    const dist = Math.hypot(p.x - x0, p.z - z0);
    if (dh > Math.max(0.35, dist * MAX_TAN * 1.15)) return null;
    return p;
  };
  if (!grid.walkable(x0, z0)) {
    // 出生在不可走的地方（不應發生）：允許移動以免卡死
    const p = pushOut(x1, z1, radius, colliders);
    return { x: p.x, z: p.z, blocked: false };
  }
  const full = ok(x1, z1);
  if (full) return { ...full, blocked: false };
  const sx = ok(x1, z0);
  const sz = ok(x0, z1);
  if (sx && sz) return Math.abs(x1 - x0) >= Math.abs(z1 - z0) ? { ...sx, blocked: true } : { ...sz, blocked: true };
  if (sx) return { ...sx, blocked: true };
  if (sz) return { ...sz, blocked: true };
  return { x: x0, z: z0, blocked: true };
}

/** 沿路線點自動行走（固定 dt 模擬；與畫面 FPS 無關）：測試可達性、卡住、不需要跳躍 */
export interface RouteSimResult {
  reached: string[];
  stuckAt: { id: string; x: number; z: number } | null;
  time: number;
  distance: number;
  maxStep: number;
  maxSlopeDeg: number;
  maxSlopeAt: { x: number; z: number } | null;
  minY: number;
  maxY: number;
}

export function simulateRoute(grid: WalkGrid, route: readonly (Vec2 & { id: string })[], speed = 5, dt = 1 / 30): RouteSimResult {
  const res: RouteSimResult = { reached: [], stuckAt: null, time: 0, distance: 0, maxStep: 0, maxSlopeDeg: 0, maxSlopeAt: null, minY: Infinity, maxY: -Infinity };
  if (!route.length) return res;
  let x = route[0]!.x;
  let z = route[0]!.z;
  res.reached.push(route[0]!.id);
  for (let i = 1; i < route.length; i++) {
    const tgt = route[i]!;
    let stall = 0;
    let best = Infinity;
    let guard = 0;
    while (Math.hypot(tgt.x - x, tgt.z - z) > 1.2) {
      if (++guard > 60 * 400) break;
      const dx = tgt.x - x;
      const dz = tgt.z - z;
      const L = Math.hypot(dx, dz);
      const step = speed * dt;
      const y0 = grid.height(x, z);
      const r = resolveMove(grid, x, z, x + (dx / L) * step, z + (dz / L) * step);
      const moved = Math.hypot(r.x - x, r.z - z);
      const y1 = grid.height(r.x, r.z);
      if (moved > 1e-3) {
        const sd = (Math.atan2(Math.abs(y1 - y0), moved) * 180) / Math.PI;
        if (sd > res.maxSlopeDeg) {
          res.maxSlopeDeg = sd;
          res.maxSlopeAt = { x: r.x, z: r.z };
        }
      }
      res.maxStep = Math.max(res.maxStep, Math.abs(y1 - y0));
      res.distance += moved;
      res.time += dt;
      x = r.x;
      z = r.z;
      res.minY = Math.min(res.minY, y1);
      res.maxY = Math.max(res.maxY, y1);
      const d = Math.hypot(tgt.x - x, tgt.z - z);
      if (d < best - 0.05) {
        best = d;
        stall = 0;
      } else if (++stall > 90) {
        res.stuckAt = { id: tgt.id, x, z };
        return res;
      }
    }
    if (Math.hypot(tgt.x - x, tgt.z - z) > 1.2) {
      res.stuckAt = { id: tgt.id, x, z };
      return res;
    }
    res.reached.push(tgt.id);
  }
  return res;
}
