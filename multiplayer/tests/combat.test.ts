/**
 * Stage 8.2／8.3 伺服器權威戰鬥、掉落、背包測試（真的開伺服器、用 NetClient 機器人連線）。
 * 測試裡直接移動「伺服器上的角色位置」只是為了把角色放到怪物旁邊（走路已在 integration.test.ts 驗證）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { Bot, sleep, startServer } from "./helpers.ts";
import type { GameServer } from "../server/GameServer.ts";
import { MemoryStore } from "../server/persistence/Store.ts";
import type { NetEvent } from "../client/NetClient.ts";
import type { CombatEvent } from "../shared/protocol.ts";

const results: Record<string, unknown> = {};
process.on("exit", () => {
  mkdirSync(new URL("../test-results/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../test-results/combat.json", import.meta.url), JSON.stringify(results, null, 2));
});

type CmdRes = Extract<NetEvent, { type: "cmd" }>;

async function cmd(b: Bot, k: string, p?: unknown, id?: string): Promise<CmdRes> {
  const rid = b.c.command(k, p, id);
  const t0 = Date.now();
  for (;;) {
    const e = b.events.find((x): x is CmdRes => x.type === "cmd" && x.id === rid && !(x as { _seen?: boolean })._seen);
    if (e) {
      (e as { _seen?: boolean })._seen = true;
      return e;
    }
    if (Date.now() - t0 > 4000) throw new Error(`no result for ${k}`);
    await sleep(5);
  }
}

class CombatBot extends Bot {
  readonly ev: CombatEvent[] = [];
  constructor(srv: GameServer, name: string, extra: Record<string, unknown> = {}) {
    super(srv, { name, devMap: "starsprout", ...extra, onCombat: (e: CombatEvent) => this.ev.push(e) } as never);
  }
}

function room(srv: GameServer, b: Bot) {
  return srv.roomOf(b.c.characterId)!;
}
function sp(srv: GameServer, b: Bot) {
  return srv.playerOf(b.c.characterId)!;
}
/** 把伺服器上的角色放到怪物旁邊（dist 公尺，角度 a） */
function placeNear(srv: GameServer, b: Bot, nid: number, dist = 1.2, a = 0): void {
  const m = room(srv, b).combat!.monster(nid)!;
  const q = m.ctl.instance.currentPosition;
  const br = m.ctl.instance.definition.bodyRadius ?? 0;
  const p = sp(srv, b);
  p.state.x = Math.round((q.x + Math.cos(a) * (dist + br)) * 100) / 100;
  p.state.z = Math.round((q.z + Math.sin(a) * (dist + br)) * 100) / 100;
}
async function untilT(pred: () => boolean, ms: number, what: string): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`);
    await sleep(10);
  }
}
/** 一直攻擊直到怪物死亡（兩位玩家輪流） */
async function killTogether(srv: GameServer, bots: Bot[], nid: number, maxMs = 20000): Promise<{ accepted: number[]; rejected: number }> {
  const cb = room(srv, bots[0]!).combat!;
  const m = cb.monster(nid)!;
  const accepted = bots.map(() => 0);
  let rejected = 0;
  const t0 = Date.now();
  while (m.ctl.instance.isAlive) {
    if (Date.now() - t0 > maxMs) throw new Error("monster did not die");
    for (let i = 0; i < bots.length; i++) {
      placeNear(srv, bots[i]!, nid, 1.0, i * 2.1);
      const r = await cmd(bots[i]!, "atk", { t: nid });
      if (r.ok) accepted[i]!++;
      else rejected++;
    }
    await sleep(120);
  }
  return { accepted, rejected };
}

test("兩位玩家攻擊同一隻怪：雙方看到的血量一致、死亡只結算一次、兩人都拿到經驗", async () => {
  const srv = await startServer();
  const a = new CombatBot(srv, "atkA");
  const b = new CombatBot(srv, "atkB");
  try {
    await a.online();
    await b.online();
    assert.equal(room(srv, a).key, room(srv, b).key);
    const cb = room(srv, a).combat!;
    await untilT(() => a.c.monsters().length === cb.monsters.length && b.c.monsters().length === cb.monsters.length, 3000, "monsters synced");
    const nid = 1;
    const def = cb.monster(nid)!.ctl.instance.definition;
    const expA0 = sp(srv, a).cs.exp;
    const r = await killTogether(srv, [a, b], nid);
    await sleep(300);
    const dieA = a.ev.filter((e) => e.k === "die" && e.m === nid);
    const dieB = b.ev.filter((e) => e.k === "die" && e.m === nid);
    assert.equal(dieA.length, 1, "A 看到一次死亡");
    assert.equal(dieB.length, 1, "B 看到一次死亡");
    const hitsA = a.ev.filter((e): e is Extract<CombatEvent, { k: "hit" }> => e.k === "hit" && e.t === nid).map((e) => `${e.c}|${e.h}|${e.d}|${e.hp}`);
    const hitsB = b.ev.filter((e): e is Extract<CombatEvent, { k: "hit" }> => e.k === "hit" && e.t === nid).map((e) => `${e.c}|${e.h}|${e.d}|${e.hp}`);
    assert.deepEqual(hitsA, hitsB, "兩人收到同一串命中結果");
    const ma = a.c.monsters().find((m) => m.nid === nid)!;
    const mb = b.c.monsters().find((m) => m.nid === nid)!;
    assert.equal(ma.hp, 0);
    assert.equal(mb.hp, 0);
    assert.ok(["death", "dead"].includes(ma.state), `A 看到死亡狀態 (${ma.state})`);
    assert.equal(cb.counters.killsSettled, 1);
    const expEv = a.ev.filter((e) => e.k === "exp");
    assert.equal(new Set(expEv.map((e) => (e as { p: number }).p)).size, 2, "兩人都得到經驗");
    assert.equal(sp(srv, a).cs.exp - expA0, def.experience);
    results.coopKill = { monster: def.monsterId, maxHp: def.maxHp, accepted: r.accepted, rejected: r.rejected, hits: hitsA.length, killsSettled: cb.counters.killsSettled, exp: def.experience, loot: a.ev.filter((e) => e.k === "loot").length };
  } finally {
    a.stop();
    b.stop();
    await srv.stop();
  }
});

test("怪物重生同步：死亡 → 重生時間後兩位玩家都看到滿血、回到出生點", async () => {
  const srv = await startServer();
  const a = new CombatBot(srv, "rspA");
  const b = new CombatBot(srv, "rspB");
  try {
    await a.online();
    await b.online();
    const cb = room(srv, a).combat!;
    const nid = 2;
    const inst = cb.monster(nid)!.ctl.instance;
    await killTogether(srv, [a], nid);
    const tDie = Date.now();
    // 離開怪物身邊（避免一重生就被打）
    sp(srv, a).state.x += 25;
    await untilT(() => inst.isAlive && inst.currentHp === inst.definition.maxHp, (inst.definition.respawnTime + 8) * 1000, "server respawn");
    const tResp = Date.now() - tDie;
    await untilT(() => a.c.monsters().find((m) => m.nid === nid)?.hp === inst.definition.maxHp && b.c.monsters().find((m) => m.nid === nid)?.hp === inst.definition.maxHp, 2000, "clients see respawn");
    const ma = a.c.monsters().find((m) => m.nid === nid)!;
    const mb = b.c.monsters().find((m) => m.nid === nid)!;
    assert.ok(Math.hypot(ma.x - mb.x, ma.z - mb.z) < 0.3, "兩人看到同一位置");
    assert.ok(Math.hypot(ma.x - inst.spawnPosition.x, ma.z - inst.spawnPosition.z) < 1.5, "回到出生點附近");
    results.respawnSync = { respawnTime: inst.definition.respawnTime, observedMs: tResp, posA: [ma.x, ma.z], posB: [mb.x, mb.z] };
  } finally {
    a.stop();
    b.stop();
    await srv.stop();
  }
});

test("掉落物：歸屬時間內只有歸屬者能撿；兩人同時撿同一件只成功一次；重送不會重複入帳", async () => {
  const store = new MemoryStore();
  const srv = await startServer({ store });
  const a = new CombatBot(srv, "lootA");
  const b = new CombatBot(srv, "lootB");
  try {
    await a.online();
    await b.online();
    const cb = room(srv, a).combat!;
    // 殺到有掉落為止（掉落機率是測試設定；金幣每次都有 → 至少一件）
    let nid = 1;
    while (cb.loot.size < 2 && nid <= 6) {
      await killTogether(srv, [a], nid);
      nid++;
    }
    await sleep(200);
    assert.ok(cb.loot.size >= 1, "有掉落物");
    const loots = [...cb.loot.values()];
    // 1) 歸屬：A 打死的 → B 在歸屬時間內撿不到
    const l0 = loots[0]!;
    assert.equal(l0.ownerPid, a.c.pid);
    sp(srv, b).state.x = l0.x;
    sp(srv, b).state.z = l0.z;
    const notOwner = await cmd(b, "pick", { u: l0.uid });
    assert.equal(notOwner.ok, false);
    assert.equal(notOwner.err, "not_owner");
    // 2) 太遠撿不到
    sp(srv, a).state.x = l0.x + 10;
    sp(srv, a).state.z = l0.z;
    const far = await cmd(a, "pick", { u: l0.uid });
    assert.equal(far.err, "out_of_range");
    // 3) 歸屬時間結束 → 兩人「同時」撿同一件：只成功一次
    const races: unknown[] = [];
    for (const l of loots) {
      l.ownerUntil = 0;
      for (const bot of [a, b]) {
        sp(srv, bot).state.x = l.x;
        sp(srv, bot).state.z = l.z;
      }
      const ida = a.c.command("pick", { u: l.uid });
      const idb = b.c.command("pick", { u: l.uid });
      await untilT(() => a.events.some((e) => e.type === "cmd" && e.id === ida) && b.events.some((e) => e.type === "cmd" && e.id === idb), 3000, "pick results");
      const ra = a.events.find((e): e is CmdRes => e.type === "cmd" && e.id === ida)!;
      const rb = b.events.find((e): e is CmdRes => e.type === "cmd" && e.id === idb)!;
      (ra as { _seen?: boolean })._seen = (rb as { _seen?: boolean })._seen = true;
      assert.equal(Number(ra.ok) + Number(rb.ok), 1, `只有一人撿到 ${l.defId}`);
      const loser = ra.ok ? rb : ra;
      assert.ok(loser.err === "already_claimed" || loser.err === "gone", String(loser.err));
      // 4) 撿到的人重送同一個 requestId → dup，不重複入帳
      const winner = ra.ok ? a : b;
      const wid = ra.ok ? ida : idb;
      const goldBefore = (await store.get(winner.c.characterId))!.gold;
      const itemsBefore = (await store.listItems(winner.c.characterId)).length;
      const again = await cmd(winner, "pick", { u: l.uid }, wid);
      assert.equal(again.dup, true);
      const again2 = await cmd(winner, "pick", { u: l.uid });
      assert.equal(again2.ok, false, "新 requestId 撿已撿走的東西也失敗");
      assert.equal((await store.get(winner.c.characterId))!.gold, goldBefore);
      assert.equal((await store.listItems(winner.c.characterId)).length, itemsBefore);
      races.push({ defId: l.defId, qty: l.qty, winner: winner.c.name, loserErr: loser.err });
    }
    assert.equal(cb.loot.size, 0);
    // 背包與金幣：資料庫為準（起始 100 金幣＋撿到的金幣）
    const ga = (await store.get(a.c.characterId))!.gold;
    const gb = (await store.get(b.c.characterId))!.gold;
    const pickedGold = loots.filter((l) => l.defId === "gold").reduce((s, l) => s + l.qty, 0);
    assert.equal(ga + gb, 200 + pickedGold, "金幣總量＝起始＋掉落，沒有多出來");
    await untilT(() => a.c.inventory?.gold === ga && b.c.inventory?.gold === gb, 2000, "inv pushed");
    results.loot = { loots: loots.length, races, goldA: ga, goldB: gb, pickedGold, rejected: cb.counters.lootPickRejected };
  } finally {
    a.stop();
    b.stop();
    await srv.stop();
  }
});

test("防作弊：偽造傷害、超過攻速、距離外攻擊、打死掉的怪、錯誤武器的技能、未知技能", async () => {
  const srv = await startServer();
  const a = new CombatBot(srv, "cheat");
  try {
    await a.online();
    const cb = room(srv, a).combat!;
    const nid = 17; // 皇冠錘兔（900 HP）：連打也打不死
    const inst = cb.monster(nid)!.ctl.instance;
    // 1) 偽造傷害：payload 裡塞 damage，伺服器忽略
    placeNear(srv, a, nid, 1.0);
    const forged = await cmd(a, "atk", { t: nid, damage: 99999, crit: true, aspd: 999 });
    assert.equal(forged.ok, true);
    await sleep(400);
    const hit = a.ev.find((e): e is Extract<CombatEvent, { k: "hit" }> => e.k === "hit" && e.t === nid);
    assert.ok(hit, "有命中結果");
    assert.ok(hit.d <= 30, `傷害由伺服器決定 (${hit.d})`);
    assert.ok(inst.currentHp >= inst.definition.maxHp - 30);
    // 2) 攻速：2 秒內狂送 40 次攻擊 → 最多 2/0.5+1 次被接受
    await sleep(600);
    const t0 = Date.now();
    let ok = 0;
    let cool = 0;
    for (let i = 0; i < 40; i++) {
      placeNear(srv, a, nid, 1.0);
      const r = await cmd(a, "atk", { t: nid });
      if (r.ok) ok++;
      else if (r.err === "cooldown" || r.err === "busy" || r.err === "rate") cool++;
      await sleep(Math.max(0, (2000 * (i + 1)) / 40 - (Date.now() - t0)));
    }
    const secs = (Date.now() - t0) / 1000;
    const interval = cb.tuning(sp(srv, a)).attackInterval;
    assert.ok(ok <= Math.ceil(secs / interval) + 1, `接受 ${ok} 次（${secs.toFixed(2)} 秒，間隔 ${interval}）`);
    assert.ok(cool >= 40 - ok - 2);
    // 3) 距離外
    await sleep(600);
    placeNear(srv, a, nid, 8);
    const far = await cmd(a, "atk", { t: nid });
    assert.equal(far.err, "out_of_range");
    // 4) 不存在的目標
    const bad = await cmd(a, "atk", { t: 9999 });
    assert.equal(bad.err, "bad_target");
    // 5) 技能：起始武器是短劍 → 法杖技能被拒絕；未知技能被拒絕
    placeNear(srv, a, nid, 1.0);
    const wrong = await cmd(a, "sk", { s: "staff_cast", t: nid });
    assert.equal(wrong.err, "wrong_weapon");
    const unk = await cmd(a, "sk", { s: "god_mode", t: nid });
    assert.equal(unk.err, "unknown_skill");
    // 6) 技能冷卻：跳斬冷卻 2.5 秒
    await sleep(700);
    placeNear(srv, a, nid, 1.0);
    const s1 = await cmd(a, "sk", { s: "leap_slam", t: nid });
    assert.equal(s1.ok, true, String(s1.err));
    await sleep(Number((s1.data as { dur: number }).dur) + 50);
    placeNear(srv, a, nid, 1.0);
    const s2 = await cmd(a, "sk", { s: "leap_slam", t: nid });
    assert.equal(s2.err, "skill_cooldown");
    // 7) 打死之後再打
    const castsBefore = cb.counters.attacksAccepted;
    inst.receiveDamage(inst.currentHp, room(srv, a).clock, "normal");
    const dead = await cmd(a, "atk", { t: nid });
    assert.equal(dead.err, "bad_target");
    assert.equal(cb.counters.attacksAccepted, castsBefore);
    results.antiCheat = { forgedDamageResult: hit.d, spam: { sent: 40, accepted: ok, cooldownRejects: cool, seconds: +secs.toFixed(2), interval }, rejected: cb.counters.attacksRejected };
  } finally {
    a.stop();
    await srv.stop();
  }
});

test("技能：三段連擊每段只結算一次（castId＋hitId＋目標），施放中不能再普通攻擊", async () => {
  const srv = await startServer();
  const a = new CombatBot(srv, "skill");
  try {
    await a.online();
    const cb = room(srv, a).combat!;
    const nid = 17; // 皇冠錘兔（900 HP）：打不死，方便數命中
    placeNear(srv, a, nid, 1.0);
    const r = await cmd(a, "sk", { s: "triple_slash", t: nid });
    assert.equal(r.ok, true, String(r.err));
    const c = (r.data as { c: number }).c;
    const busy = await cmd(a, "atk", { t: nid });
    assert.equal(busy.err, "busy");
    await untilT(() => a.ev.some((e) => e.k === "end" && e.c === c), 4000, "skill end");
    const hits = a.ev.filter((e): e is Extract<CombatEvent, { k: "hit" }> => e.k === "hit" && e.c === c && e.t === nid);
    const ids = hits.map((h) => h.h);
    assert.equal(new Set(ids).size, ids.length, "沒有重複的命中段");
    assert.ok(ids.includes("s1") && ids.includes("s2") && ids.includes("s3"), ids.join(","));
    const cast = a.ev.find((e) => e.k === "cast" && e.c === c) as Extract<CombatEvent, { k: "cast" }>;
    assert.equal(cast.s, "triple_slash");
    results.skill = { castId: c, hits: ids, dur: cast.dur, rate: cast.r, duplicateHitsBlocked: cb.counters.duplicateHitsBlocked };
  } finally {
    a.stop();
    await srv.stop();
  }
});

test("戰鬥中斷線重連：怪物血量、角色血量／經驗保留；重新同步後可以繼續攻擊", async () => {
  const srv = await startServer({ graceMs: 5000 });
  const a = new CombatBot(srv, "recon");
  const b = new CombatBot(srv, "watch");
  try {
    await a.online();
    await b.online();
    const cb = room(srv, a).combat!;
    const nid = 8;
    placeNear(srv, a, nid, 1.0);
    const resolved0 = cb.counters.hitsResolved;
    assert.equal((await cmd(a, "atk", { t: nid })).ok, true);
    a.c.dropConnection(); // 命中前斷線：伺服器照樣在命中時間結算（命中或揮空都算結算；測試設定命中率 95%）
    await sleep(500);
    const inst = cb.monster(nid)!.ctl.instance;
    const hpAfter = inst.currentHp;
    assert.equal(cb.counters.hitsResolved, resolved0 + 1, "斷線時已送出的攻擊照常結算");
    const me = sp(srv, a);
    const keep = { hp: me.cs.hp, exp: me.cs.exp, level: me.cs.level, gold: me.cs.gold };
    await a.until(() => a.c.state === "online", 8000, "reconnected");
    await untilT(() => a.c.monsters().find((m) => m.nid === nid)?.hp === inst.currentHp, 3000, "monster hp resynced");
    await untilT(() => a.c.self?.hp === keep.hp, 2000, "self stats resynced");
    assert.equal(sp(srv, a), me, "同一個伺服器角色");
    assert.deepEqual({ hp: me.cs.hp, exp: me.cs.exp, level: me.cs.level, gold: me.cs.gold }, keep);
    // 重連後繼續攻擊（遇到 5% 揮空就再打一次）
    for (let k = 0; k < 6 && inst.currentHp >= hpAfter; k++) {
      await sleep(Math.ceil(cb.tuning(me).attackInterval * 1000) + 20);
      placeNear(srv, a, nid, 1.0);
      const again = await cmd(a, "atk", { t: nid });
      assert.equal(again.ok, true, String(again.err));
      await sleep(400);
    }
    await untilT(() => b.c.monsters().find((m) => m.nid === nid)!.hp < hpAfter, 2000, "watcher sees new damage");
    results.reconnectCombat = { hpAfterOfflineHit: hpAfter, resyncMs: a.c.stats.lastResyncMs, keep };
  } finally {
    a.stop();
    b.stop();
    await srv.stop();
  }
});

test("怪物攻擊由伺服器結算：被動怪物被打才反擊；生命歸零倒地、不能移動與攻擊；復活回村莊滿血", async () => {
  const srv = await startServer();
  const a = new CombatBot(srv, "tank");
  try {
    await a.online();
    const cb = room(srv, a).combat!;
    const nid = 3; // 星露啵啵 Lv.1 被動
    placeNear(srv, a, nid, 1.0);
    await sleep(2500);
    assert.equal(a.ev.filter((e) => e.k === "mh").length, 0, "被動怪物不會主動攻擊");
    // 被動怪物「被打到」才反擊（Claude A 規則）：揮空（測試命中率 95%）就再打一次
    const inst3 = cb.monster(nid)!.ctl.instance;
    for (let k = 0; k < 6 && !inst3.provoked; k++) {
      placeNear(srv, a, nid, 1.0);
      assert.equal((await cmd(a, "atk", { t: nid })).ok, true);
      await sleep(Math.ceil(cb.tuning(sp(srv, a)).attackInterval * 1000) + 50);
    }
    assert.ok(inst3.provoked, "被打到的被動怪物進入反擊");
    const p = sp(srv, a);
    p.cs.hp = 5; // 測試：讓角色快速倒地
    await untilT(() => a.ev.some((e) => e.k === "mh"), 8000, "monster retaliates");
    await untilT(() => p.down, 15000, "player down");
    assert.ok(a.ev.some((e) => e.k === "down" && e.p === a.c.pid));
    await untilT(() => a.c.self?.down === true && a.c.down, 2000, "client sees down");
    const atk = await cmd(a, "atk", { t: nid });
    assert.equal(atk.err, "down");
    // 客戶端假裝自己沒死：act 在原野被忽略
    a.c.act("attack");
    await sleep(200);
    assert.ok(srv.stats.actsIgnoredInCombatRoom >= 1);
    const r = await cmd(a, "respawn");
    assert.equal(r.ok, true);
    await a.until(() => a.c.map?.id === "village", 3000, "village");
    await untilT(() => a.c.self?.hp === a.c.self?.maxHp && a.c.self?.down === false, 2000, "full hp");
    results.monsterAttack = { monsterHits: cb.counters.monsterHits, downed: cb.counters.playersDowned, hpAfterRespawn: a.c.self };
  } finally {
    a.stop();
    await srv.stop();
  }
});

test("倉庫與裝備：只在村莊存取；裝備中的武器不能放倉庫；換武器後技能限制跟著改", async () => {
  const store = new MemoryStore();
  const srv = await startServer({ store });
  const a = new Bot(srv, { name: "bag" });
  try {
    await a.online();
    await untilT(() => !!a.c.inventory, 2000, "inventory");
    const inv = a.c.inventory!;
    assert.equal(inv.gold, 100, "測試起始金幣");
    const sword = inv.items.find((i) => i.defId === "test_novice_sword")!;
    const staff = inv.items.find((i) => i.defId === "test_novice_staff")!;
    assert.equal(inv.equipment.weapon, sword.uid, "起始裝備短劍");
    const eqStore = await cmd(a, "move", { u: sword.uid, to: "storage", v: sword.version });
    assert.equal(eqStore.err, "equipped");
    const mv = await cmd(a, "move", { u: staff.uid, to: "storage", v: staff.version });
    assert.equal(mv.ok, true, String(mv.err));
    await untilT(() => a.c.inventory!.items.find((i) => i.uid === staff.uid)?.location === "storage", 2000, "moved");
    // 舊版本號重送（不同 requestId）→ 版本衝突
    const stale = await cmd(a, "move", { u: staff.uid, to: "bag", v: staff.version });
    assert.equal(stale.ok, false);
    const st2 = a.c.inventory!.items.find((i) => i.uid === staff.uid)!;
    const eqFromStorage = await cmd(a, "equip", { slot: "weapon", u: staff.uid });
    assert.equal(eqFromStorage.err, "not_in_bag");
    assert.equal((await cmd(a, "move", { u: staff.uid, to: "bag", v: st2.version })).ok, true);
    const eq = await cmd(a, "equip", { slot: "weapon", u: staff.uid });
    assert.equal(eq.ok, true, String(eq.err));
    assert.equal(sp(srv, a).appearance.weapon, "staff");
    const notWeapon = await cmd(a, "equip", { slot: "nonsense", u: staff.uid });
    assert.equal(notWeapon.err, "bad_slot");
    results.storage = { gold: inv.gold, items: a.c.inventory!.items.map((i) => [i.defId, i.location]), equipment: a.c.inventory!.equipment, weapon: sp(srv, a).appearance.weapon };
  } finally {
    a.stop();
    await srv.stop();
  }
});

test("伺服器重啟（同一個資料庫）：等級、經驗、金幣、背包、裝備都還在；起始裝備不會重複發放", async () => {
  const store = new MemoryStore();
  (store as { close: () => Promise<void> }).close = async () => {}; // 模擬資料庫在伺服器重啟後仍存在
  let srv = await startServer({ store });
  let a = new CombatBot(srv, "restart");
  let token = "";
  let before: unknown;
  try {
    await a.online();
    const cb = room(srv, a).combat!;
    await killTogether(srv, [a], 4);
    await sleep(300);
    for (const l of [...cb.loot.values()]) {
      sp(srv, a).state.x = l.x;
      sp(srv, a).state.z = l.z;
      assert.equal((await cmd(a, "pick", { u: l.uid })).ok, true);
    }
    await untilT(() => srv.stats.progressSaved >= 1, 2000, "progress saved");
    const rec = (await store.get(a.c.characterId))!;
    before = { level: rec.level, exp: rec.exp, gold: rec.gold, items: (await store.listItems(rec.id)).map((i) => i.defId).sort(), weapon: rec.equipment.weapon };
    assert.ok(rec.exp > 0 || rec.level > 1, "經驗已存檔");
    token = a.c.token!;
  } finally {
    a.stop();
    await srv.stop();
  }
  srv = await startServer({ store });
  a = new CombatBot(srv, "restart", { resumeToken: token });
  try {
    await a.online();
    await untilT(() => !!a.c.inventory && !!a.c.self, 2000, "inv + stats");
    const rec = (await store.get(a.c.characterId))!;
    const after = { level: rec.level, exp: rec.exp, gold: rec.gold, items: (await store.listItems(rec.id)).map((i) => i.defId).sort(), weapon: rec.equipment.weapon };
    assert.deepEqual(after, before);
    assert.equal(a.c.self!.level, rec.level);
    assert.equal(a.c.self!.exp, rec.exp);
    assert.equal(a.c.self!.gold, rec.gold);
    results.restart = { before, after };
  } finally {
    a.stop();
    await srv.stop();
  }
});

test("跨地圖：村莊房間沒有怪物資料；從原野回村莊戰鬥數值沿用", async () => {
  const srv = await startServer();
  const a = new CombatBot(srv, "xmap");
  try {
    await a.online();
    await untilT(() => a.c.monsters().length > 0, 2000, "monsters");
    const p = sp(srv, a);
    p.cs.hp = 37;
    p.cs.statsDirty = true;
    await untilT(() => a.c.self?.hp === 37, 2000, "hp");
    // 走進原野營地傳送陣（伺服器判定）：直接放到傳送陣旁邊再往前走一步
    const auth = room(srv, a).auth;
    const portal = auth.portals[0]!;
    p.state.x = portal.x + portal.armR + 0.5;
    p.state.z = portal.z;
    await sleep(150);
    a.dir = { x: -1, z: 0 };
    await a.until(() => a.c.map?.id === "village", 6000, "village");
    a.dir = { x: 0, z: 0 };
    await sleep(300);
    assert.equal(a.c.monsters().length, 0, "村莊沒有怪物");
    assert.equal(room(srv, a).combat, null);
    assert.equal(a.c.self?.hp, 37, "生命沿用");
    results.crossMap = { from: "starsprout", to: a.c.room, hp: a.c.self?.hp };
  } finally {
    a.stop();
    await srv.stop();
  }
});

for (const n of [4, 8, 16, 40]) {
  test(`負載：${n} 位機器人在原野同時移動＋攻擊 8 秒`, async () => {
    const srv = await startServer();
    const bots: CombatBot[] = [];
    try {
      for (let i = 0; i < n; i++) bots.push(new CombatBot(srv, `L${n}_${i}`));
      await Promise.all(bots.map((b) => b.online()));
      const cb = room(srv, bots[0]!).combat!;
      const nids = cb.monsters.map((m) => m.nid);
      const t0 = Date.now();
      const tick0 = srv.stats.ticks;
      const down0 = bots.map((b) => b.c.stats.totalBytesDown);
      let sent = 0;
      while (Date.now() - t0 < 8000) {
        for (let i = 0; i < bots.length; i++) {
          const b = bots[i]!;
          const nid = nids[i % nids.length]!;
          const m = cb.monster(nid)!;
          if (room(srv, b)?.combat !== cb) continue; // 安全檢查：不在同一個原野房間的機器人不參加
          if (m.ctl.instance.isAlive && Math.random() < 0.5) {
            placeNear(srv, b, nid, 1.0, i);
            b.c.command("atk", { t: nid });
            sent++;
          } else {
            // 隨機走動但避開營地傳送陣（-56, -68）：往東偏
            const a = i + Date.now() / 900;
            b.dir = { x: 0.6 + 0.4 * Math.cos(a), z: 0.6 * Math.sin(a) };
          }
        }
        await sleep(250);
      }
      const secs = (Date.now() - t0) / 1000;
      const m = srv.metrics() as { tick: { avgMs: number; maxMs: number } };
      const downKBs = bots.map((b, i) => (b.c.stats.totalBytesDown - down0[i]!) / secs / 1024);
      const avgKBs = downKBs.reduce((s, v) => s + v, 0) / downKBs.length;
      // 每位玩家看到的怪物血量與伺服器一致
      // 停止攻擊後等進行中的命中結算完（最多 3 秒）再比對
      let mismatch = -1;
      for (let k = 0; k < 30 && mismatch !== 0; k++) {
        await sleep(100);
        mismatch = 0;
        for (const b of bots) b.dir = { x: 0, z: 0 };
      for (const b of bots) if (room(srv, b)?.combat === cb) for (const rm of b.c.monsters()) if (rm.hp !== cb.monster(rm.nid)!.ctl.instance.currentHp) mismatch++;
      }
      assert.equal(mismatch, 0, "所有玩家看到的怪物血量與伺服器一致");
      assert.ok(m.tick.avgMs < 10, `tick 平均 ${m.tick.avgMs} ms`);
      const inField = bots.filter((b) => room(srv, b)?.combat === cb).length;
      assert.equal(inField, n, "所有機器人都留在同一個原野房間");
      results[`load${n}`] = { players: n, inField, seconds: +secs.toFixed(1), ticks: srv.stats.ticks - tick0, tickAvgMs: m.tick.avgMs, tickMaxMs: m.tick.maxMs, atkSent: sent, accepted: cb.counters.attacksAccepted, kills: cb.counters.killsSettled, downKBpsPerClientAvg: +avgKBs.toFixed(2), downKBpsPerClientMax: +Math.max(...downKBs).toFixed(2) };
    } finally {
      for (const b of bots) b.stop();
      await srv.stop();
    }
  });
}

test("同一件掉落物的兩個撿取要求在資料庫寫入完成前同時進行：第二個被 already_claimed 擋下", async () => {
  // 慢速資料庫（每次寫入 150 ms）：兩個要求一定重疊
  const store = new MemoryStore();
  const slow = <T>(f: () => Promise<T>): Promise<T> => new Promise((r) => setTimeout(() => r(f()), 150));
  const g0 = store.changeGold.bind(store);
  const i0 = store.grantItem.bind(store);
  store.changeGold = (...a: Parameters<typeof g0>) => slow(() => g0(...a));
  store.grantItem = (...a: Parameters<typeof i0>) => slow(() => i0(...a));
  const srv = await startServer({ store });
  const a = new CombatBot(srv, "slowA");
  const b = new CombatBot(srv, "slowB");
  try {
    await a.online();
    await b.online();
    const cb = room(srv, a).combat!;
    await killTogether(srv, [a], 5);
    await sleep(300);
    const l = [...cb.loot.values()][0]!;
    l.ownerUntil = 0;
    const pa = sp(srv, a);
    const pb = sp(srv, b);
    for (const p of [pa, pb]) {
      p.state.x = l.x;
      p.state.z = l.z;
    }
    const [ra, rb] = await Promise.all([cb.pick(pa, l.uid), cb.pick(pb, l.uid)]);
    assert.equal(Number(ra.ok) + Number(rb.ok), 1);
    const loser = (ra.ok ? rb : ra) as { ok: false; err: string };
    assert.equal(loser.err, "already_claimed");
    results.inflightPick = { defId: l.defId, winner: ra.ok ? "A" : "B", loserErr: loser.err, lootPickRejected: cb.counters.lootPickRejected };
  } finally {
    a.stop();
    b.stop();
    await srv.stop();
  }
});
