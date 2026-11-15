// 產生「測試方塊」GLB（glTF 2.0 二進位），用來驗證通用怪物框架的 GLB 動畫路徑。
// 這不是正式怪物美術；只有簡單方塊身體 + 眼睛 + 6 段節點動畫。
// 用法：node tools/make-test-dummy-glb.mjs public/models/test-dummy.glb
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const out = process.argv[2] ?? "public/models/test-dummy.glb";

// ---------------- 幾何：方塊（每面獨立頂點，法線正確） ----------------
function box(w, h, d, y0) {
  const x = w / 2, z = d / 2, y1 = y0 + h;
  const faces = [
    // [normal, 4 corners (CCW 由外側看)]
    [[0, 0, 1], [[-x, y0, z], [x, y0, z], [x, y1, z], [-x, y1, z]]],
    [[0, 0, -1], [[x, y0, -z], [-x, y0, -z], [-x, y1, -z], [x, y1, -z]]],
    [[1, 0, 0], [[x, y0, z], [x, y0, -z], [x, y1, -z], [x, y1, z]]],
    [[-1, 0, 0], [[-x, y0, -z], [-x, y0, z], [-x, y1, z], [-x, y1, -z]]],
    [[0, 1, 0], [[-x, y1, z], [x, y1, z], [x, y1, -z], [-x, y1, -z]]],
    [[0, -1, 0], [[-x, y0, -z], [x, y0, -z], [x, y0, z], [-x, y0, z]]],
  ];
  const pos = [], nor = [], idx = [];
  faces.forEach(([n, quad], f) => {
    for (const p of quad) {
      pos.push(...p);
      nor.push(...n);
    }
    const b = f * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { pos, nor, idx };
}

// ---------------- 動畫（作用於 Body 節點） ----------------
const q = (axis, a) => {
  const s = Math.sin(a / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(a / 2)];
};
const X = [1, 0, 0], Z = [0, 0, 1];
const I = [0, 0, 0, 1];
const clips = {
  Idle: {
    t: [0, 0.8, 1.6],
    T: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
    R: [I, I, I],
    S: [[1, 1, 1], [1.05, 0.93, 1.05], [1, 1, 1]],
  },
  Move: {
    t: [0, 0.25, 0.5],
    T: [[0, 0, 0], [0, 0.22, 0], [0, 0, 0]],
    R: [q(X, 0.06), q(X, 0.12), q(X, 0.06)],
    S: [[1.08, 0.88, 1.08], [0.96, 1.08, 0.96], [1.08, 0.88, 1.08]],
  },
  Attack: {
    t: [0, 0.25, 0.35, 0.45, 0.7],
    T: [[0, 0, 0], [0, 0, -0.25], [0, 0.05, 0.9], [0, 0, 0.9], [0, 0, 0]],
    R: [I, q(X, -0.3), q(X, 0.35), q(X, 0.25), I],
    S: [[1, 1, 1], [1.05, 0.9, 1.05], [0.95, 1, 1.15], [1.1, 1.05, 0.85], [1, 1, 1]],
  },
  Hit: {
    t: [0, 0.075, 0.15, 0.225, 0.3],
    T: [[0, 0, 0], [0, 0, -0.08], [0, 0, -0.05], [0, 0, -0.02], [0, 0, 0]],
    R: [I, q(Z, 0.3), q(Z, -0.22), q(Z, 0.1), I],
    S: [[1, 1, 1], [1.1, 0.9, 1.1], [1, 1, 1], [1, 1, 1], [1, 1, 1]],
  },
  Death: {
    t: [0, 0.2, 1.0],
    T: [[0, 0, 0], [0, 0.1, 0], [0, 0, 0]],
    R: [I, q(Z, 0.2), q(Z, 0)],
    S: [[1, 1, 1], [1.1, 0.9, 1.1], [1.35, 0.06, 1.35]],
  },
  Respawn: {
    t: [0, 0.6, 0.8, 1.0],
    T: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
    R: [I, I, I, I],
    S: [[0.01, 0.01, 0.01], [1.15, 1.15, 1.15], [0.95, 0.95, 0.95], [1, 1, 1]],
  },
};

// ---------------- 組裝 glTF ----------------
const bin = [];
let byteLength = 0;
const bufferViews = [];
const accessors = [];

function addData(typed, target) {
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) {
    bin.push(Buffer.alloc(pad));
    byteLength += pad;
  }
  const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: buf.length, ...(target ? { target } : {}) });
  bin.push(buf);
  byteLength += buf.length;
  return bufferViews.length - 1;
}

