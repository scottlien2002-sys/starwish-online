/**
 * Combat VFX 正式接入模組（給 Claude A 的遊戲世界、Claude D 的多人連線）
 *
 * 一個 CombatFx 實例＝一張地圖的戰鬥畫面與音效：特效、武器拖尾、投射物、命中、暴擊、傷害數字、
 * 怪物受傷／死亡／重生、畫面閃光、鏡頭震動、戰鬥音效。
 *
 * ⚠️ 只負責「畫面與聲音」，不做任何遊戲判定：
 *   - 不扣血、不判斷命中、不決定暴擊（由 A 的戰鬥規則或 D 的伺服器結果傳進來）
 *   - 不送網路封包（D 決定何時呼叫）
 *   - 技能名稱、數值、正式技能配置一律未定案（core/classKits.ts 的樣板只是草稿）
 *
 * 基本用法：
 *   const fx = new CombatFx({ scene, camera, hudRoot, tier: "medium" });
 *   await fx.prewarm();                         // 載入畫面期間呼叫（≈5 格），之後第一次施放不卡
 *   fx.register({ id, owner: "self", root, position, yaw, weaponBase, weaponTip });
 *   fx.playSkill(id, skillDef, clipTiming, rate, { onHit: (hit) => … });   // 依動作檔時間播放特效／音效／拖尾
 *   fx.hit(point, ["hitFlash","hitSpark"], { owner: "self", damage: 128, crit: true });
 *   fx.monsterDeath(pos); fx.monsterRespawn(pos);
 *   每格：const camOffset = fx.update(dt);       // 回傳鏡頭震動位移（自己決定要不要加到鏡頭目標）
 *   離開地圖：fx.dispose();
 */
import { groundHeight, GROUND_LIFT } from "../core/ground.ts";
import { Frustum, Vector3, Viewport, type Camera, type Mesh, type Plane, type Scene, type TransformNode } from "@babylonjs/core";
import type { FxKey, HitSpec, Palette, SfxKey, SkillDef, SkillEvent } from "../core/skills.ts";
import { SkillTimeline, type ClipTiming } from "../core/timeline.ts";
import { VFX_QUALITY, type VfxTier } from "../core/quality.ts";
import type { VfxOwner } from "../core/budget.ts";
import { FX_KEY_LIST } from "../core/classKits.ts";
import { VfxSystem, type Projectile, type SpawnOptions, type VfxEnvironment } from "../fx/VfxSystem.ts";
import { WeaponTrail } from "../fx/WeaponTrail.ts";
import { DamageNumbers, type DamageStyle } from "../fx/DamageNumbers.ts";
import { ScreenFx } from "../fx/ScreenFx.ts";
import { CameraFx } from "../fx/CameraFx.ts";
import { CombatAudio } from "../fx/CombatAudio.ts";
import { PALETTES } from "../fx/palette.ts";

export interface CombatFxConfig {
  scene: Scene;
  /** 主鏡頭（不可視特效判定、音效左右聲道、預熱） */
  camera: Camera;
  /** 傷害數字、畫面閃光的 DOM 容器（通常是 #hud-root） */
  hudRoot: HTMLElement;
  tier: VfxTier;
  env?: VfxEnvironment;
  /** false＝不建立音效（伺服器端、測試） */
  audio?: boolean;
  /** 其他玩家特效簡化（預設 true；false＝Stage 1 做法，只用於效能比較） */
  remoteSimplify?: boolean;
  /**
   * 地面高度（A 在 Stage 7.5 整合時提出；預設 0＝原本行為）。
   * 地面特效（衝擊波、塵環、地裂、碎石、光柱、蓄力環）、範圍提示、怪物死亡／重生、流星落點都放在地形表面。
   * 斜坡：取中心與周圍 4 點的最高處，平面特效不會埋進上坡那一側（下坡那一側稍微浮起）。
   */
  ground?: (x: number, z: number) => number;
}

/** 一個會施放技能的角色（自己、隊友、其他玩家）。只讀取位置，不改動角色。 */
export interface FxActor {
  id: string;
  owner: VfxOwner;
  /** 跟隨型特效（魔法陣、旋風、光環）掛在這裡 */
  root: TransformNode;
  position(): Vector3;
  /** Babylon 世界的 rotation.y */
  yaw(): number;
  /** 武器拖尾：劍根與劍尖節點（沒有就不畫拖尾） */
  weaponBase?: TransformNode;
  weaponTip?: TransformNode;
  /** 武器上的粒子發射點（法杖頭等） */
  weaponFocus?: Mesh;
  /** 目前鎖定目標的命中點（沒有目標回傳 null） */
  target?(): Vector3 | null;
}

