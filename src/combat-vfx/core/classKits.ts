/**
 * 六大職業共用戰鬥架構 V2（Stage 3）：職業套件＋技能樣板＋檢查器。純資料與純函式（不依賴 Babylon），A、D 可直接引用。
 *
 * ⚠️ 本檔「不定案」任何正式內容：技能名稱、傷害倍率、冷卻時間、武器外觀一律標示「未定案」。
 *    樣板產生的技能是「草稿」（draft），只用來接動畫／特效／音效管線，數字是可替換的佔位值。
 *
 * 結構：
 *   ClassKit  ＝ 武器插槽（骨骼掛點、拖尾類型；外觀未定案）＋動畫分類（片段命名規則、必要時間標記）＋音效家族＋配色
 *   樣板      ＝ combo / charge / projectile / aoe / buff / dash 六種，產生標準 SkillDef（core/skills.ts）
 *   validateSkillDef ＝ 上線前檢查：標記存在、拖尾先後、特效／音效鍵值存在、數值範圍合理
 * 動畫片段命名：<職業>_<分類>_<編號>，例如 Swordsman_BasicCombo_01、Mage_Projectile_01。
 */
import type { At, ClassId, FxKey, HitShape, HitSpec, Palette, SfxKey, SkillDef, SkillEvent, WeaponKind } from "./skills.ts";
import type { CombatClassId } from "./classes.ts";

/** 未定案標記（顯示用） */
export const TBD = "未定案" as const;

// ---------------------------------------------------------------- 鍵值清單（用 Record 讓 TypeScript 檢查沒有漏）
const FX_REC: Record<FxKey, true> = {
  slashArc: true, slashArcRise: true, slashArcBig: true, swordWave: true, whirlRing: true, magicCircle: true, magicCircleBig: true, chargeAura: true,
  gatherMotes: true, magicBolt: true, meteor: true, shockwave: true, areaBlast: true, starBurst: true, hitFlash: true, hitSpark: true, critBurst: true,
  dustRing: true, boltImpact: true, groundGlow: true, hitRing: true, starShards: true, debris: true, groundCrack: true, chargeRings: true, chargeFlash: true,
  lightPillar: true, lightShield: true, shieldBash: true, thrustLine: true, forgeSparks: true, healAura: true, buffOrbit: true, propBurst: true,
};
const SFX_REC: Record<SfxKey, true> = {
  swish: true, swishHeavy: true, staffSwing: true, hit: true, hitHeavy: true, crit: true, cast: true, bolt: true, magicHit: true, explosion: true,
  groundImpact: true, charge: true, release: true, jump: true, land: true, whirl: true, shieldBash: true, heal: true,
};
const PAL_REC: Record<Palette, true> = { steel: true, azure: true, star: true, gold: true, rose: true };
const CLASS_REC: Record<ClassId, true> = { novice: true, swordsman: true, knight: true, blacksmith: true, mage: true, priest: true, clown: true };
export const FX_KEY_LIST = Object.freeze(Object.keys(FX_REC) as FxKey[]);
export const SFX_KEY_LIST = Object.freeze(Object.keys(SFX_REC) as SfxKey[]);
export const PALETTE_LIST = Object.freeze(Object.keys(PAL_REC) as Palette[]);

// ---------------------------------------------------------------- 職業套件
export type WeaponSocket = "mainHand" | "offHand" | "twoHand" | "floating";
export interface WeaponSlot {
  socket: WeaponSocket;
  /** 掛在哪根骨頭（C1.0-B5b 骨架名稱；左手武器目前骨架有 hand.L） */
  bone: "hand.R" | "hand.L";
  /** 武器大類（規劃方向，非定案） */
  category: string;
  /** 外觀：一律未定案 */
  look: typeof TBD;
  /** 揮擊拖尾：刀刃（WeaponTrail）／鈍器（短拖尾＋重擊塵土）／無 */
  trail: "blade" | "blunt" | "none";
  /** 目前可用的展示模型（短劍／法杖）；null＝尚無展示模型 */
  demoMesh: WeaponKind | null;
}

