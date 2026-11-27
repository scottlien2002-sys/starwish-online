import { Color3, DynamicTexture, Mesh, MeshBuilder, type Scene, type ShadowGenerator, StandardMaterial, TransformNode, Vector3, VertexData } from "@babylonjs/core";
import { bake, geoOf, joinGeo, type Geo, type Placed } from "../starsprout/StarsproutVegetation.ts";
import {
  ARRIVAL_SPOT,
  BOARD,
  BUILDINGS,
  CIRCLE_COLLIDERS,
  FORGE,
  FOUNTAIN,
  NPC_SPOTS,
  RESPAWN_SLOTS,
  PLATFORM,
  PORTALS,
  ROADS,
  ROAD_HALF,
  SOUTH_GATE,
  STAIRS,
  STAIR_FROM,
  STAIR_WIDTH,
  WALK_RADIUS,
  buildingCenter,
  polar,
  type BuildingDef,
} from "./layout.ts";

/**
 * Stage 6 P2-3 第一階段：星芽村 Grey-box（畫面層）。
 * 只有佔位模型：建築用正確尺寸的簡單體塊＋屋頂顏色區分，不是正式美術。
 * 全部靜態物件合併成 1 個頂點色網格；水面 1 個；標記（NPC、復活點、傳送陣、互動範圍）1 個；文字標籤另計。
 * 不使用發光層、不使用真實點光源。
 */

type RGB = [number, number, number];
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const noise = (x: number, y: number, z: number): number => Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 0.5 + 0.5;

const STONE: RGB = [0.86, 0.85, 0.82];
const STONE_DARK: RGB = [0.68, 0.67, 0.66];
const PLAZA: RGB = [0.83, 0.79, 0.72];
const WALKWAY: RGB = [0.9, 0.87, 0.8];
const ROAD: RGB = [0.8, 0.76, 0.68];
const GRASS: RGB = [0.56, 0.72, 0.42];
const HEDGE: RGB = [0.36, 0.55, 0.32];
const WOOD: RGB = [0.62, 0.45, 0.3];
const GOLD: RGB = [0.95, 0.78, 0.36];
const DOOR: RGB = [0.42, 0.3, 0.22];
const ROOF: Record<BuildingDef["id"], RGB> = {
  sword: [0.34, 0.47, 0.78],
  knight: [0.3, 0.42, 0.75],
  mage: [0.55, 0.42, 0.82],
  church: [0.48, 0.55, 0.72],
  circus: [0.86, 0.3, 0.28],
  warehouse: [0.38, 0.5, 0.74],
  smith: [0.45, 0.42, 0.7],
  guild: [0.3, 0.4, 0.68],
};
const WALL: Record<BuildingDef["id"], RGB> = {
  sword: [0.88, 0.85, 0.78],
  knight: [0.92, 0.91, 0.88],
  mage: [0.84, 0.82, 0.86],
  church: [0.95, 0.94, 0.9],
  circus: [0.97, 0.95, 0.92],
  warehouse: [0.8, 0.76, 0.7],
  smith: [0.78, 0.72, 0.64],
  guild: [0.95, 0.93, 0.88],
};

const lit = (c: RGB) => (px: number, py: number, pz: number, _nx: number, ny: number): RGB =>
  shade(c, (ny > 0.5 ? 1.06 : ny < -0.5 ? 0.78 : 0.97) * (0.96 + noise(px, py, pz) * 0.06));

function box(scene: Scene, w: number, h: number, d: number, x: number, y: number, z: number, c: RGB, ry = 0): Geo {
  const m = MeshBuilder.CreateBox("PH_vTmp", { width: w, height: h, depth: d }, scene);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  return geoOf(m, lit(c));
}
function cyl(scene: Scene, dTop: number, dBot: number, h: number, tess: number, x: number, y: number, z: number, c: RGB, rx = 0, ry = 0): Geo {
  const m = MeshBuilder.CreateCylinder("PH_vTmp", { diameterTop: dTop, diameterBottom: dBot, height: h, tessellation: tess }, scene);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, 0);
  return geoOf(m, lit(c));
}
/** 三角屋頂（屋脊沿本地 X）：寬 w、深 d、高 h，底部在 y */
function gable(scene: Scene, w: number, d: number, h: number, y: number, c: RGB, z = 0): Geo {
  const m = MeshBuilder.CreateBox("PH_vTmp", { width: w, height: h, depth: d }, scene);
  const pos = m.getVerticesData("position")!;
  for (let k = 0; k < pos.length; k += 3) if (pos[k + 1]! > 0) pos[k + 2] = 0;
  m.updateVerticesData("position", pos);
  const nrm: number[] = [];
  VertexData.ComputeNormals(pos, m.getIndices()!, nrm);
  m.updateVerticesData("normal", nrm);
  m.position.set(0, y + h / 2, z);
  return geoOf(m, lit(c));
}
function torus(scene: Scene, d: number, t: number, tess: number, x: number, y: number, z: number, c: RGB, rx = 0): Geo {
  const m = MeshBuilder.CreateTorus("PH_vTmp", { diameter: d, thickness: t, tessellation: tess }, scene);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  return geoOf(m, lit(c));
}

