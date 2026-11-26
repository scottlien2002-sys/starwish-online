import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_TIER, effectiveMsaa, nextTier, resolveTier, TIER_PRESETS } from "../../src/render/graphicsTiers.ts";
import { casterInRange, diagSteps, frameSummary, lodLevel, shadowSpec, splitFrameStats, villagePerfConfig } from "../../src/maps/village/villagePerf.ts";

const P = (q = ""): URLSearchParams => new URLSearchParams(q);

test("Stage 6.4 三段畫質預設：高＝HQ 1.25x PCF1024 HDR關 MSAA4；中＝Lite 1.25x PCF1024 HDR關 MSAA2；低＝Lite 1x 腳底陰影 MSAA1 無後製", () => {
  assert.deepEqual(
    (["high", "medium", "low"] as const).map((t) => {
      const p = TIER_PRESETS[t];
      return [p.models, p.maxRes, p.shadow, p.hdr, p.msaa, p.post, p.lodNear];
    }),
    [
      ["hq", 1.25, "pcf1024", false, 4, true, 18],
      ["lite", 1.25, "pcf1024", false, 2, true, 14],
      ["lite", 1, "blob", false, 1, false, 14],
    ],
  );
  for (const t of ["high", "medium", "low"] as const) {
    const p = TIER_PRESETS[t];
    assert.ok(p.dynamicRes && p.offscreenCull && p.animThrottle && p.casterCull);
    assert.notEqual(p.shadow, "pcss2048", "PCSS 2048 不得作為預設");
  }
});

test("畫質決定順序：網址 ＞ 玩家偏好 ＞ 中畫質（新玩家預設）；循環切換 高→中→低→高", () => {
  assert.equal(DEFAULT_TIER, "medium");
  assert.deepEqual(resolveTier(null, null), { tier: "medium", source: "default" });
  assert.deepEqual(resolveTier(null, "low"), { tier: "low", source: "stored" });
  assert.deepEqual(resolveTier("high", "low"), { tier: "high", source: "url" });
  assert.deepEqual(resolveTier("ultra", "xyz"), { tier: "medium", source: "default" });
  assert.deepEqual(["high", "medium", "low"].map((t) => nextTier(t as "high")), ["medium", "low", "high"]);
});

test("實際生效 MSAA：取要求值、管線值、裝置上限的最小值（不支援時為 1）", () => {
  assert.equal(effectiveMsaa(4, 4, 4), 4);
  assert.equal(effectiveMsaa(4, 4, 1), 1);
  assert.equal(effectiveMsaa(2, null, 8), 2);
  assert.equal(effectiveMsaa(4, 2, 8), 2);
});

test("村莊效能設定依畫質；網址參數可覆寫並記錄；?perf=s62 重現 Stage 6.2", () => {
  const h = villagePerfConfig(P(), "high");
  assert.deepEqual([h.models, h.shadow, h.maxRes, h.msaa, h.hdr, h.post, h.lodNear, h.npcLod, h.casterCull], ["hq", "pcf1024", 1.25, 4, false, true, 18, true, true]);
  assert.deepEqual(h.overrides, []);
  const m = villagePerfConfig(P(), "medium");
  assert.deepEqual([m.models, m.shadow, m.maxRes, m.msaa, m.post, m.lodNear], ["lite", "pcf1024", 1.25, 2, true, 14]);
  const l = villagePerfConfig(P(), "low");
  assert.deepEqual([l.models, l.shadow, l.maxRes, l.msaa, l.post], ["lite", "blob", 1, 1, false]);
  const o = villagePerfConfig(P("lod=hq&shadow=pcss1024&res=1.5&msaa=2&hdr=1&reslock=1"), "medium");
  assert.deepEqual([o.models, o.shadow, o.maxRes, o.msaa, o.hdr, o.resLock, o.lodNear], ["hq", "pcss1024", 1.5, 2, true, true, 18]);
  assert.equal(o.overrides.length, 5);
  const s = villagePerfConfig(P("perf=s62"), "high");
  assert.deepEqual([s.profile, s.shadow, s.maxRes, s.hdr, s.npcLod, s.originalModels], ["s62", "pcss2048", 2, true, false, true]);
});

