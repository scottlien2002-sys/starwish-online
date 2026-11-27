/**
 * 技能定義（純資料）。六個「技術展示用」技能，不是正式職業技能，倍率與冷卻都是展示用測試值。
 *
 * 一個技能 = 動作片段（novice_combat_<g>.json 的 clip）＋時間軸事件。
 * 事件時間可以寫秒數，或寫動作檔裡的標記名稱（hit1、release…）→ 動作、特效、傷害共用同一個時間來源。
 * 未來六大職業共用同一套格式：classTags 標示可用職業，fx／sfx 用特效鍵值（見 fx/VfxSystem 的 FX_KEYS），
 * 換顏色用 palette；新增職業技能只要加資料，不必改程式。
 */
export type ClassId = "novice" | "swordsman" | "knight" | "blacksmith" | "mage" | "priest" | "clown";
export type WeaponKind = "sword" | "staff";
export type At = number | string;
export type FxKey =
  | "slashArc" | "slashArcRise" | "slashArcBig" | "swordWave" | "whirlRing" | "magicCircle" | "magicCircleBig" | "chargeAura"
  | "gatherMotes" | "magicBolt" | "meteor" | "shockwave" | "areaBlast" | "starBurst" | "hitFlash" | "hitSpark" | "critBurst"
  | "dustRing" | "boltImpact" | "groundGlow"
  // V2（Stage 2）：命中環、星光碎片、碎石、地裂、蓄力收束環、釋放閃光、光柱
  | "hitRing" | "starShards" | "debris" | "groundCrack" | "chargeRings" | "chargeFlash" | "lightPillar"
  // 六職業共用架構預留（展示方向，非正式技能）：騎士光盾／盾擊／突刺、鐵匠鍛造火花、祭司治療／增益、小丑道具
  | "lightShield" | "shieldBash" | "thrustLine" | "forgeSparks" | "healAura" | "buffOrbit" | "propBurst";
export type SfxKey = "swish" | "swishHeavy" | "hit" | "hitHeavy" | "crit" | "cast" | "bolt" | "magicHit" | "explosion" | "charge" | "release" | "jump" | "land" | "whirl";
export type Palette = "steel" | "azure" | "star" | "gold" | "rose";

export type HitShape =
  | { type: "cone"; radius: number; angleDeg: number }
  | { type: "circle"; radius: number; center: "self" | "target" };

export interface HitSpec {
  /** 同一技能內唯一（多段命中用來防止重複結算） */
  id: string;
  /** 傷害倍率（展示用） */
  mult: number;
  shape: HitShape;
  fx: FxKey[];
  sfx: SfxKey;
  shake: number;
  hitstopMs: number;
  forceCrit?: boolean;
  /** 只打目前目標（單體）；預設打範圍內全部 */
  single?: boolean;
}

export type SkillEvent =
  | { kind: "trail"; from: At; to: At; palette?: Palette }
  | { kind: "fx"; at: At; fx: FxKey; anchor: "self" | "target" | "weapon" | "front"; forward?: number; scale?: number; duration?: number; palette?: Palette }
  | { kind: "sfx"; at: At; sfx: SfxKey }
  | { kind: "shake"; at: At; amount: number }
  | { kind: "hit"; at: At; hit: HitSpec }
  | { kind: "projectile"; at: At; fx: "magicBolt" | "swordWave" | "meteor"; from: "weapon" | "self" | "sky"; speed: number; maxRange: number; pierce?: boolean; homing?: boolean; hit: HitSpec; palette?: Palette };

export interface SkillDef {
  id: string;
  label: string;
  short: string;
  classTags: readonly ClassId[];
  weapon: WeaponKind;
  clip: string;
  /** true：受攻速影響（攻速 100 → 1 倍，上限 160 → 1.6 倍） */
  aspdScaled: boolean;
  /** 允許的施放距離（公尺；從角色到目標身體外緣） */
  range: number;
  /** 冷卻（秒，展示用） */
  cooldown: number;
  /** 技能動作包含跳躍（一般移動沒有跳躍按鈕） */
  jumps?: boolean;
  /** 需要先面向目標 */
  faceTarget: boolean;
  palette: Palette;
  events: readonly SkillEvent[];
}

const H = (id: string, mult: number, shape: HitShape, fx: FxKey[], sfx: SfxKey, shake: number, hitstopMs: number, extra: Partial<HitSpec> = {}): HitSpec => ({ id, mult, shape, fx, sfx, shake, hitstopMs, ...extra });

