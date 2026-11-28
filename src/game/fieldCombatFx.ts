/**
 * Stage 7.3：星芽原野的戰鬥特效（接 Claude C Combat VFX Stage 2 的 VfxSystem、DamageNumbers、ScreenFx）。
 * 普通攻擊：命中火花、傷害數字、受傷紅框、怪物重生魔法陣＋光柱。
 * Stage 7.5 第二階段：C 的六段「展示技能」接到本地玩家（fieldSkills.ts），這裡提供技能特效、投射物、音效（CombatAudio）。
 * 六大職業的正式技能與數值尚未定案；展示技能只在 Stage 7.5 預覽開啟。
 */
import { Vector3, type Scene } from "@babylonjs/core";
import { VfxSystem } from "../combat-vfx/fx/VfxSystem.ts";
import { DamageNumbers } from "../combat-vfx/fx/DamageNumbers.ts";
import { ScreenFx } from "../combat-vfx/fx/ScreenFx.ts";
import { VFX_QUALITY, type VfxTier } from "../combat-vfx/core/quality.ts";
import { CombatAudio } from "../combat-vfx/fx/CombatAudio.ts";
import type { Projectile } from "../combat-vfx/fx/VfxSystem.ts";
import type { FxKey, Palette, SfxKey } from "../combat-vfx/core/skills.ts";
import type { TransformNode } from "@babylonjs/core";

export class FieldCombatFx {
  readonly vfx: VfxSystem;
  readonly numbers: DamageNumbers;
  readonly screen: ScreenFx;
  readonly tier: VfxTier;
  /** 測試用計數 */
  readonly stats = { hitFx: 0, numbers: 0, hurt: 0, respawnFx: 0, skillFx: 0, sfx: 0, projectiles: 0 };
  /** 技能音效（WebAudio 即時合成；iPhone 第一次點擊時 unlock） */
  audio: CombatAudio | null = null;
  private readonly projs = new Map<number, Projectile>();
  private projSeq = 0;

  constructor(scene: Scene, hudRoot: HTMLElement, tier: VfxTier) {
    this.tier = tier;
    this.vfx = new VfxSystem(scene, tier);
    // 星芽原野是白天地圖：彩色層改一般混合（C 的建議），白色核心維持發光
    this.vfx.setEnvironment("bright");
    this.numbers = new DamageNumbers(scene, hudRoot, VFX_QUALITY[tier].damageNumbers);
    this.screen = new ScreenFx(hudRoot);
    this.prewarm();
  }

  /**
   * Stage 7.4：先在地底下各播一次（建立粒子系統、編譯著色器），第一次命中時不會因為編譯而卡一下。
   * 數字層也先建立元素。
   */
  private prewarm(): void {
    const at = new Vector3(0, -500, 0);
    this.vfx.hitFx(at, ["hitFlash", "hitSpark", "starBurst"], false, { owner: "self" });
    this.vfx.spawn("lightPillar", at, { owner: "self" });
    this.vfx.update(5);
    this.vfx.update(5);
  }

  /** 玩家普通攻擊命中怪物（位置在地面；height = 怪物身高） */
  playerHit(x: number, groundY: number, z: number, height: number, damage: number, killed: boolean): void {
    const at = new Vector3(x, groundY + Math.max(0.35, height * 0.55), z);
    this.vfx.hitFx(at, killed ? ["hitFlash", "hitSpark", "starBurst"] : ["hitFlash", "hitSpark"], false, { owner: "self" });
    this.numbers.show(at.add(new Vector3(0, Math.max(0.3, height * 0.5), 0)), damage, "normal");
    this.stats.hitFx++;
    this.stats.numbers++;
  }

  /** 怪物命中玩家 */
  playerHurt(x: number, groundY: number, z: number, damage: number): void {
    this.numbers.show(new Vector3(x, groundY + 1.5, z), damage, "player");
    this.screen.flashHurt();
    this.stats.numbers++;
    this.stats.hurt++;
  }

  /** 怪物重生：腳下魔法陣＋光柱（C 的死亡重生介面第 3 步） */
  respawn(x: number, groundY: number, z: number, scale: number): void {
    this.vfx.spawn("lightPillar", new Vector3(x, groundY + 0.02, z), { owner: "self", scale });
    this.stats.respawnFx++;
  }

  /** 開啟技能：建立音效、預先建立技能特效（第一次施放不卡頓） */
  enableSkills(unlockRoot: HTMLElement): void {
    if (this.audio) return;
    const audio = new CombatAudio();
    this.audio = audio;
    unlockRoot.addEventListener("pointerdown", () => audio.unlock(), { capture: true });
    window.addEventListener("keydown", () => audio.unlock(), { capture: true });
    const at = new Vector3(0, -500, 0);
    for (const k of ["slashArc", "slashArcBig", "whirlRing", "magicCircle", "chargeAura", "chargeRings", "shockwave", "groundCrack", "areaBlast", "dustRing", "critBurst"] as FxKey[]) {
      try {
        this.vfx.spawn(k, at, { owner: "self" });
      } catch {
        // C 的特效清單若沒有這個鍵就略過（只是預熱）
      }
    }
    this.vfx.update(5);
    this.vfx.update(5);
  }

  skillFx(key: FxKey, x: number, y: number, z: number, opt: { yaw: number; scale?: number; duration?: number; palette?: Palette; follow?: TransformNode }): void {
    this.vfx.spawn(key, new Vector3(x, y, z), { owner: "self", ...opt });
    this.stats.skillFx++;
  }

  /** 技能命中：火花＋傷害數字（爆擊用 C 的爆擊樣式） */
  skillHit(keys: readonly FxKey[], x: number, y: number, z: number, height: number, damage: number, crit: boolean): void {
    const at = new Vector3(x, y, z);
    this.vfx.hitFx(at, keys, crit, { owner: "self" });
    this.numbers.show(at.add(new Vector3(0, Math.max(0.3, height * 0.5), 0)), damage, crit ? "crit" : "normal");
    if (crit) this.screen.flashCrit();
    this.stats.hitFx++;
    this.stats.numbers++;
  }

  sfx(key: SfxKey): void {
    if (!this.audio) return;
    this.audio.play(key);
    this.stats.sfx++;
  }

  launch(kind: "magicBolt" | "swordWave" | "meteor", x: number, y: number, z: number, dx: number, dz: number, speed: number, palette?: Palette): number | null {
    const p = this.vfx.launch(kind, new Vector3(x, y, z), new Vector3(dx, kind === "meteor" ? -0.9 : 0, dz).normalize(), speed, { owner: "self", palette });
    if (!p) return null;
    const h = ++this.projSeq;
    this.projs.set(h, p);
    this.stats.projectiles++;
    return h;
  }

  projPos(h: number): { x: number; y: number; z: number; travelled: number } | null {
    const p = this.projs.get(h);
    if (!p || !p.alive) {
      this.projs.delete(h);
      return null;
    }
    return { x: p.pos.x, y: p.pos.y, z: p.pos.z, travelled: p.travelled };
  }

  projSteer(h: number, x: number, y: number, z: number): void {
    this.projs.get(h)?.steer(new Vector3(x, y, z), 0.18);
  }

  projEnd(h: number, burst: boolean): void {
    const p = this.projs.get(h);
    if (p?.alive) p.dispose(burst);
    this.projs.delete(h);
  }

  update(dt: number): void {
    this.vfx.update(dt);
    this.numbers.update(dt);
    this.screen.update(dt);
  }

  dispose(): void {
    this.vfx.dispose();
    this.numbers.dispose();
  }
}
