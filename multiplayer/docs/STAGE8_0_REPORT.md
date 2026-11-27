# 星願物語 Stage 8.0｜多人連線基礎架構報告（Claude D）

日期：2026-11-27　負責：Claude D（多人連線／伺服器／後端／資料庫）
分支：`feature/multiplayer-stage8-0`（從 `stage7.1-accepted`＝`edbd6740` 建立）
基準備份：`backup/multiplayer-stage8-0-base`（`edbd6740`，開發前建立）

## 1. 結論

本機多人連線原型已完成並實測：兩位玩家同房間互相看見，位置／朝向／Idle／Run 同步，本地預測＋伺服器校正、遠端平滑插值、斷線自動重連與完整重新同步、移動速度與合法區域由伺服器判定，皆有自動化測試實際通過（數字見第 4 節）。
**尚未在 iPhone Safari 實機測試**；正式 3D 角色畫面的多人整合屬 Stage 8.1。

隔離確認：`src/`、`tests/`、`public/` 與 Stage 7.1 驗收版本完全相同（`git diff stage7.1-accepted -- src tests public` 為空）；單機版、GitHub Pages、main、其他 Claude 分支都沒有被修改；沒有 force push；沒有使用付費服務。

## 2. 程式碼盤點（唯讀）與拆分方式

| 盤點結果 | 對多人的意義 |
|---|---|
| 地圖碰撞 `layout.ts`（村莊）、`terrain.ts`＋`props.ts`＋`vegetation.ts`（原野）是**純邏輯、不依賴 Babylon**，原作者已註明「伺服器可共用」 | 伺服器直接引用同一份碰撞，不複製、不改數值 |
| 原野植被碰撞 HQ 與 Lite **完全相同**（實測比對） | 不同畫質的玩家，伺服器判定一致 |
| `worldPortals.ts`、`portalTrigger.ts` 純邏輯 | 傳送陣改由伺服器判定 |
| 移動速度 `TUNING.player.moveSpeed = 5`、轉身 `turnSharpness` | 直接引用，未變更正式數值 |
| `StarsproutGame`／`VillageGame` 把輸入、移動、戰鬥、存檔混在 Babylon 場景類別中 | 8.0 不改它們；8.1 需由 Claude A 抽出「移動輸入 → NetClient」接點（需另行申請修改核心） |
| 存檔 `gameSave.ts`＝localStorage | 不作為線上可信資料；線上角色一律由伺服器建立 |

拆分：`multiplayer/shared`（協定、共用移動模擬、地圖權威）由伺服器與客戶端共用；`server` 為權威；`client` 只送輸入、不送位置。

## 3. 技術決策（需要您知道的一項偏離）

- **Colyseus 本階段未採用**：本開發環境無法從 npm 下載套件（只有本機已有的 `ws`），無法實際安裝與測試 Colyseus。依「未測試不得標記通過」原則，改用 Colyseus 底層同樣使用的 `ws` 自行實作權威房間。房間邏輯（`Room.ts`）不依賴 WebSocket，之後若決定換 Colyseus，只需加一層外殼。**是否在 8.1 改用 Colyseus，請您決定**（建議：先維持現狀，等需要大量房間管理功能再評估）。
- Node.js 22＋TypeScript（直接執行，不需編譯）、WebSocket／WSS、20 Hz 伺服器、60 Hz 固定步長預測、不使用 Redis、PostgreSQL 16 結構已實測但伺服器目前接 MemoryStore。

## 4. 測試結果（全部為實際執行結果）

