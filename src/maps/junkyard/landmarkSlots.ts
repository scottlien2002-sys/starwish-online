/**
 * 星廢垃圾場 V3：四大地標正式美術（Tripo GLB）的擺放資料（純資料，可單元測試）。
 *
 * 模型座標：Tripo 輸出的模型都在單位立方體內（最長邊約 0.98、中心在原點）。Babylon 載入後 x 與 glTF 相反。
 * 遊戲端用「每單位幾公尺」（unit）等比縮放，**不拉伸、不壓扁**；底面中心落在擺放點（再往下 sink 公尺，接觸地面）。
 * 正面：LM01／LM02／LM04 三個模型的正面都在模型 −X 方向（Babylon），yawFix＝π/2 把它轉到 +Z。
 * 數值都在地標實驗場景（?map=jylab）用頂點分層統計、點選表面座標與截圖量測，見專案文件 Junkyard_V3_Landmarks_Report。
 */
import { CRANES, FURNACES } from "./layout.ts";
import { type CraneRigSpec } from "./craneSpec.ts";

export interface LandmarkModel {
  stem: string;
  /** 交付的原始檔名（art/junkyard-lm/raw/） */
  raw: string;
  hqTris: number;
  liteTris: number;
  hqTex: number;
  liteTex: number;
  /** 模型正面轉到 +Z 的修正（弧度） */
  yawFix: number;
  /** 高畫質是否另載 Lite 做 70 m 外的距離切換（大型地標才需要） */
  lod: boolean;
}

export const MODELS = {
  colossus: { stem: "jy_lm_colossus", raw: "Starwish_Junkyard_LM01_RAW.glb", hqTris: 22000, liteTris: 7000, hqTex: 2048, liteTex: 1024, yawFix: Math.PI / 2, lod: true },
  furnace: { stem: "jy_lm_furnace", raw: "Starwish_Junkyard_LM02.glb", hqTris: 12000, liteTris: 10500, hqTex: 1024, liteTex: 1024, yawFix: Math.PI / 2, lod: false },
  tower: { stem: "jy_lm_crane_tower", raw: "Starwish_Junkyard_LM03_A_Tower.glb", hqTris: 10000, liteTris: 6200, hqTex: 1024, liteTex: 512, yawFix: 0, lod: false },
  boom: { stem: "jy_lm_crane_jib", raw: "Starwish_Junkyard_LM03_B_Boom.glb", hqTris: 7000, liteTris: 2700, hqTex: 1024, liteTex: 512, yawFix: 0, lod: false },
  grab: { stem: "jy_lm_crane_claw", raw: "Starwish_Junkyard_LM03_C_Grab.glb", hqTris: 3000, liteTris: 1700, hqTex: 1024, liteTex: 512, yawFix: 0, lod: false },
  reactor: { stem: "jy_lm_reactor", raw: "Starwish_Junkyard_LM04.glb", hqTris: 24000, liteTris: 11000, hqTex: 2048, liteTex: 1024, yawFix: Math.PI / 2, lod: true },
} as const satisfies Record<string, LandmarkModel>;

export type ModelKey = keyof typeof MODELS;

/** 模型包圍盒（Babylon 座標、未縮放；由處理後的 HQ 模型量測） */
export const MODEL_BOUNDS: Record<ModelKey, { min: [number, number, number]; max: [number, number, number] }> = {
  colossus: { min: [-0.341, -0.287, -0.49], max: [0.34, 0.286, 0.49] },
  furnace: { min: [-0.433, -0.446, -0.49], max: [0.432, 0.446, 0.489] },
  tower: { min: [-0.193, -0.489, -0.184], max: [0.192, 0.49, 0.184] },
  boom: { min: [-0.181, -0.172, -0.49], max: [0.181, 0.172, 0.49] },
  grab: { min: [-0.433, -0.49, -0.456], max: [0.433, 0.49, 0.457] },
  reactor: { min: [-0.474, -0.43, -0.491], max: [0.473, 0.426, 0.491] },
};

