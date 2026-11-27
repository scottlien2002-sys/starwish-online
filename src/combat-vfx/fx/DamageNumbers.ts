/**
 * 傷害數字（DOM 疊加層）：清楚、銳利、不受 3D 解析度影響，iPhone 上成本很低（物件池、只改 transform／opacity）。
 * 普通：白字藍邊；暴擊：金色大字＋「CRITICAL」；玩家受傷：紅字。
 */
import { Matrix, type Scene, Vector3 } from "@babylonjs/core";

export type DamageStyle = "normal" | "crit" | "player" | "heal" | "miss";

interface Item {
  el: HTMLDivElement;
  pos: Vector3;
  t: number;
  life: number;
  dx: number;
  style: DamageStyle;
  active: boolean;
}

const CSS = `
.cvfx-dmg-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:6}
.cvfx-dmg{position:absolute;left:0;top:0;font:900 22px/1 "Arial Rounded MT Bold","Hiragino Maru Gothic ProN","PingFang TC",system-ui,sans-serif;
  color:#fff;-webkit-text-stroke:1.5px #2c4a8a;text-shadow:0 2px 0 #1b2d5a,0 0 10px rgba(110,180,255,.75);white-space:nowrap;will-change:transform,opacity}
.cvfx-dmg.crit{font-size:34px;color:#ffe27a;-webkit-text-stroke:2px #a3460c;text-shadow:0 3px 0 #6e2a05,0 0 16px rgba(255,190,60,.95)}
.cvfx-dmg.crit::before{content:"CRITICAL";display:block;font-size:13px;letter-spacing:2px;color:#fff6c9;-webkit-text-stroke:1px #a3460c;text-align:center;margin-bottom:2px}
.cvfx-dmg.player{color:#ff8a8a;-webkit-text-stroke:1.5px #6e1020;text-shadow:0 2px 0 #4a0a14}
.cvfx-dmg.heal{color:#9dffb5;-webkit-text-stroke:1.5px #135e2c}
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
  }

  setMax(n: number): void {
    this.max = n;
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
        it = { el, pos: new Vector3(), t: 0, life: 1, dx: 0, style, active: false };
        this.items.push(it);
      }
    }
    it.active = true;
    it.pos.copyFrom(world);
    it.t = 0;
    it.style = style;
    it.life = style === "crit" ? 1.15 : 0.9;
    it.dx = (Math.random() - 0.5) * 40;
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
      // 彈出 → 上升 → 淡出
      const pop = it.style === "crit" ? 1 + 0.9 * Math.max(0, 1 - it.t / 0.12) : 1 + 0.45 * Math.max(0, 1 - it.t / 0.1);
      const rise = -60 * (1 - Math.pow(1 - Math.min(1, u * 1.4), 2));
      const x = this.tmp.x + it.dx * u;
      const y = this.tmp.y + rise;
      it.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%) scale(${pop.toFixed(3)})`;
      it.el.style.opacity = String(u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3);
    }
  }

  dispose(): void {
    this.layer.remove();
  }
}
