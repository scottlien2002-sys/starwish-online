import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, type ShadowGenerator } from "@babylonjs/core";
import { TUNING } from "../config/tuning.ts";
import { AttackAnimator, type AttackPose } from "./attackAnim.ts";

/**
 * 暫代角色：3.2 頭身 Q版比例，用基本幾何組成。
 * 這不是正式美術；正式角色將以 GLB 模型替換，介面（root / setWalk）維持不變。
 */
export class PlayerAvatar {
  readonly root: TransformNode;
  private readonly body: TransformNode;
  private readonly legL: TransformNode;
  private readonly legR: TransformNode;
  private readonly armL: TransformNode;
  private readonly armR: TransformNode;
  private readonly torso: Mesh;
  private phase = 0;
  private breath = 0;
  private walkAmount = 0;
  private readonly attackAnim = new AttackAnimator();
  private lastAttackPose: AttackPose = this.attackAnim.pose();

  constructor(scene: Scene, shadows: ShadowGenerator) {
    const H = TUNING.player.height;
    const headH = H / TUNING.player.headsTall; // 頭高 = 身高 / 3.2
    const headR = headH * 0.55; // Q版頭略寬
    const headCenterY = H - headH / 2;

    const mat = (name: string, c: Color3): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = c;
      m.specularColor = new Color3(0.08, 0.08, 0.08);
      return m;
    };
    const skin = mat("PH_skin", new Color3(1, 0.88, 0.8));
    const cloth = mat("PH_cloth", new Color3(0.55, 0.62, 1));
    const pants = mat("PH_pants", new Color3(0.36, 0.33, 0.55));
    const hair = mat("PH_hair", new Color3(0.98, 0.78, 0.45));
    const dark = mat("PH_eye", new Color3(0.15, 0.12, 0.25));
    const accent = mat("PH_accent", new Color3(1, 0.85, 0.35));

    this.root = new TransformNode("PH_player", scene);
    this.body = new TransformNode("PH_player_body", scene);
    this.body.parent = this.root;

    const meshes: Mesh[] = [];
    const add = (m: Mesh, parent: TransformNode, material: StandardMaterial): Mesh => {
      m.parent = parent;
      m.material = material;
      m.isPickable = false;
      meshes.push(m);
      return m;
    };

    const hipY = H * 0.27;
    const legLen = hipY;
    const makeLimb = (name: string, x: number, y: number, len: number, r: number, material: StandardMaterial): TransformNode => {
      const pivot = new TransformNode(name, scene);
      pivot.parent = this.body;
      pivot.position.set(x, y, 0);
      const limb = MeshBuilder.CreateCapsule(`${name}_mesh`, { height: len, radius: r, tessellation: 10 }, scene);
      limb.position.y = -len / 2 + r * 0.5;
      add(limb, pivot, material);
      return pivot;
    };

    this.legL = makeLimb("PH_legL", -0.085, hipY, legLen + 0.04, 0.075, pants);
    this.legR = makeLimb("PH_legR", 0.085, hipY, legLen + 0.04, 0.075, pants);

    const torsoTop = headCenterY - headR * 0.85;
    const torsoH = torsoTop - hipY + 0.06;
    const torso = (this.torso = MeshBuilder.CreateCapsule("PH_torso", { height: torsoH, radius: 0.17, tessellation: 12 }, scene));
    torso.position.y = hipY + torsoH / 2 - 0.04;
    add(torso, this.body, cloth);

    const belt = MeshBuilder.CreateTorus("PH_belt", { diameter: 0.34, thickness: 0.05, tessellation: 16 }, scene);
    belt.position.y = hipY + 0.06;
    add(belt, this.body, accent);

    const shoulderY = torsoTop - 0.05;
    this.armL = makeLimb("PH_armL", -0.22, shoulderY, 0.34, 0.06, cloth);
    this.armR = makeLimb("PH_armR", 0.22, shoulderY, 0.34, 0.06, cloth);
    this.armL.rotation.z = -0.18;
    this.armR.rotation.z = 0.18;

    const head = MeshBuilder.CreateSphere("PH_head", { diameter: headR * 2, segments: 16 }, scene);
    head.position.y = headCenterY;
    add(head, this.body, skin);

    const hairCap = MeshBuilder.CreateSphere("PH_hair", { diameter: headR * 2.14, segments: 16, slice: 0.56 }, scene);
    hairCap.position.set(0, headCenterY + 0.01, -0.015);
    add(hairCap, this.body, hair);

    const tuft = MeshBuilder.CreateSphere("PH_hairTuft", { diameter: headR * 0.7, segments: 8 }, scene);
    tuft.position.set(0.05, headCenterY + headR * 0.95, -0.02);
    tuft.scaling.set(0.8, 1.2, 0.8);
    add(tuft, this.body, hair);

    for (const sx of [-1, 1]) {
      const eye = MeshBuilder.CreateSphere(`PH_eye${sx}`, { diameter: headR * 0.3, segments: 8 }, scene);
      eye.scaling.set(0.8, 1.15, 0.5);
      eye.position.set(sx * headR * 0.36, headCenterY - headR * 0.08, headR * 0.9);
      add(eye, this.body, dark);
    }

    for (const m of meshes) shadows.addShadowCaster(m);
  }

  /** 開始一次普通攻擊動作（每次從蓄力重新開始，不疊加） */
  playAttack(): void {
    this.attackAnim.start();
  }

  /** 目前攻擊動作（測試與除錯用） */
  get attackPose(): AttackPose {
    return this.lastAttackPose;
  }

  get attacking(): boolean {
    return this.attackAnim.active;
  }

  /** 已開始的攻擊動作次數（測試用） */
  get attacksStarted(): number {
    return this.attackAnim.started;
  }

  /** speed01：0 = 站立，1 = 全速奔跑 */
  update(dt: number, speed01: number): void {
    this.walkAmount += (speed01 - this.walkAmount) * Math.min(1, dt * 12);
    this.phase += dt * (6 + 6 * this.walkAmount);
    this.breath += dt;
    const swing = Math.sin(this.phase) * 0.7 * this.walkAmount;
    const a = (this.lastAttackPose = this.attackAnim.update(dt));
    const w = a.weight;

    // 腿：走路擺動照常（移動中攻擊時腳步不停）
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    // 手：攻擊時右手由攻擊動作接管，左手在走路擺動上疊加平衡動作
    this.armL.rotation.x = -swing * 0.8 * (1 - w * 0.6) + a.armLX;
    this.armR.rotation.x = swing * 0.8 * (1 - w) + a.armRX;
    this.armR.rotation.z = 0.18 + a.armRZ;

    // 待機呼吸（約 3 秒一次）：身體微微起伏、胸口輕輕鼓起；走路時改為步伐彈跳
    const idle = 1 - this.walkAmount;
    const breathe = Math.sin(this.breath * 2.1);
    const bob = Math.abs(Math.sin(this.phase)) * 0.05 * this.walkAmount + breathe * 0.012 * idle;
    this.body.position.y = bob;
    this.torso.scaling.x = 1 + breathe * 0.025 * idle;
    this.torso.scaling.z = 1 + breathe * 0.025 * idle;
    // 攻擊：前傾、扭腰、向前踏
    this.body.rotation.x = a.lean;
    this.body.rotation.y = a.twist;
    this.body.position.z = a.lunge;
  }
}
