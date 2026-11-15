import { EventBus } from "../core/events.ts";

export type HudEvents = {
  /** W1 只回饋按壓；W2 接上戰鬥系統 */
  skillPressed: { slot: SkillSlot };
};

export type SkillSlot = "attack" | "skill1" | "skill2" | "skill3";

export interface BarValues {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  exp: number;
  expToNext: number;
}

/**
 * 手機 HUD（DOM 疊在 canvas 上）。
 * 版面原則：狀態列在左上、系統資訊在右上、搖桿區在左下、技能在右下，四區互不重疊，皆避開安全區。
 */
export class Hud {
  readonly events = new EventBus<HudEvents>();
  readonly joystickZone: HTMLDivElement;
  private readonly root: HTMLElement;
  private readonly fpsEl: HTMLSpanElement;
  private readonly levelEl: HTMLSpanElement;
  private readonly bars: Record<"hp" | "mp" | "exp", { fill: HTMLDivElement; text: HTMLSpanElement }>;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-status" data-layout="status-panel">
        <div class="hud-name"><span class="hud-level">Lv.1</span> 初心者</div>
        ${barHtml("hp", "HP")}
        ${barHtml("mp", "MP")}
        ${barHtml("exp", "EXP")}
      </div>
      <div class="hud-system" data-layout="system-panel">
        <span class="hud-fps">-- FPS</span>
        <span class="hud-build">W1</span>
      </div>
      <div class="hud-joystick-zone" data-layout="joystick-zone" aria-label="移動搖桿"></div>
      <div class="hud-skills" aria-label="技能按鈕">
        <button class="skill-btn skill-attack" data-slot="attack" data-layout="btn-attack" aria-label="普通攻擊">攻擊</button>
        <button class="skill-btn skill-1" data-slot="skill1" data-layout="btn-skill1" aria-label="技能一">技1</button>
        <button class="skill-btn skill-2" data-slot="skill2" data-layout="btn-skill2" aria-label="技能二">技2</button>
        <button class="skill-btn skill-3" data-slot="skill3" data-layout="btn-skill3" aria-label="技能三">技3</button>
      </div>
      <div class="hud-toast" role="status"></div>
    `;

    this.joystickZone = must(root.querySelector<HTMLDivElement>(".hud-joystick-zone"));
    this.fpsEl = must(root.querySelector<HTMLSpanElement>(".hud-fps"));
    this.levelEl = must(root.querySelector<HTMLSpanElement>(".hud-level"));
    this.bars = {
      hp: barRefs(root, "hp"),
      mp: barRefs(root, "mp"),
      exp: barRefs(root, "exp"),
    };

    for (const btn of root.querySelectorAll<HTMLButtonElement>(".skill-btn")) {
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add("pressed");
        this.events.emit("skillPressed", { slot: btn.dataset.slot as SkillSlot });
      });
      const release = (): void => btn.classList.remove("pressed");
      btn.addEventListener("pointerup", release);
      btn.addEventListener("pointercancel", release);
      btn.addEventListener("pointerleave", release);
      btn.addEventListener("contextmenu", (e) => e.preventDefault());
    }
  }

  setLevel(level: number): void {
    this.levelEl.textContent = `Lv.${level}`;
  }

  setBars(v: BarValues): void {
    setBar(this.bars.hp, v.hp, v.maxHp);
    setBar(this.bars.mp, v.mp, v.maxMp);
    setBar(this.bars.exp, v.exp, v.expToNext, true);
  }

  setFps(fps: number): void {
    this.fpsEl.textContent = `${Math.round(fps)} FPS`;
    this.fpsEl.classList.toggle("low", fps < 30);
  }

  private toastTimer: number | null = null;

  toast(message: string, ms = 2200): void {
    const el = this.root.querySelector<HTMLDivElement>(".hud-toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    // 新訊息取代舊訊息時，取消舊的隱藏計時，避免新訊息被提早收起
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      el.classList.remove("show");
      this.toastTimer = null;
    }, ms);
  }
}

function barHtml(kind: string, label: string): string {
  return `
    <div class="bar bar-${kind}">
      <div class="bar-fill"></div>
      <span class="bar-label">${label}</span>
      <span class="bar-text"></span>
    </div>`;
}

function barRefs(root: HTMLElement, kind: string): { fill: HTMLDivElement; text: HTMLSpanElement } {
  return {
    fill: must(root.querySelector<HTMLDivElement>(`.bar-${kind} .bar-fill`)),
    text: must(root.querySelector<HTMLSpanElement>(`.bar-${kind} .bar-text`)),
  };
}

function setBar(bar: { fill: HTMLDivElement; text: HTMLSpanElement }, value: number, max: number, percent = false): void {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  bar.fill.style.transform = `scaleX(${ratio})`;
  bar.text.textContent = percent ? `${(ratio * 100).toFixed(1)}%` : `${Math.round(value)}/${Math.round(max)}`;
}

function must<T>(v: T | null): T {
  if (v === null) throw new Error("HUD element missing");
  return v;
}
