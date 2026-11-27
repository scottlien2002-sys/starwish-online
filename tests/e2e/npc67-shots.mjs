// Stage 6.7（由 art66-shots 複製） 美術截圖（升級前／升級後用同一組鏡頭）：全村鳥瞰、中央廣場與星願之泉、各設施近景、全部 NPC 正面與側面。
// 用法：node tests/e2e/art66-shots.mjs <dist> <輸出資料夾> <標籤 before|after> [畫質 high,medium,low] [瀏覽器 chromium]
// 注意：CI 是無頭瀏覽器＋軟體繪圖，只用來看畫面，FPS 不代表 iPhone 實機。
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";

const distDir = process.argv[2] ?? "dist";
const outDir = process.argv[3] ?? "out/art66";
const label = process.argv[4] ?? "after";
const tiers = (process.argv[5] ?? "high,medium,low").split(",");
const browserName = process.argv[6] ?? "chromium";
// Stage 6.7：額外網址參數（例如 "&npcset=v66" 拍升級前 NPC）
const extraQuery = process.argv[7] ?? "";
mkdirSync(outDir, { recursive: true });

const rad = (d) => (d * Math.PI) / 180;
const polar = (b, r) => ({ x: r * Math.sin(rad(b)), z: r * Math.cos(rad(b)) });
// 與 layout.ts 相同
const BUILDINGS = [
  ["sword", "劍士軍團", 297, 12, 12, 13, 2, 27],
  ["knight", "騎士軍團", 332, 16, 14, 19, 2, 27],
  ["mage", "法師軍團", 26, 13, 13, 20, 2, 27],
  ["church", "祭司教堂", 66, 12, 18, 18, 0, 24],
  ["circus", "小丑馬戲團", 128, 14, 14, 10, 0, 24],
  ["warehouse", "倉庫", 208, 10, 8, 7, 0, 24],
  ["smith", "鐵匠鋪", 240, 12, 10, 11, 0, 24],
  ["guild", "星願商會", 160, 10, 8, 10, 0, 27],
];
/** ArcRotate：鏡頭在 target + r*(cos a sin b, cos b, sin a sin b) */
const alphaFor = (dx, dz) => (Math.atan2(dz, dx) * 180) / Math.PI;

function views() {
  const v = [
    ["aerial_south", [0, 0, -4], alphaFor(0, -1), 52, 92],
    ["aerial_east", [0, 0, 0], alphaFor(0.7, -0.7), 48, 92],
    ["plaza_fountain", [0, 1.4, 0], alphaFor(0, -1), 70, 24],
    ["fountain_close", [0, 2.6, 0], alphaFor(0.35, -1), 80, 12.5],
    ["fountain_water", [0, 0.6, 0], alphaFor(0.2, -1), 58, 9.5],
  ];
  for (const [id, , b, w, d, top, floor, front] of BUILDINGS) {
    const t = polar(b, front + d * 0.35);
    const dir = { x: -Math.sin(rad(b)), z: -Math.cos(rad(b)) };
    const r = Math.max(w * 1.15, top * 1.05) + 4;
    v.push([`bld_${id}`, [t.x, floor + top * 0.42, t.z], alphaFor(dir.x, dir.z), 82, r]);
    const side = { x: dir.x * Math.cos(rad(40)) - dir.z * Math.sin(rad(40)), z: dir.x * Math.sin(rad(40)) + dir.z * Math.cos(rad(40)) };
    v.push([`bld_${id}_q45`, [t.x, floor + top * 0.38, t.z], alphaFor(side.x, side.z), 76, r * 0.95]);
    const e = polar(b, front);
    v.push([`bld_${id}_entry`, [e.x, floor + 2.2, e.z], alphaFor(dir.x, dir.z), 84, 7.5]);
  }
  const bd = polar(158, 19.5);
  v.push(["board", [bd.x, 1.8, bd.z], alphaFor(-Math.sin(rad(158)), -Math.cos(rad(158))), 82, 6.5]);
  v.push(["south_gate", [0, 3.2, -36], alphaFor(0, 1), 80, 15]);
  v.push(["south_portal", [0, 1.5, -44], alphaFor(0.25, 1), 70, 13]);
  v.push(["road_east", [30, 0.8, 0], alphaFor(-1, 0.15), 74, 14]);
  v.push(["platform_stairs", [-8, 1.4, 19], alphaFor(0.25, -1), 72, 14]);
  return v;
}

