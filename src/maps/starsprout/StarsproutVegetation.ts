import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, type Scene, type ShadowGenerator, StandardMaterial, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import { MAP_HALF } from "./layout.ts";
import type { SmallKind, SmallPlacement, TreeKind, TreePlacement, TuftPlacement, VegetationLayout } from "./vegetation.ts";
import type { MapLod } from "./StarsproutWorld.ts";
import { behindCamera, instKey, levelFor, tuftDensity, VEG_LOD_HQ, VEG_LOD_LITE, type VegLevel, type VegLodConfig } from "./vegLod.ts";

/**
 * Stage 6 P2-1：植被畫面層。
 * - 樹、灌木、岩石：每塊地形（4×4）烘焙成「近景精細」與「遠景簡化」兩個網格，共用一個頂點色材質
 *   → 近處 2～4 塊用精細版，其他用簡化版；每塊只有 1 次繪製
 * - 草叢、花：8×8 小格，每格用 thin instances（同一模型只畫一次），超過距離整格隱藏
 * - 草與花不投影、不接收陰影；只有 HQ 近處的樹投影
 * 名稱以 PH_ 開頭：程式產生的第一版場景模型，之後可由美術模型替換
 */

export interface Geo {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

type RGB = [number, number, number];
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** 取出網格資料並依位置上色（之後網格本身丟掉） */
export function geoOf(mesh: Mesh, color: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => RGB): Geo {
  mesh.bakeCurrentTransformIntoVertices();
  const positions = Array.from(mesh.getVerticesData(VertexBuffer.PositionKind) ?? []);
  const normals = Array.from(mesh.getVerticesData(VertexBuffer.NormalKind) ?? []);
  const indices = Array.from(mesh.getIndices() ?? []);
  const colors: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const c = color(positions[i]!, positions[i + 1]!, positions[i + 2]!, normals[i]!, normals[i + 1]!, normals[i + 2]!);
    colors.push(c[0], c[1], c[2], 1);
  }
  mesh.dispose();
  return { positions, normals, colors, indices };
}

export function joinGeo(parts: Geo[]): Geo {
  const out: Geo = { positions: [], normals: [], colors: [], indices: [] };
  for (const p of parts) {
    const base = out.positions.length / 3;
    out.positions.push(...p.positions);
    out.normals.push(...p.normals);
    out.colors.push(...p.colors);
    for (const i of p.indices) out.indices.push(i + base);
  }
  return out;
}

/** 小幅度、可重現的頂點色雜訊（讓樹冠不會一整片同色） */
const jitter = (x: number, y: number, z: number): number => Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 0.5 + 0.5;

// ---------------- 樹 ----------------
interface TreeStyle {
  trunk: RGB;
  dark: RGB;
  light: RGB;
}
const STYLE: Record<Exclude<TreeKind, "pine">, TreeStyle> = {
  broad: { trunk: [0.55, 0.39, 0.27], dark: [0.27, 0.55, 0.3], light: [0.58, 0.84, 0.42] },
  broadLight: { trunk: [0.6, 0.44, 0.3], dark: [0.45, 0.7, 0.32], light: [0.8, 0.93, 0.52] },
  cherry: { trunk: [0.5, 0.33, 0.28], dark: [0.9, 0.55, 0.7], light: [1, 0.88, 0.93] },
};

function trunkGeo(scene: Scene, h: number, dTop: number, dBot: number, tess: number, col: RGB): Geo {
  const m = MeshBuilder.CreateCylinder("PH_vegTmp", { height: h, diameterTop: dTop, diameterBottom: dBot, tessellation: tess, cap: Mesh.NO_CAP }, scene);
  m.position.y = h / 2;
  return geoOf(m, (_x, y) => mixRGB([col[0] * 0.75, col[1] * 0.75, col[2] * 0.75], col, Math.min(1, y / h)));
}

/** lvl：0＝精細、1＝中距離（同樣的球數與位置、細分較低）、2＝簡化（舊版「遠景」）；true/false 為舊呼叫方式（＝0／2） */
function blobTree(scene: Scene, kind: Exclude<TreeKind, "pine">, lvlIn: boolean | VegLevel): Geo {
  const lvl: VegLevel = lvlIn === true ? 0 : lvlIn === false ? 2 : lvlIn;
  const hi = lvl < 2;
  const s = STYLE[kind];
  const seg = lvl === 0 ? 4 : lvl === 1 ? 3 : 2;
  const parts: Geo[] = [trunkGeo(scene, kind === "cherry" ? 2.4 : 2.6, 0.3, 0.52, lvl === 0 ? 7 : lvl === 1 ? 6 : 4, s.trunk)];
  const blobs: [number, number, number, number][] =
    kind === "cherry"
      ? [[0, 3.3, 0, 3.4], [1.2, 3.0, 0.3, 2.4], [-1.1, 3.1, -0.4, 2.5], [0.2, 4.1, -0.3, 2.4], [-0.3, 2.8, 1.1, 2.0], [0.6, 3.4, -1.1, 2.0]]
      : kind === "broadLight"
        ? [[0, 3.4, 0, 3.0], [0.8, 3.1, 0.4, 2.1], [-0.7, 3.2, -0.3, 2.1], [0.1, 4.2, 0, 2.0]]
        : [[0, 3.5, 0, 3.2], [0.95, 3.1, 0.3, 2.2], [-0.85, 3.2, -0.45, 2.3], [0.2, 4.4, -0.2, 2.2], [-0.3, 2.8, 0.95, 1.8]];
  const used = hi ? blobs : blobs.slice(0, 2);
  for (const [bx, by, bz, d] of used) {
    const m = MeshBuilder.CreateSphere("PH_vegTmp", { diameter: d * (hi ? 1 : 1.25), segments: seg }, scene);
    m.position.set(bx, by, bz);
    parts.push(
      geoOf(m, (x, y, z, _nx, ny) => {
        // 上亮下暗＋朝上的面更亮＋少量斑駁
        const t = Math.min(1, Math.max(0, (y - 2.2) / 3)) * 0.7 + Math.max(0, ny) * 0.3;
        const c = mixRGB(s.dark, s.light, t);
        const j = (jitter(x, y, z) - 0.5) * 0.08;
        return [c[0] + j, c[1] + j, c[2] + j];
      }),
    );
  }
  return joinGeo(parts);
}

