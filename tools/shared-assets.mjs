// 星願物語 GitHub Pages 版本化共用資產（/shared-assets/）。負責人：Claude A（2026-11-28 使用者指派）。
//
// 結構：
//   shared-assets/v1/<sha1 前 2 碼>/<sha1>.<副檔名>   ← 檔名＝內容 SHA-1；已發布的檔案永遠不覆寫（新版本＝新雜湊＝新檔名）
//   shared-assets/index.json                         ← 資產清單＋每個預覽引用了哪些檔案（每次部署重新產生）
//   preview-xxx/asset-remap.json                     ← "models/a.glb": "../shared-assets/v1/ab/ab12….glb"（遊戲開機時套用）
//
// 指令（部署工作流程在 gh-pages 工作目錄內執行；只動自己的資料夾與 shared-assets）：
//   publish  <pages> <dir>          自己的大型資產（≥ 256 KB）搬進共用區：共用區已有相同內容 → 刪掉自己的副本；沒有 → 搬進去。
//                                   其他預覽仍引用的自己的檔案不搬（避免對方壞掉），等對方改指向共用區後下次部署再搬。
//   preserve-save    <pages> <dir> <tmp>   替換自己的資料夾前：把「其他預覽引用的自己的檔案」先存起來
//   preserve-restore <pages> <dir> <tmp>   放入新建置後：把存起來、但新建置沒有的檔案放回去（不覆蓋新建置）
//   index    <pages>                重新產生 shared-assets/index.json（引用紀錄、未被引用的檔案）
//   verify   <pages>                檢查：共用檔案內容與檔名雜湊一致、所有 asset-remap 指向的檔案都存在
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";

const [cmd, pages, dir, tmp] = process.argv.slice(2);
const SHARED = "shared-assets";
const VER = "v1";
const MIN = 256 * 1024; // 小檔案（例如 <img> 直接載入的頭像）留在自己的資料夾，不經過 Babylon 的網址轉換
const EXT = /\.(glb|gltf|bin|png|jpe?g|webp|ktx2|basis|env|hdr|dds|mp3|ogg|wav|m4a|aac)$/i;
const okDir = (d) => /^preview-[a-z0-9-]+$/.test(d ?? "");
const die = (m) => {
  console.error(m);
  process.exit(2);
};
if (!cmd || !pages || !existsSync(pages)) die("usage: shared-assets.mjs <publish|preserve-save|preserve-restore|index|verify> <pages> [dir] [tmp]");
const walk = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === ".git" ? [] : walk(join(d, e.name))) : [join(d, e.name)])) : []);
const posix = (p) => p.split(sep).join("/");
const sha1 = (f) => createHash("sha1").update(readFileSync(f)).digest("hex");
const previews = () => readdirSync(pages).filter((t) => t.startsWith("preview-") && statSync(join(pages, t)).isDirectory());
const readRemap = (t) => {
  const p = join(pages, t, "asset-remap.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")).files ?? {};
  } catch {
    return {};
  }
};
/** 其他預覽引用的、位於 <dir> 裡的檔案（相對 <dir> 的路徑） */
const referencedByOthers = (d) => {
  const out = new Map();
  for (const t of previews()) {
    if (t === d) continue;
    for (const v of Object.values(readRemap(t))) {
      const target = posix(relative(pages, normalize(join(pages, t, v))));
      if (target.startsWith(`${d}/`)) {
        const r = target.slice(d.length + 1);
        if (!out.has(r)) out.set(r, new Set());
        out.get(r).add(t);
      }
    }
  }
  return out;
};

function buildIndex() {
  const prev = existsSync(join(pages, SHARED, "index.json")) ? JSON.parse(readFileSync(join(pages, SHARED, "index.json"), "utf8")) : { files: {} };
  const files = {};
  for (const f of walk(join(pages, SHARED, VER))) {
    const name = f.split(sep).pop();
    files[name] = { path: posix(relative(pages, f)), bytes: statSync(f).size, users: [], firstSeen: prev.files?.[name]?.firstSeen ?? new Date().toISOString() };
  }
  const perPreview = {};
  for (const t of previews()) {
    for (const [k, v] of Object.entries(readRemap(t))) {
      const target = posix(relative(pages, normalize(join(pages, t, v))));
      if (!target.startsWith(`${SHARED}/`)) continue;
      const name = target.split("/").pop();
      if (files[name]) files[name].users.push(`${t}/${k}`);
      perPreview[t] ??= { files: 0, bytes: 0 };
      perPreview[t].files++;
      perPreview[t].bytes += files[name]?.bytes ?? 0;
    }
  }
  const orphans = {};
  for (const [n, f] of Object.entries(files)) if (!f.users.length) orphans[n] = prev.orphans?.[n] ?? new Date().toISOString();
  const total = Object.values(files).reduce((s, f) => s + f.bytes, 0);
  const index = {
    note: "星願物語版本化共用資產。檔名＝內容 SHA-1，已發布不覆寫；users＝引用此檔案的「預覽/原路徑」。orphans＝沒有任何預覽引用的檔案與開始時間（超過 7 天且經使用者確認後才可清理）。",
    version: VER,
    updatedAt: new Date().toISOString(),
    totalBytes: total,
    previews: perPreview,
    files,
    orphans,
  };
  mkdirSync(join(pages, SHARED), { recursive: true });
  writeFileSync(join(pages, SHARED, "index.json"), JSON.stringify(index, null, 1));
  return index;
}

