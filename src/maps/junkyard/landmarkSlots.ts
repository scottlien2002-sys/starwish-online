/**
 * 星廢垃圾場 V3：大型地標 GLB 資產槽（純資料；規格見專案文件 Starwish_Junkyard_V3_Landmark_Asset_Spec）。
 *
 * 美術流程：ChatGPT 設定圖 → 使用者用 Tripo 生成靜態 GLB → Claude B 減面／壓貼圖 → public/models/junkyard/。
 * 遊戲端負責：擺放、縮放到規格尺寸、朝向、碰撞（沿用 terrain.ts 的碰撞，不從模型產生）、
 *   活動零件（吊車旋轉、抓斗升降、反應爐旋轉環）、發光、火焰、煙霧、粒子。
 *
 * 座標慣例（glTF）：+Y 向上、模型正面朝 +Z、單位公尺。Tripo 輸出的大小與原點不一定正確，
 * 載入時會依 size／fit／origin 自動縮放與置中，所以模型只要「造型比例」正確即可。
 * 若模型正面方向錯誤，調整 yawFix（弧度）即可，不必重新生成。
 */
import { COLOSSUS, CRANES, FURNACES, REACTOR } from "./layout.ts";

export interface LandmarkPart {
  /** 零件代號（同一地標內唯一） */
  key: string;
  /** 檔名主幹：實際檔名 <stem>_hq.glb／<stem>_lite.glb */
  stem: string;
  /** 規格尺寸（公尺）：寬（X）、高（Y）、深（Z），以模型正面朝 +Z 時量測 */
  size: { w: number; h: number; d: number };
  /** 依哪個尺寸等比縮放：height＝高度、max＝最大邊 */
  fit: "height" | "max";
  /** 原點：bottom＝包圍盒底面中心、top＝頂面中心（吊鉤）、pivot＝底面中心（旋轉軸） */
  origin: "bottom" | "top";
  /** 底面低於原點多少公尺（埋入地面，避免浮空） */
  sink: number;
  /** 模型正面不是 +Z 時的修正（弧度） */
  yawFix: number;
  /** 原點不在前後中心時：原點到模型最後端（−Z）的距離（規格公尺）；例：吊臂的旋轉軸 */
  zFromBack?: number;
  /** 三角面預算 */
  hqTris: number;
  liteTris: number;
  /** 貼圖（底色）最大解析度；法線貼圖只有 HQ，最大 1024 */
  hqTex: number;
  liteTex: number;
}

export interface LandmarkPlacement {
  id: string;
  /** 世界座標；y＝null 表示用地面高度 */
  x: number;
  z: number;
  y: number | null;
  /** 正面（+Z）在世界中的方向：0＝朝 +Z（北），π/2＝朝 +X（東） */
  yaw: number;
  /** 相對規格尺寸的縮放 */
  scale: number;
}

export interface LandmarkSlot {
  id: "colossus" | "furnace" | "crane" | "reactor";
  name: string;
  parts: LandmarkPart[];
  placements: LandmarkPlacement[];
  /** 遊戲端碰撞（已在 terrain.ts；這裡只列出供報告與測試對照） */
  colliders: string;
  /** 遊戲端特效 */
  effects: string[];
}

const p = (key: string, stem: string, size: LandmarkPart["size"], o: Partial<LandmarkPart> & Pick<LandmarkPart, "hqTris" | "liteTris" | "hqTex" | "liteTex">): LandmarkPart => ({
  key,
  stem,
  size,
  fit: "height",
  origin: "bottom",
  sink: 0,
  yawFix: 0,
  ...o,
});

/** GLB 巨像的臉朝向主路線「機械巨像遺骸前」(100, −34)：玩家沿路線走來時正面看到它 */
const COLOSSUS_FACE = Math.atan2(100 - COLOSSUS.x, -34 - COLOSSUS.z);

