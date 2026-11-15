import { BASE_POSE, type EffectCue, type MonsterAnimTimings, type MonsterPose } from "./types.ts";

/**
 * 星露啵啵的六種動作曲線（純函式）。
 * 依設定圖「動作/戰鬥動畫參考」：待機（呼吸）、移動（彈跳）、攻擊（撞擊）、受傷、死亡（消散）、重生（凝聚）。
 */
export const BOBO_TIMINGS: MonsterAnimTimings = Object.freeze({
  attack: 0.9,
  hit: 0.4,
  death: 1.5,
  respawn: 1.6,
  idlePeriod: 2.4,
  hopPeriod: 0.62,
});

export const BOBO_EFFECT_CUES: readonly EffectCue[] = Object.freeze([
  { state: "attack", at: 0.42, effect: "attackImpact" },
  { state: "death", at: 0.22, effect: "deathBurst" },
  { state: "respawn", at: 0, effect: "respawnStart" },
  { state: "respawn", at: 1.05, effect: "respawnPop" },
] as const);

const TAU = Math.PI * 2;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
/** 保持體積：高度變化時寬度反向補償 */
const volumeXZ = (scaleY: number): number => 1 / Math.sqrt(Math.max(0.05, scaleY));

const pose = (p: Partial<MonsterPose>): MonsterPose => ({ ...BASE_POSE, ...p });

export function idlePose(t: number, T = BOBO_TIMINGS): MonsterPose {
  const b = Math.sin((TAU * t) / T.idlePeriod);
  const scaleY = 1 + 0.045 * b;
  return pose({
    scaleY,
    scaleXZ: volumeXZ(scaleY),
    antennaSway: 0.12 * Math.sin((TAU * t) / T.idlePeriod + 0.7),
    wingFlap: 0.18 * Math.sin((TAU * t * 2) / T.idlePeriod),
    starGlow: 0.85 + 0.15 * Math.sin((TAU * t) / T.idlePeriod),
  });
}

/** V1.1：降低移動變形（原本跳 0.42、拉長 14%、壓扁 30%，五官會被壓扁） */
export const MOVE_HOP_HEIGHT = 0.3;
export const MOVE_STRETCH = 0.06;
export const MOVE_SQUASH = 0.1;

export function movePose(t: number, T = BOBO_TIMINGS): MonsterPose {
  const P = T.hopPeriod;
  const u = (((t % P) + P) % P) / P; // 0~1
  // u ∈ [0.15, 0.85] 在空中；其餘為著地擠壓（跨越 0）
  const AIR0 = 0.15;
  const AIR1 = 0.85;
  let offsetY = 0;
  let scaleY = 1;
  if (u >= AIR0 && u <= AIR1) {
    const a = (u - AIR0) / (AIR1 - AIR0);
    offsetY = MOVE_HOP_HEIGHT * Math.sin(Math.PI * a);
    scaleY = 1 + MOVE_STRETCH * Math.sin(Math.PI * a); // 空中輕微拉長
  } else {
    const c = u > AIR1 ? (u - AIR1) / 0.3 : (u + 0.15) / 0.3; // 0~1 著地週期
    scaleY = 1 - MOVE_SQUASH * Math.sin(Math.PI * c); // 落地輕微擠壓，保留圓潤外型
  }
  return pose({
    offsetY,
    scaleY,
    scaleXZ: volumeXZ(scaleY),
    lean: 0.05,
    antennaSway: -0.2 * Math.sin(TAU * u),
    wingFlap: 0.45 * Math.sin(TAU * u * 2),
  });
}

/** V1.2 攻擊三階段時間點（秒） */
export const ATTACK_PHASES = Object.freeze({ chargeEnd: 0.32, dashEnd: 0.42, impactEnd: 0.5 });

/**
 * V1.2 攻擊：蓄力 → 衝撞 → 回彈，三段清楚分開。
 * 蓄力：後退、壓低、身體發抖；衝撞：向前拉長衝出；撞擊：前方壓扁；回彈：往後小跳回原位、落地輕壓。
 */
