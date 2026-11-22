/**
 * Stage 6 P2-2：新手營地與胡蘿蔔園的場景物件擺放（純資料，不依賴 Babylon；可單元測試）。
 *
 * 方位角：0° = 北（+Z）、90° = 東（+X）。
 * - 營地中心＝出生點 (-56, -64)。出生點周圍 4 公尺保持空地（玩家活動、未來 NPC／任務／商店）
 *   主路往東北（約 42°）離開營地 → 東北方向是營地大門，圍籬不擋路
 * - 胡蘿蔔園中心 (-12, 34.5)：田壟在半徑 5.2 公尺內，南北向田間小徑穿過中央；
 *   低矮木柵欄半徑 6.4 公尺；西北側緊鄰主路，整段開放當入口；南門留 3 公尺以上開口
 * - 不放怪物、不加戰鬥功能
 */
import { ZONES, type Vec2 } from "./layout.ts";
import type { Collider } from "./terrain.ts";

export type PropKind =
  | "pavilion"
  | "tent"
  | "crate"
  | "crateStack"
  | "rack"
  | "barrel"
  | "banner"
  | "lantern"
  | "signpost"
  | "campfire"
  | "logBench"
  | "fencePost"
  | "fenceRail"
  | "bed"
  | "carrot"
  | "hay"
  | "cart"
  | "hoe";

export interface PropPlacement {
  kind: PropKind;
  x: number;
  z: number;
  /** 朝向（弧度，0 = 物件正面朝北） */
  rot: number;
  scale: number;
  /** fenceRail／bed：長度；其他為 0 */
  length: number;
  /** 所屬區域（camp／farm），畫面層依此合併成網格 */
  area: "camp" | "farm";
  /** 大型（遠處也顯示）或細節（近處才顯示） */
  big: boolean;
}

const camp = ZONES.find((z) => z.id === "camp")!;
const farm = ZONES.find((z) => z.id === "06")!;
const rad = (deg: number): number => (deg * Math.PI) / 180;
const at = (c: Vec2, bearingDeg: number, r: number): Vec2 => ({ x: c.x + Math.sin(rad(bearingDeg)) * r, z: c.z + Math.cos(rad(bearingDeg)) * r });
/** 面向某點的朝向 */
const facing = (from: Vec2, to: Vec2): number => Math.atan2(to.x - from.x, to.z - from.z);

export const CAMP_CENTER: Vec2 = { x: camp.x, z: camp.z };
export const FARM_CENTER: Vec2 = { x: farm.x, z: farm.z };
/** 營地大門方向（主路離開營地的方向） */
export const CAMP_GATE_BEARING = 41.6;
export const CAMP_FENCE_R = 11.5;
export const FARM_FENCE_R = 6.4;
export const FARM_BED_R = 5.2;

function p(kind: PropKind, pos: Vec2, rot: number, area: "camp" | "farm", big: boolean, scale = 1, length = 0): PropPlacement {
  return { kind, x: Math.round(pos.x * 100) / 100, z: Math.round(pos.z * 100) / 100, rot, scale, length, area, big };
}

