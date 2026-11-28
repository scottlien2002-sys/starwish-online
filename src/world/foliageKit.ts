/**
 * 世界場景共用：草叢幾何（純資料、不依賴 Babylon）。與星芽原野草叢同一種做法：
 * 細長、尖端外彎的葉片（底、中、尖三段漸層色），法線全部朝上（與地面同樣受光，不會有背光黑面）。
 */
export type Rgb3 = readonly [number, number, number];

export interface TuftGeo {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

export interface TuftOptions {
  blades: number;
  /** 葉片高度（m）與高度變化 */
  height: number;
  heightVar: number;
  /** 葉片底部半寬 */
  width: number;
  /** 叢的半徑（葉片分散） */
  spread: number;
  base: Rgb3;
  mid: Rgb3;
  tip: Rgb3;
  seed?: number;
}

/** 每片 3 個三角形 */
export function bladeTuft(o: TuftOptions): TuftGeo {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let s = (o.seed ?? 7) >>> 0 || 1;
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s >>> 8) / 16777216;
  };
  for (let b = 0; b < o.blades; b++) {
    const a = (b / o.blades) * Math.PI + rnd() * 0.5;
    const ra = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * o.spread;
    const ox = Math.cos(ra) * rr;
    const oz = Math.sin(ra) * rr;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    // 葉面朝外傾：沿垂直葉面的方向往外彎
    const out = Math.atan2(oz, ox) + (rnd() - 0.5) * 0.8;
    const lx = Math.cos(out);
    const lz = Math.sin(out);
    const lean = 0.1 + rnd() * 0.16;
    const h = o.height + (rnd() - 0.3) * o.heightVar;
    const w = o.width * (0.8 + rnd() * 0.4);
    const i0 = positions.length / 3;
    positions.push(ox - dx * w, 0, oz - dz * w, ox + dx * w, 0, oz + dz * w);
    positions.push(ox - dx * w * 0.65 + lx * lean * 0.35, h * 0.55, oz - dz * w * 0.65 + lz * lean * 0.35, ox + dx * w * 0.65 + lx * lean * 0.35, h * 0.55, oz + dz * w * 0.65 + lz * lean * 0.35);
    positions.push(ox + lx * lean, h, oz + lz * lean);
    const j = (rnd() - 0.5) * 0.08;
    for (const c of [o.base, o.base, o.mid, o.mid, o.tip]) colors.push(c[0] + j, c[1] + j, c[2] + j, 1);
    indices.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2, i0 + 2, i0 + 3, i0 + 4);
  }
  const normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
  return { positions, normals, colors, indices };
}
