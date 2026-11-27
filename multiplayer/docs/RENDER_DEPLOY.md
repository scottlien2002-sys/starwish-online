# 星願物語 Stage 8.1｜多人測試伺服器部署步驟（需要您操作，全部免費方案）

我（Claude D）的環境無法登入您的 Render 帳號，所以伺服器這一步要請您操作，大約 10 分鐘。
**如果過程中 Render 要求付款、升級方案或輸入信用卡，請先停止並告訴我，不要付款。**

## 1. 建立 Render 帳號
1. 打開 https://render.com → Get Started → 選「GitHub」登入（使用 scottlien2002-sys 帳號）。

## 2. 用 Blueprint 一次建立伺服器＋資料庫
1. Render Dashboard 右上 **New → Blueprint**。
2. 連接 GitHub 儲存庫 **scottlien2002-sys/starwish-online**（第一次會要求授權 Render 讀取這個 repo）。
3. 分支選 **integration/multiplayer-stage8-1**，Render 會讀到 `render.yaml`，列出兩個項目：
   - `starwish-mp-test`（Web Service，Free）
   - `starwish-mp-test-db`（PostgreSQL，Free）
4. 確認兩個都是 **Free**，按 **Apply**。
5. 等候建置完成（約 3～5 分鐘），狀態變成 **Live**。

## 3. 確認伺服器正常
- 打開 `https://starwish-mp-test.onrender.com/health` → 應顯示 `{"ok":true,"proto":2}`
- 打開 `https://starwish-mp-test.onrender.com/metrics` → `store` 應為 `{"kind":"postgres","realm":"test"}`
- 如果名稱被別人用過，Render 會給不同網址（例如 `starwish-mp-test-xxxx.onrender.com`），以 Render 畫面顯示的網址為準。

## 4. 兩台 iPhone 測試
兩台 iPhone 的 Safari 各自打開（把網址中的伺服器換成第 3 步的網址）：

- 第一台（男）：
  `https://scottlien2002-sys.github.io/starwish-online/preview-mp81/?play=world&mp=1&server=starwish-mp-test.onrender.com&name=阿星&g=male`
- 第二台（女、粉紅髮、法杖）：
  `https://scottlien2002-sys.github.io/starwish-online/preview-mp81/?play=world&mp=1&server=starwish-mp-test.onrender.com&name=小願&g=female&hairColor=%23c0408a&weapon=staff`

第一次連線若伺服器在休眠，畫面會顯示「免費測試主機休眠中時喚醒約需 1 分鐘」，請等候。
伺服器網址記在 Safari 裡，之後可以省略 `&server=`。

測試項目：
1. 星芽村互相看見對方（名牌、性別、髮色、武器不同）
2. 互相看到走路／跑步、停下、轉身
3. 兩人看到的洛恩位置一致；其中一人跟洛恩對話時，另一人看到洛恩停下並面向對話的人
4. 走入南門 → 星芽原野；原野互相看見；從營地傳送陣走回星芽村
5. 原野打怪時對方看到攻擊動作（怪物本身是各自 iPhone 的單機行為，Stage 8.2 才改成伺服器權威）
6. 關掉 Wi-Fi 幾秒再打開 → 自動重新連線，對方畫面上角色恢復
7. 畫面上方「多人」列：點一下可看延遲、封包量、人數、FPS

## 5. 免費方案限制（2026-11 查詢 Render 官方文件）
- Web Service：閒置 15 分鐘（沒有 HTTP 請求或 WebSocket 訊息）會休眠，下次連線約 1 分鐘喚醒；每月 750 小時；檔案系統不保存。
- PostgreSQL：1 GB；**建立 30 天後到期**（到期後 14 天內不升級即刪除）；不提供備份；每個帳號只能有一個免費資料庫。
  → 這是測試資料區（realm=test），到期後可以刪掉重建，不影響未來正式資料。
- 正式營運需要不休眠的主機與長期保存的資料庫，屆時再另外評估（需要您核准，可能有費用）。

## 6.（可選）把伺服器網址設定進預覽
GitHub repo → Settings → Secrets and variables → Actions → **Variables** → New variable：
`MP_SERVER_URL` = `wss://starwish-mp-test.onrender.com/ws`
之後 CI 重新部署預覽時會內建這個網址，網址可以省略 `&server=`。
