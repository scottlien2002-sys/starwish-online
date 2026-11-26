import { villageInitialCamera } from "./spawnCamera.ts";
import { Color3, DirectionalLight, type Engine, HemisphericLight, Scene, ShadowGenerator, Vector3 } from "@babylonjs/core";
import { shotCam, shotTargets } from "./shotCam.ts";
import { type Foliage66, addDetail66, addGrass66, applyLighting66, buildFoliage66, upgradeSky66 } from "./villageArt66.ts";
import { ENV_SECTORS } from "./EnvP3.ts";
import { VILLAGE_LOOK, villageProps } from "./villageMaterials.ts";
import { TUNING } from "../../config/tuning.ts";
import { InputState } from "../../input/InputState.ts";
import { VirtualJoystick } from "../../input/VirtualJoystick.ts";
import { CameraTouchControl } from "../../input/CameraTouchControl.ts";
import { KeyboardInput } from "../../input/KeyboardInput.ts";
import { Hud } from "../../ui/Hud.ts";
import { PlayerAvatar } from "../../actors/PlayerAvatar.ts";
import { inputToWorld, turnTowards } from "../../actors/movement.ts";
import { ThirdPersonCamera } from "../../camera/ThirdPersonCamera.ts";
import { SKY_COLORS, createEngine, createShadows, createSkyDome, setupRendering, type RenderSetup } from "../../render/RenderQuality.ts";
import { qualitySettings } from "../../render/quality.ts";
import { effectiveMsaa, type GraphicsTier, loadTierPreference, nextTier, resolveTier, saveTierPreference, TIER_LABEL } from "../../render/graphicsTiers.ts";
import { PerfOverlay } from "../../render/PerfOverlay.ts";
import type { QualitySettings } from "../../render/quality.ts";
import { summarizeFrames } from "../../render/benchmark.ts";
import {
  ARRIVAL_SPOT,
  BUILDINGS,
  BOX_COLLIDERS,
  CIRCLE_COLLIDERS,
  FOUNTAIN,
  NPC_SPOTS,
  PORTALS,
  RESPAWN_SLOTS,
  VILLAGE_SPOTS,
  WALK_SPEED,
  groundHeight,
  moveVillage,
  standable,
  villageCameraDistance,
} from "./layout.ts";
import { buildVillageWorld, type VillageWorld } from "./VillageWorld.ts";
import { artCameraDistance } from "./artCamera.ts";
import { TourRunner, tourPoints, type TourEvent } from "./tour.ts";
import type { VillageArtState } from "./VillageArtP3.ts";
import type { VillageArtFull } from "./VillageArtFull.ts";
import type { VillageInteract } from "./VillageInteract.ts";
import { type DiagStep, diagSteps, type FrameMark, type FrameSummary, SHADOW_LABEL, splitFrameStats, type VillagePerfConfig, villagePerfConfig } from "./villagePerf.ts";
import { VillageShadows } from "./villageShadows.ts";
import type { CharAction, VillageCharacter } from "./villageCharacter.ts";

/**
 * Stage 6 P2-3 第一階段：星芽村 Grey-box 測試頁（?map=village）。
 * - 只有配置、佔位模型、道路、碰撞、移動；NPC／傳送／復活只預留座標（地面標記），沒有功能
 * - 星芽原野（?map=starsprout）與正式遊戲不受影響
 */

declare global {
  interface Window {
    __starwishVillage?: unknown;
  }
}

export function startVillageMap(canvas: HTMLCanvasElement, hudRoot: HTMLElement): Promise<void> {
  const page = new VillagePage(canvas, hudRoot);
  page.start();
  return Promise.resolve();
}

/** 巡迴測試期間的效能取樣（巡迴判定在 tour.ts） */
interface DiagResult {
  id: string;
  label: string;
  avgFps: number;
  low1Fps: number;
  minFps: number;
  stutters: number;
  avgDraw: number;
  avgTris: number;
  /** 實際生效的解析度倍率、framebuffer、Hardware Scaling、是否鎖定 */
  res: number;
  fb: string;
  hwScaling: number;
  locked: boolean;
  msaa: number;
  shadow: string;
  hdr: boolean;
  post: boolean;
  /** 這一項開始前是否確實恢復基準 */
  baselineOk: boolean;
  pausedFrames: number;
}

const DIAG_WARM = 2;
const DIAG_SAMPLE = 4.5;

interface TourSampling {
  runner: TourRunner;
  marks: FrameMark[];
  t: number;
  ev0: number;
  dts: number[];
  draws: number[];
  tris: number[];
}

class VillagePage {
  private readonly quality: QualitySettings;
  private readonly lite: boolean;
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly world: VillageWorld;
  private readonly player: PlayerAvatar;
  /** Stage 6.5：正式玩家角色（Claude A 初心者 C1.0-B5b＋寵物跟隨）；載入完成前與 &char=simple 時用簡易角色 */
  private char: VillageCharacter | null = null;
  private charStatus: "off" | "loading" | "loaded" | string = "off";
  private readonly charGender: "male" | "female";
  private charSpeed = 0;
  private readonly camera: ThirdPersonCamera;
  private readonly sun: DirectionalLight;
  private readonly shadows: ShadowGenerator;
  private render: RenderSetup;
  /** Stage 6.3 效能設定（網址參數＋預設） */
  private readonly perfCfg: VillagePerfConfig;
  /** Stage 6.4 三段畫質 */
  private readonly tier: GraphicsTier;
  private readonly tierSource: "url" | "stored" | "default";
  /** 頁面暫停事件（切到背景、失焦）：巡迴期間的幀會標記為「頁面暫停」，不是遊戲卡頓 */
  private pauseFlag: string | null = null;
  private readonly pageEvents: { at: number; type: string }[] = [];
  /** 診斷目前要求的 MSAA（報告實際生效值用） */
  private msaaNow = 1;
  private readonly vshadows: VillageShadows;
  /** 效能診斷：目前套用中的設定（從 perfCfg 出發，一次只改一項） */
  private diag: { steps: DiagStep[]; i: number; t: number; dts: number[]; draws: number[]; tris: number[]; results: DiagResult[]; alpha0: number; baseOk: boolean; stepBaseOk?: boolean; paused?: number } | null = null;
  private lastDiag: DiagResult[] | null = null;
  private skipRender = false;
  private hdrNow = true;
  private postNow = true;
  private readonly perf: PerfOverlay;
  private readonly hud: Hud;
  private readonly input = new InputState();
  private readonly keyboard: KeyboardInput;
  private readonly camTouch: CameraTouchControl;
  private readonly pos = new Vector3();
  private yaw = 0;
  private overview = false;
  private frozen = false;
  /** Stage 6.6 全村美術升級外觀是否開啟（&look=65 關閉） */
  private look66 = false;
  private foliage: Foliage66 | null = null;
  private loadMs = 0;
  private contextLost = 0;
  private fpsTimer = 0;
  private blockedFrames = 0;
  private tour: TourSampling | null = null;
  private lastTour: {
    loopTimes: number[];
    /** 有效遊戲期間（排除頁面暫停幀）的統計；raw＝全部幀原始統計 */
    avgFps: number;
    low1Fps: number;
    minFps: number;
    raw: FrameSummary;
    valid: FrameSummary;
    pausedFrames: number;
    pausedSeconds: number;
    longFrames: { t: number; ms: number; cause: string }[];
    pageEvents: { t: number; type: string }[];
    res: ReturnType<PerfOverlay["resolutionInfo"]>;
    avgDraw: number;
    maxDraw: number;
    avgTris: number;
    stuck: number;
    timeouts: number;
    blockedFrames: number;
    events: TourEvent[];
    stutters: number;
  } | null = null;
  private panel!: HTMLDivElement;
  private info!: HTMLDivElement;
  private reportBox!: HTMLTextAreaElement;
  private shadowQ: "default" | "medium" = "default";
  /** 正式美術開關（&art=p3）；預設關閉＝Grey-box */
  private readonly artP3: boolean;
  private artState: VillageArtState | null = null;
  /** 全村整合（&art=full）：三批正式候選美術＋洛恩 V2.1＋NPC／傳送門互動 */
  private readonly artFull: boolean;
  private full: VillageArtFull | null = null;
  private fullStatus = "off";
  private interact: VillageInteract | null = null;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    const t0 = performance.now();
    const params = new URLSearchParams(location.search);
    // Stage 6.4 三段畫質：網址 ?quality= ＞ 玩家偏好 ＞ 中畫質（新玩家預設）；模型精細度與渲染設定由畫質預設決定（?lod= 等可覆寫）
    const tr = resolveTier(params.get("quality"), loadTierPreference());
    this.tier = tr.tier;
    this.tierSource = tr.source;
    this.perfCfg = villagePerfConfig(params, this.tier);
    this.lite = this.perfCfg.models === "lite";
    const q0 = qualitySettings(this.tier);
    // 只用一種抗鋸齒：有後製管線＝管線 MSAA；沒有後製管線＝畫布 MSAA（只在要求 >1 時）；不用 FXAA
    this.quality = { ...q0, maxPixelRatio: this.perfCfg.maxRes, msaaSamples: this.perfCfg.msaa, postProcess: this.perfCfg.post, fxaa: false, canvasAntialias: !this.perfCfg.post && this.perfCfg.msaa > 1 };
    this.msaaNow = this.perfCfg.msaa;
    for (const ev of ["visibilitychange", "pagehide", "pageshow", "blur", "focus", "freeze", "resume"]) {
      const target: EventTarget = ev === "visibilitychange" || ev === "freeze" || ev === "resume" ? document : window;
      target.addEventListener(ev, () => {
        const type = ev === "visibilitychange" ? `visibility:${document.visibilityState}` : ev;
        this.pageEvents.push({ at: performance.now() / 1000, type });
        if (ev !== "focus" && ev !== "pageshow" && !(ev === "visibilitychange" && document.visibilityState === "visible")) this.pauseFlag = type;
      });
    }
    this.hdrNow = this.perfCfg.hdr;
    this.postNow = this.perfCfg.post;
    this.engine = createEngine(canvas, this.quality);
    this.engine.onContextLostObservable.add(() => this.contextLost++);
    const scene = new Scene(this.engine);
    this.scene = scene;
    createSkyDome(scene);
    scene.ambientColor = new Color3(0.35, 0.33, 0.4);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogStart = this.lite ? 60 : 75;
    scene.fogEnd = this.lite ? 150 : 190;
    scene.fogColor = SKY_COLORS.fog.clone();
    scene.skipPointerMovePicking = true;

