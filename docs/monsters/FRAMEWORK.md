# 通用怪物系統 Monster Framework V1.0

目標：新增一隻怪物時，只需要「怪物資料 + 視覺模型 + 動畫設定」，不需要修改核心系統。

## 架構

```
             ┌──────────────┐   位置/朝向/移動/攻擊請求    ┌──────────────────┐
目標(玩家) → │ MonsterBrain │ ─────────────────────────→ │ MonsterInstance  │
             │   （AI）      │                             │ 血量・位置・冷卻  │
             └──────────────┘                             │ MonsterStateMachine│
                                                          └────────┬─────────┘
                                                                   │ 狀態
                                                          ┌────────▼─────────┐
                                                          │ MonsterAnimator  │ ← MonsterAnimationProfile
                                                          │ 姿勢・特效・完成事件│   （時長、速度、曲線、特效時間）
                                                          └────────┬─────────┘
                                                                   │ IMonsterVisual 介面
                                              ┌────────────────────┴───────────────────┐
                                     ProceduralVisual                          ClipMonsterVisual
                                  （程式化變形：星露啵啵）            （GLB 骨骼/節點動畫：測試方塊、未來四足怪）
```

- `src/monsters/framework/` **完全不依賴 Babylon.js**（可在 Node 測試、未來伺服器端執行）
- AI 只改 MonsterInstance，**不碰模型、材質、動畫、粒子**
- 視覺只讀資料，**不改遊戲狀態**
- MonsterController 把以上串起來，每幀 `update(dt, now, target)`

## 模組對照

| 需求名稱 | 檔案 |
|---|---|
| MonsterDefinition | `src/monsters/framework/types.ts`（型別）、`src/config/monsters.ts`（資料） |
| MonsterInstance | `src/monsters/framework/MonsterInstance.ts` |
| MonsterStateMachine | `src/monsters/anim/MonsterStateMachine.ts`（沿用既有，衝突規則不變） |
| IMonsterVisual | `src/monsters/framework/types.ts`、`visuals.ts`（ProceduralVisual / ClipMonsterVisual） |
| MonsterAnimationProfile | `src/monsters/framework/types.ts`、`profiles.ts`（播放速度、通用片段姿勢） |
| MonsterFactory | `src/monsters/framework/MonsterFactory.ts` |
| 怪物 AI | `src/monsters/framework/MonsterBrain.ts` |
| 註冊表 | `src/monsters/framework/registry.ts`、`index.ts`（createMonsterRegistry） |
| Babylon 模型註冊 | `src/monsters/babylon/registerVisuals.ts` |

## 狀態衝突規則（沿用，未修改）

- 攻擊中：不能再攻擊、移動排隊；受傷只閃白不中斷
- 死亡：可中斷待機/移動/攻擊/受傷；死亡中與已死亡不接受移動、攻擊、受傷
- 重生：只能在死亡動畫播完後；重生中無敵；重生回滿血、回出生點

## AI 行為

| 模式 | 條件 |
|---|---|
| idle / patrol | 沒有目標：待機 1.5~3.5 秒後在 patrolRadius 內隨機巡邏 |
| chase | 目標進入 aggroRange |
| attack | 進入 attackRange；依 attackCooldown 攻擊 |
| return | 目標離開（超過 aggroRange × 1.5）或被拉出 leashRange；回到出生點後恢復巡邏 |
| dead | 死亡後停止行動 |
| respawn | 死亡動畫播完 respawnTime 秒後重生 |

攻擊、受傷動作播放中不移動。

## 新增一隻怪物的步驟

1. **資料**：在 `src/config/monsters.ts` 加一筆 MonsterDefinition（monsterId、數值、modelId、animationProfileId）。
2. **動畫設定**：
   - GLB 骨骼動畫：仿照 `src/monsters/test-dummy/profile.ts`，填寫各狀態對應的動畫名稱、是否循環、播放速度、片段長度、特效時間點。
   - 程式化：仿照 `src/monsters/star-dew-bobo/profile.ts`，提供各狀態的姿勢曲線。
   然後在 `src/monsters/framework/index.ts` 的 `createMonsterRegistry()` 加一行 `.addProfile(...)`。
3. **模型**：
   - GLB：檔案放到 `public/models/`，在 `src/monsters/babylon/registerVisuals.ts` 加一行 `addVisual(modelId, ... createGltfVisual(...))`。
   - 程式化：寫一個實作 MonsterView 的模型類別，用 `ProceduralVisual` 包起來註冊。
4. **測試**：`npm test` 會自動驗證資料欄位與動畫設定；在 `src/main.ts` 的 `LAB_MONSTER` 加一筆即可用 `?lab=xxx` 開測試頁。

不需要修改：狀態機、MonsterInstance、MonsterBrain、MonsterController、MonsterFactory。

## 測試頁

- `?lab=bobo` 星露啵啵（程式化模型）六種動作
- `?lab=dummy` 測試方塊（GLB 節點動畫）六種動作
- `?lab=field` 3 隻星露啵啵 + 2 隻測試方塊，同時由 AI 控制；藍色膠囊為測試目標

## 測試方塊（test_dummy）

僅供程式測試，**不是苔角獸或任何正式怪物**。GLB 由 `tools/make-test-dummy-glb.mjs` 產生（`npm run make:test-glb`），
與星露啵啵使用不同的動畫方式（GLB 節點動畫片段）、不同時長、不同特效時間點、受傷 1.5 倍速。

## 尚未完成

- 戰鬥傷害公式、玩家攻擊怪物、怪物攻擊命中玩家（W2）
- 掉落表（dropTableId 已預留；W3）
- 怪物放入 W1 新手草原（目前只在測試頁）
- 星露啵啵戰鬥數值為暫定（provisional），待企劃提供
- 返回出生點時是否回血、仇恨表、多目標：尚未設計
- 多隻同款 GLB 怪物目前各自載入一次檔案（瀏覽器有快取），未來可改為共用一份實例化
