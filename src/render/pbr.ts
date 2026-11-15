import { Color3, PBRMaterial, type Scene } from "@babylonjs/core";

export interface PbrOptions {
  albedo: Color3;
  /** 0 = 非金屬（布、木、果凍等幾乎都用 0） */
  metallic?: number;
  /** 0 = 鏡面、1 = 霧面 */
  roughness?: number;
  emissive?: Color3;
  /** 0~1 透明度 */
  alpha?: number;
  /** 表層透明亮漆（果凍、糖果、寶石感） */
  clearCoat?: { intensity: number; roughness: number };
  /** 有環境貼圖時的反射強度 */
  environmentIntensity?: number;
}

/**
 * PBR 材質建立工具（V1：提供支援，不強制轉換現有材質）。
 * 新的正式模型（GLB）本身就是 PBR；程式化物件可逐步改用此工具。
 * 注意：沒有載入環境貼圖時，PBR 只受場景燈光影響，金屬與反射效果有限。
 */
export function createPbrMaterial(name: string, scene: Scene, o: PbrOptions): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = o.albedo;
  m.metallic = o.metallic ?? 0;
  m.roughness = o.roughness ?? 0.6;
  if (o.emissive) m.emissiveColor = o.emissive;
  if (o.alpha !== undefined && o.alpha < 1) {
    m.alpha = o.alpha;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  }
  if (o.clearCoat) {
    m.clearCoat.isEnabled = true;
    m.clearCoat.intensity = o.clearCoat.intensity;
    m.clearCoat.roughness = o.clearCoat.roughness;
  }
  m.environmentIntensity = o.environmentIntensity ?? 1;
  return m;
}

export const PBR_PRESETS = Object.freeze({
  /** 霧面布料 */
  cloth: (scene: Scene, name: string, albedo: Color3) => createPbrMaterial(name, scene, { albedo, roughness: 0.85 }),
  /** 果凍（半透明＋亮漆） */
  jelly: (scene: Scene, name: string, albedo: Color3) =>
    createPbrMaterial(name, scene, { albedo, roughness: 0.25, alpha: 0.55, clearCoat: { intensity: 1, roughness: 0.05 } }),
  /** 發光（星星、魔法） */
  glow: (scene: Scene, name: string, color: Color3) => createPbrMaterial(name, scene, { albedo: color, emissive: color, roughness: 0.5 }),
});

export { Color3 };