function accessor(values, type, componentType, target, withMinMax) {
  const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
  const typed = componentType === 5123 ? new Uint16Array(values) : new Float32Array(values);
  const view = addData(typed, target);
  const acc = { bufferView: view, componentType, count: values.length / comps, type };
  if (withMinMax) {
    const min = Array(comps).fill(Infinity), max = Array(comps).fill(-Infinity);
    for (let i = 0; i < values.length; i++) {
      min[i % comps] = Math.min(min[i % comps], values[i]);
      max[i % comps] = Math.max(max[i % comps], values[i]);
    }
    acc.min = min;
    acc.max = max;
  }
  accessors.push(acc);
  return accessors.length - 1;
}

function mesh(geo, material) {
  const POSITION = accessor(geo.pos, "VEC3", 5126, 34962, true);
  const NORMAL = accessor(geo.nor, "VEC3", 5126, 34962, false);
  const indices = accessor(geo.idx, "SCALAR", 5123, 34963, false);
  return { primitives: [{ attributes: { POSITION, NORMAL }, indices, material }] };
}

const meshes = [mesh(box(0.8, 0.7, 0.7, 0), 0), mesh(box(0.12, 0.16, 0.04, -0.08), 1), mesh(box(0.12, 0.16, 0.04, -0.08), 1)];

const animations = Object.entries(clips).map(([name, c]) => {
  const input = accessor(c.t, "SCALAR", 5126, undefined, true);
  const samplers = [
    { input, output: accessor(c.T.flat(), "VEC3", 5126, undefined, false), interpolation: "LINEAR" },
    { input, output: accessor(c.R.flat(), "VEC4", 5126, undefined, false), interpolation: "LINEAR" },
    { input, output: accessor(c.S.flat(), "VEC3", 5126, undefined, false), interpolation: "LINEAR" },
  ];
  return {
    name,
    samplers,
    channels: [
      { sampler: 0, target: { node: 0, path: "translation" } },
      { sampler: 1, target: { node: 0, path: "rotation" } },
      { sampler: 2, target: { node: 0, path: "scale" } },
    ],
  };
});

const gltf = {
  asset: { version: "2.0", generator: "starwish make-test-dummy-glb" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [
    { name: "Body", mesh: 0, children: [1, 2] },
    { name: "EyeL", mesh: 1, translation: [-0.16, 0.45, 0.36] },
    { name: "EyeR", mesh: 2, translation: [0.16, 0.45, 0.36] },
  ],
  meshes,
  materials: [
    { name: "TestDummyBody", pbrMetallicRoughness: { baseColorFactor: [1, 0.62, 0.3, 1], metallicFactor: 0, roughnessFactor: 0.8 } },
    { name: "TestDummyEye", pbrMetallicRoughness: { baseColorFactor: [0.1, 0.08, 0.2, 1], metallicFactor: 0, roughnessFactor: 0.5 } },
  ],
  animations,
  accessors,
  bufferViews,
  buffers: [{ byteLength }],
};

// ---------------- 寫出 GLB ----------------
const binBuf = Buffer.concat(bin);
const binPadded = Buffer.concat([binBuf, Buffer.alloc((4 - (binBuf.length % 4)) % 4)]);
gltf.buffers[0].byteLength = binBuf.length;
let json = Buffer.from(JSON.stringify(gltf), "utf8");
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
const total = 12 + 8 + json.length + 8 + binPadded.length;
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(total, 8);
const chunk = (len, type) => {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(len, 0);
  b.writeUInt32LE(type, 4);
  return b;
};
const glb = Buffer.concat([header, chunk(json.length, 0x4e4f534a), json, chunk(binPadded.length, 0x004e4942), binPadded]);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, glb);
console.log(`wrote ${out} (${glb.length} bytes, ${animations.length} animations: ${animations.map((a) => a.name).join(", ")})`);
