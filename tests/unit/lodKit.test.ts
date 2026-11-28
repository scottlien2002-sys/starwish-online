import { test } from "node:test";
import assert from "node:assert/strict";
import { compactInto, fadeDensity, fadeKey, makeFadeSet, MOBILE_BUDGET, selectFade } from "../../src/world/lodKit.ts";

const R = { full: 10, end: 40, floor: 0.3, cut: 60 };

test("fadeDensity：近處全保留、遠處平滑降到 floor、超過 cut 為 0、單調遞減", () => {
  assert.equal(fadeDensity(0, R), 1);
  assert.equal(fadeDensity(10, R), 1);
  assert.ok(Math.abs(fadeDensity(40, R) - 0.3) < 1e-9);
  assert.ok(Math.abs(fadeDensity(55, R) - 0.3) < 1e-9);
  assert.equal(fadeDensity(60, R), 0);
  let prev = 1;
  for (let d = 0; d < 60; d += 0.5) {
    const v = fadeDensity(d, R);
    assert.ok(v <= prev + 1e-12, `d=${d}`);
    // 每 0.5 公尺的變化很小（沒有突然整片消失）
    assert.ok(prev - v < 0.05, `jump at ${d}`);
    prev = v;
  }
});

test("fadeKey：可重現、分佈大致均勻", () => {
  assert.equal(fadeKey(5, 3), fadeKey(5, 3));
  const bins = new Array(10).fill(0);
  for (let i = 0; i < 20000; i++) bins[Math.floor(fadeKey(i, 1) * 10)]++;
  for (const b of bins) assert.ok(b > 1700 && b < 2300, String(bins));
});

test("selectFade：固定前段永遠保留；走近只會增加、不會換一批", () => {
  const pts = [];
  for (let i = 0; i < 4000; i++) pts.push({ x: (i % 80) - 40 + 0.5, z: Math.floor(i / 80) - 25 + 0.5 });
  const set = makeFadeSet(pts, 100, 9);
  const out = new Uint32Array(pts.length);
  const far = selectFade(set, 200, 0, R, out);
  assert.equal(far, 100); // 只剩固定的
  for (let i = 0; i < 100; i++) assert.equal(out[i], i);
  const a = new Set(out.slice(0, selectFade(set, 85, 0, R, out)));
  const b = new Set(out.slice(0, selectFade(set, 60, 0, R, out)));
  // 往物件群靠近：b 的密度在每個點都 ≥ a → a ⊆ b
  for (const i of a) assert.ok(b.has(i));
  assert.ok(b.size > a.size);
});

test("compactInto：依 index 緊密複製", () => {
  const src = new Float32Array([0, 0, 1, 1, 2, 2, 3, 3]);
  const dst = new Float32Array(8);
  compactInto(src, dst, new Uint32Array([1, 3]), 2, 2);
  assert.deepEqual([...dst.slice(0, 4)], [1, 1, 3, 3]);
});

test("MOBILE_BUDGET：高 ≥ 中 ≥ 低", () => {
  assert.ok(MOBILE_BUDGET.high.sceneTris >= MOBILE_BUDGET.medium.sceneTris && MOBILE_BUDGET.medium.sceneTris >= MOBILE_BUDGET.low.sceneTris);
  assert.ok(MOBILE_BUDGET.high.drawCalls >= MOBILE_BUDGET.low.drawCalls);
});
