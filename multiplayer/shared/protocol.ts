/**
 * Stage 8.0 多人連線協定（JSON over WebSocket / WSS）。
 *
 * 原則：伺服器是最終權威。客戶端只送「輸入」（方向＋步數），從不送位置、速度、傷害、金幣、道具或能力值。
 * 位置以公分整數、朝向以千分之一弧度整數傳送，減少封包大小。
 */
export type MapId = "village" | "starsprout";
export type Gender = "male" | "female";

/** 角色外觀（與單機版 gameSave.ts 的 Appearance 相同欄位；伺服器用 parseAppearance 驗證，不合法值回到預設） */
export interface AppearanceWire {
  hair: string;
  hairColor: string | null;
  weapon: "sword" | "staff";
}

/** 動作事件（純外觀同步；Stage 8.2 前戰鬥仍在各自客戶端，伺服器不採用任何傷害或血量數值） */
export type ActKind = "attack" | "hurt" | "death";

/** 動畫代碼：0 Idle、1 Run；2 以後保留給 Stage 8.1+（Attack／Hurt／Death／Jump） */
export const ANIM = Object.freeze({ Idle: 0, Run: 1, Attack: 2, Hurt: 3, Death: 4, Jump: 5 });
export type AnimCode = (typeof ANIM)[keyof typeof ANIM];
export const ANIM_NAME: readonly string[] = ["Idle", "Run", "Attack", "Hurt", "Death", "Jump"];

/** 一段相同方向的輸入：[方向 x（-127..127）, 方向 z（-127..127）, 步數] */
export type InputRun = [number, number, number];

// ---------------- 客戶端 → 伺服器 ----------------
export interface HelloMsg {
  t: "hello";
  v: number;
  name?: string;
  gender?: Gender;
  /** 重新連線用的工作階段憑證 */
  resume?: string;
  /** 只有伺服器開啟開發模式時才接受（測試直接出生在原野） */
  devMap?: MapId;
  /** 新角色的外觀（只在建立角色時採用；之後以伺服器資料為準） */
  ap?: AppearanceWire;
}
export interface InputMsg {
  t: "in";
  /** 地圖世代：換地圖後遞增；伺服器丟棄舊地圖世代的輸入 */
  e: number;
  /** 這個封包第一步的序號 */
  s: number;
  d: InputRun[];
}
export interface PingMsg {
  t: "ping";
  c: number;
}
/** 需要防重送的指令（Stage 8.1+ 的攻擊、撿取、使用道具都走這裡） */
export interface CmdMsg {
  t: "cmd";
  id: string;
  k: string;
  p?: unknown;
}
export interface ResyncMsg {
  t: "resync";
}
/** 動作：攻擊／受擊／倒地（y＝當下朝向，毫弧度；只用於顯示） */
export interface ActMsg {
  t: "act";
  k: ActKind;
  y?: number;
}
/** 與洛恩對話中（h=1，對話期間每 3 秒重送）／結束（h=0）：伺服器決定洛恩是否停下、面向誰 */
export interface RoanMsg {
  t: "roan";
  h: 0 | 1;
}
export type ClientMsg = HelloMsg | InputMsg | PingMsg | CmdMsg | ResyncMsg | ActMsg | RoanMsg;

// ---------------- 伺服器 → 客戶端 ----------------
/** 玩家固定資料（只在加入或完整同步時送） */
export interface PlayerMeta {
  id: number;
  n: string;
  g: Gender;
  ap: AppearanceWire;
}
/** 玩家動態狀態：[id, x 公分, z 公分, yaw 毫弧度, 動畫, 速度 公分/秒, 連線中 1/0, 單次動作代碼, 單次動作序號] */
export type PlayerTuple = [number, number, number, number, number, number, number, number, number];

export interface WelcomeMsg {
  t: "welcome";
  v: number;
  pid: number;
  cid: string;
  token: string;
  map: MapId;
  room: string;
  resumed: boolean;
  /** 伺服器儲存的角色外觀與性別（以此為準） */
  g: Gender;
  ap: AppearanceWire;
  name: string;
  /** 伺服器資料區（test／prod）；測試伺服器一律為 test */
  realm: string;
  tick: number;
  st: number;
  /** 地圖世代 */
  e: number;
  /** 伺服器已處理到的輸入序號（重新連線時，客戶端重送序號大於此值的輸入） */
  ack: number;
  /** 自己目前的權威狀態 [x 公分, z 公分, yaw 毫弧度, 動畫] */
  me: [number, number, number, number];
  cfg: { step: number; tickHz: number; snapHz: number; speed: number; graceMs: number };
}
export interface SnapMsg {
  t: "snap";
  tick: number;
  /** 伺服器時間（毫秒） */
  st: number;
  /** 已處理到的輸入序號 */
  ack: number;
  /** 自己：[x 公分, z 公分, yaw 毫弧度, 動畫]；倒地中動畫為 Death */
  me: [number, number, number, number];
  /** 有變動的玩家（full=1 時為房間內全部玩家，自己除外） */
  p: PlayerTuple[];
  add?: PlayerMeta[];
  gone?: number[];
  full?: 1;
  /** 星芽村：洛恩巡邏狀態 [巡邏時間 毫秒（於 st）, 暫停中 1/0, 面向目標 x 公分, z 公分] */
  roan?: [number, number, number, number];
}
export interface MapChangeMsg {
  t: "map";
  map: MapId;
  room: string;
  /** 新的地圖世代 */
  e: number;
  /** 傳送前最後處理的輸入序號；之後的舊地圖輸入全部作廢 */
  ack: number;
  me: [number, number, number, number];
}
export interface PongMsg {
  t: "pong";
  c: number;
  s: number;
}
export interface CmdResultMsg {
  t: "res";
  id: string;
  ok: boolean;
  data?: unknown;
  err?: string;
  /** 1 = 這是重送請求，回傳的是第一次的結果，沒有重新執行 */
  dup?: 1;
}
export interface ErrorMsg {
  t: "err";
  code: "proto" | "bad_msg" | "rate" | "full" | "auth" | "replaced" | "server";
  msg: string;
}
export type ServerMsg = WelcomeMsg | SnapMsg | MapChangeMsg | PongMsg | CmdResultMsg | ErrorMsg;

// ---------------- 量化 ----------------
export const toCm = (m: number): number => Math.round(m * 100);
export const fromCm = (cm: number): number => cm / 100;
export const toMrad = (r: number): number => Math.round(r * 1000);
export const fromMrad = (m: number): number => m / 1000;

/** 方向量化成 -127..127 的整數；長度超過 1 先正規化（斜向不加速） */
export function quantizeDir(x: number, z: number): [number, number] {
  const l = Math.hypot(x, z);
  const s = l > 1 ? 1 / l : 1;
  return [Math.round(x * s * 127), Math.round(z * s * 127)];
}
export function dequantizeDir(qx: number, qz: number): { x: number; z: number } {
  let x = qx / 127;
  let z = qz / 127;
  const l = Math.hypot(x, z);
  if (l > 1) {
    x /= l;
    z /= l;
  }
  return { x, z };
}
