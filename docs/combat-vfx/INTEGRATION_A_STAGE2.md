# Combat VFX Stage 2｜Claude A 戰鬥整合文件

作者：Claude C　分支：`feature/combat-vfx-stage2`　預覽：`/preview-combat-vfx-s2/?lab=combat`
怪物資產：`assets/monster-rigs-m002-m007`（見 `docs/monsters/CLAUDE_C_DELIVERY_M001-M007.md`）

> 技能、倍率、冷卻、怪物血量都是技術展示用測試值；六大職業只建立共用架構與展示方向，正式技能、武器限制、數值都還沒定案。
> 角色一律用已驗收的 C1.0-B5b 男女初心者；沒有使用 Tripo 零件組裝角色，臉型、髮型、服裝、比例都沒有改。

## 1. 這一階段新增／變更的檔案

| 路徑 | 內容 | 依賴 |
|---|---|---|
| `public/combat-vfx/novice_combat_{male,female}.json` | **動作 V2**（version 2.0）：6 個技能重做；格式、片段名稱、命中標記不變 | — |
| `tools/combat-vfx/novice_skills_v2.py` | V2 動作產生腳本（關鍵姿勢、重心、腰肩、踏步、蓄勢、收招） | Python＋numpy＋scipy |
| `public/models/novice_c10b5b_{male,female}_remote.glb` | **其他玩家專用**合併模型：26 個網格→2 個（臉＋身體），骨架／動畫與 Lite 完全相同 | — |
| `tools/combat-vfx/make_remote_lod.py` | 產生 remote 模型（Lite 改版後重跑即可） | Python＋numpy |
| `src/combat-vfx/core/classes.ts` | 六大職業共用架構：動畫分類、特效家族、展示組合 | 無 |
| `src/combat-vfx/core/terrain.ts` | `TerrainQuery`：技能根運動、突進、跳躍落點、擊退的可通行判定 | 無 |
| `src/combat-vfx/core/monsterRules.ts` | Lv1～4 被動、Lv5 以上主動、Lv1～10 無屬性 | 無 |
| `src/combat-vfx/fx/VfxSystem.ts` | 特效 V2：多層特效、共用材質、白天模式、其他玩家簡化 | Babylon |
| `src/combat-vfx/fx/WeaponTrail.ts` | 三層刀光（主色＋白色刀鋒＋殘像）；其他玩家只畫一層 | Babylon |
| `src/combat-vfx/fx/DamageNumbers.ts`、`ScreenFx.ts` | 傷害數字 V2（彈出、拋物線、疊字、暴擊震動）、暴擊閃光／受傷紅框 | DOM |
| `src/combat-vfx/weapons.ts` | 武器材質共用；其他玩家的武器合併成 1 個網格 | Babylon |

`core/` 依然不依賴 Babylon（可在 Node 測、也可以給伺服器用）。

## 2. 角色戰鬥動畫 V2（怎麼接）

- 片段名稱、17 骨、`weaponAttach`、`rootMotion`、`marks` 格式都沒變；Stage 1 的接法（`CombatAvatar.buildGroup` → AnimationGroup，用 `setSkillTime` 對齊時間軸）照用。
- 命中標記維持：三連斬 0.17／0.50／0.92、跳斬 0.80、旋風 0.48／0.76／1.04、蓄力 1.22、魔法彈釋放 0.58、星隕釋放 0.72。
- 動作內容：每個技能都有蓄勢 → 出招 → 命中 → 收招；腰（hips）先轉、肩（chest）晚約 2 格、頭與左手晚 3～4 格；
  重心往支撐腳移動並隨之側傾；腳步是「著地點」：踏步時抬腳走弧線，著地後在世界座標固定，不會隨根運動滑動
  （每 1/120 秒的著地腳漂移 < 2.4 mm；旋風斬原地轉身例外，以腳掌為軸）。
- 三連斬片段長度 1.45 → 1.50 秒（多了收招停留）。請從 JSON 的 `duration` 取值，不要寫死。

## 3. 技能不能穿越不可通行地形

```ts
interface TerrainQuery {
  canStand(x: number, z: number, radius: number): boolean;
  clampMove(from: {x,z}, to: {x,z}, radius: number): {x,z};   // 被擋住就停在障礙物前；跳躍也不能穿過
}
```
- 展示頁每格：`期望位置 = 起點 + 面向 × rootMotion.forward` → `clampMove(目前位置, 期望位置)`。
- 一般移動、怪物擊退、怪物追擊都走同一個介面。
- 遊戲裡請用地圖的可行走判定實作 `TerrainQuery`（navmesh／碰撞），伺服器也用同一個判定（見 D 文件）。

## 4. 怪物整合（M002～M007）

