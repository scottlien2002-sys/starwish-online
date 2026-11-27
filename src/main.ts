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
  const map = new URLSearchParams(location.search).get("map");
  try {
    // ?play=world：Stage 7 完整遊戲（星芽村出生 → 南門 → 星芽原野 → 星願石返回；共用存檔）；&newgame=1 重新開始、&g=female 新存檔性別
    if (new URLSearchParams(location.search).get("play") === "world") {
      document.body.classList.add("map-mode");
      void import("./game/worldSession.ts")
        .then(async (ws) => {
          const params = new URLSearchParams(location.search);
          const world = new ws.WorldSession(params);
          // Stage 8.1：多人模式（?mp=1）— 先連線，地圖與位置以伺服器為準
          if (params.get("mp") === "1") {
            const mpm = await import("./net/mpBoot.ts");
            await mpm.bootMultiplayer(world, hudRoot, params, (s) => {
              if (status) status.textContent = s;
            });
          }
          if (world.save.character.map === "starsprout") {
            const m = await import("./game/StarsproutGame.ts");
            await m.startStarsproutGame(canvas, hudRoot, world);
          } else {
            const m = await import("./game/VillageGame.ts");
            await m.startVillageGame(canvas, hudRoot, world);
          }
        })
        .then(() => hideBoot())
        .catch((err: unknown) => {
          console.error(err);
          fail(`星願物語載入失敗：${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }
    // ?play=starsprout：Stage 5.6 整合測試（男女初心者在星芽原野打怪、掉落、背包、寵物）；&g=female、&lod=lite、&charshadow=realtime
    if (new URLSearchParams(location.search).get("play") === "starsprout") {
      document.body.classList.add("map-mode");
      void import("./game/StarsproutGame.ts")
        .then((m) => m.startStarsproutGame(canvas, hudRoot))
        .then(() => hideBoot())
        .catch((err: unknown) => {
          console.error(err);
          fail(`星芽原野整合測試載入失敗：${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }
    // ?map=starsprout：Stage 6 星芽原野（第一階段：地形與主要路線，沒有怪物）；&lod=lite、&autoplay=route&loops=3
    if (map === "starsprout") {
      document.body.classList.add("map-mode");
      void import("./maps/starsprout/StarsproutPage.ts")
        .then((m) => m.startStarsproutMap(canvas, hudRoot))
        .then(() => hideBoot())
        .catch((err: unknown) => {
          console.error(err);
          fail(`星芽原野載入失敗：${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }
    // ?map=village：Stage 6 P2-3 星芽村（第一階段 Grey-box：配置、佔位建築、道路、碰撞；沒有 NPC 功能）
    if (map === "village") {
      document.body.classList.add("map-mode");
      void import("./maps/village/VillagePage.ts")
        .then((m) => m.startVillageMap(canvas, hudRoot))
        .then(() => hideBoot())
        .catch((err: unknown) => {
          console.error(err);
          fail(`星芽村載入失敗：${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }
    // 怪物測試頁（只在需要時載入）：?lab=bobo 星露啵啵、?lab=dummy 測試方塊、?lab=field 多怪物 AI
    // ?lab=bobo3：星露啵啵 V3 模型預覽（只看外觀，不接戰鬥）
    // ?lab=bobo31：星露啵啵 V3.1 美術精修預覽（V3 保留不變，可在頁面上切換對照）
    // ?lab=bobo32：V3.2 材質與光影精修（V3、V3.1 保留不變）
    // ?lab=bobo33：V3.3（只改腹部星星；模型檔 bobo_v33_*.glb）
    // ?lab=bobo34：V3.4（羽翼＋星雲精修；模型檔 bobo_v34_*.glb）
    // ?lab=bobo35：V3.5（羽翼、色彩對比、效能；模型檔 bobo_v35_*.glb）
    // ?lab=bobo36：V3.6（美術強化；使用共用怪物資源模組；模型檔 bobo_v36_*.glb）
    // ?lab=bobo38r：V3.8R 第二階段灰模（依設定圖重建造型；模型檔 bobo_v38r_*.glb；只看造型）
    // ?lab=bobo38：V3.8（造型精修；模型檔 bobo_v38_*.glb）
    // ?lab=bobo37：V3.7（玻璃果凍材質；設定圖對照模式 &ref=1；模型檔 bobo_v37_*.glb，幾何同 V3.6）
    if (
      lab === "bobo3" ||
      lab === "bobo31" ||
      lab === "bobo32" ||
      lab === "bobo33" ||
      lab === "bobo34" ||
      lab === "bobo35" ||
      lab === "bobo36" ||
      lab === "bobo37" ||
      lab === "bobo38" ||
      lab === "bobo38r"
    ) {
      document.body.classList.add("lab-mode");
      void import("./lab/BoboV3Lab.ts")
        .then((m) => m.startBoboV3Lab(canvas, hudRoot, lab === "bobo38r" ? "v38r" : lab === "bobo38" ? "v38" : lab === "bobo37" ? "v37" : lab === "bobo36" ? "v36" : lab === "bobo35" ? "v35" : lab === "bobo34" ? "v34" : lab === "bobo33" ? "v33" : lab === "bobo32" ? "v32" : lab === "bobo31" ? "v31" : "v3"))
        .then(() => hideBoot())
        .catch((err: unknown) => {
          console.error(err);
          fail(`V3 預覽載入失敗：${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }
    // ?lab=novice：Stage 5.4 男女初心者角色預覽（GLB、共用骨架、6 段動畫）；&bench=1 效能測試
    if (lab === "novice") {
      document.body.classList.add("lab-mode");
      void import("./lab/NoviceLab.ts")
        .then((m) => m.startNoviceLab(canvas, hudRoot))
        .then(() => hideBoot())
        .catch((err: unknown) => {
          console.error(err);
          fail(`角色預覽載入失敗：${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }
    // ?lab=c10b：Stage 5.4 C1.0-B 男女初心者實機整合測試（靜態模型、HQ／Lite 切換、效能測試、複製報告）
    if (lab === "c10b") {
      document.body.classList.add("lab-mode");
      void import("./lab/NoviceC10bLab.ts")
        .then((m) => m.startNoviceC10bLab(canvas, hudRoot))
        .then(() => hideBoot())
        .catch((err: unknown) => {
          console.error(err);
          fail(`C1.0-B 測試頁載入失敗：${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }
    // ?lab=anim：Stage 5.5 角色動畫（C1.0-B4 候選：骨架＋五個動作）＋星靈寵物系統測試頁
    if (lab === "anim") {
      document.body.classList.add("lab-mode");
      void import("./lab/AnimPetLab.ts")
        .then((m) => m.startAnimPetLab(canvas, hudRoot))
        .then(() => hideBoot())
        .catch((err: unknown) => {
          console.error(err);
          fail(`動畫／寵物測試頁載入失敗：${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }
    // ?lab=rigged：Stage 7.2 骨骼動畫怪物接入測試（M004 風羽狐；未交付時用接口測試替身）&q=hq|lite&count=N
    // ?lab=combat：Combat VFX Lab（Claude C；戰鬥動畫與技能特效技術展示，非正式技能）&q=high|medium|low&g=female&auto=1&multi=4
    if (lab === "combat") {
      document.body.classList.add("lab-mode");
      void import("./combat-vfx/lab/CombatVfxLab.ts")
        .then((m) => m.startCombatVfxLab(canvas, hudRoot))
        .then(() => hideBoot())
        .catch((err: unknown) => {
          console.error(err);
          fail(`Combat VFX Lab 載入失敗：${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }
    if (lab === "rigged") {
      document.body.classList.add("lab-mode");
      void import("./lab/RiggedMonsterLab.ts")
        .then((m) => m.startRiggedMonsterLab(canvas, hudRoot))
        .then(() => hideBoot())
        .catch((err: unknown) => {
          console.error(err);
          fail(`骨骼動畫怪物測試頁載入失敗：${err instanceof Error ? err.message : String(err)}`);
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

// Stage 7.4：預覽站共用其他預覽資料夾的大型模型（asset-remap.json；本機與一般建置為空清單）→ 所有頁面開機前先設定
void import("./core/assetRemap.ts")
  .then((m) => m.installAssetRemap())
  .catch(() => 0)
  .then(() => main());
