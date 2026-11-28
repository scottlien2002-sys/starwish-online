// 星廢垃圾場 V3：Tripo 原始 GLB → 遊戲用 HQ／Lite GLB（Node＋glTF-Transform；本機與 CI 都可執行）
// 用法：node tools/junkyard-lm/process.mjs <raw 資料夾> <輸出資料夾> <budgets.json>
// - 原始檔不修改（只讀）；座標保持原始模型座標（遊戲端依 landmarkSlots.ts 的比例與接合點擺放）
// - 解 meshopt 壓縮與量化 → 移除懸空碎片 → 依預算減面（meshoptimizer）→ 貼圖：底色 HQ 2048／Lite 1024、法線 HQ 1024／Lite 512（JPEG）
// - 移除金屬度／粗糙度貼圖（遊戲端用與場景一致的光照材質，見 JunkyardLandmarks.ts）
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize, prune, simplify, weld, textureCompress } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [rawDir, outDir, budgetsPath] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const budgets = JSON.parse(readFileSync(budgetsPath, "utf8"));
// 使用者交付的原始檔名 → 遊戲零件主幹
export const RAW_MAP = {
  "Starwish_Junkyard_LM01_RAW.glb": "jy_lm_colossus",
  "Starwish_Junkyard_LM02.glb": "jy_lm_furnace",
  "Starwish_Junkyard_LM03_A_Tower.glb": "jy_lm_crane_tower",
  "Starwish_Junkyard_LM03_B_Boom.glb": "jy_lm_crane_jib",
  "Starwish_Junkyard_LM03_C_Grab.glb": "jy_lm_crane_claw",
  "Starwish_Junkyard_LM04.glb": "jy_lm_reactor",
};
await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });

function triCount(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) n += (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3;
  return n;
}

/** 移除懸空的小碎片：三角形連通塊中，面數 < 1.5% 且與其他部分最近距離 > tol 的塊 */
function removeFloaters(doc, tol) {
  let removed = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION").getArray();
      const idxA = prim.getIndices().getArray();
      const nv = pos.length / 3;
      // 以位置合併頂點（UV 接縫處的重複頂點視為相連）
      const q = (v) => Math.round(v / (tol * 0.25));
      const key = new Map();
      const rep = new Uint32Array(nv);
      for (let i = 0; i < nv; i++) {
        const k = `${q(pos[i * 3])},${q(pos[i * 3 + 1])},${q(pos[i * 3 + 2])}`;
        let r = key.get(k);
        if (r === undefined) {
          r = i;
          key.set(k, i);
        }
        rep[i] = r;
      }
      const parent = new Int32Array(nv).map((_, i) => i);
      const find = (a) => {
        while (parent[a] !== a) a = parent[a] = parent[parent[a]];
        return a;
      };
      const unite = (a, b) => {
        a = find(a);
        b = find(b);
        if (a !== b) parent[a] = b;
      };
      for (let t = 0; t < idxA.length; t += 3) {
        unite(rep[idxA[t]], rep[idxA[t + 1]]);
        unite(rep[idxA[t]], rep[idxA[t + 2]]);
      }
      const comp = new Map();
      for (let t = 0; t < idxA.length; t += 3) {
        const c = find(rep[idxA[t]]);
        const a = comp.get(c) ?? [];
        a.push(t);
        comp.set(c, a);
      }
      const total = idxA.length / 3;
      const small = [...comp.entries()].filter(([, ts]) => ts.length < total * 0.015);
      // 其他部分的頂點空間索引
      const cell = tol * 2;
      const grid = new Map();
      const compOfV = new Int32Array(nv).fill(-1);
      for (const [c, ts] of comp) for (const t of ts) for (let j = 0; j < 3; j++) compOfV[idxA[t + j]] = c;
      for (let i = 0; i < nv; i++) {
        const k = `${Math.floor(pos[i * 3] / cell)},${Math.floor(pos[i * 3 + 1] / cell)},${Math.floor(pos[i * 3 + 2] / cell)}`;
        const a = grid.get(k) ?? [];
        a.push(i);
        grid.set(k, a);
      }
      const drop = new Set();
      for (const [c, ts] of small) {
        let touching = false;
        outer: for (const t of ts) {
          for (let j = 0; j < 3; j++) {
            const v = idxA[t + j];
            const cx = Math.floor(pos[v * 3] / cell), cy = Math.floor(pos[v * 3 + 1] / cell), cz = Math.floor(pos[v * 3 + 2] / cell);
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
              for (const u of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
                if (compOfV[u] === c || compOfV[u] === -1) continue;
                const d = Math.hypot(pos[u * 3] - pos[v * 3], pos[u * 3 + 1] - pos[v * 3 + 1], pos[u * 3 + 2] - pos[v * 3 + 2]);
                if (d < tol) {
                  touching = true;
                  break outer;
                }
              }
            }
          }
        }
        if (!touching) drop.add(c);
      }
      if (!drop.size) continue;
      const keep = [];
      for (const [c, ts] of comp) if (!drop.has(c)) for (const t of ts) keep.push(idxA[t], idxA[t + 1], idxA[t + 2]);
      for (const c of drop) removed += comp.get(c).length;
      const acc = prim.getIndices();
      acc.setArray(nv > 65535 ? new Uint32Array(keep) : new Uint16Array(keep));
    }
  }
  return removed;
}

