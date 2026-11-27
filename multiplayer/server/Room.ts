/**
 * 權威房間（一張地圖的一個分流頻道）。不依賴 WebSocket，可直接單元測試；之後若改用 Colyseus，只要包一層 Room 外殼即可。
 *
 * 每個 tick：
 *   1. 依「時間預算」處理每位玩家排隊的輸入步驟（不會比真實時間快 → 加速外掛無效）
 *   2. 用與單機版相同的碰撞函式移動，並稽核位置是否合法
 *   3. 判定傳送陣（伺服器決定換地圖，不接受客戶端要求）
 *   4. 產生快照：只送有變動的玩家；新加入或要求重新同步的玩家送完整狀態
 */
import { INPUT_BUDGET_MAX_S, INPUT_QUEUE_MAX_STEPS, MOVE_SPEED, STEP } from "../shared/constants.ts";
import { ANIM, toCm, toMrad, type AnimCode, type Gender, type InputMsg, type MapId, type PlayerMeta, type PlayerTuple, type ServerMsg } from "../shared/protocol.ts";
import { getMap, type MapAuthority, type PortalRule } from "../shared/maps.ts";
import { stepMove, type MoveState } from "../shared/sim.ts";
import type { PlayerView, RoomSystem, RoomView } from "./extensions.ts";

export interface PlayerCounters {
  stepsApplied: number;
  stepsDropped: number;
  staleEpochInputs: number;
  duplicateSteps: number;
  seqGaps: number;
  illegalPositions: number;
  speedViolations: number;
}

export class ServerPlayer implements PlayerView {
  readonly pid: number;
  readonly characterId: string;
  readonly name: string;
  readonly gender: Gender;
  readonly state: MoveState;
  /** 資料庫版本（樂觀鎖） */
  version: number;
  lockEpoch: number;
  /** 地圖世代 */
  epoch = 0;
  connected = true;
  disconnectedAt = 0;
  /** 下一個期待的輸入序號、已處理到的序號 */
  nextSeq = 1;
  ack = 0;
  readonly queue: [number, number][] = [];
  budget = 0;
  idleTicks = 0;
  needFull = true;
  persistDirty = false;
  lastSent: PlayerTuple | null = null;
  readonly portalArmed = new Map<string, boolean>();
  readonly counters: PlayerCounters = { stepsApplied: 0, stepsDropped: 0, staleEpochInputs: 0, duplicateSteps: 0, seqGaps: 0, illegalPositions: 0, speedViolations: 0 };
  send: (m: ServerMsg) => void = () => {};

  constructor(o: { pid: number; characterId: string; name: string; gender: Gender; x: number; z: number; yaw: number; version: number; lockEpoch: number }) {
    this.pid = o.pid;
    this.characterId = o.characterId;
    this.name = o.name;
    this.gender = o.gender;
    this.state = { x: o.x, z: o.z, yaw: o.yaw, speed: 0, anim: ANIM.Idle };
    this.version = o.version;
    this.lockEpoch = o.lockEpoch;
  }

  get x(): number {
    return this.state.x;
  }
  get z(): number {
    return this.state.z;
  }
  get yaw(): number {
    return this.state.yaw;
  }

  tuple(): PlayerTuple {
    const s = this.state;
    return [this.pid, toCm(s.x), toCm(s.z), toMrad(s.yaw), s.anim, Math.round(s.speed * 100), this.connected ? 1 : 0];
  }
  meta(): PlayerMeta {
    return { id: this.pid, n: this.name, g: this.gender };
  }
  me(): [number, number, number, number] {
    const s = this.state;
    return [toCm(s.x), toCm(s.z), toMrad(s.yaw), s.anim];
  }

  /** 收到輸入封包：依序號排入佇列（重複的略過、舊地圖世代的丟棄） */
  enqueue(m: InputMsg): void {
    if (m.e !== this.epoch) {
      this.counters.staleEpochInputs++;
      return;
    }
    let seq = m.s;
    if (seq > this.nextSeq) {
      this.counters.seqGaps++;
      this.nextSeq = seq;
    }
    for (const [qx, qz, n] of m.d) {
      for (let i = 0; i < n; i++, seq++) {
        if (seq < this.nextSeq) {
          this.counters.duplicateSteps++;
          continue;
        }
        if (this.queue.length >= INPUT_QUEUE_MAX_STEPS) {
          this.counters.stepsDropped++;
        } else {
          this.queue.push([qx, qz]);
        }
        this.nextSeq = seq + 1;
      }
    }
  }
}

export interface TransferRequest {
  player: ServerPlayer;
  to: PortalRule["to"];
}

const sameTuple = (a: PlayerTuple | null, b: PlayerTuple): boolean => !!a && a.every((v, i) => v === b[i]);

export class Room implements RoomView {
  readonly key: string;
  readonly map: MapId;
  readonly auth: MapAuthority;
  readonly capacity: number;
  tick = 0;
  private readonly byPid = new Map<number, ServerPlayer>();
  private readonly gone: number[] = [];
  private readonly added: ServerPlayer[] = [];
  readonly systems: RoomSystem[] = [];

