import "@babylonjs/loaders/glTF";
import { type AbstractMesh, type AssetContainer, type Mesh, type Scene, SceneLoader, TransformNode, VertexBuffer } from "@babylonjs/core";
import { offsetUVs } from "../assets/expressionAtlas.ts";
import { type ExpressionAtlasSpec, lodFileName, type MonsterAssetSpec, type MonsterLod, rootNodeName } from "../assets/spec.ts";

/**
 * 共用：依畫質載入怪物 GLB、檢查根節點命名、讀取 extras、建立多個實例、統一釋放資源。
 * 一種怪物載入一次（AssetContainer），多隻同場時共用幾何與貼圖，只複製節點。
 */
export interface MonsterAssetHandle {
  readonly spec: MonsterAssetSpec;
  readonly lod: MonsterLod;
  readonly file: string;
  readonly container: AssetContainer;
  /** 根節點 extras（例：星露啵啵的腹部星星定義） */
  readonly extras: Readonly<Record<string, unknown>>;
  /** 建立一個實例：回傳新的根節點與其下的零件 */
  instantiate(name: string): MonsterAssetInstance;
  /** 釋放所有實例與容器（幾何、材質、貼圖） */
  dispose(): void;
}

export interface MonsterAssetInstance {
  readonly root: TransformNode;
  readonly meshes: Mesh[];
  /** 依名稱開頭找零件，找不到會丟出錯誤（模型缺零件時立刻知道） */
  part(prefix: string): Mesh;
  dispose(): void;
}

export async function loadMonsterAsset(scene: Scene, baseUrl: string, spec: MonsterAssetSpec, lod: MonsterLod): Promise<MonsterAssetHandle> {
  const file = lodFileName(spec, lod);
  const container = await SceneLoader.LoadAssetContainerAsync(baseUrl, file, scene);
  const expectedRoot = rootNodeName(spec, lod);
  const nodes: (TransformNode | AbstractMesh)[] = [...container.transformNodes, ...container.meshes];
  const rootNode = nodes.find((n) => n.name === expectedRoot);
  if (!rootNode) throw new Error(`${file}：找不到根節點 ${expectedRoot}（命名規範見 docs/monsters/ASSET_PIPELINE.md）`);
  const extras = ((rootNode.metadata as { gltf?: { extras?: Record<string, unknown> } } | null)?.gltf?.extras ?? {}) as Record<string, unknown>;
  const live = new Set<MonsterAssetInstance>();
  let seq = 0;

  const handle: MonsterAssetHandle = {
    spec,
    lod,
    file,
    container,
    extras,
    instantiate(name) {
      const n = seq++;
      const entries = container.instantiateModelsToScene((x) => `${x}_${n}`, false, { doNotInstantiate: true });
      const root = new TransformNode(name, scene);
      for (const r of entries.rootNodes) r.parent = root;
      const meshes = root.getChildMeshes(false) as Mesh[];
      for (const req of spec.requiredParts) {
        if (!meshes.some((m) => m.name.startsWith(req))) throw new Error(`${file}：缺少零件 ${req}`);
      }
      const inst: MonsterAssetInstance = {
        root,
        meshes,
        part(prefix) {
          const m = meshes.find((mm) => mm.name.startsWith(prefix));
          if (!m) throw new Error(`${file}：缺少零件 ${prefix}`);
          return m;
        },
        dispose() {
          // 只釋放節點；共用的幾何、材質、貼圖由 handle.dispose() 統一釋放
          root.dispose(false, false);
          live.delete(inst);
        },
      };
      live.add(inst);
      return inst;
    },
    dispose() {
      for (const i of [...live]) i.dispose();
      container.dispose();
    },
  };
  return handle;
}

/**
 * 共用：表情貼圖集控制器（改 UV 切換表情）。每個實例各一個。
 * glTF 載入的 UV 緩衝預設不可更新，這裡會複製一份可更新的緩衝（每個零件只做一次）。
 */
export class ExpressionAtlasController {
  private readonly parts: { mesh: Mesh; base: Float32Array; buf: Float32Array; part: ExpressionAtlasSpec["parts"][number] }[] = [];
  private current = 0;
  readonly spec: ExpressionAtlasSpec;

  constructor(spec: ExpressionAtlasSpec, inst: MonsterAssetInstance) {
    this.spec = spec;
    for (const part of spec.parts) {
      const mesh = inst.part(part.mesh);
      mesh.makeGeometryUnique();
      const base = Float32Array.from(mesh.getVerticesData(VertexBuffer.UVKind) ?? []);
      mesh.setVerticesData(VertexBuffer.UVKind, Float32Array.from(base), true);
      this.parts.push({ mesh, base, buf: new Float32Array(base.length), part });
    }
  }

  get index(): number {
    return this.current;
  }

  set(index: number): void {
    this.current = index;
    for (const p of this.parts) {
      offsetUVs(p.base, p.part, index, p.buf);
      p.mesh.updateVerticesData(VertexBuffer.UVKind, p.buf);
    }
  }

  /**
   * 只把其中一個零件換成另一格（例：眨眼時只換眼睛、嘴巴不動）；index 省略 = 回到目前表情。
   * 不改目前表情（index 讀取值不變）
   */
  setPart(meshName: string, index?: number): void {
    const p = this.parts.find((pp) => pp.part.mesh === meshName);
    if (!p) return;
    offsetUVs(p.base, p.part, index ?? this.current, p.buf);
    p.mesh.updateVerticesData(VertexBuffer.UVKind, p.buf);
  }

  /** 第 0 個零件目前第一個 UV（測試用） */
  firstUV(): [number, number] {
    const p = this.parts[0]!;
    const uv = p.mesh.getVerticesData(VertexBuffer.UVKind)!;
    return [uv[0]!, uv[1]!];
  }
}
