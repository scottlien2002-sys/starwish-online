/**
 * 星願商會：正式 API 接口（共用伺服器版 GuildMarketService）。
 * 真正的玩家交易、金幣、物品所有權必須由伺服器處理；伺服器尚未建立 → 沒有設定網址時 available = false，
 * 畫面顯示「交易伺服器尚未開放」，不會退回本機假資料。
 *
 * REST 規格（所有回應：{ ok:true, data } 或 { ok:false, reason, message }，reason 同 GuildMarketService）：
 *   GET  {base}/guild/config                        → GuildConfig
 *   GET  {base}/guild/gold                          → number
 *   GET  {base}/guild/shop                          → ShopOffer[]
 *   POST {base}/guild/shop/buy        { offerId, qty, requestId }
 *   GET  {base}/guild/inventory?category=item|equipment|pet
 *   GET  {base}/guild/npc-price?uid=
 *   POST {base}/guild/shop/sell       { uid, requestId }
 *   GET  {base}/guild/market?category=&text=&sort=&page=&pageSize=
 *   POST {base}/guild/listings        { uid, price, requestId }
 *   POST {base}/guild/listings/{id}/buy     { requestId }
 *   POST {base}/guild/listings/{id}/cancel  { requestId }
 *   GET  {base}/guild/listings/mine
 *   GET  {base}/guild/earnings
 *   POST {base}/guild/earnings/claim  { requestId }
 * 伺服器必須：同一個 requestId 只處理一次（重送回傳第一次的結果）、扣款與轉移在同一個交易內完成、掛賣物品鎖定、掛賣寵物凍結。
 * 驗證：Authorization: Bearer <token>（登入系統建立後提供；本版本不保存任何憑證）。
 */
import type { GuildMarketService, MarketResult } from "../maps/village/guildMarket.ts";

export interface ServerGuildOptions {
  /** 伺服器網址（例：https://api.example.com）；null = 尚未建立 */
  baseUrl: string | null;
  token?: () => string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createServerGuildService(o: ServerGuildOptions): GuildMarketService {
  const base = o.baseUrl?.replace(/\/$/, "") ?? null;
  const f = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const call = async <T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<MarketResult<T>> => {
    if (!base) return { ok: false, reason: "unavailable", message: "交易伺服器尚未開放（正式玩家交易需要共用伺服器）。" };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 10_000);
    try {
      const tok = o.token?.() ?? null;
      const res = await f(`${base}${path}`, {
        method,
        headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
      const j = (await res.json().catch(() => null)) as MarketResult<T> | null;
      if (!j || typeof j.ok !== "boolean") return { ok: false, reason: "error", message: `伺服器回應格式錯誤（HTTP ${res.status}）。` };
      return j;
    } catch (e) {
      return { ok: false, reason: "busy", message: `無法連線到交易伺服器：${e instanceof Error ? e.message : String(e)}` };
    } finally {
      clearTimeout(timer);
    }
  };
  const q = (p: Record<string, string | number | undefined>): string =>
    Object.entries(p)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
  return {
    available: base !== null,
    testData: false,
    serverBacked: true,
    config: () => call("GET", "/guild/config"),
    gold: () => call("GET", "/guild/gold"),
    shopCatalog: () => call("GET", "/guild/shop"),
    buyFromShop: (offerId, qty, requestId) => call("POST", "/guild/shop/buy", { offerId, qty, requestId }),
    inventory: (category) => call("GET", `/guild/inventory?${q({ category })}`),
    npcBuyPrice: (uid) => call("GET", `/guild/npc-price?${q({ uid })}`),
    sellToShop: (uid, requestId) => call("POST", "/guild/shop/sell", { uid, requestId }),
    search: (s) => call("GET", `/guild/market?${q({ category: s.category, text: s.text, sort: s.sort, page: s.page, pageSize: s.pageSize })}`),
    createListing: (uid, price, requestId) => call("POST", "/guild/listings", { uid, price, requestId }),
    buyListing: (id, requestId) => call("POST", `/guild/listings/${encodeURIComponent(id)}/buy`, { requestId }),
    cancelListing: (id, requestId) => call("POST", `/guild/listings/${encodeURIComponent(id)}/cancel`, { requestId }),
    myListings: () => call("GET", "/guild/listings/mine"),
    earnings: () => call("GET", "/guild/earnings"),
    claimEarnings: (requestId) => call("POST", "/guild/earnings/claim", { requestId }),
  };
}
