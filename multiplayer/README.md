# 星願物語 Stage 8.0～8.1｜多人連線（Claude D）

與單機版完全分開：本資料夾不修改 `src/`，只「唯讀引用」Stage 7.1 已驗收的地圖碰撞、傳送陣與移動數值。
單機版（GitHub Pages、`npm run dev`）完全不受影響。

## 啟動（本機）

需要 Node.js 22.18 以上（直接執行 TypeScript，不需編譯）。

```bash
cd multiplayer
npm install            # 只裝 ws、typescript、esbuild、playwright（全部免費）
npm run build:proto    # 打包雙人測試頁
npm start              # http://127.0.0.1:2567/mp/  （WebSocket：ws://127.0.0.1:2567/ws）
```

- 雙人測試：同一台電腦開兩個瀏覽器視窗（或一般＋無痕），網址加 `?slot=a`、`?slot=b` 區分角色。
  可加 `&name=小明&g=female`、`&lag=120&jitter=40`（模擬手機網路延遲）。
- iPhone 同 Wi-Fi 測試：`npm run start:lan`，iPhone Safari 開 `http://電腦IP:2567/mp/`（區網用 ws，非加密）。
- 加密連線（WSS）：設定 `MP_TLS_CERT`、`MP_TLS_KEY` 憑證路徑後啟動，即改為 `https://…/mp/`、`wss://…/ws`。
- 診斷：`/metrics`（房間、人數、tick 時間、每秒封包量、安全計數）、`/health`。
- 操作：WASD／方向鍵，或在畫面上按住拖曳當搖桿；「斷線測試」按鈕會切斷連線並自動重連。

## 測試

```bash
npm run typecheck
npm run test:unit          # 13 項
npm run test:integration   # 10 項（真的開伺服器＋機器人）
npm run test:wss           # 自簽憑證 WSS
npm run test:browser       # Chromium 兩個分頁＝兩位玩家（MP_BROWSER=webkit 改 Safari 引擎）
sudo bash db/test-db.sh    # 本機 PostgreSQL 16 暫時實例：結構＋原子交易＋並行測試
```

CI：`.github/workflows/multiplayer-stage8.yml` 只在 `feature/multiplayer-**` 分支、`multiplayer/**` 變動時執行，不部署。

## 結構

| 路徑 | 內容 |
|---|---|
| `shared/` | 協定、常數、地圖權威（引用 src 地圖純邏輯）、共用移動模擬 |
| `server/` | GameServer（HTTP/WS、工作階段、分流、tick、存檔）、Room（權威房間）、security、RequestLedger、persistence、extensions（Stage 8.1+ 介面） |
| `client/` | NetClient（預測＋校正、插值、重連、診斷）、Interpolator、AvatarSync（接 3D 角色用） |
| `proto/` | 2D 俯視雙人測試頁（非正式畫面） |
| `db/` | PostgreSQL 結構與測試 |
| `reports/` | 測試輸出與截圖 |
| `docs/` | 架構圖、Stage 8.0 報告 |

## Stage 8.1：正式 3D 遊戲多人模式

- 入口：`?play=world&mp=1&server=<伺服器>`（不加 `mp=1` 就是原本的單機模式，行為不變）
- 本機測試：
  ```bash
  npm run build                       # 專案根目錄：建置遊戲
  node multiplayer/server/main.ts     # 多人伺服器（沒有 DATABASE_URL → 記憶體）
  npx vite preview --host             # 或任何靜態伺服器
  # 兩個瀏覽器視窗：http://localhost:4173/?play=world&mp=1&name=A 與 &name=B&g=female&hairColor=%23c0408a&weapon=staff
  ```
- PostgreSQL：`DATABASE_URL=postgres://... MP_REALM=test node multiplayer/server/main.ts`
- 部署：`render.yaml`＋`docs/RENDER_DEPLOY.md`
- 3D 雙人 E2E：`node tests/e2e/run-mp-e2e.mjs dist chromium|webkit`
- 報告：`docs/STAGE8_1_REPORT.md`、架構圖 `docs/architecture-8_1.png`
