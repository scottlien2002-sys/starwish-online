import { test } from "node:test";
import assert from "node:assert/strict";
import { clampToWalkable, heightAt, isWalkable, walkableHalfSize } from "../../src/world/terrain.ts";
import { resolvePropCollisions, scatterProps } from "../../src/world/scatter.ts";
import { TUNING } from "../../src/config/tuning.ts";

test("地形：出生點平坦", () => {
  const h0 = heightAt(0, 0);
  for (const [x, z] of [[3, 0], [0, -4], [-5, 5], [6, 2]] as const) {
    assert.ok(Math.abs(heightAt(x, z) - h0) < 1e-9, `(${x},${z}) 不平坦`);
  }
});

test("地形：高度連續、有起伏、無 NaN", () => {
  const h = TUNING.world.halfSize;
  let min = Infinity;
  let max = -Infinity;
  for (let x = -h; x <= h; x += 1) {
    for (let z = -h; z <= h; z += 1) {
      const y = heightAt(x, z);
      assert.ok(Number.isFinite(y));
      min = Math.min(min, y);
      max = Math.max(max, y);
      // 相鄰 1 公尺高度差不超過 0.6m，角色可以走
      if (isWalkable(x, z) && isWalkable(x + 1, z)) assert.ok(Math.abs(heightAt(x + 1, z) - y) < 0.6);
    }
  }
  assert.ok(max - min > 1, "地形應有明顯起伏");
});

test("地形：外圍有山丘邊界", () => {
  const edge = TUNING.world.halfSize;
  assert.ok(heightAt(edge, 0) > heightAt(edge - 20, 0) + 1.5);
});

test("邊界：角色無法走出地圖", () => {
  const h = walkableHalfSize();
  assert.deepEqual(clampToWalkable(999, -999), { x: h, z: -h });
  assert.deepEqual(clampToWalkable(1, 2), { x: 1, z: 2 });
});

test("裝飾物：同種子結果相同、出生點淨空", () => {
  const opt = { seed: 42, halfSize: 60, clearRadius: 12, counts: { tree: 50, rock: 20, bush: 30, flower: 100 } };
  const a = scatterProps(opt);
  const b = scatterProps(opt);
  assert.deepEqual(a, b);
  assert.ok(a.every((p) => Math.hypot(p.x, p.z) >= 12));
  assert.ok(a.filter((p) => p.kind === "tree").length >= 45, "樹木數量不足");
});

test("裝飾物：樹木間距 >= 4.5m", () => {
  const props = scatterProps({ seed: TUNING.world.seed, halfSize: 66, clearRadius: 12, counts: { tree: 70, rock: 0, bush: 0, flower: 0 } });
  const trees = props.filter((p) => p.kind === "tree");
  for (let i = 0; i < trees.length; i++) {
    for (let j = i + 1; j < trees.length; j++) {
      assert.ok(Math.hypot(trees[i]!.x - trees[j]!.x, trees[i]!.z - trees[j]!.z) >= 4.5);
    }
  }
});

test("碰撞：角色被推出樹幹", () => {
  const tree = { kind: "tree" as const, x: 10, y: 0, z: 10, rotation: 0, scale: 1, radius: 0.7 };
  const out = resolvePropCollisions(10.2, 10, 0.3, [tree]);
  assert.ok(Math.hypot(out.x - 10, out.z - 10) >= 1 - 1e-9);
  const free = resolvePropCollisions(20, 20, 0.3, [tree]);
  assert.deepEqual(free, { x: 20, z: 20 });
  const flower = { ...tree, kind: "flower" as const, radius: 0 };
  assert.deepEqual(resolvePropCollisions(10, 10, 0.3, [flower]), { x: 10, z: 10 });
});
