// Stage 7.5：把 build75.py 的結果寫成遊戲用 GLB（HQ／Lite）。原始 GLB 不修改（讀解壓後的副本）。
// node write75.mjs <decoded.glb> <n75_data.json> <n75_skin.bin> <out dir>
// 輸出：novice_n75_male_hq.glb（貼圖 2048）、novice_n75_male_lite.glb（貼圖 1024）、novice_n75_male.json（動作清單、命中時間、量測值）
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { textureCompress, prune, dedup } from "@gltf-transform/functions";
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";

const [inGlb, dataPath, skinPath, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const data = JSON.parse(readFileSync(dataPath, "utf8"));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

async function build(lod) {
  const doc = await io.read(inGlb);
  const root = doc.getRoot();
  const buf = root.listBuffers()[0];
  const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
  // 1. 轉正、縮放
  byName.get(data.root.node).setRotation(data.root.rotation).setScale(data.root.scale);
  // 2. 輔助骨骼（加在 skin 關節最後面）
  const skin = root.listSkins()[0];
  const oldIbm = skin.getInverseBindMatrices().getArray();
  const nOld = skin.listJoints().length;
  const ibm = new Float32Array((nOld + data.helpers.length) * 16);
  ibm.set(oldIbm.subarray(0, nOld * 16));
  data.helpers.forEach((h, k) => {
    const n = doc.createNode(h.name).setTranslation(h.translation).setRotation(h.rotation);
    byName.get(h.parent).addChild(n);
    skin.addJoint(n);
    byName.set(h.name, n);
    ibm.set(h.ibm, (nOld + k) * 16);
  });
  skin.setInverseBindMatrices(doc.createAccessor("ibm").setType("MAT4").setArray(ibm).setBuffer(buf));
  const jn = skin.listJoints().map((n) => n.getName());
  if (JSON.stringify(jn) !== JSON.stringify(data.jointNames)) throw new Error("joint order mismatch");
  // 3. 武器掛點（不是關節，掛在手骨下面；遊戲端把武器網格放進這個節點）
  for (const s of data.sockets) {
    const n = doc.createNode(s.name).setTranslation(s.translation).setRotation(s.rotation).setScale(s.scale);
    byName.get(s.parent).addChild(n);
    byName.set(s.name, n);
  }
  // 4. 新蒙皮權重
  const prim = root.listMeshes()[0].listPrimitives()[0];
  const nv = prim.getAttribute("POSITION").getCount();
  const raw = readFileSync(skinPath);
  const J = new Uint8Array(raw.buffer, raw.byteOffset, nv * 4).slice();
  const W = new Float32Array(raw.buffer.slice(raw.byteOffset + nv * 4, raw.byteOffset + nv * 4 + nv * 16));
  prim.setAttribute("JOINTS_0", doc.createAccessor("joints").setType("VEC4").setArray(J).setBuffer(buf));
  prim.setAttribute("WEIGHTS_0", doc.createAccessor("weights").setType("VEC4").setArray(W).setBuffer(buf));
  // 5. 動畫
  for (const a of root.listAnimations()) a.dispose();
  const fps = data.fps;
  for (const c of data.clips) {
    const anim = doc.createAnimation(c.name);
    const times = new Float32Array(c.frames).map((_, i) => i / fps);
    const input = doc.createAccessor(`${c.name}_t`).setType("SCALAR").setArray(times).setBuffer(buf);
    for (const ch of c.channels) {
      const node = byName.get(ch.node);
      if (!node) throw new Error(`no node ${ch.node}`);
      const out = doc.createAccessor(`${c.name}_${ch.node}_${ch.path}`).setType(ch.path === "rotation" ? "VEC4" : "VEC3").setArray(new Float32Array(ch.values)).setBuffer(buf);
      const smp = doc.createAnimationSampler().setInput(input).setOutput(out).setInterpolation("LINEAR");
      anim.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(ch.path).setSampler(smp));
    }
    anim.setExtras({ loop: c.loop, marks: c.marks });
  }
  // 6. 材質名稱（除錯用）、Lite 貼圖縮小
  root.listMaterials()[0].setName("novice_n75_male");
  // 貼圖記憶體（Stage 7.5 第二階段）：HQ 顏色貼圖維持 2048（臉、頭髮細節），法線與 ORM 降到 1024（手機畫面看不出差異，
  // GPU 記憶體約 64 MB → 32 MB）；Lite 全部 1024。法線維持 PNG（JPEG 會讓法線出現色塊）
  if (lod === "lite") await doc.transform(textureCompress({ encoder: sharp, resize: [1024, 1024] }));
  else await doc.transform(textureCompress({ encoder: sharp, resize: [1024, 1024], slots: /^(normalTexture|metallicRoughnessTexture|occlusionTexture)$/ }));
  await doc.transform(dedup(), prune({ keepLeaves: true, keepAttributes: true }));
  const file = `${outDir}/novice_n75_male_${lod}.glb`;
  await io.write(file, doc);
  return { file, bytes: statSync(file).size, triangles: prim.getIndices().getCount() / 3, joints: jn.length, clips: data.clips.length };
}

const hq = await build("hq");
const lite = await build("lite");
const manifest = {
  version: "n75",
  note: "Stage 7.5 新版男性初心者（Tripo 模型＋蒙皮修正＋重定向／程式化動作）",
  files: { hq: "novice_n75_male_hq.glb", lite: "novice_n75_male_lite.glb" },
  clips: Object.fromEntries(data.clips.map((c) => [c.name, { seconds: (c.frames - 1) / fps0(), loop: c.loop, marks: c.marks }])),
  sockets: data.sockets.map((s) => ({ name: s.name, parent: s.parent, axes: "+Y 刀身／杖身方向、+Z 手指方向、+X 掌心法線" })),
  helpers: data.helpers.map((h) => ({ name: h.name, parent: h.parent })),
  stats: { hq, lite },
};
function fps0() {
  return data.fps;
}
writeFileSync(`${outDir}/novice_n75_male.json`, JSON.stringify(manifest, null, 1));
console.log(JSON.stringify(manifest.stats));
