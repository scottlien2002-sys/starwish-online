import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { C10B_REFERENCE, C10B_VIEWS, c10pAbLabel, c10pShadowMode, c10pMergeGroups, c10pSlot, frameHistogram, frameTimeline, windowHistograms, isLowView, wantsGlow, c10bFile, c10bLayout, c10bOptionsFromSearch, countHitches, windowAverages, c10dGroup, firstLastFps, firstBelow, cooldownText, intervalStats, timeWindows, latencyStats, rafFps } from "../../src/characters/noviceC10b.ts";

test("C1.0-B：檔名與網址參數", () => {
  assert.equal(c10bFile("female", "lite"), "novice_c10b_female_lite.glb");
  const d = c10bOptionsFromSearch("?lab=c10b");
  assert.deepEqual(d, { lod: "hq", count: 2, bench: 0, warmup: 2, view: "front", p1: false, p2: false, diag: [], gpuProbe: false, shadowRefresh: "every", shadowFilter: "default", shadowMap: null, rest: 0, fixSize: false, star: 0, p3: false, res: null, round: 1, raf: false });
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

test("C1.0-P P3-2：徽記修正版檔名與優化開關", () => {
  assert.equal(c10bFile("male", "hq", true), "novice_c10b1_male_hq.glb");
  assert.equal(c10bFile("female", "lite", true), "novice_c10b_female_lite.glb");
  assert.equal(c10bFile("male", "lite"), "novice_c10b_male_lite.glb");
  const o = c10bOptionsFromSearch("?lab=c10b&star=1&p3=1");
  assert.equal(o.star, 1);
  assert.equal(o.p3, true);
});

// C1.0-B1：男生披風徽記修正版（art-novice-c10b1，Blender CI＋glTF Validator 0/0）
for (const [l, bytes] of [["hq", 5237036], ["lite", 1340840]] as const) {
  const p = `public/models/novice_c10b1_male_${l}.glb`;
  test(`C1.0-B1 GLB male ${l}：檔案、32 網格、26 材質、不透明、無骨架`, { skip: !existsSync(p) }, () => {
    assert.equal(readFileSync(p).length, bytes);
    const j = glbJson(p);
    assert.equal(j.meshes.length, 32);
    assert.equal(j.materials.length, 26);
    assert.ok(j.materials.every((m) => !m.alphaMode || m.alphaMode === "OPAQUE"));
    assert.ok(!j.skins?.length && !j.animations?.length);
  });
}

test("C1.0-B2：徽記縮小版檔名（star=2；女生不變）", () => {
  assert.equal(c10bOptionsFromSearch("?lab=c10b&star=2").star, 2);
  assert.equal(c10bOptionsFromSearch("?lab=c10b&star=x").star, 0);
  assert.equal(c10bFile("male", "hq", 2), "novice_c10b2_male_hq.glb");
  assert.equal(c10bFile("male", "lite", 2), "novice_c10b2_male_lite.glb");
  assert.equal(c10bFile("female", "hq", 2), "novice_c10b_female_hq.glb");
  assert.equal(c10bFile("male", "hq", 1), "novice_c10b1_male_hq.glb");
  assert.equal(c10bFile("male", "hq", 0), "novice_c10b_male_hq.glb");
});

// C1.0-B2：男生披風徽記縮小版（art-novice-c10b2 2875dd76，Blender CI＋glTF Validator 0/0）— 正式美術基準
for (const [l, bytes, tris] of [["hq", 5241688, 199965], ["lite", 1335724, 40395]] as const) {
  const p = `public/models/novice_c10b2_male_${l}.glb`;
  test(`C1.0-B2 GLB male ${l}：檔案、32 網格、26 材質、${tris} 三角形、不透明、無骨架`, { skip: !existsSync(p) }, () => {
    assert.equal(readFileSync(p).length, bytes);
    const j = glbJson(p);
    assert.equal(j.meshes.length, 32);
    assert.equal(j.materials.length, 26);
    const jj = j as unknown as { meshes: { primitives: { indices: number }[] }[]; accessors: { count: number }[] };
    const t = jj.meshes.reduce((a, m) => a + m.primitives.reduce((b2, pr) => b2 + jj.accessors[pr.indices]!.count / 3, 0), 0);
    assert.equal(t, tris);
    assert.ok(j.materials.every((m) => !m.alphaMode || m.alphaMode === "OPAQUE"));
    assert.ok(!j.skins?.length && !j.animations?.length);
  });
}

test("C1.0-B2 效能診斷：組別（每組只改一個因素）與 ?res", () => {
  const g = (q: string): string => c10dGroup(c10bOptionsFromSearch(q));
  const base = "?lab=c10b&quality=high&p1=1&p2=1&star=2&p3=1&rest=30&bench=120&fixsize=1";
  assert.equal(g(base), "D0 原始 HQ");
  assert.match(g(base + "&shadowfilter=low"), /^D1 /);
  assert.match(g(base + "&res=1.5"), /^D2 /);
  assert.match(g(base + "&res=1.5&shadowfilter=low"), /^混合/);
  assert.equal(c10bOptionsFromSearch(base + "&res=1.5").res, 1.5);
  assert.equal(c10bOptionsFromSearch(base + "&res=0.3").res, null);
  assert.equal(c10bOptionsFromSearch(base + "&res=1.25").res, 1.25);
  assert.equal(c10bOptionsFromSearch(base).res, null);
});

test("C1.0-B2 效能診斷：前 30 秒／最後 30 秒 FPS、首次低於 45、冷卻文字", () => {
  // 前 30 秒 60 FPS、之後 90 秒 30 FPS
  const dts = [...Array<number>(1800).fill(1 / 60), ...Array<number>(2700).fill(1 / 30)];
  const r = firstLastFps(dts, 30);
  assert.ok(Math.abs(r.first - 60) < 0.2 && Math.abs(r.last - 30) < 0.2, JSON.stringify(r));
  assert.ok(Math.abs(r.diff - 30) < 0.3 && Math.abs(r.diffPct - 50) < 0.5);
  assert.equal(firstBelow([{ t0: 0, fps: 60 }, { t0: 5, fps: 59 }, { t0: 15, fps: 44.9 }, { t0: 20, fps: 34 }], 45), 15);
  assert.equal(firstBelow([{ t0: 0, fps: 60 }], 45), null);
  assert.match(cooldownText(null), /沒有上一次/);
  assert.match(cooldownText(300), /冷卻不足/);
  assert.match(cooldownText(600), /已滿 10 分鐘/);
});

test("C1.0-B2 第二輪：E0／E1／E2 組別（每組只改一個因素）", () => {
  const base = "?lab=c10b&quality=high&p1=1&p2=1&star=2&p3=1&rest=30&bench=120&fixsize=1&round=2";
  const g = (q: string): string => c10dGroup(c10bOptionsFromSearch(base + q));
  assert.match(g(""), /^E0 /);
  assert.match(g("&diag=nochars"), /^E1 /);
  assert.match(g("&raf=1"), /^E2 /);
  assert.match(g("&diag=nochars&res=1.5"), /^混合/);
  assert.match(g("&diag=noshadow"), /^混合/);
  // 第一輪網址不受影響
  assert.equal(c10dGroup(c10bOptionsFromSearch(base.replace("&round=2", ""))), "D0 原始 HQ");
});

test("C1.0-B2 第二輪：間隔分布、時間分段、fence 延遲統計", () => {
  const st = intervalStats([16.7, 16.7, 33.3, 33.3, 50]);
  assert.equal(st.n, 5);
  assert.deepEqual([st.le20, st.le37, st.le54, st.gt54], [2, 2, 1, 0]);
  assert.ok(Math.abs(st.fps - 5000 / 150) < 0.1);
  const pts = [...Array(300)].map((_, i) => ({ t: i / 60, v: 1000 / 60 }));
  const w = timeWindows(pts, 2, 6, rafFps);
  assert.equal(w.length, 3);
  assert.ok(Math.abs(w[0]!.value! - 60) < 0.2, JSON.stringify(w));
  assert.ok(w[2]!.value !== null && Math.abs(w[2]!.value - 60) < 0.2);
  assert.deepEqual(timeWindows([], 30, 60, rafFps).map((x) => x.value), [null, null]);
  const l = latencyStats([10, 12, 14, 40]);
  assert.equal(l.n, 4);
  assert.equal(l.avg, 19);
  assert.equal(l.p95, 40);
  assert.deepEqual(latencyStats([]), { avg: 0, p95: 0, n: 0 });
});
