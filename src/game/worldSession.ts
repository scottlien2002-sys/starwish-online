/**
 * Stage 7 完整遊戲循環的共用狀態：一份角色存檔（GameSave）＋寵物、金幣、商會、鑑定服務。
 * 星芽村與星芽原野都透過這裡讀寫；切換地圖時先存檔再載入另一張地圖，角色、生命、裝備欄、金幣、背包、寵物都保留。
 * 設定模式：預設「測試設定」（畫面標示）；&cfg=official 使用正式設定（缺值的功能停用並提示，遊戲照常進入）。
 */
import petCfgJson from "../config/pets.json";
import economyJson from "../config/economy.json";
import { createRng, type Rng } from "../core/rng.ts";
import { GAME_SAVE_KEY, loadGameSave, newGameSave, travel, writeGameSave, type GameSave, type Gender, type MapId } from "../core/gameSave.ts";
import { PetManager } from "../pets/PetManager.ts";
import type { PetConfig } from "../pets/petSystem.ts";
import { createPetAppraisalService, type PetAppraisalService } from "../pets/petAppraisalService.ts";
import { resolveEconomy, type Economy, type RawEconomy } from "../economy/economyConfig.ts";
import { createLocalGuildService } from "../economy/localGuildService.ts";
import { createServerGuildService } from "../economy/serverGuildService.ts";
import type { GuildMarketService } from "../maps/village/guildMarket.ts";
import { credit } from "../economy/wallet.ts";
import { claimLoot } from "../core/gameSave.ts";
import { expToNext, gainExp } from "../core/progression.ts";

export type ConfigMode = "test" | "official";

export class WorldSession {
  readonly save: GameSave;
  readonly pets: PetManager;
  readonly economy: Economy;
  readonly mode: ConfigMode;
  readonly appraisal: PetAppraisalService;
  /** 商會服務：有正式伺服器網址（&guildApi=）時用正式 API；否則用接在角色存檔上的本機服務（標示「不是真正的多人交易」） */
  readonly guild: GuildMarketService;
  readonly rng: Rng;
  readonly isNew: boolean;
  private readonly storage: Storage | null;
  private saveTimer: number | null = null;
  /** 已經開始切換地圖 */
  leaving = false;

  constructor(params: URLSearchParams) {
    this.storage = (() => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    })();
    this.mode = params.get("cfg") === "official" ? "official" : "test";
    this.economy = resolveEconomy(this.mode, economyJson as unknown as RawEconomy);
    if (params.get("newgame") === "1" && this.storage) this.storage.removeItem(GAME_SAVE_KEY);
    const loaded = this.storage ? loadGameSave(this.storage) : null;
    this.isNew = !loaded;
    const gender: Gender = params.get("g") === "female" ? "female" : "male";
    this.save = loaded ?? newGameSave(gender, this.economy.startingGold ?? 0);
    this.rng = createRng(Number(params.get("seed") ?? Date.now()) >>> 0);
    this.pets = new PetManager(petCfgJson as unknown as PetConfig, this.rng, this.mode === "official" ? "official" : "preview", JSON.stringify(this.save.pets));
    // 寵物資料與角色存檔共用同一份物件（寵物系統的異動直接寫進角色存檔）
    this.save.pets = this.pets.save;
    this.pets.on(() => this.persistSoon());
    this.appraisal = createPetAppraisalService(this.pets, { wallet: this.save.wallet, persist: () => this.persist() });
    const api = params.get("guildApi");
    this.guild = api ? createServerGuildService({ baseUrl: api }) : createLocalGuildService({ save: this.save, pets: this.pets, economy: this.economy, persist: () => this.persist() });
    if (this.isNew) this.persist();
  }

  get gender(): Gender {
    return this.save.character.gender;
  }

  get gold(): number {
    return this.save.wallet.balance;
  }

  /** 正式設定還缺的項目（寵物＋金幣） */
  get missing(): string[] {
    return [...this.pets.missing, ...this.economy.missing];
  }

  persist(): boolean {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    return this.storage ? writeGameSave(this.storage, this.save) : false;
  }

  /** 連續變動（寵物每秒成長）時合併成一次存檔 */
  persistSoon(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = window.setTimeout(() => this.persist(), 400);
  }

  /** 等級與經驗（升級表為測試設定） */
  get progress(): { level: number; exp: number; expToNext: number } {
    const c = this.save.character;
    return { level: c.level, exp: c.exp, expToNext: expToNext(c.level) };
  }

  /** 擊敗怪物得到經驗；回傳升了幾級 */
  addExp(amount: number): number {
    const ups = gainExp(this.save.character, amount);
    this.persistSoon();
    return ups;
  }

  /** 撿起金幣：同一個掉落物 uid 只會入帳一次（重複領取 → false） */
  pickGold(uid: string, amount: number, monster: string): boolean {
    if (!claimLoot(this.save, uid)) return false;
    const r = credit(this.save.wallet, uid, "monsterDrop", amount, monster);
    this.persistSoon();
    return r.ok;
  }

  /** 撿起物品：同一個掉落物 uid 只會放進背包一次 */
  pickItem(uid: string, give: () => void): boolean {
    if (!claimLoot(this.save, uid)) return false;
    give();
    this.persistSoon();
    return true;
  }

  /** 前往另一張地圖：先存檔（位置、生命），再切換（重新載入頁面，避免兩個場景同時佔用 GPU 記憶體） */
  travelTo(to: { map: MapId; x: number; z: number; yaw: number }, hp: number | null): void {
    // 之後的 pagehide／定期存檔不能再把位置寫回這張地圖
    this.leaving = true;
    travel(this.save, to);
    this.save.character.hp = hp;
    this.persist();
    // 傳送畫面（淡出＋文字），頁面切換期間不能再操作
    try {
      const o = document.createElement("div");
      o.className = "world-travel";
      o.style.cssText = "position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle,rgba(70,110,230,.55),rgba(20,24,70,.9));color:#fbf6ea;font:700 20px 'PingFang TC',system-ui,sans-serif;letter-spacing:2px;opacity:0;transition:opacity .25s;pointer-events:auto";
      o.textContent = to.map === "village" ? "✦ 傳送到星芽村…" : "✦ 傳送到星芽原野…";
      document.body.appendChild(o);
      requestAnimationFrame(() => (o.style.opacity = "1"));
    } catch {
      // 沒有畫面（測試環境）
    }
    const q = new URLSearchParams(location.search);
    q.set("play", "world");
    q.delete("newgame");
    q.delete("g");
    location.replace(`${location.pathname}?${q.toString()}`);
  }

  /** 記錄目前位置（定期與離開頁面時） */
  remember(map: MapId, x: number, z: number, yaw: number, hp: number | null): void {
    if (this.leaving) return;
    travel(this.save, { map, x, z, yaw });
    this.save.character.hp = hp;
    this.persistSoon();
  }
}
