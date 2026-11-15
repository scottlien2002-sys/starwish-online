/**
 * 效能測試統計（純函式，可單元測試）。
 * 以瀏覽器實際每幀的時間差計算；前段暖機時間不計入。
 */
export interface BenchmarkSummary {
  seconds: number;
  frames: number;
  avgFps: number;
  /** 最慢 1% 影格的 FPS（第 99 百分位的影格時間換算） */
  low1Fps: number;
  minFps: number;
  avgDrawCalls: number;
  maxDrawCalls: number;
}

export function summarizeFrames(dts: readonly number[], drawCalls: readonly number[]): BenchmarkSummary {
  const sorted = [...dts].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  const n = sorted.length;
  const p99 = n ? sorted[Math.min(n - 1, Math.floor(n * 0.99))]! : 0;
  const draws = drawCalls.length ? drawCalls.reduce((a, b) => a + b, 0) / drawCalls.length : 0;
  return {
    seconds: Math.round(total * 10) / 10,
    frames: n,
    avgFps: n ? n / Math.max(total, 1e-6) : 0,
    low1Fps: p99 > 0 ? 1 / p99 : 0,
    minFps: n ? 1 / sorted[n - 1]! : 0,
    avgDrawCalls: draws,
    maxDrawCalls: drawCalls.length ? Math.max(...drawCalls) : 0,
  };
}

/** 逐幀收集：start → record(每幀) → done 時回傳摘要 */
export class FrameRecorder {
  private readonly warmup: number;
  private readonly target: number;
  private elapsed = 0;
  private readonly dts: number[] = [];
  private readonly draws: number[] = [];

  constructor(seconds: number, warmup = 0.5) {
    this.target = seconds;
    this.warmup = warmup;
  }

  /** 進度 0..1（含暖機） */
  get progress(): number {
    return Math.min(1, this.elapsed / (this.target + this.warmup));
  }

  /** 回傳 true 表示已收集完畢 */
  record(rawDt: number, drawCalls: number): boolean {
    this.elapsed += rawDt;
    if (this.elapsed > this.warmup) {
      this.dts.push(rawDt);
      this.draws.push(drawCalls);
    }
    return this.elapsed >= this.target + this.warmup;
  }

  summary(): BenchmarkSummary {
    return summarizeFrames(this.dts, this.draws);
  }
}
