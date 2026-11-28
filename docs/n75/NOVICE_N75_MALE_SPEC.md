# 新版男性初心者 n75 技術規格（給 Claude C、Claude D）

作者：Claude A　日期：2026-11-28　版本：Stage 7.5 第二階段（`rig/novice75` b465551d → 遊戲 `feature/render-stage75-novice`）
檔案：`public/models/novice_n75_male_hq.glb`、`novice_n75_male_lite.glb`、`novice_n75_male.json`（動作時間標記）

> **以本文件與 GLB 實際內容為準，不需要猜骨架或掛點。** 模型、骨架、蒙皮由 A 維護；C、D 不需要也不應修改。
> 正式美術驗收以 iPhone 實際遊戲畫面為準。女性初心者仍是 C1.0-B5b（男性驗收後才換）。

## 1. 尺寸與座標方向

| 項目 | 規格 |
|---|---|
| 身高 | **1.25 m**（與 C1.0-B5b 相同；網格原始高 0.98，`Armature` 縮放 1.2747） |
| 寬／深（靜止姿勢） | 約 0.54 m（含袖）× 0.34 m |
| 座標（GLB 內） | glTF：+Y 上、**角色面向 +Z**、單位公尺。`Armature` 節點：旋轉 −90°（Y 軸，四元數 [0, −0.7071, 0, 0.7071]）、縮放 1.2747 |
| 遊戲（Babylon） | `NoviceAvatar.root`：`rotation.y = yaw`，前方 `(sin yaw, 0, cos yaw)`；腳底在 root 原點（y＝地面） |
| 網格 | 1 個網格、1 個材質（**1 Draw Call**）、9,609 三角面、蒙皮每頂點最多 4 影響；HQ／Lite 同一網格，只有貼圖大小不同 |
| 骨骼 | 82 根蒙皮骨骼（Tripo 78 根＋輔助 4 根）；另有 2 個掛點節點（不是骨骼） |
| 靜止姿勢參考（glTF 世界，公尺） | 骨盆 Hip (0.003, 0.641, 0.037)、頭 Head (0.003, 0.979, −0.002)、右手 R_Hand (−0.214, 0.626, 0.019)、左手 L_Hand (0.218, 0.628, 0.018)、腳 L/R_Foot y＝0.10 |

角色的右手在 glTF 的 −X 側（面向 +Z）。

## 2. 完整骨架名稱與階層

名稱大小寫照原樣（Tripo 命名）。Babylon 載入後最上層多一個 `__root__`（glTF 右手座標轉換）。

```
Armature  ← 節點（不是蒙皮骨骼）
  （網格：Starwish 男性初心者本體，1 網格／1 材質）
  BoneRoot
    Hip
      Pelvis
        L_Thigh
          L_Calf
            L_Foot
              L_ToeBase
            L_CalfTwist01
              L_CalfTwist02
            L_KneeShareBone
          L_ThighTwist01
            L_ThighTwist02
        R_Thigh
          R_Calf
            R_KneeShareBone
            R_Foot
              R_ToeBase
            R_CalfTwist01
              R_CalfTwist02
          R_ThighTwist01
            R_ThighTwist02
        Hem_F  ← 輔助骨骼（前衣襬）
        Hem_B  ← 輔助骨骼（後衣襬）
      Waist
        Spine01
          Spine02
            NeckTwist01
              NeckTwist02
                Head
                  FacialBone
                    R_Eye
                    L_Eye
                  Hair_Back  ← 輔助骨骼（後髮，彈簧）
            L_Clavicle
              L_Upperarm
                L_Forearm
                  L_ForearmTwist01
                    L_ForearmTwist02
                  L_ElbowShareBone
                  L_Hand
                    L_Pinky1
                      L_Pinky2
                        L_Pinky3
                    L_Ring1
                      L_Ring2
                        L_Ring3
                    L_Mid1
                      L_Mid2
                        L_Mid3
                    L_Index1
                      L_Index2
                        L_Index3
                    L_Thumb1
                      L_Thumb2
                        L_Thumb3
                    Weapon_L  ← 左手武器掛點（節點）
                L_UpperarmTwist01
                  L_UpperarmTwist02
            R_Clavicle
              R_Upperarm
                R_Forearm
                  R_ElbowShareBone
                  R_ForearmTwist01
                    R_ForearmTwist02
                  R_Hand
                    R_Ring1
                      R_Ring2
                        R_Ring3
                    R_Mid1
                      R_Mid2
                        R_Mid3
                    R_Thumb1
                      R_Thumb2
                        R_Thumb3
                    R_Index1
                      R_Index2
                        R_Index3
                    R_Pinky1
                      R_Pinky2
                        R_Pinky3
                    Weapon_R  ← 右手武器掛點（節點）
                R_UpperarmTwist01
                  R_UpperarmTwist02
            Hood  ← 輔助骨骼（兜帽，彈簧）
```

常用骨骼對照（C 的 `novice_combat_<g>.json` 是 C1.0-B5b 的 17 關節）：

