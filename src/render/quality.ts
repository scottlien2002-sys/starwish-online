/**
 * 畫質設定（高 / 中 / 低）— 純資料與邏輯，不依賴 Babylon，可單元測試。
 *
 * 抗鋸齒原則：同一時間只用一種
 *   高：後製管線內的 MSAA 4x（畫布本身關閉抗鋸齒）
 *   中：FXAA（便宜的後製抗鋸齒）
 *   低：不使用後製管線，改用畫布內建 MSAA
 */
export type QualityLevel = "high" | "medium" | "low";

export const QUALITY_LEVELS: readonly QualityLevel[] = Object.freeze(["high", "medium", "low"]);

export const QUALITY_LABEL: Record<QualityLevel, string> = { high: "高", medium: "中", low: "低" };

export interface QualitySettings {
  level: QualityLevel;
  /** 最高渲染像素比（之後由動態解析度往下調） */
  maxPixelRatio: number;
  /** 是否使用後製管線（色調映射在低畫質改由材質內處理，成本極低） */
  postProcess: boolean;
  /** 後製管線 MSAA 樣本數（1 = 關閉） */
  msaaSamples: number;
  fxaa: boolean;
  /** 畫布本身的硬體抗鋸齒（只在不使用後製管線時開啟） */
  canvasAntialias: boolean;
  /** 選擇性發光（星星、魔法、特殊材質） */
  bloom: { enabled: boolean; intensity: number; textureRatio: number; kernel: number };
  shadows: {
    enabled: boolean;
    mapSize: number;
    /** contact = 柔和接觸陰影（PCSS）；pcf = 一般柔化 */
    filter: "contact" | "pcf";
    pcfQuality: "low" | "medium" | "high";
  };
  /** 色調映射與曝光（所有畫質都開啟，避免過曝） */
  toneMapping: { enabled: boolean; exposure: number; contrast: number };
  /** 是否允許載入 HDR 環境貼圖 */
  environmentMap: boolean;
}

const TABLE: Record<QualityLevel, QualitySettings> = {
  high: {
    level: "high",
    maxPixelRatio: 2,
    postProcess: true,
    msaaSamples: 4,
    fxaa: false,
    canvasAntialias: false,
    bloom: { enabled: true, intensity: 0.85, textureRatio: 0.5, kernel: 32 },
    shadows: { enabled: true, mapSize: 2048, filter: "contact", pcfQuality: "high" },
    toneMapping: { enabled: true, exposure: 1.05, contrast: 1.08 },
    environmentMap: true,
  },
  medium: {
    level: "medium",
    maxPixelRatio: 1.5,
    postProcess: true,
    msaaSamples: 1,
    fxaa: true,
    canvasAntialias: false,
    bloom: { enabled: true, intensity: 0.7, textureRatio: 0.25, kernel: 16 },
    shadows: { enabled: true, mapSize: 1024, filter: "pcf", pcfQuality: "medium" },
    toneMapping: { enabled: true, exposure: 1.05, contrast: 1.05 },
    environmentMap: true,
  },
  low: {
    level: "low",
    maxPixelRatio: 1.25,
    postProcess: false,
    msaaSamples: 1,
    fxaa: false,
    canvasAntialias: true,
    bloom: { enabled: false, intensity: 0, textureRatio: 0, kernel: 0 },
    shadows: { enabled: true, mapSize: 512, filter: "pcf", pcfQuality: "low" },
    toneMapping: { enabled: true, exposure: 1.05, contrast: 1.0 },
    environmentMap: false,
  },
};

export function qualitySettings(level: QualityLevel): QualitySettings {
  const s = TABLE[level];
  return {
    ...s,
    bloom: { ...s.bloom },
    shadows: { ...s.shadows },
    toneMapping: { ...s.toneMapping },
  };
}

export function isQualityLevel(v: unknown): v is QualityLevel {
  return v === "high" || v === "medium" || v === "low";
}

/** 依裝置挑預設：手機（觸控為主）→ 中；電腦 → 高 */
export function defaultQuality(env: { coarsePointer: boolean; deviceMemoryGB?: number }): QualityLevel {
  if (env.deviceMemoryGB !== undefined && env.deviceMemoryGB <= 2) return "low";
  return env.coarsePointer ? "medium" : "high";
}

/** 決定畫質：網址參數 ?quality= > 使用者上次的選擇 > 裝置預設 */
export function resolveQuality(urlParam: string | null, stored: string | null, fallback: QualityLevel): QualityLevel {
  if (isQualityLevel(urlParam)) return urlParam;
  if (isQualityLevel(stored)) return stored;
  return fallback;
}

export function nextQuality(level: QualityLevel): QualityLevel {
  const i = QUALITY_LEVELS.indexOf(level);
  return QUALITY_LEVELS[(i + 1) % QUALITY_LEVELS.length]!;
}

/** 動態解析度階梯：從畫質上限開始，每次往下一級，最低 1 倍 */
export function resolutionSteps(devicePixelRatio: number, maxPixelRatio: number): number[] {
  const top = Math.max(1, Math.min(devicePixelRatio || 1, maxPixelRatio));
  const steps = [top, 1.5, 1.25, 1].filter((v, i) => i === 0 || v < top);
  return [...new Set(steps)];
}
