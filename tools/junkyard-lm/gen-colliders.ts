// 星廢垃圾場 V3：依 GLB 實際外形產生地標碰撞（玩家高度範圍內的佔地）→ src/maps/junkyard/landmarkColliders.gen.ts
// 用法：node --experimental-strip-types tools/junkyard-lm/gen-colliders.ts
// 方法：把 HQ 模型三角形轉到世界座標，取「地面上 2.4 m 以內」的部分投影到 0.5 m 格網 → 補 1 m 以內的縫隙 → 合併成矩形
import { NodeIO } from "@gltf-transform/core";
import { writeFileSync } from "node:fs";
import { CRANE_SPECS, MODEL_BOUNDS, MODELS, modelToWorld, PLACEMENTS, type LandmarkPlacement } from "../../src/maps/junkyard/landmarkSlots.ts";
import { TOWER } from "../../src/maps/junkyard/craneSpec.ts";
import { groundHeight } from "../../src/maps/junkyard/terrain.ts";

const CELL = 0.5;
const BAND = 2.4;
const io = new NodeIO();

async function tris(stem: string): Promise<{ pos: Float32Array; idx: Uint32Array }> {
  const doc = await io.read(`public/models/junkyard/${stem}_hq.glb`);
  const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  const p = prim.getAttribute("POSITION")!.getArray() as Float32Array;
  // glTF → Babylon：x 反向
  const pos = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    pos[i] = -p[i]!;
    pos[i + 1] = p[i + 1]!;
    pos[i + 2] = p[i + 2]!;
  }
  return { pos, idx: new Uint32Array(prim.getIndices()!.getArray()!) };
}

function footprint(id: string, worldTris: number[][][], baseY: number): { id: string; boxes: number[][]; cells: number } {
  // 世界三角形 → 格網
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const t of worldTris) for (const v of t) {
    x0 = Math.min(x0, v[0]!); x1 = Math.max(x1, v[0]!);
    z0 = Math.min(z0, v[2]!); z1 = Math.max(z1, v[2]!);
  }
  x0 = Math.floor(x0 / CELL) * CELL - 2; z0 = Math.floor(z0 / CELL) * CELL - 2;
  const nx = Math.ceil((x1 - x0) / CELL) + 5, nz = Math.ceil((z1 - z0) / CELL) + 5;
  const g = new Uint8Array(nx * nz);
  for (const t of worldTris) {
    // 只要有一個頂點在玩家高度範圍內
    const inBand = t.some((v) => v[1]! < Math.max(baseY, groundHeight(v[0]!, v[2]!)) + BAND);
    if (!inBand) continue;
    const [a, b, c] = t as [number[], number[], number[]];
    const bx0 = Math.floor((Math.min(a[0]!, b[0]!, c[0]!) - x0) / CELL), bx1 = Math.floor((Math.max(a[0]!, b[0]!, c[0]!) - x0) / CELL);
    const bz0 = Math.floor((Math.min(a[2]!, b[2]!, c[2]!) - z0) / CELL), bz1 = Math.floor((Math.max(a[2]!, b[2]!, c[2]!) - z0) / CELL);
    const area = (b[0]! - a[0]!) * (c[2]! - a[2]!) - (c[0]! - a[0]!) * (b[2]! - a[2]!);
    for (let j = bz0; j <= bz1; j++) for (let i = bx0; i <= bx1; i++) {
      if (bx0 === bx1 || bz0 === bz1 || Math.abs(area) < 1e-6) { g[j * nx + i] = 1; continue; }
      const px = x0 + (i + 0.5) * CELL, pz = z0 + (j + 0.5) * CELL;
      const w0 = (b[0]! - px) * (c[2]! - pz) - (c[0]! - px) * (b[2]! - pz);
      const w1 = (c[0]! - px) * (a[2]! - pz) - (a[0]! - px) * (c[2]! - pz);
      const w2 = (a[0]! - px) * (b[2]! - pz) - (b[0]! - px) * (a[2]! - pz);
      if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) g[j * nx + i] = 1;
    }
    // 頂點本身所在格
    for (const v of t) g[Math.floor((v[2]! - z0) / CELL) * nx + Math.floor((v[0]! - x0) / CELL)] = 1;
  }
  // 閉運算（膨脹 2 格 → 侵蝕 2 格）：補 1 m 以內的縫，避免玩家卡進指縫、鷹架縫
  const morph = (src: Uint8Array, dil: boolean): Uint8Array => {
    const out = new Uint8Array(src.length);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      let v = dil ? 0 : 1;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        const s = ii < 0 || jj < 0 || ii >= nx || jj >= nz ? 0 : src[jj * nx + ii]!;
        if (dil && s) v = 1;
        if (!dil && !s) v = 0;
      }
      out[j * nx + i] = v;
    }
    return out;
  };
  let m = morph(morph(g, true), true);
  m = morph(morph(m, false), false);
  // 合併成矩形（貪婪：每列連續段 → 往下延伸相同段）
  const used = new Uint8Array(nx * nz);
  const boxes: number[][] = [];
  let cells = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (!m[j * nx + i] || used[j * nx + i]) continue;
    let w = 0;
    while (i + w < nx && m[j * nx + i + w] && !used[j * nx + i + w]) w++;
    let h = 1;
    outer: while (j + h < nz) {
      for (let k = 0; k < w; k++) if (!m[(j + h) * nx + i + k] || used[(j + h) * nx + i + k]) break outer;
      h++;
    }
    for (let dj = 0; dj < h; dj++) for (let k = 0; k < w; k++) used[(j + dj) * nx + i + k] = 1;
    cells += w * h;
    boxes.push([+(x0 + (i + w / 2) * CELL).toFixed(2), +(z0 + (j + h / 2) * CELL).toFixed(2), (w * CELL) / 2, (h * CELL) / 2]);
  }
  return { id, boxes, cells };
}

