/**
 * Stage 8.5 多人背包、裝備、倉庫、交易的伺服器資料介面（尚無正式交易畫面，交易規則為測試設定）。
 * 驗證：道具不會複製、重複交易要求只成交一次、原子交換（失敗就兩邊都不變）、斷線重連後資料一致。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { Bot, sleep, startServer } from "./helpers.ts";
import type { GameServer } from "../server/GameServer.ts";
import type { NetEvent } from "../client/NetClient.ts";
import type { TradeMsg } from "../shared/protocol.ts";
import { MemoryStore } from "../server/persistence/Store.ts";

const results: Record<string, unknown> = {};
process.on("exit", () => {
  mkdirSync(new URL("../test-results/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../test-results/trade.json", import.meta.url), JSON.stringify(results, null, 2));
});

type CmdRes = Extract<NetEvent, { type: "cmd" }>;
function send(b: Bot, k: string, p?: unknown, id?: string): Promise<CmdRes> {
  const rid = b.c.command(k, p, id);
  return waitRes(b, rid);
}
async function waitRes(b: Bot, rid: string): Promise<CmdRes> {
  const t0 = Date.now();
  for (;;) {
    const e = b.events.find((x): x is CmdRes => x.type === "cmd" && x.id === rid && !(x as { _seen?: boolean })._seen);
    if (e) {
      (e as { _seen?: boolean })._seen = true;
      return e;
    }
    if (Date.now() - t0 > 5000) throw new Error(`no result for ${k(rid)}`);
    await sleep(5);
  }
}
const k = (s: string) => s;
const trades = (b: Bot): TradeMsg[] => b.events.filter((e): e is Extract<NetEvent, { type: "trade" }> => e.type === "trade").map((e) => e.msg);
const sp = (srv: GameServer, b: Bot) => srv.playerOf(b.c.characterId)!;

async function ready(b: Bot): Promise<void> {
  await b.online();
  await b.until(() => (b.c.inventory?.items.length ?? 0) >= 2, 5000, "starter kit");
}
/** 三個人放在一起（村莊同一個房間） */
function together(srv: GameServer, bots: Bot[]): void {
  const p0 = sp(srv, bots[0]!);
  for (const b of bots.slice(1)) {
    const p = sp(srv, b);
    p.state.x = p0.x + 0.5;
    p.state.z = p0.z;
  }
}
async function snapshot(store: MemoryStore, bots: Bot[]) {
  const out: { cid: string; gold: number; items: { uid: string; defId: string; location: string; version: number }[] }[] = [];
  for (const b of bots) {
    const rec = await store.get(b.c.characterId);
    out.push({ cid: b.c.characterId, gold: rec!.gold, items: (await store.listItems(b.c.characterId)).map((i) => ({ uid: i.uid, defId: i.defId, location: i.location, version: i.version })) });
  }
  return out;
}
const totals = (s: Awaited<ReturnType<typeof snapshot>>) => ({ gold: s.reduce((a, x) => a + x.gold, 0), items: s.reduce((a, x) => a + x.items.length, 0), uids: new Set(s.flatMap((x) => x.items.map((i) => i.uid))).size });
const staffOf = (b: Bot) => b.c.inventory!.items.find((i) => i.defId === "test_novice_staff" && i.location === "bag")!;

test("交易：A 給法杖＋10 金幣、B 給 5 金幣 → 一次原子交換；兩邊背包即時更新；總金幣與道具數不變", async () => {
  const store = new MemoryStore();
  const srv = await startServer({ store });
  const a = new Bot(srv, { name: "tradeA" });
  const b = new Bot(srv, { name: "tradeB" });
  try {
    await ready(a);
    await ready(b);
    together(srv, [a, b]);
    const before = totals(await snapshot(store, [a, b]));
    const staff = staffOf(a);
    const off = await send(a, "trade", { op: "offer", to: b.c.pid, items: [{ u: staff.uid, v: staff.version }], gold: 10 });
    assert.equal(off.ok, true, String(off.err));
    const tid = (off.data as { tid: string }).tid;
    await b.until(() => trades(b).some((t) => t.ev === "offer" && t.tid === tid), 2000, "offer");
    const msg = trades(b).find((t) => t.tid === tid)!;
    assert.equal(msg.items?.[0]?.defId, "test_novice_staff");
    const acc = await send(b, "trade", { op: "accept", tid, gold: 5 });
    assert.equal(acc.ok, true, String(acc.err));
    await b.until(() => !!b.c.inventory?.items.some((i) => i.uid === staff.uid), 2000, "B inventory");
    await a.until(() => !a.c.inventory?.items.some((i) => i.uid === staff.uid), 2000, "A inventory");
    const after = await snapshot(store, [a, b]);
    assert.equal(after[0]!.gold, 100 - 10 + 5);
    assert.equal(after[1]!.gold, 100 + 10 - 5);
    assert.deepEqual(totals(after), before);
    assert.ok(trades(a).some((t) => t.ev === "done" && t.tid === tid));
    results.basic = { tid, goldA: after[0]!.gold, goldB: after[1]!.gold, totals: totals(after) };
  } finally {
    a.stop();
    b.stop();
    await srv.stop();
  }
});

