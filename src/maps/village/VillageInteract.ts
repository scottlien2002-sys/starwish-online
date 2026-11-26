import type { Scene } from "@babylonjs/core";
import { PointerEventTypes } from "@babylonjs/core";
import { NPC_SPOTS, type NpcSpot, PORTALS, type PortalDef } from "./layout.ts";
import { canTalkToPetMerchant, PET_MERCHANT } from "./petMerchant.ts";
import { connectPetAppraisalService, createDemoAppraisalService, type PetAppraisalService } from "./petAppraisal.ts";
import { connectGuildMarketService, createDemoGuildService, guildMarketService, simulateDemoSale, type GuildMarketService } from "./guildMarket.ts";
import { GuildWindow } from "./GuildWindow.ts";
import { PetAppraisalWindow } from "./PetAppraisalWindow.ts";
import { PetMerchantPanel } from "./PetMerchantPanel.ts";
import type { PetMerchantV2 } from "./PetMerchantV2.ts";
import { npcProfile, type VillageNpcs } from "./NpcP3.ts";

/**
 * Stage 6 P3 全村整合：NPC、寵物商人洛恩、傳送門的點擊互動（iPhone 直向可用：靠近後畫面下方出現大按鈕，也可直接點洛恩）。
 * - 職業 NPC／鐵匠／倉庫／佈告欄：顯示 NPC 名稱與職責；實際功能由 Claude A 的系統提供，這裡標示「整合中」
 * - 洛恩：停止巡走並面向玩家 → 商人選單 →「寵物鑑定」開啟星靈鑑定視窗（預覽版使用明確標示的測試資料）
 * - 傳送門：南門開放（確認後前往星芽原野）、北東西休眠（顯示未開放）；不新增出口
 */
type Target = { kind: "npc"; npc: NpcSpot } | { kind: "merchant" } | { kind: "portal"; portal: PortalDef };

export interface InteractOptions {
  avatarUrl: string;
  goToMap: (map: "starsprout") => void;
  /** Stage 7：寵物鑑定服務（Claude A 寵物核心＋金幣扣款）；沒有傳入 → 示範服務 */
  appraisal?: PetAppraisalService;
  /** Stage 7：星願商會服務；沒有傳入 → 示範服務 */
  guild?: GuildMarketService;
  /** 視窗關閉、金幣或背包可能改變時通知（更新畫面） */
  onChange?: () => void;
}

const CSS = `
.vi-btn{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 150px);z-index:40;min-width:150px;max-width:70vw;padding:12px 20px;border-radius:24px;border:2px solid #e8c46e;
background:linear-gradient(180deg,rgba(40,52,110,.94),rgba(22,28,66,.94));color:#fbf6ea;font:600 16px/1.2 -apple-system,'PingFang TC','Noto Sans TC',sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vi-dlg{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 12px);transform:translateX(-50%);width:min(94vw,440px);z-index:55;box-sizing:border-box;padding:14px 16px;border-radius:18px;border:2px solid #e8c46e;
background:linear-gradient(180deg,rgba(32,40,92,.96),rgba(16,20,52,.96));color:#fbf6ea;font:15px/1.55 -apple-system,'PingFang TC','Noto Sans TC',sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.45)}
.vi-dlg h3{margin:0 0 2px;font-size:17px;color:#f3d68b}.vi-dlg .vi-role{font-size:12px;opacity:.75;margin-bottom:8px}
.vi-dlg .vi-row{display:flex;gap:10px;margin-top:12px}.vi-dlg button{flex:1;min-height:44px;border-radius:12px;border:1.5px solid #e8c46e;background:rgba(255,255,255,.08);color:#fbf6ea;font:600 15px -apple-system,'PingFang TC',sans-serif}
.vi-dlg button.vi-go{background:linear-gradient(180deg,#f3d68b,#d9a94a);color:#2a2040}
.vi-tag{display:inline-block;margin-left:6px;padding:0 8px;border-radius:9px;font-size:11px;background:rgba(232,196,110,.2);color:#f3d68b}
`;

