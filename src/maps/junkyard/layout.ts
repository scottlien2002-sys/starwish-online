/**
 * Stage 6.8＋6.9 星廢垃圾場（Starfall Junkyard，Lv11～20）：地圖配置資料（純資料，不依賴 Babylon；之後伺服器可共用）。
 *
 * 座標：原點＝地圖中心；X 向東、Z 向北、Y 向上；單位公尺。地圖 300 × 300（±150），可行走範圍約 ±136。
 * 美術基準：使用者 2026-11-28 附上的「星廢垃圾場」概念圖（入口在南、廢棄山丘區在東、回收處理區在西、
 * 廢棄工廠區在西北、Boss 中樞熔煉爐在北；地形剖面：低地堆場 → 處理區平台 → 工廠高台 → Boss 中樞）。
 *
 * 高度分層（全部用坡道、橋、金屬階梯連接，一般移動即可抵達，不需要跳躍）：
 * - 低地（入口、中央窪地、廢棄山丘區）Y 0～6（山丘起伏）
 * - 回收處理區平台 Y 6（高架金屬橋 Y 10）
 * - 廢棄工廠高台 Y 14（金屬平台 Y 17.5）
 * - 核心熔煉場 Y 20
 */

export interface Vec2 {
  x: number;
  z: number;
}

export const MAP_HALF = 150;
/** 可行走的硬邊界（正方形 ±BOUND；外圍是垃圾山與懸崖，實際可走範圍由地形坡度決定） */
export const WALK_BOUND = 136;
/** 可行走最大坡度（度）：與星芽原野相同 */
export const MAX_WALK_SLOPE = 35;
export const WALK_SPEED = 5;
export const PLAYER_RADIUS = 0.3;

export type ZoneId = "entry" | "hills" | "recycle" | "factory" | "core";

export interface ZoneDef extends Vec2 {
  id: ZoneId;
  name: string;
  level: string;
  /** 區域大致半徑（分區載入、標示用） */
  r: number;
  /** 代表地面高度 */
  y: number;
  color: string;
}

export const ZONES: readonly ZoneDef[] = [
  { id: "entry", name: "入口（來自星芽原野）", level: "—", x: 0, z: -118, r: 22, y: 0, color: "#7fd6ff" },
  { id: "hills", name: "廢棄山丘區", level: "Lv11～14", x: 66, z: -58, r: 62, y: 2, color: "#e8b04a" },
  { id: "recycle", name: "回收處理區", level: "Lv14～17", x: -72, z: -16, r: 48, y: 6, color: "#59c08a" },
  { id: "factory", name: "廢棄工廠區", level: "Lv17～19", x: -56, z: 74, r: 46, y: 14, color: "#e0704a" },
  { id: "core", name: "核心熔煉場（Boss）", level: "Lv20", x: 22, z: 108, r: 40, y: 20, color: "#ff4a3a" },
];

export function zoneById(id: ZoneId): ZoneDef {
  return ZONES.find((z) => z.id === id)!;
}

// ---------------- 地形：高台（圓角矩形或圓形，四周是懸崖） ----------------
export interface PlateauDef {
  id: string;
  /** 中心 */
  x: number;
  z: number;
  /** 圓角矩形半寬／半深（圓形時 hx＝半徑、hz 不用） */
  hx: number;
  hz: number;
  /** 圓角半徑（矩形） */
  round: number;
  shape: "rect" | "circle";
  y: number;
  /** 懸崖寬度（高度從 y 過渡到地面的水平距離；越小越陡） */
  cliff: number;
}

export const PLATEAUS: readonly PlateauDef[] = [
  // 入口廣場（平整、緩邊）
  { id: "entry", x: 0, z: -120, hx: 17, hz: 17, round: 0, shape: "circle", y: 0, cliff: 9 },
  // 回收處理區平台：x −110～−34、z −52～16
  { id: "recycle", x: -72, z: -18, hx: 38, hz: 34, round: 10, shape: "rect", y: 6, cliff: 3.2 },
  // 廢棄工廠高台：x −98～−18、z 46～102
  { id: "factory", x: -58, z: 74, hx: 40, hz: 28, round: 9, shape: "rect", y: 14, cliff: 3.4 },
  // 核心熔煉場：圓形高台 r 36
  { id: "core", x: 22, z: 108, hx: 36, hz: 36, round: 0, shape: "circle", y: 20, cliff: 4 },
];

