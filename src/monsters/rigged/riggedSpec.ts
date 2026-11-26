/**
 * 通用「原生骨骼動畫怪物」資產接入規格（Stage 7.2）— 不依賴 Babylon，可在 Node 單元測試。
 *
 * 一隻新怪物（M005、M006、M007…）只需要：
 *   1. 在 RIGGED_MONSTERS 加一筆 RiggedMonsterSpec（檔名、動畫名稱、移動與命中參數、碰撞與血條）
 *   2. 在 config/monsters.ts 加一筆 MonsterDefinition（modelId = spec.modelId）
 * 戰鬥、AI、狀態機、動畫切換、淡入淡出、Move／Run 選擇、命中同步、死亡停住、重生都共用，不必重寫。
 *
 * 參數優先順序：GLB 根節點 extras.monster（美術端的實際數值）＞ 這裡的預設值。不一致會列在檢查報告。
 */

export type RigClipKey = "idle" | "move" | "run" | "attack" | "hurt" | "death" | "respawn";
export const RIG_CLIP_KEYS: readonly RigClipKey[] = ["idle", "move", "run", "attack", "hurt", "death", "respawn"];
export const RIG_LOOPING: ReadonlySet<RigClipKey> = new Set(["idle", "move", "run"]);

export type RigLod = "hq" | "lite";

export interface RiggedLocomotion {
  /** Move 動畫原生地面速度（m/s，播放倍率 1 時不滑步） */
  moveNativeMps: number;
  /** Run 動畫原生地面速度（m/s） */
  runNativeMps: number;
  /** 地面速度 ≥ 這個值改播 Run（m/s） */
  runThresholdMps: number;
  /** 切換門檻的遲滯（m/s），避免在門檻附近來回切換 */
  hysteresisMps: number;
  /** 低於這個速度視為停下（m/s） */
  stopMps: number;
  /** 播放倍率限制（不足或超過時接受少量滑步，不無限加速） */
  ratioMin: number;
  ratioMax: number;
}

export interface RiggedFades {
  /** 一般切換（Idle／Move／Run／Attack／Respawn）淡入淡出秒數 */
  normal: number;
  /** Move ↔ Run */
  locomotion: number;
  /** Hurt、Death（要立刻看到） */
  urgent: number;
}

export interface RiggedMonsterSpec {
  /** 對應 MonsterDefinition.modelId */
  modelId: string;
  /** 對應 MonsterDefinition.monsterId */
  monsterId: string;
  label: string;
  /** models/ 之下的路徑 */
  files: Readonly<Record<RigLod, string>>;
  /** GLB 內的動畫名稱 */
  clips: Readonly<Record<RigClipKey, string>>;
  /** 預期的關節數、各動畫時長（秒）：用來檢查交付檔是否符合規格 */
  expect: { joints: number; durations: Readonly<Record<RigClipKey, number>> };
  locomotion: RiggedLocomotion;
  /** Attack 命中時間（動畫第幾秒，播放倍率 1 時） */
  attackHitTime: number;
  fades: RiggedFades;
  /** 死亡動畫播完後停在倒地姿勢多久再開始淡出（秒）與淡出時間 */
  deathHold: number;
  deathFade: number;
  /** 碰撞半徑（公尺；玩家近戰距離從身體外緣算） */
  bodyRadius: number;
  /** 血條高度（腳底往上，公尺） */
  hpBarHeight: number;
  /** 含耳總高（公尺，只做紀錄與檢查） */
  heightM: number;
  /** true = 接口測試替身（灰色方塊），不能放進正式地圖 */
  fixture?: boolean;
}

/** GLB extras.monster 的格式（Claude C 的交付規格） */
export interface RigExtras {
  clips?: Record<string, { duration?: number; loop?: boolean; hitTime?: number; nativeSpeedMps?: number; holdLastFrame?: boolean }>;
  shoulderHeightM?: number;
  fixture?: boolean;
}

