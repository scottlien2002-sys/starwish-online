import {
  type AppraisableItem,
  type AppraisalLine,
  type AppraisalState,
  canAppraise,
  clearSlot,
  feeText,
  initialAppraisal,
  KIND_LABEL,
  type PetAppraisalService,
  petAppraisalService,
  place,
  runAppraisal,
  selected,
  withItems,
  chargedText,
} from "./petAppraisal.ts";
import type { PetItemKind } from "./petMerchant.ts";

/**
 * 星靈鑑定視窗（DOM；iPhone 直向優先：單欄、可上下捲動、沒有橫向捲動、按鈕 ≥ 44 px）。
 * 1 商人頭像與對話 2 中央正方形鑑定框 3 物品名稱與圖示 4 背包物品區 5 鑑定費用 6 開始鑑定 7 結果區 8 關閉／返回
 * 手機：點物品自動放入鑑定框；桌面（滑鼠）：也可以把物品拖到鑑定框。鑑定時播放約 1 秒的魔法陣與星光，完成後逐條顯示結果。
 */
export interface AppraisalWindowOptions {
  parent?: HTMLElement;
  /** 商人頭像圖（沒有時畫一個金框徽章） */
  avatarUrl?: string;
  name?: string;
  service?: () => PetAppraisalService;
  onBack?: () => void;
  onClose?: () => void;
}

const EFFECT_MS = 1000;
const LINE_MS = 380;

