/**
 * 一步移動模擬（伺服器權威計算與客戶端預測共用同一個函式，保證結果一致）。
 * 規則與單機版 VillageGame／StarsproutGame 每幀移動相同：
 *   速度 = MOVE_SPEED × 推動量；推動量 ≤ 0.05 不移動；碰撞用地圖原本的解算函式；朝移動方向平滑轉身。
 */
import { turnTowards } from "../../src/actors/movement.ts";
import { MOVE_DEADZONE, MOVE_SPEED, STEP, TURN_SHARPNESS } from "./constants.ts";
import { ANIM, dequantizeDir, type AnimCode } from "./protocol.ts";
import type { MapAuthority } from "./maps.ts";

export interface MoveState {
  x: number;
  z: number;
  yaw: number;
  /** 這一步實際移動速度（公尺／秒） */
  speed: number;
  anim: AnimCode;
}

export function stepMove(s: MoveState, qx: number, qz: number, map: MapAuthority): void {
  const d = dequantizeDir(qx, qz);
  const amt = Math.min(1, Math.hypot(d.x, d.z));
  if (amt <= MOVE_DEADZONE) {
    s.speed = 0;
    s.anim = ANIM.Idle;
    return;
  }
  const ux = d.x / amt;
  const uz = d.z / amt;
  const dist = MOVE_SPEED * amt * STEP;
  const r = map.resolve(s.x, s.z, s.x + ux * dist, s.z + uz * dist);
  s.speed = Math.hypot(r.x - s.x, r.z - s.z) / STEP;
  s.x = r.x;
  s.z = r.z;
  // 朝向正規化到 (-π, π]，避免長時間轉圈後數值無限增大（伺服器與客戶端同一步驟，結果一致）
  const y = turnTowards(s.yaw, ux, uz, TURN_SHARPNESS, STEP);
  s.yaw = Math.atan2(Math.sin(y), Math.cos(y));
  s.anim = s.speed > 0.05 ? ANIM.Run : ANIM.Idle;
}

/** 把同方向的連續步驟壓成 [qx, qz, n] */
export function runLength(steps: readonly [number, number][]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const [x, z] of steps) {
    const last = out[out.length - 1];
    if (last && last[0] === x && last[1] === z && last[2] < 255) last[2]++;
    else out.push([x, z, 1]);
  }
  return out;
}
