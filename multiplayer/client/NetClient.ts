/**
 * Stage 8.0 多人連線客戶端（瀏覽器與 Node 22 都能用，只依賴標準 WebSocket）。
 *
 * 本地玩家：客戶端預測＋伺服器校正
 *   每 1/60 秒產生一步輸入 → 立刻用與伺服器相同的 stepMove 預測 → 每 50 ms 打包送出
 *   收到快照：從伺服器權威位置重播「伺服器還沒處理的輸入」，誤差以平滑偏移消化（> 2 m 直接校正）
 * 遠端玩家：Interpolator 以伺服器時間 − 100 ms 平滑插值
 * 斷線：自動重連（0.5→1→2→4→8 秒），帶憑證接回原角色，收到完整快照即完成重新同步，未送達的輸入會重送
 */
import { INPUT_SEND_MS, INTERP_DELAY_MS, MAX_STEPS_PER_MSG, MOVE_DEADZONE, PROTOCOL_VERSION, SNAP_CORRECTION_M, STEP } from "../shared/constants.ts";
import { ANIM, MON_STATES, fromCm, fromMrad, quantizeDir, type CombatEvent, type InvMsg, type TradeMsg, type ActKind, type AppearanceWire, type Gender, type MapId, type PlayerMeta, type ServerMsg, type SnapMsg } from "../shared/protocol.ts";
import { getMap, type MapAuthority } from "../shared/maps.ts";
import { runLength, stepMove, type MoveState } from "../shared/sim.ts";
import { Interpolator, type Pose } from "./Interpolator.ts";

export type ConnState = "idle" | "connecting" | "online" | "reconnecting" | "offline";

export interface NetClientOptions {
  url: string;
  name?: string;
  gender?: Gender;
  devMap?: MapId;
  /** 新角色外觀（只在伺服器建立角色時採用） */
  ap?: AppearanceWire;
  /** 測試用：人為延遲（單程，毫秒）與抖動 */
  lagMs?: number;
  jitterMs?: number;
  resumeToken?: string;
  /** Stage 8.5：帳號登入憑證（/auth/login）與要使用的角色 id */
  auth?: string;
  cid?: string;
  autoReconnect?: boolean;
  now?: () => number;
  WebSocketImpl?: typeof WebSocket;
  onEvent?: (e: NetEvent) => void;
  /** Stage 8.2：伺服器戰鬥事件（施放、命中、死亡、掉落…）；st＝事件所在快照的伺服器時間（毫秒） */
  onCombat?: (e: CombatEvent, st: number) => void;
}

/** 伺服器的怪物（已插值）。狀態、血量、攻擊序號、受擊序號都以伺服器為準 */
export interface RemoteMonster {
  nid: number;
  instanceId: string;
  monsterId: string;
  maxHp: number;
  x: number;
  z: number;
  yaw: number;
  hp: number;
  state: (typeof MON_STATES)[number];
  attackId: number;
  hitSeq: number;
  targetPid: number;
}

export interface ServerLoot {
  uid: string;
  defId: string;
  qty: number;
  x: number;
  z: number;
  ownerPid: number;
  ownerUntil: number;
  expiresAt: number;
}

/** 伺服器保存的本人戰鬥數值（ps）。客戶端只顯示，不計算 */
export interface SelfStats {
  hp: number;
  maxHp: number;
  level: number;
  exp: number;
  expNext: number;
  gold: number;
  down: boolean;
}

export type NetEvent =
  | { type: "welcome"; resumed: boolean; pid: number; map: MapId }
  | { type: "resynced"; ms: number }
  | { type: "map"; map: MapId }
  | { type: "state"; state: ConnState }
  | { type: "error"; code: string; msg: string }
  | { type: "cmd"; id: string; ok: boolean; dup: boolean; data?: unknown; err?: string }
  | { type: "trade"; msg: TradeMsg };

export interface RemotePlayer extends Pose {
  id: number;
  name: string;
  gender: Gender;
  ap: AppearanceWire;
  /** 單次動作（Attack／Hurt）代碼與序號：序號改變＝播放一次 */
  act: number;
  actSeq: number;
}

