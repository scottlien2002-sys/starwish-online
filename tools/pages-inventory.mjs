// GitHub Pages 容量盤點與依賴檢查（唯讀，不改任何檔案）。
// 用法：
//   node tools/pages-inventory.mjs <gh-pages 目錄>                 → 各預覽容量、擁有部門、共用依賴、重複檔案、CI 截圖
//   node tools/pages-inventory.mjs <gh-pages 目錄> --check <資料夾>  → 刪除／重新部署這個資料夾前的檢查：哪些預覽依賴它的哪些檔案
//   加 --json 輸出 JSON
// 依賴來源：各預覽的 asset-remap.json（Claude D Stage 8.1、Claude A Stage 7.4 的共用資產機制），
// 以及 JS／HTML／JSON 內直接寫出的 preview-xxx 路徑。
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, normalize, relative, sep } from "node:path";

const pages = process.argv[2];
const args = process.argv.slice(3);
const asJson = args.includes("--json");
const checkIdx = args.indexOf("--check");
const checkDir = checkIdx >= 0 ? args[checkIdx + 1] : null;
if (!pages || !existsSync(pages)) {
  console.error("usage: pages-inventory.mjs <gh-pages dir> [--check <preview-dir>] [--json]");
  process.exit(2);
}
const OWNER = (name, branch = "") => {
  if (/combat-vfx/.test(name + branch)) return "C";
  if (/^preview-mp\d|multiplayer/.test(name + branch)) return "D";
  if (/village|map-/.test(name)) return "B";
  if (/stage\d/.test(name)) return "A";
  return "?";
};
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === ".git" ? [] : walk(join(d, e.name))) : [join(d, e.name)]));
const rel = (p) => relative(pages, p).split(sep).join("/");
const tops = readdirSync(pages).filter((t) => t !== ".git" && statSync(join(pages, t)).isDirectory()).sort();
const folders = {};
const byHash = new Map();
for (const t of tops) {
  const f = { name: t, bytes: 0, files: 0, ciReportBytes: 0, screenshotBytes: 0, branch: null, commit: null, builtAt: null, remap: null, owner: "?" };
  for (const p of walk(join(pages, t))) {
    const s = statSync(p).size;
    f.bytes += s;
    f.files++;
    const r = rel(p);
    if (r.includes("/ci-report/")) {
      f.ciReportBytes += s;
      if (/\.(png|jpe?g|webm|mp4)$/i.test(r)) f.screenshotBytes += s;
    }
    if (s >= 64 * 1024) {
      const h = createHash("sha1").update(readFileSync(p)).digest("hex");
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push({ folder: t, path: r, bytes: s });
    }
  }
  const pj = join(pages, t, "preview.json");
  if (existsSync(pj)) {
    try {
      const j = JSON.parse(readFileSync(pj, "utf8"));
      Object.assign(f, { branch: j.branch ?? null, commit: j.commit ?? null, builtAt: j.builtAt ?? null });
    } catch {}
  }
  const rm = join(pages, t, "asset-remap.json");
  if (existsSync(rm)) {
    try {
      f.remap = JSON.parse(readFileSync(rm, "utf8")).files ?? {};
    } catch {}
  }
  f.owner = t.startsWith("preview-") ? OWNER(t, f.branch ?? "") : t === "shared-assets" ? "共用" : "main";
  folders[t] = f;
}
// 依賴：asset-remap.json
const deps = []; // { from, to, file, target, bytes, exists }
for (const f of Object.values(folders)) {
  for (const [k, v] of Object.entries(f.remap ?? {})) {
    const target = normalize(join(pages, f.name, v));
    const to = rel(target).split("/")[0];
    const exists = existsSync(target);
    deps.push({ from: f.name, to, file: k, target: rel(target), bytes: exists ? statSync(target).size : 0, exists });
  }
}
// 依賴：程式碼內直接寫出的其他預覽路徑
const textRefs = [];
for (const t of tops) {
  for (const p of walk(join(pages, t))) {
    if (t === "shared-assets") continue;
    if (!/\.(js|html|json)$/.test(p) || p.endsWith("asset-remap.json") || p.endsWith("preview.json") || statSync(p).size > 20e6) continue;
    const txt = readFileSync(p, "utf8");
    for (const m of new Set(txt.match(/preview-[a-z0-9-]+/g) ?? [])) if (m !== t && folders[m]) textRefs.push({ from: t, to: m, in: rel(p) });
  }
}
let dupBytes = 0;
for (const l of byHash.values()) if (l.length > 1) dupBytes += l[0].bytes * (l.length - 1);
const total = Object.values(folders).reduce((s, f) => s + f.bytes, 0);
const MB = (b) => Math.round((b / 1e6) * 10) / 10;

