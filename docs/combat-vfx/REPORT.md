# Combat VFX Lab — Stage 1 測試報告（Claude C）

> 本階段技能僅供技術展示，不代表正式職業技能及數值已定案。

## 1. 交付位置

| 項目 | 位置 |
|---|---|
| 開發分支 | `feature/combat-vfx-stage1`（從 `backup/stage72-batch1` ad2fe53 分出） |
| 開工前備份 | `backup/combat-vfx-stage1-base`（= ad2fe53） |
| 怪物 rig 交付給 Claude A | `assets/monster-rigs-m004-m007`（438c66a）＋ `docs/monsters/CLAUDE_C_DELIVERY_M001-M007.md` |
| 展示網址 | https://scottlien2002-sys.github.io/starwish-online/preview-combat-vfx/?lab=combat |
| 整合介面文件 | `docs/combat-vfx/INTEGRATION.md`（Claude A、D） |
| CI 結果 | `results/combat-vfx-<run id>` 分支（report.json、summary.md、截圖、固定步長展示畫面序列） |

## 2. M001～M007 交付狀態

| 怪物 | 狀態 |
|---|---|
| M001 啵啵 | 遊戲內程式化模型，沒有 GLB 需交付 |
| M002 | 只有 Tripo 自動 rig 的走路原檔；從未指派給 Claude C 做 rig，**未交付 rig 版** |
| M003 | 未 rig；從未指派給 Claude C，**未交付 rig 版** |
| M004 風羽狐 V1.1 | HQ／Lite GLB 已交付（路徑符合 Claude A 的 riggedSpec） |
| M005 星雲綿羊 V1 | HQ／Lite GLB 已交付 |
| M006 胡蘿蔔大王 V1 | HQ／Lite GLB 已交付 |
| M007 王冠重錘兔 V1 | HQ／Lite GLB 已交付 |

M002、M003 沒有用其他模型代替。

## 3. 展示頁功能

- 角色：已驗收的 C1.0-B5b 男女初心者（`novice_c10b5b_*`），**沒有使用 Tripo 組裝版**。
- 6 個技能按鈕（含冷卻）：三連斬（短劍三段）、魔法彈（法杖施法）、跳斬（跳躍重斬）、旋風斬、星隕（遠距魔法）、蓄力爆發。
- 特效：武器殘影、弧形劍氣、魔法陣、魔法彈、地面震波、範圍爆破、星光粒子、命中閃光、暴擊特效（CRITICAL）、傷害數字、合成音效（WebAudio，不用音檔）、鏡頭震動、打擊頓幀。
- 怪物實戰：M004～M007 骨骼動畫怪物（Claude A 的 RiggedMonsterVisual），會攻擊、受擊、死亡後重生。
- 高／中／低特效品質切換、FPS 面板（即時、10 秒平均、1% Low、Draw Call、粒子數、特效預算）。
- 攻速滑桿 100～200：實際播放依上限 **160**。
- 只有技能裡有跳躍；一般移動沒有跳躍鍵。
- 多人模擬（`&multi=8`）：其他玩家特效走預算（份額、距離剔除、次要特效壓力）。

## 4. 自動測試（GitHub Actions，Chromium＋WebKit）

全部 105 項通過（run 46008753679，commit 7672bf1）：

- 型別檢查、單元測試（8 項）、建置。
- 載入：4 隻 rig 怪物檔案檢查通過；初心者為 C1.0-B5b。
- 6 個技能逐一施放：每個都有命中結算；命中那一格的動作時間＝時間軸時間（誤差 ≤ 1/30 秒），傷害數字在同一格顯示。
- 固定步長（每步 1/60 秒）：命中格動作時間誤差 ≤ 1/60 秒。
- 攻速設 250 → 實際依 160 播放。
- 三段品質都能生成特效；低畫質會擋掉次要特效。
- 多人模擬 8 人：其他玩家特效被預算限制（份額／上限，包含其他玩家的命中閃光），自己的技能仍正常命中並顯示傷害。
- 沒有頁面錯誤；公開網址資源 HTTP 200，公開網址 WebKit 測試通過。
- gh-pages 總容量 852 MB（上限 1100 MB），沒有刪除其他預覽。

## 5. 開發中發現並修正的問題

- 網格特效（劍氣、魔法陣、蓄力光、地面光、武器殘影）原本整片黑色、加算後看不見：Babylon 的 disableLighting 只輸出自發光，顏色改放 emissiveColor 後正常。
- 命中那一格動作慢一格：改成先推進動作與根運動、再處理命中事件；命中事件會把時鐘對齊到命中時間。
- 其他玩家的「critical」命中特效會繞過多人預算：改為只有自己的角色免檢查。
- 白色競技場會把加算特效洗掉：改成星夜深色競技場＋星空穹頂。

## 6. 展示影片

CI 沒有 GPU，即時播放只有 3～9 FPS；展示影片用固定步長模式（`&manual=1`，每步 1/60 秒、每 1/30 秒截一張）產生，等於真正 30 fps 的畫面。影片裡面板顯示的「FPS 60」是固定步長的數字，不是實際效能。

## 7. 未驗證

- **iPhone Safari 實機 FPS：未驗證。** CI 沒有 GPU（軟體繪圖 3～9 FPS），數字不代表手機效能，請在實機上看左上角 FPS 面板。
- 實機觸控手感、音效音量、震動強度：未驗證。
- 多人模擬 8 人時 Draw Call 約 310（每位模擬玩家是完整角色＋武器），iPhone 是否吃得消：未驗證；正式多人時遠端玩家請用 Lite 模型並套用預算。

## 8. 開發安全

沒有修改 Claude A、B、D 的工作分支；沒有合併 main；沒有 force push；沒有取消其他部門的 CI（原 ci-deploy 只排除本分支）；沒有刪除其他預覽版本；沒有使用付費服務。
