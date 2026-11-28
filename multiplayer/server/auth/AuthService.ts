/**
 * Stage 8.5：正式帳號系統基礎（HTTP）。帳號與角色資料分開；一個帳號可以有多個角色（測試上限 4）。
 *
 *   POST /auth/register   {username, password}           → {token, username, expiresAt, characters: []}
 *   POST /auth/login      {username, password}           → {token, username, expiresAt, characters}
 *   POST /auth/logout     （Authorization: Bearer <token>）→ {ok}
 *   GET  /auth/me         （Bearer）                       → {username, characters}
 *   POST /auth/characters （Bearer）{name, gender, ap}     → {character}（之後的創角介面用）
 *   GET  /auth/config                                      → {guest: 是否允許訪客, minPassword: 8}
 *
 * 安全：
 * - 密碼 scrypt 雜湊（password.ts）；帳號不存在時也做同成本的雜湊（不能用回應時間猜帳號）
 * - 帳號或密碼錯誤一律回 invalid_credentials（不透露是哪一個錯）
 * - 同一 IP 每分鐘最多 12 次登入／註冊（超過 429）；同一帳號連續失敗 5 次鎖定 5 分鐘（423）
 * - 登入憑證 32 bytes 隨機值，伺服器只存 SHA-256；30 天到期；登出立即撤銷
 * - 只接受允許的網頁來源（與 WebSocket 相同的白名單），回應不快取
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { hashToken, type CharacterRecord, type CharacterStore } from "../persistence/Store.ts";
import { originAllowed, sanitizeName, TokenBucket } from "../security.ts";
import { dummyVerify, hashPassword, normalizeUsername, passwordProblem, verifyPassword } from "./password.ts";
import { parseAppearance } from "../../../src/core/gameSave.ts";

export const AUTH_RULES = Object.freeze({
  sessionDays: 30,
  maxFails: 5,
  lockMs: 5 * 60_000,
  ipPerMinute: 12,
  ipBurst: 12,
  maxBody: 4096,
});

export interface AuthOptions {
  allowedOrigins: readonly string[];
  allowGuest: boolean;
  log?: (m: string) => void;
}

export interface CharacterSummary {
  id: string;
  name: string;
  gender: string;
  level: number;
  map: string;
}

const summary = (c: CharacterRecord): CharacterSummary => ({ id: c.id, name: c.name, gender: c.gender, level: c.level, map: c.map });

export class AuthService {
  private readonly store: CharacterStore;
  private readonly opts: AuthOptions;
  private readonly ipBuckets = new Map<string, TokenBucket>();
  readonly stats = { registered: 0, loginOk: 0, loginFailed: 0, locked: 0, rateLimited: 0, logout: 0, badToken: 0, charactersCreated: 0 };

  constructor(store: CharacterStore, opts: AuthOptions) {
    this.store = store;
    this.opts = opts;
  }

  /** WebSocket hello 用：驗證登入憑證 */
  async verify(token: unknown, now = Date.now()): Promise<{ accountId: string } | null> {
    if (typeof token !== "string" || token.length < 20 || token.length > 128) return null;
    const s = await this.store.findSession(hashToken(token), now);
    if (!s) this.stats.badToken++;
    return s ? { accountId: s.accountId } : null;
  }

  /** 同一 IP 的登入嘗試限速（HTTP 登入與 WebSocket 憑證錯誤共用） */
  ipAllowed(ip: string, now = Date.now()): boolean {
    let b = this.ipBuckets.get(ip);
    if (!b) {
      if (this.ipBuckets.size > 20_000) this.ipBuckets.clear();
      b = new TokenBucket(AUTH_RULES.ipPerMinute / 60, AUTH_RULES.ipBurst, now);
      this.ipBuckets.set(ip, b);
    }
    const ok = b.take(now);
    if (!ok) this.stats.rateLimited++;
    return ok;
  }

  /** 處理 /auth/*；不是這裡的路徑回傳 false */
  async handle(req: IncomingMessage, res: ServerResponse, url: string, ip: string): Promise<boolean> {
    if (!url.startsWith("/auth/")) return false;
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    if (!originAllowed(origin, this.opts.allowedOrigins)) {
      this.send(res, 403, { err: "origin" }, origin);
      return true;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, this.cors(origin));
      res.end();
      return true;
    }
    try {
      const now = Date.now();
      if (url === "/auth/config" && req.method === "GET") return this.send(res, 200, { guest: this.opts.allowGuest, minPassword: 8, usernameRule: "3～20 字：英文小寫、數字、底線" }, origin);
      if ((url === "/auth/register" || url === "/auth/login") && req.method === "POST") {
        if (!this.ipAllowed(ip, now)) return this.send(res, 429, { err: "rate" }, origin);
        const body = await readJson(req);
        const username = normalizeUsername(body?.username);
        if (!username) return this.send(res, 400, { err: "bad_username" }, origin);
        if (url === "/auth/register") {
          const prob = passwordProblem(body?.password, username);
          if (prob) return this.send(res, 400, { err: prob }, origin);
          const r = await this.store.createAccount(username, await hashPassword(body!.password as string), now);
          if (!r.ok) return this.send(res, 409, { err: "taken" }, origin);
          this.stats.registered++;
          this.opts.log?.(`register ${username}`);
          return this.send(res, 200, { ...(await this.newSession(r.account.id, now)), username, characters: [] }, origin);
        }
        const pw = typeof body?.password === "string" ? body.password : "";
        const acc = await this.store.findAccount(username);
        if (!acc) {
          await dummyVerify(pw);
          this.stats.loginFailed++;
          return this.send(res, 401, { err: "invalid_credentials" }, origin);
        }
        if (acc.lockedUntil && acc.lockedUntil > now) {
          this.stats.locked++;
          return this.send(res, 423, { err: "locked", retryAfterSec: Math.ceil((acc.lockedUntil - now) / 1000) }, origin);
        }
        if (!(pw.length <= 128 && (await verifyPassword(pw, acc.passHash)))) {
          this.stats.loginFailed++;
          await this.store.loginFailed(acc.id, now, AUTH_RULES.maxFails, AUTH_RULES.lockMs);
          return this.send(res, 401, { err: "invalid_credentials" }, origin);
        }
        await this.store.loginOk(acc.id, now);
        this.stats.loginOk++;
        const chars = await this.store.listCharacters(acc.id);
        return this.send(res, 200, { ...(await this.newSession(acc.id, now)), username, characters: chars.map(summary) }, origin);
      }
      // 以下需要登入憑證
      const token = bearer(req);
      const sess = await this.verify(token, now);
      if (!sess) return this.send(res, 401, { err: "auth" }, origin);
      if (url === "/auth/logout" && req.method === "POST") {
        await this.store.revokeSession(hashToken(token!), now);
        this.stats.logout++;
        return this.send(res, 200, { ok: true }, origin);
      }
      if (url === "/auth/me" && req.method === "GET") {
        const chars = await this.store.listCharacters(sess.accountId);
        return this.send(res, 200, { accountId: sess.accountId, characters: chars.map(summary) }, origin);
      }
      if (url === "/auth/characters" && req.method === "POST") {
        const body = await readJson(req);
        const gender = body?.gender === "female" ? "female" : "male";
        const created = await this.store.createCharacter(sess.accountId, sanitizeName(body?.name, Math.floor(Math.random() * 9000)), gender, parseAppearance(body?.ap), now);
        if (!created) return this.send(res, 409, { err: "character_limit" }, origin);
        this.stats.charactersCreated++;
        return this.send(res, 200, { character: summary(created.character) }, origin);
      }
      return this.send(res, 404, { err: "not_found" }, origin);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return this.send(res, msg === "body_too_large" ? 413 : 400, { err: msg === "body_too_large" ? "too_large" : "bad_request" }, origin);
    }
  }

  private async newSession(accountId: string, now: number): Promise<{ token: string; expiresAt: number }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = now + AUTH_RULES.sessionDays * 86_400_000;
    await this.store.createSession(accountId, hashToken(token), expiresAt, now);
    return { token, expiresAt };
  }

  private cors(origin: string | undefined): Record<string, string> {
    return {
      "access-control-allow-origin": origin ?? "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-max-age": "600",
      vary: "origin",
    };
  }

  private send(res: ServerResponse, code: number, body: unknown, origin: string | undefined): true {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...this.cors(origin) });
    res.end(JSON.stringify(body));
    return true;
  }
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  return typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > AUTH_RULES.maxBody) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
        resolve(v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
      } catch {
        reject(new Error("bad_json"));
      }
    });
    req.on("error", reject);
  });
}