const pw = await loadPlaywright();
const server = await serve(distDir);
const report = { label, startedAt: new Date().toISOString(), note: "CI 軟體繪圖：只用來看畫面，FPS 不代表 iPhone 實機", runs: [] };
const settle = (page, n = 3) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const browser = await pw[browserName].launch();
for (const tier of tiers) {
  const run = { tier, shots: [], errors: [] };
  report.runs.push(run);
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && run.errors.push(`console: ${m.text()}`));
  const V = (fn, arg) => page.evaluate(fn, arg);
  try {
    await page.goto(server.url + `/?map=village&art=full&quality=${tier}${extraQuery}`, { waitUntil: "load" });
    await page.evaluate(() => { window.__swNoNav = true; });
    await page.waitForFunction(() => window.__starwishVillage?.ready === true, null, { timeout: 120000 });
    await page.waitForFunction(() => { const a = window.__starwishVillage.artFull(); return a.status === "loaded" || a.status.startsWith("部分") || a.status.startsWith("error"); }, null, { timeout: 420000 });
    await page.waitForFunction(() => { const c = window.__starwishVillage.charState(); return c.status === "loaded" || String(c.status).startsWith("error"); }, null, { timeout: 240000, polling: 500 });
    await page.addStyleTag({ content: "*:not(html):not(body):not(canvas){visibility:hidden !important} canvas{visibility:visible !important}" });
    run.art = await V(() => window.__starwishVillage.artFull());
    const shoot = async (name) => {
      await settle(page, 6);
      const f = `${outDir}/${label}_${tier}_${name}.png`;
      await page.screenshot({ path: f, timeout: 120000 }).catch((e) => run.errors.push(`shot ${name}: ${e.message}`));
      run.shots.push(f.split("/").pop());
    };
    const place = async (px, pz) => {
      await V(() => window.__starwishVillage.shotCam(false));
      await V(([x, z]) => window.__starwishVillage.teleport(x, z, 0), [px, pz]);
      await settle(page, 12);
    };
    // 玩家站在南門內側（鳥瞰、廣場、建築截圖時不擋鏡頭；陰影中心在廣場附近）
    await place(0, -12.5);
    for (const [name, t, a, b, r] of views()) {
      if (name.startsWith("bld_") || name === "board" || name.startsWith("south") || name.startsWith("road") || name.startsWith("platform")) {
        // 陰影與 LOD 以玩家為中心：玩家站到該處附近（鏡頭後方）
        const back = { x: t[0] + Math.cos(rad(a)) * Math.min(r, 9), z: t[2] + Math.sin(rad(a)) * Math.min(r, 9) };
        const ok = await V(([x, z]) => window.__starwishVillage.standable(x, z), [back.x, back.z]);
        await place(ok ? back.x : t[0] * 0.6, ok ? back.z : t[2] * 0.6);
      }
      await V(([t0, t1, t2, aa, bb, rr]) => window.__starwishVillage.shotCam(true, t0, t1, t2, aa, bb, rr), [t[0], t[1], t[2], a, b, r]);
      await shoot(name);
    }
    // NPC：正面＋側面（玩家站在 7 m 外，NPC 不會轉身；鏡頭 2.9 m）
    const lay = await V(() => window.__starwishVillage.layout());
    for (const n of lay.npcs) {
      if (n.id === "board") continue;
      const f = { x: Math.sin(n.yaw), z: Math.cos(n.yaw) };
      const away = { x: n.x + f.x * 7, z: n.z + f.z * 7 };
      const ok = await V(([x, z]) => window.__starwishVillage.standable(x, z), [away.x, away.z]);
      await place(ok ? away.x : n.x * 0.5, ok ? away.z : n.z * 0.5);
      for (const [tag, deg] of [["front", 0], ["side", 90], ["q45", -40]]) {
        const c = Math.cos(rad(deg));
        const s = Math.sin(rad(deg));
        const d = { x: f.x * c - f.z * s, z: f.x * s + f.z * c };
        await V(([t0, t1, t2, aa, bb, rr]) => window.__starwishVillage.shotCam(true, t0, t1, t2, aa, bb, rr), [n.x, n.floor + 0.72, n.z, alphaFor(d.x, d.z), 84, 3.1]);
        await shoot(`npc_${n.id}_${tag}`);
      }
    }
    // 洛恩（會走動）：玩家先移到中央，停住後依他目前的面向拍正面與側面
    await place(0, -12.5);
    await V(() => window.__starwishVillage.shotCam(true, 0, 1, 0, -90, 60, 20));
    const tg = await V(() => (window.__starwishVillage.shotTargets ? window.__starwishVillage.shotTargets() : { merchant: null }));
    if (tg.merchant) {
      const m = tg.merchant;
      for (const [tag, deg] of [["front", 0], ["side", 90]]) {
        const c = Math.cos(rad(deg));
        const s = Math.sin(rad(deg));
        const d = { x: m.fx * c - m.fz * s, z: m.fx * s + m.fz * c };
        await V(([t0, t1, t2, aa, bb, rr]) => window.__starwishVillage.shotCam(true, t0, t1, t2, aa, bb, rr), [m.x, m.y + 0.95, m.z, alphaFor(d.x, d.z), 84, 3.2]);
        await shoot(`npc_merchant_${tag}`);
      }
    }
    // Stage 6.7：洛恩步行中（側面）：等到 Walk 再拍
    for (let i = 0; i < 40; i++) {
      const st = await V(() => window.__starwishVillage.perfState().merchant);
      const w = await V(() => (window.__starwishVillage.merchantPose ? window.__starwishVillage.merchantPose() : null));
      if (w && w.anim === "Walk") {
        const t2 = await V(() => window.__starwishVillage.shotTargets());
        const m = t2.merchant;
        const d = { x: m.fz, z: -m.fx };
        await V(([t0, t1, t2_, aa, bb, rr]) => window.__starwishVillage.shotCam(true, t0, t1, t2_, aa, bb, rr), [m.x, m.y + 0.7, m.z, alphaFor(d.x, d.z), 86, 3.0]);
        await shoot("npc_merchant_walk");
        break;
      }
      void st;
      await page.waitForTimeout(1000);
    }
    // Stage 6.7：委託佈告欄近距
    {
      const b = lay.npcs.find((n) => n.id === "board");
      if (b) {
        const f = { x: Math.sin(b.yaw), z: Math.cos(b.yaw) };
        await place(b.x + f.x * 6, b.z + f.z * 6);
        await V(([t0, t1, t2_, aa, bb, rr]) => window.__starwishVillage.shotCam(true, t0, t1, t2_, aa, bb, rr), [b.x - f.x * 1.8, 1.2, b.z - f.z * 1.8, alphaFor(f.x, f.z), 82, 5.2]);
        await shoot("board_close");
      }
    }
    await V(() => window.__starwishVillage.shotCam(false));
    run.perfState = await V(() => { const p = window.__starwishVillage.perfState(); return { npcStats: p.npcStats, merchant: p.merchant }; });
  } catch (e) {
    run.errors.push(`fatal: ${e.message}`);
  }
  await ctx.close();
}
await browser.close();
await server.close();
report.finishedAt = new Date().toISOString();
writeFileSync(`${outDir}/${label}_report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.runs.map((r) => ({ tier: r.tier, shots: r.shots.length, errors: r.errors.slice(0, 5) }))));
