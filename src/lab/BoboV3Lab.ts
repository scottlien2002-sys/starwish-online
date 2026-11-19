import "@babylonjs/loaders/glTF";
import {
  type AbstractMesh,
  ArcRotateCamera,
  Color4,
  type BaseTexture,
  type Material,
  Color3,
  Constants,
  DynamicTexture,
  Matrix,
  Quaternion,
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
import { createJellyNoiseTextureV36, JellyV36Plugin } from "../monsters/star-dew-bobo-v36/JellyV36Plugin.ts";
import { BOBO_V36_SPEC } from "../monsters/star-dew-bobo-v36/spec.ts";
import { createGlassMatcapV37, createJellyNoiseTextureV37, JellyV37Plugin } from "../monsters/star-dew-bobo-v37/JellyV37Plugin.ts";
import { BOBO_V37_SPEC } from "../monsters/star-dew-bobo-v37/spec.ts";
import { createGlassMatcapV38, createJellyNoiseTextureV38, JellyV38Plugin } from "../monsters/star-dew-bobo-v38/JellyV38Plugin.ts";
import { BOBO_V38_SPEC } from "../monsters/star-dew-bobo-v38/spec.ts";
import { BOBO_V38R_SPEC } from "../monsters/star-dew-bobo-v38r/spec.ts";
import {
  antennaWeight,
  BlinkTimer,
  BOBO_ANIMS,
  BOBO_ANIMS_ALL,
  BoboAnimPlayer,
  type BoboAnimName,
  type BoboPose,
  HURT_FACE_UNTIL,
  DEATH_EYES_CLOSE_AT,
  deathFx,
  DUST_COLORS,
  dustCount,
  dustParticle,
  poseAt,
  poseScale,
  REST_POSE,
} from "../monsters/star-dew-bobo-v38r/animation.ts";
import { createGlassMatcapV38R, createJellyNoiseTextureV38R, JellyV38RPlugin } from "../monsters/star-dew-bobo-v38r/JellyV38RPlugin.ts";
import { ExpressionAtlasController, loadMonsterAsset, type MonsterAssetHandle } from "../monsters/babylon/loadMonsterAsset.ts";
import { formatCostRows, runCostSteps, type CostStep } from "../render/costAnalysis.ts";

/** v3 = 第一版（材質與模型保持不變，作為對照基準）；v31 = V3.1 美術精修 */
export type BoboLabVariant = "v3" | "v31" | "v32" | "v33" | "v34" | "v35" | "v36" | "v37" | "v38" | "v38r";
type Jelly = JellyV3Plugin | JellyV31Plugin | JellyV32Plugin | JellyV34Plugin | JellyV35Plugin | JellyV36Plugin | JellyV37Plugin | JellyV38Plugin | JellyV38RPlugin;
type StarJelly = JellyV32Plugin | JellyV34Plugin | JellyV35Plugin | JellyV36Plugin | JellyV37Plugin | JellyV38Plugin | JellyV38RPlugin;
const isStarJelly = (j: unknown): j is StarJelly =>
  j instanceof JellyV32Plugin ||
  j instanceof JellyV34Plugin ||
  j instanceof JellyV35Plugin ||
  j instanceof JellyV36Plugin ||
  j instanceof JellyV37Plugin ||
  j instanceof JellyV38Plugin ||
  j instanceof JellyV38RPlugin;
const VARIANT_LAB: Record<BoboLabVariant, string> = {
  v3: "bobo3",
  v31: "bobo31",
  v32: "bobo32",
  v33: "bobo33",
  v34: "bobo34",
  v35: "bobo35",
  v36: "bobo36",
  v37: "bobo37",
  v38: "bobo38",
  v38r: "bobo38r",
};
const VARIANT_LABEL: Record<BoboLabVariant, string> = {
  v3: "V3",
  v31: "V3.1",
  v32: "V3.2",
  v33: "V3.3",
  v34: "V3.4",
  v35: "V3.5",
  v36: "V3.6",
  v37: "V3.7",
  v38: "V3.8",
  v38r: "V3.8R",
};
// 頁面切換按鈕：V3.8 ↔ V3.8R（目前驗收的兩版）；更早的版本仍可用網址 ?lab= 開啟
const VARIANT_NEXT: Record<BoboLabVariant, BoboLabVariant> = {
  v3: "v31",
  v31: "v32",
  v32: "v33",
  v33: "v34",
  v34: "v35",
  v35: "v36",
  v36: "v37",
  v37: "v38",
  v38: "v38r",
  v38r: "v38",
};

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
type View = "front" | "side" | "back" | "q45" | "top";
/** 鏡頭水平角：模型面向 +Z。側面依設定圖從角色左側看（臉朝畫面左）；45 度角 = 正面與左側之間 */
const VIEW_ALPHA: Record<View, number> = { front: Math.PI / 2, side: Math.PI, back: -Math.PI / 2, q45: (Math.PI * 3) / 4, top: Math.PI / 2 };
/** V3.8R：45 度角略俯視、俯視幾乎垂直往下（其他視角沿用原本的仰角） */
const VIEW_BETA: Partial<Record<View, number>> = { q45: 1.2, top: 0.04 };
const VIEW_LABEL: Record<View, string> = { front: "正面", side: "側面", back: "背面", q45: "45°", top: "俯視" };

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
  /** 設定圖對照模式（平視、深藍灰背景）；只用於美術比對 */
  setRefMode(on: boolean): void;
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
    refMode: boolean;
    /** V3.8R 灰模模式（無材質、無臉部） */
    grey: boolean;
    faceVisible: boolean;
    /** V3.8R 第四階段：目前播放的動畫 */
    anim: string;
    /** 測試頁有 45 度角與俯視（V3.8R） */
    views5: boolean;
  };
  /** V3.8R 第四階段：播放動畫（"none" 靜止、"idle" 待機、"move" 移動、"attack" 攻擊（播一次後回待機）） */
  setAnim(name: string): void;
  /** V3.8R：把動畫時間設定到指定秒數並停住（截圖用；之後呼叫 setAnim 恢復播放） */
  holdAnimAt(seconds: number): void;
  /** V3.8R：第一隻目前的動畫狀態與位置（測試用） */
  animState(): {
    anim: string;
    pending: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    lift: number;
    sy: number;
    sfwd: number;
    fwd: number;
    bx: number;
    bz: number;
    angry: boolean;
    /** 目前顯示的表情 */
    face: string;
    rx: number;
    rz: number;
    scale: number[];
  };
  /** V3.8R：死亡（index 省略 = 全部；死亡中或已死亡不會重播） */
  death(index?: number): void;
  /** V3.8R：重生（完整恢復原始外觀與待機；index 省略 = 全部） */
  respawn(index?: number): void;
  /** V3.8R：像遊戲一樣對某一隻下指令（不會讓死亡的角色復活；測試用） */
  command(name: string, index?: number): void;
  animStateOf(index: number): { anim: string; visibility: number; x: number; z: number };
  /** V3.8R：場景資源數量（檢查反覆死亡不累積） */
  resourceCounts(): { materials: number; textures: number; meshes: number; sprites: number; dust: number; starMatClones: number };
  /** V3.8R：換成靜止姿勢但不重設位置與朝向（外觀一致性檢查用） */
  freezeRest(): void;
  /** V3.8R：受傷（一次性；lethal = 生命值歸零 → 播完停在 down 等死亡動畫） */
  hurt(lethal?: boolean): void;
  /** V3.8R：第一隻目前的動畫姿勢（測試用） */
  animPose(): { sy: number; sxz: number; roll: number; swayX: number; flap: number; starX: number; scaleY: number };
  /** V3.8R：切換第二階段灰模（只有 V3.8R 有作用） */
  setGrey(on: boolean): void;
  /** 第一隻身體的外框（世界座標，小數 4 位）；用來確認切換表情不改變外型 */
  bodyExtent(): number[];
  costAnalysis(seconds?: number): Promise<{ name: string; avg: number; low1: number; draws: number }[]>;
  releaseModels(): { before: number; after: number } | null;
  benchmark(seconds?: number): Promise<BenchmarkSummary>;
}

