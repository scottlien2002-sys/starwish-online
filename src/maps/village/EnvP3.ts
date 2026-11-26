import type { AbstractMesh, Scene } from "@babylonjs/core";
import { villageProps } from "./villageMaterials.ts";
import { splitBySector } from "./sectorSplit.ts";

/** Stage 6.6：高畫質的外圍樹林與樹籬切成 6 個扇區（直向鏡頭畫面外的扇區不繪製；三角面總數不變）。中／低畫質樹林面數小，不切 */
export const ENV_SECTORS = 6;

/**
 * Stage 6 P3-12 星芽村環境美術（外圍樹林、樹籬邊界、遠景山丘）。
 * - 全部用全村共用的頂點色材質（1 個材質）；不投射即時陰影（遠處物件、省陰影繪製）
 * - Env_terrain 只給獨立預覽頁用；遊戲本體已有外圍緩坡地面，整合時傳 includeTerrain=false
 */
export interface EnvP3 {
  readonly stats: { meshes: number; triangles: number; byMesh: Record<string, number>; materials: number; sectors: number };
  /** 實際使用中的網格（樹林切成扇區後的新網格） */
  readonly meshes: readonly AbstractMesh[];
  setEnabled(on: boolean): void;
}

export function setupEnvP3(scene: Scene, meshes: AbstractMesh[], opt: { includeTerrain: boolean; sectors?: number }): EnvP3 {
  const mat = villageProps(scene);
  const byMesh: Record<string, number> = {};
  const used: AbstractMesh[] = [];
  for (const k of ["props", "far", "terrain"] as const) {
    const m = meshes.find((x) => x.name.startsWith(`Env_${k}`) && x.getTotalIndices() > 0);
    if (!m) continue;
    if (k === "terrain" && !opt.includeTerrain) {
      m.setEnabled(false);
      continue;
    }
    m.material = mat;
    m.isPickable = false;
    m.receiveShadows = k !== "far";
    m.hasVertexAlpha = false;
    byMesh[k] = Math.round(m.getTotalIndices() / 3);
    if (k === "props" && (opt.sectors ?? 1) > 1) used.push(...splitBySector(scene, m, opt.sectors ?? 1, "Env_props"));
    else used.push(m);
  }
  return {
    stats: { meshes: used.length, triangles: Object.values(byMesh).reduce((a, b) => a + b, 0), byMesh, materials: 1, sectors: opt.sectors ?? 1 },
    meshes: used,
    setEnabled(on) {
      for (const m of used) m.setEnabled(on);
    },
  };
}
