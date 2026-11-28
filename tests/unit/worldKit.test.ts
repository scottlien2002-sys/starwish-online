import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeSeam, groundTexels, meanLuma, slabTexels } from "../../src/world/texGen.ts";
import { bladeTuft } from "../../src/world/foliageKit.ts";

/** 內部相鄰像素的平均差（拿來和邊界比較） */
function interior(px: Uint8Array, N: number): number {
  let d = 0;
  for (let i = 0; i < N; i++) d += Math.abs(px[(i * N + N / 2) * 4]! - px[(i * N + N / 2 - 1) * 4]!);
  return d / N;
}

test("地面貼圖：可無縫重複、平均亮度適合與頂點色相乘", () => {
  const N = 128;
  const px = groundTexels(N, 11);
  assert.equal(px.length, N * N * 4);
  assert.ok(edgeSeam(px, N) <= interior(px, N) * 2.5 + 4, `seam ${edgeSeam(px, N)} vs ${interior(px, N)}`);
  const l = meanLuma(px);
  assert.ok(l > 0.78 && l < 0.95, String(l));
});

test("鋪面貼圖：可無縫重複、有縫線（暗線）", () => {
  const N = 128;
  const px = slabTexels(N, 23);
  assert.ok(edgeSeam(px, N) <= interior(px, N) * 2.5 + 6, String(edgeSeam(px, N)));
  const l = meanLuma(px);
  assert.ok(l > 0.72 && l < 0.95, String(l));
  // 板中間比縫線亮
  const at = (x: number, y: number): number => px[(y * N + x) * 4]!;
  assert.ok(at(N / 8, N / 8) > at(0, N / 8) + 20);
});

test("草叢幾何：每片 3 個三角形、法線朝上、高度合理", () => {
  const g = bladeTuft({ blades: 6, height: 0.5, heightVar: 0.2, width: 0.1, spread: 0.2, base: [0.3, 0.4, 0.2], mid: [0.5, 0.7, 0.3], tip: [0.7, 0.8, 0.4], seed: 5 });
  assert.equal(g.indices.length / 3, 18);
  assert.equal(g.positions.length / 3, 30);
  for (let i = 1; i < g.normals.length; i += 3) assert.equal(g.normals[i], 1);
  const ys = g.positions.filter((_, i) => i % 3 === 1);
  assert.ok(Math.max(...ys) < 0.9 && Math.min(...ys) === 0);
});

test("碰撞空間格：垃圾場推開結果與逐一檢查完全相同", async () => {
  const { COLLIDERS, pushOut } = await import("../../src/maps/junkyard/terrain.ts");
  const copy = [...COLLIDERS]; // 不同陣列 → 走逐一檢查
  let s = 99;
  const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) >>> 8) / 16777216;
  for (let i = 0; i < 30000; i++) {
    const c = COLLIDERS[i % COLLIDERS.length]!;
    const x = i % 2 ? c.x + (rnd() * 2 - 1) * 18 : (rnd() * 2 - 1) * 135;
    const z = i % 2 ? c.z + (rnd() * 2 - 1) * 18 : (rnd() * 2 - 1) * 135;
    const a = pushOut(x, z, 0.3);
    const b = pushOut(x, z, 0.3, copy);
    assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9 && a.hit === b.hit, `(${x},${z})`);
  }
});

test("接觸陰影：物件邊緣變暗、遠處不變、多個物件疊加但有下限", async () => {
  const { makeContactAO } = await import("../../src/world/contactAO.ts");
  const ao = makeContactAO([{ x: 0, z: 0, r: 2 }, { x: 3, z: 0, r: 1 }], { strength: 0.35, width: 1.5 });
  assert.ok(Math.abs(ao(50, 50) - 1) < 1e-9);
  assert.ok(ao(-2.1, 0) < 0.7);
  assert.ok(ao(-4, 0) > ao(-2.5, 0));
  assert.ok(ao(1.8, 0) >= 0.45);
});
