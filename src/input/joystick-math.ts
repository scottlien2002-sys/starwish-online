import type { Vec2 } from "../core/math.ts";

export interface JoystickOutput extends Vec2 {
  /** 0~1 推桿力度（已扣除死區並重新映射） */
  magnitude: number;
  /** 搖桿頭相對中心的像素位移（用於畫面） */
  knobX: number;
  knobY: number;
}

/**
 * 將觸控點換算為搖桿輸出。
 * 螢幕座標 y 向下為正；輸出 y 向上（往前）為正。
 */
export function computeJoystick(
  originX: number,
  originY: number,
  pointerX: number,
  pointerY: number,
  radius: number,
  deadZone: number,
): JoystickOutput {
  const dx = pointerX - originX;
  const dy = pointerY - originY;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6 || radius <= 0) return { x: 0, y: 0, magnitude: 0, knobX: 0, knobY: 0 };

  const clamped = Math.min(dist, radius);
  const knobX = (dx / dist) * clamped;
  const knobY = (dy / dist) * clamped;

  const raw = clamped / radius;
  if (raw <= deadZone) return { x: 0, y: 0, magnitude: 0, knobX, knobY };

  const magnitude = Math.min(1, (raw - deadZone) / (1 - deadZone));
  return {
    x: (dx / dist) * magnitude,
    y: (-dy / dist) * magnitude,
    magnitude,
    knobX,
    knobY,
  };
}
