import {
  type AffixLine,
  CATEGORY_LABEL,
  cfgText,
  feeOf,
  type GuildConfig,
  type GuildMarketService,
  guildMarketService,
  type Listing,
  MARKET_CATEGORIES,
  type MarketCategory,
  type MarketItem,
  type MarketResult,
  newMarketRequestId,
  type ShopOffer,
  type SortKey,
  UNSET_CONFIG,
  validatePrice,
} from "./guildMarket.ts";

/**
 * 星願商會介面（掌櫃對話選單＋道具店＋玩家交易所）。iPhone 直向可完整操作：寬度 min(94vw, 460px)、內容可捲動、按鈕 ≥ 44 px。
 * 介面不決定價格與規則：全部透過 GuildMarketService；送出期間鎖定按鈕，每次送出帶唯一 requestId（防重複扣款）。
 */
export type GuildScreen = "menu" | "shop" | "sell" | "market" | "detail" | "pick" | "price" | "mine" | "earnings";
export const GUILD_MENU: readonly { id: GuildScreen | "sellItem" | "sellEquip" | "sellPet" | "leave"; label: string; hint: string }[] = [
  { id: "shop", label: "購買道具", hint: "藥水、飼料與冒險用品" },
  { id: "sellItem", label: "出售道具", hint: "賣給商會" },
  { id: "sellEquip", label: "出售裝備", hint: "賣給商會" },
  { id: "sellPet", label: "出售寵物", hint: "賣給商會" },
  { id: "market", label: "玩家交易所", hint: "瀏覽、搜尋、購買其他玩家的商品" },
  { id: "mine", label: "我的掛賣", hint: "掛賣新商品、取消掛賣" },
  { id: "earnings", label: "領取收益", hint: "售出商品的金幣" },
  { id: "leave", label: "離開", hint: "" },
];

