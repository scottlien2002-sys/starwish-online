// Claude D：把 GitHub Pages 上 preview-mp81／preview-mp82 引用的 12 個 Claude C 檔案，
// 從 C 的 Stage 1 預覽資料夾（../preview-combat-vfx/…）改指向正式共用資產（../shared-assets/v1/<前兩碼>/<SHA-1>.glb）。
// 依據：Project 文件 claude/Starwish_CombatVFX_SharedAssets_Handover_A_D.md（Claude C，2026-11-28）。
//
// 只改兩個 asset-remap.json 的目標路徑；遊戲程式、模型檔、其他預覽都不動。
// ⚠ 本工具本身不會推送 gh-pages。正式套用（apply）必須在 Claude A 確認後，由 A 的部署流程執行。
//
//   node tools/mp-pages-c-migration.mjs verify   <gh-pages ref> <outDir>
//        從 gh-pages 讀出 12 個舊檔與共用區新檔，逐一比對大小、SHA-1、glTF 標頭；產生新 asset-remap.json、備份原檔、verify.json
//   node tools/mp-pages-c-migration.mjs stage    <gh-pages ref> <root> migrated|original <outDir>
//        在 <root> 模擬 gh-pages（只解出 mp81／mp82 與它們引用的檔案）。migrated＝套用新對照、完全不放 preview-combat-vfx
//   node tools/mp-pages-c-migration.mjs audit    <root> <requestLog.json> <preview> <outDir>
//        檢查瀏覽器實際請求：沒有 404、沒有讀 preview-combat-vfx、對照表每個目標都能取得且 SHA-1 正確
//   node tools/mp-pages-c-migration.mjs apply    <gh-pages 工作目錄> <outDir>     （A 部署時用）
//   node tools/mp-pages-c-migration.mjs rollback <gh-pages 工作目錄> <outDir>     （回退：放回原本的兩個 asset-remap.json）
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";

const PREVIEWS = ["preview-mp81", "preview-mp82"];
const OLD_PREFIX = "../preview-combat-vfx/";
/** Claude C 交接文件第 1 節的 12 個檔案（原路徑 → SHA-1） */
const HANDOVER = {
  "models/monsters/m004/M004_WindfeatherFox_Rig_V1_1_HQ.glb": "229e4ae4b971f425ca975ea69ce95be60a975b71",
  "models/monsters/m004/M004_WindfeatherFox_Rig_V1_1_Lite.glb": "0ddb81e292b95319f6653c9f7e05a779f7769b95",
  "models/monsters/m005/M005_NebulaSheep_Rig_V1_HQ.glb": "919123953a8804e39d583469736209a2b7b61928",
  "models/monsters/m005/M005_NebulaSheep_Rig_V1_Lite.glb": "b6e235fc9173a946306645fa99cb2a29461cc5e2",
  "models/monsters/m006/M006_CarrotKing_Rig_V1_HQ.glb": "4b0d338eff8cb54741a11dabd87d5321ee00a54d",
  "models/monsters/m006/M006_CarrotKing_Rig_V1_Lite.glb": "4c45b24c14a7bd664573b1de72e8947c850c9ba5",
  "models/monsters/m007/M007_CrownHammerRabbit_Rig_V1_HQ.glb": "d9a42b008a8a582803427d57d38ebdea79ca6a0d",
  "models/monsters/m007/M007_CrownHammerRabbit_Rig_V1_Lite.glb": "a35c37164de3715f72a911713c6e3211204e5ade",
  "models/novice_c10b5b_female_hq.glb": "91e095b457c4d6e5bde91267e9c03573762e3a98",
  "models/novice_c10b5b_female_lite.glb": "9245d7801570a6f3b44f11446aa2c70c0c1c5a9c",
  "models/novice_c10b5b_male_hq.glb": "1d7777b5f502d7d9645444b0cacaaf2460298867",
  "models/novice_c10b5b_male_lite.glb": "4f4947e0778044ef0cade4aae861abed4ab7fff3",
};
const sharedPath = (sha) => `shared-assets/v1/${sha.slice(0, 2)}/${sha}.glb`;
const sha1 = (b) => createHash("sha1").update(b).digest("hex");
const git = (args, opts = {}) => execFileSync("git", args, { maxBuffer: 1 << 30, ...opts });
const blob = (ref, p) => git(["show", `${ref}:${p}`]);
const fail = (m) => {
  console.error("FAIL " + m);
  process.exit(1);
};

