/**
 * Stage 7 共用選單（星芽村、星芽原野都用）：金幣、背包（每一個物品的唯一編號）、寵物（孵化／餵食／進化／裝備／靈魂復活）、
 * 金幣紀錄、設定。鑑定在星芽村找洛恩、買賣在星願商會（這裡只顯示結果）。
 */
import { affixText, bonusScale, canEvolve, isSoul, ITEM_IDS, stageCount, type ItemId } from "../pets/petSystem.ts";
import type { WorldSession } from "../game/worldSession.ts";
import { CORE_RULES } from "../core/rules.ts";
import type { CharacterStats } from "../pets/petSystem.ts";
import type { PerfOverlay } from "../render/PerfOverlay.ts";
import { QUALITY_LABEL, type QualityLevel } from "../render/quality.ts";

export const ITEM_LABEL: Record<ItemId, string> = { seed: "星芽種子", egg: "孵化蛋", birdEgg: "鳥蛋", monsterMaterial: "怪物材料", shopFeed: "寵物飼料" };
export const ITEM_COLOR: Record<ItemId, string> = { seed: "#7bd96a", egg: "#fff3d6", birdEgg: "#9fd3ff", monsterMaterial: "#c79bff", shopFeed: "#ffcf6b" };
const LEDGER_LABEL: Record<string, string> = { monsterDrop: "怪物掉落", shopBuy: "商店購買", shopSell: "賣給商店", appraisal: "寵物鑑定", petService: "寵物服務", marketBuy: "交易所購買", marketClaim: "領取收益", test: "測試" };

export type PanelTab = "bag" | "pet" | "gold" | "more";

export interface WorldPanelHooks {
  /** 目前時間（毫秒；寵物時間成長用） */
  clock(): number;
  /** 寵物或物品改變後（重新套用屬性、跟隨外觀、存檔） */
  changed(msg: string): void;
  stats(): { base: CharacterStats; now: CharacterStats; combat?: string };
  /** 效能量測（設定分頁顯示平均 FPS、1% Low、卡頓；可重新量測、複製報告） */
  perf?(): PerfOverlay;
  /** 額外的設定區（地圖自己的：換 HQ／Lite、效能測試…） */
  extra?(body: HTMLElement, btn: (label: string, fn: () => void, enabled?: boolean) => HTMLButtonElement): void;
}

const CSS = `
.wp{position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 8px);
width:min(560px,calc(100vw - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px) - 16px));
max-height:calc(100% - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px) - 16px);
max-height:calc(100dvh - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px) - 16px);
display:none;flex-direction:column;z-index:80;pointer-events:auto;box-sizing:border-box;border-radius:16px;
background:#faf8ff;border:2px solid #fff;box-shadow:0 6px 22px rgba(60,40,120,.35);color:#3c3355;
font:13px/1.45 "PingFang TC","Noto Sans TC",system-ui,sans-serif;touch-action:pan-y;-webkit-user-select:none;user-select:none}
.wp.open{display:flex}
.wp-head{flex:none;display:flex;align-items:center;gap:6px;padding:8px 8px 6px 10px;border-bottom:1px solid rgba(80,60,140,.15)}
.wp-tabs{flex:1 1 auto;min-width:0;display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}
.wp-tabs::-webkit-scrollbar{display:none}
.wp-x{flex:none;width:44px;height:44px;border-radius:22px;border:2px solid #fff;background:linear-gradient(180deg,#ff9fb3,#ff6f8f);
color:#fff;font:700 24px/1 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(200,60,100,.35);padding:0}
.wp-sub{flex:none;display:flex;align-items:center;gap:8px;padding:6px 10px 0}
.wp-body{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;
padding:6px 12px calc(12px + env(safe-area-inset-bottom,0px) * 0)}
.wp .map-btn{min-height:40px}
.wp .map-btn.active{background:linear-gradient(180deg,#ffd76a,#f0a73c);color:#3c2a10}
.wp .map-btn.go{background:linear-gradient(180deg,#9ff0c5,#3fbf84)}
.wp-card{padding:6px 8px;border-radius:10px;background:rgba(111,140,240,.08);margin:6px 0}
.wp-card.on{background:rgba(255,200,90,.28)}
.wp-card.soul{background:rgba(120,170,255,.18)}
.wp-gold{color:#a86a00}
.wp-warn{color:#c0392b}
.wp-plus{color:#1e8e4e}
.wp-minus{color:#c0392b}
`;

