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
  PointerEventTypes,
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
import { type KnightP3, setupKnightP3 } from "../../src/maps/village/KnightP3.ts";
import { type MageP3, setupMageP3 } from "../../src/maps/village/MageP3.ts";
import { type BuildingP3, setupBuildingP3 } from "../../src/maps/village/BuildingP3.ts";
import { type PetMerchantP3, setupPetMerchantP3 } from "../../src/maps/village/PetMerchantP3.ts";
import { PetMerchantPanel } from "../../src/maps/village/PetMerchantPanel.ts";
import { PET_MERCHANT, petMerchantPathSamples, petMerchantPose } from "../../src/maps/village/petMerchant.ts";
import { villageTextures } from "../../src/maps/village/villageTextures.ts";
import { VILLAGE_SPAWN_CAMERA } from "../../src/maps/village/spawnCamera.ts";
import { BOARD, BUILDINGS, buildingCenter, FORGE, NPC_SPOTS, PLATFORM, PORTALS, portalPillars, SOUTH_GATE, STAIR_FROM, STAIR_WIDTH, STAIRS } from "../../src/maps/village/layout.ts";

type View = { target: [number, number, number]; alpha: number; beta: number; radius: number; fov?: number; ortho?: number; hide?: string[]; /** 寵物商人時間（固定姿勢） */ mt?: number };
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
  // 創角出生點、把遊戲鏡頭往上抬（看得到漂浮星晶）
  player_spawn_up: { target: [0, 0.85, -12.5], alpha: -H, beta: 1.32, radius: 9, fov: 0.9 },
  // P3-2E 正式出生點鏡頭（spawnCamera.ts 的實際設定：俯角 1.32、距離 9）
  player_spawn_cam: { target: [0, 0.85, -12.5], alpha: -H, beta: VILLAGE_SPAWN_CAMERA.beta, radius: VILLAGE_SPAWN_CAMERA.distance, fov: 0.9 },
  // 星晶動畫近景
  fountain_anim: { target: [0, 5.45, 0], alpha: -H + 0.35, beta: 1.42, radius: 6.8, fov: 0.8 },
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
  // 噴泉近景（與 P3-1B 預覽相同鏡頭，供前後對照）
  fountain_close: { target: [0, 5.25, 0], alpha: -H + 0.5, beta: 1.4, radius: 7.5, fov: 0.8 },
  fountain_falls: { target: [0, 1.4, -3.7], alpha: -H + 0.55, beta: 1.28, radius: 6.2, fov: 0.8 },
  fountain_q45: { target: [0, 2.3, 0], alpha: -H + Math.PI / 4, beta: 1.12, radius: 23, fov: 0.8 },
  // P3-2E：噴泉俯視（正交）、噴泉正面近景（從出生方向）
  fountain_top: { target: [0, 0, 0], alpha: -H, beta: 0.0001, radius: 60, ortho: 8.5 },
  fountain_front: { target: [0, 3.6, 0], alpha: -H, beta: 1.42, radius: 13, fov: 0.8 },
  fountain_water: { target: [2.2, 0.6, -3.6], alpha: alphaFrom(165), beta: 0.95, radius: 5.5, fov: 0.8 },
  // P3-2B 騎士軍團（正面中心在方位 332°、r 27；建築中心 r 34；地面 +2 m）
  knight_front: { target: [-15.0, 10.4, 28.2], alpha: alphaFrom(152), beta: 1.5, radius: 31, fov: 0.8 },
  knight_q45: { target: [-15.4, 9.0, 29.0], alpha: alphaFrom(197), beta: 1.3, radius: 33, fov: 0.8 },
  knight_q45r: { target: [-15.4, 9.0, 29.0], alpha: alphaFrom(107), beta: 1.3, radius: 33, fov: 0.8 },
  // 玩家視角：站在廣場（方位 332°、r 15）看騎士軍團；遊戲預設俯角＋把鏡頭往上抬
  knight_player: { target: [-7.04, 0.85, 13.24], alpha: alphaFrom(152), beta: 1.05, radius: 9, fov: 0.9 },
  knight_player_up: { target: [-7.04, 0.85, 13.24], alpha: alphaFrom(152), beta: 1.38, radius: 9, fov: 0.9 },
  // 玩家站在騎士 NPC 旁（高台上 r 25）看正門
  knight_npc: { target: [-10.8, 2.85, 22.9], alpha: alphaFrom(165), beta: 1.3, radius: 9, fov: 0.9 },
  // 站在廣場（方位 332°、r 14、眼高 1.7 m）抬頭看騎士軍團全貌（非遊戲鏡頭，展示輪廓用）
  knight_eye: { target: [-15.02, 9.5, 28.26], alpha: alphaFrom(152), beta: 1.98, radius: 19.5, fov: 1.0 },
  knight_door: { target: [-12.9, 7.6, 24.3], alpha: alphaFrom(152), beta: 1.5, radius: 13.5, fov: 0.8 },
  // P3-4 法師軍團「星詠之塔」（正面中心在方位 26°、r 27；建築中心 r 33.5 = (14.69, 30.11)；地面 +2 m）
  mage_front: { target: [14.69, 11.0, 30.11], alpha: alphaFrom(206), beta: 1.5, radius: 34, fov: 0.8 },
  mage_side: { target: [14.69, 11.0, 30.11], alpha: alphaFrom(116), beta: 1.5, radius: 34, fov: 0.8, hide: ["bld_church", "roof_church"] },
  mage_q45: { target: [14.69, 10.5, 30.11], alpha: alphaFrom(241), beta: 1.33, radius: 35, fov: 0.8 },
  mage_q45r: { target: [14.69, 10.5, 30.11], alpha: alphaFrom(161), beta: 1.33, radius: 35, fov: 0.8 },
  mage_top: { target: [14.69, 0, 30.11], alpha: alphaFrom(206), beta: 0.0001, radius: 80, ortho: 9.5 },
  // 玩家視角：站在廣場（方位 26°、r 15）看法師軍團；遊戲預設俯角＋往上抬
  mage_player: { target: [6.58, 0.85, 13.48], alpha: alphaFrom(206), beta: 1.05, radius: 9, fov: 0.9 },
  mage_player_up: { target: [6.58, 0.85, 13.48], alpha: alphaFrom(206), beta: 1.38, radius: 9, fov: 0.9 },
  // 入口動線：石階下（r 17.5）往上看；法師 NPC 旁（高台 r 25）看正門
  mage_stairs: { target: [8.33, 1.6, 17.08], alpha: alphaFrom(206), beta: 1.3, radius: 11, fov: 0.9 },
  mage_npc: { target: [10.96, 2.85, 22.47], alpha: alphaFrom(218), beta: 1.3, radius: 9, fov: 0.9 },
  // 站在廣場（方位 26°、r 14、眼高 1.7 m）抬頭看全貌（非遊戲鏡頭）
  mage_eye: { target: [14.69, 9.5, 30.11], alpha: alphaFrom(206), beta: 1.98, radius: 19.5, fov: 1.0 },
  // 北側整體：騎士軍團＋法師軍團＋星願之泉；北側高台俯視配置
  north_trio: { target: [0, 8.5, 20], alpha: -H, beta: 1.4, radius: 52, fov: 0.8 },
  north_plan: { target: [0, 0, 24], alpha: -H, beta: 0.0001, radius: 100, ortho: 21 },
  north_wide: { target: [-3, 7.5, 18], alpha: -H, beta: 1.36, radius: 64, fov: 0.85 },
  // P3-5 劍士軍團（正面中心在方位 297°、r 27；建築中心 r 33 = (-29.40, 14.98)；地面 +2 m）
  sword_front: { target: [-29.4, 7.8, 14.98], alpha: alphaFrom(117), beta: 1.5, radius: 30, fov: 0.8 },
  sword_side: { target: [-29.4, 7.8, 14.98], alpha: alphaFrom(207), beta: 1.5, radius: 30, fov: 0.8, hide: ["bld_smith", "roof_smith", "bld_warehouse", "roof_warehouse"] },
  sword_q45: { target: [-29.4, 7.2, 14.98], alpha: alphaFrom(162), beta: 1.3, radius: 31, fov: 0.8 },
  sword_q45r: { target: [-29.4, 7.2, 14.98], alpha: alphaFrom(72), beta: 1.3, radius: 31, fov: 0.8 },
  sword_top: { target: [-29.4, 0, 14.98], alpha: alphaFrom(117), beta: 0.0001, radius: 80, ortho: 8.5 },
  sword_player_up: { target: [-13.37, 0.85, 6.81], alpha: alphaFrom(117), beta: 1.38, radius: 9, fov: 0.9 },
  sword_stairs: { target: [-17.82, 1.6, 9.08], alpha: alphaFrom(117), beta: 1.3, radius: 11, fov: 0.9 },
  sword_npc: { target: [-22.28, 2.85, 11.35], alpha: alphaFrom(129), beta: 1.3, radius: 9, fov: 0.9 },
  sword_eye: { target: [-29.4, 9.5, 14.98], alpha: alphaFrom(117), beta: 1.98, radius: 19.5, fov: 1.0 },
  // P3-6 北側高台擋土牆與石階
  platform_front: { target: [0, 1.6, 23], alpha: -H, beta: 1.3, radius: 15, fov: 0.95 },
  village_top: { target: [0, 0, 0], alpha: -H, beta: 0.0001, radius: 45, ortho: 52, mt: 4 },
  ...petMerchantViews(),
  platform_stair: { target: [-9.62, 1.0, 18.1], alpha: alphaFrom(152), beta: 1.25, radius: 9, fov: 0.9 },
  platform_wall: { target: [-5.95, 1.0, 22.2], alpha: alphaFrom(165), beta: 1.42, radius: 7, fov: 0.85 },
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
let knight: KnightP3 | null = null;
let mage: MageP3 | null = null;
let sword: BuildingP3 | null = null;
let platformArt: BuildingP3 | null = null;
const state: { ready: boolean; error: string | null; loadMs: number } = { ready: false, error: null, loadMs: 0 };

