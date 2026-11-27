/**
 * 技能時間軸（純邏輯，可單元測試）：動作、特效、傷害共用這一個時鐘。
 * - 時間 t 是「動作片段時間」（秒，播放倍率 1）；實際秒數 = t / rate
 * - rate：受攻速影響的技能用 attackPlaybackRate(攻速)，攻速上限 160 → 最快 1.6 倍
 * - 打擊頓幀：hitstop(ms) 期間時鐘停住（動作、拖尾、後續事件都一起停），不影響已經飛出去的投射物
 * - 每個事件只觸發一次；一次 advance 跨過多個事件時依時間順序觸發，但遇到命中事件時時鐘停在命中時間（命中那一格一定畫出命中姿勢）
 */
import type { At, SkillDef, SkillEvent } from "./skills.ts";

export type Marks = Record<string, number | number[]>;

export interface ClipTiming {
  duration: number;
  marks: Marks;
  /** rootMotion：每格 [前進距離, 轉向弧度]（累積值，片段時間 times[i]） */
  times?: number[];
  rootMotion?: number[];
}

/** "hit1" → 0.17；"trail1.0" → trail1 的開始；數字直接用 */
export function resolveAt(at: At, marks: Marks): number {
  if (typeof at === "number") return at;
  const m = /^(.*)\.(\d)$/.exec(at);
  const base = m?.[1];
  if (m && base !== undefined) {
    const arr = marks[base];
    const v = Array.isArray(arr) ? arr[Number(m[2])] : undefined;
    if (typeof v === "number") return v;
  }
  const v = marks[at];
  if (typeof v === "number") return v;
  throw new Error(`unknown timing mark: ${String(at)}`);
}

export interface FiredEvent {
  /** 事件在片段內的時間（秒，倍率 1） */
  t: number;
  event: SkillEvent;
  /** trail 事件：結束時間 */
  end?: number;
}

export class SkillTimeline {
  readonly def: SkillDef;
  readonly clip: ClipTiming;
  readonly rate: number;
  /** 片段時間 */
  t = 0;
  private hitstopLeft = 0;
  private readonly queue: FiredEvent[];
  private nextIdx = 0;
  done = false;

  constructor(def: SkillDef, clip: ClipTiming, rate = 1) {
    this.def = def;
    this.clip = clip;
    this.rate = rate;
    this.queue = def.events
      .map((e): FiredEvent => {
        const at = e.kind === "trail" ? resolveAt(e.from, clip.marks) : resolveAt(e.at, clip.marks);
        const end = e.kind === "trail" ? resolveAt(e.to, clip.marks) : undefined;
        return { t: at, event: e, end };
      })
      .sort((a, b) => a.t - b.t);
  }

  /** 片段總長（實際秒數） */
  get realDuration(): number {
    return this.clip.duration / this.rate;
  }

  get frozen(): boolean {
    return this.hitstopLeft > 0;
  }

  hitstop(ms: number): void {
    this.hitstopLeft = Math.max(this.hitstopLeft, ms / 1000);
  }

  /** 前進 dt（實際秒）；回傳這段時間觸發的事件 */
  advance(dt: number): FiredEvent[] {
    if (this.done) return [];
    if (this.hitstopLeft > 0) {
      const used = Math.min(this.hitstopLeft, dt);
      this.hitstopLeft -= used;
      dt -= used;
      if (dt <= 0) return [];
    }
    this.t = Math.min(this.clip.duration, this.t + dt * this.rate);
    const out: FiredEvent[] = [];
    for (let e = this.queue[this.nextIdx]; e && e.t <= this.t + 1e-9; e = this.queue[this.nextIdx]) {
      out.push(e);
      this.nextIdx++;
      // 命中格對齊：時鐘停在命中時間（這一格畫出的就是命中姿勢），同一時間的其他事件一起觸發，之後的留到下一格
      if (e.event.kind === "hit") {
        this.t = e.t;
        for (let n = this.queue[this.nextIdx]; n && Math.abs(n.t - e.t) < 1e-9; n = this.queue[this.nextIdx]) {
          out.push(n);
          this.nextIdx++;
        }
        break;
      }
    }
    if (this.t >= this.clip.duration - 1e-9) this.done = true;
    return out;
  }

  /** 根運動（前進距離、轉向）在目前時間的值 */
  rootMotion(): { forward: number; yaw: number } {
    return sampleRoot(this.clip, this.t);
  }

  /** 所有命中事件的時間（實際秒，未含頓幀）— 測試與文件用 */
  hitTimesReal(): { id: string; t: number }[] {
    return this.queue.filter((e) => e.event.kind === "hit").map((e) => ({ id: (e.event as Extract<SkillEvent, { kind: "hit" }>).hit.id, t: e.t / this.rate }));
  }
}

export function sampleRoot(clip: ClipTiming, t: number): { forward: number; yaw: number } {
  const ts = clip.times;
  const rm = clip.rootMotion;
  if (!ts || !rm || ts.length === 0) return { forward: 0, yaw: 0 };
  const n = ts.length;
  const at = (i: number) => ({ f: rm[2 * i] ?? 0, y: rm[2 * i + 1] ?? 0, t: ts[i] ?? 0 });
  if (t <= at(0).t) return { forward: at(0).f, yaw: at(0).y };
  if (t >= at(n - 1).t) return { forward: at(n - 1).f, yaw: at(n - 1).y };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at(mid).t <= t) lo = mid;
    else hi = mid;
  }
  const A = at(lo);
  const B = at(hi);
  const k = (t - A.t) / (B.t - A.t);
  return { forward: A.f + (B.f - A.f) * k, yaw: A.y + (B.y - A.y) * k };
}