const CSS = `
.pa-win{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 10px);transform:translateX(-50%);width:min(94vw,460px);max-height:calc(100dvh - 20px);overflow-y:auto;overflow-x:hidden;box-sizing:border-box;padding:14px 14px 12px;border-radius:20px;color:#fbf6ea;font:15px/1.5 -apple-system,'PingFang TC','Noto Sans TC',sans-serif;z-index:60;
 background:radial-gradient(120% 60% at 50% 0%,rgba(80,70,170,.55),rgba(0,0,0,0) 60%),linear-gradient(180deg,rgba(30,28,82,.95),rgba(18,18,52,.97));
 border:2px solid #e9c46a;box-shadow:0 0 0 1px rgba(255,236,170,.35) inset,0 0 0 5px rgba(20,18,50,.6),0 0 0 6px rgba(233,196,106,.55),0 14px 40px rgba(0,0,0,.45)}
.pa-win *{box-sizing:border-box}
.pa-win::before{content:"";position:absolute;inset:6px;border-radius:15px;pointer-events:none;border:1px dashed rgba(233,196,106,.35)}
.pa-stars{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(1.5px 1.5px at 12% 18%,#fff8,transparent),radial-gradient(1px 1px at 82% 12%,#fff9,transparent),radial-gradient(1.5px 1.5px at 70% 40%,#ffe9a0aa,transparent),radial-gradient(1px 1px at 22% 60%,#fff7,transparent),radial-gradient(1.5px 1.5px at 90% 75%,#fff8,transparent),radial-gradient(1px 1px at 40% 88%,#ffe9a0aa,transparent)}
.pa-head{position:relative;display:flex;align-items:center;gap:10px}
.pa-ava{flex:none;width:58px;height:58px;border-radius:50%;border:2px solid #e9c46a;box-shadow:0 0 0 3px rgba(233,196,106,.25);background:#2b2a6e center/cover no-repeat;display:flex;align-items:center;justify-content:center;font-weight:800;color:#f3d48a}
.pa-title{flex:1;min-width:0}
.pa-name{font-weight:800;color:#f3d48a;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pa-sub{font-size:12px;opacity:.8}
.pa-x{flex:none;width:44px;height:44px;border-radius:12px;border:1px solid rgba(233,196,106,.6);background:rgba(255,255,255,.06);color:#fbf6ea;font-size:22px;line-height:1;cursor:pointer}
.pa-say{position:relative;margin:10px 0 4px;padding:9px 12px;border-radius:12px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14)}
.pa-say::before{content:"";position:absolute;left:22px;top:-7px;border:7px solid transparent;border-top:0;border-bottom-color:rgba(255,255,255,.14)}
.pa-test{display:inline-block;margin:4px 0 0;padding:2px 9px;border-radius:999px;font-size:11px;background:rgba(255,190,90,.18);border:1px solid rgba(255,200,120,.6);color:#ffd9a0}
.pa-slotwrap{display:flex;flex-direction:column;align-items:center;margin:10px 0 6px}
.pa-slot{position:relative;width:min(56vw,210px);aspect-ratio:1/1;border-radius:16px;border:2px solid #e9c46a;box-shadow:0 0 0 4px rgba(233,196,106,.18),inset 0 0 30px rgba(120,140,255,.35);background:radial-gradient(circle at 50% 50%,rgba(90,110,230,.45),rgba(20,20,60,.9) 72%);display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;touch-action:manipulation}
.pa-slot.pa-over{box-shadow:0 0 0 4px rgba(255,230,140,.8),inset 0 0 40px rgba(160,180,255,.6)}
.pa-circle{position:absolute;inset:6%;opacity:.35;animation:pa-spin 24s linear infinite}
.pa-slot .pa-icon{position:relative;width:52%;height:52%;filter:drop-shadow(0 4px 10px rgba(0,0,0,.4))}
.pa-hint{position:relative;font-size:13px;opacity:.75;text-align:center;padding:0 16px}
.pa-itemname{margin-top:6px;font-weight:700;min-height:22px}
.pa-state{display:inline-block;margin-left:6px;padding:0 8px;border-radius:9px;font-size:12px;font-weight:600;line-height:20px;background:rgba(255,255,255,.12);color:#d9dcef;vertical-align:1px}
.pa-state.done{background:rgba(232,196,110,.22);color:#f3d68b}
.pa-fx{position:absolute;inset:0;pointer-events:none;display:none}
.pa-fx.on{display:block}
.pa-fx .pa-ring{position:absolute;inset:4%;animation:pa-spin 1s linear,pa-flash 1s ease-out}
.pa-fx .pa-glow{position:absolute;inset:0;background:radial-gradient(circle,rgba(255,250,210,.95),rgba(170,190,255,.5) 35%,rgba(0,0,0,0) 70%);animation:pa-flash 1s ease-out}
.pa-spark{position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px;background:radial-gradient(circle,#fff,#ffe39a 40%,transparent 70%);border-radius:50%;animation:pa-burst 1s ease-out forwards}
.pa-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:8px 0 6px;font-size:14px}
.pa-fee b{color:#f3d48a}
.pa-go{display:block;width:100%;min-height:52px;border-radius:14px;border:1px solid #f3d48a;font:inherit;font-weight:800;font-size:17px;color:#2a1e00;cursor:pointer;background:linear-gradient(180deg,#ffe7a6,#e9b949);box-shadow:0 4px 0 #a37b1c,0 0 18px rgba(255,220,120,.35)}
.pa-go:disabled{cursor:not-allowed;color:#d9d4c4;background:linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,.06));border-color:rgba(255,255,255,.25);box-shadow:none}
.pa-res{margin:10px 0 4px;padding:8px 12px;border-radius:12px;background:rgba(0,0,0,.22);border:1px solid rgba(233,196,106,.35);min-height:52px}
.pa-res h4{margin:0 0 4px;font-size:13px;color:#f3d48a;font-weight:700}
.pa-line{display:flex;justify-content:space-between;padding:5px 2px;border-top:1px solid rgba(255,255,255,.08);font-weight:700}
.pa-line:first-of-type{border-top:0}
.pa-line.pos{color:#7ee08a}.pa-line.neg{color:#ff7a7a}.pa-line.none{color:#b9b9c6}
.pa-line.anim{animation:pa-in .32s ease-out both}
.pa-bag h4{margin:12px 0 6px;font-size:13px;color:#f3d48a}
.pa-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.pa-tile{position:relative;min-height:92px;padding:8px 4px 6px;border-radius:12px;border:1px solid rgba(233,196,106,.45);background:rgba(255,255,255,.06);color:#fbf6ea;font:inherit;font-size:12px;display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;touch-action:manipulation}
.pa-tile .pa-icon{width:44px;height:44px}
.pa-tile.sel{border-color:#ffe39a;box-shadow:0 0 0 2px rgba(255,227,154,.6)}
.pa-tile.done{opacity:.72}
.pa-badge{position:absolute;top:4px;right:4px;font-size:10px;padding:1px 6px;border-radius:999px;background:rgba(126,224,138,.2);border:1px solid rgba(126,224,138,.7);color:#bff3c6}
.pa-foot{display:flex;gap:8px;margin-top:12px}
.pa-foot button{flex:1;min-height:46px;border-radius:12px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.07);color:#fbf6ea;font:inherit;cursor:pointer}
@keyframes pa-spin{to{transform:rotate(360deg)}}
@keyframes pa-flash{0%{opacity:0;transform:scale(.6)}25%{opacity:1}100%{opacity:0;transform:scale(1.15)}}
@keyframes pa-burst{0%{transform:translate(0,0) scale(.4);opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(1);opacity:0}}
@keyframes pa-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
`;

