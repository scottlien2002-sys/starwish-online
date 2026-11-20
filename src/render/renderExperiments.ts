/**
 * 渲染效能實驗開關（純邏輯，可單元測試）。預設全部關閉：不加網址參數時，畫質與原本完全相同。
 *
 * 兩種用途，分開命名：
 * - opt＝候選優化（目標：畫面看不出差別，FPS 提升）。每次只加入一項，經使用者 iPhone A/B 驗收後才考慮成為預設
 * - diag＝診斷用（只為量測某個效果佔多少成本；畫面「會」改變，永遠不會成為設定）
 */

export const OPT_KEYS = ["pcss32"] as const;
export type OptKey = (typeof OPT_KEYS)[number];

export const DIAG_KEYS = ["noshadow", "nomsaa", "nohdr"] as const;
export type DiagKey = (typeof DIAG_KEYS)[number];

export const OPT_LABEL: Record<OptKey, string> = {
  pcss32: "柔和陰影取樣減半（PCSS 高 → 中品質，陰影類型與柔和範圍不變）",
};

export const DIAG_LABEL: Record<DiagKey, string> = {
  noshadow: "診斷：關閉陰影（畫面會改變）",
  nomsaa: "診斷：關閉 MSAA 抗鋸齒（畫面會改變）",
  nohdr: "診斷：後製改用 8 位元畫面（畫面可能改變）",
};

export interface RenderExperiments {
  opt: OptKey[];
  diag: DiagKey | null;
  /** 回退開關 ?shadowq=original：高畫質柔和陰影改回原本的高取樣品質（PCSS64） */
  shadowOriginal?: boolean;
}

/**
 * 高畫質柔和接觸陰影（PCSS）的取樣品質（Stage 5.3 正式整合）：
 * - V3.8R 高畫質：預設中品質（PCSS32；使用者 iPhone 固定場景實測 34.8 → 58.9 FPS 後決定整合）
 * - V2：維持原本高品質（V2 為回退外觀，與 main 相同）
 * - ?shadowq=original：回退為原本高品質（任何外觀）
 * - ?opt=pcss32：實驗開關，任何外觀都用中品質
 * - 中、低畫質使用 PCF，不受影響（回傳 null＝不更改）
 */
export function contactShadowQuality(filter: "contact" | "pcf", variant: "v2" | "v38r", e: RenderExperiments): "high" | "medium" | null {
  if (filter !== "contact") return null;
  if (e.shadowOriginal) return "high";
  if (e.opt.includes("pcss32")) return "medium";
  return variant === "v38r" ? "medium" : "high";
}

export function renderExperimentsFromSearch(search: string): RenderExperiments {
  const q = new URLSearchParams(search);
  const opt = (q.get("opt") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is OptKey => (OPT_KEYS as readonly string[]).includes(s));
  const d = q.get("diag");
  const diag = d && (DIAG_KEYS as readonly string[]).includes(d) ? (d as DiagKey) : null;
  return { opt: [...new Set(opt)], diag, ...(q.get("shadowq") === "original" ? { shadowOriginal: true } : {}) };
}

/** 結果與面板用的簡短標記；沒有實驗時為空字串 */
export function experimentTag(e: RenderExperiments): string {
  const parts = [...(e.shadowOriginal ? ["shadowq:original"] : []), ...e.opt.map((o) => `opt:${o}`), ...(e.diag ? [`diag:${e.diag}`] : [])];
  return parts.join("+");
}

export function experimentLabels(e: RenderExperiments): string[] {
  return [...(e.shadowOriginal ? ["回退：柔和陰影使用原本的高品質取樣（PCSS64）"] : []), ...e.opt.map((o) => OPT_LABEL[o]), ...(e.diag ? [DIAG_LABEL[e.diag]] : [])];
}
