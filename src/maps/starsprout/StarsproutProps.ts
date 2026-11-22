import { Color3, Constants, Mesh, MeshBuilder, type Scene, type ShadowGenerator, Sprite, SpriteManager, StandardMaterial } from "@babylonjs/core";
import { CAMP_CENTER, FARM_CENTER, PROPS, type PropKind, type PropPlacement } from "./props.ts";
import { bake, geoOf, joinGeo, type Geo, type Placed } from "./StarsproutVegetation.ts";
import type { StarsproutTerrain } from "./terrain.ts";
import type { MapLod } from "./StarsproutWorld.ts";

/**
 * Stage 6 P2-2：新手營地與胡蘿蔔園（畫面層）。
 * 每個區域合併成「大型」與「細節」兩個網格（共用一個頂點色材質）＋所有營火火焰與燈籠玻璃 1 個自發光網格
 * ＋暖色光暈 1 個 SpriteManager → 近處共 6 次繪製；遠處只剩大型網格。
 * 不使用真實點光源（會讓全場每個材質多算一盞燈）；火焰與燈籠不進發光層，避免過曝。
 */

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const noise = (x: number, y: number, z: number): number => Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 0.5 + 0.5;

const WOOD: RGB = [0.72, 0.52, 0.33];
const WOOD_DARK: RGB = [0.5, 0.35, 0.23];
const WOOD_LIGHT: RGB = [0.84, 0.66, 0.44];
const CREAM: RGB = [0.97, 0.93, 0.84];
const PURPLE: RGB = [0.55, 0.45, 0.85];
const BLUE: RGB = [0.45, 0.58, 0.9];
const GOLD: RGB = [0.96, 0.8, 0.4];
const STONE: RGB = [0.72, 0.71, 0.76];
const SOIL: RGB = [0.5, 0.34, 0.22];

function box(scene: Scene, w: number, h: number, d: number, x: number, y: number, z: number, col: RGB | ((x: number, y: number, z: number, ny: number) => RGB), rx = 0, ry = 0, rz = 0): Geo {
  const m = MeshBuilder.CreateBox("PH_propTmp", { width: w, height: h, depth: d }, scene);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return geoOf(m, (px, py, pz, _nx, ny) => {
    const c = typeof col === "function" ? col(px, py, pz, ny) : col;
    // 頂面亮一點、底面暗一點，木紋小雜訊
    const k = (ny > 0.5 ? 1.08 : ny < -0.5 ? 0.8 : 1) * (0.95 + noise(px, py, pz) * 0.1);
    return shade(c, k);
  });
}

function cyl(scene: Scene, dTop: number, dBot: number, h: number, tess: number, x: number, y: number, z: number, col: RGB | ((x: number, y: number, z: number, ny: number) => RGB), rx = 0, ry = 0, rz = 0, cap = true): Geo {
  const m = MeshBuilder.CreateCylinder("PH_propTmp", { diameterTop: dTop, diameterBottom: dBot, height: h, tessellation: tess, cap: cap ? Mesh.CAP_ALL : Mesh.NO_CAP }, scene);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return geoOf(m, (px, py, pz, _nx, ny) => {
    const c = typeof col === "function" ? col(px, py, pz, ny) : col;
    return shade(c, (ny > 0.5 ? 1.06 : 1) * (0.96 + noise(px, py, pz) * 0.08));
  });
}

function sphere(scene: Scene, d: number, seg: number, x: number, y: number, z: number, col: RGB, sy = 1): Geo {
  const m = MeshBuilder.CreateSphere("PH_propTmp", { diameter: d, segments: seg }, scene);
  m.position.set(x, y, z);
  m.scaling.y = sy;
  return geoOf(m, (_x, _y, _z, _nx, ny) => shade(col, 0.88 + Math.max(0, ny) * 0.18));
}

