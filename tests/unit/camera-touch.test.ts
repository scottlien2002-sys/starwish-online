import { test } from "node:test";
import assert from "node:assert/strict";
import { CameraTouchControl } from "../../src/input/CameraTouchControl.ts";
import { InputState } from "../../src/input/InputState.ts";

/** 在 node 裡模擬 PointerEvent（只用到 pointerId/clientX/clientY/isPrimary/timeStamp） */
function ev(type: string, id: number, x: number, y: number, primary: boolean, t: number): Event {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, { pointerId: id, clientX: x, clientY: y, isPrimary: primary });
  Object.defineProperty(e, "timeStamp", { value: t });
  return e;
}

function setup(): { target: EventTarget; input: InputState; ctl: CameraTouchControl } {
  const target = new EventTarget();
  const input = new InputState();
  const ctl = new CameraTouchControl(target as unknown as HTMLElement, input, 0.0065, 0.005, 0.02);
  return { target, input, ctl };
}

test("鏡頭觸控：單指拖曳旋轉、雙指縮放", () => {
  const { target, input } = setup();
  target.dispatchEvent(ev("pointerdown", 1, 100, 100, true, 0));
  target.dispatchEvent(ev("pointermove", 1, 140, 110, true, 16));
  let c = input.consumeCamera();
  assert.ok(Math.abs(c.yaw - 40 * 0.0065) < 1e-9);
  assert.ok(Math.abs(c.pitch - 10 * 0.005) < 1e-9);
  assert.equal(c.zoom, 0);
  target.dispatchEvent(ev("pointerdown", 2, 300, 100, false, 30));
  target.dispatchEvent(ev("pointermove", 2, 360, 100, false, 46));
  c = input.consumeCamera();
  assert.equal(c.yaw, 0);
  assert.ok(c.zoom < 0, "手指張開 = 拉近");
});

test("鏡頭觸控：沒收到 pointerup 的殘留指標不會讓之後的單指拖曳變成縮放", () => {
  const { target, input, ctl } = setup();
  // 第一次觸控：iOS 漏送 pointerup
  target.dispatchEvent(ev("pointerdown", 1, 100, 100, true, 0));
  target.dispatchEvent(ev("pointermove", 1, 120, 100, true, 16));
  input.consumeCamera();
  // 下一次新觸控（第一根手指 = primary）
  target.dispatchEvent(ev("pointerdown", 2, 200, 200, true, 1000));
  assert.equal(ctl.activePointers, 1);
  target.dispatchEvent(ev("pointermove", 2, 250, 200, true, 1016));
  const c = input.consumeCamera();
  assert.ok(c.yaw > 0.3, "單指應該旋轉");
  assert.equal(c.zoom, 0);
});

test("鏡頭觸控：lostpointercapture / pointercancel 會移除指標", () => {
  const { target, ctl } = setup();
  target.dispatchEvent(ev("pointerdown", 1, 100, 100, true, 0));
  target.dispatchEvent(ev("lostpointercapture", 1, 100, 100, true, 10));
  assert.equal(ctl.activePointers, 0);
  target.dispatchEvent(ev("pointerdown", 3, 100, 100, true, 20));
  target.dispatchEvent(ev("pointercancel", 3, 100, 100, true, 30));
  assert.equal(ctl.activePointers, 0);
});

test("鏡頭觸控：非 primary 的殘留指標過久會被清掉；單次位移有上限避免鏡頭跳動", () => {
  const { target, input, ctl } = setup();
  target.dispatchEvent(ev("pointerdown", 5, 100, 100, false, 0));
  target.dispatchEvent(ev("pointerdown", 6, 100, 100, false, 5000));
  assert.equal(ctl.activePointers, 1);
  target.dispatchEvent(ev("pointermove", 6, 600, 100, false, 5016));
  const c = input.consumeCamera();
  assert.ok(Math.abs(c.yaw - 60 * 0.0065) < 1e-9);
});

test("鏡頭觸控：最多追蹤兩根手指", () => {
  const { target, ctl } = setup();
  target.dispatchEvent(ev("pointerdown", 1, 0, 0, true, 0));
  target.dispatchEvent(ev("pointerdown", 2, 10, 0, false, 1));
  target.dispatchEvent(ev("pointerdown", 3, 20, 0, false, 2));
  assert.equal(ctl.activePointers, 2);
});
