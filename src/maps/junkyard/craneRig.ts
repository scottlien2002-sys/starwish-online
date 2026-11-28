/**
 * 星廢垃圾場 V3：廢料回收吊車三件式組裝（塔身固定＋吊臂水平旋轉＋抓斗升降與輕微擺動）。
 * 實驗場景（?map=jylab&crane=1）與垃圾場共用同一份組裝程式，先在實驗場景驗證再放進地圖。
 *
 * 模型座標（Babylon 載入後、未縮放；三件都是 Tripo 輸出的單位立方體座標）：
 * - 塔身：底面 y＝TOWER.bottom，塔頂旋轉軸承頂面 y＝TOWER.top（中心 x＝z＝0）
 * - 吊臂：旋轉盤底面中心＝BOOM.pivot；吊臂往 −Z 延伸，末端滑輪鋼索出口＝BOOM.pulley
 * - 抓斗：頂部吊環最高點＝GRAB.top
 * 這些數值由實驗場景量測（頂點分層統計＋正交截圖），見專案文件 Junkyard_V3_Landmarks_Report。
 */
import { type AbstractMesh, type AssetContainer, Color3, Mesh, MeshBuilder, type Scene, StandardMaterial, TransformNode } from "@babylonjs/core";

export { BOOM, GRAB, TOWER, type CraneRigSpec } from "./craneSpec.ts";
import { BOOM, GRAB, TOWER, type CraneRigSpec } from "./craneSpec.ts";

export interface CraneRig {
  root: TransformNode;
  swing: TransformNode;
  hang: TransformNode;
  claw: TransformNode;
  cable: Mesh;
  meshes: AbstractMesh[];
  /** 世界高度：塔頂、滑輪、抓斗最低可到的高度 */
  pivotY: number;
  pulleyY: number;
  reach: number;
  dropMin: number;
  dropMax: number;
  update(t: number): void;
}

function place(c: AssetContainer, tag: string, parent: TransformNode, convert: (m: AbstractMesh) => void): AbstractMesh[] {
  const ent = c.instantiateModelsToScene((n) => `${tag}_${n}`, false, { doNotInstantiate: true });
  for (const r of ent.rootNodes) r.parent = parent;
  for (const g of ent.animationGroups) g.dispose();
  const meshes = parent.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0);
  for (const m of meshes) {
    convert(m);
    m.isPickable = false;
  }
  return meshes;
}

/**
 * 組裝一座吊車：root 放在塔底中心（地面），塔身固定；swing 在塔頂旋轉軸心；hang 在滑輪出口；claw 在鋼索下端。
 */
export function buildCraneRig(scene: Scene, parts: { tower: AssetContainer; boom: AssetContainer; grab: AssetContainer }, spec: CraneRigSpec, convert: (m: AbstractMesh) => void, cableMat?: StandardMaterial): CraneRig {
  const root = new TransformNode(`crane_${spec.id}`, scene);
  const meshes: AbstractMesh[] = [];
  // 塔身：底面落在 root（地面）
  const tower = new TransformNode(`crane_${spec.id}_tower`, scene);
  tower.parent = root;
  tower.scaling.setAll(spec.towerUnit);
  tower.position.y = -TOWER.bottom * spec.towerUnit;
  meshes.push(...place(parts.tower, `crane_${spec.id}_tower`, tower, convert));
  // 旋轉軸心：塔頂軸承頂面
  const pivotY = (TOWER.top - TOWER.bottom) * spec.towerUnit;
  const swing = new TransformNode(`crane_${spec.id}_swing`, scene);
  swing.parent = root;
  swing.position.y = pivotY - spec.seat;
  // 吊臂：旋轉盤底面中心對準軸心
  const boom = new TransformNode(`crane_${spec.id}_boom`, scene);
  boom.parent = swing;
  boom.scaling.setAll(spec.boomUnit);
  boom.position.set(-BOOM.pivot[0] * spec.boomUnit, -BOOM.pivot[1] * spec.boomUnit, -BOOM.pivot[2] * spec.boomUnit);
  meshes.push(...place(parts.boom, `crane_${spec.id}_boom`, boom, convert));
  // 滑輪出口（相對旋轉軸）
  const hang = new TransformNode(`crane_${spec.id}_hang`, scene);
  hang.parent = swing;
  hang.position.set((BOOM.pulley[0] - BOOM.pivot[0]) * spec.boomUnit, (BOOM.pulley[1] - BOOM.pivot[1]) * spec.boomUnit, (BOOM.pulley[2] - BOOM.pivot[2]) * spec.boomUnit);
  const reach = Math.abs(hang.position.z);
  const pulleyY = swing.position.y + hang.position.y;
  // 抓斗：頂部吊環對準鋼索下端
  const claw = new TransformNode(`crane_${spec.id}_claw`, scene);
  claw.parent = hang;
  const grab = new TransformNode(`crane_${spec.id}_grab`, scene);
  grab.parent = claw;
  grab.scaling.setAll(spec.grabUnit);
  grab.position.y = -GRAB.top * spec.grabUnit;
  meshes.push(...place(parts.grab, `crane_${spec.id}_grab`, grab, convert));
  // 鋼索：細長圓柱，長度隨抓斗升降
  const cable = MeshBuilder.CreateCylinder(`crane_${spec.id}_cable`, { height: 1, diameter: 1, tessellation: 6 }, scene);
  cable.parent = hang;
  cable.scaling.set(0.07 * Math.max(1, spec.boomUnit / 20), 1, 0.07 * Math.max(1, spec.boomUnit / 20));
  if (!cableMat) {
    cableMat = new StandardMaterial(`crane_cable_m`, scene);
    cableMat.diffuseColor = new Color3(0.16, 0.15, 0.14);
    cableMat.specularColor = new Color3(0.3, 0.3, 0.3);
  }
  cable.material = cableMat;
  cable.isPickable = false;
  // 升降範圍：最短 2.5 m；最長讓抓斗底部離地 ≥ 2 m
  const grabH = (GRAB.top - GRAB.bottom) * spec.grabUnit;
  const dropMin = 2.5;
  const dropMax = Math.max(dropMin + 1, pulleyY - grabH - 2 - spec.groundClear);
  const rig: CraneRig = {
    root,
    swing,
    hang,
    claw,
    cable,
    meshes: [...meshes, cable],
    pivotY,
    pulleyY,
    reach,
    dropMin,
    dropMax,
    update(t: number) {
      swing.rotation.y = spec.swingCenter + spec.swingAmp * Math.sin(t * spec.swingSpeed + spec.phase);
      // 升降：慢慢放下 → 停一下 → 收回（平滑）
      const u = ((t + spec.phase * 3) / spec.liftPeriod) % 1;
      const k = u < 0.4 ? smooth(u / 0.4) : u < 0.55 ? 1 : u < 0.95 ? 1 - smooth((u - 0.55) / 0.4) : 0;
      const drop = dropMin + (dropMax - dropMin) * k;
      claw.position.y = -drop;
      cable.scaling.y = drop;
      cable.position.y = -drop / 2;
      // 輕微吊掛擺動：鐘擺頻率依鋼索長度；吊臂轉動時略大
      const w = Math.sqrt(9.8 / Math.max(2, drop + grabH * 0.5));
      const swingVel = spec.swingAmp * spec.swingSpeed * Math.cos(t * spec.swingSpeed + spec.phase);
      hang.rotation.x = 0.018 * Math.sin(t * w + spec.phase) + swingVel * 0.04;
      hang.rotation.z = 0.012 * Math.sin(t * w * 0.83 + spec.phase * 1.7);
    },
  };
  return rig;
}

function smooth(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
}
