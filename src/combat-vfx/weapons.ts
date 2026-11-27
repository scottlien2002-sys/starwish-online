/**
 * 展示用武器（程式建模，日系奇幻配色）：初心者短劍、星晶法杖。
 * 不是正式裝備美術；正式武器 GLB 交付後，只要提供同樣的掛點（grip 原點、+Y 為刀身／杖身方向）就能替換。
 * 武器掛在 hand.R 節點：weaponAttach（動作檔內）給出手骨座標系中的刀身方向與刃面方向。
 */
import { Color3, Mesh, MeshBuilder, Quaternion, type Scene, StandardMaterial, TransformNode, Vector3, VertexBuffer } from "@babylonjs/core";
import type { WeaponKind } from "./core/skills.ts";

export interface WeaponRig {
  kind: WeaponKind;
  root: TransformNode;
  /** 殘影取樣點 */
  base: Mesh;
  tip: Mesh;
  meshes: Mesh[];
  /** 魔法發射點（法杖星晶） */
  focus: Mesh;
}

// 材質共用（Stage 2）：每個場景每種材質只建立一次，所有角色的武器共用 → 多人時材質數不隨人數增加
const matCache = new Map<string, StandardMaterial>();
function mat(scene: Scene, name: string, diffuse: Color3, spec: number, emissive = Color3.Black()): StandardMaterial {
  const key = `${scene.uid}|${name.split("_")[0]}`;
  const hit = matCache.get(key);
  if (hit && !hit.getScene().isDisposed) return hit;
  const m = new StandardMaterial(name.split("_")[0] ?? name, scene);
  matCache.set(key, m);
  m.diffuseColor = diffuse;
  m.specularColor = new Color3(spec, spec, spec);
  m.specularPower = 64;
  m.emissiveColor = emissive;
  return m;
}

function marker(scene: Scene, name: string, parent: TransformNode, y: number): Mesh {
  const m = MeshBuilder.CreateBox(name, { size: 0.01 }, scene);
  m.parent = parent;
  m.position.y = y;
  m.isVisible = false;
  m.isPickable = false;
  return m;
}

/**
 * 其他玩家用的簡化武器：零件的材質顏色寫進頂點色，合併成 1 個網格、1 個共用材質 → 1 個 draw call（原本 6 個）。
 */
function simplify(scene: Scene, w: WeaponRig, name: string): WeaponRig {
  for (const m of w.meshes) {
    const sm = m.material as StandardMaterial | null;
    const c = sm ? sm.diffuseColor.add(sm.emissiveColor.scale(0.8)) : new Color3(1, 1, 1);
    const n = m.getTotalVertices();
    const cols = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) cols.set([Math.min(1, c.r), Math.min(1, c.g), Math.min(1, c.b), 1], i * 4);
    m.setVerticesData(VertexBuffer.ColorKind, cols, false);
  }
  const merged = Mesh.MergeMeshes(w.meshes, true, true, undefined, false, false);
  if (!merged) return w;
  merged.name = name;
  merged.parent = w.root;
  merged.isPickable = false;
  merged.material = mat(scene, "remoteWeapon", new Color3(1, 1, 1), 0.3);
  return { ...w, meshes: [merged] };
}

export function buildSword(scene: Scene, id: string, simple = false): WeaponRig {
  const w = buildSwordFull(scene, id);
  return simple ? simplify(scene, w, `swordSimple_${id}`) : w;
}

export function buildStaff(scene: Scene, id: string, simple = false): WeaponRig {
  const w = buildStaffFull(scene, id);
  return simple ? simplify(scene, w, `staffSimple_${id}`) : w;
}

