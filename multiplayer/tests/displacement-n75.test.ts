/**
 * Stage 8.5（依 Claude A《Stage 7.5 N75 多人交接》第 4 節）：伺服器權威技能位移驗證，第二批。
 * - 跳斬（leap_slam）、蓄力衝刺（charge_burst）分別對「地圖邊界」「溪流（不可通行地形）」「樹／岩石等碰撞物」：停在障礙物前，不穿過
 * - 命中判定使用位移後的位置（跳斬落地的範圍判定）
 * - 技能結束後的第一步從伺服器位置開始驗證速度
 * - 位移中斷線、倒地：位移立即停止，位置合法，重連後一致
 * ⚠ 位移距離＝Claude C 展示動作的根運動 × 測試倍率；技能名稱、正式倍率未定案。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { Bot, sleep, startServer } from "./helpers.ts";
import type { GameServer } from "../server/GameServer.ts";
import type { NetEvent } from "../client/NetClient.ts";
import type { CombatEvent } from "../shared/protocol.ts";
import { COMBAT_TEST_RULES as RULES } from "../server/combat/rules.ts";
import { MOVE_SPEED } from "../shared/constants.ts";
import { PLAYER_RADIUS } from "../../src/maps/starsprout/route.ts";
import { StarsproutTerrain, MAX_WALK_SLOPE } from "../../src/maps/starsprout/terrain.ts";
import { WALK_HALF, RIVER_HALF } from "../../src/maps/starsprout/layout.ts";
import type { FieldTerrainQuery, CircleCollider } from "../../src/game/fieldTerrainQuery.ts";

const results: Record<string, unknown> = {};
process.on("exit", () => {
  mkdirSync(new URL("../test-results/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../test-results/displacement-n75.json", import.meta.url), JSON.stringify(results, null, 2));
});

type CmdRes = Extract<NetEvent, { type: "cmd" }>;
type Cast = Extract<CombatEvent, { k: "cast" }>;
const R = PLAYER_RADIUS * 0.9;
const FWD: Record<string, number> = { leap_slam: 1.2, charge_burst: 0.6 };
const terrain = new StarsproutTerrain();

class CombatBot extends Bot {
  readonly ev: CombatEvent[] = [];
  constructor(srv: GameServer, name: string) {
    super(srv, { name, devMap: "starsprout", onCombat: (e: CombatEvent) => this.ev.push(e) } as never);
  }
}
async function cmd(b: Bot, k: string, p?: unknown): Promise<CmdRes> {
  const rid = b.c.command(k, p);
  const t0 = Date.now();
  for (;;) {
    const e = b.events.find((x): x is CmdRes => x.type === "cmd" && x.id === rid);
    if (e) return e;
    if (Date.now() - t0 > 4000) throw new Error(`no result for ${k}`);
    await sleep(5);
  }
}
const sp = (srv: GameServer, b: Bot) => srv.playerOf(b.c.characterId)!;
const room = (srv: GameServer, b: Bot) => srv.roomOf(b.c.characterId)!;
async function untilT(pred: () => boolean, ms: number, what: string): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`);
    await sleep(10);
  }
}
/** 不能站的原因：地圖邊界／溪流／陡坡／碰撞物 */
function reason(tq: FieldTerrainQuery, x: number, z: number): "boundary" | "river" | "slope" | "collider" | "ok" {
  if (Math.abs(x) > WALK_HALF || Math.abs(z) > WALK_HALF) return "boundary";
  if (!terrain.walkable(x, z)) {
    if (terrain.river(x, z).d < RIVER_HALF + 0.3) return "river";
    if (terrain.slopeDeg(x, z) > MAX_WALK_SLOPE) return "slope";
    return "boundary";
  }
  return tq.canStand(x, z, R) ? "ok" : "collider";
}
function pathClear(tq: FieldTerrainQuery, x0: number, z0: number, x1: number, z1: number): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.02));
  for (let i = 0; i <= n; i++) if (!tq.canStand(x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n, R * 0.98)) return false;
  return true;
}
type Spot = { x: number; z: number; yaw: number; stop: number; kind: string };
/** 擋住距離在 [lo, hi] 之間、擋住原因＝kind 的起點 */
function trySpot(tq: FieldTerrainQuery, x: number, z: number, yaw: number, kind: string, lo: number, hi: number): Spot | null {
  x = Math.round(x * 100) / 100;
  z = Math.round(z * 100) / 100;
  if (!tq.canStand(x, z, R)) return null;
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  const got = tq.clampMove({ x, z }, { x: x + dx * 1.6, z: z + dz * 1.6 }, R);
  const stop = Math.hypot(got.x - x, got.z - z);
  if (stop < lo || stop > hi) return null;
  if (reason(tq, got.x + dx * 0.08, got.z + dz * 0.08) !== kind) return null;
  return { x, z, yaw, stop, kind };
}
function findBoundary(tq: FieldTerrainQuery, lo: number, hi: number): Spot {
  for (const side of [1, -1]) {
    for (let t = -60; t <= 60; t += 1.5) {
      for (let off = 0.2; off <= 1.0; off += 0.05) {
        const s = trySpot(tq, side * (WALK_HALF - off), t, side > 0 ? Math.PI / 2 : -Math.PI / 2, "boundary", lo, hi);
        if (s) return s;
      }
    }
  }
  throw new Error("no boundary spot");
}
function findRiver(tq: FieldTerrainQuery, lo: number, hi: number): Spot {
  for (let x = -78; x <= 78; x += 1) {
    for (let z = -78; z <= 78; z += 1) {
      const d = terrain.river(x, z).d;
      if (d < RIVER_HALF + 0.3 + lo || d > RIVER_HALF + 0.3 + hi + 0.3) continue;
      // 朝向溪流：距離函數下降最快的方向
      const e = 0.2;
      const gx = terrain.river(x + e, z).d - terrain.river(x - e, z).d;
      const gz = terrain.river(x, z + e).d - terrain.river(x, z - e).d;
      const yaw = Math.atan2(-gx, -gz);
      const s = trySpot(tq, x, z, yaw, "river", lo, hi);
      if (s) return s;
    }
  }
  throw new Error("no river spot");
}
function findCollider(tq: FieldTerrainQuery, lo: number, hi: number): Spot {
  const cols = (tq as unknown as { colliders: readonly CircleCollider[] }).colliders;
  for (const c of cols) {
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      for (const gap of [0.35, 0.45, 0.6, 0.8]) {
        const d = c.r + R + gap;
        const x = c.x + Math.sin(ang) * d;
        const z = c.z + Math.cos(ang) * d;
        const s = trySpot(tq, x, z, Math.atan2(c.x - x, c.z - z), "collider", lo, hi);
        if (s) return s;
      }
    }
  }
  throw new Error("no collider spot");
}

