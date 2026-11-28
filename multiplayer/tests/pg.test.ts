/**
 * PostgreSQL 實際接入測試（需要 DATABASE_URL；由 db/test-db.sh 啟動暫時資料庫後執行）
 * 重點：伺服器重啟後資料保留、測試／正式資料區分開、背包冪等、工作階段鎖。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { PgStore } from "../server/persistence/PgStore.ts";
import { startServer, Bot, sleep } from "./helpers.ts";

const url = process.env.DATABASE_URL;
const results: Record<string, unknown> = {};
const skip = !url;

test("PostgreSQL：伺服器重啟後角色、位置、外觀保留", { skip }, async () => {
  const ap = { hair: "hair01", hairColor: "#c0408a", weapon: "staff" as const };
  let store = await PgStore.open({ url: url!, realm: "test", ssl: "disable" });
  let srv = await startServer({ store });
  const a = new Bot(srv, { name: "存檔測試", gender: "female", ap });
  await a.online();
  a.dir = { x: 1, z: 0 };
  await sleep(1200);
  a.dir = { x: 0, z: 0 };
  await sleep(400);
  const token = a.c.token!;
  const cid = a.c.characterId;
  const before = { x: srv.playerOf(cid)!.x, z: srv.playerOf(cid)!.z };
  a.stop();
  await srv.stop(); // 關閉時存檔＋關閉資料庫連線
  // 全新的伺服器程序狀態＋全新資料庫連線
  store = await PgStore.open({ url: url!, realm: "test", ssl: "disable" });
  srv = await startServer({ store });
  const b = new Bot(srv, { resumeToken: token });
  await b.online();
  try {
    const p = srv.playerOf(cid)!;
    const rec = await store.get(cid);
    results.restart = { characterId: cid, before, after: { x: p.x, z: p.z }, appearance: rec?.appearance, gender: rec?.gender, version: rec?.version, welcomeAp: b.c.appearance, welcomeGender: b.c.gender };
    assert.equal(b.c.characterId, cid, "same character after restart");
    assert.ok(Math.hypot(p.x - before.x, p.z - before.z) < 0.02, "position kept");
    assert.deepEqual(rec?.appearance, ap);
    assert.equal(rec?.gender, "female");
    assert.equal(b.c.gender, "female");
    assert.deepEqual(b.c.appearance, ap);
  } finally {
    b.stop();
    await srv.stop();
  }
});

test("PostgreSQL：測試資料區與正式資料區互不可見", { skip }, async () => {
  const t = await PgStore.open({ url: url!, realm: "test", ssl: "disable" });
  const p = await PgStore.open({ url: url!, realm: "prod", ssl: "disable" });
  const { character, token } = await t.createGuest("測試帳號", "male", { hair: "hair01", hairColor: null, weapon: "sword" }, 0);
  const prodSees = await p.findByToken(token);
  const prodGet = await p.get(character.id);
  const nTest = await t.countCharacters();
  const nProd = await p.countCharacters();
  results.realm = { testCharacters: nTest, prodCharacters: nProd, prodSeesTestToken: !!prodSees, prodGetTestCharacter: !!prodGet };
  assert.equal(prodSees, null);
  assert.equal(prodGet, null);
  assert.equal(nProd, 0);
  assert.ok(nTest >= 2);
  await t.close();
  await p.close();
});

test("PostgreSQL：背包道具 UUID、冪等給予／消耗、版本衝突", { skip }, async () => {
  const s = await PgStore.open({ url: url!, realm: "test", ssl: "disable" });
  const { character } = await s.createGuest("背包測試", "male", { hair: "hair01", hairColor: null, weapon: "sword" }, 0);
  const g1 = await s.grantItem(character.id, "req-grant-0001", "seed", 1);
  const g2 = await s.grantItem(character.id, "req-grant-0001", "seed", 1);
  const list = await s.listItems(character.id);
  assert.ok(g1.ok && g1.item);
  assert.equal(g2.dup, true);
  assert.equal(list.length, 1, "duplicate grant creates nothing");
  const uid = list[0]!.uid;
  const bad = await s.consumeItem(character.id, "req-cons-0001", uid, 9);
  const ok = await s.consumeItem(character.id, "req-cons-0002", uid, 1);
  const again = await s.consumeItem(character.id, "req-cons-0003", uid, 2);
  results.inventory = { uid, g1, g2dup: g2.dup, wrongVersion: bad, consume: ok, consumeAgain: again, after: await s.listItems(character.id) };
  assert.equal(bad.ok, false);
  assert.equal(ok.ok, true);
  assert.equal(again.ok, false);
  assert.equal((await s.listItems(character.id)).length, 0);
  await s.close();
});

test("PostgreSQL：被新連線取得工作階段鎖後，舊連線的寫入被拒", { skip }, async () => {
  const s = await PgStore.open({ url: url!, realm: "test", ssl: "disable" });
  const { character } = await s.createGuest("鎖測試", "male", { hair: "hair01", hairColor: null, weapon: "sword" }, 0);
  const e1 = await s.acquireLock(character.id);
  const w1 = await s.savePosition(character.id, 1, e1, { map: "village", x: 1, z: 2, yaw: 0 });
  const e2 = await s.acquireLock(character.id);
  const stale = await s.savePosition(character.id, 2, e1, { map: "village", x: 9, z: 9, yaw: 0 });
  const conflict = await s.savePosition(character.id, 1, e2, { map: "village", x: 9, z: 9, yaw: 0 });
  results.lock = { w1, stale, conflict };
  assert.equal(w1.ok, true);
  assert.equal(stale.ok === false && stale.reason, "stale_lock");
  assert.equal(conflict.ok === false && conflict.reason, "conflict");
  await s.close();
  mkdirSync(new URL("../reports/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../reports/pg-results.json", import.meta.url), JSON.stringify(results, null, 2));
});

test("PostgreSQL（Stage 8.2）：原野擊殺＋撿取 → 伺服器重啟後等級／經驗／金幣／背包／裝備還在；撿取與起始裝備不重複入帳", { skip }, async () => {
  type Cmd = { type: "cmd"; id: string; ok: boolean; dup: boolean; err?: string };
  const cmd = async (b: Bot, k: string, p: unknown, id?: string): Promise<Cmd> => {
    const rid = b.c.command(k, p, id);
    await b.until(() => b.events.some((e) => e.type === "cmd" && e.id === rid && !(e as { _s?: 1 })._s), 5000, k);
    const e = b.events.find((x) => x.type === "cmd" && x.id === rid && !(x as { _s?: 1 })._s) as Cmd & { _s?: 1 };
    e._s = 1;
    return e;
  };
  let store = await PgStore.open({ url: url!, realm: "test", ssl: "disable" });
  let srv = await startServer({ store });
  const a = new Bot(srv, { name: "戰鬥存檔", devMap: "starsprout" });
  await a.online();
  const cid = a.c.characterId;
  const token = a.c.token!;
  const room = srv.roomOf(cid)!;
  const cb = room.combat!;
  const m = cb.monster(1)!;
  const p = srv.playerOf(cid)!;
  while (m.ctl.instance.isAlive) {
    const q = m.ctl.instance.currentPosition;
    p.state.x = Math.round((q.x + 1) * 100) / 100;
    p.state.z = Math.round(q.z * 100) / 100;
    await cmd(a, "atk", { t: 1 });
    await sleep(150);
  }
  await sleep(300);
  const picks: { uid: string; id: string }[] = [];
  for (const l of [...cb.loot.values()]) {
    p.state.x = l.x;
    p.state.z = l.z;
    const r = await cmd(a, "pick", { u: l.uid });
    assert.equal(r.ok, true, String(r.err));
    picks.push({ uid: l.uid, id: r.id });
  }
  await sleep(500);
  const r0 = (await store.get(cid))!;
  const before = { level: r0.level, exp: r0.exp, gold: r0.gold, weapon: r0.equipment.weapon, items: (await store.listItems(cid)).map((i) => `${i.defId}:${i.uid}`).sort() };
  assert.ok(before.exp > 0, "經驗已寫入資料庫");
  assert.ok(before.gold > 100, "撿到的金幣已入帳");
  a.stop();
  await srv.stop();
  store = await PgStore.open({ url: url!, realm: "test", ssl: "disable" });
  srv = await startServer({ store });
  const b = new Bot(srv, { resumeToken: token });
  try {
    await b.online();
    await b.until(() => !!b.c.inventory && !!b.c.self, 3000, "inv");
    const r1 = (await store.get(cid))!;
    const after = { level: r1.level, exp: r1.exp, gold: r1.gold, weapon: r1.equipment.weapon, items: (await store.listItems(cid)).map((i) => `${i.defId}:${i.uid}`).sort() };
    assert.deepEqual(after, before, "重啟後完全相同（起始裝備沒有重複發放）");
    assert.equal(b.c.self!.exp, before.exp);
    assert.equal(b.c.self!.gold, before.gold);
    // 直接在資料庫層用同一個 requestId 重送撿取入帳 → 冪等
    for (const pk of picks) {
      const g = await store.changeGold(cid, `loot-${pk.uid}`, 999, "replay");
      const it = await store.grantItem(cid, `loot-${pk.uid}`, "monsterMaterial", 1);
      assert.ok((g.ok && g.dup) || (!g.ok && g.dup) || (it.ok && it.dup) || (!it.ok && it.dup), "loot requestId 已記錄");
    }
    assert.equal((await store.get(cid))!.gold, before.gold, "重送不增加金幣");
    results.combatRestart = { before, after, picks: picks.length };
  } finally {
    b.stop();
    await srv.stop();
  }
});

// ---------------- Stage 8.5：帳號、登入憑證、交易（PostgreSQL 實測） ----------------
test("PostgreSQL（Stage 8.5）：帳號名稱唯一、密碼雜湊、登入失敗鎖定、登入憑證只存雜湊且可撤銷、角色數上限", { skip }, async () => {
  const { hashPassword, verifyPassword } = await import("../server/auth/password.ts");
  const { hashToken } = await import("../server/persistence/Store.ts");
  const s = await PgStore.open({ url: url!, realm: "test", ssl: "disable" });
  const name = `pg_${Date.now().toString(36)}`;
  const hash = await hashPassword("correct horse battery");
  const a1 = await s.createAccount(name, hash, Date.now());
  const a2 = await s.createAccount(name, hash, Date.now());
  assert.equal(a1.ok, true);
  assert.equal(a2.ok, false, "同名帳號被唯一索引擋下");
  await assert.rejects(s.createAccount(name.toUpperCase(), hash, Date.now()), /accounts_username_check/, "資料庫只接受已轉小寫的名稱");
  const acc = (a1 as { account: { id: string } }).account;
  const found = await s.findAccount(name);
  assert.ok(found && found.passHash.startsWith("scrypt$") && !found.passHash.includes("correct"));
  assert.equal(await verifyPassword("correct horse battery", found!.passHash), true);
  for (let i = 0; i < 5; i++) await s.loginFailed(acc.id, Date.now(), 5, 60_000);
  const locked = await s.findAccount(name);
  assert.ok((locked!.lockedUntil ?? 0) > Date.now(), "連續失敗 5 次 → 鎖定");
  await s.loginOk(acc.id, Date.now());
  assert.equal((await s.findAccount(name))!.failedCount, 0);
  const token = "tok-" + Math.random().toString(36).slice(2);
  await s.createSession(acc.id, hashToken(token), Date.now() + 60_000, Date.now());
  assert.equal((await s.findSession(hashToken(token), Date.now()))?.accountId, acc.id);
  assert.equal(await s.findSession(token, Date.now()), null, "原始憑證查不到（只存雜湊）");
  assert.equal(await s.findSession(hashToken(token), Date.now() + 120_000), null, "過期");
  await s.revokeSession(hashToken(token), Date.now());
  assert.equal(await s.findSession(hashToken(token), Date.now()), null, "撤銷");
  const made = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => s.createCharacter(acc.id, `角${i}`, "male", { hair: "hair01", hairColor: null, weapon: "sword" }, Date.now())));
  const chars = await s.listCharacters(acc.id);
  results.pgAccounts = { username: name, lockedUntil: locked!.lockedUntil, created: made.filter(Boolean).length, listed: chars.length };
  assert.equal(made.filter(Boolean).length, 4, "同時建立 6 個 → 只成功 4 個（帳號列鎖）");
  assert.equal(chars.length, 4);
  assert.ok(chars.every((c) => c.accountId === acc.id));
  await s.close();
});

test("PostgreSQL（Stage 8.5）：交易原子交換、同一筆重送只成交一次、同一件道具同時交易給兩個人只有一筆成功", { skip }, async () => {
  const s = await PgStore.open({ url: url!, realm: "test", ssl: "disable" });
  const ap = { hair: "hair01", hairColor: null, weapon: "sword" } as const;
  const A = (await s.createGuest("交易甲", "male", ap, 0)).character;
  const B = (await s.createGuest("交易乙", "female", ap, 0)).character;
  const C = (await s.createGuest("交易丙", "male", ap, 0)).character;
  for (const c of [A, B, C]) await s.changeGold(c.id, `seed-${c.id}`, 100, "test_seed");
  const g = await s.grantItem(A.id, `grant-${A.id}`, "test_novice_staff", 1);
  const item = g.ok ? g.item! : null;
  assert.ok(item);
  const sum = async () => {
    let gold = 0;
    let items = 0;
    for (const c of [A, B, C]) {
      gold += (await s.get(c.id))!.gold;
      items += (await s.listItems(c.id)).length;
    }
    return { gold, items };
  };
  const before = await sum();
  // 同一件道具同時給 B 和 C（不同交易）→ 只有一筆成功，另一筆 version_conflict／not_owner
  const [rb, rc] = await Promise.all([
    s.trade(`trade-${crypto.randomUUID()}`, { characterId: A.id, items: [{ uid: item!.uid, version: item!.version }], gold: 10 }, { characterId: B.id, items: [], gold: 0 }),
    s.trade(`trade-${crypto.randomUUID()}`, { characterId: A.id, items: [{ uid: item!.uid, version: item!.version }], gold: 10 }, { characterId: C.id, items: [], gold: 0 }),
  ]);
  assert.equal([rb, rc].filter((r) => r.ok).length, 1, JSON.stringify([rb, rc]));
  const winner = rb.ok ? B : C;
  assert.equal((await s.listItems(winner.id)).filter((i) => i.uid === item!.uid).length, 1);
  assert.equal((await s.listItems(A.id)).length, 0);
  // 同一筆重送 → dup，不再成交
  const rid = `trade-${crypto.randomUUID()}`;
  const t1 = await s.trade(rid, { characterId: winner.id, items: [], gold: 5 }, { characterId: A.id, items: [], gold: 0 });
  const t2 = await s.trade(rid, { characterId: winner.id, items: [], gold: 5 }, { characterId: A.id, items: [], gold: 0 });
  assert.equal(t1.ok, true);
  assert.equal(t2.dup, true);
  // 金幣不足 → 整筆失敗，道具也不動
  const it2 = (await s.listItems(winner.id))[0]!;
  const bad = await s.trade(`trade-${crypto.randomUUID()}`, { characterId: winner.id, items: [{ uid: it2.uid, version: it2.version }], gold: 0 }, { characterId: A.id, items: [], gold: 99999 });
  assert.equal(bad.ok, false);
  assert.equal((await s.listItems(winner.id)).length, 1, "失敗時道具不動（原子）");
  const after = await sum();
  results.pgTrade = { concurrent: [rb, rc], resend: [t1, t2], insufficient: bad, before, after };
  assert.deepEqual(after, before, "總金幣、道具數不變");
  await s.close();
});
