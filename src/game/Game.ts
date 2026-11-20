import {
  Color3,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  EngineInstrumentation,
  Matrix,
  SceneInstrumentation,
  ShadowGenerator,
  type TransformNode,
  Vector3,
} from "@babylonjs/core";
import { TUNING } from "../config/tuning.ts";
import { InputState } from "../input/InputState.ts";
import { VirtualJoystick } from "../input/VirtualJoystick.ts";
import { CameraTouchControl } from "../input/CameraTouchControl.ts";
import { KeyboardInput } from "../input/KeyboardInput.ts";
import { Hud } from "../ui/Hud.ts";
import { checkHud, type Insets } from "../ui/layout-check.ts";
import { buildMeadow, type MeadowWorld } from "../world/Meadow.ts";
import { clampToWalkable, heightAt } from "../world/terrain.ts";
import { resolvePropCollisions } from "../world/scatter.ts";
import { PlayerAvatar } from "../actors/PlayerAvatar.ts";
import { moveStep, turnTowards } from "../actors/movement.ts";
import { ThirdPersonCamera } from "../camera/ThirdPersonCamera.ts";
import { SKY_COLORS, createEngine, createShadows, createSkyDome, pickQuality, setupRendering, type RenderSetup } from "../render/RenderQuality.ts";
import { PerfOverlay, type PerfStats } from "../render/PerfOverlay.ts";
import type { QualitySettings } from "../render/quality.ts";
import { createMonsterRegistry, MonsterFactory, type MonsterController, type MonsterTarget } from "../monsters/framework/index.ts";
import { registerBabylonVisuals } from "../monsters/babylon/registerVisuals.ts";
import { BOBO_MODEL_IDS, BOBO_PROFILE_IDS, boboVariantFromSearch, hopSyncFromSearch, type BoboVariant } from "./boboVariant.ts";
import { BoboV38RSceneAssets, BoboV38RVisual, type BoboV38RAnimDebug } from "../monsters/star-dew-bobo-v38r/BoboV38RVisual.ts";
import type { AttackLog } from "../monsters/framework/MonsterInstance.ts";
import { PREVIEW_COMBAT, PreviewCombat, previewSpawnPoints, separate, type AttackStartResult, type PlayerAttackResult } from "./previewCombat.ts";
import { ATTACK_TIMING, type AttackPhase } from "../actors/attackAnim.ts";
import { FrameRecorder, summarizeFrames } from "../render/benchmark.ts";
import { FrameProfiler, resolutionInfo } from "../render/frameProfiler.ts";
import { DebugPanel, debugEnabledFromSearch, formatDebugLines, type DebugInfo } from "./debugPanel.ts";
import { AUTOPLAY_STORAGE_KEY, AutoplayStats, autoplayKey, autoplayOptionsFromSearch, extraSpawnPoints, formatAutoplay, movePath, soakSegment, worldToInput, type AutoplayOptions, type AutoplayResult } from "./autoplay.ts";
import { contactShadowQuality, experimentLabels, experimentTag, renderExperimentsFromSearch, type RenderExperiments } from "../render/renderExperiments.ts";
import { BENCH_SPOTS, benchOptionsFromSearch, benchUrl, compareExperimentRows, compareRows, formatResult, loadResults, saveResult, type BenchOptions, type BenchResult } from "./benchMode.ts";

export interface DebugApi {
  ready: boolean;
  getPlayer(): { x: number; y: number; z: number; yaw: number };
  getCamera(): { alpha: number; beta: number; radius: number };
  setMove(move: { x: number; y: number } | null): void;
  hudIssues(insets?: Insets): string[];
  fps(): number;
  /** 讀取一幀畫面像素做統計，確認 3D 真的有畫出來 */
  pixelStats(): Promise<{ samples: number; distinctColors: number; opaqueRatio: number }>;
  renderer(): { webgl: number; hardwareScaling: number; width: number; height: number };
  /** 測試用：自上次呼叫以來的幀數與遊戲時間總和（用於驗證各畫質下遊戲時間正確） */
  consumeTime(): { frames: number; seconds: number; maxDt: number; minDt: number };
  /** 畫質與效能資訊（實際瀏覽器量測） */
  perf(): PerfStats & { postProcess: boolean; bloom: boolean; shadowFilter: string; shadowMap: number };
  /** 預覽測試：草原上的怪物狀態 */
  monsters(): {
    id: string;
    state: string;
    mode: string;
    hp: number;
    maxHp: number;
    x: number;
    y: number;
    z: number;
    spawnX: number;
    spawnZ: number;
    visible: boolean;
    stateTime: number;
    attackId: number;
    attackLog: AttackLog;
    cooldown: number;
    /** V3.8R 動畫狀態（V2 為 null） */
    anim: BoboV38RAnimDebug | null;
  }[];
  /** 測試用：直接對怪物造成傷害（不經過玩家攻擊距離與冷卻） */
  damageMonster(id: string, amount: number): { applied: boolean; killed: boolean; rehitLocked?: boolean; cancelledAttackId?: number; reason?: string } | null;
  /** 預覽測試：等同按下攻擊鍵（傷害在揮中時結算，見 attackState().lastHit） */
  attack(): AttackStartResult;
  /** 玩家攻擊動作狀態（測試用） */
  attackState(): {
    phase: AttackPhase;
    attacking: boolean;
    started: number;
    armRX: number;
    lean: number;
    /** 角色面向與目標方向的夾角（弧度）；沒有目標時為 null */
    facingError: number | null;
    lastHit: PlayerAttackResult | null;
    hits: number;
    /** 最近一次攻擊：播放過的階段、右手最大後拉／前揮、最大前傾、結算傷害時的階段與攻擊時間 */
    trace: { phases: AttackPhase[]; maxBack: number; maxFwd: number; maxLean: number; hitPhase: AttackPhase | null; hitElapsed: number | null };
  };
  /** 預覽測試：玩家戰鬥狀態 */
  combat(): { hp: number; maxHp: number; down: boolean; hitsTaken: number; lockedId: string | null; tilt: number };
  /** 預覽測試：直接讓玩家倒地 */
  knockDown(): void;
  /** 預覽測試：直接設定玩家位置（x, z） */
  teleport(x: number, z: number): void;
  /** Stage 5.1：星露啵啵外觀與 V3.8R 適配器資源狀態 */
  bobo(): Promise<unknown>;
  /**
   * 陰影鏡頭（測試截圖用）：玩家站在離出生點最近的一棵樹前方，鏡頭固定、怪物與玩家動作停住、解析度固定，
   * 讓樹影與玩家影子都在畫面中，用來比較陰影品質
   */
  stageShadowPhoto(): { tree: { x: number; z: number }; player: { x: number; z: number } };
  /** 靜止畫面穩定性：相隔 ms 毫秒讀兩次畫面，回傳不同的像素數（陰影閃爍或取樣雜訊會造成差異） */
  stabilityCheck(ms: number): Promise<{ pixels: number; changed: number; maxDelta: number }>;
  /** 實際遊玩壓力測試（?autoplay=）狀態；一般遊戲為 null */
  autoplayState(): { phase: "loading" | "warmup" | "running" | "done"; elapsed: number; result: AutoplayResult | null } | null;
  /** 目前啟用的渲染實驗（預設為空） */
  renderExperiments(): { tag: string; labels: string[]; shadowQuality: number; msaa: number; hdr: boolean | null; shadowEnabled: boolean };
  /** 除錯面板（?debug=1）目前的資料；一般遊戲為 null */
  debugInfo(): DebugInfo | null;
  /** 除錯面板的「重設測試」 */
  resetTest(): void;
  /** 調查用（只在呼叫時計算）：這一幀畫了哪些東西 */
  renderBreakdown(): {
    pixelRatio: number;
    renderSize: [number, number];
    postProcess: { enabled: boolean; msaaSamples: number; fxaa: boolean };
    glow: { exists: boolean; enabled: boolean };
    shadow: { mapSize: number; casters: number; filter: string };
    renderTargets: number;
    activeByGroup: Record<string, number>;
    trianglesActive: number;
  };
  /** 效能測試（?bench=1）狀態；一般遊戲為 null */
  benchState(): { phase: "loading" | "warmup" | "measuring" | "done"; progress: number; result: BenchResult | null; saved: string[] } | null;
  /** Stage 5.1：另建一隻 V3.8R 視覺 → 移除，比對資源數（只在 ?bobo=v38r 時執行） */
  boboAdapterSelfTest(): Promise<unknown>;
  /**
   * 畫質比對截圖：玩家回出生點、鏡頭固定、3 隻怪物放到鏡頭前固定位置並面向鏡頭、停住、固定解析度。
   * glow：發光層開關（只用於重現修正前的畫面）。回傳每隻身體與臉在畫面上的位置（CSS 像素）與繪製數據
   */
  stageBoboPhoto(opts?: { glow?: boolean }): unknown;
}

