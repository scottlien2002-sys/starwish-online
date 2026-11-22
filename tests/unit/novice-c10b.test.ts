import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { C10B_REFERENCE, C10B_VIEWS, c10pAbLabel, c10pShadowMode, c10pMergeGroups, c10pSlot, frameHistogram, frameTimeline, windowHistograms, isLowView, wantsGlow, c10bFile, c10bLayout, c10bOptionsFromSearch, countHitches, windowAverages } from "../../src/characters/noviceC10b.ts";

test("C1.0-B：檔名與網址參數", () => {
  assert.equal(c10bFile("female", "lite"), "novice_c10b_female_lite.glb");
  const d = c10bOptionsFromSearch("?lab=c10b");
  assert.deepEqual(d, { lod: "hq", count: 2, bench: 0, warmup: 2, view: "front", p1: false, p2: false, diag: [], gpuProbe: false, shadowRefresh: "every", shadowFilter: "default", shadowMap: null, rest: 0, fixSize: false });
  assert.deepEqual(c10bOptionsFromSearch("?diag=noshadow,bogus,nopost&gpu=1").diag, ["noshadow", "nopost"]);
  assert.equal(c10bOptionsFromSearch("?lab=c10b&p1=1").p1, true);
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

test("C1.0-B：低角度鏡頭在腳底附近往上看；其他視角在地面以上", () => {
  for (const [k, v] of Object.entries(C10B_VIEWS)) {
    const camY = v.y + v.radius * Math.cos(v.beta);
    if (isLowView(k as never)) assert.ok(camY > -0.2 && camY < 0.05 && v.beta > Math.PI / 2, `${k} camY ${camY}`);
    else assert.ok(camY > 0.15, `${k} camY ${camY}`);
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

test("C1.0-P P1：A/B 組名與發光標記", () => {
  assert.match(c10pAbLabel({ p1: false, p2: false }), /^A0/);
  assert.match(c10pAbLabel({ p1: true, p2: false }), /^A1/);
  assert.match(c10pAbLabel({ p1: true, p2: true }), /^A2/);
  assert.equal(wantsGlow(undefined), false);
  assert.equal(wantsGlow({ glow: true }), true);
  assert.equal(wantsGlow({ glow: 1 }), false);
});

test("C1.0-P P2：模組分類（臉、身體、髮型、手、腳、服裝各自獨立）", () => {
  assert.equal(c10pSlot("female0_head"), "face");
  assert.equal(c10pSlot("male3_hand_l"), "body");
  assert.equal(c10pSlot("female1_ponytail"), "hair");
  assert.equal(c10pSlot("female1_bow_star"), "hair");
  assert.equal(c10pSlot("male0_rivet_r"), "hands");
  assert.equal(c10pSlot("male0_boot_sole"), "feet");
  assert.equal(c10pSlot("female0_safety_shorts"), "outfit");
  assert.equal(c10pSlot("male0_tabard_star"), "outfit");
});

test("C1.0-P P2：分組只合併同模組、同材質", () => {
  const g = c10pMergeGroups([
    { name: "hair", materialKey: "m6" },
    { name: "shirt", materialKey: "c86" },
    { name: "shorts", materialKey: "c86" },
    { name: "bow", materialKey: "c86" },
    { name: "ponytail", materialKey: "m6" },
  ]);
  assert.deepEqual(g.map((x) => [x.slot, x.indices]), [["hair", [0, 4]], ["outfit", [1, 2]], ["hair", [3]]]);
});

test("C1.0-P：影格時間分布與分段", () => {
  assert.deepEqual(frameHistogram([1 / 60, 1 / 30, 1 / 20, 0.1]), { le20: 1, le37: 1, le54: 1, gt54: 1 });
  const w = windowHistograms(Array.from({ length: 120 }, () => 1 / 60), 1);
  assert.equal(w.length, 2);
  assert.equal(w[0]!.le20, 60);
});

test("C1.0-P P3 診斷：時間軸分段（FPS、CPU、GPU 探測、掉幀分布）", () => {
  const smp = Array.from({ length: 600 }, (_, i) => ({ dt: i < 300 ? 1 / 60 : 1 / 30, cpu: i < 300 ? 4 : 5, gpu: i % 30 === 0 ? 20 : null }));
  const w = frameTimeline(smp, 5);
  assert.equal(w.length, 3);
  assert.equal(w[0]!.fps, 60);
  assert.equal(w[1]!.fps, 30);
  assert.equal(w[0]!.le20, 300);
  assert.equal(w[1]!.le37, 150);
  assert.equal(w[0]!.cpuAvg, 4);
  assert.equal(w[0]!.gpuAvg, 20);
});

test("C1.0-P P3-1：陰影診斷參數與代號", () => {
  const o = c10bOptionsFromSearch("?lab=c10b&shadowrefresh=once&shadowfilter=pcf&shadowmap=1024&rest=30&fixsize=1&bench=60&gpu=1");
  assert.equal(o.shadowRefresh, "once");
  assert.equal(o.shadowFilter, "pcf");
  assert.equal(o.shadowMap, 1024);
  assert.equal(o.rest, 30);
  assert.equal(o.fixSize, true);
  assert.equal(o.bench, 60);
  assert.equal(c10bOptionsFromSearch("?shadowfilter=ultra&shadowmap=512&rest=999").shadowFilter, "default");
  assert.equal(c10bOptionsFromSearch("?shadowmap=512").shadowMap, null);
  assert.equal(c10bOptionsFromSearch("?rest=999").rest, 120);
  const base = { diag: [] as never[], shadowRefresh: "every" as const, shadowFilter: "default" as const, shadowMap: null, gpuProbe: true };
  assert.equal(c10pShadowMode(base), "S0 原始 HQ 陰影");
  assert.match(c10pShadowMode({ ...base, gpuProbe: false }), /^S0n/);
  assert.match(c10pShadowMode({ ...base, diag: ["noshadow"] as never[] }), /^S1/);
  assert.match(c10pShadowMode({ ...base, shadowRefresh: "once" }), /^S2/);
  assert.match(c10pShadowMode({ ...base, shadowFilter: "low" }), /^S3a/);
  assert.match(c10pShadowMode({ ...base, shadowFilter: "high" }), /^S3b/);
  assert.match(c10pShadowMode({ ...base, shadowFilter: "pcf" }), /^S3c/);
  assert.match(c10pShadowMode({ ...base, shadowMap: 1024 }), /^S4/);
});
