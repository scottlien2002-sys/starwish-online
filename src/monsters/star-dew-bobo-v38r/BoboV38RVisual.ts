import {
  Color3,
  Constants,
  DynamicTexture,
  Matrix,
  type Mesh,
  MeshBuilder,
  type Nullable,
  type Observer,
  type PBRMaterial,
  Quaternion,
  type Scene,
  Sprite,
  SpriteManager,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { MonsterLod } from "../assets/spec.ts";
import type { IMonsterVisual, MonsterEffect, MonsterFace, MonsterPose, MonsterState } from "../framework/types.ts";
import { ExpressionAtlasController, loadMonsterAsset, type MonsterAssetHandle, type MonsterAssetInstance } from "../babylon/loadMonsterAsset.ts";
import { createBoboV38RMaterials, type BoboV38RSharedMaterials } from "./materials.ts";
import type { JellyV38RPlugin } from "./JellyV38RPlugin.ts";
import { BOBO_V38R_SPEC } from "./spec.ts";

/**
 * 星露啵啵 V3.8R — 正式遊戲整合適配器（Stage 5.1）。
 *
 * 實作框架的 IMonsterVisual，讓既有的怪物系統（MonsterFactory → MonsterController → 狀態機/AI）
 * 直接驅動 V3.8R GLB；不重建怪物系統。
 *
 * 資源分兩層：
 * - 場景共用（BoboV38RSceneAssets，每個場景＋畫質一份，引用計數）：GLB（只載入一次，幾何與貼圖共用）、
 *   眼睛／嘴／腮紅／星星材質、雜訊與 matcap 貼圖、接地圓影（thin instances，1 次繪製）、頭頂星星光暈（SpriteManager，1 次繪製）
 * - 每隻一份：節點複本、身體材質＋果凍外掛（腹部星星、矩陣）、表情 UV、光暈 sprite
 *
 * Stage 5.1 範圍：載入、材質、表情、位置/朝向、顯示/透明度。
 * 五段已驗收動畫（Idle/Move/Attack/Hurt/Death）與狀態對應在 Stage 5.2 接上；此階段模型保持靜止姿勢。
 */

/** 表情名稱 → 表情圖格索引（V3 起順序：一般、開心、好奇、生氣、害怕、暈眩、昏睡、受傷） */
const FACE_INDEX: Record<MonsterFace, number> = { normal: 0, angry: 3, hurt: 7 };

interface BellyStarDef {
  outer: number;
  inner: number;
  center: [number, number, number];
  normal: [number, number, number];
}

interface LiveInstance {
  /** 遊戲位置／朝向（MonsterController.setTransform 設定） */
  place: TransformNode;
  /** 模型根節點（place 的子節點；Stage 5.2 起由動畫姿勢改縮放、旋轉與離地高度） */
  inst: MonsterAssetInstance;
  body: Mesh;
  stars: Mesh;
  jelly: JellyV38RPlugin;
  sprite: Sprite;
  /** 0~1：整體透明度（死亡淡出／重生淡入）；圓影與光暈跟著變淡 */
  vis: number;
  shown: boolean;
}

const HALO_CAPACITY = 32;

/** 每個場景＋畫質一份的共用資源 */
export class BoboV38RSceneAssets {
  readonly scene: Scene;
  readonly lod: MonsterLod;
  readonly handle: MonsterAssetHandle;
  readonly mats: BoboV38RSharedMaterials;
  readonly bellyStar: BellyStarDef | null;
  private readonly blob: Mesh;
  private readonly blobMat: StandardMaterial;
  private readonly blobTex: DynamicTexture;
  private readonly halo: SpriteManager;
  private readonly live = new Set<LiveInstance>();
  private fxBuf = new Float32Array(16 * 4);
  private readonly tmpM = new Matrix();
  private readonly tmpV = new Vector3();
  private readonly tmpS = new Vector3();
  private readonly tmpT = new Vector3();
  private readonly observer: Nullable<Observer<Scene>>;
  private refs = 0;
  private seq = 0;
  private disposed = false;

  private constructor(scene: Scene, lod: MonsterLod, handle: MonsterAssetHandle) {
    this.scene = scene;
    this.lod = lod;
    this.handle = handle;
    this.mats = createBoboV38RMaterials(scene, handle.container.materials as PBRMaterial[], lod !== "low");
    this.bellyStar = ((handle.extras as { bellyStar?: BellyStarDef }).bellyStar ?? null);
    if (!this.bellyStar) throw new Error(`${handle.file} 缺少腹部星星資料（extras.bellyStar）`);

    // 接地圓影（與測試頁相同：草地上偏冷的柔和圓影；所有啵啵共用 1 個網格，thin instances）
    this.blobTex = new DynamicTexture("BoboV38RGame_BlobTex", { width: 128, height: 128 }, scene, true);
    {
      const ctx = this.blobTex.getContext() as unknown as CanvasRenderingContext2D;
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.45, "rgba(255,255,255,0.75)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      this.blobTex.update();
    }
    this.blobTex.hasAlpha = true;
    this.blobMat = new StandardMaterial("BoboV38RGame_BlobMat", scene);
    this.blobMat.disableLighting = true;
    this.blobMat.emissiveColor = new Color3(0.14, 0.24, 0.2);
    this.blobMat.opacityTexture = this.blobTex;
    this.blobMat.alpha = 0.42;
    this.blobMat.disableDepthWrite = true;
    this.blobMat.zOffset = -2;
    this.blob = MeshBuilder.CreateGround("BoboV38RGame_BlobShadow", { width: 1.05, height: 0.82 }, scene);
    this.blob.material = this.blobMat;
    this.blob.isPickable = false;
    this.blob.alphaIndex = 0;
    this.blob.thinInstanceSetBuffer("matrix", this.fxBuf.subarray(0, 16), 16, false);
    this.blob.thinInstanceCount = 0;
    this.blob.alwaysSelectAsActiveMesh = true;

    // 頭頂星星光暈（與測試頁相同的檸檬金黃柔光；加法混合）
    const haloCanvas = document.createElement("canvas");
    haloCanvas.width = haloCanvas.height = 128;
    {
      const ctx = haloCanvas.getContext("2d")!;
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, "rgba(255,244,170,0.85)");
      g.addColorStop(0.3, "rgba(255,232,130,0.42)");
      g.addColorStop(0.65, "rgba(255,222,110,0.12)");
      g.addColorStop(1, "rgba(255,215,100,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
    this.halo = new SpriteManager("BoboV38RGame_StarHalo", haloCanvas.toDataURL("image/png"), HALO_CAPACITY, { width: 128, height: 128 }, scene);
    this.halo.blendMode = Constants.ALPHA_ADD;
    this.halo.disableDepthWrite = true;
    this.halo.isPickable = false;

    // 每幀在繪製前更新：果凍矩陣（星雲黏在身體上）、圓影位置、光暈位置
    this.observer = scene.onBeforeRenderObservable.add(() => this.beforeRender());
  }

  private static readonly cache = new WeakMap<Scene, Map<string, Promise<BoboV38RSceneAssets>>>();

  /** 取得（必要時載入）共用資源：同一場景＋畫質只載入一次 GLB */
  static acquire(scene: Scene, baseUrl: string, lod: MonsterLod): Promise<BoboV38RSceneAssets> {
    let perScene = BoboV38RSceneAssets.cache.get(scene);
    if (!perScene) {
      perScene = new Map();
      BoboV38RSceneAssets.cache.set(scene, perScene);
    }
    let p = perScene.get(lod);
    if (!p) {
      p = loadMonsterAsset(scene, baseUrl, BOBO_V38R_SPEC, lod).then((h) => new BoboV38RSceneAssets(scene, lod, h));
      perScene.set(lod, p);
      // 載入失敗時移除快取，下次可重試
      p.catch(() => perScene!.delete(lod));
    }
    return p.then((a) => {
      a.refs++;
      return a;
    });
  }

  /** 已載入的共用資源（測試／除錯用） */
  static loaded(scene: Scene): Promise<BoboV38RSceneAssets>[] {
    return [...(BoboV38RSceneAssets.cache.get(scene)?.values() ?? [])];
  }

  get liveCount(): number {
    return this.live.size;
  }
  get refCount(): number {
    return this.refs;
  }
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** 建立一隻：節點複本＋獨立身體材質＋表情控制器＋光暈 sprite */
  spawn(): { live: LiveInstance; expr: ExpressionAtlasController; bodyMaterial: StandardMaterial } {
    const n = this.seq++;
    const place = new TransformNode(`BoboV38RGame_Place_${n}`, this.scene);
    const inst = this.handle.instantiate(`BoboV38RGame_${n}`);
    inst.root.parent = place;
    const body = inst.part("Body_");
    const eyes = inst.part("Eyes");
    const mouth = inst.part("Mouth");
    const blush = inst.part("Blush");
    const stars = inst.part("Stars");
    const bm = this.mats.body(`BoboV38RGame_Body_${n}`);
    const star = this.bellyStar!;
    bm.jelly.starOuter = star.outer;
    bm.jelly.starInner = star.inner;
    bm.jelly.starCenter.set(...star.center);
    bm.jelly.starNormal.set(...star.normal).normalize();
    // 繪製順序與測試頁相同：星星不透明先畫 → 身體（透明、先寫深度）→ 眼睛 → 腮紅 → 嘴
    body.material = bm.material;
    body.alphaIndex = 1;
    bm.material.needDepthPrePass = true;
    eyes.material = this.mats.eyes;
    eyes.alphaIndex = 2;
    stars.material = this.mats.stars;
    blush.material = this.mats.blush;
    blush.alphaIndex = 2;
    mouth.material = this.mats.mouth;
    mouth.alphaIndex = 3;
    for (const m of inst.meshes) {
      m.isPickable = false;
      m.receiveShadows = false;
    }
    const expr = new ExpressionAtlasController(BOBO_V38R_SPEC.expressions!, inst);
    const sprite = new Sprite(`BoboV38RGame_Halo_${n}`, this.halo);
    sprite.width = sprite.height = 0.42;
    sprite.isPickable = false;
    const live: LiveInstance = { place, inst, body, stars, jelly: bm.jelly, sprite, vis: 1, shown: true };
    this.live.add(live);
    return { live, expr, bodyMaterial: bm.material };
  }

  /** 移除一隻：只釋放這隻自己的東西（節點、身體材質、表情用的獨立 UV、sprite），共用資源不動 */
  despawn(live: LiveInstance, bodyMaterial: StandardMaterial): void {
    if (!this.live.delete(live)) return;
    live.sprite.dispose();
    live.inst.dispose();
    live.place.dispose();
    // 身體材質是這隻專用；貼圖（雜訊、matcap）為共用 → 不一併釋放
    bodyMaterial.dispose(false, false);
  }

  /** 引用計數歸零時釋放全部共用資源 */
  release(): void {
    if (this.disposed) return;
    this.refs = Math.max(0, this.refs - 1);
    if (this.refs > 0) return;
    this.disposed = true;
    this.scene.onBeforeRenderObservable.remove(this.observer);
    BoboV38RSceneAssets.cache.get(this.scene)?.delete(this.lod);
    this.halo.dispose();
    this.blob.dispose(false, false);
    this.blobMat.dispose(false, false);
    this.blobTex.dispose();
    this.mats.dispose();
    this.handle.dispose();
  }

  private beforeRender(): void {
    const cam = this.scene.activeCamera;
    const shown = [...this.live].filter((l) => l.shown);
    if (this.fxBuf.length < 16 * Math.max(1, shown.length)) this.fxBuf = new Float32Array(16 * shown.length * 2);
    shown.forEach((l, k) => {
      // 根節點每幀可能變動 → 先更新世界矩陣，果凍內部的星雲才會黏在身體上
      l.body.computeWorldMatrix(true);
      l.body.getWorldMatrix().invertToRef(l.jelly.invWorld);
      if (cam) l.jelly.view.copyFrom(cam.getViewMatrix());
      const q = l.place.position;
      // 離地時縮小（Stage 5.2 起跳躍才會離地）；淡出時跟著消失
      const sc = (1 - Math.min(0.45, Math.max(0, l.inst.root.position.y) * 2.6)) * l.vis;
      this.tmpS.set(sc, 1, sc);
      this.tmpT.set(q.x, q.y + 0.004, q.z);
      Matrix.ComposeToRef(this.tmpS, Quaternion.Identity(), this.tmpT, this.tmpM);
      this.tmpM.copyToArray(this.fxBuf, k * 16);
    });
    this.blob.thinInstanceSetBuffer("matrix", this.fxBuf.subarray(0, 16 * Math.max(1, shown.length)), 16, false);
    this.blob.thinInstanceCount = shown.length;
    for (const l of this.live) {
      l.sprite.isVisible = l.shown;
      if (!l.shown) continue;
      l.stars.computeWorldMatrix(true);
      Vector3.TransformCoordinatesToRef(l.stars.getBoundingInfo().boundingSphere.center, l.stars.getWorldMatrix(), this.tmpV);
      l.sprite.position.copyFrom(this.tmpV);
      l.sprite.color.a = l.vis;
    }
  }
}

export interface BoboV38RVisualOptions {
  scene: Scene;
  /** 模型資料夾網址（例：`${import.meta.env.BASE_URL}models/`） */
  baseUrl: string;
  lod: MonsterLod;
}

/** 一隻 V3.8R 啵啵的視覺（IMonsterVisual） */
export class BoboV38RVisual implements IMonsterVisual {
  readonly kind = "gltf" as const;
  private readonly opts: BoboV38RVisualOptions;
  private assets: BoboV38RSceneAssets | null = null;
  private live: LiveInstance | null = null;
  private expr: ExpressionAtlasController | null = null;
  private bodyMaterial: StandardMaterial | null = null;
  private loading: Promise<void> | null = null;
  private disposed = false;
  // 載入完成前收到的最新狀態，載入後立刻套用
  private readonly xf = { x: 0, y: 0, z: 0, yaw: 0 };
  private face: MonsterFace = "normal";
  private opacity = 1;
  private visible = true;
  private lastFace = -1;

  constructor(opts: BoboV38RVisualOptions) {
    this.opts = opts;
  }

  /** 相容既有除錯 API（window.__starwish.monsters() 以 model.root 判斷是否在畫面內） */
  get model(): { root: TransformNode } | null {
    return this.live ? { root: this.live.place } : null;
  }

  get loaded(): boolean {
    return this.live !== null;
  }

  load(): Promise<void> {
    if (!this.loading) {
      this.loading = BoboV38RSceneAssets.acquire(this.opts.scene, this.opts.baseUrl, this.opts.lod).then((a) => {
        if (this.disposed) {
          a.release();
          return;
        }
        this.assets = a;
        const s = a.spawn();
        this.live = s.live;
        this.expr = s.expr;
        this.bodyMaterial = s.bodyMaterial;
        this.applyTransform();
        this.applyVisibility();
        this.applyFace();
      });
    }
    return this.loading;
  }

  setTransform(x: number, y: number, z: number, yaw: number): void {
    this.xf.x = x;
    this.xf.y = y;
    this.xf.z = z;
    this.xf.yaw = yaw;
    this.applyTransform();
  }

  onStateEnter(_state: MonsterState): void {
    /* Stage 5.2：狀態 → V3.8R 動畫 */
  }

  applyPose(pose: MonsterPose): void {
    // Stage 5.1：只取通用的顯示與透明度（死亡後隱藏、重生淡入）；伸縮／傾斜等姿勢曲線在 Stage 5.2 改用 V3.8R 已驗收動畫
    const visible = pose.bodyVisible;
    const opacity = Math.max(0, Math.min(1, pose.opacity));
    if (visible !== this.visible || Math.abs(opacity - this.opacity) > 0.002) {
      this.visible = visible;
      this.opacity = opacity;
      this.applyVisibility();
    }
  }

  setFace(face: MonsterFace): void {
    this.face = face;
    this.applyFace();
  }

  playEffect(_effect: MonsterEffect): void {
    /* Stage 5.2／5.3：攻擊命中、死亡星塵、重生 */
  }

  update(_dt: number): void {
    /* 果凍矩陣、圓影、光暈由共用資源在繪製前統一更新 */
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.assets && this.live && this.bodyMaterial) this.assets.despawn(this.live, this.bodyMaterial);
    this.assets?.release();
    this.assets = null;
    this.live = null;
    this.expr = null;
    this.bodyMaterial = null;
  }

  private applyTransform(): void {
    const l = this.live;
    if (!l) return;
    l.place.position.set(this.xf.x, this.xf.y, this.xf.z);
    l.place.rotation.y = this.xf.yaw;
  }

  private applyVisibility(): void {
    const l = this.live;
    if (!l) return;
    const on = this.visible && this.opacity > 0.001;
    if (l.place.isEnabled() !== on) l.place.setEnabled(on);
    l.shown = on;
    l.vis = on ? this.opacity : 0;
    // mesh.visibility 是每隻自己的網格屬性，不改共用材質
    for (const m of l.inst.meshes) m.visibility = this.opacity;
  }

  private applyFace(): void {
    if (!this.expr) return;
    const i = FACE_INDEX[this.face] ?? 0;
    if (i === this.lastFace) return;
    this.lastFace = i;
    this.expr.set(i);
  }
}
