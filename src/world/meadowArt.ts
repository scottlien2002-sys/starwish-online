import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import { createRng, type Rng } from "../core/rng.ts";
import type { PropKind } from "./scatter.ts";

/**
 * W2-1 新手草原美術（程式化，日系明亮奇幻風）。
 * 原則：所有同類物件共用一個網格模板＋薄實例（thin instance）＝每種 1 個 draw call；
 * 顏色以頂點色烘焙「上亮下暗」的柔和明暗（假環境光遮蔽），不用額外貼圖與即時光源；
 * 全部不透明，不使用透明排序。
 */

// ---------------------------------------------------------------- 工具

type Shader = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => [number, number, number];

/** 依頂點位置與法線上色（烘焙明暗），讓多個零件合併後仍保有層次 */
export function shade(mesh: Mesh, fn: Shader): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const nor = mesh.getVerticesData(VertexBuffer.NormalKind)!;
  const colors = new Float32Array((pos.length / 3) * 4);
  for (let i = 0, c = 0; i < pos.length; i += 3, c += 4) {
    const [r, g, b] = fn(pos[i]!, pos[i + 1]!, pos[i + 2]!, nor[i]!, nor[i + 1]!, nor[i + 2]!);
    colors[c] = r;
    colors[c + 1] = g;
    colors[c + 2] = b;
    colors[c + 3] = 1;
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
}

function bake(mesh: Mesh): Mesh {
  mesh.bakeCurrentTransformIntoVertices();
  return mesh;
}

function merge(name: string, parts: Mesh[]): Mesh {
  const merged = Mesh.MergeMeshes(parts, true, true);
  if (!merged) throw new Error(`Merge failed: ${name}`);
  merged.name = name;
  return merged;
}

const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
type RGB = [number, number, number];

/** 以 3D 雜訊式的正弦組合做穩定的表面起伏（不需亂數狀態） */
function lumpy(x: number, y: number, z: number, seed: number): number {
  return (
    Math.sin(x * 5.1 + seed) * Math.sin(y * 4.3 + seed * 1.7) * Math.sin(z * 4.7 + seed * 0.6) * 0.6 +
    Math.sin(x * 9.7 - y * 7.1 + seed * 2.3) * 0.25 +
    Math.cos(z * 8.3 + x * 3.1 + seed) * 0.15
  );
}

function displace(mesh: Mesh, amount: number, seed: number): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!;
    const len = Math.hypot(x, y, z) || 1;
    const k = 1 + amount * lumpy(x, y, z, seed);
    pos[i] = (x / len) * len * k;
    pos[i + 1] = (y / len) * len * k;
    pos[i + 2] = (z / len) * len * k;
  }
  const idx = mesh.getIndices()!;
  const normals: number[] = [];
  if ((mesh.metadata as { smooth?: boolean } | null)?.smooth) {
    // 放射狀法線：圓潤、無接縫
    for (let i = 0; i < pos.length; i += 3) {
      const l = Math.hypot(pos[i]!, pos[i + 1]!, pos[i + 2]!) || 1;
      normals.push(pos[i]! / l, pos[i + 1]! / l, pos[i + 2]! / l);
    }
  } else {
    VertexData.ComputeNormals(pos, idx, normals);
  }
  mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
  mesh.updateVerticesData(VertexBuffer.NormalKind, normals);
}

/**
 * 圓球零件（樹冠、灌木、雲）。效能優化：改用共用頂點的 UV 球＋放射狀平滑法線，
 * 三角形數約為原本二十面體細分的 1/3，而且表面是平滑的（原本每個小面各自一個法線，看起來有稜角）。
 */
function blob(name: string, scene: Scene, r: number, x: number, y: number, z: number, sy = 1, segments = 8): Mesh {
  const m = MeshBuilder.CreateSphere(name, { diameter: r * 2, segments, updatable: true }, scene);
  m.metadata = { smooth: true };
  m.scaling.y = sy;
  m.position.set(x, y, z);
  return m;
}

// ---------------------------------------------------------------- 樹

const LEAF_PALETTES: Record<string, { dark: RGB; mid: RGB; light: RGB }> = {
  green: { dark: [0.18, 0.46, 0.34], mid: [0.36, 0.7, 0.36], light: [0.72, 0.9, 0.46] },
  spring: { dark: [0.26, 0.55, 0.3], mid: [0.48, 0.78, 0.36], light: [0.84, 0.94, 0.5] },
  blossom: { dark: [0.78, 0.46, 0.62], mid: [0.98, 0.7, 0.8], light: [1, 0.9, 0.93] },
};

