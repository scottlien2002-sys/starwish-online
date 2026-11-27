/**
 * 原生骨骼動畫怪物的 Babylon 視覺（Stage 7.2，所有骨骼動畫怪物共用）。
 *
 * - 每種怪物、每種畫質只載入一次（AssetContainer）；每隻怪物用 instantiateModelsToScene 複製
 *   → 每隻有自己的骨架與 AnimationGroup，播放互相獨立；幾何與貼圖共用（蒙皮網格不能用 instance）。
 * - 材質每隻複製一份（受擊閃白、淡出不會影響其他隻；每隻仍是 1 個網格、1 個材質）。
 * - 動畫切換：淡入淡出（權重）；Move／Run 依地面速度選擇與調整播放倍率（Run 是獨立動畫，不用 Move 加速）。
 * - Death：播完停在最後一格（不 reset、不接 Idle）；淡出與隱藏依狀態機的姿勢。
 * - Respawn：播完回 Idle（狀態機切到 idle 時自動切換）。
 * - 普通攻擊受擊（已定案規則：不硬直、不打斷）：只有站著不動時才播 Hurt，移動與攻擊中只閃白。
 */
import "@babylonjs/loaders/glTF";
import {
  type AbstractMesh,
  type AnimationGroup,
  type AssetContainer,
  Color3,
  type Material,
  Mesh,
  MeshBuilder,
  type Scene,
  SceneLoader,
  type ShadowGenerator,
  type Skeleton,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import { GLTFFileLoader, GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF";
import type { MonsterEffect, MonsterFace, MonsterPose, MonsterState } from "../anim/types.ts";
import type { IMonsterVisual } from "../framework/types.ts";
import { applyExtras, chooseLocomotion, CrossFader, RIG_CLIP_KEYS, RIG_LOOPING, type RigClipKey, type RigExtras, type RigLod, type RiggedMonsterSpec } from "./riggedSpec.ts";

// ---------------------------------------------------------------- 資產（每種怪物每種畫質一份）

export interface RiggedAssetCheck {
  file: string;
  ok: boolean;
  joints: number;
  skeletons: number;
  skinnedMeshes: number;
  clips: Record<string, number | null>;
  extras: boolean;
  fixture: boolean;
  notes: string[];
  errors: string[];
  loadMs: number;
}

export interface RiggedAsset {
  readonly spec: RiggedMonsterSpec;
  readonly lod: RigLod;
  readonly container: AssetContainer;
  readonly check: RiggedAssetCheck;
  readonly durations: Record<RigClipKey, number>;
  dispose(): void;
}

const cache = new Map<string, Promise<RiggedAsset>>();

function findExtras(container: AssetContainer): RigExtras | null {
  for (const n of [...container.transformNodes, ...container.meshes]) {
    const m = (n.metadata as { gltf?: { extras?: { monster?: RigExtras } } } | null)?.gltf?.extras?.monster;
    if (m) return m;
  }
  return null;
}

let manifest: Promise<Set<string>> | null = null;

/**
 * 檔案是否已交付：讀 models/monsters/manifest.json（不用 HEAD 探測，尚未交付時不會出現 404 錯誤）。
 * 新增怪物 GLB 時把路徑加進清單；單元測試會檢查清單與實際檔案一致。
 */
export async function riggedAssetAvailable(baseUrl: string, spec: RiggedMonsterSpec, lod: RigLod): Promise<boolean> {
  manifest ??= fetch(`${baseUrl}models/monsters/manifest.json`, { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ files?: string[] }>) : { files: [] }))
    .then((j) => new Set(j.files ?? []))
    .catch(() => new Set<string>());
  return (await manifest).has(spec.files[lod]);
}

