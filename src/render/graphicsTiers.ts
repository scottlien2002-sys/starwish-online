/**
 * 星願物語 三段畫質（Stage 6.4 定案候選；Stage 7 世界整合可直接共用）— 純資料與邏輯，不依賴 Babylon，可單元測試。
 *
 * 模型精細度（models）與渲染設定（解析度、陰影、後製）分開管理：
 *   高 High  ：HQ 模型、解析度上限 1.25x、PCF 1024、HDR 關、MSAA 4x、NPC LOD 18 m
 *   中 Medium：Lite 模型、解析度上限 1.25x、PCF 1024（陰影投射物 18 m 內）、HDR 關、MSAA 2x、NPC LOD 14 m（新玩家預設）
 *   低 Low   ：Lite 模型、解析度上限 1.0x、柔和腳底陰影、HDR 關、MSAA 1x（不使用後製管線）、NPC LOD 14 m
 * 三段都開：動態解析度（FPS 連續 2 秒 < 40 往下調，不超過上限）、畫面外剔除、遠距動作暫停、陰影投射物剔除。
 * PCSS 1024／PCSS 2048 只保留為進階選項（?shadow=），不作為任何手機預設。
 *
 * 偏好保存：localStorage「starwish.graphicsTier」。網址 ?quality=high|medium|low 優先（測試網址用，不覆寫偏好）。
 * 切換畫質＝寫入偏好後重新載入頁面：模型精細度不同（HQ／Lite），重新載入可保證不會重複載入模型、不殘留舊的渲染物件。
 */
export type GraphicsTier = "high" | "medium" | "low";
export const GRAPHICS_TIERS: readonly GraphicsTier[] = ["high", "medium", "low"];
export const TIER_LABEL: Readonly<Record<GraphicsTier, string>> = { high: "高畫質", medium: "中畫質", low: "低畫質" };
export const GRAPHICS_TIER_STORAGE_KEY = "starwish.graphicsTier";
/** 新玩家首次進入的預設畫質 */
export const DEFAULT_TIER: GraphicsTier = "medium";

export type ShadowMode = "pcss2048" | "pcss1024" | "pcf1024" | "pcf512" | "blob" | "off";
export const SHADOW_MODES: readonly ShadowMode[] = ["pcss2048", "pcss1024", "pcf1024", "pcf512", "blob", "off"];

export interface TierPreset {
  tier: GraphicsTier;
  /** 模型精細度 */
  models: "hq" | "lite";
  /** 渲染解析度上限（倍率；實際倍率不超過裝置 DPR） */
  maxRes: number;
  shadow: ShadowMode;
  hdr: boolean;
  /** 要求的 MSAA 取樣數（實際生效值依裝置／管線回報） */
  msaa: number;
  /** 使用後製管線（色調映射＋MSAA）；false＝不使用後製管線，色調映射由材質處理 */
  post: boolean;
  /** NPC／洛恩距離 LOD 切換距離（m） */
  lodNear: number;
  /** 陰影投射物範圍（以玩家為中心的半徑，m）：超過的物件不畫進陰影貼圖 */
  shadowRange: number;
  dynamicRes: true;
  offscreenCull: true;
  animThrottle: true;
  casterCull: true;
}

export const TIER_PRESETS: Readonly<Record<GraphicsTier, TierPreset>> = Object.freeze({
  high: { tier: "high", models: "hq", maxRes: 1.25, shadow: "pcf1024", hdr: false, msaa: 4, post: true, lodNear: 18, shadowRange: 31.5, dynamicRes: true, offscreenCull: true, animThrottle: true, casterCull: true },
  medium: { tier: "medium", models: "lite", maxRes: 1.25, shadow: "pcf1024", hdr: false, msaa: 2, post: true, lodNear: 14, shadowRange: 18, dynamicRes: true, offscreenCull: true, animThrottle: true, casterCull: true },
  low: { tier: "low", models: "lite", maxRes: 1, shadow: "blob", hdr: false, msaa: 1, post: false, lodNear: 14, shadowRange: 18, dynamicRes: true, offscreenCull: true, animThrottle: true, casterCull: true },
});

export function isGraphicsTier(v: unknown): v is GraphicsTier {
  return v === "high" || v === "medium" || v === "low";
}

/** 畫質決定順序：網址 ?quality= ＞ 玩家偏好 ＞ 預設（中畫質） */
export function resolveTier(urlParam: string | null, stored: string | null, fallback: GraphicsTier = DEFAULT_TIER): { tier: GraphicsTier; source: "url" | "stored" | "default" } {
  if (isGraphicsTier(urlParam)) return { tier: urlParam, source: "url" };
  if (isGraphicsTier(stored)) return { tier: stored, source: "stored" };
  return { tier: fallback, source: "default" };
}

export function nextTier(t: GraphicsTier): GraphicsTier {
  return GRAPHICS_TIERS[(GRAPHICS_TIERS.indexOf(t) + 1) % GRAPHICS_TIERS.length]!;
}

/** 實際生效的 MSAA：要求值、管線回報值、裝置上限取最小（WebGL1 或不支援時為 1） */
export function effectiveMsaa(requested: number, pipelineSamples: number | null, deviceMax: number): number {
  const asked = pipelineSamples ?? requested;
  return Math.max(1, Math.min(asked, requested, Math.max(1, deviceMax)));
}

/** 瀏覽器端：讀取／保存畫質偏好（私密瀏覽等無法存取時回傳 null／略過） */
export function loadTierPreference(): string | null {
  try {
    return window.localStorage.getItem(GRAPHICS_TIER_STORAGE_KEY);
  } catch {
    return null;
  }
}
export function saveTierPreference(t: GraphicsTier): void {
  try {
    window.localStorage.setItem(GRAPHICS_TIER_STORAGE_KEY, t);
  } catch {
    /* ignore */
  }
}
