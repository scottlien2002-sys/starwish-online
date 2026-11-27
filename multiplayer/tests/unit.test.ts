import { test } from "node:test";
import assert from "node:assert/strict";
import { MOVE_SPEED, STEP, INPUT_BUDGET_MAX_S } from "../shared/constants.ts";
import { ANIM, quantizeDir, dequantizeDir } from "../shared/protocol.ts";
import { getMap } from "../shared/maps.ts";
import { stepMove, runLength, type MoveState } from "../shared/sim.ts";
import { Room, ServerPlayer } from "../server/Room.ts";
import { parseClientMsg, sanitizeName, originAllowed, TokenBucket } from "../server/security.ts";
import { RequestLedger } from "../server/RequestLedger.ts";
import { MemoryStore } from "../server/persistence/Store.ts";
import { Interpolator } from "../client/Interpolator.ts";
import { TUNING } from "../../src/config/tuning.ts";

const mkPlayer = (x: number, z: number, pid = 1) => new ServerPlayer({ pid, characterId: `c${pid}`, name: "t", gender: "male", x, z, yaw: 0, version: 1, lockEpoch: 1 });

test("移動速度與轉身沿用單機版正式數值（未變更）", () => {
  assert.equal(MOVE_SPEED, TUNING.player.moveSpeed);
  assert.equal(MOVE_SPEED, 5);
});

test("方向量化：斜向不加速、往返誤差 < 1%", () => {
  const [qx, qz] = quantizeDir(1, 1);
  const d = dequantizeDir(qx, qz);
  assert.ok(Math.hypot(d.x, d.z) <= 1 + 1e-9);
  const [ax, az] = quantizeDir(0.3, -0.4);
  const b = dequantizeDir(ax, az);
  assert.ok(Math.abs(b.x - 0.3) < 0.01 && Math.abs(b.z + 0.4) < 0.01);
  assert.deepEqual(runLength([[1, 2], [1, 2], [3, 4]]), [[1, 2, 2], [3, 4, 1]]);
});

test("客戶端預測與伺服器計算一致：每個快照的預測誤差 < 2 公分（村莊＋原野，含碰撞滑動）", () => {
  for (const id of ["village", "starsprout"] as const) {
    const m = getMap(id);
    const sp = m.spawn(0);
    const room = new Room(`${id}-t`, id, 10);
    const p = mkPlayer(sp.x, sp.z);
    room.add(p);
    // 客戶端：與 NetClient 相同的流程（每 50 ms 送 3 步；收到快照從伺服器位置重播未確認步驟）
    const c: MoveState = { x: sp.x, z: sp.z, yaw: 0, speed: 0, anim: ANIM.Idle };
    const pending: { seq: number; q: [number, number] }[] = [];
    let seq = 0;
    let maxErr = 0;
    for (let tick = 0; tick < 120; tick++) {
      const batch: [number, number][] = [];
      for (let k = 0; k < 3; k++) {
        const i = tick * 3 + k;
        const q = quantizeDir(Math.sin(i / 30), -Math.cos(i / 40));
        seq++;
        pending.push({ seq, q });
        batch.push(q);
        stepMove(c, q[0], q[1], m);
      }
      p.enqueue({ t: "in", e: 0, s: seq - 2, d: runLength(batch) });
      room.step(0.05, 0);
      // 快照到達：比較「客戶端對 ack 時刻的預測」與伺服器權威位置
      const unacked = pending.filter((x) => x.seq > p.ack);
      const s: MoveState = { x: p.x, z: p.z, yaw: p.yaw, speed: 0, anim: ANIM.Idle };
      for (const u of unacked) stepMove(s, u.q[0], u.q[1], m);
      maxErr = Math.max(maxErr, Math.hypot(s.x - c.x, s.z - c.z));
      Object.assign(c, { x: s.x, z: s.z, yaw: s.yaw });
      pending.splice(0, pending.length, ...unacked);
    }
    assert.equal(p.counters.stepsDropped, 0);
    assert.equal(p.ack, 360, `${id} all steps processed`);
    assert.ok(p.counters.stepsApplied === 360 && Math.hypot(p.x - sp.x, p.z - sp.z) > 1, `${id} moved`);
    assert.ok(maxErr < 0.02, `${id} max prediction error ${maxErr}`);
  }
});

