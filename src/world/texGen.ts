/**
 * 世界場景共用：程序化貼圖像素（純邏輯、不依賴 Babylon；可無縫重複、可單元測試）。
 * 產生 RGBA Uint8Array，由呼叫端用 RawTexture 建立貼圖。
 * 地面貼圖會和頂點色相乘：平均亮度約 0.85～0.9，色相接近中性（大範圍顏色由頂點色決定）。
 */

export function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s >>> 8) / 16777216;
  };
}

/** 可無縫重複的值雜訊：period 個格子，u、v ∈ [0,1) */
export function periodicNoise(period: number, seed: number): (u: number, v: number) => number {
  const r = lcg(seed);
  const L = new Float32Array(period * period);
  for (let i = 0; i < L.length; i++) L[i] = r();
  const g = (a: number, b: number): number => L[(((b % period) + period) % period) * period + (((a % period) + period) % period)]!;
  return (u: number, v: number): number => {
    const x = u * period;
    const y = v * period;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = g(i, j) + (g(i + 1, j) - g(i, j)) * sx;
    const b = g(i, j + 1) + (g(i + 1, j + 1) - g(i, j + 1)) * sx;
    return a + (b - a) * sy;
  };
}

const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

/** 在環繞（可重複）畫布上畫圓形斑點：f(dist01) 回傳亮度倍率 */
function stamp(buf: Float32Array, N: number, cx: number, cy: number, r: number, f: (t: number) => number, tint: [number, number, number] = [1, 1, 1]): void {
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const t = Math.hypot(dx, dy) / r;
      if (t > 1) continue;
      const x = (((cx + dx) % N) + N) % N;
      const y = (((cy + dy) % N) + N) % N;
      const k = (y * N + x) * 3;
      const m = f(t);
      buf[k] = buf[k]! * (1 + (m - 1) * tint[0]);
      buf[k + 1] = buf[k + 1]! * (1 + (m - 1) * tint[1]);
      buf[k + 2] = buf[k + 2]! * (1 + (m - 1) * tint[2]);
    }
  }
}

function toRGBA(buf: Float32Array, N: number): Uint8Array {
  const out = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    out[i * 4] = clamp255(buf[i * 3]!);
    out[i * 4 + 1] = clamp255(buf[i * 3 + 1]!);
    out[i * 4 + 2] = clamp255(buf[i * 3 + 2]!);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * 自然地面（草地、泥土、廢料土）：多層雲狀明暗＋小石子（亮頂暗邊）＋細碎斑點。
 * 一張貼圖約對應 9～10 m 地面。
 */
export function groundTexels(N = 256, seed = 11): Uint8Array {
  const n1 = periodicNoise(4, seed);
  const n2 = periodicNoise(12, seed + 1);
  const n3 = periodicNoise(40, seed + 2);
  const hue = periodicNoise(6, seed + 3);
  const buf = new Float32Array(N * N * 3);
  const r = lcg(seed + 9);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const l = 0.78 + 0.16 * n1(u, v) + 0.08 * n2(u, v) + 0.06 * n3(u, v) + 0.03 * (r() - 0.5);
      const h = (hue(u, v) - 0.5) * 0.06; // 少量冷暖變化
      const k = (y * N + x) * 3;
      buf[k] = l * (1 + h);
      buf[k + 1] = l;
      buf[k + 2] = l * (1 - h);
    }
  }
  // 小石子
  const pebbles = Math.round((N * N) / 900);
  for (let i = 0; i < pebbles; i++) {
    const cx = Math.floor(r() * N);
    const cy = Math.floor(r() * N);
    const rad = 1.2 + r() * (N / 110);
    stamp(buf, N, cx + 1, cy + 1, rad * 1.15, (t) => 1 - 0.22 * (1 - t)); // 影子
    stamp(buf, N, cx, cy, rad, (t) => 1.1 + 0.06 * (1 - t), [1, 1, 0.96]);
  }
  // 深色碎斑（土塊、枯葉）
  const specks = Math.round((N * N) / 500);
  for (let i = 0; i < specks; i++) stamp(buf, N, Math.floor(r() * N), Math.floor(r() * N), 0.8 + r() * 1.6, (t) => 0.86 + 0.14 * t);
  return toRGBA(buf, N);
}

