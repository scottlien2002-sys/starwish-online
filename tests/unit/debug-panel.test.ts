import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameProfiler, resolutionInfo } from "../../src/render/frameProfiler.ts";
import { debugEnabledFromSearch, formatDebugLines, formatMonsterLine, placeDebugPanel, type DebugInfo } from "../../src/game/debugPanel.ts";
import { benchKey, benchOptionsFromSearch } from "../../src/game/benchMode.ts";
import { PreviewCombat, PREVIEW_COMBAT } from "../../src/game/previewCombat.ts";
import { createMonsterRegistry, MonsterFactory, ProceduralVisual } from "../../src/monsters/framework/index.ts";
import type { MonsterView } from "../../src/monsters/anim/types.ts";

/** Stage 5.3-2：除錯面板（?debug=1）、每幀 CPU 計時、重設測試 */

test("只有 ?debug=1 才啟用面板", () => {
  assert.equal(debugEnabledFromSearch(""), false);
  assert.equal(debugEnabledFromSearch("?bobo=v38r"), false);
  assert.equal(debugEnabledFromSearch("?debug=0"), false);
  assert.equal(debugEnabledFromSearch("?debug=1"), true);
  assert.equal(debugEnabledFromSearch("?bobo=v38r&debug=1&quality=high"), true);
});

test("CPU 分段計時：段落時間＝相鄰標記的差；GPU／等待＝影格時間 − CPU 總和；取出後歸零", () => {
  let t = 0;
  const p = new FrameProfiler(() => t);
  for (let f = 0; f < 4; f++) {
    p.beginFrame();
    t += 1; // 玩家
    p.mark("player");
    t += 0.5;
    p.mark("input");
    t += 2; // 怪物
    p.mark("monsters");
    t += 0.25;
    p.mark("world");
    t += 4; // 繪製提交
    p.mark("render");
    t += 0.25;
    p.mark("hud");
    p.endFrame(f === 3 ? 30 : 20);
  }
  const w = p.takeWindow();
  assert.equal(w.frames, 4);
  assert.equal(w.sections.player, 1);
  assert.equal(w.sections.monsters, 2);
  assert.equal(w.sections.render, 4);
  assert.equal(w.cpuMs, 8);
  assert.equal(w.avgFrameMs, 22.5);
  assert.equal(w.maxFrameMs, 30);
  assert.equal(w.waitMs, 14.5);
  const e = p.takeWindow();
  assert.equal(e.frames, 0);
  assert.equal(e.cpuMs, 0);
});

test("解析度資訊：百萬像素與相對畫面的倍率", () => {
  const r = resolutionInfo(852, 393, 1704, 786);
  assert.equal(r.megapixels, 1.34);
  assert.equal(r.scale, 2);
});

const info = (): DebugInfo => ({
  variant: "v38r",
  quality: "high",
  fps: 34.7,
  drawCalls: 58,
  activeMeshes: 41,
  meshes: 51,
  materials: 24,
  textures: 11,
  render: { width: 1704, height: 786, cssWidth: 852, cssHeight: 393, pixelRatio: 2, devicePixelRatio: 3, megapixels: 1.34 },
  profile: { frames: 15, avgFrameMs: 28.8, maxFrameMs: 46, sections: { input: 0.2, player: 0.1, monsters: 0.9, world: 0.3, render: 4.4, hud: 0.2 }, cpuMs: 6.1, waitMs: 22.7 },
  sceneTimes: { activeMeshes: 0.8, renderTargets: 1.2, sprites: 0.1, particles: 0 },
  gpuMs: null,
  gpuSupported: false,
  player: { hp: 92, maxHp: 100, down: false, attackPhase: "idle", hits: 3 },
  monsters: [
    { id: "a", hp: 40, maxHp: 60, state: "attack", anim: "attack", attackId: 3, resolved: 2, cancelled: 1, duplicatesBlocked: 0, cooldown: 1.5, respawnIn: null },
    { id: "b", hp: 0, maxHp: 60, state: "dead", anim: "dead", attackId: 1, resolved: 1, cancelled: 0, duplicatesBlocked: 0, cooldown: 0, respawnIn: 7.25 },
  ],
});

test("面板文字：FPS、Draw Calls、解析度、CPU／GPU 推估、玩家、每隻怪物的 HP／狀態／動畫／attackId／重生倒數", () => {
  const lines = formatDebugLines(info());
  const all = lines.join("\n");
  assert.match(all, /V3\.8R・畫質 high・FPS 34\.7/);
  assert.match(all, /Draw Calls 58・Active Mesh 41・Mesh 51/);
  assert.match(all, /1704×786（2\.00x，1\.34 MP/);
  assert.match(all, /CPU 6\.1 ms ＋ GPU／等待 22\.7 ms/);
  assert.match(all, /此裝置不支援計時/);
  assert.match(all, /玩家 HP 92\/100/);
  assert.equal(formatMonsterLine(info().monsters[0]!, 0), "#1 HP 40/60・攻擊・動畫 attack・attackId 3（命中 2／取消 1）・冷卻 1.5s");
  assert.equal(formatMonsterLine(info().monsters[1]!, 1), "#2 HP 0/60・已移除・動畫 dead・attackId 1（命中 1／取消 0）・重生倒數 7.3s");
  // 不支援計時以外的情況
  const g = { ...info(), gpuSupported: true, gpuMs: 12.34, profile: null, sceneTimes: null };
  assert.match(formatDebugLines(g).join("\n"), /GPU 影格時間 12\.3 ms/);
});

