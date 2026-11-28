/**
 * 星芽原野的戰鬥畫面與音效：Claude C 正式接入模組 CombatFx 的轉接層（一張地圖一個 CombatFx 實例）。
 *
 * - 這裡不再自己建立 VfxSystem／DamageNumbers／ScreenFx／CombatAudio：全部交給 CombatFx，
 *   避免舊版與新版特效系統同時執行（重複特效、重複音效、重複傷害數字）。
 * - 只負責畫面與聲音；傷害由遊戲戰鬥規則（單人）或 D 的伺服器（多人）決定後再傳進來。
 * - 原本的方法名稱（playerHit／playerHurt／respawn／update／dispose）保留，D 的多人程式可以照常呼叫。
 * - HUD（暫定，不是正式 UI）：沿用 C 的傷害數字與畫面效果；只顯示自己打出的與自己受到的傷害；
 *   預留治療、暴擊、格擋、未命中樣式；畫面閃光、鏡頭震動可調整或關閉（設定會保存）。
 */
import { Vector3, type Camera, type Scene, type TransformNode, type Mesh } from "@babylonjs/core";
import { CombatFx, type FxActor, type PrewarmReport, type SkillDef, type SkillHooks, type SkillFxHandle, type ClipTiming, type FxKey, type Palette, type SfxKey, type VfxTier } from "../combat-vfx/integration/index.ts";
import { VFX_QUALITY } from "../combat-vfx/core/quality.ts";

/** 戰鬥文字種類（HUD 暫定）。block 在 C 的樣式表還沒有專用樣式，暫時用「未命中」樣式顯示「格擋」 */
export type CombatTextKind = "damage" | "crit" | "heal" | "miss" | "block" | "hurt";

export interface CombatHudSettings {
  /** 畫面閃光（暴擊金光、受傷紅框） */
  flash: boolean;
  /** 鏡頭震動倍率：0＝關閉，0.5＝減弱，1＝C 的預設 */
  shake: number;
  /** 傷害數字 */
  numbers: boolean;
}

const HUD_KEY = "starwish.combatHud.v1";

export function loadHudSettings(): CombatHudSettings {
  const d: CombatHudSettings = { flash: true, shake: 1, numbers: true };
  try {
    const s = JSON.parse(localStorage.getItem(HUD_KEY) ?? "null") as Partial<CombatHudSettings> | null;
    if (s) return { flash: s.flash !== false, shake: typeof s.shake === "number" ? Math.max(0, Math.min(1, s.shake)) : 1, numbers: s.numbers !== false };
  } catch {
    // 私密瀏覽等情況：用預設值
  }
  return d;
}

export const SELF_ID = "self";

export class FieldCombatFx {
  readonly fx: CombatFx;
  readonly tier: VfxTier;
  readonly hud: CombatHudSettings;
  readonly stats = { hitFx: 0, numbers: 0, hurt: 0, respawnFx: 0, deathFx: 0, skillCasts: 0, swings: 0, texts: {} as Record<string, number> };
  prewarmReport: PrewarmReport | null = null;
  private readonly ground: (x: number, z: number) => number;
  private disposed = false;

  constructor(scene: Scene, camera: Camera, hudRoot: HTMLElement, tier: VfxTier, ground: (x: number, z: number) => number) {
    this.tier = tier;
    this.ground = ground;
    // 星芽原野是白天地圖 → bright（C 的建議）
    this.fx = new CombatFx({ scene, camera, hudRoot, tier, env: "bright", ground });
    this.hud = loadHudSettings();
    this.applyHud();
    // iPhone：第一次點擊／按鍵才能出聲
    const unlock = (): void => this.fx.unlockAudio();
    hudRoot.addEventListener("pointerdown", unlock, { capture: true });
    scene.getEngine().getRenderingCanvas()?.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
  }

  /** 相容舊程式（D 的多人程式讀 fx.vfx.stats 等） */
  get vfx() {
    return this.fx.vfx;
  }

  get audio() {
    return this.fx.audio;
  }

  /** 地圖載入期間呼叫（載入畫面還沒關掉前）。&prewarm=0 關閉 */
  async prewarm(): Promise<PrewarmReport> {
    this.prewarmReport = await this.fx.prewarm();
    return this.prewarmReport;
  }

  // ---------------- HUD 設定（暫定） ----------------

  setHud(p: Partial<CombatHudSettings>): void {
    Object.assign(this.hud, p);
    this.applyHud();
    try {
      localStorage.setItem(HUD_KEY, JSON.stringify(this.hud));
    } catch {
      // 無法保存就只套用這次
    }
  }

  private applyHud(): void {
    this.fx.screen.enabled = this.hud.flash;
    this.fx.shake.enabled = this.hud.shake > 0;
    this.fx.shake.scale = VFX_QUALITY[this.fx.tier].shake * this.hud.shake;
  }

  setQuality(tier: VfxTier): void {
    this.fx.setQuality(tier);
    this.applyHud();
  }

  // ---------------- 角色 ----------------

