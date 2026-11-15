// 以模型實際使用的幾何數據，畫出星露啵啵正面/側面比例藍圖（不需 Babylon，用於比對設定圖比例）
// 用法：node tests/harness/bobo-blueprint.mjs → test-results/bobo-blueprint.png
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright } from "../e2e/static-server.mjs";
import { ANTENNA_POINTS, ANTENNA_SIDE, BODY_HEIGHT, FACE_LAYOUT as L, HEAD_STAR_POS, profileR, profileY, surfacePoint } from "../../src/monsters/star-dew-bobo/shape.ts";

const S = 230; // 每單位像素
const W = 1000;
const H = 560;
const base = 470;

const outline = (cx, axis) => {
  const pts = [];
  for (let t = 0; t <= 1.0001; t += 0.01) pts.push([cx + profileR(t) * S, base - profileY(t) * S]);
  for (let t = 1; t >= -0.0001; t -= 0.01) pts.push([cx - profileR(t) * S, base - profileY(t) * S]);
  return `<path d="M${pts.map((p) => p.join(",")).join(" L")} Z" fill="url(#g)" stroke="#5b7fe0" stroke-width="3"/>` + axis;
};

// 觸角路徑（與模型相同的控制點，未做樣條平滑）。
// 正面藍圖以「觀看者畫面」繪製：世界 x 在正面看時左右相反，故畫面 x = -世界 x。
const antenna = ANTENNA_POINTS.map(([x, y, z]) => [-(x * ANTENNA_SIDE), y, z]);
const topY = profileY(1) - 0.04;

const star = (x, y, r, fill = "#ffd84a") => {
  const p = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.48 : r;
    p.push(`${x + Math.cos(a) * rr},${y + Math.sin(a) * rr}`);
  }
  return `<polygon points="${p.join(" ")}" fill="${fill}" stroke="#e0a800" stroke-width="2"/>`;
};

// 正面（x-y）
const FX = 260;
let front = outline(FX, "");
front += `<polyline points="${antenna.map(([x, y]) => `${FX + x * S},${base - (topY + y) * S}`).join(" ")}" fill="none" stroke="#7fa6f5" stroke-width="12" stroke-linecap="round"/>`;
front += star(FX - HEAD_STAR_POS[0] * ANTENNA_SIDE * S, base - (topY + HEAD_STAR_POS[1]) * S, 0.15 * S);
for (const side of [-1, 1]) {
  const e = surfacePoint(L.eye.y, side * L.eye.theta);
  front += `<ellipse cx="${FX + e.x * S}" cy="${base - e.y * S}" rx="${0.095 * S}" ry="${0.12 * S}" fill="#101a52"/>`;
  front += `<ellipse cx="${FX + e.x * S}" cy="${base - (e.y - 0.055) * S}" rx="${0.065 * S}" ry="${0.045 * S}" fill="#2e73ff"/>`;
  front += `<circle cx="${FX + (e.x - 0.035) * S}" cy="${base - (e.y + 0.05) * S}" r="${0.037 * S}" fill="#fff"/>`;
  const b = surfacePoint(L.blush.y, side * L.blush.theta);
  front += `<ellipse cx="${FX + b.x * S}" cy="${base - b.y * S}" rx="${0.087 * S}" ry="${0.05 * S}" fill="#ff8fa6" opacity="0.75"/>`;
  const w = surfacePoint(L.wing.y, side * L.wing.theta);
  front += `<ellipse cx="${FX + (w.x + side * 0.17) * S}" cy="${base - w.y * S}" rx="${0.17 * S}" ry="${0.045 * S}" fill="#a9ccff" opacity="0.8" transform="rotate(${side * 25} ${FX + w.x * S} ${base - w.y * S})"/>`;
}
const m = surfacePoint(L.mouth.y, 0);
front += `<path d="M${FX - 0.075 * S},${base - m.y * S} A${0.075 * S},${0.075 * S} 0 0 0 ${FX + 0.075 * S},${base - m.y * S} Z" fill="#dc4d6b"/>`;
const c = surfacePoint(L.chestStar.y, L.chestStar.theta);
front += star(FX + c.x * S, base - c.y * S, 0.11 * S);

// 側面（z-y，臉朝右）
const SX = 720;
let side = outline(SX, "");
side += `<polyline points="${antenna.map(([, y, z]) => `${SX + z * S},${base - (topY + y) * S}`).join(" ")}" fill="none" stroke="#7fa6f5" stroke-width="12" stroke-linecap="round"/>`;
side += star(SX + HEAD_STAR_POS[2] * S, base - (topY + HEAD_STAR_POS[1]) * S, 0.15 * S);
const se = surfacePoint(L.eye.y, L.eye.theta);
side += `<ellipse cx="${SX + se.z * S}" cy="${base - se.y * S}" rx="${0.04 * S}" ry="${0.12 * S}" fill="#101a52"/>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif">
<defs><radialGradient id="g" cx="45%" cy="40%"><stop offset="0" stop-color="#d6ecff"/><stop offset="0.6" stop-color="#7fb3ff"/><stop offset="1" stop-color="#4f7fe8"/></radialGradient></defs>
<rect width="100%" height="100%" fill="#f6f8ff"/>
<line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="#9aa" stroke-dasharray="6 6"/>
<text x="${FX}" y="${base + 50}" text-anchor="middle" font-size="22" fill="#334">正面（模型幾何）</text>
<text x="${SX}" y="${base + 50}" text-anchor="middle" font-size="22" fill="#334">側面（模型幾何）</text>
<text x="20" y="34" font-size="20" fill="#334">星露啵啵 比例藍圖：身高 ${BODY_HEIGHT}、最寬 ${(2 * Math.max(...Array.from({ length: 101 }, (_, i) => profileR(i / 100)))).toFixed(2)}（模型單位）</text>
${front}${side}</svg>`;

const outDir = new URL("../../test-results/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}bobo-blueprint.svg`, svg);
const pw = await loadPlaywright();
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
await page.screenshot({ path: `${outDir}bobo-blueprint.png` });
await browser.close();
console.log("written", `${outDir}bobo-blueprint.png`);
