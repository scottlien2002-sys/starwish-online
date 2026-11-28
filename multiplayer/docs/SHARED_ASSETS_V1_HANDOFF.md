# shared-assets/v1 規劃交付（Claude D → Claude A）

作者：Claude D　日期：2026-11-28　來源：Stage 8.2 最終 CI（run 46051391668，commit b8e06c5）的 `shared-assets-plan.json` 與已部署 `/preview-mp82/asset-remap.json`

> 依使用者指示：gh-pages 共用資產與部署容量由 **Claude A 統籌**。本文件只交付 Claude D 已完成的規劃、清單與依賴關係，供 A 參考。
> Claude D **沒有**建立正式 `/shared-assets/`、**沒有**刪除任何預覽；遷移測試只在 CI 暫存目錄執行。

## 1. 摘要
- 多人預覽（Stage 8.2 build）所有模型／貼圖：183.2 MB；其中部署時就刪除的舊版模型 104.2 MB
- 共用候選（≥ 256 KB、部署會用到）：**83 檔、71.8 MB**；預覽自己保留的小檔 7.2 MB
- 目前 `/preview-mp82/` 只有 17 MB：83 個大檔全部由 asset-remap.json 指到其他部門預覽（不重複發布）
- 目前提供這 83 檔的預覽資料夾：`preview-stage72-world` 56 檔、`preview-stage71-world` 15 檔、`preview-combat-vfx` 12 檔 → **這三個資料夾被刪除或重新部署時，`/preview-mp82/` 會缺檔**

## 2. 規劃（D 的建議，最後由 A 決定）
1. 獨立的版本化目錄 `/shared-assets/v1/<原路徑>`（不屬於任何預覽），`manifest.json` 記錄路徑、SHA-1、大小、來源部門
2. 版本不覆蓋：新版模型開 `v2`，舊版保留到沒有預覽引用
3. 各預覽的 `asset-remap.json` 指到共用目錄（A 的 `src/core/assetRemap.ts` 與 D 的做法相同，格式通用：`{"files":{"models/x.glb":"../shared-assets/v1/models/x.glb"}}`）
4. 只有「沒有任何預覽引用」的版本才可清理，而且需要使用者同意
5. 工具：`tools/mp-shared-assets.mjs plan <dist> <out.json>`（清單）、`stage <dist> <root> v1`（在暫存目錄模擬遷移）。遷移測試：完整 3D 雙人 E2E 37/37、從 `/shared-assets/v1/` 載入 129 次、0 個 404（CI 每次都跑）

## 3. 依類別
| 類別 | 檔案 | MB |
|---|---|---|
| M001 星露啵啵 V3.8R（Claude A） | 3 | 1.2 |
| M004 骨骼動畫怪物（怪物製作分支） | 2 | 4.6 |
| M005 骨骼動畫怪物（怪物製作分支） | 2 | 4 |
| M006 骨骼動畫怪物（怪物製作分支） | 2 | 4.5 |
| M007 骨骼動畫怪物（怪物製作分支） | 2 | 4.6 |
| 角色 C1.0-B5b（Claude A／Blender CI） | 4 | 17.4 |
| 星芽村 NPC（Claude B） | 25 | 12.8 |
| 星芽村建築與道具（Claude B） | 43 | 22.7 |

