// Stage 6 P3-1B 星願之泉預覽頁（獨立頁面，不屬於遊戲、不部署；只在 Blender 美術工作流程裡建置並截圖）
// 網址參數：?lod=hq|lite&quality=high|medium|low
import "@babylonjs/loaders/glTF";
import {
  type AbstractMesh,
  ArcRotateCamera,
  Color3,
  DirectionalLight,
  HemisphericLight,
  MeshBuilder,
  Scene,
  SceneInstrumentation,
  SceneLoader,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { createEngine, createShadows, createSkyDome, pickQuality, setupRendering, SKY_COLORS } from "../../src/render/RenderQuality.ts";
import { type FountainP3, setupFountainP3 } from "../../src/maps/village/FountainP3.ts";

type View = { target: [number, number, number]; alpha: number; beta: number; radius: number };
const H = Math.PI / 2;
const VIEWS: Record<string, View> = {
  front: { target: [0, 2.6, 0], alpha: -H, beta: 1.4, radius: 24 },
  q45: { target: [0, 2.3, 0], alpha: -H + Math.PI / 4, beta: 1.12, radius: 23 },
  top: { target: [0, 0, 0], alpha: -H, beta: 0.02, radius: 30 },
  close: { target: [0, 5.25, 0], alpha: -H + 0.5, beta: 1.4, radius: 7.5 },
  falls: { target: [0, 1.4, -3.7], alpha: -H + 0.55, beta: 1.28, radius: 6.2 },
  game: { target: [0, 2.2, 0], alpha: -H + 0.25, beta: 1.36, radius: 17 },
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

const camera = new ArcRotateCamera("cam", -H, 1.4, 24, new Vector3(0, 2.6, 0), scene);
camera.minZ = 0.1;
camera.attachControl(canvas, true);
const render = setupRendering(scene, camera, q);
if (render.glow) render.glow.isEnabled = false; // 與村莊相同：不開全畫面發光層

// 地面：草地、廣場、噴泉步道（顏色與 Grey-box 相同）
const flat = (name: string, rgb: [number, number, number]): StandardMaterial => {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(...rgb);
  m.specularColor = Color3.Black();
  return m;
};
const grass = MeshBuilder.CreateDisc("grass", { radius: 60, tessellation: 64 }, scene);
grass.rotation.x = H;
grass.position.y = -0.02;
grass.material = flat("grassM", [0.56, 0.72, 0.42]);
const plaza = MeshBuilder.CreateCylinder("plaza", { diameter: 36, height: 0.08, tessellation: 72 }, scene);
plaza.material = flat("plazaM", [0.83, 0.79, 0.72]);
const walk = MeshBuilder.CreateCylinder("walk", { diameter: 22, height: 0.1, tessellation: 64 }, scene);
walk.position.y = 0.02;
walk.material = flat("walkM", [0.9, 0.87, 0.8]);
for (const m of [grass, plaza, walk]) m.receiveShadows = true;
// 1.25 m 角色參考
const ref = MeshBuilder.CreateCapsule("player", { radius: 0.3, height: 1.25 }, scene);
ref.position.set(5.6, 0.07 + 0.625, -7.9);
ref.material = flat("refM", [0.95, 0.6, 0.72]);
if (castShadows) shadows.addShadowCaster(ref);

const inst = new SceneInstrumentation(scene);
inst.captureFrameTime = true;
let fx: FountainP3 | null = null;
const state: { ready: boolean; error: string | null; loadMs: number } = { ready: false, error: null, loadMs: 0 };

function setView(name: string): void {
  const v = VIEWS[name];
  if (!v) return;
  camera.target.set(...v.target);
  camera.alpha = v.alpha;
  camera.beta = v.beta;
  camera.radius = v.radius;
}

/** 等 n 幀 */
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

/**
 * 閃爍檢查：停住渲染迴圈，逐幀微移鏡頭（或推進動畫時間），讀回畫面，統計「相鄰兩幀亮度突變 > 40/255」的像素比例。
 * Z-fighting／透明排序跳動會造成大量突變；正常的小位移只會讓少數邊緣像素改變。
 */
async function flickerTest(view: string, mode: "camera" | "time", steps = 10): Promise<{ maxRatio: number; meanRatio: number }> {
  engine.stopRenderLoop();
  setView(view);
  fx?.setTime(3.2);
  const w = engine.getRenderWidth();
  const h = engine.getRenderHeight();
  let prev: Uint8Array | null = null;
  const ratios: number[] = [];
  for (let k = 0; k <= steps; k++) {
    if (mode === "camera") camera.alpha += 0.0012;
    else fx?.setTime(3.2 + k / 60);
    scene.render();
    const view8 = await engine.readPixels(0, 0, w, h, true, false);
    const px = new Uint8Array(view8.buffer, view8.byteOffset, view8.byteLength);
    if (prev) {
      let big = 0;
      let n = 0;
      // 只看畫面下方 70%（readPixels 由下往上，所以是前 70% 列；避開天空）
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

async function drawCalls(withFountain: boolean): Promise<{ drawCalls: number; activeMeshes: number }> {
  fx?.setEnabled(withFountain);
  await frames(4);
  const r = { drawCalls: inst.drawCallsCounter.current, activeMeshes: scene.getActiveMeshes().length };
  fx?.setEnabled(true);
  return r;
}

async function load(): Promise<void> {
  const t0 = performance.now();
  const file = `fountain_${lite ? "lite" : "hq"}.glb`;
  const c = await SceneLoader.LoadAssetContainerAsync("./models/", file, scene);
  c.addAllToScene();
  const root = new TransformNode("fountainRoot", scene);
  for (const n of c.rootNodes) n.parent = root;
  const meshes = c.meshes.filter((m): m is AbstractMesh => m.getTotalIndices() > 0);
  fx = setupFountainP3(scene, meshes, root, { lite, texBase: "./models/fx/", shadows: castShadows ? shadows : null });
  for (const m of meshes) m.freezeWorldMatrix();
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
  stats: () => fx?.stats ?? null,
  frameMs: () => inst.frameTimeCounter.lastSecAverage,
  size: () => ({ w: engine.getRenderWidth(), h: engine.getRenderHeight() }),
};
