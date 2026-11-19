# 怪物美術資源與製作規範（Monster Asset Pipeline）V1.0

適用：《星願物語 Starwish Online》所有 3D 怪物。
與 `docs/monsters/FRAMEWORK.md` 分工：FRAMEWORK 管「怪物怎麼行動」（數值、狀態機、AI、動畫設定、視覺介面）；
本文件管「怪物的模型檔怎麼做、怎麼命名、能用多少預算、怎麼測試與驗收」。

建立於星露啵啵 V3.6（2026-11-19）。以星露啵啵 V3～V3.6 的實作整理而成；**不假設**所有怪物都有果凍、星雲或翅膀。

---

## 0. 可直接共用 vs. 必須個別製作

| 項目 | 共用（直接使用） | 個別怪物（每隻自己做） |
|---|---|---|
| 命名、版本、檔案結構 | ✅ `src/monsters/assets/spec.ts`、`art/common/glb_tools.py` | 填寫自己的 `MonsterAssetSpec` |
| GLB 匯出後檢查 | ✅ glTF-Validator＋命名與預算檢查（GitHub Actions 步驟） | — |
| 高中低畫質預算 | ✅ 依等級（一般／菁英／頭目）的三角形、檔案、Draw Calls 上限 | 各畫質模型本身（減面或另做） |
| 模型載入、多隻共用、釋放 | ✅ `loadMonsterAsset`（`src/monsters/babylon/loadMonsterAsset.ts`） | — |
| 表情（換圖案） | ✅ `ExpressionAtlasController`＋`offsetUVs` | 表情貼圖、表情清單 |
| 表情（變形）、動作 | 介面共用（`IMonsterVisual`、`MonsterAnimationProfile`） | 形狀鍵或骨骼動畫、動作曲線 |
| 材質／Shader | 架構共用（外掛式材質，見 §4） | 每種怪物的材質外掛（果凍、毛皮、骨頭、金屬…） |
| 造型 | — | 每隻重新建模（程式化 SDF、Blender 手工、外包） |
| 接觸陰影、發光光暈 | ✅ 作法共用（1 次繪製的圓形陰影、光暈貼片） | 尺寸與顏色 |
| 手機效能測試 | ✅ 10 秒測試（`src/render/benchmark.ts`）、成本分析（`src/render/costAnalysis.ts`） | 成本分析要測的項目 |
| 三視圖自動截圖 | ✅ `tests/e2e/snap-bobo3.mjs`（`window.__monsterLab` 介面） | 測試頁需實作該介面 |
| 版本紀錄與驗收 | ✅ 本文件 §10 的流程與範本 | 各怪物的版本紀錄檔 |

---

## 1. 命名規範

| 對象 | 規則 | 範例 |
|---|---|---|
| monsterId（遊戲資料） | 小寫＋底線 | `star_dew_bobo` |
| assetId（檔名短名） | 小寫英數＋底線 | `bobo` |
| pascalName（模型節點） | PascalCase | `StarDewBobo` |
| 版本 | `v` + 數字（主版本×10＋次版本） | `v36` = 3.6 |
| GLB 檔名 | `<assetId>_<版本>_<畫質>.glb` | `bobo_v36_high.glb` |
| 根節點 | `<PascalName>V<數字>_<畫質>` | `StarDewBoboV36_high` |
| 零件（mesh） | 依功能命名，程式用「名稱開頭」尋找 | `Body_high`、`Eyes`、`Mouth`、`Blush`、`Stars` |
| 美術原始檔 | `art/<assetId>-<版本>/` | `art/bobo-v36/` |
| 遊戲端程式 | `src/monsters/<monster-id 連字號>-<版本>/` | `src/monsters/star-dew-bobo-v36/` |
| 預覽分支／網址 | `feature/render-<assetId>-<版本>` → `/preview-<assetId>-<版本>/` | `/preview-bobo-v36/?lab=bobo36` |

舊版本的檔案**不覆蓋、不改名**；新版本一律新檔名。

## 2. GLB 匯出與格式檢查流程

1. Blender（官方免費版，GitHub Actions 無介面執行）產生三種畫質 GLB。
2. `art/common/glb_tools.py write_extras`：把怪物資料寫進根節點 extras（例：`monster`、星露啵啵的 `bellyStar`）。只改 JSON，不動幾何與貼圖。
3. `python3 art/common/glb_tools.py check <資料夾> <assetId> <版本> <等級>`：檢查檔名、根節點、三角形與檔案大小預算、高 ≥ 中 ≥ 低。
4. Khronos glTF-Validator（`gltf-validator@latest`，只發布預覽版，不可寫 `@2`）：必須 **0 錯誤**；警告需說明原因。
5. 產物推到 `art-<assetId>-<版本>` 分支，再複製到 `public/models/`。
6. 遊戲端 `loadMonsterAsset` 載入時再檢查一次根節點與必要零件，缺少就直接報錯。

