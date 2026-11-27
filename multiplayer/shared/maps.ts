/**
 * 地圖權威資料（伺服器與客戶端預測共用）。
 * 全部「唯讀引用」Stage 7.1 已驗收的純邏輯模組：地形、碰撞、出生點、傳送陣。不複製、不修改任何地圖數值。
 *   星芽村：layout.ts 的 moveVillage / standable / RESPAWN_SLOTS
 *   星芽原野：terrain.ts 的 StarsproutTerrain / resolveMove，碰撞＝MAP_COLLIDERS＋道具＋植被（HQ 與 Lite 碰撞完全相同，已檢查）
 *   傳送陣：worldPortals.ts（村莊南門 ↔ 原野營地）
 */
import { moveVillage, standable, RESPAWN_SLOTS, groundHeight } from "../../src/maps/village/layout.ts";
import { StarsproutTerrain, resolveMove, pushOutOfColliders, type Collider } from "../../src/maps/starsprout/terrain.ts";
import { MAP_COLLIDERS, PLAYER_RADIUS } from "../../src/maps/starsprout/route.ts";
import { propColliders, propExclusions } from "../../src/maps/starsprout/props.ts";
import { buildVegetation, VEG_HQ } from "../../src/maps/starsprout/vegetation.ts";
import { VILLAGE_SOUTH_PORTAL, FIELD_CAMP_PORTAL } from "../../src/game/worldPortals.ts";
import type { MapId } from "./protocol.ts";

export interface SpawnPoint {
  x: number;
  z: number;
  yaw: number;
}

export interface PortalRule {
  id: string;
  x: number;
  z: number;
  triggerR: number;
  /** 抵達後要先離開這個半徑才會再觸發（防止無限往返） */
  armR: number;
  to: { map: MapId; x: number; z: number; yaw: number };
}

export interface MapAuthority {
  readonly id: MapId;
  /** 一步移動的碰撞解算（與單機版同一個函式） */
  resolve(x0: number, z0: number, x1: number, z1: number): { x: number; z: number };
  /** 是否為合法站立位置（伺服器稽核用） */
  legal(x: number, z: number): boolean;
  ground(x: number, z: number): number;
  spawn(i: number): SpawnPoint;
  readonly portals: readonly PortalRule[];
}

function villageAuthority(): MapAuthority {
  const p = VILLAGE_SOUTH_PORTAL;
  return {
    id: "village",
    resolve: (x0, z0, x1, z1) => moveVillage(x0, z0, x1, z1),
    legal: (x, z) => standable(x, z),
    ground: (x, z) => groundHeight(x, z),
    spawn: (i) => {
      const s = RESPAWN_SLOTS[((i % RESPAWN_SLOTS.length) + RESPAWN_SLOTS.length) % RESPAWN_SLOTS.length]!;
      return { x: s.x, z: s.z, yaw: s.yaw };
    },
    portals: p.open ? [{ id: p.id, x: p.x, z: p.z, triggerR: p.triggerR, armR: p.triggerR + 1, to: { map: p.to.map, x: p.to.x, z: p.to.z, yaw: p.to.yaw } }] : [],
  };
}

function starsproutAuthority(): MapAuthority {
  const terrain = new StarsproutTerrain();
  const veg = buildVegetation(terrain, VEG_HQ, undefined, propExclusions());
  const colliders: Collider[] = [...MAP_COLLIDERS, ...propColliders(), ...veg.colliders];
  const p = FIELD_CAMP_PORTAL;
  const insideCollider = (x: number, z: number): boolean => {
    const q = pushOutOfColliders(x, z, PLAYER_RADIUS * 0.9, colliders);
    return Math.hypot(q.x - x, q.z - z) > 0.02;
  };
  return {
    id: "starsprout",
    resolve: (x0, z0, x1, z1) => resolveMove(terrain, colliders, PLAYER_RADIUS, x0, z0, x1, z1),
    legal: (x, z) => terrain.walkable(x, z) && !insideCollider(x, z),
    ground: (x, z) => terrain.surface(x, z),
    // 原野出生點：營地既有出生點（FIELD_CAMP_PORTAL 的目的地另一端＝村莊南門抵達點；原野抵達點來自村莊傳送陣）
    spawn: (i) => {
      const a = VILLAGE_SOUTH_PORTAL.to;
      // 多人同時抵達時沿營地方向錯開 0.8 m（仍在營地平地上）
      const k = ((i % 6) + 6) % 6;
      return { x: a.x + (k % 3 - 1) * 0.8, z: a.z + Math.floor(k / 3) * 0.8, yaw: a.yaw };
    },
    portals: [{ id: p.id, x: p.x, z: p.z, triggerR: p.triggerR, armR: p.triggerR + 1, to: { map: p.to.map, x: p.to.x, z: p.to.z, yaw: p.to.yaw } }],
  };
}

const cache = new Map<MapId, MapAuthority>();

/** 取得地圖權威資料（原野地形第一次建立約 0.3 秒，之後重用） */
export function getMap(id: MapId): MapAuthority {
  let m = cache.get(id);
  if (!m) {
    m = id === "village" ? villageAuthority() : starsproutAuthority();
    cache.set(id, m);
  }
  return m;
}

export const MAP_IDS: readonly MapId[] = ["village", "starsprout"];
export const isMapId = (v: unknown): v is MapId => v === "village" || v === "starsprout";
