/**
 * 地表顏色（頂點色，純函式）：草地、各區生態色、石板主路、泥土支線、河岸、懸崖岩壁。
 * 第一階段是「地形與路線」的暫代上色，正式草花樹木與貼圖在第三階段製作。
 */
import { ARENA, MAIN_ROAD_HALF, PORTAL, RIVER_HALF, SIDE_PATHS, SIDE_ROAD_HALF, ZONES } from "./layout.ts";
import { MAIN_PATH, makePolyline, nearestOnPolyline, smoothstep, type StarsproutTerrain } from "./terrain.ts";

type RGB = [number, number, number];

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const GRASS_LOW: RGB = [0.5, 0.8, 0.38];
const GRASS_HIGH: RGB = [0.66, 0.86, 0.45];
const ROCK: RGB = [0.68, 0.62, 0.58];
const ROAD: RGB = [0.93, 0.86, 0.7];
const ROAD_DARK: RGB = [0.84, 0.76, 0.6];
const CURB: RGB = [0.74, 0.68, 0.6];
const DIRT: RGB = [0.8, 0.66, 0.47];
const SAND: RGB = [0.88, 0.82, 0.64];
const BED: RGB = [0.5, 0.6, 0.56];
const STONE: RGB = [0.86, 0.83, 0.78];
const NAV_BLOCK: RGB = [0.95, 0.25, 0.25];

interface ZoneTint {
  color: RGB;
  strength: number;
  /** 斑點花色（花丘、花田）：第二種顏色 */
  speckle?: RGB;
  /** 田壟條紋（胡蘿蔔園） */
  rows?: RGB;
}

const ZONE_TINT: Record<string, ZoneTint> = {
  camp: { color: [0.88, 0.8, 0.62], strength: 0.6 },
  "01": { color: [0.6, 0.9, 0.52], strength: 0.4 },
  "02": { color: [0.34, 0.6, 0.32], strength: 0.55 },
  "03": { color: [0.62, 0.86, 0.5], strength: 0.4, speckle: [0.98, 0.72, 0.84] },
  "04": { color: [0.55, 0.82, 0.6], strength: 0.4, speckle: [0.85, 0.92, 1] },
  "05": { color: [0.62, 0.8, 0.5], strength: 0.4, speckle: [0.76, 0.62, 0.95] },
  "06": { color: [0.66, 0.48, 0.32], strength: 0.85, rows: [0.45, 0.72, 0.35] },
  "07": { color: STONE, strength: 1 },
};

const SIDE_LINES = SIDE_PATHS.map((p) => makePolyline(p.points));
const PORTAL_LINE = makePolyline([
  { x: ARENA.x, z: ARENA.z },
  { x: PORTAL.x, z: PORTAL.z },
]);

export function terrainColor(t: StarsproutTerrain, x: number, z: number, nav = false): RGB {
  const h = t.height(x, z);
  const patch = 0.5 + 0.5 * Math.sin(x * 0.21 + 0.3) * Math.sin(z * 0.17 - 0.2);
  const fine = 0.5 + 0.5 * Math.sin(x * 1.7 + z * 1.3) * Math.sin(x * 0.9 - z * 2.1);
  let c = mix(GRASS_LOW, GRASS_HIGH, Math.min(1, Math.max(0, (h - 2) / 14)) * 0.8 + patch * 0.2);
  c = mix(c, [c[0] * 0.92, c[1] * 0.95, c[2] * 0.9], fine * 0.5);

  // 各區生態色
  for (const zn of ZONES) {
    const d = Math.hypot(x - zn.x, z - zn.z);
    if (d > zn.r + 3) continue;
    const tint = ZONE_TINT[zn.id];
    if (!tint) continue;
    const k = tint.strength * (1 - smoothstep(zn.r * 0.6, zn.r + 3, d));
    let zc = tint.color;
    if (tint.speckle) zc = mix(zc, tint.speckle, smoothstep(0.55, 0.85, fine) * 0.9);
    if (tint.rows) zc = mix(zc, tint.rows, Math.sin((x + z * 0.15) * 2.4) > 0.55 ? 0.85 : 0);
    c = mix(c, zc, k);
  }

  // 傳送門平台與通道（石板）
  {
    const pd = nearestOnPolyline(PORTAL_LINE, x, z).d;
    const qd = Math.hypot(x - PORTAL.x, z - PORTAL.z);
    const k = Math.max(1 - smoothstep(2.5, 3.5, pd), 1 - smoothstep(PORTAL.r - 1, PORTAL.r, qd));
    if (k > 0) c = mix(c, STONE, k);
  }

  // 懸崖、陡坡：岩壁色
  const slope = t.terrainSlopeDeg(x, z);
  c = mix(c, ROCK, smoothstep(24, 38, slope));

  // 支線（泥土）
  for (const pl of SIDE_LINES) {
    if (x < pl.minX - 3 || x > pl.maxX + 3 || z < pl.minZ - 3 || z > pl.maxZ + 3) continue;
    const hit = nearestOnPolyline(pl, x, z);
    c = mix(c, DIRT, 1 - smoothstep(SIDE_ROAD_HALF - 0.2, SIDE_ROAD_HALF + 0.5, hit.d));
  }
  // 主路（石板路＋路緣）
  {
    const hit = nearestOnPolyline(MAIN_PATH, x, z);
    if (hit.d < MAIN_ROAD_HALF + 0.6) {
      const tile = Math.sin(hit.s * 1.9) * Math.sin(hit.d * 2.6 + 0.8) > 0.25 ? 1 : 0;
      const road = mix(ROAD, ROAD_DARK, tile * 0.6);
      const curb = smoothstep(MAIN_ROAD_HALF - 0.35, MAIN_ROAD_HALF, hit.d);
      c = mix(c, mix(road, CURB, curb), 1 - smoothstep(MAIN_ROAD_HALF, MAIN_ROAD_HALF + 0.5, hit.d));
    }
  }

  // 溪流：河床與沙岸
  const rv = t.river(x, z);
  if (rv.d < RIVER_HALF + 2) {
    c = mix(c, SAND, 1 - smoothstep(RIVER_HALF + 0.6, RIVER_HALF + 2, rv.d));
    c = mix(c, BED, 1 - smoothstep(RIVER_HALF - 1.2, RIVER_HALF, rv.d));
  }

  if (nav && !t.walkable(x, z) && rv.d >= RIVER_HALF) c = mix(c, NAV_BLOCK, 0.6);
  return c;
}