test("加速外掛無效：一次塞 3 倍步數，伺服器位移不超過 速度×時間＋預算", () => {
  const m = getMap("village");
  const sp = m.spawn(3);
  const room = new Room("v", "village", 10);
  const p = mkPlayer(sp.x, sp.z);
  room.add(p);
  let seq = 1;
  const t = 2; // 秒
  let maxMove = 0;
  const x0 = p.x;
  const z0 = p.z;
  for (let tick = 0; tick < t * 20; tick++) {
    // 每 50 ms 送 9 步（正常是 3 步），方向朝南（遠離噴泉的開闊地）
    p.enqueue({ t: "in", e: 0, s: seq, d: [[0, -127, 9]] });
    seq += 9;
    room.step(0.05, 0);
    maxMove = Math.max(maxMove, Math.hypot(p.x - x0, p.z - z0));
  }
  const limit = MOVE_SPEED * (t + INPUT_BUDGET_MAX_S) + 0.05;
  assert.ok(maxMove <= limit, `moved ${maxMove} > ${limit}`);
  assert.ok(p.counters.stepsDropped > 0, "excess steps dropped");
  assert.equal(p.counters.speedViolations, 0);
});

test("合法區域：往噴泉、建築與地圖邊界硬走 10 秒，位置始終合法", () => {
  for (const id of ["village", "starsprout"] as const) {
    const m = getMap(id);
    const sp = m.spawn(0);
    const room = new Room("r", id, 10);
    const dirs: [number, number][] = [[0, 127], [127, 0], [0, -127], [-127, 0], [90, 90], [-90, -90]];
    for (const [dx, dz] of dirs) {
      const p = mkPlayer(sp.x, sp.z, dx * 1000 + dz);
      room.add(p);
      let seq = 1;
      for (let tick = 0; tick < 200; tick++) {
        p.enqueue({ t: "in", e: 0, s: seq, d: [[dx, dz, 3]] });
        seq += 3;
        room.step(0.05, 0);
        assert.ok(m.legal(p.x, p.z) || !m.legal(sp.x, sp.z), `${id} illegal at ${p.x},${p.z} dir ${dx},${dz}`);
      }
      room.remove(p.pid);
    }
  }
});

test("舊地圖世代與重複序號的輸入被丟棄", () => {
  const p = mkPlayer(0, -39);
  p.enqueue({ t: "in", e: 1, s: 1, d: [[0, 127, 3]] });
  assert.equal(p.queue.length, 0);
  assert.equal(p.counters.staleEpochInputs, 1);
  p.enqueue({ t: "in", e: 0, s: 1, d: [[0, 127, 3]] });
  p.enqueue({ t: "in", e: 0, s: 2, d: [[0, 127, 3]] });
  assert.equal(p.queue.length, 4);
  assert.equal(p.counters.duplicateSteps, 2);
});

test("傳送陣：踩入觸發一次，抵達後需先離開才會再觸發", () => {
  const room = new Room("v", "village", 10);
  const portal = room.auth.portals[0]!;
  const p = mkPlayer(portal.x, portal.z + portal.triggerR + 1.5);
  room.add(p);
  let fired = 0;
  let seq = 1;
  for (let i = 0; i < 40 && !fired; i++) {
    p.enqueue({ t: "in", e: 0, s: seq, d: [[0, -127, 3]] });
    seq += 3;
    fired += room.step(0.05, 0).length;
  }
  assert.equal(fired, 1);
  // 出生在傳送陣內：不會觸發
  const q = mkPlayer(portal.x, portal.z, 2);
  room.add(q);
  q.enqueue({ t: "in", e: 0, s: 1, d: [[10, 0, 3]] });
  assert.equal(room.step(0.05, 0).filter((t) => t.player === q).length, 0);
});

test("訊息格式檢查：錯誤格式、超量步數、非整數方向一律拒絕", () => {
  assert.equal(parseClientMsg("{"), null);
  assert.equal(parseClientMsg(JSON.stringify({ t: "in", e: 0, s: 1, d: [[0, 0, 999]] })), null);
  assert.equal(parseClientMsg(JSON.stringify({ t: "in", e: 0, s: 1, d: [[0.5, 0, 1]] })), null);
  assert.equal(parseClientMsg(JSON.stringify({ t: "in", e: 0, s: 1, d: [[200, 0, 1]] })), null);
  assert.equal(parseClientMsg(JSON.stringify({ t: "pos", x: 1, z: 2 })), null, "客戶端不能送位置");
  assert.equal(parseClientMsg(JSON.stringify({ t: "cmd", id: "x", k: "emote" })), null, "requestId 太短");
  assert.ok(parseClientMsg(JSON.stringify({ t: "in", e: 0, s: 1, d: [[0, 127, 3]] })));
  assert.equal(sanitizeName("<b>星願</b>\u0007", 1), "b星願/b");
  assert.equal(sanitizeName("", 7), "旅人0007");
  assert.equal(Array.from(sanitizeName("一二三四五六七八九十十一十二", 1)).length, 12);
  assert.ok(originAllowed(undefined, []));
  assert.ok(originAllowed("http://localhost:5173", []));
  assert.ok(originAllowed("https://scottlien2002-sys.github.io", ["https://scottlien2002-sys.github.io"]));
  assert.ok(!originAllowed("https://evil.example", ["https://scottlien2002-sys.github.io"]));
  const b = new TokenBucket(10, 2, 0);
  assert.ok(b.take(0) && b.take(0) && !b.take(0));
  assert.ok(b.take(200));
});

