/**
 * 傷害數字（DOM 疊加層）：清楚、銳利、不受 3D 解析度影響，iPhone 上成本很低（物件池、只改 transform／opacity）。
 * 普通：白字藍邊；暴擊：金色大字＋「CRITICAL」；玩家受傷：紅字。
 */
import { Matrix, type Scene, Vector3 } from "@babylonjs/core";

/** 傷害數字類型（樣式暫定；正式數值由遊戲決定）。block＝格擋：獨立樣式（藍色外框盾牌牌面），不借用 miss */
export type DamageStyle = "normal" | "crit" | "player" | "heal" | "miss" | "block";

interface Item {
  el: HTMLDivElement;
  pos: Vector3;
  t: number;
  life: number;
  dx: number;
  lift: number;
  style: DamageStyle;
  active: boolean;
}

const CSS = `
.cvfx-dmg-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:6}
.cvfx-dmg{position:absolute;left:0;top:0;font:900 22px/1 "Arial Rounded MT Bold","Hiragino Maru Gothic ProN","PingFang TC",system-ui,sans-serif;
  color:#fff;-webkit-text-stroke:1.5px #2c4a8a;text-shadow:0 2px 0 #1b2d5a,0 0 10px rgba(110,180,255,.75);white-space:nowrap;will-change:transform,opacity}
.cvfx-dmg.crit{font-size:36px;color:#ffe27a;-webkit-text-stroke:2px #a3460c;text-shadow:0 3px 0 #6e2a05,0 0 18px rgba(255,190,60,.95),0 0 34px rgba(255,140,40,.6)}
.cvfx-dmg.crit::before{content:"CRITICAL";display:block;font-size:13px;letter-spacing:2px;color:#fff6c9;-webkit-text-stroke:1px #a3460c;text-align:center;margin-bottom:2px}
.cvfx-dmg.player{color:#ff8a8a;-webkit-text-stroke:1.5px #6e1020;text-shadow:0 2px 0 #4a0a14}
.cvfx-dmg.heal{color:#9dffb5;-webkit-text-stroke:1.5px #135e2c}
.cvfx-dmg.block{color:#d6ecff;font-size:20px;-webkit-text-stroke:1.5px #1d4f80;text-shadow:0 2px 0 #12345a,0 0 8px rgba(120,190,255,.8);padding:2px 9px 3px;border:2px solid rgba(150,205,255,.9);border-radius:9px;background:rgba(24,58,104,.55)}
.cvfx-dmg.miss{color:#d8deea;font-size:18px;-webkit-text-stroke:1px #4a5468}
`;

export class DamageNumbers {
  private readonly layer: HTMLDivElement;
  private readonly items: Item[] = [];
  private readonly scene: Scene;
  private max: number;
  private readonly tmp = new Vector3();
  shown = 0;

  constructor(scene: Scene, parent: HTMLElement, max: number) {
    this.scene = scene;
    this.max = max;
    if (!document.getElementById("cvfx-dmg-style")) {
      const st = document.createElement("style");
      st.id = "cvfx-dmg-style";
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.layer = document.createElement("div");
    this.layer.className = "cvfx-dmg-layer";
    parent.appendChild(this.layer);
    this.ensure(max);
  }

  /** 先建好 DOM 元素（Stage 3.1：第一次大量跳字時不在戰鬥中建立元素） */
  private ensure(n: number): void {
    while (this.items.length < n) {
      const el = document.createElement("div");
      el.className = "cvfx-dmg";
      el.style.display = "none";
      this.layer.appendChild(el);
      this.items.push({ el, pos: new Vector3(), t: 0, life: 1, dx: 0, lift: 0, style: "normal", active: false });
    }
  }

  setMax(n: number): void {
    this.max = n;
    this.ensure(n);
  }

  show(world: Vector3, value: number | string, style: DamageStyle = "normal"): void {
    let it = this.items.find((i) => !i.active);
    if (!it) {
      if (this.items.length >= this.max) {
        // 超過上限：回收最舊的
        it = this.items.reduce((a, b) => (a.t > b.t ? a : b));
      } else {
        const el = document.createElement("div");
        el.className = "cvfx-dmg";
        this.layer.appendChild(el);
        it = { el, pos: new Vector3(), t: 0, life: 1, dx: 0, lift: 0, style, active: false };
        this.items.push(it);
      }
    }
    it.active = true;
    it.pos.copyFrom(world);
    it.t = 0;
    it.style = style;
    it.life = style === "crit" ? 1.2 : 0.95;
    // 疊字：同一位置附近 0.25 秒內的數字往上排，連段時不會疊在一起
    let stack = 0;
    for (const o of this.items) if (o !== it && o.active && o.t < 0.25 && Vector3.DistanceSquared(o.pos, world) < 0.5) stack++;
    it.lift = stack * 22;
    it.dx = (Math.random() - 0.5) * 50;
    it.el.className = `cvfx-dmg ${style}`;
    it.el.textContent = typeof value === "number" ? String(value) : value;
    it.el.style.display = "block";
    this.shown++;
  }

  update(dt: number): void {
    const cam = this.scene.activeCamera;
    if (!cam) return;
    const eng = this.scene.getEngine();
    const canvas = eng.getRenderingCanvas();
    const w = canvas?.clientWidth ?? 0;
    const h = canvas?.clientHeight ?? 0;
    const vp = cam.viewport.toGlobal(w, h);
    const tm = this.scene.getTransformMatrix();
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      const u = it.t / it.life;
      if (u >= 1) {
        it.active = false;
        it.el.style.display = "none";
        continue;
      }
      Vector3.ProjectToRef(it.pos, Matrix.IdentityReadOnly, tm, vp, this.tmp);
      if (this.tmp.z < 0 || this.tmp.z > 1) {
        it.el.style.opacity = "0";
        continue;
      }
      // V2：彈出（超過再回彈）→ 拋物線上升、側漂 → 淡出；暴擊多一段震動與微旋轉
      const crit = it.style === "crit";
      const pt = it.t / (crit ? 0.18 : 0.14);
      const pop = pt < 1 ? (crit ? 0.4 + 1.9 * Math.sin(pt * Math.PI * 0.62) : 0.55 + 1.05 * Math.sin(pt * Math.PI * 0.62)) : 1 + (crit ? 0.12 : 0.05) * Math.exp(-(it.t - 0.18) * 10);
      const rise = -70 * (1 - Math.pow(1 - Math.min(1, u * 1.3), 2)) + 22 * u * u - it.lift;
      const shake = crit && it.t < 0.22 ? Math.sin(it.t * 90) * 4 * (1 - it.t / 0.22) : 0;
      const x = this.tmp.x + it.dx * u + shake;
      const y = this.tmp.y + rise;
      const rot = crit ? -6 * Math.exp(-it.t * 6) : 0;
      it.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%) scale(${pop.toFixed(3)}) rotate(${rot.toFixed(1)}deg)`;
      it.el.style.opacity = String(u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3);
    }
  }

  dispose(): void {
    this.layer.remove();
  }
}
