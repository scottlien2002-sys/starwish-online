import { test } from "node:test";
import assert from "node:assert/strict";
import { ARENA, BRIDGES, MAIN_ROUTE, MONSTER_SIZES, POIS, PORTAL, RIVER, WALK_HALF, ZONES } from "../../src/maps/starsprout/layout.ts";
import { MAIN_PATH, StarsproutTerrain, analyticHeight, nearestOnPolyline, resolveMove } from "../../src/maps/starsprout/terrain.ts";
import { ARCH_POSTS, MAP_COLLIDERS, PLAYER_RADIUS, RUIN_PILLARS, routeTable, simulateRoute } from "../../src/maps/starsprout/route.ts";
import { terrainColor } from "../../src/maps/starsprout/colors.ts";
import { TUNING } from "../../src/config/tuning.ts";

const T = new StarsproutTerrain();

test("星芽原野：只有七種怪物，名稱、等級、上限與確認一致，沒有焰尾狐", () => {
  const spawn = ZONES.filter((z) => z.monster);
  assert.deepEqual(
    spawn.map((z) => [z.id, z.monster, z.level, z.cap]),
    [
      ["01", "星露啵啵", "1～2", 6],
      ["02", "苔角獸", "3～4", 5],
      ["03", "雲絨鳥", "5～6", 5],
      ["04", "風羽狐", "7", 4],
      ["05", "星雲咩咩", "8", 4],
      ["06", "胡蘿蔔大王", "9", 2],
      ["07", "王冠重錘兔（Boss）", "10", 1],
    ],
  );
  assert.ok(!JSON.stringify(ZONES).includes("焰尾狐"));
  assert.deepEqual(
    MONSTER_SIZES.map((m) => [m.name, m.heightM]),
    [["星露啵啵", 1.1], ["苔角獸", 1.2], ["雲絨鳥", 1.0], ["風羽狐", 1.1], ["星雲咩咩", 1.15], ["胡蘿蔔大王", 1.65], ["王冠重錘兔", 2.7]],
  );
});

test("星芽原野：路線速度與遊戲相同（5 m/s）", () => {
  assert.equal(TUNING.player.moveSpeed, 5);
});

test("星芽原野：路線點高度與設計相同、都可以站立", () => {
  for (const p of MAIN_ROUTE) {
    assert.ok(Math.abs(T.surface(p.x, p.z) - p.y) < 0.06, `${p.id} 高度 ${T.surface(p.x, p.z)} ≠ ${p.y}`);
    assert.ok(T.walkable(p.x, p.z), `${p.id} 不可走`);
  }
});

test("星芽原野：主路線長度約 300 公尺、每段坡度 ≤ 22°", () => {
  const tb = routeTable();
  const total = tb[tb.length - 1]!.cum;
  assert.ok(total > 285 && total < 315, `主路線 ${total}`);
  for (const s of tb) assert.ok(s.slopeDeg <= 22.5, `${s.from}→${s.to} 坡度 ${s.slopeDeg.toFixed(1)}°`);
});

test("星芽原野：以 5 m/s 實際模擬走完主路線約 60 秒，沒有卡住", () => {
  const r = simulateRoute(T);
  assert.ok(r.reached, `沒走到傳送門：${JSON.stringify(r.stuck)}`);
  assert.equal(r.stuck.length, 0);
  assert.ok(r.seconds > 52 && r.seconds < 66, `用時 ${r.seconds.toFixed(1)} 秒`);
  assert.ok(r.maxSlopeDeg <= 25, `最大坡度 ${r.maxSlopeDeg.toFixed(1)}°`);
  // 依序經過所有路線點
  assert.deepEqual(r.checkpoints.map((c) => c.id), MAIN_ROUTE.map((p) => p.id));
  // 低幀率（15 FPS）也一樣走得完
  const slow = simulateRoute(T, { dt: 1 / 15 });
  assert.ok(slow.reached && slow.stuck.length === 0, "15 FPS 時卡住");
  assert.ok(Math.abs(slow.seconds - r.seconds) < 2);
});

test("星芽原野：B1、B2 橋可通行，橋下與兩側是水、不可走", () => {
  for (const b of BRIDGES) {
    const mid = T.bridgeAt(b.cx, b.cz);
    assert.ok(mid, `${b.id} 中央不在橋上`);
    assert.ok(T.walkable(b.cx, b.cz), `${b.id} 中央不可走`);
    const water = T.river(b.cx, b.cz).water;
    assert.ok(mid!.deckY - water >= 1.2, `${b.id} 橋面離水面太近`);
    // 每 0.5 公尺沿橋中線都可走
    for (let a = -b.length / 2 + 0.2; a <= b.length / 2 - 0.2; a += 0.5) assert.ok(T.walkable(b.cx + b.ux * a, b.cz + b.uz * a), `${b.id} 橋面 ${a} 不可走`);
    // 橋外側（同一條河、往旁邊 4 公尺）是水
    const sx = b.cx + b.uz * 4;
    const sz = b.cz - b.ux * 4;
    assert.ok(T.isWater(sx, sz) && !T.walkable(sx, sz), `${b.id} 旁邊不是水`);
  }
});