    const hemi = new HemisphericLight("skyLight", new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.8;
    hemi.diffuse = new Color3(1, 0.98, 1);
    hemi.groundColor = new Color3(0.62, 0.66, 0.62);
    this.sun = new DirectionalLight("sun", new Vector3(-0.45, -1, 0.35).normalize(), scene);
    this.sun.intensity = 0.75;
    this.sun.diffuse = new Color3(1, 0.95, 0.86);
    this.sun.autoUpdateExtends = false;
    this.sun.orthoLeft = -22;
    this.sun.orthoRight = 22;
    this.sun.orthoTop = 22;
    this.sun.orthoBottom = -22;
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = 90;
    this.shadows = createShadows(this.sun, this.quality);
    this.shadows.darkness = 0.35;
    this.shadowQ = params.get("shadowq") === "medium" && this.shadows.useContactHardeningShadow ? "medium" : "default";
    this.vshadows = new VillageShadows(scene, this.sun, this.shadows, this.perfCfg.shadow, this.perfCfg.casterCull);
    this.vshadows.range = this.perfCfg.shadowRange;
    if (this.shadowQ === "medium") this.shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;

    this.pos.set(ARRIVAL_SPOT.x, groundHeight(ARRIVAL_SPOT.x, ARRIVAL_SPOT.z), ARRIVAL_SPOT.z);
    this.yaw = ARRIVAL_SPOT.yaw;
    this.player = new PlayerAvatar(scene, this.shadows);
    this.player.root.position.copyFrom(this.pos);
    this.charGender = params.get("g") === "female" ? "female" : "male";
    // 正式角色載入後用 A 的角色腳底陰影；這裡只給簡易角色用
    this.vshadows.addFootSource({ pos: () => (this.char ? null : this.pos), radius: 0.42 });
    this.camera = new ThirdPersonCamera(scene, this.pos, groundHeight, {
      keepPitch: true,
      // 全村整合：另外避開傳送門石拱與南門橫樑（頭頂以上的美術結構，不是碰撞物）
      obstruct: params.get("art") === "full" ? artCameraDistance : villageCameraDistance,
    });
    this.camera.obstructEnabled = params.get("camcol") !== "0";
    scene.activeCamera = this.camera.camera;
    this.camera.snap(this.pos, this.alphaBehind(this.yaw), TUNING.camera.defaultBeta, TUNING.camera.distance);
    this.render = setupRendering(scene, this.camera.camera, this.quality, { hdr: this.perfCfg.hdr });
    // Grey-box 沒有需要發光的物件：關閉發光層（避免全部自發光標記被加上光暈）
    if (this.render.glow) this.render.glow.isEnabled = false;
    this.artFull = params.get("art") === "full";
    // Stage 6.4：三段畫質都註冊陰影投射物（陰影模式決定是否真的畫陰影貼圖；腳底陰影／關閉時不畫）
    this.world = buildVillageWorld(scene, this.shadows, this.lite, this.artFull);
    if (params.get("labels") === "0") this.world.setLabels(false);
    this.artP3 = params.get("art") === "p3";
    if (this.artP3) {
      void import("./VillageArtP3.ts").then((m) => m.loadVillageArtP3(scene, this.lite, this.shadows, (st) => (this.artState = st)));
    }
    if (params.get("marks") === "0") this.world.setMarkers(false);
    if (this.artFull) {
      // 正式美術有自己的發光物（噴泉、傳送門、彩繪玻璃）：用材質自發光，不開全畫面發光層
      this.fullStatus = "loading";
      // Stage 6.6 全村美術升級（材質細節、草地、光影、天空、草叢小花）；&look=65 可改回 Stage 6.5 外觀（比較用）
      this.look66 = params.get("look") !== "65";
      if (this.look66) {
        const texBase = `${import.meta.env.BASE_URL}models/village-p3/tex/`;
        const opt66 = { tier: this.tier, texBase };
        VILLAGE_LOOK.liteNormals = this.tier !== "low";
        VILLAGE_LOOK.stoneAlbedo = 0.9;
        VILLAGE_LOOK.stoneRough = 0.9;
        VILLAGE_LOOK.slateRough = 0.55;
        applyLighting66(scene, hemi, this.sun, this.shadows);
        addDetail66(villageProps(scene), scene, opt66);
        const ground = scene.getMaterialByName("PH_vMat");
        if (ground) addGrass66(ground, scene, opt66);
        upgradeSky66(scene, SKY_COLORS);
        this.foliage = buildFoliage66(scene, this.tier, this.tier !== "low");
      }
      // Stage 6.5：正式玩家角色（高畫質＝HQ、中／低＝Lite）。&char=simple 可改回簡易角色（比較用）
      if (params.get("char") !== "simple") {
        this.charStatus = "loading";
        void import("./villageCharacter.ts")
          .then((m) =>
            m.VillageCharacter.create(scene, {
              gender: this.charGender,
              lod: this.lite ? "lite" : "hq",
              baseUrl: `${import.meta.env.BASE_URL}models/`,
              shadows: this.shadows,
              shadowMode: params.get("charshadow") === "realtime" ? "realtime" : "blob",
              petId: params.get("pet") ?? undefined,
            }),
          )
          .then((c) => {
            this.char = c;
            this.charStatus = "loaded";
            this.player.root.setEnabled(false);
          })
          .catch((e: unknown) => {
            this.charStatus = `error: ${e instanceof Error ? e.message : String(e)}`;
          });
      }
      void import("./VillageArtFull.ts")
        .then((m) =>
          m.loadVillageArtFull(scene, this.lite, this.shadows, (msg) => (this.fullStatus = msg), {
            lod: { lod: this.perfCfg.npcLod, near: this.perfCfg.lodNear, animThrottle: this.perfCfg.animThrottle, animFar: this.perfCfg.animFar },
            originalModels: this.perfCfg.originalModels,
          }),
        )
        .then(async (full) => {
          this.full = full;
          const { VillageInteract } = await import("./VillageInteract.ts");
          this.interact = new VillageInteract(scene, full.merchant, {
            avatarUrl: `${import.meta.env.BASE_URL}models/village-p3/pm2_avatar.png`,
            goToMap: (map) => {
              const q = new URLSearchParams(location.search);
              q.set("map", map);
              q.delete("art");
              location.search = q.toString();
            },
          });
          this.interact.npcs = full.npcs;
          // 腳底柔和陰影（只在 shadow=blob 時顯示）：洛恩＋八位 NPC
          if (full.merchant) {
            const mr = full.merchant.root;
            this.vshadows.addFootSource({ pos: () => mr.position, radius: 0.45 });
          }
          for (const id of full.npcs?.ids ?? []) {
            const n = NPC_SPOTS.find((x) => x.id === id);
            if (n) this.vshadows.addFootSource({ pos: () => ({ x: n.x, y: n.floor, z: n.z }), radius: 0.45 });
          }
          this.fullStatus = full.errors.length ? `部分載入失敗：${full.errors.join("；")}` : "loaded";
          this.hud.toast(`星芽村全村整合載入完成（${(full.loadMs / 1000).toFixed(1)} 秒）：靠近 NPC、洛恩或傳送門會出現互動按鈕`, 3600);
        })
        .catch((e: unknown) => {
          this.fullStatus = `error: ${e instanceof Error ? e.message : String(e)}`;
        });
    }

    this.hud = new Hud(hudRoot);
    this.hud.setLevel(10);
    this.hud.setBars({ hp: 100, maxHp: 100, mp: 40, maxMp: 40, exp: 0, expToNext: 100 });
    const build = hudRoot.querySelector<HTMLSpanElement>(".hud-build");
    if (build) build.textContent = `星芽村 V1.3 ${this.artFull ? "全村整合候選" : params.get("art") === "p3" ? "P3-0 美術流程測試" : "Grey-box"} ${this.modeName()}`;
    this.hud.events.on("skillPressed", (e) => {
      // Stage 6.5：攻擊鈕播放正式角色的攻擊動作（村莊是安全區，沒有傷害）；技能鈕維持提示
      if (this.char && (e as { slot?: string }).slot === "attack") {
        this.char.action("attack");
        return;
      }
      this.hud.toast(this.artFull ? "星芽村是安全區，沒有戰鬥（技能演出在野外地圖）" : "星芽村 Grey-box：這一階段沒有戰鬥與 NPC 功能", 1500);
    });
    const joystick = new VirtualJoystick(this.hud.joystickZone, this.input, TUNING.joystick.radius, TUNING.joystick.deadZone);
    this.camTouch = new CameraTouchControl(canvas, this.input, TUNING.camera.rotateSensitivity, TUNING.camera.pitchSensitivity, TUNING.camera.pinchSensitivity);
    const block = (e: Event): void => e.preventDefault();
    for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, block, { passive: false });
    canvas.addEventListener("contextmenu", block);
    this.keyboard = new KeyboardInput(this.input, () => joystick.active);
    this.perf = new PerfOverlay(this.engine, scene, this.quality, hudRoot, { label: `畫質：${TIER_LABEL[this.tier].replace("畫質", "")}`, onQualityClick: () => this.switchTier(nextTier(this.tier)) });
    if (this.perfCfg.resLock) this.perf.lockResolution(this.perfCfg.maxRes);
    this.buildPanel(hudRoot);
    window.addEventListener("resize", () => this.engine.resize());
    this.loadMs = performance.now() - t0;
    this.installApi();
    const auto = params.get("autoplay");
    if (auto === "tour") window.setTimeout(() => this.startTour(Math.max(1, Math.min(6, Number(params.get("loops") ?? 1) || 1))), 300);
  }

  start(): void {
    this.engine.runRenderLoop(this.frame);
    this.hud.toast(this.artFull ? "星芽村全村整合候選（預覽版）：載入正式美術中…" : "星芽村 V1.3 Grey-box：佔位模型，只測配置、比例、道路、傳送門位置與碰撞。上方「村莊」可傳送與測試", 4200);
  }

  modeName(): string {
    // 保留舊報告關鍵字（Grey-box 測試比對「模式 HQ」「Lite 中畫質」「Lite 低畫質」）
    if (this.tier === "high" && !this.lite) return "HQ（高畫質）";
    if (this.tier === "medium" && this.lite) return "Lite 中畫質";
    if (this.tier === "low" && this.lite) return "Lite 低畫質";
    return `${TIER_LABEL[this.tier]}＋${this.lite ? "Lite" : "HQ"} 模型（網址指定）`;
  }

  /** Stage 6.5：玩家角色與寵物的模型版本、三角面、本幀實際 Draw Calls（主畫面＝本幀繪製的網格；陰影＝本幀陰影貼圖的投射物） */
  charInfo(): { status: string; stats: ReturnType<VillageCharacter["stats"]> | null; draws: { main: number; shadow: number; petMain: number } } {
    const c = this.char;
    if (!c) return { status: this.charStatus, stats: null, draws: { main: 0, shadow: 0, petMain: 0 } };
    const active = new Set(this.scene.getActiveMeshes().data.slice(0, this.scene.getActiveMeshes().length));
    const charMeshes = c.avatar.meshes.filter((m) => m.getTotalIndices() > 0);
    const petMeshes = c.petMeshes().filter((m) => m.getTotalIndices() > 0);
    const list = this.sun.shadowEnabled ? (this.shadows.getShadowMap()?.renderList ?? []) : [];
    const inShadow = new Set(list);
    return {
      status: this.charStatus,
      stats: c.stats(),
      draws: {
        main: charMeshes.filter((m) => active.has(m)).reduce((a, m) => a + m.subMeshes.length, 0),
        shadow: charMeshes.filter((m) => inShadow.has(m) && m.isEnabled() && m.isVisible).reduce((a, m) => a + m.subMeshes.length, 0),
        petMain: petMeshes.filter((m) => active.has(m)).length,
      },
    };
  }

  /** 切換畫質：保存偏好並重新載入（移除進階覆寫參數，避免殘留）；重新載入可保證不重複載入模型、不殘留渲染物件 */
  switchTier(t: GraphicsTier): void {
    saveTierPreference(t);
    const url = new URL(location.href);
    url.searchParams.set("quality", t);
    for (const k of ["lod", "shadow", "res", "reslock", "msaa", "hdr", "post", "npclod", "animthrottle", "castercull", "perf", "lodnear", "shadowq"]) url.searchParams.delete(k);
    location.replace(url.toString());
  }

  /** 實際生效的 MSAA（要求值、管線回報值、渲染目標實際取樣數、裝置上限） */
  msaaInfo(): { requested: number; pipeline: number | null; renderTarget: number | null; deviceMax: number; canvas: boolean; effective: number } {
    const pl = this.render.pipeline;
    const caps = this.engine.getCaps() as unknown as { maxMSAASamples?: number };
    const deviceMax = caps.maxMSAASamples ?? 1;
    let rt: number | null = null;
    try {
      const pps = (this.camera.camera as unknown as { _postProcesses?: ({ inputTexture?: { samples?: number } } | null)[] })._postProcesses ?? [];
      const first = pps.find((x) => x);
      rt = first?.inputTexture?.samples ?? null;
    } catch {
      rt = null;
    }
    const canvas = !!(this.engine as unknown as { _gl?: WebGLRenderingContext })._gl?.getContextAttributes()?.antialias;
    const effective = pl ? effectiveMsaa(this.msaaNow, rt ?? pl.samples, deviceMax) : canvas ? Math.max(1, Math.min(4, deviceMax)) : 1;
    return { requested: this.msaaNow, pipeline: pl ? pl.samples : null, renderTarget: rt, deviceMax, canvas, effective };
  }

  /** 模型與貼圖的下載情況（快取／網路），以及同一個檔案被重複請求的清單 */
  resourceInfo(): { files: number; network: number; networkMB: number; cached: number; unknown: number; duplicates: string[] } {
    const es = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const ours = es.filter((e) => /\/models\/.+\.(glb|png|jpg|ktx2)(\?|$)/.test(e.name));
    const count = new Map<string, number>();
    for (const e of ours) count.set(e.name, (count.get(e.name) ?? 0) + 1);
    let network = 0;
    let bytes = 0;
    let cached = 0;
    let unknown = 0;
    for (const e of ours) {
      if (typeof e.transferSize !== "number" || (e.transferSize === 0 && e.decodedBodySize === 0)) unknown++;
      else if (e.transferSize === 0) cached++;
      else {
        network++;
        bytes += e.transferSize;
      }
    }
    return { files: count.size, network, networkMB: Math.round((bytes / 1048576) * 10) / 10, cached, unknown, duplicates: [...count].filter(([, n]) => n > 1).map(([k, n]) => `${k.split("/").pop()}×${n}`) };
  }

  private alphaBehind(yaw: number): number {
    return Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
  }

  private frame = (): void => {
    const rawDt = this.engine.getDeltaTime() / 1000;
    const dt = Math.min(rawDt, 0.1);
    if (this.frozen) {
      this.input.consumeCamera();
      this.scene.render();
      this.perf.update(dt);
      return;
    }
    this.keyboard.update();
    let moveX = 0;
    let moveZ = 0;
    let speed01 = 0;
    const tour = this.tour;
    const touring = tour !== null && tour.runner.phase !== "done";
    if (tour && tour.runner.phase === "running") {
      const dir = tour.runner.steer(this.pos.x, this.pos.z);
      if (dir) {
        moveX = dir.x;
        moveZ = dir.z;
        speed01 = 1;
      }
    } else if (!touring) {
      const m = this.input.getMove();
      const w = inputToWorld(m.x, m.y, this.camera.forwardYaw);
      const l = Math.hypot(w.x, w.z);
      const s = l > 1 ? 1 / l : 1;
      moveX = w.x * s;
      moveZ = w.z * s;
      speed01 = Math.min(1, l);
    }
    let blockedNow = false;
    if (this.char?.dead) speed01 = 0; // 死亡動作期間不能移動（測試按鈕「復活」後恢復）
    const px0 = this.pos.x;
    const pz0 = this.pos.z;
    if (speed01 > 0 && !this.overview) {
      const step = WALK_SPEED * speed01 * dt;
      const r = moveVillage(this.pos.x, this.pos.z, this.pos.x + moveX * step, this.pos.z + moveZ * step);
      if (r.blocked) this.blockedFrames++;
      blockedNow = r.blocked;
      this.pos.x = r.x;
      this.pos.z = r.z;
      this.yaw = turnTowards(this.yaw, moveX, moveZ, TUNING.player.turnSharpness, dt);
    }
    this.pos.y = groundHeight(this.pos.x, this.pos.z);
    if (this.char) {
      // 正式角色：跑步動畫依實際水平速度（減少滑步）；離地高度只在技能跳躍時大於 0
      this.charSpeed = dt > 0 ? Math.hypot(this.pos.x - px0, this.pos.z - pz0) / dt : 0;
      this.char.update(dt, this.pos, this.yaw, this.overview ? 0 : this.charSpeed);
    } else {
      this.player.root.position.copyFrom(this.pos);
      this.player.root.rotation.y = this.yaw;
      this.player.update(dt, this.overview ? 0 : speed01);
    }
    const cam = this.input.consumeCamera();
    if (!this.overview) {
      if (touring) {
        const c = this.camera.camera;
        const want = this.alphaBehind(this.yaw);
        let da = want - c.alpha;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        c.alpha += da * (1 - Math.exp(-3 * dt));
        this.camera.update(dt, this.pos, { yaw: 0, pitch: 0, zoom: 0 });
      } else {
        this.camera.update(dt, this.pos, cam);
      }
    }
    this.sun.position.copyFrom(this.pos).subtractInPlace(this.sun.direction.scale(45));
    this.world.update(dt, this.overview ? 1e6 : this.pos.x, this.overview ? 1e6 : this.pos.z);
    this.interact?.update(performance.now() / 1000, this.pos.x, this.pos.z);
    this.vshadows.update(performance.now() / 1000, this.pos.x, this.pos.z);
    if (this.diag) this.diagFrame(rawDt);
    if (!this.skipRender) this.scene.render();
    this.perf.update(dt);
    if (tour && touring) this.tourFrame(tour, rawDt, blockedNow);
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fpsTimer = 0;
      this.hud.setFps(this.engine.getFps());
      this.updateInfo();
    }
  };

  // ---------------- 巡迴效能測試 ----------------
  startTour(loops: number): void {
    this.teleport(ARRIVAL_SPOT.x, ARRIVAL_SPOT.z, 0);
    this.tour = { runner: new TourRunner(tourPoints(NPC_SPOTS, PORTALS, ARRIVAL_SPOT), loops), dts: [], draws: [], tris: [], marks: [], t: 0, ev0: this.pageEvents.length };
    this.pauseFlag = null;
    this.hud.toast(`巡迴測試 ${loops} 圈開始（暖身 2 秒）`, 1800);
  }

  private tourFrame(t: TourSampling, rawDt: number, blocked: boolean): void {
    const wasRunning = t.runner.phase === "running";
    t.runner.record(rawDt, this.pos.x, this.pos.y, this.pos.z, blocked);
    if (wasRunning) {
      // 這一幀期間頁面曾被暫停（切到背景、失焦）→ 標記；回到前景後的第一幀記錄完就清除
      const reason = this.pauseFlag ?? (document.hidden ? "visibility:hidden" : null);
      t.marks.push({ dt: rawDt, t: t.t, paused: reason !== null, reason: reason ?? undefined });
      t.t += rawDt;
      if (!document.hidden) this.pauseFlag = null;
      t.dts.push(rawDt);
      t.draws.push(this.perf.drawCalls);
      t.tris.push(this.scene.getActiveIndices() / 3);
    }
    if (t.runner.phase === "done") this.tourDone(t);
  }

  private tourDone(t: TourSampling): void {
    const s = summarizeFrames(t.dts, t.draws);
    const fs = splitFrameStats(t.marks);
    const r = t.runner;
    const evStart = t.marks.length ? performance.now() / 1000 - t.t : 0;
    this.lastTour = {
      loopTimes: [...r.loopTimes],
      avgFps: fs.valid.avgFps,
      low1Fps: fs.valid.low1Fps,
      minFps: fs.valid.minFps,
      raw: fs.raw,
      valid: fs.valid,
      pausedFrames: fs.pausedFrames,
      pausedSeconds: fs.pausedSeconds,
      longFrames: fs.long,
      pageEvents: this.pageEvents.slice(t.ev0).map((e) => ({ t: Math.round((e.at - evStart) * 10) / 10, type: e.type })),
      res: this.perf.resolutionInfo(),
      avgDraw: s.avgDrawCalls,
      maxDraw: s.maxDrawCalls,
      avgTris: t.tris.reduce((a, b) => a + b, 0) / Math.max(1, t.tris.length),
      stuck: r.stuckCount,
      timeouts: r.timeoutCount,
      blockedFrames: r.totalBlockedFrames,
      events: [...r.events],
      stutters: fs.valid.stutters,
    };
    this.tour = null;
    this.reportBox.value = this.report();
    this.reportBox.hidden = false;
    this.panel.classList.add("open");
    this.hud.toast(`巡迴完成：平均 ${fs.valid.avgFps.toFixed(1)} FPS、真正卡住 ${r.stuckCount} 次`, 3500);
  }

  // ---------------- 效能診斷（實機一鍵 A/B；Stage 6.3 建立、6.4 修正公平性與報告） ----------------
  /** 固定在中央廣場（看得到噴泉與北側建築），鏡頭每項繞一圈；每項開始前恢復基準並檢查，只改一個因素 */
  startDiag(limit?: number): void {
    if (this.tour || this.diag) return;
    this.interact?.closeAll();
    this.teleport(0, -12.5, 0);
    const all = diagSteps(this.perfCfg.post);
    const steps = limit ? all.slice(0, limit) : all;
    this.diag = { steps, i: 0, t: 0, dts: [], draws: [], tris: [], results: [], alpha0: this.camera.camera.alpha, baseOk: true };
    this.beginDiagStep();
    this.hud.toast(`效能診斷開始：${steps.length} 項 × ${DIAG_WARM + DIAG_SAMPLE} 秒（約 ${Math.round((steps.length * (DIAG_WARM + DIAG_SAMPLE)) / 6) / 10} 分鐘），請不要操作、不要切換 App`, 3500);
  }

  /** 恢復基準（目前畫質設定；解析度鎖定在基準上限，排除動態解析度的干擾）並檢查是否真的恢復 */
  private restoreBaseline(): boolean {
    const cfg = this.perfCfg;
    this.perf.lockResolution(cfg.maxRes);
    this.vshadows.apply(cfg.shadow);
    this.msaaNow = cfg.msaa;
    this.rebuildRendering(cfg.hdr, cfg.post);
    if (this.render.pipeline) this.render.pipeline.samples = cfg.msaa;
    this.full?.npcs?.setLod(cfg.npcLod);
    this.full?.npcs?.setEnabled(true);
    this.full?.merchant?.setEnabled(true);
    for (const m of this.full?.statics ?? []) m.setEnabled(true);
    this.skipRender = false;
    const res = this.perf.resolutionInfo();
    return (
      Math.abs(res.actual - cfg.maxRes) < 0.01 &&
      this.vshadows.mode === cfg.shadow &&
      this.hdrNow === cfg.hdr &&
      this.postNow === cfg.post &&
      (!this.render.pipeline || this.render.pipeline.samples === cfg.msaa) &&
      !this.skipRender
    );
  }

  private beginDiagStep(): void {
    const d = this.diag!;
    const ok = this.restoreBaseline();
    if (!ok) d.baseOk = false;
    d.stepBaseOk = ok;
    this.applyDiag(d.steps[d.i]!);
    this.pauseFlag = null;
  }

  private diagFrame(rawDt: number): void {
    const d = this.diag!;
    const step = d.steps[d.i]!;
    d.t += Math.min(rawDt, 0.25);
    // 鏡頭繞廣場一圈（每項相同的路徑）
    this.camera.camera.alpha = d.alpha0 + (2 * Math.PI * d.t) / (DIAG_WARM + DIAG_SAMPLE);
    if (d.t > DIAG_WARM) {
      d.dts.push(rawDt);
      if (this.pauseFlag || document.hidden) d.paused = (d.paused ?? 0) + 1;
      if (!document.hidden) this.pauseFlag = null;
      d.draws.push(this.perf.drawCalls);
      d.tris.push(this.scene.getActiveIndices() / 3);
    }
    if (d.t < DIAG_WARM + DIAG_SAMPLE) return;
    const s = splitFrameStats(d.dts.map((dt) => ({ dt, t: 0, paused: false })));
    const res = this.perf.resolutionInfo();
    const ms = this.msaaInfo();
    d.results.push({
      id: step.id,
      label: step.label,
      avgFps: s.raw.avgFps,
      low1Fps: s.raw.low1Fps,
      minFps: s.raw.minFps,
      stutters: s.raw.stutters,
      avgDraw: d.draws.reduce((a, b) => a + b, 0) / Math.max(1, d.draws.length),
      avgTris: d.tris.reduce((a, b) => a + b, 0) / Math.max(1, d.tris.length),
      res: res.actual,
      fb: `${res.width}×${res.height}`,
      hwScaling: res.hardwareScaling,
      locked: res.locked,
      msaa: ms.effective,
      shadow: this.vshadows.mode,
      hdr: this.hdrNow,
      post: this.postNow,
      baselineOk: d.stepBaseOk ?? true,
      pausedFrames: d.paused ?? 0,
    });
    d.i++;
    d.t = 0;
    d.dts = [];
    d.draws = [];
    d.tris = [];
    d.paused = 0;
    if (d.i >= d.steps.length) {
      this.restoreBaseline();
      this.lastDiag = d.results;
      this.diag = null;
      if (!this.perfCfg.resLock) this.perf.lockResolution(null);
      this.reportBox.value = this.report();
      this.reportBox.hidden = false;
      this.panel.classList.add("open");
      this.hud.toast("效能診斷完成：報告已顯示在「村莊」面板（可複製）", 3500);
      return;
    }
    this.beginDiagStep();
  }

  /** 套用這一項的變更（呼叫前已恢復基準） */
  private applyDiag(step: DiagStep): void {
    const c = step.change;
    const cfg = this.perfCfg;
    if (c.maxRes !== undefined) this.perf.lockResolution(c.maxRes);
    if (c.shadow !== undefined) this.vshadows.apply(c.shadow);
    if (c.hdr !== undefined || c.post !== undefined) this.rebuildRendering(c.hdr ?? cfg.hdr, c.post ?? cfg.post);
    if (c.msaa !== undefined) {
      this.msaaNow = c.msaa;
      if (this.render.pipeline) this.render.pipeline.samples = c.msaa;
    }
    if (c.npcLod !== undefined) this.full?.npcs?.setLod(c.npcLod);
    if (c.hideCharacters) {
      this.full?.npcs?.setEnabled(false);
      this.full?.merchant?.setEnabled(false);
    }
    if (c.hideStatic) for (const m of this.full?.statics ?? []) m.setEnabled(false);
    if (c.skipRender) this.skipRender = true;
  }

  private rebuildRendering(hdr: boolean, post: boolean): void {
    if (hdr === this.hdrNow && post === this.postNow) return;
    this.render.pipeline?.dispose();
    this.render.glow?.dispose();
    this.render = setupRendering(this.scene, this.camera.camera, { ...this.quality, postProcess: post, msaaSamples: this.msaaNow }, { hdr });
    if (this.render.glow) this.render.glow.isEnabled = false;
    this.hdrNow = hdr;
    this.postNow = post;
  }

  // ---------------- 傳送與視角 ----------------
  teleport(x: number, z: number, faceYaw?: number): void {
    this.setOverview(false);
    this.pos.set(x, groundHeight(x, z), z);
    if (faceYaw !== undefined) this.yaw = faceYaw;
    this.player.root.position.copyFrom(this.pos);
    // P3-2E：出生／復活點（噴泉周圍）用微抬的初始俯角，讓第一眼看到漂浮星晶；其他位置維持預設
    const cam0 = villageInitialCamera(x, z);
    this.camera.snap(this.pos, this.alphaBehind(this.yaw), cam0.beta, cam0.distance);
  }

  setOverview(on: boolean): void {
    if (on === this.overview) return;
    this.overview = on;
    const c = this.camera.camera;
    if (on) {
      this.scene.fogMode = Scene.FOGMODE_NONE;
      c.target.set(0, 3, -4);
      c.alpha = -Math.PI / 2;
      c.beta = 0.55;
      c.radius = 120;
    } else {
      this.scene.fogMode = Scene.FOGMODE_LINEAR;
      this.camera.snap(this.pos, this.alphaBehind(this.yaw), TUNING.camera.defaultBeta, TUNING.camera.distance);
    }
  }

  /** 截圖用視角（角色位置、角色面向、鏡頭俯角、距離） */
  view(name: string): boolean {
    const at = (x: number, z: number, yawDeg: number, beta: number, radius: number): void => {
      this.teleport(x, z, (yawDeg * Math.PI) / 180);
      this.camera.snap(this.pos, this.alphaBehind(this.yaw), beta, radius);
    };
    const V: Record<string, [number, number, number, number, number]> = {
      arrival: [0, -39, 0, 1.25, 12],
      gate: [0, -30, 0, 1.2, 12],
      plaza: [0, -12.5, 0, 1.12, 13],
      west: [-30, 0, 270, 1.2, 10],
      east: [30, 0, 90, 1.2, 10],
      north: [0, 15, 0, 1.2, 10],
      northPortal: [0, 30, 0, 1.2, 10],
      smith: [-15, -6, 240, 1.2, 9],
      circus: [11, -9, 128, 1.2, 10],
      church: [13, 5, 66, 1.2, 10],
      terrace: [-3, 26, 300, 1.15, 10],
      p3sample: [4.5, -34.5, 45, 1.2, 8],
    };
    if (name === "overview") {
      this.setOverview(true);
      return true;
    }
    const v = V[name];
    if (!v) return false;
    at(...v);
    return true;
  }

  // ---------------- 報告與面板 ----------------
  report(): string {
    const ws = this.world.stats();
    const lines: string[] = [];
    lines.push(this.artFull ? "星願物語 Stage 6.4 星芽村 測試報告" : "星願物語 Stage 6 P2-3 星芽村 V1.3 Grey-box 測試報告");
    lines.push(`時間 ${new Date().toLocaleString("zh-TW", { hour12: false })}`);
    lines.push(`網址參數 ${location.search || "(無)"}`);
    lines.push(`裝置 ${navigator.userAgent}`);
    // Stage 6.4：以下全部讀取「實際生效」的渲染參數（不使用畫質表的文字）
    const res = this.perf.resolutionInfo();
    const ms = this.msaaInfo();
    const map = this.shadows.getShadowMap();
    const shadowNow = this.vshadows.mode;
    const shadowMapText = this.sun.shadowEnabled && map ? `${map.getSize().width}×${map.getSize().height}，${this.shadows.useContactHardeningShadow ? "PCSS" : this.shadows.usePercentageCloserFiltering ? "PCF" : "其他"}，取樣品質 ${["高", "中", "低"][this.shadows.filteringQuality] ?? this.shadows.filteringQuality}` : "不使用陰影貼圖";
    lines.push(`模式 ${this.modeName()}：畫質 ${TIER_LABEL[this.tier]}（來源：${this.tierSource === "url" ? "網址指定" : this.tierSource === "stored" ? "玩家偏好" : "新玩家預設"}）、模型 ${this.lite ? "Lite" : "HQ"}${this.perfCfg.profile === "s62" ? "【重現 Stage 6.2】" : ""}${this.perfCfg.overrides.length ? `；網址覆寫：${this.perfCfg.overrides.join("、")}` : ""}／載入 ${Math.round(this.loadMs)} ms`);
    lines.push(`陰影（實際）：${SHADOW_LABEL[shadowNow]}｜陰影貼圖 ${shadowMapText}`);
    lines.push(`解析度（實際）：要求上限 ${res.requestedMax}x、實際 ${res.actual}x、framebuffer ${res.width}×${res.height}、Hardware Scaling ${res.hardwareScaling}、裝置 DPR ${res.dpr}｜${res.locked ? "已鎖定（不做動態解析度）" : `動態解析度 ${res.dynamicEngaged ? `已介入（第 ${res.dynamicStep + 1} 級／${res.dynamicSteps.join("→")}x）` : `未介入（階梯 ${res.dynamicSteps.join("→")}x）`}`}`);
    lines.push(`抗鋸齒（實際）：MSAA 要求 ${ms.requested}x、${ms.pipeline !== null ? `後製管線 ${ms.pipeline}x、渲染目標 ${ms.renderTarget ?? "無法讀取"}x` : `沒有後製管線、畫布 MSAA ${ms.canvas ? "開" : "關"}`}、裝置上限 ${ms.deviceMax}x → 實際生效 ${ms.effective}x｜HDR ${this.hdrNow ? "開" : "關"}、後製管線 ${this.postNow ? "開" : "關"}`);
    lines.push(`村莊 V1.3 佔位網格 ${ws.meshes}、三角形 ${ws.triangles}、文字標籤 ${ws.labels}；建築 ${BUILDINGS.length}、NPC 站位 ${NPC_SPOTS.length}、出生／復活點 ${RESPAWN_SLOTS.length}、傳送門 ${PORTALS.length}（開放 ${PORTALS.filter((p) => p.open).length}）`);
    lines.push(`碰撞 圓形 ${CIRCLE_COLLIDERS.length}、矩形 ${BOX_COLLIDERS.length}；鏡頭避障 ${this.camera.obstructEnabled ? "開" : "關"}`);
    lines.push(`目前畫面 Draw Calls ${this.perf.drawCalls}、三角形 ${Math.round(this.scene.getActiveIndices() / 3)}`);
    if (this.artP3) {
      const a = this.artState;
      lines.push(
        a
          ? `正式美術 art=p3（${a.stage}）：${a.status === "loaded" ? "已載入" : a.status === "error" ? `載入失敗 ${a.error}` : "載入中"} ${a.file}，${a.ms} ms，網格 ${a.meshes}、材質 ${a.materials}、貼圖 ${a.textures}、三角形 ${a.triangles}`
          : "正式美術 art=p3：尚未開始載入",
      );
    } else if (this.artFull) {
      const f = this.full;
      lines.push(`全村整合 art=full：${this.fullStatus}${f ? `，載入 ${f.loadMs} ms` : ""}`);
      if (f) for (const [k, v] of Object.entries(f.parts)) lines.push(`  ${k}：網格 ${v.meshes}、三角形 ${v.triangles}`);
    } else lines.push("正式美術：關閉（Grey-box）");
    const pc = this.perfCfg;
    lines.push(`角色：NPC 距離 LOD ${pc.npcLod ? `開（${pc.lodNear} m）` : "關"}、畫面外剔除 開、遠距／畫面外暫停動作 ${pc.animThrottle ? "開" : "關"}、陰影投射物剔除 ${pc.casterCull ? `開（${this.vshadows.range} m 內）` : "關"}｜陰影投射物 本幀 ${this.vshadows.activeCasters}／全部 ${this.vshadows.totalCasters}（三角形 ${this.vshadows.casterTriangles()}）`);
    if (this.artFull) {
      const cs = this.charInfo();
      if (cs.stats) {
        const c = cs.stats;
        lines.push(`玩家角色：Claude A 正式初心者 ${c.version}｜${c.model}（${c.gender === "male" ? "男" : "女"}、${c.lod === "hq" ? "HQ" : "Lite"}）｜三角面 ${c.triangles}、網格 ${c.meshes}（可繪製 ${c.drawMeshes}、骨架網格 ${c.skinnedMeshes}）、骨骼 ${c.bones}｜動作 ${c.animations.join("／")}｜陰影 ${c.shadow}｜本幀 Draw Calls：主畫面 ${cs.draws.main}、陰影貼圖 ${cs.draws.shadow}｜來源 ${c.source}`);
        const pt = c.pet;
        lines.push(`寵物：${pt.label}（${pt.model}）｜高度 ${pt.size} m、三角面 ${pt.triangles}、網格 ${pt.meshes}｜本幀 Draw Calls：主畫面 ${cs.draws.petMain}｜與角色頭部／身體最小間距 ${pt.minGapCm ?? "—"} cm（修正前 ${pt.minRawGapCm ?? "—"} cm，間距保護修正 ${pt.corrections} 次）`);
      } else lines.push(`玩家角色：${this.charStatus === "off" ? "簡易測試角色（&char=simple）" : `正式角色 ${this.charStatus}`}`);
      if (this.look66) {
        const fs = this.foliage?.stats;
        lines.push(`美術：Stage 6.6 全村升級（物件細節貼圖／草地／光影 曝光 1.0、對比 1.12／雲朵天空／NPC 專屬五官＋眨眼＋職業小動作）｜草叢 ${fs?.tufts ?? 0}、小花 ${fs?.flowers ?? 0}（${fs?.triangles ?? 0} 面、${fs?.drawCalls ?? 0} 次繪製）｜外圍樹林${this.lite ? "不分區" : `分 ${ENV_SECTORS} 個扇區（畫面外不繪製）`}｜&look=65 可切回 Stage 6.5 外觀比較`);
      } else lines.push("美術：Stage 6.5 外觀（&look=65）");
      const ri = this.resourceInfo();
      lines.push(`模型與貼圖 ${ri.files} 個：網路下載 ${ri.network} 個（${ri.networkMB} MB）、瀏覽器快取 ${ri.cached} 個${ri.unknown ? `、無法判斷 ${ri.unknown} 個` : ""}｜重複請求：${ri.duplicates.length ? ri.duplicates.join("、") : "無"}｜載入時間${ri.network === 0 && ri.cached > 0 ? "（全部來自快取，不能當作首次載入時間）" : ri.cached > 0 ? "（部分來自快取）" : "（首次下載）"}`);
    }
    lines.push("資料來源：本報告數字是「這台裝置」的實測（不是 CI）");
    const dg = this.lastDiag;
    if (dg) {
      lines.push(`---- 效能診斷（中央廣場、鏡頭繞一圈，每項暖身 ${DIAG_WARM} 秒＋取樣 ${DIAG_SAMPLE} 秒；每項開始前恢復基準並檢查；解析度鎖定）----`);
      lines.push("短時間診斷只用來分析瓶頸；各項 FPS 增益不能直接相加，正式驗收以完整巡迴測試為準");
      const base = dg[0]?.avgFps ?? 0;
      for (const x of dg) {
        const diff = base > 0 && x.id !== "base" ? `（${x.avgFps >= base ? "+" : ""}${(x.avgFps - base).toFixed(1)}）` : "";
        lines.push(
          `${x.label}：平均 ${x.avgFps.toFixed(1)}${diff}／1% Low ${x.low1Fps.toFixed(1)}／最低 ${x.minFps.toFixed(1)}／卡頓 ${x.stutters}｜Draw ${x.avgDraw.toFixed(0)}｜三角形 ${Math.round(x.avgTris)}｜實際 ${x.res}x（${x.fb}、HWS ${x.hwScaling}${x.locked ? "、鎖定" : "、未鎖定"}）｜陰影 ${x.shadow}｜MSAA ${x.msaa}x｜HDR ${x.hdr ? "開" : "關"}、後製 ${x.post ? "開" : "關"}${x.baselineOk ? "" : "｜⚠ 開始前未完全恢復基準"}${x.pausedFrames ? `｜⚠ 取樣期間頁面暫停 ${x.pausedFrames} 幀，本項不可採信` : ""}`,
        );
      }
    }
    const r = this.lastTour;
    if (!r) {
      lines.push("尚未執行巡迴測試");
      return lines.join("\n");
    }
    lines.push(`---- 巡迴測試 ${r.loopTimes.length} 圈（${this.modeName()}）----`);
    lines.push(`每圈時間：${r.loopTimes.map((t) => t.toFixed(1) + " 秒").join("、")}；總時間 ${r.loopTimes.reduce((a, b) => a + b, 0).toFixed(1)} 秒`);
    lines.push(`真正卡住 ${r.stuck} 次；腳本誤報（進度逾時但仍在移動）${r.timeouts} 次；碰撞滑動 ${r.blockedFrames} 幀`);
    lines.push("統計定義：平均 FPS＝幀數÷總時間；1% Low＝最慢 1% 幀的平均幀時間換算；最低 FPS＝1÷最長一幀；卡頓＝幀時間 >50 ms；長幀＝>250 ms");
    lines.push(`FPS 平均 ${r.avgFps.toFixed(1)}／1% Low ${r.low1Fps.toFixed(1)}／最低 ${r.minFps.toFixed(1)}／卡頓(>50ms) ${r.stutters} 幀（有效遊戲期間：${r.valid.frames} 幀、${r.valid.seconds.toFixed(1)} 秒）`);
    lines.push(`原始（全部幀，含頁面暫停）：${r.raw.frames} 幀、${r.raw.seconds.toFixed(1)} 秒｜平均 ${r.raw.avgFps.toFixed(1)}／1% Low ${r.raw.low1Fps.toFixed(1)}／最低 ${r.raw.minFps.toFixed(1)}／卡頓 ${r.raw.stutters}／長幀 ${r.raw.longFrames}`);
    lines.push(`頁面暫停（切到背景、失焦等，非遊戲因素）：${r.pausedFrames} 幀、${r.pausedSeconds.toFixed(1)} 秒；頁面事件：${r.pageEvents.length ? r.pageEvents.map((e) => `${e.t}s ${e.type}`).join("、") : "無"}`);
    lines.push(`長幀（>250 ms）：${r.longFrames.length ? r.longFrames.map((l) => `${l.t}s ${l.ms} ms ${l.cause}`).join("、") : "無"}`);
    lines.push(`巡迴期間解析度：結束時實際 ${r.res.actual}x（${r.res.width}×${r.res.height}）、${r.res.locked ? "鎖定" : r.res.dynamicEngaged ? "動態解析度已介入" : "動態解析度未介入"}`);
    lines.push(`Draw Calls 平均 ${r.avgDraw.toFixed(0)}／最高 ${r.maxDraw}；每格三角形平均 ${Math.round(r.avgTris)}`);
    if (r.events.length === 0) lines.push("異常事件：無");
    for (const e of r.events) {
      lines.push(
        `異常 ${e.kind === "stuck" ? "真正卡住" : "腳本誤報"}｜第 ${e.loop} 圈 路段 ${e.leg} ${e.from}→${e.to}（目標 ${e.target[0]}, ${e.target[1]}）｜位置 X ${e.x} Y ${e.y} Z ${e.z}｜持續 ${e.duration} 秒｜2 秒內移動 ${e.moved2s} m（${e.speed} m/s）｜本段碰撞滑動 ${e.blockedFrames} 幀`,
      );
    }
    lines.push(`WebGL Context Lost ${this.contextLost} 次`);
    return lines.join("\n");
  }

  private buildPanel(hudRoot: HTMLElement): void {
    const toggle = document.createElement("button");
    toggle.className = "map-toggle";
    toggle.textContent = "村莊";
    const panel = document.createElement("div");
    panel.className = "map-panel";
    this.panel = panel;
    const stop = (e: Event): void => e.stopPropagation();
    toggle.addEventListener("pointerdown", stop);
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      panel.classList.toggle("open");
    });
    panel.addEventListener("pointerdown", stop);
    const title = document.createElement("div");
    title.className = "map-title";
    title.textContent = "星芽村 V1.3　Grey-box";
    this.info = document.createElement("div");
    this.info.className = "map-info";
    panel.append(title, this.info);
    const section = (name: string): HTMLDivElement => {
      const h = document.createElement("div");
      h.className = "map-section";
      h.textContent = name;
      panel.appendChild(h);
      const row = document.createElement("div");
      row.className = "map-row";
      panel.appendChild(row);
      return row;
    };
    const btn = (row: HTMLElement, label: string, fn: () => void, cls = ""): HTMLButtonElement => {
      const b = document.createElement("button");
      b.className = `map-btn ${cls}`;
      b.textContent = label;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
      });
      row.appendChild(b);
      return b;
    };
    const go = section("傳送（測試用：NPC 前方 2 m、傳送門前）");
    for (const s of VILLAGE_SPOTS) {
      btn(go, s.label, () => {
        this.teleport(s.x, s.z, s.yaw);
        panel.classList.remove("open");
      });
    }
    if (this.artFull) {
      btn(go, "洛恩旁（寵物商人）", () => {
        const m = this.full?.merchant;
        if (!m) return this.hud.toast("洛恩還在載入中", 1200);
        const p = m.root.position;
        const r = Math.hypot(p.x, p.z) || 1;
        // 站在洛恩外側 1.6 m（巡走路線在噴泉外圈 r 10.8，外側是廣場空地）
        this.teleport(p.x + (p.x / r) * 1.6, p.z + (p.z / r) * 1.6, Math.atan2(-p.x, -p.z));
        panel.classList.remove("open");
      });
    }
    const show = section("顯示");
    const lb = btn(show, `標示：${this.world.labelsOn ? "開" : "關"}`, () => {
      this.world.setLabels(!this.world.labelsOn);
      lb.textContent = `標示：${this.world.labelsOn ? "開" : "關"}`;
    });
    const mb = btn(show, `地面標記：${this.world.markersOn ? "開" : "關"}`, () => {
      this.world.setMarkers(!this.world.markersOn);
      mb.textContent = `地面標記：${this.world.markersOn ? "開" : "關"}`;
    });
    const ov = btn(show, "全景", () => {
      this.setOverview(!this.overview);
      ov.textContent = this.overview ? "回到角色" : "全景";
      panel.classList.remove("open");
    });
    // Stage 6.4 三段畫質（保存偏好、重新載入）
    for (const t of ["high", "medium", "low"] as const) {
      const b = btn(show, TIER_LABEL[t], () => this.switchTier(t), "alt");
      if (this.tier === t && this.perfCfg.profile === "opt") b.classList.add("go");
    }
    const test = section("測試");
    btn(test, "巡迴 1 圈", () => {
      panel.classList.remove("open");
      this.startTour(1);
    }, "go");
    btn(test, "巡迴 3 圈", () => {
      panel.classList.remove("open");
      this.startTour(3);
    }, "go");
    btn(test, "效能診斷（約 2 分鐘）", () => {
      panel.classList.remove("open");
      this.startDiag();
    }, "go");
    btn(test, "複製報告", () => this.copyReport(), "alt");
    // Stage 6.5：正式角色（性別切換重新載入；動作測試；測試寵物）
    if (this.artFull) {
      const ch = section("角色（Claude A 正式初心者）");
      for (const [label, g] of [["男", "male"], ["女", "female"]] as const) {
        const b = btn(ch, label, () => {
          const url = new URL(location.href);
          url.searchParams.set("g", g);
          url.searchParams.delete("char");
          location.replace(url.toString());
        }, "alt");
        if (this.charGender === g) b.classList.add("go");
      }
      for (const [label, a] of [["攻擊", "attack"], ["受傷", "hurt"], ["死亡", "die"], ["復活", "revive"]] as const) btn(ch, label, () => this.char?.action(a), "alt");
      const pt = section("寵物跟隨（測試寵物）");
      void import("./villageCharacter.ts").then((m) => {
        for (const p of m.PET_PRESETS) btn(pt, p.label, () => this.char?.setPet(p.id), "alt");
      });
    }
    const pv = section("效能版本（重新載入）");
    for (const [label, perf] of [
      ["目前畫質設定", null],
      ["Stage 6.2 原版（比較用）", "s62"],
    ] as const) {
      const b = btn(pv, label, () => {
        const url = new URL(location.href);
        if (perf) url.searchParams.set("perf", perf);
        else url.searchParams.delete("perf");
        location.replace(url.toString());
      }, "alt");
      if ((this.perfCfg.profile === "s62") === (perf === "s62")) b.classList.add("go");
    }
    this.reportBox = document.createElement("textarea");
    this.reportBox.className = "map-report";
    this.reportBox.readOnly = true;
    this.reportBox.hidden = true;
    panel.appendChild(this.reportBox);
    hudRoot.append(toggle, panel);
  }

  private copyReport(): void {
    const text = this.report();
    this.reportBox.value = text;
    this.reportBox.hidden = false;
    const fallback = (): void => {
      this.reportBox.focus();
      this.reportBox.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      this.hud.toast(ok ? "報告已複製" : "請長按下方文字框全選後複製", 2200);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => this.hud.toast("報告已複製", 1800),
        () => fallback(),
      );
    } else fallback();
  }

  private updateInfo(): void {
    const t = this.tour?.runner;
    const st =
      t && t.phase !== "done"
        ? `巡迴：第 ${t.loop + 1}/${t.loops} 圈 ${t.loopT.toFixed(1)} 秒｜卡住 ${t.stuckCount}、誤報 ${t.timeoutCount}`
        : this.lastTour
          ? `上次巡迴 平均 ${this.lastTour.avgFps.toFixed(1)} FPS、卡住 ${this.lastTour.stuck}`
          : "尚未測試";
    this.info.textContent = `位置 (${this.pos.x.toFixed(1)}, ${this.pos.z.toFixed(1)}) 高 ${this.pos.y.toFixed(1)}｜${st}`;
  }

  private installApi(): void {
    const api = {
      ready: true,
      lite: this.lite,
      info: () => ({
        quality: this.quality.level,
        lite: this.lite,
        loadMs: this.loadMs,
        drawCalls: this.perf.drawCalls,
        triangles: Math.round(this.scene.getActiveIndices() / 3),
        world: this.world.stats(),
        contextLost: this.contextLost,
        mode: this.modeName(),
      }),
      player: () => ({ x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw }),
      camera: () => {
        const c = this.camera.camera;
        return { alpha: c.alpha, beta: c.beta, radius: c.radius, desired: this.camera.desiredDistance, pos: { x: c.position.x, y: c.position.y, z: c.position.z }, touches: this.camTouch.activePointers };
      },
      teleport: (x: number, z: number, yawDeg?: number) => this.teleport(x, z, yawDeg === undefined ? undefined : (yawDeg * Math.PI) / 180),
      setMove: (m: { x: number; y: number } | null) => {
        this.input.moveOverride = m;
      },
      standable: (x: number, z: number) => standable(x, z),
      height: (x: number, z: number) => groundHeight(x, z),
      layout: () => ({ npcs: NPC_SPOTS, respawn: RESPAWN_SLOTS, arrival: ARRIVAL_SPOT, fountain: FOUNTAIN, portals: PORTALS }),
      view: (name: string) => this.view(name),
      shotCam: (on: boolean, tx?: number, ty?: number, tz?: number, a?: number, b?: number, r?: number) => shotCam(this, on, tx, ty, tz, a, b, r),
      shotTargets: () => shotTargets(this),
      /** Stage 6.6 美術升級狀態（外觀開關、草叢小花數量與面數） */
      art66: () => ({ look: this.look66, foliage: this.foliage?.stats ?? null, lighting: { exposure: this.scene.imageProcessingConfiguration.exposure, contrast: this.scene.imageProcessingConfiguration.contrast } }),
      freeze: (on: boolean) => {
        this.frozen = on;
      },
      setLabels: (on: boolean) => this.world.setLabels(on),
      setMarkers: (on: boolean) => this.world.setMarkers(on),
      startTour: (loops: number) => this.startTour(loops),
      tourState: () => ({ phase: this.tour ? this.tour.runner.phase : this.lastTour ? "done" : null, loop: this.tour?.runner.loop ?? 0, result: this.lastTour }),
      blockedFrames: () => this.blockedFrames,
      artState: () => this.artState,
      artFull: () => ({ on: this.artFull, status: this.fullStatus, loadMs: this.full?.loadMs ?? 0, parts: this.full?.parts ?? {}, errors: this.full?.errors ?? [], merchant: !!this.full?.merchant, npcs: this.full?.npcs?.ids ?? [] }),
      /** Stage 6.2：正式 NPC 的動作狀態（Idle／Turn／Talk、目前面向、原本面向） */
      npcs: () => ({ stats: this.full?.npcs?.stats ?? {}, state: this.full?.npcs?.state() ?? {} }),
      interact: () => this.interact?.state() ?? null,
      interactNow: () => this.interact?.activate() ?? "none",
      /** 測試用：站到洛恩外側 1.2 m 並在同一個瞬間開始對話（洛恩一直在走，避免時間差） */
      meetMerchant: () => {
        const m = this.full?.merchant;
        if (!m || !this.interact) return "no-merchant";
        const now = performance.now() / 1000;
        m.update(now);
        const p = m.root.position;
        const r = Math.hypot(p.x, p.z) || 1;
        this.teleport(p.x + (p.x / r) * 1.2, p.z + (p.z / r) * 1.2, Math.atan2(-p.x, -p.z));
        this.interact.update(now, this.pos.x, this.pos.z);
        return this.interact.activate();
      },
      interactClose: () => this.interact?.closeAll(),
      /** Stage 6.3：效能設定、陰影投射物、角色 LOD 狀態、目前畫面的網格分類（CI 與實機都可呼叫） */
      perfState: () => ({
        cfg: this.perfCfg,
        shadow: this.vshadows.mode,
        casters: { active: this.vshadows.activeCasters, total: this.vshadows.totalCasters, triangles: this.vshadows.casterTriangles() },
        pixelRatio: this.perf.pixelRatio,
        render: { w: this.engine.getRenderWidth(), h: this.engine.getRenderHeight() },
        npcs: this.full?.npcs?.state() ?? {},
        npcStats: this.full?.npcs?.stats ?? {},
        merchant: this.full?.merchant?.stats ?? null,
      }),
      perfBreakdown: () => {
        const groups: Record<string, { meshes: number; triangles: number }> = {};
        for (const m of this.scene.getActiveMeshes().data.slice(0, this.scene.getActiveMeshes().length)) {
          const name = m.name;
          const isChar = !!this.char && this.char.avatar.meshes.includes(m);
          const isPet = !!this.char && this.char.petMeshes().includes(m);
          const key = isChar ? "玩家角色（正式）" : isPet ? "寵物" : name.startsWith("PH_") ? `Grey-box/系統 ${name.replace(/\d+$/, "")}` : name.startsWith("npc_") ? "NPC" : name.startsWith("pm_") || name.startsWith("PetPal_") ? "洛恩" : name.split(/[_.]/)[0] || name;
          const g = (groups[key] ??= { meshes: 0, triangles: 0 });
          g.meshes++;
          g.triangles += Math.round(m.getTotalIndices() / 3);
        }
        return { activeMeshes: this.scene.getActiveMeshes().length, activeTriangles: Math.round(this.scene.getActiveIndices() / 3), groups };
      },
      startDiag: (limit?: number) => this.startDiag(limit),
      /** Stage 6.5：正式玩家角色與寵物 */
      charState: () => {
        const i = this.charInfo();
        return { ...i, anim: this.char?.avatar.state ?? null, runRate: this.char?.avatar.runRate ?? null, speed: this.charSpeed, simpleVisible: this.player.root.isEnabled(), pos: this.char ? { x: this.char.avatar.root.position.x, y: this.char.avatar.root.position.y, z: this.char.avatar.root.position.z } : null, pet: this.char ? { x: this.char.follower.position.x, y: this.char.follower.position.y, z: this.char.follower.position.z, visible: this.char.follower.visible } : null };
      },
      charAction: (a: CharAction) => this.char?.action(a),
      setPet: (id: string) => this.char?.setPet(id),
      /** Stage 6.4：三段畫質、實際生效的渲染參數 */
      tier: () => ({ tier: this.tier, source: this.tierSource, models: this.lite ? "lite" : "hq", stored: loadTierPreference(), mode: this.modeName() }),
      switchTier: (t: GraphicsTier) => this.switchTier(t),
      renderState: () => ({ res: this.perf.resolutionInfo(), msaa: this.msaaInfo(), shadow: this.vshadows.mode, shadowMapSize: this.sun.shadowEnabled ? (this.shadows.getShadowMap()?.getSize().width ?? 0) : 0, hdr: this.hdrNow, post: this.postNow, resources: this.resourceInfo() }),
      /** HDR 視覺比較（截圖用）：重建後製管線 */
      setHdr: (on: boolean) => this.rebuildRendering(on, this.postNow),
      /** 測試用：模擬頁面切到背景（不改遊戲狀態，只標記幀） */
      simulatePause: (type: string) => {
        this.pauseFlag = type;
        this.pageEvents.push({ at: performance.now() / 1000, type: `${type}(模擬)` });
      },
      /** 噴泉／傳送門動畫探針：回傳動畫物件目前的旋轉（兩次取樣比較是否在動） */
      animProbe: () =>
        this.scene.meshes
          .filter((m) => /crystal|Crystal|Portal_fx|Portal_rune|Fountain.*(star|gem|orb)/i.test(m.name) && m.isEnabled())
          .slice(0, 8)
          .map((m) => ({ name: m.name, ry: m.absoluteRotationQuaternion ? m.absoluteRotationQuaternion.y : 0, y: m.getAbsolutePosition().y })),
      diagState: () => ({ running: !!this.diag, step: this.diag ? this.diag.i : -1, total: this.diag?.steps.length ?? 0, results: this.lastDiag }),
      setShadow: (mode: string) => this.vshadows.apply(mode as VillagePerfConfig["shadow"]),
      appraisal: () => this.interact?.appraisalWindow.current ?? null,
      guild: (cmd: string) => this.interact?.guildCmd(cmd) ?? Promise.resolve(null),
      report: () => this.report(),
    };
    window.__starwishVillage = api;
  }
}