/** 寵物商人預覽視角（第 1 個停留點 202.5°、商人時間 4 s；行走中 16 s） */
function petMerchantViews(): Record<string, View> {
  const s0 = petMerchantPose(4);
  const w = petMerchantPose(16);
  const b0 = PET_MERCHANT.stations[0]!;
  const me = (p: { x: number; z: number }, h: number): [number, number, number] => [p.x, h, p.z];
  const player = { x: Math.sin((b0 * Math.PI) / 180) * 13.6, z: Math.cos((b0 * Math.PI) / 180) * 13.6 };
  return {
    pm_front: { target: me(s0, 0.78), alpha: alphaFrom(b0), beta: 1.47, radius: 3.0, fov: 0.8, mt: 4 },
    pm_q45: { target: me(s0, 0.75), alpha: alphaFrom(b0 + 42), beta: 1.38, radius: 3.2, fov: 0.8, mt: 4 },
    pm_back: { target: me(s0, 0.8), alpha: alphaFrom(b0 + 135), beta: 1.36, radius: 3.0, fov: 0.8, mt: 4 },
    pm_plaza: { target: me(s0, 1.2), alpha: alphaFrom(b0 + 22), beta: 1.32, radius: 10, fov: 0.85, mt: 4 },
    pm_walk: { target: me(w, 0.75), alpha: alphaFrom(w.bearing + 70), beta: 1.38, radius: 4.2, fov: 0.8, mt: 16 },
    pm_spawn: { target: [0, 0.85, -12.5], alpha: -H, beta: VILLAGE_SPAWN_CAMERA.beta, radius: 9, fov: 0.9, mt: 4 },
    pm_iphone: { target: [player.x, 0.85, player.z], alpha: alphaFrom(b0), beta: 1.32, radius: 9, fov: 0.9, mt: 4 },
    pm_path: { target: [0, 0, 0], alpha: -H, beta: 0.0001, radius: 45, ortho: 14.5, mt: 4 },
    pm_anim: { target: [-5.6, 1.0, -9.2], alpha: alphaFrom(200), beta: 1.3, radius: 11, fov: 0.85 },
  };
}

