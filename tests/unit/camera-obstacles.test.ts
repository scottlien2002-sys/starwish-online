import { test } from "node:test";
import assert from "node:assert/strict";
import { CAMERA_MIN_OBSTRUCTED, CameraObstacleQuery, cameraObstaclesFrom, obstructedDistance, type CameraObstacle } from "../../src/maps/starsprout/cameraObstacles.ts";
import { MAP_COLLIDERS } from "../../src/maps/starsprout/route.ts";
import { propColliders, PROPS } from "../../src/maps/starsprout/props.ts";
import { buildVegetation, VEG_HQ } from "../../src/maps/starsprout/vegetation.ts";
import { StarsproutTerrain } from "../../src/maps/starsprout/terrain.ts";

const flat = () => 0;
const dir = (alpha: number, beta: number) => [Math.cos(alpha) * Math.sin(beta), Math.cos(beta), Math.sin(alpha) * Math.sin(beta)] as const;

test("鏡頭避障：只把帳篷、涼亭、樹幹、石柱、拱門、傳送門柱當障礙物", () => {
  const obs = cameraObstaclesFrom(
    [
      { kind: "tent", x: 0, z: 0, r: 1.75 },
      { kind: "pavilion", x: 0, z: 0, r: 2.6 },
      { kind: "tree", x: 0, z: 0, r: 0.42 },
      { kind: "pillar", x: 0, z: 0, r: 0.75, height: 6.5 } as never,
      { kind: "fence", x: 0, z: 0, r: 0.12 },
      { kind: "crate", x: 0, z: 0, r: 0.5 },
      { kind: "barrel", x: 0, z: 0, r: 0.42 },
      { kind: "rock", x: 0, z: 0, r: 0.6 },
      { kind: "logBench", x: 0, z: 0, r: 0.35 },
    ],
    flat,
  );
  assert.deepEqual(obs.map((o) => o.kind), ["tent", "pavilion", "tree", "pillar"]);
  const tree = obs[2];
  assert.ok(tree.y1 < 3, "樹只算樹幹高度，不含樹冠");
});

test("鏡頭避障：帳篷擋在角色與鏡頭之間時拉近，在帳篷外側", () => {
  const tent: CameraObstacle[] = cameraObstaclesFrom([{ kind: "tent", x: 0, z: 0, r: 1.75 }], flat);
  // 角色在帳篷東邊 4 m，鏡頭往西（穿過帳篷）、低俯角
  const [dx, dy, dz] = dir(Math.PI, 1.3);
  const d = obstructedDistance(tent, 4, 0.85, 0, dx, dy, dz, 9);
  assert.ok(d < 4 && d > CAMERA_MIN_OBSTRUCTED, `d=${d}`);
  // 鏡頭往東（背對帳篷）：不擋
  const [ex, ey, ez] = dir(0, 1.3);
  assert.equal(obstructedDistance(tent, 4, 0.85, 0, ex, ey, ez, 9), 9);
});

test("鏡頭避障：鏡頭夠高（越過帳篷頂）時不擋；樹冠高度不算", () => {
  const obs = cameraObstaclesFrom([{ kind: "tent", x: 0, z: 0, r: 1.75 }, { kind: "tree", x: 0, z: 20, r: 0.42 }], flat);
  // 很高的俯角：入射點已高於帳篷頂
  const [dx, dy, dz] = dir(Math.PI, 0.55);
  assert.equal(obstructedDistance(obs, 3.2, 0.85, 0, dx, dy, dz, 9), 9);
  // 樹在北方 20 m：角色在樹南方 3 m、鏡頭往北穿過樹冠高度（y≈3+）不算，穿過樹幹高度才算
  const [nx, ny, nz] = dir(Math.PI / 2, 0.75);
  assert.equal(obstructedDistance(obs, 0, 0.85, 17, nx, ny, nz, 9), 9, "高處（樹冠）不擋");
  const [lx, ly, lz] = dir(Math.PI / 2, 1.38);
  assert.ok(obstructedDistance(obs, 0, 0.85, 17, lx, ly, lz, 9) < 3, "低處（樹幹）會擋");
});

test("鏡頭避障：角色貼著障礙物時不會把鏡頭縮成 0；距離隨角度連續變化（不跳動）", () => {
  const obs = cameraObstaclesFrom([{ kind: "pillar", x: 0, z: 0, r: 0.75, height: 6.5 } as never], flat);
  const [dx, dy, dz] = dir(Math.PI, 1.2);
  const d = obstructedDistance(obs, 1.2, 0.85, 0, dx, dy, dz, 9);
  assert.ok(d >= CAMERA_MIN_OBSTRUCTED);
  let prev = -1;
  let maxJump = 0;
  for (let a = Math.PI - 0.05; a <= Math.PI + 0.05; a += 0.002) {
    const [x, y, z] = dir(a, 1.2);
    const v = obstructedDistance(obs, 4, 0.85, 0, x, y, z, 9);
    if (prev >= 0 && v < 9 && prev < 9) maxJump = Math.max(maxJump, Math.abs(v - prev));
    prev = v;
  }
  assert.ok(maxJump < 0.2, `maxJump=${maxJump}`);
});

test("鏡頭避障：實際地圖的障礙物數量合理，附近查詢只取幾十個", () => {
  const t = new StarsproutTerrain();
  const veg = buildVegetation(t, VEG_HQ, undefined, []);
  const all = cameraObstaclesFrom([...MAP_COLLIDERS, ...propColliders(PROPS), ...veg.colliders], (x, z) => t.surface(x, z));
  const tents = all.filter((o) => o.kind === "tent").length;
  assert.equal(tents, 2);
  assert.equal(all.filter((o) => o.kind === "pavilion").length, 1);
  assert.ok(all.length > 300 && all.length < 900, `${all.length}`);
  const q = new CameraObstacleQuery(all, 15);
  const [dx, dy, dz] = dir(0, 1.05);
  q.distance(-56, 3, -64, dx, dy, dz, 9);
  assert.ok(q.nearby < 120, `nearby=${q.nearby}`);
  // 效能：1 萬次查詢（約 3 分鐘 60 FPS）
  const t0 = performance.now();
  for (let i = 0; i < 10000; i++) {
    const [x, y, z] = dir(i * 0.01, 1.05);
    q.distance(-56 + (i % 50) * 0.01, 3, -64, x, y, z, 9);
  }
  const ms = performance.now() - t0;
  assert.ok(ms < 400, `${ms} ms`);
  console.log(`camera obstacles total ${all.length}, nearby ${q.nearby}, 10k queries ${ms.toFixed(1)} ms`);
});
