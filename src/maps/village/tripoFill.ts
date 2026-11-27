import { Color3, type StandardMaterial, type Texture } from "@babylonjs/core";
/**
 * Stage 6.7：Tripo 貼圖已畫好明暗與高光，但 NPC 正面常背光（只有天光，約 0.5 倍亮度），
 * 加上色調映射與對比後顏色變暗、銀色偏玫瑰銅。
 * StandardMaterial 的 emissiveColor 會乘上底色貼圖、且「光照＋自發光」上限為 1 倍底色，
 * 所以提高 emissiveColor 等於補足背光面亮度、不會讓受光面過曝或改變原始配色。
 * 不多佔貼圖記憶體、不增加繪製次數。&npcfill=0 回到原本的 0.06（比較用）。
 */
export const TRIPO_FILL = { value: 0.3 };
export function applyTripoFill(s: StandardMaterial, tex: Texture | null): void {
  if (!tex || TRIPO_FILL.value <= 0) return;
  const v = TRIPO_FILL.value;
  s.emissiveColor = new Color3(v, v, v);
}
