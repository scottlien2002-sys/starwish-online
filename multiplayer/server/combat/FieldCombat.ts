/**
 * Stage 8.2／8.3：星芽原野的伺服器權威戰鬥（每個原野房間一份）。
 *
 * - 怪物：用 Claude A 的怪物框架（MonsterFactory，不建立模型）在伺服器執行 AI、狀態機、攻擊命中時間、死亡與重生；
 *   出生位置、數量、種類與客戶端相同（星露啵啵 6 隻＋已交付的 M004～M007）。
 * - 仇恨：每隻怪物記錄每位玩家造成的仇恨；目標＝仇恨最高的可攻擊玩家，主動怪沒有仇恨時找最近的玩家。
 * - 玩家攻擊／技能：客戶端只送「我要打哪一隻／用哪個技能」，伺服器驗證冷卻（攻速上限 160）、距離、目標合法，
 *   在命中時間點用伺服器的角色數值判定命中、暴擊、傷害；每段命中以 castId＋hitId＋targetId 只結算一次。
 * - 怪物攻擊：在 A 的命中時間點判定距離、格擋與傷害；玩家生命由伺服器保存，歸零即倒地。
 * - 擊殺：同一隻怪物每次死亡只結算一次（經驗、金幣、掉落）；掉落物有 UUID，同一件只能被撿一次。
 */
import { randomUUID } from "node:crypto";
import { createMonsterRegistry, MonsterFactory, type MonsterController } from "../../../src/monsters/framework/index.ts";
import { FIELD_RIGGED_SPAWNS } from "../../../src/monsters/rigged/riggedSpec.ts";
import { BOBO_PROFILE_IDS } from "../../../src/game/boboVariant.ts";
import { ZONES } from "../../../src/maps/starsprout/layout.ts";
import { FIELD_TEST, combatTuningFromStats, zoneSpawnPoints } from "../../../src/game/fieldRules.ts";
import { separate } from "../../../src/game/previewCombat.ts";
import { clampAttackSpeed } from "../../../src/core/rules.ts";
import { ANIM_TIMING, attackPlaybackRate } from "../../../src/actors/animTiming.ts";
import { expToNext, gainExp } from "../../../src/core/progression.ts";
import { rollDrops } from "../../../src/pets/petSystem.ts";
import { rollGold } from "../../../src/economy/economyConfig.ts";
import { createRng, type Rng } from "../../../src/core/rng.ts";
import { skillById, type HitSpec, type SkillDef } from "../../../src/combat-vfx/core/skills.ts";
import { SkillTimeline } from "../../../src/combat-vfx/core/timeline.ts";
import { skillRate } from "../../../src/combat-vfx/core/damage.ts";
import { ANIM, MON_STATES, toCm, toMrad, type CombatEvent, type MonTuple } from "../../shared/protocol.ts";
import type { CharacterStore, InventoryItem } from "../persistence/Store.ts";
import type { ServerPlayer } from "../Room.ts";
import { COMBAT_TEST_RULES as R } from "./rules.ts";
import { loadCombatData, type CombatData } from "./data.ts";

/** 玩家基礎能力值（Claude A 測試設定；寵物加成在 Stage 8.4 移到伺服器前一律不採用客戶端數值） */
export const SERVER_BASE_STATS = FIELD_TEST.baseStats;

interface ServerMonster {
  nid: number;
  ctl: MonsterController;
  threat: Map<number, number>;
  dmgBy: Map<number, number>;
  lastSent: MonTuple | null;
  deaths: number;
  settledDeath: number;
}

export interface LootEntity {
  uid: string;
  defId: string;
  qty: number;
  x: number;
  z: number;
  ownerPid: number;
  ownerChar: string | null;
  ownerUntil: number;
  expiresAt: number;
  claimed: boolean;
}

interface PendingHit {
  at: number;
  castId: number;
  hitId: string;
  pid: number;
  skill: SkillDef | null;
  spec: HitSpec | null;
  targetNid: number;
  /** 施放時的位置與朝向（範圍判定用） */
  x: number;
  z: number;
  yaw: number;
}

export interface CombatCounters {
  attacksAccepted: number;
  attacksRejected: Record<string, number>;
  hitsResolved: number;
  duplicateHitsBlocked: number;
  kills: number;
  killsSettled: number;
  duplicateKillsBlocked: number;
  lootSpawned: number;
  lootPicked: number;
  lootPickRejected: Record<string, number>;
  monsterHits: number;
  playersDowned: number;
  hitsOnDeadTarget?: number;
}

