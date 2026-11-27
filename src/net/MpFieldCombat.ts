/**
 * Stage 8.2／8.3：星芽原野多人模式的客戶端戰鬥（伺服器權威）。
 *
 * 客戶端只做三件事：
 *   1. 送「攻擊哪一隻／施放哪個技能」的請求（伺服器驗證冷卻、距離、目標、武器）
 *   2. 把伺服器的怪物狀態套到 Claude A 的怪物框架（ai:false：不在本機跑 AI；位置、血量、攻擊、死亡、重生都照伺服器）
 *   3. 依伺服器事件播放動作與 Claude C 的特效、傷害數字（自己完整特效；其他玩家由 VfxBudget 依距離／品質簡化）
 * 傷害、暴擊、命中、經驗、金幣、掉落一律以伺服器結果為準，客戶端不計算。
 */
import { Color3, MeshBuilder, StandardMaterial, Vector3, type Mesh, type Scene } from "@babylonjs/core";
import type { MonsterController } from "../monsters/framework/index.ts";
import type { CombatEvent } from "../../multiplayer/shared/protocol.ts";
import type { NetClient, RemoteMonster, ServerLoot } from "../../multiplayer/client/NetClient.ts";
import { VfxSystem, type Projectile } from "../combat-vfx/fx/VfxSystem.ts";
import { DamageNumbers } from "../combat-vfx/fx/DamageNumbers.ts";
import { WeaponTrail } from "../combat-vfx/fx/WeaponTrail.ts";
import { PALETTES } from "../combat-vfx/fx/palette.ts";
import { skillById, type FxKey, type SkillDef, type SkillEvent } from "../combat-vfx/core/skills.ts";
import { SkillTimeline, type ClipTiming } from "../combat-vfx/core/timeline.ts";
import { VFX_QUALITY, type VfxTier } from "../combat-vfx/core/quality.ts";
import type { WeaponRig } from "../combat-vfx/weapons.ts";

export interface FieldHost {
  scene: Scene;
  hudRoot: HTMLElement;
  surface(x: number, z: number): number;
  monsters: MonsterController[];
  /** 本人畫面位置與朝向 */
  me(): { x: number; z: number; yaw: number };
  /** 其他玩家畫面位置（沒有模型時 null） */
  remotePose(pid: number): { x: number; z: number; yaw: number } | null;
  /** 播放本人動作（攻擊動作由本機先播，伺服器拒絕時不影響數值） */
  playAttack(targetInstanceId: string | null): void;
  playHurt(): void;
  toast(msg: string, ms: number): void;
  /** 本人的武器（殘影用；沒有時不畫殘影） */
  weapon(): WeaponRig | null;
  lite: boolean;
}

const ITEM_LABEL: Record<string, string> = { seed: "種子", egg: "孵化蛋", birdEgg: "鳥蛋", monsterMaterial: "怪物材料", shopFeed: "商店飼料", gold: "金幣" };
const MON_LABEL: Record<string, string> = {};

interface ActiveCast {
  c: number;
  pid: number;
  self: boolean;
  def: SkillDef | null;
  tl: SkillTimeline | null;
  yaw: number;
  targetNid: number;
  x: number;
  z: number;
  trail: WeaponTrail | null;
  trailEnd: number;
  age: number;
  dur: number;
}

interface LootView {
  mesh: Mesh;
  born: number;
  requested: number;
}

