/**
 * Combat VFX Lab（獨立戰鬥展示頁）：?lab=combat
 * 網址參數：&q=high|medium|low（特效品質，預設 medium）、&g=male|female、&lod=hq|lite（角色模型；預設依品質）、
 *          &auto=1（自動示範循環）、&multi=N（多人模擬：N 位其他玩家同時施放技能）、&aspd=100~250（攻速，上限 160）、&mute=1
 * 本頁技能、倍率、冷卻、怪物血量都是技術展示用測試值，不代表正式職業技能與數值。
 */
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  SceneInstrumentation,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { CombatAvatar, type Gender, type Lod } from "../CombatAvatar.ts";
import { SKILLS, type SkillDef, type HitSpec, type SkillEvent } from "../core/skills.ts";
import { SkillTimeline } from "../core/timeline.ts";
import { DemoResolver, skillRate, DEMO_STATS } from "../core/damage.ts";
import { VFX_QUALITY, parseTier, type VfxTier } from "../core/quality.ts";
import { VfxSystem, type Projectile } from "../fx/VfxSystem.ts";
import { WeaponTrail } from "../fx/WeaponTrail.ts";
import { DamageNumbers } from "../fx/DamageNumbers.ts";
import { CombatAudio } from "../fx/CombatAudio.ts";
import { CameraFx } from "../fx/CameraFx.ts";
import { PALETTES } from "../fx/palette.ts";
import { LAB_MONSTERS } from "./monsterSpecs.ts";
import { RiggedMonsterVisual, riggedAssetAvailable } from "../../monsters/rigged/RiggedMonsterVisual.ts";
import { BASE_POSE } from "../../monsters/anim/types.ts";
import { clampAttackSpeed } from "../../core/rules.ts";
import type { VfxOwner } from "../core/budget.ts";

const BASE = import.meta.env.BASE_URL;
const MOVE_SPEED = 5;

interface Mon {
  idx: number;
  label: string;
  vis: RiggedMonsterVisual;
  pos: Vector3;
  home: Vector3;
  yaw: number;
  hp: number;
  maxHp: number;
  radius: number;
  state: "idle" | "attack" | "dead" | "respawn";
  stateT: number;
  atkCd: number;
  atkHitDone: boolean;
  flash: number;
  opacity: number;
  freeze: number;
  boss: boolean;
}

interface Caster {
  id: string;
  owner: VfxOwner;
  av: CombatAvatar;
  pos: Vector3;
  trail: WeaponTrail;
  tl: SkillTimeline | null;
  skill: SkillDef | null;
  castId: number;
  yaw0: number;
  start: Vector3;
  target: Mon | null;
  trails: { end: number }[];
  cds: Map<string, number>;
  activeTrailEnd: number;
  nextAuto: number;
}

interface SyncRecord {
  skill: string;
  hit: string;
  clipT: number;
  animT: number;
  realT: number;
  targets: number;
  damage: number[];
  crit: boolean;
  shownSameFrame: boolean;
  /** melee：時間軸當格結算；projectile：投射物抵達時結算（clipT 為發射時間） */
  kind: "melee" | "projectile";
}

