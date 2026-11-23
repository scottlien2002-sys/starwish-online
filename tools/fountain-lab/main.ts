// Stage 6 P3 星芽村預覽頁（獨立頁面，不屬於遊戲、不部署；只在 Blender 美術工作流程裡建置並截圖）
// P3-2A：星願之泉（P3-1B 定版，不改）＋中央廣場；周圍建築、高台、石階、傳送門用灰色量體示意（V1.3 座標）
// 網址參數：?lod=hq|lite&quality=high|medium|low
import "@babylonjs/loaders/glTF";
import {
  type AbstractMesh,
  ArcRotateCamera,
  Camera,
  Color3,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  SceneInstrumentation,
  SceneLoader,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import { createEngine, createShadows, createSkyDome, pickQuality, setupRendering, SKY_COLORS } from "../../src/render/RenderQuality.ts";
import { type FountainP3, setupFountainP3 } from "../../src/maps/village/FountainP3.ts";
import { type PlazaP3, setupPlazaP3 } from "../../src/maps/village/PlazaP3.ts";
import { BOARD, BUILDINGS, buildingCenter, FORGE, NPC_SPOTS, PLATFORM, PORTALS, portalPillars, SOUTH_GATE, STAIR_FROM, STAIR_WIDTH, STAIRS } from "../../src/maps/village/layout.ts";

type View = { target: [number, number, number]; alpha: number; beta: number; radius: number; fov?: number; ortho?: number };
const H = Math.PI / 2;
/** 鏡頭位於目標的方位（北＝0°，順時針）→ ArcRotateCamera alpha */
const alphaFrom = (bearing: number): number => {
  const t = (bearing * Math.PI) / 180;
  return Math.atan2(Math.cos(t), Math.sin(t));
};
const VIEWS: Record<string, View> = {
  // 俯視（正交）：廣場＋道路入口；全村
  top: { target: [0, 0, 0], alpha: -H, beta: 0.0001, radius: 80, ortho: 24 },
  topwide: { target: [0, 0, 0], alpha: -H, beta: 0.0001, radius: 120, ortho: 52 },
  // 玩家視角（遊戲鏡頭：距離 9、beta 1.05、目標高 0.85、fov 0.9）：創角出生點面向北
  player_spawn: { target: [0, 0.85, -12.5], alpha: -H, beta: 1.05, radius: 9, fov: 0.9 },
  // 玩家視角：從南路走進廣場
  player_south: { target: [0, 0.85, -24], alpha: -H, beta: 1.12, radius: 9, fov: 0.9 },
  // 斜角全景
  pano: { target: [0, 1, -1], alpha: alphaFrom(215), beta: 0.98, radius: 50, fov: 0.8 },
  pano_ne: { target: [0, 1.5, 3], alpha: alphaFrom(55), beta: 1.0, radius: 48, fov: 0.8 },
  // 近景
  close_bench: { target: [4.6, 0.7, -7.4], alpha: alphaFrom(170), beta: 1.18, radius: 5.2, fov: 0.8 },
  close_lamp: { target: [11.96, 1.9, -14.25], alpha: alphaFrom(318), beta: 1.36, radius: 6.2, fov: 0.8 },
  close_compass: { target: [0, 0, -14.4], alpha: -H, beta: 0.62, radius: 7.5, fov: 0.8 },
  close_wall: { target: [-12.6, 1.0, 18.6], alpha: alphaFrom(150), beta: 1.2, radius: 10, fov: 0.8 },
};

const params = new URLSearchParams(location.search);
const lite = params.get("lod") === "lite";
const q = pickQuality();
const canvas = document.getElementById("c") as HTMLCanvasElement;
const engine = createEngine(canvas, q);
const scene = new Scene(engine);
createSkyDome(scene);
scene.ambientColor = new Color3(0.35, 0.33, 0.4);
scene.fogMode = Scene.FOGMODE_LINEAR;
scene.fogStart = lite ? 60 : 75;
scene.fogEnd = lite ? 150 : 190;
scene.fogColor = SKY_COLORS.fog.clone();

// 光源與星芽村 VillagePage 相同
const hemi = new HemisphericLight("skyLight", new Vector3(0.2, 1, 0.1), scene);
hemi.intensity = 0.8;
hemi.diffuse = new Color3(1, 0.98, 1);
hemi.groundColor = new Color3(0.62, 0.66, 0.62);
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
const shadows = createShadows(sun, q);
shadows.darkness = 0.35;
const castShadows = q.shadows.filter === "contact";

const camera = new ArcRotateCamera("cam", -H, 1.05, 9, new Vector3(0, 0.85, -12.5), scene);
camera.minZ = 0.1;
camera.maxZ = 600;
camera.attachControl(canvas, true);
const render = setupRendering(scene, camera, q);
if (render.glow) render.glow.isEnabled = false; // 與村莊相同：不開全畫面發光層

// ---------------- 灰色量體（只為了看比例；正式建築在之後的批次） ----------------
const flat = (name: string, rgb: [number, number, number], two = false): StandardMaterial => {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(...rgb);
  m.specularColor = Color3.Black();
  if (two) {
    m.backFaceCulling = false;
    m.twoSidedLighting = true;
  }
  return m;
};
const context: Mesh[] = [];
const grass = MeshBuilder.CreateDisc("grass", { radius: 70, tessellation: 72 }, scene);
grass.rotation.x = H;
grass.position.y = -0.02;
grass.material = flat("grassM", [0.56, 0.72, 0.42]);
grass.receiveShadows = true;
const greyM = flat("greyM", [0.8, 0.8, 0.82], true);
const roofM = flat("roofM", [0.64, 0.68, 0.76], true);
const platM = flat("platM", [0.78, 0.76, 0.7], true);

// 北側高台（r 23～49、方位 281°→44°、高 2 m）
{
  const pos: number[] = [];
  const idx: number[] = [];
  const a0 = PLATFORM.from;
  const a1 = PLATFORM.to + 360;
  const n = 60;
  const P = (b: number, r: number, y: number): void => {
    const t = (b * Math.PI) / 180;
    pos.push(Math.sin(t) * r, y, Math.cos(t) * r);
  };
  for (let i = 0; i <= n; i++) {
    const b = a0 + ((a1 - a0) * i) / n;
    P(b, PLATFORM.r0, 0);
    P(b, PLATFORM.r0, PLATFORM.height);
    P(b, PLATFORM.r1, PLATFORM.height);
  }
  for (let i = 0; i < n; i++) {
    const k = i * 3;
    idx.push(k, k + 3, k + 4, k, k + 4, k + 1, k + 1, k + 4, k + 5, k + 1, k + 5, k + 2);
  }
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  const nrm: number[] = [];
  VertexData.ComputeNormals(pos, idx, nrm);
  vd.normals = nrm;
  const plat = new Mesh("platform", scene);
  vd.applyToMesh(plat);
  plat.material = platM;
  context.push(plat);
}
// 石階（5 階）
for (const s of STAIRS) {
  for (let k = 0; k < 5; k++) {
    const h = ((k + 1) * PLATFORM.height) / 5;
    const st = MeshBuilder.CreateBox("stair", { width: STAIR_WIDTH, height: h, depth: 1 }, scene);
    const t = (s * Math.PI) / 180;
    const r = STAIR_FROM + k + 0.5;
    st.position.set(Math.sin(t) * r, h / 2, Math.cos(t) * r);
    st.rotation.y = t;
    st.material = greyM;
    context.push(st);
  }
}
// 建築量體：主體＋屋頂（只示意輪廓）
for (const b of BUILDINGS) {
  const c = buildingCenter(b);
  const t = (b.bearing * Math.PI) / 180;
  const body = MeshBuilder.CreateBox(`bld_${b.id}`, { width: b.w, height: b.eave, depth: b.d }, scene);
  body.position.set(c.x, b.floor + b.eave / 2, c.z);
  body.rotation.y = t;
  body.material = greyM;
  context.push(body);
  const rh = b.top - b.eave;
  const roof = MeshBuilder.CreateCylinder(`roof_${b.id}`, { diameterTop: 0, diameterBottom: Math.max(b.w, b.d) * 1.1, height: rh, tessellation: b.shape === "tent" ? 12 : 4 }, scene);
  roof.position.set(c.x, b.floor + b.eave + rh / 2, c.z);
  roof.rotation.y = t + (b.shape === "tent" ? 0 : Math.PI / 4);
  roof.material = roofM;
  context.push(roof);
}
// 鍛造台、佈告欄、南門柱
for (const o of [
  { x: FORGE.x, z: FORGE.z, w: FORGE.w, d: FORGE.d, h: 1.6, r: FORGE.rot },
  { x: BOARD.x, z: BOARD.z, w: BOARD.w, d: BOARD.d, h: 2.6, r: BOARD.rot },
]) {
  const m = MeshBuilder.CreateBox("fixture", { width: o.w, height: o.h, depth: o.d }, scene);
  m.position.set(o.x, o.h / 2, o.z);
  m.rotation.y = o.r;
  m.material = greyM;
  context.push(m);
}
for (const x of [-SOUTH_GATE.halfW, SOUTH_GATE.halfW]) {
  const m = MeshBuilder.CreateCylinder("gate", { diameter: 1.0, height: 3.4, tessellation: 12 }, scene);
  m.position.set(x, 1.7, SOUTH_GATE.z);
  m.material = greyM;
  context.push(m);
}
// 傳送門：圓台＋4 根石柱（南門開放＝淡綠）
const openM = flat("openM", [0.6, 0.86, 0.7]);
for (const p of PORTALS) {
  const pad = MeshBuilder.CreateCylinder("portal", { diameter: p.r * 2, height: 0.12, tessellation: 40 }, scene);
  pad.position.set(p.x, p.floor + 0.06, p.z);
  pad.material = p.open ? openM : greyM;
  context.push(pad);
  for (const s of portalPillars(p)) {
    const pl = MeshBuilder.CreateBox("pillar", { width: 0.7, height: 3, depth: 0.7 }, scene);
    pl.position.set(s.x, p.floor + 1.5, s.z);
    pl.material = greyM;
    context.push(pl);
  }
}
// NPC 站位（粉紅色 1.25 m 佔位人形，與 Grey-box 相同）＋創角出生點的玩家參考
const npcM = flat("npcM", [0.95, 0.6, 0.72]);
for (const n of NPC_SPOTS) {
  const m = MeshBuilder.CreateCapsule("npc", { radius: 0.3, height: 1.25 }, scene);
  m.position.set(n.x, n.floor + 0.625, n.z);
  m.material = npcM;
  context.push(m);
}
const player = MeshBuilder.CreateCapsule("player", { radius: 0.3, height: 1.25 }, scene);
player.position.set(0, 0.03 + 0.625, -12.5);
player.material = flat("playerM", [0.98, 0.45, 0.55]);
context.push(player);
for (const m of context) {
  m.receiveShadows = true;
  m.isPickable = false;
  if (castShadows) shadows.addShadowCaster(m, false);
}

const inst = new SceneInstrumentation(scene);
inst.captureFrameTime = true;
let fx: FountainP3 | null = null;
let plaza: PlazaP3 | null = null;
const state: { ready: boolean; error: string | null; loadMs: number } = { ready: false, error: null, loadMs: 0 };

function setView(name: string): void {
  const v = VIEWS[name];
  if (!v) return;
  camera.target.set(...v.target);
  camera.alpha = v.alpha;
  camera.beta = v.beta;
  camera.radius = v.radius;
  camera.fov = v.fov ?? 0.8;
  if (v.ortho) {
    const asp = engine.getRenderWidth() / engine.getRenderHeight();
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    camera.orthoTop = v.ortho;
    camera.orthoBottom = -v.ortho;
    camera.orthoLeft = -v.ortho * asp;
    camera.orthoRight = v.ortho * asp;
  } else {
    camera.mode = Camera.PERSPECTIVE_CAMERA;
  }
}

const frames = (n: number): Promise<void> =>
  new Promise((ok) => {
    let i = 0;
    const o = scene.onAfterRenderObservable.add(() => {
      if (++i >= n) {
        scene.onAfterRenderObservable.remove(o);
        ok();
      }
    });
  });

/** 閃爍檢查：逐幀微移鏡頭，統計相鄰兩幀亮度突變 > 40/255 的像素比例（readPixels 由下往上，只看畫面下方 70%） */
async function flickerTest(view: string, steps = 10): Promise<{ maxRatio: number; meanRatio: number }> {
  engine.stopRenderLoop();
  setView(view);
  fx?.setTime(3.2);
  const w = engine.getRenderWidth();
  const h = engine.getRenderHeight();
  let prev: Uint8Array | null = null;
  const ratios: number[] = [];
  for (let k = 0; k <= steps; k++) {
    camera.alpha += 0.0012;
    scene.render();
    const v8 = await engine.readPixels(0, 0, w, h, true, false);
    const px = new Uint8Array(v8.buffer, v8.byteOffset, v8.byteLength);
    if (prev) {
      let big = 0;
      let n = 0;
      for (let y = 0; y < Math.floor(h * 0.7); y += 2) {
        for (let x = 0; x < w; x += 2) {
          const i = (y * w + x) * 4;
          const l1 = (px[i] ?? 0) * 0.3 + (px[i + 1] ?? 0) * 0.59 + (px[i + 2] ?? 0) * 0.11;
          const l0 = (prev[i] ?? 0) * 0.3 + (prev[i + 1] ?? 0) * 0.59 + (prev[i + 2] ?? 0) * 0.11;
          if (Math.abs(l1 - l0) > 40) big++;
          n++;
        }
      }
      ratios.push(big / n);
    }
    prev = px;
  }
  engine.runRenderLoop(() => scene.render());
  return { maxRatio: Math.max(...ratios), meanRatio: ratios.reduce((a, b) => a + b, 0) / ratios.length };
}

/** 繪製次數：只開啟指定部分 */
async function drawCalls(parts: { fountain: boolean; plaza: boolean }): Promise<{ drawCalls: number; activeMeshes: number }> {
  fx?.setEnabled(parts.fountain);
  plaza?.setEnabled(parts.plaza);
  await frames(4);
  const r = { drawCalls: inst.drawCallsCounter.current, activeMeshes: scene.getActiveMeshes().length };
  fx?.setEnabled(true);
  plaza?.setEnabled(true);
  return r;
}

async function loadGlb(file: string): Promise<{ meshes: AbstractMesh[]; root: TransformNode }> {
  const c = await SceneLoader.LoadAssetContainerAsync("./models/", file, scene);
  c.addAllToScene();
  const root = new TransformNode(`root_${file}`, scene);
  for (const n of c.rootNodes) n.parent = root;
  return { meshes: c.meshes.filter((m): m is AbstractMesh => m.getTotalIndices() > 0), root };
}

async function load(): Promise<void> {
  const t0 = performance.now();
  const q2 = lite ? "lite" : "hq";
  const f = await loadGlb(`fountain_${q2}.glb`);
  fx = setupFountainP3(scene, f.meshes, f.root, { lite, texBase: "./models/fx/", shadows: castShadows ? shadows : null });
  const p = await loadGlb(`plaza_${q2}.glb`);
  plaza = setupPlazaP3(scene, p.meshes, { lite, shadows: castShadows ? shadows : null });
  for (const m of [...f.meshes, ...p.meshes]) m.freezeWorldMatrix();
  await scene.whenReadyAsync();
  state.loadMs = Math.round(performance.now() - t0);
  state.ready = true;
}

engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());
load().catch((e: unknown) => {
  state.error = e instanceof Error ? e.message : String(e);
});

(window as unknown as Record<string, unknown>).__lab = {
  state,
  lite,
  quality: q.level,
  views: Object.keys(VIEWS),
  setView,
  setTime: (t: number | null) => fx?.setTime(t),
  frames,
  flickerTest,
  drawCalls,
  stats: () => ({ fountain: fx?.stats ?? null, plaza: plaza?.stats ?? null }),
  frameMs: () => inst.frameTimeCounter.lastSecAverage,
  size: () => ({ w: engine.getRenderWidth(), h: engine.getRenderHeight() }),
};