const STATE_CODE = new Map<string, number>(MON_STATES.map((s, i) => [s, i]));
const sameTuple = (a: readonly number[] | null, b: readonly number[]): boolean => !!a && a.length === b.length && a.every((v, i) => v === b[i]);

export interface CombatHost {
  readonly key: string;
  players(): Iterable<ServerPlayer>;
  get(pid: number): ServerPlayer | undefined;
  ground(x: number, z: number): number;
}

export class FieldCombat {
  readonly monsters: ServerMonster[] = [];
  readonly loot = new Map<string, LootEntity>();
  private readonly byNid = new Map<number, ServerMonster>();
  private readonly pending: PendingHit[] = [];
  private readonly resolved = new Set<string>();
  private events: CombatEvent[] = [];
  private castSeq = 0;
  private readonly host: CombatHost;
  private readonly store: CharacterStore;
  private readonly data: CombatData;
  private readonly rng: Rng;
  readonly counters: CombatCounters = { attacksAccepted: 0, attacksRejected: {}, hitsResolved: 0, duplicateHitsBlocked: 0, kills: 0, killsSettled: 0, duplicateKillsBlocked: 0, lootSpawned: 0, lootPicked: 0, lootPickRejected: {}, monsterHits: 0, playersDowned: 0 };
  /** 送背包更新給玩家（GameServer 提供） */
  onInventory: (p: ServerPlayer) => void = () => {};

  constructor(host: CombatHost, store: CharacterStore, seed = Date.now() >>> 0) {
    this.host = host;
    this.store = store;
    this.data = loadCombatData();
    this.rng = createRng(seed);
    const reg = createMonsterRegistry();
    // 與客戶端 StarsproutGame 相同的出生順序與兩個工廠 → instanceId 相同（star_dew_bobo#1…、windfeather_fox#1…）
    const boboFactory = new MonsterFactory(reg);
    const rigFactory = new MonsterFactory(reg);
    const z1 = ZONES.find((z) => z.id === "01")!;
    let nid = 1;
    const add = (ctl: MonsterController): void => {
      const p = ctl.instance.currentPosition;
      p.y = host.ground(p.x, p.z);
      const m: ServerMonster = { nid: nid++, ctl, threat: new Map(), dmgBy: new Map(), lastSent: null, deaths: 0, settledDeath: 0 };
      this.monsters.push(m);
      this.byNid.set(m.nid, m);
    };
    for (const p of zoneSpawnPoints(z1.x, z1.z, z1.r, FIELD_TEST.boboCount)) {
      add(boboFactory.create("star_dew_bobo", { x: p.x, y: 0, z: p.z }, { visual: false, animationProfileId: BOBO_PROFILE_IDS.v38r }));
    }
    for (const { zoneId, spec } of FIELD_RIGGED_SPAWNS) {
      // 只有 GLB 已交付的怪物會出現（HQ／Lite 都要在清單上）；沒交付的區域保持空的
      if (!this.data.deliveredModels.has(spec.files.lite) || !this.data.deliveredModels.has(spec.files.hq)) continue;
      const zone = ZONES.find((z) => z.id === zoneId)!;
      for (const p of zoneSpawnPoints(zone.x, zone.z, zone.r * (zone.cap === 1 ? 0 : 0.75), zone.cap ?? 1)) {
        add(rigFactory.create(spec.monsterId, { x: p.x, y: 0, z: p.z }, { visual: false, brain: { seed: Math.round(p.x * 31 + p.z * 17) } }));
      }
    }
  }

  monster(nid: number): ServerMonster | undefined {
    return this.byNid.get(nid);
  }

  /** 玩家的戰鬥數值（伺服器端；攻速上限 160） */
  tuning(p: ServerPlayer): ReturnType<typeof combatTuningFromStats> & { attackSpeed: number } {
    const s = { ...SERVER_BASE_STATS, attackSpeed: clampAttackSpeed(SERVER_BASE_STATS.attackSpeed) };
    return { ...combatTuningFromStats(s), attackSpeed: s.attackSpeed };
  }

  private reject(reason: string): { ok: false; err: string } {
    this.counters.attacksRejected[reason] = (this.counters.attacksRejected[reason] ?? 0) + 1;
    return { ok: false, err: reason };
  }

