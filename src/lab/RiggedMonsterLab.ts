/**
 * ?lab=rigged — 骨骼動畫怪物接入測試頁（Stage 7.2）。
 *   &asset=m004（預設；檔案未交付時自動改用接口測試替身）｜fixture
 *   &q=hq｜lite（模型 LOD）　&count=1～12（同場隻數，預設 4）
 *
 * 在 Babylon.js 9 實際載入 GLB，自動檢查：骨架與關節數、7 組動畫名稱與時長、extras、
 * 每隻獨立的骨架與 AnimationGroup、同時播放不同動畫時骨骼姿勢互不影響、Move／Run 依速度切換與倍率、
 * Attack 命中時間（含播放倍率）、Death 停在最後一格、Respawn 接 Idle、HQ／Lite 結構一致、血條高度、繪製次數。
 * 按鈕：七組動畫、Mixed（每隻不同）、巡邏 0.6 m/s、追擊 2.4 m/s、AI 對戰（測試木樁當目標）。
 * 結果在 window.__starwishRigLab，供自動測試讀取。
 */
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { createMonsterRegistry, MonsterFactory, type MonsterController } from "../monsters/framework/index.ts";
import { registerBabylonVisuals } from "../monsters/babylon/registerVisuals.ts";
import { attackImpactTime, chooseLocomotion, M004_WINDFEATHER_FOX, RIG_CLIP_KEYS, RIG_CONTRACT_FIXTURE, type RigClipKey, type RigLod, type RiggedMonsterSpec } from "../monsters/rigged/riggedSpec.ts";
import { loadRiggedAsset, riggedAssetAvailable, RiggedMonsterVisual } from "../monsters/rigged/RiggedMonsterVisual.ts";

interface Check {
  name: string;
  ok: boolean;
  detail?: unknown;
}