/** 建築佔位：本地座標，正門朝 -Z（朝噴泉），地面 y=0 */
function buildingGeo(scene: Scene, b: BuildingDef): Geo {
  const wall = WALL[b.id];
  const roof = ROOF[b.id];
  const p: Geo[] = [];
  const hw = b.w / 2;
  const hd = b.d / 2;
  const door = (w: number, h: number, z = -hd): void => {
    p.push(box(scene, w, h, 0.25, 0, h / 2, z - 0.1, DOOR));
    p.push(box(scene, w + 0.5, 0.3, 0.3, 0, h + 0.15, z - 0.12, GOLD));
  };
  switch (b.shape) {
    case "hall": {
      p.push(box(scene, b.w, b.eave, b.d, 0, b.eave / 2, 0, wall));
      p.push(gable(scene, b.w + 0.8, b.d + 1, b.top - b.eave - 2, b.eave, roof));
      for (const sx of [-1, 1]) {
        p.push(cyl(scene, 2.2, 2.2, b.eave + 1.5, 10, sx * (hw - 1.2), (b.eave + 1.5) / 2, -hd + 1.2, wall));
        p.push(cyl(scene, 0, 2.8, 3, 10, sx * (hw - 1.2), b.eave + 1.5 + 1.5, -hd + 1.2, roof));
      }
      // 交叉雙劍盾徽佔位
      p.push(box(scene, 2.2, 2.6, 0.3, 0, b.eave - 1.8, -hd - 0.2, GOLD));
      door(3, 3.2);
      break;
    }
    case "castle": {
      p.push(box(scene, b.w - 4, b.eave, b.d, 0, b.eave / 2, 0, wall));
      // 城垛
      for (let i = -4; i <= 4; i++) p.push(box(scene, 1, 1, 1, i * 1.7, b.eave + 0.5, -hd + 0.5, wall));
      for (const sx of [-1, 1]) {
        p.push(cyl(scene, 4.2, 4.6, b.eave + 3, 12, sx * (hw - 2.2), (b.eave + 3) / 2, -hd + 2.2, wall));
        p.push(cyl(scene, 0, 5.2, 6.5, 12, sx * (hw - 2.2), b.eave + 3 + 3.25, -hd + 2.2, roof));
      }
      p.push(cyl(scene, 5, 5.4, b.eave + 5, 12, 0, (b.eave + 5) / 2, hd - 3.5, wall));
      p.push(cyl(scene, 0, 6, b.top - b.eave - 5, 12, 0, b.eave + 5 + (b.top - b.eave - 5) / 2, hd - 3.5, roof));
      // 獅子盾徽佔位、騎士雕像佔位
      p.push(box(scene, 2.4, 2.8, 0.3, 0, b.eave - 2, -hd - 0.2, GOLD));
      for (const sx of [-1, 1]) {
        p.push(box(scene, 1.2, 0.8, 1.2, sx * 3.4, 0.4, -hd - 1.6, STONE_DARK));
        p.push(cyl(scene, 0.7, 0.9, 2.2, 8, sx * 3.4, 1.9, -hd - 1.6, STONE_DARK));
      }
      door(3.6, 3.6);
      break;
    }
    case "tower": {
      p.push(cyl(scene, 9, 10, b.eave + 4, 14, 0, (b.eave + 4) / 2, 1, wall));
      p.push(cyl(scene, 0, 11.5, b.top - b.eave - 4, 14, 0, b.eave + 4 + (b.top - b.eave - 4) / 2, 1, roof));
      p.push(box(scene, 6, b.eave - 2, 5, -hw + 3.2, (b.eave - 2) / 2, -hd + 3, wall));
      p.push(gable(scene, 6.6, 5.8, 2.6, b.eave - 2, roof, -hd + 3));
      // 魔法陣窗、星環佔位
      p.push(cyl(scene, 3, 3, 0.3, 16, 0, b.eave + 1, -4.1, [0.7, 0.62, 0.95], Math.PI / 2));
      p.push(torus(scene, 4.5, 0.18, 24, 0, b.top + 0.8, 1, GOLD, 0.35));
      door(2.8, 3.2, -hd + 3.6);
      break;
    }
    case "church": {
      p.push(box(scene, b.w, b.eave, b.d - 4, 0, b.eave / 2, 2, wall));
      p.push(gable(scene, b.w + 0.6, b.d - 3, 6, b.eave, roof, 2));
      // 正面鐘樓＋尖塔
      p.push(box(scene, 5, b.eave + 4, 5, 0, (b.eave + 4) / 2, -hd + 2.5, wall));
      p.push(cyl(scene, 0, 6.2, b.top - b.eave - 4, 4, 0, b.eave + 4 + (b.top - b.eave - 4) / 2, -hd + 2.5, roof, 0, Math.PI / 4));
      // 彩繪玻璃圓窗佔位
      p.push(cyl(scene, 2.6, 2.6, 0.3, 18, 0, b.eave + 1, -hd - 0.1, [0.62, 0.7, 0.95], Math.PI / 2));
      door(2.8, 3.6);
      break;
    }
    case "tent": {
      p.push(cyl(scene, b.w, b.w, b.eave, 16, 0, b.eave / 2, 0, wall));
      p.push(cyl(scene, 0.3, b.w + 1, b.top - b.eave, 16, 0, b.eave + (b.top - b.eave) / 2, 0, roof));
      p.push(cyl(scene, 0.2, 0.2, 1.6, 6, 0, b.top + 0.8, 0, GOLD));
      // 入口門簾
      p.push(box(scene, 3.4, 3.4, 1.2, 0, 1.7, -hd + 0.2, roof));
      p.push(cyl(scene, 1.6, 1.6, 0.2, 16, 0, 4.4, -hd - 0.45, GOLD, Math.PI / 2));
      break;
    }
    case "shop": {
      p.push(box(scene, b.w, b.eave, b.d, 0, b.eave / 2, 0, wall));
      p.push(gable(scene, b.w + 1, b.d + 1, 3.4, b.eave, roof));
      p.push(box(scene, 1.8, b.top - 1, 1.8, hw - 2, (b.top - 1) / 2, hd - 2, STONE_DARK));
      // 紅色遮雨棚、鐵鎚招牌佔位
      p.push(box(scene, 6, 0.2, 2, 2.5, 3.6, -hd - 1, [0.8, 0.32, 0.3]));
      p.push(box(scene, 1.8, 1.8, 0.25, -3, 4.3, -hd - 0.2, GOLD));
      door(2.6, 3);
      break;
    }
    case "storehouse": {
      p.push(box(scene, b.w, b.eave, b.d, 0, b.eave / 2, 0, wall));
      p.push(gable(scene, b.w + 0.8, b.d + 0.8, b.top - b.eave, b.eave, roof));
      // 寶箱徽章佔位、門口木箱
      p.push(box(scene, 1.6, 1.2, 0.3, 0, b.eave - 0.3, -hd - 0.2, GOLD));
      p.push(box(scene, 1, 1, 1, -3.2, 0.5, -hd - 0.9, WOOD), box(scene, 0.8, 0.8, 0.8, -3.0, 1.4, -hd - 0.9, WOOD));
      door(3, 3.2);
      break;
    }
  }
  return joinGeo(p);
}