export async function startCombatVfxLab(canvas: HTMLCanvasElement, hudRoot: HTMLElement): Promise<void> {
  const qs = new URLSearchParams(location.search);
  let tier: VfxTier = parseTier(qs.get("q"), "medium");
  let gender: Gender = qs.get("g") === "female" ? "female" : "male";
  const lodParam = qs.get("lod");
  const lodFor = (t: VfxTier): Lod => (lodParam === "hq" || lodParam === "lite" ? lodParam : t === "high" ? "hq" : "lite");
  let aspd = Math.max(50, Number(qs.get("aspd") ?? "100") || 100);
  let auto = qs.get("auto") === "1";
  let multiN = Math.max(0, Math.min(11, Number(qs.get("multi") ?? "0") || 0));

  const engine = new Engine(canvas, true, { stencil: true, adaptToDeviceRatio: false, antialias: true, powerPreference: "high-performance" });
  const applyDpr = () => engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, VFX_QUALITY[tier].maxDpr));
  applyDpr();
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.62, 0.72, 0.9, 1);
  scene.ambientColor = new Color3(0.35, 0.35, 0.45);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.012;
  scene.fogColor = new Color3(0.66, 0.74, 0.9);
  const instr = new SceneInstrumentation(scene);

  const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), scene);
  hemi.intensity = 0.95;
  hemi.groundColor = new Color3(0.45, 0.42, 0.55);
  const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, 0.5), scene);
  sun.intensity = 1.25;
  sun.diffuse = new Color3(1, 0.96, 0.88);

  // ---------------------------------------------------------------- 競技場（程式貼圖：白石地磚＋金色星紋）
  const ground = MeshBuilder.CreateDisc("arena", { radius: 18, tessellation: 64 }, scene);
  ground.rotation.x = Math.PI / 2;
  ground.isPickable = false;
  const gtex = new DynamicTexture("arenaTex", { width: 1024, height: 1024 }, scene, true);
  {
    const c = gtex.getContext() as unknown as CanvasRenderingContext2D;
    const s = 1024;
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "#e9e6f2");
    g.addColorStop(0.6, "#d9d6e6");
    g.addColorStop(1, "#aeb8a0");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    c.strokeStyle = "rgba(120,115,150,0.35)";
    c.lineWidth = 2;
    for (let r = 60; r < s / 2; r += 60) {
      c.beginPath();
      c.arc(s / 2, s / 2, r, 0, Math.PI * 2);
      c.stroke();
    }
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      c.beginPath();
      c.moveTo(s / 2 + Math.cos(a) * 60, s / 2 + Math.sin(a) * 60);
      c.lineTo(s / 2 + Math.cos(a) * s * 0.48, s / 2 + Math.sin(a) * s * 0.48);
      c.stroke();
    }
    c.strokeStyle = "rgba(214,170,70,0.85)";
    c.lineWidth = 6;
    c.beginPath();
    c.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = "rgba(214,170,70,0.5)";
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? 90 : 36;
      const x = s / 2 + Math.cos(a) * r;
      const y = s / 2 + Math.sin(a) * r;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    c.fill();
    gtex.update();
  }
  const gmat = new StandardMaterial("arenaMat", scene);
  gmat.diffuseTexture = gtex;
  gmat.specularColor = new Color3(0.08, 0.08, 0.1);
  ground.material = gmat;
  ground.freezeWorldMatrix();
  // 外圈石柱（合併成 1 個網格）
  {
    const parts = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const p = MeshBuilder.CreateCylinder(`pillar${i}`, { height: 3.2, diameterTop: 0.7, diameterBottom: 0.85, tessellation: 10 }, scene);
      p.position.set(Math.cos(a) * 16.5, 1.6, Math.sin(a) * 16.5);
      parts.push(p);
    }
    const m = Mesh.MergeMeshes(parts, true, true);
    if (m) {
      const pm = new StandardMaterial("pillarMat", scene);
      pm.diffuseColor = new Color3(0.92, 0.9, 0.96);
      pm.specularColor = new Color3(0.1, 0.1, 0.12);
      m.material = pm;
      m.isPickable = false;
      m.freezeWorldMatrix();
    }
  }

  // ---------------------------------------------------------------- 鏡頭
  const cam = new ArcRotateCamera("cam", -Math.PI / 2 - 0.35, 1.08, 8.5, new Vector3(0, 0.8, 0), scene);
  cam.attachControl(canvas, true);
  cam.lowerRadiusLimit = 3.5;
  cam.upperRadiusLimit = 16;
  cam.lowerBetaLimit = 0.45;
  cam.upperBetaLimit = 1.42;
  cam.panningSensibility = 0;
  cam.minZ = 0.1;
  cam.maxZ = 120;
  cam.wheelPrecision = 30;
  cam.pinchPrecision = 60;

  // ---------------------------------------------------------------- 系統
  const vfx = new VfxSystem(scene, tier);
  const dmg = new DamageNumbers(scene, hudRoot, VFX_QUALITY[tier].damageNumbers);
  const audio = new CombatAudio();
  if (qs.get("mute") === "1") audio.enabled = false;
  const camfx = new CameraFx();
  camfx.scale = VFX_QUALITY[tier].shake;
  let hitstopOn = true;
  const resolver = new DemoResolver();
  const errors: string[] = [];
  window.addEventListener("error", (e) => errors.push(String(e.message)));
  window.addEventListener("unhandledrejection", (e) => errors.push(String((e as PromiseRejectionEvent).reason)));

  // ---------------------------------------------------------------- 怪物
  const mons: Mon[] = [];
  const monLoad = LAB_MONSTERS.map(async (m, i) => {
    const lod: "hq" | "lite" = tier === "high" ? "hq" : "lite";
    if (!(await riggedAssetAvailable(BASE, m.spec, lod))) {
      errors.push(`怪物 GLB 未列在 manifest：${m.spec.files[lod]}`);
      return;
    }
    const vis = new RiggedMonsterVisual({ scene, baseUrl: BASE, spec: m.spec, lod, hpBar: true });
    await vis.load();
    const ang = [-0.62, -0.2, 0.22, 0][i] ?? 0;
    const dist = m.boss ? 9 : 5.2;
    const home = new Vector3(Math.sin(ang) * dist, 0, Math.cos(ang) * dist);
    const mon: Mon = {
      idx: i, label: m.spec.label.split(" Rig")[0] ?? m.spec.label, vis, pos: home.clone(), home, yaw: Math.PI + ang, hp: m.hp, maxHp: m.hp,
      radius: m.spec.bodyRadius, state: "idle", stateT: 0, atkCd: 2 + i, atkHitDone: false, flash: 0, opacity: 1, freeze: 0, boss: !!m.boss,
    };
    vis.setTransform(home.x, 0, home.z, mon.yaw);
    vis.setHealth(mon.hp, mon.maxHp);
    mons.push(mon);
  });

  // ---------------------------------------------------------------- 玩家
  let player: Caster;
  const ghosts: Caster[] = [];
  const makeCaster = async (id: string, owner: VfxOwner, g: Gender, lod: Lod, at: Vector3): Promise<Caster> => {
    const av = await CombatAvatar.create(scene, BASE, g, lod);
    av.root.position.copyFrom(at);
    const q = VFX_QUALITY[tier];
    const trail = new WeaponTrail(scene, av.sword.base, av.sword.tip, owner === "self" ? q.trailSegments : Math.max(6, q.trailSegments >> 1), q.trailLife, null);
    return { id, owner, av, pos: av.root.position, trail, tl: null, skill: null, castId: 0, yaw0: 0, start: at.clone(), target: null, trails: [], cds: new Map(), activeTrailEnd: -1, nextAuto: 0 };
  };
  player = await makeCaster("player", "self", gender, lodFor(tier), new Vector3(0, 0, 0));
  await Promise.all(monLoad);
  mons.sort((a, b) => a.idx - b.idx);

  // ---------------------------------------------------------------- HUD
  const hud = buildHud(hudRoot);
  let target: Mon | null = mons[0] ?? null;
  let castSeq = 0;
  const sync: SyncRecord[] = [];
  let frameNo = 0;
  let shownThisFrame = 0;
  let realTime = 0;

  const nearestTarget = (c: Caster): Mon | null => {
    let best: Mon | null = null;
    let bd = Infinity;
    for (const m of mons) {
      if (m.state === "dead" || m.state === "respawn") continue;
      const d = Vector3.Distance(m.pos, c.pos);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  };

  const facing = (yaw: number) => new Vector3(Math.sin(yaw), 0, Math.cos(yaw));

  // ---------------------------------------------------------------- 施放
  const cast = (c: Caster, skill: SkillDef): boolean => {
    if (c.tl) return false;
    const now = realTime;
    if ((c.cds.get(skill.id) ?? 0) > now) return false;
    const tgt = c.owner === "self" ? (target && target.state !== "dead" && target.state !== "respawn" ? target : nearestTarget(c)) : c.target ?? nearestTarget(c);
    if (c.owner === "self") target = tgt;
    c.target = tgt;
    const clip = c.av.clip(skill.clip);
    if (!clip) return false;
    if (skill.faceTarget && tgt) c.av.yaw = Math.atan2(tgt.pos.x - c.pos.x, tgt.pos.z - c.pos.z);
    const rate = skillRate(skill.aspdScaled, c.owner === "self" ? aspd : 100);
    c.tl = new SkillTimeline(skill, clip, rate);
    c.skill = skill;
    c.castId = ++castSeq;
    c.yaw0 = c.av.yaw;
    c.start.copyFrom(c.pos);
    c.av.setWeapon(skill.weapon);
    c.trail.setColor(PALETTES[skill.palette].main);
    c.av.startSkill(skill.clip, 0.06);
    c.cds.set(skill.id, now + skill.cooldown + c.tl.realDuration);
    return true;
  };

  const anchor = (c: Caster, ev: { anchor: string; forward?: number }): Vector3 => {
    const f = facing(c.av.yaw);
    switch (ev.anchor) {
      case "target":
        return c.target ? c.target.pos.clone() : c.pos.add(f.scale(4));
      case "weapon":
        return c.av.weaponRig.focus.getAbsolutePosition().clone();
      case "front":
        return c.pos.add(f.scale(ev.forward ?? 0.6)).addInPlaceFromFloats(0, 0.55, 0);
      default:
        return c.pos.clone();
    }
  };

  const hitPoint = (m: Mon) => m.pos.add(new Vector3(0, Math.min(1.4, m.vis.spec.heightM * 0.45), 0));

  const targetsFor = (c: Caster, hit: HitSpec, center?: Vector3): Mon[] => {
    const out: Mon[] = [];
    const f = facing(c.av.yaw);
    for (const m of mons) {
      if (m.state === "dead" || m.state === "respawn") continue;
      if (hit.single && m !== c.target) continue;
      const sh = hit.shape;
      if (sh.type === "cone") {
        const d = m.pos.subtract(c.pos);
        d.y = 0;
        const dist = d.length() - m.radius;
        if (dist > sh.radius) continue;
        const ang = (Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(d.normalize(), f)))) * 180) / Math.PI;
        if (ang > sh.angleDeg / 2 && d.length() > m.radius + 0.3) continue;
        out.push(m);
      } else {
        const ctr = center ?? (sh.center === "target" && c.target ? c.target.pos : c.pos);
        const d = Vector3.Distance(new Vector3(m.pos.x, 0, m.pos.z), new Vector3(ctr.x, 0, ctr.z)) - m.radius;
        if (d <= sh.radius) out.push(m);
      }
    }
    return out;
  };

  const applyHit = (c: Caster, skill: SkillDef, hit: HitSpec, clipT: number, center?: Vector3, impactAt?: Vector3, proj = false): void => {
    const list = targetsFor(c, hit, center);
    const pal = skill.palette;
    const opt = { owner: c.owner, palette: pal, distance: Vector3.Distance(c.pos, player.pos) };
    const dmgs: number[] = [];
    let anyCrit = false;
    if (impactAt) vfx.hitFx(impactAt, hit.fx.filter((k) => k === "areaBlast" || k === "shockwave" || k === "dustRing" || k === "starBurst"), false, opt);
    for (const m of list) {
      const p = hitPoint(m);
      if (c.owner === "self") {
        const r = resolver.resolve({ skillId: skill.id, hit, attackerId: c.id, targetId: String(m.idx), castId: c.castId }, m.hp);
        if (r.damage <= 0) continue;
        m.hp = Math.max(0, m.hp - r.damage);
        m.vis.setHealth(m.hp, m.maxHp);
        dmg.show(p.add(new Vector3(0, 0.35, 0)), r.damage, r.crit ? "crit" : "normal");
        shownThisFrame++;
        dmgs.push(r.damage);
        anyCrit ||= r.crit;
        if (m.hp <= 0) killMon(m);
        else if (m.state === "idle") m.vis.onHitReaction({ stagger: 0, recoil: 0, immune: false });
      }
      m.flash = 1;
      vfx.hitFx(p, hit.fx.filter((k) => !impactAt || !(k === "areaBlast" || k === "shockwave" || k === "dustRing" || k === "starBurst")), c.owner === "self" && anyCrit, opt);
      if (hitstopOn && VFX_QUALITY[tier].hitstop && c.owner === "self") m.freeze = Math.max(m.freeze, hit.hitstopMs / 1000);
    }
    if (c.owner === "self") {
      if (list.length || impactAt) {
        audio.play(anyCrit ? "crit" : hit.sfx);
        if (anyCrit) audio.play(hit.sfx, 0.8);
        camfx.shake(hit.shake * (anyCrit ? 1.35 : 1) * (list.length ? 1 : 0.6));
        if (hitstopOn && VFX_QUALITY[tier].hitstop && list.length) c.tl?.hitstop(hit.hitstopMs * (anyCrit ? 1.3 : 1));
      }
      const g = c.av;
      const animT = (() => {
        const grp = scene.animationGroups.find((x) => x.name === `${skill.clip}#${g.id}`);
        const a = grp?.animatables[0];
        return a ? a.masterFrame / 30 : -1;
      })();
      sync.push({ skill: skill.id, hit: hit.id, clipT, animT, realT: realTime, targets: list.length, damage: dmgs, crit: anyCrit, shownSameFrame: shownThisFrame >= dmgs.length, kind: proj ? "projectile" : "melee" });
      if (sync.length > 200) sync.shift();
    } else if (list.length) audio.play(hit.sfx, 0.35);
  };

  const projectiles: { p: Projectile; c: Caster; skill: SkillDef; ev: Extract<SkillEvent, { kind: "projectile" }>; target: Mon | null; hitSet: Set<number>; dest: Vector3 | null; clipT: number }[] = [];

  const runEvent = (c: Caster, ev: SkillEvent, t: number, end?: number): void => {
    const skill = c.skill!;
    const own = { owner: c.owner, distance: Vector3.Distance(c.pos, player.pos) };
    switch (ev.kind) {
      case "trail":
        c.trail.setColor(PALETTES[ev.palette ?? skill.palette].main);
        c.trail.start();
        c.activeTrailEnd = end ?? t + 0.2;
        break;
      case "fx": {
        const at = anchor(c, ev);
        const follow = ev.anchor === "self" && (ev.fx === "magicCircle" || ev.fx === "whirlRing" || ev.fx === "chargeAura" || ev.fx === "groundGlow") ? c.av.root : undefined;
        vfx.spawn(ev.fx, at, { ...own, palette: ev.palette ?? skill.palette, yaw: c.av.yaw, scale: ev.scale, duration: ev.duration, follow, emitterMesh: ev.anchor === "weapon" ? c.av.weaponRig.focus : undefined });
        break;
      }
      case "sfx":
        if (c.owner === "self") audio.play(ev.sfx);
        else audio.play(ev.sfx, 0.3);
        break;
      case "shake":
        if (c.owner === "self") camfx.shake(ev.amount);
        break;
      case "hit":
        applyHit(c, skill, ev.hit, t);
        break;
      case "projectile": {
        const f = facing(c.av.yaw);
        let from: Vector3;
        let dir: Vector3;
        const tgt = c.target;
        if (ev.from === "sky") {
          const dest = tgt ? tgt.pos.clone() : c.pos.add(f.scale(6));
          from = dest.add(new Vector3(-2.2, 9, -1.5));
          dir = dest.subtract(from);
        } else {
          from = ev.from === "weapon" ? c.av.weaponRig.focus.getAbsolutePosition().clone() : c.pos.add(f.scale(0.6)).addInPlaceFromFloats(0, 0.55, 0);
          dir = ev.fx === "swordWave" ? f.clone() : tgt ? hitPoint(tgt).subtract(from) : f.clone();
        }
        const p = vfx.launch(ev.fx, from, dir, ev.speed, { ...own, palette: ev.palette ?? skill.palette });
        if (p) projectiles.push({ p, c, skill, ev, target: ev.homing ? tgt : null, hitSet: new Set(), dest: ev.from === "sky" ? (tgt ? tgt.pos.clone() : c.pos.add(f.scale(6))) : null, clipT: t });
        else if (c.owner === "self" && ev.from !== "sky") {
          // 畫面被預算拒絕也要照常結算（傷害不依賴特效）
          applyHit(c, skill, ev.hit, t, tgt?.pos);
        }
        break;
      }
    }
  };

  const updateProjectiles = (): void => {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const P = projectiles[i]!;
      const { p, c, skill, ev } = P;
      if (!p.alive) {
        projectiles.splice(i, 1);
        continue;
      }
      if (P.target && P.target.state !== "dead") p.steer(ev.from === "sky" ? P.target.pos : hitPoint(P.target), 0.2);
      if (ev.pierce) {
        for (const m of mons) {
          if (P.hitSet.has(m.idx) || m.state === "dead" || m.state === "respawn") continue;
          const d = Vector3.Distance(new Vector3(p.pos.x, 0, p.pos.z), new Vector3(m.pos.x, 0, m.pos.z));
          if (d <= m.radius + 0.6) {
            P.hitSet.add(m.idx);
            const prev = c.target;
            c.target = m;
            applyHit(c, skill, { ...ev.hit, single: true }, P.clipT, undefined, undefined, true);
            c.target = prev;
          }
        }
        if (p.travelled >= ev.maxRange) p.dispose(true);
        continue;
      }
      const dest = P.dest ?? (P.target ? hitPoint(P.target) : null);
      const arrived = dest ? Vector3.Distance(p.pos, dest) < 0.45 || (ev.from === "sky" && p.pos.y <= 0.3) : false;
      if (arrived || p.travelled >= ev.maxRange) {
        const at = ev.from === "sky" ? new Vector3(p.pos.x, 0, p.pos.z) : p.pos.clone();
        p.dispose(false);
        applyHit(c, skill, ev.hit, P.clipT, at, at, true);
        if (c.owner === "self") vfx.spawn("boltImpact", at.add(new Vector3(0, ev.from === "sky" ? 0.4 : 0, 0)), { palette: ev.palette ?? skill.palette });
      }
    }
  };

  const updateCaster = (c: Caster, dt: number, moveDir: Vector3 | null): void => {
    const tl = c.tl;
    if (tl) {
      for (const f of tl.advance(dt)) runEvent(c, f.event, f.t, f.end);
      c.av.setSkillTime(tl.t);
      const rm = tl.rootMotion();
      const f = facing(c.yaw0);
      c.pos.copyFrom(c.start).addInPlace(f.scale(rm.forward));
      c.av.yaw = c.yaw0 - rm.yaw;
      if (c.activeTrailEnd >= 0 && tl.t >= c.activeTrailEnd) {
        c.trail.stop();
        c.activeTrailEnd = -1;
      }
      if (tl.done) {
        c.tl = null;
        c.skill = null;
        c.trail.stop();
        c.av.yaw = c.yaw0 - rm.yaw;
        c.av.play("Idle", true, 0.18);
      }
    } else if (moveDir && moveDir.lengthSquared() > 0.01) {
      const v = moveDir.scale(MOVE_SPEED * Math.min(1, moveDir.length()));
      c.pos.addInPlace(v.scale(dt));
      const r = Math.hypot(c.pos.x, c.pos.z);
      if (r > 15) c.pos.scaleInPlace(15 / r);
      c.av.yaw = Math.atan2(v.x, v.z);
      c.av.play("Run", true, 0.12, Math.min(2.4, Math.max(0.8, v.length() / (gender === "male" ? 2.26 : 2.41))));
    } else if (c.av.baseState === "Run") c.av.play("Idle", true, 0.15);
    c.av.update(dt);
    c.trail.update(dt);
  };

  // ---------------------------------------------------------------- 怪物 AI（展示用：站樁、靠近時攻擊、被打倒後重生）
  const killMon = (m: Mon): void => {
    m.state = "dead";
    m.stateT = 0;
    m.vis.onStateEnter("death");
    if (target === m) target = null;
  };
  const updateMons = (dt: number): void => {
    for (const m of mons) {
      m.stateT += dt;
      const frozen = m.freeze > 0;
      if (frozen) m.freeze = Math.max(0, m.freeze - dt);
      for (const k of ["idle", "attack", "hurt", "death", "respawn", "move", "run"] as const) {
        const g = m.vis.group(k);
        if (g && g.isPlaying) g.speedRatio = frozen ? 0 : 1;
      }
      if (frozen) {
        m.flash = Math.max(m.flash, 0.6);
      } else if (m.state === "idle") {
        m.atkCd -= dt;
        const d = Vector3.Distance(m.pos, player.pos) - m.radius;
        const want = Math.atan2(player.pos.x - m.pos.x, player.pos.z - m.pos.z);
        if (d < 6) m.yaw += Math.atan2(Math.sin(want - m.yaw), Math.cos(want - m.yaw)) * Math.min(1, dt * 3);
        if (d < (m.boss ? 2.2 : 1.6) && m.atkCd <= 0) {
          m.state = "attack";
          m.stateT = 0;
          m.atkHitDone = false;
          m.vis.onStateEnter("attack");
        }
      } else if (m.state === "attack") {
        const hitT = m.vis.spec.attackHitTime;
        if (!m.atkHitDone && m.stateT >= hitT) {
          m.atkHitDone = true;
          const d = Vector3.Distance(m.pos, player.pos) - m.radius;
          if (d < (m.boss ? 2.6 : 2.0)) {
            const v = Math.round((m.boss ? 18 : 8) * (0.9 + Math.random() * 0.2));
            dmg.show(player.av.chest().add(new Vector3(0, 0.45, 0)), v, "player");
            vfx.spawn("hitFlash", player.av.chest(), { palette: "rose" });
            audio.play(m.boss ? "hitHeavy" : "hit", 0.6);
            camfx.shake(m.boss ? 0.35 : 0.15);
            if (!player.tl) player.av.play("Hurt", false, 0.05);
          }
        }
        if (m.stateT >= (m.vis.asset?.durations.attack ?? 1.2)) {
          m.state = "idle";
          m.stateT = 0;
          m.atkCd = m.boss ? 3.5 : 2.5;
          m.vis.onStateEnter("idle");
        }
      } else if (m.state === "dead") {
        const dDeath = m.vis.asset?.durations.death ?? 1;
        if (m.stateT > dDeath + 1.0) m.opacity = Math.max(0, 1 - (m.stateT - dDeath - 1.0) / 0.6);
        if (m.stateT > dDeath + 2.6) {
          m.state = "respawn";
          m.stateT = 0;
          m.hp = m.maxHp;
          m.vis.setHealth(m.hp, m.maxHp);
          m.pos.copyFrom(m.home);
          m.opacity = 1;
          m.vis.onStateEnter("respawn");
          vfx.spawn("magicCircle", m.pos, { palette: "star", scale: m.boss ? 1.8 : 1, duration: 0.9 });
        }
      } else if (m.state === "respawn") {
        if (m.stateT >= (m.vis.asset?.durations.respawn ?? 0.6)) {
          m.state = "idle";
          m.stateT = 0;
          m.vis.onStateEnter("idle");
        }
      }
      m.flash = Math.max(0, m.flash - dt * 6);
      m.vis.setTransform(m.pos.x, 0, m.pos.z, m.yaw);
      m.vis.applyPose({ ...BASE_POSE, hitFlash: m.flash, opacity: m.opacity, bodyVisible: m.opacity > 0.01 });
      m.vis.update(frozen ? 0 : dt);
    }
  };

  // ---------------------------------------------------------------- 多人模擬
  const setMulti = async (n: number): Promise<void> => {
    multiN = n;
    while (ghosts.length > n) {
      const g = ghosts.pop()!;
      g.trail.dispose();
      g.av.dispose();
    }
    while (ghosts.length < n) {
      const i = ghosts.length;
      const a = (i / Math.max(1, n)) * Math.PI * 2 + 0.4;
      const at = new Vector3(Math.cos(a) * 3.2, 0, Math.sin(a) * 3.2 + 3.5);
      const g = await makeCaster(`ghost${i}`, "other", i % 2 ? "female" : "male", "lite", at);
      g.nextAuto = realTime + 0.3 * i;
      ghosts.push(g);
    }
    hud.multi.textContent = `多人 ${multiN}`;
  };

  // ---------------------------------------------------------------- 輸入
  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => {
    keys.add(e.key.toLowerCase());
    const n = Number(e.key);
    if (n >= 1 && n <= 6) castByIndex(n - 1);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  const joy = hud.joystick;
  const castByIndex = (i: number) => {
    audio.unlock();
    const s = SKILLS[i];
    if (s) cast(player, s);
  };
  hud.skillButtons.forEach((b, i) => b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    castByIndex(i);
  }));
  hudRoot.addEventListener("pointerdown", () => audio.unlock(), { capture: true });

  const setTier = async (t: VfxTier): Promise<void> => {
    tier = t;
    applyDpr();
    vfx.clear();
    vfx.setTier(t);
    dmg.setMax(VFX_QUALITY[t].damageNumbers);
    camfx.scale = VFX_QUALITY[t].shake;
    for (const c of [player, ...ghosts]) {
      c.trail.dispose();
      c.trail = new WeaponTrail(scene, c.av.sword.base, c.av.sword.tip, c.owner === "self" ? VFX_QUALITY[t].trailSegments : Math.max(6, VFX_QUALITY[t].trailSegments >> 1), VFX_QUALITY[t].trailLife, null);
    }
    hud.setTier(t);
  };
  hud.tierButtons.forEach((b) => b.addEventListener("click", () => void setTier(b.dataset.tier as VfxTier)));
  hud.gender.addEventListener("click", async () => {
    gender = gender === "male" ? "female" : "male";
    const pos = player.pos.clone();
    const yaw = player.av.yaw;
    player.trail.dispose();
    player.av.dispose();
    player = await makeCaster("player", "self", gender, lodFor(tier), pos);
    player.av.yaw = yaw;
    hud.gender.textContent = gender === "male" ? "男" : "女";
  });
  hud.sound.addEventListener("click", () => {
    audio.unlock();
    audio.enabled = !audio.enabled;
    hud.sound.textContent = audio.enabled ? "音效 開" : "音效 關";
  });
  hud.shake.addEventListener("click", () => {
    camfx.enabled = !camfx.enabled;
    hud.shake.textContent = camfx.enabled ? "震動 開" : "震動 關";
  });
  hud.hitstop.addEventListener("click", () => {
    hitstopOn = !hitstopOn;
    hud.hitstop.textContent = hitstopOn ? "頓幀 開" : "頓幀 關";
  });
  hud.auto.addEventListener("click", () => {
    auto = !auto;
    hud.auto.textContent = auto ? "自動示範 開" : "自動示範 關";
  });
  hud.multi.addEventListener("click", () => void setMulti(multiN >= 8 ? 0 : multiN === 0 ? 4 : 8));
  hud.aspd.value = String(Math.min(250, aspd));
  hud.aspd.addEventListener("input", () => {
    aspd = Number(hud.aspd.value);
  });
  hud.setTier(tier);
  hud.gender.textContent = gender === "male" ? "男" : "女";
  hud.auto.textContent = auto ? "自動示範 開" : "自動示範 關";
  if (multiN > 0) await setMulti(multiN);

  // ---------------------------------------------------------------- FPS
  const ring = new Float32Array(1200);
  let ringN = 0;
  let ringI = 0;
  let fpsAcc = 0;
  let fpsFrames = 0;
  let fpsShown = 0;
  let autoIdx = 0;
  let autoNext = 1.0;
  let hurtT = 0;

  const perf = () => {
    const n = Math.min(ringN, ring.length);
    const arr = Array.from(ring.subarray(0, n)).sort((a, b) => b - a);
    const k = Math.max(1, Math.floor(n * 0.01));
    const worst = arr.slice(0, k);
    const avgMs = n ? arr.reduce((a, b) => a + b, 0) / n : 0;
    const lowMs = worst.length ? worst.reduce((a, b) => a + b, 0) / worst.length : 0;
    return { fps: fpsShown, avg10s: avgMs ? 1000 / avgMs : 0, low1: lowMs ? 1000 / lowMs : 0, draws: instr.drawCallsCounter.current, frames: n };
  };

  scene.onBeforeRenderObservable.add(() => {
    const raw = engine.getDeltaTime() / 1000;
    const dt = Math.min(0.05, raw);
    realTime += dt;
    frameNo++;
    shownThisFrame = 0;
    ring[ringI] = raw * 1000;
    ringI = (ringI + 1) % ring.length;
    ringN++;
    fpsAcc += raw;
    fpsFrames++;
    if (fpsAcc >= 0.5) {
      fpsShown = fpsFrames / fpsAcc;
      fpsAcc = 0;
      fpsFrames = 0;
    }
    // 移動輸入
    const mv = new Vector3(joy.x, 0, -joy.y);
    if (keys.has("w") || keys.has("arrowup")) mv.z += 1;
    if (keys.has("s") || keys.has("arrowdown")) mv.z -= 1;
    if (keys.has("a") || keys.has("arrowleft")) mv.x -= 1;
    if (keys.has("d") || keys.has("arrowright")) mv.x += 1;
    // 鏡頭方向為準
    const fwd = cam.getForwardRay().direction;
    const f2 = new Vector3(fwd.x, 0, fwd.z).normalize();
    const r2 = new Vector3(f2.z, 0, -f2.x);
    const dir = f2.scale(mv.z).add(r2.scale(mv.x));
    if (dir.length() > 1) dir.normalize();
    if (player.av.baseState === "Hurt") {
      hurtT += dt;
      if (hurtT > 0.5 && !player.tl) {
        player.av.play("Idle", true, 0.15);
        hurtT = 0;
      }
    }
    updateCaster(player, dt, dir);
    // 自動示範
    if (auto && !player.tl && realTime >= autoNext) {
      const s = SKILLS[autoIdx % SKILLS.length]!;
      const t = nearestTarget(player);
      if (t) {
        target = t;
        const d = Vector3.Distance(t.pos, player.pos) - t.radius;
        if (d > s.range) {
          // 走到距離內
          const v = t.pos.subtract(player.pos);
          v.y = 0;
          v.normalize();
          player.pos.addInPlace(v.scale(MOVE_SPEED * dt));
          player.av.yaw = Math.atan2(v.x, v.z);
          player.av.play("Run", true, 0.12, 2.2);
        } else if (cast(player, s)) {
          autoIdx++;
          autoNext = realTime + 0.25;
        } else autoNext = realTime + 0.2;
      }
    }
    for (const g of ghosts) {
      if (!g.tl && realTime >= g.nextAuto) {
        const s = SKILLS[Math.floor(Math.random() * SKILLS.length)]!;
        g.target = nearestTarget(g);
        if (cast(g, s)) g.nextAuto = realTime + 0.6 + Math.random() * 1.2;
        else g.nextAuto = realTime + 0.3;
      }
      updateCaster(g, dt, null);
    }
    updateProjectiles();
    updateMons(dt);
    vfx.update(dt);
    dmg.update(dt);
    // 鏡頭跟隨＋震動
    const want = player.pos.add(new Vector3(0, 0.75, 0));
    Vector3.LerpToRef(cam.target, want, Math.min(1, dt * 8), cam.target);
    cam.target.addInPlace(camfx.update(dt, cam).scale(0.6));
    // HUD
    const p = perf();
    hud.setPerf(
      `FPS ${p.fps.toFixed(0)}｜10 秒平均 ${p.avg10s.toFixed(1)}｜1% Low ${p.low1.toFixed(1)}\n` +
        `Draw ${p.draws}｜粒子 ${vfx.stats.particles}｜特效 ${vfx.stats.meshFx}＋投射 ${vfx.stats.projectiles}\n` +
        `預算 ${vfx.budget.stats.active}/${VFX_QUALITY[tier].maxActiveEffects}｜拒絕 ${vfx.budget.stats.denied}｜品質 ${VFX_QUALITY[tier].label}｜攻速 ${clampAttackSpeed(aspd)}${aspd > 160 ? "（上限）" : ""}`,
    );
    hud.setSkills(SKILLS.map((s) => Math.max(0, (player.cds.get(s.id) ?? 0) - realTime)), player.skill?.id ?? null);
    hud.setTarget(target ? `${target.label}　HP ${Math.ceil(target.hp)} / ${target.maxHp}` : "目標：無（自動選最近的怪物）", target ? target.hp / target.maxHp : 0);
  });

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());

  // 自動測試用介面
  (window as unknown as Record<string, unknown>).__cvfx = {
    ready: true,
    errors,
    sync,
    skills: SKILLS.map((s) => s.id),
    cast: (id: string) => {
      const s = SKILLS.find((x) => x.id === id);
      return s ? cast(player, s) : false;
    },
    busy: () => !!player.tl,
    setTier: (t: VfxTier) => setTier(t),
    setMulti: (n: number) => setMulti(n),
    setAuto: (on: boolean) => {
      auto = on;
    },
    setAspd: (v: number) => {
      aspd = v;
    },
    perf,
    stats: () => ({
      tier,
      gender,
      monsters: mons.map((m) => ({ label: m.label, hp: m.hp, state: m.state, pos: [m.pos.x, m.pos.z], check: m.vis.asset?.check })),
      vfx: { ...vfx.stats },
      budget: { ...vfx.budget.stats },
      damageShown: dmg.shown,
      audioPlayed: audio.played,
      triangles: player.av.triangles,
      ghosts: ghosts.length,
      player: { x: player.pos.x, z: player.pos.z, yaw: player.av.yaw },
      demoStats: DEMO_STATS,
    }),
    moveTo: (x: number, z: number) => {
      player.pos.set(x, 0, z);
    },
    nearest: () => {
      const t = nearestTarget(player);
      return t ? { label: t.label, d: Vector3.Distance(t.pos, player.pos) - t.radius } : null;
    },
  };
}

