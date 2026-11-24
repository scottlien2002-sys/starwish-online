/**
 * Stage 6 星芽村「寵物商人」：巡走路線、互動選單狀態、與寵物系統連接的服務介面（純邏輯，可單元測試）。
 *
 * - 位置：中央廣場噴泉步道外緣 r 10.8（噴泉水池 r 7、長椅 r 8.4、水晶燈座 r 9.5 之外；出生點 r 12.5 之內），
 *   順時針（方位遞增）慢慢繞噴泉一圈，在 4 個停留點各停一下（停留點避開主路與石階軸線 ±12°）
 * - 商人不是碰撞物：不會擋住玩家或主要通道（只有互動範圍）
 * - 寵物功能尚未接入：預設使用「占位服務」，所有功能回覆「準備中」；不在這裡定任何鑑定機率或價格。
 *   寵物系統（Claude A）完成後，以 connectPetMerchantService() 接上正式實作即可，畫面與互動流程不用改
 */
import { BOX_COLLIDERS, CIRCLE_COLLIDERS, insideBox, NPC_SPOTS, polar, ROADS, SPAWN_SLOTS, STAIRS, standable } from "./layout.ts";

export const PET_MERCHANT = Object.freeze({
  id: "petMerchant",
  name: "寵物商人",
  role: "寵物鑑定・飼料・培育與進化資訊",
  /** 巡走半徑（m） */
  patrolR: 10.8,
  /** 行走速度（m/s；玩家 5 m/s） */
  speed: 0.6,
  /** 每個停留點停留秒數 */
  dwellSec: 8,
  /** 停留點方位（°），依巡走順序（方位遞增） */
  stations: [202.5, 247.5, 67.5, 157.5] as readonly number[],
  /** 互動半徑（m） */
  interactR: 2.5,
  /** 身體半徑（只用來檢查路線與障礙物的距離；不參與玩家碰撞） */
  bodyR: 0.35,
  /** 轉身時間（s） */
  turnSec: 0.8,
  /** 起步／停下的緩衝距離（m） */
  easeM: 0.8,
});

const D2R = Math.PI / 180;
const norm360 = (b: number): number => ((b % 360) + 360) % 360;
/** 從方位 a 順時針走到 b 的角度（0～360） */
const cwDelta = (a: number, b: number): number => norm360(b - a) || 360;

export interface PetMerchantPose {
  x: number;
  z: number;
  /** 面向（yaw，0＝+Z，與 NPC_SPOTS 相同） */
  yaw: number;
  walking: boolean;
  /** 停留中的停留點索引；行走中為 -1 */
  station: number;
  /** 目前方位（°） */
  bearing: number;
}

interface Seg {
  kind: "dwell" | "walk";
  t0: number;
  dur: number;
  b0: number;
  b1: number;
  station: number;
}

function timeline(): { segs: Seg[]; loop: number } {
  const P = PET_MERCHANT;
  const segs: Seg[] = [];
  let t = 0;
  for (let i = 0; i < P.stations.length; i++) {
    const a = P.stations[i]!;
    const b = P.stations[(i + 1) % P.stations.length]!;
    segs.push({ kind: "dwell", t0: t, dur: P.dwellSec, b0: a, b1: a, station: i });
    t += P.dwellSec;
    const len = cwDelta(a, b) * D2R * P.patrolR;
    // 起步／停下各 easeM 公尺等加速、等減速（平均速度一半）→ 多花 2·easeM/speed 秒
    const dur = (len + 2 * Math.min(P.easeM, 0.45 * len)) / P.speed;
    segs.push({ kind: "walk", t0: t, dur, b0: a, b1: a + cwDelta(a, b), station: -1 });
    t += dur;
  }
  return { segs, loop: t };
}
const TL = timeline();
/** 巡走一圈的總時間（s） */
export const PET_MERCHANT_LOOP_SEC = TL.loop;

