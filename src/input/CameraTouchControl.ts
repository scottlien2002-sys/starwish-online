import type { InputState } from "./InputState.ts";

interface TrackedPointer {
  x: number;
  y: number;
  /** 最後一次收到事件的時間（毫秒） */
  t: number;
}

/** 單一事件最大位移（像素）：避免指標恢復時一次跳很多造成鏡頭突然轉動 */
const MAX_STEP = 60;
/** 超過這麼久沒有任何事件的指標視為殘留（iOS 有時不送 pointerup） */
const STALE_MS = 2500;

function stamp(e: Event): number {
  return typeof e.timeStamp === "number" ? e.timeStamp : performance.now();
}

/**
 * 畫面空白處：單指拖曳旋轉視角、雙指縮放。滑鼠：拖曳旋轉、滾輪縮放。
 * 綁在 canvas 上；搖桿區與按鈕在 canvas 之上，不會觸發這裡。
 */
export class CameraTouchControl {
  private readonly pointers = new Map<number, TrackedPointer>();
  private lastPinch = 0;
  private readonly target: HTMLElement;
  private readonly input: InputState;
  private readonly rotateSensitivity: number;
  private readonly pitchSensitivity: number;
  private readonly pinchSensitivity: number;

  constructor(
    target: HTMLElement,
    input: InputState,
    rotateSensitivity: number,
    pitchSensitivity: number,
    pinchSensitivity: number,
  ) {
    this.target = target;
    this.input = input;
    this.rotateSensitivity = rotateSensitivity;
    this.pitchSensitivity = pitchSensitivity;
    this.pinchSensitivity = pinchSensitivity;
    target.addEventListener("pointerdown", this.onDown);
    target.addEventListener("pointermove", this.onMove);
    target.addEventListener("pointerup", this.onUp);
    target.addEventListener("pointercancel", this.onUp);
    target.addEventListener("lostpointercapture", this.onUp);
    target.addEventListener("wheel", this.onWheel, { passive: false });
  }

  /** 目前追蹤中的指標數（測試用） */
  get activePointers(): number {
    return this.pointers.size;
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    const now = stamp(e);
    // 新的一次觸控（第一根手指）開始時，清掉沒收到 pointerup 的殘留指標：
    // 否則下一次單指拖曳會被當成雙指縮放，鏡頭轉不動、只會忽遠忽近
    if (e.isPrimary) this.pointers.clear();
    for (const [id, p] of this.pointers) if (now - p.t > STALE_MS) this.pointers.delete(id);
    // 最多追蹤兩根手指（第三根之後忽略）
    if (this.pointers.size >= 2) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: now });
    try {
      this.target.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (this.pointers.size === 2) this.lastPinch = this.pinchDistance();
  };

  private onMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const dx = Math.max(-MAX_STEP, Math.min(MAX_STEP, e.clientX - p.x));
    const dy = Math.max(-MAX_STEP, Math.min(MAX_STEP, e.clientY - p.y));
    p.x = e.clientX;
    p.y = e.clientY;
    p.t = stamp(e);

    if (this.pointers.size === 1) {
      this.input.addCameraRotate(dx * this.rotateSensitivity, dy * this.pitchSensitivity);
    } else if (this.pointers.size === 2) {
      const d = this.pinchDistance();
      // 手指張開 = 拉近（距離變小）
      this.input.addZoom(-(d - this.lastPinch) * this.pinchSensitivity);
      this.lastPinch = d;
    }
  };

  private onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 2) this.lastPinch = this.pinchDistance();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.input.addZoom(Math.sign(e.deltaY) * 0.8);
  };

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  dispose(): void {
    this.target.removeEventListener("pointerdown", this.onDown);
    this.target.removeEventListener("pointermove", this.onMove);
    this.target.removeEventListener("pointerup", this.onUp);
    this.target.removeEventListener("pointercancel", this.onUp);
    this.target.removeEventListener("lostpointercapture", this.onUp);
    this.target.removeEventListener("wheel", this.onWheel);
  }
}
