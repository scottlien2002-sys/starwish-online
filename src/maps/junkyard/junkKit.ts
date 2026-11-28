/**
 * 星廢垃圾場：共用材質與程式化模型零件（日系奇幻、明亮配色；全部用頂點色＋少數共用材質）。
 * - 材質全場共用（約 10 個）；貼圖只有 1 張 128×128 雜訊（金屬／木頭／土的顆粒感）＋旗幟徽章＋粒子圓點
 * - 零件先以 MeshBuilder 建立、上頂點色，再依材質合併（Kit.bake），一組地標通常只有 2～4 次繪製
 * - 重複出現的小垃圾（罐子、齒輪、木箱、輪胎…）由 scatter 以 thin instances 實例化
 */
import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  RawTexture,
  type Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";

import { groundTexels, slabTexels } from "../../world/texGen.ts";

export type Rgb = readonly [number, number, number];

// ---------------- 調色盤（參考概念圖：暖色鏽鐵、青綠烤漆、木頭、苔蘚、紫粉水晶） ----------------
export const PAL = {
  rust: [0.72, 0.42, 0.24],
  rustDark: [0.5, 0.3, 0.2],
  iron: [0.56, 0.58, 0.62],
  ironDark: [0.36, 0.38, 0.42],
  steel: [0.74, 0.77, 0.8],
  teal: [0.28, 0.6, 0.6],
  tealDark: [0.2, 0.42, 0.45],
  green: [0.36, 0.6, 0.34],
  yellow: [0.95, 0.75, 0.25],
  orange: [0.95, 0.52, 0.2],
  red: [0.8, 0.28, 0.22],
  blue: [0.3, 0.5, 0.82],
  cream: [0.92, 0.86, 0.72],
  wood: [0.62, 0.44, 0.28],
  woodDark: [0.44, 0.3, 0.2],
  moss: [0.42, 0.62, 0.26],
  stone: [0.62, 0.6, 0.56],
  black: [0.16, 0.16, 0.18],
  gold: [0.95, 0.76, 0.32],
  violet: [0.66, 0.46, 0.95],
  pink: [0.98, 0.56, 0.82],
  cyan: [0.4, 0.9, 1],
} as const satisfies Record<string, Rgb>;

export type MatKey = "paint" | "metal" | "glowOrange" | "glowBlue" | "glowGreen" | "crystal" | "cloth" | "foliage" | "belt";

export interface JunkMaterials {
  paint: StandardMaterial;
  metal: StandardMaterial;
  glowOrange: StandardMaterial;
  glowBlue: StandardMaterial;
  glowGreen: StandardMaterial;
  crystal: StandardMaterial;
  cloth: StandardMaterial;
  foliage: StandardMaterial;
  belt: StandardMaterial;
  terrain: StandardMaterial;
  /** 高台鋪面（混凝土／鐵板縫線；頂點透明度讓邊緣自然破損） */
  pavement: StandardMaterial;
  water: StandardMaterial;
  grit: Texture;
  dot: Texture;
  /** 遠處閃爍燈（3 組相位） */
  flicker: StandardMaterial[];
}

/** 可重複的 128×128 雜訊（值雜訊＋細顆粒）：灰階，平均約 0.88，讓頂點色有材質感 */
function makeGrit(scene: Scene): Texture {
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  // 4×4 與 16×16 的週期值雜訊（可無縫重複）
  const lattice = (p: number, seed: number): number[] => {
    const out: number[] = [];
    let s = seed;
    for (let i = 0; i < p * p; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      out.push((s >>> 8) / 16777216);
    }
    return out;
  };
  const L1 = lattice(8, 7);
  const L2 = lattice(32, 99);
  const sample = (L: number[], p: number, u: number, v: number): number => {
    const x = u * p;
    const y = v * p;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const g = (a: number, b: number): number => L[((b % p) + p) % p * p + (((a % p) + p) % p)]!;
    const a = g(i, j) + (g(i + 1, j) - g(i, j)) * sx;
    const b = g(i, j + 1) + (g(i + 1, j + 1) - g(i, j + 1)) * sx;
    return a + (b - a) * sy;
  };
  let s = 12345;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      s = (s * 1103515245 + 12345) >>> 0;
      const fine = ((s >>> 16) & 255) / 255;
      const v = 0.8 + 0.12 * sample(L1, 8, x / N, y / N) + 0.08 * sample(L2, 32, x / N, y / N) + 0.04 * (fine - 0.5);
      const c = Math.max(0, Math.min(255, Math.round(v * 255)));
      const k = (y * N + x) * 4;
      data[k] = c;
      data[k + 1] = c;
      data[k + 2] = c;
      data[k + 3] = 255;
    }
  }
  const t = RawTexture.CreateRGBATexture(data, N, N, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.name = "jy_grit";
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  return t;
}

