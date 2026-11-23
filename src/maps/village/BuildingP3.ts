import type { AbstractMesh, Material, Scene, ShadowGenerator } from "@babylonjs/core";
import { villageAshlar, villageGlass, villageGold, villageLimestone, villageProps, villageSlate } from "./villageMaterials.ts";

/**
 * Stage 6 P3-5 起的星芽村建築共用材質設定（劍士軍團、北側高台…；只在獨立預覽頁使用，尚未接進村莊）。
 * GLB 網格名稱為「<前綴>_<部位>」，部位對應全村共用材質：
 * - stone：暖白砌石（共用貼圖 × 頂點色＋烘焙環境光遮蔽）
 * - roof：魚鱗瓦（共用貼圖 × 頂點色；各建築顏色由頂點色決定）
 * - paving：石灰岩石板（與廣場同一材質）
 * - gold：全村共用金
 * - props：門、窗、旗、雕像（頂點色）
 * - glow：水晶、發光窗（自發光 × 頂點色；不受光、不投射陰影）
 * 只有 casters 列出的部位投射即時陰影。不使用全畫面後製、GlowLayer、即時反射、動態光源。
 */
export interface BuildingP3Options {
  lite: boolean;
  texBase: string;
  shadows?: ShadowGenerator | null;
  casters?: readonly string[];
}

export interface BuildingP3 {
  readonly stats: { meshes: number; triangles: number; byMesh: Record<string, number>; materials: number; shadowCasters: number; textureUrls: string[] };
  setEnabled(on: boolean): void;
}

const KEYS = ["stone", "roof", "paving", "gold", "props", "glow"] as const;

export function setupBuildingP3(scene: Scene, meshes: AbstractMesh[], prefix: string, opt: BuildingP3Options): BuildingP3 {
  const hq = !opt.lite;
  const casters = new Set(opt.casters ?? ["stone", "roof"]);
  const mat: Record<(typeof KEYS)[number], () => Material> = {
    stone: () => villageAshlar(scene, opt.texBase, hq),
    roof: () => villageSlate(scene, opt.texBase, hq),
    paving: () => villageLimestone(scene, opt.texBase, hq),
    gold: () => villageGold(scene),
    props: () => villageProps(scene),
    glow: () => villageGlass(scene),
  };
  const byMesh: Record<string, number> = {};
  const all: AbstractMesh[] = [];
  const urls = new Set<string>();
  let nCast = 0;
  for (const k of KEYS) {
    const m = meshes.find((x) => x.name.startsWith(`${prefix}_${k}`) && x.getTotalIndices() > 0);
    if (!m) continue;
    const mm = mat[k]();
    m.material = mm;
    for (const t of mm.getActiveTextures()) urls.add(t.name);
    m.hasVertexAlpha = false;
    m.isPickable = false;
    m.receiveShadows = k !== "glow";
    if (opt.shadows && casters.has(k)) {
      opt.shadows.addShadowCaster(m, false);
      nCast++;
    }
    byMesh[k] = Math.round(m.getTotalIndices() / 3);
    all.push(m);
  }
  return {
    stats: { meshes: all.length, triangles: Object.values(byMesh).reduce((a, b) => a + b, 0), byMesh, materials: all.length, shadowCasters: nCast, textureUrls: [...urls] },
    setEnabled(on) {
      for (const m of all) m.setEnabled(on);
    },
  };
}
