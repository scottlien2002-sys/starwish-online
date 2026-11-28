/**
 * Stage 8.5 技能位移同步（跳斬、突進與之後的位移技能）。
 * 伺服器驗證起點、終點、距離與碰撞；不能穿過岩石、樹、建築、溪流或地圖邊界；所有玩家看到同一個位置。
 * ⚠ 位移距離＝Claude C 展示動作的根運動 × SKILL_DISPLACEMENT_TEST（測試設定，非正式數值）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { Bot, sleep, startServer } from "./helpers.ts";
import type { GameServer } from "../server/GameServer.ts";
import type { NetEvent } from "../client/NetClient.ts";
import type { CombatEvent } from "../shared/protocol.ts";
import { SKILL_DISPLACEMENT_TEST } from "../server/combat/rules.ts";
import { PLAYER_RADIUS } from "../../src/maps/starsprout/route.ts";
import type { FieldTerrainQuery } from "../../src/game/fieldTerrainQuery.ts";

const results: Record<string, unknown> = { note: SKILL_DISPLACEMENT_TEST.note };
process.on("exit", () => {
  mkdirSync(new URL("../test-results/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../test-results/displacement.json", import.meta.url), JSON.stringify(results, null, 2));
});

type CmdRes = Extract<NetEvent, { type: "cmd" }>;
type Cast = Extract<CombatEvent, { k: "cast" }>;
const R = PLAYER_RADIUS * 0.9;
/** Claude C 展示動作的根運動總前進距離（public/combat-vfx/novice_combat_*.json） */
const CLIP_FORWARD: Record<string, number> = { leap_slam: 1.2, charge_burst: 0.6, triple_slash: 0.555, whirlwind: 0.25 };

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
/** 沿直線每 2 cm 檢查都能站（終點以前沒有穿過任何障礙物） */
function pathClear(tq: FieldTerrainQuery, x0: number, z0: number, x1: number, z1: number): boolean {
  const d = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.ceil(d / 0.02));
  for (let i = 0; i <= n; i++) if (!tq.canStand(x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n, R * 0.98)) return false;
  return true;
}
/** 在原野營地附近找：開闊（往 yaw 方向 1.6 m 都能站）或「前方 0.3～0.9 m 有障礙物」的位置 */
function findSpot(tq: FieldTerrainQuery, cx: number, cz: number, kind: "open" | "blocked"): { x: number; z: number; yaw: number; stop: number } {
  for (let r = 0; r < 80; r += 0.5) {
    for (let a = 0; a < 24; a++) {
      const x = Math.round((cx + Math.cos((a / 24) * Math.PI * 2) * r) * 100) / 100;
      const z = Math.round((cz + Math.sin((a / 24) * Math.PI * 2) * r) * 100) / 100;
      if (!tq.canStand(x, z, R)) continue;
      for (let k = 0; k < 16; k++) {
        const yaw = Math.round(((k / 16) * Math.PI * 2 - Math.PI) * 1000) / 1000;
        const to = { x: x + Math.sin(yaw) * 1.6, z: z + Math.cos(yaw) * 1.6 };
        const got = tq.clampMove({ x, z }, to, R);
        const stop = Math.hypot(got.x - x, got.z - z);
        if (kind === "open" && stop > 1.599) return { x, z, yaw, stop };
        if (kind === "blocked" && stop > 0.3 && stop < 0.9) return { x, z, yaw, stop };
      }
    }
  }
  throw new Error(`no ${kind} spot`);
}

async function castAt(srv: GameServer, a: CombatBot, s: string, spot: { x: number; z: number; yaw: number }): Promise<Cast> {
  const p = sp(srv, a);
  p.state.x = spot.x;
  p.state.z = spot.z;
  await sleep(120); // 讓客戶端收到新位置
  const r = await cmd(a, "sk", { s, t: 0, y: Math.round(spot.yaw * 1000) });
  assert.equal(r.ok, true, `${s}: ${r.err}`);
  const c = (r.data as { c: number }).c;
  await untilT(() => a.ev.some((e) => e.k === "cast" && e.c === c), 2000, "cast event");
  return a.ev.find((e): e is Cast => e.k === "cast" && e.c === c)!;
}

