/**
 * 畫面層效果（DOM，幾乎零 GPU 成本）：暴擊閃光、玩家受傷紅框。只影響自己的畫面，多人時其他玩家的暴擊不觸發。
 */
const CSS = `
.cvfx-screen{position:absolute;inset:0;pointer-events:none;z-index:5;opacity:0;will-change:opacity}
.cvfx-screen.crit{background:radial-gradient(ellipse at center,rgba(255,244,200,.0) 30%,rgba(255,214,120,.38) 75%,rgba(255,170,60,.55) 100%)}
.cvfx-screen.hurt{background:radial-gradient(ellipse at center,rgba(255,0,0,0) 55%,rgba(220,30,50,.45) 100%)}
`;

export class ScreenFx {
  private readonly crit: HTMLDivElement;
  private readonly hurt: HTMLDivElement;
  private critT = 9;
  private hurtT = 9;
  enabled = true;

  constructor(parent: HTMLElement) {
    if (!document.getElementById("cvfx-screen-style")) {
      const st = document.createElement("style");
      st.id = "cvfx-screen-style";
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.crit = document.createElement("div");
    this.crit.className = "cvfx-screen crit";
    this.hurt = document.createElement("div");
    this.hurt.className = "cvfx-screen hurt";
    parent.appendChild(this.crit);
    parent.appendChild(this.hurt);
  }

  flashCrit(): void {
    if (this.enabled) this.critT = 0;
  }

  flashHurt(): void {
    if (this.enabled) this.hurtT = 0;
  }

  update(dt: number): void {
    this.critT += dt;
    this.hurtT += dt;
    const c = this.critT < 0.04 ? this.critT / 0.04 : Math.max(0, 1 - (this.critT - 0.04) / 0.22);
    const h = this.hurtT < 0.05 ? this.hurtT / 0.05 : Math.max(0, 1 - (this.hurtT - 0.05) / 0.35);
    this.crit.style.opacity = c.toFixed(3);
    this.hurt.style.opacity = h.toFixed(3);
  }
}
