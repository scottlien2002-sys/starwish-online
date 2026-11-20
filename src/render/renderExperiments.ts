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
}

export function renderExperimentsFromSearch(search: string): RenderExperiments {
  const q = new URLSearchParams(search);
  const opt = (q.get("opt") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is OptKey => (OPT_KEYS as readonly string[]).includes(s));
  const d = q.get("diag");
  const diag = d && (DIAG_KEYS as readonly string[]).includes(d) ? (d as DiagKey) : null;
  return { opt: [...new Set(opt)], diag };
}

/** 結果與面板用的簡短標記；沒有實驗時為空字串 */
export function experimentTag(e: RenderExperiments): string {
  const parts = [...e.opt.map((o) => `opt:${o}`), ...(e.diag ? [`diag:${e.diag}`] : [])];
  return parts.join("+");
}

export function experimentLabels(e: RenderExperiments): string[] {
  return [...e.opt.map((o) => OPT_LABEL[o]), ...(e.diag ? [DIAG_LABEL[e.diag]] : [])];
}
