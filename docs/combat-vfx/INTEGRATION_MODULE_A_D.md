# Combat VFX 正式接入模組（給 Claude A、Claude D）

作者：Claude C　分支：`feature/combat-vfx-stage3`　入口：`src/combat-vfx/integration/index.ts`
穩定備份：Stage 3.1 `backup/combat-vfx-stage3.1-stable`（142fa71）、接入模組 `backup/combat-vfx-integration-ready`（556fee8）、n75 相容 `backup/combat-vfx-n75-compat`（69a0baa）、Stage 7.5 修正版 `backup/combat-vfx-stage75-fixes`（見交付文件）　部署：暫停中（`.github/cvfx-deploy-hold`）

> 只負責**畫面與音效**：不扣血、不判斷命中與暴擊、不送網路封包。這些由 A 的戰鬥規則或 D 的伺服器結果決定，再呼叫本模組畫出來。
> 技能名稱、數值、正式技能配置**未定案**。`SKILLS` 是 6 個展示技能；`classKits.ts` 的樣板只是草稿。

## 1. 一張地圖一個實例

```ts
import { CombatFx } from "../combat-vfx/integration/index.ts";

const fx = new CombatFx({
  scene, camera, hudRoot, tier: "medium", env: "bright",   // 星芽原野用 bright
  ground: (x, z) => terrain.heightAt(x, z),                // 地形高度（不給＝y 0 平地）；換地圖用 fx.setGround(fn)
});

// 開機順序（一定要照這個順序，見第 4 節）
await scene.whenReadyAsync();                         // ① 場景（地形、角色、怪物）就緒
await fx.prewarm();                                   // ② 預熱（仍在載入畫面中）
engine.runRenderLoop(() => scene.render());           // ③ 開始遊戲迴圈
canvas.addEventListener("pointerdown", () => fx.unlockAudio(), { capture: true, once: true });

scene.onBeforeRenderObservable.add(() => {
  const dt = engine.getDeltaTime() / 1000;
  fx.listener.copyFrom(localPlayer.position);         // 本地玩家位置（距離預算、音效左右聲道）
  fx.advance(dt);                                     // ① 技能時間軸前進、觸發命中／投射物 hook
  avatar.setSkillTime(handle.timeline.t);             // ② 角色動作用「同一個 t」設定這一格的姿勢（A 的 NoviceAvatar）
  const shake = fx.updateVisuals(dt);                 // ③ 拖尾取樣（刀尖已是這一格的位置）、特效、傷害數字
  camera.target.addInPlace(shake);                     // 鏡頭震動（要不要加由 A 決定；不影響判定）
});
// 不需要動作同步時（只有特效），可以只呼叫 fx.update(dt)＝advance＋updateVisuals

// 離開地圖
fx.dispose();
```

## 2. 功能對照