export class MpFieldCombat {
  readonly client: NetClient;
  private readonly host: FieldHost;
  readonly vfx: VfxSystem;
  readonly dmg: DamageNumbers;
  private readonly byNid = new Map<number, MonsterController>();
  private readonly seen = new Map<number, { attackId: number; state: string }>();
  private readonly casts = new Map<number, ActiveCast>();
  private readonly projectiles: { p: Projectile; targetNid: number; life: number }[] = [];
  private readonly lootViews = new Map<string, LootView>();
  private clips: Record<string, ClipTiming> = {};
  private time = 0;
  private nextLocalAttack = 0;
  private readonly mats = new Map<string, StandardMaterial>();
  readonly tier: VfxTier;
  /** 統計（測試介面） */
  readonly stats = { attacksSent: 0, attacksOk: 0, attacksRejected: 0, skillsSent: 0, skillsOk: 0, hitsShown: 0, castsShown: 0, remoteCastsShown: 0, picksSent: 0, picksOk: 0, picksRejected: 0, monsterHitsTaken: 0, damageDealt: 0, lastReject: "" };
  private readonly pendingCmd = new Map<string, "atk" | "sk" | "pick">();
  private readonly gender: "male" | "female";

  constructor(client: NetClient, host: FieldHost, gender: "male" | "female") {
    this.client = client;
    this.host = host;
    this.gender = gender;
    this.tier = host.lite ? "low" : "medium";
    this.vfx = new VfxSystem(host.scene, this.tier);
    this.dmg = new DamageNumbers(host.scene, host.hudRoot, VFX_QUALITY[this.tier].damageNumbers);
    for (const m of host.monsters) MON_LABEL[m.instance.definition.monsterId] = m.instance.definition.name;
    client.opts.onCombat = (e) => this.onEvent(e);
    void fetch(`${import.meta.env.BASE_URL}combat-vfx/novice_combat_${gender}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ clips: Record<string, ClipTiming> }>) : { clips: {} }))
      .then((j) => (this.clips = j.clips ?? {}))
      .catch(() => undefined);
  }

  /** 怪物對應：伺服器 instanceId（star_dew_bobo#1…）＝本機 instanceId（同樣的出生順序） */
  private mapMonsters(list: RemoteMonster[]): void {
    if (this.byNid.size === list.length && list.every((m) => this.byNid.has(m.nid))) return;
    this.byNid.clear();
    for (const r of list) {
      const mc = this.host.monsters.find((m) => m.instance.instanceId === r.instanceId);
      if (mc) this.byNid.set(r.nid, mc);
    }
  }

  monsterOf(nid: number): MonsterController | undefined {
    return this.byNid.get(nid);
  }

  nidOf(instanceId: string): number {
    for (const [nid, m] of this.byNid) if (m.instance.instanceId === instanceId) return nid;
    return 0;
  }

  // ---------------- 每幀 ----------------
  update(dt: number, now: number): void {
    this.time += dt;
    const list = this.client.monsters();
    this.mapMonsters(list);
    for (const r of list) {
      const mc = this.byNid.get(r.nid);
      if (!mc) continue;
      this.applyServerMonster(mc, r, now);
      const p = mc.instance.currentPosition;
      p.y = this.host.surface(p.x, p.z);
      mc.update(dt, now, null);
      p.y = this.host.surface(p.x, p.z);
    }
    this.updateCasts(dt);
    this.updateProjectiles(dt);
    this.updateLoot(dt);
    this.vfx.update(dt);
    this.dmg.update(dt);
  }

  private applyServerMonster(mc: MonsterController, r: RemoteMonster, now: number): void {
    const inst = mc.instance;
    const prev = this.seen.get(r.nid) ?? { attackId: r.attackId, state: r.state };
    const serverAlive = r.state !== "death" && r.state !== "dead" && r.state !== "respawn";
    // 位置、朝向：伺服器插值結果
    inst.currentPosition.x = r.x;
    inst.currentPosition.z = r.z;
    inst.yaw = r.yaw;
    if (!serverAlive && inst.isAlive) {
      inst.currentHp = 0;
      inst.sm.request("death");
    } else if (serverAlive && !inst.isAlive) {
      // 伺服器已重生：本機死亡動作播完就重生；還在播就直接回待機（以伺服器為準）
      if (!inst.respawn().accepted) inst.sm.resetToIdle();
    }
    inst.currentHp = r.hp;
    if (serverAlive) {
      if (r.attackId !== prev.attackId && r.state === "attack") inst.sm.request("attack");
      else if (r.state === "move" || r.state === "idle") inst.setLocomotion(r.state === "move");
    }
    mc.speedOverride = r.state === "move" ? Math.max(1, inst.definition.moveSpeed * 0.8) : 0;
    this.seen.set(r.nid, { attackId: r.attackId, state: r.state });
    void now;
  }

  // ---------------- 輸入 ----------------
  /** 普通攻擊：選最近的存活怪物（伺服器會再驗證距離與冷卻） */
  attack(range = 2.5): boolean {
    if (this.time < this.nextLocalAttack || this.client.state !== "online" || this.client.self?.down) return false;
    const t = this.pickTarget(range + 0.4);
    if (!t) {
      this.host.toast("攻擊範圍內沒有怪物，請再靠近一點", 1000);
      return false;
    }
    const id = this.client.command("atk", { t: t.nid });
    this.pendingCmd.set(id, "atk");
    this.stats.attacksSent++;
    this.nextLocalAttack = this.time + 0.3;
    this.host.playAttack(t.mc.instance.instanceId);
    return true;
  }

  /** 展示技能（非正式職業技能）：短劍 → 三段連擊；法杖 → 魔法彈 */
  skill(weapon: "sword" | "staff"): boolean {
    if (this.client.state !== "online" || this.client.self?.down) return false;
    const def = skillById(weapon === "staff" ? "staff_cast" : "triple_slash");
    if (!def) return false;
    const t = this.pickTarget(def.range + 0.4);
    if (!t && def.faceTarget) {
      this.host.toast(`「${def.label}」範圍內沒有怪物`, 1000);
      return false;
    }
    const me = this.host.me();
    const id = this.client.command("sk", { s: def.id, t: t?.nid ?? 0, y: Math.round(Math.atan2(Math.sin(me.yaw), Math.cos(me.yaw)) * 1000) });
    this.pendingCmd.set(id, "sk");
    this.stats.skillsSent++;
    this.host.playAttack(t?.mc.instance.instanceId ?? null);
    return true;
  }

  private pickTarget(range: number): { nid: number; mc: MonsterController } | null {
    const me = this.host.me();
    let best: { nid: number; mc: MonsterController } | null = null;
    let bd = Infinity;
    for (const [nid, mc] of this.byNid) {
      if (!mc.instance.isAlive) continue;
      const q = mc.instance.currentPosition;
      const d = Math.hypot(q.x - me.x, q.z - me.z) - (mc.instance.definition.bodyRadius ?? 0);
      if (d <= range && d < bd) [bd, best] = [d, { nid, mc }];
    }
    return best;
  }

  /** 指令結果（MpWorld 轉來） */
  onCommandResult(id: string, ok: boolean, err?: string): void {
    const k = this.pendingCmd.get(id);
    if (!k) return;
    this.pendingCmd.delete(id);
    if (k === "atk") ok ? this.stats.attacksOk++ : this.stats.attacksRejected++;
    else if (k === "sk") {
      if (ok) this.stats.skillsOk++;
      else this.host.toast(err === "skill_cooldown" ? "技能冷卻中" : err === "wrong_weapon" ? "目前的武器不能使用這個技能" : `技能無法使用（${err}）`, 900);
    } else if (k === "pick") ok ? this.stats.picksOk++ : this.stats.picksRejected++;
    if (!ok && err) this.stats.lastReject = `${k}:${err}`;
  }

  // ---------------- 伺服器事件 ----------------
  private onEvent(e: CombatEvent): void {
    const me = this.client.pid;
    switch (e.k) {
      case "cast": {
        const def = e.s === "attack" ? null : skillById(e.s) ?? null;
        const clip = def ? this.clips[def.clip] : undefined;
        const self = e.p === me;
        const tl = def && clip ? new SkillTimeline(def, clip, e.r / 1000) : null;
        let trail: WeaponTrail | null = null;
        const w = self ? this.host.weapon() : null;
        if (self && w && def?.weapon === "sword") trail = new WeaponTrail(this.host.scene, w.base, w.tip, VFX_QUALITY[this.tier].trailSegments, VFX_QUALITY[this.tier].trailLife, null);
        this.casts.set(e.c, { c: e.c, pid: e.p, self, def, tl, yaw: e.y / 1000, targetNid: e.t, x: e.x / 100, z: e.z / 100, trail, trailEnd: -1, age: 0, dur: e.dur / 1000 });
        if (self) this.stats.castsShown++;
        else this.stats.remoteCastsShown++;
        return;
      }
      case "end": {
        const c = this.casts.get(e.c);
        c?.trail?.dispose();
        this.casts.delete(e.c);
        return;
      }
      case "hit": {
        const mc = this.byNid.get(e.t);
        if (!mc) return;
        const q = mc.instance.currentPosition;
        const at = new Vector3(q.x, this.host.surface(q.x, q.z) + Math.min(1.4, (mc.instance.definition.height ?? 1) * 0.45), q.z);
        const self = e.p === me;
        const cast = this.casts.get(e.c);
        const owner = self ? "self" : "other";
        const dist = this.distToMe(q.x, q.z);
        if (e.ms) {
          if (self) this.dmg.show(at.add(new Vector3(0, 0.35, 0)), "MISS", "miss");
          return;
        }
        const spec = cast?.def ? findHit(cast.def, e.h) : null;
        const keys: FxKey[] = spec?.fx ?? ["hitFlash", "hitSpark"];
        this.vfx.hitFx(at, keys, self && e.cr === 1, { owner, palette: cast?.def?.palette ?? "steel", distance: dist });
        if (self || dist < 18) this.dmg.show(at.add(new Vector3(0, 0.35, 0)), e.d, e.cr ? "crit" : "normal");
        this.stats.hitsShown++;
        if (self) this.stats.damageDealt += e.d;
        // 受擊回饋（0 傷害：只播受擊閃光，血量用伺服器的值）
        if (e.d > 0 && mc.instance.isAlive && !e.kl) {
          const hp = mc.instance.currentHp;
          mc.instance.receiveDamage(0, this.time, "normal");
          mc.instance.currentHp = hp;
        }
        return;
      }
      case "mh": {
        if (e.p !== me) return;
        this.stats.monsterHitsTaken++;
        const p = this.host.me();
        this.dmg.show(new Vector3(p.x, this.host.surface(p.x, p.z) + 1.9, p.z), e.b ? "格擋" : e.d, "player");
        if (e.d > 0 && e.hp > 0) this.host.playHurt();
        const mc = this.byNid.get(e.m);
        this.host.toast(e.hp === 0 ? "你倒下了…（伺服器判定）" : `受到${mc?.instance.definition.name ?? "怪物"}攻擊 -${e.d}`, 900);
        return;
      }
      case "die": {
        const mc = this.byNid.get(e.m);
        if (mc && e.by === me) this.host.toast(`擊敗${mc.instance.definition.name}！`, 1200);
        return;
      }
      case "exp":
        if (e.p === me) this.host.toast(`經驗 +${e.n}${this.client.self && e.lv > this.client.self.level ? `・升級！Lv.${e.lv}` : ""}`, 1300);
        return;
      case "loot":
        this.spawnLoot({ uid: e.u, defId: e.i, qty: e.n, x: e.x / 100, z: e.z / 100, ownerPid: e.o, ownerUntil: e.ou, expiresAt: e.ex });
        return;
      case "lgone": {
        const v = this.lootViews.get(e.u);
        if (v) {
          v.mesh.dispose();
          this.lootViews.delete(e.u);
        }
        return;
      }
      case "down":
        return;
    }
  }

  private distToMe(x: number, z: number): number {
    const me = this.host.me();
    return Math.hypot(x - me.x, z - me.z);
  }

  private casterPos(c: ActiveCast): { x: number; z: number; yaw: number } {
    if (c.self) return this.host.me();
    return this.host.remotePose(c.pid) ?? { x: c.x, z: c.z, yaw: c.yaw };
  }

  private updateCasts(dt: number): void {
    for (const c of [...this.casts.values()]) {
      c.age += dt;
      if (c.age > c.dur + 3) {
        c.trail?.dispose();
        this.casts.delete(c.c);
        continue;
      }
      c.trail?.update(dt);
      if (c.trailEnd >= 0 && c.tl && c.tl.t >= c.trailEnd) {
        c.trail?.stop();
        c.trailEnd = -1;
      }
      if (!c.tl || c.tl.done) continue;
      for (const f of c.tl.advance(dt)) this.runVisual(c, f.event, f.end);
    }
  }

  /** 技能畫面事件（特效、投射物、殘影）。傷害、命中由伺服器的 hit 事件決定，這裡不結算 */
  private runVisual(c: ActiveCast, ev: SkillEvent, end?: number): void {
    const def = c.def!;
    const pos = this.casterPos(c);
    const dist = this.distToMe(pos.x, pos.z);
    const owner = c.self ? "self" : "other";
    const fwd = new Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    const gy = this.host.surface(pos.x, pos.z);
    const base = new Vector3(pos.x, gy, pos.z);
    const tgt = this.byNid.get(c.targetNid);
    const tpos = tgt ? new Vector3(tgt.instance.currentPosition.x, this.host.surface(tgt.instance.currentPosition.x, tgt.instance.currentPosition.z) + 0.6, tgt.instance.currentPosition.z) : null;
    switch (ev.kind) {
      case "trail":
        if (c.trail) {
          c.trail.setColor(PALETTES[ev.palette ?? def.palette].main);
          c.trail.start();
          c.trailEnd = end ?? (c.tl?.t ?? 0) + 0.2;
        }
        return;
      case "fx": {
        const at = ev.anchor === "target" ? tpos ?? base.add(fwd.scale(4)) : ev.anchor === "front" ? base.add(fwd.scale(ev.forward ?? 0.6)).addInPlaceFromFloats(0, 0.55, 0) : ev.anchor === "weapon" ? base.add(new Vector3(0, 1.0, 0)).addInPlace(fwd.scale(0.3)) : base.clone();
        this.vfx.spawn(ev.fx, at, { owner, palette: ev.palette ?? def.palette, yaw: c.yaw, scale: ev.scale, duration: ev.duration, distance: dist });
        return;
      }
      case "projectile": {
        let from: Vector3;
        let dir: Vector3;
        if (ev.from === "sky") {
          const dest = tpos ?? base.add(fwd.scale(6));
          from = dest.add(new Vector3(-2.2, 9, -1.5));
          dir = dest.subtract(from);
        } else {
          from = base.add(fwd.scale(0.6)).addInPlaceFromFloats(0, ev.from === "weapon" ? 1.0 : 0.55, 0);
          dir = ev.fx === "swordWave" || !tpos ? fwd.clone() : tpos.subtract(from);
        }
        const p = this.vfx.launch(ev.fx, from, dir, ev.speed, { owner, palette: ev.palette ?? def.palette, distance: dist });
        if (p) this.projectiles.push({ p, targetNid: ev.homing ? c.targetNid : 0, life: ev.maxRange / ev.speed + 0.3 });
        return;
      }
      default:
        return;
    }
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const P = this.projectiles[i]!;
      P.life -= dt;
      if (!P.p.alive) {
        this.projectiles.splice(i, 1);
        continue;
      }
      const t = P.targetNid ? this.byNid.get(P.targetNid) : undefined;
      if (t) {
        const q = t.instance.currentPosition;
        const dest = new Vector3(q.x, this.host.surface(q.x, q.z) + 0.6, q.z);
        P.p.steer(dest, 0.2);
        if (Vector3.Distance(P.p.pos, dest) < 0.45) P.life = 0;
      }
      if (P.life <= 0) {
        P.p.dispose(true);
        this.projectiles.splice(i, 1);
      }
    }
  }

  // ---------------- 掉落物（伺服器的實體；靠近自動撿取，伺服器判定是否成功） ----------------
  private mat(defId: string): StandardMaterial {
    let m = this.mats.get(defId);
    if (!m) {
      m = new StandardMaterial(`mpLoot_${defId}`, this.host.scene);
      const c = defId === "gold" ? new Color3(1, 0.82, 0.25) : defId === "egg" || defId === "birdEgg" ? new Color3(1, 0.93, 0.78) : defId === "monsterMaterial" ? new Color3(0.62, 0.48, 0.95) : new Color3(0.55, 0.85, 0.45);
      m.diffuseColor = c;
      m.emissiveColor = c.scale(0.45);
      this.mats.set(defId, m);
    }
    return m;
  }

  private spawnLoot(l: ServerLoot): void {
    if (this.lootViews.has(l.uid)) return;
    const mesh =
      l.defId === "gold"
        ? MeshBuilder.CreateCylinder(`mpLoot_${l.uid}`, { diameter: 0.2, height: 0.035, tessellation: 18 }, this.host.scene)
        : l.defId === "monsterMaterial"
          ? MeshBuilder.CreatePolyhedron(`mpLoot_${l.uid}`, { type: 1, size: 0.09 }, this.host.scene)
          : MeshBuilder.CreateSphere(`mpLoot_${l.uid}`, { diameter: 0.18, segments: 10 }, this.host.scene);
    if (l.defId === "gold") mesh.rotation.x = Math.PI / 2;
    mesh.material = this.mat(l.defId);
    mesh.isPickable = false;
    mesh.position.set(l.x, this.host.surface(l.x, l.z) + 0.25, l.z);
    this.lootViews.set(l.uid, { mesh, born: this.time, requested: -10 });
  }

  private updateLoot(dt: number): void {
    const me = this.host.me();
    const nowMs = this.client.serverNow();
    const down = !!this.client.self?.down;
    for (const [uid, v] of this.lootViews) {
      const l = this.client.loot.get(uid);
      if (!l) {
        v.mesh.dispose();
        this.lootViews.delete(uid);
        continue;
      }
      v.mesh.rotation.y += dt * 1.6;
      v.mesh.position.y = this.host.surface(l.x, l.z) + 0.25 + Math.sin((this.time - v.born) * 3) * 0.05;
      const mine = l.ownerPid === this.client.pid || nowMs >= l.ownerUntil;
      if (!down && mine && Math.hypot(l.x - me.x, l.z - me.z) <= 1.5 && this.time - v.requested > 2) {
        v.requested = this.time;
        const id = this.client.command("pick", { u: uid });
        this.pendingCmd.set(id, "pick");
        this.stats.picksSent++;
      }
    }
    // 伺服器清單有、畫面沒有（完整同步後）→ 補畫
    for (const l of this.client.loot.values()) if (!this.lootViews.has(l.uid)) this.spawnLoot(l);
  }

  lootLabel(defId: string): string {
    return ITEM_LABEL[defId] ?? defId;
  }

  info(): Record<string, unknown> {
    return {
      ...this.stats,
      monsters: this.byNid.size,
      casts: this.casts.size,
      loot: this.lootViews.size,
      vfx: { ...this.vfx.stats },
      self: this.client.self,
      monsterHp: [...this.byNid.entries()].map(([nid, m]) => [nid, m.instance.instanceId, m.instance.currentHp, m.instance.currentState]),
    };
  }

  dispose(): void {
    for (const c of this.casts.values()) c.trail?.dispose();
    for (const v of this.lootViews.values()) v.mesh.dispose();
    this.lootViews.clear();
    this.vfx.dispose();
    this.dmg.dispose();
    if (this.client.opts.onCombat) this.client.opts.onCombat = undefined;
  }
}

function findHit(def: SkillDef, id: string) {
  for (const e of def.events) if ((e.kind === "hit" || e.kind === "projectile") && e.hit.id === id) return e.hit;
  return null;
}
