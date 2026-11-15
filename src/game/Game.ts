import {
  Color3,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Scene,
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

    this.hud = new Hud(hudRoot);
    this.hud.setLevel(1);
    // W1 尚無戰鬥與成長系統：顯示固定測試數值
    this.hud.setBars({ hp: 100, maxHp: 100, mp: 50, maxMp: 50, exp: 0, expToNext: 100 });
    this.hud.events.on("skillPressed", ({ slot }) => {
      this.hud.toast(slot === "attack" ? "普通攻擊將於 W2 啟用" : "技能將於 W2 啟用", 1200);
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
      this.hud.toast("W1 測試版：左下搖桿移動，拖曳畫面旋轉視角，雙指縮放", 4000);
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

    const move = this.input.getMove();
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
    this.yaw = turnTowards(this.yaw, step.dirX, step.dirZ, TUNING.player.turnSharpness, dt);

    const root = this.player.root;
    root.position.copyFrom(this.position);
    root.rotation.y = this.yaw;
    this.player.update(dt, Math.min(1, Math.hypot(move.x, move.y)));

    this.camera.update(dt, this.position, this.input.consumeCamera());

    // 陰影跟著角色，只算附近範圍
    this.sun.position.copyFrom(this.position).subtractInPlace(this.sun.direction.scale(45));

    this.world.update(dt);
    this.scene.render();
    this.perfOverlay.update(dt);

    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fpsTimer = 0;
      this.hud.setFps(this.engine.getFps());
    }
  };

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
        bloom: this.render.glow !== null,
        shadowFilter: this.quality.shadows.filter,
        shadowMap: this.quality.shadows.mapSize,
      }),
      renderer: () => ({
        webgl: this.engine.webGLVersion,
        hardwareScaling: this.engine.getHardwareScalingLevel(),
        width: this.engine.getRenderWidth(),
        height: this.engine.getRenderHeight(),
      }),
    };
  }
}
