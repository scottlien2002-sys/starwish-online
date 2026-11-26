import type { AbstractMesh, Material, Scene, ShadowGenerator } from "@babylonjs/core";
import { villageAshlar, villageGlass, villageGold, villageProps, villageSlate } from "./villageMaterials.ts";

/**
 * Stage 6 P3-4 法師軍團「星詠之塔」：造型提案（只在獨立預覽頁使用；尚未接進村莊，整合等確認後）。
 *
 * 網格（GLB，依材質合併，每個 1 次繪製）：
 * - stone：暖白石牆（全村共用砌石貼圖 × 頂點色＋烘焙環境光遮蔽）
 * - roof：紫藍屋瓦（全村共用魚鱗瓦貼圖 × 頂點色）
 * - gold：金色尖頂、星環、門飾、團徽（HQ；Lite 畫在頂點色裡）
 * - props：大門、垂旗、團徽底（頂點色）
 * - glow：星詠台星晶、漂浮小晶石、窗玻璃、玫瑰窗、水晶燈（自發光 × 頂點色；不受光照、不投射陰影）
 * 只有 stone、roof 投射即時陰影（HQ）。不使用全畫面後製、不開 GlowLayer、無即時反射、無動態光源。
 */

export interface MageP3Options {
  lite: boolean;
  /** 共用貼圖資料夾（結尾含 /） */
  texBase: string;
  shadows?: ShadowGenerator | null;
}

export interface MageP3 {
  readonly stats: { meshes: number; triangles: number; byMesh: Record<string, number>; materials: number; shadowCasters: number; textureUrls: string[] };
  setEnabled(on: boolean): void;
  dispose(): void;
}

const KEYS = ["stone", "roof", "gold", "props", "glow"] as const;
const CASTERS = new Set(["stone", "roof"]);

export function setupMageP3(scene: Scene, meshes: AbstractMesh[], opt: MageP3Options): MageP3 {
  const hq = !opt.lite;
  const by: Partial<Record<(typeof KEYS)[number], AbstractMesh>> = {};
  for (const k of KEYS) {
    const m = meshes.find((x) => x.name.startsWith(`Mage_${k}`) && x.getTotalIndices() > 0);
    if (m) by[k] = m;
  }
  const mats: Material[] = [];
  const urls: string[] = [];
  const stone = villageAshlar(scene, opt.texBase, hq);
  const roof = villageSlate(scene, opt.texBase, hq);
  for (const m of [stone, roof]) for (const t of m.getActiveTextures()) urls.push(t.name);
  const assign: Record<string, Material> = { stone, roof, gold: villageGold(scene), props: villageProps(scene), glow: villageGlass(scene) };
  let casters = 0;
  for (const [k, m] of Object.entries(by) as [string, AbstractMesh][]) {
    const mat = assign[k];
    if (mat) m.material = mat;
    m.hasVertexAlpha = false;
    m.isPickable = false;
    m.receiveShadows = k !== "glow";
    if (opt.shadows && CASTERS.has(k)) {
      opt.shadows.addShadowCaster(m, false);
      casters++;
    }
  }
  const all = Object.values(by).filter((m): m is AbstractMesh => !!m);
  const byMesh: Record<string, number> = {};
  for (const [k, m] of Object.entries(by) as [string, AbstractMesh][]) byMesh[k] = Math.round(m.getTotalIndices() / 3);
  return {
    stats: {
      meshes: all.length,
      triangles: Object.values(byMesh).reduce((a, b) => a + b, 0),
      byMesh,
      materials: all.length,
      shadowCasters: casters,
      textureUrls: urls,
    },
    setEnabled(on) {
      for (const m of all) m.setEnabled(on);
    },
    dispose() {
      for (const m of mats) m.dispose(false, false);
    },
  };
}
