/**
 * Stage 5.4 C1.0-B2 效能診斷第二輪 E2：不繪製任何 3D，只量 requestAnimationFrame（?lab=c10b&raf=1&round=2）。
 * 用來看「系統本身」在測試中是否降低畫面更新頻率；不建立 WebGL、不載入模型。
 * 報告格式與 3D 測試頁相同的部分：前／後 30 秒、每 30 秒、首次低於 45、間隔分布、冷卻、開始前狀態。
 */
import {
  type C10bOptions,
  c10dGroup,
  cooldownText,
  C10D_COOLDOWN_SEC,
  firstBelow,
  firstLastFps,
  intervalStats,
  rafFps,
  timeWindows,
  type TimedValue,
  windowAverages,
} from "../characters/noviceC10b.ts";

const DIAG_KEY = "starwish.c10bDiag"; // 與 3D 測試頁共用：冷卻時間與測試次數

interface RafResult {
  group: string;
  runNo: number;
  cooldownSec: number | null;
  startState: string;
  seconds: number;
  all: ReturnType<typeof intervalStats>;
  firstLast: ReturnType<typeof firstLastFps>;
  firstBelow45: number | null;
  w30: number[];
  w5: (number | null)[];
  view: string;
}

export interface RafProbeApi {
  ready: boolean;
  state(): { state: "rest" | "running" | "done"; progress: number; result: RafResult | null };
  report(): string;
}

declare global {
  interface Window {
    __starwishC10bRaf?: RafProbeApi;
  }
}