export type AnimCategory = "basicCombo" | "heavy" | "charge" | "projectile" | "aoe" | "buff" | "dash" | "guard";
export const ANIM_CATEGORIES: readonly AnimCategory[] = ["basicCombo", "heavy", "charge", "projectile", "aoe", "buff", "dash", "guard"];

/** 每個動畫分類必須有的時間標記（動作檔 marks；特效、音效、傷害都從這裡取時間） */
export const REQUIRED_MARKS: Readonly<Record<AnimCategory, readonly string[]>> = Object.freeze({
  basicCombo: ["hit1"],                    // 另外每段 hitN 配 trailN（[開始, 結束]）
  heavy: ["windup", "hit"],
  charge: ["charge", "release", "hit"],    // charge ＝ [開始, 結束]
  projectile: ["cast", "release"],
  aoe: ["cast", "impact"],
  buff: ["cast", "apply"],
  dash: ["start", "hit", "end"],
  guard: ["raise", "lower"],
});

export interface AnimSlot {
  category: AnimCategory;
  label: string;
  /** 正式片段名稱（命名規則 <職業>_<分類>_<編號>） */
  clip: string;
  /** 目前可以先拿來測管線的初心者展示片段（novice_combat_<g>.json）；沒有就 null */
  demoClip: string | null;
  rootMotion: "none" | "forward" | "jump" | "spin";
  status: "已有展示動作" | "待製作";
}

export interface SfxFamily {
  swing: SfxKey;
  heavySwing: SfxKey;
  impact: SfxKey;
  heavyImpact: SfxKey;
  cast: SfxKey;
  release: SfxKey;
  special: SfxKey;
}

export interface ClassKit {
  id: CombatClassId;
  label: string;
  palette: Palette;
  accent: Palette;
  weapons: readonly WeaponSlot[];
  anims: readonly AnimSlot[];
  sfx: SfxFamily;
  /** 給動畫師的身形重點（不影響程式） */
  motionNotes: string;
}

const pascal = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** 動畫片段命名：Swordsman_BasicCombo_01 */
export function clipName(cls: CombatClassId, category: AnimCategory, variant = 1): string {
  return `${pascal(cls)}_${pascal(category)}_${String(variant).padStart(2, "0")}`;
}
const slot = (cls: CombatClassId, category: AnimCategory, label: string, rootMotion: AnimSlot["rootMotion"], demoClip: string | null = null): AnimSlot => ({
  category, label, clip: clipName(cls, category), demoClip, rootMotion, status: demoClip ? "已有展示動作" : "待製作",
});
const W = (socket: WeaponSocket, category: string, trail: WeaponSlot["trail"], demoMesh: WeaponKind | null, bone: WeaponSlot["bone"] = "hand.R"): WeaponSlot => ({ socket, bone, category, look: TBD, trail, demoMesh });

