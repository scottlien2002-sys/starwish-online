/**
 * 世界場景共用：距離密度漸變與手機預算（Claude B；純邏輯、不依賴 Babylon，可單元測試）。
 *
 * 做法（星芽原野 perf/field-veglod 同一套原則，之後的新地圖直接沿用）：
 * - 小物件（草叢、小花、地面碎屑）不整格開關，而是依「每個實例到角色的距離」決定保留比例：
 *   full 公尺內 100%，到 end 公尺平滑降到 floor，超過 cut 公尺全部不畫。
 * - 每個實例有固定的亂數鍵（0～1），密度 ρ 時保留鍵 < ρ 的實例 → 走動時只會零星增減，不會整片出現或消失。
 * - 前 fixed 個實例永遠保留（例如垃圾堆本體），只有後面的小碎屑參與漸變 → 不增加 Draw Calls。
 */

export interface FadeRule {
  /** 這個距離內全部保留（公尺） */
  full: number;
  /** 到這個距離降到 floor */
  end: number;
  /** end 之後保留的比例（0～1） */
  floor: number;
  /** 超過這個距離完全不畫（應落在霧裡） */
  cut: number;
}

export function smooth01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** 距離 d 時要保留的比例 */
export function fadeDensity(d: number, r: FadeRule): number {
  if (d >= r.cut) return 0;
  if (d <= r.full) return 1;
  const t = smooth01((d - r.full) / Math.max(1e-6, r.end - r.full));
  return 1 + (r.floor - 1) * t;
}

/** 固定亂數鍵（同一個 index、seed 永遠相同；分佈均勻） */
export function fadeKey(i: number, seed = 0): number {
  let h = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(seed + 0x85ebca6b, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

export interface FadeSet {
  xs: Float32Array;
  zs: Float32Array;
  keys: Float32Array;
  /** 前 fixed 個永遠保留 */
  fixed: number;
}

export function makeFadeSet(pts: readonly { x: number; z: number }[], fixed: number, seed = 0): FadeSet {
  const n = pts.length;
  const xs = new Float32Array(n);
  const zs = new Float32Array(n);
  const keys = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = pts[i]!.x;
    zs[i] = pts[i]!.z;
    keys[i] = fadeKey(i, seed);
  }
  return { xs, zs, keys, fixed: Math.max(0, Math.min(n, fixed)) };
}

/** 依角色位置挑出要畫的實例 index（寫進 out，回傳數量） */
export function selectFade(set: FadeSet, px: number, pz: number, rule: FadeRule, out: Uint32Array): number {
  let n = 0;
  const len = set.xs.length;
  for (let i = 0; i < len; i++) {
    if (i < set.fixed) {
      out[n++] = i;
      continue;
    }
    const d = Math.hypot(set.xs[i]! - px, set.zs[i]! - pz);
    if (set.keys[i]! < fadeDensity(d, rule)) out[n++] = i;
  }
  return n;
}

/** 依 index 把來源矩陣／顏色緊密複製到繪製緩衝區 */
export function compactInto(src: Float32Array, dst: Float32Array, idx: Uint32Array, n: number, stride: number): void {
  for (let k = 0; k < n; k++) {
    const s = idx[k]! * stride;
    const d = k * stride;
    for (let j = 0; j < stride; j++) dst[d + j] = src[s + j]!;
  }
}

/**
 * 手機（iPhone Safari）場景預算：之後每張新地圖照這張表設計與驗收。
 * 三角面＝畫面上實際畫出的三角形（含角色、怪物）；Draw Calls＝每幀繪製次數。
 * 依據：Stage 6.5 iPhone 實測（高 396k／60 FPS、中 118k、低 87k 都穩定 60）＋6.6／6.9 的 CI 量測。
 */
export const MOBILE_BUDGET = {
  high: { sceneTris: 250_000, drawCalls: 160, shadowCasterRange: 25, vegFull: 18, vegCut: 70 },
  medium: { sceneTris: 130_000, drawCalls: 120, shadowCasterRange: 0, vegFull: 14, vegCut: 55 },
  low: { sceneTris: 90_000, drawCalls: 100, shadowCasterRange: 0, vegFull: 10, vegCut: 42 },
} as const;