匯出設定：
- 不帶 KHR_materials_transmission／volume（Babylon 會多畫一次整個場景）；透明感由遊戲端材質外掛處理。
- 貼圖內嵌 PNG；表情貼圖集 1024×512 以內。
- Y 軸朝上（glTF 規範），Blender 的「前方」為 −Y；載入後角色面向 +Z、角色左手在 −X。

## 3. 高、中、低畫質規範

| 等級 | 高 | 中 | 低 | 單檔上限 | 每隻 Draw Calls（高畫質） |
|---|---|---|---|---|---|
| 一般怪 normal | ≤ 12,000 | ≤ 7,000 | ≤ 4,500 | 1 MB | ≤ 7 |
| 菁英 elite | ≤ 20,000 | ≤ 12,000 | ≤ 7,000 | 2 MB | ≤ 10 |
| 頭目 boss | ≤ 60,000 | ≤ 30,000 | ≤ 15,000 | 6 MB | ≤ 20 |

（三角形為整隻全部零件合計。）

- 三種畫質的零件名稱、表情貼圖、材質數必須相同，只差在面數；遊戲依畫質選檔（`lodFileName(spec, quality.level)`）。
- 低畫質可以關閉昂貴的材質效果（例：果凍內部星雲），但**輪廓、表情與辨識特徵不可消失**。
- 星露啵啵 V3.6：高 9,310／中 5,912／低 4,012；418／337／291 KB；每隻 6 次繪製（身體深度＋身體、眼睛、嘴、腮紅、星星）。

## 4. 共用材質與 Shader 架構

- 基底一律使用 Babylon `StandardMaterial`（手機上最便宜），特殊效果用 `MaterialPluginBase` 外掛注入片段著色器，例如 `JellyV36Plugin`。
- 一種外掛 = 一種「質感」，可給多隻怪物使用：果凍（已有）、未來的毛皮、骨頭、金屬、岩石、樹皮、龍鱗。
- 外掛規則：
  - 參數用 uniform（顏色、強度），不寫死在程式裡
  - 有 `jellyEnabled` 這類開關，編譯失敗時自動退回基底材質（`material.onError`）
  - 低畫質可關閉昂貴部分（例 `nebula = 0`）
  - 雜訊等貼圖在啟動時用程式產生或共用一張，不要每隻怪物各下載一份
  - 透明怪物：身體開深度預先繪製（`needDepthPrePass`），用 `alphaIndex` 固定繪製順序，避免排序閃爍
- **不使用**：即時折射（多畫一次場景）、全畫面 Bloom、每隻怪物各自的陰影貼圖。
  發光用光暈貼片（`SpriteManager`，同種怪物 1 次繪製）；陰影用圓形接觸陰影（thin instances，1 次繪製）。

## 5. 表情與動畫控制介面

- **換圖案的表情**（眼睛、嘴巴、發光面罩）：模型 UV 對準貼圖集第 0 格，切換表情就是平移 UV。
  在 `MonsterAssetSpec.expressions` 宣告表情清單與每個零件的格子，再用 `ExpressionAtlasController.set(index)` 切換。
- **變形的表情與動作**：沿用 FRAMEWORK 的 `IMonsterVisual.setFace / applyPose / onStateEnter`。
  程式化模型用姿勢曲線；GLB 用骨骼或節點動畫片段（`MonsterAnimationProfile.clips`）。
- 動畫狀態機、事件時間、AI **不因美術版本改變**；美術只實作視覺介面。
- 正式戰鬥只使用定義好的對應（例：攻擊 → 生氣）；實驗室專用表情不得自動接到戰鬥。

## 6. 怪物尺寸與座標基準

- 1 單位 = 1 公尺，Y 軸朝上；模型原點在**腳底中心**（地面 y = 0）。
- 載入後角色面向 +Z（正面）。左右以角色本身為準：角色左手在 −X。
- `heightM`：身高（不含天線、角等細長裝飾）；`footprintRadiusM`：接觸陰影與碰撞半徑。
- 參考：星露啵啵 0.8 m／0.5 m。一般怪 0.5～2 m、菁英 1.5～3 m、頭目 3 m 以上。
- 同一怪物各版本的尺寸不得任意改變（會影響攻擊距離、碰撞與鏡頭）。

## 7. 模型載入與資源釋放流程

```ts
const handle = await loadMonsterAsset(scene, `${BASE_URL}models/`, SPEC, quality.level); // 載入一次
const a = handle.instantiate("bobo_0");   // 每隻怪物一個實例（共用幾何、貼圖）
const b = handle.instantiate("bobo_1");
a.dispose();                               // 單隻離開：只釋放節點
handle.dispose();                          // 地圖切換：釋放全部實例＋幾何＋材質＋貼圖
```