export interface SkillHooks {
  /** 動作檔的命中時間到了（由遊戲決定打到誰、扣多少；之後呼叫 fx.hit 畫命中） */
  onHit?(hit: HitSpec, clipT: number): void;
  /** 投射物發射（visual 可能為 null＝被特效預算省略；判定照常） */
  onProjectile?(ev: Extract<SkillEvent, { kind: "projectile" }>, visual: Projectile | null, clipT: number): void;
  /** 技能播完 */
  onEnd?(): void;
}

export interface SkillFxHandle {
  readonly timeline: SkillTimeline;
  /** 打擊頓幀（毫秒）：時鐘停住，動作與後續事件一起延後 */
  hitstop(ms: number): void;
  cancel(): void;
  readonly done: boolean;
}

interface ActorState {
  actor: FxActor;
  trail: WeaponTrail | null;
  trailEnd: number;
}

interface Playing {
  essential: boolean;
  actorId: string;
  skill: SkillDef;
  tl: SkillTimeline;
  hooks: SkillHooks;
  cancelled: boolean;
}

export interface PrewarmReport {
  ms: number;
  spawned: number;
  /** 預熱後仍在畫面上的特效／投射物（應為 0） */
  leftoverActive: number;
  leftoverProjectiles: number;
  /** 預熱期間播出的音效（應為 0） */
  audioPlayed: number;
  /** 預熱期間顯示的傷害數字（應為 0） */
  damageShown: number;
  tier: VfxTier;
  /** 預熱建立的共用材質、物件池網格、粒子系統數（低畫質應比高畫質少） */
  materials: number;
  pooledMeshes: number;
  particleSystems: number;
}

/** 由根到這個節點依序強制更新世界矩陣（動作剛被設定時，拖尾才拿得到這一格的位置） */
function syncWorld(n: TransformNode): void {
  const chain: TransformNode[] = [];
  for (let p: TransformNode | null = n; p; p = (p.parent as TransformNode | null) ?? null) chain.push(p);
  for (let i = chain.length - 1; i >= 0; i--) chain[i]!.computeWorldMatrix(true);
}

const FOLLOW_FX = new Set<FxKey>(["magicCircle", "whirlRing", "chargeAura", "groundGlow", "lightShield", "healAura", "buffOrbit"]);
/** 地面特效的大約半徑（公尺，scale 1）：斜坡上取地面高度用 */
const GROUND_RADIUS = 1.2;
const GROUND_FX = new Set<FxKey>(["shockwave", "dustRing", "groundCrack", "debris", "lightPillar", "chargeRings"]);
const IMPACT_FX = new Set<FxKey>(["areaBlast", "shockwave", "dustRing", "starBurst"]);

export class CombatFx {
  readonly scene: Scene;
  readonly camera: Camera;
  readonly vfx: VfxSystem;
  readonly damage: DamageNumbers;
  readonly screen: ScreenFx;
  readonly shake: CameraFx;
  readonly audio: CombatAudio | null;
  tier: VfxTier;
  /** 本地玩家位置（特效距離預算、其他玩家音效左右聲道）；預設跟隨鏡頭目標 */
  readonly listener = new Vector3();
  /** 其他玩家的特效：超過這個距離、或不在畫面內（含邊界 margin）就不生成（命中閃光等 critical 也一樣略過，因為看不到） */
  remoteCullDistance = 28;
  remoteFrustumMargin = 2.5;
  private readonly actors = new Map<string, ActorState>();
  private readonly playing: Playing[] = [];
  private readonly deferred: { p: Playing; actorId: string; ev: SkillEvent; t: number; end?: number }[] = [];
  private readonly frustum: Plane[] = [];
  private frustumFrame = -1;
  private disposed = false;
  /** 統計：因距離或不在畫面內而略過的其他玩家特效 */
  readonly culled = { distance: 0, offscreen: 0 };
  private groundFn: (x: number, z: number) => number = () => 0;
  private hasGround = false;
  /** 統計：重要戰鬥特效（不省略）的次數 */
  private essentialCount = 0;

