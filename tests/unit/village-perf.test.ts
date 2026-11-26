import assert from "node:assert/strict";
import { test } from "node:test";
import { casterInRange, diagSteps, lodLevel, shadowSpec, villagePerfConfig } from "../../src/maps/village/villagePerf.ts";

const HQ = { quality: "high" as const, lite: false, qualityMaxRes: 2, qualityMsaa: 4, qualityPost: true };
const LITE = { quality: "low" as const, lite: true, qualityMaxRes: 1.25, qualityMsaa: 1, qualityPost: false };
const P = (q = ""): URLSearchParams => new URLSearchParams(q);

test("Stage 6.3 HQ 預設：PCSS 1024 中取樣、解析度上限 1.5x、NPC LOD、遠距動作暫停、陰影投射物剔除", () => {
  const c = villagePerfConfig(P(), HQ);
  assert.equal(c.profile, "opt");
  assert.equal(c.shadow, "pcss1024");
  assert.equal(c.maxRes, 1.5);
  assert.equal(c.msaa, 4);
  assert.ok(c.npcLod && c.animThrottle && c.casterCull);
  assert.equal(c.originalModels, false);
});

test("?perf=s62 重現 Stage 6.2：PCSS 2048 高取樣、2x、原始模型、沒有 LOD／剔除", () => {
  const c = villagePerfConfig(P("perf=s62"), HQ);
  assert.equal(c.profile, "s62");
  assert.equal(c.shadow, "pcss2048");
  assert.equal(c.maxRes, 2);
  assert.ok(c.originalModels && !c.npcLod && !c.animThrottle && !c.casterCull);
});

test("Lite（低畫質）沿用 PCF 512、畫質表解析度；個別參數可覆寫", () => {
  const l = villagePerfConfig(P(), LITE);
  assert.equal(l.shadow, "pcf512");
  assert.equal(l.maxRes, 1.25);
  assert.equal(l.lodNear, 14);
  const o = villagePerfConfig(P("shadow=blob&res=1.25&msaa=2&hdr=0&npclod=0&castercull=0&reslock=1"), HQ);
  assert.deepEqual([o.shadow, o.maxRes, o.msaa, o.hdr, o.npcLod, o.casterCull, o.resLock], ["blob", 1.25, 2, false, false, false, true]);
  assert.equal(villagePerfConfig(P("shadow=xyz&msaa=3"), HQ).shadow, "pcss1024");
  assert.equal(villagePerfConfig(P("msaa=3"), HQ).msaa, 4);
});

test("陰影模式對應：2048/1024/PCF/腳底陰影/關閉", () => {
  assert.deepEqual(shadowSpec("pcss2048"), { map: true, size: 2048, contact: true, filtering: "high", blobs: false });
  assert.equal(shadowSpec("pcss1024").size, 1024);
  assert.equal(shadowSpec("pcss1024").filtering, "medium");
  assert.equal(shadowSpec("pcf1024").contact, false);
  assert.ok(!shadowSpec("blob").map && shadowSpec("blob").blobs);
  assert.ok(!shadowSpec("off").map && !shadowSpec("off").blobs);
});

test("角色 LOD 有遲滯（不會在邊界來回閃）", () => {
  assert.equal(lodLevel(18.5, 18, 0), 0);
  assert.equal(lodLevel(18.8, 18, 0), 1);
  assert.equal(lodLevel(17.5, 18, 1), 1);
  assert.equal(lodLevel(17.2, 18, 1), 0);
});

test("陰影投射物剔除：範圍內或包圍球碰到範圍才畫進陰影", () => {
  assert.ok(casterInRange(10, 0, 1, 0, 0, 31.5));
  assert.ok(!casterInRange(40, 0, 2, 0, 0, 31.5));
  assert.ok(casterInRange(40, 0, 10, 0, 0, 31.5));
});

test("效能診斷：HQ 包含解析度 1/1.25/1.5/2、PCSS 2048/1024、PCF、腳底陰影、後製、角色、CPU 項；每項只改一個因素", () => {
  const ids = diagSteps(true).map((s) => s.id);
  for (const k of ["base", "res1", "res125", "res15", "res2", "pcss2048", "pcss1024", "pcf1024", "blob", "noshadow", "msaa1", "nohdr", "nopost", "nolod", "nochar", "nostatic", "cpu"]) assert.ok(ids.includes(k), k);
  for (const s of diagSteps(true)) assert.ok(Object.keys(s.change).length <= 1, s.id);
  assert.ok(!diagSteps(false).some((s) => s.id === "pcss2048"));
});
