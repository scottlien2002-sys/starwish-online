// 在瀏覽器（Chromium）中執行 face.ts 的 paintFace，輸出三種表情貼圖與「貼回正面輪廓」的預覽。
// 不需 Babylon / Vite：以 Node 內建的 stripTypeScriptTypes 把 shape.ts、face.ts 轉成瀏覽器可載入的 ES 模組。
// 用法：node tests/harness/bobo-face-preview.mjs → test-results/bobo-face.png
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { loadPlaywright } from "../e2e/static-server.mjs";

const root = new URL("../../", import.meta.url);
const read = (p) => stripTypeScriptTypes(readFileSync(new URL(p, root), "utf8"), { mode: "strip" });
const shape = read("src/monsters/star-dew-bobo/shape.ts");
const face = read("src/monsters/star-dew-bobo/face.ts").replace('from "./shape.ts"', 'from "shape"');

const html = `<!doctype html><html><body style="margin:0;background:#eef3ff;font:16px sans-serif">
<script type="importmap">{"imports":{"shape":"data:text/javascript;base64,${Buffer.from(shape).toString("base64")}"}}</script>
<div id="out"></div>
<script type="module">
import * as F from "data:text/javascript;base64,${Buffer.from(face).toString("base64")}";
import { profileR, profileY } from "shape";
const W = F.faceHalfWidth();
const tw = 512, th = F.faceTextureHeight(tw, W);
const out = document.getElementById("out");
for (const ex of ["normal", "angry", "hurt"]) {
  const cv = document.createElement("canvas"); cv.width = tw; cv.height = th;
  F.paintFace(cv.getContext("2d"), tw, th, ex, W);
  // 正面輪廓 + 貼圖疊回（正面投影的逆）
  const S = 300, pad = 20;
  const p = document.createElement("canvas"); p.width = S * 1.5 + pad * 2; p.height = S * 1.15 + pad * 2;
  const c = p.getContext("2d");
  const cx = p.width / 2, base = p.height - pad;
  c.beginPath();
  for (let t = 0; t <= 1.0001; t += 0.01) c.lineTo(cx + profileR(t) * S, base - profileY(t) * S);
  for (let t = 1; t >= -0.0001; t -= 0.01) c.lineTo(cx - profileR(t) * S, base - profileY(t) * S);
  const g = c.createRadialGradient(cx - 40, base - 220, 10, cx, base - 150, 260);
  g.addColorStop(0, "#c4f2ff"); g.addColorStop(1, "#4d86f0");
  c.fillStyle = g; c.fill();
  c.drawImage(cv, cx - W * S, base - F.FACE_PATCH.y1 * S, 2 * W * S, (F.FACE_PATCH.y1 - F.FACE_PATCH.y0) * S);
  const box = document.createElement("div"); box.style.cssText = "display:inline-block;margin:8px;text-align:center";
  const tex = cv; tex.style.cssText = "display:block;width:256px;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/16px 16px;margin:6px auto";
  box.append(p, tex, Object.assign(document.createElement("div"), { textContent: ex }));
  out.append(box);
}
const geo = F.buildFacePatch(8, 10);
window.__geo = { verts: geo.positions.length / 3, tris: geo.indices.length / 3, W };
window.__done = true;
</script></body></html>`;

const pw = await loadPlaywright();
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1520, height: 640 } });
page.on("pageerror", (e) => console.error("pageerror", e.message));
await page.setContent(html);
await page.waitForFunction(() => window.__done === true, null, { timeout: 10000 });
console.log(await page.evaluate(() => window.__geo));
mkdirSync(new URL("test-results/", root), { recursive: true });
writeFileSync(new URL("test-results/bobo-face.png", root), await page.screenshot());
await browser.close();
console.log("written test-results/bobo-face.png");
