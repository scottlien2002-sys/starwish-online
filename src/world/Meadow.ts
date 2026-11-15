import {
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
  type ShadowGenerator,
} from "@babylonjs/core";
import { createRng } from "../core/rng.ts";
import { TUNING } from "../config/tuning.ts";
import { heightAt } from "./terrain.ts";
import { scatterProps, type PropPlacement } from "./scatter.ts";
import {
  createCloudLayer,
  createDistantHills,
  createGrassTuft,
  createGroundDetailTexture,
  createPlaza,
  createPropTemplatesV2,
} from "./meadowArt.ts";

/**
 * 新手草原（W2-1 美術升級：日系明亮奇幻風，仍為程式化暫代美術，名稱以 "PH_" 開頭）。
 *
 * 不變的遊戲資料：地形高度 heightAt、可行走範圍、裝飾物擺放與碰撞半徑（scatterProps 同一種子與數量），
 * 因此角色移動、碰撞、怪物位置與升級前完全相同；只換外觀。
 */
export interface MeadowWorld {
  ground: Mesh;
  props: PropPlacement[];
  update(dt: number): void;
}

export type MeadowQuality = "high" | "medium" | "low";

/** 草叢數量依畫質（全部共用一個網格＝1 個 draw call，不投射陰影） */
export const GRASS_COUNT: Record<MeadowQuality, number> = { high: 3200, medium: 2000, low: 900 };

export function buildMeadow(scene: Scene, shadows: ShadowGenerator, quality: MeadowQuality = "medium"): MeadowWorld {
  const half = TUNING.world.halfSize;
  const size = half * 2 + 30; // 外圍多留一圈山丘

  // ---------- 地面：頂點色（色塊、小徑、坡度明暗）× 細碎草紋貼圖 ----------
  const groundMat = new StandardMaterial("PH_groundMat", scene);
  groundMat.diffuseColor = Color3.White();
  groundMat.specularColor = Color3.Black();
  const detail = createGroundDetailTexture(scene, TUNING.world.seed + 11);
  detail.uScale = size / 4;
  detail.vScale = size / 4;
  groundMat.diffuseTexture = detail;

  const ground = MeshBuilder.CreateGround("PH_ground", { width: size, height: size, subdivisions: 140, updatable: true }, scene);
  shapeGround(ground);
  ground.material = groundMat;
  ground.receiveShadows = true;
  ground.isPickable = false;
  ground.freezeWorldMatrix();

  // ---------- 出生點：星願廣場 ----------
  createPlaza(scene, heightAt(0, 0));

  // ---------- 裝飾物（擺放與碰撞資料與升級前相同） ----------
  const props = scatterProps({
    seed: TUNING.world.seed,
    halfSize: half - 4,
    clearRadius: 12,
    counts: { tree: 70, rock: 40, bush: 60, flower: 360 },
  });

  const propMat = new StandardMaterial("PH_propMat", scene);
  propMat.diffuseColor = Color3.White();
  propMat.specularColor = new Color3(0.03, 0.03, 0.03);

  const templates = createPropTemplatesV2(scene);
  const groups = new Map<Mesh, PropPlacement[]>();
  const rng = createRng(TUNING.world.seed + 7);
  for (const p of props) {
    const options = templates[p.kind];
    const t = options[Math.floor(rng.next() * options.length)]!;
    const list = groups.get(t) ?? [];
    list.push(p);
    groups.set(t, list);
  }

  for (const [template, list] of groups) {
    template.material = propMat;
    template.isPickable = false;
    const buf = new Float32Array(list.length * 16);
    const m = new Matrix();
    list.forEach((p, i) => {
      Matrix.ComposeToRef(
        new Vector3(p.scale, p.scale, p.scale),
        Quaternion.RotationYawPitchRoll(p.rotation, 0, 0),
        new Vector3(p.x, p.y - 0.05, p.z),
        m,
      );
      m.copyToArray(buf, i * 16);
    });
    template.thinInstanceSetBuffer("matrix", buf, 16, true);
    template.thinInstanceRefreshBoundingInfo(false);
    template.receiveShadows = true;
    // 只有樹與岩石投射陰影（灌木、花、草不投射，省陰影貼圖的 draw call）
    if (list[0] && (list[0].kind === "tree" || list[0].kind === "rock")) shadows.addShadowCaster(template);
    template.freezeWorldMatrix();
  }
  const used = new Set(groups.keys());
  for (const options of Object.values(templates)) {
    for (const t of options) if (!used.has(t) && !t.isDisposed()) t.dispose();
  }

  // ---------- 草叢（薄實例） ----------
  buildGrass(scene, props, GRASS_COUNT[quality]);

  // ---------- 遠山與雲 ----------
  createDistantHills(scene, TUNING.world.seed + 21);
  const clouds: TransformNode = createCloudLayer(scene, TUNING.world.seed + 3);

  return {
    ground,
    props,
    update(dt: number) {
      clouds.rotation.y += dt * 0.004;
    },
  };
}