test("陰影模式對應：2048/1024/PCF/腳底陰影/關閉", () => {
  assert.deepEqual(shadowSpec("pcss2048"), { map: true, size: 2048, contact: true, filtering: "high", blobs: false });
  assert.equal(shadowSpec("pcf1024").size, 1024);
  assert.equal(shadowSpec("pcf1024").contact, false);
  assert.ok(!shadowSpec("blob").map && shadowSpec("blob").blobs);
  assert.ok(!shadowSpec("off").map && !shadowSpec("off").blobs);
});

test("角色 LOD 有遲滯；陰影投射物剔除", () => {
  assert.equal(lodLevel(18.5, 18, 0), 0);
  assert.equal(lodLevel(18.8, 18, 0), 1);
  assert.equal(lodLevel(17.5, 18, 1), 1);
  assert.equal(lodLevel(17.2, 18, 1), 0);
  assert.ok(casterInRange(10, 0, 1, 0, 0, 31.5));
  assert.ok(!casterInRange(40, 0, 2, 0, 0, 31.5));
});

test("效能診斷：每項只改一個因素；有後製時含 MSAA 1/2/4、HDR 開；最後複測基準", () => {
  const ids = diagSteps(true).map((s) => s.id);
  for (const k of ["base", "res1", "res125", "res15", "res2", "pcss2048", "pcss1024", "pcf1024", "blob", "noshadow", "msaa1", "msaa2", "msaa4", "hdron", "nopost", "nolod", "nochar", "nostatic", "cpu", "base2"]) assert.ok(ids.includes(k), k);
  for (const s of diagSteps(true)) assert.ok(Object.keys(s.change).length <= 1, s.id);
  assert.equal(ids[ids.length - 1], "base2");
  assert.ok(!diagSteps(false).some((s) => s.id.startsWith("msaa")));
});

test("幀統計定義：平均＝幀數÷總時間；1% Low＝最慢 1% 平均；最低＝最長一幀", () => {
  const dts = Array.from({ length: 199 }, () => 1 / 60).concat([0.1]);
  const s = frameSummary(dts);
  assert.equal(s.frames, 200);
  assert.ok(Math.abs(s.avgFps - 200 / (199 / 60 + 0.1)) < 1e-9);
  // 200 幀的 1% ＝ 2 幀：0.1 與 1/60 的平均
  assert.ok(Math.abs(s.low1Fps - 1 / ((0.1 + 1 / 60) / 2)) < 1e-9);
  assert.ok(Math.abs(s.minFps - 10) < 1e-9);
  assert.equal(s.stutters, 1);
});

test("Lite 最低 FPS 0.1 的情境：10 秒的頁面暫停幀獨立標記；有效統計排除它，原始統計保留；真實長幀不排除", () => {
  const marks = Array.from({ length: 3000 }, (_, i) => ({ dt: 1 / 55, t: i / 55, paused: false }));
  marks.push({ dt: 10, t: 54.6, paused: true, reason: "visibility:hidden" } as never);
  marks.push({ dt: 0.3, t: 64.6, paused: false });
  const r = splitFrameStats(marks);
  assert.ok(r.raw.minFps < 0.11, "原始資料保留 0.1 FPS");
  assert.ok(r.raw.avgFps < 47 && r.raw.avgFps > 45, "原始平均被 10 秒暫停拉低");
  assert.equal(r.pausedFrames, 1);
  assert.ok(Math.abs(r.pausedSeconds - 10) < 1e-9);
  assert.ok(r.valid.avgFps > 53 && r.valid.minFps < 3.4, "有效統計排除暫停，但保留 300 ms 真實長幀");
  assert.deepEqual(r.long.map((l) => l.cause), ["頁面暫停（visibility:hidden）", "真實長幀（遊戲內）"]);
});
