/**
 * Stage 8.0 多人連線共用常數（伺服器與客戶端共用同一份）。
 * 移動速度、轉身速度直接讀取單機版已驗收的 TUNING（唯讀引用，不修改正式數值）。
 */
import { TUNING } from "../../src/config/tuning.ts";

/** 協定版本：客戶端與伺服器不同時，伺服器拒絕連線並要求重新整理 */
export const PROTOCOL_VERSION = 2;

/** 固定模擬步長：客戶端預測與伺服器重算使用完全相同的步長 */
export const SIM_HZ = 60;
export const STEP = 1 / SIM_HZ;

/** 伺服器每秒模擬次數與快照次數 */
export const TICK_HZ = 20;
export const SNAPSHOT_HZ = 20;

/** 客戶端送出輸入的間隔（毫秒） */
export const INPUT_SEND_MS = 50;

/** 移動速度（公尺／秒）＝單機版 TUNING.player.moveSpeed（5 m/s，正式數值，不在此變更） */
export const MOVE_SPEED = TUNING.player.moveSpeed;
export const TURN_SHARPNESS = TUNING.player.turnSharpness;
/** 搖桿推動量低於此值不移動（與單機版相同 0.05） */
export const MOVE_DEADZONE = 0.05;

/** 輸入時間預算：伺服器最多累積的「可模擬秒數」（網路抖動後追趕用） */
export const INPUT_BUDGET_MAX_S = 0.5;
/** 每位玩家最多排隊的模擬步數（2 秒），超過的輸入丟棄並記錄 */
export const INPUT_QUEUE_MAX_STEPS = SIM_HZ * 2;
/** 單一封包最多的步數 */
export const MAX_STEPS_PER_MSG = 60;

/** 斷線後角色保留時間（毫秒），期間內重新連線直接接回原角色 */
export const RECONNECT_GRACE_MS = 30_000;

/** 遠端玩家插值延遲（毫秒） */
export const INTERP_DELAY_MS = 100;
/** 遠端玩家最多外插時間（毫秒） */
export const EXTRAPOLATE_MAX_MS = 200;

/** 預測誤差超過此距離直接瞬移校正，不做平滑（公尺） */
export const SNAP_CORRECTION_M = 2;

/** 單一房間（地圖分流頻道）人數上限 */
export const ROOM_CAPACITY = 50;

/** WebSocket 單一訊息大小上限（位元組） */
export const MAX_MESSAGE_BYTES = 8 * 1024;
