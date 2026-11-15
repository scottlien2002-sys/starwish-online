import {
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  StandardMaterial,
  Vector3,
  VertexBuffer,
  VertexData,
  type ShadowGenerator,
} from "@babylonjs/core";
import { createRng } from "../core/rng.ts";
import { TUNING } from "../config/tuning.ts";
import { heightAt } from "./terrain.ts";
import { scatterProps, type PropKind, type PropPlacement } from "./scatter.ts";

/**
 * W1 新手草原（程式化暫代美術）。
 * 所有模型名稱以 "PH_" 開頭，代表暫代物件，之後會以正式 GLB 模型替換。
 */
export interface MeadowWorld {
  ground: Mesh;
  props: PropPlacement[];
  update(dt: number): void;
}

export function buildMeadow(scene: Scene, shadows: ShadowGenerator): MeadowWorld {
  const half = TUNING.world.halfSize;
  const size = half * 2 + 30; // 外圍多留一圈山丘

  const groundMat = new StandardMaterial("PH_groundMat", scene);
  groundMat.diffuseColor = Color3.White();
  groundMat.specularColor = new Color3(0.02, 0.02, 0.02);

  const ground = MeshBuilder.CreateGround("PH_ground", { width: size, height: size, subdivisions: 110, updatable: true }, scene);
  shapeGround(ground);
  ground.material = groundMat;
  ground.receiveShadows = true;
  ground.isPickable = false;
  ground.freezeWorldMatrix();

  // 出生點：星願廣場（暫代）
  const plaza = MeshBuilder.CreateCylinder("PH_plaza", { diameter: 9, height: 0.12, tessellation: 40 }, scene);
  plaza.position.y = heightAt(0, 0) + 0.04;
  paint(plaza, new Color3(1, 0.93, 0.78));
  const plazaMat = new StandardMaterial("PH_plazaMat", scene);
  plazaMat.specularColor = new Color3(0.05, 0.05, 0.05);
  plaza.material = plazaMat;
  plaza.receiveShadows = true;
  plaza.isPickable = false;

  const star = MeshBuilder.CreateCylinder("PH_plazaStar", { diameter: 3.2, height: 0.14, tessellation: 5 }, scene);
  star.position.y = plaza.position.y + 0.02;
  paint(star, new Color3(1, 0.85, 0.45));
  star.material = plazaMat;
  star.isPickable = false;

  // 裝飾物
  const props = scatterProps({
    seed: TUNING.world.seed,
    halfSize: half - 4,
    clearRadius: 12,
    counts: { tree: 70, rock: 40, bush: 60, flower: 360 },
  });

  const propMat = new StandardMaterial("PH_propMat", scene);
  propMat.diffuseColor = Color3.White();
  propMat.specularColor = new Color3(0.04, 0.04, 0.04);

  const templates = createPropTemplates(scene);
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
    if (list[0] && list[0].kind !== "flower") shadows.addShadowCaster(template);
  }
  for (const options of Object.values(templates)) {
    for (const t of options) if (!groups.has(t)) t.dispose();
  }

  // 天空中的雲（暫代）
  const clouds = createClouds(scene);

  return {
    ground,
    props,
    update(dt: number) {
      for (const c of clouds) {
        c.position.x += dt * 0.8;
        if (c.position.x > half + 40) c.position.x = -half - 40;
      }
    },
  };
}