| 功能 | API | 說明 |
|---|---|---|
| 角色登記 | `register({ id, owner, root, position, yaw, weaponBase, weaponTip, weaponFocus?, target? })`／`unregister(id)` | `owner`：`"self"`（本地）／`"party"`（隊友）／`"other"`（其他玩家）。只讀位置，不改角色 |
| 技能施放特效 | `playSkill(id, skillDef, clipTiming, rate, { onHit, onProjectile, onEnd })` | 依動作檔時間標記播放特效、音效、拖尾、震動。命中時間到了呼叫 `onHit(hitSpec)`，**由遊戲判定打到誰** |
| 普通攻擊 | `basicSwing(id, palette, seconds, sfx)` 或 `playSkill` | 沒有技能定義時：拖尾＋揮擊音效 |
| 武器拖尾 | 自動（`register` 時提供 `weaponBase`／`weaponTip`） | 本地 3 層；其他玩家 1 層、段數減半 |
| 投射物 | `playSkill` 的 `onProjectile(ev, visual)`，或 `launch(owner, kind, from, dir, speed)` | `visual` 可能是 null（被預算略過）；**判定照常**。`visual.steer()` 追蹤、`visual.dispose(true)` 命中爆開 |
| 命中特效 | `hit(point, keys, { owner, damage, crit, palette, shake, sfx, ground })` | `ground`：範圍技能的地面衝擊點 |
| 地形高度 | 建構時 `ground: (x, z) => 高度`，或 `setGround(fn | null)`；`groundPoint(x, z)` | 地面特效（衝擊波、塵環、地裂、碎石、光柱、蓄力環）、範圍提示、怪物死亡／重生、流星落點放在地形表面（＋2 cm）。斜坡上的平面特效（衝擊波、地裂、魔法陣、光環、地面光暈、旋風環）**依地面法線傾斜貼合**，最多 35°。不給時與原本相同（y＝0） |
| 暴擊 | `hit(..., { crit: true })` | 金色爆發＋畫面閃光＋暴擊音效（本地玩家） |
| 傷害數字 | `hit(..., { damage })`、`playerHurt(chest, dmg)` | 只顯示自己打出的與自己受到的；其他玩家的數字不顯示 |
| 怪物受傷 | `monsterHurt(point, owner)`（受擊閃白由怪物模組 `applyPose({ hitFlash })` 處理） | |
| 怪物死亡 | `monsterDeath(groundPos, scale)` | 塵環＋星光碎片（死亡動作與淡出由 `RiggedMonsterVisual`） |
| 怪物重生 | `monsterRespawn(groundPos, scale, boss)` | 魔法陣＋光柱（與展示頁相同） |
| 任意特效 | `spawn(owner, fxKey, point, { palette, yaw, scale, duration, follow })` | 職業特效、增益等 |
| 畫質 | `setQuality("high" \| "medium" \| "low")`、`setEnvironment("dark" \| "bright")` | |
| 重要戰鬥特效 | `zone(kind, center, radius, { owner, duration, margin })`、`statusCue(kind, follow)`、`launch(..., essential)`、`hit(..., { essential })`、`playSkill(..., hooks, { essential })` | 見第 3 節「重要戰鬥特效例外」 |
| 畫面閃光／鏡頭震動 | `setScreenFlash(enabled, intensity 0～1)`、`setCameraShake(enabled, scale)` | 可調整、可關閉（設定頁由 A 決定放哪裡） |
| 傷害數字類型 | `hit(..., { style })`：`normal`／`crit`／`heal`／`block`／`miss`（另有 `player`＝自己受傷） | 沿用現有樣式。**格擋 `block` 是獨立樣式**（淺藍字＋藍色外框牌面），不再借用 `miss`。顯示文字（例如「格擋」）由遊戲傳入；名稱／傷害／冷卻未定案 |
| 診斷 | `stats()`、`trailHead(id)`、`vfx.brokenTextures()` | 特效數、粒子、預算、略過次數、重要特效次數、音效、傷害數字；拖尾最新取樣；失效貼圖清單（正常為空） |

六大職業擴充：
- 職業套件、動畫命名、必要時間標記、6 種技能樣板與檢查器在 `classKits.ts`；職業特效家族在 `classes.ts`。
- 正式技能做好後，`comboTemplate(...)` 等產生 `SkillDef`，用 `validateSkillDef(def, clip)` 檢查，再交給 `playSkill`。

## 3. 品質分級與多人控制

| | 高 | 中 | 低 |
|---|---|---|---|
| 同時特效上限 | 48 | 32 | 18 |
| 全畫面粒子上限 | 2400 | 1200 | 500 |
| 粒子倍率 | 1 | 0.55 | 0.25 |
| 發光後製 | 有 | 有 | 無 |
| 次要層（餘燼、碎石） | 有 | 有 | 無 |
| 拖尾段數 | 22 | 14 | 8 |
| 傷害數字上限 | 40 | 28 | 16 |

本地玩家與其他玩家：
- 其他玩家（含隊友）最多佔同時特效的 45%，粒子再乘 0.5（隊友 0.75）。
- 其他玩家只畫主層、拖尾 1 層、音量 0.3 並依畫面位置左右聲道。
- 本地玩家的命中閃光與暴擊一律保留（不受上限限制）；本地的一般特效也受上限限制。
- 粒子壓力超過 70% 時先省略次要層。

遠距離與不可視：
- 其他玩家的特效、投射物、音效：與本地玩家距離超過 28 m，或不在鏡頭畫面內（邊界寬 2.5 m），就不生成（`stats().culled`）。
- 其他玩家角色超過 14 m 改用遠距離模型（`CombatAvatar.setFar`；Stage 3）。
- 粒子系統、特效網格都用物件池重複使用；`dispose()` 全部釋放。

