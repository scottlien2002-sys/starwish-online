import {
  type AbstractEngine,
  type BaseTexture,
  type MaterialDefines,
  Color3,
  DynamicTexture,
  type Material,
  MaterialPluginBase,
  Mesh,
  type Scene,
  StandardMaterial,
  Texture,
  type UniformBuffer,
  VertexData,
} from "@babylonjs/core";
import { BOARD, BUILDINGS, FORGE, NPC_SPOTS, PORTALS, ROAD_HALF, SOUTH_GATE, WALK_RADIUS, onPlatform, onStairs, polar } from "./layout.ts";
import type { GraphicsTier } from "../../render/graphicsTiers.ts";
import { villageTexture } from "./villageTextures.ts";
import { sectorOf } from "./sectorSplit.ts";

/**
 * Stage 6.6 星芽村全村美術升級（遊戲端）：不增加 Draw Calls 的材質與光影升級。
 * 1. 物件細節（DetailPlugin）：門、木架、桶、金屬、旗布、灰泥原本只有頂點色（塑膠感）。
 *    依頂點色自動判斷材質（木／鐵／布／灰泥／葉），以世界座標三向投影貼上共用細節貼圖 detail66（RGBA 四種細節），
 *    並由細節明暗算出細微凹凸（高、中畫質）。不需要重新匯出模型、不新增網格或繪製次數。
 * 2. 草地（GrassPlugin）：原本純綠色地面改為草地貼圖（3 m 重複）＋大範圍色塊變化（避免重複感）＋道路與廣場邊緣的踩踏痕跡。
 * 3. 草叢與小花（實例化，各 1 次繪製）：只放在可走範圍內的草地上，避開道路、廣場、建築、前庭、NPC、傳送門；
 *    高度 ≤ 0.32 m、沒有碰撞，不擋路也不擋鏡頭。數量依畫質。
 * 4. 天空：漸層天空加上柔和雲朵（同一個天空球，貼圖換成 1024×256）。
 */