function pineTree(scene: Scene, lvlIn: boolean | VegLevel): Geo {
  const lvl: VegLevel = lvlIn === true ? 0 : lvlIn === false ? 2 : lvlIn;
  const hi = lvl < 2;
  const tess = lvl === 0 ? 16 : lvl === 1 ? 10 : 7;
  const parts: Geo[] = [trunkGeo(scene, 1.6, 0.24, 0.42, lvl === 0 ? 7 : 5, [0.48, 0.34, 0.26])];
  const tiers: [number, number, number][] = [
    [1.3, 3.2, 1.9],
    [2.4, 2.6, 1.7],
    [3.4, 2.0, 1.5],
    [4.3, 1.3, 1.3],
  ];
  const dark: RGB = [0.2, 0.46, 0.36];
  const light: RGB = [0.42, 0.72, 0.5];
  for (const [y0, d, h] of hi ? tiers : tiers.filter((_, i) => i !== 2)) {
    const m = MeshBuilder.CreateCylinder("PH_vegTmp", { height: h, diameterTop: d * 0.12, diameterBottom: d, tessellation: tess }, scene);
    m.position.y = y0 + h / 2;
    parts.push(
      geoOf(m, (x, y, z, _nx, ny) => {
        const c = mixRGB(dark, light, Math.min(1, Math.max(0, (y - y0) / h)) * 0.6 + Math.max(0, ny) * 0.25);
        const j = (jitter(x, y, z) - 0.5) * 0.06;
        return [c[0] + j, c[1] + j, c[2] + j];
      }),
    );
  }
  return joinGeo(parts);
}

// ---------------- 灌木、岩石 ----------------
function bushGeo(scene: Scene, flowered: boolean, lvlIn: boolean | VegLevel): Geo {
  const lvl: VegLevel = lvlIn === true ? 0 : lvlIn === false ? 2 : lvlIn;
  const hi = lvl < 2;
  const seg = hi ? 3 : 2;
  const dark: RGB = [0.3, 0.58, 0.3];
  const light: RGB = [0.56, 0.82, 0.42];
  const parts: Geo[] = [];
  const blobs: [number, number, number, number][] = [[0, 0.42, 0, 1.1], [0.45, 0.32, 0.15, 0.8], [-0.4, 0.34, -0.1, 0.85]];
  for (const [bx, by, bz, d] of hi ? blobs : blobs.slice(0, 2)) {
    const m = MeshBuilder.CreateSphere("PH_vegTmp", { diameter: d, segments: seg }, scene);
    m.position.set(bx, by, bz);
    parts.push(geoOf(m, (x, y, z, _nx, ny) => {
      const c = mixRGB(dark, light, Math.min(1, y / 0.9) * 0.6 + Math.max(0, ny) * 0.4);
      const j = (jitter(x, y, z) - 0.5) * 0.06;
      return [c[0] + j, c[1] + j, c[2] + j];
    }));
  }
  // 小花點只在精細等級（中距離看不清楚）
  if (flowered && lvl === 0) {
    const dots: [number, number, number][] = [[0.1, 0.92, 0.2], [0.42, 0.7, 0.35], [-0.35, 0.72, 0.25], [0.2, 0.75, -0.42], [-0.25, 0.85, -0.2], [0.55, 0.55, -0.15]];
    for (const [i, [x, y, z]] of dots.entries()) {
      const m = MeshBuilder.CreateSphere("PH_vegTmp", { diameter: 0.14, segments: 2 }, scene);
      m.position.set(x, y, z);
      const c: RGB = i % 2 ? [1, 0.98, 0.95] : [1, 0.68, 0.82];
      parts.push(geoOf(m, () => c));
    }
  }
  return joinGeo(parts);
}

function rockGeo(scene: Scene, flat: boolean, hi: boolean): Geo {
  const m = MeshBuilder.CreateIcoSphere("PH_vegTmp", { radius: 0.6, subdivisions: hi ? 1 : 1, flat: false }, scene);
  m.scaling.set(flat ? 1.35 : 1.1, flat ? 0.38 : 0.72, flat ? 1.05 : 0.95);
  m.position.y = flat ? 0.12 : 0.26;
  // 輕微不規則：沿法線推動頂點
  m.bakeCurrentTransformIntoVertices();
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < pos.length; i += 3) {
    const k = 1 + (jitter(pos[i]!, pos[i + 1]!, pos[i + 2]!) - 0.5) * 0.18;
    pos[i] = pos[i]! * k;
    pos[i + 2] = pos[i + 2]! * k;
  }
  m.updateVerticesData(VertexBuffer.PositionKind, pos);
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, m.getIndices()!, normals);
  m.updateVerticesData(VertexBuffer.NormalKind, normals);
  const base: RGB = [0.7, 0.69, 0.75];
  const top: RGB = [0.86, 0.85, 0.9];
  const moss: RGB = [0.5, 0.72, 0.4];
  return geoOf(m, (x, y, z, _nx, ny) => {
    let c = mixRGB(base, top, Math.max(0, ny));
    if (ny > 0.75) c = mixRGB(c, moss, flat ? 0.55 : 0.3);
    const j = (jitter(x, y, z) - 0.5) * 0.06;
    return [c[0] + j, c[1] + j, c[2] + j];
  });
}

