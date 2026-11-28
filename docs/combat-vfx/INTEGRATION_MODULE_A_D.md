# Combat VFX 正式接入模組（給 Claude A、Claude D）

作者：Claude C　分支：`feature/combat-vfx-stage3`　入口：`src/combat-vfx/integration/index.ts`
穩定備份：`backup/combat-vfx-stage3.1-stable`（142fa71）　部署：暫停中（`.github/cvfx-deploy-hold`）

> 只負責**畫面與音效**：不扣血、不判斷命中與暴擊、不送網路封包。這些由 A 的戰鬥規則或 D 的伺服器結果決定，再呼叫本模組畫出來。
> 技能名稱、數值、正式技能配置**未定案**。`SKILLS` 是 6 個展示技能；`classKits.ts` 的樣板只是草稿。

## 1. 一張地圖一個實例

```ts
import { CombatFx } from "../combat-vfx/integration/index.ts";

const fx = new CombatFx({ scene, camera, hudRoot, tier: "medium", env: "bright" });   // 星芽原野用 bright
await fx.prewarm();                                   // 在載入畫面期間呼叫（見第 4 節）
canvas.addEventListener("pointerdown", () => fx.unlockAudio(), { capture: true, once: true });

scene.onBeforeRenderObservable.add(() => {
  fx.listener.copyFrom(localPlayer.position);         // 本地玩家位置（距離預算、音效左右聲道）
  const shake = fx.update(engine.getDeltaTime() / 1000);
  camera.target.addInPlace(shake);                     // 鏡頭震動（要不要加由 A 決定；不影響判定）
});

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
| 暴擊 | `hit(..., { crit: true })` | 金色爆發＋畫面閃光＋暴擊音效（本地玩家） |
| 傷害數字 | `hit(..., { damage })`、`playerHurt(chest, dmg)` | 只顯示自己打出的與自己受到的；其他玩家的數字不顯示 |
| 怪物受傷 | `monsterHurt(point, owner)`（受擊閃白由怪物模組 `applyPose({ hitFlash })` 處理） | |
| 怪物死亡 | `monsterDeath(groundPos, scale)` | 塵環＋星光碎片（死亡動作與淡出由 `RiggedMonsterVisual`） |
| 怪物重生 | `monsterRespawn(groundPos, scale, boss)` | 魔法陣＋光柱（與展示頁相同） |
| 任意特效 | `spawn(owner, fxKey, point, { palette, yaw, scale, duration, follow })` | 職業特效、增益等 |
| 畫質 | `setQuality("high" \| "medium" \| "low")`、`setEnvironment("dark" \| "bright")` | |
| 診斷 | `stats()` | 特效數、粒子、預算、略過次數、音效、傷害數字 |

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

## 4. 預熱（`prewarm`）

| 檢查項目 | 結果（CI，Chromium／WebKit） |
|---|---|
| 等待時間 | 中畫質 0.7～1.4 秒（CI 無 GPU 軟體繪圖；iPhone **未驗證**，預期更短）；最長 4 秒保護 |
| 預熱特效被看到 | 預熱期間鏡頭只畫 1×1 像素，結束後恢復；請在載入畫面期間呼叫 |
| 傷害判定 | 不呼叫任何 hook、不扣血（測試：怪物總血量前後相同） |
| 音效、網路 | 不播音效（0 次）、不顯示傷害數字（0 次）；本模組本來就不送網路事件 |
| 物件回收 | 預熱後殘留特效 0、投射物 0 |
| 重複進出地圖 | 建立 → 預熱 → 播技能 → 釋放，重複 4 次；網格、材質、貼圖、粒子、發光層、節點數都回到起始值，DOM 全部移除 |
| 低畫質 | 只建立低畫質需要的資源：材質 24／網格 32／粒子系統 19（高畫質為 27／46／48），沒有發光層 |

- 預熱開關：展示頁 `&prewarm=0`；模組不呼叫 `prewarm()` 即為關閉。
- 診斷：展示頁 `__cvfx.shaderCount()`、`__cvfx.shaderKeys()`、`__cvfx.prewarm()`、`__cvfx.moduleLifecycle(n, tier)`。
- 預熱後施放期間才編譯的 shader：3 個（關閉預熱時 10 個）。剩下 3 個是場景材質的半透明＋霧變體，持續追蹤，不阻擋接入。

本批也修好兩個共用貼圖被誤刪的問題：
- 武器拖尾釋放時，會把共用的拖尾貼圖一起刪掉；切換畫質或離開地圖後，其他角色的拖尾會失去貼圖。
- 特效系統釋放時，會刪掉共用的粒子貼圖；第二次進地圖時會拿到已刪除的貼圖。

## 5. 需要 A 配合

1. **新版 Tripo 男性初心者完成後**，提供以下內容，C 再做戰鬥動畫與特效相容性整合：
   - 骨架名稱、武器掛點節點（劍根／劍尖）、法杖頭節點。
   - 動作檔格式：`duration`、`marks`，或沿用 `novice_combat_<g>.json` 的格式。
   - C 不會修改角色模型、骨架、蒙皮。
2. 在地圖載入流程中、載入畫面還沒關掉前呼叫 `fx.prewarm()`。離開地圖時呼叫 `fx.dispose()`。
3. 戰鬥規則（傷害、暴擊、命中範圍、冷卻）由 A 決定；`onHit` 收到時間點後再呼叫 `fx.hit(...)`。
4. 決定正式 HUD 是否沿用傷害數字與畫面閃光的 DOM（`hudRoot`）。
5. 共用資產接入順序 D → C → B：C 的部署維持暫停，由 A 確認解除。

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
- iPhone Safari 實機：預熱時間、1% Low 改善幅度、32 人多人實戰。
- 正式技能、正式角色（新版 Tripo 男性初心者）的相容性：等 A 完成後進行。
