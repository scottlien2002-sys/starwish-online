/**
 * Stage 6 P2-1 星芽原野：植被擺放（純資料，不依賴 Babylon；固定種子，可重現、可單元測試）。
 *
 * 規則：
 * - 不放在主路、支線、河道、橋、Boss 戰鬥場、傳送門平台與通道、遺跡石階上
 * - 樹、岩石不放在練功區的戰鬥平地內（保留戰鬥空間）；草與花可以
 * - 樹木與大岩石有碰撞（樹幹／岩石半徑），離主路中線至少 4.9 公尺，不影響已驗收的路線
 * - 依各區生態決定密度與種類：林緣與外圍是森林、花丘粉色花、花田紫色花、營地與主路旁有櫻花
 */
import { createRng } from "../../core/rng.ts";
import { ARENA, MAIN_ROAD_HALF, MAP_HALF, PORTAL, POIS, RIVER_HALF, SIDE_PATHS, SIDE_ROAD_HALF, ZONES, type Vec2 } from "./layout.ts";
import { MAIN_PATH, makePolyline, nearestOnPolyline, smoothstep, type Collider, type StarsproutTerrain } from "./terrain.ts";

export type TreeKind = "broad" | "broadLight" | "cherry" | "pine";
export type SmallKind = "bush" | "bushFlower" | "rock" | "rockFlat";

export interface TreePlacement {
  kind: TreeKind;
  x: number;
  z: number;
  /** 樹幹底部高度（取周圍最低點，避免漂浮） */
  y: number;
  scale: number;
  rot: number;
}

export interface SmallPlacement {
  kind: SmallKind;
  x: number;
  z: number;
  y: number;
  scale: number;
  rot: number;
}

export interface TuftPlacement {
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  /** 顏色（乘在模型頂點色上） */
  r: number;
  g: number;
  b: number;
}

export interface VegetationOptions {
  /** 草的密度（每平方公尺） */
  grassDensity: number;
  /** 花的密度倍率 */
  flowerScale: number;
}

export const VEG_HQ: VegetationOptions = { grassDensity: 1.1, flowerScale: 1 };
export const VEG_LITE: VegetationOptions = { grassDensity: 0.5, flowerScale: 0.6 };

const SIDE_LINES = SIDE_PATHS.map((p) => makePolyline(p.points));
const PORTAL_LINE = makePolyline([
  { x: ARENA.x, z: ARENA.z },
  { x: PORTAL.x, z: PORTAL.z },
]);
const STAIRS = { x0: -2.4, x1: 2.4, z0: 41, z1: 55 };

export interface Clearance {
  main: number;
  side: number;
  river: number;
  /** 離戰鬥場中心 */
  arena: number;
  /** 離傳送門通道 */
  portal: number;
}

export function clearance(t: StarsproutTerrain, x: number, z: number): Clearance {
  let side = Infinity;
  for (const pl of SIDE_LINES) {
    if (x < pl.minX - 8 || x > pl.maxX + 8 || z < pl.minZ - 8 || z > pl.maxZ + 8) continue;
    side = Math.min(side, nearestOnPolyline(pl, x, z).d);
  }
  return {
    main: nearestOnPolyline(MAIN_PATH, x, z).d,
    side,
    river: t.river(x, z).d,
    arena: Math.hypot(x - ARENA.x, z - ARENA.z),
    portal: Math.min(nearestOnPolyline(PORTAL_LINE, x, z).d, Math.hypot(x - PORTAL.x, z - PORTAL.z) - PORTAL.r + 4),
  };
}

const inStairs = (x: number, z: number, pad: number): boolean => x > STAIRS.x0 - pad && x < STAIRS.x1 + pad && z > STAIRS.z0 - pad && z < STAIRS.z1 + pad;

/** 練功區、營地的戰鬥平地（0..1，1 = 中心） */
function fightArea(x: number, z: number): number {
  let k = 0;
  for (const zn of ZONES) {
    const d = Math.hypot(x - zn.x, z - zn.z);
    k = Math.max(k, 1 - smoothstep(zn.r * 0.75, zn.r + 1.5, d));
  }
  return k;
}

