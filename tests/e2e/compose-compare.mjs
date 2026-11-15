// 把前後兩版的截圖並排成比較圖
// 用法：node tests/e2e/compose-compare.mjs <beforeDir> <afterDir> <outDir> <beforeLabel> <afterLabel>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadPlaywright } from "./static-server.mjs";

const [beforeDir, afterDir, outDir, beforeLabel = "修改前", afterLabel = "修改後"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const after = JSON.parse(readFileSync(`${afterDir}/shots.json`, "utf8"));
const before = JSON.parse(readFileSync(`${beforeDir}/shots.json`, "utf8"));

const img = (dir, name) => {
  const f = `${dir}/${name}.png`;
  return existsSync(f) ? `data:image/png;base64,${readFileSync(f).toString("base64")}` : "";
};

const pw = await loadPlaywright();
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 400 }, deviceScaleFactor: 1 });

const css = `body{margin:0;background:#eef2ff;font-family:"Noto Sans CJK TC","Noto Sans TC",sans-serif;color:#2c2850}
.row{display:flex;gap:16px;padding:14px 16px;align-items:flex-start}
.cell{flex:1;background:#fff;border-radius:12px;padding:8px;box-shadow:0 2px 8px rgba(60,50,120,.15)}
.cell img{width:100%;display:block;border-radius:8px}
.lab{font-weight:800;font-size:18px;margin:2px 4px 6px}
h1{font-size:22px;margin:14px 16px 0}`;

const pairs = after.shots.map((s) => ({ ...s, b: before.shots.find((x) => x.name === s.name) }));
for (const p of pairs) {
  await page.setContent(`<style>${css}</style><h1>星露啵啵：${p.caption}</h1><div class="row">
    <div class="cell"><div class="lab">${beforeLabel}（${p.b?.state ?? "-"}）</div><img src="${img(beforeDir, p.name)}"></div>
    <div class="cell"><div class="lab">${afterLabel}（${p.state}）</div><img src="${img(afterDir, p.name)}"></div></div>`);
  await page.screenshot({ path: `${outDir}/${p.name}.png`, fullPage: true });
}
writeFileSync(`${outDir}/index.json`, JSON.stringify({ beforeLabel, afterLabel, pairs: pairs.map((p) => p.name), beforeErrors: before.errors, afterErrors: after.errors }, null, 2));
console.log(`composed ${pairs.length} comparisons → ${outDir}`);
await browser.close();
