import type { MonsterAnimationProfile, MonsterDefinition, MonsterVisualFactory } from "./types.ts";
import type { MonsterState } from "../anim/types.ts";

/** 定義、動畫設定、視覺工廠的註冊表。新增怪物只需在這三處各註冊一次。 */
export class MonsterRegistry {
  private readonly definitions = new Map<string, MonsterDefinition>();
  private readonly profiles = new Map<string, MonsterAnimationProfile>();
  private readonly visuals = new Map<string, MonsterVisualFactory>();

  addDefinitions(defs: readonly MonsterDefinition[]): this {
    for (const d of defs) {
      const errors = validateDefinition(d);
      if (errors.length) throw new Error(`怪物資料錯誤 ${d.monsterId}: ${errors.join("; ")}`);
      if (this.definitions.has(d.monsterId)) throw new Error(`重複的 monsterId: ${d.monsterId}`);
      this.definitions.set(d.monsterId, Object.freeze({ ...d }));
    }
    return this;
  }

  addProfile(profile: MonsterAnimationProfile): this {
    const errors = validateProfile(profile);
    if (errors.length) throw new Error(`動畫設定錯誤 ${profile.id}: ${errors.join("; ")}`);
    this.profiles.set(profile.id, profile);
    return this;
  }

  addVisual(modelId: string, factory: MonsterVisualFactory): this {
    this.visuals.set(modelId, factory);
    return this;
  }

  definition(id: string): MonsterDefinition {
    const d = this.definitions.get(id);
    if (!d) throw new Error(`找不到怪物資料：${id}`);
    return d;
  }

  profile(id: string): MonsterAnimationProfile {
    const p = this.profiles.get(id);
    if (!p) throw new Error(`找不到動畫設定：${id}`);
    return p;
  }

  visual(modelId: string): MonsterVisualFactory | undefined {
    return this.visuals.get(modelId);
  }

  definitionIds(): string[] {
    return [...this.definitions.keys()];
  }
}

const POSITIVE: (keyof MonsterDefinition)[] = ["level", "maxHp", "moveSpeed", "attackRange", "aggroRange", "attackCooldown", "respawnTime"];
const NON_NEGATIVE: (keyof MonsterDefinition)[] = ["attack", "defense", "experience"];
const STRINGS: (keyof MonsterDefinition)[] = ["monsterId", "name", "dropTableId", "modelId", "animationProfileId"];

export function validateDefinition(d: MonsterDefinition): string[] {
  const e: string[] = [];
  for (const k of STRINGS) if (typeof d[k] !== "string" || !(d[k] as string).length) e.push(`${k} 必須為非空字串`);
  for (const k of POSITIVE) if (!(typeof d[k] === "number" && (d[k] as number) > 0)) e.push(`${k} 必須 > 0`);
  for (const k of NON_NEGATIVE) if (!(typeof d[k] === "number" && (d[k] as number) >= 0)) e.push(`${k} 必須 >= 0`);
  if (d.attackRange >= d.aggroRange) e.push("attackRange 必須小於 aggroRange");
  if (d.leashRange !== undefined && d.leashRange <= d.aggroRange) e.push("leashRange 必須大於 aggroRange");
  return e;
}

const ONE_SHOTS: MonsterState[] = ["attack", "hit", "death", "respawn"];

export function validateProfile(p: MonsterAnimationProfile): string[] {
  const e: string[] = [];
  const t = p.anim.timings;
  for (const k of ["attack", "hit", "death", "respawn", "idlePeriod", "hopPeriod"] as const) {
    if (!(t[k] > 0)) e.push(`timings.${k} 必須 > 0`);
  }
  for (const c of p.anim.cues) {
    if (ONE_SHOTS.includes(c.state)) {
      const d = t[c.state as "attack" | "hit" | "death" | "respawn"];
      if (c.at < 0 || c.at > d) e.push(`特效 ${c.effect} 的時間 ${c.at} 超出 ${c.state} 長度 ${d}`);
    }
  }
  if (p.kind === "clips") {
    if (!p.clips) e.push("clips 類型必須提供 clips");
    else {
      for (const s of ["idle", "move"] as const) if (!p.clips[s].loop) e.push(`${s} 動畫必須循環`);
      for (const s of ONE_SHOTS) {
        const c = p.clips[s as keyof typeof p.clips];
        if (c.loop) e.push(`${s} 動畫不可循環`);
        if (!(c.speed > 0)) e.push(`${s} 播放速度必須 > 0`);
      }
    }
  }
  return e;
}
