/**
 * 怪物資源規範（Monster Asset Spec）— 共用，不依賴 Babylon.js（可在 Node 單元測試）。
 *
 * 與 src/monsters/framework/（數值、狀態機、AI、動畫設定、視覺介面）分工：
 *   framework/ 管「怪物怎麼行動」；assets/ 管「怪物的模型檔長什麼樣、怎麼命名、能用多少預算」。
 *
 * 不假設怪物有果凍、星雲或翅膀：這些是個別怪物的 features，由各自的材質／模型實作。
 * 說明文件：docs/monsters/ASSET_PIPELINE.md
 */

export type MonsterLod = "high" | "medium" | "low";
export const MONSTER_LODS: readonly MonsterLod[] = ["high", "medium", "low"];

/** 怪物種類（決定預設的材質方向與檢查重點，不限制實作） */
export type MonsterFamily = "jelly" | "beast" | "plant" | "skeleton" | "mech" | "dragon" | "other";

/** 等級：一般怪、菁英、頭目（決定效能預算） */
export type MonsterTier = "normal" | "elite" | "boss";

/** 每隻怪物（全部零件合計）的三角形預算；與 art/common/glb_tools.py 相同 */
export const TRIANGLE_BUDGET: Readonly<Record<MonsterTier, Readonly<Record<MonsterLod, number>>>> = {
  normal: { high: 12000, medium: 7000, low: 4500 },
  elite: { high: 20000, medium: 12000, low: 7000 },
  boss: { high: 60000, medium: 30000, low: 15000 },
};

/** 單一 GLB 檔案大小上限（位元組，含內嵌貼圖） */
export const FILE_BUDGET: Readonly<Record<MonsterTier, number>> = { normal: 1_000_000, elite: 2_000_000, boss: 6_000_000 };

/** 每隻怪物的繪製次數（Draw Calls）建議上限（高畫質、含深度預先繪製；不含共用的陰影／光暈批次） */
export const DRAW_CALL_BUDGET: Readonly<Record<MonsterTier, number>> = { normal: 7, elite: 10, boss: 20 };

/** 表情貼圖集：用改 UV 的方式切換表情（不重建材質、不換貼圖） */
export interface ExpressionAtlasPart {
  /** 模型中零件名稱的開頭（例 "Eyes"、"Mouth"） */
  mesh: string;
  cols: number;
  rows: number;
  /** 一格在 UV 上的寬高（例 0.25 × 0.5） */
  cellU: number;
  cellV: number;
}

export interface ExpressionAtlasSpec {
  /** 表情名稱，順序 = 格子編號（由左到右、由上到下） */
  names: readonly string[];
  parts: readonly ExpressionAtlasPart[];
}

export interface MonsterAssetSpec {
  /** 對應 MonsterDefinition.monsterId（例 "star_dew_bobo"） */
  monsterId: string;
  /** 檔名用的短名稱，小寫英數與底線（例 "bobo"） */
  assetId: string;
  /** 模型根節點用的名稱，PascalCase（例 "StarDewBobo"） */
  pascalName: string;
  /** 版本，"v" + 數字（例 "v36" = 3.6） */
  version: string;
  family: MonsterFamily;
  tier: MonsterTier;
  /** 身高（公尺，不含天線等細長裝飾）；遊戲內 1 單位 = 1 公尺 */
  heightM: number;
  /** 腳下接觸陰影／碰撞的半徑（公尺） */
  footprintRadiusM: number;
  /** 模型必須包含的零件（名稱開頭） */
  requiredParts: readonly string[];
  expressions?: ExpressionAtlasSpec;
  /** 個別怪物的外觀特徵（只做紀錄與檢查用，例 { jelly: true, wings: true }） */
  features?: Readonly<Record<string, boolean>>;
}

const ASSET_ID = /^[a-z][a-z0-9_]*$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const VERSION = /^v\d+[a-z]?$/; // 例 v36；重建版可加一個小寫字母（例 v38r）

/** 命名規範：<assetId>_<版本>_<畫質>.glb，例 bobo_v36_high.glb */
export function lodFileName(spec: Pick<MonsterAssetSpec, "assetId" | "version">, lod: MonsterLod): string {
  return `${spec.assetId}_${spec.version}_${lod}.glb`;
}

/** 根節點命名：<PascalName>V<數字>_<畫質>，例 StarDewBoboV36_high */
export function rootNodeName(spec: Pick<MonsterAssetSpec, "pascalName" | "version">, lod: MonsterLod): string {
  return `${spec.pascalName}V${spec.version.slice(1)}_${lod}`;
}

/** 檢查規範本身；回傳錯誤訊息（空陣列 = 通過） */
export function validateAssetSpec(spec: MonsterAssetSpec): string[] {
  const e: string[] = [];
  if (!spec.monsterId) e.push("缺少 monsterId");
  if (!ASSET_ID.test(spec.assetId)) e.push(`assetId「${spec.assetId}」須為小寫英數與底線`);
  if (!PASCAL.test(spec.pascalName)) e.push(`pascalName「${spec.pascalName}」須為 PascalCase`);
  if (!VERSION.test(spec.version)) e.push(`version「${spec.version}」須為 v + 數字，可再加一個小寫字母（例 v36、v38r）`);
  if (!(spec.heightM > 0 && spec.heightM < 50)) e.push(`heightM ${spec.heightM} 不合理`);
  if (!(spec.footprintRadiusM > 0)) e.push("footprintRadiusM 須大於 0");
  if (spec.requiredParts.length === 0) e.push("requiredParts 不可為空");
  const ex = spec.expressions;
  if (ex) {
    if (new Set(ex.names).size !== ex.names.length) e.push("表情名稱重複");
    for (const p of ex.parts) {
      if (p.cols * p.rows < ex.names.length) e.push(`表情零件 ${p.mesh} 只有 ${p.cols * p.rows} 格，少於 ${ex.names.length} 種表情`);
      if (p.cols * p.cellU > 1.0001 || p.rows * p.cellV > 1.0001) e.push(`表情零件 ${p.mesh} 的格子超出貼圖範圍`);
    }
  }
  return e;
}

export interface LodMeasurement {
  triangles: number;
  bytes: number;
}

/** 檢查三種畫質的實際三角形數與檔案大小是否在預算內，且高 ≥ 中 ≥ 低 */
export function checkLodBudgets(spec: MonsterAssetSpec, measured: Readonly<Record<MonsterLod, LodMeasurement>>): string[] {
  const e: string[] = [];
  let prev = Infinity;
  for (const lod of MONSTER_LODS) {
    const m = measured[lod];
    const name = lodFileName(spec, lod);
    if (m.triangles > TRIANGLE_BUDGET[spec.tier][lod]) e.push(`${name}：三角形 ${m.triangles} 超過 ${spec.tier} 預算 ${TRIANGLE_BUDGET[spec.tier][lod]}`);
    if (m.bytes > FILE_BUDGET[spec.tier]) e.push(`${name}：檔案 ${m.bytes} 位元組超過上限 ${FILE_BUDGET[spec.tier]}`);
    if (m.triangles > prev) e.push(`${name}：三角形比上一級畫質多`);
    prev = m.triangles;
  }
  return e;
}
