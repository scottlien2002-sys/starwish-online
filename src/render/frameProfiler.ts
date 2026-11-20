/**
 * 每幀 CPU 時間分段統計（純邏輯，不依賴 Babylon，可單元測試）。
 * 只在 ?debug=1 或 ?bench=1&benchprof=1 時建立；一般遊戲不建立、不計時（零成本）。
 *
 * 用法：每幀 beginFrame() → mark("段落名") 依序呼叫 → endFrame(實際影格時間)。
 * 段落時間 = 這次 mark 與上一次 mark（或 beginFrame）之間的時間。
 * 「GPU／等待」= 實際影格時間 − 這一幀 CPU 計時總和（瀏覽器等待垂直同步或 GPU 完成的時間，無法再細分）。
 */

export const PROFILE_SECTIONS = ["input", "player", "monsters", "world", "render", "hud"] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export const SECTION_LABEL: Record<ProfileSection, string> = {
  input: "輸入與鏡頭",
  player: "玩家",
  monsters: "怪物（AI＋動畫）",
  world: "場景物件",
  render: "繪製提交（CPU）",
  hud: "介面",
};

export interface ProfileWindow {
  frames: number;
  /** 實際影格時間（毫秒） */
  avgFrameMs: number;
  maxFrameMs: number;
  /** 各段 CPU 平均時間（毫秒／幀） */
  sections: Record<ProfileSection, number>;
  /** CPU 計時總和（毫秒／幀） */
  cpuMs: number;
  /** 影格時間 − CPU 計時（毫秒／幀）：GPU 與等待 */
  waitMs: number;
}

export class FrameProfiler {
  private readonly now: () => number;
  private t0 = 0;
  private last = 0;
  private readonly cur = new Float64Array(PROFILE_SECTIONS.length);
  private readonly sum = new Float64Array(PROFILE_SECTIONS.length);
  private frameSum = 0;
  private frameMax = 0;
  private frames = 0;
  private cpuSum = 0;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  beginFrame(): void {
    this.t0 = this.last = this.now();
    this.cur.fill(0);
  }

  mark(section: ProfileSection): void {
    const t = this.now();
    this.cur[PROFILE_SECTIONS.indexOf(section)]! += t - this.last;
    this.last = t;
  }

  /** @param frameMs 實際影格時間（毫秒，例：engine.getDeltaTime()） */
  endFrame(frameMs: number): void {
    let cpu = 0;
    for (let i = 0; i < this.cur.length; i++) {
      this.sum[i]! += this.cur[i]!;
      cpu += this.cur[i]!;
    }
    this.cpuSum += cpu;
    this.frameSum += frameMs;
    if (frameMs > this.frameMax) this.frameMax = frameMs;
    this.frames++;
  }

  /** 取出目前視窗的平均並歸零（例：每 0.5 秒一次） */
  takeWindow(): ProfileWindow {
    const n = Math.max(1, this.frames);
    const sections = {} as Record<ProfileSection, number>;
    PROFILE_SECTIONS.forEach((k, i) => (sections[k] = this.sum[i]! / n));
    const avgFrameMs = this.frameSum / n;
    const cpuMs = this.cpuSum / n;
    const w: ProfileWindow = { frames: this.frames, avgFrameMs, maxFrameMs: this.frameMax, sections, cpuMs, waitMs: Math.max(0, avgFrameMs - cpuMs) };
    this.sum.fill(0);
    this.frameSum = 0;
    this.frameMax = 0;
    this.frames = 0;
    this.cpuSum = 0;
    return w;
  }
}

/** 解析度資訊：渲染像素數（百萬）與相對 1x 的倍數 */
export function resolutionInfo(cssW: number, cssH: number, renderW: number, renderH: number): { megapixels: number; scale: number } {
  const mp = (renderW * renderH) / 1e6;
  const base = Math.max(1, cssW * cssH);
  return { megapixels: Math.round(mp * 100) / 100, scale: Math.round(Math.sqrt((renderW * renderH) / base) * 100) / 100 };
}
