import type { ExpressionAtlasPart, ExpressionAtlasSpec } from "./spec.ts";

/**
 * 表情貼圖集的 UV 計算（共用、不依賴 Babylon）。
 * 模型匯出時，表情零件的 UV 對準第 0 格（左上）；切換表情 = 把整組 UV 平移到第 n 格。
 * 適用：眼睛、嘴巴、眉毛、面罩發光等「換圖案」的部位。不適用：需要變形的表情（請用形狀鍵或骨骼）。
 */
export function atlasCell(index: number, cols: number): { col: number; row: number } {
  return { col: index % cols, row: Math.floor(index / cols) };
}

/** 依表情編號平移 UV；out 可重複使用以避免每次配置記憶體 */
export function offsetUVs(base: ArrayLike<number>, part: ExpressionAtlasPart, index: number, out?: Float32Array): Float32Array {
  const { col, row } = atlasCell(index, part.cols);
  const du = col * part.cellU;
  const dv = row * part.cellV;
  const r = out && out.length === base.length ? out : new Float32Array(base.length);
  for (let k = 0; k < base.length; k += 2) {
    r[k] = base[k]! + du;
    r[k + 1] = base[k + 1]! + dv;
  }
  return r;
}

export function expressionIndex(spec: ExpressionAtlasSpec, name: string): number {
  const i = spec.names.indexOf(name);
  if (i < 0) throw new Error(`未定義的表情：${name}`);
  return i;
}
