/**
 * Stage 8.5 多人效能測試：10／20／32／40 位模擬玩家同時移動、攻擊、施放技能（含位移技能），
 * 同時加上斷線重連、延遲（部分機器人 120±40 ms）、格式錯誤封包。
 * 伺服器以「獨立子行程」執行，從 /metrics 讀取伺服器 CPU、記憶體、每 tick 時間、網路流量。
 *
 * ⚠ 這是 CI 主機（或本機）上的伺服器數據，不是 iPhone 實機結果；iPhone 畫面效能只能由實機測試填寫。
 *
 * 執行：node tests/load-stage85.ts [秒數，預設 20] [人數清單，預設 10,20,32,40]
 * 結果：test-results/load85.json、test-results/load85.md；任一情境不合格時結束碼 1。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { NetClient } from "../client/NetClient.ts";
import type { CombatEvent } from "../shared/protocol.ts";
import { PROTOCOL_VERSION } from "../shared/constants.ts";

const DURATION_S = Number(process.argv[2] ?? 20);
const COUNTS = (process.argv[3] ?? "10,20,32,40").split(",").map(Number);
const PORT = 25000 + Math.floor(Math.random() * 2000);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** 合格標準（測試設定）：伺服器 20 Hz，一個 tick 50 ms；平均 < 10 ms、最大 < 50 ms、全部機器人最後都在線、伺服器沒有當機 */
const LIMITS = { tickAvgMs: 10, tickMaxMs: 50, maxCorrectionCm: 200 };
const SKILLS = ["triple_slash", "leap_slam", "charge_burst", "whirlwind"];

async function startServerProcess(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["server/main.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", MP_DEV: "1", MP_GRACE_MS: "8000", MP_ROOM_CAPACITY: "50", MP_MAX_PLAYERS: "200", DATABASE_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout!.on("data", (d) => (log += d));
  child.stderr!.on("data", (d) => (log += d));
  for (let i = 0; i < 200; i++) {
    const ok = await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.ok).catch(() => false);
    if (ok) return child;
    if (child.exitCode !== null) throw new Error("server exited: " + log.slice(-500));
    await sleep(100);
  }
  throw new Error("server did not start: " + log.slice(-500));
}
type Metrics = { process: { cpuPct: number | null; rssMB: number; heapUsedMB: number }; tick: { avgMs: number; maxMs: number; count: number }; netPerSec: { bytesIn: number; bytesOut: number; msgsIn: number; msgsOut: number }; connections: number; players: number; stats?: Record<string, number> };
const metrics = (): Promise<Metrics | null> => fetch(`http://127.0.0.1:${PORT}/metrics`).then((r) => r.json() as Promise<Metrics>).catch(() => null);

interface Sim {
  c: NetClient;
  dir: { x: number; z: number };
  lagged: boolean;
  res: Map<string, number>;
  errs: Map<string, number>;
  casts: number;
  disp: number;
  welcomes: number;
  nextAct: number;
  nextSkill: number;
  turnAt: number;
  skillIdx: number;
}

