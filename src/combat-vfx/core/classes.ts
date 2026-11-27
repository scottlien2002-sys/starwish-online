/**
 * 六大職業共用戰鬥架構（Stage 2 預留）。
 *
 * 本階段只建立「分類＋共用介面＋展示方向」，不代表正式職業技能、武器限制及數值已定案。
 * 一個職業 = 動畫分類（要做哪些動作）＋特效家族（用哪些共用特效鍵值、什麼顏色）＋展示組合。
 * 正式技能只要寫成 SkillDef（core/skills.ts）：動作片段＋時間軸事件（fx／sfx／hit／projectile），
 * 不必改特效系統或戰鬥程式；顏色換 palette，強弱換 scale。
 */
import type { FxKey, Palette } from "./skills.ts";

export type CombatClassId = "swordsman" | "knight" | "blacksmith" | "mage" | "priest" | "clown";

export interface ClassDemoStep {
  at: number;
  fx: FxKey;
  anchor: "self" | "front" | "target";
  forward?: number;
  scale?: number;
  palette?: Palette;
  duration?: number;
  /** 跟著角色移動（光盾、治療光環、增益環繞） */
  follow?: boolean;
}

export interface ClassVfxProfile {
  id: CombatClassId;
  label: string;
  /** 規劃中的武器類型（本階段只有短劍、法杖兩種展示武器；其他尚未定案） */
  plannedWeapons: readonly string[];
  palette: Palette;
  /** 需要的動畫分類（給動畫製作排程用） */
  animCategories: readonly string[];
  /** 特效家族：名稱＋使用的共用特效鍵值 */
  fxFamilies: readonly { name: string; keys: readonly FxKey[] }[];
  /** 本階段可以拿來代表這個職業方向的展示技能（core/skills.ts 的 id） */
  demoSkills: readonly string[];
  /** 實驗頁「職業特效」按鈕播放的組合（只有畫面，不結算傷害） */
  demo: readonly ClassDemoStep[];
}

