/**
 * 星靈寵物跟隨（畫面）：裝備後出現在角色頭部附近，以飛翔（鳥）或魔法漂浮（種子、精靈）方式跟隨。
 * 各階段外觀先用簡單的程式模型預留（之後換正式模型只要替換 buildStage）。
 */
import { Color3, Mesh, MeshBuilder, Scalar, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";

export interface PetLook {
  species: string;
  stage: number;
  motion: "float" | "fly";
}

function mat(scene: Scene, name: string, c: string, emissive = 0.35, alpha = 1): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const col = Color3.FromHexString(c);
  m.diffuseColor = col;
  m.emissiveColor = col.scale(emissive);
  m.specularColor = new Color3(0.15, 0.15, 0.15);
  m.alpha = alpha;
  return m;
}

/** 依種類與階段做出預留外觀（大小隨階段成長）；回傳根節點與需要拍動的翅膀 */
function buildStage(scene: Scene, look: PetLook): { root: TransformNode; wings: Mesh[]; spin: TransformNode | null } {
  const root = new TransformNode(`pet_${look.species}_${look.stage}`, scene);
  const s = [0.55, 0.7, 0.85, 1.0][look.stage] ?? 1;
  const wings: Mesh[] = [];
  let spin: TransformNode | null = null;
  const add = (m: Mesh): Mesh => {
    m.parent = root;
    m.isPickable = false;
    return m;
  };
  if (look.stage === 0) {
    // 未孵化：種子（綠色水滴）或蛋（星點蛋殼），跟著漂浮
    if (look.species === "sprout") {
      const seed = add(MeshBuilder.CreateSphere("seed", { diameter: 0.12, segments: 12 }, scene));
      seed.scaling.set(0.8, 1.15, 0.8);
      seed.material = mat(scene, "seedM", "#7fc36a", 0.3);
    } else {
      const egg = add(MeshBuilder.CreateSphere("egg", { diameter: 0.14, segments: 14 }, scene));
      egg.scaling.set(0.85, 1.12, 0.85);
      egg.material = mat(scene, "eggM", look.species === "bird" ? "#f3e3b6" : "#c9b8f5", 0.35);
      const dot = add(MeshBuilder.CreateSphere("eggDot", { diameter: 0.03, segments: 6 }, scene));
      dot.position.set(0.035, 0.03, -0.05);
      dot.material = mat(scene, "eggDotM", "#ffd75e", 0.8);
    }
    return { root, wings, spin };
  }
  if (look.species === "sprout") {
    const body = add(MeshBuilder.CreateSphere("sproutBody", { diameter: 0.16 * s, segments: 14 }, scene));
    body.material = mat(scene, "sproutBodyM", "#a8e07a", 0.35);
    const n = 1 + look.stage; // 葉子數隨階段增加
    spin = new TransformNode("sproutLeaves", scene);
    spin.parent = root;
    for (let i = 0; i < n; i++) {
      const leaf = MeshBuilder.CreateDisc("leaf", { radius: 0.07 * s, tessellation: 10 }, scene);
      leaf.parent = spin;
      leaf.isPickable = false;
      leaf.scaling.set(0.55, 1, 1);
      const a = (i / n) * Math.PI * 2;
      leaf.position.set(Math.cos(a) * 0.04 * s, 0.1 * s, Math.sin(a) * 0.04 * s);
      leaf.rotation.set(-0.9, a, 0);
      leaf.material = mat(scene, "leafM", "#58b85a", 0.3);
      (leaf.material as StandardMaterial).backFaceCulling = false;
    }
    if (look.stage >= 3) {
      const flower = add(MeshBuilder.CreateSphere("flower", { diameter: 0.07, segments: 10 }, scene));
      flower.position.y = 0.16;
      flower.material = mat(scene, "flowerM", "#ffd75e", 0.9);
    }
  } else if (look.species === "wisp") {
    const core = add(MeshBuilder.CreateSphere("wispCore", { diameter: 0.14 * s, segments: 16 }, scene));
    core.material = mat(scene, "wispCoreM", "#bfa8ff", 0.8, 0.92);
    spin = new TransformNode("wispSparks", scene);
    spin.parent = root;
    const n = 2 + look.stage;
    for (let i = 0; i < n; i++) {
      const sp = MeshBuilder.CreateSphere("spark", { diameter: 0.03, segments: 6 }, scene);
      sp.parent = spin;
      sp.isPickable = false;
      const a = (i / n) * Math.PI * 2;
      sp.position.set(Math.cos(a) * 0.13 * s, Math.sin(a * 2) * 0.03, Math.sin(a) * 0.13 * s);
      sp.material = mat(scene, "sparkM", "#fff2a8", 1.0);
    }
  } else {
    // 鳥：圓身體＋頭＋喙＋兩片翅膀（階段越高越大、成鳥有尾羽）
    const body = add(MeshBuilder.CreateSphere("birdBody", { diameter: 0.15 * s, segments: 14 }, scene));
    body.scaling.set(1, 0.9, 1.15);
    body.material = mat(scene, "birdBodyM", "#7ec8f2", 0.3);
    const head = add(MeshBuilder.CreateSphere("birdHead", { diameter: 0.09 * s, segments: 12 }, scene));
    head.position.set(0, 0.06 * s, -0.06 * s);
    head.material = body.material;
    const beak = add(MeshBuilder.CreateCylinder("beak", { diameterTop: 0, diameterBottom: 0.025 * s, height: 0.04 * s, tessellation: 6 }, scene));
    beak.rotation.x = -Math.PI / 2;
    beak.position.set(0, 0.055 * s, -0.11 * s);
    beak.material = mat(scene, "beakM", "#ffb347", 0.4);
    for (const sx of [1, -1]) {
      const w = MeshBuilder.CreateDisc("wing", { radius: 0.08 * s, tessellation: 12 }, scene);
      w.parent = root;
      w.isPickable = false;
      w.scaling.set(1, 0.5, 1);
      w.position.set(0.06 * s * sx, 0.02, 0);
      w.rotation.set(Math.PI / 2, 0, 0);
      w.setPivotPoint(new Vector3(-0.07 * s * sx, 0, 0));
      w.material = mat(scene, "wingM", "#bfe6ff", 0.4);
      (w.material as StandardMaterial).backFaceCulling = false;
      w.metadata = { side: sx };
      wings.push(w);
    }
    if (look.stage >= 3) {
      const tail = add(MeshBuilder.CreateCylinder("tail", { diameterTop: 0.06, diameterBottom: 0, height: 0.09, tessellation: 3 }, scene));
      tail.rotation.x = Math.PI / 2.4;
      tail.position.set(0, 0.02, 0.1);
      tail.material = mat(scene, "tailM", "#ffd75e", 0.6);
    }
  }
  return { root, wings, spin };
}