async function resizeTex(doc, slot, size, quality) {
  for (const mat of doc.getRoot().listMaterials()) {
    const tex = slot === "base" ? mat.getBaseColorTexture() : slot === "normal" ? mat.getNormalTexture() : null;
    if (!tex) continue;
    const img = tex.getImage();
    const meta = await sharp(img).metadata();
    const out = await sharp(img).resize({ width: Math.min(size, meta.width), height: Math.min(size, meta.height), fit: "fill", kernel: "lanczos3" }).jpeg({ quality, chromaSubsampling: slot === "normal" ? "4:4:4" : "4:2:0" }).toBuffer();
    tex.setImage(new Uint8Array(out)).setMimeType("image/jpeg").setURI(`${slot}.jpg`);
  }
}

const report = { files: [], removedFloaters: {} };
const raws = readdirSync(rawDir).filter((f) => RAW_MAP[f]);
for (const f of raws) {
  const stem = RAW_MAP[f];
  const b = budgets[stem];
  for (const q of ["hq", "lite"]) {
    const doc = await io.read(join(rawDir, f));
    await doc.transform(dequantize());
    for (const e of doc.getRoot().listExtensionsUsed()) if (/meshopt|quantization/.test(e.extensionName)) e.dispose();
    const tris0 = triCount(doc);
    const fl = removeFloaters(doc, 0.006);
    if (q === "hq") report.removedFloaters[stem] = fl;
    await doc.transform(weld());
    const target = q === "hq" ? b.hqTris : b.liteTris;
    // 誤差上限 1.2%（相對模型大小）：寧可面數略高於預算，也不讓煙囪口、接合處、核心艙被減面破壞
    let err = 0.002;
    for (let k = 0; k < 4 && triCount(doc) > target; k++) {
      const ratio = target / triCount(doc);
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, ratio * 0.98), error: err, lockBorder: false }));
      err = Math.min(0.012, err * 2);
    }
    // 材質：保留底色與法線，移除金屬度／粗糙度、遮蔽、自發光貼圖
    for (const mat of doc.getRoot().listMaterials()) {
      mat.setMetallicRoughnessTexture(null);
      mat.setOcclusionTexture(null);
      mat.setMetallicFactor(0);
      mat.setRoughnessFactor(0.75);
    }
    await resizeTex(doc, "base", q === "hq" ? b.hqTex : b.liteTex, 88);
    await resizeTex(doc, "normal", q === "hq" ? Math.min(1024, b.hqTex) : Math.min(512, b.liteTex), 92);
    await doc.transform(prune());
    const out = join(outDir, `${stem}_${q}.glb`);
    await io.write(out, doc);
    const rec = { file: `${stem}_${q}.glb`, from: f, trisRaw: tris0, tris: triCount(doc), budget: target, bytes: statSync(out).size, rawBytes: statSync(join(rawDir, f)).size };
    report.files.push(rec);
    console.log(JSON.stringify(rec));
  }
}
writeFileSync(join(outDir, "process-report.json"), JSON.stringify(report, null, 2));