// ---------------- 細節貼圖：物件材質 ----------------
const DETAIL_FRAG = `
#if defined(DETAIL66) && defined(VERTEXCOLOR)
{
  vec3 c66 = pow(max(vColor.rgb, vec3(0.0001)), vec3(0.4545));
  float mx66 = max(c66.r, max(c66.g, c66.b));
  float mn66 = min(c66.r, min(c66.g, c66.b));
  float sat66 = (mx66 - mn66) / max(mx66, 0.001);
  float hue66 = 0.0;
  if (mx66 - mn66 > 0.0001) {
    if (mx66 == c66.r) hue66 = mod((c66.g - c66.b) / (mx66 - mn66), 6.0);
    else if (mx66 == c66.g) hue66 = (c66.b - c66.r) / (mx66 - mn66) + 2.0;
    else hue66 = (c66.r - c66.g) / (mx66 - mn66) + 4.0;
    hue66 /= 6.0;
  }
  float wWood = smoothstep(0.22, 0.38, sat66) * smoothstep(0.0, 0.03, hue66) * (1.0 - smoothstep(0.11, 0.15, hue66)) * (1.0 - smoothstep(0.78, 0.92, mx66));
  float wLeaf = smoothstep(0.2, 0.35, sat66) * smoothstep(0.17, 0.22, hue66) * (1.0 - smoothstep(0.45, 0.5, hue66));
  float wMetal = (1.0 - smoothstep(0.08, 0.2, sat66)) * (1.0 - smoothstep(0.42, 0.56, mx66));
  float wPlaster = (1.0 - smoothstep(0.1, 0.24, sat66)) * smoothstep(0.6, 0.78, mx66);
  float wCloth = clamp(1.0 - wWood - wLeaf - wMetal - wPlaster, 0.0, 1.0) * smoothstep(0.25, 0.45, sat66);
  vec3 P66 = vPositionW * d66Params.x;
#ifdef NORMAL
  vec3 N66 = normalize(vNormalW);
#else
  vec3 N66 = normalW;
#endif
  vec3 A66 = abs(N66);
#ifdef DETAIL66FAST
  vec2 uv66 = A66.x > A66.y && A66.x > A66.z ? P66.zy : (A66.y > A66.z ? P66.xz : P66.xy);
  vec4 t66 = texture2D(detail66Sampler, uv66);
#else
  vec3 b66 = pow(A66, vec3(4.0));
  b66 /= (b66.x + b66.y + b66.z);
  vec4 t66 = texture2D(detail66Sampler, P66.zy) * b66.x + texture2D(detail66Sampler, P66.xz) * b66.y + texture2D(detail66Sampler, P66.xy) * b66.z;
#endif
  float wSum66 = wWood + wMetal + wCloth + wPlaster + wLeaf;
  float h66 = t66.r * wWood + t66.g * wMetal + t66.b * wCloth + t66.a * wPlaster + (t66.a * 1.4 - 0.36) * wLeaf + 0.5 * max(0.0, 1.0 - wSum66);
  h66 = h66 / max(1.0, wSum66);
  baseColor.rgb *= clamp(1.0 + (h66 - 0.5) * d66Params.y * (0.6 + 0.6 * wWood + 0.3 * wLeaf), 0.55, 1.45);
#ifdef DETAIL66BUMP
  float dist66 = length(vEyePosition.xyz - vPositionW);
  float amp66 = d66Params.z * (1.0 - smoothstep(6.0, 22.0, dist66));
  if (amp66 > 0.00001) {
    vec3 dpx66 = dFdx(vPositionW);
    vec3 dpy66 = dFdy(vPositionW);
    float dhx66 = dFdx(h66) * amp66;
    float dhy66 = dFdy(h66) * amp66;
    vec3 r1_66 = cross(dpy66, normalW);
    vec3 r2_66 = cross(normalW, dpx66);
    float det66 = dot(dpx66, r1_66);
    vec3 g66 = sign(det66) * (dhx66 * r1_66 + dhy66 * r2_66);
    normalW = normalize(abs(det66) * normalW - g66);
  }
#endif
}
#endif
`;

class DetailPlugin extends MaterialPluginBase {
  tex: Texture;
  scale = 1.0;
  strength = 0.9;
  bump = 0.0035;
  fast = false;
  constructor(material: Material, tex: Texture, fast: boolean, bump: boolean) {
    super(material, "VillageDetail66", 200, { DETAIL66: false, DETAIL66FAST: false, DETAIL66BUMP: false });
    this.tex = tex;
    this.fast = fast;
    this.bump = bump ? 0.0035 : 0;
    this._enable(true);
  }
  override prepareDefines(defines: MaterialDefines): void {
    defines["DETAIL66"] = true;
    defines["DETAIL66FAST"] = this.fast;
    defines["DETAIL66BUMP"] = this.bump > 0;
  }
  override getClassName(): string {
    return "VillageDetail66";
  }
  override getSamplers(samplers: string[]): void {
    samplers.push("detail66Sampler");
  }
  override getActiveTextures(active: BaseTexture[]): void {
    active.push(this.tex);
  }
  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return { ubo: [{ name: "d66Params", size: 4, type: "vec4" }], fragment: "#ifdef DETAIL66\nuniform vec4 d66Params;\n#endif" };
  }
  override bindForSubMesh(ubo: UniformBuffer, _scene: Scene, _engine: AbstractEngine): void {
    ubo.updateFloat4("d66Params", this.scale, this.strength, this.bump, 0);
    ubo.setTexture("detail66Sampler", this.tex);
  }
  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: "#ifdef DETAIL66\nuniform sampler2D detail66Sampler;\n#endif",
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: DETAIL_FRAG,
    };
  }
}