// ---------------- 草、花（thin instance 範本） ----------------
function grassTemplate(scene: Scene): Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const base: RGB = [0.4, 0.64, 0.3];
  const mid: RGB = [0.56, 0.8, 0.38];
  const tip: RGB = [0.78, 0.92, 0.5];
  const blades = 4;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI + (b % 2) * 0.3;
    const ox = Math.cos(a + 1.3) * 0.06 * (b % 3);
    const oz = Math.sin(a + 1.3) * 0.06 * (b % 3);
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const lean = 0.08 + (b % 3) * 0.05;
    const h = 0.42 + (b % 3) * 0.12;
    const i0 = positions.length / 3;
    // 底部兩點、中段兩點、尖端一點（稍微往外彎）
    positions.push(ox - dx * 0.11, 0, oz - dz * 0.11, ox + dx * 0.11, 0, oz + dz * 0.11);
    positions.push(ox - dx * 0.075 - dz * lean * 0.4, h * 0.55, oz - dz * 0.075 + dx * lean * 0.4, ox + dx * 0.075 - dz * lean * 0.4, h * 0.55, oz + dz * 0.075 + dx * lean * 0.4);
    positions.push(ox - dz * lean, h, oz + dx * lean);
    for (const c of [base, base, mid, mid, tip]) colors.push(c[0], c[1], c[2], 1);
    indices.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2, i0 + 2, i0 + 3, i0 + 4);
  }
  const normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0)); // 全部朝上：和地面一樣受光，不會有背光黑面
  const m = new Mesh("PH_grassTemplate", scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.colors = colors;
  vd.indices = indices;
  vd.applyToMesh(m);
  return m;
}

function flowerTemplate(scene: Scene): Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const stem: RGB = [0.45, 0.72, 0.38];
  const heads: [number, number, number, number][] = [
    [0, 0, 0.32, 0.13],
    [0.18, 0.08, 0.24, 0.11],
    [-0.12, 0.15, 0.28, 0.115],
    [0.05, -0.17, 0.22, 0.1],
  ];
  for (const [hx, hz, hy, r] of heads) {
    // 莖（細長三角形，兩面）
    const s0 = positions.length / 3;
    positions.push(hx - 0.018, 0, hz, hx + 0.018, 0, hz, hx, hy, hz);
    for (let k = 0; k < 3; k++) colors.push(stem[0], stem[1], stem[2], 1);
    indices.push(s0, s0 + 1, s0 + 2);
    // 花：中心＋6 片花瓣（白色，實例顏色決定花色）；中心偏黃
    const c0 = positions.length / 3;
    positions.push(hx, hy + 0.012, hz);
    colors.push(1, 0.9, 0.55, 1);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      positions.push(hx + Math.cos(a) * r, hy, hz + Math.sin(a) * r);
      colors.push(1, 1, 1, 1);
    }
    for (let k = 0; k < 6; k++) indices.push(c0, c0 + 1 + k, c0 + 1 + ((k + 1) % 6));
  }
  const normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
  const m = new Mesh("PH_flowerTemplate", scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.colors = colors;
  vd.indices = indices;
  vd.applyToMesh(m);
  return m;
}

// ---------------- 組合 ----------------
export interface Placed {
  geo: Geo;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
}

export function bake(scene: Scene, name: string, items: Placed[], mat: StandardMaterial): Mesh | null {
  if (!items.length) return null;
  let nv = 0;
  let ni = 0;
  for (const it of items) {
    nv += it.geo.positions.length / 3;
    ni += it.geo.indices.length;
  }
  const positions = new Float32Array(nv * 3);
  const normals = new Float32Array(nv * 3);
  const colors = new Float32Array(nv * 4);
  const indices = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0;
  let io = 0;
  for (const it of items) {
    const c = Math.cos(it.rot);
    const s = Math.sin(it.rot);
    const g = it.geo;
    const n = g.positions.length / 3;
    for (let i = 0; i < n; i++) {
      const px = g.positions[i * 3]! * it.scale;
      const py = g.positions[i * 3 + 1]! * it.scale;
      const pz = g.positions[i * 3 + 2]! * it.scale;
      positions[(vo + i) * 3] = it.x + px * c + pz * s;
      positions[(vo + i) * 3 + 1] = it.y + py;
      positions[(vo + i) * 3 + 2] = it.z - px * s + pz * c;
      const nx = g.normals[i * 3]!;
      const nz = g.normals[i * 3 + 2]!;
      normals[(vo + i) * 3] = nx * c + nz * s;
      normals[(vo + i) * 3 + 1] = g.normals[i * 3 + 1]!;
      normals[(vo + i) * 3 + 2] = -nx * s + nz * c;
      colors[(vo + i) * 4] = g.colors[i * 4]!;
      colors[(vo + i) * 4 + 1] = g.colors[i * 4 + 1]!;
      colors[(vo + i) * 4 + 2] = g.colors[i * 4 + 2]!;
      colors[(vo + i) * 4 + 3] = 1;
    }
    for (let k = 0; k < g.indices.length; k++) indices[io + k] = g.indices[k]! + vo;
    vo += n;
    io += g.indices.length;
  }
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.colors = colors;
  vd.indices = indices;
  vd.applyToMesh(mesh);
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  mesh.freezeWorldMatrix();
  return mesh;
}

export interface VegLodStats {
  mode: "lod" | "legacy";
  /** 樹＋灌木＋岩石：各等級正在畫的數量、剔除（鏡頭後方或霧外）數量 */
  hi: number;
  mid: number;
  lo: number;
  culled: number;
  /** 草、花正在畫的數量（抽稀後） */
  grassShown: number;
  flowersShown: number;
  /** 植被正在送進 GPU 的三角面（不含引擎的視錐剔除；估計上限） */
  tris: number;
  /** 植被網格數（啟用中） */
  meshes: number;
  casters: number;
  /** 這一幀實際畫出的植被（引擎視錐剔除後）：網格數＝植被 Draw Calls、三角面 */
  drawnMeshes: number;
  drawnTris: number;
}