/** 行走進度 u（0～1，時間）→ 路程比例：前後各 easeM 公尺等加速／等減速，中間等速 */
function easeDist(u: number, len: number): number {
  const e = Math.min(PET_MERCHANT.easeM / len, 0.45);
  const a = (2 * e) / (1 + 2 * e); // 加速所佔的時間比例
  const v = 1 / (1 - a); // 等速段速度（路程／時間皆正規化）
  if (u < a) return (0.5 * v * u * u) / a;
  if (u > 1 - a) return 1 - (0.5 * v * (1 - u) * (1 - u)) / a;
  return v * (u - a / 2);
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
const smooth = (t: number): number => t * t * (3 - 2 * t);
/** 行走方向的 yaw（方位遞增＝順時針） */
const walkYaw = (b: number): number => Math.atan2(Math.cos(b * D2R), -Math.sin(b * D2R));
/** 面朝廣場外側的 yaw（停留時面對來找他的玩家） */
const outYaw = (b: number): number => b * D2R;

/** 時間 t（秒）時商人的位置與面向（巡走一圈後重複） */
export function petMerchantPose(t: number): PetMerchantPose {
  const P = PET_MERCHANT;
  const tt = ((t % TL.loop) + TL.loop) % TL.loop;
  const seg = TL.segs.find((s) => tt >= s.t0 && tt < s.t0 + s.dur) ?? TL.segs[0]!;
  const u = (tt - seg.t0) / seg.dur;
  if (seg.kind === "dwell") {
    const p = polar(seg.b0, P.patrolR);
    // 停下時從行走方向轉向外側；出發前轉回行走方向
    const into = Math.min(1, (tt - seg.t0) / P.turnSec);
    const out = Math.max(0, 1 - (seg.t0 + seg.dur - tt) / P.turnSec);
    let yaw = lerpAngle(walkYaw(seg.b0), outYaw(seg.b0), smooth(into));
    if (out > 0) yaw = lerpAngle(outYaw(seg.b0), walkYaw(seg.b0), smooth(out));
    return { x: p.x, z: p.z, yaw, walking: false, station: seg.station, bearing: norm360(seg.b0) };
  }
  const len = (seg.b1 - seg.b0) * D2R * P.patrolR;
  const b = seg.b0 + (seg.b1 - seg.b0) * easeDist(u, len);
  const p = polar(b, P.patrolR);
  return { x: p.x, z: p.z, yaw: walkYaw(b), walking: true, station: -1, bearing: norm360(b) };
}

/** 巡走路線取樣（世界座標），給檢查與預覽畫線用 */
export function petMerchantPathSamples(stepM = 0.1): { x: number; z: number; bearing: number }[] {
  const P = PET_MERCHANT;
  const n = Math.ceil((2 * Math.PI * P.patrolR) / stepM);
  return Array.from({ length: n }, (_, i) => {
    const b = (360 * i) / n;
    return { ...polar(b, P.patrolR), bearing: b };
  });
}

/** 路線與所有障礙物的最小淨距（扣掉商人身體半徑）、與出生點／NPC 的最近距離（供測試與報告） */
export function petMerchantClearance(): {
  minCircleGap: number;
  nearestCircle: string;
  insideBox: boolean;
  minSpawnDist: number;
  minNpcDist: number;
  allStandable: boolean;
  stationAxisGapDeg: number;
} {
  const P = PET_MERCHANT;
  let minGap = Infinity;
  let nearest = "";
  let inBox = false;
  let minSpawn = Infinity;
  let minNpc = Infinity;
  let okStand = true;
  for (const p of petMerchantPathSamples(0.1)) {
    for (const c of CIRCLE_COLLIDERS) {
      const g = Math.hypot(p.x - c.x, p.z - c.z) - c.r - P.bodyR;
      if (g < minGap) {
        minGap = g;
        nearest = c.kind;
      }
    }
    if (BOX_COLLIDERS.some((b) => insideBox(b, p.x, p.z, P.bodyR))) inBox = true;
    for (const s of SPAWN_SLOTS) minSpawn = Math.min(minSpawn, Math.hypot(p.x - s.x, p.z - s.z));
    for (const n of NPC_SPOTS) minNpc = Math.min(minNpc, Math.hypot(p.x - n.x, p.z - n.z));
    if (!standable(p.x, p.z, P.bodyR)) okStand = false;
  }
  const axes = [...ROADS, ...STAIRS];
  let axisGap = Infinity;
  for (const s of P.stations) for (const a of axes) axisGap = Math.min(axisGap, Math.abs(((s - a + 540) % 360) - 180));
  return { minCircleGap: minGap, nearestCircle: nearest, insideBox: inBox, minSpawnDist: minSpawn, minNpcDist: minNpc, allStandable: okStand, stationAxisGapDeg: axisGap };
}

/** 玩家是否在互動範圍內 */
export function canTalkToPetMerchant(px: number, pz: number, t: number): boolean {
  const m = petMerchantPose(t);
  return Math.hypot(px - m.x, pz - m.z) <= PET_MERCHANT.interactR;
}

// ---------------- 與寵物系統連接的服務介面 ----------------

/** 可鑑定的物品種類（都由打怪掉落；對應寵物由寵物系統決定） */
export type PetItemKind = "seed" | "hatchEgg" | "birdEgg";
export const PET_ITEM_LABEL: Readonly<Record<PetItemKind, string>> = { seed: "種子", hatchEgg: "孵化蛋", birdEgg: "鳥蛋" };

export type PetServiceResult<T> = { ok: true; data: T } | { ok: false; reason: "unavailable" | "noItem" | "notEnoughGold" | "error"; message: string };

export interface PetItemRef {
  itemId: string;
  name: string;
  kind: PetItemKind;
}
export interface PetAppraisal {
  itemId: string;
  kind: PetItemKind;
  /** 鑑定出的屬性（名稱與數值文字由寵物系統提供） */
  lines: readonly { label: string; text: string; positive: boolean }[];
}
export interface FeedOffer {
  id: string;
  name: string;
  /** 價格由寵物系統／商店設定提供；這裡不定價 */
  price: number;
  description?: string;
}
export interface CareGuideEntry {
  title: string;
  body: string;
}

/** 寵物商人需要的功能（由寵物系統實作；畫面只透過這個介面呼叫） */
export interface PetMerchantService {
  /** false＝功能尚未開放（畫面顯示「準備中」） */
  readonly available: boolean;
  /** 背包中可鑑定的種子／孵化蛋／鳥蛋 */
  appraisableItems(kind: PetItemKind): Promise<PetServiceResult<readonly PetItemRef[]>>;
  /** 鑑定一個物品（費用、機率、結果全部由寵物系統決定） */
  appraise(itemId: string): Promise<PetServiceResult<PetAppraisal>>;
  /** 飼料商品列表 */
  feedOffers(): Promise<PetServiceResult<readonly FeedOffer[]>>;
  /** 購買飼料 */
  buyFeed(offerId: string, qty: number): Promise<PetServiceResult<{ bought: number }>>;
  /** 培育與進化說明 */
  careGuide(): Promise<PetServiceResult<readonly CareGuideEntry[]>>;
}

const NOT_READY = "寵物系統尚未開放，敬請期待。";
const unavailable = <T>(): Promise<PetServiceResult<T>> => Promise.resolve({ ok: false, reason: "unavailable", message: NOT_READY });

/** 占位服務：所有功能都回覆「準備中」，不產生任何鑑定結果、價格或機率 */
export const PLACEHOLDER_PET_MERCHANT_SERVICE: PetMerchantService = Object.freeze({
  available: false,
  appraisableItems: () => unavailable<readonly PetItemRef[]>(),
  appraise: () => unavailable<PetAppraisal>(),
  feedOffers: () => unavailable<readonly FeedOffer[]>(),
  buyFeed: () => unavailable<{ bought: number }>(),
  careGuide: () => unavailable<readonly CareGuideEntry[]>(),
});

let service: PetMerchantService = PLACEHOLDER_PET_MERCHANT_SERVICE;
/** 寵物系統接入點：傳入正式實作；傳 null 回到占位服務 */
export function connectPetMerchantService(s: PetMerchantService | null): void {
  service = s ?? PLACEHOLDER_PET_MERCHANT_SERVICE;
}
export function petMerchantService(): PetMerchantService {
  return service;
}

// ---------------- 對話選單狀態（畫面無關） ----------------

export type PetMenuScreen = "closed" | "root" | "appraiseKind" | "message";
export interface PetMenuState {
  screen: PetMenuScreen;
  /** message 畫面的標題與內容 */
  title?: string;
  lines?: readonly string[];
  /** message 畫面按「返回」回到哪裡 */
  back?: PetMenuScreen;
}
export type PetMenuOption = "appraise" | "feed" | "guide" | "leave";
export const PET_MENU_OPTIONS: readonly { id: PetMenuOption; label: string; hint: string }[] = [
  { id: "appraise", label: "鑑定寵物屬性", hint: "種子・孵化蛋・鳥蛋" },
  { id: "feed", label: "購買寵物飼料", hint: "飼料商店" },
  { id: "guide", label: "培育與進化資訊", hint: "照顧方式・進化條件" },
  { id: "leave", label: "離開", hint: "" },
];
export const PET_MERCHANT_GREETING = "歡迎！撿到種子或蛋了嗎？我可以幫你看看裡面藏著什麼樣的寵物喔。";

function resultLines<T>(r: PetServiceResult<T>, ok: (d: T) => readonly string[]): readonly string[] {
  return r.ok ? ok(r.data) : [r.message];
}

/** 選單動作（非同步動作會呼叫目前連接的服務） */
export async function petMenuStep(
  state: PetMenuState,
  action: { type: "open" } | { type: "close" } | { type: "back" } | { type: "choose"; option: PetMenuOption } | { type: "kind"; kind: PetItemKind },
  svc: PetMerchantService = service,
): Promise<PetMenuState> {
  switch (action.type) {
    case "open":
      return { screen: "root" };
    case "close":
      return { screen: "closed" };
    case "back":
      return state.screen === "message" && state.back ? { screen: state.back } : { screen: "root" };
    case "kind": {
      const r = await svc.appraisableItems(action.kind);
      return {
        screen: "message",
        title: `鑑定${PET_ITEM_LABEL[action.kind]}`,
        lines: resultLines(r, (items) => (items.length ? items.map((i) => `・${i.name}`) : [`背包裡沒有可以鑑定的${PET_ITEM_LABEL[action.kind]}。`])),
        back: "appraiseKind",
      };
    }
    case "choose":
      if (action.option === "leave") return { screen: "closed" };
      if (action.option === "appraise") return { screen: "appraiseKind" };
      if (action.option === "feed") {
        const r = await svc.feedOffers();
        return { screen: "message", title: "寵物飼料", lines: resultLines(r, (o) => (o.length ? o.map((x) => `・${x.name}　${x.price} 金幣`) : ["目前沒有飼料可以販售。"])), back: "root" };
      }
      {
        const r = await svc.careGuide();
        return { screen: "message", title: "培育與進化", lines: resultLines(r, (g) => g.map((e) => `【${e.title}】${e.body}`)), back: "root" };
      }
  }
  return state;
}