| 項目 | 環境 | 結果 |
|---|---|---|
| 型別檢查 | 本機＋GitHub Actions | 通過 |
| 單元測試 13 項 | 本機＋GitHub Actions | 13/13 通過 |
| 整合測試 10 項（真伺服器＋機器人） | 本機＋GitHub Actions | 10/10 通過 |
| WSS 加密連線（自簽憑證） | 本機＋GitHub Actions | 通過 |
| 瀏覽器雙人 16 項（Chromium） | 本機＋GitHub Actions | 16/16 通過 |
| 瀏覽器雙人 16 項（WebKit＝Safari 引擎） | GitHub Actions | 16/16 通過 |
| PostgreSQL 結構＋原子交易 20 項 | 本機 PostgreSQL 16＋GitHub Actions | 20/20 通過 |
| **iPhone Safari 實機** | — | **未測試** |

### 兩位玩家同場
- 同房間 `village-1`，互相看見名稱與性別；A 跑步時 B 看到 Run，停下看到 Idle。
- A 朝南跑時 B 看到的朝向誤差 0.001 rad；停下後 B 畫面中 A 的位置與伺服器誤差 0 cm；A 本地與伺服器誤差 0.02 cm。
- 瀏覽器：A 用鍵盤往東，B 看到 yaw 1.571（＝東）；B（iPhone 尺寸視窗）往南，A 看到 yaw −3.141（＝南）。

### 預測與校正（模擬手機網路：單程 120 ms＋抖動 40 ms，RTT 實測 285 ms）
- 按下方向後本地 20 ms 就開始移動（不必等伺服器）。
- 3 秒轉向移動：校正 0 次、最大誤差 0 cm、強制瞬移 0 次，停下後與伺服器誤差 0 cm（客戶端與伺服器使用同一個移動函式，結果一致）。

### 斷線重連
- 切斷連線 → 102 ms 後另一位玩家看到「斷線中」→ 548 ms 自動重連並完成完整同步，同一個玩家編號、位置誤差 0 cm，重連後移動正常。
- 保留 30 秒（測試用 0.8 秒）到期：其他玩家看到離開；之後用憑證登入，從存檔位置 (6.20, 8.32) 出生（存檔版本 3）。
- 同一角色在第二個裝置登入：舊連線被踢（顯示「此角色已在其他裝置登入」）且不會自動重連。
- 瀏覽器重新整理：用 sessionStorage 憑證接回同一角色。

### 安全
- 加速外掛：每 50 ms 塞 30 步（正常 3 步）持續 3.03 秒 → 實際只移動 15.78 m（正常最多 15.16 m＋0.5 秒網路追趕緩衝），超量 1,503 步被丟棄。
- 往噴泉、建築、地圖邊界硬走 10 秒（6 個方向 × 2 張地圖）：位置始終合法。
- 60 則亂碼／偽造位置訊息 → 連線被踢；協定版本不符 → 拒絕；非本站網頁來源 → 拒絕。
- 同一 requestId 送兩次只執行一次（第二次回傳第一次的結果並標示重送）。

### 傳送陣（伺服器判定）
- 從星芽村出生點繞噴泉走南路到南門 13.8 秒 → 伺服器切換到 `starsprout-1`，抵達原野營地 (−53.52, −64.08)；留在村莊的玩家不再看到他；換地圖前的舊輸入作廢 0 筆誤用。

### 負載與封包量（本機，40 位機器人同房間移動 8 秒）
- 伺服器 tick 平均 1.15 ms、最大 2.43 ms（預算 50 ms）。
- 每位玩家下載約 19.7 KB/s、上傳約 0.8 KB/s；兩人同場時下載約 1.8 KB/s、上傳約 35 B/s。
- 房間滿（測試設 2 人）自動開 `village-2`，不同頻道互不可見。

### 診斷資訊
- 客戶端 HUD：連線狀態、地圖／房間、FPS、RTT／平均／抖動、上下行 B/s 與包數、快照頻率、同場人數、待確認輸入、校正次數與誤差、重連次數與恢復時間、伺服器 tick。
- 伺服器 `/metrics`：連線數、玩家數、各房間人數、tick 平均／最大、每秒流量、安全計數（亂碼、限速、踢除、重送、加速丟棄、非法位置）。

