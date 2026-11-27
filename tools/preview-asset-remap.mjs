// Stage 7.4（Claude A）：預覽不重複發布大型模型與貼圖。沿用 Claude D Stage 8.1 tools/mp-asset-remap.mjs 的做法（複製一份，不改 D 的分支）。
// 優先指向 preview-stage73-world（同一條開發線、驗收對照用，必須保留）；其次其他預覽。
// node tools/preview-asset-remap.mjs <gh-pages 目錄> <自己的預覽資料夾名稱>
// 在 gh-pages 其他預覽資料夾找「內容完全相同」（SHA-1 相同）的模型／貼圖：找到就刪掉自己的副本，
// 改寫進 asset-remap.json（遊戲在多人模式開機時讓 Babylon 改從那個資料夾讀取）。沒找到的才留在自己的資料夾。
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const pages = process.argv[2];
const mine = process.argv[3];
if (!pages || !mine || !/^preview-[a-z0-9-]+$/.test(mine)) {
  console.error("usage: preview-asset-remap.mjs <pages-dir> <preview-dir>");
  process.exit(2);
}
const EXT = /\.(glb|png|jpe?g|ktx2|env)$/i;
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === ".git" ? [] : walk(join(d, e.name))) : [join(d, e.name)]));
const sha = (f) => createHash("sha1").update(readFileSync(f)).digest("hex");

// 其他預覽資料夾的檔案索引（只看 preview-*；不碰正式網站根目錄的檔案，避免 main 部署時被換掉）
const index = new Map();
const PREFER = ["preview-stage73-world"];
const tops = readdirSync(pages).sort((a, b) => (PREFER.includes(b) ? 1 : 0) - (PREFER.includes(a) ? 1 : 0));
for (const top of tops) {
  if (top === mine || !top.startsWith("preview-")) continue;
  const dir = join(pages, top);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of walk(dir)) if (EXT.test(f)) {
    const h = sha(f);
    if (!index.has(h)) index.set(h, relative(pages, f).split(sep).join("/"));
  }
}
const root = join(pages, mine);
const files = {};
let saved = 0;
let kept = 0;
for (const f of walk(root)) {
  if (!EXT.test(f)) continue;
  // 小檔案（< 256 KB，例如畫面用的頭像 png，由 <img> 載入、不經過 Babylon）留在自己的資料夾
  if (statSync(f).size < 256 * 1024) {
    kept += statSync(f).size;
    continue;
  }
  const hit = index.get(sha(f));
  const rel = relative(root, f).split(sep).join("/");
  const size = statSync(f).size;
  if (hit) {
    files[rel] = `../${hit}`;
    unlinkSync(f);
    saved += size;
  } else kept += size;
}
const sources = [...new Set(Object.values(files).map((p) => p.split("/")[1]))];
writeFileSync(join(root, "asset-remap.json"), JSON.stringify({ note: "Stage 7.4 預覽：以下檔案與其他預覽資料夾內容完全相同（SHA-1），從那裡讀取，不重複發布", sources, files }, null, 1));
console.log(`remapped ${Object.keys(files).length} files (${(saved / 1e6).toFixed(1)} MB saved) from ${sources.join(", ")}; kept ${(kept / 1e6).toFixed(1)} MB`);