test("效能測試的調查參數：benchres 只接受 1／1.25／1.5／2；結果另存不覆蓋一般測試", () => {
  assert.deepEqual(benchOptionsFromSearch("?bench=1&benchres=1&benchprof=1"), { seconds: 10, warmup: 3, profile: true, res: 1 });
  assert.equal(benchOptionsFromSearch("?bench=1&benchres=3")!.res, null);
  assert.equal(benchOptionsFromSearch("?bench=1&benchres=1.5")!.res, 1.5);
  assert.equal(benchKey({ variant: "v38r", quality: "high" }), "v38r_high");
  assert.equal(benchKey({ variant: "v38r", quality: "high", resOverride: 1 }), "v38r_high_r1");
});

const nullView = (): MonsterView => ({ applyPose() {}, playEffect() {}, update() {}, dispose() {} });

test("重生倒數（只讀）：死亡中＝剩餘死亡時間＋10 秒；移除後從 10 秒倒數；不改變重生時間", () => {
  const registry = createMonsterRegistry().addVisual("star_dew_bobo_v38r", () => new ProceduralVisual(nullView(), () => {}));
  const c = new MonsterFactory(registry).create("star_dew_bobo", { x: 0, y: 0, z: 0 }, { modelId: "star_dew_bobo_v38r", animationProfileId: "star_dew_bobo_v38r" });
  let now = 0;
  const step = (s: number) => {
    for (let i = 0; i < Math.round(s / 0.05); i++) {
      now += 0.05;
      c.update(0.05, now, null);
    }
  };
  assert.equal(c.brain!.respawnRemaining(now), null);
  c.instance.receiveDamage(999);
  step(0.5);
  assert.ok(Math.abs(c.brain!.respawnRemaining(now)! - (1.8 - 0.5 + 10)) < 0.06);
  step(1.4);
  assert.equal(c.instance.sm.state, "dead");
  step(4);
  const r = c.brain!.respawnRemaining(now)!;
  assert.ok(r > 5.8 && r < 6.1, `剩 ${r}`);
  step(6.2);
  assert.equal(c.instance.sm.state === "respawn" || c.instance.sm.state === "idle", true, "照原本的 10 秒重生");
});

test("重設測試：怪物回出生點、HP 全滿、待機、攻擊紀錄歸零；玩家 HP 全滿、解除倒地；數值不變", () => {
  const registry = createMonsterRegistry().addVisual("star_dew_bobo_v38r", () => new ProceduralVisual(nullView(), () => {}));
  const c = new MonsterFactory(registry).create("star_dew_bobo", { x: 2, y: 0, z: 3 }, { modelId: "star_dew_bobo_v38r", animationProfileId: "star_dew_bobo_v38r" });
  c.instance.tryAttack(0);
  c.instance.currentPosition.x = 9;
  c.instance.receiveDamage(999);
  for (let i = 0; i < 40; i++) c.update(0.05, i * 0.05, null);
  assert.equal(c.instance.sm.state, "dead");
  c.instance.resetForTest();
  c.brain!.resetForTest();
  assert.equal(c.instance.sm.state, "idle");
  assert.equal(c.instance.currentHp, 60);
  assert.equal(c.instance.currentPosition.x, 2);
  assert.equal(c.instance.currentPosition.z, 3);
  assert.equal(c.instance.attackId, 0);
  assert.equal(c.instance.attackLog.cancelled, 0);
  assert.equal(c.instance.cooldownRemaining(0), 0);
  assert.equal(c.brain!.respawnRemaining(0), null);
  // 重設後一切照常：可以攻擊、可以受傷
  c.update(0.05, 2, null);
  assert.equal(c.instance.tryAttack(2).accepted, true);
  assert.equal(c.instance.definition.attackCooldown, 2);

  const combat = new PreviewCombat();
  combat.debugKnockDown(0);
  combat.resetForTest();
  assert.equal(combat.hp, PREVIEW_COMBAT.playerMaxHp);
  assert.equal(combat.isDown, false);
  assert.equal(combat.hitsTaken, 0);
  assert.equal(PREVIEW_COMBAT.playerAttackDamage, 20);
});

test("面板位置：橫向放在上方兩個面板之間、停在按鈕上方；直向放在上方面板下方", () => {
  const b = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
  // iPhone 15 橫向（852×393）：狀態面板 72–308、系統 FPS 744–806、效能面板 685–840；按鈕與搖桿在下方
  const land = placeDebugPanel(852, 393, { status: b(72, 8, 308, 97), system: b(744, 8, 806, 27), perf: b(685, 40, 840, 151) }, [
    b(28, 238, 198, 350), b(700, 240, 750, 290), b(780, 240, 830, 290), b(700, 308, 750, 358), b(766, 285, 840, 360),
  ]);
  assert.equal(land.top, 6);
  assert.equal(land.left, 314);
  assert.equal(land.left + land.width, 679);
  assert.ok(land.top + land.maxHeight <= 393 - 6);
  // 直向（393×852）：中間不夠寬 → 放在上方面板下方
  const port = placeDebugPanel(393, 852, { status: b(8, 8, 250, 100), system: b(300, 8, 385, 27), perf: b(270, 40, 385, 150) }, [b(20, 640, 180, 800), b(250, 650, 380, 800)]);
  assert.equal(port.top, 156);
  assert.equal(port.left, 6);
  assert.equal(port.width, 381);
  assert.equal(port.top + port.maxHeight, 634);
});
