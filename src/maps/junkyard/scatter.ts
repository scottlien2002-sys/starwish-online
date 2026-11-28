/**
 * 星廢垃圾場：重複垃圾物件與植被的擺放（純邏輯、可重現；不依賴 Babylon）。
 *
 * 規則（避免「走過木箱」「垃圾擋路」）：
 * - 垃圾山上的垃圾：只放在不可走的陡坡（坡度 > 35°）或高處，不需要碰撞
 * - 可走地面的碎屑：只放扁平小件（鐵板、齒輪、輪胎、石塊、彈簧），縮放 ≤ 0.9，可踩過
 * - 高的物件（木箱、油桶、罐子、舊電視）集中成「垃圾堆」，每堆一個碰撞圓（buildColliders 會加入）
 * - 全部避開主路線、坡道、橋、階梯、碰撞物、水面、Boss 戰鬥廣場、入口傳送陣
 * - 依「串流分區」分組：玩家靠近時才建立該區的實例，遠離時釋放
 */
import { ARENA, BASINS, DECKS, JUNKYARD_ENTRY_PORTAL, MAIN_ROUTE, MOUNDS, RAMPS, REACTOR, SPAWNS, ZONES, type Vec2 } from "./layout.ts";
import { polyDist, rng, segDist } from "./geom.ts";

export type ScatterJunk = "can" | "crate" | "barrel" | "tire" | "gear" | "plate" | "tv" | "pipe" | "rock" | "spring";
// 7 種（每區每種 1 次繪製；種類少＝Draw Calls 少）
const FLAT: readonly ScatterJunk[] = ["plate", "gear", "tire", "rock", "plate"];
const TALL: readonly ScatterJunk[] = ["crate", "barrel", "can", "crate", "barrel", "tire"];
const ALL: readonly ScatterJunk[] = ["can", "crate", "barrel", "tire", "gear", "plate", "rock", "gear", "plate", "can", "crate"];

export interface Inst {
  x: number;
  y: number;
  z: number;
  /** 旋轉（弧度） */
  rx: number;
  ry: number;
  rz: number;
  s: number;
  /** 顏色倍率（實例色） */
  c: [number, number, number];
  /** 地面小碎屑（可依距離漸變減少；垃圾山／垃圾堆本體不標） */
  small?: true;
}

export interface Pile extends Vec2 {
  id: string;
  r: number;
  items: { type: ScatterJunk; inst: Inst }[];
}

export interface StreamCell extends Vec2 {
  id: string;
  r: number;
}

/** 串流分區：四大區域＋入口＋中央窪地 */
export const STREAM_CELLS: readonly StreamCell[] = [
  ...ZONES.map((z) => ({ id: z.id as string, x: z.x, z: z.z, r: z.r })),
  { id: "central", x: 8, z: -14, r: 44 },
];

export function cellOf(x: number, z: number): string {
  let best = STREAM_CELLS[0]!;
  let bd = Infinity;
  for (const c of STREAM_CELLS) {
    const d = Math.hypot(x - c.x, z - c.z) - c.r * 0.35;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best.id;
}

export interface ScatterTier {
  /** 垃圾山上的件數倍率 */
  mound: number;
  /** 地面碎屑件數 */
  debris: number;
  tufts: number;
  flowers: number;
}

export const SCATTER_TIERS: Readonly<Record<"high" | "medium" | "low", ScatterTier>> = {
  high: { mound: 1.3, debris: 520, tufts: 2400, flowers: 700 },
  medium: { mound: 0.6, debris: 300, tufts: 1300, flowers: 400 },
  low: { mound: 0.4, debris: 180, tufts: 700, flowers: 200 },
};

export interface ScatterResult {
  junk: Map<string, Map<ScatterJunk, Inst[]>>;
  tufts: Map<string, Inst[]>;
  flowers: Map<string, Inst[]>;
  piles: Pile[];
  counts: { mound: number; debris: number; pileItems: number; tufts: number; flowers: number };
}

type HeightFn = (x: number, z: number) => number;
type BlockFn = (x: number, z: number, pad: number) => boolean;

const routeDist = (x: number, z: number): number => polyDist(x, z, MAIN_ROUTE);

/** 共同排除：路線、坡道、橋、水、戰鬥廣場、傳送陣、地圖邊緣 */
export function excluded(x: number, z: number, pad: number, routePad = 3.4): boolean {
  if (Math.abs(x) > 133 || Math.abs(z) > 133) return true;
  if (routeDist(x, z) < routePad + pad) return true;
  for (const d of DECKS) {
    const s = segDist(x, z, d.a.x, d.a.z, d.b.x, d.b.z);
    if (s.t > -0.15 && s.t < 1.15 && s.d < d.w / 2 + 1.6 + pad) return true;
  }
  for (const r of RAMPS) if (segDist(x, z, r.a.x, r.a.z, r.b.x, r.b.z).d < r.w / 2 + 1.2 + pad) return true;
  for (const b of BASINS) if (polyDist(x, z, b.pts) < b.r + 1 + pad) return true;
  if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r + 1.5 + pad) return true;
  if (Math.hypot(x - REACTOR.x, z - REACTOR.z) < REACTOR.r + 3 + pad) return true;
  if (Math.hypot(x - JUNKYARD_ENTRY_PORTAL.x, z - JUNKYARD_ENTRY_PORTAL.z) < 8 + pad) return true;
  return false;
}