// ---------------- 坡道（覆蓋懸崖、地面可走的寬路） ----------------
export interface RampDef {
  id: string;
  a: Vec2 & { y: number };
  b: Vec2 & { y: number };
  /** 寬度（m） */
  w: number;
  /** 外觀：土石坡／金屬坡 */
  kind: "earth" | "metal";
}

export const RAMPS: readonly RampDef[] = [
  // 中央 → 回收處理區（東側入口坡道，長約 24 m，坡度約 14°）
  { id: "R1", a: { x: -14, z: -34, y: 0 }, b: { x: -37, z: -27, y: 6 }, w: 8, kind: "earth" },
  // 回收處理區南側小坡（從入口西側上平台；第二條路，避免單一路線擁擠）
  { id: "R2", a: { x: -52, z: -78, y: 0 }, b: { x: -60, z: -55, y: 6 }, w: 6.5, kind: "earth" },
  // 工廠高台 → 核心熔煉場（金屬坡道，長約 23 m，坡度約 15°）
  { id: "R3", a: { x: -26, z: 90, y: 14 }, b: { x: -4, z: 100, y: 20 }, w: 7, kind: "metal" },
];

// ---------------- 橋與金屬平台（行走面高於下方地面；橋邊緣是欄杆） ----------------
export interface DeckDef {
  id: string;
  /** 直線段：a → b，寬 w；高度沿線性內插 */
  a: Vec2 & { y: number };
  b: Vec2 & { y: number };
  w: number;
  kind: "bridge" | "stairs" | "platform" | "walkway";
  /** 是否有欄杆（兩側） */
  rails: boolean;
}

export const DECKS: readonly DeckDef[] = [
  // 回收處理區 → 廢棄工廠區：跨越魔法運河的大型金屬橋（長 33 m，Y 6 → 14，坡度約 13°）
  { id: "B1", a: { x: -60, z: 13, y: 6 }, b: { x: -60, z: 46, y: 14 }, w: 6, kind: "bridge", rails: true },
  // 回收處理區：西側高架金屬步道（Y 10，長 38 m）＋兩端金屬階梯（約 27°）
  { id: "S1", a: { x: -103, z: -46, y: 6 }, b: { x: -103, z: -38, y: 10 }, w: 4, kind: "stairs", rails: true },
  { id: "W1", a: { x: -103, z: -38, y: 10 }, b: { x: -103, z: 0, y: 10 }, w: 4, kind: "walkway", rails: true },
  { id: "S2", a: { x: -103, z: 0, y: 10 }, b: { x: -103, z: 8, y: 6 }, w: 4, kind: "stairs", rails: true },
  // 廢棄工廠區：熔爐上方的金屬平台（Y 17.5）＋階梯
  { id: "S3", a: { x: -60, z: 76, y: 14 }, b: { x: -60, z: 83, y: 17.5 }, w: 4.5, kind: "stairs", rails: true },
  { id: "P1", a: { x: -60, z: 83, y: 17.5 }, b: { x: -60, z: 97, y: 17.5 }, w: 16, kind: "platform", rails: true },
];

// ---------------- 低窪：魔法運河與中央水池（不可走；水面發藍光） ----------------
export interface BasinDef {
  id: string;
  /** 折線（運河）或圓（水池） */
  pts: readonly Vec2[];
  /** 半寬（運河）／半徑（水池） */
  r: number;
  /** 底部高度 */
  bottom: number;
  /** 水面高度 */
  water: number;
}

export const BASINS: readonly BasinDef[] = [
  // 回收處理區與工廠高台之間的運河（東西向；大橋 B1 跨越）
  { id: "canal", pts: [{ x: -132, z: 30 }, { x: -96, z: 32 }, { x: -60, z: 30 }, { x: -28, z: 34 }, { x: -8, z: 22 }, { x: 8, z: 18 }], r: 7, bottom: -3.2, water: -1.4 },
  // 中央窪地水池（概念圖中央的藍色水池）
  { id: "pond", pts: [{ x: 16, z: 18 }], r: 13, bottom: -3, water: -1.2 },
];