/** 條紋布（帳篷、屋頂）：每一條是獨立的弧面，顏色邊界清楚，不會互相漸層 */
function stripedCone(scene: Scene, dTop: number, dBot: number, h: number, y: number, n: number, a: RGB, b: RGB): Geo {
  const parts: Geo[] = [];
  for (let k = 0; k < n; k++) {
    const m = MeshBuilder.CreateCylinder("PH_propTmp", { diameterTop: dTop, diameterBottom: dBot, height: h, tessellation: n * 2, arc: 1 / n, cap: Mesh.NO_CAP, enclose: false }, scene);
    m.position.y = y;
    m.rotation.y = (k / n) * Math.PI * 2;
    const col = k % 2 ? a : b;
    parts.push(geoOf(m, (px, py, pz, _nx, ny) => shade(col, (0.94 + Math.max(0, ny) * 0.12) * (0.97 + noise(px, py, pz) * 0.06))));
  }
  return joinGeo(parts);
}

// ---------------- 各種物件（本地座標：正面朝 +Z、底部在 y=0） ----------------
function pavilion(scene: Scene): Geo {
  const parts: Geo[] = [];
  parts.push(stripedCone(scene, 5.2, 5.2, 1.6, 0.8, 12, CREAM, [0.9, 0.86, 0.97]));
  // 屋頂：紫／奶油條紋，下緣金邊
  parts.push(stripedCone(scene, 0.35, 6.1, 2.3, 1.6 + 1.15, 10, PURPLE, CREAM));
  parts.push(cyl(scene, 6.05, 6.2, 0.2, 24, 0, 1.68, 0, GOLD, 0, 0, 0, false));
  parts.push(cyl(scene, 0.05, 0.3, 0.6, 8, 0, 4.1, 0, GOLD));
  parts.push(box(scene, 0.04, 0.5, 0.75, 0.38, 4.35, 0, PURPLE));
  // 入口（深色門洞＋兩片掀起的門簾）與門上金色星徽
  parts.push(box(scene, 1.3, 1.35, 0.06, 0, 0.68, 2.6, [0.32, 0.24, 0.24]));
  for (const s of [-1, 1]) parts.push(box(scene, 0.45, 1.3, 0.05, s * 0.85, 0.72, 2.62, PURPLE, 0, 0, s * 0.12));
  parts.push(cyl(scene, 0.55, 0.55, 0.05, 5, 0, 1.5, 2.64, GOLD, Math.PI / 2));
  return joinGeo(parts);
}

function tent(scene: Scene, color: RGB): Geo {
  const parts: Geo[] = [];
  parts.push(stripedCone(scene, 0.12, 3.4, 2.6, 1.3, 8, color, CREAM));
  parts.push(sphere(scene, 0.22, 4, 0, 2.65, 0, GOLD));
  parts.push(box(scene, 0.85, 1.15, 0.05, 0, 0.58, 1.5, [0.3, 0.24, 0.26], -0.48));
  // 營釘拉繩的木樁
  for (const a of [0.8, 2.4, 3.9, 5.5]) parts.push(box(scene, 0.07, 0.3, 0.07, Math.sin(a) * 2.1, 0.12, Math.cos(a) * 2.1, WOOD_DARK));
  return joinGeo(parts);
}

const plankBands = (base: RGB) => (_x: number, y: number): RGB => (Math.abs(((y * 6) % 1) - 0.5) < 0.06 ? shade(base, 0.78) : base);

function crate(scene: Scene): Geo {
  const parts: Geo[] = [box(scene, 0.8, 0.78, 0.8, 0, 0.39, 0, plankBands(WOOD))];
  for (const y of [0.06, 0.72]) parts.push(box(scene, 0.84, 0.08, 0.84, 0, y, 0, WOOD_DARK));
  for (const [x, z] of [[-0.39, -0.39], [0.39, -0.39], [-0.39, 0.39], [0.39, 0.39]] as const) parts.push(box(scene, 0.07, 0.8, 0.07, x, 0.4, z, WOOD_DARK));
  return joinGeo(parts);
}

