/**
 * 骨骼動畫怪物的動畫設定（狀態機時長＋命中時間＋通用效果）— 不依賴 Babylon。
 * - Attack 命中：攻擊狀態第 hitTime 秒觸發 attackImpact（播放倍率改變時一起換算）
 * - 受擊：普通攻擊只疊加閃白（已定案規則：不硬直、不打斷）；特殊技能硬直時才進入受擊狀態
 * - 死亡：死亡動畫播完停在倒地姿勢 deathHold 秒，再淡出 deathFade 秒；之後才開始重生計時
 * - 重生：淡入，重生動畫播完回 Idle
 */
import { BASE_POSE, type MonsterPose } from "../anim/types.ts";
import type { AnimProfile } from "../anim/MonsterAnimator.ts";
import type { ClipMap, MonsterAnimationProfile } from "../framework/types.ts";
import { riggedTimings, type RigClipKey, type RiggedMonsterSpec } from "./riggedSpec.ts";

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const pose = (p: Partial<MonsterPose>): MonsterPose => ({ ...BASE_POSE, ...p });

export function riggedAnim(spec: RiggedMonsterSpec, durations: Record<RigClipKey, number> = spec.expect.durations, attackRatio = 1): AnimProfile {
  const t = riggedTimings(spec, durations);
  const timings = { ...t, attack: t.attack / attackRatio };
  const dDeath = durations.death;
  return {
    timings,
    cues: [{ state: "attack", at: spec.attackHitTime / attackRatio, effect: "attackImpact" }],
    idle: () => pose({}),
    move: () => pose({}),
    attack: () => pose({ face: "angry" }),
    hit: (x) => pose({ hitFlash: 1 - clamp01(x / timings.hit), face: "hurt" }),
    death: (x) => {
      const fade = clamp01((x - dDeath - spec.deathHold) / spec.deathFade);
      return pose({ opacity: 1 - fade, face: "hurt", bodyVisible: fade < 1 });
    },
    dead: () => pose({ opacity: 0, bodyVisible: false }),
    respawn: (x) => pose({ opacity: clamp01(x / Math.max(0.05, timings.respawn * 0.4)) }),
    hitOverlay: (p, r) => (r > 0 ? { ...p, hitFlash: Math.max(p.hitFlash, clamp01(r / timings.hit)) } : p),
  };
}

export function riggedClipMap(spec: RiggedMonsterSpec): ClipMap {
  const c = spec.clips;
  return {
    idle: { name: c.idle, loop: true, speed: 1 },
    move: { name: c.move, loop: true, speed: 1 },
    attack: { name: c.attack, loop: false, speed: 1 },
    hit: { name: c.hurt, loop: false, speed: 1 },
    death: { name: c.death, loop: false, speed: 1 },
    respawn: { name: c.respawn, loop: false, speed: 1 },
  };
}

/** 動畫設定 id = spec.modelId */
export function riggedProfile(spec: RiggedMonsterSpec): MonsterAnimationProfile {
  return { id: spec.modelId, kind: "clips", anim: riggedAnim(spec), clips: riggedClipMap(spec) };
}
