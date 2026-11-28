/**
 * 本地玩家技能（星芽原野，單人模式）：Claude C 的六段「展示技能」＋ C 的正式接入模組 CombatFx。
 *
 * 分工：
 * - 畫面與音效（特效、拖尾、投射物外觀、施放音效、震動）：C 的 CombatFx.playSkill，依動作檔時間標記播放。
 * - 遊戲判定（打到誰、傷害、暴擊、頓幀、技能位移、冷卻、投射物命中）：這裡。命中時間由 CombatFx 的 onHit／onProjectile 通知。
 * - 動作：角色動作時間＝同一個 SkillTimeline 的時間（clipTime），頓幀時動作、特效、後續事件一起停。
 * 一個時鐘：CombatFx 推進時間軸 → 這裡讀同一個時間軸，所以動作、命中、特效、音效不會錯開。
 *
 * - 傷害＝目前普通攻擊傷害 × C 的展示倍率（測試值；正式職業技能與數值尚未定案）。
 * - 攻速：受攻速影響的技能用 skillRate（攻速上限 160 → 最快 1.6 倍）。
 * - 技能位移：C 動作檔的 rootMotion，經遊戲的地形碰撞移動。多人模式不使用本檔（伺服器判定，Claude D）。
 * - 沒有 CombatFx（&fx=0、單元測試）時，自己推進時間軸，判定結果完全相同。
 * 這個檔案不依賴 Babylon，可以單元測試。
 */
import { SKILLS, skillById, type FxKey, type HitSpec, type SfxKey, type SkillDef, type SkillEvent } from "../combat-vfx/core/skills.ts";
import { SkillTimeline, type ClipTiming } from "../combat-vfx/core/timeline.ts";
import { DEMO_STATS, skillRate } from "../combat-vfx/core/damage.ts";

/** 地面衝擊類特效（與 C 的 CombatFx 相同分類）：放在地面衝擊點，打到多隻時只出現一次 */
const IMPACT_FX = new Set<FxKey>(["areaBlast", "shockwave", "dustRing", "starBurst"]);

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

type ProjectileEvent = Extract<SkillEvent, { kind: "projectile" }>;

/** 投射物外觀（C 的 Projectile；可能為 null＝被特效預算省略，判定照常） */
export interface ProjectileVisual {
  readonly alive: boolean;
  steer(target: { x: number; y: number; z: number }, k: number): void;
  dispose(burst: boolean): void;
}

/** C 的 CombatFx.playSkill 回傳的控制把手 */
export interface SkillFxDriver {
  readonly timeline: SkillTimeline;
  hitstop(ms: number): void;
  cancel(): void;
  readonly done: boolean;
}

export interface SkillFxHooks {
  onHit(hit: HitSpec, clipT: number): void;
  onProjectile(ev: ProjectileEvent, visual: ProjectileVisual | null, clipT: number): void;
  onEnd(): void;
}

export interface SkillHost {
  now(): number;
  player(): { x: number; y: number; z: number; yaw: number; down: boolean };
  setYaw(yaw: number): void;
  /** 依地形碰撞移動（回傳實際移動距離） */
  move(dx: number, dz: number): number;
  targets(): readonly SkillTarget[];
  /** 套用傷害（遊戲的命中流程：命中特效、音效、傷害數字、擊退、擊殺、經驗、掉落）；回傳是否真的打到 */
  damage(targetId: string, mult: number, crit: boolean, hit: { fx: readonly FxKey[]; sfx?: SfxKey; shake: number; ground?: { x: number; z: number } }): boolean;
  attackSpeed(): number;
  playClip(name: string, duration: number): boolean;
  /** 動作跟著時間軸走（片段時間，秒） */
  clipTime(t: number): void;
  endClip(): void;
  equipWeapon(kind: "sword" | "staff"): void;
  /** 開始播 C 的技能畫面（CombatFx.playSkill）；回傳 null＝沒有特效系統 → FieldSkills 自己推進時間軸 */
  startFx(def: SkillDef, clip: ClipTiming, rate: number, hooks: SkillFxHooks): SkillFxDriver | null;
  /** 投射物判定的起點（法杖頭等；沒有就用身前 0.6 m、高 0.55 m，與 C 相同） */
  focus?(): { x: number; y: number; z: number } | null;
}

interface Proj {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  speed: number;
  travelled: number;
  visual: ProjectileVisual | null;
  hit: HitSpec;
  maxRange: number;
  pierce: boolean;
  homing: boolean;
  targetId: string | null;
  done: Set<string>;
  castId: number;
}

export type CastResult = { ok: true; skill: string; targetId: string | null; rate: number } | { ok: false; reason: "busy" | "cooldown" | "down" | "unknown" };

interface Active {
  def: SkillDef;
  tl: SkillTimeline;
  drv: SkillFxDriver | null;
  targetId: string | null;
  yaw: number;
  lastForward: number;
  lastYaw: number;
  castId: number;
  ended: boolean;
}

