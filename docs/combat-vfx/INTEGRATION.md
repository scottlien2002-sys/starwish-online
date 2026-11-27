# Combat VFX Stage 1｜給 Claude A、Claude D 的整合介面

作者：Claude C　分支：`feature/combat-vfx-stage1`　預覽：`/preview-combat-vfx/?lab=combat`

> 本階段技能只是技術展示：技能名稱、倍率、冷卻、怪物血量都是測試值，不代表正式職業技能與數值。
> 角色使用已驗收的 C1.0-B5b 男女初心者（`novice_c10b5b_*`），沒有使用 Tripo 組裝角色。

## 1. 檔案與分層

| 路徑 | 內容 | 依賴 |
|---|---|---|
| `src/combat-vfx/core/skills.ts` | 技能資料格式＋6 個展示技能 | 無（純資料） |
| `src/combat-vfx/core/timeline.ts` | `SkillTimeline`：動作／特效／傷害共用的時鐘、頓幀、根運動 | 無 |
| `src/combat-vfx/core/quality.ts` | 高／中／低三段特效品質 | 無 |
| `src/combat-vfx/core/budget.ts` | `VfxBudget`：多人同場特效數量限制 | 無 |
| `src/combat-vfx/core/damage.ts` | `CombatResolver` 介面、`DemoResolver`（展示用）、`skillRate`（攻速→播放倍率，上限 160） | `core/rules.ts` |
| `src/combat-vfx/fx/VfxSystem.ts` | 特效生成（物件池、GlowLayer、投射物） | Babylon |
| `src/combat-vfx/fx/WeaponTrail.ts` | 武器殘影 | Babylon |
| `src/combat-vfx/fx/DamageNumbers.ts` | 傷害數字（DOM） | Babylon（投影） |
| `src/combat-vfx/fx/CombatAudio.ts` | 戰鬥音效（WebAudio 合成，沒有音檔） | 瀏覽器 |
| `src/combat-vfx/fx/CameraFx.ts` | 鏡頭震動 | Babylon |
| `src/combat-vfx/CombatAvatar.ts` | 初心者＋技能動畫＋武器掛點 | Babylon |
| `public/combat-vfx/novice_combat_{male,female}.json` | 6 個技能動作（17 骨，30 fps）＋時間標記＋根運動＋武器掛點 | — |
| `tools/combat-vfx/novice_skills.py` | 動作產生腳本（可重現；改動作改這裡再重跑） | Python＋numpy |

`core/` 不依賴 Babylon，可以在 Node 單元測試，也可以直接給伺服器（Claude D）用來驗證技能時間。

## 2. 技能資料格式（六大職業共用）

```ts
interface SkillDef {
  id: string; label: string; classTags: ClassId[];      // novice | swordsman | knight | blacksmith | mage | priest | clown
  weapon: "sword" | "staff"; clip: string;              // 動作檔裡的片段名稱
  aspdScaled: boolean;                                  // true：受攻速影響（上限 160 → 1.6 倍）
  range: number; cooldown: number; jumps?: boolean; faceTarget: boolean;
  palette: "steel" | "azure" | "star" | "gold" | "rose";
  events: SkillEvent[];                                 // 時間可寫秒數或動作檔標記名（"hit1"、"trail1.0"）
}
```

事件種類：`trail`（殘影開始／結束）、`fx`（特效鍵值＋錨點 self／target／weapon／front）、`sfx`、`shake`、
`hit`（傷害判定：cone／circle、倍率、命中特效、頓幀毫秒、強制暴擊）、`projectile`（魔法彈／劍氣波／隕星，抵達時判定）。

特效鍵值（`FxKey`）：slashArc、slashArcRise、slashArcBig、swordWave、whirlRing、magicCircle、magicCircleBig、chargeAura、
gatherMotes、magicBolt、meteor、shockwave、areaBlast、starBurst、hitFlash、hitSpark、critBurst、dustRing、boltImpact、groundGlow。
新增職業技能＝新增一筆 `SkillDef`＋（需要時）新的動作片段；換顏色只改 `palette`。

## 3. 同步規則（動作、特效、傷害）