export const CLASS_KITS: readonly ClassKit[] = Object.freeze([
  {
    id: "swordsman", label: "劍士", palette: "steel", accent: "azure",
    weapons: [W("mainHand", "單手劍（規劃）", "blade", "sword"), W("twoHand", "雙手劍（規劃）", "blade", "sword")],
    anims: [
      slot("swordsman", "basicCombo", "連斬", "forward", "Skill_TripleSlash"),
      slot("swordsman", "heavy", "重斬", "forward"),
      slot("swordsman", "charge", "蓄力斬", "forward", "Skill_ChargeBurst"),
      slot("swordsman", "dash", "突進斬", "forward"),
      slot("swordsman", "aoe", "迴旋範圍", "spin", "Skill_Whirlwind"),
    ],
    sfx: { swing: "swish", heavySwing: "swishHeavy", impact: "hit", heavyImpact: "hitHeavy", cast: "charge", release: "release", special: "whirl" },
    motionNotes: "重心低、腳步明確；斬擊有預備→出手→收招。",
  },
  {
    id: "knight", label: "騎士", palette: "gold", accent: "steel",
    weapons: [W("mainHand", "單手劍（規劃）", "blade", "sword"), W("offHand", "盾（規劃）", "none", null, "hand.L"), W("twoHand", "長槍（規劃）", "blade", null)],
    anims: [
      slot("knight", "basicCombo", "劍盾連擊", "forward"),
      slot("knight", "heavy", "盾擊", "forward"),
      slot("knight", "dash", "突刺衝鋒", "forward"),
      slot("knight", "guard", "架盾防禦", "none"),
      slot("knight", "buff", "嘲諷／守護", "none"),
    ],
    sfx: { swing: "swish", heavySwing: "swishHeavy", impact: "hit", heavyImpact: "shieldBash", cast: "cast", release: "release", special: "shieldBash" },
    motionNotes: "穩、重、站姿寬；盾在前，出手幅度比劍士小。",
  },
  {
    id: "blacksmith", label: "鐵匠", palette: "gold", accent: "rose",
    weapons: [W("twoHand", "重錘（規劃）", "blunt", null), W("mainHand", "斧（規劃）", "blade", null)],
    anims: [
      slot("blacksmith", "basicCombo", "錘擊連段", "forward"),
      slot("blacksmith", "heavy", "重錘下砸", "jump", "Skill_LeapSlam"),
      slot("blacksmith", "aoe", "地面震波", "none"),
      slot("blacksmith", "charge", "旋轉錘擊", "spin"),
      slot("blacksmith", "buff", "鍛造強化", "none"),
    ],
    sfx: { swing: "swishHeavy", heavySwing: "swishHeavy", impact: "hitHeavy", heavyImpact: "groundImpact", cast: "charge", release: "release", special: "groundImpact" },
    motionNotes: "慢起手、重落地；每次命中都有地面衝擊感。",
  },
  {
    id: "mage", label: "法師", palette: "azure", accent: "star",
    weapons: [W("mainHand", "法杖（規劃）", "none", "staff"), W("floating", "魔導書（規劃）", "none", null, "hand.L")],
    anims: [
      slot("mage", "basicCombo", "法杖輕擊", "none"),
      slot("mage", "projectile", "單體魔法彈", "none", "Skill_StaffCast"),
      slot("mage", "aoe", "範圍魔法", "none", "Skill_StarMeteor"),
      slot("mage", "dash", "瞬移", "forward"),
      slot("mage", "buff", "魔力護盾", "none"),
    ],
    sfx: { swing: "staffSwing", heavySwing: "staffSwing", impact: "magicHit", heavyImpact: "explosion", cast: "cast", release: "bolt", special: "charge" },
    motionNotes: "上半身主導、腳步少；詠唱時手勢清楚，釋放有後座。",
  },
  {
    id: "priest", label: "祭司", palette: "gold", accent: "star",
    weapons: [W("mainHand", "權杖（規劃）", "none", "staff"), W("floating", "聖典（規劃）", "none", null, "hand.L")],
    anims: [
      slot("priest", "basicCombo", "權杖輕擊", "none"),
      slot("priest", "buff", "治療詠唱", "none"),
      slot("priest", "projectile", "聖光", "none"),
      slot("priest", "aoe", "範圍祝福", "none"),
      slot("priest", "guard", "守護結界", "none"),
    ],
    sfx: { swing: "staffSwing", heavySwing: "staffSwing", impact: "magicHit", heavyImpact: "magicHit", cast: "cast", release: "heal", special: "heal" },
    motionNotes: "柔和、對稱、向上；治療動作節奏慢，避免攻擊性姿勢。",
  },
  {
    id: "clown", label: "小丑", palette: "rose", accent: "star",
    weapons: [W("mainHand", "短刀（規劃）", "blade", "sword"), W("floating", "撲克牌／道具（規劃）", "none", null, "hand.L")],
    anims: [
      slot("clown", "basicCombo", "快速連擊", "forward"),
      slot("clown", "projectile", "飛牌", "none"),
      slot("clown", "dash", "閃避翻滾", "forward"),
      slot("clown", "aoe", "道具爆炸", "none"),
      slot("clown", "buff", "幻影分身", "none"),
    ],
    sfx: { swing: "swish", heavySwing: "whirl", impact: "hit", heavyImpact: "hitHeavy", cast: "cast", release: "release", special: "explosion" },
    motionNotes: "輕快、誇張、節奏不規則；常有小跳步。",
  },
] satisfies ClassKit[]);