export class FieldSkills {
  readonly host: SkillHost;
  readonly clips: Record<string, ClipTiming>;
  active: Active | null = null;
  private readonly readyAt = new Map<string, number>();
  private readonly projectiles: Proj[] = [];
  private castSeq = 0;
  private rngState = 0x9e3779b9;
  /** 測試、報告用 */
  readonly stats = { hitstopMs: 0, casts: 0, hits: 0, projectiles: 0, projectileVisuals: 0, moved: 0, hitEvents: 0, bySkill: {} as Record<string, number>, viaCombatFx: 0 };
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
    this.host.playClip(def.clip, clip.duration);
    const castId = ++this.castSeq;
    const a: Active = { def, tl: null as unknown as SkillTimeline, drv: null, targetId: best?.id ?? null, yaw, lastForward: 0, lastYaw: 0, castId, ended: false };
    this.active = a;
    const hooks: SkillFxHooks = {
      onHit: (hit) => {
        if (this.active === a) this.resolveHit(hit, a);
      },
      onProjectile: (ev, vis) => this.spawnProjectile(ev, vis, a),
      onEnd: () => {
        a.ended = true;
      },
    };
    const drv = this.host.startFx(def, clip, rate, hooks);
    if (drv) {
      a.drv = drv;
      a.tl = drv.timeline;
      this.stats.viaCombatFx++;
    } else {
      a.tl = new SkillTimeline(def, clip, rate);
      // 沒有特效系統：自己推進時間軸，命中／投射物照同一套規則
      (a as Active & { fallback: SkillFxHooks }).fallback = hooks;
    }
    this.stats.casts++;
    this.stats.bySkill[id] = (this.stats.bySkill[id] ?? 0) + 1;
    return { ok: true, skill: id, targetId: best?.id ?? null, rate };
  }

  /** 中斷施放（倒地、換地圖）：已飛出去的投射物照常結算，冷卻照算 */
  cancel(): void {
    const a = this.active;
    if (!a) return;
    a.drv?.cancel();
    this.host.endClip();
    this.readyAt.set(a.def.id, this.host.now() + a.def.cooldown);
    this.active = null;
  }

  /**
   * 每格（在 CombatFx.update 之後呼叫：CombatFx 已推進時間軸並送出命中／投射物事件）。
   */
  update(dt: number): void {
    const a = this.active;
    if (a) {
      const fb = (a as Active & { fallback?: SkillFxHooks }).fallback;
      if (fb) {
        for (const f of a.tl.advance(dt)) {
          if (f.event.kind === "hit") fb.onHit(f.event.hit, f.t);
          else if (f.event.kind === "projectile") fb.onProjectile(f.event, null, f.t);
        }
        if (a.tl.done) a.ended = true;
      }
      this.host.clipTime(a.tl.t);
      // 技能位移（rootMotion：累積前進距離）→ 地形碰撞後移動
      const rm = a.tl.rootMotion();
      const df = rm.forward - a.lastForward;
      a.lastForward = rm.forward;
      if (Math.abs(df) > 1e-5) this.stats.moved += this.host.move(Math.sin(a.yaw) * df, Math.cos(a.yaw) * df);
      // 根運動轉向（旋風斬轉兩圈）：角色朝向＝起始朝向 − rootMotion 轉角（與 C 的展示頁相同）
      if (rm.yaw !== a.lastYaw) {
        a.lastYaw = rm.yaw;
        this.host.setYaw(a.yaw - rm.yaw);
      }
      if (a.ended || a.tl.done || (a.drv?.done ?? false)) {
        this.host.endClip();
        this.readyAt.set(a.def.id, this.host.now() + a.def.cooldown);
        this.active = null;
      }
    }
    this.updateProjectiles(dt);
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

  private inShape(hit: HitSpec, a: Active, t: SkillTarget, cx: number, cz: number): boolean {
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

  private resolveHit(hit: HitSpec, a: Active): void {
    this.stats.hitEvents++;
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
    const area = hit.shape.type === "circle" ? { x: cx, z: cz } : undefined;
    for (const t of this.host.targets()) {
      if (!t.alive) continue;
      if (hit.single && t.id !== a.targetId) continue;
      if (!this.inShape(hit, a, t, cx, cz)) continue;
      any = this.apply(hit, a.castId, t, !any, area) || any;
    }
    if (any) {
      // 頓幀：同一個時間軸停住 → 動作、特效、後續事件一起延後
      a.tl.hitstop(hit.hitstopMs);
      this.stats.hitstopMs += hit.hitstopMs;
    }
  }

  /** 同一次施放的同一段命中，對同一目標只結算一次 */
  private apply(hit: HitSpec, castId: number, t: SkillTarget, first = true, area?: { x: number; z: number }): boolean {
    const key = `${castId}|${hit.id}|${t.id}`;
    if (this.hitDone.has(key)) return false;
    this.hitDone.add(key);
    if (this.hitDone.size > 4000) this.hitDone.clear();
    const crit = hit.forceCrit === true || this.rand() < DEMO_STATS.critRate;
    // 範圍技能打到多隻：地面衝擊特效、音效、震動只出現一次（第一隻）；其他隻只畫身上的命中火花與數字
    const fx = first ? hit.fx : hit.fx.filter((k) => !IMPACT_FX.has(k));
    const ok = this.host.damage(t.id, hit.mult * (crit ? DEMO_STATS.critMult : 1), crit, { fx, sfx: first ? hit.sfx : undefined, shake: first ? hit.shake : 0, ground: first ? area : undefined });
    if (ok) this.stats.hits++;
    return ok;
  }

  private spawnProjectile(ev: ProjectileEvent, vis: ProjectileVisual | null, a: Active): void {
    const p = this.host.player();
    const fx = Math.sin(a.yaw);
    const fz = Math.cos(a.yaw);
    const tgt = a.targetId ? this.host.targets().find((m) => m.id === a.targetId && m.alive) : undefined;
    let from: { x: number; y: number; z: number };
    let dir: { x: number; y: number; z: number };
    if (ev.from === "sky") {
      // 判定只看水平位置：落點＝目標（沒有目標＝身前 6 m），從高處直落
      const dx = tgt ? tgt.x : p.x + fx * 6;
      const dz = tgt ? tgt.z : p.z + fz * 6;
      from = { x: dx, y: p.y + 9, z: dz };
      dir = { x: 0, y: -1, z: 0 };
    } else {
      const f = ev.from === "weapon" ? this.host.focus?.() : null;
      from = f ?? { x: p.x + fx * 0.6, y: p.y + 0.55, z: p.z + fz * 0.6 };
      if (ev.fx === "swordWave" || !tgt) dir = { x: fx, y: 0, z: fz };
      else {
        const l = Math.hypot(tgt.x - from.x, tgt.z - from.z) || 1;
        dir = { x: (tgt.x - from.x) / l, y: 0, z: (tgt.z - from.z) / l };
      }
    }
    this.projectiles.push({ ...from, dx: dir.x, dy: dir.y, dz: dir.z, speed: ev.speed, travelled: 0, visual: vis, hit: ev.hit, maxRange: ev.from === "sky" ? 9.5 : ev.maxRange, pierce: !!ev.pierce, homing: !!ev.homing, targetId: a.targetId, done: new Set(), castId: a.castId });
    this.stats.projectiles++;
    if (vis) this.stats.projectileVisuals++;
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i]!;
      const targets = this.host.targets();
      if (pr.homing && pr.targetId) {
        const t = targets.find((m) => m.id === pr.targetId && m.alive);
        if (t) {
          const l = Math.hypot(t.x - pr.x, t.z - pr.z) || 1;
          const k = Math.min(1, dt * 10.8);
          pr.dx += ((t.x - pr.x) / l - pr.dx) * k;
          pr.dz += ((t.z - pr.z) / l - pr.dz) * k;
          const n = Math.hypot(pr.dx, pr.dz) || 1;
          pr.dx /= n;
          pr.dz /= n;
          if (pr.visual?.alive) pr.visual.steer({ x: t.x, y: pr.y, z: t.z }, 0.18);
        }
      }
      const step = pr.speed * dt;
      pr.x += pr.dx * step;
      pr.y += pr.dy * step;
      pr.z += pr.dz * step;
      pr.travelled += step;
      const sky = pr.dy < -0.5;
      let ended = false;
      const rad = pr.hit.shape.type === "circle" ? pr.hit.shape.radius : 1;
      if (sky) {
        // 流星：落地時範圍判定一次
        if (pr.travelled >= pr.maxRange - 0.5) {
          let first = true;
          for (const t of targets) {
            if (!t.alive || pr.done.has(t.id)) continue;
            if (Math.hypot(t.x - pr.x, t.z - pr.z) - t.r > rad) continue;
            pr.done.add(t.id);
            if (this.apply(pr.hit, pr.castId, t, first, { x: pr.x, z: pr.z })) first = false;
          }
          ended = true;
        }
      } else {
        for (const t of targets) {
          if (!t.alive || pr.done.has(t.id)) continue;
          if (Math.hypot(t.x - pr.x, t.z - pr.z) - t.r > Math.min(rad, 1.1)) continue;
          pr.done.add(t.id);
          this.apply(pr.hit, pr.castId, t);
          if (!pr.pierce) {
            ended = true;
            break;
          }
        }
      }
      if (ended || pr.travelled >= pr.maxRange) {
        if (pr.visual?.alive) pr.visual.dispose(ended);
        this.projectiles.splice(i, 1);
      }
    }
  }
}
