import { Mesh, VertexBuffer, VertexData, type AbstractMesh, type Scene } from "@babylonjs/core";

/**
 * Stage 6.6：把一個以村莊中心為圓心、環狀分布的靜態網格（外圍樹林、樹籬）依「三角形重心的方位角」切成 n 個扇區網格。
 * 目的：鏡頭背後／畫面外的扇區由 Babylon 的視錐剔除直接略過，不必整圈都畫。
 * - 不改變任何頂點與外觀，只是把同一份三角形分到不同網格（三角面總數不變）。
 * - 複製所有頂點屬性（位置、法線、頂點色、UV…），材質與陰影設定沿用原網格。
 * - 原網格會被釋放。
 */
export function splitBySector(scene: Scene, src: AbstractMesh, n: number, prefix: string): Mesh[] {
  const mesh = src as Mesh;
  const idx = mesh.getIndices();
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!idx || !pos || n < 2) return [mesh];
  mesh.computeWorldMatrix(true);
  const wm = mesh.getWorldMatrix();
  const m = wm.m;
  const kinds = mesh.getVerticesDataKinds().filter((k) => k !== VertexBuffer.PositionKind);
  const data: Record<string, { arr: Float32Array | number[]; stride: number }> = {};
  for (const k of kinds) {
    const vb = mesh.getVertexBuffer(k);
    const arr = mesh.getVerticesData(k);
    if (!vb || !arr) continue;
    data[k] = { arr, stride: vb.getSize() };
  }
  const buckets: number[][] = Array.from({ length: n }, () => []);
  for (let t = 0; t < idx.length; t += 3) {
    let x = 0;
    let z = 0;
    for (let j = 0; j < 3; j++) {
      const v = idx[t + j]! * 3;
      const px = pos[v]!;
      const py = pos[v + 1]!;
      const pz = pos[v + 2]!;
      x += px * m[0]! + py * m[4]! + pz * m[8]! + m[12]!;
      z += px * m[2]! + py * m[6]! + pz * m[10]! + m[14]!;
    }
    const a = Math.atan2(x, z) + Math.PI; // 0..2π
    const s = Math.min(n - 1, Math.floor((a / (Math.PI * 2)) * n));
    buckets[s]!.push(t);
  }
  const out: Mesh[] = [];
  for (let s = 0; s < n; s++) {
    const tris = buckets[s]!;
    if (!tris.length) continue;
    const remap = new Map<number, number>();
    const nIdx: number[] = [];
    const nPos: number[] = [];
    const nData: Record<string, number[]> = {};
    for (const k of Object.keys(data)) nData[k] = [];
    for (const t of tris) {
      for (let j = 0; j < 3; j++) {
        const o = idx[t + j]!;
        let ni = remap.get(o);
        if (ni === undefined) {
          ni = remap.size;
          remap.set(o, ni);
          nPos.push(pos[o * 3]!, pos[o * 3 + 1]!, pos[o * 3 + 2]!);
          for (const [k, d] of Object.entries(data)) for (let c = 0; c < d.stride; c++) nData[k]!.push(d.arr[o * d.stride + c]!);
        }
        nIdx.push(ni);
      }
    }
    const part = new Mesh(`${prefix}_s${s}`, scene);
    const vd = new VertexData();
    vd.positions = nPos;
    vd.indices = nIdx;
    vd.applyToMesh(part, false);
    for (const [k, arr] of Object.entries(nData)) part.setVerticesData(k, arr, false, data[k]!.stride);
    part.parent = mesh.parent;
    part.position.copyFrom(mesh.position);
    if (mesh.rotationQuaternion) part.rotationQuaternion = mesh.rotationQuaternion.clone();
    else part.rotation.copyFrom(mesh.rotation);
    part.scaling.copyFrom(mesh.scaling);
    part.material = mesh.material;
    part.isPickable = mesh.isPickable;
    part.receiveShadows = mesh.receiveShadows;
    part.hasVertexAlpha = mesh.hasVertexAlpha;
    part.useVertexColors = mesh.useVertexColors;
    out.push(part);
  }
  mesh.dispose(false, false);
  return out;
}

/** 依方位角把點分到 n 個扇區（與 splitBySector 同一套角度定義） */
export function sectorOf(x: number, z: number, n: number): number {
  const a = Math.atan2(x, z) + Math.PI;
  return Math.min(n - 1, Math.floor((a / (Math.PI * 2)) * n));
}
