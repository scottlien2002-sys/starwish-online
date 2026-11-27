/**
 * 伺服器端輸入檢查：訊息格式、速率限制、名稱清理、請求編號格式。
 * 原則：客戶端送來的任何數值都不可信；格式不符直接丟棄並記錄違規次數。
 */
import { MAX_STEPS_PER_MSG, PROTOCOL_VERSION } from "../shared/constants.ts";
import type { ClientMsg, InputRun } from "../shared/protocol.ts";
import { isMapId } from "../shared/maps.ts";

/** 權杖桶限速：每秒補 rate 個，最多存 burst 個 */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly rate: number;
  private readonly burst: number;
  constructor(rate: number, burst: number, now: number) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.last = now;
  }
  take(now: number, n = 1): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

function validRuns(d: unknown): d is InputRun[] {
  if (!Array.isArray(d) || d.length === 0 || d.length > MAX_STEPS_PER_MSG) return false;
  let total = 0;
  for (const r of d) {
    if (!Array.isArray(r) || r.length !== 3) return false;
    if (!isInt(r[0], -127, 127) || !isInt(r[1], -127, 127) || !isInt(r[2], 1, MAX_STEPS_PER_MSG)) return false;
    total += r[2];
  }
  return total <= MAX_STEPS_PER_MSG;
}

/** 解析並檢查一則客戶端訊息；不合法回傳 null */
export function parseClientMsg(raw: string): ClientMsg | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case "hello":
      if (!isInt(o.v, 0, 1_000_000)) return null;
      if (o.name !== undefined && typeof o.name !== "string") return null;
      if (o.gender !== undefined && o.gender !== "male" && o.gender !== "female") return null;
      if (o.resume !== undefined && (typeof o.resume !== "string" || o.resume.length > 128)) return null;
      if (o.devMap !== undefined && !isMapId(o.devMap)) return null;
      return o as unknown as ClientMsg;
    case "in":
      if (!isInt(o.e, 0, 1_000_000) || !isInt(o.s, 1, Number.MAX_SAFE_INTEGER) || !validRuns(o.d)) return null;
      return o as unknown as ClientMsg;
    case "ping":
      if (typeof o.c !== "number" || !Number.isFinite(o.c)) return null;
      return o as unknown as ClientMsg;
    case "cmd":
      if (!validRequestId(o.id) || typeof o.k !== "string" || o.k.length > 32) return null;
      return o as unknown as ClientMsg;
    case "resync":
      return { t: "resync" };
    default:
      return null;
  }
}

export function validRequestId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id);
}

/** 名稱：去除控制字元與前後空白，最多 12 字；空的給預設名 */
export function sanitizeName(n: unknown, fallbackSeed: number): string {
  const s = typeof n === "string" ? n.replace(/[\u0000-\u001f\u007f<>]/g, "").trim() : "";
  const chars = Array.from(s).slice(0, 12).join("");
  return chars || `旅人${String(fallbackSeed % 10000).padStart(4, "0")}`;
}

export const protocolOk = (v: number): boolean => v === PROTOCOL_VERSION;

/** 允許連線的網頁來源：沒有 Origin（Node 測試客戶端）、本機、使用者的 GitHub Pages */
export function originAllowed(origin: string | undefined, allow: readonly string[]): boolean {
  if (!origin) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return true;
  return allow.includes(origin);
}