export function startRafProbe(canvas: HTMLCanvasElement, hudRoot: HTMLElement, opts: C10bOptions): void {
  canvas.style.visibility = "hidden"; // 沒有 3D，畫布不使用
  const readDiag = (): { lastEnd: number | null; runs: number } => {
    try {
      const v = JSON.parse(localStorage.getItem(DIAG_KEY) ?? "null") as { lastEnd?: number; runs?: number } | null;
      return { lastEnd: typeof v?.lastEnd === "number" ? v.lastEnd : null, runs: typeof v?.runs === "number" ? v.runs : 0 };
    } catch {
      return { lastEnd: null, runs: 0 };
    }
  };
  const writeDiag = (v: { lastEnd: number; runs: number }): void => {
    try {
      localStorage.setItem(DIAG_KEY, JSON.stringify(v));
    } catch {
      /* 無法儲存時略過 */
    }
  };
  const group = c10dGroup(opts);
  const seconds = opts.bench > 0 ? opts.bench : 120;

  const top = document.createElement("div");
  top.className = "v3-top";
  top.innerHTML = `<div class="lab-name">效能診斷 E2 <small>【${group}】不建立 3D，只量畫面更新（requestAnimationFrame）</small></div><div class="lab-state" data-raf-state>準備中…</div>`;
  hudRoot.append(top);
  const stateEl = top.querySelector("[data-raf-state]") as HTMLElement;

  const big = document.createElement("div");
  big.style.cssText = "position:absolute;left:0;right:0;top:38%;text-align:center;font:600 44px system-ui;color:#334;pointer-events:none";
  big.textContent = "—";
  hudRoot.append(big);

  const panel = document.createElement("div");
  panel.className = "lab-panel v3-expr";
  panel.style.gridTemplateColumns = "repeat(4, minmax(0, 1fr))";
  hudRoot.append(panel);
  const startState = { charge: "？", feel: "？", battery: "？" };
  const addBtn = (label: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.className = "lab-btn";
    b.textContent = label;
    b.addEventListener("click", fn);
    panel.append(b);
    return b;
  };
  const cycle = (key: keyof typeof startState, title: string, values: string[]): void => {
    const b = addBtn(`${title}：？`, () => {
      const i = values.indexOf(startState[key]);
      startState[key] = values[(i + 1) % values.length]!;
      b.textContent = `${title}：${startState[key]}`;
    });
    b.dataset.startState = key;
  };
  cycle("charge", "充電", ["否", "是"]);
  cycle("feel", "手感", ["冷", "溫", "熱"]);
  cycle("battery", "電量", ["80%以上", "50～79%", "20～49%", "20%以下"]);
  const result = document.createElement("div");
  result.className = "lab-bench-result";
  result.hidden = true;
  result.style.whiteSpace = "pre-wrap";
  result.style.maxHeight = "45vh";
  result.style.overflow = "auto";
  hudRoot.append(result);

  let state: "rest" | "running" | "done" = "rest";
  let pts: TimedValue[] = [];
  let t0 = 0;
  let prev = 0;
  let lastUi = 0;
  let res: RafResult | null = null;
  let cooldownAtStart: number | null = null;

  const fmt = (r: RafResult): string =>
    [
      `【${r.group}】本瀏覽器第 ${r.runNo} 次測試（${r.seconds} 秒）`,
      `  前 30 秒 ${r.firstLast.first} FPS → 最後 30 秒 ${r.firstLast.last} FPS（差距 ${r.firstLast.diff} FPS、${r.firstLast.diffPct}%）　首次低於 45 FPS：${r.firstBelow45 === null ? "未發生" : `第 ${r.firstBelow45} 秒`}（5 秒平均）`,
      `  畫面更新（rAF 時間戳）：平均 ${r.all.fps} FPS（${r.all.n} 次）｜每 30 秒 ${r.w30.map((w) => w.toFixed(1)).join(" → ")}`,
      `  間隔分布 ≤20/≤37/≤54/>54ms：${r.all.le20}/${r.all.le37}/${r.all.le54}/${r.all.gt54}`,
      `  每 5 秒：${r.w5.map((v) => v ?? "-").join(" ")}`,
      `  冷卻：距上一次測試結束 ${cooldownText(r.cooldownSec)}｜開始前 ${r.startState}`,
      `  畫面 ${r.view}｜Draw Calls 0（未建立 WebGL）｜Context Lost 不適用`,
    ].join("\n");
  const report = (): string =>
    [
      `星願物語 C1.0-B2 效能診斷報告　${group}　${new Date().toLocaleString()}`,
      `裝置：${navigator.userAgent}`,
      `螢幕：${screen.width}×${screen.height} @${window.devicePixelRatio}x　視窗 ${window.innerWidth}×${window.innerHeight}（${window.innerWidth < window.innerHeight ? "直向" : "橫向"}）　冷卻基準 ${C10D_COOLDOWN_SEC / 60} 分鐘`,
      res ? fmt(res) : `尚未完成（${state}）`,
    ].join("\n");

  const copyBtn = addBtn("複製報告", () => {
    const text = report();
    void navigator.clipboard?.writeText(text).then(
      () => {
        copyBtn.textContent = "已複製";
        setTimeout(() => (copyBtn.textContent = "複製報告"), 1500);
      },
      () => {
        result.hidden = false;
        result.textContent = text;
      }
    );
  });

  const tick = (ts: number): void => {
    if (state === "running") {
      if (prev > 0) pts.push({ t: (ts - t0) / 1000, v: ts - prev });
      prev = ts;
      const el = (ts - t0) / 1000;
      if (ts - lastUi >= 500) {
        lastUi = ts;
        const recent = pts.slice(-60).map((p) => p.v);
        big.textContent = `${intervalStats(recent).fps.toFixed(0)} FPS`;
        stateEl.textContent = `量測中 ${Math.min(100, Math.round((el / seconds) * 100))}%`;
      }
      if (el >= seconds) {
        state = "done";
        const dts = pts.map((p) => p.v / 1000);
        res = {
          group,
          runNo: readDiag().runs + 1,
          cooldownSec: cooldownAtStart,
          startState: `充電 ${startState.charge}｜手感 ${startState.feel}（主觀）｜電量 ${startState.battery}`,
          seconds,
          all: intervalStats(pts.map((p) => p.v)),
          firstLast: firstLastFps(dts, 30),
          firstBelow45: firstBelow(
            timeWindows(pts, 5, seconds, rafFps).map((w) => ({ t0: w.t0, fps: w.value ?? 0 })),
            45
          ),
          w30: windowAverages(dts, 30),
          w5: timeWindows(pts, 5, seconds, rafFps).map((w) => w.value),
          view: `${window.innerWidth}×${window.innerHeight}`,
        };
        writeDiag({ lastEnd: Date.now(), runs: res.runNo });
        result.hidden = false;
        result.textContent = `效能測試結果\n${fmt(res)}`;
        stateEl.textContent = "完成，請按「複製報告」";
        return;
      }
    }
    requestAnimationFrame(tick);
  };

  const begin = (): void => {
    const d = readDiag();
    cooldownAtStart = d.lastEnd === null ? null : Math.max(0, Math.round((Date.now() - d.lastEnd) / 1000));
    state = "running";
    pts = [];
    prev = 0;
    t0 = performance.now();
    requestAnimationFrame(tick);
  };
  if (opts.rest > 0) {
    stateEl.textContent = `休息 ${opts.rest} 秒後自動開始（可先填開始前狀態）…`;
    setTimeout(begin, opts.rest * 1000);
  } else begin();

  window.__starwishC10bRaf = {
    ready: true,
    state: () => ({ state, progress: state === "running" ? Math.min(1, (performance.now() - t0) / 1000 / seconds) : state === "done" ? 1 : 0, result: res }),
    report,
  };
}