### 資料庫（PostgreSQL 16，本機暫時實例）
UUID 唯一、正確 version＋epoch 可存、舊 version 被拒、被搶鎖的舊連線被拒、金幣冪等（重送不重複加）、餘額不足整筆不生效、資料庫層拒絕負金幣、不合法 requestId 被拒、道具冪等轉移、非擁有者／舊版本轉移被拒、**20 筆並行轉移同一道具只有 1 筆成功**。

## 5. 未完成／未驗證（不標示通過）
1. iPhone Safari 實機雙人測試（需要您用 `npm run start:lan` 在同一 Wi-Fi 測試，或 8.1 部署測試伺服器）。
2. 正式 3D 遊戲畫面整合（8.0 只有 2D 俯視測試頁；已提供 `AvatarSync` 介面）。
3. 伺服器實際連接 PostgreSQL（目前 MemoryStore；結構與交易函式已實測）。
4. Colyseus（見第 3 節）。
5. 正式 WSS 主機（iPhone 從 https 的 GitHub Pages 連線必須用 WSS；需要申請主機，見 8.1）。
6. 帳號登入（目前為訪客角色＋憑證）。

## 6. 技術架構圖
見 `multiplayer/docs/architecture.png`（原始檔 `architecture.mmd`）。

## 7. Stage 8.1～8.5 整合建議

| 階段 | 內容 | 需要您批准的事項 |
|---|---|---|
| **8.1 遊戲本體接線＋測試伺服器** | Claude A 在遊戲加 `?mp=1` 模式：輸入改送 NetClient、遠端玩家用 `AvatarSync` 生成男女初心者模型（Idle/Run）、HUD 加網路診斷；單機模式預設不變。伺服器接 PostgreSQL（`pg` 套件）。 | ① 修改 Claude A 的遊戲核心（StarsproutGame／VillageGame 加接點）② 免費測試主機與 WSS 方式（例如自己電腦＋免費通道服務，或免費方案主機）③ 是否改用 Colyseus |
| **8.2 戰鬥＋怪物 AI 伺服器化** | 怪物生成／AI／血量在伺服器跑（引用 monsterAI、fieldRules 純邏輯），攻擊改為 `cmd`（requestId），伺服器判定命中與傷害；死亡／復活點由伺服器決定 | 怪物同步頻率與同場怪物數上限 |
| **8.3 背包與掉落** | 掉落由伺服器產生、每件 UUID、撿取冪等；背包讀寫走資料庫交易 | 單機存檔與線上角色的關係（建議：線上角色重新開始） |
| **8.4 寵物** | 寵物鑑定在伺服器產生並永久固定（方案 A）、跟隨同步 | 寵物正式數值（目前未定案，不得自行設定） |
| **8.5 分流與交易所** | 頻道選擇 UI、星願商會交易所（上架鎖定、原子成交、手續費設定檔） | 手續費、上架期限、上限等數值 |

## 8. 啟動方式
見 `multiplayer/README.md`。簡述：`cd multiplayer && npm install && npm run build:proto && npm start`，瀏覽器開 `http://127.0.0.1:2567/mp/?slot=a` 與 `?slot=b`。

## 9. 分支與 CI
- Commits：`ad456d7`（原型）、`ac815f7`、`edd468b`（資料庫測試在 CI 的檔案權限修正）、本報告。
- GitHub Actions `Multiplayer Stage 8` run 45916742404（edd468b）：型別、單元、整合、WSS、PostgreSQL、Chromium 雙人、WebKit 雙人全部通過。
- 新增 `.github/workflows/multiplayer-stage8.yml`：只在 `feature/multiplayer-**` 且 `multiplayer/**` 變動時執行，不部署、concurrency 依分支分開。
- 推送後原有 `CI & Deploy` 也會在本分支執行（只跑單機版測試、不部署，因 `src/` 未變動，等同驗證單機版未受影響）。
