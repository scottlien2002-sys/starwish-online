import "@babylonjs/loaders/glTF";
import {
  type AbstractMesh,
  ArcRotateCamera,
  type AssetContainer,
  Mesh,
  type BaseTexture,
  Color3,
  DirectionalLight,
  HemisphericLight,
  type Material,
  PBRMaterial,
  ReflectionProbe,
  RenderTargetTexture,
  Scene,
  SceneLoader,
  ShadowGenerator,
  type TransformNode,
  Vector3,
} from "@babylonjs/core";
import { createEngine, createShadows, createSkyDome, pickQuality, setupRendering, SKY_COLORS } from "../render/RenderQuality.ts";
import { PerfOverlay } from "../render/PerfOverlay.ts";
import { summarizeFrames, type BenchmarkSummary } from "../render/benchmark.ts";
import { contactShadowQuality, renderExperimentsFromSearch } from "../render/renderExperiments.ts";
import { buildMeadow } from "../world/Meadow.ts";
import { heightAt } from "../world/terrain.ts";
import {
  C10B_REFERENCE,
  C10B_VIEWS,
  c10bFile,
  c10bLayout,
  c10bOptionsFromSearch,
  countHitches,
  c10pAbLabel,
  c10pMergeGroups,
  c10pShadowMode,
  C10P_P3_ITEMS,
  C10P_DIAG_LABEL,
  frameTimeline,
  type FrameSample,
  type TimelineWindow,
  windowHistograms,
  isLowView,
  wantsGlow,
  PLAZA_TOP,
  windowAverages,
  type C10bGender,
  type C10bLod,
  type C10bView,
} from "../characters/noviceC10b.ts";

/**
 * Stage 5.4 C1.0-B：男女初心者實機整合測試（?lab=c10b）。
 * 場景、燈光、陰影（高畫質 = PCSS32）、HDR、MSAA 與遊戲相同；不接戰鬥、不改遊戲。
 *   - 載入 C1.0-B 男女 HQ／Lite GLB（靜態模型：尚未綁骨架、沒有動畫）
 *   - HQ／Lite 切換（重新載入並量載入時間）
 *   - 視角：正面、45 度、側面、背面、低角度（正面／背面）、頭部、裙裝、自由旋轉
 *   - 效能測試：20 秒、3 分鐘長時間（每 30 秒一段，看發熱降頻）；平均、1% Low、卡頓、WebGL Context Lost
 *   - 結果可「複製報告」貼回給開發者
 * 金色金屬：專案沒有環境貼圖，金屬材質會發黑 → 只在角色的金屬材質掛上「天空」一次性反射探針（RENDER_ONCE）。
 */

interface CharInst {
  gender: C10bGender;
  root: TransformNode;
  meshes: AbstractMesh[];
}

interface LoadRecord {
  lod: C10bLod;
  ms: number;
  files: { file: string; ms: number; bytes: number }[];
}

interface BenchResult extends BenchmarkSummary {
  label: string;
  ab: string;
  windows5: number[];
  hist30: { le20: number; le37: number; le54: number; gt54: number }[];
  renderSize: [number, number][];
  timeline: TimelineWindow[];
  /** 開始測試時距離頁面開啟／最後一次載入完成的秒數（判斷是否為載入後背景工作） */
  sinceOpen: number;
  sinceLoad: number;
  sizeChanges: number;
  diag: string;
  shadowMode: string;
  shadowConfig: string;
  shadowRendersInTest: number;
  shadowFrozen: boolean;
  avgShadowDraws: number;
  avgMainDraws: number;
  gpuProbe: boolean;
  fixSize: boolean;
  resizeEvents: string[];
  lod: C10bLod;
  count: number;
  hitches100: number;
  windows: number[];
  contextLost: number;
}

export interface C10bLabApi {
  ready: boolean;
  lod: C10bLod;
  loading: boolean;
  setLod(l: C10bLod): Promise<void>;
  view(v: C10bView): void;
  info(): {
    lod: C10bLod;
    chars: { gender: C10bGender; meshes: number; triangles: number; height: number; width: number; feetY: number; skeleton: boolean; animations: number }[];
    feet: number[];
    baseY: number;
    triangles: number;
    drawCalls: number;
    activeMeshes: number;
    materials: number;
    textures: { name: string; w: number; h: number }[];
    gpuMemMB: number;
    jsHeapMB: number | null;
    shadowQuality: number;
    msaa: number;
    hdr: boolean;
    quality: string;
    pixelRatio: number;
    contextLost: number;
    loads: LoadRecord[];
    metalWithProbe: number;
    transparentMaterials: string[];
    reference: typeof C10B_REFERENCE;
  };
  bench(seconds: number, label?: string): void;
  benchState(): { state: "off" | "warmup" | "running" | "done"; progress: number; result: BenchResult | null; all: BenchResult[] };
  report(): string;
  moveChar(index: number, dx: number): void;
  renderInfo(): { p3: boolean; star: boolean; pipeline: boolean; canvasAntialias: boolean; glowEnabled: boolean; toneMappingInMaterials: boolean; shadowSkipped: number; files: string[] };
  shadowState(): { renders: number; frozenAt: number | null; refreshRate: number; mapSize: number; contact: boolean; pcf: boolean; filteringQuality: number; casters: number; lastFrameShadowDraws: number; counter: boolean; mode: string };
  /** 效能分析：開關各項目各量一格 Draw Calls（只量測，不改畫面；量完恢復） */
  breakdown(): Promise<Record<string, unknown>>;
}

declare global {
  interface Window {
    __starwishC10b?: C10bLabApi;
  }
}