function leafShader(p: { dark: RGB; mid: RGB; light: RGB }, bottom: number, top: number): Shader {
  return (_x, y, _z, _nx, ny) => {
    // 高度＋法線朝上 → 越亮；底部朝下 → 冷暗（柔和的日系兩階明暗）
    const h = clamp01((y - bottom) / (top - bottom));
    const up = ny * 0.5 + 0.5;
    const t = clamp01(0.15 + h * 0.45 + up * 0.5);
    return t < 0.55 ? mix(p.dark, p.mid, t / 0.55) : mix(p.mid, p.light, (t - 0.55) / 0.45);
  };
}

function trunk(name: string, scene: Scene, height: number, bottomD: number, topD: number, lean: number): Mesh {
  const t = MeshBuilder.CreateCylinder(name, { height, diameterTop: topD, diameterBottom: bottomD, tessellation: 10, subdivisions: 4, updatable: true }, scene);
  t.position.y = height / 2;
  bake(t);
  // 樹幹微彎＋根部外擴
  const pos = t.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < pos.length; i += 3) {
    const y = pos[i + 1]!;
    const k = y / height;
    const flare = 1 + Math.max(0, 0.18 - k) * 2.2;
    pos[i] = pos[i]! * flare + Math.sin(k * Math.PI) * lean;
    pos[i + 2] = pos[i + 2]! * flare;
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, t.getIndices()!, normals);
  t.updateVerticesData(VertexBuffer.PositionKind, pos);
  t.updateVerticesData(VertexBuffer.NormalKind, normals);
  shade(t, (_x, y, _z, nx, _ny, nz) => {
    const k = clamp01(y / height);
    const side = 0.85 + 0.15 * (nx * 0.6 + nz * 0.4);
    const c = mix([0.42, 0.28, 0.2], [0.66, 0.47, 0.32], k);
    return [c[0] * side, c[1] * side, c[2] * side];
  });
  return t;
}

/** 圓潤樹冠（主要樹種） */
function roundTree(name: string, scene: Scene, palette: { dark: RGB; mid: RGB; light: RGB }): Mesh {
  const tr = trunk(`${name}_trunk`, scene, 1.7, 0.42, 0.24, 0.06);
  const parts = [
    blob(`${name}_0`, scene, 1.15, 0, 2.35, 0, 0.88),
    blob(`${name}_1`, scene, 0.85, 0.7, 2.75, 0.25, 0.9),
    blob(`${name}_2`, scene, 0.8, -0.65, 2.65, -0.3, 0.9),
    blob(`${name}_3`, scene, 0.75, 0.15, 3.25, -0.2, 0.92),
    blob(`${name}_4`, scene, 0.7, -0.2, 2.1, 0.75, 0.85),
  ];
  for (const [i, p] of parts.entries()) {
    displace(p, 0.06, i * 1.9 + 0.7);
    bake(p);
  }
  const canopy = merge(`${name}_canopy`, parts);
  shade(canopy, leafShader(palette, 1.3, 3.9));
  return merge(name, [tr, canopy]);
}

/** 細高的橢圓樹（增加輪廓變化） */
function tallTree(name: string, scene: Scene, palette: { dark: RGB; mid: RGB; light: RGB }): Mesh {
  const tr = trunk(`${name}_trunk`, scene, 2.0, 0.36, 0.2, -0.05);
  const parts = [
    blob(`${name}_0`, scene, 0.85, 0, 2.3, 0, 1.15),
    blob(`${name}_1`, scene, 0.75, 0.1, 3.15, 0.05, 1.1),
    blob(`${name}_2`, scene, 0.55, -0.05, 3.85, -0.05, 1.05),
    blob(`${name}_3`, scene, 0.55, 0.45, 2.55, -0.2, 1),
  ];
  for (const [i, p] of parts.entries()) {
    displace(p, 0.05, i * 2.3 + 4.1);
    bake(p);
  }
  const canopy = merge(`${name}_canopy`, parts);
  shade(canopy, leafShader(palette, 1.5, 4.4));
  return merge(name, [tr, canopy]);
}

// ---------------------------------------------------------------- 岩石

