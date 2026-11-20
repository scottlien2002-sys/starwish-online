import { PROFILE_SECTIONS, SECTION_LABEL, type ProfileWindow } from "../render/frameProfiler.ts";

/**
 * 遊戲內除錯面板（只在 ?debug=1 啟用）。
 * - 文字由 formatDebugLines 產生（純函式，可單元測試）
 * - DOM 只建立一次；每 0.5 秒更新一次文字（一般遊戲不建立、零成本）
 * - 位置在畫面上方中央，可收合；按鈕以外不接收觸控，不影響搖桿與技能按鈕
 */

export function debugEnabledFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("debug") === "1";
}

const STATE_LABEL: Record<string, string> = {
  idle: "待機",
  move: "移動",
  attack: "攻擊",
  hit: "受傷",
  death: "死亡中",
  dead: "已移除",
  respawn: "重生中",
};

export interface DebugMonsterInfo {
  id: string;
  hp: number;
  maxHp: number;
  state: string;
  /** V3.8R 播放中的動畫（V2 為 null） */
  anim: string | null;
  attackId: number;
  resolved: number;
  cancelled: number;
  duplicatesBlocked: number;
  /** 攻擊冷卻剩餘秒數 */
  cooldown: number;
  /** 距離重生秒數（死亡中、已移除時才有） */
  respawnIn: number | null;
}

export interface DebugInfo {
  variant: "v2" | "v38r";
  quality: string;
  fps: number;
  drawCalls: number;
  activeMeshes: number;
  meshes: number;
  materials: number;
  textures: number;
  render: { width: number; height: number; cssWidth: number; cssHeight: number; pixelRatio: number; devicePixelRatio: number; megapixels: number };
  profile: ProfileWindow | null;
  /** 場景繪製細項（CPU 毫秒，Babylon SceneInstrumentation 最近一秒平均） */
  sceneTimes: { activeMeshes: number; renderTargets: number; sprites: number; particles: number } | null;
  /** GPU 影格時間（毫秒）；裝置不支援計時擴充時為 null */
  gpuMs: number | null;
  gpuSupported: boolean;
  player: { hp: number; maxHp: number; down: boolean; attackPhase: string; hits: number };
  monsters: DebugMonsterInfo[];
  /** 啟用中的渲染實驗說明（?opt=／?diag=；預設為空） */
  experiments?: string[];
}

const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : "—");
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : "—");

export function formatMonsterLine(m: DebugMonsterInfo, index: number): string {
  const st = STATE_LABEL[m.state] ?? m.state;
  const anim = m.anim ? `・動畫 ${m.anim}` : "";
  const atk = `・attackId ${m.attackId}（中${m.resolved}／消${m.cancelled}${m.duplicatesBlocked ? `／重${m.duplicatesBlocked}` : ""}）`;
  const cd = m.cooldown > 0 && m.respawnIn === null ? `・冷卻 ${f1(m.cooldown)}s` : "";
  const resp = m.respawnIn !== null ? `・重生倒數 ${f1(m.respawnIn)}s` : "";
  return `#${index + 1} HP ${m.hp}/${m.maxHp}・${st}${anim}${atk}${cd}${resp}`;
}

