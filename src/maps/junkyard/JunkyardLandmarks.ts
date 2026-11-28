/**
 * 星廢垃圾場 V3：大型地標 GLB 載入（Tripo 靜態模型 → 取代程序化地標）。
 *
 * - 只載入清單 models/junkyard/landmarks.json 裡列出的檔案（沒有檔案時完全不發出請求，維持程序化地標）
 * - 自動縮放、置中、落地（依 landmarkSlots 的規格尺寸），朝向依擺放資料
 * - 材質轉成 StandardMaterial（與垃圾場同一套光照；保留底色與 HQ 法線貼圖）
 * - 吊車：塔身固定；吊臂掛在既有的旋轉節點、抓斗掛在既有的升降節點（動作由遊戲端控制）
 * - 碰撞沿用 terrain.ts，不從模型產生
 * - &jylm=0：不載入 GLB（對照用）
 */
import { type AbstractMesh, type AssetContainer, Color3, type Material, Mesh, MeshBuilder, type Scene, SceneLoader, StandardMaterial, type Texture, TransformNode, Vector3 } from "@babylonjs/core";
import { fitTransform, LANDMARK_LOD_DISTANCE, LANDMARK_SLOTS, type LandmarkPart, type LandmarkPlacement, type LandmarkSlot, landmarkFile } from "./landmarkSlots.ts";
import { groundHeight } from "./terrain.ts";
import type { JunkyardWorld } from "./JunkyardWorld.ts";

export interface LandmarkLoadReport {
  manifest: string[];
  loaded: { slot: string; part: string; file: string; placements: number; tris: number; materials: number; scale: number; ms: number; lod: boolean }[];
  failed: { file: string; error: string }[];
  hidden: number;
}

/** 測試與報告用：每個擺放的根節點 */
export const LANDMARK_NODES = new Map<string, TransformNode>();

function toStandard(scene: Scene, m: Material, cache: Map<Material, StandardMaterial>): StandardMaterial {
  const hit = cache.get(m);
  if (hit) return hit;
  const s = new StandardMaterial(`${m.name}_jylm`, scene);
  const src = m as unknown as { albedoTexture?: Texture | null; bumpTexture?: Texture | null; albedoColor?: Color3; invertNormalMapX?: boolean; invertNormalMapY?: boolean };
  const tex = src.albedoTexture ?? null;
  s.diffuseColor = tex ? new Color3(1, 1, 1) : (src.albedoColor ?? new Color3(0.8, 0.8, 0.8));
  if (tex) s.diffuseTexture = tex;
  if (src.bumpTexture) {
    s.bumpTexture = src.bumpTexture;
    s.invertNormalMapX = !!src.invertNormalMapX;
    s.invertNormalMapY = !!src.invertNormalMapY;
  }
  s.specularColor = new Color3(0.1, 0.1, 0.1);
  s.specularPower = 24;
  // Tripo 貼圖已畫好明暗：補一點背光面亮度（與 6.7 NPC 同一個原則，數值較低，地標在戶外陽光下）
  s.emissiveColor = new Color3(0.12, 0.12, 0.12);
  s.maxSimultaneousLights = 2;
  cache.set(m, s);
  return s;
}

/** 在 parent 之下建立一份模型，套用 yawFix＋自動縮放置中；回傳最外層的 fit 節點 */
function instantiate(scene: Scene, c: AssetContainer, part: LandmarkPart, tag: string, cache: Map<Material, StandardMaterial>, far: AssetContainer | null = null): { fit: TransformNode; meshes: Mesh[]; scale: number; lod: boolean } {
  const fit = new TransformNode(`jylm_${tag}_fit`, scene);
  const yawNode = new TransformNode(`jylm_${tag}_yaw`, scene);
  yawNode.parent = fit;
  yawNode.rotation.y = part.yawFix;
  const ent = c.instantiateModelsToScene((n) => `jylm_${tag}_${n}`, false, { doNotInstantiate: true });
  for (const r of ent.rootNodes) r.parent = yawNode;
  for (const g of ent.animationGroups) g.dispose();
  for (const sk of ent.skeletons) sk.dispose();
  // 量測（fit 在原點、未縮放）
  fit.computeWorldMatrix(true);
  const meshes = yawNode.getChildMeshes(false).filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
  let min = new Vector3(Infinity, Infinity, Infinity);
  let max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const m of meshes) {
    m.computeWorldMatrix(true);
    m.refreshBoundingInfo();
    const bb = m.getBoundingInfo().boundingBox;
    min = Vector3.Minimize(min, bb.minimumWorld);
    max = Vector3.Maximize(max, bb.maximumWorld);
  }
  const f = fitTransform(part, min, max);
  fit.scaling.setAll(f.s);
  fit.position.set(f.tx, f.ty, f.tz);
  for (const m of meshes) {
    if (m.material) m.material = toStandard(scene, m.material, cache);
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = false;
  }
  // 高畫質：遠距離改畫 Lite（同一個來源模型減面而成，座標一致；網格數相同才配對）
  let lod = false;
  if (far) {
    const fe = far.instantiateModelsToScene((n) => `jylm_${tag}_far_${n}`, false, { doNotInstantiate: true });
    for (const r of fe.rootNodes) r.parent = yawNode;
    const farMeshes = yawNode.getChildMeshes(false).filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0 && m.name.includes("_far_"));
    if (farMeshes.length === meshes.length) {
      meshes.forEach((m, i) => {
        const lm = farMeshes[i]!;
        if (lm.material) lm.material = toStandard(scene, lm.material, cache);
        lm.isPickable = false;
        m.addLODLevel(LANDMARK_LOD_DISTANCE, lm);
      });
      lod = true;
    } else {
      for (const m of farMeshes) m.dispose(false, false);
    }
  }
  return { fit, meshes, scale: f.s, lod };
}

