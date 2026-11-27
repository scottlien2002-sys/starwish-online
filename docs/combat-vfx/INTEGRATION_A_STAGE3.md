# Combat VFX Stage 3｜Claude A 戰鬥整合文件

作者：Claude C　分支：`feature/combat-vfx-stage3`（從 Stage 2 `ecdf80d` 分出；Stage 2 備份在 `backup/combat-vfx-stage2-final`）
預覽：`/preview-combat-vfx-s3/?lab=combat`　Stage 2 預覽 `/preview-combat-vfx-s2/` 保留不動。

> 技能名稱、傷害、冷卻、武器外觀**一律未定案**；本階段只做共用架構、效能、音效與動作修正。
> 角色仍是已驗收的 C1.0-B5b 男女初心者，近距離外觀與 Stage 2 完全相同（檔案內近距離網格逐位元組相同）。
> Stage 2 的整合方式（`INTEGRATION_A_STAGE2.md`）全部照用，本文件只列 Stage 3 的新增與變更。

## 1. 新增／變更的檔案

| 路徑 | 內容 | 依賴 |
|---|---|---|
| `public/models/novice_c10b5b_{male,female}_remote.glb` | 其他玩家模型，**新增遠距離版**：`face_far`、`body_far`（同一組骨架與材質）。近距離 `face`、`body_merged` 與 Stage 2 相同 | — |
| `tools/combat-vfx/decimate.py` | 減面工具（二次誤差邊收縮；縫線與邊界鎖住、不翻面） | Python＋numpy |
| `tools/combat-vfx/make_remote_lod.py` | 產生 remote 模型（近＋遠）；Lite 改版後重跑即可 | 同上 |
| `src/combat-vfx/CombatAvatar.ts` | `setFar(bool)`、`nearMeshes`／`farMeshes`、`nearTriangles`／`farTriangles` | Babylon |
| `src/combat-vfx/fx/CombatAudio.ts` | **音效 V2**：分層合成、18 種音效、左右聲道、環境殘響、限幅器、離線算圖 | WebAudio |
| `src/combat-vfx/core/classKits.ts` | **六職業共用架構 V2**：職業套件、6 種技能樣板、`validateSkillDef` | 無（Node 可測） |
| `src/combat-vfx/core/skills.ts` | `SfxKey` 新增 `staffSwing`、`groundImpact`、`shieldBash`、`heal`；跳斬落地改用 `groundImpact` | 無 |
| `public/combat-vfx/novice_combat_{male,female}.json` | 動作 **version 2.1**：只改旋風斬腳步；其他 5 個片段與 2.0 完全相同；命中標記不變 | — |
| `public/models/monsters/m002/*`、`m003/*` | M002、M003 **Rig V1.1**（檔名、關節、動作名稱與長度不變，可直接覆蓋） | — |

## 2. 遠距離玩家 LOD（只換其他玩家，不動自己的角色）

```ts
const av = await CombatAvatar.create(scene, baseUrl, gender, "remote");
// 每格（或每 0.2 秒）依「鏡頭到角色」距離切換；有緩衝避免來回閃
const d = Vector3.Distance(camera.position, av.root.position);
if (!av.far && d > 14) av.setFar(true);
else if (av.far && d < 13) av.setFar(false);
```

| | 男 | 女 |
|---|---|---|
| 近距離（= Stage 2） | 40,381 三角面 | 39,955 三角面 |
| 遠距離 | 16,555（−59%） | 17,769（−56%） |
| 其中頭髮 | 15,197 → 約 3,800（25%） | 10,843 → 約 2,700（25%）；馬尾 3,330 → 約 1,670 |
| 檔案大小 | 1.88 → 1.98 MB | 1.81 → 1.92 MB |

- 減面比例：頭髮 25%、臉 40%、其他超過 400 面的部位 50%；400 面以下的小零件（眼睛、飾品）不減。
- 同一個 draw call 數（每人 2 個），只是畫的三角面變少；遠近共用材質與骨架，切換不重新載入、不會跳動作。
- 切換距離 14 m／13 m 是建議值：展示頁可用 `&lodFar=<公尺>` 調整。手機鏡頭較近時可改 10～12 m。
- 舊版 remote 檔（只有近距離）也能用：`setFar` 會回傳 false、維持近距離版。
- 遠距離版的外觀：在 14 m 以上看不出差別（比較圖見報告）；**不要**用在自己的角色。