- 一個技能只有一個時鐘：`SkillTimeline.advance(dt)` 回傳這一格觸發的事件。
- 角色動作每格用 `CombatAvatar.setSkillTime(timeline.t)` 對齊（不是讓動畫自己跑），所以命中那一格的動作姿勢、特效、傷害數字一定同一格。
- 近戰命中：在 `hit` 事件那一格結算。投射物：在投射物抵達那一格結算（傷害不依賴特效；投射物特效被預算拒絕時照樣結算）。
- 打擊頓幀：`timeline.hitstop(ms)` 暫停技能時鐘（動作、殘影、後續事件一起停）；被打的怪物動畫同時暫停。
- 攻速：`skillRate(aspdScaled, 攻速)` = 攻速／100，最多 1.6（攻速上限 160，沿用 `core/rules.ts` 的 `clampAttackSpeed`）。
- 每段命中以 `castId + hitId + targetId` 防止重複結算（`DemoResolver` 已示範）。

## 4. 給 Claude A（遊戲核心／戰鬥／角色）

1. 戰鬥結算：實作 `CombatResolver.resolve(ctx, targetHp)`，把正式公式放進去；展示頁的 `DemoResolver`（攻擊 40、暴擊 20%×1.6）只是測試值。
2. 角色：`CombatAvatar` 示範如何把技能 JSON 建成 AnimationGroup 加到既有 C1.0-B5b 角色上（`buildGroup`），可以搬進 `NoviceAvatar`：
   - 骨名稱相同（17 骨），男女各一份 JSON（骨長不同，已分別烘焙）
   - 根運動（`rootMotion` 每格「前進距離、轉向」）請套在玩家節點上，不是 hips；伺服器位置也用這個值
3. 武器：`weaponAttach`（手骨座標系的刀身方向、刃面方向）＋`attachWeapon()`。正式武器 GLB 只要「握把在原點、+Y 為刀身」就能直接換掉展示武器。
4. 技能可跳躍：跳躍只在技能動作裡（跳斬），一般移動沒有跳躍按鈕；跳斬落點 = 起點＋面向×1.2 m。
5. 怪物：展示頁直接用 Claude A 的 `RiggedMonsterVisual`（M004～M007）。受擊用 `onHitReaction({stagger:0})`（普通攻擊不硬直，符合 5.3 規則），閃白用 `applyPose({hitFlash})`。

## 5. 給 Claude D（多人）

- **伺服器權威**：客戶端只送「施放請求（skillId、targetId、面向、時間戳）」；伺服器用同一份 `core/skills.ts`＋`SkillTimeline` 算命中時間，結算後廣播
  `{castId, casterId, skillId, startTime, rate, targetId, hits:[{hitId, targetId, damage, crit, at}]}`。
- 其他玩家的客戶端收到後用同一個 `castId` 播動作與特效（`owner:"other"`），傷害數字直接顯示伺服器結果，不自己算。
- **特效數量限制**：`VfxBudget`（每段品質有上限）
  | 品質 | 同時特效 | 粒子總量 | 其他玩家佔比 | 其他玩家粒子倍率 |
  |---|---|---|---|---|
  | 高 | 48 | 2,400 | 45% | 0.5（隊友 0.75） |
  | 中 | 32 | 1,200 | 45% | 0.5 |
  | 低 | 18 | 500 | 45% | 0.5 |
  - 超過 28 m 的其他玩家特效不生成；次要層（餘燼、碎石）在用量 70% 以上先被拒絕；命中閃光永遠允許。
  - 音效最多 14 個同時發聲，其他玩家音量 0.3～0.35。
  - 這些值都在 `DEFAULT_POLICY`／`VFX_QUALITY`，可依實機調整。

## 6. 品質設定（`VFX_QUALITY`）

| | 高 | 中 | 低 |
|---|---|---|---|
| 粒子倍率 | 1.0 | 0.55 | 0.25 |
| 殘影段數 | 22 | 14 | 8 |
| GlowLayer | 開（0.5 解析度） | 開（0.35） | 關 |
| 第二層細節 | 開 | 開 | 關 |
| 程式貼圖 | 256 | 128 | 64 |
| 解析度上限（DPR） | 2 | 1.5 | 1.25 |
| 傷害數字上限 | 40 | 28 | 16 |

三段品質的命中時間、傷害完全相同，只差畫面。

## 7. 展示頁網址參數

`?lab=combat&q=high|medium|low&g=male|female&lod=hq|lite&auto=1&multi=N&aspd=100~250&mute=1`
自動測試介面：`window.__cvfx`（cast、setTier、setMulti、setAspd、stats、perf、sync 紀錄）。
