import type { InputState } from "./InputState.ts";

/** 電腦瀏覽器測試用：WASD / 方向鍵移動。搖桿操作中時以搖桿為準。 */
export class KeyboardInput {
  private readonly down = new Set<string>();
  private readonly input: InputState;
  private readonly isJoystickActive: () => boolean;

  constructor(input: InputState, isJoystickActive: () => boolean) {
    this.input = input;
    this.isJoystickActive = isJoystickActive;
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
    window.addEventListener("blur", this.onBlur);
  }

  private onKey = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (e.type === "keydown") this.down.add(k);
    else this.down.delete(k);
  };

  private onBlur = (): void => {
    this.down.clear();
  };

  /** 每幀呼叫 */
  update(): void {
    if (this.isJoystickActive()) return;
    let x = 0;
    let y = 0;
    if (this.down.has("a") || this.down.has("arrowleft")) x -= 1;
    if (this.down.has("d") || this.down.has("arrowright")) x += 1;
    if (this.down.has("w") || this.down.has("arrowup")) y += 1;
    if (this.down.has("s") || this.down.has("arrowdown")) y -= 1;
    const len = Math.hypot(x, y);
    this.input.moveX = len > 0 ? x / len : 0;
    this.input.moveY = len > 0 ? y / len : 0;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
    window.removeEventListener("blur", this.onBlur);
  }
}