export interface LandmarkPlacement {
  id: string;
  model: ModelKey;
  x: number;
  z: number;
  /** null＝地面高度 */
  y: number | null;
  /** 正面（+Z，套用 yawFix 後）在世界中的方向：0＝北（+Z），π＝南 */
  yaw: number;
  /** 公尺／模型單位（等比） */
  unit: number;
  /** 底面往地下多少公尺（自然接觸地面） */
  sink: number;
}

/**
 * 最終尺寸（寬×高×深，公尺）＝模型邊長 × unit（見 landmarkSize）。
 * - 巨像：unit 26.5 → 26.0 × 15.2 × 18.0（躺臥的整具機器人，比預定 30×13.5×18 略短、略高：模型本身比例，不拉伸）
 * - 熔爐：平台上 unit 10 → 9.8 × 8.9 × 8.7（含磚砌圓台）；工廠地面 unit 8.4 → 8.2 × 7.5 × 7.3（平台只有 16×14 m，且要讓出主路線）
 * - 反應爐：unit 21 → 20.6 × 18.0 × 19.9（模型是寬而矮的拱門造型；若拉到 26 m 高會寬達 30 m、壓進 Boss 戰鬥廣場，所以以高 18 m 為準）
 */
export const PLACEMENTS: readonly LandmarkPlacement[] = [
  // 倒臥在東側垃圾山腳：背部埋進垃圾山（地面由 3 m 升到 17 m），正面朝西北的主路線；
  // 底面高度取西側平地（約 3 m），所以任何地方都不會懸空；與主路線至少 9 m、與出生區 S10a 外緣約 4 m
  { id: "colossus", model: "colossus", x: 104, z: -50, y: 2.9, yaw: Math.atan2(92 - 104, -38 - -50), unit: 26.5, sink: 0 },
  // 爐口朝南、面向階梯與主路線
  // 熔爐平台（16×14 m）的西北角：讓出平台東南側的主路線（階梯上 → 平台觀景點 F2）
  { id: FURNACES[0]!.id, model: "furnace", x: -62.5, z: 92.4, y: FURNACES[0]!.y, yaw: Math.PI, unit: 10, sink: 0.05 },
  { id: FURNACES[1]!.id, model: "furnace", x: FURNACES[1]!.x, z: FURNACES[1]!.z, y: FURNACES[1]!.y, yaw: Math.PI, unit: 8.4, sink: 0.05 },
  // Boss 廣場北緣：中心北移 5.5 m（20.6 m 寬的基座才不會壓進戰鬥廣場），正面朝南
  { id: "reactor", model: "reactor", x: 22, z: 133.5, y: 20, yaw: Math.PI, unit: 21, sink: 0.3 },
];

/** 吊車：塔身 unit 決定整座比例；吊臂、抓斗依塔頂旋轉盤與吊臂底座的實測尺寸配對（見 craneRig.ts） */
export const CRANE_SPECS: readonly (CraneRigSpec & { x: number; z: number; y: number })[] = CRANES.map((c, i) => {
  const k = c.h / 22; // crane1＝1、crane2＝0.82、crane3＝0.73（沿用 6.9 的比例）
  return {
    id: c.id,
    x: c.x,
    z: c.z,
    y: c.y,
    towerUnit: 20.4 * k,
    boomUnit: 19 * k,
    grabUnit: 3.7 * k,
    seat: 0.12 * k,
    // 吊臂朝 +X 方向為中心來回（與 6.9 相同的作業範圍）
    swingCenter: -Math.PI / 2,
    swingAmp: c.swing,
    swingSpeed: c.speed,
    phase: c.phase,
    liftPeriod: [26, 31, 23][i] ?? 27,
    // 抓斗最低點離塔基地面 2 m＋groundClear；吊鉤掃過範圍內地面最高比塔基高 0.49 m（crane3）。
    // V3.1：留足玩家（1.25 m）＋擺動的空間：抓斗底在作業範圍內至少離地 2.5 m
    groundClear: [0.5, 0.5, 1.0][i] ?? 0.5,
  };
});