## 4. 83 個大型檔案（路徑、大小、SHA-1、目前由哪個預覽提供）
| # | 路徑（models/ 之下） | KB | SHA-1 前 12 碼 | 類別 | 目前來源 |
|---|---|---|---|---|---|
| 1 | `bobo_v38r_high.glb` | 469 | e27912af57eb | M001 星露啵啵 V3.8R（Claude A） | preview-stage71-world |
| 2 | `bobo_v38r_low.glb` | 345 | 55523c0e8032 | M001 星露啵啵 V3.8R（Claude A） | preview-stage71-world |
| 3 | `bobo_v38r_medium.glb` | 390 | 5b4fc7b4c541 | M001 星露啵啵 V3.8R（Claude A） | preview-stage71-world |
| 4 | `monsters/m004/M004_WindfeatherFox_Rig_V1_1_HQ.glb` | 3891 | 229e4ae4b971 | M004 骨骼動畫怪物（怪物製作分支） | preview-combat-vfx |
| 5 | `monsters/m004/M004_WindfeatherFox_Rig_V1_1_Lite.glb` | 807 | 0ddb81e292b9 | M004 骨骼動畫怪物（怪物製作分支） | preview-combat-vfx |
| 6 | `monsters/m005/M005_NebulaSheep_Rig_V1_HQ.glb` | 3431 | 919123953a88 | M005 骨骼動畫怪物（怪物製作分支） | preview-combat-vfx |
| 7 | `monsters/m005/M005_NebulaSheep_Rig_V1_Lite.glb` | 690 | b6e235fc9173 | M005 骨骼動畫怪物（怪物製作分支） | preview-combat-vfx |
| 8 | `monsters/m006/M006_CarrotKing_Rig_V1_HQ.glb` | 3797 | 4b0d338eff8c | M006 骨骼動畫怪物（怪物製作分支） | preview-combat-vfx |
| 9 | `monsters/m006/M006_CarrotKing_Rig_V1_Lite.glb` | 775 | 4c45b24c14a7 | M006 骨骼動畫怪物（怪物製作分支） | preview-combat-vfx |
| 10 | `monsters/m007/M007_CrownHammerRabbit_Rig_V1_HQ.glb` | 3918 | d9a42b008a8a | M007 骨骼動畫怪物（怪物製作分支） | preview-combat-vfx |
| 11 | `monsters/m007/M007_CrownHammerRabbit_Rig_V1_Lite.glb` | 812 | a35c37164de3 | M007 骨骼動畫怪物（怪物製作分支） | preview-combat-vfx |
| 12 | `novice_c10b5b_female_hq.glb` | 7111 | 91e095b457c4 | 角色 C1.0-B5b（Claude A／Blender CI） | preview-combat-vfx |
| 13 | `novice_c10b5b_female_lite.glb` | 1742 | 9245d7801570 | 角色 C1.0-B5b（Claude A／Blender CI） | preview-combat-vfx |
| 14 | `novice_c10b5b_male_hq.glb` | 7178 | 1d7777b5f502 | 角色 C1.0-B5b（Claude A／Blender CI） | preview-combat-vfx |
| 15 | `novice_c10b5b_male_lite.glb` | 1805 | 4f4947e07780 | 角色 C1.0-B5b（Claude A／Blender CI） | preview-combat-vfx |
| 16 | `village-npc67/board67_hq.glb` | 492 | 3a4601ca57f9 | 星芽村 NPC（Claude B） | preview-stage72-world |
| 17 | `village-npc67/board67_lite.glb` | 369 | 154161e139b1 | 星芽村 NPC（Claude B） | preview-stage72-world |
| 18 | `village-npc67/npc_clown67_far.glb` | 278 | 9c6886d66904 | 星芽村 NPC（Claude B） | preview-stage72-world |
| 19 | `village-npc67/npc_clown67_hq.glb` | 861 | 3968fe06ae81 | 星芽村 NPC（Claude B） | preview-stage72-world |
| 20 | `village-npc67/npc_clown67_lite.glb` | 469 | 340ae24f4a85 | 星芽村 NPC（Claude B） | preview-stage72-world |
| 21 | `village-npc67/npc_knight67_far.glb` | 278 | de830d36a352 | 星芽村 NPC（Claude B） | preview-stage72-world |
| 22 | `village-npc67/npc_knight67_hq.glb` | 857 | f3378dd5f150 | 星芽村 NPC（Claude B） | preview-stage72-world |
| 23 | `village-npc67/npc_knight67_lite.glb` | 470 | 2637a6ddcf35 | 星芽村 NPC（Claude B） | preview-stage72-world |
| 24 | `village-npc67/npc_mage67_far.glb` | 281 | 9967ad7b4637 | 星芽村 NPC（Claude B） | preview-stage72-world |
| 25 | `village-npc67/npc_mage67_hq.glb` | 856 | eb8aeea52443 | 星芽村 NPC（Claude B） | preview-stage72-world |
| 26 | `village-npc67/npc_mage67_lite.glb` | 471 | 7889b10cdf71 | 星芽村 NPC（Claude B） | preview-stage72-world |
| 27 | `village-npc67/npc_priest67_far.glb` | 289 | afeef05d8751 | 星芽村 NPC（Claude B） | preview-stage72-world |
| 28 | `village-npc67/npc_priest67_hq.glb` | 862 | a0e40680a97a | 星芽村 NPC（Claude B） | preview-stage72-world |
| 29 | `village-npc67/npc_priest67_lite.glb` | 485 | 966351564e67 | 星芽村 NPC（Claude B） | preview-stage72-world |
| 30 | `village-npc67/npc_smith67_far.glb` | 262 | 264798c707e4 | 星芽村 NPC（Claude B） | preview-stage72-world |
| 31 | `village-npc67/npc_smith67_hq.glb` | 821 | f1e243efde7e | 星芽村 NPC（Claude B） | preview-stage72-world |
| 32 | `village-npc67/npc_smith67_lite.glb` | 441 | 00826a65c0fd | 星芽村 NPC（Claude B） | preview-stage72-world |
| 33 | `village-npc67/npc_swordmaster67_far.glb` | 261 | 77b18c1544c2 | 星芽村 NPC（Claude B） | preview-stage72-world |
| 34 | `village-npc67/npc_swordmaster67_hq.glb` | 808 | 008fc39b5a9a | 星芽村 NPC（Claude B） | preview-stage72-world |
| 35 | `village-npc67/npc_swordmaster67_lite.glb` | 439 | f6a9162234cf | 星芽村 NPC（Claude B） | preview-stage72-world |
| 36 | `village-npc67/npc_warehouse67_far.glb` | 261 | 3b31ea109c34 | 星芽村 NPC（Claude B） | preview-stage72-world |
| 37 | `village-npc67/npc_warehouse67_hq.glb` | 795 | 64c3e1a50d56 | 星芽村 NPC（Claude B） | preview-stage72-world |
| 38 | `village-npc67/npc_warehouse67_lite.glb` | 436 | 37441d2d2932 | 星芽村 NPC（Claude B） | preview-stage72-world |
| 39 | `village-npc67/pet_merchant67_hq.glb` | 827 | 32ceab92885c | 星芽村 NPC（Claude B） | preview-stage72-world |
| 40 | `village-npc67/pet_merchant67_lite.glb` | 439 | 4d492d6c664c | 星芽村 NPC（Claude B） | preview-stage72-world |
| 41 | `village-p3/church_hq.glb` | 354 | 651f59a9ace5 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 42 | `village-p3/env_hq.glb` | 860 | 354ad4b210d3 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 43 | `village-p3/env_lite.glb` | 316 | eeaf863e0952 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 44 | `village-p3/fountain_hq.glb` | 1304 | 8b1956797867 | 星芽村建築與道具（Claude B） | preview-stage71-world |
| 45 | `village-p3/fountain_lite.glb` | 609 | 4a0a84016fd2 | 星芽村建築與道具（Claude B） | preview-stage71-world |
| 46 | `village-p3/knight_hq.glb` | 899 | a7ee1cd5c5b3 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 47 | `village-p3/knight_lite.glb` | 344 | 4a35de7ce272 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 48 | `village-p3/mage_hq.glb` | 884 | 2c4e2034843d | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 49 | `village-p3/mage_lite.glb` | 309 | 2a949f397bb8 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 50 | `village-p3/npc_clown_hq.glb` | 553 | 4151d9a3f8c3 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 51 | `village-p3/npc_clown_lite.glb` | 292 | a61f2ebcd0fb | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 52 | `village-p3/npc_guild_hq.glb` | 513 | 31792f144806 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 53 | `village-p3/npc_guild_lite.glb` | 278 | d3971f07cc34 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 54 | `village-p3/npc_knight_hq.glb` | 508 | 53c5d4ce1faf | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 55 | `village-p3/npc_knight_lite.glb` | 275 | e7e9cfafbd6f | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 56 | `village-p3/npc_mage_hq.glb` | 543 | 7c1413fc6ff1 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 57 | `village-p3/npc_mage_lite.glb` | 289 | 87491d2ea5ce | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 58 | `village-p3/npc_priest_hq.glb` | 541 | b59b1d320170 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 59 | `village-p3/npc_priest_lite.glb` | 289 | d9d6a151cd18 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 60 | `village-p3/npc_smith_hq.glb` | 524 | 88bbbe2cffd8 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 61 | `village-p3/npc_smith_lite.glb` | 291 | 7f848e7e364d | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 62 | `village-p3/npc_swordmaster_hq.glb` | 523 | d887262e09e8 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 63 | `village-p3/npc_swordmaster_lite.glb` | 287 | 00bc1876dad6 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 64 | `village-p3/npc_warehouse_hq.glb` | 545 | 2b1f8bb8ea88 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 65 | `village-p3/npc_warehouse_lite.glb` | 291 | f0e71fa3b950 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 66 | `village-p3/pet_merchant_v2_far.glb` | 443 | b01a4b13bf87 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 67 | `village-p3/pet_merchant_v2_hq.glb` | 773 | a9a8496323ec | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 68 | `village-p3/pet_merchant_v2_lite.glb` | 516 | e50af37556a1 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 69 | `village-p3/platform_hq.glb` | 382 | d438005c260b | 星芽村建築與道具（Claude B） | preview-stage71-world |
| 70 | `village-p3/platform_lite.glb` | 301 | 0b97d4721c31 | 星芽村建築與道具（Claude B） | preview-stage71-world |
| 71 | `village-p3/plaza_hq.glb` | 2105 | 1f016e75ab7f | 星芽村建築與道具（Claude B） | preview-stage71-world |
| 72 | `village-p3/plaza_lite.glb` | 704 | df31671f4378 | 星芽村建築與道具（Claude B） | preview-stage71-world |
| 73 | `village-p3/portals_hq.glb` | 651 | 5c8e0a7f651e | 星芽村建築與道具（Claude B） | preview-stage71-world |
| 74 | `village-p3/portals_lite.glb` | 348 | d0c8d7ba62ad | 星芽村建築與道具（Claude B） | preview-stage71-world |
| 75 | `village-p3/sword_hq.glb` | 478 | 14347c6ae751 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 76 | `village-p3/sword_lite.glb` | 257 | 62182d2f1235 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 77 | `village-p3/tex/ashlar_hq.png` | 270 | f86859aabe31 | 星芽村建築與道具（Claude B） | preview-stage71-world |
| 78 | `village-p3/tex/detail66_hq.png` | 1236 | 331cecccd353 | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 79 | `village-p3/tex/detail66_lite.png` | 414 | 3275887f496e | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 80 | `village-p3/tex/grass66_hq.png` | 903 | 3f0ae4f1355b | 星芽村建築與道具（Claude B） | preview-stage72-world |
| 81 | `village-p3/tex/paving_nrm_hq.png` | 306 | f566f4eb2502 | 星芽村建築與道具（Claude B） | preview-stage71-world |
| 82 | `village-p3/tex/stone_nrm_hq.png` | 295 | 7cdaa410bfa8 | 星芽村建築與道具（Claude B） | preview-stage71-world |
| 83 | `village-p3/tex/wood_hq.png` | 412 | 3d7bf93487d2 | 星芽村建築與道具（Claude B） | preview-stage71-world |

