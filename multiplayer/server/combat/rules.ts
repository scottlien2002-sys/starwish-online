/**
 * Stage 8.2／8.3 伺服器戰鬥與獎勵的「測試設定」。
 * ⚠ 企劃尚未提供正式的命中率、暴擊、格擋、經驗分配、掉落歸屬規則；這裡的值只用來讓多人測試可以實玩，
 *   全部集中在這個檔案、畫面標示「測試設定」，不得當成正式數值。
 * 沿用 Claude A 已有的測試設定：攻擊 0.5 秒＋0.2 秒命中（攻速上限 160）、傷害 20×攻擊／100、怪物攻擊×防禦換算、
 * 攻擊距離 2.5 m（從怪物身體外緣算）、怪物撞擊寬容 0.6 m、經驗表、掉落機率、金幣範圍。
 */
import { PREVIEW_COMBAT } from "../../../src/game/previewCombat.ts";
import { FIELD_TEST } from "../../../src/game/fieldRules.ts";

export const COMBAT_TEST_RULES = Object.freeze({
  note: "Stage 8.2 伺服器戰鬥測試設定（非正式數值）",
  /** 玩家命中率（怪物沒有閃避值時的測試值） */
  hitRate: 0.95,
  /** 暴擊率、暴擊倍率（基礎；武器詞條「暴擊 +%」之後由正式公式加上） */
  critRate: 0.1,
  critMult: 1.5,
  /** 玩家格擋率（基礎 0；防具詞條「格擋 +%」之後由正式公式加上） */
  playerBlockRate: 0,
  /** 玩家普通攻擊距離（從怪物身體外緣） */
  attackRange: PREVIEW_COMBAT.playerAttackRange,
  /** 網路延遲造成的位置差寬容（只放寬距離判定，不影響傷害） */
  latencySlack: 0.75,
  /** 攻擊冷卻寬容（秒）：封包抖動時不誤判 */
  cooldownSlack: 0.05,
  /** 怪物撞擊寬容（與單機版相同） */
  impactSlack: PREVIEW_COMBAT.impactSlack,
  /** 掉落物：歸屬時間（秒，只有傷害最高的玩家能撿）、存在時間、撿取距離（＋網路寬容） */
  lootOwnerSeconds: 30,
  lootLifetime: FIELD_TEST.lootLifetime,
  pickupRadius: FIELD_TEST.pickupRadius + 1.0,
  /** 經驗分配：對這隻怪物造成過傷害、且在 30 m 內的玩家各得全額（測試設定） */
  expContributorRange: 30,
  /** 倒地後沒有要求復活時，伺服器自動送回星芽村（秒） */
  autoRespawnSeconds: 30,
});

/** 測試起始裝備（非正式設定；正式初始金幣、裝備待企劃） */
export const STARTER_KIT_TEST = Object.freeze({ gold: 100, items: Object.freeze(["test_novice_sword", "test_novice_staff"]) });
/** 測試武器道具 → 外觀武器種類（技能限定武器用） */
export const WEAPON_ITEMS_TEST: Readonly<Record<string, "sword" | "staff">> = Object.freeze({ test_novice_sword: "sword", test_novice_staff: "staff" });