function triCount(meshes: AbstractMesh[]): number {
  return meshes.reduce((a, m) => a + m.getTotalIndices() / 3, 0);
}

export async function loadLandmarks(world: JunkyardWorld, opts: { baseUrl: string; lite: boolean }): Promise<LandmarkLoadReport> {
  const scene = world.scene;
  const rep: LandmarkLoadReport = { manifest: [], loaded: [], failed: [], hidden: 0 };
  if (typeof location !== "undefined" && new URLSearchParams(location.search).get("jylm") === "0") return rep;
  try {
    const r = await fetch(`${opts.baseUrl}landmarks.json`, { cache: "no-cache" });
    if (!r.ok) return rep;
    rep.manifest = ((await r.json()) as { files?: string[] }).files ?? [];
  } catch {
    return rep;
  }
  if (!rep.manifest.length) return rep;
  const have = new Set(rep.manifest);
  const cache = new Map<Material, StandardMaterial>();

  const farOf = new Map<string, AssetContainer>();
  const loadPart = async (slot: LandmarkSlot, part: LandmarkPart): Promise<AssetContainer | null> => {
    // 畫質對應的檔案沒有時，退而使用另一個（例：只交付了 HQ）
    const want = landmarkFile(part, opts.lite);
    const alt = landmarkFile(part, !opts.lite);
    const file = have.has(want) ? want : have.has(alt) ? alt : null;
    if (!file) return null;
    const t0 = performance.now();
    try {
      const c = await SceneLoader.LoadAssetContainerAsync(opts.baseUrl, file, scene);
      rep.loaded.push({ slot: slot.id, part: part.key, file, placements: 0, tris: 0, materials: c.materials.length, scale: 0, ms: Math.round(performance.now() - t0), lod: false });
      if (!opts.lite && file === want && have.has(alt)) {
        try {
          farOf.set(`${slot.id}:${part.key}`, await SceneLoader.LoadAssetContainerAsync(opts.baseUrl, alt, scene));
        } catch (e) {
          rep.failed.push({ file: alt, error: String((e as Error)?.message ?? e).slice(0, 200) });
        }
      }
      return c;
    } catch (e) {
      rep.failed.push({ file, error: String((e as Error)?.message ?? e).slice(0, 200) });
      return null;
    }
  };

  for (const slot of LANDMARK_SLOTS) {
    const containers = new Map<string, AssetContainer>();
    for (const part of slot.parts) {
      const c = await loadPart(slot, part);
      if (c) containers.set(part.key, c);
    }
    if (!containers.size) continue;
    for (const pl of slot.placements) placeSlot(world, slot, pl, containers, cache, rep, farOf);
  }
  return rep;
}

