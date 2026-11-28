/**
 * Stage 8.5：密碼雜湊（Node 內建 scrypt；不需要額外套件）。
 * 格式：scrypt$N$r$p$鹽(base64url)$雜湊(base64url)。比對用 timingSafeEqual（不洩漏比對時間）。
 * 帳號不存在時也做一次同樣成本的雜湊（dummyVerify），避免用回應時間猜帳號是否存在。
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (pw: string, salt: Buffer, len: number, o: ScryptOptions): Promise<Buffer> =>
  new Promise((res, rej) => scryptCb(pw, salt, len, o, (e, k) => (e ? rej(e) : res(k))));

export const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, len: 32, saltLen: 16 });

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(SCRYPT.saltLen);
  const k = await scrypt(pw.normalize("NFKC"), salt, SCRYPT.len, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${k.toString("base64url")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (!(N >= 1024 && N <= 1 << 20 && r >= 1 && r <= 32 && p >= 1 && p <= 16)) return false;
  const salt = Buffer.from(parts[4]!, "base64url");
  const want = Buffer.from(parts[5]!, "base64url");
  const got = await scrypt(pw.normalize("NFKC"), salt, want.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return got.length === want.length && timingSafeEqual(got, want);
}

let dummy: Promise<string> | null = null;
/** 帳號不存在時呼叫：花同樣的時間，然後回傳 false */
export async function dummyVerify(pw: string): Promise<false> {
  dummy ??= hashPassword("starwish-dummy-password");
  await verifyPassword(pw, await dummy);
  return false;
}

/** 帳號名稱：3～20 字，英文小寫、數字、底線（不分大小寫；存小寫） */
export function normalizeUsername(u: unknown): string | null {
  if (typeof u !== "string") return null;
  const s = u.trim().toLowerCase();
  return /^[a-z0-9_]{3,20}$/.test(s) ? s : null;
}

/** 密碼：8～128 字；不能和帳號相同（其餘規則等正式企劃） */
export function passwordProblem(pw: unknown, username: string): string | null {
  if (typeof pw !== "string") return "bad_password";
  if (pw.length < 8) return "password_too_short";
  if (pw.length > 128) return "password_too_long";
  if (pw.toLowerCase() === username) return "password_same_as_username";
  return null;
}