## 3. 音效 V2（`fx/CombatAudio.ts`）

```ts
const audio = new CombatAudio();
canvas.addEventListener("pointerdown", () => audio.unlock(), { capture: true });   // iPhone 需要使用者點一下
audio.setEnvironment("bright");          // 星芽原野（戶外，殘響短）；星夜競技場用 "dark"
audio.play("hit");                        // 自己
audio.play("hit", 0.35, pan);             // 其他玩家：音量小、依畫面左右位置 pan（-1～1）
```

| 類別 | 鍵值 | 組成 |
|---|---|---|
| 武器揮擊 | `swish`、`swishHeavy`、`staffSwing`、`whirl` | 濾波噪音掃頻＋高頻空氣聲；聲像左→右；旋風 6 次揮擊左右交替 |
| 命中 | `hit`、`hitHeavy` | 起音「喀」＋低頻「咚」（輕微失真）＋悶聲＋細微金屬泛音 |
| 暴擊 | `crit` | 金屬「鏘」（不和諧泛音）＋低頻＋上升閃光音階＋高頻亮點 |
| 魔法 | `cast`、`charge`、`release`、`bolt`、`magicHit` | 和聲詠唱＋琶音、蓄力上升＋拍頻顫音、魔法彈掃頻、星光爆開 |
| 地面衝擊 | `groundImpact`、`explosion`、`land`、`jump` | 低頻重擊＋低通隆隆＋碎石喀啦；爆炸加長尾音 |
| 職業預留 | `shieldBash`、`heal` | 盾擊金屬共鳴、治療和弦 |

- 每次播放音高 ±4% 隨機，避免連打時聽起來一樣；同時發聲上限 14（多人不爆音）。
- 主輸出：壓縮器＋限幅器（−3 dB）；CI 檢查 36 個波形（18 音效 × 2 環境）峰值都 < 0.99。
- 測試／試聽：`renderSfxOffline(key, env)` 用 OfflineAudioContext 算出波形；`encodeWav()` 存成 WAV。
  CI 的 WAV 試聽檔在 `results/combat-vfx-<run>` 分支的 `combat-vfx/audio-chromium/`。
- 全部即時合成：不下載音檔、沒有授權問題、不用付費素材。正式音效如果要換成錄音檔，`play(key)` 介面不用改。

## 4. 六大職業共用架構 V2（`core/classKits.ts`）

```ts
import { CLASS_KITS, comboTemplate, projectileTemplate, validateSkillDef } from "./core/classKits.ts";

const draft = comboTemplate({ id: "sw_combo_a", cls: "swordsman", hits: 4 });   // 名稱、傷害、冷卻、武器外觀＝未定案
const r = validateSkillDef(draft, animFile.clips[draft.clip]);                // 上線前檢查
// r.errors：一定要修；r.warnings：例如「技能名稱：未定案」「正式動作 Swordsman_BasicCombo_01 尚未製作，暫用 Skill_TripleSlash」
```

**職業套件**（每個職業一份；武器外觀全部 `look: "未定案"`）

| 職業 | 武器插槽（規劃） | 動畫分類 → 正式片段名稱 | 音效家族 |
|---|---|---|---|
| 劍士 | 主手 單手劍／雙手 雙手劍 | 連斬、重斬、蓄力斬、突進斬、迴旋 → `Swordsman_BasicCombo_01`… | swish／hit／hitHeavy |
| 騎士 | 主手 劍＋副手 盾（hand.L）／雙手 長槍 | 劍盾連擊、盾擊、突刺衝鋒、架盾、嘲諷 | 重擊用 shieldBash |
| 鐵匠 | 雙手 重錘／主手 斧 | 錘擊連段、重錘下砸、地面震波、旋轉錘擊、鍛造強化 | swishHeavy／groundImpact |
| 法師 | 主手 法杖／浮空 魔導書 | 法杖輕擊、單體魔法彈、範圍魔法、瞬移、魔力護盾 | staffSwing／bolt／explosion |
| 祭司 | 主手 權杖／浮空 聖典 | 權杖輕擊、治療詠唱、聖光、範圍祝福、守護結界 | cast／heal |
| 小丑 | 主手 短刀／浮空 撲克牌 | 快速連擊、飛牌、閃避翻滾、道具爆炸、幻影分身 | swish／whirl／explosion |

