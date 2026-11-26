/**
 * 星芽村效能設定（純邏輯，可單元測試）。Stage 6.3 建立、Stage 6.4 改由三段畫質（src/render/graphicsTiers.ts）決定預設。
 * ?perf=s62 重現 Stage 6.2，供同一台 iPhone 前後比較。
 */
import { type GraphicsTier, SHADOW_MODES, type ShadowMode, TIER_PRESETS } from "../../render/graphicsTiers.ts";

export { SHADOW_MODES, type ShadowMode };

export const SHADOW_LABEL: Readonly<Record<ShadowMode, string>> = {
  pcss2048: "柔和接觸陰影 PCSS 2048（高取樣 64）",
  pcss1024: "柔和接觸陰影 PCSS 1024（中取樣 32）",
  pcf1024: "一般柔化陰影 PCF 1024",
  pcf512: "一般柔化陰影 PCF 512",
  blob: "柔和腳底陰影（不使用陰影貼圖）",
  off: "關閉陰影",
};

export interface VillagePerfConfig {
  /** "opt"＝三段畫質設定；"s62"＝重現 Stage 6.2（比較用） */
  profile: "opt" | "s62";
  tier: GraphicsTier;
  /** 模型精細度（HQ／Lite） */
  models: "hq" | "lite";
  shadow: ShadowMode;
  /** 要求的渲染解析度上限（倍率） */
  maxRes: number;
  /** true＝固定解析度（不做動態降解析度） */
  resLock: boolean;
  /** 要求的 MSAA 取樣數 */
  msaa: number;
  hdr: boolean;
  post: boolean;
  /** NPC／洛恩距離 LOD */
  npcLod: boolean;
  lodNear: number;
  animThrottle: boolean;
  animFar: number;
  casterCull: boolean;
  originalModels: boolean;
  /** 被網址參數覆寫的項目（報告用） */
  overrides: string[];
}

