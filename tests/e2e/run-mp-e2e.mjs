// Stage 8.1／8.2｜正式 3D 遊戲雙人連線 E2E（Claude D）
// Stage 8.2：原野改為伺服器權威戰鬥 → 兩人合作打同一隻怪（血量、死亡、重生、經驗、掉落都由伺服器）；錄兩位玩家畫面（MP_E2E_VIDEO=1）
// node tests/e2e/run-mp-e2e.mjs dist chromium|webkit
// 啟動真正的多人伺服器（multiplayer/server/main.ts）＋靜態網站，兩個獨立瀏覽器環境＝兩位玩家：
//   星芽村互相看見（不同性別／髮色／武器）→ 移動同步（Idle／Run、朝向、無瞬移）→ 洛恩位置一致 → A、B 先後走入南門到星芽原野
//   → 原野互相看見、攻擊／受擊／倒地動作同步 → 斷線重連 → 都走回村莊 → 重複登入被踢
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

// MP_E2E_TLS=1：伺服器用暫時自簽憑證跑 WSS（測試 https 的 GitHub Pages 網址時，瀏覽器不允許 ws://）
const TLS = process.env.MP_E2E_TLS === "1";
const tlsEnv = {};
if (TLS) {
  const d = mkdtempSync(join(tmpdir(), "mp-tls-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost", "-keyout", join(d, "key.pem"), "-out", join(d, "cert.pem")], { stdio: "ignore" });
  Object.assign(tlsEnv, { MP_TLS_CERT: join(d, "cert.pem"), MP_TLS_KEY: join(d, "key.pem") });
}
const TAG = process.env.MP_E2E_TAG ?? "";
const VIDEO = process.env.MP_E2E_VIDEO === "1";
const srv = spawn(process.execPath, [resolve("multiplayer/server/main.ts")], { env: { ...process.env, ...tlsEnv, PORT: String(PORT), MP_GRACE_MS: "20000" }, stdio: ["ignore", "pipe", "pipe"] });
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
// 測試公開網址時，測試伺服器在這台測試機（127.0.0.1）：Chromium 預設禁止公開網站連到本機（Local Network Access），測試時關閉此檢查。
// 實際 iPhone 連的是公開的 Render 網址，不受這個限制。
const browser = await pw[browserName].launch(
  TLS && browserName === "chromium" ? { args: ["--ignore-certificate-errors", "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults"] } : {},
);
const metrics = async () => {
  if (!TLS) return (await fetch(`http://127.0.0.1:${PORT}/metrics`)).json();
  const out = execFileSync("curl", ["-sk", `https://127.0.0.1:${PORT}/metrics`]).toString();
  return JSON.parse(out);
};

