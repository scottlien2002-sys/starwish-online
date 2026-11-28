/**
 * Stage 7.5 第二階段：Claude C 的六段「展示技能」接到本地玩家（星芽原野）。
 * - 動作、特效、音效、命中都跟 C 的 SkillTimeline 同一個時鐘（命中標記、頓幀）。
 * - 傷害＝目前普通攻擊傷害 × C 的展示倍率（測試值；正式職業技能與數值尚未定案，不在這裡決定）。
 * - 攻速：受攻速影響的技能用 skillRate（攻速上限 160 → 最快 1.6 倍）。
 * - 技能位移（跳斬、蓄力衝刺）：用 C 動作檔的 rootMotion，經遊戲的地形碰撞（FieldTerrainQuery）移動。
 *   單機模式由這裡決定；多人模式必須改由伺服器驗證與同步（Claude D，見整合文件）。
 * 這個檔案不依賴 Babylon（特效、音效、動畫由 SkillHost 實作），可以單元測試。
 */
import { SKILLS, skillById, type FxKey, type HitSpec, type Palette, type SfxKey, type SkillDef, type SkillEvent } from "../combat-vfx/core/skills.ts";
import { SkillTimeline, type ClipTiming } from "../combat-vfx/core/timeline.ts";
import { DEMO_STATS, skillRate } from "../combat-vfx/core/damage.ts";

export interface SkillTarget {
  id: string;
  x: number;
  z: number;
  /** 身體半徑 */
  r: number;
  /** 身高（特效高度） */
  h: number;
  alive: boolean;
}

export interface SkillHost {
  now(): number;
  player(): { x: number; y: number; z: number; yaw: number; down: boolean };
  setYaw(yaw: number): void;
  /** 依地形碰撞移動（回傳實際移動距離） */
  move(dx: number, dz: number): number;
  targets(): readonly SkillTarget[];
  /** 套用傷害（遊戲的命中流程：命中特效、傷害數字、擊退、擊殺、經驗、掉落）；回傳是否真的打到 */
  damage(targetId: string, mult: number, crit: boolean, fx: readonly FxKey[]): boolean;
  attackSpeed(): number;
  playClip(name: string, rate: number): boolean;
  /** 動作跟著時間軸走（片段時間，秒）：頓幀時時間軸停住 → 動作一起停，命中那一格一定是命中姿勢 */
  clipTime(t: number): void;
  endClip(): void;
  fx(key: FxKey, x: number, y: number, z: number, opt: { yaw: number; scale?: number; duration?: number; palette?: Palette; follow?: boolean }): void;
  /** 武器拖尾開關（C 的 WeaponTrail；palette＝顏色） */
  trail(on: boolean, palette?: Palette): void;
  /** 發射投射物；回傳 handle（之後用 projPos／projSteer／projEnd 操作），沒有特效系統時回傳 null */
  launch(kind: "magicBolt" | "swordWave" | "meteor", x: number, y: number, z: number, dx: number, dz: number, speed: number, palette?: Palette): number | null;
  projPos(h: number): { x: number; y: number; z: number; travelled: number } | null;
  projSteer(h: number, x: number, y: number, z: number): void;
  projEnd(h: number, burst: boolean): void;
  sfx(key: SfxKey): void;
  shake(amount: number): void;
  equipWeapon(kind: "sword" | "staff"): void;
}

interface Proj {
  handle: number;
  hit: HitSpec;
  maxRange: number;
  pierce: boolean;
  homing: boolean;
  targetId: string | null;
  done: Set<string>;
  castId: number;
}

export type CastResult = { ok: true; skill: string; targetId: string | null; rate: number } | { ok: false; reason: "busy" | "cooldown" | "down" | "unknown" };

export class FieldSkills {
  readonly host: SkillHost;
  readonly clips: Record<string, ClipTiming>;
  active: { def: SkillDef; tl: SkillTimeline; targetId: string | null; yaw: number; lastForward: number; lastYaw: number; castId: number; trailEnd: number } | null = null;
  private readonly readyAt = new Map<string, number>();
  private readonly projectiles: Proj[] = [];
  private castSeq = 0;
  private rngState = 0x9e3779b9;
  /** 測試、報告用 */
  readonly stats = { hitstopMs: 0, casts: 0, hits: 0, damage: 0, projectiles: 0, moved: 0, events: 0, bySkill: {} as Record<string, number> };
  private readonly hitDone = new Set<string>();

  constructor(host: SkillHost, clips: Record<string, ClipTiming>) {
    this.host = host;
    this.clips = clips;
  }

  static list(): readonly SkillDef[] {
    return SKILLS;
  }

  cooldownLeft(id: string): number {
    return Math.max(0, (this.readyAt.get(id) ?? 0) - this.host.now());
  }

  get busy(): boolean {
    return this.active !== null;
  }