  private canAct(p: ServerPlayer, nowS: number): string | null {
    if (p.down || p.cs.hp <= 0) return "down";
    if (!p.connected) return "offline";
    if (nowS < p.cs.busyUntil - R.cooldownSlack) return "busy";
    return null;
  }

  private distToBody(p: ServerPlayer, m: ServerMonster): number {
    const q = m.ctl.instance.currentPosition;
    return Math.hypot(q.x - p.x, q.z - p.z) - (m.ctl.instance.definition.bodyRadius ?? 0);
  }

  // ---------------- 玩家普通攻擊 ----------------
  attack(p: ServerPlayer, targetNid: number, nowS: number): { ok: true; castId: number; hitAt: number } | { ok: false; err: string } {
    const why = this.canAct(p, nowS);
    if (why) return this.reject(why);
    if (nowS < p.cs.nextAtk - R.cooldownSlack) return this.reject("cooldown");
    const m = this.byNid.get(targetNid);
    if (!m || !m.ctl.instance.isAlive) return this.reject("bad_target");
    if (this.distToBody(p, m) > R.attackRange + R.latencySlack) return this.reject("out_of_range");
    const t = this.tuning(p);
    const rate = attackPlaybackRate(t.attackSpeed);
    const hitDelay = ANIM_TIMING.attack.hit / rate;
    p.cs.nextAtk = nowS + t.attackInterval;
    p.cs.busyUntil = nowS + t.attackInterval;
    const castId = ++this.castSeq;
    const q = m.ctl.instance.currentPosition;
    const yaw = Math.atan2(q.x - p.x, q.z - p.z);
    p.state.yaw = yaw;
    p.act = ANIM.Attack;
    p.actSeq++;
    this.counters.attacksAccepted++;
    this.addThreat(m, p.pid, 1);
    this.emit({ k: "cast", c: castId, p: p.pid, s: "attack", t: targetNid, x: toCm(p.x), z: toCm(p.z), y: toMrad(yaw), st: Date.now(), r: Math.round(rate * 1000), dur: Math.round(t.attackInterval * 1000) });
    this.pending.push({ at: nowS + hitDelay, castId, hitId: "a", pid: p.pid, skill: null, spec: null, targetNid, x: p.x, z: p.z, yaw });
    this.pending.push({ at: nowS + t.attackInterval, castId, hitId: "__end", pid: p.pid, skill: null, spec: null, targetNid: 0, x: p.x, z: p.z, yaw });
    return { ok: true, castId, hitAt: hitDelay };
  }

