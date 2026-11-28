/**
 * Stage 8.5 伺服器權威強化：客戶端送來的能力值、血量、經驗、金幣、位置一律不採用；
 * 瞬移、序號跳號、重複領獎、亂碼／格式錯誤封包都不會影響伺服器與其他玩家。
 * （攻速、攻擊距離、技能冷卻、錯誤武器、偽造傷害已在 combat.test.ts「防作弊」測試。）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { Bot, sleep, startServer } from "./helpers.ts";
import type { GameServer } from "../server/GameServer.ts";
import type { NetEvent } from "../client/NetClient.ts";
import type { CombatEvent } from "../shared/protocol.ts";
import { MOVE_SPEED, PROTOCOL_VERSION } from "../shared/constants.ts";
import { getMap } from "../shared/maps.ts";

const results: Record<string, unknown> = {};
process.on("exit", () => {
  mkdirSync(new URL("../test-results/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../test-results/authority.json", import.meta.url), JSON.stringify(results, null, 2));
});

type CmdRes = Extract<NetEvent, { type: "cmd" }>;
async function waitRes(b: Bot, rid: string): Promise<CmdRes> {
  const t0 = Date.now();
  for (;;) {
    const e = b.events.find((x): x is CmdRes => x.type === "cmd" && x.id === rid && !(x as { _seen?: boolean })._seen);
    if (e) {
      (e as { _seen?: boolean })._seen = true;
      return e;
    }
    if (Date.now() - t0 > 4000) throw new Error(`no result for ${rid}`);
    await sleep(5);
  }
}
const cmd = (b: Bot, k: string, p?: unknown, id?: string) => waitRes(b, b.c.command(k, p, id));
const sp = (srv: GameServer, b: Bot) => srv.playerOf(b.c.characterId)!;
class CombatBot extends Bot {
  readonly ev: CombatEvent[] = [];
  constructor(srv: GameServer, name: string, extra: Record<string, unknown> = {}) {
    super(srv, { name, devMap: "starsprout", ...extra, onCombat: (e: CombatEvent) => this.ev.push(e) } as never);
  }
}
type Raw = { ws: WebSocket; msgs: { t: string; [k: string]: unknown }[] };
function rawOpen(srv: GameServer): Promise<Raw> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    const r: Raw = { ws, msgs: [] };
    ws.onmessage = (e) => {
      try {
        r.msgs.push(JSON.parse(String(e.data)));
      } catch {
        /* ignore */
      }
    };
    ws.onopen = () => res(r);
    ws.onerror = () => rej(new Error("ws error"));
  });
}
async function rawHello(srv: GameServer, extra: Record<string, unknown>): Promise<Raw & { cid: string; me: number[] }> {
  const r = await rawOpen(srv);
  r.ws.send(JSON.stringify({ t: "hello", v: PROTOCOL_VERSION, name: "raw", devMap: "starsprout", ...extra }));
  const t0 = Date.now();
  while (!r.msgs.some((m) => m.t === "welcome")) {
    if (Date.now() - t0 > 3000) throw new Error("no welcome: " + JSON.stringify(r.msgs.slice(-2)));
    await sleep(10);
  }
  const w = r.msgs.find((m) => m.t === "welcome") as unknown as { cid: string; me: number[] };
  return { ...r, cid: w.cid, me: w.me };
}

test("客戶端數值不可信：hello／外觀／攻擊附帶的血量、等級、金幣、經驗、攻速、位置全部被忽略", async () => {
  const srv = await startServer();
  try {
    const r = await rawHello(srv, { hp: 99999, maxHp: 99999, level: 99, exp: 99999, gold: 999999, atk: 9999, aspd: 999, speed: 50, x: 0, z: 0, ap: { hair: "hair01", weapon: "sword", level: 99 } });
    await sleep(300);
    const p = srv.playerOf(r.cid)!;
    assert.equal(p.cs.level, 1, "等級由伺服器存檔決定");
    assert.ok(p.cs.hp <= p.cs.maxHp && p.cs.maxHp < 1000, `血量 ${p.cs.hp}/${p.cs.maxHp}`);
    assert.equal(p.cs.gold, 100, "只有測試起始金幣");
    assert.equal(p.cs.exp, 0);
    const spawn = getMap("starsprout").spawn(0);
    assert.ok(Math.hypot(p.x - spawn.x, p.z - spawn.z) < 3, "出生在伺服器出生點，不是客戶端指定位置");
    // 外觀指令不能換武器、不能帶能力值
    r.ws.send(JSON.stringify({ t: "cmd", id: "ap-0001", k: "appearance", p: { hair: "hair02", weapon: "staff", level: 99 } }));
    await sleep(200);
    assert.equal(p.appearance.weapon, "sword");
    assert.equal(p.cs.level, 1);
    // 移動速度：送「speed」欄位無效（輸入只有方向，伺服器自己算速度）
    r.ws.send(JSON.stringify({ t: "in", e: 0, s: 1, d: [[127, 0, 3]], speed: 99, x: 999 }));
    await sleep(200);
    assert.ok(Math.hypot(p.x - spawn.x, p.z - spawn.z) < 3);
    results.forgedStats = { level: p.cs.level, hp: p.cs.hp, maxHp: p.cs.maxHp, gold: p.cs.gold, exp: p.cs.exp, weapon: p.appearance.weapon };
    r.ws.close();
  } finally {
    await srv.stop();
  }
});

