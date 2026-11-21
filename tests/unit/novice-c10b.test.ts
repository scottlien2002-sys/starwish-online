import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { C10B_REFERENCE, C10B_VIEWS, c10bFile, c10bLayout, c10bOptionsFromSearch, countHitches, windowAverages } from "../../src/characters/noviceC10b.ts";

test("C1.0-B：檔名與網址參數", () => {
  assert.equal(c10bFile("female", "lite"), "novice_c10b_female_lite.glb");
  const d = c10bOptionsFromSearch("?lab=c10b");
  assert.deepEqual(d, { lod: "hq", count: 2, bench: 0, warmup: 2, view: "front" });
  const o = c10bOptionsFromSearch("?lab=c10b&lod=lite&count=99&bench=30&view=low");
  assert.equal(o.lod, "lite");
  assert.equal(o.count, 20);
  assert.equal(o.bench, 30);
  assert.equal(o.view, "low");
  assert.equal(c10bOptionsFromSearch("?view=nope").view, "front");
});

test("C1.0-B：站位（2 人男左女右；多人男女交替）", () => {
  const two = c10bLayout(2);
  assert.equal(two.length, 2);
  assert.equal(two[0]!.gender, "male");
  assert.ok(two[0]!.x > 0 && two[1]!.x < 0);
  const ten = c10bLayout(10);
  assert.equal(ten.filter((p) => p.gender === "male").length, 5);
});

test("C1.0-B：低角度鏡頭不會穿到地面以下", () => {
  for (const v of [C10B_VIEWS.low, C10B_VIEWS.lowBack]) {
    const camY = v.y + v.radius * Math.cos(v.beta);
    assert.ok(camY > 0.02 && camY < 0.3, `camY ${camY}`);
  }
});

test("C1.0-B：長時間測試分段平均與卡頓計數", () => {
  const dts = Array.from({ length: 1800 }, () => 1 / 60).concat(Array.from({ length: 900 }, () => 1 / 30));
  const w = windowAverages(dts, 30);
  assert.equal(w.length, 2);
  assert.ok(Math.abs(w[0]! - 60) < 0.5 && Math.abs(w[1]! - 30) < 0.5);
  assert.equal(countHitches([0.016, 0.2, 0.12, 0.05]), 2);
});

const glbJson = (p: string): { meshes: unknown[]; materials: { alphaMode?: string }[]; skins?: unknown[]; animations?: unknown[] } => {
  const b = readFileSync(p);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString("utf8"));
};

for (const g of ["male", "female"] as const)
  for (const l of ["hq", "lite"] as const) {
    const p = `public/models/${c10bFile(g, l)}`;
    test(`C1.0-B GLB ${g} ${l}：檔案大小、網格、材質（不透明、無骨架與動畫）`, { skip: !existsSync(p) }, () => {
      const ref = C10B_REFERENCE[g][l];
      assert.equal(readFileSync(p).length, ref.bytes);
      const j = glbJson(p);
      assert.equal(j.meshes.length, ref.meshes);
      assert.equal(j.materials.length, C10B_REFERENCE.materials);
      assert.ok(j.materials.every((m) => !m.alphaMode || m.alphaMode === "OPAQUE"));
      assert.ok(!j.skins?.length && !j.animations?.length);
    });
  }