const zoneById = (id: string): Vec2 & { r: number } => {
  const z = ZONES.find((zn) => zn.id === id);
  if (!z) throw new Error(id);
  return z;
};
const gauss = (x: number, z: number, cx: number, cz: number, s: number): number => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (s * s));

/** 森林密度（0..1）：外圍、林緣、蘑菇林、西側、北方遺跡後方、溪流兩岸 */
export function forestDensity(t: StarsproutTerrain, x: number, z: number): number {
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const z02 = zoneById("02");
  let f = 0.05;
  f += 0.85 * smoothstep(66, 80, edge);
  f += 0.75 * gauss(x, z, z02.x - 6, z02.z - 2, 20) * smoothstep(z02.r * 0.75, z02.r + 3, Math.hypot(x - z02.x, z - z02.z));
  f += 0.8 * gauss(x, z, -78, -44, 12);
  f += 0.45 * gauss(x, z, -78, 0, 18);
  f += 0.4 * gauss(x, z, -60, 64, 16);
  f += 0.35 * gauss(x, z, 30, 66, 14);
  f += 0.35 * gauss(x, z, 66, -10, 16);
  f += 0.3 * gauss(x, z, -40, -76, 14);
  const rv = t.river(x, z).d;
  f += 0.25 * (1 - smoothstep(RIVER_HALF + 3, RIVER_HALF + 12, rv));
  return Math.min(1, f);
}

function treeKind(rng: () => number, x: number, z: number): TreeKind {
  const camp = Math.hypot(x + 56, z + 64);
  const hill = Math.hypot(x - 14, z + 12);
  const ruinsGate = Math.hypot(x, z - 48);
  if (camp < 26 || hill < 22 || ruinsGate < 18) return rng() < 0.65 ? "cherry" : "broadLight";
  const edge = Math.max(Math.abs(x), Math.abs(z));
  if (edge > 70 || (z > 50 && Math.abs(x) > 20)) return rng() < 0.55 ? "pine" : "broad";
  const r = rng();
  return r < 0.12 ? "cherry" : r < 0.55 ? "broad" : r < 0.85 ? "broadLight" : "pine";
}

/** 是否完全不能放東西（路、水、遺跡、傳送門） */
function blocked(c: Clearance, x: number, z: number, roadPad: number, sidePad: number, riverPad: number): boolean {
  if (c.main < MAIN_ROAD_HALF + roadPad) return true;
  if (c.side < SIDE_ROAD_HALF + sidePad) return true;
  if (c.river < RIVER_HALF + riverPad) return true;
  if (c.arena < ARENA.r + 2) return true;
  if (c.portal < 4.5) return true;
  if (inStairs(x, z, 1.5)) return true;
  return false;
}

export interface VegetationLayout {
  trees: TreePlacement[];
  smalls: SmallPlacement[];
  grass: TuftPlacement[];
  flowers: TuftPlacement[];
  colliders: Collider[];
}

/** 樹與岩石以「地表最低點」當底部，避免在斜坡上漂浮 */
function baseY(t: StarsproutTerrain, x: number, z: number, r: number): number {
  let y = t.height(x, z);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    y = Math.min(y, t.height(x + Math.cos(a) * r, z + Math.sin(a) * r));
  }
  return y;
}