/** 高畫質：超過這個距離（公尺）改畫 Lite 模型 */
export const LANDMARK_LOD_DISTANCE = 70;

export function landmarkFile(m: LandmarkModel, lite: boolean): string {
  return `${m.stem}_${lite ? "lite" : "hq"}.glb`;
}

/** 套用 yawFix 後的模型尺寸（寬 x、高 y、深 z；公尺） */
export function landmarkSize(p: Pick<LandmarkPlacement, "model" | "unit">): { w: number; h: number; d: number } {
  const b = MODEL_BOUNDS[p.model];
  const ex = b.max[0] - b.min[0];
  const ey = b.max[1] - b.min[1];
  const ez = b.max[2] - b.min[2];
  const q = Math.abs(Math.sin(MODELS[p.model].yawFix)) > 0.5;
  return { w: (q ? ez : ex) * p.unit, h: ey * p.unit, d: (q ? ex : ez) * p.unit };
}

/**
 * 模型座標（Babylon、未縮放）→ 世界座標。與 JunkyardLandmarks 的節點階層相同：
 * place(位置、yaw) → fit(縮放 unit、底面中心對齊、下沉 sink) → yawFix → 模型
 */
export function modelToWorld(p: LandmarkPlacement, groundY: number, x: number, y: number, z: number): [number, number, number] {
  const b = MODEL_BOUNDS[p.model];
  const fx = MODELS[p.model].yawFix;
  const rx = x * Math.cos(fx) + z * Math.sin(fx);
  const rz = -x * Math.sin(fx) + z * Math.cos(fx);
  const cx0 = (b.min[0] + b.max[0]) / 2;
  const cz0 = (b.min[2] + b.max[2]) / 2;
  const ccx = cx0 * Math.cos(fx) + cz0 * Math.sin(fx);
  const ccz = -cx0 * Math.sin(fx) + cz0 * Math.cos(fx);
  const lx = (rx - ccx) * p.unit;
  const ly = (y - b.min[1]) * p.unit - p.sink;
  const lz = (rz - ccz) * p.unit;
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  return [p.x + lx * c + lz * s, (p.y ?? groundY) + ly, p.z - lx * s + lz * c];
}

/** 特效錨點（模型座標，Babylon、未縮放；實驗場景點選模型表面取得） */
export const ANCHORS = {
  colossus: {
    eyes: [
      [-0.03, 0.157, 0.143],
      [-0.039, 0.131, 0.083],
    ] as [number, number, number][],
    core: [-0.147, -0.104, 0.024] as [number, number, number],
  },
  furnace: {
    /** 爐口：框面 x≈−0.2；開口 y −0.33～−0.18、z −0.2～−0.02；內部很深（到 x≈0.08） */
    mouth: { face: -0.205, floor: -0.318, top: -0.18, z0: -0.2, z1: -0.022, back: 0.04 },
    /** 煙囪開口（中心與半徑） */
    chimneys: [
      { x: 0.001, y: 0.446, z: 0.001, r: 0.1 },
      { x: 0.291, y: 0.333, z: -0.209, r: 0.065 },
    ],
    /** 藍色排氣管（間歇蒸氣） */
    vent: { x: 0.166, y: 0.379, z: -0.114 },
  },
  reactor: {
    /** 中空核心艙：x −0.2～0.2、z −0.19～0.19、y −0.23～0.19 */
    core: [0, -0.02, 0] as [number, number, number],
    coreR: 0.05,
    ringR: [0.095, 0.12, 0.145],
    chamber: { x: 0.2, z: 0.19, y0: -0.23, y1: 0.19 },
  },
} as const;