// ---------------- 山丘、垃圾山（高斯起伏） ----------------
export interface MoundDef extends Vec2 {
  /** 高度（m） */
  h: number;
  /** 寬度（高斯 σ，m） */
  s: number;
  /** 垃圾山（陡、不可走，外觀是堆積廢料）／緩丘（可走） */
  kind: "junk" | "hill";
}

export const MOUNDS: readonly MoundDef[] = [
  // ---- 廢棄山丘區的緩丘（可走） ----
  { x: 52, z: -88, h: 3, s: 16, kind: "hill" },
  { x: 86, z: -72, h: 4.5, s: 14, kind: "hill" },
  { x: 92, z: -30, h: 3.5, s: 16, kind: "hill" },
  { x: 58, z: -40, h: 2.2, s: 12, kind: "hill" },
  { x: 30, z: -60, h: 1.4, s: 10, kind: "hill" },
  // ---- 廢棄山丘區的垃圾山（不可走的地標，戰鬥區域之間的屏障） ----
  { x: 74, z: -100, h: 12, s: 6.5, kind: "junk" },
  { x: 108, z: -88, h: 16, s: 8, kind: "junk" },
  { x: 116, z: -50, h: 13, s: 7, kind: "junk" },
  { x: 72, z: -56, h: 9, s: 5.2, kind: "junk" },
  { x: 40, z: -18, h: 10, s: 6, kind: "junk" },
  { x: 100, z: 4, h: 14, s: 8, kind: "junk" },
  { x: 62, z: 14, h: 11, s: 7, kind: "junk" },
  // ---- 中央窪地周邊 ----
  { x: -18, z: -2, h: 8, s: 5.5, kind: "junk" },
  { x: 44, z: 40, h: 12, s: 7.5, kind: "junk" },
  { x: -16, z: -96, h: 9, s: 6, kind: "junk" },
  { x: 26, z: -100, h: 7, s: 5, kind: "junk" },
  // ---- 地圖外圍的大型垃圾山（邊界） ----
  { x: -140, z: -140, h: 34, s: 22, kind: "junk" },
  { x: -60, z: -150, h: 30, s: 20, kind: "junk" },
  { x: 40, z: -152, h: 30, s: 20, kind: "junk" },
  { x: 130, z: -136, h: 36, s: 22, kind: "junk" },
  { x: 152, z: -60, h: 34, s: 20, kind: "junk" },
  { x: 150, z: 30, h: 38, s: 22, kind: "junk" },
  { x: 120, z: 110, h: 36, s: 24, kind: "junk" },
  { x: 70, z: 152, h: 40, s: 22, kind: "junk" },
  { x: -30, z: 150, h: 36, s: 22, kind: "junk" },
  { x: -120, z: 140, h: 38, s: 24, kind: "junk" },
  { x: -152, z: 60, h: 34, s: 20, kind: "junk" },
  { x: -152, z: -40, h: 32, s: 20, kind: "junk" },
  { x: 84, z: 64, h: 22, s: 14, kind: "junk" },
];

// ---------------- 主路線（入口 → 四大區域 → Boss；自動巡迴與可達性測試用） ----------------
export interface RoutePoint extends Vec2 {
  id: string;
  label: string;
}

const rp = (id: string, label: string, x: number, z: number): RoutePoint => ({ id, label, x, z });

