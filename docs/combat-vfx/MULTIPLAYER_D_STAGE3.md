# Combat VFX Stage 3｜Claude D 多人戰鬥文件（32 人預算＋遠距離 LOD）

作者：Claude C　分支：`feature/combat-vfx-stage3`

> Stage 2 的事件流程與訊息格式（`MULTIPLAYER_D_STAGE2.md`：`cast_request`／`cast_start`／`cast_hit`／`cast_end`）**不變**，伺服器仍決定正式傷害。
> 本文件只補 Stage 3：32 人同場的用戶端預算、遠距離 LOD、音效、職業技能草稿的資料欄位。

## 1. 用戶端每位其他玩家的成本（Stage 3）

| 項目 | 近距離（< 13～14 m） | 遠距離（> 14 m） |
|---|---|---|
| 角色 draw call | 2（臉＋身體） | 2（臉＋身體） |
| 角色三角面 | 約 40,000 | 約 16,500～17,800 |
| 武器 | 1 個合併網格 | 同左 |
| 腳下陰影 | 1（共用材質） | 同左 |
| 特效 | 只畫主層、粒子 ×0.6、受多人預算 45% 份額 | 同左；超過 28 m 不生成 |
| 音效 | 音量 0.3～0.35，依畫面左右 pan | 同左（同時發聲上限 14） |

切換距離以「鏡頭到角色」計算，有 1 m 緩衝。**這是純畫面設定，不影響伺服器、不需要同步。**

## 2. 32 人預算建議

固定鏡頭量測（8 欄 × 4 排、同一鏡頭、同一可見人數；數字見 `REPORT_STAGE3.md`）。

- 同步：位置 10～15 Hz 內插；技能期間位置由根運動決定。`cast_*` 事件即時送。
- 興趣範圍：
  - 28 m 內：完整 `cast_start`／`cast_hit`／`cast_end`（播動作、特效、音效）。
  - 28 m 以外：只送位置與狀態（用戶端也不生成特效）。
  - 建議每位用戶端同時「完整演出」的其他玩家最多 16 人（依距離排序），其餘只播動作不播特效與音效；32 人都在 28 m 內時由用戶端的特效預算自動降級。
- 頻寬（粗估）：位置封包約 20 bytes × 15 Hz × 32 人 ≈ 9.6 KB/s 下行；技能事件很小、只在施放時送。
- 伺服器端不需要知道 LOD；LOD 只用鏡頭距離決定。

## 3. 技能草稿的資料欄位（`core/classKits.ts`）

職業技能還沒定案，但資料格式已固定。伺服器可以直接 import 同一份（純 TypeScript、不依賴 Babylon）：

```ts
interface DraftSkill extends SkillDef {
  draft: { template: "combo" | "charge" | "projectile" | "aoe" | "buff" | "dash"; kit: CombatClassId;
           tbd: ("name" | "damage" | "cooldown" | "weaponLook")[]; category: AnimCategory; plannedClip: string };
}
```

- `cast_hit.hitId` 仍是 `HitSpec.id`（樣板產生：連擊 `c1..cN`、蓄力 `charged`、投射 `proj`、範圍 `aoe`、突進 `dash`）。
- 增益樣板（`buffTemplate`）沒有 `hit` 事件：效果與數值由伺服器規則決定（未定案）；用戶端只播 `cast`／`apply` 的畫面與音效。
- 伺服器上線前也可以跑 `validateSkillDef(def, clip)`，確保標記與命中 id 正確。
- `draft.tbd` 不為空的技能代表「名稱／傷害／冷卻／武器外觀」尚未定案，請不要當正式數值。

## 4. 旋風斬動作 V2.1
- 只改腳步（腳踩世界座標固定點），根運動（前進 0.25 m、轉 2 圈）與命中標記（0.48／0.76／1.04）不變，所以伺服器的命中時間計算不用改。

## 5. 未驗證
- iPhone Safari 實機的 32 人 FPS、記憶體、發熱（**未驗證**；CI 數字是無 GPU 軟體繪圖，只能比較相對差異）。
- 實際網路延遲下的 `cast_hit` 補償（需要 D 的伺服器）。
