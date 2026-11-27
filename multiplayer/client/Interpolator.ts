/**
 * 遠端玩家平滑插值：以「伺服器時間 − 100 ms」播放，於兩筆快照之間線性插值位置、最短角度插值朝向。
 * 超過最新快照時，跑步中最多外插 200 ms，Idle 則停在原地。
 */
import { EXTRAPOLATE_MAX_MS } from "../shared/constants.ts";
import { angleDelta } from "../../src/core/math.ts";

export interface Sample {
  t: number;
  x: number;
  z: number;
  yaw: number;
  anim: number;
  speed: number;
  link: number;
  act?: number;
  actSeq?: number;
}

export interface Pose {
  x: number;
  z: number;
  yaw: number;
  anim: number;
  speed: number;
  link: number;
}

export class Interpolator {
  private readonly samples: Sample[] = [];

  push(s: Sample): void {
    const last = this.samples[this.samples.length - 1];
    if (last && s.t <= last.t) {
      // 同一時間的重複資料：以新的覆蓋
      if (s.t === last.t) this.samples[this.samples.length - 1] = s;
      return;
    }
    this.samples.push(s);
    while (this.samples.length > 2 && this.samples[1]!.t < s.t - 1500) this.samples.shift();
  }

  get latest(): Sample | undefined {
    return this.samples[this.samples.length - 1];
  }

  get count(): number {
    return this.samples.length;
  }

  sample(rt: number): Pose | null {
    const n = this.samples.length;
    if (n === 0) return null;
    const first = this.samples[0]!;
    if (rt <= first.t || n === 1) return { ...first };
    const last = this.samples[n - 1]!;
    if (rt >= last.t) {
      const prev = this.samples[n - 2]!;
      const ahead = Math.min(rt - last.t, EXTRAPOLATE_MAX_MS);
      if (last.anim !== 1 || last.t === prev.t || ahead <= 0) return { ...last };
      const k = ahead / (last.t - prev.t);
      return { ...last, x: last.x + (last.x - prev.x) * k, z: last.z + (last.z - prev.z) * k };
    }
    let i = n - 2;
    while (i > 0 && this.samples[i]!.t > rt) i--;
    const a = this.samples[i]!;
    const b = this.samples[i + 1]!;
    const u = (rt - a.t) / (b.t - a.t);
    return {
      x: a.x + (b.x - a.x) * u,
      z: a.z + (b.z - a.z) * u,
      yaw: a.yaw + angleDelta(a.yaw, b.yaw) * u,
      anim: u < 0.5 ? a.anim : b.anim,
      speed: a.speed + (b.speed - a.speed) * u,
      link: b.link,
    };
  }
}