export function classKit(id: CombatClassId): ClassKit | undefined {
  return CLASS_KITS.find((k) => k.id === id);
}

// ---------------------------------------------------------------- 技能樣板（產生草稿）
export type TemplateKind = "combo" | "charge" | "projectile" | "aoe" | "buff" | "dash";
export type TbdField = "name" | "damage" | "cooldown" | "weaponLook";

/** 佔位數值：只為了讓管線能跑，不代表平衡設計（正式數值由企劃定案後覆寫） */
export const PLACEHOLDER = Object.freeze({ mult: 1, cooldown: 1, range: 2.5, shake: 0.15, hitstopMs: 40 });

export interface DraftSkill extends SkillDef {
  draft: {
    template: TemplateKind;
    kit: CombatClassId;
    /** 尚未定案的欄位（顯示在工具與報告上） */
    tbd: readonly TbdField[];
    /** 對應的動畫分類（片段命名、必要標記） */
    category: AnimCategory;
    /** 正式動畫片段名稱（目前可能還用初心者展示片段播放） */
    plannedClip: string;
  };
}

export interface TemplateInput {
  id: string;
  cls: CombatClassId;
  /** 不給就用「未定案」 */
  label?: string;
  palette?: Palette;
  /** 正式數值定案後才填；不給就用佔位值並標示未定案 */
  mult?: number;
  cooldown?: number;
  range?: number;
  /** 覆寫要播的片段（例：先用初心者展示片段） */
  clip?: string;
}

function base(kind: TemplateKind, category: AnimCategory, inp: TemplateInput): { kit: ClassKit; def: Omit<DraftSkill, "events"> } {
  const kit = classKit(inp.cls);
  if (!kit) throw new Error(`unknown class ${inp.cls}`);
  const slotDef = kit.anims.find((a) => a.category === category);
  const plannedClip = slotDef?.clip ?? clipName(inp.cls, category);
  const tbd: TbdField[] = ["weaponLook"];
  if (!inp.label) tbd.push("name");
  if (inp.mult === undefined && kind !== "buff") tbd.push("damage");
  if (inp.cooldown === undefined) tbd.push("cooldown");
  const weapon = kit.weapons.find((w) => w.demoMesh)?.demoMesh ?? "sword";
  return {
    kit,
    def: {
      id: inp.id,
      label: inp.label ?? `${kit.label}・${slotDef?.label ?? category}（${TBD}）`,
      short: inp.label ?? TBD,
      classTags: [inp.cls],
      weapon,
      clip: inp.clip ?? slotDef?.demoClip ?? plannedClip,
      aspdScaled: kind === "combo" || kind === "dash",
      range: inp.range ?? PLACEHOLDER.range,
      cooldown: inp.cooldown ?? PLACEHOLDER.cooldown,
      faceTarget: kind !== "buff",
      jumps: slotDef?.rootMotion === "jump",
      palette: inp.palette ?? kit.palette,
      draft: { template: kind, kit: inp.cls, tbd, category, plannedClip },
    },
  };
}
const hit = (id: string, mult: number, shape: HitShape, fx: FxKey[], sfx: SfxKey, shake: number = PLACEHOLDER.shake, hitstopMs: number = PLACEHOLDER.hitstopMs): HitSpec => ({ id, mult, shape, fx, sfx, shake, hitstopMs });

/** 連擊：hits 段（標記 hit1..hitN、trail1..trailN）；最後一段較重 */
export function comboTemplate(inp: TemplateInput & { hits: number }): DraftSkill {
  const { kit, def } = base("combo", "basicCombo", inp);
  const m = inp.mult ?? PLACEHOLDER.mult;
  const events: SkillEvent[] = [];
  const blade = kit.weapons[0]?.trail !== "none";
  for (let i = 1; i <= inp.hits; i++) {
    const last = i === inp.hits;
    if (blade) events.push({ kind: "trail", from: `trail${i}.0`, to: `trail${i}.1` });
    events.push({ kind: "sfx", at: blade ? `trail${i}.0` : `hit${i}`, sfx: last ? kit.sfx.heavySwing : kit.sfx.swing });
    events.push({ kind: "fx", at: `hit${i}`, fx: last ? "slashArcBig" : i % 2 ? "slashArc" : "slashArcRise", anchor: "front", forward: 0.6 });
    events.push({ kind: "hit", at: `hit${i}`, hit: hit(`c${i}`, last ? m * 1.5 : m, { type: "cone", radius: 2.2, angleDeg: 140 }, last ? ["hitFlash", "hitSpark", "hitRing"] : ["hitFlash", "hitSpark"], last ? kit.sfx.heavyImpact : kit.sfx.impact, last ? 0.25 : PLACEHOLDER.shake, last ? 70 : PLACEHOLDER.hitstopMs) });
  }
  return { ...def, events };
}

