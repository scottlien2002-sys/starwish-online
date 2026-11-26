// 星芽村自動巡迴測試（純邏輯，不依賴 Babylon；測試頁與單元測試共用）
// - 路線：南門抵達點 → 廣場南 → 依方位順時針經過每位 NPC 門前與北、東、西傳送門前 → 回到抵達點
// - 抵達路線點時重設進度紀錄（V1.3 修正：舊版沒重設，造成「卡住」誤判並跳點）
// - 「真正卡住」：4 秒內離目標沒有更近，而且最近 2 秒實際位移 < 0.5 m → 記錄並跳到下一點（避免巡迴停住）
// - 「腳本誤報（進度逾時）」：4 秒內沒有更近，但角色仍在移動 → 只記錄，不跳點
// 這裡只判斷與記錄；角色移動、碰撞、鏡頭都由遊戲本身處理，沒有任何修改。

export interface TourPoint {
  x: number;
  z: number;
  label: string;
}

export interface TourEvent {
  kind: "stuck" | "timeout";
  loop: number;
  leg: string;
  from: string;
  to: string;
  target: [number, number];
  x: number;
  y: number;
  z: number;
  /** 從最後一次有進度到判定的秒數 */
  duration: number;
  /** 判定前 2 秒的實際位移（公尺）與平均速度 */
  moved2s: number;
  speed: number;
  /** 本段碰撞滑動幀數 */
  blockedFrames: number;
}

interface Npc {
  x: number;
  z: number;
  yaw: number;
  name: string;
}
interface Portal {
  id: string;
  name: string;
  bearing: number;
}

/** 巡迴路線（與 V1.3 灰盒版本相同的點與順序） */
export function tourPoints(npcs: readonly Npc[], portals: readonly Portal[], arrival: { x: number; z: number }): TourPoint[] {
  const pts: TourPoint[] = [
    { x: arrival.x, z: arrival.z, label: "南門抵達點" },
    { x: 0, z: -16, label: "廣場南" },
  ];
  const stops = [
    ...npcs.map((n) => ({ x: n.x + Math.sin(n.yaw) * 1.8, z: n.z + Math.cos(n.yaw) * 1.8, a: Math.atan2(n.x, n.z), label: `${n.name.replace("（鍛造台旁）", "")}前` })),
    ...portals
      .filter((p) => p.id !== "south")
      .map((p) => {
        const t = (p.bearing * Math.PI) / 180;
        return { x: 38 * Math.sin(t), z: 38 * Math.cos(t), a: t, label: `${p.name}前` };
      }),
  ].sort((a, b) => (((a.a * 180) / Math.PI + 540) % 360) - (((b.a * 180) / Math.PI + 540) % 360));
  for (const s of stops) {
    // 先走到環形廣場上該方位（r 14），再到目的地，再回到環上
    const ring = { x: 14 * Math.sin(s.a), z: 14 * Math.cos(s.a), label: `環上（${s.label.replace(/前$/, "")}）` };
    pts.push(ring, { x: s.x, z: s.z, label: s.label }, { ...ring });
  }
  pts.push({ x: 0, z: -16, label: "廣場南" }, { x: arrival.x, z: arrival.z, label: "南門抵達點" });
  return pts;
}

export interface TourOptions {
  warmup?: number;
  reachR?: number;
  timeout?: number;
  stuckMove?: number;
  maxEvents?: number;
  /** 只給單元測試重現舊版錯誤用；正式一律 true */
  resetOnReach?: boolean;
}

export class TourRunner {
  phase: "warmup" | "running" | "done" = "warmup";
  loop = 0;
  idx = 1;
  t = 0;
  loopT = 0;
  readonly loopTimes: number[] = [];
  readonly events: TourEvent[] = [];
  stuckCount = 0;
  timeoutCount = 0;
  totalBlockedFrames = 0;
  private warm = 0;
  private lastDist = Number.POSITIVE_INFINITY;
  private lastProgressT = 0;
  private timeoutFlagged = false;
  private legBlocked = 0;
  private hist: { t: number; x: number; z: number }[] = [];
  private readonly o: Required<TourOptions>;
  readonly pts: readonly TourPoint[];
  readonly loops: number;

