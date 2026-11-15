import "./style.css";
import { Game } from "./game/Game.ts";

const status = document.getElementById("boot-status");
const boot = document.getElementById("boot-screen");

function fail(message: string): void {
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
    if (lab === "bobo") {
      // 怪物動作測試場景（只在需要時載入）
      void import("./lab/MonsterLab.ts")
        .then((m) => {
          document.body.classList.add("lab-mode");
          m.startMonsterLab(canvas, hudRoot);
          hideBoot();
        })
        .catch((err: unknown) => {
          console.error(err);
          fail(`測試場景載入失敗：${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }
    const game = new Game(canvas, hudRoot);
    game.start();
    hideBoot();
  } catch (err) {
    console.error(err);
    fail(`啟動失敗：${err instanceof Error ? err.message : String(err)}`);
  }
}

main();