if (checkDir) {
  const d = deps.filter((x) => x.to === checkDir);
  const t = textRefs.filter((x) => x.to === checkDir);
  const out = { folder: checkDir, exists: !!folders[checkDir], dependents: [...new Set([...d.map((x) => x.from), ...t.map((x) => x.from)])], files: d.map((x) => x.target), textRefs: t, safeToDelete: d.length === 0 && t.length === 0 };
  if (asJson) console.log(JSON.stringify(out, null, 1));
  else {
    console.log(`${checkDir}：${out.safeToDelete ? "沒有其他預覽依賴（仍需擁有部門確認）" : `被 ${out.dependents.join("、")} 依賴，不能直接刪除或重新部署`}`);
    for (const x of d) console.log(`  ${x.from} → ${x.target}（${MB(x.bytes)} MB）`);
    for (const x of t) console.log(`  ${x.from} 程式內引用（${x.in}）`);
  }
  process.exit(out.safeToDelete ? 0 : 1);
}

const broken = deps.filter((x) => !x.exists);
const report = {
  totalMB: MB(total),
  duplicateMB: MB(dupBytes),
  folders: Object.values(folders).map((f) => ({ name: f.name, owner: f.owner, MB: MB(f.bytes), files: f.files, ciReportMB: MB(f.ciReportBytes), screenshotsMB: MB(f.screenshotBytes), branch: f.branch, commit: f.commit?.slice(0, 8) ?? null, builtAt: f.builtAt, sharesFrom: [...new Set(deps.filter((x) => x.from === f.name).map((x) => x.to))], usedBy: [...new Set(deps.filter((x) => x.to === f.name).map((x) => x.from))] })),
  dependencies: Object.entries(deps.reduce((a, x) => ((a[`${x.from} → ${x.to}`] ??= { files: 0, MB: 0 }), a[`${x.from} → ${x.to}`].files++, (a[`${x.from} → ${x.to}`].MB += x.bytes / 1e6), a), {})).map(([k, v]) => ({ link: k, files: v.files, MB: Math.round(v.MB * 10) / 10 })),
  textRefs,
  broken,
};
if (asJson) console.log(JSON.stringify(report, null, 1));
else {
  console.log(`gh-pages 合計 ${report.totalMB} MB；重複檔案（≥64 KB）${report.duplicateMB} MB；斷掉的共用連結 ${broken.length}`);
  console.log("資料夾｜部門｜MB｜其中 CI 截圖 MB｜分支 commit｜共用來源｜被誰依賴");
  for (const f of report.folders.sort((a, b) => b.MB - a.MB)) console.log(`${f.name}｜${f.owner}｜${f.MB}｜${f.screenshotsMB}｜${f.branch ?? "-"} ${f.commit ?? ""}｜${f.sharesFrom.join(",") || "-"}｜${f.usedBy.join(",") || "-"}`);
  console.log("依賴：");
  for (const d of report.dependencies) console.log(`  ${d.link}：${d.files} 個檔案、${d.MB} MB`);
  if (textRefs.length) console.log("程式內直接引用：", textRefs);
}