function rock(name: string, scene: Scene, seed: number, stretch: [number, number, number]): Mesh {
  const r = MeshBuilder.CreateIcoSphere(name, { radius: 0.6, subdivisions: 2, flat: false, updatable: true }, scene);
  displace(r, 0.14, seed);
  r.scaling.set(...stretch);
  r.position.y = 0.6 * stretch[1] * 0.55;
  bake(r);
  const top = 0.6 * stretch[1] * 1.6;
  shade(r, (_x, y, _z, _nx, ny) => {
    const h = clamp01(y / top);
    // 薰衣草灰石＋頂面淡淡青苔、底部較深（柔和明暗）
    let c = mix([0.5, 0.49, 0.58], [0.84, 0.82, 0.9], clamp01(h * 0.6 + (ny * 0.5 + 0.5) * 0.5));
    if (ny > 0.55) c = mix(c, [0.55, 0.74, 0.46], clamp01((ny - 0.55) * 1.6) * 0.55);
    return c;
  });
  return r;
}

function rockPair(name: string, scene: Scene): Mesh {
  const a = rock(`${name}_a`, scene, 3.3, [1.15, 0.75, 1]);
  const b = rock(`${name}_b`, scene, 7.9, [0.6, 0.5, 0.55]);
  b.position.set(0.72, 0, 0.35);
  bake(b);
  return merge(name, [a, b]);
}

// ---------------------------------------------------------------- 灌木

function bush(name: string, scene: Scene, berries: RGB | null): Mesh {
  const parts = [
    blob(`${name}_0`, scene, 0.5, 0, 0.36, 0, 0.8, 6),
    blob(`${name}_1`, scene, 0.38, 0.42, 0.3, 0.12, 0.85, 6),
    blob(`${name}_2`, scene, 0.36, -0.38, 0.28, -0.1, 0.85, 6),
    blob(`${name}_3`, scene, 0.3, 0.05, 0.55, 0.25, 0.85, 6),
  ];
  for (const [i, p] of parts.entries()) {
    displace(p, 0.08, i * 3.1 + 1.3);
    bake(p);
  }
  const body = merge(`${name}_body`, parts);
  shade(body, leafShader(LEAF_PALETTES.green!, 0, 0.9));
  if (!berries) return body;
  const dots: Mesh[] = [];
  const rng = createRng(name.length * 31 + 7);
  for (let i = 0; i < 9; i++) {
    const a = rng.range(0, Math.PI * 2);
    const h = rng.range(0.25, 0.7);
    const d = MeshBuilder.CreateIcoSphere(`${name}_dot${i}`, { radius: 0.055, subdivisions: 1 }, scene);
    d.position.set(Math.cos(a) * 0.48, h, Math.sin(a) * 0.4);
    bake(d);
    shade(d, (_x, _y, _z, _nx, ny) => mix(berries, [1, 1, 1], clamp01(ny) * 0.35));
    dots.push(d);
  }
  return merge(name, [body, ...dots]);
}

// ---------------------------------------------------------------- 花

const STEM: RGB = [0.3, 0.6, 0.3];

function stem(name: string, scene: Scene, h: number): Mesh {
  const s = MeshBuilder.CreateCylinder(name, { height: h, diameterTop: 0.02, diameterBottom: 0.035, tessellation: 4 }, scene);
  s.position.y = h / 2;
  bake(s);
  shade(s, () => STEM);
  return s;
}

/** 雛菊型：中心＋一圈花瓣 */
function daisy(name: string, scene: Scene, petal: RGB, center: RGB, petals = 6): Mesh {
  const parts: Mesh[] = [stem(`${name}_s`, scene, 0.26)];
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const p = MeshBuilder.CreateSphere(`${name}_p${i}`, { diameter: 0.09, segments: 3 }, scene);
    p.scaling.set(1, 0.3, 0.55);
    p.rotation.y = -a;
    p.position.set(Math.cos(a) * 0.055, 0.28, Math.sin(a) * 0.055);
    bake(p);
    shade(p, (_x, _y, _z, _nx, ny) => mix(petal, [1, 1, 1], clamp01(ny) * 0.25));
    parts.push(p);
  }
  const c = MeshBuilder.CreateSphere(`${name}_c`, { diameter: 0.06, segments: 4 }, scene);
  c.position.y = 0.29;
  c.scaling.y = 0.6;
  bake(c);
  shade(c, () => center);
  parts.push(c);
  return merge(name, parts);
}