  // ---------------- 技能（Claude C 的展示技能資料；技能不代表正式職業技能） ----------------
  skill(p: ServerPlayer, skillId: string, targetNid: number, yawMrad: number | null, nowS: number): { ok: true; castId: number; hits: number; duration: number } | { ok: false; err: string } {
    const why = this.canAct(p, nowS);
    if (why) return this.reject(why);
    const def = skillById(skillId);
    if (!def) return this.reject("unknown_skill");
    if (def.weapon !== p.appearance.weapon) return this.reject("wrong_weapon");
    const cdUntil = p.cs.cds.get(def.id) ?? 0;
    if (nowS < cdUntil - R.cooldownSlack) return this.reject("skill_cooldown");
    const target = targetNid ? this.byNid.get(targetNid) : undefined;
    if (targetNid && (!target || !target.ctl.instance.isAlive)) return this.reject("bad_target");
    if (target && this.distToBody(p, target) > def.range + R.latencySlack) return this.reject("out_of_range");
    if (!target && def.faceTarget && def.events.some((e) => e.kind === "projectile" && e.homing)) return this.reject("need_target");
    const clip = this.data.clips[p.gender][def.clip];
    if (!clip) return this.reject("no_clip");
    const t = this.tuning(p);
    const rate = skillRate(def.aspdScaled, t.attackSpeed);
    let yaw = p.yaw;
    if (target && def.faceTarget) {
      const q = target.ctl.instance.currentPosition;
      yaw = Math.atan2(q.x - p.x, q.z - p.z);
    } else if (yawMrad !== null && Number.isFinite(yawMrad)) yaw = yawMrad / 1000;
    p.state.yaw = yaw;
    p.act = ANIM.Attack;
    p.actSeq++;
    // 用 C 的 SkillTimeline 算出每段命中（含頓幀）的實際時間；投射物＝放出時間＋飛行距離／速度
    const tl = new SkillTimeline(def, clip, rate);
    const castId = ++this.castSeq;
    let el = 0;
    let n = 0;
    const step = 1 / 240;
    while (!tl.done && el < 12) {
      el += step;
      for (const fe of tl.advance(step)) {
        if (fe.event.kind === "hit") {
          this.pending.push({ at: nowS + el, castId, hitId: fe.event.hit.id, pid: p.pid, skill: def, spec: fe.event.hit, targetNid, x: p.x, z: p.z, yaw });
          tl.hitstop(fe.event.hit.hitstopMs);
          n++;
        } else if (fe.event.kind === "projectile") {
          const q = target?.ctl.instance.currentPosition;
          const dist = q ? Math.min(fe.event.maxRange, Math.hypot(q.x - p.x, q.z - p.z)) : fe.event.maxRange;
          this.pending.push({ at: nowS + el + dist / fe.event.speed, castId, hitId: fe.event.hit.id, pid: p.pid, skill: def, spec: fe.event.hit, targetNid, x: p.x, z: p.z, yaw });
          n++;
        }
      }
    }
    const duration = el;
    p.cs.cds.set(def.id, nowS + Math.max(def.cooldown, 0));
    p.cs.busyUntil = nowS + duration;
    p.cs.nextAtk = Math.max(p.cs.nextAtk, nowS + duration);
    this.counters.attacksAccepted++;
    if (target) this.addThreat(target, p.pid, 1);
    this.emit({ k: "cast", c: castId, p: p.pid, s: def.id, t: targetNid, x: toCm(p.x), z: toCm(p.z), y: toMrad(yaw), st: Date.now(), r: Math.round(rate * 1000), dur: Math.round(duration * 1000) });
    this.pending.push({ at: nowS + duration, castId, hitId: "__end", pid: p.pid, skill: def, spec: null, targetNid: 0, x: p.x, z: p.z, yaw });
    return { ok: true, castId, hits: n, duration };
  }

  /** 命中範圍內的怪物（技能範圍判定用；單體或普通攻擊只打目標） */
  private targetsFor(h: PendingHit): ServerMonster[] {
    const tgt = h.targetNid ? this.byNid.get(h.targetNid) : undefined;
    const spec = h.spec;
    if (!spec || spec.single) return tgt ? [tgt] : [];
    const p = this.host.get(h.pid);
    const cx = p?.x ?? h.x;
    const cz = p?.z ?? h.z;
    const out: ServerMonster[] = [];
    for (const m of this.monsters) {
      if (!m.ctl.instance.isAlive) continue;
      const q = m.ctl.instance.currentPosition;
      const br = m.ctl.instance.definition.bodyRadius ?? 0;
      if (spec.shape.type === "circle") {
        const ox = spec.shape.center === "target" && tgt ? tgt.ctl.instance.currentPosition.x : cx;
        const oz = spec.shape.center === "target" && tgt ? tgt.ctl.instance.currentPosition.z : cz;
        if (Math.hypot(q.x - ox, q.z - oz) - br <= spec.shape.radius + R.latencySlack) out.push(m);
      } else {
        const d = Math.hypot(q.x - cx, q.z - cz);
        if (d - br > spec.shape.radius + R.latencySlack) continue;
        const ang = Math.atan2(q.x - cx, q.z - cz);
        const diff = Math.abs(Math.atan2(Math.sin(ang - h.yaw), Math.cos(ang - h.yaw)));
        if (d < 0.6 || diff <= (spec.shape.angleDeg * Math.PI) / 360) out.push(m);
      }
    }
    // 投射物（有目標）一定打得到目標本身
    if (tgt && tgt.ctl.instance.isAlive && !out.includes(tgt) && h.skill?.events.some((e) => e.kind === "projectile" && e.hit.id === h.hitId)) out.push(tgt);
    return out;
  }

