import {
  Color3,
  Color4,
  Constants,
  DynamicTexture,
  type GlowLayer,
  Mesh,
  MeshBuilder,
  type Scene,
  type ShadowGenerator,
  Sprite,
  SpriteManager,
  StandardMaterial,
  Texture,
  Vector3,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import { ARENA, BRIDGES, MAIN_ROUTE, MAP_HALF, PORTAL, RIVER, RIVER_HALF, SIDE_PATHS, ZONES, type BridgeDef } from "./layout.ts";
import { ARCH_POSTS, PORTAL_POSTS, RUIN_PILLARS } from "./route.ts";
import { terrainColor } from "./colors.ts";
import { RIVER_PATH, pointAt, type StarsproutTerrain } from "./terrain.ts";

/**
 * Stage 6 第一階段：星芽原野的地形與主要路線（畫面層）。
 * 名稱以 "PH_" 開頭的是暫代模型（第三階段換成正式場景物件）。
 *
 * 繪製（預估）：地形 16 塊（看不到的塊不畫）＋水面 1＋橋 2＋遺跡 3＋傳送門 2＋標示線 1＋文字標籤 2（SpriteManager）
 */
export type MapLod = "hq" | "lite";

export interface StarsproutWorld {
  chunks: Mesh[];
  /** 地形頂點／三角形數 */
  terrainVerts: number;
  terrainTris: number;
  setLabels(on: boolean): void;
  readonly labelsOn: boolean;
  /** 重新上色（可走範圍除錯顯示） */
  setNav(on: boolean): void;
  readonly navOn: boolean;
  /** px/pz：玩家位置（太靠近玩家的文字標籤暫時隱藏，避免擋住角色） */
  update(dt: number, px: number, pz: number): void;
}

const CHUNKS = 4;

function vcolor(mesh: Mesh, c: Color3, a = 1): void {
  const n = mesh.getTotalVertices();
  const colors = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    colors[i * 4] = c.r;
    colors[i * 4 + 1] = c.g;
    colors[i * 4 + 2] = c.b;
    colors[i * 4 + 3] = a;
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
}

function merge(name: string, parts: Mesh[]): Mesh {
  const m = Mesh.MergeMeshes(parts, true, true);
  if (!m) throw new Error(`merge failed: ${name}`);
  m.name = name;
  m.isPickable = false;
  return m;
}

function litMaterial(name: string, scene: Scene, spec = 0.04): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.White();
  m.specularColor = new Color3(spec, spec, spec);
  return m;
}

