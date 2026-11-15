// 把多個版本的截圖並排成比較圖（同名截圖放同一列）
// 用法：node tests/e2e/compose-compare.mjs <outDir> "<標籤>=<截圖資料夾>" "<標籤>=<截圖資料夾>" ...
// 以第一個資料夾的 shots.json 決定要比較哪些截圖
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadPlaywright } from "./static-server.mjs";

const [outDir, ...specs] = process.argv.slice(2);
if (!outDir || specs.length < 2) throw new Error('usage: compose-compare.mjs <outDir> "label=dir" "label=dir" ...');
mkdirSync(outDir, { recursive: true });
const cols = specs.map((s) => {
  const i = s.indexOf("=");
  const dir = s.slice(i + 1);
  const meta = existsSync(`${dir}/shots.json`) ? JSON.parse(readFileSync(`${dir}/shots.json`, "utf8")) : { shots: [], errors: [] };
  return { label: s.slice(0, i), dir, meta };
});

const img = (dir, name) => {
  const f = `${dir}/${name}.png`;
  return existsSync(f) ? `data:image/png;base64,${readFileSync(f).toString("base64")}` : "";
};
const perfLine = (p) => (p ? `Draw ${p.drawCalls}・Mesh ${p.activeMeshes}・${p.pixelRatio}x` : "");

const pw = await loadPlaywright();
const browser = await pw.chromium.launch();
const width = cols.length > 2 ? 1900 : 1400;
const page = await browser.newPage({ viewport: { width, height: 400 }, deviceScaleFactor: 1 });
const css = `body{margin:0;background:#eef2ff;font-family:"Noto Sans CJK TC","Noto Sans TC",sans-serif;color:#2c2850}
.row{display:flex;gap:14px;padding:12px 14px;align-items:flex-start}
.cell{flex:1;background:#fff;border-radius:12px;padding:8px;box-shadow:0 2px 8px rgba(60,50,120,.15)}
.cell img{width:100%;display:block;border-radius:8px}
.lab{font-weight:800;font-size:17px;margin:2px 4px 2px}.sub{font-size:12px;opacity:.7;margin:0 4px 6px}
h1{font-size:21px;margin:12px 14px 0}`;

const base = cols[0].meta.shots;
for (const s of base) {
  const cells = cols
    .map((c) => {
      const m = c.meta.shots.find((x) => x.name === s.name);
      return `<div class="cell"><div class="lab">${c.label}</div><div class="sub">${m ? m.state : "（無此截圖）"}　${perfLine(c.meta.perf)}</div><img src="${img(c.dir, s.name)}"></div>`;
    })
    .join("");
  await page.setContent(`<style>${css}</style><h1>${s.caption}</h1><div class="row">${cells}</div>`);
  await page.screenshot({ path: `${outDir}/${s.name}.png`, fullPage: true });
}
writeFileSync(
  `${outDir}/index.json`,
  JSON.stringify({ columns: cols.map((c) => ({ label: c.label, errors: c.meta.errors, perf: c.meta.perf })), shots: base.map((s) => s.name) }, null, 2),
);
console.log(`composed ${base.length} rows × ${cols.length} columns → ${outDir}`);
await browser.close();