declare global {
  interface Window {
    __starwish?: DebugApi;
  }
}

const PLAYER_RADIUS = 0.3;

export class Game {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly input = new InputState();
  private readonly hud: Hud;
  private readonly joystick: VirtualJoystick;
  private readonly cameraControl: CameraTouchControl;
  private readonly keyboard: KeyboardInput;
  private readonly world: MeadowWorld;
  private readonly player: PlayerAvatar;
  private readonly camera: ThirdPersonCamera;
  private readonly sun: DirectionalLight;
  private readonly quality: QualitySettings;
  private readonly render: RenderSetup;
  private readonly shadowGen: ShadowGenerator;
  private readonly perfOverlay: PerfOverlay;
  private readonly position = new Vector3(0, 0, 0);
  private yaw = 0;
  private fpsTimer = 0;
  private running = false;
  private welcomed = false;
  private timeFrames = 0;
  private timeSum = 0;
  private timeMax = 0;
  private timeMin = Infinity;
  /** 預覽測試：星露啵啵 V2 接入草原（測試用戰鬥，見 previewCombat.ts） */
  private readonly monsters: MonsterController[];
  private readonly boboVariant: BoboVariant;
  /** 測試截圖：怪物停住（不更新 AI 與動畫），只用於同條件比較畫質 */
  private photoMode = false;
  /** 實際遊玩壓力測試（?autoplay=）：null = 一般遊戲 */
  private readonly autoOpts: AutoplayOptions | null = autoplayOptionsFromSearch(location.search);
  private autoRun: {
    phase: "loading" | "warmup" | "running" | "done";
    warm: number;
    stats: AutoplayStats;
    rec: { draws: number[] };
    path: { x: number; z: number }[];
    wp: number;
    banner: HTMLDivElement | null;
    resStart: { meshes: number; materials: number; textures: number } | null;
    prevStates: string[];
    prevDown: boolean;
    revived: boolean;
    result: AutoplayResult | null;
  } | null = null;
  /** 渲染效能實驗（?opt=／?diag=）；預設全部關閉 */
  private readonly experiments: RenderExperiments = renderExperimentsFromSearch(location.search);
  /** 除錯面板（?debug=1）：null = 一般遊戲（不建立、不計時） */
  private readonly debugOn = debugEnabledFromSearch(location.search);
  private debugPanel: DebugPanel | null = null;
  private debugLast: DebugInfo | null = null;
  /** 每幀 CPU 分段計時：只在 ?debug=1 或 ?bench=1&benchprof=1 建立 */
  private profiler: FrameProfiler | null = null;
  private sceneInstr: SceneInstrumentation | null = null;
  private gpuInstr: EngineInstrumentation | null = null;
  /** 效能測試（?bench=1）：null = 一般遊戲 */
  private readonly benchOpts: BenchOptions | null = benchOptionsFromSearch(location.search);
  private benchRun: {
    phase: "loading" | "warmup" | "measuring" | "done";
    rec: FrameRecorder | null;
    activeSum: number;
    activeMax: number;
    activeN: number;
    result: BenchResult | null;
    banner: HTMLDivElement | null;
  } | null = null;
  private readonly combat = new PreviewCombat();
  private readonly lockRing: Mesh;
  private lockedId: string | null = null;
  /** 倒地動作進度 0..1 */
  private downT = 0;
  /** 攻擊中要面向的目標 */
  private attackTargetId: string | null = null;
  private lastHit: PlayerAttackResult | null = null;
  private hits = 0;
  /** 最近一次攻擊動作逐幀紀錄（測試用：確認每個階段都有播放、揮中時才結算） */
  private attackTrace = { phases: [] as AttackPhase[], maxBack: 0, maxFwd: 0, maxLean: 0, hitPhase: null as AttackPhase | null, hitElapsed: null as number | null };
  private now = 0;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    // 畫質（高/中/低）決定抗鋸齒方式、後製、陰影、解析度上限
    this.quality = pickQuality();
    this.engine = createEngine(canvas, this.quality);

    const scene = new Scene(this.engine);
    this.scene = scene;
    // 渲染升級：3D 漸層天空（後製管線需要不透明畫面，取代原本的 CSS 背景）
    createSkyDome(scene);
    scene.ambientColor = new Color3(0.35, 0.33, 0.4);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogStart = 45;
    scene.fogEnd = 120;
    scene.fogColor = SKY_COLORS.fog.clone();
    scene.skipPointerMovePicking = true;

    const hemi = new HemisphericLight("skyLight", new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.78;
    hemi.diffuse = new Color3(1, 0.98, 1);
    hemi.groundColor = new Color3(0.62, 0.7, 0.6);

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

    // 陰影依畫質：高 = 柔和接觸陰影，中/低 = PCF
    const shadows = createShadows(this.sun, this.quality);
    this.shadowGen = shadows;
    shadows.darkness = 0.35;
    // ---- 渲染效能實驗（只在網址參數開啟；預設與原本完全相同） ----
    // 高畫質柔和接觸陰影的取樣品質：V3.8R 預設中品質（PCSS32）；V2 與 ?shadowq=original 維持原本高品質。
    // 只改取樣品質：陰影類型、柔和範圍（contactHardeningLightSizeUVRatio）、陰影貼圖、偏移、濃度都不變；中、低畫質（PCF）不受影響
    const contactQ = contactShadowQuality(this.quality.shadows.filter, boboVariantFromSearch(location.search), this.experiments);
    if (contactQ && shadows.useContactHardeningShadow) shadows.filteringQuality = contactQ === "medium" ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_HIGH;
    // diag=noshadow：診斷用，量測陰影整體成本（陰影貼圖繪製＋地面等物件的陰影取樣）
    if (this.experiments.diag === "noshadow") this.sun.shadowEnabled = false;

    this.world = buildMeadow(scene, shadows);
    this.player = new PlayerAvatar(scene, shadows);
    this.position.set(0, heightAt(0, 0), 0);
    this.player.root.position.copyFrom(this.position);
    this.camera = new ThirdPersonCamera(scene, this.position);
    scene.activeCamera = this.camera.camera;
    // 色調映射、曝光、後製抗鋸齒、選擇性 Bloom
    this.render = setupRendering(scene, this.camera.camera, this.quality, this.experiments.diag === "nohdr" ? { hdr: false } : {});
    // diag=nomsaa：診斷用，量測後製管線 MSAA 的成本
    if (this.experiments.diag === "nomsaa" && this.render.pipeline) this.render.pipeline.samples = 1;

    // ---------- 預覽測試：星露啵啵 V2（沿用怪物框架：生成、AI、狀態機、動畫） ----------
    const registry = registerBabylonVisuals(createMonsterRegistry(), {
      scene,
      shadows,
      glow: this.render.glow ?? undefined,
      quality: this.quality.level,
      boboHopSync: hopSyncFromSearch(location.search),
    });
    const factory = new MonsterFactory(registry);
    // 外觀：預設 V2；?bobo=v38r 改用 V3.8R（只換模型，數值、AI、戰鬥規則不變）
    this.boboVariant = boboVariantFromSearch(location.search);
    const modelId = BOBO_MODEL_IDS[this.boboVariant];
    // 怪物數量：正式遊戲 3 隻；只有 ?autoplay=…&count=5／10 的測試場景會多生成（不改正式設定）
    const spawnPts = previewSpawnPoints(0, 0, this.camera.forwardYaw);
    if (this.autoOpts && this.autoOpts.count > 3) spawnPts.push(...extraSpawnPoints(this.autoOpts.count - 3, this.camera.forwardYaw));
    this.monsters = spawnPts.map((p) =>
      factory.create("star_dew_bobo", { x: p.x, y: heightAt(p.x, p.z), z: p.z }, { modelId, animationProfileId: BOBO_PROFILE_IDS[this.boboVariant] }),
    );
    for (const m of this.monsters) void m.visual?.load();
    // V3.8R 不使用 GlowLayer（頭頂星星的柔光改用光暈 sprite，與已驗收的測試頁相同）。
    // GlowLayer 是「選擇性發光」，但只有 V2 模型會登記發光物件；沒有任何登記時 Babylon 會讓「所有」自發光物件發光
    // → 高／中畫質的 V3.8R 身體、眼睛、嘴、腮紅整片泛白（低畫質沒有 GlowLayer，所以清楚），草原與玩家也被誤加光暈。
    // V3.8R 模式下沒有任何物件需要發光，因此停用（同時省下發光層的額外繪製與模糊）。V2 模式不受影響。
    if (this.boboVariant === "v38r" && this.render.glow) this.render.glow.isEnabled = false;
    // 鎖定標記：攻擊範圍內最近的怪物腳下的光圈
    this.lockRing = MeshBuilder.CreateTorus("PH_lockRing", { diameter: 1.1, thickness: 0.05, tessellation: 40 }, scene);
    const ringMat = new StandardMaterial("PH_lockRingMat", scene);
    ringMat.disableLighting = true;
    ringMat.emissiveColor = new Color3(1, 0.55, 0.35);
    ringMat.alpha = 0.85;
    this.lockRing.material = ringMat;
    this.lockRing.isPickable = false;
    this.lockRing.setEnabled(false);

    this.hud = new Hud(hudRoot);
    this.hud.setLevel(1);
    // 經驗值與 MP 尚無系統：固定顯示；HP 由預覽測試戰鬥更新
    this.updateBars();
    this.hud.events.on("skillPressed", ({ slot }) => {
      if (this.benchLocked || this.autoplayActive) return; // 效能測試、自動遊玩測試中不接受玩家操作
      if (slot !== "attack") {
        this.hud.toast("技能將於 W2 啟用", 1200);
        return;
      }
      this.handleAttack(this.playerAttack());
    });

    this.joystick = new VirtualJoystick(this.hud.joystickZone, this.input, TUNING.joystick.radius, TUNING.joystick.deadZone);
    this.cameraControl = new CameraTouchControl(
      canvas,
      this.input,
      TUNING.camera.rotateSensitivity,
      TUNING.camera.pitchSensitivity,
      TUNING.camera.pinchSensitivity,
    );
    this.keyboard = new KeyboardInput(this.input, () => this.joystick.active);
    // 效能資訊面板＋畫質切換＋動態解析度
    this.perfOverlay = new PerfOverlay(this.engine, scene, this.quality, hudRoot);

    this.installPlatformGuards();
    this.installDebugApi();
    if (this.benchOpts) void this.startBench(hudRoot);
    else if (this.autoOpts) void this.startAutoplay(hudRoot);
    if (this.debugOn || (this.benchOpts && this.benchOpts.profile)) this.setupProfiling();
    if (this.debugOn) this.debugPanel = new DebugPanel(hudRoot, () => this.resetTest());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.engine.runRenderLoop(this.frame);
    if (!this.welcomed) {
      this.welcomed = true;
      if (this.benchOpts || this.autoOpts) return; // 效能／自動測試：不顯示歡迎提示（避免動畫中的提示影響測量）
      this.hud.toast("預覽測試：前方有 3 隻星露啵啵，靠近後按攻擊鍵（測試用數值）", 4500);
    }
  }

