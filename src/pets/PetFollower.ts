/**
 * 星靈寵物跟隨（畫面）：裝備後在角色耳朵旁，以飛翔（鳥）或魔法漂浮（種子、精靈）方式跟隨。
 * 成長階段：初始、幼年期、成長期、完成體（stage 1～4；0 = 孵化中）。四個階段大小明顯不同（pets.json visual.stageSize），
 * 完成體約等於角色臉部大小。靈魂狀態（方案 B）：半透明、淡藍白色。
 * 各階段外觀先用簡單的程式模型預留（之後換正式模型只要替換 buildStage）。
 */
import { Color3, Mesh, MeshBuilder, Scalar, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";

export interface PetLook {
  species: string;
  stage: number;
  motion: "float" | "fly";
  /** 靈魂（死亡後，方案 B） */
  soul?: boolean;
}

/** 各階段高度（公尺）：未設定時用的預設值與 pets.json visual.stageSize 相同 */
export const DEFAULT_STAGE_SIZE: readonly number[] = [0.1, 0.075, 0.115, 0.16, 0.22];
/** 寵物外緣與頭部外緣（含頭髮、髮飾）之間的可見間距（公尺）：企劃 15～25 cm */
export const PET_GAP = 0.2;
/** 任何時候（轉身、衝刺）都不會比這更靠近頭部外緣 */
export const PET_MIN_GAP = 0.15;
/** 頭部側邊半寬的預設值（初心者 B5：男 0.32、女 0.33 含蝴蝶結） */
export const DEFAULT_HEAD_HALF_WIDTH = 0.33;
/** 程式模型在 scale = 1 時的大約高度（公尺） */
const BASE_HEIGHT = 0.17;

let SOUL = false;
function mat(scene: Scene, name: string, c: string, emissive = 0.35, alpha = 1): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const col = SOUL ? Color3.FromHexString("#cfe8ff") : Color3.FromHexString(c);
  if (SOUL) {
    alpha = 0.42;
    emissive = 0.9;
  }
  m.diffuseColor = col;
  m.emissiveColor = col.scale(emissive);
  m.specularColor = new Color3(0.15, 0.15, 0.15);
  m.alpha = alpha;
  return m;
}

/** 依種類與階段做出預留外觀（大小隨階段成長）；回傳根節點與需要拍動的翅膀 */
function buildStage(scene: Scene, look: PetLook): { root: TransformNode; wings: Mesh[]; spin: TransformNode | null } {
  const root = new TransformNode(`pet_${look.species}_${look.stage}`, scene);
  SOUL = !!look.soul;
  const s = 1; // 大小由 root.scaling 決定（各階段高度）
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
    const n = 1 + look.stage; // 葉子數隨階段增加（初始 2 片 → 完成體 5 片）
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
    if (look.stage >= 4) {
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
    if (look.stage >= 4) {
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
  private readonly center = new Vector3();
  private angle = 0;
  private radius = 0;
  private lastHalfWidth = DEFAULT_HEAD_HALF_WIDTH;
  private readonly lastHead = new Vector3();

  private readonly scene: Scene;
  private readonly stageSize: readonly number[];
  /** 目前外觀的高度（公尺；測試用） */
  size = 0;

  constructor(scene: Scene, stageSize: readonly number[] = DEFAULT_STAGE_SIZE) {
    this.scene = scene;
    this.stageSize = stageSize;
  }

  /** 換寵物或換階段時重建外觀；null = 沒有裝備 */
  setLook(look: PetLook | null): void {
    if (look && this.look && look.species === this.look.species && look.stage === this.look.stage && !!look.soul === !!this.look.soul) return;
    this.parts?.root.dispose(false, true);
    this.parts = look ? buildStage(this.scene, look) : null;
    this.look = look;
    this.size = look ? (this.stageSize[look.stage] ?? BASE_HEIGHT) : 0;
    if (this.parts) {
      const k = this.size / BASE_HEIGHT;
      this.parts.root.scaling.set(k, k, k);
      this.parts.root.position.copyFrom(this.position);
    }
  }

  get visible(): boolean {
    return !!this.parts;
  }

  /**
   * 頭部側邊跟隨（Stage 7.1）。
   * head：頭部中心、耳朵高度的世界座標（NoviceAvatar.petAnchor）；halfWidth：頭部（含頭髮、髮飾）側邊半寬；yaw：角色面向（0 = +z）。
   * 寵物中心放在角色右側：頭部外緣 + 可見間距 PET_GAP + 寵物半徑。
   * 以「繞頭部的角度＋距離」平滑跟隨：轉身時沿著圓弧繞過去，不會穿過頭；另外保證任何時候都不會靠近頭部外緣 PET_MIN_GAP 以內。
   */
  update(dt: number, head: Vector3, yaw: number, halfWidth = DEFAULT_HEAD_HALF_WIDTH): void {
    this.t += dt;
    if (!this.parts || !this.look) return;
    const fly = this.look.motion === "fly" && this.look.stage > 0;
    const r = halfWidth + PET_GAP + this.size * 0.5;
    const sway = Math.sin(this.t * 0.7) * 0.025;
    const bob = Math.sin(this.t * (fly ? 5.5 : 2.2)) * (fly ? 0.02 : 0.03);
    // 目標角度：角色右側（右 = (cos yaw, -sin yaw)），稍微偏後一點
    const back = 0.12 + sway / Math.max(0.3, r);
    const want = Math.atan2(-Math.sin(yaw), Math.cos(yaw)) - back; // atan2(z, x)
    if (!this.placed) {
      this.center.copyFrom(head);
      this.angle = want;
      this.radius = r;
      this.placed = true;
    }
    const kc = 1 - Math.exp(-dt * 12);
    Vector3.LerpToRef(this.center, head, kc, this.center);
    const ka = 1 - Math.exp(-dt * 5);
    this.angle = Scalar.LerpAngle(this.angle, want, ka);
    this.radius += (r - this.radius) * ka;
    const x = this.center.x + Math.cos(this.angle) * this.radius;
    const z = this.center.z + Math.sin(this.angle) * this.radius;
    // 保證間距：用「真正的」頭部位置檢查（中心跟隨有延遲）
    const dx = x - head.x;
    const dz = z - head.z;
    const d = Math.hypot(dx, dz);
    const min = halfWidth + PET_MIN_GAP + this.size * 0.5;
    if (d < min) {
      const k = min / Math.max(1e-4, d);
      this.position.set(head.x + dx * k, 0, head.z + dz * k);
    } else this.position.set(x, 0, z);
    this.position.y = this.center.y + 0.02 + bob;
    this.lastHalfWidth = halfWidth;
    this.lastHead.copyFrom(head);
    const root = this.parts.root;
    root.position.copyFrom(this.position);
    // 面向角色前方
    root.rotation.y = Scalar.LerpAngle(root.rotation.y, yaw, Math.min(1, dt * 3));
    if (this.parts.spin) this.parts.spin.rotation.y += dt * 1.2;
    const flap = Math.sin(this.t * 14) * 0.9;
    for (const w of this.parts.wings) w.rotation.z = (w.metadata as { side: number }).side * flap;
  }

  /** 寵物外緣到頭部外緣的水平間距（公尺；測試用） */
  get headGap(): number {
    if (!this.parts) return Number.NaN;
    return Math.hypot(this.position.x - this.lastHead.x, this.position.z - this.lastHead.z) - this.lastHalfWidth - this.size * 0.5;
  }

  dispose(): void {
    this.parts?.root.dispose(false, true);
    this.parts = null;
  }
}
