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
  const engine = createEngine(canvas, quality);
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
  const shadows = createShadows(sun, quality);
  shadows.darkness = 0.35;
  const contactQ = contactShadowQuality(quality.shadows.filter, "v38r", renderExperimentsFromSearch(location.search));
  if (contactQ && shadows.useContactHardeningShadow) shadows.filteringQuality = contactQ === "medium" ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_HIGH;
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
  const render = setupRendering(scene, camera, quality);
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
    metalWithProbe = 0;
    mergeLog = [];
    performance.clearResourceTimings?.();
    const t0 = performance.now();
    const rec: LoadRecord = { lod: l, ms: 0, files: [] };
    await Promise.all(
      (["male", "female"] as C10bGender[]).map(async (g) => {
        const s = performance.now();
        const file = c10bFile(g, l);
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
    await scene.whenReadyAsync();
    rec.ms = Math.round(performance.now() - t0);
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
    `<div class="lab-name">男女初心者 C1.0-B <small>實機整合測試　${c10pAbLabel(opts)}</small></div>` +
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
  for (const v of ["front", "left45", "side", "back", "low", "lowBack", "head", "skirt", "free"] as C10bView[]) {
    const b = addBtn(views, v === "free" ? "旋轉" : C10B_VIEWS[v as Exclude<C10bView, "free">].label, "lab-view-btn", () => api.view(v));
    b.dataset.view = v;
    viewBtns.push(b);
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
  function updateStatus(): void {
    if (!stateEl) return;
    const last = loads[loads.length - 1];
    const bs = benchState === "off" || benchState === "done" ? "" : `　測試中 ${Math.round(recProgress() * 100)}%`;
    stateEl.textContent = loading
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
  let benchResult: BenchResult | null = null;
  const allResults: BenchResult[] = [];
  const recProgress = (): number => Math.min(1, benchElapsed / (benchSec + opts.warmup || 1));
  let auto = false;

  const fmt = (r: BenchResult): string =>
    `${r.label}（${r.lod === "hq" ? "HQ" : "Lite"}、${r.count} 角色）平均 ${r.avgFps.toFixed(1)} FPS　1% Low ${r.low1Fps.toFixed(1)}　最低 ${r.minFps.toFixed(1)}　卡頓(>100ms) ${r.hitches100}　Draw ${r.avgDrawCalls.toFixed(0)}` +
    (r.windows.length > 1 ? `\n  每 30 秒平均：${r.windows.map((w) => w.toFixed(1)).join(" → ")}` : "") +
    (r.windows5.length > 1 ? `\n  每 5 秒平均：${r.windows5.map((w) => w.toFixed(0)).join(" ")}` : "") +
    (r.hist30.length ? `\n  每 30 秒影格分布（≤20ms／≤37ms／≤54ms／>54ms）：${r.hist30.map((h) => `${h.le20}/${h.le37}/${h.le54}/${h.gt54}`).join(" → ")}` : "") +
    `\n  渲染解析度 開始 ${r.renderSize[0]!.join("×")} 結束 ${r.renderSize[1]!.join("×")}　${r.ab}` +
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
        camera.target.set(0, c.y + BASE_Y, 0);
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
      lostAtStart = contextLost;
      sizeAtStart = [engine.getRenderWidth(), engine.getRenderHeight()];
      benchState = "warmup";
      api.view("free");
    },
    benchState: () => ({ state: benchState, progress: recProgress(), result: benchResult, all: allResults }),
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
        render.glow.isEnabled = false;
        noGlow = await measure();
        render.glow.isEnabled = true;
      }
      // 3) 陰影貼圖不畫任何物件
      let noShadow = all;
      if (sm?.renderList) {
        sm.renderList.length = 0;
        noShadow = await measure();
        sm.renderList.push(...smList);
      }
      // 4) 後製（HDR 管線）關閉
      scene.postProcessesEnabled = false;
      const noPost = await measure();
      scene.postProcessesEnabled = true;
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
  if (opts.bench > 0) api.bench(opts.bench, `${opts.bench} 秒（自動）`);

  engine.runRenderLoop(() => {
    const dt = engine.getDeltaTime() / 1000;
    if (auto) camera.alpha += dt * 0.5;
    scene.render();
    perf.update(dt);
    if (benchState === "warmup" || benchState === "running") {
      benchElapsed += dt;
      if (benchElapsed > opts.warmup) {
        benchState = "running";
        dts.push(dt);
        draws.push(perf.drawCalls);
      }
      if (benchElapsed >= benchSec + opts.warmup) {
        benchState = "done";
        const s = summarizeFrames(dts, draws);
        benchResult = {
          ...s,
          label: benchLabel,
          ab: c10pAbLabel(opts),
        merge: opts.p2 ? mergeLog.slice(0, 2) : null,
          lod,
          count: chars.length,
          hitches100: countHitches(dts, 100),
          windows: windowAverages(dts, 30),
          windows5: windowAverages(dts, 5),
          hist30: windowHistograms(dts, 30),
          renderSize: [sizeAtStart, [engine.getRenderWidth(), engine.getRenderHeight()]],
          contextLost: contextLost - lostAtStart,
        };
        allResults.push(benchResult);
        result.hidden = false;
        result.textContent = `效能測試結果\n${allResults.map(fmt).join("\n")}\n解析度 ${perf.pixelRatio}x　畫質 ${quality.level}`;
        api.view("front");
      }
      if (Math.round(benchElapsed * 2) !== Math.round((benchElapsed - dt) * 2)) updateStatus();
    }
  });
  window.addEventListener("resize", () => engine.resize());
  api.ready = true;
  updateStatus();
}
