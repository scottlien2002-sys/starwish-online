import { computeJoystick } from "./joystick-math.ts";
import type { InputState } from "./InputState.ts";

/**
 * 浮動式虛擬搖桿：在左側區域任意位置按下即出現。
 * 使用 Pointer Events（iOS Safari 13+ 支援），支援多點觸控同時操作攝影機。
 */
export class VirtualJoystick {
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly zone: HTMLElement;
  private readonly input: InputState;
  private readonly radius: number;
  private readonly deadZone: number;

  constructor(zone: HTMLElement, input: InputState, radius: number, deadZone: number) {
    this.zone = zone;
    this.input = input;
    this.radius = radius;
    this.deadZone = deadZone;
    this.base = document.createElement("div");
    this.base.className = "joystick-base";
    this.base.style.width = this.base.style.height = `${radius * 2}px`;
    this.knob = document.createElement("div");
    this.knob.className = "joystick-knob";
    this.base.appendChild(this.knob);
    zone.appendChild(this.base);
    this.resetVisual();

    zone.addEventListener("pointerdown", this.onDown);
    zone.addEventListener("pointermove", this.onMove);
    zone.addEventListener("pointerup", this.onUp);
    zone.addEventListener("pointercancel", this.onUp);
    zone.addEventListener("lostpointercapture", this.onUp);
  }

  get active(): boolean {
    return this.pointerId !== null;
  }

  private onDown = (e: PointerEvent): void => {
    if (this.pointerId !== null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    try {
      this.zone.setPointerCapture(e.pointerId);
    } catch {
      /* 部分瀏覽器在合成事件時不支援 capture，可忽略 */
    }
    const rect = this.zone.getBoundingClientRect();
    // 保持搖桿底座完整在區域內
    this.originX = Math.min(Math.max(e.clientX, rect.left + this.radius), rect.right - this.radius);
    this.originY = Math.min(Math.max(e.clientY, rect.top + this.radius), rect.bottom - this.radius);
    this.base.classList.add("active");
    this.placeBase(this.originX - rect.left, this.originY - rect.top);
    this.update(e.clientX, e.clientY);
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.update(e.clientX, e.clientY);
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.input.moveX = 0;
    this.input.moveY = 0;
    this.base.classList.remove("active");
    this.resetVisual();
  };

  private update(x: number, y: number): void {
    const out = computeJoystick(this.originX, this.originY, x, y, this.radius, this.deadZone);
    this.input.moveX = out.x;
    this.input.moveY = out.y;
    this.knob.style.transform = `translate(${out.knobX}px, ${out.knobY}px)`;
  }

  private placeBase(localX: number, localY: number): void {
    this.base.style.left = `${localX - this.radius}px`;
    this.base.style.top = `${localY - this.radius}px`;
  }

  /** 未操作時顯示在區域左下的預設位置，提示玩家這裡是搖桿 */
  private resetVisual(): void {
    this.knob.style.transform = "translate(0px, 0px)";
    this.base.style.left = "";
    this.base.style.top = "";
  }

  dispose(): void {
    this.zone.removeEventListener("pointerdown", this.onDown);
    this.zone.removeEventListener("pointermove", this.onMove);
    this.zone.removeEventListener("pointerup", this.onUp);
    this.zone.removeEventListener("pointercancel", this.onUp);
    this.zone.removeEventListener("lostpointercapture", this.onUp);
    this.base.remove();
  }
}