  stop(): void {
    this.running = false;
    this.engine.stopRenderLoop(this.frame);
  }

  private frame = (): void => {
    const prof = this.profiler;
    prof?.beginFrame();
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.1);
    this.timeFrames++;
    this.timeSum += dt;
    this.timeMax = Math.max(this.timeMax, dt);
    this.timeMin = Math.min(this.timeMin, dt);
    this.keyboard.update();
    this.now += dt;

    const autoActive = this.autoplayActive;
    const posX0 = this.position.x, posZ0 = this.position.z;
    if (autoActive) this.autoplayDrive();
    const down = this.combat.isDown;
    const rawMove = this.input.getMove();
    const benchLocked = this.benchLocked;
    const move = down || benchLocked ? { x: 0, y: 0 } : rawMove;
    const step = moveStep({
      x: this.position.x,
      z: this.position.z,
      inputX: move.x,
      inputY: move.y,
      cameraForwardYaw: this.camera.forwardYaw,
      speed: TUNING.player.moveSpeed,
      dt,
    });
    const pushed = resolvePropCollisions(step.x, step.z, PLAYER_RADIUS, this.world.props);
    const bounded = clampToWalkable(pushed.x, pushed.z);
    this.position.set(bounded.x, heightAt(bounded.x, bounded.z), bounded.z);
    // 攻擊動作中：快速轉向鎖定的目標（移動照常，只是面向目標出手）；其餘時間面向移動方向
    const faceTarget = this.player.attacking ? this.attackTarget() : null;
    if (faceTarget) {
      const p = faceTarget.instance.currentPosition;
      this.yaw = turnTowards(this.yaw, p.x - this.position.x, p.z - this.position.z, 24, dt);
    } else {
      this.yaw = turnTowards(this.yaw, step.dirX, step.dirZ, TUNING.player.turnSharpness, dt);
    }

    const root = this.player.root;
    root.position.copyFrom(this.position);
    root.rotation.y = this.yaw;
    // 測試截圖（photoMode）時玩家動作停住，畫面完全靜止，方便逐像素比較
    if (!this.photoMode) this.player.update(dt, Math.min(1, Math.hypot(move.x, move.y)));
    {
      const a = this.player.attackPose;
      const tr = this.attackTrace;
      if (a.phase !== "idle") {
        if (tr.phases[tr.phases.length - 1] !== a.phase) tr.phases.push(a.phase);
        tr.maxBack = Math.max(tr.maxBack, a.armRX);
        tr.maxFwd = Math.min(tr.maxFwd, a.armRX);
        tr.maxLean = Math.max(tr.maxLean, a.lean);
      }
    }
    // 預覽測試：HP 歸零時角色往後倒在地上（0.4 秒倒下），復活時立刻站起
    this.downT = this.combat.isDown ? Math.min(1, this.downT + dt / 0.4) : 0;
    if (this.downT > 0) {
      const e = 1 - Math.pow(1 - this.downT, 3);
      root.rotation.x = -(Math.PI / 2) * 0.92 * e;
      root.position.y += 0.18 * e;
    } else {
      root.rotation.x = 0;
    }

    prof?.mark("player");
    const camInput = this.input.consumeCamera();
    // 效能測試：鏡頭固定（觸控旋轉／縮放不生效）
    this.camera.update(dt, this.position, benchLocked || autoActive ? { yaw: 0, pitch: 0, zoom: 0 } : camInput);

    // 陰影跟著角色，只算附近範圍
    this.sun.position.copyFrom(this.position).subtractInPlace(this.sun.direction.scale(45));

    prof?.mark("input");
    if (benchLocked) this.updateMonstersHeld(dt);
    else if (!this.photoMode) this.updateMonsters(dt);
    prof?.mark("monsters");

