import type { BenchmarkSummary } from "../render/benchmark.ts";
import { PROFILE_SECTIONS, SECTION_LABEL, type ProfileWindow } from "../render/frameProfiler.ts";

/**
 * 遊戲內效能測試（?bench=1）— 純資料與邏輯，不依賴 Babylon，可單元測試。
 *
 * 流程：載入完成 → 固定場景（玩家在出生點、鏡頭固定、3 隻怪物固定位置待機、AI 與戰鬥暫停、解析度固定）
 *       → 暖機（預設 3 秒，排除首次載入與著色器編譯）→ 測量（預設 10 秒）→ 顯示結果。
 * 測量期間畫面上只有一段不更新的提示文字，不額外增加更新成本。
 */

export interface BenchOptions {
  seconds: number;
  warmup: number;
  /** 調查用（&benchprof=1）：同時記錄每幀 CPU 分段時間 */
  profile: boolean;
  /**
   * 調查用（&benchres=1／1.25／1.5／2）：只在這次測試期間把渲染倍率固定為指定值，用來判斷是否受 GPU 填充率限制。
   * 不改畫質設定；測試結束後恢復。null = 預設（裝置像素比與畫質上限取小者）
   */
  res: number | null;
}

/** 解析網址參數；沒有 bench=1 時回傳 null（一般遊戲完全不受影響） */
export function benchOptionsFromSearch(search: string): BenchOptions | null {
  const q = new URLSearchParams(search);
  if (q.get("bench") !== "1") return null;
  const num = (k: string, def: number, min: number, max: number): number => {
    const v = Number(q.get(k));
    return Number.isFinite(v) && q.get(k) !== null && q.get(k) !== "" ? Math.min(max, Math.max(min, v)) : def;
  };
  const resRaw = Number(q.get("benchres"));
  const res = [1, 1.25, 1.5, 2].includes(resRaw) ? resRaw : null;
  return { seconds: num("benchsec", 10, 1, 60), warmup: num("warmup", 3, 0.5, 15), profile: q.get("benchprof") === "1", res };
}

/** 測試場景中 3 隻怪物的固定位置（相對玩家：前方 f 公尺、右方 r 公尺）；與畫質比對截圖相同 */
export const BENCH_SPOTS: readonly (readonly [number, number])[] = [
  [2.7, -1.15],
  [3.4, 0],
  [2.7, 1.15],
];

export interface BenchResult {
  variant: "v2" | "v38r";
  quality: "high" | "medium" | "low";
  pixelRatio: number;
  devicePixelRatio: number;
  width: number;
  height: number;
  warmup: number;
  summary: BenchmarkSummary;
  avgActiveMeshes: number;
  maxActiveMeshes: number;
  /** 測量結束時的場景物件數 */
  meshes: number;
  materials: number;
  textures: number;
  monsters: number;
  /** 渲染實驗標記（?opt=／?diag=；例 "opt:pcss32"）；一般測試沒有 */
  experiment?: string;
  /** 調查用：這次測試指定的渲染倍率（&benchres）；一般測試沒有 */
  resOverride?: number;
  /** 調查用：測量期間每幀 CPU 分段平均（&benchprof=1） */
  profile?: ProfileWindow;
  /** ISO 時間 */
  at: string;
  userAgent: string;
}

export const BENCH_STORAGE_KEY = "starwish.bench.v1";

export function benchKey(r: Pick<BenchResult, "variant" | "quality" | "resOverride" | "experiment">): string {
  // 指定渲染倍率、渲染實驗的結果另存，不覆蓋一般測試、不進入 V2／V3.8R 比較
  return `${r.variant}_${r.quality}${r.resOverride !== undefined ? `_r${r.resOverride}` : ""}${r.experiment ? `_${r.experiment}` : ""}`;
}

const VARIANT_LABEL = { v2: "V2", v38r: "V3.8R" } as const;
const QUALITY_LABEL = { high: "高", medium: "中", low: "低" } as const;

const f1 = (v: number | undefined): string => (v === undefined ? "—" : v.toFixed(1));
const f0 = (v: number | undefined): string => (v === undefined ? "—" : Math.round(v).toString());