export function buildStarsproutWorld(
  scene: Scene,
  t: StarsproutTerrain,
  shadows: ShadowGenerator,
  glow: GlowLayer | null,
  lod: MapLod,
): StarsproutWorld {
  // ---------- 地形（4×4 分區） ----------
  const groundMat = litMaterial("PH_mapGroundMat", scene, 0.02);
  const step = lod === "hq" ? 1 : 1.5;
  const size = (2 * MAP_HALF) / CHUNKS;
  const per = Math.round(size / step);
  const chunks: Mesh[] = [];
  let terrainVerts = 0;
  let terrainTris = 0;
  const colorBuffers: { mesh: Mesh; xs: Float32Array; zs: Float32Array }[] = [];
  for (let cj = 0; cj < CHUNKS; cj++) {
    for (let ci = 0; ci < CHUNKS; ci++) {
      const x0 = -MAP_HALF + ci * size;
      const z0 = -MAP_HALF + cj * size;
      const vn = per + 1;
      const positions = new Float32Array(vn * vn * 3);
      const normals = new Float32Array(vn * vn * 3);
      const xs = new Float32Array(vn * vn);
      const zs = new Float32Array(vn * vn);
      const indices: number[] = [];
      for (let j = 0; j < vn; j++) {
        for (let i = 0; i < vn; i++) {
          const k = j * vn + i;
          const x = x0 + i * step;
          const z = z0 + j * step;
          xs[k] = x;
          zs[k] = z;
          positions[k * 3] = x;
          positions[k * 3 + 1] = t.height(x, z);
          positions[k * 3 + 2] = z;
          // 法線由高度場直接算（分區接縫處完全一致，不會有明暗接縫）
          const e = 0.5;
          const gx = (t.height(x + e, z) - t.height(x - e, z)) / (2 * e);
          const gz = (t.height(x, z + e) - t.height(x, z - e)) / (2 * e);
          const l = Math.hypot(gx, 1, gz);
          normals[k * 3] = -gx / l;
          normals[k * 3 + 1] = 1 / l;
          normals[k * 3 + 2] = -gz / l;
        }
      }
      for (let j = 0; j < per; j++) {
        for (let i = 0; i < per; i++) {
          const a = j * vn + i;
          const b = a + 1;
          const c = a + vn;
          const d = c + 1;
          // 與 MeshBuilder.CreateGround 相同的繞向（正面朝上）
          indices.push(a, b, c, b, d, c);
        }
      }
      const mesh = new Mesh(`PH_mapGround_${ci}_${cj}`, scene);
      const vd = new VertexData();
      vd.positions = positions;
      vd.normals = normals;
      vd.indices = indices;
      vd.applyToMesh(mesh, true);
      mesh.material = groundMat;
      mesh.receiveShadows = true;
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
      chunks.push(mesh);
      colorBuffers.push({ mesh, xs, zs });
      terrainVerts += vn * vn;
      terrainTris += per * per * 2;
    }
  }
  let navOn = false;
  const paintGround = (nav: boolean): void => {
    for (const cb of colorBuffers) {
      const n = cb.xs.length;
      const colors = new Float32Array(n * 4);
      for (let k = 0; k < n; k++) {
        const c = terrainColor(t, cb.xs[k]!, cb.zs[k]!, nav);
        colors[k * 4] = c[0];
        colors[k * 4 + 1] = c[1];
        colors[k * 4 + 2] = c[2];
        colors[k * 4 + 3] = 1;
      }
      cb.mesh.setVerticesData(VertexBuffer.ColorKind, colors, true);
    }
  };
  paintGround(false);

  // ---------- 溪流水面（含瀑布） ----------
  const water = buildWater(scene);

  // ---------- 橋 ----------
  const woodMat = litMaterial("PH_mapWoodMat", scene, 0.05);
  const bridgeMeshes = BRIDGES.map((b) => buildBridge(scene, t, b, woodMat));
  if (lod === "hq") for (const m of bridgeMeshes) shadows.addShadowCaster(m);

  // ---------- 王冠遺跡：戰鬥場地面、符文、石柱、拱門、石階 ----------
  const stoneMat = litMaterial("PH_mapStoneMat", scene, 0.06);
  const ruins = buildRuins(scene, t, stoneMat);
  if (lod === "hq") shadows.addShadowCaster(ruins.pillars);
  const rune = buildRune(scene);
  if (glow) for (const m of rune) glow.addIncludedOnlyMesh(m);

  // ---------- 傳送門（平時可見；擊敗 Boss 並達成條件後才可使用） ----------
  const portal = buildPortal(scene, stoneMat);
  if (glow) glow.addIncludedOnlyMesh(portal.core);
  if (lod === "hq") shadows.addShadowCaster(portal.frame);

  // ---------- 標示：區域範圍、路線（1 次繪製）＋文字標籤（SpriteManager，2 次繪製） ----------
  const lines = buildGuideLines(scene, t);
  const labels = buildLabels(scene, t);
  let labelsOn = true;

  let time = 0;
  return {
    chunks,
    terrainVerts,
    terrainTris,
    get labelsOn() {
      return labelsOn;
    },
    setLabels(on: boolean) {
      labelsOn = on;
      lines.setEnabled(on);
      for (const sp of labels.sprites) sp.isVisible = on;
    },
    get navOn() {
      return navOn;
    },
    setNav(on: boolean) {
      if (on === navOn) return;
      navOn = on;
      paintGround(on);
    },
    update(dt: number, px: number, pz: number) {
      time += dt;
      if (labelsOn) {
        for (const sp of labels.sprites) {
          const near = Math.hypot(sp.position.x - px, sp.position.z - pz) < (sp.width > 5 ? 11 : 4);
          sp.isVisible = !near;
        }
      }
      // 水流：貼圖沿流向捲動
      water.tex.vOffset = -time * 0.35;
      // 傳送門光芯緩慢呼吸
      const pulse = 0.35 + 0.1 * Math.sin(time * 1.6);
      portal.coreMat.emissiveColor.set(0.55 * pulse * 2, 0.45 * pulse * 2, 1 * pulse * 2);
    },
  };
}