  constructor(key: string, map: MapId, capacity: number) {
    this.key = key;
    this.map = map;
    this.auth = getMap(map);
    this.capacity = capacity;
  }

  get size(): number {
    return this.byPid.size;
  }
  players(): Iterable<ServerPlayer> {
    return this.byPid.values();
  }
  get(pid: number): ServerPlayer | undefined {
    return this.byPid.get(pid);
  }

  add(p: ServerPlayer): void {
    this.byPid.set(p.pid, p);
    this.added.push(p);
    p.needFull = true;
    p.lastSent = null;
    p.portalArmed.clear();
    for (const r of this.auth.portals) p.portalArmed.set(r.id, Math.hypot(p.x - r.x, p.z - r.z) > r.triggerR);
    for (const s of this.systems) s.onPlayerJoin?.(this, p);
  }

  remove(pid: number): ServerPlayer | undefined {
    const p = this.byPid.get(pid);
    if (!p) return undefined;
    this.byPid.delete(pid);
    this.gone.push(pid);
    const ai = this.added.indexOf(p);
    if (ai >= 0) this.added.splice(ai, 1);
    for (const s of this.systems) s.onPlayerLeave?.(this, p);
    return p;
  }

  /** 推進一個 tick；回傳本 tick 需要換地圖的玩家 */
  step(dt: number, now: number): TransferRequest[] {
    this.tick++;
    const transfers: TransferRequest[] = [];
    // 每 tick 最多處理的步數：真實時間的 1.34 倍（抖動後慢慢追上，不會瞬間爆衝）
    const maxSteps = Math.ceil((dt / STEP) * 1.34) + 1;
    for (const p of this.byPid.values()) {
      p.budget = Math.min(INPUT_BUDGET_MAX_S, p.budget + dt);
      const x0 = p.state.x;
      const z0 = p.state.z;
      let n = 0;
      while (p.queue.length > 0 && p.budget >= STEP - 1e-9 && n < maxSteps) {
        const [qx, qz] = p.queue.shift()!;
        stepMove(p.state, qx, qz, this.auth);
        p.budget -= STEP;
        p.ack++;
        n++;
        p.counters.stepsApplied++;
        const portal = this.checkPortals(p);
        if (portal) {
          transfers.push({ player: p, to: portal.to });
          break;
        }
      }
      if (n === 0) {
        p.idleTicks++;
        if (p.idleTicks >= 2) {
          p.state.speed = 0;
          p.state.anim = ANIM.Idle as AnimCode;
        }
      } else {
        p.idleTicks = 0;
        p.persistDirty = true;
      }
      // 量化（與傳給客戶端的值一致，客戶端從這個值重播預測）
      p.state.x = Math.round(p.state.x * 100) / 100;
      p.state.z = Math.round(p.state.z * 100) / 100;
      p.state.yaw = Math.round(p.state.yaw * 1000) / 1000;
      // 稽核：移動距離不可超過速度上限；位置必須在合法區域
      const moved = Math.hypot(p.state.x - x0, p.state.z - z0);
      if (moved > MOVE_SPEED * n * STEP + 0.02) p.counters.speedViolations++;
      if (n > 0 && !this.auth.legal(p.state.x, p.state.z) && this.auth.legal(x0, z0)) {
        p.counters.illegalPositions++;
        p.state.x = x0;
        p.state.z = z0;
      }
    }
    for (const s of this.systems) s.tick?.(this, dt);
    void now;
    return transfers;
  }

  private checkPortals(p: ServerPlayer): PortalRule | null {
    for (const r of this.auth.portals) {
      const d = Math.hypot(p.state.x - r.x, p.state.z - r.z);
      const armed = p.portalArmed.get(r.id) ?? true;
      if (!armed) {
        if (d > r.armR) p.portalArmed.set(r.id, true);
        continue;
      }
      if (d <= r.triggerR) return r;
    }
    return null;
  }

  /** 產生並送出本 tick 的快照 */
  broadcast(now: number): void {
    const changed: PlayerTuple[] = [];
    const all: PlayerTuple[] = [];
    for (const p of this.byPid.values()) {
      const t = p.tuple();
      all.push(t);
      if (!sameTuple(p.lastSent, t)) changed.push(t);
      p.lastSent = t;
    }
    const addMeta = this.added.map((p) => p.meta());
    const gone = this.gone.splice(0);
    this.added.length = 0;
    const metaAll = [...this.byPid.values()].map((p) => p.meta());
    for (const p of this.byPid.values()) {
      if (!p.connected) continue;
      const full = p.needFull;
      const list = (full ? all : changed).filter((t) => t[0] !== p.pid);
      const add = (full ? metaAll : addMeta).filter((m) => m.id !== p.pid);
      p.send({
        t: "snap",
        tick: this.tick,
        st: now,
        ack: p.ack,
        me: p.me(),
        p: list,
        ...(add.length ? { add } : {}),
        ...(gone.length && !full ? { gone } : {}),
        ...(full ? { full: 1 as const } : {}),
      });
      p.needFull = false;
    }
  }
}