  constructor(cfg: CombatFxConfig) {
    this.scene = cfg.scene;
    this.camera = cfg.camera;
    this.tier = cfg.tier;
    this.vfx = new VfxSystem(cfg.scene, cfg.tier);
    this.vfx.remoteSimplify = cfg.remoteSimplify ?? true;
    this.vfx.setEnvironment(cfg.env ?? "dark");
    this.damage = new DamageNumbers(cfg.scene, cfg.hudRoot, VFX_QUALITY[cfg.tier].damageNumbers);
    this.screen = new ScreenFx(cfg.hudRoot);
    this.shake = new CameraFx();
    this.shake.scale = VFX_QUALITY[cfg.tier].shake;
    this.audio = cfg.audio === false ? null : new CombatAudio();
    this.audio?.setEnvironment(cfg.env ?? "dark");
    this.vfx.onCrit = () => this.screen.flashCrit();
    if (cfg.ground) this.setGround(cfg.ground);
  }

  // ------------------------------------------------------------------ 設定

  /** 換地圖或地形時更新地面高度函式（不給＝平地 y＝0） */
  setGround(fn: ((x: number, z: number) => number) | null): void {
    this.groundFn = fn ?? (() => 0);
    this.hasGround = !!fn;
  }

  /**
   * 地面點：中心高度，斜坡時取中心與半徑 r×0.7 四個方向的最高處（平面特效不埋進上坡），再抬高 2 cm 避免與地面閃爍。
   * 沒有設定地面時一律 y＝0（與原本行為相同）。函式回傳非數字時當作 0。
   */
  groundPoint(x: number, z: number, r = 0): Vector3 {
    return new Vector3(x, this.hasGround ? groundHeight(this.groundFn, x, z, r) + GROUND_LIFT : 0, z);
  }


  setQuality(tier: VfxTier): void {
    this.tier = tier;
    this.vfx.clear();
    this.vfx.setTier(tier);
    this.damage.setMax(VFX_QUALITY[tier].damageNumbers);
    this.shake.scale = VFX_QUALITY[tier].shake;
    for (const st of this.actors.values()) this.rebuildTrail(st);
  }

  setEnvironment(env: VfxEnvironment): void {
    this.vfx.setEnvironment(env);
    this.audio?.setEnvironment(env);
    for (const st of this.actors.values()) st.trail?.setBright(env === "bright");
  }

  /** 使用者第一次點擊畫面時呼叫（iPhone 規定） */
  unlockAudio(): void {
    this.audio?.unlock();
  }

  // ------------------------------------------------------------------ 角色

  register(actor: FxActor): void {
    this.unregister(actor.id);
    const st: ActorState = { actor, trail: null, trailEnd: -1 };
    this.rebuildTrail(st);
    this.actors.set(actor.id, st);
  }

  unregister(id: string): void {
    const st = this.actors.get(id);
    if (!st) return;
    st.trail?.dispose();
    this.actors.delete(id);
    for (const p of this.playing) if (p.actorId === id) p.cancelled = true;
  }

  private rebuildTrail(st: ActorState): void {
    st.trail?.dispose();
    st.trail = null;
    const a = st.actor;
    if (!a.weaponBase || !a.weaponTip) return;
    const q = VFX_QUALITY[this.tier];
    const self = a.owner === "self";
    st.trail = new WeaponTrail(this.scene, a.weaponBase, a.weaponTip, self ? q.trailSegments : Math.max(6, q.trailSegments >> 1), q.trailLife, null, !self && this.vfx.remoteSimplify);
  }

  // ------------------------------------------------------------------ 技能（依動作檔時間播放畫面與音效）

  /**
   * clip：動作檔片段（novice_combat_<g>.json 的 clips[skill.clip]：duration、marks）。
   * rate：攻速播放倍率（core/attackSpeed.ts，上限 1.6）。命中、投射物交給 hooks，由遊戲判定。
   */
  /**
   * essential：整個技能都是重要戰鬥特效（例如敵方 Boss 技能），不因距離或畫面外省略。
   * 另外：投射物或「目標處」特效如果落在本地玩家附近（1.5 m 內），自動視為重要特效。
   */
  playSkill(actorId: string, skill: SkillDef, clip: ClipTiming, rate = 1, hooks: SkillHooks = {}, o: { essential?: boolean } = {}): SkillFxHandle | null {
    const st = this.actors.get(actorId);
    if (!st) return null;
    for (const p of this.playing) if (p.actorId === actorId) p.cancelled = true;
    const tl = new SkillTimeline(skill, clip, rate);
    const p: Playing = { actorId, skill, tl, hooks, cancelled: false, essential: !!o.essential };
    this.playing.push(p);
    return {
      timeline: tl,
      hitstop: (ms) => tl.hitstop(ms),
      cancel: () => {
        p.cancelled = true;
      },
      get done() {
        return tl.done || p.cancelled;
      },
    };
  }

