// Stage 6 P2-3 星芽村 V1.3：村莊配置（純資料與純計算，不依賴 Babylon，可在 node 單元測試）
// 座標：X 東、Z 北，單位公尺；方位（bearing）北＝0°，順時針。
// 第一階段（Grey-box）：廣場、建築佔位、道路、高台、石階、碰撞、NPC／傳送／復活座標預留。
// 不含 NPC 功能、傳送、死亡復活、UI。

export const VILLAGE_HALF = 60;
/** 可行走範圍：以噴泉為中心半徑 50 m（外圍是樹籬與緩坡） */
export const WALK_RADIUS = 50;
export const WALK_SPEED = 5;
export const PLAYER_RADIUS = 0.3;
/** 每一步可跨越的最大高度差（公尺）：石階斜坡可走，高台邊緣（落差 2 m）擋住 */
export const MAX_STEP = 0.35;

export const FOUNTAIN = { x: 0, z: 0, basinR: 7, walkwayR: 11, plazaR: 18, interactR: 10.5, crystalTop: 6.5 } as const;

/** 由方位與距離算出座標 */
export function polar(bearingDeg: number, r: number): { x: number; z: number } {
  const t = (bearingDeg * Math.PI) / 180;
  return { x: r * Math.sin(t), z: r * Math.cos(t) };
}

export type BuildingId = "sword" | "knight" | "mage" | "church" | "circus" | "warehouse" | "smith" | "guild";

export interface BuildingDef {
  id: BuildingId;
  name: string;
  /** 職業或用途 */
  role: string;
  bearing: number;
  /** 沿環方向的寬度、往外的深度 */
  w: number;
  d: number;
  /** 屋簷高度、最高點 */
  eave: number;
  top: number;
  /** 所在地面高度（0＝廣場；2＝北側上層高台） */
  floor: number;
  /** 正門離噴泉中心的距離 */
  front: number;
  shape: "hall" | "castle" | "tower" | "church" | "tent" | "shop" | "storehouse";
}

/** V1.3：讓出東西南北四條主路；劍士、騎士、法師在北側上層高台，其餘在地面 */
export const BUILDINGS: readonly BuildingDef[] = [
  { id: "sword", name: "劍士軍團", role: "劍士轉職", bearing: 297, w: 12, d: 12, eave: 7, top: 13, floor: 2.0, front: 27, shape: "hall" },
  { id: "knight", name: "騎士軍團", role: "騎士轉職", bearing: 332, w: 16, d: 14, eave: 9, top: 19, floor: 2.0, front: 27, shape: "castle" },
  { id: "mage", name: "法師軍團", role: "法師轉職", bearing: 26, w: 13, d: 13, eave: 8, top: 20, floor: 2.0, front: 27, shape: "tower" },
  { id: "church", name: "教堂", role: "祭司轉職", bearing: 66, w: 12, d: 18, eave: 9, top: 18, floor: 0, front: 24, shape: "church" },
  { id: "circus", name: "馬戲團", role: "小丑轉職", bearing: 128, w: 14, d: 14, eave: 4, top: 10, floor: 0, front: 24, shape: "tent" },
  { id: "warehouse", name: "倉庫", role: "倉庫", bearing: 208, w: 10, d: 8, eave: 4.5, top: 7, floor: 0, front: 24, shape: "storehouse" },
  { id: "smith", name: "鐵匠鋪", role: "鐵匠轉職＋裝備鑑定", bearing: 240, w: 12, d: 10, eave: 5, top: 11, floor: 0, front: 24, shape: "shop" },
  // 第三批追加（2026-11-24）：星願商會＝道具店＋玩家交易所。放在馬戲團與南路之間、佈告欄後方的空地（原本沒有使用），
  // 與其他建築間距 ≥2.5 m、離南路路緣 ≥1.5 m、不碰任何既有碰撞與 NPC 互動區；正門朝噴泉。
  // 商會 NPC 站在正門前、往南路側偏 3.5 m（不站在佈告欄正後方，從廣場直走過去不會被佈告欄擋住）
  { id: "guild", name: "星願商會", role: "道具店＋玩家交易所", bearing: 160, w: 10, d: 8, eave: 5.5, top: 10, floor: 0, front: 27, shape: "shop" },
];

/** 建築中心（佔地矩形中心） */
export function buildingCenter(b: BuildingDef): { x: number; z: number } {
  return polar(b.bearing, b.front + b.d / 2);
}

