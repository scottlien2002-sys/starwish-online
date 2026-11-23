import "@babylonjs/loaders/glTF";
import { type AbstractMesh, PBRMaterial, type Scene, SceneLoader, type ShadowGenerator, TransformNode } from "@babylonjs/core";

/**
 * Stage 6 P3 星芽村正式美術（開關 &art=p3，預設關閉＝維持 Grey-box）。
 * P3-0：只載入「流程驗證樣品」GLB，放在南側大道旁的草地（不在路上、沒有碰撞、不影響任何配置），
 * 用來確認 Blender → GLB → Babylon 在 iPhone Safari 的整條流程。不是正式美術。
 */

export interface VillageArtState {
  status: "loading" | "loaded" | "error";
  stage: "P3-0";
  file: string;
  ms: number;
  meshes: number;
  materials: number;
  textures: number;
  triangles: number;
  error?: string;
}

/** 樣品位置：南側大道東邊草地（大道半寬 3 m，這裡離道路中心 9 m） */
export const P30_SAMPLE_SPOT = { x: 9, z: -30 } as const;

export async function loadVillageArtP3(scene: Scene, lite: boolean, shadows: ShadowGenerator | null, onState: (s: VillageArtState) => void): Promise<void> {
  const file = `p30_sample_${lite ? "lite" : "hq"}.glb`;
  const base = `${import.meta.env.BASE_URL}models/village-p3/`;
  const st: VillageArtState = { status: "loading", stage: "P3-0", file, ms: 0, meshes: 0, materials: 0, textures: 0, triangles: 0 };
  onState({ ...st });
  const t0 = performance.now();
  try {
    const c = await SceneLoader.LoadAssetContainerAsync(base, file, scene);
    c.addAllToScene();
    const root = new TransformNode("VP3_P30_root", scene);
    root.position.set(P30_SAMPLE_SPOT.x, 0, P30_SAMPLE_SPOT.z);
    for (const n of c.rootNodes) n.parent = root;
    let tris = 0;
    const meshes = c.meshes.filter((m): m is AbstractMesh => m.getTotalIndices() > 0);
    for (const m of meshes) {
      tris += m.getTotalIndices() / 3;
      m.isPickable = false;
      m.receiveShadows = true;
      shadows?.addShadowCaster(m, false);
    }
    for (const m of c.materials) {
      if (m instanceof PBRMaterial) {
        // 場景沒有環境貼圖：金屬面會偏暗，P3-0 先降低金屬度讓顏色看得出來（P3-1 再處理反射）
        m.metallic = Math.min(m.metallic ?? 0, 0.35);
        // 發光上限（避免過曝）
        m.emissiveIntensity = Math.min(m.emissiveIntensity, 1);
      }
    }
    for (const m of meshes) m.freezeWorldMatrix();
    st.status = "loaded";
    st.meshes = meshes.length;
    st.materials = c.materials.length;
    st.textures = c.textures.length;
    st.triangles = Math.round(tris);
  } catch (e) {
    st.status = "error";
    st.error = e instanceof Error ? e.message : String(e);
  }
  st.ms = Math.round(performance.now() - t0);
  onState({ ...st });
}