// ---------------- 草地 ----------------
const GRASS_FRAG = `
#if defined(GRASS66) && defined(VERTEXCOLOR)
{
  vec2 p66 = vPositionW.xz;
  vec3 g1 = texture2D(grass66Sampler, p66 / 3.1).rgb;
  vec3 g2 = texture2D(grass66Sampler, vec2(p66.y, -p66.x) / 7.7 + 0.31).rgb;
  float macro66 = dot(texture2D(grass66Sampler, p66 / 41.0 + 0.17).rgb, vec3(0.33));
  float macro2 = dot(texture2D(grass66Sampler, p66 / 97.0 + 0.61).rgb, vec3(0.33));
  vec3 g66 = mix(g1, g2, 0.28);
  float m66 = clamp((macro66 - 0.47) * 7.0, -1.0, 1.0);
  float n66 = clamp((macro2 - 0.47) * 6.0, -1.0, 1.0);
  g66 *= 1.0 + 0.1 * m66;
  g66 = mix(g66, g66 * vec3(1.12, 1.04, 0.78), clamp(n66, 0.0, 1.0) * 0.45);
  g66 = mix(g66, g66 * vec3(0.86, 0.98, 0.95), clamp(-n66, 0.0, 1.0) * 0.4);
  // 踩踏痕跡：廣場外緣（r 18）、四條主路（寬 6 m）旁邊
  float r66 = length(p66);
  float dp66 = r66 - 18.0;
  float dr66 = r66 < 44.5 ? min(abs(p66.x), abs(p66.y)) - 3.0 : 99.0;
  float d66 = min(dp66, dr66);
  float wear66 = 1.0 - smoothstep(0.05, 0.75 + 0.7 * dot(g2, vec3(0.6)), d66);
  vec3 worn66 = vec3(0.60, 0.58, 0.40) * (0.85 + 0.3 * dot(g1, vec3(0.5)));
  g66 = mix(g66, worn66, wear66 * 0.55);
  float shade66 = clamp(vColor.g / 0.72, 0.6, 1.3);
  baseColor.rgb = g66 * shade66 * grass66Params.x;
}
#endif
`;

class GrassPlugin extends MaterialPluginBase {
  tex: Texture;
  constructor(material: Material, tex: Texture) {
    super(material, "VillageGrass66", 210, { GRASS66: false });
    this.tex = tex;
    this._enable(true);
  }
  override prepareDefines(defines: MaterialDefines): void {
    defines["GRASS66"] = true;
  }
  override getClassName(): string {
    return "VillageGrass66";
  }
  override getSamplers(samplers: string[]): void {
    samplers.push("grass66Sampler");
  }
  override getActiveTextures(active: BaseTexture[]): void {
    active.push(this.tex);
  }
  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return { ubo: [{ name: "grass66Params", size: 4, type: "vec4" }], fragment: "#ifdef GRASS66\nuniform vec4 grass66Params;\n#endif" };
  }
  override bindForSubMesh(ubo: UniformBuffer): void {
    ubo.updateFloat4("grass66Params", 1.0, 0, 0, 0);
    ubo.setTexture("grass66Sampler", this.tex);
  }
  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: "#ifdef GRASS66\nuniform sampler2D grass66Sampler;\n#endif",
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: GRASS_FRAG,
    };
  }
}

export interface Art66Options {
  tier: GraphicsTier;
  texBase: string;
}

const applied = new WeakSet<Material>();
const detailTexOf = new WeakMap<Scene, Texture>();

function detailTex(scene: Scene, texBase: string, tier: GraphicsTier): Texture {
  let t = detailTexOf.get(scene);
  if (!t) {
    t = villageTexture(scene, `${texBase}detail66_${tier === "high" ? "hq" : "lite"}.png`, tier === "high");
    t.wrapU = Texture.WRAP_ADDRESSMODE;
    t.wrapV = Texture.WRAP_ADDRESSMODE;
    detailTexOf.set(scene, t);
  }
  return t;
}