/** 北側上層高台：方位 281° 經北到 44°、r 23～49、高 +2 m */
export const PLATFORM = { from: 281, to: 44, r0: 23, r1: 49, height: 2 } as const;
/** 石階：r 18 → r 23（長 5 m）、寬 6 m；方位 297°（劍士前）、332°（騎士前）、0°（北路）、26°（法師前） */
export const STAIR_FROM = 18;
export const STAIR_WIDTH = 6;
export const STAIRS: readonly number[] = [297, 332, 0, 26];
/** 四條放射主路（寬 6 m） */
export const ROADS: readonly number[] = [0, 90, 180, 270];
export const ROAD_HALF = 3;

/** 方位是否在高台的角度範圍內（281°→360°→44°） */
export function inPlatformArc(bearingDeg: number): boolean {
  const b = ((bearingDeg % 360) + 360) % 360;
  return b >= PLATFORM.from || b <= PLATFORM.to;
}
export function bearingOf(x: number, z: number): number {
  return (((Math.atan2(x, z) * 180) / Math.PI) % 360 + 360) % 360;
}
export function onPlatform(x: number, z: number): boolean {
  const r = Math.hypot(x, z);
  return r >= PLATFORM.r0 && r <= PLATFORM.r1 && inPlatformArc(bearingOf(x, z));
}

/** 戶外鍛造台：鐵匠鋪前庭 */
export const FORGE = (() => {
  const t = (240 * Math.PI) / 180;
  const dx = Math.sin(t);
  const dz = Math.cos(t);
  return { x: 22.5 * dx + 3.5 * dz, z: 22.5 * dz - 3.5 * dx, w: 2.4, d: 2, rot: t };
})();

/** 每日委託佈告欄 */
// Stage 6.7：N008 Tripo 佈告欄（寬 3.2 m、石座深約 1.25 m）→ 碰撞箱改為 3.4 × 1.3 m（位置、方向不變；離環形廣場外緣 r 18 仍有距離）
export const BOARD = { ...polar(158, 19.5), w: 3.4, d: 1.3, rot: (158 * Math.PI) / 180 } as const;

/** 四座傳送門（V1.3）：只有南方開放（往星芽原野）；北、東、西未開放，不設目的地 */
export interface PortalDef {
  id: "south" | "north" | "east" | "west";
  name: string;
  bearing: number;
  x: number;
  z: number;
  r: number;
  floor: number;
  open: boolean;
  /** 開放時的目的地（未開放＝null，不可自行指定） */
  destination: { map: "starsprout"; x: number; z: number; label: string } | null;
}
export const PORTAL_R = 4;
export const PORTALS: readonly PortalDef[] = [
  { id: "south", name: "南方傳送門", bearing: 180, ...polar(180, 44), r: PORTAL_R, floor: 0, open: true, destination: { map: "starsprout", x: -56, z: -64, label: "星芽原野 Lv1–10（新手營地）" } },
  { id: "north", name: "北方傳送門", bearing: 0, ...polar(0, 44), r: PORTAL_R, floor: 2, open: false, destination: null },
  { id: "east", name: "東方傳送門", bearing: 90, ...polar(90, 44), r: PORTAL_R, floor: 0, open: false, destination: null },
  { id: "west", name: "西方傳送門", bearing: 270, ...polar(270, 44), r: PORTAL_R, floor: 0, open: false, destination: null },
];
/** 南方傳送門（往原野）相容舊名稱 */
export const ARRIVAL_PORTAL = PORTALS[0]!;
/** 從星芽原野返回的抵達點：南方傳送門內側，面向北（中央廣場） */
export const ARRIVAL_SPOT = { x: 0, z: -39, yaw: 0 } as const;
/** 南門拱門（裝飾） */
export const SOUTH_GATE = { z: -36, halfW: 4.6 } as const;

export interface NpcSpot {
  id: string;
  name: string;
  role: string;
  x: number;
  z: number;
  /** 面向（yaw，0＝+Z） */
  yaw: number;
  floor: number;
  /** 互動半徑 */
  interactR: number;
}

function faceCenter(x: number, z: number): number {
  return Math.atan2(-x, -z);
}