function buildSwordFull(scene: Scene, id: string): WeaponRig {
  const root = new TransformNode(`sword_${id}`, scene);
  const blade = MeshBuilder.CreateCylinder(`swordBlade_${id}`, { height: 0.46, diameterTop: 0.0, diameterBottom: 0.075, tessellation: 4 }, scene);
  blade.scaling.z = 0.28;
  blade.position.y = 0.06 + 0.23;
  blade.rotation.y = Math.PI / 4;
  blade.material = mat(scene, `swordBladeMat_${id}`, new Color3(0.82, 0.88, 0.96), 0.9, new Color3(0.08, 0.12, 0.2));
  const fuller = MeshBuilder.CreateBox(`swordFuller_${id}`, { width: 0.012, height: 0.32, depth: 0.024 }, scene);
  fuller.position.y = 0.24;
  fuller.material = mat(scene, `swordFullerMat_${id}`, new Color3(0.35, 0.6, 0.95), 0.6, new Color3(0.15, 0.35, 0.7));
  const guard = MeshBuilder.CreateBox(`swordGuard_${id}`, { width: 0.15, height: 0.026, depth: 0.04 }, scene);
  guard.position.y = 0.055;
  const gold = mat(scene, `swordGold_${id}`, new Color3(0.95, 0.75, 0.3), 0.8, new Color3(0.12, 0.08, 0.0));
  guard.material = gold;
  const gem = MeshBuilder.CreatePolyhedron(`swordGem_${id}`, { type: 1, size: 0.018 }, scene);
  gem.position.y = 0.055;
  gem.position.z = 0.022;
  gem.material = mat(scene, `swordGemMat_${id}`, new Color3(0.3, 0.7, 1), 1, new Color3(0.2, 0.5, 0.9));
  const grip = MeshBuilder.CreateCylinder(`swordGrip_${id}`, { height: 0.09, diameter: 0.026, tessellation: 8 }, scene);
  grip.position.y = 0.0;
  grip.material = mat(scene, `swordGripMat_${id}`, new Color3(0.38, 0.22, 0.14), 0.1);
  const pommel = MeshBuilder.CreateSphere(`swordPommel_${id}`, { diameter: 0.034, segments: 8 }, scene);
  pommel.position.y = -0.05;
  pommel.material = gold;
  const meshes = [blade, fuller, guard, gem, grip, pommel];
  for (const m of meshes) {
    m.parent = root;
    m.isPickable = false;
  }
  return { kind: "sword", root, meshes, base: marker(scene, `swordBase_${id}`, root, 0.1), tip: marker(scene, `swordTip_${id}`, root, 0.5), focus: marker(scene, `swordFocus_${id}`, root, 0.45) };
}

function buildStaffFull(scene: Scene, id: string): WeaponRig {
  const root = new TransformNode(`staff_${id}`, scene);
  const shaft = MeshBuilder.CreateCylinder(`staffShaft_${id}`, { height: 0.78, diameterTop: 0.026, diameterBottom: 0.02, tessellation: 8 }, scene);
  shaft.position.y = 0.16;
  shaft.material = mat(scene, `staffWood_${id}`, new Color3(0.55, 0.36, 0.22), 0.15);
  const gold = mat(scene, `staffGold_${id}`, new Color3(0.96, 0.78, 0.32), 0.8, new Color3(0.12, 0.08, 0));
  const ring = MeshBuilder.CreateTorus(`staffRing_${id}`, { diameter: 0.13, thickness: 0.014, tessellation: 24 }, scene);
  ring.position.y = 0.6;
  ring.rotation.x = Math.PI / 2;
  ring.material = gold;
  const cap = MeshBuilder.CreateCylinder(`staffCap_${id}`, { height: 0.05, diameterTop: 0.05, diameterBottom: 0.03, tessellation: 8 }, scene);
  cap.position.y = 0.55;
  cap.material = gold;
  const crystal = MeshBuilder.CreatePolyhedron(`staffCrystal_${id}`, { type: 1, size: 0.05 }, scene);
  crystal.position.y = 0.62;
  crystal.scaling.y = 1.6;
  crystal.material = mat(scene, `staffCrystalMat_${id}`, new Color3(0.55, 0.8, 1), 1, new Color3(0.35, 0.65, 1));
  const star = MeshBuilder.CreatePolyhedron(`staffStar_${id}`, { type: 1, size: 0.02 }, scene);
  star.position.y = 0.71;
  star.material = gold;
  const meshes = [shaft, ring, cap, crystal, star];
  for (const m of meshes) {
    m.parent = root;
    m.isPickable = false;
  }
  return { kind: "staff", root, meshes, base: marker(scene, `staffBase_${id}`, root, 0.45), tip: marker(scene, `staffTip_${id}`, root, 0.72), focus: marker(scene, `staffFocus_${id}`, root, 0.62) };
}

/**
 * 把武器掛到手骨：bladeDir、edgeUp 是手骨座標系（glTF）的方向，來自動作檔 weaponAttach。
 * 武器本地 +Y = 刀身方向、+X = 刃面方向。
 */
export function attachWeapon(w: WeaponRig, hand: TransformNode, bladeDir: number[], edgeUp: number[]): void {
  const Y = new Vector3(bladeDir[0] ?? 0, bladeDir[1] ?? 1, bladeDir[2] ?? 0).normalize();
  const X0 = new Vector3(edgeUp[0] ?? 1, edgeUp[1] ?? 0, edgeUp[2] ?? 0);
  const X = X0.subtract(Y.scale(Vector3.Dot(X0, Y))).normalize();
  const Z = Vector3.Cross(X, Y).normalize();
  w.root.parent = hand;
  w.root.rotationQuaternion = Quaternion.RotationQuaternionFromAxis(X, Y, Z);
  // 握把中心在手掌（手骨起點往指尖約 3 cm）
  w.root.position.set(0, 0.03, 0);
  // 法杖握在杖身下 1/3
  if (w.kind === "staff") w.root.position.subtractInPlace(Y.scale(0.18));
}

export function setWeaponVisible(w: WeaponRig, on: boolean): void {
  for (const m of w.meshes) m.isVisible = on;
}