/** 柔和圓點（粒子用） */
function makeDot(scene: Scene): Texture {
  const t = new DynamicTexture("jy_dot", { width: 64, height: 64 }, scene, false);
  const ctx = t.getContext() as unknown as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  t.hasAlpha = true;
  t.update();
  return t;
}

/** 回收旗幟：綠底、白色三箭頭循環圖示（概念圖的綠色旗） */
function makeBannerTex(scene: Scene): DynamicTexture {
  const t = new DynamicTexture("jy_banner", { width: 128, height: 256 }, scene, true);
  const ctx = t.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = "#3f8f5a";
  ctx.fillRect(0, 0, 128, 256);
  ctx.fillStyle = "#2f6f46";
  ctx.fillRect(0, 0, 128, 14);
  ctx.fillRect(0, 230, 128, 26);
  ctx.strokeStyle = "#f4f1e0";
  ctx.fillStyle = "#f4f1e0";
  ctx.lineWidth = 10;
  const cx = 64;
  const cy = 120;
  for (let i = 0; i < 3; i++) {
    const a0 = -Math.PI / 2 + (i * Math.PI * 2) / 3 + 0.25;
    const a1 = a0 + 1.45;
    ctx.beginPath();
    ctx.arc(cx, cy, 34, a0, a1);
    ctx.stroke();
    const ax = cx + Math.cos(a1) * 34;
    const ay = cy + Math.sin(a1) * 34;
    const tx = -Math.sin(a1);
    const ty = Math.cos(a1);
    ctx.beginPath();
    ctx.moveTo(ax + tx * 12, ay + ty * 12);
    ctx.lineTo(ax - Math.cos(a1) * 11, ay - Math.sin(a1) * 11);
    ctx.lineTo(ax + Math.cos(a1) * 11, ay + Math.sin(a1) * 11);
    ctx.closePath();
    ctx.fill();
  }
  // 下緣鋸齒
  ctx.fillStyle = "rgba(0,0,0,0)";
  t.update();
  return t;
}