export const NPC_SPOTS: readonly NpcSpot[] = [
  ...BUILDINGS.map((b): NpcSpot => {
    let p = polar(b.bearing, b.floor > 0 ? b.front - 2 : b.front - 2.5);
    let name = b.name;
    if (b.id === "guild") {
      const t = (b.bearing * Math.PI) / 180;
      p = { x: 25.0 * Math.sin(t) + 3.5 * Math.cos(t), z: 25.0 * Math.cos(t) - 3.5 * Math.sin(t) };
      name = "商會掌櫃";
    }
    if (b.id === "smith") {
      const t = (b.bearing * Math.PI) / 180;
      p = { x: 21.0 * Math.sin(t) + 1.8 * Math.cos(t), z: 21.0 * Math.cos(t) - 1.8 * Math.sin(t) };
      name = "鐵匠（鍛造台旁）";
    }
    return { id: b.id, name, role: b.role, x: p.x, z: p.z, yaw: faceCenter(p.x, p.z), floor: b.floor, interactR: 3 };
  }),
  (() => {
    const x = BOARD.x - 0.3;
    const z = BOARD.z + 1.8;
    return { id: "board", name: "每日委託佈告欄", role: "每日委託", x, z, yaw: Math.PI - BOARD.rot, floor: 0, interactR: 3 };
  })(),
];

/**
 * 新角色出生＋死亡復活候選點（24 個，只預留座標）：
 * 內圈 r 12.5（方位 0°＋每 30°）、外圈 r 15（方位 15°＋每 30°）；離 NPC ≥3.5 m、離石階起點 ≥2.5 m
 */
export const RESPAWN_SLOTS: readonly { x: number; z: number; yaw: number }[] = (() => {
  const out: { x: number; z: number; yaw: number }[] = [];
  const stairFoots = STAIRS.map((s) => polar(s, STAIR_FROM));
  for (const [ring, off] of [
    [12.5, 0],
    [15, 15],
  ] as const) {
    for (let i = 0; i < 12; i++) {
      const p = polar(off + i * 30, ring);
      if (NPC_SPOTS.some((n) => Math.hypot(n.x - p.x, n.z - p.z) < 3.5)) continue;
      if (stairFoots.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 2.5)) continue;
      out.push({ x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, yaw: faceCenter(p.x, p.z) });
    }
  }
  return out;
})();
/** 出生與復活共用同一組安全點 */
export const SPAWN_SLOTS = RESPAWN_SLOTS;

// ---------------- 地面高度 ----------------

/** 點在某方位座標系中的 (沿方位距離, 側向距離) */
function radialLocal(bearingDeg: number, x: number, z: number): { along: number; side: number } {
  const t = (bearingDeg * Math.PI) / 180;
  const dx = Math.sin(t);
  const dz = Math.cos(t);
  return { along: x * dx + z * dz, side: x * dz - z * dx };
}

/** 地面高度：廣場 0；北側高台 2；石階線性斜坡；可走範圍外緩緩升高成小丘 */
export function groundHeight(x: number, z: number): number {
  if (onPlatform(x, z)) return PLATFORM.height;
  for (const s of STAIRS) {
    const l = radialLocal(s, x, z);
    if (Math.abs(l.side) <= STAIR_WIDTH / 2 && l.along >= STAIR_FROM && l.along < PLATFORM.r0) {
      return (PLATFORM.height * (l.along - STAIR_FROM)) / (PLATFORM.r0 - STAIR_FROM);
    }
  }
  const r = Math.hypot(x, z);
  if (r > WALK_RADIUS + 1) return Math.min(6, (r - WALK_RADIUS - 1) * 0.35);
  return 0;
}

/** 是否在石階上 */
export function onStairs(x: number, z: number): boolean {
  if (onPlatform(x, z)) return false;
  for (const s of STAIRS) {
    const l = radialLocal(s, x, z);
    if (Math.abs(l.side) <= STAIR_WIDTH / 2 && l.along >= STAIR_FROM && l.along < PLATFORM.r0) return true;
  }
  return false;
}

// ---------------- 碰撞 ----------------

export interface CircleCollider {
  kind: string;
  x: number;
  z: number;
  r: number;
}
/** 旋轉矩形碰撞：rot＝方位角（弧度），本地 +Z 朝外 */
export interface BoxCollider {
  kind: string;
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
  /** 底與頂（給鏡頭避障用） */
  y0: number;
  y1: number;
}

/** 傳送門石柱：在圓台外圈，方位（相對朝村莊方向）±50°、±130°；朝村莊的入口留 7 m 寬 */
export function portalPillars(p: PortalDef): { x: number; z: number }[] {
  const inward = (p.bearing + 180) % 360;
  return [50, -50, 130, -130].map((d) => {
    const o = polar(inward + d, p.r + 0.6);
    return { x: p.x + o.x, z: p.z + o.z };
  });
}

