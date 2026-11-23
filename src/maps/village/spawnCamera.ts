import { TUNING } from "../../config/tuning.ts";
import { SPAWN_SLOTS } from "./layout.ts";

/**
 * Stage 6 P3-2E：星芽村「出生／復活點」的初始鏡頭構圖（只用在星芽村，不改全遊戲共用的 TUNING.camera）。
 *
 * 出生點都在噴泉周圍（r 12.5／15）且面向噴泉。遊戲預設俯角（beta 1.05）會把漂浮星晶（最高 6.46 m）切在畫面上緣外，
 * 所以這裡把「初始」俯角微抬到 1.32（仍在玩家可調範圍 0.55～1.38 內）；鏡頭距離不變（角色大小不變）。
 * 之後玩家拖曳調整俯角時，照一般鏡頭規則（keepPitch）保留玩家的選擇。
 */
export const VILLAGE_SPAWN_CAMERA = Object.freeze({ beta: 1.32, distance: TUNING.camera.distance });

/** 這個位置是不是星芽村的出生／復活點（容許 5 cm 誤差） */
export function isVillageSpawnSlot(x: number, z: number): boolean {
  return SPAWN_SLOTS.some((s) => Math.hypot(s.x - x, s.z - z) < 0.05);
}

/** 放置角色時的初始鏡頭：出生／復活點用微抬的構圖，其他位置維持遊戲預設 */
export function villageInitialCamera(x: number, z: number): { beta: number; distance: number } {
  return isVillageSpawnSlot(x, z) ? { beta: VILLAGE_SPAWN_CAMERA.beta, distance: VILLAGE_SPAWN_CAMERA.distance } : { beta: TUNING.camera.defaultBeta, distance: TUNING.camera.distance };
}