/** 子畫面（返回鍵回到上一層；右上 X 一律關閉整個視窗） */
type SubView = { kind: "pet"; petId: number } | { kind: "restart"; gender: "male" | "female" };

export class WorldPanel {
  readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private tab: PanelTab = "bag";
  private view: SubView | null = null;
  msg = "";
  private reqSeq = 0;
  private touching = false;
  private lastSig = "";
  private copied = "";
  /** 關閉時通知（例如恢復遊戲操作） */
  onClose: (() => void) | null = null;

  private readonly w: WorldSession;
  private readonly hooks: WorldPanelHooks;

  constructor(hudRoot: HTMLElement, w: WorldSession, hooks: WorldPanelHooks) {
    this.w = w;
    this.hooks = hooks;
    if (!document.getElementById("wp-css")) {
      const st = document.createElement("style");
      st.id = "wp-css";
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const toggle = document.createElement("button");
    toggle.className = "map-toggle";
    toggle.textContent = "選單";
    toggle.dataset.layout = "btn-map";
    // 視窗放在 body（不在 HUD 的疊層裡），其他按鈕不會蓋住右上角的 X
    const panel = document.createElement("div");
    panel.className = "wp world-panel";
    panel.setAttribute("role", "dialog");
    this.root = panel;
    const stop = (e: Event): void => e.stopPropagation();
    toggle.addEventListener("pointerdown", stop);
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.isOpen) this.close();
      else this.open(this.tab);
    });
    for (const ev of ["pointerdown", "pointermove", "pointerup", "touchstart", "touchmove", "touchend", "wheel"]) panel.addEventListener(ev, stop, { passive: true });
    panel.addEventListener("pointerdown", () => (this.touching = true));
    const up = (): void => {
      this.touching = false;
    };
    panel.addEventListener("pointerup", up);
    panel.addEventListener("pointercancel", up);
    const head = document.createElement("div");
    head.className = "wp-head";
    const tabs = document.createElement("div");
    tabs.className = "wp-tabs";
    for (const [id, label] of [["bag", "背包"], ["pet", "寵物"], ["gold", "金幣"], ["more", "設定"]] as const) {
      const b = document.createElement("button");
      b.className = "map-btn";
      b.textContent = label;
      b.dataset.tab = id;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.open(id);
      });
      tabs.appendChild(b);
    }
    const x = document.createElement("button");
    x.className = "wp-x";
    x.type = "button";
    x.setAttribute("aria-label", "關閉");
    x.dataset.a = "close";
    x.textContent = "×";
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      this.close();
    });
    head.append(tabs, x);
    this.sub = document.createElement("div");
    this.sub.className = "wp-sub";
    this.sub.hidden = true;
    this.body = document.createElement("div");
    this.body.className = "wp-body";
    panel.append(head, this.sub, this.body);
    hudRoot.append(toggle);
    document.body.appendChild(panel);
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this.back();
    });
  }

  get isOpen(): boolean {
    return this.root.classList.contains("open");
  }

  /** 目前畫面（測試用）："bag"／"pet"／"pet:<id>"… */
  get where(): string {
    if (!this.isOpen) return "closed";
    return this.view ? (this.view.kind === "pet" ? `pet:${this.view.petId}` : `restart:${this.view.gender}`) : this.tab;
  }

  open(tab: PanelTab): void {
    if (this.tab !== tab) this.body.scrollTop = 0;
    this.tab = tab;
    this.view = null;
    this.root.classList.add("open");
    this.render(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.classList.remove("open");
    this.view = null;
    this.touching = false;
    this.onClose?.();
  }

  /** 返回上一層（子畫面 → 分頁；分頁 → 關閉） */
  back(): void {
    if (this.view) {
      this.view = null;
      this.render(true);
    } else this.close();
  }

  /** 選單開著時定期更新（孵化倒數、飽食度）。內容沒變就不重畫；手指按著時不重畫（避免按鈕在點擊途中被換掉） */
  refresh(): void {
    if (!this.isOpen || this.touching) return;
    if (this.signature() !== this.lastSig) this.render(false);
    else this.updateLive();
  }

  /** 一直在變的數字（文字節點，data-live）；按鈕不重建 */
  private liveValue(key: string): string {
    const [k, idStr] = key.split(":");
    const p = this.w.pets;
    if (k === "perf") {
      const pf = this.hooks.perf?.();
      if (!pf) return "";
      const r = pf.session();
      return `5 秒平均 <b>${pf.avgFps(5).toFixed(1)} FPS</b><br>累計 ${r.seconds} 秒：平均 <b>${r.avgFps} FPS</b>｜1% Low ${r.low1}｜最低 ${r.minFps}｜卡頓（>50 ms）${r.hitches} 次｜解析度 ${r.pixelRatio}x`;
    }
    const x = p.pet(Number(idStr));
    if (!x) return "";
    const care = p.tuning.care;
    if (x.stage === 0) return `孵化剩 ${Math.ceil(Math.max(0, (p.tuning.hatchSeconds ?? 0) - (this.hooks.clock() - x.obtainedAt) / 1000))} 秒`;
    const sat = care ? `飽食度 ${Math.round(x.satiety ?? care.satietyMax)}／${care.satietyMax}` : "";
    if (k === "sat") return sat;
    return `經驗 ${Math.floor(x.exp)}／餵食 ${x.feedCount}${sat ? `｜${sat}` : ""}｜發揮比例 ${(bonusScale(p.cfg, x, p.tuning) * 100).toFixed(0)}%`;
  }

  private live(key: string): string {
    return `<span data-live="${key}">${this.liveValue(key)}</span>`;
  }

  private updateLive(): void {
    for (const el of this.root.querySelectorAll<HTMLElement>("[data-live]")) {
      const v = this.liveValue(el.dataset.live!);
      if (el.innerHTML !== v) el.innerHTML = v;
    }
  }

  private signature(): string {
    const p = this.w.pets;
    return JSON.stringify([
      this.tab,
      this.view,
      this.msg,
      this.w.gold,
      p.save.items,
      p.bag().map((b) => [b.id, !!b.locked, b.affixes?.length ?? -1]),
      p.save.equippedId,
      // 只放「會改變按鈕或版面」的資料；倒數、飽食度、經驗這些一直在變的數字只更新文字（不重建按鈕，點擊不會落空）
      p.save.pets.map((x) => [x.id, x.stage, x.feedCount, x.life ?? "", !!x.frozen, x.affixes?.length ?? -1, x.stage > 0 && canEvolve(p.cfg, x, p.tuning)]),
      this.w.save.wallet.seq,
      this.tab === "more" ? this.hooks.stats().combat ?? "" : "",
      this.copied,
    ]);
  }

  private done(msg: string): void {
    this.msg = msg;
    this.hooks.changed(msg);
    this.render(true);
  }

  render(force = true): void {
    const sig = this.signature();
    if (!force && sig === this.lastSig) return;
    this.lastSig = sig;
    const w = this.w;
    const p = w.pets;
    const body = this.body;
    const keepScroll = body.scrollTop;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>("[data-tab]")) b.classList.toggle("active", b.dataset.tab === this.tab && !this.view);
    body.innerHTML = "";
    const line = (html: string, parent: HTMLElement = body): HTMLDivElement => {
      const d = document.createElement("div");
      d.style.margin = "4px 0";
      d.innerHTML = html;
      parent.appendChild(d);
      return d;
    };
    const row = (parent: HTMLElement = body): HTMLDivElement => {
      const d = document.createElement("div");
      d.className = "map-row";
      parent.appendChild(d);
      return d;
    };
    const btn = (r: HTMLElement, label: string, fn: () => void, enabled = true): HTMLButtonElement => {
      const b = document.createElement("button");
      b.className = "map-btn";
      b.type = "button";
      b.textContent = label;
      b.disabled = !enabled;
      b.style.opacity = enabled ? "1" : "0.45";
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
      });
      r.appendChild(b);
      return b;
    };
    // 子畫面：上方「‹ 返回」
    this.sub.innerHTML = "";
    this.sub.hidden = !this.view;
    if (this.view) {
      const back = document.createElement("button");
      back.type = "button";
      back.className = "map-btn alt";
      back.dataset.a = "back";
      back.textContent = this.view.kind === "pet" ? "‹ 返回寵物列表" : "‹ 返回設定";
      back.addEventListener("click", (e) => {
        e.stopPropagation();
        this.back();
      });
      this.sub.appendChild(back);
    }
    line(`<b class="wp-gold">💰 ${w.gold} 金幣</b>${w.mode === "test" ? "　<small>測試設定・非正式數值</small>" : ""}`);
    if (this.msg) line(`<b>${this.msg}</b>`);
    const affixLine = (a: ReturnType<typeof p.bag>[number]["affixes"]): string => (a ? (a.length ? a.map((x) => affixText(p.cfg, x)).join("、") : "無附加屬性") : "未鑑定");

    if (this.view?.kind === "restart") {
      const g = this.view.gender;
      line(`刪除目前存檔，重新建立<b>${g === "male" ? "男" : "女"}</b>角色？金幣、背包、寵物都會清空。`);
      const r = row();
      btn(r, "確定重新開始", () => this.restart(g)).classList.add("go");
      btn(r, "取消", () => this.back());
    } else if (this.view?.kind === "pet") {
      const x = p.pet(this.view.petId);
      if (!x) {
        this.view = null;
        this.render(true);
        return;
      }
      this.petDetail(x.id, line, row, btn, affixLine);
    } else if (this.tab === "bag") {
      if (!p.enabled) line(`<span class="wp-warn">${p.disabledReason}</span>`);
      line(ITEM_IDS.map((k) => `<span style="color:${ITEM_COLOR[k]};text-shadow:0 0 1px #556">●</span> ${ITEM_LABEL[k]} <b>${p.save.items[k]}</b>`).join("　"));
      const bag = p.bag();
      if (!bag.length) line("<small>沒有種子或蛋：打倒怪物會掉落；星願商會也有販售（測試價格）。</small>");
      for (const it of bag) {
        const d = line(`<span style="color:${ITEM_COLOR[it.kind]};text-shadow:0 0 1px #556">●</span> ${ITEM_LABEL[it.kind]} <small>${it.id}</small>${it.locked ? "　<small>掛賣中</small>" : ""}<br><small>詞條：${it.affixes ? affixLine(it.affixes) : "未鑑定（到星芽村找洛恩鑑定）"}</small>`);
        d.className = "wp-card";
        btn(row(d), "孵化", () => this.done(p.hatch(it.kind, this.hooks.clock(), it.id) ? `開始孵化${ITEM_LABEL[it.kind]}${it.affixes ? "（詞條跟著寵物）" : ""}` : "不能孵化（可能在掛賣中）"), p.enabled && !it.locked);
      }
      const st = this.hooks.stats();
      line(
        `<small>角色屬性（基礎 → 含寵物）：攻擊 ${st.base.attack} → <b>${st.now.attack}</b>｜攻速 ${st.base.attackSpeed} → <b>${st.now.attackSpeed}</b>（上限 ${CORE_RULES.maxAttackSpeed}）｜防禦 ${st.base.defense} → <b>${st.now.defense}</b>｜生命 ${st.base.maxHp} → <b>${st.now.maxHp}</b></small>`,
      );
      line(`<small>裝備欄（裝備系統尚未接入）：${Object.entries(w.save.equipment).map(([k, v]) => `${k} ${v ?? "—"}`).join("、")}</small>`);
    } else if (this.tab === "pet") {
      if (!p.enabled) line(`<span class="wp-warn">${p.disabledReason}</span>`);
      else {
        line("<small>成長階段：初始 → 幼年期 → 成長期 → 完成體。點一隻寵物看詳細與操作。孵化、成長、飽食度、死亡與復活的數值都是測試設定（非正式）。</small>");
        if (!p.save.pets.length) line("還沒有寵物：到「背包」孵化種子或蛋。");
        for (const x of p.save.pets) {
          const sp = p.cfg.species.find((y) => y.id === x.species);
          const on = x.id === p.save.equippedId;
          const soul = isSoul(x);
          const card = document.createElement("button");
          card.type = "button";
          card.className = `wp-card${on ? " on" : ""}${soul ? " soul" : ""}`;
          card.dataset.pet = String(x.id);
          card.style.cssText = "display:block;width:100%;text-align:left;border:1.5px solid rgba(111,140,240,.35);font:inherit;color:inherit";
          card.innerHTML = `#${x.id} ${sp?.label ?? x.species}・<b>${sp?.stages[x.stage]?.label ?? x.stage}</b>${on ? "　<b>裝備中</b>" : ""}${soul ? "　<b>靈魂</b>" : ""}${x.frozen ? "　<small>掛賣中</small>" : ""}　<span style="float:right">›</span><br><small>${this.live(`sat:${x.id}`)}</small>`;
          card.addEventListener("click", (e) => {
            e.stopPropagation();
            this.view = { kind: "pet", petId: x.id };
            this.body.scrollTop = 0;
            this.render(true);
          });
          body.appendChild(card);
        }
      }
    } else if (this.tab === "gold") {
      line(`<small>金幣紀錄（最近 15 筆；每一筆都有請求編號，不會重複扣款或重複領取）</small>`);
      const led = w.save.wallet.ledger.slice(-15).reverse();
      if (!led.length) line("還沒有紀錄。");
      for (const e of led) line(`<small>#${e.seq} ${LEDGER_LABEL[e.kind] ?? e.kind}　<b class="${e.amount >= 0 ? "wp-plus" : "wp-minus"}">${e.amount >= 0 ? "+" : ""}${e.amount}</b>　→ ${e.balanceAfter}　${e.ref}</small>`);
      if (w.economy.missing.length) line(`<small>正式設定還缺：${w.economy.missing.join("、")}</small>`);
    } else {
      line(`<small>角色：${w.gender === "male" ? "男" : "女"}初心者｜存檔建立 ${new Date(w.save.createdAt).toLocaleString("zh-TW", { hour12: false })}｜死亡 ${w.save.character.deaths} 次</small>`);
      const st = this.hooks.stats();
      if (st.combat) line(`<small>${st.combat}</small>`);
      const pf = this.hooks.perf?.();
      if (pf) {
        const r = pf.session();
        const box = line(
          `<b>效能（這台裝置實測，不是 CI）</b><br>地圖 ${r.map}｜模型 LOD <b>${r.model}</b>｜畫質 <b>${QUALITY_LABEL[r.quality as QualityLevel] ?? r.quality}</b>（解析度低於 40 FPS 會自動降低）<br>` +
            this.live("perf") +
            (this.copied ? `<br><small>${this.copied}</small>` : ""),
        );
        box.className = "wp-card";
        const pr = row(box);
        btn(pr, "重新量測", () => {
          pf.resetSession();
          this.copied = "";
          this.render(true);
        });
        btn(pr, "複製報告", () => {
          const rep = JSON.stringify({ ...pf.session(), avg5: Math.round(pf.avgFps(5) * 10) / 10, ua: navigator.userAgent, at: new Date().toISOString(), url: location.pathname + location.search });
          const done = (ok: boolean): void => {
            this.copied = ok ? "已複製到剪貼簿" : `請手動複製：${rep}`;
            this.render(true);
          };
          try {
            void navigator.clipboard.writeText(rep).then(() => done(true), () => done(false));
          } catch {
            done(false);
          }
        });
      }
      this.hooks.extra?.(body, (label, fn, enabled = true) => btn(row(), label, fn, enabled));
      const r = row();
      btn(r, "重新開始（男）", () => this.go({ kind: "restart", gender: "male" }));
      btn(r, "重新開始（女）", () => this.go({ kind: "restart", gender: "female" }));
    }
    body.scrollTop = keepScroll;
  }

  private go(v: SubView): void {
    this.view = v;
    this.body.scrollTop = 0;
    this.render(true);
  }

  private petDetail(
    id: number,
    line: (html: string, parent?: HTMLElement) => HTMLDivElement,
    row: (parent?: HTMLElement) => HTMLDivElement,
    btn: (r: HTMLElement, label: string, fn: () => void, enabled?: boolean) => HTMLButtonElement,
    affixLine: (a: ReturnType<WorldSession["pets"]["bag"]>[number]["affixes"]) => string,
  ): void {
    const w = this.w;
    const p = w.pets;
    const x = p.pet(id)!;
    const sp = p.cfg.species.find((y) => y.id === x.species);
    const on = x.id === p.save.equippedId;
    const soul = isSoul(x);
    const care = p.tuning.care;
    const d = line(
      `<b>#${x.id} ${sp?.label ?? x.species}・${sp?.stages[x.stage]?.label ?? x.stage}</b>${soul ? "　<b>靈魂</b>（可復活）" : ""}${x.frozen ? "　<small>掛賣中（暫停成長）</small>" : ""}<br>` +
        this.live(`grow:${x.id}`) +
        `<br>詞條：${affixLine(x.affixes)}<br><small>進化只提升發揮比例，鑑定詞條永遠不變。</small>`,
    );
    d.className = `wp-card${on ? " on" : ""}${soul ? " soul" : ""}`;
    const r = row();
    if (soul) {
      btn(r, `靈魂復活（${care?.reviveFee ?? "未定案"} 金幣）`, () => {
        const res = p.revive(x.id, `revive-${Date.now()}-${++this.reqSeq}`, w.save.wallet);
        this.done(res.ok ? `#${x.id} 復活了（花費 ${res.charged} 金幣，詞條與階段保留）` : res.message);
      }, !!care);
      return;
    }
    btn(r, on ? "卸下" : "裝備", () => {
      p.equip(on ? null : x.id);
      this.done(on ? "已卸下寵物" : "已裝備寵物");
    }, x.stage > 0 && !x.frozen);
    btn(r, `餵材料（${p.save.items.monsterMaterial}）`, () => this.done(p.feed(x.id, "monsterMaterial") ? "餵了怪物材料" : "不能餵"), x.stage > 0 && !x.frozen && p.save.items.monsterMaterial > 0);
    btn(r, `餵飼料（${p.save.items.shopFeed}）`, () => this.done(p.feed(x.id, "shopFeed") ? "餵了寵物飼料" : "不能餵"), x.stage > 0 && !x.frozen && p.save.items.shopFeed > 0);
    const canEvo = x.stage > 0 && x.stage < stageCount(p.cfg, x) - 1 && canEvolve(p.cfg, x, p.tuning);
    btn(r, "進化", () => this.done(p.evolve(x.id) ? "進化成功！詞條不變，發揮比例提升" : "還不能進化"), canEvo && !x.frozen);
  }

  private restart(g: "male" | "female"): void {
    const q = new URLSearchParams(location.search);
    q.set("play", "world");
    q.set("newgame", "1");
    q.set("g", g);
    location.replace(`${location.pathname}?${q.toString()}`);
  }
}
