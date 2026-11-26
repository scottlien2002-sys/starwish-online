import { type AbstractMesh, Color3, type DirectionalLight, DynamicTexture, Matrix, type Mesh, MeshBuilder, type Scene, type ShadowGenerator, StandardMaterial } from "@babylonjs/core";
import { casterInRange, shadowSpec, type ShadowMode } from "./villagePerf.ts";

/**
 * Stage 6.3 星芽村陰影管理（同一個 ShadowGenerator，不重建；各模組照舊呼叫 addShadowCaster）：
 * - 陰影模式：PCSS 2048（高取樣）／PCSS 1024（中取樣）／PCF 1024／PCF 512／柔和腳底陰影／關閉，可在執行中切換（效能診斷 A/B）
 * - 陰影投射物距離剔除：陰影範圍是跟著玩家的 44×44 m 正交盒（±22 m）；範圍外的建築與角色不畫進陰影貼圖
 *   （每 0.25 秒或玩家移動 2 m 重新篩選；新加入的投射物自動納入總表）
 * - 柔和腳底陰影：一張徑向漸層貼圖、一個網格（thin instance），玩家＋洛恩＋NPC 一次繪製
 */
export interface FootShadowSource {
  /** 世界座標（每幀讀取） */
  pos(): { x: number; y: number; z: number } | null;
  radius: number;
}

export class VillageShadows {
  readonly sg: ShadowGenerator;
  private readonly sun: DirectionalLight;
  private readonly scene: Scene;
  mode: ShadowMode;
  casterCull: boolean;
  /** 陰影投射物範圍（預設＝正交盒 ±22 m 的半對角線；中畫質 18 m） */
  range = 31.5;
  private readonly master: AbstractMesh[] = [];
  private readonly masterSet = new Set<AbstractMesh>();
  private lastCull = -1;
  private lastX = 1e9;
  private lastZ = 1e9;
  private blob: Mesh | null = null;
  private readonly sources: FootShadowSource[] = [];
  private blobBuf: Float32Array | null = null;
  private readonly tmp = Matrix.Identity();
  /** 最近一次篩選後的投射物數量（報告用） */
  activeCasters = 0;
  totalCasters = 0;

  constructor(scene: Scene, sun: DirectionalLight, sg: ShadowGenerator, mode: ShadowMode, casterCull: boolean) {
    this.scene = scene;
    this.sun = sun;
    this.sg = sg;
    this.mode = mode;
    this.casterCull = casterCull;
    this.apply(mode);
  }

  /** 切換陰影模式（不重建陰影產生器；貼圖大小用 resize） */
  apply(mode: ShadowMode): void {
    this.mode = mode;
    const sp = shadowSpec(mode);
    this.sun.shadowEnabled = sp.map;
    if (sp.map) {
      const map = this.sg.getShadowMap();
      if (map && map.getSize().width !== sp.size) map.resize(sp.size);
      if (sp.contact) {
        this.sg.usePercentageCloserFiltering = false;
        this.sg.useContactHardeningShadow = true;
        this.sg.contactHardeningLightSizeUVRatio = 0.04;
      } else {
        this.sg.useContactHardeningShadow = false;
        this.sg.usePercentageCloserFiltering = true;
      }
      this.sg.filteringQuality = sp.filtering === "high" ? 0 : sp.filtering === "medium" ? 1 : 2; // ShadowGenerator.QUALITY_HIGH / MEDIUM / LOW
    }
    if (this.blob) this.blob.setEnabled(sp.blobs);
  }

  addFootSource(src: FootShadowSource): void {
    this.sources.push(src);
    this.blobBuf = null;
  }

  private ensureBlob(): Mesh {
    if (this.blob) return this.blob;
    const tex = new DynamicTexture("PH_footShadowTex", { width: 64, height: 64 }, this.scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, "rgba(40,34,60,0.55)");
    g.addColorStop(0.55, "rgba(40,34,60,0.32)");
    g.addColorStop(1, "rgba(40,34,60,0)");
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    tex.hasAlpha = true;
    tex.update();
    const mat = new StandardMaterial("PH_footShadowMat", this.scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveColor = new Color3(0.16, 0.14, 0.24);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.zOffset = -2;
    const m = MeshBuilder.CreateGround("PH_footShadow", { width: 1, height: 1 }, this.scene);
    m.material = mat;
    m.isPickable = false;
    m.receiveShadows = false;
    m.alwaysSelectAsActiveMesh = true;
    m.setEnabled(shadowSpec(this.mode).blobs);
    this.blob = m;
    return m;
  }

  /** 每幀：陰影投射物距離剔除、腳底陰影位置 */
  update(now: number, px: number, pz: number): void {
    const sp = shadowSpec(this.mode);
    if (sp.blobs && this.sources.length) {
      const m = this.ensureBlob();
      const n = this.sources.length;
      if (!this.blobBuf || this.blobBuf.length !== n * 16) {
        this.blobBuf = new Float32Array(n * 16);
        m.thinInstanceSetBuffer("matrix", this.blobBuf, 16, false);
      }
      const tmp = this.tmp;
      for (let i = 0; i < n; i++) {
        const s = this.sources[i]!;
        const p = s.pos();
        const d = s.radius * 2;
        if (p) {
          Matrix.ScalingToRef(d, 1, d, tmp);
          tmp.setTranslationFromFloats(p.x, p.y + 0.03, p.z);
        } else Matrix.ScalingToRef(0, 0, 0, tmp);
        tmp.copyToArray(this.blobBuf, i * 16);
      }
      m.thinInstanceBufferUpdated("matrix");
    }
    if (!sp.map) return;
    const map = this.sg.getShadowMap();
    const list = map?.renderList;
    if (!list) return;
    for (const mm of list) {
      if (!this.masterSet.has(mm)) {
        this.masterSet.add(mm);
        this.master.push(mm);
      }
    }
    this.totalCasters = this.master.length;
    if (!this.casterCull) {
      if (list.length !== this.master.length) {
        list.length = 0;
        list.push(...this.master);
      }
      this.activeCasters = list.length;
      return;
    }
    if (now - this.lastCull < 0.25 && Math.hypot(px - this.lastX, pz - this.lastZ) < 2) return;
    this.lastCull = now;
    this.lastX = px;
    this.lastZ = pz;
    list.length = 0;
    for (const mm of this.master) {
      if (mm.isDisposed()) continue;
      const bs = mm.getBoundingInfo().boundingSphere;
      if (casterInRange(bs.centerWorld.x, bs.centerWorld.z, bs.radiusWorld, px, pz, this.range)) list.push(mm);
    }
    this.activeCasters = list.length;
  }

  /** 陰影貼圖這一幀實際要畫的投射物三角形數（報告用） */
  casterTriangles(): number {
    const list = this.sg.getShadowMap()?.renderList ?? [];
    return Math.round(list.reduce((a, m) => a + (m.isEnabled() && m.isVisible ? m.getTotalIndices() / 3 : 0), 0));
  }
}
