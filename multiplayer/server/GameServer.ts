/**
 * Stage 8.0 多人連線伺服器：HTTP(S) + WebSocket(WSS)。
 * - /health、/metrics（診斷）、/mp/（本機雙人測試頁）
 * - 每 50 ms 一個 tick（20 Hz）：處理輸入 → 移動 → 傳送陣 → 快照
 * - 斷線保留角色 30 秒，期間內用憑證重新連線直接接回並完整重新同步
 * - 同一角色只允許一個連線（新連線登入時踢掉舊連線）
 */
import { createServer as createHttp, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { createServer as createHttps } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { MAX_MESSAGE_BYTES, MOVE_SPEED, PROTOCOL_VERSION, RECONNECT_GRACE_MS, ROOM_CAPACITY, SNAPSHOT_HZ, STEP, TICK_HZ } from "../shared/constants.ts";
import type { ClientMsg, Gender, HelloMsg, InvMsg, MapId, ServerMsg } from "../shared/protocol.ts";
import { EQUIP_SLOTS } from "../../src/core/gameSave.ts";
import { FieldCombat } from "./combat/FieldCombat.ts";
import { COMBAT_TEST_RULES, STARTER_KIT_TEST, WEAPON_ITEMS_TEST } from "./combat/rules.ts";
import type { CharacterRecord } from "./persistence/Store.ts";
import { parseAppearance } from "../../src/core/gameSave.ts";
import { RESPAWN_SLOTS } from "../../src/maps/village/layout.ts";
import { getMap } from "../shared/maps.ts";
import { Room, ServerPlayer } from "./Room.ts";
import { TokenBucket, originAllowed, parseClientMsg, protocolOk, sanitizeName } from "./security.ts";
import { RequestLedger } from "./RequestLedger.ts";
import { MemoryStore, type CharacterStore } from "./persistence/Store.ts";
import { createEmoteSystem, type RoomSystem } from "./extensions.ts";

export interface ServerOptions {
  port: number;
  host: string;
  tls?: { cert: string; key: string };
  dev: boolean;
  graceMs: number;
  roomCapacity: number;
  maxPlayers: number;
  allowedOrigins: string[];
  store?: CharacterStore;
  log?: (msg: string) => void;
}

interface Conn {
  id: number;
  ws: WebSocket;
  ip: string;
  bucket: TokenBucket;
  cmdBucket: TokenBucket;
  violations: number;
  player: ServerPlayer | null;
  helloPending: boolean;
}

interface Live {
  player: ServerPlayer;
  room: Room;
  conn: Conn | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

const PROTO_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "proto");
const STATIC: Record<string, string> = {
  "/mp/": "index.html",
  "/mp/index.html": "index.html",
  "/mp/proto.js": "dist/proto.js",
};
const MIME: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8" };

export class GameServer {
  readonly opts: ServerOptions;
  readonly store: CharacterStore;
  readonly ledger = new RequestLedger();
  private http!: Server;
  private wss!: WebSocketServer;
  private readonly rooms = new Map<string, Room>();
  private readonly live = new Map<string, Live>();
  private readonly conns = new Set<Conn>();
  private nextConn = 1;
  private nextPid = 1;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  readonly startedAt = Date.now();
  readonly systems: RoomSystem[] = [createEmoteSystem()];
  readonly stats = {
    ticks: 0,
    tickMsSum: 0,
    tickMsMax: 0,
    bytesIn: 0,
    bytesOut: 0,
    msgsIn: 0,
    msgsOut: 0,
    badMessages: 0,
    rateLimited: 0,
    kicked: 0,
    replaced: 0,
    resumed: 0,
    graceExpired: 0,
    transfers: 0,
    persistOk: 0,
    persistConflict: 0,
    snapshotsSkippedBackpressure: 0,
    rejectedOrigin: 0,
    rejectedProtocol: 0,
    roanRejected: 0,
    actsIgnoredInCombatRoom: 0,
    autoRespawns: 0,
    progressSaved: 0,
    starterKits: 0,
  };
  /** 非同步指令（撿取、背包移動、裝備）的重複請求防護：同一角色同一 requestId 只執行一次 */
  private readonly asyncLedger = new Map<string, Promise<{ ok: boolean; data?: unknown; err?: string }>>();
  private rate = { at: Date.now(), bytesIn: 0, bytesOut: 0, msgsIn: 0, msgsOut: 0, perSec: { bytesIn: 0, bytesOut: 0, msgsIn: 0, msgsOut: 0 } };
  private tickWindow: number[] = [];

  constructor(opts: ServerOptions) {
    this.opts = opts;
    this.store = opts.store ?? new MemoryStore();
  }

  private log(m: string): void {
    this.opts.log?.(m);
  }

  get port(): number {
    const a = this.http.address();
    return typeof a === "object" && a ? a.port : this.opts.port;
  }

  async start(): Promise<void> {
    // 先建立兩張地圖的權威資料（原野地形約 0.3 秒），避免第一位玩家進入時卡頓
    getMap("village");
    getMap("starsprout");
    const handler = (req: IncomingMessage, res: ServerResponse): void => this.onHttp(req, res);
    this.http = this.opts.tls ? createHttps({ cert: this.opts.tls.cert, key: this.opts.tls.key }, handler) : createHttp(handler);
    this.wss = new WebSocketServer({
      server: this.http,
      path: "/ws",
      maxPayload: MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
      verifyClient: (info: { origin?: string; req: IncomingMessage }) => {
        const ok = originAllowed(info.origin || undefined, this.opts.allowedOrigins);
        if (!ok) this.stats.rejectedOrigin++;
        return ok;
      },
    });
    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => this.onConnection(ws, req));
    await new Promise<void>((resolve) => this.http.listen(this.opts.port, this.opts.host, resolve));
    this.lastTick = performance.now();
    this.tickTimer = setInterval(() => this.tick(), 1000 / TICK_HZ);
    this.persistTimer = setInterval(() => void this.persistAll(false), 5000);
    this.log(`Starwish MP server listening on ${this.opts.tls ? "https/wss" : "http/ws"}://${this.opts.host}:${this.port}`);
  }

  private stopping = false;
  private readonly inflight = new Set<Promise<void>>();

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.persistTimer) clearInterval(this.persistTimer);
    for (const l of this.live.values()) if (l.graceTimer) clearTimeout(l.graceTimer);
    for (const c of this.conns) c.ws.terminate();
    await Promise.allSettled([...this.inflight]);
    for (const l of this.live.values()) await this.persistNow(l, true);
    await this.store.close();
    await new Promise<void>((r) => this.wss.close(() => r()));
    await new Promise<void>((r) => this.http.close(() => r()));
  }

  // ---------------- HTTP ----------------
  private onHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = (req.url ?? "/").split("?")[0]!;
    if (url === "/health") return this.json(res, { ok: true, proto: PROTOCOL_VERSION });
    if (url === "/metrics") return this.json(res, this.metrics());
    if (url === "/mp") {
      res.writeHead(302, { location: "/mp/" });
      res.end();
      return;
    }
    const f = STATIC[url];
    if (f) {
      const p = join(PROTO_DIR, f);
      if (existsSync(p)) {
        res.writeHead(200, { "content-type": MIME[f.split(".").pop()!] ?? "application/octet-stream", "cache-control": "no-store" });
        res.end(readFileSync(p));
        return;
      }
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }

  private json(res: ServerResponse, body: unknown): void {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(body));
  }

  metrics(): Record<string, unknown> {
    const tw = this.tickWindow;
    return {
      uptimeS: Math.round((Date.now() - this.startedAt) / 1000),
      proto: PROTOCOL_VERSION,
      tickHz: TICK_HZ,
      connections: this.conns.size,
      store: { kind: this.store.kind, realm: this.store.realm },
      combat: [...this.rooms.values()].filter((r) => r.combat).map((r) => ({ room: r.key, monsters: r.combat!.monsters.length, alive: r.combat!.monsters.filter((m) => m.ctl.instance.isAlive).length, loot: r.combat!.loot.size, ...r.combat!.counters })),
      players: this.live.size,
      rooms: [...this.rooms.values()].map((r) => ({ key: r.key, map: r.map, players: r.size, connected: [...r.players()].filter((p) => p.connected).length, tick: r.tick })),
      tick: { count: this.stats.ticks, avgMs: tw.length ? +(tw.reduce((a, b) => a + b, 0) / tw.length).toFixed(3) : 0, maxMs: tw.length ? +Math.max(...tw).toFixed(3) : 0 },
      netPerSec: this.rate.perSec,
      totals: { ...this.stats },
      ledgerEntries: this.ledger.size,
      players_detail: [...this.live.values()].map((l) => ({ pid: l.player.pid, name: l.player.name, room: l.room.key, connected: l.player.connected, queue: l.player.queue.length, ack: l.player.ack, ...l.player.counters })),
    };
  }

  // ---------------- 房間與分流 ----------------
  /** 地圖分流：同地圖找還有空位的頻道，都滿了就開新頻道（village-1、village-2…） */
  pickRoom(map: MapId): Room {
    for (const r of this.rooms.values()) if (r.map === map && r.size < r.capacity) return r;
    let n = 1;
    while (this.rooms.has(`${map}-${n}`)) n++;
    const r = new Room(`${map}-${n}`, map, this.opts.roomCapacity);
    r.systems.push(...this.systems);
    if (map === "starsprout") {
      r.combat = new FieldCombat(r, this.store);
      r.combat.onInventory = (p) => void this.sendInventory(p);
    }
    this.rooms.set(r.key, r);
    return r;
  }

  private spawnPoint(map: MapId, x: number | null, z: number | null, yaw: number): { x: number; z: number; yaw: number } {
    const m = getMap(map);
    if (x !== null && z !== null && m.legal(x, z)) return { x, z, yaw };
    for (let i = 0; i < 24; i++) {
      const s = m.spawn(this.nextPid + i);
      if (m.legal(s.x, s.z)) return s;
    }
    return m.spawn(0);
  }

  // ---------------- WebSocket ----------------
  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const now = Date.now();
    const c: Conn = { id: this.nextConn++, ws, ip: req.socket.remoteAddress ?? "?", bucket: new TokenBucket(120, 240, now), cmdBucket: new TokenBucket(10, 20, now), violations: 0, player: null, helloPending: false };
    this.conns.add(c);
    const helloTimeout = setTimeout(() => {
      if (!c.player) this.close(c, 4001, "hello timeout");
    }, 5000);
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      this.stats.bytesIn += data.length;
      this.rate.bytesIn += data.length;
      this.stats.msgsIn++;
      this.rate.msgsIn++;
      if (!c.bucket.take(Date.now())) {
        this.stats.rateLimited++;
        return this.violation(c);
      }
      const m = isBinary ? null : parseClientMsg(data.toString("utf8"));
      if (!m) {
        this.stats.badMessages++;
        return this.violation(c);
      }
      this.onMessage(c, m).catch((e: unknown) => this.log(`message error: ${String(e)}`));
    });
    ws.on("close", () => {
      clearTimeout(helloTimeout);
      this.conns.delete(c);
      this.onClose(c);
    });
    ws.on("error", () => {});
  }

  private violation(c: Conn): void {
    c.violations++;
    if (c.violations > 50) {
      this.stats.kicked++;
      this.sendTo(c, { t: "err", code: "bad_msg", msg: "too many invalid messages" });
      this.close(c, 4002, "violations");
    }
  }

  private close(c: Conn, code: number, reason: string): void {
    try {
      c.ws.close(code, reason);
    } catch {
      /* 已關閉 */
    }
  }

  private sendTo(c: Conn, m: ServerMsg): void {
    if (c.ws.readyState !== 1) return;
    const s = JSON.stringify(m);
    c.ws.send(s);
    const b = Buffer.byteLength(s);
    this.stats.bytesOut += b;
    this.rate.bytesOut += b;
    this.stats.msgsOut++;
    this.rate.msgsOut++;
  }

  private async onMessage(c: Conn, m: ClientMsg): Promise<void> {
    if (m.t === "hello") {
      if (c.player || c.helloPending) return this.violation(c);
      c.helloPending = true;
      return this.onHello(c, m);
    }
    const p = c.player;
    if (!p) return this.violation(c);
    switch (m.t) {
      case "in":
        p.enqueue(m);
        return;
      case "ping":
        this.sendTo(c, { t: "pong", c: m.c, s: Date.now() });
        return;
      case "resync":
        p.needFull = true;
        return;
      case "roan": {
        const live = this.live.get(p.characterId);
        if (live && !live.room.roanHold(p, m.h === 1, Date.now())) this.stats.roanRejected++;
        return;
      }
      case "act":
        if (!c.cmdBucket.take(Date.now())) {
          this.stats.rateLimited++;
          return;
        }
        // 原野房間的攻擊、受擊、倒地由伺服器戰鬥決定；客戶端的動作回報只在村莊（表情動作）有效
        if (this.live.get(p.characterId)?.room.combat) {
          this.stats.actsIgnoredInCombatRoom++;
          return;
        }
        p.applyAct(m.k, m.y, performance.now() / 1000);
        return;
      case "cmd": {
        if (!c.cmdBucket.take(Date.now())) {
          this.stats.rateLimited++;
          return this.sendTo(c, { t: "res", id: m.id, ok: false, err: "rate" });
        }
        const live = this.live.get(p.characterId);
        if (!live) return;
        if (m.k === "pick" || m.k === "move" || m.k === "equip" || m.k === "inv") return this.asyncCmd(c, p, live, m.id, m.k, m.p);
        const sys = live.room.systems.find((s) => s.commands.includes(m.k));
        const now = Date.now();
        const r = this.ledger.run(p.characterId, m.id, now, () => {
          if (m.k === "respawn") return this.respawn(p, live);
          if (m.k === "appearance") return this.changeAppearance(p, live, m.p);
          if (m.k === "atk" || m.k === "sk") return this.combatCmd(p, live, m.k, m.p);
          if (!sys?.onCommand) return { ok: false, err: "unknown_cmd" };
          const out = sys.onCommand(m.k, m.p, { room: live.room, player: p, requestId: m.id, now });
          return out.ok ? { ok: true, data: out.data } : { ok: false, err: out.err };
        });
        this.sendTo(c, { t: "res", id: m.id, ok: r.entry.ok, ...(r.entry.data !== undefined ? { data: r.entry.data } : {}), ...(r.entry.err ? { err: r.entry.err } : {}), ...(r.dup ? { dup: 1 as const } : {}) });
        return;
      }
    }
  }

  private async onHello(c: Conn, m: HelloMsg): Promise<void> {
    if (!protocolOk(m.v)) {
      this.stats.rejectedProtocol++;
      this.sendTo(c, { t: "err", code: "proto", msg: `protocol ${m.v} != ${PROTOCOL_VERSION}，請重新整理頁面` });
      return this.close(c, 4000, "protocol");
    }
    const now = Date.now();
    let rec = m.resume ? await this.store.findByToken(m.resume) : null;
    let token = m.resume ?? "";
    let resumed = false;
    if (!rec) {
      if (this.live.size >= this.opts.maxPlayers) {
        this.sendTo(c, { t: "err", code: "full", msg: "伺服器人數已滿" });
        return this.close(c, 4003, "full");
      }
      const gender: Gender = m.gender === "female" ? "female" : "male";
      // 外觀只是造型（不影響數值）：用單機版同一個 parseAppearance 驗證，不合法值回到預設
      const created = await this.store.createGuest(sanitizeName(m.name, this.nextPid + 1000), gender, parseAppearance(m.ap), now);
      rec = created.character;
      token = created.token;
    }
    if (c.ws.readyState !== 1) return;
    const lockEpoch = await this.store.acquireLock(rec.id);
    if (!this.live.has(rec.id)) rec = await this.ensureStarterKit(rec, lockEpoch);
    if (c.ws.readyState !== 1) return;
    let live = this.live.get(rec.id);
    if (live) {
      // 同一角色已在線上或在保留期間：接回原本的角色
      resumed = true;
      this.stats.resumed++;
      if (live.graceTimer) clearTimeout(live.graceTimer);
      live.graceTimer = null;
      const old = live.conn;
      if (old && old !== c) {
        this.stats.replaced++;
        old.player = null;
        this.sendTo(old, { t: "err", code: "replaced", msg: "此角色已在其他裝置登入" });
        this.close(old, 4004, "replaced");
      }
      live.conn = c;
      // 重新連線：清空尚未處理的輸入，客戶端會重送序號大於 ack 的所有輸入（不遺失、不重複）
      live.player.queue.length = 0;
      live.player.nextSeq = live.player.ack + 1;
      live.player.connected = true;
      live.player.needFull = true;
      live.player.lockEpoch = lockEpoch;
    } else {
      const map: MapId = this.opts.dev && m.devMap ? m.devMap : rec.map;
      const sp = this.opts.dev && m.devMap && m.devMap !== rec.map ? this.spawnPoint(map, null, null, 0) : this.spawnPoint(map, rec.x, rec.z, rec.yaw);
      const player = new ServerPlayer({ pid: this.nextPid++, characterId: rec.id, name: rec.name, gender: rec.gender, appearance: rec.appearance, x: sp.x, z: sp.z, yaw: sp.yaw, version: rec.version, lockEpoch });
      // 戰鬥狀態從資料庫載入（等級、經驗、金幣）；生命在重新登入時回滿（測試設定）
      player.cs.level = rec.level;
      player.cs.exp = rec.exp;
      player.cs.gold = rec.gold;
      const room = this.pickRoom(map);
      room.add(player);
      live = { player, room, conn: c, graceTimer: null };
      this.live.set(rec.id, live);
      player.persistDirty = true;
    }
    const p = live.player;
    c.player = p;
    p.send = (msg) => {
      if (live!.conn !== c) return;
      if (msg.t === "snap" && c.ws.bufferedAmount > 512 * 1024) {
        // 對方網路塞住：先跳過，之後補送完整狀態
        this.stats.snapshotsSkippedBackpressure++;
        p.needFull = true;
        return;
      }
      this.sendTo(c, msg);
    };
    this.sendTo(c, {
      t: "welcome",
      v: PROTOCOL_VERSION,
      pid: p.pid,
      cid: rec.id,
      token,
      map: live.room.map,
      room: live.room.key,
      resumed,
      g: p.gender,
      ap: { ...p.appearance },
      name: p.name,
      realm: this.store.realm,
      tick: live.room.tick,
      st: now,
      e: p.epoch,
      ack: p.ack,
      me: p.me(),
      cfg: { step: STEP, tickHz: TICK_HZ, snapHz: SNAPSHOT_HZ, speed: MOVE_SPEED, graceMs: this.opts.graceMs },
    });
    p.cs.statsDirty = true;
    void this.sendInventory(p);
    this.log(`${resumed ? "resume" : "join"} pid=${p.pid} ${p.name} room=${live.room.key}`);
  }

  private onClose(c: Conn): void {
    const p = c.player;
    if (!p) return;
    const live = this.live.get(p.characterId);
    if (!live || live.conn !== c) return;
    live.conn = null;
    p.connected = false;
    p.disconnectedAt = Date.now();
    void this.persist(live);
    live.graceTimer = setTimeout(() => {
      // 保留時間到：角色離開房間（位置已存檔，下次用憑證登入從存檔位置出生）
      this.stats.graceExpired++;
      live.room.remove(p.pid);
      this.live.delete(p.characterId);
      void this.persist(live, true);
    }, this.opts.graceMs);
    this.log(`disconnect pid=${p.pid} (grace ${this.opts.graceMs} ms)`);
  }

  // ---------------- tick ----------------
  private tick(): void {
    const t0 = performance.now();
    const dt = Math.min(0.25, (t0 - this.lastTick) / 1000);
    this.lastTick = t0;
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const transfers = room.step(dt, now);
      for (const tr of transfers) this.transfer(tr.player, room, tr.to);
      if (!room.combat) continue;
      for (const p of [...room.players()]) {
        const live = this.live.get(p.characterId);
        if (!live) continue;
        // 經驗、等級：擊殺結算後立即存檔（伺服器重啟不會遺失）
        if (p.cs.progressDirty) void this.persist(live, false, true);
        // 倒地太久：自動送回星芽村（測試設定 30 秒）
        if (p.down && room.clock - p.cs.downAt >= COMBAT_TEST_RULES.autoRespawnSeconds) {
          this.stats.autoRespawns++;
          this.respawn(p, live);
        }
      }
    }
    for (const room of this.rooms.values()) room.broadcast(now);
    const ms = performance.now() - t0;
    this.stats.ticks++;
    this.stats.tickMsSum += ms;
    this.stats.tickMsMax = Math.max(this.stats.tickMsMax, ms);
    this.tickWindow.push(ms);
    if (this.tickWindow.length > TICK_HZ * 5) this.tickWindow.shift();
    if (now - this.rate.at >= 1000) {
      const s = (now - this.rate.at) / 1000;
      this.rate.perSec = { bytesIn: Math.round(this.rate.bytesIn / s), bytesOut: Math.round(this.rate.bytesOut / s), msgsIn: Math.round(this.rate.msgsIn / s), msgsOut: Math.round(this.rate.msgsOut / s) };
      this.rate.bytesIn = this.rate.bytesOut = this.rate.msgsIn = this.rate.msgsOut = 0;
      this.rate.at = now;
    }
  }

  /** 伺服器決定的換地圖：離開舊房間 → 放到目的地 → 通知客戶端（地圖世代 +1，舊輸入作廢） */
  private transfer(p: ServerPlayer, from: Room, to: { map: MapId; x: number; z: number; yaw: number }): void {
    const live = this.live.get(p.characterId);
    if (!live) return;
    from.remove(p.pid);
    p.queue.length = 0;
    p.epoch++;
    p.nextSeq = p.ack + 1;
    const sp = this.spawnPoint(to.map, to.x, to.z, to.yaw);
    p.state.x = sp.x;
    p.state.z = sp.z;
    p.state.yaw = sp.yaw;
    p.state.speed = 0;
    const room = this.pickRoom(to.map);
    room.add(p);
    live.room = room;
    p.persistDirty = true;
    this.stats.transfers++;
    p.send({ t: "map", map: room.map, room: room.key, e: p.epoch, ack: p.ack, me: p.me() });
    void this.persist(live);
  }

  /** 倒地後回星芽村星願之泉（只有倒地中可以使用；Stage 8.2 起倒地由伺服器戰鬥判定） */
  private respawn(p: ServerPlayer, live: Live): { ok: boolean; data?: unknown; err?: string } {
    if (!p.down) return { ok: false, err: "not_down" };
    p.cs.hp = p.cs.maxHp;
    p.cs.statsDirty = true;
    p.cs.busyUntil = 0;
    this.respawnCount = (this.respawnCount + 1) % RESPAWN_SLOTS.length;
    const slot = RESPAWN_SLOTS[this.respawnCount]!;
    p.down = false;
    this.transfer(p, live.room, { map: "village", x: slot.x, z: slot.z, yaw: slot.yaw });
    return { ok: true, data: { map: "village" } };
  }
  private respawnCount = 0;

  /** 換外觀（髮型、髮色、武器）：只是造型，驗證後存檔並通知同房間玩家 */
  private changeAppearance(p: ServerPlayer, live: Live, payload: unknown): { ok: boolean; data?: unknown; err?: string } {
    if (!payload || typeof payload !== "object" || JSON.stringify(payload).length > 200) return { ok: false, err: "bad_appearance" };
    // 武器由裝備決定（Stage 8.2）：換外觀不能直接換武器
    p.appearance = { ...parseAppearance(payload), weapon: p.appearance.weapon };
    live.room.metaChanged(p);
    const pr = this.store.saveAppearance(p.characterId, p.lockEpoch, p.appearance).then(() => {}, () => void this.stats.persistConflict++);
    this.inflight.add(pr);
    void pr.finally(() => this.inflight.delete(pr));
    return { ok: true, data: { ap: p.appearance } };
  }

  // ---------------- 存檔 ----------------
  private persist(live: Live, force = false, progressOnly = false): Promise<void> {
    if (this.stopping) return Promise.resolve();
    const pr = (progressOnly ? this.saveProgress(live.player) : this.persistNow(live, force)).catch((e: unknown) => this.log(`persist error: ${String(e)}`));
    this.inflight.add(pr);
    void pr.finally(() => this.inflight.delete(pr));
    return pr;
  }

  private async saveProgress(p: ServerPlayer): Promise<void> {
    if (!p.cs.progressDirty) return;
    p.cs.progressDirty = false;
    const ok = await this.store.saveProgress(p.characterId, p.lockEpoch, p.cs.level, p.cs.exp);
    if (ok) this.stats.progressSaved++;
    else this.stats.persistConflict++;
  }

  private async persistNow(live: Live, force = false): Promise<void> {
    const p = live.player;
    await this.saveProgress(p);
    if (!p.persistDirty && !force) return;
    p.persistDirty = false;
    const patch = { map: live.room.map, x: p.x, z: p.z, yaw: p.yaw };
    let r = await this.store.savePosition(p.characterId, p.version, p.lockEpoch, patch, Date.now());
    if (!r.ok && r.reason === "conflict") {
      // 版本被本角色自己的其他寫入（外觀、裝備、經驗）推進：工作階段鎖仍是自己的 → 採用最新版本重試一次
      const cur = await this.store.get(p.characterId);
      if (cur && cur.lockEpoch === p.lockEpoch) {
        p.version = cur.version;
        r = await this.store.savePosition(p.characterId, p.version, p.lockEpoch, patch, Date.now());
      }
    }
    if (r.ok) {
      p.version = r.version;
      this.stats.persistOk++;
    } else {
      this.stats.persistConflict++;
      this.log(`persist rejected pid=${p.pid}: ${r.reason}`);
    }
  }

  private async persistAll(force: boolean): Promise<void> {
    for (const l of this.live.values()) await this.persist(l, force);
  }

  // ---------------- Stage 8.2：戰鬥、背包、掉落 ----------------
  /** 新角色的測試起始裝備：金幣＋練習短劍＋練習法杖（requestId 固定 → 重複登入不會重複發放） */
  private async ensureStarterKit(rec: CharacterRecord, lockEpoch: number): Promise<CharacterRecord> {
    const cid = rec.id;
    const g = await this.store.changeGold(cid, `starter-gold-${cid}`, STARTER_KIT_TEST.gold, "starter_kit_test");
    if (g.ok && !g.dup) this.stats.starterKits++;
    const granted: Record<string, string> = {};
    for (const it of STARTER_KIT_TEST.items) {
      const r = await this.store.grantItem(cid, `starter-${it}-${cid}`, it, 1);
      if (r.ok && r.item) granted[it] = r.item.uid;
    }
    if (!rec.equipment.weapon) {
      const want = rec.appearance.weapon === "staff" ? "test_novice_staff" : "test_novice_sword";
      const items = await this.store.listItems(cid);
      const uid = granted[want] ?? items.find((i) => i.defId === want && i.location === "bag")?.uid;
      if (uid) await this.store.equip(cid, lockEpoch, "weapon", uid);
    }
    return (await this.store.get(cid)) ?? rec;
  }

  private combatCmd(p: ServerPlayer, live: Live, k: "atk" | "sk", payload: unknown): { ok: boolean; data?: unknown; err?: string } {
    const cb = live.room.combat;
    if (!cb) return { ok: false, err: "no_combat_here" };
    const o = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
    const t = Number.isInteger(o.t) ? (o.t as number) : 0;
    if (k === "atk") {
      const r = cb.attack(p, t, live.room.clock);
      return r.ok ? { ok: true, data: { c: r.castId } } : { ok: false, err: r.err };
    }
    const sid = typeof o.s === "string" && o.s.length <= 32 ? o.s : "";
    const y = Number.isInteger(o.y) && Math.abs(o.y as number) <= 3142 ? (o.y as number) : null;
    const r = cb.skill(p, sid, t, y, live.room.clock);
    return r.ok ? { ok: true, data: { c: r.castId, hits: r.hits, dur: Math.round(r.duration * 1000) } } : { ok: false, err: r.err };
  }

  private asyncCmd(c: Conn, p: ServerPlayer, live: Live, id: string, k: string, payload: unknown): void {
    if (typeof id !== "string" || id.length > 64) return;
    const key = `${p.characterId}|${id}`;
    let pr = this.asyncLedger.get(key);
    const dup = !!pr;
    if (!pr) {
      pr = this.runAsyncCmd(p, live, id, k, payload).catch((e: unknown) => ({ ok: false, err: `error:${String(e)}` }));
      this.asyncLedger.set(key, pr);
      if (this.asyncLedger.size > 5000) this.asyncLedger.delete(this.asyncLedger.keys().next().value!);
    }
    const tr = pr.then((r) => {
      this.sendTo(c, { t: "res", id, ok: r.ok, ...(r.data !== undefined ? { data: r.data } : {}), ...(r.err ? { err: r.err } : {}), ...(dup ? { dup: 1 as const } : {}) });
    });
    const done = tr.then(() => {});
    this.inflight.add(done);
    void done.finally(() => this.inflight.delete(done));
  }

  private async runAsyncCmd(p: ServerPlayer, live: Live, id: string, k: string, payload: unknown): Promise<{ ok: boolean; data?: unknown; err?: string }> {
    const o = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
    if (k === "inv") {
      await this.sendInventory(p);
      return { ok: true };
    }
    if (k === "pick") {
      const cb = live.room.combat;
      if (!cb) return { ok: false, err: "no_combat_here" };
      if (typeof o.u !== "string" || o.u.length > 40) return { ok: false, err: "bad_request" };
      const r = await cb.pick(p, o.u);
      return r.ok ? { ok: true, data: { i: r.defId, n: r.qty, ...(r.gold !== undefined ? { gold: r.gold } : {}), ...(r.item ? { uid: r.item.uid } : {}) } } : { ok: false, err: r.err };
    }
    if (k === "move") {
      // 倉庫存取（測試）：只在星芽村
      if (live.room.map !== "village") return { ok: false, err: "storage_village_only" };
      if (typeof o.u !== "string" || (o.to !== "bag" && o.to !== "storage") || !Number.isInteger(o.v)) return { ok: false, err: "bad_request" };
      const cur = await this.store.get(p.characterId);
      if (cur && Object.values(cur.equipment).includes(o.u) && o.to === "storage") return { ok: false, err: "equipped" };
      const r = await this.store.moveItem(p.characterId, `mv-${id}`, o.u, o.to, o.v as number);
      await this.sendInventory(p);
      return r.ok ? { ok: true, data: { uid: o.u, to: o.to } } : { ok: false, err: r.err };
    }
    if (k === "equip") {
      const slot = typeof o.slot === "string" && (EQUIP_SLOTS as readonly string[]).includes(o.slot) ? o.slot : null;
      if (!slot) return { ok: false, err: "bad_slot" };
      const uid = typeof o.u === "string" ? o.u : null;
      if (p.down || p.cs.busyUntil > live.room.clock) return { ok: false, err: "busy" };
      let kind: "sword" | "staff" | null = null;
      if (uid) {
        const it = (await this.store.listItems(p.characterId)).find((i) => i.uid === uid);
        if (!it || it.location !== "bag") return { ok: false, err: "not_in_bag" };
        if (slot === "weapon") {
          kind = WEAPON_ITEMS_TEST[it.defId] ?? null;
          if (!kind) return { ok: false, err: "not_weapon" };
        }
      }
      const ok = await this.store.equip(p.characterId, p.lockEpoch, slot, uid);
      if (!ok) return { ok: false, err: "equip_failed" };
      if (kind && kind !== p.appearance.weapon) {
        p.appearance = { ...p.appearance, weapon: kind };
        live.room.metaChanged(p);
        await this.store.saveAppearance(p.characterId, p.lockEpoch, p.appearance);
      }
      await this.sendInventory(p);
      return { ok: true, data: { slot, uid, weapon: p.appearance.weapon } };
    }
    return { ok: false, err: "unknown_cmd" };
  }

  async sendInventory(p: ServerPlayer): Promise<void> {
    const [items, rec] = await Promise.all([this.store.listItems(p.characterId), this.store.get(p.characterId)]);
    if (rec) p.cs.gold = rec.gold;
    const msg: InvMsg = { t: "inv", items: items.map((i) => ({ uid: i.uid, defId: i.defId, qty: i.qty, location: i.location, version: i.version })), gold: rec?.gold ?? p.cs.gold, equipment: { ...(rec?.equipment ?? {}) } };
    p.cs.statsDirty = true;
    p.send(msg);
  }

  // 測試用
  roomOf(characterId: string): Room | undefined {
    return this.live.get(characterId)?.room;
  }
  playerOf(characterId: string): ServerPlayer | undefined {
    return this.live.get(characterId)?.player;
  }
}

export function optionsFromEnv(env: NodeJS.ProcessEnv, store?: CharacterStore): ServerOptions {
  const cert = env.MP_TLS_CERT;
  const key = env.MP_TLS_KEY;
  return {
    port: Number(env.PORT ?? 2567),
    // Render 等主機會設定 PORT 並要求監聽 0.0.0.0
    host: env.HOST ?? (env.RENDER ? "0.0.0.0" : "127.0.0.1"),
    store,
    tls: cert && key ? { cert: readFileSync(cert, "utf8"), key: readFileSync(key, "utf8") } : undefined,
    dev: env.MP_DEV === "1",
    graceMs: Number(env.MP_GRACE_MS ?? RECONNECT_GRACE_MS),
    roomCapacity: Number(env.MP_ROOM_CAPACITY ?? ROOM_CAPACITY),
    maxPlayers: Number(env.MP_MAX_PLAYERS ?? 200),
    allowedOrigins: (env.MP_ALLOWED_ORIGINS ?? "https://scottlien2002-sys.github.io").split(",").map((s) => s.trim()).filter(Boolean),
    log: (m) => console.log(`[${new Date().toISOString()}] ${m}`),
  };
}