const CLASS_NPC: Record<string, string> = { sword: "劍士", knight: "騎士", mage: "法師", church: "祭司", circus: "小丑" };

export class VillageInteract {
  private readonly btn: HTMLButtonElement;
  private readonly dlg: HTMLDivElement;
  private readonly panel = new PetMerchantPanel();
  private readonly appraisal: PetAppraisalWindow;
  private readonly guild: GuildWindow;
  private target: Target | null = null;
  private talking = false;
  private px = 0;
  private pz = 0;
  private now = 0;
  /** 測試／自動化用：最近一次互動紀錄 */
  readonly log: { t: number; what: string }[] = [];

  private readonly merchant: PetMerchantV2 | null;
  private readonly opts: InteractOptions;
  /** Stage 6.2：正式 NPC（對話時轉身面向玩家並播放對話動作） */
  npcs: VillageNpcs | null = null;
  /** 正在對話的 NPC（spot id）；對話框／商會視窗關閉後自動清除 */
  private npcTalk: string | null = null;
  private lastNow: number | null = null;

  constructor(scene: Scene, merchant: PetMerchantV2 | null, opts: InteractOptions) {
    this.merchant = merchant;
    this.opts = opts;
    const st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);
    this.btn = document.createElement("button");
    this.btn.type = "button";
    this.btn.className = "vi-btn";
    this.btn.hidden = true;
    this.btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.btn.addEventListener("click", () => this.activate());
    document.body.appendChild(this.btn);
    this.dlg = document.createElement("div");
    this.dlg.className = "vi-dlg";
    this.dlg.hidden = true;
    this.dlg.addEventListener("pointerdown", (e) => e.stopPropagation());
    document.body.appendChild(this.dlg);
    // 預覽版：星靈鑑定使用明確標示的測試資料。Stage 7 完整遊戲：接上 Claude A 寵物核心（opts.appraisal）
    connectPetAppraisalService(opts.appraisal ?? createDemoAppraisalService({ delayMs: 600 }));
    this.appraisal = new PetAppraisalWindow({ avatarUrl: opts.avatarUrl, onBack: () => void this.panel.open(), onClose: () => {
      this.endTalk();
      opts.onChange?.();
    } });
    this.panel.onAppraise = () => void this.appraisal.open();
    // 預覽版：星願商會使用明確標示的本機示範資料（不是真正的多人交易；正式交易由共用伺服器處理）
    // Stage 7 完整遊戲：接在角色存檔上的本機服務或正式 API（opts.guild）
    connectGuildMarketService(opts.guild ?? createDemoGuildService({ delayMs: 400 }));
    this.guild = new GuildWindow({ onClose: () => opts.onChange?.() });
    this.panel.onClose = () => {
      if (!this.appraisal.isOpen) this.endTalk();
    };
    // 直接點洛恩（在互動距離內才開對話）
    if (merchant) {
      scene.onPointerObservable.add((pi) => {
        if (pi.type !== PointerEventTypes.POINTERTAP || this.busy) return;
        const hit = scene.pick(scene.pointerX, scene.pointerY, (m) => merchant.pickMeshes.includes(m));
        if (!hit?.hit) return;
        if (canTalkToPetMerchant(this.px, this.pz, merchant.clock.patrolTime(this.now))) this.talkMerchant();
        else this.say("星靈培育師・洛恩", "再靠近一點就能和洛恩說話（2.5 公尺內）。");
      });
    }
  }

  get busy(): boolean {
    return this.talking || !this.dlg.hidden || this.panel.isOpen || this.appraisal.isOpen || this.guild.isOpen;
  }

  /** 每幀：玩家位置、洛恩時間（秒） */
  update(now: number, px: number, pz: number): void {
    const dt = this.lastNow === null ? 0 : now - this.lastNow;
    this.lastNow = now;
    this.now = now;
    this.px = px;
    this.pz = pz;
    if (this.npcTalk && this.dlg.hidden && !this.guild.isOpen) this.npcTalk = null;
    this.npcs?.update(now, dt, this.npcTalk, px, pz);
    if (this.merchant) {
      // 對話中：每幀送出心跳（玩家位置），讓洛恩停下並面向玩家；關閉後釋放
      if (this.talking) this.merchant.clock.hold("player", now, px, pz);
      this.merchant.update(now);
    }
    if (this.busy) {
      this.btn.hidden = true;
      return;
    }
    this.target = this.findTarget();
    if (!this.target) {
      this.btn.hidden = true;
      return;
    }
    this.btn.hidden = false;
    this.btn.textContent = this.target.kind === "portal" ? `✦ ${this.target.portal.name}` : `💬 ${this.target.kind === "merchant" ? "星靈培育師・洛恩" : this.target.npc.name.replace("（鍛造台旁）", "")}`;
  }

  private findTarget(): Target | null {
    if (this.merchant && canTalkToPetMerchant(this.px, this.pz, this.merchant.clock.patrolTime(this.now))) return { kind: "merchant" };
    let best: NpcSpot | null = null;
    let bd = Infinity;
    for (const n of NPC_SPOTS) {
      const d = Math.hypot(n.x - this.px, n.z - this.pz);
      if (d <= n.interactR && d < bd) {
        best = n;
        bd = d;
      }
    }
    if (best) return { kind: "npc", npc: best };
    for (const p of PORTALS) if (Math.hypot(p.x - this.px, p.z - this.pz) <= p.r + 0.3) return { kind: "portal", portal: p };
    return null;
  }

  /** 按下互動按鈕（也給自動化測試呼叫） */
  activate(t: Target | null = this.target): string {
    if (!t) return "none";
    if (t.kind === "merchant") {
      this.talkMerchant();
      return "merchant";
    }
    if (t.kind === "npc" && t.npc.id === "guild") {
      this.npcTalk = "guild";
      void this.guild.open();
      this.log.push({ t: this.now, what: "npc:guild" });
      return "npc:guild";
    }
    if (t.kind === "npc") {
      const n = t.npc;
      const cls = CLASS_NPC[n.id];
      const body = cls
        ? `想成為${cls}嗎？${cls}轉職功能正在整合中（預覽版），敬請期待。`
        : n.id === "smith"
          ? "鐵匠轉職、裝備詞條鑑定都找我（同一位鐵匠）。功能正在整合中。"
          : n.id === "board"
            ? "每日委託會貼在這裡。功能正在整合中。"
            : n.id === "warehouse"
              ? "要寄放物品嗎？倉庫功能正在整合中。"
              : "功能正在整合中。";
      const prof = npcProfile(n.id);
      this.npcTalk = n.id;
      this.say(prof ? `${prof.title}・${prof.name}` : n.name.replace("（鍛造台旁）", ""), prof ? `「${prof.greeting}」<br>${body}` : body, n.role);
      this.log.push({ t: this.now, what: `npc:${n.id}` });
      return `npc:${n.id}`;
    }
    const p = t.portal;
    if (p.open && p.destination) {
      this.say(p.name, `通往 ${p.destination.label}。要前往嗎？`, "開放", () => this.opts.goToMap("starsprout"));
    } else {
      this.say(p.name, "這座傳送門目前處於休眠狀態，尚未開放。", "未開放");
    }
    this.log.push({ t: this.now, what: `portal:${p.id}:${p.open ? "open" : "sealed"}` });
    return `portal:${p.id}`;
  }

  private talkMerchant(): void {
    if (!this.merchant) return;
    this.talking = true;
    this.merchant.clock.hold("player", this.now, this.px, this.pz);
    this.log.push({ t: this.now, what: "merchant" });
    void this.panel.open();
  }

  private endTalk(): void {
    if (!this.talking) return;
    this.talking = false;
    this.merchant?.clock.release("player", this.now);
  }

  private say(name: string, body: string, role = "", onGo?: () => void): void {
    this.dlg.innerHTML = `<h3>${name}${role ? `<span class="vi-tag">${role}</span>` : ""}</h3><div>${body}</div>
      <div class="vi-row">${onGo ? `<button type="button" class="vi-go" data-a="go">前往</button>` : ""}<button type="button" data-a="close">${onGo ? "取消" : "關閉"}</button></div>`;
    this.dlg.hidden = false;
    this.btn.hidden = true;
    for (const b of this.dlg.querySelectorAll<HTMLButtonElement>("button"))
      b.onclick = () => {
        this.dlg.hidden = true;
        if (b.dataset.a === "go") onGo?.();
      };
  }

  closeAll(): void {
    this.dlg.hidden = true;
    this.guild.close();
    this.panel.close();
    this.appraisal.close();
    this.endTalk();
  }

  state(): { target: string | null; talking: boolean; dialog: string; panelOpen: boolean; appraisalOpen: boolean; merchantPaused: boolean } {
    const t = this.target ?? this.findTarget();
    return {
      target: t ? (t.kind === "npc" ? `npc:${t.npc.id}` : t.kind === "portal" ? `portal:${t.portal.id}` : "merchant") : null,
      talking: this.talking,
      dialog: this.dlg.hidden ? "" : (this.dlg.textContent ?? ""),
      panelOpen: this.panel.isOpen,
      appraisalOpen: this.appraisal.isOpen,
      merchantPaused: this.merchant ? this.merchant.clock.paused(this.now) : false,
    };
  }

  /** 測試／自動化：星願商會操作（open／go:<選單>／cat:<分類>／detail／buy／startListing／choose／price:<n>／cancel／sale／claim／close），回傳狀態摘要 */
  async guildCmd(cmd: string): Promise<Record<string, unknown>> {
    const g = this.guild;
    const st = g.state;
    if (cmd === "open") await g.open();
    else if (cmd.startsWith("go:")) await g.go(cmd.slice(3));
    else if (cmd.startsWith("cat:")) {
      g.setCategory(cmd.slice(4) as never);
      await new Promise((r) => setTimeout(r, 50));
    } else if (cmd === "detail") {
      const l = st.listings[0];
      if (l) await g.openDetail(l.listingId);
    } else if (cmd === "buy" && st.detail) await g.buyListing(st.detail.listingId);
    else if (cmd === "startListing") await g.startListing();
    else if (cmd === "choose") {
      const it = st.inv.find((x) => !x.locked);
      if (it) g.choose(it.uid);
    } else if (cmd.startsWith("price:")) await g.confirmListing(cmd.slice(6));
    else if (cmd === "cancel") {
      const l = st.mine.find((x) => x.status === "active");
      if (l) await g.cancelListing(l.listingId);
    } else if (cmd === "sale") {
      const l = st.mine.find((x) => x.status === "active");
      if (l) simulateDemoSale(guildMarketService(), l.listingId);
    } else if (cmd === "claim") await g.claim();
    else if (cmd === "close") g.close();
    const s = g.state;
    return {
      open: g.isOpen,
      screen: s.screen,
      cat: s.cat,
      gold: s.gold,
      listings: s.listings.map((l) => ({ id: l.listingId, cat: l.item.category, price: l.price, eq: l.item.equipment ? { level: l.item.equipment.level, enhance: l.item.equipment.enhance, affixes: l.item.equipment.affixes.length } : null, pet: l.item.pet ? { stage: l.item.pet.stage, breed: l.item.pet.breedLevel, appraised: l.item.pet.appraised, affixes: l.item.pet.affixes.map((a) => a.polarity) } : null })),
      inv: s.inv.map((i) => ({ uid: i.uid, locked: i.locked, frozen: i.pet?.frozen ?? null })),
      mine: s.mine.map((l) => ({ id: l.listingId, status: l.status, uid: l.item.uid })),
      earn: s.earn,
      msg: s.msg,
      last: g.lastResult,
      test: guildMarketService().testData,
      serverBacked: guildMarketService().serverBacked,
      hScroll: document.documentElement.scrollWidth - window.innerWidth,
    };
  }

  get appraisalWindow(): PetAppraisalWindow {
    return this.appraisal;
  }

  /** 互動距離（給說明與測試） */
  static readonly MERCHANT_R = PET_MERCHANT.interactR;
}