test("瞬移與序號作弊：序號跳到極大、超長步數、過期世代 → 移動量不超過速度上限，位置永遠合法", async () => {
  const srv = await startServer();
  try {
    const r = await rawHello(srv, {});
    const p = srv.playerOf(r.cid)!;
    const x0 = p.x;
    const z0 = p.z;
    const bad0 = srv.stats.badMessages;
    const t0 = performance.now();
    // 1) 一次送 200 步（超過單一封包上限 → 整個封包被拒）
    r.ws.send(JSON.stringify({ t: "in", e: 0, s: 1, d: [[90, 90, 200]] }));
    // 2) 序號跳到極大值（伺服器接受新序號但不補走中間的步）
    r.ws.send(JSON.stringify({ t: "in", e: 0, s: 1_000_000_000, d: [[90, 90, 50]] }));
    // 3) 過期世代（換地圖前的輸入）
    r.ws.send(JSON.stringify({ t: "in", e: 7, s: 2_000_000_000, d: [[90, 90, 50]] }));
    await sleep(1000);
    const el = (performance.now() - t0) / 1000;
    const moved = Math.hypot(p.x - x0, p.z - z0);
    const limit = MOVE_SPEED * (el + 0.5) + 0.1;
    results.teleport = { oversizeRejected: srv.stats.badMessages - bad0, queued: p.queue.length, movedM: +moved.toFixed(2), limitM: +limit.toFixed(2), seconds: +el.toFixed(2), stepsDropped: p.counters.stepsDropped, staleEpoch: p.counters.staleEpochInputs, seqGaps: p.counters.seqGaps, legal: getMap("starsprout").legal(p.x, p.z) };
    assert.ok(moved <= limit, `移動 ${moved} > 上限 ${limit}`);
    assert.ok(srv.stats.badMessages > bad0, "超長步數封包被拒");
    assert.ok(p.counters.staleEpochInputs > 0, "過期世代被丟掉");
    assert.ok(getMap("starsprout").legal(p.x, p.z));
    r.ws.close();
  } finally {
    await srv.stop();
  }
});

test("血量、死亡、經驗、掉落由伺服器結算：重送擊殺指令、偽造經驗／金幣都不會多拿；活著時不能要求復活", async () => {
  const srv = await startServer();
  const a = new CombatBot(srv, "reward");
  try {
    await a.online();
    const room = srv.roomOf(a.c.characterId)!;
    const cb = room.combat!;
    const p = sp(srv, a);
    const bobo = cb.monsters.find((m) => m.ctl.instance.definition.monsterId.startsWith("bobo") || m.ctl.instance.definition.monsterId.includes("bobo"))!;
    const inst = bobo.ctl.instance;
    inst.receiveDamage(inst.currentHp - 1, room.clock, "normal"); // 剩 1 HP：下一下就死
    const q = inst.currentPosition;
    p.state.x = Math.round((q.x + 1.0 + (inst.definition.bodyRadius ?? 0)) * 100) / 100;
    p.state.z = Math.round(q.z * 100) / 100;
    const exp0 = p.cs.exp;
    const gold0 = p.cs.gold;
    const k0 = cb.counters.killsSettled;
    let killed = false;
    for (let i = 0; i < 6 && !killed; i++) {
      const rid = `atk-forged-${i}`;
      const r = await cmd(a, "atk", { t: bobo.nid, exp: 99999, gold: 99999, kill: true, damage: 99999 }, rid);
      // 同一 requestId 重送
      const again = await cmd(a, "atk", { t: bobo.nid }, rid);
      assert.equal(again.dup, true);
      void r;
      await sleep(900);
      killed = !inst.isAlive;
    }
    assert.ok(killed, "怪物死亡");
    await sleep(300);
    // 死掉後再打、重送都不會再結算
    const after = await cmd(a, "atk", { t: bobo.nid, exp: 1 });
    assert.equal(after.ok, false);
    const settled = cb.counters.killsSettled - k0;
    const expGain = p.cs.exp - exp0 + (p.cs.level > 1 ? 1e6 : 0);
    results.reward = { settled, expGain, goldGain: p.cs.gold - gold0, duplicateKillsBlocked: cb.counters.duplicateKillsBlocked, lootOnGround: cb.loot.size };
    assert.equal(settled, 1, "擊殺只結算一次");
    assert.ok(expGain > 0 && expGain < 1000, `經驗由伺服器經驗表決定（${expGain}）`);
    assert.ok(p.cs.gold - gold0 < 1000, "金幣不是客戶端送的值");
    // 偽造的掉落物 UUID
    const fake = await cmd(a, "pick", { u: "00000000-0000-4000-8000-000000000000" });
    assert.equal(fake.ok, false);
    // 活著時要求復活
    const rs = await cmd(a, "respawn");
    assert.equal(rs.err, "not_down");
    assert.equal(p.down, false);
  } finally {
    a.stop();
    await srv.stop();
  }
});

