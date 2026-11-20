import {
  Color3,
  Color4,
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
import { antennaWeight, DUST_COLORS, dustCount, dustParticle, poseScale } from "./animation.ts";
import { BoboV38RAnimDriver, type BoboDriverFrame, type BoboExpr } from "./driver.ts";

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

/** 表情圖格索引（V3 起順序：一般、開心、好奇、生氣、害怕、暈眩、昏睡、受傷） */
const EXPR: Record<BoboExpr, number> = { normal: 0, angry: 3, sleepy: 6, hurt: 7 };
/** 頭頂星星中心高度（身體模型座標；與測試頁相同） */
const STAR_W = antennaWeight(1.19);

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
  /** 0~1：頭頂星星亮度（死亡時熄滅）；光暈跟著變暗 */
  starBright: number;
  shown: boolean;
}

const HALO_CAPACITY = 32;
/** 星塵容量：每隻最多 10 顆（高畫質）；同時死亡的隻數超過時，多出的不顯示星塵（不影響死亡流程） */
const DUST_CAPACITY = 64;

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
  /** 死亡星塵（測試頁同一張四芒星光貼圖；所有啵啵共用 1 個 SpriteManager，預先建立，沒有粒子時不繪製） */
  readonly dust: SpriteManager;
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

    {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d")!;
      const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      rg.addColorStop(0, "rgba(255,255,255,1)");
      rg.addColorStop(0.18, "rgba(255,255,255,0.75)");
      rg.addColorStop(0.5, "rgba(255,255,255,0.12)");
      rg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = rg;
      g.fillRect(0, 0, 64, 64);
      g.globalCompositeOperation = "lighter";
      g.fillStyle = "rgba(255,255,255,0.8)";
      g.beginPath();
      g.moveTo(32, 2); g.quadraticCurveTo(35, 29, 62, 32); g.quadraticCurveTo(35, 35, 32, 62); g.quadraticCurveTo(29, 35, 2, 32); g.quadraticCurveTo(29, 29, 32, 2);
      g.fill();
      this.dust = new SpriteManager("BoboV38RGame_StarDust", c.toDataURL("image/png"), DUST_CAPACITY, { width: 64, height: 64 }, scene);
      this.dust.blendMode = Constants.ALPHA_ADD;
      this.dust.disableDepthWrite = true;
      this.dust.isPickable = false;
    }

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
    const live: LiveInstance = { place, inst, body, stars, jelly: bm.jelly, sprite, vis: 1, starBright: 1, shown: true };
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
    this.dust.dispose();
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
      const w = l.inst.root.getWorldMatrix().getTranslationToRef(this.tmpV);
      // 離地時縮小（彈跳）；淡出時跟著消失；跟著攻擊往前彈出的位置
      const sc = (1 - Math.min(0.45, Math.max(0, l.inst.root.position.y) * 2.6)) * l.vis;
      this.tmpS.set(sc, 1, sc);
      this.tmpT.set(w.x, q.y + 0.004, w.z);
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
      // 死亡：光暈跟著星星亮度與整體透明度變暗（加法混合，alpha 直接決定亮度）
      l.sprite.color.a = l.starBright * l.vis;
    }
  }
}

export interface BoboV38RVisualOptions {
  scene: Scene;
  /** 模型資料夾網址（例：`${import.meta.env.BASE_URL}models/`） */
  baseUrl: string;
  lod: MonsterLod;
  /**
   * 彈跳位移同步（實驗、預設關閉）：模型在著地期間不前進、在空中補上 AI 已走的距離，
   * 消除著地滑行；模型位置最多落後邏輯位置約 0.4 公尺。只影響畫面，不影響 AI、命中與距離判定。
   */
  hopSync?: boolean;
}

/** 測試與預覽頁讀取的動畫狀態 */
export interface BoboV38RAnimDebug {
  /** 目前播放的 V3.8R 動畫 */
  anim: string;
  animTime: number;
  /** 遊戲狀態機目前的狀態 */
  logic: MonsterState;
  face: BoboExpr;
  visibility: number;
  starBright: number;
  dust: number;
  tempStarMaterial: boolean;
  lift: number;
  fwd: number;
  /** 視覺位置與邏輯位置的水平差距（公尺；hopSync 開啟時才會大於 0） */
  lag: number;
  /** 累計：開始播放各動畫的次數 */
  starts: { attack: number; hurt: number; death: number; respawn: number };
}

let visualSeq = 0;