/** 蓄力：charge [開始, 結束] → release → hit */
export function chargeTemplate(inp: TemplateInput): DraftSkill {
  const { kit, def } = base("charge", "charge", inp);
  const m = inp.mult ?? PLACEHOLDER.mult;
  const blade = kit.weapons[0]?.trail !== "none";
  const events: SkillEvent[] = [
    { kind: "fx", at: "charge.0", fx: "chargeAura", anchor: "self", duration: 1.0 },
    { kind: "fx", at: "charge.0", fx: "chargeRings", anchor: "self" },
    { kind: "sfx", at: "charge.0", sfx: "charge" },
    { kind: "fx", at: "release", fx: "chargeFlash", anchor: "self" },
    { kind: "sfx", at: "release", sfx: kit.sfx.heavySwing },
    ...(blade ? [{ kind: "trail", from: "release", to: "hit" } as SkillEvent] : []),
    { kind: "fx", at: "hit", fx: "shockwave", anchor: "front", forward: 1.0 },
    { kind: "hit", at: "hit", hit: hit("charged", m, { type: "cone", radius: 3.0, angleDeg: 150 }, ["hitFlash", "hitSpark", "starBurst"], kit.sfx.heavyImpact, 0.5, 100) },
  ];
  return { ...def, events };
}

/** 投射物：cast（法陣、詠唱）→ release（發射） */
export function projectileTemplate(inp: TemplateInput & { projectile?: "magicBolt" | "swordWave" | "meteor"; speed?: number }): DraftSkill {
  const { kit, def } = base("projectile", "projectile", inp);
  const m = inp.mult ?? PLACEHOLDER.mult;
  const p = inp.projectile ?? "magicBolt";
  const events: SkillEvent[] = [
    { kind: "fx", at: "cast", fx: "magicCircle", anchor: "self", duration: 0.8 },
    { kind: "sfx", at: "cast", sfx: kit.sfx.cast },
    { kind: "sfx", at: "release", sfx: kit.sfx.release },
    { kind: "projectile", at: "release", fx: p, from: p === "meteor" ? "sky" : "weapon", speed: inp.speed ?? 14, maxRange: Math.max(def.range + 2, 8), homing: p === "magicBolt",
      hit: hit("proj", m, { type: "circle", radius: 1.0, center: "target" }, ["hitFlash", "boltImpact"], kit.sfx.impact) },
  ];
  return { ...def, range: inp.range ?? 8, events };
}

/** 範圍：cast（大法陣）→ impact（目標處爆開＋地面衝擊） */
export function aoeTemplate(inp: TemplateInput & { radius?: number }): DraftSkill {
  const { kit, def } = base("aoe", "aoe", inp);
  const m = inp.mult ?? PLACEHOLDER.mult;
  const r = inp.radius ?? 3;
  const events: SkillEvent[] = [
    { kind: "fx", at: "cast", fx: "magicCircleBig", anchor: "target", duration: 1.0 },
    { kind: "sfx", at: "cast", sfx: kit.sfx.cast },
    { kind: "fx", at: "impact", fx: "areaBlast", anchor: "target", scale: r / 3 },
    { kind: "fx", at: "impact", fx: "shockwave", anchor: "target", scale: r / 3 },
    { kind: "fx", at: "impact", fx: "dustRing", anchor: "target" },
    { kind: "shake", at: "impact", amount: 0.35 },
    { kind: "hit", at: "impact", hit: hit("aoe", m, { type: "circle", radius: r, center: "target" }, ["hitFlash", "hitSpark"], kit.sfx.heavyImpact === "hitHeavy" ? "groundImpact" : kit.sfx.heavyImpact, 0.35, 60) },
  ];
  return { ...def, range: inp.range ?? 7, events };
}