- 片段命名：`<職業>_<分類>_<編號>`（`clipName()`）。分類：basicCombo、heavy、charge、projectile、aoe、buff、dash、guard。
- 必要時間標記（`REQUIRED_MARKS`）：連擊 `hit1..N`＋`trail1..N`；重擊 `windup`、`hit`；蓄力 `charge`［開始, 結束］、`release`、`hit`；
  投射 `cast`、`release`；範圍 `cast`、`impact`；增益 `cast`、`apply`；突進 `start`、`hit`、`end`；防禦 `raise`、`lower`。
- 已有展示動作的分類（`demoClip`）會先用初心者片段播放，讓管線先跑；正式動作做好後只要換 `clip`。
- 樣板：`comboTemplate`、`chargeTemplate`、`projectileTemplate`、`aoeTemplate`、`buffTemplate`、`dashTemplate`。
  數值不給就用佔位值（`PLACEHOLDER`：倍率 1、冷卻 1 秒）並在 `draft.tbd` 標示；企劃定案後在參數裡填入即可。
- `validateSkillDef` 檢查：id 格式、職業／配色／特效／音效鍵值存在、標記存在、拖尾結束晚於開始、事件時間在片段內、
  命中 id 不重複、倍率／震動／頓幀／半徑範圍合理、分類必要標記。現有 6 個展示技能男女都通過（單元測試）。
- Stage 2 的 `core/classes.ts`（特效家族、職業展示按鈕）保留，兩者互補。

## 5. 動作修正

- **旋風斬腳步（V2.1）**：Stage 2 的腳固定在角色座標上跟著身體轉，腳踝繞圈（每 1/120 秒漂移約 18 mm）。
  現在每隻腳「踩在世界座標的固定點」：每轉 120° 換一步（60% 時間著地、40% 時間抬腳），兩腳錯開半拍，任何時候至少一隻腳著地；
  著地腳的腳尖方向也固定（腳踝反向補償旋轉，最多扭 38°）。收招兩腳依序回到架式（不再同時離地）。
  結果：著地腳漂移 **18 mm → 0.9 mm**（男）／**0.6 mm**（女）。命中標記 0.48／0.76／1.04 不變。
- 其他 5 個技能動作與 Stage 2 完全相同。

## 6. 怪物 M002、M003 Rig V1.1

詳見 `docs/monsters/CLAUDE_C_DELIVERY_M001-M007.md`。摘要：
- M002 苔角獸：蹄改成剛性（蹄本身拉伸 168% → 0%），蹄腿交界仍有拉伸（Attack p99 160% → 112%），蹄翻轉幅度略收。
- M003 雲絨鳥：翅根交接帶加寬、翅根拍動幅度移一部分到翅中段；翅膀 p99 拉伸 Attack 212% → 166%、Run 151% → 114%。
- 檔名、關節數、7 組動作名稱與長度、命中時間都不變；`monsterSpecs.ts` 標籤改為 V1.1。候選怪物仍由星芽原野統一驗收。

## 7. 效能結論（給 A 採用）

- 其他玩家：remote 模型＋遠距離切換＋簡化武器（Stage 2 的做法全部保留）。
- 特效預算（`core/budget.ts`）：同時特效上限現在也套用到**自己的一般特效**，只有自己的 critical（命中閃光、暴擊）例外；
  新增 `stats.activeCritical`。低畫質＋多人時，自己的次要層會先被省略，命中閃光照常。
- 32 人固定鏡頭結果：三角面 −25%、Draw Call 與 Stage 2 相同水準（176 vs 174）、比 Stage 1 做法少 84%。
- 4／8／16／32 人固定鏡頭比較見 `REPORT_STAGE3.md`（CI 軟體繪圖數字，**iPhone 實機未驗證**）。