function buildCamp(): PropPlacement[] {
  const C = CAMP_CENTER;
  const out: PropPlacement[] = [];
  // 出生時鏡頭在角色西南方（約 222°）看向大門 → 西南方向只放低矮物件（營火、長椅），帳篷放在西北與東南
  const pav = at(C, 292, 8.4);
  out.push(p("pavilion", pav, facing(pav, C), "camp", true));
  const tA = at(C, 332, 8.8);
  out.push(p("tent", tA, facing(tA, C), "camp", true, 0.95));
  const tB = at(C, 168, 8.8);
  out.push(p("tent", tB, facing(tB, C), "camp", true));
  // 營火與兩張木頭長椅（營火在西南側，離出生點 6.4 公尺；長椅在營火外側）
  const fire = at(C, 238, 6.4);
  out.push(p("campfire", fire, 0, "camp", true));
  for (const b of [175, 300]) {
    const bp = at(fire, b, 2.1);
    out.push(p("logBench", bp, facing(bp, fire) + Math.PI / 2, "camp", false));
  }
  // 補給：箱子、堆疊箱、物資架、木桶（東南側，靠近小帳篷）
  out.push(p("crateStack", at(C, 140, 7.6), rad(15), "camp", false));
  out.push(p("crate", at(C, 150, 6.3), rad(-20), "camp", false, 0.85));
  const rack = at(C, 118, 8.6);
  out.push(p("rack", rack, facing(rack, C), "camp", false));
  out.push(p("barrel", at(C, 104, 8.8), 0, "camp", false));
  out.push(p("barrel", at(C, 98, 9.6), 0.8, "camp", false, 0.9));
  out.push(p("crate", at(C, 312, 5.8), rad(35), "camp", false, 0.8));
  // 大門：兩支布旗、兩盞燈、路牌（都在主路兩側 3 公尺外）
  const gateDir = { x: Math.sin(rad(CAMP_GATE_BEARING)), z: Math.cos(rad(CAMP_GATE_BEARING)) };
  const perp = { x: gateDir.z, z: -gateDir.x };
  const gate = { x: C.x + gateDir.x * 11, z: C.z + gateDir.z * 11 };
  for (const s of [-1, 1]) out.push(p("banner", { x: gate.x + perp.x * 3.3 * s, z: gate.z + perp.z * 3.3 * s }, rad(CAMP_GATE_BEARING), "camp", true));
  const inner = { x: C.x + gateDir.x * 6.5, z: C.z + gateDir.z * 6.5 };
  for (const s of [-1, 1]) out.push(p("lantern", { x: inner.x + perp.x * 3 * s, z: inner.z + perp.z * 3 * s }, 0, "camp", false));
  const sign = { x: C.x + gateDir.x * 13 + perp.x * 3, z: C.z + gateDir.z * 13 + perp.z * 3 };
  out.push(p("signpost", sign, rad(CAMP_GATE_BEARING), "camp", false));
  // 低矮木圍籬：大門（約 15°～70°）以外的弧線
  const from = 72;
  const to = 360 + 12;
  const step = (2.2 / (2 * Math.PI * CAMP_FENCE_R)) * 360;
  let prev: Vec2 | null = null;
  for (let b = from; b <= to + 1e-6; b += step) {
    const pt = at(C, b % 360, CAMP_FENCE_R);
    out.push(p("fencePost", pt, 0, "camp", true));
    if (prev) out.push(p("fenceRail", { x: (pt.x + prev.x) / 2, z: (pt.z + prev.z) / 2 }, facing(prev, pt), "camp", true, 1, Math.hypot(pt.x - prev.x, pt.z - prev.z)));
    prev = pt;
  }
  return out;
}

function buildFarm(): PropPlacement[] {
  const F = FARM_CENTER;
  const out: PropPlacement[] = [];
  // 田壟：東西向，南北向小徑（寬 1.4 公尺）穿過中央
  const rows = [-4.2, -2.8, -1.4, 1.4, 2.8, 4.2];
  const path = 0.7;
  for (const dz of rows) {
    const half = Math.sqrt(Math.max(0, FARM_BED_R * FARM_BED_R - dz * dz));
    for (const side of [-1, 1]) {
      const x0 = path + 0.2;
      const x1 = half - 0.2;
      if (x1 - x0 < 0.8) continue;
      const len = x1 - x0;
      const cx = F.x + side * (x0 + len / 2);
      out.push(p("bed", { x: cx, z: F.z + dz }, Math.PI / 2, "farm", true, 1, len));
      const n = Math.floor(len / 0.45);
      for (let i = 0; i < n; i++) {
        const x = F.x + side * (x0 + 0.25 + i * (len - 0.5) / Math.max(1, n - 1));
        // 稍微錯開，看起來自然
        const jz = ((i * 37 + Math.round(dz * 10)) % 5) * 0.03 - 0.06;
        out.push(p("carrot", { x, z: F.z + dz + jz }, ((i * 53) % 360) * (Math.PI / 180), "farm", false, 0.85 + ((i * 7) % 4) * 0.08));
      }
    }
  }
  // 圍籬：西北側緊鄰主路（P10→P11），整段開放當入口（約 296°～8°）；南門（約 166°～196°）留開口
  const gates: [number, number][] = [
    [296, 368],
    [166, 196],
  ];
  const inGate = (b: number): boolean => gates.some(([a, c]) => (b >= a && b <= c) || (b + 360 >= a && b + 360 <= c));
  const step = (1.8 / (2 * Math.PI * FARM_FENCE_R)) * 360;
  let prev: { pt: Vec2; b: number } | null = null;
  for (let b = 0; b < 360; b += step) {
    if (inGate(b)) {
      prev = null;
      continue;
    }
    const pt = at(F, b, FARM_FENCE_R);
    out.push(p("fencePost", pt, 0, "farm", true, 0.8));
    if (prev) out.push(p("fenceRail", { x: (pt.x + prev.pt.x) / 2, z: (pt.z + prev.pt.z) / 2 }, facing(prev.pt, pt), "farm", true, 0.8, Math.hypot(pt.x - prev.pt.x, pt.z - prev.pt.z)));
    prev = { pt, b };
  }
  // 田園小物：木桶、乾草捆、推車、靠在圍籬上的鋤頭（都在圍籬外東側或門邊，不在路上）
  out.push(p("barrel", at(F, 66, 7.4), 0.4, "farm", false));
  out.push(p("barrel", at(F, 73, 7.9), 1.2, "farm", false, 0.85));
  out.push(p("hay", at(F, 95, 7.6), rad(10), "farm", false));
  out.push(p("hay", at(F, 108, 7.5), rad(70), "farm", false, 0.9));
  const cart = at(F, 128, 8.3);
  out.push(p("cart", cart, facing(cart, F) + Math.PI / 2, "farm", false));
  out.push(p("hoe", at(F, 160, 6.75), rad(160), "farm", false));
  return out;
}

