import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameRecorder, summarizeFrames, worstAvgFps } from "../../src/render/benchmark.ts";
import {
  BENCH_SPOTS,
  BENCH_STORAGE_KEY,
  benchOptionsFromSearch,
  benchUrl,
  compareRows,
  formatResult,
  loadResults,
  saveResult,
  type BenchResult,
} from "../../src/game/benchMode.ts";

/** Stage 5.3-1：遊戲內效能測試（?bench=1）的純邏輯 */

test("網址參數：只有 bench=1 才啟用；預設暖機 3 秒、測量 10 秒；可調整但有上下限", () => {
  assert.equal(benchOptionsFromSearch(""), null);
  assert.equal(benchOptionsFromSearch("?bobo=v38r"), null);
  assert.equal(benchOptionsFromSearch("?bench=0"), null);
  assert.equal(benchOptionsFromSearch("?bench=profile"), null);
  assert.deepEqual(benchOptionsFromSearch("?bench=1"), { seconds: 10, warmup: 3, profile: false, res: null });
  assert.deepEqual(benchOptionsFromSearch("?bench=1&bobo=v38r&quality=high"), { seconds: 10, warmup: 3, profile: false, res: null });
  assert.deepEqual(benchOptionsFromSearch("?bench=1&benchsec=2&warmup=1"), { seconds: 2, warmup: 1, profile: false, res: null });
  assert.deepEqual(benchOptionsFromSearch("?bench=1&benchsec=999&warmup=0"), { seconds: 60, warmup: 0.5, profile: false, res: null });
  assert.deepEqual(benchOptionsFromSearch("?bench=1&benchsec=abc"), { seconds: 10, warmup: 3, profile: false, res: null });
});

test("1% Low 的兩種定義：第 99 百分位影格（與已驗收測試頁相同）＋最慢 1% 影格平均", () => {
  // 1000 幀：990 幀 16.667 ms、10 幀 50 ms（各 1%）
  const dts = [...Array(990).fill(1 / 60), ...Array(10).fill(0.05)];
  const s = summarizeFrames(dts, Array(1000).fill(20));
  // 第 99 百分位：排序後第 990 個 → 50 ms → 20 FPS
  assert.ok(Math.abs(s.low1Fps - 20) < 1e-9);
  assert.ok(Math.abs(s.low1AvgFps! - 20) < 1e-9);
  assert.ok(Math.abs(s.p99FrameMs! - 50) < 1e-9);
  assert.ok(Math.abs(s.maxFrameMs! - 50) < 1e-9);
  // 平均 FPS = 幀數 ÷ 總時間（不是各幀 FPS 的平均）
  const total = 990 / 60 + 10 * 0.05;
  assert.ok(Math.abs(s.avgFps - 1000 / total) < 1e-9);
  assert.equal(s.minFps, 20);
  assert.equal(s.avgDrawCalls, 20);
  // 只有 5 幀特別慢（0.5%）：百分位法看不到，最慢 1% 平均會反映
  const d2 = [...Array(995).fill(1 / 60), ...Array(5).fill(0.1)];
  const s2 = summarizeFrames(d2, []);
  assert.ok(Math.abs(s2.low1Fps - 60) < 1e-6);
  assert.ok(Math.abs(s2.low1AvgFps! - 10 / (5 * 0.1 + 5 / 60)) < 1e-9);
  assert.equal(worstAvgFps([], 0.01), 0);
  assert.ok(Math.abs(worstAvgFps([0.02], 0.01) - 50) < 1e-9, "至少取 1 幀");
});

test("暖機期間的影格不計入；測量時間以實際影格時間累計", () => {
  const rec = new FrameRecorder(2, 1);
  let done = false;
  let n = 0;
  // 暖機 1 秒：前 10 幀很慢（模擬著色器編譯），之後 60 FPS
  for (let i = 0; i < 10; i++) done = rec.record(0.1, 99);
  assert.equal(done, false);
  while (!done) {
    done = rec.record(1 / 60, 20);
    n++;
  }
  const s = rec.summary();
  assert.ok(s.minFps > 59, `暖機的慢影格不計入（最低 ${s.minFps}）`);
  assert.equal(s.maxDrawCalls, 20);
  assert.ok(Math.abs(s.seconds - 2) <= 0.1);
  assert.ok(n >= 119 && n <= 121);
});

const sample = (variant: "v2" | "v38r", avg: number): BenchResult => ({
  variant,
  quality: "high",
  pixelRatio: 2,
  devicePixelRatio: 3,
  width: 1704,
  height: 786,
  warmup: 3,
  summary: { seconds: 10, frames: 600, avgFps: avg, low1Fps: avg - 10, minFps: avg - 20, avgDrawCalls: 58, maxDrawCalls: 60, low1AvgFps: avg - 12, p99FrameMs: 20, maxFrameMs: 30 },
  avgActiveMeshes: 41,
  maxActiveMeshes: 42,
  meshes: 51,
  materials: 24,
  textures: 11,
  monsters: 3,
  at: "2026-11-20T00:00:00.000Z",
  userAgent: "test",
});

test("結果保存：每個「外觀＋畫質」保留最新一次；兩種外觀都有時顯示比較", () => {
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  saveResult(storage, sample("v2", 55));
  const all = saveResult(storage, sample("v38r", 50));
  assert.deepEqual(Object.keys(all).sort(), ["v2_high", "v38r_high"]);
  assert.ok(mem.has(BENCH_STORAGE_KEY));
  const rows = compareRows(all.v2_high, all.v38r_high)!;
  assert.match(rows[1]!, /55\.0 → 50\.0（-5\.0）/);
  assert.equal(compareRows(all.v2_high, undefined), null);
  assert.equal(formatResult(all.v2_high!).length, 6);
  // 無法存取時不出錯
  const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
  assert.deepEqual(loadResults(broken), {});
  assert.deepEqual(Object.keys(saveResult(broken, sample("v2", 1))), ["v2_high"]);
  assert.deepEqual(loadResults(null), {});
});

test("切換外觀的測試網址：保留畫質與其他參數", () => {
  assert.equal(benchUrl("https://x.io/p/?bench=1&quality=high", "v38r"), "https://x.io/p/?bench=1&quality=high&bobo=v38r");
  assert.equal(benchUrl("https://x.io/p/?bench=1&quality=low&bobo=v38r", "v2"), "https://x.io/p/?bench=1&quality=low");
  assert.equal(BENCH_SPOTS.length, 3);
});