| C 的關節 | n75 骨骼 |
|---|---|
| hips | Hip（平移在 BoneRoot／Hip） |
| spine／chest | Waist、Spine01、Spine02 |
| neck／head | NeckTwist01、NeckTwist02、Head |
| upper_arm／forearm／hand（L／R） | L_/R_Upperarm、L_/R_Forearm、L_/R_Hand |
| thigh／shin／foot（L／R） | L_/R_Thigh、L_/R_Calf、L_/R_Foot（腳尖 L_/R_ToeBase） |

扭轉骨（*Twist01/02）、ShareBone、手指 3 節、眼睛由動畫自動帶動，特效不需要用到。

## 3. 武器掛點

| 節點 | 父骨骼 | 本地位置（公尺，父骨骼座標） | 本地旋轉（四元數 x, y, z, w） | 軸向 |
|---|---|---|---|---|
| **Weapon_R** | R_Hand | (0.0006, 0.0382, 0.0113) | (0.4973, 0.5108, 0.5194, −0.4711) | **+Y＝刀身／杖身方向、+Z＝手指方向、+X＝掌心法線** |
| **Weapon_L** | L_Hand | (0.0023, 0.0418, −0.0110) | (0.4853, 0.5030, 0.5312, −0.4788) | 同上 |

- 掛點原點＝**握把中心（掌心）**。
- 掛點的世界縮放繼承 `Armature`（≈1.2747）。武器掛上去時，要把武器根節點縮放設成 `1 / 掛點世界縮放`，武器尺寸才是公尺。A 的 `NoviceAvatar.attachWeapon(node, "R"|"L")` 已經這樣做：位置 0、旋轉單位、縮放補償。
- 靜止姿勢時 Weapon_R 世界軸：刀身 (0.01, 0.11, 0.99)（往前）、手指 (−0.50, −0.86, 0.10)、掌心 (0.86, −0.50, 0.05)。

### 劍根、劍尖、法杖頭（拖尾與發射點）

用 C 的展示武器（`src/combat-vfx/weapons.ts` 的 `buildSword`／`buildStaff`）掛在 Weapon_R 時，取樣點在**武器本地 +Y 軸上**（＝掛點 +Y，公尺）：

| 武器 | 劍根／杖身拖尾起點 `base` | 劍尖／杖頭拖尾終點 `tip` | 發射點 `focus`（法杖頭） |
|---|---|---|---|
| 短劍 sword | +Y 0.10 m | +Y 0.50 m | +Y 0.45 m |
| 法杖 staff | +Y 0.45 m | +Y 0.72 m | **+Y 0.62 m（杖頭星晶）** |

- n75 的法杖**握在杖身底端**（掛點＝杖身原點）。C1.0-B5b 是握在下 1/3（`attachWeapon` 往後退 0.18 m）；n75 不退。
- 遊戲內：`WeaponRig.base`／`tip`／`focus` 直接交給 `CombatFx.register({ weaponBase, weaponTip, weaponFocus })`；換武器時重新 `register`。
- 正式武器 GLB：只要原點在握把中心、+Y 為刀身，拖尾點放在同一軸上即可替換。

## 4. 雙手武器握持

| 動作 | 左手握點（從 Weapon_R 沿刀身 +Y，公尺） | 說明 |
|---|---|---|
| Attack_2H_Slash、Attack_2H_Smash | **−0.10**（右手下方 10 cm） | 雙手劍：右手在上、左手在下 |
| Attack_Polearm_Thrust、Attack_Polearm_Swing | **+0.28**（右手前方 28 cm） | 長柄：左手在前 |
| 其他動作 | 單手 | 左手自由 |

- 左手掛點 Weapon_L 的方向對齊 Weapon_R（兩手同向握同一根握把）。
- 已烘焙在動作裡（雙骨 IK，左手平均誤差 0.5～4.7 cm），遊戲執行時不再算 IK。
- 權重：動作開始 0→0.1 秒淡入、結束前 0.12 秒淡出。
- 兩手都搆不到時，武器會往胸前拉近（最多拉到胸前），不會把手臂拉長。

## 5. 動作檔名稱與時間標記

- 動作在 GLB 的 `animations`（Babylon AnimationGroup，名稱如下）。
- 時間標記在 `novice_n75_male.json` 的 `clips`：`{ "seconds": 長度, "loop": 是否循環, "marks": { 名稱: 秒 或 [開始, 結束] } }`。
- 轉成 C 的 `ClipTiming`：`{ duration: seconds, marks }`。
- 技能片段 `Skill_*`：長度、標記與 C 的 `novice_combat_male.json`（v2.1）完全相同，`rootMotion` 直接用 C 檔案裡的。n75 是用 C 的動作重定向到新骨架，時間沒有改。

