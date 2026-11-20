import { summarizeFrames, type BenchmarkSummary } from "../render/benchmark.ts";

/**
 * 實際遊玩壓力測試（?autoplay=…）— 純邏輯，不依賴 Babylon，可單元測試。
 *
 * 遊戲自己操作（模擬搖桿與攻擊鍵），每次流程相同，可重複執行；只在網址有 autoplay 參數時啟用，正式遊戲不受影響。
 *   move   ：沿出生點周圍 8 個路徑點持續移動（測試 A：移動、轉向、鏡頭跟隨、卡住或瞬移）
 *   attack ：走向最近的存活怪物並持續按攻擊（測試 B：普通攻擊、傷害判定、冷卻；也是測試 D 多怪物戰鬥）
 *   soak   ：每 60 秒循環「移動 20 秒＋戰鬥 40 秒」（測試 E：長時間穩定性；建議 dur=900）
 * 怪物數量 count=3／5／10：只在測試模式生效（3 隻＝正式遊戲；5、10 隻＝獨立測試場景，不改正式設定）
 */

export type AutoplayMode = "move" | "attack" | "soak";

export interface AutoplayOptions {
  mode: AutoplayMode;
  /** 測量秒數（暖機後） */
  duration: number;
  warmup: number;
  /** 怪物數量（3＝正式遊戲） */
  count: 3 | 5 | 10;
}

export function autoplayOptionsFromSearch(search: string): AutoplayOptions | null {
  const q = new URLSearchParams(search);
  const m = q.get("autoplay");
  if (m !== "move" && m !== "attack" && m !== "soak") return null;
  const num = (k: string, def: number, min: number, max: number): number => {
    const raw = q.get(k);
    const v = Number(raw);
    return raw !== null && raw !== "" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  };
  const c = Number(q.get("count"));
  const count = c === 5 || c === 10 ? c : 3;
  return { mode: m, duration: num("dur", m === "soak" ? 900 : 60, 2, 3600), warmup: num("warmup", 3, 0.5, 15), count };
}

/** 世界方向 → 搖桿輸入（movement.inputToWorld 的反運算；forward = (sin, cos)、right = (cos, −sin)） */
export function worldToInput(dirX: number, dirZ: number, cameraForwardYaw: number): { x: number; y: number } {
  const s = Math.sin(cameraForwardYaw), c = Math.cos(cameraForwardYaw);
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-6) return { x: 0, y: 0 };
  const dx = dirX / len, dz = dirZ / len;
  return { x: dx * c - dz * s, y: dx * s + dz * c };
}

/** 移動路徑：出生點周圍半徑 r 的 8 個點（順時針） */
export function movePath(radius = 7): { x: number; z: number }[] {
  return Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return { x: Math.sin(a) * radius, z: Math.cos(a) * radius };
  });
}

/**
 * 第 4 隻以後的出生點（測試場景）：在出生點前方 5～10 公尺的扇形內，與前 3 隻（previewSpawnPoints）錯開
 */
export function extraSpawnPoints(extra: number, forwardYaw: number): { x: number; z: number }[] {
  const fx = Math.sin(forwardYaw), fz = Math.cos(forwardYaw);
  const rx = fz, rz = -fx;
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i < extra; i++) {
    const f = 5 + (i % 3) * 2.5; // 5 / 7.5 / 10 公尺
    const r = (Math.floor(i / 3) % 2 === 0 ? 1 : -1) * (3.5 + Math.floor(i / 6) * 2 + (i % 3) * 0.6); // 左右交錯
    pts.push({ x: fx * f + rx * r, z: fz * f + rz * r });
  }
  return pts;
}

/** soak 模式：目前是移動段還是戰鬥段（每 60 秒：前 20 秒移動、後 40 秒戰鬥） */
export function soakSegment(t: number): "move" | "attack" {
  return t % 60 < 20 ? "move" : "attack";
}

export interface AutoplayResult {
  mode: AutoplayMode;
  count: number;
  variant: "v2" | "v38r";
  quality: string;
  pixelRatio: number;
  summary: BenchmarkSummary;
  /** 每段時間（move/attack 30 秒、soak 60 秒）的平均 FPS 與資源數 */
  timeline: { t: number; avgFps: number; low1Fps: number; meshes: number; materials: number; textures: number; heapMB: number | null }[];
  checks: AutoplayCheck[];
  counters: Record<string, number>;
  at: string;
  userAgent: string;
}

export interface AutoplayCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * 逐幀統計與判定（純邏輯）。Game 每幀把觀察到的數字餵進來，結束時產生判定。
 */