重要戰鬥特效例外（Stage 7.5 相容整合新增）：
- 上面的 45%、粒子簡化、28 m／畫面外略過**照樣保留**，只對「會影響本地玩家」的特效開例外：不因施放者太遠、不在畫面內、其他玩家份額或特效上限而省略。
- 適用：Boss 範圍預警（`zone("bossWarning")`，一律顯示）；敵方危險範圍、治療範圍（`zone("danger"|"heal")`，本地玩家在範圍內或邊緣 3 m 內才算）；飛向本地玩家的投射物（`launch(..., true)`；`playSkill` 的其他玩家投射物落點在本地玩家 1.5 m 內時自動判定）；必要狀態提示（`statusCue`）。
- 次要層（餘燼、碎石等裝飾）**不在例外內**，照樣依壓力省略；其他玩家的重要特效仍只畫主層。
- 重要特效計入「不受上限」組：不會擠掉別人，也不會被別人擠掉。次數見 `stats().essential`。
- 不影響本地玩家的遠方危險範圍、投射物：依一般規則略過。

## 4. 預熱（`prewarm`）

**呼叫順序（A 的 Stage 7.5 回饋）**：`await scene.whenReadyAsync()` → `await fx.prewarm()` → `engine.runRenderLoop(...)`。
- 先預熱再等就緒：A 的整合分支曾因此卡住（場景一直等不到「就緒」，遊戲迴圈不開始）。
- C 的 n75 測試頁照正確順序開機並列入測試（Chromium／WebKit 都通過，預熱後 1.5 秒內畫面持續更新）。
- 也記錄了錯誤順序：修好失效貼圖後，C 的測試頁不再卡住（2.3 秒內就緒）。仍請照正確順序呼叫。


| 檢查項目 | 結果（CI，Chromium／WebKit） |
|---|---|
| 等待時間 | 中畫質 0.9～2.1 秒（CI 無 GPU 軟體繪圖；iPhone **未驗證**，預期更短）；最長 4 秒保護 |
| 預熱特效被看到 | 預熱期間鏡頭只畫 1×1 像素，結束後恢復；請在載入畫面期間呼叫 |
| 傷害判定 | 不呼叫任何 hook、不扣血（測試：怪物總血量前後相同） |
| 音效、網路 | 不播音效（0 次）、不顯示傷害數字（0 次）；本模組本來就不送網路事件 |
| 物件回收 | 預熱後殘留特效 0、投射物 0 |
| 重複進出地圖 | 建立 → 預熱 → 播技能 → 釋放，重複 4 次；網格、材質、貼圖、粒子、發光層、節點數都回到起始值，DOM 全部移除 |
| 低畫質 | 只建立低畫質需要的資源：材質 24／網格 32／粒子系統 19（高畫質為 27／46／48），沒有發光層 |

- 預熱開關：展示頁 `&prewarm=0`；模組不呼叫 `prewarm()` 即為關閉。
- 診斷：展示頁 `__cvfx.shaderCount()`、`__cvfx.shaderKeys()`、`__cvfx.prewarm()`、`__cvfx.moduleLifecycle(n, tier)`。
- 預熱後施放期間才編譯的 shader：3 個（關閉預熱時 10 個）。剩下 3 個是場景材質的半透明＋霧變體，持續追蹤，不阻擋接入。

Stage 7.5 修正：4 個星光／火花材質的貼圖失效（A 回報的 `fxm_star|#BFE0FF`、`fxm_spark|#BFE0FF`、`fxm_spark|#FFFFFF`、`fxm_star|#59BFFF`）
- 原因（已用測試確認 Babylon 行為）：投射物的粒子尾巴以投射物網格當發射源。投射物結束時釋放網格，Babylon 會連帶釋放以它為發射源的粒子系統，而 `ParticleSystem.dispose()` 預設會一起釋放貼圖，把共用的 `fx_star_256`／`fx_spark_256` 刪掉。之後用到這兩張貼圖的材質都失效。
- 修正：
  - 投射物結束、粒子回收、全部清除時，先把粒子的發射源改成固定位置，不再引用網格。
  - 物件池跳過已被外部釋放的粒子系統。
  - 共用材質取用時若貼圖失效，自動換回有效貼圖。
  - 新增診斷 `vfx.brokenTextures()`。