test("重複請求防護：同 requestId 只執行一次", () => {
  const l = new RequestLedger();
  let n = 0;
  const a = l.run("c1", "req-000001", 0, () => (n++, { ok: true, data: n }));
  const b = l.run("c1", "req-000001", 10, () => (n++, { ok: true, data: n }));
  const c = l.run("c2", "req-000001", 10, () => (n++, { ok: true, data: n }));
  assert.equal(n, 2);
  assert.equal(a.dup, false);
  assert.equal(b.dup, true);
  assert.deepEqual(b.entry.data, 1);
  assert.equal(c.dup, false);
});

test("存檔版本控制與工作階段鎖", async () => {
  const s = new MemoryStore();
  const { character, token } = await s.createGuest("a", "male", { hair: "hair01", hairColor: null, weapon: "sword" }, 0);
  assert.equal((await s.findByToken(token))?.id, character.id);
  assert.equal(await s.findByToken("nope"), null);
  const e1 = await s.acquireLock(character.id);
  const r1 = await s.savePosition(character.id, 1, e1, { map: "village", x: 1, z: 2, yaw: 0 }, 1);
  assert.deepEqual(r1, { ok: true, version: 2 });
  const conflict = await s.savePosition(character.id, 1, e1, { map: "village", x: 9, z: 9, yaw: 0 }, 2);
  assert.equal(conflict.ok, false);
  const e2 = await s.acquireLock(character.id);
  const stale = await s.savePosition(character.id, 2, e1, { map: "village", x: 9, z: 9, yaw: 0 }, 3);
  assert.deepEqual(stale, { ok: false, reason: "stale_lock", current: e2 });
  assert.equal((await s.get(character.id))?.x, 1);
});

test("插值：中間值正確、Idle 不外插、Run 最多外插 200 ms", () => {
  const it = new Interpolator();
  it.push({ t: 0, x: 0, z: 0, yaw: 0, anim: 1, speed: 5, link: 1 });
  it.push({ t: 100, x: 0.5, z: 0, yaw: Math.PI / 2, anim: 1, speed: 5, link: 1 });
  const mid = it.sample(50)!;
  assert.ok(Math.abs(mid.x - 0.25) < 1e-9 && Math.abs(mid.yaw - Math.PI / 4) < 1e-9);
  assert.ok(Math.abs(it.sample(1000)!.x - 1.5) < 1e-9, "extrapolate capped at 200ms");
  it.push({ t: 200, x: 0.5, z: 0, yaw: 0, anim: 0, speed: 0, link: 1 });
  assert.equal(it.sample(900)!.x, 0.5);
});

test("單步移動距離＝速度×步長", () => {
  const m = getMap("village");
  const sp = m.spawn(5);
  const s: MoveState = { x: sp.x, z: sp.z, yaw: 0, speed: 0, anim: ANIM.Idle };
  stepMove(s, 0, -127, m);
  assert.ok(Math.abs(Math.hypot(s.x - sp.x, s.z - sp.z) - MOVE_SPEED * STEP) < 1e-6);
  assert.equal(s.anim, ANIM.Run);
  stepMove(s, 0, 0, m);
  assert.equal(s.anim, ANIM.Idle);
});

test("AvatarSync（Stage 8.1 遊戲整合介面）：建立、套姿勢、切動畫、移除", async () => {
  const { AvatarSync } = await import("../client/AvatarSync.ts");
  const log: string[] = [];
  const sync = new AvatarSync((p) => ({
    setPose: (x, y, z) => log.push(`pose ${p.id} ${x},${y.toFixed(2)},${z}`),
    playAnim: (n) => log.push(`anim ${p.id} ${n}`),
    setConnected: (c) => log.push(`link ${p.id} ${c}`),
    dispose: () => log.push(`dispose ${p.id}`),
  }));
  const m = getMap("village");
  const base = { name: "a", gender: "male" as const, ap: { hair: "hair01", hairColor: null, weapon: "sword" as const }, act: 0, actSeq: 0, yaw: 0, speed: 5, link: 1 };
  sync.sync([{ id: 7, x: 0, z: -39, anim: 1, ...base }], m);
  sync.sync([{ id: 7, x: 0, z: -38, anim: 1, ...base }], m);
  sync.sync([{ id: 7, x: 0, z: -38, anim: 0, ...base, link: 0 }], m);
  sync.sync([], m);
  assert.deepEqual(log.filter((l) => !l.startsWith("pose")), ["anim 7 Run", "link 7 true", "anim 7 Idle", "link 7 false", "dispose 7"]);
  assert.equal(log.filter((l) => l.startsWith("pose")).length, 3);
  assert.equal(sync.count, 0);
});