export const MAIN_ROUTE: readonly RoutePoint[] = [
  rp("E0", "入口抵達點", 0, -124),
  rp("E1", "入口廣場北側", 0, -106),
  rp("H0", "岔路口", 6, -82),
  rp("H1", "廢棄山丘：史萊姆窪地", 44, -86),
  rp("H2", "廢棄山丘：機兵廢料場", 82, -78),
  rp("H3", "廢棄山丘：獵犬丘陵", 88, -30),
  rp("H4", "機械巨像遺骸前", 100, -34),
  rp("H5", "山丘北路", 70, -20),
  rp("H6", "山丘西緣", 46, -38),
  rp("C0", "中央窪地", 20, -40),
  rp("C1", "回收區坡道下", -12, -36),
  rp("R0", "回收區坡道上", -40, -26),
  rp("R1", "回收處理：無人機回收場", -58, -26),
  rp("R2", "回收處理：吊車下", -74, -40),
  rp("R3", "高架步道階梯下", -100, -50),
  rp("R3b", "高架步道南階梯", -103, -48),
  rp("R4", "高架步道", -103, -18),
  rp("R5", "高架步道北階梯下", -103, 11),
  rp("R6", "回收處理：巨人廢鐵場", -78, 8),
  rp("R7", "大橋南端", -60, 8),
  rp("F0", "大橋北端", -60, 52),
  rp("F1", "廢棄工廠：熔爐廣場", -60, 70),
  rp("F1s", "平台階梯下", -60, 75),
  rp("F1t", "平台階梯上", -60, 84),
  rp("F2", "熔爐上方平台", -55, 88),
  rp("F2t", "平台階梯上（回程）", -60, 84),
  rp("F3", "平台階梯下（回程）", -60, 72),
  rp("F4", "廢棄工廠：鐮螂機庫", -76, 70),
  rp("F5", "工廠東側", -40, 74),
  rp("F6", "熔煉場坡道下", -30, 86),
  rp("K0", "熔煉場坡道上", -2, 101),
  rp("K1", "核心熔煉場：戰鬥廣場", 20, 104),
];

/** Boss 戰鬥廣場（完全平坦，可多人同時挑戰） */
export const ARENA = { x: 22, z: 104, r: 24, y: 20 } as const;
/** 中央魔法機械反應爐（戰鬥廣場北側，不可走） */
export const REACTOR = { x: 22, z: 128, r: 7.5, y: 20, h: 26 } as const;

// ---------------- 怪物出生區域與活動範圍（怪物模型由 Claude C 負責；這裡只預留） ----------------
export interface MonsterSpawnDef extends Vec2 {
  id: string;
  monster: string;
  name: string;
  level: [number, number];
  element: string;
  zone: ZoneId;
  /** 出生區半徑 */
  r: number;
  /** 活動（追擊）範圍半徑：離開這個範圍就回到出生區 */
  leash: number;
  /** 同時存在上限 */
  cap: number;
  /** Lv11 以上全部主動攻擊 */
  ai: "aggressive";
  /** 主動攻擊偵測半徑 */
  aggroR: number;
  boss?: boolean;
  elite?: boolean;
}

export const SPAWNS: readonly MonsterSpawnDef[] = [
  { id: "S08a", monster: "M008", name: "垃圾史萊姆", level: [11, 13], element: "地", zone: "hills", x: 44, z: -90, r: 14, leash: 24, cap: 8, ai: "aggressive", aggroR: 9 },
  { id: "S08b", monster: "M008", name: "垃圾史萊姆", level: [11, 13], element: "地", zone: "hills", x: 22, z: -70, r: 10, leash: 20, cap: 5, ai: "aggressive", aggroR: 9 },
  { id: "S09a", monster: "M009", name: "鐵罐機兵", level: [12, 14], element: "地", zone: "hills", x: 84, z: -78, r: 14, leash: 24, cap: 7, ai: "aggressive", aggroR: 10 },
  { id: "S10a", monster: "M010", name: "廢材獵犬", level: [13, 15], element: "地・毒", zone: "hills", x: 86, z: -32, r: 14, leash: 26, cap: 7, ai: "aggressive", aggroR: 12 },
  { id: "S10b", monster: "M010", name: "廢材獵犬", level: [13, 15], element: "地・毒", zone: "hills", x: 66, z: -16, r: 9, leash: 20, cap: 4, ai: "aggressive", aggroR: 12 },
  { id: "S11a", monster: "M011", name: "回收無人機", level: [14, 16], element: "雷", zone: "recycle", x: -58, z: -26, r: 12, leash: 24, cap: 9, ai: "aggressive", aggroR: 13 },
  { id: "S11b", monster: "M011", name: "回收無人機", level: [14, 16], element: "雷", zone: "recycle", x: -90, z: -8, r: 8, leash: 18, cap: 5, ai: "aggressive", aggroR: 13 },
  { id: "S12a", monster: "M012", name: "垃圾堆巨人", level: [16, 18], element: "地・毒", zone: "recycle", x: -72, z: 4, r: 10, leash: 20, cap: 4, ai: "aggressive", aggroR: 11 },
  { id: "S13a", monster: "M013", name: "廢鐵鐮螂", level: [17, 19], element: "地・鋼", zone: "factory", x: -76, z: 70, r: 10, leash: 20, cap: 6, ai: "aggressive", aggroR: 12, elite: true },
  { id: "S13b", monster: "M013", name: "廢鐵鐮螂", level: [17, 19], element: "地・鋼", zone: "factory", x: -38, z: 80, r: 9, leash: 18, cap: 4, ai: "aggressive", aggroR: 12, elite: true },
  { id: "S14", monster: "M014", name: "廢棄機甲王", level: [20, 20], element: "地・火", zone: "core", x: 22, z: 108, r: 4, leash: 23, cap: 1, ai: "aggressive", aggroR: 18, boss: true },
];