export class PetFollower {
  private parts: { root: TransformNode; wings: Mesh[]; spin: TransformNode | null } | null = null;
  private look: PetLook | null = null;
  private t = 0;
  readonly position = new Vector3();
  private placed = false;

  private readonly scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /** 換寵物或換階段時重建外觀；null = 沒有裝備 */
  setLook(look: PetLook | null): void {
    if (look && this.look && look.species === this.look.species && look.stage === this.look.stage) return;
    this.parts?.root.dispose(false, true);
    this.parts = look ? buildStage(this.scene, look) : null;
    this.look = look;
    if (this.parts) this.parts.root.position.copyFrom(this.position);
  }

  get visible(): boolean {
    return !!this.parts;
  }

  /** head：角色頭頂的世界座標；yaw：角色面向（弧度，0 = +z） */
  update(dt: number, head: Vector3, yaw: number): void {
    this.t += dt;
    if (!this.parts || !this.look) return;
    const fly = this.look.motion === "fly" && this.look.stage > 0;
    // 目標：頭部右後上方，繞頭慢慢轉一點；漂浮上下擺動
    const orbit = yaw + Math.PI * 0.75 + Math.sin(this.t * 0.6) * 0.35;
    const r = 0.38;
    const bob = Math.sin(this.t * (fly ? 5.5 : 2.2)) * (fly ? 0.03 : 0.045);
    const target = new Vector3(head.x + Math.sin(orbit) * r, head.y + 0.18 + bob, head.z + Math.cos(orbit) * r);
    if (!this.placed) {
      this.position.copyFrom(target);
      this.placed = true;
    }
    const k = 1 - Math.exp(-dt * 4.5); // 平滑跟隨（不會瞬間貼上）
    Vector3.LerpToRef(this.position, target, k, this.position);
    const root = this.parts.root;
    root.position.copyFrom(this.position);
    // 面向移動方向（沒什麼移動時面向角色前方）
    root.rotation.y = Scalar.LerpAngle(root.rotation.y, yaw, Math.min(1, dt * 3));
    if (this.parts.spin) this.parts.spin.rotation.y += dt * 1.2;
    const flap = Math.sin(this.t * 14) * 0.9;
    for (const w of this.parts.wings) w.rotation.z = (w.metadata as { side: number }).side * flap;
  }

  dispose(): void {
    this.parts?.root.dispose(false, true);
    this.parts = null;
  }
}
