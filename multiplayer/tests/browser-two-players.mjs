// 瀏覽器雙人實測（Chromium 兩個獨立分頁＝兩位玩家）
// 執行：PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node multiplayer/tests/browser-two-players.mjs
// 會啟動真正的伺服器程序、開啟本機測試頁、用鍵盤操作 A，截圖兩邊畫面。
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browserName = process.env.MP_BROWSER ?? "chromium";
const out = join(root, "reports");
mkdirSync(join(out, "screens"), { recursive: true });
const PORT = 2577;
const results = { checks: [], consoleErrors: [] };
const check = (name, ok, detail) => {
  results.checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? " " + JSON.stringify(detail) : ""}`);
};
const angErr = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn(process.execPath, [join(root, "server/main.ts")], { env: { ...process.env, PORT: String(PORT), MP_DEV: "1", MP_GRACE_MS: "8000" }, stdio: ["ignore", "pipe", "pipe"] });
let srvLog = "";
srv.stdout.on("data", (d) => (srvLog += d));
srv.stderr.on("data", (d) => (srvLog += d));
for (let i = 0; i < 100 && !srvLog.includes("listening"); i++) await sleep(50);

const browser = await pw[browserName].launch();
results.browser = browserName;
try {
  const base = `http://127.0.0.1:${PORT}/mp/`;
  const ctxA = await browser.newContext({ viewport: { width: 900, height: 640 } });
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pa = await ctxA.newPage();
  const pb = await ctxB.newPage();
  for (const [n, p] of [["A", pa], ["B", pb]]) {
    p.on("console", (m) => m.type() === "error" && results.consoleErrors.push(`${n}: ${m.text()}`));
    p.on("pageerror", (e) => results.consoleErrors.push(`${n}: ${e.message}`));
  }
  await pa.goto(`${base}?name=${encodeURIComponent("阿星")}&g=male&slot=a`);
  await pb.goto(`${base}?name=${encodeURIComponent("小願")}&g=female&slot=b`);
  const st = (p) => p.evaluate(() => {
    const c = window.__mp.client;
    return { state: c.state, pid: c.pid, room: c.room, map: c.map?.id, me: c.renderPos, server: c.server, remotes: c.remotes(), stats: { ...c.stats }, log: [...window.__mp.log] };
  });
  await pa.waitForFunction(() => window.__mp?.client.state === "online");
  await pb.waitForFunction(() => window.__mp?.client.state === "online");
  await sleep(800);
  let a = await st(pa);
  let b = await st(pb);
  check("兩位玩家進入同一房間", a.room === b.room, { room: a.room });
  check("A 看見 B（小願、女）", a.remotes.some((r) => r.id === b.pid && r.name === "小願" && r.gender === "female"));
  check("B 看見 A（阿星、男）", b.remotes.some((r) => r.id === a.pid && r.name === "阿星" && r.gender === "male"));
  await pa.screenshot({ path: join(out, "screens", `${browserName}_01_A_idle.png`) });
  await pb.screenshot({ path: join(out, "screens", `${browserName}_01_B_idle_iphone_size.png`) });

  // A 用鍵盤往右（東）跑
  await pa.bringToFront();
  await pa.keyboard.down("d");
  await sleep(1200);
  b = await st(pb);
  const ra = b.remotes.find((r) => r.id === a.pid);
  check("B 看到 A 的 Run 動畫", ra?.anim === 1, { anim: ra?.anim });
  check("B 看到 A 朝東（yaw≈+90°）", ra && angErr(ra.yaw, Math.PI / 2) < 0.25, { yaw: ra?.yaw });
  await pb.screenshot({ path: join(out, "screens", `${browserName}_02_B_sees_A_running.png`) });
  await pa.screenshot({ path: join(out, "screens", `${browserName}_02_A_running.png`) });
  await pa.keyboard.up("d");
  await sleep(900);
  a = await st(pa);
  b = await st(pb);
  const ra2 = b.remotes.find((r) => r.id === a.pid);
  check("A 停下後 B 看到 Idle", ra2?.anim === 0, { anim: ra2?.anim });
  const posErr = Math.hypot(ra2.x - a.server.x, ra2.z - a.server.z);
  check("B 畫面中的 A 位置＝伺服器位置（誤差 < 2 cm）", posErr < 0.02, { errCm: +(posErr * 100).toFixed(2) });
  check("A 本地預測位置＝伺服器位置（誤差 < 2 cm）", Math.hypot(a.me.x - a.server.x, a.me.z - a.server.z) < 0.02);

  // 斷線測試：A 按「斷線測試」
  await pa.click("#drop");
  await sleep(150);
  b = await st(pb);
  check("A 斷線時 B 看到 A 標示斷線中", b.remotes.find((r) => r.id === a.pid)?.link === 0);
  await pb.screenshot({ path: join(out, "screens", `${browserName}_03_B_sees_A_disconnected.png`) });
  await pa.waitForFunction(() => window.__mp.log.some((l) => l.includes("完整同步完成")), null, { timeout: 10000 });
  const a2 = await st(pa);
  check("A 自動重連並接回同一角色", a2.pid === a.pid && a2.state === "online", { pid: a2.pid, resync: a2.stats.lastResyncMs });
  await sleep(300);
  b = await st(pb);
  check("B 看到 A 恢復連線", b.remotes.find((r) => r.id === a.pid)?.link === 1);
  await pa.screenshot({ path: join(out, "screens", `${browserName}_04_A_after_reconnect.png`) });

  // 重新整理頁面（sessionStorage 保留憑證）→ 仍是同一角色
  await pa.reload();
  await pa.waitForFunction(() => window.__mp?.client.state === "online");
  const a3 = await st(pa);
  check("A 重新整理頁面後用憑證接回同一角色", a3.pid === a.pid, { pid: a3.pid });

  // B 用觸控搖桿移動
  const box = { x: 195, y: 600 };
  await pb.bringToFront();
  await pb.touchscreen.tap(box.x, box.y);
  await pb.evaluate(() => {
    window.__mp.auto.on = true;
    window.__mp.auto.x = 0;
    window.__mp.auto.z = -1;
  });
  await sleep(1000);
  a = await st(pa);
  const rb = a.remotes.find((r) => r.id === b.pid);
  check("A 看到 B 往南跑（Run、yaw≈180°）", rb?.anim === 1 && angErr(rb.yaw, Math.PI) < 0.25, { anim: rb?.anim, yaw: rb?.yaw });
  await pa.screenshot({ path: join(out, "screens", `${browserName}_05_A_sees_B_running.png`) });
  await pb.evaluate(() => (window.__mp.auto.on = false));
  await sleep(1000);
  a = await st(pa);
  b = await st(pb);
  results.diag = { A: a.stats, B: b.stats };
  check("診斷資訊有數值（RTT、封包量、FPS、人數）", a.stats.fps > 0 && a.stats.snapsPerSec > 0 && a.stats.bytesDownPerSec > 0 && a.stats.players === 2, { fps: a.stats.fps, snaps: a.stats.snapsPerSec, down: a.stats.bytesDownPerSec, rtt: a.stats.rttMs, players: a.stats.players });
  const metrics = await (await fetch(`http://127.0.0.1:${PORT}/metrics`)).json();
  results.serverMetrics = metrics;
  check("伺服器 /metrics 顯示 2 位玩家", metrics.players === 2, { players: metrics.players, tick: metrics.tick });
  check("瀏覽器沒有 JavaScript 錯誤", results.consoleErrors.length === 0, results.consoleErrors);
} finally {
  await browser.close();
  srv.kill("SIGTERM");
}
results.passed = results.checks.filter((c) => c.ok).length;
results.total = results.checks.length;
writeFileSync(join(out, `browser-results-${browserName}.json`), JSON.stringify(results, null, 2));
console.log(`${results.passed}/${results.total} passed`);
process.exit(results.passed === results.total ? 0 : 1);
