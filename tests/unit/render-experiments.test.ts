import { test } from "node:test";
import assert from "node:assert/strict";
import { contactShadowQuality, experimentLabels, experimentTag, renderExperimentsFromSearch } from "../../src/render/renderExperiments.ts";
import { benchKey, compareExperimentRows, type BenchResult } from "../../src/game/benchMode.ts";

/** Stage 5.3-3：渲染效能實驗開關（預設全部關閉） */

test("沒有參數＝原始畫質；只接受已定義的 opt／diag", () => {
  assert.deepEqual(renderExperimentsFromSearch(""), { opt: [], diag: null });
  assert.deepEqual(renderExperimentsFromSearch("?bobo=v38r&quality=high&bench=1"), { opt: [], diag: null });
  assert.deepEqual(renderExperimentsFromSearch("?opt=pcss32"), { opt: ["pcss32"], diag: null });
  assert.deepEqual(renderExperimentsFromSearch("?opt=pcss32,pcss32,bogus"), { opt: ["pcss32"], diag: null });
  assert.deepEqual(renderExperimentsFromSearch("?diag=noshadow"), { opt: [], diag: "noshadow" });
  assert.deepEqual(renderExperimentsFromSearch("?diag=nomsaa"), { opt: [], diag: "nomsaa" });
  assert.deepEqual(renderExperimentsFromSearch("?diag=nohdr"), { opt: [], diag: "nohdr" });
  assert.deepEqual(renderExperimentsFromSearch("?diag=everything"), { opt: [], diag: null });
  assert.equal(experimentTag({ opt: [], diag: null }), "");
  assert.equal(experimentTag({ opt: ["pcss32"], diag: null }), "opt:pcss32");
  assert.equal(experimentTag({ opt: ["pcss32"], diag: "nomsaa" }), "opt:pcss32+diag:nomsaa");
  assert.equal(experimentLabels({ opt: [], diag: "noshadow" })[0]!.startsWith("診斷"), true);
});

const r = (avg: number, experiment?: string): BenchResult => ({
  variant: "v38r",
  quality: "high",
  pixelRatio: 2,
  devicePixelRatio: 3,
  width: 1704,
  height: 786,
  warmup: 3,
  summary: { seconds: 10, frames: 340, avgFps: avg, low1Fps: avg - 4, minFps: avg - 12, avgDrawCalls: 58, maxDrawCalls: 58 },
  avgActiveMeshes: 41,
  maxActiveMeshes: 41,
  meshes: 51,
  materials: 24,
  textures: 11,
  monsters: 3,
  ...(experiment ? { experiment } : {}),
  at: "",
  userAgent: "",
});

test("實驗結果另存（不覆蓋原始畫質）並與原始畫質比較", () => {
  assert.equal(benchKey(r(34.4)), "v38r_high");
  assert.equal(benchKey(r(40, "opt:pcss32")), "v38r_high_opt:pcss32");
  const rows = compareExperimentRows(r(34.4), r(40, "opt:pcss32"))!;
  assert.match(rows[0]!, /目前預設 → 實驗 opt:pcss32/);
  assert.match(rows[1]!, /34\.4 → 40\.0（\+5\.6）/);
  assert.equal(compareExperimentRows(undefined, r(40, "opt:pcss32")), null);
  assert.equal(compareExperimentRows(r(34.4), r(35)), null);
});

test("Stage 5.3 正式整合：V3.8R 高畫質預設 PCSS32；V2 維持原本；?shadowq=original 回退；中低畫質（PCF）不受影響", () => {
  const none = renderExperimentsFromSearch("");
  assert.equal(contactShadowQuality("contact", "v38r", none), "medium");
  assert.equal(contactShadowQuality("contact", "v2", none), "high");
  const orig = renderExperimentsFromSearch("?bobo=v38r&shadowq=original");
  assert.equal(orig.shadowOriginal, true);
  assert.equal(contactShadowQuality("contact", "v38r", orig), "high");
  assert.equal(experimentTag(orig), "shadowq:original");
  assert.equal(contactShadowQuality("contact", "v2", renderExperimentsFromSearch("?opt=pcss32")), "medium");
  assert.equal(contactShadowQuality("pcf", "v38r", none), null);
  assert.equal(contactShadowQuality("pcf", "v2", orig), null);
  assert.equal(renderExperimentsFromSearch("?shadowq=bogus").shadowOriginal, undefined);
});
