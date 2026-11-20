/**
 * 測試用戰鬥場（不依賴 Babylon）：照 Game.updateMonsters 的順序模擬一幀
 *   玩家攻擊揮中 → 玩家復活 → 每隻怪物 AI＋狀態機＋動畫（V3.8R 驅動器）→ 撞擊結算 → 互相推開
 * 用真的 MonsterInstance／MonsterBrain／MonsterController／PreviewCombat；數值全部沿用遊戲設定。
 */
import { createMonsterRegistry, MonsterFactory, ProceduralVisual, type IMonsterVisual } from "../../../src/monsters/framework/index.ts";
import { MonsterBrain } from "../../../src/monsters/framework/MonsterBrain.ts";
import { MonsterController } from "../../../src/monsters/framework/MonsterController.ts";
import { MonsterInstance } from "../../../src/monsters/framework/MonsterInstance.ts";
import type { MonsterDefinition } from "../../../src/monsters/framework/types.ts";
import type { MonsterEffect, MonsterFace, MonsterPose, MonsterState, MonsterView } from "../../../src/monsters/anim/types.ts";
import { BoboV38RAnimDriver, type BoboDriverFrame } from "../../../src/monsters/star-dew-bobo-v38r/driver.ts";
import { PreviewCombat, separate } from "../../../src/game/previewCombat.ts";
import { ATTACK_TIMING } from "../../../src/actors/attackAnim.ts";

export class DriverVisual implements IMonsterVisual {
  readonly kind = "gltf" as const;
  readonly driver = new BoboV38RAnimDriver(0, 17, false);
  frame: BoboDriverFrame | null = null;
  reactions: { stagger: number; recoil: number; immune: boolean; kind?: "normal" | "control" }[] = [];
  load(): Promise<void> {
    return Promise.resolve();
  }
  setTransform(x: number, _y: number, z: number, yaw: number): void {
    this.driver.setTransform(x, z, yaw);
  }
  onStateEnter(s: MonsterState): void {
    this.driver.onStateEnter(s);
  }
  onHitReaction(r: { stagger: number; recoil: number; immune: boolean; kind?: "normal" | "control" }): void {
    this.reactions.push(r);
    this.driver.onHitReaction?.(r);
  }
  applyPose(_p: MonsterPose): void {}
  setFace(_f: MonsterFace): void {}
  playEffect(_e: MonsterEffect): void {}
  update(dt: number): void {
    this.frame = this.driver.update(dt);
  }
  dispose(): void {}
}

const nullView = (): MonsterView => ({ applyPose() {}, playEffect() {}, update() {}, dispose() {} });

export interface ArenaMonster {
  c: MonsterController;
  /** 撞擊時玩家在範圍內、真的扣到玩家 HP 的次數 */
  landed: number;
  landedAt: number[];
  hitsTaken: number;
  hitAt: number[];
  /** 存活且玩家在 AI 攻擊範圍內卻一直沒打到玩家的最長秒數（死亡或命中時重新計時） */
  maxEngagedNoLand: number;
  engagedSince: number | null;
}

export class Arena {
  now = 0;
  readonly combat = new PreviewCombat();
  readonly monsters: ArenaMonster[] = [];
  px = 0;
  pz = 0;
  /** 玩家是否一直按攻擊（照遊戲：冷卻 1 秒、揮中在 ATTACK_TIMING.hit） */
  autoAttack = true;
  /** 玩家不會倒地（只為了觀察怪物；HP 照扣、照記錄） */
  immortal = true;
  playerDamageTaken = 0;
  private readonly profileTimings;
  private readonly registry;
  private seq = 0;

  constructor() {
    this.registry = createMonsterRegistry()
      .addVisual("star_dew_bobo_procedural", () => new ProceduralVisual(nullView(), () => {}))
      .addVisual("star_dew_bobo_v38r", () => new DriverVisual())
      .addVisual("test_dummy_glb", () => new ProceduralVisual(nullView(), () => {}));
    this.profileTimings = this.registry.profile("star_dew_bobo_v38r");
    void new MonsterFactory(this.registry);
  }

  /** 加一隻 V3.8R 星露啵啵（可指定 HP，只為了讓長時間測試的怪物不被打死；遊戲數值不變） */
  add(x: number, z: number, opts: { maxHp?: number } = {}): ArenaMonster {
    const base = this.registry.definition("star_dew_bobo");
    const def: MonsterDefinition = opts.maxHp ? { ...base, maxHp: opts.maxHp } : base;
    const profile = this.profileTimings;
    const inst = new MonsterInstance(`m${++this.seq}`, def, profile.anim.timings, { x, y: 0, z });
    const brain = new MonsterBrain(inst, { seed: this.seq * 7919 });
    const c = new MonsterController(inst, profile, new DriverVisual(), brain);
    const am: ArenaMonster = { c, landed: 0, landedAt: [], hitsTaken: 0, hitAt: [], maxEngagedNoLand: 0, engagedSince: null };
    this.monsters.push(am);
    return am;
  }

  get instances(): MonsterInstance[] {
    return this.monsters.map((m) => m.c.instance);
  }

  tick(dt: number): void {
    this.now += dt;
    const insts = this.instances;
    if (this.autoAttack) this.combat.startAttack(this.now, this.px, this.pz, insts, ATTACK_TIMING.hit - 1e-6);
    const pend = this.combat.pendingAttack;
    const r = this.combat.resolvePending(this.now, this.px, this.pz, insts);
    if (r?.ok && pend) {
      const m = this.monsters.find((x) => x.c.instance.instanceId === pend.targetId)!;
      m.hitsTaken++;
      m.hitAt.push(this.now);
    }
    if (this.combat.update(this.now)) {
      this.px = 0;
      this.pz = 0;
    }
    const target = { id: "player", x: this.px, z: this.pz, alive: !this.combat.isDown };
    for (const m of this.monsters) {
      const frame = m.c.update(dt, this.now, target);
      if (frame.effects.includes("attackImpact") && m.c.instance.claimAttackImpact() !== null) {
        const dmg = this.combat.monsterImpact(this.now, m.c.instance, this.px, this.pz);
        if (dmg > 0) {
          m.landed++;
          m.landedAt.push(this.now);
          this.playerDamageTaken += dmg;
          if (this.immortal) this.combat.hp = 100;
        }
      }
    }
    for (const m of this.monsters) {
      const i = m.c.instance;
      const d = Math.hypot(i.currentPosition.x - this.px, i.currentPosition.z - this.pz);
      // AI 在 attackRange 內才會出手（被其他怪物擠在外圈、還在追擊的不算）
      const engaged = i.isAlive && !this.combat.isDown && d <= i.definition.attackRange + 0.05;
      if (!engaged || m.landedAt[m.landedAt.length - 1] === this.now) m.engagedSince = engaged ? this.now : null;
      else if (m.engagedSince === null) m.engagedSince = this.now;
      if (m.engagedSince !== null) m.maxEngagedNoLand = Math.max(m.maxEngagedNoLand, this.now - m.engagedSince);
    }
    const alive = this.monsters.filter((m) => m.c.instance.isAlive).map((m) => m.c.instance.currentPosition);
    separate(alive, 1.0, { x: this.px, z: this.pz, minDist: 0.85 });
  }

  run(seconds: number, dt = 1 / 60): void {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) this.tick(dt);
  }
}