export const CLASS_VFX: readonly ClassVfxProfile[] = Object.freeze([
  {
    id: "swordsman", label: "劍士", plannedWeapons: ["單手劍", "雙手劍"], palette: "steel",
    animCategories: ["連斬（3～4 段）", "重斬（蓄力）", "劍氣（遠距）", "突進斬"],
    fxFamilies: [
      { name: "劍氣", keys: ["slashArc", "slashArcRise", "slashArcBig", "swordWave"] },
      { name: "連斬", keys: ["slashArc", "hitSpark", "hitFlash"] },
      { name: "重斬", keys: ["slashArcBig", "shockwave", "groundCrack", "debris"] },
    ],
    demoSkills: ["triple_slash", "whirlwind", "charge_burst"],
    demo: [
      { at: 0.0, fx: "slashArc", anchor: "front", forward: 0.6 },
      { at: 0.18, fx: "slashArcRise", anchor: "front", forward: 0.6 },
      { at: 0.4, fx: "slashArcBig", anchor: "front", forward: 0.7, palette: "azure" },
      { at: 0.46, fx: "shockwave", anchor: "front", forward: 1.0, scale: 1.0, palette: "azure" },
    ],
  },
  {
    id: "knight", label: "騎士", plannedWeapons: ["單手劍＋盾", "長槍"], palette: "gold",
    animCategories: ["盾擊", "突刺", "防禦架盾", "嘲諷"],
    fxFamilies: [
      { name: "盾擊", keys: ["shieldBash", "hitRing", "shockwave"] },
      { name: "突刺", keys: ["thrustLine", "hitSpark"] },
      { name: "防禦光盾", keys: ["lightShield", "hitRing"] },
    ],
    demoSkills: ["leap_slam", "charge_burst"],
    demo: [
      { at: 0.0, fx: "lightShield", anchor: "self", duration: 1.4, follow: true },
      { at: 0.55, fx: "shieldBash", anchor: "self" },
      { at: 0.95, fx: "thrustLine", anchor: "self" },
    ],
  },
  {
    id: "blacksmith", label: "鐵匠", plannedWeapons: ["重錘", "斧"], palette: "gold",
    animCategories: ["重錘下砸", "旋轉錘擊", "地面震波", "鍛造強化"],
    fxFamilies: [
      { name: "重錘", keys: ["shockwave", "groundCrack", "debris", "forgeSparks"] },
      { name: "震波", keys: ["shockwave", "dustRing", "hitRing"] },
      { name: "重擊", keys: ["hitFlash", "starShards", "forgeSparks"] },
    ],
    demoSkills: ["leap_slam", "charge_burst"],
    demo: [
      { at: 0.0, fx: "forgeSparks", anchor: "front", forward: 0.8 },
      { at: 0.05, fx: "shockwave", anchor: "front", forward: 0.9, scale: 1.2 },
      { at: 0.05, fx: "groundCrack", anchor: "front", forward: 0.9, scale: 1.1 },
      { at: 0.05, fx: "dustRing", anchor: "front", forward: 0.9, scale: 1.0 },
    ],
  },
  {
    id: "mage", label: "法師", plannedWeapons: ["法杖", "魔導書"], palette: "azure",
    animCategories: ["詠唱", "單體魔法彈", "範圍魔法", "瞬移"],
    fxFamilies: [
      { name: "元素魔法（換色：火 rose／冰 azure／雷 star）", keys: ["magicCircle", "gatherMotes", "magicBolt", "boltImpact"] },
      { name: "魔法陣", keys: ["magicCircle", "magicCircleBig", "lightPillar"] },
      { name: "範圍爆破", keys: ["areaBlast", "shockwave", "starShards"] },
    ],
    demoSkills: ["staff_cast", "star_meteor"],
    demo: [
      { at: 0.0, fx: "magicCircleBig", anchor: "front", forward: 3.2, duration: 0.9, palette: "rose" },
      { at: 0.75, fx: "lightPillar", anchor: "front", forward: 3.2, palette: "rose" },
      { at: 0.8, fx: "areaBlast", anchor: "front", forward: 3.2, scale: 0.9, palette: "rose" },
    ],
  },
  {
    id: "priest", label: "祭司", plannedWeapons: ["權杖", "聖典"], palette: "gold",
    animCategories: ["治療詠唱", "聖光", "增益祝福", "復活"],
    fxFamilies: [
      { name: "治療", keys: ["healAura", "magicCircle"] },
      { name: "聖光", keys: ["lightPillar", "hitRing"] },
      { name: "輔助效果", keys: ["buffOrbit", "healAura"] },
    ],
    demoSkills: ["staff_cast"],
    demo: [
      { at: 0.0, fx: "healAura", anchor: "self", duration: 1.3, follow: true },
      { at: 0.2, fx: "buffOrbit", anchor: "self", duration: 1.8, follow: true },
      { at: 0.6, fx: "lightPillar", anchor: "self", palette: "gold" },
    ],
  },
  {
    id: "clown", label: "小丑", plannedWeapons: ["短刀", "撲克牌", "道具"], palette: "rose",
    animCategories: ["快速連擊（5～6 段）", "幻影分身", "特殊道具", "閃避翻滾"],
    fxFamilies: [
      { name: "快速連擊", keys: ["slashArc", "hitSpark"] },
      { name: "幻影", keys: ["chargeRings", "hitRing"] },
      { name: "特殊道具", keys: ["propBurst", "starBurst"] },
    ],
    demoSkills: ["triple_slash", "whirlwind"],
    demo: [
      { at: 0.0, fx: "slashArc", anchor: "front", forward: 0.55, scale: 0.8 },
      { at: 0.1, fx: "slashArcRise", anchor: "front", forward: 0.55, scale: 0.8 },
      { at: 0.2, fx: "slashArc", anchor: "front", forward: 0.55, scale: 0.8 },
      { at: 0.32, fx: "propBurst", anchor: "front", forward: 1.0 },
    ],
  },
] satisfies ClassVfxProfile[]);

export function classProfile(id: CombatClassId): ClassVfxProfile | undefined {
  return CLASS_VFX.find((c) => c.id === id);
}