/** glTF 2.0 二進位標頭：magic、版本、總長度＝檔案大小、第一個區塊是 JSON；回傳可比較的摘要 */
function glbInfo(b) {
  if (b.length < 20 || b.readUInt32LE(0) !== 0x46546c67) return { ok: false, why: "not glb" };
  const version = b.readUInt32LE(4);
  const length = b.readUInt32LE(8);
  const jsonLen = b.readUInt32LE(12);
  const jsonType = b.readUInt32LE(16);
  if (version !== 2 || length !== b.length || jsonType !== 0x4e4f534a) return { ok: false, why: `header v${version} len${length}/${b.length}` };
  const j = JSON.parse(b.subarray(20, 20 + jsonLen).toString("utf8").replace(/\0+$/, "").trim());
  return { ok: true, version, meshes: j.meshes?.length ?? 0, materials: j.materials?.length ?? 0, textures: j.textures?.length ?? 0, skins: j.skins?.length ?? 0, animations: (j.animations ?? []).map((a) => a.name), nodes: j.nodes?.length ?? 0 };
}

/** 把一份 asset-remap.json 的 C 項目改成共用路徑（其他項目原封不動） */
function migrateRemap(remap) {
  const out = structuredClone(remap);
  const changed = [];
  for (const [k, v] of Object.entries(out.files ?? {})) {
    if (!v.startsWith(OLD_PREFIX)) continue;
    const rel = v.slice(OLD_PREFIX.length);
    const sha = HANDOVER[rel];
    if (!sha) fail(`${k} → ${v}：不在 C 交接清單（不自行處理）`);
    out.files[k] = `../${sharedPath(sha)}`;
    changed.push({ key: k, from: v, to: out.files[k], sha1: sha });
  }
  out.sources = [...new Set([...(out.sources ?? []).filter((s) => s !== "preview-combat-vfx"), "shared-assets/v1"])];
  out.note = `${remap.note ?? ""}｜2026-11-28 Claude D：C 部門 12 檔改讀正式共用資產 shared-assets/v1（內容 SHA-1 相同），不再依賴 preview-combat-vfx`;
  return { out, changed };
}
const stringify = (o) => JSON.stringify(o, null, 1) + "\n";

const [cmd, a, b, c, d] = process.argv.slice(2);