/** 物件材質（頂點色）加上細節貼圖與凹凸；同一個材質只處理一次 */
export function addDetail66(mat: Material, scene: Scene, opt: Art66Options): void {
  if (applied.has(mat) || !(mat instanceof StandardMaterial)) return;
  applied.add(mat);
  new DetailPlugin(mat, detailTex(scene, opt.texBase, opt.tier), opt.tier === "low", opt.tier !== "low");
  // 降低塑膠感：高光較小較散、去掉整體自發光
  mat.specularColor = new Color3(0.07, 0.07, 0.075);
  mat.specularPower = 18;
  mat.emissiveColor = new Color3(0.02, 0.019, 0.018);
}

/** 草地地面（PH_villageStatic 的材質） */
export function addGrass66(mat: Material, scene: Scene, opt: Art66Options): void {
  if (applied.has(mat) || !(mat instanceof StandardMaterial)) return;
  applied.add(mat);
  const t = villageTexture(scene, `${opt.texBase}grass66_${opt.tier === "high" ? "hq" : "lite"}.png`, opt.tier === "high");
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  new GrassPlugin(mat, t);
  mat.specularColor = new Color3(0.025, 0.03, 0.02);
}

// ---------------- 草叢與小花（實例化） ----------------
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number): number => hash(a * 57 + b * 131);
  return (h(xi, zi) * (1 - u) + h(xi + 1, zi) * u) * (1 - v) + (h(xi, zi + 1) * (1 - u) + h(xi + 1, zi + 1) * u) * v;
}

/** 草地上可以放低矮裝飾的位置（可走範圍內、避開鋪面與設施） */
export function grassSpot(x: number, z: number): boolean {
  const r = Math.hypot(x, z);
  if (r < 18.9 || r > WALK_RADIUS - 0.4) return false;
  if (onPlatform(x, z) || onStairs(x, z)) return false;
  if (r < 44.8 && Math.min(Math.abs(x), Math.abs(z)) < ROAD_HALF + 0.55) return false;
  for (const b of BUILDINGS) {
    const t = (b.bearing * Math.PI) / 180;
    const ax = Math.sin(t);
    const az = Math.cos(t);
    const along = x * ax + z * az;
    const side = x * az - z * ax;
    // 建築本體＋0.6 m
    if (along > b.front - 0.6 && along < b.front + b.d + 0.6 && Math.abs(side) < b.w / 2 + 0.6) return false;
    // 地面建築前庭（r 17.5 → 正門，寬 w+2）＋0.5 m
    if (b.floor === 0 && along > 17 && along < b.front + 0.5 && Math.abs(side) < b.w / 2 + 1.5) return false;
  }
  if (Math.hypot(x - FORGE.x, z - FORGE.z) < 3.2) return false;
  if (Math.hypot(x - BOARD.x, z - BOARD.z) < 3.6) return false;
  for (const p of PORTALS) if (Math.hypot(x - p.x, z - p.z) < p.r + 1.6) return false;
  if (Math.abs(x) < SOUTH_GATE.halfW + 2 && Math.abs(z - SOUTH_GATE.z) < 2.5) return false;
  for (const n of NPC_SPOTS) if (Math.hypot(x - n.x, z - n.z) < 1.6) return false;
  return true;
}

function tuftMesh(scene: Scene, name: string): Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const nrm: number[] = [];
  const blades = 6;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + hash(i) * 0.6;
    const lean = 0.25 + hash(i + 7) * 0.25;
    const h = 0.12 + hash(i + 3) * 0.1;
    const w = 0.045;
    const ox = Math.cos(a) * 0.05;
    const oz = Math.sin(a) * 0.05;
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    const tx = ox + Math.cos(a) * h * lean;
    const tz = oz + Math.sin(a) * h * lean;
    const base = pos.length / 3;
    pos.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, tx, h, tz);
    // 與草地貼圖同色系（根部略暗、尖端受光），遠看融入草地、近看有立體草葉
    const dark = [0.4, 0.6, 0.27];
    const tip = hash(i + 11) > 0.5 ? [0.7, 0.86, 0.46] : [0.62, 0.8, 0.4];
    col.push(...dark, 1, ...dark, 1, ...tip, 1);
    nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    idx.push(base, base + 1, base + 2);
  }
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.colors = col;
  vd.normals = nrm;
  vd.applyToMesh(m);
  return m;
}

