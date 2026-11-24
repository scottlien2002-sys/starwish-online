import "@babylonjs/loaders/glTF";
import {
  type AbstractMesh,
  type AnimationGroup,
  type Bone,
  Color3,
  DynamicTexture,
  type Mesh,
  MeshBuilder,
  PBRMaterial,
  type Scene,
  SceneLoader,
  StandardMaterial,
  type ShadowGenerator,
  type CubeTexture,
  type BaseTexture,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { AnimStateMachine, ANIM_NAMES, ONE_SHOT, type AnimName } from "../actors/animState.ts";
import { animClock, ANIM_TIMING, attackPlaybackRate } from "../actors/animTiming.ts";

/**
 * 初心者角色（C1.0-B5 候選 GLB：17 骨骼＋Idle／Run／Jump／Attack／Hurt）的遊戲端介面。
 * 給星芽原野整合用：移動速度、攻擊（含攻速倍率與命中事件）、受傷、跳躍、頭頂錨點（寵物、名牌）與角色陰影。
 * 這一層只管「看起來」：位置、碰撞、傷害結算仍由遊戲系統決定，再把結果餵進來。
 */
export type NoviceGender = "male" | "female";
export type NoviceLod = "hq" | "lite";
export type CharShadowMode = "blob" | "realtime";
export type AvatarEvent = { type: "hit"; attackId: number } | { type: "attackEnd"; attackId: number } | { type: "land" } | { type: "hurtEnd" };

export interface AvatarFrameInput {
  /** 實際水平移動速度（公尺／秒）。> 0.05 視為移動中，跑步動畫會依速度調整播放倍率，減少滑步 */
  speed: number;
  jump?: boolean;
  attack?: boolean;
  hurt?: boolean;
}

export function noviceFile(g: NoviceGender, lod: NoviceLod, version = "c10b5"): string {
  return `novice_${version}_${g}_${lod}.glb`;
}

export class NoviceAvatar {
  readonly root: TransformNode;
  readonly meshes: AbstractMesh[];
  readonly groups = new Map<AnimName, AnimationGroup>();
  readonly sm: AnimStateMachine;
  readonly triangles: number;
  readonly file: string;
  /** 目前跑步播放倍率（除錯顯示） */
  runRate = 1;
  /** 攻速（遊戲屬性；100 = 基礎 0.5 秒）。只影響攻擊動作播放速度與命中時間點 */
  private attackSpeed = 100;
  private attackRate = 1;
  private attackId = 0;
  private hitFired = false;
  private wasAirborne = false;
  private readonly weights = new Map<AnimName, number>();
  private readonly listeners: ((e: AvatarEvent) => void)[] = [];
  private readonly headBone: Bone | null;
  private readonly skinnedRef: AbstractMesh | null;
  private blob: Mesh | null = null;
  private readonly tmp = new Vector3();

  private constructor(scene: Scene, file: string, res: Awaited<ReturnType<typeof SceneLoader.ImportMeshAsync>>) {
    this.file = file;
    this.root = new TransformNode("player", scene);
    // glTF 的 __root__ 保留左右手座標轉換，不要改它；移動、轉向都在 player 這一層
    (res.meshes[0] as AbstractMesh).parent = this.root;
    this.meshes = res.meshes;
    for (const m of res.meshes) {
      m.isPickable = false;
      m.receiveShadows = false;
    }
    for (const ag of res.animationGroups) {
      const a = ANIM_NAMES.find((n) => ag.name === n || ag.name.endsWith(n));
      if (a) this.groups.set(a, ag);
      ag.stop();
    }
    this.triangles = res.meshes.reduce((a, m) => a + Math.round((m.getTotalIndices() || 0) / 3), 0);
    this.headBone = res.skeletons[0]?.bones.find((b) => b.name === "head") ?? null;
    this.skinnedRef = res.meshes.find((m) => !!m.skeleton) ?? null;
    const durations = Object.fromEntries([...this.groups].map(([n, g]) => [n, (g.to - g.from) / 60])) as Partial<Record<AnimName, number>>;
    this.sm = new AnimStateMachine(durations);
    for (const n of ANIM_NAMES) this.weights.set(n, n === "Idle" ? 1 : 0);
    this.play("Idle");
  }

  static async load(scene: Scene, opts: { gender: NoviceGender; lod: NoviceLod; baseUrl: string; version?: string }): Promise<NoviceAvatar> {
    const file = noviceFile(opts.gender, opts.lod, opts.version);
    const res = await SceneLoader.ImportMeshAsync("", opts.baseUrl, file, scene);
    return new NoviceAvatar(scene, file, res);
  }

  get bones(): number {
    return this.skinnedRef?.skeleton?.bones.length ?? 0;
  }

  get skinnedMeshes(): number {
    return this.meshes.filter((m) => !!m.skeleton).length;
  }

  get state(): AnimName {
    return this.sm.state;
  }

  on(fn: (e: AvatarEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** 攻速改變時呼叫（裝備、寵物加成後的最終值；上限 160 由屬性系統負責） */
  setAttackSpeed(v: number): void {
    this.attackSpeed = v;
    this.attackRate = attackPlaybackRate(v);
    this.sm.setDuration("Attack", ANIM_TIMING.attack.seconds / this.attackRate);
  }

  getAttackTiming(): { rate: number; seconds: number; hitAt: number; attackSpeed: number } {
    return { rate: this.attackRate, seconds: ANIM_TIMING.attack.seconds / this.attackRate, hitAt: ANIM_TIMING.attack.hit / this.attackRate, attackSpeed: this.attackSpeed };
  }

  /** 金屬材質（金邊、徽章）沒有環境貼圖會發黑：給一張只拍天空的反射圖 */
  setMetalReflection(tex: CubeTexture | BaseTexture | null): void {
    if (!tex) return;
    for (const m of this.meshes) {
      const mat = m.material;
      if (mat instanceof PBRMaterial && mat.metallic != null && mat.metallic > 0.3) mat.reflectionTexture = tex;
    }
  }

  /**
   * 角色陰影：
   * - blob（預設）：腳下一片柔邊圓形陰影（1 個 draw call），角色不進陰影貼圖 → 環境陰影只需要畫一次
   * - realtime：角色加入即時陰影貼圖（每格重畫陰影，較吃 GPU；用來對照）
   */
  setupShadow(mode: CharShadowMode, scene: Scene, sg: ShadowGenerator | null): void {
    if (mode === "realtime" && sg) {
      for (const m of this.meshes) if (m.getTotalVertices() > 0) sg.addShadowCaster(m, false);
      return;
    }
    const size = 64;
    const tex = new DynamicTexture("charBlobTex", size, scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(0,0,0,0.42)");
    g.addColorStop(0.55, "rgba(0,0,0,0.25)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    tex.update();
    tex.hasAlpha = true;
    const mat = new StandardMaterial("charBlobMat", scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.disableLighting = true;
    mat.emissiveColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.backFaceCulling = false;
    mat.zOffset = -2;
    const blob = MeshBuilder.CreateGround("charBlob", { width: 0.62, height: 0.5 }, scene);
    blob.material = mat;
    blob.isPickable = false;
    blob.receiveShadows = true;
    blob.alphaIndex = 10;
    this.blob = blob;
  }

  /** 頭頂錨點（世界座標）：頭骨起點在脖子上方，往上 0.55 m 約是頭頂 */
  headAnchor(out = new Vector3()): Vector3 {
    if (this.headBone && this.skinnedRef) {
      this.headBone.getAbsolutePositionToRef(this.skinnedRef, this.tmp);
      return out.set(this.tmp.x, this.tmp.y + 0.55, this.tmp.z);
    }
    return out.set(this.root.position.x, this.root.position.y + 1.25, this.root.position.z);
  }

  /** 跳躍目前的離地高度（公尺），由遊戲端加到角色的 y */
  jumpHeight(): number {
    return this.sm.jumpHeight(ANIM_TIMING.jump.height);
  }

  /**
   * 每格呼叫。groundY：腳下地面高度（陰影會貼在這裡）。
   * 回傳本格的離地高度，讓遊戲端設定 root.position.y = groundY + 回傳值。
   */
  update(dt: number, input: AvatarFrameInput, groundY: number): number {
    const moving = input.speed > 0.05;
    const before = this.sm.state;
    const t0 = this.sm.time;
    this.sm.update(dt, { moving, jump: input.jump, attack: input.attack, hurt: input.hurt });
    const restarted = ONE_SHOT[this.sm.state] && this.sm.time < t0 && this.sm.state === before;
    if (this.sm.state !== before || restarted) {
      if (before === "Attack" && this.sm.state !== "Attack") this.emit({ type: "attackEnd", attackId: this.attackId });
      if (before === "Hurt" && this.sm.state !== "Hurt") this.emit({ type: "hurtEnd" });
      if (this.sm.state === "Attack") {
        this.attackId++;
        this.hitFired = false;
      }
      this.play(this.sm.state);
    }
    // 命中事件：攻擊動作播到 hit 時間點（基礎 0.2 秒，攻速越快越早）
    if (this.sm.state === "Attack" && !this.hitFired && this.sm.time >= ANIM_TIMING.attack.hit / this.attackRate) {
      this.hitFired = true;
      this.emit({ type: "hit", attackId: this.attackId });
    }
    // 跑步：依實際速度調整播放倍率（步幅固定，速度越快踩得越快），減少滑步
    const clock = animClock(this.sm.state, input.speed, this.attackRate);
    this.runRate = clock.runRate;
    const g = this.groups.get(this.sm.state);
    if (g) g.speedRatio = clock.rate;
    this.blendWeights(dt);
    const h = this.jumpHeight();
    if (this.wasAirborne && h === 0) this.emit({ type: "land" });
    this.wasAirborne = h > 0;
    if (this.blob) {
      // 陰影貼地；跳起時變小、變淡
      const k = Math.max(0.55, 1 - h * 1.2);
      this.blob.position.set(this.root.position.x, groundY + 0.015, this.root.position.z);
      this.blob.rotation.y = this.root.rotation.y;
      this.blob.scaling.set(k, 1, k);
      this.blob.visibility = 0.55 + 0.45 * k;
    }
    return h;
  }

  dispose(): void {
    for (const g of this.groups.values()) g.dispose();
    for (const m of this.meshes) m.dispose();
    this.blob?.dispose(false, true);
    this.root.dispose();
  }

  private play(n: AnimName): void {
    const g = this.groups.get(n);
    if (!g) return;
    g.stop();
    g.start(!ONE_SHOT[n], 1, g.from, g.to, false);
    g.setWeightForAllAnimatables(this.weights.get(n) ?? 0);
  }

  private blendWeights(dt: number): void {
    for (const n of ANIM_NAMES) {
      const w = this.weights.get(n)!;
      const target = n === this.sm.state ? 1 : 0;
      const nw = w + (target - w) * Math.min(1, dt / ANIM_TIMING.crossfade);
      this.weights.set(n, nw);
      const g = this.groups.get(n);
      if (!g) continue;
      if (nw < 0.01 && n !== this.sm.state) {
        if (g.isPlaying) g.stop();
      } else g.setWeightForAllAnimatables(nw);
    }
  }

  private emit(e: AvatarEvent): void {
    for (const fn of [...this.listeners]) fn(e);
  }
}
