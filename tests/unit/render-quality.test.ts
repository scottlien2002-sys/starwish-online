import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUALITY_LEVELS,
  defaultQuality,
  nextQuality,
  qualitySettings,
  resolutionSteps,
  resolveQuality,
} from "../../src/render/quality.ts";

test("畫質：三種等級都存在", () => {
  assert.deepEqual([...QUALITY_LEVELS], ["high", "medium", "low"]);
  for (const l of QUALITY_LEVELS) assert.equal(qualitySettings(l).level, l);
});

test("畫質：同一時間只使用一種抗鋸齒", () => {
  for (const l of QUALITY_LEVELS) {
    const s = qualitySettings(l);
    const methods = [s.msaaSamples > 1 && s.postProcess, s.fxaa && s.postProcess, s.canvasAntialias].filter(Boolean).length;
    assert.ok(methods <= 1, `${l} 使用了 ${methods} 種抗鋸齒`);
    if (s.postProcess) assert.equal(s.canvasAntialias, false, `${l}：有後製管線時畫布不再開抗鋸齒`);
  }
});

test("畫質：低畫質關閉昂貴特效", () => {
  const low = qualitySettings("low");
  assert.equal(low.postProcess, false);
  assert.equal(low.bloom.enabled, false);
  assert.equal(low.environmentMap, false);
  assert.notEqual(low.shadows.filter, "contact");
  assert.ok(low.shadows.mapSize <= 512);
  assert.ok(low.maxPixelRatio <= 1.25);
});

test("畫質：中畫質成本低於高畫質", () => {
  const h = qualitySettings("high");
  const m = qualitySettings("medium");
  assert.ok(m.maxPixelRatio < h.maxPixelRatio);
  assert.ok(m.shadows.mapSize < h.shadows.mapSize);
  assert.ok(m.bloom.textureRatio < h.bloom.textureRatio);
  assert.ok(m.msaaSamples <= h.msaaSamples);
  assert.equal(h.shadows.filter, "contact", "高畫質使用柔和接觸陰影");
});

test("畫質：所有等級都有色調映射（避免過曝）", () => {
  for (const l of QUALITY_LEVELS) {
    const t = qualitySettings(l).toneMapping;
    assert.equal(t.enabled, true);
    assert.ok(t.exposure > 0.5 && t.exposure < 2);
  }
});

test("畫質：回傳的是複本，不會被外部改壞", () => {
  const a = qualitySettings("high");
  a.bloom.intensity = 99;
  assert.notEqual(qualitySettings("high").bloom.intensity, 99);
});

test("畫質：預設值與選擇順序", () => {
  assert.equal(defaultQuality({ coarsePointer: true }), "medium");
  assert.equal(defaultQuality({ coarsePointer: false }), "high");
  assert.equal(defaultQuality({ coarsePointer: true, deviceMemoryGB: 2 }), "low");
  assert.equal(resolveQuality("low", "high", "medium"), "low", "網址參數優先");
  assert.equal(resolveQuality(null, "high", "medium"), "high", "其次為上次選擇");
  assert.equal(resolveQuality("ultra", "bogus", "medium"), "medium", "無效值用預設");
  assert.equal(nextQuality("high"), "medium");
  assert.equal(nextQuality("low"), "high");
});

test("動態解析度：從畫質上限往下，最低 1 倍", () => {
  assert.deepEqual(resolutionSteps(3, 2), [2, 1.5, 1.25, 1]);
  assert.deepEqual(resolutionSteps(3, 1.5), [1.5, 1.25, 1]);
  assert.deepEqual(resolutionSteps(1, 2), [1]);
  assert.deepEqual(resolutionSteps(2, 1.25), [1.25, 1]);
});