  private resolveHit(h: PendingHit, nowS: number): void {
    const p = this.host.get(h.pid);
    if (h.hitId === "__end") {
      this.emit({ k: "end", c: h.castId, p: h.pid });
      return;
    }
    if (!p || p.down) return; // 施放者倒地或離開：之後的命中取消
    const list = this.targetsFor(h);
    const t = this.tuning(p);
    for (const m of list) {
      const key = `${h.castId}|${h.hitId}|${m.nid}`;
      if (this.resolved.has(key)) {
        this.counters.duplicateHitsBlocked++;
        continue;
      }
      this.resolved.add(key);
      // 命中時目標已經死亡（被別人先打倒）：不結算、不送傷害
      if (!m.ctl.instance.isAlive) {
        this.counters.hitsOnDeadTarget = (this.counters.hitsOnDeadTarget ?? 0) + 1;
        continue;
      }
      // 普通攻擊：命中時再確認距離（目標跑掉就揮空）
      if (!h.skill && this.distToBody(p, m) > R.attackRange + R.impactSlack + R.latencySlack) {
        this.emit({ k: "hit", c: h.castId, h: h.hitId, p: p.pid, t: m.nid, d: 0, cr: 0, ms: 1, hp: m.ctl.instance.currentHp, kl: 0 });
        continue;
      }
      const miss = !h.spec?.forceCrit && this.rng.next() > R.hitRate;
      const crit = !miss && (!!h.spec?.forceCrit || this.rng.next() < R.critRate);
      const mult = h.spec?.mult ?? 1;
      const dmg = miss ? 0 : Math.max(1, Math.round(t.attackDamage * mult * (crit ? R.critMult : 1)));
      const inst = m.ctl.instance;
      let killed = false;
      if (dmg > 0) {
        const r = inst.receiveDamage(dmg, nowS, "normal");
        killed = r.killed;
        if (r.applied) {
          m.dmgBy.set(p.pid, (m.dmgBy.get(p.pid) ?? 0) + dmg);
          this.addThreat(m, p.pid, dmg);
        }
      }
      this.counters.hitsResolved++;
      this.emit({ k: "hit", c: h.castId, h: h.hitId, p: p.pid, t: m.nid, d: dmg, cr: crit ? 1 : 0, ms: miss ? 1 : 0, hp: inst.currentHp, kl: killed ? 1 : 0 });
      if (killed) this.onKilled(m, p, nowS);
    }
  }

  private addThreat(m: ServerMonster, pid: number, v: number): void {
    m.threat.set(pid, (m.threat.get(pid) ?? 0) + v);
  }

  // ---------------- 擊殺：每次死亡只結算一次 ----------------
  private onKilled(m: ServerMonster, killer: ServerPlayer, _nowS: number): void {
    this.counters.kills++;
    m.deaths++;
    if (m.settledDeath >= m.deaths) {
      this.counters.duplicateKillsBlocked++;
      return;
    }
    m.settledDeath = m.deaths;
    this.counters.killsSettled++;
    const inst = m.ctl.instance;
    const def = inst.definition;
    const q = { x: inst.currentPosition.x, z: inst.currentPosition.z };
    this.emit({ k: "die", m: m.nid, by: killer.pid });
    // 經驗（測試設定：造成過傷害且在 30 m 內的玩家各得全額）
    const exp = def.experience ?? 0;
    for (const [pid] of m.dmgBy) {
      const pl = this.host.get(pid);
      if (!pl || Math.hypot(pl.x - q.x, pl.z - q.z) > R.expContributorRange || exp <= 0) continue;
      const prog = { level: pl.cs.level, exp: pl.cs.exp };
      gainExp(prog, exp);
      pl.cs.level = prog.level;
      pl.cs.exp = prog.exp;
      pl.cs.progressDirty = true;
      pl.cs.statsDirty = true;
      this.emit({ k: "exp", p: pid, n: exp, lv: pl.cs.level });
    }
    // 掉落歸屬：傷害最高的玩家（測試設定：30 秒後任何人可撿）
    let top = killer.pid;
    let best = -1;
    for (const [pid, d] of m.dmgBy) if (d > best) [best, top] = [d, pid];
    const owner = this.host.get(top);
    const items: { defId: string; qty: number }[] = rollDrops(this.rng, this.data.petTuning).map((k) => ({ defId: String(k), qty: 1 }));
    const gold = rollGold(this.data.economy, def.monsterId, this.rng.next());
    if (gold > 0) items.push({ defId: "gold", qty: gold });
    const nowMs = Date.now();
    items.forEach((it, i) => {
      const a = (i / Math.max(1, items.length)) * Math.PI * 2 + 0.7;
      const r = items.length > 1 ? 0.55 : 0;
      const e: LootEntity = { uid: randomUUID(), defId: it.defId, qty: it.qty, x: q.x + Math.cos(a) * r, z: q.z + Math.sin(a) * r, ownerPid: top, ownerChar: owner?.characterId ?? null, ownerUntil: nowMs + R.lootOwnerSeconds * 1000, expiresAt: nowMs + R.lootLifetime * 1000, claimed: false };
      this.loot.set(e.uid, e);
      this.counters.lootSpawned++;
      this.emit(this.lootEvent(e));
    });
    m.threat.clear();
    m.dmgBy.clear();
  }

