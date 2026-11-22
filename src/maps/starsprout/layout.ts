/**
 * Stage 6 星芽原野：地圖配置資料（純資料，不依賴 Babylon；之後伺服器可共用）。
 *
 * 座標：原點＝地圖中心；X 向東、Z 向北、Y 向上；單位公尺。地圖 180 × 180（±90），可行走 ±82。
 * 依據：使用者確認的 Stage6_P1_Layout_V1_1（2026-11-22）。
 *
 * 與 V1.1 文件的差異（第一階段製作時的工程調整，報告中列出）：
 * - B1／B2 橋改為與溪流垂直，橋兩端各加一個路線點（橋長 14／12 公尺）
 * - 王冠遺跡：戰鬥場中心 (0, 66)、平地直徑 24 公尺、高度 Y 17（V1.1 為 18）；入口拱門 (0, 54)
 *   （V1.1 的石階下 P12 (0,48) 只離戰鬥場邊緣 2 公尺，無法爬 5 公尺；改為 (0,42) 起登、(0,44) 小平台，石階約 22°）
 * - B1 北端多一個「北岸」點：橋下來先往北 5 公尺再轉東，避免道路貼著河岸
 * - 怪物名稱、等級、上限、無屬性不變；本階段不放怪物，只標示棲息區
 */

export interface Vec2 {
  x: number;
  z: number;
}

export interface RoutePoint extends Vec2 {
  id: string;
  label: string;
  /** 路面高度 */
  y: number;
}

export interface ZoneDef extends Vec2 {
  id: string;
  name: string;
  /** 半徑（公尺） */
  r: number;
  /** 地面高度（中心附近壓平到這個高度） */
  y: number;
  /** 壓平程度 0..1（花丘保留起伏） */
  flatten: number;
  monster: string | null;
  level: string | null;
  cap: number;
  /** 標示顏色（#rrggbb） */
  color: string;
}

export interface BridgeDef {
  id: string;
  label: string;
  /** 橋中心 */
  cx: number;
  cz: number;
  /** 橋軸方向（單位向量，與溪流垂直） */
  ux: number;
  uz: number;
  /** 橋面總長、寬 */
  length: number;
  width: number;
}

export interface SidePath {
  id: string;
  label: string;
  points: RoutePoint[];
}

export interface RiverPoint extends Vec2 {
  /** 水面高度 */
  water: number;
}

export interface HeightAnchor extends Vec2 {
  y: number;
  /** 影響範圍（高斯半徑，公尺） */
  s: number;
}

export const MAP_HALF = 90;
export const WALK_HALF = 82;

/** 玩家移動速度（與 TUNING.player.moveSpeed 相同，路線時間估算用） */
export const WALK_SPEED = 5;

// ---------- 橋（與溪流垂直） ----------
const bridgeAxis = (rx: number, rz: number): { ux: number; uz: number } => {
  const l = Math.hypot(rx, rz);
  // 溪流方向 (rx, rz) 的垂直方向，取指向北方的那一個
  let ux = -rz / l;
  let uz = rx / l;
  if (uz < 0) {
    ux = -ux;
    uz = -uz;
  }
  return { ux, uz };
};
const B1A = bridgeAxis(18, -11); // 溪流在 B1 附近由 (-40,10) 流向 (-4,-14)
const B2A = bridgeAxis(22, -16); // 溪流在 B2 附近由 (-62,26) 流向 (-40,10)

export const BRIDGES: readonly BridgeDef[] = [
  { id: "B1", label: "B1 主木橋", cx: -22, cz: -1, ...B1A, length: 14, width: 3.6 },
  { id: "B2", label: "B2 水車小橋", cx: -58, cz: 23, ...B2A, length: 12, width: 2.6 },
];

const along = (b: BridgeDef, d: number): Vec2 => ({ x: b.cx + b.ux * d, z: b.cz + b.uz * d });
const r2 = (v: number): number => Math.round(v * 100) / 100;
const pt = (id: string, label: string, p: Vec2, y: number): RoutePoint => ({ id, label, x: r2(p.x), z: r2(p.z), y });