export const CIRCLE_COLLIDERS: readonly CircleCollider[] = (() => {
  const c: CircleCollider[] = [{ kind: "fountain", x: 0, z: 0, r: FOUNTAIN.basinR }];
  // 水晶燈座 4 座
  for (const b of [45, 135, 225, 315]) c.push({ kind: "crystalLamp", ...polar(b, 9.5), r: 0.45 });
  // 長椅 8 張（靠水池），方位 22.5°＋每 45°
  for (let i = 0; i < 8; i++) c.push({ kind: "bench", ...polar(22.5 + i * 45, 8.4), r: 0.55 });
  // 路燈：環形廣場外緣 r 18.6（避開主路、石階）
  for (const b of [45, 75, 112, 140, 205, 225, 255, 285, 315]) c.push({ kind: "lamp", ...polar(b, 18.6), r: 0.3 });
  // 南門拱門門柱
  c.push({ kind: "gatePost", x: -SOUTH_GATE.halfW, z: SOUTH_GATE.z, r: 0.6 }, { kind: "gatePost", x: SOUTH_GATE.halfW, z: SOUTH_GATE.z, r: 0.6 });
  // 傳送門石柱
  for (const p of PORTALS) for (const s of portalPillars(p)) c.push({ kind: `portalStone:${p.id}`, x: s.x, z: s.z, r: 0.45 });
  return c;
})();

export const BOX_COLLIDERS: readonly BoxCollider[] = (() => {
  const out: BoxCollider[] = [];
  for (const b of BUILDINGS) {
    const c = buildingCenter(b);
    out.push({ kind: `building:${b.id}`, x: c.x, z: c.z, hw: b.w / 2, hd: b.d / 2, rot: (b.bearing * Math.PI) / 180, y0: b.floor - 0.5, y1: b.floor + b.top });
  }
  out.push({ kind: "forge", x: FORGE.x, z: FORGE.z, hw: FORGE.w / 2, hd: FORGE.d / 2, rot: FORGE.rot, y0: -0.5, y1: 2.2 });
  out.push({ kind: "board", x: BOARD.x, z: BOARD.z, hw: BOARD.w / 2, hd: BOARD.d / 2, rot: BOARD.rot, y0: -0.5, y1: 3.5 });
  return out;
})();

/** 點與旋轉矩形的最近點 */
function boxLocal(b: BoxCollider, x: number, z: number): { lx: number; lz: number } {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const dx = x - b.x;
  const dz = z - b.z;
  // 世界 → 本地（bake 的旋轉：world = (lx c + lz s, -lx s + lz c)）
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}
function boxWorld(b: BoxCollider, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
}

export function insideBox(b: BoxCollider, x: number, z: number, pad = 0): boolean {
  const l = boxLocal(b, x, z);
  return Math.abs(l.lx) <= b.hw + pad && Math.abs(l.lz) <= b.hd + pad;
}

/** 推出碰撞物（圓形＋旋轉矩形） */
export function pushOut(x: number, z: number, radius: number): { x: number; z: number } {
  let px = x;
  let pz = z;
  for (const c of CIRCLE_COLLIDERS) {
    const dx = px - c.x;
    const dz = pz - c.z;
    const min = c.r + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2);
    if (d < 1e-6) {
      px = c.x + min;
      continue;
    }
    px += (dx * (min - d)) / d;
    pz += (dz * (min - d)) / d;
  }
  for (const b of BOX_COLLIDERS) {
    const l = boxLocal(b, px, pz);
    const cx = Math.max(-b.hw, Math.min(b.hw, l.lx));
    const cz = Math.max(-b.hd, Math.min(b.hd, l.lz));
    const ddx = l.lx - cx;
    const ddz = l.lz - cz;
    const d2 = ddx * ddx + ddz * ddz;
    if (d2 >= radius * radius) continue;
    let nlx: number;
    let nlz: number;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2);
      nlx = cx + (ddx / d) * radius;
      nlz = cz + (ddz / d) * radius;
    } else {
      // 中心在矩形內：從最近的邊推出去
      const ex = b.hw - Math.abs(l.lx);
      const ez = b.hd - Math.abs(l.lz);
      if (ex < ez) {
        nlx = Math.sign(l.lx || 1) * (b.hw + radius);
        nlz = l.lz;
      } else {
        nlx = l.lx;
        nlz = Math.sign(l.lz || 1) * (b.hd + radius);
      }
    }
    const w = boxWorld(b, nlx, nlz);
    px = w.x;
    pz = w.z;
  }
  return { x: px, z: pz };
}