const ICON: Record<string, string> = {
  potion_red: "🧪", potion_blue: "🫙", herb: "🌿", feed: "🥕", stone: "💎", sword: "🗡️", staff: "🪄", shield: "🛡️", armor: "🦺",
  pet_rabbit: "🐇", pet_bird: "🐦", pet_sheep: "🐑",
};
const icon = (k: string): string => ICON[k] ?? "📦";
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const CSS = `
.gw{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 10px);transform:translateX(-50%);width:min(94vw,460px);max-height:calc(100dvh - 20px);overflow-y:auto;overflow-x:hidden;box-sizing:border-box;padding:14px 14px 12px;border-radius:20px;z-index:62;
color:#fbf6ea;font:15px/1.5 -apple-system,'PingFang TC','Noto Sans TC',sans-serif;background:radial-gradient(120% 80% at 50% 0%,rgba(52,66,140,.97),rgba(16,20,54,.97));border:2px solid #e8c46e;box-shadow:0 10px 40px rgba(0,0,0,.5),inset 0 0 0 1px rgba(255,236,180,.25)}
.gw *{box-sizing:border-box}
.gw-head{display:flex;align-items:center;gap:10px}.gw-ava{width:46px;height:46px;border-radius:50%;border:2px solid #e8c46e;background:linear-gradient(180deg,#f6e2a8,#c9973f);display:flex;align-items:center;justify-content:center;font-size:24px;flex:none}
.gw-title{flex:1;min-width:0}.gw-name{font-weight:700;color:#f3d68b;font-size:17px}.gw-sub{font-size:12px;opacity:.8}
.gw-x{flex:none;width:40px;height:40px;border-radius:12px;border:1.5px solid rgba(232,196,110,.8);background:rgba(255,255,255,.06);color:#fbf6ea;font-size:20px}
.gw-say{margin:10px 0 6px;padding:8px 12px;border-radius:12px;background:rgba(255,255,255,.07);font-size:14px}
.gw-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}.gw-tag{font-size:11px;padding:1px 8px;border-radius:9px;background:rgba(232,196,110,.2);color:#f3d68b}.gw-tag.warn{background:rgba(255,140,140,.18);color:#ffc2c2}
.gw-gold{margin-left:auto;font-size:13px;color:#f3d68b}
.gw-btn{display:block;width:100%;min-height:46px;margin:7px 0 0;padding:8px 12px;border-radius:12px;border:1.5px solid rgba(240,200,110,.85);background:linear-gradient(180deg,rgba(255,236,190,.16),rgba(255,236,190,.05));color:#fbf6ea;text-align:left;font:inherit}
.gw-btn b{display:block}.gw-btn span{font-size:12px;opacity:.75}.gw-btn.alt{border-color:rgba(255,255,255,.25);background:rgba(255,255,255,.05)}
.gw-btn:disabled{opacity:.45}.gw-go{background:linear-gradient(180deg,#f3d68b,#d9a94a)!important;color:#2a2040!important;text-align:center;font-weight:700}
.gw-tabs{display:flex;gap:6px;margin:4px 0 8px}.gw-tab{flex:1;min-height:40px;border-radius:10px;border:1.5px solid rgba(232,196,110,.5);background:rgba(255,255,255,.05);color:#fbf6ea;font:inherit;font-size:14px}.gw-tab.on{background:rgba(232,196,110,.25);border-color:#e8c46e;color:#ffe7a8;font-weight:700}
.gw-row{display:flex;gap:6px;align-items:center;margin-bottom:8px}.gw-in{flex:1;min-width:0;height:40px;border-radius:10px;border:1.5px solid rgba(232,196,110,.5);background:rgba(0,0,0,.25);color:#fbf6ea;padding:0 10px;font:inherit;font-size:16px}
.gw-sel{height:40px;border-radius:10px;border:1.5px solid rgba(232,196,110,.5);background:rgba(20,24,60,.9);color:#fbf6ea;font:inherit;font-size:14px;padding:0 6px}
.gw-list{display:flex;flex-direction:column;gap:6px}
.gw-card{display:flex;align-items:center;gap:10px;width:100%;min-height:58px;padding:8px 10px;border-radius:12px;border:1px solid rgba(232,196,110,.45);background:rgba(255,255,255,.05);color:#fbf6ea;font:inherit;text-align:left}
.gw-card .ic{font-size:26px;width:36px;text-align:center;flex:none}.gw-card .mid{flex:1;min-width:0}.gw-card .nm{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gw-card .meta{font-size:12px;opacity:.78}
.gw-card .pr{flex:none;text-align:right;color:#ffe7a8;font-weight:700;font-size:14px}.gw-card.lock{opacity:.6}
.gw-aff{display:flex;justify-content:space-between;padding:3px 2px;border-bottom:1px dashed rgba(255,255,255,.12);font-size:14px}.gw-aff.pos span:last-child{color:#7ee08a}.gw-aff.neg span:last-child{color:#ff8c8c}.gw-aff.none{color:#b8bccc}
.gw-kv{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;font-size:14px;margin:6px 0}.gw-kv span:nth-child(odd){opacity:.7}
.gw-foot{display:flex;gap:8px;margin-top:10px}.gw-foot button{flex:1;min-height:44px;border-radius:12px;border:1.5px solid rgba(255,255,255,.3);background:rgba(255,255,255,.06);color:#fbf6ea;font:inherit}
.gw-msg{margin-top:8px;font-size:13px;color:#ffd9a0;min-height:18px}
.gw-empty{opacity:.7;font-size:13px;padding:10px 2px}
`;

let styled = false;

export interface GuildWindowOptions {
  parent?: HTMLElement;
  service?: () => GuildMarketService;
  onClose?: () => void;
}

interface GState {
  screen: GuildScreen;
  cat: MarketCategory;
  text: string;
  sort: SortKey;
  cfg: GuildConfig;
  gold: number | null;
  offers: readonly ShopOffer[];
  inv: readonly MarketItem[];
  npcPrices: Record<string, number | null>;
  listings: readonly Listing[];
  total: number;
  mine: readonly Listing[];
  earn: { pending: number; sales: number } | null;
  detail: Listing | null;
  pick: MarketItem | null;
  price: string;
  qty: Record<string, number>;
  msg: string;
  busy: string | null;
}

export class GuildWindow {
  private readonly el: HTMLDivElement;
  private readonly opt: GuildWindowOptions;
  private svc: GuildMarketService;
  private s: GState;
  /** 測試用：最近一次操作結果 */
  lastResult: { action: string; ok: boolean; reason?: string } | null = null;