  lootEvent(e: LootEntity): CombatEvent {
    return { k: "loot", u: e.uid, i: e.defId, n: e.qty, x: toCm(e.x), z: toCm(e.z), o: e.ownerPid, ou: e.ownerUntil, ex: e.expiresAt };
  }

  // ---------------- 撿取：同一件只會成功一次 ----------------
  async pick(p: ServerPlayer, uid: string): Promise<{ ok: true; defId: string; qty: number; gold?: number; item?: InventoryItem } | { ok: false; err: string }> {
    const rej = (e: string): { ok: false; err: string } => {
      this.counters.lootPickRejected[e] = (this.counters.lootPickRejected[e] ?? 0) + 1;
      return { ok: false, err: e };
    };
    const e = this.loot.get(uid);
    if (!e) return rej("gone");
    if (e.claimed) return rej("already_claimed");
    if (p.down) return rej("down");
    if (Math.hypot(p.x - e.x, p.z - e.z) > R.pickupRadius) return rej("out_of_range");
    if (Date.now() < e.ownerUntil && e.ownerChar && e.ownerChar !== p.characterId) return rej("not_owner");
    // 先在記憶體標記（Node 單執行緒：同時到達的兩個要求只有第一個會通過）
    e.claimed = true;
    try {
      // 資料庫寫入以掉落物 uid 為 requestId：重送或重試也只會入帳一次
      if (e.defId === "gold") {
        const r = await this.store.changeGold(p.characterId, `loot-${uid}`, e.qty, "monster_drop");
        if (!r.ok) throw new Error(r.err);
        p.cs.gold = r.balance;
        p.cs.statsDirty = true;
        this.finishPick(e, p);
        this.onInventory(p);
        return { ok: true, defId: e.defId, qty: e.qty, gold: r.balance };
      }
      const r = await this.store.grantItem(p.characterId, `loot-${uid}`, e.defId, e.qty);
      if (!r.ok) throw new Error(r.err);
      this.finishPick(e, p);
      this.onInventory(p);
      return { ok: true, defId: e.defId, qty: e.qty, ...(r.item ? { item: r.item } : {}) };
    } catch (err) {
      e.claimed = false;
      return rej(`store_error:${String(err instanceof Error ? err.message : err)}`);
    }
  }

  private finishPick(e: LootEntity, p: ServerPlayer): void {
    this.loot.delete(e.uid);
    this.counters.lootPicked++;
    this.emit({ k: "lgone", u: e.uid, by: p.pid });
  }

  // ---------------- 每 tick ----------------
  tick(dt: number, nowS: number): void {
    // 1. 到時間的命中
    if (this.pending.length) {
      this.pending.sort((a, b) => a.at - b.at);
      while (this.pending.length && this.pending[0]!.at <= nowS) this.resolveHit(this.pending.shift()!, nowS);
    }
    // 2. 怪物 AI
    const candidates = [...this.host.players()].filter((p) => p.connected && !p.down && p.cs.hp > 0);
    for (const m of this.monsters) {
      const inst = m.ctl.instance;
      // 仇恨：只保留還在場、可攻擊的玩家
      for (const pid of [...m.threat.keys()]) if (!candidates.some((c) => c.pid === pid)) m.threat.delete(pid);
      let target: ServerPlayer | null = null;
      let bestT = 0;
      for (const [pid, t] of m.threat) {
        const c = candidates.find((x) => x.pid === pid);
        if (c && t > bestT) [bestT, target] = [t, c];
      }
      // 沒有仇恨 → 最近的玩家（被動怪物是否追擊由 A 的 AI 判斷：Lv.1～4 只有被打過才反擊）
      if (!target) {
        let bd = Infinity;
        for (const c of candidates) {
          const d = Math.hypot(c.x - inst.currentPosition.x, c.z - inst.currentPosition.z);
          if (d < bd) [bd, target] = [d, c];
        }
      }
      const frame = m.ctl.update(dt, nowS, target ? { id: String(target.pid), x: target.x, z: target.z, alive: true } : null);
      inst.currentPosition.y = this.host.ground(inst.currentPosition.x, inst.currentPosition.z);
      if (frame.effects.includes("attackImpact") && inst.claimAttackImpact() !== null) this.monsterImpact(m, nowS);
      // 死亡動畫結束、重生後：清掉仇恨
      if (inst.currentState === "respawn") {
        m.threat.clear();
        m.dmgBy.clear();
      }
    }
    // 3. 怪物彼此保持距離（與單機版相同的處理）
    const alive = this.monsters.filter((m) => m.ctl.instance.isAlive).map((m) => m.ctl.instance.currentPosition);
    separate(alive, 1.0);
    // 4. 過期掉落物
    const nowMs = Date.now();
    for (const e of this.loot.values()) {
      if (!e.claimed && nowMs >= e.expiresAt) {
        this.loot.delete(e.uid);
        this.emit({ k: "lgone", u: e.uid, by: 0 });
      }
    }
  }

