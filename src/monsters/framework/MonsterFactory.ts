import { MonsterBrain, type BrainOptions } from "./MonsterBrain.ts";
import { MonsterController } from "./MonsterController.ts";
import { MonsterInstance } from "./MonsterInstance.ts";
import type { MonsterRegistry } from "./registry.ts";
import type { Vec3 } from "./types.ts";

export interface SpawnOptions {
  /** 預設 true；測試頁手動控制時設為 false */
  ai?: boolean;
  /** 預設 true；純邏輯（伺服器/測試）可設為 false 不建立模型 */
  visual?: boolean;
  brain?: BrainOptions;
  instanceId?: string;
}

/**
 * 依 monsterId 建立怪物：載入資料 → 建立實例與狀態機 → 套用動畫設定 → 建立視覺 → 接上 AI。
 */
export class MonsterFactory {
  private readonly registry: MonsterRegistry;
  private seq = 0;

  constructor(registry: MonsterRegistry) {
    this.registry = registry;
  }

  create(monsterId: string, spawn: Vec3, options: SpawnOptions = {}): MonsterController {
    const def = this.registry.definition(monsterId);
    const profile = this.registry.profile(def.animationProfileId);
    const id = options.instanceId ?? `${monsterId}#${++this.seq}`;
    const instance = new MonsterInstance(id, def, profile.anim.timings, spawn);

    let visual = null;
    if (options.visual !== false) {
      const make = this.registry.visual(def.modelId);
      if (!make) throw new Error(`找不到模型 ${def.modelId}（怪物 ${monsterId}）`);
      visual = make(def, profile);
    }
    const brain = options.ai === false ? null : new MonsterBrain(instance, { seed: this.seq * 7919, ...options.brain });
    return new MonsterController(instance, profile, visual, brain);
  }
}