/** 單次結果的文字列（結果面板與複製用） */
export function formatResult(r: BenchResult): string[] {
  const s = r.summary;
  const lines = [
    `${VARIANT_LABEL[r.variant]}・畫質${QUALITY_LABEL[r.quality]}・${r.pixelRatio}x${r.resOverride !== undefined ? "【調查：指定倍率】" : ""}${r.experiment ? `【實驗 ${r.experiment}】` : ""}（裝置 ${r.devicePixelRatio}x，${r.width}×${r.height}）`,
    `平均 ${f1(s.avgFps)} FPS／1% Low ${f1(s.low1Fps)}／最低 ${f1(s.minFps)}`,
    `最慢 1% 平均 ${f1(s.low1AvgFps)} FPS／第 99 百分位影格 ${f1(s.p99FrameMs)} ms／最長影格 ${f1(s.maxFrameMs)} ms`,
    `Draw Calls 平均 ${f1(s.avgDrawCalls)}・最高 ${f0(s.maxDrawCalls)}／Active Mesh 平均 ${f1(r.avgActiveMeshes)}・最高 ${f0(r.maxActiveMeshes)}`,
    `場景 Mesh ${r.meshes}・材質 ${r.materials}・貼圖 ${r.textures}・怪物 ${r.monsters} 隻`,
    `${s.frames} 幀／${s.seconds} 秒（暖機 ${r.warmup} 秒不計）`,
  ];
  const p = r.profile;
  if (p) {
    lines.push(`每幀：影格 ${f1(p.avgFrameMs)} ms ＝ CPU ${f1(p.cpuMs)} ms ＋ GPU／等待 ${f1(p.waitMs)} ms`);
    lines.push("CPU：" + PROFILE_SECTIONS.map((k) => `${SECTION_LABEL[k]} ${p.sections[k].toFixed(2)}`).join("・"));
  }
  return lines;
}

/** 同畫質 V2 與 V3.8R 的比較列（兩者都有結果時） */
export function compareRows(a: BenchResult | undefined, b: BenchResult | undefined): string[] | null {
  if (!a || !b) return null;
  const d = (x: number | undefined, y: number | undefined): string => (x === undefined || y === undefined ? "—" : `${y - x >= 0 ? "+" : ""}${(y - x).toFixed(1)}`);
  const sa = a.summary, sb = b.summary;
  return [
    `比較（畫質${QUALITY_LABEL[a.quality]}）：V2 → V3.8R`,
    `平均 FPS ${f1(sa.avgFps)} → ${f1(sb.avgFps)}（${d(sa.avgFps, sb.avgFps)}）`,
    `1% Low ${f1(sa.low1Fps)} → ${f1(sb.low1Fps)}（${d(sa.low1Fps, sb.low1Fps)}）`,
    `最低 ${f1(sa.minFps)} → ${f1(sb.minFps)}（${d(sa.minFps, sb.minFps)}）`,
    `Draw Calls 平均 ${f1(sa.avgDrawCalls)} → ${f1(sb.avgDrawCalls)}（${d(sa.avgDrawCalls, sb.avgDrawCalls)}）`,
    `Active Mesh 平均 ${f1(a.avgActiveMeshes)} → ${f1(b.avgActiveMeshes)}／場景 Mesh ${a.meshes} → ${b.meshes}`,
  ];
}

/** 同外觀、同畫質、同倍率：原始畫質（基準）與渲染實驗的比較列 */
export function compareExperimentRows(base: BenchResult | undefined, exp: BenchResult | undefined): string[] | null {
  if (!base || !exp || !exp.experiment) return null;
  const d = (x: number | undefined, y: number | undefined): string => (x === undefined || y === undefined ? "—" : `${y - x >= 0 ? "+" : ""}${(y - x).toFixed(1)}`);
  const sa = base.summary, sb = exp.summary;
  return [
    `比較（${VARIANT_LABEL[exp.variant]}・畫質${QUALITY_LABEL[exp.quality]}）：目前預設 → 實驗 ${exp.experiment}`,
    `平均 FPS ${f1(sa.avgFps)} → ${f1(sb.avgFps)}（${d(sa.avgFps, sb.avgFps)}）`,
    `1% Low ${f1(sa.low1Fps)} → ${f1(sb.low1Fps)}（${d(sa.low1Fps, sb.low1Fps)}）`,
    `最低 ${f1(sa.minFps)} → ${f1(sb.minFps)}（${d(sa.minFps, sb.minFps)}）`,
    `Draw Calls 平均 ${f1(sa.avgDrawCalls)} → ${f1(sb.avgDrawCalls)}`,
  ];
}

/** 讀寫保存的結果（每個「外觀＋畫質」保留最新一次）；無法存取時不影響測試 */
export function loadResults(storage: Pick<Storage, "getItem"> | null): Record<string, BenchResult> {
  try {
    const raw = storage?.getItem(BENCH_STORAGE_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" ? (v as Record<string, BenchResult>) : {};
  } catch {
    return {};
  }
}

export function saveResult(storage: Pick<Storage, "getItem" | "setItem"> | null, r: BenchResult): Record<string, BenchResult> {
  const all = loadResults(storage);
  all[benchKey(r)] = r;
  try {
    storage?.setItem(BENCH_STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* 私密瀏覽等情況無法儲存：只顯示本次結果 */
  }
  return all;
}

/** 切換到另一個外觀（保留畫質與其他參數）的測試網址 */
export function benchUrl(href: string, variant: "v2" | "v38r"): string {
  const u = new URL(href);
  u.searchParams.set("bench", "1");
  if (variant === "v38r") u.searchParams.set("bobo", "v38r");
  else u.searchParams.delete("bobo");
  return u.toString();
}
