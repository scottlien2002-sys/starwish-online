import { test } from "node:test";
import assert from "node:assert/strict";
import { computeJoystick } from "../../src/input/joystick-math.ts";
import { inputToWorld, moveStep, turnTowards } from "../../src/actors/movement.ts";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("搖桿：中心與死區輸出為 0", () => {
  assert.deepEqual(computeJoystick(100, 100, 100, 100, 50, 0.1), { x: 0, y: 0, magnitude: 0, knobX: 0, knobY: 0 });
  const dz = computeJoystick(100, 100, 104, 100, 50, 0.1);
  assert.equal(dz.magnitude, 0);
});

test("搖桿：向上推為前進（y 正）", () => {
  const out = computeJoystick(100, 100, 100, 40, 50, 0.1);
  close(out.magnitude, 1);
  close(out.x, 0);
  close(out.y, 1);
  close(out.knobY, -50); // 搖桿頭被限制在半徑內
});

test("搖桿：推出半徑外仍為 1，斜推方向正確", () => {
  const out = computeJoystick(0, 0, 300, 300, 50, 0.1);
  close(out.magnitude, 1);
  close(out.x, Math.SQRT1_2);
  close(out.y, -Math.SQRT1_2);
});

test("搖桿：力度隨距離線性映射", () => {
  const out = computeJoystick(0, 0, 0, -30, 50, 0.2); // raw 0.6
  close(out.magnitude, (0.6 - 0.2) / 0.8);
});

test("移動：攝影機朝 +z 時，推前進就往 +z", () => {
  const d = inputToWorld(0, 1, 0);
  close(d.x, 0);
  close(d.z, 1);
  const r = inputToWorld(1, 0, 0);
  close(r.x, 1);
  close(r.z, 0);
});

test("移動：攝影機轉向 +x 時，前進變 +x、右邊變 -z", () => {
  const f = inputToWorld(0, 1, Math.PI / 2);
  close(f.x, 1);
  close(f.z, 0, 1e-12);
  const r = inputToWorld(1, 0, Math.PI / 2);
  close(r.x, 0, 1e-12);
  close(r.z, -1);
});

test("移動：速度與 dt 正確，斜向不加速，dt 有上限", () => {
  const s = moveStep({ x: 0, z: 0, inputX: 0, inputY: 1, cameraForwardYaw: 0, speed: 5, dt: 0.5 });
  close(s.z, 0.5); // dt 被限制在 0.1 → 5 * 0.1
  const diag = moveStep({ x: 0, z: 0, inputX: 1, inputY: 1, cameraForwardYaw: 0, speed: 5, dt: 0.1 });
  close(Math.hypot(diag.x, diag.z), 0.5);
});

test("轉身：朝移動方向收斂，無輸入時保持", () => {
  assert.equal(turnTowards(1.2, 0, 0, 10, 0.016), 1.2);
  let yaw = 0;
  for (let i = 0; i < 120; i++) yaw = turnTowards(yaw, 1, 0, 14, 1 / 60);
  close(yaw, Math.PI / 2, 1e-3);
  // 跨越 ±PI 走最短路徑
  let y2 = Math.PI - 0.1;
  y2 = turnTowards(y2, Math.sin(-Math.PI + 0.1), Math.cos(-Math.PI + 0.1), 1000, 1);
  assert.ok(Math.abs(Math.sin(y2) - Math.sin(-Math.PI + 0.1)) < 1e-6);
});