  cast(id: string): CastResult {
    const def = skillById(id);
    const clip = this.clips[def?.clip ?? ""];
    if (!def || !clip) return { ok: false, reason: "unknown" };
    if (this.active) return { ok: false, reason: "busy" };
    if (this.host.player().down) return { ok: false, reason: "down" };
    if (this.cooldownLeft(id) > 0) return { ok: false, reason: "cooldown" };
    const p = this.host.player();
    // 目標：施放距離內最近的存活怪物（沒有目標也可以施放，命中範圍內有怪物就會打到）
    let best: SkillTarget | null = null;
    let bd = Infinity;
    for (const t of this.host.targets()) {
      if (!t.alive) continue;
      const d = Math.hypot(t.x - p.x, t.z - p.z) - t.r;
      if (d <= def.range && d < bd) {
        bd = d;
        best = t;
      }
    }
    let yaw = p.yaw;
    if (best && def.faceTarget) {
      yaw = Math.atan2(best.x - p.x, best.z - p.z);
      this.host.setYaw(yaw);
    }
    this.host.equipWeapon(def.weapon);
    const rate = skillRate(def.aspdScaled, this.host.attackSpeed());
    this.host.playClip(def.clip, rate);
    const castId = ++this.castSeq;
    this.active = { def, tl: new SkillTimeline(def, clip, rate), targetId: best?.id ?? null, yaw, lastForward: 0, lastYaw: 0, castId, trailEnd: -1 };
    this.stats.casts++;
    this.stats.bySkill[id] = (this.stats.bySkill[id] ?? 0) + 1;
    return { ok: true, skill: id, targetId: best?.id ?? null, rate };
  }

  /** 中斷施放（倒地、換地圖）：已飛出去的投射物照常結算，冷卻照算 */
  cancel(): void {
    const a = this.active;
    if (!a) return;
    if (a.trailEnd >= 0) this.host.trail(false);
    this.host.endClip();
    this.readyAt.set(a.def.id, this.host.now() + a.def.cooldown);
    this.active = null;
  }

  update(dt: number): void {
    const a = this.active;
    if (a) {
      const fired = a.tl.advance(dt);
      this.host.clipTime(a.tl.t);
      // 技能位移（rootMotion：累積前進距離）→ 地形碰撞後移動
      const rm = a.tl.rootMotion();
      const df = rm.forward - a.lastForward;
      a.lastForward = rm.forward;
      if (Math.abs(df) > 1e-5) this.stats.moved += this.host.move(Math.sin(a.yaw) * df, Math.cos(a.yaw) * df);
      // 根運動轉向（旋風斬轉兩圈）：與 C 的展示頁相同，角色朝向＝起始朝向 − rootMotion 轉角
      if (rm.yaw !== a.lastYaw) {
        a.lastYaw = rm.yaw;
        this.host.setYaw(a.yaw - rm.yaw);
      }
      for (const f of fired) {
        if (f.event.kind === "trail") a.trailEnd = f.end ?? f.t;
        this.fire(f.event, a);
      }
      if (a.trailEnd >= 0 && a.tl.t >= a.trailEnd) {
        a.trailEnd = -1;
        this.host.trail(false);
      }
      if (a.tl.done) {
        if (a.trailEnd >= 0) this.host.trail(false);
        this.host.endClip();
        this.readyAt.set(a.def.id, this.host.now() + a.def.cooldown);
        this.active = null;
      }
    }
    this.updateProjectiles();
  }

  private rand(): number {
    // xorshift：可重現（測試用），不影響正式數值
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return this.rngState / 4294967296;
  }

  private anchor(kind: "self" | "target" | "weapon" | "front", a: NonNullable<FieldSkills["active"]>, forward = 0.5): { x: number; y: number; z: number } {
    const p = this.host.player();
    const fx = Math.sin(a.yaw);
    const fz = Math.cos(a.yaw);
    if (kind === "target" && a.targetId) {
      const t = this.host.targets().find((m) => m.id === a.targetId);
      if (t) return { x: t.x, y: p.y, z: t.z };
    }
    if (kind === "weapon") return { x: p.x + fx * 0.45, y: p.y + 1.0, z: p.z + fz * 0.45 };
    if (kind === "front" || kind === "target") return { x: p.x + fx * forward, y: p.y, z: p.z + fz * forward };
    return { x: p.x, y: p.y, z: p.z };
  }