  /** 普通攻擊（沒有技能定義時）：拖尾 seconds 秒＋揮擊音效 */
  basicSwing(actorId: string, palette: Palette = "steel", seconds = 0.22, sfx: SfxKey = "swish"): void {
    const st = this.actors.get(actorId);
    if (!st) return;
    if (st.trail) {
      st.trail.setColor(PALETTES[palette].main);
      st.trail.start();
      st.trailEnd = this.now + seconds;
    }
    this.sound(sfx, st.actor);
  }

  private now = 0;

  private anchor(a: FxActor, ev: { anchor: string; forward?: number }): Vector3 {
    const y = a.yaw();
    const f = new Vector3(Math.sin(y), 0, Math.cos(y));
    const pos = a.position();
    switch (ev.anchor) {
      case "target":
        return a.target?.()?.clone() ?? pos.add(f.scale(4));
      case "weapon":
        return a.weaponFocus ? a.weaponFocus.getAbsolutePosition().clone() : pos.add(f.scale(0.5)).addInPlaceFromFloats(0, 1, 0);
      case "front":
        return pos.add(f.scale(ev.forward ?? 0.6)).addInPlaceFromFloats(0, 0.55, 0);
      default:
        return pos.clone();
    }
  }

  private runEvent(p: Playing, st: ActorState, ev: SkillEvent, t: number, end?: number): void {
    const a = st.actor;
    const pal = ("palette" in ev && ev.palette) || p.skill.palette;
    switch (ev.kind) {
      case "trail":
        if (st.trail) {
          st.trail.setColor(PALETTES[pal].main);
          st.trail.start();
          st.trailEnd = this.now + Math.max(0.05, ((end ?? t + 0.2) - t) / p.tl.rate);
        }
        break;
      case "fx": {
        const at = this.anchor(a, ev);
        if (GROUND_FX.has(ev.fx)) at.y = this.groundPoint(at.x, at.z, GROUND_RADIUS * (ev.scale ?? 1)).y;
        const follow = ev.anchor === "self" && FOLLOW_FX.has(ev.fx) ? a.root : undefined;
        const nearMe = ev.anchor === "target" && Math.hypot(at.x - this.listener.x, at.z - this.listener.z) < 1.5;
        this.spawnFor(a.owner, ev.fx, at, { palette: pal, yaw: a.yaw(), scale: ev.scale, duration: ev.duration, follow, emitterMesh: ev.anchor === "weapon" ? a.weaponFocus : undefined, essential: a.owner !== "self" && (p.essential || nearMe) });
        break;
      }
      case "sfx":
        this.sound(ev.sfx, a);
        break;
      case "shake":
        if (a.owner === "self") this.shake.shake(ev.amount);
        break;
      case "hit":
        p.hooks.onHit?.(ev.hit, t);
        break;
      case "projectile": {
        const y = a.yaw();
        const f = new Vector3(Math.sin(y), 0, Math.cos(y));
        const tgt = a.target?.() ?? null;
        let from: Vector3;
        let dir: Vector3;
        if (ev.from === "sky") {
          const d0 = tgt ?? a.position().add(f.scale(6));
          const dest = this.groundPoint(d0.x, d0.z);
          from = dest.add(new Vector3(-2.2, 9, -1.5));
          dir = dest.subtract(from);
        } else {
          from = ev.from === "weapon" && a.weaponFocus ? a.weaponFocus.getAbsolutePosition().clone() : a.position().add(f.scale(0.6)).addInPlaceFromFloats(0, 0.55, 0);
          dir = ev.fx === "swordWave" || !tgt ? f.clone() : tgt.subtract(from);
        }
        // 飛向本地玩家的投射物一定要看得到
        const towardMe = a.owner !== "self" && (p.essential || (!!tgt && Vector3.Distance(new Vector3(tgt.x, 0, tgt.z), new Vector3(this.listener.x, 0, this.listener.z)) < 1.5));
        if (towardMe) this.essentialCount++;
        const vis = !towardMe && this.cullRemote(a.owner, from) ? null : this.vfx.launch(ev.fx, from, dir, ev.speed, { owner: a.owner, palette: pal, distance: Vector3.Distance(from, this.listener), essential: towardMe });
        p.hooks.onProjectile?.(ev, vis, t);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ 直接呼叫（命中、怪物、玩家受傷）

  /** 任意特效（技能施放、職業展示）。其他玩家的特效會依距離、畫面外自動略過 */
  spawn(owner: VfxOwner, key: FxKey, at: Vector3, opt: Omit<SpawnOptions, "owner" | "distance"> = {}): void {
    this.spawnFor(owner, key, at, opt);
  }

  /** essential：會影響本地玩家（例如飛向自己的投射物）→ 不因距離或畫面外而省略 */
  launch(owner: VfxOwner, kind: "magicBolt" | "swordWave" | "meteor", from: Vector3, dir: Vector3, speed: number, palette: Palette = "azure", essential = false): Projectile | null {
    if (!essential && this.cullRemote(owner, from)) return null;
    if (essential) this.essentialCount++;
    return this.vfx.launch(kind, from, dir, speed, { owner, palette, distance: Vector3.Distance(from, this.listener), essential });
  }

  /**
   * 範圍提示（重要戰鬥特效）：Boss 範圍攻擊預警、敵方危險技能範圍、治療範圍。
   * 本地玩家在範圍內（或範圍邊緣 margin 內）時一定顯示，不因施放者距離過遠、不在畫面內、其他玩家份額而省略。
   * 本地玩家不在範圍內時，依一般規則（遠、畫面外會略過）。只用現有特效美術：預警／危險＝大魔法陣（玫瑰色）、治療＝治療光環（金色）。
   */
  zone(kind: "bossWarning" | "danger" | "heal", center: Vector3, radius: number, o: { owner?: VfxOwner; duration?: number; margin?: number } = {}): boolean {
    const owner = o.owner ?? "other";
    const g = this.groundPoint(center.x, center.z, radius);
    const flat = Math.hypot(this.listener.x - g.x, this.listener.z - g.z);
    const affects = flat <= radius + (o.margin ?? 3);
    const essential = affects || kind === "bossWarning";
    if (!essential && this.cullRemote(owner, g)) return false;
    if (essential) this.essentialCount++;
    const scale = radius / 3;
    const dur = o.duration ?? 1.2;
    if (kind === "heal") this.vfx.spawn("healAura", g, { owner, palette: "gold", scale, duration: dur, essential, distance: flat });
    else {
      this.vfx.spawn("magicCircleBig", g, { owner, palette: "rose", scale, duration: dur, essential, distance: flat });
      if (kind === "bossWarning") this.vfx.spawn("groundGlow", g, { owner, palette: "rose", scale, duration: dur, essential, distance: flat });
    }
    return true;
  }

  /** 必要的戰鬥狀態提示（例：自己被標記、護盾）：跟隨角色，一律顯示 */
  statusCue(kind: "shield" | "buff" | "heal", follow: TransformNode, o: { owner?: VfxOwner; duration?: number; palette?: Palette } = {}): void {
    const fx: FxKey = kind === "shield" ? "lightShield" : kind === "heal" ? "healAura" : "buffOrbit";
    this.essentialCount++;
    this.vfx.spawn(fx, follow.getAbsolutePosition(), { owner: o.owner ?? "self", palette: o.palette ?? "gold", duration: o.duration ?? 2, follow, essential: true });
  }

  /** 畫面閃光（暴擊、受傷）：可調整強度或關閉 */
  setScreenFlash(enabled: boolean, intensity = 1): void {
    this.screen.enabled = enabled;
    this.screen.intensity = Math.max(0, Math.min(1, intensity));
  }

  /** 鏡頭震動：可調整倍率或關閉（暈眩敏感的玩家） */
  setCameraShake(enabled: boolean, scale = VFX_QUALITY[this.tier].shake): void {
    this.shake.enabled = enabled;
    this.shake.scale = Math.max(0, scale);
  }

  /**
   * 命中畫面：特效＋傷害數字＋暴擊閃光＋音效＋鏡頭震動（自己）。數值由遊戲／伺服器提供。
   * ground：範圍技能的地面衝擊點（areaBlast、shockwave、dustRing、starBurst 會放在這裡）
   */
  hit(
    at: Vector3,
    keys: readonly FxKey[],
    o: { owner: VfxOwner; damage?: number | string; crit?: boolean; palette?: Palette; shake?: number; sfx?: SfxKey; ground?: Vector3; style?: DamageStyle; actorId?: string; essential?: boolean } = { owner: "self" },
  ): void {
    const ess = !!o.essential;
    const opt = { owner: o.owner, palette: o.palette ?? "steel", distance: Vector3.Distance(at, this.listener), essential: ess };
    if (ess) this.essentialCount++;
    if (o.ground) {
      const g = keys.filter((k) => IMPACT_FX.has(k));
      if (g.length && (ess || !this.cullRemote(o.owner, o.ground))) this.vfx.hitFx(o.ground, g, false, opt);
      keys = keys.filter((k) => !IMPACT_FX.has(k));
    }
    if (ess || !this.cullRemote(o.owner, at)) this.vfx.hitFx(at, keys, o.owner === "self" && !!o.crit, opt);
    // 傷害數字：自己打出的、或打在自己身上的才顯示（其他玩家的數字不顯示，避免畫面被數字淹沒）
    if (o.damage !== undefined && (o.owner === "self" || o.style === "player")) this.damage.show(at.add(new Vector3(0, 0.35, 0)), o.damage, o.style ?? (o.crit ? "crit" : "normal"));
    if (o.owner === "self") {
      if (o.sfx || o.crit) {
        this.audio?.play(o.crit ? "crit" : o.sfx!);
        if (o.crit && o.sfx) this.audio?.play(o.sfx, 0.8);
      }
      if (o.shake) this.shake.shake(o.shake * (o.crit ? 1.35 : 1));
    } else if (o.sfx) {
      const a = o.actorId ? this.actors.get(o.actorId)?.actor : undefined;
      this.audio?.play(o.sfx, 0.35, a ? this.panOf(a.position()) : this.panOf(at));
    }
  }

  /** 怪物受傷（沒有傷害數字的輕微受擊，例如其他玩家打的） */
  monsterHurt(at: Vector3, owner: VfxOwner = "other", palette: Palette = "steel"): void {
    if (!this.cullRemote(owner, at)) this.vfx.spawn("hitFlash", at, { owner, palette, scale: 0.7, distance: Vector3.Distance(at, this.listener) });
  }

  /** 怪物死亡：地面塵環＋星光碎片（死亡動作、淡出由怪物模組自己播） */
  monsterDeath(groundAt: Vector3, scale = 1): void {
    const at = this.groundPoint(groundAt.x, groundAt.z, 0.8 * scale);
    const d = Vector3.Distance(at, this.listener);
    if (d > this.remoteCullDistance || this.offscreen(at)) return;
    this.vfx.spawn("dustRing", at, { owner: "self", palette: "steel", scale: 0.8 * scale, distance: d });
    this.vfx.spawn("starShards", at.add(new Vector3(0, 0.5 * scale, 0)), { owner: "self", palette: "star", scale: 0.7 * scale, distance: d });
  }

  /** 怪物重生：魔法陣＋光柱（與展示頁相同） */
  monsterRespawn(groundAt: Vector3, scale = 1, boss = false): void {
    const at = this.groundPoint(groundAt.x, groundAt.z, 0.8 * scale);
    const d = Vector3.Distance(at, this.listener);
    if (d > this.remoteCullDistance || this.offscreen(at)) return;
    this.vfx.spawn("magicCircle", at, { palette: "star", scale: (boss ? 1.8 : 1) * scale, duration: 0.9, distance: d });
    this.vfx.spawn("lightPillar", at, { palette: "star", scale: (boss ? 1.6 : 0.9) * scale, duration: 0.8, distance: d });
  }

  /** 自己被打：受傷數字、紅色閃光、畫面邊緣受傷提示、震動 */
  playerHurt(chest: Vector3, damage: number, shake = 0.15): void {
    this.damage.show(chest.add(new Vector3(0, 0.45, 0)), damage, "player");
    this.vfx.spawn("hitFlash", chest, { palette: "rose" });
    this.shake.shake(shake);
    this.screen.flashHurt();
  }

  // ------------------------------------------------------------------ 每格

  /**
   * 每格（簡單用法）：advance＋updateVisuals。
   * 角色動作由技能時間軸驅動時（handle.timeline.t → 動作時間），請改用分兩段：
   *   fx.advance(dt) → 依 handle.timeline.t 設定動作 → fx.updateVisuals(dt)
   * 這樣武器拖尾取樣的是「這一格的」武器位置，不會落後一格。
   */
  update(dt: number): Vector3 {
    this.advance(dt);
    return this.updateVisuals(dt);
  }

  /** 第一段：推進技能時間軸、觸發事件（特效、音效、命中 hook） */
  advance(dt: number): void {
    if (this.disposed) return;
    this.now += dt;
    const cam = this.camera as Camera & { target?: Vector3 };
    if (cam.target && this.listener.lengthSquared() === 0) this.listener.copyFrom(cam.target);
    for (let i = this.playing.length - 1; i >= 0; i--) {
      const p = this.playing[i]!;
      const st = this.actors.get(p.actorId);
      if (p.cancelled || !st) {
        this.playing.splice(i, 1);
        if (st?.trail) st.trail.stop();
        continue;
      }
      // 命中 hook 立即呼叫（遊戲邏輯）；特效／投射物／拖尾／音效延到 updateVisuals：那時角色已套上這一格的姿勢，
      // 掛在武器、角色前方的特效才會在這一格的正確位置產生（不是上一格）
      for (const e of p.tl.advance(dt)) {
        if (e.event.kind === "hit") this.runEvent(p, st, e.event, e.t, e.end);
        else this.deferred.push({ p, actorId: p.actorId, ev: e.event, t: e.t, end: e.end });
      }
      if (p.tl.done) {
        this.playing.splice(i, 1);
        st.trail?.stop();
        p.hooks.onEnd?.();
      }
    }
  }

  /** 第二段：武器拖尾（強制更新武器節點的世界座標）、特效、傷害數字、畫面閃光；回傳鏡頭震動位移 */
  updateVisuals(dt: number): Vector3 {
    if (this.disposed) return Vector3.ZeroReadOnly as Vector3;
    if (this.deferred.length) {
      const list = this.deferred.splice(0);
      for (const d of list) {
        const st = this.actors.get(d.actorId);
        if (!st || d.p.cancelled) continue;
        for (const n of [st.actor.weaponFocus, st.actor.weaponTip, st.actor.weaponBase]) if (n) syncWorld(n);
        syncWorld(st.actor.root);
        this.runEvent(d.p, st, d.ev, d.t, d.end);
      }
    }
    for (const st of this.actors.values()) {
      if (st.trail && st.trailEnd >= 0 && this.now >= st.trailEnd) {
        st.trail.stop();
        st.trailEnd = -1;
      }
      if (st.trail && st.actor.weaponTip && st.actor.weaponBase) {
        syncWorld(st.actor.weaponTip);
        syncWorld(st.actor.weaponBase);
      }
      st.trail?.update(dt);
    }
    this.vfx.update(dt);
    this.damage.update(dt);
    this.screen.update(dt);
    return this.shake.update(dt, this.camera as never);
  }

  /** 測試：某個角色拖尾的最新取樣 */
  trailHead(actorId: string): { base: Vector3; tip: Vector3; emitting: boolean; samples: number; maxChord: number } | null {
    return this.actors.get(actorId)?.trail?.head() ?? null;
  }

  // ------------------------------------------------------------------ 預熱與診斷

  /**
   * 預熱：每種特效、投射物、暴擊先生成一次並畫 1 格（共約 5 格），然後全部收回物件池。
   * - 畫面：預熱期間鏡頭只畫 1×1 像素（玩家看不到預熱特效）；請在載入畫面期間呼叫
   * - 不扣血、不顯示傷害數字、不播音效、不呼叫任何 hooks（不會觸發網路事件）
   * - 依目前畫質：低畫質只建立主層（沒有發光層、次要層）
   * - maxMs：最長等待（預設 4000 ms；逾時就停，不擋開機）
   */
  async prewarm(o: { keys?: readonly FxKey[]; maxMs?: number } = {}): Promise<PrewarmReport> {
    const t0 = performance.now();
    const audio0 = this.audio?.played ?? 0;
    const dmg0 = this.damage.shown;
    const eng = this.scene.getEngine();
    const oldVp = this.camera.viewport;
    this.camera.viewport = new Viewport(0, 0, 1 / Math.max(1, eng.getRenderWidth()), 1 / Math.max(1, eng.getRenderHeight()));
    const fwd = this.camera.getDirection(Vector3.Forward());
    const at = this.camera.position.add(fwd.scale(4));
    let spawned = 0;
    let made = { materials: 0, meshes: 0, systems: 0 };
    try {
      const run = this.vfx.prewarm(at, o.keys ?? FX_KEY_LIST, ["steel"]);
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), o.maxMs ?? 4000));
      const r = await Promise.race([run, timeout]);
      if (!r) this.vfx.cancelPrewarm();
      spawned = r?.spawned ?? -1;
      if (r) made = { materials: r.materials, meshes: r.meshes, systems: r.systems };
      // 拖尾也先編譯（自己的第一個角色）
      const first = [...this.actors.values()].find((s) => s.trail);
      if (first?.trail) {
        first.trail.start();
        first.trail.update(1 / 30);
        this.scene.render();
        first.trail.stop();
        first.trail.update(1);
      }
    } finally {
      this.vfx.clear();
      this.camera.viewport = oldVp;
    }
    const s = this.vfx.stats;
    return {
      ms: Math.round(performance.now() - t0),
      spawned,
      leftoverActive: s.meshFx + (this.vfx.budget.stats.active ?? 0),
      leftoverProjectiles: s.projectiles,
      audioPlayed: (this.audio?.played ?? 0) - audio0,
      damageShown: this.damage.shown - dmg0,
      tier: this.tier,
      materials: made.materials,
      pooledMeshes: made.meshes,
      particleSystems: made.systems,
    };
  }