  constructor(opt: GuildWindowOptions = {}) {
    this.opt = opt;
    this.svc = (opt.service ?? guildMarketService)();
    if (!styled) {
      const st = document.createElement("style");
      st.textContent = CSS;
      document.head.appendChild(st);
      styled = true;
    }
    this.el = document.createElement("div");
    this.el.className = "gw";
    this.el.style.display = "none";
    this.el.addEventListener("pointerdown", (e) => e.stopPropagation());
    (opt.parent ?? document.body).appendChild(this.el);
    this.s = this.fresh();
  }

  private fresh(): GState {
    return { screen: "menu", cat: "item", text: "", sort: "priceAsc", cfg: UNSET_CONFIG, gold: null, offers: [], inv: [], npcPrices: {}, listings: [], total: 0, mine: [], earn: null, detail: null, pick: null, price: "", qty: {}, msg: "", busy: null };
  }

  get isOpen(): boolean {
    return this.el.style.display !== "none";
  }
  get state(): Readonly<GState> {
    return this.s;
  }

  async open(): Promise<void> {
    this.svc = (this.opt.service ?? guildMarketService)();
    this.s = this.fresh();
    this.el.style.display = "block";
    this.render();
    const [c, g] = await Promise.all([this.svc.config(), this.svc.gold()]);
    this.s.cfg = c.ok ? c.data : UNSET_CONFIG;
    this.s.gold = g.ok ? g.data : null;
    if (!this.svc.available) this.s.msg = c.ok ? "" : c.message;
    this.render();
  }

  close(): void {
    if (this.s.busy) return;
    this.el.style.display = "none";
    this.opt.onClose?.();
  }

  /** 選單／畫面切換（也給自動化測試） */
  async go(id: string): Promise<void> {
    if (this.s.busy) return;
    this.s.msg = "";
    if (id === "leave") return this.close();
    if (id === "menu") this.s.screen = "menu";
    else if (id === "shop") {
      this.s.screen = "shop";
      const r = await this.svc.shopCatalog();
      this.s.offers = r.ok ? r.data : [];
      if (!r.ok) this.s.msg = r.message;
    } else if (id === "sellItem" || id === "sellEquip" || id === "sellPet") {
      this.s.screen = "sell";
      this.s.cat = id === "sellItem" ? "item" : id === "sellEquip" ? "equipment" : "pet";
      await this.loadInv(true);
    } else if (id === "market") {
      this.s.screen = "market";
      await this.search();
    } else if (id === "mine") {
      this.s.screen = "mine";
      await this.loadMine();
    } else if (id === "earnings") {
      this.s.screen = "earnings";
      const r = await this.svc.earnings();
      this.s.earn = r.ok ? r.data : null;
      if (!r.ok) this.s.msg = r.message;
    }
    this.render();
  }

  private async loadInv(prices: boolean): Promise<void> {
    const r = await this.svc.inventory(this.s.cat);
    this.s.inv = r.ok ? r.data : [];
    if (!r.ok) this.s.msg = r.message;
    if (prices && r.ok) {
      const out: Record<string, number | null> = {};
      for (const it of r.data) {
        const p = await this.svc.npcBuyPrice(it.uid);
        out[it.uid] = p.ok ? p.data : null;
      }
      this.s.npcPrices = out;
    }
  }

  private async loadMine(): Promise<void> {
    const r = await this.svc.myListings();
    this.s.mine = r.ok ? r.data : [];
    if (!r.ok) this.s.msg = r.message;
  }

  async search(): Promise<void> {
    const r = await this.svc.search({ category: this.s.cat, text: this.s.text, sort: this.s.sort, page: 0, pageSize: 30 });
    this.s.listings = r.ok ? r.data.listings : [];
    this.s.total = r.ok ? r.data.total : 0;
    if (!r.ok) this.s.msg = r.message;
    this.render();
  }

