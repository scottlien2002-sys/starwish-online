import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DETAIL_DIST, detailFor, pickTier, sphereInFrustum, type DetailTier } from "../../src/game/monsterDetail.ts";
import { FieldKnockback, KNOCKBACK_BASE } from "../../src/game/fieldKnockback.ts";
import { createMonsterRegistry, MonsterFactory, type IMonsterVisual } from "../../src/monsters/framework/index.ts";
import { CrossFader } from "../../src/monsters/rigged/riggedSpec.ts";
import type { MonsterState } from "../../src/monsters/anim/types.ts";

// ---------------- 距離分級 ----------------

test("7.4 分級：畫面內依距離 near／mid／far／hidden，畫面外 offscreen", () => {
  assert.equal(pickTier(5, true, null), "near");
  assert.equal(pickTier(20, true, null), "mid");
  assert.equal(pickTier(40, true, null), "far");
  assert.equal(pickTier(80, true, null), "hidden");
  assert.equal(pickTier(3, false, null), "offscreen");
  assert.equal(pickTier(50, false, "near"), "offscreen");
});

test("7.4 分級：邊界有遲滯，站在邊界上不會每幀來回切換", () => {
  let t: DetailTier = pickTier(DETAIL_DIST.near - 0.5, true, null);
  assert.equal(t, "near");
  // 走到邊界外一點點（遲滯範圍內）：維持 near
  t = pickTier(DETAIL_DIST.near + 1, true, t);
  assert.equal(t, "near");
  // 超過遲滯：變 mid
  t = pickTier(DETAIL_DIST.near + DETAIL_DIST.hysteresis + 0.1, true, t);
  assert.equal(t, "mid");
  // 回到邊界內一點點：維持 mid（mid 往 near 不加遲滯，邊界就是 16 m）
  t = pickTier(DETAIL_DIST.near - 0.1, true, t);
  assert.equal(t, "near");
  // 來回在 16～18 m 抖動 100 次：只會在第一次超過 18 m 時切換一次
  let switches = 0;
  let prev: DetailTier = "near";
  for (let k = 0; k < 100; k++) {
    const d = 16.2 + (k % 2) * 1.5;
    const n = pickTier(d, true, prev);
    if (n !== prev) switches++;
    prev = n;
  }
  assert.equal(switches, 0);
});

test("7.4 分級設定：近距完整品質；越遠越省；畫面外近距仍投射陰影", () => {
  const near = detailFor("near", 5);
  assert.deepEqual([near.stride, near.anim, near.shadow, near.render], [1, "auto", true, true]);
  const mid = detailFor("mid", 20);
  assert.equal(mid.stride, 2);
  assert.equal(mid.shadow, true);
  assert.equal(detailFor("mid", 30).shadow, false);
  const far = detailFor("far", 40);
  assert.deepEqual([far.stride, far.shadow, far.render], [4, false, true]);
  const hid = detailFor("hidden", 80);
  assert.deepEqual([hid.stride, hid.render], [8, false]);
  assert.equal(detailFor("offscreen", 5).shadow, true, "身後 10 m 內的怪物影子可能落在畫面內");
  assert.equal(detailFor("offscreen", 5).stride, 2);
  assert.equal(detailFor("offscreen", 30).stride, 0, "畫面外遠處：完全不更新動畫");
  assert.equal(detailFor("offscreen", 30).shadow, false);
});

test("7.4 視錐：球在六個平面內才算看得到；半徑跨平面也算", () => {
  // 單純的立方視錐：-10 ≤ x,y,z ≤ 10（平面法向量朝內，n·p + d ≥ 0 為內側）
  const planes = [
    { normal: { x: 1, y: 0, z: 0 }, d: 10 },
    { normal: { x: -1, y: 0, z: 0 }, d: 10 },
    { normal: { x: 0, y: 1, z: 0 }, d: 10 },
    { normal: { x: 0, y: -1, z: 0 }, d: 10 },
    { normal: { x: 0, y: 0, z: 1 }, d: 10 },
    { normal: { x: 0, y: 0, z: -1 }, d: 10 },
  ];
  assert.equal(sphereInFrustum(planes, 0, 0, 0, 1), true);
  assert.equal(sphereInFrustum(planes, 12, 0, 0, 1), false);
  assert.equal(sphereInFrustum(planes, 10.5, 0, 0, 1), true);
});

// ---------------- 視覺更新間隔：AI 與事件不受影響 ----------------

class CountingVisual implements IMonsterVisual {
  readonly kind = "gltf" as const;
  updates = 0;
  poses = 0;
  transforms = 0;
  entered: MonsterState[] = [];
  effects = 0;
  dtSum = 0;
  load(): Promise<void> {
    return Promise.resolve();
  }
  setTransform(): void {
    this.transforms++;
  }
  onStateEnter(s: MonsterState): void {
    this.entered.push(s);
  }
  applyPose(): void {
    this.poses++;
  }
  setFace(): void {}
  playEffect(): void {
    this.effects++;
  }
  update(dt: number): void {
    this.updates++;
    this.dtSum += dt;
  }
  dispose(): void {}
}

function makeOne() {
  let v!: CountingVisual;
  const reg = createMonsterRegistry().addVisual("star_dew_bobo_procedural", () => (v = new CountingVisual()));
  const c = new MonsterFactory(reg).create("star_dew_bobo", { x: 0, y: 0, z: 0 });
  return { c, v };
}

