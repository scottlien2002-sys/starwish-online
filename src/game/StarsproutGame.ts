import {
  Color3,
  DirectionalLight,
  type Engine,
  HemisphericLight,
  type Mesh,
  MeshBuilder,
  Frustum,
  Plane,
  ReflectionProbe,
  RenderTargetTexture,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { TUNING } from "../config/tuning.ts";
import { InputState } from "../input/InputState.ts";
import { VirtualJoystick } from "../input/VirtualJoystick.ts";
import { CameraTouchControl } from "../input/CameraTouchControl.ts";
import { KeyboardInput } from "../input/KeyboardInput.ts";
import { Hud } from "../ui/Hud.ts";
import { inputToWorld, turnTowards } from "../actors/movement.ts";
import { ThirdPersonCamera } from "../camera/ThirdPersonCamera.ts";
import { SKY_COLORS, createEngine, createShadows, createSkyDome, pickQuality, setupRendering, type RenderSetup } from "../render/RenderQuality.ts";
import { PerfOverlay } from "../render/PerfOverlay.ts";
import type { QualitySettings } from "../render/quality.ts";
import { summarizeFrames } from "../render/benchmark.ts";
import { MAIN_ROUTE, ZONES } from "../maps/starsprout/layout.ts";
import { StarsproutTerrain, resolveMove, type Collider } from "../maps/starsprout/terrain.ts";
import { MAP_COLLIDERS, PLAYER_RADIUS } from "../maps/starsprout/route.ts";
import { buildStarsproutWorld, type MapLod, type StarsproutWorld } from "../maps/starsprout/StarsproutWorld.ts";
import { VEG_HQ, VEG_LITE, buildVegetation } from "../maps/starsprout/vegetation.ts";
import { buildVegetationView, type VegetationView } from "../maps/starsprout/StarsproutVegetation.ts";
import { propColliders, propExclusions } from "../maps/starsprout/props.ts";
import { buildPropsView, type PropsView } from "../maps/starsprout/StarsproutProps.ts";
import { CameraObstacleQuery, cameraObstaclesFrom } from "../maps/starsprout/cameraObstacles.ts";
import { createMonsterRegistry, MonsterFactory, type MonsterController, type MonsterInstance } from "../monsters/framework/index.ts";
import type { MonsterTarget } from "../monsters/framework/types.ts";
import { registerBabylonVisuals } from "../monsters/babylon/registerVisuals.ts";
import { BOBO_MODEL_IDS, BOBO_PROFILE_IDS } from "./boboVariant.ts";
import { PreviewCombat, separate, type PlayerAttackResult } from "./previewCombat.ts";
import { combatTuningFromStats, FIELD_TEST, zoneSpawnPoints } from "./fieldRules.ts";
import { FieldLoot, type LootDrop } from "./fieldLoot.ts";
import { modularAvailable, NoviceAvatar, type CharShadowMode, type NoviceGender, type NoviceLod } from "../characters/NoviceAvatar.ts";
import { runRate } from "../actors/animTiming.ts";
import { createRng } from "../core/rng.ts";
import { CORE_RULES } from "../core/rules.ts";
import petCfgJson from "../config/pets.json";
import { affixText, bonusScale, canEvolve, ITEM_IDS, stageCount, type CharacterStats, type FeedId, type ItemId, type PetConfig, type PetSourceId } from "../pets/petSystem.ts";
import { PetManager } from "../pets/PetManager.ts";
import { PetFollower } from "../pets/PetFollower.ts";
import { createPetMerchantService, type PetMerchantService } from "../pets/petMerchantAdapter.ts";
import { createPetAppraisalService, type PetAppraisalService } from "../pets/petAppraisalService.ts";
import { isSoul } from "../pets/petSystem.ts";
import type { WorldSession } from "./worldSession.ts";
import { WorldPanel } from "../ui/WorldPanel.ts";
import { MODEL_LOD_LABEL, pickModelLod } from "./modelLod.ts";
import { expToNext, gainExp } from "../core/progression.ts";
import { FieldCombatFx } from "./fieldCombatFx.ts";
import { contactShadowQuality, renderExperimentsFromSearch } from "../render/renderExperiments.ts";
import { type DetailTier, detailFor, pickTier, sphereInFrustum } from "./monsterDetail.ts";
import { FieldKnockback } from "./fieldKnockback.ts";
import { FieldTerrainQuery } from "./fieldTerrainQuery.ts";
import { isAggressive } from "../monsters/framework/types.ts";
import { defaultAppearance } from "../core/gameSave.ts";
import { FIELD_RIGGED_SPAWNS } from "../monsters/rigged/riggedSpec.ts";
import { riggedAssetAvailable, RiggedMonsterVisual } from "../monsters/rigged/RiggedMonsterVisual.ts";
import { NOVICE_VERSION } from "./noviceVersion.ts";
import { MpFieldCombat } from "../net/MpFieldCombat.ts";
import { applyNoviceLook, type AppliedLook } from "../net/mpAppearance.ts";
import { FIELD_CAMP_ARRIVAL } from "../maps/village/mapLinks.ts";
import { PortalTrigger } from "./portalTrigger.ts";
import { registerStarsprout } from "../../multiplayer/shared/maps.ts";
import { FIELD_CAMP_PORTAL } from "./worldPortals.ts";
import { buildCampPortal, type CampPortal } from "./CampPortal.ts";
import { RESPAWN_SLOTS } from "../maps/village/layout.ts";
import { nextLootUid } from "../core/gameSave.ts";
import { rollGold } from "../economy/economyConfig.ts";

/**
 * Stage 5.6 正式遊戲整合（?play=starsprout）：男女初心者在星芽原野實際遊玩。
 * - 地圖：已驗收的星芽原野（地形、植被、營地、胡蘿蔔園、碰撞、鏡頭避障；地圖檔案不修改）
 * - 角色：C1.0-B5 系列 GLB（骨架＋Idle／Run／Jump／Attack／Hurt），移動 5 m/s、跑步動畫依速度調整
 * - 怪物：星露草坪 6 隻星露啵啵 V3.8R（已驗收的 AI、狀態機、命中規則）；其他 6 種怪物還沒有模型，不放替代品
 * - 戰鬥：攻擊 0.5 秒一下、0.2 秒命中，依攻速加快（上限 160）；數值為「測試設定」（fieldRules.ts）
 * - 掉落、背包、寵物（孵化、時間成長、餵食、進化、方案 A 鑑定、裝備、跟隨、屬性加成）
 * - 寵物設定：預設用明確標示的「測試設定」；&pets=official 使用正式設定（缺值時寵物停用、遊戲照常）
 * 網址：&g=female、&lod=lite、&charshadow=realtime、&p3=0、&ver=c10b5、&autoplay=fight&duration=60
 */

const ITEM_LABEL: Record<ItemId, string> = { seed: "種子", egg: "孵化蛋", birdEgg: "鳥蛋", monsterMaterial: "怪物材料", shopFeed: "商店飼料" };
const ITEM_COLOR: Record<ItemId, string> = { seed: "#7bd96a", egg: "#fff3d6", birdEgg: "#9fd3ff", monsterMaterial: "#c79bff", shopFeed: "#ffcf6b" };
const SAVE_KEY = "starwish.stage56.pets.v1";
const ZONE01 = ZONES.find((z) => z.id === "01")!;
/** 羽風高地（Lv.7 風羽狐，上限 4 隻；layout 既定） */
const START = MAIN_ROUTE[0]!;

export interface PlayApi {
  ready: boolean;
  info(): {
    gender: NoviceGender;
    lod: NoviceLod;
    file: string;
    /** Stage 7.2：角色模型（新版 Tripo 模組化／上一版） */
    avatarModel: { modular: boolean; weapon: string | null; bones: number; triangles: number; parts: { kind: string; file: string; meshes: number; remapped: boolean }[]; clips: string[]; attackClips: string[] };
    state: string;
    pos: number[];
    hp: number;
    maxHp: number;
    down: boolean;
    speed: number;
    runRate: number;
    slide: number;
    attack: { interval: number; hitAt: number; attackSpeed: number; damage: number };
    stats: CharacterStats;
    kills: number;
    hits: number;
    /** 遊戲時間（秒；每幀最多前進 0.1 秒，低 FPS 時比實際時間慢） */
    gameTime: number;
    drops: number;
    picked: number;
    loot: number;
    monsters: ({ id: string; state: string; hp: number; x: number; z: number } & Record<string, unknown>)[];
    /** Stage 7.2：羽風高地的怪物狀態 */
    foxStatus: string;
    /** Stage 7.2：原野各區的骨骼動畫怪物（已交付／未交付） */
    fieldMonsters: { zone: string; zoneName: string; monster: string; delivered: boolean; count: number; status: string }[];
    /** Stage 7.4：怪物距離分級（各等級隻數） */
    monsterDetail: { on: boolean; near: number; mid: number; far: number; hidden: number; offscreen: number };
    /** Stage 7.3：戰鬥特效計數 */
    combatFx: { tier: string; hitFx: number; numbers: number; hurt: number; respawnFx: number; damageShown: number; knockbacks: number; knockSkipped: number } | null;
    pets: { enabled: boolean; mode: string; reason: string; items: Record<ItemId, number>; count: number; equipped: number | null; followerVisible: boolean; followerDist: number };
    render: { p3: boolean; pipeline: boolean; charShadow: CharShadowMode; drawCalls: number; fps: number; contextLost: number };
  };
  setMove(x: number, y: number): void;
  press(a: "attack" | "jump" | "skill"): void;
  teleport(x: number, z: number): void;
  toZone01(): void;
  /** 測試用：玩家生命回滿（解除倒地以外的狀態不變） */
  heal(): void;
  /** 測試用（Stage 7.4 持續普攻測試）：設定某隻怪物的血量（不改上限、不影響其他規則） */
  setMonsterHp(id: string, hp: number): boolean;
  pet: {
    give(item: ItemId, n?: number): void;
    hatch(source: PetSourceId): number | null;
    timeWarp(seconds: number): void;
    feed(food: FeedId): boolean;
    appraise(): Promise<boolean>;
    evolve(): boolean;
    equip(id: number | null): boolean;
    reset(): void;
    list(): { id: number; stage: number; affixes: unknown }[];
    bag(): { id: string; kind: string; affixes: unknown }[];
    appraiseItem(itemId: string): Promise<{ ok: boolean; affixes: unknown }>;
    hatchItem(itemId: string): number | null;
  };
  bench(seconds: number): Promise<BenchReport>;
  perf: { session(): ReturnType<PerfOverlay["session"]>; reset(): void };
  /** Stage 7（?play=world）才有 */
  world?: { info(): Record<string, unknown>; toVillage(): void; setHp(hp: number): void };
}

interface BenchReport {
  seconds: number;
  avgFps: number;
  low1Fps: number;
  minFps: number;
  avgDraw: number;
  kills: number;
  contextLost: number;
  first30: number;
  last30: number;
  quality: string;
  gender: string;
  lod: string;
  charShadow: string;
}

declare global {
  interface Window {
    __starwishPlay?: PlayApi;
  }
}

/** world：Stage 7 完整遊戲（?play=world）；沒有 = Stage 5.6 整合測試頁（?play=starsprout，行為不變） */
export async function startStarsproutGame(canvas: HTMLCanvasElement, hudRoot: HTMLElement, world: WorldSession | null = null): Promise<void> {
  const g = new StarsproutGame(canvas, hudRoot, world);
  await g.init();
  g.start();
}

class StarsproutGame {
  private readonly params = new URLSearchParams(location.search);
  private gender: NoviceGender = this.params.get("g") === "female" ? "female" : "male";
  private lod: NoviceLod & MapLod = this.params.get("lod") === "lite" ? "lite" : "hq";
  private readonly charShadow: CharShadowMode = this.params.get("charshadow") === "realtime" ? "realtime" : "blob";
  private readonly p3 = this.params.get("p3") !== "0";
  private version = this.params.get("ver") === "c10b5" ? "c10b5" : "c10b5a";
  /** Stage 7 完整遊戲的共用存檔（null = Stage 5.6 測試頁） */
  private readonly ws: WorldSession | null;
  private wpanel: WorldPanel | null = null;
  private downAt: number | null = null;
  /** Stage 8.2：多人模式的伺服器權威戰鬥（單機為 null） */
  private mpField: MpFieldCombat | null = null;
  private look: AppliedLook | null = null;
  /** 倒地：多人模式以伺服器為準 */
  private get isDownNow(): boolean {
    const c = this.mpField?.client;
    return c ? !!c.self?.down || c.down : this.combat.isDown;
  }
  private leaving = false;
  private goldDropped = 0;
  private goldPicked = 0;
  private lootGold = new Map<number, { uid: string; gold: number }>();
  private readonly quality: QualitySettings;
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly terrain = new StarsproutTerrain();
  private readonly world: StarsproutWorld;
  private readonly sun: DirectionalLight;
  private readonly shadows: ShadowGenerator;
  private readonly render: RenderSetup;
  private readonly camera: ThirdPersonCamera;
  private readonly hud: Hud;
  private readonly perf: PerfOverlay;
  private readonly input = new InputState();
  private readonly keyboard: KeyboardInput;
  private readonly joystick: VirtualJoystick;
  private camObs: CameraObstacleQuery | null = null;
  private veg: VegetationView | null = null;
  private props: PropsView | null = null;
  private colliders: readonly Collider[] = MAP_COLLIDERS;
  private readonly pos = new Vector3();
  private yaw = 0;
  private now = 0;
  private contextLost = 0;
  private avatar!: NoviceAvatar;
  private monsters: MonsterController[] = [];
  /** Stage 7.2：羽風高地的怪物狀態（畫面與測試顯示） */
  private foxStatus = "";
  /** Stage 7.3：戰鬥特效（完整遊戲） */
  private fx: FieldCombatFx | null = null;
  private readonly alivePos: { x: number; y: number; z: number }[] = [];
  private readonly sepPlayer = { x: 0, z: 0, minDist: 0.85 };
  private _instances: MonsterInstance[] | null = null;
  /** 怪物實例陣列（怪物清單建立後不變；每幀不重新 map） */
  private get monsterInstances(): MonsterInstance[] {
    if (!this._instances || this._instances.length !== this.monsters.length) this._instances = this.monsters.map((m) => m.instance);
    return this._instances;
  }
  private knockbacks = 0;
  private knockSkipped = 0;
  private readonly kb = new FieldKnockback();
  private get tq(): FieldTerrainQuery {
    return (this._tq ??= new FieldTerrainQuery(this.terrain, this.colliders));
  }
  private _tq: FieldTerrainQuery | null = null;
  /** 沒有世界存檔（舊預覽）時的等級與經驗 */
  private readonly localProgress = { level: 1, exp: 0 };
  private expGained = 0;
  /** Stage 7.2：原野各區的骨骼動畫怪物（已交付／未交付） */
  private readonly fieldStatus: { zone: string; zoneName: string; monster: string; delivered: boolean; count: number; status: string }[] = [];
  private readonly combat = new PreviewCombat();
  private stats: CharacterStats = { ...FIELD_TEST.baseStats };
  private readonly rng = createRng(Number(this.params.get("seed") ?? Date.now()) >>> 0);
  private readonly pets: PetManager;
  private readonly merchant: PetMerchantService;
  /** 星靈鑑定服務（Claude B 鑑定視窗規格 V2.1）；整合頁暫時在背包直接呼叫 */
  private readonly appraisal: PetAppraisalService;
  private reqSeq = 0;
  private readonly follower: PetFollower;
  private readonly loot = new FieldLoot(FIELD_TEST.pickupRadius, FIELD_TEST.lootLifetime);
  private readonly lootMeshes = new Map<number, Mesh>();
  private readonly lootMats = new Map<ItemId, StandardMaterial>();
  private goldMat: StandardMaterial | null = null;
  private lockRing!: Mesh;
  private pending: { jump?: boolean; attack?: boolean; hurt?: boolean } = {};
  private attackTargetId: string | null = null;
  private downT = 0;
  private curSpeed = 0;
  private kills = 0;
  private hits = 0;
  private dropCount = 0;
  private picked = 0;
  private petClock = Date.now();
  /** 測試 API 快轉的寵物時間（world 模式用真實時間 + 快轉量） */
  private petSkew = 0;
  private petTick = 0;
  private fpsTimer = 0;
  private panel!: HTMLDivElement;
  private panelBody!: HTMLDivElement;
  private panelTab: "bag" | "pet" | "perf" = "bag";
  private panelMsg = "";
  private benchRun: { dts: number[]; draws: number[]; t: number; dur: number; kills0: number; resolve: (r: BenchReport) => void } | null = null;
  private autoFight = false;
  private lastBench: BenchReport | null = null;

  private readonly hudRoot: HTMLElement;
  private readonly earTmp = new Vector3();
  private rememberT = 0;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement, ws: WorldSession | null = null) {
    this.hudRoot = hudRoot;
    this.ws = ws;
    if (ws) {
      this.gender = ws.gender;
      this.version = NOVICE_VERSION;
      this.lod = pickModelLod(this.params);
    }
    const base = pickQuality();
    // P3-2：不建立半浮點 HDR 後製管線、改用畫布原生 MSAA（&p3=0 回到原設定對照）
    this.quality = this.p3 && base.postProcess ? { ...base, postProcess: false, canvasAntialias: true } : base;
    this.engine = createEngine(canvas, this.quality);
    this.engine.onContextLostObservable.add(() => this.contextLost++);
    const scene = new Scene(this.engine);
    this.scene = scene;
    createSkyDome(scene);
    scene.ambientColor = new Color3(0.35, 0.33, 0.4);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogStart = this.lod === "hq" ? 55 : 40;
    scene.fogEnd = this.lod === "hq" ? 150 : 110;
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
    this.shadows = createShadows(this.sun, this.quality);
    this.shadows.darkness = 0.35;
    // Stage 7.4：高畫質柔和陰影改用 Stage 5.3 已驗收的 PCSS32（取樣品質中；陰影類型、柔和範圍、貼圖 2048、偏移、濃度都不變）。
    // 原本原野沿用 PCSS64，和已驗收的遊戲設定不一致。&shadowq=original 可改回比較
    const contactQ = contactShadowQuality(this.quality.shadows.filter, "v38r", renderExperimentsFromSearch(location.search));
    if (contactQ && this.shadows.useContactHardeningShadow) this.shadows.filteringQuality = contactQ === "medium" ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_HIGH;

    this.pos.set(START.x, this.terrain.surface(START.x, START.z), START.z);
    this.yaw = Math.atan2(MAIN_ROUTE[1]!.x - START.x, MAIN_ROUTE[1]!.z - START.z);
    if (ws) {
      // Stage 7：存檔位置（原野）或從村莊南門抵達的營地出生點
      const c = ws.save.character;
      const saved = c.map === "starsprout" && c.x !== null && c.z !== null;
      const x = saved ? c.x! : FIELD_CAMP_ARRIVAL.x;
      const z = saved ? c.z! : FIELD_CAMP_ARRIVAL.z;
      this.pos.set(x, this.terrain.surface(x, z), z);
      this.yaw = saved && c.yaw !== null ? c.yaw : FIELD_CAMP_ARRIVAL.yaw;
    }
    this.camera = new ThirdPersonCamera(scene, this.pos, (x, z) => this.terrain.surface(x, z), {
      keepPitch: true,
      obstruct: (tx, ty, tz, dx, dy, dz, maxR) => (this.camObs ? this.camObs.distance(tx, ty, tz, dx, dy, dz, maxR) : maxR),
    });
    scene.activeCamera = this.camera.camera;
    this.camera.snap(this.pos, this.alphaBehind(this.yaw), TUNING.camera.defaultBeta, TUNING.camera.distance);
    this.render = setupRendering(scene, this.camera.camera, this.quality);
    this.world = buildStarsproutWorld(scene, this.terrain, this.shadows, this.render.glow, this.lod);
    const contactShadows = this.quality.shadows.filter === "contact" ? this.shadows : null;
    let colliders: Collider[] = [...MAP_COLLIDERS];
    this.props = buildPropsView(scene, this.terrain, this.lod, contactShadows);
    colliders = colliders.concat(propColliders());
    const layout = buildVegetation(this.terrain, this.lod === "hq" ? VEG_HQ : VEG_LITE, undefined, propExclusions());
    this.veg = buildVegetationView(scene, layout, this.lod, contactShadows);
    colliders = colliders.concat(layout.colliders);
    this.colliders = colliders;
    // Stage 8.1：多人模式的移動預測直接沿用這份地形與碰撞（與伺服器相同的 MAP_COLLIDERS＋道具＋植被）
    if (ws?.mp) registerStarsprout(this.terrain, colliders);
    this.camObs = new CameraObstacleQuery(cameraObstaclesFrom(colliders, (x, z) => this.terrain.surface(x, z)), TUNING.camera.maxDistance);
    this.world.setLabels(false);

    // 寵物：預設測試設定（明確標示）；&pets=official → 正式設定（缺值時停用，遊戲照常）
    const mode = this.params.get("pets") === "official" ? "official" : "preview";
    let saved: string | null = null;
    try {
      saved = ws ? null : localStorage.getItem(SAVE_KEY);
    } catch {
      saved = null;
    }
    this.pets = ws ? ws.pets : new PetManager(petCfgJson as unknown as PetConfig, this.rng, mode, saved);
    this.merchant = createPetMerchantService(this.pets);
    this.appraisal = ws ? ws.appraisal : createPetAppraisalService(this.pets);
    if (!ws) this.pets.on(() => this.persist());
    this.follower = new PetFollower(scene, this.pets.cfg.visual?.stageSize);

    this.hud = new Hud(hudRoot);
    this.hud.setLevel(1);
    const build = hudRoot.querySelector<HTMLSpanElement>(".hud-build");
    if (build) build.textContent = ws ? `Stage 7 星芽原野 ${this.gender === "male" ? "男" : "女"}・${this.lod === "hq" ? "HQ" : "Lite"}${ws.mode === "test" ? "・測試設定" : ""}` : `Stage 5.6 整合測試 ${this.gender === "male" ? "男" : "女"}・${this.lod === "hq" ? "HQ" : "Lite"}・${this.version.toUpperCase()}`;
    const relabel = (cls: string, text: string, hide = false): void => {
      const b = hudRoot.querySelector<HTMLButtonElement>(cls);
      if (b) {
        b.textContent = text;
        if (hide) b.style.display = "none";
      }
    };
    if (ws?.mp) {
      // Stage 8.2：多人模式第三顆按鈕＝展示技能（Claude C 的技術展示技能，不是正式職業技能）
      relabel(".skill-1", "背包");
      relabel(".skill-2", "寵物");
      relabel(".skill-3", "技能");
    } else if (ws) {
      // Stage 7：一般移動沒有跳躍按鈕（企劃規則）；跳躍動畫保留給技能
      relabel(".skill-1", "背包");
      relabel(".skill-2", "寵物");
      relabel(".skill-3", "", true);
    } else {
      relabel(".skill-1", "跳躍");
      relabel(".skill-2", "背包");
      relabel(".skill-3", "寵物");
    }
    this.hud.events.on("skillPressed", ({ slot }) => {
      if (slot === "attack") this.tryAttack(true);
      else if (ws?.mp && slot === "skill3") this.mpField?.skill(ws.save.character.appearance.weapon);
      else if (ws) {
        if (slot === "skill1") this.wpanel?.open("bag");
        else if (slot === "skill2") this.wpanel?.open("pet");
      } else if (slot === "skill1") this.pending.jump = true;
      else if (slot === "skill2") this.openPanel("bag");
      else this.openPanel("pet");
    });
    this.joystick = new VirtualJoystick(this.hud.joystickZone, this.input, TUNING.joystick.radius, TUNING.joystick.deadZone);
    new CameraTouchControl(canvas, this.input, TUNING.camera.rotateSensitivity, TUNING.camera.pitchSensitivity, TUNING.camera.pinchSensitivity);
    const block = (e: Event): void => e.preventDefault();
    for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, block, { passive: false });
    canvas.addEventListener("contextmenu", block);
    this.keyboard = new KeyboardInput(this.input, () => this.joystick.active);
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !ws) this.pending.jump = true;
      if (e.code === "KeyJ" || e.code === "Enter") this.tryAttack(true);
    });
    this.perf = new PerfOverlay(this.engine, scene, this.quality, hudRoot);
    if (ws) this.perf.setLabels({ model: MODEL_LOD_LABEL[this.lod], map: "星芽原野" });
    window.addEventListener("resize", () => this.engine.resize());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.engine.stopRenderLoop(this.frame);
      else this.engine.runRenderLoop(this.frame);
    });
    if (ws) {
      this.wpanel = new WorldPanel(hudRoot, ws, {
        clock: () => this.petClock,
        changed: (msg) => this.afterPetChange(msg),
        perf: () => this.perf,
        stats: () => {
          const t = this.combat.tuning;
          return { base: FIELD_TEST.baseStats, now: this.stats, combat: `戰鬥（測試設定）：每下 ${t.attackDamage} 傷害、${t.attackInterval.toFixed(3)} 秒一下、受到傷害 ×${t.damageTakenMul.toFixed(2)}｜擊倒 ${this.kills}、撿到金幣 ${this.goldPicked}` };
        },
        extra: (_body, btn) => {
          const go = (k: string, v: string | null): void => {
            this.rememberPos();
            const q = new URLSearchParams(location.search);
            if (v === null) q.delete(k);
            else q.set(k, v);
            location.search = q.toString();
          };
          btn(`模型 LOD：${MODEL_LOD_LABEL[this.lod]} → 換 ${this.lod === "hq" ? "Lite" : "HQ"}`, () => go("lod", this.lod === "hq" ? "lite" : "hq"));
          btn(this.charShadow === "blob" ? "角色即時陰影" : "腳下柔邊陰影", () => go("charshadow", this.charShadow === "blob" ? "realtime" : null));
          btn("傳送到星露草坪", () => this.toZone01());
          btn("回營地", () => this.teleport(FIELD_CAMP_ARRIVAL.x, FIELD_CAMP_ARRIVAL.z));
          for (const sec of [60, 180]) btn(`實玩效能測試 ${sec} 秒`, () => {
            this.wpanel?.close();
            void this.bench(sec);
          }, !this.benchRun);
          if (this.lastBench) {
            const r = this.lastBench;
            const ta = document.createElement("textarea");
            ta.readOnly = true;
            ta.style.cssText = "width:100%;height:60px;font-size:11px";
            ta.value = JSON.stringify(r);
            _body.appendChild(ta);
          }
        },
      });
      window.addEventListener("pagehide", () => this.rememberPos());
    } else this.buildPanel();
  }

  /** Stage 7：記錄目前位置與生命（切換頁面、定期） */
  private rememberPos(): void {
    if (!this.ws || this.leaving) return;
    this.ws.remember("starsprout", this.pos.x, this.pos.z, this.yaw, this.combat.isDown ? null : this.combat.hp);
    this.ws.persist();
  }

  async init(): Promise<void> {
    const scene = this.scene;
    // ---------- 角色 ----------
    // 角色模型：已驗收的初心者 C1.0-B5b（Stage 7.2 新版 Tripo 美術驗收不通過，已封存）。
    // 模組化換裝載入程式保留；只有網址加 &nv72=1 且封存的檔案有部署時才會使用（正式預覽不部署那些檔案）
    const modelsUrl = `${import.meta.env.BASE_URL}models/`;
    const useNew = this.params.get("nv72") === "1" && (await modularAvailable(modelsUrl, this.gender, this.lod));
    this.avatar = useNew
      ? await NoviceAvatar.loadModular(scene, { gender: this.gender, lod: this.lod, baseUrl: modelsUrl, appearance: this.ws?.save.character.appearance ?? defaultAppearance() })
      : await NoviceAvatar.load(scene, { gender: this.gender, lod: this.lod, baseUrl: `${import.meta.env.BASE_URL}models/`, version: this.version });
    this.avatar.setupShadow(this.charShadow, scene, this.shadows);
    // Stage 8.2：多人模式套用伺服器保存的外觀（髮色、武器）；與其他玩家看到的一致
    if (this.ws?.mp && !useNew) this.look = await applyNoviceLook(scene, this.avatar, this.gender, this.ws.save.character.appearance);
    const sky = scene.getMeshByName("PH_skyDome");
    if (sky) {
      const probe = new ReflectionProbe("playEnv", 128, scene, true, true);
      probe.position = new Vector3(0, 0.8, 0);
      probe.renderList!.push(sky);
      probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      this.avatar.setMetalReflection(probe.cubeTexture);
    }
    this.avatar.root.position.copyFrom(this.pos);
    this.avatar.root.rotation.y = this.yaw;

    // ---------- 怪物：星露草坪 6 隻星露啵啵 V3.8R ----------
    const quality = this.quality.level;
    const registry = registerBabylonVisuals(createMonsterRegistry({ legacyAggressive: !this.ws }), { scene, shadows: this.shadows, quality });
    const factory = new MonsterFactory(registry);
    this.monsters = zoneSpawnPoints(ZONE01.x, ZONE01.z, ZONE01.r, FIELD_TEST.boboCount).map((p) =>
      factory.create("star_dew_bobo", { x: p.x, y: this.terrain.surface(p.x, p.z), z: p.z }, { modelId: BOBO_MODEL_IDS.v38r, animationProfileId: BOBO_PROFILE_IDS.v38r, ...(this.ws?.mp ? { ai: false } : {}) }),
    );
    // ---------- Stage 7.2：骨骼動畫怪物（M004～M007；GLB 列在 models/monsters/manifest.json 才會出現，沒交付的區域保持空的） ----------
    // &rigfixture=1（只供自動測試）：風羽狐檔案還沒交付時，用灰色方塊的接口測試替身驗證 AI、命中與重生（只放羽風高地）
    // Stage 7.3 效能：原野同時有 6 種骨骼動畫怪物（21 隻）。HQ 每種 3 張 2048 貼圖，6 種約 18 張 → iPhone 記憶體風險高；
    // 怪物一律用 Lite（貼圖 1024／512、量化頂點，外觀與動畫相同）。&monlod=hq 可切回 HQ 比較。
    const rigLod = this.params.get("monlod") === "hq" ? "hq" : this.params.get("monlod") === "lite" ? "lite" : this.ws ? "lite" : this.lod;
    const rigReg = registerBabylonVisuals(createMonsterRegistry({ legacyAggressive: !this.ws }), { scene, shadows: this.shadows, quality, modelLod: rigLod });
    const rigFactory = new MonsterFactory(rigReg);
    for (const { zoneId, spec } of FIELD_RIGGED_SPAWNS) {
      const zone = ZONES.find((z) => z.id === zoneId)!;
      const ok = await riggedAssetAvailable(import.meta.env.BASE_URL, spec, rigLod);
      const id = ok ? spec.monsterId : zoneId === "04" && this.params.get("rigfixture") === "1" ? "rig_contract_fixture" : null;
      const name = rigReg.definition(spec.monsterId).name;
      const status = ok ? `${spec.label} ${rigLod === "hq" ? "HQ" : "Lite"}` : id ? `接口測試替身（${name}檔案未交付）` : `${name}檔案未交付（${zone.name}暫時沒有怪物）`;
      if (zoneId === "04") this.foxStatus = ok ? `M004 風羽狐 ${rigLod === "hq" ? "HQ" : "Lite"}` : status;
      let count = 0;
      if (id) {
        const pts = zoneSpawnPoints(zone.x, zone.z, zone.r * (zone.cap === 1 ? 0 : 0.75), zone.cap ?? 1);
        for (const p of pts) {
          this.monsters.push(rigFactory.create(id, { x: p.x, y: this.terrain.surface(p.x, p.z), z: p.z }, { brain: { seed: Math.round(p.x * 31 + p.z * 17) }, ...(this.ws?.mp ? { ai: false } : {}) }));
          count++;
        }
      }
      this.fieldStatus.push({ zone: zoneId, zoneName: zone.name, monster: name, delivered: ok, count, status });
    }
    await Promise.all(this.monsters.map((m) => m.visual?.load() ?? Promise.resolve()));
    // Stage 7.3：戰鬥特效（Claude C Combat VFX Stage 2）：命中火花、傷害數字、受傷紅框、重生光柱。完整遊戲才開；&fx=0 關閉（比較用）
    if (this.ws && this.params.get("fx") !== "0") this.fx = new FieldCombatFx(scene, this.hudRoot, this.lod === "hq" ? "high" : "medium");
    this.perf.setExtra(() => ({
      monsterDetail: this.detailOn ? { ...this.tierCount } : "關閉（&mlod=0）",
      monsters: this.monsters.length,
      shadow: `${this.shadows.useContactHardeningShadow ? "PCSS" : "PCF"} ${this.quality.shadows.mapSize}（取樣 ${this.shadows.filteringQuality === ShadowGenerator.QUALITY_HIGH ? "高" : this.shadows.filteringQuality === ShadowGenerator.QUALITY_MEDIUM ? "中" : "低"}）`,
      shadowCasters: this.shadows.getShadowMap()?.renderList?.length ?? 0,
      fx: this.fx ? { ...this.fx.stats, particles: this.fx.vfx.stats.particles } : null,
      // Stage 8.4：多人資訊一起放進「複製報告」（同場人數、延遲、其他玩家遠近分級、伺服器戰鬥統計）
      ...(this.ws?.mp ? { mp: { ...this.ws.mp.perfInfo(), field: this.mpField ? { attacksOk: this.mpField.stats.attacksOk, hitsShown: this.mpField.stats.hitsShown, remoteCasts: this.mpField.stats.remoteCastsShown, audio: this.mpField.audio?.played ?? null } : null } } : {}),
    }));
    this.lockRing = MeshBuilder.CreateTorus("PH_lockRing", { diameter: 1.1, thickness: 0.05, tessellation: 40 }, scene);
    const ringMat = new StandardMaterial("PH_lockRingMat", scene);
    ringMat.disableLighting = true;
    ringMat.emissiveColor = new Color3(1, 0.55, 0.35);
    ringMat.alpha = 0.85;
    this.lockRing.material = ringMat;
    this.lockRing.isPickable = false;
    this.lockRing.setEnabled(false);
    for (const k of ITEM_IDS) {
      const m = new StandardMaterial(`lootMat_${k}`, scene);
      m.diffuseColor = Color3.FromHexString(ITEM_COLOR[k]);
      m.emissiveColor = Color3.FromHexString(ITEM_COLOR[k]).scale(0.45);
      m.specularColor = new Color3(0.3, 0.3, 0.3);
      this.lootMats.set(k, m);
    }

    this.syncFollower();
    this.applyStats(true);
    if (this.ws) {
      // 存檔的生命（null = 滿血）
      const hp = this.ws.save.character.hp;
      if (hp !== null) this.combat.hp = Math.min(this.combat.tuning.maxHp, Math.max(1, hp));
      void this.buildCampPortal();
      this.avatar.on((e) => {
        if (e.type === "deathEnd") this.hud.toast("你倒下了……稍後在星芽村的星願之泉復活", 2200);
      });
    }
    this.installApi();
    const mp = this.ws?.mp;
    if (mp) {
      mp.attach(scene, this.lod, (x, z) => this.terrain.surface(x, z), () => this.perf.avgFps(2));
      mp.onMap((map, me) => {
        if (map === "starsprout" || !this.ws) return;
        this.leaving = true;
        this.ws.travelTo({ map, x: me.x, z: me.z, yaw: me.yaw }, this.isDownNow ? null : this.combat.hp);
      });
      this.mpField = new MpFieldCombat(
        mp.client,
        {
          scene,
          hudRoot: this.hudRoot,
          surface: (x, z) => this.terrain.surface(x, z),
          monsters: this.monsters,
          me: () => ({ x: this.pos.x, z: this.pos.z, yaw: this.yaw }),
          remotePose: (pid) => mp.remotePose(pid),
          playAttack: (id) => {
            this.attackTargetId = id;
            this.pending.attack = true;
          },
          playHurt: () => {
            if (this.curSpeed < 0.05 && this.avatar.state !== "Attack") this.pending.hurt = true;
          },
          toast: (m, ms) => this.hud.toast(m, ms),
          weapon: () => this.look?.weapon ?? null,
          lite: this.lod === "lite",
          fx: this.fx,
          remoteSkill: (pid, clip, t) => mp.remoteSkill(pid, clip, t),
          remoteSkillEnd: (pid) => mp.remoteSkillEnd(pid),
          rightDir: () => {
            const d = this.camera.camera.getDirection(Vector3.Right());
            return { x: d.x, z: d.z };
          },
        },
        this.gender,
      );
      mp.onCommand((id, ok, err) => this.mpField?.onCommandResult(id, ok, err));
      mp.perf = this.perf;
      this.hud.toast("多人戰鬥（Stage 8.2 測試）：怪物、傷害、經驗、掉落都由伺服器判定", 4000);
    }
    await scene.whenReadyAsync();
    const auto = this.params.get("autoplay");
    if (auto === "fight") {
      const dur = Math.max(10, Math.min(300, Number(this.params.get("duration") ?? 60) || 60));
      window.setTimeout(() => void this.bench(dur), 1500);
    }
  }

  start(): void {
    this.engine.runRenderLoop(this.frame);
    const petNote = this.pets.enabled ? (this.pets.mode === "preview" ? "寵物：測試設定" : "寵物：正式設定") : this.pets.disabledReason;
    if (this.ws) this.hud.toast("星芽原野：往東走到「星露草坪」打星露啵啵。回星芽村：走進營地的藍色傳送陣", 4000);
    else this.hud.toast(`星芽原野整合測試：往東走到「星露草坪」打星露啵啵，撿掉落物、培育寵物（${petNote}）`, 4500);
  }

  private alphaBehind(yaw: number): number {
    return Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
  }

  // ---------------- 每幀 ----------------
  private frame = (): void => {
    const rawDt = this.engine.getDeltaTime() / 1000;
    const dt = Math.min(rawDt, 0.1);
    this.now += dt;
    this.keyboard.update();
    if (this.autoFight) this.autoDrive();
    const down = this.isDownNow;
    const m = down ? { x: 0, y: 0 } : this.input.getMove();
    const w = inputToWorld(m.x, m.y, this.camera.forwardYaw);
    const l = Math.hypot(w.x, w.z);
    const s = l > 1 ? 1 / l : 1;
    const mx = w.x * s;
    const mz = w.z * s;
    const speed01 = Math.min(1, l);
    const attacking = this.avatar.state === "Attack";
    this.curSpeed = 0;
    const mp = this.ws?.mp;
    if (mp) {
      // Stage 8.1：移動交給多人連線（攻擊中、倒地時不移動，與單機規則相同）
      const go = speed01 > 0.05 && !attacking && !down;
      const st = mp.step(dt, go ? mx * speed01 : 0, go ? mz * speed01 : 0);
      this.pos.x = st.x;
      this.pos.z = st.z;
      if (!attacking) this.yaw = st.yaw;
      this.curSpeed = st.speed;
    } else if (speed01 > 0.05 && !attacking && !down) {
      const sp = TUNING.player.moveSpeed * speed01;
      const nx = this.pos.x + mx * sp * dt;
      const nz = this.pos.z + mz * sp * dt;
      const r = resolveMove(this.terrain, this.colliders, PLAYER_RADIUS, this.pos.x, this.pos.z, nx, nz);
      this.curSpeed = Math.hypot(r.x - this.pos.x, r.z - this.pos.z) / Math.max(dt, 1e-4);
      this.pos.x = r.x;
      this.pos.z = r.z;
      this.yaw = turnTowards(this.yaw, mx, mz, TUNING.player.turnSharpness, dt);
    }
    // 攻擊中面向目標
    const tgt = attacking ? this.monsters.find((x) => x.instance.instanceId === this.attackTargetId && x.instance.isAlive) : undefined;
    if (tgt) {
      const p = tgt.instance.currentPosition;
      this.yaw = turnTowards(this.yaw, p.x - this.pos.x, p.z - this.pos.z, 24, dt);
    }
    const groundY = this.terrain.surface(this.pos.x, this.pos.z);
    this.pos.y = groundY;
    const deathClip = this.avatar.hasDeathClip;
    const h = this.avatar.update(dt, { speed: this.curSpeed, jump: this.pending.jump && !down, attack: this.pending.attack, hurt: this.pending.hurt && !down, die: down && deathClip && this.avatar.state !== "Death", revive: !down && this.avatar.state === "Death" }, groundY);
    this.pending = {};
    const root = this.avatar.root;
    root.position.set(this.pos.x, groundY + h, this.pos.z);
    root.rotation.y = this.yaw;
    // 倒地：有死亡動作（C1.0-B5b）就播死亡動作；舊模型沒有死亡動作時才用整個角色往後倒代替
    this.downT = down && !deathClip ? Math.min(1, this.downT + dt / 0.4) : 0;
    root.rotation.x = this.downT > 0 ? -(Math.PI / 2) * 0.92 * (1 - Math.pow(1 - this.downT, 3)) : 0;
    if (this.downT > 0) root.position.y += 0.18 * this.downT;

    this.camera.update(dt, this.pos, this.input.consumeCamera());
    this.sun.position.copyFrom(this.pos).subtractInPlace(this.sun.direction.scale(45));
    this.updateMonsters(dt);
    this.fx?.update(dt);
    this.updateLoot(dt);
    this.follower.update(dt, this.avatar.petAnchor(this.earTmp), this.yaw, this.avatar.headHalfWidth);
    if (this.ws) this.worldFrame(dt);
    mp?.update(dt);
    this.world.update(dt, this.pos.x, this.pos.z);
    this.veg?.update(this.pos.x, this.pos.z, false);
    this.props?.update(this.pos.x, this.pos.z, false, dt);
    this.scene.render();
    this.perf.update(dt);
    if (this.benchRun) this.benchFrame(rawDt);
    this.petTick += rawDt;
    if (this.petTick >= 1) {
      this.petClock = this.ws ? Date.now() + this.petSkew : this.petClock + Math.round(this.petTick * 1000);
      this.petTick = 0;
      this.tickPets();
    }
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fpsTimer = 0;
      this.hud.setFps(this.ws ? this.perf.avgFps(2) : this.engine.getFps());
      if (this.ws) this.wpanel?.refresh();
      else if (this.panel.classList.contains("open") && this.panelTab !== "perf") this.renderPanel();
    }
  };

  // ---------------- 戰鬥 ----------------
  private tryAttack(fromPlayer: boolean): boolean {
    if (this.avatar.state === "Attack") return false;
    // 多人：只送攻擊請求，傷害由伺服器判定
    if (this.mpField) return this.mpField.attack(this.combat.tuning ? 2.5 : 2.5);
    const t = this.avatar.getAttackTiming();
    const r = this.combat.startAttack(this.now, this.pos.x, this.pos.z, this.monsterInstances, t.hitAt - 1e-6);
    if (r.ok) {
      this.attackTargetId = r.targetId;
      this.pending.attack = true;
      // Stage 8.1：讓其他玩家看到攻擊動作（朝向目標）；傷害仍在本機（Stage 8.2 改伺服器判定）
      const tg = this.monsters.find((x) => x.instance.instanceId === r.targetId)?.instance.currentPosition;
      this.ws?.mp?.act("attack", tg ? Math.atan2(tg.x - this.pos.x, tg.z - this.pos.z) : this.yaw);
      return true;
    }
    if (fromPlayer && r.reason === "no-target") this.hud.toast("攻擊範圍內沒有怪物，請再靠近一點", 1000);
    return false;
  }

  private onHit(r: PlayerAttackResult): void {
    if (!r.ok) return;
    this.hits++;
    const mc = this.monsters.find((x) => x.instance.instanceId === r.targetId);
    if (!mc) return;
    const i = mc.instance;
    const ip = i.currentPosition;
    this.fx?.playerHit(ip.x, this.terrain.surface(ip.x, ip.z), ip.z, i.definition.height ?? 1, r.damage, r.killed);
    // Stage 7.3：普通攻擊的輕微擊退（Claude C 受擊反應 V2：0.12＋震動×0.75，普通攻擊震動 0.14 → 約 0.22 m；Boss ×0.25）。
    // 用 FieldTerrainQuery：撞到岩石、溪流、地圖邊界就停在前面
    if (this.ws && !r.killed && this.params.get("fx") !== "0") {
      const dx = ip.x - this.pos.x;
      const dz = ip.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      // Stage 7.4：連擊衰減（第 1 下 100%、第 2 下 50%、之後 0；出手中不推）→ 持續普攻不會讓怪物一直被推出攻擊範圍
      const k = this.kb.distance(i.instanceId, this.now, { attacking: i.currentState === "attack", boss: i.definition.rank === "boss" });
      if (k > 0) {
        const to = this.tq.clampMove({ x: ip.x, z: ip.z }, { x: ip.x + (dx / d) * k, z: ip.z + (dz / d) * k }, i.definition.bodyRadius ?? 0.5);
        ip.x = to.x;
        ip.z = to.z;
        this.knockbacks++;
      } else this.knockSkipped++;
    }
    if (r.killed) this.kb.reset(i.instanceId);
    if (r.killed) {
      this.kills++;
      const items = this.pets.onMonsterKilled(false); // 地上掉落物：撿起時才放進背包
      if (items.length) {
        this.dropCount += items.length;
        for (const d of this.loot.spawn(items, i.currentPosition.x, i.currentPosition.z, this.now)) this.spawnLootMesh(d);
      }
      // Stage 7：金幣掉落（測試設定的範圍；正式值未定案 → 不掉金幣）。每個掉落物有唯一編號，只能撿一次
      let gold = 0;
      if (this.ws) {
        gold = rollGold(this.ws.economy, i.definition.monsterId, this.rng.next());
        if (gold > 0) {
          const [d] = this.loot.spawn(["shopFeed"], i.currentPosition.x + 0.35, i.currentPosition.z - 0.35, this.now);
          this.lootGold.set(d!.id, { uid: nextLootUid(this.ws.save), gold });
          this.goldDropped += gold;
          this.spawnLootMesh(d!, true);
        }
      }
      // Stage 7.2：經驗（怪物經驗與升級表都是測試設定）
      let expMsg = "";
      const exp = i.definition.experience;
      if (exp > 0) {
        const ups = this.ws ? this.ws.addExp(exp) : gainExp(this.localProgress, exp);
        this.expGained += exp;
        expMsg = ` 經驗 +${exp}`;
        if (ups > 0) window.setTimeout(() => this.hud.toast(`升級！Lv.${this.ws ? this.ws.progress.level : this.localProgress.level}`, 1600), 1500);
      }
      this.hud.toast((items.length || gold ? `擊敗${i.definition.name}！掉落：${[...(gold ? [`${gold} 金幣`] : []), ...items.map((k) => ITEM_LABEL[k])].join("、")}` : `擊敗${i.definition.name}！`) + expMsg, 1400);
    } else if (!this.fx) {
      // 有戰鬥特效時傷害數字已經顯示在怪物頭上；每下都更新提示文字會多一次版面重排（Stage 7.4）
      this.hud.toast(`${i.definition.name} -${r.damage}（HP ${i.currentHp}/${i.definition.maxHp}）`, 800);
    }
  }

  // ---------------- Stage 7.4：怪物距離分級（monsterDetail.ts） ----------------
  private readonly planes = [0, 1, 2, 3, 4, 5].map(() => new Plane(0, 0, 0, 0));
  private readonly tiers = new Map<MonsterController, DetailTier>();
  /** 測試／效能面板用：各等級隻數 */
  readonly tierCount: Record<DetailTier, number> = { near: 0, mid: 0, far: 0, hidden: 0, offscreen: 0 };
  /** &mlod=0：關閉距離分級（優化前比較用） */
  private get detailOn(): boolean {
    return this.params.get("mlod") !== "0";
  }

  private updateMonsterDetail(): void {
    if (!this.detailOn) return;
    Frustum.GetPlanesToRef(this.scene.getTransformMatrix(), this.planes);
    const tc = this.tierCount;
    tc.near = tc.mid = tc.far = tc.hidden = tc.offscreen = 0;
    for (const m of this.monsters) {
      const p = m.instance.currentPosition;
      const h = m.instance.definition.height ?? 1;
      const dist = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      const inView = sphereInFrustum(this.planes, p.x, p.y + h * 0.5, p.z, Math.max(0.8, h * 0.75));
      const tier = pickTier(dist, inView, this.tiers.get(m) ?? null);
      this.tiers.set(m, tier);
      tc[tier]++;
      const d = detailFor(tier, dist);
      m.visualStride = d.stride;
      const v = m.visual;
      if (v instanceof RiggedMonsterVisual) {
        v.setAnimMode(d.anim);
        v.setShadowCasting(d.shadow);
        v.setRenderVisible(d.render);
      }
    }
  }

  private updateMonsters(dt: number): void {
    this.updateMonsterDetail();
    if (this.mpField) return this.updateMonstersMp(dt);
    const hit = this.combat.resolvePending(this.now, this.pos.x, this.pos.z, this.monsterInstances);
    if (hit) this.onHit(hit);
    if (this.ws) {
      // Stage 7：生命歸零 → 死亡動作 → 約 3 秒後在星芽村星願之泉復活（存檔：死亡次數、滿血）
      if (this.combat.isDown && this.downAt === null) {
        this.downAt = this.now;
        this.ws.mp?.act("death");
      }
      if (this.downAt !== null && this.now - this.downAt >= 3 && !this.leaving) this.respawnInVillage();
    } else if (this.combat.update(this.now)) {
      // 倒地 2 秒後在營地復活（測試規則）
      this.teleport(START.x, START.z);
      this.hud.toast("已在新手營地復活（測試規則）", 1500);
    }
    const target: MonsterTarget = { id: "player", x: this.pos.x, z: this.pos.z, alive: !this.combat.isDown };
    for (const m of this.monsters) {
      const p = m.instance.currentPosition;
      p.y = this.terrain.surface(p.x, p.z);
      const before = m.instance.currentState;
      const frame = m.update(dt, this.now, target);
      if (before !== "respawn" && m.instance.currentState === "respawn") this.fx?.respawn(p.x, this.terrain.surface(p.x, p.z), p.z, Math.max(0.8, (m.instance.definition.bodyRadius ?? 0.5) * 1.6));
      p.y = this.terrain.surface(p.x, p.z);
      if (frame.effects.includes("attackImpact") && m.instance.claimAttackImpact() !== null) {
        const dmg = this.combat.monsterImpact(this.now, m.instance, this.pos.x, this.pos.z);
        if (dmg > 0) {
          this.fx?.playerHurt(this.pos.x, this.pos.y, this.pos.z, dmg);
          // 普通攻擊不打斷移動、攻擊（已定案規則）：站著不動時才播受傷動作
          if (this.curSpeed < 0.05 && this.avatar.state !== "Attack") this.pending.hurt = true;
          if (this.combat.isDown || !this.fx) this.hud.toast(this.combat.isDown ? (this.ws ? "你倒下了…" : "你倒下了…（測試規則：2 秒後在營地復活）") : `受到${m.instance.definition.name}攻擊 -${dmg}`, 900);
        }
      }
    }
    // Stage 7.4：重複使用陣列（每幀不配置新陣列）
    const alive = this.alivePos;
    alive.length = 0;
    for (const m of this.monsters) if (m.instance.isAlive) alive.push(m.instance.currentPosition);
    this.sepPlayer.x = this.pos.x;
    this.sepPlayer.z = this.pos.z;
    separate(alive, 1.0, this.sepPlayer);
    for (const p of alive) p.y = this.terrain.surface(p.x, p.z);
    const locked = this.combat.lockTarget(this.pos.x, this.pos.z, this.monsterInstances);
    if (locked) {
      const p = locked.currentPosition;
      this.lockRing.position.set(p.x, this.terrain.surface(p.x, p.z) + 0.03, p.z);
      this.lockRing.rotation.y += dt * 1.5;
    }
    this.lockRing.setEnabled(locked !== null);
    const pg = this.ws ? this.ws.progress : { ...this.localProgress, expToNext: expToNext(this.localProgress.level) };
    this.hud.setBars({ hp: this.combat.hp, maxHp: this.combat.tuning.maxHp, mp: 40, maxMp: 40, exp: pg.exp, expToNext: pg.expToNext });
    this.hud.setLevel(pg.level);
  }

  /** 多人模式：怪物、血量、經驗、金幣全部照伺服器 */
  private updateMonstersMp(dt: number): void {
    const f = this.mpField!;
    f.update(dt, this.now);
    const self = f.client.self;
    if (self) {
      this.combat.hp = self.hp;
      this.hud.setBars({ hp: self.hp, maxHp: self.maxHp, mp: 40, maxMp: 40, exp: self.exp, expToNext: self.expNext });
      this.hud.setLevel(self.level);
    }
    const down = this.isDownNow;
    if (down && this.downAt === null) this.downAt = this.now;
    if (!down) this.downAt = null;
    if (this.downAt !== null && this.now - this.downAt >= 3 && !this.leaving) this.respawnInVillage();
    let locked: MonsterController | null = null;
    let bd = 2.5 + 0.4;
    for (const m of this.monsters) {
      if (!m.instance.isAlive) continue;
      const q = m.instance.currentPosition;
      const d = Math.hypot(q.x - this.pos.x, q.z - this.pos.z) - (m.instance.definition.bodyRadius ?? 0);
      if (d < bd) [bd, locked] = [d, m];
    }
    if (locked) {
      const p = locked.instance.currentPosition;
      this.lockRing.position.set(p.x, this.terrain.surface(p.x, p.z) + 0.03, p.z);
      this.lockRing.rotation.y += dt * 1.5;
    }
    this.lockRing.setEnabled(locked !== null);
  }

  // ---------------- 掉落物 ----------------
  private spawnLootMesh(d: LootDrop, gold = false): void {
    const egg = d.item === "egg" || d.item === "birdEgg";
    if (gold) {
      const coin = MeshBuilder.CreateCylinder(`loot_${d.id}`, { diameter: 0.2, height: 0.035, tessellation: 18 }, this.scene);
      coin.rotation.x = Math.PI / 2;
      if (!this.goldMat) {
        this.goldMat = new StandardMaterial("lootGoldMat", this.scene);
        this.goldMat.diffuseColor = new Color3(1, 0.82, 0.25);
        this.goldMat.emissiveColor = new Color3(0.55, 0.42, 0.08);
        this.goldMat.specularColor = new Color3(0.9, 0.8, 0.4);
      }
      coin.material = this.goldMat;
      coin.isPickable = false;
      coin.position.set(d.x, this.terrain.surface(d.x, d.z) + 0.25, d.z);
      this.lootMeshes.set(d.id, coin);
      return;
    }
    const mesh =
      d.item === "monsterMaterial"
        ? MeshBuilder.CreatePolyhedron(`loot_${d.id}`, { type: 1, size: 0.09 }, this.scene)
        : MeshBuilder.CreateSphere(`loot_${d.id}`, { diameter: egg ? 0.2 : 0.16, segments: 10 }, this.scene);
    if (egg) mesh.scaling.y = 1.3;
    mesh.material = this.lootMats.get(d.item)!;
    mesh.isPickable = false;
    mesh.position.set(d.x, this.terrain.surface(d.x, d.z) + 0.25, d.z);
    this.lootMeshes.set(d.id, mesh);
  }

  private updateLoot(dt: number): void {
    if (this.mpField) return; // 多人：掉落物由伺服器管理（MpFieldCombat）
    const t = this.now;
    for (const d of this.loot.drops) {
      const m = this.lootMeshes.get(d.id);
      if (!m) continue;
      m.rotation.y += dt * 1.6;
      m.position.y = this.terrain.surface(d.x, d.z) + 0.25 + Math.sin((t - d.born) * 3 + d.id) * 0.05;
    }
    if (this.isDownNow) return;
    const { picked, expired } = this.loot.update(t, this.pos.x, this.pos.z);
    for (const d of [...picked, ...expired]) {
      this.lootMeshes.get(d.id)?.dispose();
      this.lootMeshes.delete(d.id);
    }
    if (picked.length) {
      const names: string[] = [];
      for (const d of picked) {
        const g = this.lootGold.get(d.id);
        if (g) {
          this.lootGold.delete(d.id);
          if (this.ws && this.ws.pickGold(g.uid, g.gold, "star_dew_bobo")) {
            this.goldPicked += g.gold;
            names.push(`${g.gold} 金幣`);
          }
          continue;
        }
        this.picked += 1;
        if (this.ws) {
          const uid = nextLootUid(this.ws.save);
          this.ws.pickItem(uid, () => this.pets.giveItem(d.item, 1));
        } else this.pets.giveItem(d.item, 1);
        names.push(ITEM_LABEL[d.item]);
      }
      if (names.length) this.hud.toast(`撿到 ${names.join("、")}`, 1100);
      this.wpanel?.refresh();
    }
    for (const d of expired) this.lootGold.delete(d.id);
  }

  // ---------------- 寵物 ----------------
  private persist(): void {
    if (this.ws) {
      this.ws.persistSoon();
      return;
    }
    try {
      localStorage.setItem(SAVE_KEY, this.pets.serialize());
    } catch {
      /* 無法儲存時略過 */
    }
  }

  private tickPets(): void {
    const before = this.pets.save.pets.map((p) => p.stage);
    this.pets.tick(this.petClock);
    const hatched = this.pets.save.pets.some((p, i) => p.stage !== before[i]);
    if (hatched) {
      this.syncFollower();
      this.hud.toast("寵物孵化了！到背包的「寵物」頁可以鑑定、餵食、裝備", 2000);
    }
    this.applyStats(false);
    this.persist();
  }

  private syncFollower(): void {
    const p = this.pets.enabled ? this.pets.equipped() : null;
    const sp = p ? this.pets.cfg.species.find((s) => s.id === p.species) : null;
    this.follower.setLook(p && sp && (this.ws ? p.stage > 0 : true) ? { species: p.species, stage: p.stage, motion: sp.motion, soul: isSoul(p) } : null);
  }

  /** 寵物加成 → 角色屬性 → 戰鬥參數（傷害、生命、受傷倍率、攻擊間隔）與攻擊動畫速度 */
  private applyStats(resetHp: boolean): void {
    const st = this.pets.characterStats({ ...FIELD_TEST.baseStats });
    const prevMax = this.combat.tuning.maxHp;
    this.stats = st;
    Object.assign(this.combat.tuning, combatTuningFromStats(st));
    this.avatar.setAttackSpeed(st.attackSpeed);
    if (resetHp) this.combat.hp = this.combat.tuning.maxHp;
    else if (this.combat.tuning.maxHp !== prevMax && !this.combat.isDown) this.combat.hp = Math.min(this.combat.tuning.maxHp, Math.round((this.combat.hp * this.combat.tuning.maxHp) / prevMax));
  }

  private afterPetChange(msg: string): void {
    this.panelMsg = msg;
    this.syncFollower();
    this.applyStats(false);
    this.persist();
    if (this.ws) this.wpanel?.refresh();
    else this.renderPanel();
  }

  // ---------------- Stage 7：星願石（返回星芽村）、死亡復活、定期存檔 ----------------
  private campPortal: CampPortal | null = null;
  private readonly portal = new PortalTrigger(FIELD_CAMP_PORTAL);

  /** Stage 7.1：營地傳送陣（取代星願石；踩入自動回星芽村） */
  private async buildCampPortal(): Promise<void> {
    this.campPortal = await buildCampPortal(this.scene, {
      x: FIELD_CAMP_PORTAL.x,
      z: FIELD_CAMP_PORTAL.z,
      radius: FIELD_CAMP_PORTAL.visualR,
      surface: (x, z) => this.terrain.surface(x, z),
      baseUrl: import.meta.env.BASE_URL,
      lite: this.lod === "lite",
    });
  }

  private toVillage(): void {
    if (!this.ws || this.leaving || this.ws.leaving || this.ws.mp) return;
    this.leaving = true;
    this.ws.travelTo({ ...FIELD_CAMP_PORTAL.to }, this.combat.hp);
  }

  private respawnInVillage(): void {
    if (!this.ws || this.leaving) return;
    this.leaving = true;
    if (this.ws.mp) {
      // 多人模式：請伺服器送回星芽村（伺服器確認倒地才接受）；收到換地圖通知後切換
      this.ws.save.character.deaths += 1;
      this.ws.mp.respawn();
      return;
    }
    this.ws.save.character.deaths += 1;
    const slot = RESPAWN_SLOTS[this.ws.save.character.deaths % RESPAWN_SLOTS.length]!;
    this.ws.travelTo({ map: "village", x: slot.x, z: slot.z, yaw: slot.yaw }, null);
  }

  private worldFrame(dt: number): void {
    this.campPortal?.update(dt);
    // 踩進營地傳送陣 → 直接回星芽村（先存檔；倒地時不觸發；只觸發一次）
    // 多人模式：傳送陣由伺服器判定
    if (!this.ws?.mp && !this.isDownNow && this.portal.update(this.pos.x, this.pos.z)) this.toVillage();
    this.rememberT += dt;
    if (this.rememberT >= 5 && !this.isDownNow) {
      this.rememberT = 0;
      this.ws!.remember("starsprout", this.pos.x, this.pos.z, this.yaw, this.combat.hp);
    }
  }

  // ---------------- 介面 ----------------
  private buildPanel(): void {
    const toggle = document.createElement("button");
    toggle.className = "map-toggle";
    toggle.textContent = "選單";
    toggle.dataset.layout = "btn-map";
    const panel = document.createElement("div");
    panel.className = "map-panel play-panel";
    panel.style.maxHeight = "70vh";
    panel.style.overflow = "auto";
    this.panel = panel;
    const stop = (e: Event): void => e.stopPropagation();
    toggle.addEventListener("pointerdown", stop);
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) this.renderPanel();
    });
    panel.addEventListener("pointerdown", stop);
    const tabs = document.createElement("div");
    tabs.className = "map-row";
    const tab = (id: "bag" | "pet" | "perf", label: string): void => {
      const b = document.createElement("button");
      b.className = "map-btn";
      b.textContent = label;
      b.dataset.tab = id;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.openPanel(id);
      });
      tabs.appendChild(b);
    };
    tab("bag", "背包");
    tab("pet", "寵物");
    tab("perf", "設定／效能");
    this.panelBody = document.createElement("div");
    this.panelBody.className = "map-info";
    this.panelBody.style.whiteSpace = "normal";
    panel.append(tabs, this.panelBody);
    this.hudRoot.append(toggle, panel);
  }

  private openPanel(tab: "bag" | "pet" | "perf"): void {
    this.panelTab = tab;
    this.panel.classList.add("open");
    this.renderPanel();
  }

  private renderPanel(): void {
    const body = this.panelBody;
    for (const b of this.panel.querySelectorAll<HTMLButtonElement>("[data-tab]")) b.classList.toggle("active", b.dataset.tab === this.panelTab);
    body.innerHTML = "";
    const line = (html: string): HTMLDivElement => {
      const d = document.createElement("div");
      d.style.margin = "4px 0";
      d.innerHTML = html;
      body.appendChild(d);
      return d;
    };
    const row = (): HTMLDivElement => {
      const d = document.createElement("div");
      d.className = "map-row";
      body.appendChild(d);
      return d;
    };
    const btn = (r: HTMLElement, label: string, fn: () => void, enabled = true): HTMLButtonElement => {
      const b = document.createElement("button");
      b.className = "map-btn";
      b.textContent = label;
      b.disabled = !enabled;
      b.style.opacity = enabled ? "1" : "0.45";
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
      });
      r.appendChild(b);
      return b;
    };
    const p = this.pets;
    if (this.panelMsg) line(`<b>${this.panelMsg}</b>`);
    const st = this.stats;
    const b = FIELD_TEST.baseStats;
    if (this.panelTab === "bag") {
      line(p.enabled ? (p.mode === "preview" ? "<small>寵物與掉落：<b>測試設定</b>（不是正式平衡數值）</small>" : "<small>寵物：正式設定</small>") : `<span style="color:#ffb0b0">${p.disabledReason}</span>`);
      line(ITEM_IDS.map((k) => `<span style="color:${ITEM_COLOR[k]}">●</span> ${ITEM_LABEL[k]} <b>${p.save.items[k]}</b>`).join("　"));
      // 每一顆種子／蛋都是獨立個體：可以先到寵物商人鑑定（詞條跟著這一顆），再孵化
      if (p.enabled) {
        const bag = p.bag();
        if (!bag.length) line("<small>背包沒有種子或蛋：打倒怪物會掉落。</small>");
        for (const it of bag) {
          const d = line(
            `<span style="color:${ITEM_COLOR[it.kind]}">●</span> ${ITEM_LABEL[it.kind]} <small>${it.id.replace("item:", "#")}</small>　詞條：${it.affixes ? (it.affixes.length ? it.affixes.map((a) => affixText(p.cfg, a)).join("、") : "沒有屬性") : "未鑑定"}`,
          );
          const r = document.createElement("div");
          r.className = "map-row";
          d.appendChild(r);
          btn(r, "鑑定（寵物商人・測試）", () => void this.appraiseItemVia(it.id), it.affixes === null);
          btn(r, "孵化", () => this.afterPetChange(p.hatch(it.kind, this.petClock, it.id) ? `開始孵化${ITEM_LABEL[it.kind]}${it.affixes ? "（詞條跟著寵物）" : ""}` : "不能孵化"));
        }
      }
      line(`角色屬性（基礎 → 含寵物）：攻擊 ${b.attack} → <b>${st.attack}</b>｜攻速 ${b.attackSpeed} → <b>${st.attackSpeed}</b>（上限 ${CORE_RULES.maxAttackSpeed}）｜防禦 ${b.defense} → <b>${st.defense}</b>｜生命 ${b.maxHp} → <b>${st.maxHp}</b>`);
      const t = this.combat.tuning;
      line(`<small>戰鬥（測試設定）：每下 ${t.attackDamage} 傷害、${t.attackInterval.toFixed(3)} 秒一下、受到傷害 ×${t.damageTakenMul.toFixed(2)}｜擊倒 ${this.kills}、掉落 ${this.dropCount}、撿到 ${this.picked}</small>`);
      return;
    }
    if (this.panelTab === "pet") {
      if (!p.enabled) {
        line(`<span style="color:#ffb0b0">${p.disabledReason}</span>`);
        return;
      }
      line("<small>測試設定：孵化、成長、進化、掉落數值都是暫定（非正式平衡）</small>");
      if (!p.save.pets.length) line("還沒有寵物：打倒星露啵啵撿到種子或蛋，再到「背包」孵化。");
      for (const x of p.save.pets) {
        const sp = p.cfg.species.find((y) => y.id === x.species);
        const on = x.id === p.save.equippedId;
        const hatchLeft = x.stage === 0 ? Math.max(0, (p.tuning.hatchSeconds ?? 0) - (this.petClock - x.obtainedAt) / 1000) : 0;
        const d = line(
          `<div style="padding:4px;border-radius:8px;background:${on ? "rgba(255,210,110,.35)" : "rgba(255,255,255,.12)"}">#${x.id} ${sp?.label ?? x.species}・${sp?.stages[x.stage]?.label ?? x.stage}　` +
            (x.stage === 0 ? `孵化剩 ${Math.ceil(hatchLeft)} 秒` : `經驗 ${Math.floor(x.exp)}／餵食 ${x.feedCount}｜發揮比例 ${(bonusScale(p.cfg, x, p.tuning) * 100).toFixed(0)}%`) +
            `<br>詞條：${x.affixes ? (x.affixes.length ? x.affixes.map((a) => affixText(p.cfg, a)).join("、") : "沒有屬性") : "未鑑定"}</div>`,
        );
        const r = document.createElement("div");
        r.className = "map-row";
        d.appendChild(r);
        btn(r, on ? "卸下" : "裝備", () => {
          p.equip(on ? null : x.id);
          this.afterPetChange(on ? "已卸下寵物" : "已裝備寵物");
        });
        btn(r, "餵材料", () => this.afterPetChange(p.feed(x.id, "monsterMaterial") ? "餵了怪物材料" : "不能餵（還沒孵化或沒有材料）"), x.stage > 0 && p.save.items.monsterMaterial > 0);
        btn(r, "餵飼料", () => this.afterPetChange(p.feed(x.id, "shopFeed") ? "餵了商店飼料" : "不能餵（還沒孵化或沒有飼料）"), x.stage > 0 && p.save.items.shopFeed > 0);
        btn(r, "鑑定", () => void this.appraiseVia(x.id), x.stage > 0 && x.affixes === null);
        const canEvo = x.stage > 0 && x.stage < stageCount(p.cfg, x) - 1 && canEvolve(p.cfg, x, p.tuning);
        btn(r, "進化", () => this.afterPetChange(p.evolve(x.id) ? "進化成功！詞條不變，發揮比例提升" : "還不能進化"), canEvo);
      }
      const r = row();
      btn(r, "寵物商人：買飼料 ×5（測試價格 0）", () => {
        void this.merchant.buyFeed("shopFeed", 5).then((res) => this.afterPetChange(res.ok ? `買了 ${res.data.bought} 份飼料` : res.message));
      });
      line("<small>鑑定與買飼料透過「寵物商人」介面（與星芽村寵物商人相同的服務），之後在星芽村整合時改由商人 NPC 提供。</small>");
      return;
    }
    // 設定／效能
    line(`角色：${this.gender === "male" ? "男" : "女"}｜模型 ${this.lod === "hq" ? "HQ" : "Lite"}（${this.avatar.file}）｜陰影：${this.charShadow === "blob" ? "腳下柔邊（預設）" : "即時"}｜渲染：${this.p3 ? "P3-2 優化" : "原設定"}`);
    const sw = row();
    const go = (k: string, v: string | null): void => {
      const q = new URLSearchParams(location.search);
      if (v === null) q.delete(k);
      else q.set(k, v);
      location.search = q.toString();
    };
    btn(sw, this.gender === "male" ? "換女生" : "換男生", () => go("g", this.gender === "male" ? "female" : null));
    btn(sw, this.lod === "hq" ? "換 Lite" : "換 HQ", () => go("lod", this.lod === "hq" ? "lite" : null));
    btn(sw, this.charShadow === "blob" ? "角色即時陰影" : "腳下柔邊陰影", () => go("charshadow", this.charShadow === "blob" ? "realtime" : null));
    const pr = row();
    btn(pr, "傳送到星露草坪", () => this.toZone01());
    btn(pr, "回營地", () => this.teleport(START.x, START.z));
    const br = row();
    for (const sec of [60, 180])
      btn(br, `實玩效能測試 ${sec} 秒`, () => {
        this.panel.classList.remove("open");
        void this.bench(sec);
      }, !this.benchRun);
    if (this.lastBench) {
      const r = this.lastBench;
      line(
        `<b>上次測試（${r.seconds} 秒，自動打怪）</b><br>平均 ${r.avgFps.toFixed(1)} FPS｜最慢 1% ${r.low1Fps.toFixed(1)}｜最低 ${r.minFps.toFixed(1)}｜前 30 秒 ${r.first30.toFixed(1)}／後 30 秒 ${r.last30.toFixed(1)}<br>Draw ${r.avgDraw.toFixed(0)}｜擊倒 ${r.kills}｜Context Lost ${r.contextLost}｜${r.gender} ${r.lod} ${r.quality} ${r.charShadow}`,
      );
      const ta = document.createElement("textarea");
      ta.readOnly = true;
      ta.style.cssText = "width:100%;height:60px;font-size:11px";
      ta.value = JSON.stringify(r);
      body.appendChild(ta);
    }
  }

  private async appraiseItemVia(itemId: string): Promise<{ ok: boolean; affixes: unknown }> {
    const r = await this.appraisal.appraise(itemId, `play-${Date.now()}-${++this.reqSeq}`);
    this.afterPetChange(r.ok ? `鑑定結果：${r.data.item.affixes?.length ? r.data.item.affixes.map((a) => affixText(this.pets.cfg, a)).join("、") : "沒有屬性"}（永久固定，孵化後跟著寵物）` : r.message);
    return { ok: r.ok, affixes: r.ok ? r.data.item.affixes : null };
  }

  private async appraiseVia(petId: number): Promise<void> {
    const r = await this.merchant.appraise(`pet:${petId}`);
    this.afterPetChange(r.ok ? `鑑定結果：${r.data.lines.map((l) => l.text).join("、")}（永久固定）` : r.message);
  }

  // ---------------- 移動輔助 ----------------
  teleport(x: number, z: number): void {
    this.pos.set(x, this.terrain.surface(x, z), z);
    this.avatar.root.position.copyFrom(this.pos);
    this.camera.snap(this.pos, this.alphaBehind(this.yaw), TUNING.camera.defaultBeta, TUNING.camera.distance);
  }

  toZone01(): void {
    // 草坪西南邊緣，面向草坪中心
    const x = ZONE01.x - 9;
    const z = ZONE01.z - 3;
    this.yaw = Math.atan2(ZONE01.x - x, ZONE01.z - z);
    this.teleport(x, z);
  }

  // ---------------- 實玩效能測試（自動打怪） ----------------
  private autoDrive(): void {
    if (this.combat.isDown) {
      this.input.moveOverride = null;
      return;
    }
    let best: MonsterController | null = null;
    let bd = Infinity;
    for (const m of this.monsters) {
      if (!m.instance.isAlive) continue;
      const d = Math.hypot(m.instance.currentPosition.x - this.pos.x, m.instance.currentPosition.z - this.pos.z);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    // 沒有活著的怪物：在草坪中心附近繞圈（也會撿掉落物）
    const t = best ? best.instance.currentPosition : { x: ZONE01.x + Math.cos(this.now * 0.4) * 5, z: ZONE01.z + Math.sin(this.now * 0.4) * 5 };
    const dx = t.x - this.pos.x;
    const dz = t.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (best && d < 1.6) this.input.moveOverride = null;
    else {
      // 世界方向 → 搖桿輸入（相對鏡頭）
      const f = this.camera.forwardYaw;
      const fx = Math.sin(f), fz = Math.cos(f);
      const rx = fz, rz = -fx;
      this.input.moveOverride = { x: (dx * rx + dz * rz) / Math.max(d, 1e-6), y: (dx * fx + dz * fz) / Math.max(d, 1e-6) };
    }
    if (best && d <= 2.3) this.tryAttack(false);
  }

  bench(seconds: number): Promise<BenchReport> {
    if (this.benchRun) return Promise.reject(new Error("測試進行中"));
    this.toZone01();
    this.autoFight = true;
    this.hud.toast(`實玩效能測試 ${seconds} 秒（自動打怪），請勿觸碰`, 2500);
    return new Promise((resolve) => {
      this.benchRun = { dts: [], draws: [], t: -2, dur: seconds, kills0: this.kills, resolve };
    });
  }

  private benchFrame(rawDt: number): void {
    const b = this.benchRun!;
    b.t += rawDt;
    if (b.t < 0) return; // 前 2 秒暖機不計
    b.dts.push(rawDt);
    b.draws.push(this.perf.drawCalls);
    if (b.t < b.dur) return;
    const s = summarizeFrames(b.dts, b.draws);
    const fpsOf = (arr: number[]): number => (arr.length ? arr.length / arr.reduce((a, c) => a + c, 0) : 0);
    let acc = 0;
    const first: number[] = [];
    for (const d of b.dts) {
      if (acc >= 30) break;
      first.push(d);
      acc += d;
    }
    acc = 0;
    const last: number[] = [];
    for (let i = b.dts.length - 1; i >= 0 && acc < 30; i--) {
      last.push(b.dts[i]!);
      acc += b.dts[i]!;
    }
    const r: BenchReport = {
      seconds: s.seconds,
      avgFps: s.avgFps,
      low1Fps: s.low1Fps,
      minFps: s.minFps,
      avgDraw: s.avgDrawCalls,
      kills: this.kills - b.kills0,
      contextLost: this.contextLost,
      first30: fpsOf(first),
      last30: fpsOf(last),
      quality: this.quality.level,
      gender: this.gender,
      lod: this.lod,
      charShadow: this.charShadow,
    };
    this.benchRun = null;
    this.autoFight = false;
    this.input.moveOverride = null;
    this.lastBench = r;
    this.hud.toast(`測試完成：平均 ${r.avgFps.toFixed(1)} FPS、最慢 1% ${r.low1Fps.toFixed(1)}（選單 → 設定／效能 可複製結果）`, 5000);
    b.resolve(r);
  }

  // ---------------- 測試介面 ----------------
  private installApi(): void {
    const p = this.pets;
    const self = this;
    const api: PlayApi = {
      ready: true,
      info: () => {
        const t = self.avatar.getAttackTiming();
        const eq = p.equipped();
        const head = self.avatar.earAnchor();
        const fp = self.follower.position;
        return {
          gender: self.gender,
          lod: self.lod,
          file: self.avatar.file,
          avatarModel: { modular: self.avatar.parts.length > 0, weapon: self.avatar.weapon, bones: self.avatar.bones, triangles: self.avatar.triangles, parts: self.avatar.parts.map((x) => ({ kind: x.kind, file: x.file, meshes: x.meshes.length, remapped: x.remapped })), clips: [...self.avatar.groups.keys()], attackClips: [...self.avatar.attackClips.keys()] },
          state: self.avatar.state,
          pos: [self.pos.x, self.pos.y, self.pos.z],
          hp: self.combat.hp,
          maxHp: self.combat.tuning.maxHp,
          down: self.combat.isDown,
          speed: self.curSpeed,
          runRate: self.avatar.runRate,
          slide: runRate(self.curSpeed, self.avatar.groundSpeed).slide,
          attack: { interval: self.combat.tuning.attackInterval, hitAt: t.hitAt, attackSpeed: t.attackSpeed, damage: self.combat.tuning.attackDamage },
          stats: { ...self.stats },
          kills: self.kills,
          hits: self.hits,
          gameTime: self.now,
          drops: self.dropCount,
          picked: self.picked,
          loot: self.loot.drops.length,
          mp: self.ws?.mp ? { state: self.ws.mp.client.state, pid: self.ws.mp.client.pid, room: self.ws.mp.client.room, down: self.ws.mp.client.down, stats: { ...self.ws.mp.client.stats }, server: { ...self.ws.mp.client.server }, remotes: self.ws.mp.remoteInfo(), field: self.mpField?.info() ?? null, look: self.look ? { weapon: self.look.weapon?.kind ?? null, hairTinted: self.look.hairTinted } : null } : null,
          monsters: self.monsters.map((m) => {
            const v = m.visual instanceof RiggedMonsterVisual ? m.visual : null;
            return {
              id: m.instance.instanceId,
              kind: m.instance.definition.monsterId,
              level: m.instance.definition.level,
              aggressive: isAggressive(m.instance.definition),
              provoked: m.instance.provoked,
              state: m.instance.sm.state,
              mode: m.brain?.mode ?? null,
              hp: m.instance.currentHp,
              maxHp: m.instance.definition.maxHp,
              x: m.instance.currentPosition.x,
              z: m.instance.currentPosition.z,
              speed: Math.round(m.groundSpeed * 100) / 100,
              attacks: { ...m.instance.attackLog },
              ...(v ? { rig: { clip: v.clip, ratio: Math.round(v.ratio * 1000) / 1000, weights: v.weights(), hpBar: v.hpBarVisible, hpBarY: v.hpBarWorldY, lod: v.asset?.lod ?? null, fixture: v.asset?.check.fixture ?? null, visible: v.root.isEnabled(), animMode: v.animMode, shadow: v.shadowCasting, manualSteps: v.manualSteps } } : {}),
              tier: self.tiers.get(m) ?? null,
              stride: m.visualStride,
              visualUpdates: m.visualUpdates,
            };
          }),
          foxStatus: self.foxStatus,
          fieldMonsters: self.fieldStatus.map((x) => ({ ...x })),
          monsterDetail: { on: self.detailOn, ...self.tierCount },
          combatFx: self.fx ? { tier: self.fx.tier, ...self.fx.stats, damageShown: self.fx.numbers.shown, knockbacks: self.knockbacks, knockSkipped: self.knockSkipped } : null,
          pets: {
            enabled: p.enabled,
            mode: p.mode,
            reason: p.disabledReason,
            items: { ...p.save.items },
            count: p.save.pets.length,
            equipped: eq?.id ?? null,
            followerVisible: self.follower.visible,
            followerDist: Math.hypot(fp.x - head.x, fp.y - head.y, fp.z - head.z),
          },
          render: { p3: self.p3, pipeline: self.quality.postProcess, charShadow: self.charShadow, drawCalls: self.perf.drawCalls, fps: self.engine.getFps(), contextLost: self.contextLost },
        };
      },
      setMove: (x, y) => (self.input.moveOverride = x === 0 && y === 0 ? null : { x, y }),
      press: (a) => (a === "attack" ? void self.tryAttack(false) : a === "skill" ? void self.mpField?.skill(self.ws?.save.character.appearance.weapon ?? "sword") : (self.pending.jump = true)),
      teleport: (x, z) => self.teleport(x, z),
      toZone01: () => self.toZone01(),
      heal: () => {
        if (!self.combat.isDown) self.combat.hp = self.combat.tuning.maxHp;
      },
      setMonsterHp: (id, hp) => {
        const m = self.monsters.find((x) => x.instance.instanceId === id);
        if (!m || !m.instance.isAlive) return false;
        m.instance.currentHp = Math.max(1, Math.floor(hp));
        return true;
      },
      pet: {
        give: (item, n = 1) => p.giveItem(item, n),
        hatch: (source) => {
          const pet = p.hatch(source, self.petClock);
          self.afterPetChange("");
          return pet?.id ?? null;
        },
        timeWarp: (seconds) => {
          self.petClock += seconds * 1000;
          self.petSkew += seconds * 1000;
          self.tickPets();
        },
        feed: (food) => {
          const eq = p.equipped() ?? p.save.pets.find((x) => x.stage > 0) ?? null;
          const ok = !!eq && p.feed(eq.id, food);
          self.afterPetChange("");
          return ok;
        },
        appraise: async () => {
          const target = p.save.pets.find((x) => x.stage > 0) ?? null;
          if (!target) return false;
          const r = await self.merchant.appraise(`pet:${target.id}`);
          self.afterPetChange("");
          return r.ok;
        },
        evolve: () => {
          const target = p.save.pets.find((x) => x.stage > 0) ?? null;
          const ok = !!target && p.evolve(target.id);
          self.afterPetChange("");
          return ok;
        },
        equip: (id) => {
          const ok = p.equip(id);
          self.afterPetChange("");
          return ok;
        },
        reset: () => {
          p.save = JSON.parse(new PetManager(p.cfg, self.rng, p.mode).serialize());
          self.afterPetChange("");
        },
        list: () => p.save.pets.map((x) => ({ id: x.id, stage: x.stage, affixes: x.affixes })),
        bag: () => p.bag().map((b) => ({ id: b.id, kind: b.kind, affixes: b.affixes })),
        appraiseItem: (itemId) => self.appraiseItemVia(itemId),
        hatchItem: (itemId) => {
          const it = p.bag().find((b) => b.id === itemId);
          const pet = it ? p.hatch(it.kind, self.petClock, itemId) : null;
          self.afterPetChange("");
          return pet?.id ?? null;
        },
      },
      bench: (s) => self.bench(s),
      // Stage 7.4：與「複製報告」相同的資料（CI 對照用）
      perf: { session: () => self.perf.session(), reset: () => self.perf.resetSession() },
      world: self.ws
        ? {
            info: () => {
              const ws = self.ws!;
              return {
                map: "starsprout",
                gold: ws.save.wallet.balance,
                deaths: ws.save.character.deaths,
                level: ws.progress.level,
                exp: ws.progress.exp,
                expGained: self.expGained,
                appearance: { ...ws.save.character.appearance },
                hp: self.combat.hp,
                down: self.combat.isDown,
                deathClip: self.avatar.hasDeathClip,
                state: self.avatar.state,
                portal: { armed: self.portal.isArmed, fired: self.portal.hasFired, dist: self.portal.distance(self.pos.x, self.pos.z), triggerR: self.portal.spec.triggerR, built: !!self.campPortal, meshes: self.campPortal?.meshes.length ?? 0 },
                panel: self.wpanel?.where ?? "closed",
                petGap: self.follower.headGap,
                headHalfWidth: self.avatar.headHalfWidth,
                goldDropped: self.goldDropped,
                goldPicked: self.goldPicked,
                goldOnGround: self.lootGold.size,
                jumpButton: [...self.hudRoot.querySelectorAll<HTMLButtonElement>("button")].some((x) => x.textContent?.includes("跳躍") && x.offsetParent !== null),
                claimed: ws.save.lootClaimed.length,
                ledger: ws.save.wallet.ledger.slice(-20),
                bag: p.bag().length,
                items: { ...p.save.items },
                pets: p.save.pets.map((x) => ({ id: x.id, stage: x.stage, life: x.life ?? "alive", satiety: x.satiety ?? null })),
                followerSize: self.follower.size,
                loot: self.loot.drops.map((d) => ({ x: d.x, z: d.z, gold: self.lootGold.get(d.id)?.gold ?? 0 })),
              };
            },
            toVillage: () => self.toVillage(),
            setHp: (hp: number) => {
              self.combat.hp = Math.max(0, Math.min(self.combat.tuning.maxHp, hp));
            },
          }
        : undefined,
    };
    window.__starwishPlay = api;
  }
}