/** 把 extras 的實際數值套到規格上（回傳新規格與不一致清單） */
export function applyExtras(spec: RiggedMonsterSpec, extras: RigExtras | null | undefined): { spec: RiggedMonsterSpec; notes: string[] } {
  const notes: string[] = [];
  if (!extras?.clips) return { spec, notes: ["GLB 沒有 extras.monster.clips，使用規格預設值"] };
  const c = extras.clips;
  const byName = (k: RigClipKey) => c[spec.clips[k]];
  const loc = { ...spec.locomotion };
  const mv = byName("move")?.nativeSpeedMps;
  const rn = byName("run")?.nativeSpeedMps;
  if (typeof mv === "number" && mv > 0) {
    if (Math.abs(mv - loc.moveNativeMps) > 1e-6) notes.push(`Move 原生速度：GLB ${mv}，規格 ${loc.moveNativeMps} → 用 GLB`);
    loc.moveNativeMps = mv;
  }
  if (typeof rn === "number" && rn > 0) {
    if (Math.abs(rn - loc.runNativeMps) > 1e-6) notes.push(`Run 原生速度：GLB ${rn}，規格 ${loc.runNativeMps} → 用 GLB`);
    loc.runNativeMps = rn;
  }
  let hit = spec.attackHitTime;
  const ht = byName("attack")?.hitTime;
  if (typeof ht === "number" && ht > 0) {
    if (Math.abs(ht - hit) > 1e-6) notes.push(`Attack 命中：GLB ${ht} 秒，規格 ${hit} 秒 → 用 GLB`);
    hit = ht;
  }
  for (const k of RIG_CLIP_KEYS) {
    const e = byName(k);
    if (!e) notes.push(`extras 沒有 ${spec.clips[k]}`);
    else if (typeof e.duration === "number" && Math.abs(e.duration - spec.expect.durations[k]) > 0.011) notes.push(`${spec.clips[k]} 時長：GLB ${e.duration}，規格 ${spec.expect.durations[k]}`);
  }
  return { spec: { ...spec, locomotion: loc, attackHitTime: hit }, notes };
}

export interface LocomotionChoice {
  clip: "idle" | "move" | "run";
  /** 播放倍率 */
  ratio: number;
  /** 倍率被限制時的滑步速度（m/s，正 = 腳比地面慢） */
  slipMps: number;
}

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);

/**
 * 依地面速度選擇 Idle／Move／Run 與播放倍率。
 * Run 是獨立的跑步動畫（不是 Move 加速）；超過門檻才換，含遲滯。
 */
export function chooseLocomotion(speedMps: number, loc: RiggedLocomotion, current: "idle" | "move" | "run" = "idle"): LocomotionChoice {
  const v = Math.max(0, speedMps);
  if (v < loc.stopMps) return { clip: "idle", ratio: 1, slipMps: 0 };
  const up = loc.runThresholdMps + (current === "run" ? -loc.hysteresisMps : loc.hysteresisMps);
  const run = v >= up;
  const native = run ? loc.runNativeMps : loc.moveNativeMps;
  const raw = v / native;
  const ratio = clamp(raw, loc.ratioMin, loc.ratioMax);
  return { clip: run ? "run" : "move", ratio, slipMps: v - native * ratio };
}

/** 依播放倍率換算實際命中時間（秒，從攻擊開始算） */
export function attackImpactTime(spec: Pick<RiggedMonsterSpec, "attackHitTime">, attackRatio: number): number {
  return spec.attackHitTime / Math.max(1e-6, attackRatio);
}

/**
 * 淡入淡出權重（純邏輯）：play(name, fade) 讓 name 在 fade 秒內升到 1，其餘降到 0。
 * 權重總和保持 1；fade = 0 立即切換。
 */
export class CrossFader {
  private readonly w = new Map<string, number>();
  private target: string | null = null;
  private rate = Infinity;

  get current(): string | null {
    return this.target;
  }

  play(name: string, fade: number): void {
    this.target = name;
    this.rate = fade > 0 ? 1 / fade : Infinity;
    if (!this.w.has(name)) this.w.set(name, 0);
    if (!Number.isFinite(this.rate)) for (const k of this.w.keys()) this.w.set(k, k === name ? 1 : 0);
  }

