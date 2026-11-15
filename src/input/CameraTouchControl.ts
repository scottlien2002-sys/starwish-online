import type { InputState } from "./InputState.ts";

interface TrackedPointer {
  x: number;
  y: number;
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
    target.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;

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
    this.target.removeEventListener("wheel", this.onWheel);
  }
}
