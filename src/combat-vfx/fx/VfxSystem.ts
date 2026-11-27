/**
 * 共用戰鬥特效系統（Babylon.js 9）。
 * - spawn(鍵值, 位置, 選項)：生成一次性特效；先經過 VfxBudget（多人數量限制），再依品質決定粒子數與細節層
 * - 網格特效（劍氣、魔法陣、震波、爆破、閃光）與粒子系統都有物件池，避免戰鬥中反覆建立／釋放造成卡頓
 * - 投射物（魔法彈、劍氣波、隕星）：launch() 回傳控制物件，每幀移動；抵達或碰到目標由呼叫端（戰鬥系統）判定
 * - 特效只負責畫面；傷害一律由戰鬥系統結算後再呼叫 hitFx()
 * 所有特效都用加算混合＋程式貼圖，可以在低畫質關掉 GlowLayer 而不失去「發亮」的感覺。
 */
import {
  Color3,
  Color4,
  Constants,
  GlowLayer,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  type Scene,
  StandardMaterial,
  type Texture,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { FxKey, Palette } from "../core/skills.ts";
import { VFX_QUALITY, type VfxQualityConfig, type VfxTier, particleCount } from "../core/quality.ts";
import { VfxBudget, type VfxOwner, type VfxPriority } from "../core/budget.ts";
import { fxTexture, type TexKey } from "./textures.ts";
import { PALETTES, type PaletteColors } from "./palette.ts";

export interface SpawnOptions {
  owner?: VfxOwner;
  palette?: Palette;
  /** 面向（弧度，Babylon 世界的 rotation.y） */
  yaw?: number;
  scale?: number;
  duration?: number;
  /** 跟隨的節點（魔法陣、旋風、蓄力光環跟著角色） */
  follow?: TransformNode;
  /** 粒子發射點跟隨的網格（武器尖端） */
  emitterMesh?: Mesh;
  /** 與鏡頭的距離（預算用） */
  distance?: number;
}

interface MeshFx {
  key: string;
  mesh: Mesh;
  mat: StandardMaterial;
  t: number;
  dur: number;
  handle: number;
  follow?: TransformNode;
  offset: Vector3;
  baseScale: number;
  tick: (f: MeshFx, u: number, dt: number) => void;
  /** 次要網格（同一特效的第二層） */
  extra?: Mesh;
  extraMat?: StandardMaterial;
  spin?: number;
}

interface PsFx {
  key: string;
  ps: ParticleSystem;
  stopAt: number;
  freeAt: number;
  handle: number;
  busy: boolean;
}

export interface Projectile {
  readonly node: Mesh;
  pos: Vector3;
  alive: boolean;
  travelled: number;
  /** 追蹤目標：每幀把方向轉向 to（turn 0~1） */
  steer(to: Vector3, turn: number): void;
  dispose(withBurst?: boolean): void;
}

const ADD = Constants.ALPHA_ADD;

export class VfxSystem {
  readonly scene: Scene;
  q: VfxQualityConfig;
  readonly budget: VfxBudget;
  private glow: GlowLayer | null = null;
  private time = 0;
  private readonly meshPool = new Map<string, MeshFx[]>();
  private readonly active: MeshFx[] = [];
  private readonly psPool = new Map<string, PsFx[]>();
  private readonly psActive: PsFx[] = [];
  private readonly projectiles: (Projectile & { step: (dt: number) => void; trail: PsFx | null; core: Mesh; handle: number })[] = [];
  /** 統計（FPS 面板） */
  stats = { meshFx: 0, particles: 0, projectiles: 0, spawned: 0 };

  constructor(scene: Scene, tier: VfxTier) {
    this.scene = scene;
    this.q = VFX_QUALITY[tier];
    this.budget = new VfxBudget(this.q);
    this.setTier(tier);
  }

  setTier(tier: VfxTier): void {
    this.q = VFX_QUALITY[tier];
    this.budget.setQuality(this.q);
    if (this.q.glow && !this.glow) {
      this.glow = new GlowLayer("fxGlow", this.scene, { mainTextureRatio: this.q.glowTextureRatio, blurKernelSize: tier === "high" ? 32 : 16 });
      this.glow.intensity = 0.85;
      for (const list of this.meshPool.values()) for (const f of list) this.glowAdd(f.mesh);
      for (const f of this.active) this.glowAdd(f.mesh);
    } else if (!this.q.glow && this.glow) {
      this.glow.dispose();
      this.glow = null;
    } else if (this.glow) {
      // 解析度改變需要重建
      this.glow.dispose();
      this.glow = null;
      this.setTier(tier);
    }
  }

  /** 材質 alpha 不讓它剛好是 0（淡入第一格是 0 時，Babylon 會把這個網格當成看不見而不畫） */
  private floorAlpha(f: MeshFx): void {
    if (f.mat.alpha < 0.004) f.mat.alpha = 0.004;
    if (f.extraMat && f.extraMat.alpha < 0.004) f.extraMat.alpha = 0.004;
  }

  /** 除錯：目前作用中的網格特效狀態（E2E 用） */
  debugActive(): { key: string; enabled: boolean; visible: boolean; pos: number[]; scale: number; alpha: number; inActive: boolean; ready: boolean }[] {
    const act = this.scene.getActiveMeshes();
    const set = new Set<unknown>();
    for (let i = 0; i < act.length; i++) set.add(act.data[i]);
    return this.active.map((f) => ({
      key: f.key,
      enabled: f.mesh.isEnabled(),
      visible: f.mesh.isVisible,
      pos: [f.mesh.position.x, f.mesh.position.y, f.mesh.position.z].map((v) => Math.round(v * 100) / 100),
      scale: Math.round(f.mesh.scaling.x * 100) / 100,
      alpha: Math.round(f.mat.alpha * 1000) / 1000,
      inActive: set.has(f.mesh),
      ready: f.mesh.isReady(true),
    }));
  }

  private glowAdd(m: Mesh): void {
    if (this.glow) this.glow.addIncludedOnlyMesh(m);
  }

  // ------------------------------------------------------------------ 材質與網格

  private tex(k: TexKey): Texture {
    return fxTexture(this.scene, k, this.q.textureSize);
  }

  private makeMat(name: string, tex: Texture, color: Color3): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseTexture = tex;
    m.useAlphaFromDiffuseTexture = true;
    // disableLighting 時 Babylon 只輸出自發光：顏色放在 emissiveColor（放 diffuseColor 會整片變黑，加算後看不見）
    m.diffuseColor = Color3.Black();
    m.emissiveColor = color.clone();
    m.specularColor = Color3.Black();
    m.disableLighting = true;
    m.backFaceCulling = false;
    m.alphaMode = ADD;
    m.disableDepthWrite = true;
    m.fogEnabled = false;
    return m;
  }

  private takeMesh(key: string, build: () => { mesh: Mesh; mat: StandardMaterial; extra?: Mesh; extraMat?: StandardMaterial }): MeshFx {
    const pool = this.meshPool.get(key) ?? [];
    this.meshPool.set(key, pool);
    let f = pool.pop();
    if (!f) {
      const b = build();
      b.mesh.isPickable = false;
      b.mesh.alwaysSelectAsActiveMesh = false;
      this.glowAdd(b.mesh);
      if (b.extra) {
        b.extra.isPickable = false;
        this.glowAdd(b.extra);
      }
      f = { key, mesh: b.mesh, mat: b.mat, extra: b.extra, extraMat: b.extraMat, t: 0, dur: 1, handle: 0, offset: Vector3.Zero(), baseScale: 1, tick: () => {} };
    }
    f.mesh.setEnabled(true);
    f.extra?.setEnabled(true);
    f.t = 0;
    f.follow = undefined;
    f.spin = 0;
    return f;
  }

  private startMesh(f: MeshFx, dur: number, handle: number, tick: MeshFx["tick"]): void {
    f.dur = dur;
    f.handle = handle;
    f.tick = tick;
    tick(f, 0, 0);
    this.floorAlpha(f);
    this.active.push(f);
  }

  private plane(name: string, size: number, horizontal: boolean): Mesh {
    const m = MeshBuilder.CreatePlane(name, { size }, this.scene);
    if (horizontal) {
      m.rotation.x = Math.PI / 2;
      m.bakeCurrentTransformIntoVertices();
    }
    return m;
  }

  // ------------------------------------------------------------------ 粒子

  private takePs(key: string, cap: number, setup: (ps: ParticleSystem) => void): PsFx {
    const pool = this.psPool.get(key) ?? [];
    this.psPool.set(key, pool);
    let f = pool.find((p) => !p.busy && p.ps.getActiveCount() === 0 && p.ps.getCapacity() >= cap);
    if (!f) {
      const ps = new ParticleSystem(`ps_${key}_${pool.length}`, Math.max(cap, 8), this.scene);
      ps.updateSpeed = 1 / 60;
      ps.preventAutoStart = true;
      setup(ps);
      f = { key, ps, stopAt: 0, freeAt: 0, handle: 0, busy: false };
      pool.push(f);
    }
    f.busy = true;
    return f;
  }

  private burst(
    key: string,
    at: Vector3 | Mesh,
    o: {
      count: number; tex: TexKey; pal: PaletteColors; life: [number, number]; size: [number, number]; power: [number, number];
      emitter: (ps: ParticleSystem) => void; gravity?: number; blend?: number; rate?: number; duration?: number; stretched?: boolean;
      sizeEnd?: number; spin?: number; owner?: VfxOwner; priority?: VfxPriority; distance?: number; colors?: [Color4, Color4, Color4];
    },
  ): void {
    const g = this.budget.request({ owner: o.owner ?? "self", priority: o.priority ?? "primary", particles: o.count, distance: o.distance });
    if (!g.allowed) return;
    const n = particleCount(o.count, this.q, g.scale);
    const f = this.takePs(key, n, () => {});
    const ps = f.ps;
    ps.particleTexture = this.tex(o.tex);
    ps.emitter = at instanceof Mesh ? at : at.clone();
    o.emitter(ps);
    const [c1, c2, cd] = o.colors ?? [o.pal.p1, o.pal.p2, o.pal.pDead];
    ps.color1 = c1.clone();
    ps.color2 = c2.clone();
    ps.colorDead = cd.clone();
    ps.minLifeTime = o.life[0];
    ps.maxLifeTime = o.life[1];
    ps.minSize = o.size[0];
    ps.maxSize = o.size[1];
    ps.minEmitPower = o.power[0];
    ps.maxEmitPower = o.power[1];
    ps.gravity = new Vector3(0, o.gravity ?? 0, 0);
    ps.blendMode = o.blend ?? ParticleSystem.BLENDMODE_ADD;
    ps.billboardMode = o.stretched ? ParticleSystem.BILLBOARDMODE_STRETCHED : ParticleSystem.BILLBOARDMODE_ALL;
    ps.minAngularSpeed = -(o.spin ?? 0);
    ps.maxAngularSpeed = o.spin ?? 0;
    ps.minInitialRotation = 0;
    ps.maxInitialRotation = o.spin ? Math.PI : 0;
    ps.removeSizeGradient(0);
    ps.removeSizeGradient(1);
    if (o.sizeEnd !== undefined) {
      ps.addSizeGradient(0, 1);
      ps.addSizeGradient(1, o.sizeEnd);
    }
    if (o.rate) {
      ps.manualEmitCount = -1;
      ps.emitRate = o.rate * this.q.particleScale * g.scale;
    } else {
      ps.emitRate = 0;
      ps.manualEmitCount = n;
    }
    ps.reset();
    ps.start();
    f.stopAt = this.time + (o.duration ?? 0.05);
    f.freeAt = this.time + (o.duration ?? 0.05) + o.life[1] + 0.05;
    f.handle = g.handle;
    this.psActive.push(f);
    this.stats.spawned++;
  }

  // ------------------------------------------------------------------ 公開：生成特效

  spawn(key: FxKey, at: Vector3, opt: SpawnOptions = {}): void {
    const pal = PALETTES[opt.palette ?? "steel"];
    const owner = opt.owner ?? "self";
    const yaw = opt.yaw ?? 0;
    const sc = opt.scale ?? 1;
    const q = this.q;
    const req = (priority: VfxPriority, particles: number) => this.budget.request({ owner, priority, particles, distance: opt.distance });
    const common = { owner, distance: opt.distance };
    switch (key) {
      case "slashArc":
      case "slashArcRise":
      case "slashArcBig": {
        const g = req("primary", 0);
        if (!g.allowed) return;
        const f = this.takeMesh("arc", () => {
          const mesh = this.plane("fxArc", 1, false);
          const mat = this.makeMat("fxArcMat", this.tex("crescent"), pal.main);
          mesh.material = mat;
          return { mesh, mat };
        });
        f.mat.emissiveColor.copyFrom(pal.main);
        const big = key === "slashArcBig";
        const tilt = key === "slashArc" ? Math.PI / 2 : key === "slashArcRise" ? Math.PI / 2 - 0.9 : Math.PI / 2 + 0.75;
        f.mesh.position.copyFrom(at);
        f.mesh.rotation.set(tilt, yaw, key === "slashArcRise" ? -0.5 : 0);
        f.baseScale = (big ? 2.4 : 1.7) * sc;
        this.startMesh(f, big ? 0.3 : 0.22, g.handle, (ff, u) => {
          const s = ff.baseScale * (0.65 + 0.5 * Math.sqrt(u));
          ff.mesh.scaling.set(s, s, s);
          ff.mesh.rotation.z += 0.0;
          ff.mat.alpha = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
        });
        this.burst("arcSpark", at, { ...common, count: big ? 40 : 18, tex: "spark", pal, life: [0.15, 0.35], size: [0.05, 0.12], power: [2, 5],
          emitter: (ps) => ps.createSphereEmitter(0.35 * sc, 1), stretched: true, priority: "secondary" });
        break;
      }
      case "whirlRing": {
        const g = req("primary", 0);
        if (!g.allowed) return;
        const f = this.takeMesh("whirl", () => {
          const mesh = this.plane("fxWhirl", 1, true);
          const mat = this.makeMat("fxWhirlMat", this.tex("crescent"), pal.main);
          mesh.material = mat;
          const extra = this.plane("fxWhirl2", 1, true);
          const extraMat = this.makeMat("fxWhirl2Mat", this.tex("ring"), pal.main);
          extra.material = extraMat;
          return { mesh, mat, extra, extraMat };
        });
        f.mat.emissiveColor.copyFrom(pal.main);
        f.extraMat!.emissiveColor.copyFrom(pal.main);
        f.follow = opt.follow;
        f.offset.set(0, 0.42, 0);
        f.baseScale = 4.2 * sc;
        this.startMesh(f, opt.duration ?? 1, g.handle, (ff, u, dt) => {
          ff.spin = (ff.spin ?? 0) + dt * 22;
          ff.mesh.rotation.y = -(ff.spin ?? 0);
          const env = Math.min(1, u * 8) * Math.min(1, (1 - u) * 6);
          ff.mesh.scaling.setAll(ff.baseScale * (0.9 + 0.1 * Math.sin(u * 30)));
          ff.mat.alpha = 0.9 * env;
          if (ff.extra) {
            ff.extra.scaling.setAll(ff.baseScale * 1.02);
            ff.extraMat!.alpha = 0.35 * env;
          }
        });
        break;
      }
      case "magicCircle":
      case "magicCircleBig": {
        const g = req("primary", 0);
        if (!g.allowed) return;
        const big = key === "magicCircleBig";
        const f = this.takeMesh(big ? "circleBig" : "circle", () => {
          const mesh = this.plane("fxCircle", 1, true);
          const mat = this.makeMat("fxCircleMat", this.tex(big ? "runeBig" : "rune"), pal.main);
          mesh.material = mat;
          const extra = this.plane("fxCircleIn", 1, true);
          const extraMat = this.makeMat("fxCircleInMat", this.tex("rune"), pal.core);
          extra.material = extraMat;
          return { mesh, mat, extra, extraMat };
        });
        f.mat.emissiveColor.copyFrom(pal.main);
        f.extraMat!.emissiveColor.copyFrom(pal.main);
        f.follow = opt.follow;
        f.offset.set(0, 0.03, 0);
        f.mesh.position.copyFrom(at).addInPlaceFromFloats(0, 0.03, 0);
        f.baseScale = (big ? 4.6 : 2.4) * sc;
        if (f.extra) f.extra.setEnabled(q.secondary);
        this.startMesh(f, opt.duration ?? 1.1, g.handle, (ff, u, dt) => {
          ff.spin = (ff.spin ?? 0) + dt;
          const pop = Math.min(1, u * 6);
          const s = ff.baseScale * (0.5 + 0.5 * (1 - (1 - pop) * (1 - pop)));
          ff.mesh.scaling.setAll(s);
          ff.mesh.rotation.y = (ff.spin ?? 0) * 0.9;
          const a = pop * Math.min(1, (1 - u) * 5);
          ff.mat.alpha = 0.95 * a;
          if (ff.extra) {
            ff.extra.position.copyFrom(ff.mesh.position).addInPlaceFromFloats(0, 0.01, 0);
            ff.extra.scaling.setAll(s * 0.62);
            ff.extra.rotation.y = -(ff.spin ?? 0) * 1.6;
            ff.extraMat!.alpha = 0.7 * a;
          }
        });
        // 上升光點
        this.burst("circleMotes", at.add(new Vector3(0, 0.05, 0)), { ...common, count: big ? 70 : 36, tex: "star", pal, life: [0.6, 1.1], size: [0.04, 0.11],
          power: [0.2, 0.5], emitter: (ps) => ps.createCylinderEmitter(f.baseScale * 0.38, 0.02, 1, 0), gravity: 1.2, rate: big ? 70 : 40,
          duration: (opt.duration ?? 1.1) * 0.8, spin: 2, priority: "secondary" });
        break;
      }
      case "groundGlow": {
        const g = req("primary", 0);
        if (!g.allowed) return;
        const f = this.takeMesh("gglow", () => {
          const mesh = this.plane("fxGGlow", 1, true);
          const mat = this.makeMat("fxGGlowMat", this.tex("glowDisc"), pal.main);
          mesh.material = mat;
          return { mesh, mat };
        });
        f.mat.emissiveColor.copyFrom(pal.main);
        f.follow = opt.follow;
        f.offset.set(0, 0.025, 0);
        f.baseScale = 2.6 * sc;
        this.startMesh(f, opt.duration ?? 1.1, g.handle, (ff, u) => {
          ff.mesh.scaling.setAll(ff.baseScale * (0.6 + 0.4 * u) * (1 + 0.06 * Math.sin(u * 40)));
          ff.mat.alpha = Math.min(1, u * 3) * (0.55 + 0.3 * u) * Math.min(1, (1 - u) * 8);
        });
        break;
      }
      case "chargeAura": {
        const dur = opt.duration ?? 1;
        const node = opt.follow;
        const p = node ? node.getAbsolutePosition().add(new Vector3(0, 0.55, 0)) : at;
        this.burst("chargeIn", p, { ...common, count: 140, tex: "star", pal, life: [0.35, 0.55], size: [0.05, 0.13], power: [-2.6, -1.8],
          emitter: (ps) => ps.createSphereEmitter(1.25, 0), rate: 150, duration: dur, spin: 3 });
        this.burst("chargeSpark", p, { ...common, count: 50, tex: "spark", pal, life: [0.15, 0.3], size: [0.04, 0.09], power: [1.5, 3],
          emitter: (ps) => ps.createSphereEmitter(0.35, 1), rate: 45, duration: dur, stretched: true, priority: "secondary" });
        const g = req("primary", 0);
        if (!g.allowed) return;
        const f = this.takeMesh("aura", () => {
          const mesh = this.plane("fxAura", 1, false);
          mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
          const mat = this.makeMat("fxAuraMat", this.tex("flare"), pal.main);
          mesh.material = mat;
          return { mesh, mat };
        });
        f.mat.emissiveColor.copyFrom(pal.main);
        f.follow = node;
        f.offset.set(0, 0.55, 0);
        f.baseScale = 1.6 * sc;
        this.startMesh(f, dur, g.handle, (ff, u) => {
          ff.mesh.scaling.setAll(ff.baseScale * (0.4 + 0.8 * u) * (1 + 0.12 * Math.sin(u * 60)));
          ff.mat.alpha = Math.min(1, u * 2) * 0.75;
        });
        break;
      }
      case "gatherMotes": {
        const em = opt.emitterMesh;
        this.burst("gather", em ?? at, { ...common, count: 60, tex: "star", pal, life: [0.25, 0.4], size: [0.03, 0.08], power: [-2.2, -1.4],
          emitter: (ps) => ps.createSphereEmitter(0.55, 0), rate: 90, duration: opt.duration ?? 0.4, spin: 3 });
        break;
      }
      case "shockwave": {
        const g = req("primary", 0);
        if (!g.allowed) return;
        const f = this.takeMesh("shock", () => {
          const mesh = this.plane("fxShock", 1, true);
          const mat = this.makeMat("fxShockMat", this.tex("shock"), pal.main);
          mesh.material = mat;
          const extra = MeshBuilder.CreateCylinder("fxShockWall", { height: 1, diameterTop: 1.1, diameterBottom: 1, tessellation: 32, cap: Mesh.NO_CAP }, this.scene);
          const extraMat = this.makeMat("fxShockWallMat", this.tex("streak"), pal.main);
          extra.material = extraMat;
          return { mesh, mat, extra, extraMat };
        });
        f.mat.emissiveColor.copyFrom(pal.main);
        f.extraMat!.emissiveColor.copyFrom(pal.main);
        f.mesh.position.copyFrom(at).addInPlaceFromFloats(0, 0.04, 0);
        f.baseScale = 3.4 * sc;
        if (f.extra) f.extra.setEnabled(q.secondary);
        this.startMesh(f, 0.5, g.handle, (ff, u) => {
          const e = 1 - (1 - u) * (1 - u) * (1 - u);
          ff.mesh.scaling.setAll(ff.baseScale * (0.12 + 0.88 * e));
          ff.mat.alpha = 1 - u;
          if (ff.extra) {
            ff.extra.position.copyFrom(ff.mesh.position).addInPlaceFromFloats(0, 0.12 * (1 - u), 0);
            const r = ff.baseScale * (0.1 + 0.8 * e);
            ff.extra.scaling.set(r, 0.25 * (1 - u) + 0.02, r);
            ff.extraMat!.alpha = 0.6 * (1 - u);
          }
        });
        break;
      }
      case "dustRing": {
        this.burst("dust", at.add(new Vector3(0, 0.08, 0)), { ...common, count: 36 * sc, tex: "smoke", pal, life: [0.45, 0.8], size: [0.25 * sc, 0.5 * sc], power: [2.2 * sc, 3.6 * sc],
          emitter: (ps) => ps.createCylinderEmitter(0.25 * sc, 0.05, 1, 0.15), gravity: 0.4, blend: ParticleSystem.BLENDMODE_STANDARD, sizeEnd: 2.2,
          colors: [new Color4(0.96, 0.92, 0.85, 0.55), new Color4(0.9, 0.86, 0.8, 0.45), new Color4(0.85, 0.8, 0.75, 0)], spin: 1.5 });
        break;
      }
      case "areaBlast": {
        const g = req("primary", 0);
        if (!g.allowed) return;
        const f = this.takeMesh("blast", () => {
          const mesh = MeshBuilder.CreateSphere("fxBlast", { diameter: 1, segments: 16 }, this.scene);
          const mat = this.makeMat("fxBlastMat", this.tex("glowDisc"), pal.main);
          mat.diffuseTexture = null;
          mat.useAlphaFromDiffuseTexture = false;
          mesh.material = mat;
          const extra = this.plane("fxBlastFlare", 1, false);
          extra.billboardMode = Mesh.BILLBOARDMODE_ALL;
          const extraMat = this.makeMat("fxBlastFlareMat", this.tex("flare"), pal.core);
          extra.material = extraMat;
          return { mesh, mat, extra, extraMat };
        });
        f.mat.emissiveColor.copyFrom(pal.main);
        f.extraMat!.emissiveColor.copyFrom(pal.core);
        f.mesh.position.copyFrom(at).addInPlaceFromFloats(0, 0.5 * sc, 0);
        f.baseScale = 3.2 * sc;
        this.startMesh(f, 0.55, g.handle, (ff, u) => {
          const e = 1 - (1 - u) * (1 - u);
          ff.mesh.scaling.setAll(ff.baseScale * (0.25 + 0.75 * e));
          ff.mat.alpha = 0.55 * (1 - u) * (1 - u);
          if (ff.extra) {
            ff.extra.position.copyFrom(ff.mesh.position);
            ff.extra.scaling.setAll(ff.baseScale * 1.4 * (0.5 + 0.8 * Math.sqrt(u)));
            ff.extraMat!.alpha = Math.max(0, 1 - u * 2.2);
          }
        });
        this.burst("blastStars", at.add(new Vector3(0, 0.6 * sc, 0)), { ...common, count: 90, tex: "star", pal, life: [0.5, 0.95], size: [0.08, 0.2], power: [3, 7],
          emitter: (ps) => ps.createSphereEmitter(0.4, 1), gravity: -6, spin: 4, sizeEnd: 0.3 });
        this.burst("blastEmber", at.add(new Vector3(0, 0.4, 0)), { ...common, count: 60, tex: "dot", pal, life: [0.6, 1.2], size: [0.04, 0.08], power: [1, 3.5],
          emitter: (ps) => ps.createHemisphericEmitter(1.2 * sc, 1), gravity: 1.5, priority: "secondary" });
        break;
      }
      case "starBurst": {
        this.burst("starBurst", at, { ...common, count: 40 * sc, tex: "star", pal, life: [0.35, 0.7], size: [0.08, 0.18], power: [2.5, 5.5],
          emitter: (ps) => ps.createSphereEmitter(0.2, 1), gravity: -3, spin: 5, sizeEnd: 0.2 });
        break;
      }
      case "hitSpark": {
        this.burst("hitSpark", at, { ...common, count: 26, tex: "spark", pal, life: [0.12, 0.25], size: [0.06, 0.14], power: [4, 9],
          emitter: (ps) => ps.createSphereEmitter(0.1, 1), stretched: true, gravity: -4, priority: "critical" });
        break;
      }
      case "hitFlash":
      case "critBurst":
      case "boltImpact": {
        const g = req("critical", 0);
        if (!g.allowed) return;
        const crit = key === "critBurst";
        const f = this.takeMesh("flash", () => {
          const mesh = this.plane("fxFlash", 1, false);
          mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
          const mat = this.makeMat("fxFlashMat", this.tex("flare"), pal.core);
          mesh.material = mat;
          return { mesh, mat };
        });
        f.mat.emissiveColor.copyFrom(crit ? PALETTES.gold.core : key === "boltImpact" ? pal.main : pal.core);
        f.mesh.position.copyFrom(at);
        f.mesh.rotation.z = Math.random() * Math.PI;
        f.baseScale = (crit ? 2.2 : key === "boltImpact" ? 1.5 : 1.05) * sc;
        this.startMesh(f, crit ? 0.22 : 0.14, g.handle, (ff, u) => {
          ff.mesh.scaling.setAll(ff.baseScale * (0.35 + 0.75 * Math.sqrt(u)));
          ff.mat.alpha = 1 - u * u;
        });
        if (crit) {
          this.burst("critStars", at, { ...common, count: 36, tex: "star", pal: PALETTES.gold, life: [0.4, 0.75], size: [0.1, 0.22], power: [3, 6],
            emitter: (ps) => ps.createSphereEmitter(0.2, 1), gravity: -2, spin: 6, priority: "critical" });
          this.spawn("shockwave", at.subtract(new Vector3(0, at.y, 0)), { ...opt, palette: "gold", scale: 0.45 });
        }
        if (key === "boltImpact") this.spawn("starBurst", at, { ...opt, scale: 0.8 });
        break;
      }
      case "swordWave":
      case "magicBolt":
      case "meteor":
        // 投射物請用 launch()
        break;
    }
  }

  /** 命中特效（戰鬥結算後由呼叫端觸發） */
  hitFx(at: Vector3, keys: readonly FxKey[], crit: boolean, opt: SpawnOptions = {}): void {
    for (const k of keys) {
      if (k === "areaBlast" || k === "shockwave" || k === "dustRing") this.spawn(k, new Vector3(at.x, 0, at.z), opt);
      else this.spawn(k, at, opt);
    }
    if (crit) this.spawn("critBurst", at, opt);
  }

  // ------------------------------------------------------------------ 投射物

  launch(kind: "magicBolt" | "swordWave" | "meteor", from: Vector3, dir: Vector3, speed: number, opt: SpawnOptions = {}): Projectile | null {
    const owner = opt.owner ?? "self";
    const g = this.budget.request({ owner, priority: "primary", particles: 40, distance: opt.distance });
    if (!g.allowed) return null;
    const pal = PALETTES[opt.palette ?? (kind === "magicBolt" ? "azure" : kind === "meteor" ? "star" : "azure")];
    const sc = opt.scale ?? 1;
    let core: Mesh;
    let mat: StandardMaterial;
    if (kind === "swordWave") {
      core = this.plane("fxWave", 1, false);
      mat = this.makeMat("fxWaveMat", this.tex("crescent"), pal.main);
      core.scaling.setAll(2.0 * sc);
      core.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
      core.rotation.x = Math.PI / 2 - 0.15;
    } else {
      core = this.plane(kind === "meteor" ? "fxMeteor" : "fxBolt", 1, false);
      core.billboardMode = Mesh.BILLBOARDMODE_ALL;
      mat = this.makeMat("fxBoltMat", this.tex("flare"), pal.core);
      core.scaling.setAll((kind === "meteor" ? 1.5 : 0.75) * sc);
    }
    core.material = mat;
    core.isPickable = false;
    this.glowAdd(core);
    core.position.copyFrom(from);
    // 尾巴粒子跟著核心
    const tg = this.budget.request({ owner, priority: "primary", particles: 60, distance: opt.distance });
    let trail: PsFx | null = null;
    if (tg.allowed) {
      const n = particleCount(kind === "meteor" ? 160 : 90, this.q, tg.scale);
      trail = this.takePs(`trail_${kind}`, n, () => {});
      const ps = trail.ps;
      ps.particleTexture = this.tex(kind === "swordWave" ? "spark" : "star");
      ps.emitter = core;
      ps.createSphereEmitter(kind === "swordWave" ? 0.5 : 0.12, 1);
      ps.color1 = pal.p1.clone();
      ps.color2 = pal.p2.clone();
      ps.colorDead = pal.pDead.clone();
      ps.minLifeTime = 0.18;
      ps.maxLifeTime = kind === "meteor" ? 0.55 : 0.35;
      ps.minSize = 0.05;
      ps.maxSize = kind === "meteor" ? 0.3 : 0.15;
      ps.minEmitPower = 0.1;
      ps.maxEmitPower = 0.6;
      ps.gravity = Vector3.Zero();
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.billboardMode = kind === "swordWave" ? ParticleSystem.BILLBOARDMODE_STRETCHED : ParticleSystem.BILLBOARDMODE_ALL;
      ps.minAngularSpeed = -3;
      ps.maxAngularSpeed = 3;
      ps.manualEmitCount = -1;
      ps.emitRate = (kind === "meteor" ? 260 : 160) * this.q.particleScale * tg.scale;
      ps.reset();
      ps.start();
      trail.handle = tg.handle;
      trail.stopAt = Infinity;
      trail.freeAt = Infinity;
      this.psActive.push(trail);
    }
    const self = this;
    const v = dir.normalizeToNew().scaleInPlace(speed);
    let life = 0;
    const p = {
      node: core,
      core,
      pos: core.position,
      alive: true,
      travelled: 0,
      trail,
      handle: g.handle,
      vel: v,
      step(dt: number) {
        life += dt;
        core.position.addInPlace(v.scale(dt));
        p.travelled += speed * dt;
        if (kind === "swordWave") {
          mat.alpha = Math.min(1, life * 10) * 0.95;
          core.scaling.setAll(2.0 * sc * (1 + life * 0.6));
        } else {
          core.scaling.setAll((kind === "meteor" ? 1.5 : 0.75) * sc * (1 + 0.15 * Math.sin(life * 40)));
        }
      },
      /** 方向（追蹤目標時由呼叫端每幀更新） */
      steer(to: Vector3, turn: number) {
        const want = to.subtract(core.position).normalize().scaleInPlace(speed);
        Vector3.LerpToRef(v, want, Math.min(1, turn), v);
        v.normalize().scaleInPlace(speed);
      },
      dispose(withBurst = true) {
        if (!p.alive) return;
        p.alive = false;
        if (withBurst && kind === "swordWave") self.spawn("hitSpark", core.position.clone(), opt);
        if (trail) {
          trail.ps.stop();
          trail.stopAt = self.time;
          trail.freeAt = self.time + 0.6;
        }
        self.budget.release(g.handle);
        core.dispose(false, true);
      },
    };
    this.projectiles.push(p);
    this.stats.spawned++;
    return p as unknown as Projectile;
  }

  // ------------------------------------------------------------------ 每幀

  update(dt: number): void {
    this.time += dt;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i]!;
      f.t += dt;
      const u = Math.min(1, f.t / f.dur);
      if (f.follow) f.mesh.position.copyFrom(f.follow.getAbsolutePosition()).addInPlace(f.offset);
      if (f.extra && f.follow) f.extra.position.copyFrom(f.mesh.position);
      f.tick(f, u, dt);
      this.floorAlpha(f);
      if (u >= 1) {
        f.mesh.setEnabled(false);
        f.extra?.setEnabled(false);
        this.budget.release(f.handle);
        this.active.splice(i, 1);
        this.meshPool.get(f.key)!.push(f);
      }
    }
    let parts = 0;
    for (let i = this.psActive.length - 1; i >= 0; i--) {
      const f = this.psActive[i]!;
      if (this.time >= f.stopAt && f.ps.isStarted()) f.ps.stop();
      parts += f.ps.getActiveCount();
      if (this.time >= f.freeAt && f.ps.getActiveCount() === 0) {
        f.busy = false;
        this.budget.release(f.handle);
        this.psActive.splice(i, 1);
      }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      if (!p.alive) {
        this.projectiles.splice(i, 1);
        continue;
      }
      p.step(dt);
    }
    this.stats.meshFx = this.active.length;
    this.stats.particles = parts;
    this.stats.projectiles = this.projectiles.length;
  }

  /** 全部清除（換場景、測試用） */
  clear(): void {
    for (const p of [...this.projectiles]) p.dispose(false);
    for (const f of this.active) {
      f.mesh.setEnabled(false);
      f.extra?.setEnabled(false);
      this.budget.release(f.handle);
      this.meshPool.get(f.key)!.push(f);
    }
    this.active.length = 0;
    for (const f of this.psActive) {
      f.ps.stop();
      f.ps.reset();
      f.busy = false;
      this.budget.release(f.handle);
    }
    this.psActive.length = 0;
  }

  dispose(): void {
    this.clear();
    for (const l of this.meshPool.values()) for (const f of l) {
      f.mesh.dispose(false, true);
      f.extra?.dispose(false, true);
    }
    for (const l of this.psPool.values()) for (const f of l) f.ps.dispose();
    this.glow?.dispose();
  }
}