export function createJunkMaterials(scene: Scene, tier: "high" | "medium" | "low"): JunkMaterials {
  const grit = makeGrit(scene);
  const dot = makeDot(scene);
  const std = (name: string, spec: number, specPow: number): StandardMaterial => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = Color3.White();
    m.specularColor = new Color3(spec, spec, spec);
    m.specularPower = specPow;
    m.diffuseTexture = grit;
    return m;
  };
  const paint = std("jy_paint", 0.08, 16);
  const metal = std("jy_metal", 0.32, 40);
  const glow = (name: string, c: Color3): StandardMaterial => {
    const m = new StandardMaterial(name, scene);
    m.disableLighting = true;
    m.emissiveColor = c;
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    return m;
  };
  const glowOrange = glow("jy_glowOrange", new Color3(1, 0.62, 0.22));
  const glowBlue = glow("jy_glowBlue", new Color3(0.35, 0.85, 1));
  const glowGreen = glow("jy_glowGreen", new Color3(0.55, 1, 0.6));
  const crystal = new StandardMaterial("jy_crystal", scene);
  crystal.diffuseColor = Color3.White();
  crystal.emissiveColor = new Color3(0.35, 0.3, 0.42);
  crystal.specularColor = new Color3(0.9, 0.9, 1);
  crystal.specularPower = 64;
  const cloth = new StandardMaterial("jy_cloth", scene);
  cloth.diffuseTexture = makeBannerTex(scene);
  cloth.specularColor = Color3.Black();
  cloth.backFaceCulling = false;
  cloth.emissiveColor = new Color3(0.12, 0.12, 0.12);
  const foliage = new StandardMaterial("jy_foliage", scene);
  foliage.diffuseColor = Color3.White();
  foliage.specularColor = Color3.Black();
  foliage.backFaceCulling = false;
  foliage.emissiveColor = new Color3(0.08, 0.1, 0.06);
  const belt = std("jy_belt", 0.05, 8);
  belt.diffuseTexture = grit.clone();
  (belt.diffuseTexture as Texture).uScale = 6;
  const terrain = new StandardMaterial("jy_terrain", scene);
  terrain.diffuseColor = Color3.White();
  terrain.specularColor = new Color3(0.03, 0.03, 0.03);
  // V2：地面專用貼圖（雲狀明暗＋小石子＋碎斑），比共用顆粒貼圖細緻；低畫質用較小的貼圖
  const gN = tier === "high" ? 512 : 256;
  const groundTex = RawTexture.CreateRGBATexture(groundTexels(gN, 11), gN, gN, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  groundTex.name = "jy_groundTex";
  groundTex.wrapU = Texture.WRAP_ADDRESSMODE;
  groundTex.wrapV = Texture.WRAP_ADDRESSMODE;
  groundTex.anisotropicFilteringLevel = tier === "low" ? 1 : 4;
  terrain.diffuseTexture = groundTex;
  const pavement = new StandardMaterial("jy_pavement", scene);
  pavement.diffuseColor = Color3.White();
  pavement.specularColor = new Color3(0.06, 0.06, 0.06);
  pavement.specularPower = 24;
  const sN = tier === "high" ? 512 : 256;
  const slabTex = RawTexture.CreateRGBATexture(slabTexels(sN, 23), sN, sN, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  slabTex.name = "jy_slabTex";
  slabTex.wrapU = Texture.WRAP_ADDRESSMODE;
  slabTex.wrapV = Texture.WRAP_ADDRESSMODE;
  slabTex.anisotropicFilteringLevel = tier === "low" ? 1 : 4;
  pavement.diffuseTexture = slabTex;
  pavement.zOffset = -2;
  const water = new StandardMaterial("jy_water", scene);
  water.diffuseColor = new Color3(0.25, 0.62, 0.85);
  water.emissiveColor = new Color3(0.12, 0.34, 0.5);
  water.specularColor = new Color3(0.8, 0.9, 1);
  water.specularPower = 48;
  water.alpha = tier === "low" ? 0.9 : 0.78;
  water.diffuseTexture = grit.clone();
  (water.diffuseTexture as Texture).uScale = 0.3;
  (water.diffuseTexture as Texture).vScale = 0.3;
  const flicker = [0, 1, 2].map((i) => glow(`jy_flicker${i}`, new Color3(1, 0.7, 0.3)));
  for (const m of [paint, metal, belt, terrain, pavement, foliage, crystal, cloth]) m.maxSimultaneousLights = 2;
  return { paint, metal, glowOrange, glowBlue, glowGreen, crystal, cloth, foliage, belt, terrain, pavement, water, grit, dot, flicker };
}

// ---------------- 零件與合併 ----------------

/** 幫網格上頂點色（整個網格同色；jitter 讓每個頂點有少量明暗差） */
export function paintMesh(m: Mesh, c: Rgb, jitter = 0.05, seed = 1): Mesh {
  const n = m.getTotalVertices();
  const cols = new Float32Array(n * 4);
  let s = seed * 9301 + 49297;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    const j = 1 + (((s >>> 16) & 255) / 255 - 0.5) * 2 * jitter;
    cols[i * 4] = Math.min(1, c[0] * j);
    cols[i * 4 + 1] = Math.min(1, c[1] * j);
    cols[i * 4 + 2] = Math.min(1, c[2] * j);
    cols[i * 4 + 3] = 1;
  }
  m.setVerticesData(VertexBuffer.ColorKind, cols);
  return m;
}

