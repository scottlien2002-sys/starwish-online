/** 特效調色盤：同一個特效換顏色就能給不同職業／屬性使用（日系奇幻：亮、乾淨、帶一點粉彩） */
import { Color3, Color4 } from "@babylonjs/core";
import type { Palette } from "../core/skills.ts";

export interface PaletteColors {
  /** 主色（劍氣、魔法陣） */
  main: Color3;
  /** 核心高光（接近白） */
  core: Color3;
  /** 粒子起始／結束色 */
  p1: Color4;
  p2: Color4;
  pDead: Color4;
}

const c3 = (r: number, g: number, b: number) => new Color3(r, g, b);
const c4 = (r: number, g: number, b: number, a: number) => new Color4(r, g, b, a);

export const PALETTES: Record<Palette, PaletteColors> = {
  steel: { main: c3(0.75, 0.88, 1.0), core: c3(1, 1, 1), p1: c4(1, 1, 1, 1), p2: c4(0.7, 0.85, 1, 1), pDead: c4(0.4, 0.55, 1, 0) },
  azure: { main: c3(0.35, 0.75, 1.0), core: c3(0.85, 0.97, 1), p1: c4(0.75, 0.95, 1, 1), p2: c4(0.35, 0.65, 1, 1), pDead: c4(0.2, 0.3, 0.9, 0) },
  star: { main: c3(0.72, 0.6, 1.0), core: c3(1, 0.95, 0.85), p1: c4(1, 0.95, 0.7, 1), p2: c4(0.75, 0.6, 1, 1), pDead: c4(0.45, 0.3, 0.9, 0) },
  gold: { main: c3(1.0, 0.8, 0.35), core: c3(1, 0.98, 0.85), p1: c4(1, 0.95, 0.6, 1), p2: c4(1, 0.7, 0.25, 1), pDead: c4(0.9, 0.4, 0.1, 0) },
  rose: { main: c3(1.0, 0.5, 0.72), core: c3(1, 0.92, 0.96), p1: c4(1, 0.85, 0.95, 1), p2: c4(1, 0.45, 0.7, 1), pDead: c4(0.7, 0.2, 0.6, 0) },
};
