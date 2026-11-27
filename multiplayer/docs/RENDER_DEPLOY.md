# 星願物語 Stage 8.2｜多人測試伺服器部署步驟（需要您操作，全部免費方案）

我（Claude D）的環境無法登入您的 Render 帳號，所以伺服器這一步要請您操作，大約 10 分鐘。
**如果過程中 Render 要求付款、升級方案或輸入信用卡，請先停止並告訴我，不要付款。**

> Render 沒有部署時，本機開發、自動測試、CI 都照常進行（CI 在測試機上自己啟動伺服器），不會被卡住。

## A. 第一次部署（還沒有建立過 Render 服務）
1. 打開 https://render.com → Get Started → 選「GitHub」登入（scottlien2002-sys 帳號）。
2. Dashboard 右上 **New → Blueprint** → 連接 **scottlien2002-sys/starwish-online**。
3. 分支選 **integration/multiplayer-stage8-2**，Render 讀到 `render.yaml`，列出兩個項目：
   - `starwish-mp-test`（Web Service，**Free**）
   - `starwish-mp-test-db`（PostgreSQL，**Free**）
4. 確認兩個都是 Free → **Apply**，等 3～5 分鐘變成 **Live**。

## B. 已經用 Stage 8.1 建立過（只要換分支）
1. Dashboard → `starwish-mp-test` → **Settings → Build & Deploy → Branch** 改成 **integration/multiplayer-stage8-2** → Save。
2. 右上 **Manual Deploy → Deploy latest commit**。
3. Dashboard → `starwish-mp-test-db` → **Info → Access Control（Networking）**：把 `0.0.0.0/0` 這一條刪掉（只允許 Render 內部連線；新建立的會自動套用 `render.yaml` 的設定）。
4. 資料庫結構會在伺服器啟動時自動升級到 8.2（加欄位，不刪資料；8.1 的測試角色會自動補發測試起始裝備）。

## C. 確認伺服器正常
- `https://starwish-mp-test.onrender.com/health` → `{"ok":true,"proto":3}`
- `https://starwish-mp-test.onrender.com/metrics` → `store` 為 `{"kind":"postgres","realm":"test"}`；有人進原野後會出現 `combat`（怪物數 17、擊殺、掉落統計）
- 網址名稱被用過時 Render 會給別的網址，以 Render 畫面為準。

## D. 兩台 iPhone 測試（Stage 8.2 多人戰鬥預覽）
- 第一台（男、短劍）：
  `https://scottlien2002-sys.github.io/starwish-online/preview-mp82/?play=world&mp=1&server=starwish-mp-test.onrender.com&name=阿星&g=male`
- 第二台（女、粉紅髮、法杖）：
  `https://scottlien2002-sys.github.io/starwish-online/preview-mp82/?play=world&mp=1&server=starwish-mp-test.onrender.com&name=小願&g=female&hairColor=%23c0408a&weapon=staff`

第一次連線若伺服器在休眠，畫面顯示「喚醒約需 1 分鐘」，請等候。

測試項目（每一項的結果請回報「通過／不通過＋截圖」）：
1. 星芽村互相看見：兩人都是 C1.0-B5b 初心者；髮色、武器（短劍／法杖）與自己畫面一致
2. 走路／跑步、停下、轉身同步；洛恩位置一致
3. 南門 → 星芽原野；兩人互相看見
4. 兩人一起打同一隻星露啵啵：兩支手機看到的血量、受擊、死亡一樣；兩人都跳「經驗 +12」
5. 法杖玩家按「技能」：魔法陣＋魔法彈；另一支手機也看到特效
6. 掉落物（金幣、道具）：傷害最高的人 30 秒內可撿；走過去自動撿、兩支手機上同時消失
7. 約 10 秒後怪物重生，兩支手機同時出現
8. 被怪物打倒（伺服器判定）→ 3 秒後回星芽村、滿血
9. 關 Wi-Fi 幾秒再打開 → 自動重連；等級、經驗、金幣不變
10. 畫面上方「多人」列點開：等級、經驗、金幣、背包件數、延遲、FPS（**FPS 請您填寫實測值**）

## E. 公開測試前的安全檢查（Stage 8.3）
| 項目 | 狀態 | 說明 |
|---|---|---|
| 測試帳號隔離 | 已實作＋自動測試 | `MP_REALM=test`；正式資料區要另設 `MP_ALLOW_PROD=1` 才能啟動；測試與正式資料互不可見（pg.test.ts） |
| 連線驗證 | 已實作＋自動測試 | 來源網域白名單（只允許 github.io）、協定版本、訊息大小 8 KB、每連線速率限制、同角色單一連線、重複請求防護 |
| 伺服器權威 | 已實作＋自動測試 | 傷害、暴擊、經驗、金幣、掉落、撿取、倒地全部由伺服器決定；客戶端送的數值一律忽略 |
| WSS | Render 自動提供 HTTPS 憑證 | 預覽網址是 https，只能用 wss:// 連線 |
| 資料庫網路 | `render.yaml` 已設定只允許內部連線 | 舊的 8.1 資料庫要手動刪掉 `0.0.0.0/0`（步驟 B-3） |
| 資料庫連線加密 | 內部網路 | 服務與資料庫在同一區域時走 Render 內部網路；外部連線 Render 強制 TLS |
| 密碼 | Render 自動產生 | 連線字串只存在 Render 環境變數，不在 GitHub |
| 免費資料庫到期 | ⚠ 建立 30 天後到期 | 只放測試資料；到期刪除重建即可 |
| 正式帳號登入 | ⚠ 尚未實作 | 目前是訪客角色＋憑證（存在瀏覽器分頁）；公開給外部玩家前需要正式帳號系統（Stage 8.4 以後，另行申請） |

## F. 免費方案限制（Render 官方文件，2026-11 查詢）
- Web Service：閒置 15 分鐘休眠，下次連線約 1 分鐘喚醒；每月 750 小時；檔案系統不保存（角色資料存在 PostgreSQL，不受影響）。
- PostgreSQL：1 GB；建立 30 天後到期；不提供備份；每個帳號一個免費資料庫。
- 正式營運需要不休眠主機與長期資料庫，屆時另外評估（需要您核准，可能有費用）。

## G.（可選）把伺服器網址設定進預覽
GitHub repo → Settings → Secrets and variables → Actions → **Variables** → `MP_SERVER_URL` = `wss://starwish-mp-test.onrender.com/ws`
之後 CI 部署的預覽會內建這個網址，可以省略 `&server=`。
