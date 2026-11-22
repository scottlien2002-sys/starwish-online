import { Color3, DirectionalLight, type Engine, HemisphericLight, Scene, ShadowGenerator, Vector3 } from "@babylonjs/core";
import { TUNING } from "../../config/tuning.ts";
import { angleDelta, damp } from "../../core/math.ts";
import { InputState } from "../../input/InputState.ts";
import { VirtualJoystick } from "../../input/VirtualJoystick.ts";
import { CameraTouchControl } from "../../input/CameraTouchControl.ts";
import { KeyboardInput } from "../../input/KeyboardInput.ts";
import { Hud } from "../../ui/Hud.ts";
import { PlayerAvatar } from "../../actors/PlayerAvatar.ts";
import { inputToWorld, turnTowards } from "../../actors/movement.ts";
import { ThirdPersonCamera } from "../../camera/ThirdPersonCamera.ts";
import { SKY_COLORS, createEngine, createShadows, createSkyDome, pickQuality, setupRendering, type RenderSetup } from "../../render/RenderQuality.ts";
import { PerfOverlay } from "../../render/PerfOverlay.ts";
import type { QualitySettings } from "../../render/quality.ts";
import { summarizeFrames } from "../../render/benchmark.ts";
import { ARENA, BRIDGES, MAIN_ROUTE, POIS, PORTAL, WALK_SPEED, ZONES } from "./layout.ts";
import { StarsproutTerrain, resolveMove } from "./terrain.ts";
import { MAP_COLLIDERS, PLAYER_RADIUS, RouteFollower, routeTable } from "./route.ts";
import { buildStarsproutWorld, type MapLod, type StarsproutWorld } from "./StarsproutWorld.ts";

/**
 * Stage 6 第一階段：星芽原野地形與主要路線測試頁（?map=starsprout）。
 * - 沒有怪物、沒有戰鬥（之後的階段再整合；已驗收的 V3.8R 戰鬥規則不在這頁修改）
 * - 路線測試：角色以遊戲移動速度（5 m/s）自動沿主路走到傳送門，記錄時間、卡住、FPS
 * - 不修改正式遊戲；新手草原（預設網址）完全不受影響
 */

interface Spot {
  id: string;
  label: string;
  x: number;
  z: number;
}

const SPOTS: Spot[] = [
  { id: "camp", label: "營地", x: MAIN_ROUTE[0]!.x, z: MAIN_ROUTE[0]!.z },
  ...ZONES.filter((z) => z.id !== "camp").map((z) => ({ id: z.id, label: z.id, x: z.id === "07" ? 0 : z.x, z: z.id === "07" ? 60 : z.z })),
  { id: "bridge", label: "B1 橋", x: MAIN_ROUTE.find((p) => p.id === "P4")!.x, z: MAIN_ROUTE.find((p) => p.id === "P4")!.z },
  { id: "stairs", label: "石階", x: 0, z: 40 },
  { id: "portal", label: "傳送門", x: PORTAL.x, z: PORTAL.z - 5 },
  ...POIS.map((p) => ({ id: p.id, label: p.name, x: p.x, z: p.z })),
];

interface RouteRun {
  loops: number;
  loop: number;
  phase: "warmup" | "running" | "done";
  warm: number;
  t: number;
  loopT: number;
  follower: RouteFollower;
  next: number;
  loopTimes: number[];
  checkpoints: { id: string; t: number }[];
  dts: number[];
  draws: number[];
  tris: number[];
  stuck: { x: number; z: number; t: number }[];
  lastProgress: number;
  lastProgressT: number;
  blocked: number;
  walked: number;
  renderStart: string;
  renderEnd: string;
  label: string;
}

export interface MapRouteResult {
  label: string;
  loops: number;
  loopTimes: number[];
  checkpoints: { id: string; t: number }[];
  walked: number;
  stuck: { x: number; z: number; t: number }[];
  blockedFrames: number;
  avgFps: number;
  low1Fps: number;
  minFps: number;
  stutters: number;
  avgDraw: number;
  maxDraw: number;
  avgTris: number;
  windows: { from: number; to: number; fps: number }[];
  renderStart: string;
  renderEnd: string;
  contextLost: number;
}

