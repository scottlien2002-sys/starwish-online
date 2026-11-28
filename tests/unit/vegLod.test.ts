import { test } from "node:test";
import assert from "node:assert/strict";
import { approachCount, behindCamera, levelFor, shuffledOrder, tuftDensity, VEG_LOD_HQ, VEG_LOD_LITE } from "../../src/maps/starsprout/vegLod.ts";

test("植被分級：依距離選精細／中距離／簡化；邊界有遲滯，站在邊界上不會來回切換", () => {
  const { hiR, midR, hyst } = VEG_LOD_HQ;
  assert.equal(levelFor(5, null, hiR, midR, hyst), 0);
  assert.equal(levelFor(hiR + 1, null, hiR, midR, hyst), 1);
  assert.equal(levelFor(midR + 1, null, hiR, midR, hyst), 2);
  // 從精細往外走：超過 hiR 但還在遲滯內 → 維持精細
  assert.equal(levelFor(hiR + hyst - 0.1, 0, hiR, midR, hyst), 0);
  assert.equal(levelFor(hiR + hyst + 0.1, 0, hiR, midR, hyst), 1);
  // 從中距離往內：剛進 hiR 還不切，進到 hiR − hyst 才切
  assert.equal(levelFor(hiR - 0.1, 1, hiR, midR, hyst), 1);
  assert.equal(levelFor(hiR - hyst - 0.1, 1, hiR, midR, hyst), 0);
  // 在邊界附近來回抖動 1 m：等級不變
  let lvl = levelFor(hiR + 0.5, null, hiR, midR, hyst);
  let flips = 0;
  for (let i = 0; i < 200; i++) {
    const d = hiR + 0.5 + Math.sin(i) * 1;
    const n = levelFor(d, lvl, hiR, midR, hyst);
    if (n !== lvl) flips++;
    lvl = n;
  }
  assert.ok(flips <= 1, `抖動切換 ${flips} 次`);
});

test("草花密度：近處完整、遠處平滑遞減到 0（連續、單調，不會跳）", () => {
  for (const c of [VEG_LOD_HQ, VEG_LOD_LITE]) {
    for (const [full, end] of [
      [c.grassFull, c.grassEnd],
      [c.flowerFull, c.flowerEnd],
    ] as const) {
      assert.equal(tuftDensity(0, full, end, c.tuftFloor), 1);
      assert.equal(tuftDensity(full, full, end, c.tuftFloor), 1);
      assert.equal(tuftDensity(end, full, end, c.tuftFloor), 0);
      let prev = 1;
      for (let d = 0; d <= end + 2; d += 0.25) {
        const v = tuftDensity(d, full, end, c.tuftFloor);
        assert.ok(v <= prev + 1e-9, `d=${d} 密度上升`);
        // 每 0.25 m 變化不超過 6%（平滑）
        assert.ok(prev - v < 0.06, `d=${d} 跳動 ${(prev - v).toFixed(3)}`);
        prev = v;
      }
    }
  }
});

test("近距離美術保留：精細等級的距離 ≥ 舊版近景範圍的一半、草花完整密度範圍 ≥ 12 m", () => {
  assert.ok(VEG_LOD_HQ.hiR >= 20 && VEG_LOD_LITE.hiR >= 14);
  assert.ok(VEG_LOD_HQ.grassFull >= 14 && VEG_LOD_LITE.grassFull >= 12);
  assert.ok(VEG_LOD_HQ.farR >= 150 && VEG_LOD_LITE.farR >= 110, "不早於霧的盡頭剔除");
  assert.ok(VEG_LOD_HQ.grassEnd >= 40 && VEG_LOD_LITE.grassEnd >= 28, "草最遠顯示距離與舊版相同");
});

test("鏡頭後方剔除：前方與兩側保留；近處（含背後）一律保留", () => {
  const c = VEG_LOD_HQ;
  assert.equal(behindCamera(0, 30, 30, 0, 1, c.behindCos, c.behindR), false);
  assert.equal(behindCamera(30, 0, 30, 0, 1, c.behindCos, c.behindR), false); // 正側面
  assert.equal(behindCamera(0, -30, 30, 0, 1, c.behindCos, c.behindR), true); // 正後方
  assert.equal(behindCamera(0, -10, 10, 0, 1, c.behindCos, c.behindR), false); // 近處背後保留（鏡頭在角色後方）
});

test("數量平滑靠近目標；洗牌可重現且是完整排列", () => {
  assert.equal(approachCount(0, 100, 15), 15);
  assert.equal(approachCount(90, 100, 15), 100);
  assert.equal(approachCount(100, 0, 15), 85);
  const a = shuffledOrder(500, 42);
  const b = shuffledOrder(500, 42);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 500);
  // 前 30% 平均分布在整個範圍（不是集中在前面）
  const head = Array.from(a.slice(0, 150));
  const mean = head.reduce((x, y) => x + y, 0) / head.length;
  assert.ok(mean > 180 && mean < 320, `前段平均 ${mean}`);
});

test("instKey：可重現、0～1 均勻", async () => {
  const { instKey } = await import("../../src/maps/starsprout/vegLod.ts");
  assert.equal(instKey(7, 3), instKey(7, 3));
  const bins = new Array(10).fill(0);
  for (let i = 0; i < 20000; i++) bins[Math.floor(instKey(i, 101) * 10)]++;
  for (const b of bins) assert.ok(b > 1700 && b < 2300, String(bins));
});
