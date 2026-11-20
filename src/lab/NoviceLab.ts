import "@babylonjs/loaders/glTF";
import {
  type AbstractMesh,
  type AnimationGroup,
  ArcRotateCamera,
  type AssetContainer,
  Color3,
  DirectionalLight,
  HemisphericLight,
  type Mesh,
  Scene,
  SceneLoader,
  ShadowGenerator,
  type TransformNode,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import { createEngine, createShadows, createSkyDome, pickQuality, setupRendering, SKY_COLORS } from "../render/RenderQuality.ts";
import { PerfOverlay } from "../render/PerfOverlay.ts";
import { FrameRecorder, type BenchmarkSummary } from "../render/benchmark.ts";
import { contactShadowQuality, renderExperimentsFromSearch } from "../render/renderExperiments.ts";
import { buildMeadow } from "../world/Meadow.ts";
import {
  ANIM_LABEL,
  atlasOffset,
  benchLayout,
  EXPRESSION_LABEL,
  expressionForAnim,
  NOVICE_ANIMS,
  NOVICE_EXPRESSIONS,
  NOVICE_LOOPING,
  noviceBenchFromSearch,
  noviceFile,
  type NoviceAnim,
  type NoviceExpression,
  type NoviceGender,
  type NoviceLod,
} from "../characters/novice.ts";

/**
 * Stage 5.4：男女初心者角色預覽（?lab=novice）。
 * 場景、燈光、陰影（高畫質 = PCSS32）、HDR、抗鋸齒與遊戲相同；只看角色，不接戰鬥。
 *   - 動畫：待機、走路、跑步、攻擊、受傷、死亡（男女同時播放，共用骨架）
 *   - 表情：8 格表情圖集
 *   - 視角：正面、側面、背面、自由旋轉
 *   - 效能測試：&bench=1&count=10&anim=Run&lod=high&dur=20（男女交替排成網格）
 */

interface CharInstance {
  gender: NoviceGender;
  root: TransformNode;
  meshes: AbstractMesh[];
  groups: Map<NoviceAnim, AnimationGroup>;
  face: Mesh | null;
  faceBase: Float32Array | null;
  faceBuf: Float32Array | null;
  anim: NoviceAnim;
  expr: NoviceExpression;
}

export interface NoviceLabApi {
  ready: boolean;
  chars(): { gender: NoviceGender; anim: NoviceAnim; expr: NoviceExpression; playing: string[]; frame: number; meshes: number; bones: number; triangles: number; height: number }[];
  play(anim: NoviceAnim): void;
  expression(e: NoviceExpression): void;
  view(v: "front" | "side" | "back" | "free"): void;
  freeze(on: boolean): void;
  info(): { files: string[]; triangles: number; drawCalls: number; activeMeshes: number; shadowQuality: number; msaa: number; hdr: boolean; quality: string; animations: string[]; bones: string[][] };
  bench(): { state: "off" | "warmup" | "running" | "done"; result: (BenchmarkSummary & { count: number; anim: string; lod: string; triangles: number; activeMeshes: number }) | null };
}

declare global {
  interface Window {
    __starwishNovice?: NoviceLabApi;
  }
}

export async function startNoviceLab(canvas: HTMLCanvasElement, hudRoot: HTMLElement): Promise<void> {
  const bench = noviceBenchFromSearch(location.search);
  const quality = pickQuality();
  const engine = createEngine(canvas, quality);
  const scene = new Scene(engine);
  createSkyDome(scene);
  scene.ambientColor = new Color3(0.35, 0.33, 0.4);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = 45;
  scene.fogEnd = 120;
  scene.fogColor = SKY_COLORS.fog.clone();
  scene.skipPointerMovePicking = true;

  // 燈光、陰影與遊戲相同（Game.ts）
  const hemi = new HemisphericLight("skyLight", new Vector3(0.2, 1, 0.1), scene);
  hemi.intensity = 0.78;
  hemi.diffuse = new Color3(1, 0.98, 1);
  hemi.groundColor = new Color3(0.62, 0.7, 0.6);
  const sun = new DirectionalLight("sun", new Vector3(-0.45, -1, 0.35).normalize(), scene);
  sun.intensity = 0.75;
  sun.diffuse = new Color3(1, 0.95, 0.86);
  sun.autoUpdateExtends = false;
  sun.orthoLeft = -22;
  sun.orthoRight = 22;
  sun.orthoTop = 22;
  sun.orthoBottom = -22;
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 90;
  const shadows = createShadows(sun, quality);
  shadows.darkness = 0.35;
  // 高畫質：PCSS32（柔和接觸陰影、取樣品質中）— 與遊戲 V3.8R 高畫質預設相同
  const contactQ = contactShadowQuality(quality.shadows.filter, "v38r", renderExperimentsFromSearch(location.search));
  if (contactQ && shadows.useContactHardeningShadow) shadows.filteringQuality = contactQ === "medium" ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_HIGH;
  buildMeadow(scene, shadows);

  const camera = new ArcRotateCamera("noviceCam", Math.PI / 2, 1.38, 3.1, new Vector3(0, 0.62, 0), scene);
  camera.lowerRadiusLimit = 1.2;
  camera.upperRadiusLimit = 14;
  camera.wheelPrecision = 60;
  camera.pinchPrecision = 120;
  camera.minZ = 0.05;
  camera.attachControl(canvas, true);
  scene.activeCamera = camera;
  const render = setupRendering(scene, camera, quality);
  const perf = new PerfOverlay(engine, scene, quality, hudRoot);

  // ---------- 載入 GLB（每個性別一次，多個角色共用幾何與貼圖） ----------
  const base = `${import.meta.env.BASE_URL}models/`;
  const lod: NoviceLod = bench.enabled ? bench.lod : "high";
  const containers = new Map<NoviceGender, AssetContainer>();
  for (const g of ["male", "female"] as NoviceGender[]) {
    containers.set(g, await SceneLoader.LoadAssetContainerAsync(base, noviceFile(g, lod), scene));
  }
  let seq = 0;
  const spawn = (g: NoviceGender, x: number, z: number): CharInstance => {
    const n = seq++;
    const c = containers.get(g)!;
    const entries = c.instantiateModelsToScene((name) => `${g}${n}_${name}`, false, { doNotInstantiate: true });
    const top = entries.rootNodes[0]! as TransformNode;
    top.position.set(x, 0, z);
    const meshes = top.getChildMeshes(false);
    for (const m of meshes) {
      m.isPickable = false;
      m.receiveShadows = false;
      shadows.addShadowCaster(m, false);
      m.alwaysSelectAsActiveMesh = false;
    }
    const groups = new Map<NoviceAnim, AnimationGroup>();
    for (const ag of entries.animationGroups) {
      const a = NOVICE_ANIMS.find((x) => ag.name === `${g}${n}_${x}` || ag.name === x || ag.name.endsWith(`_${x}`));
      if (a) groups.set(a, ag);
      ag.stop();
    }
    const face = (meshes.find((m) => /Face_/.test(m.name) && m.getTotalVertices() > 0) as Mesh | undefined) ?? null;
    let faceBase: Float32Array | null = null;
    if (face) {
      face.makeGeometryUnique();
      faceBase = Float32Array.from(face.getVerticesData(VertexBuffer.UVKind) ?? []);
      face.setVerticesData(VertexBuffer.UVKind, Float32Array.from(faceBase), true);
    }
    const ci: CharInstance = { gender: g, root: top, meshes, groups, face, faceBase, faceBuf: faceBase ? new Float32Array(faceBase.length) : null, anim: "Idle", expr: "smile" };
    return ci;
  };

  const setExpr = (c: CharInstance, e: NoviceExpression): void => {
    c.expr = e;
    if (!c.face || !c.faceBase || !c.faceBuf) return;
    const { du, dv } = atlasOffset(NOVICE_EXPRESSIONS.indexOf(e));
    for (let k = 0; k < c.faceBase.length; k += 2) {
      c.faceBuf[k] = c.faceBase[k]! + du;
      c.faceBuf[k + 1] = c.faceBase[k + 1]! + dv;
    }
    c.face.updateVerticesData(VertexBuffer.UVKind, c.faceBuf);
  };

  const play = (c: CharInstance, a: NoviceAnim, withExpr = true): void => {
    for (const ag of c.groups.values()) ag.stop();
    c.anim = a;
    const ag = c.groups.get(a);
    if (!ag) return;
    if (withExpr) setExpr(c, expressionForAnim(a));
    if (NOVICE_LOOPING[a]) ag.start(true, 1, ag.from, ag.to, false);
    else {
      ag.start(false, 1, ag.from, ag.to, false);
      if (a !== "Death") ag.onAnimationGroupEndObservable.addOnce(() => c.anim === a && play(c, "Idle"));
    }
  };

  // ---------- 角色 ----------
  const chars: CharInstance[] = [];
  if (bench.enabled) {
    benchLayout(bench.count).forEach((p, i) => chars.push(spawn(i % 2 === 0 ? "male" : "female", p.x, p.z)));
    for (const [i, c] of chars.entries()) {
      play(c, bench.anim);
      // 錯開相位，避免所有角色同步
      const ag = c.groups.get(bench.anim);
      if (ag) ag.goToFrame(ag.from + ((ag.to - ag.from) * (i * 0.37)) % (ag.to - ag.from));
    }
    camera.radius = 5.5 + Math.sqrt(bench.count) * 0.9;
    camera.beta = 1.15;
  } else {
    chars.push(spawn("male", -0.42, 0));
    chars.push(spawn("female", 0.42, 0));
    for (const c of chars) play(c, "Idle");
  }

  // ---------- 介面 ----------
  const top = document.createElement("div");
  top.className = "v3-top";
  const title = document.createElement("div");
  title.className = "lab-title";
  title.innerHTML = `<div class="lab-name">男女初心者 <small>Stage 5.4 角色預覽 ${lod === "high" ? "高" : "低"}模</small></div><div class="lab-state" data-novice-state></div><div class="lab-msg">程式化建模第一版（Blender）；共用骨架、6 段動畫</div>`;
  top.append(title);
  const views = document.createElement("div");
  views.className = "lab-views";
  views.style.position = "static";
  const VIEW_ALPHA = { front: Math.PI / 2, side: 0, back: -Math.PI / 2 };
  const viewBtns: HTMLButtonElement[] = [];
  let auto = false;
  for (const [v, label] of [["front", "正面"], ["side", "側面"], ["back", "背面"], ["free", "旋轉"]] as const) {
    const b = document.createElement("button");
    b.className = "lab-view-btn";
    b.textContent = label;
    b.dataset.view = v;
    b.addEventListener("click", () => api.view(v));
    viewBtns.push(b);
    views.append(b);
  }
  const freezeBtn = document.createElement("button");
  freezeBtn.className = "lab-view-btn";
  freezeBtn.textContent = "暫停";
  let frozen = false;
  freezeBtn.addEventListener("click", () => api.freeze(!frozen));
  views.append(freezeBtn);
  top.append(views);
  hudRoot.append(top);

  const panel = document.createElement("div");
  panel.className = "lab-panel v3-expr";
  panel.style.gridTemplateColumns = "repeat(7, minmax(0, 1fr))";
  const animBtns: HTMLButtonElement[] = [];
  for (const a of NOVICE_ANIMS) {
    const b = document.createElement("button");
    b.className = "lab-btn";
    b.textContent = ANIM_LABEL[a];
    b.dataset.anim = a;
    b.addEventListener("click", () => api.play(a));
    animBtns.push(b);
    panel.append(b);
  }
  const exprBtn = document.createElement("button");
  exprBtn.className = "lab-btn lab-demo";
  exprBtn.textContent = "表情";
  let exprIdx = 0;
  exprBtn.addEventListener("click", () => {
    exprIdx = (exprIdx + 1) % 6;
    api.expression(NOVICE_EXPRESSIONS[exprIdx]!);
  });
  panel.append(exprBtn);
  if (!bench.enabled) hudRoot.append(panel);

  const result = document.createElement("div");
  result.className = "lab-bench-result";
  result.hidden = true;
  result.dataset.noviceBench = "1";
  hudRoot.append(result);

  const stateEl = title.querySelector("[data-novice-state]") as HTMLElement;
  const refreshUi = (): void => {
    const c = chars[0]!;
    stateEl.textContent = bench.enabled ? `效能測試：${bench.count} 個角色、${ANIM_LABEL[bench.anim]}` : `動作：${ANIM_LABEL[c.anim]}　表情：${EXPRESSION_LABEL[c.expr]}`;
    for (const b of animBtns) b.classList.toggle("active", b.dataset.anim === c.anim);
  };

  let benchState: "off" | "warmup" | "running" | "done" = bench.enabled ? "warmup" : "off";
  let benchResult: ReturnType<NoviceLabApi["bench"]>["result"] = null;
  const triangles = (): number => chars.reduce((s, c) => s + c.meshes.reduce((t, m) => t + Math.floor((m.getTotalIndices?.() ?? 0) / 3), 0), 0);
  const countBones = (c: CharInstance): number => c.meshes.find((m) => m.skeleton)?.skeleton?.bones.length ?? 0;

  const api: NoviceLabApi = {
    ready: false,
    chars: () =>
      chars.map((c) => {
        const ag = c.groups.get(c.anim);
        let minY = Infinity;
        let maxY = -Infinity;
        for (const m of c.meshes) {
          m.refreshBoundingInfo({ applySkeleton: true });
          const bb = m.getBoundingInfo().boundingBox;
          minY = Math.min(minY, bb.minimumWorld.y);
          maxY = Math.max(maxY, bb.maximumWorld.y);
        }
        return {
          gender: c.gender,
          anim: c.anim,
          expr: c.expr,
          playing: [...c.groups.entries()].filter(([, g]) => g.isPlaying).map(([a]) => a),
          frame: ag?.animatables[0]?.masterFrame ?? 0,
          meshes: c.meshes.length,
          bones: countBones(c),
          triangles: c.meshes.reduce((t, m) => t + Math.floor((m.getTotalIndices?.() ?? 0) / 3), 0),
          height: maxY - minY,
        };
      }),
    play: (a) => {
      for (const c of chars) play(c, a);
      refreshUi();
    },
    expression: (e) => {
      for (const c of chars) setExpr(c, e);
      refreshUi();
    },
    view: (v) => {
      auto = v === "free";
      if (v !== "free") camera.alpha = VIEW_ALPHA[v];
      camera.beta = 1.38;
      for (const b of viewBtns) b.classList.toggle("active", b.dataset.view === v);
    },
    freeze: (on) => {
      frozen = on;
      for (const c of chars) for (const g of c.groups.values()) (on ? g.pause() : g.isStarted && g.play());
      freezeBtn.classList.toggle("on", on);
    },
    info: () => ({
      files: (["male", "female"] as NoviceGender[]).map((g) => noviceFile(g, lod)),
      triangles: triangles(),
      drawCalls: perf.drawCalls,
      activeMeshes: scene.getActiveMeshes().length,
      shadowQuality: shadows.filteringQuality,
      msaa: render.pipeline ? render.pipeline.samples : 0,
      hdr: !!render.pipeline,
      quality: quality.level,
      animations: [...(chars[0]?.groups.keys() ?? [])],
      bones: chars.slice(0, 2).map((c) => c.meshes.find((m) => m.skeleton)?.skeleton?.bones.map((b) => b.name.replace(/^(male|female)\d+_/, "")) ?? []),
    }),
    bench: () => ({ state: benchState, result: benchResult }),
  };
  window.__starwishNovice = api;
  refreshUi();
  api.view("front");

  // ---------- 效能測試 ----------
  const recorder = new FrameRecorder(bench.seconds, bench.warmup);
  if (bench.enabled) perf.lockResolution(Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio));

  engine.runRenderLoop(() => {
    const dt = engine.getDeltaTime() / 1000;
    if (auto) camera.alpha += dt * 0.5;
    scene.render();
    perf.update(dt);
    if (bench.enabled && benchState !== "done") {
      if (recorder.progress * (bench.seconds + bench.warmup) > bench.warmup) benchState = "running";
      if (recorder.record(dt, perf.drawCalls)) {
        benchState = "done";
        const s = recorder.summary();
        benchResult = { ...s, count: bench.count, anim: bench.anim, lod: bench.lod, triangles: triangles(), activeMeshes: scene.getActiveMeshes().length };
        result.hidden = false;
        result.innerHTML =
          `<b>角色效能測試結果</b><br>${bench.count} 個角色（${bench.lod === "high" ? "高" : "低"}模）、${ANIM_LABEL[bench.anim]}、${s.seconds} 秒<br>` +
          `平均 ${s.avgFps.toFixed(1)} FPS　1% Low ${s.low1Fps.toFixed(1)}　最低 ${s.minFps.toFixed(1)}<br>` +
          `Draw Calls ${s.avgDrawCalls.toFixed(0)}　角色三角形 ${triangles()}<br>解析度 ${perf.pixelRatio}x　畫質 ${quality.level}`;
      }
    }
  });
  window.addEventListener("resize", () => engine.resize());
  api.ready = true;
}