// ======================= 各部件 =======================

function buildWater(scene: Scene): { mesh: Mesh; tex: DynamicTexture } {
  const half = RIVER_HALF + 0.7;
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const L = RIVER_PATH.length;
  const ds = 1.2;
  const n = Math.ceil(L / ds);
  for (let k = 0; k <= n; k++) {
    const s = Math.min(L, k * ds);
    const p = pointAt(RIVER_PATH, s);
    const q = pointAt(RIVER_PATH, Math.min(L, s + 0.5));
    const r = pointAt(RIVER_PATH, Math.max(0, s - 0.5));
    let tx = q.x - r.x;
    let tz = q.z - r.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    // 該弧長的水面高度
    let seg = 0;
    while (seg < RIVER.length - 2 && RIVER_PATH.cum[seg + 1]! < s) seg++;
    const segLen = RIVER_PATH.cum[seg + 1]! - RIVER_PATH.cum[seg]!;
    const u = segLen > 0 ? (s - RIVER_PATH.cum[seg]!) / segLen : 0;
    const y = RIVER[seg]!.water + (RIVER[seg + 1]!.water - RIVER[seg]!.water) * u;
    const falls = seg === 6 ? 1 : 0;
    for (const side of [-1, 1]) {
      positions.push(p.x - tz * half * side, y + 0.02, p.z + tx * half * side);
      uvs.push(side < 0 ? 0 : 1, s / 6);
      const foam = falls ? 0.85 : 0;
      colors.push(0.62 + foam * 0.35, 0.86 + foam * 0.12, 1, 1);
    }
    if (k > 0) {
      const a = (k - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const mesh = new Mesh("PH_mapWater", scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.uvs = uvs;
  vd.colors = colors;
  vd.indices = indices;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  vd.normals = normals;
  vd.applyToMesh(mesh);
  // 柔和的水紋（程式產生，可無縫平鋪）
  const tex = new DynamicTexture("PH_mapWaterTex", { width: 64, height: 128 }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = "#7fc4f0";
  ctx.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 18; i++) {
    const y = (i * 128) / 18;
    ctx.strokeStyle = i % 3 === 0 ? "rgba(255,255,255,0.55)" : "rgba(225,245,255,0.3)";
    ctx.lineWidth = i % 3 === 0 ? 2 : 1;
    ctx.beginPath();
    for (let x = 0; x <= 64; x += 4) {
      const yy = y + Math.sin((x / 64) * Math.PI * 2 + i) * 2.2;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  const mat = new StandardMaterial("PH_mapWaterMat", scene);
  mat.diffuseTexture = tex;
  mat.specularColor = new Color3(0.55, 0.6, 0.65);
  mat.specularPower = 48;
  mat.emissiveColor = new Color3(0.12, 0.2, 0.28);
  mat.alpha = 0.82;
  mat.backFaceCulling = false;
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.freezeWorldMatrix();
  return { mesh, tex };
}

function buildBridge(scene: Scene, t: StarsproutTerrain, b: BridgeDef, mat: StandardMaterial): Mesh {
  const parts: Mesh[] = [];
  const yaw = Math.atan2(b.ux, b.uz);
  const plank = 0.5;
  const n = Math.round(b.length / plank);
  const deckAt = (a: number): Vector3 => {
    const x = b.cx + b.ux * a;
    const z = b.cz + b.uz * a;
    return new Vector3(x, t.surface(x, z), z);
  };
  for (let i = 0; i < n; i++) {
    const a = -b.length / 2 + (i + 0.5) * plank;
    const p = deckAt(a);
    const m = MeshBuilder.CreateBox(`PH_plank_${b.id}_${i}`, { width: b.width, height: 0.16, depth: plank * 0.92 }, scene);
    m.position.set(p.x, p.y - 0.09, p.z);
    // 依橋面坡度微微傾斜
    const p0 = deckAt(a - 0.25);
    const p1 = deckAt(a + 0.25);
    m.rotation.set(-Math.atan2(p1.y - p0.y, 0.5), yaw, 0);
    vcolor(m, i % 2 ? new Color3(0.72, 0.5, 0.32) : new Color3(0.66, 0.45, 0.28));
    parts.push(m);
  }
  // 欄杆：柱子＋扶手
  const posts = Math.round(b.length / 2);
  for (const side of [-1, 1]) {
    const off = (b.width / 2 - 0.08) * side;
    const ox = b.uz * off;
    const oz = -b.ux * off;
    let prev: Vector3 | null = null;
    for (let i = 0; i <= posts; i++) {
      const a = -b.length / 2 + (i * b.length) / posts;
      const p = deckAt(Math.max(-b.length / 2 + 0.1, Math.min(b.length / 2 - 0.1, a)));
      const post = MeshBuilder.CreateBox(`PH_post_${b.id}_${side}_${i}`, { width: 0.16, height: 1.05, depth: 0.16 }, scene);
      post.position.set(p.x + ox, p.y + 0.5, p.z + oz);
      vcolor(post, new Color3(0.56, 0.38, 0.24));
      parts.push(post);
      const top = new Vector3(p.x + ox, p.y + 0.98, p.z + oz);
      if (prev) {
        const mid = prev.add(top).scale(0.5);
        const len = Vector3.Distance(prev, top);
        const rail = MeshBuilder.CreateBox(`PH_rail_${b.id}_${side}_${i}`, { width: 0.1, height: 0.1, depth: len }, scene);
        rail.position.copyFrom(mid);
        rail.rotation.set(-Math.atan2(top.y - prev.y, Math.hypot(top.x - prev.x, top.z - prev.z)), yaw, 0);
        vcolor(rail, new Color3(0.62, 0.42, 0.27));
        parts.push(rail);
      }
      prev = top;
    }
  }
  const bridge = merge(`PH_bridge_${b.id}`, parts);
  bridge.material = mat;
  bridge.receiveShadows = true;
  bridge.freezeWorldMatrix();
  return bridge;
}

function buildRuins(scene: Scene, t: StarsproutTerrain, mat: StandardMaterial): { floor: Mesh; pillars: Mesh; stairs: Mesh } {
  // 戰鬥場石板地面（圓形、外圈較深）
  const floor = MeshBuilder.CreateCylinder("PH_arenaFloor", { diameter: ARENA.r * 2, height: 0.24, tessellation: 64 }, scene);
  floor.position.set(ARENA.x, ARENA.y - 0.08, ARENA.z);
  vcolor(floor, new Color3(0.9, 0.87, 0.82));
  const rim = MeshBuilder.CreateTorus("PH_arenaRim", { diameter: ARENA.r * 2, thickness: 0.5, tessellation: 64 }, scene);
  rim.position.set(ARENA.x, ARENA.y + 0.02, ARENA.z);
  rim.scaling.y = 0.4;
  vcolor(rim, new Color3(0.74, 0.7, 0.66));
  const floorMesh = merge("PH_arenaFloorMerged", [floor, rim]);
  floorMesh.material = mat;
  floorMesh.receiveShadows = true;
  floorMesh.freezeWorldMatrix();

  // 石柱（含柱頭）、拱門
  const parts: Mesh[] = [];
  for (const [i, p] of RUIN_PILLARS.entries()) {
    const base = t.height(p.x, p.z);
    const col = MeshBuilder.CreateCylinder(`PH_pillar_${i}`, { diameter: p.r * 1.9, height: p.height, tessellation: 12 }, scene);
    col.position.set(p.x, base + p.height / 2 - 0.3, p.z);
    vcolor(col, new Color3(0.88, 0.85, 0.8));
    parts.push(col);
    const foot = MeshBuilder.CreateBox(`PH_pillarFoot_${i}`, { width: p.r * 2.4, height: 0.5, depth: p.r * 2.4 }, scene);
    foot.position.set(p.x, base + 0.05, p.z);
    vcolor(foot, new Color3(0.78, 0.75, 0.7));
    parts.push(foot);
    if (!p.broken) {
      const cap = MeshBuilder.CreateBox(`PH_pillarCap_${i}`, { width: p.r * 2.5, height: 0.45, depth: p.r * 2.5 }, scene);
      cap.position.set(p.x, base + p.height - 0.1, p.z);
      vcolor(cap, new Color3(0.8, 0.77, 0.72));
      parts.push(cap);
    }
  }
  const archBase = t.height(0, 54);
  for (const [i, p] of ARCH_POSTS.entries()) {
    const col = MeshBuilder.CreateBox(`PH_archPost_${i}`, { width: 1.1, height: p.height, depth: 1.1 }, scene);
    col.position.set(p.x, archBase + p.height / 2 - 0.2, p.z);
    vcolor(col, new Color3(0.86, 0.83, 0.78));
    parts.push(col);
  }
  const lintel = MeshBuilder.CreateBox("PH_archLintel", { width: 7, height: 0.9, depth: 1.3 }, scene);
  lintel.position.set(0, archBase + ARCH_POSTS[0]!.height + 0.2, 54);
  vcolor(lintel, new Color3(0.8, 0.76, 0.7));
  parts.push(lintel);
  const pillars = merge("PH_ruinPillars", parts);
  pillars.material = mat;
  pillars.receiveShadows = true;
  pillars.freezeWorldMatrix();

  // 石階（只是外觀；行走用地形斜坡，不會卡腳）
  const steps: Mesh[] = [];
  const z0 = MAIN_ROUTE.find((p) => p.id === "P12a")!.z;
  const z1 = MAIN_ROUTE.find((p) => p.id === "P12b")!.z;
  for (let z = z0 + 0.3, i = 0; z < z1; z += 0.55, i++) {
    const y = t.height(0, z);
    const s = MeshBuilder.CreateBox(`PH_step_${i}`, { width: 3.6, height: 0.22, depth: 0.6 }, scene);
    s.position.set(0, y - 0.06, z);
    vcolor(s, i % 2 ? new Color3(0.86, 0.82, 0.76) : new Color3(0.8, 0.76, 0.7));
    steps.push(s);
  }
  const stairs = merge("PH_ruinStairs", steps);
  stairs.material = mat;
  stairs.receiveShadows = true;
  stairs.freezeWorldMatrix();
  return { floor: floorMesh, pillars, stairs };
}

/** 戰鬥場中央的發光星形符文（只有它和傳送門進入發光層） */
function buildRune(scene: Scene): Mesh[] {
  const mat = new StandardMaterial("PH_runeMat", scene);
  mat.disableLighting = true;
  mat.emissiveColor = new Color3(1, 0.86, 0.45);
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  const star = MeshBuilder.CreateCylinder("PH_runeStar", { diameter: 7, height: 0.04, tessellation: 5 }, scene);
  star.position.set(ARENA.x, ARENA.y + 0.06, ARENA.z);
  star.rotation.y = Math.PI / 10;
  star.material = mat;
  star.isPickable = false;
  const ring = MeshBuilder.CreateTorus("PH_runeRing", { diameter: 9.5, thickness: 0.18, tessellation: 64 }, scene);
  ring.position.set(ARENA.x, ARENA.y + 0.06, ARENA.z);
  ring.scaling.y = 0.2;
  ring.material = mat;
  ring.isPickable = false;
  star.freezeWorldMatrix();
  ring.freezeWorldMatrix();
  return [star, ring];
}

function buildPortal(scene: Scene, stoneMat: StandardMaterial): { frame: Mesh; core: Mesh; coreMat: StandardMaterial } {
  const parts: Mesh[] = [];
  const base = MeshBuilder.CreateCylinder("PH_portalBase", { diameter: 7.4, height: 0.4, tessellation: 40 }, scene);
  base.position.set(PORTAL.x, PORTAL.y + 0.05, PORTAL.z);
  vcolor(base, new Color3(0.82, 0.8, 0.86));
  parts.push(base);
  const ring = MeshBuilder.CreateTorus("PH_portalRing", { diameter: 5.4, thickness: 0.6, tessellation: 48 }, scene);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(PORTAL.x, PORTAL.y + 3, PORTAL.z);
  vcolor(ring, new Color3(0.86, 0.84, 0.92));
  parts.push(ring);
  for (const [i, p] of PORTAL_POSTS.entries()) {
    const post = MeshBuilder.CreateBox(`PH_portalPost_${i}`, { width: 0.8, height: p.height, depth: 0.8 }, scene);
    post.position.set(p.x, PORTAL.y + p.height / 2, p.z);
    vcolor(post, new Color3(0.8, 0.78, 0.86));
    parts.push(post);
  }
  const frame = merge("PH_portalFrame", parts);
  frame.material = stoneMat;
  frame.receiveShadows = true;
  frame.freezeWorldMatrix();

  const coreMat = new StandardMaterial("PH_portalCoreMat", scene);
  coreMat.disableLighting = true;
  coreMat.emissiveColor = new Color3(0.55, 0.45, 1);
  coreMat.diffuseColor = Color3.Black();
  coreMat.specularColor = Color3.Black();
  coreMat.alpha = 0.75;
  coreMat.backFaceCulling = false;
  const core = MeshBuilder.CreateDisc("PH_portalCore", { radius: 2.35, tessellation: 40 }, scene);
  core.position.set(PORTAL.x, PORTAL.y + 3, PORTAL.z);
  core.material = coreMat;
  core.isPickable = false;
  core.freezeWorldMatrix();
  return { frame, core, coreMat };
}

/** 區域範圍圈與路線中線（全部合成 1 個線條網格） */
function buildGuideLines(scene: Scene, t: StarsproutTerrain): Mesh {
  const lines: Vector3[][] = [];
  const colors: Color4[][] = [];
  for (const zn of ZONES) {
    const c = Color3.FromHexString(zn.color);
    const ring: Vector3[] = [];
    const col: Color4[] = [];
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const x = zn.x + Math.sin(a) * zn.r;
      const z = zn.z + Math.cos(a) * zn.r;
      ring.push(new Vector3(x, t.surface(x, z) + 0.25, z));
      col.push(new Color4(c.r, c.g, c.b, 1));
    }
    lines.push(ring);
    colors.push(col);
  }
  const route: Vector3[] = [];
  const rc: Color4[] = [];
  for (let i = 0; i < MAIN_ROUTE.length - 1; i++) {
    const a = MAIN_ROUTE[i]!;
    const b = MAIN_ROUTE[i + 1]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 1.5));
    for (let k = 0; k < n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n;
      const z = a.z + ((b.z - a.z) * k) / n;
      route.push(new Vector3(x, t.surface(x, z) + 0.12, z));
      rc.push(new Color4(1, 0.55, 0.2, 1));
    }
  }
  const last = MAIN_ROUTE[MAIN_ROUTE.length - 1]!;
  route.push(new Vector3(last.x, t.surface(last.x, last.z) + 0.12, last.z));
  rc.push(new Color4(1, 0.55, 0.2, 1));
  lines.push(route);
  colors.push(rc);
  for (const sp of SIDE_PATHS) {
    const pts: Vector3[] = [];
    const cs: Color4[] = [];
    for (let i = 0; i < sp.points.length - 1; i++) {
      const a = sp.points[i]!;
      const b = sp.points[i + 1]!;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 1.5));
      for (let k = 0; k <= n; k++) {
        const x = a.x + ((b.x - a.x) * k) / n;
        const z = a.z + ((b.z - a.z) * k) / n;
        pts.push(new Vector3(x, t.surface(x, z) + 0.12, z));
        cs.push(new Color4(0.95, 0.85, 0.5, 1));
      }
    }
    lines.push(pts);
    colors.push(cs);
  }
  const m = MeshBuilder.CreateLineSystem("PH_mapGuideLines", { lines, colors }, scene);
  m.isPickable = false;
  m.freezeWorldMatrix();
  return m;
}

interface LabelSpec {
  text: string;
  sub?: string;
  color: string;
  x: number;
  y: number;
  z: number;
  big: boolean;
}

/** 文字標籤：所有標籤畫在兩張圖集上，各用一個 SpriteManager（共 2 次繪製） */
function buildLabels(scene: Scene, t: StarsproutTerrain): { managers: SpriteManager[]; sprites: Sprite[] } {
  const specs: LabelSpec[] = [];
  for (const zn of ZONES) {
    const y = t.surface(zn.x, zn.z);
    const sub = zn.monster ? `${zn.monster}　Lv.${zn.level}　上限 ${zn.cap}` : "出生點";
    specs.push({ text: `${zn.id === "camp" ? "" : zn.id + " "}${zn.name}`, sub, color: zn.color, x: zn.x, y: y + (zn.id === "07" ? 10 : 4.2), z: zn.z, big: true });
  }
  specs.push({ text: "傳送門", sub: "擊敗 Boss 並達成條件後可使用", color: "#8e7cf0", x: PORTAL.x, y: PORTAL.y + 7.2, z: PORTAL.z, big: true });
  for (const p of MAIN_ROUTE) {
    if (p.id === "S" || p.id === "P13" || p.id === "P14") continue;
    specs.push({ text: `${p.id} ${p.label}`, sub: `Y ${p.y}`, color: "#a0673a", x: p.x, y: t.surface(p.x, p.z) + 2.2, z: p.z, big: false });
  }
  const managers: SpriteManager[] = [];
  const sprites: Sprite[] = [];
  for (const big of [true, false]) {
    const list = specs.filter((s) => s.big === big);
    const cw = big ? 512 : 256;
    const ch = big ? 128 : 64;
    const cols = Math.floor(1024 / cw);
    const rows = Math.ceil(list.length / cols);
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = Math.max(ch, rows * ch);
    const ctx = canvas.getContext("2d")!;
    list.forEach((s, i) => {
      const x0 = (i % cols) * cw;
      const y0 = Math.floor(i / cols) * ch;
      const pad = big ? 10 : 5;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      roundRect(ctx, x0 + pad, y0 + pad, cw - pad * 2, ch - pad * 2, big ? 24 : 12);
      ctx.fill();
      ctx.lineWidth = big ? 6 : 3;
      ctx.strokeStyle = s.color;
      ctx.stroke();
      ctx.fillStyle = "#3a2f5a";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `900 ${big ? 44 : 22}px "PingFang TC", "Noto Sans CJK TC", "Microsoft JhengHei", sans-serif`;
      ctx.fillText(s.text, x0 + cw / 2, y0 + ch * (s.sub ? 0.4 : 0.5), cw - pad * 4);
      if (s.sub) {
        ctx.font = `700 ${big ? 26 : 15}px "PingFang TC", "Noto Sans CJK TC", "Microsoft JhengHei", sans-serif`;
        ctx.fillStyle = "#5a4f78";
        ctx.fillText(s.sub, x0 + cw / 2, y0 + ch * 0.75, cw - pad * 4);
      }
    });
    const mgr = new SpriteManager(big ? "PH_mapLabelsBig" : "PH_mapLabelsSmall", canvas.toDataURL("image/png"), list.length, { width: cw, height: ch }, scene);
    mgr.isPickable = false;
    mgr.fogEnabled = false;
    mgr.blendMode = Constants.ALPHA_COMBINE;
    list.forEach((s, i) => {
      const sp = new Sprite(`PH_label_${big ? "b" : "s"}_${i}`, mgr);
      sp.position.set(s.x, s.y, s.z);
      sp.cellIndex = i;
      sp.width = big ? 8 : 4;
      sp.height = big ? 2 : 1;
      sprites.push(sp);
    });
    managers.push(mgr);
  }
  return { managers, sprites };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
