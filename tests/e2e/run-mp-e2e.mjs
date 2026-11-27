// Stage 8.1｜正式 3D 遊戲雙人連線 E2E（Claude D）
// node tests/e2e/run-mp-e2e.mjs dist chromium|webkit
// 啟動真正的多人伺服器（multiplayer/server/main.ts）＋靜態網站，兩個獨立瀏覽器環境＝兩位玩家：
//   星芽村互相看見（不同性別／髮色／武器）→ 移動同步（Idle／Run、朝向、無瞬移）→ 洛恩位置一致 → A、B 先後走入南門到星芽原野
//   → 原野互相看見、攻擊／受擊／倒地動作同步 → 斷線重連 → 都走回村莊 → 重複登入被踢
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadPlaywright, serve } from "./static-server.mjs";

const dist = resolve(process.argv[2] ?? "dist");
const browserName = process.argv[3] ?? "chromium";
const outDir = resolve("test-results/mp-e2e");
mkdirSync(outDir, { recursive: true });
const PORT = 2600 + Math.floor(Math.random() * 300);
const results = { browser: browserName, checks: [], samples: {}, consoleErrors: [], http404: [], remappedLoads: 0, startedAt: new Date().toISOString() };
const check = (name, ok, detail) => {
  results.checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? " " + JSON.stringify(detail) : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const angErr = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

const srv = spawn(process.execPath, [resolve("multiplayer/server/main.ts")], { env: { ...process.env, PORT: String(PORT), MP_GRACE_MS: "20000" }, stdio: ["ignore", "pipe", "pipe"] });
let srvLog = "";
srv.stdout.on("data", (d) => (srvLog += d));
srv.stderr.on("data", (d) => (srvLog += d));
for (let i = 0; i < 200 && !srvLog.includes("listening"); i++) await sleep(50);
// MP_E2E_SITE：測試已發布的預覽網址（例如 GitHub Pages 的 /preview-mp81）；MP_E2E_ROOT＋MP_E2E_PATH：本機模擬 gh-pages 目錄
const site = process.env.MP_E2E_SITE
  ? { url: process.env.MP_E2E_SITE.replace(/\/$/, ""), close: () => {} }
  : process.env.MP_E2E_ROOT
    ? await serve(process.env.MP_E2E_ROOT).then((s) => ({ ...s, url: `${s.url}/${process.env.MP_E2E_PATH ?? ""}`.replace(/\/$/, "") }))
    : await serve(dist);
results.site = site.url;
const pw = await loadPlaywright();
const browser = await pw[browserName].launch();
const metrics = async () => (await fetch(`http://127.0.0.1:${PORT}/metrics`)).json();

const base = `${site.url}/?play=world&mp=1&lod=lite&quality=low&newgame=1&server=ws://127.0.0.1:${PORT}/ws`;
const players = [];
async function player(name, extra, mobile) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: browserName !== "firefox", hasTouch: true } : { viewport: { width: 960, height: 600 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => results.consoleErrors.push(`${name}: ${e.message}`));
  page.on("response", (r) => {
    const u = r.url();
    if (r.status() >= 400 && !/favicon/.test(u)) results.http404.push(`${r.status()} ${u}`);
    if (/\/preview-(?!mp81)[a-z0-9-]+\/models\//.test(u)) results.remappedLoads++;
  });
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|404/.test(m.text())) results.consoleErrors.push(`${name}: ${m.text()}`);
  });
  await page.goto(`${base}&name=${encodeURIComponent(name)}${extra}`, { waitUntil: "load" });
  const pl = { name, ctx, page };
  players.push(pl);
  return pl;
}
const vinfo = (p) => p.page.evaluate(() => window.__starwishWorld?.ready && window.__starwishWorld.map === "village" ? window.__starwishWorld.info() : null);
const finfo = (p) => p.page.evaluate(() => (window.__starwishPlay?.ready ? window.__starwishPlay.info() : null));
const waitVillage = (p) => p.page.waitForFunction(() => window.__starwishWorld?.ready === true && window.__starwishWorld.map === "village" && window.__starwishWorld.info().mp?.state === "online", null, { timeout: 420000 });
const waitField = (p) => p.page.waitForFunction(() => window.__starwishPlay?.ready === true && window.__starwishPlay.info().mp?.state === "online", null, { timeout: 420000 });
// 換地圖時頁面會重新載入：這期間的 evaluate 失敗是正常的，略過
const drive = (p, x, z) => p.page.evaluate(([x, z]) => {
  const mp = window.__mpWorld;
  if (mp) mp.driveOverride = x === 0 && z === 0 ? null : { x, z };
}, [x, z]).catch(() => {});
const shot = (p, n) => p.page.screenshot({ path: join(outDir, `${browserName}_${n}.png`) });