/** 鈴蘭／小花串：一根莖上幾顆小花苞 */
function bellCluster(name: string, scene: Scene, color: RGB): Mesh {
  const parts: Mesh[] = [stem(`${name}_s`, scene, 0.32)];
  const spots: [number, number, number][] = [
    [0.05, 0.3, 0],
    [-0.04, 0.26, 0.04],
    [0.0, 0.34, -0.04],
    [-0.05, 0.31, -0.02],
  ];
  for (const [i, [x, y, z]] of spots.entries()) {
    const b = MeshBuilder.CreateSphere(`${name}_b${i}`, { diameter: 0.07, segments: 4 }, scene);
    b.position.set(x, y, z);
    bake(b);
    shade(b, (_x, _y, _z, _nx, ny) => mix(color, [1, 1, 1], clamp01(ny) * 0.3));
    parts.push(b);
  }
  return merge(name, parts);
}

/** 鬱金香型：杯狀花＋一片葉 */
function tulip(name: string, scene: Scene, color: RGB): Mesh {
  const parts: Mesh[] = [stem(`${name}_s`, scene, 0.3)];
  const cup = MeshBuilder.CreateCylinder(`${name}_cup`, { height: 0.09, diameterTop: 0.11, diameterBottom: 0.06, tessellation: 6 }, scene);
  cup.position.y = 0.33;
  bake(cup);
  shade(cup, (_x, y) => mix(color, [1, 0.95, 0.9], clamp01((y - 0.29) / 0.09) * 0.35));
  const leaf = MeshBuilder.CreateSphere(`${name}_leaf`, { diameter: 0.16, segments: 3 }, scene);
  leaf.scaling.set(0.25, 1, 0.5);
  leaf.rotation.z = 0.5;
  leaf.position.set(0.04, 0.1, 0);
  bake(leaf);
  shade(leaf, () => [0.36, 0.66, 0.34]);
  parts.push(cup, leaf);
  return merge(name, parts);
}

// ---------------------------------------------------------------- 草叢（大量薄實例）

/** 一簇彎曲的草葉（6 片，底深頂亮）；法線統一朝上，光照與地面一致、沒有背面發黑 */
export function createGrassTuft(name: string, scene: Scene): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  // 柔和、可愛的草叢：較寬較短、底色接近地面（融入地面），尖端明亮
  const blades = 7;
  const segs = 3;
  const base: RGB = [0.42, 0.72, 0.32];
  const tip: RGB = [0.8, 0.95, 0.52];
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + b * 0.7;
    const r0 = 0.05 + (b % 3) * 0.03;
    const ox = Math.cos(a) * r0, oz = Math.sin(a) * r0;
    const h = 0.2 + ((b * 37) % 7) * 0.018;
    const w = 0.055;
    const bend = 0.09 + (b % 2) * 0.05;
    const px = -Math.sin(a), pz = Math.cos(a); // 葉片寬度方向
    const start = positions.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const cx = ox + Math.cos(a) * bend * t * t;
      const cz = oz + Math.sin(a) * bend * t * t;
      const y = h * t;
      // 葉尖圓鈍（不收成細針）
      const ww = w * (1 - t * t * 0.75);
      positions.push(cx - px * ww, y, cz - pz * ww, cx + px * ww, y, cz + pz * ww);
      const c = mix(base, tip, t);
      colors.push(c[0], c[1], c[2], 1, c[0], c[1], c[2], 1);
      normals.push(0, 1, 0, 0, 1, 0);
    }
    for (let s = 0; s < segs; s++) {
      const i0 = start + s * 2;
      indices.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2);
    }
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.colors = colors;
  vd.normals = normals;
  const m = new Mesh(name, scene);
  vd.applyToMesh(m);
  return m;
}

// ---------------------------------------------------------------- 模板總表

/** 花朵模板放大（原始尺寸在手機畫面上幾乎看不見） */
function enlarge(m: Mesh, k: number): Mesh {
  m.scaling.setAll(k);
  m.bakeCurrentTransformIntoVertices();
  return m;
}

