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

/**
 * Stage 8.5 技能位移「測試設定」（跳斬、突進與之後的位移技能共用）。
 * ⚠ 六大職業正式技能與數值尚未定案：位移距離取 Claude C 展示動作的根運動（rootMotion）× 下面的倍率，
 *   全部是測試值，不得當成正式數值。一般移動仍然沒有跳躍。
 * 伺服器驗證：起點＝伺服器位置；方向＝施放朝向；每段沿路徑每 5 cm 用 A 的 FieldTerrainQuery 檢查
 * （地形可行走＋樹、岩石、建築碰撞）；第一個不能站的點之前就停下（不滑行、不穿牆）；距離上限 maxDistance。
 */
export const SKILL_DISPLACEMENT_TEST = Object.freeze({
  note: "Stage 8.5 技能位移測試設定（非正式數值）",
  enabled: true,
  /** 各技能的位移倍率；沒列出的技能用 defaultScale（未來的位移技能只要有根運動就自動支援） */
  scale: Object.freeze({ leap_slam: 1, charge_burst: 1, triple_slash: 1, whirlwind: 1 } as Record<string, number>),
  defaultScale: 1,
  /** 單次技能位移上限（公尺） */
  maxDistance: 3,
  /** 小於這個距離就不位移（公尺） */
  minDistance: 0.05,
  /** 路徑取樣間隔（秒） */
  sampleStep: 1 / 60,
});

/**
 * Stage 8.5 玩家交易「測試設定」（伺服器資料介面；尚無正式交易畫面，正式規則待企劃）。
 * 交易本身是原子操作（CharacterStore.trade：兩邊道具、金幣同一個交易寫入，失敗就全部不變）。
 */
export const TRADE_TEST = Object.freeze({
  note: "Stage 8.5 交易測試設定（非正式規則）",
  /** 兩位玩家需在同一房間、距離幾公尺內 */
  maxDistance: 8,
  /** 交易邀請有效時間 */
  offerTtlMs: 60_000,
  /** 單邊最多幾件道具 */
  maxItems: 8,
  /** 單次金幣上限 */
  maxGold: 1_000_000_000,
});
