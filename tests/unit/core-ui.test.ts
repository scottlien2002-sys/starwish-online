import { test } from "node:test";
import assert from "node:assert/strict";
import { EventBus } from "../../src/core/events.ts";
import { createRng } from "../../src/core/rng.ts";
import { angleDelta } from "../../src/core/math.ts";
import { findLayoutIssues, findSmallTouchTargets, rectsOverlap } from "../../src/ui/layout-check.ts";

test("EventBus：訂閱、發送、取消", () => {
  const bus = new EventBus<{ hit: { n: number } }>();
  const got: number[] = [];
  const off = bus.on("hit", (e) => got.push(e.n));
  bus.emit("hit", { n: 1 });
  off();
  bus.emit("hit", { n: 2 });
  assert.deepEqual(got, [1]);
  assert.equal(bus.listenerCount("hit"), 0);
});

test("EventBus：處理中取消訂閱不影響本輪", () => {
  const bus = new EventBus<{ e: null }>();
  let count = 0;
  const offA = bus.on("e", () => {
    count++;
    offA();
  });
  bus.on("e", () => count++);
  bus.emit("e", null);
  bus.emit("e", null);
  assert.equal(count, 3);
});

test("亂數：同種子可重現、範圍正確", () => {
  const a = createRng(7);
  const b = createRng(7);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  const r = createRng(1);
  for (let i = 0; i < 1000; i++) {
    const v = r.int(3, 6);
    assert.ok(v >= 3 && v < 6 && Number.isInteger(v));
  }
});

test("角度差：取最短方向", () => {
  assert.ok(Math.abs(angleDelta(Math.PI - 0.1, -Math.PI + 0.1) - 0.2) < 1e-9);
  assert.ok(Math.abs(angleDelta(0, Math.PI / 2) - Math.PI / 2) < 1e-9);
});

test("版面檢查：偵測重疊、超出安全區、過小按鈕", () => {
  const r = (l: number, t: number, w: number, h: number) => ({ left: l, top: t, right: l + w, bottom: t + h });
  assert.equal(rectsOverlap(r(0, 0, 10, 10), r(20, 0, 10, 10)), false);
  assert.equal(rectsOverlap(r(0, 0, 10, 10), r(12, 0, 10, 10), 4), true);

  const ok = [
    { id: "btn-a", rect: r(700, 300, 60, 60) },
    { id: "btn-b", rect: r(620, 300, 60, 60) },
  ];
  assert.deepEqual(findLayoutIssues(ok, 800, 400), []);

  const overlap = [...ok, { id: "btn-c", rect: r(650, 310, 60, 60) }];
  assert.ok(findLayoutIssues(overlap, 800, 400).length > 0);

  const unsafe = [{ id: "btn-a", rect: r(10, 300, 60, 60) }];
  assert.ok(findLayoutIssues(unsafe, 800, 400, { top: 0, right: 0, bottom: 0, left: 47 }).length > 0);

  assert.deepEqual(findSmallTouchTargets([{ id: "btn-x", rect: r(0, 0, 40, 60) }]), ["btn-x: 觸控範圍小於 44px"]);
});
