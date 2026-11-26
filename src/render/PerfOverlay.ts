import { type Engine, type Scene, SceneInstrumentation } from "@babylonjs/core";
import { QUALITY_LABEL, type QualitySettings, nextQuality, resolutionSteps } from "./quality.ts";
import { switchQuality } from "./RenderQuality.ts";

export interface PerfStats {
  fps: number;
  drawCalls: number;
  activeMeshes: number;
  pixelRatio: number;
  quality: string;
}

/**
 * 效能資訊面板（FPS、Draw Calls、Active Meshes、解析度、畫質）＋ 畫質切換按鈕，
 * 並負責動態解析度：連續 2 秒低於 40 FPS 就降一級（沿用原本的機制）。
 * 顯示的 FPS 是當下瀏覽器實際量到的數字。
 */
export class PerfOverlay {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly q: QualitySettings;
  private readonly instr: SceneInstrumentation;
  private readonly el: HTMLDivElement;
  private readonly text: HTMLDivElement;
  private readonly steps: number[];
  private stepIndex = 0;
  private lowFps = 0;
  private cooldown = 3;
  private uiTimer = 0;
  private last: PerfStats;

  constructor(engine: Engine, scene: Scene, q: QualitySettings, parent: HTMLElement) {
    this.engine = engine;
    this.scene = scene;
    this.q = q;
    this.instr = new SceneInstrumentation(scene);
    this.steps = resolutionSteps(window.devicePixelRatio || 1, q.maxPixelRatio);
    engine.setHardwareScalingLevel(1 / this.steps[0]!);

    this.el = document.createElement("div");
    this.el.className = "perf-panel";
    this.text = document.createElement("div");
    this.text.className = "perf-text";
    // 版面檢查標記放在文字與按鈕（兩個同層元件），不放在外框，避免外框與內部按鈕被判定重疊
    this.text.dataset.layout = "perf-text";
    const btn = document.createElement("button");
    btn.className = "perf-quality";
    btn.dataset.layout = "btn-quality";
    btn.textContent = `畫質：${QUALITY_LABEL[q.level]}`;
    btn.setAttribute("aria-label", "切換畫質（高、中、低）");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      switchQuality(nextQuality(q.level));
    });
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.el.append(this.text, btn);
    parent.appendChild(this.el);
    this.last = this.read();
  }

  private resolutionLocked = false;

  // ---- Stage 7.1：平均 FPS（不是瞬間讀數）----
  /** 最近的每幀時間（毫秒，環狀，約 10 秒） */
  private readonly ring = new Float32Array(1200);
  private ringN = 0;
  private ringI = 0;
  /** 本頁（或重新量測後）的累計 */
  private sessFrames = 0;
  private sessMs = 0;
  private sessSlow = 0;
  private sessFrameMs: number[] = [];
  private labels: { model: string; map: string } | null = null;

  /** 顯示模型 LOD 與地圖（只有完整遊戲頁使用；畫質另外顯示） */
  setLabels(l: { model: string; map: string }): void {
    this.labels = l;
  }

  /** 最近 sec 秒的平均 FPS（以實際每幀時間計算） */
  avgFps(sec = 5): number {
    let ms = 0;
    let n = 0;
    for (let k = 0; k < this.ringN && ms < sec * 1000; k++) {
      ms += this.ring[(this.ringI - 1 - k + this.ring.length) % this.ring.length]!;
      n++;
    }
    return ms > 0 ? (n * 1000) / ms : this.engine.getFps();
  }

  /** 重新開始累計量測 */
  resetSession(): void {
    this.sessFrames = 0;
    this.sessMs = 0;
    this.sessSlow = 0;
    this.sessFrameMs = [];
  }

  /** 累計量測報告：平均 FPS、1% Low、最低、卡頓（>50 ms）、秒數 */
  session(): { seconds: number; frames: number; avgFps: number; low1: number; minFps: number; hitches: number; pixelRatio: number; quality: string; model: string; map: string } {
    const sorted = [...this.sessFrameMs].sort((a, b) => b - a);
    const worst1 = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 100)));
    const w = worst1.length ? worst1.reduce((a, b) => a + b, 0) / worst1.length : 0;
    return {
      seconds: Math.round(this.sessMs / 100) / 10,
      frames: this.sessFrames,
      avgFps: this.sessMs > 0 ? Math.round(((this.sessFrames * 1000) / this.sessMs) * 10) / 10 : 0,
      low1: w > 0 ? Math.round((1000 / w) * 10) / 10 : 0,
      minFps: sorted.length ? Math.round((1000 / sorted[0]!) * 10) / 10 : 0,
      hitches: this.sessSlow,
      pixelRatio: this.pixelRatio,
      quality: this.q.level,
      model: this.labels?.model ?? "",
      map: this.labels?.map ?? "",
    };
  }

  private recordFrame(): void {
    const ms = this.engine.getDeltaTime();
    if (!(ms > 0) || ms > 2000) return; // 分頁切到背景等情況不算
    this.ring[this.ringI] = ms;
    this.ringI = (this.ringI + 1) % this.ring.length;
    this.ringN = Math.min(this.ringN + 1, this.ring.length);
    this.sessFrames++;
    this.sessMs += ms;
    if (ms > 50) this.sessSlow++;
    if (this.sessFrameMs.length < 36000) this.sessFrameMs.push(ms);
  }

  /** 測試截圖用：固定解析度（不做動態降解析度），讓不同畫質的截圖可比較 */
  lockResolution(ratio: number | null): void {
    this.resolutionLocked = ratio !== null;
    if (ratio !== null) this.engine.setHardwareScalingLevel(1 / ratio);
  }

  /** 上一幀的 Draw Calls（效能測試逐幀讀取；不建立物件） */
  get drawCalls(): number {
    return this.instr.drawCallsCounter.current;
  }

  get pixelRatio(): number {
    return this.steps[this.stepIndex]!;
  }

  /** 每幀呼叫（render 之後） */
  update(dt: number): void {
    this.recordFrame();
    const fps = this.engine.getFps();
    this.cooldown -= dt;
    this.lowFps = fps < 40 ? this.lowFps + dt : 0;
    if (!this.resolutionLocked && this.lowFps > 2 && this.cooldown <= 0 && this.stepIndex < this.steps.length - 1) {
      this.stepIndex++;
      this.engine.setHardwareScalingLevel(1 / this.steps[this.stepIndex]!);
      this.lowFps = 0;
      this.cooldown = 3;
    }
    this.uiTimer += dt;
    if (this.uiTimer >= 0.5) {
      this.uiTimer = 0;
      this.last = this.read();
      const s = this.last;
      this.text.innerHTML = this.labels
        ? `FPS ${Math.round(s.fps)}｜平均 ${Math.round(this.avgFps(5))}<br>Draw ${s.drawCalls}｜${Math.round(this.scene.getActiveIndices() / 3000)}k<br>${s.pixelRatio}x｜模型 ${this.labels.model}`
        : `FPS ${Math.round(s.fps)}<br>Draw ${s.drawCalls}<br>Tri ${(this.scene.getActiveIndices() / 3000).toFixed(1)}k<br>Mesh ${s.activeMeshes}<br>${s.pixelRatio}x`;
    }
  }

  stats(): PerfStats {
    return this.read();
  }

  private read(): PerfStats {
    return {
      fps: this.engine.getFps(),
      drawCalls: this.instr.drawCallsCounter.current,
      activeMeshes: this.scene.getActiveMeshes().length,
      pixelRatio: this.pixelRatio,
      quality: this.q.level,
    };
  }
}
