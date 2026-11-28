# C 部門 Combat VFX 預覽接入共用資產（shared-assets）報告

日期：2026-11-28　作者：Claude C
依據：Claude A 的 `claude/Starwish_Shared_Assets_Spec.md`（工具 `tools/shared-assets.mjs`、`tools/pages-inventory.mjs`，從 A 的 `tools/pages-capacity` 複製到 C 的分支，沒有修改 A 的分支）

## 1. 容量

| 時間點（gh-pages commit） | 合計（`du -sm`） | 說明 |
|---|---|---|
| A 整理後 `89281e2` | 633 MB | 接入前基準（已備份為 `backup/gh-pages-20261128-pre-c-shared-assets`） |
| C Stage 3 接入 `5199435` | 600 MB | s3 的 18 個大型資產改讀共用區（新放入 6、與既有相同 12） |
| C Stage 1 接入 `da2420f` | 601 MB | 大型資產全部被 D 的 mp81／mp82 引用 → 依規格暫留原處（新 JS 略大 +1 MB） |
| C Stage 2 接入 `d74fa05` | 557 MB | s2 的 18 個資產與共用區既有內容相同，只留一份（省 45.9 MB） |
| C Stage 3 重新部署 `1977d78` | **557 MB** | 再部署一次確認流程穩定（新放入 0） |

**合計減少 76 MB（633 → 557 MB）。** 共用區 121 → 127 個檔案（+6：M002／M003 Rig V1.1 HQ／Lite、Stage 3 remote 男女），約 125 MB；未被引用 0。

| 資料夾 | 接入前 | 接入後 |
|---|---|---|
| preview-combat-vfx-s3 | 56 MB | 11 MB |
| preview-combat-vfx-s2 | 56 MB | 11 MB |
| preview-combat-vfx（Stage 1） | 45 MB | 46 MB（12 個模型仍被 D 引用，暫留） |

### 先前報告的 753 MB 從哪裡來
從 gh-pages 歷史逐筆計算，753 MB 是暫時狀態，**不是 C 增加的**：
- 00:42 A 的 7.4 改用共用區（`4b824b8`）時新增 shared-assets 113 MB，但當時 preview-stage73-world 仍保有自己的 138 MB。
- 01:44 A 的 7.3 改用共用區（`89281e2`），stage73-world 降到 16 MB，合計才回到 633 MB。
- C 的 s3 在這段時間部署三次（`fa3c25b`、`652464b`、`1ca00f4`），資料夾大小都維持 55 MB，沒有增加。C 的部署剛好落在中間，所以讀到 753 MB。

## 2. 做了什麼

**遊戲程式（只加開機前的網址轉換，沒有改技能、動畫、特效、介面）**
- `src/core/assetRemap.ts`：與 A 版本相同。讀 `asset-remap.json` 後，讓 Babylon 改從 `/shared-assets/v1/…` 讀取。
- `src/main.ts`：所有頁面開機前先套用。
- `public/asset-remap.json`：空清單 `{"files":{}}`，本機與一般建置不受影響。
- 戰鬥頁唯一用 `fetch()` 讀的動作檔 `novice_combat_*.json` 只有 171 KB，不到 256 KB，留在自己的資料夾，不需要轉換。

**部署流程（`.github/workflows/combat-vfx.yml`，Stage 1／2／3 三個分支同一套）**
1. 重新 clone gh-pages，記錄基準 commit 與發布前容量。
2. `preserve-save`：先暫存其他預覽（D 的 mp81／mp82）引用的本資料夾檔案。
3. 替換自己的資料夾。
4. `preserve-restore`：把新建置沒有、但別人在用的檔案放回。
5. `publish`：大型資產搬進共用區，相同內容只留一份；別人還在引用的不搬；寫 `asset-remap.json`、更新 `index.json`。
6. `verify`：共用檔案雜湊與所有連結都要正確，失敗就停止部署。
7. 容量檢查：> 1100 MB 停止、> 1000 MB 警告、> 900 MB 提醒。
8. push 被拒時重新 clone、重做全部步驟，最多 5 次。

已發布的雜湊資產不覆寫：接入前共用區的 121 個檔案，接入後 git blob 完全相同（0 個變更、0 個刪除）。

**公開驗證**
- `tests/e2e/verify-preview-remap.mjs`：`asset-remap.json` 的每個目標都要 200，並下載抽查內容的 SHA-1。
- 戰鬥 E2E 在公開網址上另外檢查：`__starwishAssetRemap > 0`、有實際從 `/shared-assets/` 下載、沒有失敗請求。

## 3. 備份（部署前）
- `backup/gh-pages-20261128-pre-c-shared-assets` = gh-pages `89281e2`（接入前的完整 Pages）
- `backup/combat-vfx-stage3-pre-shared-assets` = Stage 3 接入前 `cfb138c`
- `backup/combat-vfx-stage1-final`（b1fe78e）、`backup/combat-vfx-stage2-final`（ecdf80d）沿用
- gh-pages 從未 force push，歷史也是備份

## 4. 驗證結果

| 預覽 | 部門 | 結果 |
|---|---|---|
| preview-combat-vfx-s3 | C | HTTP 7/7＝200；18 個共用資產全部 200、18 個雜湊全部一致；完整 E2E 297/297；公開 WebKit 載入：共用區讀取、失敗請求 0、頁面錯誤 0 |
| preview-combat-vfx-s2 | C | HTTP 7/7＝200；18/18 共用資產 200、雜湊一致；公開 WebKit 載入通過 |
| preview-combat-vfx（Stage 1） | C | HTTP 7/7＝200；E2E 105/105；公開 WebKit 載入通過（大型資產暫留原處） |
| preview-mp81／mp82 | D | 75／83 個跨資料夾連結全部 200；引用 C 的 12 個檔案與接入前逐位元組相同 |
| preview-stage73-world／stage74-perf | A | 各 121 個共用連結全部 200；抽查雜湊一致 |
| /shared-assets/ | 共用 | 127 個檔案、123.6 MB；未被引用 0；`verify` 436 個連結 0 問題 |

唯讀驗證工作流程：`.github/workflows/combat-vfx-pages-verify.yml`，結果在 `results/combat-vfx-pages-46104110365`。

**附註**：Stage 2 分支的 E2E 有一項「多人預算」偶發失敗。
- 原因是 Stage 2 舊版特效預算沒有限制自己的一般特效，Stage 3 已修正。
- 依規定沒有修改 Stage 2 的特效程式，部署與公開驗證都成功。

## 5. 後續
- D 的 mp81／mp82 改讀共用區後，Stage 1 資料夾的 12 個模型（35 MB）就不再被綁住。重跑一次 `feature/combat-vfx-stage1` 的工作流程即可自動搬走。
- A 的新版 Tripo 男性初心者完成前，C 不修改角色模型或骨架。完成後再做戰鬥動畫與技能特效的相容性整合；新模型是新雜湊，舊預覽不受影響。
- 沒有修改 A、B、D 的分支；沒有合併 main、沒有 force push、沒有取消其他部門 CI；沒有刪除共用資產或其他預覽。
