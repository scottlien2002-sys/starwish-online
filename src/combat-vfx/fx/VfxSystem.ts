/**
 * 共用戰鬥特效系統 V2（Babylon.js 9；Combat VFX Lab Stage 2）。
 *
 * - spawn(鍵值, 位置, 選項)：一次性特效；先經過 VfxBudget（多人數量限制），再依品質決定粒子數與細節層。
 * - 每個特效都有「蓄力／出現 → 釋放 → 命中 → 消散」的時間曲線，不是單純光圈或粒子堆疊；
 *   主要特效是多層（例：劍氣＝主色弧＋白色核心弧＋外層柔光弧＋火花＋碎片）。
 * - 物件池：網格特效與粒子系統都重複使用，戰鬥中不反覆建立／釋放。
 * - 材質共用：同一張貼圖＋同一個顏色只建立一個材質（多人時材質數不會隨人數增加）；
 *   淡入淡出用 mesh.visibility，不改共用材質。
 * - 環境：dark（深色競技場，加算混合發光）／bright（白天草地：改用一般混合＋飽和色，白天也看得清楚）。
 * - 其他玩家（owner ≠ self）一律走簡化版：不畫第二／三層、粒子打折，並受多人預算限制。
 * - 特效只負責畫面；傷害一律由戰鬥系統（多人時是伺服器）結算後再呼叫 hitFx()。
 */