declare global {
  interface Window {
    __starwishMap?: unknown;
  }
}

export function startStarsproutMap(canvas: HTMLCanvasElement, hudRoot: HTMLElement): Promise<void> {
  const page = new StarsproutPage(canvas, hudRoot);
  page.start();
  return Promise.resolve();
}

class StarsproutPage {
  private readonly quality: QualitySettings;
  private readonly lod: MapLod;
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly terrain: StarsproutTerrain;
  private readonly world: StarsproutWorld;
  private readonly player: PlayerAvatar;
  private readonly camera: ThirdPersonCamera;
  private readonly sun: DirectionalLight;
  private readonly shadows: ShadowGenerator;
  private readonly render: RenderSetup;
  private readonly perf: PerfOverlay;
  private readonly hud: Hud;
  private readonly input = new InputState();
  private readonly keyboard: KeyboardInput;
  private readonly pos = new Vector3();
  private yaw = 0;
  private overview = false;
  private run: RouteRun | null = null;
  private lastResult: MapRouteResult | null = null;
  private contextLost = 0;
  private inPortal = false;
  private loadMs = 0;
  private fpsTimer = 0;
  private shadowQ: "default" | "medium" = "default";
  private glowOff = false;
  private lockRatio: number | null = null;
  private diag = new Set<string>();
  private fxLegacy = false;
  /** 截圖用：畫面完全靜止（角色、鏡頭、水流、傳送門呼吸都停住） */
  private frozen = false;
  private panel!: HTMLDivElement;
  private info!: HTMLDivElement;
  private reportBox!: HTMLTextAreaElement;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    const t0 = performance.now();
    const params = new URLSearchParams(location.search);
    this.lod = params.get("lod") === "lite" ? "lite" : "hq";
    this.quality = pickQuality();
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
    // 效能對照（預設不變）：&shadowq=medium = 與正式遊戲 V3.8R 相同的 PCSS32 柔和陰影取樣
    this.shadowQ = params.get("shadowq") === "medium" && this.shadows.useContactHardeningShadow ? "medium" : "default";
    if (this.shadowQ === "medium") this.shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    const res = Number(params.get("res"));
    this.lockRatio = res >= 1 && res <= 3 ? res : null;

    this.terrain = new StarsproutTerrain();
    const start = MAIN_ROUTE[0]!;
    this.pos.set(start.x, this.terrain.surface(start.x, start.z), start.z);
    this.player = new PlayerAvatar(scene, this.shadows);
    this.player.root.position.copyFrom(this.pos);
    this.camera = new ThirdPersonCamera(scene, this.pos, (x, z) => this.terrain.surface(x, z));
    scene.activeCamera = this.camera.camera;
    // 出生時面向第一段路（往東北）
    this.yaw = Math.atan2(MAIN_ROUTE[1]!.x - start.x, MAIN_ROUTE[1]!.z - start.z);
    this.camera.snap(this.pos, this.alphaBehind(this.yaw), TUNING.camera.defaultBeta, TUNING.camera.distance);
    // 診斷開關（預設全部關閉）：&diag=noglow,nohdr,norune,noportal；&fx=old 重現修正前的發光效果
    this.diag = new Set((params.get("diag") ?? "").split(",").filter(Boolean));
    this.fxLegacy = params.get("fx") === "old";
    this.render = setupRendering(scene, this.camera.camera, this.quality, this.diag.has("nohdr") ? { hdr: false } : {});
    // 效能對照：&glow=0 關閉發光層（遺跡符文、傳送門不發光暈）
    this.glowOff = params.get("glow") === "0" || this.diag.has("noglow");
    if (this.glowOff && this.render.glow) this.render.glow.isEnabled = false;
    this.world = buildStarsproutWorld(scene, this.terrain, this.shadows, this.render.glow, this.lod, {
      legacy: this.fxLegacy,
      runeOff: this.diag.has("norune"),
      portalOff: this.diag.has("noportal"),
    });
    if (params.get("labels") === "0") this.world.setLabels(false);
    if (params.get("nav") === "1") this.world.setNav(true);

