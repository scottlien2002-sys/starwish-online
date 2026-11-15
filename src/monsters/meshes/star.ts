import { Mesh, Scene, VertexData } from "@babylonjs/core";

/**
 * 胖胖的五角星網格（前後各一個凸起中心點），面向 +z。
 * 每個三角形獨立頂點，呈現切面感。
 */
export function createPuffyStar(name: string, scene: Scene, outer = 0.5, inner = 0.24, depth = 0.16, points = 5): Mesh {
  const ring: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 === 0 ? outer : inner;
    ring.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const positions: number[] = [];
  const indices: number[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % n]!;
    // 前面
    let b = positions.length / 3;
    positions.push(0, 0, depth, x1, y1, 0, x0, y0, 0);
    indices.push(b, b + 1, b + 2);
    // 背面
    b = positions.length / 3;
    positions.push(0, 0, -depth, x0, y0, 0, x1, y1, 0);
    indices.push(b, b + 1, b + 2);
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  return mesh;
}

/**
 * V2：圓潤鼓起的軟星形（依設定圖：圓角、像軟糖般鼓起、法線平滑，沒有切面感）。
 * 面向 +z。輪廓由 softStarRadius 決定；前後兩面以同心環由中心鼓起到邊緣。
 */
export function createSoftStar(
  name: string,
  scene: Scene,
  outer: number,
  inner: number,
  depth: number,
  radiusFn: (a: number, outer: number, inner: number) => number,
  segments = 60,
  rings = 6,
  /** 中心與邊緣的頂點色（做出中央亮黃、邊緣暖橘的圓潤立體感）；不給則不寫入頂點色 */
  gradient?: { center: [number, number, number]; edge: [number, number, number] },
): Mesh {
  const colors: number[] = [];
  const pushColor = (s: number): void => {
    if (!gradient) return;
    const k = Math.pow(s, 1.6);
    const c = gradient.center, e = gradient.edge;
    colors.push(c[0] + (e[0] - c[0]) * k, c[1] + (e[1] - c[1]) * k, c[2] + (e[2] - c[2]) * k, 1);
  };
  const positions: number[] = [];
  const indices: number[] = [];
  const ring = (side: 1 | -1): void => {
    const base = positions.length / 3;
    positions.push(0, 0, side * depth); // 中心
    pushColor(0);
    for (let k = 1; k <= rings; k++) {
      const s = k / rings;
      // 鼓起曲線：中心最厚、邊緣變薄（邊緣保留一點厚度，看起來更像軟糖）
      const z = side * depth * Math.sqrt(Math.max(0, 1 - s * s * 0.92));
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const r = radiusFn(a, outer, inner) * s;
        positions.push(Math.cos(a) * r, Math.sin(a) * r, z);
        pushColor(s);
      }
    }
    const idx = (k: number, i: number): number => base + 1 + (k - 1) * segments + (i % segments);
    for (let i = 0; i < segments; i++) {
      if (side === 1) indices.push(base, idx(1, i + 1), idx(1, i));
      else indices.push(base, idx(1, i), idx(1, i + 1));
    }
    for (let k = 1; k < rings; k++) {
      for (let i = 0; i < segments; i++) {
        const a0 = idx(k, i), a1 = idx(k, i + 1), b0 = idx(k + 1, i), b1 = idx(k + 1, i + 1);
        if (side === 1) indices.push(a0, a1, b1, a0, b1, b0);
        else indices.push(a0, b1, a1, a0, b0, b1);
      }
    }
  };
  ring(1);
  ring(-1);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  if (gradient) vd.colors = colors;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  return mesh;
}