/** 是否在可行走範圍（不含碰撞物）：可走半徑內或南側大道、傳送陣 */
export function inBounds(x: number, z: number): boolean {
  return Math.hypot(x, z) <= WALK_RADIUS;
}

/** 點本身能不能站（範圍內、不在碰撞物裡） */
export function standable(x: number, z: number, radius = PLAYER_RADIUS): boolean {
  if (!inBounds(x, z)) return false;
  for (const c of CIRCLE_COLLIDERS) if (Math.hypot(x - c.x, z - c.z) < c.r + radius - 1e-6) return false;
  for (const b of BOX_COLLIDERS) {
    const l = boxLocal(b, x, z);
    const cx = Math.max(-b.hw, Math.min(b.hw, l.lx));
    const cz = Math.max(-b.hd, Math.min(b.hd, l.lz));
    if (Math.hypot(l.lx - cx, l.lz - cz) < radius - 1e-6) return false;
  }
  return true;
}

/**
 * 移動解算：推開碰撞物 → 檢查範圍與高度差（高台邊緣擋住，石階可走）→ 不行就沿 X 或 Z 單軸滑動。
 * 每次移動距離要小（每幀約 0.08 m），高度差判斷才準；呼叫端可分段。
 */
export function resolveVillageMove(x0: number, z0: number, x1: number, z1: number, radius = PLAYER_RADIUS): { x: number; z: number; blocked: boolean } {
  const h0 = groundHeight(x0, z0);
  const tryAt = (x: number, z: number): { x: number; z: number } | null => {
    const p = pushOut(x, z, radius);
    if (!inBounds(p.x, p.z)) return null;
    if (Math.abs(groundHeight(p.x, p.z) - h0) > MAX_STEP) return null;
    return p;
  };
  const full = tryAt(x1, z1);
  if (full) return { ...full, blocked: false };
  const sx = tryAt(x1, z0);
  const sz = tryAt(x0, z1);
  if (sx && sz) return Math.abs(x1 - x0) >= Math.abs(z1 - z0) ? { ...sx, blocked: true } : { ...sz, blocked: true };
  if (sx) return { ...sx, blocked: true };
  if (sz) return { ...sz, blocked: true };
  return { x: x0, z: z0, blocked: true };
}

/** 分段移動（每段 ≤ 0.1 m） */
export function moveVillage(x0: number, z0: number, x1: number, z1: number, radius = PLAYER_RADIUS): { x: number; z: number; blocked: boolean } {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.1));
  let x = x0;
  let z = z0;
  let blocked = false;
  // 每段從「目前位置」往同一方向走 0.1 m（被推開後不會跳到障礙物另一側）
  const sx = (x1 - x0) / n;
  const sz = (z1 - z0) / n;
  for (let i = 1; i <= n; i++) {
    const r = resolveVillageMove(x, z, x + sx, z + sz, radius);
    blocked ||= r.blocked;
    x = r.x;
    z = r.z;
  }
  return { x, z, blocked };
}

// ---------------- 鏡頭避障（建築矩形＋噴泉中央柱） ----------------

const CAM_PAD = 0.3;
const CAM_MIN = 1.4;

