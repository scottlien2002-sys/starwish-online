/**
 * Stage 7 共用選單（星芽村、星芽原野都用）：金幣、背包（每一個物品的唯一編號）、寵物（孵化／餵食／進化／裝備／靈魂復活）、
 * 金幣紀錄、設定。鑑定在星芽村找洛恩、買賣在星願商會（這裡只顯示結果）。
 */
import { affixText, bonusScale, canEvolve, isSoul, ITEM_IDS, stageCount, type ItemId } from "../pets/petSystem.ts";
import type { WorldSession } from "../game/worldSession.ts";
import { CORE_RULES } from "../core/rules.ts";
import type { CharacterStats } from "../pets/petSystem.ts";

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
  /** 額外的設定區（地圖自己的：換 HQ／Lite、效能測試…） */
  extra?(body: HTMLElement, btn: (label: string, fn: () => void, enabled?: boolean) => HTMLButtonElement): void;
}

export class WorldPanel {
  readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private tab: PanelTab = "bag";
  msg = "";
  private reqSeq = 0;

  private readonly w: WorldSession;
  private readonly hooks: WorldPanelHooks;

  constructor(hudRoot: HTMLElement, w: WorldSession, hooks: WorldPanelHooks) {
    this.w = w;
    this.hooks = hooks;
    const toggle = document.createElement("button");
    toggle.className = "map-toggle";
    toggle.textContent = "選單";
    toggle.dataset.layout = "btn-map";
    const panel = document.createElement("div");
    panel.className = "map-panel world-panel";
    panel.style.maxHeight = "72vh";
    panel.style.overflow = "auto";
    this.root = panel;
    const stop = (e: Event): void => e.stopPropagation();
    toggle.addEventListener("pointerdown", stop);
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) this.render();
    });
    panel.addEventListener("pointerdown", stop);
    const tabs = document.createElement("div");
    tabs.className = "map-row";
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
    this.body = document.createElement("div");
    this.body.className = "map-info";
    this.body.style.whiteSpace = "normal";
    panel.append(tabs, this.body);
    hudRoot.append(toggle, panel);
  }

  get isOpen(): boolean {
    return this.root.classList.contains("open");
  }

  open(tab: PanelTab): void {
    this.tab = tab;
    this.root.classList.add("open");
    this.render();
  }

  close(): void {
    this.root.classList.remove("open");
  }

  /** 選單開著時定期更新（孵化倒數、飽食度） */
  refresh(): void {
    if (this.isOpen) this.render();
  }

  private done(msg: string): void {
    this.msg = msg;
    this.hooks.changed(msg);
    this.render();
  }

  render(): void {
    const w = this.w;
    const p = w.pets;
    const body = this.body;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>("[data-tab]")) b.classList.toggle("active", b.dataset.tab === this.tab);
    body.innerHTML = "";
    const line = (html: string): HTMLDivElement => {
      const d = document.createElement("div");
      d.style.margin = "4px 0";
      d.innerHTML = html;
      body.appendChild(d);
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
    line(`<b style="color:#ffd76a">💰 ${w.gold} 金幣</b>${w.mode === "test" ? "　<small>測試設定・非正式數值</small>" : ""}`);
    if (this.msg) line(`<b>${this.msg}</b>`);
    if (this.tab === "bag") {
      if (!p.enabled) line(`<span style="color:#ffb0b0">${p.disabledReason}</span>`);
      line(ITEM_IDS.map((k) => `<span style="color:${ITEM_COLOR[k]}">●</span> ${ITEM_LABEL[k]} <b>${p.save.items[k]}</b>`).join("　"));
      const bag = p.bag();
      if (!bag.length) line("<small>沒有種子或蛋：打倒怪物會掉落；星願商會也有販售（測試價格）。</small>");
      for (const it of bag) {
        const d = line(
          `<span style="color:${ITEM_COLOR[it.kind]}">●</span> ${ITEM_LABEL[it.kind]} <small>${it.id}</small>${it.locked ? "　<small>掛賣中</small>" : ""}<br><small>詞條：${it.affixes ? (it.affixes.length ? it.affixes.map((a) => affixText(p.cfg, a)).join("、") : "無附加屬性") : "未鑑定（到星芽村找洛恩鑑定）"}</small>`,
        );
        btn(row(d), "孵化", () => this.done(p.hatch(it.kind, this.hooks.clock(), it.id) ? `開始孵化${ITEM_LABEL[it.kind]}${it.affixes ? "（詞條跟著寵物）" : ""}` : "不能孵化（可能在掛賣中）"), p.enabled && !it.locked);
      }
      const st = this.hooks.stats();
      line(
        `<small>角色屬性（基礎 → 含寵物）：攻擊 ${st.base.attack} → <b>${st.now.attack}</b>｜攻速 ${st.base.attackSpeed} → <b>${st.now.attackSpeed}</b>（上限 ${CORE_RULES.maxAttackSpeed}）｜防禦 ${st.base.defense} → <b>${st.now.defense}</b>｜生命 ${st.base.maxHp} → <b>${st.now.maxHp}</b></small>`,
      );
      if (st.combat) line(`<small>${st.combat}</small>`);
      line(`<small>裝備欄（裝備系統尚未接入）：${Object.entries(w.save.equipment).map(([k, v]) => `${k} ${v ?? "—"}`).join("、")}</small>`);
      return;
    }
    if (this.tab === "pet") {
      if (!p.enabled) {
        line(`<span style="color:#ffb0b0">${p.disabledReason}</span>`);
        return;
      }
      line("<small>成長階段：初始 → 幼年期 → 成長期 → 完成體。孵化、成長、飽食度、死亡與復活的數值都是測試設定（非正式）。</small>");
      if (!p.save.pets.length) line("還沒有寵物：到「背包」孵化種子或蛋。");
      const care = p.tuning.care;
      for (const x of p.save.pets) {
        const sp = p.cfg.species.find((y) => y.id === x.species);
        const on = x.id === p.save.equippedId;
        const soul = isSoul(x);
        const hatchLeft = x.stage === 0 ? Math.max(0, (p.tuning.hatchSeconds ?? 0) - (this.hooks.clock() - x.obtainedAt) / 1000) : 0;
        const sat = care && x.stage > 0 ? `飽食度 ${Math.round(x.satiety ?? care.satietyMax)}／${care.satietyMax}` : "";
        const d = line(
          `<div style="padding:4px;border-radius:8px;background:${soul ? "rgba(160,200,255,.18)" : on ? "rgba(255,210,110,.35)" : "rgba(255,255,255,.12)"}">#${x.id} ${sp?.label ?? x.species}・<b>${sp?.stages[x.stage]?.label ?? x.stage}</b>${soul ? "　<b>靈魂</b>（可復活）" : ""}${x.frozen ? "　<small>掛賣中（暫停成長）</small>" : ""}<br>` +
            (x.stage === 0 ? `孵化剩 ${Math.ceil(hatchLeft)} 秒` : `經驗 ${Math.floor(x.exp)}／餵食 ${x.feedCount}｜${sat}｜發揮比例 ${(bonusScale(p.cfg, x, p.tuning) * 100).toFixed(0)}%`) +
            `<br>詞條：${x.affixes ? (x.affixes.length ? x.affixes.map((a) => affixText(p.cfg, a)).join("、") : "無附加屬性") : "未鑑定"}</div>`,
        );
        const r = row(d);
        if (soul) {
          btn(r, `靈魂復活（${care?.reviveFee ?? "未定案"} 金幣）`, () => {
            const res = p.revive(x.id, `revive-${Date.now()}-${++this.reqSeq}`, w.save.wallet);
            this.done(res.ok ? `#${x.id} 復活了（花費 ${res.charged} 金幣，詞條與階段保留）` : res.message);
          }, !!care);
          continue;
        }
        btn(r, on ? "卸下" : "裝備", () => {
          p.equip(on ? null : x.id);
          this.done(on ? "已卸下寵物" : "已裝備寵物");
        }, x.stage > 0 && !x.frozen);
        btn(r, "餵材料", () => this.done(p.feed(x.id, "monsterMaterial") ? "餵了怪物材料" : "不能餵"), x.stage > 0 && !x.frozen && p.save.items.monsterMaterial > 0);
        btn(r, "餵飼料", () => this.done(p.feed(x.id, "shopFeed") ? "餵了寵物飼料" : "不能餵"), x.stage > 0 && !x.frozen && p.save.items.shopFeed > 0);
        const canEvo = x.stage > 0 && x.stage < stageCount(p.cfg, x) - 1 && canEvolve(p.cfg, x, p.tuning);
        btn(r, "進化", () => this.done(p.evolve(x.id) ? "進化成功！詞條不變，發揮比例提升" : "還不能進化"), canEvo && !x.frozen);
      }
      return;
    }
    if (this.tab === "gold") {
      line(`<small>金幣紀錄（最近 15 筆；每一筆都有請求編號，不會重複扣款或重複領取）</small>`);
      const led = w.save.wallet.ledger.slice(-15).reverse();
      if (!led.length) line("還沒有紀錄。");
      for (const e of led) line(`<small>#${e.seq} ${LEDGER_LABEL[e.kind] ?? e.kind}　<b style="color:${e.amount >= 0 ? "#9be49b" : "#ffb0b0"}">${e.amount >= 0 ? "+" : ""}${e.amount}</b>　→ ${e.balanceAfter}　${e.ref}</small>`);
      if (w.economy.missing.length) line(`<small>正式設定還缺：${w.economy.missing.join("、")}</small>`);
      return;
    }
    line(`<small>角色：${w.gender === "male" ? "男" : "女"}初心者｜存檔建立 ${new Date(w.save.createdAt).toLocaleString("zh-TW", { hour12: false })}｜死亡 ${w.save.character.deaths} 次</small>`);
    this.hooks.extra?.(body, (label, fn, enabled = true) => btn(row(), label, fn, enabled));
    const r = row();
    btn(r, "重新開始（男）", () => this.restart("male"));
    btn(r, "重新開始（女）", () => this.restart("female"));
  }

  private restart(g: "male" | "female"): void {
    if (!window.confirm(`刪除目前存檔，重新建立${g === "male" ? "男" : "女"}角色？`)) return;
    const q = new URLSearchParams(location.search);
    q.set("play", "world");
    q.set("newgame", "1");
    q.set("g", g);
    location.replace(`${location.pathname}?${q.toString()}`);
  }
}
