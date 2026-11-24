import { type AbstractMesh, Color3, Constants, type Nullable, type Observer, type Scene, type ShadowGenerator, StandardMaterial, TransformNode } from "@babylonjs/core";
import { type BuildingP3, setupBuildingP3 } from "./BuildingP3.ts";
import { ARRIVAL_PORTAL } from "./layout.ts";

/**
 * Stage 6 P3-8 四座傳送門＋南門拱門＋道路嵌飾（只在獨立預覽頁使用，尚未接進村莊）。
 * - 靜態部位（Portal_stone/paving/gold/props/glow）沿用 setupBuildingP3 的全村共用材質
 * - 開放中的南方傳送門另有兩個動態網格：Portal_fx（光柱，加法混合）與 Portal_rune（漂浮符文環）；
 *   頂點以門中心為原點，執行時掛到門中心的節點上旋轉、呼吸發光（每幀只改 2 個節點角度＋2 個顏色）
 * - 北、東、西＝未開放：沒有動態效果（休眠、低亮度）；位置、開放狀態與目的地全部沿用 layout.ts，不新增出口
 */
export interface PortalP3 extends BuildingP3 {
  readonly fxStats: { fxTris: number; runeTris: number; animated: number };
  /** 測試用：固定時間（null＝恢復播放） */
  freeze(t: number | null): void;
  dispose(): void;
}

export function setupPortalsP3(scene: Scene, meshes: AbstractMesh[], opt: { lite: boolean; texBase: string; shadows?: ShadowGenerator | null }): PortalP3 {
  const base = setupBuildingP3(scene, meshes, "Portal", { lite: opt.lite, texBase: opt.texBase, shadows: opt.shadows ?? null, casters: ["stone"] });
  const fx = meshes.find((m) => m.name.startsWith("Portal_fx") && m.getTotalIndices() > 0);
  const rune = meshes.find((m) => m.name.startsWith("Portal_rune") && m.getTotalIndices() > 0);
  const hq = !opt.lite;

  const mk = (name: string, c: Color3): StandardMaterial => {
    const m = new StandardMaterial(name, scene);
    m.disableLighting = true;
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = c.clone();
    m.alphaMode = Constants.ALPHA_ADD;
    m.disableDepthWrite = true;
    m.backFaceCulling = false;
    return m;
  };
  const fxBase = hq ? new Color3(0.85, 0.9, 1.0) : new Color3(0.6, 0.66, 0.82);
  const runeBase = hq ? new Color3(1.0, 1.0, 1.0) : new Color3(0.75, 0.75, 0.8);
  const fxMat = mk("VP3P_fx", fxBase);
  const runeMat = mk("VP3P_rune", runeBase);

  const pivots: TransformNode[] = [];
  const mount = (m: AbstractMesh | undefined, mat: StandardMaterial): TransformNode | null => {
    if (!m) return null;
    m.setParent(null);
    const p = new TransformNode(`${m.name}_pivot`, scene);
    p.position.set(ARRIVAL_PORTAL.x, ARRIVAL_PORTAL.floor, ARRIVAL_PORTAL.z);
    m.parent = p;
    m.position.set(0, 0, 0);
    m.material = mat;
    m.hasVertexAlpha = false;
    m.isPickable = false;
    m.receiveShadows = false;
    pivots.push(p);
    return p;
  };
  const fxPivot = ARRIVAL_PORTAL.open ? mount(fx, fxMat) : null;
  const runePivot = ARRIVAL_PORTAL.open ? mount(rune, runeMat) : null;

  let t = 0;
  let fixed: number | null = null;
  const obs: Nullable<Observer<Scene>> = scene.onBeforeRenderObservable.add(() => {
    if (fixed === null) t += Math.min(scene.getEngine().getDeltaTime() / 1000, 0.1);
    const tt = fixed ?? t;
    if (fxPivot) fxPivot.rotation.y = tt * 0.25;
    if (runePivot) {
      runePivot.rotation.y = -tt * 0.4;
      runePivot.position.y = ARRIVAL_PORTAL.floor + 0.05 * Math.sin(tt * 1.3);
    }
    const fp = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(tt * 1.8));
    fxMat.emissiveColor.copyFromFloats(fxBase.r * fp, fxBase.g * fp, fxBase.b * fp);
    const rp = 0.8 + 0.2 * Math.sin(tt * 2.6);
    runeMat.emissiveColor.copyFromFloats(runeBase.r * rp, runeBase.g * rp, runeBase.b * rp);
  });

  const tri = (m?: AbstractMesh): number => (m ? Math.round(m.getTotalIndices() / 3) : 0);
  return {
    stats: { ...base.stats, triangles: base.stats.triangles + tri(fx) + tri(rune), byMesh: { ...base.stats.byMesh, fx: tri(fx), rune: tri(rune) }, meshes: base.stats.meshes + (fx ? 1 : 0) + (rune ? 1 : 0), materials: base.stats.materials + 2 },
    fxStats: { fxTris: tri(fx), runeTris: tri(rune), animated: pivots.length },
    setEnabled(on) {
      base.setEnabled(on);
      fx?.setEnabled(on);
      rune?.setEnabled(on);
    },
    freeze(v) {
      fixed = v;
    },
    dispose() {
      scene.onBeforeRenderObservable.remove(obs);
      fxMat.dispose();
      runeMat.dispose();
      for (const p of pivots) p.dispose();
    },
  };
}
