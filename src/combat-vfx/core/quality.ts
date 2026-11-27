/**
 * Combat VFX 品質分級（純資料，可單元測試）。
 * 三段品質只改「特效」的密度與後製，不改角色、怪物模型與戰鬥結果；同一個技能在三段品質的命中時間、傷害完全相同。
 * 數值以 iPhone Safari 為優先：低畫質沒有 GlowLayer、粒子約 1/4、拖尾 8 段。
 */
export type VfxTier = "high" | "medium" | "low";
export const VFX_TIERS: readonly VfxTier[] = ["high", "medium", "low"];

export interface VfxQualityConfig {
  tier: VfxTier;
  label: string;
  /** 每個粒子發射器的數量倍率 */
  particleScale: number;
  /** 單一發射器容量上限 */
  maxParticlesPerEmitter: number;
  /** 整個畫面同時存在的粒子上限（多人同場時預算由 VfxBudget 分配） */
  maxParticlesTotal: number;
  /** 同時存在的特效上限（魔法陣、劍氣、震波…；傷害數字另計） */
  maxActiveEffects: number;
  /** 武器殘影的段數（取樣點） */
  trailSegments: number;
  /** 殘影保留秒數 */
  trailLife: number;
  /** 發光後製（GlowLayer）；關閉時特效仍用加算混合發亮 */
  glow: boolean;
  glowTextureRatio: number;
  /** 第二層細節（餘燼、碎石、二次火花）；低畫質關閉 */
  secondary: boolean;
  /** 鏡頭震動強度倍率（0 = 關） */
  shake: number;
  /** 打擊頓幀 */
  hitstop: boolean;
  /** 同時顯示的傷害數字上限 */
  damageNumbers: number;
  /** 程式貼圖解析度 */
  textureSize: number;
  /** 渲染解析度上限（devicePixelRatio 上限） */
  maxDpr: number;
}

export const VFX_QUALITY: Readonly<Record<VfxTier, Readonly<VfxQualityConfig>>> = Object.freeze({
  high: Object.freeze({
    tier: "high", label: "高", particleScale: 1, maxParticlesPerEmitter: 220, maxParticlesTotal: 2400, maxActiveEffects: 48,
    trailSegments: 22, trailLife: 0.16, glow: true, glowTextureRatio: 0.5, secondary: true, shake: 1, hitstop: true,
    damageNumbers: 40, textureSize: 256, maxDpr: 2,
  }),
  medium: Object.freeze({
    tier: "medium", label: "中", particleScale: 0.55, maxParticlesPerEmitter: 120, maxParticlesTotal: 1200, maxActiveEffects: 32,
    trailSegments: 14, trailLife: 0.14, glow: true, glowTextureRatio: 0.35, secondary: true, shake: 0.85, hitstop: true,
    damageNumbers: 28, textureSize: 128, maxDpr: 1.5,
  }),
  low: Object.freeze({
    tier: "low", label: "低", particleScale: 0.25, maxParticlesPerEmitter: 60, maxParticlesTotal: 500, maxActiveEffects: 18,
    trailSegments: 8, trailLife: 0.12, glow: false, glowTextureRatio: 0, secondary: false, shake: 0.7, hitstop: true,
    damageNumbers: 16, textureSize: 64, maxDpr: 1.25,
  }),
});

export function parseTier(v: string | null | undefined, fallback: VfxTier = "medium"): VfxTier {
  return v === "high" || v === "medium" || v === "low" ? v : fallback;
}

/** 粒子數：依品質縮放、不超過單一發射器上限、至少 1 */
export function particleCount(base: number, q: VfxQualityConfig, extraScale = 1): number {
  return Math.max(1, Math.min(q.maxParticlesPerEmitter, Math.round(base * q.particleScale * extraScale)));
}