export const PROPS: readonly PropPlacement[] = [...buildCamp(), ...buildFarm()];

/** 碰撞半徑（公尺）；圍籬橫木用一串小圓 */
const R: Partial<Record<PropKind, number>> = {
  pavilion: 2.6,
  tent: 1.75,
  crate: 0.5,
  crateStack: 0.75,
  rack: 0.55,
  barrel: 0.42,
  banner: 0.16,
  lantern: 0.16,
  signpost: 0.16,
  campfire: 0.85,
  logBench: 0.35,
  fencePost: 0.12,
  hay: 0.62,
  cart: 0.8,
};

export function propColliders(props: readonly PropPlacement[] = PROPS): Collider[] {
  const out: Collider[] = [];
  for (const pr of props) {
    if (pr.kind === "fenceRail") {
      const n = Math.max(1, Math.ceil(pr.length / 0.5));
      for (let i = 1; i < n; i++) {
        const t = i / n - 0.5;
        out.push({ kind: "fence", x: pr.x + Math.sin(pr.rot) * pr.length * t, z: pr.z + Math.cos(pr.rot) * pr.length * t, r: 0.12 });
      }
      continue;
    }
    if (pr.kind === "logBench" || pr.kind === "rack") {
      // 長形物件：兩個圓
      for (const s of [-0.5, 0.5]) out.push({ kind: pr.kind, x: pr.x + Math.cos(pr.rot) * s, z: pr.z - Math.sin(pr.rot) * s, r: (R[pr.kind] ?? 0.3) * pr.scale });
      continue;
    }
    const r = R[pr.kind];
    if (r) out.push({ kind: pr.kind, x: pr.x, z: pr.z, r: r * pr.scale });
  }
  return out;
}

/** 植被避開區（物件下方與周圍不長樹、灌木、草） */
export function propExclusions(props: readonly PropPlacement[] = PROPS): { x: number; z: number; r: number }[] {
  const out: { x: number; z: number; r: number }[] = [];
  for (const pr of props) {
    if (pr.kind === "carrot" || pr.kind === "fencePost" || pr.kind === "fenceRail") continue;
    const r = pr.kind === "bed" ? pr.length / 2 + 0.6 : (R[pr.kind] ?? 0.4) * pr.scale + 0.5;
    out.push({ x: pr.x, z: pr.z, r });
  }
  // 營地出生點空地、胡蘿蔔園田區
  out.push({ x: CAMP_CENTER.x, z: CAMP_CENTER.z, r: 4 });
  out.push({ x: FARM_CENTER.x, z: FARM_CENTER.z, r: FARM_BED_R + 0.4 });
  return out;
}