/** 固定亂數（兩次跑同一串亂數，才能比較「只有間隔不同」） */
function withSeed<T>(seed: number, fn: () => T): T {
  const orig = Math.random;
  let s = seed >>> 0;
  Math.random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

function runScenario(stride: number) {
  return withSeed(7, () => {
    const { c, v } = makeOne();
    c.visualStride = stride;
    const states: string[] = [];
    let now = 0;
    const dt = 1 / 60;
    for (let k = 0; k < 60 * 20; k++) {
      now += dt;
      if (k === 300 || k === 330 || k === 360) c.instance.receiveDamage(5, now);
      c.update(dt, now);
      states.push(c.instance.currentState);
    }
    return { c, v, states };
  });
}

test("7.4 間隔：降低視覺更新頻率時，AI、位置、狀態事件與時間總量和每幀更新完全一致", () => {
  const A = runScenario(1);
  const B = runScenario(4);
  assert.deepEqual(B.states, A.states, "每一幀的 AI 狀態相同");
  assert.equal(B.c.instance.currentPosition.x, A.c.instance.currentPosition.x, "AI／移動不受影響");
  assert.equal(B.c.instance.currentPosition.z, A.c.instance.currentPosition.z);
  assert.equal(B.c.instance.currentHp, A.c.instance.currentHp);
  assert.deepEqual(B.v.entered, A.v.entered, "狀態切換（受擊等）每一次都有送到視覺");
  assert.equal(B.v.effects, A.v.effects);
  assert.equal(B.v.transforms, A.v.transforms, "位置每幀都更新（不會跳格移動）");
  assert.ok(B.v.updates < A.v.updates * 0.4, `動畫更新次數應明顯減少（${B.v.updates} vs ${A.v.updates}）`);
  assert.ok(Math.abs(B.v.dtSum - A.v.dtSum) <= 4 / 60 + 1e-9, `動畫時間不遺失：${B.v.dtSum} vs ${A.v.dtSum}`);
});

test("7.4 間隔 0（畫面外遠處）：不更新動畫，但狀態切換那一幀仍會更新一次", () => {
  const { c: a, v: va } = makeOne();
  a.visualStride = 0;
  let now = 0;
  for (let k = 0; k < 120; k++) {
    now += 1 / 60;
    a.update(1 / 60, now);
  }
  const before = va.updates;
  assert.equal(before, 0);
  a.instance.receiveDamage(999999, now);
  now += 1 / 60;
  a.update(1 / 60, now);
  assert.ok(va.entered.includes("death"));
  assert.equal(va.updates, before, "間隔 0 時連狀態切換也不畫（畫面外）；回到畫面內才補上");
  a.visualStride = 1;
  now += 1 / 60;
  a.update(1 / 60, now);
  assert.equal(va.updates, 1);
  assert.ok(va.dtSum > 2, "回到畫面內時一次補上累積時間，死亡動畫直接到正確進度");
});

// ---------------- 擊退連擊衰減（避免怪物被普攻永久推出攻擊範圍） ----------------

test("7.4 擊退：連擊第 1 下 100%、第 2 下 50%、第 3 下起 0；2 秒沒受擊重新計算", () => {
  const kb = new FieldKnockback();
  const o = { attacking: false, boss: false };
  assert.equal(kb.distance("m1", 0, o), KNOCKBACK_BASE);
  assert.equal(kb.distance("m1", 0.6, o), KNOCKBACK_BASE * 0.5);
  assert.equal(kb.distance("m1", 1.2, o), 0);
  assert.equal(kb.distance("m1", 1.8, o), 0);
  assert.equal(kb.distance("m2", 1.8, o), KNOCKBACK_BASE, "每隻怪物各自計算");
  assert.equal(kb.distance("m1", 4.0, o), KNOCKBACK_BASE, "2 秒沒受擊 → 重新從第 1 下");
  assert.equal(kb.distance("boss", 10, { attacking: false, boss: true }), KNOCKBACK_BASE * 0.25);
});

test("7.4 擊退：怪物出手中不推；死亡後清除", () => {
  const kb = new FieldKnockback();
  assert.equal(kb.distance("m", 0, { attacking: true, boss: false }), 0);
  kb.distance("m", 0.5, { attacking: false, boss: false });
  kb.reset("m");
  assert.equal(kb.distance("m", 0.7, { attacking: false, boss: false }), KNOCKBACK_BASE);
});

test("7.4 擊退：玩家每 0.6 秒普攻一次、持續 30 秒，總推移有上限（怪物能回到攻擊距離反擊）", () => {
  const kb = new FieldKnockback();
  let total = 0;
  for (let t = 0; t < 30; t += 0.6) total += kb.distance("m", t, { attacking: false, boss: false });
  assert.ok(total <= KNOCKBACK_BASE * 1.5 + 1e-9, `30 秒內總推移 ${total.toFixed(3)} m`);
});

// ---------------- CrossFader（7.4 改成不複製 Map） ----------------

test("7.4 CrossFader：淡入淡出權重總和維持 1，舊片段淡完會移除", () => {
  const cf = new CrossFader();
  cf.play("idle", 0);
  assert.equal(cf.update(1 / 60).get("idle"), 1);
  cf.play("run", 0.2);
  let w = cf.update(0.1);
  const sum = [...w.values()].reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6);
  assert.ok(w.size === 2);
  w = cf.update(0.2);
  assert.equal(w.get("run"), 1);
  assert.equal(w.has("idle"), false);
});

// ---------------- 程式碼層面的保證 ----------------

test("7.4 開關：可用網址參數回到 7.3 的做法做對照", () => {
  const g = readFileSync(new URL("../../src/game/StarsproutGame.ts", import.meta.url), "utf8");
  assert.ok(g.includes('"mlod"'), "&mlod=0 關閉怪物距離分級");
  assert.ok(g.includes("shadowq"), "&shadowq=original 回到原本 PCSS 取樣");
});
