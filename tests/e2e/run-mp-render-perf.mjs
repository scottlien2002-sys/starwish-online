// Stage 8.4｜多人「用戶端渲染」效能對照（Claude D）——與伺服器負載分開量測
// node tests/e2e/run-mp-render-perf.mjs dist [chromium] [2,4,8,16,32,40]
//
// 一個瀏覽器（觀察者，iPhone 直向尺寸、Lite、低畫質）＋ N 個 Node 機器人玩家（真正的 NetClient 連真正的伺服器）在星芽村：
//   一半站在觀察者附近、一半往外走（產生近／遠／超出範圍三種距離），量測 12 秒。
// 每個人數各量兩次：remote＝Claude C 合併渲染＋遠距離 LOD（Stage 8.4 預設）；lite＝Stage 8.2 的 Lite 模型（回退設定）。
// 記錄：Draw Calls、三角面、CPU 每幀時間（Babylon 量測）、FPS、其他玩家近／遠／不繪製人數、下行流量。
// ⚠ CI 是沒有 GPU 的軟體繪製：FPS 只能看「同一台機器上的相對差異」，不能當 iPhone 數字。
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadPlaywright, serve } from "./static-server.mjs";

const dist = resolve(process.argv[2] ?? "dist");
const browserName = process.argv[3] ?? "chromium";
const COUNTS = (process.argv[4] ?? "2,4,8,16,32,40").split(",").map(Number);
const outDir = resolve("test-results/mp-render");
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 3100 + Math.floor(Math.random() * 300);
const srv = spawn(process.execPath, [resolve("multiplayer/server/main.ts")], { env: { ...process.env, PORT: String(PORT), MP_GRACE_MS: "3000" }, stdio: ["ignore", "pipe", "pipe"] });
let srvLog = "";
srv.stdout.on("data", (d) => (srvLog += d));
srv.stderr.on("data", (d) => (srvLog += d));
for (let i = 0; i < 200 && !srvLog.includes("listening"); i++) await sleep(50);
const { NetClient } = await import(resolve("multiplayer/client/NetClient.ts"));
const site = await serve(dist);
const pw = await loadPlaywright();
const browser = await pw[browserName].launch();
const results = { browser: browserName, note: "CI 軟體繪製（無 GPU）：只比較相對差異；iPhone 實機數字需另外量測", runs: [], startedAt: new Date().toISOString() };

function bots(n) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const c = new NetClient({ url: `ws://127.0.0.1:${PORT}/ws`, name: `R${i}`, gender: i % 2 ? "female" : "male", appearance: { hair: "hair01", hairColor: ["#3a2a1a", "#c0408a", "#4a7ad0", "#e8c46e"][i % 4], weapon: i % 3 ? "sword" : "staff" } });
    c.connect();
    list.push({ c, dir: { x: 0, z: 0 }, last: performance.now() });
  }
  const timer = setInterval(() => {
    const t = performance.now();
    for (const b of list) {
      b.c.update((t - b.last) / 1000, b.dir.x, b.dir.z);
      b.last = t;
    }
  }, 1000 / 30);
  return { list, stop: () => (clearInterval(timer), list.forEach((b) => b.c.close())) };
}

for (const n of COUNTS) {
  for (const mode of ["remote", "lite"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: browserName !== "firefox", hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${site.url}/?play=world&mp=1&lod=lite&quality=low&newgame=1&name=OBS&remote=${mode}&server=ws://127.0.0.1:${PORT}/ws`);
    await page.waitForFunction(() => window.__mpWorld?.client?.state === "online" && window.__starwishWorld?.ready === true && !!window.__mpWorld.perf, null, { timeout: 300000 });
    const B = bots(n);
    // 等機器人上線；一半往外走 2.5～7 秒（形成近、遠、超出 45 m 三種距離），之後全部停下
    for (let i = 0; i < 200 && B.list.some((b) => b.c.state !== "online"); i++) await sleep(50);
    B.list.forEach((b, i) => {
      if (i % 2) {
        const a = (i / n) * Math.PI * 2;
        b.dir = { x: Math.cos(a), z: Math.sin(a) };
        setTimeout(() => (b.dir = { x: 0, z: 0 }), 2500 + (i % 4) * 1500);
      }
    });
    // 等其他玩家模型載入
    for (let i = 0; i < 240; i++) {
      const loaded = await page.evaluate(() => window.__mpWorld.remoteInfo().filter((r) => r.loaded).length).catch(() => 0);
      if (loaded >= n) break;
      await sleep(250);
    }
    await sleep(7500);
    await page.evaluate(() => window.__mpWorld.perf?.resetSession());
    // 量測 12 秒：每 0.5 秒取樣
    const samples = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      samples.push(
        await page.evaluate(() => {
          const w = window.__mpWorld;
          return {
            ...w.renderStats,
            down: Math.round(w.client.stats.bytesDownPerSec / 102.4) / 10,
          };
        }),
      );
      await sleep(500);
    }
    const avg = (k) => {
      const v = samples.map((s) => s[k]).filter((x) => typeof x === "number");
      return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
    };
    const lastInfo = await page.evaluate(() => window.__mpWorld.perfInfo());
    const ps = await page.evaluate(() => window.__mpWorld.perf?.session() ?? null);
    const run = { players: n + 1, remotes: n, mode, fps: ps?.avgFps ?? null, low1: ps?.low1 ?? null, drawCalls: ps?.drawCalls ?? null, trianglesK: ps?.triangles ?? null, cpuMs: ps?.cpuMs ?? null, remoteTriangles: avg("remoteTriangles"), near: avg("near"), far: avg("far"), culled: avg("culled"), downKBs: avg("down"), loaded: lastInfo.remotes.loaded, errors: errors.length };
    results.runs.push(run);
    console.log(JSON.stringify(run));
    B.stop();
    await ctx.close();
    await sleep(3500); // 機器人離線（保留時間 3 秒）
  }
}
results.finishedAt = new Date().toISOString();
writeFileSync(`${outDir}/render-${browserName}.json`, JSON.stringify(results, null, 2));
await browser.close();
site.close();
srv.kill();
process.exit(0);