const num = (v: string | null): number | null => {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const flag = (v: string | null): boolean | null => (v === "1" || v === "true" ? true : v === "0" || v === "false" ? false : null);

/**
 * 依畫質（高／中／低）取得村莊效能設定；網址進階參數可覆寫個別項目：
 *   &lod=hq|lite  &shadow=pcss2048|pcss1024|pcf1024|pcf512|blob|off  &res=  &reslock=1  &msaa=1|2|4  &hdr=0|1  &post=0|1
 *   &npclod=0  &animthrottle=0  &castercull=0  &perf=s62（重現 Stage 6.2：原始角色、PCSS 2048 高取樣、2x、HDR、MSAA 4x、沒有 LOD）
 */
export function villagePerfConfig(params: URLSearchParams, tier: GraphicsTier): VillagePerfConfig {
  const s62 = params.get("perf") === "s62";
  const p = TIER_PRESETS[tier];
  const ov: string[] = [];
  const base = s62
    ? { models: "hq" as const, shadow: "pcss2048" as ShadowMode, maxRes: 2, msaa: 4, hdr: true, post: true, npcLod: false, animThrottle: false, casterCull: false }
    : { models: p.models, shadow: p.shadow, maxRes: p.maxRes, msaa: p.msaa, hdr: p.hdr, post: p.post, npcLod: true, animThrottle: p.animThrottle, casterCull: p.casterCull };
  const lod = params.get("lod");
  const models = lod === "hq" || lod === "lite" ? lod : base.models;
  if (models !== base.models) ov.push(`模型 ${models}`);
  const sp = params.get("shadow");
  const shadow = (SHADOW_MODES as readonly string[]).includes(sp ?? "") ? (sp as ShadowMode) : base.shadow;
  if (shadow !== base.shadow) ov.push(`陰影 ${shadow}`);
  const res = num(params.get("res"));
  const maxRes = res !== null ? Math.max(0.5, Math.min(3, res)) : base.maxRes;
  if (maxRes !== base.maxRes) ov.push(`解析度 ${maxRes}x`);
  const m = num(params.get("msaa"));
  const msaa = m !== null && [1, 2, 4, 8].includes(m) ? m : base.msaa;
  if (msaa !== base.msaa) ov.push(`MSAA ${msaa}`);
  const hdr = flag(params.get("hdr")) ?? base.hdr;
  if (hdr !== base.hdr) ov.push(`HDR ${hdr ? "開" : "關"}`);
  const post = flag(params.get("post")) ?? base.post;
  if (post !== base.post) ov.push(`後製 ${post ? "開" : "關"}`);
  const npcLod = flag(params.get("npclod")) ?? base.npcLod;
  const animThrottle = flag(params.get("animthrottle")) ?? base.animThrottle;
  const casterCull = flag(params.get("castercull")) ?? base.casterCull;
  const resLock = flag(params.get("reslock")) ?? false;
  if (resLock) ov.push("解析度鎖定");
  if (npcLod !== base.npcLod) ov.push(`NPC LOD ${npcLod ? "開" : "關"}`);
  if (animThrottle !== base.animThrottle) ov.push(`遠距動作暫停 ${animThrottle ? "開" : "關"}`);
  if (casterCull !== base.casterCull) ov.push(`陰影投射物剔除 ${casterCull ? "開" : "關"}`);
  return {
    profile: s62 ? "s62" : "opt",
    tier,
    models,
    shadow,
    maxRes,
    resLock,
    msaa,
    hdr,
    post,
    npcLod,
    lodNear: num(params.get("lodnear")) ?? (models === "lite" ? TIER_PRESETS.medium.lodNear : TIER_PRESETS.high.lodNear),
    animThrottle,
    animFar: 32,
    casterCull,
    originalModels: s62,
    overrides: ov,
  };
}

/** 陰影模式對應的陰影貼圖設定 */
export function shadowSpec(mode: ShadowMode): { map: boolean; size: number; contact: boolean; filtering: "high" | "medium" | "low"; blobs: boolean } {
  switch (mode) {
    case "pcss2048":
      return { map: true, size: 2048, contact: true, filtering: "high", blobs: false };
    case "pcss1024":
      return { map: true, size: 1024, contact: true, filtering: "medium", blobs: false };
    case "pcf1024":
      return { map: true, size: 1024, contact: false, filtering: "medium", blobs: false };
    case "pcf512":
      return { map: true, size: 512, contact: false, filtering: "low", blobs: false };
    case "blob":
      return { map: false, size: 0, contact: false, filtering: "low", blobs: true };
    default:
      return { map: false, size: 0, contact: false, filtering: "low", blobs: false };
  }
}

/** 角色 LOD：近距使用主要模型，超過 near（含 1.5 m 遲滯）改用遠距模型 */
export function lodLevel(dist: number, near: number, current: 0 | 1): 0 | 1 {
  if (current === 0) return dist > near + 0.75 ? 1 : 0;
  return dist < near - 0.75 ? 0 : 1;
}

/** 陰影投射物剔除：物件包圍球（XZ 平面）與陰影範圍（以玩家為中心、半徑 r）相交才畫進陰影貼圖 */
export function casterInRange(cx: number, cz: number, radius: number, px: number, pz: number, r: number): boolean {
  return Math.hypot(cx - px, cz - pz) <= r + radius;
}

// ---------------------------------------------------------------- 效能診斷（實機一鍵 A/B）

export interface DiagStep {
  id: string;
  label: string;
  /** 套用到目前設定上的變更（undefined＝不變） */
  change: Partial<Pick<VillagePerfConfig, "shadow" | "maxRes" | "msaa" | "hdr" | "post" | "npcLod" | "animThrottle" | "casterCull">> & {
    hideCharacters?: boolean;
    hideStatic?: boolean;
    skipRender?: boolean;
  };
}

/**
 * 依序執行；每一項開始前都先恢復「目前畫質的基準設定」，只改一個因素（方便判斷 CPU／GPU／陰影／後製／解析度／模型面數的影響）。
 * 最後再量一次基準（複測），確認整段診斷期間沒有漂移。
 */
export function diagSteps(post: boolean): DiagStep[] {
  const s: DiagStep[] = [
    { id: "base", label: "目前基準", change: {} },
    { id: "res1", label: "解析度 1x", change: { maxRes: 1 } },
    { id: "res125", label: "解析度 1.25x", change: { maxRes: 1.25 } },
    { id: "res15", label: "解析度 1.5x", change: { maxRes: 1.5 } },
    { id: "res2", label: "解析度 2x", change: { maxRes: 2 } },
    { id: "pcss2048", label: "陰影 PCSS 2048（高取樣）", change: { shadow: "pcss2048" } },
    { id: "pcss1024", label: "陰影 PCSS 1024（中取樣）", change: { shadow: "pcss1024" } },
    { id: "pcf1024", label: "陰影 PCF 1024", change: { shadow: "pcf1024" } },
    { id: "blob", label: "柔和腳底陰影", change: { shadow: "blob" } },
    { id: "noshadow", label: "關閉陰影", change: { shadow: "off" } },
  ];
  if (post) {
    s.push(
      { id: "msaa1", label: "MSAA 1x", change: { msaa: 1 } },
      { id: "msaa2", label: "MSAA 2x", change: { msaa: 2 } },
      { id: "msaa4", label: "MSAA 4x", change: { msaa: 4 } },
      { id: "hdron", label: "HDR 開", change: { hdr: true } },
      { id: "nopost", label: "關閉後製管線", change: { post: false } },
    );
  }
  s.push(
    { id: "nolod", label: "NPC 不用距離 LOD", change: { npcLod: false } },
    { id: "nochar", label: "隱藏 NPC 與洛恩", change: { hideCharacters: true } },
    { id: "nostatic", label: "隱藏建築與環境（只剩地面與角色）", change: { hideStatic: true } },
    { id: "cpu", label: "不繪製畫面（只量 CPU 邏輯）", change: { skipRender: true } },
    { id: "base2", label: "目前基準（複測）", change: {} },
  );
  return s;
}

// ---------------------------------------------------------------- 幀時間統計（巡迴與診斷共用，定義明確）

/**
 * 統計定義（Stage 6.4）：
 * - 平均 FPS＝幀數 ÷ 總時間（秒）
 * - 1% Low＝最慢 1% 幀（至少 1 幀）的平均幀時間換算成 FPS
 * - 最低 FPS＝1 ÷ 最長一幀的時間
 * - 卡頓＝幀時間 > 50 ms 的幀數；長幀＝> 250 ms
 */
export interface FrameSummary {
  frames: number;
  seconds: number;
  avgFps: number;
  low1Fps: number;
  minFps: number;
  stutters: number;
  longFrames: number;
}

export function frameSummary(dts: readonly number[]): FrameSummary {
  const n = dts.length;
  if (!n) return { frames: 0, seconds: 0, avgFps: 0, low1Fps: 0, minFps: 0, stutters: 0, longFrames: 0 };
  const total = dts.reduce((a, b) => a + b, 0);
  const sorted = [...dts].sort((a, b) => b - a);
  const k = Math.max(1, Math.floor(n * 0.01));
  const worst = sorted.slice(0, k).reduce((a, b) => a + b, 0) / k;
  return {
    frames: n,
    seconds: total,
    avgFps: n / Math.max(total, 1e-6),
    low1Fps: 1 / Math.max(worst, 1e-6),
    minFps: 1 / Math.max(sorted[0]!, 1e-6),
    stutters: dts.filter((d) => d > 0.05).length,
    longFrames: dts.filter((d) => d > 0.25).length,
  };
}

/** 幀標記：paused＝這一幀期間頁面曾切到背景／被暫停（visibilitychange、pagehide、blur）— 不是遊戲本身的卡頓 */
export interface FrameMark {
  dt: number;
  /** 測試開始後的秒數 */
  t: number;
  paused: boolean;
  /** 暫停原因（頁面事件名稱） */
  reason?: string;
}

/** 原始統計（全部幀）＋有效遊戲期間統計（排除頁面暫停幀；真實長幀不排除）＋長幀清單 */
export function splitFrameStats(marks: readonly FrameMark[]): {
  raw: FrameSummary;
  valid: FrameSummary;
  pausedFrames: number;
  pausedSeconds: number;
  long: { t: number; ms: number; cause: string }[];
} {
  const raw = frameSummary(marks.map((m) => m.dt));
  const validDts = marks.filter((m) => !m.paused).map((m) => m.dt);
  const paused = marks.filter((m) => m.paused);
  return {
    raw,
    valid: frameSummary(validDts),
    pausedFrames: paused.length,
    pausedSeconds: paused.reduce((a, m) => a + m.dt, 0),
    long: marks
      .filter((m) => m.dt > 0.25)
      .map((m) => ({ t: Math.round(m.t * 10) / 10, ms: Math.round(m.dt * 1000), cause: m.paused ? `頁面暫停（${m.reason ?? "背景"}）` : "真實長幀（遊戲內）" })),
  };
}