const B1 = BRIDGES[0]!;
const B2 = BRIDGES[1]!;

// ---------- 主路線：營地 → 7 個練功區 → 王冠遺跡 → 傳送門 ----------
export const MAIN_ROUTE: readonly RoutePoint[] = [
  pt("S", "出生點", { x: -56, z: -64 }, 2),
  pt("P1", "營地門", { x: -48, z: -55 }, 2),
  pt("P2", "星露草坪旁", { x: -38, z: -42 }, 2.5),
  pt("P3", "苔葉林緣旁", { x: -46, z: -26 }, 4),
  pt("P4", "橋前", along(B1, -14), 5.4),
  pt("P5a", "B1 橋南端", along(B1, -B1.length / 2), 6.2),
  pt("P5b", "B1 橋北端", along(B1, B1.length / 2), 6.6),
  pt("P5c", "北岸", along(B1, 13), 6.8),
  pt("P6", "微風花丘旁", { x: 2, z: -2 }, 7),
  pt("P7", "高地坡底", { x: 24, z: 4 }, 9),
  pt("P8", "羽風高地旁", { x: 36, z: 16 }, 13),
  pt("P9", "中台地", { x: 8, z: 20 }, 10),
  pt("P10", "星雲花田旁", { x: -30, z: 30 }, 11),
  pt("P11", "胡蘿蔔園北門", { x: -14, z: 44 }, 10.5),
  pt("P12", "遺跡石階下", { x: 0, z: 42 }, 13),
  pt("P12a", "石階平台", { x: 0, z: 44 }, 13),
  pt("P12b", "遺跡入口拱門", { x: 0, z: 54 }, 17),
  pt("P13", "Boss 場中心", { x: 0, z: 66 }, 17),
  pt("P14", "傳送門", { x: 0, z: 82 }, 17),
];

/** 路面半寬（主路石板路 3.5 公尺寬；支線泥土路 2 公尺寬） */
export const MAIN_ROAD_HALF = 1.75;
export const SIDE_ROAD_HALF = 1.0;

export const SIDE_PATHS: readonly SidePath[] = [
  {
    id: "west",
    label: "西側環線（林緣 → B2 → 花田）",
    points: [
      pt("w0", "", { x: -46, z: -26 }, 4),
      pt("w1", "", { x: -56, z: -10 }, 5.2),
      pt("w2", "", along(B2, -8), 6.9),
      pt("w3", "B2 橋南端", along(B2, -B2.length / 2), 7.3),
      pt("w4", "B2 橋北端", along(B2, B2.length / 2), 7.6),
      pt("w5", "", { x: -52, z: 36 }, 10.2),
      pt("w6", "", { x: -44, z: 42 }, 11.5),
    ],
  },
  {
    id: "south",
    label: "南側花海",
    points: [pt("s0", "", { x: -38, z: -42 }, 2.5), pt("s1", "", { x: -22, z: -62 }, 2.3), pt("s2", "", { x: -6, z: -72 }, 2.2)],
  },
  {
    id: "mushroom",
    label: "蘑菇林",
    points: [pt("m0", "", { x: -58, z: -38 }, 4.3), pt("m1", "", { x: -78, z: -44 }, 4)],
  },
  {
    id: "lookout",
    label: "遺跡觀景台",
    points: [pt("l0", "", { x: 11, z: 66 }, 17), pt("l1", "", { x: 24, z: 72 }, 17)],
  },
  {
    id: "falls",
    label: "瀑布潭",
    points: [pt("f0", "", { x: 36, z: 16 }, 13), pt("f1", "", { x: 54, z: 2 }, 11), pt("f2", "", { x: 52, z: -20 }, 6), pt("f3", "", { x: 45, z: -38 }, 2)],
  },
];

