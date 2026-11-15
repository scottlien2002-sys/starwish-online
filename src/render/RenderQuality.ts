import {
  type Camera,
  Color3,
  Color4,
  CubeTexture,
  DefaultRenderingPipeline,
  type DirectionalLight,
  DynamicTexture,
  Engine,
  GlowLayer,
  ImageProcessingConfiguration,
  type Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
} from "@babylonjs/core";
import {
  type QualityLevel,
  type QualitySettings,
  defaultQuality,
  qualitySettings,
  resolveQuality,
} from "./quality.ts";

const STORAGE_KEY = "starwish.quality";

/** 決定本次使用的畫質（網址 ?quality= > 上次選擇 > 裝置預設） */
export function pickQuality(): QualitySettings {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    /* 私密瀏覽等情況無法存取 */
  }
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const level = resolveQuality(new URLSearchParams(location.search).get("quality"), stored, defaultQuality({ coarsePointer: coarse, deviceMemoryGB: mem }));
  return qualitySettings(level);
}

/** 切換畫質：記住選擇並重新載入（抗鋸齒方式需在建立引擎時決定） */
export function switchQuality(level: QualityLevel): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, level);
  } catch {
    /* ignore */
  }
  const url = new URL(location.href);
  url.searchParams.set("quality", level);
  location.replace(url.toString());
}

export function createEngine(canvas: HTMLCanvasElement, q: QualitySettings): Engine {
  return new Engine(
    canvas,
    q.canvasAntialias,
    { preserveDrawingBuffer: false, stencil: true, powerPreference: "high-performance", premultipliedAlpha: false },
    false,
  );
}

export interface RenderSetup {
  pipeline: DefaultRenderingPipeline | null;
  /** 選擇性發光（Bloom）：只有加入的物件會發光；低畫質為 null */
  glow: GlowLayer | null;
  setExposure(v: number): void;
  setBloomIntensity(v: number): void;
}

/**
 * 套用畫質：色調映射與曝光（全部畫質）、後製管線（高/中）、選擇性 Bloom（高/中）。
 * 抗鋸齒依畫質只開一種。
 */
export function setupRendering(scene: Scene, camera: Camera, q: QualitySettings): RenderSetup {
  const ip = scene.imageProcessingConfiguration;
  ip.toneMappingEnabled = q.toneMapping.enabled;
  // KHR PBR Neutral：保留明亮粉嫩的顏色（ACES 會讓粉彩變暗變灰）；舊版沒有時退回 ACES
  const types = ImageProcessingConfiguration as unknown as Record<string, number>;
  ip.toneMappingType = types.TONEMAPPING_KHR_PBR_NEUTRAL ?? ImageProcessingConfiguration.TONEMAPPING_ACES;
  ip.exposure = q.toneMapping.exposure;
  ip.contrast = q.toneMapping.contrast;

  let pipeline: DefaultRenderingPipeline | null = null;
  if (q.postProcess) {
    pipeline = new DefaultRenderingPipeline("main", true, scene, [camera]);
    pipeline.samples = q.msaaSamples;
    pipeline.fxaaEnabled = q.fxaa;
    pipeline.imageProcessingEnabled = true;
    // 全畫面 Bloom 會讓明亮天空整片發白，因此關閉；發光改用下方的選擇性 GlowLayer
    pipeline.bloomEnabled = false;
  }

  let glow: GlowLayer | null = null;
  if (q.bloom.enabled) {
    glow = new GlowLayer("bloom", scene, { mainTextureRatio: q.bloom.textureRatio, blurKernelSize: q.bloom.kernel });
    glow.intensity = q.bloom.intensity;
  }

  return {
    pipeline,
    glow,
    setExposure(v) {
      ip.exposure = v;
    },
    setBloomIntensity(v) {
      if (glow) glow.intensity = v;
    },
  };
}

/** 依畫質建立陰影：高 = 柔和接觸陰影（PCSS），中/低 = PCF */
export function createShadows(light: DirectionalLight, q: QualitySettings): ShadowGenerator {
  const sg = new ShadowGenerator(q.shadows.mapSize, light);
  if (q.shadows.filter === "contact") {
    sg.useContactHardeningShadow = true;
    sg.contactHardeningLightSizeUVRatio = 0.04;
  } else {
    sg.usePercentageCloserFiltering = true;
  }
  sg.filteringQuality =
    q.shadows.pcfQuality === "high" ? ShadowGenerator.QUALITY_HIGH : q.shadows.pcfQuality === "medium" ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
  sg.bias = 0.002;
  sg.normalBias = 0.01;
  return sg;
}

/** 天空顏色（依「星露啵啵」設定圖：晴朗藍天 → 淡藍地平線 → 微粉霞光） */
export const SKY_COLORS = Object.freeze({
  zenith: "#4ea7ff",
  upper: "#7fc6ff",
  /** 地平線上方（平視鏡頭最常看到的區域）：維持清楚的天空藍，避免色調映射後偏灰 */
  nearHorizon: "#a8dcff",
  /** W2-1：地平線帶一點暖白霞光，和遠山的霧藍紫形成層次 */
  horizon: "#d9efff",
  below: "#f8e8f0",
  /** 與地平線一致，用於霧與清除色 */
  fog: new Color3(0.8, 0.9, 1),
});

/** 3D 漸層天空球（取代原本的 CSS 背景，後製管線需要不透明畫面） */
export function createSkyDome(scene: Scene): Mesh {
  const tex = new DynamicTexture("PH_skyGradient", { width: 4, height: 256 }, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, SKY_COLORS.zenith);
  g.addColorStop(0.3, SKY_COLORS.upper);
  g.addColorStop(0.45, SKY_COLORS.nearHorizon);
  g.addColorStop(0.5, SKY_COLORS.horizon);
  g.addColorStop(0.58, SKY_COLORS.below);
  g.addColorStop(1, SKY_COLORS.below);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  tex.update();
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;

  const mat = new StandardMaterial("PH_skyMat", scene);
  mat.backFaceCulling = false;
  mat.disableLighting = true;
  mat.emissiveTexture = tex;
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.fogEnabled = false;

  const dome = MeshBuilder.CreateSphere("PH_skyDome", { diameter: 600, segments: 16, sideOrientation: 1 }, scene);
  dome.material = mat;
  dome.infiniteDistance = true;
  dome.isPickable = false;
  dome.applyFog = false;
  dome.renderingGroupId = 0;
  scene.clearColor = new Color4(SKY_COLORS.fog.r, SKY_COLORS.fog.g, SKY_COLORS.fog.b, 1);
  return dome;
}

/**
 * 預留：載入 HDR 環境貼圖（.env 預先過濾格式）。
 * 只影響 PBR 材質的環境光與反射；目前專案尚未放入環境貼圖檔，未呼叫。
 */
export function loadEnvironmentMap(scene: Scene, url: string, q: QualitySettings, intensity = 1): boolean {
  if (!q.environmentMap) return false;
  scene.environmentTexture = CubeTexture.CreateFromPrefilteredData(url, scene);
  scene.environmentIntensity = intensity;
  return true;
}
