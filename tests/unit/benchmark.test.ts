import assert from "node:assert/strict";
import { test } from "node:test";
import { FrameRecorder, summarizeFrames } from "../../src/render/benchmark.ts";

test("效能統計：平均、最慢 1%、最低 FPS 與 Draw Calls", () => {
  const dts = [...Array(99).fill(1 / 60), 1 / 20];
  const s = summarizeFrames(dts, [10, 20]);
  assert.equal(s.frames, 100);
  assert.ok(Math.abs(s.avgFps - 100 / (99 / 60 + 1 / 20)) < 1e-9);
  assert.ok(Math.abs(s.low1Fps - 20) < 1e-9);
  assert.ok(Math.abs(s.minFps - 20) < 1e-9);
  assert.equal(s.avgDrawCalls, 15);
  assert.equal(s.maxDrawCalls, 20);
  assert.deepEqual(summarizeFrames([], []).frames, 0);
});

test("逐幀收集：暖機 0.5 秒不計入，滿 10 秒結束", () => {
  const r = new FrameRecorder(10);
  let done = false;
  let n = 0;
  while (!done) {
    done = r.record(0.05, 30);
    n++;
  }
  assert.equal(n, 210);
  assert.equal(r.summary().frames, 200);
  assert.ok(Math.abs(r.summary().avgFps - 20) < 1e-6);
});