// ---------- 練功區（怪物資料只做標示，正式數值以怪物設定檔為準） ----------
export const ZONES: readonly ZoneDef[] = [
  { id: "camp", name: "新手營地", x: -56, z: -64, r: 11, y: 2, flatten: 0.95, monster: null, level: null, cap: 0, color: "#f2c96b" },
  { id: "01", name: "星露草坪", x: -24, z: -52, r: 12, y: 2.5, flatten: 0.8, monster: "星露啵啵", level: "1～2", cap: 6, color: "#7fc8f8" },
  { id: "02", name: "苔葉林緣", x: -62, z: -30, r: 13, y: 4.5, flatten: 0.75, monster: "苔角獸", level: "3～4", cap: 5, color: "#6aa84f" },
  { id: "03", name: "微風花丘", x: 14, z: -12, r: 10, y: 7.2, flatten: 0.5, monster: "雲絨鳥", level: "5～6", cap: 5, color: "#e58fb4" },
  { id: "04", name: "羽風高地", x: 52, z: 24, r: 11, y: 13, flatten: 0.9, monster: "風羽狐", level: "7", cap: 4, color: "#5b8fd8" },
  { id: "05", name: "星雲花田", x: -44, z: 46, r: 12, y: 11.5, flatten: 0.8, monster: "星雲咩咩", level: "8", cap: 4, color: "#a07ad0" },
  { id: "06", name: "胡蘿蔔園", x: -12, z: 34.5, r: 7.5, y: 10.4, flatten: 0.9, monster: "胡蘿蔔大王", level: "9", cap: 2, color: "#f08c2e" },
  { id: "07", name: "王冠遺跡", x: 0, z: 66, r: 12, y: 17, flatten: 1, monster: "王冠重錘兔（Boss）", level: "10", cap: 1, color: "#c0392b" },
];

/** Boss 戰鬥場（完全平坦）與傳送門平台 */
export const ARENA = { x: 0, z: 66, r: 12, y: 17 } as const;
export const PORTAL = { x: 0, z: 82, r: 5, y: 17, facing: Math.PI } as const;

// ---------- 溪流（西北 → 東南） ----------
export const RIVER: readonly RiverPoint[] = [
  { x: -96, z: 42, water: 7 },
  { x: -62, z: 26, water: 6 },
  { x: -40, z: 10, water: 5.2 },
  { x: -22, z: -1, water: 4.5 },
  { x: -4, z: -14, water: 4.2 },
  { x: 14, z: -28, water: 4 },
  { x: 27, z: -37.2, water: 3.9 },
  // 瀑布：約 3.7 公尺內落下 3.3 公尺
  { x: 30, z: -39.4, water: 0.6 },
  { x: 50, z: -52, water: 0.5 },
  { x: 96, z: -72, water: 0.3 },
];
export const RIVER_HALF = 3.5;
export const WATERFALL = { top: 6, bottom: 7 } as const; // RIVER 索引

/** 探索點（無怪物） */
export const POIS: readonly (Vec2 & { id: string; name: string })[] = [
  { id: "flowers", name: "南側花海", x: -6, z: -72 },
  { id: "mushroom", name: "蘑菇林", x: -78, z: -44 },
  { id: "lookout", name: "遺跡觀景台", x: 24, z: 72 },
  { id: "pool", name: "瀑布潭", x: 45, z: -38 },
];