if (cmd === "publish") {
  if (!okDir(dir)) die(`invalid preview dir: ${dir}`);
  const root = join(pages, dir);
  const protectedFiles = referencedByOthers(dir);
  // 已經指向共用區、而且原檔案已不在自己資料夾的項目保留（重複執行不會遺失對應）
  const remap = {};
  for (const [k, v] of Object.entries(readRemap(dir))) {
    const target = posix(relative(pages, normalize(join(root, v))));
    if (target.startsWith(`${SHARED}/`) && !existsSync(join(root, k)) && existsSync(join(pages, target))) remap[k] = v;
  }
  let moved = 0, deduped = 0, kept = 0, keptRef = 0, saved = 0;
  for (const f of walk(root)) {
    const r = posix(relative(root, f));
    if (!EXT.test(r) || r.startsWith("ci-report/")) continue;
    const size = statSync(f).size;
    if (size < MIN) {
      kept += size;
      continue;
    }
    if (protectedFiles.has(r)) {
      keptRef += size; // 其他預覽還指向這裡 → 先不搬
      continue;
    }
    const h = sha1(f);
    const ext = r.slice(r.lastIndexOf(".")).toLowerCase();
    const dest = join(pages, SHARED, VER, h.slice(0, 2), `${h}${ext}`);
    if (existsSync(dest)) {
      if (sha1(dest) !== h) die(`shared asset corrupted (hash mismatch), refusing: ${dest}`);
      unlinkSync(f);
      deduped++;
      saved += size;
    } else {
      mkdirSync(dirname(dest), { recursive: true });
      renameSync(f, dest);
      moved++;
    }
    remap[r] = posix(relative(root, dest));
  }
  writeFileSync(
    join(root, "asset-remap.json"),
    JSON.stringify({ note: `星願物語共用資產（/${SHARED}/${VER}/，檔名＝內容 SHA-1）。遊戲開機時讓 Babylon 改從共用區讀取。`, sharedAssets: `${SHARED}/${VER}`, files: remap }, null, 1),
  );
  const idx = buildIndex();
  console.log(`${dir}: ${Object.keys(remap).length} 個資產改讀共用區（新放入 ${moved}、與既有內容相同 ${deduped}、省下 ${(saved / 1048576).toFixed(1)} MB）；` + `其他預覽仍引用而暫留 ${protectedFiles.size} 個（${(keptRef / 1048576).toFixed(1)} MB）；小檔案留在原處 ${(kept / 1048576).toFixed(1)} MB；共用區合計 ${(idx.totalBytes / 1048576).toFixed(1)} MB、${Object.keys(idx.files).length} 個檔案`);
} else if (cmd === "preserve-save") {
  if (!okDir(dir) || !tmp) die("usage: preserve-save <pages> <dir> <tmp>");
  const refs = referencedByOthers(dir);
  mkdirSync(tmp, { recursive: true });
  const list = [];
  for (const [r, users] of refs) {
    const src = join(pages, dir, r);
    if (!existsSync(src)) continue;
    mkdirSync(dirname(join(tmp, r)), { recursive: true });
    copyFileSync(src, join(tmp, r));
    list.push({ file: r, users: [...users] });
  }
  writeFileSync(join(tmp, ".preserve.json"), JSON.stringify(list, null, 1));
  console.log(`${dir}: 其他預覽引用的檔案 ${list.length} 個已暫存${list.length ? `（${[...new Set(list.flatMap((x) => x.users))].join("、")}）` : ""}`);
} else if (cmd === "preserve-restore") {
  if (!okDir(dir) || !tmp) die("usage: preserve-restore <pages> <dir> <tmp>");
  const p = join(tmp, ".preserve.json");
  const list = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : [];
  let restored = 0;
  for (const { file } of list) {
    const dest = join(pages, dir, file);
    if (existsSync(dest)) continue; // 新建置有同名檔案 → 以新建置為準（同一路徑內容若改變，引用方會讀到新內容；改用共用區即可避免）
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(tmp, file), dest);
    restored++;
  }
  console.log(`${dir}: 放回其他預覽引用、但新建置沒有的檔案 ${restored} 個`);
} else if (cmd === "index") {
  const idx = buildIndex();
  console.log(`共用區 ${Object.keys(idx.files).length} 個檔案、${(idx.totalBytes / 1048576).toFixed(1)} MB；未被引用 ${Object.keys(idx.orphans).length} 個`);
} else if (cmd === "verify") {
  let bad = 0;
  for (const f of walk(join(pages, SHARED, VER))) {
    const name = f.split(sep).pop();
    if (sha1(f) !== name.slice(0, 40)) {
      bad++;
      console.log(`✗ 內容與檔名雜湊不符：${posix(relative(pages, f))}`);
    }
  }
  let links = 0;
  for (const t of previews()) {
    for (const [k, v] of Object.entries(readRemap(t))) {
      links++;
      if (!existsSync(normalize(join(pages, t, v)))) {
        bad++;
        console.log(`✗ ${t}/${k} → ${v} 不存在`);
      }
    }
  }
  console.log(`${bad ? "✗" : "✓"} 共用資產檢查：${links} 個連結、${bad} 個問題`);
  process.exit(bad ? 1 : 0);
} else die(`unknown command: ${cmd}`);
