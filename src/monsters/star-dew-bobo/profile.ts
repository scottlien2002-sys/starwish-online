import type { AnimProfile } from "../anim/MonsterAnimator.ts";
import {
  BOBO_EFFECT_CUES,
  BOBO_TIMINGS,
  applyHitOverlay,
  attackPose,
  deadPose,
  deathPose,
  hitPose,
  idlePose,
  movePose,
  respawnPose,
} from "../anim/bobo-poses.ts";

/** 星露啵啵的動畫設定（與模型無關） */
export const STAR_DEW_BOBO_PROFILE: AnimProfile = {
  timings: BOBO_TIMINGS,
  cues: BOBO_EFFECT_CUES,
  idle: (t) => idlePose(t),
  move: (t) => movePose(t),
  attack: (t) => attackPose(t),
  hit: (t) => hitPose(t),
  death: (t) => deathPose(t),
  dead: () => deadPose(),
  respawn: (t) => respawnPose(t),
  hitOverlay: (p, r) => applyHitOverlay(p, r),
};