const out: { id: string; boxes: number[][]; cells: number }[] = [];
for (const pl of PLACEMENTS as readonly LandmarkPlacement[]) {
  const { pos, idx } = await tris(MODELS[pl.model].stem);
  const gy = pl.y ?? groundHeight(pl.x, pl.z);
  const W: number[][][] = [];
  for (let t = 0; t < idx.length; t += 3) {
    W.push([0, 1, 2].map((k) => {
      const v = idx[t + k]! * 3;
      return modelToWorld(pl, gy, pos[v]!, pos[v + 1]!, pos[v + 2]!);
    }));
  }
  out.push(footprint(pl.id, W, gy - (pl.sink ?? 0)));
  void MODEL_BOUNDS;
}
{
  const { pos, idx } = await tris(MODELS.tower.stem);
  for (const c of CRANE_SPECS) {
    const gy = groundHeight(c.x, c.z);
    const W: number[][][] = [];
    for (let t = 0; t < idx.length; t += 3) {
      W.push([0, 1, 2].map((k) => {
        const v = idx[t + k]! * 3;
        return [c.x + pos[v]! * c.towerUnit, gy + (pos[v + 1]! - TOWER.bottom) * c.towerUnit, c.z + pos[v + 2]! * c.towerUnit];
      }));
    }
    out.push(footprint(c.id, W, gy));
  }
}
const lines = out.map((o) => `  ${JSON.stringify(o.id)}: [\n${o.boxes.map((b) => `    [${b.join(", ")}],`).join("\n")}\n  ],`).join("\n");
writeFileSync(
  "src/maps/junkyard/landmarkColliders.gen.ts",
  `// 自動產生：node --experimental-strip-types tools/junkyard-lm/gen-colliders.ts（請勿手改）\n// 四大地標依 GLB 實際外形產生的碰撞（地面上 2.4 m 內的佔地；0.5 m 格網；補 1 m 以內的縫）。每筆 [x, z, hx, hz]\nexport const LANDMARK_FOOTPRINTS: Record<string, readonly (readonly [number, number, number, number])[]> = {\n${lines}\n};\n`,
);
for (const o of out) console.log(o.id, "boxes", o.boxes.length, "area m²", (o.cells * CELL * CELL).toFixed(0));