test("格式錯誤封包壓力（約 400 種）：伺服器不當機、tick 持續、其他玩家照常移動；惡意連線被斷開", async () => {
  const srv = await startServer();
  const good = new Bot(srv, { name: "good", devMap: "starsprout" } as never);
  try {
    await good.online();
    const gp = sp(srv, good);
    const bad0 = srv.stats.badMessages;
    const kicked0 = srv.stats.kicked;
    const ticks0 = srv.stats.ticks;
    // 產生各種壞封包
    const vals: unknown[] = [null, true, -1, 0, 1e308, -1e308, "NaN", "", "x".repeat(300), [], {}, [[[]]], { a: { b: { c: { d: {} } } } }, 3.14, Number.MAX_SAFE_INTEGER + 2, "__proto__"];
    const kinds = ["hello", "in", "ping", "cmd", "resync", "roan", "act", "pos", "trade", "", 7, null];
    const cmds = ["atk", "sk", "pick", "move", "equip", "inv", "respawn", "appearance", "trade", "__proto__", "constructor"];
    const msgs: (string | Uint8Array<ArrayBuffer>)[] = [];
    for (const t of kinds) for (const v of vals) msgs.push(JSON.stringify({ t, v, e: v, s: v, d: v, c: v, id: v, k: v, p: v }));
    for (const k of cmds) for (const v of vals) msgs.push(JSON.stringify({ t: "cmd", id: `fz-${Math.random().toString(36).slice(2, 10)}`, k, p: { t: v, s: v, y: v, u: v, to: v, v, slot: v, op: v, tid: v, items: v, gold: v } }));
    for (const v of vals) msgs.push(JSON.stringify({ t: "in", e: 0, s: 1, d: [[v, v, v]] }));
    msgs.push("{", "[]", "null", "\u0000\u0001", "{\"t\":\"hello\"".repeat(50), JSON.stringify({ t: "in", e: 0, s: 1, d: Array.from({ length: 5000 }, () => [1, 1, 1]) }));
    msgs.push(new Uint8Array([0xff, 0xfe, 0x00, 0x01]), "x".repeat(200_000));
    const sockets: Raw[] = [];
    let sent = 0;
    // 分給多條連線（每條連線有速率限制與違規上限，超過就被斷開）
    for (let i = 0; i < msgs.length; i += 60) {
      const r = await rawOpen(srv).catch(() => null);
      if (!r) continue;
      sockets.push(r);
      // 一半的連線先正常 hello，測試已登入後的壞封包
      if ((i / 60) % 2 === 0) {
        r.ws.send(JSON.stringify({ t: "hello", v: PROTOCOL_VERSION, name: `fz${i}`, devMap: "starsprout" }));
        await sleep(60);
      }
      for (const m of msgs.slice(i, i + 60)) {
        try {
          r.ws.send(m);
          sent++;
        } catch {
          /* 已斷線 */
        }
      }
    }
    // 正常玩家在壓力期間持續移動
    const x0 = gp.x;
    const z0 = gp.z;
    good.dir = { x: 0.7, z: 0.7 };
    await sleep(1500);
    good.dir = { x: 0, z: 0 };
    const goodMoved = Math.hypot(gp.x - x0, gp.z - z0);
    const res = await fetch(`http://127.0.0.1:${srv.port}/health`).then((r) => r.status).catch(() => 0);
    const closed = sockets.filter((s) => s.ws.readyState !== 1).length;
    results.fuzz = { variants: msgs.length, sent, connections: sockets.length, closedByServer: closed, badMessages: srv.stats.badMessages - bad0, kicked: srv.stats.kicked - kicked0, ticksDuring: srv.stats.ticks - ticks0, goodPlayerMovedM: +goodMoved.toFixed(2), healthStatus: res, rssMB: Math.round(process.memoryUsage().rss / 1048576) };
    assert.ok(srv.stats.badMessages - bad0 > 100, "壞封包被辨識");
    assert.ok(srv.stats.ticks - ticks0 > 20, "tick 持續執行");
    assert.ok(goodMoved > 2, `其他玩家照常移動（${goodMoved}）`);
    assert.equal(good.c.state, "online");
    assert.equal(res, 200);
    assert.ok(closed > 0, "惡意連線被斷開");
    for (const s of sockets) s.ws.close();
  } finally {
    good.stop();
    await srv.stop();
  }
});