test("重複交易要求：同時按兩次接受、同一 requestId 重送、完成後再接受 → 只成交一次；道具不會複製", async () => {
  const store = new MemoryStore();
  const srv = await startServer({ store });
  const a = new Bot(srv, { name: "dupA" });
  const b = new Bot(srv, { name: "dupB" });
  try {
    await ready(a);
    await ready(b);
    together(srv, [a, b]);
    const before = totals(await snapshot(store, [a, b]));
    const staff = staffOf(a);
    const off = await send(a, "trade", { op: "offer", to: b.c.pid, items: [{ u: staff.uid, v: staff.version }], gold: 30 });
    const tid = (off.data as { tid: string }).tid;
    // 同時送 3 個不同 requestId 的接受 ＋ 同一 requestId 重送
    const ids = [b.c.command("trade", { op: "accept", tid }), b.c.command("trade", { op: "accept", tid }), b.c.command("trade", { op: "accept", tid })];
    b.c.command("trade", { op: "accept", tid }, ids[0]);
    const rs = await Promise.all(ids.map((id) => waitRes(b, id)));
    const resend = await waitRes(b, ids[0]!);
    const later = await send(b, "trade", { op: "accept", tid });
    const after = await snapshot(store, [a, b]);
    assert.ok(rs.every((r) => r.ok), JSON.stringify(rs.map((r) => r.err)));
    assert.equal(resend.dup, true, "同一 requestId 重送 → dup");
    assert.equal(later.ok, true);
    assert.equal((later.data as { dup?: number }).dup, 1, "完成後再接受 → 回同一個結果、不再成交");
    assert.equal(after[0]!.gold, 70, "金幣只扣一次");
    assert.equal(after[1]!.gold, 130);
    assert.deepEqual(totals(after), before, "總金幣、道具數、唯一識別碼數量不變");
    assert.equal(after[1]!.items.filter((i) => i.uid === staff.uid).length, 1);
    assert.ok(srv.trades.stats.duplicateAccepts >= 1);
    results.duplicate = { accepts: rs.map((r) => ({ ok: r.ok, dup: r.dup })), resendDup: resend.dup, later: later.data, stats: srv.trades.stats, totals: totals(after) };
  } finally {
    a.stop();
    b.stop();
    await srv.stop();
  }
});

