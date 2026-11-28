// 公開預覽的共用資產檢查（唯讀）：asset-remap.json 每個目標都 200、檔名雜湊與內容一致（抽查）、主要頁面與小檔案 200。
// 用法：node tests/e2e/verify-preview-remap.mjs <預覽網址> [抽查數量]
import { createHash } from "node:crypto";
const [url, sampleArg] = process.argv.slice(2);
const base = url.endsWith("/") ? url : `${url}/`;
const sample = Number(sampleArg ?? 6);
const out = { url: base, checks: [], remap: 0, shared: 0, crossFolder: 0, hashChecked: 0, bad: [] };
const head = async (u) => (await fetch(u, { method: "HEAD", cache: "no-store" })).status;
for (const f of ["", "index.html", "preview.json", "asset-remap.json", "combat-vfx/novice_combat_male.json", "combat-vfx/novice_combat_female.json", "models/monsters/manifest.json"]) {
  const s = await head(base + f);
  out.checks.push([s, f]);
  if (s !== 200) out.bad.push(`${s} ${f}`);
}
const map = await (await fetch(base + "asset-remap.json", { cache: "no-store" })).json();
const files = Object.entries(map.files ?? {});
out.remap = files.length;
let i = 0;
for (const [k, v] of files) {
  const target = new URL(v, base).href;
  if (v.includes("shared-assets/")) out.shared++;
  else out.crossFolder++;
  const s = await head(target);
  if (s !== 200) out.bad.push(`${s} ${k} → ${v}`);
  if (v.includes("shared-assets/") && i++ < sample) {
    const buf = Buffer.from(await (await fetch(target, { cache: "no-store" })).arrayBuffer());
    const h = createHash("sha1").update(buf).digest("hex");
    out.hashChecked++;
    if (!v.includes(h)) out.bad.push(`hash mismatch ${v} (${h})`);
  }
}
console.log(JSON.stringify(out, null, 1));
process.exit(out.bad.length ? 1 : 0);