export function loadRiggedAsset(scene: Scene, baseUrl: string, spec: RiggedMonsterSpec, lod: RigLod): Promise<RiggedAsset> {
  const key = `${scene.uid}|${spec.modelId}|${lod}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const t0 = performance.now();
      const file = spec.files[lod];
      const slash = file.lastIndexOf("/");
      // 載入時不要自動播放第一個動畫
      const obs = SceneLoader.OnPluginActivatedObservable.add((plugin) => {
        if (plugin instanceof GLTFFileLoader) plugin.animationStartMode = GLTFLoaderAnimationStartMode.NONE;
      });
      let container: AssetContainer;
      try {
        container = await SceneLoader.LoadAssetContainerAsync(`${baseUrl}models/${file.slice(0, slash + 1)}`, file.slice(slash + 1), scene);
      } finally {
        SceneLoader.OnPluginActivatedObservable.remove(obs);
      }
      for (const g of container.animationGroups) g.stop();
      const errors: string[] = [];
      const skins = container.skeletons;
      const joints = skins[0]?.bones.length ?? 0;
      if (skins.length !== 1) errors.push(`骨架數 ${skins.length}（應為 1）`);
      if (joints !== spec.expect.joints) errors.push(`關節數 ${joints}（應為 ${spec.expect.joints}）`);
      const durations = { ...spec.expect.durations };
      const clips: Record<string, number | null> = {};
      for (const k of RIG_CLIP_KEYS) {
        const g = container.animationGroups.find((x) => x.name === spec.clips[k]);
        if (!g) {
          clips[spec.clips[k]] = null;
          errors.push(`缺少動畫 ${spec.clips[k]}`);
          continue;
        }
        const fps = g.targetedAnimations[0]?.animation.framePerSecond ?? 60;
        const d = (g.to - g.from) / fps;
        clips[spec.clips[k]] = Math.round(d * 1000) / 1000;
        if (Math.abs(d - spec.expect.durations[k]) > 0.02) errors.push(`${spec.clips[k]} 時長 ${d.toFixed(3)} 秒（應為 ${spec.expect.durations[k]}）`);
        durations[k] = d;
      }
      const extras = findExtras(container);
      const { notes } = applyExtras(spec, extras);
      const skinned = container.meshes.filter((m) => !!m.skeleton && m.getTotalVertices() > 0).length;
      const check: RiggedAssetCheck = {
        file,
        ok: errors.length === 0,
        joints,
        skeletons: skins.length,
        skinnedMeshes: skinned,
        clips,
        extras: !!extras,
        fixture: extras?.fixture === true || spec.fixture === true,
        notes,
        errors,
        loadMs: Math.round(performance.now() - t0),
      };
      return {
        spec: applyExtras(spec, extras).spec,
        lod,
        container,
        check,
        durations,
        dispose() {
          container.dispose();
          cache.delete(key);
        },
      };
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

// ---------------------------------------------------------------- 每隻怪物

export interface RiggedVisualOptions {
  scene: Scene;
  baseUrl: string;
  spec: RiggedMonsterSpec;
  lod: RigLod;
  shadows?: ShadowGenerator;
  /** 顯示血條（預設 true） */
  hpBar?: boolean;
}

let seq = 0;

/** 血條材質：全場共用兩個（Stage 7.4：原本每隻 2 個，21 隻＝42 個材質） */
const barMats = new WeakMap<Scene, { bg: StandardMaterial; fill: StandardMaterial }>();
function sharedBarMaterials(s: Scene): { bg: StandardMaterial; fill: StandardMaterial } {
  let m = barMats.get(s);
  if (!m) {
    const mk = (name: string, c: Color3): StandardMaterial => {
      const mat = new StandardMaterial(name, s);
      mat.disableLighting = true;
      mat.emissiveColor = c;
      mat.backFaceCulling = false;
      mat.freeze();
      return mat;
    };
    m = { bg: mk("hpbar_bg_shared", new Color3(0.12, 0.1, 0.18)), fill: mk("hpbar_fill_shared", new Color3(0.95, 0.32, 0.38)) };
    barMats.set(s, m);
  }
  return m;
}

/**
 * 動畫更新方式（Stage 7.4 距離分級）：
 * - "auto"：Babylon 每幀驅動（近距離，完整品質）
 * - "manual"：AnimationGroup 暫停，由 update() 依自己的時鐘跳到正確的格（中、遠距離：呼叫頻率由 MonsterController 的 stride 決定）
 * 兩種方式的播放時間都用同一個時鐘，切換時不會跳格或變速。
 */
export type RigAnimMode = "auto" | "manual";
const BAR_BG = new Color3(0.12, 0.1, 0.18);
const BAR_FILL = new Color3(0.95, 0.32, 0.38);

export class RiggedMonsterVisual implements IMonsterVisual {
  readonly kind = "gltf" as const;
  readonly opts: RiggedVisualOptions;
  spec: RiggedMonsterSpec;
  readonly root: TransformNode;
  asset: RiggedAsset | null = null;
  skeleton: Skeleton | null = null;
  meshes: AbstractMesh[] = [];
  private materials: Material[] = [];
  private readonly groups = new Map<RigClipKey, AnimationGroup>();
  private readonly fader = new CrossFader();
  private state: MonsterState = "idle";
  private loco: "idle" | "move" | "run" = "idle";
  private speed = 0;
  /** 目前播放的片段與倍率（測試用） */
  clip: RigClipKey = "idle";
  ratio = 1;
  private hurtT = 0;
  private lastFlash = -1;
  private lastOpacity = -1;
  private lastVisible: boolean | null = null;
  private hp = 1;
  private maxHp = 1;
  private bar: { root: TransformNode; fill: Mesh } | null = null;
  readonly id = ++seq;
  /** Stage 7.4：動畫更新方式與每個片段自己的播放秒數 */
  animMode: RigAnimMode = "auto";
  private readonly clipTime = new Map<RigClipKey, number>();
  private castShadow = true;
  /** 測試用：手動跳格次數 */
  manualSteps = 0;

  constructor(opts: RiggedVisualOptions) {
    this.opts = opts;
    this.spec = opts.spec;
    this.root = new TransformNode(`rigged_${opts.spec.modelId}_${this.id}`, opts.scene);
  }

  async load(): Promise<void> {
    const a = await loadRiggedAsset(this.opts.scene, this.opts.baseUrl, this.opts.spec, this.opts.lod);
    this.asset = a;
    this.spec = a.spec;
    const id = this.id;
    const inst = a.container.instantiateModelsToScene((n) => `${n}#${id}`, false, { doNotInstantiate: true });
    for (const r of inst.rootNodes) r.parent = this.root;
    this.skeleton = inst.skeletons[0] ?? null;
    this.meshes = this.root.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0);
    // 每隻自己的材質（閃白、淡出互不影響）
    const cloned = new Map<Material, Material>();
    for (const m of this.meshes) {
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = false;
      if (m.material) {
        let c = cloned.get(m.material);
        if (!c) {
          c = m.material.clone(`${m.material.name}#${id}`) ?? m.material;
          cloned.set(m.material, c);
        }
        m.material = c;
      }
      this.opts.shadows?.addShadowCaster(m, false);
    }
    this.castShadow = !!this.opts.shadows;
    this.materials = [...cloned.values()];
    // 動畫群組：instantiateModelsToScene 依原本順序複製
    a.container.animationGroups.forEach((src, i) => {
      const g = inst.animationGroups[i];
      if (!g) return;
      const k = RIG_CLIP_KEYS.find((kk) => this.spec.clips[kk] === src.name);
      if (!k) {
        g.stop();
        return;
      }
      g.stop();
      g.loopAnimation = RIG_LOOPING.has(k);
      this.groups.set(k, g);
    });
    if (this.opts.hpBar !== false) this.bar = this.makeBar();
    this.play("idle", 0);
  }

  /** 這隻的 AnimationGroup（測試用：確認每隻是不同物件） */
  group(k: RigClipKey): AnimationGroup | undefined {
    return this.groups.get(k);
  }

  private play(k: RigClipKey, fade: number, ratio = 1): void {
    const g = this.groups.get(k);
    if (!g) return;
    const loop = RIG_LOOPING.has(k);
    if (this.clip === k && g.isStarted && loop) {
      g.speedRatio = ratio;
      this.ratio = ratio;
      return;
    }
    // Death：之後不再淡回其他動畫；重播同一個一次性動畫要從頭開始
    g.stop();
    g.reset();
    g.start(loop, ratio, g.from, g.to, false);
    // 只有一個片段時用 -1（不混合；Babylon 不走權重混合的較慢路徑）
    g.weight = fade > 0 ? 0 : -1;
    if (this.animMode === "manual") g.pause();
    this.clipTime.set(k, 0);
    this.clip = k;
    this.ratio = ratio;
    this.fader.play(k, fade);
    if (fade <= 0) for (const [kk, gg] of this.groups) if (kk !== k) gg.stop();
  }

  setTransform(x: number, y: number, z: number, yaw: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
  }

  setGroundSpeed(mps: number): void {
    this.speed = mps;
  }

  setHealth(hp: number, maxHp: number): void {
    this.hp = hp;
    this.maxHp = maxHp;
  }

  onStateEnter(state: MonsterState): void {
    this.state = state;
    const f = this.spec.fades;
    switch (state) {
      case "idle":
      case "move":
        this.loco = "idle";
        this.updateLocomotion(true);
        break;
      case "attack":
        this.play("attack", f.normal, 1);
        break;
      case "hit":
        this.play("hurt", f.urgent, 1);
        this.hurtT = 0;
        break;
      case "death":
        this.play("death", f.urgent, 1);
        break;
      case "dead":
        break; // 停在死亡最後一格
      case "respawn":
        this.play("respawn", 0, 1);
        break;
    }
  }

  onHitReaction(r: { stagger: number; recoil: number; immune: boolean; kind?: "normal" | "control" }): void {
    // 普通攻擊：站著不動才播 Hurt（移動、攻擊中只閃白）
    if (r.stagger > 0) return; // 硬直由 onStateEnter("hit") 處理
    if ((this.state === "idle" || this.state === "move") && this.loco === "idle" && this.clip !== "attack") {
      this.play("hurt", this.spec.fades.urgent, 1);
      this.hurtT = this.asset?.durations.hurt ?? this.spec.expect.durations.hurt;
    }
  }

  private updateLocomotion(force = false): void {
    if (this.state !== "idle" && this.state !== "move") return;
    if (this.hurtT > 0) return; // 站立受擊動作播完再回移動
    const c = chooseLocomotion(this.state === "idle" ? 0 : this.speed, this.spec.locomotion, this.loco);
    const changed = c.clip !== this.loco || force;
    this.loco = c.clip;
    if (changed) this.play(c.clip, this.clip === "move" || this.clip === "run" ? this.spec.fades.locomotion : this.spec.fades.normal, c.ratio);
    else if (c.clip !== "idle") {
      const g = this.groups.get(c.clip);
      if (g) g.speedRatio = c.ratio;
      this.ratio = c.ratio;
    }
  }

  applyPose(pose: MonsterPose): void {
    if (pose.bodyVisible !== this.lastVisible) {
      this.root.setEnabled(pose.bodyVisible);
      this.lastVisible = pose.bodyVisible;
    }
    if (Math.abs(pose.opacity - this.lastOpacity) > 0.005) {
      for (const m of this.meshes) m.visibility = pose.opacity;
      this.lastOpacity = pose.opacity;
    }
    if (Math.abs(pose.hitFlash - this.lastFlash) > 0.005) {
      const f = pose.hitFlash * 0.55;
      for (const mat of this.materials) {
        const e = mat as Material & { emissiveColor?: Color3 };
        if (e.emissiveColor) e.emissiveColor.set(f, f, f);
      }
      this.lastFlash = pose.hitFlash;
    }
  }

  setFace(_face: MonsterFace): void {
    /* 這批骨骼動畫怪物沒有表情貼圖 */
  }

  playEffect(_effect: MonsterEffect): void {
    /* 命中由遊戲結算；特效之後由各怪物的特效設定加上 */
  }

  update(dt: number): void {
    if (this.hurtT > 0) {
      this.hurtT -= dt;
      if (this.hurtT <= 0) {
        this.hurtT = 0;
        this.updateLocomotion(true);
      }
    } else this.updateLocomotion(false);
    const w = this.fader.update(dt);
    const blending = w.size > 1;
    for (const [k, g] of this.groups) {
      const wk = w.get(k) ?? 0;
      if (wk <= 0) {
        if (g.isStarted && k !== this.clip) g.stop();
        continue;
      }
      if (!g.isStarted) continue;
      g.weight = blending ? wk : -1;
      // 自己的時鐘（自動、手動模式都記錄；切換模式時不會跳格）
      this.clipTime.set(k, (this.clipTime.get(k) ?? 0) + dt * g.speedRatio);
      if (this.animMode === "manual") this.stepGroup(k, g, blending);
    }
    this.updateBar();
  }

  /** 手動模式：跳到這個片段目前應該在的格 */
  private stepGroup(k: RigClipKey, g: AnimationGroup, blending: boolean): void {
    const fps = g.targetedAnimations[0]?.animation.framePerSecond ?? 60;
    const len = g.to - g.from;
    let f = (this.clipTime.get(k) ?? 0) * fps;
    f = g.loopAnimation && len > 0 ? f % len : Math.min(f, len);
    (g.goToFrame as (frame: number, useWeight?: boolean) => AnimationGroup).call(g, g.from + f, blending);
    this.manualSteps++;
  }

  /**
   * Stage 7.4：切換動畫更新方式。manual：暫停 Babylon 的自動播放，改由 update() 跳格；
   * auto：先跳到目前的格再恢復自動播放。
   */
  setAnimMode(mode: RigAnimMode): void {
    if (mode === this.animMode) return;
    this.animMode = mode;
    for (const [k, g] of this.groups) {
      if (!g.isStarted) continue;
      if (mode === "manual") {
        g.pause();
        this.stepGroup(k, g, this.fader.weight(k) < 1);
      } else {
        this.stepGroup(k, g, this.fader.weight(k) < 1);
        g.play(g.loopAnimation);
      }
    }
  }

  /** Stage 7.4：遠距離不投射陰影（陰影貼圖少畫蒙皮網格） */
  setShadowCasting(on: boolean): void {
    const sg = this.opts.shadows;
    if (!sg || on === this.castShadow) return;
    this.castShadow = on;
    for (const m of this.meshes) {
      if (on) sg.addShadowCaster(m, false);
      else sg.removeShadowCaster(m, false);
    }
  }

  get shadowCasting(): boolean {
    return this.castShadow;
  }

  /** Stage 7.4：極遠距離不畫（AI、戰鬥、死亡重生照常計算；回到範圍內立刻顯示） */
  setRenderVisible(on: boolean): void {
    for (const m of this.meshes) if (m.isVisible !== on) m.isVisible = on;
  }

  private makeBar(): { root: TransformNode; fill: Mesh } {
    const s = this.opts.scene;
    const root = new TransformNode(`hpbar_${this.id}`, s);
    root.parent = this.root;
    root.position.y = this.spec.hpBarHeight;
    root.billboardMode = TransformNode.BILLBOARDMODE_ALL;
    const mats = sharedBarMaterials(s);
    const mk = (name: string, w: number, h: number, c: Color3, z: number): Mesh => {
      const m = MeshBuilder.CreatePlane(name, { width: w, height: h }, s);
      m.material = c === BAR_BG ? mats.bg : mats.fill;
      m.parent = root;
      m.position.z = z;
      m.isPickable = false;
      return m;
    };
    mk(`hpbg_${this.id}`, 0.56, 0.07, BAR_BG, 0.001);
    const fill = mk(`hpfill_${this.id}`, 0.52, 0.045, BAR_FILL, 0);
    root.setEnabled(false);
    return { root, fill };
  }

  private updateBar(): void {
    const b = this.bar;
    if (!b) return;
    const alive = this.state !== "death" && this.state !== "dead" && this.state !== "respawn";
    const show = alive && this.hp < this.maxHp;
    if (b.root.isEnabled() !== show) b.root.setEnabled(show);
    if (show) {
      const r = Math.max(0, Math.min(1, this.hp / this.maxHp));
      b.fill.scaling.x = Math.max(0.001, r);
      b.fill.position.x = -0.26 * (1 - r);
    }
  }

  /** 血條的世界高度（測試用） */
  get hpBarWorldY(): number | null {
    return this.bar ? this.bar.root.getAbsolutePosition().y : null;
  }

  get hpBarVisible(): boolean {
    return !!this.bar && this.bar.root.isEnabled();
  }

  /** 每個片段目前的權重（測試用） */
  weights(): Record<string, number> {
    const o: Record<string, number> = {};
    for (const [k, g] of this.groups) if (g.isStarted) o[k] = g.weight < 0 ? 1 : Math.round(g.weight * 1000) / 1000;
    return o;
  }

  dispose(): void {
    for (const g of this.groups.values()) {
      g.stop();
      g.dispose();
    }
    for (const m of this.materials) m.dispose();
    this.root.dispose(false, false);
    this.skeleton?.dispose();
  }
}
