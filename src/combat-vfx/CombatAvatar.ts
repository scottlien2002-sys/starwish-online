/**
 * 戰鬥展示用初心者（已驗收的 C1.0-B5b 男女 GLB；不使用 Tripo 組裝角色）。
 * - 原有動畫：Idle／Run／Hurt／Death（GLB 內建）
 * - 技能動畫：novice_combat_<g>.json → 執行時建立 AnimationGroup（同一套 17 骨名稱，男女各自烘焙）
 * - 技能播放由 SkillTimeline 控制時間（goToFrame），動作、特效、傷害共用同一個時鐘；頓幀時整個角色停住
 * 一個 AssetContainer 可以生成多個角色（多人模擬用），每個角色有自己的骨架與動畫群組。
 */
import "@babylonjs/loaders/glTF";
import {
  type AbstractMesh,
  Animation,
  AnimationGroup,
  type AssetContainer,
  Color3,
  Mesh,
  MeshBuilder,
  Quaternion,
  type Scene,
  SceneLoader,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { GLTFFileLoader, GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF";
import { buildStaff, buildSword, attachWeapon, setWeaponVisible, type WeaponRig } from "./weapons.ts";
import type { WeaponKind } from "./core/skills.ts";
import { fxTexture } from "./fx/textures.ts";

export type Gender = "male" | "female";
/** hq／lite：自己的角色；remote：其他玩家（2 個 draw call 的合併版，見 tools/combat-vfx/make_remote_lod.py） */
export type Lod = "hq" | "lite" | "remote";

export interface CombatClipData {
  duration: number;
  fps: number;
  times: number[];
  rotations: Record<string, number[]>;
  hipsTranslation: number[];
  rootMotion: number[];
  marks: Record<string, number | number[]>;
}

export interface CombatAnimFile {
  format: string;
  gender: Gender;
  joints: string[];
  weaponAttach: { bone: string; bladeDir: number[]; edgeUp: number[] };
  clips: Record<string, CombatClipData>;
}

const BASE_CLIPS = ["Idle", "Run", "Hurt", "Death", "Jump", "Attack"] as const;
type BaseClip = (typeof BASE_CLIPS)[number];

const containers = new Map<string, Promise<AssetContainer>>();
const animFiles = new Map<string, Promise<CombatAnimFile>>();

export function loadNoviceContainer(scene: Scene, baseUrl: string, g: Gender, lod: Lod): Promise<AssetContainer> {
  const key = `${scene.uid}|${g}|${lod}`;
  let p = containers.get(key);
  if (!p) {
    p = (async () => {
      const obs = SceneLoader.OnPluginActivatedObservable.add((plugin) => {
        if (plugin instanceof GLTFFileLoader) plugin.animationStartMode = GLTFLoaderAnimationStartMode.NONE;
      });
      try {
        const c = await SceneLoader.LoadAssetContainerAsync(`${baseUrl}models/`, `novice_c10b5b_${g}_${lod}.glb`, scene);
        for (const a of c.animationGroups) a.stop();
        return c;
      } finally {
        SceneLoader.OnPluginActivatedObservable.remove(obs);
      }
    })();
    containers.set(key, p);
  }
  return p;
}

export function loadCombatAnims(baseUrl: string, g: Gender): Promise<CombatAnimFile> {
  let p = animFiles.get(g);
  if (!p) {
    p = fetch(`${baseUrl}combat-vfx/novice_combat_${g}.json`).then((r) => {
      if (!r.ok) throw new Error(`novice_combat_${g}.json ${r.status}`);
      return r.json() as Promise<CombatAnimFile>;
    });
    animFiles.set(g, p);
  }
  return p;
}

let seq = 0;

const blobMats = new Map<number, StandardMaterial>();
function blobMaterial(scene: Scene): StandardMaterial {
  const hit = blobMats.get(scene.uid as unknown as number);
  if (hit) return hit;
  const bm = new StandardMaterial("cblobMat", scene);
  bm.diffuseTexture = fxTexture(scene, "glowDisc", 64);
  bm.useAlphaFromDiffuseTexture = true;
  bm.diffuseColor = new Color3(0, 0, 0);
  bm.disableLighting = true;
  bm.alpha = 0.55;
  bm.zOffset = -2;
  blobMats.set(scene.uid as unknown as number, bm);
  return bm;
}

export class CombatAvatar {
  readonly id = ++seq;
  readonly root: TransformNode;
  readonly gender: Gender;
  readonly meshes: AbstractMesh[];
  readonly anims: CombatAnimFile;
  private readonly base = new Map<BaseClip, AnimationGroup>();
  private readonly skills = new Map<string, AnimationGroup>();
  private readonly nodes = new Map<string, TransformNode>();
  readonly sword: WeaponRig;
  readonly staff: WeaponRig;
  weapon: WeaponKind = "sword";
  private weights = new Map<AnimationGroup, number>();
  private current: AnimationGroup | null = null;
  private fade = 0.12;
  private skillGroup: AnimationGroup | null = null;
  readonly blob: Mesh;
  triangles = 0;
  /** 面向（Babylon rotation.y） */
  yaw = 0;

  readonly lod: Lod;
  private constructor(scene: Scene, container: AssetContainer, anims: CombatAnimFile, gender: Gender, lod: Lod) {
    this.lod = lod;
    this.gender = gender;
    this.anims = anims;
    this.root = new TransformNode(`cavatar_${this.id}`, scene);
    const inst = container.instantiateModelsToScene((n) => `${n}#${this.id}`, false, { doNotInstantiate: true });
    for (const r of inst.rootNodes) r.parent = this.root;
    this.meshes = this.root.getChildMeshes(false);
    for (const m of this.meshes) {
      m.isPickable = false;
      m.receiveShadows = false;
      this.triangles += Math.round((m.getTotalIndices() || 0) / 3);
    }
    for (const n of this.root.getChildTransformNodes(false)) {
      const nm = n.name.split("#")[0] ?? n.name;
      if (!this.nodes.has(nm)) this.nodes.set(nm, n);
    }
    for (const g of inst.animationGroups) {
      const nm = (g.name.split("#")[0] ?? g.name) as BaseClip;
      g.stop();
      if ((BASE_CLIPS as readonly string[]).includes(nm)) this.base.set(nm, g);
    }
    // 技能動畫
    for (const [name, clip] of Object.entries(anims.clips)) this.skills.set(name, this.buildGroup(scene, name, clip));
    // 武器
    const hand = this.nodes.get(anims.weaponAttach.bone);
    const simple = lod === "remote";
    this.sword = buildSword(scene, String(this.id), simple);
    this.staff = buildStaff(scene, String(this.id), simple);
    if (hand) {
      attachWeapon(this.sword, hand, anims.weaponAttach.bladeDir, anims.weaponAttach.edgeUp);
      attachWeapon(this.staff, hand, anims.weaponAttach.bladeDir, anims.weaponAttach.edgeUp);
    }
    setWeaponVisible(this.staff, false);
    // 腳下柔邊陰影（1 個 draw call）
    this.blob = MeshBuilder.CreateGround(`cblob_${this.id}`, { width: 0.9, height: 0.75 }, scene);
    this.blob.material = blobMaterial(scene);
    this.blob.isPickable = false;
    this.blob.parent = this.root;
    this.blob.position.y = 0.01;
    this.play("Idle", true, 0);
  }

  static async create(scene: Scene, baseUrl: string, g: Gender, lod: Lod): Promise<CombatAvatar> {
    const [c, a] = await Promise.all([loadNoviceContainer(scene, baseUrl, g, lod), loadCombatAnims(baseUrl, g)]);
    return new CombatAvatar(scene, c, a, g, lod);
  }

  private buildGroup(scene: Scene, name: string, clip: CombatClipData): AnimationGroup {
    const g = new AnimationGroup(`${name}#${this.id}`, scene);
    const fps = clip.fps;
    const n = clip.times.length;
    for (const [joint, arr] of Object.entries(clip.rotations)) {
      const node = this.nodes.get(joint);
      if (!node) continue;
      const a = new Animation(`${name}_${joint}`, "rotationQuaternion", fps, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CONSTANT);
      const keys: { frame: number; value: Quaternion }[] = [];
      for (let i = 0; i < n; i++) keys.push({ frame: (clip.times[i] ?? 0) * fps, value: new Quaternion(arr[4 * i] ?? 0, arr[4 * i + 1] ?? 0, arr[4 * i + 2] ?? 0, arr[4 * i + 3] ?? 1) });
      a.setKeys(keys);
      g.addTargetedAnimation(a, node);
    }
    const hips = this.nodes.get("hips");
    if (hips) {
      const a = new Animation(`${name}_hipsT`, "position", fps, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
      const h = clip.hipsTranslation;
      const keys: { frame: number; value: Vector3 }[] = [];
      for (let i = 0; i < n; i++) keys.push({ frame: (clip.times[i] ?? 0) * fps, value: new Vector3(h[3 * i] ?? 0, h[3 * i + 1] ?? 0, h[3 * i + 2] ?? 0) });
      a.setKeys(keys);
      g.addTargetedAnimation(a, hips);
    }
    g.normalize(0, clip.duration * fps);
    return g;
  }

  clip(name: string): CombatClipData | undefined {
    return this.anims.clips[name];
  }

  setWeapon(k: WeaponKind): void {
    this.weapon = k;
    setWeaponVisible(this.sword, k === "sword");
    setWeaponVisible(this.staff, k === "staff");
  }

  get weaponRig(): WeaponRig {
    return this.weapon === "sword" ? this.sword : this.staff;
  }

  /** 一般動作（Idle／Run／Hurt／Death）；fade 秒數淡入淡出 */
  play(name: BaseClip, loop: boolean, fade = 0.12, ratio = 1): void {
    const g = this.base.get(name);
    if (!g) return;
    this.skillGroup = null;
    if (this.current === g && g.isPlaying) {
      g.speedRatio = ratio;
      return;
    }
    g.stop();
    g.start(loop, ratio, g.from, g.to, false);
    if (!this.weights.has(g)) this.weights.set(g, 0);
    this.current = g;
    this.fade = fade;
    if (fade <= 0) for (const k of [...this.weights.keys()]) this.weights.set(k, k === g ? 1 : 0);
    this.applyWeights();
  }

  get baseState(): string {
    return this.current?.name.split("#")[0] ?? "";
  }

  /** 開始技能動作：之後每幀呼叫 setSkillTime(t) */
  startSkill(clipName: string, fade = 0.08): AnimationGroup | null {
    const g = this.skills.get(clipName);
    if (!g) return null;
    g.stop();
    g.start(false, 1, g.from, g.to, false);
    g.pause();
    g.goToFrame(0);
    if (!this.weights.has(g)) this.weights.set(g, 0);
    this.current = g;
    this.skillGroup = g;
    this.fade = fade;
    this.applyWeights();
    return g;
  }

  /** 技能時間（片段秒數）→ 動作畫面 */
  setSkillTime(t: number): void {
    const g = this.skillGroup;
    if (!g) return;
    const fps = g.targetedAnimations[0]?.animation.framePerSecond ?? 30;
    g.goToFrame(Math.min(g.to, Math.max(g.from, t * fps)));
  }

  /** 頓幀：一般動作暫停（技能動作由時間軸停住） */
  freeze(on: boolean): void {
    if (this.current && this.current !== this.skillGroup) this.current.speedRatio = on ? 0 : 1;
  }

  private applyWeights(): void {
    for (const [g, w] of this.weights) g.setWeightForAllAnimatables(w);
  }

  update(dt: number): void {
    const cur = this.current;
    const rate = this.fade > 0 ? dt / this.fade : 1;
    for (const [g, w] of [...this.weights]) {
      const target = g === cur ? 1 : 0;
      const nw = target > w ? Math.min(1, w + rate) : Math.max(0, w - rate);
      this.weights.set(g, nw);
      if (nw <= 0.001 && g !== cur) {
        if (g.isPlaying || g.isStarted) g.stop();
        this.weights.delete(g);
      } else g.setWeightForAllAnimatables(nw);
    }
    this.root.rotation.y = this.yaw;
  }

  /** 胸口高度（命中點、特效錨點） */
  chest(out = new Vector3()): Vector3 {
    const c = this.nodes.get("chest");
    if (c) return out.copyFrom(c.getAbsolutePosition());
    return out.copyFrom(this.root.position).addInPlaceFromFloats(0, 0.55, 0);
  }

  dispose(): void {
    for (const g of [...this.base.values(), ...this.skills.values()]) g.dispose();
    // 材質是共用的（GLB 容器、武器、陰影），只釋放網格與節點
    for (const w of [this.sword, this.staff]) w.root.dispose(false, false);
    this.root.dispose(false, false);
  }
}
