# 星願物語 Stage 8.4｜Render 免費伺服器部署（給使用者的逐步操作，約 10 分鐘）

我（Claude D）沒辦法登入您的 Render 帳號，這一步請您操作。**全部使用免費方案。**
**任何畫面出現「付款、升級方案、輸入信用卡」才能繼續時，請停在那一步、不要付款，把畫面截圖給我**（替代方案見 §G）。

Render 還沒部署時，本機開發與 GitHub 自動測試都照常進行（測試機自己啟動伺服器），不會被卡住。

---

## A. 最簡單的做法：Blueprint（一次建好伺服器＋資料庫＋環境變數）

1. 打開 **https://dashboard.render.com** → 用 **GitHub** 登入（scottlien2002-sys 帳號）。第一次會要求授權 Render 讀取 repo：選 **Only select repositories → starwish-online**。
2. 右上角 **New ＋ → Blueprint**。
3. **Connect a repository**：選 **scottlien2002-sys/starwish-online**。
4. **Branch（分支）**：選 **`integration/multiplayer-stage8-4`**（不要選 main）。
5. **Blueprint Name**：輸入 `starwish-mp-test`。
6. Render 讀到 repo 裡的 `render.yaml`，列出兩個項目，**確認兩個都寫 Free**：
   - `starwish-mp-test`（Web Service，Node，**Free**）＝多人伺服器
   - `starwish-mp-test-db`（PostgreSQL，**Free**）＝測試資料庫
7. 按 **Apply**（或 Deploy Blueprint）。等 3～5 分鐘，兩個都變成綠色 **Available／Live**。

`render.yaml` 已經自動設定好（您不用手動輸入）：
| 設定 | 值 | 作用 |
|---|---|---|
| 分支 | `integration/multiplayer-stage8-4` | 只部署多人整合分支，不碰 main |
| 建置指令 | `cd multiplayer && npm install --omit=dev` | 只安裝伺服器需要的 2 個套件 |
| 啟動指令 | `node multiplayer/server/main.ts` | Node 22 |
| 健康檢查 | `/health` | Render 用它判斷伺服器正常 |
| `NODE_VERSION` | `22` | |
| `MP_REALM` | `test` | 測試資料區：測試帳號不會混進未來正式資料 |
| `MP_ALLOWED_ORIGINS` | `https://scottlien2002-sys.github.io` | 只接受 GitHub Pages 預覽頁連線 |
| `DATABASE_URL` | 自動填入資料庫的內部連線字串 | 密碼只在 Render 裡，不在 GitHub |
| 資料庫 IP 白名單 | 空（`ipAllowList: []`） | **只允許 Render 內部連線**，外部網路連不到資料庫 |

## B. 已經用 Stage 8.1／8.2 建過（只換分支）

1. Dashboard → **starwish-mp-test** → **Settings → Build & Deploy → Branch** → 改成 **`integration/multiplayer-stage8-4`** → Save Changes。
2. 右上 **Manual Deploy → Deploy latest commit**。
3. Dashboard → **starwish-mp-test-db** → **Info（或 Networking）→ Access Control**：如果看到 `0.0.0.0/0`，按刪除（只留內部連線）。
4. 資料表會在伺服器啟動時自動升級（只加欄位，不刪資料）。

## C. 手動建立（Blueprint 畫面找不到或出錯時才用）

1. **New ＋ → PostgreSQL**：Name `starwish-mp-test-db`、Database `starwish_test`、User `starwish_test`、Region 選 **Singapore**（離台灣近）、Plan **Free** → Create。
   建好後 **Access Control** 刪掉 `0.0.0.0/0`；在 **Connections** 複製 **Internal Database URL**。
2. **New ＋ → Web Service** → 選 repo `starwish-online` → Branch **`integration/multiplayer-stage8-4`**、Region **和資料庫同一個**、Runtime **Node**、
   Build Command `cd multiplayer && npm install --omit=dev --no-audit --no-fund`、Start Command `node multiplayer/server/main.ts`、Plan **Free**。
3. **Environment Variables**（Add Environment Variable，一行一個）：
   `NODE_VERSION`＝`22`、`MP_REALM`＝`test`、`MP_ALLOWED_ORIGINS`＝`https://scottlien2002-sys.github.io`、`MP_PG_SSL`＝`prefer`、`DATABASE_URL`＝（步驟 1 複製的 Internal Database URL）