function crateStack(scene: Scene): Geo {
  const c = crate(scene);
  const move = (g: Geo, dx: number, dy: number, dz: number, rot: number): Geo => {
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const positions = g.positions.slice();
    const normals = g.normals.slice();
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i]!;
      const z = positions[i + 2]!;
      positions[i] = x * cs + z * sn + dx;
      positions[i + 1] = positions[i + 1]! + dy;
      positions[i + 2] = -x * sn + z * cs + dz;
      const nx = normals[i]!;
      const nz = normals[i + 2]!;
      normals[i] = nx * cs + nz * sn;
      normals[i + 2] = -nx * sn + nz * cs;
    }
    return { positions, normals, colors: g.colors, indices: g.indices };
  };
  return joinGeo([move(c, -0.45, 0, 0, 0.1), move(c, 0.45, 0, 0.05, -0.15), move(c, 0, 0.8, 0, 0.5)]);
}

function rack(scene: Scene): Geo {
  const parts: Geo[] = [];
  for (const x of [-0.75, 0.75]) parts.push(box(scene, 0.09, 1.7, 0.09, x, 0.85, 0, WOOD_DARK));
  for (const y of [0.5, 1.1, 1.62]) parts.push(box(scene, 1.6, 0.06, 0.5, 0, y, 0, WOOD_LIGHT));
  const items: [number, number, RGB, "b" | "s"][] = [
    [-0.5, 0.53, [0.85, 0.4, 0.38], "s"],
    [-0.15, 0.53, [0.95, 0.85, 0.5], "b"],
    [0.3, 0.53, [0.5, 0.7, 0.9], "s"],
    [0.55, 0.53, [0.78, 0.6, 0.85], "s"],
    [-0.4, 1.13, [0.62, 0.82, 0.55], "b"],
    [0.1, 1.13, [0.95, 0.7, 0.5], "s"],
    [0.45, 1.13, [0.9, 0.9, 0.95], "b"],
  ];
  for (const [x, y, c, k] of items) parts.push(k === "s" ? sphere(scene, 0.24, 4, x, y + 0.13, 0, c, 1.15) : box(scene, 0.26, 0.24, 0.26, x, y + 0.12, 0, c));
  return joinGeo(parts);
}

function barrel(scene: Scene): Geo {
  const parts: Geo[] = [cyl(scene, 0.62, 0.62, 0.9, 14, 0, 0.45, 0, (x, y, z) => (Math.abs(Math.sin(Math.atan2(x, z) * 7)) < 0.12 ? shade(WOOD, 0.85) : WOOD))];
  parts.push(cyl(scene, 0.72, 0.72, 0.4, 14, 0, 0.45, 0, WOOD, 0, 0, 0, false));
  for (const y of [0.16, 0.74]) parts.push(cyl(scene, 0.68, 0.68, 0.06, 14, 0, y, 0, [0.45, 0.45, 0.5], 0, 0, 0, false));
  return joinGeo(parts);
}

function banner(scene: Scene): Geo {
  const parts: Geo[] = [cyl(scene, 0.1, 0.13, 3.8, 8, 0, 1.9, 0, WOOD_DARK)];
  parts.push(box(scene, 1.2, 0.08, 0.08, 0, 3.55, 0, WOOD_DARK));
  parts.push(sphere(scene, 0.18, 4, 0, 3.85, 0, GOLD));
  // 旗布：紫色主體＋上下金色飾邊（分開的方塊，顏色邊界清楚）
  parts.push(box(scene, 1.0, 1.55, 0.04, 0, 2.55, 0, PURPLE));
  parts.push(box(scene, 1.04, 0.14, 0.05, 0, 3.38, 0, GOLD));
  parts.push(box(scene, 1.04, 0.14, 0.05, 0, 1.72, 0, GOLD));
  parts.push(cyl(scene, 0.42, 0.42, 0.05, 5, 0, 2.7, 0.03, GOLD, Math.PI / 2));
  return joinGeo(parts);
}

