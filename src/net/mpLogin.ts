/**
 * Stage 8.5 多人帳號登入（最簡易測試介面；尚未製作正式美術畫面，也沒有正式角色選擇／建立畫面）。
 * - 伺服器 /auth/config 回報不開放訪客、或網址加 &login=1 → 顯示登入／註冊視窗。
 * - 登入憑證存在本機 localStorage（只在這個瀏覽器；伺服器只存雜湊）；選用的角色 id 存在 sessionStorage。
 * - &logout=1：登出（伺服器撤銷憑證）並清除本機憑證。
 * - 預留角色選擇：characters 清單已由伺服器回傳；之後的正式選角畫面只要決定 cid 即可。
 */
export interface LoginResult {
  auth: string;
  cid?: string;
  username: string;
}
interface CharSummary {
  id: string;
  name: string;
  level: number;
}

const AUTH_KEY = "starwish.mp85.auth";
const USER_KEY = "starwish.mp85.user";
const CID_KEY = "starwish.mp85.cid";

/** ws(s)://host/ws → http(s)://host */
export function httpBase(wsUrl: string): string {
  return wsUrl.replace(/^ws/, "http").replace(/\/ws\/?$/, "");
}
const store = (s: "local" | "session"): Storage | null => {
  try {
    return s === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
};
async function call(base: string, path: string, body?: unknown, token?: string): Promise<{ status: number; data: Record<string, unknown> }> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), 90_000);
  try {
    const r = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: r.status, data };
  } finally {
    window.clearTimeout(timer);
  }
}
const ERR_TEXT: Record<string, string> = {
  invalid_credentials: "帳號或密碼錯誤",
  taken: "這個帳號名稱已被使用",
  bad_username: "帳號名稱：3～20 字，英文小寫、數字、底線",
  bad_password: "請輸入密碼",
  password_too_short: "密碼至少 8 個字",
  password_too_long: "密碼太長（最多 128 字）",
  password_same_as_username: "密碼不能和帳號相同",
  rate: "嘗試太多次，請稍等一分鐘",
  locked: "登入失敗太多次，帳號暫時鎖定",
  origin: "這個網站不被伺服器允許",
};

function pickCharacter(chars: CharSummary[]): string | undefined {
  const want = store("session")?.getItem(CID_KEY);
  if (want && chars.some((c) => c.id === want)) return want;
  return chars[0]?.id; // 沒有角色 → 伺服器在第一次連線時建立
}

/** 需要登入時回傳憑證；訪客模式回傳 null */
export async function mpLogin(wsUrl: string, params: URLSearchParams, status: (s: string) => void): Promise<LoginResult | null> {
  const base = httpBase(wsUrl);
  const ls = store("local");
  if (params.get("logout") === "1") {
    const t = ls?.getItem(AUTH_KEY);
    if (t) await call(base, "/auth/logout", {}, t).catch(() => null);
    ls?.removeItem(AUTH_KEY);
    ls?.removeItem(USER_KEY);
    store("session")?.removeItem(CID_KEY);
  }
  status("確認多人伺服器登入設定…");
  const cfg = await call(base, "/auth/config").catch(() => null);
  const guestAllowed = cfg ? cfg.data.guest !== false : true;
  const want = params.get("login") === "1" || !guestAllowed || !!ls?.getItem(AUTH_KEY);
  if (!want || !cfg || cfg.status === 404) return null; // 舊版伺服器沒有帳號功能 → 訪客
  // 已登入過：確認憑證仍有效
  const saved = ls?.getItem(AUTH_KEY);
  if (saved) {
    const me = await call(base, "/auth/me", undefined, saved).catch(() => null);
    if (me && me.status === 200) {
      const chars = (me.data.characters as CharSummary[]) ?? [];
      return { auth: saved, cid: pickCharacter(chars), username: ls?.getItem(USER_KEY) ?? "" };
    }
    ls?.removeItem(AUTH_KEY);
  }
  return showDialog(base, guestAllowed);
}

/** 記住這次使用的角色（重新整理頁面時沿用） */
export function rememberCharacter(cid: string | null): void {
  if (cid) store("session")?.setItem(CID_KEY, cid);
}
/** 伺服器拒絕憑證（過期、被撤銷）時清掉本機憑證 */
export function forgetLogin(): void {
  store("local")?.removeItem(AUTH_KEY);
}

function showDialog(base: string, guestAllowed: boolean): Promise<LoginResult | null> {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.id = "mp-login";
    box.style.cssText = "position:fixed;inset:0;z-index:310;display:flex;align-items:center;justify-content:center;background:rgba(10,14,40,.88);font:15px -apple-system,'PingFang TC',sans-serif;color:#fbf6ea";
    const input = "width:100%;box-sizing:border-box;padding:10px;margin-top:8px;border-radius:10px;border:0;font-size:16px";
    const btn = "flex:1;padding:11px;border-radius:12px;border:0;font-weight:700;font-size:16px";
    box.innerHTML = `<div style="width:min(90vw,380px);padding:18px;border-radius:16px;background:#1f2a5c;border:2px solid #e8c46e">
      <b>多人測試帳號</b><span style="font-size:12px;opacity:.7">（測試畫面，非正式介面；測試帳號資料不會成為正式玩家資料）</span>
      <input id="mpuser" style="${input}" placeholder="帳號（英文小寫、數字、底線）" autocapitalize="off" autocorrect="off" autocomplete="username">
      <input id="mppass" type="password" style="${input}" placeholder="密碼（至少 8 個字）" autocomplete="current-password">
      <div id="mperr" style="min-height:20px;margin-top:8px;font-size:13px;color:#ffb4a8"></div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button id="mplogin" style="${btn};background:#e8c46e">登入</button>
        <button id="mpreg" style="${btn};background:#9fd5c4">註冊</button>
      </div>
      ${guestAllowed ? `<button id="mpguest" style="${btn};width:100%;margin-top:8px;background:#3a4a8a;color:#fbf6ea">先用訪客進入</button>` : ""}
    </div>`;
    document.body.appendChild(box);
    const $ = <T extends HTMLElement>(id: string) => box.querySelector<T>(`#${id}`)!;
    const err = $("mperr");
    const go = async (kind: "login" | "register"): Promise<void> => {
      const username = $<HTMLInputElement>("mpuser").value.trim().toLowerCase();
      const password = $<HTMLInputElement>("mppass").value;
      err.textContent = kind === "login" ? "登入中…" : "註冊中…";
      const r = await call(base, `/auth/${kind}`, { username, password }).catch(() => null);
      if (!r) {
        err.textContent = "無法連線伺服器（免費測試主機休眠中時喚醒約需 1 分鐘，請稍後再試）";
        return;
      }
      if (r.status !== 200) {
        const code = String(r.data.err ?? r.status);
        err.textContent = ERR_TEXT[code] ?? `失敗（${code}）`;
        return;
      }
      const token = String(r.data.token);
      try {
        window.localStorage.setItem(AUTH_KEY, token);
        window.localStorage.setItem(USER_KEY, username);
      } catch {
        /* 私密瀏覽：只用這一次 */
      }
      box.remove();
      resolve({ auth: token, cid: pickCharacter((r.data.characters as CharSummary[]) ?? []), username });
    };
    $("mplogin").onclick = () => void go("login");
    $("mpreg").onclick = () => void go("register");
    if (guestAllowed) {
      $("mpguest").onclick = () => {
        box.remove();
        resolve(null);
      };
    }
  });
}