async function castAt(srv: GameServer, a: CombatBot, s: string, spot: { x: number; z: number; yaw: number }, t = 0): Promise<Cast> {
  const p = sp(srv, a);
  p.state.x = spot.x;
  p.state.z = spot.z;
  await sleep(120);
  const r = await cmd(a, "sk", { s, t, y: Math.round(spot.yaw * 1000) });
  assert.equal(r.ok, true, `${s}: ${r.err}`);
  const c = (r.data as { c: number }).c;
  await untilT(() => a.ev.some((e) => e.k === "cast" && e.c === c), 2000, "cast event");
  return a.ev.find((e): e is Cast => e.k === "cast" && e.c === c)!;
}

test("跳斬、蓄力衝刺 × 地圖邊界／溪流／碰撞物：停在障礙物前、不穿過、路徑全部可站、旁觀者位置一致", async () => {
  const srv = await startServer();
  const bots: CombatBot[] = [];
  const rows: unknown[] = [];
  try {
    const watch = new CombatBot(srv, "watch");
    bots.push(watch);
    await watch.online();
    const tq = room(srv, watch).terrainQuery()!;
    let i = 0;
    for (const skill of ["leap_slam", "charge_burst"]) {
      const fwd = FWD[skill]!;
      // 障礙物在根運動距離之內才會擋住
      const lo = 0.15;
      const hi = fwd - 0.2;
      for (const kind of ["boundary", "river", "collider"]) {
        const spot = kind === "boundary" ? findBoundary(tq, lo, hi) : kind === "river" ? findRiver(tq, lo, hi) : findCollider(tq, lo, hi);
        if (process.env.DBG) console.log("spot", skill, kind, JSON.stringify(spot));
        const a = new CombatBot(srv, `d${i++}`);
        bots.push(a);
        await a.online();
        const cast = await castAt(srv, a, skill, spot);
        assert.ok(cast.ex !== undefined, `${skill}/${kind}：有位移`);
        const ex = cast.ex! / 100;
        const ez = cast.ez! / 100;
        const dist = Math.hypot(ex - spot.x, ez - spot.z);
        const p = sp(srv, a);
        await untilT(() => !p.disp, 4000, "disp end");
        // 旁觀者把觀察者搬到附近才看得到（同一房間都會收到）
        await untilT(() => {
          const rr = watch.remote(a.c.pid);
          return !!rr && Math.hypot(rr.x - ex, rr.z - ez) < 0.03;
        }, 3000, "observer");
        const beyond = reason(tq, ex + Math.sin(spot.yaw) * 0.1, ez + Math.cos(spot.yaw) * 0.1);
        const row = { skill, kind, start: { x: spot.x, z: spot.z }, yaw: spot.yaw, expectedStop: +spot.stop.toFixed(3), dist: +dist.toFixed(3), clipForward: fwd, beyond, server: { x: p.x, z: p.z }, legal: room(srv, a).auth.legal(p.x, p.z) };
        rows.push(row);
        assert.ok(dist < fwd - 0.1, `${skill}/${kind} 被擋下（${dist}）`);
        assert.ok(Math.abs(dist - spot.stop) < 0.08, `${skill}/${kind} 停在擋住位置 ${dist} vs ${spot.stop}`);
        assert.ok(pathClear(tq, spot.x, spot.z, ex, ez), `${skill}/${kind} 路徑可站`);
        assert.equal(beyond, kind, `${skill}/${kind}：再往前 10 cm 就是${kind}`);
        assert.ok(row.legal, "終點合法");
        assert.equal(p.counters.illegalPositions, 0);
      }
    }
    results.obstacles = rows;
  } finally {
    for (const b of bots) b.stop();
    await srv.stop();
  }
});