- 測試：預熱後、畫質切換（高→低→中→高，每段都施放全部技能＋投射物撞擊）、重複進出地圖 3 次，失效貼圖都是 0。場景都能就緒；進出地圖的資源數 3 次都相同。

之前也修好兩個共用貼圖被誤刪的問題：
- 武器拖尾釋放時，會把共用的拖尾貼圖一起刪掉；切換畫質或離開地圖後，其他角色的拖尾會失去貼圖。
- 特效系統釋放時，會刪掉共用的粒子貼圖；第二次進地圖時會拿到已刪除的貼圖。

## 5. 需要 A 配合

1. **新版男性初心者 n75**：C 依 A 的 `Starwish_Novice_N75_Male_Tech_Spec.md` 完成相容測試，結果見第 8 節。C 不修改角色模型、骨架、蒙皮、動作。
2. 開機順序：`scene.whenReadyAsync()` → `fx.prewarm()` → 遊戲迴圈。離開地圖時呼叫 `fx.dispose()`。
3. 每格順序：`fx.advance(dt)` → `avatar.setSkillTime(t)`（角色姿勢）→ `fx.updateVisuals(dt)`。技能的特效、投射物、拖尾事件在 `updateVisuals` 才產生，所以姿勢一定要在兩者之間更新，否則武器特效會落後一格。
4. 地形：`new CombatFx({ ..., ground })` 與 A 整合分支的寫法相同，A 可以直接改用 C 的版本（不用保留自己的修改）。
5. 戰鬥規則（傷害、暴擊、命中範圍、冷卻）由 A 決定；`onHit` 收到時間點後再呼叫 `fx.hit(...)`。格擋改用 `style: "block"`（A 改一行）。
6. 決定正式 HUD 是否沿用傷害數字與畫面閃光的 DOM（`hudRoot`）。
7. 共用資產接入順序 D → C → B：C 的部署維持暫停，由 A 確認解除。

## 6. 需要 D 配合

1. 其他玩家施放：
   - 收到 `cast_start` 時呼叫 `playSkill(otherId, skill, clip, rate)`，`owner: "other"`。
   - 收到 `cast_hit` 時呼叫 `fx.hit(point, keys, { owner: "other", sfx, actorId })`，不傳 damage（其他玩家的數字不顯示）。
2. 本地玩家的命中，以伺服器確認的結果為準：
   - 先播畫面，再用伺服器的 `damage`／`crit` 呼叫 `fx.hit`。
   - 或由 A 決定是否先行預測。
3. 每格更新 `fx.listener` 為本地玩家位置。距離與畫面外的略過由模組自己處理，伺服器不用知道。
4. mp81／mp82 改讀共用區（12 個 C 檔案的共用路徑見 `SHARED_ASSETS_HANDOVER_A_D.md`）。這 12 個檔案的內容由 C 保持不變，單元測試保護。

## 7. 未驗證
- iPhone Safari 實機：預熱時間、1% Low 改善幅度、32 人多人實戰、FPS。
- 正式武器、正式技能（名稱、數值、冷卻未定案）。
- **正式雙手武器（後續驗收項目）**：
  - 目前用 C 的展示短劍代替，量了左手握點：雙手劍 −0.06～−0.08 m（規格 −0.10）、長柄 +0.28～+0.29 m（規格 +0.28），都在刀身軸上。
  - 正式雙手武器的長度、握把長度、拖尾點、特效發射點，要等 A 完成模型後再驗收。
  - 錘擊（`Attack_Hammer_Smash`）規格沒有列雙手握點，實測左手離武器軸 0.44 m，視為單手。

