import { test } from "node:test";
import assert from "node:assert/strict";
import { AutoplayStats, autoplayKey, autoplayOptionsFromSearch, extraSpawnPoints, formatAutoplay, movePath, soakSegment, worldToInput } from "../../src/game/autoplay.ts";
import { inputToWorld } from "../../src/actors/movement.ts";
import { previewSpawnPoints, separate } from "../../src/game/previewCombat.ts";

/** Stage 5.3：實際遊玩壓力測試（?autoplay=） */

test("網址參數：只有 autoplay=move／attack／soak 才啟用；怪物數量只接受 3／5／10（預設 3＝正式遊戲）", () => {
  assert.equal(autoplayOptionsFromSearch(""), null);
  assert.equal(autoplayOptionsFromSearch("?autoplay=1"), null);
  assert.equal(autoplayOptionsFromSearch("?count=10"), null, "沒有 autoplay 時 count 無效");
  assert.deepEqual(autoplayOptionsFromSearch("?autoplay=move"), { mode: "move", duration: 60, warmup: 3, count: 3 });
  assert.deepEqual(autoplayOptionsFromSearch("?autoplay=attack&count=10"), { mode: "attack", duration: 60, warmup: 3, count: 10 });
  assert.deepEqual(autoplayOptionsFromSearch("?autoplay=attack&count=7"), { mode: "attack", duration: 60, warmup: 3, count: 3 });
  assert.deepEqual(autoplayOptionsFromSearch("?autoplay=soak"), { mode: "soak", duration: 900, warmup: 3, count: 3 });
  assert.deepEqual(autoplayOptionsFromSearch("?autoplay=move&dur=4&warmup=1"), { mode: "move", duration: 4, warmup: 1, count: 3 });
});

test("世界方向 → 搖桿輸入：與遊戲的 inputToWorld 互為反運算（任何鏡頭方向）", () => {
  for (const yaw of [0, 0.7, -2.1, Math.PI]) {
    for (const [dx, dz] of [[1, 0], [0, 1], [-3, 4], [0.2, -0.9]] as const) {
      const i = worldToInput(dx, dz, yaw);
      assert.ok(Math.abs(Math.hypot(i.x, i.y) - 1) < 1e-9);
      const w = inputToWorld(i.x, i.y, yaw);
      const len = Math.hypot(dx, dz);
      assert.ok(Math.abs(w.x - dx / len) < 1e-9 && Math.abs(w.z - dz / len) < 1e-9);
    }
  }
  assert.deepEqual(worldToInput(0, 0, 1), { x: 0, y: 0 });
});

test("測試場景的額外出生點：與正式 3 個出生點不重疊、在草原範圍內；10 隻分散後間距正常", () => {
  for (const yaw of [0, 1.3]) {
    const base = previewSpawnPoints(0, 0, yaw);
    const extra = extraSpawnPoints(7, yaw);
    assert.equal(extra.length, 7);
    const all = [...base, ...extra];
    for (let i = 0; i < all.length; i++) {
      assert.ok(Math.hypot(all[i]!.x, all[i]!.z) < 14, "在出生點附近");
      for (let j = i + 1; j < all.length; j++) assert.ok(Math.hypot(all[i]!.x - all[j]!.x, all[i]!.z - all[j]!.z) > 1.0, `點 ${i}、${j} 太近`);
    }
    const pts = all.map((p) => ({ ...p }));
    separate(pts, 1.0);
    assert.equal(pts.length, 10);
  }
});

test("移動路徑與 soak 循環", () => {
  const p = movePath(7);
  assert.equal(p.length, 8);
  assert.ok(p.every((q) => Math.abs(Math.hypot(q.x, q.z) - 7) < 1e-9));
  assert.equal(soakSegment(0), "move");
  assert.equal(soakSegment(19.9), "move");
  assert.equal(soakSegment(20), "attack");
  assert.equal(soakSegment(61), "move");
});

const frame = (o: Partial<Parameters<AutoplayStats["frame"]>[0]> = {}) => ({
  rawDt: 1 / 60,
  drawCalls: 58,
  moved: 5 / 60,
  expectedMax: 5 / 60 + 0.02,
  intendMove: true,
  revived: false,
  cameraLag: 0.3,
  valid: true,
  ...o,
});
const res = { meshes: 51, materials: 24, textures: 11 };

test("判定：正常移動通過；瞬移、卡住、鏡頭跟不上會被抓到；復活回出生點不算瞬移", () => {
  const ok = new AutoplayStats(30);
  for (let i = 0; i < 600; i++) ok.frame(frame());
  ok.frame(frame({ moved: 9, revived: true }));
  const c1 = ok.judge({ mode: "move", attackInterval: 1, resStart: res, resEnd: res, duplicatesBlocked: 0 });
  assert.ok(c1.every((c) => c.ok), JSON.stringify(c1.filter((c) => !c.ok)));

  const bad = new AutoplayStats(30);
  for (let i = 0; i < 400; i++) bad.frame(frame({ moved: 0, cameraLag: 2.5 }));
  bad.frame(frame({ moved: 3 }));
  const c2 = bad.judge({ mode: "move", attackInterval: 1, resStart: res, resEnd: { ...res, materials: 26 }, duplicatesBlocked: 0 });
  const failed = c2.filter((c) => !c.ok).map((c) => c.name);
  assert.ok(failed.some((n) => n.includes("瞬間位移")));
  assert.ok(failed.some((n) => n.includes("卡住")));
  assert.ok(failed.some((n) => n.includes("鏡頭")));
  assert.ok(failed.some((n) => n.includes("資源")));
});