export function formatDebugLines(d: DebugInfo): string[] {
  const r = d.render;
  const lines = [
    `${d.variant === "v38r" ? "V3.8R" : "V2"}・畫質 ${d.quality}・FPS ${f1(d.fps)}`,
    `Draw Calls ${d.drawCalls}・Active Mesh ${d.activeMeshes}・Mesh ${d.meshes}・材質 ${d.materials}・貼圖 ${d.textures}`,
    `解析度 ${r.width}×${r.height}（${f2(r.pixelRatio)}x ${f2(r.megapixels)}MP；畫面 ${r.cssWidth}×${r.cssHeight} 裝置 ${r.devicePixelRatio}x）`,
  ];
  if (d.experiments && d.experiments.length) lines.push("實驗：" + d.experiments.join("；"));
  const p = d.profile;
  if (p) {
    lines.push(`影格 ${f1(p.avgFrameMs)}ms（最長 ${f1(p.maxFrameMs)}）＝CPU ${f1(p.cpuMs)}＋GPU／等待 ${f1(p.waitMs)}`);
    lines.push("CPU ms：" + PROFILE_SECTIONS.map((k) => `${SECTION_LABEL[k]} ${f2(p.sections[k])}`).join(" "));
  }
  if (d.sceneTimes) {
    const s = d.sceneTimes;
    lines.push(`繪製細項 ms：可見判定 ${f2(s.activeMeshes)} 陰影 ${f2(s.renderTargets)} 精靈 ${f2(s.sprites)} 粒子 ${f2(s.particles)}`);
  }
  lines.push(d.gpuSupported ? `GPU 影格時間 ${d.gpuMs === null ? "量測中" : `${f1(d.gpuMs)} ms`}` : "GPU 計時：此裝置不支援（看上方 GPU／等待）");
  const pl = d.player;
  lines.push(`玩家 HP ${pl.hp}/${pl.maxHp}${pl.down ? "・倒地" : ""}・攻擊動作 ${pl.attackPhase}・命中 ${pl.hits}`);
  d.monsters.forEach((m, i) => lines.push(formatMonsterLine(m, i)));
  return lines;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 找出不擋住介面的位置（純函式）：
 * - 先試上方「狀態面板」與「效能面板」之間的空位（橫向畫面），寬度至少 minWidth
 * - 空位太窄（直向畫面）時改放在上方面板的下方、整個畫面寬
 * 下緣停在搖桿與技能按鈕上方
 */
export function placeDebugPanel(
  vw: number,
  vh: number,
  top: { status: Box | null; system: Box | null; perf: Box | null },
  controls: readonly Box[],
  minWidth = 260,
): { left: number; top: number; width: number; maxHeight: number } {
  const m = 6;
  const tops = [top.status, top.system, top.perf].filter((b): b is Box => b !== null);
  const statusRight = top.status ? top.status.right : 0;
  const rightLimit = Math.min(vw, ...[top.system, top.perf].filter((b): b is Box => b !== null).map((b) => b.left));
  const bottomFor = (l: number, r: number, t: number): number => {
    const below = controls.filter((c) => c.right > l && c.left < r && c.bottom > t).map((c) => c.top);
    return Math.min(vh, ...below) - m;
  };
  const aL = statusRight + m, aR = rightLimit - m;
  if (aR - aL >= minWidth) {
    const t = m;
    return { left: aL, top: t, width: aR - aL, maxHeight: Math.max(0, bottomFor(aL, aR, t) - t) };
  }
  const t = Math.max(0, ...tops.map((b) => b.bottom)) + m;
  return { left: m, top: t, width: vw - 2 * m, maxHeight: Math.max(0, bottomFor(m, vw - m, t) - t) };
}

/** 面板 DOM（建立一次，之後只換文字） */
export class DebugPanel {
  readonly el: HTMLDivElement;
  private readonly text: HTMLPreElement;
  private collapsed = false;

  constructor(parent: HTMLElement, onReset: () => void) {
    const el = (this.el = document.createElement("div"));
    el.className = "debug-panel";
    el.setAttribute(
      "style",
      "position:fixed;left:6px;top:6px;z-index:40;box-sizing:border-box;overflow:hidden;padding:6px 8px;border-radius:10px;background:rgba(20,22,48,.72);color:#eef;font:10.5px/1.35 ui-monospace,Menlo,monospace;pointer-events:none",
    );
    const row = document.createElement("div");
    row.setAttribute("style", "display:flex;gap:6px;margin-bottom:4px;pointer-events:auto");
    const btn = (label: string, cls: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = label;
      b.setAttribute("style", "padding:4px 9px;border-radius:8px;border:0;background:#8a7cf0;color:#fff;font:600 11px system-ui,sans-serif");
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
      });
      row.appendChild(b);
      return b;
    };
    btn("重設測試", "debug-reset", onReset);
    const toggle = btn("收合", "debug-toggle", () => {
      this.collapsed = !this.collapsed;
      this.text.style.display = this.collapsed ? "none" : "";
      toggle.textContent = this.collapsed ? "展開" : "收合";
    });
    this.text = document.createElement("pre");
    this.text.className = "debug-text";
    this.text.setAttribute("style", "margin:0;white-space:pre-wrap;word-break:break-all");
    el.append(row, this.text);
    parent.appendChild(el);
    this.layout();
    window.addEventListener("resize", () => this.layout());
  }

  /** 依目前介面位置擺放（建立時、畫面尺寸改變時、每次更新文字時） */
  layout(): void {
    const box = (sel: string): Box | null => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
    };
    // 只避開看得見的操作元件（技能按鈕、搖桿本體）；搖桿的觸控區是看不見的大範圍，面板不接收觸控，不影響操作
    const controls = [...document.querySelectorAll(".skill-btn, .joystick-base")]
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0)
      .map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
    const p = placeDebugPanel(window.innerWidth, window.innerHeight, { status: box(".hud-status"), system: box(".hud-system"), perf: box(".perf-panel") }, controls);
    const st = this.el.style;
    st.left = `${p.left}px`;
    st.top = `${p.top}px`;
    st.width = `${p.width}px`;
    st.maxHeight = `${p.maxHeight}px`;
  }

  setLines(lines: readonly string[]): void {
    this.layout();
    if (this.collapsed) return;
    this.text.textContent = lines.join("\n");
  }
}
