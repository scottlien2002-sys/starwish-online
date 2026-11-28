# mp81／mp82 改讀 C 部門正式共用資產（Claude D → Claude A）

依據：`claude/Starwish_CombatVFX_SharedAssets_Handover_A_D.md`（Claude C，2026-11-28）。
狀態：**已準備、已在測試機模擬驗證；尚未部署。** 分支 `integration/multiplayer-stage8-5`，commit `ccdd5ef`（工具、新對照、CI）。 gh-pages 必須等 Claude A 確認後，由 A 的部署流程套用。

## 1. 改了什麼

只改 GitHub Pages 上兩個檔案：`preview-mp81/asset-remap.json`、`preview-mp82/asset-remap.json`。
遊戲程式、模型檔、其他任何預覽都不動。

| 預覽 | 改指向共用區 | 不變 | 程式內寫死 Stage 1 路徑 |
|---|---|---|---|
| preview-mp81 | 4 項（C1.0-B5b 男女 HQ／Lite） | 71 項 | 0 |
| preview-mp82 | 12 項（C1.0-B5b 男女 HQ／Lite＋M004～M007 Rig HQ／Lite） | 71 項 | 0 |

每一項從 `../preview-combat-vfx/<原路徑>` 改成 `../shared-assets/v1/<SHA-1 前兩碼>/<SHA-1>.glb`。
`sources` 拿掉 `preview-combat-vfx`、加上 `shared-assets/v1`。改完之後兩個預覽**完全不再引用** C 的 Stage 1 資料夾。

## 2. 遷移前檢查（對照目前線上 gh-pages `e7fbee0`）

12 個檔案逐一讀出舊路徑與共用區檔案：大小相同、SHA-1 與 C 交接文件一致、位元組完全相同、glTF 2.0 標頭與內容摘要（網格、材質、貼圖、骨架、動畫名稱）相同。→ 內容與相容性一致，角色與怪物外觀、動畫、戰鬥特效不會改變（特效 JSON 在 mp82 自己的資料夾，沒有更動）。
詳細數據：`multiplayer/deploy/pages-c-shared/verify.json`。

## 3. 備份

- 目前完整的 Pages：`backup/gh-pages-20261128-pre-mp-c-shared`（`e7fbee0`）
- D 的開發分支（遷移前）：`backup/multiplayer-stage8-5-pre-c-shared`（`dd27d74`）
- 兩個原本的 asset-remap.json（逐位元組）：`multiplayer/deploy/pages-c-shared/backup/`

## 4. 測試

CI job `pages-c-migration`（`.github/workflows/multiplayer-stage8.yml`）：在測試機上用 gh-pages 的內容模擬網站（**完全不放 `preview-combat-vfx`**），套用新對照，用當時部署的 8.1／8.2 程式與它們自己的多人 E2E 回歸；另跑一次「目前線上對照」當對照組。模擬網站伺服器記錄每一個請求，再檢查：沒有 404、沒有任何請求讀 Stage 1 資料夾、對照表每個目標都能取得且 SHA-1 正確。
結果：見第 7 節。

## 5. 部署步驟（Claude A 確認後執行）

在 A 部署 gh-pages 的工作目錄（已 checkout 最新 gh-pages）中：

```
node tools/mp-pages-c-migration.mjs apply <gh-pages 目錄> multiplayer/deploy/pages-c-shared
```

`apply` 會先確認兩個 asset-remap.json 仍與備份相同（期間有人改過就停止），並確認 12 個共用檔存在且 SHA-1 正確，才寫入新檔。
接著依 A 的流程 commit／push gh-pages，並在 `shared-assets/index.json` 的 users 加上 `preview-mp81`（4 檔）、`preview-mp82`（12 檔）。
部署後確認：`/preview-mp81/asset-remap.json`、`/preview-mp82/asset-remap.json` 不再含 `preview-combat-vfx`；開啟兩個預覽無 404。

之後 C 的 Stage 1（`preview-combat-vfx`）就不再被 D 綁住；是否清理由 A／C 依規格決定（D 不刪除任何預覽）。

## 6. 回退方式

```
node tools/mp-pages-c-migration.mjs rollback <gh-pages 目錄> multiplayer/deploy/pages-c-shared
```

放回原本的兩個 asset-remap.json（只要 preview-combat-vfx 的 12 個檔案還在就能立即恢復）。或從 `backup/gh-pages-20261128-pre-mp-c-shared` 取回這兩個檔案。

## 7. 測試結果（CI run 46132191070，commit `ccdd5ef`，gh-pages `e7fbee0`；結果分支 `results/mp85-pages-46132191070`）

| 預覽 | 模式 | 瀏覽器 | 多人 E2E（當時的腳本） | 404 | 讀 Stage 1 | 對照目標可取得且 SHA-1 正確 |
|---|---|---|---|---|---|---|
| mp81 | 遷移後（沒有 preview-combat-vfx） | Chromium | 28／28 | 0 | 0 | 75／75 |
| mp81 | 遷移後 | WebKit | 28／28 | 0 | 0 | 75／75 |
| mp81 | 目前線上（對照組） | Chromium | 28／28 | 0 | — | — |
| mp82 | 遷移後（沒有 preview-combat-vfx） | Chromium | 37／37 | 0 | 0 | 83／83 |
| mp82 | 遷移後 | WebKit | 37／37 | 0 | 0 | 83／83 |
| mp82 | 目前線上（對照組） | Chromium | 37／37 | 0 | — | — |

- 多人 E2E 涵蓋：雙人進村莊互相看見、移動同步、傳送陣進原野、合作打怪（傷害、擊殺、掉落）、倒地與重生、斷線重連、重複登入、回村；畫面錯誤 0。
- mp82 遷移後實際從共用區載入：女／男 C1.0-B5b Lite、M004～M007 Rig Lite（E2E 使用 `lod=lite`）；HQ 6 檔由稽核直接從模擬網站取得並比對 SHA-1，全部正確。
- mp81 在 E2E 中使用 novice72 角色，不會請求那 4 個 C1.0-B5b 檔；稽核同樣確認 4 個目標可取得、SHA-1 正確。
- 截圖對照（遷移後 vs 對照組）：角色、怪物、技能特效外觀相同（位置因即時操作而不同）。
- 同一次 CI 也重跑了目前多人開發分支（Stage 8.5）的完整回歸：伺服器單元 16／16、整合 11／11、戰鬥 18／18、帳號 7／7、技能位移 5／5、權威 4／4、交易 4／4、PostgreSQL 21／21、效能 10～40 人合格；3D 雙人 E2E Chromium 45／45、WebKit 44／44、共用資產搬移模擬 45／45、單機回歸通過。
- 這些是 CI 瀏覽器在模擬網站上的結果，不是正式網址，也不是 iPhone 實機。

## 8. 之後的 D 預覽

`tools/mp-asset-remap.mjs`（D 部署預覽時去除重複檔案）改成**優先使用 `/shared-assets/v1/`**（檔名＝內容 SHA-1 且驗證一致才採用），找不到才用其他預覽資料夾。之後 D 的新預覽不會再綁住其他部門的預覽資料夾。
