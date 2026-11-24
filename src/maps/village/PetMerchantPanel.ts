import { PET_ITEM_LABEL, PET_MENU_OPTIONS, PET_MERCHANT, PET_MERCHANT_GREETING, type PetItemKind, type PetMenuState, petMenuStep, petMerchantService } from "./petMerchant.ts";

/**
 * 寵物商人對話面板（DOM；手機直向優先：大按鈕、安全區、可捲動）。
 * 流程與文字全部來自 petMerchant.ts 的選單狀態；功能結果來自目前連接的服務（未接入時顯示「準備中」）。
 */
export class PetMerchantPanel {
  private readonly el: HTMLDivElement;
  private state: PetMenuState = { screen: "closed" };
  private busy = false;
  onClose: (() => void) | null = null;

  constructor(parent: HTMLElement = document.body) {
    this.el = document.createElement("div");
    this.el.className = "pet-merchant-panel";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", PET_MERCHANT.name);
    Object.assign(this.el.style, {
      position: "fixed",
      left: "50%",
      bottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)",
      transform: "translateX(-50%)",
      width: "min(92vw, 440px)",
      maxHeight: "62vh",
      overflowY: "auto",
      boxSizing: "border-box",
      padding: "16px 16px 14px",
      borderRadius: "18px",
      background: "linear-gradient(180deg, rgba(42,34,92,0.94), rgba(28,24,66,0.96))",
      border: "2px solid rgba(240,200,110,0.9)",
      boxShadow: "0 10px 30px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.08)",
      color: "#fbf6ea",
      font: "15px/1.55 -apple-system, 'PingFang TC', 'Noto Sans TC', sans-serif",
      zIndex: "50",
      display: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.state.screen !== "closed";
  }

  async open(): Promise<void> {
    await this.act({ type: "open" });
  }

  close(): void {
    void this.act({ type: "close" });
  }

  private async act(a: Parameters<typeof petMenuStep>[1]): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.state = await petMenuStep(this.state, a, petMerchantService());
    } finally {
      this.busy = false;
    }
    this.render();
    if (this.state.screen === "closed") this.onClose?.();
  }

  private button(act: string, label: string, hint: string, onClick: () => void, primary = true): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.act = act;
    b.innerHTML = `<span style="font-weight:700">${label}</span>${hint ? `<span style="display:block;font-size:12px;opacity:.75">${hint}</span>` : ""}`;
    Object.assign(b.style, {
      display: "block",
      width: "100%",
      minHeight: "48px",
      margin: "8px 0 0",
      padding: "10px 14px",
      borderRadius: "12px",
      border: primary ? "1px solid rgba(240,200,110,0.85)" : "1px solid rgba(255,255,255,0.25)",
      background: primary ? "linear-gradient(180deg, rgba(255,236,190,0.18), rgba(255,236,190,0.06))" : "rgba(255,255,255,0.06)",
      color: "#fbf6ea",
      textAlign: "left",
      font: "inherit",
      cursor: "pointer",
    } satisfies Partial<CSSStyleDeclaration>);
    b.addEventListener("click", onClick);
    return b;
  }

  private render(): void {
    const s = this.state;
    this.el.replaceChildren();
    if (s.screen === "closed") {
      this.el.style.display = "none";
      return;
    }
    this.el.style.display = "block";
    const head = document.createElement("div");
    const ready = petMerchantService().available;
    head.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><span style="font-size:18px;font-weight:800;color:#f3d48a">✦ ${PET_MERCHANT.name}</span>${ready ? "" : '<span style="font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(160,180,255,0.22);border:1px solid rgba(180,200,255,0.5)">功能準備中</span>'}</div>`;
    this.el.appendChild(head);
    const body = document.createElement("div");
    body.style.marginTop = "6px";
    if (s.screen === "root") {
      body.textContent = PET_MERCHANT_GREETING;
      this.el.appendChild(body);
      for (const o of PET_MENU_OPTIONS) this.el.appendChild(this.button(`choose:${o.id}`, o.label, o.hint, () => void this.act({ type: "choose", option: o.id }), o.id !== "leave"));
      return;
    }
    if (s.screen === "appraiseKind") {
      body.textContent = "要鑑定哪一種呢？";
      this.el.appendChild(body);
      for (const k of Object.keys(PET_ITEM_LABEL) as PetItemKind[]) this.el.appendChild(this.button(`kind:${k}`, `鑑定${PET_ITEM_LABEL[k]}`, "", () => void this.act({ type: "kind", kind: k })));
      this.el.appendChild(this.button("back", "返回", "", () => void this.act({ type: "back" }), false));
      return;
    }
    // message
    const t = document.createElement("div");
    t.textContent = s.title ?? "";
    Object.assign(t.style, { fontWeight: "700", color: "#f3d48a", marginTop: "4px" });
    this.el.appendChild(t);
    for (const line of s.lines ?? []) {
      const p = document.createElement("div");
      p.textContent = line;
      this.el.appendChild(p);
    }
    this.el.appendChild(this.button("back", "返回", "", () => void this.act({ type: "back" }), false));
    this.el.appendChild(this.button("close", "離開", "", () => void this.act({ type: "close" }), false));
  }
}