/** 沿著路點開到目標（世界座標方向輸入，伺服器權威移動） */
async function walk(p, pts, getPos, done, ms = 40000) {
  let i = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (done && (await done().catch(() => true))) break;
    const pos = await getPos();
    if (!pos) {
      await sleep(100);
      continue;
    }
    const w = pts[i];
    const dx = w.x - pos[0];
    const dz = w.z - pos[1];
    const l = Math.hypot(dx, dz);
    if (l < 0.6) {
      if (i < pts.length - 1) i++;
      else if (!done) break;
      continue;
    }
    await drive(p, dx / l, dz / l);
    await sleep(60);
  }
  await drive(p, 0, 0).catch(() => {});
}

try {
  // ---------- 進入星芽村 ----------
  const A = await player("阿星", "&g=male&hairColor=%233a2a1a&weapon=sword", false);
  const B = await player("小願", "&g=female&hairColor=%23c0408a&weapon=staff", true);
  for (const p of [A, B]) await waitVillage(p);
  for (const p of [A, B]) await p.page.waitForFunction(() => !!window.__mpWorld, null, { timeout: 10000 });
  const t0 = Date.now();
  let a = await vinfo(A);
  let b = await vinfo(B);
  for (let i = 0; i < 200 && !(a.mp.remotes.some((r) => r.loaded) && b.mp.remotes.some((r) => r.loaded)); i++) {
    await sleep(300);
    a = await vinfo(A);
    b = await vinfo(B);
  }
  results.samples.loadRemoteMs = Date.now() - t0;
  check("兩位玩家進入同一個星芽村房間", a.mp.room === b.mp.room && a.mp.room.startsWith("village"), { room: a.mp.room });
  const bSeesA = b.mp.remotes.find((r) => r.id === a.mp.pid);
  const aSeesB = a.mp.remotes.find((r) => r.id === b.mp.pid);
  check("A 看見 B 的 3D 角色（女、粉紅髮色、法杖；模組化零件）", aSeesB?.loaded && aSeesB.gender === "female" && aSeesB.hairColor === "#c0408a" && aSeesB.parts >= 5, aSeesB);
  check("B 看見 A 的 3D 角色（男、深棕髮色、短劍）", bSeesA?.loaded && bSeesA.gender === "male" && bSeesA.hairColor === "#3a2a1a" && bSeesA.parts >= 5, bSeesA);
  check("本地角色外觀以伺服器資料建立（B 是女性、法杖）", b.gender === "female" && b.avatarModel.weapon === "staff", { gender: b.gender, weapon: b.avatarModel.weapon });
  check("一般移動沒有跳躍按鈕", a.jumpButtonVisible === false && b.jumpButtonVisible === false);
  await A.page.waitForFunction(() => (() => { const a = window.__starwishWorld.info().art; return a === "loaded" || /^(error|部分)/.test(a); })(), null, { timeout: 400000 }).catch(() => {});
  const art = (await vinfo(A)).art;
  check("星芽村正式美術（Claude B Stage 6.7：Tripo NPC、N008 佈告欄、洛恩）載入完成", art === "loaded", { art });
  // 截圖前讓 A 走到 B 前方 2 m（一般移動，經伺服器判定），兩邊畫面都看得到對方
  {
    const bi = await vinfo(B);
    const tx = bi.pos[0] + Math.sin(bi.mp.server.yaw) * 3;
    const tz = bi.pos[2] + Math.cos(bi.mp.server.yaw) * 3;
    await walk(A, [{ x: tx, z: tz }], async () => {
      const i = await vinfo(A);
      return i ? [i.pos[0], i.pos[2]] : null;
    }, null, 20000);
    await sleep(1500);
  }
  await shot(A, "01_village_A_sees_B");
  await shot(B, "01_village_B_sees_A_iphone");

  // ---------- 移動同步：A 往東跑 2 秒（B 每 100 ms 取樣） ----------
  const samples = [];
  await drive(A, 1, 0);
  const ts = Date.now();
  while (Date.now() - ts < 2200) {
    const r = await B.page.evaluate((pid) => window.__mpWorld.remoteInfo().find((x) => x.id === pid), a.mp.pid);
    samples.push({ t: Date.now(), state: r?.state, pos: r?.pos, yaw: r?.yaw });
    await sleep(100);
  }
  const mid = samples[Math.floor(samples.length / 2)];
  await shot(B, "02_village_B_sees_A_running");
  await drive(A, 0, 0);
  await sleep(1200);
  a = await vinfo(A);
  b = await vinfo(B);
  const rA = b.mp.remotes.find((r) => r.id === a.mp.pid);
  let maxJump = 0;
  let maxSpeed = 0;
  for (let i = 1; i < samples.length; i++) {
    if (!samples[i].pos || !samples[i - 1].pos) continue;
    const d = Math.hypot(samples[i].pos[0] - samples[i - 1].pos[0], samples[i].pos[1] - samples[i - 1].pos[1]);
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    maxJump = Math.max(maxJump, d);
    maxSpeed = Math.max(maxSpeed, d / dt);
  }
  results.samples.moveSync = { samples: samples.length, maxStepM: +maxJump.toFixed(3), maxApparentSpeed: +maxSpeed.toFixed(2), midState: mid.state, midYaw: mid.yaw };
  check("B 看到 A 跑步（Run 動畫）", samples.some((s) => s.state === "Run"), { states: [...new Set(samples.map((s) => s.state))] });
  const runYaws = samples.filter((x) => x.state === "Run" && x.yaw !== null).map((x) => x.yaw);
  const lastRunYaw = runYaws[runYaws.length - 1] ?? null;
  check("遠端移動沒有瞬移（取樣間最大位移 < 5 m/s 對應距離的 2 倍）", maxSpeed < 10, results.samples.moveSync);
  check("A 停下後 B 看到 Idle", rA?.state === "Idle", { state: rA?.state });
  check("B 看到 A 朝東跑（跑步中 yaw≈90°）且停下後朝向＝伺服器朝向", lastRunYaw !== null && angErr(lastRunYaw, Math.PI / 2) < 0.35 && angErr(rA.yaw, a.mp.server.yaw) < 0.05, { lastRunYaw, remoteYaw: rA?.yaw, serverYaw: a.mp.server.yaw });
  const errAB = Math.hypot(rA.pos[0] - a.mp.server.x, rA.pos[1] - a.mp.server.z);
  check("B 畫面中 A 的位置＝伺服器權威位置（< 5 cm）", errAB < 0.05, { errCm: +(errAB * 100).toFixed(1) });
  const errLocal = Math.hypot(a.pos[0] - a.mp.server.x, a.pos[2] - a.mp.server.z);
  check("A 本地預測位置＝伺服器位置（< 5 cm）", errLocal < 0.05, { errCm: +(errLocal * 100).toFixed(1) });

  // ---------- N009 洛恩：兩邊看到同一個位置 ----------
  await A.page.waitForFunction(() => !!window.__starwishWorld.info().mp?.merchantPose, null, { timeout: 300000 }).catch(() => {});
  await B.page.waitForFunction(() => !!window.__starwishWorld.info().mp?.merchantPose, null, { timeout: 300000 }).catch(() => {});
  const [ma, mb] = await Promise.all([A.page.evaluate(() => window.__starwishWorld.info().mp), B.page.evaluate(() => window.__starwishWorld.info().mp)]);
  const roanGap = ma.merchantPose && mb.merchantPose ? Math.hypot(ma.merchantPose.x - mb.merchantPose.x, ma.merchantPose.z - mb.merchantPose.z) : null;
  results.samples.roan = { a: ma.merchantPose, b: mb.merchantPose, gapM: roanGap, server: ma.roan };
  check("N009 洛恩巡邏：兩位玩家看到的位置一致（< 0.5 m，伺服器時間）", roanGap !== null && roanGap < 0.5 && !!ma.roan, results.samples.roan);

  // ---------- 南門 → 星芽原野（A 先） ----------
  const toSouth = async (p) => {
    const i0 = await vinfo(p);
    const b0 = Math.atan2(i0.pos[0], i0.pos[2]);
    const target = b0 >= 0 ? Math.PI : -Math.PI;
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const t = b0 + ((target - b0) * k) / 8;
      pts.push({ x: 13 * Math.sin(t), z: 13 * Math.cos(t) });
    }
    pts.push({ x: 0, z: -44 });
    await walk(p, pts, async () => {
      const i = await vinfo(p).catch(() => null);
      return i ? [i.pos[0], i.pos[2]] : null;
    }, async () => !(await p.page.evaluate(() => window.__starwishWorld?.map === "village").catch(() => false)), 300000);
  };
  const tA0 = Date.now();
  await toSouth(A);
  await waitField(A);
  results.samples.portalA = { seconds: (Date.now() - tA0) / 1000 };
  let fa = await finfo(A);
  check("A 走入南門自動到星芽原野（伺服器換房間）", fa?.mp?.room?.startsWith("starsprout"), { room: fa?.mp?.room });
  await sleep(800);
  b = await vinfo(B);
  check("留在村莊的 B 看不到已到原野的 A（不同地圖互不可見）", !b.mp.remotes.some((r) => r.id === a.mp.pid), { remotes: b.mp.remotes.map((r) => r.id) });
  check("換地圖後 A 外觀與角色保留（同一玩家、同一外觀）", fa.mp.pid === a.mp.pid && fa.avatarModel.weapon === "sword", { pid: fa.mp.pid, weapon: fa.avatarModel.weapon });
  await toSouth(B);
  await waitField(B);
  // 原野互相看見
  let fb = await finfo(B);
  for (let i = 0; i < 100 && !(fa.mp.remotes.some((r) => r.loaded) && fb.mp.remotes.some((r) => r.loaded)); i++) {
    await sleep(300);
    fa = await finfo(A);
    fb = await finfo(B);
  }
  check("A、B 都在星芽原野，互相看見", fa.mp.room === fb.mp.room && fa.mp.remotes.some((r) => r.id === fb.mp.pid && r.loaded) && fb.mp.remotes.some((r) => r.id === fa.mp.pid && r.loaded), { room: fa.mp.room });
  await shot(B, "03_field_B_sees_A_iphone");

  // ---------- 原野：A 打星露啵啵（真的攻擊流程）→ B 看到 Attack ----------
  const target = () => A.page.evaluate(() => {
    const i = window.__starwishPlay.info();
    const al = i.monsters.filter((m) => m.state !== "dead" && m.hp > 0);
    al.sort((p, q) => Math.hypot(p.x - i.pos[0], p.z - i.pos[2]) - Math.hypot(q.x - i.pos[0], q.z - i.pos[2]));
    return al[0] ? { x: al[0].x, z: al[0].z, d: Math.hypot(al[0].x - i.pos[0], al[0].z - i.pos[2]) } : null;
  });
  let sawAttack = false;
  let localAttack = false;
  const atkLog = [];
  const tAtk = Date.now();
  while (Date.now() - tAtk < 300000 && !sawAttack) {
    const t = await target();
    if (!t) break;
    if (atkLog.length < 400) atkLog.push(+t.d.toFixed(2));
    if (t.d > 1.8) {
      const i = await finfo(A);
      const dx = t.x - i.pos[0];
      const dz = t.z - i.pos[2];
      const l = Math.hypot(dx, dz);
      await drive(A, dx / l, dz / l);
      await sleep(80);
      continue;
    }
    await drive(A, 0, 0);
    await A.page.evaluate(() => window.__starwishPlay.press("attack"));
    if ((await finfo(A)).state === "Attack") localAttack = true;
    for (let k = 0; k < 8 && !sawAttack; k++) {
      await sleep(60);
      const r = await B.page.evaluate((pid) => window.__mpWorld.remoteInfo().find((x) => x.id === pid), fa.mp.pid);
      if (r?.state === "Attack") sawAttack = true;
    }
  }
  await drive(A, 0, 0);
  results.samples.attack = { localAttack, distances: atkLog.slice(-20), seconds: (Date.now() - tAtk) / 1000 };
  check("A 在原野實際攻擊怪物，B 看到 A 的 Attack 動畫", sawAttack, results.samples.attack);
  if (sawAttack) await shot(B, "04_field_B_sees_A_attack");
  // Hurt／Death 動作同步（由網路動作事件；真實怪物攻擊時機不固定 → 直接送事件驗證同步管線）
  await A.page.evaluate(() => window.__mpWorld.act("hurt"));
  let sawHurt = false;
  for (let k = 0; k < 20 && !sawHurt; k++) {
    await sleep(60);
    const r = await B.page.evaluate((pid) => window.__mpWorld.remoteInfo().find((x) => x.id === pid), fa.mp.pid);
    if (r?.state === "Hurt") sawHurt = true;
  }
  check("Hurt 動作同步（B 看到 A 受擊動畫）", sawHurt);

  // ---------- 斷線重連（B） ----------
  await B.page.evaluate(() => window.__mpWorld.client.dropConnection());
  let sawOff = false;
  for (let k = 0; k < 30 && !sawOff; k++) {
    await sleep(100);
    const r = await A.page.evaluate((pid) => window.__mpWorld.remoteInfo().find((x) => x.id === pid), fb.mp.pid);
    if (r && r.link === 0) sawOff = true;
  }
  check("B 斷線時 A 看到 B 標示斷線中", sawOff);
  await B.page.waitForFunction(() => window.__mpWorld.client.state === "online" && window.__mpWorld.client.stats.reconnects >= 1, null, { timeout: 30000 });
  await sleep(600);
  fb = await finfo(B);
  fa = await finfo(A);
  const back = fa.mp.remotes.find((r) => r.id === fb.mp.pid);
  check("B 自動重連、同一角色、A 看到 B 恢復", back?.link === 1 && fb.mp.stats.reconnects >= 1, { reconnects: fb.mp.stats.reconnects, resyncMs: fb.mp.stats.lastResyncMs });

  // ---------- Death 同步與倒地後回村（A；伺服器確認倒地才接受 respawn） ----------
  await A.page.evaluate(() => window.__mpWorld.act("death"));
  let sawDeath = false;
  for (let k = 0; k < 40 && !sawDeath; k++) {
    await sleep(80);
    const r = await B.page.evaluate((pid) => window.__mpWorld.remoteInfo().find((x) => x.id === pid), fa.mp.pid);
    if (r?.state === "Death") sawDeath = true;
  }
  check("Death 動作同步（B 看到 A 倒地）", sawDeath);
  await shot(B, "05_field_B_sees_A_down");

  // ---------- 從原野營地傳送陣走回星芽村（B）；A 用倒地復活回村 ----------
  const toCamp = async (p) => {
    await walk(p, [{ x: -56, z: -64 }, { x: -56, z: -68 }], async () => {
      const i = await finfo(p).catch(() => null);
      return i ? [i.pos[0], i.pos[2]] : null;
    }, async () => !(await p.page.evaluate(() => !!window.__starwishPlay?.ready).catch(() => false)), 300000);
  };
  await toCamp(B);
  await waitVillage(B);
  await A.page.evaluate(() => window.__mpWorld.respawn());
  await waitVillage(A);
  await sleep(500);
  for (const p of [A, B]) await p.page.waitForFunction(() => !!window.__mpWorld, null, { timeout: 10000 });
  a = await vinfo(A);
  b = await vinfo(B);
  for (let i = 0; i < 100 && !(a.mp.remotes.some((r) => r.loaded) && b.mp.remotes.some((r) => r.loaded)); i++) {
    await sleep(300);
    a = await vinfo(A);
    b = await vinfo(B);
  }
  check("B 走入原野營地傳送陣回到星芽村、A 倒地後在星芽村復活", a.mp.room.startsWith("village") && b.mp.room.startsWith("village"), { a: a.mp.room, b: b.mp.room });
  check("回到村莊後再次互相看見", a.mp.remotes.some((r) => r.id === b.mp.pid && r.loaded) && b.mp.remotes.some((r) => r.id === a.mp.pid && r.loaded));
  await shot(A, "06_village_back_A_sees_B");

  // ---------- 重複登入：用 B 的憑證開第三個分頁 → 舊的 B 被踢 ----------
  const token = await B.page.evaluate(() => sessionStorage.getItem("starwish.mp81.token"));
  const ctx3 = await browser.newContext({ viewport: { width: 800, height: 600 } });
  await ctx3.addInitScript((t) => sessionStorage.setItem("starwish.mp81.token", t), token);
  const p3 = await ctx3.newPage();
  await p3.goto(base.replace("&newgame=1", ""), { waitUntil: "load" });
  const C = { name: "B2", ctx: ctx3, page: p3 };
  await waitVillage(C);
  await sleep(800);
  const bState = await B.page.evaluate(() => window.__mpWorld.client.state);
  const c3 = await vinfo(C);
  check("同一角色重複登入：新分頁接手同一玩家，舊分頁被中斷且不自動重連", bState === "offline" && c3.mp.pid === b.mp.pid, { oldState: bState, newPid: c3.mp.pid, oldPid: b.mp.pid });
  const m = await metrics();
  results.serverMetrics = { players: m.players, rooms: m.rooms, totals: m.totals, tick: m.tick, store: m.store };
  check("伺服器沒有加速／非法位置紀錄", m.players_detail.every((p) => p.speedViolations === 0 && p.illegalPositions === 0), m.players_detail);
  results.samples.diag = { A: a.mp.stats, B: b.mp.stats };
  check("瀏覽器沒有 JavaScript 錯誤", results.consoleErrors.length === 0, results.consoleErrors.slice(0, 5));
  check("沒有 404／載入失敗的檔案", results.http404.length === 0, results.http404.slice(0, 5));
  results.samples.remap = { remappedLoads: results.remappedLoads };
} catch (e) {
  check("E2E 執行完成", false, String(e?.stack ?? e));
  // 失敗時的診斷：每位玩家的網址、開機訊息、地圖、位置、連線狀態＋截圖
  results.failureDiag = {};
  for (const p of players) {
    try {
      results.failureDiag[p.name] = await p.page.evaluate(() => {
        const w = window.__starwishWorld;
        const f = window.__starwishPlay;
        const mp = window.__mpWorld;
        return {
          url: location.href,
          boot: document.getElementById("boot-status")?.textContent ?? null,
          village: w?.ready ? { map: w.map, pos: w.info().pos } : null,
          field: f?.ready ? { pos: f.info().pos } : null,
          mp: mp ? { state: mp.client.state, map: mp.client.map?.id, room: mp.client.room, server: mp.client.server, stats: mp.client.stats } : null,
        };
      });
      await shot(p, `fail_${p.name}`);
    } catch (err) {
      results.failureDiag[p.name] = String(err);
    }
  }
} finally {
  await browser.close();
  site.close?.();
  srv.kill("SIGTERM");
  results.passed = results.checks.filter((c) => c.ok).length;
  results.total = results.checks.length;
  results.serverLogTail = srvLog.split("\n").slice(-30);
  writeFileSync(join(outDir, `mp-e2e-${browserName}.json`), JSON.stringify(results, null, 2));
  console.log(`${results.passed}/${results.total} passed (${browserName})`);
  process.exit(results.passed === results.total && results.total > 0 ? 0 : 1);
}
