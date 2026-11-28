// 星廢垃圾場 V3：產生「地標測試替身」GLB（不是正式美術）。
// 用來驗證 Tripo GLB 的載入流程：任意大小與原點 → 自動縮放、置中、落地、朝向、吊臂旋轉、HQ／Lite 距離切換。
// 每個零件＝主體方塊＋朝 +Z 的「鼻子」方塊（可從截圖判斷正面方向），刻意放大 0.37 倍並偏移原點。
// 用法：node tools/make-landmark-test-glbs.mjs <輸出資料夾>   （會一併寫 landmarks.json）
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? "test-results/landmark-test-glbs";
mkdirSync(out, { recursive: true });

function boxGeo(cx, cy, cz, w, h, d, pos, nor, idx) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const faces = [
    [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
    [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
    [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
    [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
    [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
    [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
  ];
  for (const [n, q] of faces) {
    const b = pos.length / 3;
    for (const p of q) {
      pos.push(...p);
      nor.push(...n);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
}

/** size＝規格尺寸（w,h,d）；輸出時乘 0.37 並把原點偏移到 (5, 2, -3) */
function partGeo(size, kind) {
  const pos = [], nor = [], idx = [];
  const k = 0.37;
  const ox = 5, oy = 2, oz = -3;
  const { w, h, d } = size;
  if (kind === "jib") {
    // 吊臂：軸後 7.5 m 配重、軸前 16.5 m 吊臂；包圍盒深度 24
    boxGeo(ox + 0, oy + h * k * 0.5, oz + (-7.5 + 12) * k, w * k, h * k, d * k * 0.15, pos, nor, idx); // 中段（佔位）
    boxGeo(ox + 0, oy + h * k * 0.75, oz + (-7.5 + 0.5 * 24) * k, w * k * 0.4, h * k * 0.5, d * k, pos, nor, idx); // 全長桁架
    boxGeo(ox + 0, oy + h * k * 0.5, oz + -6.5 * k, w * k, h * k, 2 * k, pos, nor, idx); // 配重（後端）
  } else {
    boxGeo(ox, oy + (h * k) / 2, oz, w * k, h * k, d * k * 0.8, pos, nor, idx);
    // 鼻子：正面 +Z，讓包圍盒深度剛好＝d
    boxGeo(ox, oy + h * k * 0.5, oz + d * k * 0.45, w * k * 0.3, h * k * 0.3, d * k * 0.1, pos, nor, idx);
  }
  return { pos, nor, idx };
}

function glb(geo, color) {
  const f32 = (a) => new Float32Array(a);
  const posA = f32(geo.pos), norA = f32(geo.nor), idxA = new Uint32Array(geo.idx);
  const pad4 = (n) => (n + 3) & ~3;
  const bufLen = pad4(posA.byteLength) + pad4(norA.byteLength) + pad4(idxA.byteLength);
  const bin = new Uint8Array(bufLen);
  let o = 0;
  const views = [];
  for (const [arr, target] of [[posA, 34962], [norA, 34962], [idxA, 34963]]) {
    bin.set(new Uint8Array(arr.buffer), o);
    views.push({ buffer: 0, byteOffset: o, byteLength: arr.byteLength, target });
    o += pad4(arr.byteLength);
  }
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < posA.length; i += 3) for (let j = 0; j < 3; j++) {
    mn[j] = Math.min(mn[j], posA[i + j]);
    mx[j] = Math.max(mx[j], posA[i + j]);
  }
  const json = {
    asset: { version: "2.0", generator: "starwish landmark test stand-in" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "standin" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ name: "standin", pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0, roughnessFactor: 0.8 } }],
    buffers: [{ byteLength: bufLen }],
    bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: posA.length / 3, type: "VEC3", min: mn, max: mx },
      { bufferView: 1, componentType: 5126, count: norA.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5125, count: idxA.length, type: "SCALAR" },
    ],
  };
  let js = Buffer.from(JSON.stringify(json));
  const jsPad = pad4(js.length);
  js = Buffer.concat([js, Buffer.alloc(jsPad - js.length, 0x20)]);
  const total = 12 + 8 + js.length + 8 + bin.length;
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const c1 = Buffer.alloc(8);
  c1.writeUInt32LE(js.length, 0);
  c1.writeUInt32LE(0x4e4f534a, 4);
  const c2 = Buffer.alloc(8);
  c2.writeUInt32LE(bin.length, 0);
  c2.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, c1, js, c2, Buffer.from(bin)]);
}

// 與 src/maps/junkyard/landmarkSlots.ts 相同的規格尺寸
const PARTS = [
  { stem: "jy_lm_colossus", size: { w: 30, h: 13.5, d: 18 }, kind: "main", color: [0.55, 0.6, 0.66] },
  { stem: "jy_lm_furnace", size: { w: 8, h: 10, d: 8 }, kind: "main", color: [0.6, 0.35, 0.25] },
  { stem: "jy_lm_crane_tower", size: { w: 4.4, h: 23, d: 4.4 }, kind: "main", color: [0.95, 0.75, 0.25] },
  { stem: "jy_lm_crane_jib", size: { w: 3.4, h: 4.2, d: 24 }, kind: "jib", color: [0.95, 0.55, 0.2] },
  { stem: "jy_lm_crane_claw", size: { w: 2.6, h: 3.2, d: 2.6 }, kind: "main", color: [0.4, 0.42, 0.46] },
  { stem: "jy_lm_reactor", size: { w: 17, h: 26, d: 17 }, kind: "main", color: [0.45, 0.42, 0.5] },
];
const files = [];
for (const p of PARTS) {
  for (const q of ["hq", "lite"]) {
    const name = `${p.stem}_${q}.glb`;
    const c = q === "lite" ? p.color.map((v) => v * 0.8) : p.color;
    writeFileSync(join(out, name), glb(partGeo(p.size, p.kind), c));
    files.push(name);
  }
}
writeFileSync(join(out, "landmarks.json"), JSON.stringify({ version: 1, test: true, files }, null, 2));
console.log(`wrote ${files.length} test GLBs to ${out}`);
