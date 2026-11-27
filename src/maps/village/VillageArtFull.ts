import "@babylonjs/loaders/glTF";
import { type AbstractMesh, type AnimationGroup, Color3, type Material, type Node, type Scene, SceneLoader, type ShadowGenerator, StandardMaterial, type Texture, TransformNode } from "@babylonjs/core";
import { setupBuildingP3 } from "./BuildingP3.ts";
import { ENV_SECTORS, setupEnvP3 } from "./EnvP3.ts";
import { setupFountainP3 } from "./FountainP3.ts";
import { setupKnightP3 } from "./KnightP3.ts";
import { setupMageP3 } from "./MageP3.ts";
import { copyNormalMap, type Loaded as NpcLoaded, NPC67, NPC_PROFILES, type NpcLodOptions, setupVillageNpcs, type VillageNpcs } from "./NpcP3.ts";
import { BOARD } from "./layout.ts";
import { type PetMerchantV2, setupPetMerchantV2 } from "./PetMerchantV2.ts";
import { setupPlazaP3 } from "./PlazaP3.ts";
import { setupPortalsP3 } from "./PortalP3.ts";

/**
 * Stage 6 P3 星芽村全村整合（&art=full）：載入三批正式候選美術＋寵物商人洛恩 V2.1＋Stage 6.2 八位正式 NPC。
 * - 只換「畫面」：碰撞、配置、NPC 站位、傳送門設定、移動規則全部沿用 layout.ts（不新增碰撞）
 * - 模型放在 public/models/village-p3/（由 Blender 美術工作流程產出的 HQ／Lite GLB 與共用貼圖）
 * - 靜態模型凍結世界矩陣；有動畫的（噴泉星晶、南門光柱／符文環、洛恩）不凍結
 */
export interface VillageArtFull {
  readonly merchant: PetMerchantV2 | null;
  /** Stage 6.2：八位正式 NPC（載入失敗時為 null，村莊仍可使用；佔位人形已在 art 模式隱藏） */
  readonly npcs: VillageNpcs | null;
  /** 靜態美術網格（效能診斷：隱藏建築與環境） */
  readonly statics: readonly AbstractMesh[];
  readonly parts: Record<string, { triangles: number; meshes: number }>;
  readonly loadMs: number;
  readonly errors: string[];
  /** Stage 6.7：委託佈告欄網格（可點擊開啟委託介面） */
  readonly board: readonly AbstractMesh[];
  /** Stage 6.7：實際使用的 NPC 模型組 */
  readonly npcSet: "v67" | "v66";
}

interface Loaded {
  meshes: AbstractMesh[];
  animationGroups: AnimationGroup[];
  transformNodes: TransformNode[];
  rootNodes: Node[];
}

/** Stage 6.3：角色 LOD 與模型版本 */
export interface ArtPerfOptions {
  lod: NpcLodOptions;
  /** true＝載入 Stage 6.2 原始高面數角色（_s62 檔；?perf=s62 比較用） */
  originalModels: boolean;
  /** Stage 6.7：NPC 模型組。"v67"＝使用者提供的 Tripo 正式 NPC（預設）；"v66"＝Stage 6.6 程式模型（前後比較用，?npcset=v66） */
  npcSet?: "v67" | "v66";
}

