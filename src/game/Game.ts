import {
  Color3,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Matrix,
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
    shadows.darkness = 0.35;

    this.world = buildMeadow(scene, shadows);
    this.player = new PlayerAvatar(scene, shadows);
    this.position.set(0, heightAt(0, 0), 0);
    this.player.root.position.copyFrom(this.position);
    this.camera = new ThirdPersonCamera(scene, this.position);
    scene.activeCamera = this.camera.camera;
    // 色調映射、曝光、後製抗鋸齒、選擇性 Bloom
    this.render = setupRendering(scene, this.camera.camera, this.quality);

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
    this.monsters = previewSpawnPoints(0, 0, this.camera.forwardYaw).map((p) =>
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
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.engine.runRenderLoop(this.frame);
    if (!this.welcomed) {
      this.welcomed = true;
      this.hud.toast("預覽測試：前方有 3 隻星露啵啵，靠近後按攻擊鍵（測試用數值）", 4500);
    }
  }

  stop(): void {
    this.running = false;
    this.engine.stopRenderLoop(this.frame);
  }

  private frame = (): void => {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.1);
    this.timeFrames++;
    this.timeSum += dt;
    this.timeMax = Math.max(this.timeMax, dt);
    this.timeMin = Math.min(this.timeMin, dt);
    this.keyboard.update();
    this.now += dt;

    const down = this.combat.isDown;
    const rawMove = this.input.getMove();
    const move = down ? { x: 0, y: 0 } : rawMove;
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
    this.player.update(dt, Math.min(1, Math.hypot(move.x, move.y)));
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

    this.camera.update(dt, this.position, this.input.consumeCamera());

    // 陰影跟著角色，只算附近範圍
    this.sun.position.copyFrom(this.position).subtractInPlace(this.sun.direction.scale(45));

    if (!this.photoMode) this.updateMonsters(dt);

    this.world.update(dt);
    this.scene.render();
    this.perfOverlay.update(dt);

    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fpsTimer = 0;
      this.hud.setFps(this.engine.getFps());
    }
  };

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
    const hit = this.combat.resolvePending(this.now, this.position.x, this.position.z, this.monsters.map((m) => m.instance));
    if (hit) this.handleHit(hit);
    if (this.combat.update(this.now)) {
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