    this.hud = new Hud(hudRoot);
    this.hud.setLevel(1);
    this.hud.setBars({ hp: 100, maxHp: 100, mp: 40, maxMp: 40, exp: 0, expToNext: 100 });
    const build = hudRoot.querySelector<HTMLSpanElement>(".hud-build");
    if (build) build.textContent = `Stage 6 P1 ${this.lod === "hq" ? "HQ" : "Lite"}`;
    this.hud.events.on("skillPressed", () => this.hud.toast("地形測試頁：這一階段沒有怪物與戰鬥", 1500));
    new VirtualJoystick(this.hud.joystickZone, this.input, TUNING.joystick.radius, TUNING.joystick.deadZone);
    new CameraTouchControl(canvas, this.input, TUNING.camera.rotateSensitivity, TUNING.camera.pitchSensitivity, TUNING.camera.pinchSensitivity);
    this.keyboard = new KeyboardInput(this.input, () => false);
    this.perf = new PerfOverlay(this.engine, scene, this.quality, hudRoot);
    this.buildPanel(hudRoot);
    window.addEventListener("resize", () => this.engine.resize());
    this.loadMs = performance.now() - t0;
    this.installApi();

    const auto = params.get("autoplay");
    if (auto === "route") window.setTimeout(() => this.startRoute(Math.max(1, Math.min(10, Number(params.get("loops") ?? 1) || 1))), 300);
  }

  start(): void {
    this.engine.runRenderLoop(this.frame);
    this.hud.toast("星芽原野 第一階段：地形與主要路線（沒有怪物）。右上「地圖」可傳送與做路線測試", 4200);
  }

  /** 鏡頭在角色正後方時的 alpha */
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
    const run = this.run;
    let moveX = 0;
    let moveZ = 0;
    let speed01 = 0;
    if (run && run.phase === "running") {
      const dir = run.follower.update(this.pos.x, this.pos.z);
      const l = Math.hypot(dir.dx, dir.dz);
      if (l > 1e-6) {
        moveX = dir.dx / l;
        moveZ = dir.dz / l;
        speed01 = 1;
      }
    } else if (!run || run.phase === "done") {
      const m = this.input.getMove();
      const w = inputToWorld(m.x, m.y, this.camera.forwardYaw);
      const l = Math.hypot(w.x, w.z);
      const s = l > 1 ? 1 / l : 1;
      moveX = w.x * s;
      moveZ = w.z * s;
      speed01 = Math.min(1, l);
    }
    if (speed01 > 0 && !this.overview) {
      const nx = this.pos.x + moveX * WALK_SPEED * dt;
      const nz = this.pos.z + moveZ * WALK_SPEED * dt;
      const r = resolveMove(this.terrain, MAP_COLLIDERS, PLAYER_RADIUS, this.pos.x, this.pos.z, nx, nz);
      if (run && run.phase === "running") {
        if (r.blocked) run.blocked++;
        run.walked += Math.hypot(r.x - this.pos.x, r.z - this.pos.z);
      }
      this.pos.x = r.x;
      this.pos.z = r.z;
      this.yaw = turnTowards(this.yaw, moveX, moveZ, TUNING.player.turnSharpness, dt);
    }
    this.pos.y = this.terrain.surface(this.pos.x, this.pos.z);
    this.player.root.position.copyFrom(this.pos);
    this.player.root.rotation.y = this.yaw;
    this.player.update(dt, this.overview ? 0 : speed01);

    const cam = this.input.consumeCamera();
    if (!this.overview) {
      if (run && run.phase !== "done") {
        // 路線測試：鏡頭自動轉到角色後方（觸控旋轉不生效）
        const c = this.camera.camera;
        c.alpha += angleDelta(c.alpha, this.alphaBehind(this.yaw)) * damp(3, dt);
        this.camera.update(dt, this.pos, { yaw: 0, pitch: 0, zoom: 0 });
      } else {
        this.camera.update(dt, this.pos, cam);
      }
    }
    this.sun.position.copyFrom(this.pos).subtractInPlace(this.sun.direction.scale(45));
    this.world.update(dt, this.overview ? 1e6 : this.pos.x, this.overview ? 1e6 : this.pos.z);
    this.checkPortal();
    this.scene.render();
    this.perf.update(dt);
    if (run) this.routeFrame(run, rawDt, dt);
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fpsTimer = 0;
      this.hud.setFps(this.engine.getFps());
      this.updateInfo();
    }
  };

  private checkPortal(): void {
    const d = Math.hypot(this.pos.x - PORTAL.x, this.pos.z - PORTAL.z);
    if (d < 1.8 && !this.inPortal) {
      this.inPortal = true;
      if (!this.run || this.run.phase === "done") this.hud.toast("傳送門：擊敗王冠重錘兔並達成通關條件後才能使用（第一階段尚無 Boss）", 3000);
    } else if (d > 3) {
      this.inPortal = false;
    }
  }

  // ---------------- 傳送與視角 ----------------
  teleport(x: number, z: number, faceYaw?: number): void {
    this.setOverview(false);
    this.pos.set(x, this.terrain.surface(x, z), z);
    if (faceYaw !== undefined) this.yaw = faceYaw;
    this.player.root.position.copyFrom(this.pos);
    this.camera.snap(this.pos, this.alphaBehind(this.yaw), TUNING.camera.defaultBeta, TUNING.camera.distance);
  }

  setOverview(on: boolean): void {
    if (on === this.overview) return;
    this.overview = on;
    const c = this.camera.camera;
    if (on) {
      this.scene.fogMode = Scene.FOGMODE_NONE;
      c.target.set(0, 8, 0);
      c.alpha = -Math.PI / 2;
      c.beta = 0.62;
      c.radius = 175;
    } else {
      this.scene.fogMode = Scene.FOGMODE_LINEAR;
      this.camera.snap(this.pos, this.alphaBehind(this.yaw), TUNING.camera.defaultBeta, TUNING.camera.distance);
    }
  }

  /** 截圖用固定視角 */
  view(name: string): void {
    const at = (x: number, z: number, yawDeg: number, beta: number, radius: number): void => {
      this.teleport(x, z, (yawDeg * Math.PI) / 180);
      this.camera.snap(this.pos, this.alphaBehind(this.yaw), beta, radius);
    };
    switch (name) {
      case "overview":
        this.setOverview(true);
        break;
      case "camp":
        at(-56, -64, 45, 1.1, 12);
        break;
      case "bridge":
        at(MAIN_ROUTE.find((p) => p.id === "P4")!.x, MAIN_ROUTE.find((p) => p.id === "P4")!.z, 31, 1.15, 12);
        break;
      case "ruins":
        at(0, 36, 0, 1.2, 14);
        break;
      case "arena":
        at(0, 58, 0, 1.0, 15);
        break;
      case "highland":
        at(30, 8, 45, 1.1, 14);
        break;
      case "farm":
        at(-24, 30, 60, 1.0, 15);
        break;
      default:
        break;
    }
  }

  // ---------------- 路線測試 ----------------
  startRoute(loops: number): void {
    this.setOverview(false);
    this.teleport(MAIN_ROUTE[0]!.x, MAIN_ROUTE[0]!.z, Math.atan2(MAIN_ROUTE[1]!.x - MAIN_ROUTE[0]!.x, MAIN_ROUTE[1]!.z - MAIN_ROUTE[0]!.z));
    // 測試期間固定解析度（畫質上限），結果才能互相比較
    const ratio = this.lockRatio ?? Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio);
    this.perf.lockResolution(ratio);
    this.run = {
      loops,
      loop: 0,
      phase: "warmup",
      warm: 0,
      t: 0,
      loopT: 0,
      follower: new RouteFollower(MAIN_ROUTE),
      next: 1,
      loopTimes: [],
      checkpoints: [{ id: MAIN_ROUTE[0]!.id, t: 0 }],
      dts: [],
      draws: [],
      tris: [],
      stuck: [],
      lastProgress: 0,
      lastProgressT: 0,
      blocked: 0,
      walked: 0,
      renderStart: "",
      renderEnd: "",
      label: loops > 1 ? `路線 ${loops} 圈（約 ${Math.round((loops * 58) / 60)} 分鐘）` : "路線 1 圈",
    };
    this.hud.toast(`${this.run.label}：自動沿主路走到傳送門（請不要操作）`, 2500);
  }

  private renderSize(): string {
    return `${this.engine.getRenderWidth()}×${this.engine.getRenderHeight()} @${this.perf.pixelRatio}x`;
  }

  private routeFrame(run: RouteRun, rawDt: number, dt: number): void {
    if (run.phase === "done") return;
    if (run.phase === "warmup") {
      run.warm += rawDt;
      if (run.warm >= 2) {
        run.phase = "running";
        run.renderStart = this.renderSize();
      }
      return;
    }
    run.t += dt;
    run.loopT += dt;
    run.dts.push(rawDt);
    run.draws.push(this.perf.drawCalls);
    run.tris.push(this.scene.getActiveIndices() / 3);
    if (run.loop === 0) {
      while (run.next < MAIN_ROUTE.length && Math.hypot(MAIN_ROUTE[run.next]!.x - this.pos.x, MAIN_ROUTE[run.next]!.z - this.pos.z) < 2.5) {
        run.checkpoints.push({ id: MAIN_ROUTE[run.next]!.id, t: run.loopT });
        run.next++;
      }
    }
    if (run.follower.progress > run.lastProgress + 0.5) {
      run.lastProgress = run.follower.progress;
      run.lastProgressT = run.loopT;
    } else if (run.loopT - run.lastProgressT > 3) {
      run.stuck.push({ x: Math.round(this.pos.x * 10) / 10, z: Math.round(this.pos.z * 10) / 10, t: Math.round(run.loopT * 10) / 10 });
      this.finishRoute(run, "卡住");
      return;
    }
    const end = MAIN_ROUTE[MAIN_ROUTE.length - 1]!;
    if (run.follower.done && Math.hypot(end.x - this.pos.x, end.z - this.pos.z) < 1.2) {
      run.loopTimes.push(run.loopT);
      run.loop++;
      if (run.loop >= run.loops) {
        this.finishRoute(run, "完成");
        return;
      }
      // 下一圈：回到出生點
      this.teleport(MAIN_ROUTE[0]!.x, MAIN_ROUTE[0]!.z, Math.atan2(MAIN_ROUTE[1]!.x - MAIN_ROUTE[0]!.x, MAIN_ROUTE[1]!.z - MAIN_ROUTE[0]!.z));
      run.follower.reset();
      run.loopT = 0;
      run.lastProgress = 0;
      run.lastProgressT = 0;
    }
    if (run.t > 60 * 12) this.finishRoute(run, "逾時");
  }

  private finishRoute(run: RouteRun, why: string): void {
    run.phase = "done";
    run.renderEnd = this.renderSize();
    this.perf.lockResolution(null);
    const s = summarizeFrames(run.dts, run.draws);
    const windows: MapRouteResult["windows"] = [];
    let acc = 0;
    let n = 0;
    let from = 0;
    for (const d of run.dts) {
      acc += d;
      n++;
      if (acc >= 30) {
        windows.push({ from, to: from + Math.round(acc), fps: n / acc });
        from += Math.round(acc);
        acc = 0;
        n = 0;
      }
    }
    if (n > 0 && acc > 3) windows.push({ from, to: from + Math.round(acc), fps: n / acc });
    this.lastResult = {
      label: `${run.label}（${why}）`,
      loops: run.loops,
      loopTimes: run.loopTimes,
      checkpoints: run.checkpoints,
      walked: run.walked,
      stuck: run.stuck,
      blockedFrames: run.blocked,
      avgFps: s.avgFps,
      low1Fps: s.low1Fps,
      minFps: s.minFps,
      stutters: run.dts.filter((d) => d > 0.05).length,
      avgDraw: s.avgDrawCalls,
      maxDraw: s.maxDrawCalls,
      avgTris: run.tris.length ? run.tris.reduce((a, b) => a + b, 0) / run.tris.length : 0,
      windows,
      renderStart: run.renderStart,
      renderEnd: run.renderEnd,
      contextLost: this.contextLost,
    };
    this.reportBox.value = this.report();
    this.panel.classList.add("open");
    this.reportBox.hidden = false;
    this.hud.toast(`${run.label}${why}：${run.loopTimes.map((t) => t.toFixed(1) + " 秒").join("、") || "未走完"}`, 4000);
  }

  modeName(): string {
    if (this.quality.level === "high" && this.lod === "hq") return "HQ";
    if (this.quality.level === "medium" && this.lod === "lite") return "Lite 中畫質";
    if (this.quality.level === "low" && this.lod === "lite") return "Lite 低畫質";
    return `非標準組合（${this.quality.level}＋${this.lod}）`;
  }

  report(): string {
    const r = this.lastResult;
    const lines: string[] = [];
    const now = new Date();
    lines.push(`星願物語 Stage 6 P1 星芽原野 地形與路線測試報告`);
    lines.push(`時間 ${now.toLocaleString("zh-TW", { hour12: false })}`);
    lines.push(`網址參數 ${location.search || "(無)"}`);
    lines.push(`裝置 ${navigator.userAgent}`);
    const mode = this.modeName();
    lines.push(`模式 ${mode}：渲染畫質 ${this.quality.level}（解析度上限 ${this.quality.maxPixelRatio}x、後製 ${this.quality.postProcess ? "開" : "關"}、陰影 ${this.quality.shadows.filter === "contact" ? "柔和 PCSS" : "PCF"} ${this.quality.shadows.mapSize}）／地圖 ${this.lod === "hq" ? "HQ" : "Lite"}／載入 ${Math.round(this.loadMs)} ms`);
    lines.push(`發光效果 ${this.fxLegacy ? "修正前（fx=old）" : "修正後"}；診斷 ${[...this.diag].join(",") || "無"}`);
    lines.push(`對照設定：陰影 ${this.shadowQ === "medium" ? "PCSS32（中）" : "預設（高）"}／發光層 ${this.glowOff || !this.render.glow ? "關" : "開"}／測試解析度 ${this.lockRatio ? this.lockRatio + "x" : "畫質上限"}`);
    lines.push(`地形 ${this.world.chunks.length} 塊、${this.world.terrainVerts} 頂點、${this.world.terrainTris} 三角形`);
    const table = routeTable();
    lines.push(`主路線（直線）${table[table.length - 1]!.cum.toFixed(1)} 公尺；移動速度 ${WALK_SPEED} m/s`);
    if (!r) {
      lines.push("尚未執行路線測試");
      return lines.join("\n");
    }
    lines.push(`---- ${r.label} ----`);
    lines.push(`每圈時間：${r.loopTimes.map((t) => t.toFixed(1) + " 秒").join("、") || "未走完"}`);
    lines.push(`實際走過 ${r.walked.toFixed(1)} 公尺；被擋住（沿牆滑動）${r.blockedFrames} 幀；卡住 ${r.stuck.length} 次 ${r.stuck.map((s) => `(${s.x},${s.z} @${s.t}s)`).join(" ")}`);
    lines.push(`第一圈路線點：${r.checkpoints.map((c) => `${c.id} ${c.t.toFixed(1)}`).join("｜")}`);
    lines.push(`FPS 平均 ${r.avgFps.toFixed(1)}／1% Low ${r.low1Fps.toFixed(1)}／最低 ${r.minFps.toFixed(1)}／卡頓(>50ms) ${r.stutters} 幀`);
    lines.push(`Draw Calls 平均 ${r.avgDraw.toFixed(0)}／最高 ${r.maxDraw}；每格三角形平均 ${Math.round(r.avgTris)}`);
    lines.push(`每 30 秒平均 FPS：${r.windows.map((w) => `${w.from}-${w.to}s ${w.fps.toFixed(1)}`).join("｜")}`);
    lines.push(`渲染解析度 開始 ${r.renderStart}／結束 ${r.renderEnd}；WebGL Context Lost ${r.contextLost} 次`);
    return lines.join("\n");
  }

  // ---------------- 介面 ----------------
  private buildPanel(hudRoot: HTMLElement): void {
    const toggle = document.createElement("button");
    toggle.className = "map-toggle";
    toggle.textContent = "地圖";
    toggle.dataset.layout = "btn-map";
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
    title.textContent = "星芽原野 Stage 6 P1　地形與路線";
    this.info = document.createElement("div");
    this.info.className = "map-info";
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
    panel.append(title, this.info);
    const go = section("傳送");
    for (const s of SPOTS) {
      btn(go, s.label, () => {
        const yaw = s.id === "07" || s.id === "portal" || s.id === "stairs" ? 0 : undefined;
        this.teleport(s.x, s.z, yaw);
        panel.classList.remove("open");
      });
    }
    const show = section("顯示");
    const labelsBtn = btn(show, "標示：開", () => {
      this.world.setLabels(!this.world.labelsOn);
      labelsBtn.textContent = `標示：${this.world.labelsOn ? "開" : "關"}`;
    });
    if (!this.world.labelsOn) labelsBtn.textContent = "標示：關";
    const navBtn = btn(show, "不可走範圍：關", () => {
      this.world.setNav(!this.world.navOn);
      navBtn.textContent = `不可走範圍：${this.world.navOn ? "開" : "關"}`;
    });
    if (this.world.navOn) navBtn.textContent = "不可走範圍：開";
    const ovBtn = btn(show, "全景", () => {
      this.setOverview(!this.overview);
      ovBtn.textContent = this.overview ? "回到角色" : "全景";
      panel.classList.remove("open");
    });
    // 三種標準模式：HQ（高畫質＋HQ 地形）、Lite 中畫質（中畫質＋Lite 地形）、Lite 低畫質（低畫質＋Lite 地形）
    const modes: [string, string, string][] = [
      ["HQ", "high", "hq"],
      ["Lite 中", "medium", "lite"],
      ["Lite 低", "low", "lite"],
    ];
    for (const [label, q, l] of modes) {
      const b = btn(show, label, () => {
        const url = new URL(location.href);
        url.searchParams.set("quality", q);
        url.searchParams.set("lod", l);
        location.replace(url.toString());
      }, "alt");
      if (this.quality.level === q && this.lod === l) b.classList.add("go");
    }

    const test = section("測試");
    btn(test, "路線 1 圈", () => {
      panel.classList.remove("open");
      this.startRoute(1);
    }, "go");
    btn(test, "3 分鐘（3 圈）", () => {
      panel.classList.remove("open");
      this.startRoute(3);
    }, "go");
    btn(test, "複製報告", () => this.copyReport(), "alt");
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
    } else {
      fallback();
    }
  }

  private updateInfo(): void {
    const r = this.run;
    const st =
      r && r.phase !== "done"
        ? `${r.label}：第 ${r.loop + 1}/${r.loops} 圈 ${r.loopT.toFixed(1)} 秒`
        : this.lastResult
          ? `上次：${this.lastResult.loopTimes.map((t) => t.toFixed(1) + " 秒").join("、") || "未走完"}，平均 ${this.lastResult.avgFps.toFixed(1)} FPS`
          : "尚未測試";
    this.info.textContent = `位置 (${this.pos.x.toFixed(1)}, ${this.pos.z.toFixed(1)}) 高 ${this.pos.y.toFixed(1)}｜${st}`;
  }

  // ---------------- 測試介面 ----------------
  private installApi(): void {
    const api = {
      ready: true,
      lod: this.lod,
      info: () => ({
        quality: this.quality.level,
        lod: this.lod,
        loadMs: this.loadMs,
        chunks: this.world.chunks.length,
        terrainVerts: this.world.terrainVerts,
        terrainTris: this.world.terrainTris,
        drawCalls: this.perf.drawCalls,
        activeMeshes: this.scene.getActiveMeshes().length,
        trianglesActive: this.scene.getActiveIndices() / 3,
        meshes: this.scene.meshes.length,
        materials: this.scene.materials.length,
        textures: this.scene.textures.length,
        labels: this.world.labelsOn,
        nav: this.world.navOn,
        contextLost: this.contextLost,
        render: this.renderSize(),
        bridges: BRIDGES.map((b) => b.id),
        arena: ARENA,
        portal: PORTAL,
      }),
      player: () => ({ x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw }),
      teleport: (x: number, z: number) => this.teleport(x, z),
      walkable: (x: number, z: number) => this.terrain.walkable(x, z),
      surface: (x: number, z: number) => this.terrain.surface(x, z),
      setMove: (m: { x: number; y: number } | null) => {
        this.input.moveOverride = m;
      },
      setLabels: (on: boolean) => this.world.setLabels(on),
      /** 截圖用：角色站在 (x,z) 面向 playerYawDeg（0 = 北），鏡頭從 camBearingDeg 方向看角色，並停住畫面 */
      pose: (o: { x: number; z: number; playerYawDeg: number; camBearingDeg: number; beta: number; radius: number; freeze?: boolean }) => {
        this.frozen = false;
        this.teleport(o.x, o.z, (o.playerYawDeg * Math.PI) / 180);
        this.player.root.rotation.y = this.yaw;
        this.player.update(0.016, 0);
        // 截圖固定在畫質上限解析度（不受動態降解析度影響）
        this.perf.lockResolution(this.lockRatio ?? Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio));
        const b = (o.camBearingDeg * Math.PI) / 180;
        this.camera.snap(this.pos, Math.atan2(Math.cos(b), Math.sin(b)), o.beta, o.radius);
        this.sun.position.copyFrom(this.pos).subtractInPlace(this.sun.direction.scale(45));
        this.frozen = o.freeze ?? true;
      },
      unfreeze: () => {
        this.frozen = false;
        this.perf.lockResolution(null);
      },
      /** 陰影取樣品質：default = 原始高品質、medium = PCSS32（只影響高畫質的柔和陰影） */
      setShadowQuality: (q: "default" | "medium") => {
        if (!this.shadows.useContactHardeningShadow) return false;
        this.shadowQ = q;
        this.shadows.filteringQuality = q === "medium" ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_HIGH;
        return true;
      },
      /** 過曝量測：整個畫面與中央（角色附近）接近純白（RGB 都 ≥ 245）的像素比例 */
      exposure: () =>
        new Promise<{ whiteAll: number; whiteCenter: number; meanLuma: number }>((resolve, reject) => {
          this.scene.onAfterRenderObservable.addOnce(() => {
            const w = this.engine.getRenderWidth();
            const h = this.engine.getRenderHeight();
            this.engine
              .readPixels(0, 0, w, h)
              .then((view) => {
                const d = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
                let all = 0, white = 0, cAll = 0, cWhite = 0, luma = 0;
                for (let y = 0; y < h; y += 2) {
                  for (let x = 0; x < w; x += 2) {
                    const k = (y * w + x) * 4;
                    const r = d[k]!, g = d[k + 1]!, b = d[k + 2]!;
                    const wht = r >= 245 && g >= 245 && b >= 245 ? 1 : 0;
                    all++;
                    white += wht;
                    luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
                    if (x > w * 0.3 && x < w * 0.7 && y > h * 0.25 && y < h * 0.85) {
                      cAll++;
                      cWhite += wht;
                    }
                  }
                }
                resolve({ whiteAll: white / all, whiteCenter: cWhite / Math.max(1, cAll), meanLuma: luma / all });
              })
              .catch(reject);
          });
        }),
      shadowInfo: () => ({ q: this.shadowQ, filtering: this.shadows.filteringQuality, contact: this.shadows.useContactHardeningShadow, mapSize: this.quality.shadows.mapSize }),
      setNav: (on: boolean) => this.world.setNav(on),
      view: (name: string) => this.view(name),
      startRoute: (loops: number) => this.startRoute(loops),
      routeState: () => ({ phase: this.run?.phase ?? null, loop: this.run?.loop ?? 0, t: this.run?.loopT ?? 0, result: this.lastResult }),
      report: () => this.report(),
      pixelStats: () =>
        new Promise<{ samples: number; distinctColors: number; opaqueRatio: number }>((resolve, reject) => {
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
    };
    window.__starwishMap = api;
  }
}