export interface NetStats {
  state: ConnState;
  map: MapId | null;
  room: string;
  pid: number;
  rttMs: number;
  rttAvgMs: number;
  jitterMs: number;
  bytesUpPerSec: number;
  bytesDownPerSec: number;
  msgsUpPerSec: number;
  msgsDownPerSec: number;
  snapsPerSec: number;
  players: number;
  pendingInputs: number;
  corrections: number;
  lastCorrectionCm: number;
  maxCorrectionCm: number;
  snapCorrections: number;
  reconnects: number;
  lastResyncMs: number;
  serverTick: number;
  fps: number;
  totalBytesUp: number;
  totalBytesDown: number;
}

interface PendingStep {
  seq: number;
  qx: number;
  qz: number;
}

const BACKOFF = [500, 1000, 2000, 4000, 8000];
const enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
const byteLen = (s: string): number => (enc ? enc.encode(s).length : s.length);

export class NetClient {
  readonly opts: NetClientOptions;
  private ws: WebSocket | null = null;
  private readonly now: () => number;
  state: ConnState = "idle";
  token: string | null;
  pid = 0;
  characterId = "";
  gender: Gender = "male";
  appearance: AppearanceWire = { hair: "hair01", hairColor: null, weapon: "sword" };
  name = "";
  realm = "";
  /** 伺服器說目前倒地中 */
  down = false;
  /** 洛恩巡邏狀態（伺服器）：巡邏時間 秒（於 at 伺服器毫秒）、暫停中、面向目標 */
  roan: { patrolT: number; at: number; paused: boolean; tx: number; tz: number } | null = null;
  map: MapAuthority | null = null;
  room = "";
  private epoch = 0;
  private seq = 0;
  private sentUpTo = 0;
  private pending: PendingStep[] = [];
  private acc = 0;
  private lastSend = 0;
  private lastPing = 0;
  /** 預測後的本地狀態（伺服器座標） */
  readonly local: MoveState = { x: 0, z: 0, yaw: 0, speed: 0, anim: ANIM.Idle };
  /** 最新伺服器權威位置（偵錯顯示用） */
  readonly server = { x: 0, z: 0, yaw: 0 };
  /** 校正平滑偏移：畫面位置 = local + offset，offset 逐漸歸零 */
  private offX = 0;
  private offZ = 0;
  private readonly metas = new Map<number, PlayerMeta>();
  private readonly monMeta = new Map<number, { instanceId: string; monsterId: string; maxHp: number }>();
  private readonly monBuf = new Map<number, { buf: Interpolator; hp: number; state: number; attackId: number; hitSeq: number; target: number }>();
  readonly loot = new Map<string, ServerLoot>();
  self: SelfStats | null = null;
  inventory: InvMsg | null = null;
  /** 收到的戰鬥事件總數（偵錯） */
  combatEvents = 0;
  private readonly remoteBuf = new Map<number, Interpolator>();
  private clockOff: number[] = [];
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectedAt = 0;
  private awaitingResync = false;
  private closedByUser = false;
  private noReconnect = false;
  private reqCounter = 0;
  private win = { at: 0, up: 0, down: 0, mu: 0, md: 0, snaps: 0 };
  readonly stats: NetStats = {
    state: "idle", map: null, room: "", pid: 0, rttMs: 0, rttAvgMs: 0, jitterMs: 0, bytesUpPerSec: 0, bytesDownPerSec: 0, msgsUpPerSec: 0, msgsDownPerSec: 0,
    snapsPerSec: 0, players: 0, pendingInputs: 0, corrections: 0, lastCorrectionCm: 0, maxCorrectionCm: 0, snapCorrections: 0, reconnects: 0, lastResyncMs: 0, serverTick: 0, fps: 0, totalBytesUp: 0, totalBytesDown: 0,
  };

  constructor(opts: NetClientOptions) {
    this.opts = opts;
    this.now = opts.now ?? (() => performance.now());
    this.token = opts.resumeToken ?? null;
  }

