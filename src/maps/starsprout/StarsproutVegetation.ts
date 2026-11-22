import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, type Scene, type ShadowGenerator, StandardMaterial, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import { MAP_HALF } from "./layout.ts";
import type { SmallKind, SmallPlacement, TreeKind, TreePlacement, TuftPlacement, VegetationLayout } from "./vegetation.ts";
import type { MapLod } from "./StarsproutWorld.ts";

/**
 * Stage 6 P2-1：植被畫面層。
 * - 樹、灌木、岩石：每塊地形（4×4）烘焙成「近景精細」與「遠景簡化」兩個網格，共用一個頂點色材質
 *   → 近處 2～4 塊用精細版，其他用簡化版；每塊只有 1 次繪製
 * - 草叢、花：8×8 小格，每格用 thin instances（同一模型只畫一次），超過距離整格隱藏
 * - 草與花不投影、不接收陰影；只有 HQ 近處的樹投影
 * 名稱以 PH_ 開頭：程式產生的第一版場景模型，之後可由美術模型替換
 */

interface Geo {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

type RGB = [number, number, number];
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** 取出網格資料並依位置上色（之後網格本身丟掉） */
function geoOf(mesh: Mesh, color: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => RGB): Geo {
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

function joinGeo(parts: Geo[]): Geo {
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

function blobTree(scene: Scene, kind: Exclude<TreeKind, "pine">, hi: boolean): Geo {
  const s = STYLE[kind];
  const seg = hi ? 4 : 2;
  const parts: Geo[] = [trunkGeo(scene, kind === "cherry" ? 2.4 : 2.6, 0.3, 0.52, hi ? 7 : 4, s.trunk)];
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

function pineTree(scene: Scene, hi: boolean): Geo {
  const tess = hi ? 12 : 6;
  const parts: Geo[] = [trunkGeo(scene, 1.6, 0.24, 0.42, hi ? 7 : 5, [0.48, 0.34, 0.26])];
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
function bushGeo(scene: Scene, flowered: boolean, hi: boolean): Geo {
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
  if (flowered && hi) {
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
    const h = 0.34 + (b % 3) * 0.1;
    const i0 = positions.length / 3;
    // 底部兩點、中段兩點、尖端一點（稍微往外彎）
    positions.push(ox - dx * 0.075, 0, oz - dz * 0.075, ox + dx * 0.075, 0, oz + dz * 0.075);
    positions.push(ox - dx * 0.05 - dz * lean * 0.4, h * 0.55, oz - dz * 0.05 + dx * lean * 0.4, ox + dx * 0.05 - dz * lean * 0.4, h * 0.55, oz + dz * 0.05 + dx * lean * 0.4);
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
    [0, 0, 0.3, 0.085],
    [0.13, 0.06, 0.22, 0.07],
    [-0.09, 0.11, 0.26, 0.075],
  ];
  for (const [hx, hz, hy, r] of heads) {
    // 莖（細長三角形，兩面）
    const s0 = positions.length / 3;
    positions.push(hx - 0.012, 0, hz, hx + 0.012, 0, hz, hx, hy, hz);
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
interface Placed {
  geo: Geo;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
}

function bake(scene: Scene, name: string, items: Placed[], mat: StandardMaterial): Mesh | null {
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

export interface VegetationView {
  /** 每幀依玩家位置切換近景精細／遠景簡化、草花顯示格 */
  update(px: number, pz: number, overview: boolean): void;
  setEnabled(on: boolean): void;
  stats(): { trees: number; smalls: number; grass: number; flowers: number; hiChunks: number; grassCells: number; flowerCells: number; shadowChunks: number };
}

const CH = 4;
const GC = 8;

export function buildVegetationView(scene: Scene, layout: VegetationLayout, lod: MapLod, shadows: ShadowGenerator | null): VegetationView {
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
    }),
  };
  return view;
}
