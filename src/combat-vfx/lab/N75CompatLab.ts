/**
 * 新版男性初心者（A 的 Stage 7.5 n75）× Combat VFX 相容性測試頁（Claude C，只讀 A 的資產，不修改）
 *
 * ?lab=n75compat&lod=lite|hq
 * 資產：CI 建置前從 A 的 feature/render-stage75-novice 唯讀取出 novice_n75_male_{hq,lite}.glb、novice_n75_male.json
 *       （不提交到 C 的分支、不部署）。沒有資產時頁面顯示「未取得」，測試回報 available=false。
 * 角色只播放 A 檔案內原有的動作；武器用 C 的短劍／法杖掛在 A 的 Weapon_R 掛點（+Y 刀身、+Z 手指）。
 * 特效全部經過正式接入模組 CombatFx（與 A、D 接入方式相同）。
 */
import "@babylonjs/loaders/glTF";
import {
  ArcRotateCamera,
  Color3,
  Color4,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  SceneLoader,
  StandardMaterial,
  TransformNode,
  Vector3,
  type AnimationGroup,
} from "@babylonjs/core";
import { GLTFFileLoader, GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF";
import { CombatFx } from "../integration/CombatFx.ts";
import { SKILLS } from "../core/skills.ts";
import type { ClipTiming } from "../core/timeline.ts";
import { buildStaff, buildSword, attachWeapon, setWeaponVisible, type WeaponRig } from "../weapons.ts";

interface N75Meta {
  version: string;
  clips: Record<string, { seconds: number; loop: boolean; marks: Record<string, number | number[]> }>;
  sockets?: { name: string; parent: string; axes: string }[];
}

export async function startN75CompatLab(canvas: HTMLCanvasElement, hudRoot: HTMLElement): Promise<void> {
  const qs = new URLSearchParams(location.search);
  const lod = qs.get("lod") === "hq" ? "hq" : "lite";
  const base = import.meta.env.BASE_URL;
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.1, 0.11, 0.2, 1);
  const cam = new ArcRotateCamera("cam", -Math.PI / 2 - 0.6, 1.2, 4.2, new Vector3(0, 0.8, 0.5), scene);
  cam.minZ = 0.05;
  const hemi = new HemisphericLight("h", new Vector3(0.3, 1, -0.4), scene);
  hemi.intensity = 1.1;
  const ground = MeshBuilder.CreateGround("g", { width: 12, height: 12 }, scene);
  const gm = new StandardMaterial("gm", scene);
  gm.diffuseColor = new Color3(0.35, 0.38, 0.5);
  ground.material = gm;
  const info = document.createElement("div");
  info.style.cssText = "position:absolute;left:8px;top:8px;color:#fff;font:12px system-ui;background:rgba(0,0,0,.5);padding:4px 8px;border-radius:6px;z-index:9";
  hudRoot.appendChild(info);
  const api: Record<string, unknown> = { ready: false, available: false };
  (window as unknown as Record<string, unknown>).__n75 = api;

  const metaRes = await fetch(`${base}models/novice_n75_male.json`, { cache: "no-cache" }).catch(() => null);
  if (!metaRes || !metaRes.ok) {
    info.textContent = "n75 資產未取得（CI 建置時才從 A 的分支唯讀取出）";
    engine.runRenderLoop(() => scene.render());
    api.ready = true;
    return;
  }
  const meta = (await metaRes.json()) as N75Meta;
  const anim = (await (await fetch(`${base}combat-vfx/novice_combat_male.json`)).json()) as { clips: Record<string, ClipTiming> };

  const obs = SceneLoader.OnPluginActivatedObservable.add((p) => {
    if (p instanceof GLTFFileLoader) p.animationStartMode = GLTFLoaderAnimationStartMode.NONE;
  });
  const c = await SceneLoader.LoadAssetContainerAsync(`${base}models/`, `novice_n75_male_${lod}.glb`, scene);
  SceneLoader.OnPluginActivatedObservable.remove(obs);
  c.addAllToScene();
  for (const g of c.animationGroups) g.stop();
  const root = new TransformNode("n75Root", scene);
  for (const r of c.rootNodes) r.parent = root;
  const groups = new Map<string, AnimationGroup>(c.animationGroups.map((g) => [g.name, g]));
  const node = (n: string) => scene.getTransformNodeByName(n);
  const weaponR = node("Weapon_R");
  const weaponL = node("Weapon_L");
  const rHand = node("R_Hand");
  const lHand = node("L_Hand");
  if (!weaponR || !rHand) throw new Error("n75: Weapon_R／R_Hand 掛點不存在");
  // C 的武器掛在 A 的掛點：+Y 刀身／杖身、+Z 手指方向（A 的規格）
  const sword = buildSword(scene, "n75");
  const staff = buildStaff(scene, "n75");
  attachWeapon(sword, weaponR, [0, 1, 0], [0, 0, 1]);
  attachWeapon(staff, weaponR, [0, 1, 0], [0, 0, 1]);
  setWeaponVisible(staff, false);
  // 目標（命中點）：角色正前方 1.3 m、胸口高度
  const targetPoint = new Vector3(0, 0.8, 1.3);
  const dummy = MeshBuilder.CreateCylinder("dummy", { height: 1.4, diameter: 0.6 }, scene);
  dummy.position.set(0, 0.7, 1.3 + 0.3);
  const dm = new StandardMaterial("dm", scene);
  dm.diffuseColor = new Color3(0.7, 0.5, 0.4);
  dm.alpha = 0.55;
  dummy.material = dm;

  const fx = new CombatFx({ scene, camera: cam, hudRoot, tier: (qs.get("q") as "high" | "medium" | "low") ?? "high", audio: false });
  fx.listener.set(0, 0, 0);
  let weapon: WeaponRig = sword;
  const register = (w: WeaponRig) => {
    weapon = w;
    setWeaponVisible(sword, w === sword);
    setWeaponVisible(staff, w === staff);
    fx.register({ id: "me", owner: "self", root, position: () => root.position, yaw: () => root.rotation.y, weaponBase: w.base, weaponTip: w.tip, weaponFocus: w.focus, target: () => targetPoint.clone() });
  };
  register(sword);
  scene.render();
  info.textContent = `n75 ${meta.version} ${lod}｜動作 ${c.animationGroups.length}｜掛點 ${weaponR.name}${weaponL ? "＋" + weaponL.name : ""}｜Combat VFX 相容性測試`;

  const abs = (n: TransformNode) => {
    const chain: TransformNode[] = [];
    for (let p: TransformNode | null = n; p; p = (p.parent as TransformNode | null) ?? null) chain.push(p);
    for (let i = chain.length - 1; i >= 0; i--) chain[i]!.computeWorldMatrix(true);
    return n.getAbsolutePosition().clone();
  };
  const frameOf = (g: AnimationGroup, sec: number, dur: number) => g.from + (Math.min(sec, dur) / dur) * (g.to - g.from);

  /** 武器尖端到身體中心線（水平距離）：太近＝武器穿進身體 */
  const axisDist = (p: Vector3) => Math.hypot(p.x - root.position.x, p.z - root.position.z);
  /** 刀尖在軀幹圓柱內（半徑 0.15 m、高 0.45～1.35 m）＝穿模 */
  const inTorso = (p: Vector3) => axisDist(p) < 0.15 && p.y > 0.45 && p.y < 1.35;

  /**
   * 播一個技能（固定步長 1/60 秒），回傳量測：
   * - trailErrMax：拖尾最新取樣與刀尖實際位置的最大誤差（公尺）
   * - tipJumpMax：拖尾期間刀尖每格最大移動（偵測瞬移／錯位）
   * - hits：每次命中 hook 的 [標記時間, 實際經過秒數, 預期秒數, 該格動作時間, 刀尖到目標距離]
   * - projectiles：投射物發射點到右手的距離
   */
  const run = (skillId: string, rate = 1, stopAt = -1) => {
    const skill = SKILLS.find((s) => s.id === skillId);
    if (!skill) throw new Error(`unknown skill ${skillId}`);
    const clip = anim.clips[skill.clip];
    const g = groups.get(skill.clip);
    const dur = meta.clips[skill.clip]?.seconds ?? clip?.duration ?? 1;
    if (!clip || !g) return { skillId, missing: !g ? "animation" : "clip" };
    register(skill.weapon === "staff" ? staff : sword);
    root.position.set(0, 0, 0);
    root.rotation.y = 0;
    g.start(false, 1, g.from, g.to);
    g.pause();
    const dt = 1 / 60;
    let wall = 0;
    const hits: { mark: number; wall: number; expect: number; animT: number; tipToTarget: number; tipAxis: number }[] = [];
    const pending: { mark: number; wall: number }[] = [];
    const projectiles: { mark: number; fx: string; fromToHand: number }[] = [];
    let trailErrMax = 0;
    let tipJumpMax = 0;
    let chordMax = 0;
    let insideFrames = 0;
    const inside: { t: number; axis: number; y: number }[] = [];
    let trailFrames = 0;
    let prevTip: Vector3 | null = null;
    const h = fx.playSkill("me", skill, clip, rate, {
      onHit: (_hit, t) => pending.push({ mark: t, wall }),
      onProjectile: (ev, vis, t) => {
        const from = vis ? vis.pos.clone() : abs(weapon.focus);
        projectiles.push({ mark: t, fx: ev.fx, fromToHand: Vector3.Distance(from, abs(rHand)) });
      },
    });
    if (!h) return { skillId, missing: "actor" };
    while (!h.done && wall < 10) {
      fx.advance(dt);
      wall += dt;
      const t = h.timeline.t;
      g.goToFrame(frameOf(g, t, dur));
      const rm = h.timeline.rootMotion();
      root.position.set(0, 0, rm.forward);
      root.rotation.y = -rm.yaw;
      fx.updateVisuals(dt);
      const tip = abs(weapon.tip);
      for (const p of pending.splice(0)) {
        const animT = t; // 這一格 A 動作播放到的片段時間（goToFrame 用同一個 t）
        hits.push({ mark: p.mark, wall: p.wall, expect: p.mark / rate, animT, tipToTarget: Vector3.Distance(tip, targetPoint), tipAxis: axisDist(tip) });
      }
      const head = fx.trailHead("me");
      if (head?.emitting) {
        trailFrames++;
        trailErrMax = Math.max(trailErrMax, Vector3.Distance(head.tip, tip));
        if (prevTip) tipJumpMax = Math.max(tipJumpMax, Vector3.Distance(prevTip, tip));
        chordMax = Math.max(chordMax, head.maxChord);
        if (inTorso(tip)) {
          insideFrames++;
          inside.push({ t: +t.toFixed(3), axis: +axisDist(tip).toFixed(3), y: +tip.y.toFixed(3) });
        }
        prevTip = tip;
      } else prevTip = null;
      if (stopAt >= 0 && t >= stopAt) {
        scene.render();
        h.cancel();
        g.stop();
        return { skillId, rate, stopped: t };
      }
    }
    g.stop();
    return { skillId, rate, duration: dur, wall, trailFrames, trailErrMax, tipJumpMax, chordMax, insideFrames, inside, hits, projectiles };
  };

  /** A 的普通攻擊／雙手武器動作：只播 A 的動作＋C 的拖尾（basicSwing），量測刀尖是否穿進身體、左手與握把距離 */
  const runBasic = (clipName: string, weaponKind: "sword" | "staff" = "sword") => {
    const g = groups.get(clipName);
    const m = meta.clips[clipName];
    if (!g || !m) return { clipName, missing: true };
    register(weaponKind === "staff" ? staff : sword);
    root.position.set(0, 0, 0);
    root.rotation.y = 0;
    g.start(false, 1, g.from, g.to);
    g.pause();
    const hitT = typeof m.marks["hit"] === "number" ? (m.marks["hit"] as number) : m.seconds * 0.4;
    fx.basicSwing("me", "steel", Math.min(m.seconds, hitT + 0.15));
    const dt = 1 / 60;
    let trailErrMax = 0;
    let insideFrames = 0;
    let lhandToGripMin = 99;
    let lhandToGripAtHit = -1;
    let tipToTargetAtHit = -1;
    for (let t = 0; t <= m.seconds; t += dt) {
      fx.advance(dt);
      g.goToFrame(frameOf(g, t, m.seconds));
      fx.updateVisuals(dt);
      const tip = abs(weapon.tip);
      const head = fx.trailHead("me");
      if (head?.emitting) trailErrMax = Math.max(trailErrMax, Vector3.Distance(head.tip, tip));
      if (inTorso(tip)) insideFrames++;
      if (lHand) {
        // 左手到握把（武器根部往刀身 0～0.25 m 的線段）的距離
        const b = abs(weapon.base);
        const dir = tip.subtract(b).normalize();
        const lh = abs(lHand);
        const k = Math.max(-0.1, Math.min(0.25, Vector3.Dot(lh.subtract(b), dir)));
        const d = Vector3.Distance(lh, b.add(dir.scale(k)));
        lhandToGripMin = Math.min(lhandToGripMin, d);
        if (Math.abs(t - hitT) < dt / 2 + 1e-6) lhandToGripAtHit = d;
      }
      if (Math.abs(t - hitT) < dt / 2 + 1e-6) tipToTargetAtHit = Vector3.Distance(tip, targetPoint);
    }
    g.stop();
    return { clipName, seconds: m.seconds, hitT, trailErrMax, insideFrames, lhandToGripMin, lhandToGripAtHit, tipToTargetAtHit };
  };

  /** 停在某個時間點畫一格（截圖用） */
  const pose = (skillId: string, t: number) => run(skillId, 1, t);

  /**
   * 重要戰鬥特效（瀏覽器實測）：本地玩家在原點，施放者在 40 m 外、鏡頭背後。
   * 影響自己的範圍提示／投射物／狀態提示要出現；同一位置的裝飾特效照樣被省略。
   */
  const essentialCheck = () => {
    const far = new Vector3(0, 0, -40);
    const s0 = fx.stats();
    const spawned0 = s0.budget.granted;
    fx.spawn("other", "starShards", far, { palette: "azure" });
    const decorCulled = fx.stats().culled.distance + fx.stats().culled.offscreen > s0.culled.distance + s0.culled.offscreen && fx.stats().budget.granted === spawned0;
    const r: Record<string, unknown> = { decorCulled };
    const before = () => fx.stats().budget.granted;
    let b = before();
    r.bossWarning = fx.zone("bossWarning", far, 6) && fx.stats().budget.granted > b;
    b = before();
    r.dangerOnMe = fx.zone("danger", new Vector3(0, 0, -2), 4, { owner: "other" }) && fx.stats().budget.granted > b;
    b = before();
    r.dangerFarAway = fx.zone("danger", far, 4, { owner: "other" }); // 不影響自己 → 依一般規則省略（應為 false）
    b = before();
    r.healOnMe = fx.zone("heal", new Vector3(1, 0, 0), 3, { owner: "other" }) && fx.stats().budget.granted > b;
    b = before();
    r.projectileToMe = !!fx.launch("other", "magicBolt", far, new Vector3(0, 0, 1), 18, "azure", true) && fx.stats().budget.granted >= b;
    r.projectileElsewhere = !!fx.launch("other", "magicBolt", far, new Vector3(1, 0, 0), 18, "azure", false); // 應為 false
    b = before();
    fx.statusCue("shield", root);
    r.statusCue = fx.stats().budget.granted > b;
    r.essentialCount = fx.stats().essential - s0.essential;
    r.budget = fx.stats().budget;
    return r;
  };

  Object.assign(api, {
    essentialCheck,
    available: true,
    version: meta.version,
    lod,
    clips: c.animationGroups.map((g) => g.name),
    sockets: { weaponR: !!weaponR, weaponL: !!weaponL, rHand: !!rHand, lHand: !!lHand },
    marks: Object.fromEntries(Object.entries(meta.clips).filter(([k]) => k.startsWith("Skill_")).map(([k, v]) => [k, v.marks])),
    cMarks: Object.fromEntries(Object.entries(anim.clips).map(([k, v]) => [k, v.marks])),
    skills: SKILLS.map((s) => s.id),
    run,
    runBasic,
    pose,
    stats: () => fx.stats(),
  });
  api.ready = true;
}