test("判定：攻擊間隔、每次扣 20（剩餘 HP 不足時扣剩餘）、凍結與 Context Lost", () => {
  const s = new AutoplayStats(30);
  for (let i = 0; i < 120; i++) s.frame(frame({ intendMove: false, moved: 0 }));
  s.attackStarted(1);
  s.attackStarted(2);
  s.attackStarted(3.0000001);
  s.hit(true, 20, 60, 20);
  s.hit(true, 10, 10, 20);
  s.hit(false, 0, 40, 20);
  let c = s.judge({ mode: "attack", attackInterval: 1, resStart: res, resEnd: res, duplicatesBlocked: 0 });
  assert.ok(c.every((x) => x.ok), JSON.stringify(c.filter((x) => !x.ok)));
  s.attackStarted(3.5);
  s.hit(true, 40, 60, 20);
  s.contextLost = 1;
  s.frame(frame({ rawDt: 1.5 }));
  c = s.judge({ mode: "attack", attackInterval: 1, resStart: res, resEnd: res, duplicatesBlocked: 2 });
  const failed = c.filter((x) => !x.ok).map((x) => x.name);
  assert.ok(failed.some((n) => n.includes("攻擊間隔")));
  assert.ok(failed.some((n) => n.includes("扣 20")));
  assert.ok(failed.some((n) => n.includes("Context")));
  assert.ok(failed.some((n) => n.includes("凍結")));
  assert.ok(failed.some((n) => n.includes("重複結算")));
});

test("時間軸取樣與結果文字", () => {
  const s = new AutoplayStats(30);
  let n = 0;
  for (let i = 0; i < 60 * 65; i++) {
    s.frame(frame());
    if (s.dueSample()) {
      s.sample({ ...res, heapMB: null });
      n++;
    }
  }
  assert.equal(n, 2);
  assert.equal(s.timeline[0]!.t, 30);
  const lines = formatAutoplay({
    mode: "soak", count: 3, variant: "v38r", quality: "high", pixelRatio: 2,
    summary: { seconds: 65, frames: 3900, avgFps: 60, low1Fps: 60, minFps: 60, avgDrawCalls: 58, maxDrawCalls: 58 },
    timeline: s.timeline, checks: [{ name: "x", ok: true, detail: "y" }], counters: { 出手: 3 }, at: "", userAgent: "",
  });
  assert.match(lines.join("\n"), /測試 E：長時間穩定性/);
  assert.match(lines.join("\n"), /Safari 不提供/);
  assert.equal(autoplayKey({ mode: "attack", count: 10, variant: "v38r", quality: "high" }), "attack_10_v38r_high");
});

test("soak 太短（只有移動段）時不檢查攻擊；有戰鬥段時才檢查", () => {
  const s = new AutoplayStats(60);
  for (let i = 0; i < 300; i++) s.frame(frame());
  const short = s.judge({ mode: "soak", attackInterval: 1, resStart: res, resEnd: res, duplicatesBlocked: 0, attackExpected: false });
  assert.ok(short.every((c) => c.ok), JSON.stringify(short.filter((c) => !c.ok)));
  assert.ok(!short.some((c) => c.name.includes("出手")));
  const long = s.judge({ mode: "soak", attackInterval: 1, resStart: res, resEnd: res, duplicatesBlocked: 0, attackExpected: true });
  assert.ok(long.some((c) => c.name.includes("出手") && !c.ok));
});

test("鏡頭：復活傳送後的平滑追趕另外計算，不算一般跟隨偏離；超過 1 秒沒追上仍會被抓到", () => {
  // 模擬實際鏡頭：damp(10) 每幀追 1 - e^(-10/60)
  const k = 1 - Math.exp(-10 / 60);
  const run = (sharp: number) => {
    const s = new AutoplayStats(30);
    for (let i = 0; i < 300; i++) s.frame(frame());
    let lag = 6.65;
    s.frame(frame({ revived: true, cameraLag: lag, moved: 6.65 }));
    for (let i = 0; i < 120; i++) {
      lag *= 1 - sharp;
      s.frame(frame({ cameraLag: lag, moved: 0, intendMove: false }));
    }
    for (let i = 0; i < 300; i++) s.frame(frame());
    return s;
  };
  const ok = run(k);
  assert.ok(ok.maxCameraLag < 0.5, String(ok.maxCameraLag));
  assert.equal(ok.revives, 1);
  assert.ok(Math.abs(ok.revivePeakLag - 6.65) < 1e-9);
  assert.ok(ok.reviveMaxSettle > 0.2 && ok.reviveMaxSettle < 0.35, String(ok.reviveMaxSettle));
  const c1 = ok.judge({ mode: "soak", attackInterval: 1, resStart: res, resEnd: res, duplicatesBlocked: 0, attackExpected: false });
  assert.ok(c1.find((c) => c.name.includes("一般移動時"))!.ok);
  assert.ok(c1.find((c) => c.name.includes("復活傳送"))!.ok);

  // 鏡頭壞掉（幾乎不追）：復活檢查失敗，而且 1 秒後的偏離算回一般跟隨
  const bad = run(0.001);
  const c2 = bad.judge({ mode: "soak", attackInterval: 1, resStart: res, resEnd: res, duplicatesBlocked: 0, attackExpected: false });
  assert.equal(c2.find((c) => c.name.includes("復活傳送"))!.ok, false);
  assert.equal(c2.find((c) => c.name.includes("一般移動時"))!.ok, false);

  // 沒有復活時不顯示復活檢查
  const none = new AutoplayStats(30);
  for (let i = 0; i < 300; i++) none.frame(frame());
  const c3 = none.judge({ mode: "move", attackInterval: 1, resStart: res, resEnd: res, duplicatesBlocked: 0 });
  assert.ok(!c3.some((c) => c.name.includes("復活傳送")));
});
