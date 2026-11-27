# Claude C → Claude A：怪物骨骼動畫資產交付（M001～M007 狀態）

日期：2026-11-27　分支：`assets/monster-rigs-m004-m007`（從 `backup/stage72-batch1` ad2fe53 開出，只加資產，不改程式）

## 1. 七隻怪物狀態

| 編號 | 怪物 | 狀態 | 檔案 |
|---|---|---|---|
| M001 | 星露啵啵 | 已在遊戲內（V3.8R，程式動畫，Claude A 原有） | 不需要 GLB 骨骼交付 |
| M002 | 苔角獸 | **尚未綁骨**：只有使用者上傳的 Tripo 自動綁骨（只有 walk）原檔，Claude C 沒有接過這隻的骨架任務 | 無 |
| M003 | 雲絨鳥 | **尚未綁骨**：只有未綁骨原檔，Claude C 沒有接過這隻的骨架任務 | 無 |
| M004 | 風羽狐 | Rig V1.1 交付 | `public/models/monsters/m004/` |
| M005 | 星雲咩咩 | Rig V1.0 交付 | `public/models/monsters/m005/` |
| M006 | 胡蘿蔔大王 | Rig V1.0 交付 | `public/models/monsters/m006/` |
| M007 | 王冠重錘兔 | Rig V1.0 交付 | `public/models/monsters/m007/` |

M002、M003 需要另外開骨架任務；這次沒有用其他怪物的骨架或模型代替。

## 2. 檔名與規格（與 `src/monsters/rigged/riggedSpec.ts` 登記的路徑、關節數、動畫時長、命中時間一致）

| 檔案 | 大小 | SHA-256 |
|---|---|---|
| m004/M004_WindfeatherFox_Rig_V1_1_HQ.glb | 3.98 MB | a4c2bc809df32d8b… |
| m004/M004_WindfeatherFox_Rig_V1_1_Lite.glb | 0.83 MB | a879b98cf589ed23… |
| m005/M005_NebulaSheep_Rig_V1_HQ.glb | 3.51 MB | f9a4296f93de282e… |
| m005/M005_NebulaSheep_Rig_V1_Lite.glb | 0.71 MB | 62b3b1c6aa3a4bea… |
| m006/M006_CarrotKing_Rig_V1_HQ.glb | 3.89 MB | 641ce4a1458886bb… |
| m006/M006_CarrotKing_Rig_V1_Lite.glb | 0.79 MB | 6ea02bfe5b30ed16… |
| m007/M007_CrownHammerRabbit_Rig_V1_HQ.glb | 4.01 MB | f259e0e4729acf2a… |
| m007/M007_CrownHammerRabbit_Rig_V1_Lite.glb | 0.83 MB | 2d99d11171db8166… |

| 怪物 | 關節 | Idle／Move／Run／Attack／Hurt／Death／Respawn（秒） | 命中 | Move／Run 原生速度 |
|---|---|---|---|---|
| M004 | 32 | 2.0／0.8／0.38／1.2／0.45／0.7／0.5 | 0.50 s | 0.6／2.4 m/s |
| M005 | 26 | 2.4／0.6／0.42／1.2／0.45／0.75／0.6 | 0.50 s | 0.45／1.5 m/s |
| M006 | 26 | 2.4／0.9／0.5／1.3／0.5／0.9／0.7 | 0.55 s | 0.35／1.0 m/s |
| M007 | 29 | 2.8／1.1／0.62／2.0／0.6／1.6／1.1 | 1.05 s | 0.55／1.5 m/s |

- GLB 根節點 `extras.monster` 帶有上表數值（`applyExtras` 會讀）。
- `public/models/monsters/manifest.json` 已列入 8 個檔案，`stage72.test.ts` 的清單測試在本機通過。

## 3. Claude A 合併方式
```
git checkout assets/monster-rigs-m004-m007 -- public/models/monsters/m004 public/models/monsters/m005 public/models/monsters/m006 public/models/monsters/m007
# 再把 manifest.json 的 8 行加進你分支上的清單
```
- 這個分支名稱不是 `feature/**`，推送不會觸發 CI，也不會部署 GitHub Pages。
- 各怪物的報告與 Babylon 整合說明在專案文件：`Starwish_M004_*`、`Starwish_M005_*`、`Starwish_M006_*`、`Starwish_M007_*`。

## 4. 未驗證
- Babylon.js 9 實際載入、Khronos glTF-Validator、iPhone 實機：都還沒做（Claude C 環境沒有）。Combat VFX Lab 的 CI 會在 Chromium／WebKit 實際載入這四隻，結果寫在該報告。