function lanternPost(scene: Scene): Geo {
  const parts: Geo[] = [cyl(scene, 0.09, 0.12, 2.0, 8, 0, 1.0, 0, WOOD_DARK)];
  parts.push(box(scene, 0.5, 0.06, 0.06, 0.22, 1.95, 0, WOOD_DARK));
  parts.push(box(scene, 0.3, 0.05, 0.3, 0.42, 1.88, 0, WOOD_DARK));
  parts.push(box(scene, 0.32, 0.06, 0.32, 0.42, 1.52, 0, WOOD_DARK));
  for (const [x, z] of [[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]] as const) parts.push(box(scene, 0.035, 0.34, 0.035, 0.42 + x, 1.7, z, WOOD_DARK));
  return joinGeo(parts);
}

function signpost(scene: Scene): Geo {
  const parts: Geo[] = [cyl(scene, 0.11, 0.13, 1.9, 8, 0, 0.95, 0, WOOD_DARK)];
  parts.push(box(scene, 1.0, 0.24, 0.05, 0.3, 1.6, 0, WOOD_LIGHT, 0, 0.35));
  parts.push(box(scene, 0.9, 0.22, 0.05, -0.25, 1.28, 0, WOOD_LIGHT, 0, -0.5));
  parts.push(sphere(scene, 0.14, 3, 0, 1.92, 0, GOLD));
  return joinGeo(parts);
}

function campfireBase(scene: Scene): Geo {
  const parts: Geo[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const m = MeshBuilder.CreateIcoSphere("PH_propTmp", { radius: 0.17, subdivisions: 1 }, scene);
    m.position.set(Math.sin(a) * 0.6, 0.08, Math.cos(a) * 0.6);
    m.scaling.set(1.2, 0.7, 1);
    parts.push(geoOf(m, (_x, _y, _z, _nx, ny) => shade(STONE, 0.85 + Math.max(0, ny) * 0.2)));
  }
  for (let i = 0; i < 3; i++) parts.push(cyl(scene, 0.11, 0.13, 0.95, 7, 0, 0.18, 0, WOOD_DARK, 0.25, (i / 3) * Math.PI, Math.PI / 2 - 0.25));
  parts.push(cyl(scene, 0.75, 0.75, 0.03, 12, 0, 0.02, 0, [0.25, 0.2, 0.18]));
  return joinGeo(parts);
}

function logBench(scene: Scene): Geo {
  return joinGeo([
    cyl(scene, 0.36, 0.36, 1.6, 10, 0, 0.2, 0, (_x, _y, _z, ny) => (Math.abs(ny) > 0.9 ? WOOD_LIGHT : [0.55, 0.38, 0.25]), 0, 0, Math.PI / 2),
  ]);
}

function fencePost(scene: Scene): Geo {
  return joinGeo([box(scene, 0.13, 0.8, 0.13, 0, 0.4, 0, WOOD_LIGHT), box(scene, 0.16, 0.06, 0.16, 0, 0.82, 0, WOOD)]);
}

function fenceRail(scene: Scene, len: number): Geo {
  return joinGeo([box(scene, 0.06, 0.09, len, 0, 0.34, 0, WOOD), box(scene, 0.06, 0.09, len, 0, 0.62, 0, WOOD)]);
}

function bed(scene: Scene, len: number): Geo {
  // 微微隆起的土畦＋兩側淺溝
  return joinGeo([
    box(scene, 0.95, 0.18, len, 0, 0.06, 0, (_x, y, _z, ny) => (ny > 0.5 ? shade(SOIL, 0.92) : mix(SOIL, [0.42, 0.28, 0.18], y < 0 ? 0.5 : 0))),
    box(scene, 0.55, 0.05, len - 0.1, 0, 0.17, 0, shade(SOIL, 0.82)),
  ]);
}