const ICONS: Record<PetItemKind, string> = {
  seed: `<svg viewBox="0 0 64 64" class="pa-icon"><defs><radialGradient id="pas" cx=".4" cy=".35"><stop offset="0" stop-color="#e8c58a"/><stop offset="1" stop-color="#8a5a2b"/></radialGradient></defs><ellipse cx="32" cy="40" rx="15" ry="18" fill="url(#pas)" stroke="#5d3a17" stroke-width="2"/><path d="M32 24 C30 14 22 10 14 12 C16 20 24 24 32 24Z" fill="#7fd36b" stroke="#3d8a3a" stroke-width="2"/><path d="M32 24 C34 14 42 10 50 12 C48 20 40 24 32 24Z" fill="#9be07f" stroke="#3d8a3a" stroke-width="2"/><circle cx="26" cy="34" r="3" fill="#fff6" /><path d="M44 30l2 4 4 1-4 2-1 4-2-4-4-1 4-2z" fill="#ffe39a"/></svg>`,
  egg: `<svg viewBox="0 0 64 64" class="pa-icon"><defs><radialGradient id="pae" cx=".38" cy=".32"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#e9dcc0"/></radialGradient></defs><path d="M32 6 C46 6 54 28 54 40 C54 53 44 60 32 60 C20 60 10 53 10 40 C10 28 18 6 32 6Z" fill="url(#pae)" stroke="#b89b6a" stroke-width="2"/><circle cx="24" cy="30" r="4" fill="#9cc4ff"/><circle cx="40" cy="22" r="3" fill="#9cc4ff"/><circle cx="38" cy="44" r="5" fill="#9cc4ff"/><circle cx="22" cy="48" r="3" fill="#b9a2ff"/><path d="M45 34l1.5 3 3 .8-3 1.5-.8 3-1.5-3-3-.8 3-1.5z" fill="#ffe39a"/></svg>`,
  birdEgg: `<svg viewBox="0 0 64 64" class="pa-icon"><defs><radialGradient id="pab" cx=".38" cy=".32"><stop offset="0" stop-color="#eaf6ff"/><stop offset="1" stop-color="#8fc3ec"/></radialGradient></defs><path d="M32 8 C44 8 52 28 52 40 C52 52 43 59 32 59 C21 59 12 52 12 40 C12 28 20 8 32 8Z" fill="url(#pab)" stroke="#4f86b8" stroke-width="2"/><path d="M24 44 C28 30 40 24 44 20 C42 30 36 40 24 44Z" fill="#fff" stroke="#4f86b8" stroke-width="1.5"/><path d="M26 42 L40 24" stroke="#4f86b8" stroke-width="1.2"/><circle cx="22" cy="28" r="2.5" fill="#5c8fc7"/><circle cx="40" cy="48" r="2" fill="#5c8fc7"/></svg>`,
};