// ---------------------------------------------------------------- HUD（DOM）

function buildHud(root: HTMLElement) {
  const st = document.createElement("style");
  st.textContent = `
  .cv-top{position:absolute;left:8px;right:8px;top:calc(8px + env(safe-area-inset-top));display:flex;justify-content:space-between;gap:8px;z-index:8;pointer-events:none}
  .cv-panel{background:rgba(20,24,48,.62);color:#eef3ff;border-radius:10px;padding:6px 9px;font:12px/1.45 system-ui,"PingFang TC",sans-serif;white-space:pre;pointer-events:auto;backdrop-filter:blur(4px)}
  .cv-title{font-weight:700;font-size:13px;color:#ffe9a8}
  .cv-ctrl{display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end;max-width:58vw}
  .cv-btn{background:rgba(30,40,80,.75);color:#fff;border:1px solid rgba(255,230,160,.45);border-radius:8px;padding:5px 8px;font:12px system-ui,"PingFang TC",sans-serif;pointer-events:auto}
  .cv-btn.on{background:linear-gradient(#ffd77a,#e8a83c);color:#3a2300;border-color:#fff2c2;font-weight:700}
  .cv-aspd{display:flex;align-items:center;gap:4px;color:#fff;font:12px system-ui;background:rgba(30,40,80,.75);border-radius:8px;padding:2px 6px;pointer-events:auto}
  .cv-skills{position:absolute;right:calc(10px + env(safe-area-inset-right));bottom:calc(14px + env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(3,64px);gap:8px;z-index:8}
  .cv-skill{position:relative;width:64px;height:64px;border-radius:50%;border:2px solid #ffe3a0;background:radial-gradient(circle at 35% 30%,#7fa8ff,#283a8a 70%);color:#fff;font:700 13px/1.1 system-ui,"PingFang TC",sans-serif;
    text-shadow:0 1px 2px #000;box-shadow:0 3px 8px rgba(0,0,0,.35),inset 0 0 10px rgba(255,255,255,.35);touch-action:none;overflow:hidden;-webkit-user-select:none;user-select:none}
  .cv-skill .cd{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-size:15px}
  .cv-skill.active{box-shadow:0 0 14px 4px rgba(255,220,120,.9)}
  .cv-joy{position:absolute;left:calc(18px + env(safe-area-inset-left));bottom:calc(22px + env(safe-area-inset-bottom));width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,.14);border:2px solid rgba(255,255,255,.35);z-index:8;touch-action:none}
  .cv-knob{position:absolute;left:38px;top:38px;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.75)}
  .cv-target{position:absolute;left:50%;transform:translateX(-50%);top:calc(64px + env(safe-area-inset-top));z-index:8;background:rgba(20,24,48,.62);color:#fff;border-radius:8px;padding:4px 10px;font:12px system-ui,"PingFang TC",sans-serif;min-width:200px;text-align:center}
  .cv-hp{height:5px;background:#422;border-radius:3px;margin-top:3px;overflow:hidden}.cv-hp>div{height:100%;background:linear-gradient(90deg,#ff6b7d,#ffb36b)}
  .cv-note{position:absolute;left:8px;bottom:calc(150px + env(safe-area-inset-bottom));z-index:7;color:#fff;font:11px system-ui,"PingFang TC";opacity:.8;text-shadow:0 1px 2px #000;max-width:46vw}
  `;
  document.head.appendChild(st);
  const top = document.createElement("div");
  top.className = "cv-top";
  const info = document.createElement("div");
  info.className = "cv-panel";
  const title = document.createElement("div");
  title.className = "cv-title";
  title.textContent = "Combat VFX Lab｜技術展示（非正式技能／數值）";
  const perf = document.createElement("div");
  perf.dataset.perf = "1";
  info.append(title, perf);
  const ctrl = document.createElement("div");
  ctrl.className = "cv-ctrl";
  const mk = (t: string) => {
    const b = document.createElement("button");
    b.className = "cv-btn";
    b.textContent = t;
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    ctrl.appendChild(b);
    return b;
  };
  const tierButtons = (["high", "medium", "low"] as const).map((t) => {
    const b = mk(`特效 ${VFX_QUALITY[t].label}`);
    b.dataset.tier = t;
    return b;
  });
  const gender = mk("男");
  const sound = mk("音效 開");
  const shake = mk("震動 開");
  const hitstop = mk("頓幀 開");
  const auto = mk("自動示範 關");
  const multi = mk("多人 0");
  const aspdWrap = document.createElement("label");
  aspdWrap.className = "cv-aspd";
  aspdWrap.textContent = "攻速";
  const aspd = document.createElement("input");
  aspd.type = "range";
  aspd.min = "100";
  aspd.max = "200";
  aspd.step = "10";
  aspd.addEventListener("pointerdown", (e) => e.stopPropagation());
  aspdWrap.appendChild(aspd);
  ctrl.appendChild(aspdWrap);
  top.append(info, ctrl);
  const tgt = document.createElement("div");
  tgt.className = "cv-target";
  const tgtText = document.createElement("div");
  const hp = document.createElement("div");
  hp.className = "cv-hp";
  const hpFill = document.createElement("div");
  hp.appendChild(hpFill);
  tgt.append(tgtText, hp);
  const skills = document.createElement("div");
  skills.className = "cv-skills";
  const skillButtons = SKILLS.map((s, i) => {
    const b = document.createElement("button");
    b.className = "cv-skill";
    b.dataset.skill = s.id;
    b.innerHTML = `<span>${i + 1}<br>${s.short}</span>`;
    const cd = document.createElement("div");
    cd.className = "cd";
    cd.style.display = "none";
    b.appendChild(cd);
    skills.appendChild(b);
    return b;
  });
  const joyEl = document.createElement("div");
  joyEl.className = "cv-joy";
  const knob = document.createElement("div");
  knob.className = "cv-knob";
  joyEl.appendChild(knob);
  const joystick = { x: 0, y: 0 };
  let jid = -1;
  const setKnob = (e: PointerEvent) => {
    const r = joyEl.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2);
    let y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const L = Math.hypot(x, y);
    if (L > 1) {
      x /= L;
      y /= L;
    }
    joystick.x = x;
    joystick.y = y;
    knob.style.transform = `translate(${x * 38}px,${y * 38}px)`;
  };
  joyEl.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    jid = e.pointerId;
    joyEl.setPointerCapture(e.pointerId);
    setKnob(e);
  });
  joyEl.addEventListener("pointermove", (e) => {
    if (e.pointerId === jid) setKnob(e);
  });
  const endJoy = (e: PointerEvent) => {
    if (e.pointerId !== jid) return;
    jid = -1;
    joystick.x = 0;
    joystick.y = 0;
    knob.style.transform = "";
  };
  joyEl.addEventListener("pointerup", endJoy);
  joyEl.addEventListener("pointercancel", endJoy);
  const note = document.createElement("div");
  note.className = "cv-note";
  note.textContent = "搖桿／WASD 移動（沒有跳躍鍵；跳躍只在技能動作內）｜1～6 施放技能｜拖曳畫面轉鏡頭";
  root.append(top, tgt, skills, joyEl, note);
  return {
    tierButtons, gender, sound, shake, hitstop, auto, multi, aspd, skillButtons, joystick,
    setTier(t: VfxTier) {
      for (const b of tierButtons) b.classList.toggle("on", b.dataset.tier === t);
    },
    setPerf(s: string) {
      if (perf.textContent !== s) perf.textContent = s;
    },
    setSkills(cds: number[], active: string | null) {
      skillButtons.forEach((b, i) => {
        const cd = b.querySelector<HTMLDivElement>(".cd")!;
        const v = cds[i] ?? 0;
        cd.style.display = v > 0.05 ? "flex" : "none";
        if (v > 0.05) cd.textContent = v.toFixed(1);
        b.classList.toggle("active", b.dataset.skill === active);
      });
    },
    setTarget(s: string, r: number) {
      if (tgtText.textContent !== s) tgtText.textContent = s;
      hpFill.style.width = `${Math.round(r * 100)}%`;
    },
  };
}
