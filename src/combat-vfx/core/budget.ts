/**
 * 多人戰鬥特效預算（純邏輯，可單元測試）。
 * 每個特效生成前先向預算申請：依「施放者是誰（自己／隊友／其他玩家）、優先度、距離、目前用量」決定
 * 允許、縮小（粒子倍率）或拒絕。命中判定與傷害不經過這裡——被拒絕的只有畫面。
 *
 * 規則（預設值，Claude D 接多人時可調）：
 * - 自己的特效永遠允許（只在超過總量時縮小粒子），保證自己的打擊感
 * - 其他玩家的特效：粒子倍率 0.5（隊友 0.75），最多佔總量 remoteShare；超過距離 cullDistance 不生成
 * - 次要層（secondary，例如餘燼、碎石）在預算 70% 以上時先被拒絕
 * - 命中閃光、傷害數字屬 critical，永遠允許（另有自己的數量上限）
 */
import type { VfxQualityConfig } from "./quality.ts";

export type VfxOwner = "self" | "party" | "other";
export type VfxPriority = "critical" | "primary" | "secondary";

export interface VfxRequest {
  owner: VfxOwner;
  priority: VfxPriority;
  /** 預估粒子數（品質縮放前） */
  particles: number;
  /** 與鏡頭／自己角色的距離（公尺） */
  distance?: number;
}

export interface VfxGrant {
  allowed: boolean;
  /** 額外粒子倍率（在品質倍率之外） */
  scale: number;
  /** 拒絕原因（統計用） */
  reason?: "remote-share" | "distance" | "secondary-pressure" | "effect-cap" | "particle-cap";
  handle: number;
}

export interface BudgetPolicy {
  remoteShare: number;
  partyScale: number;
  otherScale: number;
  cullDistance: number;
  secondaryPressure: number;
}

export const DEFAULT_POLICY: Readonly<BudgetPolicy> = Object.freeze({ remoteShare: 0.45, partyScale: 0.75, otherScale: 0.5, cullDistance: 28, secondaryPressure: 0.7 });

export interface BudgetStats {
  active: number;
  activeRemote: number;
  particles: number;
  granted: number;
  denied: number;
  scaled: number;
  deniedBy: Record<string, number>;
}

export class VfxBudget {
  private q: VfxQualityConfig;
  readonly policy: BudgetPolicy;
  private live = new Map<number, { owner: VfxOwner; particles: number }>();
  private next = 1;
  readonly stats: BudgetStats = { active: 0, activeRemote: 0, particles: 0, granted: 0, denied: 0, scaled: 0, deniedBy: {} };

  constructor(q: VfxQualityConfig, policy: Partial<BudgetPolicy> = {}) {
    this.q = q;
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  setQuality(q: VfxQualityConfig): void {
    this.q = q;
  }

  private deny(reason: NonNullable<VfxGrant["reason"]>): VfxGrant {
    this.stats.denied++;
    this.stats.deniedBy[reason] = (this.stats.deniedBy[reason] ?? 0) + 1;
    return { allowed: false, scale: 0, reason, handle: 0 };
  }

  request(r: VfxRequest): VfxGrant {
    const q = this.q;
    const P = this.policy;
    const remote = r.owner !== "self";
    // critical（命中閃光等）只對自己的角色免檢查；其他玩家的 critical 一樣受份額／上限限制
    if (r.priority !== "critical" || remote) {
      if (remote && (r.distance ?? 0) > P.cullDistance) return this.deny("distance");
      const fill = this.live.size / q.maxActiveEffects;
      if (this.live.size >= q.maxActiveEffects && remote) return this.deny("effect-cap");
      if (remote && this.stats.activeRemote >= Math.floor(q.maxActiveEffects * P.remoteShare)) return this.deny("remote-share");
      if (r.priority === "secondary" && (fill >= P.secondaryPressure || (!q.secondary))) return this.deny("secondary-pressure");
    }
    let scale = r.owner === "party" ? P.partyScale : r.owner === "other" ? P.otherScale : 1;
    const want = r.particles * q.particleScale * scale;
    const room = q.maxParticlesTotal - this.stats.particles;
    if (want > room) {
      if (room <= 0 && r.priority === "secondary") return this.deny("particle-cap");
      const s = Math.max(0, room) / Math.max(1, want);
      if (remote && s < 0.15) return this.deny("particle-cap");
      scale *= Math.max(0.15, s);
      this.stats.scaled++;
    }
    const particles = Math.round(r.particles * q.particleScale * scale);
    const handle = this.next++;
    this.live.set(handle, { owner: r.owner, particles });
    this.stats.granted++;
    this.recount();
    return { allowed: true, scale, handle };
  }

  release(handle: number): void {
    if (this.live.delete(handle)) this.recount();
  }

  private recount(): void {
    let p = 0;
    let rem = 0;
    for (const v of this.live.values()) {
      p += v.particles;
      if (v.owner !== "self") rem++;
    }
    this.stats.active = this.live.size;
    this.stats.activeRemote = rem;
    this.stats.particles = p;
  }
}
