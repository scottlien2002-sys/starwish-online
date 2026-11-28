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
import { buildStaff, buildSword, attachToSocket, setWeaponVisible, type WeaponRig } from "../weapons.ts";
import { DynamicTexture, ParticleSystem, type Material } from "@babylonjs/core";

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
  // A 的規格（Starwish_Novice_N75_Male_Tech_Spec §3）：掛在 Weapon_R，位置 0、旋轉單位、縮放補償掛點世界縮放；法杖不後退
  const sword = buildSword(scene, "n75");
  const staff = buildStaff(scene, "n75");
  attachToSocket(sword, weaponR);
  attachToSocket(staff, weaponR);
  setWeaponVisible(staff, false);
  // 目標（命中點）：角色正前方 1.3 m，腳底＋0.55×身高 1.25 m ≈ 0.69 m（A 的規格 §6）
  const targetPoint = new Vector3(0, 0.69, 1.3);
  const dummy = MeshBuilder.CreateCylinder("dummy", { height: 1.25, diameter: 0.6 }, scene);
  dummy.position.set(0, 0.625, 1.3 + 0.3);
  const dm = new StandardMaterial("dm", scene);
  dm.diffuseColor = new Color3(0.7, 0.5, 0.4);
  dm.alpha = 0.55;
  dummy.material = dm;

  const tier0 = (qs.get("q") as "high" | "medium" | "low") ?? "high";
  const makeFx = (tier: "high" | "medium" | "low") => {
    const f = new CombatFx({ scene, camera: cam, hudRoot, tier, audio: false });
    f.listener.set(0, 0, 0);
    return f;
  };
  let fx = makeFx(tier0);
  let weapon: WeaponRig = sword;
  const register = (w: WeaponRig) => {
    weapon = w;
    setWeaponVisible(sword, w === sword);
    setWeaponVisible(staff, w === staff);
    fx.register({ id: "me", owner: "self", root, position: () => root.position, yaw: () => root.rotation.y, weaponBase: w.base, weaponTip: w.tip, weaponFocus: w.focus, target: () => targetPoint.clone() });
  };
  register(sword);

  // 正式接入順序（A 的回饋 §2）：場景就緒 → 預熱 → 開始遊戲迴圈
  let frames = 0;
  scene.onAfterRenderObservable.add(() => frames++);
  // &order=prewarm-first：重現 A 遇到的錯誤順序（先預熱再等場景就緒），只記錄結果，最多等 8 秒
  const wrongOrder = qs.get("order") === "prewarm-first";
  const tb = performance.now();
  let prewarmReport;
  let whenReadyOk = true;
  if (wrongOrder) {
    prewarmReport = await fx.prewarm();
    whenReadyOk = await Promise.race([scene.whenReadyAsync().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 8000))]);
  } else {
    await scene.whenReadyAsync();
    prewarmReport = await fx.prewarm();
  }
  const whenReadyMs = Math.round(performance.now() - tb);
  const brokenAfterPrewarm = fx.vfx.brokenTextures();
  const notReady = scene.particleSystems.filter((p) => !p.isReady()).map((p) => p.name).slice(0, 12);
  engine.runRenderLoop(() => scene.render());
  const loopStartedAt = performance.now();
  const boot = { order: wrongOrder ? ["prewarm", "whenReadyAsync", "runRenderLoop"] : ["whenReadyAsync", "prewarm", "runRenderLoop"], whenReadyMs, whenReadyOk, notReady, prewarm: prewarmReport, brokenAfterPrewarm, loopStartedAt };
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
   * 武器與角色網格的實際接觸（CPU 蒙皮後的頂點）：刀身／杖身線段（握把 0.15 m 以外到尖端）1.5 cm 內的角色頂點數，
   * 排除左右手掌 12 cm 內（握持本來就會碰到）。>0＝武器碰到或穿進身體、頭、衣服。
   */
  const body = c.meshes.find((m) => m.getTotalVertices() > 0 && !!m.skeleton) as import("@babylonjs/core").Mesh | undefined;
  const segDist = (v: Vector3, a: Vector3, b: Vector3) => {
    const ab = b.subtract(a);
    const k = Math.max(0, Math.min(1, Vector3.Dot(v.subtract(a), ab) / ab.lengthSquared()));
    return Vector3.Distance(v, a.add(ab.scale(k)));
  };
  const contactSeg = (a: Vector3, b: Vector3, radius = 0.015) => {
    if (!body?.skeleton) return { n: 0, region: "" };
    body.skeleton.prepare(true);
    body.computeWorldMatrix(true);
    const pos = body.getPositionData(true, false);
    if (!pos) return { n: 0, region: "" };
    const w = body.getWorldMatrix();
    const hr = abs(rHand);
    const hl = lHand ? abs(lHand) : null;
    const v = new Vector3();
    let n = 0;
    let ySum = 0;
    for (let i = 0; i < pos.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(pos[i]!, pos[i + 1]!, pos[i + 2]!, w, v);
      if (Vector3.Distance(v, hr) < 0.12 || (hl && Vector3.Distance(v, hl) < 0.12)) continue;
      if (segDist(v, a, b) < radius) {
        n++;
        ySum += v.y - root.position.y;
      }
    }
    const y = n ? ySum / n : 0;
    return { n, region: !n ? "" : y > 0.95 ? "頭／兜帽" : y > 0.55 ? "上身／手臂" : "下身／衣襬" };
  };
  const weaponContact = () => {
    const b = abs(weapon.base);
    const t = abs(weapon.tip);
    const a = weapon === staff ? b : Vector3.Lerp(b, t, 0.125); // 短劍：從握把 0.15 m 起算
    return contactSeg(a, t);
  };
  /** 量測方法自我檢查：穿過胸口的線段一定有接觸、遠方線段一定沒有 */
  const contactSanity = () => {
    const chest = abs(node("Spine02")!);
    const through = contactSeg(chest.add(new Vector3(0, 0, -0.4)), chest.add(new Vector3(0, 0, 0.4)));
    const far = contactSeg(new Vector3(3, 1, 3), new Vector3(3.4, 1, 3));
    return { through: through.n, far: far.n };
  };

  /**
   * 播一個技能（固定步長 1/60 秒），回傳量測：
   * - trailErrMax：拖尾最新取樣與刀尖實際位置的最大誤差（公尺）
   * - tipJumpMax：拖尾期間刀尖每格最大移動（偵測瞬移／錯位）
   * - hits：每次命中 hook 的 [標記時間, 實際經過秒數, 預期秒數, 該格動作時間, 刀尖到目標距離]
   * - projectiles：投射物發射點到右手的距離
   */
  const run = (skillId: string, rate = 1, stopAt = -1, ground?: (x: number, z: number) => number) => {
    const skill = SKILLS.find((s) => s.id === skillId);
    if (!skill) throw new Error(`unknown skill ${skillId}`);
    const clip = anim.clips[skill.clip];
    const g = groups.get(skill.clip);
    const dur = meta.clips[skill.clip]?.seconds ?? clip?.duration ?? 1;
    if (!clip || !g) return { skillId, missing: !g ? "animation" : "clip" };
    register(skill.weapon === "staff" ? staff : sword);
    const gy = (x: number, z: number) => (ground ? ground(x, z) : 0);
    root.position.set(0, gy(0, 0), 0);
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
    const inside: { t: number; n: number; region: string }[] = [];
    let trailFrames = 0;
    let prevTip: Vector3 | null = null;
    // 特效生成位置：fromHit＝遊戲呼叫 fx.hit 產生的命中特效；weapon＝技能定義中掛在武器上的特效（到法杖頭／武器發射點的距離）
    const spawns: { key: string; at: Vector3; t: number; fromHit: boolean; toFocus: number }[] = [];
    let inHit = false;
    fx.vfx.onSpawn = (key, at) => spawns.push({ key, at: at.clone(), t: wall, fromHit: inHit, toFocus: Vector3.Distance(at, abs(weapon.focus)) });
    const weaponKeys = new Set(skill.events.filter((e) => e.kind === "fx" && e.anchor === "weapon").map((e) => (e as { fx: string }).fx));
    const h = fx.playSkill("me", skill, clip, rate, {
      // 模擬遊戲：命中時在目標命中點呼叫 fx.hit（不給傷害數字）
      onHit: (_hit, t) => {
        pending.push({ mark: t, wall });
        inHit = true;
        fx.hit(targetPoint, ["hitSpark", "hitFlash"], { owner: "self" });
        inHit = false;
      },
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
      root.position.set(0, gy(0, rm.forward), rm.forward);
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
        const ct = weaponContact();
        if (ct.n > 0) {
          insideFrames++;
          inside.push({ t: +t.toFixed(3), n: ct.n, region: ct.region });
        }
        prevTip = tip;
      } else prevTip = null;
      if (stopAt >= 0 && t >= stopAt) {
        scene.render();
        h.cancel();
        g.stop();
        fx.vfx.onSpawn = null;
        return { skillId, rate, stopped: t };
      }
    }
    g.stop();
    fx.vfx.onSpawn = null;
    // 命中類特效到目標命中點（或其地面投影）的最大距離
    const hitFx = spawns.filter((s) => s.fromHit);
    const hitFxErr = hitFx.reduce((m, s) => Math.max(m, Math.min(Vector3.Distance(s.at, targetPoint), Vector3.Distance(s.at, new Vector3(targetPoint.x, 0, targetPoint.z)))), 0);
    const wfx = spawns.filter((s) => !s.fromHit && weaponKeys.has(s.key));
    const weaponFxErr = wfx.reduce((m, s) => Math.max(m, s.toFocus), 0);
    // 地面特效：高度減去該點地面高度（埋進地底＜0；斜坡上會略高）
    const GROUND = ["shockwave", "dustRing", "groundCrack", "debris", "lightPillar", "chargeRings"];
    const gfx = spawns.filter((s) => GROUND.includes(s.key)).map((s) => ({ key: s.key, dy: +(s.at.y - gy(s.at.x, s.at.z)).toFixed(3) }));
    return { skillId, rate, duration: dur, wall, groundFx: gfx, hitFxCount: hitFx.length, hitFxErr, weaponFxCount: wfx.length, weaponFxErr, trailFrames, trailErrMax, tipJumpMax, chordMax, insideFrames, inside, hits, projectiles };
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
    const inside: { t: number; n: number; region: string }[] = [];
    let lhandToGripMin = 99;
    let lhandToGripAtHit = -1;
    let gripAlongAtHit = NaN;
    let tipToTargetAtHit = -1;
    for (let t = 0; t <= m.seconds; t += dt) {
      fx.advance(dt);
      g.goToFrame(frameOf(g, t, m.seconds));
      fx.updateVisuals(dt);
      const tip = abs(weapon.tip);
      const head = fx.trailHead("me");
      if (head?.emitting) trailErrMax = Math.max(trailErrMax, Vector3.Distance(head.tip, tip));
      const ct = weaponContact();
      if (ct.n > 0) {
        insideFrames++;
        inside.push({ t: +t.toFixed(3), n: ct.n, region: ct.region });
      }
      if (weaponL) {
        // 左手握點（Weapon_L 原點＝左手掌心）沿刀身軸（從 Weapon_R 原點）的位置與離軸距離。A 的規格 §4：雙手劍 −0.10、長柄 +0.28
        const o = abs(weaponR);
        const dir = tip.subtract(o).normalize();
        const lh = abs(weaponL);
        const k = Vector3.Dot(lh.subtract(o), dir);
        const d = Vector3.Distance(lh, o.add(dir.scale(k)));
        lhandToGripMin = Math.min(lhandToGripMin, d);
        if (Math.abs(t - hitT) < dt / 2 + 1e-6) {
          lhandToGripAtHit = d;
          gripAlongAtHit = k;
        }
      }
      if (Math.abs(t - hitT) < dt / 2 + 1e-6) tipToTargetAtHit = Vector3.Distance(tip, targetPoint);
    }
    g.stop();
    return { clipName, seconds: m.seconds, hitT, trailErrMax, insideFrames, inside, lhandToGripMin, lhandToGripAtHit, gripAlongAtHit, tipToTargetAtHit };
  };

  /** 特寫鏡頭（穿模確認截圖）：side＝右側、back＝背後、front＝正面 */
  const viewCam = (view: string) => {
    cam.radius = 1.9;
    cam.target.set(0, 0.85, 0);
    cam.beta = 1.3;
    cam.alpha = view === "back" ? -Math.PI / 2 : view === "front" ? Math.PI / 2 : view === "left" ? Math.PI : 0;
  };

  /** 停在某個時間點畫一格（截圖用） */
  const pose = (skillId: string, t: number) => {
    for (let i = 0; i < 180; i++) {
      fx.advance(1 / 60);
      fx.updateVisuals(1 / 60);
    }
    cam.radius = 3.2;
    cam.alpha = -Math.PI / 2 - 0.9;
    cam.target.set(0, 0.75, 0.6);
    return run(skillId, 1, t);
  };

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

  /** 新版角色相容（A 的規格 §1～§3）：骨骼數、動作數、掛點父骨骼／本地座標／旋轉、世界縮放、武器尺寸 */
  const rigCheck = () => {
    const sk = c.skeletons[0];
    const q = (n: TransformNode) => {
      const r = n.rotationQuaternion;
      return r ? [r.x, r.y, r.z, r.w].map((v) => +v.toFixed(4)) : null;
    };
    const p3 = (v: Vector3) => [v.x, v.y, v.z].map((x) => +x.toFixed(4));
    const sockets = [weaponR, weaponL].filter((n): n is TransformNode => !!n).map((n) => {
      n.computeWorldMatrix(true);
      const sc = new Vector3();
      n.getWorldMatrix().decompose(sc);
      // 靜止姿勢的世界軸（載入後、播放任何動作前）：規格 §3 的 glTF 世界軸轉成 Babylon（glTF 的 x 反向）
      const wm = n.getWorldMatrix();
      const ax = (v: Vector3) => p3(Vector3.TransformNormal(v, wm).normalize());
      return { name: n.name, parent: n.parent?.name ?? null, pos: p3(n.position), rot: q(n), worldScale: +Math.abs(sc.y).toFixed(4), restBlade: ax(new Vector3(0, 1, 0)), restFinger: ax(new Vector3(0, 0, 1)) };
    });
    register(sword);
    const sl = Vector3.Distance(abs(sword.base), abs(sword.tip));
    register(staff);
    const st = Vector3.Distance(abs(weaponR), abs(staff.focus));
    register(sword);
    return {
      bones: sk?.bones.length ?? 0,
      skeletons: c.skeletons.length,
      meshes: c.meshes.filter((m) => m.getTotalVertices() > 0).length,
      materials: c.materials.length,
      animationGroups: c.animationGroups.length,
      sockets,
      swordBaseToTip: +sl.toFixed(4), // 規格：0.40 m（+Y 0.10→0.50）
      staffGripToFocus: +st.toFixed(4), // 規格：0.62 m（杖頭星晶）
    };
  };

  /** 失效貼圖：特效材質、粒子系統，以及場景中所有 fx_ 開頭貼圖 */
  const textureCheck = () => {
    const broken = fx.vfx.brokenTextures();
    for (const m of scene.materials as Material[]) {
      if (!m.name.startsWith("fxm_")) continue;
      for (const t of m.getActiveTextures()) if (!t.getInternalTexture()) broken.push(`${m.name}→${t.name}`);
    }
    return [...new Set(broken)];
  };
  const counts = () => ({ textures: scene.textures.length, materials: scene.materials.length, meshes: scene.meshes.length, particleSystems: scene.particleSystems.length, transformNodes: scene.transformNodes.length });
  const ALL = ["triple_slash", "staff_cast", "leap_slam", "whirlwind", "star_meteor", "charge_burst"];
  const castAll = () => {
    for (const id of ALL) run(id, 1);
    // 投射物撞擊（dispose(true)）與遠方其他玩家投射物（省略路徑）都走一次
    const p = fx.launch("self", "magicBolt", new Vector3(0, 1, 0), new Vector3(0, 0, 1), 11, "azure");
    const w = fx.launch("self", "swordWave", new Vector3(0, 1, 0), new Vector3(0, 0, 1), 9, "azure");
    for (let i = 0; i < 20; i++) {
      fx.advance(1 / 60);
      fx.updateVisuals(1 / 60);
    }
    p?.dispose(true);
    w?.dispose(true);
    for (let i = 0; i < 90; i++) {
      fx.advance(1 / 60);
      fx.updateVisuals(1 / 60);
    }
  };
  const readyWithin = async (ms: number) => {
    const t0 = performance.now();
    const ok = await Promise.race([scene.whenReadyAsync().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
    return { ok, ms: Math.round(performance.now() - t0) };
  };

  /** 畫質切換：每個畫質都施放全部技能，檢查失效貼圖、場景是否還能就緒 */
  const qualityCycle = async () => {
    const out: Record<string, unknown>[] = [];
    for (const t of ["high", "low", "medium", "high"] as const) {
      fx.setQuality(t);
      castAll();
      out.push({ tier: t, broken: textureCheck(), counts: counts(), ready: await readyWithin(8000) });
    }
    return out;
  };

  /** 重複進出地圖：dispose → 新實例 → 場景就緒 → 預熱 → 施放；資源數要回到第一次的值，沒有失效貼圖 */
  const reenter = async (n = 3) => {
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < n; i++) {
      fx.dispose();
      fx = makeFx(tier0);
      register(sword);
      const ready = await readyWithin(8000);
      const pw = await fx.prewarm();
      castAll();
      // 投射物緞帶尾跡在撞擊後 250 ms 才釋放：等它釋放完再數資源
      await new Promise((r) => setTimeout(r, 400));
      out.push({ i, ready, prewarmMs: pw.ms, leftover: pw.leftoverActive, broken: textureCheck(), counts: counts() });
    }
    return out;
  };

  /** 斜坡、高地：地面 y＝高度＋坡度×x（重現星芽原野 −0.8～28 m 地形） */
  const groundCheck = (height: number, slope: number) => {
    const h = (x: number, z: number) => height + slope * x + 0 * z;
    fx.setGround(h);
    const res: Record<string, unknown> = { height, slope };
    for (const id of ["leap_slam", "charge_burst", "star_meteor", "whirlwind"]) {
      const r = run(id, 1, -1, h) as { groundFx?: { key: string; dy: number }[] };
      res[id] = r.groundFx ?? [];
    }
    // 流星落點、怪物死亡／重生、範圍提示
    const sp: { key: string; dy: number }[] = [];
    fx.vfx.onSpawn = (key, at) => sp.push({ key, dy: +(at.y - h(at.x, at.z)).toFixed(3) });
    fx.monsterDeath(new Vector3(2, 0, 3));
    fx.monsterRespawn(new Vector3(-2, 0, 3), 1, true);
    fx.zone("danger", new Vector3(0, 0, 2), 3, { owner: "self" });
    fx.vfx.onSpawn = null;
    const GK = ["shockwave", "dustRing", "groundCrack", "debris", "lightPillar", "chargeRings", "magicCircle", "magicCircleBig", "healAura", "groundGlow"];
    res.monsterAndZone = sp.filter((x) => GK.includes(x.key));
    // 平面特效邊緣（本地 ±0.5）實際世界高度 − 地面高度：貼著坡面時應接近 0（不埋地、不浮空）
    fx.advance(1 / 60);
    fx.updateVisuals(1 / 60);
    const edges: { mesh: string; dy: number[] }[] = [];
    for (const m of scene.meshes) {
      if (!m.isEnabled() || !["fxCircle", "fxShock", "fxCrack", "fxGGlow"].includes(m.name)) continue;
      m.computeWorldMatrix(true);
      const w = m.getWorldMatrix();
      const dy = [new Vector3(0.5, 0, 0), new Vector3(-0.5, 0, 0), new Vector3(0, 0, 0.5), new Vector3(0, 0, -0.5)].map((v) => {
        const p = Vector3.TransformCoordinates(v, w);
        return +(p.y - h(p.x, p.z)).toFixed(3);
      });
      edges.push({ mesh: m.name, dy });
    }
    res.edges = edges;
    fx.setGround(null);
    return res;
  };

  /** Babylon 行為確認：粒子系統的發射源網格被釋放時，粒子系統（含貼圖）是否被連帶釋放 */
  const emitterCascade = () => {
    const m = MeshBuilder.CreateBox("cascadeProbe", { size: 0.1 }, scene);
    const tex = new DynamicTexture("cascadeProbeTex", { width: 8, height: 8 }, scene, false);
    const ps = new ParticleSystem("cascadeProbePs", 8, scene);
    ps.particleTexture = tex;
    ps.emitter = m;
    m.dispose(false, false);
    const r = { psDisposed: scene.particleSystems.indexOf(ps) < 0, textureDisposed: !tex.getInternalTexture() };
    if (!r.psDisposed) ps.dispose();
    if (!r.textureDisposed) tex.dispose();
    return r;
  };

  /** 傷害數字五種類型：各自的 class 與實際顏色、外框（格擋不得與未命中相同） */
  const damageStyles = () => {
    const out: Record<string, unknown> = {};
    for (const style of ["normal", "crit", "heal", "block", "miss"] as const) {
      fx.hit(targetPoint, [], { owner: "self", damage: style === "block" ? "格擋" : style === "miss" ? "MISS" : 123, style, crit: style === "crit" });
      fx.updateVisuals(1 / 60);
      const els = [...hudRoot.querySelectorAll<HTMLElement>(`.cvfx-dmg.${style}`)].filter((e) => e.style.display !== "none");
      const el = els[els.length - 1];
      const cs = el ? getComputedStyle(el) : null;
      out[style] = el ? { text: el.textContent, color: cs!.color, border: cs!.borderTopStyle + " " + cs!.borderTopColor, bg: cs!.backgroundColor, size: cs!.fontSize } : null;
    }
    return out;
  };

  Object.assign(api, {
    frames: () => frames,
    contactSanity,
    poseBasic: (clipName: string, t: number, weaponKind: "sword" | "staff" = "sword", view = "side") => {
      const g = groups.get(clipName);
      const m = meta.clips[clipName];
      if (!g || !m) return false;
      register(weaponKind === "staff" ? staff : sword);
      root.position.set(0, 0, 0);
      root.rotation.y = 0;
      g.start(false, 1, g.from, g.to);
      g.pause();
      g.goToFrame(frameOf(g, t, m.seconds));
      viewCam(view);
      scene.render();
      g.stop();
      return weaponContact();
    },
    poseSkill: (skillId: string, t: number, view = "side") => {
      viewCam(view);
      const r = run(skillId, 1, t);
      return { r, contact: weaponContact() };
    },
    damageStyles,
    boot,
    rigCheck,
    textureCheck,
    qualityCycle,
    reenter,
    groundCheck,
    emitterCascade,
    counts,
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