declare global {
  interface Window {
    __bobo3?: BoboV3DebugApi;
    /** 共用怪物測試頁介面（截圖、效能工具使用） */
    __monsterLab?: BoboV3DebugApi;
  }
}

interface BoboV3Instance {
  root: TransformNode;
  /** V3.8R 第四階段：動畫相位（同場多隻不同步）、眨眼計時、頭頂星星靜止位置 */
  animPhase: number;
  blink: BlinkTimer;
  blinkClosed: boolean;
  /** 動畫播放器（每隻一個；切換時淡入、停止移動會先跳完這一跳） */
  player: BoboAnimPlayer;
  /** 出生位置與朝向（移動預覽沿 X 軸來回彈跳；停止後轉回原本朝向） */
  home: { x: number; z: number; yaw: number };
  yaw: number;
  moveSign: 1 | -1;
  pose: BoboPose;
  /** 移動累積的位置（攻擊的往前彈出是暫時位移，加在這個位置上、不累積） */
  base: { x: number; z: number };
  /** 動畫暫時換的表情（攻擊 → 生氣、受傷 → 受傷）；結束後換回動畫前的表情 */
  faceOverride: V3Expression | null;
  /** 死亡暫時效果：整隻透明度（1 = 正常）、星星變暗用的暫時材質、星塵粒子 */
  vis: number;
  starBright: number;
  starMat: StandardMaterial | null;
  dust: Sprite[];
  body: Mesh;
  /** 原本的身體材質（V3.8R 灰模切換回來時使用） */
  bodyMat: Material;
  eyes: Mesh;
  mouth: Mesh;
  blush: Mesh;
  stars: Mesh;
  jelly: Jelly | null;
  eyeUV: Float32Array;
  mouthUV: Float32Array;
  /** V3.6 起：共用表情控制器 */
  expr: ExpressionAtlasController | null;
}

