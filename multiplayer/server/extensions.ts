/**
 * Stage 8.1+ 預留介面（本階段只定義介面＋一個無害的示範指令，不實作戰鬥、怪物、背包、寵物）。
 *
 * 所有會改變遊戲資產的動作都必須：
 *   1. 經由 RoomSystem.onCommand 進入（客戶端只送「我要做什麼」，不送結果數值）
 *   2. 帶 requestId，由 RequestLedger 防重送
 *   3. 在伺服器用伺服器端的角色資料計算（傷害、掉落、金幣都不採用客戶端數值）
 *   4. 寫入資料庫時與 request_ledger 在同一個交易內完成，並檢查 version
 */
import type { MapId } from "../shared/protocol.ts";

export interface PlayerView {
  readonly pid: number;
  readonly characterId: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

export interface RoomView {
  readonly key: string;
  readonly map: MapId;
  readonly tick: number;
  players(): Iterable<PlayerView>;
}

export interface CommandContext {
  room: RoomView;
  player: PlayerView;
  requestId: string;
  now: number;
}

export type CommandResult = { ok: true; data?: unknown } | { ok: false; err: string };

/** 房間系統：戰鬥、怪物 AI、掉落、寵物跟隨都以系統的方式掛進房間 */
export interface RoomSystem {
  readonly name: string;
  /** 這個系統處理的指令種類（白名單） */
  readonly commands: readonly string[];
  tick?(room: RoomView, dt: number): void;
  onCommand?(kind: string, payload: unknown, ctx: CommandContext): CommandResult;
  onPlayerJoin?(room: RoomView, p: PlayerView): void;
  onPlayerLeave?(room: RoomView, p: PlayerView): void;
}

// -------- 以下為 Stage 8.1～8.5 的介面草案（尚未實作） --------

/** 8.2 戰鬥：伺服器用自己的角色能力值與 fieldRules 判定命中與傷害 */
export interface CombatAuthority extends RoomSystem {
  requestAttack(ctx: CommandContext, targetId: number): CommandResult;
}

/** 8.2 怪物 AI：伺服器執行 monsterAI，快照同步怪物位置／動畫／血量 */
export interface MonsterAuthority extends RoomSystem {
  spawnTable(map: MapId): readonly { monsterId: string; count: number }[];
}

/** 8.3 背包：所有道具有 UUID；轉移／消耗在資料庫交易內完成 */
export interface InventoryAuthority {
  grant(characterId: string, defId: string, qty: number, requestId: string): Promise<CommandResult>;
  consume(characterId: string, itemUid: string, qty: number, requestId: string, expectedVersion: number): Promise<CommandResult>;
}

/** 8.4 寵物：鑑定結果在伺服器產生並永久固定（方案 A） */
export interface PetAuthority {
  appraise(characterId: string, itemUid: string, requestId: string): Promise<CommandResult>;
}

/** 8.5 地圖分流：決定玩家進入哪一個頻道（房間） */
export interface ShardRouter {
  pick(map: MapId, characterId: string): string;
}

/** 示範系統：「揮手」指令（無資產異動），用來驗證指令管線與重送防護 */
export function createEmoteSystem(): RoomSystem & { executed: number } {
  const sys = {
    name: "emote",
    commands: ["emote"] as const,
    executed: 0,
    onCommand(kind: string, payload: unknown, ctx: CommandContext): CommandResult {
      const e = typeof payload === "object" && payload ? (payload as { e?: unknown }).e : undefined;
      if (e !== "wave" && e !== "cheer") return { ok: false, err: "bad_emote" };
      sys.executed++;
      return { ok: true, data: { e, pid: ctx.player.pid, tick: ctx.room.tick } };
    },
  };
  return sys;
}
