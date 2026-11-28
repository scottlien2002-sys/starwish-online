# 星廢垃圾場 V3 大型地標：Tripo 原始模型放置處

把 Tripo 產生的 GLB 原檔放進 `raw/`，檔名＝零件主幹（不加 `_hq`）：

| 檔名 | 地標 |
|---|---|
| `raw/jy_lm_colossus.glb` | 廢棄機械巨像 |
| `raw/jy_lm_furnace.glb` | 廢鐵熔爐 |
| `raw/jy_lm_crane_tower.glb` | 廢料回收吊車：塔身 |
| `raw/jy_lm_crane_jib.glb` | 廢料回收吊車：吊臂（含駕駛室、配重） |
| `raw/jy_lm_crane_claw.glb` | 廢料回收吊車：抓斗 |
| `raw/jy_lm_reactor.glb` | 魔導核心反應爐（外殼，中央核心艙留空） |

推上 `dev/junkyard-v3` 後，`blender-junkyard-lm.yml` 會自動：
1. 合併網格、三角化，依 `landmarkSlots.ts` 的預算減面成 HQ／Lite；
2. 縮小貼圖（HQ 2048 或 1024、Lite 一半；Lite 不帶法線貼圖），輸出 JPEG 貼圖的 GLB；
3. 結果與報告推到 `art-junkyard-lm` 分支（一般 push）。

原始檔不會被修改。尺寸、原點、朝向由遊戲端自動校正（見專案文件〈Starwish_Junkyard_V3_Landmark_Asset_Spec〉）。
