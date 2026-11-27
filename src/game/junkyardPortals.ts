/**
 * Stage 6.8＋6.9：星芽原野 ↔ 星廢垃圾場 雙向傳送接口（與 Claude A 的 worldPortals.ts 相同格式：PortalSpec＋目的地）。
 * Claude B 只建立資料與接口；原野端的開放、外觀與世界模式切換由 Claude A 的世界整合分支決定（本分支不修改 A 的檔案）。
 *
 * - 原野北端傳送門（王冠遺跡 Boss 戰鬥場北側，starsprout layout PORTAL＝(0, 82)、Y 17；Stage 6 起保留給 Lv11～20 地圖）
 *   → 星廢垃圾場入口抵達點 (0, −124)，面向北
 * - 星廢垃圾場入口傳送陣 (0, −134) → 原野北端傳送門南側 7 m 的抵達點 (0, 75)，面向南（在觸發半徑外，不會立刻又被傳回去）
 * 規則與村莊南門相同：踩入自動傳送、沒有按鈕或確認視窗、只觸發一次；在陣內出生要先走出 armR 才啟用。
 */
import { FIELD_NORTH_ARRIVAL, FIELD_NORTH_PORTAL_PROPOSAL, JUNKYARD_ARRIVAL, JUNKYARD_ENTRY_PORTAL } from "../maps/junkyard/layout.ts";
import type { PortalSpec } from "./portalTrigger.ts";

export type MapArrival = { map: "junkyard" | "starsprout"; x: number; z: number; yaw: number };

/** 原野北端 → 垃圾場（open：由 A 決定開放時機；預設 false＝本分支不改變原野行為） */
export const FIELD_NORTH_PORTAL: PortalSpec & { visualR: number; to: MapArrival; label: string } = {
  id: FIELD_NORTH_PORTAL_PROPOSAL.id,
  x: FIELD_NORTH_PORTAL_PROPOSAL.x,
  z: FIELD_NORTH_PORTAL_PROPOSAL.z,
  visualR: 3,
  triggerR: FIELD_NORTH_PORTAL_PROPOSAL.triggerR,
  open: false,
  to: { map: "junkyard", x: JUNKYARD_ARRIVAL.x, z: JUNKYARD_ARRIVAL.z, yaw: JUNKYARD_ARRIVAL.yaw },
  label: "往 星廢垃圾場（Lv11–20）",
};

/** 垃圾場入口 → 原野北端 */
export const JUNKYARD_ENTRY: PortalSpec & { visualR: number; to: MapArrival; label: string } = {
  id: JUNKYARD_ENTRY_PORTAL.id,
  x: JUNKYARD_ENTRY_PORTAL.x,
  z: JUNKYARD_ENTRY_PORTAL.z,
  visualR: JUNKYARD_ENTRY_PORTAL.visualR,
  triggerR: JUNKYARD_ENTRY_PORTAL.triggerR,
  open: true,
  to: { map: "starsprout", x: FIELD_NORTH_ARRIVAL.x, z: FIELD_NORTH_ARRIVAL.z, yaw: FIELD_NORTH_ARRIVAL.yaw },
  label: "往 星芽原野（Lv1–10）",
};

/** 地圖連接總表：星芽村 ↔ 星芽原野 ↔ 星廢垃圾場（村莊與原野之間沿用 A 的 VILLAGE_SOUTH_PORTAL／FIELD_CAMP_PORTAL） */
export const JUNKYARD_LINKS = [FIELD_NORTH_PORTAL, JUNKYARD_ENTRY] as const;