- 規格：`src/combat-vfx/lab/monsterSpecs.ts` 的 `M002_MOSS_HORN_BEAST`、`M003_CLOUD_FLUFF_BIRD`（格式＝你的 `RiggedMonsterSpec`）。
- 行為規則：`behaviourForLevel(level)`、`wantsTarget(level, 距離, aggro, 警戒半徑)`、`onDamaged(aggro)`（被打 8 秒仇恨）。
  展示頁：主動怪警戒 4.5 m（Boss 7 m）、離出生點 9 m（Boss 12 m）放棄回家。數值都是建議值。
- 受擊反應 V2：`onHitReaction({stagger:0})`（站立時播 Hurt）＋閃白 `applyPose({hitFlash})`＋擊退
  （距離 = 0.12 + 震動強度×0.75 m，最多 0.7 m；Boss ×0.25；暴擊 ×1.3；0.12 秒內衰減；地形擋住）＋頓幀時怪物動畫暫停。
- 追擊／回家用 `onStateEnter("move")`＋`setGroundSpeed(m/s)`，你的 `chooseLocomotion` 會自動選 Move／Run。

## 5. 特效系統 V2（怎麼用）

- 生成：`vfx.spawn(鍵值, 位置, { owner, palette, yaw, scale, duration, follow })`；命中：`vfx.hitFx(位置, 鍵值[], 暴擊)`。
- 新鍵值：`hitRing`、`starShards`、`debris`、`groundCrack`、`chargeRings`、`chargeFlash`、`lightPillar`，以及職業預留的
  `lightShield`、`shieldBash`、`thrustLine`、`forgeSparks`、`healAura`、`buffOrbit`、`propBurst`。
- 環境：`vfx.setEnvironment("dark" | "bright")`。白天地圖（星芽原野）請用 `bright`：彩色層改一般混合＋飽和色，白色核心維持加算發光；
  武器殘影 `trail.setBright(true)`。
- 暴擊畫面閃光：`vfx.onCrit = () => screenFx.flashCrit()`（只有自己的暴擊）。
- 地面類特效（shockwave、groundCrack、dustRing、debris、lightPillar）請給地面高度。

## 6. 六大職業共用架構（`core/classes.ts`）

| 職業 | 動畫分類（待製作） | 特效家族（共用鍵值） | 目前可代表的展示技能 |
|---|---|---|---|
| 劍士 | 連斬、重斬、劍氣、突進斬 | 劍氣、連斬、重斬 | 三連斬、旋風、蓄力 |
| 騎士 | 盾擊、突刺、架盾、嘲諷 | 盾擊、突刺、防禦光盾 | 跳斬、蓄力 |
| 鐵匠 | 重錘下砸、旋轉錘、震波、鍛造 | 重錘（裂地、碎石、火花）、震波、重擊 | 跳斬、蓄力 |
| 法師 | 詠唱、魔法彈、範圍魔法、瞬移 | 元素魔法（換色）、魔法陣、範圍爆破 | 魔法彈、星隕 |
| 祭司 | 治療、聖光、祝福、復活 | 治療、聖光、輔助效果 | 魔法彈 |
| 小丑 | 快速連擊、幻影、道具、翻滾 | 快速連擊、幻影、特殊道具 | 三連斬、旋風 |

正式技能＝新增一筆 `SkillDef`（動作片段＋時間軸事件）；特效系統與戰鬥程式都不用改。武器限制尚未定案，`plannedWeapons` 只是規劃。

## 7. 效能（給 A 整合時採用）

- 其他玩家：用 `novice_c10b5b_*_remote.glb`＋簡化武器（`buildSword(scene, id, true)`）＋一層殘影；自己的角色維持 HQ／Lite。
- 材質全部共用（GLB 容器 `instantiateModelsToScene(..., false)`、武器、陰影、特效）；**角色 `dispose` 不要連材質一起丟**（Stage 1 的寫法會把共用材質刪掉，已修正）。
- 其他玩家的特效自動簡化（只畫主層、粒子 ×0.6、受多人預算限制）；`vfx.remoteSimplify = false` 可關掉（只用於效能比較）。
- 數字見 `docs/combat-vfx/REPORT_STAGE2.md` 的效能比較。

## 8. 遊戲規則對照

| 規則 | 落實位置 |
|---|---|
| 攻速上限 160 | `skillRate()` → `clampAttackSpeed`；E2E 以攻速 250 驗證實際依 160 播放 |
| 一般移動沒有跳躍按鈕；技能可跳躍、突進、空中攻擊 | 展示頁沒有跳躍鍵；跳斬（空中下劈）、蓄力（突進）、三連斬第三段（小跳） |
| 技能不得穿越不可通行地形 | `TerrainQuery.clampMove`；E2E 面向岩石施放跳斬 |
| 動畫、特效、命中與傷害同步 | 單一 `SkillTimeline` 時鐘；E2E 檢查命中格的動作時間與傷害數字同格 |
| Lv1～4 被動反擊、Lv5 以上主動 | `monsterRules.ts`；E2E 實測 |
| Lv1～10 無屬性 | `elementForLevel()` |
| 多人由伺服器決定正式傷害 | `CombatResolver` 介面；見 Claude D 文件 |
