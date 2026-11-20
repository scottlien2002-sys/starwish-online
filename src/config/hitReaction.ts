/**
 * 受擊種類（2026-11-20 正式規則）：
 *   normal  ：普通攻擊（玩家普通攻擊、怪物普通攻擊）→ 只扣血＋受擊回饋（受擊表情、傷害數字、HP 條），
 *             不擊退、不硬直、不打斷追擊或攻擊、不重置攻擊冷卻、不累計連續受擊
 *   control ：保留給未來特殊技能（擊退、硬直）→ 使用下方的連續受擊抗性。目前遊戲中沒有任何來源使用
 */
export type HitKind = "normal" | "control";

/** 普通攻擊命中時的受擊回饋秒數（受擊表情；不影響行動） */
export const NORMAL_HIT_FLASH = 0.3;

/**
 * 「control」受擊用的連續受擊抗性（保留給未來特殊技能；普通攻擊不啟用）。
 *
 * 問題：玩家每 1 秒攻擊一次，星露啵啵受傷硬直 0.75 秒、攻擊 0.50 秒才命中，
 *   受傷結束後只剩 0.25 秒就被下一擊打斷 → 每次攻擊都被取消，永遠無法反擊。
 *
 * 規則（連續受擊 = 距上一次受擊未滿 comboResetAfter 秒）：
 *   第 1 擊：正常傷害、正常後退（受傷動畫的後退）、硬直 0.25 秒
 *   第 2 擊：正常傷害、後退距離 50%、硬直 0.15 秒
 *   第 3 擊：正常傷害、不後退、不硬直，並開始 1.5 秒硬直免疫
 *   免疫期間受擊：照扣血、有受擊表情與傷害提示，但不硬直、不後退、不打斷攻擊、不增加計數
 *   免疫結束後的下一擊：重新從第 1 擊開始（不會永久免疫，也不會永久硬直）
 *   連續 comboResetAfter 秒未受擊：計數歸零
 *   死亡、重生：計數與免疫歸零
 * 不改：傷害、HP、攻擊冷卻（冷卻仍從攻擊開始起算，受擊不重置）、死亡與重生規則。
 */
export interface HitTier {
  /** 硬直秒數（0 = 不硬直：不進入受擊狀態、不打斷攻擊） */
  stagger: number;
  /** 後退幅度倍率（1 = 受傷動畫原本的後退；0 = 不後退） */
  recoil: number;
  /** 這一擊之後開始的硬直免疫秒數（0 = 沒有） */
  immunity?: number;
}

export const HIT_REACTION = Object.freeze({
  comboResetAfter: 2.0,
  tiers: Object.freeze([
    Object.freeze({ stagger: 0.25, recoil: 1 }),
    Object.freeze({ stagger: 0.15, recoil: 0.5 }),
    Object.freeze({ stagger: 0, recoil: 0, immunity: 1.5 }),
  ]) as readonly HitTier[],
  /** 不硬直的受擊（第 3 擊、免疫中）顯示受擊表情的秒數（打擊感回饋） */
  noStaggerFlash: 0.3,
});
