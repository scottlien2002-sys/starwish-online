import {
  Color3,
  Color4,
  Curve3,
  FresnelParameters,
  type GlowLayer,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Scene,
  type ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import type { MonsterEffect, MonsterFace, MonsterPose, MonsterView } from "../anim/types.ts";
import { createPuffyStar } from "../meshes/star.ts";
import { BODY_HEIGHT, FACE_LAYOUT, featureCounterScale, normalToRotation, profileR, profileY, surfacePoint } from "./shape.ts";
import { createBlobShadowTexture, createGalaxyTexture, createSparkleTexture } from "./textures.ts";

export interface BoboModelOptions {
  /** 模型高度（公尺），預設 0.8 */
  height?: number;
  shadows?: ShadowGenerator;
  glow?: GlowLayer;
  seed?: number;
}

// V1.1：更透明、自發光降低，讓體內星空透出來
const BODY_ALPHA = 0.5;
const CORE_ALPHA = 0.95;
const WING_ALPHA = 0.38;
const BODY_EMISSIVE = new Color3(0.1, 0.2, 0.5);
const FLASH = new Color3(0.95, 0.95, 1);

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
  private readonly faces: Record<MonsterFace, TransformNode[]>;
  private readonly brows: TransformNode[] = [];
  private readonly burst: ParticleSystem;
  private readonly rise: ParticleSystem;
  private readonly materials: StandardMaterial[] = [];
  private readonly height: number;
  private currentFace: MonsterFace | null = null;
  private time = 0;

  constructor(scene: Scene, options: BoboModelOptions = {}) {
    this.scene = scene;
    this.height = options.height ?? 0.8;
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
    this.bodyMat = this.mat("PH_boboBody", new Color3(0.5, 0.72, 1));
    this.bodyMat.emissiveColor = BODY_EMISSIVE.clone();
    // V1.1：高光改為柔和、較寬、較暗（原本 0.9 / 64 會在中央形成刺眼白點）
    this.bodyMat.specularColor = new Color3(0.28, 0.32, 0.38);
    this.bodyMat.specularPower = 18;
    this.bodyMat.alpha = BODY_ALPHA;
    // 透明層次：中心約 30%、邊緣 100% → 中間通透、輪廓清楚的果凍感
    const opacityFresnel = new FresnelParameters();
    opacityFresnel.leftColor = Color3.White();
    opacityFresnel.rightColor = new Color3(0.3, 0.3, 0.3);
    opacityFresnel.bias = 0.05;
    opacityFresnel.power = 1.8;
    this.bodyMat.opacityFresnelParameters = opacityFresnel;
    // 柔和邊緣反光（模擬果凍表面反射天空）
    const emissiveFresnel = new FresnelParameters();
    emissiveFresnel.leftColor = new Color3(0.55, 0.75, 1);
    emissiveFresnel.rightColor = Color3.Black();
    emissiveFresnel.bias = 0.15;
    emissiveFresnel.power = 2;
    this.bodyMat.emissiveFresnelParameters = emissiveFresnel;

    const galaxy = createGalaxyTexture(scene, options.seed ?? 11);
    this.coreMat = this.mat("PH_boboCore", Color3.Black());
    this.coreMat.emissiveTexture = galaxy;
    this.coreMat.disableLighting = true;
    this.coreMat.alpha = CORE_ALPHA;
    this.coreMat.alphaMode = 1; // ALPHA_ADD

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

    this.starMat = this.mat("PH_boboStar", new Color3(1, 0.9, 0.35));
    this.starMat.emissiveColor = new Color3(1, 0.86, 0.3);
    this.starMat.disableLighting = true;
    this.starMat.backFaceCulling = false;

    // ---------- 身體 ----------
    const body = this.createBodyMesh("PH_boboBody", 1);
    body.material = this.bodyMat;
    body.alphaIndex = 2;
    const core = this.createBodyMesh("PH_boboCore", 0.84);
    core.position.y = 0.07;
    core.material = this.coreMat;
    core.alphaIndex = 1;

    // ---------- 臉 ----------
    this.faces = { normal: [], angry: [], hurt: [] };
    this.buildFace();

    // ---------- 胸前星星 ----------
    const chest = surfacePoint(FACE_LAYOUT.chestStar.y, FACE_LAYOUT.chestStar.theta);
    const chestStar = createPuffyStar("PH_boboChestStar", scene, 0.11, 0.05, 0.035);
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
    const path = Curve3.CreateCatmullRomSpline(
      [
        new Vector3(0, 0, 0),
        new Vector3(0, 0.17, -0.04),
        new Vector3(0.08, 0.35, 0),
        new Vector3(0.22, 0.43, 0.07),
        new Vector3(0.36, 0.39, 0.13),
        new Vector3(0.42, 0.29, 0.16),
      ],
      6,
    ).getPoints();
    const stalk = MeshBuilder.CreateTube(
      "PH_boboStalk",
      {
        path,
        tessellation: 10,
        cap: Mesh.CAP_ALL,
        radiusFunction: (i: number) => 0.05 - (0.026 * i) / Math.max(1, path.length - 1),
      },
      scene,
    );
    stalk.parent = this.antenna;
    stalk.material = this.bodyMat;
    stalk.alphaIndex = 2;
    const headStar = createPuffyStar("PH_boboHeadStar", scene, 0.15, 0.07, 0.05);
    headStar.parent = this.antenna;
    headStar.position.set(0.44, 0.24, 0.17);
    headStar.rotation.set(0, 0.25, -0.35);
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
    }

    this.setFace("normal");
  }

  // ======================= MonsterView =======================

  applyPose(p: MonsterPose): void {
    this.motion.setEnabled(p.bodyVisible);
    this.motion.position.set(p.shakeX, p.offsetY, p.offsetZ);
    this.motion.rotation.x = p.lean;
    this.squash.scaling.set(p.scaleXZ, p.scaleY, p.scaleXZ);
    // V1.1：五官跟著身體表面移動，但自身形狀不被壓扁
    const fc = featureCounterScale(p.scaleXZ, p.scaleY);
    for (const a of this.featureAnchors) a.scaling.set(fc.x, fc.y, fc.z);
    // 體內星光：身體可見時持續閃爍
    this.inner.emitRate = p.bodyVisible ? 16 * p.opacity : 0;

    const o = p.opacity;
    this.bodyMat.alpha = BODY_ALPHA * o;
    this.coreMat.alpha = CORE_ALPHA * o;
    this.wingMat.alpha = WING_ALPHA * o;
    for (const m of this.faceMeshes) m.visibility = o;

    const glow = Math.max(0, Math.min(1, p.starGlow));
    const starVis = Math.min(1, glow * 1.2);
    for (const st of this.stars) st.visibility = starVis;
    this.starMat.emissiveColor.set(1 * (0.6 + 0.4 * glow), 0.86 * (0.6 + 0.4 * glow), 0.3 * (0.6 + 0.4 * glow));

    Color3.LerpToRef(BODY_EMISSIVE, FLASH, Math.max(0, Math.min(1, p.hitFlash)) * 0.8, this.bodyMat.emissiveColor);

    this.antenna.rotation.z = -p.antennaSway * 0.5;
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
  }

  dispose(): void {
    this.burst.dispose();
    this.inner.dispose();
    this.rise.dispose();
    this.root.dispose(false, true);
    for (const m of this.materials) m.dispose(true, true);
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
  private createBodyMesh(name: string, scale: number): Mesh {
    const mesh = MeshBuilder.CreateSphere(name, { diameter: 2, segments: 28, updatable: true }, this.scene);
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

  private part(name: string, mesh: Mesh, parent: TransformNode, material: StandardMaterial, x: number, y: number, z: number): Mesh {
    mesh.parent = parent;
    mesh.position.set(x, y, z);
    mesh.material = material;
    this.faceMeshes.push(mesh);
    return mesh;
  }

  private buildFace(): void {
    const sc = this.scene;
    const navy = this.mat("PH_boboEye", new Color3(0.06, 0.1, 0.32));
    navy.specularColor = new Color3(0.6, 0.6, 0.7);
    navy.specularPower = 48;
    const iris = this.mat("PH_boboIris", new Color3(0.18, 0.45, 1));
    iris.emissiveColor = new Color3(0.08, 0.2, 0.55);
    const white = this.mat("PH_boboHighlight", Color3.White());
    white.emissiveColor = Color3.White();
    white.disableLighting = true;
    const blush = this.mat("PH_boboBlush", new Color3(1, 0.55, 0.65));
    blush.emissiveColor = new Color3(0.55, 0.22, 0.3);
    blush.alpha = 0.75;
    blush.backFaceCulling = false;
    const mouth = this.mat("PH_boboMouth", new Color3(0.86, 0.3, 0.42));
    mouth.emissiveColor = new Color3(0.3, 0.06, 0.12);
    mouth.backFaceCulling = false;
    const tongue = this.mat("PH_boboTongue", new Color3(1, 0.55, 0.62));
    tongue.backFaceCulling = false;

    const EYE_Y = FACE_LAYOUT.eye.y;
    const EYE_THETA = FACE_LAYOUT.eye.theta;
    for (const side of [-1, 1]) {
      const anchor = new TransformNode(`PH_boboEyeAnchor${side}`, sc);
      this.place(anchor, surfacePoint(EYE_Y, side * EYE_THETA), 0.0);
      this.featureAnchors.push(anchor);

      // 一般眼睛：深藍大眼 + 下方亮藍 + 兩個高光
      const normal = new TransformNode(`PH_boboEyeNormal${side}`, sc);
      normal.parent = anchor;
      const ball = this.part(`PH_boboEyeBall${side}`, MeshBuilder.CreateSphere("e", { diameter: 1, segments: 12 }, sc), normal, navy, 0, 0, 0);
      ball.scaling.set(0.19, 0.24, 0.07);
      const ir = this.part(`PH_boboIris${side}`, MeshBuilder.CreateSphere("i", { diameter: 1, segments: 10 }, sc), normal, iris, 0, -0.055, 0.022);
      ir.scaling.set(0.13, 0.09, 0.04);
      const h1 = this.part(`PH_boboHL1${side}`, MeshBuilder.CreateSphere("h", { diameter: 1, segments: 8 }, sc), normal, white, -0.035, 0.05, 0.03);
      h1.scaling.set(0.075, 0.075, 0.03);
      const h2 = this.part(`PH_boboHL2${side}`, MeshBuilder.CreateSphere("h", { diameter: 1, segments: 6 }, sc), normal, white, 0.04, -0.045, 0.03);
      h2.scaling.set(0.035, 0.035, 0.02);
      this.faces.normal.push(normal);
      this.faces.angry.push(normal);

      // 受傷：> < 閉眼
      const hurt = new TransformNode(`PH_boboEyeHurt${side}`, sc);
      hurt.parent = anchor;
      const dir = -side; // 左眼 >、右眼 <
      const chevron = MeshBuilder.CreateTube(
        `PH_boboHurt${side}`,
        { path: [new Vector3(-0.06 * dir, 0.06, 0.02), new Vector3(0.06 * dir, 0, 0.02), new Vector3(-0.06 * dir, -0.06, 0.02)], radius: 0.016, tessellation: 6, cap: Mesh.CAP_ALL },
        sc,
      );
      this.part(chevron.name, chevron, hurt, navy, 0, 0, 0);
      this.faces.hurt.push(hurt);

      // 生氣：斜眉
      const brow = new TransformNode(`PH_boboBrow${side}`, sc);
      brow.parent = anchor;
      const browMesh = MeshBuilder.CreateTube(
        `PH_boboBrowMesh${side}`,
        { path: [new Vector3(-0.08 * side, 0.17, 0.02), new Vector3(0.07 * side, 0.12, 0.03)], radius: 0.016, tessellation: 6, cap: Mesh.CAP_ALL },
        sc,
      );
      this.part(browMesh.name, browMesh, brow, navy, 0, 0, 0);
      this.brows.push(brow);

      // 腮紅
      const bl = MeshBuilder.CreateDisc(`PH_boboBlush${side}`, { radius: 0.06, tessellation: 20, sideOrientation: Mesh.DOUBLESIDE }, sc);
      const bAnchor = new TransformNode(`PH_boboBlushAnchor${side}`, sc);
      this.place(bAnchor, surfacePoint(FACE_LAYOUT.blush.y, side * FACE_LAYOUT.blush.theta), 0.012);
      this.featureAnchors.push(bAnchor);
      this.part(bl.name, bl, bAnchor, blush, 0, 0, 0).scaling.set(1.45, 0.85, 1);
      bl.alphaIndex = 3;
    }

    // 嘴巴：張開的笑口（半圓）+ 舌頭
    const mAnchor = new TransformNode("PH_boboMouthAnchor", sc);
    this.place(mAnchor, surfacePoint(FACE_LAYOUT.mouth.y, FACE_LAYOUT.mouth.theta), 0.012);
    this.featureAnchors.push(mAnchor);
    const m = MeshBuilder.CreateDisc("PH_boboMouth", { radius: 0.075, arc: 0.5, tessellation: 20, sideOrientation: Mesh.DOUBLESIDE }, sc);
    this.part(m.name, m, mAnchor, mouth, 0, 0, 0).rotation.z = Math.PI;
    const tg = MeshBuilder.CreateDisc("PH_boboTongue", { radius: 0.04, arc: 0.5, tessellation: 12, sideOrientation: Mesh.DOUBLESIDE }, sc);
    this.part(tg.name, tg, mAnchor, tongue, 0, -0.04, 0.004);
  }

  private createWing(side: number): TransformNode {
    const sp = surfacePoint(FACE_LAYOUT.wing.y, side * FACE_LAYOUT.wing.theta);
    const pivot = new TransformNode(`PH_boboWingPivot${side}`, this.scene);
    pivot.parent = this.squash;
    pivot.position.set(sp.x * 0.96, sp.y, sp.z * 0.96);
    pivot.rotation.y = side * -0.25;
    // V1.1：單片柔和的水滴鰭（根部圓、尖端收細並微微下垂），取代兩顆橢圓
    const main = this.createFin(`PH_boboWing${side}`, side, 0.36, 0.2, 0.07);
    main.parent = pivot;
    main.material = this.wingMat;
    main.alphaIndex = 2;
    // 後方較小的第二層，做出半透明疊層感
    const back = this.createFin(`PH_boboWingBack${side}`, side, 0.26, 0.15, 0.05);
    back.parent = pivot;
    back.position.set(side * 0.02, -0.03, -0.06);
    back.material = this.wingMat;
    back.alphaIndex = 2;
    return pivot;
  }

  /** 水滴鰭：沿 x 軸（向外）延伸，根部寬圓、尖端收細並下彎 */
  private createFin(name: string, side: number, length: number, width: number, thickness: number): Mesh {
    const fin = MeshBuilder.CreateSphere(name, { diameter: 1, segments: 14, updatable: true }, this.scene);
    const pos = fin.getVerticesData(VertexBuffer.PositionKind);
    const idx = fin.getIndices();
    if (!pos || !idx) throw new Error("fin data missing");
    for (let i = 0; i < pos.length; i += 3) {
      const u = pos[i]! + 0.5; // 0 = 根部、1 = 尖端
      const taper = 1 - 0.65 * u * u; // 尖端收細
      const x = u * length;
      const y = pos[i + 1]! * thickness * taper - 0.06 * u * u; // 尖端微微下垂
      const z = pos[i + 2]! * width * taper;
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

  private setFace(face: MonsterFace): void {
    if (face === this.currentFace) return;
    this.currentFace = face;
    const show = new Set(this.faces[face]);
    for (const n of [...this.faces.normal, ...this.faces.hurt]) n.setEnabled(show.has(n));
    for (const b of this.brows) b.setEnabled(face === "angry");
  }
}