const base = `${site.url}/?play=world&mp=1&lod=lite&quality=low&newgame=1&server=${TLS ? "wss" : "ws"}://127.0.0.1:${PORT}/ws`;
const players = [];
let videoT0 = 0;
const mark = (k) => ((results.videoMarks ??= {})[k] = +((Date.now() - videoT0) / 1000).toFixed(1));
async function player(name, extra, mobile) {
  if (!videoT0) videoT0 = Date.now();
  const vsize = mobile ? { width: 390, height: 844 } : { width: 960, height: 600 };
  const video = VIDEO ? { recordVideo: { dir: join(outDir, "video", name === "阿星" ? "A" : name === "小願" ? "B" : "C"), size: vsize } } : {};
  const ctx = await browser.newContext(mobile ? { viewport: vsize, deviceScaleFactor: 2, isMobile: browserName !== "firefox", hasTouch: true, ...video } : { viewport: vsize, ...video });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => results.consoleErrors.push(`${name}: ${e.message}`));
  page.on("response", (r) => {
    const u = r.url();
    if (r.status() >= 400 && !/favicon/.test(u)) results.http404.push(`${r.status()} ${u}`);
    if (/\/preview-(?!mp8[124])[a-z0-9-]+\/models\//.test(u)) results.remappedLoads++;
    // Stage 8.4：M002／M003 候選版（V1.1）與回退（V1.0）實際載入的檔案
    const mm = /(M00[23])_[A-Za-z]+_Rig_(V1_1|V1)_(HQ|Lite)\.glb/.exec(u);
    if (mm && r.status() < 400) ((results.m23Loads ??= {})[name] ??= []).push(`${mm[1]} ${mm[2] === "V1_1" ? "V1.1" : "V1.0"} ${mm[3]}`);
    if (/\/shared-assets\/v\d+\//.test(u)) results.sharedAssetLoads = (results.sharedAssetLoads ?? 0) + 1;
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
const shot = (p, n) => p.page.screenshot({ path: join(outDir, `${TAG}${browserName}_${n}.png`) });

/** 原野中記錄每位玩家走過的路（每 1.5 m 一點）：回營地時沿原路倒著走，不會卡在營地柵欄外 */
const remember = (p, x, z) => {
  const t = (p.trail ??= []);
  const l = t[t.length - 1];
  if (!l || Math.hypot(l.x - x, l.z - z) >= 1.5) t.push({ x, z });
};
/** 沿著路點開到目標（世界座標方向輸入，伺服器權威移動） */
async function walk(p, pts, getPos, done, ms = 40000) {
  let i = 0;
  const t0 = Date.now();
  // 卡住偵測：2.5 秒沒有更接近目前路點就往側邊繞 1 秒（左右交替；柵欄、木箱等道具）
  let best = Infinity;
  let bestAt = Date.now();
  let side = 1;
  while (Date.now() - t0 < ms) {
    if (done && (await done().catch(() => true))) break;
    const pos = await getPos();
    if (!pos) {
      await sleep(100);
      continue;
    }
    if (p.recording) remember(p, pos[0], pos[1]);
    const w = pts[i];
    const dx = w.x - pos[0];
    const dz = w.z - pos[1];
    const l = Math.hypot(dx, dz);
    if (l < 0.6) {
      if (i < pts.length - 1) {
        i++;
        best = Infinity;
        bestAt = Date.now();
      } else if (!done) break;
      continue;
    }
    if (l < best - 0.3) {
      best = l;
      bestAt = Date.now();
    } else if (Date.now() - bestAt > 2500) {
      await drive(p, (-dz / l) * side, (dx / l) * side);
      await sleep(1000);
      side = -side;
      best = Infinity;
      bestAt = Date.now();
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
  // B 關掉怪物距離分級（&mlod=0）、M002／M003 用回退版（&m23=v10）：驗證畫面設定不同時，伺服器戰鬥結果仍一致
  const B = await player("小願", "&g=female&hairColor=%23c0408a&weapon=staff&mlod=0&m23=v10", true);
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
  // Stage 8.4：其他玩家＝Claude C 的合併渲染模型（C1.0-B5b Lite 合併，2 個 draw call＋遠距離 LOD）
  const okB5b = (r) => !!r?.loaded && /^novice_c10b5b_(male|female)_remote\.glb$/.test(r.file ?? "") && !r.parts && ["near", "far", "culled"].includes(r.lod);
  check("A 看見 B 的 3D 角色（C1.0-B5b 合併渲染、女、粉紅髮色已套用、法杖）", okB5b(aSeesB) && aSeesB.gender === "female" && aSeesB.hairColor === "#c0408a" && aSeesB.hairTinted >= 1 && aSeesB.weapon === "staff", aSeesB);
  check("B 看見 A 的 3D 角色（C1.0-B5b 合併渲染、男、深棕髮色已套用、短劍）", okB5b(bSeesA) && bSeesA.gender === "male" && bSeesA.hairColor === "#3a2a1a" && bSeesA.hairTinted >= 1 && bSeesA.weapon === "sword", bSeesA);
  const bAp = await B.page.evaluate(() => window.__mpWorld.client.appearance);
  check("本地角色外觀以伺服器資料建立（B 是女性、法杖；不是 Tripo 零件）", b.gender === "female" && bAp.weapon === "staff" && !b.avatarModel.modular && b.avatarModel.parts.length === 0, { gender: b.gender, ap: bAp, modular: b.avatarModel.modular });
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
  check("換地圖後 A 外觀與角色保留（同一玩家、髮色與短劍套用）", fa.mp.pid === a.mp.pid && fa.mp.look?.weapon === "sword" && fa.mp.look?.hairTinted >= 1 && !fa.avatarModel.modular, { pid: fa.mp.pid, look: fa.mp.look });
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
  // ---------- Stage 8.4：七種怪物 27 隻、候選資產、距離分級 ----------
  const fieldInfo = (P) => P.page.evaluate(() => {
    const i = window.__starwishPlay.info();
    const kinds = {};
    for (const m of i.monsters) kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
    return { n: i.monsters.length, kinds, detail: i.monsterDetail ?? i.perf?.monsterDetail ?? null, m23: window.__mpM23 ?? null, render: window.__mpWorld.renderStats };
  });
  let fiA = await fieldInfo(A);
  let fiB = await fieldInfo(B);
  const srvKinds = {};
  for (const c of (await metrics()).combat ?? []) srvKinds[c.room] = c.monsters;
  results.samples.monsters = { A: fiA, B: fiB, server: srvKinds };
  const seven = ["star_dew_bobo", "moss_horn_beast", "cloud_fluff_bird", "windfeather_fox", "nebula_sheep", "carrot_king", "crown_hammer_rabbit"];
  check("原野七種怪物 27 隻：兩支手機與伺服器一致", fiA.n === 27 && fiB.n === 27 && Object.values(srvKinds).includes(27) && seven.every((k) => fiA.kinds[k] > 0 && fiB.kinds[k] > 0), results.samples.monsters);
  for (let i = 0; i < 40 && !((results.m23Loads?.["阿星"] ?? []).length >= 2 && (results.m23Loads?.["小願"] ?? []).length >= 2); i++) await sleep(250);
  const la = results.m23Loads?.["阿星"] ?? [];
  const lb = results.m23Loads?.["小願"] ?? [];
  check("M002／M003 候選版 V1.1 已載入（A）；&m23=v10 回退到 V1.0（B）", fiA.m23 === "v1.1" && fiB.m23 === "v1.0" && la.some((x) => /M002 V1\.1/.test(x)) && la.some((x) => /M003 V1\.1/.test(x)) && !la.some((x) => /V1\.0/.test(x)) && lb.some((x) => /M002 V1\.0/.test(x)) && !lb.some((x) => /V1\.1/.test(x)), { A: la, B: lb });

  // ---------- 原野：A、B 合作打同一隻怪（伺服器權威）----------
  const field = (P) => P.page.evaluate(() => window.__starwishPlay.info().mp.field);
  const monOf = (P, id) => P.page.evaluate((id) => {
    const i = window.__starwishPlay.info();
    const m = i.monsters.find((x) => x.id === id);
    return m ? { x: m.x, z: m.z, hp: m.hp, maxHp: m.maxHp, state: m.state, me: [i.pos[0], i.pos[2]] } : null;
  }, id);
  // 目標：離營地最近、還活著的星露啵啵（被動怪物，Lv.1）
  const targetId = await A.page.evaluate(() => {
    const i = window.__starwishPlay.info();
    const al = i.monsters.filter((m) => m.kind === "star_dew_bobo" && m.hp > 0);
    al.sort((p, q) => Math.hypot(p.x - i.pos[0], p.z - i.pos[2]) - Math.hypot(q.x - i.pos[0], q.z - i.pos[2]));
    return al[0]?.id ?? null;
  });
  results.samples.coop = { targetId };
  /** 一位玩家朝目標走；夠近就按攻擊（法杖玩家用技能「魔法彈」，射程 9 m） */
  const ready = { A: false, B: false };
  const fighter = (P, useSkill, gate = async () => true, key = "A") => {
    let best = Infinity, stuck = Date.now(), side = 1, presses = 0;
    return async () => {
      const m = await monOf(P, targetId).catch(() => null);
      if (!m) return;
      remember(P, m.me[0], m.me[1]);
      const dx = m.x - m.me[0], dz = m.z - m.me[1];
      const d = Math.hypot(dx, dz);
      if (m.hp <= 0 || m.state === "death" || m.state === "dead") {
        await drive(P, 0, 0);
        return;
      }
      if (Math.hypot(m.me[0] + 56, m.me[1] + 68) < 4.5) {
        await drive(P, 0.7, 0.7);
        return;
      }
      const reach = useSkill ? 6 : 1.7;
      ready[key] = d <= reach;
      if (d > reach) {
        if (d < best - 0.3) {
          best = d;
          stuck = Date.now();
        }
        if (Date.now() - stuck > 2500) {
          await drive(P, (-dz / d) * side, (dx / d) * side);
          await sleep(900);
          side = -side;
          stuck = Date.now();
          best = Infinity;
          return;
        }
        await drive(P, dx / d, dz / d);
        return;
      }
      await drive(P, 0, 0);
      if (!(await gate())) return; // 合作測試：等隊友先出手，確保兩人都有造成傷害
      presses++;
      await P.page.evaluate((sk) => window.__starwishPlay.press(sk ? "skill" : "attack"), useSkill);
    };
  };
  // 出手順序固定（避免一人先打死）：A 走到近戰距離 → B 先放魔法彈 → 伺服器接受 B 的技能後 A 才開始攻擊
  for (const P of [A, B]) {
    P.recording = true;
    const i = await finfo(P);
    P.trail = [{ x: -56, z: -64 }, { x: i.pos[0], z: i.pos[2] }];
  }
  // 戰鬥音效：瀏覽器規定要先有使用者點擊才能出聲 → 點一下畫面上方空白處（不影響遊戲操作）
  await A.page.mouse.click(300, 160).catch(() => {});
  const fA = fighter(A, false, async () => ((await field(B).catch(() => null))?.skillsOk ?? 0) > 0, "A");
  // B 第一發之後要等 A 真的打出傷害（伺服器 hit 事件）才繼續，確保兩人都有貢獻
  const fB = fighter(B, true, async () => {
    if (!ready.A) return false;
    const [fa2, fb2] = await Promise.all([field(A).catch(() => null), field(B).catch(() => null)]);
    return (fb2?.skillsOk ?? 0) === 0 || (fa2?.damageDealt ?? 0) > 0;
  }, "B");
  const hpSamples = [];
  const tFight = Date.now();
  mark("fightApproach");
  let shotFight = false;
  while (Date.now() - tFight < 300000) {
    await Promise.all([fA(), fB()]);
    const [ma2, mb2] = await Promise.all([monOf(A, targetId).catch(() => null), monOf(B, targetId).catch(() => null)]);
    if (ma2 && mb2) hpSamples.push([ma2.hp, mb2.hp, ma2.state, mb2.state]);
    if (!results.samples.remoteSkillSeen) {
      const st = await A.page.evaluate(() => window.__mpWorld.remoteInfo().map((r) => r.state)).catch(() => []);
      if (st.includes("Skill")) results.samples.remoteSkillSeen = true;
    }
    if (!shotFight && ma2 && ma2.hp < ma2.maxHp) {
      mark("firstHit");
      await sleep(250);
      await shot(A, "04_field_coop_A");
      await shot(B, "04_field_coop_B_iphone");
      shotFight = true;
    }
    if (ma2 && mb2 && ma2.hp === 0 && mb2.hp === 0) break;
    await sleep(120);
  }
  mark("fightEnd");
  await drive(A, 0, 0);
  await drive(B, 0, 0);
  await sleep(600);
  const [mA, mB, fldA, fldB] = await Promise.all([monOf(A, targetId), monOf(B, targetId), field(A), field(B)]);
  const same = hpSamples.filter((x) => x[0] === x[1]).length;
  results.samples.coop = { targetId, seconds: (Date.now() - tFight) / 1000, samples: hpSamples.length, sameHpRatio: +(same / Math.max(1, hpSamples.length)).toFixed(3), hpTrailA: hpSamples.slice(-12).map((x) => x[0]), A: fldA, B: { ...fldB, monsterHp: undefined } };
  check("A、B 合作把同一隻怪打倒（兩邊都看到 HP 0、死亡）", mA?.hp === 0 && mB?.hp === 0 && ["death", "dead"].includes(mA.state) && ["death", "dead"].includes(mB.state), { mA, mB });
  check("戰鬥中兩邊看到的怪物 HP 一致（同一份伺服器狀態；≥ 85% 取樣相同）", same / Math.max(1, hpSamples.length) >= 0.85, { same, total: hpSamples.length });
  check("A 的攻擊與 B 的技能都被伺服器接受、兩人都打出傷害（B 法杖用魔法彈）", fldA.attacksOk > 0 && fldB.skillsOk > 0 && fldA.damageDealt > 0 && fldB.damageDealt > 0, { A: { sent: fldA.attacksSent, ok: fldA.attacksOk, rej: fldA.attacksRejected, dmg: fldA.damageDealt }, B: { skills: fldB.skillsOk, dmg: fldB.damageDealt, last: fldB.lastReject } });
  check("傷害數字顯示伺服器結果（兩邊都有命中特效）", fldA.hitsShown > 0 && fldB.hitsShown > 0, { A: fldA.hitsShown, B: fldB.hitsShown });
  check("其他玩家的技能特效依伺服器施放事件播放（A 看到 B 的施放）", fldA.remoteCastsShown > 0, { remoteCasts: fldA.remoteCastsShown, vfx: fldA.vfx });
  const skA = await A.page.evaluate(() => window.__mpWorld.skillAnim);
  check("其他玩家播 Claude C 的技能動作（A 看到 B 的魔法彈動作，不是普通攻擊）", skA.started >= 1, { ...skA, sampledState: results.samples.remoteSkillSeen ?? false });
  results.samples.audio = { A: fldA.audio, B: fldB.audio };
  if (browserName === "chromium") check("戰鬥音效：點擊畫面後 A 的攻擊／命中有播放（Claude C Stage 3 音效）", (fldA.audio?.played ?? 0) > 0, fldA.audio);
  check("戰鬥特效共用 Claude A 的原野戰鬥表現（沒有第二套特效系統）、戰鬥音效已建立", fldA.sharedFx === true && fldB.sharedFx === true && !!fldA.audio && !!fldB.audio, { A: { shared: fldA.sharedFx, audio: fldA.audio }, B: { shared: fldB.sharedFx, audio: fldB.audio } });
  fiA = await fieldInfo(A);
  fiB = await fieldInfo(B);
  check("畫面分級不影響伺服器結果：A 開啟怪物距離分級、B 關閉，兩邊看到的血量一致", fiA.detail?.on === true && fiB.detail?.on === false, { A: fiA.detail, B: fiB.detail });
  check("兩人都拿到經驗（伺服器結算，擊殺只結算一次）", fldA.self?.exp > 0 && fldB.self?.exp > 0, { A: fldA.self, B: fldB.self });
  await shot(A, "05_field_coop_kill_A");
  // ---------- 掉落物：伺服器產生（UUID、歸屬＝傷害最高者）；歸屬者靠近自動撿（伺服器判定） ----------
  const m0 = await metrics();
  const cb0 = (m0.combat ?? [])[0] ?? {};
  const pidA = fa.mp.pid;
  const tL = Date.now();
  while (Date.now() - tL < 40000) {
    const left = await A.page.evaluate(() => [...window.__mpWorld.client.loot.values()].map((l) => ({ uid: l.uid, x: l.x, z: l.z, o: l.ownerPid })));
    if (!left.length) break;
    const l = left[0];
    const P = l.o === pidA ? A : B;
    await walk(P, [{ x: l.x, z: l.z }], async () => {
      const i = await finfo(P).catch(() => null);
      return i ? [i.pos[0], i.pos[2]] : null;
    }, async () => !(await P.page.evaluate((u) => window.__mpWorld.client.loot.has(u), l.uid).catch(() => false)), 20000);
    await sleep(400);
  }
  await sleep(600);
  const m1 = await metrics();
  const cb1 = (m1.combat ?? [])[0] ?? {};
  const [lA, lB] = await Promise.all([field(A), field(B)]);
  const leftA = await A.page.evaluate(() => window.__mpWorld.client.loot.size);
  const leftB = await B.page.evaluate(() => window.__mpWorld.client.loot.size);
  results.samples.loot = { spawned: cb1.lootSpawned, picked: cb1.lootPicked, rejected: cb1.lootPickRejected, killsSettled: cb1.killsSettled, duplicateKillsBlocked: cb1.duplicateKillsBlocked, picksOk: { A: lA.picksOk, B: lB.picksOk }, gold: { A: lA.self?.gold, B: lB.self?.gold }, leftA, leftB, before: { spawned: cb0.lootSpawned, picked: cb0.lootPicked } };
  check("掉落物由伺服器產生、撿取後兩邊畫面都消失（每件只入帳一次）", cb1.lootSpawned >= 1 && cb1.lootPicked === cb1.lootSpawned && lA.picksOk + lB.picksOk === cb1.lootPicked && leftA === 0 && leftB === 0, results.samples.loot);
  check("擊殺只結算一次（伺服器沒有重複結算）", cb1.killsSettled >= 1 && cb1.duplicateKillsBlocked === 0, { killsSettled: cb1.killsSettled, dup: cb1.duplicateKillsBlocked });
  check("撿到的金幣由伺服器入帳（起始 100 金幣以上）", (lA.self?.gold ?? 0) + (lB.self?.gold ?? 0) > 200, results.samples.loot.gold);
  mark("lootDone");
  // ---------- 重生同步 ----------
  const tR = Date.now();
  let rA2 = null, rB2 = null;
  while (Date.now() - tR < 40000) {
    [rA2, rB2] = await Promise.all([monOf(A, targetId).catch(() => null), monOf(B, targetId).catch(() => null)]);
    if (rA2 && rB2 && rA2.hp === rA2.maxHp && rB2.hp === rB2.maxHp && rA2.state !== "dead" && rB2.state !== "dead") break;
    await sleep(300);
  }
  mark("respawned");
  check("怪物重生同步（兩邊都看到滿血、位置一致 < 0.5 m）", rA2?.hp === rA2?.maxHp && rB2?.hp === rB2?.maxHp && Math.hypot(rA2.x - rB2.x, rA2.z - rB2.z) < 0.5, { secs: (Date.now() - tR) / 1000, rA2, rB2 });
  const mHits = fldA.monsterHitsTaken + fldB.monsterHitsTaken;
  results.samples.monsterAttacks = { A: fldA.monsterHitsTaken, B: fldB.monsterHitsTaken };
  check("客戶端不能自行宣告倒地（原野的 act 由伺服器忽略）", await (async () => {
    await A.page.evaluate(() => window.__mpWorld.act("death"));
    await sleep(600);
    return (await A.page.evaluate(() => window.__mpWorld.client.down)) === false;
  })());
  void mHits;
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

  // ---------- 從原野營地傳送陣走回星芽村（B）；A 用倒地復活回村 ----------
  const toCamp = async (p) => {
    p.recording = false;
    const back = [...(p.trail ?? [])].reverse();
    await walk(p, [...back, { x: -56, z: -64 }, { x: -56, z: -68 }], async () => {
      const i = await finfo(p).catch(() => null);
      return i ? [i.pos[0], i.pos[2]] : null;
    }, async () => !(await p.page.evaluate(() => !!window.__starwishPlay?.ready).catch(() => false)), 300000);
  };
  const keepA = (await field(A)).self;
  await toCamp(B);
  await waitVillage(B);
  await toCamp(A);
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
  check("A、B 走入原野營地傳送陣回到星芽村", a.mp.room.startsWith("village") && b.mp.room.startsWith("village"), { a: a.mp.room, b: b.mp.room });
  const selfA = await A.page.evaluate(() => window.__mpWorld.client.self);
  check("回村後等級／經驗／金幣沿用（伺服器保存）", !!selfA && selfA.level === keepA.level && selfA.exp === keepA.exp && selfA.gold === keepA.gold, { field: keepA, village: selfA });
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
  for (const p of players) await p.ctx.close().catch(() => {});
  await browser.close();
  site.close?.();
  srv.kill("SIGTERM");
  results.passed = results.checks.filter((c) => c.ok).length;
  results.total = results.checks.length;
  results.serverLogTail = srvLog.split("\n").slice(-30);
  writeFileSync(join(outDir, `${TAG}mp-e2e-${browserName}.json`), JSON.stringify(results, null, 2));
  console.log(`${results.passed}/${results.total} passed (${browserName})`);
  process.exit(results.passed === results.total && results.total > 0 ? 0 : 1);
}