function flowerMesh(scene: Scene, name: string): Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const nrm: number[] = [];
  const h = 0.13;
  // 莖（細三角）
  pos.push(-0.008, 0, 0, 0.008, 0, 0, 0, h, 0);
  col.push(0.3, 0.5, 0.25, 1, 0.3, 0.5, 0.25, 1, 0.42, 0.62, 0.3, 1);
  nrm.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
  idx.push(0, 1, 2);
  // 花瓣（五瓣星形，白色 × 實例顏色）＋花心
  const c = pos.length / 3;
  pos.push(0, h + 0.012, 0);
  col.push(1, 0.86, 0.4, 1);
  nrm.push(0, 1, 0);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 === 0 ? 0.045 : 0.018;
    pos.push(Math.cos(a) * r, h + (i % 2 === 0 ? 0.004 : 0.01), Math.sin(a) * r);
    col.push(1, 1, 1, 1);
    nrm.push(0, 1, 0);
  }
  for (let i = 0; i < 10; i++) idx.push(c, c + 1 + i, c + 1 + ((i + 1) % 10));
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.colors = col;
  vd.normals = nrm;
  vd.applyToMesh(m);
  return m;
}

export interface Foliage66 {
  readonly meshes: Mesh[];
  /** drawCalls＝網格數（扇區數 × 2）；實際每幀只畫鏡頭看得到的扇區 */
  readonly stats: { tufts: number; flowers: number; triangles: number; drawCalls: number; sectors: number };
  setEnabled(on: boolean): void;
}

/** 草叢小花的扇區數。Stage 6.6 實測：橫向鏡頭看得到整圈村莊，分扇區省不到面數、反而多繪製次數，所以維持 1（各 1 個網格） */
export const FOLIAGE_SECTORS = 1;