// ---------- 地形高度控制點（高斯加權平均） ----------
export const BACKGROUND_HEIGHT = 4;
export const HEIGHT_ANCHORS: readonly HeightAnchor[] = [
  // 營地、草坪、林緣（南岸低地）
  { x: -56, z: -64, y: 2, s: 12 },
  { x: -24, z: -52, y: 2.5, s: 13 },
  { x: -38, z: -42, y: 2.5, s: 9 },
  { x: -62, z: -30, y: 4.5, s: 12 },
  { x: -46, z: -26, y: 4, s: 9 },
  { x: -6, z: -72, y: 2.2, s: 12 },
  { x: -78, z: -44, y: 4, s: 12 },
  { x: -40, z: -76, y: 2.5, s: 12 },
  { x: -76, z: -70, y: 3, s: 12 },
  { x: -30, z: -14, y: 5.4, s: 9 },
  { x: -10, z: -36, y: 3.5, s: 12 },
  { x: 12, z: -52, y: 2.5, s: 12 },
  // 西側
  { x: -80, z: -6, y: 6, s: 14 },
  { x: -56, z: -10, y: 5.2, s: 9 },
  // 北岸：花丘、高地、中台地
  { x: -16, z: 8, y: 6.8, s: 10 },
  { x: 2, z: -2, y: 7, s: 9 },
  { x: 14, z: -12, y: 7.2, s: 10 },
  { x: 24, z: 4, y: 9, s: 8 },
  { x: 52, z: 24, y: 13, s: 12 },
  { x: 62, z: 12, y: 13, s: 8 },
  { x: 46, z: 34, y: 13, s: 8 },
  { x: 64, z: 32, y: 13, s: 8 },
  { x: 36, z: 16, y: 13, s: 6 },
  { x: 8, z: 20, y: 10, s: 9 },
  { x: 24, z: 34, y: 12, s: 10 },
  { x: 76, z: -4, y: 9, s: 14 },
  // 東北：遺跡高台與羽風高地之間的緩坡山地
  { x: 46, z: 52, y: 14.5, s: 12 },
  { x: 68, z: 58, y: 15, s: 12 },
  { x: 28, z: 52, y: 15.5, s: 8 },
  { x: 74, z: 32, y: 12, s: 10 },
  // 花田、胡蘿蔔園
  { x: -30, z: 30, y: 11, s: 8 },
  { x: -44, z: 46, y: 11.5, s: 12 },
  { x: -58, z: 40, y: 11.5, s: 8 },
  { x: -36, z: 58, y: 12, s: 9 },
  { x: -12, z: 34.5, y: 10.4, s: 8 },
  { x: -14, z: 44, y: 10.5, s: 6 },
  { x: -52, z: 30, y: 9.5, s: 6 },
  { x: -72, z: 62, y: 14, s: 14 },
  // 王冠遺跡高台與北方山壁
  { x: 0, z: 66, y: 17, s: 12 },
  { x: 0, z: 82, y: 17, s: 8 },
  { x: -14, z: 74, y: 17, s: 7 },
  { x: 16, z: 74, y: 17, s: 7 },
  { x: 0, z: 42, y: 13, s: 5 },
  { x: 0, z: 98, y: 22, s: 10 },
  { x: -28, z: 84, y: 16, s: 12 },
  { x: 32, z: 84, y: 16, s: 12 },
  // 東南谷地（瀑布下方）
  { x: 40, z: -50, y: 1.2, s: 12 },
  { x: 62, z: -62, y: 0.9, s: 14 },
  { x: 36, z: -66, y: 1.2, s: 12 },
  { x: 72, z: -36, y: 2.5, s: 12 },
  { x: 45, z: -38, y: 2, s: 6 },
  { x: 52, z: -20, y: 6, s: 7 },
  { x: 54, z: 2, y: 11, s: 7 },
];

/**
 * 七種怪物的建模參考尺寸（使用者 2026-11-22 確認；以星露啵啵 V3.8R 已驗收模型實測 1.10 公尺為基準）。
 * 只是尺寸參考：外觀一律以七張正式設定圖為準，不可自行修改；本階段不放怪物模型。
 */
export const MONSTER_SIZES: readonly { name: string; heightM: number; ratio: number }[] = [
  { name: "星露啵啵", heightM: 1.1, ratio: 1 },
  { name: "苔角獸", heightM: 1.2, ratio: 1.09 },
  { name: "雲絨鳥", heightM: 1.0, ratio: 0.91 },
  { name: "風羽狐", heightM: 1.1, ratio: 1 },
  { name: "星雲咩咩", heightM: 1.15, ratio: 1.05 },
  { name: "胡蘿蔔大王", heightM: 1.65, ratio: 1.5 },
  { name: "王冠重錘兔", heightM: 2.7, ratio: 2.45 },
];