  // ---------------- 連線 ----------------
  connect(): void {
    this.closedByUser = false;
    this.setState(this.state === "reconnecting" ? "reconnecting" : "connecting");
    const WS = this.opts.WebSocketImpl ?? WebSocket;
    const ws = new WS(this.opts.url);
    this.ws = ws;
    ws.onopen = () => {
      this.sendRaw({ t: "hello", v: PROTOCOL_VERSION, name: this.opts.name, gender: this.opts.gender, ...(this.opts.ap ? { ap: this.opts.ap } : {}), ...(this.opts.auth ? { auth: this.opts.auth, ...(this.characterId || this.opts.cid ? { cid: this.characterId || this.opts.cid } : {}) } : this.token ? { resume: this.token } : {}), ...(this.opts.devMap ? { devMap: this.opts.devMap } : {}) });
    };
    ws.onmessage = (ev: MessageEvent) => {
      const s = typeof ev.data === "string" ? ev.data : String(ev.data);
      this.win.down += byteLen(s);
      this.stats.totalBytesDown += byteLen(s);
      this.win.md++;
      const handle = () => this.onMessage(JSON.parse(s) as ServerMsg);
      this.delayed(handle);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closedByUser || this.noReconnect || this.opts.autoReconnect === false) {
        this.setState("offline");
        return;
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {};
  }

  private scheduleReconnect(): void {
    if (this.state !== "reconnecting") this.disconnectedAt = this.now();
    this.setState("reconnecting");
    const d = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)]!;
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.stats.reconnects++;
      this.connect();
    }, d);
  }

  /** 測試用：直接切斷連線（模擬手機網路中斷），之後自動重連 */
  dropConnection(): void {
    this.ws?.close();
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.setState("offline");
  }

  private setState(s: ConnState): void {
    if (this.state === s) return;
    this.state = s;
    this.stats.state = s;
    this.opts.onEvent?.({ type: "state", state: s });
  }

  private delayed(fn: () => void): void {
    const lag = this.opts.lagMs ?? 0;
    if (lag <= 0) return fn();
    const j = this.opts.jitterMs ?? 0;
    // 保持順序：抖動只往後延，不會讓訊息互相超車
    const at = Math.max(this.lastDelayAt, this.now() + lag + Math.random() * j);
    this.lastDelayAt = at;
    setTimeout(fn, at - this.now());
  }
  private lastDelayAt = 0;
  private lastSendDelayAt = 0;

  private sendRaw(m: object): void {
    const s = JSON.stringify(m);
    const ws = this.ws;
    const go = (): void => {
      if (ws && ws.readyState === 1) ws.send(s);
    };
    this.win.up += byteLen(s);
    this.stats.totalBytesUp += byteLen(s);
    this.win.mu++;
    const lag = this.opts.lagMs ?? 0;
    if (lag <= 0) return go();
    const at = Math.max(this.lastSendDelayAt, this.now() + lag + Math.random() * (this.opts.jitterMs ?? 0));
    this.lastSendDelayAt = at;
    setTimeout(go, at - this.now());
  }

  /** Stage 8.5：技能位移期間暫停移動輸入（毫秒）；位移終點由伺服器決定 */
  private holdUntil = 0;
  holdInput(ms: number): void {
    this.holdUntil = Math.max(this.holdUntil, this.now() + Math.max(0, Math.min(ms, 5000)));
  }

  // ---------------- 每幀更新 ----------------
  /** inputX / inputZ：世界座標方向（長度 0..1，與單機版 inputToWorld 的輸出相同） */
  update(dt: number, inputX: number, inputZ: number): void {
    const t = this.now();
    if (this.state === "online" && this.map) {
      this.acc = Math.min(this.acc + dt, 0.25);
      // Stage 8.5 技能位移中：自己不預測移動（位置由伺服器驗證的路徑決定，經由快照平滑追上）
      const held = t < this.holdUntil;
      const [qx, qz] = held ? [0, 0] : quantizeDir(inputX, inputZ);
      const moving = Math.hypot(qx / 127, qz / 127) > MOVE_DEADZONE;
      while (this.acc >= STEP) {
        this.acc -= STEP;
        if (moving) {
          this.seq++;
          this.pending.push({ seq: this.seq, qx, qz });
          stepMove(this.local, qx, qz, this.map);
        }
      }
      if (!moving) {
        this.local.speed = 0;
        this.local.anim = ANIM.Idle;
      }
      if (t - this.lastSend >= INPUT_SEND_MS) this.flush(t);
      if (t - this.lastPing >= 1000) {
        this.lastPing = t;
        this.sendRaw({ t: "ping", c: t });
      }
    }
    // 校正偏移逐漸歸零（約 0.1 秒）
    const k = Math.exp(-12 * dt);
    this.offX *= k;
    this.offZ *= k;
    if (t - this.win.at >= 1000) {
      const s = (t - this.win.at) / 1000;
      Object.assign(this.stats, {
        bytesUpPerSec: Math.round(this.win.up / s), bytesDownPerSec: Math.round(this.win.down / s), msgsUpPerSec: Math.round(this.win.mu / s), msgsDownPerSec: Math.round(this.win.md / s), snapsPerSec: Math.round(this.win.snaps / s),
      });
      this.win = { at: t, up: 0, down: 0, mu: 0, md: 0, snaps: 0 };
    }
    this.stats.pendingInputs = this.pending.length;
  }

  private flush(t: number): void {
    this.lastSend = t;
    const unsent = this.pending.filter((p) => p.seq > this.sentUpTo);
    for (let i = 0; i < unsent.length; i += MAX_STEPS_PER_MSG) {
      const chunk = unsent.slice(i, i + MAX_STEPS_PER_MSG);
      this.sendRaw({ t: "in", e: this.epoch, s: chunk[0]!.seq, d: runLength(chunk.map((p) => [p.qx, p.qz] as [number, number])) });
      this.sentUpTo = chunk[chunk.length - 1]!.seq;
    }
  }

  /** 畫面上的本地玩家位置（含校正平滑） */
  get renderPos(): { x: number; z: number; yaw: number; anim: number } {
    return { x: this.local.x + this.offX, z: this.local.z + this.offZ, yaw: this.local.yaw, anim: this.local.anim };
  }

  /** 伺服器的怪物（位置以伺服器時間 − 100 ms 插值；狀態用最新值） */
  monsters(): RemoteMonster[] {
    const off = this.clockOff.length ? Math.max(...this.clockOff) : 0;
    const rt = this.now() + off - INTERP_DELAY_MS;
    const out: RemoteMonster[] = [];
    for (const [nid, b] of this.monBuf) {
      const meta = this.monMeta.get(nid);
      const pose = b.buf.sample(rt);
      if (!meta || !pose) continue;
      out.push({ nid, ...meta, x: pose.x, z: pose.z, yaw: pose.yaw, hp: b.hp, state: MON_STATES[b.state] ?? "idle", attackId: b.attackId, hitSeq: b.hitSeq, targetPid: b.target });
    }
    return out;
  }

  /** 遠端玩家（已插值） */
  remotes(): RemotePlayer[] {
    const off = this.clockOff.length ? Math.max(...this.clockOff) : 0;
    const rt = this.now() + off - INTERP_DELAY_MS;
    const out: RemotePlayer[] = [];
    for (const [id, buf] of this.remoteBuf) {
      const pose = buf.sample(rt);
      const m = this.metas.get(id);
      const lt = buf.latest;
      if (pose && m) out.push({ id, name: m.n, gender: m.g, ap: m.ap, ...pose, act: lt?.act ?? 0, actSeq: lt?.actSeq ?? 0 });
    }
    return out;
  }

  /** 送出需要防重送的指令；回傳 requestId（重送時用同一個 id） */
  command(kind: string, payload?: unknown, requestId?: string): string {
    const id = requestId ?? `${this.pid.toString(36)}_${Date.now().toString(36)}_${(this.reqCounter++).toString(36)}`.padEnd(8, "0");
    this.sendRaw({ t: "cmd", id, k: kind, p: payload });
    return id;
  }

  /** 動作事件（攻擊／受擊／倒地）：只用於讓其他玩家看到動畫 */
  act(k: ActKind, yaw?: number): void {
    if (this.state !== "online") return;
    const y = yaw === undefined ? undefined : Math.round(Math.atan2(Math.sin(yaw), Math.cos(yaw)) * 1000);
    this.sendRaw({ t: "act", k, ...(y !== undefined ? { y } : {}) });
  }

  /** 估計的伺服器時間（毫秒）：洛恩巡邏等「依伺服器時間決定」的畫面用 */
  serverNow(): number {
    const off = this.clockOff.length ? Math.max(...this.clockOff) : 0;
    return this.now() + off;
  }

  /** 洛恩目前的巡邏時間（秒）：伺服器狀態＋經過時間（暫停中不前進） */
  roanPatrolTime(): number | null {
    const r = this.roan;
    if (!r) return null;
    return r.paused ? r.patrolT : r.patrolT + (this.serverNow() - r.at) / 1000;
  }

  roanHold(hold: boolean): void {
    if (this.state === "online") this.sendRaw({ t: "roan", h: hold ? 1 : 0 });
  }

  requestResync(): void {
    this.sendRaw({ t: "resync" });
  }

  // ---------------- 訊息處理 ----------------
  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case "welcome": {
        const reconnecting = this.state === "reconnecting";
        this.token = m.token;
        this.pid = m.pid;
        this.characterId = m.cid;
        this.gender = m.g;
        this.appearance = m.ap;
        this.name = m.name;
        this.realm = m.realm;
        this.epoch = m.e;
        this.setMap(m.map, m.room);
        // 伺服器已處理到 m.ack：更早的輸入丟掉，之後的全部重送
        if (!m.resumed) {
          this.pending = [];
          this.seq = m.ack;
        } else {
          this.pending = this.pending.filter((p) => p.seq > m.ack);
        }
        this.sentUpTo = m.ack;
        this.applyAuthoritative(m.me, m.ack, true);
        this.metas.clear();
        this.remoteBuf.clear();
        this.clearCombat();
        this.attempt = 0;
        this.awaitingResync = reconnecting;
        this.setState("online");
        this.stats.pid = m.pid;
        this.opts.onEvent?.({ type: "welcome", resumed: m.resumed, pid: m.pid, map: m.map });
        return;
      }
      case "snap":
        return this.onSnap(m);
      case "map": {
        this.roan = null;
        this.epoch = m.e;
        this.pending = [];
        this.seq = m.ack;
        this.sentUpTo = m.ack;
        this.setMap(m.map, m.room);
        this.applyAuthoritative(m.me, m.ack, true);
        this.metas.clear();
        this.remoteBuf.clear();
        this.clearCombat();
        this.opts.onEvent?.({ type: "map", map: m.map });
        return;
      }
      case "pong": {
        const rtt = this.now() - m.c;
        this.stats.jitterMs = this.stats.rttMs ? Math.round(Math.abs(rtt - this.stats.rttMs)) : 0;
        this.stats.rttMs = Math.round(rtt);
        this.stats.rttAvgMs = Math.round(this.stats.rttAvgMs ? this.stats.rttAvgMs * 0.8 + rtt * 0.2 : rtt);
        return;
      }
      case "res":
        this.opts.onEvent?.({ type: "cmd", id: m.id, ok: m.ok, dup: m.dup === 1, data: m.data, err: m.err });
        return;
      case "trade":
        this.opts.onEvent?.({ type: "trade", msg: m });
        return;
      case "inv":
        this.inventory = m;
        if (this.self) this.self.gold = m.gold;
        return;
      case "err":
        if (m.code === "replaced" || m.code === "proto" || m.code === "full" || m.code === "auth" || m.code === "auth_required" || m.code === "not_your_character" || m.code === "character_limit") this.noReconnect = true;
        this.opts.onEvent?.({ type: "error", code: m.code, msg: m.msg });
        return;
    }
  }

  private clearCombat(): void {
    this.monMeta.clear();
    this.monBuf.clear();
    this.loot.clear();
  }

  private onCombatSnap(m: SnapMsg): void {
    if (m.full) {
      this.monBuf.clear();
      this.loot.clear();
    }
    for (const [nid, iid, mid, maxHp] of m.monMeta ?? []) this.monMeta.set(nid, { instanceId: iid, monsterId: mid, maxHp });
    const seen = new Set<number>();
    for (const t of m.mon ?? []) {
      seen.add(t[0]);
      let b = this.monBuf.get(t[0]);
      if (!b) {
        b = { buf: new Interpolator(), hp: 0, state: 0, attackId: 0, hitSeq: 0, target: 0 };
        this.monBuf.set(t[0], b);
      }
      b.buf.push({ t: m.st, x: fromCm(t[1]), z: fromCm(t[2]), yaw: fromMrad(t[3]), anim: t[5], speed: 0, link: 1, act: 0, actSeq: 0 });
      b.hp = t[4];
      b.state = t[5];
      b.attackId = t[6];
      b.hitSeq = t[7];
      b.target = t[8];
    }
    for (const [nid, b] of this.monBuf) {
      if (seen.has(nid)) continue;
      const l = b.buf.latest;
      if (l) b.buf.push({ ...l, t: m.st });
    }
    if (m.ps) this.self = { hp: m.ps[0], maxHp: m.ps[1], level: m.ps[2], exp: m.ps[3], expNext: m.ps[4], gold: m.ps[5], down: m.ps[6] === 1 };
    for (const e of m.ev ?? []) {
      this.combatEvents++;
      if (e.k === "loot") this.loot.set(e.u, { uid: e.u, defId: e.i, qty: e.n, x: fromCm(e.x), z: fromCm(e.z), ownerPid: e.o, ownerUntil: e.ou, expiresAt: e.ex });
      else if (e.k === "lgone") this.loot.delete(e.u);
      else if (e.k === "hit") {
        const b = this.monBuf.get(e.t);
        if (b) b.hp = e.hp;
      } else if (e.k === "mh" && e.p === this.pid && this.self) this.self.hp = e.hp;
      this.opts.onCombat?.(e, m.st);
    }
  }

  private setMap(id: MapId, room: string): void {
    if (!this.map || this.map.id !== id) this.map = getMap(id);
    this.room = room;
    this.stats.map = id;
    this.stats.room = room;
  }

  private applyAuthoritative(me: [number, number, number, number], ack: number, hard: boolean): void {
    const beforeX = this.local.x + this.offX;
    const beforeZ = this.local.z + this.offZ;
    const predX = this.local.x;
    const predZ = this.local.z;
    this.server.x = fromCm(me[0]);
    this.server.z = fromCm(me[1]);
    this.server.yaw = fromMrad(me[2]);
    this.pending = this.pending.filter((p) => p.seq > ack);
    const s: MoveState = { x: this.server.x, z: this.server.z, yaw: this.server.yaw, speed: this.local.speed, anim: this.local.anim };
    if (this.map) for (const p of this.pending) stepMove(s, p.qx, p.qz, this.map);
    if (hard) {
      this.offX = this.offZ = 0;
    } else {
      const err = Math.hypot(s.x - predX, s.z - predZ);
      if (err > 0.01) {
        this.stats.corrections++;
        this.stats.lastCorrectionCm = Math.round(err * 100);
        this.stats.maxCorrectionCm = Math.max(this.stats.maxCorrectionCm, this.stats.lastCorrectionCm);
      }
      if (err > SNAP_CORRECTION_M) {
        this.stats.snapCorrections++;
        this.offX = this.offZ = 0;
      } else {
        // 畫面位置保持不動，偏移量慢慢歸零
        this.offX = beforeX - s.x;
        this.offZ = beforeZ - s.z;
      }
    }
    this.local.x = s.x;
    this.local.z = s.z;
    this.local.yaw = s.yaw;
    if (this.pending.length === 0 && me[3] === ANIM.Idle) this.local.anim = ANIM.Idle;
  }

  private onSnap(m: SnapMsg): void {
    this.win.snaps++;
    this.stats.serverTick = m.tick;
    const recv = this.now();
    this.clockOff.push(m.st - recv);
    if (this.clockOff.length > 40) this.clockOff.shift();
    this.applyAuthoritative(m.me, m.ack, false);
    this.down = m.me[3] === ANIM.Death;
    this.onCombatSnap(m);
    if (m.roan) this.roan = { patrolT: m.roan[0] / 1000, at: m.st, paused: m.roan[1] === 1, tx: fromCm(m.roan[2]), tz: fromCm(m.roan[3]) };
    if (m.full) {
      this.metas.clear();
      const keep = new Set(m.p.map((t) => t[0]));
      for (const id of [...this.remoteBuf.keys()]) if (!keep.has(id)) this.remoteBuf.delete(id);
    }
    for (const a of m.add ?? []) this.metas.set(a.id, a);
    for (const id of m.gone ?? []) {
      this.metas.delete(id);
      this.remoteBuf.delete(id);
    }
    const seen = new Set<number>();
    for (const t of m.p) {
      if (t[0] === this.pid) continue;
      seen.add(t[0]);
      let b = this.remoteBuf.get(t[0]);
      if (!b) {
        b = new Interpolator();
        this.remoteBuf.set(t[0], b);
      }
      b.push({ t: m.st, x: fromCm(t[1]), z: fromCm(t[2]), yaw: fromMrad(t[3]), anim: t[4], speed: t[5] / 100, link: t[6], act: t[7], actSeq: t[8] });
    }
    // 沒有變動的玩家：在這個時間點補一筆相同資料，插值才不會把「停下→起跑」拉成慢動作
    for (const [id, b] of this.remoteBuf) {
      if (seen.has(id)) continue;
      const l = b.latest;
      if (l) b.push({ ...l, t: m.st, anim: l.anim, speed: l.anim === ANIM.Idle ? 0 : l.speed });
    }
    this.stats.players = this.remoteBuf.size + 1;
    if (m.full && this.awaitingResync) {
      this.awaitingResync = false;
      this.stats.lastResyncMs = Math.round(recv - this.disconnectedAt);
      this.opts.onEvent?.({ type: "resynced", ms: this.stats.lastResyncMs });
    }
  }
}