// ---------------- 地圖連接（星芽村 ↔ 星芽原野 ↔ 星廢垃圾場） ----------------
/** 垃圾場入口傳送陣（南端）：踩入 → 回星芽原野北端（王冠遺跡後方）傳送門外側 */
export const JUNKYARD_ENTRY_PORTAL = { id: "junkyard-entry", x: 0, z: -134, visualR: 3, triggerR: 2.4 } as const;
/** 從星芽原野抵達垃圾場的位置（入口傳送陣北側 10 m，面向北） */
export const JUNKYARD_ARRIVAL = { map: "junkyard", x: 0, z: -124, yaw: 0 } as const;
/**
 * 星芽原野北端傳送門（starsprout layout PORTAL＝(0, 82)、Y 17；Stage 6 P2 起保留給 Lv11～20 地圖、目前未開放）。
 * 這裡只記錄提案資料；原野端的開放與觸發由 Claude A 的世界整合分支決定（本分支不修改原野）。
 */
export const FIELD_NORTH_PORTAL_PROPOSAL = { id: "field-north", map: "starsprout", x: 0, z: 82, y: 17, triggerR: 2.4, to: JUNKYARD_ARRIVAL } as const;
/** 從垃圾場回到星芽原野時的抵達點：北端傳送門南側 7 m（王冠遺跡戰鬥場北緣與傳送門之間），面向南 */
export const FIELD_NORTH_ARRIVAL = { map: "starsprout", x: 0, z: 75, yaw: Math.PI } as const;

// ---------------- 動態物件位置（吊車、蒸氣口、熔爐…） ----------------
export interface CraneDef extends Vec2 {
  id: string;
  /** 底座高度 */
  y: number;
  /** 塔高 */
  h: number;
  /** 吊臂長度 */
  arm: number;
  /** 吊臂擺動範圍（弧度）與速度 */
  swing: number;
  speed: number;
  phase: number;
}

export const CRANES: readonly CraneDef[] = [
  { id: "crane1", x: -72, z: -47, y: 6, h: 22, arm: 16, swing: 1.1, speed: 0.11, phase: 0 },
  { id: "crane2", x: -44, z: -6, y: 6, h: 18, arm: 13, swing: 0.9, speed: 0.14, phase: 2.1 },
  { id: "crane3", x: 6, z: -60, y: 0, h: 16, arm: 12, swing: 1.4, speed: 0.09, phase: 4.2 },
];

export interface ConveyorDef {
  id: string;
  a: Vec2;
  b: Vec2;
  y: number;
  /** 架高（輸送帶頂面離地高度） */
  lift: number;
}

export const CONVEYORS: readonly ConveyorDef[] = [
  { id: "cv1", a: { x: -62, z: -44 }, b: { x: -40, z: -46 }, y: 6, lift: 1.5 },
  { id: "cv2", a: { x: -96, z: 13 }, b: { x: -80, z: 13.5 }, y: 6, lift: 1.2 },
  { id: "cv3", a: { x: -66, z: -9 }, b: { x: -47, z: 4 }, y: 6, lift: 1.4 },
];

export interface FactoryDef extends Vec2 {
  id: string;
  /** 半寬、半深、高 */
  hx: number;
  hz: number;
  h: number;
  y: number;
  /** 朝向（弧度） */
  rot: number;
  /** 破損程度 0..1（屋頂缺口） */
  broken: number;
}

