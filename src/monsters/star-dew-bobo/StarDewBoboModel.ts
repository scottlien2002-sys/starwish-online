import {
  Color3,
  Color4,
  Curve3,
  DynamicTexture,
  FresnelParameters,
  type GlowLayer,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Scene,
  type ShadowGenerator,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import type { MonsterEffect, MonsterFace, MonsterPose, MonsterView } from "../anim/types.ts";
import { createSoftStar } from "../meshes/star.ts";
import { JellyMaterialPlugin } from "./JellyMaterialPlugin.ts";
import { type FaceExpression, buildFacePatch, faceTextureHeight, paintFace } from "./face.ts";
import {
  ANTENNA_POINTS,
  ANTENNA_SIDE,
  BODY_HEIGHT,
  FACE_LAYOUT,
  HEAD_STAR_POS,
  antennaRadius,
  featureCounterScale,
  normalToRotation,
  profileR,
  profileY,
  softStarRadius,
  surfacePoint,
} from "./shape.ts";
import { createBlobShadowTexture, createGalaxyTexture, createSparkleTexture, createStarfieldTexture } from "./textures.ts";

export interface BoboModelOptions {
  /** 模型高度（公尺），預設 0.8 */
  height?: number;
  shadows?: ShadowGenerator;
  glow?: GlowLayer;
  seed?: number;
  /** 畫質等級：決定身體細分數（高 40／中 32／低 24），預設 medium */
  quality?: "high" | "medium" | "low";
}

const BODY_SEGMENTS = { high: 40, medium: 32, low: 24 } as const;

// V1.2：外層更透明、受光更低（避免頂部過曝），內層改一般混色讓星空真正看得見
const BODY_ALPHA = 0.42;
const CORE_ALPHA = 0.62;
const STAR_SHELL_ALPHA = 0.9;
const WING_ALPHA = 0.38;
const BODY_EMISSIVE = new Color3(0.1, 0.19, 0.42);
const FLASH = new Color3(0.95, 0.95, 1);
const STAR_GRADIENT = { center: [1, 0.97, 0.7] as [number, number, number], edge: [1, 0.72, 0.16] as [number, number, number] };

/**
 * 星露啵啵：程式化暫代 3D 模型（Babylon.js）。
 * 只負責「長相」與「套用姿勢」；動畫邏輯在 MonsterAnimator。
 * 未來換成 GLB 時，新模型實作同一個 MonsterView 介面即可。
 */
export class StarDewBoboModel implements MonsterView {
  readonly root: TransformNode;
  private readonly scene: Scene;
  private readonly motion: TransformNode;
  private readonly squash: TransformNode;
  private readonly antenna: TransformNode;
  private readonly wingL: TransformNode;
  private readonly wingR: TransformNode;
  private readonly bodyMat: StandardMaterial;
  private readonly coreMat: StandardMaterial;
  private readonly starShellMat: StandardMaterial;
  private readonly wingMat: StandardMaterial;
  private readonly starMat: StandardMaterial;
  private readonly ringMat: StandardMaterial;
  private readonly blobMat: StandardMaterial;
  private readonly ring: Mesh;
  private readonly blob: Mesh;
  private readonly stars: Mesh[] = [];
  /** 臉部等不透明零件（淡出時調整 visibility） */
  private readonly faceMeshes: Mesh[] = [];
  /** 需要反向補償縮放的五官節點 */
  private readonly featureAnchors: TransformNode[] = [];
  private readonly inner: ParticleSystem;
  /** V2：貼合曲面的臉部網格與三種表情貼圖 */
  private readonly faceMat: StandardMaterial;
  private readonly faceTextures: Record<FaceExpression, DynamicTexture>;
  private readonly burst: ParticleSystem;
  private readonly rise: ParticleSystem;
  private readonly materials: StandardMaterial[] = [];
  private readonly height: number;
  /** V2 果凍材質外掛（低畫質為 null） */
  private readonly jelly: JellyMaterialPlugin | null;
  /** 體內星光粒子倍率（高 1、中 0.6、低 0） */
  private readonly ambientParticles: number;
  private currentFace: MonsterFace | null = null;
  private time = 0;

  constructor(scene: Scene, options: BoboModelOptions = {}) {
    this.scene = scene;
    this.height = options.height ?? 0.8;
    const seg = BODY_SEGMENTS[options.quality ?? "medium"];
    const s = this.height / BODY_HEIGHT;

    this.root = new TransformNode("PH_bobo", scene);
    const scaled = new TransformNode("PH_bobo_scaled", scene);
    scaled.parent = this.root;
    scaled.scaling.setAll(s);
    this.motion = new TransformNode("PH_bobo_motion", scene);
    this.motion.parent = scaled;
    this.squash = new TransformNode("PH_bobo_squash", scene);
    this.squash.parent = this.motion;

    // ---------- 材質 ----------
    // V1.2：受光顏色降低（頂部受天光照射最強，原本會過曝發白）
    this.bodyMat = this.mat("PH_boboBody", new Color3(0.44, 0.66, 1));
    this.bodyMat.emissiveColor = BODY_EMISSIVE.clone();
    this.bodyMat.specularColor = new Color3(0.18, 0.2, 0.24);
    this.bodyMat.specularPower = 14;
    this.bodyMat.useSpecularOverAlpha = false;
    this.bodyMat.alpha = BODY_ALPHA;
    // 透明層次：正面中心約 35%、輪廓 100%
    const opacityFresnel = new FresnelParameters();
    opacityFresnel.leftColor = Color3.White();
    opacityFresnel.rightColor = new Color3(0.35, 0.35, 0.35);
    opacityFresnel.bias = 0.05;
    opacityFresnel.power = 2;
    this.bodyMat.opacityFresnelParameters = opacityFresnel;
    // 只在輪廓出現柔和反光（果凍表面反射天空），中央不再發白
    const emissiveFresnel = new FresnelParameters();
    emissiveFresnel.leftColor = new Color3(0.45, 0.65, 1);
    emissiveFresnel.rightColor = Color3.Black();
    emissiveFresnel.bias = 0.05;
    emissiveFresnel.power = 3;
    this.bodyMat.emissiveFresnelParameters = emissiveFresnel;

    // V2：果凍材質外掛（高、中畫質）。編譯失敗時自動停用，回到上面的 V1.2 材質。
    const quality = options.quality ?? "medium";
    this.ambientParticles = quality === "high" ? 1 : quality === "medium" ? 0.6 : 0;
    if (quality !== "low") {
      const jelly = new JellyMaterialPlugin(this.bodyMat);
      jelly.height = this.height;
      this.jelly = jelly;
      this.bodyMat.onError = () => {
        if (jelly.jellyEnabled) {
          console.warn("[bobo] jelly shader failed, falling back to standard material");
          jelly.jellyEnabled = false;
        }
      };
      // 外掛已有藍紫邊緣光，原本的 emissive Fresnel 收斂一些避免輪廓過曝
      emissiveFresnel.leftColor = new Color3(0.28, 0.4, 0.75);
    } else {
      this.jelly = null;
    }

    // 內層 1：星空（一般混色，不再用加法混色疊白）
    const galaxy = createGalaxyTexture(scene, options.seed ?? 11);
    this.coreMat = this.mat("PH_boboCore", Color3.Black());
    this.coreMat.emissiveTexture = galaxy;
    this.coreMat.disableLighting = true;
    this.coreMat.alpha = CORE_ALPHA;
    this.coreMat.alphaMode = 2; // ALPHA_COMBINE

    // 內層 2：星點殼（加法混色、反向緩慢流動 → 與星空層產生前後視差，增加立體深度）
    const starfield = createStarfieldTexture(scene, (options.seed ?? 11) + 5);
    this.starShellMat = this.mat("PH_boboStarShell", Color3.Black());
    this.starShellMat.emissiveTexture = starfield;
    this.starShellMat.opacityTexture = starfield;
    this.starShellMat.disableLighting = true;
    this.starShellMat.alpha = STAR_SHELL_ALPHA;
    this.starShellMat.alphaMode = 1; // ALPHA_ADD
    this.starShellMat.backFaceCulling = false;

    this.wingMat = this.mat("PH_boboWing", new Color3(0.6, 0.8, 1));
    this.wingMat.emissiveColor = new Color3(0.22, 0.38, 0.78);
    this.wingMat.specularColor = new Color3(0.2, 0.24, 0.3);
    this.wingMat.specularPower = 16;
    this.wingMat.alpha = WING_ALPHA;
    this.wingMat.backFaceCulling = false;
    // 翅膀邊緣較實、中間較透
    const wingFresnel = new FresnelParameters();
    wingFresnel.leftColor = Color3.White();
    wingFresnel.rightColor = new Color3(0.45, 0.45, 0.45);
    wingFresnel.bias = 0.1;
    wingFresnel.power = 1.5;
    this.wingMat.opacityFresnelParameters = wingFresnel;

    // V2：星星用頂點色（中央奶油黃 → 邊緣暖金）；emissive 為中性亮度（同時決定光暈強度）
    this.starMat = this.mat("PH_boboStar", Color3.White());
    this.starMat.emissiveColor = Color3.White();
    this.starMat.disableLighting = true;
    this.starMat.backFaceCulling = false;

    // ---------- 身體 ----------
    const body = this.createBodyMesh("PH_boboBody", 1, seg);
    body.material = this.bodyMat;
    body.alphaIndex = 2;
    const core = this.createBodyMesh("PH_boboCore", 0.84, Math.round(seg * 0.75));
    core.position.y = 0.07;
    core.material = this.coreMat;
    core.alphaIndex = 0;
    const shell = this.createBodyMesh("PH_boboStarShell", 0.62, Math.round(seg * 0.6));
    shell.position.y = 0.17;
    shell.material = this.starShellMat;
    shell.alphaIndex = 1;

    // ---------- 臉 ----------
    const faceBuilt = this.buildFace(options.quality ?? "medium");
    this.faceMat = faceBuilt.material;
    this.faceTextures = faceBuilt.textures;

    // ---------- 胸前星星 ----------
    const chest = surfacePoint(FACE_LAYOUT.chestStar.y, FACE_LAYOUT.chestStar.theta);
    const chestStar = createSoftStar("PH_boboChestStar", scene, 0.11, 0.06, 0.035, softStarRadius, 60, 6, STAR_GRADIENT);
    this.place(chestStar, chest, 0.01);
    chestStar.rotation.z = 0.25;
    chestStar.material = this.starMat;
    this.stars.push(chestStar);
    this.featureAnchors.push(chestStar);

    // ---------- 翅膀 ----------
    this.wingL = this.createWing(-1);
    this.wingR = this.createWing(1);

    // ---------- 觸角 + 頭頂星星 ----------
    this.antenna = new TransformNode("PH_boboAntenna", scene);
    this.antenna.parent = this.squash;
    this.antenna.position.y = profileY(1) - 0.04;
    // V2：依設定圖，觸角從頭頂往角色左側（正面看畫面右側）柔軟彎下，根部粗、尖端細
    const path = Curve3.CreateCatmullRomSpline(
      ANTENNA_POINTS.map(([x, y, z]) => new Vector3(x * ANTENNA_SIDE, y, z)),
      10,
    ).getPoints();
    const stalk = MeshBuilder.CreateTube(
      "PH_boboStalk",
      {
        path,
        tessellation: 16,
        cap: Mesh.CAP_ALL,
        radiusFunction: (i: number) => antennaRadius(i / Math.max(1, path.length - 1)),
      },
      scene,
    );
    stalk.parent = this.antenna;
    stalk.material = this.bodyMat;
    stalk.alphaIndex = 2;
    // 根部小鼓包：讓觸角像從果凍身體長出來，而非插在頭上
    const bulb = MeshBuilder.CreateSphere("PH_boboStalkRoot", { diameter: 1, segments: 12 }, scene);
    bulb.parent = this.antenna;
    bulb.scaling.set(0.11, 0.07, 0.11);
    bulb.position.y = -0.03;
    bulb.material = this.bodyMat;
    bulb.alphaIndex = 2;
    const headStar = createSoftStar("PH_boboHeadStar", scene, 0.15, 0.085, 0.05, softStarRadius, 60, 6, STAR_GRADIENT);
    headStar.parent = this.antenna;
    headStar.position.set(HEAD_STAR_POS[0] * ANTENNA_SIDE, HEAD_STAR_POS[1], HEAD_STAR_POS[2]);
    headStar.rotation.set(0, -0.25 * ANTENNA_SIDE, 0.35 * ANTENNA_SIDE);
    headStar.material = this.starMat;
    this.stars.push(headStar);

    // ---------- 地面陰影、重生光環（不受擠壓影響）----------
    this.blobMat = this.mat("PH_boboBlob", Color3.Black());
    this.blobMat.opacityTexture = createBlobShadowTexture(scene);
    this.blobMat.emissiveColor = new Color3(0.16, 0.2, 0.42);
    this.blobMat.disableLighting = true;
    this.blob = MeshBuilder.CreateGround("PH_boboBlob", { width: 1.9, height: 1.9 }, scene);
    this.blob.parent = scaled;
    this.blob.position.y = 0.01;
    this.blob.material = this.blobMat;
    this.blob.isPickable = false;

    this.ringMat = this.mat("PH_boboRing", Color3.Black());
    this.ringMat.emissiveColor = new Color3(0.55, 0.85, 1);
    this.ringMat.disableLighting = true;
    this.ring = MeshBuilder.CreateTorus("PH_boboRing", { diameter: 1.7, thickness: 0.035, tessellation: 48 }, scene);
    this.ring.parent = scaled;
    this.ring.position.y = 0.03;
    this.ring.material = this.ringMat;
    this.ring.setEnabled(false);

    // ---------- 粒子 ----------
    const sparkle = createSparkleTexture(scene);
    this.burst = this.createParticles("PH_boboBurst", sparkle, 120);
    this.burst.createSphereEmitter(0.35 * s * 1.25, 1);
    this.burst.minEmitPower = 0.4;
    this.burst.maxEmitPower = 1.3;
    this.burst.gravity = new Vector3(0, 0.5, 0);

    this.rise = this.createParticles("PH_boboRise", sparkle, 120);
    this.rise.createCylinderEmitter(0.7 * s, 0.02, 0, 0);
    this.rise.minEmitPower = 0.5;
    this.rise.maxEmitPower = 1.1;
    this.rise.gravity = new Vector3(0, 0.3, 0);

    // V1.1：體內星光粒子（跟著身體移動、伸縮）
    const innerAnchor = MeshBuilder.CreateBox("PH_boboInnerAnchor", { size: 0.01 }, scene);
    innerAnchor.parent = this.squash;
    innerAnchor.position.y = 0.45;
    innerAnchor.isVisible = false;
    innerAnchor.isPickable = false;
    this.inner = this.createParticles("PH_boboInner", sparkle, 40);
    this.inner.emitter = innerAnchor;
    this.inner.isLocal = true;
    this.inner.createSphereEmitter(0.34, 1);
    this.inner.minEmitPower = 0.01;
    this.inner.maxEmitPower = 0.04;
    this.inner.minLifeTime = 0.8;
    this.inner.maxLifeTime = 1.6;
    this.inner.minSize = 0.035 * (this.height / 0.8);
    this.inner.maxSize = 0.075 * (this.height / 0.8);
    this.inner.color1 = new Color4(1, 1, 1, 1);
    this.inner.color2 = new Color4(0.75, 0.9, 1, 1);
    this.inner.colorDead = new Color4(0.6, 0.75, 1, 0);
    this.inner.gravity = Vector3.Zero();
    this.inner.emitRate = 16;
    this.inner.start();

    // ---------- 陰影與光暈 ----------
    for (const m of this.root.getChildMeshes(false)) m.isPickable = false;
    if (options.shadows) options.shadows.addShadowCaster(body, false);
    if (options.glow) {
      for (const st of this.stars) options.glow.addIncludedOnlyMesh(st);
      options.glow.addIncludedOnlyMesh(this.ring);
      // V2：星星光暈改為暖金色（否則中性亮度的 emissive 會讓光暈泛白、把星星洗成奶油色）
      const glowLayer = options.glow;
      const starSet = new Set<Mesh>(this.stars);
      const prev = glowLayer.customEmissiveColorSelector;
      glowLayer.customEmissiveColorSelector = (mesh, subMesh, material, result) => {
        if (starSet.has(mesh)) {
          const k = this.starMat.emissiveColor.r;
          result.set(1 * k * 0.9, 0.7 * k * 0.9, 0.15 * k * 0.9, 1);
        } else if (prev) {
          prev(mesh, subMesh, material, result);
        } else {
          const e = (material as StandardMaterial).emissiveColor;
          if (e) result.set(e.r, e.g, e.b, 1);
          else result.set(0, 0, 0, 1);
        }
      };
    }

    this.setFace("normal");
  }

  // ======================= MonsterView =======================

  applyPose(p: MonsterPose): void {
    this.motion.setEnabled(p.bodyVisible);
    this.motion.position.set(p.shakeX, p.offsetY, p.offsetZ);
    this.motion.rotation.x = p.lean;
    const sz = p.scaleXZ * p.stretchZ;
    this.squash.scaling.set(p.scaleXZ, p.scaleY, sz);
    // 五官跟著身體表面移動，但自身形狀不被壓扁
    const fc = featureCounterScale(p.scaleXZ, p.scaleY);
    const fz = featureCounterScale(sz, 1).x;
    for (const a of this.featureAnchors) a.scaling.set(fc.x, fc.y, fz);
    // 體內星光：身體可見時持續閃爍
    this.inner.emitRate = p.bodyVisible ? 22 * p.opacity * this.ambientParticles : 0;
    if (this.jelly) {
      this.jelly.baseY = this.root.position.y + p.offsetY * (this.height / BODY_HEIGHT);
      this.jelly.strength = p.opacity;
    }

    const o = p.opacity;
    this.bodyMat.alpha = BODY_ALPHA * o;
    this.coreMat.alpha = CORE_ALPHA * o;
    this.starShellMat.alpha = STAR_SHELL_ALPHA * o;
    this.wingMat.alpha = WING_ALPHA * o;
    for (const m of this.faceMeshes) m.visibility = o;

    const glow = Math.max(0, Math.min(1, p.starGlow));
    const starVis = Math.min(1, glow * 1.2);
    for (const st of this.stars) st.visibility = starVis;
    // disableLighting 時輸出 = emissive × 頂點色，故 emissive 用中性亮度、顏色交給頂點色漸層
    const sk = 0.62 + 0.38 * glow;
    this.starMat.emissiveColor.set(sk, sk, sk);

    Color3.LerpToRef(BODY_EMISSIVE, FLASH, Math.max(0, Math.min(1, p.hitFlash)) * 0.8, this.bodyMat.emissiveColor);

    this.antenna.rotation.z = p.antennaSway * 0.5 * ANTENNA_SIDE;
    this.antenna.rotation.x = p.antennaSway * 0.3;
    this.wingL.rotation.z = 0.45 + p.wingFlap;
    this.wingR.rotation.z = -0.45 - p.wingFlap;

    this.setFace(p.face);

    this.ring.setEnabled(p.ringOpacity > 0.001);
    this.ring.scaling.setAll(Math.max(0.01, p.ringScale));
    this.ringMat.alpha = p.ringOpacity;

    const lift = Math.max(0, p.offsetY);
    const blobScale = Math.max(0.05, p.scaleXZ * (1 - lift * 0.8)) * (p.bodyVisible ? 1 : 0.5);
    this.blob.scaling.set(blobScale, 1, blobScale);
    this.blob.position.x = p.shakeX;
    this.blob.position.z = p.offsetZ;
    this.blobMat.alpha = Math.max(0, o * (1 - lift * 1.2));
  }

  playEffect(effect: MonsterEffect): void {
    switch (effect) {
      case "deathBurst":
        this.emit(this.burst, 80, 0.45);
        break;
      case "respawnStart":
        this.emit(this.rise, 70, 0.02);
        break;
      case "respawnPop":
        this.emit(this.burst, 35, 0.45);
        break;
      case "attackImpact":
        this.emit(this.burst, 12, 0.4, 0.75);
        break;
    }
  }

  update(dt: number): void {
    this.time += dt;
    const tex = this.coreMat.emissiveTexture;
    if (tex && "uOffset" in tex) (tex as { uOffset: number }).uOffset = (this.time * 0.015) % 1;
    const shellTex = this.starShellMat.emissiveTexture;
    if (shellTex && "uOffset" in shellTex) (shellTex as { uOffset: number }).uOffset = (1 - ((this.time * 0.028) % 1)) % 1;
  }

  dispose(): void {
    this.burst.dispose();
    this.inner.dispose();
    this.rise.dispose();
    this.root.dispose(false, true);
    for (const m of this.materials) m.dispose(true, true);
    for (const t of Object.values(this.faceTextures)) t.dispose();
  }

  // ======================= 建模 =======================

  private mat(name: string, diffuse: Color3): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = diffuse;
    m.specularColor = new Color3(0.15, 0.15, 0.15);
    this.materials.push(m);
    return m;
  }

  /** 以球體變形成水滴圓頂輪廓（保證法線朝外） */
  private createBodyMesh(name: string, scale: number, segments = 24): Mesh {
    const mesh = MeshBuilder.CreateSphere(name, { diameter: 2, segments, updatable: true }, this.scene);
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
    const idx = mesh.getIndices();
    if (!pos || !idx) throw new Error("bobo body data missing");
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i]!;
      const y = pos[i + 1]!;
      const z = pos[i + 2]!;
      const t = Math.acos(Math.max(-1, Math.min(1, -y))) / Math.PI;
      const rho = Math.hypot(x, z);
      const R = profileR(t) * scale;
      pos[i] = rho > 1e-6 ? (x / rho) * R : 0;
      pos[i + 1] = profileY(t) * scale;
      pos[i + 2] = rho > 1e-6 ? (z / rho) * R : 0;
    }
    const normals: number[] = [];
    VertexData.ComputeNormals(pos, idx, normals);
    mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
    mesh.updateVerticesData(VertexBuffer.NormalKind, normals);
    mesh.refreshBoundingInfo();
    mesh.parent = this.squash;
    return mesh;
  }

  /** 把零件貼在身體表面，面向法線 */
  private place(node: TransformNode, sp: ReturnType<typeof surfacePoint>, outward: number): void {
    node.parent = this.squash;
    node.position.set(sp.x + sp.nx * outward, sp.y + sp.ny * outward, sp.z + sp.nz * outward);
    const r = normalToRotation(sp.nx, sp.ny, sp.nz);
    node.rotation.set(r.x, r.y, 0);
  }

  /**
   * V2 臉部：一片貼合身體曲面的網格（每個頂點都在表面上），三種表情各一張手繪風貼圖。
   * 取代 V1 浮在表面的球體眼睛／圓盤嘴巴／管狀符號（約 16 個 draw call → 1 個）。
   */
  private buildFace(quality: "high" | "medium" | "low"): { material: StandardMaterial; textures: Record<FaceExpression, DynamicTexture> } {
    const sc = this.scene;
    const geo = buildFacePatch(quality === "low" ? 14 : 24, quality === "low" ? 18 : 32);
    const vd = new VertexData();
    vd.positions = geo.positions;
    vd.normals = geo.normals;
    vd.uvs = geo.uvs;
    vd.indices = geo.indices;
    const mesh = new Mesh("PH_boboFace", sc);
    vd.applyToMesh(mesh);
    mesh.parent = this.squash;
    mesh.alphaIndex = 3;
    mesh.isPickable = false;

    const tw = quality === "low" ? 512 : 1024;
    const th = faceTextureHeight(tw, geo.halfWidth);
    const make = (ex: FaceExpression): DynamicTexture => {
      const tex = new DynamicTexture(`PH_boboFace_${ex}`, { width: tw, height: th }, sc, true);
      paintFace(tex.getContext() as unknown as CanvasRenderingContext2D, tw, th, ex, geo.halfWidth);
      tex.hasAlpha = true;
      tex.wrapU = Texture.CLAMP_ADDRESSMODE;
      tex.wrapV = Texture.CLAMP_ADDRESSMODE;
      tex.anisotropicFilteringLevel = quality === "low" ? 1 : 4;
      tex.update(true);
      return tex;
    };
    const textures = { normal: make("normal"), angry: make("angry"), hurt: make("hurt") };

    const mat = this.mat("PH_boboFace", Color3.White());
    // 不受光：貼圖顏色即最終顏色（日系平塗五官），emissive × 貼圖
    mat.disableLighting = true;
    mat.emissiveColor = Color3.White();
    mat.diffuseTexture = textures.normal;
    mat.useAlphaFromDiffuseTexture = true;
    mat.backFaceCulling = true;
    mesh.material = mat;
    this.faceMeshes.push(mesh);
    return { material: mat, textures };
  }

  private createWing(side: number): TransformNode {
    const sp = surfacePoint(FACE_LAYOUT.wing.y, side * FACE_LAYOUT.wing.theta);
    const pivot = new TransformNode(`PH_boboWingPivot${side}`, this.scene);
    pivot.parent = this.squash;
    pivot.position.set(sp.x * 0.96, sp.y, sp.z * 0.96);
    // V2：翅膀寬面朝前外側（正面與側面都看得到圓潤的翼面，而非細刺）
    pivot.rotation.y = side * -0.55;
    // V2：圓潤的三瓣半透明小翅膀（依設定圖：大、中、小三片圓鰭向後上方展開，合併為單一網格）
    const lobes = [
      { len: 0.3, wid: 0.17, th: 0.035, rz: 0.32, dy: 0.03, dz: 0.004 },
      { len: 0.27, wid: 0.15, th: 0.032, rz: 0.02, dy: -0.01, dz: 0 },
      { len: 0.21, wid: 0.12, th: 0.03, rz: -0.3, dy: -0.04, dz: -0.004 },
    ];
    const parts = lobes.map((l, i) => {
      const f = this.createFin(`PH_boboWingLobe${side}_${i}`, side, l.len, l.wid, l.th, true);
      f.rotation.z = side * l.rz;
      f.position.set(0, l.dy, l.dz);
      return f;
    });
    const merged = Mesh.MergeMeshes(parts, true, true);
    if (!merged) throw new Error("bobo wing merge failed");
    merged.name = `PH_boboWing${side}`;
    merged.parent = pivot;
    merged.material = this.wingMat;
    merged.alphaIndex = 2;
    return pivot;
  }

  /** 水滴鰭：沿 x 軸（向外）延伸，根部寬圓、尖端收細並下彎 */
  private createFin(name: string, side: number, length: number, width: number, thickness: number, broadFace = false): Mesh {
    const fin = MeshBuilder.CreateSphere(name, { diameter: 1, segments: 14, updatable: true }, this.scene);
    const pos = fin.getVerticesData(VertexBuffer.PositionKind);
    const idx = fin.getIndices();
    if (!pos || !idx) throw new Error("fin data missing");
    for (let i = 0; i < pos.length; i += 3) {
      const u = pos[i]! + 0.5; // 0 = 根部、1 = 尖端
      const x = u * length;
      let y: number;
      let z: number;
      if (broadFace) {
        // V2 翼瓣：寬面在 x-y 平面、前後很薄；尖端保持圓（不收成刺）
        const taper = 1 - 0.3 * u * u;
        y = pos[i + 1]! * width * taper;
        z = pos[i + 2]! * thickness * (1 - 0.4 * u);
      } else {
        const taper = 1 - 0.65 * u * u; // 尖端收細
        y = pos[i + 1]! * thickness * taper - 0.06 * u * u; // 尖端微微下垂
        z = pos[i + 2]! * width * taper;
      }
      pos[i] = side * x;
      pos[i + 1] = y;
      pos[i + 2] = z;
    }
    // 左側為 x 鏡像，需翻轉三角形繞向，否則法線朝內、光照相反
    const indices = Array.from(idx);
    if (side < 0) {
      for (let i = 0; i < indices.length; i += 3) {
        const t = indices[i + 1]!;
        indices[i + 1] = indices[i + 2]!;
        indices[i + 2] = t;
      }
      fin.setIndices(indices);
    }
    const normals: number[] = [];
    VertexData.ComputeNormals(pos, indices, normals);
    fin.updateVerticesData(VertexBuffer.PositionKind, pos);
    fin.updateVerticesData(VertexBuffer.NormalKind, normals);
    fin.refreshBoundingInfo();
    return fin;
  }

  private createParticles(name: string, texture: ReturnType<typeof createSparkleTexture>, capacity: number): ParticleSystem {
    const ps = new ParticleSystem(name, capacity, this.scene);
    ps.particleTexture = texture;
    ps.color1 = new Color4(0.75, 0.88, 1, 1);
    ps.color2 = new Color4(1, 0.95, 0.65, 1);
    ps.colorDead = new Color4(0.5, 0.6, 1, 0);
    ps.minSize = 0.04 * (this.height / 0.8);
    ps.maxSize = 0.13 * (this.height / 0.8);
    ps.minLifeTime = 0.6;
    ps.maxLifeTime = 1.3;
    ps.emitRate = 0;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.minAngularSpeed = -2;
    ps.maxAngularSpeed = 2;
    ps.emitter = new Vector3();
    return ps;
  }

  private emit(ps: ParticleSystem, count: number, heightRatio: number, forward = 0): void {
    const origin = this.root.getAbsolutePosition();
    const fwd = this.root.forward;
    ps.emitter = new Vector3(origin.x + fwd.x * forward * this.height, origin.y + this.height * heightRatio, origin.z + fwd.z * forward * this.height);
    ps.manualEmitCount = count;
    if (!ps.isStarted()) ps.start();
  }

  setFace(face: MonsterFace): void {
    if (face === this.currentFace) return;
    this.currentFace = face;
    this.faceMat.diffuseTexture = this.faceTextures[face];
  }
}