/** 依頂點高度（本地 Y）做上下漸層（例如鏽蝕從底部往上） */
export function gradientMesh(m: Mesh, bottom: Rgb, top: Rgb, y0: number, y1: number): Mesh {
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  const n = pos.length / 3;
  const cols = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, Math.max(0, (pos[i * 3 + 1]! - y0) / (y1 - y0 || 1)));
    cols[i * 4] = bottom[0] + (top[0] - bottom[0]) * t;
    cols[i * 4 + 1] = bottom[1] + (top[1] - bottom[1]) * t;
    cols[i * 4 + 2] = bottom[2] + (top[2] - bottom[2]) * t;
    cols[i * 4 + 3] = 1;
  }
  m.setVerticesData(VertexBuffer.ColorKind, cols);
  return m;
}

/**
 * 地標組裝器：零件依材質分組，最後每組合併成 1 個網格。
 * 零件可掛在 parent（例如吊車旋轉部分），bake 時同一 parent 同一材質才合併。
 */
export class Kit {
  private readonly groups = new Map<string, { mat: MatKey; parent: TransformNode | null; parts: Mesh[] }>();
  private seq = 0;
  readonly scene: Scene;
  readonly mats: JunkMaterials;
  readonly name: string;
  constructor(scene: Scene, mats: JunkMaterials, name: string) {
    this.scene = scene;
    this.mats = mats;
    this.name = name;
  }

  add(m: Mesh, c: Rgb | null, mat: MatKey = "paint", parent: TransformNode | null = null, jitter = 0.05): Mesh {
    if (c) paintMesh(m, c, jitter, ++this.seq);
    else if (!m.isVerticesDataPresent(VertexBuffer.ColorKind)) paintMesh(m, [1, 1, 1], 0, ++this.seq);
    const key = `${mat}|${parent ? parent.uniqueId : "root"}`;
    let g = this.groups.get(key);
    if (!g) {
      g = { mat, parent, parts: [] };
      this.groups.set(key, g);
    }
    g.parts.push(m);
    return m;
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, c: Rgb, mat: MatKey = "paint", rot: [number, number, number] = [0, 0, 0], parent: TransformNode | null = null): Mesh {
    const m = MeshBuilder.CreateBox("jy_part", { width: w, height: h, depth: d }, this.scene);
    m.position.set(x, y, z);
    m.rotation.set(rot[0], rot[1], rot[2]);
    return this.add(m, c, mat, parent);
  }

  cyl(dTop: number, dBot: number, h: number, x: number, y: number, z: number, c: Rgb, mat: MatKey = "paint", tess = 10, rot: [number, number, number] = [0, 0, 0], parent: TransformNode | null = null): Mesh {
    const m = MeshBuilder.CreateCylinder("jy_part", { diameterTop: dTop, diameterBottom: dBot, height: h, tessellation: tess }, this.scene);
    m.position.set(x, y, z);
    m.rotation.set(rot[0], rot[1], rot[2]);
    return this.add(m, c, mat, parent);
  }

  torus(d: number, thick: number, x: number, y: number, z: number, c: Rgb, mat: MatKey = "paint", tess = 20, rot: [number, number, number] = [0, 0, 0], parent: TransformNode | null = null): Mesh {
    const m = MeshBuilder.CreateTorus("jy_part", { diameter: d, thickness: thick, tessellation: tess }, this.scene);
    m.position.set(x, y, z);
    m.rotation.set(rot[0], rot[1], rot[2]);
    return this.add(m, c, mat, parent);
  }