/** 增益／治療：cast → apply（只有畫面與音效；效果數值由遊戲規則決定，未定案） */
export function buffTemplate(inp: TemplateInput & { look?: "heal" | "shield" | "orbit" }): DraftSkill {
  const { kit, def } = base("buff", "buff", inp);
  const look = inp.look ?? "orbit";
  const fx: FxKey = look === "heal" ? "healAura" : look === "shield" ? "lightShield" : "buffOrbit";
  const events: SkillEvent[] = [
    { kind: "fx", at: "cast", fx: "magicCircle", anchor: "self", duration: 0.7 },
    { kind: "sfx", at: "cast", sfx: kit.sfx.cast },
    { kind: "fx", at: "apply", fx, anchor: "self", duration: 2.0 },
    { kind: "fx", at: "apply", fx: "lightPillar", anchor: "self", scale: 0.6 },
    { kind: "sfx", at: "apply", sfx: look === "heal" ? "heal" : kit.sfx.special },
  ];
  return { ...def, range: inp.range ?? 0.5, events };
}

/** 突進：start → hit → end（根運動往前；直線突刺特效） */
export function dashTemplate(inp: TemplateInput & { distance?: number }): DraftSkill {
  const { kit, def } = base("dash", "dash", inp);
  const m = inp.mult ?? PLACEHOLDER.mult;
  const blade = kit.weapons[0]?.trail !== "none";
  const events: SkillEvent[] = [
    { kind: "fx", at: "start", fx: "thrustLine", anchor: "front", forward: 0.4 },
    { kind: "fx", at: "start", fx: "dustRing", anchor: "self", scale: 0.5 },
    { kind: "sfx", at: "start", sfx: kit.sfx.heavySwing },
    ...(blade ? [{ kind: "trail", from: "start", to: "hit" } as SkillEvent] : []),
    { kind: "hit", at: "hit", hit: hit("dash", m, { type: "cone", radius: 2.0 + (inp.distance ?? 2) * 0.3, angleDeg: 60 }, ["hitFlash", "hitSpark"], kit.sfx.impact, 0.2, 50) },
  ];
  return { ...def, range: inp.range ?? (inp.distance ?? 2) + 1, events };
}

// ---------------------------------------------------------------- 檢查器
export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}
type Marks = Readonly<Record<string, number | readonly number[]>>;

/** 把 At（秒數或標記名稱，"trail1.0" 表示陣列第 0 個）換成秒數；找不到回傳 null */
export function resolveAt(at: At, marks: Marks): number | null {
  if (typeof at === "number") return at;
  const m = /^(.+?)(?:\.(\d+))?$/.exec(at);
  if (!m) return null;
  const v = marks[m[1]!];
  if (v === undefined) return null;
  if (typeof v === "number") return m[2] === undefined ? v : null;
  const i = m[2] === undefined ? 0 : Number(m[2]);
  const x = v[i];
  return typeof x === "number" ? x : null;
}

/**
 * 技能上線前檢查。clip：動作檔的片段（有給就檢查標記存在、事件時間在片段內、拖尾先後；沒給只檢查格式）。
 */
