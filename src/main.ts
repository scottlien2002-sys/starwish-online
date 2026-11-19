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
    // 怪物測試頁（只在需要時載入）：?lab=bobo 星露啵啵、?lab=dummy 測試方塊、?lab=field 多怪物 AI
    // ?lab=bobo3：星露啵啵 V3 模型預覽（只看外觀，不接戰鬥）
    // ?lab=bobo31：星露啵啵 V3.1 美術精修預覽（V3 保留不變，可在頁面上切換對照）
    // ?lab=bobo32：V3.2 材質與光影精修（V3、V3.1 保留不變）
    // ?lab=bobo33：V3.3（只改腹部星星；模型檔 bobo_v33_*.glb）
    // ?lab=bobo34：V3.4（羽翼＋星雲精修；模型檔 bobo_v34_*.glb）
    // ?lab=bobo35：V3.5（羽翼、色彩對比、效能；模型檔 bobo_v35_*.glb）
    // ?lab=bobo36：V3.6（美術強化；使用共用怪物資源模組；模型檔 bobo_v36_*.glb）
    if (lab === "bobo3" || lab === "bobo31" || lab === "bobo32" || lab === "bobo33" || lab === "bobo34" || lab === "bobo35" || lab === "bobo36") {
      document.body.classList.add("lab-mode");
      void import("./lab/BoboV3Lab.ts")
        .then((m) => m.startBoboV3Lab(canvas, hudRoot, lab === "bobo36" ? "v36" : lab === "bobo35" ? "v35" : lab === "bobo34" ? "v34" : lab === "bobo33" ? "v33" : lab === "bobo32" ? "v32" : lab === "bobo31" ? "v31" : "v3"))
        .then(() => hideBoot())
        .catch((err: unknown) => {
          console.error(err);
          fail(`V3 預覽載入失敗：${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }
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
    const game = new Game(canvas, hudRoot);
    game.start();
    hideBoot();
  } catch (err) {
    console.error(err);
    fail(`啟動失敗：${err instanceof Error ? err.message : String(err)}`);
  }
}

main();