/**
 * 一隻 V3.8R 啵啵的視覺（IMonsterVisual）。
 * 何時播哪一段動畫由 BoboV38RAnimDriver（純邏輯、可單元測試）依遊戲狀態機決定；
 * 這裡只把結果套到模型：根節點縮放／傾斜／離地／往前彈出、觸角與翅膀（頂點著色器）、頭頂星星位置、
 * 表情貼圖、透明度、星星熄滅（死亡時這一隻專用的暫時材質）、星塵。
 */
export class BoboV38RVisual implements IMonsterVisual {
  readonly kind = "gltf" as const;
  private readonly opts: BoboV38RVisualOptions;
  readonly driver: BoboV38RAnimDriver;
  private assets: BoboV38RSceneAssets | null = null;
  private live: LiveInstance | null = null;
  private expr: ExpressionAtlasController | null = null;
  private bodyMaterial: StandardMaterial | null = null;
  private loading: Promise<void> | null = null;
  private disposed = false;
  private readonly xf = { x: 0, y: 0, z: 0, yaw: 0 };
  private last: BoboDriverFrame | null = null;
  private face: BoboExpr | null = null;
  private blinkClosed = false;
  private vis = 1;
  private starBright = 1;
  private starMat: StandardMaterial | null = null;
  private readonly dust: Sprite[] = [];
  private readonly dustN: number;

  constructor(opts: BoboV38RVisualOptions) {
    this.opts = opts;
    const n = visualSeq++;
    this.driver = new BoboV38RAnimDriver([0, 0.37, 0.71][n % 3]!, 17 + (n % 3) * 101, opts.hopSync === true);
    this.dustN = dustCount(opts.lod);
  }

  /** 相容既有除錯 API（window.__starwish.monsters() 以 model.root 判斷是否在畫面內） */
  get model(): { root: TransformNode } | null {
    return this.live ? { root: this.live.place } : null;
  }

  get loaded(): boolean {
    return this.live !== null;
  }

  debugState(): BoboV38RAnimDebug {
    const f = this.last;
    return {
      // 已移除時播放器停在死亡最後一幀；顯示為 dead
      anim: this.driver.logic === "dead" ? "dead" : this.driver.player.current,
      animTime: this.driver.player.time,
      logic: this.driver.logic,
      face: this.face ?? "normal",
      visibility: this.vis,
      starBright: this.starBright,
      dust: this.dust.length,
      tempStarMaterial: this.starMat !== null,
      lift: f?.pose.lift ?? 0,
      fwd: f?.pose.fwd ?? 0,
      lag: this.driver.lag,
      starts: { ...this.driver.starts },
    };
  }

