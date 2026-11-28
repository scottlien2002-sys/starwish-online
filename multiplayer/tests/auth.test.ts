/**
 * Stage 8.5：帳號系統測試（真的開伺服器：HTTP /auth/* ＋ WebSocket hello）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { Bot, sleep, startServer } from "./helpers.ts";
import type { GameServer } from "../server/GameServer.ts";
import { MemoryStore } from "../server/persistence/Store.ts";
import { AUTH_RULES } from "../server/auth/AuthService.ts";

const results: Record<string, unknown> = {};
process.on("exit", () => {
  mkdirSync(new URL("../test-results/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../test-results/auth.json", import.meta.url), JSON.stringify(results, null, 2));
});

async function api(srv: GameServer, path: string, body?: unknown, token?: string, ip?: string): Promise<{ status: number; j: Record<string, unknown> }> {
  const r = await fetch(`http://127.0.0.1:${srv.port}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(ip ? { "x-forwarded-for": ip } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, j: (await r.json()) as Record<string, unknown> };
}

test("註冊、登入、查詢、登出；密碼只存 scrypt 雜湊；登出後憑證失效", async () => {
  const store = new MemoryStore();
  const srv = await startServer({ store });
  try {
    const reg = await api(srv, "/auth/register", { username: "Starwish_01", password: "correct horse 1" });
    assert.equal(reg.status, 200);
    assert.equal(reg.j.username, "starwish_01", "帳號存小寫");
    const acc = (await store.findAccount("starwish_01"))!;
    assert.match(acc.passHash, /^scrypt\$16384\$8\$1\$/);
    assert.ok(!acc.passHash.includes("correct horse"));
    assert.equal((await api(srv, "/auth/register", { username: "starwish_01", password: "another pass 2" })).status, 409, "帳號重複");
    assert.equal((await api(srv, "/auth/register", { username: "ab", password: "12345678" })).j.err, "bad_username");
    assert.equal((await api(srv, "/auth/register", { username: "abc_def", password: "short" })).j.err, "password_too_short");
    assert.equal((await api(srv, "/auth/register", { username: "abc_def", password: "abc_def" })).j.err, "password_too_short");
    assert.equal((await api(srv, "/auth/register", { username: "abc_defg", password: "abc_defg" })).j.err, "password_same_as_username");
    const login = await api(srv, "/auth/login", { username: "STARWISH_01", password: "correct horse 1" });
    assert.equal(login.status, 200);
    const token = login.j.token as string;
    assert.ok(token.length >= 40);
    const me = await api(srv, "/auth/me", undefined, token);
    assert.equal(me.status, 200);
    assert.deepEqual(me.j.characters, []);
    assert.equal((await api(srv, "/auth/logout", {}, token)).status, 200);
    assert.equal((await api(srv, "/auth/me", undefined, token)).status, 401, "登出後憑證失效");
    assert.equal((await api(srv, "/auth/me", undefined, "x".repeat(43))).status, 401, "亂猜的憑證");
    results.basic = { hashPrefix: acc.passHash.slice(0, 22), tokenLen: token.length };
  } finally {
    await srv.stop();
  }
});

test("帳號或密碼錯誤回同一個訊息；帳號不存在與密碼錯誤花的時間相近（不能用時間猜帳號）", async () => {
  const srv = await startServer();
  try {
    await api(srv, "/auth/register", { username: "timing_a", password: "password-123" });
    const t = async (u: string): Promise<number> => {
      const t0 = performance.now();
      const r = await api(srv, "/auth/login", { username: u, password: "wrong-password" }, undefined, `10.0.0.${Math.floor(Math.random() * 200)}`);
      assert.equal(r.j.err, "invalid_credentials");
      return performance.now() - t0;
    };
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 3; i++) {
      known.push(await t("timing_a"));
      unknown.push(await t("no_such_user"));
    }
    const avg = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
    const ratio = avg(unknown) / avg(known);
    results.timing = { knownMs: +avg(known).toFixed(1), unknownMs: +avg(unknown).toFixed(1), ratio: +ratio.toFixed(2) };
    assert.ok(ratio > 0.4 && ratio < 2.5, JSON.stringify(results.timing));
  } finally {
    await srv.stop();
  }
});

test("同一帳號連續 5 次密碼錯誤鎖定 5 分鐘（正確密碼也進不去）；同一 IP 每分鐘最多 12 次", async () => {
  const srv = await startServer({ trustProxy: true });
  try {
    await api(srv, "/auth/register", { username: "lock_me", password: "password-123" }, undefined, "10.1.0.1");
    const codes: number[] = [];
    for (let i = 0; i < AUTH_RULES.maxFails; i++) codes.push((await api(srv, "/auth/login", { username: "lock_me", password: "bad-password" }, undefined, `10.2.0.${i}`)).status);
    const locked = await api(srv, "/auth/login", { username: "lock_me", password: "password-123" }, undefined, "10.3.0.1");
    assert.deepEqual(codes, [401, 401, 401, 401, 401]);
    assert.equal(locked.status, 423);
    assert.ok((locked.j.retryAfterSec as number) > 200);
    // 同一 IP：12 次之後 429
    const ipCodes: number[] = [];
    for (let i = 0; i < 15; i++) ipCodes.push((await api(srv, "/auth/login", { username: `nobody_${i}`, password: "whatever-123" }, undefined, "10.9.9.9")).status);
    assert.equal(ipCodes.filter((c) => c === 429).length, 3, ipCodes.join(","));
    results.lockout = { codes, lockedStatus: locked.status, retryAfterSec: locked.j.retryAfterSec, ipCodes };
  } finally {
    await srv.stop();
  }
});

test("WebSocket：帳號登入進入自己的角色；斷線重連回同一角色；不能用別人的角色；角色憑證單獨不能接回帳號角色", async () => {
  const store = new MemoryStore();
  const srv = await startServer({ store });
  const bots: Bot[] = [];
  try {
    const a = (await api(srv, "/auth/register", { username: "player_a", password: "password-aaa" })).j.token as string;
    const b = (await api(srv, "/auth/register", { username: "player_b", password: "password-bbb" })).j.token as string;
    const A = new Bot(srv, { auth: a, name: "阿星", gender: "male" });
    bots.push(A);
    await A.online();
    const cidA = A.c.characterId;
    const me = await api(srv, "/auth/me", undefined, a);
    assert.deepEqual((me.j.characters as { id: string }[]).map((c) => c.id), [cidA], "第一次進遊戲自動建立角色並綁定帳號");
    // 斷線重連：帶帳號憑證＋cid
    A.c.dropConnection();
    await A.until(() => A.c.state === "online" && A.c.stats.reconnects >= 1, 8000, "reconnected");
    assert.equal(A.c.characterId, cidA);
    // B 帳號拿 A 的角色 id → 拒絕
    const B = new Bot(srv, { auth: b, cid: cidA });
    bots.push(B);
    await B.until(() => B.events.some((e) => e.type === "error"), 4000, "rejected");
    assert.equal((B.events.find((e) => e.type === "error") as { code: string }).code, "not_your_character");
    // 帳號角色的角色憑證（資料庫裡有，但不會發給客戶端）就算外流，單獨使用也被拒絕
    assert.equal(A.c.token, "", "帳號角色不發角色重連憑證");
    const accA = (await store.findAccount("player_a"))!;
    const extra = (await store.createCharacter(accA.id, "第二角", "female", { hair: "hair01", hairColor: null, weapon: "staff" }, Date.now()))!;
    const C = new Bot(srv, { resumeToken: extra.token });
    bots.push(C);
    await C.until(() => C.events.some((e) => e.type === "error"), 4000, "rejected");
    assert.equal((C.events.find((e) => e.type === "error") as { code: string }).code, "auth_required");
    // 亂造的帳號憑證
    const D = new Bot(srv, { auth: "y".repeat(43) });
    bots.push(D);
    await D.until(() => D.events.some((e) => e.type === "error"), 4000, "rejected");
    assert.equal((D.events.find((e) => e.type === "error") as { code: string }).code, "auth");
    results.ws = { cidA, rejected: ["not_your_character", "auth_required", "auth"] };
  } finally {
    for (const x of bots) x.stop();
    await srv.stop();
  }
});

test("重複登入：同一角色在第二台裝置登入，第一台被踢（replaced）；登出後舊憑證連不進來", async () => {
  const srv = await startServer();
  const bots: Bot[] = [];
  try {
    const tok = (await api(srv, "/auth/register", { username: "dup_login", password: "password-dup" })).j.token as string;
    const P1 = new Bot(srv, { auth: tok });
    bots.push(P1);
    await P1.online();
    const tok2 = (await api(srv, "/auth/login", { username: "dup_login", password: "password-dup" })).j.token as string;
    const P2 = new Bot(srv, { auth: tok2, cid: P1.c.characterId });
    bots.push(P2);
    await P2.online();
    await P1.until(() => P1.events.some((e) => e.type === "error" && (e as { code: string }).code === "replaced"), 4000, "kicked");
    assert.equal(P2.c.characterId, P1.c.characterId);
    assert.equal(srv.stats.replaced, 1);
    await api(srv, "/auth/logout", {}, tok);
    const P3 = new Bot(srv, { auth: tok });
    bots.push(P3);
    await P3.until(() => P3.events.some((e) => e.type === "error"), 4000, "rejected");
    assert.equal((P3.events.find((e) => e.type === "error") as { code: string }).code, "auth");
    results.duplicate = { replaced: srv.stats.replaced };
  } finally {
    for (const x of bots) x.stop();
    await srv.stop();
  }
});

test("關閉訪客模式（MP_ALLOW_GUEST=0）：不登入不能進遊戲；帳號角色上限（測試設定 4 個）", async () => {
  const srv = await startServer({ allowGuest: false });
  const bots: Bot[] = [];
  try {
    const G = new Bot(srv, { name: "guest" });
    bots.push(G);
    await G.until(() => G.events.some((e) => e.type === "error"), 4000, "rejected");
    assert.equal((G.events.find((e) => e.type === "error") as { code: string }).code, "auth_required");
    assert.equal((await api(srv, "/auth/config")).j.guest, false);
    const tok = (await api(srv, "/auth/register", { username: "many_chars", password: "password-many" })).j.token as string;
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await api(srv, "/auth/characters", { name: `角色${i}`, gender: i % 2 ? "female" : "male" }, tok)).status);
    assert.deepEqual(codes, [200, 200, 200, 200, 409]);
    const me = await api(srv, "/auth/me", undefined, tok);
    const chars = me.j.characters as { id: string; name: string }[];
    assert.equal(chars.length, 4);
    // 選第 3 個角色進遊戲
    const P = new Bot(srv, { auth: tok, cid: chars[2]!.id });
    bots.push(P);
    await P.online();
    assert.equal(P.c.characterId, chars[2]!.id);
    results.noGuest = { guestRejected: true, createCodes: codes };
  } finally {
    for (const x of bots) x.stop();
    await srv.stop();
  }
});

test("其他來源的網頁不能呼叫 /auth（只接受白名單）；請求內容過大被拒", async () => {
  const srv = await startServer({ allowedOrigins: ["https://scottlien2002-sys.github.io"] });
  try {
    const bad = await fetch(`http://127.0.0.1:${srv.port}/auth/login`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    assert.equal(bad.status, 403);
    const ok = await fetch(`http://127.0.0.1:${srv.port}/auth/config`, { headers: { origin: "https://scottlien2002-sys.github.io" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("access-control-allow-origin"), "https://scottlien2002-sys.github.io");
    const big = await fetch(`http://127.0.0.1:${srv.port}/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "big_body", password: "x".repeat(10_000) }) }).catch(() => null);
    assert.ok(!big || big.status === 413 || big.status === 400);
    await sleep(10);
  } finally {
    await srv.stop();
  }
});