function carrot(scene: Scene): Geo {
  const parts: Geo[] = [cyl(scene, 0.13, 0.05, 0.1, 8, 0, 0.18, 0, [0.98, 0.55, 0.2])];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    parts.push(box(scene, 0.05, 0.34, 0.012, Math.sin(a) * 0.04, 0.38, Math.cos(a) * 0.04, (_x, y) => mix([0.32, 0.6, 0.28], [0.55, 0.85, 0.38], Math.min(1, (y - 0.2) / 0.36)), Math.cos(a) * 0.35, a, -Math.sin(a) * 0.35));
  }
  return joinGeo(parts);
}

function hay(scene: Scene): Geo {
  const H: RGB = [0.94, 0.82, 0.46];
  return joinGeo([
    cyl(scene, 0.95, 0.95, 1.1, 14, 0, 0.47, 0, (_x, _y, _z, ny) => (Math.abs(ny) > 0.9 ? shade(H, 1.06) : H), 0, 0, Math.PI / 2),
    cyl(scene, 0.98, 0.98, 0.06, 14, 0.25, 0.47, 0, [0.6, 0.45, 0.3], 0, 0, Math.PI / 2, false),
    cyl(scene, 0.98, 0.98, 0.06, 14, -0.25, 0.47, 0, [0.6, 0.45, 0.3], 0, 0, Math.PI / 2, false),
  ]);
}

function cart(scene: Scene): Geo {
  const parts: Geo[] = [box(scene, 1.3, 0.38, 0.85, 0, 0.62, 0, plankBands(WOOD))];
  for (const s of [-1, 1]) parts.push(cyl(scene, 0.62, 0.62, 0.08, 14, 0, 0.32, s * 0.5, WOOD_DARK, Math.PI / 2));
  for (const s of [-1, 1]) parts.push(box(scene, 0.9, 0.06, 0.06, 1.05, 0.62, s * 0.3, WOOD_DARK, 0, 0, -0.25));
  // 車上的胡蘿蔔與蔬菜
  for (let i = 0; i < 5; i++) parts.push(sphere(scene, 0.18, 3, -0.4 + i * 0.2, 0.86, (i % 2) * 0.15 - 0.07, i % 2 ? [0.98, 0.55, 0.2] : [0.6, 0.82, 0.42], 0.8));
  return joinGeo(parts);
}

function hoe(scene: Scene): Geo {
  return joinGeo([cyl(scene, 0.045, 0.05, 1.45, 6, 0, 0.7, 0, WOOD, 0.32), box(scene, 0.26, 0.05, 0.14, 0, 1.38, 0.47, [0.62, 0.62, 0.68], 0.32)]);
}

// ---------------- 自發光（火焰、燈籠玻璃） ----------------
function flames(scene: Scene): Geo {
  const parts: Geo[] = [];
  const cols: RGB[] = [[1, 0.55, 0.18], [1, 0.75, 0.3], [1, 0.62, 0.22]];
  const spec: [number, number, number, number][] = [[0, 0, 0.42, 0.75], [0.12, 0.06, 0.3, 0.55], [-0.1, -0.08, 0.32, 0.5]];
  spec.forEach(([x, z, d, h], i) => {
    const m = MeshBuilder.CreateCylinder("PH_propTmp", { diameterTop: 0, diameterBottom: d, height: h, tessellation: 7 }, scene);
    m.position.set(x, 0.22 + h / 2, z);
    parts.push(geoOf(m, (_x, y) => mix(cols[i]!, [1, 0.92, 0.6], Math.min(1, (y - 0.22) / h) * 0.6)));
  });
  return joinGeo(parts);
}