/** 草叢與小花：數量依畫質（高 1300／450、中 1200／420、低 600／220；Stage 6.6 高畫質下修以守住每幀三角面標準） */
export function buildFoliage66(scene: Scene, tier: GraphicsTier, receiveShadows: boolean): Foliage66 {
  const nT = tier === "high" ? 1300 : tier === "medium" ? 1200 : 600;
  const nF = tier === "high" ? 450 : tier === "medium" ? 420 : 220;
  const mat = new StandardMaterial("VP66_foliage", scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = Color3.Black();
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;
  mat.emissiveColor = new Color3(0.08, 0.1, 0.05);
  const tuft = tuftMesh(scene, "VP66_tufts");
  const flower = flowerMesh(scene, "VP66_flowers");
  const fmat = mat.clone("VP66_flowerMat");
  for (const [m, mm] of [
    [tuft, mat],
    [flower, fmat],
  ] as const) {
    m.material = mm;
    m.isPickable = false;
    m.receiveShadows = receiveShadows;
    m.hasVertexAlpha = false;
    m.alwaysSelectAsActiveMesh = true;
  }
  const place = (n: number, seed: number, cluster: number, minS: number, maxS: number): { mats: Float32Array; count: number; pts: [number, number][] } => {
    const out = new Float32Array(n * 16);
    const pts: [number, number][] = [];
    let k = 0;
    let tries = 0;
    while (k < n && tries < n * 40) {
      tries++;
      const a = hash(seed + tries * 1.37) * Math.PI * 2;
      const r = Math.sqrt(hash(seed + tries * 2.11) * (50 * 50 - 18.9 * 18.9) + 18.9 * 18.9);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      // 成簇分布：雜訊高的地方比較密
      const dens = vnoise(x / cluster + seed, z / cluster - seed);
      if (hash(seed + tries * 3.7) > dens * dens * 1.6) continue;
      if (!grassSpot(x, z)) continue;
      const s = minS + hash(tries * 5.3 + seed) * (maxS - minS);
      const rot = hash(tries * 7.1 + seed) * Math.PI * 2;
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      // 手動組矩陣（列主序，Babylon 的 world matrix：縮放 × 繞 Y 旋轉 × 平移）
      const o = k * 16;
      out[o] = c * s;
      out[o + 1] = 0;
      out[o + 2] = -sn * s;
      out[o + 3] = 0;
      out[o + 4] = 0;
      out[o + 5] = s * (0.85 + hash(tries + seed) * 0.4);
      out[o + 6] = 0;
      out[o + 7] = 0;
      out[o + 8] = sn * s;
      out[o + 9] = 0;
      out[o + 10] = c * s;
      out[o + 11] = 0;
      out[o + 12] = x;
      out[o + 13] = -0.02;
      out[o + 14] = z;
      out[o + 15] = 1;
      pts.push([x, z]);
      k++;
    }
    return { mats: out.subarray(0, k * 16), count: k, pts };
  };
  const t = place(nT, 11, 6, 0.8, 1.5);
  const f = place(nF, 47, 4, 0.8, 1.25);
  const palette = [
    [1.0, 0.97, 0.95],
    [1.0, 0.86, 0.92],
    [1.0, 0.92, 0.55],
    [0.82, 0.84, 1.0],
    [1.0, 0.72, 0.78],
  ];
  const fcols = new Float32Array(f.count * 4);
  for (let i = 0; i < f.count; i++) {
    // 同一簇顏色相近
    const [x, z] = f.pts[i]!;
    const pi = Math.floor(vnoise(x / 3.5 + 9, z / 3.5 - 4) * palette.length * 0.999 + hash(i) * 0.6) % palette.length;
    const p = palette[pi]!;
    fcols.set([p[0]!, p[1]!, p[2]!, 1], i * 4);
  }
  // Stage 6.6：依方位角分成 FOLIAGE_SECTORS 個扇區，每個扇區一個網格（共用幾何與材質）。
  // 畫面外的扇區由視錐剔除略過；草叢與小花總數不變。
  const meshes: Mesh[] = [];
  const split = (base: Mesh, pl: { mats: Float32Array; count: number; pts: [number, number][] }, cols: Float32Array | null): void => {
    const groups: number[][] = Array.from({ length: FOLIAGE_SECTORS }, () => []);
    for (let i = 0; i < pl.count; i++) groups[sectorOf(pl.pts[i]![0], pl.pts[i]![1], FOLIAGE_SECTORS)]!.push(i);
    // 先複製（共用幾何與材質）再分別設定實例緩衝，避免複製到已設定的實例資料
    const parts = groups.map((_, s) => (s === 0 ? base : (base.clone(`${base.name}_s${s}`) as Mesh)));
    if (FOLIAGE_SECTORS > 1) base.name = `${base.name}_s0`;
    groups.forEach((g, s) => {
      const m = parts[s]!;
      if (!g.length) {
        if (s !== 0) m.dispose();
        return;
      }
      const mats = new Float32Array(g.length * 16);
      g.forEach((i, k) => mats.set(pl.mats.subarray(i * 16, i * 16 + 16), k * 16));
      m.thinInstanceSetBuffer("matrix", mats, 16, true);
      if (cols) {
        const c = new Float32Array(g.length * 4);
        g.forEach((i, k) => c.set(cols.subarray(i * 4, i * 4 + 4), k * 4));
        m.thinInstanceSetBuffer("color", c, 4, true);
      }
      m.alwaysSelectAsActiveMesh = false;
      m.thinInstanceRefreshBoundingInfo(false);
      m.freezeWorldMatrix();
      meshes.push(m);
    });
    if (!groups[0]!.length) base.dispose();
  };
  split(tuft, t, null);
  split(flower, f, fcols);
  const tris = t.count * 6 + f.count * 11;
  return {
    meshes,
    stats: { tufts: t.count, flowers: f.count, triangles: tris, drawCalls: meshes.length, sectors: FOLIAGE_SECTORS },
    setEnabled(on) {
      for (const m of meshes) m.setEnabled(on);
    },
  };
}

// ---------------- 天空雲朵 ----------------
/** 把天空球貼圖換成有柔和雲朵的版本（同一個網格、同一次繪製） */
export function upgradeSky66(scene: Scene, colors: { zenith: string; upper: string; nearHorizon: string; horizon: string; below: string }): boolean {
  const dome = scene.getMeshByName("PH_skyDome");
  const mat = dome?.material as StandardMaterial | null;
  if (!dome || !mat) return false;
  const W = 1024;
  const H = 256;
  const tex = new DynamicTexture("VP66_sky", { width: W, height: H }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, colors.zenith);
  g.addColorStop(0.3, colors.upper);
  g.addColorStop(0.45, colors.nearHorizon);
  g.addColorStop(0.5, colors.horizon);
  g.addColorStop(0.58, colors.below);
  g.addColorStop(1, colors.below);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 雲：地平線上方 12%～40% 的帶狀區域，柔和白色團塊（水平無縫：邊緣兩側各畫一次）
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const puff = (x: number, y: number, r: number, a: number): void => {
    for (const ox of [-W, 0, W]) {
      const gr = ctx.createRadialGradient(x + ox, y, 0, x + ox, y, r);
      gr.addColorStop(0, `rgba(255,255,255,${a})`);
      gr.addColorStop(0.55, `rgba(255,255,255,${a * 0.55})`);
      gr.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.ellipse(x + ox, y, r * 1.9, r * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  for (let c = 0; c < 16; c++) {
    const cx = rnd() * W;
    const cy = H * (0.2 + rnd() * 0.24);
    const size = 10 + rnd() * 16;
    const n = 4 + Math.floor(rnd() * 6);
    for (let i = 0; i < n; i++) puff(cx + (rnd() - 0.5) * size * 4.5, cy + (rnd() - 0.5) * size * 0.9, size * (0.6 + rnd() * 0.7), 0.42 + rnd() * 0.3);
  }
  // 高空薄雲
  for (let i = 0; i < 26; i++) puff(rnd() * W, H * (0.04 + rnd() * 0.14), 8 + rnd() * 14, 0.12 + rnd() * 0.12);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  const old = mat.emissiveTexture;
  mat.emissiveTexture = tex;
  old?.dispose();
  return true;
}

// ---------------- 光影 ----------------
/**
 * 光影調整（三段畫質相同，維持一致）：天空光降低、太陽光提高且偏暖、地面反光偏暗 → 建築有明確的受光面與背光面，
 * 不再整片過曝；曝光 1.0、對比 1.12（原本 1.05 曝光、高中低對比不同）。角色、NPC 與建築使用同一組光源。
 */
export function applyLighting66(
  scene: Scene,
  hemi: { intensity: number; diffuse: Color3; groundColor: Color3 },
  sun: { intensity: number; diffuse: Color3 },
  shadows: { darkness: number } | null,
): void {
  hemi.intensity = 0.62;
  hemi.diffuse = new Color3(0.96, 0.98, 1.06);
  hemi.groundColor = new Color3(0.47, 0.47, 0.42);
  sun.intensity = 1.0;
  sun.diffuse = new Color3(1.0, 0.93, 0.81);
  if (shadows) shadows.darkness = 0.4;
  const ip = scene.imageProcessingConfiguration;
  ip.exposure = 1.0;
  ip.contrast = 1.12;
}
