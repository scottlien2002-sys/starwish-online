import { clipTimings, genericClipAnim } from "../framework/profiles.ts";
import type { ClipMap, MonsterAnimationProfile } from "../framework/types.ts";

/**
 * 測試方塊（僅供程式測試，非正式怪物）的動畫設定。
 * 刻意與星露啵啵不同：使用 GLB 節點動畫片段、不同時長、不同特效時間點、受傷 1.5 倍速播放。
 * 片段長度需與 tools/make-test-dummy-glb.mjs 產生的 GLB 一致。
 */
export const TEST_DUMMY_CLIP_LENGTHS = Object.freeze({
  idle: 1.6,
  move: 0.5,
  attack: 0.7,
  hit: 0.3,
  death: 1.0,
  respawn: 1.0,
});

export const TEST_DUMMY_CLIPS: ClipMap = Object.freeze({
  idle: { name: "Idle", loop: true, speed: 1 },
  move: { name: "Move", loop: true, speed: 1 },
  attack: { name: "Attack", loop: false, speed: 1 },
  hit: { name: "Hit", loop: false, speed: 1.5 },
  death: { name: "Death", loop: false, speed: 1 },
  respawn: { name: "Respawn", loop: false, speed: 1 },
});

const timings = clipTimings(TEST_DUMMY_CLIP_LENGTHS, TEST_DUMMY_CLIPS);

export const TEST_DUMMY_PROFILE: MonsterAnimationProfile = {
  id: "test_dummy_clips",
  kind: "clips",
  clips: TEST_DUMMY_CLIPS,
  anim: genericClipAnim(timings, [
    { state: "attack", at: 0.35, effect: "attackImpact" },
    { state: "death", at: 0.1, effect: "deathBurst" },
    { state: "respawn", at: 0, effect: "respawnStart" },
    { state: "respawn", at: 0.6, effect: "respawnPop" },
  ]),
};
