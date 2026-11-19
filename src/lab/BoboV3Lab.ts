import "@babylonjs/loaders/glTF";
import {
  type AbstractMesh,
  ArcRotateCamera,
  type BaseTexture,
  Color3,
  Constants,
  DynamicTexture,
  Matrix,
  Sprite,
  SpriteManager,
  DirectionalLight,
  HemisphericLight,
  type Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  SceneInstrumentation,
  SceneLoader,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import { createEngine, createShadows, createSkyDome, pickQuality, setupRendering } from "../render/RenderQuality.ts";
import { PerfOverlay } from "../render/PerfOverlay.ts";
import { FrameRecorder, type BenchmarkSummary } from "../render/benchmark.ts";
import { JellyV3Plugin } from "../monsters/star-dew-bobo-v3/JellyV3Plugin.ts";
import { createJellyNoiseTexture, JellyV31Plugin } from "../monsters/star-dew-bobo-v31/JellyV31Plugin.ts";
import { createJellyNoiseTextureV32, JellyV32Plugin } from "../monsters/star-dew-bobo-v32/JellyV32Plugin.ts";
import { createJellyNoiseTextureV34, JellyV34Plugin } from "../monsters/star-dew-bobo-v34/JellyV34Plugin.ts";
import { createJellyNoiseTextureV35, JellyV35Plugin } from "../monsters/star-dew-bobo-v35/JellyV35Plugin.ts";

/** v3 = 第一版（材質與模型保持不變，作為對照基準）；v31 = V3.1 美術精修 */
export type BoboLabVariant = "v3" | "v31" | "v32" | "v33" | "v34" | "v35";
type Jelly = JellyV3Plugin | JellyV31Plugin | JellyV32Plugin | JellyV34Plugin | JellyV35Plugin;
type StarJelly = JellyV32Plugin | JellyV34Plugin | JellyV35Plugin;
const isStarJelly = (j: unknown): j is StarJelly => j instanceof JellyV32Plugin || j instanceof JellyV34Plugin || j instanceof JellyV35Plugin;
const VARIANT_LAB: Record<BoboLabVariant, string> = { v3: "bobo3", v31: "bobo31", v32: "bobo32", v33: "bobo33", v34: "bobo34", v35: "bobo35" };
const VARIANT_LABEL: Record<BoboLabVariant, string> = { v3: "V3", v31: "V3.1", v32: "V3.2", v33: "V3.3", v34: "V3.4", v35: "V3.5" };
// 頁面切換按鈕：V3.4 ↔ V3.5（目前驗收的兩版）；更早的版本仍可用網址 ?lab= 開啟
const VARIANT_NEXT: Record<BoboLabVariant, BoboLabVariant> = { v3: "v31", v31: "v32", v32: "v33", v33: "v34", v34: "v35", v35: "v34" };

/** V3.3 起：腹部星星的定義寫在模型檔（根節點 extras.bellyStar），由頁面讀取後交給果凍著色器繪製 */
interface BellyStarDef {
  version: string;
  outer: number;
  inner: number;
  center: [number, number, number];
  normal: [number, number, number];
}
function readBellyStar(container: { transformNodes: TransformNode[]; meshes: AbstractMesh[] }): BellyStarDef | null {
  for (const n of [...container.transformNodes, ...container.meshes]) {
    const star = (n.metadata as { gltf?: { extras?: { bellyStar?: BellyStarDef } } } | null)?.gltf?.extras?.bellyStar;
    if (star) return star;
  }
  return null;
}

/**
 * 星露啵啵 V3 模型預覽（?lab=bobo3）。
 * 只做外觀檢查：三視圖、8 種表情、三隻同場、效能測試。動畫與遊戲整合在模型外觀確認後才進行。
 * 模型：Blender 雲端腳本產出的 GLB（public/models/bobo_v3_<畫質>.glb）。V2 不受影響。
 */

export const V3_EXPRESSIONS = ["normal", "happy", "curious", "angry", "scared", "dizzy", "sleepy", "hurt"] as const;
export type V3Expression = (typeof V3_EXPRESSIONS)[number];
const EXPRESSION_LABEL: Record<V3Expression, string> = {
  normal: "一般",
  happy: "開心",
  curious: "好奇",
  angry: "生氣",
  scared: "害怕",
  dizzy: "暈眩",
  sleepy: "昏睡",
  hurt: "受傷",
};
type View = "front" | "side" | "back";
/** 鏡頭水平角：模型面向 +Z。側面依設定圖從角色左側看（臉朝畫面左） */
const VIEW_ALPHA: Record<View, number> = { front: Math.PI / 2, side: Math.PI, back: -Math.PI / 2 };
const VIEW_LABEL: Record<View, string> = { front: "正面", side: "側面", back: "背面" };

export interface BoboV3Info {
  quality: string;
  meshes: { name: string; triangles: number; vertices: number }[];
  trianglesTotal: number;
  materials: number;
}

export interface BoboV3DebugApi {
  ready: boolean;
  error?: string;
  setView(v: View): void;
  setExpression(e: V3Expression): void;
  setCount(n: 1 | 3): void;
  /** 近距離（截圖對照用） */
  setClose(on: boolean): void;
  info(): BoboV3Info;
  /** 第一隻的眼睛 UV 第一個座標（測試表情是否真的切換） */
  eyeUV0(): [number, number];
  perf(): {
    fps: number;
    drawCalls: number;
    activeMeshes: number;
    pixelRatio: number;
    quality: string;
    jelly: boolean;
    variant: BoboLabVariant;
    file: string;
    bellyStar: { outer: number; inner: number; centerY: number } | null;
    bellyStarVersion: string | null;
    shadowMap: boolean;
    glowLayer: boolean;
  };
  costAnalysis(seconds?: number): Promise<{ name: string; avg: number; low1: number; draws: number }[]>;
  benchmark(seconds?: number): Promise<BenchmarkSummary>;
}

declare global {
  interface Window {
    __bobo3?: BoboV3DebugApi;
  }
}

interface BoboV3Instance {
  root: TransformNode;
  body: Mesh;
  eyes: Mesh;
  mouth: Mesh;
  blush: Mesh;
  stars: Mesh;
  jelly: Jelly | null;
  eyeUV: Float32Array;
  mouthUV: Float32Array;
}

export async function startBoboV3Lab(canvas: HTMLCanvasElement, uiRoot: HTMLElement, variant: BoboLabVariant = "v3"): Promise<void> {
  // v31 = 「V3.1 或更新」的模型與材質流程；V3.2 第一步沿用 V3.1 模型檔（不修改它），只換果凍材質
  const v31 = variant !== "v3";
  /**
   * V3.5 繪製方式（只有 V3.5，其他版本維持原樣以便對照）：
   * - 不用陰影貼圖（啵啵不再畫進陰影貼圖、地面與果凍不做柔和陰影取樣），改用設定圖那樣的柔和圓形接觸陰影（3 隻共 1 次繪製）
   * - 不用 GlowLayer（省掉發光貼圖與兩次全畫面模糊），頭頂星星改用光暈貼片（3 隻共 1 次繪製）；腹部星星光暈本來就在果凍著色器裡
   */
  const v35 = variant === "v35";
  const label = VARIANT_LABEL[variant];
  const quality = pickQuality();
  const engine = createEngine(canvas, quality);
  const scene = new Scene(engine);
  createSkyDome(scene);
  scene.skipPointerMovePicking = true;

  const hemi = new HemisphericLight("sky", new Vector3(0.2, 1, 0.3), scene);
  hemi.intensity = 0.85;
  hemi.groundColor = new Color3(0.6, 0.68, 0.6);
  const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, -0.5).normalize(), scene);
  sun.position = new Vector3(4, 10, 5);
  sun.intensity = 0.6;
  const shadows = v35 ? null : createShadows(sun, { ...quality, shadows: { ...quality.shadows, mapSize: Math.min(1024, quality.shadows.mapSize) } });
  if (shadows) shadows.darkness = 0.4;

  const grassMat = new StandardMaterial("PH_labGrass", scene);
  grassMat.diffuseColor = new Color3(0.55, 0.82, 0.45);
  grassMat.specularColor = new Color3(0.03, 0.03, 0.03);
  const ground = MeshBuilder.CreateCylinder("PH_labGround", { diameter: 9, height: 0.2, tessellation: 48 }, scene);
  ground.position.y = -0.1;
  ground.material = grassMat;
  ground.receiveShadows = !v35;

  const camera = new ArcRotateCamera("labCam", VIEW_ALPHA.front, 1.3, 2.6, new Vector3(0, 0.5, 0), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 1.2;
  camera.upperRadiusLimit = 7;
  camera.lowerBetaLimit = 0.35;
  camera.upperBetaLimit = 1.55;
  camera.panningSensibility = 0;
  camera.minZ = 0.05;
  const render = setupRendering(scene, camera, v35 ? { ...quality, bloom: { ...quality.bloom, enabled: false } } : quality);

  // ---------- 載入 GLB（依畫質選 LOD） ----------
  const base = import.meta.env.BASE_URL;
  // V3.3 載入自己的模型檔（含 V3.3 腹部星星定義）；V3.1／V3.2 共用 V3.1 模型；V3 用 V3 模型
  const file =
    variant === "v35"
      ? `bobo_v35_${quality.level}.glb`
      : variant === "v34"
      ? `bobo_v34_${quality.level}.glb`
      : variant === "v33"
        ? `bobo_v33_${quality.level}.glb`
        : v31
          ? `bobo_v31_${quality.level}.glb`
          : `bobo_v3_${quality.level}.glb`;
  const container = await SceneLoader.LoadAssetContainerAsync(`${base}models/`, file, scene);
  const starFromModel = variant === "v33" || variant === "v34" || variant === "v35";
  const bellyStar = starFromModel ? readBellyStar(container) : null;
  if (starFromModel && !bellyStar) throw new Error(`${file} 缺少腹部星星資料（extras.bellyStar）`);

  // 共用材質（三隻共用；每隻的表情以各自的 UV 緩衝切換）
  const mats = v31
    ? createMaterialsV31(
        scene,
        container.materials as PBRMaterial[],
        quality.level !== "low",
        variant === "v35" ? "v35" : variant === "v34" ? "v34" : variant === "v32" || variant === "v33" ? "v32" : "v31",
      )
    : createMaterials(scene, container.materials as PBRMaterial[], quality.level !== "low");
  const instances: BoboV3Instance[] = [];
  const spawn = (x: number, z: number, yaw: number): BoboV3Instance => {
    const inst = container.instantiateModelsToScene((n) => `${n}_${instances.length}`, false, { doNotInstantiate: true });
    const root = new TransformNode(`bobo3_${instances.length}`, scene);
    for (const n of inst.rootNodes) n.parent = root;
    root.position.set(x, 0, z);
    root.rotation.y = yaw;
    const meshes = root.getChildMeshes(false) as Mesh[];
    const find = (prefix: string): Mesh => {
      const m = meshes.find((mm) => mm.name.startsWith(prefix));
      if (!m) throw new Error(`V3 模型缺少零件：${prefix}`);
      return m;
    };
    const body = find("Body_");
    const eyes = find("Eyes");
    const mouth = find("Mouth");
    const blush = find("Blush");
    const stars = find("Stars");
    // 各零件材質與繪製順序：眼睛／星星不透明先畫，身體（透明）再畫，嘴與腮紅最後疊在表面
    const bodyMat = mats.body(instances.length);
    // V3.3：果凍材質與 V3.2 完全相同，只換成模型檔裡的腹部星星
    if (bellyStar && isStarJelly(bodyMat.jelly)) {
      bodyMat.jelly.starOuter = bellyStar.outer;
      bodyMat.jelly.starInner = bellyStar.inner;
      bodyMat.jelly.starCenter.set(...bellyStar.center);
      bodyMat.jelly.starNormal.set(...bellyStar.normal).normalize();
    }
    body.material = bodyMat.material;
    body.alphaIndex = 1;
    eyes.material = mats.eyes;
    // 星星不透明先畫；腹部星星在果凍裡面，由果凍蓋過去＋著色器的暖光從內部透出
    stars.material = mats.stars;
    // 身體先寫入深度：只看得到最前面的果凍表面（另一側翅膀不會亂序地疊到前面）
    bodyMat.material.needDepthPrePass = true;
    blush.material = mats.blush;
    blush.alphaIndex = 2;
    mouth.material = mats.mouth;
    mouth.alphaIndex = 3;
    // V3.1：眼睛改為透明混合（邊緣平滑、無鋸齒），在果凍之後、腮紅之前畫
    if (v31) eyes.alphaIndex = 2;
    if (shadows) for (const m of [body, eyes, stars]) shadows.addShadowCaster(m, false);
    render.glow?.addIncludedOnlyMesh(stars);
    for (const m of meshes) {
      m.isPickable = false;
      m.receiveShadows = !v35 && m === body;
    }
    // glTF 載入的 UV 緩衝不可更新：各自複製一份並設為可更新，表情才能用改 UV 的方式切換
    eyes.makeGeometryUnique();
    mouth.makeGeometryUnique();
    const eyeUV = Float32Array.from(eyes.getVerticesData(VertexBuffer.UVKind) ?? []);
    const mouthUV = Float32Array.from(mouth.getVerticesData(VertexBuffer.UVKind) ?? []);
    eyes.setVerticesData(VertexBuffer.UVKind, Float32Array.from(eyeUV), true);
    mouth.setVerticesData(VertexBuffer.UVKind, Float32Array.from(mouthUV), true);
    const it: BoboV3Instance = { root, body, eyes, mouth, blush, stars, jelly: bodyMat.jelly, eyeUV, mouthUV };
    instances.push(it);
    return it;
  };
  spawn(0, 0, 0);

  // ---------- V3.5：柔和接觸陰影＋頭頂星星光暈（各 1 次繪製，取代陰影貼圖與 GlowLayer） ----------
  let updateFx = (): void => {};
  if (v35) {
    const shadowTex = new DynamicTexture("BoboV35_BlobTex", { width: 128, height: 128 }, scene, true);
    {
      const ctx = shadowTex.getContext() as CanvasRenderingContext2D;
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.45, "rgba(255,255,255,0.75)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      shadowTex.update();
    }
    shadowTex.hasAlpha = true;
    const blobMat = new StandardMaterial("BoboV35_BlobMat", scene);
    blobMat.disableLighting = true;
    blobMat.emissiveColor = new Color3(0.14, 0.24, 0.2); // 草地上偏冷的陰影色
    blobMat.opacityTexture = shadowTex;
    blobMat.alpha = 0.42;
    blobMat.disableDepthWrite = true;
    blobMat.zOffset = -2;
    const blob = MeshBuilder.CreateGround("BoboV35_BlobShadow", { width: 1.05, height: 0.82 }, scene);
    blob.material = blobMat;
    blob.isPickable = false;
    blob.alphaIndex = 0;

    const haloCanvas = document.createElement("canvas");
    haloCanvas.width = haloCanvas.height = 128;
    {
      const ctx = haloCanvas.getContext("2d")!;
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      // 檸檬金黃（設定圖頭頂星星的柔光），不偏橘
      g.addColorStop(0, "rgba(255,244,170,0.85)");
      g.addColorStop(0.3, "rgba(255,232,130,0.42)");
      g.addColorStop(0.65, "rgba(255,222,110,0.12)");
      g.addColorStop(1, "rgba(255,215,100,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
    const halo = new SpriteManager("BoboV35_StarHalo", haloCanvas.toDataURL("image/png"), 3, { width: 128, height: 128 }, scene);
    halo.blendMode = Constants.ALPHA_ADD;
    halo.disableDepthWrite = true;
    halo.isPickable = false;
    const sprites: Sprite[] = [];
    updateFx = (): void => {
      const shown = instances.filter((i) => i.root.isEnabled());
      const buf = new Float32Array(16 * Math.max(1, shown.length));
      shown.forEach((it, k) => {
        it.root.computeWorldMatrix(true);
        const p = it.root.getAbsolutePosition();
        Matrix.Translation(p.x, 0.004, p.z).copyToArray(buf, k * 16);
      });
      blob.thinInstanceSetBuffer("matrix", buf, 16, false);
      blob.thinInstanceCount = shown.length;
      while (sprites.length < instances.length) {
        const sp = new Sprite(`BoboV35_Halo_${sprites.length}`, halo);
        sp.width = sp.height = 0.42;
        sprites.push(sp);
      }
      instances.forEach((it, k) => {
        it.stars.computeWorldMatrix(true);
        it.stars.refreshBoundingInfo();
        sprites[k]!.position.copyFrom(it.stars.getBoundingInfo().boundingSphere.centerWorld);
        sprites[k]!.isVisible = it.root.isEnabled();
      });
    };
    updateFx();
  }

  // 星星光暈：金色（與 V2 相同作法）
  if (render.glow) {
    render.glow.customEmissiveColorSelector = (mesh, _sub, material, result) => {
      if (mesh.name.startsWith("Stars")) {
        if (v31) result.set(0.42, 0.32, 0.06, 1); // V3.1：柔和光暈，五角輪廓保持清楚
        else result.set(0.75, 0.45, 0.05, 1);
      }
      else {
        const e = (material as StandardMaterial).emissiveColor;
        if (e) result.set(e.r, e.g, e.b, 1);
        else result.set(0, 0, 0, 1);
      }
    };
  }

  // ---------- 表情：改 UV（眼睛 4×2 格、嘴 4×2 格；glTF UV 原點在左上） ----------
  let expression: V3Expression = "normal";
  const setExpression = (e: V3Expression): void => {
    expression = e;
    const i = V3_EXPRESSIONS.indexOf(e);
    const col = i % 4;
    const row = Math.floor(i / 4);
    for (const it of instances) {
      const eu = new Float32Array(it.eyeUV.length);
      for (let k = 0; k < eu.length; k += 2) {
        eu[k] = it.eyeUV[k]! + col * 0.25;
        eu[k + 1] = it.eyeUV[k + 1]! + row * 0.5;
      }
      it.eyes.updateVerticesData(VertexBuffer.UVKind, eu);
      const mu = new Float32Array(it.mouthUV.length);
      for (let k = 0; k < mu.length; k += 2) {
        mu[k] = it.mouthUV[k]! + col * 0.25;
        mu[k + 1] = it.mouthUV[k + 1]! + row * 0.25;
      }
      it.mouth.updateVerticesData(VertexBuffer.UVKind, mu);
    }
    for (const b of exprButtons) b.classList.toggle("active", b.dataset.expr === e);
  };

  const setCount = (n: 1 | 3): void => {
    while (instances.length < n) {
      const k = instances.length;
      spawn(k === 1 ? -1.4 : 1.4, k === 1 ? -0.9 : -0.9, k === 1 ? 0.35 : -0.35);
      setExpression(expression);
    }
    instances.forEach((it, i) => it.root.setEnabled(i < n));
    // 3 隻：鏡頭拉遠讓三隻都在畫面內（接近遊戲中的大小）；1 隻：近看
    updateFx();
    camera.radius = n === 3 ? 4.6 : 2.6;
    camera.target.y = n === 3 ? 0.45 : 0.5;
    for (const b of countButtons) b.classList.toggle("active", Number(b.dataset.count) === n);
  };

  // ---------- UI ----------
  // 左上角由上而下排列（標題 → 視角 → 效能測試 → 結果），不論直向或橫向都不會互相覆蓋
  uiRoot.innerHTML = `
    <div class="v3-top">
    <div class="lab-title v3-title" data-layout="lab-title">
      <div class="lab-name">星露啵啵 ${label} <small>模型預覽</small></div>
      <div class="lab-state">畫質：${quality.level}・${file}${bellyStar ? `・腹部星星 ${bellyStar.outer}（模型 V${bellyStar.version}）` : ""}</div>
    </div>
    <div class="lab-views v3-views">
      ${(["front", "side", "back"] as const).map((v) => `<button class="lab-view-btn" data-view="${v}" data-layout="btn-view-${v}">${VIEW_LABEL[v]}</button>`).join("")}
      <button class="lab-view-btn" data-count="1" data-layout="btn-count-1">1 隻</button>
      <button class="lab-view-btn" data-count="3" data-layout="btn-count-3">3 隻</button>
      <button class="lab-view-btn v3-switch" data-layout="btn-switch">看 ${VARIANT_LABEL[VARIANT_NEXT[variant]]}</button>
    </div>
    <button class="v3-bench lab-bench" data-layout="btn-bench">⏱ 效能測試（10 秒）</button>
    <button class="lab-view-btn v3-cost" data-layout="btn-cost">🔍 成本分析（約 35 秒）</button>
    <div class="lab-bench-result v3-bench-result" hidden></div>
    </div>
    <div class="lab-fps" data-layout="lab-fps">-- FPS</div>
    <div class="lab-panel v3-expr">
      ${V3_EXPRESSIONS.map((e) => `<button class="lab-btn" data-expr="${e}" data-layout="btn-expr-${e}">${EXPRESSION_LABEL[e]}</button>`).join("")}
    </div>`;
  const viewButtons = [...uiRoot.querySelectorAll<HTMLButtonElement>("[data-view]")];
  const exprButtons = [...uiRoot.querySelectorAll<HTMLButtonElement>("[data-expr]")];
  const countButtons = [...uiRoot.querySelectorAll<HTMLButtonElement>("[data-count]")];
  const fpsEl = uiRoot.querySelector<HTMLDivElement>(".lab-fps")!;
  const benchBtn = uiRoot.querySelector<HTMLButtonElement>(".lab-bench")!;
  const benchEl = uiRoot.querySelector<HTMLDivElement>(".lab-bench-result")!;
  // V3 ↔ V3.1 切換：保留畫質等其他網址參數，同裝置、同條件比較
  uiRoot.querySelector<HTMLButtonElement>(".v3-switch")!.addEventListener("click", () => {
    const u = new URL(location.href);
    u.searchParams.set("lab", VARIANT_LAB[VARIANT_NEXT[variant]]);
    u.searchParams.delete("bench");
    location.href = u.toString();
  });

  let targetAlpha = VIEW_ALPHA.front;
  let snap = false;
  const setView = (v: View, instant = false): void => {
    targetAlpha = VIEW_ALPHA[v];
    snap = instant;
    for (const b of viewButtons) b.classList.toggle("active", b.dataset.view === v);
  };
  for (const b of viewButtons) b.addEventListener("click", () => setView(b.dataset.view as View));
  for (const b of exprButtons) b.addEventListener("click", () => setExpression(b.dataset.expr as V3Expression));
  for (const b of countButtons) b.addEventListener("click", () => setCount(Number(b.dataset.count) as 1 | 3));
  setView("front", true);
  setExpression("normal");
  setCount(1);

  const perf = new PerfOverlay(engine, scene, quality, uiRoot);
  const instr = new SceneInstrumentation(scene);
  let bench: { rec: FrameRecorder; resolve: (r: BenchmarkSummary) => void } | null = null;
  const runBenchmark = (seconds = 10): Promise<BenchmarkSummary> =>
    new Promise((resolve) => {
      if (bench) return;
      benchEl.hidden = true;
      benchBtn.classList.add("on");
      bench = { rec: new FrameRecorder(seconds), resolve };
      benchBtn.textContent = "⏱ 測試中…請勿操作";
    });
  benchBtn.addEventListener("click", () => void runBenchmark(10));

  /**
   * 成本分析（在手機上實測）：同一畫面依序關掉一項功能各測幾秒，看哪一項最吃效能。
   * 只是暫時切換，測完全部還原；不改變正式設定。
   */
  const costBtn = uiRoot.querySelector<HTMLButtonElement>(".v3-cost")!;
  const runCostAnalysis = async (seconds = 5): Promise<{ name: string; avg: number; low1: number; draws: number }[]> => {
    if (bench) return [];
    const rows: { name: string; avg: number; low1: number; draws: number }[] = [];
    const scale0 = engine.getHardwareScalingLevel();
    const samples0 = render.pipeline?.samples ?? 1;
    const jellies = instances.map((i) => i.jelly).filter((j): j is Jelly => !!j);
    const neb0 = jellies.map((j) => ("nebula" in j ? j.nebula : 0));
    const countNow = (instances.filter((i) => i.root.isEnabled()).length === 3 ? 3 : 1) as 1 | 3;
    const steps: { name: string; on: () => void; off: () => void }[] = [
      { name: "目前設定", on: () => {}, off: () => {} },
      { name: "關閉果凍內部星雲", on: () => jellies.forEach((j) => "nebula" in j && (j.nebula = 0)), off: () => jellies.forEach((j, k) => "nebula" in j && (j.nebula = neb0[k]!)) },
      { name: "關閉果凍材質（純透明）", on: () => jellies.forEach((j) => (j.jellyEnabled = false)), off: () => jellies.forEach((j) => (j.jellyEnabled = true)) },
      { name: "關閉 MSAA 抗鋸齒", on: () => render.pipeline && (render.pipeline.samples = 1), off: () => render.pipeline && (render.pipeline.samples = samples0) },
      { name: "解析度 1.5x", on: () => engine.setHardwareScalingLevel(1 / 1.5), off: () => engine.setHardwareScalingLevel(scale0) },
      { name: "隱藏啵啵（只剩場景）", on: () => instances.forEach((i) => i.root.setEnabled(false)), off: () => {} },
    ];
    costBtn.disabled = true;
    for (const st of steps) {
      costBtn.textContent = `🔍 測試中：${st.name}`;
      st.on();
      updateFx();
      await new Promise((r) => window.setTimeout(r, 600));
      const r = await runBenchmark(seconds);
      rows.push({ name: st.name, avg: r.avgFps, low1: r.low1Fps, draws: r.avgDrawCalls });
      st.off();
      setCount(countNow);
    }
    costBtn.disabled = false;
    costBtn.textContent = "🔍 成本分析（約 35 秒）";
    const st = perf.stats();
    benchEl.hidden = false;
    benchEl.innerHTML =
      `<b>${label} 成本分析（本機 WebGL 實測，每項 ${seconds} 秒）</b><br>${file}・${countNow} 隻・畫質 ${st.quality}・${Math.round(10 / scale0) / 10}x<br>` +
      rows.map((r) => `${r.name}：平均 ${r.avg.toFixed(1)}・1% ${r.low1.toFixed(1)}・Draw ${r.draws.toFixed(0)}`).join("<br>") +
      `<br><small>某項關掉後 FPS 上升越多 → 那一項越吃效能。點此關閉</small>`;
    benchEl.onclick = () => (benchEl.hidden = true);
    return rows;
  };
  costBtn.addEventListener("click", () => void runCostAnalysis(5));
  // 網址參數：?lab=bobo3&count=3&bench=1 → 載入 3 秒後自動測試（不必點按鈕）
  const params = new URLSearchParams(location.search);
  if (params.get("count") === "3") setCount(3);
  if (params.get("bench") === "1") window.setTimeout(() => void runBenchmark(10), 3000);

  let uiTimer = 0;
  engine.runRenderLoop(() => {
    const rawDt = engine.getDeltaTime() / 1000;
    const dt = Math.min(rawDt, 0.1);
    // 鏡頭平滑轉到指定視角（效能測試時緩慢繞一圈）
    if (bench) camera.alpha += (dt * Math.PI * 2) / 10;
    else if (snap) {
      camera.alpha = targetAlpha;
      snap = false;
    } else {
      let d = targetAlpha - camera.alpha;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      camera.alpha += d * Math.min(1, dt * 6);
    }
    for (const it of instances) {
      if (it.jelly) it.body.getWorldMatrix().invertToRef(it.jelly.invWorld);
    }
    scene.render();
    perf.update(dt);
    if (bench && bench.rec.record(rawDt, instr.drawCallsCounter.current)) {
      const r = bench.rec.summary();
      const done = bench;
      bench = null;
      benchBtn.classList.remove("on");
      benchBtn.textContent = "⏱ 效能測試（10 秒）";
      benchEl.hidden = false;
      const st = perf.stats();
      const shown = instances.filter((i) => i.root.isEnabled()).length;
      benchEl.innerHTML =
        `<b>${label} 效能測試（本機 WebGL 實測）</b><br>${file}・${shown} 隻・畫質 ${st.quality}・${st.pixelRatio}x・${r.seconds} 秒<br>` +
        `平均 ${r.avgFps.toFixed(1)} FPS・最慢 1% ${r.low1Fps.toFixed(1)} FPS・最低 ${r.minFps.toFixed(1)} FPS<br>` +
        `Draw Calls 平均 ${r.avgDrawCalls.toFixed(0)}（最高 ${r.maxDrawCalls}）・畫面物件 ${st.activeMeshes}<br><small>點此關閉</small>`;
      benchEl.onclick = () => (benchEl.hidden = true);
      done.resolve(r);
    }
    uiTimer += dt;
    if (uiTimer > 0.25) {
      uiTimer = 0;
      fpsEl.textContent = `${Math.round(engine.getFps())} FPS`;
    }
  });
  window.addEventListener("resize", () => engine.resize());

  const info = (): BoboV3Info => {
    const it = instances[0]!;
    const parts = [it.body, it.eyes, it.mouth, it.blush, it.stars];
    const meshes = parts.map((m) => ({ name: m.name, triangles: (m.getTotalIndices() || 0) / 3, vertices: m.getTotalVertices() }));
    return { quality: quality.level, meshes, trianglesTotal: meshes.reduce((a, b) => a + b.triangles, 0), materials: 5 };
  };

  window.__bobo3 = {
    ready: true,
    setView: (v) => setView(v, true),
    setExpression,
    setCount,
    setClose: (on) => {
      camera.radius = on ? 1.45 : 2.6;
      camera.target.y = on ? 0.36 : 0.5;
    },
    info,
    perf: () => {
      const j = instances[0]?.jelly;
      const star = isStarJelly(j) ? { outer: j.starOuter, inner: j.starInner, centerY: j.starCenter.y } : null;
      return {
        ...perf.stats(),
        jelly: !!j?.jellyEnabled,
        variant,
        file,
        bellyStar: star,
        bellyStarVersion: bellyStar?.version ?? null,
        shadowMap: !!shadows,
        glowLayer: !!render.glow,
      };
    },
    benchmark: runBenchmark,
    costAnalysis: runCostAnalysis,
    eyeUV0: () => {
      const uv = instances[0]!.eyes.getVerticesData(VertexBuffer.UVKind)!;
      return [uv[0]!, uv[1]!];
    },
  };
}

/** V3 材質：身體（單層果凍＋外掛）、眼睛（透明裁切）、嘴／腮紅（透明混合）、星星（自發光） */
function createMaterials(scene: Scene, gltfMats: PBRMaterial[], useJelly: boolean) {
  const tex = (name: string): BaseTexture | null => gltfMats.find((m) => m.name === name)?.albedoTexture ?? null;
  const eyeTex = tex("Bobo_Eyes");
  const faceTex = tex("Bobo_Face");
  if (eyeTex instanceof Texture) eyeTex.anisotropicFilteringLevel = 4;

  const eyes = new StandardMaterial("BoboV3_Eyes", scene);
  eyes.diffuseTexture = eyeTex;
  if (eyes.diffuseTexture) eyes.diffuseTexture.hasAlpha = true;
  eyes.useAlphaFromDiffuseTexture = true;
  eyes.transparencyMode = 1; // ALPHATEST（只裁切、不混合）：不需排序、不造成過度繪製
  eyes.alphaCutOff = 0.45;
  // V3.1：眼睛接近不受光（顏色忠於貼圖），角膜弧面保留一點清亮反光
  eyes.emissiveColor = new Color3(0.78, 0.78, 0.82);
  eyes.diffuseColor = new Color3(0.35, 0.35, 0.38);
  eyes.specularColor = new Color3(1, 1, 1);
  eyes.specularPower = 140;

  const decal = (name: string): StandardMaterial => {
    const m = new StandardMaterial(name, scene);
    m.diffuseTexture = faceTex;
    if (m.diffuseTexture) m.diffuseTexture.hasAlpha = true;
    m.useAlphaFromDiffuseTexture = true;
    m.disableLighting = true;
    m.emissiveColor = new Color3(0.95, 0.95, 0.95);
    m.backFaceCulling = true;
    m.zOffset = -2;
    return m;
  };
  const mouth = decal("BoboV3_Mouth");
  const blush = decal("BoboV3_Blush");

  const stars = new StandardMaterial("BoboV3_Stars", scene);
  stars.disableLighting = true;
  stars.emissiveColor = new Color3(0.9, 0.62, 0.1); // × 頂點色：壓低藍色 → 飽和的金黃
  stars.backFaceCulling = false; // 腹部星星的面向與身體相反時也要看得到（正面原本被剔除）

  const body = (_i: number): { material: StandardMaterial; jelly: JellyV3Plugin | null } => {
    const m = new StandardMaterial(`BoboV3_Body_${_i}`, scene);
    // 頂點色（底部深藍紫 → 上方淡藍）× 偏藍紫的漫射；自發光補一點藍紫，避免受光後發白
    // V3.1：降低漫射與一般高光（減少塑膠感與發白），顏色主要來自頂點色＋果凍外掛
    m.diffuseColor = new Color3(0.45, 0.5, 0.95);
    m.emissiveColor = new Color3(0.12, 0.08, 0.42);
    m.specularColor = new Color3(0.06, 0.06, 0.08);
    m.specularPower = 64;
    m.alpha = 0.66;
    m.useSpecularOverAlpha = false;
    m.backFaceCulling = true;
    let jelly: JellyV3Plugin | null = null;
    if (useJelly) {
      jelly = new JellyV3Plugin(m);
      jelly.height = 1; // 物件座標本身就以身高為 1（Blender 端尺寸）
      const j = jelly;
      m.onError = () => {
        if (j.jellyEnabled) {
          console.warn("[bobo3] jelly shader failed, fallback");
          j.jellyEnabled = false;
        }
      };
    }
    return { material: m, jelly };
  };
  return { eyes, mouth, blush, stars, body };
}

/**
 * V3.1 材質：身體（JellyV31Plugin，含畫在果凍內的腹部星星）、眼睛（透明混合、邊緣平滑）、
 * 嘴／腮紅（與 V3 相同）、頭頂星星（清楚的金黃五角星，柔和不過曝）。
 * 低畫質仍使用外掛（關閉內部星雲），否則會看不到腹部星星。
 */
function createMaterialsV31(scene: Scene, gltfMats: PBRMaterial[], fullJelly: boolean, jellyVersion: "v31" | "v32" | "v34" | "v35" = "v31") {
  const tex = (name: string): BaseTexture | null => gltfMats.find((m) => m.name === name)?.albedoTexture ?? null;
  const eyeTex = tex("Bobo_Eyes");
  const faceTex = tex("Bobo_Face");
  if (eyeTex instanceof Texture) eyeTex.anisotropicFilteringLevel = 4;

  const eyes = new StandardMaterial("BoboV31_Eyes", scene);
  eyes.diffuseTexture = eyeTex;
  if (eyes.diffuseTexture) eyes.diffuseTexture.hasAlpha = true;
  eyes.useAlphaFromDiffuseTexture = true;
  eyes.transparencyMode = 2; // ALPHABLEND：邊緣柔和（V3 的透明裁切在 iPhone 上有鋸齒）
  eyes.emissiveColor = new Color3(0.8, 0.8, 0.84);
  eyes.diffuseColor = new Color3(0.3, 0.3, 0.33);
  eyes.specularColor = new Color3(1, 1, 1);
  eyes.specularPower = 160;
  eyes.zOffset = -1;

  const decal = (name: string): StandardMaterial => {
    const m = new StandardMaterial(name, scene);
    m.diffuseTexture = faceTex;
    if (m.diffuseTexture) m.diffuseTexture.hasAlpha = true;
    m.useAlphaFromDiffuseTexture = true;
    m.disableLighting = true;
    m.emissiveColor = new Color3(0.95, 0.95, 0.95);
    m.backFaceCulling = true;
    m.zOffset = -2;
    return m;
  };
  const mouth = decal("BoboV31_Mouth");
  const blush = decal("BoboV31_Blush");

  const stars = new StandardMaterial("BoboV31_Stars", scene);
  stars.disableLighting = true;
  // × 頂點色（中央奶油黃 → 邊緣金黃）：保持在色調映射肩部以下，不會過曝成白色或橘粉色
  stars.emissiveColor = new Color3(1.0, 0.96, 0.62);
  // V3.5：頭頂星星偏檸檬黃（模型頂點色邊緣是暖金，提高綠色讓整體不偏橘）；V3.4 以前不變
  if (jellyVersion === "v35") stars.emissiveColor = new Color3(1.0, 1.1, 0.8);
  stars.backFaceCulling = false;

  const noise =
    jellyVersion === "v35"
      ? createJellyNoiseTextureV35(scene)
      : jellyVersion === "v34"
      ? createJellyNoiseTextureV34(scene)
      : jellyVersion === "v32"
        ? createJellyNoiseTextureV32(scene)
        : createJellyNoiseTexture(scene);
  const body = (i: number): { material: StandardMaterial; jelly: JellyV31Plugin | JellyV32Plugin | JellyV34Plugin | JellyV35Plugin | null } => {
    const m = new StandardMaterial(`BoboV31_Body_${i}`, scene);
    m.diffuseColor = new Color3(0.42, 0.48, 0.95);
    m.emissiveColor = new Color3(0.1, 0.07, 0.4);
    m.specularColor = new Color3(0.04, 0.04, 0.05);
    m.specularPower = 64;
    m.alpha = 0.64;
    m.useSpecularOverAlpha = false;
    m.backFaceCulling = true;
    const jelly =
      jellyVersion === "v35"
        ? new JellyV35Plugin(m, noise)
        : jellyVersion === "v34"
        ? new JellyV34Plugin(m, noise)
        : jellyVersion === "v32"
          ? new JellyV32Plugin(m, noise)
          : new JellyV31Plugin(m, noise);
    jelly.height = 1;
    jelly.nebula = fullJelly ? 1 : 0;
    m.onError = () => {
      if (jelly.jellyEnabled) {
        console.warn("[bobo3] jelly V3.1 shader failed, fallback");
        jelly.jellyEnabled = false;
      }
    };
    return { material: m, jelly };
  };
  return { eyes, mouth, blush, stars, body };
}
