/**
 * 通用怪物框架入口（不依賴 Babylon）。
 * Babylon 端的模型註冊在 src/monsters/babylon/registerVisuals.ts。
 */
import { MONSTER_DEFINITIONS } from "../../config/monsters.ts";
import { STAR_DEW_BOBO_PROFILE } from "../star-dew-bobo/profile.ts";
import { TEST_DUMMY_PROFILE } from "../test-dummy/profile.ts";
import { proceduralProfile } from "./profiles.ts";
import { MonsterRegistry } from "./registry.ts";

export * from "./types.ts";
export { MonsterRegistry, validateDefinition, validateProfile } from "./registry.ts";
export { MonsterInstance } from "./MonsterInstance.ts";
export { MonsterBrain } from "./MonsterBrain.ts";
export { MonsterController } from "./MonsterController.ts";
export { MonsterFactory } from "./MonsterFactory.ts";
export { ProceduralVisual, ClipMonsterVisual } from "./visuals.ts";
export { withPlaybackSpeed, genericClipAnim, clipTimings, proceduralProfile } from "./profiles.ts";

/** 建立含所有怪物資料與動畫設定的註冊表（視覺需另外註冊） */
export function createMonsterRegistry(): MonsterRegistry {
  return new MonsterRegistry()
    .addDefinitions(MONSTER_DEFINITIONS)
    .addProfile(proceduralProfile("star_dew_bobo", STAR_DEW_BOBO_PROFILE))
    .addProfile(TEST_DUMMY_PROFILE);
}
