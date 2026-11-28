/**
 * 星廢垃圾場 V3：四大地標正式美術（Tripo GLB）載入與組裝。
 *
 * - 只載入清單 models/junkyard/landmarks.json 列出的檔案；沒有清單或檔案時維持程序化地標
 * - 等比縮放（landmarkSlots 的 unit，不拉伸）、底面落地、朝向；吊車三件式組裝（craneRig）
 * - 材質轉成與場景同一套光照的 StandardMaterial（底色＋法線貼圖）；同一模型的多次擺放共用網格、材質、貼圖
 * - 高畫質：巨像、反應爐 70 m 外改畫 Lite
 * - 動態特效：landmarkFx（熔爐火焰、火星、煙霧、蒸氣；巨像眼睛與胸口核心；反應爐核心與旋轉環）
 * - 碰撞：terrain.ts 依模型實際外形產生（landmarkColliders.gen.ts），不在這裡處理
 * - &jylm=0：不載入 GLB（對照用）
 */
import "@babylonjs/loaders/glTF";
import { type AbstractMesh, type AssetContainer, Color3, type Material, Mesh, type Scene, SceneLoader, StandardMaterial, type Texture, TransformNode, type Vector3 } from "@babylonjs/core";
import { buildCraneRig, type CraneRig } from "./craneRig.ts";
import { CRANE_SPECS, LANDMARK_LOD_DISTANCE, landmarkFile, MODEL_BOUNDS, MODELS, type ModelKey, PLACEMENTS } from "./landmarkSlots.ts";
import { LandmarkFx } from "./landmarkFx.ts";
import { groundHeight } from "./terrain.ts";
import type { JunkyardWorld } from "./JunkyardWorld.ts";

export interface LandmarkLoadReport {
  manifest: string[];
  loaded: { model: string; file: string; tris: number; materials: number; textures: number; ms: number; lod: boolean }[];
  placed: { id: string; model: string; unit: number; size: number[] }[];
  failed: { file: string; error: string }[];
  hidden: number;
}

/** 測試與報告用：每個擺放的根節點、吊車組裝 */
export const LANDMARK_NODES = new Map<string, TransformNode>();
export const CRANE_RIGS = new Map<string, CraneRig>();
export const LANDMARK_STATE: { fx: LandmarkFx | null } = { fx: null };

function toStandard(scene: Scene, m: Material, cache: Map<Material, StandardMaterial>): StandardMaterial {
  const hit = cache.get(m);
  if (hit) return hit;
  const s = new StandardMaterial(`${m.name}_jylm`, scene);
  const src = m as unknown as { albedoTexture?: Texture | null; bumpTexture?: Texture | null; albedoColor?: Color3 };
  const tex = src.albedoTexture ?? null;
  s.diffuseColor = tex ? new Color3(1, 1, 1) : (src.albedoColor ?? new Color3(0.8, 0.8, 0.8));
  if (tex) s.diffuseTexture = tex;
  if (src.bumpTexture) {
    s.bumpTexture = src.bumpTexture;
    s.bumpTexture.level = 0.9;
  }
  // 低光澤金屬：保留鏽蝕與烤漆質感（Tripo 貼圖已畫好明暗）
  s.specularColor = new Color3(0.16, 0.15, 0.14);
  s.specularPower = 28;
  // 背光面補光（與 6.7 NPC 同一原則；戶外地標數值較低）
  s.emissiveColor = new Color3(0.1, 0.1, 0.1);
  s.maxSimultaneousLights = 2;
  cache.set(m, s);
  return s;
}

function instantiate(c: AssetContainer, tag: string, parent: TransformNode, scene: Scene, cache: Map<Material, StandardMaterial>): Mesh[] {
  const ent = c.instantiateModelsToScene((n) => `jylm_${tag}_${n}`, false, { doNotInstantiate: true });
  for (const r of ent.rootNodes) r.parent = parent;
  for (const g of ent.animationGroups) g.dispose();
  const meshes = parent.getChildMeshes(false).filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
  for (const m of meshes) {
    if (m.material) m.material = toStandard(scene, m.material, cache);
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = false;
  }
  return meshes;
}