function slopeAt(h: HeightFn, x: number, z: number): number {
  const e = 0.6;
  const dx = (h(x + e, z) - h(x - e, z)) / (2 * e);
  const dz = (h(x, z + e) - h(x, z - e)) / (2 * e);
  return Math.hypot(dx, dz);
}

const TINTS: readonly [number, number, number][] = [
  [1, 1, 1],
  [1.05, 0.92, 0.85],
  [0.9, 1, 1.05],
  [1.1, 1, 0.8],
  [0.85, 0.95, 0.85],
  [1.08, 0.86, 0.95],
];

/**
 * 擺放全部垃圾與植被。
 * @param h 地形高度（groundHeight）
 * @param blocked 碰撞物檢查（固定碰撞物；不含垃圾堆本身）
 */
export function scatterAll(h: HeightFn, blocked: BlockFn, tier: ScatterTier): ScatterResult {
  const junk = new Map<string, Map<ScatterJunk, Inst[]>>();
  const tufts = new Map<string, Inst[]>();
  const flowers = new Map<string, Inst[]>();
  const counts = { mound: 0, debris: 0, pileItems: 0, tufts: 0, flowers: 0 };
  const push = (type: ScatterJunk, inst: Inst): void => {
    const cell = cellOf(inst.x, inst.z);
    let m = junk.get(cell);
    if (!m) {
      m = new Map();
      junk.set(cell, m);
    }
    let a = m.get(type);
    if (!a) {
      a = [];
      m.set(type, a);
    }
    a.push(inst);
  };
  const MAX_TAN = Math.tan((35 * Math.PI) / 180);

  // ---- 1. 垃圾山上的垃圾（只放陡坡／高處） ----
  const r1 = rng(20261128);
  for (const m of MOUNDS) {
    if (m.kind !== "junk") continue;
    const n = Math.round(m.h * m.s * 0.42 * tier.mound);
    for (let i = 0; i < n; i++) {
      const a = r1() * Math.PI * 2;
      const rr = Math.sqrt(r1()) * m.s * 2.1;
      const x = m.x + Math.cos(a) * rr;
      const z = m.z + Math.sin(a) * rr;
      if (Math.abs(x) > 148 || Math.abs(z) > 148) continue;
      if (excluded(x, z, 0.5, 4)) continue;
      const gh = m.h * Math.exp(-(rr * rr) / (2 * m.s * m.s));
      if (slopeAt(h, x, z) <= MAX_TAN * 1.02 && gh < 2.5) continue;
      if (blocked(x, z, 0.8)) continue;
      // 垃圾山上的垃圾放大（遠看要像一座座廢料堆，不是散落的小東西）；畫質越低件數越少、單件越大
      const big = (m.h > 20 ? 1.9 : 1.25) / Math.sqrt(Math.max(0.5, tier.mound));
      const s = (1.0 + r1() * 1.8) * big;
      const type = ALL[Math.floor(r1() * ALL.length)]!;
      push(type, {
        x,
        y: h(x, z) - 0.15 * s,
        z,
        rx: (r1() - 0.5) * 1.2,
        ry: r1() * Math.PI * 2,
        rz: (r1() - 0.5) * 1.2,
        s,
        c: TINTS[Math.floor(r1() * TINTS.length)]!,
      });
      counts.mound++;
    }
  }

  // ---- 2. 地面碎屑（扁平小件；可踩過） ----
  const r2 = rng(777);
  let tries = 0;
  while (counts.debris < tier.debris && tries++ < tier.debris * 30) {
    const x = (r2() * 2 - 1) * 130;
    const z = (r2() * 2 - 1) * 130;
    if (excluded(x, z, 0, 2)) continue;
    if (slopeAt(h, x, z) > MAX_TAN * 0.9) continue;
    if (blocked(x, z, 0.6)) continue;
    const s = 0.45 + r2() * 0.45;
    const type = FLAT[Math.floor(r2() * FLAT.length)]!;
    push(type, { x, y: h(x, z) - 0.03, z, rx: (r2() - 0.5) * 0.25, ry: r2() * Math.PI * 2, rz: (r2() - 0.5) * 0.25, s, c: TINTS[Math.floor(r2() * TINTS.length)]!, small: true });
    counts.debris++;
  }

  // ---- 3. 垃圾堆（高物件集中、有碰撞）：每個區域固定數量，避開怪物出生區中心 ----
  const piles: Pile[] = [];
  const PILE_COUNTS: Record<string, number> = { entry: 4, hills: 16, central: 9, recycle: 12, factory: 10, core: 4 };
  const r3 = rng(4242);
  for (const cell of STREAM_CELLS) {
    const want = PILE_COUNTS[cell.id] ?? 0;
    let made = 0;
    let t = 0;
    while (made < want && t++ < 600) {
      const a = r3() * Math.PI * 2;
      const rr = Math.sqrt(r3()) * cell.r;
      const x = cell.x + Math.cos(a) * rr;
      const z = cell.z + Math.sin(a) * rr;
      if (cellOf(x, z) !== cell.id) continue;
      const pr = 1.3 + r3() * 1.1;
      if (excluded(x, z, pr + 0.6, 3.6)) continue;
      if (blocked(x, z, pr + 0.8)) continue;
      // 垃圾堆完全不放進怪物出生區（保留完整戰鬥空間）
      if (SPAWNS.some((s) => Math.hypot(x - s.x, z - s.z) < s.r + pr + 1)) continue;
      if (piles.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + pr + 3)) continue;
      // 堆放處要大致平坦（避免浮空）
      if (slopeAt(h, x, z) > 0.35) continue;
      const items: Pile["items"] = [];
      const n = 4 + Math.floor(r3() * 5);
      for (let i = 0; i < n; i++) {
        const ia = r3() * Math.PI * 2;
        const ir = r3() * pr * 0.75;
        const ix = x + Math.cos(ia) * ir;
        const iz = z + Math.sin(ia) * ir;
        const type = TALL[Math.floor(r3() * TALL.length)]!;
        const s = 0.75 + r3() * 0.5;
        // 中間的物件疊高一點
        const stack = ir < pr * 0.3 && i > 0 ? 0.85 * s : 0;
        items.push({ type, inst: { x: ix, y: h(ix, iz) + stack - 0.04, z: iz, rx: (r3() - 0.5) * 0.18, ry: r3() * Math.PI * 2, rz: (r3() - 0.5) * 0.18, s, c: TINTS[Math.floor(r3() * TINTS.length)]! } });
      }
      piles.push({ id: `pile-${cell.id}-${made}`, x, z, r: pr, items });
      for (const it of items) push(it.type, it.inst);
      counts.pileItems += items.length;
      made++;
    }
  }

  // ---- 4. 草叢與小花（低地與山丘；高台只在邊緣） ----
  const r4 = rng(9001);
  const addVeg = (map: Map<string, Inst[]>, inst: Inst): void => {
    const cell = cellOf(inst.x, inst.z);
    let a = map.get(cell);
    if (!a) {
      a = [];
      map.set(cell, a);
    }
    a.push(inst);
  };
  const vegOk = (x: number, z: number): boolean => {
    if (excluded(x, z, 0, 2.2)) return false;
    const y = h(x, z);
    if (y > 12) return false; // 工廠高台、核心熔煉場（金屬地面）不長草
    if (y > 5 && y < 7 && Math.abs(x + 72) < 36 && Math.abs(z + 18) < 32) return r4() < 0.18; // 回收平台：少量
    if (slopeAt(h, x, z) > MAX_TAN) return false;
    return !blocked(x, z, 0.3);
  };
  tries = 0;
  while (counts.tufts < tier.tufts && tries++ < tier.tufts * 20) {
    // 草叢成簇：先選中心再散開
    const cx = (r4() * 2 - 1) * 128;
    const cz = (r4() * 2 - 1) * 128;
    if (!vegOk(cx, cz)) continue;
    const k = 3 + Math.floor(r4() * 6);
    for (let i = 0; i < k && counts.tufts < tier.tufts; i++) {
      const x = cx + (r4() - 0.5) * 4;
      const z = cz + (r4() - 0.5) * 4;
      if (!vegOk(x, z)) continue;
      addVeg(tufts, { x, y: h(x, z) - 0.02, z, rx: 0, ry: r4() * Math.PI, rz: 0, s: 0.6 + r4() * 0.7, c: [0.85 + r4() * 0.3, 0.9 + r4() * 0.2, 0.8 + r4() * 0.2] });
      counts.tufts++;
    }
  }
  const FLOWER: readonly [number, number, number][] = [
    [1, 0.85, 0.35],
    [1, 0.6, 0.75],
    [0.75, 0.6, 1],
    [1, 1, 0.95],
    [0.55, 0.8, 1],
  ];
  tries = 0;
  while (counts.flowers < tier.flowers && tries++ < tier.flowers * 30) {
    const x = (r4() * 2 - 1) * 128;
    const z = (r4() * 2 - 1) * 128;
    if (!vegOk(x, z)) continue;
    addVeg(flowers, { x, y: h(x, z) + 0.02, z, rx: 0, ry: r4() * Math.PI * 2, rz: 0, s: 0.7 + r4() * 0.6, c: FLOWER[Math.floor(r4() * FLOWER.length)]! });
    counts.flowers++;
  }

  return { junk, tufts, flowers, piles, counts };
}

/** 垃圾堆碰撞（與高畫質擺放相同的垃圾堆位置；畫質只影響垃圾山與植被數量，不影響垃圾堆與碰撞） */
export function pileColliders(h: HeightFn, blocked: BlockFn): { id: string; x: number; z: number; r: number }[] {
  return scatterAll(h, blocked, { mound: 0, debris: 0, tufts: 0, flowers: 0 }).piles.map((p) => ({ id: p.id, x: p.x, z: p.z, r: p.r + 0.2 }));
}
