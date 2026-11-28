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
import { forgetLogin, mpLogin, rememberCharacter } from "./mpLogin.ts";

/**
 * Stage 8.4：M002 苔角獸、M003 雲絨鳥 Rig V1.1 候選版（Claude C，待統一視覺驗收）。
 * 檔案另存為 *_V1_1_*.glb（V1.0 原檔保留）；多人預覽預設讀 V1.1，網址加 &m23=v10 回到 V1.0（回退）。
 * 只換「讀哪個檔」，Claude A 的規格（關節數、動作名稱與時長）兩版相同，伺服器不受影響。
 * （預覽站共用其他資料夾模型的 asset-remap.json 由 Claude A 的 core/assetRemap.ts 在所有頁面開機前處理，這裡不再重複載入）
 */
export const M23_CANDIDATE: Readonly<Record<string, string>> = Object.freeze({
  "models/monsters/m002/M002_MossHornBeast_Rig_V1_HQ.glb": "models/monsters/m002/M002_MossHornBeast_Rig_V1_1_HQ.glb",
  "models/monsters/m002/M002_MossHornBeast_Rig_V1_Lite.glb": "models/monsters/m002/M002_MossHornBeast_Rig_V1_1_Lite.glb",
  "models/monsters/m003/M003_CloudFluffBird_Rig_V1_HQ.glb": "models/monsters/m003/M003_CloudFluffBird_Rig_V1_1_HQ.glb",
  "models/monsters/m003/M003_CloudFluffBird_Rig_V1_Lite.glb": "models/monsters/m003/M003_CloudFluffBird_Rig_V1_1_Lite.glb",
});

function installMonsterCandidates(params: URLSearchParams): "v1.1" | "v1.0" {
  if (params.get("m23") === "v10") return "v1.0";
  const base = new URL(`${import.meta.env.BASE_URL}`, location.href).href;
  const prev = FileTools.PreprocessUrl;
  // 先換成 V1.1 的路徑，再交給前一層（A 的 asset-remap：V1.1 也可能被共用到別的資料夾）
  FileTools.PreprocessUrl = (url: string) => {
    const abs = new URL(url, location.href).href;
    if (abs.startsWith(base)) {
      const rel = decodeURIComponent(abs.slice(base.length).split("?")[0]!);
      const to = M23_CANDIDATE[rel];
      if (to) return prev(new URL(to, base).href);
    }
    return prev(url);
  };
  return "v1.1";
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
  const m23 = installMonsterCandidates(params);
  (window as unknown as { __mpM23?: string; __mpAssetRemap?: number }).__mpM23 = m23;
  (window as unknown as { __mpAssetRemap?: number }).__mpAssetRemap = (window as unknown as { __starwishAssetRemap?: number }).__starwishAssetRemap ?? 0;
  const url = mpServerUrl(params) ?? (await askServer());
  const c = world.save.character;
  // 新角色外觀（測試用網址參數；只是造型，伺服器用同一個 parseAppearance 驗證）：&hair=hair01&hairColor=%23c0408a&weapon=staff
  if (params.has("hair") || params.has("hairColor") || params.has("weapon")) {
    c.appearance = parseAppearance({ hair: params.get("hair") ?? c.appearance.hair, hairColor: params.get("hairColor") ?? c.appearance.hairColor, weapon: params.get("weapon") ?? c.appearance.weapon });
  }
  // Stage 8.5：帳號登入（伺服器不開放訪客或網址 &login=1 時顯示測試登入視窗；否則維持訪客）
  const login = await mpLogin(url, params, status);
  let mp: MpWorld;
  try {
    mp = await MpWorld.connect({ url, gender: c.gender, appearance: c.appearance, name: params.get("name") ?? login?.username ?? undefined, hudRoot, status, auth: login?.auth, cid: login?.cid });
  } catch (e) {
    if (login && /auth|登入/.test(String(e))) forgetLogin();
    throw e;
  }
  if (login) rememberCharacter(mp.client.characterId);
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
