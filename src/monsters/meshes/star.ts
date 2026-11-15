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
