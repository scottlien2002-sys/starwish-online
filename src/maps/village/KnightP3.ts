import type { AbstractMesh, Material, Scene, ShadowGenerator } from "@babylonjs/core";
import { villageAshlar, villageGold, villageProps, villageSlate } from "./villageMaterials.ts";

/**
 * Stage 6 P3-2B 騎士軍團：材質設定（只在獨立預覽頁使用；尚未接進村莊，整合等確認後）。
 *
 * 網格（GLB，依材質合併，每個 1 次繪製）：
 * - stone：暖白石牆（共用石紋貼圖 × 頂點色＋烘焙環境光遮蔽；HQ 加 512 法線）
 * - roof：深藍屋瓦（共用屋瓦貼圖 × 頂點色；HQ 加 512 法線，略有光澤）
 * - gold：騎士團徽、金尖頂、門飾（HQ；Lite 畫在頂點色裡）
 * - props：大門、窗玻璃、旗幟、雕像（頂點色）
 * 不使用全畫面後製、不開 GlowLayer、無即時反射；石牆與屋頂貼圖全村共用（見 villageTextures.ts）。
 */

export interface KnightP3Options {
  lite: boolean;
  /** 共用貼圖資料夾（結尾含 /） */
  texBase: string;
  shadows?: ShadowGenerator | null;
}

export interface KnightP3 {
  readonly stats: { meshes: number; triangles: number; byMesh: Record<string, number>; materials: number; shadowCasters: number; textureUrls: string[] };
  setEnabled(on: boolean): void;
  dispose(): void;
}

const KEYS = ["stone", "roof", "gold", "props"] as const;

export function setupKnightP3(scene: Scene, meshes: AbstractMesh[], opt: KnightP3Options): KnightP3 {
  const hq = !opt.lite;
  const by: Partial<Record<(typeof KEYS)[number], AbstractMesh>> = {};
  for (const k of KEYS) {
    const m = meshes.find((x) => x.name.startsWith(`Knight_${k}`) && x.getTotalIndices() > 0);
    if (m) by[k] = m;
  }
  const mats: Material[] = [];
  const urls: string[] = [];
  // P3-2D：全村共用材質——城牆砌石（ashlar）、魚鱗瓦（slate）、金、物件；與噴泉、廣場同一組金屬與物件材質
  const stone = villageAshlar(scene, opt.texBase, hq);
  const roof = villageSlate(scene, opt.texBase, hq);
  const gold = villageGold(scene);
  const props = villageProps(scene);
  for (const m of [stone, roof]) for (const t of m.getActiveTextures()) urls.push(t.name);

  const assign: Record<string, Material> = { stone, roof, gold, props };
  let casters = 0;
  for (const [k, m] of Object.entries(by) as [string, AbstractMesh][]) {
    const mat = assign[k];
    if (mat) m.material = mat;
    m.hasVertexAlpha = false;
    m.isPickable = false;
    m.receiveShadows = true;
    if (opt.shadows) {
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
      materials: 4,
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