export function validateSkillDef(def: SkillDef, clip?: { duration: number; marks: Marks }): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const num = (v: number, lo: number, hi: number, what: string) => {
    if (!Number.isFinite(v) || v < lo || v > hi) errors.push(`${what} 超出範圍 ${lo}～${hi}：${v}`);
  };
  if (!def.id || !/^[a-z0-9_]+$/.test(def.id)) errors.push(`id 格式不對（小寫英數與底線）：${def.id}`);
  if (!def.label) errors.push("label 不能空白");
  if (!def.clip) errors.push("clip 不能空白");
  if (!def.classTags.length) errors.push("classTags 至少一個");
  for (const c of def.classTags) if (!CLASS_REC[c]) errors.push(`未知職業：${c}`);
  if (!PAL_REC[def.palette]) errors.push(`未知配色：${def.palette}`);
  num(def.range, 0, 30, "range");
  num(def.cooldown, 0, 600, "cooldown");
  if (!def.events.length) errors.push("沒有任何事件");
  const hitIds = new Set<string>();
  const at = (a: At, what: string): number | null => {
    if (typeof a === "number") {
      num(a, 0, 30, `${what} 時間`);
      return a;
    }
    if (!clip) return null;
    const t = resolveAt(a, clip.marks);
    if (t === null) errors.push(`${what}：動作檔沒有標記「${a}」`);
    return t;
  };
  const checkHit = (h: HitSpec, where: string) => {
    if (hitIds.has(h.id)) errors.push(`命中 id 重複：${h.id}`);
    hitIds.add(h.id);
    num(h.mult, 0.01, 50, `${where} 倍率`);
    num(h.shake, 0, 1.5, `${where} 鏡頭震動`);
    num(h.hitstopMs, 0, 300, `${where} 停頓`);
    if (!SFX_REC[h.sfx]) errors.push(`${where} 未知音效：${h.sfx}`);
    for (const f of h.fx) if (!FX_REC[f]) errors.push(`${where} 未知特效：${f}`);
    if (h.shape.type === "cone") {
      num(h.shape.radius, 0.1, 20, `${where} 扇形半徑`);
      num(h.shape.angleDeg, 1, 360, `${where} 扇形角度`);
    } else num(h.shape.radius, 0.1, 20, `${where} 圓形半徑`);
  };
  def.events.forEach((e, i) => {
    const where = `事件 ${i}（${e.kind}）`;
    switch (e.kind) {
      case "trail": {
        const a = at(e.from, where), b = at(e.to, where);
        if (a !== null && b !== null && !(b > a)) errors.push(`${where}：拖尾結束要晚於開始（${a} → ${b}）`);
        if (e.palette && !PAL_REC[e.palette]) errors.push(`${where} 未知配色：${e.palette}`);
        break;
      }
      case "fx":
        at(e.at, where);
        if (!FX_REC[e.fx]) errors.push(`${where} 未知特效：${e.fx}`);
        if (e.palette && !PAL_REC[e.palette]) errors.push(`${where} 未知配色：${e.palette}`);
        if (e.scale !== undefined) num(e.scale, 0.05, 5, `${where} 大小`);
        break;
      case "sfx":
        at(e.at, where);
        if (!SFX_REC[e.sfx]) errors.push(`${where} 未知音效：${e.sfx}`);
        break;
      case "shake":
        at(e.at, where);
        num(e.amount, 0, 1.5, `${where} 震動`);
        break;
      case "hit":
        at(e.at, where);
        checkHit(e.hit, where);
        break;
      case "projectile":
        at(e.at, where);
        num(e.speed, 0.5, 80, `${where} 速度`);
        num(e.maxRange, 0.5, 60, `${where} 最大距離`);
        checkHit(e.hit, where);
        break;
    }
  });
  if (clip) {
    for (const e of def.events) {
      const ts = e.kind === "trail" ? [e.from, e.to] : [e.at];
      for (const a of ts) {
        const t = resolveAt(a, clip.marks);
        if (t !== null && (t < 0 || t > clip.duration + 1e-6)) errors.push(`事件時間 ${String(a)}=${t} 超出片段長度 ${clip.duration}`);
      }
    }
  }
  if (!hitIds.size && !def.events.some((e) => e.kind === "fx")) warnings.push("沒有命中也沒有特效");
  const d = (def as Partial<DraftSkill>).draft;
  if (d) {
    for (const f of d.tbd) warnings.push(`${f === "name" ? "技能名稱" : f === "damage" ? "傷害倍率" : f === "cooldown" ? "冷卻時間" : "武器外觀"}：${TBD}`);
    if (d.plannedClip !== def.clip) warnings.push(`正式動作 ${d.plannedClip} 尚未製作，暫用 ${def.clip}`);
    if (clip) for (const mk of REQUIRED_MARKS[d.category]) if (!(mk in clip.marks)) errors.push(`${d.category} 類動作必須有標記「${mk}」`);
  }
  return { ok: errors.length === 0, errors, warnings };
}