  /** 送出一個會改資料的動作：鎖定 → 呼叫 → 解鎖（同一個 requestId 不會重送第二次） */
  private async act<T>(action: string, fn: (rid: string) => Promise<MarketResult<T>>, okMsg: (d: T) => string): Promise<MarketResult<T> | null> {
    if (this.s.busy) return null;
    const rid = newMarketRequestId();
    this.s.busy = rid;
    this.s.msg = "處理中…";
    this.render();
    let r: MarketResult<T>;
    try {
      r = await fn(rid);
    } catch (e) {
      r = { ok: false, reason: "error", message: e instanceof Error ? e.message : String(e) };
    }
    this.s.busy = null;
    this.s.msg = r.ok ? okMsg(r.data) : r.message;
    this.lastResult = { action, ok: r.ok, ...(r.ok ? {} : { reason: r.reason }) };
    const g = await this.svc.gold();
    if (g.ok) this.s.gold = g.data;
    return r;
  }

  async buyOffer(offerId: string): Promise<void> {
    const q = this.s.qty[offerId] ?? 1;
    await this.act("buyShop", (rid) => this.svc.buyFromShop(offerId, q, rid), (d) => `購買完成：${d.received.name} ×${d.received.qty}`);
    this.render();
  }

  async sell(uid: string): Promise<void> {
    await this.act("sellShop", (rid) => this.svc.sellToShop(uid, rid), (d) => `出售完成，獲得 ${d.paid} ${this.s.cfg.currency}`);
    await this.loadInv(true);
    this.render();
  }

  async openDetail(listingId: string): Promise<void> {
    const l = this.s.listings.find((x) => x.listingId === listingId) ?? this.s.mine.find((x) => x.listingId === listingId) ?? null;
    if (!l) return;
    this.s.detail = l;
    this.s.screen = "detail";
    this.s.msg = "";
    this.render();
  }

  async buyListing(listingId: string): Promise<void> {
    const r = await this.act("buyListing", (rid) => this.svc.buyListing(listingId, rid), (d) => `購買完成：${d.received.name}`);
    if (r?.ok) {
      this.s.screen = "market";
      await this.search();
    }
    this.render();
  }

  async startListing(): Promise<void> {
    if (this.s.busy) return;
    this.s.screen = "pick";
    this.s.pick = null;
    this.s.msg = "";
    await this.loadInv(false);
    this.render();
  }

  choose(uid: string): void {
    const it = this.s.inv.find((x) => x.uid === uid);
    if (!it || it.locked) return;
    this.s.pick = it;
    this.s.price = "";
    this.s.screen = "price";
    this.render();
  }

  async confirmListing(priceText?: string): Promise<void> {
    if (!this.s.pick) return;
    if (priceText !== undefined) this.s.price = priceText;
    const price = Number(this.s.price);
    const bad = validatePrice(price, this.s.cfg);
    if (bad) {
      this.s.msg = bad;
      return this.render();
    }
    const uid = this.s.pick.uid;
    const r = await this.act("createListing", (rid) => this.svc.createListing(uid, price, rid), () => "掛賣成功：物品已由交易系統鎖定");
    if (r?.ok) {
      this.s.screen = "mine";
      await this.loadMine();
    }
    this.render();
  }

  async cancelListing(listingId: string): Promise<void> {
    await this.act("cancelListing", (rid) => this.svc.cancelListing(listingId, rid), (d) => `已取消掛賣：${d.name} 回到背包並解除鎖定`);
    await this.loadMine();
    this.render();
  }

  async claim(): Promise<void> {
    await this.act("claim", (rid) => this.svc.claimEarnings(rid), (d) => (d.claimed > 0 ? `已領取 ${d.claimed} ${this.s.cfg.currency}` : "目前沒有可領取的收益"));
    const r = await this.svc.earnings();
    this.s.earn = r.ok ? r.data : null;
    this.render();
  }

  setCategory(c: MarketCategory): void {
    this.s.cat = c;
    if (this.s.screen === "market") void this.search();
    else if (this.s.screen === "pick") void this.loadInv(false).then(() => this.render());
    else this.render();
  }

  // ---------------------------------------------------------------- 畫面

  private itemMeta(it: MarketItem): string {
    if (it.equipment) return `Lv${it.equipment.level}・強化 +${it.equipment.enhance}・${it.equipment.appraised ? `詞條 ${it.equipment.affixes.length}` : "未鑑定"}`;
    if (it.pet) return `${it.pet.stage}・培育 Lv${it.pet.breedLevel}・${it.pet.appraised ? "已鑑定" : "未鑑定"}${it.pet.frozen ? "・暫停成長" : ""}`;
    return `數量 ${it.qty}`;
  }

