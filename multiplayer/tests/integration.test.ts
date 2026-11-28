/**
 * 整合測試：真的啟動伺服器（WebSocket），用 NetClient 機器人連線。
 * 每個測試把關鍵數值寫進 results（報告用實測數字）。
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { startServer, Bot, sleep } from "./helpers.ts";
import { PROTOCOL_VERSION, MOVE_SPEED } from "../shared/constants.ts";
import { ANIM } from "../shared/protocol.ts";
import { getMap } from "../shared/maps.ts";

const results: Record<string, unknown> = {};
after(() => {
  mkdirSync(new URL("../reports/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../reports/integration-results.json", import.meta.url), JSON.stringify(results, null, 2));
});

test("兩位玩家同房間：互相看見，位置／朝向／Idle／Run 同步", async () => {
  const srv = await startServer();
  const a = new Bot(srv, { name: "阿星", gender: "male" });
  const b = new Bot(srv, { name: "小願", gender: "female" });
  try {
    await a.online();
    await b.online();
    assert.equal(a.c.room, b.c.room, "same room");
    await b.until(() => !!b.remote(a.c.pid) && !!a.remote(b.c.pid), 3000, "see each other");
    const seenByB = b.remote(a.c.pid)!;
    assert.equal(seenByB.name, "阿星");
    assert.equal(seenByB.gender, "male");
    assert.equal(a.remote(b.c.pid)!.gender, "female");
    assert.equal(seenByB.anim, ANIM.Idle);
    // A 往南跑 1.5 秒
    a.dir = { x: 0, z: -1 };
    await b.until(() => b.remote(a.c.pid)?.anim === ANIM.Run, 2000, "B sees A run");
    await sleep(1500);
    const mid = b.remote(a.c.pid)!;
    const yawErr = Math.abs(Math.atan2(Math.sin(mid.yaw - Math.PI), Math.cos(mid.yaw - Math.PI)));
    a.dir = { x: 0, z: 0 };
    await b.until(() => b.remote(a.c.pid)?.anim === ANIM.Idle, 2000, "B sees A idle");
    await sleep(400);
    const sa = srv.playerOf(a.c.characterId)!;
    const r = b.remote(a.c.pid)!;
    const remoteErr = Math.hypot(r.x - sa.x, r.z - sa.z);
    const localErr = Math.hypot(a.c.renderPos.x - sa.x, a.c.renderPos.z - sa.z);
    results.twoPlayers = { room: a.c.room, remoteYawErrRadWhileRunningSouth: +yawErr.toFixed(3), remoteFinalPosErrCm: +(remoteErr * 100).toFixed(2), localFinalPosErrCm: +(localErr * 100).toFixed(2), serverPos: [sa.x, sa.z], aStats: { ...a.c.stats }, bStats: { ...b.c.stats } };
    assert.ok(yawErr < 0.2, `remote yaw faces south (err ${yawErr})`);
    assert.ok(remoteErr < 0.02, `remote settles on server position (${remoteErr})`);
    assert.ok(localErr < 0.02, `local settles on server position (${localErr})`);
    assert.ok(b.c.stats.players === 2 && a.c.stats.players === 2);
  } finally {
    a.stop();
    b.stop();
    await srv.stop();
  }
});

test("客戶端預測＋伺服器校正：120 ms 延遲、40 ms 抖動下移動 3 秒", async () => {
  const srv = await startServer();
  const a = new Bot(srv, { name: "lag", lagMs: 120, jitterMs: 40 });
  const b = new Bot(srv, { name: "obs" });
  try {
    await a.online();
    await b.online();
    await sleep(1200); // 先量 RTT
    const x0 = a.c.local.x;
    const z0 = a.c.local.z;
    const t0 = performance.now();
    a.dir = { x: 0, z: -1 };
    // 預測：按下後下一幀本地就開始移動（不等伺服器）
    await a.until(() => Math.hypot(a.c.local.x - x0, a.c.local.z - z0) > 0.05, 500, "immediate local move");
    const responseMs = performance.now() - t0;
    await sleep(1000);
    a.dir = { x: 1, z: 0 };
    await sleep(1000);
    a.dir = { x: -0.7, z: 0.7 };
    await sleep(1000);
    a.dir = { x: 0, z: 0 };
    await sleep(800);
    const sp = srv.playerOf(a.c.characterId)!;
    const finalErr = Math.hypot(a.c.local.x - sp.x, a.c.local.z - sp.z);
    results.prediction = { lagOneWayMs: 120, jitterMs: 40, rttMs: a.c.stats.rttAvgMs, localResponseMs: Math.round(responseMs), corrections: a.c.stats.corrections, maxCorrectionCm: a.c.stats.maxCorrectionCm, snapCorrections: a.c.stats.snapCorrections, finalErrCm: +(finalErr * 100).toFixed(2), serverCounters: { ...sp.counters } };
    assert.ok(responseMs < 100, `local response ${responseMs} ms despite ${a.c.stats.rttAvgMs} ms RTT`);
    assert.ok(a.c.stats.rttAvgMs >= 200, "lag really applied");
    assert.ok(finalErr < 0.02, `final ${finalErr}`);
    assert.ok(a.c.stats.maxCorrectionCm < 30, `max correction ${a.c.stats.maxCorrectionCm} cm`);
    assert.equal(a.c.stats.snapCorrections, 0);
    assert.equal(sp.counters.stepsDropped, 0);
  } finally {
    a.stop();
    b.stop();
    await srv.stop();
  }
});

test("斷線重連：保留期間內接回同一角色、完整重新同步、已送出未處理的輸入重送後位置一致", async () => {
  const srv = await startServer({ graceMs: 5000 });
  const a = new Bot(srv, { name: "drop" });
  const b = new Bot(srv, { name: "watch" });
  try {
    await a.online();
    await b.online();
    await b.until(() => !!b.remote(a.c.pid), 3000, "b sees a");
    const pid = a.c.pid;
    const cid = a.c.characterId;
    a.dir = { x: 0, z: -1 };
    await sleep(600);
    a.c.dropConnection();
    const tDrop = performance.now();
    await b.until(() => b.remote(pid)?.link === 0, 2000, "b sees a disconnected");
    const bSawDisconnectMs = Math.round(performance.now() - tDrop);
    await a.until(() => a.events.some((e) => e.type === "resynced"), 5000, "resynced");
    a.dir = { x: 0, z: 0 };
    assert.equal(a.c.pid, pid, "same player id");
    assert.equal(a.c.characterId, cid, "same character");
    const welcome = a.events.filter((e) => e.type === "welcome");
    assert.equal(welcome.length, 2);
    assert.equal((welcome[1] as { resumed: boolean }).resumed, true);
    await b.until(() => b.remote(pid)?.link === 1, 2000, "b sees a back");
    await sleep(500);
    const sp = srv.playerOf(cid)!;
    const err = Math.hypot(a.c.local.x - sp.x, a.c.local.z - sp.z);
    const resync = a.events.find((e) => e.type === "resynced") as { ms: number };
    results.reconnect = { resyncMsFromDrop: resync.ms, observerSawDisconnectMs: bSawDisconnectMs, samePid: true, finalErrCm: +(err * 100).toFixed(2), reconnects: a.c.stats.reconnects, clientCorrections: a.c.stats.corrections, snapCorrections: a.c.stats.snapCorrections, serverResumed: srv.stats.resumed };
    assert.ok(err < 0.02, `consistent after resync (${err})`);
    // 移動仍正常
    a.dir = { x: 1, z: 0 };
    await b.until(() => b.remote(pid)?.anim === ANIM.Run, 2000, "move after reconnect");
    a.dir = { x: 0, z: 0 };
  } finally {
    a.stop();
    b.stop();
    await srv.stop();
  }
});

test("保留時間到期：其他玩家看到離開；之後用憑證登入，從存檔位置出生", async () => {
  const srv = await startServer({ graceMs: 800 });
  const a = new Bot(srv, { name: "gone", autoReconnect: false });
  const b = new Bot(srv, { name: "watch" });
  try {
    await a.online();
    await b.online();
    a.dir = { x: 0, z: -1 };
    await sleep(500);
    a.dir = { x: 0, z: 0 };
    await sleep(300);
    const pid = a.c.pid;
    const token = a.c.token!;
    const saved = { x: srv.playerOf(a.c.characterId)!.x, z: srv.playerOf(a.c.characterId)!.z };
    a.stop();
    await b.until(() => !b.remote(pid), 3000, "a removed after grace");
    const rec = await srv.store.get(a.c.characterId);
    const a2 = new Bot(srv, { resumeToken: token });
    await a2.online();
    try {
      assert.notEqual(a2.c.pid, pid, "new entity");
      assert.equal(a2.c.characterId, a.c.characterId, "same character");
      const sp = srv.playerOf(a2.c.characterId)!;
      results.graceExpiry = { savedPos: saved, dbPos: [rec?.x, rec?.z], dbVersion: rec?.version, respawnPos: [sp.x, sp.z] };
      assert.ok(Math.hypot(sp.x - saved.x, sp.z - saved.z) < 0.02, "spawn at saved position");
    } finally {
      a2.stop();
    }
  } finally {
    b.stop();
    await srv.stop();
  }
});

test("工作階段鎖：同一角色第二個連線登入，舊連線被踢且不自動重連", async () => {
  const srv = await startServer();
  const a = new Bot(srv, { name: "one" });
  try {
    await a.online();
    const a2 = new Bot(srv, { resumeToken: a.c.token! });
    try {
      await a2.online();
      await a.until(() => a.c.state === "offline", 3000, "old kicked");
      assert.ok(a.events.some((e) => e.type === "error" && e.code === "replaced"));
      await sleep(1200);
      assert.equal(a.c.state, "offline", "no auto-reconnect after replaced");
      assert.equal(a2.c.pid, a.c.pid, "second device takes over same entity");
      assert.equal(srv.metrics().players, 1);
      results.sessionLock = { replaced: srv.stats.replaced, players: 1 };
    } finally {
      a2.stop();
    }
  } finally {
    a.stop();
    await srv.stop();
  }
});

test("惡意客戶端：加速封包、亂碼、錯誤協定版本、偽造來源", async () => {
  const srv = await startServer();
  const url = `ws://127.0.0.1:${srv.port}/ws`;
  const open = (u = url, opts?: object) =>
    new Promise<WebSocket>((res, rej) => {
      const w = new (WebSocket as unknown as new (u: string, o?: object) => WebSocket)(u, opts);
      w.onopen = () => res(w);
      w.onerror = () => rej(new Error("ws error"));
    });
  try {
    // 1) 加速：每 50 ms 送 30 步（正常 3 步）持續 3 秒
    const w = await open();
    const msgs: { t: string; [k: string]: unknown }[] = [];
    w.onmessage = (e) => msgs.push(JSON.parse(String(e.data)));
    w.send(JSON.stringify({ t: "hello", v: PROTOCOL_VERSION, name: "cheat", devMap: "starsprout" }));
    while (!msgs.some((m) => m.t === "welcome")) await sleep(10);
    const wl = msgs.find((m) => m.t === "welcome") as unknown as { cid: string; me: number[] };
    const x0 = wl.me[0]! / 100;
    const z0 = wl.me[1]! / 100;
    let seq = 1;
    const t0 = performance.now();
    // 在星芽原野營地往東北（開闊草地，正常 3 秒可走 15 m）
    const cheatDir = (): [number, number] => [90, 90];
    while (performance.now() - t0 < 3000) {
      const [cx, cz] = cheatDir();
      w.send(JSON.stringify({ t: "in", e: 0, s: seq, d: [[cx, cz, 30]] }));
      seq += 30;
      await sleep(50);
    }
    const elapsed = (performance.now() - t0) / 1000;
    await sleep(100);
    const p = srv.playerOf(wl.cid)!;
    const moved = Math.hypot(p.x - x0, p.z - z0);
    const limit = MOVE_SPEED * (elapsed + 0.1 + 0.5);
    // 2) 亂碼與偽造位置訊息
    for (let i = 0; i < 60; i++) w.send(i % 2 ? "{garbage" : JSON.stringify({ t: "pos", x: 999, z: 999 }));
    await sleep(300);
    const kicked = w.readyState !== 1;
    results.cheat = { speedHackSeconds: +elapsed.toFixed(2), movedM: +moved.toFixed(2), legitMaxM: +(MOVE_SPEED * elapsed).toFixed(2), limitM: +limit.toFixed(2), stepsDropped: p.counters.stepsDropped, kickedAfterGarbage: kicked, badMessages: srv.stats.badMessages, posLegal: getMap("starsprout").legal(p.x, p.z) };
    assert.ok(moved <= limit, `speed hack moved ${moved} > ${limit}`);
    assert.ok(p.counters.stepsDropped > 0);
    assert.ok(kicked, "kicked after > 50 invalid messages");
    assert.ok(getMap("starsprout").legal(p.x, p.z));
    assert.ok(moved > MOVE_SPEED * elapsed * 0.8, `still moves at normal speed (${moved})`);
    // 3) 協定版本不符
    const w2 = await open();
    const m2: { t: string; code?: string }[] = [];
    w2.onmessage = (e) => m2.push(JSON.parse(String(e.data)));
    w2.send(JSON.stringify({ t: "hello", v: PROTOCOL_VERSION + 99 }));
    await sleep(300);
    assert.equal(m2[0]?.code, "proto");
    // 4) 偽造來源網站被拒
    let originRejected = false;
    try {
      const w3 = await open(url, { headers: { origin: "https://evil.example" } });
      w3.close();
    } catch {
      originRejected = true;
    }
    results.cheat = { ...(results.cheat as object), protocolMismatchRejected: m2[0]?.code === "proto", foreignOriginRejected: originRejected };
    assert.ok(originRejected, "foreign origin rejected");
  } finally {
    await srv.stop();
  }
});

test("傳送陣：從星芽村南門走進原野（伺服器判定換房間），留在村莊的玩家不再看到他", async () => {
  const srv = await startServer();
  const a = new Bot(srv, { name: "traveler" });
  const b = new Bot(srv, { name: "stay" });
  try {
    await a.online();
    await b.online();
    await b.until(() => !!b.remote(a.c.pid), 3000, "b sees a");
    const portal = getMap("village").portals[0]!;
    // 沿廣場繞過噴泉，走南路到南門（與玩家實際路線相同）
    // 出生點在噴泉周圍的 24 個復活位置之一：先沿半徑 13 m 的步道繞到南方，再走南路
    const b0 = Math.atan2(a.c.local.x, a.c.local.z);
    const target = b0 >= 0 ? Math.PI : -Math.PI;
    const wps: { x: number; z: number }[] = [];
    for (let k = 0; k <= 8; k++) {
      const t = b0 + ((target - b0) * k) / 8;
      wps.push({ x: 13 * Math.sin(t), z: 13 * Math.cos(t) });
    }
    wps.push({ x: portal.x, z: portal.z });
    let wi = 0;
    const t0 = performance.now();
    while (a.c.map?.id === "village" && performance.now() - t0 < 25000) {
      const w = wps[wi]!;
      const dx = w.x - a.c.local.x;
      const dz = w.z - a.c.local.z;
      const l = Math.hypot(dx, dz) || 1;
      if (l < 0.4 && wi < wps.length - 1) wi++;
      a.dir = { x: dx / l, z: dz / l };
      await sleep(30);
    }
    a.dir = { x: 0, z: 0 };
    assert.equal(a.c.map?.id, "starsprout");
    await b.until(() => !b.remote(a.c.pid), 2000, "a left village room");
    const room = srv.roomOf(a.c.characterId)!;
    assert.equal(room.map, "starsprout");
    await sleep(300);
    const sp = srv.playerOf(a.c.characterId)!;
    assert.ok(getMap("starsprout").legal(sp.x, sp.z));
    // 在原野繼續移動正常、序號重新計算
    a.dir = { x: 1, z: 0 };
    await sleep(500);
    a.dir = { x: 0, z: 0 };
    await sleep(400);
    const err = Math.hypot(a.c.local.x - sp.x, a.c.local.z - sp.z);
    results.portal = { walkSeconds: +((performance.now() - t0) / 1000).toFixed(1), toRoom: room.key, fieldPos: [sp.x, sp.z], errCm: +(err * 100).toFixed(2), staleEpochInputs: sp.counters.staleEpochInputs, transfers: srv.stats.transfers };
    assert.ok(err < 0.02, `prediction ok in field (${err})`);
  } finally {
    a.stop();
    b.stop();
    await srv.stop();
  }
});

test("指令重送防護：同一 requestId 送兩次只執行一次", async () => {
  const srv = await startServer();
  const a = new Bot(srv, { name: "cmd" });
  try {
    await a.online();
    const id = a.c.command("emote", { e: "wave" });
    a.c.command("emote", { e: "wave" }, id);
    a.c.command("emote", { e: "dance" });
    a.c.command("unknown_thing", {});
    await a.until(() => a.events.filter((e) => e.type === "cmd").length === 4, 2000, "4 results");
    const res = a.events.filter((e) => e.type === "cmd") as { ok: boolean; dup: boolean; err?: string }[];
    const emote = srv.systems[0] as unknown as { executed: number };
    results.idempotency = { results: res, executed: emote.executed };
    assert.equal(res[0]!.ok, true);
    assert.equal(res[1]!.dup, true);
    assert.equal(res[2]!.err, "bad_emote");
    assert.equal(res[3]!.err, "unknown_cmd");
    assert.equal(emote.executed, 1);
  } finally {
    a.stop();
    await srv.stop();
  }
});

test("負載：40 位機器人同房間移動 8 秒（伺服器 tick 時間與封包量）", async () => {
  const srv = await startServer();
  const bots: Bot[] = [];
  try {
    for (let i = 0; i < 40; i++) bots.push(new Bot(srv, { name: `bot${i}` }));
    await Promise.all(bots.map((b) => b.online()));
    const t0 = performance.now();
    while (performance.now() - t0 < 8000) {
      const k = (performance.now() - t0) / 1000;
      bots.forEach((b, i) => (b.dir = { x: Math.sin(k + i), z: Math.cos(k * 0.7 + i) }));
      await sleep(100);
    }
    const m = srv.metrics() as { tick: { avgMs: number; maxMs: number }; netPerSec: Record<string, number>; rooms: { players: number }[] };
    const perClientDown = bots.reduce((s, b) => s + b.c.stats.bytesDownPerSec, 0) / bots.length;
    const perClientUp = bots.reduce((s, b) => s + b.c.stats.bytesUpPerSec, 0) / bots.length;
    results.load40 = { tick: m.tick, serverNetPerSec: m.netPerSec, perClientDownBps: Math.round(perClientDown), perClientUpBps: Math.round(perClientUp), roomPlayers: m.rooms.map((r) => r.players), maxSnapCorrections: Math.max(...bots.map((b) => b.c.stats.snapCorrections)) };
    assert.equal(m.rooms[0]!.players, 40);
    assert.ok(m.tick.avgMs < 10, `tick avg ${m.tick.avgMs} ms`);
  } finally {
    bots.forEach((b) => b.stop());
    await srv.stop();
  }
});

test("地圖分流：房間滿了自動開第二個頻道", async () => {
  const srv = await startServer({ roomCapacity: 2 });
  const bots = [0, 1, 2].map((i) => new Bot(srv, { name: `ch${i}` }));
  try {
    await Promise.all(bots.map((b) => b.online()));
    const rooms = bots.map((b) => b.c.room);
    results.sharding = { rooms };
    assert.deepEqual(rooms, ["village-1", "village-1", "village-2"]);
    await sleep(300);
    assert.equal(bots[2]!.c.remotes().length, 0, "channel 2 does not see channel 1");
  } finally {
    bots.forEach((b) => b.stop());
    await srv.stop();
  }
});

test("Stage 8.1：倒地前不能要求復活傳送；倒地後 respawn 由伺服器送回星芽村", async () => {
  const srv = await startServer();
  const a = new Bot(srv, { name: "down", devMap: "starsprout" });
  try {
    await a.online();
    assert.equal(a.c.map?.id, "starsprout");
    a.c.command("respawn", undefined, "respawn-early-001");
    await a.until(() => a.events.some((e) => e.type === "cmd"), 2000, "cmd result");
    const early = a.events.find((e) => e.type === "cmd") as { ok: boolean; err?: string };
    assert.equal(early.ok, false);
    assert.equal(early.err, "not_down");
    // Stage 8.2：原野的倒地由伺服器戰鬥決定 → 客戶端送 death 被忽略
    a.c.act("death");
    await sleep(300);
    assert.equal(a.c.down, false, "client cannot declare itself down");
    const sp0 = srv.playerOf(a.c.characterId)!;
    sp0.cs.hp = 0;
    sp0.down = true; // 模擬伺服器戰鬥判定倒地
    await a.until(() => a.c.down, 2000, "server says down");
    a.dir = { x: 1, z: 0 };
    await sleep(400);
    const p = srv.playerOf(a.c.characterId)!;
    const x0 = p.x;
    await sleep(300);
    assert.equal(p.x, x0, "cannot move while down");
    a.dir = { x: 0, z: 0 };
    a.c.command("respawn");
    await a.until(() => a.c.map?.id === "village", 3000, "back in village");
    await sleep(200);
    assert.equal(a.c.down, false);
    results.respawn = { early, room: a.c.room, pos: [srv.playerOf(a.c.characterId)!.x, srv.playerOf(a.c.characterId)!.z] };
  } finally {
    a.stop();
    await srv.stop();
  }
});

test("傳送陣（反方向）：從星芽原野營地傳送陣走回星芽村；伺服器位置稽核記錄是走傳送陣換地圖", async () => {
  const srv = await startServer();
  const a = new Bot(srv, { name: "homebound", devMap: "starsprout" } as never);
  try {
    await a.online();
    assert.equal(a.c.map?.id, "starsprout");
    const portal = getMap("starsprout").portals[0]!;
    const t0 = performance.now();
    while (a.c.map?.id === "starsprout" && performance.now() - t0 < 25000) {
      const dx = portal.x - a.c.local.x;
      const dz = portal.z - a.c.local.z;
      const l = Math.hypot(dx, dz) || 1;
      a.dir = { x: dx / l, z: dz / l };
      await sleep(30);
    }
    a.dir = { x: 0, z: 0 };
    assert.equal(a.c.map?.id, "village");
    const sp = srv.playerOf(a.c.characterId)!;
    assert.ok(getMap("village").legal(sp.x, sp.z));
    const tr = sp.audit.filter((x) => x.kind === "transfer").pop()!;
    assert.ok(tr && Math.hypot(tr.x - portal.x, tr.z - portal.z) < portal.armR + 0.5, "換地圖發生在營地傳送陣");
    await sleep(400);
    a.dir = { x: 0, z: 1 };
    await sleep(400);
    a.dir = { x: 0, z: 0 };
    await sleep(400);
    const err = Math.hypot(a.c.local.x - sp.x, a.c.local.z - sp.z);
    results.portalBack = { walkSeconds: +((performance.now() - t0) / 1000).toFixed(1), transferAt: [tr.x, tr.z], villagePos: [sp.x, sp.z], errCm: +(err * 100).toFixed(2) };
    assert.ok(err < 0.02, `回村後預測正常（${err}）`);
  } finally {
    a.stop();
    await srv.stop();
  }
});