export function createPropTemplatesV2(scene: Scene): Record<PropKind, Mesh[]> {
  const roundA = roundTree("PH_treeRound", scene, LEAF_PALETTES.green!);
  const roundB = roundTree("PH_treeRoundSpring", scene, LEAF_PALETTES.spring!);
  const tall = tallTree("PH_treeTall", scene, LEAF_PALETTES.green!);
  const blossom = roundTree("PH_treeBlossom", scene, LEAF_PALETTES.blossom!);
  return {
    // 同一模板出現多次＝提高出現比例（櫻花樹約 1/6，作為點綴）
    tree: [roundA, roundA, roundB, roundB, tall, blossom],
    rock: [rock("PH_rockA", scene, 1.7, [1.2, 0.72, 1]), rock("PH_rockB", scene, 5.2, [0.9, 0.9, 0.85]), rockPair("PH_rockPair", scene)],
    bush: [bush("PH_bush", scene, null), bush("PH_bushBerry", scene, [0.95, 0.42, 0.5]), bush("PH_bushBloom", scene, [1, 0.98, 1])],
    flower: [
      enlarge(daisy("PH_flowerDaisyWhite", scene, [1, 0.99, 0.97], [1, 0.84, 0.3]), 1.45),
      enlarge(daisy("PH_flowerDaisyPink", scene, [1, 0.66, 0.8], [1, 0.9, 0.5], 5), 1.45),
      enlarge(bellCluster("PH_flowerBellBlue", scene, [0.62, 0.78, 1]), 1.45),
      enlarge(bellCluster("PH_flowerBellLavender", scene, [0.8, 0.68, 1]), 1.45),
      enlarge(tulip("PH_flowerTulipYellow", scene, [1, 0.86, 0.32]), 1.45),
      enlarge(tulip("PH_flowerTulipCoral", scene, [1, 0.56, 0.52]), 1.45),
    ],
  };
}

// ---------------------------------------------------------------- 地面細節貼圖

