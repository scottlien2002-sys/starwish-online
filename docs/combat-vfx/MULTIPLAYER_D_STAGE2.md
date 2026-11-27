# Combat VFX Stage 2｜Claude D 多人戰鬥事件同步文件

作者：Claude C　分支：`feature/combat-vfx-stage2`

> 原則：**伺服器決定正式傷害結果**。用戶端只負責「播放」：動作、特效、音效、傷害數字都照伺服器的結果演出。
> 技能資料（`core/skills.ts`）與時間軸（`core/timeline.ts`）不依賴 Babylon，伺服器可以直接 import 同一份程式算命中時間。

## 1. 事件流程

```
用戶端                               伺服器                                其他用戶端
 cast_request ─────────────────────▶ 驗證（冷卻、距離、地形、攻速上限 160）
                                    建立 castId、決定 rate、startTime
 ◀──────────── cast_start ─────────┼──────────── cast_start ─────────────▶ 播動作＋前段特效（owner:"other"）
 （自己：預測播放，收到後對齊）      依 SkillTimeline 在每個 hit 時間點結算
 ◀──────────── cast_hit ───────────┼──────────── cast_hit ───────────────▶ 命中特效＋傷害數字（顯示伺服器數值）
 ◀──────────── cast_end ───────────┼──────────── cast_end ───────────────▶ 收招（或被打斷）
```

## 2. 訊息格式（建議）

```ts
// 用戶端 → 伺服器
type CastRequest = { t: "cast_request"; seq: number; skillId: string; targetId: string | null; yaw: number; pos: [number, number]; clientTime: number };

// 伺服器 → 全部（施放開始）
type CastStart = {
  t: "cast_start"; castId: number; casterId: string; skillId: string; targetId: string | null;
  start: [number, number]; yaw: number;   // 根運動起點與面向（伺服器確認過的位置）
  rate: number;                           // 播放倍率 = clampAttackSpeed(攻速)/100，最多 1.6
  serverTime: number;                     // 開始時間（用戶端依延遲補時間軸）
  rootEnd?: [number, number];             // 根運動被地形擋住時的終點（伺服器 clampMove 的結果）
};

// 伺服器 → 全部（每一段命中）
type CastHit = {
  t: "cast_hit"; castId: number; hitId: string;          // hitId = SkillDef 裡的 HitSpec.id（s1、s2、slam…）
  results: { targetId: string; damage: number; crit: boolean; killed: boolean; knock?: [number, number] }[];
  at: [number, number, number];                          // 命中位置（投射物抵達點、範圍中心）
  serverTime: number;
};

type CastEnd = { t: "cast_end"; castId: number; reason: "done" | "interrupted" | "cancelled" };
```

- **防重複**：同一 `castId + hitId + targetId` 只能結算一次（展示頁的 `DemoResolver` 用同一規則）。
- **投射物**：伺服器算飛行時間（距離 ÷ 速度），到達時送 `cast_hit`；用戶端的投射物只是畫面，抵達時若還沒收到 `cast_hit` 就先播特效、數字等訊息到了再顯示。
- **地形**：伺服器用同一套 `TerrainQuery`（地圖的可行走判定）對根運動做 `clampMove`，結果放在 `rootEnd`；用戶端也會自己 clamp，兩邊一致。
- **攻速**：`rate` 由伺服器算（`skillRate`），攻速超過 160 一律 1.6 倍；用戶端只用收到的值。

## 3. 用戶端怎麼播

| 收到 | 自己 | 其他玩家（`owner:"other"`） |
|---|---|---|
| `cast_start` | 已預測播放就對齊 `castId`；被拒絕時中斷並回到 Idle | `SkillTimeline(skill, clip, rate)`，用 `serverTime` 與目前時間差 advance，追上進度 |
| 時間軸 `fx`／`sfx`／`trail` 事件 | 照播 | 照播（特效自動簡化；音量 0.3） |
| 時間軸 `hit` 事件 | **不結算**，等 `cast_hit` | 不結算 |
| `cast_hit` | 傷害數字、命中特效、震動、頓幀、怪物受擊反應 | 命中特效（受多人預算限制）、傷害數字（只顯示自己隊伍時可選） |

延遲補償：`cast_hit` 早於本地 hit 時間點到達時，先存起來到本地時間軸走到 hit 才演出；晚到超過 0.25 秒就立刻演出（不倒退動作）。

## 4. 多人特效數量限制（`core/budget.ts`＋`core/quality.ts`）

| 品質 | 同時特效上限 | 粒子總量 | 其他玩家佔比 | 其他玩家粒子 |
|---|---|---|---|---|
| 高 | 48 | 2,400 | 45% | 隊友 0.75／其他 0.5，再 ×0.6（Stage 2 簡化） |
| 中 | 32 | 1,200 | 45% | 同上 |
| 低 | 18 | 500 | 45% | 同上 |

- 自己的命中閃光、暴擊一律允許；**其他玩家的命中閃光也受份額限制**（Stage 2 修正：原本會繞過上限）。
- 超過 28 m 的其他玩家特效不生成；用量 70% 以上時次要層（餘燼、碎石、星光碎片、收束環）先拒絕。
- 其他玩家只畫主層（劍氣沒有白色核心與柔光層、魔法陣沒有內圈與符文環、投射物沒有緞帶尾跡、殘影一層）。
- 暴擊畫面閃光、鏡頭震動、打擊頓幀只給自己。

## 5. 其他玩家的模型（效能）

- 模型：`novice_c10b5b_{g}_remote.glb`（2 個 draw call；Lite 是 26 個）＋合併武器（1 個 draw call）＋共用陰影材質。
- 外觀與 Lite 相同（頂點、顏色、骨架、動畫一致）；只有金屬飾邊在遠處不再有金屬光澤。
- 實測（CI 軟體繪圖，Draw Call／三角面／粒子／記憶體）見 `REPORT_STAGE2.md`；**iPhone 實機數字未驗證**。

## 6. 建議的同步頻率
- 位置：10～15 Hz 內插即可；技能期間位置由根運動決定，不用逐格同步。
- `cast_start`／`cast_hit`／`cast_end` 事件即時送。
- 16 人同場時，距離 28 m 以外的玩家只同步位置與狀態，不送特效相關事件（用戶端也不生成）。
