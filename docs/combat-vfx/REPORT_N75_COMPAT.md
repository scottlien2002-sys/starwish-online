# Combat VFX × 新版男性初心者 n75 相容整合報告（Claude C）

分支：`feature/combat-vfx-stage3`（69a0baa）　備份：`backup/combat-vfx-n75-compat`
CI：run 46137320277，原有測試 340/340、n75 相容測試 309/309（9 個提醒）。部署：暫停中（`.github/cvfx-deploy-hold`），gh-pages 沒有變動。

## 1. n75 相容性
- A 的 n75 資產（`feature/render-stage75-novice`，461fb9e）只在 CI 建置前唯讀取出。沒有提交到 C 的分支，沒有部署，也沒有修改 A 的模型、骨架、蒙皮或動作。
- 測試頁 `?lab=n75compat&lod=lite|hq`：
  - 播放 A 原有的 27 個動作。
  - C 的展示武器掛在 `Weapon_R`。
  - 特效全部經過 `CombatFx`。
  - 攻速測了 ×1.0、×1.3、×1.6。
- 詳細結果見 `INTEGRATION_MODULE_A_D.md` 第 8 節。

本批修正：
1. **高攻速刀光**：攻速 ×1.6 時，刀尖一格最多移動 0.82 m，刀光原本是折線。改成在兩格之間補取樣（以刀根為軸插值），刀光每段 ≤ 0.21 m。
2. **武器特效位置**：掛在武器、角色前方的特效原本用的是上一格的位置。改為在 `updateVisuals`、角色套上這一格的姿勢後才產生。命中 hook 仍在 `advance` 立即呼叫。

待 A 確認：
- 旋風斬收招約 1.25 秒時，刀尖經過頭部高度，離身體中心 0.14 m，持續 1～2 格。C 不修改動作。
- 正式武器長度與握把位置。
- 正式雙手武器，以及 `Weapon_L` 的用途。
- 攻速範圍。

## 2. 重要戰鬥特效例外
- 45% 份額、粒子簡化、28 m／畫面外略過都保留。
- 只有會影響本地玩家的特效不省略：Boss 範圍預警、自己所在的敵方危險範圍與治療範圍、飛向自己的投射物、必要狀態提示。
- 裝飾、次要粒子照樣簡化。
- 已加單元測試，並在瀏覽器實測：施放者在 40 m 外、畫面外。

## 3. 傷害數字與畫面效果
- 樣式沿用，保留 normal、crit、heal、block、miss 五種（另有 player＝自己受傷）。
- `setScreenFlash(enabled, intensity)`、`setCameraShake(enabled, scale)` 可以調整，也可以關閉。
- 名稱、傷害、冷卻沒有設定。

## 4. 未驗證
- iPhone 實機（FPS 未填）。
- 正式武器、正式雙手武器、正式技能。
