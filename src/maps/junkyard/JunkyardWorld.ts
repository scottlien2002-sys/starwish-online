/**
 * 星廢垃圾場：Babylon 場景建構（地形、水、地標、實例化垃圾、植被、動態效果、分區載入）。
 *
 * 效能原則：
 * - 地形 6×6 分塊（每塊 50 m），超出鏡頭遠裁切面（霧的盡頭）不畫
 * - 地標依區域合併成少數網格（同材質 1 次繪製）；會動的零件另外掛在節點上
 * - 小垃圾、草叢、小花用 thin instances（每區每種 1 次繪製）；玩家靠近時才建立，遠離時釋放
 * - 粒子（蒸氣、火花、環境光點）數量依畫質；低畫質關閉大部分粒子
 * - 即時陰影只投射玩家附近的大型地標；小垃圾不投射
 */
import {
  type AbstractMesh,
  Color4,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Quaternion,
  type Scene,
  type ShadowGenerator,
  type Texture,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import {
  ARENA,
  BASINS,
  COLOSSUS,
  CONVEYORS,
  CRANES,
  CRYSTALS,
  DECKS,
  type DeckDef,
  FACTORIES,
  type FactoryDef,
  FURNACES,
  JUNKYARD_ENTRY_PORTAL,
  MAIN_ROUTE,
  MAP_HALF,
  MOUNDS,
  PIPES,
  PLATEAUS,
  RAMPS,
  REACTOR,
  STEAM_VENTS,
  type Vec2,
} from "./layout.ts";
import { groundHeight, insideColliders, pipeSupports, plateauInside, STATIC_COLLIDERS } from "./terrain.ts";
import { polyDist, rng, smoothstep } from "./geom.ts";
import { createJunkMaterials, type JunkMaterials, Kit, junkSource, type JunkType, PAL, type Rgb } from "./junkKit.ts";
import { cellOf, type Inst, SCATTER_TIERS, type ScatterResult, STREAM_CELLS, scatterAll } from "./scatter.ts";
import { compactInto, type FadeRule, type FadeSet, makeFadeSet, selectFade } from "../../world/lodKit.ts";
import { bladeTuft } from "../../world/foliageKit.ts";
import { periodicNoise } from "../../world/texGen.ts";

/** 距離密度漸變（草叢、小花、地面碎屑）；網址 &jyfade=0 關閉（對照用） */
const FADE_RULES: Record<"high" | "medium" | "low", { tuft: FadeRule; flower: FadeRule; debris: FadeRule }> = {
  high: { tuft: { full: 18, end: 48, floor: 0.3, cut: 80 }, flower: { full: 18, end: 48, floor: 0.2, cut: 75 }, debris: { full: 28, end: 70, floor: 0.35, cut: 110 } },
  medium: { tuft: { full: 14, end: 40, floor: 0.3, cut: 65 }, flower: { full: 14, end: 40, floor: 0.2, cut: 60 }, debris: { full: 22, end: 58, floor: 0.3, cut: 90 } },
  low: { tuft: { full: 10, end: 32, floor: 0.3, cut: 50 }, flower: { full: 10, end: 32, floor: 0.2, cut: 46 }, debris: { full: 16, end: 45, floor: 0.3, cut: 70 } },
};

interface FadeMesh {
  mesh: Mesh;
  set: FadeSet;
  rule: FadeRule;
  mats: Float32Array;
  cols: Float32Array;
  liveM: Float32Array;
  liveC: Float32Array;
  idx: Uint32Array;
  shown: number;
  tris: number;
}

export type JyTier = "high" | "medium" | "low";

export interface JunkyardStats {
  terrainChunks: number;
  terrainTris: number;
  landmarkMeshes: number;
  landmarkTris: number;
  loadedCells: string[];
  instances: number;
  instanceMeshes: number;
  particles: number;
  buildMs: number;
  scatter: ScatterResult["counts"];
  fade: { on: boolean; meshes: number; total: number; shown: number; tris: number; trisFull: number };
}

interface CellView {
  id: string;
  meshes: Mesh[];
  particles: ParticleSystem[];
  instances: number;
  fades: FadeMesh[];
}

const CHUNK = 50;

const mix = (a: Rgb, b: Rgb, t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** 地形頂點色（依區域、路面、坡度、高度） */
function terrainColor(x: number, z: number, y: number, slope: number): [number, number, number] {
  const n1 = 0.5 + 0.5 * Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2);
  const n2 = 0.5 + 0.5 * Math.sin(z * 0.13 - x * 0.05 + 1.7);
  // 低地草地（明亮、帶點黃綠）
  let c: [number, number, number] = mix([0.46, 0.64, 0.3], [0.6, 0.7, 0.34], n1 * 0.7 + n2 * 0.3);
  // 垃圾山腳的鏽土
  let junkW = 0;
  for (const m of MOUNDS) {
    if (m.kind !== "junk") continue;
    const d2 = (x - m.x) ** 2 + (z - m.z) ** 2;
    junkW = Math.max(junkW, Math.exp(-d2 / (2 * (m.s * 1.35) ** 2)));
  }
  // 垃圾山：多色廢料斑塊（鏽紅、青綠烤漆、米白、鐵灰），遠看是一座座彩色廢料堆
  const b1 = 0.5 + 0.5 * Math.sin(x * 0.53 + Math.sin(z * 0.41) * 2.1);
  const b2 = 0.5 + 0.5 * Math.sin(z * 0.47 - x * 0.29 + Math.sin(x * 0.17) * 1.7);
  const scrap: [number, number, number] =
    b1 > 0.72 ? [0.36, 0.56, 0.56] : b2 > 0.78 ? [0.8, 0.74, 0.62] : b1 < 0.22 ? [0.48, 0.48, 0.52] : b2 < 0.25 ? [0.66, 0.36, 0.22] : mix([0.62, 0.44, 0.3], [0.52, 0.44, 0.38], n2);
  c = mix(c, scrap, smoothstep(0.25, 0.62, junkW));
  // 高台地面
  const rec = PLATEAUS.find((p) => p.id === "recycle")!;
  const fac = PLATEAUS.find((p) => p.id === "factory")!;
  const core = PLATEAUS.find((p) => p.id === "core")!;
  const onRec = smoothstep(-1, 1.5, plateauInside(rec, x, z)) * smoothstep(5, 5.8, y);
  const onFac = smoothstep(-1, 1.5, plateauInside(fac, x, z)) * smoothstep(13, 13.8, y);
  const onCore = smoothstep(-1, 1.5, plateauInside(core, x, z)) * smoothstep(19, 19.8, y);
  // 回收區：混凝土＋青苔斑
  c = mix(c, mix([0.6, 0.62, 0.58], [0.48, 0.6, 0.38], smoothstep(0.62, 0.85, n1 * n2 * 1.6)), onRec);
  // 工廠：紅磚與鐵板
  c = mix(c, mix([0.6, 0.46, 0.4], [0.5, 0.5, 0.52], n2), onFac);
  // 核心：深色金屬，靠近反應爐偏暖
  const warm = smoothstep(40, 10, Math.hypot(x - REACTOR.x, z - REACTOR.z));
  c = mix(c, mix([0.44, 0.43, 0.45], [0.56, 0.44, 0.38], warm), onCore);
  // 主路線：泥土路（高台上是磨亮的石板）
  const rd = polyDist(x, z, MAIN_ROUTE);
  const path = 1 - smoothstep(2.2, 4.2, rd);
  const pathCol: Rgb = y > 5 ? [0.66, 0.64, 0.6] : [0.76, 0.63, 0.45];
  c = mix(c, pathCol, path * 0.85);
  // 入口廣場：淺色石板
  c = mix(c, [0.74, 0.72, 0.66], 1 - smoothstep(8, 11, Math.hypot(x - 0, z + 124)));
  // 懸崖：層層堆疊的廢料（依高度條紋）
  const cliff = smoothstep(0.75, 1.3, slope);
  const band = 0.5 + 0.5 * Math.sin(y * 2.3 + n1 * 2);
  c = mix(c, mix([0.56, 0.47, 0.38], [0.44, 0.4, 0.38], band), cliff);
  // 水底與岸邊
  if (y < -0.3) c = mix(c, [0.28, 0.38, 0.36], smoothstep(-0.3, -1.5, y));
  // 地圖外圍垃圾牆
  const edge = Math.max(Math.abs(x), Math.abs(z));
  c = mix(c, mix([0.6, 0.48, 0.38], [0.46, 0.44, 0.46], n1), smoothstep(126, 136, edge));
  return c;
}

export class JunkyardWorld {
  readonly mats: JunkMaterials;
  readonly root: TransformNode;
  private readonly chunks: Mesh[] = [];
  private readonly landmarks: { mesh: Mesh; zone: string; caster: boolean }[] = [];
  private readonly cells = new Map<string, CellView>();
  private readonly scatter: ScatterResult;
  private readonly sources = new Map<string, Mesh>();
  private readonly tierCfg: (typeof SCATTER_TIERS)[JyTier];
  private readonly lite: boolean;
  private readonly anim: {
    cranes: { swing: TransformNode; claw: TransformNode; def: (typeof CRANES)[number] }[];
    gears: { node: TransformNode; speed: number }[];
    rings: { node: TransformNode; speed: number }[];
    core: TransformNode | null;
    crystals: { mesh: Mesh; base: Float32Array; phase: Float32Array; n: number; buf: Float32Array } | null;
    beltTex: Texture | null;
    waterTex: Texture | null;
  } = { cranes: [], gears: [], rings: [], core: null, crystals: null, beltTex: null, waterTex: null };
  private ambient: ParticleSystem | null = null;
  private casterTimer = 0;
  private fadeTimer = 0;
  private fadeX = Infinity;
  private fadeZ = Infinity;
  /** 距離密度漸變是否開啟（&jyfade=0 關閉） */
  readonly fadeOn = typeof location === "undefined" || new URLSearchParams(location.search).get("jyfade") !== "0";
  private t = 0;
  readonly buildMs: number;
  /** 分區載入／釋放紀錄（報告用） */
  readonly streamLog: { t: number; cell: string; op: "load" | "unload"; ms: number }[] = [];

  readonly scene: Scene;
  readonly tier: JyTier;
  private readonly shadows: ShadowGenerator | null;
  private readonly shadowRange: number;

  constructor(scene: Scene, tier: JyTier, shadows: ShadowGenerator | null, shadowRange: number) {
    this.scene = scene;
    this.tier = tier;
    this.shadows = shadows;
    this.shadowRange = shadowRange;
    const t0 = performance.now();
    this.lite = tier !== "high";
    this.tierCfg = SCATTER_TIERS[tier];
    this.mats = createJunkMaterials(scene, tier);
    this.root = new TransformNode("jy_root", scene);
    this.scatter = scatterAll(groundHeight, (x, z, p) => insideColliders(STATIC_COLLIDERS, x, z, p), this.tierCfg);
    this.buildTerrain();
    this.buildPavement();
    this.buildWater();
    this.buildLandmarks();
    if (tier !== "low") this.buildAmbient();
    this.buildMs = performance.now() - t0;
  }

  // ---------------- 地形 ----------------
  private buildTerrain(): void {
    // 格距：高 1.5625 m（每塊 32 格）、中 2 m（25 格）、低 2.5 m（20 格）
    const step = this.tier === "high" ? 1.5625 : this.tier === "medium" ? 2 : 2.5;
    const per = Math.round(CHUNK / step);
    const nC = Math.round((MAP_HALF * 2) / CHUNK);
    for (let cj = 0; cj < nC; cj++) {
      for (let ci = 0; ci < nC; ci++) {
        const x0 = -MAP_HALF + ci * CHUNK;
        const z0 = -MAP_HALF + cj * CHUNK;
        const nv = per + 1;
        const pos = new Float32Array(nv * nv * 3);
        const col = new Float32Array(nv * nv * 4);
        const uv = new Float32Array(nv * nv * 2);
        const H = new Float32Array(nv * nv);
        for (let j = 0; j < nv; j++) for (let i = 0; i < nv; i++) H[j * nv + i] = groundHeight(x0 + i * step, z0 + j * step);
        for (let j = 0; j < nv; j++) {
          for (let i = 0; i < nv; i++) {
            const k = j * nv + i;
            const x = x0 + i * step;
            const z = z0 + j * step;
            const y = H[k]!;
            const hx = (H[j * nv + Math.min(nv - 1, i + 1)]! - H[j * nv + Math.max(0, i - 1)]!) / (step * (i > 0 && i < nv - 1 ? 2 : 1));
            const hz = (H[Math.min(nv - 1, j + 1) * nv + i]! - H[Math.max(0, j - 1) * nv + i]!) / (step * (j > 0 && j < nv - 1 ? 2 : 1));
            const slope = Math.hypot(hx, hz);
            pos[k * 3] = x;
            pos[k * 3 + 1] = y;
            pos[k * 3 + 2] = z;
            const c = terrainColor(x, z, y, slope);
            col[k * 4] = c[0];
            col[k * 4 + 1] = c[1];
            col[k * 4 + 2] = c[2];
            col[k * 4 + 3] = 1;
            uv[k * 2] = x / 8.5;
            uv[k * 2 + 1] = z / 8.5;
          }
        }
        const idx = new Uint32Array(per * per * 6);
        let p = 0;
        for (let j = 0; j < per; j++) {
          for (let i = 0; i < per; i++) {
            const a = j * nv + i;
            const b = a + 1;
            const c = a + nv;
            const d = c + 1;
            // Babylon（左手座標）正面＝從上方看順時針：a→b→c、b→d→c（法線朝上）
            idx[p++] = a;
            idx[p++] = b;
            idx[p++] = c;
            idx[p++] = b;
            idx[p++] = d;
            idx[p++] = c;
          }
        }
        const vd = new VertexData();
        vd.positions = pos;
        vd.indices = idx;
        vd.colors = col;
        vd.uvs = uv;
        const nrm = new Float32Array(pos.length);
        VertexData.ComputeNormals(pos, idx, nrm);
        vd.normals = nrm;
        const m = new Mesh(`jy_terrain_${ci}_${cj}`, this.scene);
        vd.applyToMesh(m, false);
        m.material = this.mats.terrain;
        m.receiveShadows = true;
        m.isPickable = false;
        m.freezeWorldMatrix();
        m.parent = this.root;
        this.chunks.push(m);
      }
    }
  }

  // ---------------- V2：高台鋪面（混凝土／鐵板縫線；邊緣與破損處透出底下的地面） ----------------
  readonly pavementTris: number[] = [];
  private buildPavement(): void {
    const step = this.tier === "high" ? 2 : 2.5;
    const breakup = periodicNoise(12, 77);
    for (const p of PLATEAUS) {
      const x0 = p.x - p.hx - step;
      const z0 = p.z - p.hz - step;
      const nx = Math.ceil((p.hx * 2 + step * 2) / step) + 1;
      const nz = Math.ceil((p.hz * 2 + step * 2) / step) + 1;
      const pos: number[] = [];
      const col: number[] = [];
      const uv: number[] = [];
      const alpha = new Float32Array(nx * nz);
      const ids = new Int32Array(nx * nz).fill(-1);
      const vid = (i: number, j: number): number => {
        const k = j * nx + i;
        if (ids[k]! >= 0) return ids[k]!;
        const x = x0 + i * step;
        const z = z0 + j * step;
        const y = groundHeight(x, z);
        const c = terrainColor(x, z, y, 0);
        ids[k] = pos.length / 3;
        pos.push(x, y + 0.025, z);
        col.push(c[0], c[1], c[2], alpha[k]!);
        uv.push(x / 16, z / 16);
        return ids[k]!;
      };
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const x = x0 + i * step;
          const z = z0 + j * step;
          const sdf = plateauInside(p, x, z);
          const y = groundHeight(x, z);
          let a = smoothstep(0.4, 3.2, sdf);
          if (Math.abs(y - p.y) > 0.05) a = 0; // 只鋪在平坦的高台頂面（坡道、懸崖不鋪）
          if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r + 2) a = 0; // Boss 廣場有自己的地板
          if (Math.hypot(x - REACTOR.x, z - REACTOR.z) < REACTOR.r + 2) a = 0;
          // 破損：少數區塊露出底下的地面
          a *= smoothstep(0.16, 0.34, breakup((x + 512) / 96, (z + 512) / 96));
          alpha[j * nx + i] = a;
        }
      }
      const idx: number[] = [];
      for (let j = 0; j < nz - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          const k = j * nx + i;
          if (alpha[k]! + alpha[k + 1]! + alpha[k + nx]! + alpha[k + nx + 1]! < 0.02) continue;
          const a = vid(i, j);
          const b = vid(i + 1, j);
          const c = vid(i, j + 1);
          const d = vid(i + 1, j + 1);
          idx.push(a, b, c, b, d, c);
        }
      }
      if (!idx.length) continue;
      const vd = new VertexData();
      vd.positions = pos;
      vd.indices = idx;
      vd.colors = col;
      vd.uvs = uv;
      vd.normals = pos.map((_, i) => (i % 3 === 1 ? 1 : 0));
      const m = new Mesh(`jy_pavement_${p.id}`, this.scene);
      vd.applyToMesh(m, false);
      m.material = this.mats.pavement;
      m.hasVertexAlpha = true;
      m.receiveShadows = true;
      m.isPickable = false;
      m.parent = this.root;
      m.freezeWorldMatrix();
      this.pavementTris.push(idx.length / 3);
      this.landmarks.push({ mesh: m, zone: p.id, caster: false });
    }
  }

  // ---------------- 水（運河＋水池；淡藍發光、緩慢流動） ----------------
  private buildWater(): void {
    const meshes: Mesh[] = [];
    for (const b of BASINS) {
      if (b.pts.length === 1) {
        const d = MeshBuilder.CreateDisc("jy_pond", { radius: b.r + 1.2, tessellation: 40, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
        d.rotation.x = Math.PI / 2;
        d.position.set(b.pts[0]!.x, b.water, b.pts[0]!.z);
        d.bakeCurrentTransformIntoVertices();
        meshes.push(d);
      } else {
        const L: Vector3[] = [];
        const R: Vector3[] = [];
        for (let i = 0; i < b.pts.length; i++) {
          const p = b.pts[i]!;
          const q = b.pts[Math.min(b.pts.length - 1, i + 1)]!;
          const o = b.pts[Math.max(0, i - 1)]!;
          const dx = q.x - o.x;
          const dz = q.z - o.z;
          const l = Math.hypot(dx, dz) || 1;
          const w = b.r + 1.2;
          L.push(new Vector3(p.x - (dz / l) * w, b.water, p.z + (dx / l) * w));
          R.push(new Vector3(p.x + (dz / l) * w, b.water, p.z - (dx / l) * w));
        }
        meshes.push(MeshBuilder.CreateRibbon("jy_canal", { pathArray: [L, R], sideOrientation: Mesh.DOUBLESIDE }, this.scene));
      }
    }
    const water = Mesh.MergeMeshes(meshes, true, true)!;
    water.name = "jy_water";
    water.material = this.mats.water;
    water.isPickable = false;
    water.parent = this.root;
    // 世界座標 UV（貼圖慢慢流動）
    const pos = water.getVerticesData(VertexBuffer.PositionKind)!;
    const uv = new Float32Array((pos.length / 3) * 2);
    for (let i = 0; i < pos.length / 3; i++) {
      uv[i * 2] = pos[i * 3]! / 9;
      uv[i * 2 + 1] = pos[i * 3 + 2]! / 9;
    }
    water.setVerticesData(VertexBuffer.UVKind, uv);
    water.freezeWorldMatrix();
    this.anim.waterTex = this.mats.water.diffuseTexture as Texture;
    this.landmarks.push({ mesh: water, zone: "central", caster: false });
  }

  // ---------------- 地標 ----------------
  private addKit(kit: Kit, zone: string, caster = true): Mesh[] {
    const out = kit.bake();
    for (const m of out) {
      if (!m.parent) m.parent = this.root;
      m.receiveShadows = true;
      this.landmarks.push({ mesh: m, zone, caster: caster && !m.name.includes("glow") && !m.name.includes("cloth") });
    }
    return out;
  }

  private buildLandmarks(): void {
    this.buildEntry();
    for (const d of DECKS) this.buildDeck(d);
    for (const r of RAMPS) if (r.kind === "metal") this.buildMetalRamp(r);
    for (const c of CRANES) this.buildCrane(c);
    this.buildConveyors();
    for (const f of FACTORIES) this.buildFactory(f);
    this.buildFurnaces();
    this.buildCore();
    this.buildColossus();
    this.buildPipes();
    this.buildPropsMisc();
    this.buildHeroJunk();
    this.buildCrystals();
  }

  private zoneAt(x: number, z: number): string {
    return cellOf(x, z);
  }

  /** 入口：傳送陣圓台＋發光環＋4 根柱＋木柵欄＋路燈 */
  private buildEntry(): void {
    const k = new Kit(this.scene, this.mats, "jy_entry");
    const P = JUNKYARD_ENTRY_PORTAL;
    const y = groundHeight(P.x, P.z);
    k.cyl(P.visualR * 2 + 1.2, P.visualR * 2 + 1.6, 0.3, P.x, y + 0.1, P.z, PAL.stone, "paint", 32);
    k.cyl(P.visualR * 2, P.visualR * 2, 0.06, P.x, y + 0.28, P.z, PAL.tealDark, "paint", 32);
    k.torus(P.visualR * 2 - 0.3, 0.16, P.x, y + 0.32, P.z, PAL.cyan, "glowBlue", 40);
    k.torus(P.visualR * 1.1, 0.1, P.x, y + 0.32, P.z, PAL.cyan, "glowBlue", 32);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const px = P.x + Math.cos(a) * (P.visualR + 0.9);
      const pz = P.z + Math.sin(a) * (P.visualR + 0.9);
      k.cyl(0.55, 0.75, 3, px, y + 1.5, pz, PAL.stone, "paint", 8);
      k.cyl(0.8, 0.8, 0.25, px, y + 3.1, pz, PAL.gold, "metal", 8);
      k.sphere(0.5, px, y + 3.5, pz, PAL.cyan, "glowBlue", 8);
    }
    // 歡迎拱門（木與鐵；概念圖入口的木柵欄風格）
    const ay = groundHeight(0, -112);
    for (const sx of [-5, 5]) {
      k.box(0.6, 5, 0.6, sx, ay + 2.5, -112, PAL.wood);
      k.box(0.9, 0.4, 0.9, sx, ay + 0.2, -112, PAL.stone);
    }
    k.box(11, 0.7, 0.5, 0, ay + 5, -112, PAL.woodDark);
    k.box(6, 1.2, 0.2, 0, ay + 4.1, -111.8, PAL.cream);
    this.addKit(k, "entry");
    // 招牌旗幟
    const kb = new Kit(this.scene, this.mats, "jy_entry_cloth");
    for (const sx of [-3.4, 3.4]) {
      const b = MeshBuilder.CreatePlane("jy_part", { width: 1.2, height: 2.4, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
      b.position.set(sx, ay + 3.3, -111.6);
      kb.add(b, [1, 1, 1], "cloth");
    }
    this.addKit(kb, "entry", false);
    this.buildFences();
  }

  /** 木柵欄：入口道路兩側與山丘區小路（概念圖前景） */
  private buildFences(): void {
    const k = new Kit(this.scene, this.mats, "jy_fence");
    const runs: { a: Vec2; b: Vec2 }[] = [
      { a: { x: -7, z: -108 }, b: { x: -9, z: -88 } },
      { a: { x: 7, z: -108 }, b: { x: 12, z: -90 } },
      { a: { x: 30, z: -80 }, b: { x: 40, z: -78 } },
      { a: { x: 56, z: -94 }, b: { x: 70, z: -90 } },
      { a: { x: 76, z: -64 }, b: { x: 80, z: -50 } },
    ];
    for (const r of runs) {
      const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
      const n = Math.max(2, Math.round(len / 2.4));
      let prev: Vector3 | null = null;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = r.a.x + (r.b.x - r.a.x) * t;
        const z = r.a.z + (r.b.z - r.a.z) * t;
        if (insideColliders(STATIC_COLLIDERS, x, z, 0.3)) {
          prev = null;
          continue;
        }
        const y = groundHeight(x, z);
        const tilt = Math.sin(i * 1.7) * 0.08;
        k.box(0.22, 1.3, 0.22, x, y + 0.6, z, PAL.wood, "paint", [tilt, 0, -tilt]);
        const top = new Vector3(x, y + 1.05, z);
        const mid = new Vector3(x, y + 0.6, z);
        if (prev) {
          k.beam(prev, top, 0.12, PAL.woodDark, "paint");
          k.beam(prev.add(new Vector3(0, -0.45, 0)), mid, 0.1, PAL.wood, "paint");
        }
        prev = top;
      }
    }
    this.addKit(k, "entry", false);
  }

  /** 橋、步道、階梯、平台（金屬桁架＋欄杆＋支柱） */
  private buildDeck(d: DeckDef): void {
    const k = new Kit(this.scene, this.mats, `jy_deck_${d.id}`);
    const len = Math.hypot(d.b.x - d.a.x, d.b.z - d.a.z);
    const dirX = (d.b.x - d.a.x) / len;
    const dirZ = (d.b.z - d.a.z) / len;
    const nx = -dirZ;
    const nz = dirX;
    const yaw = Math.atan2(dirX, dirZ);
    const at = (t: number, side: number): Vector3 =>
      new Vector3(d.a.x + dirX * len * t + nx * side, d.a.y + (d.b.y - d.a.y) * t, d.a.z + dirZ * len * t + nz * side);
    const half = d.w / 2;
    const metal = d.kind === "bridge" ? PAL.teal : d.kind === "platform" ? PAL.ironDark : PAL.rust;
    if (d.kind === "stairs") {
      const steps = Math.max(3, Math.round(Math.abs(d.b.y - d.a.y) / 0.32));
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const p0 = at((t0 + t1) / 2, 0);
        // 每階頂面＝該階較高那一端的高度（踩上去與行走面一致）
        const top = Math.max(d.a.y + (d.b.y - d.a.y) * t0, d.a.y + (d.b.y - d.a.y) * t1);
        const base = Math.min(d.a.y, d.b.y) - 0.1;
        const h = top - base;
        k.box(d.w, h, len / steps + 0.02, p0.x, base + h / 2, p0.z, i % 2 ? PAL.ironDark : PAL.iron, "metal", [0, yaw, 0]);
      }
    } else {
      // 行走面（鋼板＋邊樑）：沿線分段，跟著高度
      const segs = Math.max(1, Math.round(len / 4));
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs;
        const t1 = (i + 1) / segs;
        const a = at(t0, 0);
        const b = at(t1, 0);
        const c = Vector3.Center(a, b);
        const pitch = Math.atan2(b.y - a.y, len / segs);
        k.box(d.w, 0.3, len / segs + 0.04, c.x, c.y - 0.15, c.z, i % 2 ? metal : mix(metal, PAL.iron, 0.3), "metal", [-pitch, yaw, 0]);
        // 支柱（到地面）
        if (d.kind !== "platform" || i % 2 === 0) {
          for (const s of [-1, 1]) {
            const p = at(t0, s * (half - 0.2));
            const gy = groundHeight(p.x, p.z);
            if (p.y - gy > 0.8) k.box(0.32, p.y - gy + 0.4, 0.32, p.x, (p.y + gy) / 2 - 0.2, p.z, PAL.ironDark, "metal", [0, yaw, 0]);
          }
        }
      }
      if (d.kind === "platform") {
        // 平台下方是實心機房（看起來不是懸空）
        const c = at(0.5, 0);
        const gy = Math.min(groundHeight(d.a.x, d.a.z), groundHeight(d.b.x, d.b.z));
        const hh = c.y - gy - 0.3;
        k.box(d.w - 0.4, hh, len - 0.4, c.x, gy + hh / 2, c.z, PAL.rustDark, "paint", [0, yaw, 0]);
        for (let i = 0; i < 5; i++) k.box(1.6, 1, 0.12, c.x - half + 2 + i * 3, gy + hh * 0.55, c.z - len / 2 + 0.15, PAL.orange, "glowOrange");
      }
    }
    // 欄杆（兩側；平台的階梯入口那一側留空）
    if (d.rails) {
      const posts = Math.max(2, Math.round(len / 2.2));
      for (const s of [-1, 1]) {
        let prev: Vector3 | null = null;
        for (let i = 0; i <= posts; i++) {
          const t = i / posts;
          const p = at(t, s * (half - 0.1));
          const top = p.add(new Vector3(0, 1.05, 0));
          k.box(0.12, 1.05, 0.12, p.x, p.y + 0.52, p.z, PAL.yellow, "metal");
          if (prev) k.beam(prev, top, 0.09, PAL.yellow, "metal");
          prev = top;
        }
      }
      if (d.kind === "platform") {
        // 平台遠端欄杆
        const e0 = at(1, -half + 0.1).add(new Vector3(0, 1.05, 0));
        const e1 = at(1, half - 0.1).add(new Vector3(0, 1.05, 0));
        k.beam(e0, e1, 0.09, PAL.yellow, "metal");
      }
    }
    this.addKit(k, this.zoneAt((d.a.x + d.b.x) / 2, (d.a.z + d.b.z) / 2));
  }

  private buildMetalRamp(r: (typeof RAMPS)[number]): void {
    const k = new Kit(this.scene, this.mats, `jy_ramp_${r.id}`);
    const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
    const yaw = Math.atan2(r.b.x - r.a.x, r.b.z - r.a.z);
    const segs = Math.round(len / 3);
    for (let i = 0; i < segs; i++) {
      const t = (i + 0.5) / segs;
      const x = r.a.x + (r.b.x - r.a.x) * t;
      const z = r.a.z + (r.b.z - r.a.z) * t;
      const y = groundHeight(x, z);
      const pitch = Math.atan2(r.b.y - r.a.y, len);
      k.box(r.w * 0.92, 0.12, len / segs + 0.05, x, y + 0.05, z, i % 2 ? PAL.iron : PAL.ironDark, "metal", [-pitch, yaw, 0]);
      // 黃黑警示邊條
      const nx = Math.cos(yaw) * (r.w * 0.46);
      const nz = -Math.sin(yaw) * (r.w * 0.46);
      for (const s of [-1, 1]) k.box(0.25, 0.14, len / segs, x + nx * s, y + 0.08, z + nz * s, i % 2 ? PAL.yellow : PAL.black, "paint", [-pitch, yaw, 0]);
    }
    this.addKit(k, this.zoneAt(r.b.x, r.b.z), false);
  }

  /** 巨型機械吊車：桁架塔＋可旋轉吊臂＋上下移動的抓斗（概念圖中央的大吊車） */
  private buildCrane(c: (typeof CRANES)[number]): void {
    const k = new Kit(this.scene, this.mats, `jy_${c.id}`);
    const gy = groundHeight(c.x, c.z);
    const w = 1.6;
    k.box(4.2, 1, 4.2, c.x, gy + 0.5, c.z, PAL.ironDark, "metal");
    const lv = Math.round(c.h / 2.2);
    const col = PAL.yellow;
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      k.box(0.22, c.h, 0.22, c.x + sx * w * 0.5, gy + 1 + c.h / 2, c.z + sz * w * 0.5, col, "metal");
    }
    for (let i = 0; i < lv; i++) {
      const y0 = gy + 1 + (i * c.h) / lv;
      const y1 = gy + 1 + ((i + 1) * c.h) / lv;
      const h = w * 0.5;
      const corners = [
        new Vector3(-h, 0, -h),
        new Vector3(h, 0, -h),
        new Vector3(h, 0, h),
        new Vector3(-h, 0, h),
      ];
      for (let s = 0; s < 4; s++) {
        const a = corners[s]!;
        const b = corners[(s + 1) % 4]!;
        const pa = new Vector3(c.x + a.x, y0, c.z + a.z);
        const pb = new Vector3(c.x + b.x, y1, c.z + b.z);
        k.beam(pa, pb, 0.1, col, "metal");
      }
    }
    this.addKit(k, this.zoneAt(c.x, c.z));
    // 旋轉部分
    const swing = new TransformNode(`jy_${c.id}_swing`, this.scene);
    swing.parent = this.root;
    swing.position.set(c.x, gy + 1 + c.h, c.z);
    const ks = new Kit(this.scene, this.mats, `jy_${c.id}_arm`);
    ks.box(3.2, 2.2, 2.6, 0, 1.1, 0, PAL.orange, "paint", [0, 0, 0], swing);
    ks.box(2.4, 0.9, 0.12, 0, 1.5, 1.31, PAL.cyan, "glowBlue", [0, 0, 0], swing);
    // 吊臂（三角桁架）
    const L = c.arm;
    for (let i = 0; i < Math.round(L / 2); i++) {
      const x0 = 1.4 + i * 2;
      ks.beam(new Vector3(x0, 2.3, -0.5), new Vector3(x0 + 2, 2.3, -0.5), 0.14, col, "metal", swing);
      ks.beam(new Vector3(x0, 2.3, 0.5), new Vector3(x0 + 2, 2.3, 0.5), 0.14, col, "metal", swing);
      ks.beam(new Vector3(x0, 2.3, -0.5), new Vector3(x0 + 2, 3.2, 0), 0.1, col, "metal", swing);
      ks.beam(new Vector3(x0, 2.3, 0.5), new Vector3(x0 + 2, 3.2, 0), 0.1, col, "metal", swing);
      ks.beam(new Vector3(x0 + 2, 3.2, 0), new Vector3(x0, 3.2, 0), 0.1, col, "metal", swing);
    }
    // 配重臂
    ks.box(5, 0.5, 1, -3.2, 2.4, 0, PAL.ironDark, "metal", [0, 0, 0], swing);
    ks.box(1.8, 1.6, 1.8, -5.2, 1.9, 0, PAL.stone, "paint", [0, 0, 0], swing);
    // 吊索
    ks.box(0.06, 6, 0.06, L, -0.4, 0, PAL.black, "metal", [0, 0, 0], swing);
    for (const m of ks.bake()) {
      m.receiveShadows = true;
      this.landmarks.push({ mesh: m, zone: this.zoneAt(c.x, c.z), caster: true });
    }
    // 抓斗（上下移動）
    const claw = new TransformNode(`jy_${c.id}_claw`, this.scene);
    claw.parent = swing;
    claw.position.set(L, -3.4, 0);
    const kc = new Kit(this.scene, this.mats, `jy_${c.id}_claw`);
    kc.cyl(1.2, 0.8, 0.8, 0, 0, 0, PAL.ironDark, "metal", 8, [0, 0, 0], claw);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      kc.box(0.25, 1.6, 0.4, Math.cos(a) * 0.55, -0.9, Math.sin(a) * 0.55, PAL.iron, "metal", [Math.sin(a) * 0.35, -a, -Math.cos(a) * 0.35], claw);
    }
    // 抓著的廢車殼
    kc.box(1.6, 1, 1.2, 0, -1.6, 0, PAL.teal, "paint", [0.2, 0.4, 0.1], claw);
    for (const m of kc.bake()) {
      m.receiveShadows = true;
      this.landmarks.push({ mesh: m, zone: this.zoneAt(c.x, c.z), caster: true });
    }
    this.anim.cranes.push({ swing, claw, def: c });
  }

  /** 廢棄輸送帶（帶面貼圖流動） */
  private buildConveyors(): void {
    for (const cv of CONVEYORS) {
      const k = new Kit(this.scene, this.mats, `jy_${cv.id}`);
      const len = Math.hypot(cv.b.x - cv.a.x, cv.b.z - cv.a.z);
      const yaw = Math.atan2(cv.b.x - cv.a.x, cv.b.z - cv.a.z);
      const cx = (cv.a.x + cv.b.x) / 2;
      const cz = (cv.a.z + cv.b.z) / 2;
      const y = cv.y + cv.lift;
      k.box(2, 0.4, len, cx, y - 0.25, cz, PAL.ironDark, "metal", [0, yaw, 0]);
      for (const s of [-1, 1]) k.box(0.18, 0.5, len, cx + Math.cos(yaw) * s * 1.05, y + 0.05, cz - Math.sin(yaw) * s * 1.05, PAL.yellow, "metal", [0, yaw, 0]);
      const legs = Math.max(2, Math.round(len / 4));
      for (let i = 0; i <= legs; i++) {
        const t = i / legs - 0.5;
        const x = cx + Math.sin(yaw) * len * t * 0.96;
        const z = cz + Math.cos(yaw) * len * t * 0.96;
        for (const s of [-1, 1]) k.box(0.2, cv.lift, 0.2, x + Math.cos(yaw) * s * 0.85, cv.y + cv.lift / 2 - 0.2, z - Math.sin(yaw) * s * 0.85, PAL.rust, "metal");
      }
      // 帶上的廢料
      const r = rng(cv.id.charCodeAt(2) * 31);
      for (let i = 0; i < Math.round(len / 3); i++) {
        const t = r() - 0.5;
        k.box(0.5 + r() * 0.5, 0.3 + r() * 0.4, 0.5 + r() * 0.5, cx + Math.sin(yaw) * len * t * 0.9, y + 0.25, cz + Math.cos(yaw) * len * t * 0.9, [PAL.teal, PAL.rust, PAL.cream, PAL.iron][i % 4]!, "paint", [0, r() * 3, 0]);
      }
      this.addKit(k, this.zoneAt(cx, cz));
      const belt = MeshBuilder.CreateBox(`jy_${cv.id}_belt`, { width: 1.8, height: 0.06, depth: len }, this.scene);
      belt.position.set(cx, y + 0.01, cz);
      belt.rotation.y = yaw;
      belt.material = this.mats.belt;
      belt.parent = this.root;
      belt.isPickable = false;
      belt.receiveShadows = true;
      belt.freezeWorldMatrix();
      this.landmarks.push({ mesh: belt, zone: this.zoneAt(cx, cz), caster: false });
    }
    this.anim.beltTex = this.mats.belt.diffuseTexture as Texture;
  }

  /** 廢棄廠房：鐵皮牆、鋸齒屋頂（部分破損）、橘光窗、牆上大齒輪、煙囪 */
  private buildFactory(f: FactoryDef): void {
    const k = new Kit(this.scene, this.mats, `jy_${f.id}`);
    const node = new TransformNode(`jy_${f.id}_n`, this.scene);
    node.parent = this.root;
    node.position.set(f.x, f.y, f.z);
    node.rotation.y = f.rot;
    const r = rng(f.id.length * 97 + Math.round(f.x));
    const wallCol = (i: number): Rgb => ([PAL.teal, PAL.rust, PAL.cream, PAL.tealDark, PAL.iron][(i + Math.floor(r() * 2)) % 5]!);
    // 地基
    k.box(f.hx * 2 + 1, 0.8, f.hz * 2 + 1, 0, 0.4, 0, PAL.stone, "paint", [0, 0, 0], node);
    // 牆（分成鐵皮面板，頂部高低不一＝破損）
    const panels = Math.max(3, Math.round(f.hx / 2));
    for (const side of [-1, 1]) {
      for (let i = 0; i < panels; i++) {
        const w = (f.hx * 2) / panels;
        const x = -f.hx + w * (i + 0.5);
        const hh = f.h * (1 - (r() < f.broken * 0.5 ? r() * 0.35 : 0));
        k.box(w + 0.02, hh, 0.4, x, hh / 2 + 0.6, side * f.hz, wallCol(i), "paint", [0, 0, 0], node);
        // 窗（橘光）
        if (i % 2 === 0 && hh > f.h * 0.7) k.box(w * 0.55, 1.2, 0.1, x, f.h * 0.62, side * (f.hz + 0.22), PAL.orange, "glowOrange", [0, 0, 0], node);
      }
      const pz = Math.max(3, Math.round(f.hz / 2));
      for (let i = 0; i < pz; i++) {
        const w = (f.hz * 2) / pz;
        const z = -f.hz + w * (i + 0.5);
        const hh = f.h * (1 - (r() < f.broken * 0.5 ? r() * 0.35 : 0));
        k.box(0.4, hh, w + 0.02, side * f.hx, hh / 2 + 0.6, z, wallCol(i + 2), "paint", [0, 0, 0], node);
      }
    }
    // 柱
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.8, f.h + 1, 0.8, sx * f.hx, (f.h + 1) / 2 + 0.4, sz * f.hz, PAL.rustDark, "metal", [0, 0, 0], node);
    // 鋸齒屋頂（破損處留空）
    const teeth = Math.max(2, Math.round(f.hx / 3.5));
    for (let i = 0; i < teeth; i++) {
      if (r() < f.broken * 0.6) continue;
      const w = (f.hx * 2) / teeth;
      const x = -f.hx + w * (i + 0.5);
      k.box(w * 1.02, 0.25, f.hz * 2 + 0.6, x - w * 0.15, f.h + 1.6, 0, PAL.tealDark, "paint", [0, 0, 0.55], node);
      k.box(0.2, 1.8, f.hz * 2 + 0.4, x + w * 0.35, f.h + 1.5, 0, PAL.cyan, "glowBlue", [0, 0, 0], node);
    }
    // 大門（深色）與警示條
    k.box(f.hx * 0.7, f.h * 0.55, 0.15, 0, f.h * 0.275 + 0.6, -f.hz - 0.25, PAL.black, "paint", [0, 0, 0], node);
    for (let i = 0; i < 6; i++) k.box((f.hx * 0.7) / 6, 0.4, 0.17, -f.hx * 0.35 + (f.hx * 0.7 * (i + 0.5)) / 6, f.h * 0.55 + 0.8, -f.hz - 0.26, i % 2 ? PAL.yellow : PAL.black, "paint", [0, 0, 0], node);
    // 煙囪
    const chx = f.hx * 0.55;
    k.cyl(1.4, 1.8, f.h + 6, chx, (f.h + 6) / 2 + 0.6, f.hz * 0.4, PAL.rust, "paint", 10, [0, 0, 0], node);
    k.cyl(1.7, 1.7, 0.5, chx, f.h + 6.6, f.hz * 0.4, PAL.ironDark, "metal", 10, [0, 0, 0], node);
    // 旗幟
    const kb = new Kit(this.scene, this.mats, `jy_${f.id}_cloth`);
    const flag = MeshBuilder.CreatePlane("jy_part", { width: 1.6, height: 3.2, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    flag.position.set(-f.hx * 0.5, f.h * 0.6, -f.hz - 0.4);
    flag.parent = null;
    kb.add(flag, [1, 1, 1], "cloth", node);
    this.addKit(k, this.zoneAt(f.x, f.z));
    this.addKit(kb, this.zoneAt(f.x, f.z), false);
    // 牆上旋轉大齒輪
    const g = new TransformNode(`jy_${f.id}_gear`, this.scene);
    g.parent = node;
    g.position.set(f.hx + 0.5, f.h * 0.55, -f.hz * 0.3);
    g.rotation.z = Math.PI / 2;
    const kg = new Kit(this.scene, this.mats, `jy_${f.id}_gearm`);
    const R = Math.min(3.2, f.h * 0.28);
    kg.cyl(R * 2, R * 2, 0.5, 0, 0, 0, PAL.gold, "metal", 20, [0, 0, 0], g);
    kg.cyl(R * 0.7, R * 0.7, 0.7, 0, 0, 0, PAL.ironDark, "metal", 10, [0, 0, 0], g);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      kg.box(0.6, 0.5, 0.7, Math.cos(a) * (R + 0.25), 0, Math.sin(a) * (R + 0.25), PAL.gold, "metal", [0, -a, 0], g);
    }
    for (const m of kg.bake()) {
      m.receiveShadows = true;
      this.landmarks.push({ mesh: m, zone: this.zoneAt(f.x, f.z), caster: true });
    }
    this.anim.gears.push({ node: g, speed: (f.id.length % 2 ? 1 : -1) * 0.35 });
  }

  private buildFurnaces(): void {
    for (const f of FURNACES) {
      const k = new Kit(this.scene, this.mats, `jy_${f.id}`);
      k.cyl(f.r * 2, f.r * 2.3, 3.2, f.x, f.y + 1.6, f.z, PAL.rustDark, "metal", 16);
      k.cyl(f.r * 2.2, f.r * 2.2, 0.4, f.x, f.y + 3.3, f.z, PAL.ironDark, "metal", 16);
      k.cyl(f.r * 1.5, f.r * 1.5, 0.3, f.x, f.y + 3.4, f.z, PAL.orange, "glowOrange", 16);
      // 爐口
      k.box(f.r * 1.1, 1.2, 0.3, f.x, f.y + 1.1, f.z - f.r * 1.08, PAL.orange, "glowOrange");
      k.cyl(0.9, 1.1, 6, f.x + f.r * 0.6, f.y + 5.6, f.z + f.r * 0.4, PAL.rust, "paint", 10);
      this.addKit(k, this.zoneAt(f.x, f.z));
      if (this.tier !== "low") this.sparks(new Vector3(f.x, f.y + 3.6, f.z), this.tier === "high" ? 26 : 14);
    }
  }

  /** 核心熔煉場：圓形戰鬥廣場地紋、中央魔法機械反應爐、環形機械、排氣塔 */
  private buildCore(): void {
    const k = new Kit(this.scene, this.mats, "jy_core");
    const y = ARENA.y;
    // 戰鬥廣場：同心圓金屬地紋（貼在地面上 4 cm）
    const ring = (r0: number, r1: number, c: Rgb, segs = 48, mat: "paint" | "metal" | "glowOrange" = "metal"): void => {
      const m = MeshBuilder.CreateDisc("jy_part", { radius: r1, tessellation: segs }, this.scene);
      if (r0 > 0) m.dispose();
      const geo = r0 > 0 ? MeshBuilder.CreateTorus("jy_part", { diameter: r0 + r1, thickness: r1 - r0, tessellation: segs }, this.scene) : m;
      if (r0 > 0) {
        geo.scaling.y = 0.04 / (r1 - r0);
        geo.position.set(ARENA.x, y + 0.04, ARENA.z);
      } else {
        geo.rotation.x = Math.PI / 2;
        geo.position.set(ARENA.x, y + 0.03, ARENA.z);
      }
      k.add(geo, c, mat);
    };
    ring(0, ARENA.r - 0.3, PAL.ironDark, 56);
    ring(ARENA.r - 2.2, ARENA.r - 1.4, PAL.yellow, 56, "paint");
    ring(ARENA.r * 0.55 - 0.4, ARENA.r * 0.55 + 0.4, PAL.gold, 48);
    ring(5.6, 6.2, PAL.orange, 40, "glowOrange");
    // 放射線
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      k.box(0.35, 0.05, ARENA.r - 8, ARENA.x + Math.cos(a) * (ARENA.r / 2 + 2), y + 0.06, ARENA.z + Math.sin(a) * (ARENA.r / 2 + 2), PAL.iron, "metal", [0, Math.PI / 2 - a, 0]);
    }
    // 周圍矮護欄與能源柱（不擋入口坡道方向）
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const px = ARENA.x + Math.cos(a) * (ARENA.r + 1.4);
      const pz = ARENA.z + Math.sin(a) * (ARENA.r + 1.4);
      if (Math.hypot(px - -4, pz - 100) < 9 || Math.hypot(px - REACTOR.x, pz - REACTOR.z) < REACTOR.r + 2) continue;
      k.cyl(0.6, 0.8, 2.4, px, y + 1.2, pz, PAL.ironDark, "metal", 8);
      k.sphere(0.6, px, y + 2.6, pz, PAL.orange, "glowOrange", 8);
    }
    // 反應爐本體
    const R = REACTOR;
    k.cyl(R.r * 2 + 2, R.r * 2 + 3, 2.2, R.x, y + 1.1, R.z, PAL.ironDark, "metal", 24);
    k.cyl(R.r * 2, R.r * 2 + 0.6, 6, R.x, y + 5.2, R.z, PAL.rust, "metal", 20);
    k.cyl(R.r * 1.3, R.r * 1.7, 10, R.x, y + 13, R.z, PAL.iron, "metal", 16);
    k.cyl(R.r * 1.1, R.r * 1.3, 6, R.x, y + 21, R.z, PAL.ironDark, "metal", 16);
    k.cyl(R.r * 1.6, R.r * 1.6, 0.8, R.x, y + 24.4, R.z, PAL.gold, "metal", 20);
    // 透明籠架（發光核心周圍的直柱）
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      k.box(0.4, 9, 0.4, R.x + Math.cos(a) * R.r * 0.82, y + 13, R.z + Math.sin(a) * R.r * 0.82, PAL.gold, "metal");
    }
    // 排氣塔 ×2
    for (const sx of [8, 36]) {
      k.cyl(3.2, 3.8, 11, sx, y + 5.5, 128, PAL.rust, "paint", 12);
      k.cyl(3.8, 3.8, 0.6, sx, y + 11, 128, PAL.ironDark, "metal", 12);
      k.box(1.2, 0.6, 0.1, sx, y + 4, 128 - 1.95, PAL.orange, "glowOrange");
    }
    this.addKit(k, "core");
    // 發光核心（脈動）＋旋轉環
    const coreNode = new TransformNode("jy_reactor_core", this.scene);
    coreNode.parent = this.root;
    coreNode.position.set(R.x, y + 13, R.z);
    const kc = new Kit(this.scene, this.mats, "jy_reactor_glow");
    kc.cyl(R.r * 1.15, R.r * 1.15, 7.4, 0, 0, 0, PAL.orange, "glowOrange", 16, [0, 0, 0], coreNode);
    kc.sphere(R.r * 1.2, 0, 4.2, 0, PAL.gold, "glowOrange", 12, [1, 0.6, 1], coreNode);
    for (const m of kc.bake()) this.landmarks.push({ mesh: m, zone: "core", caster: false });
    this.anim.core = coreNode;
    for (let i = 0; i < 3; i++) {
      const rn = new TransformNode(`jy_reactor_ring${i}`, this.scene);
      rn.parent = this.root;
      rn.position.set(R.x, y + 9 + i * 5, R.z);
      rn.rotation.x = i === 1 ? 0.3 : -0.2;
      const kr = new Kit(this.scene, this.mats, `jy_ring${i}`);
      kr.torus(R.r * (2.6 + i * 0.35), 0.45, 0, 0, 0, i === 1 ? PAL.gold : PAL.iron, "metal", 36, [0, 0, 0], rn);
      for (let j = 0; j < 6; j++) {
        const a = (j / 6) * Math.PI * 2;
        kr.box(0.9, 0.9, 0.9, Math.cos(a) * R.r * (1.3 + i * 0.175), 0, Math.sin(a) * R.r * (1.3 + i * 0.175), PAL.cyan, "glowBlue", [0, -a, 0], rn);
      }
      for (const m of kr.bake()) {
        m.receiveShadows = true;
        this.landmarks.push({ mesh: m, zone: "core", caster: i === 0 });
      }
      this.anim.rings.push({ node: rn, speed: (i % 2 ? -1 : 1) * (0.25 + i * 0.12) });
    }
  }

  /** 機械巨像遺骸：半埋在山丘裡的巨大機器人頭與手臂，眼睛發橘光（概念圖左側） */
  private buildColossus(): void {
    const C = COLOSSUS;
    const node = new TransformNode("jy_colossus", this.scene);
    node.parent = this.root;
    node.position.set(C.x, groundHeight(C.x, C.z) - 1.2, C.z);
    node.rotation.y = C.yaw;
    const k = new Kit(this.scene, this.mats, "jy_colossus_m");
    k.sphere(15, 0, 3.2, 0, PAL.iron, "metal", 14, [1, 0.78, 0.92], node);
    k.box(14, 3.4, 9, 0, 0.6, -1.2, PAL.ironDark, "metal", [0.1, 0, 0], node);
    // 面罩與發光眼
    k.box(10.5, 3.2, 1.2, 0, 4.4, -6.2, PAL.ironDark, "metal", [0.12, 0, 0], node);
    for (const sx of [-2.6, 2.6]) {
      k.box(3, 1.3, 0.4, sx, 4.6, -6.85, PAL.orange, "glowOrange", [0.12, 0, sx > 0 ? -0.1 : 0.1], node);
    }
    // 頭頂天線、耳罩
    k.cyl(0.4, 0.6, 5, 2.5, 10.2, 1, PAL.rust, "metal", 8, [0.3, 0, -0.2], node);
    k.sphere(1, 3.2, 12.4, 1.8, PAL.red, "paint", 8, [1, 1, 1], node);
    for (const sx of [-1, 1]) k.cyl(4, 4.4, 2, sx * 7.4, 4, 0, PAL.rust, "metal", 14, [0, 0, Math.PI / 2], node);
    // 苔蘚（綠色扁球）
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      k.sphere(3.2 + (i % 3), Math.cos(a) * 5.5, 8 + Math.sin(i) * 1.5, Math.sin(a) * 4, PAL.moss, "paint", 6, [1.3, 0.35, 1], node);
    }
    // 伸出地面的手臂
    k.cyl(2.6, 3, 9, -9, 2.2, -4, PAL.teal, "metal", 10, [0.2, 0, 1.15], node);
    k.box(4, 2.6, 4.2, -13, 0.6, -4.6, PAL.tealDark, "metal", [0.1, 0.4, 0.2], node);
    for (let i = 0; i < 4; i++) k.box(0.9, 0.9, 3.2, -14.6, 0.5, -6.8 + i * 1.1, PAL.iron, "metal", [0.2, 0.3, 0.1], node);
    this.addKit(k, "hills");
  }

  /** 魔法能源管線（頭頂高度、發藍光）＋支架 */
  private buildPipes(): void {
    const kp = new Kit(this.scene, this.mats, "jy_pipes");
    const kg = new Kit(this.scene, this.mats, "jy_pipes_glow");
    for (const p of PIPES) {
      const path = p.pts.map((q) => new Vector3(q.x, Math.max(q.y, groundHeight(q.x, q.z) + 3.4), q.z));
      // 每段中間補點，避免穿進地形
      const pts: Vector3[] = [];
      for (let i = 0; i < path.length; i++) {
        const a = path[i]!;
        pts.push(a);
        const b = path[i + 1];
        if (!b) break;
        const n = Math.ceil(Vector3.Distance(a, b) / 5);
        for (let j = 1; j < n; j++) {
          const t = j / n;
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          pts.push(new Vector3(x, Math.max(a.y + (b.y - a.y) * t, groundHeight(x, z) + 3.4), z));
        }
      }
      const tube = MeshBuilder.CreateTube("jy_part", { path: pts, radius: p.r, tessellation: this.lite ? 6 : 8 }, this.scene);
      kp.add(tube, PAL.ironDark, "metal");
      // 發光能源條：管線上緣露出的一條細管
      const glow = MeshBuilder.CreateTube("jy_part", { path: pts.map((q) => q.add(new Vector3(0, p.r * 0.62, 0))), radius: p.r * 0.42, tessellation: 6 }, this.scene);
      kg.add(glow, PAL.cyan, "glowBlue");
    }
    for (const s of pipeSupports()) {
      const gy = groundHeight(s.x, s.z);
      kp.box(0.36, 3.6, 0.36, s.x, gy + 1.8, s.z, PAL.rust, "metal");
      kp.box(1.2, 0.3, 0.6, s.x, gy + 3.2, s.z, PAL.rustDark, "metal");
    }
    this.addKit(kp, "central");
    this.addKit(kg, "central", false);
  }

  /** 其他：路燈、回收旗幟、廢鐵堆場的大型廢棄車殼、高處閃爍燈 */
  private buildPropsMisc(): void {
    const k = new Kit(this.scene, this.mats, "jy_misc");
    const kg = new Kit(this.scene, this.mats, "jy_misc_glow");
    // 路燈（沿主路線每 ~28 m，放在路邊 4.2 m）
    let acc = 0;
    for (let i = 0; i + 1 < MAIN_ROUTE.length; i++) {
      const a = MAIN_ROUTE[i]!;
      const b = MAIN_ROUTE[i + 1]!;
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      for (let s = 0; s < L; s += 4) {
        acc += 4;
        if (acc < 28) continue;
        acc = 0;
        const t = s / L;
        const nx = -(b.z - a.z) / L;
        const nz = (b.x - a.x) / L;
        const x = a.x + (b.x - a.x) * t + nx * 4.4;
        const z = a.z + (b.z - a.z) * t + nz * 4.4;
        if (insideColliders(STATIC_COLLIDERS, x, z, 1) || polyDist(x, z, MAIN_ROUTE) < 3.8) continue;
        if (DECKS.some((d) => Math.hypot(x - (d.a.x + d.b.x) / 2, z - (d.a.z + d.b.z) / 2) < Math.hypot(d.b.x - d.a.x, d.b.z - d.a.z) / 2 + d.w)) continue;
        const y = groundHeight(x, z);
        k.cyl(0.22, 0.3, 3.4, x, y + 1.7, z, PAL.ironDark, "metal", 6);
        k.box(1.1, 0.12, 0.12, x + nx * -0.45, y + 3.4, z + nz * -0.45, PAL.ironDark, "metal", [0, Math.atan2(nx, nz) + Math.PI / 2, 0]);
        kg.sphere(0.42, x - nx * 0.9, y + 3.2, z - nz * 0.9, PAL.gold, "glowOrange", 6);
      }
    }
    // 高處閃爍燈（遠處廢棄機械偶爾閃爍）
    const fl = [new Kit(this.scene, this.mats, "jy_flick0"), new Kit(this.scene, this.mats, "jy_flick1"), new Kit(this.scene, this.mats, "jy_flick2")];
    let n = 0;
    for (const m of MOUNDS) {
      if (m.kind !== "junk" || m.h < 10) continue;
      const y = groundHeight(m.x, m.z);
      const kk = fl[n % 3]!;
      kk.box(0.8, 0.5, 0.8, m.x + 1, y + 0.6, m.z - 1, PAL.orange, "glowOrange");
      n++;
    }
    for (let i = 0; i < 3; i++) {
      for (const mm of fl[i]!.bake()) {
        mm.material = this.mats.flicker[i]!;
        mm.parent = this.root;
        this.landmarks.push({ mesh: mm, zone: "far", caster: false });
      }
    }
    this.addKit(k, "central");
    this.addKit(kg, "central", false);
  }

  /**
   * 大型半埋垃圾（地標）：廢車殼、巨大齒輪、斷掉的機械手臂、鍋爐、舊貨櫃，放在路線看得到的垃圾山腳與山腰。
   * 依區域合併（每區約 2～3 次繪製）；都在不可走的垃圾山上或有碰撞的位置旁，不擋路。
   */
  private buildHeroJunk(): void {
    const kits = new Map<string, Kit>();
    const kitFor = (x: number, z: number): Kit => {
      const zone = this.zoneAt(x, z);
      let k = kits.get(zone);
      if (!k) {
        k = new Kit(this.scene, this.mats, `jy_hero_${zone}`);
        kits.set(zone, k);
      }
      return k;
    };
    const r = rng(31337);
    const paints: Rgb[] = [PAL.teal, PAL.rust, PAL.cream, PAL.blue, PAL.red, PAL.yellow, PAL.tealDark, PAL.iron];
    const car = (k: Kit, x: number, z: number, yaw: number, tilt: number, c: Rgb): void => {
      const y = groundHeight(x, z) - 0.4;
      const node = new TransformNode("jy_heroN", this.scene);
      node.position.set(x, y, z);
      node.rotation.set(tilt, yaw, tilt * 0.6);
      node.computeWorldMatrix(true);
      const add = (m: Mesh, col: Rgb, mat: "paint" | "metal" = "paint"): void => {
        m.parent = node;
        m.computeWorldMatrix(true);
        m.bakeCurrentTransformIntoVertices();
        m.parent = null;
        m.position.copyFrom(m.getAbsolutePosition());
        k.add(m, col, mat);
      };
      const box = (w: number, h: number, d: number, px: number, py: number, pz: number, col: Rgb, mat: "paint" | "metal" = "paint"): void => {
        const m = MeshBuilder.CreateBox("jy_part", { width: w, height: h, depth: d }, this.scene);
        m.position.set(px, py, pz);
        add(m, col, mat);
      };
      box(2.2, 1.0, 4.2, 0, 0.9, 0, c);
      box(2.0, 0.9, 2.2, 0, 1.8, -0.3, mix(c, PAL.cream, 0.25));
      box(1.9, 0.6, 0.05, 0, 1.85, 0.82, PAL.tealDark);
      for (const [wx, wz] of [
        [-1.1, 1.3],
        [1.1, 1.3],
        [-1.1, -1.4],
        [1.1, -1.4],
      ] as const) {
        const w = MeshBuilder.CreateCylinder("jy_part", { diameter: 0.9, height: 0.35, tessellation: 8 }, this.scene);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, 0.45, wz);
        add(w, PAL.black);
      }
      node.dispose();
    };
    const bigGear = (k: Kit, x: number, z: number, yaw: number, R: number): void => {
      const y = groundHeight(x, z);
      const node = new TransformNode("jy_heroG", this.scene);
      node.position.set(x, y + R * 0.45, z);
      node.rotation.set(Math.PI / 2 - 0.35, yaw, 0);
      node.computeWorldMatrix(true);
      const parts: Mesh[] = [MeshBuilder.CreateCylinder("jy_part", { diameter: R * 2, height: R * 0.22, tessellation: 18 }, this.scene)];
      const hub = MeshBuilder.CreateCylinder("jy_part", { diameter: R * 0.5, height: R * 0.3, tessellation: 8 }, this.scene);
      parts.push(hub);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const t = MeshBuilder.CreateBox("jy_part", { width: R * 0.3, height: R * 0.2, depth: R * 0.3 }, this.scene);
        t.position.set(Math.cos(a) * R * 1.08, 0, Math.sin(a) * R * 1.08);
        t.rotation.y = -a;
        parts.push(t);
      }
      for (const m of parts) {
        m.parent = node;
        m.computeWorldMatrix(true);
        m.bakeCurrentTransformIntoVertices();
        m.parent = null;
        k.add(m, m === hub ? PAL.ironDark : PAL.rust, "metal");
      }
      node.dispose();
    };
    const arm = (k: Kit, x: number, z: number, yaw: number, c: Rgb): void => {
      const y = groundHeight(x, z);
      const a = new Vector3(x, y - 0.5, z);
      const e = new Vector3(x + Math.sin(yaw) * 3.5, y + 4.2, z + Math.cos(yaw) * 3.5);
      const h = new Vector3(e.x + Math.sin(yaw + 0.8) * 3, e.y + 0.8, e.z + Math.cos(yaw + 0.8) * 3);
      k.beam(a, e, 1.1, c, "metal");
      k.beam(e, h, 0.9, c, "metal");
      k.sphere(1.5, e.x, e.y, e.z, PAL.ironDark, "metal", 8);
      for (let i = 0; i < 3; i++) k.box(0.35, 1.4, 0.35, h.x + (i - 1) * 0.45, h.y + 0.6, h.z, PAL.iron, "metal", [0.4, yaw, (i - 1) * 0.3]);
    };
    const boiler = (k: Kit, x: number, z: number, yaw: number, c: Rgb): void => {
      const y = groundHeight(x, z);
      k.cyl(3.2, 3.2, 7, x, y + 1.1, z, c, "metal", 12, [Math.PI / 2 - 0.2, yaw, 0]);
      k.cyl(3.5, 3.5, 0.3, x + Math.sin(yaw) * 3.3, y + 1.6, z + Math.cos(yaw) * 3.3, PAL.ironDark, "metal", 12, [Math.PI / 2 - 0.2, yaw, 0]);
    };
    const container = (k: Kit, x: number, z: number, yaw: number, c: Rgb): void => {
      const y = groundHeight(x, z);
      k.box(2.6, 2.6, 6.2, x, y + 0.9, z, c, "paint", [0.12, yaw, 0.18]);
      for (let i = 0; i < 5; i++) k.box(2.66, 2.2, 0.12, x + Math.sin(yaw) * (-2.4 + i * 1.2), y + 0.95, z + Math.cos(yaw) * (-2.4 + i * 1.2), mix(c, PAL.black, 0.25), "paint", [0.12, yaw, 0.18]);
    };
    // 放在垃圾山腳（離中心 1～1.6σ，坡度大、不可走或在碰撞旁）
    for (const m of MOUNDS) {
      if (m.kind !== "junk") continue;
      const n = m.h > 20 ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2;
        const rr = m.s * (0.6 + r() * 0.9);
        const x = m.x + Math.cos(a) * rr;
        const z = m.z + Math.sin(a) * rr;
        if (Math.abs(x) > 140 || Math.abs(z) > 140) continue;
        if (polyDist(x, z, MAIN_ROUTE) < 7 || insideColliders(STATIC_COLLIDERS, x, z, 3)) continue;
        const k = kitFor(x, z);
        const c = paints[Math.floor(r() * paints.length)]!;
        const kind = Math.floor(r() * 5);
        const yaw = r() * Math.PI * 2;
        if (kind === 0) car(k, x, z, yaw, (r() - 0.5) * 0.7, c);
        else if (kind === 1) bigGear(k, x, z, yaw, 1.6 + r() * 1.4);
        else if (kind === 2) arm(k, x, z, yaw, c);
        else if (kind === 3) boiler(k, x, z, yaw, c);
        else container(k, x, z, yaw, c);
      }
    }
    for (const [zone, k] of kits) this.addKit(k, zone, false);
  }

  /** 漂浮魔法水晶（thin instances，3 種顏色共用 1 個網格） */
  private buildCrystals(): void {
    const src = MeshBuilder.CreatePolyhedron("jy_crystal", { type: 1, size: 0.55 }, this.scene);
    src.scaling.set(0.7, 1.6, 0.7);
    src.bakeCurrentTransformIntoVertices();
    src.material = this.mats.crystal;
    src.parent = this.root;
    src.isPickable = false;
    const n = CRYSTALS.length * 3;
    const mats = new Float32Array(n * 16);
    const cols = new Float32Array(n * 4);
    const base = new Float32Array(n * 4);
    const phase = new Float32Array(n);
    const hue = { pink: PAL.pink, violet: PAL.violet, cyan: PAL.cyan };
    let i = 0;
    for (const c of CRYSTALS) {
      for (let j = 0; j < 3; j++) {
        const a = j * 2.1 + c.x;
        const ox = j === 0 ? 0 : Math.cos(a) * 0.9 * c.s;
        const oz = j === 0 ? 0 : Math.sin(a) * 0.9 * c.s;
        const s = c.s * (j === 0 ? 1 : 0.55);
        base[i * 4] = c.x + ox;
        base[i * 4 + 1] = c.y + (j === 0 ? 1 : 0.4) * c.s;
        base[i * 4 + 2] = c.z + oz;
        base[i * 4 + 3] = s;
        phase[i] = (c.x * 0.37 + c.z * 0.11 + j) % (Math.PI * 2);
        const h = hue[c.hue];
        cols.set([h[0], h[1], h[2], 1], i * 4);
        Matrix.Compose(new Vector3(s, s, s), Quaternion.Identity(), new Vector3(base[i * 4]!, base[i * 4 + 1]!, base[i * 4 + 2]!)).copyToArray(mats, i * 16);
        i++;
      }
    }
    src.thinInstanceSetBuffer("matrix", mats, 16, false);
    src.thinInstanceSetBuffer("color", cols, 4, true);
    this.anim.crystals = { mesh: src, base, phase, n, buf: mats };
    this.landmarks.push({ mesh: src, zone: "far", caster: false });
  }

  // ---------------- 粒子 ----------------
  private particleCount = 0;
  private readonly fixedParticles: { ps: ParticleSystem; zone: string }[] = [];

  private sparks(at: Vector3, cap: number): void {
    const ps = new ParticleSystem("jy_sparks", cap, this.scene);
    ps.particleTexture = this.mats.dot;
    ps.emitter = at;
    ps.minEmitBox = new Vector3(-0.8, 0, -0.8);
    ps.maxEmitBox = new Vector3(0.8, 0.2, 0.8);
    ps.color1 = new Color4(1, 0.75, 0.3, 1);
    ps.color2 = new Color4(1, 0.45, 0.15, 1);
    ps.colorDead = new Color4(0.6, 0.15, 0.05, 0);
    ps.minSize = 0.08;
    ps.maxSize = 0.2;
    ps.minLifeTime = 0.5;
    ps.maxLifeTime = 1.2;
    ps.emitRate = cap * 0.9;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.gravity = new Vector3(0, -6, 0);
    ps.direction1 = new Vector3(-1.2, 4, -1.2);
    ps.direction2 = new Vector3(1.2, 6.5, 1.2);
    ps.minEmitPower = 0.6;
    ps.maxEmitPower = 1.2;
    ps.updateSpeed = 1 / 60;
    ps.start();
    this.particleCount += cap;
    this.fixedParticles.push({ ps, zone: this.zoneAt(at.x, at.z) });
  }

  private steam(at: Vector3, cap: number): ParticleSystem {
    const ps = new ParticleSystem("jy_steam", cap, this.scene);
    ps.particleTexture = this.mats.dot;
    ps.emitter = at;
    ps.minEmitBox = new Vector3(-0.4, 0, -0.4);
    ps.maxEmitBox = new Vector3(0.4, 0.2, 0.4);
    ps.color1 = new Color4(0.95, 0.95, 0.97, 0.38);
    ps.color2 = new Color4(0.85, 0.88, 0.92, 0.3);
    ps.colorDead = new Color4(0.9, 0.9, 0.95, 0);
    ps.minSize = 1.2;
    ps.maxSize = 2.6;
    ps.minScaleX = 1;
    ps.minLifeTime = 3;
    ps.maxLifeTime = 5;
    ps.emitRate = cap / 4;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.gravity = new Vector3(0.25, 0.5, 0);
    ps.direction1 = new Vector3(-0.2, 1, -0.2);
    ps.direction2 = new Vector3(0.2, 1.6, 0.2);
    ps.minEmitPower = 0.5;
    ps.maxEmitPower = 0.9;
    ps.addSizeGradient(0, 0.6);
    ps.addSizeGradient(1, 2.2);
    ps.updateSpeed = 1 / 60;
    ps.start();
    return ps;
  }

  /** 環境光點（玩家周圍緩慢飄浮的微光） */
  private buildAmbient(): void {
    const cap = this.tier === "high" ? 70 : 36;
    const ps = new ParticleSystem("jy_motes", cap, this.scene);
    ps.particleTexture = this.mats.dot;
    ps.emitter = new Vector3(0, 0, 0);
    ps.minEmitBox = new Vector3(-18, 0, -18);
    ps.maxEmitBox = new Vector3(18, 6, 18);
    ps.color1 = new Color4(1, 0.92, 0.6, 0.7);
    ps.color2 = new Color4(0.7, 0.9, 1, 0.6);
    ps.colorDead = new Color4(1, 1, 1, 0);
    ps.minSize = 0.08;
    ps.maxSize = 0.18;
    ps.minLifeTime = 4;
    ps.maxLifeTime = 7;
    ps.emitRate = cap / 5;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.gravity = new Vector3(0, 0.05, 0);
    ps.direction1 = new Vector3(-0.2, 0.1, -0.2);
    ps.direction2 = new Vector3(0.2, 0.35, 0.2);
    ps.minEmitPower = 0.2;
    ps.maxEmitPower = 0.5;
    ps.updateSpeed = 1 / 60;
    ps.start();
    this.ambient = ps;
    this.particleCount += cap;
  }

  // ---------------- 分區載入（實例化垃圾、植被、蒸氣） ----------------
  private source(key: string, build: () => Mesh): Mesh {
    let m = this.sources.get(key);
    if (!m) {
      m = build();
      m.isVisible = false;
      m.setEnabled(false);
      this.sources.set(key, m);
    }
    return m;
  }

  private tuftSource(): Mesh {
    // V2：細長尖葉（與星芽原野草叢同一種畫法）；高畫質 6 片、其他 4 片
    const g = bladeTuft({
      blades: this.tier === "high" ? 6 : 4,
      height: 0.5,
      heightVar: 0.22,
      width: 0.1,
      spread: 0.2,
      base: [0.3, 0.46, 0.2],
      mid: [0.5, 0.7, 0.32],
      tip: [0.74, 0.86, 0.44],
      seed: 5,
    });
    const m = new Mesh("jy_tuft", this.scene);
    const vd = new VertexData();
    vd.positions = g.positions;
    vd.normals = g.normals;
    vd.colors = g.colors;
    vd.indices = g.indices;
    vd.applyToMesh(m, false);
    m.material = this.mats.foliage;
    return m;
  }

  private flowerSource(): Mesh {
    const k = new Kit(this.scene, this.mats, "jy_flower");
    const st = MeshBuilder.CreatePlane("jy_part", { width: 0.05, height: 0.36 }, this.scene);
    st.position.y = 0.18;
    k.add(st, [0.4, 0.62, 0.3], "foliage");
    for (let i = 0; i < 2; i++) {
      const p = MeshBuilder.CreatePlane("jy_part", { width: 0.26, height: 0.26 }, this.scene);
      p.position.y = 0.38;
      p.rotation.y = (i * Math.PI) / 2;
      p.rotation.x = 0.5;
      k.add(p, [1, 1, 1], "foliage");
    }
    const [m] = k.bake();
    return m!;
  }

  private instanceMesh(src: Mesh, name: string, listIn: readonly Inst[], material: StandardMaterialLike, fade?: { view: CellView; rule: FadeRule; all: boolean }): Mesh {
    // 漸變時：固定的大件在前、可漸變的小碎屑在後（同一個網格、Draw Calls 不變）
    const list = fade && !fade.all ? [...listIn.filter((i) => !i.small), ...listIn.filter((i) => i.small)] : listIn;
    const fixed = fade ? (fade.all ? 0 : listIn.filter((i) => !i.small).length) : list.length;
    const m = src.clone(name, this.root, true, false) as Mesh;
    m.makeGeometryUnique?.();
    m.setEnabled(true);
    m.isVisible = true;
    m.material = material;
    m.isPickable = false;
    m.receiveShadows = true;
    const mats = new Float32Array(list.length * 16);
    const cols = new Float32Array(list.length * 4);
    const q = new Quaternion();
    const sc = new Vector3();
    const tr = new Vector3();
    for (let i = 0; i < list.length; i++) {
      const it = list[i]!;
      Quaternion.FromEulerAnglesToRef(it.rx, it.ry, it.rz, q);
      sc.set(it.s, it.s, it.s);
      tr.set(it.x, it.y, it.z);
      Matrix.ComposeToRef(sc, q, tr, TMP_M);
      TMP_M.copyToArray(mats, i * 16);
      cols[i * 4] = it.c[0];
      cols[i * 4 + 1] = it.c[1];
      cols[i * 4 + 2] = it.c[2];
      cols[i * 4 + 3] = 1;
    }
    if (fade && fixed < list.length) {
      // 先用完整清單算包圍盒（之後只改數量，不必每次重算）
      m.thinInstanceSetBuffer("matrix", mats, 16, true);
      m.thinInstanceRefreshBoundingInfo(false);
      const liveM = new Float32Array(mats);
      const liveC = new Float32Array(cols);
      m.thinInstanceSetBuffer("matrix", liveM, 16, false);
      m.thinInstanceSetBuffer("color", liveC, 4, false);
      m.thinInstanceRefreshBoundingInfo(false);
      const f: FadeMesh = { mesh: m, set: makeFadeSet(list, fixed, list.length * 7 + name.length), rule: fade.rule, mats, cols, liveM, liveC, idx: new Uint32Array(list.length), shown: list.length, tris: m.getTotalIndices() / 3 };
      fade.view.fades.push(f);
      if (Number.isFinite(this.fadeX) && !this.fadeHold) this.applyFade(f, this.fadeX, this.fadeZ);
    } else {
      m.thinInstanceSetBuffer("matrix", mats, 16, true);
      m.thinInstanceSetBuffer("color", cols, 4, true);
      m.thinInstanceRefreshBoundingInfo(false);
    }
    m.freezeWorldMatrix();
    m.alwaysSelectAsActiveMesh = false;
    return m;
  }

  private loadCell(id: string): void {
    if (this.cells.has(id)) return;
    const t0 = performance.now();
    const view: CellView = { id, meshes: [], particles: [], instances: 0, fades: [] };
    const rules = FADE_RULES[this.tier];
    const junk = this.scatter.junk.get(id);
    if (junk) {
      for (const [type, list] of junk) {
        if (!list.length) continue;
        const src = this.source(`junk_${type}`, () => junkSource(this.scene, this.mats, type as JunkType, this.lite));
        view.meshes.push(this.instanceMesh(src, `jy_junk_${id}_${type}`, list, this.mats.paint, this.fadeOn ? { view, rule: rules.debris, all: false } : undefined));
        view.instances += list.length;
      }
    }
    const tl = this.scatter.tufts.get(id);
    if (tl?.length) {
      view.meshes.push(this.instanceMesh(this.source("tuft", () => this.tuftSource()), `jy_tufts_${id}`, tl, this.mats.foliage, this.fadeOn ? { view, rule: rules.tuft, all: true } : undefined));
      view.instances += tl.length;
    }
    const fl = this.scatter.flowers.get(id);
    if (fl?.length) {
      view.meshes.push(this.instanceMesh(this.source("flower", () => this.flowerSource()), `jy_flowers_${id}`, fl, this.mats.foliage, this.fadeOn ? { view, rule: rules.flower, all: true } : undefined));
      view.instances += fl.length;
    }
    if (this.tier !== "low") {
      for (const v of STEAM_VENTS) {
        if (cellOf(v.x, v.z) !== id && v.zone !== id) continue;
        if (this.tier === "medium" && v.id.endsWith("2")) continue;
        view.particles.push(this.steam(new Vector3(v.x, v.y, v.z), this.tier === "high" ? 26 : 14));
      }
    }
    this.cells.set(id, view);
    this.streamLog.push({ t: performance.now() / 1000, cell: id, op: "load", ms: performance.now() - t0 });
  }

  private unloadCell(id: string): void {
    const v = this.cells.get(id);
    if (!v) return;
    const t0 = performance.now();
    for (const m of v.meshes) m.dispose(false, false);
    for (const p of v.particles) p.dispose(false);
    this.cells.delete(id);
    this.streamLog.push({ t: performance.now() / 1000, cell: id, op: "unload", ms: performance.now() - t0 });
  }

  private applyFade(f: FadeMesh, px: number, pz: number): void {
    const n = selectFade(f.set, px, pz, f.rule, f.idx);
    compactInto(f.mats, f.liveM, f.idx, n, 16);
    compactInto(f.cols, f.liveC, f.idx, n, 4);
    f.mesh.thinInstanceCount = n;
    f.mesh.thinInstanceBufferUpdated("matrix");
    f.mesh.thinInstanceBufferUpdated("color");
    f.mesh.setEnabled(n > 0);
    f.shown = n;
  }

  private fadeHold = false;
  /** 俯視全圖：全部小物件都顯示、暫停漸變；關閉時依角色位置重算 */
  setFadeOverview(on: boolean, px: number, pz: number): void {
    this.fadeHold = on;
    if (on) {
      for (const v of this.cells.values()) {
        for (const f of v.fades) {
          f.liveM.set(f.mats);
          f.liveC.set(f.cols);
          f.mesh.thinInstanceCount = f.set.xs.length;
          f.mesh.thinInstanceBufferUpdated("matrix");
          f.mesh.thinInstanceBufferUpdated("color");
          f.mesh.setEnabled(true);
          f.shown = f.set.xs.length;
        }
      }
    } else this.updateFades(px, pz, true);
  }

  /** 漸變統計（報告用） */
  fadeStats(): { on: boolean; meshes: number; total: number; shown: number; tris: number; trisFull: number } {
    let meshes = 0, total = 0, shown = 0, tris = 0, trisFull = 0;
    for (const v of this.cells.values()) {
      for (const f of v.fades) {
        meshes++;
        total += f.set.xs.length;
        shown += f.shown;
        tris += f.shown * f.tris;
        trisFull += f.set.xs.length * f.tris;
      }
    }
    return { on: this.fadeOn, meshes, total, shown, tris: Math.round(tris), trisFull: Math.round(trisFull) };
  }

  /** 小物件距離密度漸變：角色移動 1.5 公尺或每 0.25 秒更新一次 */
  updateFades(px: number, pz: number, force = false): void {
    if (!this.fadeOn || this.fadeHold) return;
    if (!force && Math.hypot(px - this.fadeX, pz - this.fadeZ) < 1.5) return;
    this.fadeX = px;
    this.fadeZ = pz;
    for (const v of this.cells.values()) for (const f of v.fades) this.applyFade(f, px, pz);
  }

  /** 分區載入：區域邊緣距離 < 載入距離就建立；> 釋放距離就釋放（遲滯避免來回） */
  updateStreaming(px: number, pz: number, force = false): void {
    const near = this.tier === "high" ? 70 : this.tier === "medium" ? 58 : 46;
    const far = near + 40;
    for (const c of STREAM_CELLS) {
      const d = Math.hypot(px - c.x, pz - c.z) - c.r;
      if (d < near) this.loadCell(c.id);
      else if (d > far || force) this.unloadCell(c.id);
    }
  }

  // ---------------- 每幀 ----------------
  update(dt: number, px: number, pz: number, py: number): void {
    this.t += dt;
    const t = this.t;
    for (const c of this.anim.cranes) {
      c.swing.rotation.y = c.def.phase + Math.sin(t * c.def.speed + c.def.phase) * c.def.swing;
      c.claw.position.y = -3.4 - (0.5 + 0.5 * Math.sin(t * c.def.speed * 2.2 + c.def.phase)) * 3;
    }
    for (const g of this.anim.gears) g.node.rotation.y += g.speed * dt;
    for (const r of this.anim.rings) r.node.rotation.y += r.speed * dt;
    if (this.anim.core) {
      const s = 1 + 0.04 * Math.sin(t * 2.4);
      this.anim.core.scaling.set(s, 1, s);
    }
    const pulse = 0.82 + 0.18 * Math.sin(t * 2.2);
    this.mats.glowBlue.emissiveColor.set(0.35 * pulse, 0.85 * pulse, 1 * pulse);
    const op = 0.9 + 0.1 * Math.sin(t * 3.1);
    this.mats.glowOrange.emissiveColor.set(1 * op, 0.62 * op, 0.22 * op);
    for (let i = 0; i < 3; i++) {
      // 偶爾閃一下：大部分時間亮，偶爾熄滅 0.15 秒
      const ph = (t * (0.7 + i * 0.23) + i * 1.7) % 4;
      const on = ph < 3.75 || (ph > 3.85 && ph < 3.9);
      this.mats.flicker[i]!.emissiveColor.set(on ? 1 : 0.15, on ? 0.7 : 0.1, on ? 0.3 : 0.05);
    }
    if (this.anim.beltTex) this.anim.beltTex.vOffset = (this.anim.beltTex.vOffset + dt * 0.25) % 1;
    if (this.anim.waterTex) {
      this.anim.waterTex.uOffset = (this.anim.waterTex.uOffset + dt * 0.012) % 1;
      this.anim.waterTex.vOffset = (this.anim.waterTex.vOffset + dt * 0.008) % 1;
    }
    const cr = this.anim.crystals;
    if (cr) {
      const q = TMP_Q;
      const arr = cr.buf;
      for (let i = 0; i < cr.n; i++) {
        const s = cr.base[i * 4 + 3]!;
        Quaternion.FromEulerAnglesToRef(0, t * 0.6 + cr.phase[i]!, 0.15 * Math.sin(t + cr.phase[i]!), q);
        TMP_V.set(cr.base[i * 4]!, cr.base[i * 4 + 1]! + 0.25 * Math.sin(t * 1.3 + cr.phase[i]!), cr.base[i * 4 + 2]!);
        TMP_S.set(s, s, s);
        Matrix.ComposeToRef(TMP_S, q, TMP_V, TMP_M);
        TMP_M.copyToArray(arr, i * 16);
      }
      cr.mesh.thinInstanceBufferUpdated("matrix");
    }
    if (this.ambient) (this.ambient.emitter as Vector3).set(px, py, pz);
    this.fadeTimer -= dt;
    if (this.fadeTimer <= 0) {
      this.fadeTimer = 0.25;
      this.updateFades(px, pz);
    }
    this.casterTimer -= dt;
    if (this.casterTimer <= 0) {
      this.casterTimer = 0.5;
      this.updateStreaming(px, pz);
      this.updateCasters(px, pz);
      // 粒子只在附近才跑
      for (const f of this.fixedParticles) {
        const e = f.ps.emitter as Vector3;
        const near = Math.hypot(e.x - px, e.z - pz) < 70;
        if (near && !f.ps.isStarted()) f.ps.start();
        else if (!near && f.ps.isStarted()) f.ps.stop();
      }
    }
  }

  /** 陰影投射物：只有玩家附近（shadowRange）的大型地標 */
  private updateCasters(px: number, pz: number): void {
    const sg = this.shadows;
    if (!sg) return;
    const map = sg.getShadowMap();
    if (!map) return;
    const list: AbstractMesh[] = [];
    for (const l of this.landmarks) {
      if (!l.caster || !l.mesh.isEnabled()) continue;
      const bi = l.mesh.getBoundingInfo().boundingSphere;
      const c = bi.centerWorld;
      if (Math.hypot(c.x - px, c.z - pz) - bi.radiusWorld < this.shadowRange) list.push(l.mesh);
    }
    for (const x of this.extraCasters) list.push(x);
    map.renderList = list;
  }

  /** 角色等額外投射物 */
  readonly extraCasters: AbstractMesh[] = [];

  /** 每個網格的三角面（報告用） */
  stats(): JunkyardStats {
    const tri = (m: AbstractMesh): number => {
      const idx = m.getTotalIndices();
      const inst = (m as Mesh).thinInstanceCount || 1;
      return (idx / 3) * inst;
    };
    let tt = 0;
    for (const c of this.chunks) tt += tri(c);
    let lt = 0;
    for (const l of this.landmarks) lt += tri(l.mesh);
    let inst = 0;
    let im = 0;
    for (const v of this.cells.values()) {
      inst += v.instances;
      im += v.meshes.length;
    }
    return {
      terrainChunks: this.chunks.length,
      terrainTris: Math.round(tt),
      landmarkMeshes: this.landmarks.length,
      landmarkTris: Math.round(lt),
      loadedCells: [...this.cells.keys()],
      instances: inst,
      instanceMeshes: im,
      particles: this.particleCount + [...this.cells.values()].reduce((a, v) => a + v.particles.reduce((b, p) => b + p.getCapacity(), 0), 0),
      buildMs: Math.round(this.buildMs),
      scatter: this.scatter.counts,
      fade: this.fadeStats(),
    };
  }

  /** 分組統計（效能報告的 perfBreakdown 用） */
  groupOf(name: string): string {
    if (name.startsWith("jy_terrain")) return "地形";
    if (name.startsWith("jy_junk")) return "實例化垃圾";
    if (name.startsWith("jy_tufts") || name.startsWith("jy_flowers")) return "草叢小花";
    if (name.startsWith("jy_water")) return "水面";
    if (name.startsWith("jy_pavement")) return "高台鋪面";
    if (name.startsWith("jy_crystal")) return "漂浮水晶";
    if (name.startsWith("jy_")) return "地標與機械";
    return "其他";
  }
}

type StandardMaterialLike = import("@babylonjs/core").Material;
const TMP_M = new Matrix();
const TMP_V = new Vector3();
const TMP_S = new Vector3();
const TMP_Q = new Quaternion();

function gradientPlane(p: Mesh, bottom: Rgb, top: Rgb): void {
  const pos = p.getVerticesData(VertexBuffer.PositionKind)!;
  const n = pos.length / 3;
  const cols = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const t = pos[i * 3 + 1]! > 0 ? 1 : 0;
    cols[i * 4] = bottom[0] + (top[0] - bottom[0]) * t;
    cols[i * 4 + 1] = bottom[1] + (top[1] - bottom[1]) * t;
    cols[i * 4 + 2] = bottom[2] + (top[2] - bottom[2]) * t;
    cols[i * 4 + 3] = 1;
  }
  p.setVerticesData(VertexBuffer.ColorKind, cols);
}

