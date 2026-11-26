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

test("選單：開啟 → 寵物鑑定（開啟星靈鑑定視窗）→ 飼料 → 培育 → 離開", async () => {
  let s = await petMenuStep({ screen: "closed" }, { type: "open" });
  assert.equal(s.screen, "root");
  s = await petMenuStep(s, { type: "choose", option: "appraise" });
  assert.equal(s.screen, "appraise");
  s = await petMenuStep({ screen: "root" }, { type: "choose", option: "feed" });
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

// ---------------- V2：對話暫停與星靈鑑定 ----------------
import { PetMerchantPatrolClock } from "../../src/maps/village/petMerchant.ts";
import {
  begin,
  canAppraise,
  clearSlot,
  createDemoAppraisalService,
  feeText,
  finish,
  initialAppraisal,
  linesFromAffixes,
  place,
  runAppraisal,
  withItems,
  type AppraisalState,
} from "../../src/maps/village/petAppraisal.ts";

test("對話暫停：開啟時停下、關閉後從原地接著走（巡走時間扣掉暫停）", () => {
  const c = new PetMerchantPatrolClock({ shared: false });
  assert.equal(c.patrolTime(10), 10);
  c.hold("me", 10, 1, 2);
  assert.equal(c.paused(15), true);
  assert.equal(c.patrolTime(40), 10);
  assert.deepEqual(c.talkTarget(40), { x: 1, z: 2 });
  c.release("me", 40);
  assert.equal(c.paused(41), false);
  assert.equal(c.patrolTime(41), 11);
});

test("多人模式：單一玩家不能永久停住商人（回報逾時失效、連續暫停上限＋冷卻）", () => {
  const c = new PetMerchantPatrolClock({ shared: true, holdTimeoutSec: 10, maxPauseSec: 90, cooldownSec: 20 });
  c.hold("a", 0, 0, 0);
  for (let t = 1; t <= 200; t++) c.hold("a", t, 0, 0); // 一直開著、一直回報
  assert.equal(c.paused(200), false, "暫停超過 90 秒後必須恢復巡走");
  assert.ok(c.patrolTime(200) >= 200 - 90 - 90, "最多只會被暫停有限時間");
  const d = new PetMerchantPatrolClock({ shared: true, holdTimeoutSec: 10 });
  d.hold("b", 0, 0, 0); // 開了就斷線、不再回報
  assert.equal(d.paused(5), true);
  assert.equal(d.paused(11), false, "沒有回報 10 秒後自動失效");
});

const fresh = async (): Promise<{ s: AppraisalState; svc: ReturnType<typeof createDemoAppraisalService> }> => {
  const svc = createDemoAppraisalService({ delayMs: 5 });
  const inv = await svc.inventory();
  assert.ok(inv.ok);
  return { s: withItems(initialAppraisal(), inv.ok ? inv.data : [], svc.testData), svc };
};

test("鑑定：只接受種子／孵化蛋／鳥蛋；鑑定框沒有物品時按鈕停用", async () => {
  const { s } = await fresh();
  assert.equal(canAppraise(s), false);
  assert.equal(s.items.every((i) => ["seed", "egg", "birdEgg"].includes(i.kind)), true);
  const bad = withItems(s, [...s.items, { id: "x", kind: "potion" as never, name: "藥水", appraised: false }], true);
  assert.equal(bad.items.some((i) => i.id === "x"), false);
  assert.equal(place(s, "x").selectedId, null);
  assert.equal(canAppraise(place(s, "s1")), true);
  assert.equal(canAppraise(clearSlot(place(s, "s1"))), false);
});

test("鑑定：已鑑定物品不能再鑑定", async () => {
  const { s } = await fresh();
  const p = place(s, "e0");
  assert.equal(p.phase, "appraised");
  assert.equal(canAppraise(p), false);
  assert.ok(p.lines.length > 0);
});

test("鑑定：連點不會重複送出、只扣一次；完成後物品留在背包並更新為已鑑定（不消失、不複製）", async () => {
  const { s, svc } = await fresh();
  let st = place(s, "b1");
  const n0 = st.items.length;
  const set = (x: AppraisalState) => (st = x);
  const a = runAppraisal(st, svc, set, "req-1");
  // 鑑定進行中再點兩次：狀態已鎖定，不會送出
  const b = runAppraisal(st, svc, set, "req-2");
  const c2 = runAppraisal(st, svc, set, "req-3");
  await Promise.all([a, b, c2]);
  assert.equal(svc.charges(), 1);
  assert.equal(svc.gold(), 900);
  assert.equal(st.items.length, n0);
  assert.equal(st.items.filter((i) => i.id === "b1").length, 1);
  assert.equal(st.items.find((i) => i.id === "b1")!.appraised, true);
  assert.equal(st.phase, "result");
  assert.equal(st.lines.length, 4);
  // 同一個 requestId 重送：服務回傳同一結果、不再扣款
  await svc.appraise("b1", "req-1");
  assert.equal(svc.charges(), 1);
  // 再鑑定同一物品：拒絕
  const again = await svc.appraise("b1", "req-9");
  assert.equal(again.ok, false);
  assert.equal(canAppraise(place(st, "b1")), false);
});

test("鑑定：結果顏色（正＝綠、負＝紅、無屬性＝灰）與費用顯示", () => {
  const l = linesFromAffixes([{ label: "攻擊力", value: 15, unit: "percent" }, { label: "攻速", value: -2, unit: "flat" }]);
  assert.deepEqual(l.map((x) => x.polarity), ["positive", "negative"]);
  assert.equal(l[0]!.text, "+15%");
  assert.equal(l[1]!.text, "-2");
  assert.equal(linesFromAffixes([])[0]!.polarity, "none");
  assert.equal(feeText({ fee: null, test: false }), "未定案");
  assert.equal(feeText({ fee: 100, test: true }), "100 金幣（測試）");
});

test("鑑定：服務錯誤時解除鎖定、可以再試", async () => {
  const { s } = await fresh();
  const st = begin(place(s, "s1"), "r")!;
  const e = finish(st, "r", { ok: false, reason: "error", message: "x" });
  assert.equal(e.pending, null);
  assert.equal(e.phase, "error");
});

// ---------------- V2.1：正式鑑定規格（只檢查與顯示，不抽取）
import { OFFICIAL_AFFIX_VALUES, validateAffixes, linesFromCore, itemLines, createDemoAppraisalService as demoSvc, initialAppraisal as init0, withItems as withI, place as placeI, runAppraisal as runA } from "../../src/maps/village/petAppraisal.ts";

test("正式規格：屬性數值清單與企劃確認值完全相同", () => {
  assert.deepEqual(OFFICIAL_AFFIX_VALUES.attack, [-10, -5, 10, 15, 20, 25]);
  assert.deepEqual(OFFICIAL_AFFIX_VALUES.attackSpeed, [-4, -2, 2, 4, 6, 8, 10]);
  assert.deepEqual(OFFICIAL_AFFIX_VALUES.defense, [-10, -5, 10, 15, 20, 25]);
  assert.deepEqual(OFFICIAL_AFFIX_VALUES.maxHp, [-10, -5, 10, 15, 20]);
});

test("正式規格：0～4 條、同種類最多 1 條、數值必須在清單內；可全無／全正／全負／混合", () => {
  assert.equal(validateAffixes([]).ok, true);
  assert.equal(validateAffixes([{ stat: "attack", value: 25 }, { stat: "attackSpeed", value: 10 }, { stat: "defense", value: 25 }, { stat: "maxHp", value: 20 }]).ok, true);
  assert.equal(validateAffixes([{ stat: "attack", value: -10 }, { stat: "maxHp", value: -5 }]).ok, true);
  assert.equal(validateAffixes([{ stat: "attack", value: 10 }, { stat: "attack", value: 15 }]).ok, false, "重複");
  assert.equal(validateAffixes([{ stat: "attack", value: 12 }]).ok, false, "不在清單");
  assert.equal(validateAffixes([{ stat: "maxHp", value: 25 }]).ok, false, "生命值沒有 +25");
  assert.equal(validateAffixes([{ stat: "crit", value: 5 }]).ok, false, "未知屬性");
  assert.equal(validateAffixes([{ stat: "attack", value: 10 }, { stat: "attackSpeed", value: 2 }, { stat: "defense", value: 10 }, { stat: "maxHp", value: 10 }, { stat: "attack", value: 10 }]).ok, false, "超過 4 條");
});

test("顯示：無屬性→「無附加屬性」灰色；攻擊速度為固定值、其他為百分比；依固定順序", () => {
  assert.deepEqual(linesFromCore([]), [{ label: "無附加屬性", text: "—", polarity: "none" }]);
  const l = linesFromCore([{ stat: "maxHp", value: -5 }, { stat: "attackSpeed", value: 6 }]);
  assert.deepEqual(l.map((x) => [x.label, x.text, x.polarity]), [["生命值", "-5%", "negative"], ["攻擊速度", "+6", "positive"]]);
  const v = validateAffixes([{ stat: "maxHp", value: -5 }, { stat: "attack", value: 15 }]);
  assert.ok(v.ok && v.affixes[0]!.stat === "attack");
  assert.equal(itemLines({ id: "x", kind: "seed", name: "x", appraised: true, affixes: [{ stat: "attack", value: 99 } as never] }).ok, false);
});

test("每顆物品獨立識別：同名的兩顆種子各自鑑定、結果不共用；鑑定後物品數不變", async () => {
  const svc = demoSvc({ delayMs: 0 });
  const inv = await svc.inventory();
  assert.ok(inv.ok);
  const ids = inv.data.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, "每個物品 id 唯一");
  let s = withI(init0(), inv.data, true);
  s = placeI(s, "s1");
  s = await runA(s, svc, () => {}, "r-s1");
  s = placeI(s, "s2");
  s = await runA(s, svc, () => {}, "r-s2");
  const s1 = s.items.find((i) => i.id === "s1")!;
  const s2 = s.items.find((i) => i.id === "s2")!;
  assert.ok(s1.appraised && s2.appraised);
  assert.notDeepEqual(s1.affixes, s2.affixes);
  assert.equal(s.items.length, inv.data.length);
  assert.equal(s.lines[0]!.label, "無附加屬性");
  assert.equal(svc.charges(), 2);
});