/** 接近白色的細碎草紋（與頂點色相乘，增加近看細節；4 公尺重複一次） */
export function createGroundDetailTexture(scene: Scene, seed: number): DynamicTexture {
  const S = 256;
  const tex = new DynamicTexture("PH_groundDetail", { width: S, height: S }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = "#eef2ea";
  ctx.fillRect(0, 0, S, S);
  const rng = createRng(seed);
  // 柔和大斑（無縫：每個斑點在四個方向重複畫）
  const wrapDraw = (fn: (dx: number, dy: number) => void): void => {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(dx, dy);
  };
  for (let i = 0; i < 26; i++) {
    const x = rng.range(0, S), y = rng.range(0, S), r = rng.range(18, 46);
    const light = rng.next() > 0.5;
    wrapDraw((dx, dy) => {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      g.addColorStop(0, light ? "rgba(255,255,250,0.55)" : "rgba(200,214,196,0.45)");
      g.addColorStop(1, "rgba(238,242,234,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    });
  }
  // 細短草紋
  for (let i = 0; i < 900; i++) {
    const x = rng.range(0, S), y = rng.range(0, S);
    const len = rng.range(2, 6), a = rng.range(-0.6, 0.6) - Math.PI / 2;
    const light = rng.next() > 0.45;
    ctx.strokeStyle = light ? "rgba(255,255,255,0.7)" : "rgba(186,204,180,0.6)";
    ctx.lineWidth = 1;
    wrapDraw((dx, dy) => {
      ctx.beginPath();
      ctx.moveTo(x + dx, y + dy);
      ctx.lineTo(x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len);
      ctx.stroke();
    });
  }
  tex.update(true);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 4;
  return tex;
}

// ---------------------------------------------------------------- 遠景

/** 遠山兩層（遠：霧藍紫、近：柔綠），合併為一個網格；不受光、不受霧 */
export function createDistantHills(scene: Scene, seed: number): Mesh {
  const rng: Rng = createRng(seed);
  const ring = (radius: number, minH: number, maxH: number, low: RGB, high: RGB, segs: number, phase: number): Mesh => {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const heights: number[] = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const n = 0.5 + 0.3 * Math.sin(a * 3 + phase) + 0.2 * Math.sin(a * 7 + phase * 2.1) + rng.range(-0.08, 0.08);
      heights.push(minH + (maxH - minH) * clamp01(n));
    }
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const h = heights[i % segs]!;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      positions.push(x, -8, z, x, h, z);
      colors.push(low[0], low[1], low[2], 1, high[0], high[1], high[2], 1);
    }
    for (let i = 0; i < segs; i++) {
      const b = i * 2;
      // 從內側看得到（法線朝圓心）
      indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
    const vd = new VertexData();
    vd.positions = positions;
    vd.colors = colors;
    vd.indices = indices;
    const m = new Mesh(`PH_hills_${radius}`, scene);
    vd.applyToMesh(m);
    return m;
  };
  const far = ring(260, 28, 70, [0.78, 0.85, 0.97], [0.66, 0.74, 0.95], 72, 0.4);
  const near = ring(175, 10, 30, [0.7, 0.86, 0.78], [0.55, 0.78, 0.62], 64, 2.2);
  const hills = merge("PH_distantHills", [far, near]);
  const mat = new StandardMaterial("PH_hillsMat", scene);
  mat.disableLighting = true;
  mat.emissiveColor = Color3.White();
  mat.backFaceCulling = false;
  mat.fogEnabled = false;
  hills.material = mat;
  hills.isPickable = false;
  hills.applyFog = false;
  hills.freezeWorldMatrix();
  return hills;
}

/** 蓬鬆的雲（每朵由數顆圓球組成），全部合併為一個網格、以父節點緩慢旋轉 */
export function createCloudLayer(scene: Scene, seed: number): TransformNode {
  const rng = createRng(seed);
  const parts: Mesh[] = [];
  for (let c = 0; c < 10; c++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(90, 170);
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r, cy = rng.range(38, 58);
    const size = rng.range(6, 11);
    const puffs = 4 + Math.floor(rng.next() * 3);
    for (let p = 0; p < puffs; p++) {
      const s = blob(`PH_cloud${c}_${p}`, scene, size * rng.range(0.55, 1), cx + (p - puffs / 2) * size * 0.7, cy + rng.range(-1, 2), cz + rng.range(-3, 3), 0.62, 6);
      s.rotation.y = -a;
      bake(s);
      parts.push(s);
    }
  }
  const clouds = merge("PH_clouds", parts);
  shade(clouds, (_x, _y, _z, _nx, ny) => {
    const k = clamp01(ny * 0.5 + 0.5);
    return mix([0.82, 0.86, 0.96], [1, 1, 1], k);
  });
  const mat = new StandardMaterial("PH_cloudMat", scene);
  mat.disableLighting = true;
  mat.emissiveColor = Color3.White();
  mat.fogEnabled = false;
  clouds.material = mat;
  clouds.isPickable = false;
  clouds.applyFog = false;
  const pivot = new TransformNode("PH_cloudPivot", scene);
  clouds.parent = pivot;
  return pivot;
}

/** 出生廣場：石板圓台＋外圈石緣＋星形花紋（合併為一個網格） */
export function createPlaza(scene: Scene, y: number): Mesh {
  const base = MeshBuilder.CreateCylinder("PH_plazaBase", { diameter: 9, height: 0.14, tessellation: 48 }, scene);
  base.position.y = y + 0.04;
  bake(base);
  shade(base, (x, _y, z) => {
    // 同心石板紋：每 0.9 公尺一圈，深淺交錯
    const r = Math.hypot(x, z);
    const ring = Math.floor(r / 0.9) % 2;
    const ang = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * (8 + Math.floor(r) * 4)) % 2;
    const v = ring ^ ang ? 0.97 : 0.92;
    return [v, v * 0.94, v * 0.82];
  });
  const rim = MeshBuilder.CreateTorus("PH_plazaRim", { diameter: 9.1, thickness: 0.32, tessellation: 56 }, scene);
  rim.scaling.y = 0.55;
  rim.position.y = y + 0.08;
  bake(rim);
  shade(rim, (_x, _y, _z, _nx, ny) => mix([0.82, 0.76, 0.72], [0.98, 0.95, 0.9], clamp01(ny * 0.5 + 0.5)));
  const star = MeshBuilder.CreateCylinder("PH_plazaStar", { diameter: 3.2, height: 0.16, tessellation: 5 }, scene);
  star.position.y = y + 0.06;
  bake(star);
  shade(star, () => [1, 0.84, 0.46]);
  const inner = MeshBuilder.CreateTorus("PH_plazaInner", { diameter: 4.4, thickness: 0.1, tessellation: 40 }, scene);
  inner.scaling.y = 0.4;
  inner.position.y = y + 0.11;
  bake(inner);
  shade(inner, () => [0.95, 0.78, 0.55]);
  const plaza = merge("PH_plaza", [base, rim, star, inner]);
  const mat = new StandardMaterial("PH_plazaMat", scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = new Color3(0.04, 0.04, 0.04);
  plaza.material = mat;
  plaza.receiveShadows = true;
  plaza.isPickable = false;
  plaza.freezeWorldMatrix();
  return plaza;
}

