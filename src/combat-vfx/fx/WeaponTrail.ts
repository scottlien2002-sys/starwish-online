/**
 * 武器殘影 V2（多層刀光）：每幀記錄刀身根部與刀尖的世界座標，組成帶狀網格；越舊越淡、越窄。
 * 三層：
 *   1. 主色刀光（完整寬度，壽命 L）
 *   2. 白色核心（只有刀尖那一側 35%，壽命 0.55 L）→ 揮砍瞬間「刀鋒」的銳利感
 *   3. 殘像（略寬、很淡、壽命 1.8 L）→ 連段時前一刀的殘影還在
 * 其他玩家（lite）只畫第 1 層。段數依品質（高 22／中 14／低 8）；不使用時整條隱藏、不畫。
 */
import { Color3, Constants, Mesh, type Scene, StandardMaterial, type TransformNode, Vector3, VertexData } from "@babylonjs/core";
import { fxTexture } from "./textures.ts";

interface Layer {
  mesh: Mesh;
  mat: StandardMaterial;
  width: number;      // 0..1：從刀尖往根部的寬度比例
  lifeK: number;
  alpha: number;
  pos: Float32Array;
  col: Float32Array;
}

export class WeaponTrail {
  readonly mesh: Mesh;
  private readonly layers: Layer[] = [];
  private readonly n: number;
  private readonly base: Vector3[];
  private readonly tip: Vector3[];
  private readonly age: number[];
  private count = 0;
  private emitting = false;
  private life: number;
  private readonly baseNode: TransformNode;
  private readonly tipNode: TransformNode;
  private enabled = false;

  constructor(scene: Scene, baseNode: TransformNode, tipNode: TransformNode, segments: number, life: number, glow?: { addIncludedOnlyMesh(m: Mesh): void } | null, lite = false) {
    this.baseNode = baseNode;
    this.tipNode = tipNode;
    this.n = Math.max(4, segments);
    this.life = life;
    this.base = Array.from({ length: this.n }, () => new Vector3());
    this.tip = Array.from({ length: this.n }, () => new Vector3());
    this.age = new Array<number>(this.n).fill(99);
    const specs = lite ? [{ width: 1, lifeK: 1, alpha: 0.85 }] : [{ width: 1, lifeK: 1, alpha: 0.85 }, { width: 0.35, lifeK: 0.55, alpha: 1 }, { width: 1.12, lifeK: 1.8, alpha: 0.28 }];
    for (const [i, sp] of specs.entries()) {
      const vcount = this.n * 2;
      const pos = new Float32Array(vcount * 3);
      const col = new Float32Array(vcount * 4);
      const uv = new Float32Array(vcount * 2);
      const idx: number[] = [];
      for (let k = 0; k < this.n; k++) {
        uv[k * 4] = k / (this.n - 1);
        uv[k * 4 + 1] = 0;
        uv[k * 4 + 2] = k / (this.n - 1);
        uv[k * 4 + 3] = 1;
        if (k < this.n - 1) {
          const a = k * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const mesh = new Mesh(`weaponTrail${i}`, scene);
      const vd = new VertexData();
      vd.positions = pos;
      vd.colors = col;
      vd.uvs = uv;
      vd.indices = idx;
      vd.applyToMesh(mesh, true);
      mesh.hasVertexAlpha = true;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true; // 包圍盒每幀變動，避免被錯誤剔除
      const mat = new StandardMaterial(`weaponTrailMat${i}`, scene);
      mat.diffuseTexture = fxTexture(scene, "streak", 128);
      mat.useAlphaFromDiffuseTexture = true;
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mat.alphaMode = Constants.ALPHA_ADD;
      mat.disableDepthWrite = true;
      mat.specularColor = Color3.Black();
      mat.diffuseColor = Color3.Black();
      mat.emissiveColor = i === 1 ? new Color3(1, 1, 1) : new Color3(0.8, 0.9, 1);
      mesh.material = mat;
      mesh.setEnabled(false);
      glow?.addIncludedOnlyMesh(mesh);
      this.layers.push({ mesh, mat, width: sp.width, lifeK: sp.lifeK, alpha: sp.alpha, pos, col });
    }
    this.mesh = this.layers[0]!.mesh;
  }

  setColor(c: Color3): void {
    for (const [i, l] of this.layers.entries()) if (i !== 1) l.mat.emissiveColor.copyFrom(c);
  }

  /** 白天環境：一般混合＋飽和色（加算在亮背景上會被洗白） */
  setBright(bright: boolean): void {
    for (const [i, l] of this.layers.entries()) l.mat.alphaMode = bright && i !== 1 ? Constants.ALPHA_COMBINE : Constants.ALPHA_ADD;
  }

  setQuality(segments: number, life: number): void {
    void segments; // 段數在建立時決定；品質切換時由呼叫端重建。這裡只改壽命
    this.life = life;
  }

  start(): void {
    this.emitting = true;
    this.count = 0;
    this.age.fill(99);
    this.enabled = true;
    for (const l of this.layers) l.mesh.setEnabled(true);
  }

  stop(): void {
    this.emitting = false;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    for (let i = 0; i < this.count; i++) this.age[i] = (this.age[i] ?? 99) + dt;
    if (this.emitting) {
      for (let i = Math.min(this.count, this.n - 1); i > 0; i--) {
        this.base[i]!.copyFrom(this.base[i - 1]!);
        this.tip[i]!.copyFrom(this.tip[i - 1]!);
        this.age[i] = this.age[i - 1] ?? 99;
      }
      this.base[0]!.copyFrom(this.baseNode.getAbsolutePosition());
      this.tip[0]!.copyFrom(this.tipNode.getAbsolutePosition());
      this.age[0] = 0;
      this.count = Math.min(this.n, this.count + 1);
    }
    let alive = false;
    for (const L of this.layers) {
      const life = this.life * L.lifeK;
      for (let i = 0; i < this.n; i++) {
        const k = i < this.count ? i : Math.max(0, this.count - 1);
        const a = this.age[k] ?? 99;
        const fade = Math.max(0, 1 - a / life) * (1 - i / this.n);
        if (fade > 0.01) alive = true;
        const b = this.base[k]!;
        const t = this.tip[k]!;
        // 根部往刀尖方向收窄（舊的越窄）；width 決定從刀尖往根部取多少
        const w = Math.min(1.15, L.width * (0.25 + 0.75 * (1 - i / this.n)));
        L.pos.set([t.x + (b.x - t.x) * w, t.y + (b.y - t.y) * w, t.z + (b.z - t.z) * w, t.x, t.y, t.z], i * 6);
        L.col.set([1, 1, 1, fade * 0.75 * L.alpha, 1, 1, 1, fade * L.alpha], i * 8);
      }
      L.mesh.updateVerticesData("position", L.pos, false, false);
      L.mesh.updateVerticesData("color", L.col, false, false);
    }
    if (!alive && !this.emitting) {
      this.enabled = false;
      for (const l of this.layers) l.mesh.setEnabled(false);
    }
  }

  dispose(): void {
    for (const l of this.layers) l.mesh.dispose(false, true);
  }
}