test("跳斬（測試設定）：開闊地前進根運動距離；伺服器、施放者、旁觀者三方最後位置一致；路徑沒有穿過障礙物", async () => {
  const srv = await startServer();
  const a = new CombatBot(srv, "leap");
  const b = new CombatBot(srv, "watch");
  try {
    await a.online();
    await b.online();
    const tq = room(srv, a).terrainQuery()!;
    const p = sp(srv, a);
    const spot = findSpot(tq, p.x, p.z, "open");
    const cast = await castAt(srv, a, "leap_slam", spot);
    assert.ok(cast.ex !== undefined && cast.ez !== undefined && cast.md !== undefined, "cast 事件帶有伺服器驗證的終點");
    const ex = cast.ex! / 100;
    const ez = cast.ez! / 100;
    const dist = Math.hypot(ex - spot.x, ez - spot.z);
    assert.ok(Math.abs(dist - CLIP_FORWARD.leap_slam!) < 0.03, `距離 ${dist}`);
    assert.ok(dist <= SKILL_DISPLACEMENT_TEST.maxDistance);
    // 方向＝施放朝向
    const dirErr = Math.abs(Math.atan2(Math.sin(Math.atan2(ex - spot.x, ez - spot.z) - spot.yaw), Math.cos(Math.atan2(ex - spot.x, ez - spot.z) - spot.yaw)));
    assert.ok(dirErr < 0.02, `方向誤差 ${dirErr}`);
    assert.ok(pathClear(tq, spot.x, spot.z, ex, ez), "路徑全部可站立");
    // 位移中途：伺服器位置在起點與終點之間
    await sleep(cast.md! / 2);
    const mid = Math.hypot(p.x - spot.x, p.z - spot.z);
    await untilT(() => !p.disp, 4000, "disp end");
    assert.ok(Math.abs(p.x - ex) < 0.011 && Math.abs(p.z - ez) < 0.011, `伺服器終點 ${p.x},${p.z} vs ${ex},${ez}`);
    // 施放者自己的畫面（預測＋校正）與旁觀者（插值）都收斂到同一個點
    await untilT(() => {
      const me = a.c.renderPos;
      const rb = b.remote(a.c.pid);
      return !!rb && Math.hypot(me.x - ex, me.z - ez) < 0.03 && Math.hypot(rb.x - ex, rb.z - ez) < 0.03;
    }, 3000, "clients converge");
    const rb = b.remote(a.c.pid)!;
    results.leapSlamOpen = { start: spot, end: { x: ex, z: ez }, dist: +dist.toFixed(3), clipForward: CLIP_FORWARD.leap_slam, moveMs: cast.md, midDist: +mid.toFixed(3), self: a.c.renderPos, observer: { x: rb.x, z: rb.z } };
    assert.ok(mid > 0.05 && mid < dist, `途中距離 ${mid}`);
  } finally {
    a.stop();
    b.stop();
    await srv.stop();
  }
});

test("跳斬遇到岩石／樹／邊界：停在障礙物前（距離 < 根運動）、不穿過；之後再往前一點就是不能站的位置", async () => {
  const srv = await startServer();
  const a = new CombatBot(srv, "wall");
  try {
    await a.online();
    const tq = room(srv, a).terrainQuery()!;
    const cb = room(srv, a).combat!;
    const p = sp(srv, a);
    const spot = findSpot(tq, p.x, p.z, "blocked");
    const b0 = cb.counters.dispBlocked ?? 0;
    const cast = await castAt(srv, a, "leap_slam", spot);
    assert.ok(cast.ex !== undefined, "有位移");
    const ex = cast.ex! / 100;
    const ez = cast.ez! / 100;
    const dist = Math.hypot(ex - spot.x, ez - spot.z);
    assert.ok(dist < CLIP_FORWARD.leap_slam! - 0.2, `被擋下距離 ${dist}`);
    assert.ok(Math.abs(dist - spot.stop) < 0.07, `擋下位置 ${dist} vs 判定 ${spot.stop}`);
    assert.ok(pathClear(tq, spot.x, spot.z, ex, ez), "路徑可站立");
    const ahead = { x: ex + Math.sin(spot.yaw) * 0.1, z: ez + Math.cos(spot.yaw) * 0.1 };
    assert.equal(tq.canStand(ahead.x, ahead.z, R), false, "終點再往前 10 cm 就是障礙物");
    assert.ok((cb.counters.dispBlocked ?? 0) > b0);
    await untilT(() => !p.disp, 4000, "disp end");
    assert.ok(room(srv, a).auth.legal(p.x, p.z), "終點是合法位置");
    assert.equal(p.counters.illegalPositions, 0);
    results.leapSlamBlocked = { start: spot, end: { x: ex, z: ez }, dist: +dist.toFixed(3), expectedStop: +spot.stop.toFixed(3), blockedCounter: cb.counters.dispBlocked };
  } finally {
    a.stop();
    await srv.stop();
  }
});

