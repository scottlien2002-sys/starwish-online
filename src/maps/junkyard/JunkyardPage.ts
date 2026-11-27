/**
 * Stage 6.8＋6.9：星廢垃圾場（?map=junkyard）可操作 3D 預覽頁。
 * - 三段畫質（?quality=high|medium|low；同村莊與原野的規格）
 * - 正式初心者角色（Claude A C1.0-B5b；高畫質 HQ、中低 Lite），走路、鏡頭、搖桿與村莊相同
 * - 入口傳送陣：走入自動回星芽原野（只觸發一次）
 * - 分區載入：小垃圾、植被、蒸氣只在玩家附近建立，遠離就釋放
 * - 怪物出生區：&spawns=1 顯示（怪物模型由 Claude C 負責，本頁只標示範圍）
 * - 巡迴測試：&autoplay=walk（以 5 m/s 實際走完整條路線，iPhone 實測用）、&autoplay=tour（瞬移到各區取樣，CI 用）
 */
import { Camera, Color3, Color4, DirectionalLight, DynamicTexture, type Engine, FreeCamera, HemisphericLight, Mesh, MeshBuilder, RenderTargetTexture, Scene, ShadowGenerator, StandardMaterial, Vector3 } from "@babylonjs/core";
import { TUNING } from "../../config/tuning.ts";
import { InputState } from "../../input/InputState.ts";
import { VirtualJoystick } from "../../input/VirtualJoystick.ts";
import { CameraTouchControl } from "../../input/CameraTouchControl.ts";
import { KeyboardInput } from "../../input/KeyboardInput.ts";
import { Hud } from "../../ui/Hud.ts";
import { PlayerAvatar } from "../../actors/PlayerAvatar.ts";
import { inputToWorld, turnTowards } from "../../actors/movement.ts";
import { ThirdPersonCamera } from "../../camera/ThirdPersonCamera.ts";
import { createEngine, createShadows, createSkyDome, setupRendering, type RenderSetup } from "../../render/RenderQuality.ts";
import { qualitySettings, type QualitySettings } from "../../render/quality.ts";
import { type GraphicsTier, loadTierPreference, nextTier, resolveTier, saveTierPreference, TIER_LABEL, TIER_PRESETS } from "../../render/graphicsTiers.ts";
import { PerfOverlay } from "../../render/PerfOverlay.ts";
import { summarizeFrames } from "../../render/benchmark.ts";
import { PortalTrigger } from "../../game/portalTrigger.ts";
import type { VillageCharacter } from "../village/villageCharacter.ts";
import {
  ARENA,
  FIELD_NORTH_ARRIVAL,
  FIELD_NORTH_PORTAL_PROPOSAL,
  JUNKYARD_ARRIVAL,
  JUNKYARD_ENTRY_PORTAL,
  MAIN_ROUTE,
  MAP_HALF,
  PLAYER_RADIUS,
  REACTOR,
  SPAWNS,
  WALK_SPEED,
  ZONES,
} from "./layout.ts";
import { COLLIDERS, resolveMove, simulateRoute, WalkGrid, type RouteSimResult } from "./terrain.ts";
import { JunkyardWorld, type JyTier } from "./JunkyardWorld.ts";
import { STREAM_CELLS } from "./scatter.ts";

export function startJunkyardMap(canvas: HTMLCanvasElement, hudRoot: HTMLElement): Promise<void> {
  const page = new JunkyardPage(canvas, hudRoot);
  page.start();
  return Promise.resolve();
}

/** 巡迴停靠點：各區代表位置與鏡頭方向（截圖、效能取樣） */
export const TOUR_STOPS: readonly { id: string; label: string; x: number; z: number; yaw: number }[] = [
  { id: "entry", label: "入口（傳送陣）", x: 0, z: -122, yaw: 0 },
  { id: "hills", label: "廢棄山丘區", x: 40, z: -96, yaw: 0.9 },
  { id: "colossus", label: "機械巨像遺骸", x: 92, z: -30, yaw: 2.2 },
  { id: "central", label: "中央窪地", x: 18, z: -34, yaw: -0.4 },
  { id: "recycle", label: "回收處理區", x: -46, z: -24, yaw: -1.5 },
  { id: "walkway", label: "高架金屬步道", x: -103, z: -30, yaw: 0 },
  { id: "bridge", label: "魔法運河大橋", x: -60, z: 16, yaw: 0 },
  { id: "factory", label: "廢棄工廠區", x: -60, z: 56, yaw: 0 },
  { id: "platform", label: "熔爐上方平台", x: -55, z: 86, yaw: -0.6 },
  { id: "core", label: "核心熔煉場（Boss）", x: 20, z: 86, yaw: 0 },
];