  private fire(ev: SkillEvent, a: NonNullable<FieldSkills["active"]>): void {
    this.stats.events++;
    switch (ev.kind) {
      case "fx": {
        const at = this.anchor(ev.anchor, a, ev.forward);
        this.host.fx(ev.fx, at.x, at.y + (ev.anchor === "self" || ev.anchor === "front" ? 0.02 : 0), at.z, { yaw: a.yaw, scale: ev.scale, duration: ev.duration, palette: ev.palette ?? a.def.palette, follow: ev.anchor === "self" });
        break;
      }
      case "sfx":
        this.host.sfx(ev.sfx);
        break;
      case "shake":
        this.host.shake(ev.amount);
        break;
      case "hit":
        this.resolveHit(ev.hit, a);
        break;
      case "projectile": {
        const at = this.anchor(ev.from === "weapon" ? "weapon" : ev.from === "sky" ? "front" : "self", a, 1.5);
        const y = ev.from === "sky" ? at.y + 6 : ev.from === "weapon" ? at.y : at.y + 0.6;
        const h = this.host.launch(ev.fx, at.x, y, at.z, Math.sin(a.yaw), Math.cos(a.yaw), ev.speed, ev.palette ?? a.def.palette);
        if (h !== null) {
          this.projectiles.push({ handle: h, hit: ev.hit, maxRange: ev.maxRange, pierce: !!ev.pierce, homing: !!ev.homing, targetId: a.targetId, done: new Set(), castId: a.castId });
          this.stats.projectiles++;
        }
        break;
      }
      case "trail":
        this.host.trail(true, ev.palette ?? a.def.palette);
        break;
    }
  }

  private inShape(hit: HitSpec, a: NonNullable<FieldSkills["active"]>, t: SkillTarget, cx: number, cz: number): boolean {
    const dx = t.x - cx;
    const dz = t.z - cz;
    const d = Math.hypot(dx, dz) - t.r;
    if (hit.shape.type === "circle") return d <= hit.shape.radius;
    if (d > hit.shape.radius) return false;
    if (Math.hypot(dx, dz) < 1e-3) return true;
    let ang = Math.atan2(dx, dz) - a.yaw;
    while (ang > Math.PI) ang -= 2 * Math.PI;
    while (ang < -Math.PI) ang += 2 * Math.PI;
    return Math.abs(ang) <= (hit.shape.angleDeg * Math.PI) / 360 + Math.atan2(t.r, Math.max(0.1, Math.hypot(dx, dz)));
  }

  private resolveHit(hit: HitSpec, a: NonNullable<FieldSkills["active"]>): void {
    const p = this.host.player();
    let cx = p.x;
    let cz = p.z;
    if (hit.shape.type === "circle" && hit.shape.center === "target" && a.targetId) {
      const t = this.host.targets().find((m) => m.id === a.targetId);
      if (t) {
        cx = t.x;
        cz = t.z;
      }
    }
    let any = false;
    for (const t of this.host.targets()) {
      if (!t.alive) continue;
      if (hit.single && t.id !== a.targetId) continue;
      if (!this.inShape(hit, a, t, cx, cz)) continue;
      any = this.apply(hit, a.castId, t) || any;
    }
    if (any) {
      a.tl.hitstop(hit.hitstopMs);
      this.stats.hitstopMs += hit.hitstopMs;
      if (hit.shake > 0) this.host.shake(hit.shake);
    }
  }

  /** 同一次施放的同一段命中，對同一目標只結算一次 */
  private apply(hit: HitSpec, castId: number, t: SkillTarget): boolean {
    const key = `${castId}|${hit.id}|${t.id}`;
    if (this.hitDone.has(key)) return false;
    this.hitDone.add(key);
    if (this.hitDone.size > 4000) this.hitDone.clear();
    const crit = hit.forceCrit === true || this.rand() < DEMO_STATS.critRate;
    const ok = this.host.damage(t.id, hit.mult * (crit ? DEMO_STATS.critMult : 1), crit, crit ? [...hit.fx, "critBurst"] : hit.fx);
    if (ok) {
      this.host.sfx(crit ? "crit" : hit.sfx);
      this.stats.hits++;
    }
    return ok;
  }

  private updateProjectiles(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i]!;
      const pos = this.host.projPos(pr.handle);
      if (!pos) {
        this.projectiles.splice(i, 1);
        continue;
      }
      const targets = this.host.targets();
      if (pr.homing && pr.targetId) {
        const t = targets.find((m) => m.id === pr.targetId && m.alive);
        if (t) this.host.projSteer(pr.handle, t.x, pos.y, t.z);
      }
      let ended = false;
      const rad = pr.hit.shape.type === "circle" ? pr.hit.shape.radius : 1;
      for (const t of targets) {
        if (!t.alive || pr.done.has(t.id)) continue;
        if (Math.hypot(t.x - pos.x, t.z - pos.z) - t.r > Math.min(rad, 1.1)) continue;
        pr.done.add(t.id);
        this.apply(pr.hit, pr.castId, t);
        if (!pr.pierce) {
          ended = true;
          break;
        }
      }
      if (ended || pos.travelled >= pr.maxRange) {
        this.host.projEnd(pr.handle, ended);
        this.projectiles.splice(i, 1);
      }
    }
  }
}
