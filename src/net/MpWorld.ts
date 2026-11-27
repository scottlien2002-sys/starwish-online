/**
 * Stage 8.1｜正式 3D 遊戲的多人連線接點（Claude D）。只在 ?play=world&mp=1 時載入；單機模式完全不經過這裡。
 *
 * - 本地玩家：移動輸入交給 NetClient（客戶端預測＋伺服器校正），位置／朝向以伺服器權威結果為準
 * - 遠端玩家：Claude A 的 Stage 7.2 模組化初心者（性別、髮型、髮色、武器依伺服器資料），Idle／Run／Attack／Hurt／Death
 * - 傳送陣：由伺服器判定；收到換地圖通知後沿用 WorldSession.travelTo（存檔後切換頁面），新頁面用憑證接回同一角色
 * - N009 洛恩：巡邏時間與停下／面向對象由伺服器決定（所有玩家看到同一個洛恩）
 * - 怪物與戰鬥：Stage 8.2 前仍是各自客戶端的單機行為；這裡只同步動作外觀（畫面標示）
 */
import { Color3, Matrix, Vector3, type AbstractMesh, type Scene } from "@babylonjs/core";
import { NetClient, type NetEvent, type RemotePlayer } from "../../multiplayer/client/NetClient.ts";
import { ANIM } from "../../multiplayer/shared/protocol.ts";
import type { ActKind, AppearanceWire, Gender, MapId } from "../../multiplayer/shared/protocol.ts";
import { NoviceAvatar, type NoviceLod } from "../characters/NoviceAvatar.ts";

const TOKEN_KEY = "starwish.mp81.token";
const SERVER_KEY = "starwish.mp81.server";

/** 連線設定：?server= → 上次使用的網址 → 建置時設定（VITE_MP_SERVER） → 本機開發預設 */
export function mpServerUrl(params: URLSearchParams): string | null {
  const q = params.get("server");
  const ls = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  if (q) {
    const u = normalizeServer(q);
    if (u) ls?.setItem(SERVER_KEY, u);
    return u;
  }
  const saved = ls?.getItem(SERVER_KEY);
  if (saved) return saved;
  const built = (import.meta.env as Record<string, string | undefined>).VITE_MP_SERVER;
  if (built) return normalizeServer(built);
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return "ws://127.0.0.1:2567/ws";
  return null;
}