const VEG_NAME = /^PH_(veg|grass_|flowers_)/;

/** 從場景統計植被：啟用中的網格與三角面、這一幀實際畫出的網格與三角面（新舊版本用同一個方法，前後比較才公平） */
export function vegSceneStats(scene: Scene): { meshes: number; tris: number; drawnMeshes: number; drawnTris: number } {
  const triOf = (m: { getTotalIndices(): number; thinInstanceCount?: number; hasThinInstances?: boolean }): number =>
    (m.getTotalIndices() / 3) * (m.hasThinInstances ? (m.thinInstanceCount ?? 0) : 1);
  let meshes = 0;
  let tris = 0;
  for (const m of scene.meshes) {
    if (!VEG_NAME.test(m.name) || !m.isEnabled() || m.name.includes("Template")) continue;
    meshes++;
    tris += triOf(m as Mesh);
  }
  let drawnMeshes = 0;
  let drawnTris = 0;
  const am = scene.getActiveMeshes();
  for (let i = 0; i < am.length; i++) {
    const m = am.data[i]!;
    if (!VEG_NAME.test(m.name)) continue;
    drawnMeshes++;
    drawnTris += triOf(m as Mesh);
  }
  return { meshes, tris: Math.round(tris), drawnMeshes, drawnTris: Math.round(drawnTris) };
}

export interface VegetationView {
  /** 每幀依玩家位置切換近景精細／遠景簡化、草花顯示格 */
  update(px: number, pz: number, overview: boolean): void;
  setEnabled(on: boolean): void;
  stats(): { trees: number; smalls: number; grass: number; flowers: number; hiChunks: number; grassCells: number; flowerCells: number; shadowChunks: number; lod?: VegLodStats };
}

const CH = 4;
const GC = 8;

/**
 * 植被畫面：預設用 Claude B 的距離分級版（buildVegetationLodView）；網址加 &veglod=0 用原本的版本（對照用）。
 * 呼叫方式與回傳介面都沒有變。
 */
export function buildVegetationView(scene: Scene, layout: VegetationLayout, lod: MapLod, shadows: ShadowGenerator | null): VegetationView {
  const off = typeof location !== "undefined" && new URLSearchParams(location.search).get("veglod") === "0";
  return off ? buildVegetationViewLegacy(scene, layout, lod, shadows) : buildVegetationLodView(scene, layout, lod, shadows);
}