test("Stage 8.1 動作事件：限速、倒地後不能移動也不能再送動作", () => {
  const p = mkPlayer(0, -39);
  assert.equal(p.applyAct("attack", 1571, 10), true);
  assert.equal(p.act, ANIM.Attack);
  assert.equal(p.actSeq, 1);
  assert.equal(Math.round(p.yaw * 1000), 1571);
  assert.equal(p.applyAct("attack", undefined, 10.1), false, "too fast");
  assert.equal(p.applyAct("attack", undefined, 10.3), true);
  assert.equal(p.applyAct("hurt", undefined, 10.4), true);
  assert.equal(p.act, ANIM.Hurt);
  assert.equal(p.applyAct("death", undefined, 11), true);
  assert.equal(p.tuple()[4], ANIM.Death, "tuple shows death");
  assert.equal(p.applyAct("attack", undefined, 20), false, "no attacks while down");
  p.enqueue({ t: "in", e: 0, s: 1, d: [[0, 127, 5]] });
  assert.equal(p.queue.length, 0, "no movement while down");
  assert.equal(p.counters.stepsWhileDown, 1);
  assert.equal(p.ack, 5, "sequence still advances");
});

test("Stage 8.1 外觀：用單機版 parseAppearance 驗證，不合法值回到預設", async () => {
  const { parseAppearance } = await import("../../src/core/gameSave.ts");
  assert.deepEqual(parseAppearance({ hair: "hair99", hairColor: "red", weapon: "bazooka" }), { hair: "hair01", hairColor: null, weapon: "sword" });
  assert.deepEqual(parseAppearance({ hair: "hair02", hairColor: "#C0408A", weapon: "staff" }), { hair: "hair02", hairColor: "#c0408a", weapon: "staff" });
  assert.equal(parseClientMsg(JSON.stringify({ t: "act", k: "fly" })), null);
  assert.equal(parseClientMsg(JSON.stringify({ t: "act", k: "attack", y: 99999 })), null);
  assert.ok(parseClientMsg(JSON.stringify({ t: "act", k: "attack", y: -3141 })));
  assert.equal(parseClientMsg(JSON.stringify({ t: "roan", h: 2 })), null);
});

test("Stage 8.1 N009 洛恩：伺服器時間巡邏、只有站在旁邊的玩家可以讓他停下", async () => {
  const { petMerchantPose } = await import("../../src/maps/village/petMerchant.ts");
  const room = new Room("v", "village", 10);
  const now = 1_800_000_000_000;
  const pose = petMerchantPose(room.roan!.patrolTime(now / 1000));
  const near = mkPlayer(pose.x + 1, pose.z, 1);
  const far = mkPlayer(0, -39, 2);
  room.add(near);
  room.add(far);
  assert.equal(room.roanHold(far, true, now), false, "far player rejected");
  assert.equal(room.roanState(now)![1], 0);
  assert.equal(room.roanHold(near, true, now), true);
  const s1 = room.roanState(now + 2000)!;
  assert.equal(s1[1], 1, "paused");
  assert.ok(Math.abs(s1[2] / 100 - near.x) < 0.02, "faces the talking player");
  const t1 = room.roanState(now + 4000)![0];
  assert.equal(t1, s1[0], "patrol time frozen while paused");
  room.remove(near.pid);
  const s2 = room.roanState(now + 5000)!;
  assert.equal(s2[1], 0, "leaving releases");
  // 心跳逾時（10 秒）也會自動恢復巡邏
  const pose2 = petMerchantPose(room.roan!.patrolTime((now + 6000) / 1000));
  const near2 = mkPlayer(pose2.x + 1, pose2.z, 3);
  room.add(near2);
  assert.equal(room.roanHold(near2, true, now + 6000), true);
  assert.equal(room.roanState(now + 7000)![1], 1);
  assert.equal(room.roanState(now + 17_500)![1], 0, "hold timeout");
});