## 5. Stage 8.4 新增（尚未部署；需要與 A 協調容量後才部署）
| 檔案 | 大小 | 說明 |
|---|---|---|
| `monsters/m002/M002_MossHornBeast_Rig_V1_1_{HQ,Lite}.glb` | 2.52＋0.72 MB | Claude C Rig V1.1 候選（V1.0 檔名相同，所以另存；多人預覽預設讀 V1.1，`&m23=v10` 回退） |
| `monsters/m003/M003_CloudFluffBird_Rig_V1_1_{HQ,Lite}.glb` | 3.40＋0.66 MB | 同上 |
| `novice_c10b5b_{male,female}_remote.glb`（Stage 3 版） | 1.83＋1.89 MB | 其他玩家合併渲染（C Stage 3：含遠距離 LOD；與 A 7.4 內的 Stage 2 版內容不同） |
| `novice_c10b5b_{male,female}_remote_hair.json` | < 1 KB | D 產生的頭髮頂點區間（髮色用） |
| M002／M003 V1.0、M001～M007 其他檔 | — | 與 A 7.4 相同 → 可由 asset-remap 指到 `preview-stage73-world`／共用目錄 |

估計：Stage 8.4 多人預覽若沿用 asset-remap，只需新發布上面約 11 MB（加上程式約 17 MB）；V1.1 候選若之後被統一驗收、取代 V1.0，可以只留一份。
**部署前請 A 確認容量與停止線（目前約 1091 MB／停止線 1100 MB）**；在 A 完成容量管理前，Claude D 的 Stage 8.4 CI 只測試、不部署。
