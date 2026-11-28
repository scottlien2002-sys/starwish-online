/**
 * Stage 8.5（Claude D）：多人伺服器戰鬥事件 → Claude C「CombatFx 正式接入模組」的橋接。
 * 依 C 的《Combat VFX 正式接入模組（給 A、D）》第 6 節：
 *  - 其他玩家施放：cast 事件 → playSkill(其他玩家, skill, clip, rate)，owner "other"
 *  - 命中：只在伺服器的 hit 事件到達時呼叫 fx.hit；自己的命中帶伺服器的 damage／crit，其他玩家不帶數字
 *  - 本模組不扣血、不判斷命中暴擊、不送封包（全部依伺服器結果）
 *  - 同一個施放／命中只畫一次（CombatEventDedupe）
 *
 * 目前遊戲畫面仍使用 8.4 的 MpFieldCombat（共用 A 的原野特效）。這個橋接先完成並以 C 的穩定備份
 * `backup/combat-vfx-integration-ready`（556fee8）做型別與事件相容測試；正式接入時機由 Claude A 統一安排。
 *
 * 不 import Babylon（只用結構型別），所以伺服器測試（Node）也能直接執行。
 */
import { CombatEventDedupe } from "./mpEventDedupe.ts";
import type { FxKey, Palette, SfxKey, SkillDef, HitSpec } from "../combat-vfx/core/skills.ts";
import type { ClipTiming } from "../combat-vfx/core/timeline.ts";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
type Owner = "self" | "party" | "other";
type DamageStyle = "normal" | "crit" | "player" | "heal" | "miss";
/** C 的 CombatFx 中橋接會用到的部分（結構型別；與 556fee8 的 CombatFx 相容，見 tests/combatfx-compat） */
export interface CombatFxPort<V extends Vec3 = Vec3> {
  playSkill(actorId: string, skill: SkillDef, clip: ClipTiming, rate?: number, hooks?: { onHit?(hit: HitSpec, clipT: number): void; onEnd?(): void }): unknown;
  basicSwing(actorId: string, palette?: Palette, seconds?: number, sfx?: SfxKey): void;
  hit(at: V, keys: readonly FxKey[], o?: { owner: Owner; damage?: number | string; crit?: boolean; palette?: Palette; shake?: number; sfx?: SfxKey; ground?: V; style?: DamageStyle; actorId?: string }): void;
  monsterDeath(groundAt: V, scale?: number): void;
  playerHurt(chest: V, damage: number, shake?: number): void;
}

/** 橋接需要的遊戲端資訊（由 A 的整合程式提供） */
export interface BridgeContext<V extends Vec3> {
  myPid(): number;
  /** 伺服器 pid → CombatFx 已註冊的角色 id；沒有註冊（還沒載入、太遠被卸載）回傳 null */
  actorId(pid: number): string | null;
  /** 技能定義與動作時間（C 的 SKILLS／novice_combat_<g>.json）；未知技能回傳 null */
  skill(id: string, pid: number): { def: SkillDef; clip: ClipTiming } | null;
  /** 怪物命中點與地面點；怪物不存在回傳 null */
  monster(nid: number): { hitPoint: V; ground: V; scale: number } | null;
  /** 自己的胸口位置（受傷數字） */
  myChest(): V;
}

export interface BridgeEvent {
  k: string;
  q?: number;
  c?: number;
  p?: number;
  s?: string;
  t?: number;
  r?: number;
  h?: string;
  d?: number;
  cr?: 0 | 1;
  ms?: 0 | 1;
  kl?: 0 | 1;
  m?: number;
  b?: 0 | 1;
  by?: number;
  u?: string;
}

export class MpCombatFxBridge<V extends Vec3> {
  readonly stats = { casts: 0, remoteCasts: 0, basicSwings: 0, hits: 0, ownDamageNumbers: 0, crits: 0, misses: 0, playerHurt: 0, deaths: 0, duplicates: 0, skippedNoActor: 0, skippedNoMonster: 0, unknownSkill: 0 };
  private readonly dedupe = new CombatEventDedupe();
  private readonly fx: CombatFxPort<V>;
  private readonly ctx: BridgeContext<V>;
  /** 施放編號 → 技能 id（命中時找特效） */
  private readonly castSkill = new Map<number, { skill: string; pid: number }>();

  constructor(fx: CombatFxPort<V>, ctx: BridgeContext<V>) {
    this.fx = fx;
    this.ctx = ctx;
  }

  onEvent(e: BridgeEvent): void {
    if (!this.dedupe.accept(e)) {
      this.stats.duplicates++;
      return;
    }
    const me = this.ctx.myPid();
    switch (e.k) {
      case "cast": {
        const pid = e.p!;
        this.castSkill.set(e.c!, { skill: e.s!, pid });
        if (this.castSkill.size > 512) this.castSkill.delete(this.castSkill.keys().next().value!);
        const id = this.ctx.actorId(pid);
        if (!id) {
          this.stats.skippedNoActor++;
          return;
        }
        if (pid !== me) this.stats.remoteCasts++;
        if (e.s === "attack") {
          this.fx.basicSwing(id);
          this.stats.basicSwings++;
          return;
        }
        const sk = this.ctx.skill(e.s!, pid);
        if (!sk) {
          this.stats.unknownSkill++;
          this.fx.basicSwing(id);
          return;
        }
        // 命中由伺服器 hit 事件畫；onHit 不做任何判定
        this.fx.playSkill(id, sk.def, sk.clip, (e.r ?? 1000) / 1000, {});
        this.stats.casts++;
        return;
      }
      case "end":
        this.castSkill.delete(e.c!);
        return;
      case "hit": {
        const mon = this.ctx.monster(e.t!);
        if (!mon) {
          this.stats.skippedNoMonster++;
          return;
        }
        const self = e.p === me;
        const owner = self ? "self" : "other";
        const cs = this.castSkill.get(e.c!);
        const sk = cs && cs.skill !== "attack" ? this.ctx.skill(cs.skill, cs.pid) : null;
        const spec = sk ? findHit(sk.def, e.h!) : null;
        const actorId = this.ctx.actorId(e.p!) ?? undefined;
        if (e.ms) {
          this.stats.misses++;
          if (self) this.fx.hit(mon.hitPoint, [], { owner, damage: "MISS", style: "miss", actorId });
          return;
        }
        const crit = self && e.cr === 1;
        this.fx.hit(mon.hitPoint, spec?.fx ?? ["hitFlash", "hitSpark"], {
          owner,
          ...(self ? { damage: e.d, crit, shake: spec?.shake } : {}),
          palette: sk?.def.palette ?? "steel",
          sfx: crit ? "crit" : spec?.sfx ?? "hit",
          actorId,
        });
        this.stats.hits++;
        if (self) this.stats.ownDamageNumbers++;
        if (crit) this.stats.crits++;
        return;
      }
      case "mh": {
        if (e.p !== me || e.b) return;
        this.fx.playerHurt(this.ctx.myChest(), e.d ?? 0);
        this.stats.playerHurt++;
        return;
      }
      case "die": {
        const mon = this.ctx.monster(e.m!);
        if (!mon) return;
        this.fx.monsterDeath(mon.ground, mon.scale);
        this.stats.deaths++;
        return;
      }
      default:
        return;
    }
  }

  /** 換地圖／重新進入：清除去重與施放紀錄 */
  reset(): void {
    this.dedupe.reset();
    this.castSkill.clear();
  }
}

function findHit(def: SkillDef, id: string): HitSpec | null {
  for (const e of def.events) if ((e.kind === "hit" || e.kind === "projectile") && e.hit.id === id) return e.hit;
  return null;
}
