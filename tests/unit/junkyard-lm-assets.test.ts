// 星廢垃圾場 V3：正式地標 GLB（遊戲最佳化版）資產檢查
// - HQ 貼圖 ≤ 2048、Lite 貼圖 ≤ 1024（不得部署 4K／8K）
// - 每個檔案 1 個網格、1 個材質（共用、繪製次數最少）
// - 原始 Tripo GLB 只放在 art/junkyard-lm/raw/（不進 public/、不會被部署）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";

const DIR = new URL("../../public/models/junkyard/", import.meta.url).pathname;

function jpegSize(b: Uint8Array): [number, number] | null {
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1]!;
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [(b[i + 7]! << 8) | b[i + 8]!, (b[i + 5]! << 8) | b[i + 6]!];
    i += 2 + len;
  }
  return null;
}
function pngSize(b: Uint8Array): [number, number] {
  const v = new DataView(b.buffer, b.byteOffset);
  return [v.getUint32(16), v.getUint32(20)];
}

function glbInfo(file: string): { images: [number, number][]; meshes: number; materials: number } {
  const buf = readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as {
    images?: { bufferView: number }[];
    bufferViews: { byteOffset?: number; byteLength: number }[];
    meshes?: unknown[];
    materials?: unknown[];
  };
  const bin = 20 + jsonLen + 8;
  const images = (json.images ?? []).map((im) => {
    const bv = json.bufferViews[im.bufferView]!;
    const data = new Uint8Array(buf.buffer, buf.byteOffset + bin + (bv.byteOffset ?? 0), bv.byteLength);
    return data[0] === 0xff ? jpegSize(data)! : pngSize(data);
  });
  return { images, meshes: json.meshes?.length ?? 0, materials: json.materials?.length ?? 0 };
}

test("地標 GLB：貼圖尺寸（HQ ≤ 2K、Lite ≤ 1K）、單一網格與材質、總容量", () => {
  const files = readdirSync(DIR).filter((f) => /^jy_lm_.*\.glb$/.test(f));
  assert.equal(files.length, 12, "六件模型 × HQ／Lite");
  const manifest = JSON.parse(readFileSync(DIR + "landmarks.json", "utf8")) as { files: string[] };
  assert.deepEqual([...manifest.files].sort(), [...files].sort(), "清單與檔案一致");
  let total = 0;
  for (const f of files) {
    const info = glbInfo(DIR + f);
    const cap = f.endsWith("_hq.glb") ? 2048 : 1024;
    for (const [w, h] of info.images) assert.ok(w <= cap && h <= cap, `${f} 貼圖 ${w}x${h} 超過 ${cap}`);
    assert.equal(info.meshes, 1, `${f} 網格數`);
    assert.equal(info.materials, 1, `${f} 材質數`);
    total += statSync(DIR + f).size;
  }
  assert.ok(total < 12 * 1024 * 1024, `地標 GLB 總容量 ${(total / 1048576).toFixed(1)} MB`);
});

test("原始 Tripo GLB 不在 public/（不會被部署）", () => {
  assert.ok(readdirSync(DIR).every((f) => !f.startsWith("Starwish_Junkyard_LM")));
});