  private monsterImpact(m: ServerMonster, nowS: number): void {
    const inst = m.ctl.instance;
    const pid = Number(inst.currentTarget);
    const p = Number.isFinite(pid) ? this.host.get(pid) : undefined;
    if (!p || p.down || p.cs.hp <= 0) return;
    const d = Math.hypot(inst.currentPosition.x - p.x, inst.currentPosition.z - p.z);
    if (d > inst.definition.attackRange + R.impactSlack + R.latencySlack) return;
    const t = this.tuning(p);
    const blocked = this.rng.next() < R.playerBlockRate;
    const dmg = blocked ? 0 : Math.max(1, Math.floor(inst.definition.attack * t.damageTakenMul));
    p.cs.hp = Math.max(0, p.cs.hp - dmg);
    p.cs.statsDirty = true;
    this.counters.monsterHits++;
    this.emit({ k: "mh", m: m.nid, p: p.pid, d: dmg, b: blocked ? 1 : 0, hp: p.cs.hp });
    if (dmg > 0 && p.cs.hp > 0) {
      p.act = ANIM.Hurt;
      p.actSeq++;
    }
    if (p.cs.hp === 0) {
      p.down = true;
      p.cs.downAt = nowS;
      p.queue.length = 0;
      p.state.speed = 0;
      this.counters.playersDowned++;
      this.emit({ k: "down", p: p.pid });
      for (const mm of this.monsters) mm.threat.delete(p.pid);
    }
  }

  emit(e: CombatEvent): void {
    this.events.push(e);
  }

  takeEvents(): CombatEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  tuple(m: ServerMonster): MonTuple {
    const i = m.ctl.instance;
    return [m.nid, toCm(i.currentPosition.x), toCm(i.currentPosition.z), toMrad(Math.atan2(Math.sin(i.yaw), Math.cos(i.yaw))), i.currentHp, STATE_CODE.get(i.currentState) ?? 0, i.attackId, i.hitReactionSeq, Number(i.currentTarget) || 0];
  }

  /** 有變動的怪物（full＝全部） */
  monsterUpdates(full: boolean): MonTuple[] {
    const out: MonTuple[] = [];
    for (const m of this.monsters) {
      const t = this.tuple(m);
      if (full || !sameTuple(m.lastSent, t)) out.push(t);
    }
    return out;
  }

  markSent(): void {
    for (const m of this.monsters) m.lastSent = this.tuple(m);
  }

  meta(): [number, string, string, number][] {
    return this.monsters.map((m) => [m.nid, m.ctl.instance.instanceId, m.ctl.instance.definition.monsterId, m.ctl.instance.definition.maxHp]);
  }

  /** 玩家離開房間：清掉仇恨（掉落物保留給原主到歸屬時間結束） */
  onPlayerLeave(pid: number): void {
    for (const m of this.monsters) m.threat.delete(pid);
  }

  statsOf(p: ServerPlayer): [number, number, number, number, number, number, number] {
    return [p.cs.hp, p.cs.maxHp, p.cs.level, p.cs.exp, expToNext(p.cs.level), p.cs.gold, p.down ? 1 : 0];
  }
}
