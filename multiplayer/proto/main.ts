/**
 * Stage 8.0 本機雙人測試頁（俯視 2D 偵錯畫面，不是正式遊戲畫面）。
 * 用途：驗證多人連線（互相看見、位置／朝向／Idle／Run 同步、預測校正、插值、斷線重連、傳送陣換地圖）。
 * 正式 3D 角色整合在 Stage 8.1 由 Claude A 的遊戲本體接上（見報告）。
 *
 * 網址參數：?name=小明&g=female&lag=120&jitter=40&map=starsprout&server=ws://host:2567/ws
 */
import { NetClient, type NetEvent } from "../client/NetClient.ts";
import { getMap } from "../shared/maps.ts";
import { ANIM_NAME, type Gender, type MapId } from "../shared/protocol.ts";

const q = new URLSearchParams(location.search);
const wsUrl = q.get("server") ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
const tokenKey = `starwish-mp-token-${q.get("slot") ?? "default"}`;
let storedToken: string | null = null;
try {
  storedToken = sessionStorage.getItem(tokenKey);
} catch {
  storedToken = null;
}

const log: string[] = [];
const addLog = (s: string): void => {
  log.unshift(`${new Date().toLocaleTimeString()} ${s}`);
  log.length = Math.min(log.length, 8);
};

const client = new NetClient({
  url: wsUrl,
  name: q.get("name") ?? undefined,
  gender: (q.get("g") as Gender | null) ?? "male",
  devMap: (q.get("map") as MapId | null) ?? undefined,
  lagMs: Number(q.get("lag") ?? 0),
  jitterMs: Number(q.get("jitter") ?? 0),
  resumeToken: storedToken ?? undefined,
  onEvent: (e: NetEvent) => {
    if (e.type === "welcome") {
      addLog(`${e.resumed ? "重新接回" : "加入"} 玩家#${e.pid} ${e.map}`);
      try {
        if (client.token) sessionStorage.setItem(tokenKey, client.token);
      } catch {
        /* 私密瀏覽 */
      }
    } else if (e.type === "resynced") addLog(`完整同步完成（斷線到恢復 ${e.ms} ms）`);
    else if (e.type === "map") addLog(`傳送 → ${e.map}`);
    else if (e.type === "state") addLog(`連線狀態：${e.state}`);
    else if (e.type === "error") addLog(`錯誤 ${e.code}：${e.msg}`);
    else if (e.type === "cmd") addLog(`指令 ${e.ok ? "成功" : "失敗"}${e.dup ? "（重送，未重複執行）" : ""}`);
  },
});
client.connect();

// ---------------- 輸入：鍵盤＋觸控搖桿 ----------------
const keys = new Set<string>();
addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
const joy = { active: false, id: -1, cx: 0, cy: 0, x: 0, y: 0 };
const canvas = document.getElementById("view") as HTMLCanvasElement;
canvas.addEventListener("pointerdown", (e) => {
  joy.active = true;
  joy.id = e.pointerId;
  joy.cx = e.clientX;
  joy.cy = e.clientY;
  joy.x = joy.y = 0;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!joy.active || e.pointerId !== joy.id) return;
  const dx = (e.clientX - joy.cx) / 60;
  const dy = (e.clientY - joy.cy) / 60;
  const l = Math.hypot(dx, dy);
  joy.x = l > 1 ? dx / l : dx;
  joy.y = l > 1 ? dy / l : dy;
});
const endJoy = (e: PointerEvent): void => {
  if (e.pointerId === joy.id) {
    joy.active = false;
    joy.x = joy.y = 0;
  }
};
canvas.addEventListener("pointerup", endJoy);
canvas.addEventListener("pointercancel", endJoy);

/** 測試自動化可設定的輸入（Playwright 用） */
const auto = { x: 0, z: 0, on: false };

function input(): { x: number; z: number } {
  if (auto.on) return { x: auto.x, z: auto.z };
  let x = 0;
  let z = 0;
  if (keys.has("w") || keys.has("arrowup")) z += 1;
  if (keys.has("s") || keys.has("arrowdown")) z -= 1;
  if (keys.has("d") || keys.has("arrowright")) x += 1;
  if (keys.has("a") || keys.has("arrowleft")) x -= 1;
  if (joy.active) {
    x += joy.x;
    z -= joy.y;
  }
  const l = Math.hypot(x, z);
  return l > 1 ? { x: x / l, z: z / l } : { x, z };
}