test("位移中的一般移動輸入：照算序號、不移動（不能邊跳斬邊走、也不會結束後補走）；結束後恢復移動", async () => {
  const srv = await startServer();
  const a = new CombatBot(srv, "input");
  try {
    await a.online();
    const tq = room(srv, a).terrainQuery()!;
    const p = sp(srv, a);
    const spot = findSpot(tq, p.x, p.z, "open");
    const sv0 = p.counters.speedViolations;
    // 往側邊推搖桿（與施放方向垂直）
    const side = { x: Math.cos(spot.yaw), z: -Math.sin(spot.yaw) };
    const cast = await castAt(srv, a, "charge_burst", spot);
    a.dir = side;
    await untilT(() => !p.disp, 4000, "disp end");
    a.dir = { x: 0, z: 0 };
    const ex = cast.ex! / 100;
    const ez = cast.ez! / 100;
    const dist = Math.hypot(ex - spot.x, ez - spot.z);
    assert.ok(Math.abs(dist - CLIP_FORWARD.charge_burst!) < 0.03, `突進距離 ${dist}`);
    const during = p.counters.stepsDuringSkill ?? 0;
    assert.ok(during > 0, "位移中有收到移動輸入（被消化但不移動）");
    // 伺服器位置＝驗證過的終點，沒有被側推
    await sleep(150);
    const sideMoved = Math.abs((p.x - ex) * side.x + (p.z - ez) * side.z);
    assert.ok(sideMoved < 0.05 + 0.25 /* 結束後最多 1 tick 正常移動 */, `側移 ${sideMoved}`);
    assert.equal(p.counters.speedViolations, sv0, "速度稽核沒有誤判");
    // 結束後可以正常走路
    const x1 = p.x;
    const z1 = p.z;
    a.dir = side;
    await untilT(() => Math.hypot(p.x - x1, p.z - z1) > 0.5, 3000, "walk after");
    a.dir = { x: 0, z: 0 };
    results.inputDuringSkill = { stepsDuringSkill: during, dist: +dist.toFixed(3), speedViolations: p.counters.speedViolations };
  } finally {
    a.stop();
    await srv.stop();
  }
});

test("各展示技能位移量（測試設定）：三段連擊、突進、旋風斬照根運動；距離不超過上限；施放中不能再施放", async () => {
  const srv = await startServer();
  const a = new CombatBot(srv, "kinds");
  try {
    await a.online();
    const tq = room(srv, a).terrainQuery()!;
    const p = sp(srv, a);
    const out: Record<string, number> = {};
    for (const s of ["triple_slash", "charge_burst", "whirlwind"]) {
      const spot = findSpot(tq, p.x, p.z, "open");
      const cast = await castAt(srv, a, s, spot);
      const again = await cmd(a, "sk", { s: "leap_slam", t: 0, y: 0 });
      assert.equal(again.ok, false, "施放中不能再施放");
      assert.ok(cast.ex !== undefined, `${s} 有位移`);
      const d = Math.hypot(cast.ex! / 100 - spot.x, cast.ez! / 100 - spot.z);
      out[s] = +d.toFixed(3);
      assert.ok(Math.abs(d - CLIP_FORWARD[s]!) < 0.03, `${s} 距離 ${d}`);
      assert.ok(d <= SKILL_DISPLACEMENT_TEST.maxDistance);
      await untilT(() => a.ev.some((e) => e.k === "end" && e.c === cast.c), 5000, "end");
      await sleep(50);
    }
    results.kinds = out;
  } finally {
    a.stop();
    await srv.stop();
  }
});

test("一般移動沒有跳躍：用移動輸入無法越過障礙物（只有伺服器驗證的技能位移會移動，且同樣不能越過）", async () => {
  const srv = await startServer();
  const a = new CombatBot(srv, "nojump");
  try {
    await a.online();
    const tq = room(srv, a).terrainQuery()!;
    const p = sp(srv, a);
    const spot = findSpot(tq, p.x, p.z, "blocked");
    p.state.x = spot.x;
    p.state.z = spot.z;
    await sleep(150);
    a.dir = { x: Math.sin(spot.yaw), z: Math.cos(spot.yaw) };
    await sleep(1500);
    a.dir = { x: 0, z: 0 };
    await sleep(150);
    // 走路會沿障礙物滑開，但不會出現在障礙物裡面
    assert.ok(room(srv, a).auth.legal(p.x, p.z), "位置合法");
    assert.equal(p.counters.illegalPositions, 0);
    results.noJump = { start: spot, after: { x: p.x, z: p.z } };
  } finally {
    a.stop();
    await srv.stop();
  }
});