test("偽造與競爭：別人的道具、舊版本、負數金幣、超過持有、第三者接受、距離太遠、交易同時裝備 → 全部擋下且兩邊不變", async () => {
  const store = new MemoryStore();
  const srv = await startServer({ store });
  const a = new Bot(srv, { name: "fakeA" });
  const b = new Bot(srv, { name: "fakeB" });
  const c = new Bot(srv, { name: "fakeC" });
  try {
    await ready(a);
    await ready(b);
    await ready(c);
    together(srv, [a, b, c]);
    const s0 = await snapshot(store, [a, b, c]);
    const before = totals(s0);
    const staffA = staffOf(a);
    const staffB = staffOf(b);
    const errs: Record<string, string | undefined> = {};
    // 1) 別人的道具
    let off = await send(a, "trade", { op: "offer", to: b.c.pid, items: [{ u: staffB.uid, v: staffB.version }] });
    let r = await send(b, "trade", { op: "accept", tid: (off.data as { tid: string }).tid });
    errs.notOwner = r.err;
    assert.equal(r.err, "not_owner");
    // 2) 舊版本
    off = await send(a, "trade", { op: "offer", to: b.c.pid, items: [{ u: staffA.uid, v: staffA.version + 5 }] });
    r = await send(b, "trade", { op: "accept", tid: (off.data as { tid: string }).tid });
    errs.version = r.err;
    assert.equal(r.err, "version_conflict");
    // 3) 負數金幣、超過持有、非整數
    errs.negative = (await send(a, "trade", { op: "offer", to: b.c.pid, gold: -50 })).err;
    assert.equal(errs.negative, "bad_request");
    errs.float = (await send(a, "trade", { op: "offer", to: b.c.pid, gold: 1.5 })).err;
    assert.equal(errs.float, "bad_request");
    off = await send(a, "trade", { op: "offer", to: b.c.pid, gold: 999999 });
    r = await send(b, "trade", { op: "accept", tid: (off.data as { tid: string }).tid });
    errs.insufficient = r.err;
    assert.equal(r.err, "insufficient_gold");
    // 4) 第三者接受
    off = await send(a, "trade", { op: "offer", to: b.c.pid, gold: 1 });
    const tid4 = (off.data as { tid: string }).tid;
    errs.thirdParty = (await send(c, "trade", { op: "accept", tid: tid4 })).err;
    assert.equal(errs.thirdParty, "not_your_trade");
    // 5) 新邀請取代舊邀請（一人同時只有一個）
    off = await send(a, "trade", { op: "offer", to: c.c.pid, gold: 1 });
    await b.until(() => trades(b).some((t) => t.ev === "cancel" && t.tid === tid4), 2000, "replaced");
    errs.replaced = (await send(b, "trade", { op: "accept", tid: tid4 })).err;
    assert.equal(errs.replaced, "no_trade");
    await send(a, "trade", { op: "cancel", tid: (off.data as { tid: string }).tid });
    // 6) 距離太遠
    sp(srv, c).state.x += 20;
    errs.tooFar = (await send(a, "trade", { op: "offer", to: c.c.pid, gold: 1 })).err;
    assert.equal(errs.tooFar, "too_far");
    // 7) 同一筆交易的接受與自己裝備法杖同時發生：只會有一個結果成立
    const fresh = staffOf(a);
    off = await send(a, "trade", { op: "offer", to: b.c.pid, items: [{ u: fresh.uid, v: fresh.version }] });
    const tid7 = (off.data as { tid: string }).tid;
    const [eq, ac] = await Promise.all([send(a, "equip", { slot: "weapon", u: fresh.uid }), send(b, "trade", { op: "accept", tid: tid7 })]);
    errs.raceEquip = eq.err;
    errs.raceAccept = ac.err;
    assert.ok(eq.ok !== ac.ok, `只有一個成功（equip ${eq.ok}/${eq.err}, accept ${ac.ok}/${ac.err}）`);
    const s1 = await snapshot(store, [a, b, c]);
    assert.deepEqual(totals(s1), before, "總金幣、道具數不變");
    const owners = s1.filter((x) => x.items.some((i) => i.uid === fresh.uid));
    assert.equal(owners.length, 1, "法杖只存在一份");
    results.forged = { errors: errs, winner: eq.ok ? "equip" : "trade", totals: totals(s1) };
  } finally {
    a.stop();
    b.stop();
    c.stop();
    await srv.stop();
  }
});

test("斷線：未成交的邀請取消；重連後背包、金幣、裝備與資料庫一致", async () => {
  const store = new MemoryStore();
  const srv = await startServer({ store });
  const a = new Bot(srv, { name: "dcA" });
  const b = new Bot(srv, { name: "dcB" });
  try {
    await ready(a);
    await ready(b);
    together(srv, [a, b]);
    const staff = staffOf(a);
    const off = await send(a, "trade", { op: "offer", to: b.c.pid, items: [{ u: staff.uid, v: staff.version }], gold: 5 });
    const tid = (off.data as { tid: string }).tid;
    a.c.dropConnection();
    await b.until(() => trades(b).some((t) => t.ev === "cancel" && t.tid === tid && t.reason === "disconnected"), 3000, "cancel on disconnect");
    const acc = await send(b, "trade", { op: "accept", tid });
    assert.equal(acc.err, "no_trade");
    const n0 = a.events.filter((e) => e.type === "welcome").length;
    await a.until(() => a.events.filter((e) => e.type === "welcome").length > n0 && a.c.state === "online", 8000, "reconnect");
    await a.until(() => !!a.c.inventory && a.c.inventory.items.some((i) => i.uid === staff.uid), 3000, "inventory after reconnect");
    const rec = await store.get(a.c.characterId);
    const items = await store.listItems(a.c.characterId);
    assert.equal(a.c.inventory!.gold, rec!.gold);
    assert.deepEqual(a.c.inventory!.items.map((i) => i.uid).sort(), items.map((i) => i.uid).sort());
    assert.deepEqual(a.c.inventory!.equipment, rec!.equipment);
    assert.equal(rec!.gold, 100, "沒有成交，金幣不變");
    results.disconnect = { cancelled: true, goldAfter: rec!.gold, items: items.length, stats: srv.trades.stats };
  } finally {
    a.stop();
    b.stop();
    await srv.stop();
  }
});