  constructor(pts: readonly TourPoint[], loops: number, opts: TourOptions = {}) {
    this.pts = pts;
    this.loops = loops;
    this.o = { warmup: 2, reachR: 0.6, timeout: 4, stuckMove: 0.5, maxEvents: 20, resetOnReach: true, ...opts };
  }

  get target(): TourPoint {
    return this.pts[Math.min(this.idx, this.pts.length - 1)]!;
  }

  /** 移動前呼叫：回傳要走的單位方向；抵達路線點時換下一點並重設進度 */
  steer(x: number, z: number): { x: number; z: number } | null {
    if (this.phase !== "running") return null;
    const tg = this.pts[this.idx]!;
    const dx = tg.x - x;
    const dz = tg.z - z;
    const d = Math.hypot(dx, dz);
    if (d < this.o.reachR) {
      this.advance();
      return null;
    }
    return { x: dx / d, z: dz / d };
  }

  /** 移動後呼叫：記錄時間、判斷卡住或誤報 */
  record(rawDt: number, x: number, y: number, z: number, blocked: boolean): void {
    if (this.phase === "warmup") {
      this.warm += rawDt;
      if (this.warm >= this.o.warmup) {
        this.phase = "running";
        this.lastProgressT = this.t;
      }
      return;
    }
    if (this.phase !== "running") return;
    this.t += rawDt;
    this.loopT += rawDt;
    if (blocked) {
      this.legBlocked++;
      this.totalBlockedFrames++;
    }
    this.hist.push({ t: this.t, x, z });
    while (this.hist.length > 2 && this.hist[1]!.t <= this.t - 2) this.hist.shift();
    const tg = this.target;
    const d = Math.hypot(tg.x - x, tg.z - z);
    if (d < this.lastDist - 0.2) {
      this.lastDist = d;
      this.lastProgressT = this.t;
      this.timeoutFlagged = false;
      return;
    }
    const idle = this.t - this.lastProgressT;
    if (idle <= this.o.timeout) return;
    const past = this.hist[0]!;
    const moved2s = Math.hypot(x - past.x, z - past.z);
    const span = Math.max(1e-3, this.t - past.t);
    const ev = (kind: TourEvent["kind"]): TourEvent => {
      const prev = this.pts[this.idx - 1]!;
      return {
        kind,
        loop: this.loop + 1,
        leg: `${this.idx - 1}→${this.idx}`,
        from: prev.label,
        to: tg.label,
        target: [round(tg.x), round(tg.z)],
        x: round(x),
        y: round(y),
        z: round(z),
        duration: round(idle),
        moved2s: round(moved2s),
        speed: round(moved2s / span),
        blockedFrames: this.legBlocked,
      };
    };
    if (moved2s < this.o.stuckMove) {
      // 真正卡住：記錄，跳到下一點讓巡迴繼續
      this.stuckCount++;
      if (this.events.length < this.o.maxEvents) this.events.push(ev("stuck"));
      this.advance();
    } else if (!this.timeoutFlagged) {
      // 腳本誤報：仍在移動，只記一次，不跳點
      this.timeoutCount++;
      this.timeoutFlagged = true;
      if (this.events.length < this.o.maxEvents) this.events.push(ev("timeout"));
    }
  }

  private advance(): void {
    this.idx++;
    this.legBlocked = 0;
    this.timeoutFlagged = false;
    if (this.o.resetOnReach) {
      this.lastDist = Number.POSITIVE_INFINITY;
      this.lastProgressT = this.t;
    }
    if (this.idx >= this.pts.length) {
      this.loopTimes.push(this.loopT);
      this.loop++;
      this.loopT = 0;
      this.idx = 1;
      this.lastDist = Number.POSITIVE_INFINITY;
      this.lastProgressT = this.t;
      if (this.loop >= this.loops) this.phase = "done";
    }
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