import {
  Color3,
  Color4,
  Constants,
  GlowLayer,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  type Scene,
  StandardMaterial,
  TrailMesh,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { FxKey, Palette } from "../core/skills.ts";
import { VFX_QUALITY, type VfxQualityConfig, type VfxTier, particleCount } from "../core/quality.ts";
import { VfxBudget, type VfxOwner, type VfxPriority } from "../core/budget.ts";
import { fxTexture, type TexKey } from "./textures.ts";
import { PALETTES, type PaletteColors } from "./palette.ts";

export type VfxEnvironment = "dark" | "bright";

export interface SpawnOptions {
  owner?: VfxOwner;
  palette?: Palette;
  /** 面向（弧度，Babylon 世界的 rotation.y） */
  yaw?: number;
  scale?: number;
  duration?: number;
  /** 跟隨的節點（魔法陣、旋風、蓄力光環、光盾跟著角色） */
  follow?: TransformNode;
  /** 粒子發射點跟隨的網格（武器尖端） */
  emitterMesh?: Mesh;
  /** 與鏡頭的距離（預算用） */
  distance?: number;
  /** 重要戰鬥特效（影響本地玩家）：主層不受距離／份額／上限限制（見 VfxRequest.essential） */
  essential?: boolean;
}

interface MeshFx {
  key: string;
  mesh: Mesh;
  /** 同一特效的其他層（核心、柔光、內圈…） */
  layers: Mesh[];
  t: number;
  dur: number;
  handle: number;
  follow?: TransformNode;
  offset: Vector3;
  baseScale: number;
  spin: number;
  n: number;
  tick: (f: MeshFx, u: number, dt: number) => void;
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
const COMBINE = Constants.ALPHA_COMBINE;
const WHITE = new Color3(1, 1, 1);
const lum = (c: Color3): number => 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
/** 白天環境：飽和、偏深的顏色（白色核心維持白色） */
function deepen(c: Color3): Color3 {
  const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b);
  if (mx - mn < 0.12) return c.clone();
  return new Color3(c.r ** 3, c.g ** 3, c.b ** 3).scale(1 / Math.max(1e-3, Math.max(c.r ** 3, c.g ** 3, c.b ** 3)));
}
function deepen4(c: Color4): Color4 {
  const d = deepen(new Color3(c.r, c.g, c.b));
  return new Color4(d.r, d.g, d.b, c.a);
}

export class VfxSystem {
  readonly scene: Scene;
  q: VfxQualityConfig;
  readonly budget: VfxBudget;
  env: VfxEnvironment = "dark";
  /** 其他玩家的特效簡化（Stage 2）；false = Stage 1 做法（效能比較用） */
  remoteSimplify = true;
  /** 暴擊時呼叫（畫面閃光等由外部處理） */
  onCrit: ((at: Vector3) => void) | null = null;
  private glow: GlowLayer | null = null;
  private time = 0;
  private readonly meshPool = new Map<string, MeshFx[]>();
  private readonly active: MeshFx[] = [];
  private readonly psPool = new Map<string, PsFx[]>();
  private readonly psActive: PsFx[] = [];
  private readonly mats = new Map<string, { mat: StandardMaterial; base: Color3; tex: TexKey | null }>();
  private readonly projectiles: (Projectile & { step: (dt: number) => void })[] = [];
  /** 統計（FPS 面板、效能報告） */
  stats = { meshFx: 0, particles: 0, projectiles: 0, spawned: 0, materials: 0, pooledMeshes: 0, pooledSystems: 0 };

  constructor(scene: Scene, tier: VfxTier) {
    this.scene = scene;
    this.q = VFX_QUALITY[tier];
    this.budget = new VfxBudget(this.q);
    this.setTier(tier);
  }

  setTier(tier: VfxTier): void {
    this.q = VFX_QUALITY[tier];
    this.budget.setQuality(this.q);
    this.glow?.dispose();
    this.glow = null;
    if (this.q.glow) {
      this.glow = new GlowLayer("fxGlow", this.scene, { mainTextureRatio: this.q.glowTextureRatio, blurKernelSize: tier === "high" ? 32 : 16 });
      this.glow.intensity = this.env === "bright" ? 0.35 : 0.5;
      for (const list of this.meshPool.values()) for (const f of list) this.glowAll(f);
      for (const f of this.active) this.glowAll(f);
    }
  }

  /** 深色競技場／白天草地。換環境時把已建立的共用材質一起改掉。 */
  setEnvironment(env: VfxEnvironment): void {
    this.env = env;
    for (const { mat, base } of this.mats.values()) this.styleMat(mat, base);
    if (this.glow) this.glow.intensity = env === "bright" ? 0.35 : 0.5;
  }

  private glowAll(f: MeshFx): void {
    if (!this.glow) return;
    this.glow.addIncludedOnlyMesh(f.mesh);
    for (const l of f.layers) this.glow.addIncludedOnlyMesh(l);
  }

  // ------------------------------------------------------------------ 共用材質

  private styleMat(m: StandardMaterial, base: Color3): void {
    const bright = this.env === "bright";
    m.emissiveColor.copyFrom(bright ? deepen(base) : base);
    m.alphaMode = bright && lum(base) < 0.97 ? COMBINE : ADD;
  }

  /** 同一張貼圖＋同一個顏色共用一個材質（disableLighting 時 Babylon 只輸出自發光，所以顏色放在 emissiveColor） */
  private mat(tex: TexKey | null, color: Color3): StandardMaterial {
    const id = `${tex ?? "none"}|${color.toHexString()}`;
    const hit = this.mats.get(id);
    if (hit) return hit.mat;
    const m = new StandardMaterial(`fxm_${id}`, this.scene);
    if (tex) {
      m.diffuseTexture = fxTexture(this.scene, tex, this.q.textureSize);
      m.useAlphaFromDiffuseTexture = true;
    }
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.disableLighting = true;
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
    m.fogEnabled = false;
    this.styleMat(m, color);
    this.mats.set(id, { mat: m, base: color.clone(), tex });
    this.stats.materials = this.mats.size;
    return m;
  }

  private paint(m: Mesh, tex: TexKey | null, color: Color3): void {
    m.material = this.mat(tex, color);
  }

  private plane(name: string, horizontal: boolean, billboard = false): Mesh {
    const m = MeshBuilder.CreatePlane(name, { size: 1 }, this.scene);
    if (horizontal) {
      m.rotation.x = Math.PI / 2;
      m.bakeCurrentTransformIntoVertices();
    }
    if (billboard) m.billboardMode = Mesh.BILLBOARDMODE_ALL;
    m.isPickable = false;
    return m;
  }

  private takeMesh(key: string, build: () => { mesh: Mesh; layers?: Mesh[] }): MeshFx {
    const pool = this.meshPool.get(key) ?? [];
    this.meshPool.set(key, pool);
    let f = pool.pop();
    if (!f) {
      const b = build();
      b.mesh.isPickable = false;
      for (const l of b.layers ?? []) l.isPickable = false;
      f = { key, mesh: b.mesh, layers: b.layers ?? [], t: 0, dur: 1, handle: 0, offset: Vector3.Zero(), baseScale: 1, spin: 0, n: 0, tick: () => {} };
      this.glowAll(f);
      this.stats.pooledMeshes++;
    }
    f.mesh.setEnabled(true);
    for (const l of f.layers) l.setEnabled(true);
    f.t = 0;
    f.follow = undefined;
    f.spin = 0;
    f.n = 0;
    f.offset.setAll(0);
    return f;
  }

  private startMesh(f: MeshFx, dur: number, handle: number, tick: MeshFx["tick"]): void {
    f.dur = dur;
    f.handle = handle;
    f.tick = tick;
    if (f.follow) f.mesh.position.copyFrom(f.follow.getAbsolutePosition()).addInPlace(f.offset);
    tick(f, 0, 0);
    this.floor(f);
    this.active.push(f);
  }

  /** visibility 不讓它剛好是 0（0 會被當成看不見而略過） */
  private floor(f: MeshFx): void {
    if (f.mesh.visibility < 0.004) f.mesh.visibility = 0.004;
    for (const l of f.layers) if (l.visibility < 0.004) l.visibility = 0.004;
  }

  // ------------------------------------------------------------------ 粒子

  private takePs(key: string, cap: number): PsFx {
    const pool = this.psPool.get(key) ?? [];
    this.psPool.set(key, pool);
    let f = pool.find((p) => !p.busy && p.ps.getActiveCount() === 0 && p.ps.getCapacity() >= cap);
    if (!f) {
      const ps = new ParticleSystem(`ps_${key}_${pool.length}`, Math.max(cap, 8), this.scene);
      ps.updateSpeed = 1 / 60;
      ps.preventAutoStart = true;
      f = { key, ps, stopAt: 0, freeAt: 0, handle: 0, busy: false };
      pool.push(f);
      this.stats.pooledSystems++;
    }
    f.busy = true;
    return f;
  }

  private burst(
    key: string,
    at: Vector3 | Mesh | TransformNode,
    o: {
      count: number; tex: TexKey; pal: PaletteColors; life: [number, number]; size: [number, number]; power: [number, number];
      emitter: (ps: ParticleSystem) => void; gravity?: number; blend?: number; rate?: number; duration?: number; stretched?: boolean;
      sizeEnd?: number; spin?: number; owner?: VfxOwner; priority?: VfxPriority; distance?: number; colors?: [Color4, Color4, Color4];
      keepAdd?: boolean; drag?: number; essential?: boolean;
    },
  ): void {
    const g = this.budget.request({ owner: o.owner ?? "self", priority: o.priority ?? "primary", particles: o.count, distance: o.distance, essential: o.essential });
    if (!g.allowed) return;
    const remoteScale = (o.owner ?? "self") === "self" || !this.remoteSimplify ? 1 : 0.6;
    const n = Math.max(2, particleCount(o.count, this.q, g.scale * remoteScale));
    const f = this.takePs(key, n);
    const ps = f.ps;
    ps.particleTexture = fxTexture(this.scene, o.tex, this.q.textureSize);
    ps.emitter = at instanceof Vector3 ? at.clone() : (at as Mesh);
    o.emitter(ps);
    const bright = this.env === "bright";
    let [c1, c2, cd] = o.colors ?? [o.pal.p1, o.pal.p2, o.pal.pDead];
    const blend = o.blend ?? ParticleSystem.BLENDMODE_ADD;
    const toStd = bright && blend === ParticleSystem.BLENDMODE_ADD && !o.keepAdd;
    if (toStd) {
      c1 = deepen4(c1); c2 = deepen4(c2); cd = deepen4(cd);
    }
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
    ps.blendMode = toStd ? ParticleSystem.BLENDMODE_STANDARD : blend;
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
    ps.removeDragGradient(0);
    if (o.drag) ps.addDragGradient(0, o.drag);
    if (o.rate) {
      ps.manualEmitCount = -1;
      ps.emitRate = o.rate * this.q.particleScale * g.scale * remoteScale;
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

  /** 測試／除錯用觀察者：每次要求生成特效時呼叫（是否核准由預算決定） */
  onSpawn: ((key: FxKey, at: Vector3, owner: VfxOwner) => void) | null = null;

  spawn(key: FxKey, at: Vector3, opt: SpawnOptions = {}): void {
    this.onSpawn?.(key, at, opt.owner ?? "self");
    const pal = PALETTES[opt.palette ?? "steel"];
    const owner = opt.owner ?? "self";
    const lite = (owner !== "self" && this.remoteSimplify) || !this.q.secondary;   // 其他玩家／低畫質：只畫主層
    const yaw = opt.yaw ?? 0;
    const sc = opt.scale ?? 1;
    const req = (priority: VfxPriority, particles: number) => this.budget.request({ owner, priority, particles, distance: opt.distance, essential: opt.essential });
    const common = { owner, distance: opt.distance, essential: opt.essential };
    switch (key) {
      // ---------------------------------------------------------------- 劍氣：主色弧＋白色核心＋外層柔光（三層）＋火花
      case "slashArc":
      case "slashArcRise":
      case "slashArcBig": {
        const g = req("primary", 0);
        if (!g.allowed) return;
        const big = key === "slashArcBig";
        const f = this.takeMesh("arc", () => ({ mesh: this.plane("fxArc", false), layers: [this.plane("fxArcCore", false), this.plane("fxArcGlow", false)] }));
        this.paint(f.mesh, "crescent", pal.main);
        this.paint(f.layers[0]!, "crescent", pal.core);
        this.paint(f.layers[1]!, "crescent", pal.main);
        f.layers[0]!.setEnabled(!lite);
        f.layers[1]!.setEnabled(!lite);
        const tilt = key === "slashArc" ? Math.PI / 2 : key === "slashArcRise" ? Math.PI / 2 - 0.9 : Math.PI / 2 + 0.75;
        const roll = key === "slashArcRise" ? -0.5 : 0;
        for (const m of [f.mesh, ...f.layers]) {
          m.position.copyFrom(at);
          m.rotation.set(tilt, yaw, roll);
        }
        f.baseScale = (big ? 2.5 : 1.75) * sc;
        this.startMesh(f, big ? 0.34 : 0.25, g.handle, (ff, u) => {
          // 出現（0→0.12 快速張開）→ 釋放（延展）→ 消散（變薄變淡）
          const open = 1 - (1 - Math.min(1, u / 0.18)) ** 3;
          const s = ff.baseScale * (0.55 + 0.55 * open + 0.15 * u);
          ff.mesh.scaling.set(s, s * (1 - 0.35 * u), s);
          ff.mesh.visibility = u < 0.12 ? u / 0.12 : (1 - (u - 0.12) / 0.88) ** 1.3;
          const core = ff.layers[0]!;
          core.scaling.set(s * 0.9, s * 0.82 * (1 - 0.5 * u), s * 0.9);
          core.visibility = u < 0.1 ? u / 0.1 : Math.max(0, 1 - (u - 0.1) / 0.45);
          const glow = ff.layers[1]!;
          glow.scaling.set(s * 1.28, s * 1.3, s * 1.28);
          glow.visibility = 0.38 * (u < 0.2 ? u / 0.2 : 1 - (u - 0.2) / 0.8);
        });
        this.burst("arcSpark", at, { ...common, count: big ? 46 : 22, tex: "spark", pal, life: [0.14, 0.34], size: [0.05, 0.12], power: [2.5, 6],
          emitter: (ps) => ps.createSphereEmitter(0.38 * sc, 1), stretched: true, priority: "secondary", drag: 0.3 });
        if (big && !lite) this.spawn("starShards", at, { ...opt, scale: 0.8 });
        break;
      }
      case "whirlRing": {
        const g = req("primary", 0);
        if (!g.allowed) return;
        const f = this.takeMesh("whirl", () => ({ mesh: this.plane("fxWhirl", true), layers: [this.plane("fxWhirl2", true), this.plane("fxWhirlCore", true)] }));
        this.paint(f.mesh, "crescent", pal.main);
        this.paint(f.layers[0]!, "ring", pal.main);
        this.paint(f.layers[1]!, "crescent", pal.core);
        f.layers[1]!.setEnabled(!lite);
        f.follow = opt.follow;
        f.offset.set(0, 0.42, 0);
        f.baseScale = 4.2 * sc;
        this.startMesh(f, opt.duration ?? 1, g.handle, (ff, u, dt) => {
          ff.spin += dt * 22;
          const env = Math.min(1, u * 8) * Math.min(1, (1 - u) * 6);
          ff.mesh.rotation.y = -ff.spin;
          ff.mesh.scaling.setAll(ff.baseScale * (0.9 + 0.1 * Math.sin(u * 30)));
          ff.mesh.visibility = 0.9 * env;
          const ring = ff.layers[0]!;
          ring.position.copyFrom(ff.mesh.position).addInPlaceFromFloats(0, -0.38, 0);
          ring.scaling.setAll(ff.baseScale * (1.0 + 0.05 * Math.sin(u * 40)));
          ring.visibility = 0.35 * env;
          const core = ff.layers[1]!;
          core.position.copyFrom(ff.mesh.position).addInPlaceFromFloats(0, 0.05, 0);
          core.rotation.y = -ff.spin * 1.35 + 1.2;
          core.scaling.setAll(ff.baseScale * 0.8);
          core.visibility = 0.8 * env;
          // 旋轉中持續甩出火花
          if (!lite && Math.floor(u * 12) > ff.n) {
            ff.n = Math.floor(u * 12);
            const a = -ff.spin;
            this.burst("whirlSpark", ff.mesh.position.add(new Vector3(Math.sin(a) * ff.baseScale * 0.45, 0, Math.cos(a) * ff.baseScale * 0.45)),
              { ...common, count: 8, tex: "spark", pal, life: [0.12, 0.25], size: [0.04, 0.09], power: [2, 4], emitter: (ps) => ps.createSphereEmitter(0.1, 1), stretched: true, priority: "secondary" });
          }
        });
        break;
      }
      // ---------------------------------------------------------------- 魔法陣：主陣（轉）＋內圈（反轉）＋符文環（慢轉）＋上升光點＋收尾脈衝
      case "magicCircle":
      case "magicCircleBig": {
        const g = req("primary", 0);
        if (!g.allowed) return;
        const big = key === "magicCircleBig";
        const f = this.takeMesh(big ? "circleBig" : "circle", () => ({ mesh: this.plane("fxCircle", true), layers: [this.plane("fxCircleIn", true), this.plane("fxCircleGlyph", true)] }));
        this.paint(f.mesh, big ? "runeBig" : "rune", pal.main);
        this.paint(f.layers[0]!, "rune", pal.core);
        this.paint(f.layers[1]!, "glyphRing", pal.main);
        f.layers[0]!.setEnabled(!lite);
        f.layers[1]!.setEnabled(!lite);
        f.follow = opt.follow;
        f.offset.set(0, 0.03, 0);
        f.mesh.position.copyFrom(at).addInPlaceFromFloats(0, 0.03, 0);
        f.baseScale = (big ? 4.6 : 2.5) * sc;
        this.startMesh(f, opt.duration ?? 1.1, g.handle, (ff, u, dt) => {
          ff.spin += dt * (1 + 2.5 * u);                     // 越轉越快（蓄力）
          const pop = 1 - (1 - Math.min(1, u * 5)) ** 3;
          const pulse = u > 0.84 ? Math.sin(((u - 0.84) / 0.16) * Math.PI) : 0;
          const s = ff.baseScale * (0.45 + 0.55 * pop) * (1 + 0.08 * pulse);
          const a = pop * Math.min(1, (1 - u) * 6);
          ff.mesh.scaling.setAll(s);
          ff.mesh.rotation.y = ff.spin * 0.9;
          ff.mesh.visibility = Math.min(1, 0.9 * a + 0.3 * pulse);
          const inner = ff.layers[0]!;
          inner.position.copyFrom(ff.mesh.position).addInPlaceFromFloats(0, 0.012, 0);
          inner.scaling.setAll(s * 0.58);
          inner.rotation.y = -ff.spin * 1.7;
          inner.visibility = 0.75 * a + 0.25 * pulse;
          const gl = ff.layers[1]!;
          gl.position.copyFrom(ff.mesh.position).addInPlaceFromFloats(0, 0.006, 0);
          gl.scaling.setAll(s * (1.16 + 0.04 * Math.sin(u * 20)));
          gl.rotation.y = ff.spin * 0.35;
          gl.visibility = 0.65 * a;
        });
        this.burst("circleMotes", at.add(new Vector3(0, 0.05, 0)), { ...common, count: big ? 80 : 40, tex: "star", pal, life: [0.6, 1.1], size: [0.04, 0.11],
          power: [0.2, 0.5], emitter: (ps) => ps.createCylinderEmitter(f.baseScale * 0.38, 0.02, 1, 0), gravity: 1.3, rate: big ? 80 : 45,
          duration: (opt.duration ?? 1.1) * 0.85, spin: 2, priority: "secondary" });
        break;
      }
      case "groundGlow": {
        const g = req("primary", 0);
        if (!g.allowed) return;
        const f = this.takeMesh("gglow", () => ({ mesh: this.plane("fxGGlow", true) }));
        this.paint(f.mesh, "glowDisc", pal.main);
        f.follow = opt.follow;
        f.offset.set(0, 0.025, 0);
        f.mesh.position.copyFrom(at).addInPlaceFromFloats(0, 0.025, 0);
        f.baseScale = 2.6 * sc;
        this.startMesh(f, opt.duration ?? 1.1, g.handle, (ff, u) => {
          ff.mesh.scaling.setAll(ff.baseScale * (0.6 + 0.4 * u) * (1 + 0.06 * Math.sin(u * 40)));
          ff.mesh.visibility = Math.min(1, u * 3) * (0.55 + 0.35 * u) * Math.min(1, (1 - u) * 8);
        });
        break;
      }
      // ---------------------------------------------------------------- 蓄力：光暈＋向內聚集的粒子＋收束環（每 0.3 秒一圈）
      case "chargeAura": {
        const dur = opt.duration ?? 1;
        const node = opt.follow;
        const p = node ? node.getAbsolutePosition().add(new Vector3(0, 0.55, 0)) : at;
        this.burst("chargeIn", p, { ...common, count: 140, tex: "star", pal, life: [0.35, 0.55], size: [0.05, 0.13], power: [-2.6, -1.8],
          emitter: (ps) => ps.createSphereEmitter(1.25, 0), rate: 150, duration: dur, spin: 3 });
        this.burst("chargeStreak", p, { ...common, count: 60, tex: "spark", pal, life: [0.18, 0.3], size: [0.05, 0.1], power: [-6, -4.5],
          emitter: (ps) => ps.createSphereEmitter(1.4, 0), rate: 55, duration: dur, stretched: true, priority: "secondary" });
        const g = req("primary", 0);
        if (!g.allowed) return;
        const f = this.takeMesh("aura", () => ({ mesh: this.plane("fxAura", false, true), layers: [this.plane("fxAuraCore", false, true)] }));
        this.paint(f.mesh, "flare", pal.main);
        this.paint(f.layers[0]!, "dot", pal.core);
        f.layers[0]!.setEnabled(!lite);
        f.follow = node;
        f.offset.set(0, 0.55, 0);
        f.baseScale = 1.7 * sc;
        this.startMesh(f, dur, g.handle, (ff, u) => {
          const k = 0.4 + 0.8 * u;
          ff.mesh.scaling.setAll(ff.baseScale * k * (1 + 0.12 * Math.sin(u * 60)));
          ff.mesh.visibility = Math.min(1, u * 2) * 0.8;
          const c = ff.layers[0]!;
          c.position.copyFrom(ff.mesh.position);
          c.scaling.setAll(ff.baseScale * 0.35 * k * (1 + 0.25 * Math.sin(u * 90)));
          c.visibility = Math.min(1, u * 1.5);
          if (!lite && Math.floor(u * dur / 0.3) > ff.n) {
            ff.n = Math.floor(u * dur / 0.3);
            this.spawn("chargeRings", ff.mesh.position.subtract(new Vector3(0, 0.5, 0)), { ...opt, follow: node, scale: sc });
          }
        });
        break;
      }
      case "chargeRings": {
        const g = req("secondary", 0);
        if (!g.allowed) return;
        const f = this.takeMesh("cring", () => ({ mesh: this.plane("fxCRing", true) }));
        this.paint(f.mesh, "ringThin", pal.main);
        f.follow = opt.follow;
        f.offset.set(0, 0.06, 0);
        f.mesh.position.copyFrom(at);
        f.baseScale = 3.2 * sc;
        this.startMesh(f, 0.42, g.handle, (ff, u) => {
          ff.mesh.scaling.setAll(ff.baseScale * (1 - 0.8 * u * u));
          ff.mesh.visibility = Math.sin(Math.PI * u) * 0.9;
        });
        break;
      }
      case "chargeFlash": {
        this.spawn("hitFlash", at, { ...opt, scale: 1.3 * sc });
        this.spawn("hitRing", at, { ...opt, scale: 2.0 * sc });
        this.spawn("shockwave", new Vector3(at.x, 0, at.z), { ...opt, scale: 0.7 * sc });
        break;
      }
      // ---------------------------------------------------------------- 光柱（施法釋放、星隕落點、祭司聖光、怪物重生）
      case "lightPillar": {
        const g = req("primary", 0);
        if (!g.allowed) return;
        const f = this.takeMesh("pillar", () => {
          const mesh = MeshBuilder.CreateCylinder("fxPillar", { height: 1, diameter: 1, tessellation: 24, cap: Mesh.NO_CAP }, this.scene);
          mesh.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));            // 底部在原點，往上長
          const core = MeshBuilder.CreateCylinder("fxPillarCore", { height: 1, diameter: 1, tessellation: 16, cap: Mesh.NO_CAP }, this.scene);
          core.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
          return { mesh, layers: [core] };
        });
        this.paint(f.mesh, "pillar", pal.main);
        this.paint(f.layers[0]!, "pillar", pal.core);
        f.layers[0]!.setEnabled(!lite);
        f.follow = opt.follow;
        f.mesh.position.set(at.x, 0, at.z);
        f.layers[0]!.position.copyFrom(f.mesh.position);
        f.baseScale = sc;
        this.startMesh(f, opt.duration ?? 0.75, g.handle, (ff, u) => {
          const rise = 1 - (1 - Math.min(1, u / 0.14)) ** 3;
          const r = ff.baseScale * (1.1 - 0.75 * u);
          ff.mesh.scaling.set(r, 4.5 * ff.baseScale * rise, r);
          ff.mesh.visibility = (u < 0.1 ? u / 0.1 : 1 - (u - 0.1) / 0.9) * 0.85;
          const c = ff.layers[0]!;
          c.position.copyFrom(ff.mesh.position);
          c.scaling.set(r * 0.38, 5.2 * ff.baseScale * rise, r * 0.38);
          c.visibility = u < 0.1 ? u / 0.1 : Math.max(0, 1 - (u - 0.1) / 0.6);
        });
        this.burst("pillarMotes", new Vector3(at.x, 0.1, at.z), { ...common, count: 50, tex: "star", pal, life: [0.5, 0.9], size: [0.05, 0.12], power: [1.5, 3.5],
          emitter: (ps) => ps.createCylinderEmitter(0.45 * sc, 0.05, 0.2, 0), gravity: 2.5, spin: 3, priority: "secondary" });
        break;
      }
      case "gatherMotes": {
        const em = opt.emitterMesh;
        this.burst("gather", em ?? at, { ...common, count: 60, tex: "star", pal, life: [0.25, 0.4], size: [0.03, 0.08], power: [-2.2, -1.4],
          emitter: (ps) => ps.createSphereEmitter(0.55, 0), rate: 90, duration: opt.duration ?? 0.4, spin: 3 });
        this.burst("gatherStreak", em ?? at, { ...common, count: 30, tex: "spark", pal, life: [0.12, 0.2], size: [0.03, 0.07], power: [-5, -4],
          emitter: (ps) => ps.createSphereEmitter(0.7, 0), rate: 45, duration: opt.duration ?? 0.4, stretched: true, priority: "secondary" });
        break;
      }
      // ---------------------------------------------------------------- 地面衝擊：衝擊環＋立牆＋碎石
      case "shockwave": {
        const g = req("primary", 0);
        if (!g.allowed) return;
        const f = this.takeMesh("shock", () => ({
          mesh: this.plane("fxShock", true),
          layers: [MeshBuilder.CreateCylinder("fxShockWall", { height: 1, diameterTop: 1.1, diameterBottom: 1, tessellation: 32, cap: Mesh.NO_CAP }, this.scene)],
        }));
        this.paint(f.mesh, "shock", pal.main);
        this.paint(f.layers[0]!, "streak", pal.main);
        f.layers[0]!.setEnabled(!lite);
        f.mesh.position.copyFrom(at).addInPlaceFromFloats(0, 0.04, 0);
        f.baseScale = 3.4 * sc;
        this.startMesh(f, 0.55, g.handle, (ff, u) => {
          const e = 1 - (1 - u) ** 3;
          ff.mesh.scaling.setAll(ff.baseScale * (0.12 + 0.88 * e));
          ff.mesh.visibility = (1 - u) ** 1.2;
          const w = ff.layers[0]!;
          w.position.copyFrom(ff.mesh.position).addInPlaceFromFloats(0, 0.12 * (1 - u), 0);
          const r = ff.baseScale * (0.1 + 0.8 * e);
          w.scaling.set(r, 0.28 * (1 - u) + 0.02, r);
          w.visibility = 0.6 * (1 - u);
        });
        if (!lite && sc >= 0.9) this.spawn("debris", at, { ...opt, scale: sc });
        break;
      }
      case "debris": {
        const rock: [Color4, Color4, Color4] = this.env === "bright"
          ? [new Color4(0.45, 0.36, 0.28, 1), new Color4(0.6, 0.5, 0.38, 1), new Color4(0.5, 0.42, 0.32, 0)]
          : [new Color4(0.55, 0.55, 0.7, 1), new Color4(0.75, 0.72, 0.85, 1), new Color4(0.4, 0.4, 0.55, 0)];
        this.burst("debris", at.add(new Vector3(0, 0.05, 0)), { ...common, count: 26 * sc, tex: "shard", pal, life: [0.55, 0.9], size: [0.05, 0.12], power: [3, 6.5],
          emitter: (ps) => ps.createHemisphericEmitter(0.6 * sc, 0.3), gravity: -11, spin: 8, blend: ParticleSystem.BLENDMODE_STANDARD, colors: rock, priority: "secondary" });
        break;
      }
      case "groundCrack": {
        const g = req("secondary", 0);
        if (!g.allowed) return;
        const f = this.takeMesh("crack", () => ({ mesh: this.plane("fxCrack", true) }));
        this.paint(f.mesh, "crack", pal.main);
        f.mesh.position.copyFrom(at).addInPlaceFromFloats(0, 0.02, 0);
        f.mesh.rotation.y = Math.random() * Math.PI * 2;
        f.baseScale = 2.6 * sc;
        this.startMesh(f, opt.duration ?? 1.4, g.handle, (ff, u) => {
          ff.mesh.scaling.setAll(ff.baseScale * (0.7 + 0.3 * Math.min(1, u * 10)));
          ff.mesh.visibility = (u < 0.05 ? u / 0.05 : u < 0.5 ? 1 : 1 - (u - 0.5) / 0.5) * 0.85;
        });
        break;
      }
      case "dustRing": {
        const dust: [Color4, Color4, Color4] = this.env === "bright"
          ? [new Color4(0.86, 0.8, 0.68, 0.6), new Color4(0.78, 0.72, 0.6, 0.5), new Color4(0.7, 0.65, 0.55, 0)]
          : [new Color4(0.96, 0.92, 0.85, 0.55), new Color4(0.9, 0.86, 0.8, 0.45), new Color4(0.85, 0.8, 0.75, 0)];
        this.burst("dust", at.add(new Vector3(0, 0.08, 0)), { ...common, count: 36 * sc, tex: "smoke", pal, life: [0.45, 0.8], size: [0.25 * sc, 0.5 * sc], power: [2.2 * sc, 3.6 * sc],
          emitter: (ps) => ps.createCylinderEmitter(0.25 * sc, 0.05, 1, 0.15), gravity: 0.4, blend: ParticleSystem.BLENDMODE_STANDARD, sizeEnd: 2.2,
          colors: dust, spin: 1.5, drag: 0.6 });
        break;
      }
      // ---------------------------------------------------------------- 範圍爆破：膨脹球＋閃光＋擴散環＋星光碎片＋餘燼
      case "areaBlast": {
        const g = req("primary", 0);
        if (!g.allowed) return;
        const f = this.takeMesh("blast", () => ({
          mesh: MeshBuilder.CreateSphere("fxBlast", { diameter: 1, segments: 16 }, this.scene),
          layers: [this.plane("fxBlastFlare", false, true)],
        }));
        this.paint(f.mesh, null, pal.main);
        this.paint(f.layers[0]!, "flare", pal.core);
        f.mesh.position.copyFrom(at).addInPlaceFromFloats(0, 0.5 * sc, 0);
        f.baseScale = 3.2 * sc;
        this.startMesh(f, 0.6, g.handle, (ff, u) => {
          const e = 1 - (1 - u) ** 2;
          ff.mesh.scaling.setAll(ff.baseScale * (0.25 + 0.75 * e));
          ff.mesh.visibility = 0.42 * (1 - u) ** 2;
          const fl = ff.layers[0]!;
          fl.position.copyFrom(ff.mesh.position);
          fl.scaling.setAll(ff.baseScale * 1.4 * (0.5 + 0.8 * Math.sqrt(u)));
          fl.visibility = 0.55 * Math.max(0, 1 - u * 2.4);
        });
        this.spawn("hitRing", at.add(new Vector3(0, 0.6 * sc, 0)), { ...opt, scale: 2.4 * sc });
        this.burst("blastStars", at.add(new Vector3(0, 0.6 * sc, 0)), { ...common, count: 90, tex: "star", pal, life: [0.5, 0.95], size: [0.08, 0.2], power: [3, 7],
          emitter: (ps) => ps.createSphereEmitter(0.4, 1), gravity: -6, spin: 4, sizeEnd: 0.3, drag: 0.4 });
        if (!lite) this.spawn("starShards", at.add(new Vector3(0, 0.5 * sc, 0)), { ...opt, scale: 1.2 * sc });
        this.burst("blastEmber", at.add(new Vector3(0, 0.4, 0)), { ...common, count: 60, tex: "dot", pal, life: [0.6, 1.2], size: [0.04, 0.08], power: [1, 3.5],
          emitter: (ps) => ps.createHemisphericEmitter(1.2 * sc, 1), gravity: 1.5, priority: "secondary" });
        break;
      }
      case "starBurst": {
        this.burst("starBurst", at, { ...common, count: 40 * sc, tex: "star", pal, life: [0.35, 0.7], size: [0.08, 0.18], power: [2.5, 5.5],
          emitter: (ps) => ps.createSphereEmitter(0.2, 1), gravity: -3, spin: 5, sizeEnd: 0.2, drag: 0.3 });
        break;
      }
      case "starShards": {
        this.burst("shards", at, { ...common, count: 22 * sc, tex: "shard", pal, life: [0.45, 0.85], size: [0.06, 0.15], power: [3, 6.5],
          emitter: (ps) => ps.createSphereEmitter(0.15, 1), gravity: -7, spin: 9, sizeEnd: 0.4, priority: "secondary", drag: 0.2 });
        break;
      }
      case "hitSpark": {
        this.burst("hitSpark", at, { ...common, count: 26, tex: "spark", pal, life: [0.12, 0.25], size: [0.06, 0.15], power: [4.5, 10],
          emitter: (ps) => ps.createSphereEmitter(0.1, 1), stretched: true, gravity: -4, priority: "critical", drag: 0.35 });
        break;
      }
      case "hitRing": {
        const g = req("secondary", 0);
        if (!g.allowed) return;
        const f = this.takeMesh("hring", () => ({ mesh: this.plane("fxHitRing", false, true) }));
        this.paint(f.mesh, "ringThin", pal.core);
        f.mesh.position.copyFrom(at);
        f.baseScale = 1.2 * sc;
        this.startMesh(f, 0.2, g.handle, (ff, u) => {
          ff.mesh.scaling.setAll(ff.baseScale * (0.3 + 1.0 * (1 - (1 - u) ** 2)));
          ff.mesh.visibility = 1 - u;
        });
        break;
      }
      // ---------------------------------------------------------------- 命中閃光（＋暴擊）
      case "hitFlash":
      case "critBurst":
      case "boltImpact": {
        const g = req("critical", 0);
        if (!g.allowed) return;
        const crit = key === "critBurst";
        const f = this.takeMesh("flash", () => ({ mesh: this.plane("fxFlash", false, true) }));
        this.paint(f.mesh, "flare", crit ? PALETTES.gold.core : key === "boltImpact" ? pal.main : pal.core);
        f.mesh.position.copyFrom(at);
        f.mesh.rotation.z = Math.random() * Math.PI;
        f.baseScale = (crit ? 1.7 : key === "boltImpact" ? 1.4 : 1.1) * sc;
        this.startMesh(f, crit ? 0.24 : 0.15, g.handle, (ff, u) => {
          ff.mesh.scaling.setAll(ff.baseScale * (0.35 + 0.8 * Math.sqrt(u)));
          ff.mesh.visibility = 1 - u * u;
        });
        if (!lite) this.spawn("hitRing", at, { ...opt, palette: crit ? "gold" : opt.palette, scale: crit ? 2 : key === "boltImpact" ? 1.5 : 1 });
        if (crit) {
          this.burst("critStars", at, { ...common, count: 40, tex: "star", pal: PALETTES.gold, life: [0.4, 0.8], size: [0.1, 0.24], power: [3, 7],
            emitter: (ps) => ps.createSphereEmitter(0.2, 1), gravity: -2, spin: 6, priority: "critical", drag: 0.3 });
          if (!lite) this.spawn("starShards", at, { ...opt, palette: "gold", scale: 1.2 });
          this.spawn("shockwave", at.subtract(new Vector3(0, at.y, 0)), { ...opt, palette: "gold", scale: 0.45 });
          if (owner === "self") this.onCrit?.(at);
        }
        if (key === "boltImpact") this.spawn("starBurst", at, { ...opt, scale: 0.8 });
        break;
      }
      // ---------------------------------------------------------------- 六職業預留：騎士
      case "lightShield": {
        const g = req("primary", 0);
        if (!g.allowed) return;
        // 光盾：面向鏡頭的六角紋圓盾（球體在加算混合下會整顆發白）
        const f = this.takeMesh("shield", () => ({ mesh: this.plane("fxShield", false, true), layers: [this.plane("fxShieldRim", false, true)] }));
        this.paint(f.mesh, "hex", pal.main);
        this.paint(f.layers[0]!, "ringThin", pal.core);
        f.follow = opt.follow;
        f.offset.set(0, 0.62, 0);
        f.mesh.position.copyFrom(at).addInPlaceFromFloats(0, 0.62, 0);
        f.baseScale = 1.7 * sc;
        this.startMesh(f, opt.duration ?? 1.6, g.handle, (ff, u) => {
          const pop = u < 0.12 ? 1 + 0.18 * Math.sin((u / 0.12) * Math.PI) : 1;
          const k = Math.min(1, u / 0.08);
          ff.mesh.scaling.setAll(ff.baseScale * 1.25 * k * pop);
          ff.mesh.visibility = (0.38 + 0.1 * Math.sin(u * 25)) * Math.min(1, (1 - u) * 5);
          const rim = ff.layers[0]!;
          rim.position.copyFrom(ff.mesh.position);
          rim.scaling.setAll(ff.baseScale * 1.3 * k * pop);
          rim.visibility = 0.7 * Math.min(1, (1 - u) * 5);
        });
        this.spawn("hitRing", at.add(new Vector3(0, 0.6, 0)), { ...opt, scale: 1.8 * sc });
        break;
      }
      case "shieldBash": {
        const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const p = at.add(fwd.scale(0.6)).addInPlaceFromFloats(0, 0.6, 0);
        this.spawn("hitFlash", p, { ...opt, scale: 0.9 * sc });
        this.spawn("hitRing", p, { ...opt, scale: 1.4 * sc });
        this.spawn("shockwave", new Vector3(p.x, 0, p.z), { ...opt, scale: 0.6 * sc });
        this.burst("bashSpark", p, { ...common, count: 30, tex: "spark", pal, life: [0.12, 0.25], size: [0.06, 0.14], power: [4, 8],
          emitter: (ps) => ps.createDirectedSphereEmitter(0.2, fwd.add(new Vector3(-0.5, -0.2, -0.5)), fwd.add(new Vector3(0.5, 0.5, 0.5))), stretched: true, priority: "primary" });
        break;
      }
      case "thrustLine": {
        const g = req("primary", 0);
        if (!g.allowed) return;
        const f = this.takeMesh("thrust", () => ({ mesh: this.plane("fxThrust", false), layers: [this.plane("fxThrustCore", false)] }));
        this.paint(f.mesh, "spark", pal.main);
        this.paint(f.layers[0]!, "spark", pal.core);
        f.layers[0]!.setEnabled(!lite);
        const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        for (const m of [f.mesh, ...f.layers]) {
          m.rotation.set(Math.PI / 2, yaw + Math.PI / 2, 0);
          m.position.copyFrom(at).addInPlace(fwd.scale(1.1 * sc)).addInPlaceFromFloats(0, 0.65, 0);
        }
        f.baseScale = sc;
        this.startMesh(f, 0.24, g.handle, (ff, u) => {
          const ext = 1 - (1 - Math.min(1, u / 0.3)) ** 3;
          ff.mesh.scaling.set(2.6 * ff.baseScale * ext, 0.42 * ff.baseScale * (1 - 0.6 * u), 1);
          ff.mesh.visibility = 1 - u;
          ff.layers[0]!.scaling.set(2.8 * ff.baseScale * ext, 0.14 * ff.baseScale, 1);
          ff.layers[0]!.visibility = Math.max(0, 1 - u * 1.6);
        });
        this.burst("thrustTip", at.add(fwd.scale(2.3 * sc)).addInPlaceFromFloats(0, 0.65, 0), { ...common, count: 18, tex: "spark", pal, life: [0.1, 0.22], size: [0.05, 0.12], power: [3, 6],
          emitter: (ps) => ps.createSphereEmitter(0.1, 1), stretched: true, priority: "secondary" });
        break;
      }
      // ---------------------------------------------------------------- 鐵匠
      case "forgeSparks": {
        const hot: [Color4, Color4, Color4] = [new Color4(1, 0.95, 0.6, 1), new Color4(1, 0.55, 0.1, 1), new Color4(0.8, 0.2, 0.0, 0)];
        this.burst("forge", at, { ...common, count: 60 * sc, tex: "spark", pal, life: [0.3, 0.7], size: [0.04, 0.09], power: [4, 9],
          emitter: (ps) => ps.createHemisphericEmitter(0.25, 0.2), gravity: -12, stretched: true, colors: hot, keepAdd: true, priority: "primary" });
        this.burst("forgeEmber", at.add(new Vector3(0, 0.1, 0)), { ...common, count: 24, tex: "dot", pal, life: [0.6, 1.2], size: [0.03, 0.06], power: [0.5, 2],
          emitter: (ps) => ps.createHemisphericEmitter(0.5, 1), gravity: 1.2, colors: hot, keepAdd: true, priority: "secondary" });
        break;
      }
      // ---------------------------------------------------------------- 祭司
      case "healAura": {
        const g = req("primary", 0);
        if (!g.allowed) return;
        const f = this.takeMesh("heal", () => ({ mesh: this.plane("fxHeal", true), layers: [this.plane("fxHealIn", true)] }));
        this.paint(f.mesh, "ringThin", pal.main);
        this.paint(f.layers[0]!, "glowDisc", pal.main);
        f.follow = opt.follow;
        f.offset.set(0, 0.04, 0);
        f.mesh.position.copyFrom(at).addInPlaceFromFloats(0, 0.04, 0);
        f.baseScale = 2.0 * sc;
        this.startMesh(f, opt.duration ?? 1.3, g.handle, (ff, u) => {
          ff.mesh.scaling.setAll(ff.baseScale * (0.7 + 0.3 * Math.sin(u * Math.PI)));
          ff.mesh.visibility = Math.sin(u * Math.PI) * 0.9;
          const d = ff.layers[0]!;
          d.position.copyFrom(ff.mesh.position);
          d.scaling.setAll(ff.baseScale * 0.9);
          d.visibility = Math.sin(u * Math.PI) * 0.45;
        });
        this.burst("healUp", at.add(new Vector3(0, 0.1, 0)), { ...common, count: 60, tex: "star", pal, life: [0.7, 1.2], size: [0.05, 0.12], power: [0.6, 1.4],
          emitter: (ps) => ps.createCylinderEmitter(0.6 * sc, 0.05, 0.3, 0), gravity: 1.6, rate: 55, duration: (opt.duration ?? 1.3) * 0.8, spin: 2 });
        break;
      }
      case "buffOrbit": {
        const g = req("secondary", 0);
        if (!g.allowed) return;
        const f = this.takeMesh("orbit", () => ({ mesh: this.plane("fxOrbit0", false, true), layers: [this.plane("fxOrbit1", false, true), this.plane("fxOrbit2", false, true)] }));
        for (const m of [f.mesh, ...f.layers]) this.paint(m, "flare", pal.main);
        f.follow = opt.follow;
        f.offset.set(0, 0.6, 0);
        f.mesh.position.copyFrom(at);
        this.startMesh(f, opt.duration ?? 2.0, g.handle, (ff, u, dt) => {
          ff.spin += dt * 4;
          const c = ff.follow ? ff.follow.getAbsolutePosition() : at;
          const env = Math.min(1, u * 6) * Math.min(1, (1 - u) * 6);
          [ff.mesh, ...ff.layers].forEach((m, i) => {
            const a = ff.spin + (i * Math.PI * 2) / 3;
            m.position.set(c.x + Math.cos(a) * 0.6, c.y + 0.6 + 0.25 * Math.sin(a * 1.5), c.z + Math.sin(a) * 0.6);
            m.scaling.setAll(0.35);
            m.visibility = env;
          });
        });
        break;
      }
      // ---------------------------------------------------------------- 小丑
      case "propBurst": {
        const cols: [Color4, Color4, Color4] = [new Color4(1, 0.35, 0.55, 1), new Color4(0.35, 0.8, 1, 1), new Color4(1, 0.9, 0.3, 0)];
        this.burst("confetti", at, { ...common, count: 50 * sc, tex: "confetti", pal, life: [0.6, 1.1], size: [0.06, 0.12], power: [3, 6.5],
          emitter: (ps) => ps.createSphereEmitter(0.2, 1), gravity: -5, spin: 10, blend: ParticleSystem.BLENDMODE_STANDARD, colors: cols, drag: 0.5 });
        this.spawn("hitFlash", at, { ...opt, palette: "gold", scale: 1.2 * sc });
        this.spawn("starBurst", at, { ...opt, palette: "rose", scale: 0.8 * sc });
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
      if (k === "areaBlast" || k === "shockwave" || k === "dustRing" || k === "groundCrack" || k === "debris") this.spawn(k, new Vector3(at.x, 0, at.z), opt);
      else this.spawn(k, at, opt);
    }
    if (crit) this.spawn("critBurst", at, opt);
  }

  // ------------------------------------------------------------------ 投射物（核心＋第二層＋緞帶尾跡＋粒子尾巴）

  launch(kind: "magicBolt" | "swordWave" | "meteor", from: Vector3, dir: Vector3, speed: number, opt: SpawnOptions = {}): Projectile | null {
    const owner = opt.owner ?? "self";
    const g = this.budget.request({ owner, priority: "primary", particles: 40, distance: opt.distance, essential: opt.essential });
    if (!g.allowed) return null;
    const lite = (owner !== "self" && this.remoteSimplify) || !this.q.secondary;
    const pal = PALETTES[opt.palette ?? (kind === "magicBolt" ? "azure" : kind === "meteor" ? "star" : "azure")];
    const sc = opt.scale ?? 1;
    let core: Mesh;
    let halo: Mesh | null = null;
    if (kind === "swordWave") {
      core = this.plane("fxWave", false);
      this.paint(core, "crescent", pal.main);
      core.scaling.setAll(2.0 * sc);
      core.rotation.set(Math.PI / 2 - 0.15, Math.atan2(dir.x, dir.z), 0);
      if (!lite) {
        halo = this.plane("fxWaveCore", false);
        this.paint(halo, "crescent", pal.core);
        halo.rotation.copyFrom(core.rotation);
      }
    } else {
      core = this.plane(kind === "meteor" ? "fxMeteor" : "fxBolt", false, true);
      this.paint(core, "flare", pal.core);
      core.scaling.setAll((kind === "meteor" ? 1.5 : 0.75) * sc);
      if (!lite) {
        halo = this.plane("fxBoltHalo", false, true);
        this.paint(halo, "star", pal.main);
      }
    }
    for (const m of [core, halo]) {
      if (!m) continue;
      m.isPickable = false;
      this.glow?.addIncludedOnlyMesh(m);
      m.position.copyFrom(from);
    }
    // 緞帶尾跡（只有自己的投射物；其他玩家省略）
    let ribbon: TrailMesh | null = null;
    if (!lite && kind !== "swordWave") {
      ribbon = new TrailMesh(`fxRibbon_${kind}`, core, this.scene, kind === "meteor" ? 0.55 * sc : 0.22 * sc, kind === "meteor" ? 40 : 26, true);
      this.paint(ribbon, "streak", pal.main);
      ribbon.isPickable = false;
      this.glow?.addIncludedOnlyMesh(ribbon);
    }
    // 粒子尾巴
    const tg = this.budget.request({ owner, priority: "primary", particles: 60, distance: opt.distance });
    let trail: PsFx | null = null;
    if (tg.allowed) {
      const n = particleCount(kind === "meteor" ? 160 : 90, this.q, tg.scale * (lite ? 0.5 : 1));
      trail = this.takePs(`trail_${kind}`, n);
      const ps = trail.ps;
      ps.particleTexture = fxTexture(this.scene, kind === "swordWave" ? "spark" : "star", this.q.textureSize);
      ps.emitter = core;
      ps.createSphereEmitter(kind === "swordWave" ? 0.5 : 0.12, 1);
      const bright = this.env === "bright";
      ps.color1 = bright ? deepen4(pal.p1) : pal.p1.clone();
      ps.color2 = bright ? deepen4(pal.p2) : pal.p2.clone();
      ps.colorDead = bright ? deepen4(pal.pDead) : pal.pDead.clone();
      ps.minLifeTime = 0.18;
      ps.maxLifeTime = kind === "meteor" ? 0.55 : 0.35;
      ps.minSize = 0.05;
      ps.maxSize = kind === "meteor" ? 0.3 : 0.15;
      ps.minEmitPower = 0.1;
      ps.maxEmitPower = 0.6;
      ps.gravity = Vector3.Zero();
      ps.blendMode = bright ? ParticleSystem.BLENDMODE_STANDARD : ParticleSystem.BLENDMODE_ADD;
      ps.billboardMode = kind === "swordWave" ? ParticleSystem.BILLBOARDMODE_STRETCHED : ParticleSystem.BILLBOARDMODE_ALL;
      ps.minAngularSpeed = -3;
      ps.maxAngularSpeed = 3;
      ps.manualEmitCount = -1;
      ps.emitRate = (kind === "meteor" ? 260 : 160) * this.q.particleScale * tg.scale * (lite ? 0.5 : 1);
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
      pos: core.position,
      alive: true,
      travelled: 0,
      step(dt: number) {
        life += dt;
        core.position.addInPlace(v.scale(dt));
        p.travelled += speed * dt;
        if (kind === "swordWave") {
          core.visibility = Math.min(1, life * 10) * 0.95;
          core.scaling.setAll(2.0 * sc * (1 + life * 0.6));
          if (halo) {
            halo.position.copyFrom(core.position);
            halo.scaling.setAll(1.7 * sc * (1 + life * 0.6));
            halo.visibility = Math.min(1, life * 10);
          }
        } else {
          const k = (kind === "meteor" ? 1.5 : 0.75) * sc;
          core.scaling.setAll(k * (1 + 0.15 * Math.sin(life * 40)));
          if (halo) {
            halo.position.copyFrom(core.position);
            halo.rotation.z = life * 9;
            halo.scaling.setAll(k * 1.5 * (1 + 0.1 * Math.sin(life * 25)));
          }
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
        // 材質是共用的，只釋放網格
        core.dispose(false, false);
        halo?.dispose(false, false);
        if (ribbon) {
          ribbon.stop();
          const rb = ribbon;
          setTimeout(() => rb.dispose(false, false), 250);
        }
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
      f.tick(f, u, dt);
      this.floor(f);
      if (u >= 1) {
        f.mesh.setEnabled(false);
        for (const l of f.layers) l.setEnabled(false);
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

  /** 除錯：目前作用中的網格特效狀態（E2E 用） */
  debugActive(): { key: string; enabled: boolean; pos: number[]; scale: number; vis: number; layers: number }[] {
    return this.active.map((f) => ({
      key: f.key,
      enabled: f.mesh.isEnabled(),
      pos: [f.mesh.position.x, f.mesh.position.y, f.mesh.position.z].map((v) => Math.round(v * 100) / 100),
      scale: Math.round(f.mesh.scaling.x * 100) / 100,
      vis: Math.round(f.mesh.visibility * 1000) / 1000,
      layers: f.layers.filter((l) => l.isEnabled()).length,
    }));
  }

  /**
   * 預熱（Stage 3.1，改善 1% Low）：載入時把每種特效、投射物都先生成一次並等 shader 編譯完，再收回物件池。
   * 第一次施放某個技能時就不會因為建立網格／粒子系統、編譯 shader 而卡一下。
   * 一次只放幾個（不受同時特效上限影響），每批畫 1 格就清掉；全部約 5 格。
   */
  async prewarm(at: Vector3, keys: readonly FxKey[], palettes: readonly Palette[] = ["steel"]): Promise<{ ms: number; spawned: number; timeouts: number; materials: number; meshes: number; systems: number }> {
    const t0 = performance.now();
    const projectile = new Set<FxKey>(["magicBolt", "swordWave", "meteor"]);
    const jobs: (() => void)[] = [];
    for (const palette of palettes) {
      for (const key of keys) {
        if (projectile.has(key)) {
          jobs.push(() => {
            const p = this.launch(key as "magicBolt" | "swordWave" | "meteor", at.add(new Vector3(0, 1, 0)), new Vector3(0, 0, 1), 0.01, { palette });
            void p;
          });
        } else {
          jobs.push(() => this.spawn(key, at, { palette, duration: 1 }));
          jobs.push(() => this.spawn(key, at, { palette, duration: 1, owner: "other", distance: 6 }));
        }
      }
      jobs.push(() => this.hitFx(at, ["hitFlash", "hitSpark"], true, { palette }));
    }
    let spawned = 0;
    const timeouts = 0;
    this.prewarmCancelled = false;
    // 每批 16 個：生成 → 畫 1 格（觸發 shader 編譯與 GPU 上傳）→ 收回物件池。不等 whenReady（場景其他物件可能一直未就緒）
    for (let i = 0; i < jobs.length && !this.prewarmCancelled; i += 16) {
      for (const j of jobs.slice(i, i + 16)) {
        j();
        spawned++;
      }
      this.scene.render();
      this.clear();
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    this.budget.resetStats();
    return { ms: Math.round(performance.now() - t0), spawned, timeouts, materials: this.mats.size, meshes: this.stats.pooledMeshes, systems: this.stats.pooledSystems };
  }

  private prewarmCancelled = false;
  /** 預熱超時時由呼叫端中止 */
  cancelPrewarm(): void {
    this.prewarmCancelled = true;
  }

  /** 全部清除（換場景、測試用） */
  clear(): void {
    for (const p of [...this.projectiles]) p.dispose(false);
    for (const f of this.active) {
      f.mesh.setEnabled(false);
      for (const l of f.layers) l.setEnabled(false);
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
      f.mesh.dispose(false, false);
      for (const m of f.layers) m.dispose(false, false);
    }
    // 粒子貼圖是共用快取（textures.ts），不能跟著粒子系統一起刪（第二次進地圖會拿到已刪除的貼圖）
    for (const l of this.psPool.values()) for (const f of l) f.ps.dispose(false);
    for (const { mat } of this.mats.values()) mat.dispose(false, false);
    this.mats.clear();
    this.meshPool.clear();
    this.psPool.clear();
    this.glow?.dispose();
    this.glow = null;
  }
}
