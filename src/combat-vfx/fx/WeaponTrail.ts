/**
 * 武器殘影（刀光）：每幀記錄刀身根部與刀尖的世界座標，組成一條帶狀網格；越舊越淡、越窄。
 * 段數依品質（高 22／中 14／低 8）；不使用時整條隱藏、不畫。
 */
import { Color3, Constants, Mesh, type Scene, StandardMaterial, type TransformNode, Vector3, VertexData } from "@babylonjs/core";
import { fxTexture } from "./textures.ts";

export class WeaponTrail {
  readonly mesh: Mesh;
  private readonly mat: StandardMaterial;
  private readonly n: number;
  private readonly base: Vector3[];
  private readonly tip: Vector3[];
  private readonly age: number[];
  private count = 0;
  private emitting = false;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private life: number;
  private readonly baseNode: TransformNode;
  private readonly tipNode: TransformNode;

  constructor(scene: Scene, baseNode: TransformNode, tipNode: TransformNode, segments: number, life: number, glow?: { addIncludedOnlyMesh(m: Mesh): void } | null) {
    this.baseNode = baseNode;
    this.tipNode = tipNode;
    this.n = Math.max(4, segments);
    this.life = life;
    this.base = Array.from({ length: this.n }, () => new Vector3());
    this.tip = Array.from({ length: this.n }, () => new Vector3());
    this.age = new Array<number>(this.n).fill(99);
    const vcount = this.n * 2;
    this.pos = new Float32Array(vcount * 3);
    this.col = new Float32Array(vcount * 4);
    const uv = new Float32Array(vcount * 2);
    const idx: number[] = [];
    for (let i = 0; i < this.n; i++) {
      uv[i * 4] = i / (this.n - 1);
      uv[i * 4 + 1] = 0;
      uv[i * 4 + 2] = i / (this.n - 1);
      uv[i * 4 + 3] = 1;
      if (i < this.n - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.mesh = new Mesh("weaponTrail", scene);
    const vd = new VertexData();
    vd.positions = this.pos;
    vd.colors = this.col;
    vd.uvs = uv;
    vd.indices = idx;
    vd.applyToMesh(this.mesh, true);
    this.mesh.hasVertexAlpha = true;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true; // 包圍盒每幀變動，避免被錯誤剔除
    this.mat = new StandardMaterial("weaponTrailMat", scene);
    this.mat.diffuseTexture = fxTexture(scene, "streak", 128);
    this.mat.useAlphaFromDiffuseTexture = true;
    this.mat.disableLighting = true;
    this.mat.backFaceCulling = false;
    this.mat.alphaMode = Constants.ALPHA_ADD;
    this.mat.disableDepthWrite = true;
    this.mat.specularColor = Color3.Black();
    this.mesh.material = this.mat;
    this.mesh.setEnabled(false);
    glow?.addIncludedOnlyMesh(this.mesh);
  }

  setColor(c: Color3): void {
    this.mat.diffuseColor.copyFrom(c);
  }

  setQuality(segments: number, life: number): void {
    // 段數在建立時決定；品質切換時由呼叫端重建。這裡只改壽命
    void segments;
    this.life = life;
  }

  start(): void {
    this.emitting = true;
    this.count = 0;
    this.age.fill(99);
    this.mesh.setEnabled(true);
  }

  stop(): void {
    this.emitting = false;
  }

  update(dt: number): void {
    if (!this.mesh.isEnabled()) return;
    for (let i = 0; i < this.count; i++) this.age[i] = (this.age[i] ?? 99) + dt;
    if (this.emitting) {
      // 往後推一格，最新的放在 0
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
    for (let i = 0; i < this.n; i++) {
      const k = i < this.count ? i : Math.max(0, this.count - 1);
      const a = this.age[k] ?? 99;
      const fade = Math.max(0, 1 - a / this.life) * (1 - i / this.n);
      if (fade > 0.01) alive = true;
      const b = this.base[k]!;
      const t = this.tip[k]!;
      // 根部往刀尖方向收窄（舊的越窄）
      const w = 0.25 + 0.75 * (1 - i / this.n);
      const bx = t.x + (b.x - t.x) * w;
      const by = t.y + (b.y - t.y) * w;
      const bz = t.z + (b.z - t.z) * w;
      this.pos.set([bx, by, bz, t.x, t.y, t.z], i * 6);
      this.col.set([1, 1, 1, fade * 0.6, 1, 1, 1, fade], i * 8);
    }
    this.mesh.updateVerticesData("position", this.pos, false, false);
    this.mesh.updateVerticesData("color", this.col, false, false);
    if (!alive && !this.emitting) this.mesh.setEnabled(false);
  }

  dispose(): void {
    this.mesh.dispose(false, true);
  }
}