interface Sampler {
  kind: "walk" | "tour";
  t: number;
  dts: number[];
  draws: number[];
  tris: number[];
  stops: { id: string; label: string; avgFps: number; low1Fps: number; draws: number; tris: number; frames: number }[];
  cur: { id: string; label: string; t: number; dts: number[]; draws: number[]; tris: number[] } | null;
  idx: number;
  route: { x: number; z: number; id: string }[];
  stuck: { id: string; x: number; z: number }[];
  lastProgress: number;
  stall: number;
  done: boolean;
  warm: number;
  startedAt: number;
  pauses: number;
}

class JunkyardPage {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly quality: QualitySettings;
  private readonly tier: GraphicsTier;
  private readonly tierSource: string;
  private readonly lite: boolean;
  private readonly sun: DirectionalLight;
  private readonly shadows: ShadowGenerator | null;
  private readonly camera: ThirdPersonCamera;
  private readonly render: RenderSetup;
  private readonly world: JunkyardWorld;
  private readonly grid: WalkGrid;
  private readonly hud: Hud;
  private readonly input = new InputState();
  private readonly keyboard: KeyboardInput;
  private readonly camTouch: CameraTouchControl;
  private readonly perf: PerfOverlay;
  private readonly player: PlayerAvatar;
  private char: VillageCharacter | null = null;
  private charStatus = "off";
  private readonly pos = new Vector3();
  private yaw = 0;
  private charSpeed = 0;
  private blockedFrames = 0;
  private fpsTimer = 0;
  private readonly portal = new PortalTrigger({ id: JUNKYARD_ENTRY_PORTAL.id, x: JUNKYARD_ENTRY_PORTAL.x, z: JUNKYARD_ENTRY_PORTAL.z, triggerR: JUNKYARD_ENTRY_PORTAL.triggerR, open: true });
  private readonly portalLog: { t: number; map: string; x: number; z: number }[] = [];
  private sampler: Sampler | null = null;
  private lastSample: ReturnType<JunkyardPage["sampleSummary"]> | null = null;
  private routeSim: RouteSimResult | null = null;
  private spawnOverlay: Mesh[] = [];
  private topCam: FreeCamera | null = null;
  private readonly loadMs: number;
  private contextLost = 0;
  private pauseFlag = false;
  private reportBox!: HTMLTextAreaElement;
  private readonly t0 = performance.now();

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    const params = new URLSearchParams(location.search);
    const tr = resolveTier(params.get("quality"), loadTierPreference());
    this.tier = tr.tier;
    this.tierSource = tr.source;
    const preset = TIER_PRESETS[this.tier];
    this.lite = preset.models === "lite";
    const q0 = qualitySettings(this.tier);
    this.quality = { ...q0, maxPixelRatio: preset.maxRes, msaaSamples: preset.msaa, postProcess: preset.post, fxaa: false, canvasAntialias: !preset.post && preset.msaa > 1 };
    for (const ev of ["visibilitychange", "pagehide", "blur"]) {
      (ev === "visibilitychange" ? document : window).addEventListener(ev, () => {
        if (ev !== "visibilitychange" || document.visibilityState !== "visible") this.pauseFlag = true;
      });
    }
    this.engine = createEngine(canvas, this.quality);
    this.engine.onContextLostObservable.add(() => this.contextLost++);
    const scene = new Scene(this.engine);
    this.scene = scene;
    scene.skipPointerMovePicking = true;
    createSkyDome(scene);
    // 天空：明亮帶一點暖色（概念圖的藍天白雲＋遠方霞光）
    scene.ambientColor = new Color3(0.34, 0.32, 0.36);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    const fogEnd = this.tier === "high" ? 175 : this.tier === "medium" ? 145 : 115;
    scene.fogStart = fogEnd * 0.45;
    scene.fogEnd = fogEnd;
    scene.fogColor = new Color3(0.78, 0.86, 0.95);
    scene.clearColor = new Color4(0.62, 0.8, 0.98, 1);