/** 草叢：叢聚分布（出生點附近較密），避開廣場與樹／岩石的碰撞範圍；只改外觀，不影響碰撞 */
function buildGrass(scene: Scene, props: readonly PropPlacement[], count: number): Mesh {
  const tuft = createGrassTuft("PH_grassTuft", scene);
  const mat = new StandardMaterial("PH_grassMat", scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = Color3.Black();
  mat.backFaceCulling = false;
  tuft.material = mat;
  tuft.isPickable = false;

  const half = TUNING.world.halfSize - 3;
  const rng = createRng(TUNING.world.seed + 31);
  const blockers = props.filter((p) => p.radius > 0);
  const buf = new Float32Array(count * 16);
  const m = new Matrix();
  let made = 0;
  let guard = 0;
  while (made < count && guard < count * 6) {
    guard++;
    // 群聚中心：60% 在出生點 40 公尺內，其餘全圖
    const near = rng.next() < 0.6;
    const r = near ? Math.sqrt(rng.next()) * 40 : 0;
    const a = rng.range(0, Math.PI * 2);
    const cx = near ? Math.cos(a) * r : rng.range(-half, half);
    const cz = near ? Math.sin(a) * r : rng.range(-half, half);
    const clump = 2 + Math.floor(rng.next() * 4);
    for (let k = 0; k < clump && made < count; k++) {
      const x = cx + rng.range(-0.7, 0.7);
      const z = cz + rng.range(-0.7, 0.7);
      if (Math.abs(x) > half || Math.abs(z) > half) continue;
      if (Math.hypot(x, z) < 5.2) continue; // 廣場
      if (blockers.some((p) => Math.hypot(p.x - x, p.z - z) < p.radius + 0.15)) continue;
      const s = rng.range(0.75, 1.35);
      Matrix.ComposeToRef(
        new Vector3(s, s * rng.range(0.8, 1.25), s),
        Quaternion.RotationYawPitchRoll(rng.range(0, Math.PI * 2), 0, 0),
        new Vector3(x, heightAt(x, z) - 0.02, z),
        m,
      );
      m.copyToArray(buf, made * 16);
      made++;
    }
  }
  tuft.thinInstanceSetBuffer("matrix", made === count ? buf : buf.slice(0, made * 16), 16, true);
  tuft.thinInstanceRefreshBoundingInfo(false);
  tuft.receiveShadows = true;
  tuft.freezeWorldMatrix();
  return tuft;
}

/** 從出生廣場延伸出去的小徑（只影響地面顏色） */
const PATHS: readonly [number, number][][] = [
  [
    [0, 4],
    [3, 14],
    [-2, 26],
    [4, 40],
    [0, 60],
  ],
  [
    [-4, -1],
    [-15, -4],
    [-26, 2],
    [-40, -3],
    [-60, 4],
  ],
  [
    [3, -3],
    [12, -14],
    [26, -18],
    [40, -30],
  ],
];

function distToPaths(x: number, z: number): number {
  let best = Infinity;
  for (const path of PATHS) {
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i]!;
      const [bx, bz] = path[i + 1]!;
      const vx = bx - ax, vz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
      best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
    }
  }
  return best;
}

function shapeGround(ground: Mesh): void {
  const positions = ground.getVerticesData(VertexBuffer.PositionKind);
  const indices = ground.getIndices();
  if (!positions || !indices) throw new Error("Ground mesh data missing");

  const colors = new Float32Array((positions.length / 3) * 4);
  const rng = createRng(TUNING.world.seed + 1);
  for (let i = 0; i < positions.length; i += 3) positions[i + 1] = heightAt(positions[i]!, positions[i + 2]!);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  for (let i = 0, c = 0; i < positions.length; i += 3, c += 4) {
    const x = positions[i]!;
    const z = positions[i + 2]!;
    const y = positions[i + 1]!;
    const ny = normals[i + 1]!;
    const n = rng.range(-0.02, 0.02);
    // 大小兩層色塊：嫩綠／黃綠／薄荷綠交錯，避免單調
    const big = 0.5 + 0.5 * Math.sin(x * 0.07 + 1.3) * Math.sin(z * 0.06 - 0.4);
    const small = 0.5 + 0.5 * Math.sin(x * 0.23 + z * 0.11) * Math.cos(z * 0.19 - x * 0.07);
    let r = 0.5 + big * 0.1 + small * 0.05 + n;
    let g = 0.8 + small * 0.06 + n;
    let b = 0.36 + (1 - big) * 0.08 + n;
    // 高處偏暖黃綠、低窪偏藍綠
    r += y * 0.018;
    b -= y * 0.012;
    // 坡面略暗（假環境光遮蔽，讓起伏更立體）
    const slope = 1 - (1 - ny) * 2.2;
    r *= slope;
    g *= slope;
    b *= slope;
    // 小徑：柔和的米色泥土路，邊緣漸變
    const d = distToPaths(x, z);
    const path = Math.max(0, 1 - Math.max(0, d - 0.6) / 1.1);
    if (path > 0) {
      const pr = 0.9 + n, pg = 0.8 + n, pb = 0.6 + n;
      r += (pr - r) * path * 0.85;
      g += (pg - g) * path * 0.85;
      b += (pb - b) * path * 0.85;
    }
    // 出生廣場周圍一圈淡淡的亮草
    const pr2 = Math.hypot(x, z);
    if (pr2 > 4.5 && pr2 < 8) {
      const k = 1 - Math.abs(pr2 - 6.2) / 1.8;
      g += k * 0.04;
      r += k * 0.03;
    }
    colors[c] = r;
    colors[c + 1] = g;
    colors[c + 2] = b;
    colors[c + 3] = 1;
  }
  ground.updateVerticesData(VertexBuffer.PositionKind, positions);
  ground.updateVerticesData(VertexBuffer.NormalKind, normals);
  ground.setVerticesData(VertexBuffer.ColorKind, colors);
  ground.refreshBoundingInfo();
}