export class AutoplayStats {
  readonly dts: number[] = [];
  readonly draws: number[] = [];
  private winDts: number[] = [];
  private winStart = 0;
  readonly timeline: AutoplayResult["timeline"] = [];
  private readonly windowSec: number;
  elapsed = 0;
  // 移動
  maxStepRatio = 0;
  teleports = 0;
  stuckWindows = 0;
  movingWindows = 0;
  private winDist = 0;
  private winMoveTime = 0;
  private stuckWinStart = 0;
  maxCameraLag = 0;
  // 攻擊
  attackStarts = 0;
  minAttackInterval = Infinity;
  private lastAttackAt: number | null = null;
  hits = 0;
  misses = 0;
  wrongDamage = 0;
  // 其他
  monsterDeaths = 0;
  monsterRespawns = 0;
  playerDowns = 0;
  contextLost = 0;
  invalid = 0;

  constructor(windowSec: number) {
    this.windowSec = windowSec;
  }

  /** 每幀（暖機後）；moved：本幀玩家水平位移；expectedMax：依移動速度與 dt 的最大合理位移；intendMove：本幀是否在移動 */
  frame(o: { rawDt: number; drawCalls: number; moved: number; expectedMax: number; intendMove: boolean; revived: boolean; cameraLag: number; valid: boolean }): void {
    this.dts.push(o.rawDt);
    this.draws.push(o.drawCalls);
    this.winDts.push(o.rawDt);
    this.elapsed += o.rawDt;
    if (!o.valid) this.invalid++;
    if (!o.revived && o.expectedMax > 0) {
      const r = o.moved / o.expectedMax;
      if (r > this.maxStepRatio) this.maxStepRatio = r;
      if (r > 1.6) this.teleports++;
    }
    if (o.cameraLag > this.maxCameraLag) this.maxCameraLag = o.cameraLag;
    // 卡住：在移動中的每 3 秒，實際走的距離 < 1 公尺（移動速度 5 m/s）
    if (o.intendMove) {
      this.winDist += o.moved;
      this.winMoveTime += o.rawDt;
    }
    if (this.elapsed - this.stuckWinStart >= 3) {
      if (this.winMoveTime >= 2.5) {
        this.movingWindows++;
        if (this.winDist < 1) this.stuckWindows++;
      }
      this.winDist = 0;
      this.winMoveTime = 0;
      this.stuckWinStart = this.elapsed;
    }
  }

  /** 時間軸取樣（每 windowSec 秒一筆）：回傳 true 表示該取樣了 */
  dueSample(): boolean {
    return this.elapsed - this.winStart >= this.windowSec;
  }

  sample(res: { meshes: number; materials: number; textures: number; heapMB: number | null }): void {
    const s = summarizeFrames(this.winDts, []);
    this.timeline.push({ t: Math.round(this.elapsed), avgFps: s.avgFps, low1Fps: s.low1Fps, ...res });
    this.winDts = [];
    this.winStart = this.elapsed;
  }

  attackStarted(now: number): void {
    this.attackStarts++;
    if (this.lastAttackAt !== null) this.minAttackInterval = Math.min(this.minAttackInterval, now - this.lastAttackAt);
    this.lastAttackAt = now;
  }

  /** 揮中結算：ok＝命中；hpDelta＝目標實際被扣的 HP；hpBefore＝結算前 HP */
  hit(ok: boolean, hpDelta: number, hpBefore: number, damage: number): void {
    if (!ok) {
      this.misses++;
      return;
    }
    this.hits++;
    if (hpDelta !== Math.min(damage, hpBefore)) this.wrongDamage++;
  }