function shapeGround(ground: Mesh): void {
  const positions = ground.getVerticesData(VertexBuffer.PositionKind);
  const indices = ground.getIndices();
  if (!positions || !indices) throw new Error("Ground mesh data missing");

  const colors = new Float32Array((positions.length / 3) * 4);
  const rng = createRng(TUNING.world.seed + 1);
  for (let i = 0, c = 0; i < positions.length; i += 3, c += 4) {
    const x = positions[i]!;
    const z = positions[i + 2]!;
    const y = heightAt(x, z);
    positions[i + 1] = y;

    // 草地色：低處偏嫩綠、高處偏黃綠，加一點斑駁
    const n = rng.range(-0.035, 0.035);
    const patch = 0.5 + 0.5 * Math.sin(x * 0.21) * Math.sin(z * 0.17);
    colors[c] = 0.52 + y * 0.03 + patch * 0.06 + n;
    colors[c + 1] = 0.82 + patch * 0.05 + n;
    colors[c + 2] = 0.42 - y * 0.02 + n;
    colors[c + 3] = 1;
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  ground.updateVerticesData(VertexBuffer.PositionKind, positions);
  ground.updateVerticesData(VertexBuffer.NormalKind, normals);
  ground.setVerticesData(VertexBuffer.ColorKind, colors);
  ground.refreshBoundingInfo();
}

/** 以頂點色上色，讓多個零件能合併為單一網格、共用一個材質（減少 draw call） */
function paint(mesh: Mesh, color: Color3): void {
  const count = mesh.getTotalVertices();
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    colors[i * 4] = color.r;
    colors[i * 4 + 1] = color.g;
    colors[i * 4 + 2] = color.b;
    colors[i * 4 + 3] = 1;
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
}

function merge(name: string, parts: Mesh[]): Mesh {
  const merged = Mesh.MergeMeshes(parts, true, true);
  if (!merged) throw new Error(`Merge failed: ${name}`);
  merged.name = name;
  return merged;
}

function createPropTemplates(scene: Scene): Record<PropKind, Mesh[]> {
  const tree = (name: string, leaf: Color3): Mesh => {
    const trunk = MeshBuilder.CreateCylinder(`${name}_trunk`, { height: 1.6, diameterTop: 0.28, diameterBottom: 0.42, tessellation: 8 }, scene);
    trunk.position.y = 0.8;
    paint(trunk, new Color3(0.62, 0.43, 0.3));
    const a = MeshBuilder.CreateSphere(`${name}_a`, { diameter: 2.4, segments: 8 }, scene);
    a.position.y = 2.2;
    paint(a, leaf);
    const b = MeshBuilder.CreateSphere(`${name}_b`, { diameter: 1.7, segments: 8 }, scene);
    b.position.set(0.55, 2.85, 0.2);
    paint(b, leaf.scale(1.08));
    const c = MeshBuilder.CreateSphere(`${name}_c`, { diameter: 1.5, segments: 8 }, scene);
    c.position.set(-0.5, 2.7, -0.3);
    paint(c, leaf.scale(0.94));
    return merge(name, [trunk, a, b, c]);
  };

  const rock = (name: string): Mesh => {
    const r = MeshBuilder.CreateIcoSphere(name, { radius: 0.6, subdivisions: 1, flat: true }, scene);
    r.scaling.set(1.2, 0.7, 1);
    r.position.y = 0.25;
    r.bakeCurrentTransformIntoVertices();
    paint(r, new Color3(0.78, 0.76, 0.84));
    return r;
  };

  const bush = (name: string): Mesh => {
    const a = MeshBuilder.CreateSphere(`${name}_a`, { diameter: 0.9, segments: 6 }, scene);
    a.position.y = 0.3;
    const b = MeshBuilder.CreateSphere(`${name}_b`, { diameter: 0.7, segments: 6 }, scene);
    b.position.set(0.4, 0.25, 0.1);
    const parts = [a, b];
    parts.forEach((p) => paint(p, new Color3(0.4, 0.72, 0.38)));
    return merge(name, parts);
  };

  const flower = (name: string, petal: Color3): Mesh => {
    const stem = MeshBuilder.CreateCylinder(`${name}_stem`, { height: 0.26, diameter: 0.03, tessellation: 4 }, scene);
    stem.position.y = 0.13;
    paint(stem, new Color3(0.35, 0.65, 0.3));
    const head = MeshBuilder.CreateSphere(`${name}_head`, { diameter: 0.14, segments: 4 }, scene);
    head.position.y = 0.28;
    head.scaling.y = 0.6;
    paint(head, petal);
    return merge(name, [stem, head]);
  };

  return {
    tree: [tree("PH_treeA", new Color3(0.45, 0.78, 0.42)), tree("PH_treeB", new Color3(0.56, 0.82, 0.45))],
    rock: [rock("PH_rock")],
    bush: [bush("PH_bush")],
    flower: [
      flower("PH_flowerPink", new Color3(1, 0.62, 0.78)),
      flower("PH_flowerYellow", new Color3(1, 0.9, 0.45)),
      flower("PH_flowerWhite", new Color3(0.98, 0.97, 1)),
    ],
  };
}

function createClouds(scene: Scene): Mesh[] {
  const mat = new StandardMaterial("PH_cloudMat", scene);
  mat.diffuseColor = Color3.White();
  mat.emissiveColor = new Color3(0.85, 0.85, 0.9);
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  mat.fogEnabled = false;

  const rng = createRng(TUNING.world.seed + 3);
  const clouds: Mesh[] = [];
  for (let i = 0; i < 9; i++) {
    const c = MeshBuilder.CreateSphere(`PH_cloud${i}`, { diameter: 1, segments: 6 }, scene);
    c.scaling.set(rng.range(10, 18), rng.range(2.5, 4), rng.range(6, 9));
    c.position.set(rng.range(-90, 90), rng.range(32, 42), rng.range(-90, 90));
    c.material = mat;
    c.isPickable = false;
    clouds.push(c);
  }
  return clouds;
}