export async function loadLandmarks(world: JunkyardWorld, opts: { baseUrl: string; lite: boolean; tier: "high" | "medium" | "low" }): Promise<LandmarkLoadReport> {
  const scene = world.scene;
  const rep: LandmarkLoadReport = { manifest: [], loaded: [], placed: [], failed: [], hidden: 0 };
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
  const containers = new Map<ModelKey, AssetContainer>();
  const far = new Map<ModelKey, AssetContainer>();

  const load = async (key: ModelKey, lite: boolean): Promise<AssetContainer | null> => {
    const file = landmarkFile(MODELS[key], lite);
    if (!have.has(file)) return null;
    const t0 = performance.now();
    try {
      const c = await SceneLoader.LoadAssetContainerAsync(opts.baseUrl, file, scene);
      rep.loaded.push({ model: key, file, tris: c.meshes.reduce((a, m) => a + m.getTotalIndices() / 3, 0), materials: c.materials.length, textures: c.textures.length, ms: Math.round(performance.now() - t0), lod: false });
      return c;
    } catch (e) {
      rep.failed.push({ file, error: String((e as Error)?.message ?? e).slice(0, 200) });
      return null;
    }
  };
  const keys = Object.keys(MODELS) as ModelKey[];
  await Promise.all(
    keys.map(async (k) => {
      const c = (await load(k, opts.lite)) ?? (await load(k, !opts.lite));
      if (c) containers.set(k, c);
      if (!opts.lite && MODELS[k].lod) {
        const f = await load(k, true);
        if (f) far.set(k, f);
      }
    }),
  );
  const fx = new LandmarkFx(scene, opts.tier);
  LANDMARK_STATE.fx = fx;
  const haloFn =
    (tag: string) =>
    (p: Vector3, size: number, color: [number, number, number], o: object): void =>
      world.halo(p.x, p.y, p.z, size, color, o as Parameters<JunkyardWorld["halo"]>[5], tag);

  // ---------------- 巨像、熔爐、反應爐 ----------------
  let furnaceSeed = 1;
  for (const pl of PLACEMENTS) {
    const c = containers.get(pl.model);
    if (!c) continue;
    const b = MODEL_BOUNDS[pl.model];
    const fx0 = MODELS[pl.model].yawFix;
    const place = new TransformNode(`jylm_${pl.id}`, scene);
    place.parent = world.root;
    const gy = pl.y ?? groundHeight(pl.x, pl.z);
    place.position.set(pl.x, gy, pl.z);
    place.rotation.y = pl.yaw;
    const fit = new TransformNode(`jylm_${pl.id}_fit`, scene);
    fit.parent = place;
    fit.scaling.setAll(pl.unit);
    const cx0 = (b.min[0] + b.max[0]) / 2;
    const cz0 = (b.min[2] + b.max[2]) / 2;
    const ccx = cx0 * Math.cos(fx0) + cz0 * Math.sin(fx0);
    const ccz = -cx0 * Math.sin(fx0) + cz0 * Math.cos(fx0);
    fit.position.set(-ccx * pl.unit, -b.min[1] * pl.unit - pl.sink, -ccz * pl.unit);
    const model = new TransformNode(`jylm_${pl.id}_model`, scene);
    model.parent = fit;
    model.rotation.y = fx0;
    const meshes = instantiate(c, pl.id, model, scene, cache);
    const fc = far.get(pl.model);
    if (fc) {
      const farNode = new TransformNode(`jylm_${pl.id}_far`, scene);
      farNode.parent = model;
      const fm = instantiate(fc, `${pl.id}_far`, farNode, scene, cache);
      if (fm.length === meshes.length) {
        meshes.forEach((m, i) => m.addLODLevel(LANDMARK_LOD_DISTANCE, fm[i]!));
        const r = rep.loaded.find((l) => l.model === pl.model && l.file.endsWith("_hq.glb"));
        if (r) r.lod = true;
      } else for (const m of fm) m.dispose();
    }
    const zone = pl.model === "colossus" ? "hills" : pl.model === "reactor" ? "core" : "factory";
    place.computeWorldMatrix(true);
    for (const m of meshes) {
      world.registerLandmarkMesh(m, zone, true);
      m.computeWorldMatrix(true);
      m.freezeWorldMatrix();
    }
    rep.hidden += world.hideProcedural(`${pl.model}:${pl.id}`);
    LANDMARK_NODES.set(pl.id, place);
    rep.placed.push({ id: pl.id, model: pl.model, unit: pl.unit, size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((v) => +(v * pl.unit).toFixed(2)) });
    if (pl.model === "furnace") fx.furnace(pl.id, model, pl.unit, furnaceSeed++ * 17, haloFn(`fx:${pl.id}`));
    else if (pl.model === "colossus") fx.colossus(model, pl.unit, haloFn("fx:colossus"));
    else if (pl.model === "reactor") fx.reactor(model, pl.unit, haloFn("fx:reactor"));
  }

  // ---------------- 吊車（三件式） ----------------
  const tower = containers.get("tower");
  const boom = containers.get("boom");
  const grab = containers.get("grab");
  if (tower && boom && grab) {
    const cableMat = new StandardMaterial("jylm_cable_m", scene);
    cableMat.diffuseColor = new Color3(0.16, 0.15, 0.14);
    cableMat.specularColor = new Color3(0.3, 0.3, 0.3);
    for (const spec of CRANE_SPECS) {
      const rig = buildCraneRig(
        scene,
        { tower, boom, grab },
        spec,
        (m) => {
          if (m.material) m.material = toStandard(scene, m.material, cache);
          (m as AbstractMesh).alwaysSelectAsActiveMesh = false;
        },
        cableMat,
      );
      rig.root.parent = world.root;
      const gy = groundHeight(spec.x, spec.z);
      rig.root.position.set(spec.x, gy, spec.z);
      const zone = spec.z < -20 ? "recycle" : "central";
      for (const m of rig.meshes) world.registerLandmarkMesh(m as Mesh, zone, true);
      rep.hidden += world.hideProcedural(`crane:${spec.id}:tower`) + world.hideProcedural(`crane:${spec.id}:jib`) + world.hideProcedural(`crane:${spec.id}:claw`);
      // 塔頂紅色警示燈（旋轉軸心正上方、駕駛室頂，不隨吊臂移動）
      world.halo(spec.x, gy + rig.pivotY + 0.33 * spec.boomUnit, spec.z, 1.6 * (spec.boomUnit / 19), [1, 0.25, 0.2], { alpha: 0.8, pulse: { speed: 4.2, amp: 0.9, phase: spec.phase } }, `fx:${spec.id}`);
      CRANE_RIGS.set(spec.id, rig);
      LANDMARK_NODES.set(`${spec.id}:tower`, rig.root);
      rep.placed.push({ id: spec.id, model: "crane", unit: spec.towerUnit, size: [+(0.385 * spec.towerUnit).toFixed(2), +(rig.pivotY + 0.344 * spec.boomUnit).toFixed(2), +(0.98 * spec.boomUnit).toFixed(2)] });
    }
  }
  world.updaters.push((dt, t, px, pz) => {
    for (const r of CRANE_RIGS.values()) r.update(t);
    fx.update(dt, px, pz, scene.activeCamera);
  });
  return rep;
}