test("跳斬的範圍判定用落地位置：起點打不到、落地打得到的怪物被命中", async () => {
  const srv = await startServer();
  const a = new CombatBot(srv, "landing");
  try {
    await a.online();
    const rm = room(srv, a);
    const tq = rm.terrainQuery()!;
    const cb = rm.combat!;
    const p = sp(srv, a);
    const radius = 2.6; // C 的跳斬命中範圍（circle, center self）
    let done = false;
    for (const m of cb.monsters) {
      if (done) break;
      const inst = m.ctl.instance;
      if (!inst.isAlive || inst.definition.level >= 9) continue;
      const br = inst.definition.bodyRadius ?? 0;
      const q = inst.currentPosition;
      // 起點到怪物外緣＝範圍＋寬限＋0.45 m（打不到）；跳斬前進 1.2 m 後在範圍內 0.75 m
      const D = radius + RULES.latencySlack + br + 0.45;
      for (let k = 0; k < 16 && !done; k++) {
        const ang = (k / 16) * Math.PI * 2;
        const sx = q.x + Math.sin(ang) * D;
        const sz = q.z + Math.cos(ang) * D;
        const yaw = Math.atan2(q.x - sx, q.z - sz);
        if (!tq.canStand(sx, sz, R)) continue;
        const got = tq.clampMove({ x: sx, z: sz }, { x: sx + Math.sin(yaw) * 1.25, z: sz + Math.cos(yaw) * 1.25 }, R);
        if (Math.hypot(got.x - sx, got.z - sz) < 1.24) continue;
        const hp0 = inst.currentHp;
        await untilT(() => !(p.cs.cds.get("leap_slam")! > rm.clock), 4000, "cooldown");
        const n0 = a.ev.length;
        let cast: Cast;
        try {
          cast = await castAt(srv, a, "leap_slam", { x: sx, z: sz, yaw }, m.nid);
        } catch {
          break; // 怪物剛好走開（距離外）或被打倒：換一隻
        }
        await untilT(() => a.ev.slice(n0).some((e) => e.k === "end" && e.c === cast.c), 5000, "end");
        const hits = a.ev.slice(n0).filter((e): e is Extract<CombatEvent, { k: "hit" }> => e.k === "hit" && e.c === cast.c && e.t === m.nid);
        const q2 = inst.currentPosition;
        const startGap = Math.hypot(q2.x - sx, q2.z - sz) - br;
        const landGap = Math.hypot(q2.x - p.x, q2.z - p.z) - br;
        results.landing = { monster: inst.definition.monsterId, startGapM: +startGap.toFixed(2), landGapM: +landGap.toFixed(2), radius, slack: RULES.latencySlack, hits: hits.map((h) => ({ d: h.d, cr: h.cr, ms: h.ms })), hp: [hp0, inst.currentHp] };
        if (startGap <= radius + RULES.latencySlack || hits.length === 0) break; // 怪物自己走動了：換一隻
        assert.ok(hits.length === 1 && hits[0]!.d > 0 && hits[0]!.ms === 0, `落地命中 ${JSON.stringify(hits)}`);
        assert.ok(landGap <= radius + RULES.latencySlack, "命中時在落地位置的範圍內");
        done = true;
      }
    }
    assert.ok(done, "找到可測試的怪物");
  } finally {
    a.stop();
    await srv.stop();
  }
});