export const SKILLS: readonly SkillDef[] = Object.freeze([
  {
    id: "triple_slash", label: "短劍三段連擊", short: "三連斬", classTags: ["novice", "swordsman", "knight", "clown"], weapon: "sword", clip: "Skill_TripleSlash",
    aspdScaled: true, range: 2.0, cooldown: 0.2, faceTarget: true, palette: "steel",
    events: [
      { kind: "trail", from: "trail1.0", to: "trail1.1" }, { kind: "sfx", at: "trail1.0", sfx: "swish" },
      { kind: "fx", at: 0.12, fx: "slashArc", anchor: "front", forward: 0.55 },
      { kind: "hit", at: "hit1", hit: H("s1", 0.8, { type: "cone", radius: 2.2, angleDeg: 140 }, ["hitFlash", "hitSpark"], "hit", 0.14, 45) },
      { kind: "trail", from: "trail2.0", to: "trail2.1" }, { kind: "sfx", at: "trail2.0", sfx: "swish" },
      { kind: "fx", at: 0.45, fx: "slashArcRise", anchor: "front", forward: 0.55 },
      { kind: "hit", at: "hit2", hit: H("s2", 0.9, { type: "cone", radius: 2.2, angleDeg: 140 }, ["hitFlash", "hitSpark"], "hit", 0.17, 55) },
      { kind: "trail", from: "trail3.0", to: "trail3.1", palette: "azure" }, { kind: "sfx", at: "trail3.0", sfx: "swishHeavy" },
      { kind: "fx", at: 0.88, fx: "slashArcBig", anchor: "front", forward: 0.6, palette: "azure" },
      { kind: "hit", at: "hit3", hit: H("s3", 1.5, { type: "cone", radius: 2.4, angleDeg: 150 }, ["hitFlash", "hitSpark", "starBurst"], "hitHeavy", 0.3, 80) },
      { kind: "projectile", at: "wave", fx: "swordWave", from: "self", speed: 13, maxRange: 7, pierce: true, palette: "azure",
        hit: H("wave", 0.6, { type: "circle", radius: 0.9, center: "target" }, ["hitFlash", "hitSpark"], "hit", 0.12, 30) },
    ],
  },
  {
    id: "staff_cast", label: "法杖施法攻擊", short: "魔法彈", classTags: ["novice", "mage", "priest"], weapon: "staff", clip: "Skill_StaffCast",
    aspdScaled: true, range: 9, cooldown: 0.4, faceTarget: true, palette: "azure",
    events: [
      { kind: "fx", at: "circle", fx: "magicCircle", anchor: "self", duration: 1.05 }, { kind: "sfx", at: "circle", sfx: "cast" },
      { kind: "fx", at: "gather.0", fx: "gatherMotes", anchor: "weapon", duration: 0.45 },
      { kind: "sfx", at: "release", sfx: "bolt" },
      { kind: "fx", at: "release", fx: "hitFlash", anchor: "weapon", scale: 0.9 },
      { kind: "fx", at: "release", fx: "lightPillar", anchor: "self", scale: 0.45, duration: 0.5 },
      { kind: "projectile", at: "release", fx: "magicBolt", from: "weapon", speed: 11, maxRange: 12, homing: true,
        hit: H("bolt", 1.3, { type: "circle", radius: 1.1, center: "target" }, ["hitFlash", "boltImpact", "hitSpark"], "magicHit", 0.16, 40) },
    ],
  },
  {
    id: "leap_slam", label: "跳躍重斬", short: "跳斬", classTags: ["novice", "swordsman", "knight", "blacksmith"], weapon: "sword", clip: "Skill_LeapSlam",
    aspdScaled: false, range: 3.4, cooldown: 2.5, jumps: true, faceTarget: true, palette: "gold",
    events: [
      { kind: "sfx", at: "takeoff", sfx: "jump" }, { kind: "fx", at: "takeoff", fx: "dustRing", anchor: "self", scale: 0.6 },
      { kind: "trail", from: "trail.0", to: "trail.1", palette: "gold" }, { kind: "sfx", at: 0.62, sfx: "swishHeavy" },
      { kind: "fx", at: "hit", fx: "shockwave", anchor: "front", forward: 0.5, scale: 1.2 },
      { kind: "fx", at: "hit", fx: "dustRing", anchor: "front", forward: 0.5, scale: 1.3 },
      { kind: "fx", at: "hit", fx: "starBurst", anchor: "front", forward: 0.5 },
      { kind: "fx", at: "hit", fx: "groundCrack", anchor: "front", forward: 0.55, scale: 1.0 },
      { kind: "hit", at: "hit", hit: H("slam", 2.0, { type: "circle", radius: 2.6, center: "self" }, ["hitFlash", "hitSpark"], "hitHeavy", 0.55, 90) },
      { kind: "sfx", at: "land", sfx: "land" },
    ],
  },
  {
    id: "whirlwind", label: "旋風斬", short: "旋風", classTags: ["novice", "swordsman", "knight", "clown"], weapon: "sword", clip: "Skill_Whirlwind",
    aspdScaled: true, range: 2.2, cooldown: 2.0, faceTarget: false, palette: "azure",
    events: [
      { kind: "trail", from: "trail.0", to: "trail.1", palette: "azure" }, { kind: "sfx", at: 0.22, sfx: "whirl" },
      { kind: "fx", at: 0.24, fx: "whirlRing", anchor: "self", duration: 1.05, palette: "azure" },
      { kind: "hit", at: "hit1", hit: H("w1", 0.7, { type: "circle", radius: 2.3, center: "self" }, ["hitFlash", "hitSpark"], "hit", 0.12, 35) },
      { kind: "hit", at: "hit2", hit: H("w2", 0.7, { type: "circle", radius: 2.3, center: "self" }, ["hitFlash", "hitSpark"], "hit", 0.12, 35) },
      { kind: "hit", at: "hit3", hit: H("w3", 1.0, { type: "circle", radius: 2.3, center: "self" }, ["hitFlash", "hitSpark", "starBurst"], "hitHeavy", 0.22, 60) },
    ],
  },
  {
    id: "star_meteor", label: "遠距離魔法・星隕術", short: "星隕", classTags: ["novice", "mage", "priest"], weapon: "staff", clip: "Skill_StarMeteor",
    aspdScaled: false, range: 12, cooldown: 3.0, faceTarget: true, palette: "star",
    events: [
      { kind: "fx", at: "circle", fx: "magicCircle", anchor: "self", duration: 1.2, palette: "star" }, { kind: "sfx", at: "circle", sfx: "cast" },
      { kind: "fx", at: "circle", fx: "magicCircleBig", anchor: "target", duration: 1.35, palette: "star" },
      { kind: "fx", at: 0.1, fx: "gatherMotes", anchor: "weapon", duration: 0.6, palette: "star" },
      { kind: "sfx", at: "release", sfx: "release" },
      { kind: "projectile", at: "release", fx: "meteor", from: "sky", speed: 16, maxRange: 30, homing: true, palette: "star",
        hit: H("meteor", 2.4, { type: "circle", radius: 3.0, center: "target" }, ["hitFlash", "areaBlast", "shockwave", "starBurst", "dustRing", "groundCrack", "lightPillar"], "explosion", 0.45, 70) },
    ],
  },
  {
    id: "charge_burst", label: "蓄力爆發攻擊", short: "蓄力", classTags: ["novice", "swordsman", "knight", "blacksmith"], weapon: "sword", clip: "Skill_ChargeBurst",
    aspdScaled: false, range: 3.0, cooldown: 4.0, faceTarget: true, palette: "rose",
    events: [
      { kind: "fx", at: "charge.0", fx: "chargeAura", anchor: "self", duration: 1.05, palette: "rose" }, { kind: "sfx", at: "charge.0", sfx: "charge" },
      { kind: "fx", at: "charge.0", fx: "groundGlow", anchor: "self", duration: 1.15, palette: "rose" },
      { kind: "shake", at: 0.7, amount: 0.08 }, { kind: "shake", at: 0.95, amount: 0.12 },
      { kind: "trail", from: "trail.0", to: "trail.1", palette: "rose" }, { kind: "sfx", at: "release", sfx: "swishHeavy" },
      { kind: "fx", at: "release", fx: "chargeFlash", anchor: "front", forward: 0.2, scale: 0.8, palette: "rose" },
      { kind: "fx", at: "hit", fx: "slashArcBig", anchor: "front", forward: 0.7, scale: 1.5, palette: "rose" },
      { kind: "fx", at: "hit", fx: "areaBlast", anchor: "front", forward: 1.4, scale: 1.0, palette: "rose" },
      { kind: "fx", at: "hit", fx: "shockwave", anchor: "front", forward: 1.0, scale: 1.4, palette: "rose" },
      { kind: "fx", at: "hit", fx: "groundCrack", anchor: "front", forward: 1.1, scale: 1.2, palette: "rose" },
      { kind: "hit", at: "hit", hit: H("burst", 3.0, { type: "cone", radius: 3.2, angleDeg: 160 }, ["hitFlash", "hitSpark", "starBurst"], "hitHeavy", 0.75, 120, { forceCrit: true }) },
    ],
  },
] satisfies SkillDef[]);

export function skillById(id: string): SkillDef | undefined {
  return SKILLS.find((s) => s.id === id);
}