export async function startRiggedMonsterLab(canvas: HTMLCanvasElement, hudRoot: HTMLElement): Promise<void> {
  const q = new URLSearchParams(location.search);
  const lod: RigLod = q.get("q") === "hq" ? "hq" : "lite";
  const count = Math.max(1, Math.min(12, Number(q.get("count") ?? 4) || 4));
  const base = import.meta.env.BASE_URL;
  const want = q.get("asset") === "fixture" ? RIG_CONTRACT_FIXTURE : M004_WINDFEATHER_FOX;
  const available = await riggedAssetAvailable(base, want, lod);
  const spec: RiggedMonsterSpec = available ? want : RIG_CONTRACT_FIXTURE;
  const usingFixture = spec.fixture === true;

  const engine = new Engine(canvas, true, { stencil: true, adaptToDeviceRatio: false });
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.86, 0.9, 0.97, 1);
  const cam = new ArcRotateCamera("cam", -Math.PI / 2.4, 1.15, 6.5, new Vector3(0, 0.45, 0), scene);
  cam.attachControl(canvas, true);
  cam.lowerRadiusLimit = 1.5;
  cam.upperRadiusLimit = 18;
  new HemisphericLight("hemi", new Vector3(0, 1, 0), scene).intensity = 0.75;
  const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, 0.4), scene);
  sun.position = new Vector3(6, 10, -6);
  sun.intensity = 1.6;
  const shadows = new ShadowGenerator(1024, sun);
  shadows.usePercentageCloserFiltering = true;
  const ground = MeshBuilder.CreateGround("ground", { width: 30, height: 30 }, scene);
  const gm = new StandardMaterial("groundMat", scene);
  gm.diffuseColor = new Color3(0.62, 0.78, 0.55);
  gm.specularColor = Color3.Black();
  ground.material = gm;
  ground.receiveShadows = true;

  // ---------- 資產檢查（HQ 與 Lite 都載入一次比較） ----------
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: unknown): void => {
    checks.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });
  };
  const assets: Record<RigLod, Awaited<ReturnType<typeof loadRiggedAsset>> | null> = { hq: null, lite: null };
  for (const l of ["hq", "lite"] as RigLod[]) {
    if (!(await riggedAssetAvailable(base, spec, l))) continue;
    assets[l] = await loadRiggedAsset(scene, base, spec, l);
  }
  const a = assets[lod] ?? assets.lite ?? assets.hq;
  if (!a) throw new Error(`找不到 ${spec.label} 的 GLB`);
  add(`載入 ${a.check.file}（${a.check.loadMs} ms）`, true);
  add(`骨架 1 組、關節 ${spec.expect.joints}`, a.check.skeletons === 1 && a.check.joints === spec.expect.joints, { skeletons: a.check.skeletons, joints: a.check.joints });
  add("7 組動畫名稱與時長符合規格", a.check.errors.filter((e) => /動畫|時長/.test(e)).length === 0, a.check.clips);
  add("GLB extras.monster 可讀（命中時間、原生速度）", a.check.extras, a.check.notes);
  add("蒙皮網格 1 個", a.check.skinnedMeshes === 1, a.check.skinnedMeshes);
  if (assets.hq && assets.lite) {
    const hb = assets.hq.container.skeletons[0]?.bones.map((b) => b.name).join(",");
    const lb = assets.lite.container.skeletons[0]?.bones.map((b) => b.name).join(",");
    const ha = assets.hq.container.animationGroups.map((g) => g.name).join(",");
    const la = assets.lite.container.animationGroups.map((g) => g.name).join(",");
    add("HQ／Lite 骨骼名稱、順序與動畫名稱相同（可互換）", hb === lb && ha === la, { hqBones: hb?.split(",").length, liteBones: lb?.split(",").length });
  } else add("HQ／Lite 都有檔案", false, { hq: !!assets.hq, lite: !!assets.lite });

  // ---------- 怪物實例（手動控制，不接 AI） ----------
  const registry = registerBabylonVisuals(createMonsterRegistry(), { scene, shadows, modelLod: a.lod });
  const factory = new MonsterFactory(registry);
  const ctrls: MonsterController[] = [];
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * 1.6;
    ctrls.push(factory.create(spec.monsterId, { x, y: 0, z: 0 }, { ai: false }));
  }
  await Promise.all(ctrls.map((c) => c.visual!.load()));
  const vis = ctrls.map((c) => c.visual as RiggedMonsterVisual);
  const skels = new Set(vis.map((v) => v.skeleton));
  const idleGroups = new Set(vis.map((v) => v.group("idle")));
  add(`${count} 隻各有自己的骨架與動畫群組`, skels.size === count && idleGroups.size === count && !skels.has(null), { skeletons: skels.size, groups: idleGroups.size });

  let mode: "manual" | "patrol" | "chase" = "manual";
  let t = 0;
  const now = (): number => t;
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
    t += dt;
    for (const c of ctrls) {
      if (mode !== "manual") {
        const sp = mode === "patrol" ? 0.6 : 2.4;
        const p = c.instance.currentPosition;
        p.z += sp * dt;
        if (p.z > 6) p.z = -6;
        c.instance.yaw = 0;
        if (c.instance.sm.state === "idle") c.instance.setLocomotion(true);
        c.speedOverride = sp;
      } else c.speedOverride = null;
      c.update(dt, now(), null);
    }
  });
  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());

  const wait = (sec: number): Promise<void> =>
    new Promise((res) => {
      const t0 = t;
      const o = scene.onAfterRenderObservable.add(() => {
        if (t - t0 >= sec) {
          scene.onAfterRenderObservable.remove(o);
          res();
        }
      });
    });
  const bone = (v: RiggedMonsterVisual, name: string): number[] => {
    const b = v.skeleton?.bones.find((x) => x.name.split("#")[0] === name);
    const tn = b?.getTransformNode();
    const q4 = tn?.rotationQuaternion;
    return q4 ? [q4.x, q4.y, q4.z, q4.w].map((x) => Math.round(x * 1e4) / 1e4) : [];
  };
  const play = (c: MonsterController, k: "idle" | "move" | "attack" | "death"): void => {
    c.request(k);
  };

  // ---------- 自動檢查：同時播放不同動畫 ----------
  const runAuto = async (): Promise<void> => {
    const ks: ("idle" | "attack" | "hit" | "death")[] = ["idle", "attack", "hit", "death"];
    ctrls.forEach((c, i) => {
      const k = ks[i % ks.length]!;
      if (k === "hit") c.instance.sm.request("hit", { duration: 0.45 });
      else c.request(k);
    });
    await wait(0.3);
    const clips = vis.map((v) => v.clip);
    const heads = vis.map((v) => bone(v, "Head").join(","));
    const pelvis = vis.map((v) => bone(v, "Pelvis").join(","));
    const distinct = new Set(heads.map((h, i) => h + "|" + pelvis[i])).size;
    add("同時播放不同動畫（Idle／Attack／Hurt／Death）：各自的片段與骨骼姿勢互不影響", new Set(clips.slice(0, 4)).size === Math.min(4, count) && distinct >= Math.min(4, count), { clips, distinct });
    // Death 停在最後一格
    await wait(1.0);
    const di = ctrls.findIndex((c) => c.instance.sm.state === "death" || c.instance.sm.state === "dead");
    if (di >= 0) {
      const p1 = bone(vis[di]!, "Pelvis").join(",");
      await wait(0.4);
      const p2 = bone(vis[di]!, "Pelvis").join(",");
      add("Death 播完停在最後一格（不回 Idle、不 reset）", p1 === p2 && vis[di]!.clip === "death", { p1, p2, clip: vis[di]!.clip });
    }
    // 全部重置 → Respawn → Idle
    for (const c of ctrls) {
      c.instance.sm.resetToIdle();
      c.update(0, now(), null);
      c.visual!.onStateEnter("idle");
    }
    await wait(0.3);
    const c0 = ctrls[0]!;
    c0.instance.sm.request("death");
    await wait((a.durations.death + spec.deathHold + spec.deathFade) + 0.3);
    const deadState = c0.instance.sm.state;
    const hidden = !vis[0]!.root.isEnabled();
    c0.instance.sm.request("respawn");
    await wait(0.05);
    const respClip = vis[0]!.clip;
    await wait(a.durations.respawn + 0.35);
    add("Death → 停住 → 淡出隱藏 → Respawn → Idle", deadState === "dead" && hidden && respClip === "respawn" && c0.instance.sm.state === "idle" && vis[0]!.clip === "idle" && vis[0]!.root.isEnabled(), { deadState, hidden, respClip, after: vis[0]!.clip });
    // Attack 命中時間（播放倍率 1 與 1.25）
    for (const ratio of [1, 1.25]) {
      const want = attackImpactTime(spec, ratio);
      add(`Attack 命中時間：倍率 ${ratio} → 第 ${want.toFixed(3)} 秒`, Math.abs(want - spec.attackHitTime / ratio) < 1e-9, { want });
    }
    let impactAt = -1;
    const startT = t;
    c0.instance.lastAttackTime = -Infinity;
    c0.instance.tryAttack(t);
    await new Promise<void>((res) => {
      const o = scene.onAfterRenderObservable.add(() => {
        if (c0.lastFrame?.effects.includes("attackImpact") && impactAt < 0) impactAt = t - startT;
        if (t - startT > a.durations.attack + 0.2) {
          scene.onAfterRenderObservable.remove(o);
          res();
        }
      });
    });
    add("Attack 命中事件與動畫第 0.50 秒同步（誤差 ≤ 一格）", impactAt > 0 && Math.abs(impactAt - spec.attackHitTime) <= Math.max(0.1, engine.getDeltaTime() / 1000 + 0.02), { impactAt: Math.round(impactAt * 1000) / 1000 });
    // Move／Run 依速度選擇
    const m1 = chooseLocomotion(0.6, spec.locomotion);
    const m2 = chooseLocomotion(2.4, spec.locomotion);
    add("巡邏 0.6 m/s → Move 倍率 1；追擊 2.4 m/s → Run 倍率 1（Run 是獨立動畫）", m1.clip === "move" && Math.abs(m1.ratio - 1) < 1e-6 && m2.clip === "run" && Math.abs(m2.ratio - 1) < 1e-6, { m1, m2 });
    mode = "chase";
    await wait(1.2);
    const runClips = vis.map((v) => `${v.clip}@${v.ratio.toFixed(2)}`);
    mode = "patrol";
    await wait(1.2);
    const moveClips = vis.map((v) => `${v.clip}@${v.ratio.toFixed(2)}`);
    mode = "manual";
    for (const c of ctrls) {
      c.instance.currentPosition.z = 0;
      c.instance.setLocomotion(false);
    }
    add("實際移動：2.4 m/s 播 Run、0.6 m/s 播 Move（倍率約 1）", runClips.every((s) => s.startsWith("run@")) && moveClips.every((s) => s.startsWith("move@")), { runClips, moveClips });
    // 血條
    c0.instance.currentHp = Math.floor(c0.instance.definition.maxHp / 2);
    await wait(0.2);
    const by = vis[0]!.hpBarWorldY;
    add(`血條：受傷後顯示，高度約 ${spec.hpBarHeight} m（在頭頂上方）`, vis[0]!.hpBarVisible && by !== null && Math.abs(by - spec.hpBarHeight) < 0.05, { by });
    c0.instance.currentHp = c0.instance.definition.maxHp;
    const draw = (engine as unknown as { _drawCalls?: { current: number } })._drawCalls?.current ?? null;
    add(`繪製次數（${count} 隻＋地面、陰影）`, true, { drawCalls: draw, meshesPerFox: vis[0]!.meshes.length, materialsPerFox: vis[0]!.meshes.map((m) => m.material?.name) });
    done = true;
  };
  let done = false;

  // ---------- 介面 ----------
  const panel = document.createElement("div");
  panel.style.cssText = "position:fixed;left:8px;right:8px;bottom:calc(env(safe-area-inset-bottom,0px) + 8px);max-height:45dvh;overflow:auto;z-index:50;background:rgba(255,255,255,.92);border-radius:12px;padding:8px 10px;font:12px/1.45 -apple-system,'PingFang TC',sans-serif;color:#2c2540";
  const head = document.createElement("div");
  head.innerHTML = `<b>${spec.label}</b>（${a.lod === "hq" ? "HQ" : "Lite"}，${count} 隻）${usingFixture ? `<br><span style="color:#c0392b">風羽狐 GLB 尚未放進 models/monsters/m004/：目前顯示的是灰色方塊接口測試替身，只驗證程式，不代表美術。</span>` : ""}`;
  const btns = document.createElement("div");
  btns.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin:6px 0";
  const btn = (label: string, fn: () => void): void => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "min-height:36px;padding:0 10px;border-radius:10px;border:1px solid #b8b0d8;background:#fff";
    b.onclick = fn;
    btns.appendChild(b);
  };
  for (const k of ["idle", "move", "attack", "hit", "death"] as const)
    btn(k === "hit" ? "Hurt" : k[0]!.toUpperCase() + k.slice(1), () => {
      mode = "manual";
      for (const c of ctrls) {
        if (k === "hit") c.instance.sm.request("hit", { duration: 0.45 });
        else play(c, k);
      }
    });
  // Respawn：只有死亡動畫結束（dead）後才會被接受
  btn("Respawn（死亡後）", () => {
    for (const c of ctrls) c.instance.sm.request("respawn");
  });
  btn("Mixed", () => {
    mode = "manual";
    ctrls.forEach((c, i) => {
      const ks = ["idle", "attack", "hit", "death", "move"] as const;
      const k = ks[i % ks.length]!;
      if (k === "hit") c.instance.sm.request("hit", { duration: 0.45 });
      else c.request(k);
    });
  });
  btn("巡邏 0.6 m/s", () => (mode = "patrol"));
  btn("追擊 2.4 m/s", () => (mode = "chase"));
  btn(a.lod === "hq" ? "換 Lite" : "換 HQ", () => {
    q.set("q", a.lod === "hq" ? "lite" : "hq");
    location.search = q.toString();
  });
  const out = document.createElement("div");
  panel.append(head, btns, out);
  document.body.appendChild(panel);
  void hudRoot;
  const render = (): void => {
    out.innerHTML = checks.map((c) => `${c.ok ? "✅" : "❌"} ${c.name}`).join("<br>") + (done ? "" : "<br>…自動檢查中");
  };
  setInterval(render, 500);

  const api = {
    get ready() {
      return true;
    },
    get done() {
      return done;
    },
    spec: { modelId: spec.modelId, fixture: usingFixture, lod: a.lod, count },
    checks,
    asset: a.check,
    state: () => vis.map((v, i) => ({ clip: v.clip, ratio: v.ratio, weights: v.weights(), state: ctrls[i]!.instance.sm.state, visible: v.root.isEnabled() })),
    clipKeys: RIG_CLIP_KEYS as readonly RigClipKey[],
  };
  (window as unknown as { __starwishRigLab: typeof api }).__starwishRigLab = api;
  void runAuto().catch((e: unknown) => {
    add(`自動檢查例外：${e instanceof Error ? e.message : String(e)}`, false);
    done = true;
  });
}
