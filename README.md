# 星願物語 Starwish Online — Web Edition

原創 3D Q版奇幻 RPG，以 iPhone Safari 直接遊玩為優先。目前為 **W1 單機原型**。

- 技術：TypeScript · Babylon.js · Vite · （W4）IndexedDB
- 部署：GitHub Actions 建置 → `gh-pages` 分支 → GitHub Pages（免費）
- 核心設定：[docs/CORE_RULES.md](docs/CORE_RULES.md)

## 目錄

```
src/
  core/        核心規則（鎖定）、正式名稱、事件、亂數、數學
  config/      設定檔：tuning（手感）、affixes.json（鑑定）、enhance.json（強化）、驗證器
  world/       地形（純函式）、裝飾物擺放、Meadow（Babylon 場景）
  actors/      移動計算（純函式）、PlayerAvatar（暫代角色）
  camera/      第三人稱攝影機
  input/       虛擬搖桿、觸控攝影機、鍵盤、輸入狀態
  ui/          HUD、版面檢查
  game/        Game（主迴圈、平台處理、測試用 debug API）
tests/
  unit/        Node 內建測試（純邏輯）
  harness/     HUD 版面測試（不需 Babylon，可在任何瀏覽器跑）
  e2e/         完整遊戲端對端測試（需先 build）
docs/          核心設定與文件
```

## 指令

```bash
npm install
npm run dev        # 本機開發（--host 可用手機連同一 Wi-Fi 測試）
npm run typecheck
npm test           # 單元測試
npm run build
node tests/harness/run-hud-layout.mjs chromium   # HUD 版面
node tests/e2e/run-e2e.mjs dist chromium,webkit  # 端對端
```

## 操作
- 手機：左下拖曳＝移動；畫面空白處單指拖曳＝旋轉視角；雙指＝縮放
- 電腦：WASD / 方向鍵移動，滑鼠拖曳旋轉，滾輪縮放

## 開發階段
| 階段 | 內容 | 狀態 |
|---|---|---|
| W1 | 網頁專案、3D 場景、角色移動、手機操作 | 進行中 |
| W2 | 怪物 AI、普通攻擊、3 技能、經驗值 | 未開始 |
| W3 | 背包、掉落、鑑定、強化 | 未開始 |
| W4 | 存檔、手機效能優化、部署整合 | 未開始 |