function textPlane(scene: Scene, text: string, sub: string, width: number): Mesh {
  const tex = new DynamicTexture("PH_vLabelTex", { width: 512, height: 160 }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 512, 160);
  ctx.fillStyle = "rgba(30,30,60,0.72)";
  ctx.beginPath();
  ctx.roundRect(6, 10, 500, 140, 28);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.font = "bold 58px sans-serif";
  ctx.fillText(text, 256, sub ? 74 : 98);
  if (sub) {
    ctx.font = "36px sans-serif";
    ctx.fillStyle = "#ffe28a";
    ctx.fillText(sub, 256, 128);
  }
  tex.update();
  tex.hasAlpha = true;
  const mat = new StandardMaterial("PH_vLabelMat", scene);
  mat.diffuseTexture = tex;
  mat.emissiveColor = Color3.White();
  mat.disableLighting = true;
  mat.useAlphaFromDiffuseTexture = true;
  mat.backFaceCulling = false;
  const m = MeshBuilder.CreatePlane("PH_vLabel", { width, height: width * (160 / 512) }, scene);
  m.material = mat;
  m.billboardMode = Mesh.BILLBOARDMODE_ALL;
  m.isPickable = false;
  return m;
}

export interface VillageWorld {
  update(dt: number, px: number, pz: number): void;
  setLabels(on: boolean): void;
  setMarkers(on: boolean): void;
  readonly labelsOn: boolean;
  readonly markersOn: boolean;
  stats(): { meshes: number; triangles: number; labels: number };
}

/**
 * art＝true（Stage 6 P3 全村整合）：正式美術模型取代佔位量體 —
 * 只保留地面（含外圍緩坡）、NPC 佔位人形與互動圈、文字標籤；廣場、道路、高台、石階、建築、噴泉、燈具、傳送門、
 * 鍛造台、佈告欄、樹籬、遠景、水面、標記改由美術模型提供。碰撞、配置、移動完全不變（都在 layout.ts）。
 */