export function buildVegetation(t: StarsproutTerrain, opt: VegetationOptions, seed = 20261122): VegetationLayout {
  const rng = createRng(seed);
  const trees: TreePlacement[] = [];
  const smalls: SmallPlacement[] = [];
  const colliders: Collider[] = [];

  // ---------- 樹（間距 ≥ 3.6 公尺，空間雜湊） ----------
  const cell = 4;
  const grid = new Map<string, TreePlacement[]>();
  const key = (x: number, z: number): string => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const near = (x: number, z: number, d: number): boolean => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const p of grid.get(`${cx + i},${cz + j}`) ?? []) if (Math.hypot(p.x - x, p.z - z) < d * Math.max(1, (p.scale + 1) / 2)) return true;
    }
    return false;
  };
  const LIMIT = MAP_HALF - 2;
  for (let n = 0; n < 9000; n++) {
    const x = rng.range(-LIMIT, LIMIT);
    const z = rng.range(-LIMIT, LIMIT);
    const f = forestDensity(t, x, z);
    if (rng.next() > f) continue;
    const c = clearance(t, x, z);
    if (blocked(c, x, z, 3.2, 2.2, 2.6)) continue;
    if (fightArea(x, z) > 0.05) continue;
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const slope = t.terrainSlopeDeg(x, z);
    if (slope > (edge > 82 ? 38 : 26)) continue;
    if (near(x, z, 3.6)) continue;
    const kind = treeKind(() => rng.next(), x, z);
    const scale = kind === "pine" ? rng.range(0.9, 1.35) : rng.range(0.85, 1.25);
    const tp: TreePlacement = { kind, x, z, y: baseY(t, x, z, 0.5 * scale) - 0.05, scale, rot: rng.range(0, Math.PI * 2) };
    trees.push(tp);
    const k = key(x, z);
    grid.set(k, [...(grid.get(k) ?? []), tp]);
    // 可行走範圍內的樹有碰撞（樹幹）
    if (edge < 84) colliders.push({ kind: "tree", x, z, r: 0.42 * scale });
  }

  // ---------- 灌木（樹邊、路邊）與岩石（坡地、河岸、遺跡周圍） ----------
  for (let n = 0; n < 7000; n++) {
    const x = rng.range(-LIMIT, LIMIT);
    const z = rng.range(-LIMIT, LIMIT);
    const c = clearance(t, x, z);
    const slope = t.terrainSlopeDeg(x, z);
    const f = forestDensity(t, x, z);
    const roadEdge = c.main < MAIN_ROAD_HALF + 4 || c.side < SIDE_ROAD_HALF + 3;
    const bank = c.river < RIVER_HALF + 5;
    const ruins = c.arena < ARENA.r + 9;
    const rockish = slope > 20 || bank || ruins;
    const pBush = 0.05 + f * 0.35 + (roadEdge ? 0.12 : 0);
    const pRock = rockish ? 0.25 : 0.02;
    const r = rng.next();
    const isRock = r < pRock;
    const isBush = !isRock && r < pRock + pBush;
    if (!isRock && !isBush) continue;
    if (blocked(c, x, z, isRock ? 2.4 : 1.4, isRock ? 1.6 : 0.9, isRock ? 0.8 : 2)) continue;
    if (fightArea(x, z) > (isRock ? 0.05 : 0.3)) continue;
    if (slope > 34) continue;
    if (smalls.some((s) => Math.abs(s.x - x) < 2.2 && Math.abs(s.z - z) < 2.2)) continue;
    if (trees.some((tp) => Math.abs(tp.x - x) < 1.6 && Math.abs(tp.z - z) < 1.6)) continue;
    const kind: SmallKind = isRock ? (rng.next() < 0.45 ? "rockFlat" : "rock") : rng.next() < 0.3 ? "bushFlower" : "bush";
    const scale = isRock ? rng.range(0.6, 1.5) : rng.range(0.7, 1.3);
    smalls.push({ kind, x, z, y: baseY(t, x, z, 0.35 * scale) - (isRock ? 0.12 : 0.04), scale, rot: rng.range(0, Math.PI * 2) });
    if (isRock && scale > 0.9 && Math.max(Math.abs(x), Math.abs(z)) < 84) colliders.push({ kind: "rock", x, z, r: 0.5 * scale });
    if (smalls.length > 900) break;
  }

  // ---------- 草叢（抖動網格；依區域調整高度與色調） ----------
  const grass: TuftPlacement[] = [];
  const step = 1 / Math.sqrt(opt.grassDensity);
  for (let gz = -LIMIT; gz < LIMIT; gz += step) {
    for (let gx = -LIMIT; gx < LIMIT; gx += step) {
      const x = gx + rng.range(-0.45, 0.45) * step;
      const z = gz + rng.range(-0.45, 0.45) * step;
      const c = clearance(t, x, z);
      if (blocked(c, x, z, 0.35, 0.25, 0.5)) continue;
      const slope = t.terrainSlopeDeg(x, z);
      if (slope > 38) continue;
      const camp = Math.hypot(x + 56, z + 64);
      // 營地中央、戰鬥平地中心草比較稀
      const thin = Math.max(camp < 8 ? 0.7 : 0, fightArea(x, z) * 0.35);
      if (rng.next() < thin) continue;
      const f = forestDensity(t, x, z);
      const tall = 0.75 + f * 0.6 + rng.range(-0.15, 0.25);
      const v = rng.range(-0.06, 0.06);
      // 色調：森林偏深綠、開闊地偏嫩綠、高處偏黃綠
      const h = t.height(x, z);
      const r = 0.82 + v - f * 0.18 + Math.min(0.1, h * 0.006);
      const g = 0.98 + v * 0.5 - f * 0.12;
      const b = 0.72 + v - f * 0.1;
      grass.push({ x, z, y: t.height(x, z) - 0.04, rot: rng.range(0, Math.PI * 2), scale: tall, r, g, b });
    }
  }

  // ---------- 花（花丘粉白、花田紫、南側花海混色、路邊與營地零星黃白、櫻花樹下粉色） ----------
  const flowers: TuftPlacement[] = [];
  const PINK: [number, number, number] = [1, 0.66, 0.82];
  const WHITE: [number, number, number] = [1, 0.98, 0.95];
  const LAV: [number, number, number] = [0.78, 0.62, 1];
  const VIOLET: [number, number, number] = [0.62, 0.5, 0.95];
  const YELLOW: [number, number, number] = [1, 0.9, 0.42];
  const SKY: [number, number, number] = [0.7, 0.85, 1];
  const hill = zoneById("03");
  const field = zoneById("05");
  const sea = POIS.find((p) => p.id === "flowers")!;
  const cherries = trees.filter((tp) => tp.kind === "cherry");
  const fstep = 0.75;
  for (let gz = -LIMIT; gz < LIMIT; gz += fstep) {
    for (let gx = -LIMIT; gx < LIMIT; gx += fstep) {
      const x = gx + rng.range(-0.45, 0.45) * fstep;
      const z = gz + rng.range(-0.45, 0.45) * fstep;
      const dh = Math.hypot(x - hill.x, z - hill.z) / (hill.r + 6);
      const df = Math.hypot(x - field.x, z - field.z) / (field.r + 6);
      const ds = Math.hypot(x - sea.x, z - sea.z) / 16;
      let p = 0.04;
      let palette: [number, number, number][] = [YELLOW, WHITE, SKY];
      if (dh < 1) {
        p = 0.8 * (1 - dh * dh * 0.7);
        palette = [PINK, PINK, WHITE];
      } else if (df < 1) {
        p = 0.85 * (1 - df * df * 0.7);
        palette = [LAV, VIOLET, LAV, WHITE];
      } else if (ds < 1) {
        p = 0.8 * (1 - ds * ds * 0.7);
        palette = [PINK, YELLOW, WHITE, LAV, SKY];
      } else {
        for (const ch of cherries) {
          const d = Math.hypot(x - ch.x, z - ch.z);
          if (d < 3.2) {
            p = 0.3;
            palette = [PINK, WHITE];
            break;
          }
        }
      }
      if (rng.next() > p * opt.flowerScale) continue;
      const c = clearance(t, x, z);
      if (blocked(c, x, z, 0.4, 0.3, 0.8)) continue;
      if (t.terrainSlopeDeg(x, z) > 32) continue;
      const col = palette[Math.floor(rng.next() * palette.length)]!;
      const v = rng.range(-0.05, 0.03);
      flowers.push({ x, z, y: t.height(x, z) - 0.02, rot: rng.range(0, Math.PI * 2), scale: rng.range(0.75, 1.25), r: col[0] + v, g: col[1] + v, b: col[2] + v });
    }
  }
  return { trees, smalls, grass, flowers, colliders };
}
