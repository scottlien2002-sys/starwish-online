import "@babylonjs/loaders/glTF";
import { type AbstractMesh, type AnimationGroup, type Node, type Scene, SceneLoader, type ShadowGenerator, type TransformNode } from "@babylonjs/core";
import { setupBuildingP3 } from "./BuildingP3.ts";
import { setupEnvP3 } from "./EnvP3.ts";
import { setupFountainP3 } from "./FountainP3.ts";
import { setupKnightP3 } from "./KnightP3.ts";
import { setupMageP3 } from "./MageP3.ts";
import { type PetMerchantV2, setupPetMerchantV2 } from "./PetMerchantV2.ts";
import { setupPlazaP3 } from "./PlazaP3.ts";
import { setupPortalsP3 } from "./PortalP3.ts";

/**
 * Stage 6 P3 星芽村全村整合（&art=full）：載入三批正式候選美術＋寵物商人洛恩 V2.1。
 * - 只換「畫面」：碰撞、配置、NPC 站位、傳送門設定、移動規則全部沿用 layout.ts（不新增碰撞）
 * - 模型放在 public/models/village-p3/（由 Blender 美術工作流程產出的 HQ／Lite GLB 與共用貼圖）
 * - 靜態模型凍結世界矩陣；有動畫的（噴泉星晶、南門光柱／符文環、洛恩）不凍結
 */
export interface VillageArtFull {
  readonly merchant: PetMerchantV2 | null;
  readonly parts: Record<string, { triangles: number; meshes: number }>;
  readonly loadMs: number;
  readonly errors: string[];
}

interface Loaded {
  meshes: AbstractMesh[];
  animationGroups: AnimationGroup[];
  transformNodes: TransformNode[];
  rootNodes: Node[];
}

export async function loadVillageArtFull(scene: Scene, lite: boolean, shadows: ShadowGenerator | null, onProgress?: (msg: string) => void): Promise<VillageArtFull> {
  const t0 = performance.now();
  const base = `${import.meta.env.BASE_URL}models/village-p3/`;
  const texBase = `${base}tex/`;
  const q = lite ? "lite" : "hq";
  const parts: Record<string, { triangles: number; meshes: number }> = {};
  const errors: string[] = [];
  const stat = (name: string, meshes: AbstractMesh[]): void => {
    const ms = meshes.filter((m) => m.getTotalIndices() > 0 && m.isEnabled());
    parts[name] = { meshes: ms.length, triangles: Math.round(ms.reduce((a, m) => a + m.getTotalIndices() / 3, 0)) };
  };
  const load = async (file: string): Promise<Loaded> => {
    onProgress?.(`載入 ${file}`);
    const c = await SceneLoader.LoadAssetContainerAsync(base, file, scene);
    c.addAllToScene();
    return { meshes: c.meshes.filter((m) => m.getTotalIndices() > 0), animationGroups: c.animationGroups, transformNodes: c.transformNodes, rootNodes: c.rootNodes };
  };
  const statics: AbstractMesh[] = [];
  const animated = new Set<AbstractMesh>();
  const opt = { lite, texBase, shadows };
  const step = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  await step("env", async () => {
    const r = await load(`env_${q}.glb`);
    setupEnvP3(scene, r.meshes, { includeTerrain: false });
    statics.push(...r.meshes);
    stat("環境", r.meshes);
  });
  await step("plaza", async () => {
    const r = await load(`plaza_${q}.glb`);
    setupPlazaP3(scene, r.meshes, opt);
    statics.push(...r.meshes);
    stat("廣場與道路", r.meshes);
  });
  await step("fountain", async () => {
    const r = await load(`fountain_${q}.glb`);
    const f = setupFountainP3(scene, r.meshes, null, opt);
    for (const m of f.animated) animated.add(m);
    statics.push(...r.meshes);
    stat("星願之泉", r.meshes);
  });
  await step("platform", async () => {
    const r = await load(`platform_${q}.glb`);
    setupBuildingP3(scene, r.meshes, "Platform", { ...opt, casters: [] });
    statics.push(...r.meshes);
    stat("高台與石階", r.meshes);
  });
  await step("knight", async () => {
    const r = await load(`knight_${q}.glb`);
    setupKnightP3(scene, r.meshes, opt);
    statics.push(...r.meshes);
    stat("騎士軍團", r.meshes);
  });
  await step("mage", async () => {
    const r = await load(`mage_${q}.glb`);
    setupMageP3(scene, r.meshes, opt);
    statics.push(...r.meshes);
    stat("法師軍團", r.meshes);
  });
  for (const [file, prefix, label, casters] of [
    ["sword", "Sword", "劍士軍團", undefined],
    ["smith", "Smith", "鐵匠鋪", undefined],
    ["warehouse", "Ware", "倉庫", ["stone", "roof", "props"]],
    ["board", "Board", "委託佈告欄", ["stone", "roof", "props"]],
    ["church", "Church", "祭司教堂", undefined],
    ["circus", "Circus", "小丑馬戲團", ["stone", "props"]],
    ["guild", "Guild", "星願商會", undefined],
  ] as const) {
    await step(file, async () => {
      const r = await load(`${file}_${q}.glb`);
      setupBuildingP3(scene, r.meshes, prefix, casters ? { ...opt, casters } : opt);
      statics.push(...r.meshes);
      stat(label, r.meshes);
    });
  }
  await step("portals", async () => {
    const r = await load(`portals_${q}.glb`);
    setupPortalsP3(scene, r.meshes, opt);
    for (const m of r.meshes) if (m.name.startsWith("Portal_fx") || m.name.startsWith("Portal_rune")) animated.add(m);
    statics.push(...r.meshes);
    stat("傳送門與南門", r.meshes);
  });
  let merchant: PetMerchantV2 | null = null;
  await step("merchant", async () => {
    const r = await load(`pet_merchant_v2_${q}.glb`);
    merchant = setupPetMerchantV2(scene, r, { lite, shadows });
    stat("寵物商人洛恩", r.meshes);
  });
  for (const m of statics) {
    m.isPickable = false;
    if (!animated.has(m)) m.freezeWorldMatrix();
  }
  return { merchant, parts, loadMs: Math.round(performance.now() - t0), errors };
}
