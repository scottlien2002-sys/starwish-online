/**
 * Stage 6.3 星芽村 iPhone 實機效能設定（純邏輯，可單元測試）。
 *
 * 預設（優化後）與 ?perf=s62（重現 Stage 6.2：原始高面數角色＋PCSS64 2048＋2x）都可在同一台 iPhone 上用一鍵巡迴比較。
 * 個別參數可覆寫：
 *   &shadow=pcss2048|pcss1024|pcf1024|blob|off   陰影
 *   &res=1|1.25|1.5|2                             渲染解析度上限（動態解析度仍可往下調；&reslock=1 固定不動）
 *   &msaa=1|2|4  &hdr=0|1  &post=0                後製
 *   &npclod=0  &animthrottle=0  &castercull=0     NPC 距離 LOD、遠距／畫面外動畫暫停、陰影投射物距離剔除
 */
export type ShadowMode = "pcss2048" | "pcss1024" | "pcf1024" | "pcf512" | "blob" | "off";
export const SHADOW_MODES: readonly ShadowMode[] = ["pcss2048", "pcss1024", "pcf1024", "pcf512", "blob", "off"];

export const SHADOW_LABEL: Readonly<Record<ShadowMode, string>> = {
  pcss2048: "柔和接觸陰影 PCSS 2048（高取樣 64）",
  pcss1024: "柔和接觸陰影 PCSS 1024（中取樣 32）",
  pcf1024: "一般柔化陰影 PCF 1024",
  pcf512: "一般柔化陰影 PCF 512（只有角色）",
  blob: "柔和腳底陰影（不使用陰影貼圖）",
  off: "關閉陰影",
};

export interface VillagePerfConfig {
  /** "opt"＝Stage 6.3 優化預設；"s62"＝重現 Stage 6.2 */
  profile: "opt" | "s62";
  shadow: ShadowMode;
  /** 渲染解析度上限（倍率） */
  maxRes: number;
  /** true＝固定解析度（不做動態降解析度） */
  resLock: boolean;
  msaa: number;
  hdr: boolean;
  post: boolean;
  /** NPC／洛恩距離 LOD（近：HQ 或 Lite 模型；遠：遠距模型） */
  npcLod: boolean;
  /** LOD 切換距離（m） */
  lodNear: number;
  /** 遠距或畫面外的 NPC 暫停骨架動作 */
  animThrottle: boolean;
  /** 超過這個距離的 NPC 暫停動作（m） */
  animFar: number;
  /** 陰影投射物距離剔除（只讓陰影範圍內的物件畫進陰影貼圖） */
  casterCull: boolean;
  /** 使用 Stage 6.2 的原始高面數角色檔（_s62） */
  originalModels: boolean;
}

export interface PerfEnv {
  quality: "high" | "medium" | "low";
  lite: boolean;
  /** 畫質表的解析度上限 */
  qualityMaxRes: number;
  qualityMsaa: number;
  qualityPost: boolean;
}

const num = (v: string | null): number | null => {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const flag = (v: string | null): boolean | null => (v === "1" || v === "true" ? true : v === "0" || v === "false" ? false : null);

export function villagePerfConfig(params: URLSearchParams, env: PerfEnv): VillagePerfConfig {
  const s62 = params.get("perf") === "s62";
  const hq = env.quality === "high" && !env.lite;
  // 預設陰影：HQ＝PCSS 1024 中取樣（優化）；s62＝PCSS 2048 高取樣；Lite（中／低畫質）沿用原本的 PCF（只有角色投射）
  const baseShadow: ShadowMode = env.quality === "high" ? (s62 ? "pcss2048" : "pcss1024") : env.quality === "medium" ? "pcf1024" : "pcf512";
  const sp = params.get("shadow");
  const shadow = (SHADOW_MODES as readonly string[]).includes(sp ?? "") ? (sp as ShadowMode) : baseShadow;
  // 解析度：HQ 優化預設 1.5x（s62＝畫質表的 2x）；其他畫質沿用畫質表
  const baseRes = hq && !s62 ? Math.min(1.5, env.qualityMaxRes) : env.qualityMaxRes;
  const res = num(params.get("res"));
  const maxRes = res !== null ? Math.max(0.5, Math.min(3, res)) : baseRes;
  const msaa = num(params.get("msaa"));
  return {
    profile: s62 ? "s62" : "opt",
    shadow,
    maxRes,
    resLock: flag(params.get("reslock")) ?? false,
    msaa: msaa !== null && [1, 2, 4, 8].includes(msaa) ? msaa : env.qualityMsaa,
    hdr: flag(params.get("hdr")) ?? true,
    post: (flag(params.get("post")) ?? true) && env.qualityPost,
    npcLod: flag(params.get("npclod")) ?? !s62,
    lodNear: num(params.get("lodnear")) ?? (env.lite ? 14 : 18),
    animThrottle: flag(params.get("animthrottle")) ?? !s62,
    animFar: 32,
    casterCull: flag(params.get("castercull")) ?? !s62,
    originalModels: s62,
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

/** 依序執行；每一項都從「目前預設」出發，只改一個因素（方便判斷 CPU／GPU／陰影／後製／解析度／模型面數的影響） */
export function diagSteps(hq: boolean): DiagStep[] {
  const s: DiagStep[] = [
    { id: "base", label: "目前預設", change: {} },
    { id: "res1", label: "解析度 1x", change: { maxRes: 1 } },
    { id: "res125", label: "解析度 1.25x", change: { maxRes: 1.25 } },
    { id: "res15", label: "解析度 1.5x", change: { maxRes: 1.5 } },
    { id: "res2", label: "解析度 2x", change: { maxRes: 2 } },
  ];
  if (hq) {
    s.push(
      { id: "pcss2048", label: "陰影 PCSS 2048（高取樣）", change: { shadow: "pcss2048" } },
      { id: "pcss1024", label: "陰影 PCSS 1024（中取樣）", change: { shadow: "pcss1024" } },
      { id: "pcf1024", label: "陰影 PCF 1024", change: { shadow: "pcf1024" } },
      { id: "blob", label: "柔和腳底陰影", change: { shadow: "blob" } },
      { id: "noshadow", label: "關閉陰影", change: { shadow: "off" } },
      { id: "msaa1", label: "關閉 MSAA", change: { msaa: 1 } },
      { id: "nohdr", label: "後製不用 HDR", change: { hdr: false } },
      { id: "nopost", label: "關閉後製管線", change: { post: false } },
    );
  }
  s.push(
    { id: "nolod", label: "NPC 不用距離 LOD", change: { npcLod: false } },
    { id: "nochar", label: "隱藏 NPC 與洛恩", change: { hideCharacters: true } },
    { id: "nostatic", label: "隱藏建築與環境（只剩地面與角色）", change: { hideStatic: true } },
    { id: "cpu", label: "不繪製畫面（只量 CPU 邏輯）", change: { skipRender: true } },
  );
  return s;
}