/**
 * 鋪面（混凝土／鐵板）：一張貼圖 4×4 塊板，板間縫線、每塊明暗不同、油漬、刮痕與鉚釘。
 * 一張貼圖約對應 16 m（每塊 4 m）；油漬位置不規則，重複感較低。
 */
export function slabTexels(N = 256, seed = 23, slabs = 4): Uint8Array {
  const n1 = periodicNoise(8, seed);
  const n2 = periodicNoise(32, seed + 1);
  const buf = new Float32Array(N * N * 3);
  const r = lcg(seed + 5);
  const tones = Array.from({ length: slabs * slabs }, () => 0.84 + r() * 0.12);
  const half = N / slabs;
  const seam = Math.max(1.2, N / 220);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const tile = Math.floor(x / half) + Math.floor(y / half) * slabs;
      let l = tones[tile]! * (0.92 + 0.08 * n1(u, v) + 0.05 * (n2(u, v) - 0.5)) + 0.025 * (r() - 0.5);
      // 縫線（含右下的淺色倒角）
      const dx = Math.min(x % half, half - (x % half));
      const dy = Math.min(y % half, half - (y % half));
      const d = Math.min(dx, dy);
      if (d < seam) l *= 0.62 + 0.18 * (d / seam);
      else if (d < seam * 2.2) l *= 1.04;
      const k = (y * N + x) * 3;
      buf[k] = l;
      buf[k + 1] = l;
      buf[k + 2] = l * 1.01;
    }
  }
  // 鉚釘（每塊四角）
  for (let t = 0; t < slabs * slabs; t++) {
    const ox = (t % slabs) * half;
    const oy = Math.floor(t / slabs) * half;
    for (const [a, b] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]] as const) {
      stamp(buf, N, Math.round(ox + a * half), Math.round(oy + b * half), Math.max(1.2, N / 170), (q) => 0.75 + 0.45 * q);
    }
  }
  // 油漬與水痕（淡、偏暖）
  const stains = 4 + slabs * 2;
  for (let i = 0; i < stains; i++) {
    const cx = Math.floor(r() * N);
    const cy = Math.floor(r() * N);
    const rad = (N / slabs) * (0.12 + r() * 0.3);
    const k = 0.1 + r() * 0.14;
    stamp(buf, N, cx, cy, rad, (t) => 1 - k + k * t * t, [1, 1.03, 1.08]);
  }
  // 細刮痕
  for (let i = 0; i < 20 * slabs; i++) {
    let x = r() * N;
    let y = r() * N;
    const a = r() * Math.PI;
    const len = 4 + r() * (N / (slabs * 6));
    for (let s = 0; s < len; s++) {
      stamp(buf, N, Math.round(x), Math.round(y), 0.7, () => 1.07);
      x += Math.cos(a);
      y += Math.sin(a);
    }
  }
  return toRGBA(buf, N);
}

/** 檢查可無縫重複：左右邊、上下邊的平均差（測試用） */
export function edgeSeam(px: Uint8Array, N: number): number {
  let diff = 0;
  for (let i = 0; i < N; i++) {
    const a = (i * N + 0) * 4;
    const b = (i * N + N - 1) * 4;
    const c = (0 * N + i) * 4;
    const d = ((N - 1) * N + i) * 4;
    diff += Math.abs(px[a]! - px[b]!) + Math.abs(px[c]! - px[d]!);
  }
  return diff / (2 * N);
}

export function meanLuma(px: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < px.length; i += 4) s += 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
  return s / (px.length / 4) / 255;
}
