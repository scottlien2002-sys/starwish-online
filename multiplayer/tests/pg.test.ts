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
