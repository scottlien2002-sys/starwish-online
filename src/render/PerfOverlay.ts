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
    this.el.dataset.layout = "perf-panel";
    this.text = document.createElement("div");
    this.text.className = "perf-text";
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

  get pixelRatio(): number {
    return this.steps[this.stepIndex]!;
  }

  /** 每幀呼叫（render 之後） */
  update(dt: number): void {
    const fps = this.engine.getFps();
    this.cooldown -= dt;
    this.lowFps = fps < 40 ? this.lowFps + dt : 0;
    if (this.lowFps > 2 && this.cooldown <= 0 && this.stepIndex < this.steps.length - 1) {
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
      this.text.innerHTML = `FPS ${Math.round(s.fps)}<br>Draw ${s.drawCalls}<br>Mesh ${s.activeMeshes}<br>${s.pixelRatio}x`;
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
