// 地圖連接資料層（V1.3，回村方案 A）：只是資料，沒有功能、沒有畫面。
// - 星芽村南方傳送門 → 星芽原野新手營地既有出生點 (−56, −64)
// - 星芽原野營地「星願石」（獨立附加層，不寫進原野核心場景）→ 星芽村南側抵達點 (0, −39)，面向北
// - 星芽原野遺跡後方傳送門：保留給未來 Lv11–20 地圖，維持未開放，不連到村莊、位置不動
// 這一階段（V1.3 Grey-box）不實作傳送、確認視窗、死亡復活或 UI；也不把星願石加進原野畫面。

import { ARRIVAL_SPOT, PORTALS } from "./layout.ts";

export type MapId = "village" | "starsprout";

export interface MapPoint {
  map: MapId;
  x: number;
  z: number;
  /** 抵達時面向（yaw，0＝+Z 北） */
  yaw: number;
}

export interface MapLink {
  id: string;
  name: string;
  from: { map: MapId; x: number; z: number; r: number };
  /** null＝未開放、沒有目的地 */
  to: MapPoint | null;
  open: boolean;
  /** 需要玩家主動互動並確認 */
  requiresConfirm: boolean;
}

/** 星芽原野營地星願石：既有出生點正後方 4 m，離營地物件 ≥3 m，不在主路線上 */
export const FIELD_RETURN_STONE = { x: -56, z: -68, discR: 1.5, pillarR: 0.5, interactR: 2.5 } as const;
/** 從村莊到原野的抵達點：營地既有出生點，面向東北營地大門 */
export const FIELD_CAMP_ARRIVAL: MapPoint = { map: "starsprout", x: -56, z: -64, yaw: Math.atan2(8, 9) };

const south = PORTALS[0]!;

export const MAP_LINKS: readonly MapLink[] = [
  {
    id: "village-south-portal",
    name: "星芽村南方傳送門 → 星芽原野",
    from: { map: "village", x: south.x, z: south.z, r: south.r },
    to: FIELD_CAMP_ARRIVAL,
    open: true,
    requiresConfirm: true,
  },
  ...PORTALS.filter((p) => !p.open).map(
    (p): MapLink => ({ id: `village-${p.id}-portal`, name: `星芽村${p.name}（未開放）`, from: { map: "village", x: p.x, z: p.z, r: p.r }, to: null, open: false, requiresConfirm: true }),
  ),
  {
    id: "field-return-stone",
    name: "星芽原野營地星願石 → 星芽村",
    from: { map: "starsprout", x: FIELD_RETURN_STONE.x, z: FIELD_RETURN_STONE.z, r: FIELD_RETURN_STONE.interactR },
    to: { map: "village", x: ARRIVAL_SPOT.x, z: ARRIVAL_SPOT.z, yaw: ARRIVAL_SPOT.yaw },
    open: true,
    requiresConfirm: true,
  },
  {
    id: "field-ruins-portal",
    name: "星芽原野遺跡後方傳送門（Lv11–20 預留，未開放）",
    from: { map: "starsprout", x: 0, z: 82, r: 5 },
    to: null,
    open: false,
    requiresConfirm: true,
  },
];

/** 新角色出生、死亡復活的預設地圖（座標見 layout.ts SPAWN_SLOTS／RESPAWN_SLOTS） */
export const DEFAULT_SPAWN_MAP: MapId = "village";
