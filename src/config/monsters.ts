import type { MonsterDefinition } from "../monsters/framework/types.ts";

/**
 * 怪物靜態資料（獨立設定檔）。
 * ⚠ 星露啵啵的戰鬥數值為「暫定」（provisional），企劃尚未提供，請勿視為正式數值。
 * 新增怪物：在此加入一筆資料，並註冊對應的模型與動畫設定（見 docs/monsters/FRAMEWORK.md）。
 */
export const MONSTER_DEFINITIONS: readonly MonsterDefinition[] = Object.freeze([
  {
    monsterId: "star_dew_bobo",
    name: "星露啵啵",
    level: 1,
    maxHp: 60,
    attack: 8,
    defense: 2,
    moveSpeed: 1.6,
    attackRange: 1.1,
    aggroRange: 7,
    attackCooldown: 2,
    respawnTime: 10,
    experience: 12,
    dropTableId: "drop_star_dew_bobo",
    modelId: "star_dew_bobo_procedural",
    animationProfileId: "star_dew_bobo",
    patrolRadius: 3,
    leashRange: 16,
    height: 0.8,
    provisional: true,
    note: "戰鬥數值暫定，待企劃確認；掉落表於 W3 建立",
  },
  {
    monsterId: "test_dummy",
    name: "測試方塊（程式測試用，非正式怪物）",
    level: 1,
    maxHp: 40,
    attack: 5,
    defense: 0,
    moveSpeed: 2.2,
    attackRange: 1.3,
    aggroRange: 6,
    attackCooldown: 1.5,
    respawnTime: 6,
    experience: 0,
    dropTableId: "drop_none",
    modelId: "test_dummy_glb",
    animationProfileId: "test_dummy_clips",
    patrolRadius: 2.5,
    leashRange: 12,
    height: 0.8,
    testOnly: true,
    note: "僅用於驗證框架可重複使用（GLB 節點動畫路徑），不是苔角獸或任何正式怪物",
  },
]);