export async function startNoviceC10bLab(canvas: HTMLCanvasElement, hudRoot: HTMLElement): Promise<void> {
  const opts = c10bOptionsFromSearch(location.search);
  const quality = pickQuality();
  // P3-2（?p3=1）：不建立半浮點 HDR 後製管線；色調映射改在材質內，MSAA 4x 改由畫布原生提供（建立引擎時就要決定）
  const p3NoPipe = opts.p3 && quality.postProcess;
  const renderQ = p3NoPipe ? { ...quality, postProcess: false, canvasAntialias: true } : quality;
  const engine = createEngine(canvas, renderQ);
  const scene = new Scene(engine);
  const sky = createSkyDome(scene);
  scene.ambientColor = new Color3(0.35, 0.33, 0.4);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = 45;
  scene.fogEnd = 120;
  scene.fogColor = SKY_COLORS.fog.clone();
  scene.skipPointerMovePicking = true;

  let contextLost = 0;
  engine.onContextLostObservable.add(() => {
    contextLost++;
    updateStatus();
  });

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
  // P3-1 診斷：陰影貼圖解析度對照（?shadowmap=1024；只在測試頁）
  if (opts.shadowMap) quality.shadows.mapSize = opts.shadowMap;
  const shadows = createShadows(sun, quality);
  shadows.darkness = 0.35;
  const contactQ = contactShadowQuality(quality.shadows.filter, "v38r", renderExperimentsFromSearch(location.search));
  if (contactQ && shadows.useContactHardeningShadow) shadows.filteringQuality = contactQ === "medium" ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_HIGH;
  // P3-1 診斷：陰影取樣對照（?shadowfilter=low|high|pcf；預設 = 正式 PCSS32 中品質）
  if (opts.shadowFilter === "low" && shadows.useContactHardeningShadow) shadows.filteringQuality = ShadowGenerator.QUALITY_LOW;
  else if (opts.shadowFilter === "high" && shadows.useContactHardeningShadow) shadows.filteringQuality = ShadowGenerator.QUALITY_HIGH;
  else if (opts.shadowFilter === "pcf") {
    shadows.useContactHardeningShadow = false;
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = ShadowGenerator.QUALITY_HIGH;
  }
  const shadowFilterLabel = (): string =>
    shadows.useContactHardeningShadow
      ? `PCSS ${shadows.filteringQuality === ShadowGenerator.QUALITY_LOW ? "低（16）" : shadows.filteringQuality === ShadowGenerator.QUALITY_HIGH ? "高（64）" : "中（32）"}`
      : `PCF ${shadows.filteringQuality === ShadowGenerator.QUALITY_HIGH ? "高" : shadows.filteringQuality === ShadowGenerator.QUALITY_MEDIUM ? "中" : "低"}`;

  // P3-1：陰影貼圖（Render Target）實際更新次數與每次的 Draw Calls
  //   引擎的 Draw Call 計數器在陰影貼圖繪製前後的差 = 陰影貼圖 Draw Calls；拿不到計數器時改用投影者子網格數
  const shadowMap = shadows.getShadowMap()!;
  const drawCounter = (engine as unknown as { _drawCalls?: { current: number } })._drawCalls;
  let smRenders = 0;
  let smDrawsFrame = 0;
  let smDrawStart = 0;
  let smFrozenAt: number | null = null;
  let smFreezeAfter = -1;
  shadowMap.onBeforeRenderObservable.add(() => {
    smRenders++;
    smDrawStart = drawCounter?.current ?? 0;
  });
  // ---------- P3-2：陰影貼圖「有變化才重畫」 ----------
  // 每格比對：投影者清單、每個投影者的世界矩陣與顯示狀態、太陽位置與方向；有骨架的網格（之後的動畫）每格都算有變化。
  // 沒變化就不重畫，畫面與每格重畫完全相同；角色或怪物一移動，同一格就會重畫。
  const shadowDirty = (() => {
    const last = new Map<number, Float32Array>();
    let lastSun = "";
    let lastList = "";
    let force = 0;
    return {
      forceFrames(n: number): void {
        force = Math.max(force, n);
      },
      check(): boolean {
        let dirty = force > 0;
        if (force > 0) force--;
        const list = shadowMap.renderList ?? [];
        const ids = list.map((m) => m.uniqueId).join(",");
        if (ids !== lastList) {
          lastList = ids;
          dirty = true;
        }
        const sunKey = `${sun.position.x},${sun.position.y},${sun.position.z},${sun.direction.x},${sun.direction.y},${sun.direction.z}`;
        if (sunKey !== lastSun) {
          lastSun = sunKey;
          dirty = true;
        }
        for (const m of list) {
          if (m.skeleton) dirty = true;
          const w = m.computeWorldMatrix(true).m;
          const prev = last.get(m.uniqueId);
          const vis = m.isEnabled() && m.isVisible ? 1 : 0;
          if (!prev || prev[16] !== vis || prev.some((v, i) => i < 16 && v !== w[i])) {
            const a = new Float32Array(17);
            a.set(w);
            a[16] = vis;
            last.set(m.uniqueId, a);
            dirty = true;
          }
        }
        return dirty;
      },
    };
  })();
  let smSkipped = 0;
  if (opts.p3 && opts.shadowRefresh !== "once") shadowMap.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  shadowMap.onAfterRenderObservable.add(() => {
    smDrawsFrame += drawCounter ? drawCounter.current - smDrawStart : (shadowMap.renderList ?? []).reduce((n, m) => n + (m.isEnabled() ? (m.subMeshes?.length ?? 0) : 0), 0);
    // S2：載入完成後讓陰影貼圖完整畫 3 次（確保所有投影者都已就緒），之後不再重畫
    if (opts.shadowRefresh === "once" && smFreezeAfter >= 0 && smRenders >= smFreezeAfter) {
      smFreezeAfter = -1;
      shadowMap.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      smFrozenAt = smRenders;
    }
  });
  buildMeadow(scene, shadows);
  // 角色站在出生廣場星形地台上（地形高度＋0.13 公尺；直接放在地形高度會讓靴子陷進地台）
  const BASE_Y = heightAt(0, 0) + PLAZA_TOP;
  const groundMeshes = scene.meshes.filter((m) => /^PH_(ground|plaza)/.test(m.name));

  // 金屬反射用：只拍天空一次的反射探針（只給角色金屬材質用）
  const probe = new ReflectionProbe("c10bEnv", 128, scene, true, true);
  probe.position = new Vector3(0, 0.8, 0);
  // 只拍天空（不含草地）：拍到草地時金邊會反射出綠色
  probe.renderList!.push(sky);
  probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;

  const camera = new ArcRotateCamera("c10bCam", Math.PI / 2, 1.42, 3.0, new Vector3(0, 0.6 + BASE_Y, 0), scene);
  camera.lowerRadiusLimit = 0.6;
  camera.upperRadiusLimit = 16;
  camera.upperBetaLimit = 1.95;
  camera.wheelPrecision = 60;
  camera.pinchPrecision = 120;
  camera.minZ = 0.03;
  camera.attachControl(canvas, true);
  scene.activeCamera = camera;
  const render = setupRendering(scene, camera, renderQ);
  // C1.0-P P1（?p1=1）：發光層只處理 metadata.glow === true 的物件（與正式遊戲只加入星星、光環的做法相同）。
  // 原始（A0）測試頁沒有指定任何發光物件 → Babylon 發光層會把天空、地圖、角色全部重畫一次。
  let glowExcluded = 0;
  if (opts.p1 && render.glow) {
    const glow = render.glow;
    const exclude = (m: AbstractMesh): void => {
      if (wantsGlow(m.metadata)) return;
      glow.addExcludedMesh(m as Mesh);
      glowExcluded++;
    };
    for (const m of scene.meshes) exclude(m);
    scene.onNewMeshAddedObservable.add(exclude);
  }
  // P3-2：沒有任何發光物件時暫停發光層；之後加入 metadata.glow 的物件會自動開啟
  if (opts.p3 && render.glow) {
    const glow = render.glow;
    glow.isEnabled = scene.meshes.some((m) => wantsGlow(m.metadata));
    scene.onNewMeshAddedObservable.add((m) => {
      if (wantsGlow(m.metadata)) glow.isEnabled = true;
    });
  }
  const perf = new PerfOverlay(engine, scene, quality, hudRoot);
  perf.lockResolution(Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio));

  // ---------- 載入 ----------
  const base = `${import.meta.env.BASE_URL}models/`;
  let lod: C10bLod = opts.lod;
  const containers = new Map<C10bGender, AssetContainer>();
  let chars: CharInst[] = [];
  const loads: LoadRecord[] = [];
  let metalWithProbe = 0;
  let loading = false;
  let lastLoadDone = 0;

  const fileBytes = (file: string): number => {
    const e = performance.getEntriesByType("resource").filter((r) => r.name.endsWith(file)) as PerformanceResourceTiming[];
    const last = e[e.length - 1];
    return last ? last.decodedBodySize || last.encodedBodySize || last.transferSize : 0;
  };

  const prepMaterial = (mat: Material | null): void => {
    if (!(mat instanceof PBRMaterial)) return;
    if (mat.metallic != null && mat.metallic > 0.3 && probe.cubeTexture) {
      mat.reflectionTexture = probe.cubeTexture;
      metalWithProbe++;
    }
  };

  // ---------- P2：同模組、同材質設定的零件合併（?p2=1） ----------
  const matKey = (m: Material | null): string => {
    if (!(m instanceof PBRMaterial)) return m ? `other:${m.uniqueId}` : "none";
    const c = (x: { r: number; g: number; b: number } | null | undefined): string => (x ? `${x.r.toFixed(4)},${x.g.toFixed(4)},${x.b.toFixed(4)}` : "-");
    return [
      m.metallic,
      m.roughness,
      c(m.albedoColor),
      c(m.emissiveColor),
      m.albedoTexture?.uniqueId ?? "-",
      m.reflectionTexture?.uniqueId ?? "-",
      m.metallicF0Factor,
      c(m.metallicReflectanceColor),
      m.sheen.isEnabled,
      m.sheen.intensity,
      c(m.sheen.color),
      m.sheen.roughness,
      m.backFaceCulling,
      m.twoSidedLighting,
      m.alpha,
      m.transparencyMode,
      m.environmentIntensity,
      m.directIntensity,
    ].join("|");
  };
  let mergeLog: { gender: C10bGender; before: number; after: number; groups: { slot: string; parts: string[] }[] }[] = [];
  const mergeChar = (gender: C10bGender, meshes: AbstractMesh[]): AbstractMesh[] => {
    const real = meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    const groups = c10pMergeGroups(real.map((m) => ({ name: m.name, materialKey: matKey(m.material) })));
    const out: AbstractMesh[] = [];
    const logGroups: { slot: string; parts: string[] }[] = [];
    for (const g of groups) {
      const ms = g.indices.map((i) => real[i]!);
      const names = ms.map((m) => m.name.replace(/^(male|female)\d+_/, ""));
      logGroups.push({ slot: g.slot, parts: names });
      const parent = ms[0]!.parent;
      if (ms.length === 1 || ms.some((m) => m.parent !== parent)) {
        for (const m of ms) {
          m.metadata = { ...(m.metadata ?? {}), slot: g.slot, parts: [m.name] };
          out.push(m);
        }
        continue;
      }
      // 在 glTF 根節點的座標系裡合併（不烘入左右手轉換），合併後再掛回同一個根節點 → 頂點、頂點色、UV、法線與原本完全相同
      const hasAlpha = ms[0]!.hasVertexAlpha;
      for (const m of ms) m.parent = null;
      const merged = Mesh.MergeMeshes(ms, true, true);
      if (!merged) {
        for (const m of ms) {
          m.parent = parent;
          out.push(m);
        }
        continue;
      }
      merged.name = `${ms[0]!.name.match(/^(male|female)\d+_/)?.[0] ?? ""}${g.slot}_${names[0]}_x${ms.length}`;
      merged.parent = parent;
      merged.hasVertexAlpha = hasAlpha;
      merged.metadata = { slot: g.slot, parts: names };
      out.push(merged);
    }
    mergeLog.push({ gender, before: real.length, after: out.length, groups: logGroups });
    return out;
  };

  // ---------- P3 診斷開關（只用來量各項成本；不是優化方案）----------
  const diagLabel = opts.diag.length ? opts.diag.map((d) => C10P_DIAG_LABEL[d]).join("、") : "無";
  const applyDiag = (): void => {
    if (opts.diag.includes("noshadow")) {
      const sm = shadows.getShadowMap();
      if (sm?.renderList) sm.renderList.length = 0;
    }
    if (opts.diag.includes("noglow") && render.glow) render.glow.isEnabled = false;
    if (opts.diag.includes("nopost")) scene.postProcessesEnabled = false;
    if (opts.diag.includes("nomsaa") && render.pipeline) render.pipeline.samples = 1;
    if (opts.diag.includes("nochars")) for (const c of chars) for (const m of c.meshes) m.setEnabled(false);
  };

  const clear = (): void => {
    for (const c of chars) {
      for (const m of c.meshes) shadows.removeShadowCaster(m, false);
      c.root.dispose(false, false);
    }
    chars = [];
    for (const c of containers.values()) c.dispose();
    containers.clear();
  };

  const load = async (l: C10bLod): Promise<void> => {
    loading = true;
    updateStatus();
    clear();
    if (opts.shadowRefresh === "once") {
      shadowMap.refreshRate = 1;
      smFrozenAt = null;
      smFreezeAfter = -1;
    }
    metalWithProbe = 0;
    mergeLog = [];
    performance.clearResourceTimings?.();
    const t0 = performance.now();
    const rec: LoadRecord = { lod: l, ms: 0, files: [] };
    await Promise.all(
      (["male", "female"] as C10bGender[]).map(async (g) => {
        const s = performance.now();
        const file = c10bFile(g, l, opts.star);
        const c = await SceneLoader.LoadAssetContainerAsync(base, file, scene);
        rec.files.push({ file, ms: Math.round(performance.now() - s), bytes: fileBytes(file) });
        for (const m of c.materials) prepMaterial(m);
        containers.set(g, c);
      }),
    );
    let seq = 0;
    for (const p of c10bLayout(opts.count)) {
      const n = seq++;
      const ent = containers.get(p.gender)!.instantiateModelsToScene((name) => `${p.gender}${n}_${name}`, false, { doNotInstantiate: true });
      const root = ent.rootNodes[0] as TransformNode;
      root.position.set(p.x, BASE_Y, p.z);
      let meshes = root.getChildMeshes(false);
      if (opts.p2) meshes = mergeChar(p.gender, meshes);
      for (const m of meshes) {
        m.isPickable = false;
        m.receiveShadows = false;
        shadows.addShadowCaster(m, false);
      }
      chars.push({ gender: p.gender, root, meshes });
    }
    // 第一次渲染完成（含著色器編譯）才算載入完成
    applyDiag();
    await scene.whenReadyAsync();
    rec.ms = Math.round(performance.now() - t0);
    lastLoadDone = performance.now();
    if (opts.shadowRefresh === "once") smFreezeAfter = smRenders + 3;
    if (opts.p3) shadowDirty.forceFrames(3);
    rec.files.sort((a, b) => a.file.localeCompare(b.file));
    loads.push(rec);
    lod = l;
    loading = false;
    for (const b of lodBtns) b.classList.toggle("active", b.dataset.lod === l);
    updateStatus();
  };

  // ---------- 介面 ----------
  const top = document.createElement("div");
  top.className = "v3-top";
  const title = document.createElement("div");
  title.className = "lab-title";
  title.innerHTML =
    `<div class="lab-name">男女初心者 C1.0-B <small>實機整合測試　${c10pAbLabel(opts)}${opts.diag.length ? `　診斷：${diagLabel}` : ""}${opts.gpuProbe ? "　GPU 探測" : ""}　${c10pShadowMode(opts)}${opts.p3 ? "　P3-2 優化" : ""}${opts.star ? "　徽記修正" : ""}</small></div>` +
    `<div class="lab-state" data-c10b-state></div>` +
    `<div class="lab-msg">靜態模型（尚未綁骨架、沒有動畫）；燈光、陰影、HDR 與遊戲相同</div>`;
  top.append(title);
  const views = document.createElement("div");
  views.className = "lab-views";
  views.style.position = "static";
  views.style.flexWrap = "wrap";
  const viewBtns: HTMLButtonElement[] = [];
  const addBtn = (parent: HTMLElement, label: string, cls: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = label;
    b.addEventListener("click", fn);
    parent.append(b);
    return b;
  };
  for (const v of ["front", "left45", "side", "back", "low", "lowBack", "head", "skirt", "emblem", "free"] as C10bView[]) {
    const b = addBtn(views, v === "free" ? "旋轉" : C10B_VIEWS[v as Exclude<C10bView, "free">].label, "lab-view-btn", () => api.view(v));
    b.dataset.view = v;
    viewBtns.push(b);
  }
  for (const [label, on] of [["原始 HQ", false], ["P3-2 優化", true]] as const) {
    const b = addBtn(views, label, "lab-view-btn", () => {
      const u = new URL(location.href);
      if (on) u.searchParams.set("p3", "1");
      else u.searchParams.delete("p3");
      location.href = u.toString();
    });
    b.classList.toggle("active", opts.p3 === on);
  }
  for (const [label, p1, p2] of [["A0 原始", false, false], ["A1 P1", true, false], ["A2 P1+P2", true, true]] as const) {
    const b = addBtn(views, label, "lab-view-btn", () => {
      const u = new URL(location.href);
      for (const [k, on] of [["p1", p1], ["p2", p2]] as const) {
        if (on) u.searchParams.set(k, "1");
        else u.searchParams.delete(k);
      }
      location.href = u.toString();
    });
    b.classList.toggle("active", opts.p1 === p1 && opts.p2 === p2);
  }
  top.append(views);
  hudRoot.append(top);

  const panel = document.createElement("div");
  panel.className = "lab-panel v3-expr";
  panel.style.gridTemplateColumns = "repeat(5, minmax(0, 1fr))";
  const lodBtns: HTMLButtonElement[] = [];
  for (const l of ["hq", "lite"] as C10bLod[]) {
    const b = addBtn(panel, l === "hq" ? "HQ" : "Lite", "lab-btn", () => void api.setLod(l));
    b.dataset.lod = l;
    lodBtns.push(b);
  }
  addBtn(panel, "測試 20 秒", "lab-btn", () => api.bench(20, "20 秒"));
  addBtn(panel, "長測 3 分", "lab-btn", () => api.bench(180, "3 分鐘"));
  addBtn(panel, "停 30 秒再測 1 分", "lab-btn", () => {
    if (loading || benchState === "warmup" || benchState === "running") return;
    engine.stopRenderLoop();
    resting = true;
    updateStatus();
    setTimeout(() => {
      resting = false;
      engine.runRenderLoop(loop);
      api.bench(60, "停 30 秒後 1 分");
    }, 30000);
  });
  const copyBtn = addBtn(panel, "複製報告", "lab-btn lab-demo", () => {
    const text = api.report();
    const done = (): void => {
      copyBtn.textContent = "已複製";
      setTimeout(() => (copyBtn.textContent = "複製報告"), 1500);
    };
    void navigator.clipboard?.writeText(text).then(done, () => {
      result.hidden = false;
      result.textContent = text;
    });
  });
  hudRoot.append(panel);

  const result = document.createElement("div");
  result.className = "lab-bench-result";
  result.hidden = true;
  result.dataset.c10bBench = "1";
  result.style.whiteSpace = "pre-wrap";
  result.style.maxHeight = "45vh";
  result.style.overflow = "auto";
  hudRoot.append(result);

  const stateEl = title.querySelector("[data-c10b-state]") as HTMLElement;
  let resting = false;
  function updateStatus(): void {
    if (!stateEl) return;
    const last = loads[loads.length - 1];
    const bs = benchState === "off" || benchState === "done" ? "" : `　測試中 ${Math.round(recProgress() * 100)}%`;
    stateEl.textContent = resting
      ? `停止繪製中（${opts.rest > 0 && benchState === "off" ? `載入後休息 ${opts.rest} 秒，之後自動開始測試` : "30 秒"}）…`
      : loading
      ? `載入 ${lod === "hq" ? "HQ" : "Lite"} 中…`
      : `${lod === "hq" ? "HQ" : "Lite"}　角色 ${chars.length}　載入 ${last ? (last.ms / 1000).toFixed(2) : "-"} 秒${contextLost ? `　⚠ Context Lost ×${contextLost}` : ""}${bs}`;
  }

  // ---------- 統計 ----------
  const triCount = (ms: AbstractMesh[]): number => ms.reduce((t, m) => t + Math.floor((m.getTotalIndices?.() ?? 0) / 3), 0);
  const gpuMemMB = (): number => {
    let bytes = 0;
    const seenGeo = new Set<string>();
    for (const c of chars)
      for (const m of c.meshes) {
        const geo = (m as unknown as { geometry?: { uniqueId: number; getTotalVertices(): number; getVerticesDataKinds(): string[]; getVerticesData(k: string): ArrayLike<number> | null; getTotalIndices(): number } }).geometry;
        if (!geo || seenGeo.has(String(geo.uniqueId))) continue;
        seenGeo.add(String(geo.uniqueId));
        for (const k of geo.getVerticesDataKinds()) bytes += (geo.getVerticesData(k)?.length ?? 0) * 4;
        bytes += geo.getTotalIndices() * 4;
      }
    const seenTex = new Set<BaseTexture>();
    for (const c of chars)
      for (const m of c.meshes)
        for (const t of m.material?.getActiveTextures() ?? []) {
          if (seenTex.has(t) || t === probe.cubeTexture) continue;
          seenTex.add(t);
          const s = t.getSize();
          bytes += s.width * s.height * 4 * 1.33;
        }
    return Math.round((bytes / 1048576) * 10) / 10;
  };

  // ---------- 效能測試 ----------
  let benchState: "off" | "warmup" | "running" | "done" = "off";
  let benchSec = 0;
  let benchLabel = "";
  let benchElapsed = 0;
  let dts: number[] = [];
  let draws: number[] = [];
  let lostAtStart = 0;
  let sizeAtStart: [number, number] = [0, 0];
  let samples: FrameSample[] = [];
  let shadowDrawsArr: number[] = [];
  let smRendersAtRun = -1;
  const resizeLog: { t: number; text: string }[] = [];
  let benchStartOpen = 0;
  let benchStartT = 0;
  let benchStartLoad = 0;
  let sizeChanges = 0;
  let frameNo = 0;
  let lastProbe = 0;
  let lastW = 0;
  let lastH = 0;
  let benchResult: BenchResult | null = null;
  const allResults: BenchResult[] = [];
  const recProgress = (): number => Math.min(1, benchElapsed / (benchSec + opts.warmup || 1));
  let auto = false;

  const shadowConfigText = (): string =>
    `貼圖 ${quality.shadows.mapSize}×${quality.shadows.mapSize}｜取樣 ${shadowFilterLabel()}｜刷新 ${opts.shadowRefresh === "once" ? `只畫一次（${smFrozenAt !== null ? `第 ${smFrozenAt} 次後停止` : "尚未停止"}）` : opts.p3 ? "有變化才重畫（P3-2）" : "每格"}｜投影者 ${shadowMap.renderList?.length ?? 0}`;
  const fmt = (r: BenchResult): string =>
    `${r.label}（${r.lod === "hq" ? "HQ" : "Lite"}、${r.count} 角色）平均 ${r.avgFps.toFixed(1)} FPS　1% Low ${r.low1Fps.toFixed(1)}　最低 ${r.minFps.toFixed(1)}　卡頓(>100ms) ${r.hitches100}　Draw ${r.avgDrawCalls.toFixed(0)}` +
    (r.windows.length > 1 ? `\n  每 30 秒平均：${r.windows.map((w) => w.toFixed(1)).join(" → ")}` : "") +
    (r.windows5.length > 1 ? `\n  每 5 秒平均：${r.windows5.map((w) => w.toFixed(0)).join(" ")}` : "") +
    (r.hist30.length ? `\n  每 30 秒影格分布（≤20ms／≤37ms／≤54ms／>54ms）：${r.hist30.map((h) => `${h.le20}/${h.le37}/${h.le54}/${h.gt54}`).join(" → ")}` : "") +
    `\n  渲染解析度 開始 ${r.renderSize[0]!.join("×")} 結束 ${r.renderSize[1]!.join("×")}（測試中改變 ${r.sizeChanges} 次）　${r.ab}　診斷：${r.diag}` +
    `\n  陰影模式 ${r.shadowMode}｜${r.shadowConfig}` +
    `\n  Draw Calls 平均：主場景 ${r.avgMainDraws}、陰影貼圖 ${r.avgShadowDraws}（總計 ${r.avgDrawCalls.toFixed(1)}）｜測試期間陰影貼圖更新 ${r.shadowRendersInTest} 次` +
    `\n  GPU 探測 ${r.gpuProbe ? "開" : "關"}｜畫布尺寸鎖定 ${r.fixSize ? "開" : "關"}｜視窗 resize 事件 ${r.resizeEvents.length} 次${r.resizeEvents.length ? `：${r.resizeEvents.join("；")}` : ""}` +
    `\n  開始測試時：開頁後 ${r.sinceOpen} 秒、最後一次載入後 ${r.sinceLoad} 秒` +
    `\n  時間軸（秒｜FPS｜CPU 平均/95%ms｜GPU探測ms｜影格 ≤20/≤37/≤54/>54ms）：` +
    r.timeline.map((w) => `\n   ${w.t0}s｜${w.fps}｜${w.cpuAvg}/${w.cpuP95}｜${w.gpuAvg ?? "-"}｜${w.le20}/${w.le37}/${w.le54}/${w.gt54}`).join("") +
    (r.contextLost ? `\n  ⚠ 測試中 WebGL Context Lost ×${r.contextLost}` : "");

  const api: C10bLabApi = {
    ready: false,
    get lod() {
      return lod;
    },
    get loading() {
      return loading;
    },
    setLod: async (l) => {
      if (loading) return;
      await load(l);
    },
    view: (v) => {
      auto = v === "free";
      if (v !== "free") {
        const c = C10B_VIEWS[v];
        camera.alpha = c.alpha;
        camera.beta = c.beta;
        camera.radius = opts.count > 2 ? c.radius + Math.sqrt(opts.count) * 0.9 : c.radius;
        camera.target.set(c.x ?? 0, c.y + BASE_Y, 0);
      }
      // 低角度：暫時隱藏地面與廣場地台（鏡頭在腳底下方）；其他視角恢復
      for (const m of groundMeshes) m.isVisible = !isLowView(v);
      for (const b of viewBtns) b.classList.toggle("active", b.dataset.view === v);
    },
    info: () => ({
      lod,
      chars: chars.map((c) => {
        let minY = Infinity;
        let maxY = -Infinity;
        let minX = Infinity;
        let maxX = -Infinity;
        for (const m of c.meshes) {
          m.computeWorldMatrix(true);
          m.refreshBoundingInfo({});
          const bb = m.getBoundingInfo().boundingBox;
          minY = Math.min(minY, bb.minimumWorld.y);
          maxY = Math.max(maxY, bb.maximumWorld.y);
          minX = Math.min(minX, bb.minimumWorld.x);
          maxX = Math.max(maxX, bb.maximumWorld.x);
        }
        return {
          gender: c.gender,
          meshes: c.meshes.filter((m) => m.getTotalVertices() > 0).length,
          triangles: triCount(c.meshes),
          height: +(maxY - minY).toFixed(3),
          width: +(maxX - minX).toFixed(3),
          feetY: +minY.toFixed(3),
          skeleton: c.meshes.some((m) => !!m.skeleton),
          animations: containers.get(c.gender)?.animationGroups.length ?? 0,
        };
      }),
      feet: chars.map((c) => {
        let y = Infinity;
        for (const m of c.meshes) {
          m.computeWorldMatrix(true);
          m.refreshBoundingInfo({});
          y = Math.min(y, m.getBoundingInfo().boundingBox.minimumWorld.y);
        }
        return +y.toFixed(3);
      }),
      baseY: +BASE_Y.toFixed(3),
      triangles: triCount(chars.flatMap((c) => c.meshes)),
      drawCalls: perf.drawCalls,
      activeMeshes: scene.getActiveMeshes().length,
      materials: new Set(chars.flatMap((c) => c.meshes.map((m) => m.material)).filter((m) => !!m)).size,
      textures: [...new Set(chars.flatMap((c) => c.meshes.flatMap((m) => m.material?.getActiveTextures() ?? [])))]
        .filter((t) => t !== probe.cubeTexture)
        .map((t) => ({ name: t.name.split("/").pop() ?? t.name, w: t.getSize().width, h: t.getSize().height })),
      gpuMemMB: gpuMemMB(),
      jsHeapMB: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory ? Math.round((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576) : null,
      shadowQuality: shadows.filteringQuality,
      msaa: render.pipeline ? render.pipeline.samples : 0,
      hdr: !!render.pipeline,
      quality: quality.level,
      pixelRatio: perf.pixelRatio,
      contextLost,
      loads,
      metalWithProbe,
      transparentMaterials: [...new Set(chars.flatMap((c) => c.meshes.map((m) => m.material)))].filter((m): m is Material => !!m && m.needAlphaBlending()).map((m) => m.name),
      reference: C10B_REFERENCE,
    }),
    bench: (seconds, label) => {
      if (loading || benchState === "warmup" || benchState === "running") return;
      benchSec = seconds;
      benchLabel = label ?? `${seconds} 秒`;
      benchElapsed = 0;
      dts = [];
      draws = [];
      samples = [];
      shadowDrawsArr = [];
      smRendersAtRun = -1;
      sizeChanges = 0;
      lostAtStart = contextLost;
      sizeAtStart = [engine.getRenderWidth(), engine.getRenderHeight()];
      benchStartOpen = Math.round(performance.now() / 1000);
      benchStartT = performance.now() / 1000;
      benchStartLoad = Math.round((performance.now() - lastLoadDone) / 1000);
      benchState = "warmup";
      api.view("free");
    },
    benchState: () => ({ state: benchState, progress: recProgress(), result: benchResult, all: allResults }),
    moveChar: (index: number, dx: number) => {
      const c = chars[index];
      if (c) c.root.position.x += dx;
    },
    renderInfo: () => ({
      p3: opts.p3,
      star: opts.star,
      pipeline: !!render.pipeline,
      canvasAntialias: !!(engine as unknown as { _gl: WebGLRenderingContext })._gl.getContextAttributes()?.antialias,
      glowEnabled: !!render.glow && render.glow.isEnabled,
      toneMappingInMaterials: !render.pipeline && scene.imageProcessingConfiguration.toneMappingEnabled,
      shadowSkipped: smSkipped,
      files: loads[loads.length - 1]?.files.map((f) => f.file) ?? [],
    }),
    shadowState: () => ({
      renders: smRenders,
      frozenAt: smFrozenAt,
      refreshRate: shadowMap.refreshRate,
      mapSize: shadowMap.getSize().width,
      contact: shadows.useContactHardeningShadow,
      pcf: shadows.usePercentageCloserFiltering,
      filteringQuality: shadows.filteringQuality,
      casters: shadowMap.renderList?.length ?? 0,
      lastFrameShadowDraws: smDrawsFrame,
      counter: !!drawCounter,
      mode: c10pShadowMode(opts),
    }),
    breakdown: async () => {
      const frame = (): Promise<void> => new Promise((r) => scene.onAfterRenderObservable.addOnce(() => r()));
      const measure = async (): Promise<{ draws: number; tris: number }> => {
        await frame();
        await frame();
        return { draws: perf.drawCalls, tris: Math.round(scene.getActiveIndices() / 3) };
      };
      const charMeshes = chars.flatMap((c) => c.meshes);
      const sm = shadows.getShadowMap();
      const smList = sm?.renderList ? [...sm.renderList] : [];
      const all = await measure();
      // 1) 角色全部隱藏
      for (const m of charMeshes) m.setEnabled(false);
      const noChars = await measure();
      for (const m of charMeshes) m.setEnabled(true);
      // 2) 發光層（GlowLayer）關閉
      let noGlow = all;
      if (render.glow) {
        const was = render.glow.isEnabled;
        render.glow.isEnabled = false;
        noGlow = await measure();
        render.glow.isEnabled = was;
      }
      // 3) 陰影貼圖不畫任何物件
      let noShadow = all;
      if (sm?.renderList) {
        sm.renderList.length = 0;
        noShadow = await measure();
        sm.renderList.push(...smList);
      }
      // 4) 後製（HDR 管線）關閉
      const postWas = scene.postProcessesEnabled;
      scene.postProcessesEnabled = false;
      const noPost = await measure();
      scene.postProcessesEnabled = postWas;
      const after = await measure();
      const charSet = new Set<AbstractMesh>(charMeshes);
      const glowAll = !!render.glow && (render.glow as unknown as { _includedOnlyMeshes?: number[] })._includedOnlyMeshes?.length === 0;
      return {
        quality: quality.level,
        renderSize: [engine.getRenderWidth(), engine.getRenderHeight()],
        canvasCss: [canvas.clientWidth, canvas.clientHeight],
        hardwareScaling: engine.getHardwareScalingLevel(),
        devicePixelRatio: window.devicePixelRatio,
        msaa: render.pipeline?.samples ?? 0,
        fxaa: render.pipeline?.fxaaEnabled ?? false,
        hdr: !!render.pipeline,
        ab: c10pAbLabel(opts),
        merge: opts.p2 ? mergeLog.slice(0, 2) : null,
        glow: render.glow ? { enabled: true, rendersAllMeshes: glowAll && glowExcluded === 0, excluded: glowExcluded, ratio: quality.bloom.textureRatio, kernel: quality.bloom.kernel } : null,
        shadow: { mapSize: quality.shadows.mapSize, filter: quality.shadows.filter, casters: smList.length, characterCasters: smList.filter((m) => charSet.has(m as AbstractMesh)).length },
        meshes: { character: charMeshes.length, activeTotal: scene.getActiveMeshes().length, sceneTotal: scene.meshes.length },
        materials: { character: new Set(charMeshes.map((m) => m.material)).size, scene: scene.materials.length },
        lod,
        draws: { all: all.draws, noChars: noChars.draws, noGlow: noGlow.draws, noShadow: noShadow.draws, noPost: noPost.draws, after: after.draws },
        tris: { mainPass: all.tris, mainPassNoChars: noChars.tris },
        share: {
          characters: all.draws - noChars.draws,
          glowLayer: all.draws - noGlow.draws,
          shadowMap: all.draws - noShadow.draws,
          postProcess: all.draws - noPost.draws,
        },
      };
    },
    report: () => {
      const i = api.info();
      const ua = navigator.userAgent;
      const lines = [
        `星願物語 C1.0-B 實機測試報告　${c10pAbLabel(opts)}　${new Date().toLocaleString()}`,
        `裝置：${ua}`,
        `螢幕：${screen.width}×${screen.height} @${window.devicePixelRatio}x　畫布 ${engine.getRenderWidth()}×${engine.getRenderHeight()}　解析度倍率 ${i.pixelRatio}　畫質 ${i.quality}　HDR ${i.hdr}　MSAA ${i.msaa}　陰影品質 ${i.shadowQuality}`,
        `診斷開關：${diagLabel}　GPU 探測 ${opts.gpuProbe ? "開" : "關"}　畫布鎖定 ${opts.fixSize ? "開" : "關"}　載入後休息 ${opts.rest} 秒`,
        `陰影模式 ${c10pShadowMode(opts)}｜${shadowConfigText()}｜目前累計更新 ${smRenders} 次`,
        `渲染組合：${opts.p3 ? "P3-2 優化" : "原始 HQ"}｜HDR 後製管線 ${render.pipeline ? `開（MSAA ${render.pipeline.samples}x）` : "關（色調映射在材質內）"}｜畫布 MSAA ${(engine as unknown as { _gl: WebGLRenderingContext })._gl.getContextAttributes()?.antialias ? "開" : "關"}｜發光層 ${render.glow ? (render.glow.isEnabled ? "開" : "暫停") : "無"}｜男生模型 ${opts.star ? "C1.0-B1（徽記修正）" : "C1.0-B"}`,
        ...(opts.p3 ? C10P_P3_ITEMS.map((t) => `  · ${t}`) : []),
        `目前：${i.lod === "hq" ? "HQ" : "Lite"}　角色 ${i.chars.length}　三角形 ${i.triangles}　Draw Calls ${i.drawCalls}　材質 ${i.materials}　貼圖 ${i.textures.map((t) => `${t.w}×${t.h}`).join("、")}`,
        `估計 GPU 記憶體（角色幾何＋貼圖）${i.gpuMemMB} MB${i.jsHeapMB != null ? `　JS heap ${i.jsHeapMB} MB` : "　（Safari 不提供 JS 記憶體數據）"}`,
        `載入：` + i.loads.map((l) => `${l.lod === "hq" ? "HQ" : "Lite"} ${(l.ms / 1000).toFixed(2)} 秒（${l.files.map((f) => `${f.file} ${(f.bytes / 1048576).toFixed(2)} MB ${(f.ms / 1000).toFixed(2)} 秒`).join("、")}）`).join("；"),
        `WebGL Context Lost：${i.contextLost} 次`,
        `角色：` + i.chars.slice(0, 2).map((c) => `${c.gender === "male" ? "男" : "女"} 高 ${c.height} m 寬 ${c.width} m 網格 ${c.meshes} 三角形 ${c.triangles} 骨架 ${c.skeleton ? "有" : "無"} 動畫 ${c.animations}`).join("；"),
        ...allResults.map(fmt),
      ];
      return lines.join("\n");
    },
  };
  window.__starwishC10b = api;

  await load(lod);
  api.view(opts.view);

  const gl = (engine as unknown as { _gl: WebGLRenderingContext })._gl;
  function loop(): void {
    const dt = engine.getDeltaTime() / 1000;
    if (auto) camera.alpha += dt * 0.5;
    const t0 = performance.now();
    smDrawsFrame = 0;
    if (opts.p3 && opts.shadowRefresh !== "once") {
      if (shadowDirty.check()) shadowMap.resetRefreshCounter();
      else smSkipped++;
    }
    scene.render();
    const cpu = performance.now() - t0;
    let gpu: number | null = null;
    frameNo++;
    // 每 0.5 秒量一次（約每 15～30 格）：gl.finish() 會等 GPU 畫完，所以這格的時間 ≈ CPU 提交＋GPU 執行
    if (opts.gpuProbe && t0 - lastProbe >= 500) {
      gl.finish();
      gpu = performance.now() - t0;
      lastProbe = t0;
    }
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    if ((w !== lastW || h !== lastH) && benchState === "running") sizeChanges++;
    lastW = w;
    lastH = h;
    perf.update(dt);
    if (benchState === "warmup" || benchState === "running") {
      benchElapsed += dt;
      if (benchElapsed > opts.warmup) {
        benchState = "running";
        if (smRendersAtRun < 0) smRendersAtRun = smRenders;
        dts.push(dt);
        draws.push(perf.drawCalls);
        shadowDrawsArr.push(smDrawsFrame);
        samples.push({ dt, cpu, gpu });
      }
      if (benchElapsed >= benchSec + opts.warmup) {
        benchState = "done";
        const s = summarizeFrames(dts, draws);
        benchResult = {
          ...s,
          label: benchLabel,
          ab: c10pAbLabel(opts),
          lod,
          count: chars.length,
          hitches100: countHitches(dts, 100),
          windows: windowAverages(dts, 30),
          windows5: windowAverages(dts, 5),
          hist30: windowHistograms(dts, 30),
          renderSize: [sizeAtStart, [engine.getRenderWidth(), engine.getRenderHeight()]],
          timeline: frameTimeline(samples, 5),
          sinceOpen: benchStartOpen,
          sinceLoad: benchStartLoad,
          sizeChanges,
          diag: `${diagLabel}${opts.gpuProbe ? "（GPU 探測開啟：每 0.5 秒多等一次 GPU）" : ""}`,
          shadowMode: c10pShadowMode(opts),
          shadowConfig: shadowConfigText(),
          shadowRendersInTest: smRenders - Math.max(0, smRendersAtRun),
          shadowFrozen: smFrozenAt !== null,
          avgShadowDraws: +(shadowDrawsArr.reduce((a, b) => a + b, 0) / Math.max(1, shadowDrawsArr.length)).toFixed(1),
          avgMainDraws: +((draws.reduce((a, b) => a + b, 0) - shadowDrawsArr.reduce((a, b) => a + b, 0)) / Math.max(1, draws.length)).toFixed(1),
          gpuProbe: opts.gpuProbe,
          fixSize: opts.fixSize,
          resizeEvents: resizeLog.filter((e) => e.t >= benchStartT).map((e) => e.text),
          contextLost: contextLost - lostAtStart,
        };
        allResults.push(benchResult);
        result.hidden = false;
        result.textContent = `效能測試結果\n${allResults.map(fmt).join("\n")}\n解析度 ${perf.pixelRatio}x　畫質 ${quality.level}`;
        api.view("front");
      }
      if (Math.round(benchElapsed * 2) !== Math.round((benchElapsed - dt) * 2)) updateStatus();
    }
  }
  // P3-1：視窗尺寸改變（Safari 工具列收放、轉向）全部記錄；?fixsize=1 時測試期間不改畫布尺寸
  window.addEventListener("resize", () => {
    const testing = benchState === "warmup" || benchState === "running";
    const apply = !(opts.fixSize && testing);
    if (apply) engine.resize();
    const vv = window.visualViewport;
    resizeLog.push({
      t: performance.now() / 1000,
      text: `${(performance.now() / 1000).toFixed(1)}s 視窗 ${window.innerWidth}×${window.innerHeight}${vv ? ` 可視 ${Math.round(vv.width)}×${Math.round(vv.height)}` : ""}${apply ? "（已套用）" : "（測試中鎖定，未套用）"}`,
    });
  });
  const startAll = (): void => {
    resting = false;
    engine.runRenderLoop(loop);
    if (opts.bench > 0) api.bench(opts.bench, `${opts.bench} 秒（自動${opts.rest ? `，載入後先停 ${opts.rest} 秒` : ""}）`);
    updateStatus();
  };
  api.ready = true;
  if (opts.rest > 0) {
    // 載入後先停止繪製，讓每一組都從相同狀態開始
    resting = true;
    updateStatus();
    setTimeout(startAll, opts.rest * 1000);
  } else {
    startAll();
  }
}