/** Stage 7.4 以前的植被畫面（原樣保留；&veglod=0） */
export function buildVegetationViewLegacy(scene: Scene, layout: VegetationLayout, lod: MapLod, shadows: ShadowGenerator | null): VegetationView {
  const hq = lod === "hq";
  const mat = new StandardMaterial("PH_vegMat", scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = new Color3(0.03, 0.03, 0.03);
  const tuftMat = new StandardMaterial("PH_tuftMat", scene);
  tuftMat.diffuseColor = Color3.White();
  tuftMat.specularColor = Color3.Black();
  tuftMat.backFaceCulling = false;

  const treeGeo = (k: TreeKind, hi: boolean): Geo => (k === "pine" ? pineTree(scene, hi) : blobTree(scene, k, hi));
  const kinds: TreeKind[] = ["broad", "broadLight", "cherry", "pine"];
  const smallKinds: SmallKind[] = ["bush", "bushFlower", "rock", "rockFlat"];
  const geos = {
    hi: new Map<string, Geo>(),
    lo: new Map<string, Geo>(),
  };
  for (const k of kinds) {
    geos.hi.set(k, treeGeo(k, true));
    geos.lo.set(k, treeGeo(k, false));
  }
  geos.hi.set("bush", bushGeo(scene, false, true));
  geos.lo.set("bush", bushGeo(scene, false, false));
  geos.hi.set("bushFlower", bushGeo(scene, true, true));
  geos.lo.set("bushFlower", bushGeo(scene, true, false));
  geos.hi.set("rock", rockGeo(scene, false, true));
  geos.lo.set("rock", rockGeo(scene, false, false));
  geos.hi.set("rockFlat", rockGeo(scene, true, true));
  geos.lo.set("rockFlat", rockGeo(scene, true, false));

  // ---------- 樹、灌木、岩石：每塊地形一組（精細＋簡化） ----------
  const size = (2 * MAP_HALF) / CH;
  const cIndex = (x: number, z: number): number => {
    const i = Math.min(CH - 1, Math.max(0, Math.floor((x + MAP_HALF) / size)));
    const j = Math.min(CH - 1, Math.max(0, Math.floor((z + MAP_HALF) / size)));
    return j * CH + i;
  };
  const buckets: { trees: TreePlacement[]; smalls: SmallPlacement[] }[] = Array.from({ length: CH * CH }, () => ({ trees: [], smalls: [] }));
  for (const t of layout.trees) buckets[cIndex(t.x, t.z)]!.trees.push(t);
  for (const s of layout.smalls) buckets[cIndex(s.x, s.z)]!.smalls.push(s);
  const chunks = buckets.map((b, idx) => {
    const toPlaced = (hi: boolean): Placed[] => [
      ...b.trees.map((t) => ({ geo: (hi ? geos.hi : geos.lo).get(t.kind)!, x: t.x, y: t.y, z: t.z, rot: t.rot, scale: t.scale })),
      // 遠景簡化版不放小花灌木與扁岩（看不到，省三角形）
      ...b.smalls.filter((s) => hi || s.kind === "bush" || s.kind === "rock").map((s) => ({ geo: (hi ? geos.hi : geos.lo).get(s.kind)!, x: s.x, y: s.y, z: s.z, rot: s.rot, scale: s.scale })),
    ];
    const hi = bake(scene, `PH_vegHi_${idx}`, toPlaced(true), mat);
    const lo = bake(scene, `PH_vegLo_${idx}`, toPlaced(false), mat);
    hi?.setEnabled(false);
    const cx = -MAP_HALF + ((idx % CH) + 0.5) * size;
    const cz = -MAP_HALF + (Math.floor(idx / CH) + 0.5) * size;
    return { hi, lo, cx, cz, useHi: false, caster: false };
  });

  // ---------- 草、花：8×8 小格 ----------
  const gTemplate = grassTemplate(scene);
  gTemplate.material = tuftMat;
  gTemplate.isPickable = false;
  gTemplate.setEnabled(false);
  const fTemplate = flowerTemplate(scene);
  fTemplate.material = tuftMat;
  fTemplate.isPickable = false;
  fTemplate.setEnabled(false);
  const gsize = (2 * MAP_HALF) / GC;
  const makeCells = (template: Mesh, list: TuftPlacement[], tag: string, grid: number): { mesh: Mesh; cx: number; cz: number }[] => {
    const tplData = VertexData.ExtractFromMesh(template);
    const csize = (2 * MAP_HALF) / grid;
    const cellOf = (x: number, z: number): number => {
      const i = Math.min(grid - 1, Math.max(0, Math.floor((x + MAP_HALF) / csize)));
      const j = Math.min(grid - 1, Math.max(0, Math.floor((z + MAP_HALF) / csize)));
      return j * grid + i;
    };
    const per: TuftPlacement[][] = Array.from({ length: grid * grid }, () => []);
    for (const p of list) per[cellOf(p.x, p.z)]!.push(p);
    const out: { mesh: Mesh; cx: number; cz: number }[] = [];
    const m = new Matrix();
    const q = new Quaternion();
    const sv = new Vector3();
    const tv = new Vector3();
    per.forEach((items, idx) => {
      if (!items.length) return;
      // 每格一份獨立模型資料（不共用幾何：共用時 thin instance 的實例資料會互相干擾，WebKit 會拒絕繪製）
      const mesh = new Mesh(`PH_${tag}_${idx}`, scene);
      tplData.applyToMesh(mesh);
      mesh.material = template.material;
      const mats = new Float32Array(items.length * 16);
      const cols = new Float32Array(items.length * 4);
      items.forEach((p, i) => {
        Quaternion.RotationYawPitchRollToRef(p.rot, 0, 0, q);
        sv.set(p.scale, p.scale, p.scale);
        tv.set(p.x, p.y, p.z);
        Matrix.ComposeToRef(sv, q, tv, m);
        m.copyToArray(mats, i * 16);
        cols[i * 4] = p.r;
        cols[i * 4 + 1] = p.g;
        cols[i * 4 + 2] = p.b;
        cols[i * 4 + 3] = 1;
      });
      mesh.thinInstanceSetBuffer("matrix", mats, 16, true);
      mesh.thinInstanceSetBuffer("color", cols, 4, true);
      mesh.thinInstanceRefreshBoundingInfo(false);
      mesh.receiveShadows = false;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = false;
      mesh.freezeWorldMatrix();
      out.push({ mesh, cx: -MAP_HALF + ((idx % grid) + 0.5) * csize, cz: -MAP_HALF + (Math.floor(idx / grid) + 0.5) * csize });
    });
    return out;
  };
  // 草：8×8 小格（22.5 公尺）；花：4×4（45 公尺，花比較少，用大格減少繪製次數）
  const grassCells = makeCells(gTemplate, layout.grass, "grass", GC);
  const flowerCells = makeCells(fTemplate, layout.flowers, "flowers", CH);

  // 距離（以格中心算，加上半個對角線）
  const HI_R = hq ? 40 : 28;
  const GRASS_R = hq ? 40 : 28;
  const FLOWER_R = hq ? 46 : 32;
  const SHADOW_R = 20;
  const halfDiag = (size / 2) * Math.SQRT2;
  const gHalfDiag = (gsize / 2) * Math.SQRT2;
  let enabled = true;
  let hiCount = 0;
  let gOn = 0;
  let fOn = 0;
  let shadowCount = 0;

  const view: VegetationView = {
    update(px, pz, overview) {
      if (!enabled) return;
      hiCount = 0;
      shadowCount = 0;
      for (const c of chunks) {
        // 角色到這塊最近邊緣的距離
        const d = Math.max(0, Math.hypot(c.cx - px, c.cz - pz) - halfDiag);
        const useHi = !overview && d < HI_R && !!c.hi;
        if (useHi !== c.useHi) {
          c.useHi = useHi;
          c.hi?.setEnabled(useHi);
          c.lo?.setEnabled(!useHi);
        }
        if (useHi) hiCount++;
        const cast = hq && !!shadows && useHi && d < SHADOW_R;
        if (cast !== c.caster && c.hi && shadows) {
          c.caster = cast;
          if (cast) shadows.addShadowCaster(c.hi, false);
          else shadows.removeShadowCaster(c.hi, false);
        }
        if (c.caster) shadowCount++;
      }
      gOn = 0;
      fOn = 0;
      for (const g of grassCells) {
        const on = !overview && Math.hypot(g.cx - px, g.cz - pz) - gHalfDiag < GRASS_R;
        if (on !== g.mesh.isEnabled()) g.mesh.setEnabled(on);
        if (on) gOn++;
      }
      for (const f of flowerCells) {
        const on = !overview && Math.hypot(f.cx - px, f.cz - pz) - halfDiag < FLOWER_R;
        if (on !== f.mesh.isEnabled()) f.mesh.setEnabled(on);
        if (on) fOn++;
      }
    },
    setEnabled(on) {
      enabled = on;
      for (const c of chunks) {
        c.hi?.setEnabled(on && c.useHi);
        c.lo?.setEnabled(on && !c.useHi);
        if (!on && c.caster && c.hi && shadows) {
          shadows.removeShadowCaster(c.hi, false);
          c.caster = false;
        }
      }
      for (const g of grassCells) g.mesh.setEnabled(on);
      for (const f of flowerCells) f.mesh.setEnabled(on);
    },
    stats: () => ({
      trees: layout.trees.length,
      smalls: layout.smalls.length,
      grass: layout.grass.length,
      flowers: layout.flowers.length,
      hiChunks: hiCount,
      grassCells: gOn,
      flowerCells: fOn,
      shadowChunks: shadowCount,
      lod: (() => {
        const ss = vegSceneStats(scene);
        return { mode: "legacy" as const, hi: 0, mid: 0, lo: 0, culled: 0, grassShown: grassCells.reduce((a, g) => a + (g.mesh.isEnabled() ? g.mesh.thinInstanceCount : 0), 0), flowersShown: flowerCells.reduce((a, f) => a + (f.mesh.isEnabled() ? f.mesh.thinInstanceCount : 0), 0), tris: ss.tris, meshes: ss.meshes, casters: shadowCount, drawnMeshes: ss.drawnMeshes, drawnTris: ss.drawnTris };
      })(),
    }),
  };
  return view;
}

// =====================================================================
// Claude B：距離分級版植被（每棵樹各自分級、草花平滑抽稀、鏡頭後方與霧外不畫）
// =====================================================================

/** Geo → 獨立網格（每個網格各自一份幾何；thin instance 不共用幾何，WebKit 才不會拒絕繪製） */
function meshFromGeo(scene: Scene, name: string, g: Geo, mat: StandardMaterial): Mesh {
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = g.positions;
  vd.normals = g.normals;
  vd.colors = g.colors;
  vd.indices = g.indices;
  vd.applyToMesh(m, true);
  m.material = mat;
  m.isPickable = false;
  m.receiveShadows = true;
  m.alwaysSelectAsActiveMesh = false;
  return m;
}

/** 一個繪製網格（多個種類可共用，例如灌木與花灌木的中、遠距離幾何相同） */
interface LodSlot {
  mesh: Mesh;
  buf: Float32Array;
  count: number;
  tris: number;
  level: VegLevel;
}

interface LodGroup {
  /** 等級 0／1／2 各寫到哪個網格（可以重複；岩石三級都是同一個） */
  slots: [LodSlot, LodSlot, LodSlot];
  /** 本組的實例：預先算好的矩陣（16 個數字一組）與位置 */
  mats: Float32Array;
  xs: Float32Array;
  zs: Float32Array;
  prev: (VegLevel | null)[];
  small: boolean;
}

/** 草或花：整張地圖一個網格，依每一叢到角色的距離抽稀（不再整格切換） */
interface TuftLayer {
  mesh: Mesh;
  /** 依 8×8 格分桶（只掃描附近的格） */
  cells: { minX: number; maxX: number; minZ: number; maxZ: number; idx: Uint32Array }[];
  xs: Float32Array;
  zs: Float32Array;
  keys: Float32Array;
  mats: Float32Array;
  cols: Float32Array;
  liveM: Float32Array;
  liveC: Float32Array;
  count: number;
  tris: number;
  full: number;
  end: number;
}

export function buildVegetationLodView(scene: Scene, layout: VegetationLayout, lod: MapLod, shadows: ShadowGenerator | null): VegetationView {
  const hq = lod === "hq";
  const cfg: VegLodConfig = hq ? VEG_LOD_HQ : VEG_LOD_LITE;
  const mat = new StandardMaterial("PH_vegMat", scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = new Color3(0.03, 0.03, 0.03);
  const tuftMat = new StandardMaterial("PH_tuftMat", scene);
  tuftMat.diffuseColor = Color3.White();
  tuftMat.specularColor = Color3.Black();
  tuftMat.backFaceCulling = false;

  // ---------- 樹、灌木、岩石：thin instances（樹：種類 × 3 級；灌木共用中遠距離網格；岩石 1 級） ----------
  const m4 = new Matrix();
  const q = new Quaternion();
  const sv = new Vector3();
  const tv = new Vector3();
  type P = { x: number; y: number; z: number; rot: number; scale: number };
  const slots: LodSlot[] = [];
  const makeSlot = (name: string, g: Geo, cap: number, level: VegLevel): LodSlot => {
    const mesh = meshFromGeo(scene, name, g, mat);
    const buf = new Float32Array(Math.max(1, cap) * 16);
    mesh.thinInstanceSetBuffer("matrix", buf, 16, false);
    mesh.thinInstanceCount = 0;
    mesh.setEnabled(false);
    const s: LodSlot = { mesh, buf, count: 0, tris: g.indices.length / 3, level };
    slots.push(s);
    return s;
  };
  const groups: LodGroup[] = [];
  const makeGroup = (list: P[], sl: [LodSlot, LodSlot, LodSlot], small: boolean): void => {
    if (!list.length) return;
    const n = list.length;
    const mats = new Float32Array(n * 16);
    const xs = new Float32Array(n);
    const zs = new Float32Array(n);
    list.forEach((p, i) => {
      // 與舊版 bake 相同的轉換：先縮放、再繞 Y 轉 rot、再平移
      Quaternion.RotationYawPitchRollToRef(p.rot, 0, 0, q);
      sv.set(p.scale, p.scale, p.scale);
      tv.set(p.x, p.y, p.z);
      Matrix.ComposeToRef(sv, q, tv, m4);
      m4.copyToArray(mats, i * 16);
      xs[i] = p.x;
      zs[i] = p.z;
    });
    groups.push({ slots: sl, mats, xs, zs, prev: new Array<VegLevel | null>(n).fill(null), small });
  };
  const treeKinds: TreeKind[] = ["broad", "broadLight", "cherry", "pine"];
  for (const k of treeKinds) {
    const list = layout.trees.filter((t) => t.kind === k);
    if (!list.length) continue;
    const geo = (lvl: VegLevel): Geo => (k === "pine" ? pineTree(scene, lvl) : blobTree(scene, k, lvl));
    makeGroup(list, [makeSlot(`PH_vegHi_tree_${k}`, geo(0), list.length, 0), makeSlot(`PH_vegMid_tree_${k}`, geo(1), list.length, 1), makeSlot(`PH_vegLo_tree_${k}`, geo(2), list.length, 2)], false);
  }
  // 灌木：精細與中距離幾何相同 → 中距離直接用精細網格；花灌木只有精細等級有小花，中遠距離與一般灌木共用網格
  const bushes = layout.smalls.filter((s) => s.kind === "bush");
  const flowerBushes = layout.smalls.filter((s) => s.kind === "bushFlower");
  const nb = bushes.length + flowerBushes.length;
  if (nb) {
    const bushHi = makeSlot("PH_vegHi_bush", bushGeo(scene, false, 0), nb, 0);
    const bushLo = makeSlot("PH_vegLo_bush", bushGeo(scene, false, 2), nb, 2);
    makeGroup(bushes, [bushHi, bushHi, bushLo], true);
    if (flowerBushes.length) makeGroup(flowerBushes, [makeSlot("PH_vegHi_bushFlower", bushGeo(scene, true, 0), flowerBushes.length, 0), bushHi, bushLo], true);
  }
  // 岩石：原本精細與簡化就是同一個模型 → 只有一級
  for (const [kind, flat] of [["rock", false], ["rockFlat", true]] as const) {
    const list = layout.smalls.filter((s) => s.kind === kind);
    if (!list.length) continue;
    const s = makeSlot(`PH_vegHi_${kind}`, rockGeo(scene, flat, true), list.length, 0);
    makeGroup(list, [s, s, s], true);
  }

  // 陰影：只有高畫質、精細等級（玩家附近）投射
  const casterMeshes: Mesh[] = [];
  if (hq && shadows) {
    for (const s of slots) {
      if (s.level !== 0) continue;
      shadows.addShadowCaster(s.mesh, false);
      casterMeshes.push(s.mesh);
    }
  }

  // ---------- 草、花：各一個網格；每一叢有固定亂數鍵，密度 ρ 時畫鍵 < ρ 的 → 走動時零星增減，沒有整格切換 ----------
  const gTemplate = grassTemplate(scene);
  const fTemplate = flowerTemplate(scene);
  const makeLayer = (template: Mesh, list: TuftPlacement[], name: string, grid: number, seed: number, full: number, end: number): TuftLayer | null => {
    if (!list.length) return null;
    const n = list.length;
    const mesh = new Mesh(name, scene);
    VertexData.ExtractFromMesh(template).applyToMesh(mesh);
    mesh.material = tuftMat;
    const mats = new Float32Array(n * 16);
    const cols = new Float32Array(n * 4);
    const xs = new Float32Array(n);
    const zs = new Float32Array(n);
    const keys = new Float32Array(n);
    const csize = (2 * MAP_HALF) / grid;
    const buckets: number[][] = Array.from({ length: grid * grid }, () => []);
    list.forEach((p, i) => {
      Quaternion.RotationYawPitchRollToRef(p.rot, 0, 0, q);
      sv.set(p.scale, p.scale, p.scale);
      tv.set(p.x, p.y, p.z);
      Matrix.ComposeToRef(sv, q, tv, m4);
      m4.copyToArray(mats, i * 16);
      cols[i * 4] = p.r;
      cols[i * 4 + 1] = p.g;
      cols[i * 4 + 2] = p.b;
      cols[i * 4 + 3] = 1;
      xs[i] = p.x;
      zs[i] = p.z;
      keys[i] = instKey(i, seed);
      const ci = Math.min(grid - 1, Math.max(0, Math.floor((p.x + MAP_HALF) / csize)));
      const cj = Math.min(grid - 1, Math.max(0, Math.floor((p.z + MAP_HALF) / csize)));
      buckets[cj * grid + ci]!.push(i);
    });
    const cells = buckets.flatMap((b, idx) => {
      if (!b.length) return [];
      const i0 = idx % grid;
      const j0 = Math.floor(idx / grid);
      return [{ minX: -MAP_HALF + i0 * csize, maxX: -MAP_HALF + (i0 + 1) * csize, minZ: -MAP_HALF + j0 * csize, maxZ: -MAP_HALF + (j0 + 1) * csize, idx: Uint32Array.from(b) }];
    });
    // 包圍盒用全部實例算一次（之後只改數量）
    const liveM = new Float32Array(mats);
    const liveC = new Float32Array(cols);
    mesh.thinInstanceSetBuffer("matrix", liveM, 16, false);
    mesh.thinInstanceSetBuffer("color", liveC, 4, false);
    mesh.thinInstanceRefreshBoundingInfo(false);
    mesh.thinInstanceCount = 0;
    mesh.receiveShadows = false;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = false;
    mesh.freezeWorldMatrix();
    mesh.setEnabled(false);
    return { mesh, cells, xs, zs, keys, mats, cols, liveM, liveC, count: 0, tris: (template.getIndices()?.length ?? 0) / 3, full, end };
  };
  const grass = makeLayer(gTemplate, layout.grass, "PH_grass_near", GC, 101, cfg.grassFull, cfg.grassEnd);
  const flowers = makeLayer(fTemplate, layout.flowers, "PH_flowers_near", GC, 202, cfg.flowerFull, cfg.flowerEnd);
  const layers = [grass, flowers].filter((l): l is TuftLayer => !!l);
  gTemplate.dispose();
  fTemplate.dispose();

  // ---------- 更新：玩家移動 > 1 m、鏡頭水平轉 > 8°、或俯視切換時重算（站著不動不重算） ----------
  let enabled = true;
  let lastX = Infinity;
  let lastZ = Infinity;
  let lastFx = 0;
  let lastFz = 1;
  let lastOverview = false;
  const st: VegLodStats = { mode: "lod", hi: 0, mid: 0, lo: 0, culled: 0, grassShown: 0, flowersShown: 0, tris: 0, meshes: 0, casters: 0, drawnMeshes: 0, drawnTris: 0 };
  const fwd = new Vector3();

  const rebuildTrees = (px: number, pz: number, fx: number, fz: number, overview: boolean): void => {
    st.hi = st.mid = st.lo = st.culled = 0;
    for (const s of slots) s.count = 0;
    for (const g of groups) {
      const hiR = g.small ? cfg.smallHiR : cfg.hiR;
      const midR = g.small ? cfg.smallMidR : cfg.midR;
      const n = g.xs.length;
      for (let i = 0; i < n; i++) {
        const dx = g.xs[i]! - px;
        const dz = g.zs[i]! - pz;
        const d = Math.hypot(dx, dz);
        if (!overview && (d > cfg.farR || behindCamera(dx, dz, d, fx, fz, cfg.behindCos, cfg.behindR))) {
          st.culled++;
          g.prev[i] = null;
          continue;
        }
        const lvl: VegLevel = overview ? 2 : levelFor(d, g.prev[i] ?? null, hiR, midR, cfg.hyst);
        g.prev[i] = lvl;
        const s = g.slots[lvl];
        s.buf.set(g.mats.subarray(i * 16, i * 16 + 16), s.count * 16);
        s.count++;
        if (lvl === 0) st.hi++;
        else if (lvl === 1) st.mid++;
        else st.lo++;
      }
    }
    for (const s of slots) {
      s.mesh.thinInstanceCount = s.count;
      if (s.count > 0) {
        s.mesh.thinInstanceBufferUpdated("matrix");
        s.mesh.thinInstanceRefreshBoundingInfo(false);
      }
      const on = enabled && s.count > 0;
      if (s.mesh.isEnabled() !== on) s.mesh.setEnabled(on);
    }
  };

  const rebuildTufts = (px: number, pz: number, fx: number, fz: number, overview: boolean): void => {
    st.grassShown = 0;
    st.flowersShown = 0;
    for (const L of layers) {
      let n = 0;
      if (!overview && enabled) {
        for (const c of L.cells) {
          const bdx = Math.max(c.minX - px, 0, px - c.maxX);
          const bdz = Math.max(c.minZ - pz, 0, pz - c.maxZ);
          if (Math.hypot(bdx, bdz) >= L.end) continue;
          for (let k = 0; k < c.idx.length; k++) {
            const i = c.idx[k]!;
            const dx = L.xs[i]! - px;
            const dz = L.zs[i]! - pz;
            const d = Math.hypot(dx, dz);
            if (L.keys[i]! >= tuftDensity(d, L.full, L.end, cfg.tuftFloor)) continue;
            if (behindCamera(dx, dz, d, fx, fz, cfg.behindCos, cfg.behindR)) continue;
            L.liveM.set(L.mats.subarray(i * 16, i * 16 + 16), n * 16);
            L.liveC.set(L.cols.subarray(i * 4, i * 4 + 4), n * 4);
            n++;
          }
        }
      }
      L.count = n;
      L.mesh.thinInstanceCount = n;
      if (n > 0) {
        L.mesh.thinInstanceBufferUpdated("matrix");
        L.mesh.thinInstanceBufferUpdated("color");
      }
      const on = n > 0;
      if (L.mesh.isEnabled() !== on) L.mesh.setEnabled(on);
      if (L === grass) st.grassShown = n;
      else st.flowersShown = n;
    }
  };

  const view: VegetationView = {
    update(px, pz, overview) {
      if (!enabled) return;
      const cam = scene.activeCamera;
      let fx = lastFx;
      let fz = lastFz;
      if (cam) {
        cam.getDirectionToRef(Vector3.Forward(), fwd);
        const L = Math.hypot(fwd.x, fwd.z);
        if (L > 1e-4) {
          fx = fwd.x / L;
          fz = fwd.z / L;
        }
      }
      const moved = Math.hypot(px - lastX, pz - lastZ) > 1;
      const turned = fx * lastFx + fz * lastFz < Math.cos((8 * Math.PI) / 180);
      if (moved || turned || overview !== lastOverview) {
        rebuildTrees(px, pz, fx, fz, overview);
        rebuildTufts(px, pz, fx, fz, overview);
        lastX = px;
        lastZ = pz;
        lastFx = fx;
        lastFz = fz;
        lastOverview = overview;
      }
    },
    setEnabled(on) {
      enabled = on;
      for (const s of slots) s.mesh.setEnabled(on && s.count > 0);
      for (const L of layers) L.mesh.setEnabled(on && L.count > 0);
      if (on) lastX = Infinity; // 重新啟用時立刻重算
    },
    stats: () => {
      let tris = 0;
      let meshes = 0;
      for (const s of slots) {
        if (s.mesh.isEnabled()) {
          tris += s.count * s.tris;
          meshes++;
        }
      }
      for (const L of layers) {
        if (L.mesh.isEnabled()) {
          tris += L.count * L.tris;
          meshes++;
        }
      }
      const ss = vegSceneStats(scene);
      st.tris = Math.round(tris);
      st.meshes = meshes;
      st.drawnMeshes = ss.drawnMeshes;
      st.drawnTris = ss.drawnTris;
      st.casters = casterMeshes.filter((m) => m.isEnabled()).length;
      return {
        trees: layout.trees.length,
        smalls: layout.smalls.length,
        grass: layout.grass.length,
        flowers: layout.flowers.length,
        hiChunks: st.hi,
        grassCells: grass && grass.count > 0 ? 1 : 0,
        flowerCells: flowers && flowers.count > 0 ? 1 : 0,
        shadowChunks: st.casters,
        lod: { ...st },
      };
    },
  };
  return view;
}