/** 角色往方向 (dx,dy,dz) 看向鏡頭，回傳可放的最遠距離 */
export function villageCameraDistance(tx: number, ty: number, tz: number, dx: number, dy: number, dz: number, maxR: number): number {
  let best = maxR + CAM_PAD;
  for (const b of BOX_COLLIDERS) {
    if (!b.kind.startsWith("building:")) continue;
    // 本地座標的射線，與加邊距的矩形做 slab 求交
    const o = boxLocal(b, tx, tz);
    const c = Math.cos(b.rot);
    const s = Math.sin(b.rot);
    const ldx = dx * c - dz * s;
    const ldz = dx * s + dz * c;
    const hw = b.hw + CAM_PAD;
    const hd = b.hd + CAM_PAD;
    if (Math.abs(o.lx) <= hw && Math.abs(o.lz) <= hd) continue; // 角色在裡面（不可能，保險）
    let t0 = 0;
    let t1 = best;
    const slab = (p: number, v: number, h: number): boolean => {
      if (Math.abs(v) < 1e-9) return Math.abs(p) <= h;
      let a = (-h - p) / v;
      let bb = (h - p) / v;
      if (a > bb) [a, bb] = [bb, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, bb);
      return t0 <= t1;
    };
    if (!slab(o.lx, ldx, hw) || !slab(o.lz, ldz, hd)) continue;
    const y = ty + t0 * dy;
    if (y < b.y0 || y > b.y1 + CAM_PAD) continue;
    if (t0 < best) best = t0;
  }
  // 噴泉中央柱與水晶（半徑約 1.6 m、到 Y 6.5）；水池邊緣很低不算
  {
    const a = dx * dx + dz * dz;
    const ox = tx;
    const oz = tz;
    const b2 = ox * dx + oz * dz;
    const r = 1.6 + CAM_PAD;
    const c0 = ox * ox + oz * oz;
    if (a > 1e-8 && b2 < 0 && c0 > r * r) {
      const disc = b2 * b2 - a * (c0 - r * r);
      if (disc >= 0) {
        const t = (-b2 - Math.sqrt(disc)) / a;
        const y = ty + t * dy;
        if (t >= 0 && t < best && y <= FOUNTAIN.crystalTop + CAM_PAD) best = t;
      }
    }
  }
  if (best >= maxR + CAM_PAD) return maxR;
  return Math.max(CAM_MIN, Math.min(maxR, best));
}

// ---------------- 測試點與統計 ----------------

/** 傳送清單（測試面板） */
export const VILLAGE_SPOTS: readonly { id: string; label: string; x: number; z: number; yaw: number }[] = [
  { id: "arrival", label: "南門抵達點", x: ARRIVAL_SPOT.x, z: ARRIVAL_SPOT.z, yaw: 0 },
  { id: "spawn", label: "出生點", x: RESPAWN_SLOTS[6]!.x, z: RESPAWN_SLOTS[6]!.z, yaw: RESPAWN_SLOTS[6]!.yaw },
  ...NPC_SPOTS.map((n) => ({ id: n.id, label: n.name.replace("（鍛造台旁）", ""), x: n.x + Math.sin(n.yaw) * 2, z: n.z + Math.cos(n.yaw) * 2, yaw: n.yaw + Math.PI })),
  // 北、東、西傳送門前 7 m（面向傳送門）
  ...PORTALS.filter((p) => p.id !== "south").map((p) => {
    const q = polar(p.bearing, 44 - 7.5);
    return { id: `portal-${p.id}`, label: p.name.replace("傳送門", "門"), x: q.x, z: q.z, yaw: (p.bearing * Math.PI) / 180 };
  }),
];

/** 格點尋路（測試用）：檢查兩點之間是否有可走路徑（0.5 m 格、8 方向、遵守碰撞與高度差） */
export function reachable(ax: number, az: number, bx: number, bz: number, cell = 0.5): boolean {
  const N = Math.ceil((VILLAGE_HALF * 2) / cell);
  const idx = (x: number, z: number): number => {
    const i = Math.round((x + VILLAGE_HALF) / cell);
    const j = Math.round((z + VILLAGE_HALF) / cell);
    return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
  };
  const pos = (k: number): [number, number] => [(k % N) * cell - VILLAGE_HALF, Math.floor(k / N) * cell - VILLAGE_HALF];
  const start = idx(ax, az);
  const goal = idx(bx, bz);
  if (start < 0 || goal < 0) return false;
  const seen = new Uint8Array(N * N);
  const queue = new Int32Array(N * N);
  let qh = 0;
  let qt = 0;
  queue[qt++] = start;
  seen[start] = 1;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const;
  while (qh < qt) {
    const k = queue[qh++]!;
    if (k === goal) return true;
    const [x, z] = pos(k);
    const h = groundHeight(x, z);
    for (const [di, dj] of dirs) {
      const nx = x + di * cell;
      const nz = z + dj * cell;
      const nk = idx(nx, nz);
      if (nk < 0 || seen[nk]) continue;
      // 終點格只要求「範圍內、高度相近」（NPC 站位本身就在可站的地方）
      if (nk !== goal && !standable(nx, nz)) continue;
      if (Math.abs(groundHeight(nx, nz) - h) > MAX_STEP + 0.1) continue;
      seen[nk] = 1;
      queue[qt++] = nk;
    }
  }
  return false;
}