  private affHtml(lines: readonly AffixLine[], appraised: boolean): string {
    if (!appraised) return `<div class="gw-aff none"><span>鑑定狀態</span><span>未鑑定</span></div>`;
    if (!lines.length) return `<div class="gw-aff none"><span>無附加屬性</span><span>—</span></div>`;
    return lines.map((a) => `<div class="gw-aff ${a.polarity === "positive" ? "pos" : a.polarity === "negative" ? "neg" : "none"}"><span>${esc(a.label)}</span><span>${esc(a.text)}</span></div>`).join("");
  }

  private detailHtml(it: MarketItem): string {
    const kv: [string, string][] = [["分類", CATEGORY_LABEL[it.category]]];
    if (it.category === "item") kv.push(["數量", String(it.qty)]);
    if (it.equipment) kv.push(["等級", `Lv${it.equipment.level}`], ["強化等級", `+${it.equipment.enhance}`], ["鑑定", it.equipment.appraised ? "已鑑定" : "未鑑定"]);
    if (it.pet) kv.push(["成長階段", it.pet.stage], ["培育等級", `Lv${it.pet.breedLevel}`], ["鑑定狀態", it.pet.appraised ? "已鑑定" : "未鑑定"], ["掛賣狀態", it.pet.frozen ? "掛賣中：暫停飽食度消耗與成長" : "—"]);
    if (it.description) kv.push(["說明", it.description]);
    const aff = it.equipment ? this.affHtml(it.equipment.affixes, it.equipment.appraised) : it.pet ? this.affHtml(it.pet.affixes, it.pet.appraised) : "";
    return `<div class="gw-kv">${kv.map(([k, v]) => `<span>${k}</span><span>${esc(v)}</span>`).join("")}</div>${aff ? `<div style="margin-top:4px;font-size:13px;opacity:.8">${it.equipment ? "鑑定詞條" : "正負詞條"}</div>${aff}` : ""}`;
  }

  private tabs(): string {
    return `<div class="gw-tabs">${MARKET_CATEGORIES.map((c) => `<button type="button" class="gw-tab${c === this.s.cat ? " on" : ""}" data-act="cat" data-v="${c}">${CATEGORY_LABEL[c]}</button>`).join("")}</div>`;
  }

