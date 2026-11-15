import "./style.css";
import { Game } from "./game/Game.ts";

const status = document.getElementById("boot-status");
const boot = document.getElementById("boot-screen");

declare global {
  interface Window {
    __starwishBooted?: () => void;
  }
}

function fail(message: string): void {
  window.__starwishBooted?.();
  if (status) {
    status.textContent = message;
    status.classList.add("error");
  }
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function hideBoot(): void {
  window.__starwishBooted?.();
  boot?.classList.add("hidden");
  window.setTimeout(() => boot?.remove(), 600);
}

function main(): void {
  const canvas = document.getElementById("game-canvas");
  const hudRoot = document.getElementById("hud-root");
  if (!(canvas instanceof HTMLCanvasElement) || !hudRoot) {
    fail("頁面結構錯誤，請重新整理。");
    return;
  }
  if (!hasWebGL()) {
    fail("此瀏覽器不支援 WebGL，無法執行 3D 遊戲。請使用最新版 Safari。");
    return;
  }
  const lab = new URLSearchParams(location.search).get("lab");
  try {
    // 怪物測試頁（只在需要時載入）：?lab=bobo 星露啵啵、?lab=dummy 測試方塊、?lab=field 多怪物 AI
    const LAB_MONSTER: Record<string, string> = { bobo: "star_dew_bobo", dummy: "test_dummy" };
    if (lab && (lab in LAB_MONSTER || lab === "field")) {
      const start =
        lab === "field"
          ? import("./lab/MonsterField.ts").then((m) => m.startMonsterField(canvas, hudRoot))
          : import("./lab/MonsterLab.ts").then((m) => m.startMonsterLab(canvas, hudRoot, LAB_MONSTER[lab]));
      document.body.classList.add("lab-mode");
      void start
        .then(() => hideBoot())
        .catch((err: unknown) => {
          console.error(err);
          fail(`測試場景載入失敗：${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }
    // 先顯示「建立 3D 場景中」並讓畫面更新一次，再建立場景（若卡住，可分辨是下載還是建立階段）
    if (status) {
      status.textContent = "建立 3D 場景中…";
      status.dataset.step = "建立 3D 場景";
    }
    window.setTimeout(() => {
      try {
        const game = new Game(canvas, hudRoot);
        game.start();
        hideBoot();
      } catch (err) {
        console.error(err);
        fail(`啟動失敗：${err instanceof Error ? err.message : String(err)}`);
      }
    }, 30);
  } catch (err) {
    console.error(err);
    fail(`啟動失敗：${err instanceof Error ? err.message : String(err)}`);
  }
}

main();