    // 測試截圖（photoMode）時雲停住，畫面完全靜止
    if (!this.photoMode) this.world.update(dt);
    prof?.mark("world");
    this.scene.render();
    prof?.mark("render");
    this.perfOverlay.update(dt);
    if (this.benchRun) this.benchFrame();
    if (autoActive) this.autoplayFrame(posX0, posZ0, dt);

    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fpsTimer = 0;
      if (this.debugPanel) this.updateDebugPanel();
      this.hud.setFps(this.engine.getFps());
    }
    if (prof) {
      prof.mark("hud");
      prof.endFrame(this.engine.getDeltaTime());
    }
  };

  /** 調查用計時（只在除錯或效能分析模式）：CPU 分段、Babylon 繪製細項、GPU 計時（裝置支援時） */
  private setupProfiling(): void {
    this.profiler = new FrameProfiler();
    const si = new SceneInstrumentation(this.scene);
    si.captureActiveMeshesEvaluationTime = true;
    si.captureRenderTargetsRenderTime = true;
    si.captureSpritesRenderTime = true;
    si.captureParticlesRenderTime = true;
    this.sceneInstr = si;
    // GPU 計時需要 EXT_disjoint_timer_query；iOS Safari 通常不支援，此時不建立
    if (this.engine.getCaps().timerQuery) {
      const gi = new EngineInstrumentation(this.engine);
      gi.captureGPUFrameTime = true;
      this.gpuInstr = gi;
    }
  }

  private collectDebugInfo(): DebugInfo {
    const counts = this.resourceCounts();
    const canvas = this.engine.getRenderingCanvas();
    const w = this.engine.getRenderWidth(), h = this.engine.getRenderHeight();
    const cssW = Math.round(canvas?.clientWidth ?? w), cssH = Math.round(canvas?.clientHeight ?? h);
    const si = this.sceneInstr;
    const gi = this.gpuInstr;
    const a = this.player.attackPose;
    return {
      variant: this.boboVariant,
      quality: this.quality.level,
      fps: this.engine.getFps(),
      drawCalls: this.perfOverlay.drawCalls,
      activeMeshes: this.scene.getActiveMeshes().length,
      meshes: counts.meshes,
      materials: counts.materials,
      textures: counts.textures,
      render: {
        width: w,
        height: h,
        cssWidth: cssW,
        cssHeight: cssH,
        pixelRatio: Math.round((1 / this.engine.getHardwareScalingLevel()) * 100) / 100,
        devicePixelRatio: window.devicePixelRatio || 1,
        megapixels: resolutionInfo(cssW, cssH, w, h).megapixels,
      },
      // 效能測試進行中時不取走計時視窗（留給測試結果）
      profile: this.profiler && !this.benchLocked ? this.profiler.takeWindow() : null,
      sceneTimes: si
        ? {
            activeMeshes: si.activeMeshesEvaluationTimeCounter.lastSecAverage,
            renderTargets: si.renderTargetsRenderTimeCounter.lastSecAverage,
            sprites: si.spritesRenderTimeCounter.lastSecAverage,
            particles: si.particlesRenderTimeCounter.lastSecAverage,
          }
        : null,
      gpuMs: gi && gi.gpuFrameTimeCounter.count > 0 ? gi.gpuFrameTimeCounter.lastSecAverage * 1e-6 : null,
      gpuSupported: gi !== null,
      player: { hp: this.combat.hp, maxHp: PREVIEW_COMBAT.playerMaxHp, down: this.combat.isDown, attackPhase: a.phase, hits: this.hits },
      experiments: experimentLabels(this.experiments),
      monsters: this.monsters.map((m) => {
        const i = m.instance;
        const v = m.visual;
        return {
          id: i.instanceId,
          hp: i.currentHp,
          maxHp: i.definition.maxHp,
          state: i.sm.state,
          anim: v instanceof BoboV38RVisual ? v.debugState().anim : null,
          attackId: i.attackId,
          resolved: i.attackLog.resolved,
          cancelled: i.attackLog.cancelled,
          duplicatesBlocked: i.attackLog.duplicatesBlocked,
          cooldown: i.cooldownRemaining(this.now),
          respawnIn: m.brain ? m.brain.respawnRemaining(this.now) : null,
        };
      }),
    };
  }

  /** 每 0.5 秒：整理資料、更新面板文字（只在 ?debug=1） */
  private updateDebugPanel(): void {
    const info = this.collectDebugInfo();
    this.debugLast = info;
    this.debugPanel!.setLines(formatDebugLines(info));
  }

  /**
   * 「重設測試」（只在 ?debug=1 的面板與除錯介面）：
   * 怪物全部回出生點、HP 全滿、待機、冷卻與攻擊紀錄歸零（V3.8R 以重生淡入呈現）；玩家回出生點、HP 全滿、解除倒地。
   * 不改任何數值與規則。
   */
  private resetTest(): void {
    for (const m of this.monsters) {
      if (m.visual instanceof BoboV38RVisual) m.visual.onStateEnter("respawn");
      m.instance.resetForTest();
      m.brain?.resetForTest();
    }
    this.combat.resetForTest();
    this.attackTargetId = null;
    this.lastHit = null;
    this.hits = 0;
    this.downT = 0;
    this.position.set(0, heightAt(0, 0), 0);
    this.player.root.position.copyFrom(this.position);
    this.player.root.rotation.x = 0;
    this.updateBars();
    this.hud.toast("已重設測試：怪物與玩家回到出生點、HP 全滿", 1200);
  }

  /** 自動遊玩測試進行中（暖機或測量；遊戲照常運作，只是由程式操作） */
  private get autoplayActive(): boolean {
    return this.autoRun !== null && (this.autoRun.phase === "warmup" || this.autoRun.phase === "running");
  }

  private async startAutoplay(hudRoot: HTMLElement): Promise<void> {
    const o = this.autoOpts!;
    const banner = document.createElement("div");
    banner.className = "autoplay-banner";
    banner.setAttribute("style", "position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:50;display:flex;gap:8px;align-items:center;padding:5px 10px;border-radius:12px;background:rgba(30,30,60,.72);color:#fff;font:600 12px/1.4 system-ui,sans-serif;white-space:nowrap");
    const text = document.createElement("span");
    // 測量期間不更新這段文字（不增加額外成本）
    text.textContent = `自動測試中（${o.mode}・${o.count} 隻・${o.duration} 秒），請勿觸碰`;
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "autoplay-stop";
    stop.textContent = "停止";
    stop.setAttribute("style", "padding:3px 10px;border-radius:8px;border:0;background:#f07c9a;color:#fff;font:600 12px system-ui,sans-serif");
    stop.addEventListener("pointerdown", (e) => e.stopPropagation());
    stop.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.autoRun?.phase === "running") this.finishAutoplay();
    });
    banner.append(text, stop);
    hudRoot.appendChild(banner);
    this.engine.onContextLostObservable.add(() => {
      if (this.autoRun) this.autoRun.stats.contextLost++;
    });
    const stats = new AutoplayStats(o.mode === "soak" ? 60 : 30);
    this.autoRun = {
      phase: "loading", warm: 0, stats, rec: { draws: [] }, path: movePath(7), wp: 0, banner,
      resStart: null, prevStates: this.monsters.map((m) => m.instance.sm.state), prevDown: false, revived: false, result: null,
    };
    await Promise.all(this.monsters.map((m) => m.visual?.load() ?? Promise.resolve()));
    await this.scene.whenReadyAsync();
    this.autoRun.phase = "warmup";
  }

  /** 每幀（讀取輸入之前）：依模式設定模擬搖桿、按攻擊鍵 */
  private autoplayDrive(): void {
    const a = this.autoRun!;
    const o = this.autoOpts!;
    const seg = o.mode === "soak" ? soakSegment(a.stats.elapsed + a.warm) : o.mode;
    if (this.combat.isDown) {
      this.input.moveOverride = null;
      return;
    }
    const p = this.position;
    const toward = (x: number, z: number): void => {
      this.input.moveOverride = worldToInput(x - p.x, z - p.z, this.camera.forwardYaw);
    };
    if (seg === "move") {
      let t = a.path[a.wp]!;
      if (Math.hypot(t.x - p.x, t.z - p.z) < 0.8) {
        a.wp = (a.wp + 1) % a.path.length;
        t = a.path[a.wp]!;
      }
      toward(t.x, t.z);
      return;
    }
    // 戰鬥：走向最近的存活怪物，進入攻擊距離就按攻擊（冷卻中按了也不會出手）
    let best: MonsterController | null = null;
    let bd = Infinity;
    for (const m of this.monsters) {
      if (!m.instance.isAlive) continue;
      const d = Math.hypot(m.instance.currentPosition.x - p.x, m.instance.currentPosition.z - p.z);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    if (!best) {
      this.input.moveOverride = null;
      return;
    }
    const mp = best.instance.currentPosition;
    if (bd > 1.6) toward(mp.x, mp.z);
    else this.input.moveOverride = null;
    if (bd <= 2.3) {
      const r = this.playerAttack();
      if (r.ok && a.phase === "running") a.stats.attackStarted(this.now);
    }
  }

  /** 每幀（繪製之後）：暖機計時、記錄影格與各項觀察 */
  private autoplayFrame(x0: number, z0: number, dt: number): void {
    const a = this.autoRun!;
    const o = this.autoOpts!;
    const rawDt = this.engine.getDeltaTime() / 1000;
    if (a.phase === "warmup") {
      a.warm += rawDt;
      if (a.warm >= o.warmup) {
        a.phase = "running";
        a.resStart = this.resourceCounts();
        a.prevStates = this.monsters.map((m) => m.instance.sm.state);
        a.prevDown = this.combat.isDown;
      }
      a.revived = false;
      return;
    }
    const st = a.stats;
    const moved = Math.hypot(this.position.x - x0, this.position.z - z0);
    const tgt = this.camera.camera.target;
    let valid = true;
    this.monsters.forEach((m, i) => {
      const s = m.instance.sm.state;
      const q = m.instance.currentPosition;
      if (!Number.isFinite(q.x) || !Number.isFinite(q.z) || !Number.isFinite(m.instance.currentHp)) valid = false;
      if (s !== a.prevStates[i]) {
        if (s === "death") st.monsterDeaths++;
        if (s === "respawn") st.monsterRespawns++;
        a.prevStates[i] = s;
      }
    });
    if (this.combat.isDown && !a.prevDown) st.playerDowns++;
    a.prevDown = this.combat.isDown;
    st.frame({
      rawDt,
      drawCalls: this.perfOverlay.drawCalls,
      moved,
      expectedMax: TUNING.player.moveSpeed * Math.min(dt, 0.1) + 0.02,
      intendMove: this.input.moveOverride !== null && !this.combat.isDown,
      revived: a.revived,
      cameraLag: Math.hypot(tgt.x - this.position.x, tgt.z - this.position.z),
      valid,
    });
    a.revived = false;
    if (st.dueSample()) st.sample({ ...this.resourceCounts(), heapMB: this.heapMB() });
    if (st.elapsed >= o.duration) this.finishAutoplay();
  }

  private heapMB(): number | null {
    const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return m ? m.usedJSHeapSize / (1024 * 1024) : null;
  }

  private finishAutoplay(): void {
    const a = this.autoRun!;
    const o = this.autoOpts!;
    a.phase = "done";
    this.input.moveOverride = null;
    const st = a.stats;
    if (st.timeline.length === 0 || st.elapsed - (st.timeline[st.timeline.length - 1]?.t ?? 0) > 1) st.sample({ ...this.resourceCounts(), heapMB: this.heapMB() });
    const end = this.resourceCounts();
    const dup = this.monsters.reduce((n, m) => n + m.instance.attackLog.duplicatesBlocked, 0);
    const result: AutoplayResult = {
      mode: o.mode,
      count: this.monsters.length,
      variant: this.boboVariant,
      quality: this.quality.level,
      pixelRatio: Math.round((1 / this.engine.getHardwareScalingLevel()) * 100) / 100,
      summary: summarizeFrames(st.dts, st.draws),
      timeline: st.timeline,
      checks: st.judge({
        mode: o.mode,
        attackInterval: PREVIEW_COMBAT.playerAttackInterval,
        resStart: a.resStart ?? end,
        resEnd: end,
        duplicatesBlocked: dup,
        // soak：暖機＋測量超過 20 秒才會進入第一段戰鬥（再留 3 秒讓角色走到怪物旁）
        attackExpected: o.mode !== "soak" || a.warm + st.elapsed > 23,
      }),
      counters: {
        出手: st.attackStarts,
        命中: st.hits,
        落空: st.misses,
        怪物死亡: st.monsterDeaths,
        怪物重生: st.monsterRespawns,
        玩家倒地: st.playerDowns,
        玩家受擊: this.combat.hitsTaken,
      },
      at: new Date().toISOString(),
      userAgent: navigator.userAgent,
    };
    a.result = result;
    try {
      const all = JSON.parse(window.localStorage.getItem(AUTOPLAY_STORAGE_KEY) ?? "{}") as Record<string, AutoplayResult>;
      all[autoplayKey(result)] = result;
      window.localStorage.setItem(AUTOPLAY_STORAGE_KEY, JSON.stringify(all));
    } catch {
      /* 無法儲存時只顯示本次結果 */
    }
    a.banner?.remove();
    a.banner = null;
    const el = document.createElement("div");
    el.className = "autoplay-result";
    el.setAttribute(
      "style",
      "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;max-width:94vw;max-height:90vh;overflow:auto;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.96);color:#223;font:12px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);user-select:text;-webkit-user-select:text",
    );
    const row = document.createElement("div");
    row.setAttribute("style", "display:flex;gap:8px;margin-bottom:8px");
    for (const [label, fn] of [["重新測試", () => location.reload()], ["關閉", () => el.remove()]] as const) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.setAttribute("style", "padding:7px 12px;border-radius:10px;border:0;background:#8a7cf0;color:#fff;font:600 13px system-ui,sans-serif");
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
      });
      row.appendChild(b);
    }
    el.appendChild(row);
    const title = document.createElement("div");
    title.style.fontWeight = "700";
    title.textContent = "🎮 實際遊玩壓力測試結果";
    el.appendChild(title);
    for (const t of formatAutoplay(result)) {
      const d = document.createElement("div");
      d.textContent = t;
      el.appendChild(d);
    }
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    document.body.appendChild(el);
  }

  /** 效能測試進行中（載入、暖機、測量）：暫停操作、AI 與戰鬥 */
  private get benchLocked(): boolean {
    return this.benchRun !== null && this.benchRun.phase !== "done";
  }

  /**
   * 效能測試：怪物停在固定位置播放待機（不跑 AI、不戰鬥），其餘與 MonsterController.update 相同
   * （動畫器 → 位置 → 進入狀態 → 姿勢 → 視覺更新）。
   */
  private updateMonstersHeld(dt: number): void {
    for (const m of this.monsters) {
      const frame = m.animator.update(dt);
      const v = m.visual;
      if (!v) continue;
      const p = m.instance.currentPosition;
      v.setTransform(p.x, p.y, p.z, m.instance.yaw);
      for (const st of frame.entered) v.onStateEnter(st);
      v.applyPose(frame.pose);
      v.update(dt);
    }
  }

  /** ?bench=1：等模型載入 → 固定場景 → 暖機 → 測量 → 顯示結果 */
  private async startBench(hudRoot: HTMLElement): Promise<void> {
    const opts = this.benchOpts!;
    const banner = document.createElement("div");
    banner.className = "bench-banner";
    banner.setAttribute("style", "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:50;padding:6px 14px;border-radius:12px;background:rgba(30,30,60,.72);color:#fff;font:600 13px/1.4 system-ui,sans-serif;pointer-events:none;white-space:nowrap");
    // 測量期間不更新這段文字（不增加額外成本）
    banner.textContent = `效能測試中（暖機 ${opts.warmup} 秒＋測量 ${opts.seconds} 秒），請勿觸碰畫面`;
    hudRoot.appendChild(banner);
    this.benchRun = { phase: "loading", rec: null, activeSum: 0, activeMax: 0, activeN: 0, result: null, banner };
    await Promise.all(this.monsters.map((m) => m.visual?.load() ?? Promise.resolve()));
    await this.scene.whenReadyAsync();
    this.stageBench();
    this.benchRun.rec = new FrameRecorder(opts.seconds, opts.warmup);
    this.benchRun.phase = "warmup";
  }

  /** 固定場景：玩家在出生點、鏡頭預設角度、3 隻怪物在鏡頭前固定位置面向鏡頭、解析度固定為畫質上限 */
  private stageBench(): void {
    this.input.moveOverride = null;
    this.position.set(0, heightAt(0, 0), 0);
    this.yaw = 0;
    this.player.root.position.copyFrom(this.position);
    this.player.root.rotation.set(0, 0, 0);
    const c = TUNING.camera;
    this.camera.snap(this.position, -Math.PI / 2, c.defaultBeta, c.distance);
    const fy = this.camera.forwardYaw;
    const fx = Math.sin(fy), fz = Math.cos(fy);
    this.monsters.forEach((m, i) => {
      const [f, r] = BENCH_SPOTS[i % BENCH_SPOTS.length]!;
      const x = fx * f + fz * r, z = fz * f - fx * r;
      const p = m.instance.currentPosition;
      p.x = x;
      p.z = z;
      p.y = heightAt(x, z);
      m.instance.yaw = fy + Math.PI;
      m.instance.setLocomotion(false);
      m.visual?.setTransform(p.x, p.y, p.z, m.instance.yaw);
      if (m.visual instanceof BoboV38RVisual) m.visual.snap();
    });
    this.lockRing.setEnabled(false);
    this.perfOverlay.lockResolution(this.benchOpts?.res ?? Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio));
    this.engine.resize();
  }

  /** 每幀（繪製之後）：記錄實際影格時間與 Draw Calls；不建立物件、不更新畫面文字 */
  private benchFrame(): void {
    const b = this.benchRun!;
    if (!b.rec || b.phase === "done") return;
    const rawDt = this.engine.getDeltaTime() / 1000;
    const done = b.rec.record(rawDt, this.perfOverlay.drawCalls);
    if (b.rec.progress * (this.benchOpts!.seconds + this.benchOpts!.warmup) > this.benchOpts!.warmup) {
      // 進入測量的那一幀：丟掉暖機期間的分段計時
      if (b.phase === "warmup") this.profiler?.takeWindow();
      b.phase = "measuring";
      const active = this.scene.getActiveMeshes().length;
      b.activeSum += active;
      b.activeN++;
      if (active > b.activeMax) b.activeMax = active;
    }
    if (done) this.finishBench();
  }

  private finishBench(): void {
    const b = this.benchRun!;
    b.phase = "done";
    const counts = this.resourceCounts();
    const result: BenchResult = {
      variant: this.boboVariant,
      quality: this.quality.level,
      pixelRatio: Math.round((1 / this.engine.getHardwareScalingLevel()) * 100) / 100,
      devicePixelRatio: window.devicePixelRatio || 1,
      width: this.engine.getRenderWidth(),
      height: this.engine.getRenderHeight(),
      warmup: this.benchOpts!.warmup,
      summary: b.rec!.summary(),
      avgActiveMeshes: b.activeN ? b.activeSum / b.activeN : 0,
      maxActiveMeshes: b.activeMax,
      meshes: counts.meshes,
      materials: counts.materials,
      textures: counts.textures,
      monsters: this.monsters.length,
      ...(this.benchOpts!.res !== null ? { resOverride: this.benchOpts!.res } : {}),
      ...(experimentTag(this.experiments) ? { experiment: experimentTag(this.experiments) } : {}),
      ...(this.benchOpts!.profile && this.profiler ? { profile: this.profiler.takeWindow() } : {}),
      at: new Date().toISOString(),
      userAgent: navigator.userAgent,
    };
    b.result = result;
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    const all = saveResult(storage, result);
    b.banner?.remove();
    b.banner = null;
    this.showBenchResult(result, all);
    // 測試結束：解除固定解析度，遊戲恢復正常
    this.perfOverlay.lockResolution(null);
  }

  private showBenchResult(r: BenchResult, all: Record<string, BenchResult>): void {
    const el = document.createElement("div");
    el.className = "bench-result";
    el.setAttribute(
      "style",
      "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;max-width:94vw;max-height:90vh;overflow:auto;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.96);color:#223;font:12px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);user-select:text;-webkit-user-select:text",
    );
    const line = (t: string, bold = false): void => {
      const d = document.createElement("div");
      d.textContent = t;
      if (bold) d.style.fontWeight = "700";
      el.appendChild(d);
    };
    // 按鈕放在最上方：手機橫向畫面較矮時也不必捲動
    const row = document.createElement("div");
    row.setAttribute("style", "display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px");
    el.appendChild(row);
    line("⏱ 效能測試結果（10 秒）".replace("10", String(this.benchOpts!.seconds)), true);
    for (const t of formatResult(r)) line(t);
    const expCmp = compareExperimentRows(all[`${r.variant}_${r.quality}`], r);
    const cmp = r.experiment ? expCmp : compareRows(all[`v2_${r.quality}`], all[`v38r_${r.quality}`]);
    if (r.experiment && !expCmp) {
      line("（同外觀、同畫質的目前預設尚未測試：去掉網址中的 opt／diag／shadowq 參數測一次後，會顯示比較）");
    } else if (cmp) {
      el.appendChild(document.createElement("hr"));
      cmp.forEach((t, i) => line(t, i === 0));
    } else {
      line(`（同畫質的${r.variant === "v2" ? " V3.8R" : " V2"} 尚未測試，按下方按鈕測試後會顯示比較）`);
    }
    const btn = (label: string, onClick: () => void): void => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.setAttribute("style", "padding:7px 12px;border-radius:10px;border:0;background:#8a7cf0;color:#fff;font:600 13px system-ui,sans-serif");
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
      });
      row.appendChild(b);
    };
    btn("測 V2", () => location.replace(benchUrl(location.href, "v2")));
    btn("測 V3.8R", () => location.replace(benchUrl(location.href, "v38r")));
    btn("重新測試", () => location.reload());
    btn("關閉", () => el.remove());
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    document.body.appendChild(el);
  }

  /** 場景資源數（Stage 5 資源檢查用） */
  private resourceCounts(): { meshes: number; materials: number; textures: number; geometries: number; sprites: number } {
    const sc = this.scene;
    return {
      meshes: sc.meshes.length,
      materials: sc.materials.length,
      textures: sc.textures.length,
      geometries: sc.geometries.length,
      sprites: sc.spriteManagers?.reduce((a, m) => a + m.sprites.length, 0) ?? 0,
    };
  }

  private updateBars(): void {
    this.hud.setBars({ hp: this.combat.hp, maxHp: PREVIEW_COMBAT.playerMaxHp, mp: 50, maxMp: 50, exp: 0, expToNext: 100 });
  }

  private attackTarget(): MonsterController | null {
    if (!this.attackTargetId) return null;
    const m = this.monsters.find((x) => x.instance.instanceId === this.attackTargetId);
    return m && m.instance.isAlive ? m : null;
  }

  /** 按下攻擊：通過冷卻與目標檢查後播放攻擊動作；傷害在動作揮中時（ATTACK_TIMING.hit）結算 */
  private playerAttack(): AttackStartResult {
    // 效能測試進行中：不接受攻擊（任何途徑）
    if (this.benchLocked) return { ok: false, reason: "down" };
    const r = this.combat.startAttack(this.now, this.position.x, this.position.z, this.monsters.map((m) => m.instance), ATTACK_TIMING.hit - 1e-6);
    if (r.ok) {
      this.attackTargetId = r.targetId;
      this.player.playAttack();
      this.attackTrace = { phases: [], maxBack: 0, maxFwd: 0, maxLean: 0, hitPhase: null, hitElapsed: null };
    }
    return r;
  }

  private handleAttack(r: AttackStartResult): void {
    if (r.ok) return; // 傷害提示在揮中時顯示
    if (r.reason === "no-target") {
      this.hud.toast("攻擊範圍內沒有怪物，請再靠近一點", 1100);
    } else if (r.reason === "down") {
      this.hud.toast("倒地中…", 800);
    }
  }

  private handleHit(r: PlayerAttackResult): void {
    this.lastHit = r;
    this.attackTrace.hitPhase = this.player.attackPose.phase;
    this.attackTrace.hitElapsed = this.player.attackElapsed;
    if (r.ok) {
      this.hits++;
      const m = this.monsters.find((x) => x.instance.instanceId === r.targetId)!;
      const i = m.instance;
      this.hud.toast(
        r.killed ? `擊敗${i.definition.name}！（測試：不給經驗、不掉寶）` : `${i.definition.name} -${r.damage}（HP ${i.currentHp}/${i.definition.maxHp}）`,
        1100,
      );
    } else if (r.reason === "miss") {
      this.hud.toast("沒打中（目標離開了）", 800);
    }
  }

  private updateMonsters(dt: number): void {
    // 攻擊揮中的瞬間結算傷害（與動作同步）
    const pend = this.combat.pendingAttack;
    const pendTarget = pend && this.now >= pend.hitAt ? this.monsters.find((m) => m.instance.instanceId === pend.targetId) : undefined;
    const hpBefore = pendTarget ? pendTarget.instance.currentHp : 0;
    const hit = this.combat.resolvePending(this.now, this.position.x, this.position.z, this.monsters.map((m) => m.instance));
    if (hit) {
      this.handleHit(hit);
      if (this.autoRun?.phase === "running") this.autoRun.stats.hit(hit.ok, pendTarget ? hpBefore - pendTarget.instance.currentHp : 0, hpBefore, PREVIEW_COMBAT.playerAttackDamage);
    }
    if (this.combat.update(this.now)) {
      if (this.autoRun) this.autoRun.revived = true;
      // 測試規則：倒地 2 秒後回出生點、HP 全滿
      this.position.set(0, heightAt(0, 0), 0);
      this.player.root.position.copyFrom(this.position);
      this.hud.toast("已在出生點復活（測試規則）", 1500);
      this.updateBars();
    }
    const target: MonsterTarget = { id: "player", x: this.position.x, z: this.position.z, alive: !this.combat.isDown };
    for (const m of this.monsters) {
      const p = m.instance.currentPosition;
      p.y = heightAt(p.x, p.z);
      const frame = m.update(dt, this.now, target);
      p.y = heightAt(p.x, p.z);
      // 命中判定：同一個 attackId 只結算一次；命中前被受傷／死亡打斷的攻擊已取消，不會結算
      if (frame.effects.includes("attackImpact") && m.instance.claimAttackImpact() !== null) {
        const dmg = this.combat.monsterImpact(this.now, m.instance, this.position.x, this.position.z);
        if (dmg > 0) {
          this.updateBars();
          this.hud.toast(this.combat.isDown ? "你倒下了…（測試規則：2 秒後復活）" : `受到${m.instance.definition.name}攻擊 -${dmg}`, 1000);
        }
      }
    }
    // 怪物彼此保持間距、不擠進玩家身體（只調整位置，AI 與數值不變）
    const alive = this.monsters.filter((m) => m.instance.isAlive).map((m) => m.instance.currentPosition);
    separate(alive, 1.0, { x: this.position.x, z: this.position.z, minDist: 0.85 });
    for (const p of alive) p.y = heightAt(p.x, p.z);
    // 鎖定標記
    const locked = this.combat.lockTarget(this.position.x, this.position.z, this.monsters.map((m) => m.instance));
    this.lockedId = locked?.instanceId ?? null;
    if (locked) {
      const p = locked.currentPosition;
      this.lockRing.position.set(p.x, heightAt(p.x, p.z) + 0.03, p.z);
      this.lockRing.rotation.y += dt * 1.5;
    }
    this.lockRing.setEnabled(locked !== null);
  }

  private installPlatformGuards(): void {
    const resize = (): void => this.engine.resize();
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.addEventListener("orientationchange", () => window.setTimeout(resize, 250));

    // iOS Safari：阻止雙指縮放網頁、雙擊放大、長按選單
    const block = (e: Event): void => e.preventDefault();
    document.addEventListener("gesturestart", block, { passive: false });
    document.addEventListener("gesturechange", block, { passive: false });
    document.addEventListener("dblclick", block, { passive: false });
    document.addEventListener("touchmove", block, { passive: false });
    document.addEventListener("contextmenu", block);

    // 切到背景時暫停，省電也避免回來時時間差過大
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stop();
      else this.start();
    });

    this.engine.onContextLostObservable.add(() => {
      this.hud.toast("顯示卡內容遺失，正在嘗試恢復…", 3000);
    });
  }

  private installDebugApi(): void {
    window.__starwish = {
      ready: true,
      getPlayer: () => ({ x: this.position.x, y: this.position.y, z: this.position.z, yaw: this.yaw }),
      getCamera: () => ({ alpha: this.camera.camera.alpha, beta: this.camera.camera.beta, radius: this.camera.camera.radius }),
      setMove: (m) => {
        this.input.moveOverride = m;
      },
      hudIssues: (insets) => checkHud(document, insets),
      fps: () => this.engine.getFps(),
      pixelStats: () =>
        new Promise((resolve, reject) => {
          this.scene.onAfterRenderObservable.addOnce(() => {
            const w = this.engine.getRenderWidth();
            const h = this.engine.getRenderHeight();
            this.engine
              .readPixels(0, 0, w, h)
              .then((view) => {
                const data = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
                const colors = new Set<number>();
                let opaque = 0;
                let samples = 0;
                for (let i = 0; i + 3 < data.length; i += 4 * 211) {
                  samples++;
                  if (data[i + 3]! > 200) opaque++;
                  colors.add(((data[i]! >> 3) << 10) | ((data[i + 1]! >> 3) << 5) | (data[i + 2]! >> 3));
                }
                resolve({ samples, distinctColors: colors.size, opaqueRatio: samples ? opaque / samples : 0 });
              })
              .catch(reject);
          });
        }),
      consumeTime: () => {
        const r = { frames: this.timeFrames, seconds: this.timeSum, maxDt: this.timeMax, minDt: this.timeFrames ? this.timeMin : 0 };
        this.timeFrames = 0;
        this.timeSum = 0;
        this.timeMax = 0;
        this.timeMin = Infinity;
        return r;
      },
      perf: () => ({
        ...this.perfOverlay.stats(),
        postProcess: this.render.pipeline !== null,
        bloom: this.render.glow !== null && this.render.glow.isEnabled,
        shadowFilter: this.quality.shadows.filter,
        shadowMap: this.quality.shadows.mapSize,
      }),
      // Stage 5.1：V3.8R 適配器檢查（資源只載入一次、每隻材質獨立、移除一隻不釋放共用資源）
      bobo: async () => {
        const assets = await Promise.all(BoboV38RSceneAssets.loaded(this.scene));
        return {
          variant: this.boboVariant,
          modelId: BOBO_MODEL_IDS[this.boboVariant],
          loadedAssets: assets.map((a) => ({ file: a.handle.file, lod: a.lod, live: a.liveCount, refs: a.refCount })),
          visuals: this.monsters.map((m) => {
            const v = m.visual;
            if (!(v instanceof BoboV38RVisual)) return { kind: v?.kind ?? null, v38r: false };
            const root = v.model?.root;
            const meshes = root ? root.getChildMeshes(false) : [];
            const body = meshes.find((x) => x.name.includes("Body_"));
            return {
              kind: v.kind,
              v38r: true,
              loaded: v.loaded,
              bodyMaterial: body?.material?.name ?? null,
              bodyMaterialId: body?.material?.uniqueId ?? null,
              geometryId: (body as unknown as { geometry?: { uniqueId: number } } | undefined)?.geometry?.uniqueId ?? null,
              position: root ? root.position.asArray() : null,
              enabled: root ? root.isEnabled() : false,
            };
          }),
          scene: this.resourceCounts(),
        };
      },
      stageBoboPhoto: (opts = {}) => {
        this.photoMode = true;
        this.input.moveOverride = null;
        this.position.set(0, heightAt(0, 0), 0);
        this.yaw = 0;
        this.player.root.position.copyFrom(this.position);
        this.player.root.rotation.set(0, 0, 0);
        const c = TUNING.camera;
        this.camera.snap(this.position, -Math.PI / 2, c.defaultBeta, c.distance);
        const fy = this.camera.forwardYaw;
        const fx = Math.sin(fy), fz = Math.cos(fy);
        const rx = fz, rz = -fx;
        // 左、中、右；中間那隻稍遠，避免被玩家擋住
        const spots: [number, number][] = [[2.7, -1.15], [3.4, 0], [2.7, 1.15]];
        this.monsters.forEach((m, i) => {
          const [f, r] = spots[i % spots.length]!;
          const x = fx * f + rx * r, z = fz * f + rz * r;
          const p = m.instance.currentPosition;
          p.x = x;
          p.z = z;
          p.y = heightAt(x, z);
          m.instance.yaw = fy + Math.PI; // 面向鏡頭
          m.visual?.setTransform(p.x, p.y, p.z, m.instance.yaw);
          m.visual?.setFace("normal");
          if (m.visual instanceof BoboV38RVisual) m.visual.snap();
        });
        if (this.render.glow && opts.glow !== undefined) this.render.glow.isEnabled = opts.glow;
        this.perfOverlay.lockResolution(this.quality.maxPixelRatio);
        this.engine.resize();
        // 畫面位置（CSS 像素）：身體中心、眼睛中心
        const cam = this.camera.camera;
        const w = this.engine.getRenderWidth(), h = this.engine.getRenderHeight();
        const k = (this.engine.getRenderingCanvas()?.clientWidth ?? w) / w;
        const vp = cam.viewport.toGlobal(w, h);
        this.scene.render();
        const proj = (v: Vector3): [number, number] => {
          const o = Vector3.Project(v, Matrix.Identity(), this.scene.getTransformMatrix(), vp);
          return [o.x * k, o.y * k];
        };
        const shots = this.monsters.map((m) => {
          const root = (m.visual as unknown as { model?: { root?: TransformNode } } | null)?.model?.root;
          const meshes = root ? root.getChildMeshes(false) : [];
          const find = (pre: string) => meshes.find((x) => x.name.startsWith(pre) || x.name.includes(pre));
          const center = (pre: string): [number, number] | null => {
            const me = find(pre);
            if (!me) return null;
            me.computeWorldMatrix(true);
            me.refreshBoundingInfo({});
            return proj(me.getBoundingInfo().boundingBox.centerWorld);
          };
          const bb = (pre: string): number[] | null => {
            const me = find(pre);
            if (!me) return null;
            const box = me.getBoundingInfo().boundingBox;
            const pts = box.vectorsWorld.map(proj);
            return [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))];
          };
          return { id: m.instance.instanceId, body: center("Body_"), eyes: center("Eyes"), bodyBox: bb("Body_"), eyesBox: bb("Eyes") };
        });
        return {
          quality: this.quality.level,
          variant: this.boboVariant,
          glow: this.render.glow ? this.render.glow.isEnabled : null,
          pixelRatio: 1 / this.engine.getHardwareScalingLevel(),
          shots,
        };
      },
      stageShadowPhoto: () => {
        this.photoMode = true;
        this.input.moveOverride = null;
        const trees = this.world.props.filter((p) => p.kind === "tree");
        let tree = trees[0]!;
        for (const t of trees) if (Math.hypot(t.x, t.z) < Math.hypot(tree.x, tree.z)) tree = t;
        const c = TUNING.camera;
        // 鏡頭從玩家後方看向樹：玩家站在樹與鏡頭之間、距離樹 4.5 公尺
        const fy = this.camera.forwardYaw;
        const fx = Math.sin(fy), fz = Math.cos(fy);
        const px = tree.x - fx * 4.5, pz = tree.z - fz * 4.5;
        this.position.set(px, heightAt(px, pz), pz);
        this.yaw = fy;
        this.player.root.position.copyFrom(this.position);
        this.player.root.rotation.set(0, fy, 0);
        this.camera.snap(this.position, this.camera.camera.alpha, c.defaultBeta, c.distance);
        this.perfOverlay.lockResolution(this.quality.maxPixelRatio);
        this.engine.resize();
        return { tree: { x: tree.x, z: tree.z }, player: { x: px, z: pz } };
      },
      stabilityCheck: (ms) => {
        const grab = (): Promise<Uint8Array> =>
          new Promise((resolve, reject) => {
            this.scene.onAfterRenderObservable.addOnce(() => {
              this.engine
                .readPixels(0, 0, this.engine.getRenderWidth(), this.engine.getRenderHeight())
                .then((v) => resolve(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))))
                .catch(reject);
            });
          });
        return grab().then(
          (a) =>
            new Promise((resolve, reject) => {
              window.setTimeout(() => {
                grab()
                  .then((b) => {
                    let changed = 0;
                    let maxDelta = 0;
                    const n = Math.min(a.length, b.length);
                    for (let i = 0; i + 3 < n; i += 4) {
                      const d = Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!));
                      if (d > 0) changed++;
                      if (d > maxDelta) maxDelta = d;
                    }
                    resolve({ pixels: n / 4, changed, maxDelta });
                  })
                  .catch(reject);
              }, ms);
            }),
        );
      },
      autoplayState: () => {
        const a = this.autoRun;
        return a ? { phase: a.phase, elapsed: a.stats.elapsed, result: a.result } : null;
      },
      renderExperiments: () => ({
        tag: experimentTag(this.experiments),
        labels: experimentLabels(this.experiments),
        shadowQuality: this.shadowGen.filteringQuality,
        msaa: this.render.pipeline ? this.render.pipeline.samples : 0,
        hdr: this.render.pipeline ? this.experiments.diag !== "nohdr" : null,
        shadowEnabled: this.sun.shadowEnabled,
      }),
      debugInfo: () => (this.debugOn ? (this.debugLast ?? this.collectDebugInfo()) : null),
      resetTest: () => this.resetTest(),
      renderBreakdown: () => {
        const groups: Record<string, number> = {};
        let tris = 0;
        const act = this.scene.getActiveMeshes();
        for (let i = 0; i < act.length; i++) {
          const m = act.data[i]!;
          const n = m.name;
          const g = n.startsWith("BoboV38RGame") || /^(Body_|Eyes|Mouth|Blush|Stars)/.test(n) ? "怪物 V3.8R" : n.startsWith("PH_") ? "玩家／介面" : /bobo|Bobo/.test(n) ? "怪物 V2" : "草原與天空";
          groups[g] = (groups[g] ?? 0) + 1;
          tris += Math.floor((m.getTotalIndices?.() ?? 0) / 3) * Math.max(1, (m as unknown as { thinInstanceCount?: number }).thinInstanceCount ?? 1);
        }
        const casters = this.shadowGen.getShadowMap()?.renderList?.length ?? 0;
        return {
          pixelRatio: Math.round((1 / this.engine.getHardwareScalingLevel()) * 100) / 100,
          renderSize: [this.engine.getRenderWidth(), this.engine.getRenderHeight()],
          postProcess: { enabled: this.render.pipeline !== null, msaaSamples: this.quality.msaaSamples, fxaa: this.quality.fxaa },
          glow: { exists: this.render.glow !== null, enabled: this.render.glow?.isEnabled ?? false },
          shadow: { mapSize: this.quality.shadows.mapSize, casters, filter: this.quality.shadows.filter },
          renderTargets: this.scene.customRenderTargets.length + (this.shadowGen.getShadowMap() ? 1 : 0),
          activeByGroup: groups,
          trianglesActive: tris,
        };
      },
      benchState: () => {
        const b = this.benchRun;
        if (!b) return null;
        let saved: string[] = [];
        try {
          saved = Object.keys(loadResults(window.localStorage));
        } catch {
          saved = [];
        }
        return { phase: b.phase, progress: b.rec ? b.rec.progress : 0, result: b.result, saved };
      },
      boboAdapterSelfTest: async () => {
        if (this.boboVariant !== "v38r") return { skipped: true };
        const before = this.resourceCounts();
        const v = new BoboV38RVisual({ scene: this.scene, baseUrl: `${import.meta.env.BASE_URL}models/`, lod: this.quality.level });
        await v.load();
        v.setTransform(0, -50, 0, 0);
        const during = this.resourceCounts();
        v.dispose();
        const after = this.resourceCounts();
        const assets = await Promise.all(BoboV38RSceneAssets.loaded(this.scene));
        return { skipped: false, before, during, after, sharedAlive: assets.map((a) => !a.isDisposed && a.handle.container.textures.every((t) => !!t.getInternalTexture())) };
      },
      monsters: () =>
        this.monsters.map((m) => {
          const i = m.instance;
          // 是否真的在畫面內：模型任何一個啟用中的網格位於攝影機視錐內
          const root = (m.visual as unknown as { model?: { root?: TransformNode } } | null)?.model?.root;
          const inView = root
            ? root.getChildMeshes(false).some((me) => me.isEnabled() && me.isVisible && this.camera.camera.isInFrustum(me))
            : false;
          return {
            id: i.instanceId,
            state: i.sm.state,
            mode: m.brain?.mode ?? "idle",
            hp: i.currentHp,
            maxHp: i.definition.maxHp,
            x: i.currentPosition.x,
            y: i.currentPosition.y,
            z: i.currentPosition.z,
            spawnX: i.spawnPosition.x,
            spawnZ: i.spawnPosition.z,
            visible: inView,
            stateTime: i.sm.stateTime,
            attackId: i.attackId,
            attackLog: { ...i.attackLog },
            cooldown: i.cooldownRemaining(this.now),
            anim: m.visual instanceof BoboV38RVisual ? m.visual.debugState() : null,
          };
        }),
      damageMonster: (id, amount) => {
        const m = this.monsters.find((x) => x.instance.instanceId === id);
        return m ? m.instance.receiveDamage(amount) : null;
      },
      attack: () => {
        const r = this.playerAttack();
        this.handleAttack(r);
        return r;
      },
      attackState: () => {
        const a = this.player.attackPose;
        const t = this.attackTarget();
        let facingError: number | null = null;
        if (t) {
          const want = Math.atan2(t.instance.currentPosition.x - this.position.x, t.instance.currentPosition.z - this.position.z);
          facingError = Math.abs(Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw)));
        }
        return {
          phase: a.phase,
          attacking: this.player.attacking,
          started: this.player.attacksStarted,
          armRX: a.armRX,
          lean: a.lean,
          facingError,
          lastHit: this.lastHit,
          hits: this.hits,
          trace: { ...this.attackTrace, phases: [...this.attackTrace.phases] },
        };
      },
      combat: () => ({
        hp: this.combat.hp,
        maxHp: PREVIEW_COMBAT.playerMaxHp,
        down: this.combat.isDown,
        hitsTaken: this.combat.hitsTaken,
        lockedId: this.lockedId,
        tilt: Math.abs(this.player.root.rotation.x),
      }),
      knockDown: () => {
        this.combat.debugKnockDown(this.now);
        this.updateBars();
        this.hud.toast("你倒下了…（測試規則：2 秒後復活）", 1500);
      },
      teleport: (x, z) => {
        this.position.set(x, heightAt(x, z), z);
        this.player.root.position.copyFrom(this.position);
      },
      renderer: () => ({
        webgl: this.engine.webGLVersion,
        hardwareScaling: this.engine.getHardwareScalingLevel(),
        width: this.engine.getRenderWidth(),
        height: this.engine.getRenderHeight(),
      }),
    };
  }
}