const CIRCLE = `<svg viewBox="0 0 100 100"><g fill="none" stroke="#ffe39a" stroke-width="0.8"><circle cx="50" cy="50" r="46"/><circle cx="50" cy="50" r="38"/><polygon points="50,6 61,39 94,50 61,61 50,94 39,61 6,50 39,39"/><polygon points="50,14 75,25 86,50 75,75 50,86 25,75 14,50 25,25" stroke-width="0.6"/><circle cx="50" cy="50" r="12"/></g><g fill="#ffe39a">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<circle cx="${50 + 42 * Math.sin((a * Math.PI) / 180)}" cy="${50 - 42 * Math.cos((a * Math.PI) / 180)}" r="1.4"/>`).join("")}</g></svg>`;

let styled = false;

export class PetAppraisalWindow {
  private readonly el: HTMLDivElement;
  private state: AppraisalState = initialAppraisal();
  private readonly opt: AppraisalWindowOptions;
  private animatedFor: string | null = null;
  private svc: PetAppraisalService;

  constructor(opt: AppraisalWindowOptions = {}) {
    this.opt = opt;
    this.svc = (opt.service ?? petAppraisalService)();
    if (!styled) {
      const st = document.createElement("style");
      st.textContent = CSS;
      document.head.appendChild(st);
      styled = true;
    }
    this.el = document.createElement("div");
    this.el.className = "pa-win";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "星靈鑑定");
    this.el.style.display = "none";
    (opt.parent ?? document.body).appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.el.style.display !== "none";
  }
  get current(): AppraisalState {
    return this.state;
  }

  async open(): Promise<void> {
    this.svc = (this.opt.service ?? petAppraisalService)();
    this.state = initialAppraisal();
    this.el.style.display = "block";
    this.render();
    const inv = await this.svc.inventory();
    if (inv.ok) this.set(withItems(this.state, inv.data, this.svc.testData));
    else this.set({ ...this.state, phase: "error", message: inv.message });
  }

  close(): void {
    this.el.style.display = "none";
    this.opt.onClose?.();
  }

  private set(s: AppraisalState): void {
    this.state = s;
    this.render();
  }

  /** 放入鑑定框（點擊或拖曳）；放好後查費用 */
  async placeItem(id: string): Promise<void> {
    const s = place(this.state, id);
    if (s === this.state) return;
    this.set(s);
    if (s.phase === "ready" && s.selectedId) {
      const q = await this.svc.quote(s.selectedId);
      if (this.state.selectedId === s.selectedId && q.ok) this.set({ ...this.state, quote: q.data });
    }
  }

  async start(): Promise<void> {
    if (!canAppraise(this.state)) return;
    const t0 = performance.now();
    await runAppraisal(this.state, this.svc, (s) => {
      // 結果在特效播完後才顯示（特效約 1 秒）
      if (s.phase === "result" || s.phase === "error" || s.phase === "appraised") {
        const wait = Math.max(0, EFFECT_MS - (performance.now() - t0));
        setTimeout(() => this.set(s), wait);
      } else {
        this.set(s);
      }
    });
  }

  private render(): void {
    const s = this.state;
    const it = selected(s);
    const name = this.opt.name ?? "星靈培育師・洛恩";
    const ava = this.opt.avatarUrl ? `style="background-image:url('${this.opt.avatarUrl}')"` : "";
    const fxOn = s.phase === "appraising";
    const sparks = fxOn
      ? Array.from({ length: 14 }, (_, i) => {
          const a = (i / 14) * Math.PI * 2;
          const r = 70 + (i % 3) * 18;
          return `<span class="pa-spark" style="--dx:${Math.round(Math.cos(a) * r)}px;--dy:${Math.round(Math.sin(a) * r)}px;animation-delay:${(i % 4) * 60}ms"></span>`;
        }).join("")
      : "";
    const lines = s.phase === "result" || s.phase === "appraised" ? s.lines : [];
    const animate = s.phase === "result" && this.animatedFor !== s.selectedId;
    if (animate) this.animatedFor = s.selectedId;
    const lineHtml = (l: AppraisalLine, i: number): string =>
      `<div class="pa-line ${l.polarity === "positive" ? "pos" : l.polarity === "negative" ? "neg" : "none"}${animate ? " anim" : ""}" style="${animate ? `animation-delay:${i * LINE_MS}ms` : ""}"><span>${l.label}</span><span>${l.text}</span></div>`;
    const resInner =
      s.phase === "appraising"
        ? `<div class="pa-hint" style="padding:8px 0">鑑定中…</div>`
        : lines.length
          ? lines.map(lineHtml).join("")
          : `<div class="pa-hint" style="padding:8px 0;text-align:left">${s.phase === "error" ? s.message : "放入物品並開始鑑定後，結果會顯示在這裡。"}</div>`;
    const btnText = s.phase === "appraising" ? "鑑定中…" : it?.appraised ? "已鑑定" : "開始鑑定";
    this.el.innerHTML = `<div class="pa-stars"></div>
      <div class="pa-head"><div class="pa-ava" ${ava}>${this.opt.avatarUrl ? "" : "洛"}</div>
        <div class="pa-title"><div class="pa-name">${name}</div><div class="pa-sub">✦ 星靈鑑定</div></div>
        <button type="button" class="pa-x" data-act="close" aria-label="關閉">×</button></div>
      <div class="pa-say">${s.phase === "error" ? s.message : s.message}</div>
      ${s.testData ? `<span class="pa-test">測試資料・非正式數值</span>` : ""}
      <div class="pa-slotwrap"><div class="pa-slot" data-act="slot" aria-label="鑑定框">
          <div class="pa-circle">${CIRCLE}</div>
          ${it ? ICONS[it.kind].replace('class="pa-icon"', 'class="pa-icon"') : `<div class="pa-hint">點選下方背包的物品<br>放入鑑定框</div>`}
          <div class="pa-fx${fxOn ? " on" : ""}"><div class="pa-glow"></div><div class="pa-ring">${CIRCLE}</div>${sparks}</div>
        </div>
        <div class="pa-itemname">${it ? `${it.name}<span style="opacity:.7;font-weight:400">（${KIND_LABEL[it.kind]}）</span><span class="pa-state ${it.appraised ? "done" : ""}">${it.appraised ? "已鑑定" : "未鑑定"}</span>` : "&nbsp;"}</div></div>
      <div class="pa-row"><span class="pa-fee">${s.phase === "result" ? `鑑定費用：<b>${chargedText(s.charged, s.testData)}</b>` : `鑑定費用：<b>${it && !it.appraised ? feeText(s.quote) : "—"}</b>`}</span>${it && s.phase !== "appraising" ? `<button type="button" class="pa-x" style="width:auto;padding:0 12px;font-size:13px" data-act="clear">取出</button>` : ""}</div>
      <button type="button" class="pa-go" data-act="start" ${canAppraise(s) ? "" : "disabled"}>${btnText}</button>
      <div class="pa-res"><h4>鑑定結果</h4>${resInner}</div>
      <div class="pa-bag"><h4>背包（種子・孵化蛋・鳥蛋）</h4><div class="pa-grid">${
        s.items.length
          ? s.items.map((x: AppraisableItem) => `<button type="button" class="pa-tile${x.id === s.selectedId ? " sel" : ""}${x.appraised ? " done" : ""}" data-act="item" data-id="${x.id}" draggable="true">${x.appraised ? `<span class="pa-badge">已鑑定</span>` : ""}${ICONS[x.kind]}<span>${x.name}</span></button>`).join("")
          : `<div class="pa-hint" style="grid-column:1/-1">${s.phase === "loading" ? "讀取中…" : "背包裡沒有可以鑑定的物品。"}</div>`
      }</div></div>
      <div class="pa-foot"><button type="button" data-act="back">返回</button><button type="button" data-act="close">關閉</button></div>`;
    this.bind();
  }

  private bind(): void {
    const q = (sel: string): HTMLElement[] => [...this.el.querySelectorAll<HTMLElement>(sel)];
    for (const b of q('[data-act="close"]')) b.onclick = () => this.close();
    for (const b of q('[data-act="back"]'))
      b.onclick = () => {
        if (this.state.pending) return;
        this.el.style.display = "none";
        this.opt.onBack?.();
      };
    for (const b of q('[data-act="start"]')) b.onclick = () => void this.start();
    for (const b of q('[data-act="clear"]')) b.onclick = () => this.set(clearSlot(this.state));
    for (const b of q('[data-act="item"]')) {
      b.onclick = () => void this.placeItem(b.dataset.id!);
      b.ondragstart = (e) => e.dataTransfer?.setData("text/plain", b.dataset.id!);
    }
    const slot = this.el.querySelector<HTMLElement>('[data-act="slot"]');
    if (slot) {
      slot.ondragover = (e) => {
        e.preventDefault();
        slot.classList.add("pa-over");
      };
      slot.ondragleave = () => slot.classList.remove("pa-over");
      slot.ondrop = (e) => {
        e.preventDefault();
        slot.classList.remove("pa-over");
        const id = e.dataTransfer?.getData("text/plain");
        if (id) void this.placeItem(id);
      };
    }
  }
}
