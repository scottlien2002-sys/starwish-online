/**
 * Stage 8.5：多人技能施放、命中、傷害、暴擊、冷卻、位置同步稽核（3 位玩家長時間混戰）。
 * - 伺服器每個施放、每一下命中只送一次；三位玩家收到的命中內容（傷害、暴擊、剩餘血量）完全相同
 * - 血量帳目：同一隻怪連續兩下命中，後一下的剩餘血量＝前一下剩餘血量－傷害（不會重複扣血）
 * - 每次死亡只有一個「擊倒」命中、一個死亡事件
 * - 冷卻：同一玩家同一技能兩次施放的伺服器時間間隔 ≥ 冷卻
 * - 位置：結束後每位玩家看到的其他玩家位置＝伺服器位置
 * - 用戶端畫面橋接（C 的 CombatFx 介面，MpCombatFxBridge）：事件重複送兩次，畫面只畫一次；只有自己的命中顯示傷害數字
 * ⚠ 技能名稱、傷害倍率、職業平衡都是測試設定。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { Bot, sleep, startServer } from "./helpers.ts";
import type { GameServer } from "../server/GameServer.ts";
import type { CombatEvent } from "../shared/protocol.ts";
import { SKILLS, skillById } from "../../src/combat-vfx/core/skills.ts";
import { loadCombatData } from "../server/combat/data.ts";
import { COMBAT_TEST_RULES as RULES } from "../server/combat/rules.ts";
import { MpCombatFxBridge, type CombatFxPort, type Vec3 } from "../../src/net/mpCombatFxBridge.ts";
import { CombatEventDedupe } from "../../src/net/mpEventDedupe.ts";

const results: Record<string, unknown> = { note: "技能、倍率為測試設定" };
process.on("exit", () => {
  mkdirSync(new URL("../test-results/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../test-results/combat-sync.json", import.meta.url), JSON.stringify(results, null, 2));
});

type Hit = Extract<CombatEvent, { k: "hit" }>;
type Cast = Extract<CombatEvent, { k: "cast" }>;
class CombatBot extends Bot {
  readonly ev: CombatEvent[] = [];
  constructor(srv: GameServer, name: string) {
    super(srv, { name, devMap: "starsprout", onCombat: (e: CombatEvent) => this.ev.push(e) } as never);
  }
}
const sp = (srv: GameServer, b: Bot) => srv.playerOf(b.c.characterId)!;
const DATA = loadCombatData();

/** 記錄 CombatFx 呼叫的假實作（只記錄，不畫） */
function recorder() {
  const calls: { fn: string; args: unknown[] }[] = [];
  const rec = (fn: string) => (...args: unknown[]) => void calls.push({ fn, args });
  const port: CombatFxPort<Vec3> = {
    playSkill: rec("playSkill"),
    basicSwing: rec("basicSwing"),
    hit: rec("hit"),
    monsterDeath: rec("monsterDeath"),
    playerHurt: rec("playerHurt"),
  };
  return { port, calls };
}
function bridgeFor(myPid: number, gender: "male" | "female" = "male") {
  const r = recorder();
  const b = new MpCombatFxBridge<Vec3>(r.port, {
    myPid: () => myPid,
    actorId: (pid) => `p${pid}`,
    skill: (id) => {
      const def = skillById(id);
      return def ? { def, clip: DATA.clips[gender][def.clip]! } : null;
    },
    monster: () => ({ hitPoint: { x: 0, y: 1, z: 0 }, ground: { x: 0, y: 0, z: 0 }, scale: 1 }),
    myChest: () => ({ x: 0, y: 1, z: 0 }),
  });
  return { bridge: b, calls: r.calls };
}

