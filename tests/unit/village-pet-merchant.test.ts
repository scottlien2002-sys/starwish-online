// Stage 6 星芽村寵物商人：巡走路線不穿過障礙物、不擋主路與出生點；占位服務不產生鑑定結果／價格；選單流程
import assert from "node:assert/strict";
import { test } from "node:test";
import { FOUNTAIN, NPC_SPOTS, ROADS, SPAWN_SLOTS, STAIRS } from "../../src/maps/village/layout.ts";
import {
  canTalkToPetMerchant,
  connectPetMerchantService,
  PET_MERCHANT,
  PET_MERCHANT_LOOP_SEC,
  petMenuStep,
  petMerchantClearance,
  petMerchantPose,
  petMerchantService,
  PLACEHOLDER_PET_MERCHANT_SERVICE,
  type PetMerchantService,
} from "../../src/maps/village/petMerchant.ts";

test("巡走路線：在噴泉步道外緣，與水池、長椅、水晶燈座、路燈等所有碰撞物保持 ≥ 0.4 m 淨距", () => {
  const c = petMerchantClearance();
  assert.ok(PET_MERCHANT.patrolR - PET_MERCHANT.bodyR > FOUNTAIN.basinR + 1, "離水池太近");
  assert.ok(c.minCircleGap >= 0.4, `最近障礙物 ${c.nearestCircle} 淨距 ${c.minCircleGap.toFixed(2)} m`);
  assert.equal(c.insideBox, false, "路線進入建築或佈告欄、鍛造台碰撞箱");
  assert.equal(c.allStandable, true, "路線上有不可站立的位置");
});

test("巡走路線：離 24 個出生點 ≥ 1.5 m、離所有 NPC ≥ 3 m", () => {
  const c = petMerchantClearance();
  assert.ok(c.minSpawnDist >= 1.5, `最近出生點 ${c.minSpawnDist.toFixed(2)} m`);
  assert.ok(c.minNpcDist >= 3, `最近 NPC ${c.minNpcDist.toFixed(2)} m`);
  assert.equal(SPAWN_SLOTS.length, 24);
});

test("停留點避開主路與石階軸線（≥ 12°），並在廣場可行走區", () => {
  const c = petMerchantClearance();
  assert.ok(c.stationAxisGapDeg >= 12, `停留點離主路／石階軸線 ${c.stationAxisGapDeg}°`);
  for (const s of PET_MERCHANT.stations) for (const a of [...ROADS, ...STAIRS]) assert.ok(Math.abs(((s - a + 540) % 360) - 180) >= 12);
});

test("巡走：位置永遠在路線圓上、速度不超過設定、面向連續；一圈後回到起點", () => {
  const P = PET_MERCHANT;
  let prev = petMerchantPose(0);
  let maxV = 0;
  let maxTurn = 0;
  let walkT = 0;
  const dt = 0.05;
  for (let t = dt; t <= PET_MERCHANT_LOOP_SEC + 1e-6; t += dt) {
    const p = petMerchantPose(t);
    assert.ok(Math.abs(Math.hypot(p.x, p.z) - P.patrolR) < 1e-6);
    maxV = Math.max(maxV, Math.hypot(p.x - prev.x, p.z - prev.z) / dt);
    let dy = Math.abs(p.yaw - prev.yaw) % (2 * Math.PI);
    if (dy > Math.PI) dy = 2 * Math.PI - dy;
    maxTurn = Math.max(maxTurn, dy / dt);
    if (p.walking) walkT += dt;
    prev = p;
  }
  assert.ok(maxV <= P.speed * 1.02, `最高速度 ${maxV.toFixed(3)} m/s`);
  assert.ok(maxTurn < 4.5, `轉身角速度 ${maxTurn.toFixed(2)} rad/s`);
  assert.ok(walkT > PET_MERCHANT_LOOP_SEC * 0.6, "大部分時間在走動");
  const a = petMerchantPose(0);
  const b = petMerchantPose(PET_MERCHANT_LOOP_SEC);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1e-6);
  assert.equal(a.station, 0);
});

test("互動範圍 2.5 m", () => {
  const m = petMerchantPose(0);
  assert.equal(canTalkToPetMerchant(m.x + 2.4, m.z, 0), true);
  assert.equal(canTalkToPetMerchant(m.x + 2.6, m.z, 0), false);
});

test("占位服務：所有功能回覆「準備中」，不產生鑑定結果、價格或機率", async () => {
  const s = PLACEHOLDER_PET_MERCHANT_SERVICE;
  assert.equal(s.available, false);
  for (const r of [await s.appraisableItems("seed"), await s.appraise("x"), await s.feedOffers(), await s.buyFeed("x", 1), await s.careGuide()]) {
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "unavailable");
  }
  assert.equal(petMerchantService(), PLACEHOLDER_PET_MERCHANT_SERVICE);
});

test("選單：開啟 → 鑑定 → 選種類 → 準備中訊息 → 返回 → 飼料 → 培育 → 離開", async () => {
  let s = await petMenuStep({ screen: "closed" }, { type: "open" });
  assert.equal(s.screen, "root");
  s = await petMenuStep(s, { type: "choose", option: "appraise" });
  assert.equal(s.screen, "appraiseKind");
  s = await petMenuStep(s, { type: "kind", kind: "birdEgg" });
  assert.equal(s.screen, "message");
  assert.equal(s.title, "鑑定鳥蛋");
  assert.match(s.lines!.join(""), /尚未開放/);
  s = await petMenuStep(s, { type: "back" });
  assert.equal(s.screen, "appraiseKind");
  s = await petMenuStep(s, { type: "back" });
  assert.equal(s.screen, "root");
  s = await petMenuStep(s, { type: "choose", option: "feed" });
  assert.match(s.lines!.join(""), /尚未開放/);
  s = await petMenuStep(s, { type: "choose", option: "guide" });
  assert.equal(s.title, "培育與進化");
  s = await petMenuStep(s, { type: "choose", option: "leave" });
  assert.equal(s.screen, "closed");
});

test("連接正式服務後，選單改用正式資料（測試用假服務）", async () => {
  const fake: PetMerchantService = {
    available: true,
    appraisableItems: async (kind) => ({ ok: true, data: [{ itemId: "a", name: "測試種子", kind }] }),
    appraise: async (itemId) => ({ ok: true, data: { itemId, kind: "seed", lines: [] } }),
    feedOffers: async () => ({ ok: true, data: [{ id: "f", name: "測試飼料", price: 1 }] }),
    buyFeed: async () => ({ ok: true, data: { bought: 1 } }),
    careGuide: async () => ({ ok: true, data: [{ title: "測試", body: "內容" }] }),
  };
  connectPetMerchantService(fake);
  try {
    const s = await petMenuStep({ screen: "appraiseKind" }, { type: "kind", kind: "seed" });
    assert.deepEqual(s.lines, ["・測試種子"]);
    const f = await petMenuStep({ screen: "root" }, { type: "choose", option: "feed" });
    assert.deepEqual(f.lines, ["・測試飼料　1 金幣"]);
  } finally {
    connectPetMerchantService(null);
  }
  assert.equal(petMerchantService().available, false);
});

test("寵物商人不改動既有 NPC 與出生點", () => {
  assert.equal(NPC_SPOTS.some((n) => n.id === PET_MERCHANT.id), false);
});