if (cmd === "verify") {
  const ref = a;
  const outDir = b;
  mkdirSync(join(outDir, "backup"), { recursive: true });
  const report = { ghPages: git(["rev-parse", ref]).toString().trim(), checkedAt: new Date().toISOString(), files: [], previews: {} };
  for (const [rel, sha] of Object.entries(HANDOVER)) {
    const oldB = blob(ref, `preview-combat-vfx/${rel}`);
    const newB = blob(ref, sharedPath(sha));
    const oi = glbInfo(oldB);
    const ni = glbInfo(newB);
    const row = { path: rel, bytes: oldB.length, sha1Old: sha1(oldB), sha1New: sha1(newB), handover: sha, shared: sharedPath(sha), identical: oldB.equals(newB), glb: oi, glbSame: JSON.stringify(oi) === JSON.stringify(ni) };
    row.ok = row.identical && row.sha1Old === sha && row.sha1New === sha && oi.ok && row.glbSame;
    report.files.push(row);
    console.log(`${row.ok ? "OK  " : "FAIL"} ${rel} ${(row.bytes / 1048576).toFixed(2)} MB ${row.sha1Old}`);
  }
  for (const p of PREVIEWS) {
    const raw = blob(ref, `${p}/asset-remap.json`);
    writeFileSync(join(outDir, "backup", `${p}.asset-remap.json`), raw);
    const { out, changed } = migrateRemap(JSON.parse(raw.toString("utf8")));
    mkdirSync(join(outDir, p), { recursive: true });
    writeFileSync(join(outDir, p, "asset-remap.json"), stringify(out));
    // 遊戲程式裡沒有寫死 preview-combat-vfx（只在 asset-remap.json）
    const hard = git(["grep", "-l", "preview-combat-vfx", ref, "--", p], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split("\n").filter(Boolean).filter((l) => !l.endsWith("/asset-remap.json"));
    const left = Object.values(out.files).filter((v) => v.includes("preview-combat-vfx"));
    report.previews[p] = { changed: changed.length, entries: Object.keys(out.files).length, changes: changed, hardcodedRefs: hard, remainingRefs: left.length, backupSha1: sha1(raw) };
    console.log(`${p}: ${changed.length} 項改為共用路徑，其他 ${Object.keys(out.files).length - changed.length} 項不變；程式內寫死路徑 ${hard.length}`);
  }
  report.ok = report.files.every((f) => f.ok) && report.previews["preview-mp81"].changed === 4 && report.previews["preview-mp82"].changed === 12 && PREVIEWS.every((p) => report.previews[p].hardcodedRefs.length === 0 && report.previews[p].remainingRefs === 0);
  writeFileSync(join(outDir, "verify.json"), stringify(report));
  if (!report.ok) fail("verify");
  console.log("verify OK");
} else if (cmd === "stage") {
  const [ref, root, mode, outDir] = [a, b, c, d];
  mkdirSync(root, { recursive: true });
  const paths = new Set(PREVIEWS);
  const remaps = {};
  for (const p of PREVIEWS) {
    remaps[p] = mode === "migrated" ? JSON.parse(readFileSync(join(outDir, p, "asset-remap.json"), "utf8")) : JSON.parse(blob(ref, `${p}/asset-remap.json`).toString("utf8"));
    for (const v of Object.values(remaps[p].files)) paths.add(posix.normalize(posix.join(p, v)));
  }
  if (mode === "migrated" && [...paths].some((x) => x.startsWith("preview-combat-vfx/"))) fail("migrated 仍引用 preview-combat-vfx");
  const tar = git(["archive", "--format=tar", ref, ...paths]);
  execFileSync("tar", ["-x", "-C", root], { input: tar, maxBuffer: 1 << 30 });
  for (const p of PREVIEWS) writeFileSync(join(root, p, "asset-remap.json"), stringify(remaps[p]));
  writeFileSync(join(root, "stage.json"), stringify({ mode, ref: git(["rev-parse", ref]).toString().trim(), paths: paths.size, hasCombatVfxStage1: existsSync(join(root, "preview-combat-vfx")) }));
  console.log(`stage ${mode}: ${paths.size} paths → ${root}（preview-combat-vfx ${existsSync(join(root, "preview-combat-vfx")) ? "有" : "沒有"}）`);
} else if (cmd === "audit") {
  const [root, logFile, preview, outDir] = [a, b, c, d];
  const log = JSON.parse(readFileSync(logFile, "utf8"));
  const remap = JSON.parse(readFileSync(join(root, preview, "asset-remap.json"), "utf8"));
  const bad = log.filter((r) => r.status >= 400 && !/favicon/.test(r.path));
  const stage1 = log.filter((r) => r.path.includes("/preview-combat-vfx/"));
  const shared = log.filter((r) => r.path.startsWith("/shared-assets/v1/"));
  // 每個對照目標都能從預覽資料夾取得，內容 SHA-1 正確（HQ 在 E2E 的 lod=lite 下不會被請求，這裡直接取一次）
  const targets = [];
  for (const [k, v] of Object.entries(remap.files)) {
    const f = posix.normalize(posix.join(preview, v));
    const exp = HANDOVER[k];
    const okFile = existsSync(join(root, f));
    const got = okFile ? sha1(readFileSync(join(root, f))) : null;
    targets.push({ key: k, file: f, exists: okFile, sha1: got, expected: exp ?? null, ok: okFile && (!exp || got === exp) });
  }
  const res = { preview, requests: log.length, errors: bad, stage1Requests: stage1.length, sharedRequests: shared.map((r) => r.path), targets: { total: targets.length, ok: targets.filter((t) => t.ok).length, c: targets.filter((t) => t.expected).length }, badTargets: targets.filter((t) => !t.ok) };
  res.ok = bad.length === 0 && stage1.length === 0 && res.badTargets.length === 0;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `audit-${preview}.json`), stringify(res));
  console.log(`${res.ok ? "PASS" : "FAIL"} ${preview}: 請求 ${log.length}、錯誤 ${bad.length}、讀 Stage 1 ${stage1.length}、共用區 ${shared.length}、對照目標 ${res.targets.ok}/${res.targets.total}`);
  if (!res.ok) process.exit(1);
} else if (cmd === "apply" || cmd === "rollback") {
  const [dir, outDir] = [a, b];
  for (const p of PREVIEWS) {
    const cur = readFileSync(join(dir, p, "asset-remap.json"));
    const backup = readFileSync(join(outDir, "backup", `${p}.asset-remap.json`));
    const next = readFileSync(join(outDir, p, "asset-remap.json"));
    if (cmd === "apply") {
      if (!cur.equals(backup) && !cur.equals(next)) fail(`${p}/asset-remap.json 與備份不同（gh-pages 已被改過），請重新執行 verify`);
      for (const [k, v] of Object.entries(JSON.parse(next.toString("utf8")).files)) {
        if (!HANDOVER[k]) continue;
        const f = join(dir, posix.normalize(posix.join(p, v)));
        if (!existsSync(f) || sha1(readFileSync(f)) !== HANDOVER[k]) fail(`${f} 不存在或 SHA-1 不符`);
      }
      writeFileSync(join(dir, p, "asset-remap.json"), next);
    } else {
      writeFileSync(join(dir, p, "asset-remap.json"), backup);
    }
    console.log(`${cmd} ${p}`);
  }
} else {
  console.error("usage: mp-pages-c-migration.mjs verify|stage|audit|apply|rollback …");
  process.exit(2);
}