test("三人混戰 30 秒：施放／命中只送一次、三方內容一致、血量帳目正確、冷卻、位置同步、畫面橋接不重複", async () => {
  const srv = await startServer();
  const bots = [new CombatBot(srv, "syncA"), new CombatBot(srv, "syncB"), new CombatBot(srv, "syncC")];
  try {
    for (const b of bots) await b.online();
    const room = srv.roomOf(bots[0]!.c.characterId)!;
    const cb = room.combat!;
    // 三人站在一群普通怪物附近（星露啵啵：等級低、會反擊，不是 Boss）
    const targets = cb.monsters.filter((m) => m.ctl.instance.definition.monsterId === "star_dew_bobo");
    const center = targets[0]!.ctl.instance.currentPosition;
    bots.forEach((b, i) => {
      const p = sp(srv, b);
      p.state.x = Math.round((center.x + 1.6 * Math.cos(i * 2.1)) * 100) / 100;
      p.state.z = Math.round((center.z + 1.6 * Math.sin(i * 2.1)) * 100) / 100;
    });
    await sleep(300);
    const swordSkills = SKILLS.filter((s) => s.weapon === "sword").map((s) => s.id);
    const sent = { atk: 0, sk: 0 };
    const rejects: Record<string, number> = {};
    const t0 = Date.now();
    let k = 0;
    while (Date.now() - t0 < 30_000) {
      for (const [i, b] of bots.entries()) {
        const p = sp(srv, b);
        if (p.down) {
          p.down = false;
          p.cs.hp = p.cs.maxHp; // 測試：讓玩家持續參戰（只改伺服器端，客戶端無法這樣做）
          continue;
        }
        // 最近的活著的怪物
        let best: { nid: number; d: number } | null = null;
        for (const m of cb.monsters) {
          if (!m.ctl.instance.isAlive) continue;
          const q = m.ctl.instance.currentPosition;
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (!best || d < best.d) best = { nid: m.nid, d };
        }
        if (!best) continue;
        // 太遠就把玩家放回怪物旁（測試聚焦在戰鬥同步，不測走路）
        if (best.d > 3) {
          const q = cb.monster(best.nid)!.ctl.instance.currentPosition;
          p.state.x = Math.round((q.x + 1.4 * Math.cos(i * 2.1 + k)) * 100) / 100;
          p.state.z = Math.round((q.z + 1.4 * Math.sin(i * 2.1 + k)) * 100) / 100;
          if (!room.auth.legal(p.state.x, p.state.z)) {
            p.state.x = Math.round(q.x * 100) / 100 + 1.2;
            p.state.z = Math.round(q.z * 100) / 100;
          }
        }
        const useSkill = (k + i) % 3 !== 0;
        const rid = useSkill ? b.c.command("sk", { s: swordSkills[(k + i) % swordSkills.length], t: best.nid, y: 0 }) : b.c.command("atk", { t: best.nid });
        useSkill ? sent.sk++ : sent.atk++;
        void rid;
      }
      k++;
      await sleep(260); // 刻意比冷卻、動作時間短：測試伺服器擋下過早的施放
    }
    await sleep(3000); // 等最後的命中與結束事件
    for (const b of bots) for (const e of b.events) if (e.type === "cmd" && !e.ok) rejects[e.err ?? "?"] = (rejects[e.err ?? "?"] ?? 0) + 1;

    // 1) 每位玩家：施放、命中都沒有重複
    const keysOf = (b: CombatBot) => b.ev.filter((e): e is Hit => e.k === "hit").map((h) => `${h.c}|${h.h}|${h.t}`);
    for (const b of bots) {
      const ks = keysOf(b);
      assert.equal(new Set(ks).size, ks.length, `${b.c.pid}：命中沒有重複`);
      const cs = b.ev.filter((e) => e.k === "cast").map((e) => (e as Cast).c);
      assert.equal(new Set(cs).size, cs.length, `${b.c.pid}：施放沒有重複`);
    }
    // 2) 三方內容一致
    const maps = bots.map((b) => new Map(b.ev.filter((e): e is Hit => e.k === "hit").map((h) => [`${h.c}|${h.h}|${h.t}`, `${h.p}/${h.d}/${h.cr}/${h.ms}/${h.hp}/${h.kl}`])));
    let compared = 0;
    for (const [key, v] of maps[0]!) {
      for (const m of maps.slice(1)) {
        const w = m.get(key);
        if (w === undefined) continue;
        compared++;
        assert.equal(w, v, `命中 ${key} 三方一致`);
      }
    }
    // 3) 血量帳目（以 A 收到的事件流；伺服器事件順序＝結算順序）
    const hits = bots[0]!.ev.filter((e): e is Hit => e.k === "hit" && !e.ms);
    const lastHp = new Map<number, number>();
    let ledgerChecked = 0;
    let ledgerBad = 0;
    const killsByMonster = new Map<number, number>();
    for (const e of bots[0]!.ev) {
      if (e.k === "mh") continue;
      if (e.k === "hit" && !e.ms) {
        const prev = lastHp.get(e.t);
        if (prev !== undefined && prev > 0) {
          ledgerChecked++;
          if (e.hp !== Math.max(0, prev - e.d)) ledgerBad++;
        }
        lastHp.set(e.t, e.hp);
        if (e.kl) killsByMonster.set(e.t, (killsByMonster.get(e.t) ?? 0) + 1);
      }
      if (e.k === "die") lastHp.delete(e.m); // 重生後重新開始
    }
    const deaths = bots[0]!.ev.filter((e) => e.k === "die").length;
    const killHits = hits.filter((h) => h.kl).length;
    // 4) 冷卻（伺服器施放時間）
    const casts = bots[0]!.ev.filter((e): e is Cast => e.k === "cast" && e.s !== "attack");
    let cdChecked = 0;
    let cdBad = 0;
    const lastCast = new Map<string, number>();
    for (const c of casts) {
      const key = `${c.p}|${c.s}`;
      const prev = lastCast.get(key);
      const cd = skillById(c.s)!.cooldown;
      if (prev !== undefined) {
        cdChecked++;
        if (c.st - prev < (cd - RULES.cooldownSlack) * 1000 - 5) cdBad++;
      }
      lastCast.set(key, c.st);
    }
    // 5) 位置同步
    await sleep(400);
    let posMaxCm = 0;
    for (const viewer of bots) {
      for (const other of bots) {
        if (other === viewer) continue;
        const r = viewer.remote(other.c.pid);
        const s = sp(srv, other);
        if (r) posMaxCm = Math.max(posMaxCm, Math.hypot(r.x - s.x, r.z - s.z) * 100);
      }
    }
    // 6) 畫面橋接：原樣與「每個事件送兩次」的結果相同；只有自己的命中帶傷害數字
    const bridgeRows = bots.map((b) => {
      const one = bridgeFor(b.c.pid);
      for (const e of b.ev) one.bridge.onEvent(e);
      const two = bridgeFor(b.c.pid);
      for (const e of b.ev) {
        two.bridge.onEvent(e);
        two.bridge.onEvent(e);
      }
      const ownHits = b.ev.filter((e): e is Hit => e.k === "hit" && !e.ms && e.p === b.c.pid).length;
      const otherHits = b.ev.filter((e): e is Hit => e.k === "hit" && !e.ms && e.p !== b.c.pid).length;
      const dmgCalls = one.calls.filter((c) => c.fn === "hit" && (c.args[2] as { damage?: unknown }).damage !== undefined && (c.args[2] as { damage?: unknown }).damage !== "MISS").length;
      const otherWithDmg = one.calls.filter((c) => c.fn === "hit" && (c.args[2] as { owner: string }).owner === "other" && (c.args[2] as { damage?: unknown }).damage !== undefined).length;
      return { pid: b.c.pid, stats: one.bridge.stats, calls: one.calls.length, callsDoubled: two.calls.length, duplicatesIgnored: two.bridge.stats.duplicates, ownHits, otherHits, dmgCalls, otherWithDmg };
    });
    const sv = cb.counters;
    results.sync = {
      seconds: 30,
      sent,
      rejects,
      server: { attacksAccepted: sv.attacksAccepted, duplicateHitsBlocked: sv.duplicateHitsBlocked, killsSettled: sv.killsSettled, duplicateKillsBlocked: sv.duplicateKillsBlocked, displacements: sv.displacements, dispBlocked: sv.dispBlocked },
      perBot: bots.map((b) => ({ pid: b.c.pid, casts: b.ev.filter((e) => e.k === "cast").length, hits: b.ev.filter((e) => e.k === "hit").length, crits: b.ev.filter((e) => e.k === "hit" && (e as Hit).cr === 1).length })),
      hitsCompared: compared,
      ledger: { checked: ledgerChecked, bad: ledgerBad },
      deaths,
      killHits,
      cooldown: { checked: cdChecked, bad: cdBad },
      posMaxCm: +posMaxCm.toFixed(1),
      bridge: bridgeRows,
    };
    assert.ok(compared > 50, `比對的命中數 ${compared}`);
    assert.ok(ledgerChecked > 20 && ledgerBad === 0, `血量帳目 ${ledgerBad}/${ledgerChecked}`);
    assert.equal(killHits, deaths, "每次死亡只有一個擊倒命中");
    for (const [, n] of killsByMonster) assert.ok(n >= 1);
    assert.ok(cdChecked > 5 && cdBad === 0, `冷卻 ${cdBad}/${cdChecked}`);
    assert.ok((rejects.skill_cooldown ?? 0) + (rejects.cooldown ?? 0) + (rejects.busy ?? 0) > 0, "過早的施放被伺服器擋下");
    assert.ok(posMaxCm < 5, `位置同步 ${posMaxCm} cm`);
    for (const r of bridgeRows) {
      assert.equal(r.callsDoubled, r.calls, `${r.pid}：事件送兩次，畫面只畫一次`);
      assert.ok(r.duplicatesIgnored > 0);
      assert.equal(r.dmgCalls, r.ownHits, `${r.pid}：只有自己的命中顯示傷害數字`);
      assert.equal(r.otherWithDmg, 0, `${r.pid}：其他玩家的命中不帶數字`);
      assert.equal(r.stats.hits, r.ownHits + r.otherHits, `${r.pid}：每一下命中都畫一次`);
    }
  } finally {
    for (const b of bots) b.stop();
    await srv.stop();
  }
});

test("用戶端事件去重：施放／結束／命中重複時忽略；掉落不去重（重新同步時會重送）", () => {
  const d = new CombatEventDedupe(8);
  assert.equal(d.accept({ k: "cast", c: 1 }), true);
  assert.equal(d.accept({ k: "cast", c: 1 }), false);
  assert.equal(d.accept({ k: "hit", c: 1, h: "a", t: 5 }), true);
  assert.equal(d.accept({ k: "hit", c: 1, h: "a", t: 6 }), true);
  assert.equal(d.accept({ k: "hit", c: 1, h: "a", t: 5 }), false);
  assert.equal(d.accept({ k: "loot", u: "x" }), true);
  assert.equal(d.accept({ k: "loot", u: "x" }), true);
  assert.equal(d.accept({ k: "mh" }), true);
  for (let i = 0; i < 20; i++) d.accept({ k: "cast", c: 100 + i });
  assert.equal(d.accept({ k: "cast", c: 1 }), true, "超過上限後最舊的紀錄被清掉（記憶體有上限）");
  assert.equal(d.duplicates, 2);
});