async function scenario(n: number) {
  const sims: Sim[] = [];
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const lagged = i % 5 === 0;
    const s: Sim = { c: null as unknown as NetClient, dir: { x: 0, z: 0 }, lagged, res: new Map(), errs: new Map(), casts: 0, disp: 0, welcomes: 0, nextAct: 0, nextSkill: 1 + (i % 7) * 0.4, turnAt: 0, skillIdx: i % SKILLS.length };
    s.c = new NetClient({
      url: `ws://127.0.0.1:${PORT}/ws`,
      name: `load${n}_${i}`,
      devMap: "starsprout",
      ...(lagged ? { lagMs: 120, jitterMs: 40 } : {}),
      onEvent: (e) => {
        if (e.type === "welcome") s.welcomes++;
        if (e.type === "cmd") {
          if (e.ok) s.res.set("ok", (s.res.get("ok") ?? 0) + 1);
          else s.errs.set(e.err ?? "?", (s.errs.get(e.err ?? "?") ?? 0) + 1);
        }
      },
      onCombat: (e: CombatEvent) => {
        if (e.k === "cast" && e.p === s.c.pid) {
          s.casts++;
          if (e.md) {
            s.disp++;
            s.c.holdInput(e.md + 60);
          }
        }
      },
    });
    s.c.connect();
    sims.push(s);
    await sleep(15);
  }
  const deadline = Date.now() + 10000;
  while (sims.some((s) => s.c.state !== "online") && Date.now() < deadline) await sleep(20);
  const joinMs = Math.round(performance.now() - t0);
  const onlineAtStart = sims.filter((s) => s.c.state === "online").length;

  // 格式錯誤封包：一條連線持續送壞資料（被斷開就重開）
  const junk = { sent: 0, reopened: 0 };
  let junkWs: WebSocket | null = null;
  const junkTimer = setInterval(() => {
    if (!junkWs || junkWs.readyState > 1) {
      junkWs = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
      junk.reopened++;
      junkWs.onopen = () => junkWs?.send(JSON.stringify({ t: "hello", v: PROTOCOL_VERSION, name: "junk", devMap: "starsprout" }));
      junkWs.onerror = () => {};
      return;
    }
    if (junkWs.readyState !== 1) return;
    const bad = ["{", JSON.stringify({ t: "in", e: 0, s: -1, d: "x" }), JSON.stringify({ t: "cmd", id: 5, k: {} }), JSON.stringify({ t: "cmd", id: "j-" + junk.sent, k: "trade", p: { op: "accept", tid: 1 } }), "x".repeat(5000)];
    junkWs.send(bad[junk.sent % bad.length]!);
    junk.sent++;
  }, 100);

  // 斷線重連：每 2 秒讓一位機器人斷線（自動重連）
  let drops = 0;
  const dropTimer = setInterval(() => {
    const s = sims[(drops * 7) % sims.length]!;
    if (s.c.state === "online") {
      s.c.dropConnection();
      drops++;
    }
  }, 2000);

  // 每幀：移動（朝最近怪物前進、偶爾隨機轉向）＋攻擊＋技能
  let last = performance.now();
  const samples: Metrics[] = [];
  await metrics(); // 歸零 CPU 量測區間
  const tStart = performance.now();
  let nextSample = tStart + 1000;
  while (performance.now() - tStart < DURATION_S * 1000) {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    const tsec = (now - tStart) / 1000;
    for (const s of sims) {
      if (s.c.state === "online" && s.c.self) {
        const me = s.c.renderPos;
        let best: { nid: number; x: number; z: number; d: number } | null = null;
        for (const m of s.c.monsters()) {
          if (m.hp <= 0) continue;
          const d = Math.hypot(m.x - me.x, m.z - me.z);
          if (!best || d < best.d) best = { nid: m.nid, x: m.x, z: m.z, d };
        }
        if (tsec >= s.turnAt) {
          s.turnAt = tsec + 1 + Math.random() * 2;
          if (best && best.d > 2.2 && best.d < 25 && Math.random() < 0.7) s.dir = { x: (best.x - me.x) / best.d, z: (best.z - me.z) / best.d };
          else {
            const a = Math.random() * Math.PI * 2;
            s.dir = { x: Math.cos(a), z: Math.sin(a) };
          }
        }
        if (best && tsec >= s.nextAct && best.d < 3.2) {
          s.c.command("atk", { t: best.nid });
          s.nextAct = tsec + 0.55 + Math.random() * 0.3;
        }
        if (tsec >= s.nextSkill) {
          const sk = SKILLS[s.skillIdx++ % SKILLS.length]!;
          s.c.command("sk", { s: sk, t: best && best.d < 3 ? best.nid : 0, y: Math.round(Math.atan2(s.dir.x, s.dir.z) * 1000) });
          s.nextSkill = tsec + 2.6 + Math.random() * 1.5;
        }
      }
      s.c.update(dt, s.dir.x, s.dir.z);
    }
    if (now >= nextSample) {
      nextSample += 1000;
      const m = await metrics();
      if (m) samples.push(m);
    }
    await sleep(1000 / 60);
  }
  clearInterval(junkTimer);
  clearInterval(dropTimer);
  // 讓斷線的機器人重連完成
  const rdl = Date.now() + 10000;
  while (sims.some((s) => s.c.state !== "online") && Date.now() < rdl) {
    for (const s of sims) s.c.update(1 / 60, 0, 0);
    await sleep(16);
  }
  const final = await metrics();
  const onlineAtEnd = sims.filter((s) => s.c.state === "online").length;
  const errs: Record<string, number> = {};
  for (const s of sims) for (const [k, v] of s.errs) errs[k] = (errs[k] ?? 0) + v;
  const sum = (f: (s: Sim) => number) => sims.reduce((a, s) => a + f(s), 0);
  const cpu = samples.map((m) => m.process.cpuPct ?? 0);
  const tickAvg = samples.length ? samples.reduce((a, m) => a + m.tick.avgMs, 0) / samples.length : NaN;
  const tickMax = samples.length ? Math.max(...samples.map((m) => m.tick.maxMs)) : NaN;
  const out = {
    players: n,
    durationS: DURATION_S,
    joinMs,
    onlineAtStart,
    onlineAtEnd,
    laggedBots: sims.filter((s) => s.lagged).length,
    server: {
      cpuPctAvg: +(cpu.reduce((a, b) => a + b, 0) / Math.max(1, cpu.length)).toFixed(1),
      cpuPctMax: Math.max(0, ...cpu),
      rssMBMax: Math.max(0, ...samples.map((m) => m.process.rssMB)),
      heapMBMax: Math.max(0, ...samples.map((m) => m.process.heapUsedMB)),
      tickAvgMs: +tickAvg.toFixed(3),
      tickMaxMs: +tickMax.toFixed(3),
      bytesOutPerSecAvg: Math.round(samples.reduce((a, m) => a + m.netPerSec.bytesOut, 0) / Math.max(1, samples.length)),
      bytesInPerSecAvg: Math.round(samples.reduce((a, m) => a + m.netPerSec.bytesIn, 0) / Math.max(1, samples.length)),
      msgsOutPerSecAvg: Math.round(samples.reduce((a, m) => a + m.netPerSec.msgsOut, 0) / Math.max(1, samples.length)),
      bytesOutPerPlayerPerSec: Math.round(samples.reduce((a, m) => a + m.netPerSec.bytesOut, 0) / Math.max(1, samples.length) / n),
    },
    clients: {
      cmdsOk: sum((s) => s.res.get("ok") ?? 0),
      cmdErrors: errs,
      castsSeen: sum((s) => s.casts),
      displacements: sum((s) => s.disp),
      reconnects: sum((s) => s.c.stats.reconnects),
      drops,
      maxCorrectionCm: Math.max(...sims.map((s) => s.c.stats.maxCorrectionCm)),
      snapCorrections: sum((s) => s.c.stats.snapCorrections),
    },
    junk,
    finalStats: final ? { badMessages: (final as unknown as { totals?: Record<string, number> }).totals?.badMessages, kicked: (final as unknown as { totals?: Record<string, number> }).totals?.kicked } : null,
    samples: samples.length,
  };
  const pass = out.onlineAtEnd === n && out.server.tickAvgMs < LIMITS.tickAvgMs && out.server.tickMaxMs < LIMITS.tickMaxMs && out.clients.castsSeen > 0 && out.clients.displacements > 0 && out.clients.maxCorrectionCm < LIMITS.maxCorrectionCm;
  for (const s of sims) s.c.close();
  await sleep(500);
  return { ...out, pass };
}

