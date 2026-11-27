/**
 * Stage 8.1：多人模式開機流程（只在 ?play=world&mp=1）。
 * 1. 預覽站的模型重複使用：已發布在其他預覽資料夾、內容完全相同的檔案直接從那裡讀（不重複發布大型模型）
 * 2. 連線多人伺服器（失敗時顯示原因；沒有伺服器網址時請使用者輸入）
 * 3. 角色地圖與位置改用伺服器資料
 */
import { FileTools } from "@babylonjs/core";
import type { WorldSession } from "../game/worldSession.ts";
import { parseAppearance } from "../core/gameSave.ts";
import { MpWorld, mpServerUrl, normalizeServer } from "./MpWorld.ts";

async function installAssetRemap(): Promise<number> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}asset-remap.json`, { cache: "no-cache" });
    if (!r.ok) return 0;
    const map = (await r.json()) as { files?: Record<string, string> };
    const files = map.files ?? {};
    const base = new URL(`${import.meta.env.BASE_URL}`, location.href).href;
    const prev = FileTools.PreprocessUrl;
    FileTools.PreprocessUrl = (url: string) => {
      const abs = new URL(url, location.href).href;
      if (abs.startsWith(base)) {
        const rel = decodeURIComponent(abs.slice(base.length).split("?")[0]!);
        const to = files[rel];
        if (to) return to;
      }
      return prev(url);
    };
    return Object.keys(files).length;
  } catch {
    return 0;
  }
}

function askServer(): Promise<string> {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:rgba(10,14,40,.85);font:15px -apple-system,'PingFang TC',sans-serif;color:#fbf6ea";
    box.innerHTML = `<div style="width:min(90vw,380px);padding:18px;border-radius:16px;background:#1f2a5c;border:2px solid #e8c46e">
      <b>多人測試伺服器網址</b><p style="font-size:13px;opacity:.85">例如 starwish-mp.onrender.com（由 Render 建立後提供）</p>
      <input id="mpsrv" style="width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:0;font-size:16px" placeholder="xxxx.onrender.com" autocapitalize="off" autocorrect="off">
      <button id="mpgo" style="margin-top:12px;width:100%;padding:11px;border-radius:12px;border:0;background:#e8c46e;font-weight:700;font-size:16px">連線</button></div>`;
    document.body.appendChild(box);
    box.querySelector<HTMLButtonElement>("#mpgo")!.onclick = () => {
      const u = normalizeServer(box.querySelector<HTMLInputElement>("#mpsrv")!.value);
      if (!u) return;
      try {
        localStorage.setItem("starwish.mp81.server", u);
      } catch {
        /* 私密瀏覽 */
      }
      box.remove();
      resolve(u);
    };
  });
}

export async function bootMultiplayer(world: WorldSession, hudRoot: HTMLElement, params: URLSearchParams, status: (s: string) => void): Promise<void> {
  const remapped = await installAssetRemap();
  (window as unknown as { __mpAssetRemap?: number }).__mpAssetRemap = remapped;
  const url = mpServerUrl(params) ?? (await askServer());
  const c = world.save.character;
  // 新角色外觀（測試用網址參數；只是造型，伺服器用同一個 parseAppearance 驗證）：&hair=hair01&hairColor=%23c0408a&weapon=staff
  if (params.has("hair") || params.has("hairColor") || params.has("weapon")) {
    c.appearance = parseAppearance({ hair: params.get("hair") ?? c.appearance.hair, hairColor: params.get("hairColor") ?? c.appearance.hairColor, weapon: params.get("weapon") ?? c.appearance.weapon });
  }
  const mp = await MpWorld.connect({ url, gender: c.gender, appearance: c.appearance, name: params.get("name") ?? undefined, hudRoot, status });
  world.mp = mp;
  // 伺服器的角色資料為準（性別、外觀、地圖、位置）；單機存檔不會被當成線上資料
  c.gender = mp.client.gender;
  c.appearance = { ...mp.client.appearance };
  const sp = mp.spawn;
  c.map = mp.serverMap;
  c.x = sp.x;
  c.z = sp.z;
  c.yaw = sp.yaw;
}