export const FACTORIES: readonly FactoryDef[] = [
  { id: "fac1", x: -84, z: 90, hx: 11, hz: 9, h: 13, y: 14, rot: 0, broken: 0.35 },
  { id: "fac2", x: -32, z: 60, hx: 8, hz: 7, h: 10, y: 14, rot: 0.2, broken: 0.6 },
  { id: "fac3", x: -90, z: 54, hx: 7, hz: 8, h: 9, y: 14, rot: -0.1, broken: 0.2 },
  // 回收處理區的回收廠房
  { id: "rec1", x: -86, z: -30, hx: 6, hz: 7, h: 8, y: 6, rot: 0, broken: 0.1 },
];

/** 熔爐（橘紅光、火花）：工廠區 2 座 */
export const FURNACES: readonly (Vec2 & { id: string; y: number; r: number })[] = [
  { id: "furnace1", x: -60, z: 90, y: 17.5, r: 3.2 },
  { id: "furnace2", x: -70, z: 58, y: 14, r: 2.4 },
];

/** 蒸氣排放口 */
export const STEAM_VENTS: readonly (Vec2 & { id: string; y: number; zone: ZoneId })[] = [
  { id: "v1", x: -86, z: -30, y: 14.2, zone: "recycle" },
  { id: "v2", x: -50, z: -38, y: 6, zone: "recycle" },
  { id: "v3", x: -86, z: 96, y: 27.2, zone: "factory" },
  { id: "v4", x: -33, z: 62, y: 24.2, zone: "factory" },
  { id: "v5", x: 8, z: 128, y: 31, zone: "core" },
  { id: "v6", x: 36, z: 128, y: 31, zone: "core" },
];

/** 機械巨像遺骸（概念圖左側的半埋巨大機器人頭；不可走） */
export const COLOSSUS = { x: 108, z: -46, y: 0, r: 9, yaw: -2.3 } as const;

/** 魔法能源管線（發光，從反應爐延伸到各區）；實際高度＝max(y, 地面＋3.4 m)，頭頂以上、不擋路，支架另有碰撞 */
export const PIPES: readonly { id: string; pts: readonly (Vec2 & { y: number })[]; r: number }[] = [
  { id: "p1", pts: [{ x: 14, z: 122, y: 23 }, { x: -12, z: 110, y: 22 }, { x: -30, z: 96, y: 17 }], r: 0.55 },
  { id: "p2", pts: [{ x: -40, z: 50, y: 15.5 }, { x: -48, z: 26, y: 9 }, { x: -56, z: 4, y: 8.4 }], r: 0.45 },
  { id: "p3", pts: [{ x: -36, z: -46, y: 7.4 }, { x: -12, z: -52, y: 2.4 }, { x: 14, z: -62, y: 2.2 }], r: 0.4 },
  { id: "p4", pts: [{ x: 30, z: 124, y: 24 }, { x: 50, z: 114, y: 24 }, { x: 50, z: 96, y: 24 }], r: 0.55 },
];

/** 漂浮魔法水晶（緩慢上下；外觀用，不可走的小物件） */
export const CRYSTALS: readonly (Vec2 & { y: number; s: number; hue: "pink" | "violet" | "cyan" })[] = [
  { x: -12, z: -118, y: 1.2, s: 1.4, hue: "violet" },
  { x: 14, z: -114, y: 1.2, s: 1.1, hue: "pink" },
  { x: 60, z: -64, y: 1.4, s: 1.6, hue: "violet" },
  { x: 96, z: -56, y: 2.5, s: 1.3, hue: "pink" },
  { x: 24, z: 4, y: 1.2, s: 1.8, hue: "cyan" },
  { x: 2, z: 30, y: 1.2, s: 1.4, hue: "violet" },
  { x: -54, z: -6, y: 7.2, s: 1.2, hue: "cyan" },
  { x: -104, z: 40, y: 1.5, s: 1.5, hue: "violet" },
  { x: -44, z: 84, y: 15.2, s: 1.3, hue: "pink" },
  { x: 0, z: 118, y: 21.2, s: 1.7, hue: "violet" },
  { x: 44, z: 118, y: 21.2, s: 1.7, hue: "pink" },
  { x: 46, z: 92, y: 21.2, s: 1.2, hue: "cyan" },
];
