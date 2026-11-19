/**
 * 手機成本分析（共用、不依賴 Babylon）：同一畫面依序暫時關掉一項功能，各測幾秒，比較 FPS。
 * 哪一項關掉後 FPS 上升最多，就是那一項最花效能。每一步測完都會還原。
 *
 * 使用方式：提供步驟（名稱＋開啟／還原函式）與量測函式（通常是 FrameRecorder 的 10 秒測試縮短版）。
 * 任何怪物或場景都可用；步驟內容由呼叫端決定（例如「關閉果凍星雲」只對果凍系有意義）。
 */
export interface CostStep {
  name: string;
  apply(): void;
  restore(): void;
}

export interface CostMeasure {
  avgFps: number;
  low1Fps: number;
  avgDrawCalls: number;
}

export interface CostRow {
  name: string;
  avg: number;
  low1: number;
  draws: number;
  /** 與第一步（目前設定）相比，平均 FPS 增加多少 */
  gain: number;
}

export async function runCostSteps(
  steps: readonly CostStep[],
  measure: () => Promise<CostMeasure>,
  onStep?: (name: string, i: number) => void,
  settle: () => Promise<void> = () => Promise.resolve(),
): Promise<CostRow[]> {
  const rows: CostRow[] = [];
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i]!;
    onStep?.(st.name, i);
    st.apply();
    try {
      await settle();
      const m = await measure();
      rows.push({ name: st.name, avg: m.avgFps, low1: m.low1Fps, draws: m.avgDrawCalls, gain: 0 });
    } finally {
      st.restore();
    }
  }
  const base = rows[0]?.avg ?? 0;
  for (const r of rows) r.gain = r.avg - base;
  return rows;
}

export function formatCostRows(rows: readonly CostRow[]): string[] {
  return rows.map((r, i) =>
    i === 0
      ? `${r.name}：平均 ${r.avg.toFixed(1)}・1% ${r.low1.toFixed(1)}・Draw ${r.draws.toFixed(0)}`
      : `${r.name}：平均 ${r.avg.toFixed(1)}（${r.gain >= 0 ? "+" : ""}${r.gain.toFixed(1)}）・1% ${r.low1.toFixed(1)}・Draw ${r.draws.toFixed(0)}`,
  );
}
