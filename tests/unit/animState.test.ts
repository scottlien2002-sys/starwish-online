import { test } from "node:test";
import assert from "node:assert/strict";
import { AnimStateMachine } from "../../src/actors/animState.ts";

test("Idle ↔ Run 依移動切換；循環動作不重新開始", () => {
  const m = new AnimStateMachine();
  assert.equal(m.state, "Idle");
  m.update(0.1, { moving: true });
  assert.equal(m.state, "Run");
  m.update(0.1, { moving: true });
  assert.ok(Math.abs(m.time - 0.1) < 1e-9); // 沒有重新開始
  m.update(0.1, { moving: false });
  assert.equal(m.state, "Idle");
});

test("Jump、Attack 播一次後回到 Run 或 Idle；進行中不會被彼此打斷", () => {
  const m = new AnimStateMachine();
  m.update(0.016, { moving: true, jump: true });
  assert.equal(m.state, "Jump");
  m.update(0.3, { moving: true, attack: true });
  assert.equal(m.state, "Jump");
  m.update(0.8, { moving: true });
  assert.equal(m.state, "Run");
  m.update(0.016, { moving: false, attack: true });
  assert.equal(m.state, "Attack");
  m.update(0.7, { moving: false });
  assert.equal(m.state, "Idle");
});

test("Hurt 可以打斷任何動作；結束後回到 Idle", () => {
  const m = new AnimStateMachine();
  m.update(0.016, { moving: false, attack: true });
  m.update(0.1, { moving: false, hurt: true });
  assert.equal(m.state, "Hurt");
  m.update(0.6, { moving: false });
  assert.equal(m.state, "Idle");
});

test("跳躍高度：0.25～0.75 之間離地、中間最高", () => {
  const m = new AnimStateMachine();
  m.update(0, { moving: false, jump: true });
  assert.equal(m.jumpHeight(), 0);
  m.update(0.5, { moving: false });
  assert.ok(Math.abs(m.jumpHeight(0.35) - 0.35) < 1e-9);
  m.update(0.3, { moving: false });
  assert.equal(m.jumpHeight(), 0);
});