| 片段 | 秒 | 循環 | 標記（秒） | 結束 |
|---|---|---|---|---|
| Idle | 15.33 | ✓ | — | — |
| Wait | 6.00 | ✓ | — | Idle 持續 8 秒後播放 |
| Walk | 2.33 | ✓ | 根運動 0.73 m/s | — |
| Run | 1.27 | ✓ | 根運動 2.66 m/s | — |
| Attack（預設普通攻擊） | 0.633 | | hit 0.253 | 0.633 |
| Attack_Unarmed | 0.633 | | 蓄力頂點 0.16、**hit 0.248**、收招 0.42 | 0.633 |
| Attack_1H_Chop | 0.633 | | 蓄力 0.18、**hit 0.248**、收招 0.42 | 0.633 |
| Attack_1H_Thrust | 0.633 | | 蓄力 0.17、**hit 0.248**、收招 0.44 | 0.633 |
| Attack_2H_Slash | 0.633 | | 蓄力 0.20、**hit 0.248**、收招 0.45 | 0.633 |
| Attack_2H_Smash | 0.733 | | 蓄力 0.26、**hit 0.34**、收招 0.50 | 0.733 |
| Attack_Polearm_Thrust | 0.633 | | 蓄力 0.18、**hit 0.248**、收招 0.45 | 0.633 |
| Attack_Polearm_Swing | 0.80 | | 蓄力 0.28、**hit 0.38**、收招 0.55 | 0.80 |
| Attack_Hammer_Smash | 0.80 | | 蓄力 0.32、**hit 0.42**、收招 0.60 | 0.80 |
| Cast_Staff | 0.633 | | 蓄力 0.18、**release 0.248**、收招 0.45 | 0.633 |
| Cast_Heal | 0.90 | | 蓄力 0.30、**release 0.50**、收招 0.68 | 0.90 |
| Attack_Throw | 0.633 | | 蓄力 0.20、**release 0.248**、收招 0.45 | 0.633 |
| Block | 0.40 | | guard 0.18 | 0.40 |
| Hurt | 0.633 | | — | 0.633 |
| Death | 2.00 | | — | 2.00（停在最後一格） |
| Jump | 1.27 | | — | 1.27（技能用；沒有一般跳躍按鈕） |
| Jump_Land | 0.40 | | land 0 | 0.40 |
| Skill_TripleSlash | 1.50 | | **hit1 0.17、hit2 0.50、hit3 0.92**；trail1 [0.10, 0.27]、trail2 [0.40, 0.60]、trail3 [0.82, 1.04]；wave 0.90 | 1.50 |
| Skill_StaffCast | 1.30 | | circle 0.05；gather [0.12, 0.55]；**release 0.58** | 1.30 |
| Skill_LeapSlam | 1.50 | | takeoff 0.28、apex 0.54、**hit 0.80**、land 0.80；trail [0.60, 0.84] | 1.50 |
| Skill_Whirlwind | 1.60 | | **hit1 0.48、hit2 0.76、hit3 1.04**；trail [0.22, 1.30] | 1.60 |
| Skill_StarMeteor | 1.70 | | circle 0.08、**release 0.72**、impact 1.20 | 1.70 |
| Skill_ChargeBurst | 2.10 | | charge [0.05, 1.10]、release 1.10、**hit 1.22**；trail [1.08, 1.32] | 2.10 |

說明：
- 「蓄力頂點」「收招」是 A 程式化動作的關鍵影格，目前沒有寫進 JSON 的 marks（只有 hit／release）。C 需要的話，A 可以把 `windup`、`recover` 加進 marks。
- 蓄力 → 命中用加速曲線（t^2.4），命中 → 收招用減速曲線。
- 攻速：遊戲依攻速調整播放倍率，標記時間等比例縮短（上限 1.6 倍）。
- 技能的動作播放時間由 C 的 `SkillTimeline` 驅動（`NoviceAvatar.setSkillTime(t)`）：頓幀時動作一起停，命中那一格一定是命中姿勢。
- 動作結束時間＝片段長度÷播放倍率；技能結束時回到移動或待機狀態。

## 6. 次要動態、穿模

- 輔助骨骼 Hair_Back、Hood：遊戲執行時加彈簧（起跑、急停、轉向輕微甩動）。
- 輔助骨骼 Hem_F、Hem_B：烘焙在動作裡，跟著大腿。
- 特效（`follow` 型：魔法陣、旋風、光環）掛在 `NoviceAvatar.root`（腳底）。
- 角色 1.25 m，命中點建議用腳底 + 0.55 × 身高（約 0.69 m）。

## 7. 給 D（多人）

- 其他玩家用 n75 Lite：`NoviceAvatar.load({ version: "n75", lod: "lite", shared: true })`。用 AssetContainer 共用網格、材質、貼圖，每人只有自己的骨架與動畫。
- 技能動作：`playSkill(clip, duration)` 加上每格 `setSkillTime(t)`，t＝伺服器施放事件的技能時間軸。
- 技能位移的伺服器規格見 `Starwish_Stage7_5_N75_Multiplayer_Handoff_ClaudeA_to_ClaudeD.md`。