  sphere(d: number, x: number, y: number, z: number, c: Rgb, mat: MatKey = "paint", seg = 8, scale: [number, number, number] = [1, 1, 1], parent: TransformNode | null = null): Mesh {
    const m = MeshBuilder.CreateSphere("jy_part", { diameter: d, segments: seg }, this.scene);
    m.position.set(x, y, z);
    m.scaling.set(scale[0], scale[1], scale[2]);
    return this.add(m, c, mat, parent);
  }

  /** 線段方向的方柱（桁架、欄杆） */
  beam(a: Vector3, b: Vector3, w: number, c: Rgb, mat: MatKey = "metal", parent: TransformNode | null = null): Mesh {
    const len = Vector3.Distance(a, b);
    const m = MeshBuilder.CreateBox("jy_part", { width: w, height: len, depth: w }, this.scene);
    m.position = Vector3.Center(a, b);
    const dir = b.subtract(a).normalize();
    const up = Vector3.Up();
    const axis = Vector3.Cross(up, dir);
    const ang = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(up, dir))));
    if (axis.lengthSquared() > 1e-8) {
      axis.normalize();
      m.rotate(axis, ang);
    } else if (dir.y < 0) m.rotation.x = Math.PI;
    return this.add(m, c, mat, parent);
  }

  /** 依材質合併；回傳合併後的網格（每組 1 個） */
  bake(): Mesh[] {
    const out: Mesh[] = [];
    for (const g of this.groups.values()) {
      if (!g.parts.length) continue;
      const merged = g.parts.length === 1 ? g.parts[0]! : Mesh.MergeMeshes(g.parts, true, true, undefined, false, false);
      if (!merged) continue;
      merged.name = `${this.name}_${g.mat}`;
      merged.material = this.mats[g.mat];
      if (g.parent) merged.parent = g.parent;
      merged.isPickable = false;
      merged.freezeNormals();
      if (!g.parent) merged.freezeWorldMatrix();
      out.push(merged);
    }
    this.groups.clear();
    return out;
  }
}

// ---------------- 小垃圾（thin instance 的來源網格；本地原點在底部） ----------------
export type JunkType = "can" | "crate" | "barrel" | "tire" | "gear" | "plate" | "tv" | "pipe" | "rock" | "spring" | "pallet" | "cone" | "coil";
export const JUNK_TYPES: readonly JunkType[] = ["can", "crate", "barrel", "tire", "gear", "plate", "tv", "pipe", "rock", "spring", "pallet", "cone", "coil"];

