import { Color3, type StandardMaterial, type Texture } from "@babylonjs/core";
/**
 * Stage 6.7：Tripo 貼圖已畫好明暗與高光，但 NPC 正面常背光（只有天光，約 0.5 倍亮度），
 * 加上色調映射與對比後顏色變暗、銀色偏玫瑰銅。
 * StandardMaterial 的 emissiveColor 會乘上底色貼圖、且「光照＋自發光」上限為 1 倍底色，
 * 所以提高 emissiveColor 等於補足背光面亮度、不會讓受光面過曝或改變原始配色。
 * 另做反向色溫補償（見下）。不多佔貼圖記憶體、不增加繪製次數。&npcfill=0 兩者都關閉（比較用）。
 */
export const TRIPO_FILL = { value: 0.3 };
export function applyTripoFill(s: StandardMaterial, tex: Texture | null): void {
  if (!tex || TRIPO_FILL.value <= 0) return;
  const v = TRIPO_FILL.value;
  s.emissiveColor = new Color3(v, v, v);
  // 村莊陽光偏暖（1／0.93／0.81），加上色調映射與對比後藍色明顯流失（銀甲、銀髮偏玫瑰銅）。
  // diffuseColor 只作用在光照項（在 1 倍底色上限之內），做反向色溫補償，讓 Tripo 原始配色不被暖陽改變。
  s.diffuseColor = new Color3(0.94, 1.0, 1.12);
}
