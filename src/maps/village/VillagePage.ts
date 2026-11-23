import { villageInitialCamera } from "./spawnCamera.ts";
import { Color3, DirectionalLight, type Engine, HemisphericLight, Scene, ShadowGenerator, Vector3 } from "@babylonjs/core";
import { TUNING } from "../../config/tuning.ts";
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
import {
  ARRIVAL_SPOT,
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
import { TourRunner, tourPoints, type TourEvent } from "./tour.ts";
import type { VillageArtState } from "./VillageArtP3.ts";

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
interface TourSampling {
  runner: TourRunner;
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
  private readonly camera: ThirdPersonCamera;
  private readonly sun: DirectionalLight;
  private readonly shadows: ShadowGenerator;
  private readonly render: RenderSetup;
  private readonly perf: PerfOverlay;
  private readonly hud: Hud;
  private readonly input = new InputState();
  private readonly keyboard: KeyboardInput;
  private readonly camTouch: CameraTouchControl;
  private readonly pos = new Vector3();
  private yaw = 0;
  private overview = false;
  private frozen = false;
  private loadMs = 0;
  private contextLost = 0;
  private fpsTimer = 0;
  private blockedFrames = 0;
  private tour: TourSampling | null = null;
  private lastTour: {
    loopTimes: number[];
    avgFps: number;
    low1Fps: number;
    minFps: number;
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

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    const t0 = performance.now();
    const params = new URLSearchParams(location.search);
    this.lite = params.get("lod") === "lite";
    this.quality = pickQuality();
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
    if (this.shadowQ === "medium") this.shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;

    this.pos.set(ARRIVAL_SPOT.x, groundHeight(ARRIVAL_SPOT.x, ARRIVAL_SPOT.z), ARRIVAL_SPOT.z);
    this.yaw = ARRIVAL_SPOT.yaw;
    this.player = new PlayerAvatar(scene, this.shadows);
    this.player.root.position.copyFrom(this.pos);
    this.camera = new ThirdPersonCamera(scene, this.pos, groundHeight, {
      keepPitch: true,
      obstruct: villageCameraDistance,
    });
    this.camera.obstructEnabled = params.get("camcol") !== "0";
    scene.activeCamera = this.camera.camera;
    this.camera.snap(this.pos, this.alphaBehind(this.yaw), TUNING.camera.defaultBeta, TUNING.camera.distance);
    this.render = setupRendering(scene, this.camera.camera, this.quality);
    // Grey-box 沒有需要發光的物件：關閉發光層（避免全部自發光標記被加上光暈）
    if (this.render.glow) this.render.glow.isEnabled = false;
    this.world = buildVillageWorld(scene, this.quality.shadows.filter === "contact" ? this.shadows : null, this.lite);
    if (params.get("labels") === "0") this.world.setLabels(false);
    this.artP3 = params.get("art") === "p3";
    if (this.artP3) {
      void import("./VillageArtP3.ts").then((m) => m.loadVillageArtP3(scene, this.lite, this.shadows, (st) => (this.artState = st)));
    }
    if (params.get("marks") === "0") this.world.setMarkers(false);

    this.hud = new Hud(hudRoot);
    this.hud.setLevel(10);
    this.hud.setBars({ hp: 100, maxHp: 100, mp: 40, maxMp: 40, exp: 0, expToNext: 100 });
    const build = hudRoot.querySelector<HTMLSpanElement>(".hud-build");
    if (build) build.textContent = `星芽村 V1.3 ${params.get("art") === "p3" ? "P3-0 美術流程測試" : "Grey-box"} ${this.modeName()}`;
    this.hud.events.on("skillPressed", () => this.hud.toast("星芽村 Grey-box：這一階段沒有戰鬥與 NPC 功能", 1500));
    const joystick = new VirtualJoystick(this.hud.joystickZone, this.input, TUNING.joystick.radius, TUNING.joystick.deadZone);
    this.camTouch = new CameraTouchControl(canvas, this.input, TUNING.camera.rotateSensitivity, TUNING.camera.pitchSensitivity, TUNING.camera.pinchSensitivity);
    const block = (e: Event): void => e.preventDefault();
    for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, block, { passive: false });
    canvas.addEventListener("contextmenu", block);
    this.keyboard = new KeyboardInput(this.input, () => joystick.active);
    this.perf = new PerfOverlay(this.engine, scene, this.quality, hudRoot);
    this.buildPanel(hudRoot);
    window.addEventListener("resize", () => this.engine.resize());
    this.loadMs = performance.now() - t0;
    this.installApi();
    const auto = params.get("autoplay");
    if (auto === "tour") window.setTimeout(() => this.startTour(Math.max(1, Math.min(6, Number(params.get("loops") ?? 1) || 1))), 300);
  }

  start(): void {
    this.engine.runRenderLoop(this.frame);
    this.hud.toast("星芽村 V1.3 Grey-box：佔位模型，只測配置、比例、道路、傳送門位置與碰撞。上方「村莊」可傳送與測試", 4200);
  }

  modeName(): string {
    if (this.quality.level === "high" && !this.lite) return "HQ";
    if (this.quality.level === "medium" && this.lite) return "Lite 中畫質";
    if (this.quality.level === "low" && this.lite) return "Lite 低畫質";
    return `非標準組合（${this.quality.level}＋${this.lite ? "lite" : "hq"}）`;
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
    this.player.root.position.copyFrom(this.pos);
    this.player.root.rotation.y = this.yaw;
    this.player.update(dt, this.overview ? 0 : speed01);
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
    this.scene.render();
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
    this.tour = { runner: new TourRunner(tourPoints(NPC_SPOTS, PORTALS, ARRIVAL_SPOT), loops), dts: [], draws: [], tris: [] };
    this.hud.toast(`巡迴測試 ${loops} 圈開始（暖身 2 秒）`, 1800);
  }

  private tourFrame(t: TourSampling, rawDt: number, blocked: boolean): void {
    const wasRunning = t.runner.phase === "running";
    t.runner.record(rawDt, this.pos.x, this.pos.y, this.pos.z, blocked);
    if (wasRunning) {
      t.dts.push(rawDt);
      t.draws.push(this.perf.drawCalls);
      t.tris.push(this.scene.getActiveIndices() / 3);
    }
    if (t.runner.phase === "done") this.tourDone(t);
  }

  private tourDone(t: TourSampling): void {
    const s = summarizeFrames(t.dts, t.draws);
    const r = t.runner;
    this.lastTour = {
      loopTimes: [...r.loopTimes],
      avgFps: s.avgFps,
      low1Fps: s.low1Fps,
      minFps: s.minFps,
      avgDraw: s.avgDrawCalls,
      maxDraw: s.maxDrawCalls,
      avgTris: t.tris.reduce((a, b) => a + b, 0) / Math.max(1, t.tris.length),
      stuck: r.stuckCount,
      timeouts: r.timeoutCount,
      blockedFrames: r.totalBlockedFrames,
      events: [...r.events],
      stutters: t.dts.filter((x) => x > 0.05).length,
    };
    this.tour = null;
    this.reportBox.value = this.report();
    this.reportBox.hidden = false;
    this.panel.classList.add("open");
    this.hud.toast(`巡迴完成：平均 ${s.avgFps.toFixed(1)} FPS、真正卡住 ${r.stuckCount} 次`, 3500);
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
    lines.push("星願物語 Stage 6 P2-3 星芽村 V1.3 Grey-box 測試報告");
    lines.push(`時間 ${new Date().toLocaleString("zh-TW", { hour12: false })}`);
    lines.push(`網址參數 ${location.search || "(無)"}`);
    lines.push(`裝置 ${navigator.userAgent}`);
    lines.push(`模式 ${this.modeName()}：渲染畫質 ${this.quality.level}（解析度上限 ${this.quality.maxPixelRatio}x、後製 ${this.quality.postProcess ? "開" : "關"}、陰影 ${this.quality.shadows.filter === "contact" ? "柔和 PCSS" : "PCF"} ${this.quality.shadows.mapSize}${this.shadowQ === "medium" ? "、PCSS32" : ""}）／載入 ${Math.round(this.loadMs)} ms`);
    lines.push(`村莊 V1.3 佔位網格 ${ws.meshes}、三角形 ${ws.triangles}、文字標籤 ${ws.labels}；建築 7、NPC 站位 ${NPC_SPOTS.length}、出生／復活點 ${RESPAWN_SLOTS.length}、傳送門 ${PORTALS.length}（開放 ${PORTALS.filter((p) => p.open).length}）`);
    lines.push(`碰撞 圓形 ${CIRCLE_COLLIDERS.length}、矩形 ${BOX_COLLIDERS.length}；鏡頭避障 ${this.camera.obstructEnabled ? "開" : "關"}`);
    lines.push(`目前畫面 Draw Calls ${this.perf.drawCalls}、三角形 ${Math.round(this.scene.getActiveIndices() / 3)}`);
    if (this.artP3) {
      const a = this.artState;
      lines.push(
        a
          ? `正式美術 art=p3（${a.stage}）：${a.status === "loaded" ? "已載入" : a.status === "error" ? `載入失敗 ${a.error}` : "載入中"} ${a.file}，${a.ms} ms，網格 ${a.meshes}、材質 ${a.materials}、貼圖 ${a.textures}、三角形 ${a.triangles}`
          : "正式美術 art=p3：尚未開始載入",
      );
    } else lines.push("正式美術：關閉（Grey-box）");
    const r = this.lastTour;
    if (!r) {
      lines.push("尚未執行巡迴測試");
      return lines.join("\n");
    }
    lines.push(`---- 巡迴測試 ${r.loopTimes.length} 圈（${this.modeName()}）----`);
    lines.push(`每圈時間：${r.loopTimes.map((t) => t.toFixed(1) + " 秒").join("、")}；總時間 ${r.loopTimes.reduce((a, b) => a + b, 0).toFixed(1)} 秒`);
    lines.push(`真正卡住 ${r.stuck} 次；腳本誤報（進度逾時但仍在移動）${r.timeouts} 次；碰撞滑動 ${r.blockedFrames} 幀`);
    lines.push(`FPS 平均 ${r.avgFps.toFixed(1)}／1% Low ${r.low1Fps.toFixed(1)}／最低 ${r.minFps.toFixed(1)}／卡頓(>50ms) ${r.stutters} 幀`);
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
    for (const [label, q, l] of [
      ["HQ", "high", "hq"],
      ["Lite 中", "medium", "lite"],
      ["Lite 低", "low", "lite"],
    ] as const) {
      const b = btn(show, label, () => {
        const url = new URL(location.href);
        url.searchParams.set("quality", q);
        url.searchParams.set("lod", l);
        location.replace(url.toString());
      }, "alt");
      if (this.quality.level === q && (l === "lite") === this.lite) b.classList.add("go");
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
      freeze: (on: boolean) => {
        this.frozen = on;
      },
      setLabels: (on: boolean) => this.world.setLabels(on),
      setMarkers: (on: boolean) => this.world.setMarkers(on),
      startTour: (loops: number) => this.startTour(loops),
      tourState: () => ({ phase: this.tour ? this.tour.runner.phase : this.lastTour ? "done" : null, loop: this.tour?.runner.loop ?? 0, result: this.lastTour }),
      blockedFrames: () => this.blockedFrames,
      artState: () => this.artState,
      report: () => this.report(),
    };
    window.__starwishVillage = api;
  }
}