const child = await startServerProcess();
const all: Awaited<ReturnType<typeof scenario>>[] = [];
let crashed = false;
child.on("exit", (code) => {
  if (code !== null && code !== 0) crashed = true;
});
try {
  for (const n of COUNTS) {
    const r = await scenario(n);
    all.push(r);
    console.log(`${n} 人：${r.pass ? "合格" : "不合格"} tick 平均 ${r.server.tickAvgMs} ms／最大 ${r.server.tickMaxMs} ms、CPU 平均 ${r.server.cpuPctAvg}%、記憶體 ${r.server.rssMBMax} MB、下行 ${r.server.bytesOutPerSecAvg} B/s、在線 ${r.onlineAtEnd}/${n}、重連 ${r.clients.reconnects}、位移技能 ${r.clients.displacements}`);
    await sleep(1500);
  }
} finally {
  child.kill("SIGTERM");
}
const env = { node: process.version, cpu: cpus()[0]?.model, cores: cpus().length, memGB: +(totalmem() / 1073741824).toFixed(1), ci: !!process.env.CI };
const report = { note: "CI／本機伺服器數據，不是 iPhone 實機結果（iPhone 畫面效能由實機測試填寫）", limits: LIMITS, env, crashed, scenarios: all };
mkdirSync(new URL("../test-results/", import.meta.url), { recursive: true });
writeFileSync(new URL("../test-results/load85.json", import.meta.url), JSON.stringify(report, null, 2));
const md = [
  "# Stage 8.5 多人效能測試（伺服器數據）",
  "",
  `> ${report.note}`,
  "",
  `環境：Node ${env.node}、${env.cpu}（${env.cores} 核）、${env.memGB} GB${env.ci ? "（GitHub Actions）" : ""}；每個情境 ${DURATION_S} 秒；20% 機器人加 120±40 ms 延遲；每 2 秒一位斷線重連；一條連線持續送格式錯誤封包。`,
  "",
  "| 人數 | 結果 | tick 平均 | tick 最大 | CPU 平均／最高 | 記憶體 | 下行 B/s（每人） | 上行 B/s | 在線 | 重連 | 位移技能 | 最大校正 |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...all.map((r) => `| ${r.players} | ${r.pass ? "合格" : "不合格"} | ${r.server.tickAvgMs} ms | ${r.server.tickMaxMs} ms | ${r.server.cpuPctAvg}%／${r.server.cpuPctMax}% | ${r.server.rssMBMax} MB | ${r.server.bytesOutPerSecAvg}（${r.server.bytesOutPerPlayerPerSec}） | ${r.server.bytesInPerSecAvg} | ${r.onlineAtEnd}/${r.players} | ${r.clients.reconnects} | ${r.clients.displacements} | ${r.clients.maxCorrectionCm} cm |`),
  "",
  `合格標準（測試設定）：tick 平均 < ${LIMITS.tickAvgMs} ms、最大 < ${LIMITS.tickMaxMs} ms（20 Hz 一個 tick 50 ms）、結束時全部在線、有技能與位移技能同步、一般校正 < ${LIMITS.maxCorrectionCm / 100} m（重連、換地圖的完整重新同步不算）、伺服器未當機。`,
].join("\n");
writeFileSync(new URL("../test-results/load85.md", import.meta.url), md + "\n");
console.log(md);
if (crashed || all.some((r) => !r.pass)) process.exit(1);
process.exit(0);