/** 接受 https://xxx.onrender.com、wss://xxx/ws、xxx.onrender.com 等寫法 */
export function normalizeServer(s: string): string | null {
  let u = s.trim();
  if (!u) return null;
  if (!/^[a-z]+:\/\//i.test(u)) u = `wss://${u}`;
  u = u.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  try {
    const url = new URL(u);
    if (url.protocol !== "wss:" && url.protocol !== "ws:") return null;
    if (url.pathname === "/" || url.pathname === "") url.pathname = "/ws";
    return url.toString();
  } catch {
    return null;
  }
}

export function isMpMode(params: URLSearchParams): boolean {
  return params.get("mp") === "1";
}

interface RemoteView {
  id: number;
  key: string;
  avatar: NoviceAvatar | null;
  loading: boolean;
  label: HTMLDivElement;
  lastActSeq: number;
  lastX: number;
  lastZ: number;
  speed: number;
  link: number;
  dead: boolean;
}

export interface MpStep {
  x: number;
  z: number;
  yaw: number;
  speed: number;
}

export class MpWorld {
  readonly client: NetClient;
  private readonly hudRoot: HTMLElement;
  private readonly bar: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private scene: Scene | null = null;
  private lod: NoviceLod = "lite";
  private ground: (x: number, z: number) => number = () => 0;
  private readonly remotes = new Map<number, RemoteView>();
  private mapHandler: ((map: MapId, me: { x: number; z: number; yaw: number }) => void) | null = null;
  private fpsFn: () => number = () => 0;
  private barTimer = 0;
  private roanHeld = false;
  private roanSent = 0;
  readonly baseUrl = `${import.meta.env.BASE_URL}models/`;
  private readonly proj = new Vector3();
  private readonly tmp = new Vector3();

  private constructor(client: NetClient, hudRoot: HTMLElement) {
    this.client = client;
    this.hudRoot = hudRoot;
    const st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);
    this.bar = document.createElement("div");
    this.bar.className = "mp-bar";
    this.bar.addEventListener("click", () => this.detail.classList.toggle("open"));
    this.detail = document.createElement("div");
    this.detail.className = "mp-detail";
    document.body.append(this.bar, this.detail);
  }

  /**
   * 連線並等待伺服器歡迎訊息（免費主機休眠時喚醒約需 1 分鐘：畫面顯示等待中，自動重試）。
   * 失敗會丟出錯誤，呼叫端可回到單機或顯示訊息。
   */
  static async connect(o: { url: string; gender: Gender; appearance: AppearanceWire; name?: string; hudRoot: HTMLElement; status: (s: string) => void }): Promise<MpWorld> {
    let token: string | null = null;
    try {
      token = window.sessionStorage.getItem(TOKEN_KEY);
    } catch {
      token = null;
    }
    const events: NetEvent[] = [];
    let self: MpWorld | null = null;
    const client = new NetClient({
      url: o.url,
      name: o.name,
      gender: o.gender,
      ap: o.appearance,
      resumeToken: token ?? undefined,
      onEvent: (e) => {
        events.push(e);
        self?.onEvent(e);
      },
    });
    self = new MpWorld(client, o.hudRoot);
    // 自動測試與診斷用掛點（唯讀資訊與測試輸入；仍經過伺服器權威判定）
    (window as unknown as { __mpWorld?: MpWorld }).__mpWorld = self;
    const t0 = performance.now();
    client.connect();
    // NetClient.update 驅動送收；等待期間由這裡自己驅動
    await new Promise<void>((resolve, reject) => {
      const tick = (): void => {
        client.update(1 / 30, 0, 0);
        const err = events.find((e) => e.type === "error") as { code: string; msg: string } | undefined;
        if (err && (err.code === "proto" || err.code === "full" || err.code === "replaced")) return reject(new Error(err.msg));
        if (client.state === "online" && client.map) return resolve();
        const s = Math.round((performance.now() - t0) / 1000);
        o.status(s < 4 ? "連線多人伺服器…" : `連線多人伺服器…（${s} 秒；免費測試主機休眠中時喚醒約需 1 分鐘）`);
        if (s > 120) return reject(new Error("無法連線多人伺服器（逾時 120 秒）"));
        window.setTimeout(tick, 33);
      };
      tick();
    });
    try {
      if (client.token) window.sessionStorage.setItem(TOKEN_KEY, client.token);
    } catch {
      /* 私密瀏覽 */
    }
    self.renderBar();
    return self;
  }

  /** 伺服器目前的地圖與位置（換頁後以伺服器為準） */
  get serverMap(): MapId {
    return this.client.map!.id;
  }
  get spawn(): { x: number; z: number; yaw: number } {
    return { x: this.client.local.x, z: this.client.local.z, yaw: this.client.local.yaw };
  }

  attach(scene: Scene, lod: NoviceLod, ground: (x: number, z: number) => number, fps: () => number): void {
    this.scene = scene;
    this.lod = lod;
    this.ground = ground;
    this.fpsFn = fps;
  }

  onMap(fn: (map: MapId, me: { x: number; z: number; yaw: number }) => void): void {
    this.mapHandler = fn;
  }

  private onEvent(e: NetEvent): void {
    if (e.type === "map") {
      for (const r of this.remotes.values()) this.disposeRemote(r);
      this.remotes.clear();
      this.mapHandler?.(e.map, this.spawn);
    } else if (e.type === "error" && e.code === "replaced") {
      this.toast("此角色已在其他分頁或裝置登入，這裡已中斷連線");
    } else if (e.type === "resynced") {
      this.toast(`已重新連線（${(e.ms / 1000).toFixed(1)} 秒）`);
    }
  }

  /** 本地玩家一幀：輸入（世界座標方向，長度 0～1）→ 預測＋校正後的位置 */
  /** 自動測試用：世界座標方向的移動輸入（一樣經過伺服器權威判定，不能瞬移或加速） */
  driveOverride: { x: number; z: number } | null = null;

  step(dt: number, mx: number, mz: number): MpStep {
    const c = this.client;
    if (this.driveOverride) {
      mx = this.driveOverride.x;
      mz = this.driveOverride.z;
    }
    const blocked = c.state !== "online" || c.down;
    c.update(dt, blocked ? 0 : mx, blocked ? 0 : mz);
    const p = c.renderPos;
    return { x: p.x, z: p.z, yaw: p.yaw, speed: c.local.speed };
  }

  act(k: ActKind, yaw?: number): void {
    this.client.act(k, yaw);
  }

  /** 倒地後請伺服器把角色送回星芽村（伺服器確認倒地才接受）；結果透過換地圖通知 */
  respawn(): void {
    this.client.command("respawn");
  }

  /** N009：洛恩的巡邏時鐘改用伺服器狀態（不修改 Claude B 的模組，只替換這個實例的時鐘方法） */
  bindRoan(merchant: { clock: { patrolTime(now: number): number; paused(now: number): boolean; talkTarget(now: number): { x: number; z: number } | null; hold(id: string, now: number, x: number, z: number): void; release(id: string, now: number): void } } | null): void {
    if (!merchant) return;
    const c = this.client;
    const clock = merchant.clock;
    const localPatrol = clock.patrolTime.bind(clock);
    clock.patrolTime = (now: number) => c.roanPatrolTime() ?? localPatrol(now);
    clock.paused = () => !!c.roan?.paused;
    clock.talkTarget = () => (c.roan?.paused ? { x: c.roan.tx, z: c.roan.tz } : null);
    clock.hold = () => {
      const t = performance.now();
      if (!this.roanHeld || t - this.roanSent > 3000) {
        this.roanHeld = true;
        this.roanSent = t;
        c.roanHold(true);
      }
    };
    clock.release = () => {
      if (this.roanHeld) c.roanHold(false);
      this.roanHeld = false;
    };
  }

  // ---------------- 遠端玩家 ----------------
  update(dt: number): void {
    const scene = this.scene;
    if (!scene) return;
    const list = this.client.remotes();
    const seen = new Set<number>();
    for (const r of list) {
      seen.add(r.id);
      let v = this.remotes.get(r.id);
      const key = appearanceKey(r);
      if (v && v.key !== key) {
        this.disposeRemote(v);
        this.remotes.delete(r.id);
        v = undefined;
      }
      if (!v) {
        v = this.createRemote(r, key);
        this.remotes.set(r.id, v);
      }
      this.updateRemote(v, r, dt);
    }
    for (const [id, v] of this.remotes) {
      if (!seen.has(id)) {
        this.disposeRemote(v);
        this.remotes.delete(id);
      }
    }
    this.barTimer += dt;
    if (this.barTimer >= 0.5) {
      this.barTimer = 0;
      this.client.stats.fps = Math.round(this.fpsFn());
      this.renderBar();
    }
  }

  private createRemote(r: RemotePlayer, key: string): RemoteView {
    const label = document.createElement("div");
    label.className = "mp-name";
    label.textContent = r.name;
    this.hudRoot.appendChild(label);
    const v: RemoteView = { id: r.id, key, avatar: null, loading: true, label, lastActSeq: r.actSeq, lastX: r.x, lastZ: r.z, speed: 0, link: r.link, dead: false };
    void NoviceAvatar.loadModular(this.scene!, { gender: r.gender, lod: this.lod, baseUrl: this.baseUrl, appearance: r.ap })
      .then((a) => {
        if (!this.remotes.has(r.id) || this.remotes.get(r.id) !== v) {
          a.dispose();
          return;
        }
        a.setupShadow("blob", this.scene!, null);
        a.root.position.set(r.x, this.ground(r.x, r.z), r.z);
        a.root.rotation.y = r.yaw;
        v.avatar = a;
        v.loading = false;
      })
      .catch(() => {
        v.loading = false;
        label.textContent = `${r.name}（模型載入失敗）`;
      });
    return v;
  }

  private updateRemote(v: RemoteView, r: RemotePlayer, dt: number): void {
    // 實際畫面速度（插值後位置的變化）：跑步動畫依此調整播放倍率，避免滑步
    const d = Math.hypot(r.x - v.lastX, r.z - v.lastZ);
    const inst = dt > 0 ? d / dt : 0;
    v.speed = v.speed + (Math.min(inst, 8) - v.speed) * Math.min(1, dt * 12);
    if (r.anim === ANIM.Idle && d < 1e-4) v.speed = Math.max(0, v.speed - dt * 20);
    v.lastX = r.x;
    v.lastZ = r.z;
    const a = v.avatar;
    const gy = this.ground(r.x, r.z);
    if (a) {
      const dead = r.anim === ANIM.Death;
      const newAct = r.actSeq !== v.lastActSeq;
      v.lastActSeq = r.actSeq;
      const h = a.update(
        dt,
        {
          speed: dead ? 0 : v.speed,
          attack: newAct && r.act === ANIM.Attack && !dead,
          hurt: newAct && r.act === ANIM.Hurt && !dead,
          die: dead && a.hasDeathClip && a.state !== "Death",
          revive: !dead && a.state === "Death",
        },
        gy,
      );
      a.root.position.set(r.x, gy + h, r.z);
      a.root.rotation.y = r.yaw;
      if (r.link !== v.link) {
        v.link = r.link;
        setAlpha(a.root.getChildMeshes(), r.link ? 1 : 0.45);
      }
      v.dead = dead;
    }
    // 名牌
    const scene = this.scene!;
    const cam = scene.activeCamera;
    if (cam) {
      this.tmp.set(r.x, gy + 1.75, r.z);
      const eng = scene.getEngine();
      const w = eng.getRenderWidth();
      const hh = eng.getRenderHeight();
      Vector3.ProjectToRef(this.tmp, Matrix.IdentityReadOnly, scene.getTransformMatrix(), cam.viewport.toGlobal(w, hh), this.proj);
      const scale = (this.hudRoot.clientWidth || window.innerWidth) / w;
      const vis = this.proj.z > 0 && this.proj.z < 1 && Vector3.Distance(cam.globalPosition, this.tmp) < 45;
      v.label.style.display = vis ? "block" : "none";
      if (vis) v.label.style.transform = `translate(${(this.proj.x * scale).toFixed(1)}px, ${(this.proj.y * scale).toFixed(1)}px) translate(-50%, -100%)`;
      v.label.classList.toggle("off", !r.link);
      v.label.textContent = `${r.name}${r.link ? "" : "（斷線中）"}${r.anim === ANIM.Death ? "（倒地）" : ""}`;
    }
  }

  private disposeRemote(v: RemoteView): void {
    v.avatar?.dispose();
    v.avatar = null;
    v.label.remove();
  }

  /** 測試用：遠端玩家畫面狀態 */
  remoteInfo(): { id: number; name: string; loaded: boolean; state: string | null; pos: [number, number] | null; yaw: number | null; link: number; parts: number; hairColor: string | null; gender: string }[] {
    const list = this.client.remotes();
    return [...this.remotes.values()].map((v) => {
      const r = list.find((x) => x.id === v.id);
      return {
        id: v.id,
        name: r?.name ?? "",
        loaded: !!v.avatar,
        state: v.avatar?.state ?? null,
        pos: v.avatar ? [v.avatar.root.position.x, v.avatar.root.position.z] : null,
        yaw: v.avatar ? v.avatar.root.rotation.y : null,
        link: v.link,
        parts: v.avatar?.parts.length ?? 0,
        hairColor: r?.ap.hairColor ?? null,
        gender: r?.gender ?? "",
      };
    });
  }

  // ---------------- 畫面 ----------------
  private renderBar(): void {
    const s = this.client.stats;
    const dot = s.state === "online" ? "🟢" : s.state === "reconnecting" ? "🟡" : "🔴";
    const state = s.state === "online" ? "線上" : s.state === "reconnecting" ? "重新連線中" : s.state === "connecting" ? "連線中" : "離線";
    this.bar.textContent = `${dot} 多人 ${state}｜同場 ${s.players} 人｜延遲 ${s.rttMs} ms｜FPS ${s.fps}`;
    this.detail.innerHTML = [
      `<b>多人連線診斷（Stage 8.1 測試）</b>`,
      `房間 ${s.room}（${this.client.realm === "test" ? "測試資料區" : this.client.realm}）・玩家#${s.pid}`,
      `RTT ${s.rttMs} ms（平均 ${s.rttAvgMs}）・抖動 ${s.jitterMs} ms`,
      `下載 ${(s.bytesDownPerSec / 1024).toFixed(1)} KB/s（${s.msgsDownPerSec} 包/秒）・上傳 ${(s.bytesUpPerSec / 1024).toFixed(2)} KB/s（${s.msgsUpPerSec} 包/秒）`,
      `快照 ${s.snapsPerSec}/秒・待確認輸入 ${s.pendingInputs}`,
      `位置校正 ${s.corrections} 次（最大 ${s.maxCorrectionCm} cm）・重連 ${s.reconnects} 次`,
      `<span class="mp-warn">怪物與戰鬥目前是各自裝置的單機行為（多人權威戰鬥：Stage 8.2）</span>`,
    ].join("<br>");
  }

  toast(msg: string): void {
    const t = document.createElement("div");
    t.className = "mp-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    window.setTimeout(() => t.remove(), 2600);
  }
}