export async function startBoboV3Lab(canvas: HTMLCanvasElement, uiRoot: HTMLElement, variant: BoboLabVariant = "v3"): Promise<void> {
  // v31 = 「V3.1 或更新」的模型與材質流程；V3.2 第一步沿用 V3.1 模型檔（不修改它），只換果凍材質
  const v31 = variant !== "v3";
  /**
   * V3.5 繪製方式（只有 V3.5，其他版本維持原樣以便對照）：
   * - 不用陰影貼圖（啵啵不再畫進陰影貼圖、地面與果凍不做柔和陰影取樣），改用設定圖那樣的柔和圓形接觸陰影（3 隻共 1 次繪製）
   * - 不用 GlowLayer（省掉發光貼圖與兩次全畫面模糊），頭頂星星改用光暈貼片（3 隻共 1 次繪製）；腹部星星光暈本來就在果凍著色器裡
   */
  // V3.5 的繪製方式（接觸陰影＋光暈貼片，不用陰影貼圖與 GlowLayer）V3.6 沿用
  const v35 = variant === "v35" || variant === "v36" || variant === "v37" || variant === "v38" || variant === "v38r";
  /**
   * V3.8R：第三階段（材質＋臉部＋眉毛）為預設；第二階段的單色灰模用 &grey=1 或 setGrey(true) 切換
   * （灰模不顯示顏色、材質、星雲、反射、臉部、腹部星星與光暈）
   */
  const v38r = variant === "v38r";
  let grey = v38r && new URLSearchParams(location.search).get("grey") === "1";
  /** V3.6 起改用共用模組：loadMonsterAsset（載入／釋放）、ExpressionAtlasController（表情） */
  const assetSpec = variant === "v38r" ? BOBO_V38R_SPEC : variant === "v38" ? BOBO_V38_SPEC : variant === "v37" ? BOBO_V37_SPEC : variant === "v36" ? BOBO_V36_SPEC : null;
  const v36 = !!assetSpec;
  const label = VARIANT_LABEL[variant];
  const quality = pickQuality();
  const engine = createEngine(canvas, quality);
  const scene = new Scene(engine);
  const skyDome = createSkyDome(scene);
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
  camera.lowerBetaLimit = variant === "v38r" ? 0.02 : 0.35; // V3.8R 灰模要能俯視
  camera.upperBetaLimit = 1.55;
  camera.panningSensibility = 0;
  camera.minZ = 0.05;
  const render = setupRendering(scene, camera, v35 ? { ...quality, bloom: { ...quality.bloom, enabled: false } } : quality);

  // ---------- 載入 GLB（依畫質選 LOD） ----------
  const base = import.meta.env.BASE_URL;
  // V3.3 載入自己的模型檔（含 V3.3 腹部星星定義）；V3.1／V3.2 共用 V3.1 模型；V3 用 V3 模型
  let assetHandle: MonsterAssetHandle | null = null;
  if (assetSpec) assetHandle = await loadMonsterAsset(scene, `${base}models/`, assetSpec, quality.level);
  const file = assetHandle
    ? assetHandle.file
    : variant === "v35"
      ? `bobo_v35_${quality.level}.glb`
      : variant === "v34"
      ? `bobo_v34_${quality.level}.glb`
      : variant === "v33"
        ? `bobo_v33_${quality.level}.glb`
        : v31
          ? `bobo_v31_${quality.level}.glb`
          : `bobo_v3_${quality.level}.glb`;
  const container = assetHandle ? assetHandle.container : await SceneLoader.LoadAssetContainerAsync(`${base}models/`, file, scene);
  const starFromModel = variant === "v33" || variant === "v34" || variant === "v35" || v36;
  const bellyStar = assetHandle
    ? ((assetHandle.extras as { bellyStar?: BellyStarDef }).bellyStar ?? null)
    : starFromModel
      ? readBellyStar(container)
      : null;
  if (starFromModel && !bellyStar) throw new Error(`${file} 缺少腹部星星資料（extras.bellyStar）`);

  // 共用材質（三隻共用；每隻的表情以各自的 UV 緩衝切換）
  const mats = v31
    ? createMaterialsV31(
        scene,
        container.materials as PBRMaterial[],
        quality.level !== "low",
        variant === "v38r" ? "v38r" : variant === "v38" ? "v38" : variant === "v37" ? "v37" : variant === "v36" ? "v36" : variant === "v35" ? "v35" : variant === "v34" ? "v34" : variant === "v32" || variant === "v33" ? "v32" : "v31",
      )
    : createMaterials(scene, container.materials as PBRMaterial[], quality.level !== "low");
  const instances: BoboV3Instance[] = [];
  let greyMat: StandardMaterial | null = null;
  if (v38r) {
    greyMat = new StandardMaterial("BoboV38R_Grey", scene);
    greyMat.diffuseColor = new Color3(0.74, 0.74, 0.76);
    greyMat.specularColor = new Color3(0.12, 0.12, 0.12);
    greyMat.specularPower = 40;
    greyMat.ambientColor = new Color3(0.2, 0.2, 0.22);
  }
  /** 灰模：身體與頭頂星星同一個不透明灰色材質、不用頂點色（否則會被染成藍色／金色）；臉部不顯示 */
  const applyGrey = (it: BoboV3Instance, on: boolean): void => {
    if (!greyMat) return;
    it.body.material = on ? greyMat : it.bodyMat;
    it.body.alphaIndex = on ? 0 : 1;
    it.stars.material = on ? greyMat : mats.stars;
    it.body.useVertexColors = !on;
    it.stars.useVertexColors = !on;
    for (const m of [it.eyes, it.mouth, it.blush]) m.setEnabled(!on);
  };
  // V3.8R 第四階段：目前要求的動畫（預設待機；&anim=none 為靜止、&anim=move 為移動）
  let anim: BoboAnimName = "none";
  if (v38r) {
    const a = new URLSearchParams(location.search).get("anim") as BoboAnimName | null;
    anim = a && BOBO_ANIMS_ALL.includes(a) ? a : "idle";
  }
  const spawn = (x: number, z: number, yaw: number): BoboV3Instance => {
    const assetInst = assetHandle ? assetHandle.instantiate(`bobo3_${instances.length}`) : null;
    let root: TransformNode;
    if (assetInst) root = assetInst.root;
    else {
      const inst = container.instantiateModelsToScene((n) => `${n}_${instances.length}`, false, { doNotInstantiate: true });
      root = new TransformNode(`bobo3_${instances.length}`, scene);
      for (const n of inst.rootNodes) n.parent = root;
    }
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
    // V3.6：共用表情控制器（改 UV）；V3.5 以前保持原本寫法
    const expr = assetInst && assetSpec?.expressions ? new ExpressionAtlasController(assetSpec.expressions, assetInst) : null;
    let eyeUV = new Float32Array(0);
    let mouthUV = new Float32Array(0);
    if (!expr) {
      // glTF 載入的 UV 緩衝不可更新：各自複製一份並設為可更新，表情才能用改 UV 的方式切換
      eyes.makeGeometryUnique();
      mouth.makeGeometryUnique();
      eyeUV = Float32Array.from(eyes.getVerticesData(VertexBuffer.UVKind) ?? []);
      mouthUV = Float32Array.from(mouth.getVerticesData(VertexBuffer.UVKind) ?? []);
      eyes.setVerticesData(VertexBuffer.UVKind, Float32Array.from(eyeUV), true);
      mouth.setVerticesData(VertexBuffer.UVKind, Float32Array.from(mouthUV), true);
    }
    const n = instances.length;
    const it: BoboV3Instance = {
      root, body, eyes, mouth, blush, stars, jelly: bodyMat.jelly, eyeUV, mouthUV, expr, bodyMat: bodyMat.material,
      animPhase: [0, 0.37, 0.71][n % 3]!,
      blink: new BlinkTimer(17 + n * 101),
      blinkClosed: false,
      player: new BoboAnimPlayer("none", [0, 0.37, 0.71][n % 3]!),
      home: { x, z, yaw },
      yaw,
      moveSign: n === 1 ? -1 : 1,
      pose: REST_POSE,
      base: { x, z },
      faceOverride: null,
      vis: 1,
      starBright: 1,
      starMat: null,
      dust: [],
    };
    if (v38r) {
      if (anim === "hurt") it.player.hurt();
      else if (anim === "death") it.player.death();
      else it.player.request(anim);
    }
    applyGrey(it, grey);
    instances.push(it);
    return it;
  };
  spawn(0, 0, 0);
  const setGrey = (on: boolean): void => {
    if (!v38r) return;
    grey = on;
    for (const it of instances) applyGrey(it, on);
    updateFx();
  };

  // ---------- V3.5：柔和接觸陰影＋頭頂星星光暈（各 1 次繪製，取代陰影貼圖與 GlowLayer） ----------
  let updateFxFrame: (() => void) | null = null;
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
        sprites[k]!.isVisible = it.root.isEnabled() && !grey;
      });
    };
    updateFx();
    if (v38r) {
      // V3.8R 動畫：每幀更新接地陰影（跟著位置、離地時縮小）與頭頂星星光暈（跟著星星）
      const fxBuf = new Float32Array(16 * 3);
      const tmpM = new Matrix();
      const tmpV = new Vector3();
      updateFxFrame = (): void => {
        const shown = instances.filter((i) => i.root.isEnabled());
        shown.forEach((it, k) => {
          const q = it.root.position;
          // 離地時縮小；死亡淡出時跟著消失
          const sc = (1 - Math.min(0.45, q.y * 2.6)) * it.vis;
          Matrix.ComposeToRef(new Vector3(sc, 1, sc), Quaternion.Identity(), new Vector3(q.x, 0.004, q.z), tmpM);
          tmpM.copyToArray(fxBuf, k * 16);
        });
        blob.thinInstanceSetBuffer("matrix", fxBuf.subarray(0, 16 * Math.max(1, shown.length)), 16, false);
        blob.thinInstanceCount = shown.length;
        instances.forEach((it, k) => {
          const sp = sprites[k];
          if (!sp) return;
          it.stars.computeWorldMatrix(true);
          Vector3.TransformCoordinatesToRef(it.stars.getBoundingInfo().boundingSphere.center, it.stars.getWorldMatrix(), tmpV);
          sp.position.copyFrom(tmpV);
          // 死亡：星星光暈跟著星星亮度與整體透明度變暗（加法混合，alpha 直接決定亮度）
          sp.color.a = it.starBright * it.vis;
        });
      };
    }
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
      if (it.expr) {
        it.expr.set(i);
        continue;
      }
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

  // ---------- 設定圖對照模式（只用於美術比對；效能測試一律用一般遊戲鏡頭） ----------
  // 設定圖：平視、略仰視，深藍灰面板背景，腳下深色柔和陰影
  let refMode = false;
  let currentView: View = "front";
  const clear0 = scene.clearColor.clone();
  const fogMode0 = scene.fogMode;
  const setRefMode = (on: boolean): void => {
    refMode = on;
    skyDome.setEnabled(!on);
    ground.setEnabled(!on);
    // 色調映射與曝光會把背景調亮，所以設定得比設定圖面板（約 #343a5a）更深
    scene.clearColor = on ? new Color4(0.075, 0.085, 0.16, 1) : clear0;
    scene.fogMode = on ? 0 : fogMode0;
    camera.beta = VIEW_BETA[currentView] ?? (on ? 1.5 : 1.3);
    camera.target.y = on ? 0.42 : 0.5;
    camera.radius = on ? 2.7 : instances.filter((i) => i.root.isEnabled()).length === 3 ? 4.6 : 2.6;
    for (const b of uiRoot.querySelectorAll<HTMLButtonElement>(".v3-ref")) b.classList.toggle("active", on);
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
      ${(v38r ? (["front", "side", "back", "q45", "top"] as const) : (["front", "side", "back"] as const)).map((v) => `<button class="lab-view-btn" data-view="${v}" data-layout="btn-view-${v}">${VIEW_LABEL[v]}</button>`).join("")}
      <button class="lab-view-btn" data-count="1" data-layout="btn-count-1">1 隻</button>
      <button class="lab-view-btn" data-count="3" data-layout="btn-count-3">3 隻</button>
      <button class="lab-view-btn v3-switch" data-layout="btn-switch">看 ${VARIANT_LABEL[VARIANT_NEXT[variant]]}</button>
      <button class="lab-view-btn v3-ref" data-layout="btn-ref">設定圖對照</button>
    </div>
    <button class="v3-bench lab-bench" data-layout="btn-bench">⏱ 效能測試（10 秒）</button>
    ${
      v38r
        ? `<div class="v3-row"><button class="lab-view-btn v3-cost" data-layout="btn-cost">🔍 成本分析（約 35 秒）</button><button class="lab-view-btn v3-anim" data-layout="btn-anim">🫧 待機</button><button class="lab-view-btn v3-hurt" data-layout="btn-hurt">💢 受傷</button><button class="lab-view-btn v3-death" data-layout="btn-death">💫 死亡</button></div>`
        : `<button class="lab-view-btn v3-cost" data-layout="btn-cost">🔍 成本分析（約 35 秒）</button>`
    }
    <div class="lab-bench-result v3-bench-result" hidden></div>
    </div>
    <div class="lab-fps" data-layout="lab-fps">-- FPS</div>
    <div class="lab-panel v3-expr">
      ${V3_EXPRESSIONS.map((e) => `<button class="lab-btn" data-expr="${e}" data-layout="btn-expr-${e}">${EXPRESSION_LABEL[e]}</button>`).join("")}
    </div>`;
  const viewButtons = [...uiRoot.querySelectorAll<HTMLButtonElement>("[data-view]")];
  const exprButtons = [...uiRoot.querySelectorAll<HTMLButtonElement>("[data-expr]")];
  const countButtons = [...uiRoot.querySelectorAll<HTMLButtonElement>("[data-count]")];
  // V3.8R 第四階段：動畫切換按鈕（點一下輪流：待機 → 靜止 → 待機…；之後加入移動、攻擊等）
  const animBtn = uiRoot.querySelector<HTMLButtonElement>(".v3-anim");
  const ANIM_LABEL: Record<BoboAnimName, string> = { none: "⏸ 靜止", idle: "🫧 待機", move: "🦘 移動", attack: "💥 攻擊", hurt: "💢 受傷中", death: "💫 死亡中", dead: "💫 已死亡" };
  // 死亡：每按一次讓下一隻還活著的角色播一次死亡（3 隻同場時各自獨立）；全部都死了再按 → 全部重生
  uiRoot.querySelector<HTMLButtonElement>(".v3-death")?.addEventListener("click", () => {
    const shown = instances.filter((i) => i.root.isEnabled());
    const alive = shown.find((i) => !i.player.isDead);
    if (alive) alive.player.death();
    else for (const it of shown) respawnInstance(it);
  });
  // 受傷：手動觸發（每按一次受擊一次；受傷中前 0.15 秒再按會被忽略）
  uiRoot.querySelector<HTMLButtonElement>(".v3-hurt")?.addEventListener("click", () => {
    for (const it of instances) if (it.root.isEnabled()) it.player.hurt();
  });
  const fpsEl = uiRoot.querySelector<HTMLDivElement>(".lab-fps")!;
  const benchBtn = uiRoot.querySelector<HTMLButtonElement>(".lab-bench")!;
  const benchEl = uiRoot.querySelector<HTMLDivElement>(".lab-bench-result")!;
  uiRoot.querySelector<HTMLButtonElement>(".v3-ref")!.addEventListener("click", () => setRefMode(!refMode));
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
    currentView = v;
    targetAlpha = VIEW_ALPHA[v];
    const beta = VIEW_BETA[v];
    camera.beta = beta ?? (refMode ? 1.5 : 1.3);
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
      // 效能測試一律用一般遊戲鏡頭與場景（對照模式只用於美術比對）
      if (refMode) setRefMode(false);
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
  // 共用成本分析流程（src/render/costAnalysis.ts）；這裡只定義星露啵啵頁面要測的項目
  const runCostAnalysis = async (seconds = 5): Promise<{ name: string; avg: number; low1: number; draws: number; gain: number }[]> => {
    if (bench) return [];
    const scale0 = engine.getHardwareScalingLevel();
    const samples0 = render.pipeline?.samples ?? 1;
    const jellies = instances.map((i) => i.jelly).filter((j): j is Jelly => !!j);
    const neb0 = jellies.map((j) => ("nebula" in j ? j.nebula : 0));
    const countNow = (instances.filter((i) => i.root.isEnabled()).length === 3 ? 3 : 1) as 1 | 3;
    const step = (name: string, apply: () => void, restore: () => void): CostStep => ({
      name,
      apply: () => {
        apply();
        updateFx();
      },
      restore: () => {
        restore();
        setCount(countNow);
      },
    });
    const steps: CostStep[] = [
      step("目前設定", () => {}, () => {}),
      step("關閉果凍內部星雲", () => jellies.forEach((j) => "nebula" in j && (j.nebula = 0)), () => jellies.forEach((j, k) => "nebula" in j && (j.nebula = neb0[k]!))),
      step("關閉果凍材質（純透明）", () => jellies.forEach((j) => (j.jellyEnabled = false)), () => jellies.forEach((j) => (j.jellyEnabled = true))),
      step("關閉 MSAA 抗鋸齒", () => render.pipeline && (render.pipeline.samples = 1), () => render.pipeline && (render.pipeline.samples = samples0)),
      step("解析度 1.5x", () => engine.setHardwareScalingLevel(1 / 1.5), () => engine.setHardwareScalingLevel(scale0)),
      step("隱藏啵啵（只剩場景）", () => instances.forEach((i) => i.root.setEnabled(false)), () => {}),
    ];
    costBtn.disabled = true;
    const rows = await runCostSteps(
      steps,
      () => runBenchmark(seconds),
      (name) => (costBtn.textContent = `🔍 測試中：${name}`),
      () => new Promise((r) => window.setTimeout(r, 600)),
    );
    costBtn.disabled = false;
    costBtn.textContent = "🔍 成本分析（約 35 秒）";
    const st = perf.stats();
    benchEl.hidden = false;
    benchEl.innerHTML =
      `<b>${label} 成本分析（本機 WebGL 實測，每項 ${seconds} 秒）</b><br>${file}・${countNow} 隻・畫質 ${st.quality}・${Math.round(10 / scale0) / 10}x<br>` +
      formatCostRows(rows).join("<br>") +
      `<br><small>括號內為與「目前設定」相比的 FPS 變化；越多 → 那一項越吃效能。點此關閉</small>`;
    benchEl.onclick = () => (benchEl.hidden = true);
    return rows;
  };
  costBtn.addEventListener("click", () => void runCostAnalysis(5));
  // 網址參數：?lab=bobo3&count=3&bench=1 → 載入 3 秒後自動測試（不必點按鈕）
  const params = new URLSearchParams(location.search);
  if (params.get("count") === "3") setCount(3);
  if (params.get("ref") === "1") setRefMode(true);
  if (params.get("bench") === "1") window.setTimeout(() => void runBenchmark(10), 3000);

  // ---------- V3.8R 第四階段動畫 ----------
  /** 截圖用：停在固定的動畫時間（不前進、不轉向） */
  let animHold: number | null = null;
  const STAR_Y = 1.19; // 頭頂星星中心高度（身體模型座標）
  const starW = antennaWeight(STAR_Y);
  const PATH_HALF = 0.45;
  // 效能測試用：&repeat=1 → 一次性動畫（攻擊、受傷）播完回待機 0.3 秒後自動再播，10 秒測試期間一直有動作
  const repeatOneShot = v38r && new URLSearchParams(location.search).get("repeat") === "1"; // 移動預覽：在出生點左右各 0.45 公尺之間來回彈跳
  // ---------- 死亡的暫時性效果（只在死亡期間；重生時全部恢復、資源全部釋放） ----------
  let dustMgr: SpriteManager | null = null;
  const dustN = dustCount(quality.level);
  const getDustMgr = (): SpriteManager => {
    if (dustMgr) return dustMgr;
    // 柔和的四芒小星光（白色，用粒子顏色染成淡藍／白／金黃）；整個預覽共用一張、一個 SpriteManager（1 次繪製）
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, "rgba(255,255,255,1)");
    rg.addColorStop(0.18, "rgba(255,255,255,0.75)");
    rg.addColorStop(0.5, "rgba(255,255,255,0.12)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, 64, 64);
    g.globalCompositeOperation = "lighter";
    g.fillStyle = "rgba(255,255,255,0.8)";
    g.beginPath();
    g.moveTo(32, 2); g.quadraticCurveTo(35, 29, 62, 32); g.quadraticCurveTo(35, 35, 32, 62); g.quadraticCurveTo(29, 35, 2, 32); g.quadraticCurveTo(29, 29, 32, 2);
    g.fill();
    dustMgr = new SpriteManager("BoboV38R_StarDust", c.toDataURL("image/png"), 30, { width: 64, height: 64 }, scene);
    dustMgr.blendMode = Constants.ALPHA_ADD;
    dustMgr.disableDepthWrite = true;
    dustMgr.isPickable = false;
    return dustMgr;
  };
  // 預先建立（沒有粒子時不會繪製）：反覆死亡不會一直新增資源
  if (v38r) getDustMgr();
  const setVis = (it: BoboV3Instance, v: number): void => {
    if (it.vis === v) return;
    it.vis = v;
    for (const m of [it.body, it.eyes, it.mouth, it.blush, it.stars]) m.visibility = v;
  };
  const clearDust = (it: BoboV3Instance): void => {
    for (const sp of it.dust) sp.dispose();
    it.dust.length = 0;
  };
  const setStarBright = (it: BoboV3Instance, b: number): void => {
    if (it.starBright === b) return;
    it.starBright = b;
    if (b >= 1) {
      // 恢復共用的星星材質，釋放暫時材質
      if (it.starMat) {
        if (!grey) it.stars.material = mats.stars;
        it.starMat.dispose();
        it.starMat = null;
      }
      return;
    }
    if (grey) return;
    if (!it.starMat) {
      // 只有這一隻死亡時才複製一份星星材質（其他隻不受影響），重生時釋放
      it.starMat = mats.stars.clone(`BoboV38R_StarDim_${instances.indexOf(it)}`) as StandardMaterial;
      it.stars.material = it.starMat;
    }
    // 熄滅時不變成黑色：自發光降到 0，留下淡淡的冷灰藍水晶色（像熄燈的玻璃星），之後跟著整隻淡出
    const base = mats.stars;
    const out = 1 - b;
    it.starMat.emissiveColor.set(
      base.emissiveColor.r * b + 0.3 * out,
      base.emissiveColor.g * b + 0.34 * out,
      base.emissiveColor.b * b + 0.42 * out,
    );
    it.starMat.diffuseColor.set(base.diffuseColor.r * b + 0.4 * out, base.diffuseColor.g * b + 0.45 * out, base.diffuseColor.b * b + 0.55 * out);
    it.starMat.specularColor.copyFrom(base.specularColor).scaleInPlace(0.5 + 0.5 * b);
  };
  const applyDeathFx = (it: BoboV3Instance, fx: ReturnType<typeof deathFx> | null): void => {
    setVis(it, fx ? fx.visibility : 1);
    setStarBright(it, fx ? fx.starBright : 1);
    if (!fx || !fx.dust || grey) {
      if (it.dust.length) clearDust(it);
      return;
    }
    const tt = animHold ?? it.player.time;
    const mgr = getDustMgr();
    while (it.dust.length < dustN) {
      const k = it.dust.length;
      const sp = new Sprite(`BoboV38R_Dust_${instances.indexOf(it)}_${k}`, mgr);
      const c = DUST_COLORS[k % DUST_COLORS.length]!;
      sp.color = new Color4(c[0], c[1], c[2], 0);
      it.dust.push(sp);
    }
    const q = it.root.position;
    it.dust.forEach((sp, k) => {
      const d = dustParticle(k, dustN, tt);
      sp.position.set(q.x + d.x, d.y, q.z + d.z);
      sp.width = sp.height = d.size;
      sp.color.a = d.alpha;
    });
  };
  /** 重生：完整恢復原始外觀與待機（位置、朝向、透明度、星星、表情、粒子全部歸位） */
  const respawnInstance = (it: BoboV3Instance): void => {
    it.player = new BoboAnimPlayer("none", it.animPhase);
    it.player.request(anim === "none" || anim === "death" || anim === "hurt" ? (anim === "none" ? "none" : "idle") : anim);
    it.base.x = it.home.x;
    it.base.z = it.home.z;
    it.yaw = it.home.yaw;
    it.root.position.set(it.home.x, 0, it.home.z);
    clearDust(it);
    setVis(it, 1);
    setStarBright(it, 1);
    it.faceOverride = null;
    it.blinkClosed = false;
    it.expr?.set(V3_EXPRESSIONS.indexOf(expression));
  };

  const applyAnim = (dt: number): void => {
    if (!v38r) return;
    for (const it of instances) {
      // 死亡自動重播（只在預覽測試）：死亡後 0.6 秒重生、待機 0.6 秒後再死亡
      if (repeatOneShot && animHold === null && anim === "death") {
        if (it.player.current === "dead" && it.player.time > 0.6) respawnInstance(it);
        else if (it.player.current === "idle" && it.player.time > 0.6) it.player.death();
      }
      if (repeatOneShot && animHold === null && (anim === "attack" || anim === "hurt") && it.player.current === "idle" && it.player.time > 0.3) {
        if (anim === "hurt") it.player.hurt();
        else it.player.request("attack");
      }
      let p: BoboPose;
      let travel = 0;
      if (animHold !== null) {
        p = poseAt(anim, animHold, it.animPhase);
        it.base.x = it.home.x;
        it.base.z = it.home.z;
        it.yaw = it.home.yaw;
      } else {
        const r = it.player.update(dt);
        p = r.pose;
        travel = r.travel;
        // 朝向：移動時面向前進方向（沿 X 軸來回），停下後轉回原本朝向
        const moving = it.player.current === "move" && it.player.pending === "move";
        // 攻擊、受傷、倒下時不轉身
        const target =
          it.player.current === "attack" || it.player.current === "hurt" || it.player.isDead ? it.yaw : moving || it.player.current === "move" ? (it.moveSign > 0 ? Math.PI / 2 : -Math.PI / 2) : it.home.yaw;
        let d = target - it.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        it.yaw += d * Math.min(1, dt * 7);
        // 前進方向 = 角色目前朝向（轉身還沒轉好時原地彈跳）
        if (Math.abs(d) > 0.35) travel = 0;
        const pos = it.base;
        pos.x += Math.sin(it.yaw) * travel;
        pos.z += Math.cos(it.yaw) * travel;
        if (it.moveSign > 0 && pos.x > it.home.x + PATH_HALF) it.moveSign = -1;
        else if (it.moveSign < 0 && pos.x < it.home.x - PATH_HALF) it.moveSign = 1;
      }
      it.pose = p;
      // 位置 = 累積位置 + 沿朝向的暫時位移（攻擊彈出）＋離地高度
      it.root.position.set(it.base.x + Math.sin(it.yaw) * p.fwd, p.lift, it.base.z + Math.cos(it.yaw) * p.fwd);
      it.root.rotation.y = it.yaw;
      const [sx, sy, sz] = poseScale(p);
      it.root.scaling.set(sx, sy, sz);
      it.root.rotation.z = p.roll;
      it.root.rotation.x = p.pitch;
      if (it.jelly instanceof JellyV38RPlugin) it.jelly.anim.set(p.swayX, p.swayZ, p.flap, 0);
      // 頭頂星星跟著觸角末端移動（真正的 3D 物件）
      it.stars.position.set(p.swayX * starW, 0, p.swayZ * starW);
      // 動畫暫時表情（八種表情之一）：攻擊 → 生氣；受傷 → 受傷（「> <」緊閉雙眼＋委屈眉），結束後換回動畫前的表情
      const cur = animHold !== null ? anim : it.player.current;
      const tt = animHold ?? it.player.time;
      const dying = cur === "death" || cur === "dead";
      const want: V3Expression | null = grey
        ? null
        : cur === "attack"
          ? "angry"
          : cur === "hurt" && tt < HURT_FACE_UNTIL
            ? "hurt"
            : dying
              ? cur === "dead" || tt >= DEATH_EYES_CLOSE_AT
                ? "sleepy" // 既有「昏睡」表情的閉眼（不新增表情）
                : "hurt"
              : null;
      // 死亡的暫時性效果：整隻淡出、頭頂星星變暗、星塵粒子
      applyDeathFx(it, dying ? deathFx(cur === "dead" ? 99 : tt) : null);
      if (want !== it.faceOverride && it.expr) {
        it.faceOverride = want;
        it.blinkClosed = false;
        it.expr.set(V3_EXPRESSIONS.indexOf(want ?? expression));
      }
      // 眨眼：只在待機、表情為「一般／好奇」時；只換眼睛貼圖
      const canBlink = it.player.current === "idle" && animHold === null && !grey && (expression === "normal" || expression === "curious");
      const closed = canBlink && it.blink.update(dt);
      if (closed !== it.blinkClosed && it.expr) {
        it.blinkClosed = closed;
        it.expr.setPart("Eyes", closed ? V3_EXPRESSIONS.indexOf("sleepy") : undefined);
      }
    }
    updateFxFrame?.();
    // 按鈕顯示第一隻目前的動畫（攻擊播完會自動回到待機）
    const shownAnim = instances[0] && animHold === null ? instances[0].player.current : anim;
    if (animBtn && animBtn.dataset.anim !== shownAnim) {
      animBtn.dataset.anim = shownAnim;
      animBtn.textContent = ANIM_LABEL[shownAnim];
    }
  };
  const setAnim = (a: BoboAnimName): void => {
    anim = a;
    animHold = null;
    for (const it of instances) {
      if (a === "death") {
        it.player.death();
        continue;
      }
      // 預覽頁切換其他動畫時，死亡的角色先重生（正式遊戲由重生流程負責）
      if (it.player.isDead) respawnInstance(it);
      if (a === "hurt") {
        it.player.hurt();
        continue;
      }
      it.player.request(a);
      if (a === "none") {
        // 靜止：立刻回到出生位置與原本朝向（方便對照）
        respawnInstance(it);
        it.player = new BoboAnimPlayer("none", it.animPhase);
        it.root.position.set(it.home.x, 0, it.home.z);
        it.base.x = it.home.x;
        it.base.z = it.home.z;
        it.yaw = it.home.yaw;
      }
    }
    if (animBtn) animBtn.textContent = ANIM_LABEL[a];
    if (a === "none") applyAnim(0);
  };

  animBtn?.addEventListener("click", () => {
    const cur = (instances[0]?.player.current ?? anim) as BoboAnimName;
    const i = BOBO_ANIMS.indexOf(cur);
    setAnim(BOBO_ANIMS[(i < 0 ? 0 : i + 1) % BOBO_ANIMS.length]!);
  });
  if (animBtn) animBtn.textContent = ANIM_LABEL[anim];

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
    applyAnim(dt);
    for (const it of instances) {
      // 動畫每幀改根節點縮放／旋轉 → 先更新世界矩陣，果凍內部的星雲才會黏在身體上
      if (v38r) it.body.computeWorldMatrix(true);
      if (it.jelly) it.body.getWorldMatrix().invertToRef(it.jelly.invWorld);
      // 視角矩陣取自鏡頭（scene.getViewMatrix() 在第一次 render 之前是空的）
      if (it.jelly instanceof JellyV37Plugin || it.jelly instanceof JellyV38Plugin || it.jelly instanceof JellyV38RPlugin) it.jelly.view.copyFrom(camera.getViewMatrix());
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

  // 共用名稱 __monsterLab（三視圖截圖、效能測試工具使用）；__bobo3 保留相容
  window.__bobo3 = window.__monsterLab = {
    ready: true,
    setView: (v) => setView(v, true),
    setExpression,
    setCount,
    setRefMode,
    setGrey,
    setAnim: (n) => setAnim(BOBO_ANIMS_ALL.includes(n as BoboAnimName) ? (n as BoboAnimName) : "idle"),
    death: (index) => {
      if (index === undefined) {
        for (const it of instances) if (it.root.isEnabled()) it.player.death();
      } else instances[index]?.player.death();
    },
    respawn: (index) => {
      for (const [k, it] of instances.entries()) if (index === undefined || index === k) respawnInstance(it);
    },
    command: (name, index = 0) => instances[index]?.player.request(name as BoboAnimName),
    animStateOf: (index) => {
      const it = instances[index]!;
      return { anim: it.player.current, visibility: it.body.visibility, x: it.root.position.x, z: it.root.position.z };
    },
    resourceCounts: () => ({
      materials: scene.materials.length,
      textures: scene.textures.length,
      meshes: scene.meshes.length,
      sprites: scene.spriteManagers?.reduce((n, m) => n + m.sprites.length, 0) ?? 0,
      dust: instances.reduce((n, it) => n + it.dust.length, 0),
      starMatClones: instances.filter((it) => it.starMat).length,
    }),
    freezeRest: () => {
      // 一致性檢查用：換成靜止姿勢，但不重設位置與朝向（若動畫留下位移殘留就看得出來）
      for (const it of instances) {
        it.player = new BoboAnimPlayer("none", it.animPhase);
        applyDeathFx(it, null);
      }
      anim = "none";
      animHold = null;
    },
    hurt: (lethal) => {
      for (const it of instances) if (it.root.isEnabled()) it.player.hurt(!!lethal);
    },
    holdAnimAt: (sec) => {
      animHold = sec;
    },
    animPose: () => {
      const it = instances[0]!;
      const p = it.pose;
      return { sy: p.sy, sxz: p.sxz, roll: p.roll, swayX: p.swayX, flap: p.flap, starX: it.stars.position.x, scaleY: it.root.scaling.y };
    },
    animState: () => {
      const it = instances[0]!;
      const q = it.root.position;
      return {
        anim: it.player.current,
        pending: it.player.pending,
        x: q.x,
        y: q.y,
        z: q.z,
        yaw: it.yaw,
        lift: it.pose.lift,
        sy: it.pose.sy,
        sfwd: it.pose.sfwd,
        fwd: it.pose.fwd,
        bx: it.base.x,
        bz: it.base.z,
        angry: it.faceOverride === "angry",
        face: it.faceOverride ?? expression,
        rx: it.root.rotation.x,
        rz: it.root.rotation.z,
        scale: it.root.scaling.asArray(),
      };
    },
    bodyExtent: () => {
      const b = instances[0]!.body;
      b.computeWorldMatrix(true);
      b.refreshBoundingInfo();
      const bb = b.getBoundingInfo().boundingBox;
      return [...bb.minimumWorld.asArray(), ...bb.maximumWorld.asArray()].map((v) => Math.round(v * 1e4) / 1e4);
    },
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
        refMode,
        glowLayer: !!render.glow,
        grey,
        anim: v38r && instances[0] ? instances[0].player.current : anim,
        faceVisible: !!instances[0]?.eyes.isEnabled(),
        views5: v38r,
      };
    },
    benchmark: runBenchmark,
    costAnalysis: runCostAnalysis,
    // V3.6：測試共用載入器的資源釋放（釋放後回傳場景中還剩幾個怪物零件與幾何）
    releaseModels: () => {
      if (!assetHandle) return null;
      const parts = assetHandle.spec.requiredParts;
      const before = scene.meshes.filter((m) => parts.some((p) => m.name.startsWith(p))).length;
      assetHandle.dispose();
      instances.length = 0;
      const after = scene.meshes.filter((m) => parts.some((p) => m.name.startsWith(p))).length;
      return { before, after };
    },
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
function createMaterialsV31(
  scene: Scene,
  gltfMats: PBRMaterial[],
  fullJelly: boolean,
  jellyVersion: "v31" | "v32" | "v34" | "v35" | "v36" | "v37" | "v38" | "v38r" = "v31",
) {
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
  if (jellyVersion === "v38" || jellyVersion === "v38r") {
    // V3.8：飽滿的檸檬金黃水晶星（模型頂點色：中央亮黃 → 邊緣暖金）；較明顯的水晶光澤
    stars.disableLighting = false;
    stars.emissiveColor = new Color3(0.9, 0.9, 0.84);
    stars.diffuseColor = new Color3(0.14, 0.14, 0.12);
    stars.specularColor = new Color3(0.75, 0.75, 0.68);
    stars.specularPower = 28;
    // V3.8R：設定圖的亮檸檬黃（綠色略提高 → 不偏橘），仍在色調映射肩部以下、不過曝
    if (jellyVersion === "v38r") stars.emissiveColor = new Color3(0.98, 1.02, 0.82);
  } else if (jellyVersion === "v36" || jellyVersion === "v37") {
    // V3.6：模型頂點色已改為檸檬金黃（中央亮黃 → 邊緣暖金）；開啟受光只為了柔和的水晶光澤（高光不乘頂點色 → 白色光澤）
    stars.disableLighting = false;
    stars.emissiveColor = new Color3(0.92, 0.92, 0.86);
    stars.diffuseColor = new Color3(0.12, 0.12, 0.1);
    stars.specularColor = new Color3(0.55, 0.55, 0.5);
    stars.specularPower = 36;
  }
  stars.backFaceCulling = false;

  const matcap = jellyVersion === "v38r" ? createGlassMatcapV38R(scene) : jellyVersion === "v38" ? createGlassMatcapV38(scene) : jellyVersion === "v37" ? createGlassMatcapV37(scene) : null;
  const noise =
    jellyVersion === "v38r"
      ? createJellyNoiseTextureV38R(scene)
      : jellyVersion === "v38"
      ? createJellyNoiseTextureV38(scene)
      : jellyVersion === "v37"
      ? createJellyNoiseTextureV37(scene)
      : jellyVersion === "v36"
      ? createJellyNoiseTextureV36(scene)
      : jellyVersion === "v35"
      ? createJellyNoiseTextureV35(scene)
      : jellyVersion === "v34"
      ? createJellyNoiseTextureV34(scene)
      : jellyVersion === "v32"
        ? createJellyNoiseTextureV32(scene)
        : createJellyNoiseTexture(scene);
  const body = (i: number): { material: StandardMaterial; jelly: Exclude<Jelly, JellyV3Plugin> | null } => {
    const m = new StandardMaterial(`BoboV31_Body_${i}`, scene);
    m.diffuseColor = new Color3(0.42, 0.48, 0.95);
    m.emissiveColor = new Color3(0.1, 0.07, 0.4);
    m.specularColor = new Color3(0.04, 0.04, 0.05);
    m.specularPower = 64;
    m.alpha = 0.64;
    m.useSpecularOverAlpha = false;
    m.backFaceCulling = true;
    if (jellyVersion === "v38r") {
      // V3.8R：底色改為清澈天藍（V3.8 以前偏紫）；果凍著色器只保留其中一小部分
      m.diffuseColor = new Color3(0.45, 0.64, 1.0);
      m.emissiveColor = new Color3(0.08, 0.16, 0.42);
    }
    const jelly =
      jellyVersion === "v38r"
        ? new JellyV38RPlugin(m, noise, matcap!)
        : jellyVersion === "v38"
        ? new JellyV38Plugin(m, noise, matcap!)
        : jellyVersion === "v37"
        ? new JellyV37Plugin(m, noise, matcap!)
        : jellyVersion === "v36"
        ? new JellyV36Plugin(m, noise)
        : jellyVersion === "v35"
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