export async function loadVillageArtFull(scene: Scene, lite: boolean, shadows: ShadowGenerator | null, onProgress?: (msg: string) => void, perf?: ArtPerfOptions): Promise<VillageArtFull> {
  const lodOpt: NpcLodOptions = perf?.lod ?? { lod: false, near: 18, animThrottle: false, animFar: 32 };
  const orig = perf?.originalModels ?? false;
  /** 角色檔名：近距＝hq／lite；遠距＝far（s62 原始檔沒有遠距版本） */
  const charFile = (base: string): { near: string; far: string | null } =>
    orig ? { near: `${base}_${lite ? "lite" : "hq"}_s62.glb`, far: null } : { near: `${base}_${lite ? "lite" : "hq"}.glb`, far: lodOpt.lod ? `${base}_far.glb` : null };
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
  const v67 = (perf?.npcSet ?? "v67") === "v67" && !orig;
  const base67 = `${import.meta.env.BASE_URL}models/village-npc67/`;
  const lv67 = lite ? "lite" : "hq";
  const load = async (file: string, dir = base): Promise<Loaded> => {
    onProgress?.(`載入 ${file}`);
    const c = await SceneLoader.LoadAssetContainerAsync(dir, file, scene);
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
    const env = setupEnvP3(scene, r.meshes, { includeTerrain: false, sectors: lite ? 1 : ENV_SECTORS });
    statics.push(...env.meshes);
    stat("環境", [...env.meshes]);
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
    ["smith", "Smith", "鐵匠鋪", ["stone", "roof", "props"]], // Stage 6.6：二樓灰泥牆在 props，需要投影
    ["warehouse", "Ware", "倉庫", ["stone", "roof", "props"]],
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
  // Stage 6.7：委託佈告欄（N008 Tripo 正式模型；取消人物 NPC，直接點佈告欄開啟委託介面）。?npcset=v66 時沿用舊佈告欄建築
  const board: AbstractMesh[] = [];
  await step("board", async () => {
    if (!v67) {
      const r = await load(`board_${q}.glb`);
      setupBuildingP3(scene, r.meshes, "Board", { ...opt, casters: ["stone", "roof", "props"] });
      statics.push(...r.meshes);
      stat("委託佈告欄", r.meshes);
      return;
    }
    const r = await load(`board67_${lv67}.glb`, base67);
    const root = new TransformNode("board67", scene);
    root.position.set(BOARD.x, 0, BOARD.z);
    root.rotation.y = BOARD.rot + Math.PI; // 模型正面（+Z）朝向廣場中心
    for (const n of r.rootNodes) n.parent = root;
    const mats = new Map<Material, StandardMaterial>();
    for (const m of r.meshes) {
      const src = m.material;
      if (src) {
        let sm = mats.get(src);
        if (!sm) {
          sm = new StandardMaterial(`${src.name}_std`, scene);
          sm.diffuseTexture = (src as unknown as { albedoTexture?: Texture | null }).albedoTexture ?? null;
          sm.specularColor = new Color3(0.06, 0.06, 0.06);
          sm.specularPower = 16;
          sm.emissiveColor = new Color3(0.05, 0.05, 0.05);
          copyNormalMap(src, sm);
          mats.set(src, sm);
        }
        m.material = sm;
      }
      m.receiveShadows = true;
      shadows?.addShadowCaster(m, false);
      m.metadata = { questBoard: true };
      board.push(m);
    }
    statics.push(...r.meshes);
    stat("委託佈告欄", r.meshes);
  });
  await step("portals", async () => {
    const r = await load(`portals_${q}.glb`);
    setupPortalsP3(scene, r.meshes, opt);
    for (const m of r.meshes) if (m.name.startsWith("Portal_fx") || m.name.startsWith("Portal_rune")) animated.add(m);
    statics.push(...r.meshes);
    stat("傳送門與南門", r.meshes);
  });
  let merchant: PetMerchantV2 | null = null;
  await step("merchant", async () => {
    if (v67) {
      // Stage 6.7：N009 Tripo 正式洛恩（Idle／Walk／Talk／Turn；Walk 設計速度 0.6 m/s＝巡走速度）＋舊模型的小寵物零件
      const [r, far, palSrc] = await Promise.all([
        load(`pet_merchant67_${lv67}.glb`, base67),
        lodOpt.lod ? load("pet_merchant67_far.glb", base67) : Promise.resolve(null),
        load("pet_merchant_v2_lite.glb").catch(() => null),
      ]);
      merchant = setupPetMerchantV2(scene, r, { lite, shadows, far, lod: lodOpt, scale: 1, pal: palSrc, walkSpeed: 0.6, model: `pet_merchant67_${lv67}` });
      stat("寵物商人洛恩", r.meshes);
      return;
    }
    const f = charFile("pet_merchant_v2");
    const r = await load(f.near);
    const far = f.far ? await load(f.far) : null;
    merchant = setupPetMerchantV2(scene, r, { lite, shadows, far, lod: lodOpt });
    stat("寵物商人洛恩", r.meshes);
  });
  let npcs: VillageNpcs | null = null;
  let npcSetUsed: "v67" | "v66" = v67 ? "v67" : "v66";
  await step("npcs", async () => {
    const got = new Map<string, { near: NpcLoaded; far: NpcLoaded | null; scale?: number; model?: string }>();
    // 平行載入（八位 × 近／遠）：縮短全村載入時間
    await Promise.all(
      NPC_PROFILES.map(async (p) => {
        try {
          const stem = v67 ? NPC67[p.key] : undefined;
          if (stem) {
            // Stage 6.7：Tripo 正式 NPC（尺寸已含在模型內）
            const [near, far] = await Promise.all([load(`${stem}_${lv67}.glb`, base67), lodOpt.lod ? load(`${stem}_far.glb`, base67) : Promise.resolve(null)]);
            got.set(p.key, { near, far, scale: 1, model: `${stem}_${lv67}` });
            return;
          }
          const f = charFile(`npc_${p.key}`);
          const [near, far] = await Promise.all([load(f.near), f.far ? load(f.far) : Promise.resolve(null)]);
          got.set(p.key, { near, far });
        } catch (e) {
          errors.push(`npc ${p.key}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }),
    );
    npcs = setupVillageNpcs(scene, got, { lite, shadows, lod: lodOpt });
    const ms = [...got.values()].flatMap((r) => r.near.meshes);
    stat("正式NPC（8位）", ms);
    npcSetUsed = v67 ? "v67" : "v66";
  });
  for (const m of statics) {
    m.isPickable = false;
    if (!animated.has(m)) {
      m.freezeWorldMatrix();
      // Stage 6.3：靜態網格不再每幀同步包圍盒
      m.doNotSyncBoundingInfo = true;
    }
  }
  for (const m of board) m.isPickable = true;
  return { merchant, npcs, statics, parts, loadMs: Math.round(performance.now() - t0), errors, board, npcSet: npcSetUsed };
}