function appearanceKey(r: RemotePlayer): string {
  return `${r.gender}|${r.ap.hair}|${r.ap.hairColor ?? ""}|${r.ap.weapon}`;
}

function setAlpha(meshes: AbstractMesh[], a: number): void {
  for (const m of meshes) m.visibility = a;
}

void Color3;

const CSS = `
.mp-bar{position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 6px);z-index:60;padding:4px 10px;border-radius:12px;background:rgba(20,26,60,.72);color:#fbf6ea;font:600 11px/1.4 -apple-system,'PingFang TC',sans-serif;white-space:nowrap;cursor:pointer;max-width:92vw;overflow:hidden;text-overflow:ellipsis}
.mp-detail{display:none;position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 30px);z-index:60;padding:8px 12px;border-radius:12px;background:rgba(20,26,60,.9);color:#fbf6ea;font:500 11px/1.5 -apple-system,'PingFang TC',sans-serif;width:min(92vw,360px);box-sizing:border-box}
.mp-detail.open{display:block}
.mp-warn{color:#ffd36b}
.mp-name{position:absolute;left:0;top:0;z-index:30;pointer-events:none;padding:1px 7px;border-radius:9px;background:rgba(20,26,60,.6);color:#fff;font:600 12px/1.3 -apple-system,'PingFang TC',sans-serif;white-space:nowrap;will-change:transform}
.mp-name.off{opacity:.6}
.mp-toast{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 64px);transform:translateX(-50%);z-index:70;padding:8px 14px;border-radius:14px;background:rgba(20,26,60,.9);color:#fbf6ea;font:600 13px -apple-system,'PingFang TC',sans-serif}
`;