function lanternGlass(scene: Scene): Geo {
  const m = MeshBuilder.CreateBox("PH_propTmp", { width: 0.22, height: 0.28, depth: 0.22 }, scene);
  m.position.set(0.42, 1.7, 0);
  return geoOf(m, () => [1, 0.78, 0.45]);
}

// ---------------- 組合 ----------------
export interface PropsView {
  update(px: number, pz: number, overview: boolean, dt: number): void;
  setEnabled(on: boolean): void;
  stats(): { props: number; meshes: number; triangles: number; detailOn: boolean[]; casters: number };
}

export function buildPropsView(scene: Scene, t: StarsproutTerrain, lod: MapLod, shadows: ShadowGenerator | null): PropsView {
  const hq = lod === "hq";
  const mat = new StandardMaterial("PH_propMat", scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = new Color3(0.04, 0.04, 0.04);

  const cache = new Map<PropKind, Geo>();
  const geoFor = (pr: PropPlacement): Geo => {
    if (pr.kind === "fenceRail") return fenceRail(scene, pr.length);
    if (pr.kind === "bed") return bed(scene, pr.length);
    const hit = cache.get(pr.kind);
    if (hit) return hit;
    const g =
      pr.kind === "pavilion" ? pavilion(scene)
      : pr.kind === "tent" ? tent(scene, cache.has("tent") ? BLUE : BLUE)
      : pr.kind === "crate" ? crate(scene)
      : pr.kind === "crateStack" ? crateStack(scene)
      : pr.kind === "rack" ? rack(scene)
      : pr.kind === "barrel" ? barrel(scene)
      : pr.kind === "banner" ? banner(scene)
      : pr.kind === "lantern" ? lanternPost(scene)
      : pr.kind === "signpost" ? signpost(scene)
      : pr.kind === "campfire" ? campfireBase(scene)
      : pr.kind === "logBench" ? logBench(scene)
      : pr.kind === "fencePost" ? fencePost(scene)
      : pr.kind === "carrot" ? carrot(scene)
      : pr.kind === "hay" ? hay(scene)
      : pr.kind === "cart" ? cart(scene)
      : hoe(scene);
    cache.set(pr.kind, g);
    return g;
  };
  // 第二頂小帳篷換成紫色（兩頂帳篷顏色不同，比較自然）
  const tentPurple = tent(scene, PURPLE);
  let tentCount = 0;

  const groups: Record<"camp" | "farm", { big: Placed[]; detail: Placed[] }> = { camp: { big: [], detail: [] }, farm: { big: [], detail: [] } };
  const glow: Placed[] = [];
  const halos: { x: number; y: number; z: number; s: number }[] = [];
  for (const pr of PROPS) {
    let geo = geoFor(pr);
    if (pr.kind === "tent") geo = tentCount++ === 1 ? tentPurple : geo;
    const y = t.height(pr.x, pr.z) - (pr.kind === "fencePost" ? 0.05 : 0.02);
    const placed: Placed = { geo, x: pr.x, y, z: pr.z, rot: pr.rot, scale: pr.scale };
    (pr.big ? groups[pr.area].big : groups[pr.area].detail).push(placed);
    if (pr.kind === "campfire") {
      glow.push({ geo: flames(scene), x: pr.x, y, z: pr.z, rot: 0, scale: 1 });
      halos.push({ x: pr.x, y: y + 0.6, z: pr.z, s: 2.4 });
    }
    if (pr.kind === "lantern") {
      glow.push({ geo: lanternGlass(scene), x: pr.x, y, z: pr.z, rot: pr.rot, scale: 1 });
      const lx = pr.x + Math.cos(pr.rot) * 0.42;
      const lz = pr.z - Math.sin(pr.rot) * 0.42;
      halos.push({ x: lx, y: y + 1.7, z: lz, s: 1.2 });
    }
  }
  const meshes = {
    campBig: bake(scene, "PH_campBig", groups.camp.big, mat),
    campDetail: bake(scene, "PH_campDetail", groups.camp.detail, mat),
    farmBig: bake(scene, "PH_farmBig", groups.farm.big, mat),
    farmDetail: bake(scene, "PH_farmDetail", groups.farm.detail, mat),
  };
  // 火焰與燈籠：自發光上限 0.95、不進發光層（避免整片泛白、不影響角色辨識）
  const glowMat = new StandardMaterial("PH_propGlowMat", scene);
  glowMat.disableLighting = true;
  glowMat.emissiveColor = new Color3(0.95, 0.95, 0.95);
  glowMat.diffuseColor = Color3.Black();
  glowMat.specularColor = Color3.Black();
  const glowMesh = bake(scene, "PH_propEmissive", glow, glowMat);
  if (glowMesh) glowMesh.receiveShadows = false;

  // 暖色光暈：1 個 SpriteManager（加法混合、低透明度）
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,190,110,0.55)");
  g.addColorStop(0.45, "rgba(255,160,80,0.18)");
  g.addColorStop(1, "rgba(255,150,70,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const haloMgr = new SpriteManager("PH_propHalo", c.toDataURL("image/png"), Math.max(1, halos.length), { width: 64, height: 64 }, scene);
  haloMgr.blendMode = Constants.ALPHA_ADD;
  haloMgr.disableDepthWrite = true;
  haloMgr.isPickable = false;
  const haloSprites = halos.map((h, i) => {
    const sp = new Sprite(`PH_propHalo_${i}`, haloMgr);
    sp.position.set(h.x, h.y, h.z);
    sp.width = sp.height = h.s;
    return sp;
  });

  const areas = [
    { big: meshes.campBig, detail: meshes.campDetail, c: CAMP_CENTER, detailOn: true, caster: false },
    { big: meshes.farmBig, detail: meshes.farmDetail, c: FARM_CENTER, detailOn: true, caster: false },
  ];
  const DETAIL_R = hq ? 55 : 40;
  const SHADOW_R = 40;
  let time = 0;
  let enabled = true;
  let casters = 0;
  return {
    update(px, pz, overview, dt) {
      if (!enabled) return;
      time += dt;
      casters = 0;
      for (const a of areas) {
        const d = Math.hypot(a.c.x - px, a.c.z - pz);
        const on = !overview && d < DETAIL_R;
        if (on !== a.detailOn) {
          a.detailOn = on;
          a.detail?.setEnabled(on);
        }
        const cast = hq && !!shadows && !overview && d < SHADOW_R;
        if (cast !== a.caster && a.big && shadows) {
          a.caster = cast;
          if (cast) {
            shadows.addShadowCaster(a.big, false);
            if (a.detail) shadows.addShadowCaster(a.detail, false);
          } else {
            shadows.removeShadowCaster(a.big, false);
            if (a.detail) shadows.removeShadowCaster(a.detail, false);
          }
        }
        if (a.caster) casters++;
      }
      // 火光微微閃爍（只改材質亮度，不增加繪製）
      const f = 0.86 + 0.06 * Math.sin(time * 9.1) + 0.04 * Math.sin(time * 23.7);
      glowMat.emissiveColor.set(f, f, f);
      const near = !overview && Math.hypot(CAMP_CENTER.x - px, CAMP_CENTER.z - pz) < DETAIL_R;
      for (const sp of haloSprites) sp.isVisible = near;
    },
    setEnabled(on) {
      enabled = on;
      for (const m of [...Object.values(meshes), glowMesh]) m?.setEnabled(on);
      for (const sp of haloSprites) sp.isVisible = on;
    },
    stats() {
      const all = [...Object.values(meshes), glowMesh].filter((m): m is Mesh => !!m);
      return {
        props: PROPS.length,
        meshes: all.length + 1,
        triangles: all.reduce((n, m) => n + (m.getTotalIndices() / 3), 0),
        detailOn: areas.map((a) => a.detailOn),
        casters,
      };
    },
  };
}