  /** 效能診斷（FPS 面板、iPhone 比較測試） */
  stats() {
    return {
      tier: this.tier,
      actors: this.actors.size,
      playing: this.playing.length,
      vfx: { ...this.vfx.stats },
      budget: { ...this.vfx.budget.stats },
      culled: { ...this.culled },
      essential: this.essentialCount,
      damageShown: this.damage.shown,
      audioPlayed: this.audio?.played ?? 0,
    };
  }

  /** 離開地圖：釋放所有網格、粒子、材質、拖尾、DOM、音效。共用貼圖快取隨場景一起釋放。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.playing.length = 0;
    this.deferred.length = 0;
    for (const st of this.actors.values()) st.trail?.dispose();
    this.actors.clear();
    this.vfx.dispose();
    this.damage.dispose();
    this.screen.dispose();
    this.audio?.dispose();
  }

  // ------------------------------------------------------------------ 內部

  private spawnFor(owner: VfxOwner, key: FxKey, at: Vector3, opt: Omit<SpawnOptions, "owner" | "distance">): void {
    if (opt.essential) this.essentialCount++;
    else if (this.cullRemote(owner, at)) return;
    this.vfx.spawn(key, at, { ...opt, owner, distance: Vector3.Distance(at, this.listener) });
  }

  private sound(key: SfxKey, a: FxActor): void {
    if (!this.audio) return;
    if (a.owner === "self") this.audio.play(key);
    else {
      const p = a.position();
      if (Vector3.Distance(p, this.listener) > this.remoteCullDistance) return;
      this.audio.play(key, 0.3, this.panOf(p));
    }
  }

  private panOf(p: Vector3): number {
    const right = this.camera.getDirection(Vector3.Right());
    const d = p.subtract(this.listener);
    return Math.max(-0.8, Math.min(0.8, Vector3.Dot(d, right) / 8));
  }

  /** 其他玩家：太遠或不在畫面內 → 不生成（看不到的特效不花資源） */
  private cullRemote(owner: VfxOwner, at: Vector3): boolean {
    if (owner === "self") return false;
    if (Vector3.Distance(at, this.listener) > this.remoteCullDistance) {
      this.culled.distance++;
      return true;
    }
    if (this.offscreen(at)) {
      this.culled.offscreen++;
      return true;
    }
    return false;
  }

  private offscreen(at: Vector3): boolean {
    const fid = this.scene.getFrameId();
    if (fid !== this.frustumFrame) {
      this.frustumFrame = fid;
      const planes = Frustum.GetPlanes(this.camera.getTransformationMatrix());
      this.frustum.length = 0;
      this.frustum.push(...planes);
    }
    for (const p of this.frustum) if (p.dotCoordinate(at) < -this.remoteFrustumMargin) return true;
    return false;
  }
}