// ---------------- 地圖底圖（直接用伺服器同一份合法區域判定繪製） ----------------
const BOUNDS: Record<MapId, number> = { village: 58, starsprout: 100 };
const mapImages = new Map<MapId, HTMLCanvasElement>();
function mapImage(id: MapId): HTMLCanvasElement {
  let c = mapImages.get(id);
  if (c) return c;
  const m = getMap(id);
  const R = BOUNDS[id];
  const res = id === "village" ? 0.5 : 1;
  const n = Math.round((2 * R) / res);
  c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  const img = g.createImageData(n, n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -R + (i + 0.5) * res;
      const z = R - (j + 0.5) * res;
      const ok = m.legal(x, z);
      const k = (j * n + i) * 4;
      img.data[k] = ok ? 120 : 30;
      img.data[k + 1] = ok ? 170 : 34;
      img.data[k + 2] = ok ? 110 : 52;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  mapImages.set(id, c);
  return c;
}

// ---------------- 繪圖 ----------------
const ctx = canvas.getContext("2d")!;
const hud = document.getElementById("hud")!;
let fpsFrames = 0;
let fpsAt = performance.now();
let last = performance.now();
const PX = 9; // 每公尺像素

function frame(t: number): void {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  fpsFrames++;
  if (t - fpsAt >= 1000) {
    client.stats.fps = Math.round((fpsFrames * 1000) / (t - fpsAt));
    fpsFrames = 0;
    fpsAt = t;
  }
  const inp = input();
  client.update(dt, inp.x, inp.z);

  const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
  const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
  const s = PX * devicePixelRatio;
  ctx.fillStyle = "#1a1d2e";
  ctx.fillRect(0, 0, w, h);
  const me = client.renderPos;
  const sx = (x: number): number => w / 2 + (x - me.x) * s;
  const sy = (z: number): number => h / 2 - (z - me.z) * s;
  if (client.map) {
    const id = client.map.id;
    const img = mapImage(id);
    const R = BOUNDS[id];
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, sx(-R), sy(R), 2 * R * s, 2 * R * s);
    for (const p of client.map.portals) {
      ctx.strokeStyle = "#9fd8ff";
      ctx.lineWidth = 2 * devicePixelRatio;
      ctx.beginPath();
      ctx.arc(sx(p.x), sy(p.z), p.triggerR * s, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const drawActor = (x: number, z: number, yaw: number, color: string, label: string, ghost = false): void => {
    ctx.globalAlpha = ghost ? 0.45 : 1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx(x), sy(z), 0.45 * s, 0, Math.PI * 2);
    ctx.fill();
    // 朝向：Babylon yaw = atan2(dirX, dirZ)
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2 * devicePixelRatio;
    ctx.beginPath();
    ctx.moveTo(sx(x), sy(z));
    ctx.lineTo(sx(x + Math.sin(yaw) * 0.9), sy(z + Math.cos(yaw) * 0.9));
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `${12 * devicePixelRatio}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(label, sx(x), sy(z) - 0.7 * s);
    ctx.globalAlpha = 1;
  };
  // 伺服器權威位置（虛線圈）：可看到預測與校正
  ctx.strokeStyle = "#ffd36b";
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(sx(client.server.x), sy(client.server.z), 0.5 * s, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const r of client.remotes()) {
    drawActor(r.x, r.z, r.yaw, r.gender === "female" ? "#ff8fc1" : "#6fb6ff", `${r.name} ${ANIM_NAME[r.anim] ?? r.anim}${r.link ? "" : "（斷線中）"}`, !r.link);
  }
  drawActor(me.x, me.z, me.yaw, "#ffd36b", `我 ${ANIM_NAME[me.anim] ?? me.anim}`);

  const st = client.stats;
  hud.textContent = [
    `狀態 ${st.state}　地圖 ${st.map ?? "-"}　房間 ${st.room}　玩家#${st.pid}`,
    `FPS ${st.fps}　延遲 RTT ${st.rttMs} ms（平均 ${st.rttAvgMs}）　抖動 ${st.jitterMs} ms`,
    `上傳 ${st.bytesUpPerSec} B/s（${st.msgsUpPerSec} 包/秒）　下載 ${st.bytesDownPerSec} B/s（${st.msgsDownPerSec} 包/秒）　快照 ${st.snapsPerSec}/秒`,
    `同場人數 ${st.players}　待確認輸入 ${st.pendingInputs}　校正 ${st.corrections} 次（最近 ${st.lastCorrectionCm} cm、最大 ${st.maxCorrectionCm} cm）`,
    `重連 ${st.reconnects} 次　最近恢復 ${st.lastResyncMs} ms　伺服器 tick ${st.serverTick}`,
    `位置 (${me.x.toFixed(2)}, ${me.z.toFixed(2)})`,
    ...log,
  ].join("\n");
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.getElementById("drop")!.addEventListener("click", () => client.dropConnection());
document.getElementById("wave")!.addEventListener("click", () => client.command("emote", { e: "wave" }));

// 測試介面
(window as unknown as { __mp: unknown }).__mp = { client, auto, log };
