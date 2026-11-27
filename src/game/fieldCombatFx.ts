/**
 * Stage 7.3：星芽原野的戰鬥特效（接 Claude C Combat VFX Stage 2 的 VfxSystem、DamageNumbers、ScreenFx）。
 * 只用在「普通攻擊」：命中火花、傷害數字、受傷紅框、怪物重生魔法陣＋光柱。
 * 六大職業技能尚未定案 → 不在正式遊戲裡上線（技能展示仍在 ?lab=combat）。
 */
import { Vector3, type Scene } from "@babylonjs/core";
import { VfxSystem } from "../combat-vfx/fx/VfxSystem.ts";
import { DamageNumbers } from "../combat-vfx/fx/DamageNumbers.ts";
import { ScreenFx } from "../combat-vfx/fx/ScreenFx.ts";
import { VFX_QUALITY, type VfxTier } from "../combat-vfx/core/quality.ts";

export class FieldCombatFx {
  readonly vfx: VfxSystem;
  readonly numbers: DamageNumbers;
  readonly screen: ScreenFx;
  readonly tier: VfxTier;
  /** 測試用計數 */
  readonly stats = { hitFx: 0, numbers: 0, hurt: 0, respawnFx: 0 };

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