  private render(): void {
    const s = this.s;
    const cur = s.cfg.currency;
    const busy = s.busy !== null;
    const dis = busy ? "disabled" : "";
    const tags = [
      this.svc.testData ? `<span class="gw-tag">測試資料・非正式數值</span>` : "",
      this.svc.available && !this.svc.serverBacked ? `<span class="gw-tag warn">本機示範：不是真正的多人交易</span>` : "",
      s.gold !== null ? `<span class="gw-gold">💰 ${s.gold} ${cur}</span>` : "",
    ].join("");
    let body = "";
    let say = "歡迎光臨星願商會！要買東西、賣東西，還是看看其他冒險者的商品？";
    if (s.screen === "menu") {
      body = GUILD_MENU.map((m) => `<button type="button" class="gw-btn${m.id === "leave" ? " alt" : ""}" data-act="go" data-v="${m.id}" ${dis}><b>${m.label}</b>${m.hint ? `<span>${m.hint}</span>` : ""}</button>`).join("");
    } else if (s.screen === "shop") {
      say = "這些是商會的常備商品。";
      body = `<div class="gw-list">${
        s.offers.length
          ? s.offers
              .map((o) => {
                const q = s.qty[o.offerId] ?? 1;
                return `<div class="gw-card"><div class="ic">${icon(o.icon)}</div><div class="mid"><div class="nm">${esc(o.name)}</div><div class="meta">${o.price === null ? "價格未定案" : `${o.price} ${cur}／個`}${o.description ? `・${esc(o.description)}` : ""}</div></div>
                <div style="display:flex;align-items:center;gap:4px"><button type="button" class="gw-x" style="width:34px;height:34px" data-act="qty" data-v="${o.offerId}" data-d="-1" ${dis}>−</button><b style="min-width:22px;text-align:center">${q}</b><button type="button" class="gw-x" style="width:34px;height:34px" data-act="qty" data-v="${o.offerId}" data-d="1" ${dis}>＋</button>
                <button type="button" class="gw-x gw-go" style="width:auto;padding:0 10px" data-act="buyOffer" data-v="${o.offerId}" ${o.price === null || busy ? "disabled" : ""}>買</button></div></div>`;
              })
              .join("")
          : `<div class="gw-empty">目前沒有商品。</div>`
      }</div>`;
    } else if (s.screen === "sell") {
      say = `要賣${CATEGORY_LABEL[s.cat]}給商會嗎？收購價比例：${cfgText(s.cfg.npcBuyRate, (n) => `${Math.round(n * 100)}%`)}`;
      body = `<div class="gw-list">${
        s.inv.length
          ? s.inv
              .map((it) => {
                const p = s.npcPrices[it.uid];
                const can = !it.locked && p !== null && p !== undefined && !busy;
                return `<div class="gw-card${it.locked ? " lock" : ""}"><div class="ic">${icon(it.icon)}</div><div class="mid"><div class="nm">${esc(it.name)}${it.locked ? `<span class="gw-tag" style="margin-left:6px">掛賣中</span>` : ""}</div><div class="meta">${esc(this.itemMeta(it))}</div></div>
                <div class="pr">${p === null || p === undefined ? "未定案" : `${p} ${cur}`}<br><button type="button" class="gw-x gw-go" style="width:auto;height:34px;padding:0 10px;margin-top:4px" data-act="sell" data-v="${it.uid}" ${can ? "" : "disabled"}>出售</button></div></div>`;
              })
              .join("")
          : `<div class="gw-empty">背包裡沒有可以出售的${CATEGORY_LABEL[s.cat]}。</div>`
      }</div>`;
    } else if (s.screen === "market") {
      say = "玩家交易所：每件商品都由交易系統保管，成交後才會轉移。";
      body = `${this.tabs()}<div class="gw-row"><input class="gw-in" data-act="text" placeholder="搜尋商品名稱或詞條" value="${esc(s.text)}" enterkeyhint="search"><button type="button" class="gw-x" style="width:auto;padding:0 10px" data-act="search" ${dis}>搜尋</button></div>
        <div class="gw-row"><span style="font-size:13px;opacity:.8">排序</span><select class="gw-sel" data-act="sort">${(
          [
            ["priceAsc", "價格低→高"],
            ["priceDesc", "價格高→低"],
            ["newest", "最新上架"],
          ] as const
        )
          .map(([k, l]) => `<option value="${k}" ${k === s.sort ? "selected" : ""}>${l}</option>`)
          .join("")}</select><span style="margin-left:auto;font-size:12px;opacity:.75">共 ${s.total} 件</span></div>
        <div class="gw-list">${
          s.listings.length
            ? s.listings.map((l) => `<button type="button" class="gw-card" data-act="detail" data-v="${l.listingId}"><div class="ic">${icon(l.item.icon)}</div><div class="mid"><div class="nm">${esc(l.item.name)}${l.item.category === "item" ? ` ×${l.item.qty}` : ""}</div><div class="meta">${esc(this.itemMeta(l.item))}・${esc(l.seller)}</div></div><div class="pr">${l.price}<br><span style="font-size:11px;opacity:.8">${cur}</span></div></button>`).join("")
            : `<div class="gw-empty">沒有符合條件的商品。</div>`
        }</div>`;
    } else if (s.screen === "detail" && s.detail) {
      const l = s.detail;
      const fee = feeOf(l.price, s.cfg);
      say = l.mine ? "這是你掛賣中的商品。" : "要買下這件商品嗎？";
      body = `<div class="gw-card" style="border-color:#e8c46e"><div class="ic">${icon(l.item.icon)}</div><div class="mid"><div class="nm">${esc(l.item.name)}</div><div class="meta">賣家：${esc(l.seller)}${l.expiresAt ? `・到期 ${new Date(l.expiresAt).toLocaleString("zh-TW", { hour12: false })}` : ""}</div></div><div class="pr">${l.price} ${cur}</div></div>
        ${this.detailHtml(l.item)}
        <div style="font-size:12px;opacity:.75;margin-top:4px">成交手續費（由賣方負擔）：${fee === null ? "未定案" : `${fee} ${cur}`}</div>
        ${l.mine ? `<button type="button" class="gw-btn alt" data-act="cancel" data-v="${l.listingId}" ${dis}><b>取消掛賣</b></button>` : `<button type="button" class="gw-btn gw-go" data-act="buyListing" data-v="${l.listingId}" ${dis}>購買（${l.price} ${cur}）</button>`}`;
    } else if (s.screen === "mine") {
      const active = s.mine.filter((l) => l.status === "active").length;
      say = "掛賣中的物品由交易系統保管：不能使用、出售或再次掛賣；寵物會暫停飽食度與成長。";
      body = `<div class="gw-kv"><span>掛賣上限</span><span>${active}／${cfgText(s.cfg.maxListings, String)}</span><span>掛賣期限</span><span>${cfgText(s.cfg.listingHours, (n) => `${n} 小時`)}</span><span>手續費</span><span>${cfgText(s.cfg.feeRate, (n) => `${Math.round(n * 1000) / 10}%`)}</span></div>
        <button type="button" class="gw-btn gw-go" data-act="startListing" ${dis}>＋ 掛賣新商品</button>
        <div class="gw-list" style="margin-top:8px">${
          s.mine.length
            ? s.mine
                .map((l) => `<div class="gw-card"><div class="ic">${icon(l.item.icon)}</div><div class="mid"><div class="nm">${esc(l.item.name)}</div><div class="meta">${{ active: "掛賣中", sold: "已售出", cancelled: "已取消", expired: "已到期" }[l.status]}・${l.price} ${cur}</div></div>${l.status === "active" ? `<button type="button" class="gw-x" style="width:auto;padding:0 10px" data-act="cancel" data-v="${l.listingId}" ${dis}>取消</button>` : ""}</div>`)
                .join("")
            : `<div class="gw-empty">目前沒有掛賣。</div>`
        }</div>`;
    } else if (s.screen === "pick") {
      say = "要掛賣哪一件？（掛賣中的物品不能重複掛賣）";
      body = `${this.tabs()}<div class="gw-list">${
        s.inv.length
          ? s.inv.map((it) => `<button type="button" class="gw-card${it.locked ? " lock" : ""}" data-act="choose" data-v="${it.uid}" ${it.locked || busy ? "disabled" : ""}><div class="ic">${icon(it.icon)}</div><div class="mid"><div class="nm">${esc(it.name)}${it.locked ? `<span class="gw-tag" style="margin-left:6px">掛賣中</span>` : ""}</div><div class="meta">${esc(this.itemMeta(it))}</div></div></button>`).join("")
          : `<div class="gw-empty">背包裡沒有${CATEGORY_LABEL[s.cat]}。</div>`
      }</div>`;
    } else if (s.screen === "price" && s.pick) {
      const p = Number(s.price);
      const fee = Number.isFinite(p) && p > 0 ? feeOf(p, s.cfg) : null;
      say = "請設定售價。成交後扣除手續費，收益到「領取收益」領取。";
      body = `<div class="gw-card"><div class="ic">${icon(s.pick.icon)}</div><div class="mid"><div class="nm">${esc(s.pick.name)}</div><div class="meta">${esc(this.itemMeta(s.pick))}</div></div></div>
        ${this.detailHtml(s.pick)}
        <div class="gw-row" style="margin-top:8px"><input class="gw-in" data-act="price" inputmode="numeric" pattern="[0-9]*" placeholder="售價（${cur}）" value="${esc(s.price)}"><span>${cur}</span></div>
        <div class="gw-kv"><span>手續費</span><span>${s.cfg.feeRate === null ? "未定案" : fee === null ? "—" : `${fee} ${cur}`}</span><span>預計收益</span><span>${s.cfg.feeRate === null || fee === null ? "—" : `${p - fee} ${cur}`}</span><span>掛賣期限</span><span>${cfgText(s.cfg.listingHours, (n) => `${n} 小時`)}</span></div>
        <button type="button" class="gw-btn gw-go" data-act="confirmListing" ${dis}>確認掛賣</button>`;
    } else if (s.screen === "earnings") {
      say = "售出商品的金幣會先存放在商會，到這裡領取。";
      body = `<div class="gw-kv"><span>可領取</span><span style="color:#ffe7a8;font-weight:700">${s.earn ? `${s.earn.pending} ${cur}` : "—"}</span><span>累計售出</span><span>${s.earn ? `${s.earn.sales} 件` : "—"}</span></div>
        <button type="button" class="gw-btn gw-go" data-act="claim" ${!s.earn || s.earn.pending <= 0 || busy ? "disabled" : ""}>領取收益</button>`;
    }
    this.el.innerHTML = `<div class="gw-head"><div class="gw-ava">⚖️</div><div class="gw-title"><div class="gw-name">星願商會・掌櫃</div><div class="gw-sub">✦ 道具店＋玩家交易所</div></div><button type="button" class="gw-x" data-act="close" aria-label="關閉" ${dis}>×</button></div>
      <div class="gw-say">${say}</div><div class="gw-tags">${tags}</div>${body}<div class="gw-msg">${esc(s.msg)}</div>
      ${s.screen !== "menu" ? `<div class="gw-foot"><button type="button" data-act="back" ${dis}>返回</button><button type="button" data-act="close" ${dis}>關閉</button></div>` : ""}`;
    this.bind();
  }

