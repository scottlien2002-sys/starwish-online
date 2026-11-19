import assert from "node:assert/strict";
import { test } from "node:test";
import { atlasCell, expressionIndex, offsetUVs } from "../../src/monsters/assets/expressionAtlas.ts";
import { checkLodBudgets, lodFileName, rootNodeName, TRIANGLE_BUDGET, validateAssetSpec, type MonsterAssetSpec } from "../../src/monsters/assets/spec.ts";
import { formatCostRows, runCostSteps } from "../../src/render/costAnalysis.ts";
import { BOBO_V36_SPEC } from "../../src/monsters/star-dew-bobo-v36/spec.ts";

test("命名規範：檔名與根節點", () => {
  assert.equal(lodFileName(BOBO_V36_SPEC, "high"), "bobo_v36_high.glb");
  assert.equal(rootNodeName(BOBO_V36_SPEC, "low"), "StarDewBoboV36_low");
});

test("星露啵啵 V3.6 規範本身通過檢查", () => {
  assert.deepEqual(validateAssetSpec(BOBO_V36_SPEC), []);
});

test("規範檢查能找出錯誤（命名、版本、表情格數）", () => {
  const bad: MonsterAssetSpec = {
    ...BOBO_V36_SPEC,
    assetId: "Bad Name",
    pascalName: "starDew",
    version: "3.6",
    requiredParts: [],
    expressions: { names: ["a", "b", "c"], parts: [{ mesh: "Eyes", cols: 1, rows: 2, cellU: 0.5, cellV: 0.6 }] },
  };
  const e = validateAssetSpec(bad);
  assert.ok(e.some((x) => x.includes("assetId")));
  assert.ok(e.some((x) => x.includes("pascalName")));
  assert.ok(e.some((x) => x.includes("version")));
  assert.ok(e.some((x) => x.includes("requiredParts")));
  assert.ok(e.some((x) => x.includes("少於")));
  assert.ok(e.some((x) => x.includes("超出")));
});

test("不假設果凍／翅膀：骷髏系菁英怪的規範也能通過", () => {
  const skeleton: MonsterAssetSpec = {
    monsterId: "bone_knight",
    assetId: "bone_knight",
    pascalName: "BoneKnight",
    version: "v1",
    family: "skeleton",
    tier: "elite",
    heightM: 1.8,
    footprintRadiusM: 0.45,
    requiredParts: ["Body_"],
  };
  assert.deepEqual(validateAssetSpec(skeleton), []);
});

test("三種畫質預算：V3.6 實際數據通過；超標與順序錯誤會被找出", () => {
  const ok = { high: { triangles: 9310, bytes: 418000 }, medium: { triangles: 5912, bytes: 336000 }, low: { triangles: 4012, bytes: 291000 } };
  assert.deepEqual(checkLodBudgets(BOBO_V36_SPEC, ok), []);
  const bad = { high: { triangles: TRIANGLE_BUDGET.normal.high + 1, bytes: 2_000_000 }, medium: { triangles: 13000, bytes: 1 }, low: { triangles: 100, bytes: 1 } };
  const e = checkLodBudgets(BOBO_V36_SPEC, bad);
  assert.ok(e.some((x) => x.includes("bobo_v36_high.glb") && x.includes("三角形")));
  assert.ok(e.some((x) => x.includes("檔案")));
  assert.ok(e.some((x) => x.includes("bobo_v36_medium.glb")));
});

test("表情貼圖集：格子與 UV 平移（與 V3 起的眼睛／嘴巴配置相同）", () => {
  assert.deepEqual(atlasCell(5, 4), { col: 1, row: 1 });
  const eyes = BOBO_V36_SPEC.expressions!.parts[0]!;
  const uv = offsetUVs([0.1, 0.2, 0.15, 0.3], eyes, expressionIndex(BOBO_V36_SPEC.expressions!, "hurt"));
  // hurt = 第 7 格 → col 3、row 1 → 平移 (0.75, 0.5)
  assert.deepEqual(Array.from(uv).map((v) => Math.round(v * 1000) / 1000), [0.85, 0.7, 0.9, 0.8]);
  const names = BOBO_V36_SPEC.expressions!.names;
  const firsts = names.map((n) => offsetUVs([0, 0], eyes, expressionIndex(BOBO_V36_SPEC.expressions!, n)).join(","));
  assert.equal(new Set(firsts).size, 8);
  assert.throws(() => expressionIndex(BOBO_V36_SPEC.expressions!, "laugh"));
});

test("成本分析：依序套用與還原，計算與第一步的差距", async () => {
  const log: string[] = [];
  let fps = 50;
  const steps = [
    { name: "目前設定", apply: () => log.push("a0"), restore: () => log.push("r0") },
    { name: "關閉 A", apply: () => ((fps = 58), log.push("a1")), restore: () => ((fps = 50), log.push("r1")) },
  ];
  const rows = await runCostSteps(steps, async () => ({ avgFps: fps, low1Fps: fps - 5, avgDrawCalls: 23 }));
  assert.deepEqual(log, ["a0", "r0", "a1", "r1"]);
  assert.equal(rows[1]!.gain, 8);
  assert.equal(fps, 50);
  assert.match(formatCostRows(rows)[1]!, /\+8\.0/);
});