  /** 本地玩家登記（換武器時重新登記，拖尾跟著新武器） */
  registerSelf(root: TransformNode, position: () => Vector3, yaw: () => number, weapon: { base: TransformNode; tip: TransformNode; focus?: Mesh } | null, target: () => Vector3 | null): void {
    if (this.disposed) return;
    const a: FxActor = { id: SELF_ID, owner: "self", root, position, yaw, weaponBase: weapon?.base, weaponTip: weapon?.tip, weaponFocus: weapon?.focus, target };
    this.fx.register(a);
  }

  playSkill(skill: SkillDef, clip: ClipTiming, rate: number, hooks: SkillHooks): SkillFxHandle | null {
    if (this.disposed) return null;
    this.stats.skillCasts++;
    return this.fx.playSkill(SELF_ID, skill, clip, rate, hooks);
  }

  /** 普通攻擊揮擊：拖尾＋揮擊音效（法杖用法杖揮擊音） */
  basicSwing(staff: boolean, seconds: number): void {
    if (this.disposed) return;
    this.stats.swings++;
    this.fx.basicSwing(SELF_ID, staff ? "azure" : "steel", seconds, staff ? "staffSwing" : "swish");
  }

  // ---------------- 戰鬥文字（只顯示自己打出的與自己受到的） ----------------

  /** 預留樣式：治療、未命中、格擋（目前遊戲規則還沒有這些結果） */
  text(kind: CombatTextKind, at: Vector3, value: number | string): void {
    if (this.disposed) return;
    if (!this.hud.numbers) return;
    this.stats.texts[kind] = (this.stats.texts[kind] ?? 0) + 1;
    const p = at.add(new Vector3(0, 0.35, 0));
    switch (kind) {
      case "heal":
        this.fx.damage.show(p, typeof value === "number" ? `+${value}` : value, "heal");
        break;
      case "miss":
        this.fx.damage.show(p, typeof value === "string" ? value : "未命中", "miss");
        break;
      case "block":
        this.fx.damage.show(p, typeof value === "string" ? value : "格擋", "miss");
        break;
      case "hurt":
        this.fx.damage.show(p, value, "player");
        break;
      default:
        this.fx.damage.show(p, value, kind === "crit" ? "crit" : "normal");
    }
  }

  /** 自己的攻擊／技能命中怪物：特效＋音效＋傷害數字（數值由遊戲或伺服器決定） */
  hit(at: Vector3, keys: readonly FxKey[], o: { damage?: number; crit?: boolean; palette?: Palette; sfx?: SfxKey; shake?: number; ground?: Vector3 }): void {
    if (this.disposed) return;
    this.fx.hit(at, keys, { owner: "self", ...o, damage: this.hud.numbers ? o.damage : undefined });
    this.stats.hitFx++;
    if (o.damage !== undefined && this.hud.numbers) this.stats.numbers++;
  }

  /** 玩家普通攻擊命中怪物（位置在地面；height = 怪物身高） */
  playerHit(x: number, groundY: number, z: number, height: number, damage: number, killed: boolean, crit = false): void {
    const at = new Vector3(x, groundY + Math.max(0.35, height * 0.55), z);
    this.hit(at, killed ? ["hitFlash", "hitSpark", "starBurst"] : ["hitFlash", "hitSpark"], { damage, crit, sfx: "hit", shake: 0.06 });
  }

  /** 其他玩家打怪（多人）：只畫輕微受擊，不顯示數字 */
  otherHit(x: number, groundY: number, z: number, height: number): void {
    if (this.disposed) return;
    this.fx.monsterHurt(new Vector3(x, groundY + Math.max(0.35, height * 0.55), z), "other");
  }

  /** 怪物命中玩家：受傷數字、紅框、震動 */
  playerHurt(x: number, groundY: number, z: number, damage: number): void {
    if (this.disposed) return;
    const chest = new Vector3(x, groundY + 0.85, z);
    if (this.hud.numbers) this.fx.playerHurt(chest, damage, 0.15);
    else {
      this.fx.shake.shake(0.15);
      this.fx.screen.flashHurt();
    }
    this.stats.hurt++;
    if (this.hud.numbers) this.stats.numbers++;
  }

  /** 怪物死亡：塵環＋星光碎片（死亡動作與淡出由怪物模組自己播） */
  death(x: number, z: number, scale: number): void {
    if (this.disposed) return;
    this.fx.monsterDeath(new Vector3(x, this.ground(x, z), z), scale);
    this.stats.deathFx++;
  }

  /** 怪物重生：魔法陣＋光柱 */
  respawn(x: number, _groundY: number, z: number, scale: number, boss = false): void {
    if (this.disposed) return;
    this.fx.monsterRespawn(new Vector3(x, this.ground(x, z), z), scale, boss);
    this.stats.respawnFx++;
  }

  /** 每格：本地玩家位置（距離預算、音效左右聲道）；回傳鏡頭震動位移 */
  update(dt: number, listener?: Vector3): Vector3 {
    if (this.disposed) return Vector3.ZeroReadOnly as Vector3;
    if (listener) this.fx.listener.copyFrom(listener);
    return this.fx.update(dt);
  }

  diag() {
    return { ...this.fx.stats(), field: { ...this.stats, texts: { ...this.stats.texts } }, hud: { ...this.hud }, prewarm: this.prewarmReport };
  }

  /** 離開地圖 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.fx.dispose();
  }
}