/** 已由正式模型取代的灰色量體（setView 不會再打開） */
const REPLACED = new Set<string>(["knight", "mage"]);

let merchant: PetMerchantP3 | null = null;
let merchantT: number | null = null;
let merchantPath: AbstractMesh | null = null;
const petPanel = new PetMerchantPanel();

function setView(name: string): void {
  const v = VIEWS[name];
  if (!v) return;
  camera.target.set(...v.target);
  camera.alpha = v.alpha;
  camera.beta = v.beta;
  if (v.mt !== undefined) merchantT = v.mt;
  merchantPath?.setEnabled(name === "pm_path");
  // 個別視角暫時隱藏擋住鏡頭的灰色量體（例如側面圖前方的教堂量體）
  for (const m of context) if (m.name.startsWith("bld_") || m.name.startsWith("roof_")) {
    const id = m.name.slice(m.name.indexOf("_") + 1);
    if (!REPLACED.has(id)) m.setEnabled(!(v.hide ?? []).includes(m.name));
  }
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

/** 動畫閃爍檢查：鏡頭固定、每步推進 1/30 秒，統計相鄰兩幀亮度突變 > 40/255 的像素比例 */
async function flickerTime(view: string, steps = 30): Promise<{ maxRatio: number; meanRatio: number }> {
  engine.stopRenderLoop();
  setView(view);
  const w = engine.getRenderWidth();
  const h = engine.getRenderHeight();
  let prev: Uint8Array | null = null;
  const ratios: number[] = [];
  for (let k = 0; k <= steps; k++) {
    fx?.setTime(3.2 + k / 30);
    scene.render();
    const v8 = await engine.readPixels(0, 0, w, h, true, false);
    const px = new Uint8Array(v8.buffer, v8.byteOffset, v8.byteLength);
    if (prev) {
      let big = 0;
      let n = 0;
      for (let i = 0; i < px.length; i += 8) {
        const l1 = (px[i] ?? 0) * 0.3 + (px[i + 1] ?? 0) * 0.59 + (px[i + 2] ?? 0) * 0.11;
        const l0 = (prev[i] ?? 0) * 0.3 + (prev[i + 1] ?? 0) * 0.59 + (prev[i + 2] ?? 0) * 0.11;
        if (Math.abs(l1 - l0) > 40) big++;
        n++;
      }
      ratios.push(big / n);
    }
    prev = px;
  }
  engine.runRenderLoop(() => scene.render());
  return { maxRatio: Math.max(...ratios), meanRatio: ratios.reduce((a, b) => a + b, 0) / ratios.length };
}

/** 動畫短片：固定時間步進、直接在頁面內繪製並讀出畫布（比整頁截圖快很多），回傳 JPEG data URL 陣列 */
async function captureFrames(view: string, secs: number, fps: number, mt0?: number): Promise<string[]> {
  engine.stopRenderLoop();
  setView(view);
  const out: string[] = [];
  const n = Math.round(secs * fps);
  for (let k = 0; k < n; k++) {
    fx?.setTime(k / fps);
    if (mt0 !== undefined) merchantT = mt0 + k / fps;
    scene.render();
    out.push(canvas.toDataURL("image/jpeg", 0.9));
    if (k % 10 === 9) await new Promise((r) => setTimeout(r, 0));
  }
  fx?.setTime(3.2);
  engine.runRenderLoop(() => scene.render());
  return out;
}

/** 繪製次數：只開啟指定部分 */
async function drawCalls(parts: { fountain: boolean; plaza: boolean; knight?: boolean; mage?: boolean; sword?: boolean; platform?: boolean; merchant?: boolean }): Promise<{ drawCalls: number; activeMeshes: number }> {
  fx?.setEnabled(parts.fountain);
  plaza?.setEnabled(parts.plaza);
  knight?.setEnabled(parts.knight ?? true);
  mage?.setEnabled(parts.mage ?? true);
  sword?.setEnabled(parts.sword ?? true);
  platformArt?.setEnabled(parts.platform ?? true);
  merchant?.setEnabled(parts.merchant ?? true);
  await frames(4);
  const r = { drawCalls: inst.drawCallsCounter.current, activeMeshes: scene.getActiveMeshes().length };
  fx?.setEnabled(true);
  plaza?.setEnabled(true);
  knight?.setEnabled(true);
  mage?.setEnabled(true);
  sword?.setEnabled(true);
  platformArt?.setEnabled(true);
  merchant?.setEnabled(true);
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
  fx = setupFountainP3(scene, f.meshes, f.root, { lite, texBase: "./models/tex/", shadows: castShadows ? shadows : null });
  const p = await loadGlb(`plaza_${q2}.glb`);
  plaza = setupPlazaP3(scene, p.meshes, { lite, texBase: "./models/tex/", shadows: castShadows ? shadows : null });
  const k = await loadGlb(`knight_${q2}.glb`);
  knight = setupKnightP3(scene, k.meshes, { lite, texBase: "./models/tex/", shadows: castShadows ? shadows : null });
  // 正式騎士軍團取代灰色量體
  for (const m of context) if (m.name === "bld_knight" || m.name === "roof_knight") m.setEnabled(false);
  // P3-4：法師軍團造型提案取代灰色量體
  const mg = await loadGlb(`mage_${q2}.glb`);
  mage = setupMageP3(scene, mg.meshes, { lite, texBase: "./models/tex/", shadows: castShadows ? shadows : null });
  for (const m of context) if (m.name === "bld_mage" || m.name === "roof_mage") m.setEnabled(false);
  // P3-5 劍士軍團、P3-6 北側高台擋土牆與石階（取代灰色量體、灰色高台與石階）
  const sw = await loadGlb(`sword_${q2}.glb`);
  sword = setupBuildingP3(scene, sw.meshes, "Sword", { lite, texBase: "./models/tex/", shadows: castShadows ? shadows : null });
  const pf = await loadGlb(`platform_${q2}.glb`);
  platformArt = setupBuildingP3(scene, pf.meshes, "Platform", { lite, texBase: "./models/tex/", shadows: castShadows ? shadows : null, casters: [] });
  for (const m of context) if (["bld_sword", "roof_sword", "platform", "stair"].includes(m.name)) m.setEnabled(false);
  REPLACED.add("sword");
  // 寵物商人（沿噴泉巡走；不凍結）＋巡走路線示意線（只在 pm_path 視角顯示）
  const pm = await loadGlb(`pet_merchant_${q2}.glb`);
  merchant = setupPetMerchantP3(scene, pm.meshes, { lite, shadows: castShadows ? shadows : null });
  scene.onBeforeRenderObservable.add(() => merchant?.update(merchantT ?? performance.now() / 1000));
  const ring = petMerchantPathSamples(0.5).map((p) => new Vector3(p.x, 0.06, p.z));
  ring.push(ring[0]!.clone());
  const line = MeshBuilder.CreateTube("pm_path_line", { path: ring, radius: 0.09, tessellation: 6 }, scene);
  const lm = new StandardMaterial("pm_path_mat", scene);
  lm.disableLighting = true;
  lm.emissiveColor = new Color3(0.95, 0.35, 0.6);
  line.material = lm;
  const marks = PET_MERCHANT.stations.map((b, i) => {
    const d = MeshBuilder.CreateCylinder(`pm_station_${i}`, { diameter: 0.9, height: 0.05, tessellation: 16 }, scene);
    d.position.set(Math.sin((b * Math.PI) / 180) * PET_MERCHANT.patrolR, 0.07, Math.cos((b * Math.PI) / 180) * PET_MERCHANT.patrolR);
    d.material = lm;
    return d;
  });
  merchantPath = MeshBuilder.CreateBox("pm_path_root", { size: 0.01 }, scene);
  merchantPath.isVisible = false;
  for (const m of [line, ...marks]) m.parent = merchantPath;
  merchantPath.setEnabled(false);
  scene.onPointerObservable.add((pi) => {
    if (pi.type === PointerEventTypes.POINTERTAP && pi.pickInfo?.pickedMesh?.metadata?.petMerchant) void petPanel.open();
  });
  // 星晶每幀會動：不凍結它的世界矩陣
  for (const m of [...f.meshes, ...p.meshes, ...k.meshes, ...mg.meshes, ...sw.meshes, ...pf.meshes]) if (!fx.animated.includes(m)) m.freezeWorldMatrix();
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
  setMerchantTime: (t: number | null) => {
    merchantT = t;
  },
  /** 寵物商人對話面板：open／choose:<id>／kind:<kind>／back／close；回傳目前畫面文字 */
  petPanel: async (a: string) => {
    if (a === "open") await petPanel.open();
    else if (a === "close") petPanel.close();
    else {
      const el = document.querySelector<HTMLButtonElement>(`.pet-merchant-panel button[data-act="${a}"]`);
      el?.click();
      await new Promise((r) => setTimeout(r, 50));
    }
    return document.querySelector(".pet-merchant-panel")?.textContent ?? "";
  },
  frames,
  flickerTest,
  flickerTime,
  captureFrames,
  drawCalls,
  stats: () => ({ fountain: fx?.stats ?? null, plaza: plaza?.stats ?? null, knight: knight?.stats ?? null, mage: mage?.stats ?? null, sword: sword?.stats ?? null, platform: platformArt?.stats ?? null, merchant: merchant?.stats ?? null }),
  /** 全村共用貼圖快取：張數、像素、估計顯示記憶體（RGBA、含 mipmap ×1.33） */
  textureMemory: () => {
    const list = villageTextures(scene).map((t) => {
      const z = t.getSize();
      return { name: t.name.split("/").pop(), w: z.width, h: z.height };
    });
    const px = list.reduce((a, t) => a + t.w * t.h, 0);
    return { count: list.length, pixels: px, mb: +((px * 4 * 1.33) / 1048576).toFixed(2), list };
  },
  frameMs: () => inst.frameTimeCounter.lastSecAverage,
  size: () => ({ w: engine.getRenderWidth(), h: engine.getRenderHeight() }),
};