export function attackPose(t: number, T = BOBO_TIMINGS): MonsterPose {
  const D = T.attack;
  const P = ATTACK_PHASES;
  const tt = Math.max(0, Math.min(D, t));
  let offsetZ = 0;
  let offsetY = 0;
  let scaleY = 1;
  let stretchZ = 1;
  let lean = 0;
  let shakeX = 0;
  let wingFlap = 0;
  if (tt < P.chargeEnd) {
    // ① 蓄力
    const a = easeOut(tt / P.chargeEnd);
    offsetZ = -0.22 * a;
    scaleY = 1 - 0.16 * a;
    lean = -0.2 * a;
    shakeX = 0.012 * Math.sin(tt * 70) * a;
    wingFlap = 0.25 * Math.sin(tt * 50) * a;
  } else if (tt < P.dashEnd) {
    // ② 衝撞：快速前衝並向前拉長
    const a = easeOut((tt - P.chargeEnd) / (P.dashEnd - P.chargeEnd));
    offsetZ = lerp(-0.22, 1.0, a);
    scaleY = lerp(0.84, 0.92, a);
    stretchZ = lerp(1, 1.18, a);
    lean = lerp(-0.2, 0.3, a);
    offsetY = 0.06 * Math.sin(Math.PI * a);
    wingFlap = -0.4 * a;
  } else if (tt < P.impactEnd) {
    // 撞擊瞬間：前方壓扁
    const a = (tt - P.dashEnd) / (P.impactEnd - P.dashEnd);
    offsetZ = 1.0;
    stretchZ = lerp(0.8, 0.92, a);
    scaleY = lerp(1.06, 1.0, a);
    lean = lerp(0.3, 0.2, a);
    wingFlap = lerp(-0.4, 0, a);
  } else {
    // ③ 回彈：往後小跳回原位，落地輕壓後恢復
    const a = clamp01((tt - P.impactEnd) / (D - P.impactEnd));
    const e = easeInOut(a);
    offsetZ = lerp(1.0, 0, e);
    offsetY = a < 0.8 ? 0.22 * Math.sin((Math.PI * a) / 0.8) : 0;
    scaleY = a < 0.8 ? 1 + 0.05 * Math.sin((Math.PI * a) / 0.8) : 1 - 0.08 * Math.sin((Math.PI * (a - 0.8)) / 0.2);
    stretchZ = lerp(0.92, 1, clamp01(a / 0.4));
    lean = lerp(0.2, 0, e) - 0.1 * Math.sin(Math.PI * a);
    wingFlap = 0.35 * Math.sin(Math.PI * a);
  }
  const scaleXZ = 1 / Math.sqrt(Math.max(0.05, scaleY * stretchZ));
  return pose({
    offsetY,
    offsetZ,
    scaleY,
    scaleXZ,
    stretchZ,
    lean,
    shakeX,
    face: "angry",
    antennaSway: -lean * 1.0,
    wingFlap,
  });
}

export function hitPose(t: number, T = BOBO_TIMINGS): MonsterPose {
  const r = 1 - clamp01(t / T.hit); // 1 → 0
  const scaleY = 1 - 0.14 * r;
  return pose({
    shakeX: 0.07 * Math.sin(t * 62) * r * r,
    scaleY,
    scaleXZ: volumeXZ(scaleY),
    lean: -0.12 * r,
    hitFlash: r,
    face: r > 0.15 ? "hurt" : "normal",
    antennaSway: 0.4 * Math.sin(t * 30) * r,
  });
}

/** 攻擊中受擊的疊加效果（不改變位移，只閃白與輕震） */
export function applyHitOverlay(p: MonsterPose, overlayRemaining: number, T = BOBO_TIMINGS): MonsterPose {
  if (overlayRemaining <= 0) return p;
  const r = clamp01(overlayRemaining / T.hit);
  return { ...p, hitFlash: Math.max(p.hitFlash, r), shakeX: p.shakeX + 0.03 * Math.sin(overlayRemaining * 62) * r };
}

export function deathPose(t: number, T = BOBO_TIMINGS): MonsterPose {
  const D = T.death;
  if (t < 0.22) {
    const a = t / 0.22;
    const scaleY = 1 - 0.2 * Math.sin(Math.PI * a);
    return pose({ scaleY, scaleXZ: volumeXZ(scaleY), hitFlash: 1 - a, face: "hurt", shakeX: 0.05 * Math.sin(t * 60) * (1 - a) });
  }
  const d = easeInOut(clamp01((t - 0.22) / (D - 0.22)));
  return pose({
    scaleY: lerp(1, 0.12, d),
    scaleXZ: lerp(1, 1.5, d),
    opacity: 1 - d,
    starGlow: 1 - d,
    antennaSway: 0.9 * d,
    face: "hurt",
    bodyVisible: d < 0.999,
  });
}

export function deadPose(): MonsterPose {
  return pose({ opacity: 0, starGlow: 0, scaleY: 0.12, scaleXZ: 1.5, bodyVisible: false });
}

export function respawnPose(t: number, T = BOBO_TIMINGS): MonsterPose {
  const D = T.respawn;
  const k = clamp01(t / D);
  // 光環：前段展開、後段淡出
  const ringScale = lerp(0.4, 1.4, easeOut(clamp01(k / 0.8)));
  const ringOpacity = k < 0.15 ? k / 0.15 : k > 0.75 ? clamp01((1 - k) / 0.25) : 1;
  // 星星先出現，身體隨後凝聚
  const starGlow = clamp01((t - 0.25) / 0.35);
  const form = clamp01((t - 0.45) / 0.8);
  const s = form <= 0 ? 0.05 : Math.max(0.05, easeOutBack(form));
  const wobble = t > 1.25 ? 0.05 * Math.sin((t - 1.25) * 30) * clamp01((D - t) / 0.35) : 0;
  return pose({
    scaleY: s + wobble,
    scaleXZ: s - wobble * 0.5,
    opacity: clamp01((t - 0.45) / 0.5),
    starGlow,
    ringScale,
    ringOpacity,
    bodyVisible: t >= 0.25,
    offsetY: 0.25 * (1 - clamp01((t - 0.25) / 0.6)),
  });
}