export const LANDMARK_SLOTS: readonly LandmarkSlot[] = [
  {
    id: "colossus",
    name: "廢棄機械巨像",
    parts: [p("main", "jy_lm_colossus", { w: 30, h: 13.5, d: 18 }, { fit: "max", sink: 1.5, hqTris: 20000, liteTris: 6500, hqTex: 2048, liteTex: 1024 })],
    placements: [{ id: "colossus", x: COLOSSUS.x, z: COLOSSUS.z, y: null, yaw: COLOSSUS_FACE, scale: 1 }],
    colliders: "頭部圓 r 9（中心）＋手臂圓 r 3.2",
    effects: ["雙眼橘光脈動（偶爾閃爍）", "頸部裂縫冒蒸氣", "偶發火花"],
  },
  {
    id: "furnace",
    name: "廢鐵熔爐",
    parts: [p("main", "jy_lm_furnace", { w: 8, h: 10, d: 8 }, { sink: 0.2, hqTris: 8000, liteTris: 2600, hqTex: 1024, liteTex: 512 })],
    // 程序化熔爐的爐口朝本地 −Z（世界朝南）→ GLB 正面 +Z 轉半圈
    placements: FURNACES.map((f) => ({ id: f.id, x: f.x, z: f.z, y: f.y, yaw: Math.PI, scale: f.r / 3.2 })),
    colliders: "圓 r＝3.2（furnace1）／2.4（furnace2）",
    effects: ["爐口與頂部熔池橘光脈動", "火星粒子（既有）", "煙囪灰煙", "熱浪閃爍（高畫質）"],
  },
  {
    id: "crane",
    name: "廢料回收吊車",
    parts: [
      p("tower", "jy_lm_crane_tower", { w: 4.4, h: 23, d: 4.4 }, { hqTris: 4000, liteTris: 1300, hqTex: 1024, liteTex: 512 }),
      // 吊臂：原點＝旋轉軸（駕駛室底部中心），吊臂朝 +Z（軸前 16.5 m）、配重朝 −Z（軸後 7.5 m）；遊戲端轉 90° 對齊程式的 +X 吊臂
      p("jib", "jy_lm_crane_jib", { w: 3.4, h: 4.2, d: 24 }, { fit: "max", zFromBack: 7.5, hqTris: 4500, liteTris: 1500, hqTex: 1024, liteTex: 512 }),
      // 抓斗：原點＝頂部吊索掛點
      p("claw", "jy_lm_crane_claw", { w: 2.6, h: 3.2, d: 2.6 }, { origin: "top", hqTris: 1500, liteTris: 500, hqTex: 512, liteTex: 256 }),
    ],
    placements: CRANES.map((c) => ({ id: c.id, x: c.x, z: c.z, y: c.y, yaw: 0, scale: c.h / 22 })),
    colliders: "塔基圓 r 2.4（吊臂、抓斗在頭頂高度，不擋路）",
    effects: ["吊臂緩慢來回旋轉（既有）", "抓斗升降（既有）", "塔頂警示燈閃爍", "駕駛室窗戶青色微光"],
  },
  {
    id: "reactor",
    name: "魔導核心反應爐",
    parts: [p("shell", "jy_lm_reactor", { w: 17, h: 26, d: 17 }, { sink: 0.2, hqTris: 22000, liteTris: 7000, hqTex: 2048, liteTex: 1024 })],
    // 反應爐北側背對地圖邊緣；正面（主要觀景面）朝南、面向戰鬥廣場
    placements: [{ id: "reactor", x: REACTOR.x, z: REACTOR.z, y: REACTOR.y, yaw: Math.PI, scale: 1 }],
    colliders: "圓 r 7.5（兩側排氣塔另有 r 1.8）",
    effects: ["中央發光核心脈動（遊戲端，放在模型中空的核心艙）", "三道旋轉能量環（遊戲端）", "青色能量粒子上升", "排氣塔蒸氣（既有）"],
  },
];

/** 高畫質：超過這個距離（公尺）改畫 Lite 模型（有 Lite 檔時） */
export const LANDMARK_LOD_DISTANCE = 70;

/** 依目前畫質的檔名 */
export function landmarkFile(part: LandmarkPart, lite: boolean): string {
  return `${part.stem}_${lite ? "lite" : "hq"}.glb`;
}

/**
 * 依包圍盒算出縮放與位移（純數學，方便測試）。
 * @param min,max 模型原始包圍盒（已套用 yawFix 後的座標）
 * @returns 等比縮放 s，以及要加在「縮放後模型」上的位移，使原點落在規格位置
 */
export function fitTransform(part: LandmarkPart, min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }): { s: number; tx: number; ty: number; tz: number } {
  const w = max.x - min.x;
  const h = max.y - min.y;
  const d = max.z - min.z;
  const s = part.fit === "height" ? part.size.h / Math.max(1e-6, h) : Math.max(part.size.w, part.size.h, part.size.d) / Math.max(1e-6, w, h, d);
  const cx = ((min.x + max.x) / 2) * s;
  const cz = part.zFromBack !== undefined ? min.z * s + part.zFromBack : ((min.z + max.z) / 2) * s;
  const ty = part.origin === "top" ? -max.y * s : -min.y * s - part.sink;
  return { s, tx: -cx, ty, tz: -cz };
}
