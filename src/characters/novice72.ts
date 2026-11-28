/** Stage 7.2 新版初心者（Tripo 模組化）：檔名與零件型別（不依賴 Babylon，可單元測試） */
export type Novice72Gender = "male" | "female";
export type Novice72Lod = "hq" | "lite";
/** Stage 7.2 新版初心者（Tripo 模組化）的資料夾與檔名 */
export const MODULAR_DIR = "novice72";
export const MODULAR_VERSION = "tripo72";
/** 每個性別預留 6 種髮型（目前交付 hair01） */
export const MODULAR_HAIR_FILES: readonly string[] = ["hair01"];
export function modularFile(g: Novice72Gender, slot: string, lod: Novice72Lod): string {
  return `novice72_${g}_${slot}_${lod}.glb`;
}
export interface ModularPartInfo {
  kind: "hair" | "top" | "bottom" | "boots" | "weapon";
  file: string;
  meshes: string[];
  /** 零件骨骼順序和身體不同 → 已依名稱重新對應頂點的骨骼索引 */
  remapped: boolean;
}

