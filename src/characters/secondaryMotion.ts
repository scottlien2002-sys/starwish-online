/**
 * Stage 7.5：頭髮、兜帽的輕量次級動態（彈簧，不是物理模擬）。
 * 新版男性初心者 GLB 有輔助骨骼：Hair_Back（頭）、Hood（上胸）；衣襬 Hem_F／Hem_B 的擺動已烘焙在動作裡。
 * 每格只做幾次乘加（每根骨骼一個 2 軸阻尼彈簧），沒有額外 draw call，iPhone 負擔可以忽略。
 *
 * 輸入：角色在世界中的速度與轉向（由遊戲移動系統提供）→ 角色本地的前後、左右加速度與轉向角速度
 * 輸出：每根輔助骨骼的小角度偏移（前後擺 pitch、左右擺 roll，弧度；有上限，不會誇張晃動或穿進頭部）
 */
export interface SpringSpec {
  /** 對加速度的反應（弧度／(m/s²)） */
  gain: number;
  /** 對轉向角速度的反應（弧度／(rad/s)） */
  turnGain: number;
  /** 自然頻率（Hz）與阻尼比 */
  freq: number;
  damping: number;
  /** 角度上限（弧度） */
  limit: number;
  /** 跑步時的持續後傾（弧度／(m/s)）：頭髮、兜帽被風往後吹 */
  speedLean: number;
}

export const SPRINGS: Readonly<Record<"Hair_Back" | "Hood", SpringSpec>> = Object.freeze({
  Hair_Back: Object.freeze({ gain: 0.035, turnGain: 0.07, freq: 2.6, damping: 0.32, limit: 0.22, speedLean: 0.018 }),
  Hood: Object.freeze({ gain: 0.03, turnGain: 0.05, freq: 2.0, damping: 0.4, limit: 0.18, speedLean: 0.012 }),
});

export class Spring2 {
  pitch = 0;
  roll = 0;
  private vp = 0;
  private vr = 0;
  readonly spec: SpringSpec;
  constructor(spec: SpringSpec) {
    this.spec = spec;
  }

  /** accFwd／accSide：角色本地加速度（m/s²）；turnRate：轉向角速度（rad/s）；speed：水平速度（m/s） */
  step(dt: number, accFwd: number, accSide: number, turnRate: number, speed: number): void {
    const s = this.spec;
    const w = 2 * Math.PI * s.freq;
    // 往前加速 → 頭髮往後甩（pitch 往後為正）；轉向 → 往外側甩
    const targetP = s.gain * accFwd + s.speedLean * speed;
    const targetR = -s.gain * accSide - s.turnGain * turnRate;
    // 半隱式歐拉（穩定，dt 大也不會爆）；dt 分段最多 1/30 秒
    let left = Math.min(dt, 0.1);
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 30);
      this.vp += (w * w * (targetP - this.pitch) - 2 * s.damping * w * this.vp) * h;
      this.vr += (w * w * (targetR - this.roll) - 2 * s.damping * w * this.vr) * h;
      this.pitch += this.vp * h;
      this.roll += this.vr * h;
      left -= h;
    }
    this.pitch = Math.max(-s.limit, Math.min(s.limit, this.pitch));
    this.roll = Math.max(-s.limit, Math.min(s.limit, this.roll));
  }
}

/** 從世界位置與朝向（yaw）估計角色本地加速度、轉向角速度 */
export class MotionProbe {
  private px = 0;
  private pz = 0;
  private vx = 0;
  private vz = 0;
  private yaw = 0;
  private started = false;
  accFwd = 0;
  accSide = 0;
  turnRate = 0;
  speed = 0;

  sample(dt: number, x: number, z: number, yaw: number): void {
    if (!this.started || dt <= 0) {
      this.px = x;
      this.pz = z;
      this.yaw = yaw;
      this.started = true;
      return;
    }
    const vx = (x - this.px) / dt;
    const vz = (z - this.pz) / dt;
    // 加速度做一點平滑（每格位置有量化誤差）
    const ax = (vx - this.vx) / dt;
    const az = (vz - this.vz) / dt;
    const k = Math.min(1, dt * 12);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    this.accFwd += (Math.max(-30, Math.min(30, ax * fx + az * fz)) - this.accFwd) * k;
    this.accSide += (Math.max(-30, Math.min(30, ax * fz - az * fx)) - this.accSide) * k;
    let dy = yaw - this.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    this.turnRate += (Math.max(-12, Math.min(12, dy / dt)) - this.turnRate) * k;
    this.speed = Math.hypot(vx, vz);
    this.px = x;
    this.pz = z;
    this.vx = vx;
    this.vz = vz;
    this.yaw = yaw;
  }
}