  judge(o: {
    mode: AutoplayMode;
    attackInterval: number;
    resStart: { meshes: number; materials: number; textures: number };
    resEnd: { meshes: number; materials: number; textures: number };
    duplicatesBlocked: number;
    /** 這次測試是否有戰鬥段（soak 每 60 秒的第 20 秒起才戰鬥；太短的 soak 只有移動段） */
    attackExpected?: boolean;
  }): AutoplayCheck[] {
    const c: AutoplayCheck[] = [];
    const moves = o.mode !== "attack";
    const attacks = o.mode === "attack" || (o.mode === "soak" && o.attackExpected !== false);
    c.push({ name: "畫面持續更新（無凍結：最長一幀 < 1 秒）", ok: this.dts.length > 0 && Math.max(...this.dts) < 1, detail: `最長一幀 ${(Math.max(0, ...this.dts) * 1000).toFixed(0)} ms` });
    c.push({ name: "WebGL 沒有 Context Lost", ok: this.contextLost === 0, detail: `${this.contextLost} 次` });
    c.push({ name: "沒有瞬間位移", ok: this.teleports === 0, detail: `單幀位移最大為正常速度的 ${this.maxStepRatio.toFixed(2)} 倍` });
    if (moves) {
      c.push({ name: "移動時不會卡住（每 3 秒至少走 1 公尺）", ok: this.movingWindows > 0 && this.stuckWindows === 0, detail: `移動區段 ${this.movingWindows}、卡住 ${this.stuckWindows}` });
      c.push({ name: "鏡頭跟隨玩家（鏡頭中心與玩家距離 < 2 公尺）", ok: this.maxCameraLag < 2, detail: `最大 ${this.maxCameraLag.toFixed(2)} 公尺` });
    }
    if (attacks) {
      c.push({ name: "普通攻擊有出手", ok: this.attackStarts > 0, detail: `${this.attackStarts} 次` });
      c.push({
        name: `攻擊間隔不小於 ${o.attackInterval} 秒`,
        ok: this.attackStarts < 2 || this.minAttackInterval >= o.attackInterval - 1e-6,
        detail: `最短 ${Number.isFinite(this.minAttackInterval) ? this.minAttackInterval.toFixed(3) : "—"} 秒`,
      });
      c.push({ name: "每次命中扣 20（或剩餘 HP），不重複扣血", ok: this.hits > 0 && this.wrongDamage === 0, detail: `命中 ${this.hits}、落空 ${this.misses}、錯誤 ${this.wrongDamage}` });
      c.push({ name: "怪物攻擊沒有重複結算", ok: o.duplicatesBlocked === 0, detail: `擋下重複 ${o.duplicatesBlocked}` });
    }
    c.push({ name: "怪物狀態與位置正常（無 NaN／異常狀態）", ok: this.invalid === 0, detail: `異常幀 ${this.invalid}` });
    const grew = (k: "meshes" | "materials" | "textures"): number => o.resEnd[k] - o.resStart[k];
    c.push({
      name: "場景資源沒有持續增加（Mesh／材質／貼圖）",
      ok: grew("meshes") <= 0 && grew("materials") <= 0 && grew("textures") <= 0,
      detail: `Mesh ${o.resStart.meshes}→${o.resEnd.meshes}、材質 ${o.resStart.materials}→${o.resEnd.materials}、貼圖 ${o.resStart.textures}→${o.resEnd.textures}`,
    });
    return c;
  }
}

export const AUTOPLAY_STORAGE_KEY = "starwish.autoplay.v1";

export function autoplayKey(r: Pick<AutoplayResult, "mode" | "count" | "variant" | "quality">): string {
  return `${r.mode}_${r.count}_${r.variant}_${r.quality}`;
}

const MODE_LABEL: Record<AutoplayMode, string> = { move: "測試 A：持續移動", attack: "測試 B／D：連續攻擊與戰鬥", soak: "測試 E：長時間穩定性" };

export function formatAutoplay(r: AutoplayResult): string[] {
  const s = r.summary;
  const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : "—");
  const lines = [
    `${MODE_LABEL[r.mode]}・怪物 ${r.count} 隻・${r.variant === "v38r" ? "V3.8R" : "V2"}・畫質 ${r.quality}・${r.pixelRatio}x`,
    `平均 ${f1(s.avgFps)} FPS／1% Low ${f1(s.low1Fps)}／最低 ${f1(s.minFps)}（${s.frames} 幀／${s.seconds} 秒）`,
    `Draw Calls 平均 ${f1(s.avgDrawCalls)}・最高 ${s.maxDrawCalls}`,
    ...r.checks.map((c) => `${c.ok ? "✅" : "❌"} ${c.name}（${c.detail}）`),
    "計數：" + Object.entries(r.counters).map(([k, v]) => `${k} ${v}`).join("・"),
  ];
  if (r.timeline.length) {
    lines.push("時間軸（平均 FPS／1% Low／Mesh／材質／貼圖／JS 記憶體）：");
    for (const t of r.timeline) lines.push(`  ${t.t}s：${f1(t.avgFps)}／${f1(t.low1Fps)}／${t.meshes}／${t.materials}／${t.textures}／${t.heapMB === null ? "Safari 不提供" : `${t.heapMB.toFixed(1)} MB`}`);
  }
  return lines;
}
