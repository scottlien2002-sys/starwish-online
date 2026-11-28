// Tripo GLB（gltfpack：EXT_meshopt_compression＋KHR_mesh_quantization）→ 一般 GLB（Blender 匯入用）
// 用法：node art/tripo-novice/decompress.mjs <輸入資料夾> <輸出資料夾>
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";
import { readdirSync, mkdirSync } from "node:fs";
const [inDir, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
for (const f of readdirSync(inDir).filter((x) => x.endsWith(".glb"))) {
  const doc = await io.read(`${inDir}/${f}`);
  await doc.transform(dequantize());
  for (const e of doc.getRoot().listExtensionsUsed()) if (/meshopt|quantization/i.test(e.extensionName)) e.dispose();
  await io.write(`${outDir}/${f}`, doc);
  console.log("decoded", f);
}
