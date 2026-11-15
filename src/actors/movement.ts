import { angleDelta, damp } from "../core/math.ts";

/**
 * 將搖桿輸入依攝影機方位轉成世界移動方向。
 * 座標系與 Babylon 相同：左手座標，y 向上，z 向前。
 * cameraForwardYaw：攝影機「看向」的水平方向角，atan2(dirX, dirZ)。
 */
export function inputToWorld(
  inputX: number,
  inputY: number,
  cameraForwardYaw: number,
): { x: number; z: number } {
  const sin = Math.sin(cameraForwardYaw);
  const cos = Math.cos(cameraForwardYaw);
  // forward = (sin, cos)，right = (cos, -sin)
  return {
    x: inputY * sin + inputX * cos,
    z: inputY * cos - inputX * sin,
  };
}

/** 角色面向（yaw）朝移動方向平滑轉動 */
export function turnTowards(currentYaw: number, dirX: number, dirZ: number, sharpness: number, dt: number): number {
  if (Math.hypot(dirX, dirZ) < 1e-4) return currentYaw;
  const target = Math.atan2(dirX, dirZ);
  return currentYaw + angleDelta(currentYaw, target) * damp(sharpness, dt);
}

export interface MoveStepInput {
  x: number;
  z: number;
  inputX: number;
  inputY: number;
  cameraForwardYaw: number;
  speed: number;
  dt: number;
}

export function moveStep(i: MoveStepInput): { x: number; z: number; dirX: number; dirZ: number } {
  const dir = inputToWorld(i.inputX, i.inputY, i.cameraForwardYaw);
  const len = Math.hypot(dir.x, dir.z);
  // 斜向不加速
  const scale = len > 1 ? 1 / len : 1;
  const dirX = dir.x * scale;
  const dirZ = dir.z * scale;
  // 防止切到背景回來時 dt 爆大，角色瞬移
  const dt = Math.min(i.dt, 0.1);
  return { x: i.x + dirX * i.speed * dt, z: i.z + dirZ * i.speed * dt, dirX, dirZ };
}