export function buildVillageWorld(scene: Scene, shadows: ShadowGenerator | null, lite: boolean, art = false): VillageWorld {
  const mat = new StandardMaterial("PH_vMat", scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = new Color3(0.04, 0.04, 0.04);

  const statics: Placed[] = [];
  const add = (geo: Geo, x = 0, y = 0, z = 0, rot = 0): void => {
    statics.push({ geo, x, y, z, rot, scale: 1 });
  };

  // 地面：草地＋外圍緩坡（高台、石階另外做）
  {
    const size = 130;
    // Stage 6.6：正式美術模式的高畫質地面 64 格（草地細節由 Stage 6.6 草地貼圖提供；外圍緩坡仍平順）
    const sub = lite ? 52 : art ? 64 : 78;
    const g = MeshBuilder.CreateGround("PH_vTmp", { width: size, height: size, subdivisions: sub }, scene);
    const pos = g.getVerticesData("position")!;
    for (let i = 0; i < pos.length; i += 3) {
      const r = Math.hypot(pos[i]!, pos[i + 2]!);
      pos[i + 1] = r > WALK_RADIUS + 1 ? Math.min(6, (r - WALK_RADIUS - 1) * 0.35) - 0.02 : -0.02;
    }
    g.updateVerticesData("position", pos);
    const nrm: number[] = [];
    VertexData.ComputeNormals(pos, g.getIndices()!, nrm);
    g.updateVerticesData("normal", nrm);
    add(geoOf(g, (px, py, pz, _nx, ny) => shade(GRASS, (0.92 + noise(px * 0.3, py, pz * 0.3) * 0.12) * (0.9 + ny * 0.1))));
  }
  if (!art) {
  // 廣場：環形廣場、噴泉步道、道路
  add(cyl(scene, FOUNTAIN.plazaR * 2, FOUNTAIN.plazaR * 2, 0.08, lite ? 48 : 72, 0, 0.0, 0, PLAZA));
  add(cyl(scene, FOUNTAIN.walkwayR * 2, FOUNTAIN.walkwayR * 2, 0.1, lite ? 40 : 64, 0, 0.02, 0, WALKWAY));
  // 四條放射主路（寬 6 m）：北路在高台上（石階另做），東、南、西在地面
  for (const b of ROADS) {
    const from = b === 0 ? PLATFORM.r0 : 17.5;
    const to = 40;
    const len = to - from;
    const c = polar(b, from + len / 2);
    const y = b === 0 ? PLATFORM.height : 0;
    add(box(scene, ROAD_HALF * 2, 0.08, len, 0, y, 0, ROAD), c.x, 0, c.z, (b * Math.PI) / 180);
  }
  // 南側羅盤佔位（八芒星，平面）
  add(cyl(scene, 5, 5, 0.12, 8, 0, 0.03, -14, GOLD));
  // 地面設施前庭
  for (const b of BUILDINGS.filter((x) => x.floor === 0)) {
    const c = polar(b.bearing, (17.5 + b.front) / 2);
    add(box(scene, b.w + 2, 0.06, b.front - 17.5, 0, 0, 0, ROAD), c.x, 0, c.z, (b.bearing * Math.PI) / 180);
  }
  // 北側上層高台（扇形、+2 m）與 4 座石階
  {
    const a0 = PLATFORM.from - 360;
    const a1 = PLATFORM.to;
    const segs = lite ? 36 : 54;
    const h = PLATFORM.height;
    const pos: number[] = [];
    const idx: number[] = [];
    // 兩面都輸出（正反各一組頂點），不必猜三角形繞向；只多幾百個三角形
    const quad = (p: number[][]): void => {
      let base = pos.length / 3;
      for (const v of p) pos.push(v[0]!, v[1]!, v[2]!);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      base = pos.length / 3;
      for (const v of p) pos.push(v[0]!, v[1]!, v[2]!);
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    };
    const at = (deg: number, r: number, y: number): number[] => {
      const t = (deg * Math.PI) / 180;
      return [r * Math.sin(t), y, r * Math.cos(t)];
    };
    for (let k = 0; k < segs; k++) {
      const da = a0 + ((a1 - a0) * k) / segs;
      const db = a0 + ((a1 - a0) * (k + 1)) / segs;
      quad([at(da, PLATFORM.r0, h), at(da, PLATFORM.r1, h), at(db, PLATFORM.r1, h), at(db, PLATFORM.r0, h)]);
      quad([at(da, PLATFORM.r0, 0), at(da, PLATFORM.r0, h), at(db, PLATFORM.r0, h), at(db, PLATFORM.r0, 0)]);
      quad([at(db, PLATFORM.r1, 0), at(db, PLATFORM.r1, h), at(da, PLATFORM.r1, h), at(da, PLATFORM.r1, 0)]);
    }
    quad([at(a0, PLATFORM.r1, 0), at(a0, PLATFORM.r1, h), at(a0, PLATFORM.r0, h), at(a0, PLATFORM.r0, 0)]);
    quad([at(a1, PLATFORM.r0, 0), at(a1, PLATFORM.r0, h), at(a1, PLATFORM.r1, h), at(a1, PLATFORM.r1, 0)]);
    const mesh = new Mesh("PH_vTmp", scene);
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    const nrm: number[] = [];
    VertexData.ComputeNormals(pos, idx, nrm);
    vd.normals = nrm;
    vd.applyToMesh(mesh);
    add(geoOf(mesh, lit(STONE)));
    // 高台邊緣矮牆：內緣（石階開口除外）、兩端、外緣
    const stairHalfDeg = ((STAIR_WIDTH / 2 + 0.3) / PLATFORM.r0) * (180 / Math.PI);
    const wallSeg = (deg: number, r: number, len: number): void => {
      const p2 = polar(deg, r);
      add(box(scene, len, 0.6, 0.4, 0, h + 0.3, 0, STONE_DARK), p2.x, 0, p2.z, (deg * Math.PI) / 180);
    };
    for (let deg = a0 + 1.5; deg <= a1 - 1.5; deg += 3) {
      if (STAIRS.some((st) => Math.abs((((deg - st) % 360) + 540) % 360 - 180) < stairHalfDeg + 1.5)) continue;
      wallSeg(deg, PLATFORM.r0 + 0.2, ((3 * Math.PI) / 180) * PLATFORM.r0 + 0.05);
    }
    for (let deg = a0 + 1; deg <= a1 - 1; deg += 2) {
      // 北路盡頭（北方傳送門後方）也圍起來
      wallSeg(deg, PLATFORM.r1 - 0.2, ((2 * Math.PI) / 180) * PLATFORM.r1 + 0.05);
    }
    for (const deg of [a0 + 0.4, a1 - 0.4]) {
      for (let r = PLATFORM.r0 + 1; r < PLATFORM.r1; r += 2) {
        const p2 = polar(deg, r);
        add(box(scene, 0.4, 0.6, 2.05, 0, h + 0.3, 0, STONE_DARK), p2.x, 0, p2.z, (deg * Math.PI) / 180);
      }
    }
  }
  for (const st of STAIRS) {
    const rot = (st * Math.PI) / 180;
    const run = PLATFORM.r0 - STAIR_FROM;
    const steps = Math.round(PLATFORM.height / 0.25);
    for (let i = 0; i < steps; i++) {
      const r = STAIR_FROM + (run * (i + 0.5)) / steps;
      const sc = polar(st, r + run / steps / 2);
      const hh = (PLATFORM.height * (i + 1)) / steps;
      add(box(scene, STAIR_WIDTH, hh, run / steps + 0.02, 0, hh / 2, 0, i % 2 ? STONE : WALKWAY), sc.x, 0, sc.z, rot);
    }
  }
  // 建築
  for (const b of BUILDINGS) {
    const c = buildingCenter(b);
    add(buildingGeo(scene, b), c.x, b.floor, c.z, (b.bearing * Math.PI) / 180);
  }
  // 星願之泉（佔位）：外池、內池、中央柱、星形水晶（另在發光網格）、金環
  // 水池：池底（較低）＋池緣圓環；水面在池緣內側
  add(cyl(scene, FOUNTAIN.basinR * 2, FOUNTAIN.basinR * 2 + 0.4, 0.2, lite ? 36 : 56, 0, 0.1, 0, STONE_DARK));
  add(torus(scene, FOUNTAIN.basinR * 2 - 0.5, 0.6, lite ? 36 : 56, 0, 0.32, 0, STONE));
  add(cyl(scene, 6, 4, 0.4, 28, 0, 1.8, 0, STONE));
  add(torus(scene, 5.8, 0.35, 28, 0, 2.05, 0, STONE));
  add(cyl(scene, 1.6, 2.2, 1.6, 16, 0, 0.8, 0, STONE));
  add(cyl(scene, 1.2, 1.4, 3.5, 16, 0, 2.2 + 1.75, 0, STONE));
  // 燈座、長椅、路燈、門柱、傳送陣石柱
  for (const cc of CIRCLE_COLLIDERS) {
    if (cc.kind === "crystalLamp") add(cyl(scene, 0.7, 0.9, 1.1, 8, cc.x, 0.55, cc.z, STONE));
    if (cc.kind === "bench") {
      const rot = Math.atan2(cc.x, cc.z);
      add(joinGeo([box(scene, 1.8, 0.12, 0.55, 0, 0.45, 0, WOOD), box(scene, 1.8, 0.5, 0.1, 0, 0.75, 0.25, WOOD), box(scene, 1.6, 0.4, 0.4, 0, 0.2, 0, STONE_DARK)]), cc.x, 0, cc.z, rot);
    }
    if (cc.kind === "lamp") add(joinGeo([cyl(scene, 0.14, 0.2, 3.2, 8, 0, 1.6, 0, [0.28, 0.28, 0.32]), cyl(scene, 0.5, 0.3, 0.5, 8, 0, 3.4, 0, GOLD)]), cc.x, 0, cc.z);
    if (cc.kind === "gatePost") add(cyl(scene, 1, 1.2, 6.6, 10, cc.x, 3.3, cc.z, STONE));
    if (cc.kind.startsWith("portalStone:")) {
      const p = PORTALS.find((q) => cc.kind.endsWith(q.id))!;
      add(cyl(scene, 0.7, 0.9, 2.2, 8, cc.x, p.floor + 1.1, cc.z, p.open ? STONE : STONE_DARK));
    }
  }
  // 拱門橫樑放高（6.6 m），進村時鏡頭不會被擋住
  add(box(scene, SOUTH_GATE.halfW * 2 + 1.2, 0.8, 1, 0, 6.6, SOUTH_GATE.z, STONE));
  // 四座傳送門石造圓台（直徑 8 m、高 0.12 m，可以走上去）
  for (const p of PORTALS) add(cyl(scene, p.r * 2, p.r * 2 + 0.3, 0.12, lite ? 32 : 48, p.x, p.floor + 0.02, p.z, p.open ? WALKWAY : STONE_DARK));
  // 戶外鍛造台（鐵砧、火爐、遮雨棚）
  add(joinGeo([box(scene, 2.4, 0.9, 2, 0, 0.45, 0, STONE_DARK), box(scene, 0.8, 0.6, 0.5, -0.5, 1.2, 0, [0.3, 0.3, 0.34]), box(scene, 2.8, 0.15, 2.4, 0, 2.3, 0, WOOD)]), FORGE.x, 0, FORGE.z, FORGE.rot);
  // 佈告欄
  add(joinGeo([box(scene, BOARD.w, 2.2, 0.25, 0, 2, 0, WOOD), box(scene, 0.25, 3.2, 0.25, -BOARD.w / 2 + 0.1, 1.6, 0, WOOD), box(scene, 0.25, 3.2, 0.25, BOARD.w / 2 - 0.1, 1.6, 0, WOOD), box(scene, 0.8, 0.8, 0.2, 0, 3.4, 0, GOLD)]), BOARD.x, 0, BOARD.z, BOARD.rot);
  // 外圍樹籬（可走範圍邊界）
  {
    const n = lite ? 40 : 60;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 360;
      const p = polar(a, WALK_RADIUS + 1.2);
      add(box(scene, (2 * Math.PI * (WALK_RADIUS + 1.2)) / n + 0.2, 1.3, 1.2, 0, 0.65, 0, HEDGE), p.x, 0, p.z, (a * Math.PI) / 180 + Math.PI / 2 - Math.PI / 2);
    }
  }
  // 北方遠景（不可走）：城堡剪影、山
  const far: Geo[] = [
    cyl(scene, 0, 90, 30, 10, 0, 6, 120, [0.62, 0.72, 0.7]),
    cyl(scene, 0, 70, 22, 10, -70, 4, 100, [0.6, 0.7, 0.66]),
    cyl(scene, 0, 70, 24, 10, 70, 4, 105, [0.6, 0.7, 0.66]),
    box(scene, 16, 10, 8, 0, 25, 118, [0.86, 0.88, 0.94]),
    cyl(scene, 4, 4, 16, 10, -9, 29, 118, [0.86, 0.88, 0.94]),
    cyl(scene, 4, 4, 16, 10, 9, 29, 118, [0.86, 0.88, 0.94]),
    cyl(scene, 0, 5, 6, 10, -9, 40, 118, [0.5, 0.6, 0.85]),
    cyl(scene, 0, 5, 6, 10, 9, 40, 118, [0.5, 0.6, 0.85]),
    box(scene, 6, 14, 1, 28, 14, 104, [0.78, 0.9, 0.98]),
  ];
  add(joinGeo(far));

  }
  const staticMesh = bake(scene, "PH_villageStatic", statics, mat)!;
  staticMesh.receiveShadows = true;
  staticMesh.isPickable = false;
  staticMesh.freezeWorldMatrix();

  // 水面
  const waterMat = new StandardMaterial("PH_vWaterMat", scene);
  waterMat.diffuseColor = new Color3(0.45, 0.75, 0.95);
  waterMat.emissiveColor = new Color3(0.12, 0.22, 0.3);
  waterMat.specularColor = new Color3(0.3, 0.3, 0.3);
  const water = MeshBuilder.CreateCylinder("PH_vWater", { diameter: FOUNTAIN.basinR * 2 - 0.6, height: 0.05, tessellation: lite ? 36 : 56 }, scene);
  water.position.y = 0.42;
  water.material = waterMat;
  water.isPickable = false;
  const water2 = MeshBuilder.CreateCylinder("PH_vWater2", { diameter: 5.5, height: 0.05, tessellation: 28 }, scene);
  water2.position.y = 2.06;
  water2.material = waterMat;
  water2.isPickable = false;
  const waterMesh = Mesh.MergeMeshes([water, water2], true, true)!;
  waterMesh.name = "PH_villageWater";
  waterMesh.freezeWorldMatrix();

  // 標記（自發光、不受光、不進發光層）：水晶、NPC 站位、復活點、傳送陣、互動範圍
  const markMat = new StandardMaterial("PH_vMarkMat", scene);
  markMat.diffuseColor = Color3.Black();
  markMat.specularColor = Color3.Black();
  markMat.emissiveColor = Color3.White();
  markMat.disableLighting = true;
  const marks: Placed[] = [];
  const mark = (geo: Geo, x = 0, y = 0, z = 0, rot = 0): void => {
    marks.push({ geo, x, y, z, rot, scale: 1 });
  };
  const flat = (c: RGB) => () => c;
  const m = (mesh: Mesh, c: RGB): Geo => geoOf(mesh, flat(c));
  if (!art) {
  // 星形水晶（佔位：上下兩個四角錐）
  {
    const a = MeshBuilder.CreateCylinder("PH_vTmp", { diameterTop: 0, diameterBottom: 1.6, height: 1.1, tessellation: 4 }, scene);
    a.position.y = 6.0 + 0.55;
    const bb = MeshBuilder.CreateCylinder("PH_vTmp", { diameterTop: 1.6, diameterBottom: 0, height: 1.1, tessellation: 4 }, scene);
    bb.position.y = 6.0 - 0.55;
    mark(joinGeo([m(a, [0.55, 0.85, 1]), m(bb, [0.45, 0.75, 0.98])]));
  }
  // 互動範圍：細圓環（r 10.5）
  mark(m(MeshBuilder.CreateTorus("PH_vTmp", { diameter: FOUNTAIN.interactR * 2, thickness: 0.08, tessellation: 96 }, scene), [0.35, 0.65, 1]), 0, 0.12, 0);
  }
  // NPC 站位：金色星形底座＋粉紅色佔位人形＋互動圈（art 模式：Stage 6.2 起由正式 NPC 模型取代，只保留佈告欄的互動圈）
  for (const n of NPC_SPOTS) {
    if (art) {
      if (n.id === "board") {
        // Stage 6.6：平面圓環帶（64 段、雙面 256 面）取代細圓環 Torus（48×48＝4,608 面），俯視外觀相同
        const ring = MeshBuilder.CreateLathe(
          "PH_vTmp",
          { shape: [new Vector3(n.interactR - 0.025, 0, 0), new Vector3(n.interactR + 0.025, 0, 0)], tessellation: 64, sideOrientation: Mesh.DOUBLESIDE },
          scene,
        );
        ring.position.y = 0.08;
        mark(m(ring, [1, 0.78, 0.45]), n.x, n.floor, n.z, n.yaw);
      }
      continue;
    }
    const pad = MeshBuilder.CreateCylinder("PH_vTmp", { diameter: 1.2, height: 0.06, tessellation: 5 }, scene);
    pad.position.y = 0.05;
    const body = MeshBuilder.CreateCapsule("PH_vTmp", { radius: 0.32, height: 1.25, tessellation: 8, subdivisions: 1 }, scene);
    body.position.y = 0.66;
    const ring = MeshBuilder.CreateTorus("PH_vTmp", { diameter: n.interactR * 2, thickness: 0.05, tessellation: 48 }, scene);
    ring.position.y = 0.08;
    mark(joinGeo([m(pad, [1, 0.82, 0.3]), m(body, [1, 0.55, 0.75]), m(ring, [1, 0.72, 0.85])]), n.x, n.floor, n.z, n.yaw);
  }
  if (!art) {
  // 復活點：小綠圓
  for (const s of RESPAWN_SLOTS) {
    const d = MeshBuilder.CreateCylinder("PH_vTmp", { diameter: 0.8, height: 0.04, tessellation: 12 }, scene);
    d.position.y = 0.06;
    mark(m(d, [0.35, 0.85, 0.5]), s.x, 0, s.z);
  }
  // 四座傳送門：南方開放（亮紫）；北、東、西未開放（低亮度、休眠）
  for (const p of PORTALS) {
    const r1 = MeshBuilder.CreateTorus("PH_vTmp", { diameter: p.r * 2 - 0.6, thickness: 0.22, tessellation: 48 }, scene);
    r1.position.y = 0.12;
    const r2 = MeshBuilder.CreateCylinder("PH_vTmp", { diameter: p.r * 2 - 1.4, height: 0.03, tessellation: 48 }, scene);
    r2.position.y = 0.1;
    // 未開放：灰紫色、低亮度（休眠），不要看起來像黑洞
    const ring: RGB = p.open ? [0.78, 0.62, 1] : [0.6, 0.57, 0.68];
    const fill: RGB = p.open ? [0.5, 0.42, 0.8] : [0.5, 0.48, 0.56];
    mark(joinGeo([m(r1, ring), m(r2, fill)]), p.x, p.floor, p.z);
  }
  // 從原野返回的抵達點（藍色三角）
  {
    const tri = MeshBuilder.CreateCylinder("PH_vTmp", { diameter: 1.2, height: 0.04, tessellation: 3 }, scene);
    tri.position.y = 0.07;
    mark(m(tri, [0.3, 0.6, 1]), ARRIVAL_SPOT.x, 0, ARRIVAL_SPOT.z, Math.PI);
  }
  }
  const markMesh = bake(scene, "PH_villageMarks", marks, markMat)!;
  markMesh.isPickable = false;
  markMesh.freezeWorldMatrix();

  // 金色魔法環（緩慢旋轉，佔位）
  const ringMat = new StandardMaterial("PH_vRingMat", scene);
  ringMat.diffuseColor = new Color3(0.95, 0.78, 0.36);
  ringMat.emissiveColor = new Color3(0.35, 0.27, 0.08);
  ringMat.specularColor = new Color3(0.5, 0.45, 0.3);
  const ringRoot = new TransformNode("PH_vRingRoot", scene);
  ringRoot.position.y = 6;
  const ringA = MeshBuilder.CreateTorus("PH_vRingA", { diameter: 3.5, thickness: 0.1, tessellation: 40 }, scene);
  const ringB = MeshBuilder.CreateTorus("PH_vRingB", { diameter: 4.2, thickness: 0.1, tessellation: 40 }, scene);
  for (const r of [ringA, ringB]) {
    r.material = ringMat;
    r.parent = ringRoot;
    r.isPickable = false;
  }
  ringA.rotation.x = 1.1;
  ringB.rotation.z = 1.25;
  if (art) for (const x of [waterMesh, ringA, ringB]) x.setEnabled(false);

  // 佔位階段：只有角色投影（shadows 由頁面管理）；建築陰影之後烘進頂點色
  void shadows;

  // 文字標籤：建築名稱、NPC、傳送陣、噴泉
  const labels: { mesh: Mesh; x: number; z: number; hide: number; far: number }[] = [];
  const label = (text: string, sub: string, x: number, y: number, z: number, w: number): void => {
    const p = textPlane(scene, text, sub, w);
    p.position.set(x, y, z);
    // 大標籤在角色附近 6 m 內隱藏、小標籤 2.5 m（不擋住角色）
    // Stage 6.3（art 模式）：太遠看不清楚的標籤不繪製（每個標籤是一次繪製）：建築名稱 45 m、NPC／傳送門 26 m
    labels.push({ mesh: p, x, z, hide: w >= 3.5 ? 6 : 2.5, far: art ? (w >= 5 ? 45 : 26) : 1e9 });
  };
  if (!art) {
    for (const b of BUILDINGS) {
      const c = buildingCenter(b);
      label(b.name, b.role, c.x, b.floor + b.top + 1.5, c.z, 6);
    }
  }
  for (const n of NPC_SPOTS) label(n.name.replace("（鍛造台旁）", ""), art ? n.role : n.id === "board" ? "互動" : "NPC 預留", n.x, n.floor + 2.2, n.z, 2.4);
  if (!art) label("星願之泉", "出生・復活（座標預留）", 0, 9, 0, 5);
  for (const p of PORTALS) label(p.name, p.open ? "開放：星芽原野 Lv1–10" : "未開放", p.x, p.floor + 3.4, p.z, 3.8);

  let labelsOn = true;
  let markersOn = true;
  const meshes = [staticMesh, waterMesh, markMesh, ringA, ringB];
  return {
    update(dt: number, px: number, pz: number): void {
      ringRoot.rotation.y += dt * ((Math.PI * 2) / 20);
      ringA.rotation.y += dt * 0.25;
      if (!labelsOn) return;
      // 角色附近 2.5 m 內的標籤隱藏（不擋住角色）
      for (const l of labels) {
        const d = Math.hypot(l.x - px, l.z - pz);
        l.mesh.isVisible = d > l.hide && d < l.far;
      }
    },
    setLabels(on: boolean): void {
      labelsOn = on;
      for (const l of labels) l.mesh.isVisible = on;
    },
    setMarkers(on: boolean): void {
      markersOn = on;
      markMesh.isVisible = on;
    },
    get labelsOn() {
      return labelsOn;
    },
    get markersOn() {
      return markersOn;
    },
    stats() {
      let tri = 0;
      for (const mm of meshes) tri += (mm.getTotalIndices() || 0) / 3;
      return { meshes: meshes.length, triangles: Math.round(tri), labels: labels.length };
    },
  };
}

