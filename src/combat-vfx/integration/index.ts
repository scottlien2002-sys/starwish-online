/**
 * Combat VFX 正式接入入口（A、D 只需要 import 這個檔案）。
 * 說明文件：docs/combat-vfx/INTEGRATION_MODULE_A_D.md
 */
export { CombatFx, type CombatFxConfig, type FxActor, type SkillHooks, type SkillFxHandle, type PrewarmReport } from "./CombatFx.ts";
export { SKILLS, type SkillDef, type SkillEvent, type HitSpec, type FxKey, type SfxKey, type Palette, type ClassId } from "../core/skills.ts";
export { SkillTimeline, resolveAt, type ClipTiming } from "../core/timeline.ts";
export { VFX_QUALITY, parseTier, type VfxTier, type VfxQualityConfig } from "../core/quality.ts";
export { VfxBudget, type VfxOwner, type VfxPriority } from "../core/budget.ts";
export { CLASS_KITS, classKit, clipName, comboTemplate, chargeTemplate, projectileTemplate, aoeTemplate, buffTemplate, dashTemplate, validateSkillDef, FX_KEY_LIST, SFX_KEY_LIST, TBD } from "../core/classKits.ts";
export { CLASS_VFX } from "../core/classes.ts";
export { type DamageStyle } from "../fx/DamageNumbers.ts";