test("星芽原野：溪流由西北往東南、瀑布落差 ≥ 3 公尺，河道不可走", () => {
  for (let i = 1; i < RIVER.length; i++) assert.ok(RIVER[i]!.water <= RIVER[i - 1]!.water, "水往高處流");
  assert.ok(RIVER[6]!.water - RIVER[7]!.water >= 3);
  for (const p of RIVER.slice(1, -1)) {
    if (T.bridgeAt(p.x, p.z)) continue;
    assert.ok(!T.walkable(p.x, p.z), `河道 (${p.x},${p.z}) 可走`);
    assert.ok(analyticHeight(p.x, p.z) < p.water, "河床高於水面");
  }
});

test("星芽原野：每個練功區中心有可戰鬥的平地（直徑 ≥ 10 公尺、坡度 ≤ 8°；花丘 ≤ 12°）", () => {
  for (const zn of ZONES) {
    const limit = zn.id === "03" ? 12 : 8;
    let ok = 0;
    let n = 0;
    for (let r = 0; r <= 5; r += 1) {
      for (let a = 0; a < 360; a += 30) {
        const x = zn.x + Math.sin((a * Math.PI) / 180) * r;
        const z = zn.z + Math.cos((a * Math.PI) / 180) * r;
        n++;
        if (T.walkable(x, z) && T.slopeDeg(x, z) <= limit) ok++;
      }
    }
    assert.ok(ok / n >= 0.95, `${zn.name} 平地不足 ${ok}/${n}`);
  }
});

test("星芽原野：Boss 戰鬥場完全平坦、傳送門在遺跡後方且平時可到達", () => {
  for (let r = 0; r <= ARENA.r - 0.5; r += 1) {
    for (let a = 0; a < 360; a += 20) {
      const x = ARENA.x + Math.sin((a * Math.PI) / 180) * r;
      const z = ARENA.z + Math.cos((a * Math.PI) / 180) * r;
      assert.ok(Math.abs(T.height(x, z) - ARENA.y) < 0.02, `戰鬥場 (${x.toFixed(1)},${z.toFixed(1)}) 不平`);
    }
  }
  assert.ok(PORTAL.z > ARENA.z + ARENA.r, "傳送門不在遺跡後方");
  const spawn = MAIN_ROUTE[0]!;
  assert.ok(Math.hypot(PORTAL.x - spawn.x, PORTAL.z - spawn.z) > 120, "傳送門離出生點太近");
  assert.ok(T.walkable(PORTAL.x, PORTAL.z));
});

test("星芽原野：遺跡石柱、拱門柱不擋主路", () => {
  for (const c of MAP_COLLIDERS) {
    const d = nearestOnPolyline(MAIN_PATH, c.x, c.z).d;
    assert.ok(d >= 1.75 + PLAYER_RADIUS + c.r - 0.6, `${c.kind} (${c.x},${c.z}) 離主路 ${d.toFixed(2)}`);
  }
  assert.equal(RUIN_PILLARS.length, 13);
  assert.equal(ARCH_POSTS.length, 2);
  // 拱門中間可以走過去
  const r = resolveMove(T, MAP_COLLIDERS, PLAYER_RADIUS, 0, 53, 0, 55);
  assert.ok(!r.blocked && Math.abs(r.z - 55) < 1e-6);
});

test("星芽原野：可走範圍連通 — 從出生點走得到所有練功區、探索點、傳送門，沒有封閉的坑", () => {
  const S = 1;
  const H = WALK_HALF;
  const N = Math.round((2 * H) / S) + 1;
  const W = new Uint8Array(N * N);
  let walk = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (T.walkable(-H + i * S, -H + j * S)) {
    W[j * N + i] = 1;
    walk++;
  }
  const cell = (x: number, z: number): number => Math.round((z + H) / S) * N + Math.round((x + H) / S);
  const seen = new Uint8Array(N * N);
  const start = cell(MAIN_ROUTE[0]!.x, MAIN_ROUTE[0]!.z);
  const q = [start];
  seen[start] = 1;
  let reached = 0;
  while (q.length) {
    const c = q.pop()!;
    reached++;
    const i = c % N;
    const j = (c / N) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const k = b * N + a;
      if (!W[k] || seen[k]) continue;
      if (!T.walkable(-H + ((i + a) / 2) * S, -H + ((j + b) / 2) * S)) continue;
      seen[k] = 1;
      q.push(k);
    }
  }
  assert.ok(reached / walk > 0.99, `連通 ${reached}/${walk}`);
  const targets = [...ZONES.map((z) => ({ n: z.name, x: z.x, z: z.z })), ...POIS.map((p) => ({ n: p.name, x: p.x, z: p.z })), { n: "傳送門", x: PORTAL.x, z: PORTAL.z - 2 }];
  for (const t of targets) assert.equal(seen[cell(t.x, t.z)], 1, `${t.n} 走不到`);
});

test("星芽原野：地表顏色是合法 RGB、主路是石板色", () => {
  for (const [x, z] of [[0, 0], [-56, -64], [50, -60], [0, 66], [-8, 34]] as const) {
    const c = terrainColor(T, x, z);
    for (const v of c) assert.ok(v >= 0 && v <= 1.01 && Number.isFinite(v));
  }
  const p = MAIN_ROUTE[2]!;
  const road = terrainColor(T, p.x, p.z);
  assert.ok(road[0] > 0.8 && road[1] > 0.7, `主路顏色 ${road}`);
});
