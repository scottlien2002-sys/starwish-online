/**
 * Combat VFX Lab（獨立戰鬥展示頁）：?lab=combat
 * 網址參數：&q=high|medium|low（特效品質，預設 medium）、&g=male|female、&lod=hq|lite（角色模型；預設依品質）、
 *          &auto=1（自動示範循環）、&multi=N（多人模擬：N 位其他玩家同時施放技能，最多 16）、&aspd=100~250（攻速，上限 160）、&mute=1、
 *          &env=dark|meadow（深色競技場／白天草地）、&perf=legacy（Stage 1 的多人做法，效能比較用）、&ai=0（怪物不動，固定鏡頭錄影用）
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
import { CombatAudio, renderSfxOffline, encodeWav, SFX_KEYS } from "../fx/CombatAudio.ts";
import { CameraFx } from "../fx/CameraFx.ts";
import { PALETTES } from "../fx/palette.ts";
import { ScreenFx } from "../fx/ScreenFx.ts";
import { ArenaTerrain, type CircleObstacle } from "../core/terrain.ts";
import { behaviourForLevel, wantsTarget, onDamaged, type AggroState, type MonsterBehaviour } from "../core/monsterRules.ts";
import { CLASS_VFX, type ClassDemoStep } from "../core/classes.ts";
import { FX_KEY_LIST } from "../core/classKits.ts";
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
  level: number;
  behaviour: MonsterBehaviour;
  aggro: AggroState;
  moving: boolean;
  knock: Vector3;
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
  /** 根運動被地形擋住（測試用） */
  blocked: boolean;
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
  let multiN = Math.max(0, Math.min(32, Number(qs.get("multi") ?? "0") || 0));
  let envName: "dark" | "meadow" = qs.get("env") === "meadow" ? "meadow" : "dark";
  /** 效能比較模式：legacy＝Stage 1 做法（lite 模型）；stage2＝合併模型、不切遠距離版；stage3（預設）＝合併模型＋遠距離減面版 */
  const perfMode: "legacy" | "stage2" | "stage3" = qs.get("perf") === "legacy" ? "legacy" : qs.get("perf") === "stage2" ? "stage2" : "stage3";
  const perfLegacy = perfMode === "legacy";
  /** 遠距離版切換距離（鏡頭到角色，公尺；有緩衝避免來回閃） */
  const LOD_FAR_M = Number(qs.get("lodFar") ?? "14") || 14;
  const LOD_NEAR_M = LOD_FAR_M - 1;
  if (qs.get("lodMode") === "visible") CombatAvatar.lodToggle = "visible";
  let monAI = qs.get("ai") !== "0";

  const engine = new Engine(canvas, true, { stencil: true, adaptToDeviceRatio: false, antialias: true, powerPreference: "high-performance" });
  const applyDpr = () => engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, VFX_QUALITY[tier].maxDpr));
  applyDpr();
  const scene = new Scene(engine);
  // 星夜競技場：背景偏暗，讓加算混合的劍氣／魔法陣／震波有對比（白底會把特效洗掉）
  scene.clearColor = new Color4(0.06, 0.07, 0.17, 1);
  scene.ambientColor = new Color3(0.3, 0.3, 0.42);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.022;
  scene.fogColor = new Color3(0.08, 0.09, 0.2);
  const instr = new SceneInstrumentation(scene);

  const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), scene);
  hemi.intensity = 0.9;
  hemi.diffuse = new Color3(0.78, 0.82, 1);
  hemi.groundColor = new Color3(0.28, 0.24, 0.4);
  const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, 0.5), scene);
  sun.intensity = 1.2;
  sun.diffuse = new Color3(1, 0.9, 0.78);

  let darkSky: Mesh | null = null;
  let darkPillars: Mesh | null = null;
  // ---------------------------------------------------------------- 競技場（程式貼圖：深藍石板＋發光金色星紋）
  const ground = MeshBuilder.CreateDisc("arena", { radius: 18, tessellation: 64 }, scene);
  ground.rotation.x = Math.PI / 2;
  ground.isPickable = false;
  const gtex = new DynamicTexture("arenaTex", { width: 1024, height: 1024 }, scene, true);
  const etex = new DynamicTexture("arenaGlow", { width: 512, height: 512 }, scene, true);
  {
    const c = gtex.getContext() as unknown as CanvasRenderingContext2D;
    const s = 1024;
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "#4a4f78");
    g.addColorStop(0.55, "#353a5e");
    g.addColorStop(1, "#1d2140");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    // 石板接縫
    c.strokeStyle = "rgba(15,17,35,0.55)";
    c.lineWidth = 3;
    for (let r = 64; r < s / 2; r += 64) {
      c.beginPath();
      c.arc(s / 2, s / 2, r, 0, Math.PI * 2);
      c.stroke();
    }
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2 + (Math.floor(i / 2) % 2) * 0.05;
      c.beginPath();
      c.moveTo(s / 2 + Math.cos(a) * 64, s / 2 + Math.sin(a) * 64);
      c.lineTo(s / 2 + Math.cos(a) * s * 0.49, s / 2 + Math.sin(a) * s * 0.49);
      c.stroke();
    }
    // 石面雜點
    for (let i = 0; i < 2600; i++) {
      c.fillStyle = `rgba(${200 + Math.random() * 55},${200 + Math.random() * 55},255,${Math.random() * 0.05})`;
      c.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 5, 2 + Math.random() * 5);
    }
    gtex.update();
    // 發光層：金色星紋＋外圈符文環（emissive，不吃光）
    const e = etex.getContext() as unknown as CanvasRenderingContext2D;
    const t = 512;
    e.fillStyle = "#000";
    e.fillRect(0, 0, t, t);
    e.strokeStyle = "rgba(255,196,90,0.9)";
    e.lineWidth = 3;
    e.beginPath();
    e.arc(t / 2, t / 2, t * 0.3, 0, Math.PI * 2);
    e.stroke();
    e.lineWidth = 1.5;
    e.strokeStyle = "rgba(140,170,255,0.6)";
    e.beginPath();
    e.arc(t / 2, t / 2, t * 0.46, 0, Math.PI * 2);
    e.stroke();
    e.beginPath();
    e.arc(t / 2, t / 2, t * 0.43, 0, Math.PI * 2);
    e.stroke();
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const x = t / 2 + Math.cos(a) * t * 0.445;
      const y = t / 2 + Math.sin(a) * t * 0.445;
      e.fillStyle = i % 4 === 0 ? "rgba(255,210,120,0.9)" : "rgba(150,180,255,0.6)";
      e.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    e.fillStyle = "rgba(255,200,100,0.55)";
    e.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? 46 : 18;
      const x = t / 2 + Math.cos(a) * r;
      const y = t / 2 + Math.sin(a) * r;
      if (i === 0) e.moveTo(x, y);
      else e.lineTo(x, y);
    }
    e.closePath();
    e.fill();
    etex.update();
  }
  const gmat = new StandardMaterial("arenaMat", scene);
  gmat.diffuseTexture = gtex;
  gmat.emissiveTexture = etex;
  gmat.specularColor = new Color3(0.12, 0.12, 0.18);
  ground.material = gmat;
  ground.freezeWorldMatrix();
  // 星空穹頂（1 個網格、不吃光、不受霧影響）
  {
    const sky = MeshBuilder.CreateSphere("sky", { diameter: 100, segments: 12, sideOrientation: Mesh.BACKSIDE }, scene);
    darkSky = sky;
    const st = new DynamicTexture("skyTex", { width: 1024, height: 512 }, scene, true);
    const c = st.getContext() as unknown as CanvasRenderingContext2D;
    const g = c.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, "#05061a");
    g.addColorStop(0.45, "#141a44");
    g.addColorStop(0.62, "#3a2f6a");
    g.addColorStop(1, "#0b0d24");
    c.fillStyle = g;
    c.fillRect(0, 0, 1024, 512);
    for (let i = 0; i < 700; i++) {
      const y = Math.random() * 300;
      c.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.75})`;
      const r = Math.random() < 0.06 ? 2 : 1;
      c.fillRect(Math.random() * 1024, y, r, r);
    }
    st.update();
    const sm = new StandardMaterial("skyMat", scene);
    sm.emissiveTexture = st;
    sm.disableLighting = true;
    sm.fogEnabled = false;
    sky.material = sm;
    sky.isPickable = false;
    sky.infiniteDistance = true;
    sky.applyFog = false;
  }
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
    darkPillars = m;
    if (m) {
      const pm = new StandardMaterial("pillarMat", scene);
      pm.diffuseColor = new Color3(0.5, 0.52, 0.66);
      pm.emissiveColor = new Color3(0.06, 0.07, 0.14);
      pm.specularColor = new Color3(0.1, 0.1, 0.12);
      m.material = pm;
      m.isPickable = false;
      m.freezeWorldMatrix();
    }
  }

  // ---------------------------------------------------------------- 白天草地（接近星芽原野：亮草地、藍天、花），測試白天特效辨識度
  const meadow: Mesh[] = [];
  {
    const g2 = MeshBuilder.CreateDisc("meadowGround", { radius: 40, tessellation: 64 }, scene);
    g2.rotation.x = Math.PI / 2;
    g2.isPickable = false;
    const t = new DynamicTexture("meadowTex", { width: 1024, height: 1024 }, scene, true);
    const c = t.getContext() as unknown as CanvasRenderingContext2D;
    c.fillStyle = "#7cc25a";
    c.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 9000; i++) {
      const g = 120 + Math.random() * 90;
      c.fillStyle = `rgba(${60 + Math.random() * 50},${g},${40 + Math.random() * 30},${0.25 + Math.random() * 0.35})`;
      c.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 5 + Math.random() * 6);
    }
    const flowers = ["#ffffff", "#ffd8f0", "#fff3a0", "#c9dcff"];
    for (let i = 0; i < 700; i++) {
      c.fillStyle = flowers[i % flowers.length]!;
      c.beginPath();
      c.arc(Math.random() * 1024, Math.random() * 1024, 2 + Math.random() * 2.5, 0, Math.PI * 2);
      c.fill();
    }
    // 圓形練功場（淺土色），對應原野的戰鬥平地
    const gr = c.createRadialGradient(512, 512, 120, 512, 512, 220);
    gr.addColorStop(0, "rgba(214,196,150,0.55)");
    gr.addColorStop(1, "rgba(214,196,150,0)");
    c.fillStyle = gr;
    c.fillRect(0, 0, 1024, 1024);
    t.update();
    t.uScale = 1;
    t.vScale = 1;
    const gm = new StandardMaterial("meadowMat", scene);
    gm.diffuseTexture = t;
    gm.specularColor = new Color3(0.05, 0.05, 0.05);
    g2.material = gm;
    meadow.push(g2);
    const sky2 = MeshBuilder.CreateSphere("meadowSky", { diameter: 160, segments: 12, sideOrientation: Mesh.BACKSIDE }, scene);
    const st = new DynamicTexture("meadowSkyTex", { width: 512, height: 256 }, scene, true);
    const sc = st.getContext() as unknown as CanvasRenderingContext2D;
    const sg = sc.createLinearGradient(0, 0, 0, 256);
    sg.addColorStop(0, "#4f9de8");
    sg.addColorStop(0.45, "#9fd0ff");
    sg.addColorStop(0.6, "#e8f6ff");
    sg.addColorStop(1, "#b9e3a6");
    sc.fillStyle = sg;
    sc.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 14; i++) {
      sc.fillStyle = "rgba(255,255,255,0.7)";
      const x = Math.random() * 512, y = 40 + Math.random() * 60;
      for (let k = 0; k < 5; k++) {
        sc.beginPath();
        sc.arc(x + k * 9, y + Math.sin(k) * 4, 9 + Math.random() * 6, 0, Math.PI * 2);
        sc.fill();
      }
    }
    st.update();
    const sm2 = new StandardMaterial("meadowSkyMat", scene);
    sm2.emissiveTexture = st;
    sm2.disableLighting = true;
    sm2.fogEnabled = false;
    sky2.material = sm2;
    sky2.isPickable = false;
    sky2.infiniteDistance = true;
    meadow.push(sky2);
    // 樹叢（遠景，合併成 1 個網格）
    const bushes: Mesh[] = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + Math.random() * 0.2;
      const b = MeshBuilder.CreateSphere(`bush${i}`, { diameter: 3 + Math.random() * 2, segments: 6 }, scene);
      b.position.set(Math.cos(a) * (20 + Math.random() * 5), 0.8, Math.sin(a) * (20 + Math.random() * 5));
      b.scaling.y = 0.7;
      bushes.push(b);
    }
    const bm = Mesh.MergeMeshes(bushes, true, true);
    if (bm) {
      const mm = new StandardMaterial("bushMat", scene);
      mm.diffuseColor = new Color3(0.28, 0.55, 0.25);
      mm.specularColor = Color3.Black();
      bm.material = mm;
      bm.isPickable = false;
      meadow.push(bm);
    }
  }
  // ---------------------------------------------------------------- 岩石（不可通行地形：技能根運動、突進、跳躍落點、擊退都會被擋住）
  const ROCKS: CircleObstacle[] = [
    { x: 3.4, z: -1.6, r: 0.75 },
    { x: -3.8, z: -2.4, r: 0.85 },
    { x: 0.6, z: -5.2, r: 0.95 },
  ];
  const terrain = new ArenaTerrain(15.4, ROCKS);
  {
    const parts: Mesh[] = [];
    for (const [i, r] of ROCKS.entries()) {
      const m = MeshBuilder.CreatePolyhedron(`rock${i}`, { type: 2, size: r.r * 0.78 }, scene);
      m.position.set(r.x, r.r * 0.45, r.z);
      m.scaling.set(1.15, 0.85, 1.05);
      m.rotation.set(0.3 * i, 0.7 * i, 0.2);
      parts.push(m);
    }
    const rm = Mesh.MergeMeshes(parts, true, true);
    if (rm) {
      const mat = new StandardMaterial("rockMat", scene);
      mat.diffuseColor = new Color3(0.56, 0.55, 0.62);
      mat.specularColor = new Color3(0.08, 0.08, 0.1);
      rm.material = mat;
      rm.isPickable = false;
      rm.freezeWorldMatrix();
    }
  }
  const applyEnv = (e: "dark" | "meadow"): void => {
    envName = e;
    const bright = e === "meadow";
    for (const m of meadow) m.setEnabled(bright);
    ground.setEnabled(!bright);
    darkSky?.setEnabled(!bright);
    darkPillars?.setEnabled(!bright);
    scene.clearColor = bright ? new Color4(0.62, 0.8, 1, 1) : new Color4(0.06, 0.07, 0.17, 1);
    scene.fogColor = bright ? new Color3(0.78, 0.9, 1) : new Color3(0.08, 0.09, 0.2);
    scene.fogDensity = bright ? 0.008 : 0.022;
    hemi.intensity = bright ? 1.0 : 0.9;
    hemi.diffuse = bright ? new Color3(1, 1, 1) : new Color3(0.78, 0.82, 1);
    hemi.groundColor = bright ? new Color3(0.45, 0.5, 0.35) : new Color3(0.28, 0.24, 0.4);
    sun.intensity = bright ? 1.45 : 1.2;
  };

  // ---------------------------------------------------------------- 鏡頭
  const cam = new ArcRotateCamera("cam", -Math.PI / 2 - 0.45, 1.12, 6.2, new Vector3(0, 0.8, 0), scene);
  cam.attachControl(canvas, true);
  cam.lowerRadiusLimit = 2.4;   // Stage 3：可以再拉近一點看角色
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
  const screen = new ScreenFx(hudRoot);
  vfx.onCrit = () => screen.flashCrit();
  if (perfLegacy) vfx.remoteSimplify = false;
  applyEnv(envName);
  vfx.setEnvironment(envName === "meadow" ? "bright" : "dark");
  audio.setEnvironment(envName === "meadow" ? "bright" : "dark");
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
    // 一般怪排成弧形（離玩家 5.5～6.5 m），Boss 在後方
    const ang = m.boss ? 0 : (-1.05 + (1.9 * i) / Math.max(1, LAB_MONSTERS.length - 2));
    const dist = m.boss ? 10 : 5.6 + (i % 2) * 0.8;
    const home = new Vector3(Math.sin(ang) * dist, 0, Math.cos(ang) * dist);
    const mon: Mon = {
      idx: i, label: m.spec.label.split(" Rig")[0] ?? m.spec.label, vis, pos: home.clone(), home, yaw: Math.PI + ang, hp: m.hp, maxHp: m.hp,
      radius: m.spec.bodyRadius, state: "idle", stateT: 0, atkCd: 2 + i, atkHitDone: false, flash: 0, opacity: 1, freeze: 0, boss: !!m.boss,
      level: m.level, behaviour: behaviourForLevel(m.level), aggro: { angry: 0 }, moving: false, knock: Vector3.Zero(),
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
    const trail = new WeaponTrail(scene, av.sword.base, av.sword.tip, owner === "self" ? q.trailSegments : Math.max(6, q.trailSegments >> 1), q.trailLife, null, owner !== "self" && !perfLegacy);
    trail.setBright(envName === "meadow");
    return { id, owner, av, pos: av.root.position, trail, tl: null, skill: null, castId: 0, yaw0: 0, start: at.clone(), target: null, trails: [], cds: new Map(), activeTrailEnd: -1, nextAuto: 0, blocked: false };
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
  const cast = (c: Caster, skill: SkillDef, noFace = false): boolean => {
    if (c.tl) return false;
    const now = realTime;
    if ((c.cds.get(skill.id) ?? 0) > now) return false;
    const tgt = c.owner === "self" ? (target && target.state !== "dead" && target.state !== "respawn" ? target : nearestTarget(c)) : c.target ?? nearestTarget(c);
    if (c.owner === "self") target = tgt;
    c.target = tgt;
    const clip = c.av.clip(skill.clip);
    if (!clip) return false;
    if (skill.faceTarget && tgt && !noFace) c.av.yaw = Math.atan2(tgt.pos.x - c.pos.x, tgt.pos.z - c.pos.z);
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
    c.blocked = false;
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
        else {
          if (m.state === "idle") m.vis.onHitReaction({ stagger: 0, recoil: 0, immune: false });
          onDamaged(m.aggro);
          // 怪物受擊反應 V2：依打擊強度往後推（Boss 推得少），之後由地形判定擋住
          const push = m.pos.subtract(center && hit.shape.type === "circle" ? center : c.pos);
          push.y = 0;
          if (push.lengthSquared() < 1e-4) push.copyFrom(facing(c.av.yaw));
          push.normalize();
          const k = Math.min(0.7, 0.12 + hit.shake * 0.75) * (m.boss ? 0.25 : 1) * (r.crit ? 1.3 : 1);
          m.knock.copyFrom(push.scale(k / 0.12));
        }
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
    } else if (list.length) audio.play(hit.sfx, 0.35, panOf(c));
  };

  /** 其他玩家的音效左右位置（依鏡頭右方向） */
  const panOf = (c: Caster): number => {
    const right = cam.getDirection(Vector3.Right());
    const d = c.pos.subtract(player.pos);
    return Math.max(-0.8, Math.min(0.8, Vector3.Dot(d, right) / 8));
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
        if (ev.fx === "shockwave" || ev.fx === "dustRing" || ev.fx === "groundCrack" || ev.fx === "debris" || ev.fx === "lightPillar" || ev.fx === "chargeRings") at.y = 0;
        const follow = ev.anchor === "self" && (ev.fx === "magicCircle" || ev.fx === "whirlRing" || ev.fx === "chargeAura" || ev.fx === "groundGlow" || ev.fx === "lightShield" || ev.fx === "healAura" || ev.fx === "buffOrbit") ? c.av.root : undefined;
        vfx.spawn(ev.fx, at, { ...own, palette: ev.palette ?? skill.palette, yaw: c.av.yaw, scale: ev.scale, duration: ev.duration, follow, emitterMesh: ev.anchor === "weapon" ? c.av.weaponRig.focus : undefined });
        break;
      }
      case "sfx":
        if (c.owner === "self") audio.play(ev.sfx);
        else audio.play(ev.sfx, 0.3, panOf(c));
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
      // 先把動作與根運動推到這一格，再處理事件：命中那一格的姿勢、特效位置、傷害數字一致
      const fired = tl.advance(dt);
      c.av.setSkillTime(tl.t);
      const rm = tl.rootMotion();
      const f = facing(c.yaw0);
      // 根運動（突進、跳躍落點）只能走到可通行的位置：被岩石或場地邊界擋住就停下
      const want = c.start.add(f.scale(rm.forward));
      const got = terrain.clampMove({ x: c.pos.x, z: c.pos.z }, { x: want.x, z: want.z }, 0.3);
      if (Math.hypot(got.x - want.x, got.z - want.z) > 0.01) c.blocked = true;
      c.pos.set(got.x, 0, got.z);
      c.av.yaw = c.yaw0 - rm.yaw;
      c.av.root.rotation.y = c.av.yaw;
      c.av.root.computeWorldMatrix(true);
      for (const e of fired) runEvent(c, e.event, e.t, e.end);
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
      const nx = c.pos.x + v.x * dt, nz = c.pos.z + v.z * dt;
      const got = terrain.clampMove({ x: c.pos.x, z: c.pos.z }, { x: nx, z: nz }, 0.3);
      // 擋住時沿障礙物滑動（分軸再試一次）
      if (got.x === c.pos.x && got.z === c.pos.z) {
        const gx = terrain.clampMove({ x: c.pos.x, z: c.pos.z }, { x: nx, z: c.pos.z }, 0.3);
        const gz = terrain.clampMove({ x: gx.x, z: gx.z }, { x: gx.x, z: nz }, 0.3);
        c.pos.set(gz.x, 0, gz.z);
      } else c.pos.set(got.x, 0, got.z);
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
      // 擊退（受擊反應）：速度衰減，地形擋住
      if (m.knock.lengthSquared() > 1e-4 && m.state !== "dead") {
        const nx = m.pos.x + m.knock.x * dt, nz = m.pos.z + m.knock.z * dt;
        const got = terrain.clampMove({ x: m.pos.x, z: m.pos.z }, { x: nx, z: nz }, m.radius * 0.8);
        m.pos.set(got.x, 0, got.z);
        m.knock.scaleInPlace(Math.max(0, 1 - dt * 14));
      }
      m.aggro.angry = Math.max(0, m.aggro.angry - dt);
      if (frozen) {
        m.flash = Math.max(m.flash, 0.6);
      } else if (m.state === "idle") {
        m.atkCd -= dt;
        const d = Vector3.Distance(m.pos, player.pos) - m.radius;
        const fromHome = Vector3.Distance(m.home, player.pos);
        // Lv1～4 被動：被打才反擊；Lv5 以上主動：進入警戒範圍就追擊。離出生點太遠（拴繩 9 m）就放棄回家
        const engage = monAI && wantsTarget(m.level, d, m.aggro, m.boss ? 7 : 4.5) && fromHome < (m.boss ? 12 : 9);
        const reach = m.boss ? 2.2 : 1.5;
        let speed = 0;
        let goal: Vector3 | null = null;
        if (engage) {
          if (d > reach) goal = player.pos;
          const want = Math.atan2(player.pos.x - m.pos.x, player.pos.z - m.pos.z);
          m.yaw += Math.atan2(Math.sin(want - m.yaw), Math.cos(want - m.yaw)) * Math.min(1, dt * 5);
          speed = Math.min(m.vis.spec.locomotion.runNativeMps * 1.1, 2.6);
          if (d <= reach && m.atkCd <= 0) {
            m.state = "attack";
            m.stateT = 0;
            m.atkHitDone = false;
            m.moving = false;
            m.vis.onStateEnter("attack");
          }
        } else if (monAI && Vector3.Distance(m.pos, m.home) > 0.4) {
          goal = m.home;
          speed = Math.max(0.6, m.vis.spec.locomotion.moveNativeMps * 1.6);
        }
        if (m.state === "idle") {
          if (goal) {
            const v = goal.subtract(m.pos);
            v.y = 0;
            const L = v.length();
            if (L > 1e-3) {
              v.scaleInPlace(1 / L);
              if (!engage) m.yaw += Math.atan2(Math.sin(Math.atan2(v.x, v.z) - m.yaw), Math.cos(Math.atan2(v.x, v.z) - m.yaw)) * Math.min(1, dt * 5);
              const step = Math.min(L, speed * dt);
              const got = terrain.clampMove({ x: m.pos.x, z: m.pos.z }, { x: m.pos.x + v.x * step, z: m.pos.z + v.z * step }, m.radius * 0.8);
              m.pos.set(got.x, 0, got.z);
            }
            if (!m.moving) {
              m.moving = true;
              m.vis.onStateEnter("move");
            }
            m.vis.setGroundSpeed(speed);
          } else if (m.moving) {
            m.moving = false;
            m.vis.setGroundSpeed(0);
            m.vis.onStateEnter("idle");
          }
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
            screen.flashHurt();
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
          m.moving = false;
          m.aggro.angry = 0;
          m.knock.setAll(0);
          m.hp = m.maxHp;
          m.vis.setHealth(m.hp, m.maxHp);
          m.pos.copyFrom(m.home);
          m.opacity = 1;
          m.vis.onStateEnter("respawn");
          vfx.spawn("magicCircle", m.pos, { palette: "star", scale: m.boss ? 1.8 : 1, duration: 0.9 });
          vfx.spawn("lightPillar", m.pos, { palette: "star", scale: m.boss ? 1.6 : 0.9, duration: 0.8 });
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
  /**
   * 固定效能場景（4／8／16／32 人比較用）：鏡頭固定、怪物不動、玩家站位固定（8 欄 × 4 排），
   * 人數少時從中間欄交錯填入，讓每個人數的前後排比例一致。
   */
  let perfFixed = false;
  let perfCast = false;
  let perfCastN = 0;
  const PERF_COLS = [3, 4, 1, 6, 2, 5, 0, 7];
  const PERF_ROWS = [0, 3, 8, 11];
  const PERF_CAM = { pos: new Vector3(0, 5, -8), target: new Vector3(0, 0.8, 5) };
  const perfSlot = (i: number): Vector3 => {
    const row = PERF_ROWS[i % 4] ?? 0;
    const col = PERF_COLS[Math.floor(i / 4) % 8] ?? 0;
    return new Vector3(-5.25 + col * 1.5, 0, row);
  };
  const updateLod = (): void => {
    if (perfMode !== "stage3") return;
    const cp = cam.position;
    for (const g of ghosts) {
      const d = Vector3.Distance(cp, g.pos);
      if (!g.av.far && d > LOD_FAR_M) g.av.setFar(true);
      else if (g.av.far && d < LOD_NEAR_M) g.av.setFar(false);
    }
  };
  const lodCounts = () => {
    let visible = 0, near = 0, far = 0, ghostTris = 0;
    for (const g of ghosts) {
      const m = g.av.meshes.find((x) => x.isEnabled() && x.isVisible && !x.name.startsWith("face"));
      if (m && cam.isInFrustum(m)) visible++;
      if (g.av.far) far++;
      else near++;
      ghostTris += g.av.triangles;
    }
    return { visiblePlayers: visible + (cam.isInFrustum(player.av.meshes[0]!) ? 1 : 0), nearPlayers: near, farPlayers: far, ghostTriangles: ghostTris };
  };
  const perfScene = async (n: number, castOn = false): Promise<ReturnType<typeof lodCounts> & { players: number }> => {
    perfFixed = true;
    perfCast = castOn;
    perfCastN = 0;
    monAI = false;
    auto = false;
    if (player.tl) player.tl = null;
    await setMulti(0);
    player.pos.set(0, 0, -2.2);
    player.av.yaw = Math.PI;
    cam.setTarget(PERF_CAM.target.clone());
    cam.setPosition(PERF_CAM.pos.clone());
    await setMulti(Math.max(0, Math.min(32, n - 1)));
    for (const g of ghosts) g.nextAuto = realTime + 0.5 + (ghosts.indexOf(g) % 8) * 0.15;
    updateLod();
    ringN = 0;
    ringI = 0;
    return { players: 1 + ghosts.length, ...lodCounts() };
  };
  const setMulti = async (n: number): Promise<void> => {
    multiN = n;
    while (ghosts.length > n) {
      const g = ghosts.pop()!;
      g.trail.dispose();
      g.av.dispose();
    }
    while (ghosts.length < n) {
      const i = ghosts.length;
      // 圍繞場中央兩圈，避開岩石（固定效能場景則排成 8×4 方陣）
      let at = new Vector3();
      if (perfFixed) at = perfSlot(i);
      else for (let k = 0; k < 12; k++) {
        const ring = 3.2 + 1.4 * Math.floor(i / 8);
        const a = ((i % 8) / 8) * Math.PI * 2 + 0.4 + k * 0.21 + (Math.floor(i / 8) % 2 ? 0.39 : 0);
        at = new Vector3(Math.cos(a) * ring, 0, Math.sin(a) * ring + 2.2);
        if (terrain.canStand(at.x, at.z, 0.4)) break;
      }
      // Stage 2：其他玩家用 remote 合併模型（2 個 draw call）＋簡化武器；&perf=legacy 時用 Stage 1 的 lite 模型做比較
      const g = await makeCaster(`ghost${i}`, "other", i % 2 ? "female" : "male", perfLegacy ? "lite" : "remote", at);
      g.nextAuto = realTime + 0.3 * i;
      if (perfFixed) g.av.yaw = Math.PI;
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
      c.trail = new WeaponTrail(scene, c.av.sword.base, c.av.sword.tip, c.owner === "self" ? VFX_QUALITY[t].trailSegments : Math.max(6, VFX_QUALITY[t].trailSegments >> 1), VFX_QUALITY[t].trailLife, null, c.owner !== "self" && !perfLegacy);
      c.trail.setBright(envName === "meadow");
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
  const MULTI_STEPS = [0, 1, 4, 8, 16, 32];
  hud.multi.addEventListener("click", () => void setMulti(MULTI_STEPS[(MULTI_STEPS.indexOf(multiN) + 1) % MULTI_STEPS.length] ?? 0));
  const setEnv = (e: "dark" | "meadow"): void => {
    applyEnv(e);
    vfx.setEnvironment(e === "meadow" ? "bright" : "dark");
    audio.setEnvironment(e === "meadow" ? "bright" : "dark");
    for (const c of [player, ...ghosts]) c.trail.setBright(e === "meadow");
    hud.env.textContent = e === "meadow" ? "場景 白天草地" : "場景 星夜競技場";
  };
  hud.env.addEventListener("click", () => setEnv(envName === "dark" ? "meadow" : "dark"));
  hud.env.textContent = envName === "meadow" ? "場景 白天草地" : "場景 星夜競技場";
  // 職業特效展示（六大職業共用架構的展示方向；只有畫面，不結算傷害）
  const classQueue: { t: number; step: ClassDemoStep }[] = [];
  const playClassDemo = (id: string): boolean => {
    const prof = CLASS_VFX.find((c) => c.id === id);
    if (!prof) return false;
    for (const step of prof.demo) classQueue.push({ t: realTime + step.at, step: { ...step, palette: step.palette ?? prof.palette } });
    hud.setClassNote(`${prof.label}：${prof.fxFamilies.map((f) => f.name).join("／")}（展示方向，非正式技能）`);
    return true;
  };
  hud.classButtons.forEach((b) => b.addEventListener("click", () => playClassDemo(b.dataset.cls ?? "")));
  // 鏡頭縮放（＋拉近／－拉遠；雙指與滾輪照常可用）。用 Babylon 的慣性位移，動作平順
  const zoomBy = (f: number) => {
    const from = zoomGoal ?? cam.radius;
    zoomGoal = Math.max(cam.lowerRadiusLimit ?? 2.4, Math.min(cam.upperRadiusLimit ?? 16, from * f));
    zoomLast = cam.radius;
  };
  hud.zoomIn.addEventListener("click", () => zoomBy(0.8));
  hud.zoomOut.addEventListener("click", () => zoomBy(1.25));
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

  /** 鏡頭縮放按鈕的目標距離（雙指／滾輪改動時自動放棄） */
  let zoomGoal: number | null = null;
  let zoomLast = 0;
  /** 上一格畫完時的統計（HUD 顯示用） */
  const renderStats = { draws: 0, triangles: 0, activeMeshes: 0 };
  const perfSnapshot = () => {
    const p = perf();
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      ...p,
      players: 1 + ghosts.length,
      activeMeshes: scene.getActiveMeshes().length,
      triangles: Math.round(scene.getActiveIndices() / 3),
      particles: vfx.stats.particles,
      meshFx: vfx.stats.meshFx,
      projectiles: vfx.stats.projectiles,
      materials: scene.materials.length,
      textures: scene.textures.length,
      meshes: scene.meshes.length,
      hudDraws: renderStats.draws,
      hudTriangles: renderStats.triangles,
      jsHeapMB: mem ? Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10 : null,
      perfMode,
      ...lodCounts(),
      lodFarM: LOD_FAR_M,
      viewport: [engine.getRenderWidth(), engine.getRenderHeight()],
    };
  };
  const perf = () => {
    const n = Math.min(ringN, ring.length);
    const arr = Array.from(ring.subarray(0, n)).sort((a, b) => b - a);
    const k = Math.max(1, Math.floor(n * 0.01));
    const worst = arr.slice(0, k);
    const avgMs = n ? arr.reduce((a, b) => a + b, 0) / n : 0;
    const lowMs = worst.length ? worst.reduce((a, b) => a + b, 0) / worst.length : 0;
    return { fps: fpsShown, avg10s: avgMs ? 1000 / avgMs : 0, low1: lowMs ? 1000 / lowMs : 0, draws: Math.round(instr.drawCallsCounter.lastSecAverage || instr.drawCallsCounter.current), frames: n };
  };

  // &manual=1：固定步長（自動測試用；CI 沒有 GPU，用 1/60 秒一步算出真正 60 fps 的畫面序列）
  const manual = qs.get("manual") === "1";
  if (manual) scene.useConstantAnimationDeltaTime = true;
  const frame = (raw: number): void => {
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
    for (const [gi, g] of ghosts.entries()) {
      if (perfFixed) {
        // 固定效能場景：施放完回到原位、面向鏡頭；技能依序輪替（每次結果一致）
        if (!g.tl) {
          g.pos.copyFrom(perfSlot(gi));
          g.av.yaw = Math.PI;
          if (perfCast && realTime >= g.nextAuto) {
            const s = SKILLS[(gi + perfCastN++) % SKILLS.length]!;
            g.target = nearestTarget(g);
            cast(g, s, true);
            g.nextAuto = realTime + 1.2;
          }
        }
        updateCaster(g, dt, null);
        continue;
      }
      if (!g.tl && realTime >= g.nextAuto) {
        const s = SKILLS[Math.floor(Math.random() * SKILLS.length)]!;
        g.target = nearestTarget(g);
        if (cast(g, s)) g.nextAuto = realTime + 0.6 + Math.random() * 1.2;
        else g.nextAuto = realTime + 0.3;
      }
      updateCaster(g, dt, null);
    }
    for (let i = classQueue.length - 1; i >= 0; i--) {
      const q = classQueue[i]!;
      if (realTime < q.t) continue;
      classQueue.splice(i, 1);
      const st = q.step;
      const f = facing(player.av.yaw);
      const at = st.anchor === "front" ? player.pos.add(f.scale(st.forward ?? 0.6)).addInPlaceFromFloats(0, 0.55, 0) : st.anchor === "target" && target ? target.pos.clone() : player.pos.clone();
      if (st.fx === "shockwave" || st.fx === "dustRing" || st.fx === "groundCrack" || st.fx === "lightPillar" || st.fx === "magicCircleBig" || st.fx === "magicCircle") at.y = 0;
      vfx.spawn(st.fx, at, { owner: "self", palette: st.palette, yaw: player.av.yaw, scale: st.scale, duration: st.duration, follow: st.follow ? player.av.root : undefined });
    }
    updateProjectiles();
    updateMons(dt);
    vfx.update(dt);
    dmg.update(dt);
    screen.update(dt);
    // 鏡頭跟隨＋震動（固定效能場景時鏡頭不動）
    if (!perfFixed) {
      const want = player.pos.add(new Vector3(0, 0.75, 0));
      Vector3.LerpToRef(cam.target, want, Math.min(1, dt * 8), cam.target);
      cam.target.addInPlace(camfx.update(dt, cam).scale(0.6));
    }
    if (zoomGoal !== null) {
      if (Math.abs(cam.radius - zoomLast) > 1e-3) zoomGoal = null;
      else {
        cam.radius += (zoomGoal - cam.radius) * Math.min(1, dt * 10);
        if (Math.abs(zoomGoal - cam.radius) < 0.01) {
          cam.radius = zoomGoal;
          zoomGoal = null;
        }
        zoomLast = cam.radius;
      }
    }
    updateLod();
    // HUD
    const p = perf();
    const triK = (renderStats.triangles / 1000).toFixed(renderStats.triangles < 10000 ? 1 : 0);
    hud.setPerf(
      `FPS ${p.fps.toFixed(0)}｜平均 ${p.avg10s.toFixed(1)}｜1% Low ${p.low1.toFixed(1)}`,
      `Combat VFX Lab（技術展示，非正式技能／數值）｜點此收合\n` +
        `FPS ${p.fps.toFixed(0)}｜10 秒平均 ${p.avg10s.toFixed(1)}｜1% Low ${p.low1.toFixed(1)}\n` +
        `Draw ${renderStats.draws}｜三角面 ${triK}k｜網格 ${renderStats.activeMeshes}｜粒子 ${vfx.stats.particles}｜特效 ${vfx.stats.meshFx}＋投射 ${vfx.stats.projectiles}\n` +
        `預算 ${vfx.budget.stats.active}/${VFX_QUALITY[tier].maxActiveEffects}｜拒絕 ${vfx.budget.stats.denied}｜品質 ${VFX_QUALITY[tier].label}｜攻速 ${clampAttackSpeed(aspd)}${aspd > 160 ? "（上限）" : ""}\n` +
        `玩家 ${1 + ghosts.length}（遠距離 ${ghosts.filter((g) => g.av.far).length}）｜鏡頭距離 ${cam.radius.toFixed(1)} m`,
    );
    hud.setSkills(SKILLS.map((s) => Math.max(0, (player.cds.get(s.id) ?? 0) - realTime)), player.skill?.id ?? null);
    hud.setTarget(target ? `${target.label}　HP ${Math.ceil(target.hp)} / ${target.maxHp}` : "目標：無（自動選最近的怪物）", target ? target.hp / target.maxHp : 0);
  };
  // Stage 3 修正：Draw Call／三角面要在「畫完之後」讀（畫面更新前讀會拿到剛歸零的計數 → 顯示 0）
  scene.onAfterRenderObservable.add(() => {
    renderStats.draws = instr.drawCallsCounter.current;
    renderStats.triangles = Math.round(scene.getActiveIndices() / 3);
    renderStats.activeMeshes = scene.getActiveMeshes().length;
  });
  // 特效預熱（Stage 3.1）：每種特效先生成一次、等 shader 編譯完 → 第一次施放不卡頓（改善 1% Low）。&prewarm=0 可關掉比較
  const shaderCount = (): number => Object.keys((engine as unknown as { _compiledEffects?: Record<string, unknown> })._compiledEffects ?? {}).length;
  const prewarmOn = qs.get("prewarm") !== "0";
  let prewarmStats: { ms: number; spawned: number; timeouts: number; materials: number; meshes: number; systems: number; shadersBefore: number; shadersAfter: number } | null = null;
  if (prewarmOn) {
    const before = shaderCount();
    const at = player.pos.add(new Vector3(0, 0, 2.5));
    // 整體最多 8 秒（再慢也不擋開機）
    const r = await Promise.race([
      vfx.prewarm(at, FX_KEY_LIST, ["steel"]),
      new Promise<{ ms: number; spawned: number; timeouts: number; materials: number; meshes: number; systems: number }>((res) => setTimeout(() => res({ ms: 8000, spawned: -1, timeouts: -1, materials: 0, meshes: 0, systems: 0 }), 8000)),
    ]);
    vfx.cancelPrewarm();
    vfx.clear();
    prewarmStats = { ...r, shadersBefore: before, shadersAfter: shaderCount() };
  }
  if (!manual) {
    scene.onBeforeRenderObservable.add(() => frame(engine.getDeltaTime() / 1000));
    engine.runRenderLoop(() => scene.render());
  } else scene.render();
  // 直向／橫向切換：iOS Safari 旋轉後 resize 有時晚到，三種事件都接
  const onResize = () => engine.resize();
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", () => window.setTimeout(onResize, 250));
  window.visualViewport?.addEventListener("resize", onResize);

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
    /** 測試：用目前朝向施放（不自動轉向目標） */
    castNoFace: (id: string) => {
      const s = SKILLS.find((x) => x.id === id);
      return s ? cast(player, s, true) : false;
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
    perfSnapshot,
    perfScene,
    perfMode,
    /** 測試：已編譯的 shader 數、預熱結果 */
    shaderCount,
    prewarm: () => prewarmStats,
    /** 測試：鏡頭距離、HUD 的開發者選單 */
    camRadius: () => cam.radius,
    setDevMenu: (on: boolean) => hud.setDev(on),
    /** 測試：結束固定效能場景，回到一般模式 */
    /** 除錯：第一位遠距離其他玩家的網格狀態 */
    lodDebug: () => {
      const g = ghosts.find((x) => x.av.far) ?? ghosts[0];
      if (!g) return null;
      return {
        toggle: CombatAvatar.lodToggle,
        far: g.av.far,
        meshes: g.av.meshes.map((m) => {
          const bb = m.getBoundingInfo().boundingBox;
          return {
            name: m.name, enabled: m.isEnabled(), visible: m.isVisible, ready: m.isReady(), verts: m.getTotalVertices(), indices: m.getTotalIndices(),
            subMeshes: m.subMeshes?.map((sm) => [sm.verticesStart, sm.verticesCount, sm.indexStart, sm.indexCount]),
            inFrustum: cam.isInFrustum(m), active: scene.getActiveMeshes().data.includes(m),
            bbMin: bb.minimumWorld.asArray().map((v) => +v.toFixed(2)), bbMax: bb.maximumWorld.asArray().map((v) => +v.toFixed(2)),
            abs: m.getAbsolutePosition().asArray().map((v) => +v.toFixed(2)), parent: m.parent?.name ?? null,
            skeleton: m.skeleton?.name ?? null, material: m.material?.name ?? null, visibility: m.visibility,
          };
        }),
      };
    },
    perfSceneEnd: async () => {
      perfFixed = false;
      perfCast = false;
      await setMulti(0);
    },
    setEnv,
    env: () => envName,
    classDemo: (id: string) => playClassDemo(id),
    classes: CLASS_VFX.map((c) => c.id),
    setMonsterAI: (on: boolean) => {
      monAI = on;
    },
    rocks: ROCKS,
    canStand: (x: number, z: number) => terrain.canStand(x, z, 0.3),
    blocked: () => player.blocked,
    setYaw: (y: number) => {
      player.av.yaw = y;
    },
    /** 測試：讓目標強制為指定怪物（例：測被動怪被打才反擊） */
    targetMonster: (idx: number) => {
      const m = mons.find((x) => x.idx === idx);
      if (m) target = m;
      return !!m;
    },
    debugFx: () => vfx.debugActive(),
    /** 測試：離線算出音效波形，回傳音量統計與 WAV（base64） */
    sfxKeys: SFX_KEYS,
    renderSfx: async (key: string, env: "dark" | "bright" = "dark") => {
      const r = await renderSfxOffline(key as (typeof SFX_KEYS)[number], env);
      const wav = encodeWav(r.left, r.right);
      let bin = "";
      for (let i = 0; i < wav.length; i += 0x8000) bin += String.fromCharCode(...wav.subarray(i, i + 0x8000));
      return { key, env, peak: r.peak, rms: r.rms, activeSec: r.activeSec, samples: r.left.length, wav: btoa(bin) };
    },
    stats: () => ({
      tier,
      gender,
      monsters: mons.map((m) => ({ idx: m.idx, label: m.label, level: m.level, behaviour: m.behaviour, angry: m.aggro.angry, moving: m.moving, hp: m.hp, state: m.state, pos: [m.pos.x, m.pos.z], home: [m.home.x, m.home.z], check: m.vis.asset?.check })),
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
    /** 鏡頭擺到「玩家→最近目標」的側前方 theta 弧度（展示截圖用） */
    view: (theta = 1.15, radius = 5.2) => {
      const t = nearestTarget(player);
      const dx = t ? t.pos.x - player.pos.x : 0;
      const dz = t ? t.pos.z - player.pos.z : 1;
      const L = Math.hypot(dx, dz) || 1;
      const fx = dx / L, fz = dz / L;
      const cx = fx * Math.cos(theta) - fz * Math.sin(theta);
      const cz = fx * Math.sin(theta) + fz * Math.cos(theta);
      cam.alpha = Math.atan2(cz, cx);
      cam.beta = 1.18;
      cam.radius = radius;
      cam.target.copyFrom(player.pos.add(new Vector3(fx * 0.8, 0.75, fz * 0.8)));
    },
    /** 固定步長前進 sec 秒（每步 1/60 秒並繪製一次；只在 &manual=1） */
    advance: (sec: number) => {
      const n = Math.max(1, Math.round(sec * 60));
      for (let i = 0; i < n; i++) {
        frame(1 / 60);
        scene.render();
      }
      return realTime;
    },
    time: () => realTime,
    manual,
    nearest: () => {
      const t = nearestTarget(player);
      return t ? { label: t.label, d: Vector3.Distance(t.pos, player.pos) - t.radius } : null;
    },
  };
}

// ---------------------------------------------------------------- HUD（DOM）
/**
 * 技術展示頁的 HUD（不是正式遊戲 HUD；正式介面由 Claude A 統一整合）。
 * Stage 3 版面：
 *   - 左上：精簡效能列（1 行；點一下展開詳細數字）
 *   - 右上：「⚙ 開發者」按鈕 → 可展開／收合的選單（畫質、角色、音效、震動、頓幀、自動示範、多人、場景、攻速、職業特效、說明）
 *   - 上方中間：目標血條（在效能列下方，不被遮住）
 *   - 左下：搖桿；右下：6 個技能；技能上方：鏡頭拉近／拉遠
 *   - 直向、橫向都可用；四周都留 iPhone Safe Area（env(safe-area-inset-*)）
 *   - 一般移動沒有跳躍鍵；跳躍只在技能動作內
 */
function buildHud(root: HTMLElement) {
  const st = document.createElement("style");
  st.textContent = `
  .cv-hud{--sl:env(safe-area-inset-left,0px);--sr:env(safe-area-inset-right,0px);--st:env(safe-area-inset-top,0px);--sb:env(safe-area-inset-bottom,0px);--sk:60px;--joy:116px;
    position:fixed;left:0;top:var(--vvt,0px);width:100%;height:var(--vvh,100%);overflow:hidden;pointer-events:none;font-family:system-ui,"PingFang TC",sans-serif;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
  .cv-hud>*{pointer-events:auto}
  .cv-perf{position:absolute;left:calc(6px + var(--sl));top:calc(6px + var(--st));max-width:calc(100vw - 120px - var(--sl) - var(--sr));z-index:9;
    background:rgba(16,20,42,.5);color:#e8eeff;border-radius:7px;padding:2px 7px;font:10px/1.5 ui-monospace,Menlo,monospace;white-space:pre;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
  .cv-perf.open{background:rgba(16,20,42,.72);white-space:pre-wrap}
  .cv-devbtn{position:absolute;right:calc(6px + var(--sr));top:calc(6px + var(--st));z-index:21;height:30px;padding:0 10px;border-radius:15px;border:1px solid rgba(255,230,160,.55);
    background:rgba(30,40,80,.78);color:#fff;font:12px system-ui,"PingFang TC",sans-serif}
  .cv-devbtn.on{background:linear-gradient(#ffd77a,#e8a83c);color:#3a2300;font-weight:700}
  .cv-dev{position:absolute;right:calc(6px + var(--sr));top:calc(42px + var(--st));z-index:20;width:min(320px,calc(100vw - 12px - var(--sl) - var(--sr)));
    max-height:calc(100% - 52px - var(--st) - var(--sb));overflow-x:hidden;overflow-y:auto;touch-action:pan-y;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;box-sizing:border-box;
    background:rgba(16,20,42,.9);border:1px solid rgba(255,230,160,.35);border-radius:12px;padding:8px;color:#eef3ff;font:12px/1.4 system-ui,"PingFang TC",sans-serif;display:none}
  .cv-dev.open{display:block}
  .cv-dev h4{margin:6px 2px 4px;font-size:11px;color:#ffe9a8;font-weight:700}
  .cv-dev h4:first-child{margin-top:0}
  .cv-row{display:flex;flex-wrap:wrap;gap:5px}
  .cv-btn{background:rgba(30,40,80,.85);color:#fff;border:1px solid rgba(255,230,160,.45);border-radius:8px;padding:6px 9px;font:12px system-ui,"PingFang TC",sans-serif;min-height:30px}
  .cv-btn.on{background:linear-gradient(#ffd77a,#e8a83c);color:#3a2300;border-color:#fff2c2;font-weight:700}
  .cv-aspd{display:flex;align-items:center;gap:6px;width:100%}.cv-aspd input{flex:1}
  .cv-help{opacity:.85;font-size:11px;margin:2px;white-space:normal;overflow-wrap:anywhere;flex:1 1 100%;min-width:0}
  .cv-dev details{margin-top:6px}.cv-dev summary{cursor:pointer;color:#ffe9a8;font-size:11px;font-weight:700;padding:4px 2px;list-style:none}
  .cv-dev summary::-webkit-details-marker{display:none}.cv-dev summary::before{content:"▸ "}.cv-dev details[open] summary::before{content:"▾ "}
  .cv-target{position:absolute;left:50%;transform:translateX(-50%);top:var(--tgt-top,calc(42px + var(--st)));z-index:8;background:rgba(20,24,48,.55);color:#fff;border-radius:8px;padding:2px 10px 4px;
    font:11px system-ui,"PingFang TC",sans-serif;width:max-content;max-width:calc(100vw - 150px - var(--sl) - var(--sr));min-width:150px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
  .cv-hp{height:4px;background:#422;border-radius:3px;margin-top:2px;overflow:hidden}.cv-hp>div{height:100%;background:linear-gradient(90deg,#ff6b7d,#ffb36b)}
  .cv-clsnote{position:absolute;left:50%;transform:translateX(-50%);top:calc(var(--tgt-top,calc(42px + var(--st))) + 34px);z-index:8;max-width:calc(100vw - 24px - var(--sl) - var(--sr));color:#ffe9a8;
    font:11px system-ui,"PingFang TC";text-shadow:0 1px 2px #000;opacity:0;transition:opacity .3s;text-align:center;pointer-events:none}
  .cv-skills{position:absolute;right:calc(10px + var(--sr));bottom:calc(12px + var(--sb));display:grid;grid-template-columns:repeat(3,var(--sk));gap:8px;z-index:8}
  .cv-skill{position:relative;width:var(--sk);height:var(--sk);padding:0;border-radius:50%;border:2px solid #ffe3a0;background:radial-gradient(circle at 35% 30%,#7fa8ff,#283a8a 70%);color:#fff;
    font:700 12px/1.1 system-ui,"PingFang TC",sans-serif;text-shadow:0 1px 2px #000;box-shadow:0 3px 8px rgba(0,0,0,.35),inset 0 0 10px rgba(255,255,255,.35);touch-action:none;overflow:hidden}
  .cv-skill .cd{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-size:15px}
  .cv-skill.active{box-shadow:0 0 14px 4px rgba(255,220,120,.9)}
  .cv-zoom{position:absolute;right:calc(10px + var(--sr));bottom:calc(12px + var(--sb) + var(--sk) * 2 + 18px);z-index:8;display:flex;gap:6px}
  .cv-zoom button{width:38px;height:38px;border-radius:50%;border:1px solid rgba(255,255,255,.55);background:rgba(20,26,56,.6);color:#fff;font:700 20px/1 system-ui;padding:0}
  .cv-joy{position:absolute;left:calc(16px + var(--sl));bottom:calc(16px + var(--sb));width:var(--joy);height:var(--joy);border-radius:50%;background:rgba(255,255,255,.14);border:2px solid rgba(255,255,255,.35);z-index:8;touch-action:none}
  .cv-knob{position:absolute;left:calc(50% - 22px);top:calc(50% - 22px);width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.75);pointer-events:none}
  /* 窄螢幕（iPhone 直向）：按鈕略小，搖桿與技能區不會重疊 */
  @media (max-width:430px){.cv-hud{--sk:54px;--joy:104px}.cv-skills{gap:7px}}
  /* 矮螢幕（iPhone 橫向）：目標血條往上，技能略小 */
  @media (max-height:430px){.cv-hud{--sk:56px;--joy:108px}}
  `;
  document.head.appendChild(st);
  const hudEl = document.createElement("div");
  hudEl.className = "cv-hud";
  const stop = (el: HTMLElement) => {
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    el.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    el.addEventListener("touchmove", (e) => e.stopPropagation(), { passive: true });
  };
  // 效能列
  const perf = document.createElement("div");
  perf.className = "cv-perf";
  perf.dataset.perf = "1";
  stop(perf);
  let perfOpen = false;
  let perfShort = "";
  let perfLong = "";
  perf.addEventListener("click", () => {
    perfOpen = !perfOpen;
    perf.classList.toggle("open", perfOpen);
    perf.textContent = perfOpen ? perfLong : perfShort;
  });
  // 開發者選單
  const devBtn = document.createElement("button");
  devBtn.className = "cv-devbtn";
  devBtn.textContent = "⚙ 測試設定";
  devBtn.dataset.dev = "toggle";
  stop(devBtn);
  const dev = document.createElement("div");
  dev.className = "cv-dev";
  dev.dataset.dev = "menu";
  stop(dev);
  const setDev = (on: boolean) => {
    dev.classList.toggle("open", on);
    devBtn.classList.toggle("on", on);
    devBtn.textContent = on ? "✕ 收合設定" : "⚙ 測試設定";
  };
  devBtn.addEventListener("click", () => setDev(!dev.classList.contains("open")));
  const section = (t: string) => {
    const h = document.createElement("h4");
    h.textContent = t;
    const row = document.createElement("div");
    row.className = "cv-row";
    dev.append(h, row);
    return row;
  };
  const mk = (row: HTMLElement, t: string) => {
    const b = document.createElement("button");
    b.className = "cv-btn";
    b.textContent = t;
    row.appendChild(b);
    return b;
  };
  const rQ = section("特效畫質");
  const tierButtons = (["high", "medium", "low"] as const).map((t) => {
    const b = mk(rQ, `特效 ${VFX_QUALITY[t].label}`);
    b.dataset.tier = t;
    return b;
  });
  const rC = section("角色與回饋");
  const gender = mk(rC, "男");
  const sound = mk(rC, "音效 開");
  const shake = mk(rC, "震動 開");
  const hitstop = mk(rC, "頓幀 開");
  const rT = section("測試場景");
  const auto = mk(rT, "自動示範 關");
  const multi = mk(rT, "多人 0");
  const env = mk(rT, "場景 星夜競技場");
  const rA = section("攻擊速度（上限 160）");
  const aspdWrap = document.createElement("label");
  aspdWrap.className = "cv-aspd";
  const aspdLabel = document.createElement("span");
  aspdLabel.textContent = "攻速";
  const aspd = document.createElement("input");
  aspd.type = "range";
  aspd.min = "100";
  aspd.max = "200";
  aspd.step = "10";
  aspdWrap.append(aspdLabel, aspd);
  rA.appendChild(aspdWrap);
  const rK = section("職業特效展示（非正式技能）");
  const classButtons = CLASS_VFX.map((c) => {
    const b = mk(rK, c.label);
    b.dataset.cls = c.id;
    return b;
  });
  // 操作說明：可展開／收合（預設收合）
  const helpBox = document.createElement("details");
  helpBox.dataset.help = "1";
  const helpSum = document.createElement("summary");
  helpSum.textContent = "操作說明";
  const help = document.createElement("div");
  help.className = "cv-help";
  help.textContent = "左下搖桿／WASD 移動（沒有跳躍鍵；跳躍只在技能「跳斬」動作內）｜右下 1～6 施放技能｜拖曳畫面轉鏡頭｜雙指、滾輪或 ＋／－ 縮放鏡頭｜點左上效能列看 Draw Call、三角面等詳細數字";
  helpBox.append(helpSum, help);
  dev.appendChild(helpBox);
  // 目標
  const tgt = document.createElement("div");
  tgt.className = "cv-target";
  const tgtText = document.createElement("div");
  const hp = document.createElement("div");
  hp.className = "cv-hp";
  const hpFill = document.createElement("div");
  hp.appendChild(hpFill);
  tgt.append(tgtText, hp);
  const clsNote = document.createElement("div");
  clsNote.className = "cv-clsnote";
  // 技能
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
  // 鏡頭縮放
  const zoom = document.createElement("div");
  zoom.className = "cv-zoom";
  stop(zoom);
  const zoomIn = document.createElement("button");
  zoomIn.textContent = "＋";
  zoomIn.setAttribute("aria-label", "鏡頭拉近");
  zoomIn.dataset.zoom = "in";
  const zoomOut = document.createElement("button");
  zoomOut.textContent = "－";
  zoomOut.setAttribute("aria-label", "鏡頭拉遠");
  zoomOut.dataset.zoom = "out";
  zoom.append(zoomOut, zoomIn);
  // 搖桿
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
    const k = r.width * 0.32;
    knob.style.transform = `translate(${x * k}px,${y * k}px)`;
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
  hudEl.append(perf, devBtn, dev, tgt, clsNote, zoom, skills, joyEl);
  root.appendChild(hudEl);
  // 目標血條永遠放在效能列與設定按鈕的下方（效能列展開時也不會重疊）
  const placeTarget = () => {
    const h = hudEl.getBoundingClientRect();
    const b = Math.max(perf.getBoundingClientRect().bottom, devBtn.getBoundingClientRect().bottom) - h.top;
    hudEl.style.setProperty("--tgt-top", `${Math.round(b + 6)}px`);
  };
  // 動態 viewport：iPhone Safari 網址列伸縮、App 內嵌瀏覽器（沒有 dvh）都以 visualViewport 為準
  const placeViewport = () => {
    const vv = window.visualViewport;
    hudEl.style.setProperty("--vvh", `${Math.round(vv ? vv.height : window.innerHeight)}px`);
    hudEl.style.setProperty("--vvt", `${Math.round(vv ? vv.offsetTop : 0)}px`);
    placeTarget();
  };
  placeViewport();
  window.addEventListener("resize", placeViewport);
  window.addEventListener("orientationchange", () => window.setTimeout(placeViewport, 250));
  window.visualViewport?.addEventListener("resize", placeViewport);
  window.visualViewport?.addEventListener("scroll", placeViewport);
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(placeTarget).observe(perf);
  // 選單內捲動不得帶動整個頁面
  dev.addEventListener("touchmove", (e) => e.stopPropagation(), { passive: true });
  return {
    tierButtons, gender, sound, shake, hitstop, auto, multi, env, aspd, skillButtons, joystick, classButtons, zoomIn, zoomOut,
    setDev,
    setClassNote(t: string) {
      clsNote.textContent = t;
      clsNote.style.opacity = "1";
    },
    setTier(t: VfxTier) {
      for (const b of tierButtons) b.classList.toggle("on", b.dataset.tier === t);
    },
    /** short：精簡一行；long：展開後的詳細數字 */
    setPerf(short: string, long: string) {
      perfShort = short;
      perfLong = long;
      const s = perfOpen ? long : short;
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
