import type { AnimProfile } from "../anim/MonsterAnimator.ts";
import { BASE_POSE, type EffectCue, type MonsterAnimTimings, type MonsterPose } from "../anim/types.ts";
import type { ClipMap, MonsterAnimationProfile } from "./types.ts";

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const pose = (p: Partial<MonsterPose>): MonsterPose => ({ ...BASE_POSE, ...p });

export type SpeedMap = Partial<Record<"idle" | "move" | "attack" | "hit" | "death" | "respawn", number>>;

/**
 * 套用播放速度：speed 2 = 兩倍快（時長減半、特效時間點等比例提前、曲線取樣加速）。
 * 不修改原本的 profile，回傳新的。
 */
export function withPlaybackSpeed(anim: AnimProfile, speeds: SpeedMap): AnimProfile {
  const s = (k: keyof SpeedMap): number => {
    const v = speeds[k] ?? 1;
    if (!(v > 0)) throw new Error(`播放速度必須 > 0：${k}`);
    return v;
  };
  const t = anim.timings;
  const timings: MonsterAnimTimings = {
    ...t,
    ...(t.hitRehitLock !== undefined ? { hitRehitLock: t.hitRehitLock / s("hit") } : {}),
    attack: t.attack / s("attack"),
    hit: t.hit / s("hit"),
    death: t.death / s("death"),
    respawn: t.respawn / s("respawn"),
    idlePeriod: t.idlePeriod / s("idle"),
    hopPeriod: t.hopPeriod / s("move"),
  };
  const stateSpeed = (state: EffectCue["state"]): number =>
    state === "attack" || state === "hit" || state === "death" || state === "respawn" ? s(state) : 1;
  return {
    timings,
    cues: anim.cues.map((c) => ({ ...c, at: c.at / stateSpeed(c.state) })),
    idle: (x) => anim.idle(x * s("idle")),
    move: (x) => anim.move(x * s("move")),
    attack: (x) => anim.attack(x * s("attack")),
    hit: (x) => anim.hit(x * s("hit")),
    death: (x) => anim.death(x * s("death")),
    dead: () => anim.dead(),
    respawn: (x) => anim.respawn(x * s("respawn")),
    hitOverlay: (p, r) => anim.hitOverlay(p, r * s("hit")),
  };
}

/**
 * 骨骼/節點動畫用的通用姿勢：不做身體變形（變形交給 GLB 動畫），
 * 只提供所有怪物共用的效果：受擊閃白、生氣/受傷表情、死亡淡出、重生淡入。
 */
export function genericClipAnim(timings: MonsterAnimTimings, cues: readonly EffectCue[]): AnimProfile {
  return {
    timings,
    cues,
    idle: () => pose({}),
    move: () => pose({}),
    attack: () => pose({ face: "angry" }),
    hit: (t) => {
      const r = 1 - clamp01(t / timings.hit);
      return pose({ hitFlash: r, face: r > 0.15 ? "hurt" : "normal" });
    },
    death: (t) => {
      const fade = clamp01((t - timings.death * 0.6) / (timings.death * 0.4));
      return pose({ opacity: 1 - fade, face: "hurt", bodyVisible: t < timings.death });
    },
    dead: () => pose({ opacity: 0, bodyVisible: false }),
    respawn: (t) => pose({ opacity: clamp01(t / (timings.respawn * 0.3)) }),
    hitOverlay: (p, r) => (r > 0 ? { ...p, hitFlash: Math.max(p.hitFlash, clamp01(r / timings.hit)) } : p),
  };
}

/** 由動畫片段長度與播放速度推算狀態機時長，確保狀態機與 GLB 動畫同步結束 */
export function clipTimings(
  lengths: Record<"idle" | "move" | "attack" | "hit" | "death" | "respawn", number>,
  clips: ClipMap,
): MonsterAnimTimings {
  return {
    attack: lengths.attack / clips.attack.speed,
    hit: lengths.hit / clips.hit.speed,
    death: lengths.death / clips.death.speed,
    respawn: lengths.respawn / clips.respawn.speed,
    idlePeriod: lengths.idle / clips.idle.speed,
    hopPeriod: lengths.move / clips.move.speed,
  };
}

export function proceduralProfile(id: string, anim: AnimProfile): MonsterAnimationProfile {
  return { id, kind: "procedural", anim };
}