    const hemi = new HemisphericLight("jy_sky", new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.78;
    hemi.diffuse = new Color3(1, 0.98, 1);
    hemi.groundColor = new Color3(0.58, 0.55, 0.5);
    this.sun = new DirectionalLight("jy_sun", new Vector3(-0.5, -1, 0.45).normalize(), scene);
    this.sun.intensity = 0.82;
    this.sun.diffuse = new Color3(1, 0.94, 0.84);
    this.sun.autoUpdateExtends = false;
    const box = this.tier === "high" ? 30 : 22;
    this.sun.orthoLeft = -box;
    this.sun.orthoRight = box;
    this.sun.orthoTop = box;
    this.sun.orthoBottom = -box;
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = 120;
    this.shadows = preset.shadow === "blob" || preset.shadow === "off" ? null : createShadows(this.sun, this.quality);
    if (this.shadows) this.shadows.darkness = 0.35;

    this.grid = new WalkGrid();
    const jyTier: JyTier = this.tier;
    this.world = new JunkyardWorld(scene, jyTier, this.shadows, this.tier === "high" ? 32 : 20);

    this.pos.set(JUNKYARD_ARRIVAL.x, this.grid.height(JUNKYARD_ARRIVAL.x, JUNKYARD_ARRIVAL.z), JUNKYARD_ARRIVAL.z);
    this.yaw = JUNKYARD_ARRIVAL.yaw;
    // 簡易角色（正式角色載入前／&char=simple）：低畫質沒有陰影貼圖 → 給一個只畫一次的 64 px 空陰影產生器
    const sgFallback = this.shadows ?? new ShadowGenerator(64, this.sun);
    if (!this.shadows) sgFallback.getShadowMap()!.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    this.player = new PlayerAvatar(scene, sgFallback);
    this.player.root.position.copyFrom(this.pos);
    this.camera = new ThirdPersonCamera(scene, this.pos, (x, z) => this.grid.height(x, z), { keepPitch: true });
    scene.activeCamera = this.camera.camera;
    this.camera.camera.maxZ = fogEnd + 30;
    this.camera.snap(this.pos, this.alphaBehind(this.yaw), TUNING.camera.defaultBeta, TUNING.camera.distance);
    this.render = setupRendering(scene, this.camera.camera, this.quality, { hdr: preset.hdr });
    if (this.render.glow) this.render.glow.isEnabled = false;
    this.world.updateStreaming(this.pos.x, this.pos.z);

    if (params.get("char") !== "simple") {
      this.charStatus = "loading";
      void import("../village/villageCharacter.ts")
        .then((m) =>
          m.VillageCharacter.create(scene, {
            gender: params.get("g") === "female" ? "female" : "male",
            lod: this.lite ? "lite" : "hq",
            baseUrl: `${import.meta.env.BASE_URL}models/`,
            shadows: this.shadows,
            shadowMode: "blob",
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

    this.hud = new Hud(hudRoot);
    this.hud.setLevel(11);
    this.hud.setBars({ hp: 100, maxHp: 100, mp: 40, maxMp: 40, exp: 0, expToNext: 100 });
    const build = hudRoot.querySelector<HTMLSpanElement>(".hud-build");
    if (build) build.textContent = `星廢垃圾場 Lv11–20 預覽 ${TIER_LABEL[this.tier]}`;
    this.hud.events.on("skillPressed", (e) => {
      if (this.char && (e as { slot?: string }).slot === "attack") {
        this.char.action("attack");
        return;
      }
      this.hud.toast("地圖預覽：怪物由 Claude C 製作中，這一版只有地形與場景（&spawns=1 可看出生區）", 1800);
    });
    const joystick = new VirtualJoystick(this.hud.joystickZone, this.input, TUNING.joystick.radius, TUNING.joystick.deadZone);
    this.camTouch = new CameraTouchControl(canvas, this.input, TUNING.camera.rotateSensitivity, TUNING.camera.pitchSensitivity, TUNING.camera.pinchSensitivity);
    const block = (e: Event): void => e.preventDefault();
    for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, block, { passive: false });
    canvas.addEventListener("contextmenu", block);
    this.keyboard = new KeyboardInput(this.input, () => joystick.active);
    this.perf = new PerfOverlay(this.engine, scene, this.quality, hudRoot, { label: `畫質：${TIER_LABEL[this.tier].replace("畫質", "")}`, onQualityClick: () => this.switchTier(nextTier(this.tier)) });
    if (params.get("spawns") === "1") this.setSpawns(true);
    this.buildPanel(hudRoot);
    window.addEventListener("resize", () => this.engine.resize());
    this.loadMs = performance.now() - this.t0;
    this.installApi();
    const auto = params.get("autoplay");
    if (auto === "walk" || auto === "tour") window.setTimeout(() => this.startSampler(auto), 400);
    void this.render;
  }

  start(): void {
    this.engine.runRenderLoop(this.frame);
    this.hud.toast("星廢垃圾場（Lv11–20）預覽：上方「垃圾場」可傳送到各區、跑巡迴測試、看出生區", 4200);
  }

  private alphaBehind(yaw: number): number {
    return -Math.PI / 2 - yaw;
  }

  private switchTier(t: GraphicsTier): void {
    saveTierPreference(t);
    const q = new URLSearchParams(location.search);
    q.set("quality", t);
    location.search = q.toString();
  }

  teleport(x: number, z: number, yaw: number): void {
    this.pos.set(x, this.grid.height(x, z), z);
    this.yaw = yaw;
    this.world.updateStreaming(x, z);
    this.camera.snap(this.pos, this.alphaBehind(yaw), TUNING.camera.defaultBeta, TUNING.camera.distance);
  }

  // ---------------- 每幀 ----------------
  private frame = (): void => {
    const rawDt = this.engine.getDeltaTime() / 1000;
    const dt = Math.min(rawDt, 0.1);
    this.keyboard.update();
    let moveX = 0;
    let moveZ = 0;
    let speed01 = 0;
    const smp = this.sampler;
    if (smp && !smp.done && smp.kind === "walk" && smp.warm <= 0) {
      const tgt = smp.route[smp.idx];
      if (tgt) {
        const dx = tgt.x - this.pos.x;
        const dz = tgt.z - this.pos.z;
        const L = Math.hypot(dx, dz);
        if (L < 1.2) smp.idx++;
        else {
          moveX = dx / L;
          moveZ = dz / L;
          speed01 = 1;
        }
      }
    } else if (!smp || smp.done) {
      const m = this.input.getMove();
      const w = inputToWorld(m.x, m.y, this.camera.forwardYaw);
      const l = Math.hypot(w.x, w.z);
      const s = l > 1 ? 1 / l : 1;
      moveX = w.x * s;
      moveZ = w.z * s;
      speed01 = Math.min(1, l);
    }
    if (this.char?.dead) speed01 = 0;
    const px0 = this.pos.x;
    const pz0 = this.pos.z;
    if (speed01 > 0 && !this.topCam) {
      const step = WALK_SPEED * speed01 * dt;
      const r = resolveMove(this.grid, this.pos.x, this.pos.z, this.pos.x + moveX * step, this.pos.z + moveZ * step, PLAYER_RADIUS, COLLIDERS);
      if (r.blocked) this.blockedFrames++;
      this.pos.x = r.x;
      this.pos.z = r.z;
      this.yaw = turnTowards(this.yaw, moveX, moveZ, TUNING.player.turnSharpness, dt);
    }
    this.pos.y = this.grid.height(this.pos.x, this.pos.z);
    if (this.char) {
      this.charSpeed = dt > 0 ? Math.hypot(this.pos.x - px0, this.pos.z - pz0) / dt : 0;
      this.char.update(dt, this.pos, this.yaw, this.charSpeed);
    } else {
      this.player.root.position.copyFrom(this.pos);
      this.player.root.rotation.y = this.yaw;
      this.player.update(dt, speed01);
    }
    const cam = this.input.consumeCamera();
    if (!this.topCam) {
      if (smp && !smp.done && smp.kind === "walk") {
        const c = this.camera.camera;
        let da = this.alphaBehind(this.yaw) - c.alpha;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        c.alpha += da * (1 - Math.exp(-3 * dt));
        this.camera.update(dt, this.pos, { yaw: 0, pitch: 0, zoom: 0 });
      } else this.camera.update(dt, this.pos, cam);
    }
    this.sun.position.copyFrom(this.pos).subtractInPlace(this.sun.direction.scale(60));
    this.world.update(dt, this.pos.x, this.pos.z, this.pos.y);
    if (this.portal.update(this.pos.x, this.pos.z)) {
      this.hud.toast("傳送到 星芽原野…", 1600);
      window.setTimeout(() => this.goToMap(), 350);
    }
    this.scene.render();
    this.perf.update(dt);
    if (smp && !smp.done) this.samplerFrame(smp, rawDt);
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fpsTimer = 0;
      this.hud.setFps(this.engine.getFps());
    }
  };

  private goToMap(): void {
    this.portalLog.push({ t: performance.now() / 1000, map: "starsprout", x: this.pos.x, z: this.pos.z });
    if ((window as unknown as { __swNoNav?: boolean }).__swNoNav) return;
    const q = new URLSearchParams(location.search);
    q.set("map", "starsprout");
    // 回到原野北端傳送門外側（原野端的抵達點由 Claude A 世界整合決定；預覽版帶參數給原野頁）
    q.set("from", "junkyard");
    location.search = q.toString();
  }

  // ---------------- 巡迴測試 ----------------
  startSampler(kind: "walk" | "tour"): void {
    const route = MAIN_ROUTE.map((p) => ({ id: p.id, x: p.x, z: p.z }));
    if (kind === "walk") this.teleport(route[0]!.x, route[0]!.z, 0);
    this.sampler = { kind, t: 0, dts: [], draws: [], tris: [], stops: [], cur: null, idx: 1, route, stuck: [], lastProgress: 1e9, stall: 0, done: false, warm: 2, startedAt: performance.now() / 1000, pauses: 0 };
    this.pauseFlag = false;
    this.hud.toast(kind === "walk" ? `巡迴測試：以 5 m/s 走完整條路線（約 ${Math.round(this.routeLength() / WALK_SPEED)} 秒；暖身 2 秒）` : "巡迴取樣：依序傳送到 10 個區域，各取樣 3 秒", 2400);
  }

  private routeLength(): number {
    let L = 0;
    for (let i = 1; i < MAIN_ROUTE.length; i++) L += Math.hypot(MAIN_ROUTE[i]!.x - MAIN_ROUTE[i - 1]!.x, MAIN_ROUTE[i]!.z - MAIN_ROUTE[i - 1]!.z);
    return L;
  }

  private samplerFrame(s: Sampler, rawDt: number): void {
    if (this.pauseFlag) {
      s.pauses++;
      this.pauseFlag = false;
      return; // 背景／切換 App 的那一格不算
    }
    if (s.warm > 0) {
      s.warm -= rawDt;
      return;
    }
    s.t += rawDt;
    const tris = Math.round(this.scene.getActiveIndices() / 3);
    if (s.kind === "walk") {
      s.dts.push(rawDt);
      s.draws.push(this.perf.drawCalls);
      s.tris.push(tris);
      const tgt = s.route[s.idx];
      if (!tgt) {
        s.done = true;
        this.finishSampler(s);
        return;
      }
      const d = Math.hypot(tgt.x - this.pos.x, tgt.z - this.pos.z);
      if (d < s.lastProgress - 0.05) {
        s.lastProgress = d;
        s.stall = 0;
      } else if ((s.stall += rawDt) > 4) {
        s.stuck.push({ id: tgt.id, x: this.pos.x, z: this.pos.z });
        s.idx++;
        s.stall = 0;
        s.lastProgress = 1e9;
      }
      if (s.idx !== s.route.indexOf(tgt)) s.lastProgress = 1e9;
      // 每區統計
      const zone = this.zoneLabel(this.pos.x, this.pos.z);
      if (!s.cur || s.cur.id !== zone.id) {
        if (s.cur) this.closeStop(s);
        s.cur = { id: zone.id, label: zone.label, t: 0, dts: [], draws: [], tris: [] };
      }
      s.cur.dts.push(rawDt);
      s.cur.draws.push(this.perf.drawCalls);
      s.cur.tris.push(tris);
      if (s.t > 600) {
        s.done = true;
        this.finishSampler(s);
      }
      return;
    }
    // tour：每站 0.6 秒穩定＋3 秒取樣
    if (!s.cur) {
      const st = TOUR_STOPS[s.stops.length];
      if (!st) {
        s.done = true;
        this.finishSampler(s);
        return;
      }
      this.teleport(st.x, st.z, st.yaw);
      s.cur = { id: st.id, label: st.label, t: -0.6, dts: [], draws: [], tris: [] };
      return;
    }
    s.cur.t += rawDt;
    if (s.cur.t < 0) return;
    s.cur.dts.push(rawDt);
    s.cur.draws.push(this.perf.drawCalls);
    s.cur.tris.push(tris);
    s.dts.push(rawDt);
    s.draws.push(this.perf.drawCalls);
    s.tris.push(tris);
    if (s.cur.t >= 3 && s.cur.dts.length >= 3) this.closeStop(s);
  }

  private closeStop(s: Sampler): void {
    const c = s.cur;
    if (!c) return;
    const f = summarizeFrames(c.dts, c.draws);
    s.stops.push({ id: c.id, label: c.label, avgFps: f.avgFps, low1Fps: f.low1Fps, draws: Math.round(f.avgDrawCalls), tris: Math.round(c.tris.reduce((a, b) => a + b, 0) / Math.max(1, c.tris.length)), frames: c.dts.length });
    s.cur = null;
  }

  private finishSampler(s: Sampler): void {
    if (s.cur) this.closeStop(s);
    this.lastSample = this.sampleSummary(s);
    this.hud.toast(`巡迴完成：平均 ${this.lastSample.avgFps.toFixed(1)} FPS、1% Low ${this.lastSample.low1Fps.toFixed(1)}（上方「垃圾場」→ 複製報告）`, 4000);
    this.updateReport();
  }

  private sampleSummary(s: Sampler) {
    const f = summarizeFrames(s.dts, s.draws);
    return {
      kind: s.kind,
      seconds: f.seconds,
      frames: f.frames,
      avgFps: f.avgFps,
      low1Fps: f.low1Fps,
      minFps: f.minFps,
      stutters: s.dts.filter((d) => d > 0.05).length,
      avgDraws: Math.round(f.avgDrawCalls),
      maxDraws: s.draws.length ? Math.max(...s.draws) : 0,
      avgTris: Math.round(s.tris.reduce((a, b) => a + b, 0) / Math.max(1, s.tris.length)),
      maxTris: s.tris.length ? Math.max(...s.tris) : 0,
      stops: s.stops,
      stuck: s.stuck,
      reached: s.kind === "walk" ? Math.min(s.idx, s.route.length) : s.stops.length,
      total: s.kind === "walk" ? s.route.length : TOUR_STOPS.length,
      pauses: s.pauses,
      blocked: this.blockedFrames,
    };
  }

  private zoneLabel(x: number, z: number): { id: string; label: string } {
    let best: { id: string; label: string } = { id: "central", label: "中央窪地" };
    let bd = 1e9;
    for (const zn of ZONES) {
      const d = Math.hypot(x - zn.x, z - zn.z) - zn.r * 0.5;
      if (d < bd) {
        bd = d;
        best = { id: zn.id, label: zn.name };
      }
    }
    if (Math.hypot(x - 8, z + 14) < 34 && bd > 0) best = { id: "central", label: "中央窪地" };
    return best;
  }

  // ---------------- 出生區標示 ----------------
  setSpawns(on: boolean): void {
    for (const m of this.spawnOverlay) m.dispose();
    this.spawnOverlay = [];
    if (!on) return;
    for (const s of SPAWNS) {
      const y = this.grid.height(s.x, s.z) + 0.08;
      const col = s.boss ? new Color3(1, 0.25, 0.2) : s.elite ? new Color3(1, 0.55, 0.2) : new Color3(0.35, 0.85, 1);
      const disc = MeshBuilder.CreateDisc(`jy_spawn_${s.id}`, { radius: s.r, tessellation: 40 }, this.scene);
      disc.rotation.x = Math.PI / 2;
      disc.position.set(s.x, y, s.z);
      const dm = new StandardMaterial(`jy_spawnm_${s.id}`, this.scene);
      dm.disableLighting = true;
      dm.emissiveColor = col;
      dm.alpha = 0.22;
      disc.material = dm;
      const leash = MeshBuilder.CreateTorus(`jy_leash_${s.id}`, { diameter: s.leash * 2, thickness: 0.18, tessellation: 64 }, this.scene);
      leash.position.set(s.x, y + 0.05, s.z);
      leash.material = dm;
      const lab = MeshBuilder.CreatePlane(`jy_spawnlab_${s.id}`, { width: 7, height: 1.6 }, this.scene);
      lab.billboardMode = Mesh.BILLBOARDMODE_ALL;
      lab.position.set(s.x, y + 4, s.z);
      const tex = new DynamicTexture(`jy_spawnt_${s.id}`, { width: 448, height: 102 }, this.scene, false);
      const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
      ctx.fillStyle = "rgba(20,24,40,0.78)";
      ctx.fillRect(0, 0, 448, 102);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 34px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${s.monster} ${s.name}`, 224, 44);
      ctx.font = "26px sans-serif";
      ctx.fillText(`Lv${s.level[0]}${s.level[1] !== s.level[0] ? `–${s.level[1]}` : ""}（${s.element}）上限 ${s.cap}・主動`, 224, 84);
      tex.update();
      const lm = new StandardMaterial(`jy_spawnlm_${s.id}`, this.scene);
      lm.disableLighting = true;
      lm.emissiveTexture = tex;
      lm.opacityTexture = tex;
      lm.backFaceCulling = false;
      lab.material = lm;
      this.spawnOverlay.push(disc, leash, lab);
    }
  }

  // ---------------- 俯視地圖（正交鏡頭） ----------------
  setTopView(on: boolean): void {
    if (on && !this.topCam) {
      const c = new FreeCamera("jy_top", new Vector3(0, 260, 0), this.scene);
      c.mode = Camera.ORTHOGRAPHIC_CAMERA;
      const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
      const half = MAP_HALF;
      c.orthoTop = half;
      c.orthoBottom = -half;
      c.orthoLeft = -half * aspect;
      c.orthoRight = half * aspect;
      c.setTarget(new Vector3(0, 0, 0.001));
      c.upVector = new Vector3(0, 0, 1);
      c.rotation.set(Math.PI / 2, 0, 0);
      c.maxZ = 600;
      c.minZ = 1;
      this.topCam = c;
      this.scene.activeCamera = c;
      this.scene.fogEnabled = false;
      for (const zn of STREAM_CELLS) void zn;
      this.world.updateStreaming(0, 0, false);
      // 俯視時全部分區都載入（看完整地圖）
      for (const zn of STREAM_CELLS) this.world.updateStreaming(zn.x, zn.z);
    } else if (!on && this.topCam) {
      this.topCam.dispose();
      this.topCam = null;
      this.scene.activeCamera = this.camera.camera;
      this.scene.fogEnabled = true;
      this.world.updateStreaming(this.pos.x, this.pos.z, true);
      this.world.updateStreaming(this.pos.x, this.pos.z);
    }
  }

  // ---------------- 面板與報告 ----------------
  private buildPanel(root: HTMLElement): void {
    const btn = document.createElement("button");
    btn.textContent = "垃圾場";
    btn.className = "jy-panel-btn";
    btn.style.cssText = "position:absolute;top:calc(env(safe-area-inset-top) + 52px);right:8px;z-index:30;padding:6px 10px;border-radius:10px;border:0;background:rgba(30,40,70,.78);color:#fff;font-size:13px";
    const panel = document.createElement("div");
    panel.className = "jy-panel";
    panel.style.cssText = "position:absolute;top:calc(env(safe-area-inset-top) + 90px);right:8px;z-index:30;width:min(330px,88vw);max-height:70vh;overflow:auto;padding:10px;border-radius:12px;background:rgba(18,22,40,.9);color:#fff;font-size:12px;display:none";
    btn.onclick = () => {
      panel.style.display = panel.style.display === "none" ? "block" : "none";
      if (panel.style.display === "block") this.updateReport();
    };
    const row = (label: string, fn: () => void): void => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = "margin:3px;padding:5px 8px;border-radius:8px;border:0;background:#3b4d7a;color:#fff;font-size:12px";
      b.onclick = fn;
      panel.appendChild(b);
    };
    const h = (t: string): void => {
      const d = document.createElement("div");
      d.textContent = t;
      d.style.cssText = "margin:8px 0 2px;font-weight:bold;color:#ffd27a";
      panel.appendChild(d);
    };
    h("傳送");
    for (const s of TOUR_STOPS) row(s.label, () => this.teleport(s.x, s.z, s.yaw));
    h("測試");
    row("巡迴：走完整條路線", () => this.startSampler("walk"));
    row("巡迴：各區取樣", () => this.startSampler("tour"));
    row("出生區 開／關", () => this.setSpawns(this.spawnOverlay.length === 0));
    row("俯視地圖 開／關", () => this.setTopView(!this.topCam));
    row("複製報告", () => {
      this.updateReport();
      this.reportBox.select();
      void navigator.clipboard?.writeText(this.reportBox.value).then(
        () => this.hud.toast("報告已複製", 1200),
        () => this.hud.toast("請長按文字框手動複製", 1600),
      );
    });
    this.reportBox = document.createElement("textarea");
    this.reportBox.readOnly = true;
    this.reportBox.style.cssText = "width:100%;height:220px;margin-top:6px;font-size:11px;background:#0d1020;color:#cfe;border:0;border-radius:8px";
    panel.appendChild(this.reportBox);
    root.appendChild(btn);
    root.appendChild(panel);
  }

  private reportText(): string {
    const st = this.world.stats();
    const lines: string[] = [];
    lines.push(`星願物語 星廢垃圾場（Lv11–20）預覽報告｜${new Date().toLocaleString("zh-TW")}`);
    lines.push(`裝置：${navigator.userAgent}`);
    lines.push(`畫質：${TIER_LABEL[this.tier]}（來源 ${this.tierSource}）｜模型 ${this.lite ? "Lite" : "HQ"}｜陰影 ${this.shadows ? "即時（附近大型地標）" : "腳底柔和陰影"}｜MSAA ${this.quality.msaaSamples}｜後製 ${this.quality.postProcess ? "開" : "關"}`);
    const ri = this.perf.resolutionInfo();
    lines.push(`解析度：${ri.width}×${ri.height}（實際倍率 ${ri.actual.toFixed(2)}，DPR ${ri.dpr}）`);
    lines.push(`載入：頁面 ${(this.loadMs / 1000).toFixed(2)} 秒（可走格網 ${this.grid.buildMs.toFixed(0)} ms、場景 ${st.buildMs} ms）｜角色 ${this.charStatus}`);
    lines.push(`地圖：300×300 m｜可走面積 ${Math.round(this.grid.walkableCells() * 0.25).toLocaleString()} m²｜碰撞物 ${COLLIDERS.length}`);
    lines.push(`地形：${st.terrainChunks} 塊、${st.terrainTris.toLocaleString()} 面｜地標網格 ${st.landmarkMeshes}（${st.landmarkTris.toLocaleString()} 面）`);
    lines.push(`分區載入中：${st.loadedCells.join("、") || "無"}｜實例 ${st.instances.toLocaleString()}（${st.instanceMeshes} 個實例網格）｜粒子上限 ${st.particles}`);
    lines.push(`擺放總數：垃圾山 ${st.scatter.mound}、地面碎屑 ${st.scatter.debris}、垃圾堆物件 ${st.scatter.pileItems}、草叢 ${st.scatter.tufts}、小花 ${st.scatter.flowers}`);
    lines.push(`目前畫面：Draw Calls ${this.perf.drawCalls}、三角形 ${Math.round(this.scene.getActiveIndices() / 3).toLocaleString()}、FPS ${this.engine.getFps().toFixed(1)}`);
    const s = this.lastSample;
    if (s) {
      lines.push(`— 巡迴（${s.kind === "walk" ? "實際走完整條路線" : "各區取樣"}）—`);
      lines.push(`完成 ${s.reached}/${s.total}｜${s.seconds} 秒、${s.frames} 格｜平均 FPS ${s.avgFps.toFixed(1)}｜1% Low ${s.low1Fps.toFixed(1)}｜最低 ${s.minFps.toFixed(1)}｜卡頓(>50ms) ${s.stutters}`);
      lines.push(`Draw Calls 平均 ${s.avgDraws}、最高 ${s.maxDraws}｜三角形 平均 ${s.avgTris.toLocaleString()}、最高 ${s.maxTris.toLocaleString()}`);
      lines.push(`卡住 ${s.stuck.length} 次${s.stuck.length ? `：${s.stuck.map((x) => `${x.id}(${x.x.toFixed(0)},${x.z.toFixed(0)})`).join("、")}` : ""}｜碰撞滑動格數 ${s.blocked}｜切到背景 ${s.pauses} 次（不計入）`);
      for (const z of s.stops) lines.push(`  ${z.label}：FPS ${z.avgFps.toFixed(1)}／1% Low ${z.low1Fps.toFixed(1)}｜Draw ${z.draws}｜三角形 ${z.tris.toLocaleString()}（${z.frames} 格）`);
    } else lines.push("（尚未跑巡迴：上方按「巡迴：走完整條路線」）");
    lines.push(`WebGL Context Lost：${this.contextLost} 次`);
    return lines.join("\n");
  }

  private updateReport(): void {
    if (this.reportBox) this.reportBox.value = this.reportText();
  }

  // ---------------- 測試 API ----------------
  private installApi(): void {
    const api = {
      ready: () => true,
      tier: () => ({ tier: this.tier, source: this.tierSource, lite: this.lite, shadows: !!this.shadows }),
      state: () => ({ x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, walkable: this.grid.walkable(this.pos.x, this.pos.z), char: this.charStatus, model: this.char?.stats().model ?? null }),
      teleport: (x: number, z: number, yaw = 0) => this.teleport(x, z, yaw),
      stats: () => this.world.stats(),
      streamLog: () => this.world.streamLog.slice(),
      layout: () => ({ zones: ZONES, spawns: SPAWNS, arena: ARENA, reactor: REACTOR, entry: JUNKYARD_ENTRY_PORTAL, arrival: JUNKYARD_ARRIVAL, fieldPortal: FIELD_NORTH_PORTAL_PROPOSAL, fieldArrival: FIELD_NORTH_ARRIVAL, route: MAIN_ROUTE, tourStops: TOUR_STOPS }),
      simulateRoute: () => {
        this.routeSim = simulateRoute(this.grid, MAIN_ROUTE);
        return this.routeSim;
      },
      walkable: (x: number, z: number) => this.grid.walkable(x, z),
      height: (x: number, z: number) => this.grid.height(x, z),
      walkableArea: () => this.grid.walkableCells() * 0.25,
      startSampler: (k: "walk" | "tour") => this.startSampler(k),
      sample: () => this.lastSample,
      sampling: () => (this.sampler ? { done: this.sampler.done, stops: this.sampler.stops.length, idx: this.sampler.idx } : null),
      perf: () => ({ fps: this.engine.getFps(), draws: this.perf.drawCalls, tris: Math.round(this.scene.getActiveIndices() / 3), meshes: this.scene.getActiveMeshes().length, textures: this.scene.textures.length, materials: this.scene.materials.length, geometries: this.scene.geometries.length, contextLost: this.contextLost }),
      breakdown: () => {
        const groups: Record<string, { meshes: number; tris: number }> = {};
        const am = this.scene.getActiveMeshes();
        for (let i = 0; i < am.length; i++) {
          const m = am.data[i]!;
          const g = m.name.startsWith("jy_") ? this.world.groupOf(m.name) : this.char && m.name.toLowerCase().includes("novice") ? "玩家角色" : "角色與其他";
          const e = (groups[g] ??= { meshes: 0, tris: 0 });
          e.meshes++;
          e.tris += Math.round((m.getTotalIndices() / 3) * ((m as Mesh).thinInstanceCount || 1));
        }
        return groups;
      },
      setSpawns: (on: boolean) => this.setSpawns(on),
      setTopView: (on: boolean) => this.setTopView(on),
      portal: () => ({ armed: this.portal.isArmed, fired: this.portal.hasFired, log: this.portalLog.slice(), spec: JUNKYARD_ENTRY_PORTAL }),
      charStats: () => this.char?.stats() ?? null,
      report: () => this.reportText(),
      action: (a: "attack" | "hurt" | "die" | "revive") => this.char?.action(a),
      noJumpButton: () => !document.querySelector('[data-slot="jump"], .hud-jump, button.jump'),
    };
    (window as unknown as { __starwishJunkyard: typeof api }).__starwishJunkyard = api;
  }
}