  /** 回傳每個片段目前的權重（0 的會被移除） */
  update(dt: number): Map<string, number> {
    if (this.target === null) return this.w;
    const t = this.target;
    const tw = this.w.get(t) ?? 0;
    const nt = Number.isFinite(this.rate) ? Math.min(1, tw + dt * this.rate) : 1;
    this.w.set(t, nt);
    let others = 0;
    for (const [k, v] of this.w) if (k !== t) others += v;
    const remain = 1 - nt;
    for (const [k, v] of [...this.w]) {
      if (k === t) continue;
      const nv = others > 0 ? (v / others) * remain : 0;
      if (nv <= 1e-4) this.w.delete(k);
      else this.w.set(k, nv);
    }
    return this.w;
  }

  weight(name: string): number {
    return this.w.get(name) ?? 0;
  }
}

// ------------------------------------------------------------------
// 已登記的骨骼動畫怪物
// ------------------------------------------------------------------

const FOX_DURATIONS: Record<RigClipKey, number> = { idle: 2.0, move: 0.8, run: 0.38, attack: 1.2, hurt: 0.45, death: 0.7, respawn: 0.5 };
const STD_CLIPS: Record<RigClipKey, string> = { idle: "Idle", move: "Move", run: "Run", attack: "Attack", hurt: "Hurt", death: "Death", respawn: "Respawn" };

/** M004 風羽狐 Rig V1.1（Claude C 交付；檔名依交付文件） */
export const M004_WINDFEATHER_FOX: RiggedMonsterSpec = Object.freeze({
  modelId: "m004_windfeather_fox_v11",
  monsterId: "windfeather_fox",
  label: "M004 風羽狐 Rig V1.1",
  files: { hq: "monsters/m004/M004_WindfeatherFox_Rig_V1_1_HQ.glb", lite: "monsters/m004/M004_WindfeatherFox_Rig_V1_1_Lite.glb" },
  clips: STD_CLIPS,
  expect: { joints: 32, durations: FOX_DURATIONS },
  locomotion: { moveNativeMps: 0.6, runNativeMps: 2.4, runThresholdMps: 1.2, hysteresisMps: 0.1, stopMps: 0.05, ratioMin: 0.6, ratioMax: 1.5 },
  attackHitTime: 0.5,
  fades: { normal: 0.15, locomotion: 0.12, urgent: 0.05 },
  deathHold: 1.2,
  deathFade: 0.6,
  bodyRadius: 0.45,
  hpBarHeight: 1.2,
  heightM: 1.07,
});

/** 接口測試替身（灰色方塊；只用在 ?lab=rigged 與自動測試） */
export const RIG_CONTRACT_FIXTURE: RiggedMonsterSpec = Object.freeze({
  ...M004_WINDFEATHER_FOX,
  modelId: "rig_contract_fixture",
  monsterId: "rig_contract_fixture",
  label: "骨骼動畫接口測試替身（不是怪物美術）",
  files: { hq: "monsters/_fixture/rig_contract_fixture.glb", lite: "monsters/_fixture/rig_contract_fixture.glb" },
  fixture: true,
});

export const RIGGED_MONSTERS: readonly RiggedMonsterSpec[] = [M004_WINDFEATHER_FOX, RIG_CONTRACT_FIXTURE];

export function riggedSpec(modelId: string): RiggedMonsterSpec | undefined {
  return RIGGED_MONSTERS.find((s) => s.modelId === modelId);
}

/** 狀態機時長（秒）：死亡＝動畫＋停住＋淡出（重生等待從淡出完成後才開始） */
export function riggedTimings(spec: RiggedMonsterSpec, durations: Record<RigClipKey, number> = spec.expect.durations) {
  return {
    attack: durations.attack,
    hit: durations.hurt,
    death: durations.death + spec.deathHold + spec.deathFade,
    respawn: durations.respawn,
    idlePeriod: durations.idle,
    hopPeriod: durations.move,
  };
}
