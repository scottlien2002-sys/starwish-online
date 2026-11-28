/**
 * 鏡頭震動（trauma 模型：強度平方決定位移，快速衰減）＋打擊頓幀計時。
 * 震動只加在鏡頭目標點的位移上，不改角色與判定。強度乘上品質倍率；可整個關掉（暈眩敏感的玩家）。
 */
import type { ArcRotateCamera } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core";

export class CameraFx {
  private trauma = 0;
  private t = 0;
  scale = 1;
  enabled = true;
  readonly offset = new Vector3();

  shake(amount: number): void {
    if (!this.enabled) return;
    this.trauma = Math.min(1, this.trauma + amount * this.scale);
  }

  /** 每幀：回傳要加在鏡頭目標上的位移 */
  update(dt: number, cam: ArcRotateCamera): Vector3 {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 2.2);
    const s = this.trauma * this.trauma * 0.22;
    const n = (k: number) => Math.sin(this.t * (41 + k * 13) + k * 1.7) * 0.6 + Math.sin(this.t * (67 + k * 7) + k) * 0.4;
    this.offset.set(n(1) * s, n(2) * s * 0.7, n(3) * s);
    void cam;
    return this.offset;
  }
}