/** 建立一種小垃圾的來源網格（已合併、有頂點色；材質由呼叫端決定） */
export function junkSource(scene: Scene, mats: JunkMaterials, type: JunkType, lite: boolean): Mesh {
  const k = new Kit(scene, mats, `jy_src_${type}`);
  // 低面數：每件約 20～110 面（遠看靠輪廓與配色；近看有顆粒貼圖）
  const t = lite ? 6 : 8;
  switch (type) {
    case "can": {
      k.cyl(0.7, 0.7, 1.0, 0, 0.5, 0, PAL.steel, "paint", t);
      k.cyl(0.72, 0.72, 0.38, 0, 0.52, 0, PAL.red, "paint", t);
      break;
    }
    case "crate": {
      k.box(1, 1, 1, 0, 0.5, 0, PAL.wood);
      k.box(1.04, 0.14, 1.04, 0, 0.12, 0, PAL.woodDark);
      k.box(1.04, 0.14, 1.04, 0, 0.88, 0, PAL.woodDark);
      break;
    }
    case "barrel": {
      k.cyl(0.8, 0.8, 1.15, 0, 0.575, 0, PAL.teal, "paint", t + 2);
      k.cyl(0.84, 0.84, 0.1, 0, 0.3, 0, PAL.ironDark, "paint", t + 2);
      k.cyl(0.84, 0.84, 0.1, 0, 0.85, 0, PAL.ironDark, "paint", t + 2);
      break;
    }
    case "tire": {
      k.torus(1.05, 0.34, 0, 0.17, 0, PAL.black, "paint", lite ? 6 : 8);
      break;
    }
    case "gear": {
      const teeth = lite ? 6 : 8;
      k.cyl(1.2, 1.2, 0.22, 0, 0.11, 0, PAL.rust, "paint", lite ? 8 : 12);
      for (let i = 0; i < teeth; i++) {
        const a = (i / teeth) * Math.PI * 2;
        k.box(0.24, 0.2, 0.24, Math.cos(a) * 0.66, 0.1, Math.sin(a) * 0.66, PAL.rustDark, "paint", [0, -a, 0]);
      }
      break;
    }
    case "plate": {
      k.box(1.6, 0.08, 1.0, 0, 0.04, 0, PAL.tealDark, "paint", [0, 0, 0.08]);
      k.box(1.0, 0.08, 0.7, 0.3, 0.12, 0.1, PAL.rust, "paint", [0.12, 0.3, 0]);
      break;
    }
    case "tv": {
      k.box(1.0, 0.8, 0.8, 0, 0.4, 0, PAL.cream);
      k.box(0.78, 0.6, 0.04, 0, 0.42, 0.41, PAL.tealDark);
      break;
    }
    case "pipe": {
      k.cyl(0.5, 0.5, 2.2, 0, 0.25, 0, PAL.iron, "paint", t, [0, 0, Math.PI / 2]);
      break;
    }
    case "rock": {
      const m = MeshBuilder.CreatePolyhedron("jy_part", { type: 2, size: 0.6 }, scene);
      m.scaling.set(1.3, 0.7, 1);
      m.position.y = 0.3;
      k.add(m, PAL.stone, "paint");
      break;
    }
    case "pallet": {
      // 木棧板：上層 5 片、下層 3 根橫木（約 1.2 × 1.0 m）
      for (let i = 0; i < 5; i++) k.box(0.2, 0.05, 1.0, -0.48 + i * 0.24, 0.155, 0, i % 2 ? PAL.wood : [0.68, 0.5, 0.32]);
      for (let i = 0; i < 3; i++) k.box(1.2, 0.11, 0.14, 0, 0.065, -0.42 + i * 0.42, PAL.woodDark);
      break;
    }
    case "cone": {
      // 交通錐：橘色錐身＋白色反光帶＋方形底座
      k.box(0.46, 0.05, 0.46, 0, 0.025, 0, PAL.black);
      k.cyl(0.06, 0.34, 0.6, 0, 0.35, 0, PAL.orange, "paint", t);
      k.cyl(0.19, 0.23, 0.1, 0, 0.42, 0, PAL.cream, "paint", t);
      break;
    }
    case "coil": {
      // 電纜捲盤：兩片圓盤＋中間纏線
      k.cyl(1.0, 1.0, 0.07, 0, 0.5, -0.3, PAL.wood, "paint", t + 4, [Math.PI / 2, 0, 0]);
      k.cyl(1.0, 1.0, 0.07, 0, 0.5, 0.3, PAL.wood, "paint", t + 4, [Math.PI / 2, 0, 0]);
      k.cyl(0.72, 0.72, 0.54, 0, 0.5, 0, PAL.tealDark, "paint", t + 2, [Math.PI / 2, 0, 0]);
      break;
    }
    case "spring": {
      for (let i = 0; i < 3; i++) k.cyl(0.5, 0.5, 0.07, 0, 0.1 + i * 0.2, 0, PAL.steel, "paint", 6, [0.12 * (i % 2 ? 1 : -1), 0, 0]);
      break;
    }
  }
  const [m] = k.bake();
  m!.material = null;
  m!.unfreezeWorldMatrix();
  return m!;
}

export const LABEL_COLORS: readonly Rgb[] = [PAL.red, PAL.yellow, PAL.blue, PAL.green, PAL.orange, PAL.teal];

export const vec = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
export const col4 = (c: Rgb, a = 1): Color4 => new Color4(c[0], c[1], c[2], a);
