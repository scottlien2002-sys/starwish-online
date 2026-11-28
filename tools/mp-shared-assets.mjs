// Stage 8.3（Claude D）：共用資產目錄規劃與遷移測試。
//
// 目前多人預覽靠 asset-remap.json 指到「其他部門的預覽資料夾」（preview-stage71-world、preview-stage72-world、preview-combat-vfx…），
// 那些資料夾被重新部署或刪除時，多人預覽就會缺檔。規劃：建立獨立、有版本的共用資產目錄 /shared-assets/v<N>/，
// 內容以 SHA-1 鎖定（manifest.json），各預覽只引用，不再互相依賴。
//
//   node tools/mp-shared-assets.mjs plan  <dist> <out.json>        依賴清單＋容量估算（不改任何檔案）
//   node tools/mp-shared-assets.mjs stage <dist> <root> [v1]       在 <root> 模擬 gh-pages：
//        <root>/shared-assets/v1/…（共用檔＋manifest.json）＋<root>/preview-mp84/（不含共用檔，asset-remap.json 指向共用目錄）
//        之後用 MP_E2E_ROOT=<root> MP_E2E_PATH=preview-mp84 跑 E2E＝遷移測試
// 只在暫存目錄操作；不刪除、不修改 gh-pages 上任何其他部門的預覽。
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const [cmd, dist, out, ver = "v1"] = process.argv.slice(2);
if (!cmd || !dist || !out) {
  console.error("usage: mp-shared-assets.mjs plan|stage <dist> <out> [version]");
  process.exit(2);
}
const EXT = /\.(glb|png|jpe?g|ktx2|env)$/i;
const MIN = 256 * 1024;
// 與部署步驟相同的清理規則：預覽用不到的舊版模型不發布
const UNUSED = [/^models\/novice_c10b(1|2|3|4|5|5a)?_/, /^models\/novice_(male|female)_v1_/, /^models\/bobo_v(3|31|33|34|35|36|37|38)_/, /^models\/village-p3\/.*_s62\.glb$/, /^models\/village-p3\/p30_sample_/];
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const sha = (f) => createHash("sha1").update(readFileSync(f)).digest("hex");

/** 檔案來源（哪個部門的交付物；用路徑判斷） */
function owner(rel) {
  if (/^models\/novice_c10b5b_/.test(rel)) return { group: "角色 C1.0-B5b（Claude A／Blender CI）", key: "characters/novice-c10b5b" };
  if (/^models\/novice-modular|^models\/modular/.test(rel)) return { group: "Tripo 模組化初心者（已封存，預覽不使用）", key: "archived/novice-modular" };
  if (/^models\/bobo_v38r_/.test(rel)) return { group: "M001 星露啵啵 V3.8R（Claude A）", key: "monsters/m001-bobo-v38r" };
  if (/^models\/monsters\/m00(\d)\//.test(rel)) return { group: `M00${/m00(\d)/.exec(rel)[1]} 骨骼動畫怪物（怪物製作分支）`, key: `monsters/m00${/m00(\d)/.exec(rel)[1]}` };
  if (/^models\/monsters\/_fixture/.test(rel)) return { group: "怪物接口測試替身（只供自動測試）", key: "test/fixtures" };
  if (/^models\/village-npc/.test(rel)) return { group: "星芽村 NPC（Claude B）", key: "village/npc" };
  if (/^models\/village-p3\//.test(rel)) return { group: "星芽村建築與道具（Claude B）", key: "village/p3" };
  if (/^models\/village/.test(rel)) return { group: "星芽村其他（Claude B）", key: "village/misc" };
  if (/^models\/(field|starsprout)/.test(rel)) return { group: "星芽原野（Claude A）", key: "field" };
  if (/^models\/pets?/.test(rel)) return { group: "寵物（Claude A）", key: "pets" };
  return { group: "其他", key: "misc" };
}

const files = walk(dist)
  .map((f) => ({ f, rel: relative(dist, f).split(sep).join("/") }))
  .filter(({ rel }) => EXT.test(rel))
  .map(({ f, rel }) => ({ f, rel, bytes: statSync(f).size, unused: UNUSED.some((r) => r.test(rel)) }));
const shared = files.filter((x) => !x.unused && x.bytes >= MIN);
const small = files.filter((x) => !x.unused && x.bytes < MIN);
const unused = files.filter((x) => x.unused);
const byGroup = {};
for (const x of shared) {
  const o = owner(x.rel);
  (byGroup[o.group] ??= { key: o.key, files: 0, bytes: 0 }).files++;
  byGroup[o.group].bytes += x.bytes;
}
const MB = (b) => +(b / 1048576).toFixed(1);

if (cmd === "plan") {
  const list = shared.map((x) => ({ path: x.rel, bytes: x.bytes, sha1: sha(x.f), group: owner(x.rel).group, sharedPath: `shared-assets/${ver}/${x.rel}` }));
  const plan = {
    note: "Stage 8.3 共用資產目錄規劃（Claude D）：依賴清單與容量估算。數字由 tools/mp-shared-assets.mjs 從 build 結果計算。",
    version: ver,
    totals: { previewAllMB: MB(files.reduce((s, x) => s + x.bytes, 0)), unusedOldModelsMB: MB(unused.reduce((s, x) => s + x.bytes, 0)), sharedCandidatesMB: MB(shared.reduce((s, x) => s + x.bytes, 0)), sharedCandidates: shared.length, keptInPreviewSmallMB: MB(small.reduce((s, x) => s + x.bytes, 0)) },
    groups: Object.fromEntries(Object.entries(byGroup).map(([g, v]) => [g, { ...v, mb: MB(v.bytes) }])),
    files: list,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(plan, null, 1));
  console.log(JSON.stringify(plan.totals), Object.entries(plan.groups).map(([g, v]) => `${g}: ${v.files} 檔 ${v.mb} MB`).join("；"));
} else if (cmd === "stage") {
  const root = out;
  rmSync(root, { recursive: true, force: true });
  const sdir = join(root, "shared-assets", ver);
  const PDIR = process.env.MP_PREVIEW_DIR ?? "preview-mp84";
  const pdir = join(root, PDIR);
  mkdirSync(sdir, { recursive: true });
  cpSync(dist, pdir, { recursive: true });
  for (const x of unused) rmSync(join(pdir, x.rel), { force: true });
  const manifest = { version: ver, note: "共用資產（內容以 SHA-1 鎖定；新版本另開 v2，不覆蓋）", files: {} };
  const remap = {};
  for (const x of shared) {
    const dst = join(sdir, x.rel);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(x.f, dst);
    manifest.files[x.rel] = { sha1: sha(x.f), bytes: x.bytes, group: owner(x.rel).group };
    rmSync(join(pdir, x.rel), { force: true });
    remap[x.rel] = `../shared-assets/${ver}/${x.rel}`;
  }
  writeFileSync(join(sdir, "manifest.json"), JSON.stringify(manifest, null, 1));
  writeFileSync(join(pdir, "asset-remap.json"), JSON.stringify({ note: `Stage 8.3 遷移測試：大型模型改從 /shared-assets/${ver}/ 讀取`, sources: [`shared-assets/${ver}`], files: remap }, null, 1));
  const pBytes = walk(pdir).reduce((s, f) => s + statSync(f).size, 0);
  console.log(`staged: shared-assets/${ver} ${shared.length} files ${MB(shared.reduce((s, x) => s + x.bytes, 0))} MB; ${PDIR} ${MB(pBytes)} MB`);
} else {
  console.error("unknown command");
  process.exit(2);
}