test("技能結束後第一步：從伺服器位置開始、照一般速度上限；位移中斷線 → 位移停止、重連後位置一致；倒地 → 位移停止", async () => {
  const srv = await startServer();
  const a = new CombatBot(srv, "after");
  const b = new CombatBot(srv, "watch2");
  try {
    await a.online();
    await b.online();
    const tq = room(srv, a).terrainQuery()!;
    const p = sp(srv, a);
    const portals = room(srv, a).auth.portals;
    const open = (() => {
      for (let r = 0; r < 60; r += 0.5) for (let k = 0; k < 16; k++) {
        const x = Math.round((p.x + Math.cos(k) * r) * 100) / 100;
        const z = Math.round((p.z + Math.sin(k) * r) * 100) / 100;
        const yaw = ((k * 7) % 16) / 16 * Math.PI * 2 - Math.PI;
        if (!tq.canStand(x, z, R)) continue;
        // 離傳送陣 10 m 以上（避免落點在傳送陣上、結束後走一步就換地圖）
        if (portals.some((po) => Math.hypot(po.x - x, po.z - z) < 10 || Math.hypot(po.x - (x + Math.sin(yaw) * 3), po.z - (z + Math.cos(yaw) * 3)) < 10)) continue;
        const got = tq.clampMove({ x, z }, { x: x + Math.sin(yaw) * 3, z: z + Math.cos(yaw) * 3 }, R);
        if (Math.hypot(got.x - x, got.z - z) > 2.99) return { x, z, yaw };
      }
      throw new Error("no open spot");
    })();
    // 1) 結束後第一步
    const c1 = await castAt(srv, a, "leap_slam", open);
    await untilT(() => !p.disp, 4000, "disp end");
    const ex = c1.ex! / 100;
    const ez = c1.ez! / 100;
    const sv0 = p.counters.speedViolations;
    const t0 = performance.now();
    a.dir = { x: Math.sin(open.yaw), z: Math.cos(open.yaw) };
    await sleep(500);
    a.dir = { x: 0, z: 0 };
    const el = (performance.now() - t0) / 1000;
    const moved = Math.hypot(p.x - ex, p.z - ez);
    results.firstStep = { moveSpeed: MOVE_SPEED, from: { x: ex, z: ez }, movedM: +moved.toFixed(2), seconds: +el.toFixed(2), speedViolations: p.counters.speedViolations - sv0 };
    assert.equal(room(srv, a).auth.id, "starsprout");
    assert.ok(moved > 0.3, "結束後可以移動");
    assert.ok(moved <= MOVE_SPEED * (el + 0.3), `第一步起點是伺服器位置，沒有累積的位移（${moved} m / ${el} s）`);
    assert.equal(p.counters.speedViolations, sv0);
    // 2) 位移中斷線
    await sleep(2600); // 冷卻
    const start2 = { x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, yaw: open.yaw + Math.PI };
    const c2 = await castAt(srv, a, "leap_slam", start2);
    await sleep(Math.round((c2.md ?? 800) * 0.4));
    a.c.dropConnection();
    await untilT(() => !p.connected, 3000, "server sees disconnect");
    await sleep(100);
    const frozen = { x: p.x, z: p.z };
    await sleep(600);
    assert.equal(p.disp, null, "斷線 → 位移停止");
    assert.deepEqual({ x: p.x, z: p.z }, frozen, "斷線後伺服器位置不再移動");
    assert.ok(room(srv, a).auth.legal(p.x, p.z));
    await untilT(() => a.c.state === "online", 8000, "reconnect");
    await untilT(() => Math.hypot(a.c.renderPos.x - p.x, a.c.renderPos.z - p.z) < 0.03, 3000, "self consistent");
    const rb = b.remote(a.c.pid);
    await untilT(() => !!b.remote(a.c.pid) && Math.hypot(b.remote(a.c.pid)!.x - p.x, b.remote(a.c.pid)!.z - p.z) < 0.03, 3000, "observer consistent");
    results.disconnect = { start: start2, frozen, end: { x: c2.ex! / 100, z: c2.ez! / 100 }, partialM: +Math.hypot(frozen.x - start2.x, frozen.z - start2.z).toFixed(3), self: a.c.renderPos, observer: rb ? { x: rb.x, z: rb.z } : null };
    // 3) 位移中倒地（伺服器判定倒地）
    await sleep(2600);
    const start3 = { x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, yaw: open.yaw };
    const c3 = await castAt(srv, a, "leap_slam", start3);
    await sleep(Math.round((c3.md ?? 800) * 0.3));
    p.cs.hp = 0;
    p.down = true;
    await sleep(150);
    const f3 = { x: p.x, z: p.z };
    await sleep(500);
    assert.equal(p.disp, null, "倒地 → 位移停止");
    assert.deepEqual({ x: p.x, z: p.z }, f3);
    assert.ok(room(srv, a).auth.legal(p.x, p.z));
    results.down = { start: start3, stoppedAt: f3, partialM: +Math.hypot(f3.x - start3.x, f3.z - start3.z).toFixed(3) };
  } finally {
    a.stop();
    b.stop();
    await srv.stop();
  }
});
