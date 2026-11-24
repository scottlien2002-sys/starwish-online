import type { AbstractMesh, Scene } from "@babylonjs/core";
import { villageProps } from "./villageMaterials.ts";

/**
 * Stage 6 P3-12 星芽村環境美術（外圍樹林、樹籬邊界、遠景山丘）。
 * - 全部用全村共用的頂點色材質（1 個材質）；不投射即時陰影（遠處物件、省陰影繪製）
 * - Env_terrain 只給獨立預覽頁用；遊戲本體已有外圍緩坡地面，整合時傳 includeTerrain=false
 */
export interface EnvP3 {
  readonly stats: { meshes: number; triangles: number; byMesh: Record<string, number>; materials: number };
  setEnabled(on: boolean): void;
}

export function setupEnvP3(scene: Scene, meshes: AbstractMesh[], opt: { includeTerrain: boolean }): EnvP3 {
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
    used.push(m);
  }
  return {
    stats: { meshes: used.length, triangles: Object.values(byMesh).reduce((a, b) => a + b, 0), byMesh, materials: 1 },
    setEnabled(on) {
      for (const m of used) m.setEnabled(on);
    },
  };
}