  /** 截圖用：待機第 0 秒、一般表情、對齊邏輯位置與朝向 */
  snap(): void {
    this.driver.snap();
    if (this.live) this.render(0);
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
        this.render(0);
      });
    }
    return this.loading;
  }

  setTransform(x: number, y: number, z: number, yaw: number): void {
    this.xf.x = x;
    this.xf.y = y;
    this.xf.z = z;
    this.xf.yaw = yaw;
    this.driver.setTransform(x, z, yaw);
  }

  onStateEnter(state: MonsterState): void {
    this.driver.onStateEnter(state);
  }

  applyPose(_pose: MonsterPose): void {
    /* V3.8R 的姿勢由已驗收的動畫產生（driver）；框架的通用姿勢不使用 */
  }

  setFace(_face: MonsterFace): void {
    /* 表情跟著 V3.8R 動畫（攻擊 → 生氣、受傷 → 受傷、死亡 → 受傷 → 閉眼），與已驗收的測試頁相同 */
  }

  playEffect(_effect: MonsterEffect): void {
    /* 已驗收的 V3.8R 動畫沒有額外特效（死亡星塵屬於死亡動畫） */
  }

  update(dt: number): void {
    if (this.live) this.render(dt);
    else this.driver.update(dt); // 載入完成前狀態照樣前進，載入後立刻是正確的動畫
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearDust();
    this.releaseStarMat();
    if (this.assets && this.live && this.bodyMaterial) this.assets.despawn(this.live, this.bodyMaterial);
    this.assets?.release();
    this.assets = null;
    this.live = null;
    this.expr = null;
    this.bodyMaterial = null;
  }

  // ------------------------------------------------------------------ 內部

  private render(dt: number): void {
    const l = this.live!;
    const f = this.driver.update(dt);
    this.last = f;
    if (f.hidden) {
      // 移除：隱藏、沒有圓影與光暈；資源保留給重生
      if (l.place.isEnabled()) l.place.setEnabled(false);
      l.shown = false;
      this.clearDust();
      // 已移除：這一隻的暫時星星材質不再需要，立即釋放
      this.releaseStarMat();
      return;
    }
    if (!l.place.isEnabled()) l.place.setEnabled(true);
    l.shown = true;
    const p = f.pose;
    l.place.position.set(this.xf.x + f.offsetX, this.xf.y, this.xf.z + f.offsetZ);
    l.place.rotation.y = f.yaw;
    const root = l.inst.root;
    root.position.set(0, p.lift, p.fwd);
    const [sx, sy, sz] = poseScale(p);
    root.scaling.set(sx, sy, sz);
    root.rotation.x = p.pitch;
    root.rotation.z = p.roll;
    l.jelly.anim.set(p.swayX, p.swayZ, p.flap, 0);
    l.stars.position.set(p.swayX * STAR_W, 0, p.swayZ * STAR_W);

    if (f.face !== this.face) {
      this.face = f.face;
      this.blinkClosed = false;
      this.expr?.set(EXPR[f.face]);
    }
    if (f.blinkClosed !== this.blinkClosed) {
      this.blinkClosed = f.blinkClosed;
      this.expr?.setPart("Eyes", f.blinkClosed ? EXPR.sleepy : undefined);
    }
    if (f.dustTime !== null) this.updateDust(f.dustTime);
    else this.clearDust();
    this.setStarBright(f.starBright);
    this.setVis(f.visibility);
  }

  private setVis(v: number): void {
    const l = this.live!;
    l.vis = v;
    // 完全比較（不用門檻）：結束時一定回到 1，網格才會回到不透明繪製
    if (v === this.vis) return;
    this.vis = v;
    // mesh.visibility 是每隻自己的網格屬性，不改共用材質
    for (const m of l.inst.meshes) m.visibility = v;
  }

  /** 死亡時只為這一隻複製一份星星材質（其他隻不受影響），重生時釋放；熄滅後留下淡淡的冷灰藍水晶色（與測試頁相同） */
  private setStarBright(b: number): void {
    const l = this.live!;
    l.starBright = b;
    if (b >= 1) {
      this.releaseStarMat();
      return;
    }
    if (b === this.starBright && this.starMat) return;
    this.starBright = b;
    const base = this.assets!.mats.stars;
    if (!this.starMat) {
      this.starMat = base.clone(`BoboV38RGame_StarDim_${l.place.name}`) as StandardMaterial;
      l.stars.material = this.starMat;
    }
    const out = 1 - b;
    this.starMat.emissiveColor.set(base.emissiveColor.r * b + 0.3 * out, base.emissiveColor.g * b + 0.34 * out, base.emissiveColor.b * b + 0.42 * out);
    this.starMat.diffuseColor.set(base.diffuseColor.r * b + 0.4 * out, base.diffuseColor.g * b + 0.45 * out, base.diffuseColor.b * b + 0.55 * out);
    this.starMat.specularColor.copyFrom(base.specularColor).scaleInPlace(0.5 + 0.5 * b);
  }

  private releaseStarMat(): void {
    this.starBright = 1;
    if (this.live) this.live.starBright = 1;
    if (!this.starMat) return;
    if (this.live && this.assets) this.live.stars.material = this.assets.mats.stars;
    this.starMat.dispose(false, false);
    this.starMat = null;
  }

  private updateDust(t: number): void {
    const a = this.assets!;
    while (this.dust.length < this.dustN && a.dust.sprites.length < DUST_CAPACITY) {
      const k = this.dust.length;
      const sp = new Sprite(`BoboV38RGame_Dust_${this.live!.place.name}_${k}`, a.dust);
      const c = DUST_COLORS[k % DUST_COLORS.length]!;
      sp.color = new Color4(c[0], c[1], c[2], 0);
      sp.isPickable = false;
      this.dust.push(sp);
    }
    const q = this.live!.place.position;
    this.dust.forEach((sp, k) => {
      const d = dustParticle(k, this.dustN, t);
      sp.position.set(q.x + d.x, q.y + d.y, q.z + d.z);
      sp.width = sp.height = d.size;
      sp.color.a = d.alpha;
    });
  }

  private clearDust(): void {
    if (!this.dust.length) return;
    for (const sp of this.dust) sp.dispose();
    this.dust.length = 0;
  }
}