4. **Advanced → Health Check Path**：`/health` → Create Web Service。

## D. 確認伺服器正常（用手機或電腦瀏覽器開）

- `https://starwish-mp-test.onrender.com/health` → 顯示 `{"ok":true,"proto":3}`
- `https://starwish-mp-test.onrender.com/metrics` → `"store":{"kind":"postgres","realm":"test"}`（**一定要是 postgres**；如果是 memory 代表資料庫沒接上，請截圖給我）
- 網址名稱若被別人用過，Render 會給不同網址，以 Render 畫面上方的網址為準。

## E. WebSocket 連線

- 遊戲連線網址：`wss://starwish-mp-test.onrender.com/ws`（Render 自動提供 HTTPS 憑證，所以是 **wss**）
- 預覽頁加 `&server=starwish-mp-test.onrender.com` 即可（只填網域，程式自動補 `wss://…/ws`）
- 第一次會問伺服器網址的話，填 `starwish-mp-test.onrender.com`
- （可選）GitHub repo → Settings → Secrets and variables → Actions → **Variables** → `MP_SERVER_URL`＝`wss://starwish-mp-test.onrender.com/ws`：之後的預覽內建網址

## F. 免費方案的限制（Render 官方文件 https://render.com/docs/free ，2026-11-28 查詢）

| 項目 | 免費方案 | 對測試的影響 |
|---|---|---|
| 休眠 | 15 分鐘沒有連線（含 WebSocket 訊息）就休眠 | 隔一陣子再玩，第一次連線要等 |
| 喚醒 | 約 1 分鐘；新的 WebSocket 連線會喚醒伺服器 | 遊戲顯示「伺服器喚醒中」，等候即可 |
| 每月時數 | 750 小時（整個帳號共用；休眠不算）；用完到下個月前停用 | 一台伺服器一般用不完 |
| 檔案 | 重新部署或休眠後本機檔案不保留 | 角色資料存在 PostgreSQL，不受影響 |
| 免費 PostgreSQL | 1 GB；**建立 30 天後到期**（14 天寬限期後刪除資料）；**不提供備份**；每個帳號只能有 1 個；Render 可能隨時維護重啟 | 只放測試資料；到期請刪掉重建（測試角色會消失） |
| 付款方式 | 建立免費服務不需要信用卡；沒有付款方式時，流量或建置時數用完會暫停到下個月 | 不會自動扣款 |

## G. 如果被要求付費（不要付款，改用以下替代）

1. **資料庫要付費／已經有一個免費資料庫**：先把舊的免費資料庫刪掉再建（只能有 1 個），或暫時不建資料庫——伺服器會改用記憶體模式（`/metrics` 顯示 memory），可以測連線與戰鬥，但**伺服器重啟後角色資料會消失**。
2. **Web Service 要付費**：停止部署，告訴我。替代：先用 GitHub 自動測試的結果（測試機上的真實伺服器）驗收程式，再評估其他免費主機（需要您同意才申請）。
3. 不要選 Starter／Standard 等付費方案，也不要開啟 Persistent Disk（付費功能）。

## H. 公開測試前的安全檢查

| 項目 | 狀態 |
|---|---|
| 測試帳號隔離 | ✅ `MP_REALM=test`；正式資料區要另外設定 `MP_ALLOW_PROD=1` 才能啟動 |
| 連線驗證 | ✅ 只接受 GitHub Pages 來源、協定版本 3、訊息 8 KB 上限、速率限制、同角色只能一個連線、重複請求防護 |
| 伺服器權威 | ✅ 傷害、經驗、金幣、掉落、撿取、倒地都由伺服器決定（自動測試含偽造傷害、攻速作弊） |
| WSS | ✅ Render 自動 HTTPS 憑證 |
| 資料庫網路 | ✅ 只允許內部連線（舊資料庫請手動刪 `0.0.0.0/0`） |
| 密碼 | ✅ 只在 Render 環境變數 |
| 正式帳號登入 | ⚠ 尚未實作（目前是訪客角色＋分頁憑證）；開放給外部玩家前需要 |
| 資料備份 | ⚠ 免費資料庫沒有備份；只放測試資料 |
