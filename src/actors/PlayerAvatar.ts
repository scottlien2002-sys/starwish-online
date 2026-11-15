import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, type ShadowGenerator } from "@babylonjs/core";
import { TUNING } from "../config/tuning.ts";

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
  private phase = 0;
  private walkAmount = 0;

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
    const torso = MeshBuilder.CreateCapsule("PH_torso", { height: torsoH, radius: 0.17, tessellation: 12 }, scene);
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

  /** speed01：0 = 站立，1 = 全速奔跑 */
  update(dt: number, speed01: number): void {
    this.walkAmount += (speed01 - this.walkAmount) * Math.min(1, dt * 12);
    this.phase += dt * (6 + 6 * this.walkAmount);
    const swing = Math.sin(this.phase) * 0.7 * this.walkAmount;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.8;
    this.armR.rotation.x = swing * 0.8;
    // 走路彈跳 + 站立呼吸
    const bob = Math.abs(Math.sin(this.phase)) * 0.05 * this.walkAmount + Math.sin(this.phase * 0.5) * 0.008 * (1 - this.walkAmount);
    this.body.position.y = bob;
  }
}