- 同種怪物同場時只載入一份檔案。
- 需要修改頂點資料的零件（例如表情 UV）會個別複製一份，由 `ExpressionAtlasController` 處理。
- 地圖切換、品質切換必須呼叫 `handle.dispose()`。E2E 會檢查釋放後場景中沒有殘留零件。

## 8. 手機效能測試工具

| 工具 | 位置 | 用途 |
|---|---|---|
| 10 秒效能測試 | 測試頁「⏱ 效能測試」／`&bench=1` | 平均、最慢 1%、最低 FPS、Draw Calls（`FrameRecorder`） |
| 3 隻同場 | `&count=3` | 鏡頭拉遠，三隻都在畫面內（接近遊戲中大小） |
| 成本分析 | 「🔍 成本分析」 | 依序暫時關掉一項功能，各測 5 秒，顯示與目前設定的 FPS 差（`runCostSteps`） |
| 即時面板 | 右上角 | FPS、Draw Calls、Mesh 數、解析度倍率；連續低於 40 FPS 會自動降解析度 |

規則：
- **iPhone 實測與自動化測試分開記錄**。雲端（CI）是軟體繪圖，只能用來檢查功能、Draw Calls、三角形數，**不可當成 FPS**。
- 驗收標準以使用者的 iPhone Safari 高畫質 2x 為準；目前一般怪：3 隻同場平均 ≥ 58、最慢 1% ≥ 45。
- 新版本若會增加繪製成本，先說明原因與預估影響，再實作。

## 9. 三視圖自動截圖工具

`node tests/e2e/snap-bobo3.mjs <dist> <輸出資料夾> <webkit|chromium> <high|medium|low> <lab 名稱>`

- 測試頁需提供 `window.__monsterLab`：`ready`、`setView("front"|"side"|"back")`、`setExpression`、`setCount(1|3)`、`setClose(bool)`、`info()`、`perf()`。
- 產出：`v_front/side/back`、所有表情 `e_<名稱>`、`count3`、`shots.json`（含模型檔、三角形、Draw Calls）。
- `compare.yml` 會把結果推到 `compare-<assetId>-<版本>` 分支；新舊版本用同一環境（Chromium 高畫質）截圖對照。
- 已知限制：CI 的 WebKit 軟體繪圖在高畫質近距離時可能截到空白，近距離對照改用 Chromium。

## 10. 版本管理與驗收紀錄

1. 每個美術版本一個分支：`feature/render-<assetId>-<版本>`，從上一個已驗收版本分出。
2. 新版本只新增檔案（模型、材質外掛、美術腳本），舊版本保留；測試頁可用 `?lab=` 切換版本對照。
3. 每版在 `docs/monsters/<monster>-versions.md` 記錄：改了什麼、鎖定規格、模型數據、自動化結果、iPhone 實測、使用者驗收結論。
4. 回退方式：預覽網址與分支都還在，直接指回上一版分支即可；正式版 main 只有在使用者驗收後才合併。
5. 驗收交付固定包含：預覽網址、三視圖對照（原圖／上一版／本版）、表情圖、三種畫質數據、自動化報告、iPhone 測試網址、未完成項目。

---

## 不同種類怪物的注意事項

| 種類 | 造型方式建議 | 材質重點 | 動畫 | 常見效能風險 |
|---|---|---|---|---|
| 果凍系（星露啵啵） | 程式化 SDF 或手工，單一無縫網格 | 半透明外掛、內部光、表情貼圖 | 姿勢曲線（伸縮） | 透明覆蓋像素多 |
| 動物系 | Blender 手工建模＋骨骼 | 毛皮用貼圖＋邊緣光，不做逐根毛 | 骨骼動畫片段 | 骨骼數、毛邊透明貼片 |
| 植物系 | 手工；葉片用少量透明貼片 | 樹皮／葉片貼圖、風擺放在頂點 | 節點或骨骼 | 透明葉片疊太多層 |
| 骷髏系 | 手工＋骨骼；骨頭可共用零件 | 骨頭不透明、發光眼睛用光暈貼片 | 骨骼 | 零件太碎造成 Draw Calls |
| 機械系 | 手工硬邊，零件合併 | 金屬用環境貼圖反射、發光線條 | 節點動畫（零件旋轉） | 零件過多、反射探針 |
| 巨龍系 | 手工＋骨骼，翅膀薄片要有厚度 | 鱗片法線貼圖、翼膜半透明 | 骨骼（翅膀骨多） | 尺寸大、覆蓋像素多 |
| 頭目 | 依種類；可多零件 | 可用較高預算與專屬特效 | 多階段動畫 | 特效粒子、全畫面效果 |

**一定要個別處理**：造型、貼圖、材質外掛的參數、動作曲線或骨骼動畫、表情清單、特效。
**不需要重做**：載入／釋放、命名與預算檢查、表情 UV 切換、效能測試、截圖、版本流程。