## 8. n75 相容性測試（`?lab=n75compat&lod=lite|hq`，CI 才取得 A 的資產）
依據：A 的 `Starwish_Novice_N75_Male_Tech_Spec.md`（不再用推測的骨架或掛點）。
來源：A 的 `feature/render-stage75-novice`（461fb9e）`novice_n75_male_{lite,hq}.glb`＋`novice_n75_male.json`，CI 建置前唯讀取出，**不提交、不部署、不修改**。
做法：
- 只播 A 檔案內原有的動作。
- C 的展示短劍／法杖依規格 §3 掛在 `Weapon_R`：位置 0、旋轉單位、縮放補償掛點世界縮放，法杖不後退。新增 `attachToSocket(w, socket)`；C1.0-B5b 的 `attachWeapon` 不變。
- 命中點：腳底＋0.69 m。
- 特效全部經過 `CombatFx`，每格順序 `advance → goToFrame(同一個 t) → updateVisuals`。
- 固定步長 1/60 秒，攻速 ×1.0／×1.3／×1.6。

| 檢查 | 結果（Chromium lite／hq、WebKit lite；CI run 見交付文件） |
|---|---|
| 骨骼／動作 | 82 根蒙皮骨骼（1 副骨架）、27 段動作、1 網格 1 材質 |
| 掛點 | `Weapon_R`（父 `R_Hand`）、`Weapon_L`（父 `L_Hand`）的本地位置、旋轉與規格一致；世界縮放 1.2747；靜止姿勢刀身、手指世界方向與規格一致 |
| 武器尺寸 | 縮放補償後：短劍拖尾 劍根→劍尖 0.40 m；法杖握把→杖頭星晶 0.62 m（符合規格） |
| 6 個 `Skill_*` 動作標記 | 與 C 的 `novice_combat_male.json` 完全一致 |
| 拖尾沿著武器 | 誤差 0（6 個技能×3 種攻速＋10 個普通攻擊／施法動作）；高攻速補取樣後每段 ≤ 0.17 m |
| 特效從武器產生 | 法杖集氣、施法閃光到杖頭距離 0（不落後一格） |
| 投射物發射點 | 魔法彈、劍氣到右手 0.48～0.62 m（隕石從目標上空落下，設計如此） |
| 動作與特效時間同步 | 命中 hook 實際時間＝標記／攻速，誤差 ≤ 1 格（1/60 秒），三種攻速都通過 |
| 命中特效位置 | `fx.hit` 的命中特效都在目標命中點（誤差 0） |
| 地形 | 高度 0／12.5／−0.8 m、坡度 0.3／0.5：地面特效中心在地面上 0～0.1 m；魔法陣邊緣離地都是 0.05 m（貼著坡面） |
| 失效貼圖 | 預熱後、畫質切換、重複進出地圖 3 次：0 |
| 開機順序 | 就緒 → 預熱 → 迴圈：預熱 1.1～1.2 秒（Chromium）、5.0 秒（WebKit，CI 軟體繪圖） |
| 格擋樣式 | 與未命中不同（顏色、外框、底色） |
| 重要特效例外 | Boss 預警、自己在危險／治療範圍、飛向自己的投射物、狀態提示：施放者 40 m 外＋畫面外仍顯示；不影響自己的遠方危險範圍／投射物、裝飾粒子照樣略過 |
| 頁面錯誤 | 0 |

武器與角色網格接觸（**提醒，不判定失敗，待 A 確認**）：
- 量法：CPU 蒙皮後的角色頂點，在刀身線段 1.5 cm 內的數量。排除兩手掌 12 cm；自我檢查：穿過胸口的線段有接觸、遠方線段沒有。
- 結果：普通攻擊的蓄力段（短劍舉在臉旁）會碰到頭髮／兜帽，例如 `Attack_1H_Chop` 0.08～0.25 秒、`Attack_2H_Slash` 0.22～0.47 秒，最多約 25 個頂點。技能只有 `Skill_TripleSlash` 0.40 秒 1 格碰到衣襬。
- 截圖：`combat-vfx/n75/chromium_hq_contact_*`。
- 這是 A 的動作與展示武器的組合結果，C 不修改動作；正式武器尺寸確定後再一起驗收。

門檻（拖尾誤差 1 cm、刀光每段 0.25 m、特效位置 5 cm、刀尖瞬移換算攻速 ×1 每格 0.6 m、接觸半徑 1.5 cm）都是 C 暫定。
截圖：`results/combat-vfx-<run>` 分支的 `combat-vfx/n75/`。