  private bind(): void {
    const q = (sel: string): HTMLElement[] => [...this.el.querySelectorAll<HTMLElement>(sel)];
    for (const b of q('[data-act="close"]')) b.onclick = () => this.close();
    for (const b of q('[data-act="back"]'))
      b.onclick = () => {
        const back: Partial<Record<GuildScreen, string>> = { detail: this.s.detail?.mine ? "mine" : "market", pick: "mine", price: "pick" };
        const to = back[this.s.screen];
        if (to === "pick") {
          this.s.screen = "pick";
          this.render();
        } else void this.go(to ?? "menu");
      };
    for (const b of q('[data-act="go"]')) b.onclick = () => void this.go(b.dataset.v!);
    for (const b of q('[data-act="cat"]')) b.onclick = () => this.setCategory(b.dataset.v as MarketCategory);
    for (const b of q('[data-act="qty"]'))
      b.onclick = () => {
        const id = b.dataset.v!;
        this.s.qty[id] = Math.max(1, Math.min(99, (this.s.qty[id] ?? 1) + Number(b.dataset.d)));
        this.render();
      };
    for (const b of q('[data-act="buyOffer"]')) b.onclick = () => void this.buyOffer(b.dataset.v!);
    for (const b of q('[data-act="sell"]')) b.onclick = () => void this.sell(b.dataset.v!);
    for (const b of q('[data-act="detail"]')) b.onclick = () => void this.openDetail(b.dataset.v!);
    for (const b of q('[data-act="buyListing"]')) b.onclick = () => void this.buyListing(b.dataset.v!);
    for (const b of q('[data-act="cancel"]')) b.onclick = () => void this.cancelListing(b.dataset.v!);
    for (const b of q('[data-act="startListing"]')) b.onclick = () => void this.startListing();
    for (const b of q('[data-act="choose"]')) b.onclick = () => this.choose(b.dataset.v!);
    for (const b of q('[data-act="confirmListing"]')) b.onclick = () => void this.confirmListing();
    for (const b of q('[data-act="claim"]')) b.onclick = () => void this.claim();
    for (const b of q('[data-act="search"]')) b.onclick = () => void this.search();
    const text = this.el.querySelector<HTMLInputElement>('[data-act="text"]');
    if (text) {
      text.oninput = () => (this.s.text = text.value);
      text.onkeydown = (e) => e.key === "Enter" && void this.search();
    }
    const sort = this.el.querySelector<HTMLSelectElement>('[data-act="sort"]');
    if (sort)
      sort.onchange = () => {
        this.s.sort = sort.value as SortKey;
        void this.search();
      };
    const price = this.el.querySelector<HTMLInputElement>('[data-act="price"]');
    if (price) price.onchange = () => {
      this.s.price = price.value.replace(/[^0-9]/g, "");
      this.render();
    };
    if (price) price.oninput = () => (this.s.price = price.value.replace(/[^0-9]/g, ""));
  }
}
