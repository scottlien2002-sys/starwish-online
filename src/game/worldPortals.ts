/**
 * Stage 7.1 雙向傳送陣（踩入自動傳送，沒有確認視窗）：
 * - 星芽村南方傳送陣 → 星芽原野新手營地（抵達點在營地傳送陣外側 4 m）
 * - 星芽原野營地傳送陣（原本星願石的位置，取代星願石）→ 星芽村南門內側（抵達點在南方傳送陣外側 5 m）
 * 觸發半徑比畫面上的魔法陣小，要踩進陣裡才會傳送；抵達點都在觸發半徑外。
 */
import { ARRIVAL_SPOT, PORTALS } from "../maps/village/layout.ts";
import { FIELD_CAMP_ARRIVAL, FIELD_RETURN_STONE } from "../maps/village/mapLinks.ts";
import type { PortalSpec } from "./portalTrigger.ts";

const south = PORTALS.find((p) => p.id === "south")!;

export const VILLAGE_SOUTH_PORTAL: PortalSpec & { to: typeof FIELD_CAMP_ARRIVAL } = {
  id: "village-south",
  x: south.x,
  z: south.z,
  triggerR: 2.6,
  open: south.open && !!south.destination,
  to: FIELD_CAMP_ARRIVAL,
};

/** 原野營地傳送陣：畫面半徑 2.3 m（村莊南門魔法陣的 0.72 倍，避開營地物件與道路） */
export const FIELD_CAMP_PORTAL: PortalSpec & { visualR: number; to: { map: "village"; x: number; z: number; yaw: number } } = {
  id: "field-camp",
  x: FIELD_RETURN_STONE.x,
  z: FIELD_RETURN_STONE.z,
  visualR: 2.3,
  triggerR: 1.6,
  open: true,
  to: { map: "village", x: ARRIVAL_SPOT.x, z: ARRIVAL_SPOT.z, yaw: ARRIVAL_SPOT.yaw },
};