function placeSlot(world: JunkyardWorld, slot: LandmarkSlot, pl: LandmarkPlacement, containers: Map<string, AssetContainer>, cache: Map<Material, StandardMaterial>, rep: LandmarkLoadReport, farOf: Map<string, AssetContainer>): void {
  const scene = world.scene;
  const zone = slot.id === "colossus" ? "hills" : slot.id === "reactor" ? "core" : slot.id === "furnace" ? "factory" : pl.z < -20 ? "recycle" : "central";
  const record = (part: LandmarkPart, res: { meshes: Mesh[]; scale: number; lod: boolean }): void => {
    const r = rep.loaded.find((x) => x.slot === slot.id && x.part === part.key);
    if (r) {
      r.placements++;
      r.tris = triCount(res.meshes);
      r.scale = +res.scale.toFixed(4);
      r.lod = res.lod;
    }
  };
  const far = (key: string): AssetContainer | null => farOf.get(`${slot.id}:${key}`) ?? null;
  if (slot.id === "crane") {
    const nodes = world.craneNodes.get(pl.id);
    if (!nodes) return;
    const tower = slot.parts.find((p) => p.key === "tower")!;
    const jib = slot.parts.find((p) => p.key === "jib")!;
    const claw = slot.parts.find((p) => p.key === "claw")!;
    const tc = containers.get("tower");
    if (tc) {
      const place = new TransformNode(`jylm_${pl.id}_tower`, scene);
      place.parent = world.root;
      place.position.set(pl.x, nodes.gy, pl.z);
      place.scaling.setAll(pl.scale);
      const r = instantiate(scene, tc, tower, `${pl.id}_tower`, cache, far("tower"));
      r.fit.parent = place;
      for (const m of r.meshes) world.registerLandmarkMesh(m, zone, true);
      place.computeWorldMatrix(true);
      place.getChildMeshes().forEach((m) => {
        m.computeWorldMatrix(true);
        m.freezeWorldMatrix();
      });
      rep.hidden += world.hideProcedural(`crane:${pl.id}:tower`);
      LANDMARK_NODES.set(`${pl.id}:tower`, place);
      record(tower, r);
    }
    const jc = containers.get("jib");
    if (jc) {
      // 吊臂模型朝 +Z；程式的吊臂朝本地 +X → 繞 Y 轉 +90°
      const place = new TransformNode(`jylm_${pl.id}_jib`, scene);
      place.parent = nodes.swing;
      place.rotation.y = Math.PI / 2;
      place.scaling.setAll(pl.scale);
      const r = instantiate(scene, jc, jib, `${pl.id}_jib`, cache, far("jib"));
      r.fit.parent = place;
      for (const m of r.meshes) world.registerLandmarkMesh(m, zone, true);
      rep.hidden += world.hideProcedural(`crane:${pl.id}:jib`);
      // 抓斗移到模型吊臂前端（前端長度＝規格深度−旋轉軸後方長度，再內縮 0.6 m）
      nodes.claw.position.x = (jib.size.d - (jib.zFromBack ?? jib.size.d / 2) - 0.6) * pl.scale;
      // 吊索（細長方塊，跟著吊臂）
      const cable = MeshBuilder.CreateBox(`jylm_${pl.id}_cable`, { size: 1 }, scene);
      cable.scaling.set(0.07, 3.6, 0.07);
      cable.parent = nodes.swing;
      cable.position.set(nodes.claw.position.x, -1.6, 0);
      cable.material = world.mats.metal;
      cable.isPickable = false;
      world.registerLandmarkMesh(cable, zone, false);
      LANDMARK_NODES.set(`${pl.id}:jib`, place);
      record(jib, r);
    }
    const cc = containers.get("claw");
    if (cc) {
      const place = new TransformNode(`jylm_${pl.id}_claw`, scene);
      place.parent = nodes.claw;
      place.position.y = 0.4;
      place.scaling.setAll(pl.scale);
      const r = instantiate(scene, cc, claw, `${pl.id}_claw`, cache, far("claw"));
      r.fit.parent = place;
      for (const m of r.meshes) world.registerLandmarkMesh(m, zone, true);
      rep.hidden += world.hideProcedural(`crane:${pl.id}:claw`);
      LANDMARK_NODES.set(`${pl.id}:claw`, place);
      record(claw, r);
    }
    return;
  }
  const part = slot.parts[0]!;
  const c = containers.get(part.key);
  if (!c) return;
  const place = new TransformNode(`jylm_${pl.id}`, scene);
  place.parent = world.root;
  place.position.set(pl.x, pl.y ?? groundHeight(pl.x, pl.z), pl.z);
  place.rotation.y = pl.yaw;
  place.scaling.setAll(pl.scale);
  const r = instantiate(scene, c, part, pl.id, cache, far(part.key));
  r.fit.parent = place;
  place.computeWorldMatrix(true);
  for (const m of r.meshes) {
    world.registerLandmarkMesh(m, zone, true);
    m.computeWorldMatrix(true);
    m.freezeWorldMatrix();
  }
  rep.hidden += world.hideProcedural(`${slot.id}:${pl.id}`);
  LANDMARK_NODES.set(pl.id, place);
  record(part, r);
}
