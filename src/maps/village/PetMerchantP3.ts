import { type AbstractMesh, type Scene, type ShadowGenerator, TransformNode } from "@babylonjs/core";
import { PET_MERCHANT, petMerchantPose, type PetMerchantPose } from "./petMerchant.ts";
import { villageGlass, villageGold, villageProps } from "./villageMaterials.ts";

/**
 * 星芽村寵物商人（只在獨立預覽頁使用；尚未接進村莊）。
 * - 模型網格：PetMerchant_props／_gold／_glow（商人本體）、PetPal_props（身旁的小寵物）
 * - update(t)：依 petMerchantPose(t) 沿噴泉巡走；走路時輕微上下起伏與左右擺動，小寵物在右後方跳著跟隨
 * - 只有商人本體投射陰影（HQ）；不是碰撞物
 */
export interface PetMerchantP3 {
  readonly root: TransformNode;
  readonly pal: TransformNode;
  /** 可點選（互動）的網格 */
  readonly pickMeshes: readonly AbstractMesh[];
  readonly stats: { meshes: number; triangles: number; byMesh: Record<string, number>; shadowCasters: number };
  update(t: number): PetMerchantPose;
  setEnabled(on: boolean): void;
}

const PAL_OFFSET = { x: 0.55, z: -0.35 };

export function setupPetMerchantP3(scene: Scene, meshes: AbstractMesh[], opt: { lite: boolean; shadows?: ShadowGenerator | null }): PetMerchantP3 {
  const root = new TransformNode("petMerchant", scene);
  const body = new TransformNode("petMerchant_body", scene);
  body.parent = root;
  const pal = new TransformNode("petMerchant_pal", scene);
  pal.parent = root;
  const byMesh: Record<string, number> = {};
  const pick: AbstractMesh[] = [];
  let casters = 0;
  const mats = { props: villageProps(scene), gold: villageGold(scene), glow: villageGlass(scene) };
  for (const m of meshes) {
    const n = m.name;
    if (m.getTotalIndices() === 0) continue;
    const key = n.startsWith("PetPal_") ? "pal" : n.startsWith("PetMerchant_gold") ? "gold" : n.startsWith("PetMerchant_glow") ? "glow" : n.startsWith("PetMerchant_props") ? "props" : null;
    if (!key) continue;
    // GLB 的根節點已把座標轉回村莊座標；把網格改掛到會移動的節點下（保留它在根節點下的變換）
    const parent = key === "pal" ? pal : body;
    m.setParent(parent);
    m.material = key === "gold" ? mats.gold : key === "glow" ? mats.glow : mats.props;
    m.hasVertexAlpha = false;
    m.receiveShadows = key !== "glow";
    m.isPickable = true;
    m.metadata = { petMerchant: true };
    pick.push(m);
    byMesh[key] = Math.round(m.getTotalIndices() / 3);
    if (opt.shadows && key === "props") {
      opt.shadows.addShadowCaster(m, false);
      casters++;
    }
  }
  pal.position.set(PAL_OFFSET.x, 0, PAL_OFFSET.z);
  return {
    root,
    pal,
    pickMeshes: pick,
    stats: { meshes: pick.length, triangles: Object.values(byMesh).reduce((a, b) => a + b, 0), byMesh, shadowCasters: casters },
    update(t) {
      const p = petMerchantPose(t);
      root.position.set(p.x, 0.03, p.z);
      root.rotation.y = p.yaw;
      const step = p.walking ? Math.abs(Math.sin(t * Math.PI * 2 * 1.5)) : 0;
      body.position.y = p.walking ? 0.025 * step : 0.006 * Math.sin(t * 2.2);
      body.rotation.z = p.walking ? 0.035 * Math.sin(t * Math.PI * 2 * 0.75) : 0;
      const hop = p.walking ? Math.abs(Math.sin(t * Math.PI * 2 * 2.2)) * 0.09 : Math.max(0, Math.sin(t * Math.PI * 2 * 0.6)) * 0.035;
      pal.position.y = hop;
      pal.rotation.y = p.walking ? 0 : 0.25 * Math.sin(t * 0.9);
      return p;
    },
    setEnabled(on) {
      root.setEnabled(on);
    },
  };
}

export { PET_MERCHANT };
